import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, ListPlus } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { nextMaterialOrderIndex } from '../../lib/materialOrder';
import { createBlock, createSlide, serializeLessonDocument, type LessonDoc } from '../../lib/lessonDocument';

interface BulkLessonModalProps {
  courseCode: string;
  topic: string;
  /**
   * `materials.portal` is NOT NULL and there is no default, so an insert without
   * it is rejected. Callers must supply the programme the lessons belong to, or
   * every bulk create fails.
   */
  portal: string;
  semester?: string | null;
  onClose: () => void;
  onSuccess: () => void;
}

export default function BulkLessonModal({ courseCode, topic, portal, semester, onClose, onSuccess }: BulkLessonModalProps) {
  const [titles, setTitles] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titles.trim() || !supabase) return;
    setIsSaving(true);
    setError('');

    try {
      /**
       * One title per line.
       *
       * The separator used to be the two-character literal `'\\n'` — a backslash
       * followed by an "n" — which never matches a real line break, so the whole
       * textarea collapsed into a single lesson with newlines in its title.
       * `/\r?\n/` matches what the textarea actually produces, on Windows too.
       */
      const lessonTitles = titles.split(/\r?\n/).map(t => t.trim()).filter(t => t.length > 0);

      // Written one at a time rather than as a single bulk insert: each lesson
      // needs the next order index in this topic, which is only known after the
      // previous row exists.
      for (const title of lessonTitles) {
        // A v2 document with a real title block. The old payload was
        // `{ blocks: [] }`, which parsed to a lesson with no title block at all —
        // so the editor opened it blank and the next save renamed the row to
        // "Untitled Lesson", discarding the title the author had just typed.
        const doc: LessonDoc = {
          version: 2,
          slides: [{ ...createSlide(), blocks: [createBlock('title', title), createBlock('main', '')] }],
          attachments: [],
          publishSettings: { status: 'Draft', publishAt: null, unpublishAt: null, isLocked: false, visibility: 'Public', isPremium: false, auditLogs: [] },
        };

        const { error: insertError } = await supabase.from('materials').insert([{
          title,
          course_code: courseCode,
          topic,
          portal,
          semester: semester || null,
          file_type: 'lesson',
          file_url: '#',
          is_published: false, // Start as Draft
          description: serializeLessonDocument(doc),
          order_index: await nextMaterialOrderIndex(courseCode, topic),
        }]);
        if (insertError) throw insertError;
      }

      onSuccess();
    } catch (err: any) {
      console.error(err);
      setError(err?.message || 'Failed to bulk create lessons.');
    }
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 w-full max-w-lg shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/20 text-indigo-400 rounded-xl">
              <ListPlus size={20} />
            </div>
            <h3 className="text-xl font-bold text-white">Bulk Create Lessons</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
        </div>
        <form onSubmit={handleSave} className="space-y-4">
          <div>
            <label className="block text-sm font-poppins text-slate-400 mb-2">
              Enter lesson titles (one per line):
            </label>
            <textarea 
              value={titles} 
              onChange={e => setTitles(e.target.value)} 
              className="w-full h-48 bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-3 font-mono text-sm leading-relaxed" 
              placeholder="e.g.&#10;Motion&#10;Velocity&#10;Acceleration&#10;Newton's Laws"
              required 
            />
          </div>
          {error && (
            <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</p>
          )}
          <div className="pt-4 flex gap-3">
            <button type="button" onClick={onClose} disabled={isSaving} className="flex-1 py-3 px-4 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors">Cancel</button>
            <button type="submit" disabled={isSaving} className="flex-1 py-3 px-4 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-bold transition-colors flex items-center justify-center gap-2">
              {isSaving ? 'Creating...' : 'Create Lessons'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
