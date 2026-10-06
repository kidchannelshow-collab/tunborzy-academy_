-- ============================================================================
-- 0058 — MAINTENANCE MODE GOES LIVE
-- ============================================================================
--
-- WHY THIS IS NEEDED
--
-- `platform_settings` (0047) is the source of truth for maintenance mode, and
-- both gates read it: App.tsx before it renders any route, and the
-- `maintenanceGuard` middleware in server.ts before it serves any /api route.
-- Two things were missing for that setting to be complete.
--
--   1. THE TABLE IS NOT PUBLISHED FOR REALTIME.
--
--      src/lib/platformSettings.ts fetches the settings once and caches them for
--      the life of the tab. Nothing told an already-open tab that the value had
--      changed, so a student sitting on a dashboard kept working straight
--      through an admin switching maintenance mode on — the gate was only as
--      live as its cached copy. Migration 0051 (section 11.2) deliberately
--      deferred realtime publication membership; this closes it for the one
--      table that needs it.
--
--      The only other tables in the publication are notifications (0002) and
--      user_study_logs + cbt_results (0048). `platform_settings` holds six rows
--      that change approximately never, so the write volume this adds to the WAL
--      is nil.
--
--   2. THE SERVER GUARD READS THE ROW AS `anon`, WHICH 0056 MAKES POSSIBLE.
--
--      `isMaintenanceModeOn` in server.ts reads with the shared anon client
--      because it has to run BEFORE the caller is authenticated — a signed-out
--      visitor is exactly who needs to be stopped. That read only returns a row
--      because migration 0056 grants anon SELECT on the `general` category. If
--      0056 was never applied to this database, the guard would read zero rows,
--      silently conclude "not in maintenance", and never fire. Whether 0056 has
--      been applied is not knowable from the frontend, so the policy is
--      restated here rather than assumed — the same defensive pattern 0057 used.
--
-- WHAT THIS DOES
--
--   * Restates the 0056 SELECT policy for the `general` category. Additive: it
--     drops no policy and relaxes none. academic, cbt, premium, partnership,
--     notification and features stay readable only by signed-in users.
--   * Adds `platform_settings` to the supabase_realtime publication, but only
--     when it is not already a member.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
--   * No new table. `platform_settings` already carries maintenance mode.
--   * No new column, no data UPDATE, no DELETE. Every existing row and value is
--     left exactly as it is.
--   * No REPLICA IDENTITY change. The client reacts to any change by re-reading
--     the row rather than by applying the payload, so the default identity is
--     enough and the extra WAL volume of FULL would buy nothing.
--   * No change to who may WRITE. Maintenance mode stays admin-only: the 0047
--     FOR ALL policy requires profiles.role = 'Admin', and the API route behind
--     it is guarded by requireAdmin. Realtime publication grants no write access
--     at all — it only delivers change events that RLS already permits the
--     subscriber to see.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Guarantee the public read of the `general` row (restates 0056).
--
-- Scoped to `category = 'general'` exactly as 0056 defines it. That category
-- holds only public-facing values — platform name, description, support email,
-- support phone and the maintenance flag — every one of which is already shown
-- to visitors on the public site.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can read general platform settings" ON public.platform_settings;

CREATE POLICY "Public can read general platform settings"
ON public.platform_settings
FOR SELECT
TO anon, authenticated
USING (category = 'general');

-- ---------------------------------------------------------------------------
-- 2. Publish the table for Realtime — only if it is not published already.
--
-- ALTER PUBLICATION ... ADD TABLE raises "relation is already member of
-- publication" if repeated, so membership is checked first rather than relying
-- on an exception handler. pg_publication_tables is the authoritative view and
-- already accounts for tables added outside a migration file.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'platform_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.platform_settings;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- VERIFY (run separately; not part of the migration body)
--
--   SELECT tablename
--   FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime'
--     AND tablename = 'platform_settings';
--
--   Expect one row: platform_settings. Zero rows means the publication did not
--   take, and the frontend will silently fall back to reload-only updates.
-- ---------------------------------------------------------------------------
