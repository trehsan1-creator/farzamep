export type CurrencyUnit = 'RIAL' | 'TOMAN';

export type AccountCategory = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE' | 'COGS' | 'CLOSING_SUMMARY';
export type NormalBalance = 'DEBIT' | 'CREDIT';

export interface FiscalYear {
  id: string;
  code: string;
  title_fa: string;
  jalali_start: string;
  jalali_end: string;
  start_date: string;
  end_date: string;
  is_non_calendar: boolean;
  is_closed: boolean;
  last_voucher_no: number;
}

export interface Account {
  id: string;
  code: string;
  kol_code: string;
  name_fa: string;
  name_en: string;
  category: AccountCategory;
  normal_balance: NormalBalance;
  is_temporary: boolean;
  is_contra: boolean;
  requires_tafsil: boolean;
  tax_article_ref: string | null;
}

export interface TafsilParty {
  id: string;
  code: string;
  name_fa: string;
  party_type: 'CUSTOMER' | 'VENDOR' | 'BANK' | 'EMPLOYEE' | 'TAX_AUTHORITY' | 'OTHER';
  national_id: string;
  economic_code?: string | null;
  iban?: string | null;
  group_guid?: string | null;
  group_label?: string | null;
  created_jalali?: string | null;
}

export interface Product {
  id: string;
  sku: string;
  name_fa: string;
  moadian_commodity_id: string | null;
  unit_fa: string;
  vat_rate_pct: number | null;
  standard_cost_rial: number | null;
  is_vat_subject: boolean;
  group_guid?: string | null;
  group_label?: string | null;
  created_jalali?: string | null;
}

export interface FixedAsset {
  id: string;
  fiscal_year_id: string;
  asset_code: string;
  name_fa: string;
  category_fa: string;
  art149_row: string;
  acquisition_jalali: string;
  cost_rial: number;
  accumulated_depr_opening_rial: number | null;
  book_rate_pct: number | null;
  statutory_rate_pct: number | null;
  book_method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | null;
  statutory_method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | null;
  book_annual_depr_rial: number;
  statutory_annual_depr_rial: number;
  excess_disallowed_rial: number;
  moadian_tax_id?: string | null;
  in_service_date?: string | null;
  book_useful_life_years?: number | null;
  statutory_art149_life_years?: number | null;
  months_active_in_fy?: number | null;
  quantity?: number | null;
  capitalized_vat_rial?: number | null;
}

export type VoucherStatus = 'DRAFT' | 'FINALIZED' | 'REJECTED';
export type VoucherSource = 'MANUAL' | 'AI_AGENT' | 'EXCEL_IMPORT' | 'YEAR_END_CLOSING' | 'OPENING';

export interface VoucherLine {
  id: string;
  voucher_id: string;
  line_no: number;
  account_id: string;
  account_code: string;
  tafsil_id: string | null;
  tafsil_name?: string | null;
  description_fa: string;
  debit_rial: number;
  credit_rial: number;
  moadian_tax_id?: string | null;
  bank_trace_no?: string | null;
}

export interface Voucher {
  id: string;
  fiscal_year_id: string;
  voucher_no: number | null;
  jalali_date: string;
  gregorian_date: string;
  description_fa: string;
  status: VoucherStatus;
  source: VoucherSource;
  idempotency_key?: string | null;
  reference_no?: string | null;
  created_by: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
  compliance_flags: string[];
  lines: VoucherLine[];
}

export interface BankTransaction {
  id: string;
  fiscal_year_id: string;
  bank_name: string;
  account_iban: string | null;
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  jalali_date: string;
  tracking_no: string;
  description_fa: string;
  deposit_rial: number;
  withdrawal_rial: number;
  balance_rial: number;
  continuity_verified: boolean | null;
  suggested_account_code: string;
  is_documented: boolean;
  linked_voucher_id?: string | null;
}

export type MoadianStatus = 'تایید شده' | 'در انتظار تایید' | 'رد شده' | 'باطل شده' | 'عدم نیاز به واکنش';

export interface MoadianInvoice {
  id: string;
  fiscal_year_id: string;
  direction: 'SALES' | 'PURCHASE' | 'UNKNOWN';
  quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
  tax_id: string;
  jalali_date: string;
  counterparty_name: string;
  counterparty_national_id: string;
  net_amount_rial: number;
  vat_amount_rial: number;
  total_amount_rial: number;
  status_fa: MoadianStatus;
  linked_voucher_id?: string | null;
}

export interface AgentApprovalRequest {
  id: string;
  fiscal_year_id: string;
  voucher_id: string | null;
  idempotency_key: string;
  agent_name: string;
  tool_name: string;
  status: 'PENDING_HUMAN_APPROVAL' | 'APPROVED' | 'REJECTED';
  created_at: string;
  rationale_fa: string;
  evidence_type: 'BANK_STATEMENT' | 'MOADIAN_INVOICE' | 'PAYROLL_LIST' | 'FIXED_ASSET' | 'OTHER';
  action_type?: string;
  payload?: Record<string, unknown>;
  evidence_ref: string;
  evidence_summary_fa: string;
  compliance_flags: string[];
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
}

export interface TrialBalanceRow {
  account_id: string;
  account_code: string;
  kol_code: string;
  name_fa: string;
  name_en: string;
  category: AccountCategory;
  normal_balance: NormalBalance;
  is_temporary: boolean;
  is_contra: boolean;
  opening_debit_rial: number;
  opening_credit_rial: number;
  turnover_debit_rial: number;
  turnover_credit_rial: number;
  ending_debit_rial: number;
  ending_credit_rial: number;
}

export interface YearEndSimulationResult {
  fiscal_year_id: string;
  total_revenue_rial: number;
  total_cogs_rial: number;
  gross_profit_rial: number;
  total_opex_rial: number;
  pre_tax_profit_rial: number;
  disallowed_expenses_rial: number;
  taxable_income_rial: number;
  income_tax_25pct_rial: number; // Account 2106 (Art. 105)
  net_profit_rial: number;
  statutory_reserve_5pct_rial: number; // Account 3105 (Art. 238)
  retained_earnings_transfer_rial: number; // Account 3104
  closing_lines_preview: Array<{
    account_code: string;
    account_name_fa: string;
    debit_rial: number;
    credit_rial: number;
    note_fa: string;
  }>;
}

export type ComplianceSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface ComplianceIssue {
  code: string;
  article_ref: string;
  severity: ComplianceSeverity;
  title_fa: string;
  detail_fa: string;
  amount_rial?: number;
}

export type ActiveViewId =
  | 'dashboard'
  | 'vouchers'
  | 'excel_import'
  | 'agent_queue'
  | 'year_end'
  | 'statements'
  | 'master_data'
  | 'agent_center';

export type ExcelFormatType =
  | 'BANK_EGHTESAD_NOVIN'
  | 'MOADIAN_SALES'
  | 'MOADIAN_PURCHASES'
  | 'CATALOG_PARTIES_PRODUCTS'
  | 'FIXED_ASSETS'
  | 'TRIAL_BALANCE';

export interface ParsedExcelRow {
  rowIndex: number;
  data: Record<string, string | number | boolean | null>;
  flags: string[];
  excluded?: boolean;
  severity?: 'OK' | 'WARNING' | 'ERROR';
}

export interface ParsedExcelResult {
  format: ExcelFormatType;
  formatTitleFa: string;
  fileName: string;
  detectedColumns: number;
  totalRawRows: number;
  validRowsCount: number;
  excludedRowsCount: number;
  flaggedRowsCount: number;
  metadataNotes: string[];
  continuitySummary?: {
    checked: number;
    passed: number;
    failed: number;
    wasReversedFromDescending: boolean;
    ignoredE4Value?: string | null;
  };
  ocrCorrections?: Array<{
    rowIndex: number;
    field: string;
    rawText: string;
    suggestedValueRial: number;
    suggestedFormatted: string;
  }>;
  columns: Array<{ key: string; labelFa: string; isNumeric?: boolean; isLtr?: boolean }>;
  rows: ParsedExcelRow[];
}

