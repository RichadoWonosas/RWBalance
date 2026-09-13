<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TagCategory } from '../core/domain/types'
import { flattenTagHierarchy, tagPath } from '../core/domain/tag-hierarchy'

const props = withDefaults(defineProps<{
  tags: { id: string; name: string; parentId?: string; category?: TagCategory; createdAt?: string; isNew?: boolean }[]
  categoryDisabled?: boolean
  forcedOpen?: boolean
}>(), { categoryDisabled: false, forcedOpen: false })
const parentId = defineModel<string>('parentId', { required: true })
const category = defineModel<TagCategory>('category', { required: true })
const expanded = ref(false)
const search = ref('')
const categoryTags = computed(() => props.tags.filter((tag) => tag.category === category.value))
const visibleTags = computed(() => {
  const query = search.value.trim().normalize('NFKC').toLocaleLowerCase()
  const normalized = categoryTags.value.map((tag, index) => ({ ...tag, createdAt: tag.createdAt ?? String(index).padStart(8, '0') }))
  return flattenTagHierarchy(normalized).filter(({ tag }) => !query || tagPath(normalized, tag.id).normalize('NFKC').toLocaleLowerCase().includes(query))
})
const selectedName = computed(() => parentId.value ? tagPath(categoryTags.value, parentId.value) : '根标签（无父级）')
watch(category, () => {
  if (parentId.value && !categoryTags.value.some((tag) => tag.id === parentId.value)) parentId.value = ''
  search.value = ''
})
</script>

<template>
  <section class="tag-parent-picker" :class="{ forced: forcedOpen }">
    <label>标签类别<select name="tag-parent-category" v-model="category" :disabled="categoryDisabled"><option value="income">收入</option><option value="expense">支出</option></select></label>
    <button v-if="!forcedOpen" type="button" class="ghost full tag-parent-trigger" :aria-expanded="expanded" @click="expanded = !expanded"><span>新建标签的父级 · {{ selectedName }}</span><span class="disclosure-triangle" :class="{ expanded }" aria-hidden="true"></span></button>
    <div class="collapse-shell" :class="{ open: forcedOpen || expanded }" :inert="!forcedOpen && !expanded"><div class="collapse-content">
      <div class="tag-parent-panel">
        <label class="search"><span class="search-icon" aria-hidden="true"></span><input name="tag-parent-search" v-model="search" placeholder="筛选可选父标签" /></label>
        <div class="tag-parent-options flex max-h-[190px] flex-wrap gap-2 overflow-auto p-[.15rem]" role="listbox" aria-label="新建标签的父级">
          <button type="button" class="tag-chip" :class="{ selected: !parentId }" :aria-selected="!parentId" @click="parentId = ''">根标签（无父级）</button>
          <button v-for="row in visibleTags" :key="row.tag.id" type="button" class="tag-chip" :class="{ selected: parentId === row.tag.id }" :aria-selected="parentId === row.tag.id" @click="parentId = row.tag.id"><span>{{ tagPath(categoryTags, row.tag.id) }}</span><small v-if="row.tag.isNew">本次新建</small></button>
        </div>
      </div>
    </div></div>
  </section>
</template>
