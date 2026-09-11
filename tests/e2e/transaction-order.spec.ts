import { expect, test } from '@playwright/test'

test('same-second modification order is draggable and filters fold independently', async ({ page }, testInfo) => {
  await page.goto('/')
  const ledgerName = await page.evaluate(async () => {
    const domain = await import(/* @vite-ignore */ '/src/core/domain/ledger.ts')
    const security = await import(/* @vite-ignore */ '/src/core/security/crypto.ts')
    const repository = await import(/* @vite-ignore */ '/src/core/data/indexed-db/repository.ts')
    const ledger = domain.createLedger('修改顺序测试')
    const account = domain.addAccount(ledger, '现金', false, { CNY: 10_000 })
    const tag = ledger.tags.find((item: { name: string }) => item.name === '饮食')!
    const draft = { kind: 'expense' as const, sourceAccountId: account.id, sourceMoney: { currency: 'CNY' as const, minorUnits: 100 }, selectedTagIds: [tag.id], primaryTagId: tag.id, bookedAt: '2026-09-12', occurredAt: '2026-09-12T12:00:00+08:00' }
    domain.addTransactions(ledger, [
      { ...draft, note: '先暂存', stagedAt: '2026-09-12T01:02:03.100Z' },
      { ...draft, note: '后暂存', stagedAt: '2026-09-12T01:02:03.900Z' },
    ])
    const container = await security.encryptLedger(ledger, 'test-passphrase')
    await repository.saveLedger(container, { ledgerId: ledger.id, displayName: ledger.name, normalizedName: ledger.name, containerVersion: container.version, updatedAt: ledger.updatedAt })
    return ledger.name
  })

  await page.reload()
  await page.locator('.ledger-card').filter({ hasText: ledgerName }).click()
  await page.getByLabel('访问口令', { exact: true }).fill('test-passphrase')
  await page.getByRole('button', { name: '解锁账本', exact: true }).click()
  await page.locator('nav button').filter({ hasText: '账目' }).click()

  const controls = page.locator('.transaction-control-row')
  await expect(controls.locator(':scope > label, :scope > button')).toHaveCount(3)
  await expect(page.locator('.transaction-filter-panel')).toHaveCSS('position', 'sticky')
  await expect(page.locator('[name="transaction-filters-kind"]')).toBeHidden()
  await page.getByRole('button', { name: /^筛选/ }).click()
  await page.locator('[name="transaction-filters-kind"]').selectOption('expense')
  await expect(page.locator('[name="transaction-filters-kind"]').locator('xpath=..')).toHaveClass(/active-filter/)
  await page.getByRole('button', { name: /^筛选/ }).click()
  await expect(page.getByRole('button', { name: /^筛选 · 1/ })).toHaveClass(/active/)

  await expect(page.locator('.transaction-list article').first()).toContainText('后暂存')
  await page.getByRole('button', { name: /顺序调整向导/ }).click()
  const wizard = page.getByRole('dialog', { name: '修改顺序调整向导' })
  await expect(wizard.locator('.transaction-order-list article')).toHaveCount(2)
  await wizard.locator('.drag-handle').first().dragTo(wizard.locator('.transaction-order-list article').nth(1))
  await expect(wizard.locator('.transaction-order-list article').first()).toContainText('先暂存')
  await wizard.locator('.transaction-order-list').evaluate(async (element) => { await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {}))) })
  await page.screenshot({ path: testInfo.outputPath('transaction-order-wizard.png'), fullPage: true })
  await wizard.getByRole('button', { name: '保存顺序' }).click()
  await expect(wizard).not.toBeVisible()
  await expect(page.locator('.transaction-list article').first()).toContainText('先暂存')
})
