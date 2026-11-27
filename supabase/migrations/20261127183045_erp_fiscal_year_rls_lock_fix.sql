
-- Keep fiscal-year serialization inside the SECURITY DEFINER trigger.
-- Invoker RPCs must not use SELECT FOR UPDATE on fiscal_years because
-- authenticated users intentionally have SELECT-only RLS access there.

CREATE OR REPLACE FUNCTION public.fn_guard_voucher_header()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_fy RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT * INTO v_fy
    FROM public.fiscal_years
    WHERE id = OLD.fiscal_year_id
    FOR UPDATE;

    IF v_fy.is_closed THEN
      RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی % بسته شده و غیرقابل تغییر است.', v_fy.code;
    END IF;
    IF OLD.status = 'FINALIZED'::public.voucher_status THEN
      RAISE EXCEPTION 'IMMUTABLE_VOUCHER: سند قطعی‌شده قابل حذف نیست؛ سند اصلاحی صادر کنید.';
    END IF;
    RETURN OLD;
  END IF;

  SELECT * INTO v_fy
  FROM public.fiscal_years
  WHERE id = NEW.fiscal_year_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVALID_FISCAL_YEAR: سال مالی معتبر نیست.';
  END IF;

  IF v_fy.is_closed
     AND pg_catalog.current_setting('app.allow_closing_write', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی % بسته و قفل شده است.', v_fy.code;
  END IF;

  IF NEW.voucher_date_gregorian < v_fy.start_date OR NEW.voucher_date_gregorian > v_fy.end_date THEN
    RAISE EXCEPTION 'DATE_OUT_OF_BOUNDS: تاریخ سند (%) خارج از بازه سال مالی % (% تا %) است.',
      NEW.voucher_date_jalali, v_fy.code, v_fy.jalali_start, v_fy.jalali_end;
  END IF;

  IF NEW.created_by_actor = 'AI_AGENT'::public.creator_actor
     OR public.current_erp_role() = 'AI_AGENT'::public.erp_role THEN
    IF NEW.status <> 'DRAFT'::public.voucher_status
       AND pg_catalog.current_setting('app.allow_agent_review_write', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'AI_DRAFT_ONLY_VIOLATION: عامل هوشمند فقط مجاز به ایجاد پیش‌نویس است؛ تغییر وضعیت باید از مسیر تأیید انسانی عبور کند.';
    END IF;
    IF NEW.idempotency_key IS NULL OR pg_catalog.length(pg_catalog.btrim(NEW.idempotency_key)) < 8 THEN
      RAISE EXCEPTION 'IDEMPOTENCY_REQUIRED: کلید یکتای عملیات (idempotency_key) برای عامل هوشمند الزامی است.';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'FINALIZED'::public.voucher_status
     AND NEW.status <> 'VOID'::public.voucher_status THEN
    RAISE EXCEPTION 'IMMUTABLE_VOUCHER: سند قطعی‌شده شماره % غیرقابل ویرایش است.', OLD.voucher_no;
  END IF;

  IF NEW.voucher_no IS NULL
     AND (NEW.status = 'FINALIZED'::public.voucher_status OR NEW.voucher_type = 'OPENING'::public.voucher_type) THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('fy_seq_' || NEW.fiscal_year_id::text));
    IF NEW.voucher_type = 'OPENING'::public.voucher_type THEN
      NEW.voucher_no := 1;
      UPDATE public.fiscal_years
      SET last_voucher_no = GREATEST(last_voucher_no, 1)
      WHERE id = NEW.fiscal_year_id;
    ELSE
      UPDATE public.fiscal_years
      SET last_voucher_no = last_voucher_no + 1
      WHERE id = NEW.fiscal_year_id
      RETURNING last_voucher_no INTO NEW.voucher_no;
    END IF;
  END IF;

  NEW.updated_at := pg_catalog.now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.fn_guard_voucher_header() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_update_draft_voucher(
  p_voucher_id uuid,
  p_voucher_date_gregorian date,
  p_voucher_date_jalali character,
  p_description text,
  p_reference_no text,
  p_compliance_status text,
  p_compliance_flags jsonb,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_role public.erp_role;
  v_existing public.vouchers%ROWTYPE;
  v_fy public.fiscal_years%ROWTYPE;
  v_lines jsonb;
  v_line jsonb;
  v_line_no integer := 0;
BEGIN
  v_role := public.current_erp_role();
  IF COALESCE(v_role, 'AUDITOR'::public.erp_role) NOT IN (
    'ADMIN'::public.erp_role, 'SENIOR_ACCOUNTANT'::public.erp_role, 'ACCOUNTANT'::public.erp_role
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: نقش کاربر مجاز به ویرایش پیش‌نویس نیست.';
  END IF;

  SELECT * INTO v_existing
  FROM public.vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOUCHER_NOT_FOUND: سند یافت نشد.';
  END IF;
  IF v_existing.status <> 'DRAFT'::public.voucher_status THEN
    RAISE EXCEPTION 'IMMUTABLE_VOUCHER: تنها اسناد پیش‌نویس قابل ویرایش هستند.';
  END IF;

  -- SELECT only: the trigger acquires the fiscal-year row lock as SECURITY DEFINER.
  SELECT * INTO v_fy
  FROM public.fiscal_years
  WHERE id = v_existing.fiscal_year_id;

  IF NOT FOUND OR v_fy.is_closed THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی معتبر نیست یا بسته شده است.';
  END IF;
  IF p_voucher_date_gregorian IS NULL
     OR p_voucher_date_gregorian < v_fy.start_date
     OR p_voucher_date_gregorian > v_fy.end_date THEN
    RAISE EXCEPTION 'DATE_OUT_OF_BOUNDS: تاریخ سند خارج از بازه سال مالی است.';
  END IF;
  IF p_voucher_date_jalali IS NULL OR pg_catalog.btrim(p_voucher_date_jalali) = ''
     OR p_description IS NULL OR pg_catalog.btrim(p_description) = '' THEN
    RAISE EXCEPTION 'INVALID_VOUCHER_HEADER: تاریخ و شرح سند الزامی است.';
  END IF;
  IF p_compliance_flags IS NOT NULL AND pg_catalog.jsonb_typeof(p_compliance_flags) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_COMPLIANCE_FLAGS: هشدارهای تطبیق باید آرایه باشند.';
  END IF;

  v_lines := private.fn_validate_voucher_lines(p_lines, p_description);

  UPDATE public.vouchers
  SET voucher_date_gregorian = p_voucher_date_gregorian,
      voucher_date_jalali = p_voucher_date_jalali,
      description = pg_catalog.btrim(p_description),
      reference_no = NULLIF(pg_catalog.btrim(p_reference_no), ''),
      compliance_status = COALESCE(NULLIF(pg_catalog.btrim(p_compliance_status), ''), 'UNCHECKED'),
      compliance_flags = COALESCE(p_compliance_flags, '[]'::jsonb)
  WHERE id = p_voucher_id
    AND status = 'DRAFT'::public.voucher_status;

  DELETE FROM public.voucher_lines
  WHERE voucher_id = p_voucher_id;

  FOR v_line IN SELECT e.value FROM pg_catalog.jsonb_array_elements(v_lines) AS e(value)
  LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.voucher_lines (
      voucher_id, fiscal_year_id, line_no, account_id, tafsil_id,
      debit_rial, credit_rial, line_description, moadian_tax_id, bank_trace_no
    )
    VALUES (
      p_voucher_id, v_existing.fiscal_year_id, v_line_no,
      (v_line->>'account_id')::uuid,
      NULLIF(v_line->>'tafsil_id', '')::uuid,
      (v_line->>'debit_rial')::bigint,
      (v_line->>'credit_rial')::bigint,
      v_line->>'line_description',
      NULLIF(v_line->>'moadian_tax_id', ''),
      NULLIF(v_line->>'bank_trace_no', '')
    );
  END LOOP;

  RETURN pg_catalog.jsonb_build_object('updated', true, 'voucher_id', p_voucher_id, 'status', 'DRAFT');
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_finalize_voucher(p_voucher_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_role public.erp_role;
  v_voucher public.vouchers%ROWTYPE;
  v_fy public.fiscal_years%ROWTYPE;
  v_line_count integer;
  v_total_debit numeric;
  v_total_credit numeric;
  v_new_no integer;
BEGIN
  v_role := public.current_erp_role();
  IF COALESCE(v_role, 'AUDITOR'::public.erp_role) NOT IN (
    'ADMIN'::public.erp_role, 'SENIOR_ACCOUNTANT'::public.erp_role, 'ACCOUNTANT'::public.erp_role
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: دسترسی مجاز برای قطعی‌سازی سند وجود ندارد.';
  END IF;

  SELECT * INTO v_voucher
  FROM public.vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOUCHER_NOT_FOUND: سند یافت نشد.';
  END IF;
  IF v_voucher.status <> 'DRAFT'::public.voucher_status THEN
    RAISE EXCEPTION 'INVALID_STATUS: تنها سند پیش‌نویس قابل قطعی‌سازی است.';
  END IF;
  IF v_voucher.created_by_actor = 'AI_AGENT'::public.creator_actor THEN
    RAISE EXCEPTION 'AI_APPROVAL_REQUIRED: پیش‌نویس عامل فقط از صف تأیید انسانی قابل قطعی‌سازی است.';
  END IF;

  -- SELECT only: fn_guard_voucher_header locks and sequences the fiscal year safely.
  SELECT * INTO v_fy
  FROM public.fiscal_years
  WHERE id = v_voucher.fiscal_year_id;

  IF NOT FOUND OR v_fy.is_closed THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی معتبر نیست یا بسته شده است.';
  END IF;

  SELECT count(*), COALESCE(sum(debit_rial), 0), COALESCE(sum(credit_rial), 0)
  INTO v_line_count, v_total_debit, v_total_credit
  FROM public.voucher_lines
  WHERE voucher_id = p_voucher_id;

  IF v_line_count < 2 OR v_total_debit <= 0 OR v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'DOUBLE_ENTRY_UNBALANCED: سند باید حداقل دو ردیف متوازن با جمع غیرصفر داشته باشد.';
  END IF;

  UPDATE public.vouchers
  SET status = 'FINALIZED'::public.voucher_status,
      approved_by = auth.uid(),
      approved_at = pg_catalog.now()
  WHERE id = p_voucher_id
    AND status = 'DRAFT'::public.voucher_status
  RETURNING voucher_no INTO v_new_no;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FINALIZE_FAILED: قطعی‌سازی سند انجام نشد.';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'finalized', true,
    'voucher_id', p_voucher_id,
    'voucher_no', v_new_no
  );
END;
$function$;
