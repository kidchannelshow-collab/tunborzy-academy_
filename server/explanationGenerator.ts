/**
 * Batched, quota-safe explanation generation for the UTME PDF importer.
 *
 * WHY THIS EXISTS
 *   Local extraction (see pdfQuestionExtractor.ts) finds questions, options and
 *   the answer key with no AI call at all. What it cannot do is explain WHY the
 *   keyed answer is correct. That is a genuinely semantic task, so it is the one
 *   part of the import that still needs a model.
 *
 * WHY IT IS BATCHED
 *   The importer previously sent one request per chunk of raw PDF text —
 *   and, before the local-first parser, effectively per question — which is what
 *   exhausted the quota. Explanations are cheap in tokens and independent of one
 *   another, so many questions travel in ONE request. Requests drop from roughly
 *   one-per-question to one-per-batch, sequentially, with a hard ceiling on
 *   retries and a circuit breaker that stops the run entirely once the provider
 *   starts refusing on quota. A run therefore cannot hammer the API.
 *
 * WHAT IT WILL NOT DO
 *   It never invents an explanation. If a question is ambiguous, corrupted,
 *   truncated or simply lacks the information needed to justify the keyed
 *   answer, the model is instructed to say so via `can_explain: false`, and the
 *   question comes back with an empty explanation and `needs_review: true`.
 *   A question with no known correct option is never sent at all — there is
 *   nothing to explain yet, and fabricating an answer to explain is exactly the
 *   failure mode this module exists to prevent.
 *
 * FAILURE CONTAINMENT
 *   Every failure is per-batch and non-fatal. A batch that fails permanently
 *   marks only its own questions as needing review; the rest continue. Nothing
 *   here can throw away a question that local extraction already found — the
 *   caller keeps its questions either way.
 *
 * LOCAL AI
 *   The engine is pluggable. A local Ollama server (plain HTTP, no Python, no
 *   sidecar process to manage) is PREFERRED when one is running; DeepSeek is the
 *   fallback. Both are driven through the same batched prompt and the same JSON
 *   schema, so the explanation quality and the id-mapping behave identically
 *   whichever engine answers. Selecting the engine is `resolveExplanationEngine`;
 *   it reports exactly which model ran, so a log can never misattribute a run.
 */

import { deepseekComplete, deepseekModel, getDeepSeekApiKey } from './deepseekClient.js';

export interface ExplanationQuestion {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  /** Only questions with a known key are sent for explanation. */
  correct_option: string | null;
}

export interface ExplanationResult {
  /** Index into the array that was passed in — the caller's only join key. */
  index: number;
  /** '' whenever the model declined or the request failed. */
  explanation: string;
  needs_review: boolean;
  /** Admin-facing note explaining why review is needed. Never saved as content. */
  review_note?: string;
}

export interface ExplanationRunStats {
  batches: number;
  requests: number;
  generated: number;
  needsReview: number;
  /** Skipped because the PDF carried no answer key for them. */
  skippedNoAnswer: number;
  stoppedEarly: boolean;
  stopReason: string | null;
}

export interface ExplanationRunResult {
  results: ExplanationResult[];
  stats: ExplanationRunStats;
}

/**
 * A model that can answer one batched prompt with a JSON array.
 *
 * Deliberately narrow: one method, returning the raw JSON text. Both engines
 * below share the same prompt and the same schema, so batching, id-mapping,
 * retries and containment are written once rather than per provider.
 */
export interface ExplanationEngine {
  /** 'ollama' or 'deepseek' — recorded so logs never misattribute a run. */
  readonly provider: string;
  readonly model: string;
  /** Send one batched prompt; resolve with the raw JSON string, or throw. */
  complete(prompt: string): Promise<string>;
}

/** Local Ollama server. Default port is Ollama's own. */
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

/**
 * How long a local model may take on one batch before we give up on it. Local
 * CPU inference on a 10-question batch is slow but not unbounded; without this
 * a wedged server would hang the whole import.
 */
const OLLAMA_REQUEST_TIMEOUT_MS = 180_000;

/** Reachability probe timeout — must be short, it gates a user-facing request. */
const OLLAMA_PROBE_TIMEOUT_MS = 1_500;

const stripTrailingSlashes = (url: string) => url.replace(/\/+$/, '');

/**
 * Ask the local Ollama server which models it has. Returns null when it is not
 * running or not reachable — the caller treats that as "local AI unavailable"
 * rather than as an error.
 */
export async function listOllamaModels(baseUrl: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${stripTrailingSlashes(baseUrl)}/api/tags`, {
      signal: AbortSignal.timeout(OLLAMA_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    return (data?.models || []).map((m: any) => String(m?.name || '')).filter(Boolean);
  } catch {
    return null;
  }
}

export function createOllamaEngine(baseUrl: string, model: string): ExplanationEngine {
  const root = stripTrailingSlashes(baseUrl);
  return {
    provider: 'ollama',
    model,
    async complete(prompt: string) {
      const res = await fetch(`${root}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(OLLAMA_REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          model,
          stream: false,
          // Structured output: Ollama enforces the schema outright, which the
          // hosted engine can only be instructed to follow. Either way every
          // object comes back with the id we sent and maps to its question.
          format: EXPLANATION_SCHEMA,
          options: { temperature: 0.2 },
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        const err: any = new Error(
          `Ollama HTTP ${res.status} — ${body.slice(0, 200) || res.statusText}`,
        );
        err.status = res.status;
        throw err;
      }

      const data: any = await res.json();
      return String(data?.message?.content ?? '').trim();
    },
  };
}

/**
 * The hosted DeepSeek engine.
 *
 * The schema cannot be enforced by the provider — DeepSeek's JSON mode takes no
 * schema, unlike the `responseSchema` this replaced — so `EXPLANATION_SCHEMA` is
 * rendered into the prompt as an instruction instead. The batch prompt must
 * therefore carry it; see `buildBatchPrompt`. What the provider guarantees is
 * that the reply is valid JSON, and every object is matched back to its question
 * by the `id` we sent, so a missing or malformed entry fails one question rather
 * than the batch.
 *
 * `apiKey` is accepted for symmetry with the Ollama engine and to keep the
 * resolver's shape unchanged; the client reads it from the environment itself.
 */
export function createDeepSeekEngine(apiKey: string, model: string): ExplanationEngine {
  return {
    provider: 'deepseek',
    model,
    async complete(prompt: string) {
      void apiKey;
      return deepseekComplete({
        prompt: `${prompt}\n\nRespond with JSON matching this schema:\n${JSON.stringify(EXPLANATION_SCHEMA)}`,
        json: true,
        temperature: 0.2,
      });
    },
  };
}

export interface ResolvedEngine {
  /** null when nothing is available; the caller then flags questions for review. */
  engine: ExplanationEngine | null;
  /** Why this engine (or none) was chosen — logged and echoed to the caller. */
  reason: string;
}

/**
 * Choose the explanation engine.
 *
 * `EXPLANATION_PROVIDER`:
 *   auto (default) — prefer a RUNNING local model, else DeepSeek.
 *   ollama         — local only; if it is down, explanations are flagged for review.
 *   deepseek       — force the hosted model (opt out of local inference).
 *   gemini         — accepted as a legacy alias for `deepseek`, so a deployment
 *                    still setting the old value keeps working instead of
 *                    silently falling through to "no engine".
 *
 * Resolution never throws and never silently substitutes one provider for
 * another mid-run: whichever engine is returned is the engine whose name is
 * reported. A local model that dies mid-import is handled as a batch failure by
 * the caller (questions kept, explanation flagged), not by switching providers.
 */
export async function resolveExplanationEngine(): Promise<ResolvedEngine> {
  const choice = (process.env.EXPLANATION_PROVIDER || 'auto').toLowerCase();
  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  const ollamaModel = (process.env.OLLAMA_MODEL || '').trim();
  const deepseekKey = getDeepSeekApiKey() || '';
  const deepseekModelId = deepseekModel();

  if (choice === 'ollama' || choice === 'auto') {
    const localModels = await listOllamaModels(ollamaBaseUrl);

    if (localModels) {
      // An explicitly named model wins; otherwise the first one the server has
      // pulled is used, so a running Ollama works with no extra configuration.
      const model = ollamaModel || localModels[0];
      if (model) {
        return {
          engine: createOllamaEngine(ollamaBaseUrl, model),
          reason: `local Ollama at ${ollamaBaseUrl} (model ${model}${ollamaModel ? '' : ', auto-selected'})`,
        };
      }
      if (choice === 'ollama') {
        return { engine: null, reason: 'Ollama is running but has no models pulled.' };
      }
    } else if (choice === 'ollama') {
      return { engine: null, reason: `Ollama is not reachable at ${ollamaBaseUrl}.` };
    }
  }

  if (deepseekKey) {
    return {
      engine: createDeepSeekEngine(deepseekKey, deepseekModelId),
      reason: `hosted DeepSeek (model ${deepseekModelId})`,
    };
  }

  return {
    engine: null,
    reason: 'no local model is running and DEEPSEEK_API_KEY is not set',
  };
}

/** Questions per request. Larger = fewer requests, but coarser retry granularity. */
export const DEFAULT_EXPLANATION_BATCH_SIZE = 10;

/**
 * Attempts per batch, INCLUDING the first. Deliberately 2, not the 4 the old
 * chunk loop used: with batching, a doomed run costs at most 2× the batch count
 * instead of 4× the chunk count.
 */
const MAX_ATTEMPTS_PER_BATCH = 2;

/** Polite spacing between batches, so a 60-question import is not a burst. */
const DELAY_BETWEEN_BATCHES_MS = 750;

/**
 * Circuit breaker. After this many consecutive batches rejected for quota/rate
 * reasons, the run stops and the remaining questions are marked for review. The
 * quota is gone; continuing only deepens the outage, and the admin can retry the
 * unanswered ones later from the review screen.
 */
const CONSECUTIVE_QUOTA_FAILURES_BEFORE_STOP = 2;

/** Explanations longer than this are truncated — the field is a teaching aid, not an essay. */
const MAX_EXPLANATION_CHARS = 1200;

/**
 * The shape every engine is asked to return.
 *
 * Plain JSON Schema, as a literal. It used to be built from the removed
 * provider's `Type` enum, which made it provider-specific; this form is consumed
 * two ways and must stay neutral between them:
 *
 *   - Ollama is handed it as `format` and enforces it outright.
 *   - The hosted engine is only INSTRUCTED with it, because DeepSeek's JSON mode
 *     accepts no schema. `createDeepSeekEngine` serialises it into the prompt.
 *
 * `required` is advisory for the hosted engine and binding for Ollama, so the
 * parser treats a missing field as a per-question failure either way rather than
 * trusting that the key is present.
 */
const EXPLANATION_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The exact id label given for the question, e.g. "Q3".',
      },
      explanation: {
        type: 'string',
        description:
          'The educational explanation of how the keyed answer is obtained. Empty string when can_explain is false.',
      },
      can_explain: {
        type: 'boolean',
        description:
          'True only when the question contains enough information to justify the keyed answer.',
      },
      review_note: {
        type: 'string',
        description:
          'When can_explain is false, one short line saying what is missing or ambiguous. Otherwise empty.',
      },
    },
    required: ['id', 'explanation', 'can_explain'],
  },
};

const SYSTEM_INSTRUCTIONS = `You are an experienced UTME examiner writing model explanations for a CBT question bank.

For each question you are given its options and the OFFICIAL correct answer. Write an explanation that teaches the student how that answer is reached.

Rules:
1. Explain the reasoning that produces the correct option. Never merely restate "Option B is correct" — show WHY it is correct and why the others are not.
2. Calculation questions: state the formula, substitute the given values, carry out the steps, and give the final result with its unit.
3. Conceptual questions: name the principle, law or rule involved and explain how it applies to this specific question.
4. Treat the given official answer as fixed. Do not disagree with it, and do not propose a different option.
5. Work only from the question, its options and the given answer. Never invent data, context or conditions that are not in the question.
6. If the question text is ambiguous, corrupted, truncated, or does not contain enough information to justify the answer, set can_explain=false, leave explanation empty, and put a one-line reason in review_note. Do NOT guess. Flagging is always better than inventing.
7. Be concise: 2-5 sentences, or a short worked calculation. Plain text only — no markdown, no bold, no bullet characters.
8. Return one object per question, echoing its id exactly. Never merge or omit questions.`;

/**
 * Render one batch as the question block the model reads. Kept compact: the
 * whole point of batching is that the per-question overhead is small.
 */
function buildBatchPrompt(questions: Array<{ id: string; question: ExplanationQuestion }>): string {
  const blocks = questions.map(({ id, question }) => {
    const option = (letter: 'a' | 'b' | 'c' | 'd') => {
      const text = String((question as any)[`option_${letter}`] || '').trim();
      return `${letter.toUpperCase()}) ${text || '(no text extracted)'}`;
    };
    return [
      `[id: ${id}]`,
      `Question: ${String(question.question_text || '').trim()}`,
      option('a'),
      option('b'),
      option('c'),
      option('d'),
      `Official correct answer: ${String(question.correct_option || '').toUpperCase()}`,
    ].join('\n');
  });

  return `${SYSTEM_INSTRUCTIONS}

Questions (${questions.length} in total):

${blocks.join('\n\n')}`;
}

interface ParsedExplanation {
  explanation: string;
  canExplain: boolean;
  reviewNote: string;
}

function normaliseExplanation(raw: any): ParsedExplanation {
  const explanation = String(raw?.explanation ?? '').trim();
  const reviewNote = String(raw?.review_note ?? '').trim();
  // "can_explain" is advisory: an empty or stub explanation is treated as a
  // refusal regardless of what the flag says, so a model that sets the flag
  // wrongly cannot smuggle a non-explanation into the bank.
  const canExplain = raw?.can_explain !== false && explanation.length >= 20;
  return {
    explanation: canExplain ? explanation.slice(0, MAX_EXPLANATION_CHARS) : '',
    canExplain,
    reviewNote: canExplain
      ? ''
      : reviewNote || 'Explanation could not be generated from the question text.',
  };
}

/** Quota/rate conditions, which are treated differently from generic errors. */
function isQuotaError(err: any): boolean {
  const status = err?.status ?? err?.code;
  const message = String(err?.message || '').toLowerCase();
  return (
    status === 429 ||
    message.includes('429') ||
    message.includes('resource_exhausted') ||
    message.includes('quota') ||
    message.includes('rate limit')
  );
}

/** Conditions worth one retry. A 404 (model unavailable to this key) is not. */
function isRetryable(err: any): boolean {
  if (isQuotaError(err)) return true;
  const status = err?.status ?? err?.code;
  const message = String(err?.message || '').toLowerCase();
  return (
    status === 503 || status === 500 ||
    message.includes('503') || message.includes('unavailable') ||
    message.includes('overloaded') || message.includes('timeout') ||
    message.includes('econnreset') || message.includes('fetch failed')
  );
}

export interface GenerateExplanationsOptions {
  batchSize?: number;
  /** Progress sink — the caller prints these as `[PDF Import] ...` lines. */
  onProgress?: (message: string) => void;
}

/**
 * Generate explanations for the questions that have a known correct option.
 *
 * Returns a result for EVERY question passed in: one per explained question, and
 * one `needs_review` entry for each question skipped because it has no answer
 * yet. This never throws — a total service failure comes back as "everything
 * needs review", never as a lost import.
 */
export async function generateExplanations(
  engine: ExplanationEngine,
  questions: ExplanationQuestion[],
  options: GenerateExplanationsOptions,
): Promise<ExplanationRunResult> {
  const batchSize = Math.max(1, Math.floor(options.batchSize || DEFAULT_EXPLANATION_BATCH_SIZE));
  const progress = options.onProgress || (() => {});

  const results: ExplanationResult[] = [];
  const stats: ExplanationRunStats = {
    batches: 0,
    requests: 0,
    generated: 0,
    needsReview: 0,
    skippedNoAnswer: 0,
    stoppedEarly: false,
    stopReason: null,
  };

  // Split into explainable and not. A question with no key is NOT sent: there is
  // no answer to explain, and inventing one is the failure this guards against.
  const targets: Array<{ index: number; id: string; question: ExplanationQuestion }> = [];
  questions.forEach((question, index) => {
    const key = String(question?.correct_option || '').trim().toUpperCase();
    if (!key || !['A', 'B', 'C', 'D'].includes(key)) {
      stats.skippedNoAnswer += 1;
      results.push({
        index,
        explanation: '',
        needs_review: true,
        review_note: 'No answer key for this question yet — supply an answer, then generate its explanation.',
      });
      return;
    }
    targets.push({ index, id: `Q${targets.length + 1}`, question });
  });

  if (targets.length === 0) {
    stats.needsReview = results.filter((r) => r.needs_review).length;
    return { results, stats };
  }

  const batches: Array<typeof targets> = [];
  for (let i = 0; i < targets.length; i += batchSize) {
    batches.push(targets.slice(i, i + batchSize));
  }
  stats.batches = batches.length;

  let consecutiveQuotaFailures = 0;
  let stopped = false;

  for (let b = 0; b < batches.length; b += 1) {
    const batch = batches[b];

    if (stopped) {
      // Remaining work is parked, not lost: these questions stay in the preview
      // and can be explained later from the review screen.
      batch.forEach(({ index }) => {
        results.push({
          index,
          explanation: '',
          needs_review: true,
          review_note: stats.stopReason || 'Explanation service unavailable — try again later.',
        });
      });
      continue;
    }

    progress(`Generating explanations: batch ${b + 1}/${batches.length}`);

    let batchDone = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_BATCH && !batchDone; attempt += 1) {
      try {
        stats.requests += 1;
        const raw = await engine.complete(buildBatchPrompt(batch));
        const parsed = JSON.parse(String(raw).replace(/^```json\s*/, '').replace(/^```\s*/, '').replace(/\s*```$/, ''));
        if (!Array.isArray(parsed)) {
          throw new Error('Explanation model returned JSON that was not an array.');
        }

        // Match by echoed id; anything unmatched is resolved by position as a
        // fallback, because a batch that came back is worth keeping even if the
        // model renumbered it.
        const byId = new Map<string, any>();
        parsed.forEach((entry: any) => {
          if (entry && typeof entry.id === 'string') byId.set(entry.id.trim(), entry);
        });

        batch.forEach(({ index, id }, positionInBatch) => {
          const entry = byId.get(id) ?? parsed[positionInBatch];
          const { explanation, canExplain, reviewNote } = normaliseExplanation(entry);
          if (canExplain) {
            results.push({ index, explanation, needs_review: false });
          } else {
            results.push({ index, explanation: '', needs_review: true, review_note: reviewNote });
          }
        });

        batchDone = true;
        consecutiveQuotaFailures = 0;
      } catch (err: any) {
        const quota = isQuotaError(err);
        const retryable = isRetryable(err);
        const detail = `HTTP ${err?.status ?? err?.code ?? '?'} — ${err?.message || err}`;

        if (retryable && attempt < MAX_ATTEMPTS_PER_BATCH) {
          // 429 waits longer than a generic hiccup: it is the provider telling us
          // to slow down, and retrying immediately is what made this worse before.
          const waitMs = (quota ? 5000 : 2000) * attempt + Math.floor(Math.random() * 500);
          progress(`Batch ${b + 1}/${batches.length} transient error (${detail}). Retrying in ${waitMs}ms.`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          continue;
        }

        console.error(`[PDF Import] Explanation batch ${b + 1}/${batches.length} failed — ${detail}`);

        if (quota) {
          consecutiveQuotaFailures += 1;
          if (consecutiveQuotaFailures >= CONSECUTIVE_QUOTA_FAILURES_BEFORE_STOP) {
            stopped = true;
            stats.stoppedEarly = true;
            stats.stopReason =
              'AI explanation service is rate limited or out of quota — remaining questions were kept and marked for review.';
            console.warn(`[PDF Import] ${stats.stopReason}`);
          }
        }

        batch.forEach(({ index }) => {
          results.push({
            index,
            explanation: '',
            needs_review: true,
            review_note: quota
              ? 'Explanation skipped — the AI service reported a quota/rate limit. Try again later.'
              : `Explanation request failed (${detail}).`,
          });
        });
        // Terminal for THIS batch: stop retrying it. Without this the non-retryable
        // path would fall through to the next attempt and push a second result for
        // the same question, so the caller would receive more results than it sent.
        break;
      }
    }

    if (b < batches.length - 1 && !stopped) {
      await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
    }
  }

  // Sort back into the caller's order so index-joining is unambiguous.
  results.sort((x, y) => x.index - y.index);
  stats.generated = results.filter((r) => !r.needs_review && r.explanation).length;
  stats.needsReview = results.filter((r) => r.needs_review).length;
  return { results, stats };
}
