import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { Plus, Trash2, ArrowLeft, Save, Edit2, AlertCircle } from 'lucide-react';
import { OPTION_LETTERS, hasOptionE } from '../../lib/questionOptions';

interface Question {
  id: string;
  exam_id: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  option_e: string;
  correct_option: string;
  marks: number;
  topic?: string;
  difficulty?: string;
}

interface Props {
  examId: string;
  onBack: () => void;
}

export default function CBTQuestionManager({ examId, onBack }: Props) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Question>>({});
  
  useEffect(() => {
    fetchQuestions();
  }, [examId]);

  const fetchQuestions = async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('cbt_questions')
      .select('*')
      .eq('exam_id', examId)
      .order('created_at', { ascending: true });
      
    if (!error && data) {
      setQuestions(data);
    }
    setLoading(false);
  };

  const startNew = () => {
    setEditingId('new');
    setFormData({
      question_text: '',
      option_a: '',
      option_b: '',
      option_c: '',
      option_d: '',
      option_e: '',
      correct_option: 'A',
      marks: 1
    });
  };

  const editQuestion = (q: Question) => {
    setEditingId(q.id);
    // Older papers predate the fifth option, so `option_e` can come back NULL.
    // Normalise it to '' so the form state stays a string throughout.
    setFormData({ ...q, option_e: q.option_e || '' });
  };

  const deleteQuestion = async (id: string) => {
    if (!confirm('Are you sure you want to delete this question?')) return;
    if (!supabase) return;
    await supabase.from('cbt_questions').delete().eq('id', id);
    fetchQuestions();
  };

  const saveQuestion = async () => {
    if (!supabase) return;
    const payload = {
      exam_id: examId,
      question_text: formData.question_text,
      option_a: formData.option_a,
      option_b: formData.option_b,
      option_c: formData.option_c,
      option_d: formData.option_d,
      // Empty string rather than undefined, so a four-option question clears the
      // column instead of leaving the previous fifth option in place.
      option_e: formData.option_e || '',
      correct_option: formData.correct_option,
      marks: formData.marks || 1
    };

    if (editingId === 'new') {
      await supabase.from('cbt_questions').insert(payload);
    } else if (editingId) {
      await supabase.from('cbt_questions').update(payload).eq('id', editingId);
    }
    setEditingId(null);
    fetchQuestions();
  };

  if (loading) {
    return <div className="text-white p-8">Loading questions...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="p-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-white">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-display font-bold text-white">Manage Questions</h1>
          <p className="text-slate-400">Add, edit or remove questions for this exam.</p>
        </div>
        <button 
          onClick={startNew}
          className="ml-auto bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2 rounded-xl flex items-center gap-2"
        >
          <Plus size={18} />
          Add Question
        </button>
      </div>

      <div className="space-y-4">
        {questions.length === 0 && editingId === null && (
          <div className="text-center p-12 bg-slate-900 border border-slate-800 rounded-2xl text-slate-400">
            <AlertCircle className="mx-auto mb-4 opacity-50" size={48} />
            <p>No questions added yet.</p>
          </div>
        )}

        {editingId && (
          <div className="bg-slate-900 border border-amber-500/50 rounded-2xl p-6 shadow-xl mb-6">
            <h3 className="text-xl font-bold text-white mb-4">{editingId === 'new' ? 'New Question' : 'Edit Question'}</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm font-bold text-slate-300 block mb-1">Question Text</label>
                <textarea 
                  value={formData.question_text || ''} 
                  onChange={e => setFormData({...formData, question_text: e.target.value})}
                  className="w-full bg-[#020617] border border-slate-800 rounded-xl px-4 py-3 text-white h-24 focus:border-amber-500 outline-none"
                  placeholder="Enter the question here..."
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Nothing here is marked required, so E is simply left blank on
                    the four-option papers most questions use. */}
                {['a', 'b', 'c', 'd', 'e'].map(opt => (
                  <div key={opt}>
                    <label className="text-sm font-bold text-slate-300 block mb-1 uppercase">Option {opt}</label>
                    <input 
                      type="text" 
                      value={formData[`option_${opt}` as keyof Question] as string || ''} 
                      onChange={e => setFormData({...formData, [`option_${opt}`]: e.target.value})}
                      className="w-full bg-[#020617] border border-slate-800 rounded-xl px-4 py-2 text-white focus:border-amber-500 outline-none"
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 pt-2">
                <div className="flex-1">
                  <label className="text-sm font-bold text-slate-300 block mb-1">Correct Option</label>
                  <select 
                    value={formData.correct_option || 'A'} 
                    onChange={e => setFormData({...formData, correct_option: e.target.value})}
                    className="w-full bg-[#020617] border border-slate-800 rounded-xl px-4 py-2 text-white focus:border-amber-500 outline-none"
                  >
                    {OPTION_LETTERS.map(o => (
                      <option key={o} value={o}>Option {o}</option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-sm font-bold text-slate-300 block mb-1">Marks</label>
                  <input 
                    type="number" 
                    value={formData.marks || 1} 
                    onChange={e => setFormData({...formData, marks: parseInt(e.target.value) || 1})}
                    className="w-full bg-[#020617] border border-slate-800 rounded-xl px-4 py-2 text-white focus:border-amber-500 outline-none"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button onClick={() => setEditingId(null)} className="px-4 py-2 text-slate-400 hover:text-white transition-colors">Cancel</button>
                <button onClick={saveQuestion} className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg flex items-center gap-2">
                  <Save size={16} /> Save Question
                </button>
              </div>
            </div>
          </div>
        )}

        {questions.map((q, i) => (
          <div key={q.id} className="bg-slate-900 border border-slate-800 rounded-xl p-5 group transition-colors hover:border-slate-700">
            <div className="flex justify-between items-start mb-3">
              <h4 className="text-white font-bold"><span className="text-amber-500 mr-2">Q{i+1}.</span> {q.question_text}</h4>
              <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => editQuestion(q)} className="p-2 text-slate-400 hover:text-amber-500 rounded-lg"><Edit2 size={16}/></button>
                <button onClick={() => deleteQuestion(q.id)} className="p-2 text-slate-400 hover:text-rose-500 rounded-lg"><Trash2 size={16}/></button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className={`p-2 rounded ${q.correct_option === 'A' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[#020617] text-slate-400'}`}>A: {q.option_a}</div>
              <div className={`p-2 rounded ${q.correct_option === 'B' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[#020617] text-slate-400'}`}>B: {q.option_b}</div>
              <div className={`p-2 rounded ${q.correct_option === 'C' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[#020617] text-slate-400'}`}>C: {q.option_c}</div>
              <div className={`p-2 rounded ${q.correct_option === 'D' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[#020617] text-slate-400'}`}>D: {q.option_d}</div>
              {/* Only five-option papers get an E row; an empty slot would just
                  be dead space on the four-option majority. */}
              {hasOptionE(q) && (
                <div className={`p-2 rounded ${q.correct_option === 'E' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-[#020617] text-slate-400'}`}>E: {q.option_e}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
