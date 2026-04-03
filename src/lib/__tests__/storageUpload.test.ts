/**
 * storageUpload.test.ts — Supabase Storage 업로드 유틸리티 단위 테스트
 *
 * 외부 의존성(Supabase 클라이언트)은 전부 mock으로 처리한다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// @supabase/supabase-js를 모킹한다.
// 테스트별로 upload/getPublicUrl의 반환값을 제어한다.
const mockUpload = vi.fn();
const mockGetPublicUrl = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    storage: {
      from: vi.fn(() => ({
        upload: mockUpload,
        getPublicUrl: mockGetPublicUrl,
      })),
    },
  })),
}));

// 모킹 이후에 import해야 한다.
import {
  uploadHtmlReport,
  buildStoragePath,
  _resetStorageClientForTest,
} from "../storageUpload.js";

// ─── buildStoragePath ─────────────────────────────────────────────────────────

describe("buildStoragePath", () => {
  it("날짜와 파일명으로 올바른 경로를 생성한다", () => {
    expect(buildStoragePath("2026-04-02", "report-2026-04-02")).toBe(
      "daily/2026-04-02/report-2026-04-02.html",
    );
  });

  it("커스텀 파일명으로 경로를 생성한다", () => {
    expect(buildStoragePath("2026-01-15", "weekly-summary")).toBe(
      "daily/2026-01-15/weekly-summary.html",
    );
  });
});

// ─── uploadHtmlReport — 환경변수 미설정 ──────────────────────────────────────

describe("uploadHtmlReport — 환경변수 미설정 시 null 반환", () => {
  beforeEach(() => {
    _resetStorageClientForTest();
    delete process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_SERVICE_KEY"];
  });

  afterEach(() => {
    _resetStorageClientForTest();
    delete process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_SERVICE_KEY"];
    vi.clearAllMocks();
  });

  it("SUPABASE_URL과 SUPABASE_SERVICE_KEY 모두 없으면 null 반환", async () => {
    const result = await uploadHtmlReport("<html/>", "2026-04-02");
    expect(result).toBeNull();
  });

  it("SUPABASE_URL만 있고 SUPABASE_SERVICE_KEY가 없으면 null 반환", async () => {
    process.env["SUPABASE_URL"] = "https://example.supabase.co";
    const result = await uploadHtmlReport("<html/>", "2026-04-02");
    expect(result).toBeNull();
  });

  it("SUPABASE_SERVICE_KEY만 있고 SUPABASE_URL이 없으면 null 반환", async () => {
    process.env["SUPABASE_SERVICE_KEY"] = "service-key-123";
    const result = await uploadHtmlReport("<html/>", "2026-04-02");
    expect(result).toBeNull();
  });

  it("환경변수 미설정 시 upload가 호출되지 않는다", async () => {
    await uploadHtmlReport("<html/>", "2026-04-02");
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

// ─── uploadHtmlReport — 환경변수 설정됨 ──────────────────────────────────────

describe("uploadHtmlReport — 환경변수 설정 + 모킹된 클라이언트", () => {
  beforeEach(() => {
    _resetStorageClientForTest();
    process.env["SUPABASE_URL"] = "https://example.supabase.co";
    process.env["SUPABASE_SERVICE_KEY"] = "service-key-secret";
    vi.clearAllMocks();
  });

  afterEach(() => {
    _resetStorageClientForTest();
    delete process.env["SUPABASE_URL"];
    delete process.env["SUPABASE_SERVICE_KEY"];
    vi.clearAllMocks();
  });

  it("업로드 성공 시 퍼블릭 URL을 반환한다", async () => {
    mockUpload.mockResolvedValueOnce({ data: { path: "daily/2026-04-02/report-2026-04-02.html" }, error: null });
    mockGetPublicUrl.mockReturnValueOnce({
      data: { publicUrl: "https://example.supabase.co/storage/v1/object/public/reports/daily/2026-04-02/report-2026-04-02.html" },
    });

    const result = await uploadHtmlReport("<html><body>Report</body></html>", "2026-04-02");

    expect(result).toBe(
      "https://example.supabase.co/storage/v1/object/public/reports/daily/2026-04-02/report-2026-04-02.html",
    );
  });

  it("업로드 실패 시 null을 반환한다", async () => {
    mockUpload.mockResolvedValueOnce({
      data: null,
      error: { message: "Bucket not found" },
    });

    const result = await uploadHtmlReport("<html/>", "2026-04-02");
    expect(result).toBeNull();
  });

  it("업로드 실패 시 예외를 throw하지 않는다", async () => {
    mockUpload.mockResolvedValueOnce({
      data: null,
      error: { message: "Internal server error" },
    });

    await expect(uploadHtmlReport("<html/>", "2026-04-02")).resolves.toBeNull();
  });

  it("filename 미지정 시 기본 파일명 report-{date}를 사용한다", async () => {
    mockUpload.mockResolvedValueOnce({ data: {}, error: null });
    mockGetPublicUrl.mockReturnValueOnce({
      data: { publicUrl: "https://example.supabase.co/storage/v1/object/public/reports/daily/2026-04-02/report-2026-04-02.html" },
    });

    await uploadHtmlReport("<html/>", "2026-04-02");

    // upload 호출 시 첫 번째 인자가 올바른 경로인지 확인
    expect(mockUpload).toHaveBeenCalledWith(
      "daily/2026-04-02/report-2026-04-02.html",
      expect.any(Buffer),
      { contentType: "text/html", upsert: true },
    );
  });

  it("filename 지정 시 해당 파일명을 사용한다", async () => {
    mockUpload.mockResolvedValueOnce({ data: {}, error: null });
    mockGetPublicUrl.mockReturnValueOnce({
      data: { publicUrl: "https://example.supabase.co/storage/v1/object/public/reports/daily/2026-04-02/custom-report.html" },
    });

    await uploadHtmlReport("<html/>", "2026-04-02", "custom-report");

    expect(mockUpload).toHaveBeenCalledWith(
      "daily/2026-04-02/custom-report.html",
      expect.any(Buffer),
      { contentType: "text/html", upsert: true },
    );
  });

  it("HTML 내용을 UTF-8 Buffer로 업로드한다", async () => {
    const htmlContent = "<html><body>한글 리포트</body></html>";
    mockUpload.mockResolvedValueOnce({ data: {}, error: null });
    mockGetPublicUrl.mockReturnValueOnce({
      data: { publicUrl: "https://example.supabase.co/storage/v1/object/public/reports/daily/2026-04-02/report-2026-04-02.html" },
    });

    await uploadHtmlReport(htmlContent, "2026-04-02");

    const callArgs = mockUpload.mock.calls[0];
    expect(callArgs[1]).toEqual(Buffer.from(htmlContent, "utf-8"));
  });

  it("upsert: true 옵션으로 업로드한다 (동일 경로 덮어쓰기 허용)", async () => {
    mockUpload.mockResolvedValueOnce({ data: {}, error: null });
    mockGetPublicUrl.mockReturnValueOnce({
      data: { publicUrl: "https://example.supabase.co/storage/v1/object/public/reports/daily/2026-04-02/report-2026-04-02.html" },
    });

    await uploadHtmlReport("<html/>", "2026-04-02");

    const callArgs = mockUpload.mock.calls[0];
    expect(callArgs[2]).toMatchObject({ upsert: true });
  });
});

// ─── 파일 경로 생성 로직 검증 ─────────────────────────────────────────────────

describe("파일 경로 생성 로직 (daily/{date}/{filename}.html)", () => {
  it("2026-04-02 날짜, 기본 파일명 → daily/2026-04-02/report-2026-04-02.html", () => {
    expect(buildStoragePath("2026-04-02", "report-2026-04-02")).toBe(
      "daily/2026-04-02/report-2026-04-02.html",
    );
  });

  it("경로는 항상 daily/ prefix로 시작한다", () => {
    const path = buildStoragePath("2026-04-02", "anything");
    expect(path.startsWith("daily/")).toBe(true);
  });

  it("경로는 항상 .html로 끝난다", () => {
    const path = buildStoragePath("2026-04-02", "my-report");
    expect(path.endsWith(".html")).toBe(true);
  });

  it("날짜가 중간 세그먼트로 포함된다", () => {
    const date = "2026-04-02";
    const path = buildStoragePath(date, "report-2026-04-02");
    expect(path).toContain(`/${date}/`);
  });
});
