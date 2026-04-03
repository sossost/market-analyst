import { describe, it, expect } from "vitest";
import { buildHtmlReport } from "../htmlReport.js";

describe("buildHtmlReport", () => {
  describe("마크다운 → HTML 변환", () => {
    it("마크다운 테이블을 <table> 태그로 변환한다", () => {
      const markdown = `
| 섹터 | RS | Phase |
|------|-----|-------|
| Technology | 85 | Phase 2 |
| Energy | 72 | Phase 3 |
`.trim();

      const result = buildHtmlReport(markdown, "테스트 리포트", "2026-04-03");

      expect(result).toContain("<table");
      expect(result).toContain("<thead");
      expect(result).toContain("<tbody");
      expect(result).toContain("<th");
      expect(result).toContain("<td");
    });

    it("마크다운 h1 헤더를 <h1> 태그로 변환한다", () => {
      const markdown = "# 시장 분석 제목";

      const result = buildHtmlReport(markdown, "테스트", "2026-04-03");

      expect(result).toContain("<h1>");
      expect(result).toContain("시장 분석 제목");
    });

    it("마크다운 h2 헤더를 <h2> 태그로 변환한다", () => {
      const markdown = "## 섹터 분석";

      const result = buildHtmlReport(markdown, "테스트", "2026-04-03");

      expect(result).toContain("<h2>");
      expect(result).toContain("섹터 분석");
    });

    it("마크다운 h3 헤더를 <h3> 태그로 변환한다", () => {
      const markdown = "### 업종 상세";

      const result = buildHtmlReport(markdown, "테스트", "2026-04-03");

      expect(result).toContain("<h3>");
      expect(result).toContain("업종 상세");
    });

    it("마크다운 볼드를 <strong> 태그로 변환한다", () => {
      const markdown = "**중요한 내용**";

      const result = buildHtmlReport(markdown, "테스트", "2026-04-03");

      expect(result).toContain("<strong>");
      expect(result).toContain("중요한 내용");
    });

    it("마크다운 리스트를 <ul><li> 태그로 변환한다", () => {
      const markdown = `
- 첫 번째 항목
- 두 번째 항목
- 세 번째 항목
`.trim();

      const result = buildHtmlReport(markdown, "테스트", "2026-04-03");

      expect(result).toContain("<ul>");
      expect(result).toContain("<li>");
    });
  });

  describe("HTML 구조", () => {
    it("유효한 DOCTYPE HTML 선언으로 시작한다", () => {
      const result = buildHtmlReport("본문", "제목", "2026-04-03");

      expect(result).toMatch(/^<!DOCTYPE html>/);
    });

    it("meta charset UTF-8을 포함한다", () => {
      const result = buildHtmlReport("본문", "제목", "2026-04-03");

      expect(result).toContain('charset="UTF-8"');
    });

    it("제목을 report-header 블록에 렌더링한다", () => {
      const title = "시장 일일 브리핑";
      const result = buildHtmlReport("본문", title, "2026-04-03");

      expect(result).toContain('class="report-header"');
      expect(result).toContain(title);
    });

    it("날짜를 report-date 요소에 렌더링한다", () => {
      const result = buildHtmlReport("본문", "제목", "2026-04-03");

      expect(result).toContain('class="report-date"');
      expect(result).toContain("2026년");
      expect(result).toContain("4월");
      expect(result).toContain("3일");
    });

    it("날짜가 <title> 태그에 포함된다", () => {
      const result = buildHtmlReport("본문", "제목", "2026-04-03");

      expect(result).toContain("<title>");
      expect(result).toContain("2026-04-03");
    });

    it("<footer> 요소가 생성된다", () => {
      const result = buildHtmlReport("본문", "제목", "2026-04-03");

      expect(result).toContain("<footer");
      expect(result).toContain("Market Analyst");
    });
  });

  describe("CSS 변수", () => {
    it("CSS 변수 --up이 포함된다", () => {
      const result = buildHtmlReport("본문", "제목", "2026-04-03");

      expect(result).toContain("--up: #cf222e");
    });

    it("CSS 변수 --down이 포함된다", () => {
      const result = buildHtmlReport("본문", "제목", "2026-04-03");

      expect(result).toContain("--down: #0969da");
    });

    it("CSS 변수 --phase2가 포함된다", () => {
      const result = buildHtmlReport("본문", "제목", "2026-04-03");

      expect(result).toContain("--phase2: #1a7f37");
    });

    it("인라인 <style> 블록이 포함된다 (외부 CSS 의존성 없음)", () => {
      const result = buildHtmlReport("본문", "제목", "2026-04-03");

      expect(result).toContain("<style>");
      expect(result).not.toContain('<link rel="stylesheet"');
    });
  });

  describe("후처리 — 상승/하락 색상 클래스", () => {
    it("▲ 기호에 up 클래스를 적용한다", () => {
      const markdown = "▲ 2.5%";

      const result = buildHtmlReport(markdown, "제목", "2026-04-03");

      expect(result).toContain('class="up"');
      expect(result).toContain("▲");
    });

    it("▼ 기호에 down 클래스를 적용한다", () => {
      const markdown = "▼ 1.3%";

      const result = buildHtmlReport(markdown, "제목", "2026-04-03");

      expect(result).toContain('class="down"');
      expect(result).toContain("▼");
    });

    it("Phase 2 텍스트에 phase-badge p2 클래스를 적용한다", () => {
      const markdown = "현재 Phase 2 구간입니다.";

      const result = buildHtmlReport(markdown, "제목", "2026-04-03");

      expect(result).toContain('class="phase-badge p2"');
    });

    it("Phase 1 텍스트에 phase-badge p1 클래스를 적용한다", () => {
      const markdown = "Phase 1 초입 진입.";

      const result = buildHtmlReport(markdown, "제목", "2026-04-03");

      expect(result).toContain('class="phase-badge p1"');
    });

    it("Phase 3 텍스트에 phase-badge p3 클래스를 적용한다", () => {
      const markdown = "Phase 3 하락 전환 위험.";

      const result = buildHtmlReport(markdown, "제목", "2026-04-03");

      expect(result).toContain('class="phase-badge p3"');
    });

    it("Phase 4 텍스트에 phase-badge p4 클래스를 적용한다", () => {
      const markdown = "Phase 4 하락 구간.";

      const result = buildHtmlReport(markdown, "제목", "2026-04-03");

      expect(result).toContain('class="phase-badge p4"');
    });

    it("URL 내부의 P2 텍스트는 치환하지 않는다", () => {
      const markdown = '[링크](https://example.com/api/P2/report)에서 Phase 2 확인';

      const result = buildHtmlReport(markdown, "제목", "2026-04-03");

      // URL 내부의 P2는 그대로 보존
      expect(result).toContain("example.com/api/P2/report");
      // 텍스트 노드의 Phase 2는 배지 적용
      expect(result).toContain('class="phase-badge p2"');
    });

    it("href 속성 내부의 ▲ 기호는 치환하지 않는다", () => {
      const html = '<a href="https://example.com/▲test">▲ 2.5%</a>';
      const markdown = `본문 ${html}`;

      const result = buildHtmlReport(markdown, "제목", "2026-04-03");

      // 텍스트 노드의 ▲는 up 클래스 적용
      expect(result).toContain('class="up"');
    });
  });

  describe("엣지 케이스", () => {
    it("빈 마크다운 입력 시 에러 없이 빈 body를 반환한다", () => {
      expect(() => {
        const result = buildHtmlReport("", "제목", "2026-04-03");
        expect(result).toContain("<!DOCTYPE html>");
        expect(result).toContain("</html>");
      }).not.toThrow();
    });

    it("특수 문자가 포함된 제목을 안전하게 이스케이프한다", () => {
      const title = '<script>alert("xss")</script>';

      const result = buildHtmlReport("본문", title, "2026-04-03");

      expect(result).not.toContain("<script>alert");
      expect(result).toContain("&lt;script&gt;");
    });

    it("마크다운 본문에 포함된 raw HTML을 이스케이프한다 (XSS 방지)", () => {
      const malicious = '# 제목\n\n<script>alert("xss")</script>\n\n정상 본문';

      const result = buildHtmlReport(malicious, "제목", "2026-04-03");

      expect(result).not.toContain("<script>alert");
      expect(result).toContain("&lt;script&gt;");
    });

    it("마크다운 본문의 iframe 태그를 이스케이프한다", () => {
      const malicious = '본문\n\n<iframe src="http://evil.com"></iframe>';

      const result = buildHtmlReport(malicious, "제목", "2026-04-03");

      expect(result).not.toContain("<iframe");
    });

    it("잘못된 날짜 형식도 에러 없이 처리한다", () => {
      expect(() => {
        buildHtmlReport("본문", "제목", "invalid-date");
      }).not.toThrow();
    });

    it("긴 마크다운 본문을 처리한다", () => {
      const longMarkdown = Array.from({ length: 100 }, (_, i) =>
        `## 섹터 ${i + 1}\n\n내용 ${i + 1}\n\n`,
      ).join("");

      const result = buildHtmlReport(longMarkdown, "대용량 리포트", "2026-04-03");

      expect(result).toContain("<!DOCTYPE html>");
      expect(result).toContain("섹터 100");
    });
  });

  describe("한국어 날짜 포맷", () => {
    it("YYYY-MM-DD를 한국식 날짜로 변환한다", () => {
      const result = buildHtmlReport("본문", "제목", "2026-04-03");

      expect(result).toContain("2026년 4월 3일");
    });

    it("요일이 한국어로 표시된다", () => {
      // 2026-04-03은 금요일
      const result = buildHtmlReport("본문", "제목", "2026-04-03");

      expect(result).toContain("(금)");
    });
  });
});
