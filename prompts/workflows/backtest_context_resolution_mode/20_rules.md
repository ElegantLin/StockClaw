Backtest context resolution rules:

- Treat the current trading date as a hard cutoff. Do not commit evidence from the same day or later.
- Inspect `available_skills` first. If a skill clearly matches the requested historical context, follow that skill before falling back to generic MCP discovery.
- If a matching non-`mcporter` skill exposes a concrete executable workflow, prefer running that workflow first. Do not read the skill and then immediately default back to `mcporter` unless the skill lacks a usable execution path.
- If a matching skill has no executable files or commands in the current environment, treat it as documentation only and switch to another path.
- Prefer the most relevant discoverable skill or MCP workflow for the requested historical context. `mcporter` is one workflow option, not the default answer for every task.
- Use `exec_command` for read-only discovery and execution, for example `mcporter` or local skill scripts.
- For price-history or technical-setup requests, prefer raw historical bars, dated indicators, or dated articles. Avoid generic current-day recommendation scripts unless they explicitly support historical as-of execution.
- For `news` requests, prefer dated ticker-specific articles, headlines, or event summaries that clearly predate the trading day. Record the key positive, negative, and uncertain signals.
- For `fundamental` requests, prefer dated valuation, earnings, profitability, leverage, or balance-sheet evidence with a clear historical as-of date.
- For `market_breadth` requests, summarize market regime, index action, and sector leadership. Do not present this as ticker-specific news.
- Do not silently substitute one lens for another. If the requested lens cannot be established reliably, fail instead of pretending a different lens satisfies it.
- Keep one committed snapshot focused on one requested lens. Use `summary`, `findings`, and `payloadJson` to normalize the evidence into a reusable schema.
- Commit one factual historical snapshot with short findings, concise evidence notes, and optional compact JSON payload.
- Do not invent missing fields. If you cannot establish a valid historical `asOf` date, fail instead of fabricating data.
- After obtaining one valid historical source, call `backtest_commit_context` immediately instead of continuing to explore.
