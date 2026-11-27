import React, { useRef, useState } from 'react';
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  Download,
  Database,
} from 'lucide-react';
import { useFiscalYear } from '../contexts/FiscalYearContext';
import { formatCurrency, toPersianDigits, unitLabelFa } from '../lib/persian';
import type { ExcelFormatType, ParsedExcelResult } from '../types/erp';

const FORMAT_TEMPLATES: Array<{
  format: ExcelFormatType;
  titleFa: string;
  descFa: string;
}> = [
  {
    format: 'BANK_EGHTESAD_NOVIN',
    titleFa: 'صورتحساب بانک اقتصاد نوین (.xls/.xlsx)',
    descFa: 'حذف ۷ ردیف فراداده، نادیده‌گیری سلول E4، معکوس‌سازی نزولی و اثبات پیوستگی مانده',
  },
  {
    format: 'MOADIAN_SALES',
    titleFa: 'فروش سامانه مودیان (۳۲ ستون)',
    descFa: 'نرمال‌سازی ي/ك به ی/ک، حذف باطل شده و نشانه‌گذاری ردیف‌های رد شده',
  },
  {
    format: 'MOADIAN_PURCHASES',
    titleFa: 'خرید سامانه مودیان (۲۹ ستون)',
    descFa: 'کنترل ۱۰٪ ارزش افزوده ورودی و تفکیک وضعیت‌های کارپوشه مودیان',
  },
  {
    format: 'CATALOG_PARTIES_PRODUCTS',
    titleFa: 'مشتریان و کالاها (OLE Date / GroupGuid)',
    descFa: 'تبدیل تاریخ عددی اکسل به شمسی و نگاشت GroupGuid به تفصیلی',
  },
  {
    format: 'FIXED_ASSETS',
    titleFa: 'دارایی‌های ثابت (تجهیزات.xlsx)',
    descFa: 'محاسبه همزمان استهلاک دفتری و قانونی ماده ۱۴۹ (ردیف ۴۰۶)',
  },
  {
    format: 'TRIAL_BALANCE',
    titleFa: 'تراز آزمایشی (کنترل OCR ویرگول)',
    descFa: 'پایش خطای گروه‌بندی ارقام OCR (مانند 50412,530,000 ← 5,412,530,000)',
  },
];

export function ExcelImporterView() {
  const { activeFiscalYear, isReadOnly, currencyUnit, commitExcelImport } = useFiscalYear();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [parsed, setParsed] = useState<ParsedExcelResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<{ ok: boolean; messageFa: string } | null>(null);
  const [committing, setCommitting] = useState(false);

  const handleFile = async (file: File) => {
    setParseError(null);
    setCommitResult(null);
    try {
      const { parseAccountingExcelBuffer } = await import('../lib/excelParsers');
      const buffer = await file.arrayBuffer();
      const result = parseAccountingExcelBuffer(buffer, file.name);
      setParsed(result);
    } catch (err) {
      setParseError(
        err instanceof Error
          ? `خطا در پردازش فایل اکسل: ${err.message}`
          : 'فایل انتخاب‌شده قالب معتبر .xls یا .xlsx ندارد.'
      );
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const runSampleDryRun = async (format: ExcelFormatType) => {
    setParseError(null);
    setCommitResult(null);
    try {
      const { buildSampleWorkbookBuffer, parseAccountingExcelBuffer } = await import('../lib/excelParsers');
      const { buffer, fileName } = buildSampleWorkbookBuffer(format);
      const result = parseAccountingExcelBuffer(buffer, fileName);
      setParsed(result);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'خطا در تولید پیش‌نمایش نمونه اکسل');
    }
  };

  const downloadSampleWorkbook = async (format: ExcelFormatType) => {
    const { buildSampleWorkbookBuffer } = await import('../lib/excelParsers');
    const { buffer, fileName } = buildSampleWorkbookBuffer(format);
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCommit = async () => {
    if (!parsed || isReadOnly) return;
    setCommitting(true);
    const res = await commitExcelImport(parsed);
    setCommitting(false);
    setCommitResult({ ok: res.ok, messageFa: res.messageFa });
  };

  const unitFa = unitLabelFa(currencyUnit);

  return (
    <div className="space-y-6">
      <div className="border-b border-white/10 pb-4">
        <h1 className="text-2xl font-extrabold text-[#F8FAFC]">ورود گروهی اکسل و مغایرت‌گیری هوشمند</h1>
        <p className="mt-1 text-xs text-[#94A3B8]">
          پردازش درون‌مرورگری با SheetJS 0.20.3 (پشتیبانی کامل BIFF8 <span className="mono-ltr">.xls</span> بانک اقتصاد نوین و{' '}
          <span className="mono-ltr">.xlsx</span>) · تشخیص خودکار ۵ قالب مالی و پیش‌نمایش آزمایشی (Dry-Run) پیش از درج Idempotent در سال مالی{' '}
          <span className="num-ltr font-bold text-[#F8FAFC]">{activeFiscalYear.code}</span>
        </p>
      </div>

      {/* Drag & Drop Zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
          isDragging
            ? 'border-[#FF7A00] bg-[#1E3A72]'
            : 'border-white/20 bg-[#1E3A72]/70 hover:border-[#FF7A00]/70'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".xls,.xlsx"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        <UploadCloud className="mx-auto h-10 w-10 text-[#FF7A00]" />
        <h2 className="mt-3 text-base font-bold text-[#F8FAFC]">
          فایل اکسل (.xls یا .xlsx) را اینجا رها کنید یا انتخاب نمایید
        </h2>
        <p className="mt-1 text-xs text-[#94A3B8]">
          تشخیص خودکار: بانک اقتصاد نوین و تنخواه · فروش/خرید مودیان (۳۲/۲۹ ستون) · مشتریان و کالاها · تجهیزات.xlsx · تراز آزمایشی
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#FF7A00] px-5 py-2 text-xs font-bold text-[#102333] hover:bg-[#ff8c24]"
        >
          <FileSpreadsheet className="h-4 w-4" />
          انتخاب فایل اکسل از سیستم
        </button>
      </div>

      {/* Instant Dry-Run Test Suite for all 5 Formats */}
      <section className="rounded-xl border border-white/10 bg-[#1E3A72] p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[#F8FAFC]">
            تست سریع پیش‌نمایش (Dry-Run) و دریافت فایل‌های نمونه استاندارد آتی فرزام
          </h2>
          <span className="text-[11px] text-[#94A3B8]">تولید فایل واقعی در حافظه با SheetJS 0.20.3</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {FORMAT_TEMPLATES.map((tpl) => (
            <div
              key={tpl.format}
              className="flex flex-col justify-between rounded-lg border border-white/10 bg-[#102333]/75 p-3.5"
            >
              <div>
                <div className="text-xs font-bold text-[#F8FAFC]">{tpl.titleFa}</div>
                <p className="mt-1 text-[11px] text-[#94A3B8] leading-relaxed">{tpl.descFa}</p>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => runSampleDryRun(tpl.format)}
                  className="flex-1 rounded-md bg-[#1E3A72] border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-[#F8FAFC] hover:border-[#FF7A00] hover:text-[#FF7A00]"
                >
                  اجرای Dry-Run
                </button>
                <button
                  type="button"
                  onClick={() => downloadSampleWorkbook(tpl.format)}
                  aria-label={`دانلود نمونه ${tpl.titleFa}`}
                  className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2.5 py-1.5 text-[11px] text-[#94A3B8] hover:text-white"
                >
                  <Download className="h-3.5 w-3.5" />
                  نمونه
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {parseError && (
        <div className="flex items-center gap-2 rounded-lg border border-[#ED2F42]/60 bg-[#ED2F42]/15 p-3.5 text-xs text-[#F8FAFC]">
          <AlertTriangle className="h-4 w-4 text-[#ED2F42] shrink-0" />
          <span>{parseError}</span>
        </div>
      )}

      {/* Dry-Run Preview Results */}
      {parsed && (
        <section className="rounded-xl border border-white/10 bg-[#1E3A72] p-5 space-y-4" data-testid="excel-dry-run-panel">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <div className="text-xs font-semibold text-[#FF7A00]">قالب تشخیص‌داده‌شده</div>
              <h2 className="mt-0.5 text-lg font-extrabold text-[#F8FAFC]">{parsed.formatTitleFa}</h2>
              <div className="mt-1 text-xs text-[#94A3B8]">
                فایل: <span className="mono-ltr text-[#F8FAFC]">{parsed.fileName}</span> · ستون‌ها:{' '}
                <span className="num-ltr text-[#F8FAFC]">{toPersianDigits(parsed.detectedColumns)}</span> · ردیف‌های
                معتبر: <span className="num-ltr text-[#10B981] font-bold">{toPersianDigits(parsed.validRowsCount)}</span> ·
                مستثنی‌شده (باطل):{' '}
                <span className="num-ltr text-[#FF7A00] font-bold">{toPersianDigits(parsed.excludedRowsCount)}</span> ·
                هشداردار:{' '}
                <span className="num-ltr text-[#ED2F42] font-bold">{toPersianDigits(parsed.flaggedRowsCount)}</span>
              </div>
            </div>

            <button
              type="button"
              disabled={isReadOnly || committing}
              onClick={handleCommit}
              className="inline-flex items-center gap-2 rounded-lg bg-[#FF7A00] px-4 py-2.5 text-xs font-bold text-[#102333] hover:bg-[#ff8c24] disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Database className="h-4 w-4" />
              <span>{committing ? 'در حال ثبت...' : 'تأیید و درج Idempotent در پایگاه داده'}</span>
            </button>
          </div>

          {commitResult && (
            <div
              className={`flex items-center gap-2 rounded-lg border p-3 text-xs font-semibold ${
                commitResult.ok
                  ? 'border-[#10B981]/50 bg-[#10B981]/15 text-[#F8FAFC]'
                  : 'border-[#ED2F42]/50 bg-[#ED2F42]/15 text-[#F8FAFC]'
              }`}
            >
              {commitResult.ok ? (
                <CheckCircle2 className="h-4 w-4 text-[#10B981]" />
              ) : (
                <AlertTriangle className="h-4 w-4 text-[#ED2F42]" />
              )}
              <span>{commitResult.messageFa}</span>
            </div>
          )}

          {/* Metadata & Audit Notes */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-[#102333]/80 p-3.5 text-xs space-y-1.5">
              <div className="font-bold text-[#F8FAFC]">گزارش پردازش و کنترل کیفیت</div>
              {parsed.metadataNotes.map((n, i) => (
                <div key={i} className="text-[#94A3B8] leading-relaxed">
                  • {n}
                </div>
              ))}
            </div>

            {parsed.continuitySummary && (
              <div className="rounded-lg border border-[#10B981]/40 bg-[#102333]/80 p-3.5 text-xs space-y-1.5">
                <div className="font-bold text-[#10B981]">اثبات ریاضی پیوستگی مانده بانک اقتصاد نوین</div>
                <div className="text-[#F8FAFC]">
                  تراکنش‌های بررسی‌شده: <strong className="num-ltr">{toPersianDigits(parsed.continuitySummary.checked)}</strong> ·
                  تأیید‌شده: <strong className="num-ltr text-[#10B981]">{toPersianDigits(parsed.continuitySummary.passed)}</strong> ·
                  مغایرت: <strong className="num-ltr text-[#ED2F42]">{toPersianDigits(parsed.continuitySummary.failed)}</strong>
                </div>
                <div className="text-[#94A3B8]">
                  معکوس‌سازی ترتیب نزولی:{' '}
                  <strong className="text-[#F8FAFC]">
                    {parsed.continuitySummary.wasReversedFromDescending ? 'انجام شد (صعودی)' : 'نیاز نبود'}
                  </strong>
                </div>
              </div>
            )}

            {parsed.ocrCorrections && parsed.ocrCorrections.length > 0 && (
              <div className="rounded-lg border border-[#ED2F42]/60 bg-[#ED2F42]/15 p-3.5 text-xs space-y-1.5">
                <div className="font-bold text-[#ED2F42]">هشدار خطای گروه‌بندی OCR تراز آزمایشی</div>
                {parsed.ocrCorrections.map((c, idx) => (
                  <div key={idx} className="text-[#F8FAFC]">
                    ردیف {toPersianDigits(c.rowIndex)} ({c.field}): مقدار خام{' '}
                    <span className="mono-ltr font-bold text-[#ED2F42]">{c.rawText}</span> ← اصلاح پیشنهادی{' '}
                    <span className="mono-ltr font-bold text-[#10B981]">{c.suggestedFormatted}</span> ریال
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Preview Data Table */}
          <div className="overflow-x-auto rounded-lg border border-white/10 bg-[#102333]/75">
            <table className="w-full text-right text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[#94A3B8]">
                  <th className="p-2.5">ردیف</th>
                  {parsed.columns.map((col) => (
                    <th key={col.key} className="p-2.5 whitespace-nowrap">
                      {col.labelFa} {col.isNumeric ? `(${unitFa})` : ''}
                    </th>
                  ))}
                  <th className="p-2.5">وضعیت و هشدارها</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {parsed.rows.map((row) => (
                  <tr
                    key={row.rowIndex}
                    className={
                      row.excluded
                        ? 'bg-white/5 opacity-55 line-through'
                        : row.severity === 'ERROR'
                        ? 'bg-[#ED2F42]/10'
                        : 'hover:bg-white/5'
                    }
                  >
                    <td className="p-2.5 num-ltr text-[#94A3B8]">{toPersianDigits(row.rowIndex)}</td>
                    {parsed.columns.map((col) => {
                      const val = row.data[col.key];
                      if (col.isNumeric && typeof val === 'number') {
                        return (
                          <td key={col.key} className="p-2.5 num-ltr font-semibold text-[#F8FAFC]">
                            {formatCurrency(val, currencyUnit)}
                          </td>
                        );
                      }
                      return (
                        <td key={col.key} className={`p-2.5 text-[#F8FAFC] ${col.isLtr ? 'mono-ltr' : ''}`}>
                          {String(val ?? '—')}
                        </td>
                      );
                    })}
                    <td className="p-2.5 text-[11px]">
                      {row.flags.length === 0 ? (
                        <span className="text-[#10B981] font-semibold">سالم</span>
                      ) : (
                        <div className="space-y-0.5 text-[#ED2F42] font-medium">
                          {row.flags.map((f, idx) => (
                            <div key={idx}>{f}</div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
