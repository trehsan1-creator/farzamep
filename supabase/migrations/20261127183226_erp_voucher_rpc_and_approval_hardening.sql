-- ERP write-path hardening: use a dedicated, authenticated-only draft RPC.
-- Existing vouchers and financial source data are not modified by this migration.

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
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
DECLARE
  v_existing RECORD;
  v_voucher_id uuid;
  v_line jsonb;
  v_idx smallint := 1;
  v_acc_id uuid;
  v_requires_tafsil boolean;
  v_taf_id uuid;
  v_taf_id_text text;
  v_taf_code text;
  v_debit numeric;
  v_credit numeric;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: ورود معتبر برای ثبت سند الزامی است.';
  END IF;

  IF private.current_erp_role() NOT IN ('ADMIN', 'SENIOR_ACCOUNTANT', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN: نقش کاربری مجاز به ثبت سند حسابداری نیست.';
  END IF;

  IF p_voucher_type NOT IN ('GENERAL', 'ADJUSTMENT') THEN
    RAISE EXCEPTION 'INVALID_VOUCHER_TYPE: از این مسیر فقط سند عمومی یا اصلاحی قابل ثبت است.';
  END IF;

  IF p_voucher_date_gregorian IS NULL
     OR p_voucher_date_jalali IS NULL
     OR length(btrim(p_voucher_date_jalali)) = 0 THEN
    RAISE EXCEPTION 'INVALID_VOUCHER_DATE: تاریخ شمسی و میلادی سند الزامی است.';
  END IF;

  IF p_description IS NULL OR length(btrim(p_description)) = 0 THEN
    RAISE EXCEPTION 'INVALID_DESCRIPTION: شرح سند الزامی است.';
  END IF;

  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_REQUIRED: کلید یکتای معتبر برای ثبت سند الزامی است.';
  END IF;

  IF p_compliance_flags IS NULL THEN
    p_compliance_flags := '[]'::jsonb;
  END IF;
  IF jsonb_typeof(p_compliance_flags) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_COMPLIANCE_FLAGS: فهرست هشدارهای انطباق باید آرایه باشد.';
  END IF;

  IF p_lines IS NULL
     OR jsonb_typeof(p_lines) <> 'array'
     OR jsonb_array_length(p_lines) < 2
     OR jsonb_array_length(p_lines) > 32767 THEN
    RAISE EXCEPTION 'INVALID_VOUCHER_LINES: سند باید بین ۲ تا ۳۲۷۶۷ ردیف داشته باشد.';
  END IF;

  -- Validate the complete double-entry totals before creating the header.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) AS entries(value)
  LOOP
    IF jsonb_typeof(v_line) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_VOUCHER_LINE: ساختار هر ردیف سند باید شیء باشد.';
    END IF;

    v_debit := COALESCE(NULLIF(v_line->>'debit_rial', '')::numeric, 0);
    v_credit := COALESCE(NULLIF(v_line->>'credit_rial', '')::numeric, 0);

    IF v_debit < 0
       OR v_credit < 0
       OR trunc(v_debit) <> v_debit
       OR trunc(v_credit) <> v_credit
       OR v_debit > 9223372036854775807::numeric
       OR v_credit > 9223372036854775807::numeric
       OR (v_debit = 0 AND v_credit = 0)
       OR (v_debit > 0 AND v_credit > 0) THEN
      RAISE EXCEPTION 'INVALID_VOUCHER_LINE_AMOUNT: مبلغ هر ردیف باید عدد صحیح، غیرمنفی و فقط در یک سمت باشد.';
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF v_total_debit <= 0 OR v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'DOUBLE_ENTRY_UNBALANCED: جمع بدهکار و بستانکار باید برابر و بزرگتر از صفر باشد.';
  END IF;

  -- A unique index on idempotency_key makes concurrent retries safe.
  INSERT INTO public.vouchers (
    fiscal_year_id,
    voucher_type,
    status,
    voucher_date_gregorian,
    voucher_date_jalali,
    description,
    reference_no,
    idempotency_key,
    created_by,
    created_by_actor,
    compliance_status,
    compliance_flags
  )
  VALUES (
    p_fiscal_year_id,
    p_voucher_type,
    'DRAFT',
    p_voucher_date_gregorian,
    p_voucher_date_jalali,
    btrim(p_description),
    NULLIF(btrim(p_reference_no), ''),
    p_idempotency_key,
    auth.uid(),
    'HUMAN',
    COALESCE(NULLIF(btrim(p_compliance_status), ''), 'UNCHECKED'),
    p_compliance_flags
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_voucher_id;

  IF v_voucher_id IS NULL THEN
    SELECT
      id,
      status,
      voucher_no,
      fiscal_year_id,
      voucher_type,
      voucher_date_gregorian,
      voucher_date_jalali,
      description,
      reference_no
    INTO v_existing
    FROM public.vouchers
    WHERE idempotency_key = p_idempotency_key;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'IDEMPOTENCY_RETRY: ثبت هم‌زمان رخ داد؛ درخواست را با همان کلید دوباره بررسی کنید.';
    END IF;

    IF v_existing.fiscal_year_id IS DISTINCT FROM p_fiscal_year_id
       OR v_existing.voucher_type IS DISTINCT FROM p_voucher_type
       OR v_existing.voucher_date_gregorian IS DISTINCT FROM p_voucher_date_gregorian
       OR v_existing.voucher_date_jalali IS DISTINCT FROM p_voucher_date_jalali
       OR v_existing.description IS DISTINCT FROM btrim(p_description)
       OR v_existing.reference_no IS DISTINCT FROM NULLIF(btrim(p_reference_no), '') THEN
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSE: کلید یکتا قبلاً برای محتوای متفاوتی استفاده شده است.';
    END IF;

    RETURN jsonb_build_object(
      'created', false,
      'idempotent_replay', true,
      'voucher_id', v_existing.id,
      'status', v_existing.status,
      'voucher_no', v_existing.voucher_no
    );
  END IF;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) AS entries(value)
  LOOP
    SELECT id, requires_tafsil
    INTO v_acc_id, v_requires_tafsil
    FROM public.accounts
    WHERE code = NULLIF(v_line->>'account_code', '')
      AND is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'UNKNOWN_ACCOUNT: کد معین % یافت نشد.', (v_line->>'account_code');
    END IF;

    v_taf_id := NULL;
    v_taf_id_text := NULLIF(v_line->>'tafsil_id', '');
    v_taf_code := NULLIF(v_line->>'tafsil_code', '');

    IF v_taf_id_text IS NOT NULL THEN
      v_taf_id := v_taf_id_text::uuid;

      IF NOT EXISTS (
        SELECT 1
        FROM public.tafsil_parties
        WHERE id = v_taf_id
          AND is_active = true
      ) THEN
        RAISE EXCEPTION 'UNKNOWN_TAFSIL: تفصیلی انتخاب‌شده معتبر یا فعال نیست.';
      END IF;

      IF v_taf_code IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.tafsil_parties
        WHERE id = v_taf_id
          AND tafsil_code = v_taf_code
      ) THEN
        RAISE EXCEPTION 'TAFSIL_MISMATCH: شناسه و کد تفصیلی با یکدیگر مطابقت ندارند.';
      END IF;
    ELSIF v_taf_code IS NOT NULL THEN
      SELECT id
      INTO v_taf_id
      FROM public.tafsil_parties
      WHERE tafsil_code = v_taf_code
        AND is_active = true;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'UNKNOWN_TAFSIL: کد تفصیلی % یافت نشد.', v_taf_code;
      END IF;
    END IF;

    IF v_requires_tafsil AND v_taf_id IS NULL THEN
      RAISE EXCEPTION 'TAFSIL_REQUIRED: برای حساب % ثبت تفصیلی الزامی است.', (v_line->>'account_code');
    END IF;

    INSERT INTO public.voucher_lines (
      voucher_id,
      fiscal_year_id,
      line_no,
      account_id,
      tafsil_id,
      debit_rial,
      credit_rial,
      line_description,
      moadian_tax_id,
      bank_trace_no
    )
    VALUES (
      v_voucher_id,
      p_fiscal_year_id,
      v_idx,
      v_acc_id,
      v_taf_id,
      COALESCE(NULLIF(v_line->>'debit_rial', '')::numeric, 0)::bigint,
      COALESCE(NULLIF(v_line->>'credit_rial', '')::numeric, 0)::bigint,
      COALESCE(NULLIF(btrim(v_line->>'line_description'), ''), btrim(p_description)),
      NULLIF(v_line->>'moadian_tax_id', ''),
      NULLIF(v_line->>'bank_trace_no', '')
    );

    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'created', true,
    'idempotent_replay', false,
    'voucher_id', v_voucher_id,
    'status', 'DRAFT',
    'voucher_no', NULL
  );
END;
$function$;

-- Approval must only finalize the exact draft requested for human approval.
CREATE OR REPLACE FUNCTION private.fn_approve_agent_draft(p_approval_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_req public.agent_approval_requests%ROWTYPE;
  v_voucher_id uuid;
  v_voucher_status public.voucher_status;
  v_fy_closed boolean;
  v_new_no integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: نشست معتبر کاربر الزامی است.';
  END IF;

  IF private.current_erp_role() NOT IN ('ADMIN', 'SENIOR_ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN: فقط مدیر سامانه یا حسابدار ارشد مجاز به تأیید پیشنویس هوش مصنوعی است.';
  END IF;

  SELECT *
  INTO v_req
  FROM public.agent_approval_requests
  WHERE id = p_approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'APPROVAL_NOT_FOUND: درخواست تأیید یافت نشد.';
  END IF;

  IF v_req.status <> 'PENDING_HUMAN_APPROVAL' THEN
    RAISE EXCEPTION 'ALREADY_REVIEWED: این درخواست قبلاً بررسی شده است.';
  END IF;

  IF v_req.action_type <> 'APPROVE_DRAFT_VOUCHER' THEN
    RAISE EXCEPTION 'UNSUPPORTED_ACTION: این درخواست از نوع تأیید سند حسابداری نیست.';
  END IF;

  v_voucher_id := NULLIF(v_req.payload->>'voucher_id', '')::uuid;
  IF v_voucher_id IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_ID_REQUIRED: درخواست به شناسه سند پیش‌نویس متصل نیست.';
  END IF;

  SELECT v.status, fy.is_closed
  INTO v_voucher_status, v_fy_closed
  FROM public.vouchers AS v
  JOIN public.fiscal_years AS fy ON fy.id = v.fiscal_year_id
  WHERE v.id = v_voucher_id
  FOR UPDATE OF v;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOUCHER_NOT_FOUND: سند پیشنویس یافت نشد.';
  END IF;

  IF v_fy_closed THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی بسته شده است.';
  END IF;

  IF v_voucher_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'INVALID_STATUS: فقط سند پیشنویس قابل تأیید است.';
  END IF;

  UPDATE public.vouchers
  SET status = 'FINALIZED',
      approved_by = auth.uid(),
      approved_at = pg_catalog.now()
  WHERE id = v_voucher_id
    AND status = 'DRAFT'
  RETURNING voucher_no INTO v_new_no;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINALIZATION_FAILED: قطعی‌سازی سند انجام نشد.';
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

-- Rejection is idempotent only while the request is pending, and voids its draft atomically.
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
  v_req public.agent_approval_requests%ROWTYPE;
  v_voucher_id uuid;
  v_voucher_status public.voucher_status;
  v_fy_closed boolean;
  v_reason text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: نشست معتبر کاربر الزامی است.';
  END IF;

  IF private.current_erp_role() NOT IN ('ADMIN', 'SENIOR_ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN: فقط مدیر سامانه یا حسابدار ارشد مجاز به رد پیشنویس است.';
  END IF;

  SELECT *
  INTO v_req
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
    SELECT v.status, fy.is_closed
    INTO v_voucher_status, v_fy_closed
    FROM public.vouchers AS v
    JOIN public.fiscal_years AS fy ON fy.id = v.fiscal_year_id
    WHERE v.id = v_voucher_id
    FOR UPDATE OF v;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'VOUCHER_NOT_FOUND: سند متصل به درخواست یافت نشد.';
    END IF;

    IF v_fy_closed THEN
      RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی بسته شده است.';
    END IF;

    IF v_voucher_status <> 'DRAFT' THEN
      RAISE EXCEPTION 'INVALID_STATUS: فقط سند پیشنویس قابل رد است.';
    END IF;

    UPDATE public.vouchers
    SET status = 'VOID'
    WHERE id = v_voucher_id
      AND status = 'DRAFT';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'REJECTION_FAILED: رد سند انجام نشد.';
    END IF;
  END IF;

  UPDATE public.agent_approval_requests
  SET status = 'REJECTED',
      reviewed_by = auth.uid(),
      reviewed_at = pg_catalog.now(),
      payload = COALESCE(payload, '{}'::jsonb)
        || pg_catalog.jsonb_build_object('rejection_reason', v_reason)
  WHERE id = p_approval_id;

  RETURN pg_catalog.jsonb_build_object(
    'rejected', true,
    'approval_id', p_approval_id,
    'voucher_id', v_voucher_id,
    'reason', v_reason
  );
END;
$function$;

-- Keep the audit record when a user deletes a draft voucher.
CREATE OR REPLACE FUNCTION public.fn_delete_draft_voucher(p_voucher_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_status public.voucher_status;
  v_fy_closed boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: نشست معتبر کاربر الزامی است.';
  END IF;

  IF private.current_erp_role() NOT IN ('ADMIN', 'SENIOR_ACCOUNTANT', 'ACCOUNTANT') THEN
    RAISE EXCEPTION 'FORBIDDEN: نقش کاربری مجاز به حذف سند نیست.';
  END IF;

  SELECT v.status, fy.is_closed
  INTO v_status, v_fy_closed
  FROM public.vouchers AS v
  JOIN public.fiscal_years AS fy ON fy.id = v.fiscal_year_id
  WHERE v.id = p_voucher_id
  FOR UPDATE OF v;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOUCHER_NOT_FOUND: سند یافت نشد.';
  END IF;

  IF v_fy_closed THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی بسته شده است.';
  END IF;

  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'IMMUTABLE_VOUCHER: تنها اسناد پیشنویس قابل حذف هستند.';
  END IF;

  UPDATE public.agent_approval_requests
  SET status = 'REJECTED',
      reviewed_by = auth.uid(),
      reviewed_at = pg_catalog.now(),
      payload = COALESCE(payload, '{}'::jsonb)
        || pg_catalog.jsonb_build_object('rejection_reason', 'پیش‌نویس توسط کاربر حذف شد')
  WHERE payload->>'voucher_id' = p_voucher_id::text
    AND status = 'PENDING_HUMAN_APPROVAL';

  DELETE FROM public.voucher_lines
  WHERE voucher_id = p_voucher_id;

  DELETE FROM public.vouchers
  WHERE id = p_voucher_id
    AND status = 'DRAFT';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELETE_FAILED: حذف سند انجام نشد.';
  END IF;

  RETURN pg_catalog.jsonb_build_object('deleted', true, 'voucher_id', p_voucher_id);
END;
$function$;

-- RPCs are not public APIs for anonymous callers. Preserve authenticated access.
REVOKE EXECUTE ON FUNCTION public.fn_create_voucher_draft_atomic(
  uuid, public.voucher_type, date, character, text, text, text, text, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_voucher_draft_atomic(
  uuid, public.voucher_type, date, character, text, text, text, text, jsonb, jsonb
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_create_voucher_atomic(
  uuid, public.voucher_type, public.voucher_status, date, character, text, text, public.creator_actor, text, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_voucher_atomic(
  uuid, public.voucher_type, public.voucher_status, date, character, text, text, public.creator_actor, text, jsonb, jsonb
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_update_draft_voucher(
  uuid, date, character, text, text, text, jsonb, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_draft_voucher(
  uuid, date, character, text, text, text, jsonb, jsonb
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_delete_draft_voucher(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_delete_draft_voucher(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_finalize_voucher(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_finalize_voucher(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_approve_agent_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_approve_agent_draft(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.fn_reject_agent_draft(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_reject_agent_draft(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION private.fn_approve_agent_draft(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_approve_agent_draft(uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION private.fn_reject_agent_draft(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_reject_agent_draft(uuid, text) TO authenticated;
