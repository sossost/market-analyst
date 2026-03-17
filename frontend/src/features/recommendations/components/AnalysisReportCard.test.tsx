import React from 'react'
import { render, screen } from '@testing-library/react'

import type { AnalysisReport } from '../types'
import { AnalysisReportCard } from './AnalysisReportCard'

function createAnalysisReport(
  overrides: Partial<AnalysisReport> = {},
): AnalysisReport {
  return {
    id: 1,
    symbol: 'NVDA',
    recommendationDate: '2026-03-14',
    investmentSummary: '투자 포인트 요약 내용',
    technicalAnalysis: '기술적 분석 내용',
    fundamentalTrend: '실적 트렌드 내용',
    valuationAnalysis: '밸류에이션 분석 내용',
    sectorPositioning: '섹터·업종 포지셔닝 내용',
    marketContext: '시장 맥락 내용',
    riskFactors: '리스크 요인 내용',
    earningsCallHighlights: null,
    generatedAt: '2026-03-14T10:00:00+00:00',
    ...overrides,
  }
}

describe('AnalysisReportCard', () => {
  describe('report가 null인 경우', () => {
    it('아무것도 렌더링하지 않는다', () => {
      const { container } = render(<AnalysisReportCard report={null} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('report가 있는 경우', () => {
    it('섹션 헤더 "기업 분석 리포트"를 렌더링한다', () => {
      render(<AnalysisReportCard report={createAnalysisReport()} />)
      expect(screen.getByText('기업 분석 리포트')).toBeInTheDocument()
    })

    it('7개 섹션 제목을 모두 렌더링한다', () => {
      render(<AnalysisReportCard report={createAnalysisReport()} />)

      expect(screen.getByText('투자 포인트 요약')).toBeInTheDocument()
      expect(screen.getByText('기술적 분석')).toBeInTheDocument()
      expect(screen.getByText('실적 트렌드')).toBeInTheDocument()
      expect(screen.getByText('밸류에이션 분석')).toBeInTheDocument()
      expect(screen.getByText('섹터·업종 포지셔닝')).toBeInTheDocument()
      expect(screen.getByText('시장 맥락')).toBeInTheDocument()
      expect(screen.getByText('리스크 요인')).toBeInTheDocument()
    })

    it('earningsCallHighlights가 null이면 어닝콜 섹션을 렌더링하지 않는다', () => {
      render(<AnalysisReportCard report={createAnalysisReport({ earningsCallHighlights: null })} />)

      expect(screen.queryByText('어닝콜 하이라이트')).not.toBeInTheDocument()
    })

    it('earningsCallHighlights가 있으면 어닝콜 섹션을 렌더링한다', () => {
      render(
        <AnalysisReportCard
          report={createAnalysisReport({ earningsCallHighlights: 'CEO가 가이던스를 상향했다' })}
        />,
      )

      expect(screen.getByText('어닝콜 하이라이트')).toBeInTheDocument()
      expect(screen.getByText('CEO가 가이던스를 상향했다')).toBeInTheDocument()
    })

    it('generatedAt 날짜를 한국어 형식으로 표시한다', () => {
      render(
        <AnalysisReportCard
          report={createAnalysisReport({ generatedAt: '2026-03-14T10:00:00+00:00' })}
        />,
      )
      expect(screen.getByText('생성일: 2026년 3월 14일')).toBeInTheDocument()
    })

    it('각 섹션의 콘텐츠를 렌더링한다', () => {
      const report = createAnalysisReport({
        investmentSummary: '핵심 투자 포인트',
        riskFactors: '주요 리스크 항목',
      })

      render(<AnalysisReportCard report={report} />)

      expect(screen.getByText('핵심 투자 포인트')).toBeInTheDocument()
      expect(screen.getByText('주요 리스크 항목')).toBeInTheDocument()
    })
  })
})
