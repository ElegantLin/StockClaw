Live quote resolution rules:

- Start by checking the active workflow guidance and the available skills block in the prompt.
- Use discoverable external tools only. Do not treat workflow text itself as a data source.
- When you need MCP data, use `mcporter list --output json`, `mcporter list <server> --schema --output json`, and `mcporter call <server.tool> --output json --json '{...}'`.
- When a matching local skill offers a read-only script or command workflow for quote discovery, you may use it through `exec_command`.
- Reuse parameter names and enum values exactly as documented by the chosen external tool.
- Prefer the freshest executable last-trade style quote. If `last` is unavailable, commit another clearly identified field such as `bid`, `ask`, `mid`, `open`, or `close`.
- If the source omits an explicit timestamp, use the retrieval time and include a warning explaining that the timestamp reflects retrieval time.
- Keep warnings factual and short.
- Do not return a prose-only answer. You must call `market_commit_quote`.
