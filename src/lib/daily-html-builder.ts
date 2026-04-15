/**
 * daily-html-builder.ts — 일간 리포트 프로그래밍 HTML 렌더러
 *
 * 데이터 블록(지수/Phase 분포/섹터/업종/특이종목/RS상승/관심종목)은
 * 도구 반환값을 직접 렌더링.
 * 해석 블록(narrative)은 LLM 텍스트를 marked로 마크다운→HTML 변환.
 *
 * 색상 규칙: 상승=--up(#cf222e/빨강), 하락=--down(#0969da/파랑). 초록/빨강 금지.
 * XSS: 모든 DB/사용자 데이터는 escapeHtml() 처리. marked는 raw HTML 이스케이프 모드.
 *
 * ⚠️  phase2Ratio는 이미 퍼센트(0~100). 절대 ×100 하지 말 것.
 */

import { Marked } from "marked";
import type {
  DailyIndexReturn,
  FearGreedData,
  DailyBreadthSnapshot,
  DailySectorItem,
  DailyIndustryItem,
  DailyUnusualStock,
  DailyRisingRSStock,
  DailyWatchlistData,
  DailyReportData,
  DailyReportInsight,
  MarketPositionData,
} from "@/tools/schemas/dailyReportSchema.js";
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

const DAILY_REPORT_CSS = `
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
    --phase2: #8250df;
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

  /* 시장 온도 배지 */
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
  .temp-badge.bullish { background: #ffebe9; color: var(--up); }
  .temp-badge.bearish { background: #ddf4ff; color: var(--down); }

  /* 온도계 온도 표시 바 */
  .temperature-bar {
    display: flex;
    align-items: stretch;
    border-radius: 8px;
    overflow: hidden;
    height: 8px;
    margin: 12px 0 16px;
  }
  /* temperature-bar 제거됨 — 정량 기준 없는 3분할 바 */
  .temperature-bar .seg-bearish {
    background: var(--down);
    opacity: 0.3;
  }
  .temperature-bar .seg-neutral {
    background: var(--yellow);
    opacity: 0.3;
  }
  .temperature-bar .seg-bullish {
    background: var(--up);
    opacity: 0.3;
  }
  .temperature-bar .seg-active {
    opacity: 1;
  }

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
  .phase-badge.p2 { background: #f0e6ff; color: var(--phase2); }
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

  /* Phase Distribution Bar */
  .phase-bar {
    display: flex;
    height: 12px;
    border-radius: 6px;
    overflow: hidden;
    margin: 8px 0;
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

  .stat-inline-label {
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 400;
  }

  .stat-sub {
    display: inline-block;
    font-size: 0.75rem;
    font-weight: 400;
    margin-left: 4px;
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

  /* Unusual Stocks Cards */
  .unusual-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
    margin: 12px 0;
  }

  .unusual-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 14px 16px;
  }

  .unusual-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .unusual-ticker {
    font-size: 1rem;
    font-weight: 700;
  }

  .unusual-meta {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .unusual-return {
    margin-left: auto;
    font-size: 0.9rem;
    font-weight: 700;
  }

  .unusual-conditions {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    margin-top: 8px;
  }

  /* Condition Tags */
  .cond-tag {
    font-size: 0.72rem;
    padding: 2px 8px;
    border-radius: 4px;
    font-weight: 500;
  }
  .cond-tag.big-move { background: #ffebe9; color: var(--up); }
  .cond-tag.high-volume { background: #ddf4ff; color: var(--accent); }
  .cond-tag.phase-change { background: #fbefff; color: var(--purple); }
  .cond-tag.phase2-drop { background: #fff3cd; color: var(--orange); }
  .cond-tag.split-suspect { background: #fff8c5; color: var(--yellow); }

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

  /* Insight Section */
  .insight-card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px 20px;
    margin: 12px 0;
  }

  .insight-rationale {
    font-size: 0.9rem;
    line-height: 1.7;
    color: var(--text);
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

  /* Market Position Gates */
  .gate-block {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 16px;
    margin-top: 16px;
  }

  .gate-header {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin-bottom: 10px;
  }

  .gate-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    font-size: 0.85rem;
  }

  .gate-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .gate-dot.pass { background: var(--up); }
  .gate-dot.fail { background: var(--down); }

  .gate-detail {
    color: var(--text-muted);
    font-size: 0.8rem;
    margin-left: auto;
  }

  /* Responsive */
  @media (max-width: 600px) {
    .container { padding: 16px 12px; }
    .index-grid { grid-template-columns: repeat(2, 1fr); }
    .unusual-grid { grid-template-columns: 1fr; }
  }
`;

// ─── 상수 ─────────────────────────────────────────────────────────────────────

/** 특이종목 섹션 최대 표시 건수. 노이즈 제한용. */
const MAX_UNUSUAL_STOCKS = 8;

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

function formatNumber(value: number | null, fallback = "—"): string {
  if (value == null) return fallback;
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function phaseBadgeClass(phase: number): string {
  const map: Record<number, string> = { 1: "p1", 2: "p2", 3: "p3", 4: "p4" };
  return map[phase] ?? "p1";
}

const LARGE_CAP_THRESHOLD = 10_000_000_000;
const MID_CAP_THRESHOLD = 2_000_000_000;

function marketCapLabel(cap: number | null): string {
  if (cap == null) return "—";
  if (cap >= LARGE_CAP_THRESHOLD) return "Large";
  if (cap >= MID_CAP_THRESHOLD) return "Mid";
  return "Small";
}

function formatMarketCap(cap: number | null): string {
  if (cap == null) return "—";
  if (cap >= 1_000_000_000_000) return `$${(cap / 1_000_000_000_000).toFixed(1)}T`;
  if (cap >= 1_000_000_000) return `$${(cap / 1_000_000_000).toFixed(1)}B`;
  if (cap >= 1_000_000) return `$${(cap / 1_000_000).toFixed(0)}M`;
  return `$${cap.toLocaleString()}`;
}

/**
 * 마크다운 텍스트를 HTML로 변환한다.
 * raw HTML은 이스케이프 처리하여 XSS를 방지한다.
 */
function mdToHtml(markdown: string): string {
  if (markdown.trim() === "") return "";
  return markedInstance.parse(markdown) as string;
}

/**
 * 해석(narrative) 블록을 HTML로 렌더링한다.
 * 비어 있거나 "해당 없음"이면 빈 문자열을 반환한다.
 */
function renderNarrativeBlock(narrative: string | null | undefined): string {
  if (narrative == null || narrative === "해당 없음" || narrative.trim() === "") {
    return "";
  }
  return `<div class="content-block">${mdToHtml(narrative)}</div>`;
}

/**
 * 특이종목 정렬: Phase 전환 우선 → 거래량비 내림차순 → 수익률 절대값 내림차순
 */
function sortUnusualStocks(stocks: DailyUnusualStock[]): DailyUnusualStock[] {
  return [...stocks].sort((a, b) => {
    const aHasPhaseChange = a.conditions.includes("phase_change") ? 1 : 0;
    const bHasPhaseChange = b.conditions.includes("phase_change") ? 1 : 0;
    if (bHasPhaseChange !== aHasPhaseChange) return bHasPhaseChange - aHasPhaseChange;
    if (b.volRatio !== a.volRatio) return b.volRatio - a.volRatio;
    return Math.abs(b.dailyReturn) - Math.abs(a.dailyReturn);
  });
}

// ─── Fear & Greed 내부 헬퍼 ────────────────────────────────────────────────────

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
 * 시장 환경 멀티게이트 블록을 렌더링한다.
 * data가 null이면 빈 문자열 반환 — 섹션 레이아웃에 영향 없음.
 */
export function renderMarketPositionGates(
  data: MarketPositionData | null,
): string {
  if (data == null) return "";

  const rows = data.gates
    .map((g) => {
      const dotCls = g.passed ? "pass" : "fail";
      return `
        <div class="gate-row">
          <div class="gate-dot ${escapeHtml(dotCls)}"></div>
          <span>${escapeHtml(g.label)}</span>
          <span class="gate-detail">${escapeHtml(g.detail)}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="gate-block">
      <div class="gate-header">시장 환경 (${escapeHtml(String(data.passCount))}/${escapeHtml(String(data.totalCount))})</div>
      ${rows}
    </div>`;
}

function renderFearGreedCard(fg: FearGreedData): string {
  // .value — zone 색상: 공포(≤25)=파랑, 탐욕(≥75)=빨강
  const scoreCls = fg.score <= 25 ? "down" : fg.score >= 75 ? "up" : "";

  // .change — 전일 대비 변화량 + direction 색상 (다른 지수 카드와 동일 문법)
  const prevDiff = fg.previousClose != null ? fg.score - fg.previousClose : null;
  const changeCls = prevDiff != null ? colorClass(prevDiff) : "neutral-color";
  const changeLabel = prevDiff != null
    ? prevDiff === 0
      ? "— 0.0"
      : `${prevDiff > 0 ? "▲" : "▼"} ${prevDiff > 0 ? "+" : ""}${prevDiff.toFixed(1)}`
    : "—";

  // [sub] — 방향 라벨 + 1주전 비교
  const directionLabel =
    fg.previous1Week != null
      ? getFearGreedDirectionLabel(fg.score, fg.previous1Week)
      : "";
  const prev1wSub = (() => {
    if (fg.previous1Week == null) return "";
    const diff = fg.score - fg.previous1Week;
    const sign = diff >= 0 ? "+" : "";
    return `1주전 ${fg.previous1Week.toFixed(1)} (${sign}${diff.toFixed(1)})`;
  })();
  const subParts = [directionLabel, prev1wSub].filter(Boolean);

  return `
    <div class="index-card">
      <div class="label">공포탐욕 · ${escapeHtml(fg.rating)}</div>
      <div class="value ${escapeHtml(scoreCls)}">${escapeHtml(String(fg.score))}</div>
      <div class="change ${escapeHtml(changeCls)}">${escapeHtml(changeLabel)}</div>
      ${subParts.length > 0
        ? `<div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
            ${subParts.map((s) => escapeHtml(s)).join(" · ")}
          </div>`
        : ""}
    </div>`;
}

const VIX_FEAR_THRESHOLD = 25;

function renderVixIndexCard(idx: DailyIndexReturn): string {
  const cls = vixColorClass(idx.changePercent);
  const directionLabel = idx.changePercent > 0 ? "▲" : idx.changePercent < 0 ? "▼" : "—";
  const fearBadge =
    idx.close >= VIX_FEAR_THRESHOLD
      ? `<div style="font-size:0.72rem;color:var(--orange);font-weight:600;margin-top:4px;">공포 임계선 도달</div>`
      : "";

  return `
    <div class="index-card">
      <div class="label">${escapeHtml(idx.name)}</div>
      <div class="value">${escapeHtml(formatNumber(idx.close))}</div>
      <div class="change ${escapeHtml(cls)}">${escapeHtml(directionLabel)} ${escapeHtml(formatPercent(idx.changePercent))}</div>
      ${fearBadge}
    </div>`;
}

/**
 * US 10Y Treasury 전용 카드.
 * 종가는 yield(%) 표시, 변화량은 bp(basis point) 단위.
 */
function renderUs10yCard(idx: DailyIndexReturn): string {
  const cls = colorClass(idx.changePercent);
  const bpChange = idx.change * 100;
  const bpStr = `${bpChange >= 0 ? "+" : ""}${bpChange.toFixed(1)}bp`;

  return `
    <div class="index-card">
      <div class="label">${escapeHtml(idx.name)}</div>
      <div class="value">${escapeHtml(idx.close.toFixed(2))}%</div>
      <div class="change ${escapeHtml(cls)}">${escapeHtml(formatPercent(idx.changePercent))}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
        ${escapeHtml(bpStr)}
      </div>
    </div>`;
}

/**
 * DXY(달러 인덱스) 전용 카드.
 * 종가는 포인트 표시, 변화량은 포인트 + % 병기.
 */
function renderDxyCard(idx: DailyIndexReturn): string {
  const cls = colorClass(idx.changePercent);

  return `
    <div class="index-card">
      <div class="label">${escapeHtml(idx.name)}</div>
      <div class="value">${escapeHtml(formatNumber(idx.close))}</div>
      <div class="change ${escapeHtml(cls)}">${escapeHtml(formatPercent(idx.changePercent))}</div>
      <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
        ${escapeHtml(idx.change >= 0 ? "+" : "")}${escapeHtml(idx.change.toFixed(2))}pt
      </div>
    </div>`;
}

// ─── 렌더링 함수들 ────────────────────────────────────────────────────────────

/**
 * 일간 지수 카드 그리드 + Fear & Greed 행을 렌더링한다.
 * 일간 데이터이므로 주간 고가/저가 대신 당일 종가/등락률만 표시.
 */
export function renderIndexTable(
  data: DailyIndexReturn[],
  fearGreed: FearGreedData | null,
): string {
  if (data.length === 0) {
    return '<div class="empty-state">지수 데이터를 가져올 수 없습니다.</div>';
  }

  const cards = data
    .map((idx) => {
      if (idx.symbol === "^VIX") {
        return renderVixIndexCard(idx);
      }
      if (idx.symbol === "^TNX") {
        return renderUs10yCard(idx);
      }
      if (idx.symbol === "DX-Y.NYB") {
        return renderDxyCard(idx);
      }

      const cls = colorClass(idx.changePercent);
      const changeStr = formatPercent(idx.changePercent);

      return `
        <div class="index-card">
          <div class="label">${escapeHtml(idx.name)}</div>
          <div class="value">${escapeHtml(formatNumber(idx.close))}</div>
          <div class="change ${escapeHtml(cls)}">${escapeHtml(changeStr)}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px;">
            전일 대비 ${escapeHtml(idx.change >= 0 ? "+" : "")}${escapeHtml(formatNumber(idx.change))}
          </div>
        </div>`;
    })
    .join("");

  const fearGreedHtml = fearGreed != null ? renderFearGreedCard(fearGreed) : "";

  return `<div class="index-grid">${cards}${fearGreedHtml}</div>`;
}

/**
 * 일간 Phase 분포 바 + 지표 행을 렌더링한다.
 * 주간 빌더의 renderPhase2TrendTable과 달리 단일 스냅샷 기준.
 */
export function renderPhaseDistribution(data: DailyBreadthSnapshot, narrative?: string): string {
  const total = data.totalStocks > 0 ? data.totalStocks : 1;
  const p1Pct = ((data.phaseDistribution.phase1 / total) * 100).toFixed(1);
  const p2Pct = ((data.phaseDistribution.phase2 / total) * 100).toFixed(1);
  const p3Pct = ((data.phaseDistribution.phase3 / total) * 100).toFixed(1);
  const p4Pct = ((data.phaseDistribution.phase4 / total) * 100).toFixed(1);

  const PHASE2_FLAT_THRESHOLD = 0.05;
  const p2ChangeCls =
    Math.abs(data.phase2RatioChange) < PHASE2_FLAT_THRESHOLD
      ? "neutral-color"
      : colorClass(data.phase2RatioChange);
  const p2ChangeStr =
    Math.abs(data.phase2RatioChange) < PHASE2_FLAT_THRESHOLD
      ? "보합"
      : `${data.phase2RatioChange >= 0 ? "+" : ""}${data.phase2RatioChange.toFixed(2)}%p`;

  const subtitle = `<h3>Phase 분포</h3>`;

  const phaseBar = `
    <div class="phase-bar">
      <div class="seg p1" style="width:${escapeHtml(p1Pct)}%"></div>
      <div class="seg p2" style="width:${escapeHtml(p2Pct)}%"></div>
      <div class="seg p3" style="width:${escapeHtml(p3Pct)}%"></div>
      <div class="seg p4" style="width:${escapeHtml(p4Pct)}%"></div>
    </div>
    <div class="phase-legend">
      <span class="l1">Phase 1 ${escapeHtml(p1Pct)}% (${escapeHtml(String(data.phaseDistribution.phase1))})</span>
      <span class="l2">Phase 2 ${escapeHtml(p2Pct)}% (${escapeHtml(String(data.phaseDistribution.phase2))})</span>
      <span class="l3">Phase 3 ${escapeHtml(p3Pct)}% (${escapeHtml(String(data.phaseDistribution.phase3))})</span>
      <span class="l4">Phase 4 ${escapeHtml(p4Pct)}% (${escapeHtml(String(data.phaseDistribution.phase4))})</span>
    </div>`;

  const breadthScoreStr =
    data.breadthScore != null
      ? data.breadthScore.toFixed(1)
      : "—";

  const BREADTH_SCORE_FLAT_THRESHOLD = 0.5;
  const breadthScoreChangeDisplay: string = (() => {
    if (data.breadthScoreChange == null) return "";
    if (Math.abs(data.breadthScoreChange) < BREADTH_SCORE_FLAT_THRESHOLD) return "보합";
    return `${data.breadthScoreChange >= 0 ? "+" : ""}${data.breadthScoreChange.toFixed(1)}`;
  })();
  const breadthScoreChangeCls: string = (() => {
    if (data.breadthScoreChange == null) return "";
    if (Math.abs(data.breadthScoreChange) < BREADTH_SCORE_FLAT_THRESHOLD) return "neutral-color";
    return colorClass(data.breadthScoreChange);
  })();

  const PHASE2_HIGHLIGHT_MULTIPLIER = 1.5;
  const isPhase2EntryHighlighted =
    data.phase1to2Count1d != null &&
    data.phase2EntryAvg5d != null &&
    data.phase2EntryAvg5d > 0 &&
    data.phase1to2Count1d > data.phase2EntryAvg5d * PHASE2_HIGHLIGHT_MULTIPLIER;

  const phase2EntryChip =
    data.phase1to2Count1d != null
      ? (() => {
          const entryValue = escapeHtml(String(data.phase1to2Count1d));
          const highlightCls = isPhase2EntryHighlighted ? " up" : "";
          const subText =
            isPhase2EntryHighlighted && data.phase2EntryAvg5d != null
              ? `<span class="stat-sub up">↑평균 대비 ${escapeHtml((data.phase1to2Count1d / data.phase2EntryAvg5d).toFixed(1))}배</span>`
              : "";
          return `<div class="stat-chip">
              <span class="stat-label">Phase 2 진입</span>
              <span class="stat-value${highlightCls}">${entryValue}건${subText}</span>
            </div>`;
        })()
      : "";

  const phase2ExitChip =
    data.phase2to3Count1d != null
      ? `<div class="stat-chip">
            <span class="stat-label">Phase 2 이탈</span>
            <span class="stat-value">${escapeHtml(String(data.phase2to3Count1d))}건</span>
          </div>`
      : "";

  // Phase 2 비율 chip 내 절대수량 변화 인라인 표시 (스냅샷 차이 = 금일 − 전일 phase2_count)
  const countChangeInline =
    data.phase2CountChange != null
      ? (() => {
          const changeCls = data.phase2CountChange > 0 ? "up" : data.phase2CountChange < 0 ? "down" : "neutral-color";
          const changeStr = `${data.phase2CountChange >= 0 ? "+" : ""}${escapeHtml(String(data.phase2CountChange))}건`;
          return ` / <span class="${changeCls}">${changeStr}</span> <span class="stat-inline-label">(전일 대비)</span>`;
        })()
      : "";

  const statsHtml = `
    <div class="stat-row">
      <div class="stat-chip">
        <span class="stat-label">Phase 2 비율</span>
        <span class="stat-value">${escapeHtml(data.phase2Ratio.toFixed(1))}% <span class="${escapeHtml(p2ChangeCls)}" style="font-size:0.85rem;">(${escapeHtml(p2ChangeStr)})</span> <span class="stat-inline-label">(비중 변화)</span>${countChangeInline}</span>
      </div>
      ${
        breadthScoreStr !== "—"
          ? `<div class="stat-chip">
              <span class="stat-label">Breadth Score</span>
              <span class="stat-value">${escapeHtml(breadthScoreStr)} <span class="stat-inline-label">${escapeHtml(getBreadthScoreLabel(data.breadthScore!))}</span>${
                breadthScoreChangeDisplay !== ""
                  ? ` <span class="${escapeHtml(breadthScoreChangeCls)}" style="font-size:0.85rem;">${escapeHtml(breadthScoreChangeDisplay)}</span>`
                  : ""
              }</span>
            </div>`
          : ""
      }
    </div>
    ${
      phase2EntryChip !== "" || phase2ExitChip !== ""
        ? `<div class="stat-row">${phase2EntryChip}${phase2ExitChip}</div>`
        : ""
    }`;

  const narrativeHtml = renderNarrativeBlock(narrative);

  return `${subtitle}${phaseBar}${statsHtml}${narrativeHtml}`;
}

/**
 * 섹터 RS 랭킹 테이블을 렌더링한다.
 * 4주 RS 변화(change4w)와 순위 변동 포함.
 */
export function renderSectorTable(data: DailySectorItem[]): string {
  if (data.length === 0) {
    return '<div class="empty-state">섹터 데이터 없음</div>';
  }

  const rows = data
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

      const change4wCls = s.change4w != null ? colorClass(s.change4w) : "neutral-color";
      const change4wStr =
        s.change4w != null
          ? `<span class="${escapeHtml(change4wCls)}">${s.change4w >= 0 ? "+" : ""}${s.change4w.toFixed(1)}</span>`
          : "—";

      const p2Str = `${s.phase2Ratio.toFixed(1)}%`;
      const phaseStr =
        s.prevGroupPhase != null && s.prevGroupPhase !== s.groupPhase
          ? `Phase ${escapeHtml(String(s.prevGroupPhase))}→${escapeHtml(String(s.groupPhase))}`
          : `Phase ${escapeHtml(String(s.groupPhase))}`;

      return `
        <tr>
          <td><strong>${escapeHtml(s.sector)}</strong></td>
          <td>${escapeHtml(s.avgRs.toFixed(1))}</td>
          <td>${escapeHtml(String(s.rsRank))}</td>
          <td>${rankChangeStr}</td>
          <td>${change4wStr}</td>
          <td><span class="phase-badge ${escapeHtml(phaseCls)}">${phaseStr}</span></td>
          <td>${escapeHtml(p2Str)}</td>
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
          <th>4주 변화</th>
          <th>Phase</th>
          <th>P2 비율</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * 업종 RS Top 10 테이블을 렌더링한다.
 * changeWeek(전주 대비 RS 변화량) 기준 정렬 결과를 그대로 수용한다.
 */
export function renderIndustryTop10Table(data: DailyIndustryItem[]): string {
  if (data.length === 0) {
    return '<div class="empty-state">업종 데이터 없음</div>';
  }

  const rows = data
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
          <th>4주 변화</th>
          <th>Phase</th>
          <th>P2 비율</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * 특이종목 카드 그리드 + LLM 해석 섹션을 렌더링한다.
 * 일간 고유 섹션. 조건 태그(big_move, high_volume, phase_change)를 시각적으로 표현.
 * phase2WithDrop, splitSuspect 플래그 경고 표시.
 */
export function renderUnusualStocksSection(
  stocks: DailyUnusualStock[],
  narrative: string,
  overflowCount?: number,
): string {
  const narrativeHtml = renderNarrativeBlock(narrative);

  if (stocks.length === 0) {
    return `<div class="empty-state">해당 없음 — 특이종목 없음</div>${narrativeHtml}`;
  }

  const cards = stocks
    .map((s) => {
      const returnCls = colorClass(s.dailyReturn);
      const returnStr = formatPercent(s.dailyReturn);

      const conditionTags = s.conditions
        .map((cond) => {
          const tagMap: Record<typeof cond, { cls: string; label: string }> = {
            big_move: { cls: "cond-tag big-move", label: "급등락" },
            high_volume: { cls: "cond-tag high-volume", label: "거래량 급증" },
            phase_change: { cls: "cond-tag phase-change", label: "Phase 전환" },
          };
          const tag = tagMap[cond];
          return `<span class="${escapeHtml(tag.cls)}">${escapeHtml(tag.label)}</span>`;
        })
        .join("");

      const warningTags = [
        s.phase2WithDrop
          ? `<span class="cond-tag phase2-drop">P2 급락 경고</span>`
          : "",
        s.splitSuspect
          ? `<span class="cond-tag split-suspect">분할 의심</span>`
          : "",
      ]
        .filter(Boolean)
        .join("");

      const prevPhaseStr =
        s.prevPhase != null && s.prevPhase !== s.phase
          ? `Phase ${s.prevPhase} → Phase ${s.phase}`
          : `Phase ${s.phase}`;

      const sectorStr =
        s.industry != null
          ? escapeHtml(s.industry)
          : s.sector != null
            ? escapeHtml(s.sector)
            : "—";

      return `
        <div class="unusual-card">
          <div class="unusual-card-header">
            <span class="unusual-ticker">${escapeHtml(s.symbol)}</span>
            <span class="unusual-meta">${sectorStr}</span>
            <span class="unusual-return ${escapeHtml(returnCls)}">${escapeHtml(returnStr)}</span>
          </div>
          <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:6px;">
            ${escapeHtml(prevPhaseStr)} · RS ${escapeHtml(s.rsScore.toFixed(0))} · 거래량비 ${escapeHtml(s.volRatio.toFixed(1))}x
          </div>
          <div class="unusual-conditions">
            ${conditionTags}
            ${warningTags}
          </div>
        </div>`;
    })
    .join("");

  const overflowHtml =
    overflowCount != null && overflowCount > 0
      ? `<div style="font-size:0.82rem;color:var(--text-muted);text-align:center;margin-top:8px;">(외 ${escapeHtml(String(overflowCount))}건)</div>`
      : "";

  return `<div class="unusual-grid">${cards}</div>${overflowHtml}${narrativeHtml}`;
}

/**
 * RS 상승 초기 종목 테이블 + LLM 해석 섹션을 렌더링한다.
 * 일간 고유 섹션. Phase 1/2에서 RS 가속 상승 중인 종목 관찰 목적.
 */
export function renderRisingRSSection(
  stocks: DailyRisingRSStock[],
  narrative: string,
): string {
  const narrativeHtml = renderNarrativeBlock(narrative);

  if (stocks.length === 0) {
    return "";
  }

  const RISING_RS_SPARSE_THRESHOLD = 3;
  const sparseNoticeHtml =
    stocks.length < RISING_RS_SPARSE_THRESHOLD
      ? `<p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 10px;">(시장 상황에 따라 종목 수가 적을 수 있습니다)</p>`
      : "";

  const rows = stocks
    .map((s) => {
      const phaseCls = phaseBadgeClass(s.phase);
      const rsChangeCls = s.rsChange != null ? colorClass(s.rsChange) : "neutral-color";
      const rsChangeStr =
        s.rsChange != null
          ? `<span class="${escapeHtml(rsChangeCls)}">${s.rsChange >= 0 ? "+" : ""}${s.rsChange.toFixed(1)}</span>`
          : "—";
      const pctFromLowStr =
        s.isExtremePctFromLow || s.pctFromLow52w == null
          ? "—"
          : `<span class="up">+${s.pctFromLow52w.toFixed(0)}%</span>`;
      const industryStr = s.industry != null ? escapeHtml(s.industry) : "—";
      const sepaStr = s.sepaGrade != null ? escapeHtml(s.sepaGrade) : "—";
      const capStr = marketCapLabel(s.marketCap);

      return `
        <tr>
          <td><strong>${escapeHtml(s.symbol)}</strong></td>
          <td><span class="phase-badge ${escapeHtml(phaseCls)}">Phase ${escapeHtml(String(s.phase))}</span></td>
          <td>${escapeHtml(s.rsScore.toFixed(0))}</td>
          <td>${rsChangeStr}</td>
          <td>${sepaStr}</td>
          <td>${escapeHtml(capStr)}</td>
          <td>${industryStr}</td>
          <td>${pctFromLowStr}</td>
        </tr>`;
    })
    .join("");

  const table = `
    <table>
      <thead>
        <tr>
          <th>종목</th>
          <th>Phase</th>
          <th>RS</th>
          <th>RS 4주 변화</th>
          <th>SEPA</th>
          <th>시총</th>
          <th>업종</th>
          <th>52w 저점 대비</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  return `${sparseNoticeHtml}${table}${narrativeHtml}`;
}

/**
 * ACTIVE 관심종목 현황 테이블 + LLM 해석을 렌더링한다.
 * 일간 리포트: 최근 7일 궤적 포함.
 */
export function renderWatchlistSection(
  data: DailyWatchlistData,
  narrative: string,
): string {
  const narrativeHtml = renderNarrativeBlock(narrative);

  if (data.items.length === 0) {
    return `<div class="empty-state">현재 ACTIVE 관심종목 없음</div>${narrativeHtml}`;
  }

  const { summary, items } = data;
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

      // Phase 궤적 도트 (최근 7일)
      const trajDots = item.phaseTrajectory
        .slice(-7)
        .map((t) => {
          const cls = phaseBadgeClass(t.phase);
          return `<div class="traj-dot ${escapeHtml(cls)}" title="${escapeHtml(t.date)}">${escapeHtml(String(t.phase))}</div>`;
        })
        .join("");

      const rsStr =
        item.currentRsScore != null
          ? `RS ${item.currentRsScore.toFixed(0)}`
          : item.entryRsScore != null
            ? `RS ${item.entryRsScore.toFixed(0)} (진입)`
            : "—";

      const p2SegmentBadge = item.phase2Segment != null && item.phase2SinceDays != null
        ? `<span class="p2-segment p2-${escapeHtml(item.phase2Segment)}">${escapeHtml(item.phase2Segment)} ${escapeHtml(String(item.phase2SinceDays))}일</span>`
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
          <th>P2 구간</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>`;

  return `${summaryHtml}${table}${narrativeHtml}`;
}

/**
 * 시장 온도 + 토론 인사이트 섹션을 렌더링한다.
 * 배지 + 판단 근거 텍스트만. 정량 기준 없는 3분할 바는 제거.
 */
// ─── Thesis-Aligned Candidates 섹션 ─────────────────────────────────

const PHASE_2_VALUE = 2;
const RS_HIGHLIGHT_THRESHOLD = 60;

/**
 * 단일 체인 그룹의 후보 테이블을 렌더링한다.
 */
function renderChainGroupCard(group: ThesisAlignedChainGroup): string {
  const statusCls = group.chainStatus === "ACTIVE" ? "up" : "neutral-color";

  if (group.candidates.length === 0) {
    return "";
  }

  const headerHtml = `
    <h3>
      ${escapeHtml(group.megatrend)}
      <span class="phase-badge p2"><span class="${escapeHtml(statusCls)}">${escapeHtml(group.chainStatus)}</span></span>
      <span class="stat-inline-label">${escapeHtml(String(group.daysSinceIdentified))}일 경과</span>
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
      const certTag = c.certified === true
        ? ` <span style="display:inline-block;padding:1px 5px;border-radius:3px;font-size:0.65rem;font-weight:600;background:#ddf6dd;color:#1a7f37;vertical-align:middle;">인증</span>`
        : "";
      return `
        <tr>
          <td><strong>${escapeHtml(c.symbol)}</strong>${aiTag}${certTag}</td>
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

/**
 * Thesis-Aligned Candidates 섹션을 렌더링한다.
 * SEPA S/A 포함 4/4 게이트를 모두 충족한 종목(gatePassCount === gateTotalCount)만 표시한다.
 * 필터 후 표시할 종목이 없으면 빈 문자열을 반환하여 섹션 자체를 미출력한다.
 *
 * 참고: buildThesisAlignedCandidates()는 수정하지 않음 — 주간 리포트에서도 동일 함수를 사용하며,
 * 필터링은 렌더링/저장 단계에서만 적용한다.
 */
export function renderThesisAlignedSection(
  data: ThesisAlignedData | null | undefined,
): string {
  if (data == null || data.chains.length === 0) {
    return "";
  }

  // SEPA S/A(4/4 게이트 충족) 종목만 필터링한 체인 그룹 구성
  const filteredGroups = data.chains.map((group) => ({
    ...group,
    candidates: group.candidates.filter(
      (c) => c.gatePassCount === c.gateTotalCount,
    ),
  }));

  const filteredCandidateCount = filteredGroups.reduce(
    (sum, group) => sum + group.candidates.length,
    0,
  );

  // 필터 후 표시할 종목이 하나도 없으면 섹션 미출력
  if (filteredCandidateCount === 0) {
    return "";
  }

  const filteredPhase2Count = filteredGroups.reduce(
    (sum, group) =>
      sum + group.candidates.filter((c) => c.phase === 2).length,
    0,
  );

  const filteredChainCount = filteredGroups.filter(
    (group) => group.candidates.length > 0,
  ).length;

  const summaryHtml = `
    <div class="stat-row">
      <div class="stat-chip">
        <span class="stat-label">활성 체인</span>
        <span class="stat-value">${escapeHtml(String(filteredChainCount))}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">수혜 후보</span>
        <span class="stat-value">${escapeHtml(String(filteredCandidateCount))}</span>
      </div>
      <div class="stat-chip">
        <span class="stat-label">Phase 2</span>
        <span class="stat-value ${filteredPhase2Count > 0 ? "up" : "neutral-color"}">${escapeHtml(String(filteredPhase2Count))}</span>
      </div>
    </div>`;

  const chainsHtml = filteredGroups
    .map((group) => renderChainGroupCard(group))
    .join("");

  const noteHtml = `<p style="font-size:0.75rem;color:var(--text-muted);margin:12px 0 0;">SEPA S/A 포함 4/4 게이트 충족 종목만 표시 · 업종 탐색은 체인당 RS 상위 10개</p>`;

  return `${summaryHtml}${chainsHtml}${noteHtml}`;
}

// ─── 시장 온도 섹션 ─────────────────────────────────────────────────────────

export function renderInsightSection(insight: DailyReportInsight): string {
  const rationaleHtml = insight.marketTemperatureRationale.trim() !== ""
    ? `<div class="insight-rationale">${mdToHtml(insight.marketTemperatureRationale)}</div>`
    : "";

  const todayInsightHtml =
    insight.todayInsight !== "해당 없음" && insight.todayInsight.trim() !== ""
      ? `
        <h3>오늘의 인사이트</h3>
        <div class="content-block">${mdToHtml(insight.todayInsight)}</div>`
      : "";

  return `
    <div class="insight-card">
      ${rationaleHtml}
    </div>
    ${todayInsightHtml}`;
}

// ─── 최종 HTML 조립 ───────────────────────────────────────────────────────────

/**
 * 일간 리포트 전체 HTML을 조립한다.
 * 데이터 블록은 프로그래밍 렌더링, 해석 블록은 marked 마크다운→HTML 변환.
 * 셀프 컨테인드 — 외부 CSS/JS 의존 없음.
 *
 * @param data - 도구 반환값에서 직접 추출한 구조화 데이터
 * @param insight - LLM이 작성한 해석 텍스트
 * @param date - 리포트 기준일 (YYYY-MM-DD)
 */
export function buildDailyHtml(
  data: DailyReportData,
  insight: DailyReportInsight,
  date: string,
): string {
  const temperatureCls = escapeHtml(insight.marketTemperature);
  const temperatureLabel = escapeHtml(insight.marketTemperatureLabel);

  // 날짜 포맷 — new Date("YYYY-MM-DD")는 UTC 자정 파싱으로 KST에서 하루 밀림.
  // 문자열에서 직접 파싱한다. 연도(index 0)는 타이틀에만 사용하지 않으므로 무시.
  const dateParts = date.split("-");
  const month = Number(dateParts[1]);
  const day = Number(dateParts[2]);
  const dateLabel = `${escapeHtml(String(month))}월 ${escapeHtml(String(day))}일`;

  // 데이터 블록 렌더링
  const indexTableHtml = renderIndexTable(data.indexReturns, data.fearGreed);
  const marketPositionHtml = renderMarketPositionGates(data.marketPosition);
  const phaseDistributionHtml = renderPhaseDistribution(data.marketBreadth, insight.breadthNarrative);
  const sectorTableHtml = renderSectorTable(data.sectorRanking);
  const industryTop10Html = renderIndustryTop10Table(data.industryTop10);
  const sortedUnusualStocks = sortUnusualStocks(data.unusualStocks);
  const truncatedUnusualStocks = sortedUnusualStocks.slice(0, MAX_UNUSUAL_STOCKS);
  const unusualOverflowCount = data.unusualStocks.length - truncatedUnusualStocks.length;
  const unusualStocksHtml = renderUnusualStocksSection(
    truncatedUnusualStocks,
    insight.unusualStocksNarrative,
    unusualOverflowCount,
  );
  const risingRSHtml = renderRisingRSSection(
    data.risingRS,
    insight.risingRSNarrative,
  );
  const watchlistHtml = renderWatchlistSection(
    data.watchlist,
    insight.watchlistNarrative,
  );
  const thesisAlignedHtml = renderThesisAlignedSection(data.thesisAlignedCandidates);
  const insightHtml = renderInsightSection(insight);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>일간 시장 분석 (${dateLabel}) — ${escapeHtml(date)}</title>
  <style>${DAILY_REPORT_CSS}</style>
</head>
<body>
  <div class="container">
    <header class="report-header">
      <h1>일간 시장 분석 <span class="temp-badge ${temperatureCls}">${temperatureLabel}</span></h1>
      <div class="report-date">${escapeHtml(date)} · Market Analyst</div>
    </header>

    <div class="report-body">
      <!-- 섹션 1: 시장 온도 -->
      <section>
        <h2>시장 온도</h2>
        ${insightHtml}
      </section>

      <!-- 섹션 2: 지수 현황 -->
      <section>
        <h2>지수 현황</h2>
        ${indexTableHtml}
      </section>

      <!-- 섹션 3: 시장 브레드스 -->
      <section>
        <h2>시장 브레드스</h2>
        ${marketPositionHtml}
        ${phaseDistributionHtml}
      </section>

      <!-- 섹션 4: 섹터 RS 랭킹 -->
      <section>
        <h2>섹터 RS 랭킹</h2>
        ${sectorTableHtml}
      </section>

      <!-- 섹션 5: 업종 RS Top 10 -->
      <section>
        <h2>업종 RS Top 10</h2>
        <p style="font-size:0.82rem;color:var(--text-muted);margin:0 0 10px;">(절대 RS 상위, 섹터당 최대 2개)</p>
        ${industryTop10Html}
      </section>

      <!-- 섹션 6: 특이종목 -->
      <section>
        <h2>특이종목</h2>
        ${unusualStocksHtml}
      </section>

      <!-- 섹션 7: RS 상승 초기 종목 (종목 없으면 섹션 미출력) -->
      ${risingRSHtml !== "" ? `
      <section>
        <h2>RS 상승 초기 종목</h2>
        ${risingRSHtml}
      </section>` : ""}

      <!-- 섹션 8: 서사 수혜주 (데이터 없으면 섹션 미출력) -->
      ${thesisAlignedHtml !== "" ? `
      <section>
        <h2>서사 수혜주</h2>
        ${thesisAlignedHtml}
      </section>` : ""}

      <!-- 섹션 9: 관심종목 현황 -->
      <section>
        <h2>관심종목 현황</h2>
        ${watchlistHtml}
      </section>
    </div>

    <footer class="report-footer">
      Generated by Market Analyst · ${escapeHtml(date)}
    </footer>
  </div>
</body>
</html>`;
}
