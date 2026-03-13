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
            <strong>AlphaBot / stock-claw</strong>
            <span id="sessionCaption">Session not created</span>
          </div>
          <div class="badge" id="healthBadge">Checking daemon...</div>
        </header>

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
          <h2>Portfolio</h2>
          <div class="value-line"><span>$</span><strong id="totalValue">0.00</strong></div>
          <div class="pnl-line" id="totalPnlLine">PnL unavailable</div>
        </section>

        <section class="positions">
          <div class="section-label">Positions</div>
          <div id="positionsList"></div>

          <details open>
            <summary>Session Control</summary>
            <div class="detail-body">
              <label for="sessionId">Session ID</label>
              <input id="sessionId" placeholder="leave blank to auto-generate" />
              <label for="userId">User ID</label>
              <input id="userId" value="web-user" />
              <label for="sessionSummary">Session Summary</label>
              <textarea class="control" id="sessionSummary" readonly></textarea>
              <div class="status" id="sessionStatus"></div>
            </div>
          </details>

          <details>
            <summary>Portfolio JSON</summary>
            <div class="detail-body">
              <label for="portfolioInput">Paper portfolio snapshot</label>
              <textarea class="control" id="portfolioInput"></textarea>
              <div class="button-row">
                <button class="secondary" id="refreshPortfolioButton">Refresh Portfolio</button>
                <button class="secondary" id="savePortfolioButton">Save Snapshot</button>
              </div>
              <label for="portfolioSummary">Portfolio Summary</label>
              <textarea class="control" id="portfolioSummary" readonly></textarea>
              <div class="status" id="portfolioStatus"></div>
            </div>
          </details>

          <details>
            <summary>Runtime</summary>
            <div class="detail-body">
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
            </div>
          </details>

          <details>
            <summary>Specialist Activity</summary>
            <div class="detail-body">
              <label for="spawnOutput">Spawned subagents & tool calls</label>
              <textarea class="control tall" id="spawnOutput" readonly></textarea>
            </div>
          </details>

          <details>
            <summary>Runtime Config</summary>
            <div class="detail-body">
              <div class="button-row">
                <button class="secondary" id="refreshConfigButton">All</button>
                <button class="secondary" id="showMcpButton">MCP</button>
                <button class="secondary" id="showLlmButton">LLM</button>
              </div>
              <label for="configOutput">Sanitized config snapshot</label>
              <textarea class="control" id="configOutput" readonly></textarea>
              <div class="status" id="configStatus"></div>
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
