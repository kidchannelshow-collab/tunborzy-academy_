import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';

/**
 * Platform settings — the single source of truth for platform-wide configuration.
 *
 * `platform_settings` (migration 0047) stores one row per category with a JSONB
 * `settings` blob. Three categories are read here:
 *
 *   general   platform identity + the maintenance flag (App.tsx gate, Navbar,
 *             Footer, MaintenanceScreen, document title)
 *   academic  the active academic session and the single active semester
 *   cbt       the per-portal session flags and the shared exam defaults
 *
 * This module is a tiny shared store rather than a hook that fetches on its own:
 * the maintenance gate, the Navbar, the Footer and every CBT entry point need
 * the same values, and without a shared cache each would issue its own query on
 * every mount. One request is fetched, cached, and handed to every consumer.
 *
 * ONE REQUEST, NOT THREE. The query selects every readable row and sorts them
 * into categories client-side. That works for both audiences without branching:
 * migration 0056 lets a signed-OUT visitor read the `general` row (so the
 * maintenance screen can be shown on the public pages), while 0047 already lets
 * any signed-IN user read every category. An anon caller therefore receives one
 * row and simply keeps the academic/cbt defaults; an authenticated caller
 * receives all three.
 *
 * Fallbacks matter here: if a row is missing, the query fails, or a field is
 * blank, the platform must keep working with sensible defaults rather than
 * render an empty brand, an unlabelled semester or a crash.
 */

export interface GeneralSettings {
  platform_name: string;
  platform_description: string;
  support_email: string;
  support_phone: string;
  maintenance_mode: boolean;
}

/**
 * The two semesters the platform actually runs. Modelled as a single value
 * rather than a pair of booleans precisely so that "only one active semester at
 * a time" cannot be violated — there is no second field to leave switched on.
 */
export type Semester = 'First Semester' | 'Second Semester';

export const SEMESTERS: readonly Semester[] = ['First Semester', 'Second Semester'];

export interface AcademicSettings {
  current_academic_session: string;
  current_semester: Semester;
}

export interface CbtSettings {
  /** Undergraduate CBT — students may start course drills. */
  undergraduate_cbt_enabled: boolean;
  /** The UTME session: false means the session is closed to candidates. */
  utme_cbt_enabled: boolean;
  /** The Post-UTME session: false means the session is closed to candidates. */
  post_utme_cbt_enabled: boolean;
  /** Applied only where a caller does not supply its own duration. */
  default_exam_duration_mins: number;
  /** Applied only where a caller does not supply its own question count. */
  default_question_count: number;
}

export interface PlatformConfig {
  general: GeneralSettings;
  academic: AcademicSettings;
  cbt: CbtSettings;
}

/**
 * Used until (or unless) the database answers. These match the values seeded by
 * migrations 0047 and 0057 so a first paint never shows an empty shell.
 */
export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  platform_name: 'Tunborzy Academy',
  platform_description: 'Excellence in Academic and CBT Preparation',
  support_email: 'support@tunborzy.edu.ng',
  support_phone: '+234 800 000 0000',
  maintenance_mode: false,
};

export const DEFAULT_ACADEMIC_SETTINGS: AcademicSettings = {
  current_academic_session: '2026/2027',
  current_semester: 'First Semester',
};

export const DEFAULT_CBT_SETTINGS: CbtSettings = {
  undergraduate_cbt_enabled: true,
  utme_cbt_enabled: true,
  post_utme_cbt_enabled: true,
  default_exam_duration_mins: 30,
  default_question_count: 40,
};

export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  general: DEFAULT_GENERAL_SETTINGS,
  academic: DEFAULT_ACADEMIC_SETTINGS,
  cbt: DEFAULT_CBT_SETTINGS,
};

let cache: PlatformConfig = DEFAULT_PLATFORM_CONFIG;
let hasLoaded = false;
let inflight: Promise<PlatformConfig> | null = null;
const listeners = new Set<(config: PlatformConfig) => void>();

/**
 * The live-update channel, or null before it has been opened.
 *
 * Module-level like the cache itself, because there is exactly one settings
 * store for the whole tab and therefore exactly one channel. Consumers are the
 * maintenance gate, the Navbar, the Footer and the exam entry points; opening a
 * channel per consumer would open one per component mount.
 */
let realtimeChannel: any = null;

function emit() {
  for (const listener of listeners) listener(cache);
}

/**
 * Keep the shared store in step with the database without a page reload.
 *
 * WHY THIS IS NEEDED
 *
 * `loadPlatformConfig` fetches once and caches for the life of the tab. Without
 * this channel, an admin switching maintenance mode on would reach an
 * already-open student tab only on its next reload — the student would keep
 * working straight through the switch. The gate in App.tsx is only as live as
 * the value it reads.
 *
 * ONE CHANNEL, EVER
 *
 * The `realtimeChannel` guard makes this idempotent, so calling it from every
 * successful load cannot accumulate subscriptions. Started on the first load
 * rather than at module scope, so a build with no Supabase client (or a test
 * render) never opens a socket.
 *
 * `event: '*'` and an unread payload: any change to the row means "re-read the
 * truth", which covers INSERT (the first save of a category), UPDATE and DELETE
 * through one path instead of three. The reload is funnelled through
 * `refreshPlatformSettings`, so the cache is invalidated and every subscriber is
 * notified by the code path that already does exactly that — there is no second
 * state system.
 *
 * RLS applies to Realtime exactly as it does to a select, so a signed-out
 * visitor receives changes to the `general` row only (migration 0056) and a
 * signed-in user receives every category. That is the same visibility each
 * audience already has on a plain read, so nothing is widened.
 */
function startRealtimeSync() {
  if (!supabase || realtimeChannel) return;

  realtimeChannel = supabase
    .channel('platform_settings_live')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'platform_settings' },
      () => {
        void refreshPlatformSettings();
      }
    )
    .subscribe();
}

/**
 * Keep the browser tab in step with the configured platform name. index.html
 * ships a hardcoded <title>; without this the tab would keep advertising the
 * old name after a rename.
 */
function applyDocumentTitle(name: string) {
  if (typeof document !== 'undefined' && name) {
    document.title = name;
  }
}

/** Normalise a raw JSONB blob into a complete, correctly-typed settings object. */
function coerceGeneral(raw: any): GeneralSettings {
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    platform_name: String(value.platform_name ?? '').trim() || DEFAULT_GENERAL_SETTINGS.platform_name,
    platform_description: String(value.platform_description ?? '').trim(),
    support_email: String(value.support_email ?? '').trim() || DEFAULT_GENERAL_SETTINGS.support_email,
    // The seed in 0047 used the key `contact_phone`; the settings form uses
    // `support_phone`. Accept either so an older row is not silently ignored.
    support_phone:
      String(value.support_phone ?? value.contact_phone ?? '').trim() ||
      DEFAULT_GENERAL_SETTINGS.support_phone,
    maintenance_mode: value.maintenance_mode === true,
  };
}

function coerceAcademic(raw: any): AcademicSettings {
  const value = raw && typeof raw === 'object' ? raw : {};
  const session = String(value.current_academic_session ?? '').trim();
  // Anything that is not one of the two real semesters is discarded rather than
  // passed through: a semester value that matches no course would silently empty
  // every student-facing list.
  const semester = SEMESTERS.includes(value.current_semester)
    ? (value.current_semester as Semester)
    : DEFAULT_ACADEMIC_SETTINGS.current_semester;
  return {
    current_academic_session: session || DEFAULT_ACADEMIC_SETTINGS.current_academic_session,
    current_semester: semester,
  };
}

function coerceCbt(raw: any): CbtSettings {
  const value = raw && typeof raw === 'object' ? raw : {};
  const duration = Number(value.default_exam_duration_mins);
  const count = Number(value.default_question_count);
  return {
    // Absent means "not configured", which is open — never silently closed.
    undergraduate_cbt_enabled: value.undergraduate_cbt_enabled !== false,
    utme_cbt_enabled: value.utme_cbt_enabled !== false,
    post_utme_cbt_enabled: value.post_utme_cbt_enabled !== false,
    default_exam_duration_mins:
      Number.isFinite(duration) && duration > 0
        ? duration
        : DEFAULT_CBT_SETTINGS.default_exam_duration_mins,
    default_question_count:
      Number.isFinite(count) && count > 0 ? count : DEFAULT_CBT_SETTINGS.default_question_count,
  };
}

// ---------------------------------------------------------------------------
// Backwards-compatible general accessors (Navbar, Footer, MaintenanceScreen).
// ---------------------------------------------------------------------------

export function getCachedGeneralSettings(): GeneralSettings {
  return cache.general;
}

/** Fetches every readable settings row. Concurrent callers share one request. */
export function loadGeneralSettings(): Promise<GeneralSettings> {
  return loadPlatformConfig().then(() => cache.general);
}

export function subscribeGeneralSettings(listener: (settings: GeneralSettings) => void): () => void {
  return subscribePlatformConfig((config) => listener(config.general));
}

export function hasLoadedGeneralSettings(): boolean {
  return hasLoaded;
}

// ---------------------------------------------------------------------------
// Full platform config.
// ---------------------------------------------------------------------------

export function getCachedPlatformConfig(): PlatformConfig {
  return cache;
}

export function getCachedCbtSettings(): CbtSettings {
  return cache.cbt;
}

export function getCachedAcademicSettings(): AcademicSettings {
  return cache.academic;
}

/**
 * A failure is swallowed deliberately — these values drive branding, a
 * maintenance gate and exam availability, and a transient query error must not
 * blank the Navbar, lock the platform, or close every exam. The defaults are the
 * safe reading in each case (branded, not in maintenance, sessions open).
 */
export function loadPlatformConfig(): Promise<PlatformConfig> {
  if (inflight) return inflight;

  inflight = (async () => {
    if (!supabase) return cache;
    const { data, error } = await supabase.from('platform_settings').select('category, settings');

    if (!error && Array.isArray(data)) {
      const byCategory = new Map<string, any>();
      for (const row of data) {
        if (row && typeof row.category === 'string') byCategory.set(row.category, row.settings);
      }
      cache = {
        general: coerceGeneral(byCategory.get('general')),
        academic: coerceAcademic(byCategory.get('academic')),
        cbt: coerceCbt(byCategory.get('cbt')),
      };
      applyDocumentTitle(cache.general.platform_name);
    }
    hasLoaded = true;
    inflight = null;
    emit();
    // Started here rather than in a hook so it is opened by the first load and
    // then shared by every consumer, exactly like the cache above.
    startRealtimeSync();
    return cache;
  })();

  return inflight;
}

/** Called after an admin saves, so the change applies without a full reload. */
export function refreshPlatformSettings(): Promise<PlatformConfig> {
  inflight = null;
  return loadPlatformConfig();
}

export function refreshGeneralSettings(): Promise<GeneralSettings> {
  return refreshPlatformSettings().then((config) => config.general);
}

export function subscribePlatformConfig(listener: (config: PlatformConfig) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribe to the shared settings. Returns the cached values immediately when
 * they are already available, so consumers do not flicker on every mount.
 */
export function usePlatformConfig(): { config: PlatformConfig; loading: boolean } {
  const [config, setConfig] = useState<PlatformConfig>(cache);
  const [loading, setLoading] = useState(!hasLoaded);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribePlatformConfig((next) => {
      if (active) setConfig(next);
    });

    loadPlatformConfig().finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { config, loading };
}

export function useGeneralSettings(): { settings: GeneralSettings; loading: boolean } {
  const [settings, setSettings] = useState<GeneralSettings>(cache.general);
  const [loading, setLoading] = useState(!hasLoaded);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeGeneralSettings((next) => {
      if (active) setSettings(next);
    });

    loadPlatformConfig().finally(() => {
      if (active) setLoading(false);
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { settings, loading };
}
