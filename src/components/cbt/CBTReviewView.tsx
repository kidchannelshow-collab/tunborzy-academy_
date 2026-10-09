import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, CheckCircle2, FileText, XCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { availableOptionLetters } from '../../lib/questionOptions';
import { supabase } from '../../supabaseClient';

export default function CBTReviewView({ attemptId, onBack }: any) {
  const [result, setResult] = useState<any>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadReview() {
      try {
        if (attemptId === 'custom-attempt-id') {
          // Read from local storage
          const stored = localStorage.getItem(`cbt_custom_${attemptId}`);
          if (stored) {
            const data = JSON.parse(stored);
            setResult(data);
            setQuestions(data.questions || []);
          } else {
            setResult(null);
            setQuestions([]);
          }
        } else {
          // Fetch attempt info
          const { data: attempt, error: attemptErr } = await supabase
            .from('cbt_attempts')
            .select('*')
            .eq('id', attemptId)
            .single();
          if (attemptErr) throw attemptErr;
          
          let qs = [];
          if (attempt.answers && attempt.answers.question_ids) {
            const { data: qData, error: qsErr } = await supabase
              .from('cbt_questions')
              .select('*')
              .in('id', attempt.answers.question_ids);
            if (qsErr) throw qsErr;
            qs = qData || [];
          } else {
            const { data: qData, error: qsErr } = await supabase
              .from('cbt_questions')
              .select('*')
              .eq('exam_id', attempt.exam_id);
            if (qsErr) throw qsErr;
            qs = qData || [];
          }
          
          const answersMap: Record<string, string> = attempt.answers?.student_answers || {};
          
          setResult({ answers: answersMap });
          setQuestions(qs || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadReview();
  }, [attemptId]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[50vh]">
      <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full"></div>
    </div>;
  }

  if (questions.length === 0) return <div>No questions found for review.</div>;

  const q = questions[currentIdx];
  const selectedOption = result?.answers?.[q.id];
  const isCorrect = selectedOption === q.correct_option;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto space-y-6 pb-12">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 bg-[#0f172a] text-slate-400 hover:text-white rounded-xl border border-slate-800 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-display font-bold text-white">Review Answers</h1>
            <p className="text-slate-400">Question {currentIdx + 1} of {questions.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedOption === undefined ? (
            <span className="px-3 py-1 bg-slate-800 text-slate-400 rounded-lg text-sm font-medium">Unanswered</span>
          ) : isCorrect ? (
            <span className="flex items-center gap-1 px-3 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg text-sm font-bold border border-emerald-500/20">
              <CheckCircle2 size={16} /> Correct
            </span>
          ) : (
            <span className="flex items-center gap-1 px-3 py-1 bg-rose-500/10 text-rose-500 rounded-lg text-sm font-bold border border-rose-500/20">
              <XCircle size={16} /> Incorrect
            </span>
          )}
        </div>
      </div>

      <div className="bg-[#0f172a] border border-slate-800 rounded-3xl p-6 md:p-8">
        <h2 className="text-xl md:text-2xl font-body text-white leading-relaxed mb-8">
          {q.question_text}
        </h2>
        {q.image_url && (
          <img loading="lazy" src={q.image_url} alt="Question Context" className="max-w-full h-auto rounded-xl border border-slate-800 mb-8" />
        )}
        
        <div className="space-y-3">
          {/* Only the letters this question has text for — so a five-option
              paper reviews its E, and a four-option one has no empty fifth row. */}
          {availableOptionLetters(q).map((letter) => {
            const optKey = 'option_' + letter.toLowerCase();
            const optText = q[optKey];
            if (!optText) return null;
            const isSelected = selectedOption === letter;
            const isActualCorrect = q.correct_option === letter;
            
            let bgClass = "bg-slate-900/50 border-slate-800";
            let textClass = "text-slate-300";
            let icon = null;

            if (isActualCorrect) {
              bgClass = "bg-emerald-500/10 border-emerald-500 shadow-lg shadow-emerald-500/10";
              textClass = "text-emerald-400 font-medium";
              icon = <CheckCircle2 size={20} className="text-emerald-500 shrink-0" />;
            } else if (isSelected && !isActualCorrect) {
              bgClass = "bg-rose-500/10 border-rose-500";
              textClass = "text-rose-400";
              icon = <XCircle size={20} className="text-rose-500 shrink-0" />;
            }

            return (
              <div
                key={letter}
                className={`w-full text-left p-4 md:p-5 rounded-xl border-2 transition-all flex items-center justify-between gap-4 ${bgClass}`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-8 h-8 md:w-10 md:h-10 shrink-0 rounded-full flex items-center justify-center font-action font-bold text-sm border-2 ${isActualCorrect ? 'bg-emerald-500 border-emerald-500 text-slate-950' : isSelected ? 'bg-rose-500 border-rose-500 text-slate-950' : 'border-slate-600 text-slate-400'}`}>
                    {letter}
                  </div>
                  <span className={`font-body text-base md:text-lg ${textClass}`}>{optText}</span>
                </div>
                {icon}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-[#0f172a] border border-blue-500/20 rounded-3xl p-6 md:p-8">
        <h3 className="font-bold text-blue-400 mb-2 flex items-center gap-2">
          <FileText size={18} /> Detailed Explanation
        </h3>
        <p className="text-slate-300 leading-relaxed">
          {q.explanation || "No explanation provided for this question. It follows standard academic principles for this subject topic."}
        </p>
      </div>

      <div className="flex items-center justify-between">
        <button 
          onClick={() => setCurrentIdx(prev => Math.max(0, prev - 1))}
          disabled={currentIdx === 0}
          className="px-6 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl font-action font-semibold transition-colors flex items-center gap-2"
        >
          <ChevronLeft size={20} /> Previous
        </button>
        <button 
          onClick={() => setCurrentIdx(prev => Math.min(questions.length - 1, prev + 1))}
          disabled={currentIdx === questions.length - 1}
          className="px-6 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white rounded-xl font-action font-semibold transition-colors flex items-center gap-2"
        >
          Next <ChevronRight size={20} />
        </button>
      </div>
    </motion.div>
  );
}
