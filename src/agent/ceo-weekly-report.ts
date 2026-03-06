/**
 * CEO 주간 시스템 리포트 생성.
 * 순수 로직 — DB 의존 없이 테스트 가능.
 */

import type { AgentStats } from "@/lib/agent-performance";
import type { SignalStats } from "@/lib/signal-performance-stats";

// ── Types ──

export interface ParamChangeRow {
  paramName: string;
  currentValue: string;
  previousValue: string | null;
  changeReason: string | null;
  changedAt: Date;
}

export interface CeoReportData {
  agentStats: AgentStats[];
  signalStats: SignalStats;
  paramChanges: ParamChangeRow[];
  weekStart: string;
  weekEnd: string;
}

// ── Pure Functions ──

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

function formatReturn(value: number | null): string {
  if (value == null) return "-";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function buildSignalSection(stats: SignalStats): string {
  const lines: string[] = [];
  lines.push("## 시그널 성과");

  if (stats.total === 0) {
    lines.push("- 기록된 시그널 없음");
    return lines.join("\n");
  }

  lines.push(`- 활성: ${stats.active}건, 종료: ${stats.closed}건`);

  if (stats.winRate20d != null) {
    lines.push(
      `- 20일 승률: ${formatRate(stats.winRate20d)}, 평균 수익률: ${formatReturn(stats.avgReturn20d)}`,
    );
  } else {
    lines.push("- 20일 수익률 데이터 부족");
  }

  if (stats.phaseExitWinRate != null) {
    lines.push(`- Phase 종료 승률: ${formatRate(stats.phaseExitWinRate)}`);
  }

  return lines.join("\n");
}

function buildAgentSection(agentStats: AgentStats[]): string {
  const lines: string[] = [];
  lines.push("## 장관 성과");

  if (agentStats.length === 0) {
    lines.push("- 집계 대상 thesis 없음");
    return lines.join("\n");
  }

  lines.push("| 장관 | 전체 | 적중 | 실패 | 적중률 |");
  lines.push("|------|------|------|------|--------|");

  for (const stat of agentStats) {
    lines.push(
      `| ${stat.persona} | ${stat.total} | ${stat.confirmed} | ${stat.invalidated} | ${formatRate(stat.hitRate)} |`,
    );
  }

  const withResolved = agentStats.filter(
    (s) => s.confirmed + s.invalidated > 0,
  );

  if (withResolved.length > 0) {
    const best = withResolved.reduce((a, b) =>
      a.hitRate > b.hitRate ? a : b,
    );
    const worst = withResolved.reduce((a, b) =>
      a.hitRate < b.hitRate ? a : b,
    );

    lines.push("");
    lines.push(`최우수: ${best.persona} (${formatRate(best.hitRate)})`);
    if (best.persona !== worst.persona) {
      lines.push(`최저: ${worst.persona} (${formatRate(worst.hitRate)})`);
    }
  }

  return lines.join("\n");
}

function buildParamSection(paramChanges: ParamChangeRow[]): string {
  const lines: string[] = [];
  lines.push("## 시스템 조정 내역");

  if (paramChanges.length === 0) {
    lines.push("- 이번 주 자동 조정 없음");
    return lines.join("\n");
  }

  for (const change of paramChanges) {
    const prev = change.previousValue ?? "(없음)";
    const reason = change.changeReason ?? "";
    lines.push(
      `- ${change.paramName}: ${prev} -> ${change.currentValue}${reason !== "" ? ` (${reason})` : ""}`,
    );
  }

  return lines.join("\n");
}

function buildChiefJudgmentSection(
  signalStats: SignalStats,
  agentStats: AgentStats[],
): string {
  const lines: string[] = [];
  lines.push("## 비서실장 판단");

  // 시그널 품질 추세
  if (signalStats.total === 0) {
    lines.push("- 시그널 데이터 부족 — 아직 판단 불가");
  } else if (signalStats.winRate20d != null && signalStats.winRate20d >= 0.6) {
    lines.push("- 시그널 품질 양호 (20일 승률 60% 이상)");
  } else if (signalStats.winRate20d != null && signalStats.winRate20d < 0.4) {
    lines.push("- 시그널 품질 저조 — 파라미터 재검토 필요");
  } else {
    lines.push("- 시그널 품질 보통 — 지속 모니터링");
  }

  // 장관 성과 추세
  const withResolved = agentStats.filter(
    (s) => s.confirmed + s.invalidated > 0,
  );

  if (withResolved.length === 0) {
    lines.push("- 장관 성과 데이터 부족 — 검증 완료 thesis 누적 필요");
  } else {
    const avgHitRate =
      withResolved.reduce((sum, s) => sum + s.hitRate, 0) / withResolved.length;

    if (avgHitRate >= 0.6) {
      lines.push(`- 장관 평균 적중률 ${formatRate(avgHitRate)} — 양호`);
    } else if (avgHitRate < 0.4) {
      lines.push(
        `- 장관 평균 적중률 ${formatRate(avgHitRate)} — 프롬프트 개선 검토 필요`,
      );
    } else {
      lines.push(`- 장관 평균 적중률 ${formatRate(avgHitRate)} — 보통`);
    }
  }

  return lines.join("\n");
}

/**
 * CEO 주간 리포트 텍스트 생성.
 */
export function buildCeoWeeklyReport(data: CeoReportData): string {
  const sections: string[] = [];

  sections.push(
    `CEO 주간 시스템 리포트 (${data.weekStart} ~ ${data.weekEnd})`,
  );
  sections.push("");
  sections.push(buildSignalSection(data.signalStats));
  sections.push("");
  sections.push(buildAgentSection(data.agentStats));
  sections.push("");
  sections.push(buildParamSection(data.paramChanges));
  sections.push("");
  sections.push(
    buildChiefJudgmentSection(data.signalStats, data.agentStats),
  );

  return sections.join("\n");
}
