<script setup lang="ts">
import type { AppPage } from '../app/router'

defineProps<{ currentPage: AppPage; ledgerName?: string }>()
const emit = defineEmits<{
  navigate: [page: AppPage]
  add: []
  lock: [mode: 'away' | 'exit']
}>()

const navigationItems: ReadonlyArray<{ page: AppPage; label: string; icon: string }> = [
  { page: 'dashboard', label: '总览', icon: '⌂' },
  { page: 'accounts', label: '账户', icon: '◫' },
  { page: 'tags', label: '标签', icon: '◇' },
  { page: 'transactions', label: '账目', icon: '≡' },
  { page: 'analytics', label: '统计', icon: '⌁' },
  { page: 'settings', label: '设置', icon: '⚙' },
]
</script>

<template>
  <aside class="sidebar fixed inset-x-0 bottom-0 z-20 flex h-auto flex-col px-2 pt-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] mobile:sticky mobile:inset-x-auto mobile:top-0 mobile:h-screen mobile:px-4 mobile:py-[1.6rem]">
    <div class="brand hidden items-center gap-[.7rem] px-[.45rem] pt-[.2rem] pb-[1.8rem] mobile:flex"><span>RW</span><div>Balance<small>{{ ledgerName }}</small></div></div>
    <nav class="grid grid-cols-6 gap-[.35rem] mobile:grid-cols-1" aria-label="主导航">
      <button v-for="item in navigationItems" :key="item.page" type="button" class="flex flex-col items-center justify-center gap-[.15rem] p-2 text-xs mobile:flex-row mobile:justify-start mobile:gap-[.8rem] mobile:px-[.9rem] mobile:py-[.8rem] mobile:text-[1.05rem]" :class="{ active: currentPage === item.page }" @click="emit('navigate', item.page)">
        <span class="sidebar-button-icon mobile:size-6 mobile:flex-[0_0_1.5rem] mobile:text-[1.35rem]" aria-hidden="true">{{ item.icon }}</span><span class="sidebar-button-label">{{ item.label }}</span>
      </button>
    </nav>
    <button type="button" class="sidebar-add-button mt-4 hidden w-full items-center gap-[.8rem] px-[.9rem] py-[.72rem] mobile:flex mobile:text-[1.05rem]" @click="emit('add')"><span class="sidebar-button-icon mobile:size-6 mobile:flex-[0_0_1.5rem] mobile:text-[1.35rem]" aria-hidden="true">＋</span><span class="sidebar-button-label">新增账目</span></button>
    <div class="session-actions mt-1 grid grid-cols-2 gap-1 mobile:mt-auto mobile:grid-cols-1"><button type="button" class="switch-ledger-button flex items-center justify-center gap-[.15rem] px-[.9rem] py-[.35rem] text-xs mobile:justify-start mobile:gap-[.8rem] mobile:py-[.8rem] mobile:text-[1.05rem]" @click="emit('lock', 'away')"><span class="sidebar-button-icon mobile:size-6 mobile:flex-[0_0_1.5rem] mobile:text-[1.35rem]" aria-hidden="true">◷</span><span class="sidebar-button-label">暂离</span></button><button type="button" class="lock-button flex items-center justify-center gap-[.15rem] px-[.9rem] py-[.35rem] text-xs mobile:justify-start mobile:gap-[.8rem] mobile:py-[.8rem] mobile:text-[1.05rem]" @click="emit('lock', 'exit')"><span class="sidebar-button-icon mobile:size-6 mobile:flex-[0_0_1.5rem] mobile:text-[1.35rem]" aria-hidden="true">⇥</span><span class="sidebar-button-label">退出</span></button></div>
  </aside>
</template>
