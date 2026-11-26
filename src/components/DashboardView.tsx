import { useMemo } from 'react';
import { ArrowLeft, ArrowUpLeft, Banknote, Bot, Building2, CircleAlert, FileCheck2, Landmark, ShieldCheck, TrendingUp, WalletCards } from 'lucide-react';
import { useFiscalYear } from '../contexts/FiscalYearContext';
import { computeTaxComplianceExposure, computeTrialBalance } from '../lib/complianceEngine';
import { formatCurrency, toPersianDigits, unitLabelFa } from '../lib/persian';
import { COMPANY_INFO } from '../lib/seedData';
import type { ActiveViewId } from '../types/erp';

interface DashboardViewProps { onNavigate: (view: ActiveViewId) => void; }

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const { activeFiscalYear, accounts, vouchers, bankTransactions, fixedAssets, moadianInvoices, currencyUnit, pendingAgentDraftsCount } = useFiscalYear();
  const trialBalance = useMemo(() => computeTrialBalance(accounts, vouchers, false), [accounts, vouchers]);
  const metrics = useMemo(() => {
    let assets = 0, cash = 0, sales = 0, cogs = 0, opex = 0;
    for (const row of trialBalance) {
      const net = row.ending_debit_rial - row.ending_credit_rial;
      if (row.category === 'ASSET') assets += net;
      if (row.account_code === '1100') cash = net;
      if (row.account_code === '7101') sales = -net;
      if (row.account_code === '5101') cogs = net;
      if (row.account_code === '6101' || row.account_code === '6105') opex += net;
    }
    const valid = (status: string) => status !== 'باطل شده' && status !== 'رد شده';
    const rawSales = moadianInvoices.filter((invoice) => invoice.direction === 'SALES' && valid(invoice.status_fa)).reduce((sum, invoice) => sum + invoice.net_amount_rial, 0);
    const rawPurchases = moadianInvoices.filter((invoice) => invoice.direction === 'PURCHASE' && valid(invoice.status_fa)).reduce((sum, invoice) => sum + invoice.net_amount_rial, 0);
    const deposits = bankTransactions.reduce((sum, row) => sum + row.deposit_rial, 0);
    const withdrawals = bankTransactions.reduce((sum, row) => sum + row.withdrawal_rial, 0);
    return { assets, cash, sales, cogs, opex, grossProfit: sales - cogs, rawSales, rawPurchases, bankNet: deposits - withdrawals, ledgerReady: vouchers.length > 0 };
  }, [trialBalance, moadianInvoices, bankTransactions, vouchers.length]);
  const exposure = useMemo(() => computeTaxComplianceExposure(bankTransactions, fixedAssets, moadianInvoices), [bankTransactions, fixedAssets, moadianInvoices]);
  const unit = unitLabelFa(currencyUnit);
  const finalized = vouchers.filter((v) => v.status === 'FINALIZED').length;
  const cashflow = useMemo(() => {
    const deposits = bankTransactions.reduce((sum, row) => sum + row.deposit_rial, 0);
    const withdrawals = bankTransactions.reduce((sum, row) => sum + row.withdrawal_rial, 0);
    return { deposits, withdrawals, net: deposits - withdrawals };
  }, [bankTransactions]);

  return <main dir="rtl" className="dashboard-page">
    <section className="dashboard-hero">
      <div>
        <div className="eyebrow"><span className="live-dot" /> فضای تصمیم‌گیری مالی · {activeFiscalYear.code}</div>
        <h1>سلام، وضعیت کسب‌وکار را <span>یک‌جا ببین.</span></h1>
        <p>{COMPANY_INFO.nameFa} · اعداد بر اساس داده‌های ثبت‌شده در ERP</p>
      </div>
      <button type="button" onClick={() => onNavigate('vouchers')} className="hero-action">میز کار اسناد <ArrowLeft size={17} /></button>
    </section>

    <section className="kpi-grid" aria-label="شاخص‌های کلیدی">
      <Kpi icon={<TrendingUp />} label="فروش معتبر ۱۴۰۴" value={formatCurrency(metrics.ledgerReady ? metrics.sales : metrics.rawSales, currencyUnit)} hint={metrics.ledgerReady ? 'از دفتر کل' : 'از صورتحساب‌های مودیان · خام'} tone="orange" />
      <Kpi icon={<WalletCards />} label="خالص گردش بانک" value={formatCurrency(metrics.ledgerReady ? metrics.cash : metrics.bankNet, currencyUnit)} hint={metrics.ledgerReady ? 'از اسناد حسابداری' : 'از ۱۸۰ تراکنش بانکی'} tone="teal" />
      <Kpi icon={<Landmark />} label="خرید معتبر ۱۴۰۴" value={formatCurrency(metrics.ledgerReady ? metrics.cogs : metrics.rawPurchases, currencyUnit)} hint={metrics.ledgerReady ? 'بهای تمام‌شده' : 'از صورتحساب‌های مودیان · خام'} tone="blue" />
      <Kpi icon={<ShieldCheck />} label="ریسک مالیاتی" value={formatCurrency(exposure.totalExposureRial, currencyUnit)} hint={`${toPersianDigits(exposure.rejectedMoadianCount)} مورد نیازمند بررسی`} tone={exposure.totalExposureRial > 0 ? 'red' : 'teal'} />
    </section>

    {!metrics.ledgerReady && <div className="data-trust-banner"><CircleAlert size={18} /><div><strong>لایه حسابداری ۱۴۰۴ هنوز سند ندارد</strong><span>شاخص‌های فروش، خرید و بانک از داده‌های خام معتبر نمایش داده شده‌اند؛ برای تراز و سود قطعی باید اسناد حسابداری ایجاد و تأیید شوند.</span></div><button type="button" onClick={() => onNavigate('agent_queue')}>مشاهده صف اقدام <ArrowLeft size={15} /></button></div>}

    <section className="dashboard-grid">
      <div className="panel-card cash-card">
        <div className="card-heading"><div><span className="card-kicker">CASH CONTROL</span><h2>جریان نقدی</h2></div><Banknote className="card-icon" /></div>
        <div className="cash-total"><span>خالص گردش ثبت‌شده</span><strong className="num-ltr">{formatCurrency(cashflow.net, currencyUnit)}</strong><small>{unit}</small></div>
        <div className="flow-bars"><Flow label="واریز" value={cashflow.deposits} max={Math.max(cashflow.deposits, cashflow.withdrawals, 1)} color="green" unit={currencyUnit} /><Flow label="برداشت" value={cashflow.withdrawals} max={Math.max(cashflow.deposits, cashflow.withdrawals, 1)} color="orange" unit={currencyUnit} /></div>
        <button type="button" onClick={() => onNavigate('statements')} className="text-action">مشاهده جزئیات جریان نقدی <ArrowLeft size={15} /></button>
      </div>

      <div className="panel-card focus-card">
        <div className="card-heading"><div><span className="card-kicker">TODAY&apos;S FOCUS</span><h2>کارهای مهم امروز</h2></div><CircleAlert className="card-icon orange" /></div>
        <FocusRow icon={<Bot />} title="پیشنویس‌های Muse" value={pendingAgentDraftsCount} action="باز کردن صف تأیید" onClick={() => onNavigate('agent_queue')} tone={pendingAgentDraftsCount ? 'warning' : 'ok'} />
        <FocusRow icon={<FileCheck2 />} title="اسناد قطعی سال" value={finalized} action="میز کار اسناد" onClick={() => onNavigate('vouchers')} tone="ok" />
        <FocusRow icon={<CircleAlert />} title="هشدارهای مالیاتی" value={exposure.rejectedMoadianCount} action="بررسی انطباق" onClick={() => onNavigate('statements')} tone={exposure.rejectedMoadianCount ? 'warning' : 'ok'} />
      </div>
    </section>

    <section className="quick-section"><div className="section-title"><div><span className="card-kicker">QUICK ACCESS</span><h2>دسترسی سریع</h2></div><span className="muted">بدون رفتن بین منوها</span></div><div className="quick-grid"><Quick icon={<Building2 />} label="مشتریان و طرف‌حساب‌ها" onClick={() => onNavigate('master_data')} /><Quick icon={<FileCheck2 />} label="ورود گروهی و مغایرت‌گیری" onClick={() => onNavigate('excel_import')} /><Quick icon={<Bot />} label="مرکز مدیریت Agentها" onClick={() => onNavigate('agent_center')} /><Quick icon={<ArrowUpLeft />} label="بستن سال مالی" onClick={() => onNavigate('year_end')} /></div></section>
  </main>;
}

function Kpi({ icon, label, value, hint, tone }: { icon: React.ReactNode; label: string; value: string; hint: string; tone: 'blue' | 'teal' | 'orange' | 'red' }) { return <article className={`kpi-card ${tone}`}><div className="kpi-top"><span>{label}</span><span className="kpi-icon">{icon}</span></div><strong className="kpi-value num-ltr">{value}</strong><small>{hint}</small></article>; }
function Flow({ label, value, max, color, unit }: { label: string; value: number; max: number; color: string; unit: 'RIAL' | 'TOMAN' }) { return <div className="flow-row"><div><span>{label}</span><b className="num-ltr">{formatCurrency(value, unit)}</b></div><div className="flow-track"><span className={color} style={{ width: `${Math.max(3, (value / max) * 100)}%` }} /></div></div>; }
function FocusRow({ icon, title, value, action, onClick, tone }: { icon: React.ReactNode; title: string; value: number; action: string; onClick: () => void; tone: 'warning' | 'ok' }) { return <div className="focus-row"><span className={`focus-icon ${tone}`}>{icon}</span><div><strong>{title}</strong><small>{toPersianDigits(value)} مورد</small></div><button type="button" onClick={onClick}>{action}<ArrowLeft size={14} /></button></div>; }
function Quick({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) { return <button type="button" className="quick-card" onClick={onClick}><span>{icon}</span><strong>{label}</strong><ArrowLeft size={16} /></button>; }
