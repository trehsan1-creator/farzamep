-- Grant the controlled, read-only query engine to the existing Muse agent.
-- The tool itself validates a fixed resource/field allow-list and never runs raw SQL.
update private.mcp_agent_credentials
set allowed_tools = array_append(allowed_tools, 'query_erp')
where agent_name = 'muse.ai'
  and not ('query_erp' = any(allowed_tools));

