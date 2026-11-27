-- Restore private SECURITY DEFINER RPC boundaries and agent-review guardrails.
-- The public functions remain thin SECURITY INVOKER wrappers.

CREATE OR REPLACE FUNCTION public.fn_create_voucher_draft_atomic(
  p_fiscal_year_id uuid,
  p_voucher_type public.voucher_type,
  p_voucher_date_gregorian date,
  p_voucher_date_jalali character,
  p_description text,
  p_reference_no text,
  p_idempotency_key text,
  p_compliance_status text,
  p_compliance_flags jsonb,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.fn_create_voucher_draft_atomic(
    p_fiscal_year_id, p_voucher_type, p_voucher_date_gregorian, p_voucher_date_jalali,
    p_description, p_reference_no, p_idempotency_key, p_compliance_status, p_compliance_flags, p_lines
  );
$function$;

CREATE OR REPLACE FUNCTION private.fn_delete_draft_voucher(p_voucher_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role public.erp_role;
  v_status public.voucher_status;
  v_is_closed boolean;
  v_approval_count integer := 0;
  v_deleted_count integer := 0;
BEGIN
  v_role := public.current_erp_role();
  IF COALESCE(v_role, 'AUDITOR'::public.erp_role) NOT IN (
    'ADMIN'::public.erp_role, 'SENIOR_ACCOUNTANT'::public.erp_role, 'ACCOUNTANT'::public.erp_role
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: نقش کاربر مجاز به حذف پیش‌نویس نیست.';
  END IF;

  SELECT v.status, fy.is_closed
  INTO v_status, v_is_closed
  FROM public.vouchers v
  JOIN public.fiscal_years fy ON fy.id = v.fiscal_year_id
  WHERE v.id = p_voucher_id
  FOR UPDATE OF v, fy;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOUCHER_NOT_FOUND: سند یافت نشد.';
  END IF;
  IF v_status <> 'DRAFT'::public.voucher_status THEN
    RAISE EXCEPTION 'IMMUTABLE_VOUCHER: تنها اسناد پیش‌نویس قابل حذف هستند.';
  END IF;
  IF v_is_closed THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی بسته‌شده قابل تغییر نیست.';
  END IF;

  UPDATE public.agent_approval_requests
  SET status = 'REJECTED',
      reviewed_by = auth.uid(),
      reviewed_at = pg_catalog.now(),
      payload = COALESCE(payload, '{}'::jsonb) || pg_catalog.jsonb_build_object(
        'rejection_reason', 'پیش‌نویس توسط کاربر حذف شد',
        'deleted_at', pg_catalog.now()
      )
  WHERE payload->>'voucher_id' = p_voucher_id::text
    AND status = 'PENDING_HUMAN_APPROVAL';

  GET DIAGNOSTICS v_approval_count = ROW_COUNT;

  DELETE FROM public.vouchers
  WHERE id = p_voucher_id
    AND status = 'DRAFT'::public.voucher_status;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count <> 1 THEN
    RAISE EXCEPTION 'VOUCHER_DELETE_FAILED: حذف پیش‌نویس انجام نشد.';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'deleted', true,
    'voucher_id', p_voucher_id,
    'approval_requests_closed', v_approval_count
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_delete_draft_voucher(p_voucher_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.fn_delete_draft_voucher(p_voucher_id);
$function$;

CREATE OR REPLACE FUNCTION private.fn_approve_agent_draft(p_approval_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role public.erp_role;
  v_req public.agent_approval_requests%ROWTYPE;
  v_voucher public.vouchers%ROWTYPE;
  v_line_count integer;
  v_total_debit numeric;
  v_total_credit numeric;
  v_new_no integer;
  v_voucher_id uuid;
BEGIN
  v_role := public.current_erp_role();
  IF COALESCE(v_role, 'AUDITOR'::public.erp_role) NOT IN (
    'ADMIN'::public.erp_role, 'SENIOR_ACCOUNTANT'::public.erp_role
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: فقط مدیر سیستم یا حسابدار ارشد مجاز به تأیید پیشنویس هوش مصنوعی است.';
  END IF;

  SELECT * INTO v_req
  FROM public.agent_approval_requests
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND: درخواست تأیید یافت نشد.';
  END IF;
  IF v_req.status <> 'PENDING_HUMAN_APPROVAL' THEN
    RAISE EXCEPTION 'ALREADY_REVIEWED: این درخواست قبلاً بررسی شده است.';
  END IF;
  IF v_req.action_type <> 'APPROVE_DRAFT_VOUCHER'
     OR NULLIF(v_req.payload->>'voucher_id', '') IS NULL THEN
    RAISE EXCEPTION 'INVALID_APPROVAL_ACTION: این درخواست به پیش‌نویس سند معتبر متصل نیست.';
  END IF;

  v_voucher_id := (v_req.payload->>'voucher_id')::uuid;

  SELECT * INTO v_voucher
  FROM public.vouchers
  WHERE id = v_voucher_id
    AND fiscal_year_id = v_req.fiscal_year_id
    AND status = 'DRAFT'::public.voucher_status
    AND created_by_actor = 'AI_AGENT'::public.creator_actor
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DRAFT_NOT_FOUND: پیش‌نویس عامل وجود ندارد یا قبلاً تغییر وضعیت داده است.';
  END IF;

  SELECT count(*), COALESCE(sum(debit_rial), 0), COALESCE(sum(credit_rial), 0)
  INTO v_line_count, v_total_debit, v_total_credit
  FROM public.voucher_lines
  WHERE voucher_id = v_voucher_id;

  IF v_line_count < 2 OR v_total_debit <= 0 OR v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'DOUBLE_ENTRY_UNBALANCED: پیش‌نویس عامل متوازن نیست و قابل تأیید نیست.';
  END IF;

  PERFORM pg_catalog.set_config('app.allow_agent_review_write', 'true', true);

  UPDATE public.vouchers
  SET status = 'FINALIZED'::public.voucher_status,
      approved_by = auth.uid(),
      approved_at = pg_catalog.now()
  WHERE id = v_voucher_id
    AND status = 'DRAFT'::public.voucher_status
  RETURNING voucher_no INTO v_new_no;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVAL_FINALIZE_FAILED: قطعی‌سازی پیش‌نویس انجام نشد.';
  END IF;

  UPDATE public.agent_approval_requests
  SET status = 'APPROVED',
      reviewed_by = auth.uid(),
      reviewed_at = pg_catalog.now()
  WHERE id = p_approval_id;

  RETURN pg_catalog.jsonb_build_object(
    'approved', true,
    'approval_id', p_approval_id,
    'voucher_id', v_voucher_id,
    'voucher_no', v_new_no
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_approve_agent_draft(p_approval_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.fn_approve_agent_draft(p_approval_id);
$function$;

CREATE OR REPLACE FUNCTION private.fn_reject_agent_draft(
  p_approval_id uuid,
  p_reason text DEFAULT 'رد شده توسط مدیر مالی'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role public.erp_role;
  v_req public.agent_approval_requests%ROWTYPE;
  v_voucher_id uuid;
  v_voucher public.vouchers%ROWTYPE;
  v_reason text;
BEGIN
  v_role := public.current_erp_role();
  IF COALESCE(v_role, 'AUDITOR'::public.erp_role) NOT IN (
    'ADMIN'::public.erp_role, 'SENIOR_ACCOUNTANT'::public.erp_role
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: فقط مدیر سیستم یا حسابدار ارشد مجاز به رد پیشنویس است.';
  END IF;

  SELECT * INTO v_req
  FROM public.agent_approval_requests
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND: درخواست تأیید یافت نشد.';
  END IF;
  IF v_req.status <> 'PENDING_HUMAN_APPROVAL' THEN
    RAISE EXCEPTION 'ALREADY_REVIEWED: این درخواست قبلاً بررسی شده است.';
  END IF;

  v_reason := COALESCE(NULLIF(pg_catalog.btrim(p_reason), ''), 'رد شده توسط مدیر مالی');
  v_voucher_id := NULLIF(v_req.payload->>'voucher_id', '')::uuid;

  IF v_voucher_id IS NOT NULL THEN
    SELECT * INTO v_voucher
    FROM public.vouchers
    WHERE id = v_voucher_id
      AND fiscal_year_id = v_req.fiscal_year_id
      AND status = 'DRAFT'::public.voucher_status
      AND created_by_actor = 'AI_AGENT'::public.creator_actor
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DRAFT_NOT_FOUND: پیش‌نویس عامل وجود ندارد یا قبلاً تغییر وضعیت داده است.';
    END IF;

    PERFORM pg_catalog.set_config('app.allow_agent_review_write', 'true', true);

    UPDATE public.vouchers
    SET status = 'VOID'::public.voucher_status
    WHERE id = v_voucher_id
      AND status = 'DRAFT'::public.voucher_status;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'REJECT_FAILED: رد پیش‌نویس سند انجام نشد.';
    END IF;
  END IF;

  UPDATE public.agent_approval_requests
  SET status = 'REJECTED',
      reviewed_by = auth.uid(),
      reviewed_at = pg_catalog.now(),
      payload = COALESCE(payload, '{}'::jsonb) || pg_catalog.jsonb_build_object('rejection_reason', v_reason)
  WHERE id = p_approval_id;

  RETURN pg_catalog.jsonb_build_object(
    'rejected', true,
    'approval_id', p_approval_id,
    'voucher_id', v_voucher_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_reject_agent_draft(
  p_approval_id uuid,
  p_reason text DEFAULT 'رد شده توسط مدیر مالی'
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.fn_reject_agent_draft(p_approval_id, p_reason);
$function$;


REVOKE ALL ON FUNCTION public.fn_create_voucher_atomic(uuid, public.voucher_type, public.voucher_status, date, character, text, text, public.creator_actor, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_voucher_atomic(uuid, public.voucher_type, public.voucher_status, date, character, text, text, public.creator_actor, text, jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION private.fn_create_voucher_draft_atomic(uuid, public.voucher_type, date, character, text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_create_voucher_draft_atomic(uuid, public.voucher_type, date, character, text, text, text, text, jsonb, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_create_voucher_draft_atomic(uuid, public.voucher_type, date, character, text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_voucher_draft_atomic(uuid, public.voucher_type, date, character, text, text, text, text, jsonb, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.fn_delete_draft_voucher(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_delete_draft_voucher(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_delete_draft_voucher(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_delete_draft_voucher(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.fn_approve_agent_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_approve_agent_draft(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_approve_agent_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_approve_agent_draft(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.fn_reject_agent_draft(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_reject_agent_draft(uuid, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_reject_agent_draft(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reject_agent_draft(uuid, text) TO authenticated, service_role;
