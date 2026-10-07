import React, { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserCog, Plus, Search, Edit2, Trash2, BookOpen, Eye, X, Mail, Phone, Book, GraduationCap, Clock, FileText, ChevronLeft, ChevronRight, UserCheck, UserX } from 'lucide-react';
import ConfirmationModal from './ConfirmationModal';
import { supabase } from '../../supabaseClient';
import {
  loadAssignableCourses,
  assignCoursesToLecturer,
  loadAssignedCourseIds,
  ASSIGNABLE_PORTALS,
  type AssignableCourse,
} from '../../lib/lecturerCourses';

/**
 * Portal-grouped, multi-select course picker for lecturer assignment.
 *
 * Declared at MODULE scope on purpose. Defined inside the component it would be a
 * new component type on every render, so React would unmount and rebuild the
 * whole list each keystroke in the search box — the same defect that made the
 * lecturer sidebar lag.
 *
 * Replaces a free-text "MCH101, PHY101" box: the admin had to recall codes, a
 * typo produced a silent no-op, and none of it actually assigned a course.
 */
function CoursePicker({
  courses,
  programme,
  onProgrammeChange,
  selected,
  onToggle,
  emptyLabel,
}: {
  courses: AssignableCourse[];
  programme: string;
  onProgrammeChange: (programme: string) => void;
  selected: string[];
  onToggle: (id: string) => void;
  emptyLabel: string;
}) {
  // The programme dropdown narrows the list. `All` groups by programme so the
  // three sections stay readable; a specific programme renders its own courses
  // only. The dropdown's options are always all three, so a programme can never
  // become unreachable once its courses are all assigned.
  const visible = programme === 'All' ? courses : courses.filter((c) => c.portal === programme);
  const grouped = programme === 'All';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">
          Programme / Level
        </label>
        <select
          value={programme}
          onChange={(e) => onProgrammeChange(e.target.value)}
          className="flex-1 bg-[#020617] border border-slate-700 text-white rounded-xl px-3 py-2 text-sm focus:border-emerald-500 outline-none"
        >
          <option value="All">All programmes</option>
          {ASSIGNABLE_PORTALS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        {selected.length > 0 && (
          <span className="text-xs font-bold text-emerald-400 whitespace-nowrap">{selected.length} selected</span>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="p-3 text-xs text-slate-500 border border-slate-700 rounded-xl">
          {courses.length === 0 ? emptyLabel : `No ${programme} courses to show.`}
        </div>
      ) : (
        <div className="border border-slate-700 rounded-xl max-h-56 overflow-y-auto custom-scrollbar divide-y divide-slate-800">
          {(grouped ? ASSIGNABLE_PORTALS : ([programme] as readonly string[])).map((portal) => {
            const group = visible.filter((c) => c.portal === portal);
            if (group.length === 0) return null;
            return (
              <div key={portal}>
                {grouped && (
                  <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-[#020617] sticky top-0">
                    {portal}
                  </div>
                )}
                {group.map((course) => (
                  <label key={course.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-800/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selected.includes(course.id)}
                      onChange={() => onToggle(course.id)}
                      className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                    />
                    <span className="text-sm text-white truncate">
                      {course.course_code ? `${course.course_code} — ` : ''}{course.title}
                    </span>
                    {course.takenByAnotherLecturer && (
                      <span className="ml-auto text-[10px] font-bold text-amber-400 whitespace-nowrap">assigned</span>
                    )}
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function LecturerManagement() {
  const [filterOption, setFilterOption] = useState('All');
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({ title: '', message: '', isIrreversible: false, onConfirm: async () => {} });
  
  const [lecturers, setLecturers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notification, setNotification] = useState<{msg: string, type: 'success'|'error'} | null>(null);

  // Modals
  const [viewLecturer, setViewLecturer] = useState<any>(null);
  const [editLecturer, setEditLecturer] = useState<any>(null);
  const [assignMaterialLecturer, setAssignMaterialLecturer] = useState<any>(null);
  const [materialForm, setMaterialForm] = useState({ type: 'PDF', url: '', title: '' });
  const [showAddModal, setShowAddModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Add Form State
  const [addForm, setAddForm] = useState({
    full_name: '', email: '', password: '', department: '', faculty: '', phone_number: '', assigned_courses: '', assigned_subjects: ''
  });

  /**
   * The real assignment UI state.
   *
   * `availableCourses` is every course in the system, grouped by portal.
   * `selectedCourseIds` is the pending selection for whichever modal is open —
   * nothing is written until the admin saves. `originalCourseIds` is what
   * `courses.lecturer_id` currently says, so a DESELECTED course can be
   * released on save (otherwise removing an assignment would be impossible).
   */
  const [availableCourses, setAvailableCourses] = useState<AssignableCourse[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [originalCourseIds, setOriginalCourseIds] = useState<string[]>([]);

  /**
   * Display source for assigned courses: lecturer profile id -> course codes.
   *
   * Derived from `courses.lecturer_id`, which is where an assignment actually
   * lives. The page used to render `profiles.assigned_courses` here — a text
   * array the picker never writes — so a lecturer given three courses through
   * the picker still displayed "No courses assigned".
   *
   * This is a READ MODEL, not a second assignment system: nothing writes it, and
   * it is rebuilt from the database on every `fetchLecturers`.
   */
  const [lecturerCourseCodes, setLecturerCourseCodes] = useState<Record<string, string[]>>({});

  /** Course codes assigned to a lecturer, from `courses.lecturer_id`. */
  const courseCodesFor = (lecturerId: string): string[] => lecturerCourseCodes[lecturerId] || [];

  /**
   * Programme currently shown in the course picker.
   *
   * The picker used to list all three programmes at once in one long scroll.
   * Selecting a programme narrows it to that programme's courses, which is how an
   * admin actually works — they are assigning "the UTME courses", not picking
   * from a mixed bag. Defaults to `All` so nothing is hidden until asked for.
   *
   * This is a VIEW filter over `availableCourses` only. It does not restrict what
   * may be assigned: Undergraduate is still assignable here even though the
   * lecturer dashboard deliberately never offers it.
   */
  const [pickerProgramme, setPickerProgramme] = useState<string>('All');

  useEffect(() => {
    if (!supabase) return;
    loadAssignableCourses()
      .then(setAvailableCourses)
      .catch((err) => console.error('Failed to load courses for assignment:', err));
  }, []);

  const toggleSelectedCourse = (id: string) =>
    setSelectedCourseIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /**
   * Open the editor with the lecturer's CURRENT server-side assignments checked,
   * read from `courses.lecturer_id` — not from the legacy `assigned_courses`
   * text array, which never reflected a real assignment.
   */
  const openEditLecturer = async (lecturer: any) => {
    setEditLecturer(lecturer);
    setSelectedCourseIds([]);
    setOriginalCourseIds([]);
    try {
      const ids = await loadAssignedCourseIds(lecturer.id);
      setOriginalCourseIds(ids);
      setSelectedCourseIds(ids);
    } catch (err) {
      console.error('Failed to load assigned courses:', err);
    }
  };

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    fetchLecturers();

    const channel = supabase?.channel('public:profiles_lecturers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, (payload) => {
        fetchLecturers(); // Re-fetch to ensure we have the latest (could be optimized)
      })
      .subscribe();

    return () => {
      if (channel) supabase?.removeChannel(channel);
    };
  }, []);

  const fetchLecturers = async () => {
    if (!supabase) return;
    setIsLoading(true);

    // The lecturer rows and their assignments are fetched together, because the
    // assignment is a property of the COURSE (`courses.lecturer_id`), not of the
    // profile. `not('lecturer_id','is',null)` keeps unassigned courses out
    // entirely, so the map below only ever holds real assignments.
    const [lecturersRes, coursesRes] = await Promise.all([
      supabase.from('profiles')
        .select('*')
        .ilike('role', 'lecturer')
        .order('created_at', { ascending: false }),
      supabase.from('courses')
        .select('id, course_code, lecturer_id')
        .not('lecturer_id', 'is', null),
    ]);

    const { data, error } = lecturersRes;

    if (error) {
      console.log("Error fetching lecturers:", error);
      showNotification(error.message || String(error), 'error');
    } else if (data) {
      setLecturers(data);
    }

    // A failure here only costs the chips; it must not blank the roster, so it is
    // logged rather than raised into the notification the admin sees.
    if (coursesRes.error) {
      console.warn('Could not load course assignments for display:', coursesRes.error.message);
    } else {
      const byLecturer: Record<string, string[]> = {};
      for (const course of coursesRes.data || []) {
        const owner = (course as any).lecturer_id as string | null;
        const code = (course as any).course_code as string | null;
        if (!owner || !code) continue;
        if (!byLecturer[owner]) byLecturer[owner] = [];
        byLecturer[owner].push(code);
      }
      setLecturerCourseCodes(byLecturer);
    }

    setIsLoading(false);
  };

  const showNotification = (msg: string, type: 'success' | 'error') => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const confirmAction = (title: string, message: string, irreversible: boolean, action: () => Promise<void>) => {
    setConfirmConfig({
      title,
      message,
      isIrreversible: irreversible,
      onConfirm: async () => {
        try {
          await action();
        } catch (err: any) {
          console.log("Action error:", err);
          showNotification(err.message || String(err), 'error');
        }
      }
    });
    setIsConfirmModalOpen(true);
  };

  const handleToggleStatus = (lecturer: any, newStatus: string) => {
    const actionText = newStatus === 'Active' ? (lecturer.status === 'Suspended' ? 'Reactivate' : 'Enable') : (newStatus === 'Suspended' ? 'Suspend' : 'Disable');
    confirmAction(`${actionText} Lecturer`, `Are you sure you want to ${actionText.toLowerCase()} ${lecturer.full_name}?`, false, async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("admin-provision-user", {
        body: {
          action: "toggle-user-status",
          userId: lecturer.id,
          status: newStatus
        },
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        }
      });
      console.log(data);
      console.error(error);
      
      if (error) {
        let actualError = error.message || String(error);
        if (error.context && typeof error.context.json === 'function') {
           try {
             const errData = await error.context.json();
             actualError = errData.error || actualError;
           } catch(e) { /* ignore */ }
        }
        throw new Error(actualError);
      }
      
      if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
      
      showNotification(`Lecturer account ${newStatus.toLowerCase()} successfully`, 'success');
      
      // Clear selected state if it matches the affected user
      if (viewLecturer?.id === lecturer.id) setViewLecturer({ ...viewLecturer, status: newStatus });
      if (editLecturer?.id === lecturer.id) setEditLecturer({ ...editLecturer, status: newStatus });
      setConfirmConfig({ title: '', message: '', isIrreversible: false, onConfirm: async () => {} });
      
      // Do not call fetchLecturers() here to avoid race condition with real-time subscription
    });
  };

  const handleDeleteLecturer = (lecturer: any) => {
    confirmAction('Delete Lecturer', `Are you sure you want to permanently delete ${lecturer.full_name}?`, true, async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("admin-provision-user", {
        body: {
          action: "delete-user",
          userId: lecturer.id
        },
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
        }
      });
      console.log(data);
      console.error(error);
      
      if (error) {
        let actualError = error.message || String(error);
        if (error.context && typeof error.context.json === 'function') {
           try {
             const errData = await error.context.json();
             actualError = errData.error || actualError;
           } catch(e) { /* ignore */ }
        }
        throw new Error(actualError);
      }
      
      if (data?.error) throw new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
      
      showNotification(`Lecturer deleted successfully`, 'success');
      
      // Clear selected state if it matches the deleted user
      if (viewLecturer?.id === lecturer.id) setViewLecturer(null);
      if (editLecturer?.id === lecturer.id) setEditLecturer(null);
      setConfirmConfig({ title: '', message: '', isIrreversible: false, onConfirm: async () => {} });
      
      // Do not call fetchLecturers() here to avoid race condition with real-time subscription
    });
  };

  const handleAddLecturer = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      if (!supabase) throw new Error('Supabase client is not initialized');

      // Provisioned via the Edge Function, using the service role key server-side.
      // This does NOT touch the calling admin's browser session — the previous
      // client-side supabase.auth.signUp call here silently logged the admin out
      // and signed them in as the new lecturer instead.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Your session has expired. Please log in again.');

      const { data: fnData, error: fnError } = await supabase.functions.invoke('admin-provision-user', {
        body: {
          action: 'add-lecturer',
          full_name: addForm.full_name,
          email: addForm.email,
          password: addForm.password,
          department: addForm.department,
          faculty: addForm.faculty,
          phone_number: addForm.phone_number,
          assigned_courses: addForm.assigned_courses.split(',').map(s => s.trim()).filter(Boolean),
          assigned_subjects: addForm.assigned_subjects.split(',').map(s => s.trim()).filter(Boolean),
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (fnData?.error) {
        throw new Error(fnData.error);
      }
      if (fnError) {
        let actualError = fnError.message;
        if (fnError.context && typeof fnError.context.json === 'function') {
           try {
             const errData = await fnError.context.json();
             actualError = errData.error || actualError;
           } catch(e) { /* ignore */ }
        }
        throw new Error(actualError);
      }

      // Courses are assigned only now, because `courses.lecturer_id` needs the
      // id the provisioning function has just returned. The old code sent a
      // comma-separated list to the Edge Function, which stored it on the
      // profile as text and assigned nothing at all.
      const newLecturerId = fnData?.userId;
      if (newLecturerId && selectedCourseIds.length > 0) {
        await assignCoursesToLecturer(newLecturerId, selectedCourseIds, []);
      } else if (!newLecturerId && selectedCourseIds.length > 0) {
        console.warn('Lecturer created but no userId was returned; course selection was not applied.');
      }

      showNotification("Lecturer created successfully.", 'success');
      setShowAddModal(false);
      setAddForm({ full_name: '', email: '', password: '', department: '', faculty: '', phone_number: '', assigned_courses: '', assigned_subjects: '' });
      setSelectedCourseIds([]);
      // The catalogue's ownership flags changed for any course just assigned.
      loadAssignableCourses().then(setAvailableCourses).catch(() => {});
      fetchLecturers();
    } catch (err: any) {
      console.log("Error adding lecturer:", err);
      showNotification(err.message || String(err), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  
  const handleAssignMaterial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignMaterialLecturer) return;
    setIsSaving(true);
    try {
      if (!supabase) throw new Error('Supabase client is not initialized');
      // Append to assigned_materials
      const existing = assignMaterialLecturer.assigned_materials || [];
      const updated = [...existing, materialForm];
      
      const { error } = await supabase.from('profiles').update({
        assigned_materials: updated
      }).eq('id', assignMaterialLecturer.id);
      
      if (error) throw error;
      
      showNotification("Material assigned successfully", 'success');
      setAssignMaterialLecturer(null);
      setMaterialForm({ type: 'PDF', url: '', title: '' });
      fetchLecturers();
    } catch (err: any) {
      console.log("Error assigning material:", err);
      showNotification(err.message || String(err), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editLecturer) return;
    setIsSaving(true);
    
    try {
      if (!supabase) throw new Error('Supabase client is not initialized');
      const { id, full_name, department, faculty, phone_number, assigned_courses, assigned_subjects, status } = editLecturer;
      
      const coursesArray = typeof assigned_courses === 'string' ? assigned_courses.split(',').map((s:string) => s.trim()).filter(Boolean) : assigned_courses;
      const subjectsArray = typeof assigned_subjects === 'string' ? assigned_subjects.split(',').map((s:string) => s.trim()).filter(Boolean) : assigned_subjects;
      
      const { error } = await supabase.from('profiles').update({
        full_name, department, faculty, phone_number, assigned_courses: coursesArray, assigned_subjects: subjectsArray, status
      }).eq('id', id);

      if (error) throw error;

      // THE assignment. `courses.lecturer_id` is authoritative; the profile
      // update above only keeps the legacy display list in step. Passing the
      // original ids is what lets a DESELECTED course be released — without it
      // the lecturer would keep access forever, since only this call ever
      // clears the column.
      await assignCoursesToLecturer(id, selectedCourseIds, originalCourseIds);

      showNotification("Lecturer profile updated", 'success');
      setEditLecturer(null);
      setSelectedCourseIds([]);
      setOriginalCourseIds([]);
      loadAssignableCourses().then(setAvailableCourses).catch(() => {});
      fetchLecturers();
    } catch (err: any) {
      console.log("Error saving lecturer:", err);
      showNotification(err.message || String(err), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  // Filter & Search Logic
    const filteredLecturers = useMemo(() => {
    let result = lecturers;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(l => 
        (l.full_name || '').toLowerCase().includes(q) ||
        (l.email || '').toLowerCase().includes(q) ||
        (l.department || '').toLowerCase().includes(q) ||
        (l.faculty || '').toLowerCase().includes(q) ||
        (l.student_id || '').toLowerCase().includes(q) ||
        (l.role || '').toLowerCase().includes(q) ||
        // Searched against the real assignments, so "MTH101" finds the lecturer
        // who owns it. `l.assigned_courses` is the legacy text array the picker
        // never writes, and searching it silently returned nothing.
        courseCodesFor(l.id).some((c) => c.toLowerCase().includes(q))
      );
    }

    if (filterOption !== 'All') {
      if (filterOption === 'Active') {
        result = result.filter(l => l.status === 'Active' || !l.status);
      } else if (filterOption === 'Inactive') {
        result = result.filter(l => l.status === 'Inactive' || l.status === 'Suspended' || l.status === 'Disabled');
      } else if (filterOption === 'Recently Added') {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        result = result.filter(l => new Date(l.created_at) > thirtyDaysAgo);
      }
    }

    return result;
    // `lecturerCourseCodes` must be a dependency: the assignments arrive from a
    // separate query, so without it the course-code search would run against an
    // empty map on first render and never re-evaluate.
  }, [lecturers, searchQuery, filterOption, lecturerCourseCodes]);

  const totalPages = Math.ceil(filteredLecturers.length / itemsPerPage) || 1;
  const paginatedLecturers = filteredLecturers.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Dynamic filter options based on available departments and faculties
  const dynamicFilters = useMemo(() => {
    const filters = new Set(['All', 'Active', 'Disabled', 'Recently Added']);
    lecturers.forEach(l => {
      if (l.department) filters.add(l.department);
      if (l.faculty) filters.add(l.faculty);
    });
    return Array.from(filters);
  }, [lecturers]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 max-w-7xl mx-auto relative"
    >
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-4 right-4 z-[200] px-6 py-3 rounded-xl shadow-2xl border flex items-center gap-3 ${
              notification.type === 'success' 
                ? 'bg-emerald-900/90 border-emerald-500 text-emerald-100' 
                : 'bg-rose-900/90 border-rose-500 text-rose-100'
            }`}
          >
            {notification.msg}
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmationModal 
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={() => {
          confirmConfig.onConfirm();
          setIsConfirmModalOpen(false);
        }}
        title={confirmConfig.title}
        message={confirmConfig.message}
        isIrreversible={confirmConfig.isIrreversible}
      />

      {/* Add Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-[#020617]/80 backdrop-blur-sm overflow-y-auto py-10">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 md:p-8 w-full max-w-2xl my-auto shadow-2xl relative"
            >
              <button onClick={() => setShowAddModal(false)} className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors">
                <X size={24} />
              </button>
              <h2 className="text-2xl font-display font-bold text-white mb-6">Add New Lecturer</h2>
              
              <form onSubmit={handleAddLecturer} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Full Name</label>
                    <input type="text" value={addForm.full_name} onChange={(e) => setAddForm({...addForm, full_name: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-emerald-500 outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Email</label>
                    <input type="email" value={addForm.email} onChange={(e) => setAddForm({...addForm, email: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-emerald-500 outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Temporary Password</label>
                    <input type="password" value={addForm.password} onChange={(e) => setAddForm({...addForm, password: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-emerald-500 outline-none" required minLength={6} />
                  </div>
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Phone Number</label>
                    <input type="text" value={addForm.phone_number} onChange={(e) => setAddForm({...addForm, phone_number: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-emerald-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Department</label>
                    <input type="text" value={addForm.department} onChange={(e) => setAddForm({...addForm, department: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-emerald-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Faculty</label>
                    <input type="text" value={addForm.faculty} onChange={(e) => setAddForm({...addForm, faculty: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-emerald-500 outline-none" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-poppins text-slate-400 mb-1">
                      Assigned Courses
                    </label>
                    <CoursePicker
                      courses={availableCourses}
                      programme={pickerProgramme}
                      onProgrammeChange={setPickerProgramme}
                      selected={selectedCourseIds}
                      onToggle={toggleSelectedCourse}
                      emptyLabel="No courses found. Create courses under Course Management first."
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Courses are assigned after the account is created. A course already
                      assigned to another lecturer will be reassigned to this one.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Assigned Subjects (comma separated)</label>
                    <input type="text" value={addForm.assigned_subjects} onChange={(e) => setAddForm({...addForm, assigned_subjects: e.target.value})} placeholder="e.g. Mathematics (UTME), Physics (UTME)" className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-emerald-500 outline-none" />
                  </div>
                </div>
                <div className="flex gap-3 pt-4 border-t border-slate-800">
                  <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 py-3 px-4 rounded-xl border border-slate-700 text-slate-300 font-semibold hover:bg-slate-800 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={isSaving} className="flex-1 py-3 px-4 rounded-xl font-semibold bg-emerald-500 hover:bg-emerald-600 text-slate-900 transition-colors disabled:opacity-50">
                    {isSaving ? 'Creating...' : 'Create Lecturer'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {editLecturer && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-[#020617]/80 backdrop-blur-sm overflow-y-auto py-10">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 md:p-8 w-full max-w-2xl my-auto shadow-2xl relative"
            >
              <button onClick={() => setEditLecturer(null)} className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors">
                <X size={24} />
              </button>
              <h2 className="text-2xl font-display font-bold text-white mb-6">Edit Lecturer Profile</h2>
              
              <form onSubmit={handleSaveEdit} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Full Name</label>
                    <input type="text" value={editLecturer.full_name || ''} onChange={(e) => setEditLecturer({...editLecturer, full_name: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-emerald-500 outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Phone Number</label>
                    <input type="text" value={editLecturer.phone_number || ''} onChange={(e) => setEditLecturer({...editLecturer, phone_number: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-emerald-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Department</label>
                    <input type="text" value={editLecturer.department || ''} onChange={(e) => setEditLecturer({...editLecturer, department: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-emerald-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Faculty</label>
                    <input type="text" value={editLecturer.faculty || ''} onChange={(e) => setEditLecturer({...editLecturer, faculty: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-emerald-500 outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Account Status</label>
                    <select value={editLecturer.status || 'Active'} onChange={(e) => setEditLecturer({...editLecturer, status: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-emerald-500 outline-none">
                      <option value="Active">Active</option>
                      <option value="Disabled">Disabled</option>
                      <option value="Suspended">Suspended</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-poppins text-slate-400 mb-1">
                      Assigned Courses
                    </label>
                    <CoursePicker
                      courses={availableCourses}
                      programme={pickerProgramme}
                      onProgrammeChange={setPickerProgramme}
                      selected={selectedCourseIds}
                      onToggle={toggleSelectedCourse}
                      emptyLabel="No courses found. Create courses under Course Management first."
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Unchecking a course releases it — the lecturer loses access to it.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Assigned Subjects (comma separated)</label>
                    <input type="text" value={Array.isArray(editLecturer.assigned_subjects) ? editLecturer.assigned_subjects.join(', ') : editLecturer.assigned_subjects || ''} onChange={(e) => setEditLecturer({...editLecturer, assigned_subjects: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-emerald-500 outline-none" />
                  </div>
                </div>
                <div className="flex gap-3 pt-4 border-t border-slate-800">
                  <button type="button" onClick={() => setEditLecturer(null)} className="flex-1 py-3 px-4 rounded-xl border border-slate-700 text-slate-300 font-semibold hover:bg-slate-800 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={isSaving} className="flex-1 py-3 px-4 rounded-xl font-semibold bg-emerald-500 hover:bg-emerald-600 text-slate-900 transition-colors disabled:opacity-50">
                    {isSaving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      
      {/* Assign Material Modal */}
      <AnimatePresence>
        {assignMaterialLecturer && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-[#020617]/80 backdrop-blur-sm overflow-y-auto py-10">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 md:p-8 w-full max-w-xl my-auto shadow-2xl relative"
            >
              <button onClick={() => setAssignMaterialLecturer(null)} className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors">
                <X size={24} />
              </button>
              <h2 className="text-2xl font-display font-bold text-white mb-6">Assign Material to {assignMaterialLecturer.full_name}</h2>
              
              <form onSubmit={handleAssignMaterial} className="space-y-4">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Material Type</label>
                    <select value={materialForm.type} onChange={(e) => setMaterialForm({...materialForm, type: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-blue-500 outline-none">
                      <option value="PDF">PDF Document</option>
                      <option value="Chat">Live Chat</option>
                      <option value="Practice Test">Practice Test</option>
                      <option value="CBT Exam">CBT Exam</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">Title</label>
                    <input type="text" value={materialForm.title} onChange={(e) => setMaterialForm({...materialForm, title: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-blue-500 outline-none" required />
                  </div>
                  <div>
                    <label className="block text-sm font-poppins text-slate-400 mb-1">URL / Link</label>
                    <input type="text" value={materialForm.url} onChange={(e) => setMaterialForm({...materialForm, url: e.target.value})} className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 focus:border-blue-500 outline-none" required />
                  </div>
                </div>
                <div className="flex gap-3 pt-4 border-t border-slate-800">
                  <button type="button" onClick={() => setAssignMaterialLecturer(null)} className="flex-1 py-3 px-4 rounded-xl border border-slate-700 text-slate-300 font-semibold hover:bg-slate-800 transition-colors">
                    Cancel
                  </button>
                  <button type="submit" disabled={isSaving} className="flex-1 py-3 px-4 rounded-xl font-semibold bg-blue-500 hover:bg-blue-600 text-white transition-colors disabled:opacity-50">
                    {isSaving ? 'Assigning...' : 'Assign Material'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* View Modal */}
      <AnimatePresence>
        {viewLecturer && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-[#020617]/80 backdrop-blur-sm overflow-y-auto py-10">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 md:p-8 w-full max-w-2xl my-auto shadow-2xl relative"
            >
              <button onClick={() => setViewLecturer(null)} className="absolute top-6 right-6 text-slate-400 hover:text-white transition-colors">
                <X size={24} />
              </button>
              <div className="flex items-center gap-4 mb-8 border-b border-slate-800 pb-6">
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-2xl font-bold text-emerald-400 uppercase">
                  {(viewLecturer.full_name || 'L').charAt(0)}
                </div>
                <div>
                  <h2 className="text-2xl font-display font-bold text-white">{viewLecturer.full_name}</h2>
                  <p className="text-slate-400 flex items-center gap-2 mt-1"><Mail size={14}/> {viewLecturer.email}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-6 gap-x-4 mb-8">
                <div><p className="text-xs text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1"><Book size={14}/> Department</p><p className="text-white font-medium">{viewLecturer.department || '-'}</p></div>
                <div><p className="text-xs text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1"><GraduationCap size={14}/> Faculty</p><p className="text-white font-medium">{viewLecturer.faculty || '-'}</p></div>
                <div><p className="text-xs text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1"><Phone size={14}/> Phone Number</p><p className="text-white font-medium">{viewLecturer.phone_number || '-'}</p></div>
                <div><p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Status</p><p className={`font-medium ${viewLecturer.status === 'Disabled' || viewLecturer.status === 'Suspended' ? 'text-rose-400' : 'text-emerald-400'}`}>{viewLecturer.status || 'Active'}</p></div>
                <div><p className="text-xs text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1"><Clock size={14}/> Joined</p><p className="text-white font-medium">{new Date(viewLecturer.created_at).toLocaleDateString()}</p></div>
                <div><p className="text-xs text-slate-500 uppercase tracking-wider mb-1 flex items-center gap-1"><Clock size={14}/> Last Login</p><p className="text-white font-medium">{viewLecturer.last_login ? new Date(viewLecturer.last_login).toLocaleDateString() : 'N/A'}</p></div>
              </div>
              
              <div className="mb-8 space-y-4">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Assigned Courses</p>
                  <div className="flex flex-wrap gap-2">
                    {courseCodesFor(viewLecturer.id).length > 0 ? (
                      courseCodesFor(viewLecturer.id).map((c: string, i: number) => (
                        <span key={i} className="px-3 py-1 bg-slate-800 text-slate-300 text-xs rounded-lg border border-slate-700">{c}</span>
                      ))
                    ) : <span className="text-slate-500 text-sm">No courses assigned</span>}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Assigned Subjects</p>
                  <div className="flex flex-wrap gap-2">
                    {(viewLecturer.assigned_subjects || []).length > 0 ? (
                      (viewLecturer.assigned_subjects || []).map((c: string, i: number) => (
                        <span key={i} className="px-3 py-1 bg-slate-800 text-slate-300 text-xs rounded-lg border border-slate-700">{c}</span>
                      ))
                    ) : <span className="text-slate-500 text-sm">No subjects assigned</span>}
                  </div>
                </div>
              </div>

              <div className="bg-[#020617] rounded-2xl p-4 border border-slate-800/50">
                <p className="text-xs text-slate-500 uppercase tracking-wider mb-4 font-semibold">Lecturer Analytics</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="text-center">
                    <p className="text-2xl font-bold text-white">{viewLecturer.materials_uploaded || 0}</p>
                    <p className="text-[10px] text-slate-500 uppercase mt-1">Uploaded<br/>Materials</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-white">{viewLecturer.cbt_exams_created || 0}</p>
                    <p className="text-[10px] text-slate-500 uppercase mt-1">CBT Exams<br/>Created</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-white">{viewLecturer.total_students || 0}</p>
                    <p className="text-[10px] text-slate-500 uppercase mt-1">Total<br/>Students</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-bold text-emerald-400">{viewLecturer.avg_performance || 'N/A'}</p>
                    <p className="text-[10px] text-slate-500 uppercase mt-1">Avg Student<br/>Performance</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-white mb-2 flex items-center gap-3">
            <UserCog className="text-emerald-400" size={28} /> Lecturer Management
          </h1>
          <p className="text-sm font-body text-slate-400">Add lecturers, assign subjects, and monitor uploads.</p>
        </div>
        <button 
          onClick={() => { setSelectedCourseIds([]); setShowAddModal(true); }}
          className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
        >
          <Plus size={16} /> Add Lecturer
        </button>
      </div>

      <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-6">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search by name, email, department, faculty..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#020617] border border-slate-800 text-white text-sm rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-2 md:pb-0">
            {dynamicFilters.map((opt) => (
              <button
                key={opt}
                onClick={() => setFilterOption(opt)}
                className={`whitespace-nowrap px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filterOption === opt 
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' 
                    : 'bg-[#020617] text-slate-400 border border-slate-800 hover:border-slate-700'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-slate-500">Loading lecturers...</div>
        ) : paginatedLecturers.length === 0 ? (
          <div className="py-12 text-center text-slate-500">No records found.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {paginatedLecturers.map((lecturer) => (
              <div key={lecturer.id} className="bg-[#020617]/50 border border-slate-800/50 rounded-2xl p-5 flex flex-col justify-between hover:border-emerald-500/30 transition-colors group">
                <div>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 font-bold uppercase text-lg shrink-0">
                        {(lecturer.full_name || 'L').charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-white font-bold truncate pr-4">{lecturer.full_name}</h3>
                        <p className="text-xs text-slate-400 truncate">{lecturer.email}</p>
                        {(lecturer.department || lecturer.faculty) && (
                          <p className="text-[10px] text-emerald-500/70 truncate mt-1">
                            {lecturer.department} {lecturer.department && lecturer.faculty && '•'} {lecturer.faculty}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                      <button className="p-2 text-slate-400 hover:text-white transition-colors hover:bg-slate-800 rounded-lg" title="View Profile" onClick={() => setViewLecturer(lecturer)}><Eye size={16}/></button>
                      <button className="p-2 text-slate-400 hover:text-blue-400 transition-colors hover:bg-slate-800 rounded-lg" title="Edit" onClick={() => openEditLecturer(lecturer)}><Edit2 size={16}/></button>
                      {lecturer.status === 'Suspended' || lecturer.status === 'Disabled' ? (
                        <button className="p-2 text-slate-400 hover:text-emerald-400 transition-colors hover:bg-slate-800 rounded-lg" title="Enable Account" onClick={() => handleToggleStatus(lecturer, 'Active')}><UserCheck size={16}/></button>
                      ) : (
                        <>
                          <button className="p-2 text-slate-400 hover:text-amber-500 transition-colors hover:bg-slate-800 rounded-lg" title="Suspend Account" onClick={() => handleToggleStatus(lecturer, 'Suspended')}><UserX size={16}/></button>
                        </>
                      )}
                      <button className="p-2 text-slate-400 hover:text-rose-400 transition-colors hover:bg-slate-800 rounded-lg" title="Delete Lecturer" onClick={() => handleDeleteLecturer(lecturer)}><Trash2 size={16}/></button>
                    </div>
                  </div>
                  
                  <div className="space-y-2 mb-4">
                    {lecturer.assigned_subjects && lecturer.assigned_subjects.length > 0 && (
                      <>
                        <p className="text-xs font-semibold text-slate-500 uppercase">Assigned Subjects</p>
                        <div className="flex flex-wrap gap-2">
                          {lecturer.assigned_subjects.map((sub: string, i: number) => (
                            <span key={i} className="px-2 py-1 bg-slate-800 text-slate-300 text-[10px] rounded-md border border-slate-700">
                              {sub}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                    {courseCodesFor(lecturer.id).length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs font-semibold text-slate-500 uppercase">Assigned Courses</p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {courseCodesFor(lecturer.id).map((sub: string, i: number) => (
                            <span key={i} className="px-2 py-1 bg-emerald-500/10 text-emerald-400 text-[10px] rounded-md border border-emerald-500/20">
                              {sub}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                
                <div className="pt-4 border-t border-slate-800/50 flex items-center justify-between">
                  <div className="flex items-center gap-4 text-sm text-slate-400">
                    <div className="flex items-center gap-1.5" title="Uploaded Materials">
                      <BookOpen size={14} className="text-emerald-500" />
                      <span>{lecturer.materials_uploaded || 0}</span>
                    </div>
                    <div className="flex items-center gap-1.5" title="CBT Exams Created">
                      <FileText size={14} className="text-blue-500" />
                      <span>{lecturer.cbt_exams_created || 0}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-md ${
                      lecturer.status === 'Suspended' || lecturer.status === 'Disabled' ? 'bg-rose-500/10 text-rose-400' : 'bg-emerald-500/10 text-emerald-400'
                    }`}>
                      {lecturer.status || 'Active'}
                    </span>
                    <div className="flex gap-3">
                      <button className="text-emerald-400 hover:text-emerald-300 text-[11px] font-semibold transition-colors uppercase tracking-wider" onClick={() => openEditLecturer(lecturer)}>
                        Assign Courses
                      </button>
                      <button className="text-blue-400 hover:text-blue-300 text-[11px] font-semibold transition-colors uppercase tracking-wider" onClick={() => setAssignMaterialLecturer(lecturer)}>
                        Assign Materials
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-6 mt-6 border-t border-slate-800">
            <div className="text-sm text-slate-500">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredLecturers.length)} of {filteredLecturers.length} lecturers
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <button 
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
