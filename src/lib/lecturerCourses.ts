import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useProfile } from './useProfile';

/**
 * The courses a lecturer is assigned to, and the portals those courses imply.
 *
 * THE ONE SOURCE OF TRUTH
 *
 * `courses.lecturer_id` is authoritative. `profiles.assigned_courses` — the
 * free-text course-code list written by Admin → Lecturer Management — is a
 * separate, disconnected field that nothing in the lecturer dashboard reads and
 * which the whole platform ignores for access decisions. It is deliberately not
 * consulted here: two sources of truth for "which courses is this lecturer on"
 * is exactly the bug class this module exists to avoid. Admin's Course
 * Management already writes `courses.lecturer_id`, and that path keeps working.
 *
 * UNDERGRADUATE IS NOT OFFERED
 *
 * A lecturer may be assigned UTME courses, Post-UTME courses, or both.
 * Undergraduate courses are filtered out here rather than at each call site, so
 * a lecturer cannot reach Undergraduate courses or materials through any
 * lecturer surface. When Undergraduate lecturer support is built, it is added by
 * widening LECTURER_PORTALS — one line, one place.
 *
 * The portal is read from `courses.portal`, the column Admin's Course Management
 * already writes and the value AdminPdfUploader and the material uploader
 * already branch on.
 */
export const LECTURER_PORTALS = ['UTME', 'Post-UTME'] as const;

export type LecturerPortal = (typeof LECTURER_PORTALS)[number];

export interface LecturerCourse {
  id: string;
  title: string;
  course_code: string;
  portal: string;
  semester?: string | null;
}

/** True when a stored `courses.portal` value is one a lecturer may hold. */
export function isLecturerPortal(value: unknown): value is LecturerPortal {
  return typeof value === 'string' && (LECTURER_PORTALS as readonly string[]).includes(value.trim());
}

/**
 * Every portal an administrator may assign a course from.
 *
 * Deliberately wider than LECTURER_PORTALS: Admin assigns Undergraduate courses
 * too, they simply are not offered to the lecturer dashboard. Keeping the two
 * lists separate stops "what can be assigned" and "what a lecturer may reach"
 * from being conflated.
 */
export const ASSIGNABLE_PORTALS = ['UTME', 'Post-UTME', 'Undergraduate'] as const;

export interface AssignableCourse {
  id: string;
  title: string;
  course_code: string;
  portal: string;
  /** Currently owned by a lecturer — selecting it will reassign it. */
  takenByAnotherLecturer: boolean;
}

/**
 * The courses an administrator can pick from, for the assignment UI.
 *
 * Replaces the free-text course-code box, which required the admin to remember
 * codes, silently accepted typos, and — because it only wrote
 * `profiles.assigned_courses` — did not actually assign anything.
 */
export async function loadAssignableCourses(): Promise<AssignableCourse[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('courses')
    .select('id, title, course_code, portal, lecturer_id')
    .order('course_code', { ascending: true });

  if (error) throw error;

  return (data || []).map((course: any) => ({
    id: course.id,
    title: course.title || course.course_code || 'Untitled course',
    course_code: course.course_code || '',
    portal: course.portal || 'Unassigned',
    takenByAnotherLecturer: !!course.lecturer_id,
  }));
}

/**
 * Make `courses.lecturer_id` match an administrator's selection.
 *
 * `courses.lecturer_id` is the authoritative assignment; nothing here writes
 * `profiles.assigned_courses`, which stays a display mirror only.
 *
 * Two writes, and the second is the one that is easy to forget: a course that
 * was DESELECTED has to be released, or the lecturer keeps access to it forever
 * because nothing else would ever clear the column. The release is additionally
 * scoped to `lecturer_id = thisLecturer`, so a course that changed hands in
 * another tab between load and save is never clobbered.
 */
export async function assignCoursesToLecturer(
  lecturerId: string,
  selectedCourseIds: string[],
  previouslyAssignedCourseIds: string[] = []
): Promise<void> {
  if (!supabase) throw new Error('Supabase client is not initialized');

  const selected = Array.from(new Set(selectedCourseIds.filter(Boolean)));
  const previous = Array.from(new Set(previouslyAssignedCourseIds.filter(Boolean)));

  if (selected.length > 0) {
    const { error } = await supabase
      .from('courses')
      .update({ lecturer_id: lecturerId })
      .in('id', selected);
    if (error) throw error;
  }

  const released = previous.filter((id) => !selected.includes(id));
  if (released.length > 0) {
    const { error } = await supabase
      .from('courses')
      .update({ lecturer_id: null })
      .in('id', released)
      .eq('lecturer_id', lecturerId);
    if (error) throw error;
  }
}

/** The ids of courses currently owned by a lecturer. */
export async function loadAssignedCourseIds(lecturerId: string): Promise<string[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('courses').select('id').eq('lecturer_id', lecturerId);
  if (error) throw error;
  return (data || []).map((c: any) => c.id);
}

export interface LecturerCoursesState {
  /** The lecturer's own UTME / Post-UTME courses. Never Undergraduate. */
  courses: LecturerCourse[];
  /** The portals the lecturer actually has courses in. */
  portals: LecturerPortal[];
  hasUtme: boolean;
  hasPostUtme: boolean;
  loading: boolean;
  /** True until the profile AND the course list have both resolved. */
  ready: boolean;
  reload: () => Promise<void>;
}

/**
 * Read the signed-in lecturer's assignments.
 *
 * The profile gate matters: the previous UploadCenter queried with `[]`
 * dependencies, so it ran once while `profile` was still null and permanently
 * rendered an empty list. Nothing here queries until the profile id exists.
 */
export function useLecturerCourses(): LecturerCoursesState {
  const { profile, loading: profileLoading } = useProfile();
  const [courses, setCourses] = useState<LecturerCourse[]>([]);
  const [loading, setLoading] = useState(true);

  const lecturerId = profile?.id as string | undefined;

  const reload = useCallback(async () => {
    if (!supabase || !lecturerId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('courses')
        .select('id, title, course_code, portal, semester')
        .eq('lecturer_id', lecturerId)
        .order('course_code', { ascending: true });

      if (error) throw error;

      setCourses(
        (data || []).filter((course: any) => isLecturerPortal(course?.portal)) as LecturerCourse[]
      );
    } catch (err) {
      console.error('[lecturerCourses] failed to load assigned courses:', err);
      setCourses([]);
    } finally {
      setLoading(false);
    }
  }, [lecturerId]);

  useEffect(() => {
    if (profileLoading) return;
    if (!lecturerId) {
      setCourses([]);
      setLoading(false);
      return;
    }
    void reload();
  }, [profileLoading, lecturerId, reload]);

  /**
   * Live assignment changes.
   *
   * When an administrator assigns or removes one of this lecturer's courses, the
   * row's `lecturer_id` changes — so the filtered subscription below fires and
   * the whole dashboard follows: the navigation re-derives which portal managers
   * are offered, and Course Settings re-lists. Without this the lecturer would
   * have to reload to discover they had been given a course.
   *
   * Filtered by `lecturer_id` rather than subscribing to the whole table: a
   * lecturer only cares about rows that are, or were, theirs. REMOVE arrives
   * because the row still matched the filter before the update.
   */
  useEffect(() => {
    if (!supabase || !lecturerId) return;

    const channel = supabase
      .channel(`lecturer_courses_${lecturerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'courses', filter: `lecturer_id=eq.${lecturerId}` },
        () => { void reload(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [lecturerId, reload]);

  const portals = useMemo(() => {
    const seen = new Set<LecturerPortal>();
    for (const course of courses) {
      if (isLecturerPortal(course.portal)) seen.add(course.portal);
    }
    return LECTURER_PORTALS.filter((portal) => seen.has(portal));
  }, [courses]);

  return {
    courses,
    portals,
    hasUtme: portals.includes('UTME'),
    hasPostUtme: portals.includes('Post-UTME'),
    loading,
    ready: !profileLoading && !loading,
    reload,
  };
}
