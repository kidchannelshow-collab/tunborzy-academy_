import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  BarChart2, Activity, Target, TrendingUp, BookOpen, Clock, Award, Calendar, Layers,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';

import DashboardLayout from './dashboard/DashboardLayout';
import { supabase } from '../supabaseClient';
import { useProfile } from '../lib/useProfile';
import { cbtLabelForPortal, cbtRouteForPortal } from '../lib/portalRoutes';
import { useRefetchOnFocus } from '../lib/useRefetchOnFocus';

interface PerformanceAnalyticsPageProps {
  onLogout: () => void;
  onNavigate?: (view: string) => void;
}

type Period = 'today' | 'week' | 'month' | 'all';

/**
 * One completed CBT sitting, normalised from whichever portal table it came
 * from so every chart below works off a single shape.
 *
 * `score` is a 0–100 percentage in BOTH tables — /api/cbt/submit and
 * /api/utme/submit each write Math.round(correct / total * 100) — so it is never
 * divided by a question total again.
 */
interface Sitting {
  id: string;
  subject: string;
  score: number;
  at: Date;
  questions: number;
  correct: number;
}

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'all', label: 'All Time' },
];

/** Local-midnight boundary for the selected period. */
function periodStart(period: Period): Date {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'today') return startOfToday;
  if (period === 'week') {
    // Week starts Monday, matching how a Nigerian academic week is read.
    const monday = new Date(startOfToday);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    return monday;
  }
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(0);
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PerformanceAnalyticsPage({ onLogout, onNavigate }: PerformanceAnalyticsPageProps) {
  const { profile } = useProfile();

  const [sittings, setSittings] = useState<Sitting[]>([]);
  const [enrolledSubjects, setEnrolledSubjects] = useState(0);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<Period>('week');

  // Re-runs whenever the page mounts. Both dashboard and analytics are rendered
  // conditionally per view in App.tsx, so returning from a CBT remounts this
  // page and picks up the newly completed attempt.
  //
  // `silent` skips the loading spinner, for the focus refresh below — blanking
  // the charts every time the tab is looked at would be worse than the staleness
  // it fixes.
  const fetchAnalytics = useCallback(async (options?: { silent?: boolean }) => {
    if (!profile) return;
    if (!options?.silent) setLoading(true);
    try {
        // The student's OWN completed sittings, read from the table each portal
        // records into: UTME in `utme_attempts` (keyed by student_id), the
        // undergraduate drill in `cbt_attempts` (keyed by user_id), and Post-UTME
        // screening in `post_utme_attempts` (keyed by user_id).
        //
        // Deliberately not branching on `profile.portal === 'UTME'`: that value
        // is not guaranteed to be exactly 'UTME', and a wrong guess silently
        // selected the empty table, which is what previously left this page
        // showing its empty state despite real completed attempts existing. The
        // same reasoning is why Post-UTME is read unconditionally rather than
        // behind a portal check — a Post-UTME student previously had no analytics
        // at all, because nothing here ever queried their table.
        const [utmeRes, cbtRes, postUtmeRes, subjectRes] = await Promise.all([
          supabase
            .from('utme_attempts')
            .select('id, score, percentage, total_correct, total_wrong, created_at, utme_subjects(name)')
            .eq('student_id', profile.id)
            .eq('status', 'completed')
            .order('created_at', { ascending: true }),
          supabase
            .from('cbt_attempts')
            .select('id, score, total_correct, total_wrong, end_time, cbt_exams(title)')
            .eq('user_id', profile.id)
            .eq('status', 'completed')
            .not('score', 'is', null)
            .order('end_time', { ascending: true }),
          supabase
            .from('post_utme_attempts')
            .select('id, score, total_correct, total_wrong, end_time, post_utme_exams(title, subject)')
            .eq('user_id', profile.id)
            .eq('status', 'completed')
            .not('score', 'is', null)
            .order('end_time', { ascending: true }),
          // The subjects available to this student — the same catalogue the UTME
          // dashboard lists. Used for "Subjects Enrolled".
          supabase.from('utme_subjects').select('id', { count: 'exact', head: true }).eq('is_active', true),
        ]);

        const merged: Sitting[] = [
          ...(utmeRes.data || []).map((a: any) => ({
            id: a.id,
            subject: a.utme_subjects?.name || 'UTME CBT',
            score: Number(a.score ?? a.percentage ?? 0),
            at: new Date(a.created_at),
            questions: Number(a.total_correct ?? 0) + Number(a.total_wrong ?? 0),
            correct: Number(a.total_correct ?? 0),
          })),
          ...(cbtRes.data || []).map((a: any) => ({
            id: a.id,
            subject: a.cbt_exams?.title || 'CBT Practice',
            score: Number(a.score ?? 0),
            at: new Date(a.end_time),
            questions: Number(a.total_correct ?? 0) + Number(a.total_wrong ?? 0),
            correct: Number(a.total_correct ?? 0),
          })),
          ...(postUtmeRes.data || []).map((a: any) => ({
            id: a.id,
            subject: a.post_utme_exams?.title || a.post_utme_exams?.subject || 'Post-UTME CBT',
            score: Number(a.score ?? 0),
            at: new Date(a.end_time),
            questions: Number(a.total_correct ?? 0) + Number(a.total_wrong ?? 0),
            correct: Number(a.total_correct ?? 0),
          })),
        ]
          .filter((s) => !Number.isNaN(s.at.getTime()))
          .sort((a, b) => a.at.getTime() - b.at.getTime());

        setSittings(merged);
        setEnrolledSubjects(subjectRes.count || 0);
      } catch (err) {
        console.error(err);
      } finally {
        if (!options?.silent) setLoading(false);
      }
  }, [profile]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  /**
   * A completed CBT is recorded by the server on submit, and nothing pushes that
   * to a page that is already open. Navigating away and back refetches, because
   * the views are conditionally rendered in App.tsx and this one unmounts — but
   * a tab that merely sat open would keep showing the figures from before the
   * attempt. Re-reading when the page is looked at again is the one signal
   * available, and it costs nothing while the tab is in the background.
   */
  useRefetchOnFocus(() => {
    fetchAnalytics({ silent: true });
  });

  /** Everything below derives from `sittings` + `period`. No stored counters. */
  const stats = useMemo(() => {
    const start = periodStart(period);
    const inPeriod = sittings.filter((s) => s.at >= start);

    const total = inPeriod.length;
    const avg = total > 0 ? Math.round(inPeriod.reduce((a, s) => a + s.score, 0) / total) : 0;
    const best = total > 0 ? Math.max(...inPeriod.map((s) => s.score)) : 0;
    const questions = inPeriod.reduce((a, s) => a + s.questions, 0);
    const correct = inPeriod.reduce((a, s) => a + s.correct, 0);
    const accuracy = questions > 0 ? Math.round((correct / questions) * 100) : avg;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const today = sittings.filter((s) => s.at >= startOfToday).length;

    const weekStart = periodStart('week');
    const week = sittings.filter((s) => s.at >= weekStart).length;

    const activeDays = new Set(inPeriod.map((s) => dayKey(s.at))).size;

    return { inPeriod, total, avg, best, questions, correct, accuracy, today, week, activeDays };
  }, [sittings, period]);

  /**
   * CBT activity buckets. Today is bucketed by hour so a single day still shows
   * a distribution; longer periods are bucketed by day, capped at 30 so the
   * "All Time" view stays readable.
   */
  const activitySeries = useMemo(() => {
    const start = periodStart(period);
    const now = new Date();

    if (period === 'today') {
      const buckets = Array.from({ length: 24 }, (_, h) => ({ label: `${h}`, count: 0 }));
      stats.inPeriod.forEach((s) => { buckets[s.at.getHours()].count += 1; });
      return buckets.filter((_, h) => h % 3 === 0 || buckets[h].count > 0);
    }

    const first = new Date(Math.max(start.getTime(), now.getTime() - 29 * 86400000));
    first.setHours(0, 0, 0, 0);
    const days: { label: string; count: number }[] = [];
    for (let d = new Date(first); d <= now; d.setDate(d.getDate() + 1)) {
      const key = dayKey(d);
      days.push({
        label: period === 'week' ? DAY_LABELS[d.getDay()] : `${d.getDate()}/${d.getMonth() + 1}`,
        count: stats.inPeriod.filter((s) => dayKey(s.at) === key).length,
      });
    }
    return days;
  }, [stats.inPeriod, period]);

  /** Score progression, oldest → newest, within the period. */
  const scoreSeries = useMemo(
    () =>
      stats.inPeriod.map((s, i) => ({
        label: `#${i + 1}`,
        score: s.score,
      })),
    [stats.inPeriod],
  );

  /** Per-subject rollup from the student's real attempts. */
  const subjectSeries = useMemo(() => {
    const bySubject = new Map<string, { total: number; count: number; best: number }>();
    stats.inPeriod.forEach((s) => {
      const cur = bySubject.get(s.subject) || { total: 0, count: 0, best: 0 };
      cur.total += s.score;
      cur.count += 1;
      cur.best = Math.max(cur.best, s.score);
      bySubject.set(s.subject, cur);
    });
    return Array.from(bySubject.entries())
      .map(([subject, v]) => ({ subject, avg: Math.round(v.total / v.count), attempts: v.count, best: v.best }))
      .sort((a, b) => b.avg - a.avg);
  }, [stats.inPeriod]);

  const hasAnyData = sittings.length > 0;
  const hasPeriodData = stats.inPeriod.length > 0;

  const tooltipStyle = {
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: '0.75rem',
    fontSize: '12px',
    color: '#e2e8f0',
  } as const;

  if (loading) {
    return (
      <DashboardLayout currentView="analytics" onNavigate={onNavigate} onLogout={onLogout}>
        <div className="flex items-center justify-center h-full">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin"></div>
            <span className="text-slate-400 font-medium">Loading analytics...</span>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  const cards = [
    { label: 'CBTs Completed', value: stats.total, icon: Activity, color: 'text-indigo-400', bg: 'bg-indigo-500/10' },
    { label: 'Average Score', value: `${stats.avg}%`, icon: Target, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Highest Score', value: `${stats.best}%`, icon: Award, color: 'text-amber-400', bg: 'bg-amber-500/10' },
    { label: 'Questions Answered', value: stats.questions, icon: BookOpen, color: 'text-sky-400', bg: 'bg-sky-500/10' },
  ];

  return (
    <DashboardLayout currentView="analytics" onNavigate={onNavigate} onLogout={onLogout}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-7xl mx-auto space-y-6"
      >
        {/* Header + period control */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-2">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center shrink-0">
                <BarChart2 className="text-indigo-400" size={24} />
              </div>
              <h1 className="text-2xl sm:text-3xl font-display font-bold text-white">Performance Analytics</h1>
            </div>
            <p className="text-sm text-slate-400 max-w-2xl">
              Your CBT activity, scores and subject performance, calculated from your completed attempts.
            </p>
          </div>

          <div className="flex flex-wrap gap-2 bg-[#0f172a]/80 border border-slate-800 rounded-2xl p-1.5 w-full lg:w-auto">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                onClick={() => setPeriod(p.id)}
                className={`flex-1 lg:flex-none px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${
                  period === p.id
                    ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/25'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {!hasAnyData ? (
          <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-12 text-center">
            <div className="w-20 h-20 rounded-2xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-6">
              <Activity className="text-indigo-500" size={40} />
            </div>
            <h2 className="text-xl font-display font-bold text-white mb-2">No Analytics Data Yet</h2>
            <p className="text-slate-400 max-w-md mx-auto mb-8">
              Complete a CBT practice session and your performance analytics will appear here automatically.
            </p>
            {/* This hardcoded the UTME centre and was labelled for it, so an
                Undergraduate or Post-UTME student pressing it landed in the
                wrong CBT. Both the route and the label now come from the
                student's own programme. */}
            <button
              onClick={() => onNavigate && onNavigate(cbtRouteForPortal(profile?.portal))}
              className="bg-indigo-500 hover:bg-indigo-400 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-indigo-500/25"
            >
              Go to {cbtLabelForPortal(profile?.portal)}
            </button>
          </div>
        ) : (
          <>
            {/* Period summary — Today / This Week always shown regardless of tab */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {cards.map((c) => (
                <div key={c.label} className="bg-[#0f172a]/80 border border-slate-800 rounded-2xl p-4 sm:p-5 min-w-0">
                  <div className={`w-10 h-10 rounded-xl ${c.bg} flex items-center justify-center mb-3`}>
                    <c.icon size={20} className={c.color} />
                  </div>
                  <p className="text-xl sm:text-2xl font-display font-bold text-white truncate">{c.value}</p>
                  <p className="text-xs font-body text-slate-400 truncate">{c.label}</p>
                </div>
              ))}
            </div>

            {!hasPeriodData && (
              <div className="bg-[#0f172a]/80 border border-slate-800 rounded-2xl p-5 text-sm text-slate-400">
                No completed CBTs in this period. Pick a wider range above, or take a new practice test.
              </div>
            )}

            {/* CATEGORY 1 — CBT activity */}
            <section className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-5 sm:p-6 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
                <h2 className="text-lg font-display font-bold text-white flex items-center gap-2">
                  <TrendingUp className="text-indigo-400" size={20} /> CBT Activity
                </h2>
                <div className="flex gap-4 text-xs">
                  <span className="text-slate-400">
                    Today <span className="text-white font-bold ml-1">{stats.today}</span>
                  </span>
                  <span className="text-slate-400">
                    This week <span className="text-white font-bold ml-1">{stats.week}</span>
                  </span>
                </div>
              </div>
              <div className="w-full h-56 sm:h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activitySeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={tooltipStyle} cursor={{ fill: '#1e293b55' }} />
                    <Bar dataKey="count" name="CBTs" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={38} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-slate-500 mt-3">
                {period === 'today' ? 'Completed CBTs by hour today.' : 'Completed CBTs per day in the selected period.'}
              </p>
            </section>

            {/* CATEGORY 2 — Score & accuracy */}
            <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
              <div className="xl:col-span-2 bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-5 sm:p-6 min-w-0">
                <h2 className="text-lg font-display font-bold text-white mb-6 flex items-center gap-2">
                  <TrendingUp className="text-emerald-400" size={20} /> Score Progression
                </h2>
                {scoreSeries.length > 1 ? (
                  <div className="w-full h-56 sm:h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={scoreSeries} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Line type="monotone" dataKey="score" name="Score %" stroke="#34d399" strokeWidth={3} dot={{ r: 4, fill: '#34d399' }} activeDot={{ r: 6 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 py-12 text-center">
                    Take at least two CBTs in this period to see your score trend.
                  </p>
                )}
              </div>

              {/* Accuracy gauge */}
              <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-5 sm:p-6 flex flex-col min-w-0">
                <h2 className="text-lg font-display font-bold text-white mb-2 flex items-center gap-2">
                  <Target className="text-amber-400" size={20} /> Accuracy
                </h2>
                <div className="flex-1 w-full h-48 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <RadialBarChart
                      data={[{ name: 'accuracy', value: stats.accuracy, fill: '#fbbf24' }]}
                      innerRadius="72%"
                      outerRadius="100%"
                      startAngle={210}
                      endAngle={-30}
                    >
                      <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                      <RadialBar dataKey="value" cornerRadius={12} background={{ fill: '#1e293b' }} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-3xl font-display font-bold text-white">{stats.accuracy}%</span>
                    <span className="text-xs text-slate-400">
                      {stats.correct}/{stats.questions} correct
                    </span>
                  </div>
                </div>
              </div>
            </section>

            {/* CATEGORY 3 — Subject performance */}
            <section className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-5 sm:p-6 min-w-0">
              <h2 className="text-lg font-display font-bold text-white mb-6 flex items-center gap-2">
                <Layers className="text-sky-400" size={20} /> Subject Performance
              </h2>
              {subjectSeries.length === 0 ? (
                <p className="text-sm text-slate-500 py-8 text-center">No subject activity in this period.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
                  {subjectSeries.map((s) => (
                    <div key={s.subject} className="min-w-0">
                      <div className="flex items-center justify-between gap-3 mb-2">
                        <span className="text-sm font-semibold text-white truncate" title={s.subject}>
                          {s.subject}
                        </span>
                        <span className="text-sm font-bold text-white shrink-0">{s.avg}%</span>
                      </div>
                      <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-emerald-400"
                          style={{ width: `${Math.max(2, Math.min(100, s.avg))}%` }}
                        />
                      </div>
                      <p className="text-xs text-slate-500 mt-1.5">
                        {s.attempts} attempt{s.attempts === 1 ? '' : 's'} · best {s.best}%
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* CATEGORY 4 — Progress & learning activity */}
            <section className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-5 sm:p-6 min-w-0">
              <h2 className="text-lg font-display font-bold text-white mb-6 flex items-center gap-2">
                <Calendar className="text-purple-400" size={20} /> Progress &amp; Learning Activity
              </h2>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <div className="bg-[#020617]/50 border border-slate-800/50 rounded-2xl p-4 min-w-0">
                  <Clock size={18} className="text-emerald-400 mb-2" />
                  <p className="text-xl font-display font-bold text-white">{stats.activeDays}</p>
                  <p className="text-xs text-slate-400">Active Days</p>
                </div>
                <div className="bg-[#020617]/50 border border-slate-800/50 rounded-2xl p-4 min-w-0">
                  <BookOpen size={18} className="text-sky-400 mb-2" />
                  <p className="text-xl font-display font-bold text-white">{stats.questions}</p>
                  <p className="text-xs text-slate-400">Questions Answered</p>
                </div>
                <div className="bg-[#020617]/50 border border-slate-800/50 rounded-2xl p-4 min-w-0">
                  <Activity size={18} className="text-indigo-400 mb-2" />
                  <p className="text-xl font-display font-bold text-white">{stats.total}</p>
                  <p className="text-xs text-slate-400">CBTs Completed</p>
                </div>
                <div className="bg-[#020617]/50 border border-slate-800/50 rounded-2xl p-4 min-w-0">
                  <Layers size={18} className="text-amber-400 mb-2" />
                  <p className="text-xl font-display font-bold text-white">{enrolledSubjects}</p>
                  <p className="text-xs text-slate-400">Subjects Enrolled</p>
                </div>
              </div>
            </section>
          </>
        )}
      </motion.div>
    </DashboardLayout>
  );
}
