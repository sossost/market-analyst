import { describe, it, expect } from "vitest";
import {
  classifyCategory,
  classifySentiment,
  type NewsCategory,
  type NewsSentiment,
} from "@/lib/newsClassifier";

describe("classifyCategory", () => {
  describe("POLICY category", () => {
    it("detects Federal Reserve mentions", () => {
      expect(classifyCategory("Federal Reserve raises rates")).toBe("POLICY");
    });

    it("detects fed keyword", () => {
      expect(classifyCategory("Fed signals pause in rate hikes")).toBe("POLICY");
    });

    it("detects tariff keyword", () => {
      expect(classifyCategory("New tariff on Chinese imports")).toBe("POLICY");
    });

    it("detects regulation keyword", () => {
      expect(classifyCategory("Banking regulation tightens")).toBe("POLICY");
    });

    it("detects executive order keyword", () => {
      expect(classifyCategory("President signs executive order on trade")).toBe("POLICY");
    });

    it("detects treasury keyword", () => {
      expect(classifyCategory("Treasury yields rise sharply")).toBe("POLICY");
    });

    it("detects fiscal keyword", () => {
      expect(classifyCategory("Fiscal stimulus package announced")).toBe("POLICY");
    });
  });

  describe("TECHNOLOGY category", () => {
    it("detects AI keyword", () => {
      expect(classifyCategory("AI boom drives semiconductor demand")).toBe("TECHNOLOGY");
    });

    it("detects artificial intelligence keyword", () => {
      expect(classifyCategory("Artificial intelligence transforms healthcare")).toBe("TECHNOLOGY");
    });

    it("detects semiconductor keyword", () => {
      expect(classifyCategory("Semiconductor shortage eases")).toBe("TECHNOLOGY");
    });

    it("detects chip keyword", () => {
      expect(classifyCategory("New chip design announced by NVIDIA")).toBe("TECHNOLOGY");
    });

    it("detects GPU keyword", () => {
      expect(classifyCategory("GPU demand surges for data centers")).toBe("TECHNOLOGY");
    });

    it("detects cloud keyword", () => {
      expect(classifyCategory("Cloud revenue beats expectations")).toBe("TECHNOLOGY");
    });

    it("detects data center keyword", () => {
      expect(classifyCategory("Data center buildout accelerates")).toBe("TECHNOLOGY");
    });
  });

  describe("GEOPOLITICAL category", () => {
    it("detects china keyword", () => {
      expect(classifyCategory("China exports decline sharply")).toBe("GEOPOLITICAL");
    });

    it("detects taiwan keyword", () => {
      expect(classifyCategory("Taiwan strait tensions escalate")).toBe("GEOPOLITICAL");
    });

    it("detects russia keyword", () => {
      expect(classifyCategory("Russia oil export restrictions")).toBe("GEOPOLITICAL");
    });

    it("detects sanctions keyword", () => {
      expect(classifyCategory("New sanctions imposed on energy sector")).toBe("GEOPOLITICAL");
    });

    it("detects supply chain keyword", () => {
      expect(classifyCategory("Global supply chain disruption worsens")).toBe("GEOPOLITICAL");
    });

    it("detects geopolit prefix", () => {
      expect(classifyCategory("Geopolitical tensions affect markets")).toBe("GEOPOLITICAL");
    });
  });

  describe("CAPEX category", () => {
    it("detects capex keyword", () => {
      expect(classifyCategory("Big tech capex plans for 2026")).toBe("CAPEX");
    });

    it("detects capital expenditure keyword", () => {
      expect(classifyCategory("Capital expenditure grows 20%")).toBe("CAPEX");
    });

    it("detects hyperscaler keyword", () => {
      expect(classifyCategory("Hyperscaler builds new facility")).toBe("CAPEX");
    });

    it("detects infrastructure keyword", () => {
      expect(classifyCategory("Infrastructure bill passes senate")).toBe("CAPEX");
    });
  });

  describe("CREDIT category", () => {
    it("detects private equity keyword", () => {
      expect(classifyCategory("Private equity firms face liquidity crunch")).toBe("CREDIT");
    });

    it("detects private credit keyword", () => {
      expect(classifyCategory("Private credit markets show stress signs")).toBe("CREDIT");
    });

    it("detects CLO keyword", () => {
      expect(classifyCategory("CLO issuance drops sharply this quarter")).toBe("CREDIT");
    });

    it("detects leveraged loan keyword", () => {
      expect(classifyCategory("Leveraged loan defaults rise")).toBe("CREDIT");
    });

    it("detects high yield keyword", () => {
      expect(classifyCategory("High yield spreads widen on recession fears")).toBe("CREDIT");
    });

    it("detects credit spread keyword", () => {
      expect(classifyCategory("Credit spread blowout signals risk-off")).toBe("CREDIT");
    });

    it("detects credit stress keyword", () => {
      expect(classifyCategory("Credit stress indicators flash warning")).toBe("CREDIT");
    });

    it("detects credit default keyword", () => {
      expect(classifyCategory("Credit default swaps signal distress")).toBe("CREDIT");
    });

    it("detects junk bond keyword", () => {
      expect(classifyCategory("Junk bond selloff accelerates")).toBe("CREDIT");
    });

    it("detects debt crisis keyword", () => {
      expect(classifyCategory("Debt crisis fears mount in Europe")).toBe("CREDIT");
    });

    it("detects NAV lending keyword", () => {
      expect(classifyCategory("NAV lending grows as PE seeks liquidity")).toBe("CREDIT");
    });
  });

  describe("MARKET category", () => {
    it("detects market keyword", () => {
      expect(classifyCategory("Market rally continues into third week")).toBe("MARKET");
    });

    it("detects VIX keyword", () => {
      expect(classifyCategory("VIX spikes to 30")).toBe("MARKET");
    });

    it("detects ETF keyword", () => {
      expect(classifyCategory("ETF inflows reach record high")).toBe("MARKET");
    });

    it("detects fund flow keyword", () => {
      expect(classifyCategory("Fund flow data shows rotation")).toBe("MARKET");
    });
  });

  describe("OTHER category", () => {
    it("returns OTHER when no keywords match", () => {
      expect(classifyCategory("Celebrity launches new fashion brand")).toBe("OTHER");
    });

    it("returns OTHER for empty string", () => {
      expect(classifyCategory("")).toBe("OTHER");
    });
  });

  describe("priority ordering", () => {
    it("POLICY wins over TECHNOLOGY when both match", () => {
      // "rate" (POLICY) + "ai" (TECHNOLOGY) — POLICY has higher priority
      expect(classifyCategory("Fed rate decision impacts AI stocks")).toBe("POLICY");
    });

    it("POLICY wins over GEOPOLITICAL when both match", () => {
      // "tariff" (POLICY) + "china" (GEOPOLITICAL)
      expect(classifyCategory("China tariff increases announced")).toBe("POLICY");
    });

    it("TECHNOLOGY wins over CAPEX when both match", () => {
      // "ai" (TECHNOLOGY) + "capex" (CAPEX)
      expect(classifyCategory("AI capex spending doubles")).toBe("TECHNOLOGY");
    });

    it("GEOPOLITICAL wins over MARKET when both match", () => {
      // "china" (GEOPOLITICAL) + "market" (MARKET)
      expect(classifyCategory("China market crash feared")).toBe("GEOPOLITICAL");
    });

    it("CREDIT wins over MARKET when both match", () => {
      // "credit spread" (CREDIT) + "market" (MARKET)
      expect(classifyCategory("Credit spread widens in volatile market")).toBe("CREDIT");
    });

    it("POLICY wins over CREDIT when both match", () => {
      // "fed" (POLICY) + "credit spread" (CREDIT)
      expect(classifyCategory("Fed rate hike widens credit spread")).toBe("POLICY");
    });
  });

  describe("case insensitivity", () => {
    it("matches uppercase keywords", () => {
      expect(classifyCategory("FEDERAL RESERVE RAISES RATES")).toBe("POLICY");
    });

    it("matches mixed case keywords", () => {
      expect(classifyCategory("Semiconductor CHIP shortage")).toBe("TECHNOLOGY");
    });
  });
});

describe("classifySentiment", () => {
  describe("POS sentiment", () => {
    it("detects surge keyword", () => {
      expect(classifySentiment("Stock prices surge on earnings")).toBe("POS");
    });

    it("detects rally keyword", () => {
      expect(classifySentiment("Market rally extends gains")).toBe("POS");
    });

    it("detects beat keyword", () => {
      expect(classifySentiment("Company beats earnings expectations")).toBe("POS");
    });

    it("detects bullish keyword", () => {
      expect(classifySentiment("Analysts turn bullish on sector")).toBe("POS");
    });

    it("detects multiple positive keywords", () => {
      expect(classifySentiment("Strong growth and record gain")).toBe("POS");
    });
  });

  describe("NEG sentiment", () => {
    it("detects fall keyword", () => {
      expect(classifySentiment("Stocks fall sharply on news")).toBe("NEG");
    });

    it("detects recession keyword", () => {
      expect(classifySentiment("Recession fears grow")).toBe("NEG");
    });

    it("detects decline keyword", () => {
      expect(classifySentiment("Revenue decline continues")).toBe("NEG");
    });

    it("detects bearish keyword", () => {
      expect(classifySentiment("Bearish outlook for sector")).toBe("NEG");
    });

    it("detects multiple negative keywords", () => {
      expect(classifySentiment("Weak earnings miss with risk of decline")).toBe("NEG");
    });
  });

  describe("NEU sentiment", () => {
    it("returns NEU when no keywords match", () => {
      expect(classifySentiment("Company announces quarterly results")).toBe("NEU");
    });

    it("returns NEU for empty string", () => {
      expect(classifySentiment("")).toBe("NEU");
    });

    it("returns NEU when POS and NEG counts are equal", () => {
      // "surge" (POS) + "fall" (NEG) — tied
      expect(classifySentiment("Stocks surge then fall")).toBe("NEU");
    });
  });

  describe("mixed sentiment resolution", () => {
    it("returns POS when positive keywords outnumber negative", () => {
      // "rally" + "gain" (POS) vs "risk" (NEG) — 2:1
      expect(classifySentiment("Market rally shows gain despite risk")).toBe("POS");
    });

    it("returns NEG when negative keywords outnumber positive", () => {
      // "strong" (POS) vs "fall" + "weak" (NEG) — 1:2
      expect(classifySentiment("Strong start but fall and weak close")).toBe("NEG");
    });
  });

  describe("case insensitivity", () => {
    it("matches uppercase sentiment keywords", () => {
      expect(classifySentiment("STOCKS SURGE ON EARNINGS")).toBe("POS");
    });

    it("matches mixed case sentiment keywords", () => {
      expect(classifySentiment("Recession FEARS grow")).toBe("NEG");
    });
  });
});
