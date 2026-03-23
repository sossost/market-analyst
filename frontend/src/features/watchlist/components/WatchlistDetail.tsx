import { PnlCell } from '@/features/recommendations/components/PnlCell'
import {
  PHASE_LABEL,
  PHASE_TOOLTIP,
} from '@/features/recommendations/constants'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { formatDate } from '@/shared/lib/formatDate'

import type { WatchlistStockDetail } from '../types'
import { EntryFactorCard } from './EntryFactorCard'
import { PhaseTrajectoryChart } from './PhaseTrajectoryChart'

interface WatchlistDetailProps {
  stock: WatchlistStockDetail
}

export function WatchlistDetail({ stock }: WatchlistDetailProps) {
  const isActive = stock.status === 'ACTIVE'

  return (
    <div className="flex flex-col gap-6">
      {/* 등록 근거 */}
      {stock.entryReason != null && stock.entryReason !== '' && (
        <Card>
          <CardHeader>
            <CardTitle>등록 근거</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {stock.entryReason}
            </p>
          </CardContent>
        </Card>
      )}

      {/* 5중 교집합 근거 */}
      <EntryFactorCard stock={stock} />

      {/* 90일 Phase 궤적 */}
      {stock.phaseTrajectory != null && stock.phaseTrajectory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>90일 Phase 궤적</CardTitle>
          </CardHeader>
          <CardContent>
            <PhaseTrajectoryChart data={stock.phaseTrajectory} />
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* 수익 현황 */}
        <Card>
          <CardHeader>
            <CardTitle>{isActive ? '수익 현황' : '최종 결과'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <DetailItem
                label="진입가"
                value={
                  stock.priceAtEntry != null
                    ? `$${stock.priceAtEntry.toFixed(2)}`
                    : '-'
                }
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">수익률</span>
                <PnlCell value={stock.pnlPercent} />
              </div>
              <DetailItem
                label="현재가"
                value={
                  stock.currentPrice != null
                    ? `$${stock.currentPrice.toFixed(2)}`
                    : '-'
                }
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">
                  최대 수익률
                </span>
                <PnlCell value={stock.maxPnlPercent} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 상태 요약 */}
        <Card>
          <CardHeader>
            <CardTitle>{isActive ? '추적 상태' : '종료 사유'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              {!isActive && stock.exitReason != null && (
                <DetailItem label="종료 사유" value={stock.exitReason} />
              )}
              {!isActive && stock.exitDate != null && (
                <DetailItem
                  label="종료일"
                  value={formatDate(stock.exitDate)}
                />
              )}
              <div className="grid grid-cols-2 gap-4">
                <DetailItem
                  label="등록 시점 흐름"
                  value={
                    PHASE_LABEL[stock.entryPhase] ??
                    `Phase ${stock.entryPhase}`
                  }
                  tooltip={PHASE_TOOLTIP[stock.entryPhase]}
                />
                <DetailItem
                  label="현재 흐름"
                  value={
                    stock.currentPhase != null
                      ? (PHASE_LABEL[stock.currentPhase] ??
                          `Phase ${stock.currentPhase}`)
                      : '-'
                  }
                  tooltip={
                    stock.currentPhase != null
                      ? PHASE_TOOLTIP[stock.currentPhase]
                      : undefined
                  }
                />
                <DetailItem
                  label="섹터 상대성과"
                  value={
                    stock.sectorRelativePerf != null
                      ? `${stock.sectorRelativePerf > 0 ? '+' : ''}${stock.sectorRelativePerf.toFixed(2)}%`
                      : '-'
                  }
                />
                <DetailItem
                  label="추적일수"
                  value={`${stock.daysTracked}일`}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 전문가용 원시 데이터 */}
      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
          전문가용 원시 데이터
        </summary>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <DetailItem
            label="진입 Phase"
            value={`Phase ${stock.entryPhase}`}
          />
          <DetailItem
            label="현재 Phase"
            value={
              stock.currentPhase != null ? `Phase ${stock.currentPhase}` : '-'
            }
          />
          <DetailItem
            label="진입 RS"
            value={stock.entryRsScore != null ? String(stock.entryRsScore) : '-'}
          />
          <DetailItem
            label="현재 RS"
            value={
              stock.currentRsScore != null
                ? String(stock.currentRsScore)
                : '-'
            }
          />
          <DetailItem
            label="섹터 RS"
            value={
              stock.entrySectorRs != null
                ? `${stock.entrySectorRs.toFixed(1)}%`
                : '-'
            }
          />
          <DetailItem
            label="SEPA 등급"
            value={stock.entrySepaGrade ?? '-'}
          />
          <DetailItem label="섹터" value={stock.entrySector ?? '-'} />
          <DetailItem label="산업" value={stock.entryIndustry ?? '-'} />
          <DetailItem
            label="추적 종료 예정"
            value={
              stock.trackingEndDate != null
                ? formatDate(stock.trackingEndDate)
                : '-'
            }
          />
          {stock.entryThesisId != null && (
            <DetailItem
              label="연결 Thesis"
              value={`#${stock.entryThesisId}`}
            />
          )}
          {stock.lastUpdated != null && (
            <DetailItem
              label="마지막 업데이트"
              value={formatDate(stock.lastUpdated)}
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
