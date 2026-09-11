<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { rootTagId, tagPath } from '../core/domain/tag-hierarchy'
import { vBackdropDismiss } from '../app/backdrop-dismiss'
import { currencies, type Currency } from '../core/domain/types'
import { currencyRules, formatMinorUnits } from '../core/domain/money'
import { implicitTagName, isImplicitTagId, transactionStatisticalFlows } from '../core/domain/statistics'
import type { LedgerView } from '../worker/protocol'

const props = defineProps<{ ledger: LedgerView; primaryHue: number; secondaryHue: number }>()
const emit = defineEmits<{ drill: [filters: { currency?: Currency; kind?: string; accountId?: string; tagId?: string; tagMode?: string; bookedFrom?: string; bookedTo?: string }] }>()
type RangePreset = '30' | '90' | 'year' | 'custom'
const preset = ref<RangePreset>('30')
const customFrom = ref('')
function localCalendarDate(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}
const customTo = ref(localCalendarDate())
const chartCurrency = ref<Currency>('CNY')
const primaryGrouping = ref<'exact' | 'root'>('exact')
const exportOpen = ref(false)
const redactExport = ref(true)
const reportCanvas = ref<HTMLCanvasElement>()
const trendHoverIndex = ref<number | null>(null)
const exchangeHoverIndex = ref<number | null>(null)
const donutHoverId = ref<string | null>(null)
type DataTableKey = 'accounts' | 'trend' | 'donut' | 'exchange'
const openDataTables = reactive<Record<DataTableKey, boolean>>({ accounts: false, trend: false, donut: false, exchange: false })

const CHART_WIDTH = 600
const CHART_HEIGHT = 240
const PLOT_LEFT = 58
const PLOT_RIGHT = 590
const PLOT_TOP = 18
const PLOT_BOTTOM = 200

function isoDaysAgo(days: number) { const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - days); return localCalendarDate(date) }
const range = computed(() => {
  const today = localCalendarDate()
  if (preset.value === 'custom') return { from: customFrom.value || isoDaysAgo(29), to: customTo.value || today }
  if (preset.value === 'year') return { from: `${new Date().getFullYear()}-01-01`, to: today }
  return { from: isoDaysAgo(Number(preset.value) - 1), to: today }
})
const transactions = computed(() => props.ledger.normalTransactions.filter((tx) => tx.bookedAt >= range.value.from && tx.bookedAt <= range.value.to))
const flows = computed(() => transactions.value.flatMap(transactionStatisticalFlows))
const totals = computed(() => Object.fromEntries(currencies.map((currency) => [currency, flows.value.reduce((sum, flow) => {
  if (flow.money.currency !== currency) return sum
  sum[flow.kind] += flow.money.minorUnits
  return sum
}, { income: 0, expense: 0 })])) as Record<Currency, { income: number; expense: number }>)
const categoryBalances = computed(() => Object.fromEntries(currencies.map((currency) => [currency, props.ledger.accounts.reduce((result, account) => {
  if (account.deletedAt) return result
  const amount = props.ledger.balances[account.id]?.[currency] ?? 0
  if (account.isPendingSpend) result.pending += amount
  else result.saving += amount
  return result
}, { saving: 0, pending: 0 })])) as Record<Currency, { saving: number; pending: number }>)
const accountBars = computed(() => props.ledger.accounts.filter((account) => !account.deletedAt).map((account) => ({ account, value: props.ledger.balances[account.id]?.[chartCurrency.value] ?? 0 })))
const maxAccountBalance = computed(() => Math.max(1, ...accountBars.value.map((item) => item.value)))
const trend = computed(() => {
  const rows = new Map<string, { date: string; income: number; expense: number }>()
  for (const tx of transactions.value) {
    for (const flow of transactionStatisticalFlows(tx)) {
      if (flow.money.currency !== chartCurrency.value) continue
      const row = rows.get(tx.bookedAt) ?? { date: tx.bookedAt, income: 0, expense: 0 }
      row[flow.kind] += flow.money.minorUnits
      rows.set(tx.bookedAt, row)
    }
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date))
})
const trendMax = computed(() => Math.max(1, ...trend.value.flatMap((row) => [row.income, row.expense])))
const hoveredTrendRow = computed(() => trendHoverIndex.value === null ? undefined : trend.value[trendHoverIndex.value])
const plotX = (index: number, count: number) => count < 2 ? (PLOT_LEFT + PLOT_RIGHT) / 2 : PLOT_LEFT + index / (count - 1) * (PLOT_RIGHT - PLOT_LEFT)
const trendY = (_kind: 'income' | 'expense', value: number) => PLOT_BOTTOM - value / trendMax.value * (PLOT_BOTTOM - PLOT_TOP)
function trendPoints(kind: 'income' | 'expense') { return trend.value.map((row, index) => `${plotX(index, trend.value.length)},${trendY(kind, row[kind])}`).join(' ') }
function nearestChartIndex(event: PointerEvent, count: number) {
  if (!count) return null
  const rect = (event.currentTarget as SVGSVGElement).getBoundingClientRect()
  const chartX = (event.clientX - rect.left) / rect.width * CHART_WIDTH
  const ratio = Math.max(0, Math.min(1, (chartX - PLOT_LEFT) / (PLOT_RIGHT - PLOT_LEFT)))
  return count === 1 ? 0 : Math.round(ratio * (count - 1))
}
function chartTooltipLeft(index: number, count: number) {
  const percent = plotX(index, count) / CHART_WIDTH * 100
  return `${Math.max(13, Math.min(87, percent))}%`
}
function compactAmount(value: number, currency: Currency) {
  const major = value / 10 ** currencyRules[currency].fractionDigits
  return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(major)
}
const tagTotals = computed(() => {
  const primary = new Map<string, number>(); const included = new Map<string, number>()
  for (const tx of transactions.value) {
    for (const flow of transactionStatisticalFlows(tx)) {
      if (flow.kind !== 'expense' || flow.money.currency !== chartCurrency.value) continue
      if (flow.primaryTagId) {
        const id = primaryGrouping.value === 'root' && !isImplicitTagId(flow.primaryTagId) ? rootTagId(props.ledger.tags, flow.primaryTagId) : flow.primaryTagId
        primary.set(id, (primary.get(id) ?? 0) + flow.money.minorUnits)
      }
      for (const tagId of flow.tagIds) included.set(tagId, (included.get(tagId) ?? 0) + flow.money.minorUnits)
    }
  }
  const rank = (map: Map<string, number>) => [...map].map(([tagId, value]) => ({ tagId, name: implicitTagName(tagId) ?? (tagPath(props.ledger.tags, tagId) || '系统标签'), value })).sort((a, b) => b.value - a.value)
  return { primary: rank(primary), included: rank(included) }
})
function polarPoint(radius: number, angle: number) {
  return { x: 60 + radius * Math.cos(angle), y: 60 + radius * Math.sin(angle) }
}
function donutPath(start: number, end: number) {
  const outerRadius = 42
  const innerRadius = 25
  const sweep = end - start
  if (sweep >= Math.PI * 2 - 0.0001) {
    return `M 60 ${60 - outerRadius} A ${outerRadius} ${outerRadius} 0 1 1 60 ${60 + outerRadius} A ${outerRadius} ${outerRadius} 0 1 1 60 ${60 - outerRadius} M 60 ${60 - innerRadius} A ${innerRadius} ${innerRadius} 0 1 0 60 ${60 + innerRadius} A ${innerRadius} ${innerRadius} 0 1 0 60 ${60 - innerRadius}`
  }
  const outerStart = polarPoint(outerRadius, start)
  const outerEnd = polarPoint(outerRadius, end)
  const innerEnd = polarPoint(innerRadius, end)
  const innerStart = polarPoint(innerRadius, start)
  const largeArc = sweep > Math.PI ? 1 : 0
  return `M ${outerStart.x} ${outerStart.y} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y} L ${innerEnd.x} ${innerEnd.y} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y} Z`
}
const donutSlices = computed(() => {
  const rows = tagTotals.value.primary
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  let cursor = -Math.PI / 2
  return rows.map((row, index) => {
    const start = cursor
    const ratio = total ? row.value / total : 0
    cursor += ratio * Math.PI * 2
    return { ...row, percent: ratio * 100, path: donutPath(start, cursor), color: `hsl(${(props.primaryHue + index * 37) % 360} var(--chart-segment-saturation) var(--chart-segment-lightness))` }
  })
})
const hoveredDonutSlice = computed(() => donutSlices.value.find((slice) => slice.tagId === donutHoverId.value))
const exchangeRows = computed(() => transactions.value.filter((tx) => tx.kind === 'transfer' && tx.sourceMoney && tx.destinationMoney && tx.sourceMoney.currency !== tx.destinationMoney.currency && tx.sourceMoney.minorUnits > 0).map((tx) => ({
  id: tx.id, date: tx.bookedAt, pair: `${tx.sourceMoney!.currency}/${tx.destinationMoney!.currency}`,
  expense: tx.sourceMoney!, income: tx.destinationMoney!, primaryLabel: '换汇',
  expenseLabel: transactionStatisticalFlows(tx).find(flow => flow.kind === 'expense')?.label ?? '换汇支出',
  incomeLabel: transactionStatisticalFlows(tx).find(flow => flow.kind === 'income')?.label ?? '换汇收入',
  rate: (tx.destinationMoney!.minorUnits / 10 ** currencyRules[tx.destinationMoney!.currency].fractionDigits) / (tx.sourceMoney!.minorUnits / 10 ** currencyRules[tx.sourceMoney!.currency].fractionDigits),
})).sort((a, b) => a.date.localeCompare(b.date)))
const exchangePairs = computed(() => [...new Set(exchangeRows.value.map((row) => row.pair))])
const exchangePair = ref('')
watch(exchangePairs, (pairs) => { if (!pairs.includes(exchangePair.value)) exchangePair.value = pairs[0] ?? '' }, { immediate: true })
const selectedExchange = computed(() => exchangeRows.value.filter((row) => row.pair === exchangePair.value))
const hoveredExchangeRow = computed(() => exchangeHoverIndex.value === null ? undefined : selectedExchange.value[exchangeHoverIndex.value])
const exchangeBounds = computed(() => {
  const values = selectedExchange.value.map((row) => row.rate)
  return { min: Math.min(...values), max: Math.max(...values) }
})
const exchangePoints = computed(() => {
  const rows = selectedExchange.value
  return rows.map((row, index) => `${plotX(index, rows.length)},${exchangeY(row.rate)}`).join(' ')
})
function exchangeY(rate: number) {
  const spread = exchangeBounds.value.max - exchangeBounds.value.min
  return spread <= Number.EPSILON ? (PLOT_TOP + PLOT_BOTTOM) / 2 : PLOT_BOTTOM - (rate - exchangeBounds.value.min) / spread * (PLOT_BOTTOM - PLOT_TOP)
}
function compactRate(value: number) { return Number.isFinite(value) ? new Intl.NumberFormat('zh-CN', { maximumSignificantDigits: 4 }).format(value) : '—' }

function aliasMap<T extends { id: string }>(items: T[], prefix: string) { return new Map(items.map((item, index) => [item.id, `${prefix} ${index + 1}`])) }
function relative(value: number, max: number) { return `相对值 ${Math.round(value / Math.max(1, max) * 100)}%` }
async function drawReport() {
  await nextTick()
  const canvas = reportCanvas.value; if (!canvas) return
  const accountAliases = aliasMap(props.ledger.accounts, '账户'); const tagAliases = aliasMap(props.ledger.tags, '标签')
  const rows = currencies.length * 2 + accountBars.value.length + trend.value.length + tagTotals.value.primary.length + tagTotals.value.included.length + exchangeRows.value.length
  canvas.width = 1200; canvas.height = Math.max(1050, 780 + rows * 34)
  const context = canvas.getContext('2d'); if (!context) return
  const primary = `hsl(${props.primaryHue} 68% 48%)`; const secondary = `hsl(${props.secondaryHue} 72% 52%)`
  context.fillStyle = 'hsl(260 24% 98%)'; context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = primary; context.fillRect(0, 0, 18, canvas.height)
  context.fillStyle = 'hsl(260 18% 15%)'; context.font = '700 40px sans-serif'; context.fillText(redactExport.value ? 'RW Balance · 已脱敏统计' : `${props.ledger.name} · 统计`, 58, 78)
  context.font = '20px sans-serif'; context.fillStyle = 'hsl(260 8% 45%)'; context.fillText(redactExport.value ? '所选时间范围' : `${range.value.from} — ${range.value.to}`, 58, 116)
  let y = 170
  const heading = (text: string) => { context.fillStyle = secondary; context.font = '700 24px sans-serif'; context.fillText(text, 58, y); y += 38 }
  const line = (left: string, right: string, ratio = 0) => { context.fillStyle = 'hsl(260 18% 20%)'; context.font = '18px sans-serif'; context.fillText(left, 64, y); context.fillText(right, 760, y); if (ratio > 0) { context.fillStyle = primary; context.fillRect(930, y - 14, 190 * ratio, 12) } y += 32 }
  heading('分币种收支与余额分类')
  const maxTotal = Math.max(1, ...currencies.flatMap((currency) => [totals.value[currency].income, totals.value[currency].expense]))
  currencies.forEach((currency) => {
    line(currency, redactExport.value ? `${relative(totals.value[currency].income, maxTotal)} / ${relative(totals.value[currency].expense, maxTotal)}` : `收入 ${formatMinorUnits(totals.value[currency].income, currency)} · 支出 ${formatMinorUnits(totals.value[currency].expense, currency)}`)
    line('  储蓄 / 待支出', redactExport.value ? `${relative(categoryBalances.value[currency].saving, Math.max(1,categoryBalances.value[currency].saving,categoryBalances.value[currency].pending))} / ${relative(categoryBalances.value[currency].pending, Math.max(1,categoryBalances.value[currency].saving,categoryBalances.value[currency].pending))}` : `${formatMinorUnits(categoryBalances.value[currency].saving,currency)} / ${formatMinorUnits(categoryBalances.value[currency].pending,currency)}`)
  })
  y += 18; heading(`${chartCurrency.value} 账户余额`)
  accountBars.value.forEach(({ account, value }) => line(redactExport.value ? accountAliases.get(account.id)! : account.name, redactExport.value ? relative(value, maxAccountBalance.value) : formatMinorUnits(value, chartCurrency.value), value / maxAccountBalance.value))
  y += 18; heading(`${chartCurrency.value} 收支趋势`)
  trend.value.forEach((row,index) => line(redactExport.value ? `时间点 ${index + 1}` : row.date, redactExport.value ? `${relative(row.income,trendMax.value)} / ${relative(row.expense,trendMax.value)}` : `收入 ${formatMinorUnits(row.income,chartCurrency.value)} · 支出 ${formatMinorUnits(row.expense,chartCurrency.value)}`))
  y += 18; heading(primaryGrouping.value === 'root' ? '主标签按根级汇总 / 包含子标签排行' : '精确主标签 / 包含子标签排行')
  for (const mode of ['primary', 'included'] as const) { line(mode === 'primary' ? '主标签口径' : '任意包含口径', ''); const max = Math.max(1, ...tagTotals.value[mode].map((row) => row.value)); tagTotals.value[mode].forEach((row) => line(redactExport.value ? tagAliases.get(row.tagId) ?? '系统标签' : row.name, redactExport.value ? relative(row.value, max) : formatMinorUnits(row.value, chartCurrency.value), row.value / max)) }
  y += 18; heading('换汇隐含汇率')
  if (!exchangeRows.value.length) line('所选范围内没有跨币种转移', '')
  exchangeRows.value.forEach((row, index) => line(redactExport.value ? `换汇记录 ${index + 1}` : `${row.date} · ${row.pair}`, redactExport.value ? '保留相对趋势' : `1 ${row.pair.split('/')[0]} ≈ ${row.rate.toFixed(6)} ${row.pair.split('/')[1]}`))
}
function drillTag(tagId: string, mode: 'primary' | 'included') {
  emit('drill', { tagId, currency: chartCurrency.value, kind: 'expense', tagMode: mode === 'included' ? 'included' : primaryGrouping.value === 'root' ? 'primary-root' : 'primary', bookedFrom: range.value.from, bookedTo: range.value.to })
}
async function openExport() { exportOpen.value = true; await drawReport() }
watch(redactExport, () => { if (exportOpen.value) void drawReport() })
async function savePng() { await drawReport(); reportCanvas.value?.toBlob((blob) => { if (!blob) return; const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `RWBalance-${redactExport.value ? 'redacted' : 'full'}-${Date.now()}.png`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }, 'image/png') }
</script>

<template>
  <section class="analytics-toolbar surface"><div><span class="eyebrow">ANALYTICS RANGE</span><h3>{{ range.from }} — {{ range.to }}</h3></div><div class="range-buttons"><button v-for="item in ([['30','近 30 天'],['90','近 90 天'],['year','今年'],['custom','自定义']] as const)" :key="item[0]" class="ghost small" :class="{ selected: preset === item[0] }" @click="preset = item[0]">{{ item[1] }}</button></div><div v-if="preset === 'custom'" class="custom-range"><label>开始<input name="custom-from" v-model="customFrom" type="date" /></label><label>结束<input name="custom-to" v-model="customTo" type="date" /></label></div><button class="primary" @click="openExport">导出统计 PNG</button></section>
  <div class="analytics-summary">
    <button v-for="currency in currencies" :key="currency" class="metric-card" @click="emit('drill',{ currency })"><span>{{ currency }}</span><strong>{{ formatMinorUnits(totals[currency].income - totals[currency].expense, currency) }}</strong><small>收入 {{ formatMinorUnits(totals[currency].income, currency) }} · 支出 {{ formatMinorUnits(totals[currency].expense, currency) }}</small><small>储蓄 {{ formatMinorUnits(categoryBalances[currency].saving, currency) }} · 待支出 {{ formatMinorUnits(categoryBalances[currency].pending, currency) }}</small></button>
  </div>
  <section class="surface"><div class="section-title"><div><span class="eyebrow">ACCOUNT BALANCES</span><h3>总体余额</h3></div><select name="chart-currency" aria-label="统计币种" v-model="chartCurrency" class="compact-select"><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></div><div class="bar-chart"><button v-for="row in accountBars" :key="row.account.id" @click="emit('drill',{ accountId:row.account.id,currency:chartCurrency })"><span>{{ row.account.name }}</span><i :style="{ width:`${row.value / maxAccountBalance * 100}%` }"></i><b>{{ formatMinorUnits(row.value, chartCurrency) }}</b></button></div><div class="data-table-disclosure"><button class="data-table-trigger" :aria-expanded="openDataTables.accounts" @click="openDataTables.accounts = !openDataTables.accounts">查看等价数据表<span class="disclosure-triangle" :class="{ expanded: openDataTables.accounts }" aria-hidden="true"></span></button><div class="collapse-shell" :class="{ open: openDataTables.accounts }" :inert="!openDataTables.accounts"><div class="collapse-content"><table><tbody><tr v-for="row in accountBars" :key="row.account.id"><th>{{ row.account.name }}</th><td>{{ formatMinorUnits(row.value, chartCurrency) }}</td></tr></tbody></table></div></div></div></section>
  <div class="analytics-grid">
    <section class="surface">
      <span class="eyebrow">CASH FLOW</span><h3>收支趋势 · {{ chartCurrency }}</h3>
      <div class="chart-stage">
        <svg class="line-chart" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" aria-label="收入与支出趋势图" @pointermove="trendHoverIndex = nearestChartIndex($event, trend.length)" @pointerleave="trendHoverIndex = null">
          <g class="chart-axis"><line class="grid" :x1="PLOT_LEFT" :y1="(PLOT_TOP + PLOT_BOTTOM) / 2" :x2="PLOT_RIGHT" :y2="(PLOT_TOP + PLOT_BOTTOM) / 2"/><line :x1="PLOT_LEFT" :y1="PLOT_TOP" :x2="PLOT_LEFT" :y2="PLOT_BOTTOM"/><line :x1="PLOT_LEFT" :y1="PLOT_BOTTOM" :x2="PLOT_RIGHT" :y2="PLOT_BOTTOM"/><text :x="PLOT_LEFT - 8" :y="PLOT_TOP + 4" text-anchor="end">{{ compactAmount(trendMax, chartCurrency) }}</text><text :x="PLOT_LEFT - 8" :y="PLOT_BOTTOM + 4" text-anchor="end">0</text><text :x="PLOT_LEFT" :y="PLOT_BOTTOM + 25">{{ range.from.slice(5) }}</text><text :x="PLOT_RIGHT" :y="PLOT_BOTTOM + 25" text-anchor="end">{{ range.to.slice(5) }}</text></g>
          <line v-if="trendHoverIndex !== null" class="hover-guide" :x1="plotX(trendHoverIndex, trend.length)" :x2="plotX(trendHoverIndex, trend.length)" :y1="PLOT_TOP" :y2="PLOT_BOTTOM"/>
          <polyline class="income-line" :points="trendPoints('income')"/><polyline class="expense-line" :points="trendPoints('expense')"/>
          <circle v-for="(row,index) in trend" :key="`income-${row.date}`" class="data-point income-point" :class="{ active: trendHoverIndex === index }" :cx="plotX(index,trend.length)" :cy="trendY('income',row.income)" r="4"/><circle v-for="(row,index) in trend" :key="`expense-${row.date}`" class="data-point expense-point" :class="{ active: trendHoverIndex === index }" :cx="plotX(index,trend.length)" :cy="trendY('expense',row.expense)" r="4"/>
        </svg>
        <div v-if="trendHoverIndex !== null && hoveredTrendRow" class="chart-tooltip" :style="{ left: chartTooltipLeft(trendHoverIndex, trend.length) }"><strong>{{ hoveredTrendRow.date }}</strong><span class="income-text">收入 {{ formatMinorUnits(hoveredTrendRow.income, chartCurrency) }}</span><span class="expense-text">支出 {{ formatMinorUnits(hoveredTrendRow.expense, chartCurrency) }}</span></div>
      </div>
      <div class="chart-legend"><span class="income-dot">收入</span><span class="expense-dot">支出</span></div><div class="data-table-disclosure"><button class="data-table-trigger" :aria-expanded="openDataTables.trend" @click="openDataTables.trend = !openDataTables.trend">查看等价数据表<span class="disclosure-triangle" :class="{ expanded: openDataTables.trend }" aria-hidden="true"></span></button><div class="collapse-shell" :class="{ open: openDataTables.trend }" :inert="!openDataTables.trend"><div class="collapse-content"><table><thead><tr><th>日期</th><th>收入</th><th>支出</th></tr></thead><tbody><tr v-for="row in trend" :key="row.date"><td>{{ row.date }}</td><td>{{ formatMinorUnits(row.income,chartCurrency) }}</td><td>{{ formatMinorUnits(row.expense,chartCurrency) }}</td></tr></tbody></table></div></div></div>
    </section>
    <section class="surface">
      <span class="eyebrow">PRIMARY TAGS</span><h3>支出类型圆环图 · {{ chartCurrency }}</h3><label>主标签统计口径<select name="primary-grouping" v-model="primaryGrouping"><option value="exact">精确主标签</option><option value="root">按根级祖先汇总</option></select></label><p class="field-help">每笔支出仅计入一个扇区，父子标签不重复计费。</p>
      <div class="donut-layout"><div class="donut-shell"><svg class="donut-chart" viewBox="0 0 120 120" role="img" aria-label="主标签支出比例图"><circle v-if="!donutSlices.length" class="donut-empty" cx="60" cy="60" r="33.5"/><path v-for="slice in donutSlices" :key="slice.tagId" class="donut-slice" :class="{ hovered: donutHoverId === slice.tagId }" :d="slice.path" :fill="slice.color" fill-rule="evenodd" tabindex="0" @mouseenter="donutHoverId = slice.tagId" @mouseleave="donutHoverId = null" @focus="donutHoverId = slice.tagId" @blur="donutHoverId = null"><title>{{ slice.name }}：{{ slice.percent.toFixed(1) }}%</title></path><text class="donut-count" x="60" y="64" text-anchor="middle">{{ tagTotals.primary.length }} 类</text></svg><div v-if="hoveredDonutSlice" class="chart-tooltip donut-tooltip"><strong>{{ hoveredDonutSlice.name }}</strong><span>{{ formatMinorUnits(hoveredDonutSlice.value, chartCurrency) }}</span><span>{{ hoveredDonutSlice.percent.toFixed(1) }}%</span></div></div><ol><li v-for="row in tagTotals.primary" :key="row.tagId" @mouseenter="donutHoverId = row.tagId" @mouseleave="donutHoverId = null"><button @focus="donutHoverId = row.tagId" @blur="donutHoverId = null" @click="drillTag(row.tagId, 'primary')">{{ row.name }}</button><b>{{ formatMinorUnits(row.value,chartCurrency) }}</b></li></ol></div>
      <div class="data-table-disclosure"><button class="data-table-trigger" :aria-expanded="openDataTables.donut" @click="openDataTables.donut = !openDataTables.donut">查看等价数据表<span class="disclosure-triangle" :class="{ expanded: openDataTables.donut }" aria-hidden="true"></span></button><div class="collapse-shell" :class="{ open: openDataTables.donut }" :inert="!openDataTables.donut"><div class="collapse-content"><table><tbody><tr v-for="row in tagTotals.primary" :key="row.tagId"><th>{{ row.name }}</th><td>{{ formatMinorUnits(row.value,chartCurrency) }}</td></tr></tbody></table></div></div></div>
    </section>
  </div>
  <div class="analytics-grid"><section v-for="mode in (['primary','included'] as const)" :key="mode" class="surface"><span class="eyebrow">TAG RANKING</span><h3>{{ mode === 'primary' ? (primaryGrouping === 'root' ? '主标签按根级汇总' : '精确主标签支出排行') : '包含子标签支出排行（跨标签不可相加）' }}</h3><ol class="rank-list"><li v-for="row in tagTotals[mode]" :key="row.tagId"><button @click="drillTag(row.tagId, mode)">{{ row.name }}</button><i :style="{ width:`${row.value / Math.max(1,...tagTotals[mode].map(item=>item.value)) * 100}%` }"></i><b>{{ formatMinorUnits(row.value,chartCurrency) }}</b></li><li v-if="!tagTotals[mode].length">暂无支出</li></ol></section></div>
  <section class="surface"><div class="section-title"><div><span class="eyebrow">EXCHANGE RATE</span><h3>银行换汇隐含汇率</h3></div><select name="exchange-pair" aria-label="换汇币种对" v-model="exchangePair" class="compact-select"><option v-for="pair in exchangePairs" :key="pair">{{ pair }}</option></select></div><div v-if="selectedExchange.length" class="chart-stage"><svg class="line-chart exchange" :viewBox="`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`" role="img" :aria-label="`${exchangePair} 隐含汇率趋势图`" @pointermove="exchangeHoverIndex = nearestChartIndex($event, selectedExchange.length)" @pointerleave="exchangeHoverIndex = null"><g class="chart-axis"><line class="grid" :x1="PLOT_LEFT" :y1="(PLOT_TOP + PLOT_BOTTOM) / 2" :x2="PLOT_RIGHT" :y2="(PLOT_TOP + PLOT_BOTTOM) / 2"/><line :x1="PLOT_LEFT" :y1="PLOT_TOP" :x2="PLOT_LEFT" :y2="PLOT_BOTTOM"/><line :x1="PLOT_LEFT" :y1="PLOT_BOTTOM" :x2="PLOT_RIGHT" :y2="PLOT_BOTTOM"/><text :x="PLOT_LEFT - 8" :y="PLOT_TOP + 4" text-anchor="end">{{ compactRate(exchangeBounds.max) }}</text><text :x="PLOT_LEFT - 8" :y="PLOT_BOTTOM + 4" text-anchor="end">{{ compactRate(exchangeBounds.min) }}</text><text :x="PLOT_LEFT" :y="PLOT_BOTTOM + 25">{{ selectedExchange[0]?.date.slice(5) }}</text><text :x="PLOT_RIGHT" :y="PLOT_BOTTOM + 25" text-anchor="end">{{ selectedExchange.at(-1)?.date.slice(5) }}</text></g><line v-if="exchangeHoverIndex !== null" class="hover-guide" :x1="plotX(exchangeHoverIndex, selectedExchange.length)" :x2="plotX(exchangeHoverIndex, selectedExchange.length)" :y1="PLOT_TOP" :y2="PLOT_BOTTOM"/><polyline :points="exchangePoints"/><circle v-for="(row,index) in selectedExchange" :key="row.id" class="data-point exchange-point" :class="{ active: exchangeHoverIndex === index }" :cx="plotX(index,selectedExchange.length)" :cy="exchangeY(row.rate)" r="4"/></svg><div v-if="exchangeHoverIndex !== null && hoveredExchangeRow" class="chart-tooltip" :style="{ left: chartTooltipLeft(exchangeHoverIndex, selectedExchange.length) }"><strong>{{ hoveredExchangeRow.date }} · {{ hoveredExchangeRow.pair }}</strong><span>汇率 {{ hoveredExchangeRow.rate.toFixed(8) }}</span><span>{{ formatMinorUnits(hoveredExchangeRow.expense.minorUnits, hoveredExchangeRow.expense.currency) }} → {{ formatMinorUnits(hoveredExchangeRow.income.minorUnits, hoveredExchangeRow.income.currency) }}</span></div></div><div v-else class="empty compact">所选范围内没有跨币种转移</div><div v-if="selectedExchange.length" class="data-table-disclosure"><button class="data-table-trigger" :aria-expanded="openDataTables.exchange" @click="openDataTables.exchange = !openDataTables.exchange">查看换汇资金流与等价数据<span class="disclosure-triangle" :class="{ expanded: openDataTables.exchange }" aria-hidden="true"></span></button><div class="collapse-shell" :class="{ open: openDataTables.exchange }" :inert="!openDataTables.exchange"><div class="collapse-content"><table><thead><tr><th>日期</th><th>方向</th><th>支出（隐含标签）</th><th>收入（隐含标签）</th><th>主标签</th><th>隐含汇率</th></tr></thead><tbody><tr v-for="row in selectedExchange" :key="row.id"><td>{{ row.date }}</td><td>{{ row.pair }}</td><td>{{ formatMinorUnits(row.expense.minorUnits, row.expense.currency) }} · {{ row.expenseLabel }}</td><td>{{ formatMinorUnits(row.income.minorUnits, row.income.currency) }} · {{ row.incomeLabel }}</td><td>{{ row.primaryLabel }}</td><td>{{ row.rate.toFixed(8) }}</td></tr></tbody></table></div></div></div></section>
  <Transition name="modal-motion"><div v-if="exportOpen" class="modal-backdrop" v-backdrop-dismiss="() => { exportOpen = false }"><section class="modal export-modal"><button class="modal-close" @click="exportOpen=false">×</button><span class="eyebrow">EXPORT PREVIEW</span><h2>统计图片预览</h2><label class="privacy-toggle"><input name="redact-export" v-model="redactExport" type="checkbox" />启用关键信息脱敏（默认）</label><p v-if="!redactExport" class="export-warning">警告：图片将包含真实账本名称、账户、标签、金额和日期。</p><div class="canvas-preview"><canvas ref="reportCanvas"></canvas></div><div class="modal-actions"><button class="ghost" @click="exportOpen=false">取消</button><button class="primary" @click="savePng">保存 PNG</button></div></section></div></Transition>
</template>
