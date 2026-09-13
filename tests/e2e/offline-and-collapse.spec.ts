import { expect, test } from '@playwright/test'

async function createLedger(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: /新建账本/ }).click()
  await page.getByLabel('账本名称').fill(name)
  await page.getByLabel('访问口令', { exact: true }).fill('test-passphrase')
  await page.getByLabel('确认口令').fill('test-passphrase')
  await page.getByRole('button', { name: '创建并进入' }).click()
  await expect(page.getByRole('heading', { name: '资金总览' })).toBeVisible({ timeout: 15_000 })
}

test('external-network-free flow keeps login, ledger and analytics layouts usable', async ({ page }) => {
  const externalRequests: string[] = []
  await page.route(/^https?:\/\//, async route => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') await route.continue()
    else { externalRequests.push(url.href); await route.abort('internetdisconnected') }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: '选择一个账本' })).toBeVisible()
  await createLedger(page, '离线布局测试')
  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '统计' }).click()
  await expect(page.locator('.analytics-summary')).toBeVisible()
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    font: getComputedStyle(document.body).fontFamily,
    surfaceWidth: document.querySelector<HTMLElement>('.analytics-summary')?.getBoundingClientRect().width ?? 0,
  }))
  expect(layout.overflow).toBeLessThanOrEqual(1)
  expect(layout.surfaceWidth).toBeGreaterThan(0)
  expect(layout.font).not.toMatch(/DM Sans|Noto Serif SC/i)
  await page.getByRole('button', { name: /暂离/ }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: '选择一个账本' })).toBeVisible()
  expect(externalRequests).toEqual([])
})

test('collapse shells have zero closed height and keep focus rings inside padded content', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Collapse geometry is engine-independent and sampled in Chromium.')
  await page.goto('/')
  await createLedger(page, '折叠布局测试')

  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '标签' }).click()
  const tagGroup = page.locator('.tag-category-group').first()
  const tagShell = tagGroup.locator(':scope > .collapse-shell')
  const tagContent = tagShell.locator(':scope > .collapse-content')
  await expect.poll(() => tagShell.evaluate(shell => Math.abs(shell.getBoundingClientRect().height - (shell.firstElementChild as HTMLElement).scrollHeight))).toBeLessThan(1)
  expect(await tagContent.evaluate(content => ({ top: getComputedStyle(content).paddingTop, bottom: getComputedStyle(content).paddingBottom }))).toEqual({ top: '0px', bottom: '0px' })
  const tagSearch = tagGroup.locator('input').first()
  await tagSearch.focus()
  const focusInset = await tagSearch.evaluate(input => {
    const inputBox = input.getBoundingClientRect()
    const contentBox = input.closest<HTMLElement>('.collapse-content')!.getBoundingClientRect()
    return inputBox.top - contentBox.top
  })
  expect(focusInset).toBeGreaterThanOrEqual(3)
  await tagGroup.locator('.settings-group-trigger').click()
  await expect.poll(() => tagShell.evaluate(shell => shell.getBoundingClientRect().height)).toBeLessThan(1)

  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '账目' }).click()
  const transactionShell = page.locator('.transaction-filter-panel > .collapse-shell')
  await expect.poll(() => transactionShell.evaluate(shell => shell.getBoundingClientRect().height)).toBeLessThan(1)
  await page.locator('.transaction-filter-toggle').click()
  expect(await transactionShell.locator(':scope > .collapse-content').evaluate(content => Number.parseFloat(getComputedStyle(content).paddingTop))).toBe(0)
  await expect.poll(() => transactionShell.evaluate(shell => Math.abs(shell.getBoundingClientRect().height - (shell.firstElementChild as HTMLElement).scrollHeight))).toBeLessThan(1)

  await page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '设置' }).click()
  for (const shell of await page.locator('.settings-group > .collapse-shell').all()) {
    expect(await shell.locator(':scope > .collapse-content').evaluate(content => Number.parseFloat(getComputedStyle(content).paddingTop))).toBe(0)
  }
})
