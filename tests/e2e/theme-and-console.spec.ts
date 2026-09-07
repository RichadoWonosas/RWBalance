import { expect, test } from '@playwright/test'

test('login and repeated page navigation have named fields and no uncaught errors', async ({ page, browserName }) => {
  const errors: string[] = []
  const issues: string[] = []
  page.on('pageerror', error => errors.push(error.stack || error.message))
  const cdp = browserName === 'chromium' ? await page.context().newCDPSession(page) : undefined
  cdp?.on('Audits.issueAdded', ({ issue }) => issues.push(JSON.stringify(issue)))
  await cdp?.send('Audits.enable')
  await page.goto('/')
  await page.getByPlaceholder('搜索本机账本').fill('不存在的账本')
  await page.getByPlaceholder('搜索本机账本').fill('')
  await page.getByRole('button', { name: /导入账本/ }).click()
  await page.getByRole('button', { name: '关闭对话框' }).click()
  await page.getByRole('button', { name: /新建账本/ }).click()
  await page.getByLabel('账本名称').fill('色彩测试')
  await page.getByLabel('访问口令', { exact: true }).fill('test-passphrase')
  await page.getByLabel('确认口令').fill('test-passphrase')
  await page.getByRole('button', { name: '创建并进入' }).click()
  await expect(page.getByRole('heading', { name: '资金总览' })).toBeVisible()
  for (let round = 0; round < 2; round++) {
    for (const name of ['账户', '标签', '账目', '统计', '设置', '总览']) {
      await page.locator('nav button').filter({ hasText: name }).click()
      await expect(page.locator('input:not([id]):not([name]),select:not([id]):not([name]),textarea:not([id]):not([name])')).toHaveCount(0)
    }
  }
  await expect(page.locator('.welcome p')).toHaveCSS('color', 'rgb(255, 255, 255)')
  await page.locator('nav button').filter({ hasText: '设置' }).click()
  await page.locator('.theme-entry').click()
  for (const hue of [0, 60, 120, 180, 225, 270, 330]) {
    await page.getByLabel('色相角度').fill(String(hue))
    await expect(page.locator('.hue-channel-tabs i').first()).toHaveAttribute('style', /66%/)
  }
  await page.getByRole('button', { name: '保存到当前账本' }).click()
  const toneSwitch = page.getByRole('checkbox', { name: '切换亮暗色调' })
  await expect(toneSwitch).toBeEnabled()
  await page.locator('.tone-switch').click()
  await expect(toneSwitch).toBeChecked()
  await expect(toneSwitch).toBeEnabled()
  await page.getByRole('button', { name: /暂离/ }).click()
  await expect(page.getByRole('heading', { name: '选择一个账本' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '选择一个账本' })).toBeVisible()
  expect(errors).toEqual([])
  expect(issues.filter(issue => issue.includes('FormFieldHasEmptyIdAndNameAttributes'))).toEqual([])
})
