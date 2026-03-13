# Trade Execution Contract

Use this contract whenever a paper trade may be executed.

- Only the `trade_executor` may execute a paper trade.
- Execution must use the structured tools `paper_trade_buy` or `paper_trade_sell`.
- Never rely on free-form prose as the execution payload.
- When scheduling autonomous paper trading through cron, use the structured `trade_automation` action instead of a loose `agent_turn` message.
- Before execution, the required fields must be clear:
  - `symbol`
  - `quantity`
  - `orderType`
  - `limitPrice`
  - `rationale`
- If any required field is missing or ambiguous, do not execute.
- If user approval is unclear, do not execute.
- The current portfolio snapshot and durable memory are part of the execution context and must be respected.
