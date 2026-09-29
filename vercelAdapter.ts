/**
 * Serverless adapter for the Express application in `server.ts`.
 *
 * WHY THIS EXISTS
 *
 * On Vercel the app is invoked as a function, and the platform owns the request
 * lifecycle. `server.ts` exports the finished Express app; this adapter is what
 * the `api/` entrypoints hand to the platform.
 *
 * WHAT IT ACTUALLY DOES
 *
 * It loads the backend LAZILY and reports a real error if that load fails.
 *
 * A serverless function that throws while its module is being evaluated never
 * gets to answer a request. The platform can only reply with a generic
 * "FUNCTION_INVOCATION_FAILED", which names neither the failing module nor the
 * reason — and it takes down every route at once, including `/api/health`,
 * which exists precisely so the backend can be checked. That is exactly what
 * happened in production, and diagnosing it from outside was not possible
 * because nothing was ever surfaced.
 *
 * Loading inside a try/catch turns that opaque crash into a specific, readable
 * JSON error naming the module and the cause. It is not a mock or a fallback:
 * when the backend loads, this adapter is a transparent pass-through with no
 * behaviour of its own, and a load failure is still a 500.
 *
 * The load is triggered on the first request rather than at module scope so the
 * error is captured per-invocation instead of aborting module evaluation.
 */

import type { IncomingMessage, ServerResponse } from 'http';

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => unknown;

let backend: NodeHandler | null = null;
let loadError: any = null;
let loading: Promise<void> | null = null;

function loadBackend(): Promise<void> {
  if (!loading) {
    loading = import('./server.js')
      .then((mod: any) => {
        // `server.ts` has both a default and a named `app` export; accept either
        // so a future change to the export shape cannot silently break this.
        backend = (mod?.default ?? mod?.app ?? mod) as NodeHandler;
      })
      .catch((error: any) => {
        loadError = error;
        console.error('[vercel-adapter] backend module failed to load:', error);
      });
  }
  return loading;
}

export function createVercelHandler(): NodeHandler {
  return async function handler(req: IncomingMessage, res: ServerResponse) {
    await loadBackend();

    if (loadError || !backend) {
      const error = loadError ?? new Error('Backend module resolved but exported no handler');
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Tunborzy-Backend', 'express-load-failed');
      res.end(
        JSON.stringify({
          error: 'Backend failed to load',
          name: error?.name ?? 'Error',
          message: error?.message ?? String(error),
          code: error?.code,
        })
      );
      return;
    }

    return backend(req, res);
  };
}
