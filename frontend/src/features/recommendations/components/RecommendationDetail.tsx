import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/shared/components/ui/card'
import { formatDate } from '@/shared/lib/formatDate'

import type { RecommendationDetail } from '../types'
import { PnlCell } from './PnlCell'

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

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>진입 정보</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <DetailItem
                label="진입가"
                value={`$${entryPrice.toFixed(2)}`}
              />
              <DetailItem
                label="진입 Phase"
                value={
                  entryPrevPhase != null &&
                  entryPrevPhase !== entryPhase
                    ? `${entryPrevPhase}→${entryPhase}`
                    : `Phase ${entryPhase}`
                }
              />
              <DetailItem
                label="진입 RS"
                value={entryRsScore != null ? String(entryRsScore) : '-'}
              />
              <DetailItem label="레짐" value={marketRegime ?? '-'} />
              <DetailItem label="섹터" value={sector ?? '-'} />
              <DetailItem label="산업" value={industry ?? '-'} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>현재 상태</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <DetailItem
                label="현재가"
                value={
                  currentPrice != null ? `$${currentPrice.toFixed(2)}` : '-'
                }
              />
              <DetailItem
                label="현재 Phase"
                value={currentPhase != null ? `Phase ${currentPhase}` : '-'}
              />
              <DetailItem
                label="현재 RS"
                value={currentRsScore != null ? String(currentRsScore) : '-'}
              />
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">수익률</span>
                <PnlCell value={pnlPercent} />
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">최대 수익률</span>
                <PnlCell value={maxPnlPercent} />
              </div>
              <DetailItem label="보유일" value={`${daysHeld}일`} />
              {lastUpdated != null && (
                <DetailItem
                  label="마지막 업데이트"
                  value={formatDate(lastUpdated)}
                />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {status !== 'ACTIVE' && (
        <Card>
          <CardHeader>
            <CardTitle>종료 정보</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <DetailItem
                label="종료일"
                value={closeDate != null ? formatDate(closeDate) : '-'}
              />
              <DetailItem
                label="종료가"
                value={
                  closePrice != null ? `$${closePrice.toFixed(2)}` : '-'
                }
              />
              <DetailItem label="종료 사유" value={closeReason ?? '-'} />
            </div>
          </CardContent>
        </Card>
      )}

      {reason != null && reason !== '' && (
        <Card>
          <CardHeader>
            <CardTitle>추천 사유</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">
              {reason}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}
