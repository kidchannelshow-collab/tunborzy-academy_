import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard, BookOpen, FileText, BarChart2, Bell, LogOut, X, Building2, PenTool
} from 'lucide-react';

interface LecturerSidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onLogout: () => void;
  currentView: string;
  onNavigate: (view: string) => void;
  /**
   * View ids this lecturer may reach. The portal-scoped entries (UTME Manager,
   * Post-UTME Manager, Undergraduate Manager) are omitted from `menuItems` when
   * the lecturer has no courses in that portal, so the navigation cannot offer a
   * surface they have no assignments for. Defaults to every entry for safety at
   * the type level.
   */
  allowedViews?: string[];
  /** The portals this lecturer actually holds courses in, for the access card. */
  portals?: string[];
}

export default function LecturerSidebar({ isOpen, setIsOpen, onLogout, currentView, onNavigate, allowedViews, portals }: LecturerSidebarProps) {
  const menuItems = [
    // 'Material Center' and 'AI Tools' were removed from lecturer access by
    // request. The underlying features are untouched elsewhere: materials are
    // still uploaded per assigned course from Course Settings (LessonEditor and
    // MaterialUploadModal), and TunborzyAI is still reachable for Admin/Student.
    //
    // 'My Students' used to sit here and rendered `StudentInsights` — the same
    // component the Analytics entry already opens — so it was a second door into
    // one room. Removed; Analytics is the single entry point for student data.
    { icon: LayoutDashboard, label: 'Overview', id: 'overview' },
    { icon: BookOpen, label: 'Course Settings', id: 'courses' },
    { icon: FileText, label: 'CBT Manager', id: 'cbt' },
    // One entry per portal the lecturer is actually assigned a course in. Each
    // renders the same manager surface the Admin uses, scoped to this lecturer.
    { icon: FileText, label: 'UTME CBT Manager', id: 'utme-cbt', portal: 'UTME' },
    { icon: Building2, label: 'Post-UTME Manager', id: 'post-utme-cbt', portal: 'Post-UTME' },
    { icon: PenTool, label: 'Undergraduate Manager', id: 'ug-cbt', portal: 'Undergraduate' },
    { icon: BarChart2, label: 'Analytics', id: 'insights' },
    { icon: Bell, label: 'Announcements', id: 'announcements' },
  ].filter((item) => !allowedViews || allowedViews.includes(item.id));

  // Shown in the access card so a lecturer can see at a glance which programmes
  // they are on. Falls back to a neutral label while assignments are resolving.
  const portalLabel = portals && portals.length > 0 ? portals.join(' · ') : 'No Courses Assigned';

  const handleNavigate = (id: string) => {
    onNavigate(id);
    setIsOpen(false);
  };

  /**
   * Plain JSX, NOT a nested component.
   *
   * This was previously `const SidebarContent = () => (...)`, declared inside the
   * component body. A function declared in the render body is a brand-new
   * component *type* on every render, so React could not reconcile it — it tore
   * the entire sidebar (header, ten nav buttons, portal card, sign-out) out of
   * the DOM and rebuilt it on every single toggle. Holding the same element tree
   * in a variable keeps the component type stable across renders, so a toggle is
   * now a class change on one element instead of a full subtree remount.
   */
  const sidebarContent = (
    <div className="flex flex-col h-full overflow-y-auto custom-scrollbar">
      <div className="p-6 flex items-center justify-between">
        <h1 className="text-2xl font-display font-bold bg-gradient-to-r from-emerald-400 to-emerald-600 bg-clip-text text-transparent">
          TUNBORZY
        </h1>
        <button
          onClick={() => setIsOpen(false)}
          className="lg:hidden text-slate-400 hover:text-white"
        >
          <X size={24} />
        </button>
      </div>

      <div className="px-6 mb-6">
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4">
          <p className="text-xs text-emerald-500 font-bold uppercase tracking-wider mb-1">Assigned Programmes</p>
          <p className="text-sm font-bold text-white">{portalLabel}</p>
        </div>
      </div>

      <nav className="flex-1 px-4 space-y-1">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => handleNavigate(item.id)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-semibold text-sm ${
              currentView === item.id
                ? 'bg-amber-500 text-slate-950 shadow-lg shadow-amber-500/20'
                : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'
            }`}
          >
            <item.icon size={18} className={currentView === item.id ? 'text-slate-950' : 'text-slate-400'} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="p-4 mt-auto">
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors font-semibold text-sm"
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </div>
  );

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsOpen(false)}
            className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/*
        ONE animation system, and it is CSS.

        This element previously carried BOTH: Framer Motion animating `x`
        (writing an inline `transform: translateX(-280px)`) AND the Tailwind
        classes `translate-x-0`/`-translate-x-full` plus `transition-transform`.
        Those are not the same property — Tailwind v4 compiles the translate
        utilities to the CSS `translate` property — so the two offsets COMPOSED
        instead of overriding. Measured in the browser: -280px on desktop (the
        sidebar sat permanently off-screen behind the layout's reserved
        `lg:pl-72` gutter, because an inline transform cannot be beaten by a
        `lg:` class) and -560px on mobile, where the mobile slide then ran two
        independently-timed 280px moves and visibly rubber-banded.

        Motion's `x` and `transition-transform` are both gone. Only the CSS
        transition below drives the transform, so there is exactly one owner of
        the property, desktop is pinned by `lg:translate-x-0`, and mobile slides
        on a single 300ms curve.
      */}
      <aside
        className={`fixed top-0 left-0 bottom-0 w-[280px] bg-[#0f172a] border-r border-slate-800 z-50 transition-transform duration-300 ease-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
