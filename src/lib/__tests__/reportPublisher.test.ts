import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { publishHtmlReport } from "../reportPublisher.js";

// execFile mock
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// fs mock
const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockRmSync = vi.fn();
vi.mock("node:fs", () => ({
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  rmSync: (...args: unknown[]) => mockRmSync(...args),
}));

function simulateGitSuccess() {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      // git status --porcelain → 변경 있음
      if (_args.includes("status")) {
        cb(null, "M daily/2026-04-02/index.html\n", "");
      } else {
        cb(null, "", "");
      }
    },
  );
}

function simulateGitPushFailure() {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      if (_args.includes("push")) {
        cb(new Error("push failed"), "", "Authentication failed");
      } else if (_args.includes("status")) {
        cb(null, "M file\n", "");
      } else {
        cb(null, "", "");
      }
    },
  );
}

describe("publishHtmlReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GITHUB_TOKEN;
  });

  it("잘못된 날짜 형식이면 null을 반환한다", async () => {
    const result = await publishHtmlReport("<html></html>", "../etc/passwd");
    expect(result).toBeNull();
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("YYYY-MM-DD 형식만 허용한다", async () => {
    const result = await publishHtmlReport("<html></html>", "2026/04/02");
    expect(result).toBeNull();
  });

  it("성공 시 GitHub Pages URL을 반환한다", async () => {
    simulateGitSuccess();
    const result = await publishHtmlReport("<html>report</html>", "2026-04-02");

    expect(result).toBe("https://sossost.github.io/market-reports/daily/2026-04-02/");
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("index.html"),
      "<html>report</html>",
      "utf-8",
    );
  });

  it("type 기본값은 daily이다", async () => {
    simulateGitSuccess();
    const result = await publishHtmlReport("<html></html>", "2026-04-02");

    expect(result).toBe("https://sossost.github.io/market-reports/daily/2026-04-02/");
  });

  it('type "weekly" 시 weekly/{date}/ 경로로 파일을 저장하고 weekly URL을 반환한다', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        if (_args.includes("status")) {
          cb(null, "M weekly/2026-04-02/index.html\n", "");
        } else {
          cb(null, "", "");
        }
      },
    );

    const result = await publishHtmlReport("<html>weekly</html>", "2026-04-02", "weekly");

    expect(result).toBe("https://sossost.github.io/market-reports/weekly/2026-04-02/");
    // mkdirSync에 weekly 경로가 포함되어야 함
    expect(mockMkdirSync).toHaveBeenCalledWith(
      expect.stringContaining("weekly"),
      { recursive: true },
    );
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining("index.html"),
      "<html>weekly</html>",
      "utf-8",
    );
  });

  it('type "weekly" 변경 없으면 push 건너뛰고 weekly URL을 반환한다', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        if (_args.includes("status")) {
          cb(null, "", "");
        } else {
          cb(null, "", "");
        }
      },
    );

    const result = await publishHtmlReport("<html></html>", "2026-04-02", "weekly");

    expect(result).toBe("https://sossost.github.io/market-reports/weekly/2026-04-02/");
  });

  it("git push 실패 시 null을 반환한다 (throw 안 함)", async () => {
    simulateGitPushFailure();
    const result = await publishHtmlReport("<html>report</html>", "2026-04-02");

    expect(result).toBeNull();
  });

  it("GITHUB_TOKEN이 있으면 인증 URL을 사용한다", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";
    simulateGitSuccess();

    await publishHtmlReport("<html></html>", "2026-04-02");

    // clone 호출에서 토큰 포함 URL 확인
    const cloneCall = mockExecFile.mock.calls.find(
      (call: unknown[]) => (call[1] as string[]).includes("clone"),
    );
    expect(cloneCall).toBeDefined();
    expect((cloneCall![1] as string[]).some((arg: string) => arg.includes("ghp_test123"))).toBe(true);
  });

  it("GITHUB_TOKEN이 없으면 일반 URL을 사용한다", async () => {
    simulateGitSuccess();

    await publishHtmlReport("<html></html>", "2026-04-02");

    const cloneCall = mockExecFile.mock.calls.find(
      (call: unknown[]) => (call[1] as string[]).includes("clone"),
    );
    expect((cloneCall![1] as string[]).some((arg: string) => arg.includes("x-access-token"))).toBe(false);
  });

  it("변경 없으면 push 건너뛰고 URL을 반환한다", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        if (_args.includes("status")) {
          cb(null, "", ""); // 빈 상태 = 변경 없음
        } else {
          cb(null, "", "");
        }
      },
    );

    const result = await publishHtmlReport("<html></html>", "2026-04-02");

    expect(result).toBe("https://sossost.github.io/market-reports/daily/2026-04-02/");
    // push가 호출되지 않아야 함
    const pushCall = mockExecFile.mock.calls.find(
      (call: unknown[]) => (call[1] as string[]).includes("push"),
    );
    expect(pushCall).toBeUndefined();
  });

  it("commit에 user.name과 user.email이 설정된다", async () => {
    simulateGitSuccess();
    await publishHtmlReport("<html></html>", "2026-04-02");

    const commitCall = mockExecFile.mock.calls.find(
      (call: unknown[]) => (call[1] as string[]).includes("commit"),
    );
    expect(commitCall).toBeDefined();
    const args = commitCall![1] as string[];
    expect(args).toContain("user.name=Market Analyst Bot");
    expect(args).toContain("user.email=bot@noreply.github.com");
  });

  it("finally에서 workDir을 정리한다", async () => {
    simulateGitSuccess();
    await publishHtmlReport("<html></html>", "2026-04-02");

    expect(mockRmSync).toHaveBeenCalledWith(
      expect.stringContaining("market-reports-"),
      { recursive: true, force: true },
    );
  });
});
