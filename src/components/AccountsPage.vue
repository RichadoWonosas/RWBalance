<script setup lang="ts">
import { computed, ref } from 'vue'
import { formatMinorUnits } from '../core/domain/money'
import { currencies, type Account, type BalanceMap } from '../core/domain/types'

const props = defineProps<{ accounts: Account[]; balances: BalanceMap }>()
const emit = defineEmits<{
  add: []
  edit: [accountId: string]
  delete: [accountId: string]
  recover: [accountId: string]
}>()

const search = ref('')
const status = ref<'all' | 'active' | 'deleted'>('all')
const category = ref<'all' | 'saving' | 'pending'>('all')
const normalizeSearch = (value: string) => value.trim().normalize('NFKC').toLocaleLowerCase()

const filteredAccounts = computed(() => props.accounts.filter((account) => {
  const matchesName = normalizeSearch(account.name).includes(normalizeSearch(search.value))
  const matchesStatus = status.value === 'all' || (status.value === 'deleted' ? Boolean(account.deletedAt) : !account.deletedAt)
  const matchesCategory = category.value === 'all' || (category.value === 'pending' ? account.isPendingSpend : !account.isPendingSpend)
  return matchesName && matchesStatus && matchesCategory
}))
</script>

<template>
  <div class="section-title flex items-center justify-between gap-4"><h3>我的账户</h3><button type="button" class="primary" @click="emit('add')">＋ 添加账户</button></div>
  <section class="surface filter-toolbar grid grid-cols-1 items-end gap-[.8rem] compact:grid-cols-2 mobile:grid-cols-[minmax(220px,1fr)_150px_150px]">
    <label class="m-0 compact:col-span-2 mobile:col-span-1"><span>搜索</span><span class="search relative !m-0 block"><span class="search-icon" aria-hidden="true"></span><input name="account-search" v-model="search" placeholder="搜索账户名称" /></span></label>
    <label class="m-0">状态<select name="account-status-filter" v-model="status"><option value="all">全部</option><option value="active">正常</option><option value="deleted">已删除</option></select></label>
    <label class="m-0">余额分类<select name="account-category-filter" v-model="category"><option value="all">全部</option><option value="saving">储蓄</option><option value="pending">待支出</option></select></label>
  </section>
  <div class="account-grid my-4 grid grid-cols-1 gap-4 mobile:grid-cols-2 desktop:grid-cols-3">
    <article v-for="account in filteredAccounts" :key="account.id" class="account-card p-[1.2rem]" :class="{ muted: account.deletedAt }">
      <div class="section-title flex items-center justify-between gap-4"><div><small>{{ account.isPendingSpend ? '待支出' : '储蓄' }}</small><h3>{{ account.name }}</h3></div><span class="pill">{{ account.deletedAt ? '已删除' : '正常' }}</span></div>
      <div class="balance-lines min-h-[70px] py-[.8rem]"><div v-for="currency in currencies.filter(item => (balances[account.id]?.[item] ?? 0) !== 0)" :key="currency" class="flex justify-between py-[.3rem]"><span>{{ currency }}</span><strong>{{ formatMinorUnits(balances[account.id]?.[currency] ?? 0, currency) }}</strong></div><small v-if="currencies.every(item => (balances[account.id]?.[item] ?? 0) === 0)">所有币种余额为 0</small></div>
      <div v-if="!account.deletedAt" class="card-actions grid grid-cols-2 gap-[.6rem]"><button type="button" class="ghost" @click="emit('edit', account.id)">编辑</button><button type="button" class="danger ghost" @click="emit('delete', account.id)">删除</button></div>
      <button v-else type="button" class="ghost mt-4 w-full" @click="emit('recover', account.id)">恢复账户</button>
    </article>
  </div>
  <div v-if="!filteredAccounts.length" class="empty compact">没有符合筛选条件的账户</div>
</template>
