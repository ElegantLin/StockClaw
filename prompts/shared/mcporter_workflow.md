# MCP Workflow

When you need MCP data, follow the OpenClaw-style `mcporter` workflow:

1. Use `mcporter list --output json` to discover configured servers when needed.
2. Before calling an unfamiliar MCP server, inspect it with `mcporter list <server> --schema --output json`.
3. Prefer `mcporter call <server.tool> --args '{...}'` with one JSON object instead of ad-hoc positional flags.
4. Reuse parameter names exactly as shown in the schema. Do not invent aliases.
5. If a tool rejects your arguments, correct the payload once from the schema output instead of guessing repeatedly.
6. Prefer machine-readable output during inspection and concise markdown output when the upstream server renders stable human-readable market data.
7. If one MCP provider starts failing with connection, auth, or quota errors, stop retrying that same provider path and switch to another visible tool or skill-guided workflow.
