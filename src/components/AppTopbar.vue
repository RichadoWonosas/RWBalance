<script setup lang="ts">
import type { AppPage } from '../app/router'

const props = defineProps<{ page: AppPage }>()

const pageTitles: Record<AppPage, string> = {
  dashboard: '资金总览',
  accounts: '账户管理',
  tags: '标签管理',
  transactions: '账目记录',
  analytics: '收支统计',
  settings: '账本设置',
}
</script>

<template>
  <header class="topbar mb-6 flex items-center justify-between gap-4 border-b border-app-border pb-6"><div><span class="eyebrow">{{ props.page.toUpperCase() }}</span><h2 class="m-0 text-[1.75rem]">{{ pageTitles[props.page] }}</h2></div><div class="status hidden mobile:block"><span class="status-dot"></span>本地已解锁</div></header>
</template>
