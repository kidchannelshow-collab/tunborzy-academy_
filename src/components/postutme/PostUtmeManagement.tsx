import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  Plus, Edit2, Trash2, Eye, EyeOff, BookOpen, Layers, FileText, Sparkles,
  Copy, Search, X, ArrowUp, ArrowDown, Archive, ArchiveRestore, Save,
  Building2, Loader2, AlertCircle, Award, GraduationCap, Link2
} from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useProfile } from '../../lib/useProfile';
import AdminPdfUploader from '../cbt/AdminPdfUploader';
import LessonEditor from '../materials/LessonEditor';
import {
  POST_UTME_UNIVERSITY_CODE,
  POST_UTME_UNIVERSITY_NAME,
} from '../../lib/postUtme';
import { OPTION_LETTERS, availableOptionLetters } from '../../lib/questionOptions';

/**
 * Post-UTME Manager — the single staff surface for the Post-UTME programme.
 *
 * It covers four things:
 *   1. the CBT paper + question bank      (post_utme_exams / post_utme_questions)
 *   2. the PDF -> CBT importer            (AdminPdfUploader, destType="Post-UTME")
 *   3. topics for each Post-UTME subject  (course_modules)
 *   4. lessons                            (materials)
 *
 * Lesson authoring is the only material-creation path exposed here: the file
 * upload flow is deliberately withdrawn for now rather than left half-working.
 * Existing file materials still list, publish and reorder as before.
 *
 * Post-UTME is a single-university programme — see `lib/postUtme.ts`.
 *
 * Tabs 3 and 4 deliberately read and write the SAME rows that
 * `admin/CourseManagement.tsx` manages for the Post-UTME programme — this is a
 * second view of one system, not a parallel one. Nothing here introduces a new
 * table, and the lesson editor and upload modal are the existing shared
 * components, so a lesson authored here is identical to one authored in Course
 * Management.
 *
 * Post-UTME subjects live in `courses` with `portal = 'Post-UTME'`; a subject's
 * course_code is the key that materials hang off (materials have no course_id).
 *
 * Lecturer scoping reuses the existing ownership columns rather than adding a
 * permission system: `courses.lecturer_id` and `materials.lecturer_id`, plus
 * `post_utme_exams.created_by` for papers. These mirror the RLS policies in
 * migration 0034, so the UI and the database agree on who may write what.
 */

type Tab = 'questions' | 'importer' | 'topics' | 'materials';

const PORTAL = 'Post-UTME';

/** Same comparison key the PDF importer uses, so both agree on "duplicate". */
function normaliseQuestionText(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatFileType(fileType: string | null | undefined): string {
  if (!fileType) return 'File';
  if (fileType === 'lesson') return 'Lesson';
  return fileType.toUpperCase();
}

/** Import date/time, shown on papers and in the question list. */
function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown date';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown date';
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function PostUtmeManagement() {
  const { profile } = useProfile();
  const isLecturer = profile?.role === 'Lecturer';

  const [activeTab, setActiveTab] = useState<Tab>('questions');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- CBT papers + questions ------------------------------------------------
  const [exams, setExams] = useState<any[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>('');
  const [examSearch, setExamSearch] = useState('');
  const [questions, setQuestions] = useState<any[]>([]);
  const [attemptStats, setAttemptStats] = useState<{ count: number; avg: number } | null>(null);
  // Ids ticked in the question list, for the bulk action bar.
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());

  const [isExamModalOpen, setIsExamModalOpen] = useState(false);
  const [currentExam, setCurrentExam] = useState<any>({});
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<any>({});

  // --- Topics (course_modules) + Materials (materials) -----------------------
  const [subjects, setSubjects] = useState<any[]>([]);
  const [topics, setTopics] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>('');
  const [selectedTopicTitle, setSelectedTopicTitle] = useState<string>('');

  const [isTopicModalOpen, setIsTopicModalOpen] = useState(false);
  const [topicName, setTopicName] = useState('');
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);

  const [showLessonEditor, setShowLessonEditor] = useState(false);
  const [editingLesson, setEditingLesson] = useState<any | null>(null);

  useEffect(() => {
    if (profile) fetchAll();
    // Re-scope when the signed-in role changes (e.g. profile resolves late).
  }, [profile?.id, profile?.role]);

  /**
   * Live paper and question updates.
   *
   * The tables `fetchAll` reads are the ones watched here — the papers, their
   * questions, and the attempt statistics shown against them. Nothing else
   * affects what this screen renders, so nothing else is subscribed.
   *
   * Reloads are coalesced: a bulk question insert arrives as many events, and
   * refetching per event would thrash the table and the attempt aggregate.
   */
  useEffect(() => {
    if (!supabase || !profile?.id) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void fetchAll(); }, 600);
    };

    const channel = supabase
      .channel(`post_utme_management_live_${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_utme_exams' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_utme_questions' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'post_utme_attempts' }, scheduleReload)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  useEffect(() => {
    if (selectedExamId) fetchQuestions(selectedExamId);
    else {
      setQuestions([]);
      setAttemptStats(null);
    }
  }, [selectedExamId]);

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  const fetchAll = async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([fetchExams(), fetchSubjects()]);
    } catch (err: any) {
      setError(err?.message || 'Failed to load Post-UTME content.');
    } finally {
      setLoading(false);
    }
  };

  const fetchExams = async () => {
    let query = supabase
      .from('post_utme_exams')
      .select('*')
      .order('created_at', { ascending: false });
    // Mirrors the 0034 lecturer policy: a lecturer owns the papers they created.
    if (isLecturer && profile?.id) query = query.eq('created_by', profile.id);

    const { data, error: err } = await query;
    if (err) throw err;
    setExams(data || []);
    setSelectedExamId((prev) => prev || data?.[0]?.id || '');
  };

  const fetchQuestions = async (examId: string) => {
    try {
      const { data, error: err } = await supabase
        .from('post_utme_questions')
        .select('*')
        .eq('exam_id', examId)
        .order('created_at', { ascending: true });
      if (err) throw err;
      setQuestions(data || []);
      // The previous paper's ticks must not carry over to this one.
      setSelectedQuestionIds(new Set());

      const { data: attempts } = await supabase
        .from('post_utme_attempts')
        .select('score, status')
        .eq('exam_id', examId);

      const finished = (attempts || []).filter((a: any) => a.status === 'completed');
      setAttemptStats(
        finished.length
          ? {
              count: finished.length,
              avg: Math.round(
                finished.reduce((sum: number, a: any) => sum + (a.score || 0), 0) / finished.length,
              ),
            }
          : { count: 0, avg: 0 },
      );
    } catch (err: any) {
      setError(err?.message || 'Failed to load questions for this paper.');
    }
  };

  const fetchSubjects = async () => {
    let query = supabase
      .from('courses')
      .select('*')
      .eq('portal', PORTAL)
      .order('order_index', { ascending: true })
      .order('title', { ascending: true });
    if (isLecturer && profile?.id) query = query.eq('lecturer_id', profile.id);

    const { data: subjectRows, error: err } = await query;
    if (err) throw err;
    setSubjects(subjectRows || []);
    setSelectedSubjectId((prev) => prev || subjectRows?.[0]?.id || '');

    const [modulesRes, materialsRes] = await Promise.all([
      supabase.from('course_modules').select('*').order('order_index', { ascending: true }),
      (() => {
        let q = supabase.from('materials').select('*').eq('portal', PORTAL);
        if (isLecturer && profile?.id) q = q.eq('lecturer_id', profile.id);
        return q.order('order_index', { ascending: true }).order('created_at', { ascending: true });
      })(),
    ]);

    if (modulesRes.error) throw modulesRes.error;
    if (materialsRes.error) throw materialsRes.error;
    setTopics(modulesRes.data || []);
    setMaterials(materialsRes.data || []);
  };

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const selectedSubject = useMemo(
    () => subjects.find((s) => s.id === selectedSubjectId) || null,
    [subjects, selectedSubjectId],
  );

  const subjectTopics = useMemo(() => {
    if (!selectedSubject) return [];
    const rows = topics.filter((t) => t.course_id === selectedSubject.id);
    // Archived topics stay visible to staff (greyed) so nothing becomes unreachable.
    return rows.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
  }, [topics, selectedSubject]);

  const topicMaterials = useMemo(() => {
    if (!selectedSubject || !selectedTopicTitle) return [];
    return materials.filter(
      (m) => m.course_code === selectedSubject.course_code && m.topic === selectedTopicTitle,
    );
  }, [materials, selectedSubject, selectedTopicTitle]);

  const filteredExams = useMemo(() => {
    const q = examSearch.trim().toLowerCase();
    if (!q) return exams;
    return exams.filter(
      (e) =>
        (e.title || '').toLowerCase().includes(q) ||
        (e.subject || '').toLowerCase().includes(q) ||
        (e.university || '').toLowerCase().includes(q),
    );
  }, [exams, examSearch]);

  const activeExam = useMemo(
    () => exams.find((e) => e.id === selectedExamId) || null,
    [exams, selectedExamId],
  );

  // ---------------------------------------------------------------------------
  // CBT paper + question actions
  // ---------------------------------------------------------------------------

  const handleSaveExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        title: currentExam.title,
        // Post-UTME serves a single university; the value is pinned rather than
        // taken from the form so no other university can be written.
        university: POST_UTME_UNIVERSITY_CODE,
        subject: currentExam.subject,
        course_code: currentExam.course_code || null,
        year: currentExam.year || null,
        duration_minutes: Number(currentExam.duration_minutes) || 60,
        is_published: !!currentExam.is_published,
      };

      if (currentExam.id) {
        const { error: err } = await supabase
          .from('post_utme_exams')
          .update(payload)
          .eq('id', currentExam.id);
        if (err) throw err;
      } else {
        const { data, error: err } = await supabase
          .from('post_utme_exams')
          .insert([{ ...payload, created_by: profile?.id }])
          .select()
          .single();
        if (err) throw err;
        if (data) setSelectedExamId(data.id);
      }

      setIsExamModalOpen(false);
      setCurrentExam({});
      await fetchExams();
    } catch (err: any) {
      setError(err?.message || 'Could not save this paper.');
    } finally {
      setBusy(false);
    }
  };

  const togglePublishExam = async (exam: any) => {
    const { error: err } = await supabase
      .from('post_utme_exams')
      .update({ is_published: !exam.is_published })
      .eq('id', exam.id);
    if (err) {
      setError(err.message);
      return;
    }
    fetchExams();
  };

  const duplicateExam = async (exam: any) => {
    // Questions are not copied — a duplicate is a new empty paper, matching the
    // "duplicate" semantics used elsewhere in this codebase.
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = exam;
    const { data, error: err } = await supabase
      .from('post_utme_exams')
      .insert([
        {
          ...rest,
          title: `${exam.title} (Copy)`,
          is_published: false,
          created_by: profile?.id,
        },
      ])
      .select()
      .single();
    if (err) {
      setError(err.message);
      return;
    }
    await fetchExams();
    if (data) setSelectedExamId(data.id);
  };

  const deleteExam = async (exam: any) => {
    // post_utme_questions.exam_id is ON DELETE CASCADE, so deleting a paper would
    // take its whole question bank with it. Require it to be empty first.
    if (questions.length > 0 && exam.id === selectedExamId) {
      setError(
        `"${exam.title}" still holds ${questions.length} question(s). Remove them before deleting the paper.`,
      );
      return;
    }
    const { count } = await supabase
      .from('post_utme_questions')
      .select('id', { count: 'exact', head: true })
      .eq('exam_id', exam.id);
    if ((count || 0) > 0) {
      setError(`"${exam.title}" still holds ${count} question(s). Remove them before deleting the paper.`);
      return;
    }
    if (!window.confirm(`Delete the paper "${exam.title}"? This cannot be undone.`)) return;

    const { error: err } = await supabase.from('post_utme_exams').delete().eq('id', exam.id);
    if (err) {
      setError(err.message);
      return;
    }
    if (selectedExamId === exam.id) setSelectedExamId('');
    fetchExams();
  };

  const openQuestionForm = (q: any = null) => {
    setEditingQuestionId(q?.id ?? null);
    // `option_e` is NULL on rows written before the fifth option existed; the
    // inputs read through `|| ''`, but normalising here keeps the form state a
    // string and stops an untouched option saving back as null.
    setCurrentQuestion(
      q
        ? { ...q, option_e: q.option_e || '' }
        : { correct_option: 'A', difficulty: 'medium', marks: 1, option_e: '' },
    );
    setIsQuestionModalOpen(true);
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExamId) return;
    setBusy(true);
    setError(null);
    try {
      const payload = {
        exam_id: selectedExamId,
        course_code: currentQuestion.course_code || activeExam?.course_code || activeExam?.subject || null,
        question_text: currentQuestion.question_text,
        option_a: currentQuestion.option_a,
        option_b: currentQuestion.option_b,
        option_c: currentQuestion.option_c,
        option_d: currentQuestion.option_d,
        // Empty string rather than undefined, so a four-option question clears
        // the column instead of leaving a stale fifth option behind.
        option_e: currentQuestion.option_e || '',
        correct_option: currentQuestion.correct_option || 'A',
        explanation: currentQuestion.explanation || '',
        marks: Number(currentQuestion.marks) || 1,
        topic: currentQuestion.topic || 'General',
        difficulty: currentQuestion.difficulty || 'medium',
      };

      if (editingQuestionId) {
        const { error: err } = await supabase
          .from('post_utme_questions')
          .update(payload)
          .eq('id', editingQuestionId);
        if (err) throw err;
      } else {
        // Duplicate protection: unlike papers, a repeated question in the same
        // paper is never intentional, so it is refused with a pointer to the
        // existing row instead of being inserted twice.
        const key = normaliseQuestionText(payload.question_text);
        const clash = questions.find((q) => normaliseQuestionText(q.question_text) === key);
        if (key && clash) {
          throw new Error('This question already exists in this paper. Edit the existing one instead.');
        }
        const { error: err } = await supabase.from('post_utme_questions').insert([payload]);
        if (err) throw err;
      }

      setIsQuestionModalOpen(false);
      setEditingQuestionId(null);
      setCurrentQuestion({});
      fetchQuestions(selectedExamId);
    } catch (err: any) {
      setError(err?.message || 'Could not save this question.');
    } finally {
      setBusy(false);
    }
  };

  const duplicateQuestion = async (q: any) => {
    const { id: _id, created_at: _c, ...rest } = q;
    const { error: err } = await supabase.from('post_utme_questions').insert([
      { ...rest, question_text: `${q.question_text} (Copy)` },
    ]);
    if (err) {
      setError(err.message);
      return;
    }
    fetchQuestions(selectedExamId);
  };

  const deleteQuestion = async (q: any) => {
    if (!window.confirm('Delete this question? This cannot be undone.')) return;
    const { error: err } = await supabase.from('post_utme_questions').delete().eq('id', q.id);
    if (err) {
      setError(err.message);
      return;
    }
    fetchQuestions(selectedExamId);
  };

  // --- Bulk selection --------------------------------------------------------

  const toggleQuestionSelected = (id: string) => {
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allQuestionsSelected =
    questions.length > 0 && selectedQuestionIds.size === questions.length;

  const toggleSelectAllQuestions = () => {
    setSelectedQuestionIds(
      allQuestionsSelected ? new Set() : new Set(questions.map((q) => q.id)),
    );
  };

  const deleteSelectedQuestions = async () => {
    const ids = Array.from(selectedQuestionIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected question(s)? This cannot be undone.`)) return;

    const { error: err } = await supabase.from('post_utme_questions').delete().in('id', ids);
    if (err) {
      setError(err.message);
      return;
    }
    setSelectedQuestionIds(new Set());
    fetchQuestions(selectedExamId);
  };

  // ---------------------------------------------------------------------------
  // Topic actions (course_modules)
  // ---------------------------------------------------------------------------

  const openTopicForm = (topic: any = null) => {
    setEditingTopicId(topic?.id ?? null);
    setTopicName(topic?.title ?? '');
    setIsTopicModalOpen(true);
  };

  const handleSaveTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubject) return;
    setBusy(true);
    setError(null);
    try {
      const name = topicName.trim();
      if (!name) throw new Error('Enter a topic name.');

      if (editingTopicId) {
        const { error: err } = await supabase
          .from('course_modules')
          .update({ title: name })
          .eq('id', editingTopicId);
        if (err) throw err;
      } else {
        const clash = subjectTopics.find(
          (t) => (t.title || '').toLowerCase() === name.toLowerCase(),
        );
        if (clash) throw new Error(`"${name}" already exists in this subject.`);

        const { error: err } = await supabase.from('course_modules').insert([
          {
            course_id: selectedSubject.id,
            title: name,
            order_index: subjectTopics.length,
            // Set explicitly: the column default is true, and an archived topic
            // is hidden from the pickers.
            is_archived: false,
          },
        ]);
        if (err) throw err;
      }

      setIsTopicModalOpen(false);
      setEditingTopicId(null);
      setTopicName('');
      await fetchSubjects();
    } catch (err: any) {
      setError(err?.message || 'Could not save this topic.');
    } finally {
      setBusy(false);
    }
  };

  const setTopicArchived = async (topic: any, isArchived: boolean) => {
    const { error: err } = await supabase
      .from('course_modules')
      .update({ is_archived: isArchived })
      .eq('id', topic.id);
    if (err) {
      setError(err.message);
      return;
    }
    if (isArchived && selectedTopicTitle === topic.title) setSelectedTopicTitle('');
    fetchSubjects();
  };

  const deleteTopic = async (topic: any) => {
    // Materials reference their topic by text, not by id, so deleting a topic
    // would orphan every lesson filed under it. Counted from the database rather
    // than from `materials` in state: that list is already scoped to the current
    // user, so for a lecturer it would under-count another lecturer's materials
    // and let an in-use topic be deleted.
    const { count } = await supabase
      .from('materials')
      .select('id', { count: 'exact', head: true })
      .eq('course_code', selectedSubject?.course_code)
      .eq('topic', topic.title);
    if ((count || 0) > 0) {
      setError(`"${topic.title}" still contains ${count} material(s). Remove them before deleting the topic.`);
      return;
    }
    if (!window.confirm(`Delete the topic "${topic.title}"? This cannot be undone.`)) return;

    const { error: err } = await supabase.from('course_modules').delete().eq('id', topic.id);
    if (err) {
      setError(err.message);
      return;
    }
    if (selectedTopicTitle === topic.title) setSelectedTopicTitle('');
    fetchSubjects();
  };

  const reorderTopic = async (list: any[], index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const a = list[index];
    const b = list[targetIndex];
    // True swap, matching admin/CourseManagement.tsx: hand each row its
    // neighbour's order_index so they exchange places instead of colliding.
    const results = await Promise.all([
      supabase.from('course_modules').update({ order_index: b.order_index ?? targetIndex }).eq('id', a.id),
      supabase.from('course_modules').update({ order_index: a.order_index ?? index }).eq('id', b.id),
    ]);
    const failed = results.find((r: any) => r.error);
    if (failed) {
      setError(failed.error.message);
      return;
    }
    fetchSubjects();
  };

  // ---------------------------------------------------------------------------
  // Material actions (materials)
  // ---------------------------------------------------------------------------

  const toggleMaterialPublish = async (m: any) => {
    const { error: err } = await supabase
      .from('materials')
      .update({ is_published: !m.is_published })
      .eq('id', m.id);
    if (err) {
      setError(err.message);
      return;
    }
    fetchSubjects();
  };

  const deleteMaterial = async (m: any) => {
    if (!window.confirm(`Delete "${m.title}"? This cannot be undone.`)) return;
    const { error: err } = await supabase.from('materials').delete().eq('id', m.id);
    if (err) {
      setError(err.message);
      return;
    }
    fetchSubjects();
  };

  const reorderMaterial = async (list: any[], index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const a = list[index];
    const b = list[targetIndex];
    // `?? index` fallback: LessonEditor never writes order_index, so lessons
    // arrive with NULL and need a concrete value to swap with.
    const results = await Promise.all([
      supabase.from('materials').update({ order_index: b.order_index ?? targetIndex }).eq('id', a.id),
      supabase.from('materials').update({ order_index: a.order_index ?? index }).eq('id', b.id),
    ]);
    const failed = results.find((r: any) => r.error);
    if (failed) {
      setError(failed.error.message);
      return;
    }
    fetchSubjects();
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'questions', label: 'Question Bank', icon: FileText },
    { id: 'importer', label: 'AI PDF Importer', icon: Sparkles },
    { id: 'topics', label: 'Topics', icon: Layers },
    { id: 'materials', label: 'Materials', icon: BookOpen },
  ];

  const inputCls =
    'w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500';
  const labelCls = 'text-xs font-semibold uppercase tracking-wider text-slate-400';

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0f172a] border border-slate-800 p-8 rounded-3xl">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full">
            {isLecturer ? 'Lecturer Portal' : 'Admin Portal'}
          </span>
          <h1 className="text-3xl font-display font-bold text-white mt-2 flex items-center gap-3">
            <Building2 className="text-blue-400" size={28} />
            Post-UTME Manager
          </h1>
          <p className="text-slate-400 mt-1">
            Papers, question banks, topics and learning materials for the Post-UTME programme.
          </p>
        </div>
        <button
          onClick={() => {
            setCurrentExam({
              university: POST_UTME_UNIVERSITY_CODE,
              duration_minutes: 60,
              is_published: false,
            });
            setIsExamModalOpen(true);
          }}
          className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl flex items-center gap-2 transition-colors"
        >
          <Plus size={20} /> New Paper
        </button>
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-4 rounded-2xl flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <p className="text-sm break-words">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-rose-300 hover:text-white shrink-0">
            <X size={18} />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-sm transition-all ${
              activeTab === tab.id
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'bg-[#0f172a] text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            <tab.icon size={18} /> {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-slate-400 gap-3">
          <Loader2 className="animate-spin" size={22} />
          <span>Loading Post-UTME content…</span>
        </div>
      ) : (
        <>
          {/* ------------------------------------------------------------------ */}
          {/* Question bank                                                      */}
          {/* ------------------------------------------------------------------ */}
          {activeTab === 'questions' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Papers */}
              <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-white">Papers</h3>
                  <span className="text-xs bg-blue-500/10 text-blue-300 font-bold px-2.5 py-1 rounded-full">
                    {filteredExams.length}
                  </span>
                </div>

                <div className="relative">
                  <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
                  <input
                    type="text"
                    value={examSearch}
                    onChange={(e) => setExamSearch(e.target.value)}
                    placeholder="Search title, subject or university…"
                    className={`${inputCls} pl-9 text-sm`}
                  />
                </div>

                <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                  {filteredExams.map((exam) => (
                    <div
                      key={exam.id}
                      onClick={() => setSelectedExamId(exam.id)}
                      className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                        selectedExamId === exam.id
                          ? 'bg-blue-500/10 border-blue-500/40'
                          : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-amber-300">
                          {POST_UTME_UNIVERSITY_CODE}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePublishExam(exam);
                          }}
                          title={exam.is_published ? 'Unpublish' : 'Publish'}
                          className={`text-xs px-2 py-0.5 rounded-full font-bold flex items-center gap-1 ${
                            exam.is_published
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {exam.is_published ? <Eye size={12} /> : <EyeOff size={12} />}
                          {exam.is_published ? 'Live' : 'Draft'}
                        </button>
                      </div>
                      <h4 className="font-semibold text-white text-sm mt-2">{exam.title}</h4>
                      <p className="text-xs text-slate-500 mt-1">
                        {exam.subject} · {exam.year || 'No session'} · {exam.duration_minutes} min
                      </p>
                      <p className="text-[11px] text-slate-600 mt-1">
                        Imported {formatDateTime(exam.created_at)}
                      </p>
                      <div className="flex items-center gap-1 mt-3">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setCurrentExam({ ...exam });
                            setIsExamModalOpen(true);
                          }}
                          title="Edit paper"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            duplicateExam(exam);
                          }}
                          title="Duplicate paper"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-500/10"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteExam(exam);
                          }}
                          title="Delete paper"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {filteredExams.length === 0 && (
                    <p className="text-center py-10 text-slate-500 text-sm">No papers yet.</p>
                  )}
                </div>
              </div>

              {/* Questions */}
              <div className="lg:col-span-2 bg-[#0f172a] border border-slate-800 rounded-3xl p-6 space-y-5">
                {activeExam ? (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold px-2.5 py-1 rounded bg-slate-800 text-amber-300">
                            {POST_UTME_UNIVERSITY_CODE}
                          </span>
                          <span className="text-xs text-slate-500">
                            {activeExam.year || 'All sessions'} · {activeExam.duration_minutes} minutes
                          </span>
                        </div>
                        <h2 className="text-xl font-bold text-white mt-2">{activeExam.title}</h2>
                        <p className="text-xs text-slate-500 mt-1">
                          {questions.length} question{questions.length === 1 ? '' : 's'} · imported{' '}
                          {formatDateTime(activeExam.created_at)}
                          {attemptStats && attemptStats.count > 0 && (
                            <>
                              {' · '}
                              <Award size={12} className="inline -mt-0.5 text-amber-400" />{' '}
                              {attemptStats.count} attempt{attemptStats.count === 1 ? '' : 's'}, avg{' '}
                              {attemptStats.avg}%
                            </>
                          )}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-1">
                          {activeExam.is_published
                            ? 'Published — students can take this paper in CBT.'
                            : 'Unpublished — hidden from students, still editable here.'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Publish is per paper: a paper is the unit students
                            take, so this is what actually gates the CBT. */}
                        <button
                          onClick={() => togglePublishExam(activeExam)}
                          className={`px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors ${
                            activeExam.is_published
                              ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                              : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                          }`}
                        >
                          {activeExam.is_published ? <EyeOff size={16} /> : <Eye size={16} />}
                          {activeExam.is_published ? 'Unpublish' : 'Publish'}
                        </button>
                        <button
                          onClick={() => openQuestionForm()}
                          className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm flex items-center gap-2"
                        >
                          <Plus size={16} /> Add Question
                        </button>
                      </div>
                    </div>

                    {questions.length > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={allQuestionsSelected}
                            onChange={toggleSelectAllQuestions}
                            className="w-4 h-4 rounded border-slate-600 bg-slate-950 accent-amber-500"
                          />
                          Select all {questions.length}
                        </label>

                        {selectedQuestionIds.size > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-400">
                              {selectedQuestionIds.size} selected
                            </span>
                            <button
                              onClick={deleteSelectedQuestions}
                              className="px-3 py-1.5 rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 text-xs font-bold flex items-center gap-1.5"
                            >
                              <Trash2 size={14} /> Delete selected
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="space-y-4 max-h-[620px] overflow-y-auto pr-2">
                      {questions.map((q, index) => (
                        <div
                          key={q.id}
                          className="p-4 rounded-2xl bg-slate-950/50 border border-slate-800 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-center gap-2 flex-wrap">
                              <input
                                type="checkbox"
                                checked={selectedQuestionIds.has(q.id)}
                                onChange={() => toggleQuestionSelected(q.id)}
                                aria-label={`Select question ${index + 1}`}
                                className="w-4 h-4 rounded border-slate-600 bg-slate-950 accent-amber-500"
                              />
                              <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-300 font-bold text-xs flex items-center justify-center">
                                {index + 1}
                              </span>
                              <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-medium">
                                {q.difficulty || 'medium'}
                              </span>
                              {q.topic && (
                                <span className="text-xs text-amber-300/80">{q.topic}</span>
                              )}
                              <span className="text-xs text-slate-500">
                                {q.marks || 1} mark{(q.marks || 1) > 1 ? 's' : ''}
                              </span>
                              <span className="text-[11px] text-slate-600">
                                {formatDateTime(q.created_at)}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => openQuestionForm(q)}
                                title="Edit question"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => duplicateQuestion(q)}
                                title="Duplicate question"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-500/10"
                              >
                                <Copy size={16} />
                              </button>
                              <button
                                onClick={() => deleteQuestion(q)}
                                title="Delete question"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>

                          <p className="font-medium text-white text-sm">{q.question_text}</p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            {availableOptionLetters(q).map((opt) => {
                              const isCorrect = q.correct_option === opt;
                              return (
                                <div
                                  key={opt}
                                  className={`p-2 rounded-lg border ${
                                    isCorrect
                                      ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-200 font-bold'
                                      : 'bg-slate-950 border-slate-800 text-slate-300'
                                  }`}
                                >
                                  <span className="font-bold mr-2">{opt}:</span>
                                  {q[`option_${opt.toLowerCase()}`]}
                                </div>
                              );
                            })}
                          </div>

                          {q.explanation && (
                            <div className="text-xs bg-blue-500/5 text-blue-200 p-2.5 rounded-lg border border-blue-500/20">
                              <span className="font-bold">Explanation:</span> {q.explanation}
                            </div>
                          )}
                        </div>
                      ))}

                      {questions.length === 0 && (
                        <div className="text-center py-16 text-slate-500">
                          <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                          <p className="text-sm font-medium">No questions in this paper yet.</p>
                          <p className="text-xs mt-1">
                            Add one manually, or import a past paper from the AI PDF Importer tab.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-24 text-slate-500">
                    <Building2 className="w-12 h-12 mx-auto mb-3 opacity-40" />
                    <p>Select a paper, or create a new one.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* PDF importer                                                       */}
          {/* ------------------------------------------------------------------ */}
          {activeTab === 'importer' && (
            <div className="space-y-4">
              <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4 flex items-start gap-3">
                <Link2 size={18} className="text-blue-400 mt-0.5 shrink-0" />
                <div className="text-sm text-slate-300 space-y-1">
                  <p>
                    This importer writes to the <strong className="text-white">Post-UTME</strong>{' '}
                    question bank only. Choose a Post-UTME course and one of its topics below —
                    those are the existing Post-UTME courses and topics, not a separate list.
                  </p>
                  <p className="text-slate-400">
                    Extracted questions are saved to the bank as soon as extraction finishes, so a
                    refresh cannot lose them. Re-importing the same PDF skips what is already
                    there. Questions with no answer key are held back rather than saved with a
                    guessed answer.
                  </p>
                </div>
              </div>
              <AdminPdfUploader destType="Post-UTME" />
            </div>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* Topics                                                             */}
          {/* ------------------------------------------------------------------ */}
          {activeTab === 'topics' && (
            <div className="space-y-6">
              <SubjectPicker
                subjects={subjects}
                value={selectedSubjectId}
                onChange={(id) => {
                  setSelectedSubjectId(id);
                  setSelectedTopicTitle('');
                }}
                labelCls={labelCls}
                inputCls={inputCls}
              />

              {selectedSubject && (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-400">
                      Topics for{' '}
                      <strong className="text-white">
                        {selectedSubject.course_code} — {selectedSubject.title}
                      </strong>
                    </p>
                    <button
                      onClick={() => openTopicForm()}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl flex items-center gap-2 text-sm"
                    >
                      <Plus size={16} /> Add Topic
                    </button>
                  </div>

                  {subjectTopics.length === 0 ? (
                    <div className="text-center py-16 bg-[#0f172a] border border-slate-800 border-dashed rounded-2xl">
                      <Layers size={40} className="mx-auto text-slate-700 mb-3" />
                      <p className="text-slate-400 font-medium">No topics in this subject yet.</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Topics group questions and materials — e.g. “Algebra”, “Kinematics”.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {subjectTopics.map((t, i) => (
                        <div
                          key={t.id}
                          className={`bg-[#0f172a] border border-slate-800 rounded-2xl p-5 space-y-3 ${
                            t.is_archived ? 'opacity-60' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h4 className="font-bold text-white truncate">{t.title}</h4>
                              <p className="text-xs text-slate-500 mt-1">
                                {t.is_archived ? 'Archived' : `${i + 1} of ${subjectTopics.length}`}
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-wrap">
                            {!t.is_archived && i > 0 && (
                              <button
                                onClick={() => reorderTopic(subjectTopics, i, 'up')}
                                title="Move up"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
                              >
                                <ArrowUp size={16} />
                              </button>
                            )}
                            {!t.is_archived && i < subjectTopics.length - 1 && (
                              <button
                                onClick={() => reorderTopic(subjectTopics, i, 'down')}
                                title="Move down"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
                              >
                                <ArrowDown size={16} />
                              </button>
                            )}
                            <button
                              onClick={() => openTopicForm(t)}
                              title="Rename topic"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10"
                            >
                              <Edit2 size={16} />
                            </button>
                            {t.is_archived ? (
                              <button
                                onClick={() => setTopicArchived(t, false)}
                                title="Restore topic"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10"
                              >
                                <ArchiveRestore size={16} />
                              </button>
                            ) : (
                              <button
                                onClick={() => setTopicArchived(t, true)}
                                title="Archive topic (safe — keeps its materials)"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10"
                              >
                                <Archive size={16} />
                              </button>
                            )}
                            <button
                              onClick={() => deleteTopic(t)}
                              title="Delete topic"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ------------------------------------------------------------------ */}
          {/* Materials                                                          */}
          {/* ------------------------------------------------------------------ */}
          {activeTab === 'materials' && (
            <div className="space-y-6">
              <SubjectPicker
                subjects={subjects}
                value={selectedSubjectId}
                onChange={(id) => {
                  setSelectedSubjectId(id);
                  setSelectedTopicTitle('');
                }}
                labelCls={labelCls}
                inputCls={inputCls}
              />

              {selectedSubject && (
                <>
                  <div>
                    <label className={labelCls}>Topic</label>
                    <select
                      value={selectedTopicTitle}
                      onChange={(e) => setSelectedTopicTitle(e.target.value)}
                      className={`${inputCls} mt-1`}
                    >
                      <option value="">Select a topic…</option>
                      {subjectTopics
                        .filter((t) => !t.is_archived)
                        .map((t) => (
                          <option key={t.id} value={t.title}>
                            {t.title}
                          </option>
                        ))}
                    </select>
                    {subjectTopics.filter((t) => !t.is_archived).length === 0 && (
                      <p className="text-xs text-amber-400 mt-2">
                        This subject has no active topics. Create one in the Topics tab first —
                        materials are always filed under a subject + topic.
                      </p>
                    )}
                  </div>

                  {selectedTopicTitle && (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-slate-400">
                          Materials in{' '}
                          <strong className="text-white">
                            {selectedSubject.course_code} → {selectedTopicTitle}
                          </strong>
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setEditingLesson(null);
                              setShowLessonEditor(true);
                            }}
                            className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl flex items-center gap-2 text-sm"
                          >
                            <BookOpen size={16} /> New Lesson
                          </button>
                        </div>
                      </div>

                      {topicMaterials.length === 0 ? (
                        <div className="text-center py-16 bg-[#0f172a] border border-slate-800 border-dashed rounded-2xl">
                          <BookOpen size={40} className="mx-auto text-slate-700 mb-3" />
                          <p className="text-slate-400 font-medium">No materials in this topic yet.</p>
                          <p className="text-xs text-slate-500 mt-1">
                            A lesson carries readable content; an uploaded file attaches a PDF or slide deck.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {topicMaterials.map((m, i) => (
                            <div
                              key={m.id}
                              className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <h4 className="font-bold text-white truncate">{m.title}</h4>
                                  <span className="text-xs bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-medium">
                                    {formatFileType(m.file_type)}
                                  </span>
                                  <span
                                    className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                                      m.is_published
                                        ? 'bg-emerald-500/20 text-emerald-300'
                                        : 'bg-slate-800 text-slate-400'
                                    }`}
                                  >
                                    {m.is_published ? 'Published' : 'Draft'}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-500 mt-1">
                                  {m.file_type === 'lesson'
                                    ? 'Readable lesson content'
                                    : `${m.file_size || 'Unknown size'}`}
                                  {m.lecturer_name ? ` · ${m.lecturer_name}` : ''}
                                </p>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                {i > 0 && (
                                  <button
                                    onClick={() => reorderMaterial(topicMaterials, i, 'up')}
                                    title="Move up"
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
                                  >
                                    <ArrowUp size={16} />
                                  </button>
                                )}
                                {i < topicMaterials.length - 1 && (
                                  <button
                                    onClick={() => reorderMaterial(topicMaterials, i, 'down')}
                                    title="Move down"
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700"
                                  >
                                    <ArrowDown size={16} />
                                  </button>
                                )}
                                <button
                                  onClick={() => toggleMaterialPublish(m)}
                                  title={m.is_published ? 'Unpublish' : 'Publish'}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10"
                                >
                                  {m.is_published ? <Eye size={16} /> : <EyeOff size={16} />}
                                </button>
                                <button
                                  onClick={() => {
                                    // Lessons are the only authoring path here
                                    // now that file upload is withdrawn.
                                    setEditingLesson(m);
                                    setShowLessonEditor(true);
                                  }}
                                  title="Edit"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10"
                                >
                                  <Edit2 size={16} />
                                </button>
                                <button
                                  onClick={() => deleteMaterial(m)}
                                  title="Delete"
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Paper modal                                                           */}
      {/* -------------------------------------------------------------------- */}
      {isExamModalOpen && (
        <Modal onClose={() => setIsExamModalOpen(false)}>
          <h3 className="text-xl font-bold text-white">
            {currentExam.id ? 'Edit Paper' : 'New Post-UTME Paper'}
          </h3>
          <form onSubmit={handleSaveExam} className="space-y-4 mt-6">
            <div>
              <label className={labelCls}>Paper Title</label>
              <input
                required
                type="text"
                value={currentExam.title || ''}
                onChange={(e) => setCurrentExam({ ...currentExam, title: e.target.value })}
                placeholder="e.g. Mathematics Post-UTME 2024"
                className={`${inputCls} mt-1`}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>University</label>
                {/* Fixed: Post-UTME serves only the University of Ilorin. Shown
                    rather than offered as a choice, so no other university can
                    be written onto a paper. */}
                <div
                  className={`${inputCls} mt-1 flex items-center gap-2 opacity-80`}
                  title="Post-UTME is fixed to the University of Ilorin"
                >
                  <Building2 size={15} className="text-amber-400 shrink-0" />
                  <span className="truncate">
                    {POST_UTME_UNIVERSITY_NAME} ({POST_UTME_UNIVERSITY_CODE})
                  </span>
                </div>
              </div>
              <div>
                <label className={labelCls}>Subject</label>
                <select
                  required
                  value={currentExam.subject || ''}
                  onChange={(e) => {
                    const subject = e.target.value;
                    // Keep course_code in step with the subject so imported
                    // questions land under the right Post-UTME subject.
                    const match = subjects.find(
                      (s) => s.title === subject || s.course_code === subject,
                    );
                    setCurrentExam({
                      ...currentExam,
                      subject,
                      course_code: match?.course_code || currentExam.course_code || null,
                    });
                  }}
                  className={`${inputCls} mt-1`}
                >
                  <option value="">Select subject…</option>
                  {subjects.map((s) => (
                    <option key={s.id} value={s.title}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Year / Session</label>
                <input
                  type="text"
                  value={currentExam.year || ''}
                  onChange={(e) => setCurrentExam({ ...currentExam, year: e.target.value })}
                  placeholder="2023/2024"
                  className={`${inputCls} mt-1`}
                />
              </div>
              <div>
                <label className={labelCls}>Duration (minutes)</label>
                <input
                  type="number"
                  min={1}
                  value={currentExam.duration_minutes || 60}
                  onChange={(e) =>
                    setCurrentExam({ ...currentExam, duration_minutes: e.target.value })
                  }
                  className={`${inputCls} mt-1`}
                />
              </div>
            </div>
            <label className="flex items-center gap-2 pt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!!currentExam.is_published}
                onChange={(e) => setCurrentExam({ ...currentExam, is_published: e.target.checked })}
                className="w-4 h-4 rounded border-slate-600 bg-slate-950 accent-amber-500"
              />
              <span className="text-sm text-slate-300">
                Publish immediately so students can take it
              </span>
            </label>
            <div className="flex gap-4 pt-2">
              <button
                type="button"
                onClick={() => setIsExamModalOpen(false)}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                Save Paper
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Question modal                                                        */}
      {/* -------------------------------------------------------------------- */}
      {isQuestionModalOpen && (
        <Modal onClose={() => setIsQuestionModalOpen(false)} wide>
          <h3 className="text-xl font-bold text-white">
            {editingQuestionId ? 'Edit Question' : 'Add Question'}
          </h3>
          <form onSubmit={handleSaveQuestion} className="space-y-4 mt-6">
            <div>
              <label className={labelCls}>Question Text</label>
              <textarea
                required
                rows={3}
                value={currentQuestion.question_text || ''}
                onChange={(e) =>
                  setCurrentQuestion({ ...currentQuestion, question_text: e.target.value })
                }
                placeholder="Enter the question…"
                className={`${inputCls} mt-1`}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              {/* A–D are required; E is not — most questions stop at four, so a
                  blank fifth option is left out rather than saved as empty text. */}
              {['a', 'b', 'c', 'd', 'e'].map((letter) => (
                <div key={letter}>
                  <label className={labelCls}>Option {letter.toUpperCase()}</label>
                  <input
                    required={letter !== 'e'}
                    type="text"
                    value={currentQuestion[`option_${letter}`] || ''}
                    onChange={(e) =>
                      setCurrentQuestion({ ...currentQuestion, [`option_${letter}`]: e.target.value })
                    }
                    className={`${inputCls} mt-1`}
                  />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Correct Option</label>
                <select
                  value={currentQuestion.correct_option || 'A'}
                  onChange={(e) =>
                    setCurrentQuestion({ ...currentQuestion, correct_option: e.target.value })
                  }
                  className={`${inputCls} mt-1`}
                >
                  {OPTION_LETTERS.map((o) => (
                    <option key={o} value={o}>
                      Option {o}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Difficulty</label>
                <select
                  value={currentQuestion.difficulty || 'medium'}
                  onChange={(e) =>
                    setCurrentQuestion({ ...currentQuestion, difficulty: e.target.value })
                  }
                  className={`${inputCls} mt-1`}
                >
                  {['easy', 'medium', 'hard'].map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Marks</label>
                <input
                  type="number"
                  min={1}
                  value={currentQuestion.marks || 1}
                  onChange={(e) =>
                    setCurrentQuestion({ ...currentQuestion, marks: e.target.value })
                  }
                  className={`${inputCls} mt-1`}
                />
              </div>
              <div>
                <label className={labelCls}>Topic (optional)</label>
                <input
                  type="text"
                  list="post-utme-topic-options"
                  value={currentQuestion.topic || ''}
                  onChange={(e) => setCurrentQuestion({ ...currentQuestion, topic: e.target.value })}
                  placeholder="e.g. Algebra"
                  className={`${inputCls} mt-1`}
                />
                <datalist id="post-utme-topic-options">
                  {subjectTopics.map((t) => (
                    <option key={t.id} value={t.title} />
                  ))}
                </datalist>
              </div>
            </div>
            <div>
              <label className={labelCls}>Explanation</label>
              <textarea
                rows={2}
                value={currentQuestion.explanation || ''}
                onChange={(e) =>
                  setCurrentQuestion({ ...currentQuestion, explanation: e.target.value })
                }
                placeholder="Shown to students after submission…"
                className={`${inputCls} mt-1`}
              />
            </div>
            <div className="flex gap-4 pt-2">
              <button
                type="button"
                onClick={() => setIsQuestionModalOpen(false)}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl flex items-center justify-center gap-2"
              >
                {busy ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
                Save Question
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Topic modal                                                           */}
      {/* -------------------------------------------------------------------- */}
      {isTopicModalOpen && (
        <Modal onClose={() => setIsTopicModalOpen(false)}>
          <h3 className="text-xl font-bold text-white">
            {editingTopicId ? 'Rename Topic' : 'Add Topic'}
          </h3>
          <form onSubmit={handleSaveTopic} className="space-y-4 mt-6">
            <div>
              <label className={labelCls}>Subject</label>
              <input
                type="text"
                disabled
                value={
                  selectedSubject
                    ? `${selectedSubject.course_code} — ${selectedSubject.title}`
                    : ''
                }
                className={`${inputCls} mt-1 opacity-60`}
              />
            </div>
            <div>
              <label className={labelCls}>Topic Name</label>
              <input
                required
                type="text"
                value={topicName}
                onChange={(e) => setTopicName(e.target.value)}
                placeholder="e.g. Kinematics"
                className={`${inputCls} mt-1`}
              />
            </div>
            <div className="flex gap-4 pt-2">
              <button
                type="button"
                onClick={() => {
                  setIsTopicModalOpen(false);
                  setEditingTopicId(null);
                }}
                className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl"
              >
                {editingTopicId ? 'Update Topic' : 'Save Topic'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* -------------------------------------------------------------------- */}
      {/* Shared material components (reused as-is)                             */}
      {/* -------------------------------------------------------------------- */}
      {showLessonEditor && selectedSubject && selectedTopicTitle && (
        <LessonEditor
          courseCode={selectedSubject.course_code}
          topic={selectedTopicTitle}
          portal={PORTAL}
          semester={selectedSubject.semester || ''}
          lesson={editingLesson}
          onClose={() => {
            setShowLessonEditor(false);
            setEditingLesson(null);
          }}
          onSaved={() => {
            setShowLessonEditor(false);
            setEditingLesson(null);
            fetchSubjects();
          }}
        />
      )}

    </div>
  );
}

/** Subject (Post-UTME course) selector, shared by the Topics and Materials tabs. */
function SubjectPicker({
  subjects,
  value,
  onChange,
  labelCls,
  inputCls,
}: {
  subjects: any[];
  value: string;
  onChange: (id: string) => void;
  labelCls: string;
  inputCls: string;
}) {
  return (
    <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5">
      <label className={labelCls}>Post-UTME Subject</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputCls} mt-1`}>
        <option value="">Select a subject…</option>
        {subjects.map((s) => (
          <option key={s.id} value={s.id}>
            {s.course_code} — {s.title}
          </option>
        ))}
      </select>
      {subjects.length === 0 && (
        <p className="text-xs text-amber-400 mt-2 flex items-center gap-2">
          <GraduationCap size={14} />
          No Post-UTME subjects available. Create them in Course Management under the Post-UTME
          programme first.
        </p>
      )}
    </div>
  );
}

/** Modal shell matching the app's dark admin surface. */
function Modal({
  children,
  onClose,
  wide = false,
}: {
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className={`bg-[#0f172a] border border-slate-800 rounded-3xl p-8 w-full my-8 ${
          wide ? 'max-w-2xl' : 'max-w-lg'
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">{children}</div>
          <button onClick={onClose} className="text-slate-500 hover:text-white shrink-0">
            <X size={20} />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
