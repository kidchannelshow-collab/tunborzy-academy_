import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Upload, FileText, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { useProfile } from '../../lib/useProfile';
import { nextMaterialOrderIndex } from '../../lib/materialOrder';

/**
 * Material upload / metadata editor for the Course Management hierarchy.
 *
 * Two modes:
 *   - create (no `material` prop): pick a file, validate it, upload the real
 *     bytes to the `tonborzy-content` bucket under a scoped path, then insert
 *     the matching `materials` metadata row.
 *   - edit   (`material` prop set): edit title / description / published state
 *     only. The stored file is never re-uploaded or rewritten.
 *
 * Everything shown here performs a real request; there are no placeholder
 * actions.
 */

const BUCKET = 'tonborzy-content';

// Supabase's default per-file cap is 50 MB. 25 MB keeps well inside the free
// plan and is plenty for lecture notes and past questions.
const MAX_SIZE_MB = 25;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

const ALLOWED_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
  'txt', 'md', 'csv', 'rtf',
  'png', 'jpg', 'jpeg', 'webp', 'gif',
  'zip',
];

export interface MaterialUploadModalProps {
  programme: string;
  semester?: string | null;
  courseCode: string;
  courseTitle?: string;
  topic: string;
  /** When provided, the modal edits this row instead of creating a new one. */
  material?: any | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Lowercase, hyphenated, safe for a storage path segment. */
function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'untitled';
}

function humanSize(bytes: number): string {
  if (!bytes) return 'Unknown';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function MaterialUploadModal({
  programme,
  semester,
  courseCode,
  courseTitle,
  topic,
  material = null,
  onClose,
  onSaved,
}: MaterialUploadModalProps) {
  const { profile } = useProfile();
  const isEdit = !!material;

  const [title, setTitle] = useState(material?.title || '');
  const [description, setDescription] = useState(material?.description || '');
  const [isPublished, setIsPublished] = useState(material ? !!material.is_published : true);
  const [file, setFile] = useState<File | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  /**
   * Programme / semester / subject / topic scoped path, e.g.
   *   undergraduate/first-semester/mathematics/calculus/1699...-a1b2.pdf
   *   post-utme/mathematics/algebra/1699...-c3d4.pdf
   */
  const buildStoragePath = (uploadName: string) => {
    const segments = [
      slugify(programme),
      semester ? slugify(semester) : null,
      slugify(courseCode),
      slugify(topic),
      uploadName,
    ].filter(Boolean) as string[];
    return segments.join('/');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;

    const ext = picked.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setError(`".${ext}" files are not allowed. Accepted: ${ALLOWED_EXTENSIONS.join(', ')}.`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    if (picked.size > MAX_SIZE_BYTES) {
      setError(`That file is ${humanSize(picked.size)}. The maximum allowed size is ${MAX_SIZE_MB} MB.`);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    setError('');
    setFile(picked);
    // Default the title to the filename so admins rarely have to type it.
    if (!title) setTitle(picked.name.replace(/\.[^.]+$/, ''));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || isSaving) return;

    setError('');

    if (!title.trim()) {
      setError('A title is required.');
      return;
    }
    if (!isEdit && !file) {
      setError('Choose a file to upload.');
      return;
    }

    setIsSaving(true);
    setProgress(5);
    setStage('Preparing…');

    try {
      let fileUrl = material?.file_url || '';
      let fileType = material?.file_type || 'file';
      let fileSize = material?.file_size || 'Unknown';

      if (!isEdit && file) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
        const uploadName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const storagePath = buildStoragePath(uploadName);

        setProgress(25);
        setStage('Uploading file to storage…');

        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(storagePath, file, { cacheControl: '3600', upsert: false });

        if (uploadError) {
          throw new Error(`Storage upload failed: ${uploadError.message}`);
        }

        setProgress(70);
        setStage('Reading public URL…');

        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
        if (!urlData?.publicUrl) {
          throw new Error('Upload succeeded but no public URL was returned.');
        }

        fileUrl = urlData.publicUrl;
        fileType = ext;
        fileSize = humanSize(file.size);
      }

      setProgress(85);
      setStage(isEdit ? 'Saving changes…' : 'Saving material record…');

      const payload: Record<string, any> = {
        title: title.trim(),
        description: description.trim(),
        file_url: fileUrl,
        file_type: fileType,
        file_size: fileSize,
        portal: programme,
        semester: semester || null,
        course_code: courseCode,
        topic,
        is_published: isPublished,
      };

      if (!isEdit) {
        // `materials.order_index` is a 32-bit `integer`. This used to be
        // `Date.now()` — about 1.79e12 — which is ~834× past the type's
        // 2,147,483,647 ceiling, so every new material was rejected with
        // `value "1791931546168" is out of range for type integer` and nothing
        // was ever written. The next free index is read from the table instead.
        payload.order_index = await nextMaterialOrderIndex(courseCode, topic);
        payload.lecturer_id = profile?.id || null;
        payload.lecturer_name = profile?.full_name || 'Admin';
      }

      if (isEdit && material?.id) {
        const { error: updateError } = await supabase
          .from('materials')
          .update(payload)
          .eq('id', material.id);
        if (updateError) throw new Error(`Could not save material: ${updateError.message}`);
      } else {
        const { error: insertError } = await supabase.from('materials').insert([payload]);
        if (insertError) throw new Error(`Could not save material: ${insertError.message}`);
      }

      setProgress(100);
      setStage('Done');
      onSaved();
    } catch (err: any) {
      // Surfaces the real reason instead of silently closing.
      setError(err?.message || 'Something went wrong while saving the material.');
      setProgress(0);
      setStage('');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-xl font-bold text-white">
            {isEdit ? 'Edit Material' : 'Upload Material'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white" disabled={isSaving}>
            <X size={20} />
          </button>
        </div>

        {/* Where this material will live */}
        <p className="text-xs font-mono text-slate-500 mb-5 break-all">
          {programme}
          {semester ? ` / ${semester}` : ''} / {courseCode} / {topic}
        </p>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-300">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEdit && (
            <div>
              <label className="block text-sm text-slate-400 mb-1">File</label>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                disabled={isSaving}
                className="w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-slate-800 file:text-white hover:file:bg-slate-700 disabled:opacity-50"
              />
              <p className="mt-1 text-xs text-slate-500">
                Max {MAX_SIZE_MB} MB. {ALLOWED_EXTENSIONS.join(', ')}.
              </p>
              {file && (
                <div className="mt-2 flex items-center gap-2 text-xs text-emerald-400">
                  <FileText size={14} />
                  {file.name} — {humanSize(file.size)}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-sm text-slate-400 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={isSaving}
              required
              className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isSaving}
              rows={3}
              className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">Visibility</label>
            <select
              value={isPublished ? 'published' : 'draft'}
              onChange={(e) => setIsPublished(e.target.value === 'published')}
              disabled={isSaving}
              className="w-full bg-[#020617] border border-slate-700 text-white rounded-xl px-4 py-2 disabled:opacity-50"
            >
              <option value="published">Published — visible to students</option>
              <option value="draft">Draft — hidden from students</option>
            </select>
          </div>

          {isSaving && (
            <div>
              <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-400">{stage}</p>
            </div>
          )}

          <div className="pt-2 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 py-3 px-4 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || (!isEdit && !file)}
              className="flex-1 py-3 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-slate-950 font-bold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isSaving ? (
                stage
              ) : (
                <>
                  {isEdit ? <CheckCircle2 size={16} /> : <Upload size={16} />}
                  {isEdit ? 'Save Changes' : 'Upload'}
                </>
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}
