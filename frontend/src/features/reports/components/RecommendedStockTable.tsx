'use client'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/shared/components/ui/table'

import type { ReportedStock } from '../types'

interface RecommendedStockTableProps {
  stocks: ReportedStock[]
}

export function RecommendedStockTable({ stocks }: RecommendedStockTableProps) {
  if (stocks.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        추천 종목이 없습니다
      </div>
    )
  }

  const sortedStocks = [...stocks].sort((a, b) => b.rsScore - a.rsScore)

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>종목코드</TableHead>
            <TableHead className="text-center">Phase</TableHead>
            <TableHead className="text-center">이전 Phase</TableHead>
            <TableHead className="text-right">RS 점수</TableHead>
            <TableHead>섹터</TableHead>
            <TableHead>산업</TableHead>
            <TableHead>최초 보고일</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedStocks.map((stock) => (
            <TableRow key={stock.symbol}>
              <TableCell className="font-medium">{stock.symbol}</TableCell>
              <TableCell className="text-center">{stock.phase}</TableCell>
              <TableCell className="text-center">
                {stock.prevPhase != null ? stock.prevPhase : '-'}
              </TableCell>
              <TableCell className="text-right">
                {stock.rsScore.toFixed(1)}
              </TableCell>
              <TableCell>{stock.sector}</TableCell>
              <TableCell>{stock.industry}</TableCell>
              <TableCell>{stock.firstReportedDate}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
