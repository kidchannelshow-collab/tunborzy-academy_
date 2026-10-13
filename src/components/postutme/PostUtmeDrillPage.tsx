import React, { useState, useEffect, useMemo } from 'react';
import {
  Building2, BookOpen, Clock, Award, CheckCircle2, XCircle, ArrowLeft,
  AlertCircle, Play, Calendar, Shuffle, ListTree, Sliders, Timer, Gauge, MinusCircle,
} from 'lucide-react';
import { supabase } from '../../supabaseClient';
import {
  POST_UTME_UNIVERSITY_NAME,
  isUnilorinPaper,
} from '../../lib/postUtme';
import { usePlatformConfig } from '../../lib/platformSettings';
import { useProfile } from '../../lib/useProfile';
import { notificationService } from '../../lib/notificationService';
import CBTExamShell from '../cbt/CBTExamShell';

interface PostUtmeExam {
  id: string;
  title: string;
  university: string;
  subject: string;
  year: string;
  duration_minutes: number;
}

interface Question {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  /** Present only on papers that print a fifth option; the shell renders it when set. */
  option_e?: string | null;
  marks: number;
  difficulty: string;
}

interface TestResult {
  score: number;
  totalCorrect: number;
  totalWrong: number;
  totalQuestions: number;
  /** Questions the student left blank. Returned by /api/post-utme/submit. */
  totalUnanswered?: number;
  /** Seconds on task, derived server-side from the attempt's own timestamps. */
  timeUsedSeconds?: number | null;
  results: {
    id: string;
    question_text: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
    /** Fifth option. Optional: most papers carry four, and the column is
     *  nullable, so a four-option paper leaves it null. */
    option_e?: string | null;
    student_answer: string;
    correct_option: string;
    explanation: string;
    is_correct: boolean;
  }[];
}

/**
 * The question counts a student may choose.
 *
 * Deliberately a fixed set rather than a free number: these are the lengths a
 * real screening paper comes in, and a bounded set keeps the setup screen to one
 * tap. The old behaviour was to serve the ENTIRE paper — 1,000 questions for a
 * 1,000-question bank — which is not a practice sitting.
 */
const QUESTION_LIMITS = [10, 20, 50, 100] as const;

/**
 * The difficulty values `post_utme_questions.difficulty` actually carries.
 *
 * 'all' is the identity filter and is listed first so it is the default the
 * student sees. The set is closed rather than free text because the column is a
 * small enum written by the importer ('easy' | 'medium' | 'hard').
 */
const DIFFICULTIES = ['all', 'easy', 'medium', 'hard'] as const;

/**
 * Post-UTME serves the University of Ilorin only. The rule itself lives in
 * `lib/postUtme`, shared with the staff manager, so the manager cannot badge a
 * paper "Live" that this list would hide.
 */

export default function PostUtmeDrillPage() {
  const { config } = usePlatformConfig();
  const { profile } = useProfile();

  /**
   * The Post-UTME session, opened or closed by an admin in System Settings →
   * Post-UTME. Closing it withdraws access to NEW sittings only — the papers,
   * every past attempt and every score stay exactly as they were, so reopening
   * the session restores the full history. The server enforces the same rule in
   * /api/post-utme/start, so a retained examId cannot start one either.
   */
  const sessionClosed = config.cbt.post_utme_cbt_enabled === false;

  const [exams, setExams] = useState<PostUtmeExam[]>([]);
  const [selectedExam, setSelectedExam] = useState<PostUtmeExam | null>(null);
  const [topics, setTopics] = useState<{ name: string; count: number }[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);

  /**
   * Raw `{ topic, difficulty }` for every question in the open paper.
   *
   * Held so the setup screen can show how many questions the current filters
   * actually match — the same live preview the UTME setup offers — and so the
   * per-topic and per-difficulty counts are derived from one fetch rather than
   * three. Only these two columns are selected; no option or answer text.
   */
  const [questionMeta, setQuestionMeta] = useState<{ topic: string; difficulty: string }[]>([]);

  // Setup choices.
  const [questionLimit, setQuestionLimit] = useState<number>(config.cbt.default_question_count);
  const [practiceMode, setPracticeMode] = useState<'random' | 'topic'>('random');
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('all');
  const [userAdjusted, setUserAdjusted] = useState(false);

  // Timed sitting. Mirrors the Undergraduate setup: the paper's own duration is
  // the ceiling, and the student may shorten the sitting or drop the clock
  // entirely. Untimed is a practice mode, not a way round a screening paper, so
  // it only ever removes the countdown — grading is unchanged.
  const [isTimed, setIsTimed] = useState(true);
  const [durationMins, setDurationMins] = useState<number>(config.cbt.default_exam_duration_mins);
  const [durationAdjusted, setDurationAdjusted] = useState(false);

  // Flagged question ids, for the review navigator. Optional in the shell; the
  // other two portals pass it, so Post-UTME does too.
  const [flags, setFlags] = useState<Record<string, boolean>>({});

  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [testState, setTestState] = useState<'selecting' | 'configuring' | 'testing' | 'submitting' | 'results'>('selecting');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [todayStats, setTodayStats] = useState({ coursesToday: 0, cbtTakenToday: 0, avgScoreToday: 0 });

  useEffect(() => {
    fetchPublishedExams();
    fetchTodayStats();
  }, []);

  // The settings arrive asynchronously; seed the count from the admin default
  // once it is known, without overwriting a choice the student already made.
  useEffect(() => {
    if (userAdjusted) return;
    setQuestionLimit(nearestLimit(config.cbt.default_question_count));
  }, [config.cbt.default_question_count, userAdjusted]);

  // Same contract for the clock: seed from the admin default once it is known,
  // and never overwrite a duration the student has already chosen. The value is
  // additionally clamped to the paper's own length on open (see handleOpenSetup)
  // — the range input clamps its thumb, but state seeded above the paper's
  // duration would otherwise hand the student a longer clock than the paper has.
  useEffect(() => {
    if (durationAdjusted) return;
    setDurationMins(config.cbt.default_exam_duration_mins);
  }, [config.cbt.default_exam_duration_mins, durationAdjusted]);

  /** The difficulties this paper actually contains, in canonical order. */
  const difficultyOptions = useMemo(() => {
    const present = new Set(questionMeta.map((q) => String(q.difficulty || '').trim().toLowerCase()).filter(Boolean));
    return DIFFICULTIES.filter((d) => d === 'all' || present.has(d));
  }, [questionMeta]);

  /**
   * The sitting lengths this paper can actually fill.
   *
   * The four fixed lengths used to be offered unconditionally, so a 12-question
   * paper still advertised "100" — a button that silently yielded 12, and a
   * control that contradicted its own label. An empty metadata list means the
   * paper's size is unknown, so every length is offered rather than none.
   */
  const offeredLimits = useMemo(() => {
    if (questionMeta.length === 0) return [...QUESTION_LIMITS];
    const fits = QUESTION_LIMITS.filter((n) => n <= questionMeta.length);
    return fits.length > 0 ? fits : [QUESTION_LIMITS[0]];
  }, [questionMeta]);

  // Keep the selection on a length this paper offers — e.g. after switching from
  // a 300-question paper where 100 was chosen to a 12-question one.
  useEffect(() => {
    if (offeredLimits.includes(questionLimit as any)) return;
    setQuestionLimit(offeredLimits[offeredLimits.length - 1]);
  }, [offeredLimits, questionLimit]);

  /**
   * How many questions the current filters match.
   *
   * The student sees this before starting, so a topic + difficulty combination
   * that yields nothing is obvious up front instead of arriving as an empty
   * sitting. Mirrors UTMEDashboard's "matching questions" preview.
   */
  const availableCount = useMemo(() => {
    const wantedTopic = practiceMode === 'topic' && selectedTopic ? selectedTopic.trim().toLowerCase() : null;
    const wantedDifficulty = selectedDifficulty !== 'all' ? selectedDifficulty : null;

    return questionMeta.filter((q) => {
      const rawTopic = String(q.topic ?? '').trim();
      const topic = !rawTopic || rawTopic.toLowerCase() === 'general' ? 'Uncategorized' : rawTopic;
      if (wantedTopic && topic.toLowerCase() !== wantedTopic) return false;
      const difficulty = String(q.difficulty ?? '').trim().toLowerCase();
      if (wantedDifficulty && difficulty !== wantedDifficulty) return false;
      return true;
    }).length;
  }, [questionMeta, practiceMode, selectedTopic, selectedDifficulty]);

  const fetchTodayStats = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: attempts } = await supabase
        .from('post_utme_attempts')
        .select('score, start_time, end_time, post_utme_exams(subject, university)')
        .eq('user_id', user.id)
        // Completed sittings only. `post_utme_attempts` gets an `in_progress` row
        // the moment a drill starts, and without this filter starting a drill and
        // abandoning it counted as a CBT taken and — because `score` defaults to
        // 0 — dragged the day's average down. Every other reader of this table
        // (UTMEDashboard, PostUtmeManagement, Analytics, PerformanceAnalytics)
        // filters on `completed`; this was the only one that did not.
        .eq('status', 'completed');

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayAttempts = (attempts || []).filter((a: any) => {
        const t = new Date(a.end_time || a.start_time);
        return t >= today;
      });

      const distinctCourses = new Set(todayAttempts.map((a: any) => a.post_utme_exams?.subject || a.post_utme_exams?.university).filter(Boolean)).size;
      const cbtTaken = todayAttempts.length;

      let scoreSum = 0;
      let scoreCount = 0;
      todayAttempts.forEach((a: any) => {
        if (a.score !== null && a.score !== undefined) {
          scoreSum += Number(a.score);
          scoreCount++;
        }
      });
      const avgScore = scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0;

      setTodayStats({
        coursesToday: distinctCourses,
        cbtTakenToday: cbtTaken,
        avgScoreToday: avgScore
      });
    } catch (err) {
      console.error('Error fetching Post-UTME today stats:', err);
    }
  };

  useEffect(() => {
    let timer: any;
    if (testState === 'testing' && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            handleSubmitTest();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [testState, timeLeft]);

  const fetchPublishedExams = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('post_utme_exams')
        .select('*')
        .eq('is_published', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setExams(data || []);
    } catch (err) {
      console.error('Failed to load published Post-UTME papers:', err);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Open the setup screen for a paper and load its topic list.
   *
   * Only `topic` is selected — never the option columns or the answer key, which
   * must not reach the browser before the sitting is graded.
   */
  const handleOpenSetup = async (exam: PostUtmeExam) => {
    if (sessionClosed) return;
    setSelectedExam(exam);
    setPracticeMode('random');
    setSelectedTopic(null);
    setSelectedDifficulty('all');
    setIsTimed(true);
    setDurationAdjusted(false);
    // The paper's own length is the ceiling — a practice run may be shorter than
    // the real screening, never longer. The range input below clamps its thumb,
    // but state seeded above the paper's duration still produced a longer
    // countdown than the paper allows (admin default 30 min on a 20-minute paper
    // gave the student 30:00). Clamping the state closes that gap.
    const paperMinutes = Number(exam.duration_minutes) || 0;
    setDurationMins(
      paperMinutes > 0
        ? Math.min(config.cbt.default_exam_duration_mins, paperMinutes)
        : config.cbt.default_exam_duration_mins,
    );
    setTestState('configuring');
    setTopicsLoading(true);
    try {
      // `topic` and `difficulty` only — never an option column or the answer key.
      const { data, error } = await supabase
        .from('post_utme_questions')
        .select('topic, difficulty')
        .eq('exam_id', exam.id);
      if (error) throw error;

      const rows = (data || []) as any[];
      setQuestionMeta(
        rows.map((row) => ({
          topic: String(row?.topic ?? '').trim(),
          difficulty: String(row?.difficulty ?? '').trim(),
        })),
      );

      const counts = new Map<string, number>();
      rows.forEach((row) => {
        const raw = String(row?.topic ?? '').trim();
        const name = !raw || raw.toLowerCase() === 'general' ? 'Uncategorized' : raw;
        counts.set(name, (counts.get(name) || 0) + 1);
      });
      setTopics(
        Array.from(counts.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (err) {
      console.error('Failed to load Post-UTME topics:', err);
      setTopics([]);
      setQuestionMeta([]);
    } finally {
      setTopicsLoading(false);
    }
  };

  const handleStartTest = async () => {
    if (!selectedExam || sessionClosed) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      // Call backend to start exam & fetch safe questions without answer keys
      const res = await fetch(`/api/post-utme/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          examId: selectedExam.id,
          limit: questionLimit,
          mode: practiceMode,
          topic: practiceMode === 'topic' ? selectedTopic : undefined,
          // 'all' means "no filter" and is sent as-is; the server treats it as
          // absent so a paper with no difficulty recorded is never filtered out.
          difficulty: selectedDifficulty,
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start Post-UTME drill');

      if (!data.questions || data.questions.length === 0) {
        alert('No questions matched your selection. Try a different mode, topic or difficulty.');
        return;
      }

      setQuestions(data.questions || []);
      setAttemptId(data.attemptId);
      // Untimed practice sends 0, which the shell renders as no countdown.
      setTimeLeft(isTimed ? durationMins * 60 : 0);
      setAnswers({});
      setFlags({});
      setCurrentIndex(0);
      setTestState('testing');
    } catch (err: any) {
      alert('Error starting exam: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitTest = async () => {
    if (!attemptId || testState === 'submitting' || testState === 'results') return;
    setTestState('submitting');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`/api/post-utme/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ attemptId, answers })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit Post-UTME exam');

      // Mirrors UTMEExamTaker and CBTExamTaker, which both raise a result
      // notification on a successful submit. Post-UTME raised none, so a
      // completed Post-UTME drill never appeared in the student's bell.
      if (profile?.id) {
        await notificationService.notifyUser({
          userId: profile.id,
          title: 'Post-UTME Drill Completed',
          message: `${selectedExam?.title || 'Post-UTME paper'}: you scored ${data.score}%.`,
          type: 'result',
          link: '/utme',
        });
      }

      setTestResult(data);
      setTestState('results');
      // Re-read the day's totals so the tiles reflect the sitting just finished
      // rather than the state they were loaded with on mount.
      void fetchTodayStats();
    } catch (err: any) {
      alert('Error submitting test: ' + err.message);
      setTestState('testing');
    }
  };

  /**
   * Post-UTME serves the University of Ilorin only.
   *
   * A paper with no university recorded is KEPT — those predate the single-
   * university rule and hiding them would remove papers that currently work.
   * Everything else must match Unilorin by name or code.
   */
  const filteredExams = exams.filter((exam) => isUnilorinPaper(exam.university));

  // ---------------------------------------------------------------------
  // STEP 1 — choose a paper
  // ---------------------------------------------------------------------
  if (testState === 'selecting') {
    return (
      <div className="space-y-6 max-w-7xl mx-auto px-4 py-8">
        <div className="bg-gradient-to-r from-purple-900 to-purple-800 text-white p-8 rounded-3xl shadow-lg relative overflow-hidden">
          <div className="relative z-10 space-y-3">
            <span className="bg-purple-500/30 text-purple-100 text-xs font-semibold px-3 py-1 rounded-full border border-purple-400/30">
              Post-UTME Past Questions & CBT Drills
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight">
              {POST_UTME_UNIVERSITY_NAME} Screening CBT
            </h1>
            <p className="text-purple-100 text-sm max-w-2xl leading-relaxed">
              Practice timed {POST_UTME_UNIVERSITY_NAME} Post-UTME past questions with secure
              server-side grading and detailed performance reviews.
            </p>
          </div>
          <div className="absolute right-0 bottom-0 opacity-10 translate-x-8 translate-y-8">
            <Building2 className="w-64 h-64" />
          </div>
        </div>

        {/* Today's Progress */}
        <div className="space-y-4">
          <h3 className="text-xl font-display font-bold text-white flex items-center gap-2">
            <Clock className="text-amber-400" size={20} /> Today's Progress
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5 flex items-center gap-4 shadow-lg">
              <div className="w-12 h-12 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400">
                <BookOpen size={24} />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{todayStats.coursesToday}</div>
                <div className="text-xs text-slate-400">Courses Enrolled Today</div>
              </div>
            </div>
            <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5 flex items-center gap-4 shadow-lg">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400">
                <Clock size={24} />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{todayStats.cbtTakenToday}</div>
                <div className="text-xs text-slate-400">CBT Taken Today</div>
              </div>
            </div>
            <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5 flex items-center gap-4 shadow-lg">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400">
                <Award size={24} />
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{todayStats.avgScoreToday}%</div>
                <div className="text-xs text-slate-400">Average CBT Score Today</div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-purple-400" />
            Available Post-UTME Papers
          </h2>
          <span className="px-4 py-2 bg-[#0f172a] border border-slate-800 rounded-xl text-sm font-semibold text-slate-200 shadow-sm">
            {POST_UTME_UNIVERSITY_NAME}
          </span>
        </div>

        {sessionClosed && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-bold text-amber-300">
                The Post-UTME session is currently closed
              </div>
              <div className="text-xs text-amber-200/80 mt-0.5">
                New practice sittings are paused for now. Your papers and previous results are
                unchanged and will be available again when the session reopens.
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredExams.map((exam) => (
            <div
              key={exam.id}
              className="bg-[#0f172a] border border-slate-800 p-6 rounded-2xl shadow-sm hover:border-purple-500/40 transition-all flex flex-col justify-between space-y-4"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/25">
                    {exam.university || POST_UTME_UNIVERSITY_NAME}
                  </span>
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" /> {exam.year || 'General'}
                  </span>
                </div>
                <h3 className="font-bold text-white text-base leading-snug">{exam.title}</h3>
                <p className="text-xs text-slate-400">Subject: <strong className="text-slate-200">{exam.subject}</strong></p>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Clock className="w-4 h-4 text-amber-400" /> {exam.duration_minutes} Minutes
                </span>
                <button
                  onClick={() => handleOpenSetup(exam)}
                  disabled={loading || sessionClosed}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-medium text-sm flex items-center gap-2 shadow-sm transition-all"
                >
                  <Play className="w-4 h-4 fill-current" /> {sessionClosed ? 'Session Closed' : 'Set Up Drill'}
                </button>
              </div>
            </div>
          ))}

          {filteredExams.length === 0 && !loading && (
            <div className="col-span-full text-center py-20 text-slate-500">
              <Building2 className="w-12 h-12 mx-auto mb-3 opacity-40" />
              <p className="text-base font-medium">No published Post-UTME papers available right now.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // STEP 2 — pre-test setup (question limit, mode, topic)
  // ---------------------------------------------------------------------
  if (testState === 'configuring' && selectedExam) {
    // Blocked when a topic is required but unchosen, or when the current filters
    // provably match nothing. `questionMeta.length === 0` is treated as "unknown"
    // rather than "empty", so a paper whose metadata failed to load can still be
    // started instead of being locked out.
    const canStart =
      (practiceMode === 'random' || !!selectedTopic) &&
      (availableCount > 0 || questionMeta.length === 0);

    return (
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <button
          onClick={() => setTestState('selecting')}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft size={16} /> Back to papers
        </button>

        <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 md:p-8 space-y-2">
          <span className="text-xs font-bold px-2.5 py-1 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
            {selectedExam.university || POST_UTME_UNIVERSITY_NAME}
          </span>
          <h1 className="text-2xl font-bold text-white">{selectedExam.title}</h1>
          <p className="text-sm text-slate-400">
            {selectedExam.subject} · {selectedExam.duration_minutes} minutes
          </p>
        </div>

        {/* Question count */}
        <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 space-y-4">
          <h2 className="font-bold text-white flex items-center gap-2">
            <Sliders size={18} className="text-purple-400" /> Number of questions
          </h2>
          <div className="grid grid-cols-4 gap-3">
            {offeredLimits.map((n) => (
              <button
                key={n}
                onClick={() => { setUserAdjusted(true); setQuestionLimit(n); }}
                className={`py-3 rounded-xl font-bold text-sm border transition-all ${
                  questionLimit === n
                    ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            {availableCount > 0
              ? `${availableCount} question${availableCount === 1 ? '' : 's'} match your current filters. A shorter sitting is drawn at random from those.`
              : 'No questions match the current filters — widen the topic or difficulty.'}
          </p>
        </div>

        {/* Mode */}
        <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 space-y-4">
          <h2 className="font-bold text-white flex items-center gap-2">
            <Shuffle size={18} className="text-purple-400" /> Practice mode
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => { setPracticeMode('random'); setSelectedTopic(null); }}
              className={`p-4 rounded-2xl border text-left transition-all ${
                practiceMode === 'random'
                  ? 'bg-amber-500/10 border-amber-500'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-600'
              }`}
            >
              <Shuffle size={18} className={practiceMode === 'random' ? 'text-amber-400' : 'text-slate-400'} />
              <h3 className="font-bold text-white text-sm mt-2">Random</h3>
              <p className="text-xs text-slate-400 mt-0.5">Questions drawn from the whole paper.</p>
            </button>
            <button
              onClick={() => setPracticeMode('topic')}
              className={`p-4 rounded-2xl border text-left transition-all ${
                practiceMode === 'topic'
                  ? 'bg-amber-500/10 border-amber-500'
                  : 'bg-slate-900 border-slate-800 hover:border-slate-600'
              }`}
            >
              <ListTree size={18} className={practiceMode === 'topic' ? 'text-amber-400' : 'text-slate-400'} />
              <h3 className="font-bold text-white text-sm mt-2">By topic</h3>
              <p className="text-xs text-slate-400 mt-0.5">Focus on one topic at a time.</p>
            </button>
          </div>

          {practiceMode === 'topic' && (
            <div className="pt-2">
              {topicsLoading ? (
                <div className="flex justify-center py-6">
                  <div className="animate-spin h-6 w-6 border-4 border-purple-500 border-t-transparent rounded-full"></div>
                </div>
              ) : topics.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {topics.map((t) => (
                    <button
                      key={t.name}
                      onClick={() => setSelectedTopic(t.name)}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-left transition-colors ${
                        selectedTopic === t.name
                          ? 'bg-amber-500/10 border-amber-500 text-amber-300'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <span className="text-sm font-medium line-clamp-1">{t.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-bold shrink-0">
                        {t.count} q
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-6 text-sm text-slate-400 bg-slate-900/50 rounded-xl border border-slate-800">
                  This paper has no topics recorded. Use Random mode instead.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Difficulty — the same filter the UTME setup offers. `all` is the
            identity option and the default, so a paper with no difficulty
            recorded behaves exactly as before. */}
        {difficultyOptions.length > 1 && (
          <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 space-y-4">
            <h2 className="font-bold text-white flex items-center gap-2">
              <Gauge size={18} className="text-purple-400" /> Difficulty
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {difficultyOptions.map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedDifficulty(d)}
                  className={`py-3 rounded-xl font-bold text-sm border capitalize transition-all ${
                    selectedDifficulty === d
                      ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  {d === 'all' ? 'All levels' : d}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Timed sitting — mirrors the Undergraduate setup. */}
        <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-white flex items-center gap-2">
              <Timer size={18} className="text-purple-400" /> Timed session
            </h2>
            <button
              onClick={() => setIsTimed((v) => !v)}
              className={`w-12 h-6 rounded-full transition-colors relative ${isTimed ? 'bg-amber-500' : 'bg-slate-700'}`}
              aria-pressed={isTimed}
              aria-label="Toggle timed session"
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${isTimed ? 'left-6' : 'left-0.5'}`} />
            </button>
          </div>

          {isTimed ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Duration</span>
                <span className="font-bold text-amber-300">{durationMins} minutes</span>
              </div>
              <input
                type="range"
                min={5}
                // The paper's own length is the ceiling — a practice run may be
                // shorter than the real screening, never longer.
                max={Math.max(10, selectedExam.duration_minutes || 60)}
                step={5}
                value={durationMins}
                onChange={(e) => { setDurationAdjusted(true); setDurationMins(Number(e.target.value)); }}
                className="w-full accent-amber-500"
              />
            </>
          ) : (
            <p className="text-xs text-slate-500">
              No countdown. Take as long as you need — grading is unchanged.
            </p>
          )}
        </div>

        <button
          onClick={handleStartTest}
          disabled={!canStart || loading}
          className="w-full py-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-bold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20"
        >
          <Play size={20} className="fill-current" />
          {loading
            ? 'Preparing…'
            : `Start Drill · ${availableCount > 0 ? Math.min(questionLimit, availableCount) : questionLimit} questions`}
        </button>
        {!canStart && (
          <p className="text-xs text-center text-rose-400">
            {practiceMode === 'topic' && !selectedTopic
              ? 'Choose a topic to start a topic drill.'
              : 'No questions match the current filters. Widen the topic or difficulty.'}
          </p>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------
  // STEP 3 — the sitting (shared shell)
  // ---------------------------------------------------------------------
  // 'submitting' keeps the shell on screen with its Submit button disabled, so a
  // slow grade does not blank the exam out from under the student mid-press.
  if ((testState === 'testing' || testState === 'submitting') && questions.length > 0) {
    return (
      <CBTExamShell
        title={selectedExam?.title || 'Post-UTME Screening'}
        badge={selectedExam?.university || POST_UTME_UNIVERSITY_NAME}
        subtitle={`${questions.length} questions · ${practiceMode === 'topic' && selectedTopic ? selectedTopic : 'Random'}`}
        questions={questions}
        answers={answers}
        currentIndex={currentIndex}
        onSelectOption={(questionId, letter) => setAnswers((prev) => ({ ...prev, [questionId]: letter }))}
        onNavigate={setCurrentIndex}
        onSubmit={handleSubmitTest}
        timeLeft={timeLeft}
        timed={isTimed}
        submitting={testState === 'submitting'}
        flags={flags}
        onToggleFlag={(questionId) =>
          setFlags((prev) => ({ ...prev, [questionId]: !prev[questionId] }))
        }
      />
    );
  }

  // ---------------------------------------------------------------------
  // STEP 4 — results
  // ---------------------------------------------------------------------
  if (testState === 'results' && testResult) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        <div className="bg-[#0f172a] p-8 rounded-3xl shadow-sm border border-slate-800 text-center space-y-4">
          <div className="w-20 h-20 bg-purple-500/15 text-purple-400 rounded-full flex items-center justify-center mx-auto shadow-inner">
            <Award className="w-10 h-10" />
          </div>
          <h1 className="text-3xl font-extrabold text-white">Post-UTME Drill Completed!</h1>
          <p className="text-slate-400 text-sm">{selectedExam?.title}</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl mx-auto py-4">
            <div className="p-4 bg-slate-900/60 rounded-2xl">
              <span className="text-2xl font-black text-purple-400">{testResult.score}%</span>
              <p className="text-xs text-slate-400 mt-1 font-medium">Final Score</p>
            </div>
            <div className="p-4 bg-slate-900/60 rounded-2xl">
              <span className="text-2xl font-black text-amber-400">{testResult.totalCorrect}</span>
              <p className="text-xs text-slate-400 mt-1 font-medium">Correct</p>
            </div>
            <div className="p-4 bg-slate-900/60 rounded-2xl">
              <span className="text-2xl font-black text-rose-400">{testResult.totalWrong}</span>
              <p className="text-xs text-slate-400 mt-1 font-medium">Incorrect</p>
            </div>
            {/* Unanswered is its own outcome. Folding a blank into "Incorrect"
                told a student they got a question wrong when they never
                answered it — and the server has always returned the count. */}
            <div className="p-4 bg-slate-900/60 rounded-2xl">
              <span className="text-2xl font-black text-slate-300">{testResult.totalUnanswered ?? 0}</span>
              <p className="text-xs text-slate-400 mt-1 font-medium">Unanswered</p>
            </div>
          </div>

          {typeof testResult.timeUsedSeconds === 'number' && testResult.timeUsedSeconds > 0 && (
            <p className="text-xs text-slate-400 flex items-center justify-center gap-1.5">
              <Clock className="w-3.5 h-3.5" /> Time on task:{' '}
              {Math.floor(testResult.timeUsedSeconds / 60)}m {String(testResult.timeUsedSeconds % 60).padStart(2, '0')}s
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {/* Mirrors UTME's "Try Another Attempt" and Undergraduate's "Retake
                Test" — Post-UTME previously offered only "back". */}
            <button
              onClick={() => { if (selectedExam) void handleOpenSetup(selectedExam); }}
              className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-xl text-sm shadow-sm"
            >
              Retake this paper
            </button>
            <button
              onClick={() => { setTestState('selecting'); setSelectedExam(null); setTestResult(null); }}
              className="px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-xl text-sm"
            >
              Back to Post-UTME Papers
            </button>
          </div>
        </div>

        {/* Review Questions */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-white">Detailed Answer Review</h3>
          {testResult.results.map((r, idx) => (
            <div key={r.id} className="bg-[#0f172a] p-6 rounded-2xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-white">Question {idx + 1}</span>
                {(() => {
                  // Three outcomes, not two: a blank is "Not answered", which is
                  // not the same as having chosen a wrong option.
                  const unanswered = !r.student_answer;
                  const cls = unanswered
                    ? 'bg-slate-500/15 text-slate-300'
                    : r.is_correct
                    ? 'bg-amber-500/15 text-amber-300'
                    : 'bg-rose-500/15 text-rose-300';
                  return (
                    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1 ${cls}`}>
                      {unanswered ? (
                        <MinusCircle className="w-3.5 h-3.5" />
                      ) : r.is_correct ? (
                        <CheckCircle2 className="w-3.5 h-3.5" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5" />
                      )}
                      {unanswered ? 'Not answered' : r.is_correct ? 'Correct' : 'Incorrect'}
                    </span>
                  );
                })()}
              </div>

              <p className="text-sm font-medium text-slate-200">{r.question_text}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {['A', 'B', 'C', 'D', 'E'].map(opt => {
                  // Most papers carry four options; skip E when it has no text so
                  // a four-option question is not given an empty fifth tile.
                  if (opt === 'E' && !String(r.option_e ?? '').trim()) return null;

                  const optKey = `option_${opt.toLowerCase()}` as keyof typeof r;
                  const isUserAns = r.student_answer === opt;
                  const isCorrectAns = r.correct_option === opt;

                  let style = 'bg-slate-900/60 border-slate-800 text-slate-300';
                  if (isCorrectAns) style = 'bg-amber-500/10 border-amber-500/50 text-amber-200 font-bold';
                  else if (isUserAns && !isCorrectAns) style = 'bg-rose-500/10 border-rose-500/50 text-rose-200 font-bold';

                  return (
                    <div key={opt} className={`p-2.5 rounded-xl border ${style}`}>
                      <span className="font-bold mr-2">{opt}:</span> {String(r[optKey])}
                      {isCorrectAns && <span className="float-right text-amber-400 text-xs">Correct Answer</span>}
                      {isUserAns && !isCorrectAns && <span className="float-right text-rose-400 text-xs">Your Answer</span>}
                    </div>
                  );
                })}
              </div>

              {r.explanation && (
                <div className="text-xs bg-purple-500/10 text-purple-200 p-3 rounded-xl border border-purple-500/20 mt-2">
                  <span className="font-bold">Explanation:</span> {r.explanation}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

/** Snap the configured default onto the nearest offered length. */
function nearestLimit(value: number): number {
  return QUESTION_LIMITS.reduce<number>(
    (best, n) => (Math.abs(n - value) < Math.abs(best - value) ? n : best),
    QUESTION_LIMITS[0],
  );
}
