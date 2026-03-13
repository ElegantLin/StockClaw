# Memory Flush

Pre-compaction memory flush.

- Store durable memories now using `memory_append_daily_log`.
- Target file date: `YYYY-MM-DD`.
- Append only. Do not overwrite prior memory entries.
- Preserve durable investing context only:
  - user preferences
  - risk limits
  - allocation and position constraints
  - exclusions and watchlist priorities
  - pending trade intentions worth keeping across turns
  - reusable investment principles or conclusions
- Do not store secrets, API keys, or raw credentials.
- Do not rewrite portfolio truth from this flush turn.
- If there is nothing worth preserving, reply with `NO_MEMORY_FLUSH`.

