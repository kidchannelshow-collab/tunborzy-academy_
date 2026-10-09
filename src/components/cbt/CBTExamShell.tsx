import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, ArrowRight, Clock, Flag, Send, AlertTriangle } from 'lucide-react';
import { OPTION_LETTERS, availableOptionLetters } from '../../lib/questionOptions';

/**
 * The one CBT test-taking interface, shared by UTME, Post-UTME and Undergraduate.
 *
 * WHY THIS EXISTS
 *
 * All three programmes had grown their own exam screen — different layouts,
 * different palettes (emerald / amber / indigo), and different features: only
 * Undergraduate had keyboard shortcuts, only UTME rendered question images, and
 * the question navigator sat in a desktop sidebar on two of them while the third
 * put it below the question. A student moved between programmes and the exam
 * looked like a different product each time.
 *
 * The Post-UTME screen is the template, as agreed: a single column — header,
 * question card, then the numbered navigator underneath — which reads the same
 * on a phone as on a desktop. The two features the other screens had and this
 * one did not (flagging, keyboard shortcuts) are kept here as OPTIONAL props, so
 * a caller that never had them is not given a button that does nothing.
 *
 * PURPLE + YELLOW
 *   purple  primary actions and active indicators — Submit, Next, the current
 *           question number, the programme badge.
 *   yellow  attention and progress — the timer, the selected option, answered
 *           questions, flags.
 *   slate   everything inert.
 *
 * PRESENTATIONAL ONLY. This owns no fetching, no scoring and no attempt state —
 * each caller keeps its own endpoint, its own payload and its own submit. It
 * renders what it is handed and reports interactions back through callbacks.
 */

export interface CBTExamShellProps {
  /** Shown in the header, e.g. "UTME Practice Examination". */
  title: string;
  /** Small badge above the title, e.g. the subject or university. */
  badge?: string;
  /** Clarifying line under the header, e.g. the paper's subject. */
  subtitle?: string;

  questions: any[];
  answers: Record<string, string>;
  currentIndex: number;

  onSelectOption: (questionId: string, letter: string) => void;
  onNavigate: (index: number) => void;
  onSubmit: () => void;

  /** Seconds remaining. The timer turns red and pulses under five minutes. */
  timeLeft: number;

  submitting?: boolean;
  /** Label on the submit button; defaults to "Submit Exam". */
  submitLabel?: string;

  /** Omit both to render no flag control — a caller without flags gets no button. */
  flags?: Record<string, boolean>;
  onToggleFlag?: (questionId: string) => void;

  /** Rendered under the navigator, e.g. a subject/mode summary. */
  footer?: React.ReactNode;
}

const FIVE_MINUTES = 300;

export default function CBTExamShell({
  title,
  badge,
  subtitle,
  questions,
  answers,
  currentIndex,
  onSelectOption,
  onNavigate,
  onSubmit,
  timeLeft,
  submitting = false,
  submitLabel = 'Submit Exam',
  flags,
  onToggleFlag,
  footer,
}: CBTExamShellProps) {
  const [showConfirm, setShowConfirm] = React.useState(false);

  const supportsFlags = typeof onToggleFlag === 'function';
  const question = questions[currentIndex];
  const answeredCount = Object.keys(answers).length;
  const unansweredCount = Math.max(0, questions.length - answeredCount);

  /**
   * Keyboard shortcuts, previously Undergraduate-only. Enabled only while an
   * exam is on screen and no confirm dialog is open — otherwise the keystroke
   * meant for the dialog would change the answer behind it.
   */
  useEffect(() => {
    if (!question || showConfirm) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') onNavigate(Math.min(questions.length - 1, currentIndex + 1));
      else if (e.key === 'ArrowLeft') onNavigate(Math.max(0, currentIndex - 1));
      else if (e.key.toLowerCase() === 'f' && supportsFlags) onToggleFlag!(question.id);
      else {
        const letter = e.key.toUpperCase();
        // Only letters this question actually carries. Keying 'E' on a
        // four-option question would record an answer for an option that is not
        // on screen.
        if ((OPTION_LETTERS as readonly string[]).includes(letter) &&
            availableOptionLetters(question).includes(letter as any)) {
          onSelectOption(question.id, letter);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    question,
    showConfirm,
    currentIndex,
    questions.length,
    supportsFlags,
    onNavigate,
    onSelectOption,
    onToggleFlag,
  ]);

  const formatTime = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!question) return null;

  const isFlagged = supportsFlags && flags?.[question.id] === true;
  const timeIsLow = timeLeft < FIVE_MINUTES;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">

      {/* ---------- Header: identity, timer, submit ---------- */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-5 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 sticky top-4 z-20 backdrop-blur-md">
        <div className="min-w-0 w-full sm:w-auto">
          {badge && (
            <span className="text-xs font-bold px-2.5 py-1 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
              {badge}
            </span>
          )}
          <h2 className="font-bold text-white text-base mt-1 break-words">{title}</h2>
          {subtitle && <p className="text-xs text-slate-400 mt-0.5 break-words">{subtitle}</p>}
        </div>

        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <div
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-mono font-bold text-sm border ${
              timeIsLow
                ? 'bg-rose-500/10 border-rose-500/40 text-rose-400 animate-pulse'
                : 'bg-slate-900 border-slate-800 text-amber-400'
            }`}
            aria-label="Time remaining"
          >
            <Clock className="w-4 h-4" /> {formatTime(timeLeft)}
          </div>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={submitting}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded-xl font-bold text-sm shadow-sm transition-colors flex items-center gap-2"
          >
            <Send className="w-4 h-4" /> {submitLabel}
          </button>
        </div>
      </div>

      {/* ---------- Question card ---------- */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 md:p-8 space-y-6 shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <span className="text-sm font-bold text-purple-400">
            Question {currentIndex + 1} of {questions.length}
          </span>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">
              Answered: <span className="text-amber-400 font-bold">{answeredCount}</span>/{questions.length}
            </span>
            {supportsFlags && (
              <button
                onClick={() => onToggleFlag!(question.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
                  isFlagged
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                    : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                <Flag size={13} className={isFlagged ? 'fill-amber-400' : ''} />
                {isFlagged ? 'Flagged' : 'Flag'}
              </button>
            )}
          </div>
        </div>

        {/* min-w-0 / break-words stop a long unbroken token (a URL or a formula)
            from widening the card or escaping it. */}
        <p className="text-lg font-semibold text-white leading-relaxed break-words min-w-0">
          {question.question_text}
        </p>

        {question.image_url && (
          <img
            loading="lazy"
            src={question.image_url}
            alt="Question context"
            className="max-w-full h-auto rounded-xl border border-slate-800"
          />
        )}

        <div className="space-y-3">
          {OPTION_LETTERS.map((opt) => {
            const text = question[`option_${opt.toLowerCase()}`];
            // An option with no text is not rendered at all. That covers two
            // cases with one rule: some imported papers genuinely carry only
            // three, and a five-option paper renders its E here without the
            // four-option majority being given an empty fifth slot.
            if (!text) return null;

            const isSelected = answers[question.id] === opt;
            return (
              <button
                key={opt}
                onClick={() => onSelectOption(question.id, opt)}
                className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center gap-4 min-w-0 ${
                  isSelected
                    ? 'bg-amber-500/10 border-amber-500 shadow-sm'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                <span
                  className={`w-8 h-8 rounded-xl font-bold text-sm flex items-center justify-center shrink-0 border ${
                    isSelected
                      ? 'bg-amber-500 border-amber-500 text-slate-950'
                      : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  {opt}
                </span>
                <span
                  className={`text-sm font-medium flex-1 min-w-0 break-words ${
                    isSelected ? 'text-white' : 'text-slate-200'
                  }`}
                >
                  {text}
                </span>
              </button>
            );
          })}
        </div>

        {/* ---------- Previous / Next ---------- */}
        <div className="flex items-center justify-between pt-6 border-t border-slate-800">
          <button
            onClick={() => onNavigate(Math.max(0, currentIndex - 1))}
            disabled={currentIndex === 0}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl text-sm font-medium text-white flex items-center gap-2 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Previous
          </button>
          <button
            onClick={() => onNavigate(Math.min(questions.length - 1, currentIndex + 1))}
            disabled={currentIndex === questions.length - 1}
            className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-bold shadow-sm flex items-center gap-2 transition-colors"
          >
            Next <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ---------- Number navigator ---------- */}
      <div className="bg-[#0f172a] border border-slate-800 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap gap-2 justify-center">
          {questions.map((q, idx) => {
            const isCurrent = idx === currentIndex;
            const isAnswered = !!answers[q.id];
            const flagged = supportsFlags && flags?.[q.id] === true;

            // Current wins over answered, so the question being read is never
            // ambiguous with one that merely has an answer already.
            const stateClass = isCurrent
              ? 'bg-purple-600 text-white ring-2 ring-purple-400 ring-offset-2 ring-offset-[#0f172a]'
              : isAnswered
              ? 'bg-amber-500/20 border border-amber-500/50 text-amber-300'
              : 'bg-slate-900 border border-slate-800 text-slate-400 hover:border-slate-600';

            return (
              <button
                key={q.id ?? idx}
                onClick={() => onNavigate(idx)}
                aria-label={`Go to question ${idx + 1}${isAnswered ? ', answered' : ', unanswered'}`}
                aria-current={isCurrent ? 'true' : undefined}
                className={`relative w-9 h-9 rounded-xl font-bold text-xs flex items-center justify-center transition-all ${stateClass}`}
              >
                {idx + 1}
                {flagged && (
                  <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-400 border-2 border-[#0f172a] flex items-center justify-center">
                    <Flag size={7} className="text-[#0f172a] fill-[#0f172a]" />
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 pt-1 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-purple-600" /> Current
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-amber-500/30 border border-amber-500" /> Answered
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded bg-slate-900 border border-slate-700" /> Unanswered
          </span>
          {supportsFlags && (
            <span className="flex items-center gap-1.5">
              <Flag size={11} className="text-amber-400" /> Flagged
            </span>
          )}
        </div>
      </div>

      {footer}

      {/* ---------- Submit confirmation ---------- */}
      <AnimatePresence>
        {showConfirm && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#0f172a] border border-slate-800 rounded-3xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="flex justify-center mb-6">
                <div className="w-16 h-16 bg-amber-500/10 text-amber-400 rounded-full flex items-center justify-center">
                  <AlertTriangle size={32} />
                </div>
              </div>
              <h3 className="text-2xl font-bold text-white text-center mb-2">Ready to submit?</h3>
              <p className="text-slate-400 text-center mb-6">
                You have answered{' '}
                <strong className="text-amber-400">{answeredCount}</strong> of{' '}
                <strong className="text-white">{questions.length}</strong> questions. Once submitted,
                your answers cannot be changed.
              </p>

              {unansweredCount > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-300 p-3 rounded-xl text-sm mb-6 text-center">
                  {unansweredCount} question{unansweredCount === 1 ? '' : 's'} left unanswered.
                </div>
              )}

              <div className="flex gap-4">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold transition-colors"
                >
                  Continue Exam
                </button>
                <button
                  onClick={onSubmit}
                  disabled={submitting}
                  className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white font-bold transition-colors"
                >
                  {submitting ? 'Submitting…' : 'Confirm Submit'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
