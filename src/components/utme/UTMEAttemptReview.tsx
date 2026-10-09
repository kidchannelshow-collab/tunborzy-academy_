import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle2, XCircle, MinusCircle, ChevronLeft, ChevronRight, ArrowLeft, Clock, Award } from 'lucide-react';
import { availableOptionLetters } from '../../lib/questionOptions';

/**
 * Read-only review of ONE saved CBT attempt.
 *
 * Deliberately presentation-only: it takes the questions as props and never
 * queries, writes, or starts anything. That is what guarantees the requirement
 * that opening a history entry creates no new attempt and duplicates no rows —
 * there is no write path in this file at all.
 *
 * The same component serves a freshly submitted attempt (from the submit
 * response) and an attempt reopened from history, because both produce the same
 * per-question shape: the student's answer, the correct option, and whether they
 * matched.
 */

export interface ReviewQuestion {
  id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  /** Fifth option. Optional: only a minority of papers carry one, and the
   *  column is nullable, so a four-option question leaves it null. */
  option_e?: string | null;
  /** null when the student never answered this question. */
  student_answer: string | null;
  correct_option: string;
  explanation: string | null;
  is_correct: boolean;
}

export interface ReviewMeta {
  subject?: string;
  score?: number;
  totalCorrect?: number;
  totalWrong?: number;
  totalUnanswered?: number;
  timeUsed?: number;
  createdAt?: string;
}

interface UTMEAttemptReviewProps {
  questions: ReviewQuestion[];
  meta?: ReviewMeta;
  onBack: () => void;
  backLabel?: string;
}

/** Exactly 10 questions per review page. */
const PAGE_SIZE = 10;

const formatTime = (secs?: number) => {
  if (!secs && secs !== 0) return null;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}m ${s}s`;
};

export default function UTMEAttemptReview({
  questions,
  meta,
  onBack,
  backLabel = 'Back',
}: UTMEAttemptReviewProps) {
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(questions.length / PAGE_SIZE));

  // Clamp instead of trusting `page`: the question list can change under us
  // (e.g. an attempt whose rows could not all be loaded), and a stale page
  // number would otherwise render an empty screen.
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const pageQuestions = useMemo(
    () => questions.slice(startIndex, startIndex + PAGE_SIZE),
    [questions, startIndex],
  );

  const goTo = (next: number) => {
    setPage(Math.min(Math.max(next, 1), totalPages));
    // Long pages: move to the top so the next question starts in view.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (questions.length === 0) {
    return (
      <div className="max-w-3xl mx-auto py-10 px-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium text-sm cursor-pointer"
        >
          <ArrowLeft size={16} /> {backLabel}
        </button>
        <div className="mt-6 p-8 bg-[#0f172a] border border-slate-800 rounded-2xl text-center text-slate-400">
          This attempt has no saved questions to review.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 pb-20 space-y-5">
      {/* Header */}
      <div className="space-y-4">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-medium text-sm cursor-pointer transition-colors"
        >
          <ArrowLeft size={16} /> {backLabel}
        </button>

        <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-bold text-white break-words">
                {meta?.subject || 'Practice Attempt'} — Review
              </h2>
              <div className="flex items-center gap-3 flex-wrap mt-1 text-xs text-slate-400">
                {meta?.createdAt && <span>{new Date(meta.createdAt).toLocaleString()}</span>}
                {formatTime(meta?.timeUsed) && (
                  <span className="flex items-center gap-1">
                    <Clock size={12} /> {formatTime(meta?.timeUsed)}
                  </span>
                )}
              </div>
            </div>
            {typeof meta?.score === 'number' && (
              <div className="text-right shrink-0">
                <div className="text-2xl font-bold text-amber-400 flex items-center gap-1.5">
                  <Award size={20} /> {meta.score}%
                </div>
                <div className="text-xs text-slate-500">
                  {meta.totalCorrect ?? 0} correct · {meta.totalWrong ?? 0} wrong
                  {meta.totalUnanswered ? ` · ${meta.totalUnanswered} unanswered` : ''}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Questions — one per row, in a single straight column */}
      <div className="space-y-5">
        {pageQuestions.map((q, idx) => {
          const number = startIndex + idx + 1;
          const answered = !!q.student_answer;
          const status = !answered ? 'unanswered' : q.is_correct ? 'correct' : 'incorrect';

          const statusStyles =
            status === 'correct'
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              : status === 'incorrect'
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                : 'bg-slate-700/40 text-slate-300 border-slate-600';
          const StatusIcon =
            status === 'correct' ? CheckCircle2 : status === 'incorrect' ? XCircle : MinusCircle;
          const StatusLabel =
            status === 'correct' ? 'Correct' : status === 'incorrect' ? 'Incorrect' : 'Not answered';

          const cardAccent =
            status === 'correct'
              ? 'border-emerald-500/30'
              : status === 'incorrect'
                ? 'border-rose-500/30'
                : 'border-slate-700';

          return (
            <motion.div
              key={q.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className={`bg-[#0f172a] border rounded-2xl p-5 sm:p-6 space-y-4 ${cardAccent}`}
            >
              {/* Question number + result */}
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Question {number}
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold border flex items-center gap-1.5 ${statusStyles}`}
                >
                  <StatusIcon size={13} /> {StatusLabel}
                </span>
              </div>

              {/* Question text */}
              <p className="text-base sm:text-lg font-medium text-white break-words [overflow-wrap:anywhere]">
                {q.question_text}
              </p>

              {/* Options — stacked vertically, each labelled. Only the letters
                  this question actually has text for: a five-option paper shows
                  its E here, a four-option one is not given an empty fifth slot. */}
              <div className="space-y-2.5">
                {availableOptionLetters(q).map((letter) => {
                  const text = (q as any)[`option_${letter.toLowerCase()}`];
                  const studentPicked = q.student_answer === letter;
                  const isCorrect = (q.correct_option || '').toUpperCase() === letter;

                  // Green = the right answer. Red = what the student chose when
                  // it was wrong. Everything else stays neutral.
                  let box = 'bg-slate-900/60 border-slate-800 text-slate-300';
                  if (isCorrect) box = 'bg-emerald-500/15 border-emerald-500/60 text-emerald-100';
                  else if (studentPicked) box = 'bg-rose-500/15 border-rose-500/60 text-rose-100';

                  return (
                    <div key={letter} className={`p-3.5 rounded-xl border flex items-start gap-3 ${box}`}>
                      <div className="w-6 h-6 shrink-0 rounded-lg bg-slate-900 border border-slate-700 flex items-center justify-center text-xs font-bold text-white">
                        {letter}
                      </div>
                      <div className="text-sm flex-1 break-words [overflow-wrap:anywhere]">
                        {text || <span className="text-slate-500 italic">(no text)</span>}
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {studentPicked && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 bg-slate-800 px-2 py-0.5 rounded">
                            Your answer
                          </span>
                        )}
                        {isCorrect && (
                          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-300 bg-emerald-500/20 px-2 py-0.5 rounded">
                            Correct
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Answer summary line — explicit on small screens where the
                  badges above may be the only cue. */}
              <div className="flex items-center gap-4 flex-wrap text-xs text-slate-400 pt-1">
                <span>
                  Your answer:{' '}
                  <span className={q.is_correct ? 'text-emerald-300 font-bold' : 'text-rose-300 font-bold'}>
                    {q.student_answer || 'Not answered'}
                  </span>
                </span>
                <span>
                  Correct answer:{' '}
                  <span className="text-emerald-300 font-bold">{q.correct_option || '—'}</span>
                </span>
              </div>

              {/* Explanation when available */}
              <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-xl">
                <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block mb-1">
                  Explanation
                </span>
                <p className="text-sm text-slate-300 break-words [overflow-wrap:anywhere]">
                  {q.explanation?.trim() || (
                    <span className="text-slate-500 italic">No explanation available for this question yet.</span>
                  )}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Previous / Next */}
      <div className="flex items-center justify-between gap-3 bg-[#0f172a] border border-slate-800 rounded-2xl p-4">
        <button
          onClick={() => goTo(safePage - 1)}
          disabled={safePage === 1}
          className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
        >
          <ChevronLeft size={16} /> <span className="hidden sm:inline">Previous</span>
        </button>

        <span className="text-xs sm:text-sm text-slate-300 font-medium text-center">
          Page {safePage} of {totalPages}
          <span className="block text-[11px] text-slate-500">
            Questions {startIndex + 1}–{Math.min(startIndex + PAGE_SIZE, questions.length)} of{' '}
            {questions.length}
          </span>
        </span>

        <button
          onClick={() => goTo(safePage + 1)}
          disabled={safePage === totalPages}
          className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
        >
          <span className="hidden sm:inline">Next</span> <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
