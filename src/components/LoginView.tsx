import { useState, type FormEvent } from 'react';
import { AlertCircle, Eye, EyeOff, LockKeyhole, LogIn, ShieldCheck, UserRound } from 'lucide-react';

interface LoginViewProps {
  configured: boolean;
  onSubmit: (username: string, password: string) => Promise<{ ok: boolean; errorFa?: string }>;
}

export function LoginView({ configured, onSubmit }: LoginViewProps) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorFa, setErrorFa] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorFa('');
    if (!configured) {
      setErrorFa('اتصال Supabase برای این محیط تنظیم نشده است. متغیرهای Preview را بررسی کنید.');
      return;
    }
    if (!username.trim() || !password) {
      setErrorFa('نام کاربری و رمز عبور را وارد کنید.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await onSubmit(username.trim(), password);
      if (!result.ok) setErrorFa(result.errorFa || 'ورود انجام نشد. اطلاعات ورود را بررسی کنید.');
    } catch {
      setErrorFa('ارتباط با سرویس ورود برقرار نشد. دوباره تلاش کنید.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main dir="rtl" className="min-h-screen bg-[#071522] px-4 py-10 text-[#F8FAFC] flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-white/10 bg-[#102333] p-7 shadow-2xl shadow-black/30">
          <div className="mb-8 flex items-center gap-3">
            <img src="/assets/af-logo.svg" alt="آتی فرزام" className="h-12 w-12 object-contain" />
            <div>
              <div className="text-lg font-extrabold tracking-tight">آتی فرزام</div>
              <div className="mt-0.5 text-[11px] text-[#94A3B8]">سامانه یکپارچه هوشمندی مالی</div>
            </div>
          </div>

          <div className="mb-6">
            <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#FF7A00]/15 text-[#FF7A00]">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h1 className="text-2xl font-extrabold">ورود به پنل مدیریت</h1>
            <p className="mt-2 text-sm leading-6 text-[#94A3B8]">
              برای دسترسی به اطلاعات مالی و ابزارهای هوشمند، وارد حساب سازمانی خود شوید.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[#CBD5E1]">نام کاربری</span>
              <span className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#071522] px-3.5 focus-within:border-[#FF7A00]">
                <UserRound className="h-4 w-4 shrink-0 text-[#64748B]" />
                <input
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="مثلاً admin"
                  className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#64748B]"
                />
              </span>
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[#CBD5E1]">رمز عبور</span>
              <span className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#071522] px-3.5 focus-within:border-[#FF7A00]">
                <LockKeyhole className="h-4 w-4 shrink-0 text-[#64748B]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="رمز عبور"
                  className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#64748B]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? 'مخفی کردن رمز عبور' : 'نمایش رمز عبور'}
                  className="rounded-md p-1.5 text-[#64748B] hover:text-white"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
            </label>

            {errorFa && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-[#ED2F42]/40 bg-[#ED2F42]/10 p-3 text-xs leading-5 text-[#FCA5A5]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorFa}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !configured}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF7A00] text-sm font-extrabold text-[#102333] transition hover:bg-[#ff8c24] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" />
              <span>{submitting ? 'در حال بررسی...' : 'ورود امن به سامانه'}</span>
            </button>
          </form>

          <div className="mt-6 rounded-xl border border-white/10 bg-[#071522]/70 p-3.5 text-[11px] leading-6 text-[#94A3B8]">
            <div className="mb-1 font-bold text-[#CBD5E1]">راه‌اندازی اولین مدیر</div>
            اگر هنوز حسابی ساخته نشده، در Supabase به مسیر Authentication → Users بروید و کاربر
            <span dir="ltr" className="mx-1 font-mono text-[#F8FAFC]">admin@farzam.local</span>
            را ایجاد کنید. اولین حساب به‌صورت خودکار مدیر فعال می‌شود.
          </div>
        </div>
        <p className="mt-5 text-center text-[10px] text-[#64748B]">محیط آزمایشی · ورود محدود به کاربران فعال سازمان</p>
      </div>
    </main>
  );
}
