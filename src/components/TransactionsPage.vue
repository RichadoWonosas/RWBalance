<script setup lang="ts">
import { currencies, type Account, type Tag, type Transaction } from '../core/domain/types'
import { directTags } from '../core/domain/ledger'

export interface TransactionFilters {
  bookedFrom: string; bookedTo: string; kind: string; accountId: string; currency: string; minAmount: string; maxAmount: string
  tagId: string; tagMode: string; note: string; createdFrom: string; createdTo: string; updatedFrom: string; updatedTo: string; sort: string
}

defineProps<{
  filters: TransactionFilters
  filtersExpanded: boolean
  activeFilterCount: number
  accounts: Account[]
  tags: Tag[]
  implicitTags: { id: string; name: string }[]
  orderConflictCount: number
  showDeleted: boolean
  deletedCount: number
  rows: Transaction[]
  page: number
  pageCount: number
  filterActive: (key: keyof TransactionFilters) => boolean
  titleOf: (transaction: Transaction) => string
  amountOf: (transaction: Transaction) => string
  occurredAtOf: (transaction: Transaction) => string
  tagNameOf: (tagId?: string) => string
  exchangeSummaryOf: (transaction: Transaction) => string
}>()
const emit = defineEmits<{
  'update:filtersExpanded': [value: boolean]
  'update:showDeleted': [value: boolean]
  'update:page': [value: number]
  clear: []
  order: []
  add: []
  audit: [transaction: Transaction]
  tags: [transaction: Transaction]
  correct: [transaction: Transaction]
  delete: [transactionId: string]
  recover: [transactionId: string]
}>()
</script>

<template>
  <section class="surface transaction-filter-panel sticky top-[.45rem] z-[12] !p-4 mobile:top-3">
    <div class="transaction-control-row grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 mobile:grid-cols-[minmax(0,1fr)_auto_auto] desktop:grid-cols-[minmax(220px,1fr)_minmax(150px,.55fr)_minmax(190px,.65fr)]">
      <label class="m-0">排序<select name="transaction-filters-sort" v-model="filters.sort"><option value="updated-desc">最近修改优先</option><option value="updated-asc">最早修改优先</option><option value="booked-desc">发生时间从新到旧</option><option value="booked-asc">发生时间从旧到新</option><option value="amount-desc">金额从高到低</option><option value="amount-asc">金额从低到高</option></select></label>
      <button class="ghost transaction-filter-toggle flex min-h-11 min-w-11 items-center justify-center gap-[.65rem] px-[.7rem] desktop:min-w-0 desktop:px-4" :class="{ active: activeFilterCount > 0 }" :aria-expanded="filtersExpanded" @click="emit('update:filtersExpanded', !filtersExpanded)"><span>{{ activeFilterCount ? `筛选 · ${activeFilterCount}` : '筛选' }}</span><span class="disclosure-triangle" :class="{ expanded: filtersExpanded }" aria-hidden="true"></span></button>
      <button class="ghost transaction-order-button col-span-full flex min-h-11 min-w-11 items-center justify-center gap-[.65rem] px-[.7rem] mobile:col-auto desktop:min-w-0 desktop:px-4" :aria-label="orderConflictCount ? `顺序调整向导，${orderConflictCount} 组同秒账目待调整` : '顺序调整向导'" :disabled="!orderConflictCount" @click="emit('order')"><span class="hidden mobile:inline">顺序调整向导</span><span class="mobile:hidden">顺序</span><span v-if="orderConflictCount" class="pill whitespace-nowrap">{{ orderConflictCount }} 组同秒账目</span></button>
    </div>
    <div class="collapse-shell" :class="{ open: filtersExpanded }" :inert="!filtersExpanded"><div class="collapse-content"><div class="transaction-filter-content pt-4">
      <div class="section-title"><div><span class="eyebrow">COMBINED FILTERS</span><h3>详细筛选</h3></div><button class="ghost small" :disabled="!activeFilterCount" @click="emit('clear')">清空筛选</button></div>
      <div class="transaction-filter-grid mt-4 grid grid-cols-1 gap-3 compact:grid-cols-3 wide:grid-cols-5">
        <label :class="{ 'active-filter': filterActive('bookedFrom') }">发生开始<input name="transaction-filters-booked-from" v-model="filters.bookedFrom" type="date" /></label>
        <label :class="{ 'active-filter': filterActive('bookedTo') }">发生结束<input name="transaction-filters-booked-to" v-model="filters.bookedTo" type="date" /></label>
        <label :class="{ 'active-filter': filterActive('kind') }">类型<select name="transaction-filters-kind" v-model="filters.kind"><option value="all">全部</option><option value="income">收入（含换汇）</option><option value="expense">支出（含换汇）</option><option value="transfer">转移</option></select></label>
        <label :class="{ 'active-filter': filterActive('accountId') }">账户<select name="transaction-filters-account-id" v-model="filters.accountId"><option value="">全部账户</option><option v-for="account in accounts" :key="account.id" :value="account.id">{{ account.name }}</option></select></label>
        <label :class="{ 'active-filter': filterActive('currency') }">币种<select name="transaction-filters-currency" v-model="filters.currency"><option value="">全部币种</option><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></label>
        <label :class="{ 'active-filter': filterActive('minAmount') }">最小金额<input name="transaction-filters-min-amount" v-model="filters.minAmount" type="number" min="0" /></label>
        <label :class="{ 'active-filter': filterActive('maxAmount') }">最大金额<input name="transaction-filters-max-amount" v-model="filters.maxAmount" type="number" min="0" /></label>
        <label :class="{ 'active-filter': filterActive('tagId') }">标签<select name="transaction-filters-tag-id" v-model="filters.tagId"><option value="">全部标签</option><optgroup v-if="implicitTags.length" label="换汇隐含标签"><option v-for="tag in implicitTags" :key="tag.id" :value="tag.id">{{ tag.name }}</option></optgroup><optgroup label="普通标签"><option v-for="tag in tags" :key="tag.id" :value="tag.id">{{ tagNameOf(tag.id) }}</option></optgroup></select></label>
        <label :class="{ 'active-filter': filterActive('tagMode') }">标签口径<select name="transaction-filters-tag-mode" v-model="filters.tagMode"><option value="included">包含子标签</option><option value="direct">仅直接选择</option><option value="primary">仅主标签（精确）</option><option value="primary-root">主标签按根级汇总</option></select></label>
        <label :class="{ 'active-filter': filterActive('note') }">备注关键词<input name="transaction-filters-note" v-model="filters.note" placeholder="搜索备注" /></label>
        <label :class="{ 'active-filter': filterActive('createdFrom') }">创建开始<input name="transaction-filters-created-from" v-model="filters.createdFrom" type="date" /></label>
        <label :class="{ 'active-filter': filterActive('createdTo') }">创建结束<input name="transaction-filters-created-to" v-model="filters.createdTo" type="date" /></label>
        <label :class="{ 'active-filter': filterActive('updatedFrom') }">修改开始<input name="transaction-filters-updated-from" v-model="filters.updatedFrom" type="date" /></label>
        <label :class="{ 'active-filter': filterActive('updatedTo') }">修改结束<input name="transaction-filters-updated-to" v-model="filters.updatedTo" type="date" /></label>
      </div>
    </div></div></div>
  </section>
  <section class="surface"><div class="section-title"><div><span class="eyebrow">HISTORY</span><h3>{{ showDeleted ? '已删除账目' : '有效账目' }} · {{ rows.length }} 条</h3></div><div class="app-actions"><button class="primary" @click="emit('add')">＋ 新增账目</button><button class="ghost" @click="emit('update:showDeleted', !showDeleted)">{{ showDeleted ? '查看有效账目' : `已删除 (${deletedCount})` }}</button></div></div><div class="transaction-list grid"><article v-for="tx in rows" :key="tx.id" class="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[.85rem] px-[.1rem] py-[.85rem] mobile:grid-cols-[auto_minmax(0,1fr)_auto_auto]"><div class="tx-icon" :class="tx.kind">{{ tx.kind === 'income' ? '↙' : tx.kind === 'expense' ? '↗' : '↔' }}</div><div><strong>{{ titleOf(tx) }}</strong><small>{{ occurredAtOf(tx) }} · {{ tx.note || tagNameOf(tx.primaryTagId) }}</small><small v-if="tx.selectedTagIds.length">直接：{{ directTags(tx).map(tagNameOf).join('、') }}<template v-if="tx.selectedTagIds.some(id => !directTags(tx).includes(id))"> · 继承：{{ tx.selectedTagIds.filter(id => !directTags(tx).includes(id)).map(tagNameOf).join('、') }}</template></small><small v-if="exchangeSummaryOf(tx)" class="implicit-tag-summary">{{ exchangeSummaryOf(tx) }}</small><small v-if="tx.recordRole === 'replacement'">已更正 · 原始发生时间保持不变</small></div><b>{{ amountOf(tx) }}</b><div class="transaction-row-actions col-[2/-1] flex flex-wrap items-center justify-end gap-[.35rem] mobile:col-auto"><button class="ghost small" @click="emit('audit', tx)">历史</button><button v-if="!showDeleted && tx.kind !== 'transfer'" class="ghost small" @click="emit('tags', tx)">标签</button><button v-if="!showDeleted" class="ghost small" @click="emit('correct', tx)">更正</button><button v-if="!showDeleted" class="ghost small danger-text" :aria-label="'删除账目 ' + titleOf(tx)" @click="emit('delete', tx.id)">删除</button><button v-else class="ghost small" @click="emit('recover', tx.id)">恢复</button></div></article><div v-if="!rows.length" class="empty compact">没有符合筛选条件的记录</div></div><div v-if="pageCount > 1" class="pagination mt-4 flex items-center justify-center gap-[.8rem]"><button class="ghost small" :disabled="page <= 1" @click="emit('update:page', page - 1)">上一页</button><span>第 {{ page }} / {{ pageCount }} 页</span><button class="ghost small" :disabled="page >= pageCount" @click="emit('update:page', page + 1)">下一页</button></div></section>
</template>
