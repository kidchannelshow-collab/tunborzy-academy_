import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, AlertTriangle, Save, Globe, Eye, Plus, GripVertical, Image as ImageIcon, Edit2,
  Type, AlignLeft, Music, Video, List, Sigma,
  BookOpen, Trash2, Link as LinkIcon, Upload, ArrowUp, ArrowDown,
  Bold, Italic, Heading, ListOrdered
} from 'lucide-react';
import { supabase } from '../../supabaseClient';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import 'katex/dist/katex.min.css';
import LessonMaterialsManager from './LessonMaterialsManager';
import StudentLessonViewer from './StudentLessonViewer';
import LessonPublishingSettings from './LessonPublishingSettings';

export type BlockType = 'title' | 'intro' | 'main' | 'image' | 'audio' | 'video' | 'example' | 'formula' | 'diagram' | 'summary' | 'references';


export type MaterialCategory = 'Lecture Notes' | 'Slides' | 'Video Lecture' | 'Audio Lecture' | 'Assignments' | 'Additional Resources';


export interface PublishSettings {
  status: 'Draft' | 'Under Review' | 'Published' | 'Archived' | 'Hidden';
  publishAt: string | null;
  unpublishAt: string | null;
  isLocked: boolean;
  visibility: 'Public' | 'Undergraduate Only' | 'Selected Departments' | 'Selected Faculties' | 'Selected Levels';
  isPremium: boolean;
  auditLogs: { action: string; by: string; date: string }[];
}

export const defaultPublishSettings: PublishSettings = {
  status: 'Draft',
  publishAt: null,
  unpublishAt: null,
  isLocked: false,
  visibility: 'Public',
  isPremium: false,
  auditLogs: []
};

export interface LessonAttachment {
  id: string;
  name: string;
  type: 'pdf' | 'doc' | 'ppt' | 'excel' | 'zip' | 'video' | 'audio' | 'image' | 'link';
  size?: string;
  category: MaterialCategory;
  url: string;
  uploadedAt: string;
  uploadedBy?: string;
}

import { useProfile } from '../../lib/useProfile';
export interface LessonBlock {
  id: string;
  type: BlockType;
  content: string;
  fileUrl?: string;
}

interface LessonEditorProps {
  courseCode: string;
  topic: string;
  portal: string;
  semester: string;
  lesson?: any; // Existing lesson if editing
  onClose: () => void;
  onSaved: () => void;
}

const BLOCK_TYPES: { type: BlockType; label: string; icon: any }[] = [
  { type: 'title', label: 'Lesson Title', icon: Type },
  { type: 'intro', label: 'Introduction', icon: AlignLeft },
  { type: 'main', label: 'Main Explanation', icon: AlignLeft },
  { type: 'example', label: 'Worked Example', icon: List },
  { type: 'formula', label: 'Formula', icon: Sigma },
  { type: 'diagram', label: 'Diagram', icon: ImageIcon },
  { type: 'image', label: 'Image', icon: ImageIcon },
  { type: 'audio', label: 'Audio', icon: Music },
  { type: 'video', label: 'Video', icon: Video },
  { type: 'summary', label: 'Summary', icon: BookOpen },
  { type: 'references', label: 'References', icon: LinkIcon },
];

/**
 * Small formatting toolbar over a plain textarea.
 *
 * It writes Markdown into the block's existing `content` string rather than
 * introducing a rich-text document format — so a formatted lesson is stored
 * exactly like an unformatted one, survives a reload, and renders through the
 * same ReactMarkdown pipeline the student viewer already uses. Markdown (not a
 * contentEditable surface) also keeps the stored value diffable and safe.
 *
 * Deliberately just the basics: bold, italic, heading, bulleted list, numbered
 * list and link. No tables, no embeds, no nested structure.
 */
function RichTextEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const restore = (el: HTMLTextAreaElement, start: number, end: number) => {
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start, end);
    });
  };

  /** Wraps the current selection (or the caret) in `token` on both sides. */
  const wrapSelection = (token: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = value.slice(start, end);
    onChange(value.slice(0, start) + token + selected + token + value.slice(end));
    // Keep the inner text selected so a second click does not double-wrap.
    restore(el, start + token.length, start + token.length + selected.length);
  };

  /**
   * Prefixes every line the selection touches. Leading Markdown markers are
   * stripped first so switching a bulleted list to a numbered one replaces the
   * marker instead of stacking "1. - item".
   */
  const prefixLines = (prefix: string, numbered = false) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;

    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const nextBreak = value.indexOf('\n', end);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;

    const formatted = value
      .slice(lineStart, lineEnd)
      .split('\n')
      .map((line, i) => {
        const stripped = line.replace(/^(\s*)(?:[-*+]\s+|\d+\.\s+|#{1,6}\s+)?/, '$1');
        return numbered ? `${i + 1}. ${stripped}` : `${prefix}${stripped}`;
      })
      .join('\n');

    onChange(value.slice(0, lineStart) + formatted + value.slice(lineEnd));
    restore(el, lineStart, lineStart + formatted.length);
  };

  const insertLink = () => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = value.slice(start, end);
    const label = selected || 'link text';
    const markdown = `[${label}](https://)`;
    onChange(value.slice(0, start) + markdown + value.slice(end));
    // Park the caret inside the empty URL so it can be typed straight away.
    const urlStart = start + label.length + 3;
    restore(el, urlStart, urlStart + 8);
  };

  const tools: { icon: any; title: string; run: () => void }[] = [
    { icon: Bold, title: 'Bold', run: () => wrapSelection('**') },
    { icon: Italic, title: 'Italic', run: () => wrapSelection('*') },
    { icon: Heading, title: 'Heading', run: () => prefixLines('## ') },
    { icon: List, title: 'Bulleted list', run: () => prefixLines('- ') },
    { icon: ListOrdered, title: 'Numbered list', run: () => prefixLines('', true) },
    { icon: LinkIcon, title: 'Link', run: insertLink },
  ];

  return (
    <div className="rounded-xl border border-slate-800 bg-[#020617] focus-within:border-blue-500 transition-colors">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5 border-b border-slate-800">
        {tools.map((tool) => (
          <button
            key={tool.title}
            type="button"
            title={tool.title}
            aria-label={tool.title}
            onClick={tool.run}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <tool.icon size={15} />
          </button>
        ))}
        <span className="ml-auto pr-1 text-[10px] text-slate-600 hidden sm:inline">
          Markdown
        </span>
      </div>
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent border-none p-4 text-slate-200 placeholder:text-slate-600 focus:ring-0 outline-none min-h-[140px] resize-y custom-scrollbar leading-relaxed"
      />
    </div>
  );
}

export default function LessonEditor({ courseCode, topic, portal, semester, lesson, onClose, onSaved }: LessonEditorProps) {
  const [blocks, setBlocks] = useState<LessonBlock[]>([]);
  const [attachments, setAttachments] = useState<LessonAttachment[]>([]);
  const [activeTab, setActiveTab] = useState<'content' | 'materials' | 'settings'>('content');
  const [publishSettings, setPublishSettings] = useState<PublishSettings>(defaultPublishSettings);
  const { profile } = useProfile();
  const isTutor = profile?.role === 'Tutor';
  const isUnderReview = publishSettings?.status === 'Under Review';
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  // Id of a lesson this editor created, so saving again updates it rather than
  // inserting a second copy while the parent still holds a null `lesson` prop.
  const createdLessonIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (lesson) {
      setStatus(lesson.is_published ? 'published' : 'draft');
      try {
        if (lesson.description) {
          const parsed = JSON.parse(lesson.description);
          if (Array.isArray(parsed)) {
            setBlocks(parsed);
            setAttachments([]);
          } else if (parsed && parsed.blocks) {
            setBlocks(parsed.blocks || []);
            setAttachments(parsed.attachments || []);
            setPublishSettings(parsed.publishSettings || defaultPublishSettings);
          } else {
             // legacy plain text fallback
            setBlocks([{ id: Date.now().toString(), type: 'main', content: lesson.description }]);
            setAttachments([]);
          }
        }
      } catch (e) {
        setBlocks([{ id: Date.now().toString(), type: 'main', content: lesson.description || '' }]);
      }
    } else {
      setBlocks([
        { id: Date.now().toString(), type: 'title', content: 'Untitled Lesson' },
        { id: (Date.now() + 1).toString(), type: 'intro', content: '' }
      ]);
    }
  }, [lesson]);

  // Autosave Draft
  useEffect(() => {
    const timer = setTimeout(() => {
      if (blocks.length > 0 && status === 'draft' && lesson) {
        handleSave(false, { silent: true });
      }
    }, 15000); // Autosave every 15s if draft and editing existing
    return () => clearTimeout(timer);
  }, [blocks, status, lesson]);

  const handleAddBlock = (type: BlockType) => {
    const newBlock: LessonBlock = {
      id: Date.now().toString(),
      type,
      content: ''
    };
    setBlocks([...blocks, newBlock]);
    setShowAddMenu(false);
  };

  const handleUpdateBlock = (id: string, updates: Partial<LessonBlock>) => {
    setBlocks(blocks.map(b => b.id === id ? { ...b, ...updates } : b));
  };

  const handleDeleteBlock = (id: string) => {
    setBlocks(blocks.filter(b => b.id !== id));
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index > 0) {
      const newBlocks = [...blocks];
      [newBlocks[index - 1], newBlocks[index]] = [newBlocks[index], newBlocks[index - 1]];
      setBlocks(newBlocks);
    } else if (direction === 'down' && index < blocks.length - 1) {
      const newBlocks = [...blocks];
      [newBlocks[index + 1], newBlocks[index]] = [newBlocks[index], newBlocks[index + 1]];
      setBlocks(newBlocks);
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('blockIndex', index.toString());
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    const dragIndex = parseInt(e.dataTransfer.getData('blockIndex'));
    if (dragIndex === dropIndex || isNaN(dragIndex)) return;
    
    const newBlocks = [...blocks];
    const [draggedBlock] = newBlocks.splice(dragIndex, 1);
    newBlocks.splice(dropIndex, 0, draggedBlock);
    setBlocks(newBlocks);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, blockId: string, bucket: string = 'tonborzy-content') => {
    const file = e.target.files?.[0];
    if (!file || !supabase) return;
    
    // UI placeholder or loading state could go here
    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `lessons/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
      handleUpdateBlock(blockId, { fileUrl: data.publicUrl });
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Upload failed');
    }
  };

  const extractTitle = () => {
    const titleBlock = blocks.find(b => b.type === 'title');
    return titleBlock?.content || 'Untitled Lesson';
  };

  /**
   * `silent` is set by the 15s draft autosave: it still writes, but skips the
   * `onSaved()` refresh so a background save does not churn the admin list.
   *
   * `settings` overrides the `publishSettings` captured by this closure. It
   * exists for "Submit for Review", which must write the new status in the same
   * save: `setPublishSettings` is asynchronous, so a `setTimeout(() => handleSave())`
   * would run the *previous* closure and persist the old status, silently losing
   * the submission.
   */
  const handleSave = async (
    publish: boolean,
    { silent = false, settings }: { silent?: boolean; settings?: PublishSettings } = {}
  ) => {
    if (!supabase) return;
    setIsSaving(true);

    /**
     * The publish intent and the publication status are ONE decision, not two.
     *
     * Two buttons can publish, and before this they disagreed:
     *
     *   "Publish Lesson"     wrote `is_published: true` but left the embedded
     *                        `publishSettings.status` at 'Draft', so the lesson
     *                        was live for students yet hidden from the Resource
     *                        Library, which filters on that status.
     *   "Save Publishing     read the editor's `status` state, which the status
     *    Settings"           radio in the Settings tab never updates — so
     *                        choosing "Published" and saving wrote
     *                        `is_published: false` and the lesson stayed hidden.
     *
     * Now: picking 'Published' publishes, the Publish button records it, and
     * every other status (Draft / Under Review / Archived / Hidden) leaves the
     * row unpublished. `is_published` stays the column the student readers gate
     * on; `status` is kept in step with it so the surfaces that read the status
     * agree.
     */
    const chosen = settings ?? publishSettings;
    const shouldPublish = publish || chosen.status === 'Published';

    const effectiveSettings: PublishSettings =
      publish && chosen.status !== 'Published'
        ? {
            ...chosen,
            status: 'Published',
            auditLogs: [
              {
                action: 'Published',
                by: profile?.full_name || 'Staff',
                date: new Date().toISOString(),
              },
              ...(chosen.auditLogs || []),
            ],
          }
        : chosen;

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      let lecturerName = 'Admin';
      if (userId) {
        const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', userId).single();
        if (profile) lecturerName = profile.full_name;
      }

      const lessonData = {
        title: extractTitle(),
        description: JSON.stringify({ blocks, attachments, publishSettings: effectiveSettings }),
        portal,
        semester,
        course_code: courseCode,
        topic,
        file_type: 'lesson',
        is_published: shouldPublish,
        lecturer_id: userId,
        lecturer_name: lecturerName,
        // `materials.file_url` is NOT NULL with no default. A lesson carries its
        // content in `description`, so there is no file to point at — the '#'
        // sentinel is the app's established "no file" marker (CourseManagement
        // only renders a download link when `file_url !== '#'`).
        //
        // Leaving this out is what made lessons silently fail to save: the
        // insert raised a not-null violation and, because the result was never
        // checked, the editor still reported success and closed.
        file_url: '#',
      };

      // Resolved once, then reused, so repeatedly saving a brand-new lesson
      // updates the row it created instead of inserting another copy.
      const existingId = lesson?.id ?? createdLessonIdRef.current;

      if (existingId) {
        const { error } = await supabase.from('materials').update(lessonData).eq('id', existingId);
        if (error) throw error;
      } else {
        // `order_index` is set on CREATE only. Every reader orders lessons by it,
        // and this editor never wrote it, so new lessons arrived NULL and sorted
        // last. Date.now() puts each new lesson after the ones already there,
        // matching MaterialUploadModal; re-saving never rewrites it, so a lesson
        // does not jump position on every edit.
        const { data, error } = await supabase
          .from('materials')
          .insert([{ ...lessonData, order_index: Date.now() }])
          .select('id')
          .single();
        if (error) throw error;
        if (data?.id) createdLessonIdRef.current = data.id;
      }

      setStatus(shouldPublish ? 'published' : 'draft');
      // Mirror the status the write actually persisted, so the badge and the
      // Settings tab stop showing the value the author typed over.
      setPublishSettings(effectiveSettings);
      if (!silent) onSaved();
    } catch (error: any) {
      // Surfaced rather than swallowed: a failed save used to look identical to
      // a successful one, which is how the missing-file_url bug stayed hidden.
      console.error('Error saving lesson:', error);
      alert(`Could not save this lesson: ${error?.message || 'unknown error'}`);
    }
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#020617] flex flex-col">
      {/* Header */}
      <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-[#0f172a]">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white rounded-lg transition-colors">
            <X size={20} />
          </button>
          <div className="h-6 w-px bg-slate-800"></div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded uppercase tracking-wider">{courseCode}</span>
              <span className="text-slate-400 text-sm">/</span>
              <span className="text-sm font-semibold text-slate-300">{topic}</span>
            </div>
            <h2 className="text-lg font-bold text-white leading-tight">Lesson Editor</h2>
          </div>
        </div>

        {/* Section tabs. `activeTab` existed as state with the Materials and
            Publishing Settings panels already written against it, but there was
            no control to ever change it — so both panels were unreachable and a
            lesson could never be given attachments or a publish status. */}
        {!isPreviewMode && (
          <div className="hidden md:flex items-center gap-1 bg-[#020617] border border-slate-800 rounded-xl p-1">
            {([
              ['content', 'Content'],
              ['materials', 'Materials'],
              ['settings', 'Settings'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${activeTab === id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className={`text-xs px-2 py-1 rounded-md font-medium border ${status === 'published' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' : 'border-amber-500/30 text-amber-400 bg-amber-500/10'}`}>
            {status.toUpperCase()}
          </div>
          <button 
            onClick={() => setIsPreviewMode(!isPreviewMode)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-sm font-medium"
          >
            {isPreviewMode ? <Edit2 size={16} /> : <Eye size={16} />}
            {isPreviewMode ? 'Edit Mode' : 'Preview'}
          </button>
          {!isPreviewMode && (
            <>
              {isTutor ? (
                <>
                  <button 
                    onClick={() => handleSave(false)}
                    disabled={isSaving || isUnderReview}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-sm font-medium"
                  >
                    <Save size={16} /> Save Draft
                  </button>
                  <button
                    onClick={() => {
                      // Build the next settings and hand them straight to
                      // handleSave, so the submission is persisted in one write
                      // rather than raced against setState.
                      const nextSettings: PublishSettings = {
                        ...publishSettings,
                        status: 'Under Review',
                        auditLogs: [
                          { action: 'Submitted for Review', by: profile?.full_name || 'Tutor', date: new Date().toISOString() },
                          ...(publishSettings.auditLogs || []),
                        ],
                      };
                      setPublishSettings(nextSettings);
                      handleSave(false, { settings: nextSettings });
                    }}
                    disabled={isSaving || isUnderReview}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 transition-colors text-sm font-bold"
                  >
                    <Globe size={16} /> Submit for Review
                  </button>
                </>
              ) : (
                <>
                  <button 
                    onClick={() => handleSave(false)}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-sm font-medium"
                  >
                    <Save size={16} /> Save Draft
                  </button>
                  <button 
                    onClick={() => handleSave(true)}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white transition-colors text-sm font-bold"
                  >
                    <Globe size={16} /> Publish Lesson
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Editor Canvas */}
      <div className="flex-1 overflow-y-auto p-6 md:p-10 scroll-smooth custom-scrollbar">
        {activeTab === 'materials' && (
          <div className="max-w-3xl mx-auto">
            <LessonMaterialsManager attachments={attachments} setAttachments={setAttachments} />
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="max-w-3xl mx-auto">
            {/* Publishing intent comes from the settings document, so nothing is
                forced to `publish: true` here. Passing the editor's own `status`
                state was the bug: the status radio never updated that state, so
                choosing "Published" saved `is_published: false`. */}
            <LessonPublishingSettings publishSettings={publishSettings} setPublishSettings={setPublishSettings} onSave={() => handleSave(false)} />
          </div>
        )}
        <div className={`max-w-3xl mx-auto space-y-6 ${activeTab !== 'content' ? 'hidden' : ''}`}>
          <AnimatePresence>
            {blocks.map((block, index) => (
              <motion.div 
                key={block.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                draggable={!isPreviewMode}
                onDragStart={(e: any) => handleDragStart(e, index)}
                onDragOver={(e: any) => handleDragOver(e)}
                onDrop={(e: any) => handleDrop(e, index)}
                className="relative group rounded-2xl border border-slate-800/50 bg-[#0f172a]/50 p-5 transition-all"
              >
                {/* Drag Handle & Controls */}
                {!isPreviewMode && (
                  <div className="absolute -left-12 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                    <button onClick={() => moveBlock(index, 'up')} className="p-1 text-slate-500 hover:text-white rounded bg-slate-800/50"><ArrowUp size={14} /></button>
                    <div className="p-1 text-slate-500 cursor-grab active:cursor-grabbing"><GripVertical size={16} /></div>
                    <button onClick={() => moveBlock(index, 'down')} className="p-1 text-slate-500 hover:text-white rounded bg-slate-800/50"><ArrowDown size={14} /></button>
                  </div>
                )}
                
                {!isPreviewMode && (
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-slate-400 bg-slate-800/50 px-2 py-1 rounded">
                      {BLOCK_TYPES.find(t => t.type === block.type)?.icon && React.createElement(BLOCK_TYPES.find(t => t.type === block.type)!.icon, { size: 14 })}
                      {BLOCK_TYPES.find(t => t.type === block.type)?.label}
                    </div>
                    {block.type !== 'title' && (
                      <button onClick={() => handleDeleteBlock(block.id)} className="text-slate-500 hover:text-rose-400 p-1 rounded-lg transition-colors">
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                )}

                {/* Block Content Renderers */}
                {block.type === 'title' && (
                  isPreviewMode ? (
                    <h1 className="text-4xl font-display font-bold text-white mb-6">{block.content || 'Untitled Lesson'}</h1>
                  ) : (
                    <input 
                      type="text" 
                      value={block.content}
                      onChange={(e) => handleUpdateBlock(block.id, { content: e.target.value })}
                      placeholder="Lesson Title"
                      className="w-full bg-transparent border-none text-3xl font-display font-bold text-white focus:ring-0 placeholder:text-slate-600 outline-none"
                    />
                  )
                )}

                {(block.type === 'intro' || block.type === 'main' || block.type === 'example' || block.type === 'summary' || block.type === 'references' || block.type === 'formula') && (
                  isPreviewMode ? (
                    // `lesson-content` is the same class the student viewer uses,
                    // so this preview is what students actually see. (`prose` was
                    // inert here — the typography plugin is not installed.)
                    <div className="lesson-content overflow-x-auto custom-scrollbar">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {block.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <RichTextEditor
                      value={block.content}
                      onChange={(next) => handleUpdateBlock(block.id, { content: next })}
                      placeholder={`Write the ${block.type} here — use the toolbar for bold, headings and lists.`}
                    />
                  )
                )}

                {(block.type === 'image' || block.type === 'diagram') && (
                  <div className="space-y-3">
                    {block.fileUrl ? (
                      <div className="relative group/img rounded-xl overflow-hidden border border-slate-800">
                        <img src={block.fileUrl} alt="Block content" className="w-full max-h-[500px] object-contain bg-[#020617]" />
                        {!isPreviewMode && (
                          <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover/img:opacity-100 transition-opacity">
                            <label className="p-2 bg-slate-900/80 backdrop-blur text-white rounded-lg cursor-pointer hover:bg-indigo-500 transition-colors">
                              <Upload size={16} />
                              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, block.id)} />
                            </label>
                            <button onClick={() => handleUpdateBlock(block.id, { fileUrl: '' })} className="p-2 bg-rose-500/80 backdrop-blur text-white rounded-lg hover:bg-rose-600 transition-colors">
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      !isPreviewMode && (
                        <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-slate-800 border-dashed rounded-xl cursor-pointer bg-[#020617] hover:bg-slate-900 transition-colors">
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <ImageIcon className="w-8 h-8 mb-3 text-slate-500" />
                            <p className="mb-2 text-sm text-slate-400"><span className="font-bold text-indigo-400">Click to upload</span> or drag and drop</p>
                          </div>
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, block.id)} />
                        </label>
                      )
                    )}
                    {!isPreviewMode && (
                      <input 
                        type="text" 
                        value={block.content}
                        onChange={(e) => handleUpdateBlock(block.id, { content: e.target.value })}
                        placeholder="Caption (optional)"
                        className="w-full bg-transparent border-none text-sm text-slate-400 text-center focus:ring-0 outline-none"
                      />
                    )}
                    {isPreviewMode && block.content && <p className="text-center text-sm text-slate-500 mt-2">{block.content}</p>}
                  </div>
                )}

                {block.type === 'audio' && (
                  <div className="space-y-3">
                    {block.fileUrl ? (
                      <div className="bg-[#020617] p-4 rounded-xl border border-slate-800 flex flex-col gap-3">
                        <div className="flex items-center gap-4">
                          <audio controls className="w-full h-10 outline-none" src={block.fileUrl} />
                          {!isPreviewMode && (
                            <button onClick={() => handleUpdateBlock(block.id, { fileUrl: '' })} className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0">
                              <Trash2 size={16} />
                            </button>
                          )}
                        </div>
                        {!isPreviewMode && (
                          <input 
                            type="text" 
                            value={block.content}
                            onChange={(e) => handleUpdateBlock(block.id, { content: e.target.value })}
                            placeholder="Audio title or caption (optional)"
                            className="w-full bg-transparent border-none text-sm text-slate-400 focus:ring-0 outline-none px-1"
                          />
                        )}
                        {isPreviewMode && block.content && <p className="text-sm text-slate-300">{block.content}</p>}
                      </div>
                    ) : (
                      !isPreviewMode && (
                        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-800 border-dashed rounded-xl cursor-pointer bg-[#020617] hover:bg-slate-900 transition-colors">
                          <div className="flex flex-col items-center justify-center pt-5 pb-6">
                            <Music className="w-8 h-8 mb-3 text-slate-500" />
                            <p className="text-sm text-slate-400"><span className="font-bold text-indigo-400">Upload audio</span> (.mp3, .wav)</p>
                          </div>
                          <input type="file" accept="audio/*" className="hidden" onChange={(e) => handleFileUpload(e, block.id)} />
                        </label>
                      )
                    )}
                  </div>
                )}

                {block.type === 'video' && (
                  <div className="space-y-3">
                    {/* Parenthesised on purpose: `a && b || c` binds as
                        `(a && b) || c`, so an empty `content` fell through to
                        `block.content.includes(...)` on the right of the `||`
                        and threw on a block whose content had not been set. */}
                    {(block.content && (block.content.includes('youtube.com') || block.content.includes('youtu.be'))) ? (
                      <div className="aspect-video w-full rounded-xl overflow-hidden border border-slate-800 bg-[#020617]">
                        <iframe 
                          width="100%" 
                          height="100%" 
                          src={`https://www.youtube.com/embed/${block.content.split('v=')[1]?.split('&')[0] || block.content.split('youtu.be/')[1]}`} 
                          title="YouTube video player" 
                          frameBorder="0" 
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                          allowFullScreen
                        ></iframe>
                      </div>
                    ) : block.fileUrl ? (
                      <div className="flex flex-col gap-3">
                        <div className="relative group/vid rounded-xl overflow-hidden border border-slate-800">
                          <video controls className="w-full bg-[#020617] max-h-[500px]" src={block.fileUrl} />
                          {!isPreviewMode && (
                            <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover/vid:opacity-100 transition-opacity">
                              <button onClick={() => handleUpdateBlock(block.id, { fileUrl: '' })} className="p-2 bg-rose-500/80 backdrop-blur text-white rounded-lg hover:bg-rose-600 transition-colors">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          )}
                        </div>
                        {!isPreviewMode && (
                          <input 
                            type="text" 
                            value={block.content}
                            onChange={(e) => handleUpdateBlock(block.id, { content: e.target.value })}
                            placeholder="Video caption (optional)"
                            className="w-full bg-transparent border-none text-sm text-slate-400 text-center focus:ring-0 outline-none"
                          />
                        )}
                        {isPreviewMode && block.content && <p className="text-center text-sm text-slate-500">{block.content}</p>}
                      </div>
                    ) : (
                      !isPreviewMode && (
                        <div className="flex flex-col gap-3">
                          <input 
                            type="text" 
                            value={block.content}
                            onChange={(e) => handleUpdateBlock(block.id, { content: e.target.value })}
                            placeholder="Paste YouTube URL here..."
                            className="w-full bg-[#020617] border border-slate-800 rounded-xl px-4 py-3 text-sm text-slate-300 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none"
                          />
                          <div className="flex items-center gap-4">
                            <div className="h-px bg-slate-800 flex-1"></div>
                            <span className="text-xs text-slate-500 uppercase font-bold">OR</span>
                            <div className="h-px bg-slate-800 flex-1"></div>
                          </div>
                          <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-slate-800 border-dashed rounded-xl cursor-pointer bg-[#020617] hover:bg-slate-900 transition-colors">
                            <div className="flex flex-col items-center justify-center pt-5 pb-6">
                              <Video className="w-8 h-8 mb-3 text-slate-500" />
                              <p className="text-sm text-slate-400"><span className="font-bold text-indigo-400">Upload video</span> (.mp4)</p>
                            </div>
                            <input type="file" accept="video/*" className="hidden" onChange={(e) => handleFileUpload(e, block.id)} />
                          </label>
                        </div>
                      )
                    )}
                  </div>
                )}
                
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Add Block Menu */}
          {!isPreviewMode && (
            <div className="pt-6 relative">
              {showAddMenu ? (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="bg-[#0f172a] border border-slate-700 p-2 rounded-2xl shadow-xl w-full"
                >
                  <div className="flex justify-between items-center px-3 py-2 mb-2 border-b border-slate-800">
                    <span className="text-sm font-bold text-slate-300">Add Block</span>
                    <button onClick={() => setShowAddMenu(false)} className="text-slate-500 hover:text-white"><X size={16} /></button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {BLOCK_TYPES.filter(t => t.type !== 'title').map((type) => (
                      <button
                        key={type.type}
                        onClick={() => handleAddBlock(type.type)}
                        className="flex flex-col items-center justify-center p-3 rounded-xl bg-[#020617]/50 hover:bg-indigo-500/20 hover:text-indigo-400 border border-transparent hover:border-indigo-500/30 transition-all text-slate-400 gap-2"
                      >
                        <type.icon size={20} />
                        <span className="text-xs font-medium text-center">{type.label}</span>
                      </button>
                    ))}
                  </div>
                </motion.div>
              ) : (
                <div className="flex justify-center">
                  <button 
                    onClick={() => setShowAddMenu(true)}
                    className="flex items-center gap-2 px-6 py-3 rounded-full bg-slate-800 hover:bg-indigo-500 hover:text-white text-slate-300 border border-slate-700 hover:border-indigo-500 transition-all font-bold shadow-lg shadow-slate-950"
                  >
                    <Plus size={18} /> Add Block
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
