import { useMemo, useState } from 'react';
import {
  Printer,
  Server,
  CheckCircle2,
  AlertTriangle,
  Play,
  Copy,
  Check,
} from 'lucide-react';
import { useFiscalYear } from '../contexts/FiscalYearContext';
import {
  computeQuarterlyVatMatrix,
  computeTrialBalance,
  simulateYearEndClosing,
} from '../lib/complianceEngine';
import { formatCurrency, toPersianDigits, unitLabelFa } from '../lib/persian';
import { COMPANY_INFO } from '../lib/seedData';
import { supabaseGateway } from '../lib/supabase';
import { BrandMark } from './BrandMark';

type StatementTab = 'trial_balance' | 'income_statement' | 'balance_sheet' | 'vat_matrix' | 'art149' | 'mcp_console';

const MCP_TOOLS: Array<{
  name: string;
  permission: 'Read' | 'Write' | 'Sensitive Write';
  descFa: string;
  rpcTarget: string;
}> = [
  {
    name: 'get_trial_balance',
    permission: 'Read',
    descFa: 'دریافت تراز آزمایشی ۶ ستونی به تفکیک سال مالی و مانده ریالی صحیح',
    rpcTarget: 'fn_get_trial_balance',
  },
  {
    name: 'get_account_ledger',
    permission: 'Read',
    descFa: 'گردش دفتر معین و تفصیلی در بازه تاریخ شمسی',
    rpcTarget: 'SELECT voucher_lines',
  },
  {
    name: 'check_tax_compliance',
    permission: 'Read',
    descFa: 'گزارش ریسک مواد ۱۴۷، ۸۶، ۵۳، ۱۴۹ ردیف ۴۰۶ و کارپوشه مودیان',
    rpcTarget: 'tax_compliance_views',
  },
  {
    name: 'list_unreconciled_bank_tx',
    permission: 'Read',
    descFa: 'لیست تراکنش‌های بانک اقتصاد نوین فاقد سند حسابداری متصل',
    rpcTarget: 'SELECT bank_transactions',
  },
  {
    name: 'create_draft_voucher',
    permission: 'Write',
    descFa: 'ثبت اتمیک سند در وضعیت DRAFT با کلید یکتا idempotency_key و صف تأیید انسانی',
    rpcTarget: 'fn_create_voucher_draft_atomic',
  },
  {
    name: 'simulate_year_end_closing',
    permission: 'Read',
    descFa: 'شبیه‌سازی مالیات عملکرد ۲۵٪ (۲۱۰۶) و اندوخته قانونی ۵٪ (۳۱۰۵)',
    rpcTarget: 'fn_simulate_year_end_closing',
  },
  {
    name: 'request_year_end_closing',
    permission: 'Sensitive Write',
    descFa: 'ایجاد درخواست بستن سال مالی (اجرا منوط به تأیید انسانی در ویزارد ERP)',
    rpcTarget: 'fn_execute_year_end_closing',
  },
];

export function StatementsAndMcpView() {
  const {
    activeFiscalYear,
    accounts,
    vouchers,
    moadianInvoices,
    fixedAssets,
    currencyUnit,
    supabaseCreds,
    setConnectionModalOpen,
  } = useFiscalYear();

  const [activeTab, setActiveTab] = useState<StatementTab>('trial_balance');
  const [tbColumns, setTbColumns] = useState<4 | 6>(6);
  const [includeDrafts, setIncludeDrafts] = useState<boolean>(false);

  // MCP Console test state
  const [mcpTesting, setMcpTesting] = useState(false);
  const [mcpResult, setMcpResult] = useState<{
    ok: boolean;
    status: number;
    latencyMs: number;
    detailFa: string;
  } | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const tbRows = useMemo(
    () => computeTrialBalance(accounts, vouchers, includeDrafts),
    [accounts, vouchers, includeDrafts]
  );

  const sim = useMemo(
    () => simulateYearEndClosing(activeFiscalYear.id, accounts, vouchers, fixedAssets, includeDrafts),
    [accounts, activeFiscalYear.id, fixedAssets, includeDrafts, vouchers]
  );

  const vatMatrix = useMemo(() => computeQuarterlyVatMatrix(moadianInvoices), [moadianInvoices]);

  const balanceSheet = useMemo(() => {
    const assets = tbRows.filter((r) => r.category === 'ASSET' && (r.ending_debit_rial > 0 || r.ending_credit_rial > 0));
    const liabilities = tbRows.filter((r) => r.category === 'LIABILITY' && (r.ending_debit_rial > 0 || r.ending_credit_rial > 0));
    const equity = tbRows.filter((r) => r.category === 'EQUITY' && !r.is_temporary && (r.ending_debit_rial > 0 || r.ending_credit_rial > 0));

    const totalAssets = assets.reduce((s, r) => s + (r.ending_debit_rial - r.ending_credit_rial), 0);
    const totalLiabilities = liabilities.reduce((s, r) => s + (r.ending_credit_rial - r.ending_debit_rial), 0);
    const totalEquityBase = equity.reduce((s, r) => s + (r.ending_credit_rial - r.ending_debit_rial), 0);
    const currentYearEarnings = sim.pre_tax_profit_rial;
    const totalEquity = totalEquityBase + currentYearEarnings;

    return { assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, currentYearEarnings };
  }, [tbRows, sim.pre_tax_profit_rial]);

  const baseSupabaseUrl = supabaseCreds.url || 'https://<your-project-ref>.supabase.co';
  const mcpEndpoint = `${baseSupabaseUrl.replace(/\/+$/, '')}/functions/v1/mcp`;
  const restMirrorEndpoint = `${baseSupabaseUrl.replace(/\/+$/, '')}/functions/v1/api`;

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 1800);
    } catch {
      // Clipboard fallback silently ignored
    }
  };

  const handleTestMcp = async () => {
    setMcpTesting(true);
    const res = await supabaseGateway.testMcpEndpoint();
    setMcpResult(res);
    setMcpTesting(false);
  };

  const unitFa = unitLabelFa(currencyUnit);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="no-print flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#F8FAFC]">صورت‌های مالی رسمی و کنسول اتصال Muse.ai</h1>
          <p className="mt-1 text-xs text-[#94A3B8]">
            گزارش‌های منطبق با استانداردهای حسابداری ایران · چاپ رسمی سیاه‌وسفید با ارقام ریال دقیق و مهر سازمانی
          </p>
        </div>

        {activeTab !== 'mcp_console' && (
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#FF7A00] px-4 py-2 text-xs font-bold text-[#102333] hover:bg-[#ff8c24]"
          >
            <Printer className="h-4 w-4" />
            <span>چاپ رسمی صورت مالی (ریال)</span>
          </button>
        )}
      </div>

      {/* Tabs Bar */}
      <div className="no-print flex flex-wrap items-center gap-1.5 rounded-xl border border-white/10 bg-[#1E3A72] p-1.5 text-xs">
        {(
          [
            { id: 'trial_balance', label: 'تراز آزمایشی ۴/۶ ستونی' },
            { id: 'income_statement', label: 'صورت سود و زیان' },
            { id: 'balance_sheet', label: 'ترازنامه' },
            { id: 'vat_matrix', label: 'ماتریس ۱۰٪ ارزش افزوده' },
            { id: 'art149', label: 'جدول دارایی ثابت (ماده ۱۴۹)' },
            { id: 'mcp_console', label: 'کنسول اتصال Muse.ai MCP' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-lg px-3.5 py-2 font-semibold transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'bg-[#FF7A00] text-[#102333] font-bold'
                : 'text-[#F8FAFC]/85 hover:bg-white/10 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Printable Official Report Sheet Wrapper */}
      {activeTab !== 'mcp_console' ? (
        <section className="print-sheet rounded-xl border border-white/10 bg-[#1E3A72] p-6 space-y-5">
          {/* Print-only Official Company Masthead */}
          <div className="hidden print-only border-b-2 border-black pb-4 mb-4">
            <div className="flex items-center justify-between">
              <BrandMark forPrint />
              <div className="text-center">
                <div className="text-base font-extrabold">{COMPANY_INFO.nameFa}</div>
                <div className="text-xs mt-1">
                  شناسه ملی: <span className="mono-ltr">{COMPANY_INFO.nationalId}</span> · سال مالی{' '}
                  <span className="num-ltr">{activeFiscalYear.code}</span> (واحد رسمی: ریال)
                </div>
              </div>
              <div className="text-xs text-left num-ltr">
                {activeFiscalYear.jalali_start} — {activeFiscalYear.jalali_end}
              </div>
            </div>
          </div>

          {/* 1. TRIAL BALANCE (4/6 COLUMNS) */}
          {activeTab === 'trial_balance' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-extrabold text-[#F8FAFC]">
                    تراز آزمایشی {toPersianDigits(tbColumns)} ستونی — سال مالی {activeFiscalYear.code}
                  </h2>
                  <p className="text-xs text-[#94A3B8]">
                    منبع: <span className="mono-ltr">fn_get_trial_balance</span> · واحد نمایشی: {unitFa}
                  </p>
                </div>

                <div className="no-print flex flex-wrap items-center gap-3 text-xs">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-[#F8FAFC]">
                    <input
                      type="checkbox"
                      checked={includeDrafts}
                      onChange={(e) => setIncludeDrafts(e.target.checked)}
                      className="accent-[#FF7A00]"
                    />
                    <span>شامل پیشنویس‌ها</span>
                  </label>
                  <div className="flex rounded-lg bg-[#102333] p-0.5 border border-white/15">
                    <button
                      type="button"
                      onClick={() => setTbColumns(4)}
                      className={`rounded px-2.5 py-1 font-semibold ${
                        tbColumns === 4 ? 'bg-[#FF7A00] text-[#102333]' : 'text-[#94A3B8]'
                      }`}
                    >
                      ۴ ستونی
                    </button>
                    <button
                      type="button"
                      onClick={() => setTbColumns(6)}
                      className={`rounded px-2.5 py-1 font-semibold ${
                        tbColumns === 6 ? 'bg-[#FF7A00] text-[#102333]' : 'text-[#94A3B8]'
                      }`}
                    >
                      ۶ ستونی
                    </button>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-white/15 text-[#94A3B8]">
                      <th className="p-2.5">کد معین</th>
                      <th className="p-2.5">عنوان حساب</th>
                      {tbColumns === 6 && (
                        <>
                          <th className="p-2.5">ابتدای دوره بدهکار</th>
                          <th className="p-2.5">ابتدای دوره بستانکار</th>
                        </>
                      )}
                      <th className="p-2.5">گردش بدهکار</th>
                      <th className="p-2.5">گردش بستانکار</th>
                      <th className="p-2.5">مانده بدهکار</th>
                      <th className="p-2.5">مانده بستانکار</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {tbRows.map((row) => (
                      <tr key={row.account_code} className="hover:bg-white/5">
                        <td className="p-2.5 mono-ltr font-bold text-[#FF7A00]">{row.account_code}</td>
                        <td className="p-2.5 font-medium text-[#F8FAFC]">{row.name_fa}</td>
                        {tbColumns === 6 && (
                          <>
                            <td className="p-2.5 num-ltr">{formatCurrency(row.opening_debit_rial, currencyUnit)}</td>
                            <td className="p-2.5 num-ltr">{formatCurrency(row.opening_credit_rial, currencyUnit)}</td>
                          </>
                        )}
                        <td className="p-2.5 num-ltr">{formatCurrency(row.turnover_debit_rial, currencyUnit)}</td>
                        <td className="p-2.5 num-ltr">{formatCurrency(row.turnover_credit_rial, currencyUnit)}</td>
                        <td className="p-2.5 num-ltr font-bold text-[#F8FAFC]">
                          {formatCurrency(row.ending_debit_rial, currencyUnit)}
                        </td>
                        <td className="p-2.5 num-ltr font-bold text-[#F8FAFC]">
                          {formatCurrency(row.ending_credit_rial, currencyUnit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-white/25 font-extrabold text-[#10B981]">
                      <td colSpan={2} className="p-3">
                        جمع کل تراز آزمایشی ({unitFa})
                      </td>
                      {tbColumns === 6 && (
                        <>
                          <td className="p-3 num-ltr">
                            {formatCurrency(tbRows.reduce((s, r) => s + r.opening_debit_rial, 0), currencyUnit)}
                          </td>
                          <td className="p-3 num-ltr">
                            {formatCurrency(tbRows.reduce((s, r) => s + r.opening_credit_rial, 0), currencyUnit)}
                          </td>
                        </>
                      )}
                      <td className="p-3 num-ltr">
                        {formatCurrency(tbRows.reduce((s, r) => s + r.turnover_debit_rial, 0), currencyUnit)}
                      </td>
                      <td className="p-3 num-ltr">
                        {formatCurrency(tbRows.reduce((s, r) => s + r.turnover_credit_rial, 0), currencyUnit)}
                      </td>
                      <td className="p-3 num-ltr">
                        {formatCurrency(tbRows.reduce((s, r) => s + r.ending_debit_rial, 0), currencyUnit)}
                      </td>
                      <td className="p-3 num-ltr">
                        {formatCurrency(tbRows.reduce((s, r) => s + r.ending_credit_rial, 0), currencyUnit)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* 2. INCOME STATEMENT */}
          {activeTab === 'income_statement' && (
            <div className="space-y-4">
              <h2 className="text-lg font-extrabold text-[#F8FAFC]">
                صورت سود و زیان دوره منتهی به <span className="num-ltr">{activeFiscalYear.jalali_end}</span> ({unitFa})
              </h2>
              <table className="w-full text-right text-sm">
                <tbody className="divide-y divide-white/10">
                  <tr>
                    <td className="py-3 px-3 font-semibold">درآمدهای عملیاتی (فروش خالص ۷۱۰۱ و سایر ۷۱۰۵)</td>
                    <td className="py-3 px-3 text-left num-ltr font-bold text-[#F8FAFC]">
                      {formatCurrency(sim.total_revenue_rial, currencyUnit)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 text-[#94A3B8]">کسر می‌شود: بهای تمام‌شده کالای فروش‌رفته (۵۱۰۱)</td>
                    <td className="py-3 px-3 text-left num-ltr text-[#ED2F42]">
                      ({formatCurrency(sim.total_cogs_rial, currencyUnit)})
                    </td>
                  </tr>
                  <tr className="bg-[#102333]/60 font-bold">
                    <td className="py-3 px-3">سود ناخالص</td>
                    <td className="py-3 px-3 text-left num-ltr text-[#10B981]">
                      {formatCurrency(sim.gross_profit_rial, currencyUnit)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 text-[#94A3B8]">
                      کسر می‌شود: هزینه‌های عمومی، اداری و استهلاک (۶۱۰۱ و ۶۱۰۵)
                    </td>
                    <td className="py-3 px-3 text-left num-ltr text-[#ED2F42]">
                      ({formatCurrency(sim.total_opex_rial, currencyUnit)})
                    </td>
                  </tr>
                  <tr className="bg-[#102333]/60 font-bold">
                    <td className="py-3 px-3">سود عملیاتی قبل از مالیات</td>
                    <td className="py-3 px-3 text-left num-ltr text-[#F8FAFC]">
                      {formatCurrency(sim.pre_tax_profit_rial, currencyUnit)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-3 px-3 text-[#FF7A00]">
                      کسر می‌شود: ذخیره ۲۵٪ مالیات بر درآمد ماده ۱۰۵ (با لحاظ مازاد استهلاک ردیف ۴۰۶)
                    </td>
                    <td className="py-3 px-3 text-left num-ltr text-[#FF7A00]">
                      ({formatCurrency(sim.income_tax_25pct_rial, currencyUnit)})
                    </td>
                  </tr>
                  <tr className="border-t-2 border-white/25 font-extrabold text-base text-[#10B981]">
                    <td className="py-3.5 px-3">سود خالص دوره پس از کسر مالیات</td>
                    <td className="py-3.5 px-3 text-left num-ltr">
                      {formatCurrency(sim.net_profit_rial, currencyUnit)} {unitFa}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-xs text-[#94A3B8]">تخصیص ۵٪ اندوخته قانونی (ماده ۲۳۸ — معین ۳۱۰۵)</td>
                    <td className="py-2.5 px-3 text-left num-ltr text-xs">
                      {formatCurrency(sim.statutory_reserve_5pct_rial, currencyUnit)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-xs text-[#94A3B8]">سود قابل انتقال به سود انباشته (معین ۳۱۰۴)</td>
                    <td className="py-2.5 px-3 text-left num-ltr text-xs font-bold text-[#10B981]">
                      {formatCurrency(sim.retained_earnings_transfer_rial, currencyUnit)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* 3. BALANCE SHEET */}
          {activeTab === 'balance_sheet' && (
            <div className="space-y-4">
              <h2 className="text-lg font-extrabold text-[#F8FAFC]">
                ترازنامه (صورت وضعیت مالی) در تاریخ <span className="num-ltr">{activeFiscalYear.jalali_end}</span> ({unitFa})
              </h2>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Assets */}
                <div className="rounded-lg border border-white/10 bg-[#102333]/65 p-4">
                  <h3 className="border-b border-white/10 pb-2 text-sm font-bold text-[#FF7A00]">دارایی‌ها</h3>
                  <table className="mt-2 w-full text-right text-xs">
                    <tbody className="divide-y divide-white/10">
                      {balanceSheet.assets.map((r) => {
                        const net = r.ending_debit_rial - r.ending_credit_rial;
                        return (
                          <tr key={r.account_code}>
                            <td className="py-2.5">
                              <span className="mono-ltr text-[#94A3B8] ml-2">{r.account_code}</span>
                              {r.name_fa}
                            </td>
                            <td className="py-2.5 text-left num-ltr font-semibold">
                              {formatCurrency(net, currencyUnit)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-white/25 font-extrabold text-sm text-[#10B981]">
                        <td className="pt-3">جمع کل دارایی‌ها</td>
                        <td className="pt-3 text-left num-ltr">
                          {formatCurrency(balanceSheet.totalAssets, currencyUnit)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {/* Liabilities & Equity */}
                <div className="rounded-lg border border-white/10 bg-[#102333]/65 p-4">
                  <h3 className="border-b border-white/10 pb-2 text-sm font-bold text-[#FF7A00]">
                    بدهی‌ها و حقوق مالکانه
                  </h3>
                  <table className="mt-2 w-full text-right text-xs">
                    <tbody className="divide-y divide-white/10">
                      {balanceSheet.liabilities.map((r) => {
                        const net = r.ending_credit_rial - r.ending_debit_rial;
                        return (
                          <tr key={r.account_code}>
                            <td className="py-2.5">
                              <span className="mono-ltr text-[#94A3B8] ml-2">{r.account_code}</span>
                              {r.name_fa}
                            </td>
                            <td className="py-2.5 text-left num-ltr font-semibold">
                              {formatCurrency(net, currencyUnit)}
                            </td>
                          </tr>
                        );
                      })}
                      {balanceSheet.equity.map((r) => {
                        const net = r.ending_credit_rial - r.ending_debit_rial;
                        return (
                          <tr key={r.account_code}>
                            <td className="py-2.5">
                              <span className="mono-ltr text-[#94A3B8] ml-2">{r.account_code}</span>
                              {r.name_fa}
                            </td>
                            <td className="py-2.5 text-left num-ltr font-semibold">
                              {formatCurrency(net, currencyUnit)}
                            </td>
                          </tr>
                        );
                      })}
                      <tr>
                        <td className="py-2.5 text-[#10B981] font-semibold">سود (زیان) جاری دوره (پیش از بستن)</td>
                        <td className="py-2.5 text-left num-ltr font-semibold text-[#10B981]">
                          {formatCurrency(balanceSheet.currentYearEarnings, currencyUnit)}
                        </td>
                      </tr>
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-white/25 font-extrabold text-sm text-[#10B981]">
                        <td className="pt-3">جمع کل بدهی‌ها و حقوق مالکانه</td>
                        <td className="pt-3 text-left num-ltr">
                          {formatCurrency(balanceSheet.totalLiabilities + balanceSheet.totalEquity, currencyUnit)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 4. 4-QUARTER 10% VAT MATRIX */}
          {activeTab === 'vat_matrix' && (
            <div className="space-y-4">
              <h2 className="text-lg font-extrabold text-[#F8FAFC]">
                ماتریس فصلی مالیات بر ارزش افزوده (۱۰٪) — سامانه مودیان ({unitFa})
              </h2>
              <p className="text-xs text-[#94A3B8]">
                صورتحساب‌های «باطل شده» به‌صورت خودکار حذف و صورتحساب‌های «رد شده» جهت پیگیری اصلاحیه تفکیک شده‌اند.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-white/15 text-[#94A3B8]">
                      <th className="p-2.5">فصل مالی</th>
                      <th className="p-2.5">فروش مشمول</th>
                      <th className="p-2.5">ارزش افزوده فروش (۲۱۰۷)</th>
                      <th className="p-2.5">خرید مشمول</th>
                      <th className="p-2.5">ارزش افزوده خرید (۱۱۰۸)</th>
                      <th className="p-2.5">خالص پرداختنی / بستانکاری</th>
                      <th className="p-2.5">باطل / رد مودیان</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {vatMatrix.map((q) => (
                      <tr key={q.quarter} className="hover:bg-white/5">
                        <td className="p-2.5 font-bold text-[#F8FAFC]">{q.quarterTitleFa}</td>
                        <td className="p-2.5 num-ltr">{formatCurrency(q.salesNetRial, currencyUnit)}</td>
                        <td className="p-2.5 num-ltr font-semibold text-[#FF7A00]">
                          {formatCurrency(q.outputVat10Rial, currencyUnit)}
                        </td>
                        <td className="p-2.5 num-ltr">{formatCurrency(q.purchaseNetRial, currencyUnit)}</td>
                        <td className="p-2.5 num-ltr font-semibold text-[#10B981]">
                          {formatCurrency(q.inputVat10Rial, currencyUnit)}
                        </td>
                        <td className="p-2.5 num-ltr font-extrabold text-[#F8FAFC]">
                          {formatCurrency(q.netVatPayableRial, currencyUnit)}
                        </td>
                        <td className="p-2.5 text-[11px]">
                          <span className="text-[#94A3B8]">باطل: {toPersianDigits(q.canceledCount)}</span>
                          <span className="mx-1.5">·</span>
                          <span className={q.rejectedCount > 0 ? 'font-bold text-[#ED2F42]' : 'text-[#10B981]'}>
                            رد شده: {toPersianDigits(q.rejectedCount)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 5. FIXED ASSETS ART. 149 SCHEDULE */}
          {activeTab === 'art149' && (
            <div className="space-y-4">
              <h2 className="text-lg font-extrabold text-[#F8FAFC]">
                جدول دارایی‌های ثابت و تطبیق استهلاک ماده ۱۴۹ ق.م.م ({unitFa})
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-white/15 text-[#94A3B8]">
                      <th className="p-2.5">کد اموال</th>
                      <th className="p-2.5">شرح دارایی</th>
                      <th className="p-2.5">ردیف ۱۴۹</th>
                      <th className="p-2.5">بهای تمام‌شده</th>
                      <th className="p-2.5">نرخ دفتری / قانونی</th>
                      <th className="p-2.5">استهلاک دفتری</th>
                      <th className="p-2.5">استهلاک قانونی ۱۴۹</th>
                      <th className="p-2.5">مازاد غیرقابل‌قبول</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {fixedAssets.map((a) => (
                      <tr key={a.id} className={a.excess_disallowed_rial > 0 ? 'bg-[#ED2F42]/10' : ''}>
                        <td className="p-2.5 mono-ltr font-bold text-[#FF7A00]">{a.asset_code}</td>
                        <td className="p-2.5 font-semibold text-[#F8FAFC]">{a.name_fa}</td>
                        <td className="p-2.5 mono-ltr">{a.art149_row}</td>
                        <td className="p-2.5 num-ltr">{formatCurrency(a.cost_rial, currencyUnit)}</td>
                        <td className="p-2.5 num-ltr">
                          {toPersianDigits(a.book_rate_pct)}% / {toPersianDigits(a.statutory_rate_pct)}%
                        </td>
                        <td className="p-2.5 num-ltr">{formatCurrency(a.book_annual_depr_rial, currencyUnit)}</td>
                        <td className="p-2.5 num-ltr text-[#10B981]">
                          {formatCurrency(a.statutory_annual_depr_rial, currencyUnit)}
                        </td>
                        <td
                          className={`p-2.5 num-ltr font-extrabold ${
                            a.excess_disallowed_rial > 0 ? 'text-[#ED2F42]' : 'text-[#94A3B8]'
                          }`}
                        >
                          {formatCurrency(a.excess_disallowed_rial, currencyUnit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-white/25 font-extrabold">
                      <td colSpan={5} className="p-3">
                        جمع کل جدول استهلاک ماده ۱۴۹
                      </td>
                      <td className="p-3 num-ltr">
                        {formatCurrency(fixedAssets.reduce((s, a) => s + a.book_annual_depr_rial, 0), currencyUnit)}
                      </td>
                      <td className="p-3 num-ltr text-[#10B981]">
                        {formatCurrency(fixedAssets.reduce((s, a) => s + a.statutory_annual_depr_rial, 0), currencyUnit)}
                      </td>
                      <td className="p-3 num-ltr text-[#ED2F42]">
                        {formatCurrency(fixedAssets.reduce((s, a) => s + a.excess_disallowed_rial, 0), currencyUnit)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Print-Only Signature Footer */}
          <div className="hidden print-only mt-12 grid grid-cols-3 gap-6 text-center text-xs">
            <div className="border-t border-black pt-2 font-bold">حسابدار ارشد</div>
            <div className="border-t border-black pt-2 font-bold">مدیر مالی</div>
            <div className="border-t border-black pt-2 font-bold">مدیرعامل و مهر شرکت</div>
          </div>
        </section>
      ) : (
        /* =================== 6. LIVE MUSE.AI MCP & REST INTEGRATION CONSOLE =================== */
        <section className="space-y-5" data-testid="mcp-console-panel">
          <div className="rounded-xl border border-white/10 bg-[#1E3A72] p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
              <div>
                <h2 className="text-lg font-extrabold text-[#F8FAFC] flex items-center gap-2">
                  <Server className="h-5 w-5 text-[#FF7A00]" />
                  <span>کنسول اتصال Muse.ai MCP و REST Mirror</span>
                </h2>
                <p className="mt-1 text-xs text-[#94A3B8]">
                  پروتکل Streamable HTTP MCP بر بستر Supabase Edge Functions برای هماهنگی هوشمند اسناد با کنترل انسانی
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConnectionModalOpen(true)}
                  className="rounded-lg border border-white/15 px-3.5 py-2 text-xs font-semibold text-[#F8FAFC] hover:border-[#FF7A00]"
                >
                  تنظیمات کلید Supabase
                </button>
                <button
                  type="button"
                  onClick={handleTestMcp}
                  disabled={mcpTesting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF7A00] px-4 py-2 text-xs font-bold text-[#102333] hover:bg-[#ff8c24] disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  <span>{mcpTesting ? 'در حال ارسال درخواست...' : 'تست اتصال زنده MCP'}</span>
                </button>
              </div>
            </div>

            {/* Endpoints */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-[#102333] p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#F8FAFC]">Streamable HTTP MCP Endpoint</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(mcpEndpoint)}
                    className="inline-flex items-center gap-1 text-[11px] text-[#FF7A00] hover:underline"
                  >
                    {copiedUrl === mcpEndpoint ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedUrl === mcpEndpoint ? 'کپی شد' : 'کپی آدرس'}</span>
                  </button>
                </div>
                <code className="block mono-ltr text-xs text-[#10B981] break-all">{mcpEndpoint}</code>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#102333] p-4 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#F8FAFC]">REST Mirror URL</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(restMirrorEndpoint)}
                    className="inline-flex items-center gap-1 text-[11px] text-[#FF7A00] hover:underline"
                  >
                    {copiedUrl === restMirrorEndpoint ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedUrl === restMirrorEndpoint ? 'کپی شد' : 'کپی آدرس'}</span>
                  </button>
                </div>
                <code className="block mono-ltr text-xs text-[#F8FAFC] break-all">{restMirrorEndpoint}</code>
              </div>
            </div>

            {mcpResult && (
              <div
                className={`flex items-center gap-2.5 rounded-lg border p-3.5 text-xs font-semibold ${
                  mcpResult.ok
                    ? 'border-[#10B981]/50 bg-[#10B981]/15 text-[#F8FAFC]'
                    : 'border-[#ED2F42]/50 bg-[#ED2F42]/15 text-[#F8FAFC]'
                }`}
              >
                {mcpResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 text-[#10B981]" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-[#ED2F42]" />
                )}
                <span>{mcpResult.detailFa}</span>
              </div>
            )}

            {/* All 7 MCP Tools Registry with Read / Write / Sensitive Write Badges */}
            <div>
              <h3 className="mb-3 text-sm font-bold text-[#F8FAFC]">
                فهرست ۷ ابزار رسمی Muse.ai MCP و سطح دسترسی آن‌ها
              </h3>
              <div className="overflow-x-auto rounded-lg border border-white/10 bg-[#102333]/80">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[#94A3B8]">
                      <th className="p-3">نام ابزار MCP</th>
                      <th className="p-3">سطح دسترسی</th>
                      <th className="p-3">هدف در PostgreSQL / RPC</th>
                      <th className="p-3">کاربرد عملیاتی</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {MCP_TOOLS.map((tool) => (
                      <tr key={tool.name} className="hover:bg-white/5">
                        <td className="p-3 mono-ltr font-bold text-[#F8FAFC]">{tool.name}</td>
                        <td className="p-3">
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold mono-ltr ${
                              tool.permission === 'Read'
                                ? 'bg-[#10B981]/20 text-[#10B981]'
                                : tool.permission === 'Write'
                                ? 'bg-[#FF7A00]/20 text-[#FF7A00]'
                                : 'bg-[#ED2F42]/25 text-[#ED2F42]'
                            }`}
                          >
                            {tool.permission}
                          </span>
                        </td>
                        <td className="p-3 mono-ltr text-[#94A3B8]">{tool.rpcTarget}</td>
                        <td className="p-3 text-[#F8FAFC]/90">{tool.descFa}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
