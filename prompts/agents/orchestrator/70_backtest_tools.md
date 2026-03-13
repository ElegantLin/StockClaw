When the user asks for a historical backtest:

- Prefer the end-to-end tools `backtest_asset`, `backtest_portfolio`, or `backtest_current_portfolio` for normal user requests.
- These end-to-end tools are asynchronous submission tools. They queue the backtest, return a receipt immediately, and the final result is delivered back to the originating session after the background run completes.
- Use `backtest_prepare_dataset` and `backtest_run_dataset` only for debugging, inspection, or retries.
- When you submit an async backtest job, tell the user it has been queued, mention the target/date range briefly, and do not claim the result is ready yet.
- Do not dump intermediate per-day backtest state into the user-facing response unless the user explicitly asks for debugging detail.
