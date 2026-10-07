import { useState, ReactNode } from 'react';
import LecturerSidebar from './LecturerSidebar';
import { Menu } from 'lucide-react';

interface LecturerDashboardLayoutProps {
  children: ReactNode;
  onLogout: () => void;
  currentView: string;
  onNavigate: (view: string) => void;
  /** Portal-scoped view ids the lecturer may reach; forwarded to the sidebar. */
  allowedViews?: string[];
}

export default function LecturerDashboardLayout({ children, onLogout, currentView, onNavigate, allowedViews }: LecturerDashboardLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="min-h-[100dvh] bg-[#020617] flex">
      <LecturerSidebar
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
        onLogout={onLogout}
        currentView={currentView}
        onNavigate={onNavigate}
        allowedViews={allowedViews}
      />
      
      <div className="flex-1 min-w-0 lg:pl-72 flex flex-col min-h-[100dvh]">
        <header className="sticky top-0 z-30 bg-[#0f172a]/80 backdrop-blur-md border-b border-slate-800/50 px-4 py-3 lg:hidden flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 rounded-lg bg-slate-800/50 text-slate-300 hover:text-white transition-colors"
            >
              <Menu size={24} />
            </button>
            <span className="font-display font-bold text-white">Lecturer Portal</span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-x-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
