import { render, screen } from '@testing-library/react'

import { MarkdownContent } from './MarkdownContent'

describe('MarkdownContent', () => {
  it('renders plain text as paragraph', () => {
    render(<MarkdownContent content="단순 텍스트 내용입니다." />)

    expect(screen.getByText('단순 텍스트 내용입니다.')).toBeInTheDocument()
  })

  it('renders h1 heading', () => {
    render(<MarkdownContent content="# 제목 1" />)

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveTextContent('제목 1')
  })

  it('renders h2 heading', () => {
    render(<MarkdownContent content="## 제목 2" />)

    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveTextContent('제목 2')
  })

  it('renders h3 heading', () => {
    render(<MarkdownContent content="### 제목 3" />)

    const heading = screen.getByRole('heading', { level: 3 })
    expect(heading).toBeInTheDocument()
    expect(heading).toHaveTextContent('제목 3')
  })

  it('renders unordered list items', () => {
    render(<MarkdownContent content={'- 항목 A\n- 항목 B\n- 항목 C'} />)

    expect(screen.getByText('항목 A')).toBeInTheDocument()
    expect(screen.getByText('항목 B')).toBeInTheDocument()
    expect(screen.getByText('항목 C')).toBeInTheDocument()
  })

  it('renders ordered list items', () => {
    render(<MarkdownContent content={'1. 첫 번째\n2. 두 번째\n3. 세 번째'} />)

    expect(screen.getByText('첫 번째')).toBeInTheDocument()
    expect(screen.getByText('두 번째')).toBeInTheDocument()
    expect(screen.getByText('세 번째')).toBeInTheDocument()
  })

  it('renders bold text via strong element', () => {
    render(<MarkdownContent content="**강조 텍스트**입니다." />)

    const strong = screen.getByText('강조 텍스트')
    expect(strong.tagName).toBe('STRONG')
  })

  it('renders blockquote', () => {
    render(<MarkdownContent content="> 인용 문구입니다." />)

    const blockquote = screen.getByRole('blockquote')
    expect(blockquote).toBeInTheDocument()
    expect(blockquote).toHaveTextContent('인용 문구입니다.')
  })

  it('renders inline code', () => {
    render(<MarkdownContent content="다음 코드를 사용하세요: `const x = 1`" />)

    const code = screen.getByText('const x = 1')
    expect(code.tagName).toBe('CODE')
  })

  it('renders code block', () => {
    render(
      <MarkdownContent
        content={'```\nfunction hello() {\n  return "world"\n}\n```'}
      />,
    )

    const pre = screen.getByRole('code')
    expect(pre).toBeInTheDocument()
  })

  it('renders GFM table via remark-gfm', () => {
    const tableMarkdown = [
      '| 섹터 | RS |',
      '|------|-----|',
      '| 반도체 | 85 |',
      '| 바이오 | 72 |',
    ].join('\n')

    render(<MarkdownContent content={tableMarkdown} />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('섹터')).toBeInTheDocument()
    expect(screen.getByText('반도체')).toBeInTheDocument()
    expect(screen.getByText('바이오')).toBeInTheDocument()
  })

  it('accepts optional className prop', () => {
    const { container } = render(
      <MarkdownContent content="테스트" className="custom-class" />,
    )

    expect(container.firstChild).toHaveClass('custom-class')
  })

  it('does not render raw HTML tags as markup (XSS safe)', () => {
    render(<MarkdownContent content="<script>alert('xss')</script>" />)

    expect(screen.queryByRole('generic', { name: 'script' })).not.toBeInTheDocument()
    const scripts = document.querySelectorAll('script')
    // 문서 내 script 태그가 주입되지 않아야 함
    const injectedScript = Array.from(scripts).find(s =>
      s.textContent?.includes('xss'),
    )
    expect(injectedScript).toBeUndefined()
  })
})
