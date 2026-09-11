<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { vBackdropDismiss } from '../app/backdrop-dismiss'
const props = defineProps<{ open: boolean; title: string; wide?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
let previous: HTMLElement | null = null
watch(() => props.open, async (open) => {
  if (open) { previous = document.activeElement as HTMLElement; await nextTick(); panel.value?.focus({ preventScroll: true }) }
  else previous?.focus({ preventScroll: true })
})
function keyboard(event: KeyboardEvent) {
  event.stopPropagation()
  if (event.key === 'Escape') { event.preventDefault(); emit('close') }
  if (event.key !== 'Tab') return
  const items = panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')
  if (!items?.length) { event.preventDefault(); return }
  const first = items[0]!, last = items[items.length - 1]!
  if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.value)) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.value)) { event.preventDefault(); first.focus() }
}
</script>
<template>
  <Teleport to="body"><Transition name="modal-motion">
    <div v-if="open" class="modal-backdrop picker-backdrop" v-backdrop-dismiss="() => emit('close')" @keydown="keyboard">
      <section ref="panel" class="modal picker-dialog" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title" tabindex="-1">
        <button class="modal-close" aria-label="关闭选择器" @click="emit('close')">×</button>
        <h2>{{ title }}</h2><slot />
      </section>
    </div>
  </Transition></Teleport>
</template>
