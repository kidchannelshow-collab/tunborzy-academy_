import { useState, useEffect, useRef } from 'react';
import DashboardLayout from './dashboard/DashboardLayout';
import UTMEDashboard from './utme/UTMEDashboard';
import UTMEExamTaker from './utme/UTMEExamTaker';
import UTMEResultView from './utme/UTMEResultView';
import UTMEAttemptReview from './utme/UTMEAttemptReview';
import PostUtmeDrillPage from './postutme/PostUtmeDrillPage';
import { supabase } from '../supabaseClient';
import { useProfile } from '../lib/useProfile';

/**
 * Rebuild one saved attempt for review, read-only.
 *
 * The attempt row already stores everything needed: `answers.question_ids` is the
 * sitting's own question order, and `answers.student_answers` maps question id to
 * the letter the student picked. Question text, options, the correct option and
 * the explanation come from `utme_questions`. Nothing here writes, and in
 * particular it does NOT call /api/utme/start — opening a review must never
 * create an attempt.
 */
async function loadSavedAttempt(attemptId: string) {
  const { data: attempt, error } = await supabase
    .from('utme_attempts')
    .select('*, utme_subjects(name)')
    .eq('id', attemptId)
    .maybeSingle();

  if (error) throw error;
  if (!attempt) throw new Error('That attempt could not be found.');

  const questionIds: string[] = attempt.answers?.question_ids || [];
  const studentAnswers: Record<string, string> = attempt.answers?.student_answers || {};

  let questions: any[] = [];
  if (questionIds.length > 0) {
    const { data: rows, error: qErr } = await supabase
      .from('utme_questions')
      .select('id, question_text, option_a, option_b, option_c, option_d, option_e, correct_option, explanation')
      .in('id', questionIds);
    if (qErr) throw qErr;
    const byId = new Map((rows || []).map((q: any) => [q.id, q]));
    // Order by the attempt's own question_ids, not by whatever the server
    // returned: this reproduces the order the student actually saw.
    questions = questionIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((q: any) => {
        const studentAnswer = studentAnswers[q.id] || null;
        return {
          id: q.id,
          question_text: q.question_text,
          option_a: q.option_a,
          option_b: q.option_b,
          option_c: q.option_c,
          option_d: q.option_d,
          option_e: q.option_e,
          student_answer: studentAnswer,
          correct_option: q.correct_option,
          explanation: q.explanation,
          is_correct: !!studentAnswer && studentAnswer === q.correct_option,
        };
      });
  }

  return {
    attempt,
    questions,
    missing: questionIds.length - questions.length,
  };
}

export default function UTMECBTPage({ onLogout, onNavigate }: { onLogout: () => void, onNavigate?: (view: string) => void }) {
  const { profile, loading } = useProfile();
  const [view, setView] = useState<'dashboard' | 'exam' | 'result' | 'review'>('dashboard');
  const [examConfig, setExamConfig] = useState<any>(null);
  const [examResult, setExamResult] = useState<any>(null);

  // Saved-attempt review. `reviewCache` holds already-loaded attempts by id so
  // reopening the same one — or navigating back and forth — does not refetch it.
  const [reviewAttemptId, setReviewAttemptId] = useState<string | null>(null);
  const [reviewData, setReviewData] = useState<{ attempt: any; questions: any[]; missing: number } | null>(null);
  const [reviewState, setReviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [reviewError, setReviewError] = useState<string>('');
  const reviewCache = useRef<Map<string, { attempt: any; questions: any[]; missing: number }>>(new Map());

  const openAttemptReview = async (attemptId: string) => {
    setReviewAttemptId(attemptId);
    setReviewError('');
    setView('review');

    // Cache hit: render immediately, no request.
    const cached = reviewCache.current.get(attemptId);
    if (cached) {
      setReviewData(cached);
      setReviewState('idle');
      return;
    }

    setReviewState('loading');
    setReviewData(null);
    try {
      const loaded = await loadSavedAttempt(attemptId);
      reviewCache.current.set(attemptId, loaded);
      setReviewData(loaded);
      setReviewState('idle');
    } catch (err: any) {
      setReviewError(err?.message || 'Failed to load that attempt.');
      setReviewState('error');
    }
  };

  if (loading) {
    return (
      <DashboardLayout onLogout={onLogout} currentView="utme" onNavigate={onNavigate}>
        <div className="flex items-center justify-center min-h-[50vh]">
          <div className="animate-spin h-8 w-8 border-4 border-emerald-500 border-t-transparent rounded-full"></div>
        </div>
      </DashboardLayout>
    );
  }

  if (profile?.portal === 'Post-UTME') {
    return (
      <DashboardLayout onLogout={onLogout} currentView="utme" onNavigate={onNavigate}>
        <PostUtmeDrillPage />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout onLogout={onLogout} currentView="utme" onNavigate={onNavigate}>
      {view === 'dashboard' && (
        <UTMEDashboard
          onStartExam={(config) => {
            setExamConfig(config);
            setView('exam');
          }}
          onViewHistory={openAttemptReview}
        />
      )}

      {view === 'review' && (
        <>
          {reviewState === 'loading' && (
            <div className="flex justify-center py-20">
              <div className="animate-spin h-8 w-8 border-4 border-emerald-500 border-t-transparent rounded-full" />
            </div>
          )}

          {reviewState === 'error' && (
            <div className="max-w-3xl mx-auto py-10 px-4 space-y-4">
              <div className="p-6 bg-rose-500/10 border border-rose-500/30 rounded-2xl text-rose-300 text-sm">
                {reviewError}
              </div>
              <button
                onClick={() => setView('dashboard')}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium text-sm cursor-pointer"
              >
                Back to Dashboard
              </button>
            </div>
          )}

          {reviewState === 'idle' && reviewData && (
            <>
              {reviewData.missing > 0 && (
                <div className="max-w-3xl mx-auto px-4 pt-6">
                  <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-300 text-xs">
                    {reviewData.missing} question{reviewData.missing === 1 ? '' : 's'} from this attempt
                    could not be loaded. The saved score is unaffected.
                  </div>
                </div>
              )}
              <UTMEAttemptReview
                questions={reviewData.questions}
                meta={{
                  subject: reviewData.attempt?.utme_subjects?.name,
                  score: reviewData.attempt?.score ?? reviewData.attempt?.percentage,
                  totalCorrect: reviewData.attempt?.total_correct,
                  totalWrong: reviewData.attempt?.total_wrong,
                  totalUnanswered: reviewData.attempt?.total_unanswered,
                  timeUsed: reviewData.attempt?.time_used,
                  createdAt: reviewData.attempt?.created_at,
                }}
                onBack={() => {
                  setView('dashboard');
                  setReviewAttemptId(null);
                }}
                backLabel="Back to Dashboard"
              />
            </>
          )}
        </>
      )}

      {view === 'exam' && examConfig && (
        <UTMEExamTaker
          config={examConfig}
          onFinish={(res) => {
            setExamResult(res);
            setView('result');
          }}
          onCancel={() => setView('dashboard')}
        />
      )}

      {view === 'result' && examResult && (
        <UTMEResultView
          result={examResult}
          onRetry={() => setView('exam')}
          onBack={() => setView('dashboard')}
        />
      )}
    </DashboardLayout>
  );
}
