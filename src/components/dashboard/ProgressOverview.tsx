import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { BookOpen, Clock, Target } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useProfile } from '../../lib/useProfile';
import { useRefetchOnFocus } from '../../lib/useRefetchOnFocus';

export default function ProgressOverview() {
  const { profile } = useProfile();
  const [statsData, setStatsData] = useState({
    topicsCount: 0,
    cbtCount: 0,
    cbtAvg: 0,
  });

  const fetchStats = useCallback(async () => {
    if (!profile) return;
      try {
        // A student's completed sittings live in the table for their portal:
        // UTME sittings in `utme_attempts` (keyed by `student_id`), the
        // undergraduate drill in `cbt_attempts` (keyed by `user_id`). This read
        // only `cbt_attempts`, so a UTME student's completed CBTs were invisible
        // here and every figure stayed at 0 even though the UTME dashboard and
        // the profile already showed them.
        //
        // Both of the student's OWN completed sittings are read and normalised
        // into one shape, rather than branching on `profile.portal`: that value
        // is not guaranteed to be exactly 'UTME', and a wrong guess silently
        // produces the same zero this is fixing. `status = 'completed'` excludes
        // started-but-unfinished attempts on both sides.
        //
        // Timestamps differ per table and there is no `created_at` on
        // `cbt_attempts` — selecting one returned 42703 and failed the whole
        // request. `utme_attempts` has only `created_at` (written when that
        // sitting's row was created); `cbt_attempts` uses `end_time` (the
        // completion stamp written by /api/cbt/submit), falling back to
        // `started_at`.
        // Post-UTME sittings live in their own table. Without it a Post-UTME
        // student's dashboard showed 0 CBTs and a 0% average no matter how much
        // they had actually done — the query succeeded, it just never looked
        // here. All three are the student's own rows, so reading them together
        // is not mixing unrelated data.
        const [utmeRes, cbtRes, postUtmeRes] = await Promise.all([
          supabase
            .from('utme_attempts')
            .select('score, percentage, created_at, utme_subjects(name)')
            .eq('student_id', profile.id)
            .eq('status', 'completed'),
          supabase
            .from('cbt_attempts')
            .select('score, end_time, started_at, cbt_exams(course_code)')
            .eq('user_id', profile.id)
            .eq('status', 'completed')
            .not('score', 'is', null),
          supabase
            .from('post_utme_attempts')
            .select('score, end_time, post_utme_exams(subject)')
            .eq('user_id', profile.id)
            .eq('status', 'completed')
            .not('score', 'is', null),
        ]);

        const attempts = [
          ...(utmeRes.data || []).map((a: any) => ({
            score: a.score ?? a.percentage ?? null,
            finishedAt: a.created_at,
            course: a.utme_subjects?.name,
          })),
          ...(cbtRes.data || []).map((a: any) => ({
            score: a.score ?? null,
            finishedAt: a.end_time || a.started_at,
            course: a.cbt_exams?.course_code,
          })),
          ...(postUtmeRes.data || []).map((a: any) => ({
            score: a.score ?? null,
            finishedAt: a.end_time,
            course: a.post_utme_exams?.subject,
          })),
        ];

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayAttempts = attempts.filter((a) => {
          if (!a.finishedAt) return false;
          return new Date(a.finishedAt) >= today;
        });

        const distinctCourses = new Set(todayAttempts.map((a) => a.course).filter(Boolean)).size;
        const cbtCount = todayAttempts.length;

        // `score` is ALREADY a percentage — both submit endpoints write
        // Math.round(correct / total * 100). Dividing it by a question total
        // again multiplied every average.
        let sum = 0;
        todayAttempts.forEach((a) => {
          if (a.score !== null && a.score !== undefined) {
            sum += Number(a.score);
          }
        });
        const cbtAvg = cbtCount > 0 ? Math.round(sum / cbtCount) : 0;

        setStatsData({
          topicsCount: distinctCourses,
          cbtCount,
          cbtAvg,
        });
      } catch (err) {
        console.error(err);
      }
  }, [profile]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // "Today's Progress" is the figure most likely to go stale: a practice drill
  // launched from the materials page runs in a modal and never navigates away,
  // so this dashboard stays mounted while an attempt is completed. Re-read
  // whenever the page is looked at again.
  useRefetchOnFocus(fetchStats);

  const stats = [
    { label: 'Courses Enrolled Today', value: `${statsData.topicsCount}`, icon: BookOpen, color: 'text-blue-500', bg: 'bg-blue-500/10' },
    { label: 'CBT Taken Today', value: `${statsData.cbtCount}`, icon: Clock, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
    { label: 'Average CBT Score Today', value: `${statsData.cbtAvg}%`, icon: Target, color: 'text-purple-500', bg: 'bg-purple-500/10' },
  ];

  return (
    <div className="mb-10">
      <h3 className="text-lg font-display font-bold text-white mb-4">
        Today's Progress
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {stats.map((stat, index) => (
          <motion.div
            key={index}
            whileHover={{ y: -5 }}
            className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800/50 rounded-2xl p-5 hover:border-slate-700 transition-all shadow-lg"
          >
            <div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center mb-4`}>
              <stat.icon size={20} className={stat.color} />
            </div>
            <p className="text-2xl font-display font-bold text-white mb-1">{stat.value}</p>
            <p className="text-xs sm:text-sm font-body text-slate-400">{stat.label}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
