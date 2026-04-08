/**
 * weekly-html-builder.ts — 주간 리포트 프로그래밍 HTML 렌더러
 *
 * 데이터 블록(지수/Phase2/섹터/업종/관심종목/게이트)은 도구 반환값을 직접 렌더링.
 * 해석 블록(narrative)은 LLM 텍스트를 marked로 마크다운→HTML 변환.
 *
 * 색상 규칙: 상승=--up(#cf222e/빨강), 하락=--down(#0969da/파랑). 초록/빨강 금지.
 * XSS: 모든 DB/사용자 데이터는 escapeHtml() 처리. marked는 raw HTML 이스케이프 모드.
 *
 * ⚠️  phase2Ratio는 이미 퍼센트(0~100). 절대 ×100 하지 말 것.
 */

import { Marked } from "marked";
import type {
  IndexReturn,
  FearGreedData,
  MarketBreadthData,
  SectorDetail,
  IndustryItem,
  WatchlistStatusData,
  Phase2Stock,
  WatchlistChange,
  WeeklyReportData,
  WeeklyReportInsight,
} from "@/tools/schemas/weeklyReportSchema.js";
import type {
  ThesisAlignedData,
  ThesisAlignedChainGroup,
} from "@/lib/thesisAlignedCandidates.js";

// ─── Marked 인스턴스 ──────────────────────────────────────────────────────────

/**
 * raw HTML 토큰을 이스케이프하여 XSS 방지.
 * LLM이 생성한 마크다운에 <script> 등이 포함될 수 있으므로
 * raw HTML은 이스케이프된 텍스트로 렌더링한다.
 */
const DANGEROUS_HREF_PATTERN = /^(javascript|data):/i;

const markedInstance = new Marked({
  renderer: {
    html(token) {
      return escapeHtml(typeof token === "string" ? token : token.text);
    },
    link({ href, title, text }) {
      const safeHref = DANGEROUS_HREF_PATTERN.test(href ?? "") ? "#" : (href ?? "#");
      const titleAttr = title != null ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(safeHref)}"${titleAttr}>${text}</a>`;
    },
  },
});

// ─── XSS 방어 ────────────────────────────────────────────────────────────────

const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
} as const;

/**
 * 문자열의 HTML 특수 문자를 이스케이프한다.
 * DB/사용자 데이터를 HTML에 삽입하기 전에 반드시 호출한다.
 */
function escapeHtml(value: unknown): string {
  if (value == null) return "";
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

// ─── CSS ─────────────────────────────────────────────────────────────────────

const WEEKLY_REPORT_CSS = `
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
    max-width: 900px;
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
    vertical-align: middle;
  }
  .temp-badge.neutral { background: #fff8c5; color: var(--yellow); }
  .temp-badge.bullish { background: #ddf4ff; color: var(--accent); }
  .temp-badge.bearish { background: #ffebe9; color: var(--down); }

  /* Section */
  section {
    margin-bottom: 40px;
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
    grid-template-columns: repeat(4, 1fr);
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

  .index-card .pos-badge {
    display: inline-block;
    font-size: 0.72rem;
    color: var(--text-muted);
    margin-left: 6px;
  }

  .tc { text-align: center; }

  .up { color: var(--up); }
  .down { color: var(--down); }
  .neutral-color { color: var(--text-muted); }

  /* Fear & Greed */
  .fear-greed-row {
    display: flex;
    align-items: center;
    gap: 16px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 18px;
    margin-bottom: 20px;
    flex-wrap: wrap;
  }

  .fg-label-main {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .fg-score {
    font-size: 1.8rem;
    font-weight: 800;
  }

  .fg-rating {
    font-size: 0.85rem;
    font-weight: 600;
  }

  .fg-compare {
    font-size: 0.78rem;
    color: var(--text-muted);
    line-height: 1.5;
  }

  /* Tables */
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
    margin: 12px 0 20px;
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
    vertical-align: middle;
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

  /* Phase Distribution Bar */
  .phase-bar {
    display: flex;
    height: 12px;
    border-radius: 6px;
    overflow: hidden;
    margin: 8px 0 8px;
  }

  .phase-bar .seg { transition: width 0.3s; }
  .phase-bar .seg.p1 { background: #d0d7de; }
  .phase-bar .seg.p2 { background: var(--phase2); }
  .phase-bar .seg.p3 { background: #eac054; }
  .phase-bar .seg.p4 { background: #cf222e; }

  .phase-legend {
    display: flex;
    gap: 14px;
    font-size: 0.78rem;
    color: var(--text-muted);
    flex-wrap: wrap;
    margin-bottom: 12px;
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

  /* Stat Row */
  .stat-row {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin: 12px 0;
  }

  .stat-chip {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 16px;
    font-size: 0.85rem;
    flex: 1;
    min-width: 160px;
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

  /* Content Blocks (LLM narrative) */
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

  .content-block p:last-child { margin-bottom: 0; }

  .content-block ul, .content-block ol {
    margin: 4px 0 8px 20px;
    font-size: 0.9rem;
    line-height: 1.7;
  }

  .content-block li { margin-bottom: 4px; }

  .content-block strong { font-weight: 600; }

  /* Watchlist Trajectory */
  .trajectory-dots {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .traj-dot {
    display: inline-block;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 0.7rem;
    font-weight: 700;
    line-height: 22px;
    text-align: center;
    color: #fff;
  }
  .traj-dot.p1 { background: #8c959f; }
  .traj-dot.p2 { background: var(--phase2); }
  .traj-dot.p3 { background: #c49b1a; }
  .traj-dot.p4 { background: #cf222e; }

  /* Gate5 Cards */
  .gate5-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
    margin: 12px 0;
  }

  .gate5-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
  }

  .gate5-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .gate5-ticker {
    font-size: 1rem;
    font-weight: 700;
  }

  .gate5-meta {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .gate5-new-badge {
    margin-left: auto;
    background: #dafbe1;
    color: var(--phase2);
    font-size: 0.72rem;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 4px;
  }

  .gate5-conditions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 8px;
  }

  .cond-tag {
    font-size: 0.72rem;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
  }
  .cond-tag.met { background: #ddf4ff; color: var(--accent); }
  .cond-tag.signal { background: #fbefff; color: var(--purple); }

  .gate5-stats {
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-top: 8px;
    line-height: 1.5;
  }

  /* Gate Check Tags */
  .gate5-checks {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    margin: 8px 0 6px;
  }

  .gate-check {
    font-size: 0.72rem;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 600;
  }
  .gate-check.pass { background: #dafbe1; color: var(--phase2); }
  .gate-check.fail { background: #ffebe9; color: var(--up); }
  .gate-check.pending { background: #fff8c5; color: var(--yellow); }

  /* Mini Stats Grid */
  .mini-stats {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 8px;
  }

  .mini-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    background: var(--surface-2);
    border-radius: 6px;
    padding: 4px 10px;
    min-width: 56px;
  }

  .mini-label {
    font-size: 0.65rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .mini-val {
    font-size: 0.82rem;
    font-weight: 700;
  }

  .empty-state {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 24px;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  /* Footer */
  .report-footer {
    margin-top: 48px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    color: var(--text-muted);
    font-size: 0.75rem;
    text-align: center;
  }

  /* Weekly Trend mini-table */
  .weekly-trend-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
    margin: 12px 0;
  }

  .weekly-trend-table thead th {
    background: var(--surface);
    color: var(--text-muted);
    font-weight: 600;
    text-align: center;
    padding: 8px 12px;
    border-bottom: 2px solid var(--border);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .weekly-trend-table tbody td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    text-align: center;
    vertical-align: middle;
  }

  /* Responsive */
  @media (max-width: 600px) {
    .container { padding: 16px 12px; }
    .index-grid { grid-template-columns: repeat(2, 1fr); }
    .gate5-grid { grid-template-columns: 1fr; }
  }
`;

// ─── 유틸리티 ─────────────────────────────────────────────────────────────────

function formatPercent(value: number, decimals = 2): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

function colorClass(value: number): "up" | "down" | "neutral-color" {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "neutral-color";
}

/**
 * VIX 전용 컬러 — 일반 지수와 반대.
 * VIX 상승 = 시장 불안 → 한국식 하락색(파랑, down)
 * VIX 하락 = 시장 안도 → 한국식 상승색(빨강, up)
 */
function vixColorClass(change: number): "up" | "down" | "neutral-color" {
  if (change > 0) return "down";
  if (change < 0) return "up";
  return "neutral-color";
}

const VIX_FEAR_THRESHOLD = 25;

function renderVixCard(idx: IndexReturn): string {
  const vixChange = idx.weekEndClose - idx.weekStartClose;
  const cls = vixColorClass(vixChange);
  const directionLabel = vixChange > 0 ? "▲ 경계" : vixChange < 0 ? "▼ 안도" : "—";
  const fearBadge =
    idx.weekHigh >= VIX_FEAR_THRESHOLD
      ? `<div style="font-size:0.72rem;color:var(--orange);font-weight:600;margin-top:4px;">주중 공포 임계선 도달</div>`
      : "";

  return `
    <div class="index-card">
      <div class="label">${escapeHtml(idx.name)}</div>
      <div class="value">${escapeHtml(formatNumber(idx.weekEndClose))}</div>
      <div class="change ${escapeHtml(cls)}">${escapeHtml(directionLabel)}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
        고 ${escapeHtml(formatNumber(idx.weekHigh))} / 저 ${escapeHtml(formatNumber(idx.weekLow))}
      </div>
      ${fearBadge}
    </div>`;
}

/**
 * US 10Y Treasury 전용 카드 (주간 데이터 기반).
 * weekEndClose = yield(%), 변화량은 bp(basis point) 단위.
 */
function renderUs10yCard(idx: IndexReturn): string {
  const yieldChange = idx.weekEndClose - idx.weekStartClose;
  const cls = colorClass(idx.weeklyChangePercent);
  const bpChange = yieldChange * 100;
  const bpStr = `${bpChange >= 0 ? "+" : ""}${bpChange.toFixed(1)}bp`;

  return `
    <div class="index-card">
      <div class="label">${escapeHtml(idx.name)}</div>
      <div class="value">${escapeHtml(idx.weekEndClose.toFixed(2))}%</div>
      <div class="change ${escapeHtml(cls)}">${escapeHtml(formatPercent(idx.weeklyChangePercent))}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
        ${escapeHtml(bpStr)}
      </div>
    </div>`;
}

/**
 * DXY(달러 인덱스) 전용 카드 (주간 데이터 기반).
 * 종가는 포인트 표시, 변화량은 포인트 + % 병기.
 */
function renderDxyCard(idx: IndexReturn): string {
  const cls = colorClass(idx.weeklyChangePercent);
  const ptChange = idx.weekEndClose - idx.weekStartClose;

  return `
    <div class="index-card">
      <div class="label">${escapeHtml(idx.name)}</div>
      <div class="value">${escapeHtml(formatNumber(idx.weekEndClose))}</div>
      <div class="change ${escapeHtml(cls)}">${escapeHtml(formatPercent(idx.weeklyChangePercent))}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
        ${escapeHtml(ptChange >= 0 ? "+" : "")}${escapeHtml(ptChange.toFixed(2))}pt
      </div>
    </div>`;
}

/**
 * 공포탐욕지수를 .index-card 형태로 렌더링 (그리드 내 배치용).
 */
function renderFearGreedCard(fg: FearGreedData): string {
  const scoreCls = fg.score <= 25 ? "down" : fg.score >= 75 ? "up" : "";
  const directionStr =
    fg.previous1Week != null
      ? escapeHtml(getFearGreedDirectionLabel(fg.score, fg.previous1Week))
      : "";
  const prev1wSub =
    fg.previous1Week != null
      ? `1주전 ${escapeHtml(fg.previous1Week.toFixed(1))}`
      : "";

  return `
    <div class="index-card">
      <div class="label">공포탐욕</div>
      <div class="value ${escapeHtml(scoreCls)}">${escapeHtml(String(fg.score))}</div>
      <div class="change">${escapeHtml(fg.rating)}</div>
      ${directionStr !== "" || prev1wSub !== ""
        ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
            ${[directionStr, prev1wSub].filter(Boolean).join(" · ")}
          </div>`
        : ""}
    </div>`;
}

function phaseBadgeClass(phase: number): string {
  const map: Record<number, string> = { 1: "p1", 2: "p2", 3: "p3", 4: "p4" };
  return map[phase] ?? "p1";
}

function formatMarketCap(cap: number | null): string {
  if (cap == null) return "\u2014";
  if (cap >= 1_000_000_000_000) return `$${(cap / 1_000_000_000_000).toFixed(1)}T`;
  if (cap >= 1_000_000_000) return `$${(cap / 1_000_000_000).toFixed(1)}B`;
  if (cap >= 1_000_000) return `$${(cap / 1_000_000).toFixed(0)}M`;
  return `$${cap.toLocaleString()}`;
}

function closePositionLabel(pos: "near_high" | "near_low" | "mid"): string {
  const labels: Record<string, string> = {
    near_high: "고점 근처",
    near_low: "저점 근처",
    mid: "중간",
  };
  return labels[pos] ?? pos;
}

function formatNumber(value: number | null, fallback = "—"): string {
  if (value == null) return fallback;
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * 마크다운 텍스트를 HTML로 변환한다.
 * raw HTML은 이스케이프 처리하여 XSS를 방지한다.
 */
function mdToHtml(markdown: string): string {
  if (markdown.trim() === "") return "";
  return markedInstance.parse(markdown) as string;
}

// ─── 렌더링 함수들 ────────────────────────────────────────────────────────────

/**
 * 지수 수익률 카드 그리드 + Fear & Greed 행을 렌더링한다.
 */
export function renderIndexTable(
  indices: IndexReturn[],
  fearGreed: FearGreedData | null,
): string {
  if (indices.length === 0) {
    return '<div class="empty-state">지수 데이터를 가져올 수 없습니다.</div>';
  }

  const cards = indices
    .map((idx) => {
      if (idx.symbol === "^VIX") {
        return renderVixCard(idx);
      }
      if (idx.symbol === "^TNX") {
        return renderUs10yCard(idx);
      }
      if (idx.symbol === "DX-Y.NYB") {
        return renderDxyCard(idx);
      }

      const cls = colorClass(idx.weeklyChangePercent);
      const changeStr = formatPercent(idx.weeklyChangePercent);
      const posLabel = closePositionLabel(idx.closePosition);

      return `
        <div class="index-card">
          <div class="label">${escapeHtml(idx.name)}</div>
          <div class="value">${escapeHtml(formatNumber(idx.weekEndClose))}</div>
          <div class="change ${escapeHtml(cls)}">${escapeHtml(changeStr)} <span class="pos-badge">${escapeHtml(posLabel)}</span></div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
            고 ${escapeHtml(formatNumber(idx.weekHigh))} / 저 ${escapeHtml(formatNumber(idx.weekLow))}
          </div>
        </div>`;
    })
    .join("");

  const fearGreedHtml =
    fearGreed != null ? renderFearGreedCard(fearGreed) : "";

  return `<div class="index-grid">${cards}${fearGreedHtml}</div>`;
}

function getFearGreedDirectionLabel(score: number, previous1Week: number): string {
  if (score === previous1Week) return "변동 없음";

  const isRising = score > previous1Week;
  const isGreedZone = score >= 50;

  if (isRising && isGreedZone) return "탐욕 심화";
  if (isRising && !isGreedZone) return "공포 완화";
  if (!isRising && !isGreedZone) return "공포 심화";
  return "탐욕 약화";
}

/**
 * weeklyTrend 5일 Phase 2 비율 추이를 mini-table로 시각화한다.
 * 2일 미만 데이터는 빈 문자열을 반환한다.
 */
export function renderWeeklyTrendTable(
  weeklyTrend: MarketBreadthData["weeklyTrend"],
): string {
  if (weeklyTrend.length < 2) return "";

  const rows = weeklyTrend
    .map((point, idx) => {
      const dateParts = point.date.split("-");
      const dateLabel = `${Number(dateParts[1])}/${Number(dateParts[2])}`;

      const ratioStr = `${point.phase2Ratio.toFixed(1)}%`;

      let changeStr = "—";
      let changeCls = "neutral-color";
      if (idx > 0) {
        const prevRatio = weeklyTrend[idx - 1].phase2Ratio;
        const diff = point.phase2Ratio - prevRatio;
        changeCls = colorClass(diff);
        changeStr = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%p`;
      }

      return `
        <tr>
          <td>${escapeHtml(dateLabel)}</td>
          <td>${escapeHtml(ratioStr)}</td>
          <td class="${escapeHtml(changeCls)}">${escapeHtml(changeStr)}</td>
        </tr>`;
    })
    .join("");

  return `
    <h3>Phase 2 비율 주간 추이</h3>
    <table class="weekly-trend-table">
      <thead>
        <tr>
          <th>날짜</th>
          <th>Phase 2 비율</th>
          <th>전일 대비</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * Phase 2 비율 주간 추이 테이블 + Phase 분포 바 + 지표 행을 렌더링한다.
 */
export function renderPhase2TrendTable(breadth: MarketBreadthData, breadthNarrative?: string): string {
  const { weeklyTrend, phase1to2Transitions, latestSnapshot } = breadth;

  // Phase 분포 바 + 주간 변화 (중복 제거: 바 하나에 변화량만 주석)
  const snap = latestSnapshot;
  const total = snap.totalStocks > 0 ? snap.totalStocks : 1;
  const p1Pct = ((snap.phaseDistribution.phase1 / total) * 100).toFixed(1);
  const p2Pct = ((snap.phaseDistribution.phase2 / total) * 100).toFixed(1);
  const p3Pct = ((snap.phaseDistribution.phase3 / total) * 100).toFixed(1);
  const p4Pct = ((snap.phaseDistribution.phase4 / total) * 100).toFixed(1);

  // 주간 Phase 2 변화량 계산
  let p2WeeklyChange = "";
  if (weeklyTrend.length >= 2) {
    const first = weeklyTrend[0];
    const last = weeklyTrend[weeklyTrend.length - 1];
    const change = last.phase2Ratio - first.phase2Ratio;
    const cls = colorClass(change);
    const sign = change >= 0 ? "+" : "";
    p2WeeklyChange = ` <span class="${escapeHtml(cls)}" style="font-weight:400;font-size:0.85rem;">(주간 ${sign}${change.toFixed(1)}%p)</span>`;
  }

  const phaseBar = `
    <h3>Phase 분포${p2WeeklyChange}</h3>
    <div class="phase-bar">
      <div class="seg p1" style="width:${escapeHtml(p1Pct)}%"></div>
      <div class="seg p2" style="width:${escapeHtml(p2Pct)}%"></div>
      <div class="seg p3" style="width:${escapeHtml(p3Pct)}%"></div>
      <div class="seg p4" style="width:${escapeHtml(p4Pct)}%"></div>
    </div>
    <div class="phase-legend">
      <span class="l1">Phase 1 ${escapeHtml(p1Pct)}% (${escapeHtml(String(snap.phaseDistribution.phase1))})</span>
      <span class="l2">Phase 2 ${escapeHtml(p2Pct)}% (${escapeHtml(String(snap.phaseDistribution.phase2))})</span>
      <span class="l3">Phase 3 ${escapeHtml(p3Pct)}% (${escapeHtml(String(snap.phaseDistribution.phase3))})</span>
      <span class="l4">Phase 4 ${escapeHtml(p4Pct)}% (${escapeHtml(String(snap.phaseDistribution.phase4))})</span>
    </div>`;

  // 지표 행
  const adRatioStr =
    snap.advanceDecline.ratio != null
      ? snap.advanceDecline.ratio.toFixed(2)
      : "—";
  const hlRatioStr =
    snap.newHighLow.ratio != null
      ? snap.newHighLow.ratio.toFixed(2)
      : "—";
  const breadthScoreStr =
    snap.breadthScore != null
      ? snap.breadthScore.toFixed(1)
      : "—";
  const p2Change =
    snap.phase2RatioChange >= 0
      ? `+${snap.phase2RatioChange.toFixed(1)}%p`
      : `${snap.phase2RatioChange.toFixed(1)}%p`;
  const p2ChangeCls = colorClass(snap.phase2RatioChange);

  const statsHtml = `
    <div class="stat-row">
      <div class="stat-chip">
        <span class="stat-label">A/D Ratio</span>
        <span class="stat-value">${escapeHtml(adRatioStr)}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">신고가/신저가</span>
        <span class="stat-value">${escapeHtml(String(snap.newHighLow.newHighs))} / ${escapeHtml(String(snap.newHighLow.newLows))} (${escapeHtml(hlRatioStr)})</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">P1→P2 전환 (5일)</span>
        <span class="stat-value">${escapeHtml(String(phase1to2Transitions))}건</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">Phase 2 주간 변화</span>
        <span class="stat-value ${escapeHtml(p2ChangeCls)}">${escapeHtml(p2Change)}</span>
      </div>
      ${
        breadthScoreStr !== "—"
          ? `<div class="stat-chip">
              <span class="stat-label">Breadth Score</span>
              <span class="stat-value">${escapeHtml(breadthScoreStr)}</span>
            </div>`
          : ""
      }
    </div>`;

  const trendTableHtml = renderWeeklyTrendTable(weeklyTrend);

  const narrativeHtml =
    breadthNarrative != null && breadthNarrative.trim() !== ""
      ? `<div class="content-block">${mdToHtml(breadthNarrative)}</div>`
      : "";

  return `${phaseBar}${statsHtml}${trendTableHtml}${narrativeHtml}`;
}

/**
 * 11개 섹터 전체 테이블을 렌더링한다.
 * rsChange 양수=빨강, 음수=파랑.
 */
export function renderSectorTable(sectors: SectorDetail[]): string {
  if (sectors.length === 0) {
    return '<div class="empty-state">섹터 데이터 없음</div>';
  }

  const rows = sectors
    .map((s) => {
      const phaseCls = phaseBadgeClass(s.groupPhase);
      const rankChangeStr =
        s.rankChange != null
          ? s.rankChange > 0
            ? `<span class="up">▲${s.rankChange}</span>`
            : s.rankChange < 0
              ? `<span class="down">▼${Math.abs(s.rankChange)}</span>`
              : `<span class="neutral-color">—</span>`
          : "—";

      const rsChangeCls = s.rsChange != null ? colorClass(s.rsChange) : "neutral-color";
      const rsChangeStr =
        s.rsChange != null
          ? `<span class="${escapeHtml(rsChangeCls)}">${s.rsChange >= 0 ? "+" : ""}${s.rsChange.toFixed(1)}</span>`
          : "—";

      const p2Str = `${s.phase2Ratio.toFixed(1)}%`;
      const change4wStr =
        s.change4w != null
          ? `<span class="${escapeHtml(colorClass(s.change4w))}">${s.change4w >= 0 ? "+" : ""}${s.change4w.toFixed(1)}</span>`
          : "—";

      return `
        <tr>
          <td><strong>${escapeHtml(s.sector)}</strong></td>
          <td>${escapeHtml(s.avgRs.toFixed(1))}</td>
          <td>${escapeHtml(String(s.rsRank))}</td>
          <td>${rankChangeStr}</td>
          <td>${rsChangeStr}</td>
          <td><span class="phase-badge ${escapeHtml(phaseCls)}">Phase ${escapeHtml(String(s.groupPhase))}</span></td>
          <td>${escapeHtml(p2Str)}</td>
          <td>${change4wStr}</td>
        </tr>`;
    })
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>섹터</th>
          <th>RS</th>
          <th>순위</th>
          <th>순위변동</th>
          <th>RS변화</th>
          <th>Phase</th>
          <th>P2 비율</th>
          <th>4주 변화</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * changeWeek 기준 Top 10 업종 테이블을 렌더링한다.
 */
export function renderIndustryTop10Table(industries: IndustryItem[]): string {
  if (industries.length === 0) {
    return '<div class="empty-state">업종 데이터 없음</div>';
  }

  const rows = industries
    .slice(0, 10)
    .map((ind, idx) => {
      const phaseCls = phaseBadgeClass(ind.groupPhase);
      const changeWeekCls =
        ind.changeWeek != null ? colorClass(ind.changeWeek) : "neutral-color";
      const changeWeekStr =
        ind.changeWeek != null
          ? `<span class="${escapeHtml(changeWeekCls)}">${ind.changeWeek >= 0 ? "+" : ""}${ind.changeWeek.toFixed(1)}</span>`
          : "—";
      const p2Str =
        ind.phase2Ratio != null ? `${ind.phase2Ratio.toFixed(1)}%` : "—";

      return `
        <tr>
          <td>${escapeHtml(String(idx + 1))}</td>
          <td><strong>${escapeHtml(ind.industry)}</strong></td>
          <td>${escapeHtml(ind.sector)}</td>
          <td>${escapeHtml(ind.avgRs.toFixed(1))}</td>
          <td>${changeWeekStr}</td>
          <td><span class="phase-badge ${escapeHtml(phaseCls)}">Phase ${escapeHtml(String(ind.groupPhase))}</span></td>
          <td>${escapeHtml(p2Str)}</td>
        </tr>`;
    })
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>업종</th>
          <th>섹터</th>
          <th>RS</th>
          <th>주간 변화</th>
          <th>Phase</th>
          <th>P2 비율</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * ACTIVE 관심종목 궤적 섹션을 렌더링한다.
 * 0건이면 빈 상태 메시지를 표시한다.
 */
export function renderWatchlistSection(watchlist: WatchlistStatusData): string {
  const { summary, items } = watchlist;

  if (items.length === 0) {
    return '<div class="empty-state">현재 ACTIVE 관심종목 없음</div>';
  }

  const avgPnlStr =
    summary.avgPnlPercent >= 0
      ? `+${summary.avgPnlPercent.toFixed(1)}%`
      : `${summary.avgPnlPercent.toFixed(1)}%`;
  const avgPnlCls = colorClass(summary.avgPnlPercent);

  const summaryHtml = `
    <div class="stat-row">
      <div class="stat-chip">
        <span class="stat-label">ACTIVE 종목 수</span>
        <span class="stat-value">${escapeHtml(String(summary.totalActive))}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">평균 P&amp;L</span>
        <span class="stat-value ${escapeHtml(avgPnlCls)}">${escapeHtml(avgPnlStr)}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">Phase 변화 종목</span>
        <span class="stat-value">${escapeHtml(String(summary.phaseChanges.length))}건</span>
      </div>
    </div>`;

  const itemRows = items
    .map((item) => {
      const phaseCls = phaseBadgeClass(item.currentPhase ?? item.entryPhase);
      const pnlStr =
        item.pnlPercent != null
          ? item.pnlPercent >= 0
            ? `+${item.pnlPercent.toFixed(1)}%`
            : `${item.pnlPercent.toFixed(1)}%`
          : "—";
      const pnlCls =
        item.pnlPercent != null ? colorClass(item.pnlPercent) : "neutral-color";

      // Phase 궤적 도트 (최근 7개)
      const trajDots = item.phaseTrajectory
        .slice(-7)
        .map((t) => {
          const cls = phaseBadgeClass(t.phase);
          return `<div class="traj-dot ${escapeHtml(cls)}" title="${escapeHtml(t.date)}">${escapeHtml(String(t.phase))}</div>`;
        })
        .join("");

      const sepaStr = item.entrySepaGrade != null ? escapeHtml(item.entrySepaGrade) : "—";
      const rsStr =
        item.currentRsScore != null
          ? `RS ${item.currentRsScore.toFixed(0)}`
          : item.entryRsScore != null
            ? `RS ${item.entryRsScore.toFixed(0)} (진입)`
            : "—";

      return `
        <tr>
          <td><strong>${escapeHtml(item.symbol)}</strong></td>
          <td>${escapeHtml(item.entrySector ?? "—")}</td>
          <td>${escapeHtml(item.entryDate)}</td>
          <td>${escapeHtml(String(item.daysTracked))}일</td>
          <td><span class="phase-badge ${escapeHtml(phaseCls)}">Phase ${escapeHtml(String(item.currentPhase ?? item.entryPhase))}</span></td>
          <td><div class="trajectory-dots">${trajDots}</div></td>
          <td class="${escapeHtml(pnlCls)}">${escapeHtml(pnlStr)}</td>
          <td>${escapeHtml(rsStr)}</td>
          <td>${sepaStr}</td>
        </tr>`;
    })
    .join("");

  const table = `
    <table>
      <thead>
        <tr>
          <th>종목</th>
          <th>섹터</th>
          <th>진입일</th>
          <th>추적</th>
          <th>Phase</th>
          <th>궤적(최근7일)</th>
          <th>P&amp;L</th>
          <th>RS</th>
          <th>SEPA</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>`;

  return `${summaryHtml}${table}`;
}

/**
 * 관심종목 등록/해제/예비 3단 구조를 렌더링한다.
 * - registered: 5/5 게이트 충족 + 등록 확정
 * - pending4of5: 기술적 4개 게이트 충족, thesis 미충족 예비
 * - exited: 이번 주 해제 확정
 */
export function renderWatchlistChanges(
  changes: WeeklyReportData["watchlistChanges"],
  candidates: Phase2Stock[] = [],
  industries: IndustryItem[] = [],
): string {
  const { registered, pending4of5, exited } = changes;

  // 종목 데이터 룩업맵
  const stockMap = new Map(candidates.map((s) => [s.symbol, s]));
  const industryRsMap = new Map<string, { avgRs: number; changeWeek: number | null }>();
  for (const ind of industries) {
    industryRsMap.set(ind.industry, { avgRs: ind.avgRs, changeWeek: ind.changeWeek });
  }

  const hasAny = registered.length > 0 || exited.length > 0 || pending4of5.length > 0;

  if (!hasAny) {
    return `<div class="empty-state">이번 주 신규 등록/해제 없음</div>`;
  }

  const registeredHtml = registered.length > 0
    ? `
      <h3>신규 등록 (${escapeHtml(String(registered.length))}종목)</h3>
      <div class="gate5-grid">
        ${registered.map((c) => renderWatchlistChangeCard(c, "registered")).join("")}
      </div>`
    : `<h3>신규 등록</h3><div class="empty-state">이번 주 신규 등록 없음</div>`;

  const pending4of5Html = pending4of5.length > 0
    ? `
      <h3>예비 관심종목 (${escapeHtml(String(pending4of5.length))}종목 — 4/5, thesis 미충족)</h3>
      <table>
        <thead><tr><th>종목</th><th>업종</th><th>고점대비</th><th>저점대비</th><th>Phase 2</th><th>RS &gt; 60</th><th>SEPA S/A</th><th>업종RS(주간▲)</th><th>thesis</th><th>통과</th></tr></thead>
        <tbody>
          ${pending4of5.map((c) => {
            const stock = stockMap.get(c.symbol);
            const industry = stock?.industry ?? "—";
            const rs = stock?.rsScore != null ? String(stock.rsScore) : "—";
            const highStr = stock?.pctFromHigh52w != null
              ? `<span class="${colorClass(stock.pctFromHigh52w)}">${stock.pctFromHigh52w.toFixed(0)}%</span>`
              : "—";
            const sepa = stock?.sepaGrade ?? "—";
            const lowStr = stock?.pctFromLow52w != null
              ? `<span class="up">+${stock.pctFromLow52w.toFixed(0)}%</span>`
              : "—";
            const indData = stock?.industry != null ? industryRsMap.get(stock.industry) : null;
            let indRsStr = "—";
            if (indData != null) {
              const cw = indData.changeWeek;
              const cwStr = cw != null
                ? `<span class="${colorClass(cw)}">(${cw >= 0 ? "+" : ""}${Math.abs(cw) < 0.05 ? cw.toFixed(2) : cw.toFixed(1)})</span>`
                : "";
              indRsStr = `${indData.avgRs.toFixed(0)} ${cwStr}`;
            }
            const phase = stock?.phase != null ? `P${stock.phase}` : "—";
            return `<tr>
              <td><strong>${escapeHtml(c.symbol)}</strong></td>
              <td>${escapeHtml(industry)}</td>
              <td class="tc">${highStr}</td>
              <td class="tc">${lowStr}</td>
              <td class="tc">${escapeHtml(phase)}</td>
              <td class="tc">${escapeHtml(rs)}</td>
              <td class="tc">${escapeHtml(sepa)}</td>
              <td class="tc">${indRsStr}</td>
              <td class="tc"><span class="gate-check pending">?</span></td>
              <td class="tc">4/5</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`
    : "";

  const exitedHtml = exited.length > 0
    ? `
      <h3>해제 (${escapeHtml(String(exited.length))}종목)</h3>
      <div class="gate5-grid">
        ${exited.map((c) => renderWatchlistChangeCard(c, "exited")).join("")}
      </div>`
    : "";

  return `${registeredHtml}${pending4of5Html}${exitedHtml}`;
}

type WatchlistCardVariant = "registered" | "pending" | "exited";

function renderWatchlistChangeCard(
  change: WatchlistChange,
  variant: WatchlistCardVariant,
): string {
  const badgeHtml = (() => {
    if (variant === "registered") {
      return `<span class="gate5-new-badge">5/5 게이트 충족</span>`;
    }
    if (variant === "pending") {
      return `<span class="gate-check pending" style="margin-left:auto;">4/5 (thesis 미충족)</span>`;
    }
    return `<span class="gate-check fail" style="margin-left:auto;">해제</span>`;
  })();

  return `
    <div class="gate5-card">
      <div class="gate5-card-header">
        <span class="gate5-ticker">${escapeHtml(change.symbol)}</span>
        ${badgeHtml}
      </div>
      ${change.reason !== "" ? `<div class="gate5-stats">${escapeHtml(change.reason)}</div>` : ""}
    </div>`;
}

// ─── 최종 HTML 조립 ───────────────────────────────────────────────────────────

// ─── 서사 수혜 후보 ───────────────────────────────────────────────────────────

function renderChainGroupCard(group: ThesisAlignedChainGroup): string {
  const statusCls = group.chainStatus === "ACTIVE" ? "up" : "neutral-color";

  if (group.candidates.length === 0) {
    return "";
  }

  const headerHtml = `
    <h3>
      ${escapeHtml(group.megatrend)}
      <span class="phase-badge p2"><span class="${escapeHtml(statusCls)}">${escapeHtml(group.chainStatus)}</span></span>
      <span style="font-size:0.78rem;color:var(--text-muted);font-weight:400;">${escapeHtml(String(group.daysSinceIdentified))}일 경과</span>
    </h3>
    <p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 8px;">${escapeHtml(group.bottleneck)}</p>`;

  const rows = group.candidates
    .map((c) => {
      const phaseCls = c.phase != null ? phaseBadgeClass(c.phase) : "p1";
      const phaseStr = c.phase != null ? `Phase ${escapeHtml(String(c.phase))}` : "\u2014";
      const rsStr = c.rsScore != null ? escapeHtml(String(c.rsScore)) : "\u2014";
      const sepaStr = c.sepaGrade != null
        ? c.sepaGrade === "S"
          ? `<span class="phase-badge" style="background:#ffe0d0;color:#bc4c00;font-weight:700;">${escapeHtml(c.sepaGrade)}</span>`
          : c.sepaGrade === "A"
            ? `<span class="phase-badge" style="background:#ddf4ff;color:#0969da;font-weight:700;">${escapeHtml(c.sepaGrade)}</span>`
            : c.sepaGrade === "B"
              ? `<span class="phase-badge" style="background:#e6f6e6;color:#1a7f37;">${escapeHtml(c.sepaGrade)}</span>`
              : escapeHtml(c.sepaGrade)
        : "\u2014";
      const industryStr = c.industry != null ? escapeHtml(c.industry) : "\u2014";
      const capStr = formatMarketCap(c.marketCap);
      const gateStr = `${escapeHtml(String(c.gatePassCount))}/${escapeHtml(String(c.gateTotalCount))}`;
      const aiTag = c.source === "llm"
        ? ` <span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:0.65rem;font-weight:600;background:#eef1f4;color:var(--text-muted);vertical-align:middle;">AI</span>`
        : "";
      return `
        <tr>
          <td><strong>${escapeHtml(c.symbol)}</strong>${aiTag}</td>
          <td class="tc"><span class="phase-badge ${escapeHtml(phaseCls)}">${phaseStr}</span></td>
          <td class="tc">${rsStr}</td>
          <td class="tc">${sepaStr}</td>
          <td class="tc">${escapeHtml(capStr)}</td>
          <td>${industryStr}</td>
          <td class="tc">${gateStr}</td>
        </tr>`;
    })
    .join("");

  return `${headerHtml}
    <table style="table-layout:fixed;">
      <colgroup>
        <col style="width:12%">
        <col style="width:12%">
        <col style="width:8%">
        <col style="width:8%">
        <col style="width:12%">
        <col style="width:38%">
        <col style="width:10%">
      </colgroup>
      <thead>
        <tr>
          <th>종목</th>
          <th class="tc">Phase</th>
          <th class="tc">RS</th>
          <th class="tc">SEPA</th>
          <th class="tc">시총</th>
          <th>업종</th>
          <th class="tc">게이트</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderThesisAlignedSection(
  data: ThesisAlignedData | null | undefined,
  narrative: string,
): string {
  if (data == null || data.chains.length === 0) {
    return "";
  }

  const narrativeHtml = narrative.trim() !== ""
    ? `<div class="content-block">${mdToHtml(narrative)}</div>`
    : "";

  const summaryHtml = `
    <div class="stat-row">
      <div class="stat-chip">
        <span class="stat-label">활성 체인</span>
        <span class="stat-value">${escapeHtml(String(data.chains.length))}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">수혜 후보</span>
        <span class="stat-value">${escapeHtml(String(data.totalCandidates))}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">Phase 2</span>
        <span class="stat-value ${data.phase2Count > 0 ? "up" : "neutral-color"}">${escapeHtml(String(data.phase2Count))}</span>
      </div>
    </div>`;

  const chainsHtml = data.chains
    .map((group) => renderChainGroupCard(group))
    .join("");

  const noteHtml = `<p style="font-size:0.75rem;color:var(--text-muted);margin:12px 0 0;">게이트 = Phase2 + RS\u226560 + SEPA S/A + thesis연결 (업종RS 미포함, 4/4 만점) · 업종 탐색은 체인당 RS 상위 10개</p>`;

  return `${narrativeHtml}${summaryHtml}${chainsHtml}${noteHtml}`;
}

/**
 * 주간 리포트 전체 HTML을 조립한다.
 * 데이터 블록은 프로그래밍 렌더링, 해석 블록은 marked 마크다운→HTML 변환.
 * 셀프 컨테인드 — 외부 CSS/JS 의존 없음.
 *
 * @param data - 도구 반환값에서 직접 추출한 구조화 데이터
 * @param insight - LLM이 작성한 해석 텍스트
 * @param date - 리포트 기준일 (YYYY-MM-DD)
 */
export function buildWeeklyHtml(
  data: WeeklyReportData,
  insight: WeeklyReportInsight,
  date: string,
): string {
  const temperatureCls = escapeHtml(insight.marketTemperature);
  const temperatureLabel = escapeHtml(insight.marketTemperatureLabel);

  // 날짜 포맷 (MM/DD ~ MM/DD)
  // new Date("YYYY-MM-DD")는 UTC 자정으로 파싱되어 KST에서 getMonth()/getDate() 사용 시
  // 하루 밀림이 발생한다. 문자열에서 직접 파싱하거나 UTC 메서드를 사용한다.
  const [yearStr, monthStr, dayStr] = date.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const weekEndLabel = `${month}/${day}`;
  const weekStartDate = new Date(Date.UTC(year, month - 1, day - 4));
  const weekStartLabel = `${weekStartDate.getUTCMonth() + 1}/${weekStartDate.getUTCDate()}`;
  const weekRangeLabel = `${weekStartLabel} ~ ${weekEndLabel}`;

  // 데이터 블록 렌더링
  const indexTableHtml = renderIndexTable(data.indexReturns, data.fearGreed);
  const phase2TrendHtml = renderPhase2TrendTable(data.marketBreadth, insight.breadthNarrative);
  const sectorTableHtml = renderSectorTable(data.sectorRanking);
  const industryTop10Html = renderIndustryTop10Table(data.industryTop10);
  const watchlistHtml = renderWatchlistSection(data.watchlist);
  const watchlistChangesHtml = renderWatchlistChanges(data.watchlistChanges, data.gate5Candidates, data.industryTop10);

  // 해석 블록: LLM 텍스트 → marked HTML
  const sectorRotationHtml = mdToHtml(insight.sectorRotationNarrative);
  const industryFlowHtml = mdToHtml(insight.industryFlowNarrative);
  const watchlistNarrativeHtml = mdToHtml(insight.watchlistNarrative);
  const gate5SummaryHtml = mdToHtml(insight.gate5Summary);
  const riskFactorsHtml = mdToHtml(insight.riskFactors);
  const nextWeekHtml = mdToHtml(insight.nextWeekWatchpoints);
  const thesisScenariosHtml = mdToHtml(insight.thesisScenarios);
  const debateInsightHtml = mdToHtml(insight.debateInsight);
  const narrativeEvolutionHtml = mdToHtml(insight.narrativeEvolution);
  const thesisAccuracyHtml = mdToHtml(insight.thesisAccuracy);
  const regimeContextHtml = mdToHtml(insight.regimeContext);
  const thesisAlignedHtml = renderThesisAlignedSection(
    data.thesisAlignedCandidates,
    insight.thesisAlignedNarrative ?? "",
  );

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>주간 시장 분석 (${weekRangeLabel}) — ${escapeHtml(date)}</title>
  <style>${WEEKLY_REPORT_CSS}</style>
</head>
<body>
  <div class="container">
    <header class="report-header">
      <h1>주간 시장 분석 <span class="temp-badge ${temperatureCls}">${temperatureLabel}</span></h1>
      <div class="report-date">${escapeHtml(weekRangeLabel)} · Market Analyst</div>
    </header>

    <div class="report-body">
      <!-- 섹션 1: 주간 시장 구조 변화 -->
      <section>
        <h2>📊 주간 시장 구조 변화</h2>
        ${indexTableHtml}
      </section>

      <!-- 섹션 1-1: 시장 브레드스 -->
      <section>
        <h2>📊 시장 브레드스</h2>
        ${phase2TrendHtml}
      </section>

      <!-- 섹션 1-2: 섹터 로테이션 -->
      <section>
        <h2>🔄 섹터 로테이션</h2>
        ${sectorTableHtml}
        <div class="content-block">${sectorRotationHtml}</div>
      </section>

      <!-- 섹션 2: 업종 RS 주간 변화 -->
      <section>
        <h2>📈 업종 RS 주간 변화 Top 10</h2>
        ${industryTop10Html}
        <div class="content-block">${industryFlowHtml}</div>
      </section>

      <!-- 섹션 3: 토론 인사이트 -->
      <section>
        <h2>💬 토론 인사이트</h2>
        <h3>Thesis 충돌/강화</h3>
        <div class="content-block">${debateInsightHtml}</div>
        <h3>서사 체인 진화</h3>
        <div class="content-block">${narrativeEvolutionHtml}</div>
        <h3>Thesis 적중률 피드백</h3>
        <div class="content-block">${thesisAccuracyHtml}</div>
      </section>

      <!-- 섹션 3.5: 서사 수혜 후보 (데이터 없으면 섹션 미출력) -->
      ${thesisAlignedHtml !== "" ? `
      <section>
        <h2>🔗 서사 수혜 후보</h2>
        ${thesisAlignedHtml}
      </section>` : ""}

      <!-- 섹션 4: 관심종목 궤적 (ACTIVE) -->
      <section>
        <h2>🎯 관심종목 궤적</h2>
        ${watchlistHtml}
        ${data.watchlist.items.length > 0 ? `<div class="content-block">${watchlistNarrativeHtml}</div>` : ""}
      </section>

      <!-- 섹션 5: 5중 게이트 평가 + 등록/해제 -->
      <section>
        <h2>🆕 5중 게이트 평가 · 관심종목 등록/해제</h2>
        ${watchlistChangesHtml}
        <div class="content-block">${gate5SummaryHtml}</div>
      </section>

      <!-- 섹션 6: 다음 주 관전 포인트 -->
      <section>
        <h2>🔮 다음 주 관전 포인트</h2>
        <div class="content-block">${nextWeekHtml}</div>
        <div class="content-block">${thesisScenariosHtml}</div>
      </section>

      <!-- 리스크 요인 -->
      <section>
        <h2>⚠️ 리스크 요인</h2>
        <div class="content-block">${riskFactorsHtml}</div>
      </section>

      <!-- 레짐 맥락 -->
      <section>
        <h2>🌡️ 레짐 맥락</h2>
        <div class="content-block">${regimeContextHtml}</div>
      </section>
    </div>

    <footer class="report-footer">
      Generated by Market Analyst · ${escapeHtml(date)}
    </footer>
  </div>
</body>
</html>`;
}
