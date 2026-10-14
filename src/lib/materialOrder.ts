import { supabase } from '../supabaseClient';

/**
 * Order indices for the academic hierarchy.
 *
 * THE BUG THIS EXISTS TO PREVENT
 *
 * Every `order_index` column in this database — `materials`, `courses`,
 * `course_modules`, `utme_subjects`, `post_utme_universities` — is a plain
 * PostgreSQL `integer` (see migration 0021_add_order_index.sql, which declares
 * `order_index integer DEFAULT 0`). That is a **32-bit signed** type with a
 * ceiling of 2,147,483,647.
 *
 * `Date.now()` is milliseconds since the epoch — about 1,791,931,546,168 today,
 * roughly 834× too large. So `order_index: Date.now()` did not merely sort
 * strangely: the insert was rejected outright with
 *
 *     value "1791931546168" is out of range for type integer
 *
 * and the lesson or material was never written at all. Two call sites did this
 * (the lesson editor and the material upload modal), which is why "saving a new
 * lesson" could fail while saving an existing one worked — the overflow only
 * happens on INSERT.
 *
 * THE FIX
 *
 * Never derive an order index from a clock. Ask the table what the highest
 * index in this scope already is and take the next one, which is both
 * type-safe and what the ordering actually means. `nextOrderIndex` is also the
 * place the 32-bit ceiling is enforced, so a table that has genuinely reached
 * INT_MAX cannot overflow either: a caller that hits the ceiling gets a clamped,
 * still-valid integer rather than a failed write.
 */

/** PostgreSQL `integer` upper bound. */
export const PG_INT_MAX = 2147483647;

/**
 * Coerce anything into a valid `order_index` value.
 *
 * Anything absent, non-numeric, non-finite, negative or above INT_MAX is
 * clamped into range. A value that is already valid is passed through
 * untouched, so rows that were written correctly keep their exact ordering.
 *
 * `null` is tested for explicitly rather than left to `Number()`: `Number(null)`
 * is `0`, so a row whose `order_index` was never set would otherwise read as a
 * legitimate index 0 and drag every subsequent child to 1.
 */
export function safeOrderIndex(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const truncated = Math.trunc(n);
  if (truncated < 0) return 0;
  if (truncated > PG_INT_MAX) return PG_INT_MAX;
  return truncated;
}

/**
 * The next free order index within one already-filtered scope.
 *
 * `query` is a Supabase builder with its `.select('order_index')` and its scope
 * filters already applied (one topic's materials, one course's modules, …). It
 * is typed loosely because the builder's generic type is not nameable across
 * the different tables this serves.
 *
 * Returns 0 when the scope is empty, so the first child sorts first.
 */
async function readNextOrderIndex(query: any): Promise<number> {
  const { data, error } = await query
    .order('order_index', { ascending: false, nullsFirst: false })
    .limit(1);

  // A failed lookup must not sink the write. Falling back to 0 puts the new row
  // among its siblings rather than aborting the save; the author can reorder it.
  if (error) {
    console.warn('[materialOrder] could not read the current order index:', error.message);
    return 0;
  }

  const highest = Array.isArray(data) && data.length > 0 ? safeOrderIndex(data[0]?.order_index, -1) : -1;
  if (highest < 0) return 0;
  return Math.min(highest + 1, PG_INT_MAX);
}

/** Next order index for a material within one course + topic. */
export async function nextMaterialOrderIndex(
  courseCode: string,
  topic: string | null | undefined,
): Promise<number> {
  if (!supabase) return 0;
  let query: any = supabase.from('materials').select('order_index').eq('course_code', courseCode);
  // `topic` is nullable. Filtering `.eq('topic', null)` matches nothing in
  // PostgREST, which would hand every untopic'd material index 0 forever, so
  // the null case is expressed as `.is()`.
  query = topic ? query.eq('topic', topic) : query.is('topic', null);
  return readNextOrderIndex(query);
}

/** Next order index for a topic (`course_modules` row) within one course. */
export async function nextCourseModuleOrderIndex(courseId: string): Promise<number> {
  if (!supabase) return 0;
  return readNextOrderIndex(supabase.from('course_modules').select('order_index').eq('course_id', courseId));
}

/**
 * Next order index for a course within its programme + semester.
 *
 * Used by the lecturer's course creation, which previously left `order_index`
 * to the column default and therefore sorted every new course together.
 */
export async function nextCourseOrderIndex(portal: string, semester?: string | null): Promise<number> {
  if (!supabase) return 0;
  let query: any = supabase.from('courses').select('order_index').eq('portal', portal);
  query = semester ? query.eq('semester', semester) : query.is('semester', null);
  return readNextOrderIndex(query);
}
