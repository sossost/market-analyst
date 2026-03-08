/**
 * Failure pattern types — Phase 2 위양성 분석용.
 */

export interface FailureConditions {
  marketBreadthDirection: "improving" | "declining" | "neutral" | null;
  sectorRsIsolated: boolean | null;
  volumeConfirmed: boolean | null;
  sepaGrade: "S" | "A" | "B" | "C" | "F" | null;
}

export interface FailurePatternRow {
  patternName: string;
  conditions: FailureConditions;
  failureCount: number;
  totalCount: number;
  failureRate: number;
  significance: number; // p-value
  cohenH: number;
  isActive: boolean;
}
