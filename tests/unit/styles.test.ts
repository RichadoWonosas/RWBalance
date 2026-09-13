import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const main = read('src/styles/main.css')
const ui = read('src/styles/ui.css')
const theme = read('src/styles/theme.css')
const effects = read('src/styles/effects.css')
const motion = read('src/styles/motion.css')
const nativeControls = read('src/styles/native-controls.css')
const tailwindTheme = read('src/styles/tailwind-theme.css')
const app = read('src/App.vue')
const dashboardPage = read('src/components/DashboardPage.vue')
const accountsPage = read('src/components/AccountsPage.vue')
const analyticsPage = read('src/components/AnalyticsPage.vue')
const loginPage = read('src/components/LoginPage.vue')
const tagsPage = read('src/components/TagsPage.vue')
const transactionsPage = read('src/components/TransactionsPage.vue')
const settingsPage = read('src/components/SettingsPage.vue')
const transactionEntryDialog = read('src/components/TransactionEntryDialog.vue')
const appModal = read('src/components/AppModal.vue')

describe('stylesheet maintenance constraints', () => {
  it('defines the soft danger token for both color tones', () => {
    expect(theme.match(/--rw-color-danger-soft\s*:/g)).toHaveLength(2)
    expect(ui).toContain('background:var(--rw-color-danger-soft)')
  })

  it('uses an explicit off-white foreground in dark tone', () => {
    const darkTheme = theme.slice(theme.indexOf(":root[data-color-tone='dark']"))
    expect(darkTheme).toContain('--rw-color-text-on-primary: #eeeeee;')
    expect(darkTheme).not.toMatch(/--rw-color-text-on-primary:\s*(?:#fff(?:fff)?\b|hsl\(0\s+0%\s+100%\))/i)
  })

  it('keeps non-layout interaction feedback explicit', () => {
    expect(ui).toMatch(/button:disabled\s*\{[^}]*cursor:\s*not-allowed/)
    expect(ui).toMatch(/:focus-visible\s*\{[^}]*outline:[^}]*outline-offset:/)
  })

  it('restores semantic emphasis removed by Tailwind Preflight', () => {
    expect(ui).toContain('h1,h2,h3,h4,h5,h6 { @apply font-serif font-bold; }')
    expect(ui).toContain('strong,b,th { @apply font-bold; }')
  })

  it('has one consolidated reduced-motion policy', () => {
    const allStyles = [main, ui, theme, effects, motion, nativeControls].join('\n')
    expect(allStyles.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)/g)).toHaveLength(1)
    expect(motion).toContain('animation-delay: 0s !important')
    expect(motion).toContain('transition-delay: 0s !important')
  })

  it('keeps theme, motion and native control responsibilities separate', () => {
    expect(main).toContain('@import "./theme.css"')
    expect(main).toContain('@import "./effects.css"')
    expect(main).toContain('@import "./motion.css"')
    expect(main).toContain('@import "./native-controls.css"')
    expect(main).toContain('@import "./ui.css"')
    expect(ui).toContain('@layer base')
    expect(ui).toContain('@layer components')
    expect(theme).toContain(":root[data-color-tone='dark']")
    expect(effects).toContain('.search-icon::before')
    expect(motion).toContain('@keyframes unlock-panel-left')
    expect(nativeControls).toContain('@supports (appearance: base-select)')
  })

  it('uses project-namespaced runtime variables and a mobile-first responsive policy', () => {
    const runtimeSources = [ui, theme, effects, motion, nativeControls, app, ...[loginPage, tagsPage, transactionsPage, settingsPage, transactionEntryDialog]].join('\n')
    expect(runtimeSources).not.toMatch(/--(?:theme|color|chart|font-family|white-lightness|mobile-navigation-clearance|selected-hue|preview-color|tag-depth)-/)
    expect([ui, theme, effects, motion, nativeControls].join('\n')).not.toMatch(/@media\s*\(width\s*</)
    expect(theme).toContain('--rw-theme-primary-hue:')
    expect(appModal).toContain('trapFocus')
  })

  it('uses Tailwind theme tokens and centralized named layout tiers', () => {
    expect(main).toContain('@import "./tailwind-theme.css"')
    expect(loginPage).toContain('grid min-h-screen')
    const layoutSources = [ui, app, loginPage, dashboardPage, accountsPage, tagsPage, transactionsPage, analyticsPage, settingsPage].join('\n')
    for (const tier of ['compact', 'settings', 'mobile', 'desktop', 'wide']) {
      expect(tailwindTheme).toContain(`--breakpoint-${tier}:`)
      expect(layoutSources).toMatch(new RegExp(`(?:theme\\(--breakpoint-${tier}\\)|${tier}:)`))
    }
  })

  it('moves dashboard and account layout ownership into Tailwind page components', () => {
    expect(dashboardPage).toContain('compact:grid-cols-2 desktop:grid-cols-4')
    expect(dashboardPage).toContain('desktop:grid-cols-[minmax(0,1.4fr)_minmax(260px,.6fr)]')
    expect(accountsPage).toContain('mobile:grid-cols-2 desktop:grid-cols-3')
    expect(accountsPage).toContain('mobile:grid-cols-[minmax(220px,1fr)_150px_150px]')
    expect(ui).not.toMatch(/\.currency-grid[^\n{]*\{[^}]*grid-template-columns/)
    expect(ui).not.toMatch(/\.account-grid[^\n{]*\{[^}]*grid-template-columns/)
  })

  it('moves analytics layout ownership into Tailwind page markup', () => {
    expect(analyticsPage).toContain('compact:grid-cols-2 desktop:grid-cols-4')
    expect(analyticsPage).toContain('mobile:grid-cols-[1fr_auto_auto] mobile:items-end')
    expect(analyticsPage).toContain('compact:grid-cols-[160px_1fr]')
    expect(analyticsPage).toContain('compact:grid-cols-[minmax(90px,160px)_minmax(80px,1fr)_auto]')
    expect(ui).not.toMatch(/\.analytics-summary[^\n{]*\{[^}]*grid-template-columns/)
    expect(ui).not.toMatch(/\.analytics-grid[^\n{]*\{[^}]*grid-template-columns/)
    expect(ui).not.toMatch(/\.donut-layout[^\n{]*\{[^}]*grid-template-columns/)
  })

  it('moves transaction list, controls and filter columns into Tailwind markup', () => {
    expect(transactionsPage).toContain('compact:grid-cols-3 wide:grid-cols-5')
    expect(transactionsPage).toContain('mobile:grid-cols-[auto_minmax(0,1fr)_auto_auto]')
    expect(transactionsPage).toContain('mobile:grid-cols-[minmax(0,1fr)_auto_auto]')
    expect(ui).not.toMatch(/\.transaction-filter-grid[^\n{]*\{[^}]*grid-template-columns/)
    expect(ui).not.toMatch(/\.transaction-control-row[^\n{]*\{[^}]*grid-template-columns/)
    expect(ui).not.toMatch(/\.transaction-list article[^\n{]*\{[^}]*grid-template-columns/)
  })

  it('keeps teleported tag chips styled and tag-page layout in Tailwind markup', () => {
    expect(ui).toContain('.tag-chip {')
    expect(ui).not.toContain(':where(#app) .tag')
    expect(tagsPage).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(tagsPage).toContain('tag-management-list grid')
    expect(ui).not.toMatch(/\.tag-wizard-entry[^\n{]*\{[^}]*grid-template-columns/)
    expect(ui).not.toMatch(/\.tag-category-content>\.section-title[^\n{]*\{[^}]*grid-template-columns/)
  })

  it('moves settings page and item layout ownership into Tailwind markup', () => {
    expect(settingsPage).toContain('settings-page grid w-full gap-[.85rem]')
    expect(settingsPage).toContain('settings:grid-cols-[minmax(0,1fr)_auto] settings:gap-8')
    expect(settingsPage).toContain('settings-group-content px-[1.35rem] pb-[.35rem]')
    expect(ui).not.toMatch(/\.settings-page[^\n{]*\{[^}]*(?:display|gap|width)/)
    expect(ui).not.toMatch(/\.settings-item[^\n{]*\{[^}]*grid-template-columns/)
    expect(ui).not.toMatch(/\.timeout-setting[^\n{]*\{[^}]*grid-template-columns/)
  })

  it('keeps fixed UI clear of device safe areas and uses dynamic viewport fallbacks', () => {
    expect(ui).toContain('env(safe-area-inset-bottom)')
    expect(ui).toContain('env(safe-area-inset-left)')
    expect(ui).toContain('env(safe-area-inset-right)')
    expect(ui).toContain('env(safe-area-inset-top)')
    expect(ui).toContain('min-height:100dvh')
    expect(ui).toContain('max-height:calc(100dvh')
  })

  it('does not reintroduce remote fonts or Tailwind semantic collisions', () => {
    const allStyles = [main, ui, theme, effects, motion, nativeControls, tailwindTheme].join('\n')
    expect(allStyles).not.toContain('fonts.googleapis.com')
    expect(allStyles).not.toMatch(/\.chart-axis\s+\.grid\b/)
    expect(allStyles).not.toContain("'DM Sans'")
  })

  it('does not restore removed unused design tokens', () => {
    const allStyles = [main, ui, theme, effects, motion, nativeControls].join('\n')
    for (const token of [
      '--rw-color-expense-surface',
      '--rw-color-income-surface',
      '--rw-color-success-surface',
      '--rw-color-text-on-accent',
    ]) expect(allStyles).not.toContain(token)
  })
})
