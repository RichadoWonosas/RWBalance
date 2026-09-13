<script setup lang="ts">
import type { PendingTag } from '../core/domain/ledger'
import type { TagCategory } from '../core/domain/types'
import TagParentPicker from './TagParentPicker.vue'

defineProps<{
  tags: { id: string; name: string; parentId?: string; category?: TagCategory; createdAt?: string; isNew?: boolean }[]
  drafts: PendingTag[]
  name: string
  parentId: string
  category: TagCategory
  busy: boolean
  parentName: (parentId?: string) => string
}>()
const emit = defineEmits<{
  'update:name': [value: string]
  'update:parentId': [value: string]
  'update:category': [value: TagCategory]
  stage: []
  remove: [index: number]
  close: []
  confirm: []
}>()
</script>

<template>
  <span class="eyebrow">BATCH TAGS</span><h2>批量添加标签</h2><p class="modal-copy">标签只会在最后点击“确认添加”后一次性写入账本。</p>
  <div class="tag-wizard-entry grid grid-cols-1 items-end gap-3 compact:grid-cols-[minmax(0,1fr)_auto]"><label class="!m-0">标签名称<input class="h-11" name="tag-wizard-name" :value="name" placeholder="输入新标签名称" @input="emit('update:name', ($event.target as HTMLInputElement).value)" @keyup.enter="emit('stage')" /></label><button class="primary h-11" @click="emit('stage')">加入列表</button></div>
  <TagParentPicker :tags="tags" :parent-id="parentId" :category="category" forced-open @update:parent-id="emit('update:parentId',$event)" @update:category="emit('update:category',$event)" />
  <div class="tag-wizard-pending"><span class="field-help">本次待添加标签（已有标签不会显示在这里）</span><div class="tag-cloud flex flex-wrap gap-[.55rem]"><span v-for="(tag,index) in drafts" :key="tag.clientId" class="tag-chip readonly" :title="`父级：${parentName(tag.parentId)}`"><span>{{ tag.name }}</span><small>{{ tag.category === 'income' ? '收入' : '支出' }}</small><small>新建</small><button type="button" :aria-label="`移除待添加标签 ${tag.name}`" @click="emit('remove',index)">×</button></span></div><div v-if="!drafts.length" class="empty compact">尚未加入标签</div></div>
  <div class="modal-actions"><button class="ghost" @click="emit('close')">取消</button><button class="primary" :disabled="busy || !drafts.length" @click="emit('confirm')">确认添加</button></div>
</template>
