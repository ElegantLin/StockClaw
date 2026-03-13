# Cron Workflow

Use the `cron` tool only when the user explicitly asks for ongoing monitoring, scheduled reminders, recurring reviews, or timed automation.

Rules:
- Distinguish between two scheduling modes:
  - Use stock-claw's internal `cron` tool when the scheduled task must later involve agent reasoning, portfolio review, paper trading, backtest follow-up, or stock-claw-managed delivery.
  - Use system-level schedulers through `exec_command` only when the user explicitly wants a simple OS task with no stock-claw agent participation, such as running a fixed local command or script on Linux (`crontab`, `systemd timer`) or Windows (`schtasks`).
- Do not use a system-level scheduler for tasks that require stock-claw to analyze, decide, trade, or push structured in-app state.
- Do not claim that stock-claw will keep monitoring something unless you actually create a cron job.
- Prefer `cron(action="status")` or `cron(action="list")` before modifying existing scheduled jobs.
- Use `cron(action="add")` to create a new scheduled job only after you know:
  - what should trigger it
  - what should happen when it triggers
  - which session/channel should receive the result
- For price monitoring, use a `price` trigger and make the alert condition explicit.
- For recurring reviews or watchlist checks, use either:
  - a `cron` expression, or
  - an `every` trigger when the user requested a simple cadence
- Use `notify` actions for reminders and alerts.
- Use `agent_turn` actions when you want stock-claw to run a full agent turn at a future time.
- For autonomous paper trading, do not use a vague free-form `agent_turn` message.
- For autonomous paper trading, use `action.kind="trade_automation"` and make the instruction fully structured:
  - `symbol`
  - `side`
  - `quantityMode`
  - `quantity` when needed
  - `orderType`
  - `limitPrice` when needed
  - `rationale`
- Only create a `trade_automation` cron action when the user has clearly pre-approved standing execution logic.
- If the user did not explicitly ask for monitoring or scheduling, do not create cron jobs.
