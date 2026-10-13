import React, { useState, useEffect, useRef } from 'react';
import { motion, useScroll, useSpring, AnimatePresence } from 'motion/react';
import { 
  ArrowLeft, BookOpen, CheckCircle, Bookmark, Share2, 
  ChevronLeft, ChevronRight, Check, Copy, Maximize,
  List, X, Play, Music, Lock, Award, Sparkles
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { supabase } from '../../supabaseClient';
import CBTExamTaker from '../cbt/CBTExamTaker';
import CBTResultView from '../cbt/CBTResultView';

interface StudentLessonViewerProps {
  material: any;
  onClose: () => void;
  onNavigateToSibling?: (siblingId: string) => void;
  /**
   * Lets the caller keep its own lesson list in step when completion is toggled
   * here, without refetching. Optional: callers that do not render a list (the
   * admin review preview, say) simply omit it.
   */
  onProgressChange?: (materialId: string, completed: boolean) => void;
}

export default function StudentLessonViewer({ material, onClose, onNavigateToSibling, onProgressChange }: StudentLessonViewerProps) {
  const [blocks, setBlocks] = useState<any[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [publishSettings, setPublishSettings] = useState<any>(null);
  const [courseName, setCourseName] = useState(material.course_code);
  const [siblings, setSiblings] = useState<any[]>([]);
  
  const [isCompleted, setIsCompleted] = useState(false);
  const [progressSaving, setProgressSaving] = useState(false);
  const [progressError, setProgressError] = useState(false);
  const [isBookmarked, setIsBookmarked] = useState(false);
  const [bookmarkSaving, setBookmarkSaving] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [launchingCbt, setLaunchingCbt] = useState(false);
  const [cbtModalOpen, setCbtModalOpen] = useState(false);
  const [topicQuestionsCount, setTopicQuestionsCount] = useState<number | null>(null);
  const [cbtView, setCbtView] = useState<'exam' | 'result'>('exam');
  const [cbtAttemptId, setCbtAttemptId] = useState<string | null>(null);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState('');

  const handleSummarizeTopic = async () => {
    setSummaryModalOpen(true);
    setSummaryLoading(true);
    try {
      const rawText = blocks.map(b => b.content).join('\n');
      const res = await fetch('/api/summarize-lesson', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: material.title, content: rawText })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate summary');
      setAiSummary(data.summary);
    } catch (err: any) {
      console.error(err);
      setAiSummary('Error generating summary: ' + (err.message || 'Unknown error'));
    } finally {
      setSummaryLoading(false);
    }
  };

  // Scroll Progress
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ container: containerRef });
  const scaleX = useSpring(scrollYProgress, { stiffness: 100, damping: 30, restDelta: 0.001 });

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTo(0, 0);
    }
    // Reset completion the moment a different lesson is shown. The parent swaps
    // only the `material` prop and keeps this component mounted, so without this
    // the previous lesson's "Completed" leaked into the next one until the row
    // for the new lesson came back.
    setIsCompleted(false);
    setIsBookmarked(false);
    setProgressError(false);
    try {
      if (material.description) {
        const parsed = JSON.parse(material.description);
        if (Array.isArray(parsed)) {
          setBlocks(parsed);
        } else if (parsed && parsed.blocks) {
          setBlocks(parsed.blocks || []);
          setAttachments(parsed.attachments || []);
          setPublishSettings(parsed.publishSettings || null);
        } else {
          setBlocks([{ id: '1', type: 'main', content: material.description }]);
        }
      }
    } catch (e) {
      setBlocks([{ id: '1', type: 'main', content: material.description }]);
    }
    
    fetchContext();
    loadProgress();
    loadBookmark();
  }, [material]);

  /**
   * Read this user's saved-material flag for this lesson.
   *
   * The bookmark was local state only, so it lit up on click and was gone after
   * a reload — the same "looks saved, isn't" class as the completion bug this
   * file already fixed. `saved_materials` is the table the Resource Library
   * writes and reads (UNIQUE user_id + material_id + collection_name, with a
   * "Users manage own data saves" policy), so both surfaces now agree.
   */
  const loadBookmark = async () => {
    if (!supabase || !material?.id) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('saved_materials')
        .select('id')
        .eq('user_id', user.id)
        .eq('material_id', material.id)
        .maybeSingle();
      setIsBookmarked(!!data);
    } catch (e) {
      // Non-fatal: the lesson reads fine, it just shows as unsaved.
      console.error('[lesson bookmark] could not load saved state:', e);
    }
  };

  /**
   * Persist the bookmark toggle.
   *
   * Optimistic, then reverted on failure — a bookmark that silently vanishes on
   * reload is exactly the bug this replaces.
   */
  const toggleBookmark = async () => {
    const next = !isBookmarked;
    setIsBookmarked(next);

    if (!supabase || !material?.id) return;
    setBookmarkSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      if (next) {
        const { error } = await supabase
          .from('saved_materials')
          .insert({ user_id: user.id, material_id: material.id });
        // 23505 is the unique-constraint violation: the row is already there,
        // which is the state we wanted anyway.
        if (error && error.code !== '23505') throw error;
      } else {
        const { error } = await supabase
          .from('saved_materials')
          .delete()
          .eq('user_id', user.id)
          .eq('material_id', material.id);
        if (error) throw error;
      }
    } catch (e) {
      console.error('[lesson bookmark] could not save bookmark:', e);
      setIsBookmarked(!next);
    } finally {
      setBookmarkSaving(false);
    }
  };

  /**
   * Read this user's saved completion for this lesson.
   *
   * `material_progress` carries a UNIQUE(user_id, material_id) constraint and a
   * "Users manage own data progress" policy, so `user_id` here is the signed-in
   * auth id — the same value `profiles.id` holds.
   */
  const loadProgress = async () => {
    if (!supabase || !material?.id) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('material_progress')
        .select('is_completed')
        .eq('user_id', user.id)
        .eq('material_id', material.id)
        .maybeSingle();
      if (error) throw error;
      setIsCompleted(!!data?.is_completed);
    } catch (e) {
      // Not fatal: the lesson still reads fine, it just shows as not-completed.
      console.error('[lesson progress] could not load saved progress:', e);
    }
  };

  /**
   * Persist the completion toggle to the backend.
   *
   * Optimistic so the button responds instantly, then reverted with a visible
   * message if the write fails — a completion that silently vanishes on reload
   * is exactly the bug this replaces, so a failure must not look like success.
   */
  const toggleCompleted = async () => {
    const next = !isCompleted;
    setIsCompleted(next);
    setProgressError(false);

    if (!supabase || !material?.id) return;
    setProgressSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');

      const { error } = await supabase
        .from('material_progress')
        .upsert(
          {
            user_id: user.id,
            material_id: material.id,
            is_completed: next,
            progress_percent: next ? 100 : 0,
            last_accessed_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,material_id' }
        );
      if (error) throw error;
      onProgressChange?.(material.id, next);
    } catch (e) {
      console.error('[lesson progress] could not save progress:', e);
      setIsCompleted(!next);
      setProgressError(true);
    } finally {
      setProgressSaving(false);
    }
  };

  const fetchContext = async () => {
    if (!supabase) return;
    try {
      // Archived courses are excluded. If the course is archived this returns no
      // row, `.single()` reports PGRST116, and the destructure above ignores the
      // error — so courseData stays null and the heading simply omits the course
      // name rather than showing one for a retired course.
      const { data: courseData } = await supabase
        .from('courses')
        .select('title')
        .eq('course_code', material.course_code)
        .eq('is_archived', false)
        .single();
      if (courseData) setCourseName(courseData.title);

      const { data: sibs } = await supabase
        .from('materials')
        .select('id, title')
        .eq('course_code', material.course_code)
        .eq('topic', material.topic)
        .eq('file_type', 'lesson')
        .eq('is_published', true)
        .order('created_at', { ascending: true });
      if (sibs) setSiblings(sibs);

      // Check available CBT questions for this topic
      const { count } = await supabase
        .from('cbt_questions')
        .select('*', { count: 'exact', head: true })
        .eq('course_code', material.course_code);
      setTopicQuestionsCount(count || 0);
    } catch (e) {
      console.error(e);
    }
  };

  const currentIndex = siblings.findIndex(s => s.id === material.id);
  const prevLesson = currentIndex > 0 ? siblings[currentIndex - 1] : null;
  const nextLesson = currentIndex !== -1 && currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  // Estimate reading time: ~200 words per minute + 1 min per media block
  const getEstimatedTime = () => {
    let text = '';
    let mediaCount = 0;
    blocks.forEach(b => {
      if (b.type === 'image' || b.type === 'video' || b.type === 'audio' || b.type === 'diagram') {
        mediaCount++;
      } else if (b.content) {
        text += ' ' + b.content;
      }
    });
    const words = text.trim().split(/\s+/).length;
    const time = Math.ceil(words / 200) + mediaCount;
    return time || 1;
  };

  const navigateToSibling = (siblingId: string) => {
    // This viewer cannot replace its own `material` prop — that state belongs to
    // the parent — so it hands the sibling id back and lets the parent swap the
    // lesson in. Callers that do not supply the prop keep the previous no-op
    // behaviour.
    onNavigateToSibling?.(siblingId);
  };

  const renderBlock = (block: any) => {
    switch (block.type) {
      case 'title':
        return <h1 className="text-4xl md:text-5xl font-display font-bold text-white mb-8 leading-tight">{block.content}</h1>;
      case 'intro':
        return (
          // `lesson-content` carries the real typography (see index.css): it
          // restores the heading sizes, list markers and paragraph spacing that
          // Tailwind's preflight strips. The `prose` classes this file used
          // before were inert — the Tailwind typography plugin is not installed
          // — so saved formatting previously had no styling at all.
          <div className="text-xl md:text-2xl text-slate-200 font-body mb-10 border-l-4 border-sky-500 pl-6 py-3 bg-sky-500/5 rounded-r-2xl">
            <div className="lesson-content">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{block.content}</ReactMarkdown>
            </div>
          </div>
        );
      case 'main':
      case 'summary':
        return (
          // Same card container the editor shows around each block (dark panel,
          // rounded border), so the reading view is the preview the author saw
          // rather than an undifferentiated run of plain text.
          <div className="bg-[#0f172a]/50 border border-slate-800 rounded-3xl p-6 md:p-8 mb-8 shadow-lg">
            {/* `.lesson-content` sets typography but no colour or size, so these
                utilities stay in charge of the reading size and text colour. */}
            <div className="lesson-content text-lg text-slate-300 font-body">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{block.content}</ReactMarkdown>
            </div>
          </div>
        );
      case 'example':
        return (
          <div className="bg-[#0d1a33] border border-violet-500/25 rounded-3xl p-6 md:p-8 mb-10 shadow-lg">
            <h4 className="text-amber-400 font-bold uppercase tracking-widest text-sm mb-5 flex items-center gap-2">
              <BookOpen size={16} /> Worked Example
            </h4>
            <div className="lesson-content">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{block.content}</ReactMarkdown>
            </div>
          </div>
        );
      case 'formula':
        return (
          <div className="bg-violet-950/25 border border-violet-500/25 rounded-3xl p-6 mb-10 overflow-x-auto text-center flex items-center justify-center min-h-[100px]">
            <div className="text-xl md:text-2xl text-violet-100">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{block.content}</ReactMarkdown>
            </div>
          </div>
        );
      case 'image':
      case 'diagram':
        return block.fileUrl ? (
          <div className="mb-8">
            <div 
              className="relative rounded-2xl overflow-hidden bg-slate-900 border border-slate-800 cursor-zoom-in group"
              onClick={() => setLightboxImage(block.fileUrl)}
            >
              <img src={block.fileUrl} alt="Lesson illustration" className="w-full max-h-[600px] object-contain group-hover:scale-[1.01] transition-transform duration-500" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                <div className="opacity-0 group-hover:opacity-100 bg-slate-900/80 backdrop-blur text-white p-3 rounded-full shadow-xl transition-opacity transform scale-90 group-hover:scale-100 duration-300">
                  <Maximize size={24} />
                </div>
              </div>
            </div>
            {block.content && <p className="text-center text-sm text-slate-500 mt-3">{block.content}</p>}
          </div>
        ) : null;
      case 'audio':
        return block.fileUrl ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center gap-4 mb-8 shadow-lg">
            <div className="w-12 h-12 bg-indigo-500/20 rounded-full flex items-center justify-center shrink-0">
              <Music className="text-indigo-400" size={20} />
            </div>
            <div className="flex-1">
              {block.content && <p className="text-sm font-medium text-slate-300 mb-2">{block.content}</p>}
              <audio controls className="w-full outline-none h-10 custom-audio" src={block.fileUrl} />
            </div>
          </div>
        ) : null;
      case 'video':
        return (
          <div className="mb-8">
            {block.content && (block.content.includes('youtube.com') || block.content.includes('youtu.be')) ? (
              <div className="aspect-video w-full rounded-2xl overflow-hidden border border-slate-800 shadow-xl bg-slate-900">
                <iframe 
                  width="100%" height="100%" 
                  src={`https://www.youtube.com/embed/${block.content.split('v=')[1]?.split('&')[0] || block.content.split('youtu.be/')[1]}`} 
                  title="YouTube video player" frameBorder="0" 
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
                ></iframe>
              </div>
            ) : block.fileUrl ? (
              <div className="aspect-video w-full rounded-2xl overflow-hidden border border-slate-800 shadow-xl bg-slate-900">
                <video controls className="w-full h-full object-contain bg-black" src={block.fileUrl} />
              </div>
            ) : null}
            {block.fileUrl && block.content && !block.content.includes('youtube.com') && !block.content.includes('youtu.be') && (
              <p className="text-center text-sm text-slate-500 mt-3">{block.content}</p>
            )}
          </div>
        );
      case 'references':
        return (
          <div className="bg-[#0f172a]/50 border border-slate-800 rounded-3xl p-6 md:p-8 mb-8">
            <h4 className="text-slate-400 font-bold uppercase tracking-widest text-sm mb-4">References</h4>
            <div className="lesson-content text-sm text-slate-500">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{block.content}</ReactMarkdown>
            </div>
          </div>
        );
      default:
        return null;
    }
  };


  const isPremiumRequired = publishSettings?.isPremium;
  const isLocked = publishSettings?.isLocked;
  // Simulating the user doesn't have premium for demo purposes:
  const userHasPremium = false;

  if (isPremiumRequired && !userHasPremium) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-[#020617] flex flex-col items-center justify-center p-4">
        <div className="w-20 h-20 bg-amber-500/20 rounded-full flex items-center justify-center text-amber-500 mb-6">
          <BookOpen size={40} />
        </div>
        <h2 className="text-2xl font-bold text-white mb-3 text-center">Premium Access Required</h2>
        <p className="text-slate-400 text-center max-w-md mb-8">This content is available only to Undergraduate Premium members.</p>
        <button className="bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold px-8 py-3 rounded-xl transition-colors">
          Upgrade to Premium
        </button>
        <button onClick={onClose} className="mt-8 text-slate-500 hover:text-white transition-colors">Go Back</button>
      </motion.div>
    );
  }

  if (isLocked) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-[#020617] flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-500 to-amber-500"></div>
          <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center text-red-500 mx-auto mb-6">
            <Lock size={40} />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">{material.title}</h2>
          <p className="text-slate-400 mb-8">{blocks.find((b:any) => b.type === 'intro')?.content?.substring(0, 100)}...</p>
          <button disabled className="w-full bg-slate-800 text-slate-500 font-bold py-3 rounded-xl cursor-not-allowed flex items-center justify-center gap-2">
            <Lock size={18} /> Content Locked
          </button>
        </div>
        <button onClick={onClose} className="mt-8 text-slate-500 hover:text-white transition-colors">Go Back</button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="fixed inset-0 z-50 bg-[#0a1128] flex flex-col overflow-hidden"
    >
      {/* Progress Bar — yellow → light blue → purple, the platform palette */}
      <motion.div
        className="h-1 bg-gradient-to-r from-amber-400 via-sky-400 to-violet-500 origin-left z-50 fixed top-0 left-0 right-0"
        style={{ scaleX }}
      />

      {/* Header */}
      <header className="flex-shrink-0 bg-[#0d1a33]/85 backdrop-blur-xl border-b border-sky-500/15 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3 sm:gap-6 flex-1 min-w-0">
            <button onClick={onClose} className="p-2 -ml-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors shrink-0">
              <ArrowLeft size={20} />
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-400 truncate font-medium">
              <span className="hidden sm:inline hover:text-white cursor-pointer truncate" onClick={onClose}>{courseName}</span>
              <span className="hidden sm:inline text-slate-600">/</span>
              <span className="hover:text-white cursor-pointer truncate" onClick={onClose}>{material.topic}</span>
              <span className="text-slate-600">/</span>
              <span className="text-white font-bold truncate">{material.title}</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="hidden md:flex items-center gap-4 text-xs font-bold text-slate-500 uppercase tracking-widest mr-4">
              <button
                onClick={handleSummarizeTopic}
                className="px-3 py-1.5 rounded-xl bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-xs font-bold transition-all flex items-center gap-1.5 border border-amber-500/20"
              >
                <Sparkles size={14} /> Summarize Topic
              </button>
              <span className="flex items-center gap-1.5"><BookOpen size={14} /> {getEstimatedTime()} MIN READ</span>
            </div>
            <button
              onClick={toggleBookmark}
              disabled={bookmarkSaving}
              className={`p-2 rounded-xl transition-colors disabled:opacity-70 ${isBookmarked ? 'bg-amber-500/10 text-amber-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
              title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
            >
              <Bookmark size={18} fill={isBookmarked ? "currentColor" : "none"} />
            </button>
            <button onClick={handleCopyLink} className="p-2 rounded-xl text-slate-400 hover:bg-slate-800 hover:text-white transition-colors relative" title="Share">
              {linkCopied ? <Check size={18} className="text-emerald-400" /> : <Share2 size={18} />}
            </button>
          </div>
        </div>
      </header>

      {/* Summary Modal */}
      {summaryModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0f172a] border border-slate-800 rounded-3xl max-w-2xl w-full p-6 md:p-8 max-h-[85vh] flex flex-col shadow-2xl relative">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-6">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center text-amber-500">
                  <Sparkles size={18} />
                </div>
                <h3 className="text-xl font-display font-bold text-white">AI Revision Summary</h3>
              </div>
              <button onClick={() => setSummaryModalOpen(false)} className="text-slate-400 hover:text-white p-1.5 rounded-xl hover:bg-slate-800">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 mb-6">
              <h4 className="text-sm font-semibold text-amber-400 mb-3">{material.title}</h4>
              {summaryLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-4">
                  <div className="animate-spin w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full"></div>
                  <p className="text-slate-400 text-sm font-medium">Synthesizing topic revision summary...</p>
                </div>
              ) : (
                <div className="prose prose-invert prose-slate max-w-none text-slate-300 font-body leading-relaxed text-sm bg-slate-900/60 p-5 rounded-2xl border border-slate-800">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{aiSummary}</ReactMarkdown>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(aiSummary);
                  alert('Summary copied to clipboard!');
                }}
                disabled={summaryLoading}
                className="px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-bold transition-colors disabled:opacity-50"
              >
                Copy Summary
              </button>
              <button
                onClick={() => setSummaryModalOpen(false)}
                className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-sm font-bold transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto custom-scrollbar relative" ref={containerRef}>
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-12 md:py-20">
          
          <div className="mb-12">
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <span className="px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-bold uppercase tracking-widest border border-amber-500/20">{material.topic}</span>
              <span className="text-slate-400 text-sm font-medium">{getEstimatedTime()} min read</span>
            </div>
            {!blocks.find(b => b.type === 'title') && (
              <h1 className="text-4xl md:text-5xl font-display font-bold text-white mb-6 leading-tight">{material.title}</h1>
            )}
          </div>

          {/* Deliberately NOT `.lesson-content`: that class carries heading and
              body sizes for Markdown, and applying it here would override the
              explicit `text-4xl`/`text-5xl` on the title block. Each Markdown
              block applies it to its own content instead. */}
          <div>
            {blocks.map((block, i) => (
              <React.Fragment key={block.id || i}>
                {renderBlock(block)}
              </React.Fragment>
            ))}
          </div>


          {/* Lesson Materials / Attachments */}
          {attachments.length > 0 && (
            <div className="mt-16 pt-12 border-t border-slate-800">
              <h3 className="text-2xl font-display font-bold text-white mb-6">Lesson Materials</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                {attachments.filter(a => a.type !== 'video' && a.type !== 'audio').map((file) => (
                  <a 
                    key={file.id}
                    href={file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-4 bg-[#0d1a33] border border-sky-500/15 p-4 rounded-2xl hover:border-sky-500/50 hover:bg-[#13233f] transition-all group"
                  >
                    <div className="w-12 h-12 rounded-xl bg-[#0a1128] flex items-center justify-center text-sky-400 shrink-0">
                      <Bookmark size={20} className="group-hover:scale-110 transition-transform" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-white text-sm truncate">{file.name}</h4>
                      <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider">{file.category} • {file.type}</p>
                    </div>
                    <div className="text-slate-500 group-hover:text-white transition-colors p-2">
                      <Share2 size={16} />
                    </div>
                  </a>
                ))}
              </div>

              {/* Inline Media Render */}
              <div className="space-y-6">
                {attachments.filter(a => a.type === 'video' || a.type === 'audio').map((media) => (
                  <div key={media.id} className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-xl">
                    <h4 className="font-bold text-white mb-4 text-sm uppercase tracking-wider">{media.name} ({media.category})</h4>
                    {media.type === 'video' ? (
                       (media.url.includes('youtube.com') || media.url.includes('youtu.be')) ? (
                          <div className="aspect-video w-full rounded-xl overflow-hidden bg-black">
                            <iframe 
                              width="100%" height="100%" 
                              src={`https://www.youtube.com/embed/${media.url.split('v=')[1]?.split('&')[0] || media.url.split('youtu.be/')[1]}`} 
                              title="YouTube video" frameBorder="0" 
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen
                            ></iframe>
                          </div>
                       ) : (media.url.includes('vimeo.com')) ? (
                          <div className="aspect-video w-full rounded-xl overflow-hidden bg-black">
                            <iframe 
                              src={`https://player.vimeo.com/video/${media.url.split('/').pop()}`} 
                              width="100%" height="100%" frameBorder="0" 
                              allow="autoplay; fullscreen; picture-in-picture" allowFullScreen
                            ></iframe>
                          </div>
                       ) : (
                          <video controls className="w-full h-auto max-h-[500px] object-contain rounded-xl bg-black" src={media.url} />
                       )
                    ) : (
                      <audio controls className="w-full custom-audio outline-none" src={media.url} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ready to Practice Recommendation Card */}
          <div className="mt-16 p-8 rounded-3xl bg-gradient-to-br from-violet-950/40 via-[#0d1a33] to-[#0d1a33] border border-violet-500/20 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="space-y-2 text-center sm:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-bold uppercase tracking-wider">
                <Award size={14} /> CBT Practice Assessment
              </div>
              <h4 className="text-xl font-bold text-white">Ready to practice {material.topic}?</h4>
              <p className="text-slate-400 text-sm">
                Test your understanding of this topic with interactive practice questions for {material.course_code}.
              </p>
            </div>
            <div>
              {topicQuestionsCount !== null && topicQuestionsCount > 0 ? (
                <button
                  onClick={() => setCbtModalOpen(true)}
                  className="px-6 py-3.5 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-bold shadow-lg shadow-sky-600/20 transition-all flex items-center gap-2 whitespace-nowrap"
                >
                  Start CBT Drill
                </button>
              ) : (
                <p className="text-sm font-medium text-amber-400/90 bg-amber-500/10 px-4 py-3 rounded-xl border border-amber-500/20 text-center">
                  No CBT questions are available for this topic yet.
                </p>
              )}
            </div>
          </div>

          {/* Lesson Completion & Actions */}
          <div className="mt-24 pt-12 border-t border-slate-800">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="w-full sm:w-auto">
                <button
                  onClick={toggleCompleted}
                  disabled={progressSaving}
                  className={`flex items-center gap-3 px-8 py-4 rounded-2xl font-bold transition-all w-full justify-center disabled:opacity-70 ${isCompleted ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.1)]' : 'bg-sky-600 hover:bg-sky-500 text-white shadow-xl hover:shadow-sky-500/20'}`}
                >
                  {isCompleted ? <CheckCircle size={20} className="fill-emerald-400 text-emerald-950" /> : <CheckCircle size={20} />}
                  {isCompleted ? 'Completed' : 'Mark as Completed'}
                </button>
                {progressError && (
                  <p className="mt-2 text-xs text-rose-400 text-center sm:text-left">
                    Could not save your progress. Please check your connection and try again.
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button
                  onClick={() => prevLesson && navigateToSibling(prevLesson.id)}
                  disabled={!prevLesson}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-bold bg-[#0d1a33] border border-sky-500/20 text-slate-300 hover:bg-[#13233f] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={18} /> Prev
                </button>
                <button
                  onClick={() => nextLesson && navigateToSibling(nextLesson.id)}
                  disabled={!nextLesson}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-6 py-4 rounded-2xl font-bold bg-[#0d1a33] border border-sky-500/20 text-slate-300 hover:bg-[#13233f] hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight size={18} />
                </button>
              </div>
            </div>
            
            <div className="mt-8 text-center sm:text-left">
              <button onClick={onClose} className="text-slate-500 hover:text-white text-sm font-medium transition-colors">
                ← Back to {courseName}
              </button>
            </div>
          </div>
          
        </div>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxImage && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/95 backdrop-blur flex items-center justify-center p-4 sm:p-12 cursor-zoom-out"
            onClick={() => setLightboxImage(null)}
          >
            <button className="absolute top-6 right-6 p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-full transition-colors">
              <X size={24} />
            </button>
            <img 
              src={lightboxImage} 
              alt="Expanded view" 
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" 
            />
          </motion.div>
        )}

        {cbtModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[120] bg-black/95 backdrop-blur flex flex-col p-4 sm:p-8"
          >
            <div className="flex items-center justify-between pb-4 border-b border-slate-800">
              <div>
                <h3 className="text-xl font-bold text-white">CBT Drill: {material.course_code} - {material.topic}</h3>
                <p className="text-sm text-slate-400">Interactive topic-based assessment</p>
              </div>
              <button 
                onClick={() => {
                  setCbtModalOpen(false);
                  setCbtView('exam');
                  setCbtAttemptId(null);
                }}
                className="p-2 bg-slate-800 hover:bg-slate-700 text-white rounded-full transition-colors"
              >
                <X size={24} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto pt-6">
              {cbtView === 'exam' ? (
                <CBTExamTaker 
                  examId="custom-exam-id"
                  attemptId="custom-attempt-id"
                  customConfig={{
                    backendDrill: true,
                    courseCode: material.course_code,
                    mode: 'topic',
                    topics: [material.topic],
                    // `limit` is the key POST /api/cbt/start actually reads; this
                    // was sent as `count`, which the server ignores, so the drill
                    // silently ran with the server's default length instead of 10.
                    limit: 10,
                    timed: true,
                    time: 15
                  }}
                  onFinish={(attemptId: string) => {
                    setCbtAttemptId(attemptId);
                    setCbtView('result');
                  }}
                  onCancel={() => {
                    setCbtModalOpen(false);
                    setCbtView('exam');
                    setCbtAttemptId(null);
                  }}
                />
              ) : (
                <CBTResultView 
                  attemptId={cbtAttemptId} 
                  onReview={() => {}}
                  onBackToDashboard={() => {
                    setCbtModalOpen(false);
                    setCbtView('exam');
                    setCbtAttemptId(null);
                  }}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
