<script setup lang="ts">
import type { LedgerIndexEntry } from '../core/data/indexed-db/repository'

type SessionTransition = 'idle' | 'unlocking' | 'locking'

defineProps<{
  show: boolean
  transition: SessionTransition
  missingCapabilities: string[]
  indexes: LedgerIndexEntry[]
  search: string
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  create: []
  unlock: [ledgerId: string]
  rename: [entry: LedgerIndexEntry]
  delete: [ledgerId: string, displayName: string]
  import: []
}>()
</script>

<template>
  <main
    v-if="show"
    class="login-shell grid min-h-screen bg-app-page mobile:grid-cols-[minmax(0,.85fr)_minmax(0,1.15fr)]"
    :class="{ 'login-transition-layer': transition !== 'idle', 'is-unlocking': transition === 'unlocking', 'is-locking': transition === 'locking' }"
  >
    <section class="login-hero relative isolate flex min-h-[36vh] flex-col justify-center overflow-hidden bg-app-primary px-6 py-12 text-[var(--rw-color-text-on-primary)] mobile:min-h-0 mobile:px-[8vw] mobile:py-[11vh] desktop:pt-[2.5vh] desktop:pb-[17.5vh]">
      <span class="eyebrow">LOCAL · PRIVATE · YOURS</span>
      <h1 class="max-w-[620px] text-[clamp(2.5rem,5vw,5.4rem)] leading-[1.13] tracking-[-.055em]">把每一笔<br class="desktop-title-break hidden mobile:block">资金，<br><em>讲成清楚的故事。</em></h1>
      <p class="max-w-[490px] leading-[1.8]">数据只保存在这台设备。账本加密后进入 IndexedDB，无需账户、网络或云端。</p>
    </section>
    <section class="ledger-panel relative isolate flex flex-col justify-start bg-app-surface px-[1.2rem] py-10 mobile:justify-center mobile:px-[8vw] mobile:py-[10vh]">
      <div v-if="missingCapabilities.length" class="capability-warning" role="alert"><strong>此浏览器无法安全运行 RW Balance</strong><span>缺少：{{ missingCapabilities.join('、') }}。请升级浏览器后再使用。</span></div>
      <div class="panel-title flex items-start justify-between gap-4 compact:items-center"><div><span class="eyebrow">YOUR LEDGERS</span><h2>选择一个账本</h2></div><button class="primary" @click="emit('create')">＋ 新建账本</button></div>
      <label class="search relative my-8 mb-4"><span class="search-icon" aria-hidden="true"></span><input name="search" :value="search" placeholder="搜索本机账本" @input="emit('update:search', ($event.target as HTMLInputElement).value)" /></label>
      <div v-if="indexes.length" class="ledger-list mb-4 grid gap-[.65rem]">
        <article v-for="entry in indexes" :key="entry.ledgerId" class="ledger-card grid grid-cols-[minmax(0,1fr)_auto] items-center gap-[.85rem] p-[.9rem]" @click="emit('unlock', entry.ledgerId)">
          <strong>{{ entry.displayName }}</strong>
          <div class="ledger-card-actions flex items-center gap-[.4rem]"><button class="ghost small" @click.stop="emit('rename', entry)">修改名称</button><button class="ghost small danger-text" @click.stop="emit('delete', entry.ledgerId, entry.displayName)">删除</button></div>
        </article>
      </div>
      <div v-else class="empty"><span>◇</span><p>{{ search ? '没有匹配的账本' : '还没有账本，从新建一个开始。' }}</p></div>
      <button class="link-button" @click="emit('import')">从加密文件导入账本</button>
    </section>
  </main>
</template>
