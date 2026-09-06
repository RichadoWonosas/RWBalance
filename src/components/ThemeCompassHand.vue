<script setup lang="ts">
import compassHandSvg from '../assets/theme/compass-hand.svg?raw'

const props = defineProps<{
  hue: number
  selected: boolean
  channel: 'primary' | 'secondary'
}>()

const unstyledHandSvg = compassHandSvg.replace(/<style[\s\S]*?<\/style>/, '')
</script>

<template>
  <div
    class="compass-hand"
    :class="[`compass-hand-${channel}`, { selected }]"
    :style="{ '--compass-hand-angle': `${hue}deg`, '--compass-hand-hue': hue }"
    aria-hidden="true"
    v-html="unstyledHandSvg"
  ></div>
</template>

<style scoped>
.compass-hand {
  position: absolute;
  z-index: 3;
  inset: 6%;
  opacity: .58;
  pointer-events: none;
  transform: rotate(var(--compass-hand-angle));
  transform-origin: center;
  transition: none;
}

.compass-hand.selected {
  z-index: 4;
  opacity: 1;
}

.compass-hand-secondary {
  inset: 8.5%;
}

.compass-hand :deep(svg) {
  display: block;
  width: 100%;
  height: 100%;
  filter: drop-shadow(0 0 1px hsl(0 0% 100%)) drop-shadow(0 0 4px hsl(0 0% 100% / 80%));
}

.compass-hand :deep(.st0) {
  fill: hsl(var(--compass-hand-hue) 100% 70%);
  stroke: hsl(0 0% 13%);
  stroke-width: 1.25;
  stroke-miterlimit: 10;
}

.compass-hand :deep(.st1) {
  fill: hsl(0 0% 13%);
}

.compass-hand :deep(.st2) {
  fill: none;
  stroke: hsl(0 0% 13%);
  stroke-miterlimit: 10;
}

.compass-hand :deep(.st3) {
  fill: none;
  stroke: hsl(0 0% 13%);
  stroke-width: .75;
  stroke-miterlimit: 10;
}

.compass-hand :deep(.st4) {
  fill: hsl(var(--compass-hand-hue) 100% 70%);
}
</style>
