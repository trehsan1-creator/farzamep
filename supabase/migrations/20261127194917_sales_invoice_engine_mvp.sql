
-- Farzam ERP MVP: commercial quotations, sales invoices, receipts and stock ledger.
-- Additive-only schema: existing imported Moadian invoices and accounting records are untouched.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS sale_price_rial bigint,
  ADD COLUMN IF NOT EXISTS vat_rate_pct numeric(5,2),
  ADD COLUMN IF NOT EXISTS track_inventory boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_sale_price_rial_nonnegative') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_sale_price_rial_nonnegative
      CHECK (sale_price_rial IS NULL OR sale_price_rial >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'products_vat_rate_pct_range') THEN
    ALTER TABLE public.products ADD CONSTRAINT products_vat_rate_pct_range
      CHECK (vat_rate_pct IS NULL OR (vat_rate_pct >= 0 AND vat_rate_pct <= 100));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.inventory_warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name_fa text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.inventory_warehouses (code, name_fa)
VALUES ('MAIN', 'انبار اصلی')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sales_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id IS TRUE),
  seller_name text NOT NULL DEFAULT '',
  seller_national_id text,
  seller_economic_code text,
  seller_registration_no text,
  seller_address text,
  seller_postal_code text,
  seller_phone text,
  seller_bank_name text,
  seller_iban text,
  default_vat_rate_pct numeric(5,2) NOT NULL DEFAULT 10.00
    CHECK (default_vat_rate_pct >= 0 AND default_vat_rate_pct <= 100),
  receivable_account_code text NOT NULL DEFAULT '1103',
  sales_account_code text NOT NULL DEFAULT '7101',
  vat_payable_account_code text NOT NULL DEFAULT '2107',
  cash_bank_account_code text NOT NULL DEFAULT '1100',
  default_bank_tafsil_id uuid REFERENCES public.tafsil_parties(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.tafsil_parties (
  tafsil_code, full_name, trade_name, party_type, legal_entity_type, iban, metadata, is_active
)
SELECT
  'B001',
  'صندوق و بانک اصلی',
  'بانک اقتصاد نوین — شعبه میرداماد',
  'BANK'::public.party_group,
  'حقوقی',
  'IR640550010281004419022001',
  jsonb_build_object(
    'system_default', true,
    'bank_name_fa', 'بانک اقتصاد نوین',
    'branch_fa', 'شعبه میرداماد',
    'account_kind', 'CASH_BANK'
  ),
  true
WHERE NOT EXISTS (
  SELECT 1 FROM public.tafsil_parties WHERE tafsil_code = 'B001'
);

INSERT INTO public.sales_settings (
  id, seller_name, seller_national_id, seller_economic_code, seller_registration_no,
  seller_address, seller_bank_name, seller_iban, default_vat_rate_pct,
  receivable_account_code, sales_account_code, vat_payable_account_code,
  cash_bank_account_code, default_bank_tafsil_id
)
SELECT
  true,
  'بازرگانی توسعه تجارت آتی فرزام ایرانیان',
  '14004313088',
  '411489325176',
  '459102',
  'تهران — میرداماد',
  'بانک اقتصاد نوین (شعبه میرداماد)',
  'IR640550010281004419022001',
  10.00,
  '1103',
  '7101',
  '2107',
  '1100',
  p.id
FROM public.tafsil_parties p
WHERE p.tafsil_code = 'B001'
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sales_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year_id uuid NOT NULL REFERENCES public.fiscal_years(id) ON DELETE RESTRICT,
  document_type text NOT NULL CHECK (document_type IN ('QUOTE', 'INVOICE')),
  document_no integer NOT NULL CHECK (document_no > 0),
  status text NOT NULL DEFAULT 'DRAFT',
  party_id uuid NOT NULL REFERENCES public.tafsil_parties(id) ON DELETE RESTRICT,
  source_quote_id uuid REFERENCES public.sales_documents(id) ON DELETE RESTRICT,
  warehouse_id uuid REFERENCES public.inventory_warehouses(id) ON DELETE RESTRICT,
  issue_date_gregorian date NOT NULL,
  issue_date_jalali character(10) NOT NULL,
  due_date_gregorian date,
  due_date_jalali character(10),
  valid_until_gregorian date,
  valid_until_jalali character(10),
  currency_code text NOT NULL DEFAULT 'IRR' CHECK (currency_code = 'IRR'),
  notes text,
  terms text,
  party_name_snapshot text NOT NULL,
  party_national_id_snapshot text,
  party_economic_code_snapshot text,
  party_address_snapshot text,
  party_postal_code_snapshot text,
  party_phone_snapshot text,
  seller_name_snapshot text NOT NULL DEFAULT '',
  seller_national_id_snapshot text,
  seller_economic_code_snapshot text,
  seller_registration_no_snapshot text,
  seller_address_snapshot text,
  seller_postal_code_snapshot text,
  seller_phone_snapshot text,
  seller_bank_name_snapshot text,
  seller_iban_snapshot text,
  subtotal_rial bigint NOT NULL DEFAULT 0 CHECK (subtotal_rial >= 0),
  discount_rial bigint NOT NULL DEFAULT 0 CHECK (discount_rial >= 0),
  tax_rial bigint NOT NULL DEFAULT 0 CHECK (tax_rial >= 0),
  total_rial bigint NOT NULL DEFAULT 0 CHECK (total_rial >= 0),
  paid_rial bigint NOT NULL DEFAULT 0 CHECK (paid_rial >= 0),
  balance_rial bigint NOT NULL DEFAULT 0 CHECK (balance_rial >= 0),
  voucher_id uuid REFERENCES public.vouchers(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_actor public.creator_actor NOT NULL DEFAULT 'HUMAN',
  issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_documents_number_unique UNIQUE (fiscal_year_id, document_type, document_no),
  CONSTRAINT sales_documents_paid_not_over_total CHECK (paid_rial <= total_rial),
  CONSTRAINT sales_documents_balance_consistent CHECK (balance_rial = total_rial - paid_rial),
  CONSTRAINT sales_documents_status_by_type CHECK (
    (document_type = 'QUOTE' AND status IN ('DRAFT','SENT','ACCEPTED','REJECTED','EXPIRED','CONVERTED','CANCELLED'))
    OR
    (document_type = 'INVOICE' AND status IN ('DRAFT','ISSUED','PARTIALLY_PAID','PAID','CANCELLED'))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_documents_source_quote_unique
  ON public.sales_documents(source_quote_id) WHERE source_quote_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS sales_documents_fy_date_idx
  ON public.sales_documents(fiscal_year_id, issue_date_gregorian DESC);
CREATE INDEX IF NOT EXISTS sales_documents_party_idx
  ON public.sales_documents(party_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_documents_status_idx
  ON public.sales_documents(fiscal_year_id, document_type, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.sales_document_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_document_id uuid NOT NULL REFERENCES public.sales_documents(id) ON DELETE CASCADE,
  line_no smallint NOT NULL CHECK (line_no > 0),
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_code_snapshot text,
  description text NOT NULL,
  unit_fa text NOT NULL DEFAULT 'عدد',
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit_price_rial bigint NOT NULL CHECK (unit_price_rial >= 0),
  discount_rial bigint NOT NULL DEFAULT 0 CHECK (discount_rial >= 0),
  is_vat_subject boolean NOT NULL DEFAULT true,
  vat_rate_pct numeric(5,2) NOT NULL DEFAULT 10.00 CHECK (vat_rate_pct >= 0 AND vat_rate_pct <= 100),
  line_subtotal_rial bigint NOT NULL CHECK (line_subtotal_rial >= 0),
  line_net_rial bigint NOT NULL CHECK (line_net_rial >= 0),
  vat_amount_rial bigint NOT NULL CHECK (vat_amount_rial >= 0),
  line_total_rial bigint NOT NULL CHECK (line_total_rial >= 0),
  track_inventory boolean NOT NULL DEFAULT false,
  CONSTRAINT sales_document_lines_number_unique UNIQUE (sales_document_id, line_no),
  CONSTRAINT sales_document_lines_discount_lte_subtotal CHECK (discount_rial <= line_subtotal_rial),
  CONSTRAINT sales_document_lines_math_check CHECK (
    line_net_rial = line_subtotal_rial - discount_rial
    AND line_total_rial = line_net_rial + vat_amount_rial
  )
);

CREATE INDEX IF NOT EXISTS sales_document_lines_product_idx
  ON public.sales_document_lines(product_id) WHERE product_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.sales_document_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_document_id uuid NOT NULL REFERENCES public.sales_documents(id) ON DELETE RESTRICT,
  fiscal_year_id uuid NOT NULL REFERENCES public.fiscal_years(id) ON DELETE RESTRICT,
  amount_rial bigint NOT NULL CHECK (amount_rial > 0),
  payment_date_gregorian date NOT NULL,
  payment_date_jalali character(10) NOT NULL,
  payment_method text NOT NULL CHECK (payment_method IN ('CASH','BANK_TRANSFER','CHEQUE','OTHER')),
  bank_tafsil_id uuid NOT NULL REFERENCES public.tafsil_parties(id) ON DELETE RESTRICT,
  bank_account_code text NOT NULL DEFAULT '1100',
  reference_no text,
  voucher_id uuid REFERENCES public.vouchers(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  recorded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_document_payments_document_idx
  ON public.sales_document_payments(sales_document_id, payment_date_gregorian DESC);

CREATE TABLE IF NOT EXISTS public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fiscal_year_id uuid NOT NULL REFERENCES public.fiscal_years(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL REFERENCES public.inventory_warehouses(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('OPENING','PURCHASE','SALE','ADJUSTMENT','RETURN')),
  quantity_delta numeric(18,3) NOT NULL CHECK (quantity_delta <> 0),
  unit_cost_rial bigint CHECK (unit_cost_rial IS NULL OR unit_cost_rial >= 0),
  source_document_id uuid REFERENCES public.sales_documents(id) ON DELETE RESTRICT,
  source_document_line_id uuid REFERENCES public.sales_document_lines(id) ON DELETE RESTRICT,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_movements_sales_line_unique
  ON public.inventory_movements(source_document_line_id)
  WHERE source_document_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_movements_stock_idx
  ON public.inventory_movements(warehouse_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_movements_fy_idx
  ON public.inventory_movements(fiscal_year_id, created_at DESC);

CREATE TABLE IF NOT EXISTS private.sales_document_sequences (
  fiscal_year_id uuid NOT NULL REFERENCES public.fiscal_years(id) ON DELETE RESTRICT,
  document_type text NOT NULL CHECK (document_type IN ('QUOTE','INVOICE')),
  last_number integer NOT NULL DEFAULT 0 CHECK (last_number >= 0),
  PRIMARY KEY (fiscal_year_id, document_type)
);

CREATE OR REPLACE VIEW public.inventory_stock
WITH (security_invoker = true)
AS
SELECT
  warehouse_id,
  product_id,
  COALESCE(sum(quantity_delta), 0)::numeric(18,3) AS quantity_on_hand
FROM public.inventory_movements
GROUP BY warehouse_id, product_id;

ALTER TABLE public.sales_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_document_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_document_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sales_settings_read_active ON public.sales_settings;
CREATE POLICY sales_settings_read_active ON public.sales_settings
  FOR SELECT TO authenticated
  USING (private.current_user_is_active());

DROP POLICY IF EXISTS sales_settings_update_admin ON public.sales_settings;
CREATE POLICY sales_settings_update_admin ON public.sales_settings
  FOR UPDATE TO authenticated
  USING (private.current_erp_role() IN ('ADMIN'::public.erp_role, 'SENIOR_ACCOUNTANT'::public.erp_role))
  WITH CHECK (private.current_erp_role() IN ('ADMIN'::public.erp_role, 'SENIOR_ACCOUNTANT'::public.erp_role));

DROP POLICY IF EXISTS sales_documents_read_active ON public.sales_documents;
CREATE POLICY sales_documents_read_active ON public.sales_documents
  FOR SELECT TO authenticated
  USING (private.current_user_is_active());

DROP POLICY IF EXISTS sales_document_lines_read_active ON public.sales_document_lines;
CREATE POLICY sales_document_lines_read_active ON public.sales_document_lines
  FOR SELECT TO authenticated
  USING (private.current_user_is_active());

DROP POLICY IF EXISTS sales_document_payments_read_active ON public.sales_document_payments;
CREATE POLICY sales_document_payments_read_active ON public.sales_document_payments
  FOR SELECT TO authenticated
  USING (private.current_user_is_active());

DROP POLICY IF EXISTS inventory_warehouses_read_active ON public.inventory_warehouses;
CREATE POLICY inventory_warehouses_read_active ON public.inventory_warehouses
  FOR SELECT TO authenticated
  USING (private.current_user_is_active());

DROP POLICY IF EXISTS inventory_movements_read_active ON public.inventory_movements;
CREATE POLICY inventory_movements_read_active ON public.inventory_movements
  FOR SELECT TO authenticated
  USING (private.current_user_is_active());

REVOKE ALL ON TABLE public.sales_settings, public.sales_documents, public.sales_document_lines,
  public.sales_document_payments, public.inventory_warehouses, public.inventory_movements,
  public.inventory_stock FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.sales_settings, public.sales_documents, public.sales_document_lines,
  public.sales_document_payments, public.inventory_warehouses, public.inventory_movements,
  public.inventory_stock TO authenticated, service_role;
GRANT UPDATE ON TABLE public.sales_settings TO authenticated, service_role;
GRANT SELECT, UPDATE ON TABLE public.products TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.fn_require_sales_writer()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role public.erp_role;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: ورود به سامانه الزامی است.';
  END IF;
  v_role := private.current_erp_role();
  IF v_role NOT IN ('ADMIN'::public.erp_role, 'SENIOR_ACCOUNTANT'::public.erp_role, 'ACCOUNTANT'::public.erp_role) THEN
    RAISE EXCEPTION 'FORBIDDEN: نقش کاربر مجاز به عملیات فروش نیست.';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private.fn_sales_normalize_lines(
  p_lines jsonb,
  p_default_vat_rate_pct numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_line jsonb;
  v_product public.products%ROWTYPE;
  v_product_id uuid;
  v_description text;
  v_unit text;
  v_quantity numeric(18,3);
  v_unit_price bigint;
  v_discount bigint;
  v_subtotal bigint;
  v_net bigint;
  v_vat bigint;
  v_total bigint;
  v_rate numeric(5,2);
  v_taxable boolean;
  v_line_no integer := 0;
  v_lines jsonb := '[]'::jsonb;
  v_subtotal_total numeric := 0;
  v_discount_total numeric := 0;
  v_vat_total numeric := 0;
  v_total_total numeric := 0;
  v_track_inventory boolean;
BEGIN
  IF p_lines IS NULL OR pg_catalog.jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_SALES_LINES: ردیف‌های فاکتور باید آرایه باشند.';
  END IF;
  IF pg_catalog.jsonb_array_length(p_lines) < 1 OR pg_catalog.jsonb_array_length(p_lines) > 100 THEN
    RAISE EXCEPTION 'INVALID_SALES_LINE_COUNT: فاکتور باید بین ۱ تا ۱۰۰ ردیف داشته باشد.';
  END IF;

  FOR v_line IN SELECT e.value FROM pg_catalog.jsonb_array_elements(p_lines) AS e(value)
  LOOP
    v_line_no := v_line_no + 1;
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_product := NULL;
    v_track_inventory := false;

    IF v_product_id IS NOT NULL THEN
      SELECT * INTO v_product
      FROM public.products
      WHERE id = v_product_id AND is_active = true;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'PRODUCT_NOT_FOUND: کالا یافت نشد یا غیرفعال است.';
      END IF;
      v_description := v_product.name_fa;
      v_unit := v_product.unit_fa;
      v_taxable := v_product.is_vat_subject;
      v_rate := CASE
        WHEN v_taxable THEN COALESCE(v_product.vat_rate_pct, p_default_vat_rate_pct)
        ELSE 0
      END;
      v_track_inventory := v_product.track_inventory;
    ELSE
      v_description := NULLIF(pg_catalog.btrim(v_line->>'description'), '');
      v_unit := COALESCE(NULLIF(pg_catalog.btrim(v_line->>'unit_fa'), ''), 'عدد');
      v_taxable := COALESCE(NULLIF(v_line->>'is_vat_subject', '')::boolean, true);
      v_rate := CASE
        WHEN v_taxable THEN COALESCE(NULLIF(v_line->>'vat_rate_pct', '')::numeric, p_default_vat_rate_pct)
        ELSE 0
      END;
    END IF;

    IF v_description IS NULL OR pg_catalog.btrim(v_description) = '' THEN
      RAISE EXCEPTION 'DESCRIPTION_REQUIRED: شرح کالا یا خدمت الزامی است.';
    END IF;

    v_quantity := COALESCE(NULLIF(v_line->>'quantity', '')::numeric, 0);
    IF v_quantity <= 0 OR v_quantity <> pg_catalog.round(v_quantity, 3) THEN
      RAISE EXCEPTION 'INVALID_QUANTITY: تعداد باید مثبت و حداکثر سه رقم اعشار داشته باشد.';
    END IF;

    v_unit_price := COALESCE(NULLIF(v_line->>'unit_price_rial', '')::bigint, v_product.sale_price_rial, 0);
    IF v_unit_price < 0 THEN
      RAISE EXCEPTION 'INVALID_UNIT_PRICE: قیمت واحد نمی‌تواند منفی باشد.';
    END IF;

    v_subtotal := pg_catalog.round(v_quantity * v_unit_price)::bigint;
    v_discount := COALESCE(NULLIF(v_line->>'discount_rial', '')::bigint, 0);
    IF v_discount < 0 OR v_discount > v_subtotal THEN
      RAISE EXCEPTION 'INVALID_DISCOUNT: تخفیف ردیف از مبلغ ناخالص ردیف بیشتر است.';
    END IF;

    IF v_rate < 0 OR v_rate > 100 THEN
      RAISE EXCEPTION 'INVALID_VAT_RATE: نرخ ارزش افزوده باید بین صفر تا صد باشد.';
    END IF;

    v_net := v_subtotal - v_discount;
    v_vat := CASE WHEN v_taxable THEN pg_catalog.round(v_net * v_rate / 100)::bigint ELSE 0 END;
    v_total := v_net + v_vat;

    v_subtotal_total := v_subtotal_total + v_subtotal;
    v_discount_total := v_discount_total + v_discount;
    v_vat_total := v_vat_total + v_vat;
    v_total_total := v_total_total + v_total;

    v_lines := v_lines || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'line_no', v_line_no,
        'product_id', v_product_id,
        'product_code_snapshot', CASE WHEN v_product_id IS NOT NULL THEN v_product.product_code ELSE NULL END,
        'description', v_description,
        'unit_fa', v_unit,
        'quantity', v_quantity,
        'unit_price_rial', v_unit_price,
        'discount_rial', v_discount,
        'is_vat_subject', v_taxable,
        'vat_rate_pct', v_rate,
        'line_subtotal_rial', v_subtotal,
        'line_net_rial', v_net,
        'vat_amount_rial', v_vat,
        'line_total_rial', v_total,
        'track_inventory', v_track_inventory
      )
    );
  END LOOP;

  IF v_total_total <= 0 THEN
    RAISE EXCEPTION 'ZERO_VALUE_DOCUMENT: مبلغ نهایی پیش‌فاکتور یا فاکتور باید بیشتر از صفر باشد.';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'lines', v_lines,
    'subtotal_rial', v_subtotal_total,
    'discount_rial', v_discount_total,
    'tax_rial', v_vat_total,
    'total_rial', v_total_total
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.fn_sales_insert_lines(
  p_document_id uuid,
  p_normalized jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.sales_document_lines (
    sales_document_id, line_no, product_id, product_code_snapshot, description, unit_fa,
    quantity, unit_price_rial, discount_rial, is_vat_subject, vat_rate_pct,
    line_subtotal_rial, line_net_rial, vat_amount_rial, line_total_rial, track_inventory
  )
  SELECT
    p_document_id,
    (e.value->>'line_no')::smallint,
    NULLIF(e.value->>'product_id', '')::uuid,
    NULLIF(e.value->>'product_code_snapshot', ''),
    e.value->>'description',
    e.value->>'unit_fa',
    (e.value->>'quantity')::numeric(18,3),
    (e.value->>'unit_price_rial')::bigint,
    (e.value->>'discount_rial')::bigint,
    (e.value->>'is_vat_subject')::boolean,
    (e.value->>'vat_rate_pct')::numeric(5,2),
    (e.value->>'line_subtotal_rial')::bigint,
    (e.value->>'line_net_rial')::bigint,
    (e.value->>'vat_amount_rial')::bigint,
    (e.value->>'line_total_rial')::bigint,
    (e.value->>'track_inventory')::boolean
  FROM pg_catalog.jsonb_array_elements(p_normalized->'lines') AS e(value);
END;
$function$;

CREATE OR REPLACE FUNCTION private.fn_create_sales_document_internal(
  p_fiscal_year_id uuid,
  p_document_type text,
  p_party_id uuid,
  p_issue_date_gregorian date,
  p_issue_date_jalali text,
  p_due_date_gregorian date,
  p_due_date_jalali text,
  p_valid_until_gregorian date,
  p_valid_until_jalali text,
  p_notes text,
  p_terms text,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_idempotency_key text,
  p_actor public.creator_actor
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role public.erp_role;
  v_request_role text;
  v_fy public.fiscal_years%ROWTYPE;
  v_party public.tafsil_parties%ROWTYPE;
  v_settings public.sales_settings%ROWTYPE;
  v_existing public.sales_documents%ROWTYPE;
  v_normalized jsonb;
  v_document_id uuid;
  v_document_no integer;
BEGIN
  IF p_actor = 'AI_AGENT'::public.creator_actor THEN
    v_request_role := COALESCE(
      NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
      NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb->>'role'
    );
    IF v_request_role <> 'service_role' THEN
      RAISE EXCEPTION 'AGENT_SERVICE_ROLE_REQUIRED: ثبت پیش‌نویس عامل فقط از درگاه امن Agent مجاز است.';
    END IF;
  ELSE
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'AUTH_REQUIRED: ورود به سامانه الزامی است.';
    END IF;
    v_role := private.current_erp_role();
    IF v_role NOT IN ('ADMIN'::public.erp_role, 'SENIOR_ACCOUNTANT'::public.erp_role, 'ACCOUNTANT'::public.erp_role) THEN
      RAISE EXCEPTION 'FORBIDDEN: نقش کاربر مجاز به ثبت سند فروش نیست.';
    END IF;
  END IF;

  IF p_document_type NOT IN ('QUOTE','INVOICE') THEN
    RAISE EXCEPTION 'INVALID_DOCUMENT_TYPE: نوع سند باید پیش‌فاکتور یا فاکتور فروش باشد.';
  END IF;
  IF p_fiscal_year_id IS NULL OR p_party_id IS NULL OR p_issue_date_gregorian IS NULL
     OR NULLIF(pg_catalog.btrim(p_issue_date_jalali), '') IS NULL THEN
    RAISE EXCEPTION 'REQUIRED_FIELDS: سال مالی، مشتری و تاریخ سند الزامی است.';
  END IF;
  IF p_idempotency_key IS NULL OR pg_catalog.length(pg_catalog.btrim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_REQUIRED: کلید یکتای عملیات معتبر نیست.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('farzam:sales-document:' || pg_catalog.btrim(p_idempotency_key), 0)
  );

  SELECT * INTO v_existing
  FROM public.sales_documents
  WHERE idempotency_key = pg_catalog.btrim(p_idempotency_key)
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.fiscal_year_id <> p_fiscal_year_id OR v_existing.document_type <> p_document_type THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: این کلید قبلاً برای سند دیگری استفاده شده است.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'created', false, 'idempotent_replay', true, 'document_id', v_existing.id,
      'document_type', v_existing.document_type, 'document_no', v_existing.document_no,
      'status', v_existing.status, 'total_rial', v_existing.total_rial
    );
  END IF;

  SELECT * INTO v_fy FROM public.fiscal_years WHERE id = p_fiscal_year_id FOR UPDATE;
  IF NOT FOUND OR v_fy.is_closed THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی معتبر نیست یا بسته شده است.';
  END IF;
  IF p_issue_date_gregorian < v_fy.start_date OR p_issue_date_gregorian > v_fy.end_date THEN
    RAISE EXCEPTION 'DATE_OUT_OF_BOUNDS: تاریخ سند خارج از بازه سال مالی انتخاب‌شده است.';
  END IF;

  SELECT * INTO v_party
  FROM public.tafsil_parties
  WHERE id = p_party_id AND is_active = true AND party_type = 'CUSTOMER'::public.party_group;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND: طرف حساب انتخاب‌شده مشتری فعال نیست.';
  END IF;

  SELECT * INTO v_settings FROM public.sales_settings WHERE id = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SALES_SETTINGS_MISSING: تنظیمات فروش هنوز ایجاد نشده است.';
  END IF;

  IF p_warehouse_id IS NOT NULL THEN
    PERFORM 1 FROM public.inventory_warehouses WHERE id = p_warehouse_id AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'WAREHOUSE_NOT_FOUND: انبار انتخاب‌شده معتبر یا فعال نیست.';
    END IF;
  END IF;

  v_normalized := private.fn_sales_normalize_lines(p_lines, v_settings.default_vat_rate_pct);

  INSERT INTO private.sales_document_sequences (fiscal_year_id, document_type, last_number)
  VALUES (p_fiscal_year_id, p_document_type, 1)
  ON CONFLICT (fiscal_year_id, document_type)
  DO UPDATE SET last_number = private.sales_document_sequences.last_number + 1
  RETURNING last_number INTO v_document_no;

  INSERT INTO public.sales_documents (
    fiscal_year_id, document_type, document_no, status, party_id, warehouse_id,
    issue_date_gregorian, issue_date_jalali, due_date_gregorian, due_date_jalali,
    valid_until_gregorian, valid_until_jalali, notes, terms,
    party_name_snapshot, party_national_id_snapshot, party_economic_code_snapshot,
    party_address_snapshot, party_postal_code_snapshot, party_phone_snapshot,
    seller_name_snapshot, seller_national_id_snapshot, seller_economic_code_snapshot,
    seller_registration_no_snapshot, seller_address_snapshot, seller_postal_code_snapshot,
    seller_phone_snapshot, seller_bank_name_snapshot, seller_iban_snapshot,
    subtotal_rial, discount_rial, tax_rial, total_rial, paid_rial, balance_rial,
    idempotency_key, created_by, created_by_actor
  )
  VALUES (
    p_fiscal_year_id, p_document_type, v_document_no, 'DRAFT', p_party_id, p_warehouse_id,
    p_issue_date_gregorian, p_issue_date_jalali, p_due_date_gregorian, p_due_date_jalali,
    p_valid_until_gregorian, p_valid_until_jalali, NULLIF(pg_catalog.btrim(p_notes), ''),
    NULLIF(pg_catalog.btrim(p_terms), ''),
    v_party.full_name, v_party.national_id, v_party.economic_code,
    COALESCE(v_party.metadata->>'address', v_party.metadata->>'address_fa'),
    COALESCE(v_party.metadata->>'postal_code', v_party.metadata->>'postal_code_fa'),
    COALESCE(v_party.metadata->>'phone', v_party.metadata->>'mobile'),
    v_settings.seller_name, v_settings.seller_national_id, v_settings.seller_economic_code,
    v_settings.seller_registration_no, v_settings.seller_address, v_settings.seller_postal_code,
    v_settings.seller_phone, v_settings.seller_bank_name, v_settings.seller_iban,
    (v_normalized->>'subtotal_rial')::bigint,
    (v_normalized->>'discount_rial')::bigint,
    (v_normalized->>'tax_rial')::bigint,
    (v_normalized->>'total_rial')::bigint,
    0,
    (v_normalized->>'total_rial')::bigint,
    pg_catalog.btrim(p_idempotency_key),
    auth.uid(),
    p_actor
  )
  RETURNING id INTO v_document_id;

  PERFORM private.fn_sales_insert_lines(v_document_id, v_normalized);

  RETURN pg_catalog.jsonb_build_object(
    'created', true, 'idempotent_replay', false, 'document_id', v_document_id,
    'document_type', p_document_type, 'document_no', v_document_no, 'status', 'DRAFT',
    'subtotal_rial', (v_normalized->>'subtotal_rial')::bigint,
    'discount_rial', (v_normalized->>'discount_rial')::bigint,
    'tax_rial', (v_normalized->>'tax_rial')::bigint,
    'total_rial', (v_normalized->>'total_rial')::bigint
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_create_sales_document(
  p_fiscal_year_id uuid,
  p_document_type text,
  p_party_id uuid,
  p_issue_date_gregorian date,
  p_issue_date_jalali text,
  p_due_date_gregorian date,
  p_due_date_jalali text,
  p_valid_until_gregorian date,
  p_valid_until_jalali text,
  p_notes text,
  p_terms text,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.fn_create_sales_document_internal(
    p_fiscal_year_id, p_document_type, p_party_id, p_issue_date_gregorian, p_issue_date_jalali,
    p_due_date_gregorian, p_due_date_jalali, p_valid_until_gregorian, p_valid_until_jalali,
    p_notes, p_terms, p_warehouse_id, p_lines, p_idempotency_key, 'HUMAN'::public.creator_actor
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_agent_create_sales_document(
  p_fiscal_year_id uuid,
  p_document_type text,
  p_party_id uuid,
  p_issue_date_gregorian date,
  p_issue_date_jalali text,
  p_due_date_gregorian date,
  p_due_date_jalali text,
  p_valid_until_gregorian date,
  p_valid_until_jalali text,
  p_notes text,
  p_terms text,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.fn_create_sales_document_internal(
    p_fiscal_year_id, p_document_type, p_party_id, p_issue_date_gregorian, p_issue_date_jalali,
    p_due_date_gregorian, p_due_date_jalali, p_valid_until_gregorian, p_valid_until_jalali,
    p_notes, p_terms, p_warehouse_id, p_lines, p_idempotency_key, 'AI_AGENT'::public.creator_actor
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_update_sales_document_draft(
  p_document_id uuid,
  p_party_id uuid,
  p_issue_date_gregorian date,
  p_issue_date_jalali text,
  p_due_date_gregorian date,
  p_due_date_jalali text,
  p_valid_until_gregorian date,
  p_valid_until_jalali text,
  p_notes text,
  p_terms text,
  p_warehouse_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_doc public.sales_documents%ROWTYPE;
  v_party public.tafsil_parties%ROWTYPE;
  v_settings public.sales_settings%ROWTYPE;
  v_fy public.fiscal_years%ROWTYPE;
  v_normalized jsonb;
BEGIN
  PERFORM private.fn_require_sales_writer();
  SELECT * INTO v_doc FROM public.sales_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'DRAFT_ONLY: فقط پیش‌نویس قابل ویرایش است.';
  END IF;

  SELECT * INTO v_fy FROM public.fiscal_years WHERE id = v_doc.fiscal_year_id;
  IF NOT FOUND OR v_fy.is_closed THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی بسته شده است.';
  END IF;
  IF p_issue_date_gregorian IS NULL OR p_issue_date_gregorian < v_fy.start_date OR p_issue_date_gregorian > v_fy.end_date THEN
    RAISE EXCEPTION 'DATE_OUT_OF_BOUNDS: تاریخ سند خارج از بازه سال مالی است.';
  END IF;

  SELECT * INTO v_party FROM public.tafsil_parties
  WHERE id = p_party_id AND is_active = true AND party_type = 'CUSTOMER'::public.party_group;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CUSTOMER_NOT_FOUND: مشتری فعال انتخاب نشده است.';
  END IF;

  SELECT * INTO v_settings FROM public.sales_settings WHERE id = true;
  v_normalized := private.fn_sales_normalize_lines(p_lines, v_settings.default_vat_rate_pct);

  UPDATE public.sales_documents SET
    party_id = p_party_id,
    issue_date_gregorian = p_issue_date_gregorian,
    issue_date_jalali = p_issue_date_jalali,
    due_date_gregorian = p_due_date_gregorian,
    due_date_jalali = p_due_date_jalali,
    valid_until_gregorian = p_valid_until_gregorian,
    valid_until_jalali = p_valid_until_jalali,
    warehouse_id = p_warehouse_id,
    notes = NULLIF(pg_catalog.btrim(p_notes), ''),
    terms = NULLIF(pg_catalog.btrim(p_terms), ''),
    party_name_snapshot = v_party.full_name,
    party_national_id_snapshot = v_party.national_id,
    party_economic_code_snapshot = v_party.economic_code,
    party_address_snapshot = COALESCE(v_party.metadata->>'address', v_party.metadata->>'address_fa'),
    party_postal_code_snapshot = COALESCE(v_party.metadata->>'postal_code', v_party.metadata->>'postal_code_fa'),
    party_phone_snapshot = COALESCE(v_party.metadata->>'phone', v_party.metadata->>'mobile'),
    seller_name_snapshot = v_settings.seller_name,
    seller_national_id_snapshot = v_settings.seller_national_id,
    seller_economic_code_snapshot = v_settings.seller_economic_code,
    seller_registration_no_snapshot = v_settings.seller_registration_no,
    seller_address_snapshot = v_settings.seller_address,
    seller_postal_code_snapshot = v_settings.seller_postal_code,
    seller_phone_snapshot = v_settings.seller_phone,
    seller_bank_name_snapshot = v_settings.seller_bank_name,
    seller_iban_snapshot = v_settings.seller_iban,
    subtotal_rial = (v_normalized->>'subtotal_rial')::bigint,
    discount_rial = (v_normalized->>'discount_rial')::bigint,
    tax_rial = (v_normalized->>'tax_rial')::bigint,
    total_rial = (v_normalized->>'total_rial')::bigint,
    balance_rial = (v_normalized->>'total_rial')::bigint,
    updated_at = now()
  WHERE id = p_document_id;

  DELETE FROM public.sales_document_lines WHERE sales_document_id = p_document_id;
  PERFORM private.fn_sales_insert_lines(p_document_id, v_normalized);

  RETURN pg_catalog.jsonb_build_object(
    'updated', true, 'document_id', p_document_id, 'document_no', v_doc.document_no,
    'subtotal_rial', (v_normalized->>'subtotal_rial')::bigint,
    'tax_rial', (v_normalized->>'tax_rial')::bigint,
    'total_rial', (v_normalized->>'total_rial')::bigint
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_send_sales_quote(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_doc public.sales_documents%ROWTYPE;
BEGIN
  PERFORM private.fn_require_sales_writer();
  SELECT * INTO v_doc FROM public.sales_documents WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR v_doc.document_type <> 'QUOTE' OR v_doc.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'QUOTE_NOT_DRAFT: فقط پیش‌فاکتور پیش‌نویس قابل ارسال است.';
  END IF;
  UPDATE public.sales_documents SET status = 'SENT', updated_at = now() WHERE id = p_quote_id;
  RETURN pg_catalog.jsonb_build_object('sent', true, 'document_id', p_quote_id, 'document_no', v_doc.document_no);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_accept_sales_quote(p_quote_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_doc public.sales_documents%ROWTYPE;
BEGIN
  PERFORM private.fn_require_sales_writer();
  SELECT * INTO v_doc FROM public.sales_documents WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR v_doc.document_type <> 'QUOTE' OR v_doc.status <> 'SENT' THEN
    RAISE EXCEPTION 'QUOTE_NOT_SENT: فقط پیش‌فاکتور ارسال‌شده قابل تأیید است.';
  END IF;
  UPDATE public.sales_documents SET status = 'ACCEPTED', updated_at = now() WHERE id = p_quote_id;
  RETURN pg_catalog.jsonb_build_object('accepted', true, 'document_id', p_quote_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_convert_sales_quote_to_invoice(
  p_quote_id uuid,
  p_issue_date_gregorian date,
  p_issue_date_jalali text,
  p_due_date_gregorian date,
  p_due_date_jalali text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_quote public.sales_documents%ROWTYPE;
  v_fy public.fiscal_years%ROWTYPE;
  v_invoice_id uuid;
  v_invoice_no integer;
BEGIN
  PERFORM private.fn_require_sales_writer();
  SELECT * INTO v_quote FROM public.sales_documents WHERE id = p_quote_id FOR UPDATE;
  IF NOT FOUND OR v_quote.document_type <> 'QUOTE' OR v_quote.status <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'QUOTE_NOT_ACCEPTED: فقط پیش‌فاکتور تأییدشده قابل تبدیل به فاکتور است.';
  END IF;
  SELECT * INTO v_fy FROM public.fiscal_years WHERE id = v_quote.fiscal_year_id FOR UPDATE;
  IF NOT FOUND OR v_fy.is_closed THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی بسته شده است.';
  END IF;
  IF p_issue_date_gregorian IS NULL OR p_issue_date_gregorian < v_fy.start_date OR p_issue_date_gregorian > v_fy.end_date THEN
    RAISE EXCEPTION 'DATE_OUT_OF_BOUNDS: تاریخ فاکتور خارج از بازه سال مالی است.';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_REQUIRED: کلید یکتای تبدیل معتبر نیست.';
  END IF;

  SELECT id INTO v_invoice_id FROM public.sales_documents WHERE source_quote_id = p_quote_id;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('created', false, 'idempotent_replay', true, 'document_id', v_invoice_id);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('farzam:sales-document:' || btrim(p_idempotency_key), 0)
  );
  SELECT id INTO v_invoice_id FROM public.sales_documents WHERE idempotency_key = btrim(p_idempotency_key);
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('created', false, 'idempotent_replay', true, 'document_id', v_invoice_id);
  END IF;

  INSERT INTO private.sales_document_sequences (fiscal_year_id, document_type, last_number)
  VALUES (v_quote.fiscal_year_id, 'INVOICE', 1)
  ON CONFLICT (fiscal_year_id, document_type)
  DO UPDATE SET last_number = private.sales_document_sequences.last_number + 1
  RETURNING last_number INTO v_invoice_no;

  INSERT INTO public.sales_documents (
    fiscal_year_id, document_type, document_no, status, party_id, source_quote_id, warehouse_id,
    issue_date_gregorian, issue_date_jalali, due_date_gregorian, due_date_jalali,
    currency_code, notes, terms,
    party_name_snapshot, party_national_id_snapshot, party_economic_code_snapshot,
    party_address_snapshot, party_postal_code_snapshot, party_phone_snapshot,
    seller_name_snapshot, seller_national_id_snapshot, seller_economic_code_snapshot,
    seller_registration_no_snapshot, seller_address_snapshot, seller_postal_code_snapshot,
    seller_phone_snapshot, seller_bank_name_snapshot, seller_iban_snapshot,
    subtotal_rial, discount_rial, tax_rial, total_rial, paid_rial, balance_rial,
    idempotency_key, created_by, created_by_actor
  )
  VALUES (
    v_quote.fiscal_year_id, 'INVOICE', v_invoice_no, 'DRAFT', v_quote.party_id, v_quote.id, v_quote.warehouse_id,
    p_issue_date_gregorian, p_issue_date_jalali, p_due_date_gregorian, p_due_date_jalali,
    v_quote.currency_code, v_quote.notes, v_quote.terms,
    v_quote.party_name_snapshot, v_quote.party_national_id_snapshot, v_quote.party_economic_code_snapshot,
    v_quote.party_address_snapshot, v_quote.party_postal_code_snapshot, v_quote.party_phone_snapshot,
    v_quote.seller_name_snapshot, v_quote.seller_national_id_snapshot, v_quote.seller_economic_code_snapshot,
    v_quote.seller_registration_no_snapshot, v_quote.seller_address_snapshot, v_quote.seller_postal_code_snapshot,
    v_quote.seller_phone_snapshot, v_quote.seller_bank_name_snapshot, v_quote.seller_iban_snapshot,
    v_quote.subtotal_rial, v_quote.discount_rial, v_quote.tax_rial, v_quote.total_rial, 0, v_quote.total_rial,
    btrim(p_idempotency_key), auth.uid(), 'HUMAN'::public.creator_actor
  )
  RETURNING id INTO v_invoice_id;

  INSERT INTO public.sales_document_lines (
    sales_document_id, line_no, product_id, product_code_snapshot, description, unit_fa,
    quantity, unit_price_rial, discount_rial, is_vat_subject, vat_rate_pct,
    line_subtotal_rial, line_net_rial, vat_amount_rial, line_total_rial, track_inventory
  )
  SELECT
    v_invoice_id, line_no, product_id, product_code_snapshot, description, unit_fa,
    quantity, unit_price_rial, discount_rial, is_vat_subject, vat_rate_pct,
    line_subtotal_rial, line_net_rial, vat_amount_rial, line_total_rial, track_inventory
  FROM public.sales_document_lines
  WHERE sales_document_id = p_quote_id;

  UPDATE public.sales_documents SET status = 'CONVERTED', updated_at = now() WHERE id = p_quote_id;

  RETURN pg_catalog.jsonb_build_object(
    'created', true, 'document_id', v_invoice_id, 'document_no', v_invoice_no,
    'source_quote_id', p_quote_id, 'status', 'DRAFT', 'total_rial', v_quote.total_rial
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_issue_sales_invoice(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_doc public.sales_documents%ROWTYPE;
  v_fy public.fiscal_years%ROWTYPE;
  v_settings public.sales_settings%ROWTYPE;
  v_line record;
  v_available numeric(18,3);
  v_voucher_lines jsonb;
  v_voucher_result jsonb;
  v_voucher_id uuid;
  v_reference text;
BEGIN
  PERFORM private.fn_require_sales_writer();
  SELECT * INTO v_doc FROM public.sales_documents WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_doc.document_type <> 'INVOICE' THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND: فاکتور فروش یافت نشد.';
  END IF;
  IF v_doc.status = 'ISSUED' OR v_doc.status = 'PARTIALLY_PAID' OR v_doc.status = 'PAID' THEN
    RETURN pg_catalog.jsonb_build_object(
      'issued', true, 'idempotent_replay', true, 'document_id', v_doc.id,
      'document_no', v_doc.document_no, 'voucher_id', v_doc.voucher_id
    );
  END IF;
  IF v_doc.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'INVOICE_NOT_DRAFT: فقط پیش‌نویس فاکتور قابل صدور است.';
  END IF;

  SELECT * INTO v_fy FROM public.fiscal_years WHERE id = v_doc.fiscal_year_id;
  IF NOT FOUND OR v_fy.is_closed THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی بسته شده است.';
  END IF;
  SELECT * INTO v_settings FROM public.sales_settings WHERE id = true;

  v_voucher_lines := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'account_code', v_settings.receivable_account_code,
      'tafsil_id', v_doc.party_id::text,
      'debit_rial', v_doc.total_rial,
      'credit_rial', 0,
      'line_description', 'بدهکار — ' || v_doc.party_name_snapshot || ' بابت فاکتور فروش'
    ),
    pg_catalog.jsonb_build_object(
      'account_code', v_settings.sales_account_code,
      'tafsil_id', v_doc.party_id::text,
      'debit_rial', 0,
      'credit_rial', v_doc.subtotal_rial - v_doc.discount_rial,
      'line_description', 'درآمد فروش — فاکتور شماره ' || v_doc.document_no
    )
  );

  IF v_doc.tax_rial > 0 THEN
    v_voucher_lines := v_voucher_lines || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'account_code', v_settings.vat_payable_account_code,
        'debit_rial', 0,
        'credit_rial', v_doc.tax_rial,
        'line_description', 'مالیات و عوارض ارزش افزوده فروش'
      )
    );
  END IF;

  v_reference := 'S-' || (SELECT code FROM public.fiscal_years WHERE id = v_doc.fiscal_year_id) || '-' || lpad(v_doc.document_no::text, 6, '0');
  v_voucher_result := private.fn_create_voucher_draft_atomic(
    v_doc.fiscal_year_id,
    'GENERAL'::public.voucher_type,
    v_doc.issue_date_gregorian,
    v_doc.issue_date_jalali,
    'ثبت حسابداری فاکتور فروش ' || v_reference,
    v_reference,
    'sales-invoice:' || v_doc.id::text,
    'UNCHECKED',
    '[]'::jsonb,
    v_voucher_lines
  );
  v_voucher_id := NULLIF(v_voucher_result->>'voucher_id', '')::uuid;
  IF v_voucher_id IS NULL THEN
    RAISE EXCEPTION 'VOUCHER_CREATE_FAILED: سند حسابداری فاکتور ساخته نشد.';
  END IF;

  FOR v_line IN
    SELECT * FROM public.sales_document_lines
    WHERE sales_document_id = v_doc.id AND track_inventory = true
    ORDER BY line_no
  LOOP
    IF v_doc.warehouse_id IS NULL THEN
      RAISE EXCEPTION 'WAREHOUSE_REQUIRED: برای فروش کالای انبارگردانی‌شونده باید انبار انتخاب شود.';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_doc.warehouse_id::text || ':' || v_line.product_id::text, 0)
    );

    SELECT COALESCE(sum(quantity_delta), 0)
    INTO v_available
    FROM public.inventory_movements
    WHERE warehouse_id = v_doc.warehouse_id AND product_id = v_line.product_id;

    IF v_available < v_line.quantity THEN
      RAISE EXCEPTION 'INSUFFICIENT_STOCK: موجودی کالا % کافی نیست؛ موجودی % و مقدار فروش % است.',
        v_line.description, v_available, v_line.quantity;
    END IF;

    INSERT INTO public.inventory_movements (
      fiscal_year_id, warehouse_id, product_id, movement_type, quantity_delta,
      source_document_id, source_document_line_id, note, created_by
    )
    VALUES (
      v_doc.fiscal_year_id, v_doc.warehouse_id, v_line.product_id, 'SALE', -v_line.quantity,
      v_doc.id, v_line.id, 'خروج کالا بابت فاکتور فروش شماره ' || v_doc.document_no, auth.uid()
    );
  END LOOP;

  UPDATE public.sales_documents
  SET status = 'ISSUED', voucher_id = v_voucher_id, issued_at = now(), updated_at = now()
  WHERE id = v_doc.id;

  RETURN pg_catalog.jsonb_build_object(
    'issued', true, 'document_id', v_doc.id, 'document_no', v_doc.document_no,
    'voucher_id', v_voucher_id, 'voucher_status', 'DRAFT', 'inventory_posted', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_record_sales_payment(
  p_invoice_id uuid,
  p_amount_rial bigint,
  p_payment_date_gregorian date,
  p_payment_date_jalali text,
  p_payment_method text,
  p_bank_tafsil_id uuid,
  p_reference_no text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_doc public.sales_documents%ROWTYPE;
  v_fy public.fiscal_years%ROWTYPE;
  v_bank public.tafsil_parties%ROWTYPE;
  v_settings public.sales_settings%ROWTYPE;
  v_existing public.sales_document_payments%ROWTYPE;
  v_voucher_result jsonb;
  v_voucher_id uuid;
  v_payment_id uuid;
  v_new_paid bigint;
  v_new_balance bigint;
  v_new_status text;
  v_payment_key text;
BEGIN
  PERFORM private.fn_require_sales_writer();

  IF p_amount_rial IS NULL OR p_amount_rial <= 0 THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_AMOUNT: مبلغ دریافتی باید بیشتر از صفر باشد.';
  END IF;
  IF p_payment_method NOT IN ('CASH','BANK_TRANSFER','CHEQUE','OTHER') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD: روش دریافت معتبر نیست.';
  END IF;
  IF p_idempotency_key IS NULL OR length(btrim(p_idempotency_key)) < 8 THEN
    RAISE EXCEPTION 'IDEMPOTENCY_REQUIRED: کلید یکتای دریافت معتبر نیست.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('farzam:sales-payment:' || btrim(p_idempotency_key), 0)
  );

  SELECT * INTO v_existing
  FROM public.sales_document_payments
  WHERE idempotency_key = btrim(p_idempotency_key)
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.sales_document_id <> p_invoice_id THEN
      RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: این کلید قبلاً برای فاکتور دیگری استفاده شده است.';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'recorded', false, 'idempotent_replay', true, 'payment_id', v_existing.id,
      'voucher_id', v_existing.voucher_id, 'amount_rial', v_existing.amount_rial
    );
  END IF;

  SELECT * INTO v_doc FROM public.sales_documents WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_doc.document_type <> 'INVOICE' OR v_doc.status NOT IN ('ISSUED','PARTIALLY_PAID') THEN
    RAISE EXCEPTION 'INVOICE_NOT_RECEIVABLE: فقط فاکتور صادرشده و تسویه‌نشده قابل دریافت وجه است.';
  END IF;
  IF p_amount_rial > v_doc.balance_rial THEN
    RAISE EXCEPTION 'OVERPAYMENT: مبلغ دریافتی از مانده فاکتور بیشتر است.';
  END IF;

  SELECT * INTO v_fy FROM public.fiscal_years WHERE id = v_doc.fiscal_year_id;
  IF NOT FOUND OR v_fy.is_closed THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی فاکتور بسته شده است.';
  END IF;
  IF p_payment_date_gregorian IS NULL OR p_payment_date_gregorian < v_fy.start_date OR p_payment_date_gregorian > v_fy.end_date THEN
    RAISE EXCEPTION 'DATE_OUT_OF_BOUNDS: تاریخ دریافت خارج از بازه سال مالی فاکتور است.';
  END IF;

  SELECT * INTO v_settings FROM public.sales_settings WHERE id = true;
  SELECT * INTO v_bank
  FROM public.tafsil_parties
  WHERE id = COALESCE(p_bank_tafsil_id, v_settings.default_bank_tafsil_id)
    AND is_active = true AND party_type = 'BANK'::public.party_group;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BANK_ACCOUNT_REQUIRED: صندوق یا حساب بانکی معتبر انتخاب نشده است.';
  END IF;

  v_payment_key := 'sales-payment:' || btrim(p_idempotency_key);
  v_voucher_result := private.fn_create_voucher_draft_atomic(
    v_doc.fiscal_year_id,
    'GENERAL'::public.voucher_type,
    p_payment_date_gregorian,
    p_payment_date_jalali,
    'ثبت دریافت فاکتور فروش ' || v_doc.document_no,
    NULLIF(btrim(p_reference_no), ''),
    v_payment_key,
    'UNCHECKED',
    '[]'::jsonb,
    pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'account_code', v_settings.cash_bank_account_code,
        'tafsil_id', v_bank.id::text,
        'debit_rial', p_amount_rial,
        'credit_rial', 0,
        'line_description', 'دریافت وجه — ' || v_bank.full_name
      ),
      pg_catalog.jsonb_build_object(
        'account_code', v_settings.receivable_account_code,
        'tafsil_id', v_doc.party_id::text,
        'debit_rial', 0,
        'credit_rial', p_amount_rial,
        'line_description', 'کاهش مطالبات — ' || v_doc.party_name_snapshot
      )
    )
  );
  v_voucher_id := NULLIF(v_voucher_result->>'voucher_id', '')::uuid;
  IF v_voucher_id IS NULL THEN
    RAISE EXCEPTION 'PAYMENT_VOUCHER_FAILED: سند حسابداری دریافت ساخته نشد.';
  END IF;

  INSERT INTO public.sales_document_payments (
    sales_document_id, fiscal_year_id, amount_rial, payment_date_gregorian,
    payment_date_jalali, payment_method, bank_tafsil_id, bank_account_code,
    reference_no, voucher_id, idempotency_key, recorded_by
  )
  VALUES (
    v_doc.id, v_doc.fiscal_year_id, p_amount_rial, p_payment_date_gregorian,
    p_payment_date_jalali, p_payment_method, v_bank.id, v_settings.cash_bank_account_code,
    NULLIF(btrim(p_reference_no), ''), v_voucher_id, btrim(p_idempotency_key), auth.uid()
  )
  RETURNING id INTO v_payment_id;

  v_new_paid := v_doc.paid_rial + p_amount_rial;
  v_new_balance := v_doc.total_rial - v_new_paid;
  v_new_status := CASE WHEN v_new_balance = 0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END;

  UPDATE public.sales_documents
  SET paid_rial = v_new_paid, balance_rial = v_new_balance,
      status = v_new_status, updated_at = now()
  WHERE id = v_doc.id;

  RETURN pg_catalog.jsonb_build_object(
    'recorded', true, 'payment_id', v_payment_id, 'voucher_id', v_voucher_id,
    'amount_rial', p_amount_rial, 'paid_rial', v_new_paid,
    'balance_rial', v_new_balance, 'invoice_status', v_new_status,
    'voucher_status', 'DRAFT'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_adjust_inventory(
  p_fiscal_year_id uuid,
  p_warehouse_id uuid,
  p_product_id uuid,
  p_quantity_delta numeric,
  p_movement_type text,
  p_unit_cost_rial bigint,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_fy public.fiscal_years%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_available numeric(18,3);
  v_new numeric(18,3);
  v_movement_id uuid;
BEGIN
  PERFORM private.fn_require_sales_writer();
  IF p_quantity_delta IS NULL OR p_quantity_delta = 0 OR p_quantity_delta <> pg_catalog.round(p_quantity_delta, 3) THEN
    RAISE EXCEPTION 'INVALID_QUANTITY: مقدار ورود یا خروج باید غیرصفر و حداکثر سه رقم اعشار باشد.';
  END IF;
  IF p_movement_type NOT IN ('OPENING','ADJUSTMENT') THEN
    RAISE EXCEPTION 'INVALID_MOVEMENT_TYPE: فقط موجودی اول دوره یا اصلاح موجودی از این مسیر مجاز است.';
  END IF;
  IF NULLIF(pg_catalog.btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'INVENTORY_NOTE_REQUIRED: دلیل ثبت یا اصلاح موجودی الزامی است.';
  END IF;

  SELECT * INTO v_fy FROM public.fiscal_years WHERE id = p_fiscal_year_id;
  IF NOT FOUND OR v_fy.is_closed THEN
    RAISE EXCEPTION 'FISCAL_YEAR_LOCKED: سال مالی معتبر نیست یا بسته شده است.';
  END IF;
  SELECT * INTO v_product FROM public.products WHERE id = p_product_id AND is_active = true AND track_inventory = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVENTORY_TRACKING_DISABLED: ابتدا انبارگردانی کالا را فعال کنید.';
  END IF;
  PERFORM 1 FROM public.inventory_warehouses WHERE id = p_warehouse_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WAREHOUSE_NOT_FOUND: انبار انتخاب‌شده معتبر نیست.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_warehouse_id::text || ':' || p_product_id::text, 0)
  );
  SELECT COALESCE(sum(quantity_delta), 0)
  INTO v_available
  FROM public.inventory_movements
  WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id;

  IF p_movement_type = 'OPENING' AND EXISTS (
    SELECT 1 FROM public.inventory_movements
    WHERE warehouse_id = p_warehouse_id AND product_id = p_product_id
  ) THEN
    RAISE EXCEPTION 'OPENING_STOCK_ALREADY_SET: موجودی اول دوره قبلاً ثبت شده است؛ برای اصلاح از نوع اصلاح موجودی استفاده کنید.';
  END IF;

  v_new := v_available + p_quantity_delta;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_STOCK: موجودی کالا نمی‌تواند منفی شود.';
  END IF;

  INSERT INTO public.inventory_movements (
    fiscal_year_id, warehouse_id, product_id, movement_type, quantity_delta,
    unit_cost_rial, note, created_by
  )
  VALUES (
    p_fiscal_year_id, p_warehouse_id, p_product_id, p_movement_type, p_quantity_delta,
    p_unit_cost_rial, pg_catalog.btrim(p_note), auth.uid()
  )
  RETURNING id INTO v_movement_id;

  RETURN pg_catalog.jsonb_build_object(
    'recorded', true, 'movement_id', v_movement_id,
    'quantity_on_hand', v_new, 'product_id', p_product_id, 'warehouse_id', p_warehouse_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_cancel_sales_draft(p_document_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE v_doc public.sales_documents%ROWTYPE;
BEGIN
  PERFORM private.fn_require_sales_writer();
  SELECT * INTO v_doc FROM public.sales_documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND OR v_doc.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'DRAFT_ONLY: فقط پیش‌نویس قابل لغو است.';
  END IF;
  UPDATE public.sales_documents SET status = 'CANCELLED', updated_at = now() WHERE id = p_document_id;
  RETURN pg_catalog.jsonb_build_object('cancelled', true, 'document_id', p_document_id);
END;
$function$;

REVOKE ALL ON FUNCTION private.fn_require_sales_writer() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.fn_sales_normalize_lines(jsonb, numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.fn_sales_insert_lines(uuid, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.fn_create_sales_document_internal(uuid, text, uuid, date, text, date, text, date, text, text, text, uuid, jsonb, text, public.creator_actor) FROM PUBLIC, anon, authenticated, service_role;

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

NOTIFY pgrst, 'reload schema';

