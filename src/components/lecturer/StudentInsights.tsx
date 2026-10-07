import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, Eye, Search, Filter, BarChart3 } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useProfile } from '../../lib/useProfile';

export default function StudentInsights() {
  const { profile } = useProfile();
  
  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<any[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'analytics' | 'students'>('analytics');
  
  const [students, setStudents] = useState<any[]>([]);
  const [performanceData, setPerformanceData] = useState<any[]>([]);

  useEffect(() => {
    if (profile) {
      fetchCoursesAndAnalytics();
    }
  }, [profile?.id, profile?.role]);

  /**
   * Live analytics.
   *
   * Three tables actually move these numbers, and nothing else does:
   *
   *   course_enrollments — a student joining or leaving one of the lecturer's
   *                        courses changes the directory and the "students
   *                        attempted" counts;
   *   cbt_attempts       — a completed sitting changes every performance figure;
   *   cbt_exams          — a new or retitled exam changes what the rows group by.
   *
   * No filter is applied to the subscription. Postgres Changes evaluates RLS per
   * subscriber, so a lecturer is only ever delivered rows they are already
   * allowed to read — the scoping above is what keeps the derived numbers
   * correct, and it is re-run on every event. The reload is coalesced so a burst
   * of attempts produces one refresh rather than one per row.
   *
   * Cleaned up on unmount (and on profile change), so a lecturer who signs out
   * leaves no channel behind.
   */
  useEffect(() => {
    if (!supabase || !profile?.id) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void fetchCoursesAndAnalytics(); }, 600);
    };

    const channel = supabase
      .channel(`lecturer_analytics_${profile.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'course_enrollments' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cbt_attempts' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cbt_exams' }, scheduleReload)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [profile?.id]);

  const fetchCoursesAndAnalytics = async () => {
    if (!supabase || !profile) return;
    setLoading(true);
    try {
      // 1. Fetch courses managed by lecturer (or all if Admin)
      let coursesQuery = supabase.from('courses').select('id, title, course_code, lecturer_id');
      if (profile.role !== 'Admin') {
        coursesQuery = coursesQuery.eq('lecturer_id', profile.id);
      }
      const { data: coursesRes } = await coursesQuery;
      const managedCourses = coursesRes || [];
      setCourses(managedCourses);

      const courseIds = managedCourses.map(c => c.id);
      const courseCodes = managedCourses.map(c => c.course_code).filter(Boolean);

      // Fetch students enrolled in these courses
      if (courseIds.length > 0) {
        const { data: enrollmentData } = await supabase
          .from('course_enrollments')
          .select('profiles(*)')
          .in('course_id', courseIds);
        
        if (enrollmentData) {
          const uniqueProfiles = Array.from(
            new Map(enrollmentData.map((e: any) => [e.profiles?.id, e.profiles])).values()
          ).filter(Boolean);
          setStudents(uniqueProfiles);
        }
      } else if (profile.role === 'Admin') {
        const { data: allProfiles } = await supabase.from('profiles').select('*').eq('role', 'student');
        setStudents(allProfiles || []);
      }

      // 2. Fetch CBT attempts and questions, SCOPED IN THE QUERY.
      //
      // These two previously ran unfiltered, and only the RENDER narrowed them.
      // That meant a lecturer's browser downloaded every completed attempt and
      // every question on the platform before discarding the ones it did not
      // render — other students' rows crossed the wire, and the cost grew with
      // the whole platform rather than with the lecturer's own courses. The scope
      // now lives in the request. Admin keeps the platform-wide view.
      //
      // Scope follows the same two relationships the render already used:
      // an exam belongs to a lecturer if they created it, or if its course_code
      // is one of their assigned courses.
      const isAdmin = profile.role === 'Admin';
      const empty = Promise.resolve({ data: [] as any[] });

      const baseAttempts = supabase
        .from('cbt_attempts')
        .select('*, cbt_exams(id, title, course_code, topic, created_by)')
        .eq('status', 'completed');
      const baseQuestions = supabase.from('cbt_questions').select('id, course_code, topic');

      let attemptsPromise: PromiseLike<{ data: any[] }>;
      let questionsPromise: PromiseLike<{ data: any[] }>;

      if (isAdmin) {
        attemptsPromise = baseAttempts as any;
        questionsPromise = baseQuestions as any;
      } else {
        const [ownExamsRes, courseExamsRes] = await Promise.all([
          supabase.from('cbt_exams').select('id').eq('created_by', profile.id),
          courseCodes.length > 0
            ? supabase.from('cbt_exams').select('id').in('course_code', courseCodes)
            : empty,
        ]);

        const examIds = Array.from(new Set([
          ...(ownExamsRes.data || []).map((e: any) => e.id),
          ...(courseExamsRes.data || []).map((e: any) => e.id),
        ]));

        // A lecturer with no exams and no courses resolves to empty results
        // rather than falling through to an unscoped query — an empty `.in()`
        // list is not a valid filter, and "unscoped" is exactly the leak being
        // closed here.
        attemptsPromise = examIds.length > 0 ? (baseAttempts.in('exam_id', examIds) as any) : empty;
        questionsPromise = courseCodes.length > 0 ? (baseQuestions.in('course_code', courseCodes) as any) : empty;
      }

      const [attemptsRes, questionsRes] = await Promise.all([attemptsPromise, questionsPromise]);

      const attempts = attemptsRes.data || [];
      const questions = questionsRes.data || [];

      // Map question id -> { course_code, topic }
      const qMap = new Map<string, { course_code?: string, topic?: string }>();
      questions.forEach((q: any) => {
        qMap.set(q.id, { course_code: q.course_code, topic: q.topic });
      });

      // Filter attempts belonging to this lecturer's courses/exams (unless Admin)
      const authorizedAttempts = attempts.filter((att: any) => {
        if (profile.role === 'Admin') return true;
        const exam = att.cbt_exams;
        if (!exam) return false;
        if (exam.created_by === profile.id) return true;
        if (exam.course_code && courseCodes.includes(exam.course_code)) return true;
        return false;
      });

      // Group performance by course code
      const courseAggMap = new Map<string, {
        courseCode: string;
        title: string;
        studentsSet: Set<string>;
        scores: number[];
        questionsAttempted: number;
        topicsMap: Map<string, { scores: number[], attemptsCount: number }>;
      }>();

      managedCourses.forEach(c => {
        const code = c.course_code || c.title;
        courseAggMap.set(code, {
          courseCode: code,
          title: c.title,
          studentsSet: new Set(),
          scores: [],
          questionsAttempted: 0,
          topicsMap: new Map()
        });
      });

      authorizedAttempts.forEach((att: any) => {
        const exam = att.cbt_exams;
        let cCode = exam?.course_code;
        let tName = exam?.topic;

        if ((!cCode || !tName) && att.answers && att.answers.question_ids) {
          for (const qId of att.answers.question_ids) {
            const qMeta = qMap.get(qId);
            if (qMeta) {
              if (!cCode && qMeta.course_code) cCode = qMeta.course_code;
              if (!tName && qMeta.topic) tName = qMeta.topic;
            }
          }
        }

        cCode = cCode || 'General';
        tName = tName || 'General Practice';

        if (!courseAggMap.has(cCode)) {
          courseAggMap.set(cCode, {
            courseCode: cCode,
            title: cCode,
            studentsSet: new Set(),
            scores: [],
            questionsAttempted: 0,
            topicsMap: new Map()
          });
        }

        const agg = courseAggMap.get(cCode)!;
        if (att.user_id) agg.studentsSet.add(att.user_id);
        const score = att.score || 0;
        agg.scores.push(score);
        const qCount = (att.total_correct || 0) + (att.total_wrong || 0) || 10;
        agg.questionsAttempted += qCount;

        // Topic aggregation
        if (!agg.topicsMap.has(tName)) {
          agg.topicsMap.set(tName, { scores: [], attemptsCount: 0 });
        }
        const topicAgg = agg.topicsMap.get(tName)!;
        topicAgg.scores.push(score);
        topicAgg.attemptsCount += 1;
      });

      const formattedPerformance = Array.from(courseAggMap.entries()).map(([code, agg]) => {
        const avgScore = agg.scores.length > 0 ? Math.round(agg.scores.reduce((a, b) => a + b, 0) / agg.scores.length) : 0;
        const topicsList = Array.from(agg.topicsMap.entries()).map(([topicName, tData]) => ({
          topic: topicName,
          avgScore: tData.scores.length > 0 ? Math.round(tData.scores.reduce((a, b) => a + b, 0) / tData.scores.length) : 0,
          attempts: tData.attemptsCount
        }));

        return {
          courseCode: code,
          title: agg.title,
          studentsAttempted: agg.studentsSet.size,
          averageScore: avgScore,
          questionsAttempted: agg.questionsAttempted,
          totalAttempts: agg.scores.length,
          topics: topicsList
        };
      });

      setPerformanceData(formattedPerformance);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const filteredStudents = students.filter(s => 
    (s.full_name || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
    (s.student_id || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const displayedPerformance = selectedCourse === 'all' 
    ? performanceData 
    : performanceData.filter(p => p.courseCode === selectedCourse || p.title === selectedCourse);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-7xl mx-auto pb-12 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white mb-2">Student Management & Analytics</h1>
          <p className="text-slate-400">Monitor engagement, analyze performance, and manage your students.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <select 
             value={selectedCourse} 
             onChange={e => setSelectedCourse(e.target.value)}
            className="bg-[#0f172a] border border-slate-700 text-white rounded-xl px-4 py-2 focus:outline-none focus:border-amber-500"
          >
            <option value="all">All Managed Courses</option>
            {courses.map(c => <option key={c.id} value={c.course_code || c.title}>{c.course_code ? `${c.course_code} - ` : ''}{c.title}</option>)}
          </select>
          <button className="p-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl transition-colors border border-slate-700" title="Export Report">
            <Eye size={20} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-px">
        <button 
          onClick={() => setActiveTab('analytics')}
          className={`px-6 py-3 font-bold text-sm transition-colors relative ${activeTab === 'analytics' ? 'text-amber-500' : 'text-slate-400 hover:text-white'}`}
        >
          Performance Analytics
          {activeTab === 'analytics' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-amber-500"></div>}
        </button>
        <button 
          onClick={() => setActiveTab('students')}
          className={`px-6 py-3 font-bold text-sm transition-colors relative ${activeTab === 'students' ? 'text-amber-500' : 'text-slate-400 hover:text-white'}`}
        >
          Student Directory
          {activeTab === 'students' && <div className="absolute bottom-0 left-0 w-full h-0.5 bg-amber-500"></div>}
        </button>
      </div>

      {activeTab === 'analytics' ? (
        <div className="space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin h-10 w-10 border-4 border-amber-500 border-t-transparent rounded-full"></div>
            </div>
          ) : displayedPerformance.length > 0 ? (
            <div className="grid grid-cols-1 gap-6">
              {displayedPerformance.map(perf => (
                <div key={perf.courseCode} className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                    <div>
                      <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">{perf.courseCode}</span>
                      <h3 className="text-2xl font-bold text-white mt-1">{perf.title}</h3>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="bg-slate-900 border border-slate-800 px-4 py-2.5 rounded-2xl text-center">
                        <div className="text-xs text-slate-400 font-semibold uppercase">Students Attempted</div>
                        <div className="text-xl font-bold text-white">{perf.studentsAttempted}</div>
                      </div>
                      <div className="bg-slate-900 border border-slate-800 px-4 py-2.5 rounded-2xl text-center">
                        <div className="text-xs text-slate-400 font-semibold uppercase">Average Score</div>
                        <div className="text-xl font-bold text-emerald-400">{perf.averageScore}%</div>
                      </div>
                      <div className="bg-slate-900 border border-slate-800 px-4 py-2.5 rounded-2xl text-center">
                        <div className="text-xs text-slate-400 font-semibold uppercase">Questions Attempted</div>
                        <div className="text-xl font-bold text-indigo-400">{perf.questionsAttempted}</div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center gap-2">
                      <BarChart3 size={16} className="text-amber-400" /> Topic Performance Breakdown
                    </h4>
                    {perf.topics.length > 0 ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {perf.topics.map((t: any) => (
                          <div key={t.topic} className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between">
                            <div>
                              <div className="font-semibold text-slate-200 text-sm">{t.topic}</div>
                              <div className="text-xs text-slate-500 mt-0.5">{t.attempts} test attempt{t.attempts !== 1 ? 's' : ''}</div>
                            </div>
                            <div className="text-right">
                              <span className={`text-base font-bold ${t.avgScore >= 70 ? 'text-emerald-400' : t.avgScore >= 50 ? 'text-amber-400' : 'text-rose-400'}`}>
                                {t.avgScore}%
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">No topic performance data recorded for this course yet.</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-12 text-center shadow-xl">
               <div className="w-16 h-16 rounded-full bg-slate-800/50 flex items-center justify-center mx-auto mb-4">
                 <TrendingUp className="text-slate-500" size={32} />
               </div>
               <h3 className="text-xl font-bold text-white mb-2">No Performance Data Yet</h3>
               <p className="text-slate-400 max-w-md mx-auto">
                 Once students start attempting CBT exams for your managed courses, aggregate performance metrics will appear here.
               </p>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
              <input 
                type="text" 
                placeholder="Search by name or ID..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-[#0f172a] border border-slate-700 rounded-xl text-white focus:outline-none focus:border-amber-500 transition-colors"
              />
            </div>
            <button className="flex items-center gap-2 px-4 py-2.5 bg-[#0f172a] border border-slate-700 text-slate-300 rounded-xl hover:text-white hover:border-slate-600 transition-colors">
              <Filter size={18} />
              <span className="font-semibold text-sm">Filters</span>
            </button>
          </div>

          <div className="bg-[#0f172a] border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900/50 border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider">
                    <th className="px-6 py-4 font-bold">Student</th>
                    <th className="px-6 py-4 font-bold">Student ID</th>
                    <th className="px-6 py-4 font-bold">Email</th>
                    <th className="px-6 py-4 font-bold">Level</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-slate-400">Loading students...</td>
                    </tr>
                  ) : filteredStudents.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-slate-400">
                        {searchQuery ? 'No students match your search.' : 'No students found.'}
                      </td>
                    </tr>
                  ) : (
                    filteredStudents.map((student) => (
                      <tr key={student.id} className="hover:bg-slate-800/20 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold text-sm shrink-0">
                              {(student.full_name || 'U').charAt(0).toUpperCase()}
                            </div>
                            <span className="font-medium text-slate-200">{student.full_name || 'Unknown Student'}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-slate-300 font-mono text-sm">{student.student_id || '—'}</td>
                        <td className="px-6 py-4 text-slate-400 text-sm">{student.email}</td>
                        <td className="px-6 py-4 text-slate-400 text-sm">{student.level || '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
