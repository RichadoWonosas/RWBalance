import { expect, test } from '@playwright/test'

async function createLedger(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /新建账本/ }).click()
  await page.getByLabel('账本名称').fill('响应式布局测试')
  await page.getByLabel('访问口令', { exact: true }).fill('test-passphrase')
  await page.getByLabel('确认口令').fill('test-passphrase')
  await page.getByRole('button', { name: '创建并进入' }).click()
  await expect(page.getByRole('heading', { name: '资金总览' })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.login-shell')).toHaveCount(0, { timeout: 15_000 })
}

test('shell remains usable across layout tiers and 200% text sizing', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Geometry regression is captured once in Chromium; the regular suite covers all configured engines.')
  await createLedger(page)

  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 760 })
    await expect(page.locator('.app-shell')).toBeVisible()
    await expect(page.locator('.currency-grid')).toBeVisible()
    const geometry = await page.evaluate(() => {
      const root = document.documentElement
      const sidebar = document.querySelector<HTMLElement>('.sidebar')!
      const content = document.querySelector<HTMLElement>('.app-content')!
      const navLabel = document.querySelector<HTMLElement>('.sidebar-button-label')!
      const sidebarStyle = getComputedStyle(sidebar)
      const contentStyle = getComputedStyle(content)
      return {
        horizontalOverflow: root.scrollWidth - root.clientWidth,
        sidebarPosition: sidebarStyle.position,
        sidebarBottom: Math.abs(root.clientHeight - sidebar.getBoundingClientRect().bottom),
        contentBottomPadding: Number.parseFloat(contentStyle.paddingBottom),
        sidebarHeight: sidebar.getBoundingClientRect().height,
        navFontSize: Number.parseFloat(getComputedStyle(navLabel).fontSize),
        navIconFontSize: Number.parseFloat(getComputedStyle(document.querySelector<HTMLElement>('.sidebar-button-icon')!).fontSize),
        currencyColumns: getComputedStyle(document.querySelector<HTMLElement>('.currency-grid')!).gridTemplateColumns.split(' ').length,
      }
    })
    expect(geometry.horizontalOverflow, `${width}px viewport has horizontal overflow`).toBeLessThanOrEqual(1)
    if (width <= 760) {
      expect(geometry.sidebarPosition).toBe('fixed')
      expect(geometry.sidebarBottom).toBeLessThanOrEqual(1)
      expect(geometry.contentBottomPadding).toBeGreaterThanOrEqual(geometry.sidebarHeight)
      expect(geometry.navFontSize).toBeGreaterThanOrEqual(12)
    } else {
      expect(geometry.sidebarPosition).toBe('sticky')
      expect(geometry.navFontSize).toBeGreaterThanOrEqual(16.8)
      expect(geometry.navIconFontSize).toBeGreaterThanOrEqual(21.5)
    }
    expect(geometry.currencyColumns).toBe(width <= 520 ? 1 : width <= 1000 ? 2 : 4)

    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '账户' }).click()
    const accountColumns = await page.locator('.account-grid').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length)
    expect(accountColumns).toBe(width <= 760 ? 1 : width <= 1000 ? 2 : 3)
    await expect(page.getByLabel('搜索', { exact: true })).toBeVisible()
    const accountFilterGeometry = await page.locator('.filter-toolbar').evaluate((toolbar) => {
      const bounds = toolbar.getBoundingClientRect()
      const labels = [...toolbar.querySelectorAll<HTMLElement>(':scope > label')].map(label => label.getBoundingClientRect())
      return {
        topPadding: Math.min(...labels.map(label => label.top)) - bounds.top,
        bottomPadding: bounds.bottom - Math.max(...labels.map(label => label.bottom)),
        equalControlBottoms: Math.max(...labels.map(label => label.bottom)) - Math.min(...labels.map(label => label.bottom)),
      }
    })
    expect(Math.abs(accountFilterGeometry.topPadding - accountFilterGeometry.bottomPadding), JSON.stringify(accountFilterGeometry)).toBeLessThan(1)
    if (width > 760) expect(accountFilterGeometry.equalControlBottoms, JSON.stringify(accountFilterGeometry)).toBeLessThan(1)

    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '统计' }).click()
    await expect(page.locator('.analytics-summary')).toBeVisible()
    const tagSummaryGap = await page.evaluate(() => {
      const tags = document.querySelector<HTMLElement>('.tag-stat-grid')!.getBoundingClientRect()
      const summary = document.querySelector<HTMLElement>('.analytics-summary')!.getBoundingClientRect()
      return summary.top - tags.bottom
    })
    expect(tagSummaryGap).toBeGreaterThanOrEqual(15)
    const analyticsColumns = await page.evaluate(() => ({
      summary: getComputedStyle(document.querySelector<HTMLElement>('.analytics-summary')!).gridTemplateColumns.split(' ').length,
      chartGroups: getComputedStyle(document.querySelector<HTMLElement>('.analytics-grid')!).gridTemplateColumns.split(' ').length,
      tagGroups: getComputedStyle(document.querySelector<HTMLElement>('.tag-stat-grid')!).gridTemplateColumns.split(' ').length,
      toolbar: getComputedStyle(document.querySelector<HTMLElement>('.analytics-toolbar')!).gridTemplateColumns.split(' ').length,
    }))
    expect(analyticsColumns.summary).toBe(width <= 520 ? 1 : width <= 1000 ? 2 : 4)
    expect(analyticsColumns.chartGroups).toBe(width <= 760 ? 1 : 2)
    expect(analyticsColumns.tagGroups).toBe(width <= 760 ? 1 : 2)
    expect(analyticsColumns.toolbar).toBe(width <= 760 ? 1 : 3)

    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '账目' }).click()
    await page.locator('.transaction-filter-toggle').click()
    const transactionColumns = await page.evaluate(() => ({
      controls: getComputedStyle(document.querySelector<HTMLElement>('.transaction-control-row')!).gridTemplateColumns.split(' ').length,
      filters: getComputedStyle(document.querySelector<HTMLElement>('.transaction-filter-grid')!).gridTemplateColumns.split(' ').length,
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }))
    expect(transactionColumns.controls).toBe(width <= 520 ? 2 : 3)
    expect(transactionColumns.filters).toBe(width <= 520 ? 1 : width <= 1200 ? 3 : 5)
    expect(transactionColumns.horizontalOverflow).toBeLessThanOrEqual(1)
    await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '总览' }).click()
  }

  await page.setViewportSize({ width: 375, height: 760 })
  await expect(page.locator('.currency-grid')).toBeVisible()
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
  await expect(page.getByRole('heading', { name: '资金总览' })).toBeVisible()
  const enlargedTextLayout = await page.evaluate(() => ({
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    offenders: [...document.querySelectorAll<HTMLElement>('body *')]
      .map(element => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.right > document.documentElement.clientWidth + 1)
      .slice(0, 8)
      .map(({ element, rect }) => `${element.tagName.toLowerCase()}.${element.className || '-'}:${Math.round(rect.right)}px`),
  }))
  expect(enlargedTextLayout.horizontalOverflow, enlargedTextLayout.offenders.join(', ')).toBeLessThanOrEqual(1)
  await page.screenshot({ path: 'test-results/responsive-layout-200-percent.png', fullPage: true })
})
