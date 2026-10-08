import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../../supabaseClient';
import { notificationService } from '../../lib/notificationService';
import { useProfile } from '../../lib/useProfile';
import CBTExamShell from '../cbt/CBTExamShell';

interface UTMEExamTakerProps {
  config: {
    subjectId: string;
    subjectName: string;
    mode: string;
    topicId?: string;
    count: number;
    time: number;
  };
  onFinish: (resultData: any) => void;
  onCancel: () => void;
}

/**
 * UTME sitting.
 *
 * The screen itself lives in `CBTExamShell`, shared with Post-UTME and the
 * Undergraduate drill. This component owns only what is UTME-specific: the
 * `/api/utme/start` and `/api/utme/submit` payloads, and the "practice
 * completed" notification.
 */
export default function UTMEExamTaker({ config, onFinish, onCancel }: UTMEExamTakerProps) {
  const { profile } = useProfile();
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [timeLeft, setTimeLeft] = useState(config.time * 60);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [attemptId, setAttemptId] = useState<string | null>(null);

  // React StrictMode (src/main.tsx) mounts, unmounts and remounts every
  // component in development, so this effect runs twice for one sitting and each
  // run POSTs /api/utme/start. Guarding on the identity of the sitting keeps the
  // effect re-runnable when the student genuinely starts a different exam, while
  // stopping the duplicate call that used to record a second attempt.
  const startedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const startKey = `${config.subjectId}|${config.mode}|${config.topicId ?? ''}|${config.count}|${config.time}`;
    if (startedKeyRef.current === startKey) return;
    startedKeyRef.current = startKey;

    async function initExam() {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const token = session?.access_token;

        const res = await fetch('/api/utme/start', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
          },
          body: JSON.stringify(config)
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error);

        setQuestions(data.questions || []);
        setAttemptId(data.attemptId);
      } catch (err) {
        console.error(err);
        alert('Failed to start UTME exam.');
        onCancel();
      } finally {
        setLoading(false);
      }
    }

    initExam();
  }, [config]);

  useEffect(() => {
    if (loading || timeLeft <= 0 || submitting) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleSubmit();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [loading, timeLeft, submitting]);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const token = session?.access_token;

      const res = await fetch('/api/utme/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          attemptId,
          subjectId: config.subjectId,
          mode: config.mode,
          answers,
          timeUsed: (config.time * 60) - timeLeft
        })
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      if (profile) {
        await notificationService.notifyUser({
          userId: profile.id,
          title: 'UTME Practice Completed',
          message: `Score: ${data.score}% in ${config.subjectName}`,
          type: 'result',
          link: '/utme'
        });
      }

      onFinish(data);
    } catch (err) {
      console.error(err);
      alert('Error submitting UTME exam.');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin h-10 w-10 border-4 border-purple-500 border-t-transparent rounded-full"></div>
          <p className="text-slate-400 font-medium">Preparing UTME CBT Environment...</p>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-20 bg-[#0f172a] border border-slate-800 rounded-3xl p-8">
        <AlertTriangle size={48} className="mx-auto text-amber-400 mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">No Questions Available</h2>
        <p className="text-slate-400 mb-6">There are currently no published questions matching your criteria for {config.subjectName}.</p>
        <button onClick={onCancel} className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl">
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <CBTExamShell
      title="UTME Practice Examination"
      badge={config.subjectName}
      questions={questions}
      answers={answers}
      currentIndex={currentIdx}
      onSelectOption={(questionId, letter) => setAnswers(prev => ({ ...prev, [questionId]: letter }))}
      onNavigate={setCurrentIdx}
      onSubmit={handleSubmit}
      timeLeft={timeLeft}
      submitting={submitting}
      flags={flags}
      onToggleFlag={(questionId) => setFlags(prev => ({ ...prev, [questionId]: !prev[questionId] }))}
    />
  );
}
