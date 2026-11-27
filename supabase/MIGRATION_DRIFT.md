# Supabase Migration History — Reconciliation Note

**Project:** `lssccfjhnkjpihmawjdd`  
**Last checked:** 2026-11-27

## Production migration history

The live Supabase project reports these applied versions:

| Version | Name |
|---|---|
| 20261126170251 | initial_erp_schema |
| 20261126170310 | core_accounting_schema |
| 20261126170530 | mvp_backend_and_muse_functions |
| 20261126170604 | mvp_security_hardening |
| 20261126171013 | mvp_security_and_query_optimization |
| 20261126172802 | owner_controlled_admin_bootstrap |
| 20261126173519 | secure_bootstrap_token_precheck |
| 20261126181005 | multi_agent_mcp_credentials |
| 20261127182701 | erp_voucher_write_path_hardening |
| 20261127183045 | erp_fiscal_year_rls_lock_fix |
| 20261127183226 | erp_voucher_rpc_and_approval_hardening |
| 20261127183659 | erp_restore_private_rpc_guardrails |
| 20261127191459 | restrict_anon_accounting_rpcs |
| 20261127194603 | add_bank_party_group |
| 20261127194917 | sales_invoice_engine_mvp |
| 20261127195122 | sales_rpc_private_boundary_and_indexes |
| 20261127195351 | product_sales_settings_rpc |

## Repository state

- The owner bootstrap and secure token precheck files now use the exact versions recorded by Supabase.
- Two migration files that contained Python `FileNotFoundError` tracebacks instead of SQL were removed. Their intended live functionality is already represented in the applied production schema; the removed files were not applied migration versions.
- The additive `20261126200000_query_erp_agent_scope.sql` remains in the repository. The live Muse credential already includes `query_erp`; its effect is present in production even though that local version is not separately listed in remote migration history.
- The original baseline migrations `20261126170251`, `20261126170310`, `20261126170530`, `20261126170604`, `20261126171013`, and `20261126181005` are not currently present as source files in this repository.
- Migration `20261127191459` removes anonymous execution from the accounting reporting RPCs while retaining access for authenticated users and the service role.
- Migrations `20261127194603`–`20261127195351` add the BANK party type, commercial sales documents, line-level tax snapshots, payment receipts, inventory movements, private RPC boundaries, supporting indexes, and product sales settings. The exact SQL files are now tracked in `supabase/migrations/`.
- The production Muse MCP Edge Function is deployed at version 6. Its credential now allows safe draft sales-document creation, sales-document listing/detail retrieval, and inventory-stock reads. It cannot issue invoices, record receipts, or finalize accounting vouchers.

## Operational guardrail

**Do not run `supabase db push`, `supabase db reset`, or an automated migration replay against Production until the missing baseline migrations are reconstructed and the local/remote histories are reconciled.**

The current production database has been updated through controlled Supabase migration actions. The voucher write-path, fiscal-year lock, RPC-boundary, agent-review guardrail, anonymous RPC-access, and sales/inventory migrations are tracked using the exact versions returned by Supabase. This does not make the repository a fully reproducible fresh-install source yet.

A separate schema-baseline recovery task is required before using this repository to provision a new Supabase project or replay the entire history.
