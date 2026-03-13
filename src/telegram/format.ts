interface TelegramSegment {
  kind: "text" | "code";
  content: string;
}

const FENCE_PATTERN = /```[^\n`]*\n?([\s\S]*?)```/g;

export function renderTelegramHtml(markdownish: string): string {
  return parseTelegramSegments(markdownish).map(renderSegmentHtml).join("");
}

export function splitTelegramMessage(message: string, limit = 3500): string[] {
  const trimmed = message.trim();
  if (!trimmed) {
    return ["(empty response)"];
  }

  const chunks: string[] = [];
  let current = "";
  for (const segment of expandSegments(parseTelegramSegments(trimmed), limit)) {
    const candidate = current ? `${current}${segment}` : segment;
    if (renderTelegramHtml(candidate).length <= limit) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current.trim());
      current = segment;
      continue;
    }
    chunks.push(segment.trim());
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks.length > 0 ? chunks : ["(empty response)"];
}

function parseTelegramSegments(input: string): TelegramSegment[] {
  const segments: TelegramSegment[] = [];
  let cursor = 0;
  for (const match of input.matchAll(FENCE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: "text", content: input.slice(cursor, index) });
    }
    segments.push({ kind: "code", content: match[1] ?? "" });
    cursor = index + match[0].length;
  }
  if (cursor < input.length) {
    segments.push({ kind: "text", content: input.slice(cursor) });
  }
  return segments.filter((segment) => segment.content.length > 0);
}

function renderSegmentHtml(segment: TelegramSegment): string {
  if (segment.kind === "code") {
    return `<pre><code>${escapeHtml(segment.content.replace(/\n$/, ""))}</code></pre>`;
  }
  return renderTextHtml(segment.content);
}

function renderTextHtml(input: string): string {
  return input
    .split("\n")
    .map((line) => renderLineHtml(line))
    .join("\n");
}

function renderLineHtml(line: string): string {
  const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
  if (heading) {
    return `<b>${renderInlineMarkdown(heading[2] ?? "")}</b>`;
  }

  const unordered = line.match(/^(\s*)[-+*]\s+(.+)$/);
  if (unordered) {
    return `${escapeHtml(unordered[1] ?? "")}• ${renderInlineMarkdown(unordered[2] ?? "")}`;
  }

  const ordered = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
  if (ordered) {
    return `${escapeHtml(ordered[1] ?? "")}${escapeHtml(ordered[2] ?? "")}. ${renderInlineMarkdown(ordered[3] ?? "")}`;
  }

  const quote = line.match(/^\s*>\s?(.*)$/);
  if (quote) {
    return `&gt; ${renderInlineMarkdown(quote[1] ?? "")}`;
  }

  if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
    return "────────";
  }

  return renderInlineMarkdown(line);
}

function renderInlineMarkdown(input: string): string {
  let html = "";
  let cursor = 0;
  while (cursor < input.length) {
    const token = matchNextInlineToken(input, cursor);
    if (!token) {
      html += escapeHtml(input.slice(cursor));
      break;
    }
    if (token.index > cursor) {
      html += escapeHtml(input.slice(cursor, token.index));
    }
    html += token.html;
    cursor = token.nextIndex;
  }
  return html;
}

function matchNextInlineToken(
  input: string,
  startIndex: number,
): { index: number; nextIndex: number; html: string } | null {
  const candidates = [
    matchLinkToken(input, startIndex),
    matchCodeToken(input, startIndex),
    matchDelimitedToken(input, startIndex, "**", "b"),
    matchDelimitedToken(input, startIndex, "__", "b"),
    matchDelimitedToken(input, startIndex, "~~", "s"),
    matchDelimitedToken(input, startIndex, "*", "i"),
    matchDelimitedToken(input, startIndex, "_", "i"),
  ].filter((candidate): candidate is { index: number; nextIndex: number; html: string } => Boolean(candidate));

  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((left, right) => left.index - right.index || left.nextIndex - right.nextIndex);
  return candidates[0] ?? null;
}

function matchCodeToken(
  input: string,
  startIndex: number,
): { index: number; nextIndex: number; html: string } | null {
  const index = input.indexOf("`", startIndex);
  if (index === -1) {
    return null;
  }
  const end = input.indexOf("`", index + 1);
  if (end === -1) {
    return null;
  }
  const content = input.slice(index + 1, end);
  if (!content || content.includes("\n")) {
    return null;
  }
  return {
    index,
    nextIndex: end + 1,
    html: `<code>${escapeHtml(content)}</code>`,
  };
}

function matchLinkToken(
  input: string,
  startIndex: number,
): { index: number; nextIndex: number; html: string } | null {
  const index = input.indexOf("[", startIndex);
  if (index === -1) {
    return null;
  }
  const labelEnd = input.indexOf("]", index + 1);
  if (labelEnd === -1 || input[labelEnd + 1] !== "(") {
    return null;
  }
  const urlEnd = input.indexOf(")", labelEnd + 2);
  if (urlEnd === -1) {
    return null;
  }
  const label = input.slice(index + 1, labelEnd);
  const href = input.slice(labelEnd + 2, urlEnd).trim();
  if (!label.trim() || !href) {
    return null;
  }
  return {
    index,
    nextIndex: urlEnd + 1,
    html: `<a href="${escapeHtmlAttribute(href)}">${renderInlineMarkdown(label)}</a>`,
  };
}

function matchDelimitedToken(
  input: string,
  startIndex: number,
  delimiter: string,
  tag: "b" | "i" | "s",
): { index: number; nextIndex: number; html: string } | null {
  const index = input.indexOf(delimiter, startIndex);
  if (index === -1) {
    return null;
  }
  const end = input.indexOf(delimiter, index + delimiter.length);
  if (end === -1) {
    return null;
  }
  const content = input.slice(index + delimiter.length, end);
  if (!isValidDelimitedContent(content)) {
    return null;
  }
  return {
    index,
    nextIndex: end + delimiter.length,
    html: `<${tag}>${renderInlineMarkdown(content)}</${tag}>`,
  };
}

function isValidDelimitedContent(content: string): boolean {
  return Boolean(content.trim()) && !content.includes("\n");
}

function expandSegments(segments: TelegramSegment[], limit: number): string[] {
  const expanded: string[] = [];
  for (const segment of segments) {
    const raw = segment.kind === "code" ? `\`\`\`\n${segment.content}\n\`\`\`` : segment.content;
    if (renderTelegramHtml(raw).length <= limit) {
      expanded.push(raw);
      continue;
    }
    if (segment.kind === "code") {
      expanded.push(...splitCodeBlock(segment.content, limit));
      continue;
    }
    expanded.push(...splitTextBlock(segment.content, limit));
  }
  return expanded;
}

function splitTextBlock(input: string, limit: number): string[] {
  const pieces = splitPreservingDelimiter(input, /\n{2,}|\n|\s+/g);
  return accumulatePieces(
    pieces,
    limit,
    (piece) => renderTelegramHtml(piece).length,
    (piece) => piece,
  );
}

function splitCodeBlock(input: string, limit: number): string[] {
  const lines = input.split("\n");
  const pieces = lines.flatMap((line, index) => (index === lines.length - 1 ? [line] : [`${line}\n`]));
  return accumulatePieces(
    pieces,
    limit,
    (piece) => renderTelegramHtml(`\`\`\`\n${piece}\n\`\`\``).length,
    (piece) => `\`\`\`\n${piece.replace(/\n$/, "")}\n\`\`\``,
  );
}

function accumulatePieces(
  pieces: string[],
  limit: number,
  measure: (value: string) => number,
  wrap: (value: string) => string,
): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (!piece) {
      continue;
    }
    if (measure(piece) > limit) {
      if (current) {
        chunks.push(wrap(current));
        current = "";
      }
      chunks.push(...splitOversizedPiece(piece, limit, measure, wrap));
      continue;
    }
    const candidate = current ? `${current}${piece}` : piece;
    if (measure(candidate) <= limit) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(wrap(current));
    }
    current = piece;
  }
  if (current) {
    chunks.push(wrap(current));
  }
  return chunks;
}

function splitOversizedPiece(
  piece: string,
  limit: number,
  measure: (value: string) => number,
  wrap: (value: string) => string,
): string[] {
  const chunks: string[] = [];
  let remaining = piece;
  while (remaining) {
    let sliceLength = Math.min(remaining.length, Math.max(1, Math.floor(limit / 2)));
    while (sliceLength > 1 && measure(remaining.slice(0, sliceLength)) > limit) {
      sliceLength -= 1;
    }
    const next = remaining.slice(0, sliceLength);
    chunks.push(wrap(next));
    remaining = remaining.slice(sliceLength);
  }
  return chunks;
}

function splitPreservingDelimiter(input: string, pattern: RegExp): string[] {
  const pieces: string[] = [];
  let cursor = 0;
  for (const match of input.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      pieces.push(input.slice(cursor, index));
    }
    pieces.push(match[0]);
    cursor = index + match[0].length;
  }
  if (cursor < input.length) {
    pieces.push(input.slice(cursor));
  }
  return pieces.filter((piece) => piece.length > 0);
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttribute(input: string): string {
  return escapeHtml(input).replaceAll('"', "&quot;");
}
