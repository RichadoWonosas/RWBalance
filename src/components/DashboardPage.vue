<script setup lang="ts">
import { currencies, type Account, type BalanceMap, type Currency, type TransactionKind } from '../core/domain/types'
import { formatMinorUnits } from '../core/domain/money'
import type { AppPage } from '../app/router'

interface DashboardTransactionRow {
  id: string
  kind: TransactionKind
  title: string
  detail: string
  exchangeSummary: string
  amount: string
}

interface DrillFilters {
  currency?: Currency
  kind?: string
  accountId?: string
}

const props = defineProps<{
  accounts: Account[]
  balances: BalanceMap
  totals: Record<Currency, { income: number; expense: number }>
  transactions: DashboardTransactionRow[]
}>()

const emit = defineEmits<{
  add: []
  navigate: [page: AppPage]
  drill: [filters: DrillFilters]
}>()

function totalBalance(currency: Currency) {
  return Object.values(props.balances).reduce((sum, item) => sum + (item[currency] ?? 0), 0)
}

function categoryBalance(pending: boolean, currency: Currency) {
  return props.accounts
    .filter((account) => account.isPendingSpend === pending)
    .reduce((sum, account) => sum + (props.balances[account.id]?.[currency] ?? 0), 0)
}
</script>

<template>
  <section class="welcome flex flex-col items-start justify-between gap-4 mobile:flex-row mobile:items-center">
    <div><span class="eyebrow">最近 30 天</span><h3>你好，这是你的资金快照。</h3><p>所有币种独立统计，不做未经确认的汇率折算。</p></div>
    <button type="button" class="primary record-button" @click="emit('add')">＋ 记录一笔</button>
  </section>

  <div class="currency-grid my-4 grid grid-cols-1 gap-4 compact:grid-cols-2 desktop:grid-cols-4">
    <article v-for="currency in currencies" :key="currency" class="metric-card">
      <span>{{ currency }}</span><strong>{{ formatMinorUnits(totalBalance(currency), currency) }}</strong>
      <div class="flex flex-wrap gap-2"><button type="button" class="metric-link income-text" @click="emit('drill', { currency, kind: 'income' })">收入 {{ formatMinorUnits(totals[currency].income, currency) }}</button><button type="button" class="metric-link expense-text" @click="emit('drill', { currency, kind: 'expense' })">支出 {{ formatMinorUnits(totals[currency].expense, currency) }}</button></div>
    </article>
  </div>

  <div class="dashboard-detail-grid grid grid-cols-1 gap-4 desktop:grid-cols-[minmax(0,1.4fr)_minmax(260px,.6fr)]">
    <section class="surface !mt-0 !mb-4">
      <div class="section-title flex items-center justify-between gap-4"><div><span class="eyebrow">BY ACCOUNT</span><h3>账户余额概览</h3></div><button type="button" class="link-button" @click="emit('navigate', 'accounts')">管理账户 →</button></div>
      <div class="dashboard-account-list mt-4 grid grid-cols-1 gap-[.65rem] compact:grid-cols-2">
        <button v-for="account in accounts" :key="account.id" type="button" class="grid gap-[.28rem] p-[.8rem]" @click="emit('drill', { accountId: account.id })"><strong>{{ account.name }}</strong><span v-for="currency in currencies.filter(item => (balances[account.id]?.[item] ?? 0) !== 0)" :key="currency">{{ formatMinorUnits(balances[account.id]?.[currency] ?? 0, currency) }}</span><small v-if="currencies.every(item => (balances[account.id]?.[item] ?? 0) === 0)">余额为 0</small></button>
      </div>
    </section>
    <section class="surface !mt-0 !mb-4"><span class="eyebrow">PURPOSE</span><h3>储蓄与待支出</h3><div class="category-balance-list my-4 grid gap-[.55rem]"><div v-for="currency in currencies" :key="currency" class="grid grid-cols-[52px_minmax(0,1fr)_minmax(0,1fr)] gap-2"><strong>{{ currency }}</strong><span>储蓄 {{ formatMinorUnits(categoryBalance(false, currency), currency) }}</span><span>待支出 {{ formatMinorUnits(categoryBalance(true, currency), currency) }}</span></div></div><button type="button" class="primary full" @click="emit('navigate', 'analytics')">打开完整统计</button></section>
  </div>

  <section class="surface">
    <div class="section-title flex items-center justify-between gap-4"><div><span class="eyebrow">RECENT ACTIVITY</span><h3>最近账目</h3></div><button type="button" class="link-button" @click="emit('navigate', 'transactions')">查看全部 →</button></div>
    <div v-if="transactions.length" class="transaction-list grid"><article v-for="transaction in transactions" :key="transaction.id" class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[.85rem] px-[.1rem] py-[.85rem]"><div class="tx-icon" :class="transaction.kind">{{ transaction.kind === 'income' ? '↙' : transaction.kind === 'expense' ? '↗' : '↔' }}</div><div><strong>{{ transaction.title }}</strong><small>{{ transaction.detail }}</small><small v-if="transaction.exchangeSummary" class="implicit-tag-summary">{{ transaction.exchangeSummary }}</small></div><b>{{ transaction.amount }}</b></article></div>
    <div v-else class="empty compact">还没有账目</div>
  </section>
</template>
