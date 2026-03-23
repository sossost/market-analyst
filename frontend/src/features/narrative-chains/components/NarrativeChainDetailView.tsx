import Link from 'next/link'
import { notFound } from 'next/navigation'

import { Badge } from '@/shared/components/ui/badge'
import { formatDate } from '@/shared/lib/formatDate'

import { fetchNarrativeChainById } from '../lib/supabase-queries'
import { NarrativeChainFlowDiagram } from './NarrativeChainFlowDiagram'
import { NarrativeChainStatusBadge } from './NarrativeChainStatusBadge'

interface NarrativeChainDetailViewProps {
  id: number
}

export async function NarrativeChainDetailView({
  id,
}: NarrativeChainDetailViewProps) {
  const chain = await fetchNarrativeChainById(id)

  if (chain == null) {
    notFound()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold">{chain.bottleneck}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {chain.megatrend}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {chain.alphaCompatible === true && (
            <Badge variant="outline" className="border-green-300 text-green-700 dark:border-green-700 dark:text-green-300">
              Alpha Gate 적합
            </Badge>
          )}
          <NarrativeChainStatusBadge status={chain.status} />
        </div>
      </div>

      {/* Flow diagram */}
      <NarrativeChainFlowDiagram chain={chain} />

      {/* Meta info */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetaCard
          label="식별일"
          value={formatDate(chain.bottleneckIdentifiedAt)}
        />
        <MetaCard
          label="해소일"
          value={
            chain.bottleneckResolvedAt != null
              ? formatDate(chain.bottleneckResolvedAt)
              : '-'
          }
        />
        <MetaCard
          label="해소 소요일"
          value={
            chain.resolutionDays != null ? `${chain.resolutionDays}일` : '-'
          }
        />
        <MetaCard
          label="연결 Thesis"
          value={`${chain.linkedThesisIds.length}건`}
        />
      </div>

      {/* Beneficiaries */}
      {(chain.beneficiarySectors.length > 0 ||
        chain.beneficiaryTickers.length > 0) && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            수혜 섹터/종목
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {chain.beneficiarySectors.map((sector) => (
              <Badge key={sector} variant="outline">
                {sector}
              </Badge>
            ))}
            {chain.beneficiaryTickers.map((ticker) => (
              <Badge key={ticker} variant="secondary">
                {ticker}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Linked theses */}
      {chain.linkedThesisIds.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">
            연결된 Thesis
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {chain.linkedThesisIds.map((thesisId) => (
              <Link
                key={thesisId}
                href={`/debates?thesisId=${thesisId}`}
                className="text-sm text-primary hover:underline"
              >
                Thesis #{thesisId}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  )
}
