import UTMECBTPage from './components/UTMECBTPage';
import UTMEManagement from './components/utme/UTMEManagement';
import { ErrorBoundary } from "./components/ErrorBoundary";
import FloatingNotificationButton from "./components/FloatingNotificationButton";
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, lazy, Suspense } from 'react';
import Navbar from './components/Navbar';
import Hero from './components/Hero';
import Portals from './components/Portals';
import Features from './components/Features';
import Testimonials from './components/Testimonials';
import Footer from './components/Footer';
const SignUp = lazy(() => import('./components/SignUp'));
const StudentDashboard = lazy(() => import('./components/StudentDashboard'));

const Login = lazy(() => import('./components/Login'));

const ResourceLibraryPage = lazy(() => import('./components/ResourceLibraryPage'));
const AcademicMaterialsPage = lazy(() => import('./components/student/AcademicMaterialsPage'));
const PostUtmeLearningPage = lazy(() => import('./components/postutme/PostUtmeLearningPage'));
const CBTPracticePage = lazy(() => import('./components/CBTPracticePage'));

const PerformanceAnalyticsPage = lazy(() => import('./components/PerformanceAnalyticsPage'));

const StudentProfilePage = lazy(() => import('./components/StudentProfilePage'));
const SettingsPage = lazy(() => import('./components/SettingsPage'));

const LecturerDashboard = lazy(() => import('./components/LecturerDashboard'));
const DashboardLayout = lazy(() => import('./components/dashboard/DashboardLayout'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));
const AnnouncementCenter = lazy(() => import('./components/AnnouncementCenter'));
const TunborzyAI = lazy(() => import('./components/TunborzyAI'));
const HelpSupportPage = lazy(() => import('./components/HelpSupportPage'));
import { useEffect } from 'react';
import { supabase } from './supabaseClient';
import { useProfile, getProfileCache } from './lib/useProfile';
import { useGeneralSettings } from './lib/platformSettings';
import { isAdminRole } from './lib/roles';
import MaintenanceScreen from './components/MaintenanceScreen';

/**
 * Views that stay reachable while maintenance mode is on.
 *
 * `currentView` is already normalised, so every landing section — home, about,
 * contact, features, portals — arrives here as 'landing' and is covered by the
 * one entry.
 *
 * Login and sign-up are on this list deliberately, and it is the whole point:
 * the gate used to replace EVERY view, so an administrator who was signed out
 * could not reach the sign-in form, could not become an administrator, and
 * therefore could not switch maintenance back off. The setting was a one-way
 * door. Public pages also have to stay up — a maintenance notice is only useful
 * if a visitor can read it.
 */
const PUBLIC_VIEWS: readonly string[] = ['landing', 'login', 'signup'];

export default function App() {
  const [currentView, setCurrentView] = useState<'landing' | 'signup' | 'login' | 'dashboard' | 'cbt' | 'utme' | 'resources' | 'academic-materials' | 'post-utme-learning' | 'analytics' | 'profile' | 'settings' | 'lecturer_dashboard' | 'admin_dashboard' | 'announcements' | 'ai' | 'help_support'>('landing');
  
  const { profile: userProfile, loading: isLoadingSession } = useProfile();
  const { settings: platformSettings } = useGeneralSettings();

  const isAllowed = (role: string, view: string) => {
    if (role === 'Student' && (view === 'admin_dashboard' || view === 'lecturer_dashboard')) return false;
    // Lecturer should be allowed to view dashboard temporarily? No, they have lecturer_dashboard
    if (role === 'Lecturer' && (view === 'admin_dashboard' || view === 'dashboard')) return false;
    if (role === 'Admin' && (view === 'dashboard' || view === 'lecturer_dashboard')) return false;
    return true;
  };

  useEffect(() => {
    if (isLoadingSession) return;

    const resolveRoute = () => {
      const hash = window.location.hash.replace('#', '');
      // If no hash, default to landing, unless they are logged in, then default to dashboard
      let nextRoute = hash;
      
      const landingSections = ['landing', 'home', 'about', 'contact', 'features', 'portals', ''];
      const publicRoutes = [...landingSections, 'login', 'signup'];

      if (userProfile) {
        // Logged in
        if (!nextRoute || nextRoute === 'login' || nextRoute === 'signup' || nextRoute === 'landing') {
          // If on a public/login route or empty route while logged in, go to dashboard
          const defaultDash = userProfile.role === 'Admin' ? 'admin_dashboard' : userProfile.role === 'Lecturer' ? 'lecturer_dashboard' : 'dashboard';
          window.history.replaceState({ view: defaultDash }, '', `/#${defaultDash}`);
          setCurrentView(defaultDash as any);
          return;
        } else if (!publicRoutes.includes(nextRoute) && !isAllowed(userProfile.role, nextRoute)) {
          // If trying to access an unauthorized private route
          const defaultDash = userProfile.role === 'Admin' ? 'admin_dashboard' : userProfile.role === 'Lecturer' ? 'lecturer_dashboard' : 'dashboard';
          window.history.replaceState({ view: defaultDash }, '', `/#${defaultDash}`);
          setCurrentView(defaultDash as any);
          return;
        }
      } else {
        // Not logged in
        if (!nextRoute) {
          nextRoute = 'landing';
        } else if (!publicRoutes.includes(nextRoute)) {
          // If trying to access a private route while not logged in
          nextRoute = 'login';
          window.history.replaceState({ view: 'login' }, '', `/#login`);
        }
      }

      if (landingSections.includes(nextRoute)) {
        setCurrentView('landing');
      } else {
        setCurrentView(nextRoute as any);
      }
    };
    resolveRoute();

    const handlePopState = () => {
      resolveRoute();
    };

    window.addEventListener('popstate', handlePopState);
    window.addEventListener('hashchange', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('hashchange', handlePopState);
    };
  }, [isLoadingSession, userProfile]);

  useEffect(() => {
    const handleScrollToHash = () => {
      if (currentView === 'landing') {
        const hash = window.location.hash.replace('#', '');
        if (hash && hash !== 'landing') {
          // Add a tiny delay to ensure rendering is complete
          setTimeout(() => {
            const targetElement = document.getElementById(hash);
            if (targetElement) {
              targetElement.scrollIntoView({ behavior: 'smooth' });
            }
          }, 50);
        }
      }
    };

    handleScrollToHash();
    window.addEventListener('hashchange', handleScrollToHash);
    return () => window.removeEventListener('hashchange', handleScrollToHash);
  }, [currentView]);



  const handleNavigate = (view: string) => {
    
    const landingSections = ['landing', 'home', 'about', 'contact', 'features', 'portals', ''];
    const publicRoutes = [...landingSections, 'login', 'signup'];
    const isPublicRoute = publicRoutes.includes(view);

    const currentProfile = getProfileCache() || userProfile;
    // During login transition, currentProfile might be null temporarily while fetchProfileForUser runs.
    // If we're trying to navigate to a dashboard from login, allow it temporarily; useEffect will correct it if needed.
    if (!currentProfile && !isPublicRoute) {
      if (['dashboard', 'admin_dashboard', 'lecturer_dashboard'].includes(view)) {
         // Allow optimistic navigation
      } else {
         view = 'login';
      }
    } else if (currentProfile && !isAllowed(currentProfile.role, view)) {
      return; // Deny
    }
    
    window.history.pushState({ view }, '', `/#${view}`);
    const nextCurrentView = landingSections.includes(view) ? 'landing' : view;
    setCurrentView(nextCurrentView as any);
  };

  const handleLogout = async () => {  
    try {
      if (supabase) {
        await supabase.auth.signOut();
      }
    } catch (e) {
      console.warn("Logout error:", e);
    }
    window.history.pushState({ view: 'landing' }, '', '/');
    setCurrentView('landing');
  };

  /**
   * Shown while the app does not yet know who the visitor is.
   *
   * Extracted into a const because the maintenance gate below can also need it:
   * a signed-in user whose profile has not arrived yet must wait rather than be
   * classified.
   */
  const sessionSpinner = (
    <div className="min-h-[100dvh] bg-[#020617] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <svg className="animate-spin h-8 w-8 text-amber-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p className="text-slate-400 font-body text-sm">Loading session...</p>
      </div>
    </div>
  );

  // Nothing can be decided until the role is known, so this is checked first.
  if (isLoadingSession) {
    return sessionSpinner;
  }

  /**
   * Global maintenance gate.
   *
   * `maintenance_mode` lives in `platform_settings.general`, is written only by
   * the admin-only settings endpoint, and is read by every visitor, signed in or
   * not (migration 0056 makes that row publicly readable — without it a
   * signed-out visitor would read zero rows).
   *
   * TWO CONDITIONS, BOTH REQUIRED
   *
   * It fires only on a PROTECTED view. Public pages stay up: a maintenance
   * notice is useless if the visitor cannot reach the page carrying it, and the
   * sign-in form has to remain reachable or an administrator who is signed out
   * can never get back in to switch the setting off.
   *
   * It fires only for a NON-ADMIN. `isAdminRole` accepts 'Admin', 'admin' and
   * 'Super Admin', matching `requireAdmin` in server.ts; the earlier literal
   * `!== 'Admin'` comparison locked out administrators stored under the other
   * two spellings. The two tests must stay identical — a divergence is a
   * lockout.
   *
   * The database enforces the same rule independently: maintenance mode is
   * admin-only at the RLS layer and behind `requireAdmin`, so hiding this screen
   * is a convenience, not the security boundary.
   */
  if (
    platformSettings.maintenance_mode &&
    !PUBLIC_VIEWS.includes(currentView) &&
    !isAdminRole(userProfile?.role)
  ) {
    // A signed-in user whose profile has not arrived yet. Returning the spinner
    // rather than the maintenance screen is what stops an administrator being
    // treated as an ordinary user before their role loads — the previous code
    // decided on a null profile and could strand them outside the one surface
    // that can switch maintenance off. The window closes as soon as the profile
    // resolves, and a visitor with no session is redirected to the public login
    // page by the router, so this cannot become a permanent state.
    if (!userProfile) return sessionSpinner;

    return <MaintenanceScreen />;
  }

  return (
    <div className="min-h-[100dvh] bg-[#020617] font-sans selection:bg-blue-500/30">
      {currentView === 'landing' && (
        <>
          <Navbar onSignUp={() => handleNavigate('signup')} onLogin={() => handleNavigate('login')} />
          <main>
            <Hero onSignUp={() => handleNavigate('signup')} onLogin={() => handleNavigate('login')} />
            <Portals />
            <Features />
            <Testimonials />
          </main>
          <Footer />
        </>
      )}
      {currentView === 'signup' && (
        <Suspense fallback={<div className="min-h-[100dvh] bg-[#020617] flex items-center justify-center"><div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div></div>}>
          <SignUp onCancel={() => handleNavigate('landing')} onSuccess={(role) => {
            if (role === 'Admin') handleNavigate('admin_dashboard');
            else if (role === 'Lecturer') handleNavigate('lecturer_dashboard');
            else handleNavigate('dashboard');
          }} />
        </Suspense>
      )}
      {currentView === 'login' && (
        <Login onCancel={() => handleNavigate('landing')} onSuccess={handleNavigate} />
      )}
      <Suspense fallback={<div className="min-h-[100dvh] bg-[#020617] flex items-center justify-center"><div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div></div>}>
      {currentView === 'dashboard' && (
        <StudentDashboard onLogout={handleLogout} onNavigate={handleNavigate} />
      )}
      {currentView === 'cbt' && (
        <CBTPracticePage onLogout={handleLogout} onNavigate={handleNavigate} />
      )}
      {currentView === 'resources' && (
        <ResourceLibraryPage onLogout={handleLogout} onNavigate={handleNavigate} />
      )}
      {currentView === 'academic-materials' && (
        <AcademicMaterialsPage onLogout={handleLogout} onNavigate={handleNavigate} />
      )}
      {currentView === 'post-utme-learning' && (
        <PostUtmeLearningPage onLogout={handleLogout} onNavigate={handleNavigate} />
      )}
      {currentView === 'analytics' && (
        <PerformanceAnalyticsPage onLogout={handleLogout} onNavigate={handleNavigate} />
      )}
      {currentView === 'profile' && (
        <StudentProfilePage onLogout={handleLogout} onNavigate={handleNavigate} />
      )}
      {currentView === 'settings' && (
        <SettingsPage onLogout={handleLogout} onNavigate={handleNavigate} />
      )}
      
      {currentView === 'lecturer_dashboard' && (
        <LecturerDashboard onLogout={handleLogout} onNavigate={handleNavigate} />
      )}
      {currentView === 'admin_dashboard' && (
        <AdminDashboard onLogout={handleLogout} onNavigate={handleNavigate} />
      )}
      {currentView === 'announcements' && (
        <AnnouncementCenter onBack={() => handleNavigate(userProfile?.role === 'Admin' ? 'admin_dashboard' : userProfile?.role === 'Lecturer' ? 'lecturer_dashboard' : 'dashboard')} onNavigate={handleNavigate} />
      )}
      {currentView === 'ai' && (
        <DashboardLayout onLogout={handleLogout} currentView="ai" onNavigate={handleNavigate}>
          <TunborzyAI
            onBack={() => handleNavigate(userProfile?.role === 'Admin' ? 'admin_dashboard' : userProfile?.role === 'Lecturer' ? 'lecturer_dashboard' : 'dashboard')}
            role={userProfile?.role === 'Lecturer' ? 'lecturer' : userProfile?.role === 'Admin' ? 'admin' : 'student'}
          />
        </DashboardLayout>
      )}
      {currentView === 'help_support' && (
        <HelpSupportPage onLogout={handleLogout} onNavigate={handleNavigate} />
      )}

      {currentView === 'utme' && (
        userProfile?.role === 'Admin' || userProfile?.role === 'Lecturer' ? (
          <DashboardLayout onLogout={handleLogout} currentView="utme" onNavigate={handleNavigate}>
            <UTMEManagement />
          </DashboardLayout>
        ) : (
          <UTMECBTPage onLogout={handleLogout} onNavigate={handleNavigate} />
        )
      )}

      {/* Floating Notification Button */}
      {currentView !== 'announcements' && currentView !== 'landing' && currentView !== 'login' && currentView !== 'signup' && (
        <FloatingNotificationButton onClick={() => handleNavigate('announcements')} />
      )}
      </Suspense>
    </div>
  );
}