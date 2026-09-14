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

test('keyboard focus remains visible and reduced motion is immediate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await page.keyboard.press('Tab')

  const focused = page.locator(':focus-visible')
  await expect(focused).toHaveCount(1)
  expect(await focused.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset,
      transitionDurations: style.transitionDuration.split(',').map(value => Number.parseFloat(value) || 0),
      animationDurations: style.animationDuration.split(',').map(value => Number.parseFloat(value) || 0),
    }
  })).toEqual(expect.objectContaining({
    outlineStyle: 'solid',
    outlineWidth: '2px',
    outlineOffset: '2px',
    transitionDurations: expect.arrayContaining([0.00001]),
    animationDurations: expect.arrayContaining([0.00001]),
  }))
})

test('non-sidebar neutral actions regain visible hover feedback', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /新建账本/ }).click()
  const action = page.getByRole('button', { name: /高级设置/ })
  const initial = await action.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    shadow: getComputedStyle(element).boxShadow,
  }))
  await action.hover()
  await expect.poll(async () => action.evaluate((element) => ({
    background: getComputedStyle(element).backgroundColor,
    shadow: getComputedStyle(element).boxShadow,
  }))).not.toEqual(initial)
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
  const semanticWeights = await page.locator('.app-content :is(h1,h2,h3,h4,h5,h6,strong,b,th):visible').evaluateAll(elements => elements.map(element => ({
    text: element.textContent?.trim().slice(0, 32),
    weight: Number.parseInt(getComputedStyle(element).fontWeight, 10),
  })))
  expect(semanticWeights.filter(item => item.weight < 700), JSON.stringify(semanticWeights)).toEqual([])
  if ((page.viewportSize()?.width ?? 0) > 760) {
    const sidebarLabelStarts = await page.locator('.sidebar .sidebar-button-label').evaluateAll(labels => labels.map(label => label.getBoundingClientRect().left))
    expect(Math.max(...sidebarLabelStarts) - Math.min(...sidebarLabelStarts)).toBeLessThan(1)
  }
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
  const securityGroup = page.locator('.settings-group').filter({ hasText: 'LEDGER & SECURITY' })
  const securityShell = securityGroup.locator(':scope > .collapse-shell')
  expect(await securityShell.locator(':scope > .collapse-content').evaluate(content => Number.parseFloat(getComputedStyle(content).paddingBottom))).toBe(0)
  await expect.poll(async () => securityShell.evaluate((shell) => {
    const content = shell.firstElementChild as HTMLElement
    return Math.abs(shell.getBoundingClientRect().height - content.scrollHeight)
  })).toBeLessThan(1)
  const settingsItemColumns = await securityGroup.locator('.settings-item').first().evaluate(item => getComputedStyle(item).gridTemplateColumns.split(' ').length)
  expect(settingsItemColumns).toBe((page.viewportSize()?.width ?? 0) > 681 ? 2 : 1)
  await page.getByRole('button', { name: /外观/ }).click()
  await expect.poll(async () => securityShell.evaluate(shell => shell.getBoundingClientRect().height)).toBeLessThan(1)
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
  const darkToneWhiteText = await page.locator('body *:visible').evaluateAll(elements => elements
    .filter(element => [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()))
    .filter(element => getComputedStyle(element).color === 'rgb(255, 255, 255)')
    .map(element => `${element.tagName.toLowerCase()}.${element.className || '-'}:${element.textContent?.trim().slice(0, 40)}`))
  expect(darkToneWhiteText).toEqual([])
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--rw-color-text-on-primary').trim())).toBe('#eeeeee')
  await expect(page.locator('.theme-entry .disclosure-triangle')).toHaveCSS('background-color', /rgb\(153, 17[89], 255\)/)
  await page.getByRole('button', { name: /暂离/ }).click()
  await expect(page.getByRole('heading', { name: '选择一个账本' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: '选择一个账本' })).toBeVisible()
  expect(errors).toEqual([])
  expect(issues.filter(issue => issue.includes('FormFieldHasEmptyIdAndNameAttributes'))).toEqual([])
})
