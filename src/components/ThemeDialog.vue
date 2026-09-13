<script setup lang="ts">
import { previewThemeColor, type ColorTone, type ThemeChannel } from '../core/domain/theme'
import ThemeCompassHand from './ThemeCompassHand.vue'

defineProps<{
  primaryHue: number
  secondaryHue: number
  selectedHue: number
  channel: ThemeChannel
  colorTone: ColorTone
  compassDialUrl: string
  busy: boolean
  themeColor: (channel: ThemeChannel, hue?: number) => string
}>()
const emit = defineEmits<{
  'update:selectedHue': [hue: number]
  'update:channel': [channel: ThemeChannel]
  adjust: [delta: number]
  pointerStart: [event: PointerEvent]
  pointerMove: [event: PointerEvent]
  pointerStop: []
  close: []
  save: []
}>()
const huePalette = Array.from({ length: 24 }, (_, index) => index * 15)
</script>

<template>
  <span class="eyebrow">THEME COMPASS</span><h2>选择主题颜色</h2>
  <p class="modal-copy">主色和副色都可在 360° 色环上自由选择。拖动指针、输入数值或使用微调按钮，界面会即时预览。</p>
  <div class="hue-channel-tabs" role="tablist" aria-label="选择要调整的颜色">
    <button :class="{ selected: channel === 'primary' }" role="tab" :aria-selected="channel === 'primary'" @click="emit('update:channel', 'primary')"><i :style="{ '--rw-preview-color': themeColor('primary', primaryHue) }"></i><span>主题色<strong>{{ primaryHue }}°</strong></span></button>
    <button :class="{ selected: channel === 'secondary' }" role="tab" :aria-selected="channel === 'secondary'" @click="emit('update:channel', 'secondary')"><i :style="{ '--rw-preview-color': themeColor('secondary', secondaryHue) }"></i><span>副主题色<strong>{{ secondaryHue }}°</strong></span></button>
  </div>
  <div class="hue-workbench grid grid-cols-1 justify-items-center gap-6 settings:grid-cols-[270px_1fr] settings:items-center settings:justify-items-stretch">
    <div class="hue-ring size-[230px] compact:size-[260px]" :class="`hue-ring-${colorTone}`" :style="{ '--rw-selected-hue': `${selectedHue}` }" role="slider" aria-label="色相环" aria-valuemin="0" aria-valuemax="359" :aria-valuenow="selectedHue" tabindex="0" @pointerdown="emit('pointerStart',$event)" @pointermove="emit('pointerMove',$event)" @pointerup="emit('pointerStop')" @pointercancel="emit('pointerStop')">
      <div class="hue-ring-dial"><div class="hue-ring-dial-base"></div><img :src="compassDialUrl" alt="" /><div class="hue-ring-dial-color"></div></div>
      <ThemeCompassHand channel="secondary" :hue="secondaryHue" :selected="channel === 'secondary'" />
      <ThemeCompassHand channel="primary" :hue="primaryHue" :selected="channel === 'primary'" />
    </div>
    <div class="hue-options grid w-full gap-[.8rem]">
      <label>色相角度<input name="selected-hue" :value="selectedHue" type="number" min="0" max="359" @input="emit('update:selectedHue', Number(($event.target as HTMLInputElement).value))" /></label>
      <div class="hue-adjustments grid grid-cols-3 gap-[.35rem] compact:grid-cols-6"><button v-for="delta in [-60,-15,-1,1,15,60]" :key="delta" class="ghost" @click="emit('adjust',delta)">{{ delta > 0 ? '+' : '' }}{{ delta }}</button></div>
      <div class="hue-palette grid grid-cols-6 gap-[.35rem] compact:grid-cols-8" aria-label="快捷色相"><button v-for="hue in huePalette" :key="hue" :class="{ selected: selectedHue === hue }" :style="{ '--rw-preview-color': previewThemeColor(hue, colorTone) }" :aria-label="`选择 ${hue} 度色相`" @click="emit('update:selectedHue',hue)"></button></div>
    </div>
  </div>
  <div class="modal-actions"><button class="ghost" @click="emit('close')">取消</button><button class="primary" :disabled="busy" @click="emit('save')">保存到当前账本</button></div>
</template>
