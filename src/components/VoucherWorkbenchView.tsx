import { useMemo, useState } from 'react';
import {
  Plus,
  Trash2,
  Printer,
  CheckCircle2,
  AlertTriangle,
  Search,
  Lock,
  Save,
  X,
  FileText,
} from 'lucide-react';
import { useFiscalYear } from '../contexts/FiscalYearContext';
import {
  computeVoucherBalance,
  runVoucherCompliancePreCheck,
} from '../lib/complianceEngine';
import {
  formatCurrency,
  parseRialInteger,
  toPersianDigits,
  unitLabelFa,
} from '../lib/persian';
import { COMPANY_INFO } from '../lib/seedData';
import type { Voucher } from '../types/erp';
import { BrandMark } from './BrandMark';

interface EditableLine {
  localId: string;
  account_id: string;
  account_code: string;
  tafsil_id: string;
  description_fa: string;
  debit_raw: string;
  credit_raw: string;
  moadian_tax_id: string;
}

function makeBlankLine(idx: number): EditableLine {
  return {
    localId: `ln-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
    account_id: 'acc-1100',
    account_code: '1100',
    tafsil_id: '',
    description_fa: '',
    debit_raw: '',
    credit_raw: '',
    moadian_tax_id: '',
  };
}

export function VoucherWorkbenchView() {
  const {
    activeFiscalYear,
    isReadOnly,
    accounts,
    tafsilParties,
    vouchers,
    currencyUnit,
    saveVoucherAtomic,
    deleteDraftVoucher,
  } = useFiscalYear();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'DRAFT' | 'FINALIZED' | 'REJECTED'>('ALL');
  const [selectedVoucherId, setSelectedVoucherId] = useState<string | null>(vouchers[0]?.id ?? null);
  const [isCreatingNew, setIsCreatingNew] = useState<boolean>(false);
  const [printVoucher, setPrintVoucher] = useState<Voucher | null>(null);

  // Editor state
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [jalaliDate, setJalaliDate] = useState<string>(activeFiscalYear.jalali_start);
  const [gregorianDate, setGregorianDate] = useState<string>(activeFiscalYear.start_date);
  const [referenceNo, setReferenceNo] = useState<string>('');
  const [descriptionFa, setDescriptionFa] = useState<string>('');
  const [accountFilter, setAccountFilter] = useState<string>('');
  const [lines, setLines] = useState<EditableLine[]>([makeBlankLine(1), makeBlankLine(2)]);
  const [saveFeedback, setSaveFeedback] = useState<{ ok: boolean; messageFa: string } | null>(null);
  const [saving, setSaving] = useState<boolean>(false);

  const selectedVoucher = useMemo(
    () => vouchers.find((v) => v.id === selectedVoucherId) ?? vouchers[0] ?? null,
    [vouchers, selectedVoucherId]
  );

  const filteredVouchers = useMemo(() => {
    return vouchers.filter((v) => {
      if (statusFilter !== 'ALL' && v.status !== statusFilter) return false;
      if (!searchQuery.trim()) return true;
      const q = searchQuery.trim().toLowerCase();
      return (
        String(v.voucher_no).includes(q) ||
        v.description_fa.toLowerCase().includes(q) ||
        (v.reference_no ?? '').toLowerCase().includes(q) ||
        v.lines.some((l) => l.account_code.includes(q))
      );
    });
  }, [vouchers, statusFilter, searchQuery]);

  const filteredAccounts = useMemo(() => {
    if (!accountFilter.trim()) return accounts;
    const q = accountFilter.trim().toLowerCase();
    return accounts.filter(
      (a) =>
        a.code.includes(q) ||
        a.name_fa.toLowerCase().includes(q) ||
        a.name_en.toLowerCase().includes(q)
    );
  }, [accounts, accountFilter]);

  const startNewVoucher = () => {
    if (isReadOnly) return;
    setIsCreatingNew(true);
    setEditingId(undefined);
    setJalaliDate(activeFiscalYear.code === '1404' ? '1404/11/25' : activeFiscalYear.jalali_start);
    setGregorianDate(activeFiscalYear.code === '1404' ? '2026-02-14' : activeFiscalYear.start_date);
    setReferenceNo('');
    setDescriptionFa('');
    setLines([
      { ...makeBlankLine(1), account_id: 'acc-6101', account_code: '6101' },
      { ...makeBlankLine(2), account_id: 'acc-1100', account_code: '1100', tafsil_id: 'taf-bank-en' },
    ]);
    setSaveFeedback(null);
  };

  const startEditDraft = (voucher: Voucher) => {
    if (isReadOnly || voucher.status !== 'DRAFT') return;
    setIsCreatingNew(true);
    setEditingId(voucher.id);
    setJalaliDate(voucher.jalali_date);
    setGregorianDate(voucher.gregorian_date);
    setReferenceNo(voucher.reference_no ?? '');
    setDescriptionFa(voucher.description_fa);
    setLines(
      voucher.lines.map((l) => ({
        localId: l.id,
        account_id: l.account_id,
        account_code: l.account_code,
        tafsil_id: l.tafsil_id ?? '',
        description_fa: l.description_fa,
        debit_raw: l.debit_rial > 0 ? String(l.debit_rial) : '',
        credit_raw: l.credit_rial > 0 ? String(l.credit_rial) : '',
        moadian_tax_id: l.moadian_tax_id ?? '',
      }))
    );
    setSaveFeedback(null);
  };

  const parsedLines = useMemo(
    () =>
      lines.map((l) => ({
        account_id: l.account_id,
        account_code: l.account_code,
        tafsil_id: l.tafsil_id || null,
        description_fa: l.description_fa,
        debit_rial: parseRialInteger(l.debit_raw),
        credit_rial: parseRialInteger(l.credit_raw),
        moadian_tax_id: l.moadian_tax_id.trim() || null,
      })),
    [lines]
  );

  const balance = useMemo(() => computeVoucherBalance(parsedLines), [parsedLines]);

  const complianceIssues = useMemo(
    () => runVoucherCompliancePreCheck(descriptionFa, parsedLines, accounts),
    [descriptionFa, parsedLines, accounts]
  );

  const updateLine = (localId: string, patch: Partial<EditableLine>) => {
    setLines((prev) => prev.map((l) => (l.localId === localId ? { ...l, ...patch } : l)));
  };

  const handleSave = async () => {
    if (isReadOnly || !balance.isBalanced) return;
    if (!descriptionFa.trim()) {
      setSaveFeedback({ ok: false, messageFa: 'شرح کلی سند حسابداری الزامی است.' });
      return;
    }

    setSaving(true);
    setSaveFeedback(null);
    const res = await saveVoucherAtomic({
      id: editingId,
      jalali_date: jalaliDate,
      gregorian_date: gregorianDate,
      description_fa: descriptionFa.trim(),
      reference_no: referenceNo.trim() || undefined,
      source: 'MANUAL',
      compliance_flags: complianceIssues.filter((i) => i.severity !== 'INFO').map((i) => i.code),
      lines: parsedLines.filter((l) => l.debit_rial > 0 || l.credit_rial > 0),
    });
    setSaving(false);

    if (!res.ok) {
      setSaveFeedback({ ok: false, messageFa: res.errorFa ?? 'خطا در ثبت سند' });
      return;
    }

    setSaveFeedback({
      ok: true,
      messageFa: `سند شماره ${toPersianDigits(res.voucher?.voucher_no ?? 0)} به‌صورت اتمیک (fn_create_voucher_atomic) در وضعیت پیشنویس ثبت شد.`,
    });
    if (res.voucher) {
      setSelectedVoucherId(res.voucher.id);
      setIsCreatingNew(false);
    }
  };

  const handleDeleteDraft = async (voucherId: string) => {
    const res = await deleteDraftVoucher(voucherId);
    if (!res.ok) {
      setSaveFeedback({ ok: false, messageFa: res.errorFa ?? 'خطا در حذف سند' });
    } else {
      setSelectedVoucherId(null);
      setIsCreatingNew(false);
    }
  };

  const unitFa = unitLabelFa(currencyUnit);

  return (
    <div className="space-y-5">
      {/* Header Bar */}
      <div className="no-print flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#F8FAFC]">میز کار اسناد حسابداری و دفتر کل</h1>
          <p className="mt-1 text-xs text-[#94A3B8]">
            ثبت اتمیک اسناد دوطرفه (<span className="mono-ltr">fn_create_voucher_atomic</span>) · کنترل زنده تراز و قوانین مالیاتی ایران (مواد ۱۴۷، ۸۶، ۵۳، ۱۰۴ منسوخ و ۱۴۹)
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={isReadOnly}
            onClick={startNewVoucher}
            className="inline-flex items-center gap-2 rounded-lg bg-[#FF7A00] px-4 py-2 text-xs font-bold text-[#102333] transition-colors hover:bg-[#ff8c24] disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>سند جدید</span>
          </button>
        </div>
      </div>

      {/* Main Split: Ledger List (4 cols) + Workbench / Detail Viewer (8 cols) */}
      <div className="no-print grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Left/Start Panel: Voucher Register */}
        <aside className="xl:col-span-4 rounded-xl border border-white/10 bg-[#1E3A72] p-4 flex flex-col">
          <div className="space-y-3 border-b border-white/10 pb-3">
            <div className="relative">
              <Search className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-[#94A3B8]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="جستجو شماره سند، کد معین یا شرح..."
                aria-label="جستجو در اسناد حسابداری"
                className="w-full rounded-lg border border-white/15 bg-[#102333] py-2 pr-9 pl-3 text-xs text-[#F8FAFC] placeholder-[#94A3B8] focus:border-[#FF7A00] focus:outline-none"
              />
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-[#102333] p-1 text-[11px]">
              {(
                [
                  { id: 'ALL', label: 'همه' },
                  { id: 'FINALIZED', label: 'قطعی' },
                  { id: 'DRAFT', label: 'پیشنویس' },
                  { id: 'REJECTED', label: 'رد شده' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`flex-1 rounded-md py-1.5 font-semibold transition-colors ${
                    statusFilter === tab.id
                      ? 'bg-[#FF7A00] text-[#102333]'
                      : 'text-[#94A3B8] hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 flex-1 space-y-2 max-h-[620px] overflow-y-auto pl-1">
            {filteredVouchers.length === 0 ? (
              <div className="py-10 text-center text-xs text-[#94A3B8]">
                سندی با فیلتر انتخابی در سال مالی {activeFiscalYear.code} یافت نشد.
              </div>
            ) : (
              filteredVouchers.map((v) => {
                const totalDeb = v.lines.reduce((s, l) => s + l.debit_rial, 0);
                const isSelected = !isCreatingNew && selectedVoucher?.id === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => {
                      setIsCreatingNew(false);
                      setSelectedVoucherId(v.id);
                      setSaveFeedback(null);
                    }}
                    className={`w-full rounded-lg border p-3 text-right transition-colors ${
                      isSelected
                        ? 'border-[#FF7A00] bg-[#142A54]'
                        : 'border-white/10 bg-[#102333]/65 hover:border-white/25'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-[#F8FAFC]">
                        سند شماره <span className="num-ltr">{toPersianDigits(v.voucher_no)}</span>
                      </span>
                      <span className="num-ltr text-[11px] text-[#94A3B8]">{v.jalali_date}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs text-[#F8FAFC]/85 leading-relaxed">
                      {v.description_fa}
                    </p>
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <span
                        className={
                          v.status === 'FINALIZED'
                            ? 'font-semibold text-[#10B981]'
                            : v.status === 'REJECTED'
                            ? 'font-semibold text-[#ED2F42]'
                            : 'font-semibold text-[#FF7A00]'
                        }
                      >
                        {v.status === 'FINALIZED'
                          ? 'قطعی (فقط خواندنی)'
                          : v.status === 'REJECTED'
                          ? 'رد شده'
                          : v.source === 'AI_AGENT'
                          ? 'پیشنویس Muse.ai'
                          : 'پیشنویس (قابل ویرایش)'}
                      </span>
                      <span className="num-ltr font-bold text-[#F8FAFC]">
                        {formatCurrency(totalDeb, currencyUnit)} {unitFa}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Right/Main Panel: Voucher Editor OR Read-Only Official Viewer */}
        <section className="xl:col-span-8 rounded-xl border border-white/10 bg-[#1E3A72] p-5">
          {saveFeedback && (
            <div
              className={`mb-4 flex items-center gap-2 rounded-lg border p-3 text-xs font-medium ${
                saveFeedback.ok
                  ? 'border-[#10B981]/40 bg-[#10B981]/15 text-[#F8FAFC]'
                  : 'border-[#ED2F42]/50 bg-[#ED2F42]/15 text-[#F8FAFC]'
              }`}
            >
              {saveFeedback.ok ? (
                <CheckCircle2 className="h-4 w-4 text-[#10B981] shrink-0" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-[#ED2F42] shrink-0" />
              )}
              <span>{saveFeedback.messageFa}</span>
            </div>
          )}

          {isCreatingNew ? (
            /* =================== DOUBLE-ENTRY DRAFT EDITOR =================== */
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <h2 className="text-base font-bold text-[#F8FAFC]">
                    {editingId ? 'ویرایش سند پیشنویس (DRAFT)' : 'ثبت سند حسابداری جدید (دوطرفه)'}
                  </h2>
                  <p className="text-[11px] text-[#94A3B8]">
                    تمامی مبالغ ورودی دقیقاً به صورت عدد صحیح «ریال» ذخیره می‌شوند.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsCreatingNew(false)}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-[#94A3B8] hover:text-white"
                >
                  انصراف
                </button>
              </div>

              {/* Header Fields */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label htmlFor="v-jdate" className="mb-1 block text-xs font-semibold text-[#94A3B8]">
                    تاریخ شمسی سند
                  </label>
                  <input
                    id="v-jdate"
                    type="text"
                    dir="ltr"
                    value={jalaliDate}
                    onChange={(e) => setJalaliDate(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-[#102333] px-3 py-2 text-left font-mono text-xs text-[#F8FAFC] focus:border-[#FF7A00] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="v-ref" className="mb-1 block text-xs font-semibold text-[#94A3B8]">
                    شماره عطف / پیگیری
                  </label>
                  <input
                    id="v-ref"
                    type="text"
                    dir="ltr"
                    value={referenceNo}
                    onChange={(e) => setReferenceNo(e.target.value)}
                    placeholder="INV-1404-099"
                    className="w-full rounded-lg border border-white/15 bg-[#102333] px-3 py-2 text-left font-mono text-xs text-[#F8FAFC] focus:border-[#FF7A00] focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="v-acc-search" className="mb-1 block text-xs font-semibold text-[#94A3B8]">
                    فیلتر سریع کدینگ معین
                  </label>
                  <input
                    id="v-acc-search"
                    type="text"
                    value={accountFilter}
                    onChange={(e) => setAccountFilter(e.target.value)}
                    placeholder="جستجوی معین (مثلاً 6101 یا بانک)..."
                    className="w-full rounded-lg border border-white/15 bg-[#102333] px-3 py-2 text-xs text-[#F8FAFC] focus:border-[#FF7A00] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="v-desc" className="mb-1 block text-xs font-semibold text-[#94A3B8]">
                  شرح کلی سند حسابداری
                </label>
                <input
                  id="v-desc"
                  type="text"
                  value={descriptionFa}
                  onChange={(e) => setDescriptionFa(e.target.value)}
                  placeholder="مثال: پرداخت اجاره دفتر مرکزی، حقوق پرسنل یا سپرده ۵٪ راهداری..."
                  className="w-full rounded-lg border border-white/15 bg-[#102333] px-3 py-2 text-xs text-[#F8FAFC] focus:border-[#FF7A00] focus:outline-none"
                />
              </div>

              {/* Double-Entry Lines Table */}
              <div className="overflow-x-auto rounded-lg border border-white/10 bg-[#102333]/75">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[#94A3B8]">
                      <th className="p-2.5 min-w-[210px]">حساب معین و تفصیلی</th>
                      <th className="p-2.5 min-w-[200px]">شرح آرتیکل و شماره مالیاتی مودیان</th>
                      <th className="p-2.5 w-36 min-w-[136px]">بدهکار (ریال)</th>
                      <th className="p-2.5 w-36 min-w-[136px]">بستانکار (ریال)</th>
                      <th className="p-2.5 w-10 text-center">حذف</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {lines.map((line, index) => (
                      <tr key={line.localId}>
                        <td className="p-2 align-top space-y-1.5">
                          <select
                            aria-label={`حساب معین ردیف ${index + 1}`}
                            value={line.account_code}
                            onChange={(e) => {
                              const found = accounts.find((a) => a.code === e.target.value);
                              if (found) {
                                updateLine(line.localId, {
                                  account_id: found.id,
                                  account_code: found.code,
                                });
                              }
                            }}
                            className="w-full rounded border border-white/15 bg-[#1E3A72] px-2 py-1.5 text-xs text-[#F8FAFC] focus:border-[#FF7A00] focus:outline-none"
                          >
                            {(filteredAccounts.some((a) => a.code === line.account_code)
                              ? filteredAccounts
                              : accounts
                            ).map((acc) => (
                              <option key={acc.id} value={acc.code} className="bg-[#102333]">
                                {acc.code} — {acc.name_fa}
                              </option>
                            ))}
                          </select>
                          <select
                            aria-label={`حساب تفصیلی ردیف ${index + 1}`}
                            value={line.tafsil_id}
                            onChange={(e) => updateLine(line.localId, { tafsil_id: e.target.value })}
                            className="w-full rounded border border-white/10 bg-[#102333] px-2 py-1 text-[11px] text-[#94A3B8] focus:border-[#FF7A00] focus:text-[#F8FAFC] focus:outline-none"
                          >
                            <option value="" className="bg-[#102333]">
                              تفصیلی: — بدون تفصیلی —
                            </option>
                            {tafsilParties.map((t) => (
                              <option key={t.id} value={t.id} className="bg-[#102333]">
                                {t.code} — {t.name_fa}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2 align-top space-y-1.5">
                          <input
                            type="text"
                            aria-label={`شرح آرتیکل ردیف ${index + 1}`}
                            value={line.description_fa}
                            onChange={(e) => updateLine(line.localId, { description_fa: e.target.value })}
                            placeholder="شرح ردیف حسابداری..."
                            className="w-full rounded border border-white/15 bg-[#102333] px-2.5 py-1.5 text-xs text-[#F8FAFC] focus:border-[#FF7A00] focus:outline-none"
                          />
                          <input
                            type="text"
                            dir="ltr"
                            aria-label={`شماره مالیاتی مودیان ردیف ${index + 1}`}
                            value={line.moadian_tax_id}
                            onChange={(e) => updateLine(line.localId, { moadian_tax_id: e.target.value })}
                            placeholder="Moadian Tax ID (اختیاری)"
                            className="w-full rounded border border-white/10 bg-[#102333]/80 px-2.5 py-1 text-left font-mono text-[11px] text-[#94A3B8] focus:border-[#FF7A00] focus:outline-none"
                          />
                        </td>
                        <td className="p-2 align-top">
                          <input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            aria-label={`مبلغ بدهکار ردیف ${index + 1}`}
                            value={line.debit_raw}
                            onChange={(e) =>
                              updateLine(line.localId, {
                                debit_raw: e.target.value,
                                credit_raw: parseRialInteger(e.target.value) > 0 ? '' : line.credit_raw,
                              })
                            }
                            placeholder="0"
                            className="w-full rounded border border-white/15 bg-[#102333] px-2.5 py-1.5 text-left font-mono text-xs text-[#F8FAFC] focus:border-[#FF7A00] focus:outline-none"
                          />
                        </td>
                        <td className="p-2 align-top">
                          <input
                            type="text"
                            inputMode="numeric"
                            dir="ltr"
                            aria-label={`مبلغ بستانکار ردیف ${index + 1}`}
                            value={line.credit_raw}
                            onChange={(e) =>
                              updateLine(line.localId, {
                                credit_raw: e.target.value,
                                debit_raw: parseRialInteger(e.target.value) > 0 ? '' : line.debit_raw,
                              })
                            }
                            placeholder="0"
                            className="w-full rounded border border-white/15 bg-[#102333] px-2.5 py-1.5 text-left font-mono text-xs text-[#F8FAFC] focus:border-[#FF7A00] focus:outline-none"
                          />
                        </td>
                        <td className="p-2 align-top text-center">
                          <button
                            type="button"
                            disabled={lines.length <= 2}
                            onClick={() => setLines((prev) => prev.filter((x) => x.localId !== line.localId))}
                            aria-label={`حذف ردیف ${index + 1}`}
                            className="rounded p-1.5 text-[#94A3B8] hover:bg-[#ED2F42]/20 hover:text-[#ED2F42] disabled:opacity-30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Add Line + Live Debit / Credit / Variance Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-white/10 bg-[#102333] px-4 py-3 text-xs">
                <button
                  type="button"
                  onClick={() => setLines((prev) => [...prev, makeBlankLine(prev.length + 1)])}
                  className="inline-flex items-center gap-1.5 font-semibold text-[#FF7A00] hover:underline"
                >
                  <Plus className="h-4 w-4" />
                  افزودن آرتیکل جدید
                </button>

                <div className="flex flex-wrap items-center gap-5">
                  <div>
                    <span className="text-[#94A3B8]">جمع بدهکار: </span>
                    <strong className="num-ltr text-[#F8FAFC]">
                      {formatCurrency(balance.totalDebitRial, 'RIAL')} ریال
                    </strong>
                  </div>
                  <div>
                    <span className="text-[#94A3B8]">جمع بستانکار: </span>
                    <strong className="num-ltr text-[#F8FAFC]">
                      {formatCurrency(balance.totalCreditRial, 'RIAL')} ریال
                    </strong>
                  </div>
                  <div
                    data-testid="voucher-variance-pill"
                    className={`rounded-md px-3 py-1 font-bold ${
                      balance.isBalanced
                        ? 'bg-[#10B981]/20 text-[#10B981]'
                        : 'bg-[#ED2F42] text-white'
                    }`}
                  >
                    {balance.isBalanced ? (
                      <span>تراز (اختلاف ۰ ریال)</span>
                    ) : (
                      <span>
                        عدم تراز:{' '}
                        <span className="num-ltr">
                          {formatCurrency(Math.abs(balance.varianceRial), 'RIAL')}
                        </span>{' '}
                        ریال
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Inline Iranian Tax Compliance Pre-Check */}
              <div className="rounded-lg border border-white/10 bg-[#102333]/80 p-4 space-y-2.5">
                <div className="flex items-center justify-between text-xs font-bold text-[#F8FAFC]">
                  <span>پیش‌کنترل زنده انطباق مالیاتی ایران (مواد ۱۴۷، ۸۶، ۵۳، ۱۰۴ منسوخ و ۱۴۹)</span>
                  <span className="text-[11px] font-normal text-[#94A3B8]">
                    {toPersianDigits(complianceIssues.length)} مورد شناسایی‌شده
                  </span>
                </div>
                {complianceIssues.length === 0 ? (
                  <p className="text-xs text-[#10B981] flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    مغایرت مالیاتی آشکاری در آرتیکل‌های این سند شناسایی نشد.
                  </p>
                ) : (
                  <ul className="space-y-2 text-xs">
                    {complianceIssues.map((issue) => (
                      <li
                        key={issue.code}
                        className={`rounded-md border p-2.5 ${
                          issue.severity === 'CRITICAL'
                            ? 'border-[#ED2F42]/60 bg-[#ED2F42]/15 text-[#F8FAFC]'
                            : issue.severity === 'WARNING'
                            ? 'border-[#FF7A00]/50 bg-[#FF7A00]/10 text-[#F8FAFC]'
                            : 'border-white/15 bg-white/5 text-[#F8FAFC]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 font-bold">
                          <span>{issue.title_fa}</span>
                          <span className="text-[11px] text-[#94A3B8]">{issue.article_ref}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-[#F8FAFC]/85 leading-relaxed">{issue.detail_fa}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Atomic Submit Button */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={isReadOnly || !balance.isBalanced || saving}
                  onClick={handleSave}
                  data-testid="save-voucher-atomic-btn"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#FF7A00] px-5 py-2.5 text-xs font-bold text-[#102333] transition-colors hover:bg-[#ff8c24] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Save className="h-4 w-4" />
                  <span>{saving ? 'در حال ثبت اتمیک...' : 'ثبت اتمیک سند (fn_create_voucher_atomic)'}</span>
                </button>
              </div>
            </div>
          ) : selectedVoucher ? (
            /* =================== VOUCHER INSPECTOR VIEW =================== */
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-lg font-extrabold text-[#F8FAFC]">
                      سند حسابداری شماره <span className="num-ltr">{toPersianDigits(selectedVoucher.voucher_no)}</span>
                    </h2>
                    <span
                      className={`text-xs font-bold ${
                        selectedVoucher.status === 'FINALIZED'
                          ? 'text-[#10B981]'
                          : selectedVoucher.status === 'REJECTED'
                          ? 'text-[#ED2F42]'
                          : 'text-[#FF7A00]'
                      }`}
                    >
                      ·{' '}
                      {selectedVoucher.status === 'FINALIZED'
                        ? 'قطعی‌شده (غیرقابل تغییر)'
                        : selectedVoucher.status === 'REJECTED'
                        ? 'رد شده'
                        : 'پیشنویس (DRAFT)'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[#94A3B8]">
                    تاریخ: <span className="num-ltr text-[#F8FAFC]">{selectedVoucher.jalali_date}</span> · عطف:{' '}
                    <span className="mono-ltr text-[#F8FAFC]">{selectedVoucher.reference_no ?? '—'}</span> · صادرکننده:{' '}
                    {selectedVoucher.created_by}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPrintVoucher(selectedVoucher)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-[#102333] px-3.5 py-2 text-xs font-semibold text-[#F8FAFC] hover:border-[#FF7A00]"
                  >
                    <Printer className="h-4 w-4 text-[#FF7A00]" />
                    <span>چاپ سند رسمی</span>
                  </button>

                  {selectedVoucher.status === 'DRAFT' && (
                    <>
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => startEditDraft(selectedVoucher)}
                        className="rounded-lg bg-[#FF7A00] px-3.5 py-2 text-xs font-bold text-[#102333] hover:bg-[#ff8c24] disabled:opacity-40"
                      >
                        ویرایش پیشنویس
                      </button>
                      <button
                        type="button"
                        disabled={isReadOnly}
                        onClick={() => handleDeleteDraft(selectedVoucher.id)}
                        className="rounded-lg border border-[#ED2F42]/50 px-3 py-2 text-xs font-semibold text-[#ED2F42] hover:bg-[#ED2F42]/15 disabled:opacity-40"
                      >
                        حذف
                      </button>
                    </>
                  )}

                  {selectedVoucher.status === 'FINALIZED' && (
                    <span className="inline-flex items-center gap-1 text-xs text-[#94A3B8]">
                      <Lock className="h-3.5 w-3.5" />
                      سند قطعی
                    </span>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-[#102333]/70 p-3.5 text-xs text-[#F8FAFC]">
                <span className="text-[#94A3B8]">شرح سند: </span>
                {selectedVoucher.description_fa}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-right text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[#94A3B8]">
                      <th className="py-2.5 px-2">ردیف</th>
                      <th className="py-2.5 px-2">کد معین</th>
                      <th className="py-2.5 px-2">شرح حساب و تفصیلی</th>
                      <th className="py-2.5 px-2">بدهکار ({unitFa})</th>
                      <th className="py-2.5 px-2">بستانکار ({unitFa})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {selectedVoucher.lines.map((line) => {
                      const acc = accounts.find((a) => a.code === line.account_code);
                      return (
                        <tr key={line.id} className="hover:bg-white/5">
                          <td className="py-2.5 px-2 num-ltr text-[#94A3B8]">{toPersianDigits(line.line_no)}</td>
                          <td className="py-2.5 px-2 mono-ltr font-bold text-[#FF7A00]">{line.account_code}</td>
                          <td className="py-2.5 px-2">
                            <div className="font-semibold text-[#F8FAFC]">{acc?.name_fa ?? line.account_code}</div>
                            {line.tafsil_name && (
                              <div className="text-[11px] text-[#FF7A00]/90">تفصیلی: {line.tafsil_name}</div>
                            )}
                            <div className="text-[11px] text-[#94A3B8] mt-0.5">{line.description_fa}</div>
                            {line.moadian_tax_id && (
                              <div className="mono-ltr text-[10px] text-[#10B981] mt-0.5">
                                Moadian Tax ID: {line.moadian_tax_id}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-2 num-ltr font-semibold text-[#F8FAFC]">
                            {line.debit_rial > 0 ? formatCurrency(line.debit_rial, currencyUnit) : '—'}
                          </td>
                          <td className="py-2.5 px-2 num-ltr font-semibold text-[#F8FAFC]">
                            {line.credit_rial > 0 ? formatCurrency(line.credit_rial, currencyUnit) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-white/20 font-bold text-[#F8FAFC]">
                      <td colSpan={3} className="py-3 px-2">
                        جمع کل سند ({unitFa})
                      </td>
                      <td className="py-3 px-2 num-ltr text-[#10B981]">
                        {formatCurrency(
                          selectedVoucher.lines.reduce((s, l) => s + l.debit_rial, 0),
                          currencyUnit
                        )}
                      </td>
                      <td className="py-3 px-2 num-ltr text-[#10B981]">
                        {formatCurrency(
                          selectedVoucher.lines.reduce((s, l) => s + l.credit_rial, 0),
                          currencyUnit
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center text-xs text-[#94A3B8]">
              <FileText className="h-10 w-10 text-white/20 mb-3" />
              <p>هیچ سندی در سال مالی انتخاب‌شده وجود ندارد.</p>
              <button
                type="button"
                disabled={isReadOnly}
                onClick={startNewVoucher}
                className="mt-4 rounded-lg bg-[#FF7A00] px-4 py-2 text-xs font-bold text-[#102333] disabled:opacity-40"
              >
                ایجاد اولین سند حسابداری
              </button>
            </div>
          )}
        </section>
      </div>

      {/* =================== PRINT OFFICIAL VOUCHER MODAL (ALWAYS EXACT RIALS) =================== */}
      {printVoucher && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-label="پیش‌نمایش چاپ سند رسمی حسابداری"
        >
          <div className="print-sheet w-full max-w-4xl rounded-xl bg-white p-8 text-black shadow-2xl">
            {/* Screen-only Print Toolbar */}
            <div className="no-print mb-6 flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="text-sm font-bold text-slate-800">
                پیش‌نمایش چاپ سند رسمی (مبالغ همیشه بر حسب ریال دقیق قانونی چاپ می‌شوند)
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#FF7A00] px-4 py-2 text-xs font-bold text-[#102333]"
                >
                  <Printer className="h-4 w-4" />
                  چاپ نهایی (A4)
                </button>
                <button
                  type="button"
                  onClick={() => setPrintVoucher(null)}
                  aria-label="بستن پیش‌نمایش چاپ"
                  className="rounded-lg border border-slate-300 p-2 text-slate-700 hover:bg-slate-100"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Official Printable Header */}
            <div className="flex items-start justify-between border-b-2 border-black pb-4">
              <BrandMark forPrint />
              <div className="text-center">
                <h2 className="text-lg font-extrabold text-black">سند حسابداری رسمی</h2>
                <div className="text-xs font-semibold text-slate-700 mt-1">{COMPANY_INFO.nameFa}</div>
                <div className="text-[11px] text-slate-600 mt-0.5">
                  شناسه ملی: <span className="mono-ltr font-bold">{COMPANY_INFO.nationalId}</span> · کد اقتصادی:{' '}
                  <span className="mono-ltr font-bold">{COMPANY_INFO.economicCode}</span>
                </div>
              </div>
              <div className="text-xs space-y-1 text-left">
                <div>
                  شماره سند: <strong className="num-ltr">{toPersianDigits(printVoucher.voucher_no)}</strong>
                </div>
                <div>
                  تاریخ: <strong className="num-ltr">{printVoucher.jalali_date}</strong>
                </div>
                <div>
                  سال مالی: <strong className="num-ltr">{activeFiscalYear.code}</strong>
                </div>
                <div>
                  عطف: <strong className="mono-ltr">{printVoucher.reference_no ?? '—'}</strong>
                </div>
              </div>
            </div>

            <div className="my-4 text-xs">
              <strong>شرح سند: </strong>
              {printVoucher.description_fa}
            </div>

            <table className="w-full border-collapse border border-black text-right text-xs">
              <thead>
                <tr className="bg-slate-100">
                  <th className="border border-black p-2 w-12 text-center">ردیف</th>
                  <th className="border border-black p-2 w-20 text-center">کد معین</th>
                  <th className="border border-black p-2">شرح حساب، تفصیلی و آرتیکل</th>
                  <th className="border border-black p-2 w-36 text-center">بدهکار (ریال)</th>
                  <th className="border border-black p-2 w-36 text-center">بستانکار (ریال)</th>
                </tr>
              </thead>
              <tbody>
                {printVoucher.lines.map((l) => {
                  const acc = accounts.find((a) => a.code === l.account_code);
                  return (
                    <tr key={l.id}>
                      <td className="border border-black p-2 text-center num-ltr">{toPersianDigits(l.line_no)}</td>
                      <td className="border border-black p-2 text-center mono-ltr font-bold">{l.account_code}</td>
                      <td className="border border-black p-2">
                        <div className="font-bold">{acc?.name_fa ?? l.account_code}</div>
                        {l.tafsil_name && <div className="text-[11px]">تفصیلی: {l.tafsil_name}</div>}
                        <div className="text-[11px] text-slate-700">{l.description_fa}</div>
                      </td>
                      <td className="border border-black p-2 text-left num-ltr font-semibold">
                        {l.debit_rial > 0 ? formatCurrency(l.debit_rial, 'RIAL') : '۰'}
                      </td>
                      <td className="border border-black p-2 text-left num-ltr font-semibold">
                        {l.credit_rial > 0 ? formatCurrency(l.credit_rial, 'RIAL') : '۰'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 font-bold">
                  <td colSpan={3} className="border border-black p-2">
                    جمع کل سند به ریال دقیق قانونی
                  </td>
                  <td className="border border-black p-2 text-left num-ltr">
                    {formatCurrency(
                      printVoucher.lines.reduce((s, l) => s + l.debit_rial, 0),
                      'RIAL'
                    )}
                  </td>
                  <td className="border border-black p-2 text-left num-ltr">
                    {formatCurrency(
                      printVoucher.lines.reduce((s, l) => s + l.credit_rial, 0),
                      'RIAL'
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>

            {/* Signature Blocks */}
            <div className="mt-10 grid grid-cols-4 gap-4 text-center text-xs">
              <div className="border-t border-black pt-2">
                <div className="font-bold">تنظیم‌کننده</div>
                <div className="mt-6 text-[11px] text-slate-600">{printVoucher.created_by}</div>
              </div>
              <div className="border-t border-black pt-2">
                <div className="font-bold">بررسی و کنترل مالیاتی</div>
                <div className="mt-6 text-[11px] text-slate-600">حسابرسی داخلی</div>
              </div>
              <div className="border-t border-black pt-2">
                <div className="font-bold">تأیید مدیر مالی</div>
                <div className="mt-6 text-[11px] text-slate-600">{printVoucher.approved_by ?? 'امضاء و مهر'}</div>
              </div>
              <div className="border-t border-black pt-2">
                <div className="font-bold">تصویب مدیرعامل</div>
                <div className="mt-6 text-[11px] text-slate-600">مهر رسمی شرکت</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
