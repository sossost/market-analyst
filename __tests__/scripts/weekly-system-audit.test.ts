import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── mocks (vi.hoisted로 호이스팅) ──────────────────────────

const { mockQuery, mockExecSync, mockExecFileSync, mockReadFileSync } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockExecSync: vi.fn(),
  mockExecFileSync: vi.fn(),
  mockReadFileSync: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  pool: { query: mockQuery, end: vi.fn() },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("node:child_process", () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

vi.mock("node:fs", () => ({
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
}));

import {
  checkDataIntegrity,
  checkCodeDbConsistency,
  checkPipelineConnectivity,
  checkTestBuild,
  createGitHubIssues,
  getOpenAuditIssues,
  runAudit,
  type AuditFinding,
} from "@/scripts/weekly-system-audit";

// ─── setup ──────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── 1. checkDataIntegrity ──────────────────────────────────

describe("checkDataIntegrity", () => {
  it("returns empty when all checks pass", async () => {
    // 주말 레코드 0건
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    // null trajectory 0건
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    // bottleneck 오염 0건
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    // stale 점수 — 오늘 날짜
    mockQuery.mockResolvedValueOnce({ rows: [{ latest_date: new Date().toISOString().slice(0, 10) }] });

    const findings = await checkDataIntegrity();
    expect(findings).toHaveLength(0);
  });

  it("detects weekend records in daily_prices", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "42" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ latest_date: new Date().toISOString().slice(0, 10) }] });

    const findings = await checkDataIntegrity();
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe("data-integrity");
    expect(findings[0].severity).toBe("HIGH");
    expect(findings[0].title).toContain("주말");
  });

  it("detects null trajectory in ACTIVE tracked_stocks", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "5" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ latest_date: new Date().toISOString().slice(0, 10) }] });

    const findings = await checkDataIntegrity();
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("null");
  });

  it("detects narrative_chains megatrend=bottleneck pollution", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "3" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ latest_date: new Date().toISOString().slice(0, 10) }] });

    const findings = await checkDataIntegrity();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("MEDIUM");
    expect(findings[0].title).toContain("오염");
  });

  it("detects stale fundamental_scores", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    // 30일 전 날짜
    const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockQuery.mockResolvedValueOnce({ rows: [{ latest_date: staleDate }] });

    const findings = await checkDataIntegrity();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("HIGH");
    expect(findings[0].title).toContain("stale");
  });

  it("detects empty fundamental_scores table", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ latest_date: null }] });

    const findings = await checkDataIntegrity();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("CRITICAL");
    expect(findings[0].title).toContain("비어 있음");
  });

  it("handles multiple findings simultaneously", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "10" }] }); // 주말
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "3" }] });  // null trajectory
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "2" }] });  // 오염
    const staleDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockQuery.mockResolvedValueOnce({ rows: [{ latest_date: staleDate }] });

    const findings = await checkDataIntegrity();
    expect(findings).toHaveLength(4);
  });
});

// ─── 2. checkCodeDbConsistency ──────────────────────────────

describe("checkCodeDbConsistency", () => {
  it("returns empty when Shell Companies filter exists and no deprecated refs", () => {
    // readFileSync: stockPhaseRepository.ts — NOT_SHELL 상수가 쿼리에서 사용되는지 확인
    mockReadFileSync.mockReturnValueOnce("WHERE status = 'ACTIVE' AND ${NOT_SHELL}");
    // readFileSync: strategic-review-prompt.md
    mockReadFileSync.mockReturnValueOnce("FROM tracked_stocks WHERE status = 'ACTIVE'");
    // execFileSync: grep for deprecated tables
    mockExecFileSync.mockReturnValueOnce(Buffer.from(""));

    const findings = checkCodeDbConsistency();
    expect(findings).toHaveLength(0);
  });

  it("detects missing Shell Companies filter", () => {
    mockReadFileSync.mockReturnValueOnce("SELECT * FROM some_table");
    mockReadFileSync.mockReturnValueOnce("FROM tracked_stocks");
    mockExecFileSync.mockReturnValueOnce(Buffer.from(""));

    const findings = checkCodeDbConsistency();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("CRITICAL");
    expect(findings[0].title).toContain("Shell Companies");
  });

  it("detects deprecated table reference in prompt", () => {
    mockReadFileSync.mockReturnValueOnce("WHERE status = 'ACTIVE' AND ${NOT_SHELL}");
    mockReadFileSync.mockReturnValueOnce("FROM recommendations WHERE status = 'ACTIVE'");
    mockExecFileSync.mockReturnValueOnce(Buffer.from(""));

    const findings = checkCodeDbConsistency();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("HIGH");
    expect(findings[0].title).toContain("deprecated");
  });

  it("detects deprecated table refs in src code", () => {
    mockReadFileSync.mockReturnValueOnce("WHERE status = 'ACTIVE' AND ${NOT_SHELL}");
    mockReadFileSync.mockReturnValueOnce("FROM tracked_stocks");
    mockExecFileSync.mockReturnValueOnce(Buffer.from("src/some-file.ts\nsrc/other.ts"));

    const findings = checkCodeDbConsistency();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("MEDIUM");
    expect(findings[0].title).toContain("deprecated");
  });

  it("handles file read errors gracefully", () => {
    mockReadFileSync.mockImplementation(() => { throw new Error("ENOENT"); });
    mockExecFileSync.mockReturnValueOnce(Buffer.from(""));

    // Shell Companies filter 체크 — 파일 읽기 실패 시 false → CRITICAL finding
    const findings = checkCodeDbConsistency();
    expect(findings.some((f) => f.severity === "CRITICAL")).toBe(true);
  });
});

// ─── 3. checkPipelineConnectivity ───────────────────────────

describe("checkPipelineConnectivity", () => {
  it("returns empty when all pipelines connected", async () => {
    // thesis_aligned count
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "5" }] });
    // empty reports
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    // failure_patterns
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "10" }] });
    // readFileSync for scan-thesis-aligned-candidates.ts
    mockReadFileSync.mockReturnValueOnce("thesis_aligned");

    const findings = await checkPipelineConnectivity();
    expect(findings).toHaveLength(0);
  });

  it("detects thesis_aligned with 0 stocks when scanner exists", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "10" }] });
    mockReadFileSync.mockReturnValueOnce("thesis_aligned");

    const findings = await checkPipelineConnectivity();
    // thesis_aligned 0건 + empty reports
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.some((f) => f.title.includes("thesis_aligned"))).toBe(true);
  });

  it("detects empty reported_symbols in recent daily reports", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "5" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "3" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "10" }] });
    mockReadFileSync.mockReturnValueOnce("thesis_aligned");

    const findings = await checkPipelineConnectivity();
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("reported_symbols");
  });

  it("detects missing failure_patterns", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "5" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockQuery.mockResolvedValueOnce({ rows: [{ cnt: "0" }] });
    mockReadFileSync.mockReturnValueOnce("thesis_aligned");

    const findings = await checkPipelineConnectivity();
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("failure_patterns");
  });
});

// ─── 4. checkTestBuild ──────────────────────────────────────

describe("checkTestBuild", () => {
  it("returns empty when tsc and vitest both pass", () => {
    mockExecSync
      .mockReturnValueOnce(Buffer.from(""))   // tsc --noEmit
      .mockReturnValueOnce(Buffer.from(""));  // vitest run

    const findings = checkTestBuild();
    expect(findings).toHaveLength(0);
  });

  it("detects TypeScript errors", () => {
    mockExecSync.mockImplementationOnce(() => {
      const err = new Error("tsc failed") as Error & { stderr: Buffer };
      err.stderr = Buffer.from("error TS2304: Cannot find name 'foo'\nerror TS2322: Type mismatch");
      throw err;
    });
    mockExecSync.mockReturnValueOnce(Buffer.from(""));

    const findings = checkTestBuild();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("HIGH");
    expect(findings[0].title).toContain("TypeScript");
  });

  it("detects test failures", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("")); // tsc ok
    mockExecSync.mockImplementationOnce(() => {
      const err = new Error("vitest failed") as Error & { stdout: Buffer };
      err.stdout = Buffer.from(JSON.stringify({ numFailedTests: 3 }));
      throw err;
    });

    const findings = checkTestBuild();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("CRITICAL");
    expect(findings[0].title).toContain("테스트");
  });

  it("handles vitest runner crash", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("")); // tsc ok
    mockExecSync.mockImplementationOnce(() => {
      const err = new Error("crash") as Error & { stdout: Buffer };
      err.stdout = Buffer.from("not json");
      throw err;
    });

    const findings = checkTestBuild();
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toContain("vitest 실행 자체가 실패");
  });
});

// ─── 5. getOpenAuditIssues ──────────────────────────────────

describe("getOpenAuditIssues", () => {
  it("returns parsed issue titles", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("[system-audit] foo\n[system-audit] bar"));
    const titles = getOpenAuditIssues();
    expect(titles).toEqual(["[system-audit] foo", "[system-audit] bar"]);
  });

  it("returns empty array on empty output", () => {
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    const titles = getOpenAuditIssues();
    expect(titles).toEqual([]);
  });

  it("returns empty array on error", () => {
    mockExecSync.mockImplementationOnce(() => { throw new Error("gh not found"); });
    const titles = getOpenAuditIssues();
    expect(titles).toEqual([]);
  });
});

// ─── 6. createGitHubIssues ──────────────────────────────────

describe("createGitHubIssues", () => {
  it("creates issues for findings not already open", async () => {
    // getOpenAuditIssues — no existing
    mockExecSync.mockReturnValueOnce(Buffer.from(""));
    // gh issue create
    mockExecSync.mockReturnValueOnce(Buffer.from("https://github.com/owner/repo/issues/100"));

    const findings: AuditFinding[] = [{
      category: "data-integrity",
      severity: "HIGH",
      title: "테스트 이슈",
      detail: "상세 설명",
    }];

    const urls = await createGitHubIssues(findings);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("issues/100");
  });

  it("skips duplicate issues", async () => {
    // getOpenAuditIssues — has existing
    mockExecSync.mockReturnValueOnce(Buffer.from("[system-audit] 테스트 이슈"));

    const findings: AuditFinding[] = [{
      category: "data-integrity",
      severity: "HIGH",
      title: "테스트 이슈",
      detail: "상세 설명",
    }];

    const urls = await createGitHubIssues(findings);
    expect(urls).toHaveLength(0);
  });

  it("limits to MAX_ISSUES_PER_RUN", async () => {
    mockExecSync.mockReturnValueOnce(Buffer.from("")); // no existing
    // 6개 gh issue create 호출에 대해
    for (let i = 0; i < 6; i++) {
      mockExecSync.mockReturnValueOnce(Buffer.from(`https://github.com/issues/${i}`));
    }

    const findings: AuditFinding[] = Array.from({ length: 6 }, (_, i) => ({
      category: "data-integrity" as const,
      severity: "HIGH" as const,
      title: `이슈 ${i}`,
      detail: "상세",
    }));

    const urls = await createGitHubIssues(findings);
    expect(urls).toHaveLength(5); // MAX_ISSUES_PER_RUN = 5
  });

  it("sorts by severity (CRITICAL first)", async () => {
    const createdTitles: string[] = [];
    mockExecSync.mockImplementation((_cmd: string, opts?: { env?: Record<string, string> }) => {
      const cmd = _cmd as string;
      // getOpenAuditIssues call
      if (cmd.includes("gh issue list")) {
        return Buffer.from("");
      }
      // gh issue create calls — title is passed via env var
      if (cmd.includes("gh issue create") && opts?.env?.ISSUE_TITLE != null) {
        createdTitles.push(opts.env.ISSUE_TITLE);
      }
      return Buffer.from("https://github.com/issues/1");
    });

    const findings: AuditFinding[] = [
      { category: "data-integrity", severity: "LOW", title: "Low issue", detail: "" },
      { category: "data-integrity", severity: "CRITICAL", title: "Critical issue", detail: "" },
      { category: "data-integrity", severity: "HIGH", title: "High issue", detail: "" },
    ];

    await createGitHubIssues(findings);
    expect(createdTitles[0]).toContain("Critical issue");
    expect(createdTitles[1]).toContain("High issue");
    expect(createdTitles[2]).toContain("Low issue");
  });
});

// ─── 7. runAudit (통합) ─────────────────────────────────────

describe("runAudit", () => {
  /** SQL 패턴 매칭 기반 mock — Promise.all 순서에 무관 */
  function setupQueryMock(overrides: Record<string, { rows: unknown[] }> = {}) {
    const today = new Date().toISOString().slice(0, 10);
    const defaults: Record<string, { rows: unknown[] }> = {
      weekend: { rows: [{ cnt: "0" }] },
      null_trajectory: { rows: [{ cnt: "0" }] },
      bottleneck: { rows: [{ cnt: "0" }] },
      stale: { rows: [{ latest_date: today }] },
      thesis: { rows: [{ cnt: "5" }] },
      empty_reports: { rows: [{ cnt: "0" }] },
      failure: { rows: [{ cnt: "10" }] },
      ...overrides,
    };

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("DOW")) return Promise.resolve(defaults.weekend);
      if (sql.includes("phase_trajectory")) return Promise.resolve(defaults.null_trajectory);
      if (sql.includes("bottleneck_node")) return Promise.resolve(defaults.bottleneck);
      if (sql.includes("MAX(scored_date)")) return Promise.resolve(defaults.stale);
      if (sql.includes("thesis_aligned")) return Promise.resolve(defaults.thesis);
      if (sql.includes("daily_reports")) return Promise.resolve(defaults.empty_reports);
      if (sql.includes("failure_patterns")) return Promise.resolve(defaults.failure);
      return Promise.resolve({ rows: [{ cnt: "0" }] });
    });
  }

  it("aggregates findings from all checks and returns summary", async () => {
    setupQueryMock();

    // readFileSync: Shell Companies filter + prompt + thesis scan file
    mockReadFileSync.mockImplementation((filePath: string) => {
      if (typeof filePath === "string" && filePath.includes("stockPhaseRepository")) return "WHERE status = 'ACTIVE' AND ${NOT_SHELL}";
      if (typeof filePath === "string" && filePath.includes("strategic-review-prompt")) return "FROM tracked_stocks";
      if (typeof filePath === "string" && filePath.includes("scan-thesis-aligned")) return "thesis_aligned";
      throw new Error("ENOENT");
    });

    // execFileSync: grep (no deprecated refs)
    mockExecFileSync.mockReturnValue(Buffer.from(""));
    // execSync: tsc + vitest
    mockExecSync.mockReturnValue(Buffer.from(""));

    const result = await runAudit();
    expect(result.summary.total).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("creates issues when findings exist", async () => {
    // 주말 레코드 있음
    setupQueryMock({ weekend: { rows: [{ cnt: "5" }] } });

    mockReadFileSync.mockImplementation((filePath: string) => {
      if (typeof filePath === "string" && filePath.includes("stockPhaseRepository")) return "WHERE status = 'ACTIVE' AND ${NOT_SHELL}";
      if (typeof filePath === "string" && filePath.includes("strategic-review-prompt")) return "FROM tracked_stocks";
      if (typeof filePath === "string" && filePath.includes("scan-thesis-aligned")) return "thesis_aligned";
      throw new Error("ENOENT");
    });

    mockExecFileSync.mockReturnValue(Buffer.from(""));
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh issue list")) return Buffer.from("");
      if (typeof cmd === "string" && cmd.includes("gh issue create")) return Buffer.from("https://github.com/issues/1");
      return Buffer.from("");
    });

    const result = await runAudit();
    expect(result.summary.total).toBe(1);
    expect(result.summary.high).toBe(1);
  });
});
