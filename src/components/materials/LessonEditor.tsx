import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Save, Globe, Eye, Plus, GripVertical, Image as ImageIcon, Edit2,
  Type, AlignLeft, Music, Video, List, Sigma,
  BookOpen, Trash2, Link as LinkIcon, Upload, ArrowUp, ArrowDown,
  Bold, Italic, Heading, ListOrdered, CheckCircle2, AlertCircle, Loader2, Layers, Copy
} from 'lucide-react';
import { supabase } from '../../supabaseClient';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import 'katex/dist/katex.min.css';
import { useProfile } from '../../lib/useProfile';
import LessonMaterialsManager from './LessonMaterialsManager';
import LessonPublishingSettings from './LessonPublishingSettings';
import { nextMaterialOrderIndex } from '../../lib/materialOrder';
import {
  MAX_SLIDES,
  createBlock,
  createEmptyDocument,
  createSlide,
  defaultPublishSettings,
  documentTitle,
  makeId,
  parseLessonDocument,
  serializeLessonDocument,
  slideLabel,
  type BlockType,
  type LessonBlock,
  type LessonDoc,
  type LessonSlide,
  type PublishSettings,
} from '../../lib/lessonDocument';

/**
 * The stored document shape now lives in one place. These re-exports keep the
 * existing `from './LessonEditor'` imports in LessonMaterialsManager and
 * LessonPublishingSettings resolving, so only the definition moved — no caller
 * had to change.
 */
export type {
  BlockType,
  LessonAttachment,
  LessonBlock,
  LessonDoc,
  LessonSlide,
  MaterialCategory,
  PublishSettings,
} from '../../lib/lessonDocument';
export { defaultPublishSettings } from '../../lib/lessonDocument';

/**
 * The block types an author can insert. Kept in the editor rather than the codec
 * because it is a UI catalogue (labels and icons), not part of the stored shape.
 */
const BLOCK_TYPES: { type: BlockType; label: string; icon: any }[] = [
  { type: 'title', label: 'Section Title', icon: Type },
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

/** Auto-dismissing feedback strip. Confirms a write that actually completed. */
function Toast({ toast, onDismiss }: { toast: { kind: 'success' | 'error'; message: string } | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, 3200);
    return () => clearTimeout(t);
    // `onDismiss` must be referentially stable — the editor re-renders on every
    // keystroke, and a fresh callback each time would restart this timer and
    // leave the toast up until the author stopped typing.
  }, [toast, onDismiss]);

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.97 }}
          role="status"
          aria-live="polite"
          className={`fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-4 py-3 rounded-2xl border shadow-2xl backdrop-blur ${
            toast.kind === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/40 text-rose-200'
          }`}
        >
          {toast.kind === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span className="text-sm font-semibold">{toast.message}</span>
          <button onClick={onDismiss} className="ml-2 opacity-60 hover:opacity-100 transition-opacity" aria-label="Dismiss">
            <X size={14} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
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

export default function LessonEditor({ courseCode, topic, portal, semester, lesson, onClose, onSaved }: LessonEditorProps) {
  const { profile } = useProfile();
  const isTutor = profile?.role === 'Tutor';

  const [doc, setDoc] = useState<LessonDoc>(() => createEmptyDocument());
  const [activeSlide, setActiveSlide] = useState(0);
  const [activeTab, setActiveTab] = useState<'content' | 'materials' | 'settings'>('content');
  const [isLoadingRecord, setIsLoadingRecord] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const dismissToast = useCallback(() => setToast(null), []);

  const isUnderReview = doc.publishSettings?.status === 'Under Review';

  /**
   * The `materials` row this editor owns.
   *
   * Seeded from the `lesson` prop, then set the moment an insert returns. The
   * parent keeps passing the ORIGINAL prop — for a lesson created in this
   * session that prop is still null — so without the ref a second save would
   * insert a duplicate row instead of updating the one just written.
   */
  const recordIdRef = useRef<string | null>(lesson?.id ?? null);

  /**
   * The live document, for callers that cannot rely on a fresh closure.
   *
   * The 15s autosave, the save-on-slide-switch and the save-on-unmount all fire
   * from outside React's render cycle. A closure captured at the time the timer
   * was scheduled would carry the document as it was then, so switching slides
   * would persist the PREVIOUS slide's edits — one keystroke behind, forever.
   * Every save reads the document from here instead.
   */
  const docRef = useRef(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);

  const statusRef = useRef(status);
  useEffect(() => { statusRef.current = status; }, [status]);

  /**
   * `onSaved` behind a ref.
   *
   * Callers pass an inline arrow, so its identity changes on every one of their
   * renders. Referencing it directly inside `saveDocument` would give
   * `saveDocument` a new identity each time, which in turn re-runs the autosave
   * effect below and restarts its 15-second countdown — so a parent that
   * re-renders more often than every 15 seconds would postpone the autosave
   * forever.
   */
  const onSavedRef = useRef(onSaved);
  useEffect(() => { onSavedRef.current = onSaved; }, [onSaved]);

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  /**
   * Re-hydrate the editor from the database.
   *
   * The row is fetched BY ID rather than trusting the `lesson` prop's
   * `description`, because the prop is only as complete as the caller's
   * `select()` list — and the lecturer's course list asked for a column set that
   * omitted `description` entirely. That single omission is why opening an
   * existing lesson showed an empty editor and then, 15 seconds later, the
   * autosave overwrote the author's real content with that emptiness: the
   * editor had never been given anything to show.
   *
   * Fetching here makes restoration independent of every caller. The prop is
   * still used as the first paint so there is no flash of an empty document.
   */
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      if (lesson?.description) {
        const parsed = parseLessonDocument(lesson.description);
        if (!cancelled) {
          setDoc(parsed);
          setStatus(lesson.is_published ? 'published' : parsed.publishSettings.status === 'Published' ? 'published' : 'draft');
          setActiveSlide(0);
          setDirty(false);
        }
      } else if (!lesson) {
        if (!cancelled) {
          setDoc(createEmptyDocument());
          setStatus('draft');
          setActiveSlide(0);
          setDirty(false);
        }
      }

      if (!lesson?.id || !supabase) return;

      recordIdRef.current = lesson.id;
      setIsLoadingRecord(true);
      const { data, error } = await supabase
        .from('materials')
        .select('id, title, description, is_published, portal, semester, course_code, topic, file_type')
        .eq('id', lesson.id)
        .maybeSingle();

      if (cancelled) return;
      setIsLoadingRecord(false);

      if (error || !data) {
        // The prop already seeded the editor, so a failed refresh is not fatal —
        // but it is worth knowing about, because it means the author is editing
        // whatever the caller happened to select.
        if (error) console.warn('[LessonEditor] could not re-read the lesson row:', error.message);
        return;
      }

      setDoc(parseLessonDocument(data.description));
      setStatus(data.is_published ? 'published' : 'draft');
      setActiveSlide(0);
      setDirty(false);
    };

    void hydrate();
    return () => { cancelled = true; };
  }, [lesson?.id]);

  // ---------------------------------------------------------------------------
  // Saving
  // ---------------------------------------------------------------------------

  /**
   * Write the COMPLETE document — every slide, its blocks, the ordering, the
   * attachments and the publish settings — as one JSON payload.
   *
   * There is no per-slide write anywhere in this editor. A slide is a view onto
   * one document, and the document is what is stored, which is what makes
   * switching slides safe: the payload written on switch is the whole lesson,
   * not the slice being left behind.
   *
   * `silent` is set by the autosave and by save-on-switch: they still write, but
   * skip the toast and the `onSaved()` refresh so a background save does not
   * churn the parent's list or spam the author.
   *
   * `settings` overrides the settings embedded in the document. It exists for
   * "Submit for Review", which must persist the new status in the SAME write as
   * the content: `setDoc` is asynchronous, so deferring the save by a tick would
   * run against the previous document and silently lose the submission.
   */
  const saveDocument = useCallback(async (
    publish: boolean,
    { silent = false, settings }: { silent?: boolean; settings?: PublishSettings } = {},
  ): Promise<boolean> => {
    if (!supabase) {
      if (!silent) setToast({ kind: 'error', message: 'Not connected to the database.' });
      return false;
    }

    const current = docRef.current;
    /**
     * The exact document object this save is shipping.
     *
     * Held so the state written back after the round trip can be compared
     * against what is on screen by then. A save takes a few hundred
     * milliseconds, and the author keeps typing through it: without the
     * comparison, the completion handler would assign the version it just wrote
     * back over the newer one and silently swallow whatever was typed in
     * between. Identity is the right test — `doc` is only ever replaced by a
     * fresh object, never mutated.
     */
    const snapshot = current;
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
    const chosen = settings ?? current.publishSettings ?? defaultPublishSettings;
    const shouldPublish = publish || chosen.status === 'Published';

    const effectiveSettings: PublishSettings =
      publish && chosen.status !== 'Published'
        ? {
            ...chosen,
            status: 'Published',
            auditLogs: [
              { action: 'Published', by: profile?.full_name || 'Staff', date: new Date().toISOString() },
              ...(chosen.auditLogs || []),
            ],
          }
        : chosen;

    const persistedDoc: LessonDoc = { ...current, publishSettings: effectiveSettings };

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      let lecturerName = 'Admin';
      if (userId) {
        const { data: profileRow } = await supabase.from('profiles').select('full_name').eq('id', userId).single();
        if (profileRow?.full_name) lecturerName = profileRow.full_name;
      }

      const lessonData: Record<string, any> = {
        title: documentTitle(persistedDoc),
        description: serializeLessonDocument(persistedDoc),
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

      const existingId = recordIdRef.current;

      if (existingId) {
        const { error } = await supabase.from('materials').update(lessonData).eq('id', existingId);
        if (error) throw error;
      } else {
        /**
         * `order_index` is set on CREATE only, and it is an `integer` column.
         *
         * This line used to read `order_index: Date.now()`, which is ~1.79e12 —
         * about 834× past the 2,147,483,647 ceiling of a 32-bit integer — so the
         * insert was rejected outright with
         *
         *     value "1791931546168" is out of range for type integer
         *
         * and the lesson was never created at all. `nextMaterialOrderIndex`
         * reads the highest index already in this course+topic and takes the
         * next one, which is both in range and what "sort after the existing
         * lessons" actually means.
         */
        const orderIndex = await nextMaterialOrderIndex(courseCode, topic);
        const { data, error } = await supabase
          .from('materials')
          .insert([{ ...lessonData, order_index: orderIndex }])
          .select('id')
          .single();
        if (error) throw error;
        if (data?.id) recordIdRef.current = data.id;
      }

      // Write back only if nothing was typed while the request was in flight.
      const unchangedSinceSnapshot = docRef.current === snapshot;
      setDoc((prev) => (prev === snapshot ? persistedDoc : prev));
      setStatus(shouldPublish ? 'published' : 'draft');
      setLastSavedAt(new Date());
      if (unchangedSinceSnapshot) setDirty(false);

      if (!silent) {
        setToast({
          kind: 'success',
          message: shouldPublish ? 'Lesson published successfully' : 'Draft saved successfully',
        });
        onSavedRef.current?.();
      }
      return true;
    } catch (error: any) {
      // Surfaced rather than swallowed: a failed save used to look identical to
      // a successful one, which is how the missing-file_url bug stayed hidden.
      console.error('Error saving lesson:', error);
      if (!silent) {
        setToast({ kind: 'error', message: `Could not save: ${error?.message || 'unknown error'}` });
      }
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [courseCode, topic, portal, semester, profile?.full_name]);

  /**
   * Persist the open lesson when the author leaves, if there is anything to
   * persist.
   *
   * A lesson that already exists is flushed silently. A brand-new lesson has no
   * row to flush to, so it is confirmed instead — creating a row on close would
   * file a draft the author never asked for, and closing silently would throw
   * away work they had not saved yet. Those are the only two honest options, so
   * the author picks.
   */
  const handleClose = useCallback(() => {
    if (!dirty) {
      onClose();
      return;
    }
    if (recordIdRef.current) {
      // Fire-and-forget: the component unmounts, but the request is already in
      // flight and does not depend on this component still being mounted.
      void saveDocument(false, { silent: true });
      onClose();
      return;
    }
    if (window.confirm('This lesson has not been saved yet. Close without saving?')) {
      onClose();
    }
  }, [dirty, saveDocument, onClose]);

  // Autosave an existing draft every 15s. A brand-new lesson is not autosaved —
  // there is no row to update until "Save Draft" creates one.
  useEffect(() => {
    if (!dirty || status !== 'draft' || !recordIdRef.current) return;
    const timer = setTimeout(() => { void saveDocument(false, { silent: true }); }, 15000);
    return () => clearTimeout(timer);
  }, [doc, dirty, status, saveDocument]);

  // ---------------------------------------------------------------------------
  // Document mutations
  // ---------------------------------------------------------------------------

  const updateDoc = useCallback((updater: (d: LessonDoc) => LessonDoc) => {
    setDoc((prev) => updater(prev));
    setDirty(true);
  }, []);

  const currentIndex = Math.min(activeSlide, Math.max(doc.slides.length - 1, 0));
  const currentSlide = doc.slides[currentIndex];

  const updateSlide = useCallback((slideId: string, updater: (s: LessonSlide) => LessonSlide) => {
    updateDoc((d) => ({ ...d, slides: d.slides.map((s) => (s.id === slideId ? updater(s) : s)) }));
  }, [updateDoc]);

  /**
   * Switch the open section, flushing first.
   *
   * The requirement is that moving between sections never loses work and never
   * leaves the database holding a stale document. Switching is therefore a save
   * point for a lesson that already exists. A lesson with no row yet has nothing
   * to flush to — "Save Draft" is what creates it — so switching is purely a
   * view change there and the in-memory document is kept intact.
   */
  const selectSlide = useCallback((index: number) => {
    if (index === currentIndex) return;
    if (recordIdRef.current && dirty) {
      void saveDocument(false, { silent: true });
    }
    setActiveSlide(index);
  }, [currentIndex, dirty, saveDocument]);

  const addSlide = () => {
    if (doc.slides.length >= MAX_SLIDES) {
      setToast({ kind: 'error', message: `A lesson can hold at most ${MAX_SLIDES} sections.` });
      return;
    }
    const slide = createSlide();
    updateDoc((d) => ({ ...d, slides: [...d.slides, slide] }));
    setActiveSlide(doc.slides.length);
  };

  const duplicateSlide = (index: number) => {
    if (doc.slides.length >= MAX_SLIDES) {
      setToast({ kind: 'error', message: `A lesson can hold at most ${MAX_SLIDES} sections.` });
      return;
    }
    const source = doc.slides[index];
    if (!source) return;
    // Fresh ids on every block: a copied slide keyed by the source's ids would
    // edit both slides at once.
    const copy: LessonSlide = {
      id: makeId('sld'),
      title: source.title ? `${source.title} (Copy)` : '',
      blocks: source.blocks.map((b) => ({ ...b, id: makeId('blk') })),
    };
    updateDoc((d) => {
      const slides = [...d.slides];
      slides.splice(index + 1, 0, copy);
      return { ...d, slides };
    });
    setActiveSlide(index + 1);
  };

  const removeSlide = (index: number) => {
    if (doc.slides.length <= 1) {
      setToast({ kind: 'error', message: 'A lesson must keep at least one section.' });
      return;
    }
    updateDoc((d) => ({ ...d, slides: d.slides.filter((_, i) => i !== index) }));
    setActiveSlide((prev) => {
      if (index < prev) return prev - 1;
      return Math.min(prev, doc.slides.length - 2);
    });
  };

  const moveSlide = (index: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= doc.slides.length) return;
    updateDoc((d) => {
      const slides = [...d.slides];
      [slides[index], slides[target]] = [slides[target], slides[index]];
      return { ...d, slides };
    });
    setActiveSlide(target);
  };

  const handleAddBlock = (type: BlockType) => {
    if (!currentSlide) return;
    updateSlide(currentSlide.id, (s) => ({ ...s, blocks: [...s.blocks, createBlock(type)] }));
    setShowAddMenu(false);
  };

  const handleUpdateBlock = (blockId: string, updates: Partial<LessonBlock>) => {
    if (!currentSlide) return;
    updateSlide(currentSlide.id, (s) => ({
      ...s,
      blocks: s.blocks.map((b) => (b.id === blockId ? { ...b, ...updates } : b)),
    }));
  };

  const handleDeleteBlock = (blockId: string) => {
    if (!currentSlide) return;
    updateSlide(currentSlide.id, (s) => ({ ...s, blocks: s.blocks.filter((b) => b.id !== blockId) }));
  };

  const moveBlock = (index: number, direction: 'up' | 'down') => {
    if (!currentSlide) return;
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= currentSlide.blocks.length) return;
    updateSlide(currentSlide.id, (s) => {
      const blocks = [...s.blocks];
      [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
      return { ...s, blocks };
    });
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('blockIndex', index.toString());
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    const dragIndex = parseInt(e.dataTransfer.getData('blockIndex'));
    if (dragIndex === dropIndex || isNaN(dragIndex) || !currentSlide) return;
    updateSlide(currentSlide.id, (s) => {
      const blocks = [...s.blocks];
      const [dragged] = blocks.splice(dragIndex, 1);
      blocks.splice(dropIndex, 0, dragged);
      return { ...s, blocks };
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, blockId: string, bucket: string = 'tonborzy-content') => {
    const file = e.target.files?.[0];
    if (!file || !supabase) return;

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${makeId('up')}.${fileExt}`;
      const filePath = `lessons/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from(bucket).getPublicUrl(filePath);
      handleUpdateBlock(blockId, { fileUrl: data.publicUrl });
    } catch (error: any) {
      console.error('Error uploading file:', error);
      setToast({ kind: 'error', message: `Upload failed: ${error?.message || 'unknown error'}` });
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderBlock = (block: LessonBlock, preview: boolean) => {
    if (block.type === 'title') {
      return preview ? (
        <h2 className="text-3xl font-display font-bold text-white mb-4">{block.content || 'Section title'}</h2>
      ) : (
        <input
          type="text"
          value={block.content}
          onChange={(e) => handleUpdateBlock(block.id, { content: e.target.value })}
          placeholder={currentIndex === 0 ? 'Lesson title' : 'Section title'}
          className="w-full bg-transparent border-none text-3xl font-display font-bold text-white focus:ring-0 placeholder:text-slate-600 outline-none"
        />
      );
    }

    if (block.type === 'intro' || block.type === 'main' || block.type === 'example' || block.type === 'summary' || block.type === 'references' || block.type === 'formula') {
      return preview ? (
        // `lesson-content` is the same class the student viewer uses, so this
        // preview is what students actually see. (`prose` was inert here — the
        // typography plugin is not installed.)
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
      );
    }

    if (block.type === 'image' || block.type === 'diagram') {
      return (
        <div className="space-y-3">
          {block.fileUrl ? (
            <div className="relative group/img rounded-xl overflow-hidden border border-slate-800">
              <img src={block.fileUrl} alt={block.content || 'Block content'} className="w-full max-h-[500px] object-contain bg-[#020617]" />
              {!preview && (
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
            !preview && (
              <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-slate-800 border-dashed rounded-xl cursor-pointer bg-[#020617] hover:bg-slate-900 transition-colors">
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <ImageIcon className="w-8 h-8 mb-3 text-slate-500" />
                  <p className="mb-2 text-sm text-slate-400"><span className="font-bold text-indigo-400">Click to upload</span> or drag and drop</p>
                </div>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e, block.id)} />
              </label>
            )
          )}
          {!preview && (
            <input
              type="text"
              value={block.content}
              onChange={(e) => handleUpdateBlock(block.id, { content: e.target.value })}
              placeholder="Caption (optional)"
              className="w-full bg-transparent border-none text-sm text-slate-400 text-center focus:ring-0 outline-none"
            />
          )}
          {preview && block.content && <p className="text-center text-sm text-slate-500 mt-2">{block.content}</p>}
        </div>
      );
    }

    if (block.type === 'audio') {
      return (
        <div className="space-y-3">
          {block.fileUrl ? (
            <div className="bg-[#020617] p-4 rounded-xl border border-slate-800 flex flex-col gap-3">
              <div className="flex items-center gap-4">
                <audio controls className="w-full h-10 outline-none" src={block.fileUrl} />
                {!preview && (
                  <button onClick={() => handleUpdateBlock(block.id, { fileUrl: '' })} className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              {!preview && (
                <input
                  type="text"
                  value={block.content}
                  onChange={(e) => handleUpdateBlock(block.id, { content: e.target.value })}
                  placeholder="Audio title or caption (optional)"
                  className="w-full bg-transparent border-none text-sm text-slate-400 focus:ring-0 outline-none px-1"
                />
              )}
              {preview && block.content && <p className="text-sm text-slate-300">{block.content}</p>}
            </div>
          ) : (
            !preview && (
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
      );
    }

    if (block.type === 'video') {
      // Parenthesised on purpose: `a && b || c` binds as `(a && b) || c`, so an
      // empty `content` fell through to `block.content.includes(...)` on the
      // right of the `||` and threw on a block whose content had not been set.
      const isYouTube = !!(block.content && (block.content.includes('youtube.com') || block.content.includes('youtu.be')));
      return (
        <div className="space-y-3">
          {isYouTube ? (
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
                {!preview && (
                  <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover/vid:opacity-100 transition-opacity">
                    <button onClick={() => handleUpdateBlock(block.id, { fileUrl: '' })} className="p-2 bg-rose-500/80 backdrop-blur text-white rounded-lg hover:bg-rose-600 transition-colors">
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>
              {!preview && (
                <input
                  type="text"
                  value={block.content}
                  onChange={(e) => handleUpdateBlock(block.id, { content: e.target.value })}
                  placeholder="Video caption (optional)"
                  className="w-full bg-transparent border-none text-sm text-slate-400 text-center focus:ring-0 outline-none"
                />
              )}
              {preview && block.content && <p className="text-center text-sm text-slate-500">{block.content}</p>}
            </div>
          ) : (
            !preview && (
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
      );
    }

    return null;
  };

  const savedLabel = lastSavedAt
    ? `Saved ${lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : dirty
      ? 'Unsaved changes'
      : null;

  return (
    <div className="fixed inset-0 z-50 bg-[#020617] flex flex-col">
      <Toast toast={toast} onDismiss={dismissToast} />

      {/* Header */}
      <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-[#0f172a]">
        <div className="flex items-center gap-4 min-w-0">
          <button onClick={handleClose} className="p-2 text-slate-400 hover:text-white rounded-lg transition-colors shrink-0" aria-label="Close editor">
            <X size={20} />
          </button>
          <div className="h-6 w-px bg-slate-800 shrink-0"></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded uppercase tracking-wider shrink-0">{courseCode}</span>
              <span className="text-slate-400 text-sm shrink-0">/</span>
              <span className="text-sm font-semibold text-slate-300 truncate">{topic}</span>
            </div>
            <h2 className="text-lg font-bold text-white leading-tight truncate">
              {documentTitle(doc)}
              <span className="ml-2 text-xs font-medium text-slate-500">
                {doc.slides.length} section{doc.slides.length === 1 ? '' : 's'}
              </span>
            </h2>
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

        <div className="flex items-center gap-3 shrink-0">
          {savedLabel && (
            <span className={`text-[11px] font-medium hidden lg:inline ${dirty ? 'text-amber-400' : 'text-slate-500'}`}>
              {savedLabel}
            </span>
          )}
          {(isSaving || isLoadingRecord) && (
            <Loader2 size={16} className="animate-spin text-indigo-400" aria-label="Working" />
          )}
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
                    onClick={() => saveDocument(false)}
                    disabled={isSaving || isUnderReview}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-sm font-medium disabled:opacity-50"
                  >
                    <Save size={16} /> Save Draft
                  </button>
                  <button
                    onClick={() => {
                      // Build the next settings and hand them straight to
                      // saveDocument, so the submission is persisted in one write
                      // rather than raced against setState.
                      const nextSettings: PublishSettings = {
                        ...doc.publishSettings,
                        status: 'Under Review',
                        auditLogs: [
                          { action: 'Submitted for Review', by: profile?.full_name || 'Tutor', date: new Date().toISOString() },
                          ...(doc.publishSettings?.auditLogs || []),
                        ],
                      };
                      void saveDocument(false, { settings: nextSettings });
                    }}
                    disabled={isSaving || isUnderReview}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-amber-950 transition-colors text-sm font-bold disabled:opacity-50"
                  >
                    <Globe size={16} /> Submit for Review
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => saveDocument(false)}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors text-sm font-medium disabled:opacity-50"
                  >
                    <Save size={16} /> Save Draft
                  </button>
                  <button
                    onClick={() => saveDocument(true)}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white transition-colors text-sm font-bold disabled:opacity-50"
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
            <LessonMaterialsManager
              attachments={doc.attachments}
              setAttachments={(next) => {
                updateDoc((d) => ({
                  ...d,
                  attachments: typeof next === 'function' ? (next as any)(d.attachments) : next,
                }));
              }}
            />
          </div>
        )}
        {activeTab === 'settings' && (
          <div className="max-w-3xl mx-auto">
            {/* Publishing intent comes from the settings document, so nothing is
                forced to `publish: true` here. Passing the editor's own `status`
                state was the bug: the status radio never updated that state, so
                choosing "Published" saved `is_published: false`. */}
            <LessonPublishingSettings
              publishSettings={doc.publishSettings}
              setPublishSettings={(next) => {
                updateDoc((d) => ({
                  ...d,
                  publishSettings: typeof next === 'function' ? (next as any)(d.publishSettings) : next,
                }));
              }}
              onSave={() => saveDocument(false)}
            />
          </div>
        )}

        <div className={activeTab !== 'content' ? 'hidden' : ''}>
          {isPreviewMode ? (
            /* Whole-deck preview: every section, in order, exactly as the
               student viewer will render them. */
            <div className="max-w-3xl mx-auto space-y-12">
              {doc.slides.map((slide, index) => (
                <section key={slide.id} className={index > 0 ? 'pt-10 border-t border-slate-800' : ''}>
                  {doc.slides.length > 1 && (
                    <div className="mb-6 text-xs font-bold uppercase tracking-widest text-indigo-400">
                      Section {index + 1} of {doc.slides.length}
                    </div>
                  )}
                  <div className="space-y-6">{slide.blocks.map((b) => <div key={b.id}>{renderBlock(b, true)}</div>)}</div>
                </section>
              ))}
            </div>
          ) : (
            <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-6">
              {/* Section rail — the "slides" of the lesson. */}
              <aside className="md:w-56 shrink-0">
                <div className="md:sticky md:top-0">
                  <div className="flex items-center justify-between mb-3">
                    <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                      <Layers size={14} /> Sections
                    </span>
                    <span className="text-xs text-slate-500">{doc.slides.length}/{MAX_SLIDES}</span>
                  </div>

                  <div className="flex md:flex-col gap-2 overflow-x-auto md:overflow-visible pb-2 md:pb-0 custom-scrollbar">
                    {doc.slides.map((slide, index) => (
                      <div
                        key={slide.id}
                        className={`group flex items-center gap-2 rounded-xl border px-2.5 py-2 cursor-pointer transition-colors shrink-0 md:shrink ${
                          index === currentIndex
                            ? 'bg-indigo-500/15 border-indigo-500/50'
                            : 'bg-[#0f172a]/50 border-slate-800 hover:border-slate-700'
                        }`}
                        onClick={() => selectSlide(index)}
                      >
                        <span className={`text-[11px] font-bold w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                          index === currentIndex ? 'bg-indigo-500 text-white' : 'bg-slate-800 text-slate-400'
                        }`}>
                          {index + 1}
                        </span>
                        <span className="text-xs font-semibold text-slate-300 truncate max-w-[7rem] md:max-w-none md:flex-1">
                          {slideLabel(slide, index)}
                        </span>
                        <span className="hidden md:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {index > 0 && (
                            <button onClick={(e) => { e.stopPropagation(); moveSlide(index, 'up'); }} className="p-0.5 text-slate-500 hover:text-white rounded" title="Move up">
                              <ArrowUp size={12} />
                            </button>
                          )}
                          {index < doc.slides.length - 1 && (
                            <button onClick={(e) => { e.stopPropagation(); moveSlide(index, 'down'); }} className="p-0.5 text-slate-500 hover:text-white rounded" title="Move down">
                              <ArrowDown size={12} />
                            </button>
                          )}
                          <button onClick={(e) => { e.stopPropagation(); duplicateSlide(index); }} className="p-0.5 text-slate-500 hover:text-indigo-400 rounded" title="Duplicate section">
                            <Copy size={12} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); removeSlide(index); }} className="p-0.5 text-slate-500 hover:text-rose-400 rounded" title="Delete section">
                            <Trash2 size={12} />
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>

                  <button
                    onClick={addSlide}
                    disabled={doc.slides.length >= MAX_SLIDES}
                    className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-dashed border-slate-700 text-slate-400 hover:text-white hover:border-indigo-500 transition-colors text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus size={14} /> Add Section
                  </button>

                  {currentSlide && (
                    <div className="mt-4">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                        Section label
                      </label>
                      <input
                        type="text"
                        value={currentSlide.title}
                        onChange={(e) => updateSlide(currentSlide.id, (s) => ({ ...s, title: e.target.value }))}
                        placeholder={`Section ${currentIndex + 1}`}
                        className="w-full bg-[#020617] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                  )}
                </div>
              </aside>

              {/* Active section */}
              <div className="flex-1 min-w-0 max-w-3xl">
                {currentSlide ? (
                  <div className="space-y-6">
                    <AnimatePresence>
                      {currentSlide.blocks.map((block, index) => (
                        <motion.div
                          key={block.id}
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          draggable
                          onDragStart={(e: any) => handleDragStart(e, index)}
                          onDragOver={(e: any) => handleDragOver(e)}
                          onDrop={(e: any) => handleDrop(e, index)}
                          className="relative group rounded-2xl border border-slate-800/50 bg-[#0f172a]/50 p-5 transition-all"
                        >
                          {/* Drag Handle & Controls */}
                          <div className="absolute -left-12 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity hidden lg:flex flex-col gap-1">
                            <button onClick={() => moveBlock(index, 'up')} className="p-1 text-slate-500 hover:text-white rounded bg-slate-800/50" title="Move up"><ArrowUp size={14} /></button>
                            <div className="p-1 text-slate-500 cursor-grab active:cursor-grabbing"><GripVertical size={16} /></div>
                            <button onClick={() => moveBlock(index, 'down')} className="p-1 text-slate-500 hover:text-white rounded bg-slate-800/50" title="Move down"><ArrowDown size={14} /></button>
                          </div>

                          <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-2 text-xs font-medium text-slate-400 bg-slate-800/50 px-2 py-1 rounded">
                              {(() => {
                                const meta = BLOCK_TYPES.find((t) => t.type === block.type);
                                return meta ? React.createElement(meta.icon, { size: 14 }) : null;
                              })()}
                              {BLOCK_TYPES.find((t) => t.type === block.type)?.label || block.type}
                            </div>
                            {block.type !== 'title' && (
                              <button onClick={() => handleDeleteBlock(block.id)} className="text-slate-500 hover:text-rose-400 p-1 rounded-lg transition-colors" title="Delete block">
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>

                          {renderBlock(block, false)}
                        </motion.div>
                      ))}
                    </AnimatePresence>

                    {/* Add Block Menu */}
                    <div className="pt-6 relative">
                      {showAddMenu ? (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-[#0f172a] border border-slate-700 p-2 rounded-2xl shadow-xl w-full"
                        >
                          <div className="flex justify-between items-center px-3 py-2 mb-2 border-b border-slate-800">
                            <span className="text-sm font-bold text-slate-300">Add Block to {slideLabel(currentSlide, currentIndex)}</span>
                            <button onClick={() => setShowAddMenu(false)} className="text-slate-500 hover:text-white"><X size={16} /></button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                            {BLOCK_TYPES.filter((t) => t.type !== 'title' || !currentSlide.blocks.some((b) => b.type === 'title')).map((type) => (
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
                  </div>
                ) : (
                  <div className="text-center text-slate-500 py-20">This lesson has no sections.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
