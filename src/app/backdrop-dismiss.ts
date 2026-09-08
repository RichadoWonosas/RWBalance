import type { ObjectDirective } from 'vue'

// A click can be retargeted to the common ancestor of down/up targets.
// Dismiss only a complete primary-pointer click that began and ended on this backdrop.
const dispose = new WeakMap<HTMLElement, () => void>()
const callbacks = new WeakMap<HTMLElement, () => void>()
export const vBackdropDismiss: ObjectDirective<HTMLElement, () => void> = {
  mounted(element, binding) {
    callbacks.set(element, binding.value)
    let start: { id: number; x: number; y: number } | undefined
    let released = false
    const reset = () => { start = undefined; released = false }
    const down = (event: PointerEvent) => {
      reset()
      if (event.target === element && event.button === 0 && event.isPrimary) start = { id: event.pointerId, x: event.clientX, y: event.clientY }
    }
    const up = (event: PointerEvent) => {
      released = Boolean(start && start.id === event.pointerId && event.target === element && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 8)
    }
    const click = (event: MouseEvent) => {
      const dismiss = event.target === element && released && Boolean(start)
      reset()
      if (dismiss) callbacks.get(element)?.()
    }
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', reset)
    element.addEventListener('click', click)
    dispose.set(element, () => {
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', reset)
      element.removeEventListener('click', click)
    })
  },
  updated(element, binding) { callbacks.set(element, binding.value) },
  unmounted(element) { dispose.get(element)?.(); dispose.delete(element); callbacks.delete(element) },
}
