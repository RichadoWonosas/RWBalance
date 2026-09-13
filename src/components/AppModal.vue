<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { vBackdropDismiss } from '../app/backdrop-dismiss'

const props = defineProps<{
  open: boolean
  contentKey?: string
  ariaLabel?: string
  size?: 'default' | 'transaction' | 'resolution'
  theme?: boolean
}>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
let returnFocus: HTMLElement | null = null

watch(() => props.open, async (open, previous) => {
  if (open && !previous) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
  if (open) {
    await nextTick()
    panel.value?.querySelector<HTMLElement>('[autofocus],input:not([disabled]),select:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])')?.focus()
  } else if (previous) {
    returnFocus?.focus()
    returnFocus = null
  }
})

function trapFocus(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); emit('close'); return }
  if (event.key !== 'Tab' || !panel.value) return
  const focusable = [...panel.value.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')].filter(item => item.offsetParent !== null)
  if (!focusable.length) return
  const first = focusable[0]!
  const last = focusable.at(-1)!
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
</script>

<template>
  <Transition name="modal-motion">
    <div v-if="open" class="modal-backdrop" v-backdrop-dismiss="() => emit('close')">
      <section ref="panel" class="modal" role="dialog" aria-modal="true" :aria-label="ariaLabel" tabindex="-1" :class="{ 'theme-modal': theme, 'transaction-entry-modal': size === 'transaction', 'tag-resolution-modal': size === 'resolution' }" @keydown="trapFocus">
        <button class="modal-close" aria-label="关闭对话框" @click="emit('close')">×</button>
        <Transition name="dialog-step" mode="out-in"><div :key="contentKey" class="dialog-step"><slot /></div></Transition>
      </section>
    </div>
  </Transition>
</template>
