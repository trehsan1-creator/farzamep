import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, CheckCircle2, CircleAlert, KeyRound, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';
import { toPersianDigits } from '../lib/persian';

type LogRow = { agent_name: string; tool_name: string; status: string; latency_ms: number; created_at: string; error_message?: string | null };

export function AgentManagementCenter() {
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [endpointStatus, setEndpointStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const endpoint = 'https://lssccfjhnkjpihmawjdd.supabase.co/functions/v1/farzam-mcp';

  const load = async () => {
    setLoading(true);
    const client = getSupabaseClient();
    if (client) {
      const { data } = await client.from('agent_execution_logs').select('agent_name,tool_name,status,latency_ms,created_at,error_message').order('created_at', { ascending: false }).limit(100);
      setLogs((data ?? []) as LogRow[]);
    }
    try {
      const response = await fetch(endpoint, { headers: { Accept: 'application/json' } });
      setEndpointStatus(response.ok ? 'online' : 'offline');
    } catch { setEndpointStatus('offline'); }
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);
  const agents = useMemo(() => Array.from(new Set(logs.map((row) => row.agent_name))), [logs]);
  const success = logs.filter((row) => row.status === 'OK').length;
  const failures = logs.filter((row) => row.status !== 'OK').length;

  return <main dir="rtl" className="space-y-6 p-5 lg:p-8">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-[#FF9A3D]"><ShieldCheck className="h-5 w-5" /><span className="text-xs font-bold tracking-[0.18em]">AGENT GOVERNANCE</span></div><h1 className="text-2xl font-extrabold text-white">مرکز مدیریت Agentها</h1><p className="mt-2 text-sm text-[#A8B8CC]">نمای واحد اتصال‌های مستقل، سطح ابزار، فعالیت و ممیزی Gateway.</p></div>
      <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />به‌روزرسانی</button>
    </div>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={<KeyRound />} label="Agentهای مشاهده‌شده" value={agents.length || 1} hint="هویت مستقل و قابل لغو" />
      <Metric icon={<Activity />} label="درخواست‌های ثبت‌شده" value={logs.length} hint="۱۰۰ فعالیت اخیر" />
      <Metric icon={<CheckCircle2 />} label="موفق" value={success} hint="پاسخ معتبر Gateway" green />
      <Metric icon={<XCircle />} label="ناموفق" value={failures} hint="نیازمند بررسی" red />
    </section>
    <section className="grid gap-4 xl:grid-cols-[1.1fr_1.9fr]">
      <div className="rounded-2xl border border-white/10 bg-[#152B40] p-5"><h2 className="mb-4 font-bold text-white">وضعیت اتصال‌ها</h2><div className="rounded-xl border border-white/10 bg-[#0D2032] p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><span className={`h-3 w-3 rounded-full ${endpointStatus === 'online' ? 'bg-emerald-400 shadow-[0_0_12px_#34d399]' : endpointStatus === 'checking' ? 'animate-pulse bg-amber-400' : 'bg-red-400'}`} /><div><div className="font-semibold text-white">Muse / MCP Gateway</div><div className="mt-1 text-xs text-[#8EA4BA]">Streamable HTTP · کلید هش‌شده · scope مستقل</div></div></div><span className="text-xs text-[#A8B8CC]">{endpointStatus === 'online' ? 'آنلاین' : endpointStatus === 'checking' ? 'در حال بررسی' : 'آفلاین'}</span></div><div className="mt-4 break-all rounded-lg bg-black/20 p-3 font-mono text-[11px] text-[#91A7BC]">{endpoint}</div></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div className="rounded-xl bg-white/5 p-3 text-[#B7C7D8]">مجوز خواندن<br /><b className="text-white">Query / Reports</b></div><div className="rounded-xl bg-white/5 p-3 text-[#B7C7D8]">مجوز نوشتن<br /><b className="text-white">Draft + Approval</b></div></div></div>
      <div className="rounded-2xl border border-white/10 bg-[#152B40] p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-bold text-white">فعالیت Agentها</h2><span className="text-xs text-[#8EA4BA]">ممیزی backend</span></div><div className="overflow-auto"><table className="w-full text-right text-xs"><thead className="text-[#8EA4BA]"><tr><th className="pb-3">Agent</th><th className="pb-3">Tool</th><th className="pb-3">وضعیت</th><th className="pb-3">زمان</th></tr></thead><tbody>{logs.slice(0, 12).map((row, index) => <tr key={`${row.created_at}-${index}`} className="border-t border-white/5"><td className="py-3 font-semibold text-white">{row.agent_name}</td><td className="py-3 font-mono text-[#B7C7D8]">{row.tool_name}</td><td className="py-3">{row.status === 'OK' ? <span className="text-emerald-400">موفق</span> : <span className="text-red-400">خطا</span>}</td><td className="py-3 text-[#8EA4BA]">{toPersianDigits(row.latency_ms ?? 0)}ms</td></tr>)}{!logs.length && <tr><td colSpan={4} className="py-10 text-center text-[#8EA4BA]">هنوز فعالیتی ثبت نشده است.</td></tr>}</tbody></table></div></div>
    </section>
    <div className="flex items-center gap-2 rounded-xl border border-amber-400/20 bg-amber-400/5 p-4 text-xs text-amber-100"><CircleAlert className="h-4 w-4 shrink-0 text-amber-300" />عملیات حساس مانند قطعی‌سازی سند و بستن سال مالی از طریق approval انسانی انجام می‌شود؛ Agent فقط در scope مجاز خود عمل می‌کند.</div>
  </main>;
}

function Metric({ icon, label, value, hint, green, red }: { icon: ReactNode; label: string; value: number; hint: string; green?: boolean; red?: boolean }) { return <div className="rounded-2xl border border-white/10 bg-[#152B40] p-4"><div className="mb-3 flex items-center justify-between text-[#FF9A3D]">{icon}<span className="text-xs text-[#8EA4BA]">{label}</span></div><div className={`text-2xl font-extrabold ${green ? 'text-emerald-400' : red ? 'text-red-400' : 'text-white'}`}>{toPersianDigits(value)}</div><div className="mt-1 text-[11px] text-[#8EA4BA]">{hint}</div></div>; }

