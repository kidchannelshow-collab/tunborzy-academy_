import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { notificationService } from '../lib/notificationService';
import { useProfile } from '../lib/useProfile';
import { motion, AnimatePresence } from 'motion/react';
import {
  Bell, Check, Trash2, Edit2, Pin, Calendar, Copy, Eye,
  Search, Filter, Image as ImageIcon, FileText, MessageSquare,
  BarChart2, Users, Clock, Star, ArrowLeft, Bookmark, CheckCircle, X, Plus,
  Info, Book, Activity, Settings, AlertTriangle, Send, Share2, 
} from 'lucide-react';

interface Announcement {
  id: string;
  title: string;
  category: string;
  description: string;
  priority: 'Low' | 'Medium' | 'High' | 'Urgent';
  target: string;
  date: string;
  status: 'Published' | 'Scheduled' | 'Archived';
  isPinned: boolean;
  views: number;
  readRate: number;
  unread: boolean;
  bookmarked: boolean;
  hasAttachment?: 'image' | 'pdf' | 'chat';
}

const CATEGORIES = [
  { name: 'General Announcement', icon: Info, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  { name: 'Academic Notice', icon: Book, color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  { name: 'Examination Notice', icon: FileText, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  { name: 'New Chat Message', icon: MessageSquare, color: 'text-indigo-400', bg: 'bg-indigo-500/10', border: 'border-indigo-500/20' },
  { name: 'New Notes Available', icon: FileText, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  { name: 'New CBT Available', icon: Activity, color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/20' },
  { name: 'Premium Update', icon: Star, color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  { name: 'Maintenance Notice', icon: Settings, color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
  { name: 'Event Announcement', icon: Calendar, color: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/20' },
  { name: 'Emergency Notice', icon: AlertTriangle, color: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
];

const TARGETS = [
  'Everyone', 'Students Only', 'Lecturers Only', 'Admin Only', 'UTME Students', 
  'Post-UTME Students', 'Undergraduate Students', 'First Semester', 'Second Semester',
  'Specific Course', 'Selected Users'
];

export default function AnnouncementCenter({ onBack, onNavigate }: { onBack?: () => void, onNavigate?: (view: string) => void }) {
  const { profile } = useProfile();
  const role = profile?.role?.toLowerCase() || 'student';
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  
  useEffect(() => {
    if (!profile) return;
    let isMounted = true;
    const fetchAll = async () => {
      try {
        const [annRes, notifRes] = await Promise.all([
          supabase.from('announcements').select('*').order('created_at', { ascending: false }),
          supabase.from('notifications').select('*').eq('user_id', profile.id).order('created_at', { ascending: false })
        ]);
        if (annRes.error) throw annRes.error;
        if (notifRes.error) throw notifRes.error;
        if (isMounted && annRes.data) {
          const normalizedRole = String(profile.role || '').toLowerCase();
          const visible = normalizedRole === 'admin'
            ? annRes.data
            : normalizedRole === 'lecturer'
              ? annRes.data.filter((a: any) => a.lecturer_id === profile.id || a.created_by === profile.id)
              : annRes.data.filter((a: any) => {
                  const targetRole = String(a.target_role || '').toLowerCase();
                  return !targetRole || targetRole === 'all' || targetRole === normalizedRole || (targetRole === 'student' && normalizedRole === 'student');
                });
          setAnnouncements(visible);
        }
        if (isMounted && notifRes.data) setNotifications(notifRes.data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchAll();
    
    const channel = supabase.channel(`notifications_${profile.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${profile.id}`
      }, () => {
        supabase.from('notifications').select('*').eq('user_id', profile.id).order('created_at', { ascending: false })
          .then(res => { if (isMounted && res.data) setNotifications(res.data); });
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'announcements'
      }, () => {
        refreshAnnouncements().catch(err => console.error('Announcement realtime refresh failed:', err));
      })
      .subscribe();
      
    return () => {
      isMounted = false;
      supabase.removeChannel(channel);
    };
  }, [profile?.id, profile?.role]);

  const [activeTab, setActiveTab] = useState<'all' | 'unread' | 'read' | 'bookmarked' | 'pinned'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<{msg: string, type: 'success' | 'error'} | null>(null);
  const showToast = (msg: string, type: 'success' | 'error') => { setToast({msg, type}); setTimeout(() => setToast(null), 3000); };
  
  // Create form state
  const [formTitle, setFormTitle] = useState('');
  const [formCategory, setFormCategory] = useState(CATEGORIES[0].name);
  const [formDesc, setFormDesc] = useState('');
  const [formPriority, setFormPriority] = useState('Medium');
  const [formTarget, setFormTarget] = useState('Everyone');
  const [formSchedule, setFormSchedule] = useState('Immediate');
  const [editingAnnouncement, setEditingAnnouncement] = useState<any | null>(null);
  const [showFilterPanel, setShowFilterPanel] = useState(false);
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterPriority, setFilterPriority] = useState('All');

  const getCategoryStyle = (catName: string) => {
    return CATEGORIES.find(c => c.name === catName) || CATEGORIES[0];
  };

  const resetAnnouncementForm = () => {
    setFormTitle('');
    setFormCategory(CATEGORIES[0].name);
    setFormDesc('');
    setFormPriority('Medium');
    setFormTarget('Everyone');
    setFormSchedule('Immediate');
    setEditingAnnouncement(null);
  };

  const refreshAnnouncements = async () => {
    const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    if (data) setAnnouncements(data);
  };

  const targetToRole = (target: string) => {
    if (target === 'Students Only' || target === 'UTME Students' || target === 'Post-UTME Students' || target === 'Undergraduate Students') return 'Student';
    if (target === 'Lecturers Only') return 'Lecturer';
    if (target === 'Admin Only') return 'Admin';
    return 'All';
  };

  const roleToTarget = (roleValue: string) => {
    const value = String(roleValue || '').toLowerCase();
    if (value === 'student') return 'Students Only';
    if (value === 'lecturer') return 'Lecturers Only';
    if (value === 'admin') return 'Admin Only';
    return 'Everyone';
  };

  const openCreateAnnouncement = () => {
    resetAnnouncementForm();
    setShowCreateModal(true);
  };

  const openEditAnnouncement = (ann: any) => {
    setEditingAnnouncement(ann);
    setFormTitle(ann.title || '');
    setFormCategory(ann.category || CATEGORIES[0].name);
    setFormDesc(ann.description || ann.content || '');
    setFormPriority(ann.priority || 'Medium');
    setFormTarget(roleToTarget(ann.target_role || ann.target_audience));
    setFormSchedule(ann.status === 'Scheduled' ? 'Schedule' : 'Immediate');
    setShowCreateModal(true);
  };

  const handleSaveAnnouncement = async () => {
    if (!profile || !formTitle.trim() || !formDesc.trim()) {
      showToast('Title and announcement content are required', 'error');
      return;
    }
    try {
      const targetRole = targetToRole(formTarget);
      if (editingAnnouncement) {
        const { error } = await supabase.from('announcements').update({
          title: formTitle.trim(),
          content: formDesc.trim(),
          description: formDesc.trim(),
          category: formCategory,
          priority: formPriority,
          target_role: targetRole,
          status: formSchedule === 'Schedule' ? 'Scheduled' : 'Published'
        }).eq('id', editingAnnouncement.id);
        if (error) throw error;
        await refreshAnnouncements();
        showToast('Announcement updated successfully', 'success');
      } else {
        const { error } = await supabase.from('announcements').insert({
          title: formTitle.trim(),
          content: formDesc.trim(),
          description: formDesc.trim(),
          category: formCategory,
          priority: formPriority,
          target_role: targetRole,
          created_by: profile.id,
          status: formSchedule === 'Schedule' ? 'Scheduled' : 'Published'
        });
        if (error) throw error;
        if (formSchedule !== 'Schedule') {
          if (targetRole === 'All') {
            await notificationService.notifyRole('Student', formTitle, formDesc, 'announcement', '/announcements');
            await notificationService.notifyRole('Lecturer', formTitle, formDesc, 'announcement', '/announcements');
          } else {
            await notificationService.notifyRole(targetRole, formTitle, formDesc, 'announcement', '/announcements');
          }
        }
        await refreshAnnouncements();
        showToast('Announcement published successfully', 'success');
      }
      resetAnnouncementForm();
      setShowCreateModal(false);
    } catch (error: any) {
      console.error('Announcement save failed:', error);
      showToast(error?.message || 'Unable to save announcement', 'error');
    }
  };

  const handleDuplicateAnnouncement = async (ann: any) => {
    if (!profile) return;
    try {
      const { error } = await supabase.from('announcements').insert({
        title: `${ann.title || 'Announcement'} (Copy)`,
        content: ann.content || ann.description || '',
        description: ann.description || ann.content || '',
        category: ann.category || 'General Announcement',
        priority: ann.priority || 'Medium',
        target_role: ann.target_role || 'All',
        target_audience: ann.target_audience || 'All',
        target_value: ann.target_value || null,
        created_by: profile.id,
        status: 'Published'
      });
      if (error) throw error;
      await refreshAnnouncements();
      showToast('Announcement copied successfully', 'success');
    } catch (error: any) {
      console.error('Announcement duplicate failed:', error);
      showToast(error?.message || 'Unable to copy announcement', 'error');
    }
  };

  const handleTogglePinAnnouncement = async (ann: any) => {
    try {
      const { error } = await supabase.from('announcements').update({ is_pinned: !Boolean(ann.is_pinned) }).eq('id', ann.id);
      if (error) throw error;
      setAnnouncements(prev => prev.map(item => item.id === ann.id ? { ...item, is_pinned: !Boolean(ann.is_pinned) } : item));
      showToast(ann.is_pinned ? 'Announcement unpinned' : 'Announcement pinned', 'success');
    } catch (error: any) {
      console.error('Announcement pin failed:', error);
      showToast(error?.message || 'Unable to change pin status', 'error');
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    if (!profile) {
      showToast('User profile not loaded yet. Please wait.', 'error');
      return;
    }
    console.log('Deleting announcement ID:', id, 'by user:', profile.id, profile.role);
    if (!window.confirm('Delete this announcement? This cannot be undone.')) return;
    try {
      const { data, error } = await supabase.from('announcements').delete().eq('id', id).select();
      console.log('Supabase delete response:', { data, error });
      if (error) throw error;
      if (!data || data.length === 0) {
        console.warn('Delete affected 0 rows. RLS policy may have blocked the deletion.');
        throw new Error('Deletion blocked by RLS policy (insufficient permissions) or record not found.');
      }
      setAnnouncements(prev => prev.filter(ann => ann.id !== id));
      showToast('Announcement deleted successfully', 'success');
    } catch (error: any) {
      console.error('Announcement delete failed:', error);
      showToast(error?.message || 'Unable to delete announcement', 'error');
    }
  };

  const AdminDashboard = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Announcements', val: String(announcements.length), icon: Bell, color: 'text-indigo-400' },
          { label: 'Total Views', val: '—', icon: Eye, color: 'text-blue-400' },
          { label: 'Avg Read Rate', val: '—', icon: BarChart2, color: 'text-emerald-400' },
          { label: 'Scheduled', val: String(announcements.filter(a => a.status === 'Scheduled').length), icon: Clock, color: 'text-amber-400' }
        ].map((stat, i) => (
          <div key={i} className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-2xl p-5 flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm font-medium mb-1">{stat.label}</p>
              <h3 className="text-2xl font-bold text-white">{stat.val}</h3>
            </div>
            <div className={`p-3 rounded-xl bg-slate-800/50 ${stat.color}`}>
              <stat.icon size={24} />
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-2xl p-4">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input 
            type="text" 
            placeholder="Search announcements..." 
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-[#020617] border border-slate-800 text-white text-sm rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            onClick={() => setShowFilterPanel(v => !v)}
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${showFilterPanel ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
          >
            <Filter size={16} /> Filter
          </button>
          <button
            onClick={openCreateAnnouncement}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-indigo-500 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-400 transition-colors shadow-lg shadow-indigo-500/20"
          >
            <Plus size={18} /> Create New
          </button>
        </div>
      </div>

      {showFilterPanel && (
        <div className="bg-[#0f172a]/80 border border-slate-800 rounded-2xl p-4 flex flex-wrap gap-4 items-center">
          <label className="text-sm text-slate-400 flex items-center gap-2">Status
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="bg-[#020617] border border-slate-700 text-white rounded-lg px-3 py-2">
              <option>All</option><option>Published</option><option>Scheduled</option><option>Archived</option>
            </select>
          </label>
          <label className="text-sm text-slate-400 flex items-center gap-2">Priority
            <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)} className="bg-[#020617] border border-slate-700 text-white rounded-lg px-3 py-2">
              <option>All</option><option>Low</option><option>Medium</option><option>High</option><option>Urgent</option>
            </select>
          </label>
          <button onClick={() => { setFilterStatus('All'); setFilterPriority('All'); }} className="text-sm text-slate-400 hover:text-white">Reset</button>
        </div>
      )}

      <div className="space-y-4">
        {announcements
          .filter(ann => filterStatus === 'All' || ann.status === filterStatus)
          .filter(ann => filterPriority === 'All' || ann.priority === filterPriority)
          .filter(ann => !searchQuery || String(ann.title || '').toLowerCase().includes(searchQuery.toLowerCase()) || String(ann.description || ann.content || '').toLowerCase().includes(searchQuery.toLowerCase()))
          .map(ann => {
          const style = getCategoryStyle(ann.category || 'General Notice');
          const Icon = style.icon;
          return (
            <motion.div 
              key={ann.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-[#0f172a]/80 backdrop-blur-md border ${ann.is_pinned ? 'border-indigo-500/50' : 'border-slate-800'} rounded-2xl p-5 hover:border-indigo-500/30 transition-colors`}
            >
              <div className="flex flex-col lg:flex-row gap-5">
                <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {ann.is_pinned && <span className="flex items-center gap-1 text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded-md"><Pin size={12} /> Pinned</span>}
                    <span className={`flex items-center gap-1 text-xs font-bold ${style.color} ${style.bg} px-2 py-1 rounded-md`}>
                      <Icon size={12} /> {ann.category || 'General Notice'}
                    </span>
                    <span className={`text-xs font-bold px-2 py-1 rounded-md ${
                      ann.priority === 'Urgent' ? 'bg-rose-500/10 text-rose-400' :
                      ann.priority === 'High' ? 'bg-orange-500/10 text-orange-400' :
                      ann.priority === 'Medium' ? 'bg-blue-500/10 text-blue-400' :
                      'bg-slate-800 text-slate-300'
                    }`}>
                      {ann.priority} Priority
                    </span>
                    <span className={`text-xs font-bold px-2 py-1 rounded-md ${
                      ann.status === 'Published' ? 'bg-emerald-500/10 text-emerald-400' :
                      ann.status === 'Scheduled' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-slate-800 text-slate-400'
                    }`}>
                      {ann.status}
                    </span>
                  </div>
                  
                  <h3 className="text-lg font-bold text-white leading-tight break-words [overflow-wrap:anywhere]">{ann.title}</h3>
                  <p className="text-sm text-slate-400 line-clamp-2 break-words [overflow-wrap:anywhere]">{ann.description || ann.content || ''}</p>
                  
                  <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
                    <span className="flex items-center gap-1"><Users size={14} /> To: {ann.target || ann.target_audience || ann.target_role || 'Everyone'}</span>
                    <span className="flex items-center gap-1"><Calendar size={14} /> {new Date(ann.created_at).toLocaleDateString()}</span>
                    {ann.hasAttachment && <span className="flex items-center gap-1 text-indigo-400"><FileText size={14} /> Attachment</span>}
                  </div>
                </div>
                
                <div className="flex lg:flex-col items-center justify-between lg:justify-center gap-4 lg:w-48 lg:border-l border-slate-800 lg:pl-5">
                  <div className="flex gap-4">
                    <div className="text-center">
                      <p className="text-xl font-bold text-white">{ann.views ?? '—'}</p>
                      <p className="text-xs text-slate-500">Views</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xl font-bold text-emerald-400">{ann.readRate != null ? `${ann.readRate}%` : '—'}</p>
                      <p className="text-xs text-slate-500">Read</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => openEditAnnouncement(ann)} className="p-2 text-slate-400 hover:text-indigo-400 bg-slate-800/50 hover:bg-slate-800 rounded-lg transition-colors" title="Edit">
                      <Edit2 size={16} />
                    </button>
                    <button onClick={() => handleDuplicateAnnouncement(ann)} className="p-2 text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-800 rounded-lg transition-colors" title="Duplicate">
                      <Copy size={16} />
                    </button>
                    <button onClick={() => handleTogglePinAnnouncement(ann)} className={`p-2 bg-slate-800/50 hover:bg-slate-800 rounded-lg transition-colors ${ann.is_pinned ? 'text-amber-400' : 'text-slate-400 hover:text-amber-400'}`} title={ann.is_pinned ? 'Unpin' : 'Pin'}>
                      <Pin size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteAnnouncement(ann.id)}
                      className="p-2 text-slate-400 hover:text-rose-400 bg-slate-800/50 hover:bg-slate-800 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );

  const [selectedNotification, setSelectedNotification] = useState<any | null>(null);

  const filteredNotifications = notifications.filter(n => {
    if (activeTab === 'unread') return !n.is_read;
    if (activeTab === 'read') return n.is_read;
    return true;
  }).filter(n => {
    if (!searchQuery) return true;
    return n.title?.toLowerCase().includes(searchQuery.toLowerCase()) || n.message?.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const handleOpenNotification = async (notif: any) => {
    setSelectedNotification(notif);
    if (!notif.is_read) {
      try {
        await supabase.from('notifications').update({ is_read: true }).eq('id', notif.id);
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, is_read: true } : n));
      } catch (err) {
        console.error(err);
      }
    }
  };

  const UserView = () => (
    <div className="flex flex-col lg:flex-row gap-8 items-start">
      {/* The tab rail is sticky on DESKTOP ONLY.
          `sticky top-24` previously applied at every width. On a phone the rail
          is a full-width block (the layout is a column below `lg`), so it became
          a bar pinned 6rem from the top with no background of its own — the
          search box and the notification cards scrolled underneath it and the
          two sets of text were drawn on top of each other.
          Below `lg` it is now an ordinary block that scrolls with the page. The
          opaque background and z-index apply only while it is actually sticky,
          where they stop content showing through as it passes behind. */}
      <div className="w-full lg:w-64 flex-shrink-0 space-y-2 lg:sticky lg:top-24 lg:z-20 lg:bg-[#020617] lg:pb-4">
        {[
          { id: 'all', label: 'All Messages', icon: Bell, count: notifications.length },
          { id: 'unread', label: 'Unread', icon: CheckCircle, count: notifications.filter(n => !n.is_read).length },
          { id: 'read', label: 'Read', icon: Eye, count: notifications.filter(n => n.is_read).length },
        ].map(tab => (
          <button 
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
              activeTab === tab.id ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'text-slate-400 hover:bg-slate-800/50 hover:text-white border border-transparent'
            }`}
          >
            <div className="flex items-center gap-3">
              <tab.icon size={18} /> {tab.label}
            </div>
            {tab.count > 0 && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${tab.id === 'unread' ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-300'}`}>{tab.count}</span>}
          </button>
        ))}
        
        <div className="mt-8 pt-6 border-t border-slate-800/50 space-y-2">
          <button onClick={async () => {
             if (!profile) return;
             await supabase.from('notifications').update({ is_read: true }).eq('user_id', profile.id).eq('is_read', false);
             setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
             showToast('All notifications marked as read', 'success');
          }} className="w-full text-left px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-slate-800/50 rounded-xl flex items-center gap-2 transition-colors">
            <Check size={16} /> Mark all as read
          </button>
          <button onClick={async () => {
             if (!profile) return;
             await supabase.from('notifications').delete().eq('user_id', profile.id).eq('is_read', true);
             setNotifications(prev => prev.filter(n => !n.is_read));
             showToast('Cleared read messages', 'success');
          }} className="w-full text-left px-4 py-2.5 text-sm text-slate-400 hover:text-rose-400 hover:bg-slate-800/50 rounded-xl flex items-center gap-2 transition-colors">
            <Trash2 size={16} /> Clear all read
          </button>
        </div>
      </div>

      <div className="flex-1 w-full space-y-3">
        <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-2xl p-4 mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input 
              type="text" 
              placeholder="Search notifications and messages..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[#020617] border border-slate-800 text-white text-sm rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>

        {filteredNotifications.length === 0 ? (
          <div className="text-center py-16 bg-[#0f172a]/60 border border-slate-800 rounded-2xl p-8">
            <Bell className="mx-auto text-slate-600 mb-4" size={48} />
            <h3 className="text-lg font-bold text-white mb-1">No notifications yet.</h3>
            <p className="text-sm text-slate-400">Important updates and messages will appear here.</p>
          </div>
        ) : (
          filteredNotifications.map(notif => {
            const isUnread = !notif.is_read;
            return (
              <motion.div 
                key={notif.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => handleOpenNotification(notif)}
                className={`bg-[#0f172a]/80 backdrop-blur-md border ${isUnread ? 'border-indigo-500/40 bg-indigo-500/[0.02]' : 'border-slate-800'} rounded-2xl p-5 relative overflow-hidden group cursor-pointer hover:border-indigo-500/50 transition-all`}
              >
                {isUnread && <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500"></div>}
                
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className={`p-2.5 rounded-xl flex-shrink-0 ${isUnread ? 'bg-indigo-500/20 text-indigo-400' : 'bg-slate-800 text-slate-400'}`}>
                      <Bell size={20} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold uppercase tracking-wider text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded">
                          {notif.type || 'System'}
                        </span>
                        <span className="text-xs text-slate-500">
                          {new Date(notif.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <h3 className={`text-base font-bold truncate ${isUnread ? 'text-white' : 'text-slate-300'}`}>
                        {notif.title}
                      </h3>
                      <p className="text-sm text-slate-400 mt-1 line-clamp-2 break-words [overflow-wrap:anywhere]">
                        {notif.message}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isUnread ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-500"></span>
                    ) : (
                      <CheckCircle size={16} className="text-slate-600" />
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Notification Detail Modal */}
      <AnimatePresence>
        {selectedNotification && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#020617]/90 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0f172a] border border-slate-800 rounded-3xl w-full max-w-2xl my-8 overflow-hidden shadow-2xl"
            >
              <div className="flex items-center justify-between p-6 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl">
                    <Bell size={20} />
                  </div>
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                      {selectedNotification.type || 'System Notice'}
                    </span>
                    <p className="text-xs text-slate-500">
                      {new Date(selectedNotification.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <button onClick={() => setSelectedNotification(null)} className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors">
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                <h2 className="text-xl font-bold text-white break-words [overflow-wrap:anywhere]">{selectedNotification.title}</h2>
                {/* The full message: whitespace-pre-wrap keeps the author's line
                    breaks, break-words/anywhere stops a long unbroken string from
                    escaping the box. Nothing is clipped — the modal body scrolls. */}
                <div className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere] bg-[#020617] border border-slate-800/80 rounded-2xl p-5">
                  {selectedNotification.message}
                </div>
                {selectedNotification.link && (
                  <div className="pt-2">
                    <button 
                      onClick={() => {
                        if (onNavigate && selectedNotification.link) {
                          const route = selectedNotification.link.replace('/', '');
                          onNavigate(route);
                          setSelectedNotification(null);
                        }
                      }}
                      className="px-5 py-2.5 bg-indigo-500 hover:bg-indigo-400 text-white rounded-xl text-sm font-bold transition-colors shadow-lg shadow-indigo-500/20"
                    >
                      View Related Page
                    </button>
                  </div>
                )}
              </div>

              <div className="p-6 border-t border-slate-800 bg-[#0f172a] flex justify-end">
                <button 
                  onClick={() => setSelectedNotification(null)}
                  className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-bold transition-colors"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <div className="min-h-[100dvh] bg-[#020617] text-white p-4 sm:p-8">

      {/* Toast Notification */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className={`fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-xl ${
              toast.type === 'success' 
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' 
                : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
            <span className="font-medium text-sm">{toast.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={20} /> Back
          </button>
          
        </div>

        <div className="mb-8">
          <h1 className="text-3xl font-display font-bold text-white mb-2 flex items-center gap-3">
            <Bell className="text-indigo-400" size={32} /> Announcement & Notification Center
          </h1>
          <p className="text-slate-400 text-sm font-body">
            {role === 'admin' ? 'Create, manage, and track platform-wide announcements.' : 'Stay updated with the latest information and notices.'}
          </p>
        </div>

        {role === 'admin' ? <AdminDashboard /> : <UserView />}
        
        {/* Create Modal */}
        <AnimatePresence>
          {showCreateModal && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#020617]/90 backdrop-blur-sm overflow-y-auto"
            >
              <motion.div 
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                className="bg-[#0f172a] border border-slate-800 rounded-3xl w-full max-w-3xl my-8 overflow-hidden shadow-2xl"
              >
                <div className="flex items-center justify-between p-6 border-b border-slate-800">
                  <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <Edit2 className="text-indigo-400" size={20} /> {editingAnnouncement ? 'Edit Announcement' : 'Create Announcement'}
                  </h2>
                  <button onClick={() => { resetAnnouncementForm(); setShowCreateModal(false); }} className="text-slate-400 hover:text-white p-2 rounded-lg hover:bg-slate-800 transition-colors">
                    <X size={20} />
                  </button>
                </div>
                
                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-300">Announcement Title</label>
                    <input 
                      type="text"
                      value={formTitle}
                      onChange={e => setFormTitle(e.target.value)}
                      placeholder="e.g. Scheduled Maintenance Notice"
                      className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl py-3 px-4 focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-300">Category</label>
                      <select value={formCategory} onChange={e => setFormCategory(e.target.value)} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl py-3 px-4 focus:outline-none focus:border-indigo-500 transition-colors appearance-none">
                        {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-semibold text-slate-300">Target Audience</label>
                      <select value={formTarget} onChange={e => setFormTarget(e.target.value)} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl py-3 px-4 focus:outline-none focus:border-indigo-500 transition-colors appearance-none">
                        {TARGETS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-300">Description</label>
                    <textarea
                      rows={5}
                      value={formDesc}
                      onChange={e => setFormDesc(e.target.value)}
                      placeholder="Write your announcement here..."
                      className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl py-3 px-4 focus:outline-none focus:border-indigo-500 transition-colors resize-none"
                    ></textarea>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-slate-300 mb-2 block">Priority Level</label>
                    <div className="flex flex-wrap gap-3">
                      {['Low', 'Medium', 'High', 'Urgent'].map(p => (
                        <button 
                          key={p}
                          onClick={() => setFormPriority(p)}
                          className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors border ${
                            formPriority === p 
                              ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400' 
                              : 'bg-[#020617] border-slate-700 text-slate-400 hover:border-slate-500'
                          }`}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-4">
                    <label className="text-sm font-semibold text-slate-300 block">Attachments (Optional)</label>
                    <div className="flex flex-wrap gap-4">
                      <button className="flex items-center gap-2 px-4 py-3 bg-[#020617] border border-slate-700 border-dashed hover:border-indigo-500 hover:text-indigo-400 rounded-xl text-sm font-medium text-slate-400 transition-colors">
                        <ImageIcon size={18} /> Upload Image
                      </button>
                      <button className="flex items-center gap-2 px-4 py-3 bg-[#020617] border border-slate-700 border-dashed hover:border-indigo-500 hover:text-indigo-400 rounded-xl text-sm font-medium text-slate-400 transition-colors">
                        <FileText size={18} /> Upload PDF
                      </button>
                      <button className="flex items-center gap-2 px-4 py-3 bg-[#020617] border border-slate-700 border-dashed hover:border-indigo-500 hover:text-indigo-400 rounded-xl text-sm font-medium text-slate-400 transition-colors">
                        <MessageSquare size={18} /> Upload Audio
                      </button>
                    </div>
                  </div>
                  
                  <div className="border-t border-slate-800 pt-6 space-y-4">
                    <label className="text-sm font-semibold text-slate-300 block">Scheduling</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <label className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${formSchedule === 'Immediate' ? 'bg-indigo-500/10 border-indigo-500 text-white' : 'bg-[#020617] border-slate-700 text-slate-400'}`}>
                        <input type="radio" name="schedule" checked={formSchedule === 'Immediate'} onChange={() => setFormSchedule('Immediate')} className="hidden" />
                        <Send size={18} className={formSchedule === 'Immediate' ? 'text-indigo-400' : ''} />
                        <span className="font-medium text-sm">Publish Now</span>
                      </label>
                      <label className={`flex items-center gap-3 p-4 rounded-xl border cursor-pointer transition-colors ${formSchedule === 'Schedule' ? 'bg-indigo-500/10 border-indigo-500 text-white' : 'bg-[#020617] border-slate-700 text-slate-400'}`}>
                        <input type="radio" name="schedule" checked={formSchedule === 'Schedule'} onChange={() => setFormSchedule('Schedule')} className="hidden" />
                        <Calendar size={18} className={formSchedule === 'Schedule' ? 'text-indigo-400' : ''} />
                        <span className="font-medium text-sm">Schedule Later</span>
                      </label>
                    </div>
                    {formSchedule === 'Schedule' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                        <div className="space-y-2">
                          <label className="text-xs text-slate-400">Publish Date & Time</label>
                          <input type="datetime-local" className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-indigo-500" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-slate-400">Expiry Date (Optional)</label>
                          <input type="datetime-local" className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl py-2 px-3 text-sm focus:outline-none focus:border-indigo-500" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="p-6 border-t border-slate-800 bg-[#0f172a] flex justify-between items-center">
                  <button className="text-slate-400 hover:text-white text-sm font-medium flex items-center gap-2">
                    <Eye size={16} /> Preview
                  </button>
                  <div className="flex gap-3">
                    <button onClick={() => { resetAnnouncementForm(); setShowCreateModal(false); }} className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-300 hover:bg-slate-800 transition-colors">
                      Cancel
                    </button>
                    <button onClick={handleSaveAnnouncement} className="px-6 py-2.5 rounded-xl text-sm font-bold bg-indigo-500 text-white hover:bg-indigo-400 transition-colors shadow-lg shadow-indigo-500/20 flex items-center gap-2">
  <Send size={16} /> {formSchedule === 'Immediate' ? 'Publish' : 'Schedule'}
</button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
