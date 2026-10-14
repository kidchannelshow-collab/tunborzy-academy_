import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Plus, Edit2, Trash2, ChevronRight, X, Folder, Layers, FileText, Search, ArrowUp, ArrowDown, LayoutTemplate, Copy, AlertTriangle, RefreshCw, Archive, ArchiveRestore, Upload, Eye, EyeOff, GraduationCap, Target, Download } from 'lucide-react';
import ConfirmationModal from './ConfirmationModal';
import { supabase } from '../../supabaseClient';
import MaterialAdminDashboard from '../materials/MaterialAdminDashboard';
import LessonEditor from '../materials/LessonEditor';
import MaterialUploadModal from '../materials/MaterialUploadModal';
import BulkLessonModal from './BulkLessonModal';
import CourseTemplatesModal from './CourseTemplatesModal';

/**
 * Course Management — folder-style navigator over the existing schema.
 *
 * Programme depths (they are deliberately NOT uniform):
 *   UTME           Programme -> Subject -> CBT
 *   Post-UTME      Programme -> University -> Subject -> Topic -> Material
 *   Undergraduate  Programme -> Semester -> Subject -> Topic -> Material
 *
 * Schema mapping:
 *   courses        = subjects (portal + semester + university_id identify the folder)
 *   course_modules = persistent topics (course_id -> courses.id)
 *   materials      = the uploaded learning materials (linked by course_code + topic)
 *   post_utme_universities = the Post-UTME University level (migration 0054)
 *   tonborzy-content = the storage bucket holding the actual files
 *
 * Undergraduate and Post-UTME are the SAME tables read through a different
 * `courses.portal` value — only Post-UTME has the extra university level above
 * the subject. UTME is the one genuinely separate hierarchy.
 */

type ProgrammeId = 'UTME' | 'Post-UTME' | 'Undergraduate';

/**
 * Post-UTME universities are the only thing on this page that depends on
 * migration 0054, so their availability is tracked separately from the page's
 * own load state. Four states, deliberately not collapsed into a boolean:
 *
 *   'unknown'     — not attempted yet
 *   'available'   — the table exists, so an empty list is a genuinely empty list
 *   'unavailable' — migration 0054 has not been applied (PGRST205)
 *   'error'       — the table exists but the query failed for some other reason
 *
 * 'unavailable' and 'available with zero rows' must never render the same way.
 */
type PostUtmeHierarchyStatus = 'unknown' | 'available' | 'unavailable' | 'error';

/**
 * utme_subjects.order_index is added by migration 0054, so it cannot appear in
 * the ORDER BY of a core query — sorting server-side on a column that does not
 * exist yet fails the entire request with 42703 and would take the whole page
 * down with it. Sorting here instead yields order_index ordering once 0054 is
 * applied, and falls back to name order before then. `?? 0` makes a missing
 * column behave as the neutral default rather than as NaN.
 */
const sortUtmeSubjects = (subjects: any[]) =>
  [...subjects].sort((a, b) => {
    const oa = a?.order_index ?? 0;
    const ob = b?.order_index ?? 0;
    if (oa !== ob) return oa - ob;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });

interface ProgrammeDef {
  id: ProgrammeId;
  label: string;
  description: string;
  hasSemester: boolean;
  hasTopics: boolean;
  icon: any;
  accent: string;
}

// The three programmes are fixed product structure, not user data — so they are
// constants rather than rows. This is why there is no "Add Programme" button.
const PROGRAMMES: ProgrammeDef[] = [
  {
    id: 'UTME',
    label: 'UTME',
    description: 'Subjects and their CBT question banks.',
    hasSemester: false,
    hasTopics: false,
    icon: Target,
    accent: 'text-emerald-400',
  },
  {
    id: 'Post-UTME',
    label: 'Post-UTME',
    description: 'Universities, their subjects, topics and learning materials.',
    hasSemester: false,
    hasTopics: true,
    icon: BookOpen,
    accent: 'text-indigo-400',
  },
  {
    id: 'Undergraduate',
    label: 'Undergraduate',
    description: 'Semesters, subjects, topics and learning materials.',
    hasSemester: true,
    hasTopics: true,
    icon: GraduationCap,
    accent: 'text-orange-400',
  },
];

// Undergraduate semesters are fixed product structure. Any semester already
// present on a course row is unioned in so existing data is never orphaned.
const BASE_SEMESTERS = ['First Semester', 'Second Semester'];

interface Path {
  programme?: ProgrammeId;
  semester?: string;
  /**
   * Post-UTME only. `id: null` is a real state, not "unset" — it is the
   * "Shared" folder, holding subjects available across every university
   * (courses.university_id IS NULL). Only `university === undefined` means no
   * university level has been opened yet. The object itself is always truthy,
   * so `!path.university` still correctly tests "at the university list".
   */
  university?: { id: string | null; name: string; code?: string };
  course?: { id: string; course_code: string; title: string; is_archived?: boolean; university_id?: string | null };
  utmeSubject?: { id: string; name: string; code?: string };
  topic?: { id: string | null; title: string };
}

export default function CourseManagement({ onNavigate }: { onNavigate?: (view: string) => void }) {
  const [activeTab, setActiveTab] = useState<'courses' | 'content'>('courses');

  const [path, setPath] = useState<Path>({});

  // DB state
  const [courses, setCourses] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [utmeSubjects, setUtmeSubjects] = useState<any[]>([]);
  const [universities, setUniversities] = useState<any[]>([]);
  const [postUtmeHierarchyStatus, setPostUtmeHierarchyStatus] = useState<PostUtmeHierarchyStatus>('unknown');
  const [postUtmeHierarchyError, setPostUtmeHierarchyError] = useState<string | null>(null);

  // The feature is enabled only when the table genuinely exists. 'unknown' and
  // 'error' both leave it off, so we never offer controls we cannot honour.
  const postUtmeHierarchyAvailable = postUtmeHierarchyStatus === 'available';

  // Two further columns ship in 0054 but are NOT Post-UTME-specific:
  //   course_modules.is_archived   — Archive/Restore on any topic
  //   utme_subjects.order_index    — Reorder on UTME subjects
  // Both are written by actions whose failures route through the page-level
  // error card, which replaces the entire view. So the columns are probed once
  // and the affected controls withheld while they are absent, rather than being
  // offered and then blanking the page. Tracked separately from the Post-UTME
  // university table so the two concerns stay independent.
  const [schema0054ColumnsAvailable, setSchema0054ColumnsAvailable] = useState(false);
  const [utmeQuestionCounts, setUtmeQuestionCounts] = useState<Record<string, number>>({});
  const [utmeTopicCounts, setUtmeTopicCounts] = useState<Record<string, number>>({});
  const [lecturers, setLecturers] = useState<any[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');

  // Confirmation modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [actionTitle, setActionTitle] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [isIrreversible, setIsIrreversible] = useState(false);
  const [actionCallback, setActionCallback] = useState<(() => Promise<void>) | null>(null);

  // Form modal
  const [showFormModal, setShowFormModal] = useState(false);
  const [formType, setFormType] = useState<'course' | 'topic' | 'university'>('course');
  const [editingItem, setEditingItem] = useState<any>(null);
  const [nameInput, setNameInput] = useState('');
  const [courseInput, setCourseInput] = useState({
    title: '',
    course_code: '',
    // New subjects start as Draft, matching the previous behaviour — the admin
    // publishes explicitly rather than publishing by default.
    status: 'Draft',
    visibility: 'Public',
    lecturer_id: '',
  });
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Lesson editor / bulk / templates
  const [showLessonEditor, setShowLessonEditor] = useState(false);
  const [editingLesson, setEditingLesson] = useState<any>(null);
  const [showBulkLessonModal, setShowBulkLessonModal] = useState(false);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);
  const [templateCourseToSave, setTemplateCourseToSave] = useState<any>(null);

  // Material upload / edit
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<any>(null);

  useEffect(() => {
    fetchData();
    if (supabase) {
      const channel1 = supabase.channel('public:courses').on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, fetchData).subscribe();
      const channel2 = supabase.channel('public:materials').on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, fetchData).subscribe();
      const channel3 = supabase.channel('public:course_modules').on('postgres_changes', { event: '*', schema: 'public', table: 'course_modules' }, fetchData).subscribe();
      return () => {
        supabase.removeChannel(channel1);
        supabase.removeChannel(channel2);
        supabase.removeChannel(channel3);
      };
    }
  }, []);

  /**
   * PART A — core data. Every query here is satisfied by the schema as it
   * exists TODAY; none of it depends on migration 0054.
   *
   * Note the deliberate absence of `.order('order_index')` on utme_subjects:
   * that column is added by 0054, so ordering server-side would make the whole
   * page fail with 42703 until the migration is applied. The ordering is done
   * client-side in sortUtmeSubjects below instead, which is correct either way.
   */
  const fetchCoreData = async () => {
    if (!supabase) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [coursesRes, modulesRes, materialsRes, subjectsRes, questionsRes, topicsRes, lecturersRes] = await Promise.all([
        supabase.from('courses').select('*').order('order_index', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('course_modules').select('*').order('order_index', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('materials').select('id, title, description, topic, course_code, file_url, file_type, file_size, portal, semester, is_published, order_index, created_at').order('order_index', { ascending: true }).order('created_at', { ascending: true }),
        supabase.from('utme_subjects').select('*'),
        supabase.from('utme_questions').select('id, subject_id'),
        supabase.from('utme_topics').select('id, subject_id'),
        supabase.from('profiles').select('id, full_name').ilike('role', 'lecturer'),
      ]);

      // A failed query must never be presented as "empty". Surface it instead.
      const failure = [coursesRes, modulesRes, materialsRes, subjectsRes].find((r: any) => r.error);
      if (failure) {
        throw new Error((failure as any).error.message || 'A database request failed.');
      }

      setCourses(coursesRes.data || []);
      setModules(modulesRes.data || []);
      setMaterials(materialsRes.data || []);
      setUtmeSubjects(sortUtmeSubjects(subjectsRes.data || []));
      setLecturers(lecturersRes.data || []);

      const qCounts: Record<string, number> = {};
      for (const q of questionsRes.data || []) {
        if (q.subject_id) qCounts[q.subject_id] = (qCounts[q.subject_id] || 0) + 1;
      }
      setUtmeQuestionCounts(qCounts);

      const tCounts: Record<string, number> = {};
      for (const t of topicsRes.data || []) {
        if (t.subject_id) tCounts[t.subject_id] = (tCounts[t.subject_id] || 0) + 1;
      }
      setUtmeTopicCounts(tCounts);
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load the course hierarchy.');
    }
    setIsLoading(false);
  };

  /**
   * PART B — Post-UTME universities. Isolated on purpose.
   *
   * This is the ONLY part of the page that depends on migration 0054, so it is
   * the only part allowed to fail on its own. It never throws into the core
   * load and it never reports a missing table as an empty list — an absent
   * table, an empty table and a working table are three distinct states.
   */
  const fetchPostUtmeUniversities = async () => {
    if (!supabase) return;
    try {
      const { data, error } = await supabase
        .from('post_utme_universities')
        .select('*')
        .order('order_index', { ascending: true })
        .order('name', { ascending: true });

      if (error) {
        // PGRST205 = "Could not find the table ... in the schema cache" (the
        // exact code PostgREST returns while 0054 is unapplied). 42P01 is the
        // raw Postgres undefined_table code, kept as a fallback.
        const missing =
          error.code === 'PGRST205' ||
          error.code === '42P01' ||
          /could not find the table|does not exist/i.test(error.message || '');

        setUniversities([]);
        if (missing) {
          setPostUtmeHierarchyStatus('unavailable');
          setPostUtmeHierarchyError(
            'Post-UTME university management requires database migration 0054_academic_hierarchy_management.sql.',
          );
        } else {
          // A different failure. Surface it specifically — do NOT let it read
          // as "there are no universities".
          setPostUtmeHierarchyStatus('error');
          setPostUtmeHierarchyError(`Post-UTME universities could not be loaded: ${error.message}`);
        }
        return;
      }

      setUniversities(data || []);
      setPostUtmeHierarchyStatus('available');
      setPostUtmeHierarchyError(null);
    } catch (e: any) {
      setUniversities([]);
      setPostUtmeHierarchyStatus('error');
      setPostUtmeHierarchyError(`Post-UTME universities could not be loaded: ${e?.message || 'unknown error'}`);
    }
  };

  /**
   * PART B2 — availability of the non-Post-UTME columns introduced by 0054.
   * Two column probes; they read nothing and change nothing, and run once per
   * full load (not on a poll). Both must be present before the controls that
   * depend on them are offered, because a partial application of 0054 would
   * otherwise let one control succeed and its sibling fail.
   */
  const probeSchema0054Columns = async () => {
    if (!supabase) return;
    const [archiveProbe, orderProbe] = await Promise.all([
      supabase.from('course_modules').select('is_archived').limit(1),
      supabase.from('utme_subjects').select('order_index').limit(1),
    ]);
    // 42703 = undefined_column; PGRST204 = column missing from schema cache.
    const absent = (r: any) =>
      !!r?.error &&
      (r.error.code === '42703' ||
        r.error.code === 'PGRST204' ||
        /is_archived|order_index/i.test(r.error.message || ''));
    setSchema0054ColumnsAvailable(!absent(archiveProbe) && !absent(orderProbe));
  };

  const fetchData = async () => {
    await fetchCoreData();
    await fetchPostUtmeUniversities();
    await probeSchema0054Columns();
  };

  const handleDangerousAction = (title: string, message: string, irreversible: boolean, callback: () => Promise<void>) => {
    setActionTitle(title);
    setActionMessage(message);
    setIsIrreversible(irreversible);
    setActionCallback(() => callback);
    setIsModalOpen(true);
  };

  const executeAction = async () => {
    if (actionCallback) await actionCallback();
    setIsModalOpen(false);
  };

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------
  const programmeDef = useMemo(
    () => PROGRAMMES.find((p) => p.id === path.programme) || null,
    [path.programme],
  );

  const semesters = useMemo(() => {
    const fromDb = courses
      .filter((c) => c.portal === 'Undergraduate' && c.semester)
      .map((c) => c.semester);
    return Array.from(new Set([...BASE_SEMESTERS, ...fromDb]));
  }, [courses]);

  const currentCourses = useMemo(() => {
    if (!path.programme || path.programme === 'UTME') return [];
    return courses.filter((c) => {
      if (c.portal !== path.programme) return false;
      if (path.programme === 'Undergraduate') return c.semester === path.semester;
      if (path.programme === 'Post-UTME') {
        // A subject belongs to exactly the university it is filed under. The
        // "Shared" folder is university_id IS NULL — matching on it explicitly
        // keeps shared subjects reachable instead of silently vanishing from
        // every university folder.
        return (c.university_id ?? null) === (path.university?.id ?? null);
      }
      return true;
    });
  }, [courses, path.programme, path.semester, path.university]);

  /** Post-UTME universities, with the "Shared" folder always offered last. */
  const universityFolders = useMemo(() => {
    const active = universities.filter((u) => u.is_active !== false);
    const archived = universities.filter((u) => u.is_active === false);
    const sharedCount = courses.filter((c) => c.portal === 'Post-UTME' && !c.university_id).length;
    return { active, archived, sharedCount };
  }, [universities, courses]);

  /**
   * Topics for the open subject: real course_modules rows, unioned with any
   * topic text that exists only on legacy material rows so nothing becomes
   * unreachable. `id` is null for the legacy-only case.
   */
  const topics = useMemo(() => {
    if (!path.course) return [];
    const fromModules = modules
      .filter((m) => m.course_id === path.course!.id)
      .map((m) => ({ id: m.id as string | null, title: m.title, order_index: m.order_index ?? 0, is_published: m.is_published, is_archived: m.is_archived === true }));

    const known = new Set(fromModules.map((t) => (t.title || '').toLowerCase()));
    const legacy = Array.from(
      new Set(
        materials
          .filter((m) => m.course_code === path.course!.course_code && m.topic)
          .map((m) => m.topic),
      ),
    )
      .filter((t) => !known.has(String(t).toLowerCase()))
      .map((t) => ({ id: null, title: t, order_index: 0, is_published: undefined }));

    return [...fromModules, ...legacy];
  }, [modules, materials, path.course]);

  const topicMaterials = useMemo(() => {
    if (!path.course || !path.topic) return [];
    return materials.filter(
      (m) => m.course_code === path.course!.course_code && m.topic === path.topic!.title,
    );
  }, [materials, path.course, path.topic]);

  const getFilteredList = (list: any[]) => {
    if (!searchQuery) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((item) => {
      if (typeof item === 'string') return item.toLowerCase().includes(q);
      const haystack = [item.title, item.name, item.course_code, item.code, item.file_type]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  };

  // ---------------------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------------------
  const openForm = (type: 'course' | 'topic' | 'university', item: any = null) => {
    setFormType(type);
    setEditingItem(item);
    setFormError('');
    if (type === 'course') {
      if (item) {
        setCourseInput({
          title: item.title || '',
          course_code: item.course_code || '',
          status: item.status || 'Draft',
          visibility: item.visibility || 'Public',
          lecturer_id: item.lecturer_id || '',
        });
      } else {
        setCourseInput({ title: '', course_code: '', status: 'Draft', visibility: 'Public', lecturer_id: '' });
      }
    } else if (type === 'university') {
      setNameInput(item?.name || '');
    } else {
      setNameInput(item?.title || '');
    }
    setShowFormModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setIsSaving(true);
    setFormError('');
    try {
      if (formType === 'university') {
        // Defence in depth: the entry points are already withheld while the
        // table is missing, but a submit must never be attempted regardless.
        if (!postUtmeHierarchyAvailable) {
          throw new Error(
            'Post-UTME university management requires database migration 0054_academic_hierarchy_management.sql.',
          );
        }
        // The university level exists only under Post-UTME.
        if (editingItem) {
          const { error } = await supabase
            .from('post_utme_universities')
            .update({ name: nameInput })
            .eq('id', editingItem.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from('post_utme_universities').insert([{
            name: nameInput,
            order_index: universityFolders.active.length,
            is_active: true,
          }]);
          if (error) throw error;
        }
      } else if (formType === 'course') {
        if (path.programme === 'UTME') {
          // UTME subjects live in their own table and feed the CBT question bank.
          if (editingItem) {
            const { error } = await supabase
              .from('utme_subjects')
              .update({ name: courseInput.title, code: courseInput.course_code })
              .eq('id', editingItem.id);
            if (error) throw error;
          } else {
            const { error } = await supabase
              .from('utme_subjects')
              .insert([{ name: courseInput.title, code: courseInput.course_code, is_active: true }]);
            if (error) throw error;
          }
        } else {
          if (editingItem) {
            const { error } = await supabase
              .from('courses')
              .update({
                title: courseInput.title,
                course_code: courseInput.course_code,
                status: courseInput.status,
                visibility: courseInput.visibility,
                lecturer_id: courseInput.lecturer_id || null,
              })
              .eq('id', editingItem.id);
            if (error) throw error;
          } else {
            const newCourse: Record<string, any> = {
              title: courseInput.title,
              course_code: courseInput.course_code,
              portal: path.programme,
              semester: path.programme === 'Undergraduate' ? path.semester : null,
              level: '100 Level',
              status: courseInput.status,
              visibility: courseInput.visibility,
              lecturer_id: courseInput.lecturer_id || null,
              order_index: currentCourses.length,
              is_archived: false,
            };
            // courses.university_id is added by migration 0054, so the key is
            // included ONLY once the column is known to exist. Sending it while
            // the column is missing fails the whole insert with PGRST204
            // ("Could not find the 'university_id' column"), which would break
            // creating an ordinary Post-UTME subject. The "Shared" folder writes
            // NULL, which is what makes a subject visible across universities.
            if (path.programme === 'Post-UTME' && postUtmeHierarchyAvailable) {
              newCourse.university_id = path.university?.id ?? null;
            }
            const { error } = await supabase.from('courses').insert([newCourse]);
            if (error) throw error;
          }
        }
      } else {
        // Topics are persistent course_modules rows.
        if (editingItem?.id) {
          const { error } = await supabase
            .from('course_modules')
            .update({ title: nameInput })
            .eq('id', editingItem.id);
          if (error) throw error;
        } else if (editingItem && !editingItem.id) {
          throw new Error(
            'This topic exists only as a label on existing materials and cannot be renamed here. Create a new topic instead.',
          );
        } else {
          if (!path.course) throw new Error('Open a subject before adding a topic.');
          const { error } = await supabase.from('course_modules').insert([{
            course_id: path.course.id,
            title: nameInput,
            order_index: topics.length,
            // Set explicitly: the column default is `true`, which combined with
            // the public SELECT policy would publish the topic immediately.
            is_published: false,
          }]);
          if (error) throw error;
        }
      }
      setShowFormModal(false);
      await fetchData();
    } catch (err: any) {
      setFormError(err?.message || 'Save failed.');
    }
    setIsSaving(false);
  };

  const archiveCourse = async (course: any) => {
    if (!supabase) return;
    const { error } = await supabase.from('courses').update({ is_archived: true }).eq('id', course.id);
    if (error) {
      setLoadError(`Could not archive ${course.course_code}: ${error.message}`);
      return;
    }
    await fetchData();
  };

  const restoreCourse = async (course: any) => {
    if (!supabase) return;
    const { error } = await supabase.from('courses').update({ is_archived: false }).eq('id', course.id);
    if (error) {
      setLoadError(`Could not restore ${course.course_code}: ${error.message}`);
      return;
    }
    await fetchData();
  };

  // ---------------------------------------------------------------------------
  // Post-UTME universities
  // Archive reuses is_active (set false) rather than a second flag, so an
  // archived university is also excluded from any picker that filters on it.
  // ---------------------------------------------------------------------------
  const setUniversityActive = async (uni: any, isActive: boolean) => {
    if (!supabase) return;
    const { error } = await supabase
      .from('post_utme_universities')
      .update({ is_active: isActive })
      .eq('id', uni.id);
    if (error) {
      setLoadError(`Could not ${isActive ? 'restore' : 'archive'} ${uni.name}: ${error.message}`);
      return;
    }
    await fetchData();
  };

  const deleteUniversity = async (uni: any) => {
    if (!supabase) return;
    // Guard: courses.university_id is ON DELETE SET NULL, so deleting a
    // university would silently move its subjects into the "Shared" folder
    // rather than removing them. Block it instead of quietly refiling them.
    const attached = courses.filter((c) => c.portal === 'Post-UTME' && c.university_id === uni.id);
    if (attached.length > 0) {
      setLoadError(
        `"${uni.name}" still has ${attached.length} subject(s). Move or delete them before deleting the university.`,
      );
      return;
    }
    const { error } = await supabase.from('post_utme_universities').delete().eq('id', uni.id);
    if (error) {
      setLoadError(`Could not delete "${uni.name}": ${error.message}`);
      return;
    }
    await fetchData();
  };

  // ---------------------------------------------------------------------------
  // UTME subjects
  // Archive reuses the existing is_active column — the same one
  // cbt/AdminPdfUploader.tsx already filters on. No new flag.
  // ---------------------------------------------------------------------------
  const setUtmeSubjectActive = async (subject: any, isActive: boolean) => {
    if (!supabase) return;
    const { error } = await supabase.from('utme_subjects').update({ is_active: isActive }).eq('id', subject.id);
    if (error) {
      setLoadError(`Could not ${isActive ? 'restore' : 'archive'} ${subject.name}: ${error.message}`);
      return;
    }
    await fetchData();
  };

  const deleteUtmeSubject = async (subject: any) => {
    if (!supabase) return;
    // utme_topics.subject_id and utme_questions.subject_id are both ON DELETE
    // CASCADE, so deleting a subject would take its whole topic list and
    // question bank with it. Refuse unless it is genuinely empty.
    const questionCount = utmeQuestionCounts[subject.id] || 0;
    const topicCount = utmeTopicCounts[subject.id] || 0;
    if (questionCount > 0 || topicCount > 0) {
      setLoadError(
        `"${subject.name}" still has ${topicCount} topic(s) and ${questionCount} question(s). Archive it instead, or clear those first.`,
      );
      return;
    }
    const { error } = await supabase.from('utme_subjects').delete().eq('id', subject.id);
    if (error) {
      setLoadError(`Could not delete "${subject.name}": ${error.message}`);
      return;
    }
    await fetchData();
  };

  const deleteTopic = async (topic: { id: string | null; title: string }) => {
    if (!supabase || !path.course) return;
    if (!topic.id) {
      setLoadError('This topic only exists as a label on existing materials, so there is no record to delete.');
      return;
    }
    // Guard: never silently orphan the materials that sit under this topic.
    const attached = materials.filter(
      (m) => m.course_code === path.course!.course_code && m.topic === topic.title,
    );
    if (attached.length > 0) {
      setLoadError(
        `"${topic.title}" still contains ${attached.length} material(s). Remove or move them before deleting the topic.`,
      );
      return;
    }
    const { error } = await supabase.from('course_modules').delete().eq('id', topic.id);
    if (error) {
      setLoadError(`Could not delete "${topic.title}": ${error.message}`);
      return;
    }
    await fetchData();
  };

  const setTopicArchived = async (topic: { id: string | null; title: string }, isArchived: boolean) => {
    if (!supabase) return;
    if (!topic.id) {
      setLoadError('This topic only exists as a label on existing materials, so there is no record to archive.');
      return;
    }
    const { error } = await supabase.from('course_modules').update({ is_archived: isArchived }).eq('id', topic.id);
    if (error) {
      setLoadError(`Could not ${isArchived ? 'archive' : 'restore'} "${topic.title}": ${error.message}`);
      return;
    }
    await fetchData();
  };

  const deleteMaterial = async (material: any) => {
    if (!supabase) return;
    const { error } = await supabase.from('materials').delete().eq('id', material.id);
    if (error) {
      setLoadError(`Could not delete "${material.title}": ${error.message}`);
      return;
    }
    await fetchData();
  };

  const toggleMaterialPublish = async (material: any) => {
    if (!supabase) return;
    const { error } = await supabase
      .from('materials')
      .update({ is_published: !material.is_published })
      .eq('id', material.id);
    if (error) {
      setLoadError(`Could not update "${material.title}": ${error.message}`);
      return;
    }
    await fetchData();
  };

  const handleDuplicateCourse = async (course: any) => {
    if (!supabase) return;
    setIsLoading(true);
    try {
      const newCourseCode = `${course.course_code}_COPY_${Math.floor(Math.random() * 10000)}`;
      const { id, created_at, updated_at, ...restCourse } = course;
      const { error } = await supabase.from('courses').insert([{
        ...restCourse,
        title: `${course.title} (Copy)`,
        course_code: newCourseCode,
        status: 'Draft',
        visibility: 'Private',
        is_archived: false,
        order_index: currentCourses.length,
      }]);
      if (error) throw error;

      const { data: mats } = await supabase.from('materials').select('*').eq('course_code', course.course_code);
      if (mats && mats.length > 0) {
        const newMats = mats.map((m: any) => {
          const { id: mid, created_at: mc, updated_at: mu, ...restMat } = m;
          return { ...restMat, course_code: newCourseCode, is_published: false };
        });
        await supabase.from('materials').insert(newMats);
      }
      await fetchData();
    } catch (e: any) {
      setLoadError(e?.message || 'Error duplicating course.');
    }
    setIsLoading(false);
  };

  const handleDuplicateTopic = async (topic: { id: string | null; title: string }) => {
    if (!supabase || !path.course) return;
    setIsLoading(true);
    try {
      const { data: mats } = await supabase
        .from('materials')
        .select('*')
        .eq('course_code', path.course.course_code)
        .eq('topic', topic.title);

      const newTitle = `${topic.title} (Copy)`;
      const { error: modErr } = await supabase.from('course_modules').insert([{
        course_id: path.course.id,
        title: newTitle,
        order_index: topics.length,
        is_published: false,
      }]);
      if (modErr) throw modErr;

      if (mats && mats.length > 0) {
        const newMats = mats.map((m: any) => {
          const { id: mid, created_at: mc, updated_at: mu, ...restMat } = m;
          return { ...restMat, topic: newTitle, is_published: false };
        });
        await supabase.from('materials').insert(newMats);
      }
      await fetchData();
    } catch (e: any) {
      setLoadError(e?.message || 'Error duplicating topic.');
    }
    setIsLoading(false);
  };

  const handleReorder = async (
    table: 'courses' | 'course_modules' | 'materials' | 'utme_subjects' | 'post_utme_universities',
    currentItems: any[],
    index: number,
    direction: 'up' | 'down',
  ) => {
    if (!supabase) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentItems.length) return;

    const item1 = currentItems[index];
    const item2 = currentItems[targetIndex];
    // Topics that exist only as a text label on materials have no row to write.
    if (table === 'course_modules' && (!item1.id || !item2.id)) return;

    try {
      // True swap: give each row its neighbour's order_index so they exchange
      // positions rather than colliding on the same value.
      const order1 = item1.order_index ?? index;
      const order2 = item2.order_index ?? targetIndex;

      const results = await Promise.all([
        supabase.from(table).update({ order_index: order2 }).eq('id', item1.id),
        supabase.from(table).update({ order_index: order1 }).eq('id', item2.id),
      ]);
      const failed = results.find((r: any) => r.error);
      if (failed) throw failed.error;

      await fetchData();
    } catch (e: any) {
      setLoadError(e?.message || 'Error reordering.');
    }
  };

  // ---------------------------------------------------------------------------
  // Breadcrumbs
  // ---------------------------------------------------------------------------
  const crumbs: { label: string; onClick?: () => void; active: boolean }[] = [
    { label: 'Course Management', onClick: () => { setPath({}); setSearchQuery(''); }, active: !path.programme },
  ];
  if (path.programme) {
    crumbs.push({
      label: path.programme,
      onClick: () => { setPath({ programme: path.programme }); setSearchQuery(''); },
      active: !path.semester && !path.course && !path.utmeSubject && !path.university,
    });
  }
  if (path.semester) {
    crumbs.push({
      label: path.semester,
      onClick: () => { setPath({ programme: path.programme, semester: path.semester }); setSearchQuery(''); },
      active: !path.course,
    });
  }
  if (path.university) {
    crumbs.push({
      label: path.university.name,
      onClick: () => { setPath({ programme: path.programme, university: path.university }); setSearchQuery(''); },
      active: !path.course,
    });
  }
  if (path.utmeSubject) {
    crumbs.push({ label: path.utmeSubject.name, active: true });
  }
  if (path.course) {
    crumbs.push({
      label: path.course.course_code || path.course.title,
      onClick: () => { setPath({ ...path, topic: undefined }); setSearchQuery(''); },
      active: !path.topic,
    });
  }
  if (path.topic) {
    crumbs.push({ label: path.topic.title, active: true });
  }

  const handleBack = () => {
    if (path.topic) setPath({ ...path, topic: undefined });
    else if (path.utmeSubject) setPath({ programme: path.programme });
    // Keep the open university when stepping back out of a subject, so Back
    // lands on that university's subject list rather than jumping to the list
    // of all universities. Undefined for the other two programmes, so this is
    // a no-op for them.
    else if (path.course) setPath({ programme: path.programme, semester: path.semester, university: path.university });
    else if (path.university) setPath({ programme: path.programme });
    else if (path.semester) setPath({ programme: path.programme });
    else if (path.programme) setPath({});
    setSearchQuery('');
  };

  // ---------------------------------------------------------------------------
  // Contextual primary action for the current folder
  // ---------------------------------------------------------------------------
  const renderPrimaryAction = () => {
    if (!path.programme) return null;

    if (path.programme === 'UTME') {
      if (!path.utmeSubject) {
        return { label: 'Add Subject', onClick: () => openForm('course') };
      }
      return null;
    }

    if (path.programme === 'Undergraduate' && !path.semester) return null;

    // Post-UTME has one extra level above Subject, so the primary action at
    // the top of that programme creates a university, not a subject. Withheld
    // entirely while 0054 is unapplied — a button whose write cannot succeed is
    // worse than no button.
    if (path.programme === 'Post-UTME' && !path.university) {
      if (!postUtmeHierarchyAvailable) return null;
      return { label: 'Add University', onClick: () => openForm('university') };
    }

    if (!path.course) {
      return { label: 'Add Subject', onClick: () => openForm('course') };
    }

    if (programmeDef?.hasTopics && !path.topic) {
      return { label: 'Add Topic', onClick: () => openForm('topic') };
    }

    if (path.topic) {
      return { label: 'Upload Material', onClick: () => { setEditingMaterial(null); setShowMaterialModal(true); } };
    }

    return null;
  };

  const primaryAction = renderPrimaryAction();

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------
  const emptyState = (message: string, hint?: string) => (
    <div className="text-center py-16 bg-[#020617]/50 rounded-xl border border-slate-800 border-dashed">
      <Folder size={40} className="mx-auto text-slate-700 mb-3" />
      <p className="text-slate-400 font-medium">{message}</p>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );

  const folderRow = (opts: {
    key: string;
    icon: any;
    iconClass?: string;
    title: string;
    subtitle?: string;
    badge?: React.ReactNode;
    onOpen: () => void;
    actions?: React.ReactNode;
    muted?: boolean;
  }) => (
    <div
      key={opts.key}
      className={`flex items-center justify-between p-4 rounded-xl bg-[#020617]/50 border border-slate-800/50 hover:border-indigo-500/30 transition-colors group ${opts.muted ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-3 cursor-pointer flex-1 min-w-0" onClick={opts.onOpen}>
        <opts.icon className={opts.iconClass || 'text-indigo-400'} size={20} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-white truncate">{opts.title}</span>
            {opts.badge}
          </div>
          {opts.subtitle && <p className="text-xs text-slate-500 truncate">{opts.subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        {opts.actions}
      </div>
    </div>
  );

  const iconBtn = (onClick: (e: React.MouseEvent) => void, title: string, icon: any, cls = 'hover:text-amber-400 hover:bg-amber-500/10', disabled = false) => (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      className={`p-1.5 rounded-lg transition-colors ${disabled ? 'text-slate-700 cursor-not-allowed' : `text-slate-400 ${cls}`}`}
    >
      {React.createElement(icon, { size: 16 })}
    </button>
  );

  // ---------------------------------------------------------------------------
  // Body
  // ---------------------------------------------------------------------------
  const renderBody = () => {
    if (isLoading) {
      return <div className="text-center text-slate-400 py-16">Loading hierarchy…</div>;
    }

    if (loadError) {
      return (
        <div className="py-16 px-6 text-center bg-rose-500/5 rounded-xl border border-rose-500/30">
          <AlertTriangle size={40} className="mx-auto text-rose-400 mb-3" />
          <p className="text-rose-300 font-semibold mb-1">Could not load this folder</p>
          <p className="text-sm text-rose-200/70 mb-5 break-words max-w-xl mx-auto">{loadError}</p>
          <button
            onClick={() => { setLoadError(null); fetchData(); }}
            className="inline-flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-4 py-2 rounded-xl text-sm font-bold"
          >
            <RefreshCw size={16} /> Retry
          </button>
        </div>
      );
    }

    const list = getFilteredList;

    // --- Root: the three programmes -----------------------------------------
    if (!path.programme) {
      return (
        <div className="space-y-3">
          {PROGRAMMES.map((p) =>
            folderRow({
              key: p.id,
              icon: p.icon,
              iconClass: p.accent,
              title: p.label,
              subtitle: p.description,
              onOpen: () => setPath({ programme: p.id }),
            }),
          )}
        </div>
      );
    }

    // --- UTME: subjects ------------------------------------------------------
    if (path.programme === 'UTME' && !path.utmeSubject) {
      // Archive state lives on the pre-existing is_active column, which
      // cbt/AdminPdfUploader.tsx already filters on when listing subjects to
      // import questions against.
      const activeSubjects = utmeSubjects.filter((s: any) => s.is_active !== false);
      const archivedSubjects = utmeSubjects.filter((s: any) => s.is_active === false);
      const shown = list(activeSubjects);

      if (shown.length === 0 && archivedSubjects.length === 0) {
        return emptyState('No UTME subjects yet.', 'Use “Add Subject” to create one.');
      }
      return (
        <div className="space-y-3">
          {shown.map((s: any, i: number) =>
            folderRow({
              key: s.id,
              icon: Target,
              iconClass: 'text-emerald-400',
              title: s.name,
              subtitle: s.code ? `Code: ${s.code}` : undefined,
              badge: (
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                  {utmeQuestionCounts[s.id] || 0} questions
                </span>
              ),
              onOpen: () => setPath({ ...path, utmeSubject: s }),
              actions: (
                <>
                  {i > 0 && iconBtn(
                    () => handleReorder('utme_subjects', shown, i, 'up'),
                    schema0054ColumnsAvailable ? 'Move up' : 'Reordering requires migration 0054',
                    ArrowUp,
                    'hover:text-white hover:bg-slate-700',
                    !schema0054ColumnsAvailable,
                  )}
                  {i < shown.length - 1 && iconBtn(
                    () => handleReorder('utme_subjects', shown, i, 'down'),
                    schema0054ColumnsAvailable ? 'Move down' : 'Reordering requires migration 0054',
                    ArrowDown,
                    'hover:text-white hover:bg-slate-700',
                    !schema0054ColumnsAvailable,
                  )}
                  {iconBtn(() => openForm('course', s), 'Edit subject', Edit2)}
                  {iconBtn(
                    () => setUtmeSubjectActive(s, false),
                    'Archive subject (safe — keeps topics and questions)',
                    Archive,
                    'hover:text-rose-400 hover:bg-rose-500/10',
                  )}
                </>
              ),
            }),
          )}

          {archivedSubjects.length > 0 && (
            <div className="pt-4">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-3">Archived subjects</p>
              <div className="space-y-3">
                {archivedSubjects.map((s: any) =>
                  folderRow({
                    key: s.id,
                    icon: Archive,
                    iconClass: 'text-slate-500',
                    title: s.name,
                    subtitle: 'Archived — hidden from question import, questions intact',
                    muted: true,
                    onOpen: () => {},
                    actions: (
                      <>
                        {iconBtn(() => setUtmeSubjectActive(s, true), 'Restore subject', ArchiveRestore, 'hover:text-emerald-400 hover:bg-emerald-500/10')}
                        {iconBtn(
                          () => handleDangerousAction(
                            'Permanently Delete Subject',
                            `Permanently delete "${s.name}"? Its topics and questions must be empty first. This cannot be undone.`,
                            true,
                            () => deleteUtmeSubject(s),
                          ),
                          'Permanently delete',
                          Trash2,
                          'hover:text-rose-400 hover:bg-rose-500/10',
                        )}
                      </>
                    ),
                  }),
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    // --- UTME: CBT panel for one subject -------------------------------------
    if (path.programme === 'UTME' && path.utmeSubject) {
      const subj = path.utmeSubject;
      return (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="p-5 rounded-xl bg-[#020617]/50 border border-slate-800">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Questions</p>
              <p className="text-2xl font-bold text-white">{utmeQuestionCounts[subj.id] || 0}</p>
            </div>
            <div className="p-5 rounded-xl bg-[#020617]/50 border border-slate-800">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-1">Topics</p>
              <p className="text-2xl font-bold text-white">{utmeTopicCounts[subj.id] || 0}</p>
            </div>
          </div>
          <div className="p-5 rounded-xl bg-[#020617]/50 border border-slate-800 border-dashed">
            <p className="text-sm text-slate-400 mb-4">
              UTME uses CBT question banks only — it has no topic or learning-material layer by design.
              Questions, topics and AI generation for this subject are managed in the UTME CBT Manager.
            </p>
            {onNavigate && (
              <button
                onClick={() => onNavigate('utme')}
                className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-2 rounded-xl text-sm font-bold"
              >
                <Target size={16} /> Open UTME CBT Manager
              </button>
            )}
          </div>
        </div>
      );
    }

    // --- Undergraduate: semesters -------------------------------------------
    if (path.programme === 'Undergraduate' && !path.semester) {
      return (
        <div className="space-y-3">
          {list(semesters).map((sem: string) =>
            folderRow({
              key: sem,
              icon: Folder,
              title: sem,
              subtitle: `${courses.filter((c) => c.portal === 'Undergraduate' && c.semester === sem).length} subject(s)`,
              onOpen: () => setPath({ ...path, semester: sem }),
            }),
          )}
        </div>
      );
    }

    // --- Post-UTME: universities --------------------------------------------
    // The only level that had no storage anywhere before migration 0054.
    if (path.programme === 'Post-UTME' && !path.university) {
      const { active, archived, sharedCount } = universityFolders;
      const shown = list(active);

      // courses.university_id IS NULL is where every Pre-0054 Post-UTME subject
      // lives, so this folder is the only way to reach them. It is rendered
      // ONLY when it actually holds subjects: that keeps it a secondary route
      // rather than a permanent fixture, and stops an empty folder being
      // offered as if it were a level of the hierarchy.
      const sharedFolder = sharedCount > 0
        ? folderRow({
            key: 'shared',
            icon: Layers,
            iconClass: 'text-slate-400',
            title: 'Shared across universities',
            subtitle: `${sharedCount} subject(s) not tied to one university`,
            onOpen: () => setPath({ ...path, university: { id: null, name: 'Shared across universities' } }),
          })
        : null;

      // Shown only when 0054 is missing or the university query failed for
      // another reason. Localised to this branch — nothing else on the page
      // reports it, and it is not an error card that blocks the view.
      const migrationNotice = postUtmeHierarchyError ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5 flex items-start gap-3">
          <AlertTriangle size={20} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-amber-200">
              {postUtmeHierarchyAvailable ? 'University list unavailable' : 'University management not yet available'}
            </p>
            <p className="text-sm text-amber-200/80 mt-1 break-words">{postUtmeHierarchyError}</p>
            {postUtmeHierarchyStatus === 'unavailable' && (
              <p className="text-xs text-amber-200/60 mt-2">
                Run that file in the Supabase SQL Editor, then reload this page. Undergraduate, UTME
                and materials management are unaffected.
              </p>
            )}
          </div>
        </div>
      ) : null;

      // While the university table is absent, the university list, its empty
      // state and the "Add University" action are all withheld — offering any
      // of them would be a control that cannot work. The Shared folder is kept
      // because that is where every existing Post-UTME subject already lives
      // (their university_id is NULL), so legacy Post-UTME content stays
      // reachable without 0054.
      if (!postUtmeHierarchyAvailable) {
        return (
          <div className="space-y-3">
            {migrationNotice}
            {sharedFolder}
          </div>
        );
      }

      // The sharedCount term matters: without it, a database with subjects filed
      // outside any university but no universities yet would return the empty
      // state here and the sharedFolder below would never render — stranding
      // exactly the subjects this folder exists to reach.
      if (shown.length === 0 && archived.length === 0 && sharedCount === 0) {
        return emptyState('No universities here yet.', 'Use “Add University” to create one.');
      }
      return (
        <div className="space-y-3">
          {shown.map((u: any, i: number) =>
            folderRow({
              key: u.id,
              icon: BookOpen,
              iconClass: 'text-indigo-400',
              title: u.name,
              subtitle: `${courses.filter((c) => c.portal === 'Post-UTME' && c.university_id === u.id).length} subject(s)`,
              onOpen: () => setPath({ ...path, university: { id: u.id, name: u.name, code: u.code } }),
              actions: (
                <>
                  {i > 0 && iconBtn(() => handleReorder('post_utme_universities', shown, i, 'up'), 'Move up', ArrowUp, 'hover:text-white hover:bg-slate-700')}
                  {i < shown.length - 1 && iconBtn(() => handleReorder('post_utme_universities', shown, i, 'down'), 'Move down', ArrowDown, 'hover:text-white hover:bg-slate-700')}
                  {iconBtn(() => openForm('university', u), 'Rename university', Edit2)}
                  {iconBtn(
                    () => handleDangerousAction('Archive University', `Archive ${u.name}? Its subjects, topics and question banks are preserved and it can be restored.`, false, () => setUniversityActive(u, false)),
                    'Archive university (safe — keeps subjects)',
                    Archive,
                    'hover:text-rose-400 hover:bg-rose-500/10',
                  )}
                </>
              ),
            }),
          )}

          {/* Kept deliberately secondary — it renders after the universities,
              never instead of them. See sharedFolder above. */}
          {sharedFolder}

          {archived.length > 0 && (
            <div className="pt-4">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-3">Archived universities</p>
              <div className="space-y-3">
                {archived.map((u: any) =>
                  folderRow({
                    key: u.id,
                    icon: Archive,
                    iconClass: 'text-slate-500',
                    title: u.name,
                    subtitle: 'Archived — hidden from pickers, subjects intact',
                    muted: true,
                    onOpen: () => {},
                    actions: (
                      <>
                        {iconBtn(() => setUniversityActive(u, true), 'Restore university', ArchiveRestore, 'hover:text-emerald-400 hover:bg-emerald-500/10')}
                        {iconBtn(
                          () => handleDangerousAction(
                            'Permanently Delete University',
                            `Permanently delete ${u.name}? It must have no subjects. This cannot be undone.`,
                            true,
                            () => deleteUniversity(u),
                          ),
                          'Permanently delete',
                          Trash2,
                          'hover:text-rose-400 hover:bg-rose-500/10',
                        )}
                      </>
                    ),
                  }),
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    // --- Subjects ------------------------------------------------------------
    if (!path.course) {
      const active = currentCourses.filter((c) => !c.is_archived);
      const archived = currentCourses.filter((c) => c.is_archived);
      const shown = list(active);

      if (shown.length === 0 && archived.length === 0) {
        return emptyState('No subjects here yet.', 'Use “Add Subject” to create one.');
      }
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {shown.map((course: any, i: number) => (
              <div key={course.id} className="flex flex-col justify-between p-4 rounded-xl bg-[#020617]/50 border border-slate-800/50 hover:border-indigo-500/30 transition-colors group">
                <div className="mb-4 cursor-pointer" onClick={() => setPath({ ...path, course })}>
                  <h3 className="font-bold text-white mb-1 line-clamp-2">{course.title}</h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-slate-400 font-mono bg-slate-800/50 px-2 py-0.5 rounded">{course.course_code}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${course.status === 'Published' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                      {course.status || 'Draft'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {i > 0 && iconBtn(() => handleReorder('courses', shown, i, 'up'), 'Move up', ArrowUp, 'hover:text-white hover:bg-slate-700')}
                  {i < shown.length - 1 && iconBtn(() => handleReorder('courses', shown, i, 'down'), 'Move down', ArrowDown, 'hover:text-white hover:bg-slate-700')}
                  {iconBtn(() => { setTemplateCourseToSave(course); setShowTemplatesModal(true); }, 'Save as template', LayoutTemplate, 'hover:text-indigo-400 hover:bg-indigo-500/10')}
                  {iconBtn(() => handleDangerousAction('Duplicate Subject', `Duplicate ${course.course_code} and its materials?`, false, () => handleDuplicateCourse(course)), 'Duplicate', Copy, 'hover:text-indigo-400 hover:bg-indigo-500/10')}
                  {iconBtn(() => openForm('course', course), 'Edit subject', Edit2)}
                  {iconBtn(
                    () => handleDangerousAction('Archive Subject', `Archive ${course.course_code}? Its topics and materials are preserved and it can be restored.`, false, () => archiveCourse(course)),
                    'Archive subject (safe — keeps topics and materials)',
                    Archive,
                    'hover:text-rose-400 hover:bg-rose-500/10',
                  )}
                </div>
              </div>
            ))}
          </div>

          {archived.length > 0 && (
            <div className="pt-4">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-3">Archived subjects</p>
              <div className="space-y-3">
                {archived.map((course: any) =>
                  folderRow({
                    key: course.id,
                    icon: Archive,
                    iconClass: 'text-slate-500',
                    title: `${course.title} (${course.course_code})`,
                    subtitle: 'Archived — hidden from students, data intact',
                    muted: true,
                    onOpen: () => {},
                    actions: (
                      <>
                        {iconBtn(() => restoreCourse(course), 'Restore subject', ArchiveRestore, 'hover:text-emerald-400 hover:bg-emerald-500/10')}
                        {iconBtn(
                          () => handleDangerousAction(
                            'Permanently Delete Subject',
                            `Permanently delete ${course.course_code}? This removes the subject AND all of its topics and materials. This cannot be undone.`,
                            true,
                            async () => {
                              const { error } = await supabase!.from('courses').delete().eq('id', course.id);
                              if (error) setLoadError(`Could not delete: ${error.message}`);
                              await fetchData();
                            },
                          ),
                          'Permanently delete',
                          Trash2,
                          'hover:text-rose-400 hover:bg-rose-500/10',
                        )}
                      </>
                    ),
                  }),
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    // --- Topics --------------------------------------------------------------
    if (programmeDef?.hasTopics && !path.topic) {
      const activeTopics = topics.filter((t: any) => !t.is_archived);
      const archivedTopics = topics.filter((t: any) => t.is_archived);
      const shown = list(activeTopics);

      if (shown.length === 0 && archivedTopics.length === 0) {
        return emptyState('No topics in this subject yet.', 'Use “Add Topic” to create one.');
      }
      return (
        <div className="space-y-3">
          {shown.map((t: any, i: number) =>
            folderRow({
              key: t.id || `legacy-${t.title}`,
              icon: Layers,
              title: t.title,
              subtitle: `${materials.filter((m) => m.course_code === path.course!.course_code && m.topic === t.title).length} material(s)`,
              badge: t.id === null ? (
                <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-500">legacy label</span>
              ) : undefined,
              onOpen: () => setPath({ ...path, topic: { id: t.id, title: t.title } }),
              actions: (
                <>
                  {i > 0 && iconBtn(() => handleReorder('course_modules', shown, i, 'up'), 'Move up', ArrowUp, 'hover:text-white hover:bg-slate-700', !t.id)}
                  {i < shown.length - 1 && iconBtn(() => handleReorder('course_modules', shown, i, 'down'), 'Move down', ArrowDown, 'hover:text-white hover:bg-slate-700', !t.id)}
                  {iconBtn(() => handleDangerousAction('Duplicate Topic', `Duplicate "${t.title}" and its materials?`, false, () => handleDuplicateTopic(t)), 'Duplicate', Copy, 'hover:text-indigo-400 hover:bg-indigo-500/10')}
                  {iconBtn(() => openForm('topic', t), 'Edit topic', Edit2, 'hover:text-amber-400 hover:bg-amber-500/10', !t.id)}
                  {iconBtn(
                    () => setTopicArchived(t, true),
                    schema0054ColumnsAvailable
                      ? 'Archive topic (safe — keeps its materials)'
                      : 'Topic archiving requires migration 0054',
                    Archive,
                    'hover:text-rose-400 hover:bg-rose-500/10',
                    !t.id || !schema0054ColumnsAvailable,
                  )}
                  {iconBtn(
                    () => handleDangerousAction('Delete Topic', `Delete the topic "${t.title}"? It must be empty of materials first.`, true, () => deleteTopic(t)),
                    'Delete topic',
                    Trash2,
                    'hover:text-rose-400 hover:bg-rose-500/10',
                    !t.id,
                  )}
                </>
              ),
            }),
          )}

          {archivedTopics.length > 0 && (
            <div className="pt-4">
              <p className="text-xs uppercase tracking-wider text-slate-500 mb-3">Archived topics</p>
              <div className="space-y-3">
                {archivedTopics.map((t: any) =>
                  folderRow({
                    key: t.id || `legacy-${t.title}`,
                    icon: Archive,
                    iconClass: 'text-slate-500',
                    title: t.title,
                    subtitle: 'Archived — hidden from students, materials intact',
                    muted: true,
                    onOpen: () => {},
                    actions: (
                      <>
                        {iconBtn(() => setTopicArchived(t, false), 'Restore topic', ArchiveRestore, 'hover:text-emerald-400 hover:bg-emerald-500/10')}
                        {iconBtn(
                          () => handleDangerousAction('Delete Topic', `Delete the topic "${t.title}"? It must be empty of materials first.`, true, () => deleteTopic(t)),
                          'Delete topic',
                          Trash2,
                          'hover:text-rose-400 hover:bg-rose-500/10',
                        )}
                      </>
                    ),
                  }),
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    // --- Materials -----------------------------------------------------------
    if (path.topic) {
      const shown = list(topicMaterials);
      if (shown.length === 0) {
        return (
          <div className="text-center flex flex-col items-center justify-center py-16 bg-[#020617]/50 rounded-xl border border-slate-800 border-dashed">
            <FileText size={48} className="text-slate-700 mb-4" />
            <p className="text-slate-400 font-medium mb-1">No materials in this topic yet.</p>
            <div className="mt-4 flex gap-3 flex-wrap justify-center">
              <button
                onClick={() => { setEditingMaterial(null); setShowMaterialModal(true); }}
                className="bg-orange-500 hover:bg-orange-400 text-slate-950 px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2"
              >
                <Upload size={16} /> Upload Material
              </button>
              <button
                onClick={() => { setEditingLesson(null); setShowLessonEditor(true); }}
                className="bg-indigo-500 hover:bg-indigo-400 text-white px-4 py-2 rounded-xl text-sm font-bold"
              >
                Create Lesson
              </button>
              <button
                onClick={() => setShowBulkLessonModal(true)}
                className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2"
              >
                <Layers size={16} /> Bulk Create
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {shown.map((m: any, i: number) => (
            <div key={m.id} className="flex flex-col justify-between p-4 rounded-xl bg-[#020617]/50 border border-slate-800/50 hover:border-indigo-500/30 transition-colors group">
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${m.is_published ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                    {m.is_published ? 'Published' : 'Draft'}
                  </span>
                  {m.file_type && (
                    <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 uppercase">{m.file_type}</span>
                  )}
                  {m.file_size && <span className="text-xs text-slate-500">{m.file_size}</span>}
                </div>
                <h3 className="font-bold text-white line-clamp-2">{m.title || 'Untitled'}</h3>
              </div>
              <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {i > 0 && iconBtn(() => handleReorder('materials', shown, i, 'up'), 'Move up', ArrowUp, 'hover:text-white hover:bg-slate-700')}
                {i < shown.length - 1 && iconBtn(() => handleReorder('materials', shown, i, 'down'), 'Move down', ArrowDown, 'hover:text-white hover:bg-slate-700')}
                {m.file_url && m.file_url !== '#' && (
                  <a
                    href={m.file_url}
                    target="_blank"
                    rel="noreferrer"
                    title="Open file"
                    onClick={(e) => e.stopPropagation()}
                    className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg"
                  >
                    <Download size={16} />
                  </a>
                )}
                {iconBtn(() => toggleMaterialPublish(m), m.is_published ? 'Unpublish' : 'Publish', m.is_published ? EyeOff : Eye, 'hover:text-amber-400 hover:bg-amber-500/10')}
                {iconBtn(() => { setEditingMaterial(m); setShowMaterialModal(true); }, 'Edit material', Edit2)}
                {iconBtn(
                  () => handleDangerousAction('Delete Material', `Permanently delete "${m.title}"? This removes the database record.`, true, () => deleteMaterial(m)),
                  'Delete material',
                  Trash2,
                  'hover:text-rose-400 hover:bg-rose-500/10',
                )}
              </div>
            </div>
          ))}
        </div>
      );
    }

    return null;
  };

  // ---------------------------------------------------------------------------
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <ConfirmationModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirm={executeAction}
        title={actionTitle}
        message={actionMessage}
        isIrreversible={isIrreversible}
      />

      {/* Form modal */}
      <AnimatePresence>
        {showFormModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-white capitalize">
                  {editingItem ? 'Edit' : 'Add'}{' '}
                  {formType === 'course' ? 'Subject' : formType === 'university' ? 'University' : 'Topic'}
                </h3>
                <button onClick={() => setShowFormModal(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
              </div>
              <form onSubmit={handleSave} className="space-y-4">
                {formError && (
                  <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
                    <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                    <span className="break-words">{formError}</span>
                  </div>
                )}
                {formType === 'course' ? (
                  <>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">
                        {path.programme === 'UTME' ? 'Subject Name' : 'Course Title'}
                      </label>
                      <input
                        type="text"
                        value={courseInput.title}
                        onChange={(e) => setCourseInput({ ...courseInput, title: e.target.value })}
                        className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-slate-400 mb-1">
                        {path.programme === 'UTME' ? 'Subject Code' : 'Course Code'}
                      </label>
                      <input
                        type="text"
                        value={courseInput.course_code}
                        onChange={(e) => setCourseInput({ ...courseInput, course_code: e.target.value })}
                        className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2"
                        required
                      />
                    </div>

                    {path.programme !== 'UTME' && (
                      <>
                        <div>
                          <label className="block text-sm text-slate-400 mb-1">Assign Lecturer (Optional)</label>
                          <select
                            value={courseInput.lecturer_id || ''}
                            onChange={(e) => setCourseInput({ ...courseInput, lecturer_id: e.target.value })}
                            className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2"
                          >
                            <option value="">No Lecturer Assigned</option>
                            {lecturers.map((l) => (
                              <option key={l.id} value={l.id}>{l.full_name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm text-slate-400 mb-1">Publication Status</label>
                          <select
                            value={courseInput.status}
                            onChange={(e) => setCourseInput({ ...courseInput, status: e.target.value })}
                            className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2"
                            required
                          >
                            <option value="Draft">Draft</option>
                            <option value="Under Review">Under Review</option>
                            <option value="Published">Published</option>
                            <option value="Archived">Archived</option>
                            <option value="Hidden">Hidden</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-sm text-slate-400 mb-1">Visibility Rules</label>
                          <select
                            value={courseInput.visibility}
                            onChange={(e) => setCourseInput({ ...courseInput, visibility: e.target.value })}
                            className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2"
                            required
                          >
                            <option value="Public">Public (Visible to everyone)</option>
                            <option value="Undergraduate Only">Undergraduate Students Only</option>
                            <option value="Selected Departments">Selected Departments</option>
                            <option value="Selected Faculties">Selected Faculties</option>
                            <option value="Selected Levels">Selected Levels</option>
                          </select>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <div>
                    <label className="block text-sm text-slate-400 mb-1">
                      {formType === 'university' ? 'University Name' : 'Topic Name'}
                    </label>
                    <input
                      type="text"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      placeholder={formType === 'university' ? 'e.g. UNILAG' : undefined}
                      className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2"
                      required
                    />
                  </div>
                )}
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowFormModal(false)} className="flex-1 py-3 px-4 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors">Cancel</button>
                  <button type="submit" disabled={isSaving} className="flex-1 py-3 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-slate-950 font-bold transition-colors disabled:opacity-50">
                    {isSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-white mb-2 flex items-center gap-3">
            <BookOpen className="text-orange-400" size={28} /> Course Management
          </h1>
          <p className="text-sm font-body text-slate-400">Hierarchical course curriculum and materials management.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setActiveTab('courses')} className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${activeTab === 'courses' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}>Hierarchy</button>
          <button onClick={() => setActiveTab('content')} className={`px-4 py-2 rounded-xl text-sm font-bold transition-colors ${activeTab === 'content' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white'}`}>Legacy Materials</button>
        </div>
      </div>

      {activeTab === 'content' ? (
        <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-6">
          <MaterialAdminDashboard />
        </div>
      ) : (
        <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-6 min-h-[500px] flex flex-col">
          {/* Breadcrumbs + back */}
          <div className="flex items-center gap-2 mb-6 text-sm text-slate-400 overflow-x-auto pb-2">
            {path.programme && (
              <button onClick={handleBack} className="flex items-center gap-1 whitespace-nowrap text-slate-400 hover:text-white transition-colors mr-1" title="Back">
                <ChevronRight size={14} className="rotate-180" /> Back
              </button>
            )}
            {crumbs.map((c, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight size={14} className="flex-shrink-0" />}
                {c.onClick ? (
                  <button onClick={c.onClick} className={`whitespace-nowrap hover:text-white transition-colors ${c.active ? 'text-indigo-400 font-bold' : ''}`}>{c.label}</button>
                ) : (
                  <span className={`whitespace-nowrap ${c.active ? 'text-indigo-400 font-bold' : ''}`}>{c.label}</span>
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Search + contextual action */}
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-center mb-6">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input
                type="text"
                placeholder="Search…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl pl-10 pr-4 py-2 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-sm"
              />
            </div>
            {primaryAction && (
              <button
                onClick={primaryAction.onClick}
                className={`w-full sm:w-auto px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 ${path.topic ? 'bg-orange-500 hover:bg-orange-400 text-slate-950' : 'bg-orange-500 hover:bg-orange-400 text-slate-950'}`}
              >
                {path.topic ? <Upload size={16} /> : <Plus size={16} />} {primaryAction.label}
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">{renderBody()}</div>

          {/* Extra actions once inside a topic */}
          {path.topic && !isLoading && !loadError && (
            <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap gap-3">
              <button
                onClick={() => { setEditingLesson(null); setShowLessonEditor(true); }}
                className="bg-indigo-500 hover:bg-indigo-400 text-white px-4 py-2 rounded-xl text-sm font-bold"
              >
                Create Lesson
              </button>
              <button
                onClick={() => setShowBulkLessonModal(true)}
                className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2"
              >
                <Layers size={16} /> Bulk Create
              </button>
            </div>
          )}
        </div>
      )}

      {showMaterialModal && path.course && path.topic && path.programme && (
        <MaterialUploadModal
          programme={path.programme}
          semester={path.semester}
          courseCode={path.course.course_code}
          courseTitle={path.course.title}
          topic={path.topic.title}
          material={editingMaterial}
          onClose={() => { setShowMaterialModal(false); setEditingMaterial(null); }}
          onSaved={() => { setShowMaterialModal(false); setEditingMaterial(null); fetchData(); }}
        />
      )}

      {showBulkLessonModal && path.course && path.topic && (
        <BulkLessonModal
          courseCode={path.course.course_code}
          topic={path.topic.title}
          /* `materials.portal` is NOT NULL, so a bulk insert that omits it fails
             outright. These were never passed, which is why "Bulk Create" could
             not have written anything. */
          portal={path.programme!}
          semester={path.semester || (path.course as any).semester || ''}
          onClose={() => setShowBulkLessonModal(false)}
          onSuccess={() => { setShowBulkLessonModal(false); fetchData(); }}
        />
      )}

      {showTemplatesModal && (
        <CourseTemplatesModal
          courseToSave={templateCourseToSave}
          onClose={() => setShowTemplatesModal(false)}
          onSuccess={() => { setShowTemplatesModal(false); fetchData(); }}
        />
      )}

      <AnimatePresence>
        {showLessonEditor && path.course && path.topic && (
          <LessonEditor
            courseCode={path.course.course_code}
            topic={path.topic.title}
            portal={path.programme!}
            semester={path.semester || ''}
            lesson={editingLesson}
            /* The editor stays open across a save: it owns the document it just
               wrote and reports the result with its own toast, which would be
               unmounted before it could be read if the save closed the editor. */
            onClose={() => { setShowLessonEditor(false); setEditingLesson(null); fetchData(); }}
            onSaved={() => { void fetchData(); }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
