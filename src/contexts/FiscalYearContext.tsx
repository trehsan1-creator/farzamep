import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toPersianDigits } from '../lib/persian';
import type {
  Account,
  AgentApprovalRequest,
  BankTransaction,
  CurrencyUnit,
  FiscalYear,
  FixedAsset,
  MoadianInvoice,
  ParsedExcelResult,
  Product,
  TafsilParty,
  TrialBalanceRow,
  Voucher,
  VoucherLine,
  YearEndSimulationResult,
} from '../types/erp';
import {
  SEED_ACCOUNTS,
  SEED_AGENT_APPROVALS,
  SEED_BANK_TRANSACTIONS,
  SEED_FISCAL_YEARS,
  SEED_FIXED_ASSETS,
  SEED_MOADIAN_INVOICES,
  SEED_PRODUCTS,
  SEED_TAFSIL_PARTIES,
  SEED_VOUCHERS,
} from '../lib/seedData';
import {
  computeTrialBalance,
  simulateYearEndClosing,
} from '../lib/complianceEngine';
import {
  clearSupabaseCredentials,
  getSupabaseCredentials,
  saveSupabaseCredentials,
  supabaseGateway,
  type SupabaseCredentials,
} from '../lib/supabase';

export interface SaveVoucherInput {
  id?: string;
  jalali_date: string;
  gregorian_date: string;
  description_fa: string;
  reference_no?: string;
  idempotency_key?: string;
  source?: Voucher['source'];
  compliance_flags?: string[];
  lines: Array<{
    account_id: string;
    account_code: string;
    tafsil_id: string | null;
    tafsil_name?: string | null;
    description_fa: string;
    debit_rial: number;
    credit_rial: number;
    moadian_tax_id?: string | null;
  }>;
}

interface FiscalYearContextValue {
  // Fiscal Year state
  fiscalYears: FiscalYear[];
  activeFiscalYear: FiscalYear;
  setActiveFiscalYearId: (id: string) => void;
  isReadOnly: boolean;

  // Global Currency UI Toggle (Rial / Toman — UI display only; writes always exact integer Rials)
  currencyUnit: CurrencyUnit;
  toggleCurrencyUnit: () => void;
  setCurrencyUnit: (unit: CurrencyUnit) => void;

  // User Role
  userRole: string;

  // Connection state
  supabaseCreds: SupabaseCredentials;
  isLiveSupabase: boolean;
  syncError: string | null;
  connectionModalOpen: boolean;
  setConnectionModalOpen: (open: boolean) => void;
  configureSupabase: (url: string, anonKey: string) => Promise<{ ok: boolean; messageFa: string }>;
  disconnectSupabase: () => void;

  // Scoped Data for activeFiscalYear
  accounts: Account[];
  tafsilParties: TafsilParty[];
  products: Product[];
  vouchers: Voucher[];
  bankTransactions: BankTransaction[];
  moadianInvoices: MoadianInvoice[];
  fixedAssets: FixedAsset[];
  agentApprovals: AgentApprovalRequest[];
  pendingAgentDraftsCount: number;

  // Computed / RPC operations
  getTrialBalance: (includeDrafts: boolean) => TrialBalanceRow[];
  runYearEndSimulation: (includeDrafts: boolean) => Promise<YearEndSimulationResult>;
  executeYearEndClosing: (nextFiscalYearId: string) => Promise<{ ok: boolean; messageFa: string }>;

  // Mutations (all guarded by !isReadOnly)
  saveVoucherAtomic: (input: SaveVoucherInput) => Promise<{ ok: boolean; voucher?: Voucher; errorFa?: string }>;
  finalizeVoucher: (voucherId: string) => Promise<{ ok: boolean; messageFa: string }>;
  deleteDraftVoucher: (voucherId: string) => Promise<{ ok: boolean; errorFa?: string }>;
  approveAgentDraft: (approvalId: string) => Promise<{ ok: boolean; messageFa: string }>;
  rejectAgentDraft: (approvalId: string, reasonFa: string) => Promise<{ ok: boolean; messageFa: string }>;
  commitExcelImport: (parsed: ParsedExcelResult) => Promise<{ ok: boolean; importedCount: number; messageFa: string }>;
}

const FiscalYearContext = createContext<FiscalYearContextValue | null>(null);

export function FiscalYearProvider({ children, userRole: initialUserRole = 'کاربر سازمانی' }: { children: React.ReactNode; userRole?: string }) {
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>(SEED_FISCAL_YEARS);
  const [activeFiscalYearId, setActiveFiscalYearId] = useState<string>('');
  const [currencyUnit, setCurrencyUnit] = useState<CurrencyUnit>('RIAL');
  const [userRole] = useState<string>(initialUserRole);

  const [supabaseCreds, setSupabaseCreds] = useState<SupabaseCredentials>(() => getSupabaseCredentials());
  const [isLiveSupabase, setIsLiveSupabase] = useState<boolean>(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [connectionModalOpen, setConnectionModalOpen] = useState<boolean>(false);

  // Master & transactional collections (all scoped by fiscal_year_id via selectors)
  const [accounts, setAccounts] = useState<Account[]>(SEED_ACCOUNTS);
  const [tafsilParties, setTafsilParties] = useState<TafsilParty[]>(SEED_TAFSIL_PARTIES);
  const [products, setProducts] = useState<Product[]>(SEED_PRODUCTS);
  const [allVouchers, setAllVouchers] = useState<Voucher[]>(SEED_VOUCHERS);
  const [allBankTransactions, setAllBankTransactions] = useState<BankTransaction[]>(SEED_BANK_TRANSACTIONS);
  const [allMoadianInvoices, setAllMoadianInvoices] = useState<MoadianInvoice[]>(SEED_MOADIAN_INVOICES);
  const [allFixedAssets, setAllFixedAssets] = useState<FixedAsset[]>(SEED_FIXED_ASSETS);
  const [allAgentApprovals, setAllAgentApprovals] = useState<AgentApprovalRequest[]>(SEED_AGENT_APPROVALS);

  const activeFiscalYear = useMemo(
    () => fiscalYears.find((fy) => fy.id === activeFiscalYearId) ?? fiscalYears[1] ?? fiscalYears[0],
    [fiscalYears, activeFiscalYearId]
  );

  const isReadOnly = activeFiscalYear.is_closed;

  // Attempt live sync whenever Supabase credentials are configured
  const syncFromSupabase = useCallback(
    async (fyId: string): Promise<{ ok: boolean; messageFa: string }> => {
      const creds = getSupabaseCredentials();
      setSupabaseCreds(creds);
      if (creds.source === 'unconfigured') {
        setIsLiveSupabase(false);
        setSyncError(null);
        return { ok: false, messageFa: 'اتصال Supabase پیکربندی نشده است.' };
      }

      const ping = await supabaseGateway.testConnection();
      if (!ping.ok) {
        setIsLiveSupabase(false);
        setSyncError(ping.messageFa);
        return { ok: false, messageFa: ping.messageFa };
      }

      const [remoteFys, remoteAccounts] = await Promise.all([
        supabaseGateway.fetchFiscalYears(),
        supabaseGateway.fetchAccounts(),
      ]);
      if (!remoteFys?.length || !remoteAccounts?.length) {
        const messageFa = 'اتصال برقرار است، اما دریافت کامل سال‌های مالی یا سرفصل‌های حسابداری ناموفق بود.';
        setIsLiveSupabase(false);
        setSyncError(messageFa);
        return { ok: false, messageFa };
      }

      const targetFy =
        remoteFys.find((fy) => fy.id === fyId) ??
        remoteFys.find((fy) => fy.code === '1405') ??
        remoteFys.find((fy) => !fy.is_closed) ??
        remoteFys[0];

      setFiscalYears(remoteFys);
      setAccounts(remoteAccounts);
      setActiveFiscalYearId(targetFy.id);

      const scoped = await supabaseGateway.fetchScopedData(targetFy.id);
      if (!scoped) {
        const messageFa = 'اتصال برقرار است، اما حداقل یکی از مجموعه‌داده‌های مالی کامل بارگذاری نشد؛ حالت ثبت اطلاعات غیرفعال شد.';
        setIsLiveSupabase(false);
        setSyncError(messageFa);
        return { ok: false, messageFa };
      }

      setAllVouchers((prev) => [...prev.filter((v) => v.fiscal_year_id !== targetFy.id), ...scoped.vouchers]);
      setAllBankTransactions((prev) => [...prev.filter((b) => b.fiscal_year_id !== targetFy.id), ...scoped.bankTransactions]);
      setAllMoadianInvoices((prev) => [...prev.filter((m) => m.fiscal_year_id !== targetFy.id), ...scoped.moadianInvoices]);
      setAllFixedAssets((prev) => [...prev.filter((a) => a.fiscal_year_id !== targetFy.id), ...scoped.fixedAssets]);
      setAllAgentApprovals((prev) => [...prev.filter((a) => a.fiscal_year_id !== targetFy.id), ...scoped.agentApprovals]);
      setTafsilParties(scoped.tafsilParties);
      setProducts(scoped.products);
      setIsLiveSupabase(true);
      setSyncError(null);
      return { ok: true, messageFa: 'اتصال و همگام‌سازی کامل اطلاعات مالی با موفقیت انجام شد.' };
    },
    []
  );

  useEffect(() => {
    void syncFromSupabase(activeFiscalYearId);
  }, [activeFiscalYearId, syncFromSupabase]);

  // Scoped views strictly filtered by activeFiscalYear.id
  const vouchers = useMemo(
    () =>
      allVouchers
        .filter((v) => v.fiscal_year_id === activeFiscalYear.id)
        .sort((a, b) => (b.voucher_no ?? 0) - (a.voucher_no ?? 0)),
    [allVouchers, activeFiscalYear.id]
  );

  const bankTransactions = useMemo(
    () => allBankTransactions.filter((b) => b.fiscal_year_id === activeFiscalYear.id),
    [allBankTransactions, activeFiscalYear.id]
  );

  const moadianInvoices = useMemo(
    () => allMoadianInvoices.filter((m) => m.fiscal_year_id === activeFiscalYear.id),
    [allMoadianInvoices, activeFiscalYear.id]
  );

  const fixedAssets = useMemo(
    () => allFixedAssets.filter((a) => a.fiscal_year_id === activeFiscalYear.id),
    [allFixedAssets, activeFiscalYear.id]
  );

  const agentApprovals = useMemo(
    () => allAgentApprovals.filter((a) => a.fiscal_year_id === activeFiscalYear.id),
    [allAgentApprovals, activeFiscalYear.id]
  );

  const pendingAgentDraftsCount = useMemo(
    () => agentApprovals.filter((a) => a.status === 'PENDING_HUMAN_APPROVAL').length,
    [agentApprovals]
  );

  const toggleCurrencyUnit = useCallback(() => {
    setCurrencyUnit((prev) => (prev === 'RIAL' ? 'TOMAN' : 'RIAL'));
  }, []);

  const configureSupabase = useCallback(
    async (url: string, anonKey: string) => {
      saveSupabaseCredentials(url, anonKey);
      const nextCreds = getSupabaseCredentials();
      setSupabaseCreds(nextCreds);
      const result = await syncFromSupabase('');
      return { ok: result.ok, messageFa: result.messageFa };
    },
    [syncFromSupabase]
  );

  const disconnectSupabase = useCallback(() => {
    clearSupabaseCredentials();
    setSupabaseCreds(getSupabaseCredentials());
    setIsLiveSupabase(false);
    setSyncError(null);
  }, []);

  const getTrialBalance = useCallback(
    (includeDrafts: boolean) => computeTrialBalance(accounts, vouchers, includeDrafts),
    [accounts, vouchers]
  );

  const saveVoucherAtomic = useCallback(
    async (input: SaveVoucherInput): Promise<{ ok: boolean; voucher?: Voucher; errorFa?: string }> => {
      if (isReadOnly) {
        return { ok: false, errorFa: 'سال مالی قفل شده است — امکان ثبت یا ویرایش سند وجود ندارد.' };
      }
      if (supabaseCreds.source !== 'unconfigured' && !isLiveSupabase) {
        return { ok: false, errorFa: syncError ?? 'اتصال تنظیم شده اما همگام‌سازی کامل نیست؛ ذخیره غیرفعال است.' };
      }
      if (input.lines.length < 2) return { ok: false, errorFa: 'سند باید حداقل دو ردیف داشته باشد.' };

      const invalidLine = input.lines.some((line) =>
        !Number.isSafeInteger(line.debit_rial) ||
        !Number.isSafeInteger(line.credit_rial) ||
        line.debit_rial < 0 ||
        line.credit_rial < 0 ||
        (line.debit_rial === 0 && line.credit_rial === 0) ||
        (line.debit_rial > 0 && line.credit_rial > 0)
      );
      if (invalidLine) {
        return { ok: false, errorFa: 'هر ردیف باید مبلغ صحیح و غیرمنفی داشته باشد و فقط در یک سمت بدهکار یا بستانکار ثبت شود.' };
      }

      const debitTotal = input.lines.reduce((sum, line) => sum + line.debit_rial, 0);
      const creditTotal = input.lines.reduce((sum, line) => sum + line.credit_rial, 0);
      if (debitTotal <= 0 || debitTotal !== creditTotal) {
        return { ok: false, errorFa: 'سند حسابداری تراز نیست؛ جمع بدهکار و بستانکار باید دقیقاً برابر و بزرگتر از صفر باشد.' };
      }

      const existing = input.id ? allVouchers.find((voucher) => voucher.id === input.id) : undefined;
      if (input.id && !existing) {
        return { ok: false, errorFa: 'سند انتخاب‌شده در پایگاه داده پیدا نشد؛ برای جلوگیری از ایجاد سند تکراری، ذخیره متوقف شد.' };
      }
      if (existing && existing.fiscal_year_id !== activeFiscalYear.id) {
        return { ok: false, errorFa: 'سند انتخاب‌شده متعلق به سال مالی دیگری است؛ ویرایش متوقف شد.' };
      }
      if (existing && existing.status !== 'DRAFT') {
        return { ok: false, errorFa: 'اسناد قطعی یا ردشده قابل ویرایش نیستند.' };
      }

      const payloadLines = input.lines.map((line) => ({
        account_code: line.account_code,
        tafsil_id: line.tafsil_id,
        tafsil_code: tafsilParties.find((party) => party.id === line.tafsil_id)?.code ?? null,
        line_description: line.description_fa,
        debit_rial: line.debit_rial,
        credit_rial: line.credit_rial,
        moadian_tax_id: line.moadian_tax_id ?? null,
      }));

      let savedId = existing?.id ?? ('v-' + activeFiscalYear.code + '-' + crypto.randomUUID());
      const idempotencyKey = existing?.idempotency_key ?? input.idempotency_key ?? crypto.randomUUID();

      if (isLiveSupabase) {
        const complianceFlags = input.compliance_flags ?? [];
        const complianceStatus = complianceFlags.length ? 'WARNING' : 'UNCHECKED';
        if (existing) {
          const rpcRes = await supabaseGateway.updateDraftVoucher({
            p_voucher_id: existing.id,
            p_voucher_date_gregorian: input.gregorian_date,
            p_voucher_date_jalali: input.jalali_date,
            p_description: input.description_fa,
            p_reference_no: input.reference_no ?? existing.reference_no ?? null,
            p_compliance_status: complianceStatus,
            p_compliance_flags: complianceFlags,
            p_lines: payloadLines,
          });
          if (rpcRes.error) return { ok: false, errorFa: 'ویرایش در پایگاه داده انجام نشد: ' + rpcRes.error };
        } else {
          const rpcRes = await supabaseGateway.createVoucherDraftAtomic({
            p_fiscal_year_id: activeFiscalYear.id,
            p_voucher_type: 'GENERAL',
            p_voucher_date_gregorian: input.gregorian_date,
            p_voucher_date_jalali: input.jalali_date,
            p_description: input.description_fa,
            p_reference_no: input.reference_no ?? null,
            p_idempotency_key: idempotencyKey,
            p_compliance_status: complianceStatus,
            p_compliance_flags: complianceFlags,
            p_lines: payloadLines,
          });
          if (rpcRes.error) return { ok: false, errorFa: 'ثبت در پایگاه داده انجام نشد: ' + rpcRes.error };
          const response = rpcRes.data as { voucher_id?: string } | null;
          if (!response?.voucher_id) {
            return { ok: false, errorFa: 'پایگاه داده پاسخ معتبر برای شناسه سند برنگرداند؛ وضعیت ثبت را بررسی کنید.' };
          }
          savedId = response.voucher_id;
        }
      }

      const savedVoucher: Voucher = {
        id: savedId,
        fiscal_year_id: activeFiscalYear.id,
        voucher_no: existing?.voucher_no ?? null,
        jalali_date: input.jalali_date,
        gregorian_date: input.gregorian_date,
        description_fa: input.description_fa,
        status: 'DRAFT',
        source: existing?.source ?? input.source ?? 'MANUAL',
        idempotency_key: idempotencyKey,
        reference_no: input.reference_no ?? existing?.reference_no ?? null,
        created_by: existing?.created_by ?? userRole,
        approved_by: existing?.approved_by ?? null,
        approved_at: existing?.approved_at ?? null,
        compliance_flags: input.compliance_flags ?? existing?.compliance_flags ?? [],
        lines: input.lines.map((line, index) => ({
          id: existing?.lines[index]?.id ?? (savedId + '-l-' + (index + 1)),
          voucher_id: savedId,
          line_no: index + 1,
          account_id: line.account_id,
          account_code: line.account_code,
          tafsil_id: line.tafsil_id,
          tafsil_name: line.tafsil_name ?? tafsilParties.find((party) => party.id === line.tafsil_id)?.name_fa ?? null,
          description_fa: line.description_fa,
          debit_rial: line.debit_rial,
          credit_rial: line.credit_rial,
          moadian_tax_id: line.moadian_tax_id ?? null,
        })),
      };

      setAllVouchers((prev) =>
        existing ? prev.map((voucher) => voucher.id === savedId ? savedVoucher : voucher) : [savedVoucher, ...prev]
      );
      if (isLiveSupabase) void syncFromSupabase(activeFiscalYear.id);
      return { ok: true, voucher: savedVoucher };
    },
    [activeFiscalYear, allVouchers, isLiveSupabase, isReadOnly, supabaseCreds.source, syncError, syncFromSupabase, tafsilParties, userRole]
  );

  const finalizeVoucher = useCallback(
    async (voucherId: string): Promise<{ ok: boolean; messageFa: string }> => {
      if (isReadOnly) return { ok: false, messageFa: 'سال مالی قفل شده است؛ قطعی‌سازی انجام نشد.' };
      const target = allVouchers.find((voucher) => voucher.id === voucherId);
      if (!target) return { ok: false, messageFa: 'سند یافت نشد.' };
      if (target.status !== 'DRAFT') return { ok: false, messageFa: 'فقط پیش‌نویس قابل قطعی‌سازی است.' };
      if (target.source === 'AI_AGENT') return { ok: false, messageFa: 'پیش‌نویس عامل فقط از صف تأیید انسانی قابل قطعی‌سازی است.' };
      const debitTotal = target.lines.reduce((sum, line) => sum + line.debit_rial, 0);
      const creditTotal = target.lines.reduce((sum, line) => sum + line.credit_rial, 0);
      if (target.lines.length < 2 || debitTotal <= 0 || debitTotal !== creditTotal) {
        return { ok: false, messageFa: 'سند باید حداقل دو ردیف متوازن با جمع غیرصفر داشته باشد.' };
      }
      if (supabaseCreds.source !== 'unconfigured' && !isLiveSupabase) {
        return { ok: false, messageFa: syncError ?? 'همگام‌سازی پایگاه داده کامل نیست؛ قطعی‌سازی انجام نشد.' };
      }

      if (isLiveSupabase) {
        const result = await supabaseGateway.finalizeVoucher(voucherId);
        if (result.error) return { ok: false, messageFa: 'قطعی‌سازی در پایگاه داده انجام نشد: ' + result.error };
        const response = result.data as { voucher_no?: number | null } | null;
        const refreshed = await syncFromSupabase(activeFiscalYear.id);
        if (!refreshed.ok) {
          const nowIso = new Date().toISOString();
          setAllVouchers((prev) => prev.map((voucher) => voucher.id === voucherId
            ? { ...voucher, status: 'FINALIZED', voucher_no: response?.voucher_no ?? null, approved_by: userRole, approved_at: nowIso }
            : voucher
          ));
          return { ok: true, messageFa: 'سند در پایگاه داده قطعی شد؛ تازه‌سازی اطلاعات با خطا مواجه شد و اتصال نیازمند بررسی است.' };
        }
        return {
          ok: true,
          messageFa: response?.voucher_no == null
            ? 'سند با موفقیت قطعی شد.'
            : 'سند شماره ' + toPersianDigits(response.voucher_no) + ' با موفقیت قطعی شد.',
        };
      }

      const nextNo = Math.max(activeFiscalYear.last_voucher_no, ...vouchers.map((voucher) => voucher.voucher_no ?? 0), 0) + 1;
      const nowIso = new Date().toISOString();
      setAllVouchers((prev) => prev.map((voucher) => voucher.id === voucherId
        ? { ...voucher, status: 'FINALIZED', voucher_no: nextNo, approved_by: userRole, approved_at: nowIso }
        : voucher
      ));
      setFiscalYears((prev) => prev.map((fy) => fy.id === activeFiscalYear.id ? { ...fy, last_voucher_no: nextNo } : fy));
      return { ok: true, messageFa: 'سند شماره ' + toPersianDigits(nextNo) + ' با موفقیت قطعی شد.' };
    },
    [activeFiscalYear, allVouchers, isLiveSupabase, isReadOnly, supabaseCreds.source, syncError, syncFromSupabase, userRole, vouchers]
  );

  const deleteDraftVoucher = useCallback(
    async (voucherId: string): Promise<{ ok: boolean; errorFa?: string }> => {
      if (isReadOnly) return { ok: false, errorFa: 'سال مالی قفل شده است.' };
      if (supabaseCreds.source !== 'unconfigured' && !isLiveSupabase) {
        return { ok: false, errorFa: syncError ?? 'همگام‌سازی پایگاه داده کامل نیست؛ حذف انجام نشد.' };
      }
      const target = allVouchers.find((voucher) => voucher.id === voucherId);
      if (!target) return { ok: false, errorFa: 'سند یافت نشد.' };
      if (target.status !== 'DRAFT') return { ok: false, errorFa: 'تنها اسناد پیش‌نویس (DRAFT) قابل حذف هستند.' };

      if (isLiveSupabase) {
        const result = await supabaseGateway.deleteDraftVoucher(voucherId);
        if (result.error) return { ok: false, errorFa: 'حذف در پایگاه داده انجام نشد: ' + result.error };
        setAllAgentApprovals((prev) => prev.map((request) =>
          request.voucher_id === voucherId && request.status === 'PENDING_HUMAN_APPROVAL'
            ? { ...request, status: 'REJECTED', rejection_reason: 'پیش‌نویس توسط کاربر حذف شد', reviewed_at: new Date().toISOString() }
            : request
        ));
        setAllVouchers((prev) => prev.filter((voucher) => voucher.id !== voucherId));
        void syncFromSupabase(activeFiscalYear.id);
        return { ok: true };
      }

      setAllVouchers((prev) => prev.filter((voucher) => voucher.id !== voucherId));
      setAllAgentApprovals((prev) => prev.map((request) =>
        request.voucher_id === voucherId && request.status === 'PENDING_HUMAN_APPROVAL'
          ? { ...request, status: 'REJECTED', rejection_reason: 'پیش‌نویس توسط کاربر حذف شد', reviewed_at: new Date().toISOString() }
          : request
      ));
      return { ok: true };
    },
    [activeFiscalYear.id, allVouchers, isLiveSupabase, isReadOnly, supabaseCreds.source, syncError, syncFromSupabase]
  );

  const approveAgentDraft = useCallback(
    async (approvalId: string) => {
      if (isReadOnly) return { ok: false, messageFa: 'سال مالی قفل شده است؛ امکان تأیید سند وجود ندارد.' };
      const request = allAgentApprovals.find((item) => item.id === approvalId);
      if (!request) return { ok: false, messageFa: 'درخواست تأیید یافت نشد.' };
      if (request.action_type !== 'APPROVE_DRAFT_VOUCHER' || !request.voucher_id) {
        return { ok: false, messageFa: 'این نوع درخواست هنوز مسیر تأیید عملیاتی ندارد و برای جلوگیری از تأیید صوری متوقف شد.' };
      }
      if (supabaseCreds.source !== 'unconfigured' && !isLiveSupabase) {
        return { ok: false, messageFa: syncError ?? 'همگام‌سازی پایگاه داده کامل نیست؛ تأیید انجام نشد.' };
      }

      if (isLiveSupabase) {
        const result = await supabaseGateway.approveAgentDraft(approvalId);
        if (result.error) return { ok: false, messageFa: 'تأیید در پایگاه داده انجام نشد: ' + result.error };
        const refreshed = await syncFromSupabase(activeFiscalYear.id);
        return { ok: true, messageFa: refreshed.ok ? 'پیشنهاد عامل در پایگاه داده تأیید و سند قطعی شد.' : 'سند قطعی شد، اما تازه‌سازی اطلاعات نیازمند بررسی است.' };
      }

      const nextNo = Math.max(activeFiscalYear.last_voucher_no, ...vouchers.map((voucher) => voucher.voucher_no ?? 0), 0) + 1;
      const nowIso = new Date().toISOString();
      setAllAgentApprovals((prev) => prev.map((item) =>
        item.id === approvalId ? { ...item, status: 'APPROVED', reviewed_by: userRole, reviewed_at: nowIso } : item
      ));
      setAllVouchers((prev) => prev.map((voucher) =>
        voucher.id === request.voucher_id
          ? { ...voucher, status: 'FINALIZED', voucher_no: nextNo, approved_by: userRole, approved_at: nowIso }
          : voucher
      ));
      setFiscalYears((prev) => prev.map((fy) => fy.id === activeFiscalYear.id ? { ...fy, last_voucher_no: nextNo } : fy));
      return { ok: true, messageFa: 'پیشنویس هوش مصنوعی توسط کاربر انسانی تأیید و قطعی‌سازی شد.' };
    },
    [activeFiscalYear, allAgentApprovals, isLiveSupabase, isReadOnly, supabaseCreds.source, syncError, syncFromSupabase, userRole, vouchers]
  );

  const rejectAgentDraft = useCallback(
    async (approvalId: string, reasonFa: string) => {
      if (isReadOnly) return { ok: false, messageFa: 'سال مالی قفل شده است.' };
      const request = allAgentApprovals.find((item) => item.id === approvalId);
      if (!request) return { ok: false, messageFa: 'درخواست تأیید یافت نشد.' };
      if (supabaseCreds.source !== 'unconfigured' && !isLiveSupabase) {
        return { ok: false, messageFa: syncError ?? 'همگام‌سازی پایگاه داده کامل نیست؛ رد درخواست انجام نشد.' };
      }
      const reason = reasonFa.trim() || 'رد شده توسط مدیر مالی';

      if (isLiveSupabase) {
        const result = await supabaseGateway.rejectAgentDraft(approvalId, reason);
        if (result.error) return { ok: false, messageFa: 'رد درخواست در پایگاه داده انجام نشد: ' + result.error };
        const refreshed = await syncFromSupabase(activeFiscalYear.id);
        return { ok: true, messageFa: refreshed.ok ? 'پیشنهاد عامل رد شد و سابقه آن حفظ گردید.' : 'پیشنهاد رد شد، اما تازه‌سازی اطلاعات نیازمند بررسی است.' };
      }

      const nowIso = new Date().toISOString();
      setAllAgentApprovals((prev) => prev.map((item) =>
        item.id === approvalId
          ? { ...item, status: 'REJECTED', reviewed_by: userRole, reviewed_at: nowIso, rejection_reason: reason }
          : item
      ));
      if (request.voucher_id) {
        setAllVouchers((prev) => prev.map((voucher) =>
          voucher.id === request.voucher_id
            ? { ...voucher, status: 'REJECTED', rejection_reason: reason }
            : voucher
        ));
      }
      return { ok: true, messageFa: 'پیشنویس هوش مصنوعی رد و از دفاتر خارج شد.' };
    },
    [activeFiscalYear.id, allAgentApprovals, isLiveSupabase, isReadOnly, supabaseCreds.source, syncError, syncFromSupabase, userRole]
  );

  const commitExcelImport = useCallback(
    async (parsed: ParsedExcelResult): Promise<{ ok: boolean; importedCount: number; messageFa: string }> => {
      if (isReadOnly) {
        return { ok: false, importedCount: 0, messageFa: 'سال مالی قفل شده است؛ ورود اطلاعات مسدود است.' };
      }

      const activeRows = parsed.rows.filter((r) => !r.excluded);

      if (parsed.format === 'BANK_EGHTESAD_NOVIN') {
        const newTxs: BankTransaction[] = activeRows.map((r, i) => ({
          id: `bt-imp-${Date.now()}-${i}`,
          fiscal_year_id: activeFiscalYear.id,
          bank_name: 'بانک اقتصاد نوین',
          account_iban: 'IR640550010281004419022001',
          quarter: 'Q2',
          jalali_date: String(r.data.jalali_date ?? '1404/06/01'),
          tracking_no: String(r.data.tracking_no ?? `IMP-${i}`),
          description_fa: String(r.data.description_fa ?? ''),
          deposit_rial: Number(r.data.deposit_rial ?? 0),
          withdrawal_rial: Number(r.data.withdrawal_rial ?? 0),
          balance_rial: Number(r.data.balance_rial ?? 0),
          continuity_verified: r.data.continuity === 'تأیید شده',
          suggested_account_code: String(r.data.suggested_account ?? '1100').slice(0, 4),
          is_documented: r.flags.length === 0,
        }));
        // Idempotent upsert by tracking_no
        setAllBankTransactions((prev) => {
          const existingKeys = new Set(prev.map((p) => `${p.fiscal_year_id}:${p.tracking_no}`));
          const uniqueNew = newTxs.filter((n) => !existingKeys.has(`${n.fiscal_year_id}:${n.tracking_no}`));
          return [...prev, ...uniqueNew];
        });
        return {
          ok: true,
          importedCount: newTxs.length,
          messageFa: `${newTxs.length} تراکنش صورتحساب بانک اقتصاد نوین با کلید یکتا (Idempotent) ثبت شد.`,
        };
      }

      if (parsed.format === 'MOADIAN_SALES' || parsed.format === 'MOADIAN_PURCHASES') {
        const direction = parsed.format === 'MOADIAN_SALES' ? 'SALES' : 'PURCHASE';
        const newInvs: MoadianInvoice[] = parsed.rows.map((r, i) => ({
          id: `mo-imp-${Date.now()}-${i}`,
          fiscal_year_id: activeFiscalYear.id,
          direction,
          quarter: 'Q2',
          tax_id: String(r.data.tax_id ?? `TAX-${i}`),
          jalali_date: String(r.data.jalali_date ?? '1404/05/01'),
          counterparty_name: String(r.data.counterparty_name ?? ''),
          counterparty_national_id: String(r.data.counterparty_national_id ?? ''),
          net_amount_rial: Number(r.data.net_amount_rial ?? 0),
          vat_amount_rial: Number(r.data.vat_amount_rial ?? 0),
          total_amount_rial: Number(r.data.total_amount_rial ?? 0),
          status_fa: (String(r.data.status_fa ?? 'تایید شده') as MoadianInvoice['status_fa']),
        }));
        setAllMoadianInvoices((prev) => {
          const existingKeys = new Set(prev.map((p) => p.tax_id));
          const uniqueNew = newInvs.filter((n) => !existingKeys.has(n.tax_id));
          return [...prev, ...uniqueNew];
        });
        return {
          ok: true,
          importedCount: activeRows.length,
          messageFa: `${activeRows.length} صورتحساب معتبر مودیان ثبت و ${parsed.excludedRowsCount} ردیف باطل‌شده مستثنی گردید.`,
        };
      }

      if (parsed.format === 'FIXED_ASSETS') {
        const newAssets: FixedAsset[] = activeRows.map((r, i) => ({
          id: `fa-imp-${Date.now()}-${i}`,
          fiscal_year_id: activeFiscalYear.id,
          asset_code: String(r.data.asset_code ?? `FA-${i}`),
          name_fa: String(r.data.name_fa ?? ''),
          category_fa: 'تجهیزات واردشده از اکسل',
          art149_row: String(r.data.art149_row ?? '406'),
          acquisition_jalali: '1404/01/15',
          cost_rial: Number(r.data.cost_rial ?? 0),
          accumulated_depr_opening_rial: 0,
          book_rate_pct: parseInt(String(r.data.book_rate_pct ?? '20'), 10) || 20,
          statutory_rate_pct: parseInt(String(r.data.statutory_rate_pct ?? '12'), 10) || 12,
          book_method: 'STRAIGHT_LINE',
          statutory_method: 'STRAIGHT_LINE',
          book_annual_depr_rial: Number(r.data.book_depr_rial ?? 0),
          statutory_annual_depr_rial: Number(r.data.statutory_depr_rial ?? 0),
          excess_disallowed_rial: Number(r.data.excess_rial ?? 0),
        }));
        setAllFixedAssets((prev) => {
          const existingCodes = new Set(prev.map((a) => `${a.fiscal_year_id}:${a.asset_code}`));
          const unique = newAssets.filter((a) => !existingCodes.has(`${a.fiscal_year_id}:${a.asset_code}`));
          return [...prev, ...unique];
        });
        return {
          ok: true,
          importedCount: newAssets.length,
          messageFa: `${newAssets.length} ردیف دارایی ثابت با محاسبه استهلاک ماده ۱۴۹ به‌روزرسانی شد.`,
        };
      }

      if (parsed.format === 'CATALOG_PARTIES_PRODUCTS') {
        const partyRows = activeRows.filter((r) => !String(r.data.code ?? '').startsWith('P-'));
        const newParties: TafsilParty[] = partyRows.map((r, i) => ({
          id: `taf-imp-${Date.now()}-${i}`,
          code: String(r.data.code ?? `T-${i}`),
          name_fa: String(r.data.name_fa ?? ''),
          party_type: 'CUSTOMER',
          national_id: String(r.data.identifier ?? ''),
          group_guid: String(r.data.group_guid ?? ''),
          group_label: String(r.data.group_label ?? ''),
          created_jalali: String(r.data.created_jalali ?? ''),
        }));
        setTafsilParties((prev) => {
          const existing = new Set(prev.map((p) => p.code));
          return [...prev, ...newParties.filter((n) => !existing.has(n.code))];
        });
        return {
          ok: true,
          importedCount: activeRows.length,
          messageFa: `${activeRows.length} رکورد اطلاعات پایه با تبدیل تاریخ OLE و GroupGuid ذخیره شد.`,
        };
      }

      return {
        ok: true,
        importedCount: activeRows.length,
        messageFa: `${activeRows.length} ردیف تراز آزمایشی پس از کنترل OCR تأیید و ثبت شد.`,
      };
    },
    [activeFiscalYear.id, isReadOnly]
  );

  const runYearEndSimulation = useCallback(
    async (includeDrafts: boolean): Promise<YearEndSimulationResult> => {
      if (isLiveSupabase) {
        const remote = await supabaseGateway.simulateYearEndClosing(activeFiscalYear.id, includeDrafts);
        if (remote) return remote;
      }
      return simulateYearEndClosing(activeFiscalYear.id, accounts, vouchers, fixedAssets, includeDrafts);
    },
    [accounts, activeFiscalYear.id, fixedAssets, isLiveSupabase, vouchers]
  );

  const executeYearEndClosing = useCallback(
    async (nextFiscalYearId: string): Promise<{ ok: boolean; messageFa: string }> => {
      if (isReadOnly) {
        return { ok: false, messageFa: 'این سال مالی پیش‌تر بسته و قفل شده است.' };
      }

      const openDrafts = vouchers.filter((v) => v.status === 'DRAFT');
      if (openDrafts.length > 0) {
        return {
          ok: false,
          messageFa: `تعداد ${openDrafts.length} سند پیشنویس باز وجود دارد. ابتدا تمامی پیشنویس‌ها را قطعی یا رد کنید.`,
        };
      }

      if (isLiveSupabase) {
        const rpcRes = await supabaseGateway.executeYearEndClosing(activeFiscalYear.id, nextFiscalYearId);
        if (!rpcRes.ok) {
          return { ok: false, messageFa: `خطای RPC بستن سال مالی: ${rpcRes.error}` };
        }
      }

      const sim = simulateYearEndClosing(activeFiscalYear.id, accounts, vouchers, fixedAssets, false);
      const closingNo = Math.max(activeFiscalYear.last_voucher_no, ...vouchers.map((v) => v.voucher_no ?? 0), 0) + 1;

      const closingVoucher: Voucher = {
        id: `v-close-${activeFiscalYear.code}`,
        fiscal_year_id: activeFiscalYear.id,
        voucher_no: closingNo,
        jalali_date: activeFiscalYear.jalali_end,
        gregorian_date: activeFiscalYear.end_date,
        description_fa: `سند اختتامیه و بستن حساب‌های موقت سال مالی ${activeFiscalYear.code} (مواد ۱۰۵ و ۲۳۸)`,
        status: 'FINALIZED',
        source: 'YEAR_END_CLOSING',
        reference_no: `CLOSE-${activeFiscalYear.code}`,
        created_by: userRole,
        approved_by: userRole,
        approved_at: new Date().toISOString(),
        compliance_flags: [],
        lines: sim.closing_lines_preview.map((l, idx) => ({
          id: `vl-close-${idx + 1}`,
          voucher_id: `v-close-${activeFiscalYear.code}`,
          line_no: idx + 1,
          account_id: accounts.find((a) => a.code === l.account_code)?.id ?? `acc-${l.account_code}`,
          account_code: l.account_code,
          tafsil_id: null,
          description_fa: l.note_fa,
          debit_rial: l.debit_rial,
          credit_rial: l.credit_rial,
        })),
      };

      // Generate Opening Voucher in nextFiscalYearId from permanent account ending balances
      const postCloseTb = computeTrialBalance(accounts, [...vouchers, closingVoucher], false).filter(
        (r) => !r.is_temporary && (r.ending_debit_rial > 0 || r.ending_credit_rial > 0)
      );

      const nextFy = fiscalYears.find((f) => f.id === nextFiscalYearId);
      const openingVoucher: Voucher = {
        id: `v-open-${nextFiscalYearId}-${Date.now()}`,
        fiscal_year_id: nextFiscalYearId,
        voucher_no: 1,
        jalali_date: nextFy?.jalali_start ?? '1405/01/01',
        gregorian_date: nextFy?.start_date ?? '2026-03-21',
        description_fa: `سند افتتاحیه اتوماتیک انتقالی از سال مالی ${activeFiscalYear.code}`,
        status: 'FINALIZED',
        source: 'OPENING',
        reference_no: `OPEN-FROM-${activeFiscalYear.code}`,
        created_by: userRole,
        approved_by: userRole,
        approved_at: new Date().toISOString(),
        compliance_flags: [],
        lines: postCloseTb.map((r, idx) => ({
          id: `vl-open-${idx + 1}`,
          voucher_id: `v-open-${nextFiscalYearId}`,
          line_no: idx + 1,
          account_id: r.account_id,
          account_code: r.account_code,
          tafsil_id: null,
          description_fa: `نقل مانده دائمی ${r.name_fa}`,
          debit_rial: r.ending_debit_rial,
          credit_rial: r.ending_credit_rial,
        })),
      };

      setAllVouchers((prev) => [closingVoucher, openingVoucher, ...prev]);
      setFiscalYears((prev) =>
        prev.map((fy) => {
          if (fy.id === activeFiscalYear.id) {
            return { ...fy, is_closed: true, last_voucher_no: closingNo };
          }
          if (fy.id === nextFiscalYearId) {
            return { ...fy, last_voucher_no: Math.max(fy.last_voucher_no, 1) };
          }
          return fy;
        })
      );

      return {
        ok: true,
        messageFa: `سال مالی ${activeFiscalYear.code} با موفقیت بسته و قفل شد و سند افتتاحیه در دوره مقصد صادر گردید.`,
      };
    },
    [accounts, activeFiscalYear, fiscalYears, fixedAssets, isLiveSupabase, isReadOnly, userRole, vouchers]
  );

  const value: FiscalYearContextValue = {
    fiscalYears,
    activeFiscalYear,
    setActiveFiscalYearId,
    isReadOnly,
    currencyUnit,
    toggleCurrencyUnit,
    setCurrencyUnit,
    userRole,
    supabaseCreds,
    isLiveSupabase,
    syncError,
    connectionModalOpen,
    setConnectionModalOpen,
    configureSupabase,
    disconnectSupabase,
    accounts,
    tafsilParties,
    products,
    vouchers,
    bankTransactions,
    moadianInvoices,
    fixedAssets,
    agentApprovals,
    pendingAgentDraftsCount,
    getTrialBalance,
    runYearEndSimulation,
    executeYearEndClosing,
    saveVoucherAtomic,
    finalizeVoucher,
    deleteDraftVoucher,
    approveAgentDraft,
    rejectAgentDraft,
    commitExcelImport,
  };

  return <FiscalYearContext.Provider value={value}>{children}</FiscalYearContext.Provider>;
}

export function useFiscalYear(): FiscalYearContextValue {
  const ctx = useContext(FiscalYearContext);
  if (!ctx) {
    throw new Error('useFiscalYear must be used inside FiscalYearProvider');
  }
  return ctx;
}
