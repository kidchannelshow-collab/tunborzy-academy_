import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layers, Copy, ArrowUp, ArrowDown, BookOpen, Plus, Edit2, Trash2, ChevronRight, X, Folder, FileText, Search, Archive, Image as ImageIcon, UploadCloud, CheckCircle } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useProfile } from '../../lib/useProfile';
import LessonEditor from '../materials/LessonEditor';
import BulkLessonModal from '../admin/BulkLessonModal';
import ConfirmationModal from '../admin/ConfirmationModal';
import { LECTURER_PORTALS, isLecturerPortal } from '../../lib/lecturerCourses';
import MaterialUploadModal from '../materials/MaterialUploadModal';

export default function CourseManagement() {
  const { profile } = useProfile();
  
  // Navigation State
  const [path, setPath] = useState<{
    course?: any;
    topic?: string;
  }>({});

  // DB State
  const [courses, setCourses] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Course-scoped material upload, re-homed here when the separate "Material
   * Center" view was removed from lecturer access. It uses the SAME
   * `MaterialUploadModal` the Admin hierarchy uses, so there is still exactly one
   * uploader implementation, and the course list it offers is this lecturer's own
   * assignments — an unassigned course cannot be targeted.
   */
  const [uploadCourseId, setUploadCourseId] = useState('');
  const [uploadTopic, setUploadTopic] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const uploadCourse = courses.find((c: any) => c.id === uploadCourseId) || null;

  // Virtual Custom State (for empty topics not yet in DB)
  const [customTopics, setCustomTopics] = useState<{course_code: string, name: string}[]>([]);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showBulkLessonModal, setShowBulkLessonModal] = useState(false);
  const [actionTitle, setActionTitle] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [isIrreversible, setIsIrreversible] = useState(false);
  const [actionCallback, setActionCallback] = useState<(() => Promise<void>) | null>(null);

  // Edit/Add Topic
  const [showTopicModal, setShowTopicModal] = useState(false);
  const [topicName, setTopicName] = useState('');
  const [editingTopic, setEditingTopic] = useState<string | null>(null);

  // Course Form Modal (Legacy Lecturer feature)
  const [showCourseModal, setShowCourseModal] = useState(false);
  const [isEditingCourse, setIsEditingCourse] = useState(false);
  const [editingCourseId, setEditingCourseId] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  
  const thumbnailInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [courseForm, setCourseForm] = useState({
    // `as string`: without the widening the object literal infers `portal` as the
    // single literal type 'UTME' (LECTURER_PORTALS[0]), so the select's onChange
    // — which yields a plain string — no longer type-checks.
    title: '', course_code: '', description: '', portal: LECTURER_PORTALS[0] as string, department: '', faculty: '', level: '', semester: 'First Semester', thumbnail_url: '', cover_image_url: ''
  });

  // Lesson Editor State
  const [showLessonEditor, setShowLessonEditor] = useState(false);
  const [editingLesson, setEditingLesson] = useState<any>(null);

  useEffect(() => {
    if (profile) fetchData();
    if (supabase) {
      const channel1 = supabase.channel('public:courses-lecturer').on('postgres_changes', { event: '*', schema: 'public', table: 'courses' }, fetchData).subscribe();
      const channel2 = supabase.channel('public:materials-lecturer').on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, fetchData).subscribe();
      return () => {
        supabase.removeChannel(channel1);
        supabase.removeChannel(channel2);
      };
    }
  }, [profile]);

  const fetchData = async () => {
    if (!supabase || !profile) return;
    setIsLoading(true);
    try {
      const [coursesRes] = await Promise.all([
        supabase.from('courses').select('*').eq('lecturer_id', profile.id).order('order_index', { ascending: true }).order('created_at', { ascending: false })
      ]);
      if (coursesRes.data) {
        setCourses(coursesRes.data);
        const courseCodes = coursesRes.data.map((c: any) => c.course_code);
        if (courseCodes.length > 0) {
          const { data: materialsData } = await supabase.from('materials').select('id, title, topic, course_code, is_published, file_type, lecturer_id, order_index').in('course_code', courseCodes).order('order_index', { ascending: true }).order('created_at', { ascending: true });
          if (materialsData) setMaterials(materialsData);
        } else {
          setMaterials([]);
        }
      }
    } catch (e) {
      console.error(e);
    }
    setIsLoading(false);
  };

  const handleDangerousAction = (title: string, message: string, irreversible: boolean, callback: () => Promise<void>) => {
    setActionTitle(title);
    setActionMessage(message);
    setIsIrreversible(irreversible);
    setActionCallback(() => callback);
    setIsModalOpen(true);
  };


  const handleDuplicateTopic = async (topicName: string, courseCode: string) => {
    if (!supabase) return;
    setIsLoading(true);
    try {
      const { data: mats } = await supabase.from('materials').select('*').eq('course_code', courseCode).eq('topic', topicName);
      if (mats && mats.length > 0) {
        const newTopicName = `${topicName} (Copy)`;
        const newMats = mats.map((m: any) => {
          const { id: mid, created_at: mc, updated_at: mu, ...restMat } = m;
          
          let newDesc = restMat.description;
          try {
            const parsed = JSON.parse(newDesc || '{}');
            if (parsed.publishSettings) {
              parsed.publishSettings.status = 'Draft';
              parsed.publishSettings.auditLogs = [];
            }
            newDesc = JSON.stringify(parsed);
          } catch(e) {}

          return {
            ...restMat,
            topic: newTopicName,
            is_published: false,
            description: newDesc
          };
        });
        await supabase.from('materials').insert(newMats);
      } else {
        setCustomTopics([...customTopics, { course_code: courseCode, name: `${topicName} (Copy)` }]);
      }
      fetchData();
    } catch (e) {
      console.error(e);
      alert('Error duplicating topic');
    }
    setIsLoading(false);
  };

  const handleReorder = async (table: string, currentItems: any[], index: number, direction: 'up' | 'down') => {
    if (!supabase) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentItems.length) return;

    setIsLoading(true);
    try {
      const itemsToUpdate = [...currentItems].map((item, i) => ({ ...item, order_index: item.order_index || i }));
      
      const tempOrder = itemsToUpdate[index].order_index;
      itemsToUpdate[index].order_index = itemsToUpdate[targetIndex].order_index;
      itemsToUpdate[targetIndex].order_index = tempOrder;

      const item1 = itemsToUpdate[index];
      const item2 = itemsToUpdate[targetIndex];

      if (table === 'materials') {
        await Promise.all([
          supabase.from(table).update({ order_index: item1.order_index }).eq('id', item1.id),
          supabase.from(table).update({ order_index: item2.order_index }).eq('id', item2.id)
        ]);
      } else if (table === 'topics') {
        await Promise.all([
          supabase.from('materials').update({ order_index: item1.order_index }).eq('course_code', path.course!.course_code).eq('topic', item1.name),
          supabase.from('materials').update({ order_index: item2.order_index }).eq('course_code', path.course!.course_code).eq('topic', item2.name)
        ]);
      }
      fetchData();
    } catch (e) {
      console.error(e);
      alert('Error reordering');
    }
    setIsLoading(false);
  };

  const executeAction = async () => {
    if (actionCallback) await actionCallback();
    setIsModalOpen(false);
  };

  // Derived Data
  const topics = useMemo(() => {
    if (!path.course) return [];
    const dbTopics = Array.from(new Set(materials.filter(m => m.course_code === path.course!.course_code).map(m => m.topic).filter(Boolean)));
    const custom = customTopics.filter(t => t.course_code === path.course!.course_code).map(t => t.name);
    return Array.from(new Set([...dbTopics, ...custom]));
  }, [materials, customTopics, path.course]);

  const lessons = useMemo(() => {
    if (!path.course || !path.topic) return [];
    return materials.filter(m => m.course_code === path.course!.course_code && m.topic === path.topic && m.file_type === 'lesson');
  }, [materials, path.course, path.topic]);

  // Filtering
  const getFilteredList = (list: any[]) => {
    if (!searchQuery) return list;
    return list.filter(item => {
      if (typeof item === 'string') return item.toLowerCase().includes(searchQuery.toLowerCase());
      if (item.title) return item.title.toLowerCase().includes(searchQuery.toLowerCase()) || item.course_code?.toLowerCase().includes(searchQuery.toLowerCase());
      return false;
    });
  };

  // Actions
  const handleDuplicateLesson = async (lesson: any) => {
    if (!supabase) return;
    try {
      const { data: fullLesson } = await supabase.from('materials').select('*').eq('id', lesson.id).single();
      if (!fullLesson) return;
      
      let newDescription = fullLesson.description;
      try {
        const parsed = JSON.parse(newDescription);
        if (parsed.publishSettings) {
          parsed.publishSettings.status = 'Draft';
          parsed.publishSettings.auditLogs = [];
          newDescription = JSON.stringify(parsed);
        }
      } catch(e) {}

      const { id, created_at, updated_at, ...rest } = fullLesson;
      const copy = {
        ...rest,
        title: `${rest.title} (Copy)`,
        is_published: false,
        lecturer_id: profile?.id,
        lecturer_name: profile?.full_name || 'Tutor'
      };
      
      await supabase.from('materials').insert([copy]);
      fetchData();
    } catch (err) {
      console.error(err);
      alert('Failed to duplicate lesson.');
    }
  };

  const handleSaveTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    try {
      if (editingTopic) {
        await supabase.from('materials').update({ topic: topicName }).eq('topic', editingTopic).eq('course_code', path.course!.course_code);
        setCustomTopics(prev => prev.map(t => t.course_code === path.course!.course_code && t.name === editingTopic ? { ...t, name: topicName } : t));
      } else {
        setCustomTopics(prev => [...prev, { course_code: path.course!.course_code, name: topicName }]);
      }
      setShowTopicModal(false);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteTopic = async (topic: string) => {
    if (!supabase) return;
    try {
      await supabase.from('materials').delete().eq('topic', topic).eq('course_code', path.course!.course_code);
      setCustomTopics(prev => prev.filter(t => !(t.course_code === path.course!.course_code && t.name === topic)));
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteLesson = async (lesson: any) => {
    if (!supabase) return;
    try {
      await supabase.from('materials').delete().eq('id', lesson.id);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  // Course Image Upload
  const handleFileUpload = async (file: File, type: 'thumbnail' | 'cover') => {
    if (!supabase) return;
    setIsUploading(true);
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `course_images/${fileName}`;
      const { error: uploadError } = await supabase.storage.from('tonborzy-content').upload(filePath, file, { cacheControl: '3600', upsert: false });
      if (uploadError) {
        console.warn('Storage error, using dummy url', uploadError);
        const url = type === 'thumbnail' ? 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=800&q=80' : 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1600&q=80';
        if (type === 'thumbnail') setCourseForm(prev => ({...prev, thumbnail_url: url}));
        else setCourseForm(prev => ({...prev, cover_image_url: url}));
        return;
      }
      const { data } = supabase.storage.from('tonborzy-content').getPublicUrl(filePath);
      if (type === 'thumbnail') setCourseForm(prev => ({...prev, thumbnail_url: data.publicUrl}));
      else setCourseForm(prev => ({...prev, cover_image_url: data.publicUrl}));
    } catch (err) {
      console.error(err);
    } finally {
      setIsUploading(false);
    }
  };

  const handleSaveCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !profile) return;
    try {
      const courseData = { ...courseForm, lecturer_id: profile.id };
      if (isEditingCourse) {
        await supabase.from('courses').update(courseData).eq('id', editingCourseId);
      } else {
        await supabase.from('courses').insert(courseData);
      }
      setShowCourseModal(false);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  const deleteCourse = async (id: string) => {
    if (!supabase) return;
    try {
      await supabase.from('courses').delete().eq('id', id);
      fetchData();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
      <ConfirmationModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onConfirm={executeAction} title={actionTitle} message={actionMessage} isIrreversible={isIrreversible} />

      {showBulkLessonModal && (
        <BulkLessonModal
          courseCode={path.course!.course_code}
          topic={path.topic!}
          onClose={() => setShowBulkLessonModal(false)}
          onSuccess={() => { setShowBulkLessonModal(false); fetchData(); }}
        />
      )}
      <AnimatePresence>
        {showTopicModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 w-full max-w-md shadow-2xl">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-white capitalize">{editingTopic ? 'Edit Topic' : 'Add Topic'}</h3>
                <button onClick={() => setShowTopicModal(false)} className="text-slate-400 hover:text-white"><X size={20} /></button>
              </div>
              <form onSubmit={handleSaveTopic} className="space-y-4">
                <div>
                  <label className="block text-sm font-poppins text-slate-400 mb-1">Topic Name</label>
                  <input type="text" value={topicName} onChange={e => setTopicName(e.target.value)} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2" required />
                </div>
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => setShowTopicModal(false)} className="flex-1 py-3 px-4 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors">Cancel</button>
                  <button type="submit" className="flex-1 py-3 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-slate-950 font-bold transition-colors disabled:opacity-50">Save</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}

        {showCourseModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="bg-[#0f172a] border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
              <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-[#0f172a]/95 backdrop-blur shrink-0 rounded-t-2xl">
                <h2 className="text-xl font-display font-bold text-white">{isEditingCourse ? 'Edit Course' : 'Create New Course'}</h2>
                <button type="button" onClick={() => setShowCourseModal(false)} className="text-slate-400 hover:text-white transition-colors"><X size={24} /></button>
              </div>
              <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                <form id="course-form" onSubmit={handleSaveCourse}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-300">Course Title *</label>
                      <input type="text" required value={courseForm.title} onChange={e => setCourseForm({...courseForm, title: e.target.value})} className="w-full bg-[#020617] border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500" placeholder="e.g. Introduction to Physics" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-300">Course Code</label>
                      <input type="text" value={courseForm.course_code} onChange={e => setCourseForm({...courseForm, course_code: e.target.value})} className="w-full bg-[#020617] border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500" placeholder="e.g. PHY 101" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-bold text-slate-300">Portal *</label>
                      {/*
                        Only the portals a lecturer may hold. Undergraduate was
                        listed here, which let a lecturer create an Undergraduate
                        course and then see it in their own list — the one portal
                        the lecturer access model deliberately excludes.
                      */}
                      <select required value={courseForm.portal} onChange={e => setCourseForm({...courseForm, portal: e.target.value})} className="w-full bg-[#020617] border border-slate-800 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-amber-500">
                        {LECTURER_PORTALS.map((portal) => (
                          <option key={portal} value={portal}>{portal}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-sm font-bold text-slate-300">Description</label>
                      <textarea value={courseForm.description} onChange={e => setCourseForm({...courseForm, description: e.target.value})} className="w-full h-32 bg-[#020617] border border-slate-800 rounded-xl p-4 text-white focus:outline-none focus:border-amber-500 resize-none" placeholder="Provide a brief overview of what students will learn..."></textarea>
                    </div>
                  </div>
                </form>
              </div>
              <div className="p-6 border-t border-slate-800 flex justify-end gap-4 shrink-0 rounded-b-2xl bg-[#0f172a]">
                <button type="button" onClick={() => setShowCourseModal(false)} className="px-6 py-3 rounded-xl font-bold text-slate-300 hover:bg-slate-800 transition-colors">Cancel</button>
                <button form="course-form" type="submit" disabled={isUploading} className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-8 py-3 rounded-xl font-bold transition-colors disabled:opacity-50">
                  {isEditingCourse ? 'Save Changes' : 'Create Course'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-white mb-2 flex items-center gap-3">
            <BookOpen className="text-orange-400" size={28} /> Course Management
          </h1>
          <p className="text-sm font-body text-slate-400">Hierarchical course curriculum and materials management.</p>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          <select
            value={uploadCourseId}
            onChange={(e) => setUploadCourseId(e.target.value)}
            disabled={courses.length === 0}
            className="bg-[#020617] border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 disabled:opacity-50"
          >
            <option value="">{courses.length === 0 ? 'No courses assigned' : 'Select a course…'}</option>
            {courses.map((course: any) => (
              <option key={course.id} value={course.id}>
                {course.course_code} — {course.title} ({course.portal})
              </option>
            ))}
          </select>

          <input
            type="text"
            value={uploadTopic}
            onChange={(e) => setUploadTopic(e.target.value)}
            placeholder="Topic (optional)"
            className="bg-[#020617] border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500"
          />

          <button
            onClick={() => setShowUpload(true)}
            disabled={!uploadCourse}
            className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            Upload Material
          </button>
        </div>
      </div>

      {showUpload && uploadCourse && isLecturerPortal(uploadCourse.portal) && (
        <MaterialUploadModal
          programme={uploadCourse.portal}
          semester={uploadCourse.semester ?? null}
          courseCode={uploadCourse.course_code}
          courseTitle={uploadCourse.title}
          topic={uploadTopic.trim() || 'General'}
          onClose={() => setShowUpload(false)}
          onSaved={() => {
            setShowUpload(false);
            setUploadTopic('');
            fetchData();
          }}
        />
      )}

      <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-6 min-h-[500px] flex flex-col">
        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 mb-6 text-sm text-slate-400 overflow-x-auto pb-2 custom-scrollbar">
          <button onClick={() => { setPath({}); setSearchQuery(''); }} className={`whitespace-nowrap hover:text-white transition-colors ${!path.course ? 'text-indigo-400 font-bold' : ''}`}>My Courses</button>
          {path.course && (
            <>
              <ChevronRight size={14} className="flex-shrink-0" />
              <button onClick={() => { setPath({ course: path.course }); setSearchQuery(''); }} className={`whitespace-nowrap hover:text-white transition-colors ${!path.topic ? 'text-indigo-400 font-bold' : ''}`}>{path.course.course_code}</button>
            </>
          )}
          {path.topic && (
            <>
              <ChevronRight size={14} className="flex-shrink-0" />
              <span className="whitespace-nowrap text-indigo-400 font-bold">{path.topic}</span>
            </>
          )}
        </div>

        {/* Action Bar */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-center mb-6">
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input 
              type="text" 
              placeholder="Search..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl pl-10 pr-4 py-2 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all text-sm"
            />
          </div>
          {!path.course ? null : !path.topic ? (
            <button 
              onClick={() => { setEditingTopic(null); setTopicName(''); setShowTopicModal(true); }}
              className="w-full sm:w-auto bg-orange-500 hover:bg-orange-400 text-slate-950 px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Add Topic
            </button>
          ) : (
            <button 
              onClick={() => { setEditingLesson(null); setShowLessonEditor(true); }}
              className="w-full sm:w-auto bg-indigo-500 hover:bg-indigo-400 text-white px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2"
            >
              <Plus size={16} /> Create Lesson
            </button>
          )}
        </div>

        {/* List Area */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="text-center text-slate-400 py-10">Loading hierarchy...</div>
          ) : (
            <div className="space-y-3">
              {/* COURSES */}
              {!path.course && (
                getFilteredList(courses).length === 0 ? (
                  <div className="text-center text-slate-500 py-10 bg-[#020617]/50 rounded-xl border border-slate-800 border-dashed">No courses found.</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {getFilteredList(courses).map((course, i) => (
                      <div key={i} className="flex flex-col justify-between p-4 rounded-xl bg-[#020617]/50 border border-slate-800/50 hover:border-indigo-500/30 transition-colors group">
                        <div className="mb-4 cursor-pointer" onClick={() => setPath({ course })}>
                          <h3 className="font-bold text-white mb-1 line-clamp-2">{course.title}</h3>
                          <p className="text-xs text-slate-400 font-mono bg-slate-800/50 inline-block px-2 py-0.5 rounded">{course.course_code}</p>
                        </div>
                        
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* TOPICS */}
              {path.course && !path.topic && (
                getFilteredList(topics).length === 0 ? (
                  <div className="text-center text-slate-500 py-10 bg-[#020617]/50 rounded-xl border border-slate-800 border-dashed">No topics found.</div>
                ) : getFilteredList(topics).map((item, i) => (
                  <div key={i} className="flex items-center justify-between p-4 rounded-xl bg-[#020617]/50 border border-slate-800/50 hover:border-indigo-500/30 transition-colors group">
                    <div className="flex items-center gap-3 cursor-pointer flex-1" onClick={() => setPath({ ...path, topic: item })}>
                      <FileText className="text-indigo-400" size={20} />
                      <span className="font-bold text-white">{item}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingTopic(item); setTopicName(item); setShowTopicModal(true); }} className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg"><Edit2 size={16} /></button>
                      <button onClick={() => handleDangerousAction('Delete Topic', `Are you sure you want to delete this topic and its lessons?`, true, () => handleDeleteTopic(item))} className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg"><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))
              )}

              {/* LESSONS */}
              {path.topic && (
                getFilteredList(lessons).length === 0 ? (
                  <div className="text-center flex flex-col items-center justify-center py-16 bg-[#020617]/50 rounded-xl border border-slate-800 border-dashed">
                    <FileText size={48} className="text-slate-700 mb-4" />
                    <p className="text-slate-400 font-medium mb-1">No lessons yet.</p>
                    <button onClick={() => { setEditingLesson(null); setShowLessonEditor(true); }} className="mt-4 bg-indigo-500 hover:bg-indigo-400 text-white px-4 py-2 rounded-xl text-sm font-bold">Create Lesson</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {getFilteredList(lessons).map((lesson, i) => (
                      <div key={i} className="flex flex-col justify-between p-4 rounded-xl bg-[#020617]/50 border border-slate-800/50 hover:border-indigo-500/30 transition-colors group">
                        <div className="mb-4 cursor-pointer" onClick={() => { setEditingLesson(lesson); setShowLessonEditor(true); }}>
                          <div className={`mb-3 inline-block text-xs font-medium px-2 py-0.5 rounded ${lesson.is_published ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                            {lesson.is_published ? 'Published' : 'Draft'}
                          </div>
                          <h3 className="font-bold text-white mb-1 line-clamp-2">{lesson.title || 'Untitled Lesson'}</h3>
                        </div>
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {i > 0 && <button onClick={(e) => { e.stopPropagation(); handleReorder('materials', getFilteredList(lessons), i, 'up'); }} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"><ArrowUp size={16} /></button>}
                            {i < getFilteredList(lessons).length - 1 && <button onClick={(e) => { e.stopPropagation(); handleReorder('materials', getFilteredList(lessons), i, 'down'); }} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg"><ArrowDown size={16} /></button>}
                            <button onClick={() => handleDangerousAction('Duplicate Lesson', `Are you sure you want to duplicate "${lesson.title}"?`, false, () => handleDuplicateLesson(lesson))} className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg" title="Duplicate"><Copy size={16} /></button>
                          {lesson.lecturer_id === profile?.id && (
                            <button onClick={() => { setEditingLesson(lesson); setShowLessonEditor(true); }} className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg"><Edit2 size={16} /></button>
                          )}
                          {lesson.lecturer_id === profile?.id && (
                            <button onClick={() => handleDangerousAction('Delete Lesson', `Are you sure you want to delete ${lesson.title}?`, true, () => handleDeleteLesson(lesson))} className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg"><Trash2 size={16} /></button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showLessonEditor && (
          <LessonEditor 
            courseCode={path.course!.course_code}
            topic={path.topic!}
            portal={path.course!.portal || 'Undergraduate'}
            semester={path.course!.semester || 'First Semester'}
            lesson={editingLesson}
            onClose={() => setShowLessonEditor(false)}
            onSaved={() => {
              setShowLessonEditor(false);
              fetchData();
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
