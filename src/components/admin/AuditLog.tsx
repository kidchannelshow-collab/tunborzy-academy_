import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { History, Search, Eye, Filter, Calendar } from 'lucide-react';
import { supabase } from '../../supabaseClient';

interface LogRecord {
  id: string;
  action: string;
  admin: string;
  date: string;
  time: string;
}

export default function AuditLog() {
  const [searchTerm, setSearchTerm] = useState('');
  const [logs, setLogs] = useState<LogRecord[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Hoisted out of the effect so the Realtime handler below can reuse it — the
   * subscription and the first paint must run exactly the same query.
   */
  const fetchLogs = React.useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    if (!supabase) {
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!error && data) {
      setLogs(data.map(d => {
        const dateObj = new Date(d.created_at);
        return {
          id: d.id,
          action: d.action_details || d.action,
          admin: d.performed_by || 'System',
          date: dateObj.toLocaleDateString(),
          time: dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
      }));
    } else {
      setLogs([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchLogs(true);
  }, [fetchLogs]);

  /**
   * Live audit trail.
   *
   * The page fetched once on mount and then never again, so an action taken
   * while it was open — including the admin's own settings saves, which write
   * `audit_logs` from the server — only appeared after a manual reload. That is
   * precisely the screen where staleness is least acceptable, because its whole
   * purpose is to show what just happened.
   *
   * Every event reloads rather than inserting the payload: rows are written by
   * the API with `action_details`/`performed_by`, and re-reading runs the same
   * mapping and ordering the initial load uses, so the table cannot drift from
   * what a refresh would show. Reloads are coalesced because a settings save
   * writes its audit row immediately before other writes can follow.
   */
  useEffect(() => {
    if (!supabase) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void fetchLogs(false); }, 500);
    };

    const channel = supabase
      .channel('admin_audit_logs_live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'audit_logs' }, scheduleReload)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [fetchLogs]);

  const filteredLogs = logs.filter(log => 
    log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.admin.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.date.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 max-w-7xl mx-auto"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold text-white mb-2 flex items-center gap-3">
            <History className="text-slate-400" size={28} /> Audit Log
          </h1>
          <p className="text-sm font-body text-slate-400">Comprehensive record of all administrative actions on the platform.</p>
        </div>
        <button className="bg-[#020617] border border-slate-700 hover:border-slate-500 text-slate-300 px-4 py-2 rounded-xl text-sm font-bold transition-colors flex items-center gap-2">
          <Eye size={16} /> View CSV
        </button>
      </div>

      <div className="bg-[#0f172a]/80 backdrop-blur-md border border-slate-800 rounded-3xl p-6">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
            <input 
              type="text" 
              placeholder="Search logs by action, admin, or date..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#020617] border border-slate-800 text-white text-sm rounded-xl py-3 pl-12 pr-4 focus:outline-none focus:border-slate-500 transition-colors"
            />
          </div>
          <div className="flex gap-2">
            <button className="bg-[#020617] border border-slate-800 hover:border-slate-700 text-slate-300 px-4 py-3 rounded-xl text-sm font-medium transition-colors flex items-center gap-2">
              <Filter size={16} /> Filter
            </button>
            <button className="bg-[#020617] border border-slate-800 hover:border-slate-700 text-slate-300 px-4 py-3 rounded-xl text-sm font-medium transition-colors flex items-center gap-2">
              <Calendar size={16} /> Date Range
            </button>
          </div>
        </div>

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[800px] text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 text-sm">
                <th className="pb-3 font-semibold">Action Performed</th>
                <th className="pb-3 font-semibold">Administrator</th>
                <th className="pb-3 font-semibold">Date</th>
                <th className="pb-3 font-semibold">Time</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map((log) => (
                <tr key={log.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                  <td className="py-4">
                    <span className="text-white font-medium text-sm">{log.action}</span>
                  </td>
                  <td className="py-4">
                    <span className="flex items-center gap-2 text-sm text-slate-300">
                      <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-400 uppercase">
                        {log.admin.charAt(0)}
                      </div>
                      {log.admin}
                    </span>
                  </td>
                  <td className="py-4 text-sm text-slate-400">{log.date}</td>
                  <td className="py-4 text-sm text-slate-400 font-mono">{log.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </motion.div>
  );
}
