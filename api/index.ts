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
 *
 * WHY THERE IS A package.json NEXT TO THIS FILE
 *
 * The repository root declares `"type": "module"`. Node decides how to parse a
 * `.js` file from the NEAREST package.json, so a CommonJS function bundle
 * emitted with a `.js` extension was being parsed as an ES module — which throws
 * `module is not defined in ES module scope` while the module is still being
 * evaluated, before any handler runs. On Vercel that surfaces as an opaque
 * FUNCTION_INVOCATION_FAILED on every route, including /api/health, and no
 * try/catch inside the function can intercept it.
 *
 * The sibling `api/package.json` declares `"type": "commonjs"`, which pins the
 * parse mode for this directory only. It cannot affect the Vite build, Tailwind,
 * or server.ts, none of which live here.
 */
import { createVercelHandler } from '../vercelAdapter.js';

export default createVercelHandler();
