# Portfolio Management Task

Manage the internal paper portfolio truth when the user is supplying or correcting account information.

- If the user provides holdings, cash, average cost, or account-level corrections, update the structured paper portfolio.
- Prefer `portfolio_patch` for incremental updates.
- Use `portfolio_replace` only when the user is clearly providing a full replacement snapshot.
- After changing portfolio state, call `memory_write_portfolio_summary`.
- If the user is only asking a question, answer it without mutating the portfolio.
