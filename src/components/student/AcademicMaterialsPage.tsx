import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { BookOpen, Layers, FileText, ArrowLeft, Loader2, PlayCircle, BookMarked, ChevronRight, GraduationCap, ArrowRight, AlertCircle, Sparkles, TrendingUp } from 'lucide-react';
import DashboardLayout from '../dashboard/DashboardLayout';
import { supabase } from '../../supabaseClient';
import { useProfile } from '../../lib/useProfile';
import { usePlatformConfig } from '../../lib/platformSettings';
import StudentLessonViewer from '../materials/StudentLessonViewer';
import CBTExamTaker from '../cbt/CBTExamTaker';
import CBTResultView from '../cbt/CBTResultView';

interface AcademicMaterialsPageProps {
  onLogout: () => void;
  onNavigate?: (view: string) => void;
}

export default function AcademicMaterialsPage({ onLogout, onNavigate }: AcademicMaterialsPageProps) {
  const { profile } = useProfile();
  // The semester an admin has opened (System Settings → Academic Sessions).
  const { config } = usePlatformConfig();
  const activeSemester = config.academic.current_semester;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [levels, setLevels] = useState<string[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [topics, setTopics] = useState<{name: string, materials: any[]}[]>([]);

  const [selectedLevel, setSelectedLevel] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<any | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<any | null>(null);
  const [topicStatuses, setTopicStatuses] = useState<Record<string, { status: 'Needs Review' | 'Practice Recommended' | 'Good' }>>({});
  const [cbtModalTopic, setCbtModalTopic] = useState<string | null>(null);
  const [cbtView, setCbtView] = useState<'exam' | 'result'>('exam');
  const [cbtAttemptId, setCbtAttemptId] = useState<string | null>(null);

  useEffect(() => {
    fetchLevels();
  }, [profile]);

  // The settings arrive asynchronously, so the first course fetch may run before
  // the real active semester is known. When it resolves — or when an admin
  // switches semester while a student is browsing — the open course list is
  // rebuilt against the correct semester.
  useEffect(() => {
    if (selectedLevel) fetchCourses(selectedLevel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSemester]);

  const fetchLevels = async () => {
    try {
      setLoading(true);
      setError(null);
      // Only fetch levels that have published content. Archived courses are
      // excluded too, so an archived programme cannot keep a level visible to
      // students on its own.
      const { data, error } = await supabase
        .from('courses')
        // `level` is needed to build the level list below — see fetchLevels.
        .select('portal, status, level')
        .eq('is_archived', false);
      
      if (error) throw error;
      
      if (data) {
        // filter by published status where appropriate. 
        // Admin manages Course status as well? In CourseManagement.tsx we saw courseInput.status === 'Published'.
        const activeCourses = data.filter(c => c.status === 'Published');
        // This is the UNDERGRADUATE academic materials library, so the portal
        // list is narrowed to Undergraduate.
        //
        // It previously derived its list from every published course's portal, so
        // UTME and Post-UTME appeared here as selectable entries and their
        // materials were browsable from this page — the two views overlapped.
        // Each portal has its own surface: Post-UTME has PostUtmeLearningPage,
        // which filters `.eq('portal', 'Post-UTME')` on both courses and
        // materials. Filtering here is what keeps the two libraries separate.
        const undergradCourses = activeCourses.filter(c => c.portal === 'Undergraduate');

        // The level cards come from `courses.level` ("100 Level", "200 Level").
        // This previously read `c.portal`, which is 'Undergraduate' on every row
        // of this list — so the grid collapsed to a single "Undergraduate" card
        // and the student's own level below could never match it.
        //
        // A course with no `level` set (rows predating the column) is not
        // dropped: when NO course carries a level, the single "Undergraduate"
        // entry is kept as a catch-all so the library stays reachable rather
        // than rendering empty.
        const levelValues = Array.from(
          new Set(undergradCourses.map(c => String(c.level ?? '').trim()).filter(Boolean)),
        ).sort();
        const uniqueLevels = levelValues.length > 0 ? levelValues : ['Undergraduate'];

        // Also pre-select level if student profile has it
        if (profile?.level && uniqueLevels.includes(profile.level) && !selectedLevel) {
           setSelectedLevel(profile.level);
           fetchCourses(profile.level);
        }
        
        // Sort levels (e.g., 100 Level, 200 Level)
        uniqueLevels.sort();
        setLevels(uniqueLevels);
      }
    } catch (err: any) {
      setError('Failed to load levels. Please try again.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCourses = async (level: string) => {
    try {
      setLoading(true);
      setError(null);
      setSelectedLevel(level);
      
      // This is the UNDERGRADUATE library, so the portal is pinned rather than
      // taken from the argument. The parameter is a LEVEL ("100 Level"), and the
      // query used to pass it straight to `.eq('portal', level)` — which only
      // ever matched because the level list was itself derived from `portal`.
      const { data, error } = await supabase
        .from('courses')
        .select('*')
        .eq('portal', 'Undergraduate')
        .eq('status', 'Published')
        // Archived courses are hidden from students. Archiving is a deliberate
        // staff action meaning "retire this", so it must not remain browsable.
        .eq('is_archived', false)
        .order('title', { ascending: true });

      if (error) throw error;

      // Only the active semester is offered (System Settings → Academic
      // Sessions). Scoped to Undergraduate because that is the only portal with
      // a semester concept — CourseManagement writes `semester: null` for UTME
      // and Post-UTME courses, which have their own structure.
      //
      // Both tests are null-safe on purpose: an untagged row is KEPT. Courses
      // created before these columns existed have no value, and dropping them
      // would make parts of the library silently vanish rather than simply
      // withholding the closed semester. `level === 'Undergraduate'` is the
      // catch-all entry used when no course carries a level (see fetchLevels).
      setCourses((data || []).filter(c =>
        (level === 'Undergraduate' || !c.level || c.level === level) &&
        (!c.semester || c.semester === activeSemester)
      ));
    } catch (err: any) {
      setError('Failed to load courses.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTopicsAndMaterials = async (course: any) => {
    try {
      setLoading(true);
      setError(null);
      setSelectedCourse(course);
      
      // `materials` carries its OWN `portal` and `semester`, and this query used
      // to filter on `course_code` alone. Course codes are not unique across
      // programmes, so a UTME or Post-UTME lesson sharing a code with an
      // Undergraduate course was pulled into this library — and a lesson written
      // for the closed semester appeared beside the open one.
      //
      // `portal` is NOT NULL on this table, so the equality test is a strict
      // exclusion and no untagged row can slip through. `semester` IS nullable,
      // so it is filtered just below instead.
      const { data, error } = await supabase
        .from('materials')
        .select('*')
        .eq('course_code', course.course_code)
        .eq('portal', 'Undergraduate')
        .eq('is_published', true)
        .eq('file_type', 'lesson')
        .order('order_index', { ascending: true })
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Only the semester the admin has open (System Settings → Academic
      // Sessions), mirroring the course list. Null-safe: a lesson with no
      // semester recorded is kept, because dropping untagged content would hide
      // material published before the column existed.
      const visible = (data || []).filter(
        (m: any) => !m.semester || m.semester === activeSemester,
      );

      // Group by topic
      if (data) {
        const topicMap = new Map<string, any[]>();
        visible.forEach(m => {
          const t = m.topic || 'General';
          if (!topicMap.has(t)) topicMap.set(t, []);
          topicMap.get(t)!.push(m);
        });
        
        const grouped = Array.from(topicMap.entries()).map(([name, materials]) => ({
          name,
          materials
        }));
        setTopics(grouped);

        // Evaluate weak topic statuses based on actual CBT performance data
        if (profile?.id) {
          const { data: attempts } = await supabase
            .from('cbt_attempts')
            .select('*')
            .eq('user_id', profile.id)
            .eq('status', 'completed');

          const { data: qData } = await supabase
            .from('cbt_questions')
            .select('id, topic')
            .eq('course_code', course.course_code);

          if (attempts && qData) {
            const topicQuestionIds = new Map<string, string[]>();
            qData.forEach(q => {
              if (q.topic) {
                if (!topicQuestionIds.has(q.topic)) topicQuestionIds.set(q.topic, []);
                topicQuestionIds.get(q.topic)!.push(q.id);
              }
            });

            const newStatuses: Record<string, { status: 'Needs Review' | 'Practice Recommended' | 'Good' }> = {};
            
            topicQuestionIds.forEach((qIds, topicName) => {
              let topicAttempts = 0;
              let lowAttempts = 0;

              attempts.forEach(att => {
                if (att.answers && att.answers.student_answers) {
                  const studentAns = att.answers.student_answers;
                  let matchedInAttempt = false;

                  qIds.forEach(qid => {
                    if (studentAns[qid] !== undefined) {
                      matchedInAttempt = true;
                    }
                  });

                  if (matchedInAttempt) {
                    topicAttempts++;
                    if (att.score !== null && att.score < 60) {
                      lowAttempts++;
                    }
                  }
                }
              });

              if (topicAttempts >= 1 && lowAttempts >= 1) {
                newStatuses[topicName] = { status: 'Needs Review' };
              } else if (topicAttempts === 0) {
                newStatuses[topicName] = { status: 'Practice Recommended' };
              } else {
                newStatuses[topicName] = { status: 'Good' };
              }
            });

            setTopicStatuses(newStatuses);
          }
        }
      } else {
        setTopics([]);
      }
    } catch (err: any) {
      setError('Failed to load topics.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    if (selectedTopic) {
      setSelectedTopic(null);
    } else if (selectedCourse) {
      setSelectedCourse(null);
    } else if (selectedLevel) {
      setSelectedLevel(null);
      fetchLevels();
    }
  };

  const openLesson = (topicName: string, material: any) => {
    setSelectedTopic(topicName);
    setSelectedMaterial(material);
  };

  if (selectedMaterial) {
    return (
      <StudentLessonViewer 
        material={selectedMaterial} 
        onClose={() => {
          setSelectedMaterial(null);
          setSelectedTopic(null);
        }} 
        onNavigateToSibling={(siblingId) => {
           // find sibling in our loaded topics
           for (const topic of topics) {
             const mat = topic.materials.find(m => m.id === siblingId);
             if (mat) {
                openLesson(topic.name, mat);
                return;
             }
           }
        }}
      />
    );
  }

  return (
    <DashboardLayout onLogout={onLogout} currentView="academic-materials" onNavigate={onNavigate}>
      <div className="max-w-5xl mx-auto space-y-8 pb-12">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 text-amber-400 mb-2">
              <GraduationCap size={24} />
              <h2 className="font-bold tracking-widest uppercase text-sm">Undergraduate</h2>
            </div>
            <h1 className="text-3xl font-display font-bold text-white">Academic Materials</h1>
            <p className="text-slate-400 mt-2">Access your structured lecture notes, slides, and academic resources.</p>
          </div>
        </div>

        {/* Breadcrumbs / Back button */}
        {(selectedLevel || selectedCourse || selectedTopic) && (
          <button 
            onClick={handleBack}
            className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            <span className="font-medium text-sm">
              Back to {selectedCourse ? 'Courses' : selectedLevel ? 'Levels' : 'Overview'}
            </span>
          </button>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/30 text-rose-400 p-4 rounded-xl flex items-center justify-between">
            <p>{error}</p>
            <button onClick={() => {
              if (selectedCourse) fetchTopicsAndMaterials(selectedCourse);
              else if (selectedLevel) fetchCourses(selectedLevel);
              else fetchLevels();
            }} className="px-3 py-1 bg-rose-500/20 rounded-lg hover:bg-rose-500/30 transition-colors text-sm font-bold">
              Retry
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-amber-500 mb-4" />
            <p>Loading academic materials...</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {!selectedLevel && (
              <motion.div 
                key="levels"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4"
              >
                {levels.length > 0 ? levels.map(level => (
                  <button
                    key={level}
                    onClick={() => fetchCourses(level)}
                    className="bg-[#0f172a] border border-slate-800 hover:border-amber-500/50 p-6 rounded-2xl text-left transition-all group hover:bg-[#1e293b]"
                  >
                    <div className="w-12 h-12 bg-amber-500/10 text-amber-400 rounded-xl flex items-center justify-center mb-4 group-hover:bg-amber-500 group-hover:text-white transition-colors">
                      <Layers size={24} />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">{level}</h3>
                    <p className="text-slate-400 text-sm flex items-center gap-2 group-hover:text-slate-300">
                      Explore courses <ArrowRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity -ml-2 group-hover:ml-0" />
                    </p>
                  </button>
                )) : (
                  <div className="col-span-full text-center py-12 bg-[#0f172a] border border-slate-800 rounded-2xl">
                    <BookMarked className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                    <p className="text-slate-400">Academic materials for this level are not available yet.</p>
                  </div>
                )}
              </motion.div>
            )}

            {selectedLevel && !selectedCourse && (
              <motion.div 
                key="courses"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-10 h-10 bg-amber-500/20 text-amber-400 rounded-xl flex items-center justify-center">
                    <Layers size={20} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">{selectedLevel} Courses</h2>
                    <p className="text-slate-400 text-sm">Select a course to view its topics.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {courses.length > 0 ? courses.map(course => (
                    <button
                      key={course.id}
                      onClick={() => fetchTopicsAndMaterials(course)}
                      className="bg-[#0f172a] border border-slate-800 hover:border-amber-500/50 p-6 rounded-2xl text-left transition-all group flex flex-col h-full"
                    >
                      <div className="flex justify-between items-start mb-4">
                        <span className="bg-amber-500/10 text-amber-400 px-3 py-1 rounded-lg text-sm font-bold uppercase tracking-wider">
                          {course.course_code}
                        </span>
                        <ChevronRight className="text-slate-600 group-hover:text-amber-400 transition-colors" />
                      </div>
                      <h3 className="text-lg font-bold text-white mb-2 line-clamp-2">{course.title}</h3>
                      {course.description && (
                        <p className="text-slate-400 text-sm mb-4 line-clamp-2 flex-1">{course.description}</p>
                      )}
                      <div className="mt-auto pt-4 border-t border-slate-800/50 flex items-center text-sm text-slate-500">
                        <BookOpen size={14} className="mr-2" />
                        Access materials
                      </div>
                    </button>
                  )) : (
                    <div className="col-span-full text-center py-12 bg-[#0f172a] border border-slate-800 rounded-2xl">
                      <BookOpen className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                      <p className="text-slate-400">Materials for this level are not available yet.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {selectedCourse && !selectedTopic && (
              <motion.div 
                key="topics"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-6 md:p-8 relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3"></div>
                  <div className="relative z-10">
                    <span className="bg-amber-500/20 text-amber-400 px-3 py-1 rounded-lg text-sm font-bold uppercase tracking-wider mb-4 inline-block">
                      {selectedCourse.course_code}
                    </span>
                    <h2 className="text-2xl md:text-3xl font-bold text-white mb-4">{selectedCourse.title}</h2>
                    {selectedCourse.description && (
                      <p className="text-slate-400 max-w-2xl text-sm md:text-base">{selectedCourse.description}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-6">
                  {topics.some(t => topicStatuses[t.name]?.status === 'Needs Review' || topicStatuses[t.name]?.status === 'Practice Recommended') && (
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-3xl p-6 shadow-xl">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
                          <TrendingUp size={22} />
                        </div>
                        <div>
                          <h3 className="text-base md:text-lg font-bold text-white">Academic Review Recommendations</h3>
                          <p className="text-xs md:text-sm text-slate-300">Your recent CBT performance suggests reviewing these topics to strengthen understanding.</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {topics
                          .filter(t => topicStatuses[t.name]?.status === 'Needs Review' || topicStatuses[t.name]?.status === 'Practice Recommended')
                          .map(t => (
                            <div key={t.name} className="bg-[#0f172a] border border-amber-500/20 rounded-2xl p-5 flex flex-col justify-between gap-4">
                              <div>
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">{selectedCourse.course_code} → {t.name}</span>
                                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                    {topicStatuses[t.name]?.status}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-400">Your recent CBT performance suggests reviewing this topic.</p>
                              </div>
                              <div className="flex items-center gap-2 pt-3 border-t border-slate-800/80">
                                {t.materials.length > 0 && (
                                  <button
                                    onClick={() => openLesson(t.name, t.materials[0])}
                                    className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                                  >
                                    <BookOpen size={14} className="text-amber-400" /> Review {t.name}
                                  </button>
                                )}
                                <button
                                  onClick={() => setCbtModalTopic(t.name)}
                                  className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                                >
                                  <Sparkles size={14} /> Practice {t.name}
                                </button>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <FileText className="text-amber-400" size={20} />
                    Course Topics
                  </h3>
                  
                  {topics.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4">
                      {topics.map((topic, index) => {
                        const statusInfo = topicStatuses[topic.name];
                        return (
                          <div key={topic.name} className="bg-[#0f172a] border border-slate-800 rounded-2xl overflow-hidden">
                            <div className="p-5 border-b border-slate-800/50 bg-[#1e293b]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              <h4 className="text-lg font-bold text-white flex items-center gap-3">
                                <span className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-sm font-bold">
                                  {index + 1}
                                </span>
                                {topic.name}
                              </h4>
                              <div className="flex items-center gap-2 flex-wrap">
                                {statusInfo?.status === 'Needs Review' && (
                                  <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-bold border border-amber-500/20 flex items-center gap-1.5">
                                    <AlertCircle size={14} /> Needs Review
                                  </span>
                                )}
                                {statusInfo?.status === 'Practice Recommended' && (
                                  <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-400 text-xs font-bold border border-blue-500/20 flex items-center gap-1.5">
                                    <Sparkles size={14} /> Practice Recommended
                                  </span>
                                )}
                                <button
                                  onClick={() => setCbtModalTopic(topic.name)}
                                  className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
                                >
                                  Practice This Topic
                                </button>
                              </div>
                            </div>
                            <div className="divide-y divide-slate-800/50">
                              {topic.materials.map((material, mIndex) => (
                                <button
                                  key={material.id}
                                  onClick={() => openLesson(topic.name, material)}
                                  className="w-full text-left p-5 hover:bg-slate-800/50 transition-colors flex items-center gap-4 group"
                                >
                                  <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <PlayCircle size={20} />
                                  </div>
                                  <div className="flex-1">
                                    <h5 className="font-semibold text-slate-200 group-hover:text-white transition-colors">{material.title || `Lesson ${mIndex + 1}`}</h5>
                                    <p className="text-xs text-slate-500 mt-1">Read lesson material</p>
                                  </div>
                                  <ChevronRight className="text-slate-600 group-hover:text-amber-400 transition-colors" />
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-12 bg-[#0f172a] border border-slate-800 rounded-2xl">
                      <FileText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
                      <p className="text-slate-400">Materials for this course are not available yet.</p>
                    </div>
                  )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </div>

      {cbtModalTopic && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-800 rounded-3xl w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6 relative">
            <div className="flex justify-between items-center mb-6 border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-xl font-bold text-white">Practice Drill: {cbtModalTopic}</h3>
                <p className="text-slate-400 text-sm">Course: {selectedCourse?.course_code} - {selectedCourse?.title}</p>
              </div>
              <button 
                onClick={() => {
                  setCbtModalTopic(null);
                  setCbtView('exam');
                  setCbtAttemptId(null);
                }}
                className="text-slate-400 hover:text-white px-3 py-1 rounded-xl bg-slate-800 font-bold text-sm"
              >
                Close
              </button>
            </div>

            {cbtView === 'exam' ? (
              <CBTExamTaker
                examId="custom-exam-id"
                attemptId="custom-attempt-id"
                customConfig={{
                  backendDrill: true,
                  level: selectedLevel || profile?.level || '100 Level',
                  courseCode: selectedCourse?.course_code,
                  // `mode: 'topic'` is required for the server to apply `topic`
                  // at all — without it the drill returned random questions from
                  // the whole course rather than the topic the student opened.
                  mode: 'topic',
                  topic: cbtModalTopic,
                  // `limit` is the key POST /api/cbt/start reads; `questionsCount`
                  // was ignored, so this drill ran at the server default length.
                  limit: 10,
                  time: 15
                }}
                onFinish={(attId) => {
                  setCbtAttemptId(attId);
                  setCbtView('result');
                }}
                onCancel={() => setCbtModalTopic(null)}
              />
            ) : (
              <div className="space-y-6">
                <CBTResultView 
                  attemptId={cbtAttemptId || 'custom-attempt-id'} 
                  onBack={() => {
                    setCbtModalTopic(null);
                    setCbtView('exam');
                    setCbtAttemptId(null);
                    fetchTopicsAndMaterials(selectedCourse);
                  }} 
                  onReview={() => {}} 
                />
              </div>
            )}
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
