import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(""),
}));

import { readdir, readFile } from "node:fs/promises";
import { getLatestFundamentalReports } from "../../src/scripts/get-latest-fundamental-report.js";

const mockReaddir = vi.mocked(readdir);
const mockReadFile = vi.mocked(readFile);

beforeEach(() => {
  mockReaddir.mockReset().mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
  mockReadFile.mockReset();
});

describe("getLatestFundamentalReports", () => {
  it("유효하지 않은 날짜 포맷이면 에러를 throw한다", async () => {
    await expect(getLatestFundamentalReports("2026/03/11")).rejects.toThrow(
      "유효하지 않은 날짜 포맷: 2026/03/11",
    );
    await expect(getLatestFundamentalReports("not-a-date")).rejects.toThrow(
      "유효하지 않은 날짜 포맷",
    );
    await expect(getLatestFundamentalReports("")).rejects.toThrow(
      "유효하지 않은 날짜 포맷",
    );
  });

  it("디렉토리가 없으면 null을 반환한다", async () => {
    const error = new Error("ENOENT") as NodeJS.ErrnoException;
    error.code = "ENOENT";
    mockReaddir.mockRejectedValue(error);

    const result = await getLatestFundamentalReports("2026-03-11");

    expect(result).toBeNull();
  });

  it("해당 날짜 파일이 없으면 null을 반환한다", async () => {
    mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);

    const result = await getLatestFundamentalReports("2026-03-11");

    expect(result).toBeNull();
  });

  it("해당 날짜 파일이 있으면 reports 배열로 반환한다", async () => {
    mockReaddir.mockResolvedValue([
      "AAPL-2026-03-11.md",
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockReadFile.mockResolvedValue("# AAPL 펀더멘탈 리포트");

    const result = await getLatestFundamentalReports("2026-03-11");

    expect(result).toEqual({
      reports: [
        {
          symbol: "AAPL",
          date: "2026-03-11",
          content: "# AAPL 펀더멘탈 리포트",
        },
      ],
    });
  });

  it("여러 종목 파일이 있으면 심볼 알파벳순으로 정렬한다", async () => {
    mockReaddir.mockResolvedValue([
      "TSLA-2026-03-11.md",
      "AAPL-2026-03-11.md",
      "MSFT-2026-03-11.md",
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockReadFile.mockImplementation(async (path) => {
      const p = String(path);
      if (p.includes("TSLA")) return "TSLA report";
      if (p.includes("AAPL")) return "AAPL report";
      if (p.includes("MSFT")) return "MSFT report";
      return "";
    });

    const result = await getLatestFundamentalReports("2026-03-11");

    expect(result).not.toBeNull();
    const symbols = result!.reports.map((r) => r.symbol);
    expect(symbols).toEqual(["AAPL", "MSFT", "TSLA"]);
  });

  it("다른 날짜 파일은 무시한다", async () => {
    mockReaddir.mockResolvedValue([
      "AAPL-2026-03-10.md",
      "MSFT-2026-03-11.md",
      "NVDA-2026-03-12.md",
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockReadFile.mockResolvedValue("report content");

    const result = await getLatestFundamentalReports("2026-03-11");

    expect(result).not.toBeNull();
    expect(result!.reports).toHaveLength(1);
    expect(result!.reports[0].symbol).toBe("MSFT");
  });

  it("잘못된 파일명 패턴은 무시한다", async () => {
    mockReaddir.mockResolvedValue([
      "README.md",
      "aapl-2026-03-11.md",
      ".DS_Store",
      "AAPL-2026-03-11.md",
      "NVDA-2026-03-11.txt",
      "report-2026-03-11.md",
    ] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockReadFile.mockResolvedValue("valid report");

    const result = await getLatestFundamentalReports("2026-03-11");

    expect(result).not.toBeNull();
    expect(result!.reports).toHaveLength(1);
    expect(result!.reports[0].symbol).toBe("AAPL");
  });
});
