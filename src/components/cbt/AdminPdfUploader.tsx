import React, { useState, useRef, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { POST_UTME_UNIVERSITY_CODE } from '../../lib/postUtme';
import { FIRST_SEMESTER_COURSES, SECOND_SEMESTER_COURSES } from './CBTUndergraduateDrilling';
import { 
  Sparkles, Trash2, Edit2, CheckCircle2, AlertCircle, Save, Check, 
  RefreshCw, ChevronLeft, ChevronRight, Upload, FileText, X, File, Layers, CheckSquare, Square, Award
} from 'lucide-react';

interface QuestionItem {
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_option: string;
  explanation: string;
  topic: string;
  difficulty: string;
  marks: number;
  page_number?: number;
  approved: boolean;
  /** True when the PDF carried no answer key for this question. */
  needs_review?: boolean;
  /** True when the explanation stage could not write a usable explanation. */
  explanation_needs_review?: boolean;
  /** Admin-facing reason for the review flag. Never saved as question content. */
  review_note?: string;
}

/**
 * Comparison key for the duplicate guard: strips case, spacing and punctuation
 * so the same question re-imported (or one with reflowed whitespace) is
 * recognised as already present. Only the key is normalised — stored text is
 * never rewritten.
 */
function normaliseQuestionText(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

interface AdminPdfUploaderProps {
  /**
   * Which bank the extracted questions are saved into. Defaults to `'UTME'`, so
   * the UTME Manager's existing usage is unchanged.
   *
   * Typed as plain `string` internally rather than a union so the existing
   * `destType === 'Undergraduate'` branches below still type-check without being
   * rewritten; they are simply unreachable, because no caller passes them.
   */
  destType?: 'UTME' | 'Post-UTME' | 'Undergraduate';
}

/**
 * Largest file the importer will accept.
 *
 * Vercel caps a serverless request body at roughly 4.5 MB and rejects anything
 * larger at the platform layer, before any handler runs. The UI previously
 * imposed no limit at all and actively invited "large past question papers", so
 * an oversized upload failed with no usable explanation.
 *
 * Checking here converts that into a clear, actionable message. Raise it only
 * alongside a deployment change that lifts the platform limit.
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export default function AdminPdfUploader({ destType = 'UTME' }: AdminPdfUploaderProps) {
  // Widened to `string` so the dormant 'Undergraduate' comparisons below still
  // type-check against the prop's narrower union — see the prop's doc comment.
  const dest: string = destType;
  const [file, setFile] = useState<File | null>(null);
  const [numQuestions, setNumQuestions] = useState<number>(50);
  const [difficulty, setDifficulty] = useState<string>('medium');
  // For UTME this is the subject *name*; for Post-UTME it is the chosen course's
  // `course_code`, which is the key the rest of the Post-UTME system uses
  // (materials hang off it, and so does `post_utme_exams.course_code`).
  const [selectedSubject, setSelectedSubject] = useState<string>('PHY 102');

  // Dynamic courses/subjects list. Options carry a separate label because a
  // Post-UTME course reads better as "PHY 102 — Physics" than as a bare code.
  const [availableSubjects, setAvailableSubjects] = useState<{ value: string; label: string }[]>([
    { value: 'PHY 102', label: 'PHY 102' },
  ]);

  // Post-UTME only: the topic (a `course_modules` row) the questions belong to.
  const [postUtmeTopics, setPostUtmeTopics] = useState<{ id: string; title: string }[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<string>('');

  // Undergraduate only: which semester's course list is offered. Semesters are
  // separated by course code (CHM 101 vs CHM 102) — `cbt_exams` has no semester
  // column — so picking the semester decides which codes can be chosen.
  const [ugSemester, setUgSemester] = useState<'First Semester' | 'Second Semester'>(
    'First Semester',
  );

  /**
   * Questions already written to the Post-UTME bank during this session, keyed
   * by normalised text. Prevents the immediate-persist pass and the Save button
   * from inserting the same question twice.
   */
  const [persistedKeys, setPersistedKeys] = useState<Set<string>>(new Set());
  
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  // Optional AI explanation stage. ON by default, and opt-out is per-import so a
  // quota-limited day can still extract questions without spending API calls.
  const [generateExplanations, setGenerateExplanations] = useState<boolean>(true);
  const [explaining, setExplaining] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successMsg, setSuccessMsg] = useState<string>('');

  const [questions, setQuestions] = useState<QuestionItem[]>([]);
  
  // Pagination (10 questions per page)
  const [currentPage, setCurrentPage] = useState<number>(1);
  const pageSize = 10;

  // Editing state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<QuestionItem | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch subjects/courses from Supabase based on the destination bank
  useEffect(() => {
    async function fetchSubjects() {
      try {
        if (dest === 'Undergraduate') {
          // The course list is the SAME definition the student CBT picker uses
          // (`CBTUndergraduateDrilling`), imported rather than copied, so a paper
          // can only ever be filed under a course a student can actually choose.
          // Previously this read distinct `cbt_exams.course_code` values and fell
          // back to a hardcoded list, which could invent a course that exists
          // nowhere in the CBT.
          const list =
            ugSemester === 'First Semester' ? FIRST_SEMESTER_COURSES : SECOND_SEMESTER_COURSES;
          setAvailableSubjects(
            list.map((c) => ({ value: c.code, label: `${c.code} — ${c.title}` })),
          );
          setSelectedSubject(list[0]?.code ?? '');
        } else if (dest === 'UTME') {
          const { data } = await supabase.from('utme_subjects').select('name').eq('is_active', true);
          if (data && data.length > 0) {
            const unique = Array.from(new Set(data.map(d => d.name).filter(Boolean))) as string[];
            if (unique.length > 0) {
              setAvailableSubjects(unique.map(v => ({ value: v, label: v })));
              setSelectedSubject(unique[0]);
              return;
            }
          }
          const fallbackUtme = ['Mathematics', 'Use of English', 'Physics', 'Chemistry', 'Biology', 'Economics', 'Government'];
          setAvailableSubjects(fallbackUtme.map(v => ({ value: v, label: v })));
          setSelectedSubject('Mathematics');
        } else {
          // Post-UTME. The target course must be one of the real Post-UTME
          // courses (`courses.portal = 'Post-UTME'`) — the old behaviour read
          // whatever subject strings happened to sit on existing exam rows and
          // fell back to a hardcoded list, which could file questions under a
          // course that does not exist. There is deliberately no hardcoded
          // fallback here: if the programme has no courses yet, the selector is
          // empty and the UI says so.
          const { data } = await supabase
            .from('courses')
            .select('id, course_code, title')
            .eq('portal', 'Post-UTME')
            .order('order_index', { ascending: true })
            .order('title', { ascending: true });

          const options = (data || [])
            .filter((c: any) => !!c.course_code)
            .map((c: any) => ({
              value: c.course_code as string,
              label: c.title ? `${c.course_code} — ${c.title}` : (c.course_code as string),
            }));

          setAvailableSubjects(options);
          setSelectedSubject(options[0]?.value ?? '');
        }
      } catch (err) {
        console.error('Error fetching subjects:', err);
      }
    }
    fetchSubjects();
  }, [dest, ugSemester]);

  /**
   * Post-UTME topics for the chosen course. Reloaded whenever the course
   * changes so the topic list can never point at another course's modules.
   */
  useEffect(() => {
    if (dest !== 'Post-UTME') {
      setPostUtmeTopics([]);
      setSelectedTopic('');
      return;
    }
    let cancelled = false;

    (async () => {
      if (!selectedSubject) {
        setPostUtmeTopics([]);
        setSelectedTopic('');
        return;
      }
      const { data: course } = await supabase
        .from('courses')
        .select('id')
        .eq('portal', 'Post-UTME')
        .eq('course_code', selectedSubject)
        .limit(1)
        .maybeSingle();

      if (!course?.id) {
        if (!cancelled) {
          setPostUtmeTopics([]);
          setSelectedTopic('');
        }
        return;
      }

      const { data: modules } = await supabase
        .from('course_modules')
        .select('id, title, is_archived')
        .eq('course_id', course.id)
        .order('order_index', { ascending: true });

      if (cancelled) return;
      const active = (modules || []).filter((m: any) => m.is_archived !== true);
      setPostUtmeTopics(active);
      setSelectedTopic((prev) =>
        active.some((m: any) => m.title === prev) ? prev : (active[0]?.title ?? ''),
      );
    })();

    return () => { cancelled = true; };
  }, [dest, selectedSubject]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      if (selected.type !== 'application/pdf' && !selected.name.endsWith('.pdf') && !selected.name.endsWith('.txt')) {
        setErrorMsg('Please select a valid PDF or text file.');
        return;
      }
      if (selected.size > MAX_UPLOAD_BYTES) {
        setErrorMsg(
          `This file is ${(selected.size / (1024 * 1024)).toFixed(1)} MB. The upload limit is ` +
            `${MAX_UPLOAD_BYTES / (1024 * 1024)} MB per import — please split the document and import it in parts.`
        );
        return;
      }
      setFile(selected);
      setErrorMsg('');
      setSuccessMsg('');
    }
  };

  const removeFile = () => {
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  /**
   * The Post-UTME paper for a course — the "import batch" the question bank
   * groups by. Resolved by `course_code`, created on first use.
   *
   * `post_utme_exams.university` is pinned to the programme's single university.
   */
  const resolvePostUtmeExamId = async (): Promise<string> => {
    const { data: existing } = await supabase
      .from('post_utme_exams')
      .select('id')
      .eq('course_code', selectedSubject)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (existing?.id) return existing.id;

    const label = availableSubjects.find(o => o.value === selectedSubject)?.label || selectedSubject;
    const { data: created, error } = await supabase
      .from('post_utme_exams')
      .insert({
        title: `${label} Post-UTME`,
        // `subject` is NOT NULL; the course code is the stable identifier here.
        subject: selectedSubject,
        course_code: selectedSubject,
        university: POST_UTME_UNIVERSITY_CODE,
        year: String(new Date().getFullYear()),
        duration_minutes: 60,
        is_published: true,
        created_by: (await supabase.auth.getUser()).data?.user?.id,
      })
      .select('id')
      .single();

    if (error) throw error;
    return created.id;
  };

  /**
   * Writes extracted questions straight into the Post-UTME bank, so a successful
   * extraction survives a refresh instead of living only in component state.
   *
   * Two deliberate rules:
   *   - A question with no answer key is NOT written. `post_utme_questions.
   *     correct_option` is NOT NULL, so persisting one would mean inventing an
   *     answer — which would then mark students wrong against it.
   *   - Anything already in this paper is skipped, so re-importing the same PDF
   *     is a no-op rather than a duplicate.
   */
  const persistExtractedQuestions = async (
    items: QuestionItem[],
  ): Promise<{ inserted: number; skipped: number; heldBack: number; fresh: QuestionItem[] }> => {
    const examId = await resolvePostUtmeExamId();

    const { data: existingRows } = await supabase
      .from('post_utme_questions')
      .select('question_text')
      .eq('exam_id', examId);

    const seen = new Set<string>([
      ...(existingRows || []).map((r: any) => normaliseQuestionText(r.question_text)),
      ...persistedKeys,
    ]);

    const answered = items.filter(q => !!q.correct_option);
    const heldBack = items.length - answered.length;

    const fresh = answered.filter(q => {
      const key = normaliseQuestionText(q.question_text);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (fresh.length > 0) {
      const payload = fresh.map(q => ({
        exam_id: examId,
        course_code: selectedSubject,
        question_text: q.question_text,
        option_a: q.option_a,
        option_b: q.option_b,
        option_c: q.option_c,
        option_d: q.option_d,
        correct_option: q.correct_option,
        explanation: q.explanation || '',
        marks: q.marks || 1,
        topic: selectedTopic || q.topic || 'General',
        difficulty: q.difficulty || difficulty,
      }));

      const { error } = await supabase.from('post_utme_questions').insert(payload);
      if (error) throw error;
    }

    // Remember what this session wrote so the Save button does not re-insert it.
    setPersistedKeys(prev => {
      const next = new Set(prev);
      fresh.forEach(q => next.add(normaliseQuestionText(q.question_text)));
      return next;
    });

    return { inserted: fresh.length, skipped: answered.length - fresh.length, heldBack, fresh };
  };

  const handleGenerate = async () => {
    if (!file) {
      setErrorMsg('Please upload a PDF file first.');
      return;
    }
    if (!selectedSubject) {
      setErrorMsg('Please select a target course or subject.');
      return;
    }
    // Post-UTME questions are always filed under a real course topic, so the
    // topic is required rather than letting them default to a bare "General".
    if (dest === 'Post-UTME' && !selectedTopic) {
      setErrorMsg('Please select a target topic for this Post-UTME course.');
      return;
    }

    setLoading(true);
    setStatusMsg(
      generateExplanations
        ? 'Extracting text and questions locally, then generating explanations...'
        : 'Extracting text and questions locally (no AI calls)...'
    );
    setErrorMsg('');
    setSuccessMsg('');
    setQuestions([]);
    setCurrentPage(1);

    try {
      const formData = new FormData();
      formData.append('pdfFile', file);
      formData.append('numQuestions', numQuestions.toString());
      formData.append('difficulty', difficulty);
      formData.append('subject', selectedSubject);
      formData.append('generateExplanations', generateExplanations ? 'true' : 'false');

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      console.log('[CBT API DEBUG] Sending parse-pdf request to /api/cbt/parse-pdf', {
        fileName: file.name,
        fileSize: file.size,
        numQuestions,
        difficulty,
        subject: selectedSubject,
        hasToken: !!token
      });

      let res: Response;
      try {
        res = await fetch('/api/cbt/parse-pdf', {
          method: 'POST',
          headers: {
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: formData
        });
      } catch (fetchErr: any) {
        console.error('[CBT API Error] Network fetch failed:', fetchErr);
        throw new Error('Network Error: Could not connect to the backend API server ("Failed to fetch"). Please ensure the Express server is running.');
      }

      let result: any = {};
      const contentType = res.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        result = await res.json();
      } else {
        const textResp = await res.text();
        throw new Error(`Server returned non-JSON response (${res.status}): ${textResp.substring(0, 100)}`);
      }

      if (!res.ok) {
        if (res.status === 429 || result.code === 'GEMINI_QUOTA_EXCEEDED') {
          throw new Error('Gemini API quota exceeded. Please try again later.');
        } else {
          throw new Error(result.error || `Failed with status ${res.status}`);
        }
      }

      const generated: QuestionItem[] = (result.questions || []).map((q: any, idx: number) => ({
        ...q,
        page_number: q.page_number || Math.floor(idx / 5) + 1,
        // The server decides what is pre-approved: a question with no answer key
        // arrives unselected so it is reviewed rather than saved with a guessed
        // answer. Only an absent flag falls back to the old auto-approve.
        approved: typeof q.approved === 'boolean' ? q.approved : true,
      }));

      setQuestions(generated);

      const missingExplanation = generated.filter((q) => q.explanation_needs_review && q.correct_option).length;
      const missingAnswer = generated.filter((q) => !q.correct_option).length;

      // Post-UTME: write the extraction to the bank now, so it is already saved
      // by the time the preview renders and a refresh cannot lose it. UTME keeps
      // its existing review-then-save flow, which is not being changed.
      let savedNote = '';
      if (dest === 'Post-UTME' && generated.length > 0) {
        try {
          const { inserted, skipped, heldBack } = await persistExtractedQuestions(generated);
          savedNote =
            ` Saved ${inserted} to the Post-UTME question bank.` +
            (skipped > 0 ? ` ${skipped} already present and skipped.` : '') +
            (heldBack > 0 ? ` ${heldBack} held back — no answer key yet.` : '');
        } catch (persistErr: any) {
          // Extraction succeeded; only the auto-save failed. Say so plainly
          // rather than letting the questions look saved when they are not.
          savedNote = ` Could not auto-save to the question bank: ${persistErr?.message || 'unknown error'}. Use Save to retry.`;
        }
      }

      setStatusMsg(
        `Successfully extracted ${generated.length} questions for review.` +
        (missingExplanation > 0 ? ` ${missingExplanation} need an explanation.` : '') +
        (missingAnswer > 0 ? ` ${missingAnswer} have no answer key yet.` : '') +
        savedNote
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during AI extraction.');
    } finally {
      setLoading(false);
    }
  };

  const toggleApproveAllCurrentPage = (approve: boolean) => {
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, questions.length);
    const updated = [...questions];
    for (let i = startIndex; i < endIndex; i++) {
      updated[i].approved = approve;
    }
    setQuestions(updated);
  };

  const toggleApproveAll = (approve: boolean) => {
    setQuestions(questions.map(q => ({ ...q, approved: approve })));
  };

  const toggleApprove = (globalIndex: number) => {
    const updated = [...questions];
    updated[globalIndex].approved = !updated[globalIndex].approved;
    setQuestions(updated);
  };

  const removeQuestion = (globalIndex: number) => {
    setQuestions(questions.filter((_, i) => i !== globalIndex));
    if (editingIndex === globalIndex) {
      setEditingIndex(null);
      setEditForm(null);
    }
  };

  const startEdit = (globalIndex: number) => {
    setEditingIndex(globalIndex);
    setEditForm({ ...questions[globalIndex] });
  };

  const saveEdit = () => {
    if (editingIndex !== null && editForm) {
      const updated = [...questions];
      updated[editingIndex] = {
        ...editForm,
        // A manually written explanation clears the review flag: the flag tracks
        // missing content, not who wrote it.
        explanation_needs_review: editForm.explanation ? false : editForm.explanation_needs_review,
        // Supplying the missing answer key makes the question answerable, so it
        // becomes selectable for save — and eligible for explanation generation.
        needs_review: editForm.correct_option ? false : editForm.needs_review,
        approved: editForm.correct_option ? true : editForm.approved,
      };
      setQuestions(updated);
      setEditingIndex(null);
      setEditForm(null);
    }
  };

  // Explainable right now: has an answer key, but no usable explanation. A
  // question with no answer is deliberately excluded — there is nothing to
  // explain yet, and generating one would mean inventing the answer.
  const explainableCount = questions.filter(
    (q) => q.correct_option && (!q.explanation || q.explanation_needs_review)
  ).length;

  const handleGenerateExplanations = async () => {
    const targets = questions
      .map((q, index) => ({ q, index }))
      .filter(({ q }) => q.correct_option && (!q.explanation || q.explanation_needs_review));

    if (targets.length === 0) {
      setErrorMsg('Every extracted question that has an answer already has an explanation.');
      return;
    }

    setExplaining(true);
    setErrorMsg('');
    setSuccessMsg('');
    setStatusMsg(`Generating explanations for ${targets.length} question(s)...`);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Authentication required. Please sign in as an administrator.');

      const res = await fetch('/api/cbt/generate-explanations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          questions: targets.map(({ q }) => ({
            question_text: q.question_text,
            option_a: q.option_a,
            option_b: q.option_b,
            option_c: q.option_c,
            option_d: q.option_d,
            correct_option: q.correct_option,
          })),
        }),
      });

      // Content-type is checked before parsing, for the same reason the import
      // call checks it. `res.json().catch(() => ({}))` silently swallowed an HTML
      // or plain-text error page into an empty object, so a backend that never
      // answered was reported to the admin as "0 explanations generated" rather
      // than as a failure.
      const contentType = res.headers.get('content-type');
      let result: any = {};
      if (contentType && contentType.includes('application/json')) {
        result = await res.json();
      } else if (!res.ok) {
        const textResp = await res.text();
        throw new Error(
          `Explanation request returned a non-JSON response (${res.status}): ${textResp.substring(0, 100)}`
        );
      }
      if (!res.ok) {
        throw new Error(result.error || `Explanation request failed with status ${res.status}`);
      }

      // Merge by index. Questions whose explanation could not be written keep
      // their place in the preview and stay flagged — nothing is removed.
      const updated = [...questions];
      let applied = 0;
      (result.explanations || []).forEach((r: any) => {
        const target = targets[r.index];
        if (!target) return;
        updated[target.index] = {
          ...updated[target.index],
          explanation: r.explanation || updated[target.index].explanation,
          explanation_needs_review: !!r.needs_review,
          review_note: r.review_note || '',
        };
        if (r.explanation) applied += 1;
      });

      setQuestions(updated);
      setStatusMsg(
        `Explanations generated: ${applied}/${targets.length}` +
        (applied < targets.length ? ` — ${targets.length - applied} still need review.` : '.')
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to generate explanations.');
    } finally {
      setExplaining(false);
    }
  };

  const handleSaveToDatabase = async () => {
    const approvedQuestions = questions.filter(q => q.approved);
    if (approvedQuestions.length === 0) {
      setErrorMsg('Please select and approve at least one question before saving.');
      return;
    }
    if (!selectedSubject) {
      setErrorMsg('Please select a destination course or subject.');
      return;
    }
    if (dest === 'Post-UTME' && !selectedTopic) {
      setErrorMsg('Please select a target topic for this Post-UTME course.');
      return;
    }

    // Declared here rather than inside the UTME branch so the success message
    // below can report them. `freshQuestions` defaults to the approved set, so
    // the (now unreachable) non-UTME branches still behave as before.
    let freshQuestions = approvedQuestions;
    let skipped = 0;
    // Selected questions with no answer key. Held back rather than saved: the
    // payload used to fall back to `correct_option: 'A'`, which silently marked
    // an arbitrary option as correct and would mark students wrong against it.
    let unanswered = 0;

    setSaving(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('Authentication required. Please sign in as an administrator or lecturer.');

      if (dest === 'Undergraduate') {
        let { data: examData } = await supabase
          .from('cbt_exams')
          .select('id, is_published')
          .eq('course_code', selectedSubject)
          .limit(1)
          .maybeSingle();

        let examId = examData?.id;

        if (examId) {
          if (!examData.is_published) {
            await supabase.from('cbt_exams').update({ is_published: true }).eq('id', examId);
          }
        } else {
          const { data: newExam, error: examErr } = await supabase
            .from('cbt_exams')
            .insert({
              title: `${selectedSubject} CBT Practice`,
              course_code: selectedSubject,
              subject: selectedSubject,
              portal: 'Undergraduate',
              duration_minutes: 60,
              total_questions: approvedQuestions.length,
              is_published: true
            })
            .select()
            .single();
          if (examErr) throw examErr;
          examId = newExam.id;
        }

        // Same duplicate guard and answer-key rule as the UTME and Post-UTME
        // branches: re-importing a paper must not double up, and a question with
        // no answer key is held back rather than saved with a guessed 'A' that
        // would mark students wrong against it.
        const { data: existingRows } = await supabase
          .from('cbt_questions')
          .select('question_text')
          .eq('exam_id', examId);

        const answered = approvedQuestions.filter((q) => !!q.correct_option);
        unanswered = approvedQuestions.length - answered.length;

        const seen = new Set((existingRows || []).map((r: any) => normaliseQuestionText(r.question_text)));
        freshQuestions = answered.filter((q) => {
          const key = normaliseQuestionText(q.question_text);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        skipped = answered.length - freshQuestions.length;

        if (freshQuestions.length === 0) {
          setErrorMsg(
            unanswered > 0
              ? `None of the ${approvedQuestions.length} selected question(s) has an answer key yet. Set the correct option on each, then save.`
              : 'All selected questions are already present in this course — nothing new to save.',
          );
          return;
        }

        const payload = freshQuestions.map(q => ({
          exam_id: examId,
          course_code: selectedSubject,
          question_text: q.question_text,
          option_a: q.option_a,
          option_b: q.option_b,
          option_c: q.option_c,
          option_d: q.option_d,
          // No `|| 'A'` fallback — `answered` guarantees a real key.
          correct_option: q.correct_option,
          explanation: q.explanation || '',
          marks: q.marks || 1,
          topic: q.topic || 'General',
          difficulty: q.difficulty || difficulty
        }));

        const { error: insertErr } = await supabase.from('cbt_questions').insert(payload);
        if (insertErr) throw insertErr;

      } else if (dest === 'UTME') {
        let { data: subData } = await supabase
          .from('utme_subjects')
          .select('id')
          .eq('name', selectedSubject)
          .maybeSingle();

        let subjectId = subData?.id;
        if (!subjectId) {
          const { data: newSub, error: subErr } = await supabase
            .from('utme_subjects')
            .insert({ name: selectedSubject, code: selectedSubject.substring(0, 3).toUpperCase(), is_active: true })
            .select()
            .single();
          if (subErr) throw subErr;
          subjectId = newSub.id;
        }

        // Duplicate guard: compare normalised question text against what this
        // subject already holds, so hitting Save twice — or importing the same
        // paper again — cannot insert the same question a second time. Only the
        // comparison key is normalised; the stored text is untouched.
        const { data: existingRows } = await supabase
          .from('utme_questions')
          .select('question_text')
          .eq('subject_id', subjectId);

        const answered = approvedQuestions.filter((q) => !!q.correct_option);
        unanswered = approvedQuestions.length - answered.length;

        const seen = new Set((existingRows || []).map((r: any) => normaliseQuestionText(r.question_text)));
        freshQuestions = answered.filter((q) => {
          const key = normaliseQuestionText(q.question_text);
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        skipped = answered.length - freshQuestions.length;

        // Nothing left to insert — report why instead of issuing an empty insert.
        if (freshQuestions.length === 0) {
          setErrorMsg(
            unanswered > 0
              ? `None of the ${approvedQuestions.length} selected question(s) has an answer key yet. Set the correct option on each, then save.`
              : 'All selected questions are already present in this subject — nothing new to save.',
          );
          return;
        }

        const payload = freshQuestions.map(q => ({
          subject_id: subjectId,
          question_text: q.question_text,
          option_a: q.option_a,
          option_b: q.option_b,
          option_c: q.option_c,
          option_d: q.option_d,
          // No `|| 'A'` fallback here any more — `answered` guarantees a real key.
          correct_option: q.correct_option,
          explanation: q.explanation || '',
          difficulty: q.difficulty || difficulty,
          status: 'published',
          year: '2025'
        }));

        const { error: insertErr } = await supabase.from('utme_questions').insert(payload);
        if (insertErr) throw insertErr;

      } else {
        // Post-UTME. The paper is derived from the chosen Post-UTME course, and
        // the topic from the chosen course topic — the same two keys the rest of
        // the Post-UTME system uses. Questions already written by the
        // auto-persist pass are skipped, so pressing Save after an import does
        // not create a second copy.
        const answered = approvedQuestions.filter((q) => !!q.correct_option);
        unanswered = approvedQuestions.length - answered.length;

        const { inserted, heldBack, fresh } = await persistExtractedQuestions(answered);

        freshQuestions = fresh;
        skipped = answered.length - inserted;
        unanswered = heldBack;

        if (inserted === 0) {
          setErrorMsg(
            unanswered > 0
              ? `None of the ${approvedQuestions.length} selected question(s) has an answer key yet. Set the correct option on each, then save.`
              : 'All selected questions are already present in this paper — nothing new to save.',
          );
          return;
        }
      }

      const destLabel =
        dest === 'UTME' ? 'UTME CBT' : dest === 'Post-UTME' ? 'Post-UTME CBT' : 'Undergraduate CBT';
      const containerWord = dest === 'UTME' ? 'subject' : dest === 'Post-UTME' ? 'paper' : 'course';
      setSuccessMsg(
        `Saved ${freshQuestions.length} question${freshQuestions.length === 1 ? '' : 's'} to ${destLabel} (${selectedSubject})` +
        (skipped > 0 ? ` — ${skipped} skipped as already present in this ${containerWord}.` : '.') +
        (unanswered > 0
          ? ` ${unanswered} question${unanswered === 1 ? '' : 's'} held back: no answer key yet — set the correct option, then generate an explanation.`
          : ' Students can now access them in CBT.'),
      );
      setQuestions([]);
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save questions to Supabase database.');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.ceil(questions.length / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, questions.length);
  const currentQuestions = questions.slice(startIndex, endIndex);

  const approvedCount = questions.filter(q => q.approved).length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto text-white pb-16">
      {/* Header & Upload Card */}
      <div className="p-8 bg-slate-900 rounded-3xl border border-slate-800 shadow-xl space-y-6">
        <div className="flex items-center gap-4">
          <div className="p-3.5 bg-amber-500/10 text-amber-400 rounded-2xl border border-amber-500/20">
            <Sparkles size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-bold font-display">PDF → CBT Question Importer</h2>
            <p className="text-sm text-slate-400 mt-1">Upload educational PDFs or past questions to extract, review, and save verified CBT questions directly into Supabase.</p>
          </div>
        </div>

        {/* 1. File Upload */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold text-slate-200">1. Upload PDF Document</label>
          {!file ? (
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-slate-700 hover:border-amber-500/50 rounded-2xl p-10 text-center cursor-pointer bg-slate-800/30 hover:bg-slate-800/60 transition-all flex flex-col items-center justify-center gap-3"
            >
              <div className="p-4 bg-slate-800 rounded-full text-amber-400 shadow-inner">
                <Upload size={32} />
              </div>
              <div>
                <p className="text-base font-semibold text-white">Click to upload PDF or drag and drop</p>
                <p className="text-xs text-slate-400 mt-1">Supports multi-page textbooks, lecture notes, and large past question papers</p>
              </div>
              <input 
                ref={fileInputRef}
                type="file" 
                accept=".pdf,.txt"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          ) : (
            <div className="flex items-center justify-between p-4 bg-slate-800/80 border border-slate-700 rounded-2xl">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-500/10 text-amber-400 rounded-xl">
                  <FileText size={24} />
                </div>
                <div>
                  <p className="text-sm font-bold text-white">{file.name}</p>
                  <p className="text-xs text-slate-400">{(file.size / (1024 * 1024)).toFixed(2)} MB • Ready for AI Extraction Pipeline</p>
                </div>
              </div>
              <button 
                onClick={removeFile}
                className="p-2.5 hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 rounded-xl transition-colors cursor-pointer"
                title="Remove file"
              >
                <X size={20} />
              </button>
            </div>
          )}
        </div>

        {/* 2. Configuration & Destination */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 pt-2 border-t border-slate-800">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">Destination Portal</label>
            {/* Read-only and driven by the `destType` prop, so this importer can
                never write into a bank other than the one it was mounted for. */}
            <div className="w-full p-3 bg-slate-800/60 border border-slate-700 rounded-xl text-sm text-white font-medium flex items-center gap-2">
              <Award size={16} className="text-amber-400 shrink-0" />
              <span>
                {dest === 'Post-UTME'
                  ? 'Post-UTME CBT'
                  : dest === 'Undergraduate'
                  ? 'Undergraduate CBT'
                  : 'UTME CBT'}
              </span>
            </div>
          </div>

          {dest === 'Undergraduate' && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-2">Semester</label>
              <select
                value={ugSemester}
                onChange={(e) =>
                  setUgSemester(e.target.value as 'First Semester' | 'Second Semester')
                }
                className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white cursor-pointer font-medium"
              >
                <option value="First Semester">First Semester</option>
                <option value="Second Semester">Second Semester</option>
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">
              {dest === 'Post-UTME'
                ? 'Target Post-UTME Course'
                : dest === 'Undergraduate'
                ? 'Target Undergraduate Course'
                : 'Target Course / Subject'}
            </label>
            <select
              value={selectedSubject}
              onChange={e => setSelectedSubject(e.target.value)}
              disabled={availableSubjects.length === 0}
              className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white cursor-pointer font-medium disabled:opacity-50"
            >
              {availableSubjects.length === 0 && <option value="">No courses available</option>}
              {availableSubjects.map(sub => (
                <option key={sub.value} value={sub.value}>{sub.label}</option>
              ))}
            </select>
          </div>

          {dest === 'Post-UTME' && (
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-2">Target Topic</label>
              <select
                value={selectedTopic}
                onChange={e => setSelectedTopic(e.target.value)}
                disabled={postUtmeTopics.length === 0}
                className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white cursor-pointer font-medium disabled:opacity-50"
              >
                {postUtmeTopics.length === 0 && <option value="">No topics in this course</option>}
                {postUtmeTopics.map(t => (
                  <option key={t.id} value={t.title}>{t.title}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-2">Max Questions to Extract</label>
            <select
              value={numQuestions}
              onChange={e => setNumQuestions(parseInt(e.target.value))}
              className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-sm text-white cursor-pointer font-medium"
            >
              <option value={20}>20 Questions</option>
              <option value={50}>50 Questions</option>
              <option value={100}>100 Questions</option>
              <option value={200}>200+ (Large PDF)</option>
            </select>
          </div>
        </div>

        {dest === 'Post-UTME' && availableSubjects.length === 0 && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-sm text-amber-200">
            No Post-UTME courses exist yet. Create a course (and at least one topic) in
            Course Management under the Post-UTME programme before importing.
          </div>
        )}

        {/* Optional AI explanation stage — after extraction, never instead of it */}
        <label className="flex items-start gap-3 p-4 bg-slate-800/40 border border-slate-700 rounded-2xl cursor-pointer">
          <input
            type="checkbox"
            checked={generateExplanations}
            onChange={e => setGenerateExplanations(e.target.checked)}
            className="w-5 h-5 mt-0.5 accent-amber-500 rounded cursor-pointer shrink-0"
          />
          <span>
            <span className="block text-sm font-semibold text-white">Generate AI explanations</span>
            <span className="block text-xs text-slate-400 mt-0.5">
              Runs after extraction, for questions that already have an answer key. Questions are batched into grouped
              AI requests, so this costs a few calls per import rather than one per question. If the AI service fails,
              questions are kept and flagged for review instead of being discarded. Untick to extract with no AI calls.
            </span>
          </span>
        </label>

        {/* Generate Button */}
        <div className="pt-2">
          <button
            onClick={handleGenerate}
            disabled={loading || !file}
            className="w-full py-4 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold rounded-2xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2.5 transition-colors cursor-pointer text-base"
          >
            {loading ? <RefreshCw className="animate-spin" size={20} /> : <Sparkles size={20} />}
            {loading ? 'Processing PDF & Extracting Questions...' : 'Extract All Questions from PDF'}
          </button>
        </div>

        {/* Status / Error / Success Messages */}
        {(loading || explaining) && (
          <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-300">
            <RefreshCw className="animate-spin shrink-0" size={20} />
            <span className="text-sm font-medium">{statusMsg}</span>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-300">
            <AlertCircle className="shrink-0" size={20} />
            <span className="text-sm">{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-emerald-300">
            <CheckCircle2 className="shrink-0" size={20} />
            <span className="text-sm font-semibold">{successMsg}</span>
          </div>
        )}
      </div>

      {/* 3. Question Review & Pagination Section */}
      {questions.length > 0 && (
        <div className="space-y-6">
          <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-xl">
            <div>
              <h3 className="text-xl font-bold">Review Extracted Questions ({questions.length} total)</h3>
              <p className="text-sm text-slate-400 mt-1">
                Showing items {startIndex + 1}–{endIndex} of {questions.length} • <span className="text-emerald-400 font-semibold">{approvedCount} selected for save</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button 
                onClick={() => toggleApproveAllCurrentPage(true)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl cursor-pointer flex items-center gap-1.5"
              >
                <CheckSquare size={14} /> Select Page
              </button>
              <button 
                onClick={() => toggleApproveAll(true)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                Select All
              </button>
              <button
                onClick={() => toggleApproveAll(false)}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl cursor-pointer"
              >
                Deselect All
              </button>
              {/* Recovery path: retries only the questions still missing an
                  explanation, reusing the same batched server stage. */}
              <button
                onClick={handleGenerateExplanations}
                disabled={explaining || explainableCount === 0}
                className="px-4 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-40 text-amber-300 border border-amber-500/30 text-xs font-bold rounded-xl cursor-pointer flex items-center gap-1.5"
                title="Generate explanations for questions that have an answer but no explanation yet"
              >
                {explaining ? <RefreshCw className="animate-spin" size={14} /> : <Sparkles size={14} />}
                {explaining ? 'Generating...' : `Generate Explanations (${explainableCount})`}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            {currentQuestions.map((q, idx) => {
              const globalIndex = startIndex + idx;
              return (
                <div key={globalIndex} className={`p-6 rounded-3xl border transition-all ${q.approved ? 'bg-slate-900 border-emerald-500/40 shadow-lg' : 'bg-slate-900/40 border-slate-800 opacity-60'}`}>
                  {editingIndex === globalIndex && editForm ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Editing Question {globalIndex + 1}</span>
                        <span className="text-xs text-slate-400">Page {editForm.page_number || 1}</span>
                      </div>
                      <textarea 
                        value={editForm.question_text}
                        onChange={e => setEditForm({ ...editForm, question_text: e.target.value })}
                        className="w-full p-3 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm"
                        rows={3}
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {['A', 'B', 'C', 'D'].map(opt => (
                          <div key={opt} className="flex items-center gap-2">
                            <span className="font-bold text-amber-400">{opt}:</span>
                            <input 
                              type="text" 
                              value={(editForm as any)[`option_${opt.toLowerCase()}`]}
                              onChange={e => setEditForm({ ...editForm, [`option_${opt.toLowerCase()}`]: e.target.value })}
                              className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm"
                            />
                          </div>
                        ))}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Correct Answer</label>
                          <select
                            value={editForm.correct_option || ''}
                            onChange={e => setEditForm({ ...editForm, correct_option: e.target.value })}
                            className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm"
                          >
                            {/* Kept empty-able: a question with no answer key must
                                not silently look like it answers "A". */}
                            <option value="">— Not set —</option>
                            {['A', 'B', 'C', 'D'].map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Topic</label>
                          <input 
                            type="text" 
                            value={editForm.topic}
                            onChange={e => setEditForm({ ...editForm, topic: e.target.value })}
                            className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-slate-400 mb-1">Difficulty</label>
                          <select 
                            value={editForm.difficulty}
                            onChange={e => setEditForm({ ...editForm, difficulty: e.target.value })}
                            className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm"
                          >
                            <option value="easy">Easy</option>
                            <option value="medium">Medium</option>
                            <option value="hard">Hard</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-slate-400 mb-1">Explanation</label>
                        <input 
                          type="text" 
                          value={editForm.explanation}
                          onChange={e => setEditForm({ ...editForm, explanation: e.target.value })}
                          className="w-full p-2.5 bg-slate-800 border border-slate-700 rounded-lg text-sm"
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-2">
                        <button onClick={() => setEditingIndex(null)} className="px-4 py-2 bg-slate-800 rounded-xl text-xs font-bold cursor-pointer">Cancel</button>
                        <button onClick={saveEdit} className="px-4 py-2 bg-emerald-500 text-slate-950 rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer"><Save size={14} /> Save Changes</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-center gap-3">
                          <input 
                            type="checkbox" 
                            checked={q.approved} 
                            onChange={() => toggleApprove(globalIndex)}
                            className="w-5 h-5 accent-emerald-500 rounded cursor-pointer"
                          />
                          <span className="font-bold text-amber-400">Q{globalIndex + 1}</span>
                          <span className="text-xs bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full uppercase tracking-wider">{q.difficulty || difficulty}</span>
                          <span className="text-xs bg-slate-800 text-slate-300 px-2.5 py-1 rounded-full">{q.topic || 'General'}</span>
                          {q.page_number && <span className="text-xs bg-slate-800 text-slate-400 px-2 py-0.5 rounded">Page {q.page_number}</span>}
                          {/* Review state is surfaced, never hidden: an unanswered
                              question cannot be saved, and one without an
                              explanation is still saveable but visibly unfinished. */}
                          {!q.correct_option && (
                            <span className="text-xs bg-rose-500/10 text-rose-300 border border-rose-500/30 px-2.5 py-1 rounded-full font-semibold flex items-center gap-1">
                              <AlertCircle size={12} /> No answer key
                            </span>
                          )}
                          {q.correct_option && (!q.explanation || q.explanation_needs_review) && (
                            <span className="text-xs bg-amber-500/10 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-full font-semibold flex items-center gap-1">
                              <AlertCircle size={12} /> Needs explanation
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => startEdit(globalIndex)} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white cursor-pointer" title="Edit Question">
                            <Edit2 size={16} />
                          </button>
                          <button onClick={() => removeQuestion(globalIndex)} className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg cursor-pointer" title="Remove Question">
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>

                      <p className="text-white font-medium mb-4 text-base">{q.question_text}</p>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 mb-4">
                        {['A', 'B', 'C', 'D'].map(opt => {
                          const optText = (q as any)[`option_${opt.toLowerCase()}`];
                          const isCorrect = (q.correct_option || '').toUpperCase() === opt;
                          return (
                            <div key={opt} className={`p-3.5 rounded-xl border text-sm flex items-center gap-2.5 ${isCorrect ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-300 font-semibold' : 'bg-slate-950/50 border-slate-800 text-slate-300'}`}>
                              <span className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold shrink-0">{opt}</span>
                              <span className="flex-1">{optText}</span>
                              {isCorrect && <Check size={16} className="text-emerald-400 shrink-0" />}
                            </div>
                          );
                        })}
                      </div>

                      <div className="text-xs text-slate-300 bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 flex items-start gap-2">
                        <span className="font-bold text-slate-400 shrink-0">Explanation:</span>
                        <span>
                          {q.explanation
                            ? q.explanation
                            : q.correct_option
                              ? (q.review_note || 'No explanation yet — use "Generate Explanations" above to create one.')
                              : 'No answer key for this question yet. Set the correct option, then generate its explanation.'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 bg-slate-900 rounded-2xl border border-slate-800 shadow-xl">
              <button
                onClick={() => setCurrentPage(p => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-sm font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                <ChevronLeft size={16} /> Previous Page
              </button>
              <span className="text-sm text-slate-300 font-medium">
                Page {currentPage} of {totalPages} ({questions.length} items)
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-sm font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
              >
                Next Page <ChevronRight size={16} />
              </button>
            </div>
          )}

          {/* Save to Supabase Section */}
          <div className="p-8 bg-slate-900 rounded-3xl border border-slate-800 space-y-4 shadow-xl">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <h3 className="text-lg font-bold">Save Questions to Supabase Database</h3>
                <p className="text-sm text-slate-400 mt-1">
                  Ready to save <span className="text-emerald-400 font-bold">{approvedCount}</span> approved questions into <strong>{dest}</strong> ({selectedSubject})?
                </p>
              </div>
              <button
                onClick={handleSaveToDatabase}
                disabled={saving || approvedCount === 0}
                className="px-8 py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-bold rounded-2xl shadow-lg shadow-emerald-500/20 flex items-center gap-2.5 transition-colors cursor-pointer text-base"
              >
                <Save size={20} />
                {saving ? 'Saving to Supabase...' : `Save ${approvedCount} Questions to CBT Database`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
