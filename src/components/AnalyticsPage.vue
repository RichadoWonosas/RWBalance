<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { currencies, type Currency, type Transaction } from '../core/domain/types'
import { currencyRules, formatMinorUnits } from '../core/domain/money'
import type { LedgerView } from '../worker/protocol'

const props = defineProps<{ ledger: LedgerView; primaryHue: number; secondaryHue: number }>()
const emit = defineEmits<{ drill: [filters: { currency?: Currency; kind?: string; accountId?: string; tagId?: string }] }>()
type RangePreset = '30' | '90' | 'year' | 'custom'
const preset = ref<RangePreset>('30')
const customFrom = ref('')
const customTo = ref(new Date().toISOString().slice(0, 10))
const chartCurrency = ref<Currency>('CNY')
const exportOpen = ref(false)
const redactExport = ref(true)
const reportCanvas = ref<HTMLCanvasElement>()

function isoDaysAgo(days: number) { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - days); return date.toISOString().slice(0, 10) }
const range = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  if (preset.value === 'custom') return { from: customFrom.value || isoDaysAgo(29), to: customTo.value || today }
  if (preset.value === 'year') return { from: `${new Date().getFullYear()}-01-01`, to: today }
  return { from: isoDaysAgo(Number(preset.value) - 1), to: today }
})
const transactions = computed(() => props.ledger.normalTransactions.filter((tx) => tx.bookedAt >= range.value.from && tx.bookedAt <= range.value.to))
const amountFor = (tx: Transaction) => tx.kind === 'income' ? tx.destinationMoney : tx.sourceMoney
const totals = computed(() => Object.fromEntries(currencies.map((currency) => [currency, transactions.value.reduce((sum, tx) => {
  const money = amountFor(tx)
  if (money?.currency !== currency) return sum
  if (tx.kind === 'income') sum.income += money.minorUnits
  if (tx.kind === 'expense') sum.expense += money.minorUnits
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
    const money = amountFor(tx)
    if (money?.currency !== chartCurrency.value || tx.kind === 'transfer') continue
    const row = rows.get(tx.bookedAt) ?? { date: tx.bookedAt, income: 0, expense: 0 }
    row[tx.kind] += money.minorUnits
    rows.set(tx.bookedAt, row)
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date))
})
const trendMax = computed(() => Math.max(1, ...trend.value.flatMap((row) => [row.income, row.expense])))
function trendPoints(kind: 'income' | 'expense') { return trend.value.map((row, index) => `${trend.value.length < 2 ? 50 : index / (trend.value.length - 1) * 100},${94 - row[kind] / trendMax.value * 84}`).join(' ') }
const tagTotals = computed(() => {
  const primary = new Map<string, number>(); const included = new Map<string, number>()
  for (const tx of transactions.value) {
    if (tx.kind !== 'expense' || tx.sourceMoney?.currency !== chartCurrency.value) continue
    if (tx.primaryTagId) primary.set(tx.primaryTagId, (primary.get(tx.primaryTagId) ?? 0) + tx.sourceMoney.minorUnits)
    for (const tagId of tx.selectedTagIds) included.set(tagId, (included.get(tagId) ?? 0) + tx.sourceMoney.minorUnits)
  }
  const rank = (map: Map<string, number>) => [...map].map(([tagId, value]) => ({ tagId, name: props.ledger.tags.find((tag) => tag.id === tagId)?.name ?? '系统标签', value })).sort((a, b) => b.value - a.value)
  return { primary: rank(primary), included: rank(included) }
})
const donutGradient = computed(() => {
  const rows = tagTotals.value.primary; const total = rows.reduce((sum, row) => sum + row.value, 0)
  if (!total) return 'conic-gradient(var(--color-neutral-surface) 0 100%)'
  let cursor = 0
  return `conic-gradient(${rows.map((row, index) => { const start = cursor; cursor += row.value / total * 100; return `hsl(${(props.primaryHue + index * 37) % 360} 68% 52%) ${start}% ${cursor}%` }).join(',')})`
})
const exchangeRows = computed(() => transactions.value.filter((tx) => tx.kind === 'transfer' && tx.sourceMoney && tx.destinationMoney && tx.sourceMoney.currency !== tx.destinationMoney.currency && tx.sourceMoney.minorUnits > 0).map((tx) => ({
  id: tx.id, date: tx.bookedAt, pair: `${tx.sourceMoney!.currency}/${tx.destinationMoney!.currency}`,
  rate: (tx.destinationMoney!.minorUnits / 10 ** currencyRules[tx.destinationMoney!.currency].fractionDigits) / (tx.sourceMoney!.minorUnits / 10 ** currencyRules[tx.sourceMoney!.currency].fractionDigits),
})).sort((a, b) => a.date.localeCompare(b.date)))
const exchangePairs = computed(() => [...new Set(exchangeRows.value.map((row) => row.pair))])
const exchangePair = ref('')
watch(exchangePairs, (pairs) => { if (!pairs.includes(exchangePair.value)) exchangePair.value = pairs[0] ?? '' }, { immediate: true })
const selectedExchange = computed(() => exchangeRows.value.filter((row) => row.pair === exchangePair.value))
const exchangePoints = computed(() => { const rows = selectedExchange.value; const values = rows.map((row) => row.rate); const min = Math.min(...values, 0); const max = Math.max(...values, 1); return rows.map((row, index) => `${rows.length < 2 ? 50 : index / (rows.length - 1) * 100},${94 - (row.rate - min) / Math.max(1e-9, max - min) * 84}`).join(' ') })

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
  y += 18; heading('主标签 / 任意包含标签排行')
  for (const mode of ['primary', 'included'] as const) { line(mode === 'primary' ? '主标签口径' : '任意包含口径', ''); const max = Math.max(1, ...tagTotals.value[mode].map((row) => row.value)); tagTotals.value[mode].forEach((row) => line(redactExport.value ? tagAliases.get(row.tagId) ?? '系统标签' : row.name, redactExport.value ? relative(row.value, max) : formatMinorUnits(row.value, chartCurrency.value), row.value / max)) }
  y += 18; heading('换汇隐含汇率')
  if (!exchangeRows.value.length) line('所选范围内没有跨币种转移', '')
  exchangeRows.value.forEach((row, index) => line(redactExport.value ? `换汇记录 ${index + 1}` : `${row.date} · ${row.pair}`, redactExport.value ? '保留相对趋势' : `1 ${row.pair.split('/')[0]} ≈ ${row.rate.toFixed(6)} ${row.pair.split('/')[1]}`))
}
async function openExport() { exportOpen.value = true; await drawReport() }
watch(redactExport, () => { if (exportOpen.value) void drawReport() })
async function savePng() { await drawReport(); reportCanvas.value?.toBlob((blob) => { if (!blob) return; const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `RWBalance-${redactExport.value ? 'redacted' : 'full'}-${Date.now()}.png`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }, 'image/png') }
</script>

<template>
  <section class="analytics-toolbar surface"><div><span class="eyebrow">ANALYTICS RANGE</span><h3>{{ range.from }} — {{ range.to }}</h3></div><div class="range-buttons"><button v-for="item in ([['30','近 30 天'],['90','近 90 天'],['year','今年'],['custom','自定义']] as const)" :key="item[0]" class="ghost small" :class="{ selected: preset === item[0] }" @click="preset = item[0]">{{ item[1] }}</button></div><div v-if="preset === 'custom'" class="custom-range"><label>开始<input v-model="customFrom" type="date" /></label><label>结束<input v-model="customTo" type="date" /></label></div><button class="primary" @click="openExport">导出统计 PNG</button></section>
  <div class="analytics-summary">
    <button v-for="currency in currencies" :key="currency" class="metric-card" @click="emit('drill',{ currency })"><span>{{ currency }}</span><strong>{{ formatMinorUnits(totals[currency].income - totals[currency].expense, currency) }}</strong><small>收入 {{ formatMinorUnits(totals[currency].income, currency) }} · 支出 {{ formatMinorUnits(totals[currency].expense, currency) }}</small><small>储蓄 {{ formatMinorUnits(categoryBalances[currency].saving, currency) }} · 待支出 {{ formatMinorUnits(categoryBalances[currency].pending, currency) }}</small></button>
  </div>
  <section class="surface"><div class="section-title"><div><span class="eyebrow">ACCOUNT BALANCES</span><h3>总体余额</h3></div><select v-model="chartCurrency" class="compact-select"><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></div><div class="bar-chart"><button v-for="row in accountBars" :key="row.account.id" @click="emit('drill',{ accountId:row.account.id,currency:chartCurrency })"><span>{{ row.account.name }}</span><i :style="{ width:`${row.value / maxAccountBalance * 100}%` }"></i><b>{{ formatMinorUnits(row.value, chartCurrency) }}</b></button></div><details><summary>查看等价数据表</summary><table><tbody><tr v-for="row in accountBars" :key="row.account.id"><th>{{ row.account.name }}</th><td>{{ formatMinorUnits(row.value, chartCurrency) }}</td></tr></tbody></table></details></section>
  <div class="analytics-grid">
    <section class="surface"><span class="eyebrow">CASH FLOW</span><h3>收支趋势 · {{ chartCurrency }}</h3><svg class="line-chart" viewBox="0 0 100 100" role="img" aria-label="收入与支出趋势图"><polyline class="income-line" :points="trendPoints('income')"/><polyline class="expense-line" :points="trendPoints('expense')"/></svg><div class="chart-legend"><span class="income-dot">收入</span><span class="expense-dot">支出</span></div><details><summary>查看等价数据表</summary><table><thead><tr><th>日期</th><th>收入</th><th>支出</th></tr></thead><tbody><tr v-for="row in trend" :key="row.date"><td>{{ row.date }}</td><td>{{ formatMinorUnits(row.income,chartCurrency) }}</td><td>{{ formatMinorUnits(row.expense,chartCurrency) }}</td></tr></tbody></table></details></section>
    <section class="surface"><span class="eyebrow">PRIMARY TAGS</span><h3>支出类型圆环图 · {{ chartCurrency }}</h3><div class="donut-layout"><div class="donut" :style="{ background:donutGradient }"><span>{{ tagTotals.primary.length }} 类</span></div><ol><li v-for="row in tagTotals.primary" :key="row.tagId"><button @click="emit('drill',{ tagId:row.tagId,currency:chartCurrency })">{{ row.name }}</button><b>{{ formatMinorUnits(row.value,chartCurrency) }}</b></li></ol></div><details><summary>查看等价数据表</summary><table><tbody><tr v-for="row in tagTotals.primary" :key="row.tagId"><th>{{ row.name }}</th><td>{{ formatMinorUnits(row.value,chartCurrency) }}</td></tr></tbody></table></details></section>
  </div>
  <div class="analytics-grid"><section v-for="mode in (['primary','included'] as const)" :key="mode" class="surface"><span class="eyebrow">TAG RANKING</span><h3>{{ mode === 'primary' ? '主标签支出排行' : '任意包含标签支出排行' }}</h3><ol class="rank-list"><li v-for="row in tagTotals[mode]" :key="row.tagId"><button @click="emit('drill',{ tagId:row.tagId,currency:chartCurrency })">{{ row.name }}</button><i :style="{ width:`${row.value / Math.max(1,...tagTotals[mode].map(item=>item.value)) * 100}%` }"></i><b>{{ formatMinorUnits(row.value,chartCurrency) }}</b></li><li v-if="!tagTotals[mode].length">暂无支出</li></ol></section></div>
  <section class="surface"><div class="section-title"><div><span class="eyebrow">EXCHANGE RATE</span><h3>银行换汇隐含汇率</h3></div><select v-model="exchangePair" class="compact-select"><option v-for="pair in exchangePairs" :key="pair">{{ pair }}</option></select></div><svg v-if="selectedExchange.length" class="line-chart exchange" viewBox="0 0 100 100" role="img" :aria-label="`${exchangePair} 隐含汇率趋势图`"><polyline :points="exchangePoints"/></svg><div v-else class="empty compact">所选范围内没有跨币种转移</div><details v-if="selectedExchange.length"><summary>查看等价数据表</summary><table><thead><tr><th>日期</th><th>方向</th><th>隐含汇率</th></tr></thead><tbody><tr v-for="row in selectedExchange" :key="row.id"><td>{{ row.date }}</td><td>{{ row.pair }}</td><td>{{ row.rate.toFixed(8) }}</td></tr></tbody></table></details></section>
  <Transition name="modal-motion"><div v-if="exportOpen" class="modal-backdrop" @click.self="exportOpen=false"><section class="modal export-modal"><button class="modal-close" @click="exportOpen=false">×</button><span class="eyebrow">EXPORT PREVIEW</span><h2>统计图片预览</h2><label class="privacy-toggle"><input v-model="redactExport" type="checkbox" />启用关键信息脱敏（默认）</label><p v-if="!redactExport" class="export-warning">警告：图片将包含真实账本名称、账户、标签、金额和日期。</p><div class="canvas-preview"><canvas ref="reportCanvas"></canvas></div><div class="modal-actions"><button class="ghost" @click="exportOpen=false">取消</button><button class="primary" @click="savePng">保存 PNG</button></div></section></div></Transition>
</template>
