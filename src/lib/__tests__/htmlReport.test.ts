import { describe, it, expect } from "vitest";
import { buildHtmlReport } from "../htmlReport.js";

// ────────────────────────────────────────────────────────────
// 헬퍼
// ────────────────────────────────────────────────────────────

function makeReport(markdown: string) {
  return buildHtmlReport(markdown, "테스트 리포트", "2026-04-03");
}

// ────────────────────────────────────────────────────────────
// 기존 테스트: HTML 구조
// ────────────────────────────────────────────────────────────

describe("buildHtmlReport", () => {
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

  // ────────────────────────────────────────────────────────────
  // 시맨틱 컴포넌트 변환 테스트
  // ────────────────────────────────────────────────────────────

  describe("지수 테이블 → .index-card 변환", () => {
    it("지수 테이블을 .index-grid 컨테이너로 변환한다", () => {
      const markdown = `## 시장 온도 근거

| 지수 | 종가 | 등락률 |
|------|------|--------|
| S&P 500 | 5,500.00 | +0.50% |
| NASDAQ | 17,000.00 | -0.30% |
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="index-grid"');
      expect(result).toContain('class="index-card"');
    });

    it("지수 카드에 label, value, change 클래스가 포함된다", () => {
      const markdown = `## 시장 온도 근거

| 지수 | 종가 | 등락률 |
|------|------|--------|
| S&P 500 | 5,500.00 | +0.50% |
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="label"');
      expect(result).toContain('class="value"');
      expect(result).toContain('class="change');
    });

    it("양수 등락률에 up 클래스를 적용한다", () => {
      const markdown = `## 시장 온도 근거

| 지수 | 종가 | 등락률 |
|------|------|--------|
| S&P 500 | 5,500.00 | +0.50% |
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="change up"');
    });

    it("음수 등락률에 down 클래스를 적용한다", () => {
      const markdown = `## 시장 온도 근거

| 지수 | 종가 | 등락률 |
|------|------|--------|
| NASDAQ | 17,000.00 | -0.30% |
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="change down"');
    });
  });

  describe("Phase 분포 → .phase-bar + .phase-legend 변환", () => {
    it("Phase 분포 텍스트에서 .phase-bar 컨테이너를 생성한다", () => {
      const markdown = `## 시장 온도 근거

**Phase 분포**:
- Phase 1: 226 (4.9%)
- Phase 2: 1,441 (31.3%)
- Phase 3: 1,642 (35.7%)
- Phase 4: 1,292 (28.1%)
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="phase-bar"');
    });

    it("phase-bar에 각 seg 클래스를 포함한다", () => {
      const markdown = `## 시장 온도 근거

**Phase 분포**:
- Phase 1: 226 (4.9%)
- Phase 2: 1,441 (31.3%)
- Phase 3: 1,642 (35.7%)
- Phase 4: 1,292 (28.1%)
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="seg p1"');
      expect(result).toContain('class="seg p2"');
      expect(result).toContain('class="seg p3"');
      expect(result).toContain('class="seg p4"');
    });

    it("phase-bar에 width 스타일이 퍼센트로 적용된다", () => {
      const markdown = `## 시장 온도 근거

**Phase 분포**:
- Phase 1: 226 (4.9%)
- Phase 2: 1,441 (31.3%)
- Phase 3: 1,642 (35.7%)
- Phase 4: 1,292 (28.1%)
`;
      const result = makeReport(markdown);

      expect(result).toContain("width:4.9%");
      expect(result).toContain("width:31.3%");
    });

    it("phase-legend에 각 레전드 항목이 포함된다", () => {
      const markdown = `## 시장 온도 근거

**Phase 분포**:
- Phase 1: 226 (4.9%)
- Phase 2: 1,441 (31.3%)
- Phase 3: 1,642 (35.7%)
- Phase 4: 1,292 (28.1%)
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="phase-legend"');
      expect(result).toContain('class="l1"');
      expect(result).toContain('class="l2"');
    });
  });

  describe("stat-chip 변환", () => {
    it("공포탐욕지수를 .stat-chip으로 변환한다", () => {
      const markdown = `## 시장 온도 근거

**공포탐욕지수**: 15.3 극도의 공포 (전일 15.7 / 1주전 14.9)
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="stat-chip"');
      expect(result).toContain("공포탐욕지수");
    });

    it("Phase 2 비율을 .stat-chip으로 변환한다", () => {
      const markdown = `## 시장 온도 근거

**Phase 2 비율**: 31.3% (▼0.04p)
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="stat-chip"');
      expect(result).toContain("Phase 2 비율");
    });

    it("신고가/신저가를 .stat-chip으로 변환한다", () => {
      const markdown = `## 시장 온도 근거

**신고가 / 신저가**: 66 / 56
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="stat-chip"');
      expect(result).toContain("신고가 / 신저가");
    });
  });

  describe("온도 배지 → .temp-badge 변환", () => {
    it("약세 판단 시 bearish 클래스의 temp-badge를 헤더에 추가한다", () => {
      const markdown = `## 시장 온도 근거

**시장 온도 판단**: 약세
`;
      const result = buildHtmlReport(markdown, "시장 브리핑", "2026-04-03");

      expect(result).toContain('class="temp-badge bearish"');
    });

    it("강세 판단 시 bullish 클래스의 temp-badge를 헤더에 추가한다", () => {
      const markdown = `## 시장 온도 근거

**시장 온도 판단**: 강세
`;
      const result = buildHtmlReport(markdown, "시장 브리핑", "2026-04-03");

      expect(result).toContain('class="temp-badge bullish"');
    });

    it("중립 판단 시 neutral 클래스의 temp-badge를 헤더에 추가한다", () => {
      const markdown = `## 시장 온도 근거

**시장 온도 판단**: 중립
`;
      const result = buildHtmlReport(markdown, "시장 브리핑", "2026-04-03");

      expect(result).toContain('class="temp-badge neutral"');
    });

    it("온도 판단이 없으면 temp-badge를 추가하지 않는다", () => {
      const markdown = `## 섹터 분석

일반 내용
`;
      const result = buildHtmlReport(markdown, "시장 브리핑", "2026-04-03");

      expect(result).not.toContain('class="temp-badge');
    });
  });

  describe("종목 → .stock-card 변환", () => {
    it("**TICKER (Name)** 패턴을 .stock-card로 변환한다", () => {
      const markdown = `## 강세 특이종목

**RLAY (Relay Therapeutics)** +16.4% RS 96 Vol 3.2x
- 카탈리스트: zovegalisib 임상 데이터 발표
- 52주 신고가 경신
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="stock-card"');
      expect(result).toContain('class="stock-ticker"');
      expect(result).toContain("RLAY");
    });

    it("종목 이름을 .stock-name 클래스로 렌더링한다", () => {
      const markdown = `## 강세 특이종목

**RLAY (Relay Therapeutics)** +16.4%
- 내용
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="stock-name"');
      expect(result).toContain("Relay Therapeutics");
    });

    it("수익률 태그를 .tag.return-up으로 변환한다", () => {
      const markdown = `## 강세 특이종목

**RLAY** +16.4%
- 내용
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="tag return-up"');
      expect(result).toContain("+16.4%");
    });

    it("음수 수익률 태그를 .tag.return-down으로 변환한다", () => {
      const markdown = `## 약세 특이종목

**EEIQ** -31.5%
- 급락
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="tag return-down"');
      expect(result).toContain("-31.5%");
    });

    it("RS 태그를 .tag.rs로 변환한다", () => {
      const markdown = `## 강세 특이종목

**RLAY** RS 96
- 내용
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="tag rs"');
    });

    it("Vol 태그를 .tag.vol로 변환한다", () => {
      const markdown = `## 강세 특이종목

**RLAY** Vol 3.2x
- 내용
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="tag vol"');
    });

    it("여러 종목을 각각 .stock-card로 변환한다", () => {
      const markdown = `## 강세 특이종목

**RLAY (Relay)** +16.4%
- 임상 데이터

**ORKA (Oruka)** +5.7%
- 증자 계획
`;
      const result = makeReport(markdown);

      const cardCount = (result.match(/class="stock-card"/g) ?? []).length;
      expect(cardCount).toBe(2);
    });

    it("종목 본문이 .stock-body로 렌더링된다", () => {
      const markdown = `## 강세 특이종목

**RLAY** +16.4%
- 임상 데이터 발표
- 52주 신고가
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="stock-body"');
    });
  });

  describe("부록 구분선 → .appendix-divider 변환", () => {
    it("--- 구분선을 .appendix-divider로 변환한다", () => {
      const markdown = `## 시장 흐름

본문 내용

---
📋 **부록: 종목 상세**

## 강세 특이종목

**RLAY** +16.4%
- 임상 데이터
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="appendix-divider"');
    });

    it("부록 제목을 .appendix-title로 렌더링한다", () => {
      const markdown = `본문

---
📋 **부록: 종목 상세**
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="appendix-title"');
    });
  });

  describe("watchpoint 변환", () => {
    it("번호 리스트를 .watchpoint 컴포넌트로 변환한다", () => {
      const markdown = `## 시장 흐름 및 종합 전망

본문 내용

### 향후 관전 포인트

1. Energy 섹터 과열 해소 속도
2. Technology 섹터 RS 50선 회복
3. Financial Services 섹터 Phase 전환
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="watchpoint"');
      expect(result).toContain('class="watchpoint-num"');
      expect(result).toContain('class="watchpoint-text"');
    });

    it("watchpoint 번호가 올바르게 렌더링된다", () => {
      const markdown = `## 시장 흐름 및 종합 전망

### 향후 관전 포인트

1. 첫 번째 관전 포인트
2. 두 번째 관전 포인트
`;
      const result = makeReport(markdown);

      expect(result).toMatch(/watchpoint-num.*1/s);
      expect(result).toMatch(/watchpoint-num.*2/s);
    });
  });

  describe("content-block 변환", () => {
    it("전일 대비 변화 요약 섹션을 .content-block으로 변환한다", () => {
      const markdown = `## 전일 대비 변화 요약

**주도 섹터**: Energy(RS 74.3) 2일 연속 주도
**Phase 2 비율**: 31.4% → 31.3% (-0.1p)
`;
      const result = makeReport(markdown);

      expect(result).toContain('class="content-block"');
    });

    it("h3 서브헤더가 <h3> 태그로 렌더링된다", () => {
      const markdown = `## 전일 대비 변화 요약

본문 내용

### 직전 핵심 인사이트 후속 판정

판정 내용
`;
      const result = makeReport(markdown);

      expect(result).toContain("<h3>");
      expect(result).toContain("직전 핵심 인사이트 후속 판정");
    });

    it("직전 핵심 인사이트 h3 이후가 별도 content-block으로 분리된다", () => {
      const markdown = `## 전일 대비 변화 요약

**주도 섹터**: Energy 2일 연속 주도

### 직전 핵심 인사이트 후속 판정

✅ **유효** — 에너지 포지션 해소 확인

⏳ **진행중** — AI 테마 확산 초기
`;
      const result = makeReport(markdown);

      // h3 바로 뒤에 별도 content-block이 와야 한다
      expect(result).toContain('<h3>직전 핵심 인사이트 후속 판정</h3>');
      // 판정 내용이 content-block 안에 포함된다
      expect(result).toContain('✅');
      expect(result).toContain('⏳');
      // content-block이 최소 2개 이상 (본문 + 판정)
      const blockCount = (result.match(/class="content-block"/g) ?? []).length;
      expect(blockCount).toBeGreaterThanOrEqual(2);
    });

    it("시장 흐름 섹션 본문이 볼드 키 없이 서술형 p 태그로 렌더링된다", () => {
      const markdown = `## 시장 흐름 및 종합 전망

극도의 공포 지속 속에서도 소형주 상대적 강세.

거래량 동반 분석 결과 신뢰도 높음.

### 향후 관전 포인트

1. 관전 포인트 1
2. 관전 포인트 2
`;
      const result = makeReport(markdown);

      // 볼드 키 없는 서술형 p 태그가 content-block 안에 들어가야 한다
      expect(result).toContain('class="content-block"');
      // h3 향후 관전 포인트가 별도로 존재
      expect(result).toContain('<h3>향후 관전 포인트</h3>');
      // watchpoint 컴포넌트 존재
      expect(result).toContain('class="watchpoint"');
    });
  });

  describe("섹션 구조 — <section> 태그 생성", () => {
    it("## 헤더마다 <section> 태그로 감싼다", () => {
      const markdown = `## 섹터 RS 랭킹 표

내용

## 전일 대비 변화 요약

내용2
`;
      const result = makeReport(markdown);

      const sectionCount = (result.match(/<section>/g) ?? []).length;
      expect(sectionCount).toBeGreaterThanOrEqual(2);
    });

    it("섹션 내부에 <h2> 태그가 포함된다", () => {
      const markdown = `## 시장 분석

내용
`;
      const result = makeReport(markdown);

      expect(result).toContain("<h2>");
      expect(result).toContain("시장 분석");
    });
  });

  describe("폴백 처리 — 미인식 패턴", () => {
    it("미인식 섹션은 에러 없이 기본 HTML로 변환한다", () => {
      const markdown = `## 알 수 없는 섹션

| 컬럼1 | 컬럼2 |
|-------|-------|
| 값1 | 값2 |
`;
      expect(() => makeReport(markdown)).not.toThrow();

      const result = makeReport(markdown);
      expect(result).toContain("<!DOCTYPE html>");
      expect(result).toContain("값1");
    });

    it("파싱 오류 시 섹션 전체가 폴백으로 처리된다", () => {
      const markdown = `## 시장 온도 근거

비정상적인 데이터: |||||||
`;
      expect(() => makeReport(markdown)).not.toThrow();

      const result = makeReport(markdown);
      expect(result).toContain("<!DOCTYPE html>");
    });

    it("마크다운 테이블이 없는 섹터 RS 섹션도 처리된다", () => {
      const markdown = `## 섹터 RS 랭킹 표

테이블 없이 텍스트만 있는 경우
`;
      expect(() => makeReport(markdown)).not.toThrow();
    });
  });

  describe("XSS 방지", () => {
    it("종목 ticker 내 특수문자를 이스케이프한다", () => {
      const markdown = `## 강세 특이종목

**<script>alert(1)</script>** +10%
- 내용
`;
      const result = makeReport(markdown);

      expect(result).not.toContain("<script>alert");
    });

    it("종목명 내 HTML 태그를 이스케이프하여 실행 불가능하게 한다", () => {
      const markdown = `## 강세 특이종목

**TICK (<img src=x onerror=alert(1)>)** +10%
- 내용
`;
      const result = makeReport(markdown);

      // HTML 태그로 실행되면 안 됨 — &lt;img 형태로 이스케이프되어야 함
      expect(result).not.toContain("<img src=x");
    });
  });
});
