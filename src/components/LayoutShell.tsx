import React, { useState } from 'react';
import {
  LayoutDashboard,
  BookOpenCheck,
  FileSpreadsheet,
  Bot,
  CalendarCheck2,
  FileBarChart2,
  Database,
  ShieldCheck,
  Lock,
  Layers,
  Menu,
  X,
  UserCheck,
  ArrowLeftRight,
  LogOut,
} from 'lucide-react';
import type { ActiveViewId } from '../types/erp';
import { useFiscalYear } from '../contexts/FiscalYearContext';
import { COMPANY_INFO } from '../lib/seedData';
import { toPersianDigits } from '../lib/persian';
import { BrandMark } from './BrandMark';

interface LayoutShellProps {
  activeView: ActiveViewId;
  onSelectView: (view: ActiveViewId) => void;
  children: React.ReactNode;
  onSignOut: () => Promise<void>;
}

const NAV_ITEMS: Array<{
  id: ActiveViewId;
  labelFa: string;
  shortDescFa: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'dashboard',
    labelFa: 'نمای کلی',
    shortDescFa: 'تصمیم‌های مهم امروز',
    icon: LayoutDashboard,
  },
  {
    id: 'vouchers',
    labelFa: 'اسناد و دفتر کل',
    shortDescFa: 'ثبت و بررسی اسناد',
    icon: BookOpenCheck,
  },
  {
    id: 'excel_import',
    labelFa: 'ورود اطلاعات',
    shortDescFa: 'اقتصاد نوین، مودیان، تجهیزات، تراز',
    icon: FileSpreadsheet,
  },
  {
    id: 'agent_queue',
    labelFa: 'صف تأیید Muse',
    shortDescFa: 'پیشنویس‌های Muse.ai با امضای انسانی',
    icon: Bot,
  },
  {
    id: 'year_end',
    labelFa: 'بستن سال مالی',
    shortDescFa: 'مواد ۱۰۵، ۱۴۹ و ۲۳۸ قانون تجارت',
    icon: CalendarCheck2,
  },
  {
    id: 'statements',
    labelFa: 'گزارش‌ها و اتصال Muse',
    shortDescFa: 'گزارش‌های رسمی چاپی و کنسول MCP',
    icon: FileBarChart2,
  },
  {
    id: 'master_data',
    labelFa: 'اطلاعات پایه',
    shortDescFa: '۲۰ معین، تفصیلی‌ها، کالاها و اموال',
    icon: Layers,
  },
  {
    id: 'agent_center',
    labelFa: 'مرکز Agentها',
    shortDescFa: 'اتصال‌ها، ابزارها، فعالیت و ممیزی',
    icon: ShieldCheck,
  },
];

export function LayoutShell({ activeView, onSelectView, children, onSignOut }: LayoutShellProps) {
  const {
    fiscalYears,
    activeFiscalYear,
    setActiveFiscalYearId,
    isReadOnly,
    currencyUnit,
    toggleCurrencyUnit,
    pendingAgentDraftsCount,
    userRole,
    isLiveSupabase,
  } = useFiscalYear();

  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-[#102333] text-[#F8FAFC] flex flex-col lg:flex-row">
      {/* Mobile Sidebar Backdrop */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden no-print"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* RTL Right-Side Persistent Sidebar (288px on desktop) */}
      <aside
        className={`no-print fixed inset-y-0 right-0 z-40 flex w-[288px] shrink-0 flex-col border-l border-white/10 bg-[#1E3A72] transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-label="منوی اصلی سامانه حسابداری"
      >
        {/* Brand Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <BrandMark />
          <button
            type="button"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="بستن منو"
            className="rounded-lg p-1.5 text-[#94A3B8] hover:bg-white/10 hover:text-white lg:hidden"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Company Legal Identity Strip */}
        <div className="border-b border-white/10 bg-[#162D5B]/70 px-5 py-3 text-xs">
          <div className="font-semibold text-[#F8FAFC] leading-relaxed">{COMPANY_INFO.nameFa}</div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-[#94A3B8]">
            <span>شناسه ملی / اقتصادی</span>
            <span className="mono-ltr font-semibold text-[#F8FAFC]">{COMPANY_INFO.nationalId}</span>
          </div>
        </div>

        {/* 7 ERP Navigation Modules */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectView(item.id);
                  setMobileMenuOpen(false);
                }}
                aria-current={isActive ? 'page' : undefined}
                className={`group flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-right transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A00] ${
                  isActive
                    ? 'bg-[#FF7A00] text-[#102333] font-bold shadow-sm'
                    : 'text-[#F8FAFC]/90 hover:bg-white/8 hover:text-white'
                }`}
              >
                <Icon
                  className={`h-4 w-4 shrink-0 ${
                    isActive ? 'text-[#102333]' : 'text-[#94A3B8] group-hover:text-[#FF7A00]'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px]">{item.labelFa}</span>
                    {item.id === 'agent_queue' && pendingAgentDraftsCount > 0 && (
                      <span
                        className={`num-ltr rounded px-1.5 py-0.5 text-[11px] font-bold ${
                          isActive
                            ? 'bg-[#102333] text-[#FF7A00]'
                            : 'bg-[#ED2F42] text-white'
                        }`}
                      >
                        {toPersianDigits(pendingAgentDraftsCount)}
                      </span>
                    )}
                  </div>
                  <div
                    className={`truncate text-[11px] mt-0.5 ${
                      isActive ? 'text-[#102333]/80 font-medium' : 'text-[#94A3B8]'
                    }`}
                  >
                    {item.shortDescFa}
                  </div>
                </div>
              </button>
            );
          })}
        </nav>

        {/* Database Environment Status — connection settings are deployment-managed */}
        <div className="border-t border-white/10 p-4">
          <div className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-[#102333]/80 px-3.5 py-2.5 text-xs">
            <span className="flex items-center gap-2 font-medium text-[#F8FAFC]">
              <Database className="h-4 w-4 text-[#FF7A00]" />
              <span>پایگاه داده آزمایشی</span>
            </span>
            <span className={`text-[11px] font-semibold ${isLiveSupabase ? 'text-[#10B981]' : 'text-[#F59E0B]'}`}>
              {isLiveSupabase ? 'متصل' : 'در حال اتصال'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main Column: Global Top Bar + Optional Sticky Locked Banner + Active Module */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Always-Visible Global Top Bar */}
        <header className="no-print sticky top-0 z-30 border-b border-white/10 bg-[#1E3A72]/95 backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-6">
            {/* Right Side (RTL start): Mobile Menu Button + Fiscal Year Switcher */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="باز کردن منوی ناوبری"
                className="rounded-lg border border-white/15 p-2 text-[#F8FAFC] hover:bg-white/10 lg:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>

              <div className="flex items-center gap-2">
                <label htmlFor="global-fy-select" className="text-xs font-medium text-[#94A3B8] whitespace-nowrap">
                  سال مالی:
                </label>
                <select
                  id="global-fy-select"
                  value={activeFiscalYear.id}
                  onChange={(e) => setActiveFiscalYearId(e.target.value)}
                  className="rounded-lg border border-white/15 bg-[#102333] px-3 py-1.5 text-xs font-bold text-[#F8FAFC] focus:border-[#FF7A00] focus:outline-none focus:ring-2 focus:ring-[#FF7A00]/40"
                >
                  {fiscalYears.map((fy) => {
                    const tag = fy.is_closed
                      ? '[بسته]'
                      : fy.is_non_calendar
                      ? '[۳۱ شهریور]'
                      : fy.code === '1404'
                      ? '[تقویمی]'
                      : '[باز]';
                    return (
                      <option key={fy.id} value={fy.id} className="bg-[#102333] text-[#F8FAFC]">
                        {fy.code} {tag}
                      </option>
                    );
                  })}
                </select>
                <span className="hidden xl:inline-block num-ltr text-xs text-[#94A3B8]">
                  {activeFiscalYear.jalali_start} — {activeFiscalYear.jalali_end}
                </span>
              </div>
            </div>

            {/* Left Side (RTL end): Rial/Toman Toggle, Pending Muse.ai Drafts Counter, User Role */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Persistent Rial / Toman Display Toggle */}
              <button
                type="button"
                onClick={toggleCurrencyUnit}
                aria-label="تغییر واحد نمایش ریال و تومان"
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#102333] px-3 py-1.5 text-xs font-semibold text-[#F8FAFC] transition-colors hover:border-[#FF7A00] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF7A00]"
              >
                <ArrowLeftRight className="h-3.5 w-3.5 text-[#FF7A00]" />
                <span>واحد نمایش:</span>
                <span className={currencyUnit === 'RIAL' ? 'text-[#FF7A00] font-bold' : 'text-[#94A3B8]'}>
                  ریال
                </span>
                <span className="text-white/25">/</span>
                <span className={currencyUnit === 'TOMAN' ? 'text-[#FF7A00] font-bold' : 'text-[#94A3B8]'}>
                  تومان
                </span>
              </button>

              {/* Pending Muse.ai Drafts Counter Badge */}
              <button
                type="button"
                onClick={() => onSelectView('agent_queue')}
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#102333] px-3 py-1.5 text-xs font-semibold text-[#F8FAFC] transition-colors hover:border-[#FF7A00] whitespace-nowrap shrink-0"
              >
                <Bot className="h-3.5 w-3.5 text-[#FF7A00]" />
                <span>پیشنویس‌های Muse.ai</span>
                <span
                  data-testid="pending-agent-badge"
                  className={`num-ltr rounded px-1.5 py-0.5 text-[11px] font-bold ${
                    pendingAgentDraftsCount > 0 ? 'bg-[#ED2F42] text-white' : 'bg-[#10B981]/20 text-[#10B981]'
                  }`}
                >
                  {toPersianDigits(pendingAgentDraftsCount)}
                </span>
              </button>

              {/* Authenticated identity and explicit sign-out */}
              <div className="hidden sm:flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#162D5B] px-3 py-1.5 text-xs text-[#F8FAFC] whitespace-nowrap shrink-0">
                <UserCheck className="h-3.5 w-3.5 text-[#10B981]" />
                <span>{userRole}</span>
              </div>
              <button
                type="button"
                onClick={() => void onSignOut()}
                className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-[#102333] px-3 py-1.5 text-xs font-semibold text-[#F8FAFC] transition-colors hover:border-[#ED2F42] hover:text-[#FCA5A5]"
                aria-label="خروج امن از حساب"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>خروج</span>
              </button>
            </div>
          </div>

          {/* Sticky #ED2F42 Alert Red Read-Only Banner whenever is_closed === true */}
          {isReadOnly && (
            <div
              role="alert"
              data-testid="locked-fiscal-year-banner"
              className="flex items-center justify-center gap-2.5 bg-[#ED2F42] px-4 py-2 text-xs font-bold text-white"
            >
              <Lock className="h-4 w-4 shrink-0" />
              <span>سال مالی قفل شده است — حالت فقط خواندنی</span>
              <span className="hidden md:inline text-white/85 font-normal">
                (دوره {activeFiscalYear.code} بسته شده و تمامی کنترل‌های ثبت، ویرایش، ورود اکسل و تأیید غیرفعال هستند)
              </span>
            </div>
          )}
        </header>

        {/* Active View Content */}
        <main className="flex-1 p-4 lg:p-6 max-w-[1440px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}

