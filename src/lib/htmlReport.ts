import { Marked } from "marked";

/**
 * 전용 Marked 인스턴스 — raw HTML 블록을 이스케이프하여 XSS 방지.
 * LLM이 생성한 마크다운에 <script>, <iframe> 등이 포함될 수 있으므로
 * raw HTML 토큰은 이스케이프된 텍스트로 렌더링한다.
 */
const markedInstance = new Marked({
  renderer: {
    html(token) {
      return escapeHtml(typeof token === "string" ? token : token.text);
    },
  },
});

const REPORT_CSS = `
  :root {
    --bg: #ffffff;
    --surface: #f6f8fa;
    --surface-2: #f0f2f5;
    --border: #d8dee4;
    --text: #1f2328;
    --text-muted: #656d76;
    --accent: #0969da;
    --up: #cf222e;
    --down: #0969da;
    --phase2: #1a7f37;
    --yellow: #9a6700;
    --orange: #bc4c00;
    --purple: #8250df;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.6;
    padding: 0;
  }

  .container {
    max-width: 860px;
    margin: 0 auto;
    padding: 32px 24px;
  }

  /* Header */
  .report-header {
    border-bottom: 1px solid var(--border);
    padding-bottom: 24px;
    margin-bottom: 32px;
  }

  .report-header h1 {
    font-size: 1.75rem;
    font-weight: 700;
    margin-bottom: 8px;
  }

  .report-date {
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .temp-badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 0.8rem;
    font-weight: 600;
    margin-left: 12px;
  }
  .temp-badge.neutral { background: #fff8c5; color: var(--yellow); }
  .temp-badge.bullish { background: #ddf4ff; color: var(--up); }
  .temp-badge.bearish { background: #ffebe9; color: var(--down); }

  /* Content sections */
  section {
    margin-bottom: 36px;
  }

  h1 { font-size: 1.75rem; font-weight: 700; margin: 24px 0 16px; }
  h2 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
    margin-top: 32px;
  }
  h3 {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
    margin: 20px 0 12px;
  }

  p {
    margin-bottom: 12px;
    font-size: 0.9rem;
    line-height: 1.7;
  }

  ul, ol {
    margin: 8px 0 12px 20px;
    font-size: 0.9rem;
  }

  li { margin-bottom: 4px; }

  strong { font-weight: 700; }
  em { font-style: italic; }

  /* Index Cards */
  .index-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    margin-bottom: 20px;
  }

  .index-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
  }

  .index-card .label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .index-card .value {
    font-size: 1.15rem;
    font-weight: 700;
    margin: 4px 0 2px;
  }

  .index-card .change {
    font-size: 0.85rem;
    font-weight: 600;
  }

  .up { color: var(--up); }
  .down { color: var(--down); }

  .delta {
    font-size: 0.78rem;
    font-weight: 600;
    margin-left: 4px;
  }

  /* Stat Row */
  .stat-row {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
    margin: 16px 0;
  }

  .stat-chip {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 0.85rem;
    flex: 1;
    min-width: 180px;
  }

  .stat-chip .stat-label {
    color: var(--text-muted);
    font-size: 0.75rem;
    display: block;
    margin-bottom: 4px;
  }

  .stat-chip .stat-value {
    font-weight: 600;
    font-size: 1rem;
  }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    margin: 12px 0;
  }

  thead th {
    background: var(--surface);
    color: var(--text-muted);
    font-weight: 600;
    text-align: left;
    padding: 10px 12px;
    border-bottom: 2px solid var(--border);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  tbody td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }

  tbody tr:nth-child(even) {
    background: var(--surface);
  }

  tbody tr:hover {
    background: var(--surface-2);
  }

  /* Phase Badges */
  .phase-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
  }
  .phase-badge.p1 { background: #eef1f4; color: var(--text-muted); }
  .phase-badge.p2 { background: #dafbe1; color: var(--phase2); }
  .phase-badge.p3 { background: #fff8c5; color: var(--yellow); }
  .phase-badge.p4 { background: #ffebe9; color: var(--down); }

  .phase-transition {
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  .phase-transition.worse { color: var(--down); }
  .phase-transition.better { color: var(--up); }

  /* Content blocks */
  .content-block {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    margin: 12px 0;
  }

  .content-block p {
    margin-bottom: 8px;
    font-size: 0.9rem;
    line-height: 1.7;
  }

  .content-block p:last-child {
    margin-bottom: 0;
  }

  /* Stock Cards */
  .stock-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    margin: 12px 0;
  }

  .stock-card-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 10px;
  }

  .stock-ticker {
    font-size: 1rem;
    font-weight: 700;
  }

  .stock-name {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .stock-tags {
    display: flex;
    gap: 8px;
    margin-left: auto;
    flex-wrap: wrap;
  }

  .tag {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 600;
  }
  .tag.rs { background: #ddf4ff; color: var(--accent); }
  .tag.vol { background: #fbefff; color: var(--purple); }
  .tag.return-up { background: #ddf4ff; color: var(--up); }
  .tag.return-down { background: #ffebe9; color: var(--down); }

  .stock-body {
    font-size: 0.85rem;
    color: var(--text-muted);
    line-height: 1.6;
  }

  .stock-body li {
    margin-bottom: 4px;
    list-style: none;
    padding-left: 1em;
    text-indent: -1em;
  }
  .stock-body li::before {
    content: "·";
    margin-right: 6px;
    color: var(--border);
  }

  /* Divider */
  .appendix-divider {
    border: none;
    border-top: 2px solid var(--border);
    margin: 40px 0 32px;
  }

  .appendix-title {
    font-size: 0.85rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 24px;
  }

  /* Watchpoints */
  .watchpoint {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid var(--border);
  }

  .watchpoint:last-child { border-bottom: none; }

  .watchpoint-num {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 50%;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--accent);
    flex-shrink: 0;
  }

  .watchpoint-text {
    font-size: 0.9rem;
    line-height: 1.5;
  }

  /* Section icon */
  .section-icon {
    margin-right: 6px;
  }

  /* Fear & Greed */
  .fear-greed {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .fg-score {
    font-size: 1.8rem;
    font-weight: 800;
  }

  .fg-label {
    font-size: 0.8rem;
    font-weight: 600;
  }

  .fg-compare {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .extreme-fear { color: var(--down); }

  /* Phase distribution bar */
  .phase-bar {
    display: flex;
    height: 12px;
    border-radius: 6px;
    overflow: hidden;
    margin: 8px 0 14px;
  }

  .phase-bar .seg {
    transition: width 0.3s;
  }
  .phase-bar .seg.p1 { background: #d0d7de; }
  .phase-bar .seg.p2 { background: var(--phase2); }
  .phase-bar .seg.p3 { background: #eac054; }
  .phase-bar .seg.p4 { background: #cf222e; }

  .phase-legend {
    display: flex;
    gap: 16px;
    font-size: 0.78rem;
    color: var(--text-muted);
    flex-wrap: wrap;
  }

  .phase-legend span::before {
    content: "";
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 2px;
    margin-right: 4px;
    vertical-align: middle;
  }
  .phase-legend .l1::before { background: #d0d7de; }
  .phase-legend .l2::before { background: var(--phase2); }
  .phase-legend .l3::before { background: #eac054; }
  .phase-legend .l4::before { background: #cf222e; }

  /* Footer */
  .report-footer {
    margin-top: 48px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.75rem;
    text-align: center;
  }

  /* Responsive */
  @media (max-width: 600px) {
    .container { padding: 16px 12px; }
    .index-grid { grid-template-columns: repeat(2, 1fr); }
    .stock-card-header { flex-direction: column; align-items: flex-start; }
    .stock-tags { margin-left: 0; }
  }
`;

const PHASE_BADGE_PATTERN =
  /\b(Phase\s?[1-4]|P[1-4](?=\b))/g;

const PHASE_CLASS_MAP: Record<string, string> = {
  "Phase 1": "p1",
  "Phase 2": "p2",
  "Phase 3": "p3",
  "Phase 4": "p4",
  Phase1: "p1",
  Phase2: "p2",
  Phase3: "p3",
  Phase4: "p4",
  P1: "p1",
  P2: "p2",
  P3: "p3",
  P4: "p4",
};

/**
 * HTML 태그 내부(속성값 등)를 건드리지 않고 텍스트 노드에서만 치환을 수행한다.
 * `<a href="...P2...">` 같은 URL이 깨지는 것을 방지.
 */
function replaceInTextNodes(
  html: string,
  pattern: RegExp,
  replacer: (match: string, ...args: string[]) => string,
): string {
  return html.replace(/(<[^>]+>)|([^<]+)/g, (segment, tag, text) => {
    if (tag != null) return tag;
    return text.replace(pattern, replacer);
  });
}

function applyPostProcessing(html: string): string {
  // 테이블에 data-table 클래스 추가
  let result = html.replace(/<table>/g, '<table class="data-table">');

  // ▲ (상승 기호)에 up 클래스 적용 — 텍스트 노드에서만
  result = replaceInTextNodes(
    result,
    /▲\s*([\d.]+%?)/g,
    (_match, value) => `<span class="up">▲ ${value}</span>`,
  );

  // ▼ (하락 기호)에 down 클래스 적용 — 텍스트 노드에서만
  result = replaceInTextNodes(
    result,
    /▼\s*([\d.]+%?)/g,
    (_match, value) => `<span class="down">▼ ${value}</span>`,
  );

  // Phase 배지 색상 코딩 — 텍스트 노드에서만
  result = replaceInTextNodes(result, PHASE_BADGE_PATTERN, (match) => {
    const normalised = match.replace(/\s/, "");
    const phaseClass =
      PHASE_CLASS_MAP[match] ?? PHASE_CLASS_MAP[normalised] ?? "";
    if (phaseClass === "") {
      return match;
    }
    return `<span class="phase-badge ${phaseClass}">${match}</span>`;
  });

  return result;
}

/**
 * 마크다운 콘텐츠를 받아 완전한 HTML 문서로 변환한다.
 *
 * @param markdownContent - 에이전트가 생성한 마크다운 문자열
 * @param title - 리포트 제목 (헤더에 표시)
 * @param date - 리포트 날짜 (YYYY-MM-DD 형식)
 * @returns 단일 자급자족 HTML 문서 문자열
 */
export function buildHtmlReport(
  markdownContent: string,
  title: string,
  date: string,
): string {
  const rawHtml = markedInstance.parse(markdownContent) as string;
  const processedHtml = applyPostProcessing(rawHtml);

  const formattedDate = formatKoreanDate(date);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — ${escapeHtml(date)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="container">
  <header class="report-header">
    <h1>${escapeHtml(title)}</h1>
    <div class="report-date">${escapeHtml(formattedDate)} · Market Analyst</div>
  </header>
  <div class="report-body">
    ${processedHtml}
  </div>
  <footer class="report-footer">
    Generated by Market Analyst · ${escapeHtml(date)}
  </footer>
</div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatKoreanDate(dateStr: string): string {
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    return dateStr;
  }

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth() + 1;
  const day = parsed.getUTCDate();
  const weekday = WEEKDAYS[parsed.getUTCDay()];

  return `${year}년 ${month}월 ${day}일 (${weekday})`;
}
