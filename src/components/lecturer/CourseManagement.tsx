import React, { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layers, Copy, ArrowUp, ArrowDown, BookOpen, Plus, Edit2, Trash2, ChevronRight, X, Folder, FileText, Search, Archive, Image as ImageIcon, UploadCloud, CheckCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useProfile } from '../../lib/useProfile';
import LessonEditor from '../materials/LessonEditor';
import BulkLessonModal from '../admin/BulkLessonModal';
import ConfirmationModal from '../admin/ConfirmationModal';
import { LECTURER_PORTALS, isLecturerPortal } from '../../lib/lecturerCourses';
import { nextCourseModuleOrderIndex, nextCourseOrderIndex } from '../../lib/materialOrder';
import MaterialUploadModal from '../materials/MaterialUploadModal';

/**
 * A topic as the curriculum UI needs it.
 *
 * Topics are `course_modules` rows (the same table and the same shape Admin's
 * Course Management uses — see that file's "course_modules = persistent topics"
 * note). They are NOT derived from `materials.topic` any more.
 *
 * `id` is null for a legacy topic that exists only as a text label on material
 * rows: those predate the lecturer surface being able to create real topics and
 * still have to be reachable, but they cannot be renamed, reordered or deleted
 * as a record because there is no record.
 */
interface TopicNode {
  id: string | null;
  title: string;
  order_index: number;
}

export default function CourseManagement() {
  const { profile } = useProfile();

  // Navigation State
  const [path, setPath] = useState<{
    course?: any;
    topic?: TopicNode;
  }>({});

  // DB State
  const [courses, setCourses] = useState<any[]>([]);
  const [modules, setModules] = useState<any[]>([]);
  const [materials, setMaterials] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
  const [editingTopic, setEditingTopic] = useState<TopicNode | null>(null);
  const [topicSaving, setTopicSaving] = useState(false);
  const [topicError, setTopicError] = useState('');

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
      // Topics are rows, so a topic created in another tab (or by an admin) has
      // to arrive here too — without this the lecturer's tree would only
      // refresh on a manual reload.
      const channel3 = supabase.channel('public:course_modules-lecturer').on('postgres_changes', { event: '*', schema: 'public', table: 'course_modules' }, fetchData).subscribe();
      return () => {
        supabase.removeChannel(channel1);
        supabase.removeChannel(channel2);
        supabase.removeChannel(channel3);
      };
    }
  }, [profile]);

  /**
   * Load the lecturer's courses, the topics under them, and their materials.
   *
   * Three things changed here and each one was a bug:
   *
   * 1. `course_modules` is now fetched at all. Topics used to be nothing but the
   *    distinct `materials.topic` strings, so a topic created before any lesson
   *    was put in it had no material row to be derived from — and the list
   *    rendered blank.
   *
   * 2. The materials `select()` now includes `description`. It did not, which
   *    meant every lesson handed to the editor arrived without its content:
   *    opening a lesson showed an empty editor, and the 15-second autosave then
   *    wrote that emptiness over the author's real work. This is the single most
   *    destructive line in the file.
   *
   * 3. A failed query is reported instead of being presented as "no courses".
   */
  const fetchData = async () => {
    if (!supabase || !profile) return;
    setIsLoading(true);
    try {
      const { data: courseRows, error: coursesError } = await supabase
        .from('courses')
        .select('*')
        .eq('lecturer_id', profile.id)
        .order('order_index', { ascending: true })
        .order('created_at', { ascending: false });
      if (coursesError) throw coursesError;

      setCourses(courseRows || []);
      setLoadError(null);

      const courseCodes = (courseRows || []).map((c: any) => c.course_code).filter(Boolean);
      if (courseCodes.length === 0) {
        setMaterials([]);
        setModules([]);
        setIsLoading(false);
        return;
      }

      const [modulesRes, materialsRes] = await Promise.all([
        supabase
          .from('course_modules')
          .select('id, course_id, title, order_index, created_at')
          .in('course_id', (courseRows || []).map((c: any) => c.id))
          .order('order_index', { ascending: true })
          .order('created_at', { ascending: true }),
        supabase
          .from('materials')
          .select('id, title, description, topic, course_code, is_published, file_type, lecturer_id, order_index')
          .in('course_code', courseCodes)
          .order('order_index', { ascending: true })
          .order('created_at', { ascending: true }),
      ]);

      const failure = [modulesRes, materialsRes].find((r: any) => r.error);
      if (failure) throw (failure as any).error;

      setModules(modulesRes.data || []);
      setMaterials(materialsRes.data || []);
    } catch (e: any) {
      console.error(e);
      setLoadError(e?.message || 'Could not load the course hierarchy.');
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
      const newTopicName = `${topicName} (Copy)`;

      // A topic is a row, so the copy gets a row too. Duplicating only the
      // materials — which is what this did — produced a "(Copy)" topic that
      // vanished on reload, because topics were being derived from materials and
      // a topic with no materials left to derive from disappeared.
      const course = courses.find((c: any) => c.course_code === courseCode);
      if (course) {
        const { error: moduleError } = await supabase.from('course_modules').insert([{
          course_id: course.id,
          title: newTopicName,
          order_index: await nextCourseModuleOrderIndex(course.id),
          is_published: false,
        }]);
        if (moduleError) throw moduleError;
      }

      if (mats && mats.length > 0) {
        const newMats = mats.map((m: any) => {
          // `order_index` is deliberately KEPT: the copies land in a topic of
          // their own, so carrying the originals' indices across is what
          // preserves the lesson order inside the duplicate.
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
        const { error } = await supabase.from('materials').insert(newMats);
        if (error) throw error;
      }
      await fetchData();
    } catch (e: any) {
      console.error(e);
      setLoadError(e?.message || 'Error duplicating topic');
    }
    setIsLoading(false);
  };

  const handleReorder = async (table: string, currentItems: any[], index: number, direction: 'up' | 'down') => {
    if (!supabase) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= currentItems.length) return;

    setIsLoading(true);
    try {
      const itemsToUpdate = [...currentItems].map((item, i) => ({ ...item, order_index: item.order_index ?? i }));

      const tempOrder = itemsToUpdate[index].order_index;
      itemsToUpdate[index].order_index = itemsToUpdate[targetIndex].order_index;
      itemsToUpdate[targetIndex].order_index = tempOrder;

      const item1 = itemsToUpdate[index];
      const item2 = itemsToUpdate[targetIndex];

      // A true swap, by row id. The previous version wrote to `materials`
      // matched on `.eq('topic', name)` for topics, which moved every material
      // in the topic and left the topic itself — a `course_modules` row — at its
      // old position, so the order never actually changed.
      //
      // Two UPDATEs rather than one `upsert`: an upsert is INSERT … ON CONFLICT,
      // and a payload carrying only `{id, order_index}` would fail the insert
      // half on `title NOT NULL` before it ever reached the conflict clause.
      if (item1.id && item2.id) {
        const [r1, r2] = await Promise.all([
          supabase.from(table).update({ order_index: item1.order_index }).eq('id', item1.id),
          supabase.from(table).update({ order_index: item2.order_index }).eq('id', item2.id),
        ]);
        const failure = r1.error || r2.error;
        if (failure) throw failure;
      }
      await fetchData();
    } catch (e: any) {
      console.error(e);
      setLoadError(e?.message || 'Error reordering');
    }
    setIsLoading(false);
  };

  const executeAction = async () => {
    if (actionCallback) await actionCallback();
    setIsModalOpen(false);
  };

  // Derived Data
  /**
   * Topics for the open course: real `course_modules` rows, unioned with any
   * topic text that exists only on material rows.
   *
   * The legacy half matters. Before topics were persisted, creating a topic wrote
   * nothing at all and the topic existed purely as a `materials.topic` string —
   * so lessons filed under it are still out there and their parent topic has to
   * keep resolving, or those lessons become unreachable.
   */
  const topics = useMemo<TopicNode[]>(() => {
    if (!path.course) return [];
    const fromModules = modules
      .filter((m: any) => m.course_id === path.course!.id)
      .map((m: any) => ({ id: m.id as string | null, title: m.title, order_index: m.order_index ?? 0 }));

    const known = new Set(fromModules.map((t) => (t.title || '').toLowerCase()));
    const legacy = Array.from(
      new Set(
        materials
          .filter((m: any) => m.course_code === path.course!.course_code && m.topic)
          .map((m: any) => m.topic as string),
      ),
    )
      .filter((t) => !known.has(String(t).toLowerCase()))
      .map((t) => ({ id: null, title: t, order_index: 0 }));

    return [...fromModules, ...legacy];
  }, [modules, materials, path.course]);

  const lessons = useMemo(() => {
    if (!path.course || !path.topic) return [];
    return materials.filter(m => m.course_code === path.course!.course_code && m.topic === path.topic!.title && m.file_type === 'lesson');
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

  /**
   * Create or rename a topic — as a `course_modules` ROW.
   *
   * This used to push onto a `customTopics` React array and write nothing. The
   * topic appeared instantly and was gone the moment the page reloaded, because
   * nothing had been persisted: "creating a topic" was a state change, not a
   * database write. Everything downstream that derives topics from the database
   * then found nothing, which is why the topic list came back blank.
   *
   * Both branches now await the write and surface a failure, so a topic that
   * cannot be saved says so instead of disappearing.
   */
  const handleSaveTopic = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !path.course) return;

    const title = topicName.trim();
    if (!title) {
      setTopicError('Enter a topic name.');
      return;
    }

    setTopicSaving(true);
    setTopicError('');
    try {
      if (editingTopic?.id) {
        const { error } = await supabase
          .from('course_modules')
          .update({ title })
          .eq('id', editingTopic.id);
        if (error) throw error;

        // Rename the label on the lessons already filed under the old name, or
        // they would keep pointing at a topic that no longer exists.
        if (editingTopic.title !== title) {
          const { error: moveError } = await supabase
            .from('materials')
            .update({ topic: title })
            .eq('course_code', path.course.course_code)
            .eq('topic', editingTopic.title);
          if (moveError) throw moveError;
        }
      } else if (editingTopic && !editingTopic.id) {
        // Legacy label-only topic: there is no row to rename. Creating the row
        // under the new name and re-filing its lessons is the honest upgrade.
        const { error } = await supabase.from('course_modules').insert([{
          course_id: path.course.id,
          title,
          order_index: await nextCourseModuleOrderIndex(path.course.id),
          is_published: false,
        }]);
        if (error) throw error;
        if (editingTopic.title !== title) {
          await supabase
            .from('materials')
            .update({ topic: title })
            .eq('course_code', path.course.course_code)
            .eq('topic', editingTopic.title);
        }
      } else {
        const { error } = await supabase.from('course_modules').insert([{
          course_id: path.course.id,
          title,
          // Computed, never `Date.now()`: `course_modules.order_index` is a
          // 32-bit `integer` and a millisecond timestamp overflows it.
          order_index: await nextCourseModuleOrderIndex(path.course.id),
          // Set explicitly, matching Admin's Course Management: the column
          // default is `true`, and combined with the "Anyone can view published
          // course modules" policy that would make a lecturer's brand-new topic
          // world-readable the instant it was created.
          is_published: false,
        }]);
        if (error) throw error;
      }

      setShowTopicModal(false);
      setEditingTopic(null);
      setTopicName('');
      await fetchData();
    } catch (err: any) {
      console.error(err);
      setTopicError(err?.message || 'Could not save this topic.');
    }
    setTopicSaving(false);
  };

  const handleDeleteTopic = async (topic: TopicNode) => {
    if (!supabase || !path.course) return;
    try {
      if (topic.id) {
        const { error } = await supabase.from('course_modules').delete().eq('id', topic.id);
        if (error) throw error;
      }
      // Also clear the lessons filed under it — they carry the topic as a text
      // label, so deleting only the row would leave them orphaned under a topic
      // that no longer appears anywhere.
      const { error: materialError } = await supabase
        .from('materials')
        .delete()
        .eq('topic', topic.title)
        .eq('course_code', path.course.course_code);
      if (materialError) throw materialError;

      setPath({ course: path.course });
      await fetchData();
    } catch (err: any) {
      console.error(err);
      setLoadError(err?.message || 'Could not delete this topic.');
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
      const courseData: Record<string, any> = { ...courseForm, lecturer_id: profile.id };
      if (isEditingCourse) {
        const { error } = await supabase.from('courses').update(courseData).eq('id', editingCourseId);
        if (error) throw error;
      } else {
        // Assigned on create, so a new course sorts after the ones already in
        // its programme instead of tying with them at the column default.
        courseData.order_index = await nextCourseOrderIndex(courseForm.portal, courseForm.semester);
        const { error } = await supabase.from('courses').insert(courseData);
        if (error) throw error;
      }
      setShowCourseModal(false);
      await fetchData();
    } catch (err: any) {
      console.error(err);
      setLoadError(err?.message || 'Could not save this course.');
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

      {showBulkLessonModal && path.course && path.topic && (
        <BulkLessonModal
          courseCode={path.course.course_code}
          topic={path.topic.title}
          /* `materials.portal` is NOT NULL, so a bulk insert that omits it fails
             outright. These were never passed, which is why "Bulk Create" could
             not have written anything. */
          portal={path.course.portal || 'Undergraduate'}
          semester={path.course.semester || ''}
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
                  <input type="text" value={topicName} onChange={e => setTopicName(e.target.value)} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2" required autoFocus />
                </div>
                {editingTopic && !editingTopic.id && (
                  <p className="text-xs text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    This topic exists only as a label on existing lessons. Saving creates a real topic record and
                    re-files those lessons under the new name.
                  </p>
                )}
                {topicError && (
                  <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{topicError}</p>
                )}
                <div className="pt-4 flex gap-3">
                  <button type="button" onClick={() => { setShowTopicModal(false); setTopicError(''); }} className="flex-1 py-3 px-4 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors">Cancel</button>
                  <button type="submit" disabled={topicSaving} className="flex-1 py-3 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-slate-950 font-bold transition-colors disabled:opacity-50">
                    {topicSaving ? 'Saving…' : 'Save'}
                  </button>
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
              <span className="whitespace-nowrap text-indigo-400 font-bold">{path.topic.title}</span>
            </>
          )}
        </div>

        {/* Every write failure lands here. Surfaced rather than swallowed: a
            topic or lesson that could not be saved used to look exactly like
            one that was, and simply not appear. */}
        {loadError && (
          <div className="mb-6 flex items-start gap-3 px-4 py-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1">{loadError}</span>
            <button onClick={() => setLoadError(null)} className="opacity-60 hover:opacity-100 transition-opacity" aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}

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
              onClick={() => { setEditingTopic(null); setTopicName(''); setTopicError(''); setShowTopicModal(true); }}
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
                  <div className="text-center text-slate-500 py-10 bg-[#020617]/50 rounded-xl border border-slate-800 border-dashed">
                    {loadError ? loadError : 'No topics found. Use “Add Topic” to create one.'}
                  </div>
                ) : getFilteredList(topics).map((item: TopicNode, i: number) => (
                  <div key={item.id ?? item.title} className="flex items-center justify-between p-4 rounded-xl bg-[#020617]/50 border border-slate-800/50 hover:border-indigo-500/30 transition-colors group">
                    <div className="flex items-center gap-3 cursor-pointer flex-1 min-w-0" onClick={() => setPath({ ...path, topic: item })}>
                      <FileText className="text-indigo-400 shrink-0" size={20} />
                      <span className="font-bold text-white truncate">{item.title}</span>
                      <span className="text-xs text-slate-500 shrink-0">
                        {materials.filter(m => m.course_code === path.course!.course_code && m.topic === item.title).length} item(s)
                      </span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      {i > 0 && (
                        <button title="Move up" onClick={() => handleReorder('course_modules', getFilteredList(topics), i, 'up')} disabled={!item.id} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg disabled:opacity-30"><ArrowUp size={16} /></button>
                      )}
                      {i < getFilteredList(topics).length - 1 && (
                        <button title="Move down" onClick={() => handleReorder('course_modules', getFilteredList(topics), i, 'down')} disabled={!item.id} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg disabled:opacity-30"><ArrowDown size={16} /></button>
                      )}
                      <button title="Duplicate topic" onClick={() => handleDangerousAction('Duplicate Topic', `Duplicate "${item.title}" and its lessons?`, false, () => handleDuplicateTopic(item.title, path.course!.course_code))} className="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 rounded-lg"><Copy size={16} /></button>
                      <button title="Edit topic" onClick={() => { setEditingTopic(item); setTopicName(item.title); setTopicError(''); setShowTopicModal(true); }} className="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-amber-500/10 rounded-lg"><Edit2 size={16} /></button>
                      <button title="Delete topic" onClick={() => handleDangerousAction('Delete Topic', `Are you sure you want to delete this topic and its lessons?`, true, () => handleDeleteTopic(item))} className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg"><Trash2 size={16} /></button>
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
        {showLessonEditor && path.course && path.topic && (
          <LessonEditor
            courseCode={path.course.course_code}
            topic={path.topic.title}
            portal={path.course.portal || 'Undergraduate'}
            /* `courses.semester` is only meaningful for Undergraduate; UTME and
               Post-UTME courses carry null. Substituting 'First Semester' for
               those — and for an Undergraduate course whose semester is
               genuinely unset — filed the lesson under a semester the course is
               not in, and the student library, which keeps only the open
               semester, then filtered it straight back out. A course with no
               semester now passes none through, which every reader treats as
               "always visible". */
            semester={
              path.course.semester
              || (path.course.portal === 'Undergraduate' ? 'First Semester' : '')
            }
            lesson={editingLesson}
            /* Deliberately NOT closing the editor on save. The editor holds the
               document it just wrote and stays open, so "Save Draft" confirms
               itself with a toast and the author keeps their place; the list
               behind it is refreshed for the next time they surface. Closing on
               save — what this used to do — also meant a save that failed after
               the editor was torn down had nowhere to report the failure. */
            onClose={() => { setShowLessonEditor(false); setEditingLesson(null); fetchData(); }}
            onSaved={() => { void fetchData(); }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
