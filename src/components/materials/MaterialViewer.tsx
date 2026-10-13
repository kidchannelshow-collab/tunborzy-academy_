import StudentLessonViewer from "./StudentLessonViewer";
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ZoomIn, ZoomOut, Maximize, Bookmark, Edit3, X, Save, ExternalLink, Link2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useProfile } from '../../lib/useProfile';

interface MaterialViewerProps {
  material: any;
  onClose: () => void;
}

export default function MaterialViewer({ material, onClose }: MaterialViewerProps) {
  const { profile } = useProfile();
  const [zoomLevel, setZoomLevel] = useState(100);
  const [isSaved, setIsSaved] = useState(false);
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if saved
    async function checkSaved() {
      if (!supabase || !profile) return;
      try {
        const { data } = await supabase
          .from('saved_materials')
          .select('id')
          .eq('material_id', material.id)
          .eq('user_id', profile.id)
          .single();
        if (data) setIsSaved(true);
      } catch(e) { console.error(e); }
    }
    
    // Load notes
    async function loadNotes() {
      if (!supabase || !profile) return;
      try {
        const { data } = await supabase
          .from('material_notes')
          .select('content')
          .eq('material_id', material.id)
          .eq('user_id', profile.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();
        if (data) setNotes(data.content);
      } catch(e) { console.error(e); }
    }

    checkSaved();
    loadNotes();
  }, [material.id, profile]);

  const toggleSave = async () => {
    if (!supabase || !profile) {
      setIsSaved(!isSaved);
      return;
    }
    try {
      if (isSaved) {
        await supabase.from('saved_materials').delete().eq('material_id', material.id).eq('user_id', profile.id);
        setIsSaved(false);
      } else {
        await supabase.from('saved_materials').insert({ material_id: material.id, user_id: profile.id });
        setIsSaved(true);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const saveNotes = async () => {
    if (!supabase || !profile) return;
    try {
      await supabase.from('material_notes').insert({
        material_id: material.id,
        user_id: profile.id,
        content: notes
      });
      setShowNotes(false);
    } catch (err) {
      console.error(err);
    }
  };

  

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      viewerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  /** `'#'` is the app's "no file" sentinel — see LessonEditor's file_url write. */
  const hasRealFile = !!material.file_url && material.file_url !== '#';

  /**
   * The card container every non-media preview shares.
   *
   * Same shape as the lesson editor's block cards — dark panel, rounded-3xl,
   * slate border — so a preview reads as one organised surface instead of a
   * bare panel. Reported as plain JSX rather than
   * `<PreviewCard/>`: a component defined during render is a new component type
   * on every pass, so React would remount its whole subtree each time.
   */
  const previewCard = (body: ReactNode, title?: string) => (
    <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-xl max-w-3xl mx-auto">
      {title && (
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-5">{title}</h3>
      )}
      {body}
    </div>
  );

  /** The "we hold this file but the browser cannot render it" card. */
  const fileHandoffCard = (label: string) =>
    previewCard(
      <div className="flex flex-col items-center text-center gap-5 py-6">
        <div className="w-20 h-20 rounded-2xl bg-slate-800/70 border border-slate-700 flex items-center justify-center text-3xl">
          📄
        </div>
        <div>
          <h3 className="text-xl font-bold text-white mb-1.5">{material.title}</h3>
          <p className="text-sm text-slate-400 max-w-md">
            {label} files open in their own viewer rather than in this panel.
          </p>
          <p className="text-xs text-slate-500 mt-3">
            {[material.subject, material.course_code, material.lecturer_name].filter(Boolean).join(' · ')}
          </p>
        </div>
        {hasRealFile ? (
          <a
            href={material.file_url}
            target="_blank"
            rel="noopener noreferrer"
            className="px-6 py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-sm flex items-center gap-2 transition-colors"
          >
            <ExternalLink size={16} /> Open {label}
          </a>
        ) : (
          <p className="text-xs text-slate-500">No file is attached to this material yet.</p>
        )}
      </div>,
      'Material preview',
    );

  /**
   * The preview body.
   *
   * Every branch renders real content where the browser can show it, and a
   * styled hand-off card where it cannot. This replaced a placeholder: the pdf
   * branch drew a fake white page of grey bars ("PDF Preview (Simulated for
   * Demo)"), and the ppt/doc/zip/link/image branch printed "cannot be viewed
   * directly in the browser" — including for `image`, which browsers render
   * perfectly well. A `video` material matched neither branch and rendered an
   * entirely blank panel.
   */
  const renderPreview = () => {
    const type = String(material.file_type || '').toLowerCase();

    if (type === 'pdf') {
      if (!hasRealFile) return fileHandoffCard('PDF');
      return (
        <div
          className="rounded-3xl overflow-hidden border border-slate-800 bg-white mx-auto transition-all duration-300 h-[70vh] w-full max-w-4xl"
          style={{ transform: `scale(${zoomLevel / 100})`, transformOrigin: 'top center' }}
        >
          <iframe src={material.file_url} title={material.title} className="w-full h-full" />
        </div>
      );
    }

    if (type === 'image') {
      if (!hasRealFile) return fileHandoffCard('Image');
      return previewCard(
        <img
          src={material.file_url}
          alt={material.title}
          className="w-full max-h-[70vh] object-contain rounded-2xl bg-[#020617] border border-slate-800"
        />,
        'Image',
      );
    }

    if (type === 'video') {
      if (!hasRealFile) return fileHandoffCard('Video');
      const isYouTube = material.file_url.includes('youtube.com') || material.file_url.includes('youtu.be');
      const isVimeo = material.file_url.includes('vimeo.com');
      return previewCard(
        <div className="aspect-video w-full rounded-2xl overflow-hidden border border-slate-800 bg-black">
          {isYouTube ? (
            <iframe
              src={`https://www.youtube.com/embed/${material.file_url.split('v=')[1]?.split('&')[0] || material.file_url.split('youtu.be/')[1]}`}
              title={material.title}
              className="w-full h-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : isVimeo ? (
            <iframe
              src={`https://player.vimeo.com/video/${material.file_url.split('/').pop()}`}
              title={material.title}
              className="w-full h-full"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
            />
          ) : (
            <video controls className="w-full h-full object-contain bg-black" src={material.file_url} />
          )}
        </div>,
        'Video',
      );
    }

    if (type === 'audio') {
      return previewCard(
        <div className="flex flex-col items-center text-center gap-6 py-4">
          <div className="w-24 h-24 bg-indigo-500/20 rounded-full flex items-center justify-center">
            <div className="w-16 h-16 bg-indigo-500 rounded-full animate-pulse" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white mb-1">{material.title}</h3>
            <p className="text-slate-400 text-sm">{material.lecturer_name || material.subject}</p>
          </div>
          {hasRealFile ? (
            <audio
              controlsList="noview"
              onContextMenu={(e) => e.preventDefault()}
              src={material.file_url}
              controls
              className="w-full custom-audio"
            />
          ) : (
            <p className="text-xs text-slate-500">No audio file is attached yet.</p>
          )}
        </div>,
        'Audio',
      );
    }

    if (type === 'link') {
      return previewCard(
        <div className="flex flex-col items-center text-center gap-5 py-6">
          <div className="w-16 h-16 rounded-2xl bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center text-cyan-400">
            <Link2 size={28} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white mb-1.5">{material.title}</h3>
            <p className="text-sm text-slate-400 break-all max-w-md">{material.file_url}</p>
          </div>
          {hasRealFile && (
            <a
              href={material.file_url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-6 py-3 rounded-2xl bg-amber-500 hover:bg-amber-400 text-amber-950 font-bold text-sm flex items-center gap-2 transition-colors"
            >
              <ExternalLink size={16} /> Open link
            </a>
          )}
        </div>,
        'External resource',
      );
    }

    // ppt / doc / zip / anything unrecognised — held, but not renderable here.
    return fileHandoffCard(type ? type.toUpperCase() : 'File');
  };


  if (material.file_type === 'lesson') {
    return <StudentLessonViewer material={material} onClose={onClose} />;
  }

  return (
    <motion.div
      key="material-viewer"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      ref={viewerRef}
      className="w-full h-[calc(100dvh-120px)] flex flex-col bg-[#0f172a]/95 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden z-50 fixed inset-0 m-4 sm:m-8 lg:m-12"
      style={isFullscreen ? { margin: 0, height: '100dvh', borderRadius: 0 } : {}}
    >
      {/* Viewer Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-[#020617]/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h3 className="text-white font-display font-bold text-sm sm:text-base truncate max-w-[200px] sm:max-w-md">
              {material.title}
            </h3>
            <p className="text-xs text-slate-400 font-body uppercase tracking-wider">{material.file_type} • {material.file_size}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4">
          {material.file_type === 'pdf' && (
            <div className="hidden sm:flex items-center gap-2 bg-slate-900 rounded-lg p-1 border border-slate-800">
              <button onClick={() => setZoomLevel(Math.max(50, zoomLevel - 25))} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"><ZoomOut size={16} /></button>
              <span className="text-xs font-mono text-slate-300 w-12 text-center">{zoomLevel}%</span>
              <button onClick={() => setZoomLevel(Math.min(200, zoomLevel + 25))} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition-colors"><ZoomIn size={16} /></button>
            </div>
          )}
          
          <button onClick={() => setShowNotes(!showNotes)} className={`p-2 rounded-lg transition-colors hidden sm:block ${showNotes ? 'bg-indigo-500/20 text-indigo-400' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`} title="Notes">
            <Edit3 size={18} />
          </button>
          
          <button onClick={toggleSave} className={`p-2 rounded-lg transition-colors hidden sm:block ${isSaved ? 'text-amber-500 bg-amber-500/10' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`} title="Save">
            <Bookmark size={18} fill={isSaved ? "currentColor" : "none"} />
          </button>
          
          <button onClick={toggleFullscreen} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors hidden sm:block">
            <Maximize size={18} />
          </button>
          
          
        </div>
      </div>
      
      {/* Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        <div className="flex-1 bg-[#020617] relative overflow-auto p-4 sm:p-6">
          {renderPreview()}
        </div>

        {/* Notes Panel */}
        <AnimatePresence>
          {showNotes && (
            <motion.div 
              initial={{ x: '100%' }} 
              animate={{ x: 0 }} 
              exit={{ x: '100%' }}
              className="w-80 bg-slate-900 border-l border-slate-800 flex flex-col absolute right-0 top-0 bottom-0 z-20 shadow-2xl"
            >
              <div className="p-4 border-b border-slate-800 flex items-center justify-between">
                <h4 className="text-white font-bold flex items-center gap-2"><Edit3 size={16} className="text-indigo-400"/> Personal Notes</h4>
                <button onClick={() => setShowNotes(false)} className="text-slate-400 hover:text-white"><X size={18}/></button>
              </div>
              <div className="flex-1 p-4">
                <textarea 
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Take notes while studying... These will be saved securely to your profile."
                  className="w-full h-full bg-slate-950 border border-slate-800 rounded-xl p-4 text-slate-300 focus:outline-none focus:border-indigo-500 resize-none"
                ></textarea>
              </div>
              <div className="p-4 border-t border-slate-800">
                <button 
                  onClick={saveNotes}
                  className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2.5 rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <Save size={16} /> Save Notes
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
