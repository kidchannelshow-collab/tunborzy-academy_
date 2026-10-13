import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen, Layers, ArrowLeft, Loader2, ChevronRight, ArrowRight,
  PlayCircle, Award, Sparkles, FileText, CheckCircle2, Circle
} from 'lucide-react';
import DashboardLayout from '../dashboard/DashboardLayout';
import { supabase } from '../../supabaseClient';
import { useProfile } from '../../lib/useProfile';
import StudentLessonViewer from '../materials/StudentLessonViewer';

/**
 * Post-UTME learning view — Course -> Topic -> Material/Lesson -> Content.
 *
 * Post-UTME subjects live in `courses` with `portal = 'Post-UTME'`; their topics
 * are `course_modules` rows, and lessons/materials are `materials` rows keyed by
 * `course_code` + `topic`. This is the same data the Post-UTME Manager and
 * Course Management write, read here for students who are not staff.
 *
 * The content level reuses `StudentLessonViewer` unchanged — it already renders
 * the `{ blocks, attachments, publishSettings }` JSON that `LessonEditor` writes.
 *
 * Note on progress: the `visited` set below only drives the in-page progress
 * bars for THIS session. Durable completion now lives in `material_progress` and
 * is read and written by `StudentLessonViewer` itself, so a lesson marked
 * complete here persists and is still marked after a reload — the bars on this
 * page are a session convenience layered on top of that, not the source of
 * truth.
 */

interface PostUtmeLearningPageProps {
  onLogout: () => void;
  onNavigate?: (view: string) => void;
}

export default function PostUtmeLearningPage({ onLogout, onNavigate }: PostUtmeLearningPageProps) {
  const { profile } = useProfile();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [courses, setCourses] = useState<any[]>([]);
  const [topics, setTopics] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);

  const [selectedCourse, setSelectedCourse] = useState<any | null>(null);
  const [openTopic, setOpenTopic] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<any | null>(null);

  // Material ids opened this session, for the progress bars.
  const [visited, setVisited] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchCourses();
  }, []);

  const fetchCourses = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('courses')
        .select('*')
        .eq('portal', 'Post-UTME')
        .eq('status', 'Published')
        // Archiving is a deliberate staff action meaning "retire this", so it
        // must not stay browsable.
        .eq('is_archived', false)
        .order('order_index', { ascending: true })
        .order('title', { ascending: true });

      if (err) throw err;
      setCourses(data || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load Post-UTME courses.');
    } finally {
      setLoading(false);
    }
  };

  const openCourse = async (course: any) => {
    setLoading(true);
    setError(null);
    setSelectedCourse(course);
    setOpenTopic(null);
    try {
      const [modulesRes, materialsRes] = await Promise.all([
        supabase
          .from('course_modules')
          .select('*')
          .eq('course_id', course.id)
          // Archived topics are hidden from students.
          .eq('is_archived', false)
          .order('order_index', { ascending: true }),
        supabase
          .from('materials')
          .select('*')
          .eq('course_code', course.course_code)
          .eq('is_published', true)
          .order('order_index', { ascending: true })
          .order('created_at', { ascending: true }),
      ]);

      if (modulesRes.error) throw modulesRes.error;
      if (materialsRes.error) throw materialsRes.error;

      const moduleRows = modulesRes.data || [];
      const materialRows = materialsRes.data || [];

      setTopics(moduleRows);
      setMaterials(materialRows);

      // Open the first topic that actually holds published content, so a student
      // landing on a course is not greeted by an empty accordion.
      const firstWithContent = moduleRows.find((t: any) =>
        materialRows.some((m: any) => m.topic === t.title),
      );
      setOpenTopic(firstWithContent?.title ?? moduleRows[0]?.title ?? null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load this course.');
    } finally {
      setLoading(false);
    }
  };

  /** Materials grouped by topic title, in topic order. */
  const topicGroups = useMemo(() => {
    return topics.map((t) => ({
      title: t.title,
      materials: materials.filter((m) => m.topic === t.title),
    }));
  }, [topics, materials]);

  /**
   * Every material in the course, flattened in reading order (topic order, then
   * material order). Prev/Next walk this, so navigation continues across topic
   * boundaries instead of stopping at the end of a topic.
   */
  const flatLessons = useMemo(
    () => topicGroups.flatMap((g) => g.materials),
    [topicGroups],
  );

  const courseProgress = useMemo(() => {
    if (flatLessons.length === 0) return 0;
    const done = flatLessons.filter((m) => visited.has(m.id)).length;
    return Math.round((done / flatLessons.length) * 100);
  }, [flatLessons, visited]);

  const openLesson = (material: any) => {
    setSelectedMaterial(material);
    setVisited((prev) => new Set(prev).add(material.id));
  };

  const back = () => {
    if (selectedMaterial) {
      setSelectedMaterial(null);
    } else if (selectedCourse) {
      setSelectedCourse(null);
      setTopics([]);
      setMaterials([]);
      fetchCourses();
    }
  };

  // ---------------------------------------------------------------------------
  // Content level — reuses the shared lesson viewer
  // ---------------------------------------------------------------------------
  if (selectedMaterial) {
    return (
      <DashboardLayout onLogout={onLogout} currentView="academic-materials" onNavigate={onNavigate}>
        {/* StudentLessonViewer is a full-screen overlay that owns its own header,
            breadcrumb, progress bar and Prev/Next footer, so it is rendered
            bare here exactly as AcademicMaterialsPage does. Its Prev/Next walk
            the viewer's own sibling query, which is scoped to this
            course_code + topic; onNavigateToSibling swaps the lesson in. */}
        <StudentLessonViewer
          material={selectedMaterial}
          onClose={back}
          onNavigateToSibling={(siblingId) => {
            const sibling = materials.find((m) => m.id === siblingId);
            if (sibling) openLesson(sibling);
          }}
        />
      </DashboardLayout>
    );
  }

  // ---------------------------------------------------------------------------
  // Course -> Topic -> Material
  // ---------------------------------------------------------------------------
  return (
    <DashboardLayout onLogout={onLogout} currentView="academic-materials" onNavigate={onNavigate}>
      <div className="max-w-5xl mx-auto space-y-8 pb-12">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 text-amber-400 mb-2">
              <Award size={24} />
              <h2 className="font-bold tracking-widest uppercase text-sm">Post-UTME</h2>
            </div>
            <h1 className="text-3xl font-display font-bold text-white">Learning Materials</h1>
            <p className="text-slate-400 mt-2">
              Work through each subject topic by topic, then test yourself in CBT.
            </p>
          </div>

          <button
            onClick={() => onNavigate?.('utme')}
            className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl flex items-center gap-2 transition-colors text-sm self-start md:self-auto"
          >
            <Sparkles size={18} /> Practice CBT
          </button>
        </div>

        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-300 p-4 rounded-2xl flex items-center justify-between gap-4">
            <p className="text-sm">{error}</p>
            <button
              onClick={() => (selectedCourse ? openCourse(selectedCourse) : fetchCourses())}
              className="px-3 py-1 bg-rose-500/20 rounded-lg hover:bg-rose-500/30 text-sm font-bold shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {(selectedCourse || topics.length > 0) && (
          <button
            onClick={back}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            <span className="font-medium text-sm">Back to subjects</span>
          </button>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-amber-500 mb-4" />
            <p>Loading materials…</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {/* --- Course list --- */}
            {!selectedCourse && (
              <motion.div
                key="courses"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="grid grid-cols-1 sm:grid-cols-2 gap-4"
              >
                {courses.length > 0 ? (
                  courses.map((course) => (
                    <button
                      key={course.id}
                      onClick={() => openCourse(course)}
                      className="bg-[#0f172a] border border-slate-800 hover:border-amber-500/50 p-6 rounded-2xl text-left transition-all group flex flex-col h-full"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <span className="bg-amber-500/10 text-amber-400 px-3 py-1 rounded-lg text-sm font-bold uppercase tracking-wider">
                          {course.course_code || 'Subject'}
                        </span>
                        <ChevronRight className="text-slate-600 group-hover:text-amber-400 transition-colors" />
                      </div>
                      <h3 className="text-lg font-bold text-white mb-2 line-clamp-2">
                        {course.title}
                      </h3>
                      {course.description && (
                        <p className="text-slate-400 text-sm mb-4 line-clamp-2 flex-1">
                          {course.description}
                        </p>
                      )}
                      <div className="mt-auto pt-4 border-t border-slate-800/50 flex items-center text-sm text-slate-500">
                        <BookOpen size={14} className="mr-2" />
                        Open topics and lessons
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="col-span-full text-center py-16 bg-[#0f172a] border border-slate-800 rounded-2xl">
                    <BookOpen className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                    <p className="text-slate-400">No Post-UTME materials are published yet.</p>
                    <p className="text-xs text-slate-500 mt-2">
                      Check back soon — your subjects will appear here once published.
                    </p>
                  </div>
                )}
              </motion.div>
            )}

            {/* --- Topics + materials --- */}
            {selectedCourse && (
              <motion.div
                key="topics"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                {/* Course header + progress */}
                <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-6 md:p-8 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3" />
                  <div className="relative z-10 space-y-5">
                    <div>
                      <span className="bg-amber-500/20 text-amber-400 px-3 py-1 rounded-lg text-sm font-bold uppercase tracking-wider mb-4 inline-block">
                        {selectedCourse.course_code}
                      </span>
                      <h2 className="text-2xl md:text-3xl font-bold text-white mb-2">
                        {selectedCourse.title}
                      </h2>
                      {selectedCourse.description && (
                        <p className="text-slate-400 max-w-2xl text-sm md:text-base">
                          {selectedCourse.description}
                        </p>
                      )}
                    </div>

                    <div className="max-w-md">
                      <div className="flex items-center justify-between text-xs mb-2">
                        <span className="text-slate-400 font-medium">
                          {flatLessons.filter((m) => visited.has(m.id)).length} of{' '}
                          {flatLessons.length} lesson{flatLessons.length === 1 ? '' : 's'} opened
                        </span>
                        <span className="text-amber-400 font-bold">{courseProgress}%</span>
                      </div>
                      <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-amber-500 to-blue-500 rounded-full transition-all duration-500"
                          style={{ width: `${courseProgress}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-500 mt-2">
                        Progress covers this session only.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Topics */}
                {topicGroups.length > 0 ? (
                  <div className="space-y-4">
                    {topicGroups.map((group, index) => {
                      const isOpen = openTopic === group.title;
                      const done = group.materials.filter((m) => visited.has(m.id)).length;
                      return (
                        <div
                          key={group.title}
                          className="bg-[#0f172a] border border-slate-800 rounded-2xl overflow-hidden"
                        >
                          <button
                            onClick={() => setOpenTopic(isOpen ? null : group.title)}
                            className="w-full p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left hover:bg-slate-800/30 transition-colors"
                          >
                            <h4 className="text-lg font-bold text-white flex items-center gap-3">
                              <span
                                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                                  done > 0 && done === group.materials.length
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {index + 1}
                              </span>
                              {group.title}
                            </h4>
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-slate-500">
                                {group.materials.length} lesson
                                {group.materials.length === 1 ? '' : 's'}
                                {done > 0 ? ` · ${done} opened` : ''}
                              </span>
                              <ChevronRight
                                size={18}
                                className={`text-slate-500 transition-transform ${
                                  isOpen ? 'rotate-90' : ''
                                }`}
                              />
                            </div>
                          </button>

                          {isOpen && (
                            <div className="divide-y divide-slate-800/50 border-t border-slate-800/50">
                              {group.materials.length > 0 ? (
                                group.materials.map((material, mIndex) => {
                                  const isDone = visited.has(material.id);
                                  return (
                                    <button
                                      key={material.id}
                                      onClick={() => openLesson(material)}
                                      className="w-full text-left p-5 hover:bg-slate-800/50 transition-colors flex items-center gap-4 group"
                                    >
                                      <div
                                        className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-110 ${
                                          isDone
                                            ? 'bg-emerald-500/10 text-emerald-400'
                                            : 'bg-blue-500/10 text-blue-400'
                                        }`}
                                      >
                                        {isDone ? <CheckCircle2 size={20} /> : <PlayCircle size={20} />}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <h5 className="font-semibold text-slate-200 group-hover:text-white transition-colors truncate">
                                          {material.title || `Lesson ${mIndex + 1}`}
                                        </h5>
                                        <p className="text-xs text-slate-500 mt-1">
                                          {material.file_type === 'lesson'
                                            ? 'Read lesson'
                                            : `${(material.file_type || 'file').toUpperCase()} resource`}
                                        </p>
                                      </div>
                                      <ChevronRight className="text-slate-600 group-hover:text-amber-400 transition-colors shrink-0" />
                                    </button>
                                  );
                                })
                              ) : (
                                <div className="p-6 text-center text-sm text-slate-500">
                                  <Circle size={16} className="inline mr-2 opacity-40" />
                                  No published lessons in this topic yet.
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-16 bg-[#0f172a] border border-slate-800 rounded-2xl">
                    <Layers className="w-12 h-12 text-slate-700 mx-auto mb-4" />
                    <p className="text-slate-400">This subject has no published topics yet.</p>
                  </div>
                )}

                {/* Practice call-to-action */}
                <div className="bg-gradient-to-r from-blue-600/10 to-amber-500/10 border border-blue-500/20 rounded-2xl p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0">
                      <FileText size={20} />
                    </div>
                    <div>
                      <h4 className="font-bold text-white">Ready to test yourself?</h4>
                      <p className="text-sm text-slate-400 mt-1">
                        Take a timed Post-UTME CBT paper and review every explanation.
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => onNavigate?.('utme')}
                    className="px-5 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-2xl flex items-center gap-2 transition-colors text-sm shrink-0"
                  >
                    Start Practice <ArrowRight size={16} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>
    </DashboardLayout>
  );
}
