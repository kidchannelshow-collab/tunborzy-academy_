import { PenTool, Megaphone, Clock, Award } from 'lucide-react';
import { motion } from 'motion/react';
import { useCallback, useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useProfile } from '../../lib/useProfile';
import { cbtRouteForPortal } from '../../lib/portalRoutes';
import { useRefetchOnFocus } from '../../lib/useRefetchOnFocus';

interface ActivityAndAnnouncementsProps {
  onNavigate?: (view: string) => void;
}

export default function ActivityAndAnnouncements({ onNavigate }: ActivityAndAnnouncementsProps) {
  const { profile } = useProfile();
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);

  const load = useCallback(async () => {
    if (!profile) return;
    const fetchAnnouncements = async () => {
      try {
        const { data, error } = await supabase
          .from('announcements')
          .select('*')
          .eq('target_role', profile.role)
          .order('created_at', { ascending: false })
          .limit(3);
        if (data) setAnnouncements(data);
      } catch (err) {
        console.error(err);
      }
    };

    const fetchActivities = async () => {
      try {
        // COMPLETED CBTs only, from the table each portal records into: UTME in
        // `utme_attempts` (keyed by `student_id`), the undergraduate drill in
        // `cbt_attempts` (keyed by `user_id`). This previously read
        // `cbt_attempts` alone with no status filter, so a UTME student's feed
        // was empty and unfinished sittings could surface as activity.
        //
        // Same source and same definition of "a CBT taken" as the UTME
        // dashboard, Performance Analytics and the Profile, so all four agree.
        const [utmeRes, cbtRes, postUtmeRes] = await Promise.all([
          supabase
            .from('utme_attempts')
            .select('id, score, percentage, created_at, utme_subjects(name)')
            .eq('student_id', profile.id)
            .eq('status', 'completed')
            .order('created_at', { ascending: false })
            .limit(3),
          supabase
            .from('cbt_attempts')
            .select('id, score, end_time, cbt_exams(title)')
            .eq('user_id', profile.id)
            .eq('status', 'completed')
            .order('end_time', { ascending: false })
            .limit(3),
          // Post-UTME screenings are their own table; without this a Post-UTME
          // student's feed stayed empty however much they had practised.
          supabase
            .from('post_utme_attempts')
            .select('id, score, end_time, post_utme_exams(title, subject)')
            .eq('user_id', profile.id)
            .eq('status', 'completed')
            .order('end_time', { ascending: false })
            .limit(3),
        ]);

        const merged = [
          ...(utmeRes.data || []).map((a: any) => ({
            at: a.created_at,
            name: a.utme_subjects?.name || 'UTME CBT',
            score: Math.round(Number(a.score ?? a.percentage ?? 0)),
          })),
          ...(cbtRes.data || []).map((a: any) => ({
            at: a.end_time,
            name: a.cbt_exams?.title || 'CBT Practice',
            score: Math.round(Number(a.score ?? 0)),
          })),
          ...(postUtmeRes.data || []).map((a: any) => ({
            at: a.end_time,
            name: a.post_utme_exams?.title || a.post_utme_exams?.subject || 'Post-UTME CBT',
            score: Math.round(Number(a.score ?? 0)),
          })),
        ]
          .filter((a) => a.at)
          .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
          .slice(0, 3);

        setActivities(
          merged.map((a) => ({
            type: 'cbt',
            title: `Completed CBT: ${a.name}`,
            time: `${new Date(a.at).toLocaleDateString()} · ${a.score}%`,
            // Award/emerald is the UTME CBT mark used by the sidebar and quick
            // actions; PenTool/amber is kept for the undergraduate drill so a
            // CBT entry is recognisable as whichever system it belongs to.
            icon: profile?.portal === 'Undergraduate' ? PenTool : Award,
            color: profile?.portal === 'Undergraduate' ? 'text-amber-500' : 'text-emerald-500',
            bg: profile?.portal === 'Undergraduate' ? 'bg-amber-500/10' : 'bg-emerald-500/10',
          })),
        );
      } catch (err) {
        console.error(err);
      }
    };

    await Promise.all([fetchAnnouncements(), fetchActivities()]);
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  // A drill completed from the materials page does not navigate away, so this
  // feed would otherwise keep showing the activity it fetched on mount.
  useRefetchOnFocus(load);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-10">
      {/* Recent Activity */}
      <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800/50 rounded-2xl p-6 shadow-xl shadow-black/10">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-display font-bold text-white flex items-center gap-2">
            Recent Activity
          </h3>
        </div>
        
        <div className="space-y-4">
          {activities.length > 0 ? activities.map((activity, index) => (
            <motion.div 
              key={index}
              whileHover={{ x: 4 }}
              onClick={() => {
                if (activity.type === 'chat') if (onNavigate) onNavigate('chats');
                // Each programme keeps its CBT history in its own centre; the
                // profile decides which. See lib/portalRoutes.ts.
                if (activity.type === 'cbt') {
                  if (onNavigate) onNavigate(cbtRouteForPortal(profile?.portal));
                }
              }}
              className="flex items-center gap-4 p-3 rounded-xl hover:bg-slate-800/50 transition-colors cursor-pointer group"
            >
              <div className={`w-10 h-10 rounded-xl ${activity.bg} flex items-center justify-center shrink-0`}>
                <activity.icon size={18} className={activity.color} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-body font-medium text-slate-200 truncate group-hover:text-white transition-colors">
                  {activity.title}
                </p>
                <p className="text-xs font-poppins text-slate-500 mt-0.5">
                  {activity.time}
                </p>
              </div>
            </motion.div>
          )) : (
            <div className="text-center py-8">
              <Clock className="w-12 h-12 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">No recent activity found.</p>
              {/* Was labelled "Start learning" and routed to 'courses', a view
                  that no longer exists, so it led nowhere. It then hardcoded the
                  UTME centre, which sent an Undergraduate student to the wrong
                  CBT page; the profile now picks the centre. */}
              <button
                onClick={() => onNavigate && onNavigate(cbtRouteForPortal(profile?.portal))}
                className="mt-2 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                Take a CBT practice
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Announcements */}
      <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800/50 rounded-2xl p-6 shadow-xl shadow-black/10">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-display font-bold text-white flex items-center gap-2">
            <Megaphone size={20} className="text-amber-500" />
            Announcements
          </h3>
          <button onClick={() => onNavigate && onNavigate('announcements')} className="text-sm font-poppins font-medium text-amber-500 hover:text-amber-400 transition-colors">
            View All
          </button>
        </div>
        
        <div className="space-y-4">
          {announcements.length > 0 ? announcements.map((announcement, index) => (
            <motion.div 
              key={index}
              whileHover={{ x: 4 }}
              onClick={() => onNavigate && onNavigate('announcements')}
              className="p-4 rounded-xl border border-slate-800 bg-slate-900/50 hover:border-slate-700 hover:bg-slate-800/80 transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
                <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-slate-800 text-slate-300 truncate min-w-0">
                  {announcement.created_by || 'Admin'}
                </span>
                <span className="text-xs font-poppins text-slate-500 shrink-0">
                  {new Date(announcement.created_at).toLocaleDateString()}
                </span>
              </div>
              {/* break-words + min-w-0 keep an unbroken string (long URL, no-space
                  text) inside the card instead of widening it or the page. The
                  card is not height-constrained, so it grows instead of clipping. */}
              <p className="text-sm font-body font-medium text-slate-200 break-words min-w-0 [overflow-wrap:anywhere]">
                {announcement.title}
              </p>
            </motion.div>
          )) : (
            <div className="text-center py-8">
              <Megaphone className="w-12 h-12 text-slate-700 mx-auto mb-3" />
              <p className="text-slate-400 font-medium">No new announcements</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
