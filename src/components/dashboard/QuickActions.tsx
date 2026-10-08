import { motion } from 'motion/react';
import { BookOpen, PenTool, RefreshCcw, BarChart2, Award } from 'lucide-react';
import { useProfile } from '../../lib/useProfile';
import {
  cbtLabelForPortal,
  cbtRouteForPortal,
  learningRouteForPortal,
  normalisePortal,
} from '../../lib/portalRoutes';

interface QuickActionsProps {
  onNavigate?: (view: string) => void;
}

export default function QuickActions({ onNavigate }: QuickActionsProps) {
  const { profile } = useProfile();
  const studentPortal = normalisePortal(profile?.portal);

  // Colour and icon vary per programme; the route and the label come from the
  // shared map so these tiles cannot disagree with the Sidebar or with the
  // analytics/profile entry points.
  const cbtAction = studentPortal === 'Undergraduate'
    ? { icon: PenTool, label: cbtLabelForPortal(studentPortal), color: 'from-amber-400 to-amber-600', shadow: 'shadow-amber-500/20', id: cbtRouteForPortal(studentPortal) }
    : { icon: Award, label: cbtLabelForPortal(studentPortal), color: 'from-emerald-400 to-teal-600', shadow: 'shadow-emerald-500/20', id: cbtRouteForPortal(studentPortal) };

  const actions = [
    // Post-UTME has its own Course -> Topic -> Lesson page. This tile used to
    // send it to 'academic-materials' — the Undergraduate library, which is
    // hardcoded to that portal and drills against the wrong tables — while the
    // Sidebar sent the same student to the right page.
    ...(studentPortal !== 'UTME'
      ? [{ icon: BookOpen, label: 'Academic Materials', color: 'from-blue-500 to-indigo-600', shadow: 'shadow-blue-500/20', id: learningRouteForPortal(studentPortal) }]
      : []),
    cbtAction,
    { icon: BarChart2, label: 'Performance Analytics', color: 'from-orange-400 to-orange-600', shadow: 'shadow-orange-500/20', id: 'analytics' },
  ];

  return (
    <div className="mb-10">
      <h3 className="text-lg font-display font-bold text-white mb-4 flex items-center gap-2">
        Quick Actions
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7 gap-4">
        {actions.map((action, index) => (
          <motion.button
            key={index}
            whileHover={{ y: -5, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onNavigate && onNavigate(action.id)}
            className={`flex flex-col items-center justify-center gap-3 p-4 rounded-2xl bg-[#0f172a]/80 backdrop-blur-md border border-slate-800/50 hover:border-slate-700 transition-all group hover:bg-[#1e293b]/50 shadow-lg ${action.shadow}`}
          >
            <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${action.color} p-0.5 shadow-inner`}>
              <div className="w-full h-full bg-[#0f172a]/40 rounded-[10px] flex items-center justify-center backdrop-blur-sm group-hover:bg-transparent transition-all">
                <action.icon size={24} className="text-white" />
              </div>
            </div>
            <span className="text-xs sm:text-sm font-poppins font-medium text-slate-300 group-hover:text-white text-center leading-tight">
              {action.label}
            </span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
