import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  Account,
  AgentApprovalRequest,
  BankTransaction,
  FiscalYear,
  FixedAsset,
  MoadianInvoice,
  Product,
  TafsilParty,
  TrialBalanceRow,
  Voucher,
  VoucherLine,
  YearEndSimulationResult,
} from '../types/erp';

const STORAGE_URL_KEY = 'af_erp_supabase_url';
const STORAGE_ANON_KEY = 'af_erp_supabase_anon_key';

export interface SupabaseCredentials {
  url: string;
  anonKey: string;
  source: 'env' | 'localStorage' | 'unconfigured';
}

export function getSupabaseCredentials(): SupabaseCredentials {
  const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() || '';
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() || '';

  if (envUrl && envKey && !envUrl.includes('your-project-ref')) {
    return { url: envUrl, anonKey: envKey, source: 'env' };
  }

  if (typeof window !== 'undefined') {
    const lsUrl = window.localStorage.getItem(STORAGE_URL_KEY)?.trim() || '';
    const lsKey = window.localStorage.getItem(STORAGE_ANON_KEY)?.trim() || '';
    if (lsUrl && lsKey) {
      return { url: lsUrl, anonKey: lsKey, source: 'localStorage' };
    }
  }

  return { url: '', anonKey: '', source: 'unconfigured' };
}

export function saveSupabaseCredentials(url: string, anonKey: string): void {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_URL_KEY, url.trim().replace(/\/+$/, ''));
    window.localStorage.setItem(STORAGE_ANON_KEY, anonKey.trim());
  }
  cachedClient = null;
}

export function clearSupabaseCredentials(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_URL_KEY);
    window.localStorage.removeItem(STORAGE_ANON_KEY);
  }
  cachedClient = null;
}

let cachedClient: SupabaseClient | null = null;
let cachedSignature = '';

export function getSupabaseClient(): SupabaseClient | null {
  const creds = getSupabaseCredentials();
  if (!creds.url || !creds.anonKey) return null;

  const sig = `${creds.url}|${creds.anonKey}`;
  if (cachedClient && cachedSignature === sig) {
    return cachedClient;
  }

  cachedClient = createClient(creds.url, creds.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  cachedSignature = sig;
  return cachedClient;
}

export interface AtomicVoucherPayload {
  p_fiscal_year_id: string;
  p_voucher_type: 'GENERAL' | 'ADJUSTMENT';
  p_voucher_date_gregorian: string;
  p_voucher_date_jalali: string;
  p_description: string;
  p_reference_no: string | null;
  p_idempotency_key: string;
  p_compliance_status: string;
  p_compliance_flags: string[];
  p_lines: Array<{
    account_code: string;
    tafsil_id: string | null;
    tafsil_code?: string | null;
    line_description: string;
    debit_rial: number;
    credit_rial: number;
    moadian_tax_id?: string | null;
    bank_trace_no?: string | null;
  }>;
}

/**
 * Typed Supabase RPC & Table Gateway adhering strictly to the Ati Farzam PostgreSQL contract.
 */
export const supabaseGateway = {
  async testConnection(): Promise<{ ok: boolean; latencyMs: number; messageFa: string }> {
    const client = getSupabaseClient();
    if (!client) {
      return {
        ok: false,
        latencyMs: 0,
        messageFa: 'اطلاعات اتصال Supabase پیکربندی نشده است (حالت نمایشی آفلاین فعال است).',
      };
    }
    const start = performance.now();
    try {
      const { error } = await client.from('fiscal_years').select('id').limit(1);
      const latencyMs = Math.round(performance.now() - start);
      if (error) {
        return { ok: false, latencyMs, messageFa: `خطای اتصال پایگاه داده: ${error.message}` };
      }
      return {
        ok: true,
        latencyMs,
        messageFa: `اتصال به Supabase PostgreSQL برقرار شد (${latencyMs}ms).`,
      };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        messageFa: err instanceof Error ? err.message : 'خطای شبکه در برقراری ارتباط با Supabase',
      };
    }
  },

  async fetchFiscalYears(): Promise<FiscalYear[] | null> {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data, error } = await client.from('fiscal_years').select('*').order('code', { ascending: true });
    if (error || !data || data.length === 0) return null;
    return data as FiscalYear[];
  },

  async fetchAccounts(): Promise<Account[] | null> {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data, error } = await client.from('accounts').select('*').order('code', { ascending: true });
    if (error || !data || data.length === 0) return null;
    return data as Account[];
  },

  async fetchScopedData(fiscalYearId: string): Promise<{
    vouchers: Voucher[];
    bankTransactions: BankTransaction[];
    moadianInvoices: MoadianInvoice[];
    fixedAssets: FixedAsset[];
    agentApprovals: AgentApprovalRequest[];
    tafsilParties: TafsilParty[];
    products: Product[];
  } | null> {
    const client = getSupabaseClient();
    if (!client || !fiscalYearId) return null;

    try {
      const [vRes, btRes, moRes, faRes, aprRes, tafRes, prdRes] = await Promise.all([
        client
          .from('vouchers')
          .select('*, lines:voucher_lines(*, account:accounts(code), tafsil:tafsil_parties(tafsil_code,full_name))')
          .eq('fiscal_year_id', fiscalYearId)
          .order('created_at', { ascending: false }),
        client.from('bank_transactions').select('*').eq('fiscal_year_id', fiscalYearId),
        client.from('moadian_invoices').select('*').eq('fiscal_year_id', fiscalYearId),
        client.from('fixed_assets').select('*').eq('fiscal_year_id', fiscalYearId),
        client.from('agent_approval_requests').select('*').eq('fiscal_year_id', fiscalYearId).order('created_at', { ascending: false }),
        client.from('tafsil_parties').select('id,code:tafsil_code,name_fa:full_name,party_type,national_id,economic_code,iban').order('tafsil_code', { ascending: true }),
        client.from('products').select('id,sku:product_code,name_fa,unit_fa,is_vat_subject').order('product_code', { ascending: true }),
      ]);

      const failed = [
        ['vouchers', vRes.error],
        ['bank_transactions', btRes.error],
        ['moadian_invoices', moRes.error],
        ['fixed_assets', faRes.error],
        ['agent_approval_requests', aprRes.error],
        ['tafsil_parties', tafRes.error],
        ['products', prdRes.error],
      ].filter(([, error]) => Boolean(error));
      if (failed.length) {
        console.error('Supabase scoped data fetch failed:', failed);
        return null;
      }

      const approvalRows = (aprRes.data ?? []) as any[];
      const approvalsByVoucher = new Map<string, any>();
      for (const row of approvalRows) {
        const voucherId = row.payload?.voucher_id;
        if (voucherId && !approvalsByVoucher.has(String(voucherId))) {
          approvalsByVoucher.set(String(voucherId), row);
        }
      }

      const vouchers: Voucher[] = (vRes.data ?? []).map((row: any) => {
        const approval = approvalsByVoucher.get(String(row.id));
        const lines: VoucherLine[] = (row.lines ?? []).map((line: any) => {
          const account = Array.isArray(line.account) ? line.account[0] : line.account;
          const tafsil = Array.isArray(line.tafsil) ? line.tafsil[0] : line.tafsil;
          return {
            id: String(line.id),
            voucher_id: String(line.voucher_id),
            line_no: Number(line.line_no ?? 0),
            account_id: String(line.account_id),
            account_code: String(account?.code ?? ''),
            tafsil_id: line.tafsil_id ?? null,
            tafsil_name: tafsil?.full_name ?? null,
            description_fa: line.line_description ?? '',
            debit_rial: Number(line.debit_rial ?? 0),
            credit_rial: Number(line.credit_rial ?? 0),
            moadian_tax_id: line.moadian_tax_id ?? null,
            bank_trace_no: line.bank_trace_no ?? null,
          };
        });
        const flags = Array.isArray(row.compliance_flags)
          ? row.compliance_flags.map((flag: unknown) => typeof flag === 'string' ? flag : JSON.stringify(flag))
          : [];
        const status = (row.status === 'VOID' ? 'REJECTED' : row.status) as Voucher['status'];
        const source = (row.created_by_actor === 'AI_AGENT'
          ? 'AI_AGENT'
          : row.voucher_type === 'OPENING'
            ? 'OPENING'
            : row.voucher_type === 'CLOSING'
              ? 'YEAR_END_CLOSING'
              : row.created_by_actor === 'SYSTEM_ETL'
                ? 'EXCEL_IMPORT'
                : 'MANUAL') as Voucher['source'];
        return {
          id: String(row.id),
          fiscal_year_id: String(row.fiscal_year_id),
          voucher_no: row.voucher_no == null ? null : Number(row.voucher_no),
          jalali_date: row.voucher_date_jalali ?? '',
          gregorian_date: row.voucher_date_gregorian ?? '',
          description_fa: row.description ?? '',
          status,
          source,
          idempotency_key: row.idempotency_key ?? null,
          reference_no: row.reference_no ?? null,
          created_by: row.created_by_actor ?? row.created_by ?? null,
          approved_by: row.approved_by ?? null,
          approved_at: row.approved_at ?? null,
          rejection_reason: approval?.payload?.rejection_reason ?? null,
          compliance_flags: flags,
          lines,
        };
      });

      const bankTransactions: BankTransaction[] = (btRes.data ?? []).map((row: any) => {
        const month = Number(String(row.tx_date_jalali ?? '').slice(5, 7));
        const quarter: BankTransaction['quarter'] = month >= 1 && month <= 3 ? 'Q1'
          : month >= 4 && month <= 6 ? 'Q2'
            : month >= 7 && month <= 9 ? 'Q3'
              : month >= 10 && month <= 12 ? 'Q4' : 'Q1';
        return {
          id: String(row.id),
          fiscal_year_id: String(row.fiscal_year_id),
          bank_name: row.bank_name ?? 'بانک',
          bank_account_no: row.bank_account_no ?? null,
          quarter,
          jalali_date: row.tx_date_jalali ?? '',
          tracking_no: row.trace_no ?? row.doc_no ?? String(row.id),
          description_fa: row.description ?? '',
          deposit_rial: Number(row.deposit_rial ?? 0),
          withdrawal_rial: Number(row.withdrawal_rial ?? 0),
          balance_rial: Number(row.running_balance_rial ?? 0),
          continuity_verified: null,
          suggested_account_code: row.auto_category ?? '1100',
          is_documented: Boolean(row.reconciled_voucher_id),
          linked_voucher_id: row.reconciled_voucher_id ?? null,
        };
      });

      const moadianInvoices: MoadianInvoice[] = (moRes.data ?? []).map((row: any) => {
        const normalizedStatus = row.status === 'تایید سیستمی' ? 'تایید شده' : row.status;
        const allowedStatuses = ['تایید شده', 'در انتظار تایید', 'رد شده', 'باطل شده', 'عدم نیاز به واکنش'];
        return {
          id: String(row.id),
          fiscal_year_id: String(row.fiscal_year_id),
          direction: (row.direction === 'SALE' ? 'SALES' : row.direction === 'PURCHASE' ? 'PURCHASE' : 'UNKNOWN') as MoadianInvoice['direction'],
          quarter: row.quarter_code ?? 'Q1',
          tax_id: row.tax_id ?? '',
          jalali_date: row.issue_date_jalali ?? '',
          counterparty_name: row.counterparty_name ?? '',
          counterparty_national_id: row.counterparty_national_id ?? '',
          net_amount_rial: Number(row.net_amount_rial ?? 0),
          vat_amount_rial: Number(row.vat_amount_rial ?? 0),
          total_amount_rial: Number(row.gross_amount_rial ?? 0),
          status_fa: (allowedStatuses.includes(normalizedStatus) ? normalizedStatus : 'در انتظار تایید') as MoadianInvoice['status_fa'],
          linked_voucher_id: row.reconciled_voucher_id ?? null,
        };
      });

      const fixedAssets: FixedAsset[] = (faRes.data ?? []).map((row: any) => ({
        id: String(row.id),
        fiscal_year_id: String(row.fiscal_year_id),
        asset_code: row.asset_code ?? '',
        name_fa: row.description_fa ?? '',
        category_fa: row.category_fa ?? 'ثبت نشده',
        art149_row: row.art149_row ?? '',
        acquisition_jalali: row.in_service_jalali ?? '',
        cost_rial: Number(row.cost_rial ?? 0),
        accumulated_depr_opening_rial: null,
        book_rate_pct: null,
        statutory_rate_pct: null,
        book_method: null,
        statutory_method: null,
        book_annual_depr_rial: Number(row.book_depr_fy_rial ?? 0),
        statutory_annual_depr_rial: Number(row.statutory_depr_fy_rial ?? 0),
        excess_disallowed_rial: Number(row.excess_disallowed_depr_rial ?? 0),
        moadian_tax_id: row.moadian_tax_id ?? null,
        in_service_date: row.in_service_date ?? null,
        book_useful_life_years: row.book_useful_life_years == null ? null : Number(row.book_useful_life_years),
        statutory_art149_life_years: row.statutory_art149_life_years == null ? null : Number(row.statutory_art149_life_years),
        months_active_in_fy: row.months_active_in_fy == null ? null : Number(row.months_active_in_fy),
        quantity: row.quantity == null ? null : Number(row.quantity),
        capitalized_vat_rial: row.capitalized_vat_rial == null ? null : Number(row.capitalized_vat_rial),
      }));

      const agentApprovals: AgentApprovalRequest[] = approvalRows.map((row: any) => {
        const payload = row.payload ?? {};
        const evidenceType = (['BANK_STATEMENT', 'MOADIAN_INVOICE', 'PAYROLL_LIST', 'FIXED_ASSET'].includes(payload.evidence_type)
          ? payload.evidence_type : 'OTHER') as AgentApprovalRequest['evidence_type'];
        const flags = Array.isArray(payload.compliance_flags)
          ? payload.compliance_flags.map((flag: unknown) => typeof flag === 'string' ? flag : JSON.stringify(flag))
          : [];
        return {
          id: String(row.id),
          fiscal_year_id: String(row.fiscal_year_id),
          voucher_id: payload.voucher_id ? String(payload.voucher_id) : null,
          idempotency_key: payload.idempotency_key ?? '',
          agent_name: row.requested_by_agent ?? 'muse.ai',
          tool_name: payload.tool_name ?? row.action_type ?? '',
          action_type: row.action_type ?? '',
          payload,
          status: row.status as AgentApprovalRequest['status'],
          created_at: row.created_at,
          rationale_fa: payload.rationale_fa ?? '',
          evidence_type: evidenceType,
          evidence_ref: payload.evidence_ref ?? '',
          evidence_summary_fa: payload.evidence_summary_fa ?? '',
          compliance_flags: flags,
          reviewed_by: row.reviewed_by ?? null,
          reviewed_at: row.reviewed_at ?? null,
          rejection_reason: payload.rejection_reason ?? null,
        };
      });

      const tafsilParties: TafsilParty[] = (tafRes.data ?? []).map((row: any) => ({
        id: String(row.id),
        code: row.code ?? '',
        name_fa: row.name_fa ?? '',
        party_type: (row.party_type === 'SUPPLIER' ? 'VENDOR'
          : row.party_type === 'STATUTORY' ? 'TAX_AUTHORITY'
            : row.party_type === 'SUSPENSE' ? 'OTHER'
              : row.party_type ?? 'OTHER') as TafsilParty['party_type'],
        national_id: row.national_id ?? '',
        economic_code: row.economic_code ?? null,
        iban: row.iban ?? null,
      }));

      const products: Product[] = (prdRes.data ?? []).map((row: any) => ({
        id: String(row.id),
        sku: row.sku ?? '',
        name_fa: row.name_fa ?? '',
        moadian_commodity_id: null,
        unit_fa: row.unit_fa ?? 'عدد',
        vat_rate_pct: null,
        standard_cost_rial: null,
        is_vat_subject: Boolean(row.is_vat_subject),
      }));

      return { vouchers, bankTransactions, moadianInvoices, fixedAssets, agentApprovals, tafsilParties, products };
    } catch (error) {
      console.error('Supabase scoped data mapping failed:', error);
      return null;
    }
  },

  async createVoucherDraftAtomic(payload: AtomicVoucherPayload): Promise<{ data: unknown; error: string | null }> {
    const client = getSupabaseClient();
    if (!client) return { data: null, error: 'اتصال Supabase پیکربندی نشده است.' };
    const { data, error } = await client.rpc('fn_create_voucher_draft_atomic', payload);
    return { data, error: error ? error.message : null };
  },

  async updateDraftVoucher(payload: {
    p_voucher_id: string;
    p_voucher_date_gregorian: string;
    p_voucher_date_jalali: string;
    p_description: string;
    p_reference_no: string | null;
    p_compliance_status: string;
    p_compliance_flags: string[];
    p_lines: AtomicVoucherPayload['p_lines'];
  }): Promise<{ data: unknown; error: string | null }> {
    const client = getSupabaseClient();
    if (!client) return { data: null, error: 'اتصال Supabase پیکربندی نشده است.' };
    const { data, error } = await client.rpc('fn_update_draft_voucher', payload);
    return { data, error: error ? error.message : null };
  },

  async finalizeVoucher(voucherId: string): Promise<{ data: unknown; error: string | null }> {
    const client = getSupabaseClient();
    if (!client) return { data: null, error: 'اتصال Supabase پیکربندی نشده است.' };
    const { data, error } = await client.rpc('fn_finalize_voucher', { p_voucher_id: voucherId });
    return { data, error: error ? error.message : null };
  },

  async deleteDraftVoucher(voucherId: string): Promise<{ data: unknown; error: string | null }> {
    const client = getSupabaseClient();
    if (!client) return { data: null, error: 'اتصال Supabase پیکربندی نشده است.' };
    const { data, error } = await client.rpc('fn_delete_draft_voucher', { p_voucher_id: voucherId });
    return { data, error: error ? error.message : null };
  },

  async approveAgentDraft(approvalId: string): Promise<{ data: unknown; error: string | null }> {
    const client = getSupabaseClient();
    if (!client) return { data: null, error: 'اتصال Supabase پیکربندی نشده است.' };
    const { data, error } = await client.rpc('fn_approve_agent_draft', { p_approval_id: approvalId });
    return { data, error: error ? error.message : null };
  },

  async rejectAgentDraft(approvalId: string, reason: string): Promise<{ data: unknown; error: string | null }> {
    const client = getSupabaseClient();
    if (!client) return { data: null, error: 'اتصال Supabase پیکربندی نشده است.' };
    const { data, error } = await client.rpc('fn_reject_agent_draft', { p_approval_id: approvalId, p_reason: reason });
    return { data, error: error ? error.message : null };
  },

  async getTrialBalance(fiscalYearId: string, includeDrafts: boolean): Promise<TrialBalanceRow[] | null> {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data, error } = await client.rpc('fn_get_trial_balance', {
      p_fiscal_year_id: fiscalYearId,
      p_include_drafts: includeDrafts,
    });
    if (error || !data) return null;
    return data as TrialBalanceRow[];
  },

  async simulateYearEndClosing(
    fiscalYearId: string,
    includeDrafts: boolean
  ): Promise<YearEndSimulationResult | null> {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data, error } = await client.rpc('fn_simulate_year_end_closing', {
      p_fiscal_year_id: fiscalYearId,
      p_include_drafts: includeDrafts,
    });
    if (error || !data) return null;
    return data as YearEndSimulationResult;
  },

  async executeYearEndClosing(
    fiscalYearId: string,
    nextFiscalYearId: string
  ): Promise<{ ok: boolean; error: string | null }> {
    const client = getSupabaseClient();
    if (!client) return { ok: true, error: null };
    const { error } = await client.rpc('fn_execute_year_end_closing', {
      p_fiscal_year_id: fiscalYearId,
      p_next_fiscal_year_id: nextFiscalYearId,
    });
    return { ok: !error, error: error ? error.message : null };
  },

  async testMcpEndpoint(): Promise<{ ok: boolean; status: number; latencyMs: number; detailFa: string }> {
    const creds = getSupabaseCredentials();
    if (!creds.url) {
      return {
        ok: false,
        status: 0,
        latencyMs: 0,
        detailFa: 'آدرس Supabase تنظیم نشده است. ابتدا تنظیمات اتصال را وارد کنید.',
      };
    }

    const mcpUrl = creds.url.replace(new RegExp('/+$'), '') + '/functions/v1/farzam-mcp';
    const start = performance.now();
    try {
      const resp = await fetch(mcpUrl, { method: 'GET', headers: { Accept: 'application/json' } });
      const latencyMs = Math.round(performance.now() - start);
      if (resp.ok || resp.status === 401) {
        return {
          ok: true,
          status: resp.status,
          latencyMs,
          detailFa: resp.status === 401
            ? 'درگاه MCP در دسترس است و کلید اختصاصی عامل را درخواست می‌کند (HTTP 401 — ' + latencyMs + 'ms).'
            : 'درگاه MCP پاسخ داد (HTTP ' + resp.status + ' — ' + latencyMs + 'ms).',
        };
      }
      return {
        ok: false,
        status: resp.status,
        latencyMs,
        detailFa: 'پاسخ غیرمنتظره از درگاه MCP: HTTP ' + resp.status,
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        latencyMs: Math.round(performance.now() - start),
        detailFa: err instanceof Error ? 'خطای شبکه: ' + err.message : 'عدم دسترسی به درگاه MCP',
      };
    }
  },
};
