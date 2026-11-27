-- Restrict accounting report RPCs to authenticated application sessions.
-- These functions are SECURITY INVOKER and respect RLS, but anonymous execution
-- is not required by the ERP UI or the authenticated agent workflow.

REVOKE EXECUTE ON FUNCTION public.fn_get_trial_balance(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_get_trial_balance(uuid, boolean) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.fn_simulate_year_end_closing(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_simulate_year_end_closing(uuid, boolean) TO authenticated, service_role;
