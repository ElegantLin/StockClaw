export function renderControlPanelShell(bootPayload: string, styles: string, clientScript: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>stock-claw Control Panel</title>
    <style>
${styles}
    </style>
  </head>
  <body>
    <div class="app">
      <main class="chat-shell">
        <header class="topbar">
          <div class="title-group">
            <span class="eyebrow">StockClaw Research Desk</span>
            <strong>Agentic investing, paper trading, and backtests in one workspace.</strong>
            <span id="sessionCaption">Session not created</span>
          </div>
          <div class="topbar-meta">
            <div class="badge" id="healthBadge">Checking daemon...</div>
          </div>
        </header>

        <section class="quick-strip">
          <div class="quick-copy">
            <strong>Start from intent, not config.</strong>
            <span>Ask for a stock thesis, a portfolio review, a backtest, or a scheduled watchlist check.</span>
          </div>
          <div class="quick-actions" id="quickActions">
            <button class="chip" type="button" data-prompt="分析一下我的当前组合，给出风险和优先处理项。">检查当前组合</button>
            <button class="chip" type="button" data-prompt="分析一下长江电力，给我一个投资结论，先看技术面，再看新闻和价值面。">分析单只股票</button>
            <button class="chip" type="button" data-prompt="帮我回测最近 7 个交易日的当前组合，控制 token 消耗，给出关键结论。">回测当前组合</button>
            <button class="chip" type="button" data-prompt="每 3 小时检查我的持仓并推送重点变化，如果需要就给出 paper trade 建议。">创建定时任务</button>
          </div>
        </section>

        <section class="chat-scroll">
          <div class="chat-stack" id="chatLog"></div>
        </section>

        <footer class="composer">
          <div class="composer-inner">
            <div class="composer-box">
              <textarea id="messageInput" placeholder="例如：分析一下我的 AAPL 仓位，或者以后不要碰中概股。"></textarea>
            </div>
            <div class="status" id="chatStatus"></div>
            <div class="hint">Enter to send. Shift+Enter for a new line. Type /new to reset the session.</div>
          </div>
        </footer>
      </main>

      <aside class="side-shell">
        <section class="portfolio-head">
          <div class="section-kicker">Portfolio snapshot</div>
          <h2>Paper portfolio overview</h2>
          <div class="value-line"><span>$</span><strong id="totalValue">0.00</strong></div>
          <div class="pnl-line" id="totalPnlLine">PnL unavailable</div>
          <div class="metric-grid">
            <article class="metric-card">
              <span class="metric-label">Cash</span>
              <strong id="cashValue">$0.00</strong>
            </article>
            <article class="metric-card">
              <span class="metric-label">Positions</span>
              <strong id="positionCount">0</strong>
            </article>
            <article class="metric-card">
              <span class="metric-label">Largest weight</span>
              <strong id="largestPosition">--</strong>
            </article>
          </div>
        </section>

        <section class="positions">
          <div class="panel-head">
            <div>
              <div class="section-label">Positions</div>
              <p class="section-copy">Current holdings, exposure, and unrealized PnL.</p>
            </div>
          </div>
          <div id="positionsList"></div>

          <section class="summary-stack">
            <article class="summary-panel">
              <div class="summary-head">
                <div>
                  <span class="section-label">Session</span>
                  <strong>Live working context</strong>
                </div>
                <span class="summary-badge" id="sessionBadge">Waiting</span>
              </div>
              <div class="summary-body">
                <p id="sessionSummaryPreview">No session summary yet.</p>
                <div class="summary-meta">
                  <span id="sessionMeta">User web-user</span>
                </div>
              </div>
            </article>

            <article class="summary-panel">
              <div class="summary-head">
                <div>
                  <span class="section-label">Runtime</span>
                  <strong>System health</strong>
                </div>
                <span class="summary-badge" id="runtimeBadge">Idle</span>
              </div>
              <div class="summary-body">
                <p id="runtimeSummaryPreview">Runtime status unavailable.</p>
                <div class="summary-meta">
                  <span id="runtimeMeta">Waiting for daemon inspection.</span>
                </div>
              </div>
            </article>

            <article class="summary-panel">
              <div class="summary-head">
                <div>
                  <span class="section-label">Tasks</span>
                  <strong>Cron and backtest pulse</strong>
                </div>
                <span class="summary-badge" id="tasksBadge">Quiet</span>
              </div>
              <div class="summary-body">
                <p id="tasksSummaryPreview">No runtime task data yet.</p>
                <div class="summary-meta">
                  <span id="tasksMeta">Backtests and cron jobs refresh with runtime state.</span>
                </div>
              </div>
            </article>

            <article class="summary-panel activity-panel">
              <div class="summary-head">
                <div>
                  <span class="section-label">Agent activity</span>
                  <strong>Recent specialists and tool usage</strong>
                </div>
              </div>
              <div class="summary-body">
                <div class="activity-list" id="agentActivityList">
                  <div class="empty-inline">No spawned specialists for this session yet.</div>
                </div>
              </div>
            </article>
          </section>

          <details>
            <summary>Diagnostics</summary>
            <div class="detail-body">
              <div class="detail-grid">
                <section class="diagnostic-card">
                  <div class="mini-head">
                    <strong>Session control</strong>
                  </div>
                  <label for="sessionId">Session ID</label>
                  <input id="sessionId" placeholder="leave blank to auto-generate" />
                  <label for="userId">User ID</label>
                  <input id="userId" value="web-user" />
                  <label for="sessionSummary">Session Summary</label>
                  <textarea class="control" id="sessionSummary" readonly></textarea>
                  <div class="status" id="sessionStatus"></div>
                </section>

                <section class="diagnostic-card">
                  <div class="mini-head">
                    <strong>Portfolio state</strong>
                  </div>
                  <label for="portfolioInput">Paper portfolio snapshot</label>
                  <textarea class="control" id="portfolioInput"></textarea>
                  <div class="button-row">
                    <button class="secondary" id="refreshPortfolioButton">Refresh Portfolio</button>
                    <button class="secondary" id="savePortfolioButton">Save Snapshot</button>
                  </div>
                  <label for="portfolioSummary">Portfolio Summary</label>
                  <textarea class="control" id="portfolioSummary" readonly></textarea>
                  <div class="status" id="portfolioStatus"></div>
                </section>

                <section class="diagnostic-card">
                  <div class="mini-head">
                    <strong>Runtime control</strong>
                  </div>
                  <div class="button-row">
                    <button class="secondary" id="refreshRuntimeButton">Refresh Runtime</button>
                    <button class="secondary" id="reloadRuntimeButton">Reload Runtime</button>
                    <button class="warn" id="restartRuntimeButton">Restart Daemon</button>
                  </div>
                  <label for="runtimeOutput">Runtime status</label>
                  <textarea class="control tall" id="runtimeOutput" readonly></textarea>
                  <label for="memoryArtifacts">Recent memory artifacts</label>
                  <textarea class="control tall" id="memoryArtifacts" readonly></textarea>
                  <label for="skillsOutput">Available skills</label>
                  <textarea class="control tall" id="skillsOutput" readonly></textarea>
                  <div class="status" id="runtimeStatus"></div>
                </section>

                <section class="diagnostic-card">
                  <div class="mini-head">
                    <strong>Config & raw activity</strong>
                  </div>
                  <div class="button-row">
                    <button class="secondary" id="refreshConfigButton">All</button>
                    <button class="secondary" id="showMcpButton">MCP</button>
                    <button class="secondary" id="showLlmButton">LLM</button>
                  </div>
                  <label for="configOutput">Sanitized config snapshot</label>
                  <textarea class="control" id="configOutput" readonly></textarea>
                  <label for="spawnOutput">Spawned subagents & tool calls</label>
                  <textarea class="control tall" id="spawnOutput" readonly></textarea>
                  <div class="status" id="configStatus"></div>
                </section>
              </div>
            </div>
          </details>
        </section>
      </aside>
    </div>

    <script id="boot" type="application/json">${bootPayload}</script>
    <script type="module">
${clientScript}
    </script>
  </body>
</html>`;
}
