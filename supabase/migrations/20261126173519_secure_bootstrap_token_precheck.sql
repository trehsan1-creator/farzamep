-- Keep the one-time bootstrap credential check private to the service role.
CREATE OR REPLACE FUNCTION public.fn_is_auth_bootstrap_token_valid(p_token_hash TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT
    NOT EXISTS (
      SELECT 1
      FROM public.user_profiles
      WHERE role = 'ADMIN'::public.erp_role
        AND is_active = TRUE
    )
    AND EXISTS (
      SELECT 1
      FROM private.auth_bootstrap_tokens
      WHERE token_hash = p_token_hash
        AND consumed_at IS NULL
    );
$function$;

REVOKE ALL ON FUNCTION public.fn_is_auth_bootstrap_token_valid(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_is_auth_bootstrap_token_valid(TEXT) TO service_role;
ALTER FUNCTION public.fn_is_auth_bootstrap_token_valid(TEXT) SET search_path = public;
