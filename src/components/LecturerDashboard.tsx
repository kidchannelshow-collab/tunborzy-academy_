import { useEffect, useState } from 'react';
import LecturerDashboardLayout from './lecturer/LecturerDashboardLayout';
import Overview from './lecturer/Overview';
import CourseManagement from './lecturer/CourseManagement';
import CBTManagement from './lecturer/CBTManagement';
import UTMEManagement from './utme/UTMEManagement';
import PostUtmeManagement from './postutme/PostUtmeManagement';
import StudentInsights from './lecturer/StudentInsights';
import Announcements from './lecturer/Announcements';
import LecturerProfile from './lecturer/LecturerProfile';
import { useLecturerCourses } from '../lib/lecturerCourses';

interface LecturerDashboardProps {
  onLogout: () => void;
  onNavigate?: (view: string) => void;
}

/**
 * Views that always exist for a lecturer, whatever they are assigned.
 * The portal-scoped entries are added below from the lecturer's own courses.
 */
const BASE_VIEWS = [
  'overview', 'courses', 'cbt', 'students', 'insights',
  'announcements', 'profile',
];

export default function LecturerDashboard({ onLogout, onNavigate }: LecturerDashboardProps) {
  const [currentView, setCurrentView] = useState('overview');
  // `courses` / `loading` / `reload` are consumed by Course Settings and by the
  // hook's own realtime refresh, so only the derived flags are needed here.
  const { hasUtme, hasPostUtme, ready } = useLecturerCourses();

  /**
   * The navigation a lecturer is entitled to.
   *
   * `utme-cbt` and `post-utme-cbt` render the SAME managers the Admin uses, and
   * they are the surfaces that carry the portal uploaders. They are offered only
   * when the lecturer actually has a course in that portal — a lecturer with no
   * Post-UTME assignment gets no Post-UTME entry, and nobody is offered the
   * Undergraduate manager (the hook never returns Undergraduate courses).
   */
  const allowedViews = [
    ...BASE_VIEWS,
    ...(hasUtme ? ['utme-cbt'] : []),
    ...(hasPostUtme ? ['post-utme-cbt'] : []),
  ];

  /**
   * Keep the visible view legal as assignments resolve. On first paint the
   * course list is still empty, so an entry can briefly be unavailable; if the
   * lecturer is sitting on it when that resolves, fall back to Overview rather
   * than rendering a manager they have no assignment for.
   */
  useEffect(() => {
    if (!ready) return;
    if (!allowedViews.includes(currentView)) setCurrentView('overview');
  }, [ready, currentView, allowedViews.join(',')]);

  const renderView = () => {
    switch (currentView) {
      case 'overview':
        return <Overview />;
      case 'courses':
        return <CourseManagement />;
      case 'cbt':
        return <CBTManagement />;
      case 'utme-cbt':
        return hasUtme ? <UTMEManagement /> : <Overview />;
      case 'post-utme-cbt':
        return hasPostUtme ? <PostUtmeManagement /> : <Overview />;
      case 'insights': // Analytics
      case 'students': // Student Management
        return <StudentInsights />;
      case 'announcements':
        return <Announcements />;

      case 'profile':
        return <LecturerProfile />;
      default:
        return <Overview />;
    }
  };

  return (
    <LecturerDashboardLayout
      currentView={currentView}
      onNavigate={setCurrentView}
      onLogout={onLogout}
      allowedViews={allowedViews}
    >
      {renderView()}
    </LecturerDashboardLayout>
  );
}
