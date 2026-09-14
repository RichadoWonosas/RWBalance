<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { Tag, TagCategory } from '../core/domain/types'
import { expandTagAncestors, flattenTagHierarchy, tagPath } from '../core/domain/tag-hierarchy'

interface HierarchyChange {
  tagId: string
  previousParentId?: string
  parentId?: string
  changedAt: string
  affectedTransactions: number
  action: 'reparent' | 'delete'
}

const props = defineProps<{
  tags: Tag[]
  hierarchyChanges: HierarchyChange[]
  openCategory: TagCategory | null
}>()
const emit = defineEmits<{
  'update:openCategory': [category: TagCategory | null]
  add: [category?: TagCategory, initialName?: string]
  edit: [tagId: string]
  delete: [tagId: string]
}>()

const searches = reactive<Record<TagCategory, string>>({ income: '', expense: '' })
const hierarchyHistoryOpen = ref(false)
const expandedIds = defineModel<string[]>('expandedIds', { required: true })
const normalizeSearch = (value: string) => value.trim().normalize('NFKC').toLocaleLowerCase()

function searchActive(category: TagCategory) { return Boolean(normalizeSearch(searches[category])) }
function toggleCategory(category: TagCategory) {
  emit('update:openCategory', props.openCategory === category ? null : category)
}
function toggleBranch(id: string, category: TagCategory) {
  if (searchActive(category)) return
  expandedIds.value = expandedIds.value.includes(id)
    ? expandedIds.value.filter(value => value !== id)
    : [...expandedIds.value, id]
}
function treeRows(category: TagCategory) {
  const categoryTags = props.tags.filter(tag => tag.category === category)
  const all = flattenTagHierarchy(categoryTags)
  const query = normalizeSearch(searches[category])
  let searched: Set<string> | undefined
  if (query) {
    searched = new Set<string>()
    for (const row of all) if (normalizeSearch(tagPath(props.tags, row.tag.id)).includes(query)) {
      for (const id of expandTagAncestors(categoryTags, [row.tag.id])) searched.add(id)
    }
  }
  return all.map(row => {
    let visible = !searched || searched.has(row.tag.id)
    let parentId = row.tag.parentId
    while (visible && !query && parentId) {
      if (!expandedIds.value.includes(parentId)) visible = false
      parentId = categoryTags.find(tag => tag.id === parentId)?.parentId
    }
    return { ...row, visible }
  })
}
function nameOf(id?: string) { return id ? props.tags.find(tag => tag.id === id)?.name ?? '已删除标签' : '根标签' }
function expandTagPath(id?: string) {
  if (!id) return
  expandedIds.value = [...new Set([...expandedIds.value, ...expandTagAncestors(props.tags, [id])])]
}
defineExpose({ expandTagPath })
</script>

<template>
  <div class="section-title flex items-center justify-between gap-4"><div><span class="eyebrow">CATEGORIES</span><h3>标签类别</h3></div><button class="primary" @click="emit('add')">＋ 批量添加标签</button></div>
  <section v-for="category in (['income','expense'] as const)" :key="category" class="surface tag-category-group" :class="{ open: openCategory === category }">
    <button type="button" class="settings-group-trigger flex w-full items-center justify-between gap-4 px-[1.35rem] py-[1.2rem] text-left" :aria-expanded="openCategory === category" @click="toggleCategory(category)"><span class="tag-category-title grid gap-[.45rem]"><span class="eyebrow !m-0">{{ category === 'income' ? 'INCOME TAGS' : 'EXPENSE TAGS' }}</span><span class="tag-category-heading flex items-baseline gap-[.4rem]"><strong>{{ category === 'income' ? '收入' : '支出' }}</strong><small>{{ tags.filter(tag => tag.category === category).length }} 个标签</small></span></span><span class="disclosure-triangle" :class="{ expanded: openCategory === category }" aria-hidden="true"></span></button>
    <div class="collapse-shell" :class="{ open: openCategory === category }" :inert="openCategory !== category"><div class="collapse-content"><div class="tag-category-content px-[1.35rem] pt-4 pb-[1.35rem]">
      <div class="section-title mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"><label class="search tag-search !m-0 w-full"><span class="search-icon" aria-hidden="true"></span><input :name="`tag-search-${category}`" v-model="searches[category]" :placeholder="`筛选${category === 'income' ? '收入' : '支出'}标签或父级`" /></label><button type="button" class="ghost h-11 min-w-20 shrink-0 whitespace-nowrap px-4" @click="emit('add', category, searches[category])">添加</button></div>
      <div class="tag-management-list grid"><div v-for="row in treeRows(category)" :key="row.tag.id" class="tag-tree-collapse" :class="{ open: row.visible }" :inert="!row.visible"><div class="tag-tree-collapse-content"><article class="flex items-center justify-between gap-[.8rem]" :class="{ expandable: row.hasChildren && !searchActive(category) }" :style="{ '--rw-tag-depth': row.depth }" @click="row.hasChildren && toggleBranch(row.tag.id,category)"><div class="tag-tree-main flex min-w-0 items-center gap-[.45rem]"><button v-if="row.hasChildren" type="button" class="tag-tree-toggle grid place-items-center" :disabled="searchActive(category)" :aria-label="`${expandedIds.includes(row.tag.id) || searchActive(category) ? '折叠' : '展开'} ${row.tag.name} 的子标签`" :aria-expanded="expandedIds.includes(row.tag.id) || searchActive(category)" @click.stop="toggleBranch(row.tag.id,category)"><span class="disclosure-triangle" :class="{ expanded: expandedIds.includes(row.tag.id) || searchActive(category) }" aria-hidden="true"></span></button><span v-else class="tag-tree-spacer"></span><span class="tag-path min-w-0">{{ row.tag.name }}</span></div><div class="app-actions flex shrink-0 justify-end gap-[.7rem]"><button class="ghost small" :aria-label="'修改标签 ' + row.tag.name" @click.stop="emit('edit', row.tag.id)">修改</button><button class="ghost small danger-text" :aria-label="'删除标签 ' + row.tag.name" @click.stop="emit('delete', row.tag.id)">删除</button></div></article></div></div></div>
      <div v-if="!treeRows(category).some(row => row.visible)" class="empty compact">没有符合筛选条件的标签</div>
    </div></div></div>
  </section>
  <section v-if="hierarchyChanges.length" class="hierarchy-history surface settings-group !p-0 overflow-clip" :class="{ open: hierarchyHistoryOpen }">
    <button type="button" class="settings-group-trigger flex w-full items-center justify-between gap-4 px-[1.35rem] py-[1.2rem] text-left" :aria-expanded="hierarchyHistoryOpen" @click="hierarchyHistoryOpen = !hierarchyHistoryOpen"><span class="min-w-0"><span class="eyebrow">HIERARCHY HISTORY</span><strong>层级变更记录（{{ hierarchyChanges.length }}）</strong></span><span class="disclosure-triangle" :class="{ expanded: hierarchyHistoryOpen }" aria-hidden="true"></span></button>
    <div class="collapse-shell" :class="{ open: hierarchyHistoryOpen }" :inert="!hierarchyHistoryOpen"><div class="collapse-content"><ol class="m-0 max-h-72 overflow-auto px-[2.6rem] pb-[1.35rem] pt-1 leading-[1.8]"><li v-for="(change, index) in [...hierarchyChanges].reverse()" :key="index">{{ new Date(change.changedAt).toLocaleString('zh-CN') }} · {{ nameOf(change.tagId) }} · {{ change.action === 'delete' ? '删除标签' : nameOf(change.previousParentId) + ' → ' + nameOf(change.parentId) }} · 影响 {{ change.affectedTransactions }} 条记录</li></ol></div></div>
  </section>
</template>
