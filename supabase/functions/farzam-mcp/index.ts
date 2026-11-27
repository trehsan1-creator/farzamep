import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const PROTOCOL_VERSION = "2025-03-26";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-api-key, apikey, content-type, mcp-session-id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

const toolDefinitions = [
  { name: "get_erp_context", description: "دریافت سال‌های مالی و کدینگ حساب‌های معین فعال. پیش از ثبت سند، ابتدا این ابزار را اجرا کنید.", inputSchema: { type: "object", properties: {} } },
  { name: "search_master_data", description: "جستجوی حساب‌های معین، اشخاص تفصیلی و کالاها با نام فارسی یا کد.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "query_erp", description: "موتور جستجوی کنترل‌شده و صفحه‌بندی‌شده برای پرسش‌های طبیعی درباره فاکتورهای فروش و خرید، بانک، طرف‌حساب‌ها، اسناد، دفترکل، مالیات و سال‌های مالی. اجرای SQL آزاد مجاز نیست.", inputSchema: { type: "object", properties: {
    resource: { type: "string", enum: ["sales_invoices", "purchase_invoices", "bank_transactions", "parties", "vouchers", "voucher_lines", "tax_invoices", "fiscal_years"] },
    fiscal_year_id: { type: "string" }, date_from: { type: "string" }, date_to: { type: "string" },
    date_from_jalali: { type: "string" }, date_to_jalali: { type: "string" }, party_query: { type: "string" },
    search: { type: "string" }, status: { type: "string" }, min_amount_rial: { type: "integer" }, max_amount_rial: { type: "integer" },
    limit: { type: "integer", minimum: 1, maximum: 500 }, offset: { type: "integer", minimum: 0 },
    sort_by: { type: "string" }, sort_direction: { type: "string", enum: ["asc", "desc"] }
  }, required: ["resource"] } },
  { name: "propose_accounting_entries", description: "تبدیل کنترل‌شده و فقط‌خواندنی فاکتورهای خام فروش یا خرید به پیشنهاد سند حسابداری متوازن؛ هیچ رکوردی ایجاد نمی‌کند. هر پیشنهاد شامل حساب‌ها، طرف حساب، مبلغ، دلیل و هشدارهای بررسی است.", inputSchema: { type: "object", properties: {
    source_type: { type: "string", enum: ["sales_invoices", "purchase_invoices"] }, fiscal_year_id: { type: "string" },
    date_from_jalali: { type: "string" }, date_to_jalali: { type: "string" }, party_query: { type: "string" },
    limit: { type: "integer", minimum: 1, maximum: 100 }
  }, required: ["source_type", "fiscal_year_id"] } },
  { name: "get_trial_balance", description: "دریافت تراز آزمایشی ریالی برای یک سال مالی.", inputSchema: { type: "object", properties: { fiscal_year_id: { type: "string" }, include_drafts: { type: "boolean" } }, required: ["fiscal_year_id"] } },
  { name: "get_account_ledger", description: "مشاهده گردش دفتر معین برای یک حساب در سال مالی مشخص.", inputSchema: { type: "object", properties: { fiscal_year_id: { type: "string" }, account_code: { type: "string" }, limit: { type: "number" } }, required: ["fiscal_year_id", "account_code"] } },
  { name: "check_tax_compliance", description: "بررسی ریسک‌های مالیاتی: مازاد استهلاک ماده ۱۴۹، صورتحساب نامعتبر مؤدیان و برداشت بانکی بدون سند.", inputSchema: { type: "object", properties: { fiscal_year_id: { type: "string" } }, required: ["fiscal_year_id"] } },
  { name: "list_unreconciled_bank_tx", description: "فهرست تراکنش‌های بانکی تطبیق‌نیافته در یک سال مالی با صفحه‌بندی کامل.", inputSchema: { type: "object", properties: { fiscal_year_id: { type: "string" }, limit: { type: "number" }, offset: { type: "number" } }, required: ["fiscal_year_id"] } },
  { name: "create_draft_voucher", description: "ثبت اتمیک پیش‌نویس سند دوطرفه تراز به‌همراه درخواست تأیید انسانی. عامل هوشمند هرگز سند را قطعی نمی‌کند.", inputSchema: { type: "object", properties: {
    fiscal_year_id: { type: "string" }, voucher_date_gregorian: { type: "string" }, voucher_date_jalali: { type: "string" },
    description: { type: "string" }, reference_no: { type: "string" }, idempotency_key: { type: "string" },
    agent_name: { type: "string" }, rationale_fa: { type: "string" }, evidence_type: { type: "string" },
    evidence_ref: { type: "string" }, evidence_summary_fa: { type: "string" }, compliance_flags: { type: "array", items: { type: "string" } },
    lines: { type: "array", minItems: 2, items: { type: "object", properties: {
      account_code: { type: "string" }, tafsil_code: { type: "string" }, line_description: { type: "string" },
      debit_rial: { type: "integer" }, credit_rial: { type: "integer" }, moadian_tax_id: { type: "string" }, bank_trace_no: { type: "string" }
    }, required: ["account_code", "debit_rial", "credit_rial"] } }
  }, required: ["fiscal_year_id", "voucher_date_gregorian", "voucher_date_jalali", "description", "idempotency_key", "lines"] } },
  { name: "get_approval_status", description: "استعلام وضعیت تأیید پیش‌نویس عامل هوشمند با شناسه درخواست یا سند.", inputSchema: { type: "object", properties: { approval_id: { type: "string" }, voucher_id: { type: "string" } } } },
  { name: "simulate_year_end_closing", description: "شبیه‌سازی فقط‌خواندنی بستن سال مالی؛ هیچ سندی قطعی یا سالی بسته نمی‌شود.", inputSchema: { type: "object", properties: { fiscal_year_id: { type: "string" }, include_drafts: { type: "boolean" } }, required: ["fiscal_year_id"] } },
  { name: "request_year_end_closing", description: "ثبت درخواست بستن سال مالی در صف تأیید مدیر مالی؛ اجرای قطعی فقط با انسان است.", inputSchema: { type: "object", properties: { fiscal_year_id: { type: "string" }, next_fiscal_year_id: { type: "string" }, rationale_fa: { type: "string" } }, required: ["fiscal_year_id", "next_fiscal_year_id"] } },
];

interface AuthenticatedAgent {
  agent_name: string;
  display_name: string;
  allowed_tools: string[];
}

async function authenticateAgent(req: Request): Promise<AuthenticatedAgent | null> {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const supplied = bearer || (req.headers.get("x-api-key") ?? "").trim();
  if (!supplied || supplied.length < 24 || supplied.length > 512) return null;

  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(supplied))
  );
  const keyHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const db = getAdminClient();
  const { data, error } = await db.rpc("fn_authenticate_mcp_agent", {
    p_key_hash: keyHash,
  });
  if (error || !Array.isArray(data) || data.length !== 1) return null;
  const agent = data[0] as AuthenticatedAgent;
  return agent;
}

function getAdminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("Supabase server credentials are not available in this Edge Function.");
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function logCall(db: SupabaseClient, agentName: string, name: string, id: unknown, args: Record<string, unknown>, status: "OK" | "ERROR", elapsed: number, summary?: string, error?: string) {
  try {
    await db.from("agent_execution_logs").insert({
      agent_name: agentName,
      tool_name: name,
      request_id: id == null ? null : String(id),
      arguments: { keys: Object.keys(args ?? {}) },
      status,
      latency_ms: Math.max(0, Math.round(elapsed)),
      result_summary: summary?.slice(0, 500) ?? null,
      error_message: error?.slice(0, 1000) ?? null,
    });
  } catch { /* audit logging must not break the MCP response */ }
}

function ensureNoError<T>(result: { data: T | null; error: { message: string } | null }): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

function boundedPage(args: Record<string, unknown>): { limit: number; offset: number } {
  return {
    limit: Math.max(1, Math.min(500, Number(args.limit ?? 100))),
    offset: Math.max(0, Number(args.offset ?? 0)),
  };
}

async function queryErp(db: SupabaseClient, args: Record<string, unknown>): Promise<unknown> {
  const resource = String(args.resource ?? "");
  const { limit, offset } = boundedPage(args);
  const fiscalYearId = args.fiscal_year_id ? String(args.fiscal_year_id) : "";
  const from = args.date_from ? String(args.date_from) : "";
  const to = args.date_to ? String(args.date_to) : "";
  const fromJalali = args.date_from_jalali ? String(args.date_from_jalali) : "";
  const toJalali = args.date_to_jalali ? String(args.date_to_jalali) : "";
  const party = args.party_query ? String(args.party_query).trim() : "";
  const search = args.search ? String(args.search).trim() : "";
  const status = args.status ? String(args.status) : "";
  const min = Number.isFinite(Number(args.min_amount_rial)) ? Number(args.min_amount_rial) : null;
  const max = Number.isFinite(Number(args.max_amount_rial)) ? Number(args.max_amount_rial) : null;

  const invoiceResources = ["sales_invoices", "purchase_invoices", "tax_invoices"];
  if (invoiceResources.includes(resource)) {
    let q: any = db.from("moadian_invoices").select("id,fiscal_year_id,direction,tax_id,invoice_type,pattern,subject,status,issue_date_jalali,issue_date_gregorian,quarter_code,counterparty_name,tafsil_id,net_amount_rial,vat_amount_rial,gross_amount_rial,is_valid_for_tax", { count: "exact" });
    if (resource === "sales_invoices") q = q.eq("direction", "SALE");
    if (resource === "purchase_invoices") q = q.eq("direction", "PURCHASE");
    if (fiscalYearId) q = q.eq("fiscal_year_id", fiscalYearId);
    if (from) q = q.gte("issue_date_gregorian", from);
    if (to) q = q.lte("issue_date_gregorian", to);
    if (fromJalali) q = q.gte("issue_date_jalali", fromJalali);
    if (toJalali) q = q.lte("issue_date_jalali", toJalali);
    if (party) q = q.ilike("counterparty_name", `%${party.replace(/[%_]/g, "")}%`);
    if (search) q = q.or(`counterparty_name.ilike.%${search.replace(/[%_,]/g, "")}% ,tax_id.ilike.%${search.replace(/[%_,]/g, "")}% ,subject.ilike.%${search.replace(/[%_,]/g, "")}%`);
    if (status) q = q.eq("status", status);
    if (min !== null) q = q.gte("gross_amount_rial", min);
    if (max !== null) q = q.lte("gross_amount_rial", max);
    const sort = ["issue_date_gregorian", "issue_date_jalali", "gross_amount_rial", "net_amount_rial", "counterparty_name"].includes(String(args.sort_by)) ? String(args.sort_by) : "issue_date_gregorian";
    q = q.order(sort, { ascending: String(args.sort_direction ?? "desc") === "asc" }).range(offset, offset + limit - 1);
    const result = await q;
    const rows = ensureNoError(result) ?? [];
    return { resource, rows, page: { limit, offset, returned: rows.length, total: result.count ?? null, has_more: result.count == null ? rows.length === limit : offset + rows.length < result.count } };
  }

  if (resource === "bank_transactions") {
    let q: any = db.from("bank_transactions").select("id,fiscal_year_id,bank_account_no,tx_date_jalali,tx_date_gregorian,tx_time,operation_type,description,note,deposit_rial,withdrawal_rial,running_balance_rial,doc_no,trace_no,reconciled_voucher_id", { count: "exact" });
    if (fiscalYearId) q = q.eq("fiscal_year_id", fiscalYearId);
    if (from) q = q.gte("tx_date_gregorian", from);
    if (to) q = q.lte("tx_date_gregorian", to);
    if (fromJalali) q = q.gte("tx_date_jalali", fromJalali);
    if (toJalali) q = q.lte("tx_date_jalali", toJalali);
    if (search) q = q.or(`description.ilike.%${search.replace(/[%_,]/g, "")}% ,operation_type.ilike.%${search.replace(/[%_,]/g, "")}% ,note.ilike.%${search.replace(/[%_,]/g, "")}%`);
    if (min !== null) q = q.or(`deposit_rial.gte.${min},withdrawal_rial.gte.${min}`);
    if (max !== null) q = q.or(`deposit_rial.lte.${max},withdrawal_rial.lte.${max}`);
    const sort = ["tx_date_gregorian", "tx_date_jalali", "deposit_rial", "withdrawal_rial", "running_balance_rial"].includes(String(args.sort_by)) ? String(args.sort_by) : "tx_date_gregorian";
    q = q.order(sort, { ascending: String(args.sort_direction ?? "desc") === "asc" }).range(offset, offset + limit - 1);
    const result = await q;
    const rows = ensureNoError(result) ?? [];
    return { resource, rows, page: { limit, offset, returned: rows.length, total: result.count ?? null, has_more: result.count == null ? rows.length === limit : offset + rows.length < result.count } };
  }

  if (resource === "parties") {
    let q: any = db.from("tafsil_parties").select("id,tafsil_code,full_name,trade_name,party_type,legal_entity_type,national_id,economic_code,iban,is_active,metadata", { count: "exact" });
    if (search || party) q = q.or(`full_name.ilike.%${(search || party).replace(/[%_,]/g, "")}% ,trade_name.ilike.%${(search || party).replace(/[%_,]/g, "")}% ,tafsil_code.eq.${(search || party).replace(/[%_,]/g, "")}`);
    q = q.order("full_name", { ascending: true }).range(offset, offset + limit - 1);
    const result = await q; const rows = ensureNoError(result) ?? [];
    return { resource, rows, page: { limit, offset, returned: rows.length, total: result.count ?? null, has_more: result.count == null ? rows.length === limit : offset + rows.length < result.count } };
  }

  if (resource === "fiscal_years") {
    let q: any = db.from("fiscal_years").select("id,code,title_fa,jalali_start,jalali_end,start_date,end_date,is_closed,last_voucher_no", { count: "exact" });
    if (fiscalYearId) q = q.eq("id", fiscalYearId);
    const result = await q.order("code", { ascending: true }).range(offset, offset + limit - 1); const rows = ensureNoError(result) ?? [];
    return { resource, rows, page: { limit, offset, returned: rows.length, total: result.count ?? null, has_more: false } };
  }

  if (resource === "vouchers" || resource === "voucher_lines") {
    const table = resource === "vouchers" ? "vouchers" : "voucher_lines";
    const fields = resource === "vouchers" ? "id,fiscal_year_id,voucher_no,voucher_type,status,voucher_date_gregorian,voucher_date_jalali,description,reference_no,created_by_actor,compliance_status,compliance_flags" : "id,voucher_id,fiscal_year_id,line_no,account_id,tafsil_id,debit_rial,credit_rial,line_description,moadian_tax_id,bank_trace_no";
    let q: any = db.from(table).select(fields, { count: "exact" });
    if (fiscalYearId) q = q.eq("fiscal_year_id", fiscalYearId);
    if (status) q = q.eq("status", status);
    if (search) q = resource === "vouchers" ? q.ilike("description", `%${search.replace(/[%_]/g, "")}%`) : q.ilike("line_description", `%${search.replace(/[%_]/g, "")}%`);
    const result = await q.order(resource === "vouchers" ? "voucher_date_gregorian" : "line_no", { ascending: false }).range(offset, offset + limit - 1); const rows = ensureNoError(result) ?? [];
    return { resource, rows, page: { limit, offset, returned: rows.length, total: result.count ?? null, has_more: result.count == null ? rows.length === limit : offset + rows.length < result.count } };
  }
  throw new Error("resource نامعتبر است. از یکی از منابع مجاز query_erp استفاده کنید.");
}

async function proposeAccountingEntries(db: SupabaseClient, args: Record<string, unknown>): Promise<unknown> {
  const sourceType = String(args.source_type ?? "");
  if (!['sales_invoices', 'purchase_invoices'].includes(sourceType)) throw new Error('source_type فقط sales_invoices یا purchase_invoices است.');
  const fiscalYearId = String(args.fiscal_year_id ?? "");
  if (!fiscalYearId) throw new Error('fiscal_year_id الزامی است.');
  const limit = Math.max(1, Math.min(100, Number(args.limit ?? 25)));
  let q: any = db.from('moadian_invoices')
    .select('id,tax_id,direction,subject,status,issue_date_jalali,issue_date_gregorian,counterparty_name,tafsil_id,net_amount_rial,vat_amount_rial,gross_amount_rial,is_valid_for_tax')
    .eq('fiscal_year_id', fiscalYearId)
    .eq('direction', sourceType === 'sales_invoices' ? 'SALE' : 'PURCHASE')
    .order('issue_date_gregorian', { ascending: true }).limit(limit);
  if (args.date_from_jalali) q = q.gte('issue_date_jalali', String(args.date_from_jalali));
  if (args.date_to_jalali) q = q.lte('issue_date_jalali', String(args.date_to_jalali));
  if (args.party_query) q = q.ilike('counterparty_name', `%${String(args.party_query).replace(/[%_]/g, '')}%`);
  const result = await q;
  const invoices = ensureNoError(result) ?? [];
  const proposals = invoices.map((invoice: any) => {
    const warnings: string[] = [];
    if (!invoice.is_valid_for_tax) warnings.push('صورتحساب از نظر مالیاتی معتبر نیست؛ پیش از ثبت بررسی شود.');
    if (invoice.status !== 'تایید شده' && invoice.status !== 'تایید سیستمی') warnings.push('وضعیت صورتحساب تأیید نهایی نیست.');
    const isSale = sourceType === 'sales_invoices';
    const lines = isSale
      ? [
          { account_code: '1103', account_name_fa: 'حساب‌های دریافتنی تجاری', tafsil_id: invoice.tafsil_id, debit_rial: invoice.gross_amount_rial, credit_rial: 0, note_fa: 'ثبت طلب از مشتری بابت مبلغ ناخالص صورتحساب' },
          { account_code: '7101', account_name_fa: 'درآمد حاصل از فروش', tafsil_id: invoice.tafsil_id, debit_rial: 0, credit_rial: invoice.net_amount_rial, note_fa: 'شناسایی درآمد خالص صورتحساب' },
          ...(invoice.vat_amount_rial > 0 ? [{ account_code: '2107', account_name_fa: 'مالیات و عوارض ارزش افزوده پرداختنی', tafsil_id: null, debit_rial: 0, credit_rial: invoice.vat_amount_rial, note_fa: 'ثبت مالیات و عوارض فروش' }] : []),
        ]
      : [
          { account_code: '7105', account_name_fa: 'خرید و بهای تمام‌شده خدمات', tafsil_id: invoice.tafsil_id, debit_rial: invoice.net_amount_rial, credit_rial: 0, note_fa: 'ثبت بهای خرید/خدمت صورتحساب' },
          ...(invoice.vat_amount_rial > 0 ? [{ account_code: '1109', account_name_fa: 'اعتبار مالیات ارزش افزوده', tafsil_id: null, debit_rial: invoice.vat_amount_rial, credit_rial: 0, note_fa: 'ثبت اعتبار مالیات خرید' }] : []),
          { account_code: '2101', account_name_fa: 'حساب‌های پرداختنی تجاری', tafsil_id: invoice.tafsil_id, debit_rial: 0, credit_rial: invoice.gross_amount_rial, note_fa: 'ثبت بدهی به فروشنده بابت مبلغ ناخالص صورتحساب' },
        ];
    return { source_id: invoice.id, source_type: sourceType, tax_id: invoice.tax_id, date_jalali: invoice.issue_date_jalali, counterparty_name: invoice.counterparty_name, description_fa: `${isSale ? 'فروش' : 'خرید'} — ${invoice.counterparty_name} — ${invoice.tax_id}`, idempotency_key: `muse-${sourceType}-${invoice.tax_id}`, balanced: lines.reduce((n: number, l: any) => n + l.debit_rial, 0) === lines.reduce((n: number, l: any) => n + l.credit_rial, 0), warnings, requires_human_review: warnings.length > 0 || !invoice.tafsil_id, lines };
  });
  return { source_type: sourceType, fiscal_year_id: fiscalYearId, count: proposals.length, can_create_draft: true, note_fa: 'این خروجی فقط پیشنهاد است و هیچ رکوردی ایجاد نکرده. برای ثبت، هر پیشنهاد باید با create_draft_voucher و تأیید صریح ارسال شود.', proposals };
}

async function executeTool(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "get_erp_context": {
      const [years, accounts] = await Promise.all([
        db.from("fiscal_years").select("id,code,title_fa,jalali_start,jalali_end,is_closed").order("code"),
        db.from("accounts").select("code,kol_code,name_fa,name_en,category,normal_balance,requires_tafsil,tax_article_ref").eq("is_active", true).order("code"),
      ]);
      return { fiscal_years: ensureNoError(years), accounts: ensureNoError(accounts) };
    }
    case "search_master_data": {
      const q = String(args.query ?? "").trim();
      if (!q) throw new Error("عبارت جستجو خالی است.");
      const pattern = `%${q.replace(/[%_]/g, "")}%`;
      const [accounts, parties, products] = await Promise.all([
        db.from("accounts").select("code,name_fa,category,requires_tafsil").eq("is_active", true).or(`name_fa.ilike.${pattern},code.eq.${q}`).limit(10),
        db.from("tafsil_parties").select("tafsil_code,full_name,trade_name,party_type,national_id").eq("is_active", true).ilike("full_name", pattern).limit(10),
        db.from("products").select("product_code,name_fa,unit_fa,is_vat_subject").eq("is_active", true).ilike("name_fa", pattern).limit(10),
      ]);
      return { accounts: ensureNoError(accounts), parties: ensureNoError(parties), products: ensureNoError(products) };
    }
    case "query_erp":
      return await queryErp(db, args);
    case "propose_accounting_entries":
      return await proposeAccountingEntries(db, args);
    case "get_trial_balance": {
      const result = await db.rpc("fn_get_trial_balance", {
        p_fiscal_year_id: String(args.fiscal_year_id),
        p_include_drafts: Boolean(args.include_drafts ?? false),
      });
      return ensureNoError(result);
    }
    case "get_account_ledger": {
      const fiscalYearId = String(args.fiscal_year_id ?? "");
      const accountCode = String(args.account_code ?? "");
      const limit = Math.max(1, Math.min(100, Number(args.limit ?? 50)));
      const account = ensureNoError(await db.from("accounts").select("id,code,name_fa").eq("code", accountCode).single());
      const lines = await db.from("voucher_lines")
        .select("id,line_no,debit_rial,credit_rial,line_description,moadian_tax_id,bank_trace_no,tafsil_parties(full_name,tafsil_code),vouchers!inner(id,voucher_no,status,voucher_date_jalali,description,reference_no)")
        .eq("fiscal_year_id", fiscalYearId)
        .eq("account_id", account.id)
        .eq("vouchers.status", "FINALIZED")
        .order("line_no", { ascending: true })
        .limit(limit);
      return { account, lines: ensureNoError(lines) };
    }
    case "check_tax_compliance": {
      const fy = String(args.fiscal_year_id ?? "");
      const [assets, invoices, bank] = await Promise.all([
        db.from("fixed_assets").select("asset_code,description_fa,excess_disallowed_depr_rial,statutory_depr_fy_rial,book_depr_fy_rial").eq("fiscal_year_id", fy).gt("excess_disallowed_depr_rial", 0).limit(50),
        db.from("moadian_invoices").select("tax_id,direction,status,subject,gross_amount_rial,counterparty_name").eq("fiscal_year_id", fy).eq("is_valid_for_tax", false).limit(50),
        db.from("bank_transactions").select("tx_date_jalali,description,withdrawal_rial,bank_account_no,trace_no").eq("fiscal_year_id", fy).is("reconciled_voucher_id", null).gt("withdrawal_rial", 0).limit(50),
      ]);
      return {
        excess_depreciation: ensureNoError(assets),
        invalid_moadian_invoices: ensureNoError(invoices),
        unreconciled_withdrawals: ensureNoError(bank),
      };
    }
    case "list_unreconciled_bank_tx": {
      const fy = String(args.fiscal_year_id ?? "");
      const { limit, offset } = boundedPage(args);
      const result = await db.from("bank_transactions")
        .select("id,tx_date_jalali,tx_date_gregorian,tx_time,description,deposit_rial,withdrawal_rial,running_balance_rial,bank_account_no,doc_no,trace_no", { count: "exact" })
        .eq("fiscal_year_id", fy).is("reconciled_voucher_id", null)
        .order("tx_date_gregorian", { ascending: false }).range(offset, offset + limit - 1);
      const rows = ensureNoError(result) ?? [];
      return { rows, page: { limit, offset, returned: rows.length, total: result.count ?? null, has_more: result.count == null ? rows.length === limit : offset + rows.length < result.count } };
    }
    case "create_draft_voucher": {
      const lines = Array.isArray(args.lines) ? args.lines as Array<Record<string, unknown>> : [];
      if (lines.length < 2) throw new Error("سند باید حداقل دو آرتیکل داشته باشد.");
      const idempotency = String(args.idempotency_key ?? "").trim();
      if (idempotency.length < 8) throw new Error("idempotency_key باید حداقل ۸ کاراکتر باشد.");
      let debit = 0;
      let credit = 0;
      const mappedLines = lines.map((line) => {
        const dr = Number(line.debit_rial ?? 0);
        const cr = Number(line.credit_rial ?? 0);
        if (!Number.isSafeInteger(dr) || !Number.isSafeInteger(cr) || dr < 0 || cr < 0 || ((dr > 0) === (cr > 0))) {
          throw new Error("هر آرتیکل باید دقیقاً یک سمت بدهکار یا بستانکار و مبلغ صحیح ریالی داشته باشد.");
        }
        debit += dr;
        credit += cr;
        return {
          account_code: String(line.account_code ?? ""),
          tafsil_code: line.tafsil_code ? String(line.tafsil_code) : null,
          line_description: String(line.line_description ?? args.description ?? ""),
          debit_rial: dr,
          credit_rial: cr,
          moadian_tax_id: line.moadian_tax_id ? String(line.moadian_tax_id) : null,
          bank_trace_no: line.bank_trace_no ? String(line.bank_trace_no) : null,
        };
      });
      if (debit !== credit) throw new Error(`سند تراز نیست؛ بدهکار ${debit} و بستانکار ${credit} ریال است.`);
      const result = await db.rpc("fn_create_agent_draft_voucher", {
        p_fiscal_year_id: String(args.fiscal_year_id),
        p_voucher_date_gregorian: String(args.voucher_date_gregorian),
        p_voucher_date_jalali: String(args.voucher_date_jalali),
        p_description: String(args.description),
        p_idempotency_key: idempotency,
        p_reference_no: args.reference_no ? String(args.reference_no) : null,
        p_agent_name: args.agent_name ? String(args.agent_name) : "Muse.ai",
        p_rationale_fa: args.rationale_fa ? String(args.rationale_fa) : null,
        p_evidence_type: args.evidence_type ? String(args.evidence_type) : "BANK_STATEMENT",
        p_evidence_ref: args.evidence_ref ? String(args.evidence_ref) : null,
        p_evidence_summary_fa: args.evidence_summary_fa ? String(args.evidence_summary_fa) : null,
        p_compliance_flags: Array.isArray(args.compliance_flags) ? args.compliance_flags : [],
        p_lines: mappedLines,
      });
      return ensureNoError(result);
    }
    case "get_approval_status": {
      if (args.approval_id) {
        const result = await db.from("agent_approval_requests").select("id,status,action_type,requested_by_agent,payload,created_at,reviewed_at").eq("id", String(args.approval_id)).single();
        return ensureNoError(result);
      }
      if (args.voucher_id) {
        const result = await db.from("agent_approval_requests").select("id,status,action_type,requested_by_agent,payload,created_at,reviewed_at").filter("payload->>voucher_id", "eq", String(args.voucher_id)).maybeSingle();
        return ensureNoError(result);
      }
      throw new Error("approval_id یا voucher_id الزامی است.");
    }
    case "simulate_year_end_closing": {
      const result = await db.rpc("fn_simulate_year_end_closing", {
        p_fiscal_year_id: String(args.fiscal_year_id),
        p_include_drafts: Boolean(args.include_drafts ?? false),
      });
      return ensureNoError(result);
    }
    case "request_year_end_closing": {
      const currentId = String(args.fiscal_year_id ?? "");
      const nextId = String(args.next_fiscal_year_id ?? "");
      if (!currentId || !nextId || currentId === nextId) throw new Error("شناسه سال مالی جاری و سال مقصد معتبر نیست.");
      const current = ensureNoError(await db.from("fiscal_years").select("id,code,is_closed").eq("id", currentId).single());
      ensureNoError(await db.from("fiscal_years").select("id,code").eq("id", nextId).single());
      if (current.is_closed) throw new Error("سال مالی جاری قبلاً بسته شده است.");
      const result = await db.from("agent_approval_requests").insert({
        fiscal_year_id: currentId,
        action_type: "EXECUTE_YEAR_END_CLOSING",
        status: "PENDING_HUMAN_APPROVAL",
        requested_by_agent: "muse.ai",
        payload: {
          next_fiscal_year_id: nextId,
          rationale_fa: String(args.rationale_fa ?? "درخواست بستن سال مالی توسط عامل Muse.ai"),
          tool_name: "request_year_end_closing",
        },
      }).select("id,status,created_at").single();
      return { queued_for_human_approval: true, ...ensureNoError(result), note_fa: "درخواست در صف تأیید مدیر مالی ثبت شد؛ عامل هوشمند اجازه بستن قطعی سال را ندارد." };
    }
    default:
      throw new Error(`ابزار ناشناخته است: ${name}`);
  }
}

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return jsonResponse(204);
  let agent: AuthenticatedAgent | null = null;
  try {
    agent = await authenticateAgent(req);
  } catch {
    return jsonResponse(503, { error: "MCP authentication service unavailable." });
  }
  if (!agent) {
    return jsonResponse(401, { error: "Unauthorized: invalid or revoked agent API key." });
  }
  if (req.method === "GET") {
    return jsonResponse(200, { service: "farzam-erp-mcp", protocol: "MCP Streamable HTTP (JSON-RPC 2.0)", protocolVersion: PROTOCOL_VERSION, agent: agent.agent_name, toolsCount: toolDefinitions.filter((tool) => agent!.allowed_tools.includes(tool.name)).length, status: "ready" });
  }
  if (req.method !== "POST") return jsonResponse(405, { error: "Method Not Allowed" });

  let rpc: Record<string, unknown>;
  try {
    rpc = await req.json();
  } catch {
    return jsonResponse(400, { error: "Invalid JSON request body." });
  }

  const id = rpc.id ?? null;
  const method = String(rpc.method ?? "");
  if (method === "initialize") {
    return jsonResponse(200, {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: { name: "farzam-erp-mcp", version: "1.0.0" },
        capabilities: { tools: {} },
      },
    });
  }
  if (method === "notifications/initialized") return jsonResponse(202);
  if (method === "ping") return jsonResponse(200, { jsonrpc: "2.0", id, result: {} });
  if (method === "tools/list") return jsonResponse(200, { jsonrpc: "2.0", id, result: { tools: toolDefinitions.filter((tool) => agent!.allowed_tools.includes(tool.name)) } });

  if (method === "tools/call") {
    const params = (rpc.params ?? {}) as Record<string, unknown>;
    const name = String(params.name ?? "");
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const started = performance.now();
    if (!agent.allowed_tools.includes(name)) {
      return jsonResponse(200, { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ error: "این عامل مجوز اجرای ابزار درخواستی را ندارد." }) }], isError: true } });
    }
    let db: SupabaseClient | null = null;
    try {
      db = getAdminClient();
      const result = await executeTool(db, name, args);
      await logCall(db, agent.agent_name, name, id, args, "OK", performance.now() - started, JSON.stringify(result));
      return jsonResponse(200, {
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected MCP tool error.";
      if (db) await logCall(db, agent.agent_name, name, id, args, "ERROR", performance.now() - started, undefined, message);
      return jsonResponse(200, {
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true },
      });
    }
  }

  return jsonResponse(400, { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
});

