import { test, expect } from '@playwright/test'

test.describe('리포트', () => {
  test('목록 페이지 접근', async ({ page }) => {
    await page.goto('/reports')
    await expect(page.getByRole('heading', { name: '리포트' })).toBeVisible()
    await expect(
      page.getByText('일간/주간 리포트 아카이브'),
    ).toBeVisible()
  })

  test('목록 → 상세 탐색 (데이터 존재 시)', async ({ page }) => {
    await page.goto('/reports')

    const firstCard = page.locator('a[href^="/reports/"]').first()
    const hasData = (await firstCard.count()) > 0

    test.skip(!hasData, 'DB에 리포트 데이터가 없어 스킵')

    await firstCard.click()
    await expect(page).toHaveURL(/\/reports\/\d{4}-\d{2}-\d{2}/)
    await expect(page.getByText('리포트 목록')).toBeVisible()
  })

  test('상세 페이지에서 추천 종목 섹션 표시 (데이터 존재 시)', async ({ page }) => {
    await page.goto('/reports')

    const firstCard = page.locator('a[href^="/reports/"]').first()
    const hasData = (await firstCard.count()) > 0

    test.skip(!hasData, 'DB에 리포트 데이터가 없어 스킵')

    await firstCard.click()
    await expect(page.getByRole('heading', { name: '추천 종목' })).toBeVisible()
  })

  test('상세 페이지에서 실행 정보 섹션 표시 (데이터 존재 시)', async ({ page }) => {
    await page.goto('/reports')

    const firstCard = page.locator('a[href^="/reports/"]').first()
    const hasData = (await firstCard.count()) > 0

    test.skip(!hasData, 'DB에 리포트 데이터가 없어 스킵')

    await firstCard.click()
    await expect(page.getByText('실행 정보')).toBeVisible()
  })

  test('잘못된 날짜 → not found', async ({ page }) => {
    await page.goto('/reports/not-a-date')
    await expect(
      page.getByText('페이지를 찾을 수 없습니다'),
    ).toBeVisible()
  })
})
