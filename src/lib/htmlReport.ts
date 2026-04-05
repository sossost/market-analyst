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

  /* Section */
  section {
    margin-bottom: 36px;
  }

  section h2 {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--accent);
    margin-bottom: 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  section h3 {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text);
    margin: 20px 0 12px;
  }

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

  .content-block ul, .content-block ol {
    margin: 4px 0 8px 20px;
    font-size: 0.9rem;
    line-height: 1.7;
  }

  .content-block li {
    margin-bottom: 4px;
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

// ────────────────────────────────────────────────────────────
// 섹션 파싱 유틸리티
// ────────────────────────────────────────────────────────────

interface Section {
  heading: string;
  body: string;
}

/**
 * 마크다운 문자열을 `## ` 헤더 기준으로 섹션 배열로 분리한다.
 * 첫 번째 `## ` 이전의 내용은 heading이 빈 문자열인 섹션으로 반환한다.
 */
function splitIntoSections(markdown: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("## ")) {
      sections.push({ heading: currentHeading, body: currentLines.join("\n") });
      currentHeading = line.slice(3).trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  sections.push({ heading: currentHeading, body: currentLines.join("\n") });
  return sections;
}

// ────────────────────────────────────────────────────────────
// 마크다운 → 시맨틱 HTML 렌더러들
// ────────────────────────────────────────────────────────────

/**
 * 마크다운 테이블 한 줄을 셀 배열로 파싱한다.
 * `| 지수 | 종가 | 등락률 |` → `["지수", "종가", "등락률"]`
 */
function parseTableRow(line: string): string[] {
  return line
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
}

/**
 * 마크다운 테이블 구분선 여부 확인. `|---|---|` 패턴.
 */
function isTableSeparator(line: string): boolean {
  return /^\|[\s\-|:]+\|$/.test(line.trim());
}

interface ParsedTable {
  headers: string[];
  rows: string[][];
}

/**
 * 마크다운 텍스트에서 첫 번째 테이블을 파싱한다.
 * 테이블이 없으면 null을 반환한다.
 */
function parseFirstTable(text: string): ParsedTable | null {
  const lines = text.split("\n").map((l) => l.trim());
  const tableStart = lines.findIndex((l) => l.startsWith("|") && l.endsWith("|"));
  if (tableStart === -1) return null;

  const tableLines = lines.slice(tableStart).filter((l) => l.startsWith("|") && l.endsWith("|"));
  if (tableLines.length < 2) return null;

  const [headerLine, ...rest] = tableLines;
  const headers = parseTableRow(headerLine);
  const dataLines = rest.filter((l) => !isTableSeparator(l));
  const rows = dataLines.map((l) => parseTableRow(l));

  return { headers, rows };
}

/**
 * 등락률 문자열에서 up/down 클래스를 반환한다.
 * `+0.11%` → "up", `-0.13%` → "down", 그 외 → ""
 */
function getChangeClass(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("+") || trimmed.startsWith("▲")) return "up";
  if (trimmed.startsWith("-") || trimmed.startsWith("▼")) return "down";
  return "";
}

/**
 * 인라인 마크다운(볼드, 이탤릭)을 HTML로 변환하고 XSS를 방지한다.
 * 복잡한 nested 마크다운은 지원하지 않는다.
 */
function renderInlineMarkdown(text: string): string {
  const escaped = escapeHtml(text);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

/**
 * 마크다운 리스트 아이템 배열을 렌더링한다.
 * 각 `- ` 또는 `* ` 또는 `• ` 줄을 li로 변환한다.
 */
function extractListItems(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.match(/^[-*•]\s+/))
    .map((l) => l.replace(/^[-*•]\s+/, ""));
}

// ────────────────────────────────────────────────────────────
// 섹션별 렌더러
// ────────────────────────────────────────────────────────────

/**
 * "시장 온도 근거" 섹션을 시맨틱 컴포넌트로 렌더링한다.
 *
 * 변환 대상:
 * - 지수 테이블 → `.index-grid` > `.index-card`
 * - `**공포탐욕지수**:` → `.stat-chip`
 * - `**Phase 2 비율**:` → `.stat-chip`
 * - `**A/D Ratio**:` (또는 `**시장 브레드스**:`) → `.stat-chip`
 * - `**신고가 / 신저가**:` → `.stat-chip`
 * - `**Phase 분포**:` + 하위 리스트 → `.phase-bar` + `.phase-legend`
 * - 온도 판단 텍스트(`**시장 온도 판단**:`) → header의 `.temp-badge`
 *
 * 인식 실패 부분은 `marked.parse()` 폴백으로 처리한다.
 */
function renderMarketTemperatureSection(body: string): {
  html: string;
  tempBadge: string | null;
} {
  const parts: string[] = [];
  let tempBadge: string | null = null;

  try {
    // 지수 테이블 인식 및 변환
    const indexGridHtml = tryRenderIndexGrid(body);
    if (indexGridHtml != null) {
      parts.push(indexGridHtml);
    }

    // stat-chip 행 렌더링
    const statChips = renderStatChips(body);
    if (statChips.length > 0) {
      parts.push(`<div class="stat-row">${statChips.join("")}</div>`);
    }

    // Phase 분포 바 렌더링
    const phaseBarHtml = tryRenderPhaseBar(body);
    if (phaseBarHtml != null) {
      parts.push(phaseBarHtml);
    }

    // 온도 판단 배지 추출
    tempBadge = extractTempBadge(body);

    // 인식하지 못한 나머지 텍스트가 있으면 폴백으로 처리
    const unrecognizedLines = extractUnrecognizedLines(body);
    if (unrecognizedLines.trim().length > 0) {
      const fallback = markedInstance.parse(unrecognizedLines) as string;
      if (fallback.trim().length > 0) {
        parts.push(`<div class="content-block">${fallback}</div>`);
      }
    }
  } catch {
    // 파싱 오류 시 전체 폴백
    return {
      html: markedInstance.parse(body) as string,
      tempBadge: null,
    };
  }

  return { html: parts.join("\n"), tempBadge };
}

/**
 * 지수 테이블을 `.index-grid` > `.index-card` 그리드로 변환한다.
 * 테이블이 없거나 컬럼 형식이 맞지 않으면 null 반환.
 */
function tryRenderIndexGrid(body: string): string | null {
  const table = parseFirstTable(body);
  if (table == null) return null;

  // 지수 테이블 판별: 헤더에 "지수", "종가", "등락" 중 하나 이상 포함
  const isIndexTable = table.headers.some(
    (h) => h.includes("지수") || h.includes("종가") || h.includes("Index"),
  );
  if (!isIndexTable) return null;

  const cards = table.rows
    .map((row) => {
      if (row.length < 2) return "";
      const label = escapeHtml(row[0] ?? "");
      const value = escapeHtml(row[1] ?? "");
      const change = row[2] ?? "";
      const changeClass = getChangeClass(change);
      const changeHtml = `<div class="change ${changeClass}">${escapeHtml(change)}</div>`;

      return `<div class="index-card">
  <div class="label">${label}</div>
  <div class="value">${value}</div>
  ${changeHtml}
</div>`;
    })
    .join("\n");

  if (cards.trim().length === 0) return null;

  return `<div class="index-grid">${cards}</div>`;
}

/**
 * 마크다운 볼드 키 패턴(`**키**:`)에서 stat-chip HTML 배열을 생성한다.
 *
 * 지원 패턴:
 * - `**공포탐욕지수**: 15.3 (극도의 공포) | 전일 15.3 | 1주전 14.5`
 * - `**Phase 분포**: Phase 2 비율 31.3% (전일 대비 -0.04%)`
 * - `**시장 브레드스**: A/D ratio 1.39 (상승 2,831 vs 하락 2,037)`
 * - `신고가/신저가: 66/56 (비율 1.18)` (볼드 없는 형태도 지원)
 */
function renderStatChips(body: string): string[] {
  const chips: string[] = [];

  // 공포탐욕지수: 숫자 + 감성 문구, | 구분자로 비교값 분리
  const fgMatch = body.match(/\*\*공포탐욕지수\*\*\s*[:：]\s*([^\n]+)/);
  if (fgMatch != null) {
    const raw = fgMatch[1].trim();
    // `15.3 (극도의 공포) | 전일 15.3 | 1주전 14.5` 형태 파싱
    const parts = raw.split("|").map((p) => p.trim());
    const mainPart = parts[0] ?? raw;
    // `15.3 (극도의 공포)` → `15.3 극도의 공포`
    const valueCleaned = mainPart.replace(/\s*\(([^)]+)\)/, " $1").trim();
    const subParts = parts.slice(1);
    chips.push(renderStatChipWithSub("공포탐욕지수", valueCleaned, subParts.join(" · ")));
  }

  // Phase 2 비율 stat-chip — 두 가지 패턴 지원:
  // 1. `**Phase 2 비율**: 31.3% (▼0.04p)` — 별도 라인
  // 2. `**Phase 분포**: Phase 2 비율 31.3% (전일 대비 -0.04%)` — Phase 분포 라인에서 추출
  const phase2RatioMatch = body.match(/\*\*Phase 2 비율\*\*\s*[:：]\s*([^\n]+)/);
  const phaseDistMatch = body.match(/\*\*Phase 분포\*\*\s*[:：]\s*([^\n]+)/);

  if (phase2RatioMatch != null) {
    chips.push(renderStatChipWithSub("Phase 2 비율", phase2RatioMatch[1].trim(), ""));
  } else if (phaseDistMatch != null) {
    const raw = phaseDistMatch[1].trim();
    const percentMatch = raw.match(/(\d+\.?\d*)%/);
    const subMatch = raw.match(/\(([^)]+)\)/);
    const value = percentMatch != null ? `${percentMatch[1]}%` : raw;
    const sub = subMatch != null ? subMatch[1] : "";
    chips.push(renderStatChipWithSub("Phase 2 비율", value, sub));
  }

  // A/D Ratio 또는 시장 브레드스
  // 패턴: `**시장 브레드스**: A/D ratio 1.39 (상승 2,831 vs 하락 2,037)`
  const adMatch = body.match(/\*\*(?:A\/D Ratio|시장 브레드스)\*\*\s*[:：]\s*([^\n]+)/);
  if (adMatch != null) {
    const raw = adMatch[1].trim();
    // `A/D ratio 1.39 (상승 2,831 vs 하락 2,037)` → value: 1.39, sub: 상승 vs 하락
    const ratioMatch = raw.match(/(?:A\/D\s*ratio\s*)?([0-9.]+)/i);
    const subMatch = raw.match(/\(([^)]+)\)/);
    const value = ratioMatch != null ? ratioMatch[1] : raw;
    const sub = subMatch != null ? subMatch[1] : "";
    chips.push(renderStatChipWithSub("A/D Ratio", value, sub));
  }

  // 신고가 / 신저가: 볼드 있음/없음 모두 지원
  // 패턴: `**신고가 / 신저가**: 66 / 56` 또는 `신고가/신저가: 66/56 (비율 1.18)`
  const highLowMatch = body.match(/\*{0,2}신고가\s*[\/\/]\s*신저가\*{0,2}\s*[:：]\s*([^\n]+)/);
  if (highLowMatch != null) {
    const raw = highLowMatch[1].trim();
    // `66/56 (비율 1.18)` → value: 66 / 56, sub: 비율 1.18
    const valuesMatch = raw.match(/(\d+)\s*[\/\/]\s*(\d+)/);
    const subMatch = raw.match(/\(([^)]+)\)/);
    const value = valuesMatch != null ? `${valuesMatch[1]} / ${valuesMatch[2]}` : raw;
    const sub = subMatch != null ? subMatch[1] : "";
    chips.push(renderStatChipWithSub("신고가 / 신저가", value, sub));
  }

  return chips;
}

function renderStatChip(label: string, value: string): string {
  return renderStatChipWithSub(label, value, "");
}

function renderStatChipWithSub(label: string, value: string, sub: string): string {
  const subHtml = sub !== ""
    ? `\n  <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px">${escapeHtml(sub)}</div>`
    : "";
  return `<div class="stat-chip">
  <span class="stat-label">${escapeHtml(label)}</span>
  <span class="stat-value">${renderInlineMarkdown(value)}</span>${subHtml}
</div>`;
}

/**
 * Phase 분포 데이터를 파싱하여 `.phase-bar` + `.phase-legend` HTML을 반환한다.
 *
 * 지원 패턴:
 * - `**Phase 분포**:` 뒤에 오는 리스트 (`- Phase 1: N (X%)`)
 * - `Phase 1 · N (X%)` 형식의 일반 텍스트
 */
function tryRenderPhaseBar(body: string): string | null {
  // Phase 분포 섹션 시작 위치 찾기
  const distributionIndex = body.indexOf("Phase 분포");
  if (distributionIndex === -1) return null;

  const afterDistribution = body.slice(distributionIndex);

  // Phase별 수치 추출: 다양한 포맷 지원
  // 지원 패턴:
  //   Phase 1: 226 (4.9%)          — 기본
  //   Phase 1: 226종목 (4.9%)      — "종목" 글자 포함
  //   Phase 1 · 226 (4.9%)         — 가운뎃점 구분
  const phasePattern =
    /Phase\s*([1-4])\s*[:：·]\s*(?:(\d[\d,]*)(?:종목)?\s+)?\(([0-9.]+)%\)/g;

  const phaseData: Record<string, { count: string; percent: string }> = {};
  let match;

  while ((match = phasePattern.exec(afterDistribution)) !== null) {
    const phaseNum = match[1];
    const count = match[2] ?? "";
    const percent = match[3] ?? "0";
    phaseData[phaseNum] = { count, percent };
  }

  // 데이터가 충분하지 않으면 null 반환
  const hasData = Object.keys(phaseData).length >= 2;
  if (!hasData) return null;

  const barSegments = [1, 2, 3, 4]
    .map((n) => {
      const data = phaseData[String(n)];
      if (data == null) return "";
      return `<div class="seg p${n}" style="width:${data.percent}%"></div>`;
    })
    .join("\n");

  const legendItems = [1, 2, 3, 4]
    .map((n) => {
      const data = phaseData[String(n)];
      if (data == null) return "";
      const countPart = data.count !== "" ? ` · ${data.count}` : "";
      const style = n === 2 ? ' style="font-weight:700;color:var(--phase2)"' : "";
      return `<span class="l${n}"${style}>Phase ${n}${countPart} (${data.percent}%)</span>`;
    })
    .filter((s) => s !== "")
    .join("\n");

  return `<h3>Phase 분포</h3>
<div class="phase-bar">${barSegments}</div>
<div class="phase-legend">${legendItems}</div>`;
}

/**
 * 온도 판단 텍스트에서 `.temp-badge` 클래스명을 추출한다.
 * `**시장 온도 판단**:` 또는 `**온도**:` 뒤의 강세/약세/중립 텍스트를 찾는다.
 */
function extractTempBadge(body: string): string | null {
  const tempMatch = body.match(/\*\*(?:시장 온도 판단|온도)\*\*\s*[:：]\s*([^\n]+)/);
  if (tempMatch == null) return null;

  const value = tempMatch[1].trim();
  if (value.includes("강세") || value.includes("bullish")) {
    return `<span class="temp-badge bullish">강세</span>`;
  }
  if (value.includes("약세") || value.includes("bearish")) {
    return `<span class="temp-badge bearish">약세</span>`;
  }
  if (value.includes("중립") || value.includes("neutral") || value.includes("보합")) {
    return `<span class="temp-badge neutral">중립</span>`;
  }
  return null;
}

/**
 * 이미 처리된 패턴을 제외한 나머지 텍스트 블록을 반환한다.
 * 폴백 렌더링에 사용된다.
 */
function extractUnrecognizedLines(body: string): string {
  return body
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      // 테이블 라인 제외
      if (trimmed.startsWith("|")) return false;
      // 처리된 볼드 키 라인 제외
      if (/\*\*(공포탐욕지수|Phase 분포|A\/D Ratio|시장 브레드스|시장 온도 판단|온도)\*\*/.test(trimmed)) return false;
      // 볼드 없는 신고가/신저가 라인 제외
      if (/신고가\s*[\/\/]\s*신저가\s*[:：]/.test(trimmed)) return false;
      // Phase 분포 관련 라인 제외 (종목 글자 포함)
      if (/Phase 분포|Phase\s*[1-4][^:：·]*[:：·]/.test(trimmed)) return false;
      return true;
    })
    .join("\n");
}

/**
 * "섹터 RS 랭킹" 섹션을 렌더링한다.
 * 테이블은 그대로 `<table>`로 변환하고, Phase 배지를 적용한다.
 * `**주요 Phase 전환**:` 이후 텍스트는 `.content-block`으로 렌더링한다.
 */
function renderSectorRankingSection(body: string): string {
  const parts: string[] = [];

  // 섹터 RS 전용 테이블 렌더링 (컬럼 재구성)
  const sectorTableHtml = renderSectorTable(body);
  if (sectorTableHtml != null) {
    parts.push(sectorTableHtml);
  } else {
    // 폴백: 일반 테이블 렌더링
    const tableHtml = renderMarkdownTableAsHtml(body);
    if (tableHtml != null) {
      parts.push(tableHtml);
    }
  }

  // "주요 Phase 전환" 블록 추출 — sample 포맷: ▲/▼ + <p> 태그
  const transitionIndex = body.indexOf("**주요 Phase 전환**");
  if (transitionIndex !== -1) {
    const transitionText = body.slice(transitionIndex);
    const transitionHtml = renderPhaseTransitionBlock(transitionText);
    parts.push(`<div class="content-block">${transitionHtml}</div>`);
  } else {
    // 테이블 이후 텍스트 폴백 처리
    const afterTableText = extractTextAfterTable(body);
    if (afterTableText.trim().length > 0) {
      const fallback = markedInstance.parse(afterTableText) as string;
      if (fallback.trim().length > 0) {
        parts.push(`<div class="content-block">${fallback}</div>`);
      }
    }
  }

  // 섹터 테이블은 renderSectorTable에서 이미 delta/phase 배지를 처리했으므로
  // applyPhasePostProcessing을 적용하지 않는다 (이중 span 방지)
  return parts.join("\n");
}

/**
 * "업종 RS 랭킹" 섹션을 렌더링한다.
 * 테이블은 renderIndustryTable로 변환하고, "주요 업종 전환" 블록은 content-block으로 처리한다.
 */
function renderIndustryRankingSection(body: string): string {
  const parts: string[] = [];

  const industryTableHtml = renderIndustryTable(body);
  if (industryTableHtml != null) {
    parts.push(industryTableHtml);
  } else {
    const tableHtml = renderMarkdownTableAsHtml(body);
    if (tableHtml != null) {
      parts.push(tableHtml);
    }
  }

  // "주요 업종 전환" 블록 추출
  const transitionIndex = body.indexOf("**주요 업종 전환**");
  if (transitionIndex !== -1) {
    const transitionText = body.slice(transitionIndex);
    const transitionHtml = renderPhaseTransitionBlock(transitionText).replace("주요 Phase 전환", "주요 업종 전환");
    parts.push(`<div class="content-block">${transitionHtml}</div>`);
  } else {
    const afterTableText = extractTextAfterTable(body);
    if (afterTableText.trim().length > 0) {
      const fallback = markedInstance.parse(afterTableText) as string;
      if (fallback.trim().length > 0) {
        parts.push(`<div class="content-block">${fallback}</div>`);
      }
    }
  }

  return parts.join("\n");
}

/**
 * 업종 RS 테이블을 시맨틱 HTML로 변환한다.
 *
 * 컬럼 구성: # | 업종 | 소속 섹터 | RS | Divergence | Phase | 4주 변화
 * Divergence 컬러링:
 * - 양수(업종 > 섹터): class="up" — 섹터 대비 초과 강세
 * - 음수(업종 < 섹터): class="down" — 섹터 대비 약세
 */
function renderIndustryTable(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim());
  const tableStart = lines.findIndex((l) => l.startsWith("|") && l.endsWith("|"));
  if (tableStart === -1) return null;

  const tableLines = lines.slice(tableStart).filter((l) => l.startsWith("|") && l.endsWith("|"));
  if (tableLines.length < 3) return null;

  const [headerLine] = tableLines;
  const headers = parseTableRow(headerLine).map((h) => h.toLowerCase().trim());

  // 업종 RS 테이블인지 확인 (업종 컬럼 + RS 컬럼 필수)
  const hasRS = headers.some((h) => h === "rs");
  const hasIndustry = headers.some((h) => h.includes("업종") || h.includes("industry"));
  if (!hasRS || !hasIndustry) return null;

  // 컬럼 인덱스 매핑
  const colIdx = {
    rank: headers.findIndex((h) => h === "순위" || h === "#"),
    industry: headers.findIndex((h) => h.includes("업종") || h.includes("industry")),
    sector: headers.findIndex((h) => h.includes("섹터") || h.includes("sector")),
    rs: headers.findIndex((h) => h === "rs"),
    divergence: headers.findIndex((h) => h.includes("divergence") || h.includes("다이버전스")),
    phase: headers.findIndex((h) => h.includes("phase") && !h.includes("비율") && !h.includes("2")),
    w4: headers.findIndex((h) => h.includes("4주")),
    p2ratio: headers.findIndex((h) => h.includes("비율") || h.includes("p2")),
  };

  const dataLines = tableLines.slice(2).filter((l) => !isTableSeparator(l));
  const rows = dataLines.map((l) => parseTableRow(l));

  const headerHtml = `<thead><tr>
    <th>#</th>
    <th>업종</th>
    <th>소속 섹터</th>
    <th>RS</th>
    <th>Divergence</th>
    <th style="text-align:right">Phase</th>
    <th>4주 변화</th>
  </tr></thead>`;

  const bodyRows = rows.map((cells) => {
    const rank = colIdx.rank >= 0 ? cells[colIdx.rank]?.trim() ?? "" : "";
    const industry = colIdx.industry >= 0 ? cells[colIdx.industry]?.trim() ?? "" : "";
    const sector = colIdx.sector >= 0 ? cells[colIdx.sector]?.trim() ?? "" : "";
    const rs = colIdx.rs >= 0 ? cells[colIdx.rs]?.trim() ?? "" : "";
    const divergenceRaw = colIdx.divergence >= 0 ? cells[colIdx.divergence]?.trim() ?? "" : "";
    const phase = colIdx.phase >= 0 ? cells[colIdx.phase]?.trim() ?? "" : "";
    const w4 = colIdx.w4 >= 0 ? cells[colIdx.w4]?.trim() ?? "" : "";

    // Divergence 컬러링: 양수 → up(빨강), 음수 → down(파랑)
    const divergenceNum = parseFloat(divergenceRaw.replace(/[+,]/g, ""));
    let divergenceHtml: string;
    if (!isNaN(divergenceNum) && divergenceNum > 0) {
      divergenceHtml = `<span class="up">${escapeHtml(divergenceRaw.startsWith("+") ? divergenceRaw : `+${divergenceRaw}`)}</span>`;
    } else if (!isNaN(divergenceNum) && divergenceNum < 0) {
      divergenceHtml = `<span class="down">${escapeHtml(divergenceRaw)}</span>`;
    } else {
      divergenceHtml = escapeHtml(divergenceRaw);
    }

    // 4주 변화 컬러
    const w4Class = w4.startsWith("+") ? ' class="up"' : w4.startsWith("-") ? ' class="down"' : "";

    // Phase 배지
    const phaseCell = formatPhaseCell(phase);

    return `<tr>
      <td>${escapeHtml(rank)}</td>
      <td><strong>${escapeHtml(industry)}</strong></td>
      <td>${escapeHtml(sector)}</td>
      <td>${escapeHtml(rs)}</td>
      <td>${divergenceHtml}</td>
      <td style="text-align:right">${phaseCell}</td>
      <td${w4Class}>${escapeHtml(w4)}</td>
    </tr>`;
  }).join("\n");

  return `<table>\n${headerHtml}\n<tbody>${bodyRows}</tbody>\n</table>`;
}

/**
 * 섹터 RS 테이블을 sample-report.html 포맷으로 재구성한다.
 *
 * 마크다운 컬럼: 순위 | 섹터 | RS | 전일 RS | 변화 | Group Phase | 4주 변화 | 8주 변화 | Phase 2 비율
 * sample 컬럼:   #    | 섹터 | RS(▲▼인라인) | 4주  | 8주  | Phase(우측정렬) | P2 비율
 */
function renderSectorTable(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim());
  const tableStart = lines.findIndex((l) => l.startsWith("|") && l.endsWith("|"));
  if (tableStart === -1) return null;

  const tableLines = lines.slice(tableStart).filter((l) => l.startsWith("|") && l.endsWith("|"));
  if (tableLines.length < 3) return null;

  const [headerLine] = tableLines;
  const headers = parseTableRow(headerLine).map((h) => h.toLowerCase().trim());

  // 섹터 RS 테이블인지 확인 (RS, 섹터 컬럼 필수)
  const hasRS = headers.some((h) => h === "rs");
  const hasSector = headers.some((h) => h.includes("섹터") || h.includes("sector"));
  const hasIndustry = headers.some((h) => h.includes("업종") || h.includes("industry"));
  // 업종 테이블(업종 컬럼 포함)을 섹터 테이블로 오판하지 않도록 방어
  if (!hasRS || !hasSector || hasIndustry) return null;

  // 컬럼 인덱스 매핑
  const colIdx = {
    rank: headers.findIndex((h) => h === "순위" || h === "#"),
    sector: headers.findIndex((h) => h.includes("섹터") || h.includes("sector")),
    rs: headers.findIndex((h) => h === "rs"),
    change: headers.findIndex((h) => h === "변화" || h === "change"),
    phase: headers.findIndex((h) => h.includes("phase") && !h.includes("비율") && !h.includes("2")),
    w4: headers.findIndex((h) => h.includes("4주")),
    w8: headers.findIndex((h) => h.includes("8주")),
    p2ratio: headers.findIndex((h) => h.includes("비율") || h.includes("p2")),
  };

  const dataLines = tableLines.slice(2).filter((l) => !isTableSeparator(l));
  const rows = dataLines.map((l) => parseTableRow(l));

  const headerHtml = `<thead><tr>
    <th>#</th>
    <th>섹터</th>
    <th>RS</th>
    <th>4주 RS</th>
    <th>8주 RS</th>
    <th style="text-align:right">Phase</th>
    <th>P2 비율</th>
  </tr></thead>`;

  const bodyRows = rows.map((cells) => {
    const rank = colIdx.rank >= 0 ? cells[colIdx.rank]?.trim() ?? "" : "";
    const sector = colIdx.sector >= 0 ? cells[colIdx.sector]?.trim() ?? "" : "";
    const rs = colIdx.rs >= 0 ? cells[colIdx.rs]?.trim() ?? "" : "";
    const change = colIdx.change >= 0 ? cells[colIdx.change]?.trim() ?? "" : "";
    const phase = colIdx.phase >= 0 ? cells[colIdx.phase]?.trim() ?? "" : "";
    const w4 = colIdx.w4 >= 0 ? cells[colIdx.w4]?.trim() ?? "" : "";
    const w8 = colIdx.w8 >= 0 ? cells[colIdx.w8]?.trim() ?? "" : "";
    const p2ratio = colIdx.p2ratio >= 0 ? cells[colIdx.p2ratio]?.trim() ?? "" : "";

    // RS + 변화 인라인
    const changeDelta = formatDelta(change);
    const rsCell = `${escapeHtml(rs)} ${changeDelta}`;

    // 4주/8주: class를 td에 직접 적용 (sample 방식)
    const w4Class = w4.trim().startsWith("+") ? ' class="up"' : w4.trim().startsWith("-") ? ' class="down"' : "";
    const w8Class = w8.trim().startsWith("+") ? ' class="up"' : w8.trim().startsWith("-") ? ' class="down"' : "";

    // Phase 배지 (전환 포맷: "3 (2→3)" → "2 → <badge>3</badge>")
    const phaseCell = formatPhaseCell(phase);

    // P2 비율
    const p2Cell = escapeHtml(p2ratio);

    return `<tr>
      <td>${escapeHtml(rank)}</td>
      <td><strong>${escapeHtml(sector)}</strong></td>
      <td>${rsCell}</td>
      <td${w4Class}>${escapeHtml(w4.trim())}</td>
      <td${w8Class}>${escapeHtml(w8.trim())}</td>
      <td style="text-align:right">${phaseCell}</td>
      <td>${p2Cell}</td>
    </tr>`;
  }).join("\n");

  return `<table>\n${headerHtml}\n<tbody>${bodyRows}</tbody>\n</table>`;
}

/** ▲0.37 / ▼0.75 형태의 delta span */
function formatDelta(change: string): string {
  const cleaned = change.replace(/[▲▼+\-\s]/g, "");
  if (cleaned === "" || cleaned === "0") return "";
  const isUp = change.includes("▲") || change.includes("+");
  const isDown = change.includes("▼") || change.includes("-");
  if (!isUp && !isDown) return `<span class="delta">${escapeHtml(change)}</span>`;
  const cls = isUp ? "up" : "down";
  const arrow = isUp ? "▲" : "▼";
  return `<span class="delta ${cls}">${arrow}${escapeHtml(cleaned)}</span>`;
}

/** +3.0 → class="up", -2.4 → class="down" */
function formatSignedCell(val: string): string {
  const trimmed = val.trim();
  if (trimmed.startsWith("+")) return `<span class="up">${escapeHtml(trimmed)}</span>`;
  if (trimmed.startsWith("-")) return `<span class="down">${escapeHtml(trimmed)}</span>`;
  return escapeHtml(trimmed);
}

/** Phase 셀 렌더링: "2" → badge, "3 (2→3)" → "2 → <badge>3</badge>", "3 (3→3)" → badge만 */
function formatPhaseCell(phase: string): string {
  // 전환 패턴: "3 (2→3)" 또는 "1 (3→1)"
  const transitionMatch = phase.match(/\d+\s*\((\d)→(\d)\)/);
  if (transitionMatch != null) {
    const from = transitionMatch[1];
    const to = transitionMatch[2];
    // 전환 없으면 (from === to) 현재 Phase 배지만
    if (from === to) {
      return `<span class="phase-badge p${to}">${to}</span>`;
    }
    return `${from} → <span class="phase-badge p${to}">${to}</span>`;
  }
  // 단일 Phase
  const singleMatch = phase.match(/^(\d)$/);
  if (singleMatch != null) {
    return `<span class="phase-badge p${singleMatch[1]}">${singleMatch[1]}</span>`;
  }
  return escapeHtml(phase);
}

/**
 * 주요 Phase 전환 블록을 sample 포맷으로 렌더링.
 * sample: <p><span class="down">▼</span> Energy Phase 2→3 — 사유</p>
 *
 * 마크다운 입력:
 * **주요 Phase 전환**:
 * - Energy: Phase 2→3 전환 — 사유
 * - Healthcare: Phase 3→1 전환 — 사유
 */
function renderPhaseTransitionBlock(text: string): string {
  const lines = text.split("\n");
  const parts: string[] = ["<p><strong>주요 Phase 전환</strong></p>"];

  for (const line of lines) {
    const trimmed = line.trim();
    // "- Sector: Phase N→N ..." 또는 "- Sector Phase N→N ..."
    const match = trimmed.match(/^-\s*(.+?)(?::|:)\s*Phase\s*(\d)→(\d)\s*(?:전환\s*)?[—–-]\s*(.+)/);
    if (match != null) {
      const [, sector, from, to, reason] = match;
      const fromNum = parseInt(from, 10);
      const toNum = parseInt(to, 10);
      // 숫자가 커지면 악화(▼), 작아지면 개선(▲)
      const isImproved = toNum < fromNum;
      const arrow = isImproved ? "up" : "down";
      const arrowChar = isImproved ? "▲" : "▼";
      parts.push(`<p><span class="${arrow}">${arrowChar}</span> ${escapeHtml(sector.trim())} Phase ${from}→${to} — ${escapeHtml(reason.trim())}</p>`);
      continue;
    }
    // 볼드 리스트 아이템 폴백: "- Energy: Phase 2→3 전환"
    const simpleFallback = trimmed.match(/^-\s*(.+?)(?::|:)\s*Phase\s*(\d)→(\d)\s*(.*)/);
    if (simpleFallback != null) {
      const [, sector, from, to, rest] = simpleFallback;
      const fromNum = parseInt(from, 10);
      const toNum = parseInt(to, 10);
      const isImproved = toNum < fromNum;
      const arrow = isImproved ? "up" : "down";
      const arrowChar = isImproved ? "▲" : "▼";
      const suffix = rest.trim().replace(/^전환\s*/, "");
      parts.push(`<p><span class="${arrow}">${arrowChar}</span> ${escapeHtml(sector.trim())} Phase ${from}→${to}${suffix ? ` — ${escapeHtml(suffix)}` : ""}</p>`);
    }
  }

  return parts.join("\n");
}

/**
 * 마크다운 테이블 전체를 `<table>` HTML로 변환한다.
 */
function renderMarkdownTableAsHtml(text: string): string | null {
  const lines = text.split("\n").map((l) => l.trim());
  const tableStart = lines.findIndex((l) => l.startsWith("|") && l.endsWith("|"));
  if (tableStart === -1) return null;

  const tableLines = lines.slice(tableStart).filter((l) => l.startsWith("|") && l.endsWith("|"));
  if (tableLines.length < 2) return null;

  const [headerLine, , ...dataLines] = tableLines; // 두 번째는 구분선
  const headers = parseTableRow(headerLine);
  const rows = dataLines
    .filter((l) => !isTableSeparator(l))
    .map((l) => parseTableRow(l));

  const headerHtml = headers
    .map((h) => `<th>${renderInlineMarkdown(h)}</th>`)
    .join("");
  const bodyHtml = rows
    .map((row) => {
      const cells = row.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("\n");

  return `<table>
<thead><tr>${headerHtml}</tr></thead>
<tbody>${bodyHtml}</tbody>
</table>`;
}

/**
 * 테이블 이후 텍스트만 추출한다.
 */
function extractTextAfterTable(text: string): string {
  const lines = text.split("\n");
  let inTable = false;
  let passedTable = false;
  const result: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) {
      inTable = true;
      passedTable = true;
    } else if (inTable) {
      inTable = false;
    }

    if (passedTable && !inTable) {
      result.push(line);
    }
  }

  return result.join("\n");
}

/**
 * "전일 대비 변화 요약" 섹션을 `.content-block` 컴포넌트로 렌더링한다.
 * `### h3` 서브헤더 전후로 블록을 분리한다.
 */
function renderChangeSummarySection(body: string): string {
  return renderContentBlockSection(body);
}

/**
 * "시장 흐름 및 종합 전망" 섹션을 렌더링한다.
 * 본문 텍스트는 `.content-block`, 번호 리스트는 `.watchpoint` 컴포넌트로 변환한다.
 */
function renderOutlookSection(body: string): string {
  const parts: string[] = [];

  // "향후 관전 포인트" 또는 번호 리스트 이전 텍스트 추출
  const watchpointIndex = findWatchpointStart(body);

  if (watchpointIndex !== -1) {
    const beforeWatchpoints = body.slice(0, watchpointIndex).trim();
    const afterWatchpoints = body.slice(watchpointIndex).trim();

    if (beforeWatchpoints.length > 0) {
      const contentHtml = renderContentBlockSection(beforeWatchpoints);
      parts.push(contentHtml);
    }

    // 향후 관전 포인트 헤더 추출 (### 태그)
    const h3Match = afterWatchpoints.match(/^###\s+(.+)/m);
    if (h3Match != null) {
      parts.push(`<h3>${escapeHtml(h3Match[1].trim())}</h3>`);
    }

    const watchpointsHtml = renderWatchpoints(afterWatchpoints);
    parts.push(watchpointsHtml);
  } else {
    parts.push(renderContentBlockSection(body));
  }

  return parts.join("\n");
}

/**
 * "향후 관전 포인트" 섹션 또는 번호 리스트 시작 위치를 찾는다.
 */
function findWatchpointStart(body: string): number {
  // `### 향후 관전 포인트` 헤더
  const h3Index = body.search(/###\s+향후\s*관전/);
  if (h3Index !== -1) return h3Index;

  // 본문에 있는 `1. ` 번호 리스트 시작
  const olIndex = body.search(/^\s*1\.\s+/m);
  if (olIndex !== -1) return olIndex;

  return -1;
}

/**
 * 번호 리스트 항목들을 `.watchpoint` 컴포넌트로 변환한다.
 */
function renderWatchpoints(text: string): string {
  const listItemPattern = /^\s*(\d+)\.\s+(.+)$/gm;
  const items: string[] = [];
  let match;

  while ((match = listItemPattern.exec(text)) !== null) {
    const num = escapeHtml(match[1]);
    const content = renderInlineMarkdown(match[2].trim());
    items.push(`<div class="watchpoint">
  <div class="watchpoint-num">${num}</div>
  <div class="watchpoint-text">${content}</div>
</div>`);
  }

  if (items.length === 0) {
    return markedInstance.parse(text) as string;
  }

  return items.join("\n");
}

/**
 * 일반 텍스트 섹션을 `.content-block` 컴포넌트로 렌더링한다.
 * `### h3` 헤더가 있으면 헤더 + 내용 블록으로 분리한다.
 */
function renderContentBlockSection(body: string): string {
  const lines = body.split("\n");
  const parts: string[] = [];
  let currentBlock: string[] = [];

  const flushBlock = () => {
    const blockText = currentBlock.join("\n").trim();
    if (blockText.length > 0) {
      const html = markedInstance.parse(blockText) as string;
      if (html.trim().length > 0) {
        parts.push(`<div class="content-block">${html}</div>`);
      }
    }
    currentBlock = [];
  };

  for (const line of lines) {
    if (line.startsWith("### ")) {
      flushBlock();
      parts.push(`<h3>${escapeHtml(line.slice(4).trim())}</h3>`);
    } else {
      currentBlock.push(line);
    }
  }

  flushBlock();
  return parts.join("\n");
}

/**
 * h3 서브섹션을 content-block 카드로 렌더링한다.
 * "다음 주 관전 포인트", "리스크 경고" 등 종목이 아닌 분석 섹션에 사용.
 */
function renderSubsectionCards(body: string): string {
  const lines = body.split("\n");
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("### ")) {
      if (currentLines.some((l) => l.trim().length > 0)) {
        sections.push({ heading: currentHeading, lines: currentLines });
      }
      currentHeading = line.slice(4).trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.some((l) => l.trim().length > 0)) {
    sections.push({ heading: currentHeading, lines: currentLines });
  }

  if (sections.length === 0) return "";

  return sections
    .map(({ heading, lines: sLines }) => {
      const contentBody = sLines.join("\n").trim();
      const renderedBody = applyPostProcessing(
        markedInstance.parse(contentBody) as string,
      );
      if (heading === "") {
        return `<div class="content-block">${renderedBody}</div>`;
      }
      return `<h3>${escapeHtml(heading)}</h3>\n<div class="content-block">${renderedBody}</div>`;
    })
    .join("\n");
}

/**
 * 부록 헤더 섹션의 body를 렌더링한다.
 * ### h3 헤더를 <section> + <h2>로 변환하고, 각 하위 내용을 stock-card 섹션으로 처리한다.
 * h3 헤더가 없으면 전체를 stock-card 섹션으로 처리한다.
 */
function renderAppendixBodySection(body: string): string {
  const lines = body.split("\n");
  const sections: Array<{ heading: string; lines: string[] }> = [];
  let currentHeading = "";
  let currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("### ")) {
      if (currentLines.some((l) => l.trim().length > 0)) {
        sections.push({ heading: currentHeading, lines: currentLines });
      }
      currentHeading = line.slice(4).trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.some((l) => l.trim().length > 0)) {
    sections.push({ heading: currentHeading, lines: currentLines });
  }

  if (sections.length === 0) return "";

  return sections
    .map(({ heading, lines: sLines }) => {
      const sectionBody = sLines.join("\n");
      const sectionIcon = getSectionIcon(heading);
      const iconHtml = sectionIcon !== "" ? `<span class="section-icon">${sectionIcon}</span>` : "";
      const headingLower = heading.toLowerCase();
      // "해제", "예비 워치리스트" 등은 종목 카드가 아니라 content-block으로 렌더링
      const useContentBlock =
        headingLower.includes("해제") ||
        headingLower.includes("예비") ||
        headingLower.includes("관찰");
      const sectionHtml = useContentBlock
        ? `<div class="content-block">${applyPostProcessing(markedInstance.parse(sectionBody) as string)}</div>`
        : renderStockCardSection(sectionBody);
      if (heading === "") {
        return sectionHtml;
      }
      return `<section>\n<h3>${iconHtml}${escapeHtml(heading)}</h3>\n${sectionHtml}\n</section>`;
    })
    .join("\n");
}

/**
 * 부록 구분선 이후 섹션들을 렌더링한다.
 * `---` + `📋 **부록: 종목 상세**` 패턴 인식.
 */
function renderAppendixIntro(remainingMarkdown: string): {
  html: string;
  rest: string;
} {
  const hrPattern = /^---\s*$/m;
  const hrIndex = remainingMarkdown.search(hrPattern);

  if (hrIndex === -1) {
    return { html: "", rest: remainingMarkdown };
  }

  const afterHr = remainingMarkdown.slice(hrIndex).replace(hrPattern, "").trim();

  // 부록 제목 라인 추출 (📋 **부록: 종목 상세** 또는 유사 패턴)
  const appendixTitleMatch = afterHr.match(/^[📋\s]*\*{0,2}부록[:：][^\n]*\*{0,2}/m);
  let rest = afterHr;
  let titleHtml = "";

  if (appendixTitleMatch != null) {
    const titleText = appendixTitleMatch[0].replace(/\*+/g, "").trim();
    titleHtml = `<div class="appendix-title">${escapeHtml(titleText)}</div>`;
    rest = afterHr.slice(appendixTitleMatch.index! + appendixTitleMatch[0].length).trim();
  }

  return {
    html: `<hr class="appendix-divider">\n${titleHtml}`,
    rest,
  };
}

/**
 * 종목 카드 섹션을 렌더링한다.
 * `**TICKER (Name)**` 또는 `**TICKER**` 패턴의 종목을 `.stock-card`로 변환한다.
 *
 * 인식 패턴:
 * - `**TICKER (종목명)** +X.X%(일간) RS XX Vol X.Xx | Phase X | 섹터`
 * - `**TICKER** +X.X%` (이름 없는 단축 형태)
 * - `- **TICKER (Name)** +X.X%` (리스트 아이템 형태)
 * - `### TICKER — 설명` (h3 헤더 형태)
 * - 볼드 서브섹션 헤더 (`**⭐ 강세 특이종목 (거래량 2x 이상 동반)**`) → <h3>
 */
function renderStockCardSection(body: string): string {
  // 볼드 서브섹션 헤더와 stock block을 함께 처리하기 위해 라인 단위로 분리
  const lines = body.split("\n");
  const parts: string[] = [];
  let stockBuffer: string[] = [];

  const flushStockBuffer = () => {
    if (stockBuffer.length === 0) return;
    const bufferText = stockBuffer.join("\n");
    const stockBlocks = splitIntoStockBlocks(bufferText);
    if (stockBlocks.length > 0) {
      parts.push(stockBlocks.map(renderSingleStockCard).join("\n"));
    } else {
      const fallback = applyPhasePostProcessing(markedInstance.parse(bufferText) as string);
      if (fallback.trim().length > 0) {
        parts.push(fallback);
      }
    }
    stockBuffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    // 볼드 서브섹션 헤더 감지: `**이모지 텍스트**` 또는 `**볼드텍스트**` 패턴
    // ticker 패턴([A-Z]{1,8})이 아닌 볼드 라인
    const boldSubheaderMatch = trimmed.match(/^\*\*([^*]+)\*\*\s*$/);
    if (boldSubheaderMatch != null) {
      // ticker 패턴([A-Z]{1,5}만 대문자인 경우)이 아니면 서브헤더로 처리
      const innerText = boldSubheaderMatch[1];
      const isTickerOnly = /^[A-Z]{1,8}$/.test(innerText);
      const hasTickerWithName = /^[A-Z]{1,8}\s+\(/.test(innerText);
      if (!isTickerOnly && !hasTickerWithName) {
        flushStockBuffer();
        const subheadingText = innerText.replace(/^[⭐◎⚠️🔍🌱📊🏭🔄🔭\s]+/, "").trim();
        if (subheadingText !== "") {
          parts.push(`<h3>${escapeHtml(subheadingText)}</h3>`);
        }
        continue;
      }
    }
    stockBuffer.push(line);
  }

  flushStockBuffer();

  if (parts.length === 0) {
    return applyPhasePostProcessing(markedInstance.parse(body) as string);
  }

  return parts.join("\n");
}

interface StockBlock {
  ticker: string;
  name: string;
  tags: string[];
  bodyLines: string[];
}

/**
 * 섹션 본문을 종목 블록으로 분리한다.
 *
 * 지원하는 종목 헤더 패턴:
 * 1. `**TICKER (Name)** — 설명` — 볼드 직접, 대시 뒤 텍스트가 body 첫 줄
 * 2. `**TICKER (Name)** +X.X%(일간) RS XX Vol X.Xx` — 볼드 직접, 태그 포함
 * 3. `- **TICKER (Name)** +X.X%(일간) RS XX` — 리스트 아이템 내 볼드
 * 4. `### TICKER — 설명` — h3 헤더 형태
 */
function splitIntoStockBlocks(body: string): StockBlock[] {
  const blocks: StockBlock[] = [];
  const lines = body.split("\n");
  let current: StockBlock | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    // 리스트 아이템 내 **TICKER** 패턴: `- **TICKER (Name)** ...`
    // `  - **TICKER** ...` 형태도 포함
    const listBoldMatch = trimmed.match(/^-\s+\*\*([A-Z]{1,8})(?:\s+\(([^)]+)\))?\*\*\s*(.*)/);
    if (listBoldMatch != null) {
      if (current != null) blocks.push(current);
      const [, ticker, name = "", rest] = listBoldMatch;
      // 대시(—) 뒤 텍스트를 body로
      const dashIndex = rest.indexOf("—");
      if (dashIndex !== -1 && extractStockTags(rest.slice(0, dashIndex)).length === 0) {
        const bodyText = rest.slice(dashIndex + 1).trim();
        current = {
          ticker,
          name,
          tags: extractStockTags(rest.slice(0, dashIndex)),
          bodyLines: bodyText !== "" ? [bodyText] : [],
        };
      } else {
        current = {
          ticker,
          name,
          tags: extractStockTags(rest),
          bodyLines: [],
        };
      }
      continue;
    }

    // 직접 **TICKER (Name)** 또는 **TICKER** 헤더 패턴
    const boldHeaderMatch = trimmed.match(/^\*\*([A-Z]{1,8})(?:\s+\(([^)]+)\))?\*\*\s*(.*)/);
    if (boldHeaderMatch != null) {
      if (current != null) blocks.push(current);
      const [, ticker, name = "", rest] = boldHeaderMatch;
      // `**TH (Target)** — 설명` 패턴: 대시 뒤 텍스트는 body
      const dashIndex = rest.indexOf("—");
      if (dashIndex !== -1 && extractStockTags(rest.slice(0, dashIndex)).length === 0) {
        const bodyText = rest.slice(dashIndex + 1).trim();
        current = {
          ticker,
          name,
          tags: [],
          bodyLines: bodyText !== "" ? [bodyText] : [],
        };
      } else {
        current = {
          ticker,
          name,
          tags: extractStockTags(rest),
          bodyLines: [],
        };
      }
      continue;
    }

    // `### TICKER — 설명` 또는 `### TICKER` 헤더 패턴
    const h3Match = trimmed.match(/^###\s+([A-Z]{1,8})\s*(?:—|-|:)?\s*(.*)/);
    if (h3Match != null) {
      if (current != null) blocks.push(current);
      const [, ticker, rest] = h3Match;
      current = {
        ticker,
        name: "",
        tags: extractStockTags(rest),
        bodyLines: rest ? [rest] : [],
      };
      continue;
    }

    if (current != null) {
      // 리스트 아이템 또는 일반 텍스트 본문 추가
      current.bodyLines.push(trimmed);
    }
  }

  if (current != null) blocks.push(current);
  return blocks;
}

/**
 * 종목 헤더 나머지 텍스트에서 태그 정보를 추출한다.
 * `+16.4%(일간) RS 96 Vol 3.2x | Phase 2 | Healthcare`
 * `+16.4%` (일간 접미사 포함 가능)
 */
function extractStockTags(rest: string): string[] {
  const tags: string[] = [];

  // 수익률 태그: +X.X%(일간) 또는 -X.X%
  const returnMatch = rest.match(/([+-][0-9.]+%)(?:\([^)]*\))?/);
  if (returnMatch != null) {
    const value = returnMatch[1];
    const tagClass = value.startsWith("+") ? "return-up" : "return-down";
    tags.push(`<span class="tag ${tagClass}">${escapeHtml(value)}</span>`);
  }

  // RS 태그: RS XX
  const rsMatch = rest.match(/RS\s+(\d+)/);
  if (rsMatch != null) {
    tags.push(`<span class="tag rs">RS ${escapeHtml(rsMatch[1])}</span>`);
  }

  // Vol 태그: Vol X.Xx
  const volMatch = rest.match(/Vol\s+([0-9.]+x?)/i);
  if (volMatch != null) {
    tags.push(`<span class="tag vol">Vol ${escapeHtml(volMatch[1])}</span>`);
  }

  return tags;
}

/**
 * 단일 종목 블록을 `.stock-card` HTML로 변환한다.
 */
function renderSingleStockCard(block: StockBlock): string {
  const nameHtml = block.name !== ""
    ? `<span class="stock-name">${escapeHtml(block.name)}</span>`
    : "";
  const tagsHtml = block.tags.length > 0
    ? `<div class="stock-tags">${block.tags.join("")}</div>`
    : "";

  const bodyItems = block.bodyLines
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const cleaned = l.replace(/^[-*•]\s*/, "");
      return `<li>${renderInlineMarkdown(cleaned)}</li>`;
    })
    .join("\n");

  const bodyHtml = bodyItems !== ""
    ? `<div class="stock-body"><ul>${bodyItems}</ul></div>`
    : "";

  return `<div class="stock-card">
  <div class="stock-card-header">
    <span class="stock-ticker">${escapeHtml(block.ticker)}</span>
    ${nameHtml}
    ${tagsHtml}
  </div>
  ${bodyHtml}
</div>`;
}

// ────────────────────────────────────────────────────────────
// 후처리
// ────────────────────────────────────────────────────────────

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

/**
 * Phase 관련 후처리만 적용한다 (▲▼ 색상 + Phase 배지).
 */
function applyPhasePostProcessing(html: string): string {
  let result = html;

  result = replaceInTextNodes(
    result,
    /▲\s*([\d.]+%?)/g,
    (_match, value) => `<span class="up">▲ ${value}</span>`,
  );

  result = replaceInTextNodes(
    result,
    /▼\s*([\d.]+%?)/g,
    (_match, value) => `<span class="down">▼ ${value}</span>`,
  );

  result = replaceInTextNodes(result, PHASE_BADGE_PATTERN, (match) => {
    const normalised = match.replace(/\s/, "");
    const phaseClass =
      PHASE_CLASS_MAP[match] ?? PHASE_CLASS_MAP[normalised] ?? "";
    if (phaseClass === "") return match;
    return `<span class="phase-badge ${phaseClass}">${match}</span>`;
  });

  return result;
}

function applyPostProcessing(html: string): string {
  let result = html.replace(/<table>/g, '<table class="data-table">');

  result = replaceInTextNodes(
    result,
    /▲\s*([\d.]+%?)/g,
    (_match, value) => `<span class="up">▲ ${value}</span>`,
  );

  result = replaceInTextNodes(
    result,
    /▼\s*([\d.]+%?)/g,
    (_match, value) => `<span class="down">▼ ${value}</span>`,
  );

  result = replaceInTextNodes(result, PHASE_BADGE_PATTERN, (match) => {
    const normalised = match.replace(/\s/, "");
    const phaseClass =
      PHASE_CLASS_MAP[match] ?? PHASE_CLASS_MAP[normalised] ?? "";
    if (phaseClass === "") return match;
    return `<span class="phase-badge ${phaseClass}">${match}</span>`;
  });

  return result;
}

// ────────────────────────────────────────────────────────────
// 섹션 헤더 정규화
// ────────────────────────────────────────────────────────────

/** 섹션 헤딩에서 이모지와 볼드 마크업을 제거한 순수 텍스트를 반환한다. */
function normalizeHeading(heading: string): string {
  return heading
    .replace(/\*+/g, "")
    .replace(/[\u{1F300}-\u{1FFFF}]/gu, "")
    .replace(/[\u2600-\u27FF]/g, "")
    .trim();
}

/** 섹션 헤딩이 특정 키워드를 포함하는지 확인한다. */
function headingContains(heading: string, ...keywords: string[]): boolean {
  const normalized = normalizeHeading(heading);
  return keywords.some((k) => normalized.includes(k));
}

// ────────────────────────────────────────────────────────────
// 섹션 이모지/아이콘 추출
// ────────────────────────────────────────────────────────────

const SECTION_ICON_MAP: Record<string, string> = {
  "시장 온도": "📊",
  "섹터 RS": "🏭",
  "전일 대비": "🔄",
  "종합 전망": "🔭",
  "시장 흐름": "🔭",
  "전일 특이종목": "🔍",
  "거래량 미동반": "◎",
  // 강세 특이종목은 거래량 미동반보다 먼저 확인
  "강세 특이종목": "⭐",
  "약세 특이종목": "⚠️",
  "역분할": "⚠️",
  "주도주 예비군": "🌱",
  "업종 RS": "🏭",
  "주도 업종": "🏭",
};

function getSectionIcon(heading: string): string {
  for (const [key, icon] of Object.entries(SECTION_ICON_MAP)) {
    if (heading.includes(key)) return icon;
  }
  return "";
}

// ────────────────────────────────────────────────────────────
// 섹션 타입별 렌더링 헬퍼
// ────────────────────────────────────────────────────────────

/**
 * 섹션 헤딩에 따라 적절한 렌더러를 호출하고 `<section>` 태그로 감싼다.
 * `hrInBody` 분기에서 섹션 본문을 렌더링할 때 사용한다.
 */
function renderSectionByType(
  heading: string,
  body: string,
  iconHtml: string,
  cleanHeading: string,
): { html: string; tempBadge: string | null } {
  if (headingContains(heading, "시장 온도")) {
    const result = renderMarketTemperatureSection(body);
    return {
      html: `<section>\n<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>\n${result.html}\n</section>`,
      tempBadge: result.tempBadge,
    };
  }

  if (headingContains(heading, "섹터 RS", "RS 랭킹")) {
    const sectionHtml = renderSectorRankingSection(body);
    return {
      html: `<section>\n<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>\n${sectionHtml}\n</section>`,
      tempBadge: null,
    };
  }

  if (headingContains(heading, "업종 RS", "주도 업종")) {
    const sectionHtml = renderIndustryRankingSection(body);
    return {
      html: `<section>\n<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>\n${sectionHtml}\n</section>`,
      tempBadge: null,
    };
  }

  if (headingContains(heading, "전일 대비", "변화 요약")) {
    const sectionHtml = renderChangeSummarySection(body);
    return {
      html: `<section>\n<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>\n${sectionHtml}\n</section>`,
      tempBadge: null,
    };
  }

  if (headingContains(heading, "종합 전망", "시장 흐름")) {
    const sectionHtml = renderOutlookSection(body);
    return {
      html: `<section>\n<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>\n${sectionHtml}\n</section>`,
      tempBadge: null,
    };
  }

  if (headingContains(heading, "특이종목", "예비군", "관심종목")) {
    const sectionHtml = renderStockCardSection(body);
    return {
      html: `<section>\n<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>\n${sectionHtml}\n</section>`,
      tempBadge: null,
    };
  }

  const fallbackHtml = applyPostProcessing(markedInstance.parse(body) as string);
  return {
    html: `<section>\n<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>\n${fallbackHtml}\n</section>`,
    tempBadge: null,
  };
}

// ────────────────────────────────────────────────────────────
// 메인 파서
// ────────────────────────────────────────────────────────────

/**
 * 마크다운 첫 줄의 `# ` h1 헤더를 제거한다.
 * 이미 report-header의 <h1>으로 렌더링되므로 중복을 방지한다.
 */
function stripLeadingH1(markdown: string): string {
  return markdown.replace(/^#\s+[^\n]*\n?/, "");
}

/**
 * 마크다운을 섹션 단위로 파싱하여 시맨틱 컴포넌트 HTML로 변환한다.
 *
 * 변환 규칙:
 * - 시장 온도 근거 → index-grid, stat-chip, phase-bar 컴포넌트
 * - 섹터 RS 랭킹 표 → table + content-block
 * - 전일 대비 변화 요약 → content-block
 * - 시장 흐름 및 종합 전망 → content-block + watchpoint
 * - 부록 구분선 → appendix-divider
 * - 종목 섹션 → stock-card
 * - 미인식 섹션 → marked.parse() 폴백
 */
function parseMarkdownToSemanticHtml(markdown: string): {
  bodyHtml: string;
  tempBadge: string | null;
} {
  const sections = splitIntoSections(stripLeadingH1(markdown));
  const htmlParts: string[] = [];
  let tempBadge: string | null = null;
  let isAppendixMode = false;

  for (const section of sections) {
    const { heading, body } = section;

    // 첫 번째 섹션(헤딩 없음)의 경우 부록 구분선 확인 후 처리
    if (heading === "") {
      if (body.trim().length === 0) continue;

      const { html: appendixHtml, rest } = renderAppendixIntro(body);
      if (appendixHtml.length > 0) {
        htmlParts.push(appendixHtml);
        isAppendixMode = true;
        if (rest.trim().length > 0) {
          htmlParts.push(applyPostProcessing(markedInstance.parse(rest) as string));
        }
      } else {
        htmlParts.push(applyPostProcessing(markedInstance.parse(body) as string));
      }
      continue;
    }

    const icon = getSectionIcon(heading);
    const iconHtml = icon !== "" ? `<span class="section-icon">${icon}</span>` : "";
    const cleanHeading = normalizeHeading(heading);

    // 부록 구분선이 섹션 본문에 포함된 경우 — 다른 섹션 처리보다 먼저 확인
    const hrInBody = body.search(/^---\s*$/m);
    if (hrInBody !== -1) {
      const beforeHr = body.slice(0, hrInBody).trim();
      const afterHr = body.slice(hrInBody).trim();

      if (beforeHr.length > 0) {
        const sectionHtml = renderSectionByType(heading, beforeHr, iconHtml, cleanHeading);
        const { html: appendixHtml2, tempBadge: tb2 } = sectionHtml;
        if (tb2 != null) tempBadge = tb2;
        htmlParts.push(appendixHtml2);
      }

      const { html: appendixHtml, rest } = renderAppendixIntro(afterHr);
      if (appendixHtml.length > 0) {
        htmlParts.push(appendixHtml);
        isAppendixMode = true;
        if (rest.trim().length > 0) {
          htmlParts.push(applyPostProcessing(markedInstance.parse(rest) as string));
        }
      }
      continue;
    }

    // 시장 온도 섹션
    if (headingContains(heading, "시장 온도")) {
      const result = renderMarketTemperatureSection(body);
      if (result.tempBadge != null) tempBadge = result.tempBadge;

      htmlParts.push(`<section>
<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>
${result.html}
</section>`);
      continue;
    }

    // 섹터 RS 랭킹 섹션
    if (headingContains(heading, "섹터 RS", "RS 랭킹")) {
      const sectionHtml = renderSectorRankingSection(body);
      htmlParts.push(`<section>
<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>
${sectionHtml}
</section>`);
      continue;
    }

    // 업종 RS 랭킹 섹션 (일간 전용 — "주간 변화"가 포함된 헤딩은 일반 렌더링으로)
    if (headingContains(heading, "업종 RS", "주도 업종") && !heading.includes("주간 변화")) {
      const sectionHtml = renderIndustryRankingSection(body);
      htmlParts.push(`<section>
<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>
${sectionHtml}
</section>`);
      continue;
    }

    // 전일 대비 변화 섹션
    if (headingContains(heading, "전일 대비", "변화 요약")) {
      const sectionHtml = renderChangeSummarySection(body);
      htmlParts.push(`<section>
<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>
${sectionHtml}
</section>`);
      continue;
    }

    // 시장 흐름 및 종합 전망 섹션
    if (headingContains(heading, "종합 전망", "시장 흐름")) {
      const sectionHtml = renderOutlookSection(body);
      htmlParts.push(`<section>
<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>
${sectionHtml}
</section>`);
      continue;
    }

    // 부록 헤더 섹션 (## 📋 **부록: 종목 상세** 패턴)
    // --- 구분선 바로 다음에 오는 ## 헤더가 부록 제목인 경우
    if (headingContains(heading, "부록")) {
      const cleanTitle = normalizeHeading(heading);
      if (!isAppendixMode) {
        // 이전에 --- 로 구분선이 없었던 경우: divider + title 모두 추가
        htmlParts.push(`<hr class="appendix-divider">\n<div class="appendix-title">${escapeHtml(cleanTitle)}</div>`);
      } else {
        // 이미 --- 로 appendix-divider가 추가된 경우: title만 추가
        htmlParts.push(`<div class="appendix-title">${escapeHtml(cleanTitle)}</div>`);
      }
      isAppendixMode = true;
      // 부록 헤더 섹션의 body가 있으면 stock 섹션으로 처리
      if (body.trim().length > 0) {
        const sectionHtml = renderAppendixBodySection(body);
        if (sectionHtml.trim().length > 0) {
          htmlParts.push(sectionHtml);
        }
      }
      continue;
    }

    // 주간: "다음 주 관전 포인트", "리스크 경고" — 종목 카드 불필요, content-block으로 렌더링
    if (headingContains(heading, "관전 포인트", "다음 주", "리스크 경고", "리스크")) {
      const sectionHtml = renderSubsectionCards(body);
      htmlParts.push(`<section>
<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>
${sectionHtml}
</section>`);
      continue;
    }

    // 주간: "관심종목 등록/해제" — h3 서브섹션(해제, 예비 워치리스트) 분리 + 종목 카드 유지
    if (headingContains(heading, "관심종목", "등록", "해제")) {
      const sectionHtml = renderAppendixBodySection(body);
      htmlParts.push(`<section>
<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>
${sectionHtml}
</section>`);
      continue;
    }

    // 부록 내 종목 섹션 (일간 리포트 — 부록 구분선 이후)
    if (isAppendixMode || headingContains(heading, "특이종목", "예비군")) {
      isAppendixMode = true;
      const sectionHtml = renderStockCardSection(body);
      htmlParts.push(`<section>
<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>
${sectionHtml}
</section>`);
      continue;
    }

    // 미인식 섹션 → 폴백
    const fallbackHtml = applyPostProcessing(markedInstance.parse(body) as string);
    htmlParts.push(`<section>
<h2>${iconHtml}${escapeHtml(cleanHeading)}</h2>
${fallbackHtml}
</section>`);
  }

  return { bodyHtml: htmlParts.join("\n"), tempBadge };
}

// ────────────────────────────────────────────────────────────
// 공개 API
// ────────────────────────────────────────────────────────────

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
  const { bodyHtml, tempBadge } = parseMarkdownToSemanticHtml(markdownContent);

  const formattedDate = formatKoreanDate(date);
  const titleWithBadge = tempBadge != null
    ? `${escapeHtml(title)} ${tempBadge}`
    : escapeHtml(title);

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
    <h1>${titleWithBadge}</h1>
    <div class="report-date">${escapeHtml(formattedDate)} · Market Analyst</div>
  </header>
  <div class="report-body">
    ${bodyHtml}
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
