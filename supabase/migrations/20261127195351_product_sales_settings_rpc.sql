
CREATE OR REPLACE FUNCTION private.fn_update_product_sales_settings(
  p_product_id uuid,
  p_sale_price_rial bigint,
  p_is_vat_subject boolean,
  p_vat_rate_pct numeric,
  p_track_inventory boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_product public.products%ROWTYPE;
  v_stock numeric(18,3);
BEGIN
  PERFORM private.fn_require_sales_writer();
  IF p_sale_price_rial IS NOT NULL AND p_sale_price_rial < 0 THEN
    RAISE EXCEPTION 'INVALID_SALE_PRICE: قیمت فروش نمی‌تواند منفی باشد.';
  END IF;
  IF p_vat_rate_pct IS NOT NULL AND (p_vat_rate_pct < 0 OR p_vat_rate_pct > 100) THEN
    RAISE EXCEPTION 'INVALID_VAT_RATE: نرخ ارزش افزوده باید بین صفر تا صد باشد.';
  END IF;

  SELECT * INTO v_product
  FROM public.products
  WHERE id = p_product_id AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: کالا یافت نشد یا غیرفعال است.';
  END IF;

  IF p_track_inventory = false AND v_product.track_inventory = true THEN
    SELECT COALESCE(sum(quantity_delta), 0)
    INTO v_stock
    FROM public.inventory_movements
    WHERE product_id = p_product_id;
    IF v_stock <> 0 THEN
      RAISE EXCEPTION 'STOCK_NOT_ZERO: تا زمانی که موجودی کالا صفر نشده، انبارگردانی آن قابل غیرفعال‌سازی نیست.';
    END IF;
  END IF;

  UPDATE public.products
  SET sale_price_rial = p_sale_price_rial,
      is_vat_subject = p_is_vat_subject,
      vat_rate_pct = p_vat_rate_pct,
      track_inventory = p_track_inventory
  WHERE id = p_product_id;

  RETURN pg_catalog.jsonb_build_object(
    'updated', true, 'product_id', p_product_id,
    'sale_price_rial', p_sale_price_rial,
    'is_vat_subject', p_is_vat_subject,
    'vat_rate_pct', p_vat_rate_pct,
    'track_inventory', p_track_inventory
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_update_product_sales_settings(
  p_product_id uuid,
  p_sale_price_rial bigint,
  p_is_vat_subject boolean,
  p_vat_rate_pct numeric,
  p_track_inventory boolean
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT private.fn_update_product_sales_settings(
    p_product_id, p_sale_price_rial, p_is_vat_subject, p_vat_rate_pct, p_track_inventory
  );
$function$;

REVOKE ALL ON FUNCTION private.fn_update_product_sales_settings(uuid, bigint, boolean, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.fn_update_product_sales_settings(uuid, bigint, boolean, numeric, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.fn_update_product_sales_settings(uuid, bigint, boolean, numeric, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_update_product_sales_settings(uuid, bigint, boolean, numeric, boolean) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';

