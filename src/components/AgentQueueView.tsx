import { useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  XCircle,
  FileSearch,
  AlertTriangle,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';
import { useFiscalYear } from '../contexts/FiscalYearContext';
import { formatCurrency, toPersianDigits, unitLabelFa } from '../lib/persian';

export function AgentQueueView() {
  const {
    activeFiscalYear,
    isReadOnly,
    agentApprovals,
    vouchers,
    accounts,
    currencyUnit,
    approveAgentDraft,
    rejectAgentDraft,
  } = useFiscalYear();

  const [filter, setFilter] = useState<'PENDING_HUMAN_APPROVAL' | 'ALL' | 'APPROVED' | 'REJECTED'>(
    'PENDING_HUMAN_APPROVAL'
  );
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [actionBanner, setActionBanner] = useState<{ ok: boolean; messageFa: string } | null>(null);

  const filteredRequests = useMemo(() => {
    if (filter === 'ALL') return agentApprovals;
    return agentApprovals.filter((a) => a.status === filter);
  }, [agentApprovals, filter]);

  const handleApprove = async (approvalId: string) => {
    if (isReadOnly) return;
    const res = await approveAgentDraft(approvalId);
    setActionBanner(res);
  };

  const handleConfirmReject = async (approvalId: string) => {
    if (isReadOnly) return;
    const res = await rejectAgentDraft(approvalId, rejectReason.trim() || 'عدم کفایت مستندات مالیاتی');
    setRejectingId(null);
    setRejectReason('');
    setActionBanner(res);
  };

  const unitFa = unitLabelFa(currencyUnit);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#F8FAFC]">صف تأیید اسناد هوش مصنوعی (Muse.ai)</h1>
          <p className="mt-1 text-xs text-[#94A3B8]">
            حاکمیت انسان در حلقه (Human-in-the-Loop) · عامل Muse.ai تنها مجاز به ثبت پیشنویس بوده و قطعی‌سازی سند صرفاً با امضای مدیر مالی انجام می‌شود
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-[#1E3A72] border border-white/10 p-1 text-xs">
          {(
            [
              { id: 'PENDING_HUMAN_APPROVAL', label: 'در انتظار تأیید' },
              { id: 'APPROVED', label: 'قطعی‌شده' },
              { id: 'REJECTED', label: 'رد شده' },
              { id: 'ALL', label: 'همه موارد' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              className={`rounded-md px-3 py-1.5 font-semibold transition-colors whitespace-nowrap ${
                filter === t.id ? 'bg-[#FF7A00] text-[#102333]' : 'text-[#94A3B8] hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {actionBanner && (
        <div
          className={`flex items-center gap-2 rounded-lg border p-3.5 text-xs font-semibold ${
            actionBanner.ok
              ? 'border-[#10B981]/50 bg-[#10B981]/15 text-[#F8FAFC]'
              : 'border-[#ED2F42]/50 bg-[#ED2F42]/15 text-[#F8FAFC]'
          }`}
        >
          {actionBanner.ok ? (
            <CheckCircle2 className="h-4 w-4 text-[#10B981]" />
          ) : (
            <AlertTriangle className="h-4 w-4 text-[#ED2F42]" />
          )}
          <span>{actionBanner.messageFa}</span>
        </div>
      )}

      {filteredRequests.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#1E3A72] py-14 text-center">
          <ShieldCheck className="mx-auto h-10 w-10 text-[#10B981]" />
          <h2 className="mt-3 text-base font-bold text-[#F8FAFC]">صف بررسی در این فیلتر خالی است</h2>
          <p className="mt-1 text-xs text-[#94A3B8]">
            تمامی پیشنویس‌های هوش مصنوعی در سال مالی {activeFiscalYear.code} تعیین تکلیف شده‌اند.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {filteredRequests.map((req) => {
            const voucher = vouchers.find((v) => v.id === req.voucher_id);
            const totalDeb = voucher ? voucher.lines.reduce((s, l) => s + l.debit_rial, 0) : 0;

            return (
              <article
                key={req.id}
                data-testid={`agent-ticket-${req.id}`}
                className="rounded-xl border border-white/10 bg-[#1E3A72] p-5 space-y-4"
              >
                {/* Ticket Header */}
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Bot className="h-4 w-4 text-[#FF7A00]" />
                      <span className="font-bold text-[#F8FAFC]">{req.agent_name}</span>
                      <span className="text-[#94A3B8]">·</span>
                      <span className="mono-ltr text-[#FF7A00]">{req.tool_name}</span>
                      <span className="text-[#94A3B8]">·</span>
                      <span className="num-ltr text-[#94A3B8]">{req.created_at}</span>
                    </div>
                    <h2 className="text-base font-extrabold text-[#F8FAFC]">
                      {voucher
                        ? `سند پیشنویس شماره ${toPersianDigits(voucher.voucher_no ?? 0)} — ${voucher.description_fa}`
                        : `درخواست ${req.id}`}
                    </h2>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#94A3B8]">
                      <span className="inline-flex items-center gap-1">
                        <KeyRound className="h-3.5 w-3.5 text-[#FF7A00]" />
                        کلید یکتا (<span className="mono-ltr">idempotency_key</span>):{' '}
                        <span className="mono-ltr text-[#F8FAFC] font-semibold">{req.idempotency_key}</span>
                      </span>
                    </div>
                  </div>

                  <div className="text-left">
                    <div className="text-[11px] text-[#94A3B8]">مبلغ کل سند ({unitFa})</div>
                    <div className="num-ltr text-lg font-extrabold text-[#F8FAFC]">
                      {formatCurrency(totalDeb, currencyUnit)}
                    </div>
                    <div
                      className={`mt-1 text-xs font-bold ${
                        req.status === 'APPROVED'
                          ? 'text-[#10B981]'
                          : req.status === 'REJECTED'
                          ? 'text-[#ED2F42]'
                          : 'text-[#FF7A00]'
                      }`}
                    >
                      {req.status === 'APPROVED'
                        ? 'تأیید و قطعی‌سازی شده'
                        : req.status === 'REJECTED'
                        ? 'رد شده توسط مدیر مالی'
                        : 'در انتظار تصمیم انسانی'}
                    </div>
                  </div>
                </div>

                {/* Rationale & Linked Bank/Moadian Evidence */}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 text-xs">
                  <div className="rounded-lg border border-white/10 bg-[#102333]/75 p-3.5 space-y-1.5">
                    <div className="font-bold text-[#F8FAFC]">استدلال حسابداری عامل Muse.ai</div>
                    <p className="text-[#F8FAFC]/85 leading-relaxed">{req.rationale_fa}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-[#102333]/75 p-3.5 space-y-1.5">
                    <div className="flex items-center justify-between font-bold text-[#F8FAFC]">
                      <span className="inline-flex items-center gap-1.5">
                        <FileSearch className="h-3.5 w-3.5 text-[#FF7A00]" />
                        مستندات پیوست (بانک / سامانه مودیان)
                      </span>
                      <span className="mono-ltr text-[11px] text-[#FF7A00]">{req.evidence_ref}</span>
                    </div>
                    <p className="text-[#94A3B8] leading-relaxed">{req.evidence_summary_fa}</p>
                  </div>
                </div>

                {/* Compliance Flags */}
                {req.compliance_flags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-[#94A3B8] font-semibold">پرچم‌های انطباق مالیاتی:</span>
                    {req.compliance_flags.map((flag, i) => {
                      const isCritical = flag.includes('۱۴۷') || flag.includes('رد');
                      return (
                        <span
                          key={i}
                          className={`rounded-md border px-2.5 py-1 text-[11px] font-bold ${
                            isCritical
                              ? 'border-[#ED2F42]/60 bg-[#ED2F42]/15 text-[#ED2F42]'
                              : 'border-[#FF7A00]/40 bg-[#FF7A00]/15 text-[#FF7A00]'
                          }`}
                        >
                          {flag}
                        </span>
                      );
                    })}
                  </div>
                )}

                {/* Double-Entry Lines Table */}
                {voucher && (
                  <div className="overflow-x-auto rounded-lg border border-white/10 bg-[#102333]/70">
                    <table className="w-full text-right text-xs">
                      <thead>
                        <tr className="border-b border-white/10 text-[#94A3B8]">
                          <th className="p-2.5">کد معین</th>
                          <th className="p-2.5">حساب و شرح آرتیکل</th>
                          <th className="p-2.5">بدهکار ({unitFa})</th>
                          <th className="p-2.5">بستانکار ({unitFa})</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10">
                        {voucher.lines.map((l) => {
                          const acc = accounts.find((a) => a.code === l.account_code);
                          return (
                            <tr key={l.id}>
                              <td className="p-2.5 mono-ltr font-bold text-[#FF7A00]">{l.account_code}</td>
                              <td className="p-2.5">
                                <div className="font-semibold text-[#F8FAFC]">{acc?.name_fa ?? l.account_code}</div>
                                <div className="text-[11px] text-[#94A3B8]">{l.description_fa}</div>
                              </td>
                              <td className="p-2.5 num-ltr font-semibold text-[#F8FAFC]">
                                {l.debit_rial > 0 ? formatCurrency(l.debit_rial, currencyUnit) : '—'}
                              </td>
                              <td className="p-2.5 num-ltr font-semibold text-[#F8FAFC]">
                                {l.credit_rial > 0 ? formatCurrency(l.credit_rial, currencyUnit) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Human-Only Approve / Reject Action Bar */}
                {req.status === 'PENDING_HUMAN_APPROVAL' && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                    {rejectingId === req.id ? (
                      <div className="flex flex-1 flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="علت رد پیشنویس (مثلاً فاقد صورتحساب مودیان)..."
                          aria-label="علت رد پیشنویس"
                          className="flex-1 min-w-[220px] rounded-lg border border-[#ED2F42]/50 bg-[#102333] px-3 py-2 text-xs text-[#F8FAFC] focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={isReadOnly}
                          onClick={() => handleConfirmReject(req.id)}
                          className="rounded-lg bg-[#ED2F42] px-4 py-2 text-xs font-bold text-white hover:bg-[#d62637] disabled:opacity-40"
                        >
                          ثبت نهایی رد
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejectingId(null)}
                          className="rounded-lg border border-white/15 px-3 py-2 text-xs text-[#94A3B8]"
                        >
                          انصراف
                        </button>
                      </div>
                    ) : (
                      <>
                        <span className="text-[11px] text-[#94A3B8]">
                          تأیید این سند، وضعیت را از DRAFT به FINALIZED تغییر داده و در دفاتر قطعی ثبت می‌کند.
                        </span>
                        <div className="flex items-center gap-2.5">
                          <button
                            type="button"
                            disabled={isReadOnly}
                            onClick={() => setRejectingId(req.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#ED2F42]/60 px-4 py-2 text-xs font-bold text-[#ED2F42] hover:bg-[#ED2F42]/15 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <XCircle className="h-4 w-4" />
                            <span>رد پیشنویس</span>
                          </button>
                          <button
                            type="button"
                            disabled={isReadOnly}
                            onClick={() => handleApprove(req.id)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] px-4 py-2 text-xs font-bold text-[#102333] hover:bg-[#14ca8e] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            <span>تأیید و قطعی‌سازی سند</span>
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {req.status === 'REJECTED' && req.rejection_reason && (
                  <div className="rounded-lg border border-[#ED2F42]/40 bg-[#ED2F42]/10 p-3 text-xs text-[#F8FAFC]">
                    <strong>علت رد: </strong>
                    {req.rejection_reason}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
