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
  { name: "get_trial_balance", description: "دریافت تراز آزمایشی ریالی برای یک سال مالی.", inputSchema: { type: "object", properties: { fiscal_year_id: { type: "string" }, include_drafts: { type: "boolean" } }, required: ["fiscal_year_id"] } },
  { name: "get_account_ledger", description: "مشاهده گردش دفتر معین برای یک حساب در سال مالی مشخص.", inputSchema: { type: "object", properties: { fiscal_year_id: { type: "string" }, account_code: { type: "string" }, limit: { type: "number" } }, required: ["fiscal_year_id", "account_code"] } },
  { name: "check_tax_compliance", description: "بررسی ریسک‌های مالیاتی: مازاد استهلاک ماده ۱۴۹، صورتحساب نامعتبر مؤدیان و برداشت بانکی بدون سند.", inputSchema: { type: "object", properties: { fiscal_year_id: { type: "string" } }, required: ["fiscal_year_id"] } },
  { name: "list_unreconciled_bank_tx", description: "فهرست تراکنش‌های بانکی تطبیق‌نیافته در یک سال مالی.", inputSchema: { type: "object", properties: { fiscal_year_id: { type: "string" }, limit: { type: "number" } }, required: ["fiscal_year_id"] } },
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
      const limit = Math.max(1, Math.min(100, Number(args.limit ?? 30)));
      const result = await db.from("bank_transactions")
        .select("id,tx_date_jalali,tx_date_gregorian,tx_time,description,deposit_rial,withdrawal_rial,running_balance_rial,bank_account_no,doc_no,trace_no")
        .eq("fiscal_year_id", fy).is("reconciled_voucher_id", null)
        .order("tx_date_gregorian", { ascending: false }).limit(limit);
      return ensureNoError(result);
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
