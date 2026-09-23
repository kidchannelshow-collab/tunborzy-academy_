import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Settings, Globe, BookOpen, Clock, Award, Users, Bell, Save, CheckCircle2, AlertCircle, RefreshCw, ShieldAlert, ToggleLeft, ToggleRight, Cpu, HardDrive, Key, Activity, ShieldCheck, AlertTriangle, Calendar, GraduationCap, Wrench } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { refreshPlatformSettings } from '../../lib/platformSettings';
import { readApiJsonOrThrow } from '../../lib/apiResponse';

/**
 * System Settings — the admin surface for platform-wide configuration.
 *
 * WHAT THIS SCREEN IS FOR
 *
 * Every value edited here is stored in `platform_settings` (one row per category,
 * JSONB blob) and read back by the running platform. Nothing on this screen is
 * frontend-only state: if a toggle here does not change the platform's
 * behaviour, it does not belong on this screen.
 *
 * Several sections edit the SAME database row. General and Maintenance are both
 * `general`; UTME, Post-UTME, Undergraduate and CBT Configuration are all `cbt`.
 * That is deliberate — the row is the unit of storage, not the unit of meaning —
 * and it is why the whole category's state is loaded before any part of it is
 * saved. Writing back a partial object would silently drop the sibling keys.
 *
 * The CBT flags live in exactly one place (`cbt`). The `features` category used
 * to carry a second, contradictory copy of the three CBT flags plus copies of
 * the premium/partnership/notification switches; those duplicates are no longer
 * read or written, so there is one authoritative value for each setting.
 */

type TabId =
  | 'general' | 'maintenance' | 'academic'
  | 'utme' | 'postutme' | 'undergraduate' | 'cbt'
  | 'premium' | 'partnership' | 'notification' | 'features' | 'health';

/** Which `platform_settings` row each tab writes. */
const TAB_CATEGORY: Record<TabId, string> = {
  general: 'general',
  maintenance: 'general',
  academic: 'academic',
  utme: 'cbt',
  postutme: 'cbt',
  undergraduate: 'cbt',
  cbt: 'cbt',
  premium: 'premium',
  partnership: 'partnership',
  notification: 'notification',
  features: 'features',
  health: 'health',
};

/**
 * Undergraduate supports 100 Level only. 200–500 Level were never built: nothing
 * in the platform writes any other value to `courses.level`, and no
 * student-facing page reads a level list from settings. The value is stored so
 * the row describes the platform accurately, and is not editable, so the admin
 * UI cannot advertise levels that have no content behind them.
 */
const SUPPORTED_UNDERGRADUATE_LEVELS = ['100 Level'];

export default function SystemSettings() {
  const [activeTab, setActiveTab] = useState<TabId>('general');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [unsavedChanges, setUnsavedChanges] = useState(false);

  // Settings State
  const [general, setGeneral] = useState({
    platform_name: 'Tunborzy Academy',
    platform_description: 'Excellence in Academic and CBT Preparation',
    support_email: 'support@tunborzy.edu.ng',
    support_phone: '+234 800 000 0000',
    maintenance_mode: false
  });

  const [academic, setAcademic] = useState({
    current_academic_session: '2026/2027',
    current_semester: 'First Semester' as 'First Semester' | 'Second Semester'
  });

  const [cbt, setCbt] = useState({
    undergraduate_cbt_enabled: true,
    utme_cbt_enabled: true,
    post_utme_cbt_enabled: true,
    default_exam_duration_mins: 30,
    default_question_count: 40
  });

  const [premium, setPremium] = useState({
    premium_system_enabled: true,
    premium_access_config: 'Full Access',
    subscription_config: 'Monthly / Yearly'
  });

  const [partnership, setPartnership] = useState({
    referral_system_enabled: true,
    commission_percentage: 20.0,
    default_referral_config: 'Standard 20% Commission'
  });

  const [notification, setNotification] = useState({
    notifications_enabled: true,
    system_notification_config: 'Real-time Push & In-App',
    notification_behavior: 'Instant'
  });

  /**
   * Keys unique to the `features` row. The CBT / premium / partnership /
   * notification switches that used to be duplicated here now have exactly one
   * home each — the category tab named after them — so they are not listed.
   */
  const [features, setFeatures] = useState({
    undergraduate_materials_enabled: true,
    undergraduate_ai_rag_enabled: true,
    student_dashboard_enabled: true,
    lecturer_dashboard_enabled: true
  });

  const FEATURE_KEYS = [
    'undergraduate_materials_enabled',
    'undergraduate_ai_rag_enabled',
    'student_dashboard_enabled',
    'lecturer_dashboard_enabled',
  ] as const;

  // System Health state
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/admin/settings', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });
      // Reading through the helper means a backend that answers with an HTML or
      // plain-text error page reports the actual status and the server's own
      // message, rather than surfacing as a JSON parse error.
      const data = await readApiJsonOrThrow<any>(res, 'Failed to fetch platform settings');

      if (data.settings && Array.isArray(data.settings)) {
        data.settings.forEach((row: any) => {
          if (row.category === 'general' && row.settings) {
            setGeneral(prev => ({ ...prev, ...row.settings }));
          } else if (row.category === 'academic' && row.settings) {
            setAcademic(prev => ({
              ...prev,
              current_academic_session:
                row.settings.current_academic_session ?? prev.current_academic_session,
              // Only the two real semesters are accepted; anything else (the old
              // "Summer / Rain Semester", or a hand-edited value) is discarded
              // rather than shown as a selected option that does not exist.
              current_semester:
                row.settings.current_semester === 'Second Semester'
                  ? 'Second Semester'
                  : 'First Semester'
            }));
          } else if (row.category === 'cbt' && row.settings) {
            setCbt(prev => ({ ...prev, ...row.settings }));
          } else if (row.category === 'premium' && row.settings) {
            setPremium(prev => ({ ...prev, ...row.settings }));
          } else if (row.category === 'partnership' && row.settings) {
            setPartnership(prev => ({ ...prev, ...row.settings }));
          } else if (row.category === 'notification' && row.settings) {
            setNotification(prev => ({ ...prev, ...row.settings }));
          } else if (row.category === 'features' && row.settings) {
            // Only the keys this screen owns are lifted out. Any legacy duplicate
            // left in the row is ignored, so the next save clears it.
            setFeatures(prev => {
              const next = { ...prev };
              for (const key of FEATURE_KEYS) {
                if (row.settings[key] !== undefined) (next as any)[key] = row.settings[key];
              }
              return next;
            });
          }
        });
      }
    } catch (err: any) {
      console.error('Error loading settings:', err);
      setErrorMsg(err.message || 'Failed to load settings');
    } finally {
      setLoading(false);
      setUnsavedChanges(false);
    }
  };

  const checkSystemHealth = async () => {
    setCheckingHealth(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const res = await fetch('/api/admin/system-health', {
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });
      if (!res.ok) throw new Error('Failed to run system health diagnostics');
      const data = await res.json();
      setHealthStatus(data);
    } catch (err: any) {
      console.error('Health check error:', err);
      setErrorMsg('Failed to check system health');
    } finally {
      setCheckingHealth(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'health') {
      checkSystemHealth();
    }
  }, [activeTab]);

  const handleSave = async (tab: TabId) => {
    const category = TAB_CATEGORY[tab];
    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Not authenticated');
      }

      let payloadSettings: any = {};
      if (category === 'general') {
        if (!general.platform_name.trim()) throw new Error('Platform name cannot be empty');
        if (!general.support_email.includes('@')) throw new Error('Invalid support email address');
        // Both the General and Maintenance tabs write this row, so the whole
        // object is sent either way — a partial payload would drop the sibling.
        payloadSettings = general;
      } else if (category === 'academic') {
        if (academic.current_semester !== 'First Semester' && academic.current_semester !== 'Second Semester') {
          throw new Error('The active semester must be First or Second Semester');
        }
        payloadSettings = {
          ...academic,
          undergraduate_levels: SUPPORTED_UNDERGRADUATE_LEVELS
        };
      } else if (category === 'cbt') {
        const dur = Number(cbt.default_exam_duration_mins);
        const qCount = Number(cbt.default_question_count);
        if (isNaN(dur) || dur <= 0) throw new Error('Exam duration must be positive');
        if (isNaN(qCount) || qCount <= 0) throw new Error('Question count must be positive');
        payloadSettings = cbt;
      } else if (category === 'premium') {
        payloadSettings = premium;
      } else if (category === 'partnership') {
        const pct = Number(partnership.commission_percentage);
        if (isNaN(pct) || pct < 0 || pct > 100) throw new Error('Commission percentage must be between 0 and 100');
        payloadSettings = partnership;
      } else if (category === 'notification') {
        payloadSettings = notification;
      } else if (category === 'features') {
        // Built explicitly from the owned keys so legacy duplicates in the stored
        // row are dropped rather than written back.
        payloadSettings = FEATURE_KEYS.reduce((acc, key) => {
          acc[key] = (features as any)[key];
          return acc;
        }, {} as Record<string, boolean>);
      }

      const res = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ category, settings: payloadSettings })
      });

      await readApiJsonOrThrow<any>(res, 'Failed to save settings');

      // The shared store backs the maintenance gate, the branding and every exam
      // entry point, so it is refreshed from the database rather than patched —
      // the whole app then reflects the saved value on the next render.
      await refreshPlatformSettings();

      setSuccessMsg(`${TAB_LABELS[tab]} updated successfully!`);
      setUnsavedChanges(false);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      console.error('Error saving settings:', err);
      setErrorMsg(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const TAB_LABELS: Record<TabId, string> = {
    general: 'General',
    maintenance: 'Maintenance',
    academic: 'Academic Sessions',
    utme: 'UTME',
    postutme: 'Post-UTME',
    undergraduate: 'Undergraduate',
    cbt: 'CBT Configuration',
    premium: 'Premium',
    partnership: 'Partnership',
    notification: 'Notification',
    features: 'Platform Features',
    health: 'System Health',
  };

  const tabs: { id: TabId; label: string; icon: any }[] = [
    { id: 'general', label: 'General', icon: Globe },
    { id: 'maintenance', label: 'Maintenance', icon: Wrench },
    { id: 'academic', label: 'Academic Sessions', icon: Calendar },
    { id: 'utme', label: 'UTME', icon: Clock },
    { id: 'postutme', label: 'Post-UTME', icon: Clock },
    { id: 'undergraduate', label: 'Undergraduate', icon: GraduationCap },
    { id: 'cbt', label: 'CBT Configuration', icon: BookOpen },
    { id: 'premium', label: 'Premium Settings', icon: Award },
    { id: 'partnership', label: 'Partnership Settings', icon: Users },
    { id: 'notification', label: 'Notification Settings', icon: Bell },
    { id: 'features', label: 'Platform Features', icon: ShieldAlert },
    { id: 'health', label: 'System Health & Env', icon: Activity },
  ];

  /** A large on/off switch, used by every boolean setting on this screen. */
  const Toggle = ({ on, onChange, danger }: { on: boolean; onChange: () => void; danger?: boolean }) => (
    <button
      onClick={onChange}
      className={`text-2xl transition-colors ${
        on ? (danger ? 'text-amber-400' : 'text-emerald-400') : 'text-slate-600'
      }`}
    >
      {on ? <ToggleRight size={36} /> : <ToggleLeft size={36} />}
    </button>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin h-8 w-8 border-4 border-indigo-500 border-t-transparent rounded-full"></div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 max-w-7xl mx-auto pb-12"
    >
      {/* Header */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-white flex items-center gap-3">
            <Settings className="text-indigo-400" size={32} /> Platform Admin Settings
          </h1>
          <p className="text-slate-400 text-sm mt-1">The central source of truth for platform-wide configuration. Changes here apply across the platform.</p>
        </div>
        <button
          onClick={fetchSettings}
          className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 self-start md:self-auto"
        >
          <RefreshCw size={16} /> Refresh
        </button>
      </div>

      {successMsg && (
        <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-300 text-xs font-medium flex items-center gap-2">
          <CheckCircle2 size={16} /> {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-300 text-xs font-medium flex items-center gap-2">
          <AlertCircle size={16} /> {errorMsg}
        </div>
      )}

      {/* Navigation Tabs & Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Sidebar Nav */}
        <div className="lg:col-span-4 bg-[#0f172a] border border-slate-800 rounded-3xl p-4 shadow-xl space-y-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-xs font-bold transition-all ${isActive ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30' : 'text-slate-400 hover:text-white hover:bg-slate-900/50'}`}
              >
                <Icon size={18} /> {tab.label}
              </button>
            );
          })}
        </div>

        {/* Main Settings Panel */}
        <div className="lg:col-span-8 bg-[#0f172a] border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
          {/* SYSTEM HEALTH & ENVIRONMENT CHECK */}
          {activeTab === 'health' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-display font-bold text-white">System Health & Environment Diagnostics</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Real-time connection status of platform dependencies and environment configuration.</p>
                </div>
                <button
                  onClick={checkSystemHealth}
                  disabled={checkingHealth}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-2"
                >
                  <RefreshCw size={14} className={checkingHealth ? 'animate-spin' : ''} /> Check Health
                </button>
              </div>

              {checkingHealth ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin h-6 w-6 border-2 border-indigo-500 border-t-transparent rounded-full"></div>
                </div>
              ) : healthStatus ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {[
                      { name: 'Supabase Database', status: healthStatus.supabase_db, icon: HardDrive },
                      { name: 'Supabase Authentication', status: healthStatus.supabase_auth, icon: Key },
                      { name: 'Supabase Storage', status: healthStatus.supabase_storage, icon: HardDrive },
                      { name: 'Express Backend', status: healthStatus.express_backend, icon: Cpu },
                      { name: 'Gemini AI API', status: healthStatus.gemini_ai, icon: Cpu },
                      { name: 'Flutterwave Config', status: healthStatus.flutterwave, icon: ShieldCheck },
                    ].map((item, idx) => {
                      const isConnected = item.status === 'Connected';
                      const isMissing = item.status === 'Configuration Missing';
                      const StatusIcon = isConnected ? ShieldCheck : AlertTriangle;
                      return (
                        <div key={idx} className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2.5 rounded-xl bg-slate-800 text-slate-300">
                              <item.icon size={20} />
                            </div>
                            <div>
                              <div className="text-white text-sm font-bold">{item.name}</div>
                              <div className="text-xs text-slate-400">Environment verified</div>
                            </div>
                          </div>
                          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold ${
                            isConnected ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            isMissing ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                            <StatusIcon size={14} /> {item.status}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-2xl text-xs text-indigo-300 flex items-center gap-2">
                    <ShieldCheck size={16} /> Security Verified: No private keys, secret tokens, or sensitive environment credentials are exposed to the client interface.
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* GENERAL */}
          {activeTab === 'general' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-display font-bold text-white">General Platform Configuration</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Platform identity and contact details. These values are used by the navbar, footer,
                  maintenance screen, document title and support links across the platform.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Platform Name</label>
                  <input
                    type="text"
                    value={general.platform_name}
                    onChange={(e) => { setGeneral({ ...general, platform_name: e.target.value }); setUnsavedChanges(true); }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Platform Description</label>
                  <textarea
                    rows={3}
                    value={general.platform_description}
                    onChange={(e) => { setGeneral({ ...general, platform_description: e.target.value }); setUnsavedChanges(true); }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500 resize-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Support Email</label>
                    <input
                      type="email"
                      value={general.support_email}
                      onChange={(e) => { setGeneral({ ...general, support_email: e.target.value }); setUnsavedChanges(true); }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Support Phone</label>
                    <input
                      type="text"
                      value={general.support_phone}
                      onChange={(e) => { setGeneral({ ...general, support_phone: e.target.value }); setUnsavedChanges(true); }}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* MAINTENANCE */}
          {activeTab === 'maintenance' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-display font-bold text-white">Maintenance Mode</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  A platform-wide setting stored in the database. While it is on, every visitor and
                  signed-in student or lecturer is shown a maintenance screen in place of the
                  platform, including the landing, sign-in and sign-up pages.
                </p>
              </div>

              <div className={`p-5 rounded-2xl border flex items-center justify-between ${
                general.maintenance_mode
                  ? 'bg-amber-500/10 border-amber-500/40'
                  : 'bg-slate-900 border-slate-800'
              }`}>
                <div>
                  <div className={`text-sm font-bold flex items-center gap-2 ${general.maintenance_mode ? 'text-amber-300' : 'text-white'}`}>
                    <AlertTriangle size={18} /> Maintenance Mode
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      general.maintenance_mode
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}>
                      {general.maintenance_mode ? 'ON' : 'OFF'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 max-w-md">
                    When enabled, students and lecturers see a maintenance notice. Administrators
                    keep full access so they can sign in and switch it back off.
                  </div>
                </div>
                <Toggle
                  on={general.maintenance_mode}
                  danger
                  onChange={() => {
                    setGeneral({ ...general, maintenance_mode: !general.maintenance_mode });
                    setUnsavedChanges(true);
                  }}
                />
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs text-slate-400 flex items-start gap-2">
                <ShieldCheck size={16} className="text-slate-500 shrink-0 mt-0.5" />
                The maintenance screen shows the platform name, description and support contact
                details saved under General, so those stay current while the platform is closed.
              </div>
            </div>
          )}

          {/* ACADEMIC SESSIONS */}
          {activeTab === 'academic' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-display font-bold text-white">Academic Sessions</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  The academic session label and the single active semester for undergraduate
                  content, materials and CBT.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Current Academic Session</label>
                  <input
                    type="text"
                    value={academic.current_academic_session}
                    onChange={(e) => { setAcademic({ ...academic, current_academic_session: e.target.value }); setUnsavedChanges(true); }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Active Semester</label>
                  <p className="text-xs text-slate-500 mb-3">
                    Exactly one semester is active at a time. Selecting one automatically closes the
                    other — the other semester's courses, materials and CBT papers are withheld from
                    students while it is closed. Nothing is deleted: closing a semester only changes
                    which content is offered, and past attempts and scores are untouched.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {(['First Semester', 'Second Semester'] as const).map((sem) => {
                      const isActive = academic.current_semester === sem;
                      const other = sem === 'First Semester' ? 'Second Semester' : 'First Semester';
                      return (
                        <button
                          key={sem}
                          onClick={() => { setAcademic({ ...academic, current_semester: sem }); setUnsavedChanges(true); }}
                          className={`p-4 rounded-2xl border text-left transition-all ${
                            isActive
                              ? 'bg-indigo-600/20 border-indigo-500/60'
                              : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-sm font-bold ${isActive ? 'text-white' : 'text-slate-300'}`}>{sem}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                              isActive
                                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                : 'bg-slate-800 text-slate-400 border-slate-700'
                            }`}>
                              {isActive ? 'ACTIVE' : 'CLOSED'}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-1">
                            {isActive ? `${other} will become inactive.` : `Selecting this makes ${other} inactive.`}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Undergraduate Levels</label>
                  <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      {SUPPORTED_UNDERGRADUATE_LEVELS.map(level => (
                        <span key={level} className="text-xs font-bold px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {level}
                        </span>
                      ))}
                    </div>
                    <span className="text-[11px] text-slate-500">Only level currently supported</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2">
                    The platform is built for 100 Level undergraduate courses only. 200–500 Level have
                    no content behind them and are not offered.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* UTME SESSION */}
          {activeTab === 'utme' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-display font-bold text-white">UTME Session Control</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Open or close the active UTME session for candidates.
                </p>
              </div>

              <div className={`p-5 rounded-2xl border flex items-center justify-between ${
                cbt.utme_cbt_enabled ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/40'
              }`}>
                <div>
                  <div className="text-white text-sm font-bold flex items-center gap-2">
                    UTME Session
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      cbt.utme_cbt_enabled
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                      {cbt.utme_cbt_enabled ? 'OPEN' : 'CLOSED'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 max-w-md">
                    {cbt.utme_cbt_enabled
                      ? 'Candidates can start UTME practice sittings.'
                      : 'New UTME practice sittings are blocked, on the student dashboard and on the server. Existing candidates keep their accounts, and every past attempt and score is preserved.'}
                  </div>
                </div>
                <Toggle
                  on={cbt.utme_cbt_enabled}
                  onChange={() => { setCbt({ ...cbt, utme_cbt_enabled: !cbt.utme_cbt_enabled }); setUnsavedChanges(true); }}
                />
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs text-slate-400 flex items-start gap-2">
                <ShieldCheck size={16} className="text-slate-500 shrink-0 mt-0.5" />
                Closing the session is reversible and non-destructive. It changes access only — no
                user, attempt, score or historical record is removed, and reopening restores the
                session exactly as it was.
              </div>
            </div>
          )}

          {/* POST-UTME SESSION */}
          {activeTab === 'postutme' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-display font-bold text-white">Post-UTME Session Control</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Open or close the active Post-UTME screening session.
                </p>
              </div>

              <div className={`p-5 rounded-2xl border flex items-center justify-between ${
                cbt.post_utme_cbt_enabled ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/40'
              }`}>
                <div>
                  <div className="text-white text-sm font-bold flex items-center gap-2">
                    Post-UTME Session
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      cbt.post_utme_cbt_enabled
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                      {cbt.post_utme_cbt_enabled ? 'OPEN' : 'CLOSED'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 max-w-md">
                    {cbt.post_utme_cbt_enabled
                      ? 'Students can start Post-UTME screening drills.'
                      : 'New Post-UTME sittings are blocked, both in the drill page and on the server, so a retained paper link cannot start one either. All papers, attempts and scores are preserved.'}
                  </div>
                </div>
                <Toggle
                  on={cbt.post_utme_cbt_enabled}
                  onChange={() => { setCbt({ ...cbt, post_utme_cbt_enabled: !cbt.post_utme_cbt_enabled }); setUnsavedChanges(true); }}
                />
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl text-xs text-slate-400 flex items-start gap-2">
                <ShieldCheck size={16} className="text-slate-500 shrink-0 mt-0.5" />
                Opening and closing the session never touches historical data. Papers stay published
                and every previous attempt remains readable, so reopening restores the full history.
              </div>
            </div>
          )}

          {/* UNDERGRADUATE */}
          {activeTab === 'undergraduate' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-display font-bold text-white">Undergraduate</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Undergraduate CBT availability and the level and semester students are served.
                </p>
              </div>

              <div className={`p-5 rounded-2xl border flex items-center justify-between ${
                cbt.undergraduate_cbt_enabled ? 'bg-emerald-500/5 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/40'
              }`}>
                <div>
                  <div className="text-white text-sm font-bold flex items-center gap-2">
                    Undergraduate CBT
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      cbt.undergraduate_cbt_enabled
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                      {cbt.undergraduate_cbt_enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 max-w-md">
                    {cbt.undergraduate_cbt_enabled
                      ? 'Students can start course and topic drilling sessions.'
                      : 'Course and topic drilling is blocked on the student dashboard and on the server. Existing attempts and scores are preserved.'}
                  </div>
                </div>
                <Toggle
                  on={cbt.undergraduate_cbt_enabled}
                  onChange={() => { setCbt({ ...cbt, undergraduate_cbt_enabled: !cbt.undergraduate_cbt_enabled }); setUnsavedChanges(true); }}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Level Served</div>
                  <div className="text-white text-sm font-bold">{SUPPORTED_UNDERGRADUATE_LEVELS.join(', ')}</div>
                  <div className="text-[11px] text-slate-500 mt-1">Change this under Academic Sessions.</div>
                </div>
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Active Semester</div>
                  <div className="text-white text-sm font-bold">{academic.current_semester}</div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Only this semester's courses and CBT papers are offered to students.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CBT CONFIGURATION */}
          {activeTab === 'cbt' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-display font-bold text-white">CBT Configuration</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Shared defaults for every CBT environment. These apply to UTME, Post-UTME and
                  Undergraduate CBT, and are used wherever a student has not chosen their own
                  question count or duration.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Default Exam Duration (Minutes)</label>
                  <input
                    type="number"
                    value={cbt.default_exam_duration_mins}
                    onChange={(e) => { setCbt({ ...cbt, default_exam_duration_mins: parseInt(e.target.value) || 30 }); setUnsavedChanges(true); }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Default Question Count</label>
                  <input
                    type="number"
                    value={cbt.default_question_count}
                    onChange={(e) => { setCbt({ ...cbt, default_question_count: parseInt(e.target.value) || 40 }); setUnsavedChanges(true); }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="pt-2">
                <div className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">Session Availability</div>
                <div className="space-y-2">
                  {([
                    { label: 'UTME', on: cbt.utme_cbt_enabled, tab: 'utme' as TabId },
                    { label: 'Post-UTME', on: cbt.post_utme_cbt_enabled, tab: 'postutme' as TabId },
                    { label: 'Undergraduate', on: cbt.undergraduate_cbt_enabled, tab: 'undergraduate' as TabId },
                  ]).map(row => (
                    <div key={row.label} className="p-3.5 bg-slate-900 border border-slate-800 rounded-2xl flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-200">{row.label} CBT</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                          row.on
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                        }`}>
                          {row.on ? 'AVAILABLE' : 'CLOSED'}
                        </span>
                        <button
                          onClick={() => setActiveTab(row.tab)}
                          className="text-xs font-bold text-indigo-400 hover:text-indigo-300 transition-colors"
                        >
                          Manage
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 mt-2">
                  Each session is switched on its own section, so there is one authoritative value
                  per environment.
                </p>
              </div>
            </div>
          )}

          {/* PREMIUM SETTINGS */}
          {activeTab === 'premium' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-display font-bold text-white">Premium Settings</h3>
                <p className="text-xs text-slate-400 mt-0.5">Manage subscription system access and payment integration gates.</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl">
                  <div>
                    <div className="text-white text-sm font-bold">Premium System Enabled</div>
                    <div className="text-xs text-slate-400">Enable premium subscription gating across the platform.</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={premium.premium_system_enabled}
                    onChange={(e) => { setPremium({ ...premium, premium_system_enabled: e.target.checked }); setUnsavedChanges(true); }}
                    className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Premium Access Configuration</label>
                  <input
                    type="text"
                    value={premium.premium_access_config}
                    onChange={(e) => { setPremium({ ...premium, premium_access_config: e.target.value }); setUnsavedChanges(true); }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Subscription / Payment Gateway</label>
                  <input
                    type="text"
                    value={premium.subscription_config}
                    onChange={(e) => { setPremium({ ...premium, subscription_config: e.target.value }); setUnsavedChanges(true); }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* PARTNERSHIP SETTINGS */}
          {activeTab === 'partnership' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-display font-bold text-white">Partnership Settings</h3>
                <p className="text-xs text-slate-400 mt-0.5">Manage referral attribution and partner commission percentages.</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl">
                  <div>
                    <div className="text-white text-sm font-bold">Referral System Enabled</div>
                    <div className="text-xs text-slate-400">Allow partners to register and students to use referral codes.</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={partnership.referral_system_enabled}
                    onChange={(e) => { setPartnership({ ...partnership, referral_system_enabled: e.target.checked }); setUnsavedChanges(true); }}
                    className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Partner Commission Percentage (%)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={partnership.commission_percentage}
                    onChange={(e) => { setPartnership({ ...partnership, commission_percentage: parseFloat(e.target.value) || 20 }); setUnsavedChanges(true); }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">Default verified business rule is 20%. Changes apply to future verified premium conversions.</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Default Referral Configuration</label>
                  <input
                    type="text"
                    value={partnership.default_referral_config}
                    onChange={(e) => { setPartnership({ ...partnership, default_referral_config: e.target.value }); setUnsavedChanges(true); }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* NOTIFICATION SETTINGS */}
          {activeTab === 'notification' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-display font-bold text-white">Notification Settings</h3>
                <p className="text-xs text-slate-400 mt-0.5">Configure platform alerts, push notifications, and broadcast behavior.</p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl">
                  <div>
                    <div className="text-white text-sm font-bold">Notifications Enabled</div>
                    <div className="text-xs text-slate-400">Enable system-wide notifications and alerts.</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={notification.notifications_enabled}
                    onChange={(e) => { setNotification({ ...notification, notifications_enabled: e.target.checked }); setUnsavedChanges(true); }}
                    className="w-5 h-5 accent-indigo-600 rounded cursor-pointer"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">System Notification Configuration</label>
                  <input
                    type="text"
                    value={notification.system_notification_config}
                    onChange={(e) => { setNotification({ ...notification, system_notification_config: e.target.value }); setUnsavedChanges(true); }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">Notification Behavior</label>
                  <input
                    type="text"
                    value={notification.notification_behavior}
                    onChange={(e) => { setNotification({ ...notification, notification_behavior: e.target.value }); setUnsavedChanges(true); }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* PLATFORM FEATURES TOGGLES */}
          {activeTab === 'features' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-display font-bold text-white">Platform Feature Toggles</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Platform areas that are not covered by a dedicated section. CBT, premium,
                  partnership and notification switches live in their own sections, so each setting
                  has a single authoritative value.
                </p>
              </div>

              <div className="space-y-3">
                {[
                  { key: 'undergraduate_materials_enabled', title: 'Undergraduate Academic Materials', desc: 'Allow students to browse and view course materials.' },
                  { key: 'undergraduate_ai_rag_enabled', title: 'Undergraduate Material AI / RAG', desc: 'Enable AI tutor answers indexed from undergraduate materials.' },
                  { key: 'student_dashboard_enabled', title: 'Student Dashboard', desc: 'Enable student dashboard access.' },
                  { key: 'lecturer_dashboard_enabled', title: 'Lecturer Dashboard', desc: 'Enable lecturer dashboard access.' },
                ].map(item => {
                  const isEnabled = (features as any)[item.key];
                  return (
                    <div key={item.key} className="flex items-center justify-between p-4 bg-slate-900 border border-slate-800 rounded-2xl">
                      <div>
                        <div className="text-white text-sm font-bold flex items-center gap-2">
                          {item.title}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isEnabled ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                            {isEnabled ? 'Enabled' : 'Disabled'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">{item.desc}</div>
                      </div>
                      <Toggle
                        on={isEnabled}
                        onChange={() => {
                          setFeatures({ ...features, [item.key]: !isEnabled });
                          setUnsavedChanges(true);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Action Bar */}
          {activeTab !== 'health' && (
            <div className="pt-6 border-t border-slate-800 flex items-center justify-between">
              <div>
                {unsavedChanges && (
                  <span className="text-xs text-amber-400 font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span> Unsaved changes
                  </span>
                )}
              </div>
              <button
                onClick={() => handleSave(activeTab)}
                disabled={saving}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-2 shadow-lg shadow-indigo-600/30 disabled:opacity-50"
              >
                <Save size={16} /> {saving ? 'Saving...' : `Save ${TAB_LABELS[activeTab]} Settings`}
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
