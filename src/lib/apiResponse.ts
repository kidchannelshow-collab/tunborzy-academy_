/**
 * Read a JSON body from an `/api` response — or fail with a message that says
 * what actually happened.
 *
 * WHY THIS EXISTS
 *
 * In production the backend is reached through a serverless function. When that
 * function fails, the platform answers with its OWN error page — plain text or
 * HTML — instead of our JSON. A bare `await res.json()` against such a response
 * throws a JSON *syntax* error, so the UI ends up reporting something like
 * "Unexpected token '<'": a message about the parser that hides both the real
 * status code and the server's own explanation.
 *
 * That is exactly what happened when the deployed function began failing at
 * module load. Every API-backed screen reported a parse error or a generic
 * "failed to fetch", and the actual cause — an HTTP 500 from the platform — was
 * nowhere in the message.
 *
 * This helper checks the content type first, so a non-JSON response produces an
 * error that names the status and quotes the server's reply. A genuinely broken
 * backend then reads as a broken backend rather than as a bug in the caller.
 */

/** Longest slice of a non-JSON body to include in the error message. */
const SNIPPET_LIMIT = 140;

export async function readApiJson<T = any>(res: Response): Promise<T> {
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    // A JSON content-type with an empty body still throws, and this is reachable
    // (a 204, or a proxy stripping the body), so the failure is translated rather
    // than left as a raw SyntaxError.
    try {
      return (await res.json()) as T;
    } catch {
      throw new Error(`The backend returned malformed JSON (HTTP ${res.status}).`);
    }
  }

  let snippet = '';
  try {
    snippet = (await res.text()).replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LIMIT);
  } catch {
    // Body already consumed or unreadable — the status alone still tells the story.
  }

  throw new Error(
    `The backend did not return JSON (HTTP ${res.status}).` +
      (snippet ? ` The server said: "${snippet}"` : '')
  );
}

/**
 * Resolve an API response to its payload, preferring the server's own error
 * message when the request failed.
 *
 * Use where a handler returns `{ error: "..." }` on failure — this surfaces that
 * message instead of a generic fallback, while still producing a useful error
 * when the response was not JSON at all.
 */
export async function readApiJsonOrThrow<T = any>(res: Response, fallback: string): Promise<T> {
  const data = await readApiJson<T & { error?: string }>(res).catch((err: Error) => {
    if (res.ok) throw err;
    throw new Error(`${fallback} (${err.message})`);
  });

  if (!res.ok) {
    throw new Error((data as any)?.error || fallback);
  }
  return data as T;
}
