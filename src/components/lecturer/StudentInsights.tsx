import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  TrendingUp, BarChart3, UploadCloud, Clock, Users, FileText, CheckCircle2,
} from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useProfile } from '../../lib/useProfile';

/**
 * Lecturer analytics.
 *
 * WHAT THIS PAGE IS FOR
 *
 * It answers "what have I actually produced, and what are my students doing
 * with it?" — not "who is enrolled". It previously opened on a Student
 * Directory: a searchable, filterable table of every enrolled student, which is
 * the same room as the CBT performance panel next to it and duplicated the
 * admin's user management. That tab is gone; the activity that a lecturer can
 * act on is what remains.
 *
 * Three tables move these numbers, and nothing else does:
 *
 *   course_enrollments — a student joining or leaving one of the lecturer's
 *                        courses changes the reach count;
 *   cbt_attempts       — a completed sitting changes every performance figure,
 *                        the sittings count and the time-on-task total;
 *   cbt_exams          — a new or retitled exam changes what the rows group by.
 *
 * The subscription below is unfiltered. Postgres Changes evaluates RLS per
 * subscriber, so a lecturer is only ever delivered rows they are already
 * allowed to read — the scoping in the queries is what keeps the derived
 * numbers correct, and it is re-run on every event. The reload is coalesced so
 * a burst of attempts produces one refresh rather than one per row.
 * Cleaned up on unmount (and on profile change), so a lecturer who signs out
 * leaves no channel behind.
 */
export default function StudentInsights() {
  const { profile } = useProfile();

  const [loading, setLoading] = useState(true);
  const [courses, setCourses] = useState<any[]>([]);
  const [selectedCourse, setSelectedCourse] = useState('all');
  const [performanceData, setPerformanceData] = useState<any[]>([]);

  /**
   * Real activity over the last seven days.
   *
   * Materials are scoped by COURSE CODE rather than `materials.lecturer_id`:
   * the column is written but is not part of the materials DDL this repo
   * carries, so filtering on it is one migration away from an empty list. The
   * lecturer's own course codes are the join the rest of the dashboard already
   * uses. Time on task is the wall-clock students spent sitting this lecturer's
   * papers — the closest thing to a work metric the data actually supports.
   * It is deliberately NOT a login count: nothing records lecturer presence,
   * and an invented number is worse than an absent one.
   */
  const [activity, setActivity] = useState({
    materialsTotal: 0,
    materialsPublished: 0,
    uploadsThisWeek: 0,
    studentsReached: 0,
    sittingsThisWeek: 0,
    teachingMinutes: 0,
  });

  useEffect(() => {
    if (profile) {
      fetchCoursesAndAnalytics();
    }
  }, [profile?.id, profile?.role]);

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
      // 1. The courses this lecturer manages (all of them for an Admin).
      let coursesQuery = supabase.from('courses').select('id, title, course_code, lecturer_id');
      if (profile.role !== 'Admin') {
        coursesQuery = coursesQuery.eq('lecturer_id', profile.id);
      }
      const { data: coursesRes } = await coursesQuery;
      const managedCourses = coursesRes || [];
      setCourses(managedCourses);

      const courseIds = managedCourses.map(c => c.id);
      const courseCodes = managedCourses.map(c => c.course_code).filter(Boolean);

      // 2. Materials authored against those course codes.
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);

      let materialsTotal = 0;
      let materialsPublished = 0;
      let uploadsThisWeek = 0;
      if (courseCodes.length > 0) {
        const { data: mats } = await supabase
          .from('materials')
          .select('id, is_published, created_at')
          .in('course_code', courseCodes);

        for (const m of (mats || []) as any[]) {
          materialsTotal++;
          if (m.is_published) materialsPublished++;
          if (m.created_at && new Date(m.created_at) >= weekAgo) uploadsThisWeek++;
        }
      }

      // 3. Reach — distinct students enrolled across those courses.
      let studentsReached = 0;
      if (courseIds.length > 0) {
        const { data: enrollmentData } = await supabase
          .from('course_enrollments')
          .select('student_id')
          .in('course_id', courseIds);
        studentsReached = new Set((enrollmentData || []).map((e: any) => e.student_id)).size;
      }

      // 4. CBT attempts and questions, SCOPED IN THE QUERY.
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

      // Time on task and sitting count over the last seven days, summed from the
      // sittings that carry both timestamps. A row missing either is skipped
      // rather than counted as zero-length, so an incomplete attempt never drags
      // the total down.
      let teachingMinutes = 0;
      let sittingsThisWeek = 0;
      for (const att of authorizedAttempts as any[]) {
        if (!att.start_time || !att.end_time) continue;
        const start = new Date(att.start_time).getTime();
        const end = new Date(att.end_time).getTime();
        if (Number.isNaN(start) || Number.isNaN(end) || end < start) continue;
        if (start < weekAgo.getTime()) continue;
        sittingsThisWeek++;
        teachingMinutes += (end - start) / 60000;
      }

      setActivity({
        materialsTotal,
        materialsPublished,
        uploadsThisWeek,
        studentsReached,
        sittingsThisWeek,
        teachingMinutes: Math.round(teachingMinutes),
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

  /** Human duration, e.g. 135 -> "2h 15m". */
  const formatDuration = (mins: number) => {
    if (!mins) return '0m';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const displayedPerformance = selectedCourse === 'all'
    ? performanceData
    : performanceData.filter(p => p.courseCode === selectedCourse || p.title === selectedCourse);

  const ACTIVITY_TILES = [
    {
      label: 'Materials Published',
      value: `${activity.materialsPublished} / ${activity.materialsTotal}`,
      hint: 'Published out of everything authored',
      icon: UploadCloud,
      color: 'text-violet-400',
      bg: 'bg-violet-500/10',
    },
    {
      label: 'Uploaded This Week',
      value: activity.uploadsThisWeek,
      hint: 'Materials created in the last 7 days',
      icon: FileText,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    },
    {
      label: 'Students Reached',
      value: activity.studentsReached,
      hint: 'Enrolled across your courses',
      icon: Users,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
    },
    {
      label: 'Sittings This Week',
      value: activity.sittingsThisWeek,
      hint: 'Completed CBT attempts on your papers',
      icon: CheckCircle2,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Time on Task (7d)',
      value: formatDuration(activity.teachingMinutes),
      hint: 'Time students spent on your CBT papers',
      icon: Clock,
      color: 'text-rose-400',
      bg: 'bg-rose-500/10',
    },
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-7xl mx-auto pb-12 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-white mb-2">Teaching Analytics</h1>
          <p className="text-slate-400">What you have published, and how your students are doing with it.</p>
        </div>

        <select
          value={selectedCourse}
          onChange={e => setSelectedCourse(e.target.value)}
          className="bg-[#0f172a] border border-slate-700 text-white rounded-xl px-4 py-2 focus:outline-none focus:border-amber-500"
        >
          <option value="all">All Managed Courses</option>
          {courses.map(c => <option key={c.id} value={c.course_code || c.title}>{c.course_code ? `${c.course_code} - ` : ''}{c.title}</option>)}
        </select>
      </div>

      {/* Activity metrics — real numbers, computed on each load and refreshed
          live by the subscription above. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {ACTIVITY_TILES.map((tile) => (
          <div key={tile.label} className="bg-[#0f172a] border border-slate-800 rounded-3xl p-5">
            <div className={`w-11 h-11 rounded-2xl ${tile.bg} flex items-center justify-center mb-4`}>
              <tile.icon size={22} className={tile.color} />
            </div>
            <div className="text-2xl font-display font-bold text-white">{tile.value}</div>
            <div className="text-sm text-slate-300 font-medium mt-1">{tile.label}</div>
            <div className="text-xs text-slate-500 mt-1">{tile.hint}</div>
          </div>
        ))}
      </div>

      {/* Per-course performance */}
      <div className="space-y-6">
        <h2 className="text-xl font-display font-bold text-white flex items-center gap-2">
          <BarChart3 size={20} className="text-amber-400" /> Performance by course
        </h2>

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
    </motion.div>
  );
}
