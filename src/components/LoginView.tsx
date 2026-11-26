import { useState, type FormEvent } from 'react';
import { AlertCircle, Eye, EyeOff, KeyRound, LockKeyhole, LogIn, ShieldCheck, UserRound, UserPlus } from 'lucide-react';
import { BrandMark } from './BrandMark';

interface LoginResult {
  ok: boolean;
  errorFa?: string;
}

interface LoginViewProps {
  configured: boolean;
  onSubmit: (username: string, password: string) => Promise<LoginResult>;
  onBootstrap: (input: {
    username: string;
    password: string;
    fullName: string;
    bootstrapCode: string;
  }) => Promise<LoginResult>;
}

export function LoginView({ configured, onSubmit, onBootstrap }: LoginViewProps) {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('مدیر اصلی');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [bootstrapCode, setBootstrapCode] = useState('');
  const [bootstrapMode, setBootstrapMode] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorFa, setErrorFa] = useState('');
  const [successFa, setSuccessFa] = useState('');

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorFa('');
    setSuccessFa('');

    if (!configured) {
      setErrorFa('اتصال پایگاه داده برای این محیط تنظیم نشده است.');
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
    } finally {
      setSubmitting(false);
    }
  };

  const handleBootstrap = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorFa('');
    setSuccessFa('');

    if (!configured) {
      setErrorFa('اتصال پایگاه داده برای این محیط تنظیم نشده است.');
      return;
    }
    if (!username.trim() || !fullName.trim() || !password || !bootstrapCode.trim()) {
      setErrorFa('تمام فیلدهای ضروری را تکمیل کنید.');
      return;
    }
    if (password.length < 12) {
      setErrorFa('رمز عبور باید حداقل ۱۲ نویسه داشته باشد.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorFa('تکرار رمز عبور با رمز اصلی یکسان نیست.');
      return;
    }

    setSubmitting(true);
    try {
      const created = await onBootstrap({
        username: username.trim(),
        password,
        fullName: fullName.trim(),
        bootstrapCode: bootstrapCode.trim(),
      });

      if (!created.ok) {
        setErrorFa(created.errorFa || 'ساخت حساب مدیر انجام نشد.');
        return;
      }

      const loginResult = await onSubmit(username.trim(), password);
      if (!loginResult.ok) {
        setBootstrapMode(false);
        setSuccessFa('حساب مدیر ساخته شد. اکنون با همان نام کاربری و رمز عبور وارد شوید.');
        setPassword('');
        setConfirmPassword('');
        setBootstrapCode('');
      }
    } catch {
      setErrorFa('ارتباط با سرویس احراز هویت برقرار نشد. دوباره تلاش کنید.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main dir="rtl" className="min-h-screen bg-[#071522] px-4 py-10 text-[#F8FAFC] flex items-center justify-center">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-white/10 bg-[#102333] p-7 shadow-2xl shadow-black/30">
          <div className="mb-8">
            <BrandMark />
            <div className="mt-2 text-[11px] text-[#94A3B8]">سامانه یکپارچه هوشمندی مالی</div>
          </div>

          <div className="mb-6">
            <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#FF7A00]/15 text-[#FF7A00]">
              {bootstrapMode ? <UserPlus className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
            </div>
            <h1 className="text-2xl font-extrabold">
              {bootstrapMode ? 'راه‌اندازی مدیر اصلی' : 'ورود به پنل مدیریت'}
            </h1>
            <p className="mt-2 text-sm leading-6 text-[#94A3B8]">
              {bootstrapMode
                ? 'این فرایند فقط برای ایجاد اولین مدیر سامانه است و با کد یک‌بارمصرف مالک انجام می‌شود.'
                : 'برای دسترسی به اطلاعات مالی و ابزارهای هوشمند، با حساب سازمانی خود وارد شوید.'}
            </p>
          </div>

          <form onSubmit={bootstrapMode ? handleBootstrap : handleLogin} className="space-y-4">
            {bootstrapMode && (
              <label className="block">
                <span className="mb-2 block text-xs font-semibold text-[#CBD5E1]">نام و نام خانوادگی</span>
                <input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  autoComplete="name"
                  placeholder="نام مدیر اصلی"
                  className="h-12 w-full rounded-xl border border-white/10 bg-[#071522] px-3.5 text-sm outline-none focus:border-[#FF7A00]"
                />
              </label>
            )}

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
              {bootstrapMode && (
                <span className="mt-1 block text-[10px] text-[#64748B]">نام کاربری فقط با حروف انگلیسی، عدد و . _ -</span>
              )}
            </label>

            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-[#CBD5E1]">رمز عبور</span>
              <span className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#071522] px-3.5 focus-within:border-[#FF7A00]">
                <LockKeyhole className="h-4 w-4 shrink-0 text-[#64748B]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={bootstrapMode ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder={bootstrapMode ? 'حداقل ۱۲ نویسه' : 'رمز عبور'}
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

            {bootstrapMode && (
              <>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-[#CBD5E1]">تکرار رمز عبور</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    className="h-12 w-full rounded-xl border border-white/10 bg-[#071522] px-3.5 text-sm outline-none focus:border-[#FF7A00]"
                  />
                </label>
                <label className="block">
                  <span className="mb-2 block text-xs font-semibold text-[#CBD5E1]">کد محرمانه راه‌اندازی</span>
                  <span className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#071522] px-3.5 focus-within:border-[#FF7A00]">
                    <KeyRound className="h-4 w-4 shrink-0 text-[#64748B]" />
                    <input
                      dir="ltr"
                      autoComplete="off"
                      spellCheck={false}
                      value={bootstrapCode}
                      onChange={(event) => setBootstrapCode(event.target.value)}
                      placeholder="کد ۶۴ کاراکتری"
                      className="h-12 min-w-0 flex-1 bg-transparent text-left font-mono text-xs outline-none placeholder:text-[#64748B]"
                    />
                  </span>
                </label>
              </>
            )}

            {errorFa && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-[#ED2F42]/40 bg-[#ED2F42]/10 p-3 text-xs leading-5 text-[#FCA5A5]">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{errorFa}</span>
              </div>
            )}

            {successFa && (
              <div role="status" className="rounded-lg border border-[#10B981]/40 bg-[#10B981]/10 p-3 text-xs leading-5 text-[#A7F3D0]">
                {successFa}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !configured}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF7A00] text-sm font-extrabold text-[#102333] transition hover:bg-[#ff8c24] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {bootstrapMode ? <UserPlus className="h-4 w-4" /> : <LogIn className="h-4 w-4" />}
              <span>
                {submitting
                  ? 'در حال بررسی...'
                  : bootstrapMode
                    ? 'ایجاد مدیر اصلی'
                    : 'ورود امن به سامانه'}
              </span>
            </button>
          </form>

          <div className="mt-6 border-t border-white/10 pt-4 text-center">
            <button
              type="button"
              onClick={() => {
                setBootstrapMode((value) => !value);
                setErrorFa('');
                setSuccessFa('');
              }}
              className="text-xs font-semibold text-[#FFB36B] hover:text-white"
            >
              {bootstrapMode ? 'بازگشت به صفحه ورود' : 'راه‌اندازی اولین مدیر سامانه'}
            </button>
            <p className="mt-3 text-[10px] leading-5 text-[#64748B]">
              ثبت‌نام عمومی غیرفعال است. حساب‌های جدید فقط با فعال‌سازی مدیر سامانه اجازه دسترسی دارند.
            </p>
          </div>
        </div>
        <p className="mt-5 text-center text-[10px] text-[#64748B]">محیط آزمایشی · دسترسی محدود به کاربران فعال سازمان</p>
      </div>
    </main>
  );
}
