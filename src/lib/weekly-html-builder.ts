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
import type { PortfolioPositionWithCurrentData } from "@/db/repositories/portfolioPositionsRepository.js";
import type { WeeklyDebateSummary } from "@/debate/insightExtractor.js";
import { selectWeeklyWatchlist, WEEKLY_SPOTLIGHT_COUNT } from "@/lib/watchlistSelection.js";

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
    --warning-bg: #fff3cd;
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

  /* Phase 2 Segment Badges */
  .p2-segment {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.7rem;
    font-weight: 600;
  }
  .p2-초입 { background: #ddf4ff; color: #0969da; }
  .p2-진행 { background: #f0e6ff; color: #8250df; }
  .p2-확립 { background: #eef1f4; color: var(--text-muted); }

  /* Spotlight Badge */
  .spotlight-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 0.65rem;
    font-weight: 700;
    background: #e05a00;
    color: #fff;
    vertical-align: middle;
    margin-left: 4px;
  }
  .spotlight-row { background: #fffdf0; }

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

  /* Divergence Alert */
  .alert-block {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 12px 16px;
    border-radius: 8px;
    margin: 12px 0;
    font-size: 0.9rem;
    line-height: 1.4;
  }
  .alert-warning {
    background: #fff8e1;
    border: 1px solid #ffe082;
    color: #6d4c00;
  }
  @media (prefers-color-scheme: dark) {
    .alert-warning {
      background: #3e2c00;
      border-color: #6d4c00;
      color: #ffe082;
    }
  }
  .alert-icon { flex-shrink: 0; font-size: 1.1rem; }
  .alert-text { flex: 1; }

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
    flex-wrap: nowrap;
    align-items: center;
  }

  .traj-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
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

  /* Symbol cell with chain icon */
  .symbol-cell { display: flex; align-items: center; gap: 6px; }

  .chain-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: #e8f4fd;
    font-size: 0.6rem;
    cursor: default;
    position: relative;
    flex-shrink: 0;
  }
  .chain-icon::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 0;
    transform: none;
    background: #1a1a1a;
    color: #fff;
    font-size: 0.72rem;
    font-weight: 400;
    line-height: 1.4;
    padding: 6px 10px;
    border-radius: 6px;
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 100;
  }
  .chain-icon::before {
    content: '';
    position: absolute;
    bottom: calc(100% + 1px);
    left: 4px;
    transform: none;
    border: 5px solid transparent;
    border-top-color: #1a1a1a;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.15s;
    z-index: 100;
  }
  .chain-icon:hover::after,
  .chain-icon:hover::before { opacity: 1; }

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

/** Breadth Score 구간별 상태 레이블 (0~100) */
function getBreadthScoreLabel(score: number): string {
  if (score >= 80) return "극강세";
  if (score >= 60) return "강세";
  if (score >= 40) return "보통";
  if (score >= 20) return "약세";
  return "극약세";
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
  // .value — zone 색상: 공포(≤25)=파랑, 탐욕(≥75)=빨강
  const scoreCls = fg.score <= 25 ? "down" : fg.score >= 75 ? "up" : "";

  // .change — 주간 리포트이므로 1주전 대비 변화량 표시 (전일 대비 아님)
  const weekDiff = fg.previous1Week != null ? fg.score - fg.previous1Week : null;
  const changeCls = weekDiff != null ? colorClass(weekDiff) : "neutral-color";
  const changeLabel = weekDiff != null
    ? weekDiff === 0
      ? "— 0.0"
      : `${weekDiff > 0 ? "▲" : "▼"} ${weekDiff > 0 ? "+" : ""}${weekDiff.toFixed(1)}`
    : "—";

  // [sub] — 방향 라벨만 표시 (주간 변화량은 .change에 이미 노출)
  const directionLabel =
    fg.previous1Week != null
      ? getFearGreedDirectionLabel(fg.score, fg.previous1Week)
      : "";

  return `
    <div class="index-card">
      <div class="label">공포탐욕 · ${escapeHtml(fg.rating)}</div>
      <div class="value ${escapeHtml(scoreCls)}">${escapeHtml(String(fg.score))}</div>
      <div class="change ${escapeHtml(changeCls)}">${escapeHtml(changeLabel)}</div>
      ${directionLabel !== ""
        ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">${escapeHtml(directionLabel)}</div>`
        : ""}
    </div>`;
}

function phaseBadgeClass(phase: number): string {
  const map: Record<number, string> = { 1: "p1", 2: "p2", 3: "p3", 4: "p4" };
  return map[phase] ?? "p1";
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
 * divergenceSignal에 따른 경고 알럿 HTML을 생성한다.
 * null이면 빈 문자열 반환 (알럿 미표시).
 */
function renderDivergenceAlert(signal: MarketBreadthData["latestSnapshot"]["divergenceSignal"]): string {
  if (signal == null) return "";
  const message: string = (() => {
    switch (signal) {
      case "negative":
        return "Phase 2 유지 중이나 MA50 이상 비율 하락 — 중기 약화 경고";
      case "positive":
        return "SPX 하락 중이나 브레드스 내부 개선 — 중기 반등 신호";
      default: {
        const _exhaustive: never = signal;
        throw new Error(`Unhandled divergence signal: ${_exhaustive}`);
      }
    }
  })();
  return `<div class="alert-block alert-warning">
          <span class="alert-icon">⚠️</span>
          <span class="alert-text">중기 브레드스 다이버전스: ${escapeHtml(message)}</span>
        </div>`;
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

  const BREADTH_SCORE_FLAT_THRESHOLD = 0.5;
  const breadthScoreChangeDisplay: string = (() => {
    if (snap.breadthScoreChange == null) return "";
    if (Math.abs(snap.breadthScoreChange) < BREADTH_SCORE_FLAT_THRESHOLD) return "보합";
    return `${snap.breadthScoreChange >= 0 ? "+" : ""}${snap.breadthScoreChange.toFixed(1)}`;
  })();
  const breadthScoreChangeCls: string = (() => {
    if (snap.breadthScoreChange == null) return "";
    if (Math.abs(snap.breadthScoreChange) < BREADTH_SCORE_FLAT_THRESHOLD) return "neutral-color";
    return colorClass(snap.breadthScoreChange);
  })();

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
              <span class="stat-value">${escapeHtml(breadthScoreStr)} <span class="stat-inline-label">${escapeHtml(getBreadthScoreLabel(snap.breadthScore!))}</span>${
                breadthScoreChangeDisplay !== ""
                  ? ` <span class="${escapeHtml(breadthScoreChangeCls)}" style="font-size:0.85rem;">${escapeHtml(breadthScoreChangeDisplay)}</span>`
                  : ""
              }</span>
            </div>`
          : ""
      }
      ${
        snap.pctAboveMa50 != null
          ? `<div class="stat-chip">
              <span class="stat-label">MA50 이상 비율</span>
              <span class="stat-value">${escapeHtml(snap.pctAboveMa50.toFixed(1))}%</span>
            </div>`
          : ""
      }
    </div>`;

  const divergenceAlertHtml = renderDivergenceAlert(snap.divergenceSignal);

  const trendTableHtml = renderWeeklyTrendTable(weeklyTrend);

  const narrativeHtml =
    breadthNarrative != null && breadthNarrative.trim() !== ""
      ? `<div class="content-block">${mdToHtml(breadthNarrative)}</div>`
      : "";

  return `${phaseBar}${statsHtml}${divergenceAlertHtml}${trendTableHtml}${narrativeHtml}`;
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
 * 선별 점수 기반 정렬 + 상위 종목에 "주목" 뱃지 표시.
 * portfolio_positions ACTIVE 심볼은 제외한다 (섹션 5에서 별도 렌더링).
 * 0건이면 빈 상태 메시지를 표시한다.
 *
 * @param activePortfolioSymbols - 섹션 5에서 렌더링할 포트폴리오 편입 심볼 목록
 */
export function renderWatchlistSection(
  watchlist: WatchlistStatusData,
  activePortfolioSymbols: string[] = [],
  chainMap?: Map<string, string>,
): string {
  const { items } = watchlist;

  // 포트폴리오 편입 종목 제외 후 S/A 등급 필터 + 선별 점수 정렬
  const portfolioExcluded = items.filter(
    (item) => !activePortfolioSymbols.includes(item.symbol),
  );
  const scoredItems = selectWeeklyWatchlist(portfolioExcluded);

  if (scoredItems.length === 0) {
    return '<div class="empty-state">현재 ACTIVE 관심종목 없음</div>';
  }

  // 필터링된 항목 기준으로 요약 재계산
  const filteredSymbols = new Set(scoredItems.map((i) => i.symbol));
  const filteredPhaseChanges = watchlist.summary.phaseChanges.filter(
    (pc) => filteredSymbols.has(pc.symbol),
  );
  const filteredAvgPnl =
    scoredItems.reduce((sum, i) => sum + (i.pnlPercent ?? 0), 0) / scoredItems.length;

  const avgPnlStr =
    filteredAvgPnl >= 0
      ? `+${filteredAvgPnl.toFixed(1)}%`
      : `${filteredAvgPnl.toFixed(1)}%`;
  const avgPnlCls = colorClass(filteredAvgPnl);

  const spotlightCount = Math.min(WEEKLY_SPOTLIGHT_COUNT, scoredItems.length);

  const summaryHtml = `
    <div class="stat-row">
      <div class="stat-chip">
        <span class="stat-label">ACTIVE 종목 수 (S/A)</span>
        <span class="stat-value">${escapeHtml(String(scoredItems.length))}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">이번 주 주목</span>
        <span class="stat-value">${escapeHtml(String(spotlightCount))}종목</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">평균 P&amp;L (S/A)</span>
        <span class="stat-value ${escapeHtml(avgPnlCls)}">${escapeHtml(avgPnlStr)}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">Phase 변화 종목</span>
        <span class="stat-value">${escapeHtml(String(filteredPhaseChanges.length))}건</span>
      </div>
    </div>`;

  const itemRows = scoredItems
    .map((item, idx) => {
      const isSpotlight = idx < WEEKLY_SPOTLIGHT_COUNT;
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
          return `<div class="traj-dot ${escapeHtml(cls)}" title="Phase ${escapeHtml(String(t.phase))} · ${escapeHtml(t.date)}"></div>`;
        })
        .join("");

      const sepaStr = item.entrySepaGrade != null ? escapeHtml(item.entrySepaGrade) : "—";
      const rsStr =
        item.currentRsScore != null
          ? `RS ${item.currentRsScore.toFixed(0)}`
          : item.entryRsScore != null
            ? `RS ${item.entryRsScore.toFixed(0)} (진입)`
            : "—";

      const p2SegmentBadge = item.phase2Segment != null && item.phase2SinceDays != null
        ? `<span class="p2-segment p2-${escapeHtml(item.phase2Segment)}">${escapeHtml(item.phase2Segment)} ${escapeHtml(String(item.phase2SinceDays))}일</span>`
        : "—";

      const spotlightBadge = isSpotlight
        ? '<span class="spotlight-badge">주목</span> '
        : "";

      const chainTooltip = chainMap?.get(item.symbol);
      const chainIconHtml = chainTooltip != null
        ? `<span class="chain-icon" data-tooltip="${escapeHtml(chainTooltip)}">🔗</span>`
        : "";

      const rowClass = isSpotlight ? ' class="spotlight-row"' : "";

      return `
        <tr${rowClass}>
          <td>
            <div class="symbol-cell">
              <strong>${escapeHtml(item.symbol)}</strong>${spotlightBadge}${chainIconHtml}
            </div>
          </td>
          <td>${escapeHtml(item.entrySector ?? "—")}</td>
          <td>${escapeHtml(item.entryDate)}</td>
          <td>${escapeHtml(String(item.daysTracked))}일</td>
          <td><span class="phase-badge ${escapeHtml(phaseCls)}">Phase ${escapeHtml(String(item.currentPhase ?? item.entryPhase))}</span></td>
          <td><div class="trajectory-dots">${trajDots}</div></td>
          <td class="${escapeHtml(pnlCls)}">${escapeHtml(pnlStr)}</td>
          <td>${escapeHtml(rsStr)}</td>
          <td>${sepaStr}</td>
          <td>${p2SegmentBadge}</td>
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
          <th>P2 구간</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>`;

  return `${summaryHtml}${table}`;
}

/**
 * 포트폴리오 편입/탈락 변동을 렌더링한다.
 * - registered: 이번 주 포트폴리오 편입 확정
 * - exited: 이번 주 포트폴리오 탈락 확정
 */
export function renderWatchlistChanges(
  changes: WeeklyReportData["watchlistChanges"],
): string {
  const { registered, exited } = changes;

  const hasAny = registered.length > 0 || exited.length > 0;

  if (!hasAny) {
    return `<div class="empty-state">이번 주 포트폴리오 변동 없음</div>`;
  }

  const registeredHtml = registered.length > 0
    ? `
      <h3>신규 편입 (${escapeHtml(String(registered.length))}종목)</h3>
      <div class="gate5-grid">
        ${registered.map((c) => renderWatchlistChangeCard(c, "registered")).join("")}
      </div>`
    : `<h3>신규 편입</h3><div class="empty-state">이번 주 신규 편입 없음</div>`;

  const exitedHtml = exited.length > 0
    ? `
      <h3>탈락 (${escapeHtml(String(exited.length))}종목)</h3>
      <div class="gate5-grid">
        ${exited.map((c) => renderWatchlistChangeCard(c, "exited")).join("")}
      </div>`
    : "";

  return `${registeredHtml}${exitedHtml}`;
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

/**
 * 현재 포트폴리오 포지션 테이블을 렌더링한다.
 * 수익률 컬러: 양수=빨강(#e63312), 음수=파랑(#2563eb) — 한국식 규칙.
 * Phase 컬러: 2=강세(빨강), 3=위험(파랑).
 */
export function renderPortfolioSection(
  positions: PortfolioPositionWithCurrentData[],
  chainMap?: Map<string, string>,
): string {
  if (positions.length === 0) {
    return `<div class="empty-state">현재 편입 종목 없음</div>`;
  }

  const rows = positions
    .map((pos) => {
      const entryPriceStr = pos.entryPrice != null
        ? `$${Number(pos.entryPrice).toLocaleString("en-US", { maximumFractionDigits: 2 })}`
        : "—";

      const currentPriceStr = pos.currentPrice != null
        ? `$${pos.currentPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}`
        : "—";

      const pnlStr = pos.pnlPercent != null
        ? `${pos.pnlPercent >= 0 ? "+" : ""}${pos.pnlPercent.toFixed(1)}%`
        : "—";

      // 한국식 컬러 규칙: 양수=빨강(up), 음수=파랑(down)
      const pnlCls = pos.pnlPercent != null ? colorClass(pos.pnlPercent) : "neutral-color";

      const phaseCls = pos.currentPhase != null ? phaseBadgeClass(pos.currentPhase) : "p1";
      const phaseStr = pos.currentPhase != null ? `Phase ${pos.currentPhase}` : "—";

      const rsStr = pos.currentRsScore != null ? String(pos.currentRsScore) : "—";

      const chainTooltip = chainMap?.get(pos.symbol);
      const chainIconHtml = chainTooltip != null
        ? `<span class="chain-icon" data-tooltip="${escapeHtml(chainTooltip)}">🔗</span>`
        : "";

      return `
        <tr>
          <td>
            <div class="symbol-cell">
              <strong>${escapeHtml(pos.symbol)}</strong>${chainIconHtml}
            </div>
          </td>
          <td>${escapeHtml(pos.sector ?? "—")}</td>
          <td>${escapeHtml(pos.entryDate)}</td>
          <td>${escapeHtml(entryPriceStr)}</td>
          <td>${escapeHtml(currentPriceStr)}</td>
          <td class="${escapeHtml(pnlCls)}">${escapeHtml(pnlStr)}</td>
          <td><span class="phase-badge ${escapeHtml(phaseCls)}">${escapeHtml(phaseStr)}</span></td>
          <td>${escapeHtml(rsStr)}</td>
        </tr>`;
    })
    .join("");

  return `
    <table>
      <thead>
        <tr>
          <th>종목</th>
          <th>섹터</th>
          <th>편입일</th>
          <th>편입가</th>
          <th>현재가</th>
          <th>수익률</th>
          <th>Phase</th>
          <th>RS</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ─── 최종 HTML 조립 ───────────────────────────────────────────────────────────

// ─── 주간 토론 종합 렌더링 ──────────────────────────────────────────────────

/**
 * 주간 토론 종합 데이터를 HTML로 렌더링한다.
 * 병목 상태 변화 테이블 + 주도섹터 합의 + 과열 경고.
 * 데이터 없으면 빈 문자열 반환.
 */
export function renderWeeklyDebateSummary(summary: WeeklyDebateSummary | null): string {
  if (summary == null) return "";

  const hasBottlenecks = summary.bottleneckTransitions.length > 0;
  const hasLeadingSectors = summary.leadingSectors.length > 0;
  const hasWarnings = summary.warnings.length > 0;

  if (!hasBottlenecks && !hasLeadingSectors && !hasWarnings) return "";

  const parts: string[] = [];

  parts.push(`<div class="debate-weekly-summary" style="margin-bottom:16px;">`);
  parts.push(`<p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:8px;">📋 ${escapeHtml(summary.sessionCount)}세션 토론 누적 분석</p>`);

  // 병목 상태 변화 테이블
  if (hasBottlenecks) {
    parts.push(`<h4 style="margin:12px 0 6px;font-size:0.85rem;">병목 상태 변화</h4>`);
    parts.push(`<table><thead><tr><th>병목</th><th>주초</th><th></th><th>주말</th></tr></thead><tbody>`);
    for (const bt of summary.bottleneckTransitions) {
      const arrow = bt.changed ? "→" : "=";
      const changeClass = bt.changed ? ' style="font-weight:600;"' : "";
      parts.push(
        `<tr${changeClass}>` +
          `<td>${escapeHtml(bt.name)}</td>` +
          `<td>${escapeHtml(bt.initialStatus)}</td>` +
          `<td>${arrow}</td>` +
          `<td>${escapeHtml(bt.finalStatus)}</td>` +
        `</tr>`,
      );
    }
    parts.push(`</tbody></table>`);
  }

  // 주도섹터 합의
  if (hasLeadingSectors) {
    parts.push(`<h4 style="margin:12px 0 6px;font-size:0.85rem;">주간 주도섹터/주도주 합의</h4>`);
    parts.push(`<div style="display:flex;flex-wrap:wrap;gap:6px;">`);
    for (const ls of summary.leadingSectors) {
      parts.push(
        `<span class="stat-chip" style="background:var(--surface-2);padding:4px 8px;border-radius:4px;font-size:0.8rem;">` +
          `${escapeHtml(ls.name)} <strong>${escapeHtml(ls.mentionCount)}/${escapeHtml(ls.totalDays)}일</strong>` +
        `</span>`,
      );
    }
    parts.push(`</div>`);
  }

  // 과열 경고
  if (hasWarnings) {
    parts.push(`<h4 style="margin:12px 0 6px;font-size:0.85rem;">반복 과열/위험 경고</h4>`);
    parts.push(`<div style="display:flex;flex-wrap:wrap;gap:6px;">`);
    for (const w of summary.warnings) {
      parts.push(
        `<span class="stat-chip" style="background:var(--warning-bg);padding:4px 8px;border-radius:4px;font-size:0.8rem;">` +
          `⚠️ ${escapeHtml(w.target)} <strong>${escapeHtml(w.warningCount)}/${escapeHtml(w.totalDays)}일</strong>` +
        `</span>`,
      );
    }
    parts.push(`</div>`);
  }

  parts.push(`</div>`);
  return parts.join("\n");
}

/**
 * 주간 리포트 전체 HTML을 조립한다.
 * 데이터 블록은 프로그래밍 렌더링, 해석 블록은 marked 마크다운→HTML 변환.
 * 셀프 컨테인드 — 외부 CSS/JS 의존 없음.
 *
 * @param data - 도구 반환값에서 직접 추출한 구조화 데이터
 * @param insight - LLM이 작성한 해석 텍스트
 * @param date - 리포트 기준일 (YYYY-MM-DD)
 * @param portfolioPositions - ACTIVE 포트폴리오 포지션 (현재가·수익률 포함). 섹션 5 렌더링용.
 * @param weeklyDebateSummary - 주간 토론 종합 데이터. null이면 해당 섹션 생략.
 */
export function buildWeeklyHtml(
  data: WeeklyReportData,
  insight: WeeklyReportInsight,
  date: string,
  portfolioPositions: PortfolioPositionWithCurrentData[] = [],
  weeklyDebateSummary: WeeklyDebateSummary | null = null,
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

  // thesisAlignedCandidates → symbol별 체인 툴팁 맵 (관심종목/포트폴리오 테이블 아이콘용)
  const chainMap = new Map<string, string>();
  if (data.thesisAlignedCandidates != null) {
    for (const chain of data.thesisAlignedCandidates.chains) {
      const tooltip = `${chain.megatrend} · ${chain.bottleneck}`;
      for (const c of chain.candidates) {
        if (!chainMap.has(c.symbol)) {
          chainMap.set(c.symbol, tooltip);
        }
      }
    }
  }

  // 데이터 블록 렌더링
  const indexTableHtml = renderIndexTable(data.indexReturns, data.fearGreed);
  const phase2TrendHtml = renderPhase2TrendTable(data.marketBreadth, insight.breadthNarrative);
  const sectorTableHtml = renderSectorTable(data.sectorRanking);
  const industryTop10Html = renderIndustryTop10Table(data.industryTop10);
  const watchlistHtml = renderWatchlistSection(data.watchlist, data.activePortfolioSymbols, chainMap);
  const watchlistChangesHtml = renderWatchlistChanges(data.watchlistChanges);
  const portfolioTableHtml = renderPortfolioSection(portfolioPositions, chainMap);

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
  const weeklyDebateSummaryHtml = renderWeeklyDebateSummary(weeklyDebateSummary);

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
        ${weeklyDebateSummaryHtml}
        <h3>Thesis 충돌/강화</h3>
        <div class="content-block">${debateInsightHtml}</div>
        <h3>서사 체인 진화</h3>
        <div class="content-block">${narrativeEvolutionHtml}</div>
        <h3>Thesis 적중률 피드백</h3>
        <div class="content-block">${thesisAccuracyHtml}</div>
      </section>

      <!-- 섹션 4: 관심종목 궤적 (ACTIVE) -->
      <section>
        <h2>🎯 관심종목 궤적</h2>
        ${watchlistHtml}
        ${data.watchlist.items.length > 0 ? `<div class="content-block">${watchlistNarrativeHtml}</div>` : ""}
      </section>

      <!-- 섹션 5: 포트폴리오 편입/탈락 + 현재 포트폴리오 -->
      <section>
        <h2>🆕 포트폴리오 편입/탈락</h2>
        ${watchlistChangesHtml}
        <div class="content-block">${gate5SummaryHtml}</div>
        <h2>📋 현재 포트폴리오</h2>
        ${portfolioTableHtml}
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
