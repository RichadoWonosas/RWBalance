<script setup lang="ts">
import { computed, ref } from 'vue'
import { expandTagAncestors, tagPath } from '../core/domain/tag-hierarchy'
const props = defineProps<{ tags: { id: string; name: string; parentId?: string; isNew?: boolean }[]; search?: string }>()
const selected = defineModel<string[]>('selected', { required: true })
const primary = defineModel<string>('primary', { required: true })
const included = computed(() => expandTagAncestors(props.tags, selected.value))
const visible = computed(() => props.tags.filter(tag => tagPath(props.tags, tag.id).normalize('NFKC').toLocaleLowerCase().includes((props.search ?? '').normalize('NFKC').toLocaleLowerCase())))
const removing = ref('')
const descendants = computed(() => selected.value.filter(id => expandTagAncestors(props.tags, [id]).includes(removing.value)))
let beforeClick: string[] = []
function apply(ids: string[]) {
  selected.value = ids
  if (!ids.includes(primary.value)) primary.value = ids[0] ?? ''
}
function click(id: string, event: MouseEvent) {
  if (event.detail > 1) return
  beforeClick = [...selected.value]
  removing.value = ''
  if (selected.value.includes(id)) apply(selected.value.filter(value => value !== id))
  else if (included.value.includes(id)) removing.value = id
  else apply([...selected.value, id])
}
function makePrimary(id: string) {
  // Undo the first click of a double-click so the original direct order stays intact.
  selected.value = [...new Set([...beforeClick, id])]
  primary.value = id
  removing.value = ''
}
function removeBranch() {
  apply(selected.value.filter(id => !descendants.value.includes(id)))
  removing.value = ''
}
</script>
<template>
  <div class="tag-selection">
    <p class="field-help">单击选择，双击设为主标签。父标签自动带入，不改变直接选择顺序。</p>
    <div class="tag-cloud">
      <button v-for="tag in visible" :key="tag.id" type="button" class="tag" :class="{ selected: included.includes(tag.id), primaryTag: primary === tag.id, inherited: included.includes(tag.id) && !selected.includes(tag.id) }" :aria-pressed="included.includes(tag.id)" :title="tagPath(tags, tag.id)" @click="click(tag.id, $event)" @dblclick.prevent="makePrimary(tag.id)">
        <span>{{ tagPath(tags, tag.id) }}</span><small v-if="tag.isNew">新建</small><b v-if="primary === tag.id">主</b><small v-if="included.includes(tag.id) && !selected.includes(tag.id)">由子标签带入</small>
      </button>
    </div>
    <Transition name="page-fade" mode="out-in"><div v-if="removing" class="hierarchy-warning" role="status">
      <p>“{{ tags.find(tag => tag.id === removing)?.name }}”由 {{ descendants.map(id => tags.find(tag => tag.id === id)?.name).join('、') }} 带入。</p>
      <div class="actions"><button type="button" class="ghost small" @click="removing = ''">保留选择</button><button type="button" class="danger small" @click="removeBranch">同时取消这些子标签</button></div>
    </div></Transition>
  </div>
</template>
