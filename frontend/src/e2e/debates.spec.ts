import { test, expect } from '@playwright/test'

test.describe('토론 아카이브', () => {
  test('목록 페이지 접근', async ({ page }) => {
    await page.goto('/debates')
    await expect(page.getByRole('heading', { name: '토론' })).toBeVisible()
    await expect(
      page.getByText('애널리스트 토론 세션 아카이브'),
    ).toBeVisible()
  })

  test('목록 → 상세 탐색', async ({ page }) => {
    await page.goto('/debates')

    const firstCard = page.locator('a[href^="/debates/"]').first()
    await firstCard.click()

    await expect(page).toHaveURL(/\/debates\/\d{4}-\d{2}-\d{2}/)
  })

  test('토론 상세 탭 전환', async ({ page }) => {
    await page.goto('/debates')

    const firstCard = page.locator('a[href^="/debates/"]').first()
    await firstCard.click()

    const tabs = page.getByRole('tablist')
    await expect(tabs).toBeVisible()
  })

  test('상세 페이지에서 토론 목록으로 복귀', async ({ page }) => {
    await page.goto('/debates')

    const firstCard = page.locator('a[href^="/debates/"]').first()
    await firstCard.click()

    const backLink = page.getByText('토론 목록')
    await expect(backLink).toBeVisible()
    await backLink.click()

    await expect(page).toHaveURL(/\/debates$/)
  })

  test('잘못된 날짜 → not found', async ({ page }) => {
    await page.goto('/debates/not-a-date')
    await expect(
      page.getByText('페이지를 찾을 수 없습니다'),
    ).toBeVisible()
  })
})
