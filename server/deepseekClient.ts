/**
 * DeepSeek chat client — the platform's hosted model provider.
 *
 * WHY THE OFFICIAL `openai` SDK
 *
 * DeepSeek is OpenAI-compatible: same `/chat/completions` endpoint, same request
 * and response shapes. Rather than hand-rolling those two POSTs, this goes
 * through the official `openai` package pointed at DeepSeek's base URL. The SDK
 * owns the wire format, retry/backoff primitives, SSE framing for streaming, and
 * the typed request surface, so a change on the provider side is absorbed by a
 * dependency upgrade instead of by this file.
 *
 * `maxRetries` is forced to 0. The SDK retries by default, and every caller here
 * already runs its own bounded retry with its own quota/circuit-breaker logic
 * (see explanationGenerator.ts). Leaving the SDK's retries on would multiply
 * request counts and defeat those breakers.
 *
 * WHAT DEEPSEEK DOES AND DOES NOT DO
 *
 * It is chat-completions only. There is no embeddings endpoint, unlike the
 * provider this replaced. That is not a gap here: the AI search this platform
 * runs is Postgres full-text search (`search_undergraduate_materials_fts`), not
 * vector search, so nothing in the codebase needed embeddings. If vector search
 * is ever added, it needs a different provider — DeepSeek cannot serve it.
 *
 * JSON MODE. `response_format: { type: 'json_object' }` is DeepSeek's equivalent
 * of a structured-output mode, but it does NOT take a schema the way the previous
 * provider's `responseSchema` did. The schema therefore travels in the prompt as
 * an instruction, and the reply is parsed and validated by the caller — which is
 * what the callers already did for every shape they use. DeepSeek also requires
 * the word "json" to appear in the messages when this mode is on, so it is
 * appended when a caller asks for JSON without mentioning it; that turns a
 * confusing 400 into a working request.
 *
 * IMPORTANT: json_object mode guarantees a JSON *object*, not an array. A caller
 * asking for a top-level array must therefore tolerate the array arriving under
 * an object key, and must parse defensively. See `parseJsonLoose` below and its
 * use in explanationGenerator.ts.
 *
 * MODELS ARE ENV-CONFIGURED, exactly as before, so the model can be changed
 * without a rebuild — the running process reports which one is in use on
 * /api/health.
 */

import OpenAI from 'openai';

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/**
 * The single model identifier used when `DEEPSEEK_MODEL` is not set.
 *
 * `deepseek-flash` is DeepSeek-V4.1-Flash: the current general-purpose model,
 * 1M-token context, and the fastest of the models the API serves. The previous
 * default, `deepseek-chat`, has been RETIRED by the provider — requests naming
 * it now fail with 400 "Model Not Exist", so this default is load-bearing, not
 * cosmetic. `deepseek-v4-pro` is the alternative (thinking mode, slower, billed
 * for reasoning tokens) and none of these tasks — extraction, classification,
 * keying, short explanations — need it.
 *
 * Verified against `GET https://api.deepseek.com/models`, which lists exactly
 * `deepseek-flash` and `deepseek-v4-pro`.
 */
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-flash';

/** Base URL with any trailing slash removed, so path joining is unambiguous. */
export function deepseekBaseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL || DEFAULT_DEEPSEEK_BASE_URL).trim().replace(/\/+$/, '');
}

/** The configured model, or the default. Never empty. */
export function deepseekModel(): string {
  return (process.env.DEEPSEEK_MODEL || '').trim() || DEFAULT_DEEPSEEK_MODEL;
}

/** The key, or null when it is absent/blank. */
export function getDeepSeekApiKey(): string | null {
  const key = (process.env.DEEPSEEK_API_KEY || '').trim();
  return key.length > 0 ? key : null;
}

export function isDeepSeekConfigured(): boolean {
  return getDeepSeekApiKey() !== null;
}

/**
 * How long one completion may take before it is abandoned.
 *
 * Generous because a PDF chunk can be thousands of tokens and a cold model can
 * be slow to first token; bounded because a wedged request must not hold an
 * import open forever.
 */
const REQUEST_TIMEOUT_MS = 180_000;

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeepSeekChatOptions {
  /** The single user turn. Ignored when `messages` is supplied. */
  prompt?: string;
  /** Optional system turn, prepended when present. */
  system?: string;
  /**
   * A full conversation, for multi-turn callers (the AI tutor). When present it
   * is used verbatim and `prompt`/`system` are ignored — the caller has already
   * assembled the history and the system turn.
   */
  messages?: DeepSeekMessage[];
  temperature?: number;
  /** Ask for `json_object` mode. See the note above about the schema. */
  json?: boolean;
  /**
   * Cap on generated tokens. Left unset by default ON PURPOSE: the tutor streams
   * long answers and the summariser writes several sentences, so a global cap
   * would silently truncate them. Callers that want a short, bounded reply (the
   * explanation and answer-keying stages) pass this explicitly.
   *
   * SAFE ONLY BECAUSE THINKING IS OFF BY DEFAULT — see `thinking`. When thinking
   * is on, reasoning tokens are billed against this same budget, so a cap sized
   * for the visible answer starves the reasoning pass and the reply comes back
   * as an empty string with `finish_reason: "length"`.
   */
  maxTokens?: number;
  /**
   * DeepSeek's reasoning pass. OFF unless a caller opts in.
   *
   * `deepseek-flash` is a hybrid thinking model whose server-side default is
   * `effort: "high"` — every request pays for a chain of thought before the
   * answer, at several times the latency and token cost. Measured on a
   * multi-step arithmetic question: thinking on = 27 reasoning tokens / 2092 ms;
   * thinking disabled = 1 token / 815 ms, same correct answer.
   *
   * None of this platform's calls need it: extraction, classification, keying
   * and short explanations are mechanical. The tutor is the one caller that
   * could argue for it, and it streams to a user who is waiting — so the fast
   * path is the default and `thinking: true` is the opt-in.
   */
  thinking?: boolean;
  timeoutMs?: number;
}

/**
 * The SDK client, cached per (key, baseURL) pair.
 *
 * Rebuilt whenever either changes so a deployment can rotate its key or point at
 * a different endpoint without a restart, and so the client is never constructed
 * with an empty key at module load — which would throw at import time and take
 * the whole server down with it.
 */
let cachedClient: { key: string; baseURL: string; client: OpenAI } | null = null;

function getClient(): OpenAI {
  const apiKey = getDeepSeekApiKey();
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured.');

  const baseURL = deepseekBaseUrl();
  if (cachedClient && cachedClient.key === apiKey && cachedClient.baseURL === baseURL) {
    return cachedClient.client;
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
    // Callers own the retry policy; see the note at the top of this file.
    maxRetries: 0,
    timeout: REQUEST_TIMEOUT_MS,
  });

  cachedClient = { key: apiKey, baseURL, client };
  return client;
}

/** Build the message array, applying the json-mode "must mention json" rule. */
function buildMessages(options: DeepSeekChatOptions): OpenAI.Chat.ChatCompletionMessageParam[] {
  if (options.messages) {
    return options.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (options.system) messages.push({ role: 'system', content: options.system });

  let prompt = options.prompt ?? '';
  // DeepSeek rejects json_object mode unless the messages mention "json".
  if (options.json && !/json/i.test(prompt) && !/json/i.test(options.system || '')) {
    prompt = `${prompt}\n\nRespond with a single valid JSON object.`;
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
}

/**
 * Assemble the provider request body.
 *
 * Typed loosely on purpose: `thinking` is a DeepSeek extension and is not in the
 * OpenAI SDK's request type, so the object is built as an open record and cast
 * once at the call site rather than fought with through the SDK's generics.
 */
function buildRequestParams(options: DeepSeekChatOptions, stream: boolean): Record<string, any> {
  return {
    model: deepseekModel(),
    messages: buildMessages(options),
    temperature: options.temperature ?? 0.2,
    stream,
    ...(options.maxTokens ? { max_tokens: options.maxTokens } : {}),
    ...(options.json ? { response_format: { type: 'json_object' } } : {}),
    // Opt-in only: see the `thinking` note on DeepSeekChatOptions.
    ...(options.thinking === true ? {} : { thinking: { type: 'disabled' } }),
  };
}

/**
 * Re-shape an SDK/transport error into the contract the callers already rely on:
 * `err.status` when the provider answered with a non-2xx, and a message that
 * names the status so the string-matching predicates in explanationGenerator.ts
 * (which look for '429', 'quota', 'rate limit', …) keep working.
 *
 * Connection-level failures carry no status; they are labelled so the retry
 * predicate recognises them rather than treating a dead socket as terminal.
 */
function normaliseError(err: any): any {
  const status = typeof err?.status === 'number' ? err.status : undefined;
  const raw = String(err?.message || err || 'DeepSeek request failed');

  const wrapped: any = new Error(status !== undefined ? `DeepSeek HTTP ${status} — ${raw}` : raw);
  if (status !== undefined) wrapped.status = status;
  else if (/connection|fetch|socket|network|timed? ?out|abort/i.test(raw)) {
    wrapped.message = `${raw} (network failure)`;
  }
  // Preserve an explicit retryability flag set by this module (the empty-reply
  // guard below) so re-wrapping does not silently downgrade it to terminal.
  if (err?.retryable === true) wrapped.retryable = true;
  return wrapped;
}

/**
 * One non-streaming completion. Resolves with the assistant's raw text.
 *
 * Throws on a transport failure or a non-2xx response; the status is on
 * `err.status` so retry logic can tell a 429/5xx from a 400.
 */
export async function deepseekComplete(options: DeepSeekChatOptions): Promise<string> {
  const client = getClient();

  try {
    // The cast is confined here: `thinking` is a DeepSeek extension the OpenAI
    // SDK's request type does not model. See `buildRequestParams`.
    const completion: any = await client.chat.completions.create(
      buildRequestParams(options, false) as any,
      { timeout: options.timeoutMs ?? REQUEST_TIMEOUT_MS },
    );

    const choice = completion?.choices?.[0];
    const text = String(choice?.message?.content ?? '').trim();

    // An empty reply is never a usable answer for any caller in this codebase.
    // The usual cause is the token budget being consumed by a reasoning pass:
    // the provider returns `finish_reason: "length"` with no content, and a
    // caller could read that silence as "the model declined", turning a
    // configuration mistake into a bank full of unexplained questions. Raising
    // it as a retryable error makes the cause visible instead.
    if (!text && choice?.finish_reason === 'length') {
      const err: any = new Error(
        'DeepSeek returned an empty reply — the token limit was reached before any output. ' +
          'Reasoning tokens are billed against max_tokens; pass thinking:false (the default) to disable them.',
      );
      err.retryable = true;
      throw err;
    }

    return text;
  } catch (err) {
    throw normaliseError(err);
  }
}

/**
 * One streaming completion, yielded as text deltas.
 *
 * The SDK decodes the SSE frames and only yields complete deltas, which removes
 * the whole class of bug the previous hand-rolled reader existed to avoid (a
 * frame split across a TCP boundary being parsed half-formed).
 */
export async function* deepseekStream(options: DeepSeekChatOptions): AsyncGenerator<string> {
  const client = getClient();

  let stream: AsyncIterable<any>;
  try {
    stream = (await client.chat.completions.create(buildRequestParams(options, true) as any, {
      timeout: options.timeoutMs ?? REQUEST_TIMEOUT_MS,
    })) as unknown as AsyncIterable<any>;
  } catch (err) {
    throw normaliseError(err);
  }

  try {
    for await (const chunk of stream) {
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (delta) yield String(delta);
    }
  } catch (err) {
    throw normaliseError(err);
  }
}

/**
 * Parse a model reply that is *supposed* to be JSON, without ever throwing.
 *
 * Two provider realities make a bare `JSON.parse` unsafe:
 *
 *   1. json_object mode guarantees a JSON **object**, never a top-level array.
 *      A caller that asked for `[...]` gets `{"...":[...]}` — or, for a single
 *      item, occasionally the item unwrapped. Callers that expect an array must
 *      therefore accept either shape rather than reject the reply outright.
 *   2. Models wrap JSON in ```json fences, prepend prose, or (rarely) ignore
 *      json mode entirely and answer in plain text.
 *
 * Returns the parsed value, or null when nothing parseable was found — the
 * caller decides what a null means for its own stage. `preferredKey`, when
 * given, is tried first when unwrapping an object (e.g. 'answers').
 */
export function parseJsonLoose(raw: string, preferredKey?: string): any {
  const text = String(raw ?? '').trim();
  if (!text) return null;

  const candidates: string[] = [text];

  // Strip a ```json … ``` (or bare ```) fence if the whole reply is wrapped.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  // Last resort: the outermost {...} or [...] span, for a reply with prose
  // before or after the JSON.
  const span = text.match(/[[{][\s\S]*[\]}]/);
  if (span?.[0]) candidates.push(span[0]);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed !== null && parsed !== undefined) return parsed;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Pull an array out of whatever shape the model actually returned.
 *
 * Handles the plain array, the object wrapper json_object mode produces (trying
 * `preferredKey`, then any single array-valued property), and a lone object that
 * should have been a one-element array. Returns null when there is no array to
 * be found, so the caller can fail the batch rather than silently produce zero
 * results for it.
 */
export function coerceToArray(parsed: any, preferredKey?: string): any[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return null;

  if (preferredKey && Array.isArray((parsed as any)[preferredKey])) {
    return (parsed as any)[preferredKey];
  }

  const arrayValues = Object.values(parsed).filter(Array.isArray) as any[][];
  if (arrayValues.length > 0) return arrayValues[0];

  // A single object where an array was expected — wrap it rather than lose it.
  return [parsed];
}
