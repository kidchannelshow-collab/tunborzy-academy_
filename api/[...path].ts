/**
 * Vercel catch-all entrypoint for the existing Express application.
 *
 * Vercel maps `api/index.ts` to `/api` only — it does not, on its own, send
 * `/api/cbt/start` or `/api/utme/submit` anywhere. This catch-all file is what
 * covers every path BELOW /api, and it is the reason those routes reach Express
 * in production exactly as they do on localhost.
 *
 * Like api/index.ts it defines NO routes; it hands Vercel the same handler, which
 * delegates to the single app in `server.ts`. Express performs all of its own
 * routing off the original request URL, so no path rewriting is involved and no
 * route is duplicated.
 */
import { createVercelHandler } from '../vercelAdapter';

export default createVercelHandler();
