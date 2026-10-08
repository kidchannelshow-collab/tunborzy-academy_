/**
 * DeepSeek chat client — the platform's hosted model provider.
 *
 * WHY THIS IS PLAIN `fetch` AND NOT A SDK
 *
 * The previous provider was reached through `@google/genai`. Replacing it with
 * the `openai` package (DeepSeek is OpenAI-compatible) would have added a
 * dependency purely to wrap two POSTs. Node 22 has `fetch` globally, the request
 * shapes are short, and everything the app needs — chat, JSON mode, streaming —
 * is on one endpoint. A direct client also removes the failure mode where an SDK
 * upgrade changes response shapes underneath the parser.
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
 * MODELS ARE ENV-CONFIGURED, exactly as before, so the model can be changed
 * without a rebuild — the running process reports which one is in use on
 * /api/health.
 */

export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/**
 * The single model identifier used when `DEEPSEEK_MODEL` is not set.
 *
 * `deepseek-chat` is the general instruct model. `deepseek-reasoner` is available
 * for harder reasoning, but the reasoning tokens are billed and slow, and none of
 * these tasks (extraction, classification, summarisation) need them.
 */
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';

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
  maxTokens?: number;
  timeoutMs?: number;
}

function buildBody(options: DeepSeekChatOptions, stream: boolean) {
  const messages: DeepSeekMessage[] = [];

  if (options.messages) {
    messages.push(...options.messages);
  } else {
    if (options.system) messages.push({ role: 'system', content: options.system });

    let prompt = options.prompt ?? '';
    // DeepSeek rejects json_object mode unless the messages mention "json".
    if (options.json && !/json/i.test(prompt) && !/json/i.test(options.system || '')) {
      prompt = `${prompt}\n\nRespond with a single valid JSON object.`;
    }
    messages.push({ role: 'user', content: prompt });
  }

  const body: Record<string, any> = {
    model: deepseekModel(),
    messages,
    temperature: options.temperature ?? 0.2,
    stream,
  };
  if (options.json) body.response_format = { type: 'json_object' };
  if (options.maxTokens) body.max_tokens = options.maxTokens;
  return body;
}

/** Attach the HTTP status so callers can distinguish retryable from terminal. */
function httpError(status: number, bodyText: string): Error {
  const err: any = new Error(`DeepSeek HTTP ${status} — ${bodyText.slice(0, 300) || 'no body'}`);
  err.status = status;
  return err;
}

/**
 * One non-streaming completion. Resolves with the assistant's raw text.
 *
 * Throws on a transport failure or a non-2xx response; the status is on
 * `err.status` so retry logic can tell a 429/5xx from a 400.
 */
export async function deepseekComplete(options: DeepSeekChatOptions): Promise<string> {
  const apiKey = getDeepSeekApiKey();
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured.');

  const res = await fetch(`${deepseekBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    body: JSON.stringify(buildBody(options, false)),
  });

  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));

  const data: any = await res.json();
  return String(data?.choices?.[0]?.message?.content ?? '').trim();
}

/**
 * One streaming completion, yielded as text deltas.
 *
 * DeepSeek streams Server-Sent Events: `data: {...}` lines terminated by
 * `data: [DONE]`. Frames can be split across TCP chunks, so the buffer is only
 * drained on newlines and the trailing partial line is carried forward — parsing
 * per-chunk instead would drop or corrupt the frame that straddles a boundary.
 */
export async function* deepseekStream(options: DeepSeekChatOptions): AsyncGenerator<string> {
  const apiKey = getDeepSeekApiKey();
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not configured.');

  const res = await fetch(`${deepseekBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    body: JSON.stringify(buildBody(options, true)),
  });

  if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));
  if (!res.body) throw new Error('DeepSeek returned no response body to stream.');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;

        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        if (!payload) continue;

        try {
          const frame = JSON.parse(payload);
          const delta = frame?.choices?.[0]?.delta?.content;
          if (delta) yield String(delta);
        } catch {
          // A keep-alive or a frame we cannot parse is skipped rather than
          // aborting the stream — the alternative is losing an answer that the
          // model has already produced.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
