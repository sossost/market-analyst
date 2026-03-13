import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// logger는 process.env.LOG_LEVEL을 런타임에 읽으므로 각 테스트에서 env를 설정한 뒤 모듈을 재임포트한다.
// vi.resetModules() + dynamic import 패턴으로 환경변수 변경을 격리한다.

describe("logger", () => {
  let consoleSpy: {
    debug: ReturnType<typeof vi.spyOn>;
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: vi.spyOn(console, "debug").mockImplementation(() => {}),
      log: vi.spyOn(console, "log").mockImplementation(() => {}),
      warn: vi.spyOn(console, "warn").mockImplementation(() => {}),
      error: vi.spyOn(console, "error").mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env["LOG_LEVEL"];
  });

  async function importLogger() {
    const mod = await import("../logger.js?t=" + Date.now());
    return mod.logger;
  }

  // ── 기본값: info ──────────────────────────────────────────────

  describe("기본 LOG_LEVEL (미설정 시 info)", () => {
    it("info 메시지를 출력한다", async () => {
      const logger = await importLogger();
      logger.info("TAG", "hello info");
      expect(consoleSpy.log).toHaveBeenCalledWith("  [TAG] hello info");
    });

    it("debug 메시지를 억제한다", async () => {
      const logger = await importLogger();
      logger.debug("TAG", "hello debug");
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it("warn 메시지를 출력한다", async () => {
      const logger = await importLogger();
      logger.warn("TAG", "hello warn");
      expect(consoleSpy.warn).toHaveBeenCalledWith("  [TAG] hello warn");
    });

    it("error 메시지를 출력한다", async () => {
      const logger = await importLogger();
      logger.error("TAG", "hello error");
      expect(consoleSpy.error).toHaveBeenCalledWith("  [TAG] hello error");
    });
  });

  // ── LOG_LEVEL=debug ──────────────────────────────────────────

  describe("LOG_LEVEL=debug", () => {
    beforeEach(() => {
      process.env["LOG_LEVEL"] = "debug";
    });

    it("debug 메시지를 출력한다", async () => {
      const logger = await importLogger();
      logger.debug("TAG", "verbose detail");
      expect(consoleSpy.debug).toHaveBeenCalledWith("  [TAG] verbose detail");
    });

    it("info 메시지를 출력한다", async () => {
      const logger = await importLogger();
      logger.info("TAG", "some info");
      expect(consoleSpy.log).toHaveBeenCalledWith("  [TAG] some info");
    });

    it("warn 메시지를 출력한다", async () => {
      const logger = await importLogger();
      logger.warn("TAG", "some warn");
      expect(consoleSpy.warn).toHaveBeenCalledWith("  [TAG] some warn");
    });

    it("error 메시지를 출력한다", async () => {
      const logger = await importLogger();
      logger.error("TAG", "some error");
      expect(consoleSpy.error).toHaveBeenCalledWith("  [TAG] some error");
    });
  });

  // ── LOG_LEVEL=warn ───────────────────────────────────────────

  describe("LOG_LEVEL=warn", () => {
    beforeEach(() => {
      process.env["LOG_LEVEL"] = "warn";
    });

    it("debug 메시지를 억제한다", async () => {
      const logger = await importLogger();
      logger.debug("TAG", "suppressed debug");
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it("info 메시지를 억제한다", async () => {
      const logger = await importLogger();
      logger.info("TAG", "suppressed info");
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it("warn 메시지를 출력한다", async () => {
      const logger = await importLogger();
      logger.warn("TAG", "visible warn");
      expect(consoleSpy.warn).toHaveBeenCalledWith("  [TAG] visible warn");
    });

    it("error 메시지를 출력한다", async () => {
      const logger = await importLogger();
      logger.error("TAG", "visible error");
      expect(consoleSpy.error).toHaveBeenCalledWith("  [TAG] visible error");
    });
  });

  // ── LOG_LEVEL=error ──────────────────────────────────────────

  describe("LOG_LEVEL=error", () => {
    beforeEach(() => {
      process.env["LOG_LEVEL"] = "error";
    });

    it("debug 메시지를 억제한다", async () => {
      const logger = await importLogger();
      logger.debug("TAG", "suppressed");
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it("info 메시지를 억제한다", async () => {
      const logger = await importLogger();
      logger.info("TAG", "suppressed");
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it("warn 메시지를 억제한다", async () => {
      const logger = await importLogger();
      logger.warn("TAG", "suppressed");
      expect(consoleSpy.warn).not.toHaveBeenCalled();
    });

    it("error 메시지를 출력한다", async () => {
      const logger = await importLogger();
      logger.error("TAG", "visible error");
      expect(consoleSpy.error).toHaveBeenCalledWith("  [TAG] visible error");
    });
  });

  // ── step: 레벨 무관 항상 출력 ───────────────────────────────

  describe("step — 레벨 필터 무시", () => {
    it("LOG_LEVEL=error일 때도 step은 출력된다", async () => {
      process.env["LOG_LEVEL"] = "error";
      const logger = await importLogger();
      logger.step("── Phase 1: Sector Scan ──");
      expect(consoleSpy.log).toHaveBeenCalledWith("── Phase 1: Sector Scan ──");
    });

    it("LOG_LEVEL=debug일 때 step은 출력된다", async () => {
      process.env["LOG_LEVEL"] = "debug";
      const logger = await importLogger();
      logger.step("── Phase 2 ──");
      expect(consoleSpy.log).toHaveBeenCalledWith("── Phase 2 ──");
    });
  });

  // ── 잘못된 LOG_LEVEL 값 → 기본값 info ───────────────────────

  describe("잘못된 LOG_LEVEL 값 → 기본값 info로 폴백", () => {
    it("알 수 없는 값은 info 레벨로 동작한다", async () => {
      process.env["LOG_LEVEL"] = "verbose";
      const logger = await importLogger();

      logger.debug("TAG", "should be suppressed");
      logger.info("TAG", "should be visible");

      expect(consoleSpy.debug).not.toHaveBeenCalled();
      expect(consoleSpy.log).toHaveBeenCalledWith("  [TAG] should be visible");
    });
  });
});
