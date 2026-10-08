import React, { useState, useEffect } from 'react';
import {
  Building2, BookOpen, Clock, Award, CheckCircle2, XCircle, ArrowLeft,
  AlertCircle, Play, Calendar, Shuffle, ListTree, Sliders,
} from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { POST_UTME_UNIVERSITY_CODE, POST_UTME_UNIVERSITY_NAME } from '../../lib/postUtme';
import { usePlatformConfig } from '../../lib/platformSettings';
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
  marks: number;
  difficulty: string;
}

interface TestResult {
  score: number;
  totalCorrect: number;
  totalWrong: number;
  totalQuestions: number;
  results: {
    id: string;
    question_text: string;
    option_a: string;
    option_b: string;
    option_c: string;
    option_d: string;
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
 * Every spelling this programme's papers may carry.
 *
 * Post-UTME serves one university, and `post_utme_exams.university` is free text
 * written by the admin importer, so the lock has to match the name and the code
 * in either case rather than one exact string.
 */
const UNILORIN_ALIASES = new Set([
  POST_UTME_UNIVERSITY_CODE.toLowerCase(),
  POST_UTME_UNIVERSITY_NAME.toLowerCase(),
  'unilorin',
  'university of ilorin',
]);

export default function PostUtmeDrillPage() {
  const { config } = usePlatformConfig();

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

  // Setup choices.
  const [questionLimit, setQuestionLimit] = useState<number>(config.cbt.default_question_count);
  const [practiceMode, setPracticeMode] = useState<'random' | 'topic'>('random');
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [userAdjusted, setUserAdjusted] = useState(false);

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

  const fetchTodayStats = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: attempts } = await supabase
        .from('post_utme_attempts')
        .select('score, start_time, end_time, post_utme_exams(subject, university)')
        .eq('user_id', user.id);

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
    setTestState('configuring');
    setTopicsLoading(true);
    try {
      const { data, error } = await supabase
        .from('post_utme_questions')
        .select('topic')
        .eq('exam_id', exam.id);
      if (error) throw error;

      const counts = new Map<string, number>();
      (data || []).forEach((row: any) => {
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
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to start Post-UTME drill');

      if (!data.questions || data.questions.length === 0) {
        alert('No questions matched your selection. Try a different mode or topic.');
        return;
      }

      setQuestions(data.questions || []);
      setAttemptId(data.attemptId);
      setTimeLeft(selectedExam.duration_minutes * 60);
      setAnswers({});
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

      setTestResult(data);
      setTestState('results');
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
  const filteredExams = exams.filter((exam) => {
    const value = String(exam.university ?? '').trim().toLowerCase();
    if (!value) return true;
    return UNILORIN_ALIASES.has(value);
  });

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
    const canStart = practiceMode === 'random' || !!selectedTopic;

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
            {QUESTION_LIMITS.map((n) => (
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
            A shorter sitting is drawn at random from the whole paper.
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

        <button
          onClick={handleStartTest}
          disabled={!canStart || loading}
          className="w-full py-4 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-bold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-purple-500/20"
        >
          <Play size={20} className="fill-current" />
          {loading ? 'Preparing…' : `Start Drill · ${questionLimit} questions`}
        </button>
        {!canStart && (
          <p className="text-xs text-center text-rose-400">Choose a topic to start a topic drill.</p>
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
        submitting={testState === 'submitting'}
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

          <div className="grid grid-cols-3 gap-4 max-w-lg mx-auto py-4">
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
          </div>

          <button
            onClick={() => { setTestState('selecting'); setSelectedExam(null); setTestResult(null); }}
            className="px-6 py-2.5 bg-purple-600 hover:bg-purple-500 text-white font-medium rounded-xl text-sm shadow-sm"
          >
            Back to Post-UTME Papers
          </button>
        </div>

        {/* Review Questions */}
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-white">Detailed Answer Review</h3>
          {testResult.results.map((r, idx) => (
            <div key={r.id} className="bg-[#0f172a] p-6 rounded-2xl border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-white">Question {idx + 1}</span>
                <span className={`text-xs px-2.5 py-1 rounded-full font-semibold flex items-center gap-1 ${
                  r.is_correct ? 'bg-amber-500/15 text-amber-300' : 'bg-rose-500/15 text-rose-300'
                }`}>
                  {r.is_correct ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  {r.is_correct ? 'Correct' : 'Incorrect'}
                </span>
              </div>

              <p className="text-sm font-medium text-slate-200">{r.question_text}</p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {['A', 'B', 'C', 'D'].map(opt => {
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
