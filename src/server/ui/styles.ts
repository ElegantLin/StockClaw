export const CONTROL_PANEL_STYLES = `
      html {
        height: 100%;
      }

      :root {
        color-scheme: dark;
        --bg: oklch(0.19 0.01 260);
        --bg-top: oklch(0.24 0.02 255);
        --shell: oklch(0.14 0.01 250);
        --panel: oklch(0.97 0.01 95 / 0.94);
        --panel-strong: oklch(0.92 0.01 95 / 0.94);
        --panel-ink: oklch(0.29 0.01 60);
        --ink: oklch(0.94 0.01 250);
        --ink-soft: oklch(0.76 0.02 255);
        --line: oklch(0.34 0.02 255 / 0.72);
        --line-soft: oklch(0.88 0.01 95 / 0.72);
        --accent: oklch(0.72 0.12 208);
        --accent-strong: oklch(0.78 0.12 208);
        --success: oklch(0.76 0.16 150);
        --danger: oklch(0.67 0.22 25);
        --shadow: 0 24px 60px oklch(0 0 0 / 0.18);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        height: 100%;
        background:
          radial-gradient(circle at top left, oklch(0.3 0.03 255 / 0.55), transparent 34%),
          linear-gradient(180deg, var(--bg-top) 0%, var(--bg) 46%, var(--shell) 100%);
        color: var(--ink);
        font-family: "Aptos", "Segoe UI Variable", "PingFang SC", "Microsoft YaHei", sans-serif;
        overflow: hidden;
      }

      *::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }

      *::-webkit-scrollbar-thumb {
        background: oklch(0.43 0.02 255 / 0.78);
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: padding-box;
      }

      *::-webkit-scrollbar-track {
        background: transparent;
      }

      .app {
        display: grid;
        grid-template-columns: minmax(0, 1.5fr) minmax(360px, 440px);
        height: 100vh;
        min-height: 100vh;
        overflow: hidden;
      }

      .chat-shell {
        position: relative;
        display: flex;
        flex-direction: column;
        min-width: 0;
        min-height: 0;
        overflow: hidden;
        border-right: 1px solid oklch(0.32 0.01 255 / 0.46);
      }

      .side-shell {
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
        background:
          linear-gradient(180deg, oklch(0.95 0.01 95 / 0.98) 0%, oklch(0.9 0.01 95 / 0.98) 100%);
        color: var(--panel-ink);
      }

      .topbar {
        position: sticky;
        top: 0;
        z-index: 4;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 14px;
        padding: 14px 20px 12px;
        background: linear-gradient(180deg, oklch(0.19 0.01 255 / 0.98) 0%, oklch(0.19 0.01 255 / 0.9) 100%);
        border-bottom: 1px solid oklch(0.34 0.02 255 / 0.68);
        backdrop-filter: blur(12px);
      }

      .eyebrow,
      .section-label,
      .section-kicker,
      .metric-label,
      .summary-badge,
      .hint,
      .status,
      label,
      input,
      textarea,
      button {
        font-size: 12px;
      }

      .title-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .title-group strong {
        font-family: "Aptos Display", "Segoe UI Variable", "PingFang SC", "Microsoft YaHei", sans-serif;
        font-size: 18px;
        line-height: 1.1;
        letter-spacing: -0.02em;
        max-width: none;
      }

      .title-group span {
        color: var(--ink-soft);
      }

      .eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: oklch(0.82 0.04 208);
      }

      .topbar-meta {
        display: flex;
        align-items: center;
        justify-content: flex-end;
      }

      .badge {
        padding: 8px 10px;
        border-radius: 999px;
        border: 1px solid oklch(0.4 0.03 255 / 0.86);
        color: var(--ink-soft);
        background: oklch(0.28 0.02 255 / 0.82);
        white-space: nowrap;
      }

      .quick-strip {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 10px;
        padding: 10px 20px 8px;
        border-bottom: 1px solid oklch(0.32 0.01 255 / 0.46);
        overflow-x: auto;
      }

      .quick-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        min-width: max-content;
      }

      .chip {
        border: 1px solid oklch(0.42 0.03 255 / 0.9);
        background: oklch(0.25 0.02 255 / 0.85);
        color: var(--ink);
        border-radius: 999px;
        padding: 8px 12px;
        text-align: left;
      }

      .chip:hover {
        background: oklch(0.29 0.03 255 / 0.92);
      }

      .chat-scroll {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 16px 20px calc(var(--composer-offset, 220px) + 22px);
      }

      .chat-stack {
        max-width: 960px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        gap: 24px;
      }

      .message-row {
        display: flex;
        width: 100%;
      }

      .message-row.user {
        justify-content: flex-end;
      }

      .message-row.assistant {
        justify-content: flex-start;
      }

      .bubble-user {
        max-width: min(78%, 760px);
        padding: 18px 20px;
        border-radius: 24px 24px 8px 24px;
        background: linear-gradient(180deg, oklch(0.3 0.03 255 / 0.96) 0%, oklch(0.26 0.02 255 / 0.96) 100%);
        border: 1px solid oklch(0.42 0.03 255 / 0.68);
        color: var(--ink);
        box-shadow: var(--shadow);
      }

      .assistant-wrap {
        width: min(90%, 900px);
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr);
        gap: 14px;
      }

      .assistant-icon {
        width: 42px;
        height: 42px;
        border-radius: 14px;
        background: linear-gradient(135deg, oklch(0.78 0.12 208) 0%, oklch(0.62 0.1 218) 100%);
        color: oklch(0.16 0.01 250);
        display: flex;
        align-items: center;
        justify-content: center;
        font-weight: 800;
        letter-spacing: 0.04em;
        box-shadow: 0 14px 28px oklch(0 0 0 / 0.18);
      }

      .assistant-body {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 2px 0 0;
      }

      .assistant-body > .markdown,
      .assistant-body > .thoughts,
      .assistant-body > .blocks {
        max-width: 100%;
      }

      .assistant-body pre,
      .bubble-user pre,
      .thoughts pre,
      textarea,
      code {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: "Cascadia Code", "JetBrains Mono", Consolas, monospace;
        line-height: 1.6;
      }

      .markdown {
        display: flex;
        flex-direction: column;
        gap: 12px;
        color: var(--ink);
      }

      .markdown > :first-child {
        margin-top: 0;
      }

      .markdown > :last-child {
        margin-bottom: 0;
      }

      .markdown p,
      .markdown ul,
      .markdown ol,
      .markdown blockquote {
        margin: 0;
      }

      .markdown h1,
      .markdown h2,
      .markdown h3,
      .markdown h4,
      .markdown h5,
      .markdown h6 {
        margin: 0;
        line-height: 1.25;
        font-weight: 800;
        font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
        letter-spacing: -0.02em;
      }

      .markdown h1 {
        font-size: 30px;
      }

      .markdown h2 {
        font-size: 25px;
      }

      .markdown h3 {
        font-size: 21px;
      }

      .markdown h4,
      .markdown h5,
      .markdown h6 {
        font-size: 16px;
      }

      .markdown a {
        color: oklch(0.84 0.08 212);
        text-decoration: none;
      }

      .markdown a:hover {
        text-decoration: underline;
      }

      .markdown ul,
      .markdown ol {
        padding-left: 22px;
      }

      .markdown li + li {
        margin-top: 4px;
      }

      .markdown blockquote {
        padding: 12px 16px;
        border-left: 3px solid oklch(0.78 0.12 208 / 0.8);
        background: oklch(0.25 0.02 255 / 0.52);
        color: oklch(0.88 0.01 250);
        border-radius: 0 14px 14px 0;
      }

      .markdown hr {
        width: 100%;
        height: 1px;
        border: 0;
        background: oklch(0.4 0.02 255 / 0.6);
      }

      .markdown code {
        display: inline-block;
        padding: 2px 7px;
        border-radius: 8px;
        background: oklch(0.3 0.02 255 / 0.72);
        font-size: 12px;
      }

      .code-block {
        border: 1px solid oklch(0.41 0.02 255 / 0.8);
        background: oklch(0.17 0.01 250 / 0.88);
        border-radius: 16px;
        overflow: hidden;
      }

      .code-lang {
        padding: 8px 12px;
        border-bottom: 1px solid oklch(0.39 0.02 255 / 0.8);
        color: var(--ink-soft);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .code-block pre {
        margin: 0;
        padding: 14px;
        overflow-x: auto;
      }

      .thoughts {
        display: flex;
        flex-direction: column;
        gap: 9px;
        margin-bottom: 4px;
        padding: 14px 16px;
        border-left: 2px solid oklch(0.44 0.03 255 / 0.72);
        background: oklch(0.22 0.01 250 / 0.46);
        border-radius: 0 16px 16px 0;
      }

      .thought {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--ink-soft);
        font-size: 12px;
      }

      .thought.agent {
        color: var(--ink);
      }

      .thought.done::before {
        content: "OK";
        color: var(--success);
        font-weight: 700;
      }

      .thought.live::before {
        content: "...";
        color: var(--accent-strong);
        font-weight: 700;
      }

      .blocks {
        margin-top: 4px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .block {
        border-radius: 16px;
        background: oklch(0.22 0.01 250 / 0.58);
        border: 1px solid oklch(0.4 0.02 255 / 0.72);
        padding: 14px;
      }

      .composer {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        padding: 20px 20px 14px;
        background: linear-gradient(180deg, oklch(0.19 0.01 255 / 0) 0%, oklch(0.19 0.01 255 / 0.78) 26%, oklch(0.17 0.01 250 / 0.98) 100%);
      }

      .composer-inner {
        max-width: 960px;
        margin: 0 auto;
      }

      .composer-box {
        border: 1px solid oklch(0.41 0.02 255 / 0.88);
        background: oklch(0.23 0.01 255 / 0.92);
        border-radius: 28px;
        overflow: hidden;
        box-shadow: var(--shadow);
      }

      .composer-box textarea {
        width: 100%;
        background: transparent;
        color: var(--ink);
        border: 0;
        padding: 16px 18px 12px;
        min-height: 96px;
        resize: vertical;
      }

      .composer-box textarea::placeholder {
        color: oklch(0.68 0.02 255);
      }

      .button-row,
      .summary-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      button {
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        font-weight: 700;
        cursor: pointer;
        transition: transform 120ms ease, opacity 120ms ease, background 120ms ease;
      }

      button:hover {
        transform: translateY(-1px);
      }

      button.primary {
        background: var(--accent);
        color: oklch(0.15 0.01 250);
      }

      button.secondary {
        background: oklch(0.92 0.01 95 / 0.92);
        color: var(--panel-ink);
        border: 1px solid oklch(0.82 0.01 95 / 0.98);
      }

      button.warn {
        background: oklch(0.58 0.2 25 / 0.14);
        color: oklch(0.47 0.18 25);
        border: 1px solid oklch(0.7 0.18 25 / 0.34);
      }

      button:disabled {
        opacity: 0.45;
        cursor: default;
        transform: none;
      }

      .hint {
        color: var(--ink-soft);
        margin-top: 10px;
      }

      .status {
        min-height: 18px;
        color: var(--ink-soft);
        margin-top: 8px;
      }

      .status.error {
        color: oklch(0.76 0.16 28);
      }

      .portfolio-head {
        padding: 24px 22px 22px;
        border-bottom: 1px solid var(--line-soft);
      }

      .section-kicker,
      .section-label {
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: oklch(0.5 0.02 60);
        font-weight: 700;
      }

      .portfolio-head h2 {
        margin: 8px 0 16px;
        font-family: "Iowan Old Style", "Palatino Linotype", Georgia, serif;
        font-size: 28px;
        line-height: 1.08;
        letter-spacing: -0.03em;
      }

      .value-line {
        display: flex;
        align-items: baseline;
        gap: 6px;
        font-size: 42px;
        font-weight: 800;
        letter-spacing: -0.04em;
      }

      .value-line span {
        font-size: 24px;
        color: oklch(0.56 0.02 60);
      }

      .pnl-line {
        margin-top: 12px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 700;
      }

      .pnl-line.up {
        color: oklch(0.46 0.15 150);
      }

      .pnl-line.down {
        color: oklch(0.55 0.19 25);
      }

      .metric-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 10px;
        margin-top: 18px;
      }

      .metric-card {
        padding: 12px 12px 10px;
        border-radius: 16px;
        background: oklch(0.95 0.01 95 / 0.96);
        border: 1px solid oklch(0.87 0.01 95 / 0.96);
        min-width: 0;
      }

      .metric-card strong {
        display: block;
        margin-top: 8px;
        font-size: 18px;
        letter-spacing: -0.03em;
      }

      .metric-label {
        color: oklch(0.52 0.02 60);
        font-weight: 700;
      }

      .positions {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 18px 16px 26px;
      }

      .panel-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        padding: 0 4px 8px;
      }

      .section-copy {
        margin: 8px 0 0;
        color: oklch(0.46 0.01 60);
        line-height: 1.5;
        font-size: 13px;
      }

      .holding {
        border-radius: 18px;
        padding: 16px 14px;
        border: 1px solid transparent;
        transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
      }

      .holding:hover {
        background: oklch(0.95 0.01 95 / 0.88);
        border-color: oklch(0.86 0.01 95 / 0.96);
        transform: translateY(-1px);
      }

      .holding-head,
      .holding-foot {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: flex-start;
      }

      .holding strong {
        font-size: 17px;
      }

      .holding small,
      .holding .meta {
        color: oklch(0.48 0.01 60);
      }

      .holding-foot {
        margin-top: 12px;
        align-items: center;
      }

      .pill {
        padding: 4px 8px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 700;
        background: oklch(0.9 0.01 95 / 0.92);
      }

      .pill.up {
        color: oklch(0.46 0.15 150);
        background: oklch(0.9 0.06 150 / 0.36);
      }

      .pill.down {
        color: oklch(0.55 0.19 25);
        background: oklch(0.9 0.05 25 / 0.34);
      }

      .summary-stack {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 18px;
      }

      .summary-panel {
        border-radius: 20px;
        background: oklch(0.95 0.01 95 / 0.92);
        border: 1px solid oklch(0.86 0.01 95 / 0.96);
        overflow: hidden;
      }

      .summary-head {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: flex-start;
        padding: 14px 16px 10px;
      }

      .summary-head strong {
        display: block;
        margin-top: 6px;
        font-size: 16px;
        letter-spacing: -0.02em;
      }

      .summary-badge {
        padding: 5px 8px;
        border-radius: 999px;
        background: oklch(0.9 0.01 95 / 0.96);
        border: 1px solid oklch(0.84 0.01 95 / 0.96);
        color: oklch(0.43 0.01 60);
        white-space: nowrap;
      }

      .summary-body {
        padding: 0 16px 16px;
      }

      .summary-body p {
        margin: 0;
        line-height: 1.55;
      }

      .summary-meta {
        margin-top: 10px;
        color: oklch(0.48 0.01 60);
      }

      .activity-panel .summary-body {
        padding-top: 2px;
      }

      .activity-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .activity-item,
      .empty-inline {
        padding: 11px 12px;
        border-radius: 14px;
        background: oklch(0.91 0.01 95 / 0.84);
        border: 1px solid oklch(0.85 0.01 95 / 0.94);
      }

      .activity-item strong {
        display: block;
        font-size: 13px;
      }

      .activity-item span,
      .activity-item small,
      .empty-inline {
        color: oklch(0.47 0.01 60);
        line-height: 1.45;
      }

      details {
        margin-top: 14px;
        border-top: 1px solid var(--line-soft);
      }

      summary {
        list-style: none;
        cursor: pointer;
        padding: 16px 8px 12px;
        font-weight: 700;
      }

      summary::-webkit-details-marker {
        display: none;
      }

      .detail-body {
        padding: 0 2px 12px;
      }

      .detail-grid {
        display: grid;
        gap: 12px;
      }

      .diagnostic-card {
        padding: 14px;
        border-radius: 18px;
        background: oklch(0.95 0.01 95 / 0.92);
        border: 1px solid oklch(0.86 0.01 95 / 0.96);
      }

      .mini-head {
        margin-bottom: 8px;
      }

      label {
        display: block;
        color: oklch(0.49 0.01 60);
        margin: 10px 0 6px;
      }

      input,
      textarea.control {
        width: 100%;
        background: oklch(0.98 0.01 95 / 0.98);
        color: var(--panel-ink);
        border: 1px solid oklch(0.84 0.01 95 / 0.96);
        border-radius: 12px;
        padding: 10px 12px;
        font: inherit;
      }

      textarea.control {
        min-height: 110px;
        resize: vertical;
      }

      textarea.control.tall {
        min-height: 170px;
      }

      @media (max-width: 1320px) {
        .app {
          grid-template-columns: minmax(0, 1fr) minmax(340px, 400px);
        }

        .metric-grid {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 1080px) {
        body {
          overflow: auto;
        }

        .app {
          display: flex;
          flex-direction: column;
          height: auto;
          min-height: 100vh;
          overflow: visible;
        }

        .chat-shell,
        .side-shell {
          overflow: visible;
        }

        .side-shell {
          border-top: 1px solid oklch(0.34 0.02 255 / 0.68);
        }

        .topbar,
        .quick-strip,
        .chat-scroll,
        .composer,
        .portfolio-head,
        .positions {
          padding-left: 18px;
          padding-right: 18px;
        }

        .topbar {
          flex-direction: row;
          align-items: center;
        }

        .title-group strong {
          max-width: none;
        }

        .composer {
          position: sticky;
          bottom: 0;
        }
      }
`;
