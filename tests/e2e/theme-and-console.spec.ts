import { expect, test } from '@playwright/test'

test('search icons are vector shapes centered against their inputs', async ({ page }) => {
  await page.goto('/')
  const searchIconGeometry = await page.locator('.search').first().evaluate((search) => {
    const icon = search.querySelector<HTMLElement>('.search-icon')!
    const input = search.querySelector<HTMLInputElement>('input')!
    const iconRect = icon.getBoundingClientRect()
    const inputRect = input.getBoundingClientRect()
    const ring = getComputedStyle(icon, '::before')
    const handle = getComputedStyle(icon, '::after')
    const ringLeft = Number.parseFloat(ring.left)
    const ringTop = Number.parseFloat(ring.top)
    const ringWidth = Number.parseFloat(ring.width)
    const ringHeight = Number.parseFloat(ring.height)
    const handleLeft = Number.parseFloat(handle.left)
    const handleTop = Number.parseFloat(handle.top) + Number.parseFloat(handle.height) / 2
    const ringRadius = ringWidth / 2
    const handleDistanceFromRingCenter = Math.hypot(
      handleLeft - (ringLeft + ringWidth / 2),
      handleTop - (ringTop + ringHeight / 2),
    )
    return {
      centerDelta: Math.abs((iconRect.top + iconRect.height / 2) - (inputRect.top + inputRect.height / 2)),
      handleOverlap: ringRadius - handleDistanceFromRingCenter,
      iconText: icon.textContent,
    }
  })
  expect(searchIconGeometry.centerDelta).toBeLessThan(1)
  expect(searchIconGeometry.handleOverlap).toBeGreaterThan(0)
  expect(searchIconGeometry.iconText).toBe('')
})

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
  const sidebarLabelStarts = await page.locator('.sidebar .sidebar-button-label').evaluateAll(labels => labels.map(label => label.getBoundingClientRect().left))
  expect(Math.max(...sidebarLabelStarts) - Math.min(...sidebarLabelStarts)).toBeLessThan(1)
  await page.locator('nav button').filter({ hasText: '标签' }).click()
  const incomeCategory = page.locator('.tag-category-group').filter({ hasText: 'INCOME TAGS' })
  const titleSpacing = await incomeCategory.locator('.tag-category-title').evaluate((title) => {
    const eyebrow = title.querySelector<HTMLElement>('.eyebrow')!.getBoundingClientRect()
    const heading = title.querySelector<HTMLElement>('.tag-category-heading')!.getBoundingClientRect()
    return heading.top - eyebrow.bottom
  })
  expect(titleSpacing).toBeGreaterThanOrEqual(4)
  const filterAlignment = await incomeCategory.locator('.section-title').evaluate((row) => {
    const input = row.querySelector<HTMLInputElement>('input')!.getBoundingClientRect()
    const button = row.querySelector<HTMLButtonElement>('button')!.getBoundingClientRect()
    return Math.abs((input.top + input.height / 2) - (button.top + button.height / 2))
  })
  expect(filterAlignment).toBeLessThan(1)
  for (let round = 0; round < 2; round++) {
    for (const name of ['账户', '标签', '账目', '统计', '设置', '总览']) {
      await page.locator('nav button').filter({ hasText: name }).click()
      await expect(page.locator('input:not([id]):not([name]),select:not([id]):not([name]),textarea:not([id]):not([name])')).toHaveCount(0)
    }
  }
  await expect(page.locator('.welcome p')).toHaveCSS('color', 'rgb(255, 255, 255)')
  await page.locator('nav button').filter({ hasText: '设置' }).click()
  await page.getByRole('button', { name: /外观/ }).click()
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
  await expect(page.locator('.theme-entry .disclosure-triangle')).toHaveCSS('background-color', /rgb\(153, 17[89], 255\)/)
  await page.getByRole('button', { name: /暂离/ }).click()
  await expect(page.getByRole('heading', { name: '选择一个账本' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '选择一个账本' })).toBeVisible()
  expect(errors).toEqual([])
  expect(issues.filter(issue => issue.includes('FormFieldHasEmptyIdAndNameAttributes'))).toEqual([])
})
