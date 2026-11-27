
-- Farzam ERP ledger write-path hardening.
-- Additive function/permission changes only; no business rows are deleted or rewritten.

CREATE OR REPLACE FUNCTION private.fn_validate_voucher_lines(
  p_lines jsonb,
  p_default_description text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_line jsonb;
  v_line_count integer;
  v_line_no integer := 0;
  v_account_id uuid;
  v_requires_tafsil boolean;
  v_tafsil_id uuid;
  v_tafsil_code text;
  v_debit bigint;
  v_credit bigint;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_normalized jsonb := '[]'::jsonb;
BEGIN
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_VOUCHER_LINES: ردیف‌های سند باید آرایه باشند.';
  END IF;
  IF p_default_description IS NULL OR pg_catalog.btrim(p_default_description) = '' THEN
    RAISE EXCEPTION 'DESCRIPTION_REQUIRED: شرح سند الزامی است.';
  END IF;

  v_line_count := pg_catalog.jsonb_array_length(p_lines);
  IF v_line_count < 2 OR v_line_count > 32767 THEN
    RAISE EXCEPTION 'INVALID_VOUCHER_LINE_COUNT: سند باید حداقل دو ردیف و حداکثر ۳۲۷۶۷ ردیف داشته باشد.';
  END IF;

  FOR v_line IN
    SELECT e.value FROM pg_catalog.jsonb_array_elements(p_lines) AS e(value)
  LOOP
    v_line_no := v_line_no + 1;
    IF pg_catalog.jsonb_typeof(v_line) <> 'object' THEN
      RAISE EXCEPTION 'INVALID_VOUCHER_LINE: ساختار ردیف شماره % معتبر نیست.', v_line_no;
    END IF;

    v_debit := COALESCE(NULLIF(v_line->>'debit_rial', '')::bigint, 0);
    v_credit := COALESCE(NULLIF(v_line->>'credit_rial', '')::bigint, 0);
    IF v_debit < 0 OR v_credit < 0
       OR (v_debit = 0 AND v_credit = 0)
       OR (v_debit > 0 AND v_credit > 0) THEN
      RAISE EXCEPTION 'INVALID_VOUCHER_LINE_AMOUNT: هر ردیف باید مبلغ صحیح و غیرمنفی را فقط در یک سمت داشته باشد.';
    END IF;

    SELECT a.id, a.requires_tafsil
    INTO v_account_id, v_requires_tafsil
    FROM public.accounts a
    WHERE a.code = NULLIF(pg_catalog.btrim(v_line->>'account_code'), '')
      AND a.is_active = TRUE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'UNKNOWN_ACCOUNT: کد حساب % یافت نشد یا غیرفعال است.', v_line->>'account_code';
    END IF;

    v_tafsil_id := NULL;
    v_tafsil_code := NULLIF(pg_catalog.btrim(v_line->>'tafsil_code'), '');

    IF NULLIF(pg_catalog.btrim(v_line->>'tafsil_id'), '') IS NOT NULL THEN
      v_tafsil_id := (v_line->>'tafsil_id')::uuid;
      PERFORM 1
      FROM public.tafsil_parties tp
      WHERE tp.id = v_tafsil_id
        AND tp.is_active = TRUE
        AND (v_tafsil_code IS NULL OR tp.tafsil_code = v_tafsil_code);
      IF NOT FOUND THEN
        RAISE EXCEPTION 'UNKNOWN_TAFSIL: تفصیلی انتخاب‌شده یافت نشد، غیرفعال است یا کد و شناسه آن هم‌خوانی ندارند.';
      END IF;
    ELSIF v_tafsil_code IS NOT NULL THEN
      SELECT tp.id INTO v_tafsil_id
      FROM public.tafsil_parties tp
      WHERE tp.tafsil_code = v_tafsil_code
        AND tp.is_active = TRUE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'UNKNOWN_TAFSIL: کد تفصیلی % یافت نشد یا غیرفعال است.', v_tafsil_code;
      END IF;
    END IF;

    IF v_requires_tafsil AND v_tafsil_id IS NULL THEN
      RAISE EXCEPTION 'TAFSIL_REQUIRED: حساب % نیازمند تفصیلی است.', v_line->>'account_code';
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;

    v_normalized := v_normalized || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'account_id', v_account_id,
        'tafsil_id', v_tafsil_id,
        'debit_rial', v_debit,
        'credit_rial', v_credit,
        'line_description', COALESCE(
          NULLIF(pg_catalog.btrim(v_line->>'line_description'), ''),
          pg_catalog.btrim(p_default_description)
        ),
        'moadian_tax_id', NULLIF(pg_catalog.btrim(v_line->>'moadian_tax_id'), ''),
        'bank_trace_no', NULLIF(pg_catalog.btrim(v_line->>'bank_trace_no'), '')
      )
    );
  END LOOP;

  IF v_total_debit <= 0 OR v_total_debit <> v_total_credit THEN
    RAISE EXCEPTION 'DOUBLE_ENTRY_UNBALANCED: جمع بدهکار و بستانکار باید برابر و بزرگ‌تر از صفر باشد.';
  END IF;

  RETURN v_normalized;
END;
$function$;

REVOKE ALL ON FUNCTION private.fn_validate_voucher_lines(jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_validate_voucher_lines(jsonb, text) TO authenticated, service_role;

-- AI-generated vouchers may only leave DRAFT through the explicit human-review RPCs.
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
    WHERE id = OLD.fiscal_year_id;

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
  WHERE id = NEW.fiscal_year_id;

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

CREATE OR REPLACE FUNCTION private.fn_create_voucher_draft_atomic(
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
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role public.erp_role;
  v_fy public.fiscal_years%ROWTYPE;
  v_existing public.vouchers%ROWTYPE;
  v_lines jsonb;
  v_line jsonb;
  v_line_no integer := 0;
  v_voucher_id uuid;
BEGIN
  v_role := public.current_erp_role();
  IF COALESCE(v_role, 'AUDITOR'::public.erp_role) NOT IN (
    'ADMIN'::public.erp_role, 'SENIOR_ACCOUNTANT'::public.erp_role, 'ACCOUNTANT'::public.erp_role
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: نقش کاربر مجاز به ثبت پیش‌نویس سند نیست.';
  END IF;

  IF p_fiscal_year_id IS NULL THEN
    RAISE EXCEPTION 'FISCAL_YEAR_REQUIRED: سال مالی الزامی است.';
  END IF;
  IF p_voucher_type IS NULL OR p_voucher_type NOT IN (
    'GENERAL'::public.voucher_type, 'ADJUSTMENT'::public.voucher_type
  ) THEN
    RAISE EXCEPTION 'INVALID_VOUCHER_TYPE: فقط سند عمومی یا اصلاحی از این مسیر قابل ثبت است.';
  END IF;
  IF p_voucher_date_gregorian IS NULL OR p_voucher_date_jalali IS NULL
     OR pg_catalog.btrim(p_voucher_date_jalali) = '' THEN
    RAISE EXCEPTION 'VOUCHER_DATE_REQUIRED: تاریخ شمسی و میلادی الزامی است.';
  END IF;
  IF p_description IS NULL OR pg_catalog.btrim(p_description) = '' THEN
    RAISE EXCEPTION 'DESCRIPTION_REQUIRED: شرح سند الزامی است.';
  END IF;
  IF p_idempotency_key IS NULL OR pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_REQUIRED: کلید یکتای عملیات الزامی است.';
  END IF;
  IF p_compliance_flags IS NOT NULL AND pg_catalog.jsonb_typeof(p_compliance_flags) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_COMPLIANCE_FLAGS: هشدارهای تطبیق باید آرایه باشند.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('farzamep:manual-voucher:' || pg_catalog.btrim(p_idempotency_key), 0)
  );

  SELECT * INTO v_existing
  FROM public.vouchers
  WHERE idempotency_key = pg_catalog.btrim(p_idempotency_key)
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.fiscal_year_id <> p_fiscal_year_id THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: این کلید یکتا قبلاً برای سال مالی دیگری استفاده شده است.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'created', false,
      'idempotent_replay', true,
      'voucher_id', v_existing.id,
      'status', v_existing.status,
      'voucher_no', v_existing.voucher_no
    );
  END IF;

  SELECT * INTO v_fy
  FROM public.fiscal_years
  WHERE id = p_fiscal_year_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'FISCAL_YEAR_NOT_FOUND: سال مالی انتخاب‌شده یافت نشد.';
  END IF;
  IF v_fy.is_closed THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی بسته شده و امکان ثبت سند ندارد.';
  END IF;
  IF p_voucher_date_gregorian < v_fy.start_date OR p_voucher_date_gregorian > v_fy.end_date THEN
    RAISE EXCEPTION 'DATE_OUT_OF_BOUNDS: تاریخ سند خارج از بازه سال مالی است.';
  END IF;

  v_lines := private.fn_validate_voucher_lines(p_lines, p_description);

  INSERT INTO public.vouchers (
    fiscal_year_id, voucher_type, status,
    voucher_date_gregorian, voucher_date_jalali,
    description, reference_no, idempotency_key,
    created_by, created_by_actor, compliance_status, compliance_flags
  )
  VALUES (
    p_fiscal_year_id, p_voucher_type, 'DRAFT'::public.voucher_status,
    p_voucher_date_gregorian, p_voucher_date_jalali,
    pg_catalog.btrim(p_description), NULLIF(pg_catalog.btrim(p_reference_no), ''),
    pg_catalog.btrim(p_idempotency_key), auth.uid(), 'HUMAN'::public.creator_actor,
    COALESCE(NULLIF(pg_catalog.btrim(p_compliance_status), ''), 'UNCHECKED'),
    COALESCE(p_compliance_flags, '[]'::jsonb)
  )
  RETURNING id INTO v_voucher_id;

  FOR v_line IN SELECT e.value FROM pg_catalog.jsonb_array_elements(v_lines) AS e(value)
  LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.voucher_lines (
      voucher_id, fiscal_year_id, line_no, account_id, tafsil_id,
      debit_rial, credit_rial, line_description, moadian_tax_id, bank_trace_no
    )
    VALUES (
      v_voucher_id, p_fiscal_year_id, v_line_no,
      (v_line->>'account_id')::uuid,
      NULLIF(v_line->>'tafsil_id', '')::uuid,
      (v_line->>'debit_rial')::bigint,
      (v_line->>'credit_rial')::bigint,
      v_line->>'line_description',
      NULLIF(v_line->>'moadian_tax_id', ''),
      NULLIF(v_line->>'bank_trace_no', '')
    );
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'created', true,
    'idempotent_replay', false,
    'voucher_id', v_voucher_id,
    'status', 'DRAFT',
    'voucher_no', NULL
  );
END;
$function$;

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

  SELECT * INTO v_fy
  FROM public.fiscal_years
  WHERE id = v_existing.fiscal_year_id
  FOR UPDATE;

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

CREATE OR REPLACE FUNCTION private.fn_create_agent_draft_voucher(
  p_fiscal_year_id uuid,
  p_voucher_date_gregorian date,
  p_voucher_date_jalali character,
  p_description text,
  p_idempotency_key text,
  p_reference_no text,
  p_agent_name text,
  p_rationale_fa text,
  p_evidence_type text,
  p_evidence_ref text,
  p_evidence_summary_fa text,
  p_compliance_flags jsonb,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_fy public.fiscal_years%ROWTYPE;
  v_existing public.vouchers%ROWTYPE;
  v_lines jsonb;
  v_line jsonb;
  v_line_no integer := 0;
  v_voucher_id uuid;
  v_approval_id uuid;
BEGIN
  IF p_fiscal_year_id IS NULL OR p_voucher_date_gregorian IS NULL
     OR p_voucher_date_jalali IS NULL OR pg_catalog.btrim(p_voucher_date_jalali) = ''
     OR p_description IS NULL OR pg_catalog.btrim(p_description) = '' THEN
    RAISE EXCEPTION 'INVALID_VOUCHER_HEADER: سال مالی، تاریخ و شرح سند الزامی است.';
  END IF;
  IF p_idempotency_key IS NULL OR pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_REQUIRED: کلید یکتا (حداقل ۸ کاراکتر) الزامی است.';
  END IF;
  IF p_compliance_flags IS NOT NULL AND pg_catalog.jsonb_typeof(p_compliance_flags) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_COMPLIANCE_FLAGS: هشدارهای تطبیق باید آرایه باشند.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('farzamep:agent-voucher:' || pg_catalog.btrim(p_idempotency_key), 0)
  );

  SELECT * INTO v_existing
  FROM public.vouchers
  WHERE idempotency_key = pg_catalog.btrim(p_idempotency_key)
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.fiscal_year_id <> p_fiscal_year_id THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: این کلید یکتا قبلاً برای سال مالی دیگری استفاده شده است.';
    END IF;
    SELECT id INTO v_approval_id
    FROM public.agent_approval_requests
    WHERE payload->>'voucher_id' = v_existing.id::text
    ORDER BY created_at DESC
    LIMIT 1;
    RETURN pg_catalog.jsonb_build_object(
      'created', false,
      'idempotent_replay', true,
      'voucher_id', v_existing.id,
      'approval_id', v_approval_id,
      'status', v_existing.status,
      'voucher_no', v_existing.voucher_no
    );
  END IF;

  SELECT * INTO v_fy
  FROM public.fiscal_years
  WHERE id = p_fiscal_year_id
  FOR UPDATE;

  IF NOT FOUND OR v_fy.is_closed THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی معتبر نیست یا بسته شده است.';
  END IF;
  IF p_voucher_date_gregorian < v_fy.start_date OR p_voucher_date_gregorian > v_fy.end_date THEN
    RAISE EXCEPTION 'DATE_OUT_OF_BOUNDS: تاریخ سند خارج از بازه سال مالی است.';
  END IF;

  v_lines := private.fn_validate_voucher_lines(p_lines, p_description);

  INSERT INTO public.vouchers (
    fiscal_year_id, voucher_type, status,
    voucher_date_gregorian, voucher_date_jalali,
    description, reference_no, idempotency_key, created_by_actor,
    compliance_status, compliance_flags
  )
  VALUES (
    p_fiscal_year_id, 'GENERAL'::public.voucher_type, 'DRAFT'::public.voucher_status,
    p_voucher_date_gregorian, p_voucher_date_jalali,
    pg_catalog.btrim(p_description), NULLIF(pg_catalog.btrim(p_reference_no), ''),
    pg_catalog.btrim(p_idempotency_key), 'AI_AGENT'::public.creator_actor,
    CASE WHEN pg_catalog.jsonb_array_length(COALESCE(p_compliance_flags, '[]'::jsonb)) > 0 THEN 'WARNING' ELSE 'PASS' END,
    COALESCE(p_compliance_flags, '[]'::jsonb)
  )
  RETURNING id INTO v_voucher_id;

  FOR v_line IN SELECT e.value FROM pg_catalog.jsonb_array_elements(v_lines) AS e(value)
  LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO public.voucher_lines (
      voucher_id, fiscal_year_id, line_no, account_id, tafsil_id,
      debit_rial, credit_rial, line_description, moadian_tax_id, bank_trace_no
    )
    VALUES (
      v_voucher_id, p_fiscal_year_id, v_line_no,
      (v_line->>'account_id')::uuid,
      NULLIF(v_line->>'tafsil_id', '')::uuid,
      (v_line->>'debit_rial')::bigint,
      (v_line->>'credit_rial')::bigint,
      v_line->>'line_description',
      NULLIF(v_line->>'moadian_tax_id', ''),
      NULLIF(v_line->>'bank_trace_no', '')
    );
  END LOOP;

  INSERT INTO public.agent_approval_requests (
    fiscal_year_id, action_type, payload, status, requested_by_agent
  )
  VALUES (
    p_fiscal_year_id,
    'APPROVE_DRAFT_VOUCHER',
    pg_catalog.jsonb_build_object(
      'voucher_id', v_voucher_id,
      'idempotency_key', p_idempotency_key,
      'tool_name', 'create_draft_voucher',
      'rationale_fa', COALESCE(NULLIF(pg_catalog.btrim(p_rationale_fa), ''), p_description),
      'evidence_type', COALESCE(NULLIF(pg_catalog.btrim(p_evidence_type), ''), 'BANK_STATEMENT'),
      'evidence_ref', COALESCE(NULLIF(pg_catalog.btrim(p_evidence_ref), ''), NULLIF(pg_catalog.btrim(p_reference_no), ''), p_idempotency_key),
      'evidence_summary_fa', COALESCE(NULLIF(pg_catalog.btrim(p_evidence_summary_fa), ''), p_description),
      'compliance_flags', COALESCE(p_compliance_flags, '[]'::jsonb)
    ),
    'PENDING_HUMAN_APPROVAL',
    COALESCE(NULLIF(pg_catalog.btrim(p_agent_name), ''), 'muse.ai')
  )
  RETURNING id INTO v_approval_id;

  RETURN pg_catalog.jsonb_build_object(
    'created', true,
    'idempotent_replay', false,
    'voucher_id', v_voucher_id,
    'approval_id', v_approval_id,
    'status', 'DRAFT',
    'approval_status', 'PENDING_HUMAN_APPROVAL'
  );
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

  SELECT * INTO v_fy
  FROM public.fiscal_years
  WHERE id = v_voucher.fiscal_year_id
  FOR UPDATE;

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

REVOKE ALL ON FUNCTION private.fn_create_voucher_draft_atomic(uuid, public.voucher_type, date, character, text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_create_voucher_draft_atomic(uuid, public.voucher_type, date, character, text, text, text, text, jsonb, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_create_voucher_draft_atomic(uuid, public.voucher_type, date, character, text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_create_voucher_draft_atomic(uuid, public.voucher_type, date, character, text, text, text, text, jsonb, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.fn_create_voucher_atomic(uuid, public.voucher_type, public.voucher_status, date, character, text, text, public.creator_actor, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_voucher_atomic(uuid, public.voucher_type, public.voucher_status, date, character, text, text, public.creator_actor, text, jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.fn_update_draft_voucher(uuid, date, character, text, text, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_draft_voucher(uuid, date, character, text, text, text, jsonb, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.fn_create_agent_draft_voucher(uuid, date, character, text, text, text, text, text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.fn_create_agent_draft_voucher(uuid, date, character, text, text, text, text, text, text, text, text, jsonb, jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.fn_create_agent_draft_voucher(uuid, date, character, text, text, text, text, text, text, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_create_agent_draft_voucher(uuid, date, character, text, text, text, text, text, text, text, text, jsonb, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.fn_finalize_voucher(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_finalize_voucher(uuid) TO authenticated, service_role;

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
