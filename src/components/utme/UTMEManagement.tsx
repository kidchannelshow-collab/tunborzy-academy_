import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Edit2, Trash2, CheckCircle2, ShieldAlert, BookOpen, Layers, FileText, Copy, Check, Eye, EyeOff, Sparkles, Archive, ArchiveRestore, ArrowUp, ArrowDown, Search, ClipboardList, Loader2, AlertCircle, X } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useProfile } from '../../lib/useProfile';
import AdminPdfUploader from '../cbt/AdminPdfUploader';

/**
 * Import date/time, shown on a category card and in the question list.
 * Mirrors the helper in `postutme/PostUtmeManagement.tsx` so both question
 * banks print dates the same way.
 */
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

/** Label + colours for a category's aggregate publish state. */
function categoryPill(state: 'published' | 'unpublished' | 'partial' | 'empty') {
  switch (state) {
    case 'published':
      return { label: 'Published', cls: 'bg-emerald-500/20 text-emerald-300' };
    case 'partial':
      return { label: 'Partly published', cls: 'bg-amber-500/20 text-amber-300' };
    case 'unpublished':
      return { label: 'Unpublished', cls: 'bg-slate-800 text-slate-400' };
    default:
      return { label: 'Empty', cls: 'bg-slate-800 text-slate-500' };
  }
}

export default function UTMEManagement() {
  const { profile } = useProfile();
  // Same derivation the Post-UTME and Undergraduate managers use, so the portal
  // badge reads identically across the three.
  const isLecturer = profile?.role === 'Lecturer';
  const [activeTab, setActiveTab] = useState<'subjects' | 'topics' | 'questions' | 'ai_generator'>('subjects');

  const [subjects, setSubjects] = useState<any[]>([]);
  const [topics, setTopics] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // Question Form Modal
  const [showQuestionModal, setShowQuestionModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [qSubjectId, setQSubjectId] = useState('');
  const [qTopicId, setQTopicId] = useState('');
  const [qText, setQText] = useState('');
  const [optA, setOptA] = useState('');
  const [optB, setOptB] = useState('');
  const [optC, setOptC] = useState('');
  const [optD, setOptD] = useState('');
  const [correctOpt, setCorrectOpt] = useState('A');
  const [explanation, setExplanation] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  // New questions default to 'published', not 'draft'.
  //
  // Every student-facing query gates on status = 'published' — /api/utme/start
  // (server.ts), the UTMEDashboard question count and its year/difficulty
  // pickers. A question saved as 'draft' is therefore invisible to the CBT: the
  // student who picks that subject sees "There are currently no published
  // questions matching your criteria" and the exam cannot start, while the
  // question still appears in this admin list (which filters on nothing), so
  // there is no signal that anything is wrong.
  //
  // Manually authoring a question is a deliberate act, so it is published unless
  // the administrator explicitly chooses otherwise from the status dropdown.
  const [status, setStatus] = useState('published'); // draft, under_review, approved, published
  const [year, setYear] = useState('2025');

  // Topic Form Modal
  const [showTopicModal, setShowTopicModal] = useState(false);
  const [topicName, setTopicName] = useState('');
  const [topicSubjectId, setTopicSubjectId] = useState('');
  // null = creating, an id = renaming that topic.
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);

  // --- Question Bank (category -> questions) ---------------------------------
  // The importer files every extracted question under a `utme_subjects` row, so
  // the subject is the natural "category" here — the same role a paper
  // (`post_utme_exams`) plays in the Post-UTME bank. No new grouping column is
  // introduced; the structure is derived from the questions already loaded.
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [categorySearch, setCategorySearch] = useState('');
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: subData } = await supabase.from('utme_subjects').select('*');
      setSubjects(subData || []);

      const { data: topData } = await supabase
        .from('utme_topics')
        .select('*, utme_subjects(name)')
        .order('order_index', { ascending: true })
        .order('name', { ascending: true });
      setTopics(topData || []);

      let qQuery = supabase.from('utme_questions').select('*, utme_subjects(name), utme_topics(name)');
      if (profile?.role === 'Lecturer') {
        // Lecturers should only see questions for their assigned subjects or created by them
        // For simplicity, we filter by created_by or let RLS handle it
      }
      const { data: qData } = await qQuery;
      setQuestions(qData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        subject_id: qSubjectId,
        topic_id: qTopicId || null,
        question_text: qText,
        option_a: optA,
        option_b: optB,
        option_c: optC,
        option_d: optD,
        correct_option: correctOpt,
        explanation,
        difficulty,
        status,
        year,
        created_by: profile?.id
      };

      if (editingId) {
        const { error } = await supabase.from('utme_questions').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('utme_questions').insert([payload]);
        if (error) throw error;
      }

      setShowQuestionModal(false);
      resetQuestionForm();
      fetchData();
    } catch (err: any) {
      setErrorMsg('Error saving question: ' + err.message);
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    if (!confirm('Are you sure you want to delete this question?')) return;
    await supabase.from('utme_questions').delete().eq('id', id);
    fetchData();
  };

  const handleDuplicateQuestion = async (q: any) => {
    try {
      const { id, created_at, updated_at, ...rest } = q;
      await supabase.from('utme_questions').insert([{
        ...rest,
        question_text: `${q.question_text} (Copy)`,
        status: 'draft'
      }]);
      fetchData();
    } catch (err: any) {
      setErrorMsg('Error duplicating: ' + err.message);
    }
  };

  const openTopicForm = (topic: any = null) => {
    setEditingTopicId(topic?.id ?? null);
    setTopicName(topic?.name ?? '');
    setTopicSubjectId(topic?.subject_id ?? '');
    setShowTopicModal(true);
  };

  const handleSaveTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingTopicId) {
        const { error } = await supabase
          .from('utme_topics')
          .update({ name: topicName, subject_id: topicSubjectId })
          .eq('id', editingTopicId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('utme_topics').insert([{
          name: topicName,
          subject_id: topicSubjectId,
          order_index: topics.filter((t) => t.subject_id === topicSubjectId).length,
        }]);
        if (error) throw error;
      }
      setShowTopicModal(false);
      setEditingTopicId(null);
      setTopicName('');
      fetchData();
    } catch (err: any) {
      setErrorMsg('Error saving topic: ' + err.message);
    }
  };

  // Archive reuses is_active (migration 0054) rather than deleting: an archived
  // topic keeps every question filed under it, but drops out of the pickers.
  const setTopicActive = async (topic: any, isActive: boolean) => {
    const { error } = await supabase.from('utme_topics').update({ is_active: isActive }).eq('id', topic.id);
    if (error) {
      setErrorMsg(`Error: ${error.message}`);
      return;
    }
    fetchData();
  };

  const deleteTopic = async (topic: any) => {
    // utme_questions.topic_id is ON DELETE SET NULL, so deleting a topic would
    // silently strip the topic off every question filed under it.
    const attached = questions.filter((q) => q.topic_id === topic.id).length;
    if (attached > 0) {
      setErrorMsg(`"${topic.name}" still has ${attached} question(s). Archive it instead, or re-file those questions first.`);
      return;
    }
    if (!window.confirm(`Delete the topic "${topic.name}"? This cannot be undone.`)) return;
    const { error } = await supabase.from('utme_topics').delete().eq('id', topic.id);
    if (error) {
      setErrorMsg(`Error: ${error.message}`);
      return;
    }
    fetchData();
  };

  const reorderTopic = async (list: any[], index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const a = list[index];
    const b = list[targetIndex];
    // True swap, matching admin/CourseManagement.tsx: give each row its
    // neighbour's order_index so they exchange places instead of colliding.
    const results = await Promise.all([
      supabase.from('utme_topics').update({ order_index: b.order_index ?? targetIndex }).eq('id', a.id),
      supabase.from('utme_topics').update({ order_index: a.order_index ?? index }).eq('id', b.id),
    ]);
    const failed = results.find((r: any) => r.error);
    if (failed) {
      setErrorMsg(`Error: ${failed.error.message}`);
      return;
    }
    fetchData();
  };

  // Archive state lives on the pre-existing is_active column. Archived rows are
  // excluded from the pickers below so a question cannot be filed under a
  // subject that has been retired. Compared against `false` explicitly rather
  // than testing truthiness, so a NULL is_active counts as active.
  const activeSubjects = subjects.filter((s) => s.is_active !== false);
  const activeTopics = topics.filter((t) => t.is_active !== false);
  const archivedTopics = topics.filter((t) => t.is_active === false);

  const resetQuestionForm = () => {
    setEditingId(null);
    setQSubjectId('');
    setQTopicId('');
    setQText('');
    setOptA('');
    setOptB('');
    setOptC('');
    setOptD('');
    setCorrectOpt('A');
    setExplanation('');
    // Matches the initial state above — see the comment there. Resetting to
    // 'draft' would re-introduce the trap on the second question an admin adds.
    setStatus('published');
  };

  const openEditQuestion = (q: any) => {
    setEditingId(q.id);
    setQSubjectId(q.subject_id);
    setQTopicId(q.topic_id || '');
    setQText(q.question_text);
    setOptA(q.option_a);
    setOptB(q.option_b);
    setOptC(q.option_c);
    setOptD(q.option_d);
    setCorrectOpt(q.correct_option);
    setExplanation(q.explanation || '');
    setDifficulty(q.difficulty || 'medium');
    setStatus(q.status || 'draft');
    setYear(q.year || '2025');
    setShowQuestionModal(true);
  };

  // ---------------------------------------------------------------------------
  // Question bank: categories derived from the loaded questions
  // ---------------------------------------------------------------------------

  /**
   * One entry per UTME subject, carrying everything the category card shows.
   * Built from the questions already in memory, so opening the bank costs no
   * extra queries and cannot disagree with the list it opens into.
   */
  const categories = useMemo(() => {
    return subjects
      .map((subject) => {
        const own = questions.filter((q) => q.subject_id === subject.id);
        const published = own.filter((q) => q.status === 'published').length;

        // Newest first for the "imported" line: a re-import into an existing
        // subject should show the new date, not the subject's creation date.
        const latestImport = own.reduce<string | null>((latest, q) => {
          if (!q.created_at) return latest;
          return !latest || q.created_at > latest ? q.created_at : latest;
        }, null);

        const topicNames = Array.from(
          new Set(own.map((q) => q.utme_topics?.name).filter(Boolean)),
        ) as string[];

        return {
          ...subject,
          questions: own,
          count: own.length,
          published,
          latestImport,
          topicNames,
        };
      })
      // A subject with no questions is still a real category — it is where the
      // next import lands — so it is kept, just sorted after the populated ones.
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
  }, [subjects, questions]);

  const filteredCategories = useMemo(() => {
    const term = categorySearch.trim().toLowerCase();
    if (!term) return categories;
    return categories.filter(
      (c) =>
        String(c.name || '').toLowerCase().includes(term) ||
        String(c.code || '').toLowerCase().includes(term),
    );
  }, [categories, categorySearch]);

  // Falls back to the first category rather than storing a default in state, so
  // the list is never blank on first paint and cannot go stale after a refresh.
  const activeCategory = useMemo(
    () =>
      categories.find((c) => c.id === selectedCategoryId) || categories[0] || null,
    [categories, selectedCategoryId],
  );

  const categoryQuestions = useMemo(() => {
    if (!activeCategory) return [];
    return [...activeCategory.questions].sort((a, b) =>
      String(a.created_at || '').localeCompare(String(b.created_at || '')),
    );
  }, [activeCategory]);

  // Ticks belong to the category they were made in. Without this, opening
  // another subject would keep them and "Delete selected" would reach across
  // into questions the administrator is no longer looking at.
  useEffect(() => {
    setSelectedQuestionIds(new Set());
  }, [activeCategory?.id]);

  // 'published' | 'draft' | 'partial' — the single state shown on the card.
  const categoryState = (category: { count: number; published: number }) => {
    if (category.count === 0) return 'empty' as const;
    if (category.published === 0) return 'unpublished' as const;
    if (category.published === category.count) return 'published' as const;
    return 'partial' as const;
  };

  const toggleQuestionSelected = (id: string) => {
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allQuestionsSelected =
    categoryQuestions.length > 0 && selectedQuestionIds.size === categoryQuestions.length;

  const toggleSelectAllQuestions = () => {
    setSelectedQuestionIds(
      allQuestionsSelected ? new Set() : new Set(categoryQuestions.map((q) => q.id)),
    );
  };

  const deleteSelectedQuestions = async () => {
    const ids = Array.from(selectedQuestionIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected question(s)? This cannot be undone.`)) return;

    const { error } = await supabase.from('utme_questions').delete().in('id', ids);
    if (error) {
      setErrorMsg(`Error: ${error.message}`);
      return;
    }
    setSelectedQuestionIds(new Set());
    fetchData();
  };

  /**
   * Publish / unpublish every question in the open category.
   *
   * This is a bulk `status` update, not a new flag: `utme_questions.status`
   * already exists and every student-facing query — /api/utme/start included —
   * gates on `status = 'published'`, so unpublishing genuinely removes the
   * questions from the CBT rather than only hiding them here.
   */
  const setCategoryStatus = async (category: any, nextStatus: 'published' | 'draft') => {
    if (category.count === 0) return;
    const verb = nextStatus === 'published' ? 'Publish' : 'Unpublish';
    if (
      !window.confirm(
        `${verb} all ${category.count} question(s) in "${category.name}"?` +
          (nextStatus === 'draft'
            ? ' Students will no longer see them in the UTME CBT.'
            : ' Students will see them in the UTME CBT.'),
      )
    ) {
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase
        .from('utme_questions')
        .update({ status: nextStatus })
        .eq('subject_id', category.id);
      if (error) throw error;
      await fetchData();
    } catch (err: any) {
      setErrorMsg(`Error: ${err?.message || 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0f172a] border border-slate-800 p-8 rounded-3xl">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 px-3 py-1 rounded-full">
            {isLecturer ? 'Lecturer Portal' : 'Admin Portal'}
          </span>
          <h1 className="text-3xl font-display font-bold text-white mt-2 flex items-center gap-3">
            <ClipboardList className="text-blue-400" size={28} /> UTME Question Bank Management
          </h1>
          <p className="text-slate-400 mt-1">Manage subjects, topics, question workflows, and publication status.</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => { resetQuestionForm(); setShowQuestionModal(true); }}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl flex items-center gap-2 transition-colors"
          >
            <Plus size={20} /> Add UTME Question
          </button>
        </div>
      </div>

      {/* Error banner — the Post-UTME and Undergraduate managers surface failures
          here rather than interrupting with a browser alert. */}
      {errorMsg && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-300 text-sm flex items-start gap-2">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span className="flex-1">{errorMsg}</span>
          <button
            onClick={() => setErrorMsg('')}
            className="text-rose-300 hover:text-white transition-colors"
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Tabs. `flex-wrap` matches the other two managers so the row wraps
          instead of overflowing on narrow screens. */}
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-4">
        {[
          { id: 'subjects', label: 'UTME Subjects', icon: BookOpen },
          { id: 'topics', label: 'Topics', icon: Layers },
          { id: 'questions', label: 'Question Bank', icon: FileText },
          { id: 'ai_generator', label: 'AI PDF Generator', icon: Sparkles }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
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

      {/* Loading state. `loading` was already tracked but never rendered, so the
          bank appeared empty for the moment before the fetch resolved — the same
          silent gap the other two managers cover with a spinner. The ternary
          gates the tab content, matching Post-UTME and Undergraduate, so the
          empty states cannot flash behind the spinner. */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={28} className="animate-spin text-blue-400" />
            <p className="text-sm text-slate-400">Loading UTME content…</p>
          </div>
        </div>
      ) : (
        <>
      {activeTab === 'ai_generator' && (
        <div className="py-4 space-y-4">
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-blue-300 flex items-center gap-2">
              <Sparkles size={16} /> Import UTME questions from a document
            </h3>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Upload a past question paper as PDF or plain text. Questions are detected from the
              document's own layout and answer key, then reviewed here before anything is saved to
              the UTME question bank.
            </p>
          </div>
          {/* `destType` is passed explicitly for the same reason the other two
              managers pass it: the default happens to be 'UTME', but relying on
              the default makes the destination invisible at the call site. */}
          <AdminPdfUploader destType="UTME" />
        </div>
      )}

      {activeTab === 'subjects' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {subjects.map(sub => (
            <div key={sub.id} className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 space-y-4">
              <div className="flex justify-between items-start">
                <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded-full">{sub.code}</span>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${sub.is_active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-400'}`}>
                  {sub.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <h3 className="text-xl font-bold text-white">{sub.name}</h3>
              <p className="text-sm text-slate-400">{sub.description}</p>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'topics' && (
        <div className="space-y-6">
          <div className="flex justify-end">
            <button
              onClick={() => openTopicForm()}
              className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-xl flex items-center gap-2 text-sm"
            >
              <Plus size={16} /> Add Topic
            </button>
          </div>

          {activeTopics.length === 0 && archivedTopics.length === 0 ? (
            <div className="text-center py-16 bg-[#0f172a] border border-slate-800 border-dashed rounded-2xl">
              <Layers size={40} className="mx-auto text-slate-700 mb-3" />
              <p className="text-slate-400 font-medium">No UTME topics yet.</p>
              <p className="text-xs text-slate-500 mt-1">Use “Add Topic” to create one.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {activeTopics.map((t, i) => (
                  <div key={t.id} className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5 flex items-center justify-between group">
                    <div className="min-w-0">
                      <h4 className="font-bold text-white truncate">{t.name}</h4>
                      <p className="text-xs text-emerald-400 mt-1">{t.utme_subjects?.name}</p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {i > 0 && (
                        <button onClick={() => reorderTopic(activeTopics, i, 'up')} title="Move up" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700">
                          <ArrowUp size={16} />
                        </button>
                      )}
                      {i < activeTopics.length - 1 && (
                        <button onClick={() => reorderTopic(activeTopics, i, 'down')} title="Move down" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700">
                          <ArrowDown size={16} />
                        </button>
                      )}
                      <button onClick={() => openTopicForm(t)} title="Rename topic" className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10">
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => setTopicActive(t, false)} title="Archive topic (safe — keeps its questions)" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10">
                        <Archive size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {archivedTopics.length > 0 && (
                <div className="pt-2">
                  <p className="text-xs uppercase tracking-wider text-slate-500 mb-3">Archived topics</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {archivedTopics.map((t) => (
                      <div key={t.id} className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5 flex items-center justify-between opacity-60">
                        <div className="min-w-0">
                          <h4 className="font-bold text-white truncate">{t.name}</h4>
                          <p className="text-xs text-slate-500 mt-1">{t.utme_subjects?.name} · archived</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => setTopicActive(t, true)} title="Restore topic" className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10">
                            <ArchiveRestore size={16} />
                          </button>
                          <button onClick={() => deleteTopic(t)} title="Delete topic" className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'questions' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Categories — one per UTME subject, mirroring the Post-UTME paper list */}
          <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-white">Categories</h3>
              <span className="text-xs bg-blue-500/10 text-blue-300 font-bold px-2.5 py-1 rounded-full">
                {filteredCategories.length}
              </span>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3.5" />
              <input
                type="text"
                value={categorySearch}
                onChange={(e) => setCategorySearch(e.target.value)}
                placeholder="Search subject or code…"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 pl-9 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
              {filteredCategories.map((c) => {
                const state = categoryState(c);
                const pill = categoryPill(state);
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelectedCategoryId(c.id)}
                    className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                      activeCategory?.id === c.id
                        ? 'bg-blue-500/10 border-blue-500/40'
                        : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-amber-300">
                        {c.code || '—'}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${pill.cls}`}>
                        {pill.label}
                      </span>
                    </div>
                    <h4 className="font-semibold text-white text-sm mt-2">{c.name}</h4>
                    <p className="text-xs text-slate-500 mt-1">
                      {c.count} question{c.count === 1 ? '' : 's'}
                      {c.count > 0 ? ` · ${c.published} published` : ''}
                      {c.topicNames.length > 0
                        ? ` · ${c.topicNames.slice(0, 2).join(', ')}${
                            c.topicNames.length > 2 ? '…' : ''
                          }`
                        : ''}
                    </p>
                    <p className="text-[11px] text-slate-600 mt-1">
                      Imported {formatDateTime(c.latestImport)}
                    </p>
                  </div>
                );
              })}
              {filteredCategories.length === 0 && (
                <p className="text-center py-10 text-slate-500 text-sm">No subjects found.</p>
              )}
            </div>
          </div>

          {/* Questions in the open category */}
          <div className="lg:col-span-2 bg-[#0f172a] border border-slate-800 rounded-3xl p-6 space-y-5">
            {activeCategory ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold px-2.5 py-1 rounded bg-slate-800 text-amber-300">
                        {activeCategory.code || '—'}
                      </span>
                      <span className="text-xs text-slate-500">
                        {activeCategory.topicNames.length > 0
                          ? activeCategory.topicNames.join(' · ')
                          : 'No topics yet'}
                      </span>
                    </div>
                    <h2 className="text-xl font-bold text-white mt-2">{activeCategory.name}</h2>
                    <p className="text-xs text-slate-500 mt-1">
                      {activeCategory.count} question{activeCategory.count === 1 ? '' : 's'} · imported{' '}
                      {formatDateTime(activeCategory.latestImport)}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-1">
                      {(() => {
                        const state = categoryState(activeCategory);
                        if (state === 'empty') {
                          return 'No questions yet — import a past paper or add one manually.';
                        }
                        if (state === 'published') {
                          return 'Published — students can take these in the UTME CBT.';
                        }
                        if (state === 'unpublished') {
                          return 'Unpublished — hidden from students, still editable here.';
                        }
                        return `${activeCategory.published} of ${activeCategory.count} published — the rest are hidden from students.`;
                      })()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Publish is per category: it flips `utme_questions.status`,
                        which is what the student CBT and /api/utme/start gate on. */}
                    <button
                      onClick={() =>
                        setCategoryStatus(
                          activeCategory,
                          categoryState(activeCategory) === 'published' ? 'draft' : 'published',
                        )
                      }
                      disabled={busy || activeCategory.count === 0}
                      className={`px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        categoryState(activeCategory) === 'published'
                          ? 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                          : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
                      }`}
                    >
                      {categoryState(activeCategory) === 'published' ? (
                        <>
                          <Eye size={16} /> Unpublish
                        </>
                      ) : (
                        <>
                          <Eye size={16} /> Publish
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        resetQuestionForm();
                        setQSubjectId(activeCategory.id);
                        setShowQuestionModal(true);
                      }}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm flex items-center gap-2"
                    >
                      <Plus size={16} /> Add Question
                    </button>
                  </div>
                </div>

                {categoryQuestions.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allQuestionsSelected}
                        onChange={toggleSelectAllQuestions}
                        className="w-4 h-4 rounded border-slate-600 bg-slate-950 accent-amber-500"
                      />
                      Select all {categoryQuestions.length}
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
                  {categoryQuestions.map((q, index) => (
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
                          {q.utme_topics?.name && (
                            <span className="text-xs text-amber-300/80">{q.utme_topics.name}</span>
                          )}
                          {q.year && (
                            <span className="text-xs text-slate-500">{q.year}</span>
                          )}
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                              q.status === 'published'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : q.status === 'approved'
                                ? 'bg-blue-500/20 text-blue-300'
                                : q.status === 'under_review'
                                ? 'bg-amber-500/20 text-amber-300'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {String(q.status || 'draft').replace('_', ' ')}
                          </span>
                          <span className="text-[11px] text-slate-600">
                            {formatDateTime(q.created_at)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEditQuestion(q)}
                            title="Edit question"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-amber-400 hover:bg-amber-500/10"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDuplicateQuestion(q)}
                            title="Duplicate question"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-500/10"
                          >
                            <Copy size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteQuestion(q.id)}
                            title="Delete question"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      <p className="font-medium text-white text-sm">{q.question_text}</p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                        {['A', 'B', 'C', 'D'].map((opt) => {
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

                  {categoryQuestions.length === 0 && (
                    <div className="text-center py-16 text-slate-500">
                      <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
                      <p className="text-sm font-medium">No questions in this subject yet.</p>
                      <p className="text-xs mt-1">
                        Add one manually, or import a past paper from the AI PDF Generator tab.
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="text-center py-24 text-slate-500">
                <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p>Select a category, or create a subject first.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Question Modal */}
        </>
      )}

      {showQuestionModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="bg-[#0f172a] border border-slate-800 rounded-3xl p-8 max-w-2xl w-full space-y-6 my-8">
            <h3 className="text-2xl font-bold text-white">{editingId ? 'Edit UTME Question' : 'Create UTME Question'}</h3>
            
            <form onSubmit={handleSaveQuestion} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-400">Subject</label>
                  <select
                    required
                    value={qSubjectId}
                    onChange={(e) => setQSubjectId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white mt-1"
                  >
                    <option value="">Select Subject...</option>
                    {activeSubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-400">Workflow Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white mt-1"
                  >
                    <option value="draft">Draft</option>
                    <option value="under_review">Under Review</option>
                    <option value="approved">Approved</option>
                    <option value="published">Published</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-400">Question Text</label>
                <textarea
                  required
                  rows={3}
                  value={qText}
                  onChange={(e) => setQText(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white mt-1"
                  placeholder="Type question here..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-400">Option A</label>
                  <input required type="text" value={optA} onChange={(e) => setOptA(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white mt-1" />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-400">Option B</label>
                  <input required type="text" value={optB} onChange={(e) => setOptB(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white mt-1" />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-400">Option C</label>
                  <input required type="text" value={optC} onChange={(e) => setOptC(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white mt-1" />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-400">Option D</label>
                  <input required type="text" value={optD} onChange={(e) => setOptD(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white mt-1" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-slate-400">Correct Answer</label>
                  <select value={correctOpt} onChange={(e) => setCorrectOpt(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white mt-1">
                    <option value="A">Option A</option>
                    <option value="B">Option B</option>
                    <option value="C">Option C</option>
                    <option value="D">Option D</option>
                  </select>
                </div>

                <div>
                  <label className="text-sm font-medium text-slate-400">Difficulty</label>
                  <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white mt-1">
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-slate-400">Explanation</label>
                <textarea rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white mt-1" placeholder="Explanation for answer..." />
              </div>

              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setShowQuestionModal(false)} className="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl">Cancel</button>
                <button type="submit" className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl">Save Question</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Topic Modal */}
      {showTopicModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="bg-[#0f172a] border border-slate-800 rounded-3xl p-8 max-w-md w-full space-y-6">
            <h3 className="text-xl font-bold text-white">{editingTopicId ? 'Edit UTME Topic' : 'Add UTME Topic'}</h3>
            <form onSubmit={handleSaveTopic} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-slate-400">Subject</label>
                <select required value={topicSubjectId} onChange={(e) => setTopicSubjectId(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white mt-1">
                  <option value="">Select Subject...</option>
                  {activeSubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-400">Topic Name</label>
                <input required type="text" value={topicName} onChange={(e) => setTopicName(e.target.value)} className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-white mt-1" placeholder="e.g. Kinematics" />
              </div>
              <div className="flex gap-4 pt-2">
                <button type="button" onClick={() => { setShowTopicModal(false); setEditingTopicId(null); }} className="flex-1 py-3 bg-slate-800 text-white font-bold rounded-xl">Cancel</button>
                <button type="submit" className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl">{editingTopicId ? 'Update Topic' : 'Save Topic'}</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
