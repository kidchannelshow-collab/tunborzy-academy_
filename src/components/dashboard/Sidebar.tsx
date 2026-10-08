import { useProfile } from '../../lib/useProfile';
import {
  cbtLabelForPortal,
  cbtRouteForPortal,
  learningRouteForPortal,
  normalisePortal,
} from '../../lib/portalRoutes';
import { motion, AnimatePresence } from 'motion/react';
import { 
  LayoutDashboard, BookOpen, PenTool, FileText, Library, 
  RefreshCcw, BarChart2, Bot, Bell, User, Settings, LogOut, X, Search, HelpCircle, MessageCircle, Award
} from 'lucide-react';

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onLogout: () => void;
  currentView?: string;
  onNavigate?: (view: string) => void;
}

export default function Sidebar({ isOpen, setIsOpen, onLogout, currentView = 'dashboard', onNavigate }: SidebarProps) {
  const { profile } = useProfile();
  const studentPortal = normalisePortal(profile?.portal);
  const isStaff = profile?.role === 'Admin' || profile?.role === 'Lecturer';

  // Only the icon varies per programme — a drill pen for the undergraduate
  // practice page, an exam award for the two exam centres. The route and the
  // label come from the shared map so this cannot drift from the Quick Actions
  // tiles, the analytics empty state or the profile history link.
  const cbtItem = {
    icon: studentPortal === 'Undergraduate' ? PenTool : Award,
    label: cbtLabelForPortal(studentPortal),
    id: cbtRouteForPortal(studentPortal),
  };

  const menuItems = isStaff ? [
    { icon: LayoutDashboard, label: 'Overview', id: 'overview' },
  ] : [
    { icon: LayoutDashboard, label: 'Dashboard', id: 'dashboard' },
    cbtItem,
    // Post-UTME students get their own Course -> Topic -> Lesson view. The
    // Undergraduate page they used to land on is hardcoded to "Undergraduate"
    // and drills against cbt_questions/cbt_attempts, which are the wrong tables
    // for a Post-UTME student.
    ...(studentPortal !== 'UTME'
      ? [{
          icon: Library,
          label: 'Academic Materials',
          id: learningRouteForPortal(studentPortal),
        }]
      : []),
    { icon: BarChart2, label: 'Performance Analytics', id: 'analytics' },
    { icon: Bell, label: 'Announcements', id: 'announcements' },
  ];

  const bottomItems = [
    { icon: User, label: 'Profile', id: 'profile' },
    { icon: Settings, label: 'Settings', id: 'settings' },
    { icon: HelpCircle, label: 'Help & Support', id: 'help_support' },
  ];

  const handleNavigate = (id: string) => {
    if (onNavigate) {
      onNavigate(id);
    }
    setIsOpen(false);
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full overflow-y-auto custom-scrollbar">
      <div className="p-6 flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold bg-gradient-to-r from-amber-400 to-amber-600 bg-clip-text text-transparent">
          TUNBORZY
        </h1>
        <button 
          onClick={() => setIsOpen(false)}
          className="lg:hidden text-slate-400 hover:text-white"
        >
          <X size={24} />
        </button>
      </div>

      <div className="px-4 pb-6 flex-1">
        <p className="px-4 text-xs font-poppins font-semibold text-slate-500 uppercase tracking-wider mb-4">
          Menu
        </p>
        <ul className="space-y-1">
          {menuItems.map((item, index) => {
            const isActive = currentView === item.id || (currentView === 'learning' && item.id === 'courses');
            return (
              <li key={index}>
                <button
                  onClick={() => handleNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-body font-medium transition-all ${
                    isActive
                      ? 'bg-amber-500/10 text-amber-500' 
                      : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                  }`}
                >
                  {item.id === 'profile' && profile?.avatar_url ? (
                    <img loading="lazy" src={profile.avatar_url} alt="Avatar" className="w-5 h-5 rounded-full object-cover" />
                  ) : (
                    <item.icon size={20} className={isActive ? 'text-amber-500' : 'text-slate-400'} />
                  )}
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="p-4 mt-auto border-t border-slate-800/50">
        <ul className="space-y-1 mb-4">
          {bottomItems.map((item, index) => {
            const isActive = currentView === item.id;
            return (
              <li key={index}>
                <button
                  onClick={() => handleNavigate(item.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-body font-medium transition-all ${
                    isActive
                      ? 'bg-amber-500/10 text-amber-500' 
                      : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                  }`}
                >
                  <item.icon size={20} className={isActive ? 'text-amber-500' : 'text-slate-400'} />
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
        <button 
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl font-body font-medium text-rose-500 hover:bg-rose-500/10 transition-all"
        >
          <LogOut size={20} />
          Logout
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 bg-[#020617]/80 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        className={`fixed top-0 left-0 h-[100dvh] w-72 bg-[#0f172a]/95 backdrop-blur-xl border-r border-slate-800/50 z-50 flex flex-col lg:translate-x-0 transition-transform duration-300 ease-in-out ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <SidebarContent />
      </motion.aside>
    </>
  );
}
