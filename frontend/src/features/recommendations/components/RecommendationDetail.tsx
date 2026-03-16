import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { formatDate } from '@/shared/lib/formatDate'

import {
  PHASE_LABEL,
  PHASE_TOOLTIP,
  REGIME_LABEL,
  REGIME_TOOLTIP,
} from '../constants'
import type { RecommendationDetail } from '../types'
import { PnlCell } from './PnlCell'
import { StatusSignal } from './StatusSignal'

interface RecommendationDetailProps {
  recommendation: RecommendationDetail
}

export function RecommendationDetail({
  recommendation,
}: RecommendationDetailProps) {
  const {
    entryPrice,
    entryPhase,
    entryPrevPhase,
    entryRsScore,
    marketRegime,
    sector,
    industry,
    currentPrice,
    currentPhase,
    currentRsScore,
    pnlPercent,
    maxPnlPercent,
    daysHeld,
    status,
    closeDate,
    closePrice,
    closeReason,
    lastUpdated,
    reason,
  } = recommendation

  const isActive = status === 'ACTIVE'

  return (
    <div className="flex flex-col gap-6">
      {/* 추천 근거 — 가장 중요한 정보 최상단 배치 */}
      {reason != null && reason !== '' && (
        <Card>
          <CardHeader>
            <CardTitle>추천 근거</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {reason}
            </p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* 수익 현황 카드 */}
        <Card>
          <CardHeader>
            <CardTitle>{isActive ? '수익 현황' : '최종 결과'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <DetailItem
                label="진입가"
                value={`$${entryPrice.toFixed(2)}`}
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">수익률</span>
                <PnlCell value={pnlPercent} />
              </div>
              <DetailItem
                label={isActive ? '현재가' : '종료가'}
                value={
                  isActive
                    ? currentPrice != null
                      ? `$${currentPrice.toFixed(2)}`
                      : '-'
                    : closePrice != null
                      ? `$${closePrice.toFixed(2)}`
                      : '-'
                }
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">최대 수익률</span>
                <PnlCell value={maxPnlPercent} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 상태 요약 카드 */}
        <Card>
          <CardHeader>
            <CardTitle>{isActive ? '상태 요약' : '종료 사유'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              {isActive && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">상태 신호</span>
                  <StatusSignal
                    entryPhase={entryPhase}
                    currentPhase={currentPhase}
                    status={status}
                  />
                </div>
              )}
              {!isActive && (
                <>
                  <DetailItem
                    label="종료 사유"
                    value={formatCloseReason(closeReason)}
                  />
                  <DetailItem
                    label="종료일"
                    value={closeDate != null ? formatDate(closeDate) : '-'}
                  />
                </>
              )}
              <div className="grid grid-cols-2 gap-4">
                <DetailItem
                  label="추천 시점 흐름"
                  value={PHASE_LABEL[entryPhase] ?? `Phase ${entryPhase}`}
                  tooltip={PHASE_TOOLTIP[entryPhase]}
                />
                <DetailItem
                  label="현재 흐름"
                  value={
                    currentPhase != null
                      ? (PHASE_LABEL[currentPhase] ?? `Phase ${currentPhase}`)
                      : '-'
                  }
                  tooltip={currentPhase != null ? PHASE_TOOLTIP[currentPhase] : undefined}
                />
                <DetailItem
                  label="시장 환경 (추천 시점)"
                  value={
                    marketRegime != null
                      ? (REGIME_LABEL[marketRegime] ?? marketRegime)
                      : '-'
                  }
                  tooltip={marketRegime != null ? REGIME_TOOLTIP[marketRegime] : undefined}
                />
                <DetailItem label="섹터" value={sector ?? '-'} />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 전문가용 원시 데이터 — 기본 접힌 상태 */}
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
          전문가용 원시 데이터
        </summary>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <DetailItem label="진입 Phase" value={`Phase ${entryPhase}`} />
          {entryPrevPhase != null && entryPrevPhase !== entryPhase && (
            <DetailItem
              label="직전 Phase"
              value={`Phase ${entryPrevPhase}`}
            />
          )}
          <DetailItem
            label="현재 Phase"
            value={currentPhase != null ? `Phase ${currentPhase}` : '-'}
          />
          <DetailItem
            label="진입 RS"
            value={entryRsScore != null ? String(entryRsScore) : '-'}
          />
          <DetailItem
            label="현재 RS"
            value={currentRsScore != null ? String(currentRsScore) : '-'}
          />
          <DetailItem label="레짐 코드" value={marketRegime ?? '-'} />
          <DetailItem label="산업" value={industry ?? '-'} />
          <DetailItem label="보유일" value={`${daysHeld}일`} />
          {lastUpdated != null && (
            <DetailItem
              label="마지막 업데이트"
              value={formatDate(lastUpdated)}
            />
          )}
        </div>
      </details>
    </div>
  )
}

function DetailItem({
  label,
  value,
  tooltip,
}: {
  label: string
  value: string
  tooltip?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      {tooltip != null ? (
        <span className="text-sm font-medium cursor-help" title={tooltip}>
          {value}
        </span>
      ) : (
        <span className="text-sm font-medium">{value}</span>
      )}
    </div>
  )
}

/** DB의 close_reason raw 텍스트를 사람이 읽을 수 있는 표현으로 번역 */
function formatCloseReason(raw: string | null): string {
  if (raw == null) return '-'
  if (raw === 'DUPLICATE_CLEANUP') return '재추천으로 이전 포지션 정리'
  // "Phase 3 이탈 (RS 93)" → "고점 형성 구간 이탈 (RS 93)"
  const phaseExitMatch = raw.match(/^Phase (\d) 이탈(.*)$/)
  if (phaseExitMatch != null) {
    const phase = Number(phaseExitMatch[1])
    const rest = phaseExitMatch[2] ?? ''
    const phaseLabel = PHASE_LABEL[phase] ?? `Phase ${phase}`
    return `${phaseLabel} 구간 이탈${rest}`
  }
  return raw
}
