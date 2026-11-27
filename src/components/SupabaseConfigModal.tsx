import React, { useState } from 'react';
import { Database, X, CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react';
import { useFiscalYear } from '../contexts/FiscalYearContext';
import { BrandMark } from './BrandMark';

export function SupabaseConfigModal() {
  const {
    connectionModalOpen,
    setConnectionModalOpen,
    supabaseCreds,
    isLiveSupabase,
    configureSupabase,
    disconnectSupabase,
  } = useFiscalYear();

  const [url, setUrl] = useState<string>(supabaseCreds.url);
  const [anonKey, setAnonKey] = useState<string>(supabaseCreds.anonKey);
  const [testing, setTesting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; messageFa: string } | null>(null);

  if (!connectionModalOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !anonKey.trim()) {
      setFeedback({
        ok: false,
        messageFa: 'لطفاً هر دو مقدار VITE_SUPABASE_URL و VITE_SUPABASE_ANON_KEY را وارد کنید.',
      });
      return;
    }
    setTesting(true);
    setFeedback(null);
    const res = await configureSupabase(url.trim(), anonKey.trim());
    setTesting(false);
    setFeedback(res);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="supabase-modal-title"
    >
      <div className="w-full max-w-xl rounded-xl border border-white/15 bg-[#1E3A72] p-6 text-[#F8FAFC] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 pb-4">
          <div className="space-y-2">
            <BrandMark />
            <h2 id="supabase-modal-title" className="text-lg font-bold">
              تنظیمات اتصال پایگاه داده Supabase PostgreSQL
            </h2>
            <p className="text-xs text-[#94A3B8]">
              برای اتصال مستقیم به جداول و توابع RPC (مانند fn_create_voucher_draft_atomic و اندپوینت Muse.ai MCP) مشخصات پروژه Supabase را وارد کنید. در صورت خالی بودن، سامانه در حالت آزمایشی کامل با داده‌های آتی فرزام اجرا می‌شود.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConnectionModalOpen(false)}
            aria-label="بستن پنجره تنظیمات Supabase"
            className="rounded-lg p-2 text-[#94A3B8] transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="sb-url-input" className="mb-1.5 block text-xs font-semibold text-[#F8FAFC]">
              آدرس پروژه Supabase (<span className="mono-ltr">VITE_SUPABASE_URL</span>)
            </label>
            <input
              id="sb-url-input"
              type="url"
              dir="ltr"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://xxxxxxxxxxxx.supabase.co"
              className="w-full rounded-lg border border-white/15 bg-[#102333] px-3.5 py-2.5 text-left font-mono text-sm text-[#F8FAFC] placeholder-[#94A3B8]/50 focus:border-[#FF7A00] focus:outline-none focus:ring-2 focus:ring-[#FF7A00]/40"
            />
          </div>

          <div>
            <label htmlFor="sb-key-input" className="mb-1.5 block text-xs font-semibold text-[#F8FAFC]">
              کلید عمومی پروژه (<span className="mono-ltr">VITE_SUPABASE_ANON_KEY</span>)
            </label>
            <input
              id="sb-key-input"
              type="password"
              dir="ltr"
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className="w-full rounded-lg border border-white/15 bg-[#102333] px-3.5 py-2.5 text-left font-mono text-sm text-[#F8FAFC] placeholder-[#94A3B8]/50 focus:border-[#FF7A00] focus:outline-none focus:ring-2 focus:ring-[#FF7A00]/40"
            />
          </div>

          {feedback && (
            <div
              className={`flex items-start gap-2.5 rounded-lg border p-3 text-xs ${
                feedback.ok
                  ? 'border-[#10B981]/40 bg-[#10B981]/15 text-[#F8FAFC]'
                  : 'border-[#ED2F42]/50 bg-[#ED2F42]/15 text-[#F8FAFC]'
              }`}
            >
              {feedback.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#10B981]" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#ED2F42]" />
              )}
              <span>{feedback.messageFa}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
            <div className="flex items-center gap-2 text-xs text-[#94A3B8]">
              <Database className="h-4 w-4 text-[#FF7A00]" />
              <span>
                وضعیت فعلی:{' '}
                <strong className={isLiveSupabase ? 'text-[#10B981]' : 'text-[#F8FAFC]'}>
                  {isLiveSupabase ? 'متصل به Supabase Live' : 'حالت آزمایشی محلی (آماده اتصال)'}
                </strong>
              </span>
            </div>

            <div className="flex items-center gap-2">
              {supabaseCreds.source === 'localStorage' && (
                <button
                  type="button"
                  onClick={() => {
                    disconnectSupabase();
                    setUrl('');
                    setAnonKey('');
                    setFeedback({ ok: true, messageFa: 'اتصال پاک شد و سامانه به حالت آزمایشی محلی بازگشت.' });
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-2 text-xs font-medium text-[#F8FAFC] transition-colors hover:bg-white/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  حذف تنظیمات
                </button>
              )}

              <button
                type="button"
                onClick={() => setConnectionModalOpen(false)}
                className="rounded-lg border border-white/15 px-4 py-2 text-xs font-medium text-[#F8FAFC] transition-colors hover:bg-white/10"
              >
                ادامه در حالت آزمایشی
              </button>

              <button
                type="submit"
                disabled={testing}
                className="rounded-lg bg-[#FF7A00] px-4 py-2 text-xs font-bold text-[#102333] transition-colors hover:bg-[#ff8c24] disabled:opacity-60"
              >
                {testing ? 'در حال تست اتصال...' : 'ذخیره و برقراری اتصال'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
