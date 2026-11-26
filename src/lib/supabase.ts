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
  p_jalali_date: string;
  p_gregorian_date: string;
  p_description_fa: string;
  p_source: string;
  p_reference_no?: string | null;
  p_idempotency_key?: string | null;
  p_lines: Array<{
    account_id: string;
    account_code: string;
    tafsil_id: string | null;
    description_fa: string;
    debit_rial: number;
    credit_rial: number;
    moadian_tax_id?: string | null;
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
    if (!client) return null;

    try {
      const [vRes, btRes, moRes, faRes, aprRes, tafRes, prdRes] = await Promise.all([
        client
          .from('vouchers')
          .select('*, lines:voucher_lines(*)')
          .eq('fiscal_year_id', fiscalYearId)
          .order('voucher_no', { ascending: false }),
        client.from('bank_transactions').select('*').eq('fiscal_year_id', fiscalYearId),
        client.from('moadian_invoices').select('*').eq('fiscal_year_id', fiscalYearId),
        client.from('fixed_assets').select('*').eq('fiscal_year_id', fiscalYearId),
        client.from('agent_approval_requests').select('*').eq('fiscal_year_id', fiscalYearId),
        client.from('tafsil_parties').select('id,code:tafsil_code,name_fa:full_name,party_type,national_id,economic_code,iban').order('tafsil_code', { ascending: true }),
        client.from('products').select('id,sku:product_code,name_fa,unit_fa,is_vat_subject').order('product_code', { ascending: true }),
      ]);

      if (vRes.error) return null;

      const bankTransactions: BankTransaction[] = (btRes.data ?? []).map((row: any) => ({
        id: row.id, fiscal_year_id: row.fiscal_year_id, bank_name: row.bank_name ?? 'بانک', account_iban: row.bank_account_no ?? '',
        quarter: String(row.tx_date_jalali ?? '').slice(5, 7) <= '03' ? 'Q1' : String(row.tx_date_jalali ?? '').slice(5, 7) <= '06' ? 'Q2' : String(row.tx_date_jalali ?? '').slice(5, 7) <= '09' ? 'Q3' : 'Q4',
        jalali_date: row.tx_date_jalali ?? '', tracking_no: row.trace_no ?? row.doc_no ?? row.id, description_fa: row.description ?? '',
        deposit_rial: Number(row.deposit_rial ?? 0), withdrawal_rial: Number(row.withdrawal_rial ?? 0), balance_rial: Number(row.running_balance_rial ?? 0),
        continuity_verified: true, suggested_account_code: row.auto_category ?? '1100', is_documented: Boolean(row.reconciled_voucher_id), linked_voucher_id: row.reconciled_voucher_id ?? null,
      }));
      const moadianInvoices: MoadianInvoice[] = (moRes.data ?? []).map((row: any) => ({
        id: row.id, fiscal_year_id: row.fiscal_year_id, direction: row.direction === 'SALE' ? 'SALES' : 'PURCHASE', quarter: row.quarter_code ?? 'Q1',
        tax_id: row.tax_id, jalali_date: row.issue_date_jalali ?? '', counterparty_name: row.counterparty_name ?? '', counterparty_national_id: row.counterparty_national_id ?? '',
        net_amount_rial: Number(row.net_amount_rial ?? 0), vat_amount_rial: Number(row.vat_amount_rial ?? 0), total_amount_rial: Number(row.gross_amount_rial ?? 0),
        status_fa: row.status === 'تایید سیستمی' ? 'تایید شده' : (row.status ?? 'در انتظار تایید'), linked_voucher_id: row.reconciled_voucher_id ?? null,
      }));
      const fixedAssets: FixedAsset[] = (faRes.data ?? []).map((row: any) => ({
        id: row.id, fiscal_year_id: row.fiscal_year_id, asset_code: row.asset_code, name_fa: row.description_fa ?? '', category_fa: 'اموال و تجهیزات',
        art149_row: row.moadian_tax_id ?? '', acquisition_jalali: row.in_service_jalali ?? '', cost_rial: Number(row.cost_rial ?? 0), accumulated_depr_opening_rial: 0,
        book_rate_pct: 0, statutory_rate_pct: 0, book_method: 'STRAIGHT_LINE', statutory_method: 'STRAIGHT_LINE', book_annual_depr_rial: Number(row.book_depr_fy_rial ?? 0), statutory_annual_depr_rial: Number(row.statutory_depr_fy_rial ?? 0), excess_disallowed_rial: Number(row.excess_disallowed_depr_rial ?? 0),
      }));
      return {
        vouchers: (vRes.data ?? []) as Voucher[],
        bankTransactions,
        moadianInvoices,
        fixedAssets,
        agentApprovals: (aprRes.data ?? []) as AgentApprovalRequest[],
        tafsilParties: (tafRes.data ?? []) as TafsilParty[],
        products: (prdRes.data ?? []) as unknown as Product[],
      };
    } catch {
      return null;
    }
  },

  async createVoucherAtomic(payload: AtomicVoucherPayload): Promise<{ data: unknown; error: string | null }> {
    const client = getSupabaseClient();
    if (!client) return { data: null, error: null };
    const { data, error } = await client.rpc('fn_create_voucher_atomic', payload);
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
        detailFa: 'آدرس VITE_SUPABASE_URL تنظیم نشده است. ابتدا تنظیمات اتصال Supabase را وارد کنید.',
      };
    }

    const mcpUrl = `${creds.url.replace(/\/+$/, '')}/functions/v1/mcp`;
    const start = performance.now();
    try {
      const resp = await fetch(mcpUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${creds.anonKey}`,
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'health-check',
          method: 'tools/list',
        }),
      });
      const latencyMs = Math.round(performance.now() - start);
      if (resp.ok) {
        return {
          ok: true,
          status: resp.status,
          latencyMs,
          detailFa: `اندپوینت Streamable HTTP MCP با موفقیت پاسخ داد (HTTP ${resp.status} — ${latencyMs}ms).`,
        };
      }
      return {
        ok: false,
        status: resp.status,
        latencyMs,
        detailFa: `پاسخ خطا از Edge Function MCP: کد وضعیت HTTP ${resp.status}`,
      };
    } catch (err) {
      return {
        ok: false,
        status: 0,
        latencyMs: Math.round(performance.now() - start),
        detailFa: err instanceof Error ? `خطای شبکه: ${err.message}` : 'عدم دسترسی به اندپوینت MCP',
      };
    }
  },
};
