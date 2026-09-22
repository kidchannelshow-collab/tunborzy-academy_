/**
 * Vercel entrypoint for the existing Express application.
 *
 * This file defines NO routes. It hands Vercel a handler that delegates to the
 * one app built in `server.ts` — the same app `npm run dev` serves on
 * localhost:3000. Adding a route means adding it to server.ts, exactly as before.
 *
 * See `vercelAdapter.ts` for why the backend is loaded lazily.
 *
 * Vercel maps `api/index.ts` to `/api`.
 */
import { createVercelHandler } from '../vercelAdapter';

export default createVercelHandler();
