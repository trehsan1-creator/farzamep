
-- Keep implementation functions in the non-exposed private schema.
-- Public RPCs become SECURITY INVOKER wrappers with narrowly-scoped EXECUTE grants.

ALTER FUNCTION public.fn_create_sales_document(uuid, text, uuid, date, text, date, text, date, text, text, text, uuid, jsonb, text) SET SCHEMA private;
ALTER FUNCTION public.fn_agent_create_sales_document(uuid, text, uuid, date, text, date, text, date, text, text, text, uuid, jsonb, text) SET SCHEMA private;
ALTER FUNCTION public.fn_update_sales_document_draft(uuid, uuid, date, text, date, text, date, text, text, text, uuid, jsonb) SET SCHEMA private;
ALTER FUNCTION public.fn_send_sales_quote(uuid) SET SCHEMA private;
ALTER FUNCTION public.fn_accept_sales_quote(uuid) SET SCHEMA private;
ALTER FUNCTION public.fn_convert_sales_quote_to_invoice(uuid, date, text, date, text, text) SET SCHEMA private;
ALTER FUNCTION public.fn_issue_sales_invoice(uuid) SET SCHEMA private;
ALTER FUNCTION public.fn_record_sales_payment(uuid, bigint, date, text, text, uuid, text, text) SET SCHEMA private;
ALTER FUNCTION public.fn_adjust_inventory(uuid, uuid, uuid, numeric, text, bigint, text) SET SCHEMA private;
ALTER FUNCTION public.fn_cancel_sales_draft(uuid) SET SCHEMA private;

CREATE OR REPLACE FUNCTION public.fn_create_sales_document(
  p_fiscal_year_id uuid, p_document_type text, p_party_id uuid,
  p_issue_date_gregorian date, p_issue_date_jalali text,
  p_due_date_gregorian date, p_due_date_jalali text,
  p_valid_until_gregorian date, p_valid_until_jalali text,
  p_notes text, p_terms text, p_warehouse_id uuid, p_lines jsonb, p_idempotency_key text
)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT private.fn_create_sales_document(
    p_fiscal_year_id, p_document_type, p_party_id, p_issue_date_gregorian, p_issue_date_jalali,
    p_due_date_gregorian, p_due_date_jalali, p_valid_until_gregorian, p_valid_until_jalali,
    p_notes, p_terms, p_warehouse_id, p_lines, p_idempotency_key
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_agent_create_sales_document(
  p_fiscal_year_id uuid, p_document_type text, p_party_id uuid,
  p_issue_date_gregorian date, p_issue_date_jalali text,
  p_due_date_gregorian date, p_due_date_jalali text,
  p_valid_until_gregorian date, p_valid_until_jalali text,
  p_notes text, p_terms text, p_warehouse_id uuid, p_lines jsonb, p_idempotency_key text
)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT private.fn_agent_create_sales_document(
    p_fiscal_year_id, p_document_type, p_party_id, p_issue_date_gregorian, p_issue_date_jalali,
    p_due_date_gregorian, p_due_date_jalali, p_valid_until_gregorian, p_valid_until_jalali,
    p_notes, p_terms, p_warehouse_id, p_lines, p_idempotency_key
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_update_sales_document_draft(
  p_document_id uuid, p_party_id uuid, p_issue_date_gregorian date, p_issue_date_jalali text,
  p_due_date_gregorian date, p_due_date_jalali text, p_valid_until_gregorian date,
  p_valid_until_jalali text, p_notes text, p_terms text, p_warehouse_id uuid, p_lines jsonb
)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT private.fn_update_sales_document_draft(
    p_document_id, p_party_id, p_issue_date_gregorian, p_issue_date_jalali,
    p_due_date_gregorian, p_due_date_jalali, p_valid_until_gregorian, p_valid_until_jalali,
    p_notes, p_terms, p_warehouse_id, p_lines
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_send_sales_quote(p_quote_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.fn_send_sales_quote(p_quote_id); $function$;

CREATE OR REPLACE FUNCTION public.fn_accept_sales_quote(p_quote_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.fn_accept_sales_quote(p_quote_id); $function$;

CREATE OR REPLACE FUNCTION public.fn_convert_sales_quote_to_invoice(
  p_quote_id uuid, p_issue_date_gregorian date, p_issue_date_jalali text,
  p_due_date_gregorian date, p_due_date_jalali text, p_idempotency_key text
)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT private.fn_convert_sales_quote_to_invoice(
    p_quote_id, p_issue_date_gregorian, p_issue_date_jalali,
    p_due_date_gregorian, p_due_date_jalali, p_idempotency_key
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_issue_sales_invoice(p_invoice_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.fn_issue_sales_invoice(p_invoice_id); $function$;

CREATE OR REPLACE FUNCTION public.fn_record_sales_payment(
  p_invoice_id uuid, p_amount_rial bigint, p_payment_date_gregorian date,
  p_payment_date_jalali text, p_payment_method text, p_bank_tafsil_id uuid,
  p_reference_no text, p_idempotency_key text
)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT private.fn_record_sales_payment(
    p_invoice_id, p_amount_rial, p_payment_date_gregorian, p_payment_date_jalali,
    p_payment_method, p_bank_tafsil_id, p_reference_no, p_idempotency_key
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_adjust_inventory(
  p_fiscal_year_id uuid, p_warehouse_id uuid, p_product_id uuid,
  p_quantity_delta numeric, p_movement_type text, p_unit_cost_rial bigint, p_note text
)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT private.fn_adjust_inventory(
    p_fiscal_year_id, p_warehouse_id, p_product_id, p_quantity_delta,
    p_movement_type, p_unit_cost_rial, p_note
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_cancel_sales_draft(p_document_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$ SELECT private.fn_cancel_sales_draft(p_document_id); $function$;

GRANT USAGE ON SCHEMA private TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.fn_create_sales_document(uuid, text, uuid, date, text, date, text, date, text, text, text, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_create_sales_document(uuid, text, uuid, date, text, date, text, date, text, text, text, uuid, jsonb, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.fn_agent_create_sales_document(uuid, text, uuid, date, text, date, text, date, text, text, text, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.fn_agent_create_sales_document(uuid, text, uuid, date, text, date, text, date, text, text, text, uuid, jsonb, text) TO service_role;

REVOKE ALL ON FUNCTION private.fn_update_sales_document_draft(uuid, uuid, date, text, date, text, date, text, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_update_sales_document_draft(uuid, uuid, date, text, date, text, date, text, text, text, uuid, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.fn_send_sales_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_send_sales_quote(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.fn_accept_sales_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_accept_sales_quote(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.fn_convert_sales_quote_to_invoice(uuid, date, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_convert_sales_quote_to_invoice(uuid, date, text, date, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.fn_issue_sales_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_issue_sales_invoice(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.fn_record_sales_payment(uuid, bigint, date, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_record_sales_payment(uuid, bigint, date, text, text, uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.fn_adjust_inventory(uuid, uuid, uuid, numeric, text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_adjust_inventory(uuid, uuid, uuid, numeric, text, bigint, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.fn_cancel_sales_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_cancel_sales_draft(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_create_sales_document(uuid, text, uuid, date, text, date, text, date, text, text, text, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_sales_document(uuid, text, uuid, date, text, date, text, date, text, text, text, uuid, jsonb, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_agent_create_sales_document(uuid, text, uuid, date, text, date, text, date, text, text, text, uuid, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_agent_create_sales_document(uuid, text, uuid, date, text, date, text, date, text, text, text, uuid, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.fn_update_sales_document_draft(uuid, uuid, date, text, date, text, date, text, text, text, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_sales_document_draft(uuid, uuid, date, text, date, text, date, text, text, text, uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_send_sales_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_send_sales_quote(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_accept_sales_quote(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_accept_sales_quote(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_convert_sales_quote_to_invoice(uuid, date, text, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_convert_sales_quote_to_invoice(uuid, date, text, date, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_issue_sales_invoice(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_issue_sales_invoice(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_record_sales_payment(uuid, bigint, date, text, text, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_record_sales_payment(uuid, bigint, date, text, text, uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_adjust_inventory(uuid, uuid, uuid, numeric, text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_adjust_inventory(uuid, uuid, uuid, numeric, text, bigint, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_cancel_sales_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_cancel_sales_draft(uuid) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS sales_documents_created_by_idx ON public.sales_documents(created_by);
CREATE INDEX IF NOT EXISTS sales_documents_voucher_idx ON public.sales_documents(voucher_id) WHERE voucher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_documents_warehouse_idx ON public.sales_documents(warehouse_id) WHERE warehouse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS sales_document_payments_bank_tafsil_idx ON public.sales_document_payments(bank_tafsil_id);
CREATE INDEX IF NOT EXISTS sales_document_payments_fy_idx ON public.sales_document_payments(fiscal_year_id);
CREATE INDEX IF NOT EXISTS sales_document_payments_recorded_by_idx ON public.sales_document_payments(recorded_by);
CREATE INDEX IF NOT EXISTS sales_document_payments_voucher_idx ON public.sales_document_payments(voucher_id) WHERE voucher_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_movements_product_idx ON public.inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS inventory_movements_source_document_idx ON public.inventory_movements(source_document_id) WHERE source_document_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_movements_created_by_idx ON public.inventory_movements(created_by);
CREATE INDEX IF NOT EXISTS sales_settings_default_bank_tafsil_idx ON public.sales_settings(default_bank_tafsil_id) WHERE default_bank_tafsil_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

