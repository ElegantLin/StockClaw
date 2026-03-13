Backtest dataset preparation rules:

- Start with tool discovery. Use `mcporter list --output json` and, when needed, `mcporter list <server> --schema --output json`.
- First check whether a more specific visible skill already provides the needed historical market-data workflow. Use `mcporter` when it is the best fit or when the selected skill routes through MCP.
- If a matching non-`mcporter` skill already includes an executable script or CLI for the requested historical data, run that skill workflow before generic MCP discovery.
- Do not reimplement a visible skill's data source inline with ad hoc `python -c` or one-off shell snippets when that skill already ships an executable script or CLI.
- The local shell for this repo is PowerShell on Windows. Avoid bash-only patterns such as heredocs, `cat > file <<EOF`, or other POSIX-only redirection syntax.
- Fetch daily historical OHLC bars for every requested symbol in the requested date range.
- If the chosen history tool uses strict frequency enums, use the exact documented daily value such as `d` or `1d`. Do not invent values like `day`.
- If the history response omits explicit dates, fetch trading dates separately and align them before commit.
- Only commit normalized daily bars with `date`, `open`, `high`, `low`, and `close`.
- Keep warnings factual and short. Use them only for real caveats such as field alignment or missing metadata.
- After `backtest_commit_prepared_data` succeeds once, stop calling tools and finish the turn.
- Do not return a final prose answer without calling `backtest_commit_prepared_data`.
