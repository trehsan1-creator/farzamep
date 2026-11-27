-- One-time, owner-controlled bootstrap for the first ERP administrator.
-- The plaintext bootstrap code is never stored in Postgres or in auth.users.
CREATE TABLE IF NOT EXISTS private.auth_bootstrap_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at TIMESTAMPTZ
);

ALTER TABLE private.auth_bootstrap_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.auth_bootstrap_tokens FROM PUBLIC, anon, authenticated, service_role;

-- Provision the one-time token hash separately through a secure database operation.
-- Never commit the token hash: anyone able to write auth user metadata could otherwise claim the first admin.

CREATE OR REPLACE FUNCTION private.fn_handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_has_admin BOOLEAN;
  v_bootstrap_token_id UUID;
  v_role public.erp_role;
  v_is_active BOOLEAN;
  v_name TEXT;
  v_token_hash TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.user_profiles
    WHERE role = 'ADMIN'::public.erp_role
      AND is_active = TRUE
  ) INTO v_has_admin;

  v_token_hash := NEW.raw_user_meta_data->>'bootstrap_token_hash';

  IF NOT v_has_admin AND v_token_hash ~ '^[0-9a-f]{64}$' THEN
    SELECT id
      INTO v_bootstrap_token_id
    FROM private.auth_bootstrap_tokens
    WHERE token_hash = v_token_hash
      AND consumed_at IS NULL
    FOR UPDATE;
  END IF;

  IF v_bootstrap_token_id IS NOT NULL AND NOT v_has_admin THEN
    UPDATE private.auth_bootstrap_tokens
    SET consumed_at = now()
    WHERE id = v_bootstrap_token_id;

    v_role := 'ADMIN'::public.erp_role;
    v_is_active := TRUE;
  ELSE
    -- Direct/public sign-ups never receive access by default.
    v_role := 'ACCOUNTANT'::public.erp_role;
    v_is_active := FALSE;
  END IF;

  v_name := COALESCE(
    NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
    split_part(COALESCE(NEW.email, 'user'), '@', 1)
  );

  INSERT INTO public.user_profiles (id, full_name, role, is_active)
  VALUES (NEW.id, v_name, v_role, v_is_active)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.fn_handle_new_auth_user() FROM PUBLIC, anon, authenticated;
ALTER FUNCTION private.fn_handle_new_auth_user() SET search_path = public;
