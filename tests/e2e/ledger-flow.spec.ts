import { expect, test } from '@playwright/test'

test('creates, configures, locks and unlocks a local ledger', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /新建账本/ }).click()
  await page.getByLabel('账本名称').fill('E2E 本地账本')
  await page.getByLabel('访问口令', { exact: true }).fill('test-passphrase')
  await page.getByLabel('确认口令').fill('test-passphrase')
  await page.getByRole('button', { name: '创建并进入' }).click()
  await expect(page.getByText('资金总览')).toBeVisible({ timeout: 15_000 })
  await page.locator('nav').getByRole('button', { name: /设置/ }).click()
  await expect(page.getByRole('heading', { name: '加密方式', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /暂离/ }).click()
  await expect(page.getByText('选择一个账本')).toBeVisible({ timeout: 5_000 })
  await page.locator('.ledger-card').filter({ hasText: 'E2E 本地账本' }).click()
  await page.getByLabel('访问口令').fill('test-passphrase')
  await page.getByRole('button', { name: '解锁账本' }).click()
  await expect(page.getByRole('heading', { name: '账本设置', exact: true })).toBeVisible({ timeout: 15_000 })
})

test('maintains readable contrast for primary text on surfaces', async ({ page }) => {
  await page.goto('/')
  const ratio = await page.locator('.ledger-panel').evaluate((element) => {
    const style = getComputedStyle(element)
    const parse = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number)
    const luminance = (rgb: number[]) => rgb.map((channel) => { const value = channel / 255; return value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4 }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0)
    const foreground = luminance(parse(style.color)); const background = luminance(parse(style.backgroundColor))
    return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05)
  })
  expect(ratio).toBeGreaterThanOrEqual(4.5)
})
