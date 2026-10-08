import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { notificationService } from '../../lib/notificationService';
import { useProfile } from '../../lib/useProfile';
import CBTExamShell from './CBTExamShell';

/**
 * Undergraduate drill sitting.
 *
 * The screen itself lives in `CBTExamShell`, shared with UTME and Post-UTME.
 * This component owns only what is Undergraduate-specific: the
 * `/api/cbt/start` / `/api/cbt/submit` payloads, the result cached for
 * `CBTResultView`, and the "CBT completed" notification.
 *
 * Two entry paths remain, unchanged: `customConfig.backendDrill` posts to
 * /api/cbt/start (every live drill — CBTPracticePage, AcademicMaterialsPage,
 * StudentLessonViewer), and a bare `examId` fetches /api/cbt/exam/:id (kept for
 * completeness; nothing live reaches it).
 *
 * The old fullscreen takeover, the draggable calculator and the local keyboard
 * shortcuts are gone: the calculator's buttons never had handlers, and the
 * others were Undergraduate-only, which is exactly the divergence this
 * unification removes. Keyboard shortcuts now come from the shared shell, so
 * all three programmes have them.
 */
export default function CBTExamTaker({ examId, attemptId, onFinish, onCancel, customConfig }: any) {
  const { profile } = useProfile();
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [actualAttemptId, setActualAttemptId] = useState<string>(attemptId);

  // Identifies the exam this component is currently loading. React StrictMode
  // (src/main.tsx) mounts, unmounts and remounts every component in development,
  // so this effect runs twice for one start — and each run POSTs /api/cbt/start,
  // which used to INSERT a fresh cbt_attempts row. One real sitting was therefore
  // recorded as two CBTs. Guarding on the identity of the exam rather than on a
  // plain boolean keeps the effect re-runnable when the exam genuinely changes.
  const loadedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const loadKey = `${examId ?? ''}|${customConfig?.courseCode ?? ''}|${customConfig?.mode ?? ''}|${customConfig?.topic ?? ''}`;
    if (loadedKeyRef.current === loadKey) return;
    loadedKeyRef.current = loadKey;

    async function loadExam() {
      let duration = 30 * 60;
      if (customConfig && customConfig.time) {
        duration = customConfig.time * 60;
      }
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const token = session?.access_token;

        if (customConfig && customConfig.backendDrill) {
          const res = await fetch('/api/cbt/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
            body: JSON.stringify(customConfig)
          });
          const data = await res.json();
          if (data.questions) setQuestions(data.questions);
          if (data.attemptId) setActualAttemptId(data.attemptId);
          setTimeLeft(customConfig.time * 60);
        } else if (examId) {
          const res = await fetch(`/api/cbt/exam/${examId}`, {
            headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) }
          });
          const data = await res.json();
          if (data.questions) setQuestions(data.questions);
          if (data.duration) setTimeLeft(data.duration);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadExam();
  }, [examId, customConfig]);

  useEffect(() => {
    if (loading || timeLeft <= 0 || submitting) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          submitExam();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [loading, timeLeft, submitting]);

  const submitExam = async () => {
    setSubmitting(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;

      const res = await fetch('/api/cbt/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ attemptId: actualAttemptId, answers })
      });
      const data = await res.json();

      if (profile && actualAttemptId !== 'custom-attempt-id') {
        await notificationService.notifyUser({
          userId: profile?.id,
          title: 'CBT Completed',
          message: `You have completed the assessment. Score: ${data.score}%`,
          type: 'result',
          link: '/cbt'
        });
      }

      // Store result in local storage for the result view to pick up
      localStorage.setItem(`cbt_result_${actualAttemptId}`, JSON.stringify(data));

    } catch (e) {
      console.error(e);
    }
    onFinish(actualAttemptId);
  };

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-16 bg-[#0f172a] border border-slate-800 rounded-3xl p-8">
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 bg-rose-500/10 text-rose-500 rounded-full flex items-center justify-center">
            <AlertTriangle size={32} />
          </div>
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">No Questions Found</h2>
        <p className="text-slate-400 mb-8">We couldn't find any questions matching your selected criteria. Please adjust your configuration and try again.</p>
        <button
          onClick={onCancel}
          className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-2xl transition-colors"
        >
          Go Back
        </button>
      </div>
    );
  }

  const drillLabel = customConfig?.topic
    ? `${customConfig.courseCode} — ${customConfig.topic}`
    : customConfig?.courseCode || undefined;

  return (
    <CBTExamShell
      title="Undergraduate CBT Drill"
      badge={customConfig?.courseCode || 'Practice'}
      subtitle={drillLabel}
      questions={questions}
      answers={answers}
      currentIndex={currentIdx}
      onSelectOption={(questionId, letter) => setAnswers(prev => ({ ...prev, [questionId]: letter }))}
      onNavigate={setCurrentIdx}
      onSubmit={submitExam}
      timeLeft={timeLeft}
      submitting={submitting}
      flags={flags}
      onToggleFlag={(questionId) => setFlags(prev => ({ ...prev, [questionId]: !prev[questionId] }))}
    />
  );
}
