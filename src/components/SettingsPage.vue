<script setup lang="ts">
import type { ColorTone } from '../core/domain/theme'

export type SettingsSection = 'backup' | 'security' | 'appearance'

const props = defineProps<{
  section: SettingsSection | null
  ledgerName?: string
  hasMigrationBackup: boolean
  hasRecovery: boolean
  securityLabel: string
  autoLockSeconds: number
  savedAutoLockSeconds: number
  busy: boolean
  colorTone: ColorTone
  primaryHue: number
  secondaryHue: number
  primaryPreview: string
  secondaryPreview: string
}>()
const emit = defineEmits<{
  'update:section': [section: SettingsSection | null]
  'update:autoLockSeconds': [seconds: number]
  export: []
  exportMigration: []
  recover: []
  rename: []
  saveTimeout: []
  passphrase: []
  security: []
  delete: []
  tone: [event: Event]
  theme: []
}>()

function toggle(next: SettingsSection) { emit('update:section', props.section === next ? null : next) }
</script>

<template>
  <div class="settings-page grid w-full gap-[.85rem]">
    <section class="surface settings-group !m-0 !p-0 overflow-clip" :class="{ open: section === 'backup' }">
      <button type="button" class="settings-group-trigger flex w-full items-center justify-between gap-4 px-[1.35rem] py-[1.2rem] text-left" :aria-expanded="section === 'backup'" @click="toggle('backup')"><span class="min-w-0"><span class="eyebrow">BACKUP &amp; RECOVERY</span><strong>备份</strong></span><span class="disclosure-triangle" :class="{ expanded: section === 'backup' }" aria-hidden="true"></span></button>
      <div class="collapse-shell" :class="{ open: section === 'backup' }" :inert="section !== 'backup'"><div class="collapse-content"><div class="settings-group-content px-[1.35rem] pb-[.35rem]">
        <article class="settings-item grid grid-cols-1 items-center gap-4 border-t border-app-border py-[1.1rem] settings:grid-cols-[minmax(0,1fr)_auto] settings:gap-8"><div><span class="eyebrow">ENCRYPTED BACKUP</span><h3>导出完整加密账本</h3><p>导出经过压缩和加密的完整容器，不生成明文中间文件。</p></div><button class="ghost settings-action w-full settings:w-auto settings:min-w-[170px] settings:shrink-0" @click="emit('export')">导出 .rwbl 文件</button></article>
        <article v-if="hasMigrationBackup" class="settings-item grid grid-cols-1 items-center gap-4 border-t border-app-border py-[1.1rem] settings:grid-cols-[minmax(0,1fr)_auto] settings:gap-8"><div><span class="eyebrow">MIGRATION BACKUP</span><h3>升级前备份</h3><p>导出独立保存的升级前密文；该备份不包含升级后的新记录。</p></div><button class="ghost settings-action w-full settings:w-auto settings:min-w-[170px] settings:shrink-0" @click="emit('exportMigration')">导出升级前备份</button></article>
        <article class="settings-item grid grid-cols-1 items-center gap-4 border-t border-app-border py-[1.1rem] settings:grid-cols-[minmax(0,1fr)_auto] settings:gap-8"><div><span class="eyebrow">RECOVERY</span><h3>恢复上一版密文</h3><p>恢复覆盖写入前保留的上一版本，需要该版本对应的访问口令。</p></div><button class="ghost settings-action w-full settings:w-auto settings:min-w-[170px] settings:shrink-0" :disabled="!hasRecovery" @click="emit('recover')">{{ hasRecovery ? '恢复上一版本' : '暂无上一版本' }}</button></article>
      </div></div></div>
    </section>

    <section class="surface settings-group !m-0 !p-0 overflow-clip" :class="{ open: section === 'security' }">
      <button type="button" class="settings-group-trigger flex w-full items-center justify-between gap-4 px-[1.35rem] py-[1.2rem] text-left" :aria-expanded="section === 'security'" @click="toggle('security')"><span class="min-w-0"><span class="eyebrow">LEDGER &amp; SECURITY</span><strong>账本安全</strong></span><span class="disclosure-triangle" :class="{ expanded: section === 'security' }" aria-hidden="true"></span></button>
      <div class="collapse-shell" :class="{ open: section === 'security' }" :inert="section !== 'security'"><div class="collapse-content"><div class="settings-group-content px-[1.35rem] pb-[.35rem]">
        <article class="settings-item grid grid-cols-1 items-center gap-4 border-t border-app-border py-[1.1rem] settings:grid-cols-[minmax(0,1fr)_auto] settings:gap-8"><div><span class="eyebrow">LEDGER IDENTITY</span><h3>账本名称</h3><p>当前名称：{{ ledgerName }}。修改时会要求访问口令确认。</p></div><button class="ghost settings-action w-full settings:w-auto settings:min-w-[170px] settings:shrink-0" @click="emit('rename')">修改账本名称</button></article>
        <article class="settings-item grid grid-cols-1 items-center gap-4 border-t border-app-border py-[1.1rem] settings:grid-cols-[minmax(0,1fr)_auto] settings:gap-8"><div><span class="eyebrow">AUTO AWAY</span><h3>自动暂离</h3><p>无操作达到设定时间后清除解密会话，并保留当前页面和未提交草稿。</p></div><div class="timeout-setting grid w-full grid-cols-[minmax(110px,1fr)_auto] items-end gap-[.65rem] settings:w-[min(250px,100%)]"><label class="m-0">等待秒数<input name="auto-lock-seconds-input" :value="autoLockSeconds" type="number" min="30" max="86400" step="1" @input="emit('update:autoLockSeconds', Number(($event.target as HTMLInputElement).value))" @keyup.enter="emit('saveTimeout')" /></label><button class="ghost" :disabled="busy || autoLockSeconds === savedAutoLockSeconds" @click="emit('saveTimeout')">保存</button></div></article>
        <article class="settings-item grid grid-cols-1 items-center gap-4 border-t border-app-border py-[1.1rem] settings:grid-cols-[minmax(0,1fr)_auto] settings:gap-8"><div><span class="eyebrow">ACCESS PASSPHRASE</span><h3>修改访问口令</h3><p>验证当前口令后，为账本设置新的访问口令。</p></div><button class="ghost settings-action w-full settings:w-auto settings:min-w-[170px] settings:shrink-0" @click="emit('passphrase')">修改访问口令</button></article>
        <article class="settings-item grid grid-cols-1 items-center gap-4 border-t border-app-border py-[1.1rem] settings:grid-cols-[minmax(0,1fr)_auto] settings:gap-8"><div><span class="eyebrow">CRYPTO REGISTRY</span><h3>加密方式</h3><p>当前：{{ securityLabel }}。</p></div><button class="ghost settings-action w-full settings:w-auto settings:min-w-[170px] settings:shrink-0" @click="emit('security')">修改加密方式</button></article>
        <article class="settings-item danger-zone grid grid-cols-1 items-center gap-4 border-t border-app-border py-[1.1rem] pl-4 shadow-[inset_3px_0_var(--rw-color-danger)] settings:grid-cols-[minmax(0,1fr)_auto] settings:gap-8"><div><span class="eyebrow">DANGER ZONE</span><h3>删除当前账本</h3><p>永久移除本机索引和加密容器；确认前仍可导出完整密文备份。</p></div><button class="ghost danger settings-action w-full settings:w-auto settings:min-w-[170px] settings:shrink-0" @click="emit('delete')">删除账本</button></article>
      </div></div></div>
    </section>

    <section class="surface settings-group !m-0 !p-0 overflow-clip" :class="{ open: section === 'appearance' }">
      <button type="button" class="settings-group-trigger flex w-full items-center justify-between gap-4 px-[1.35rem] py-[1.2rem] text-left" :aria-expanded="section === 'appearance'" @click="toggle('appearance')"><span class="min-w-0"><span class="eyebrow">COLOR &amp; TONE</span><strong>外观</strong></span><span class="disclosure-triangle" :class="{ expanded: section === 'appearance' }" aria-hidden="true"></span></button>
      <div class="collapse-shell" :class="{ open: section === 'appearance' }" :inert="section !== 'appearance'"><div class="collapse-content"><div class="settings-group-content px-[1.35rem] pb-[.35rem]">
        <article class="settings-item grid grid-cols-1 items-center gap-4 border-t border-app-border py-[1.1rem] settings:grid-cols-[minmax(0,1fr)_auto] settings:gap-8"><div><span class="eyebrow">COLOR TONE</span><h3>亮色调 / 暗色调</h3><p>改变页面的明暗基底，不改变已选择的主题色相。</p></div><div class="tone-switch-control"><span :class="{ active: colorTone === 'light' }">亮色调</span><label class="tone-switch"><input name="color-tone" type="checkbox" aria-label="切换亮暗色调" :checked="colorTone === 'dark'" :disabled="busy" @change="emit('tone', $event)"><span class="tone-switch-track"><span class="tone-switch-thumb"></span></span></label><span :class="{ active: colorTone === 'dark' }">暗色调</span></div></article>
        <article class="settings-item grid grid-cols-1 items-center gap-4 border-t border-app-border py-[1.1rem] settings:grid-cols-[minmax(0,1fr)_auto] settings:gap-8"><div><span class="eyebrow">APPEARANCE</span><h3>主题颜色</h3><p>主色与副色均可选择任意色相，并随当前账本保存。</p></div><button class="theme-entry settings-action w-full settings:w-auto" @click="emit('theme')"><span class="theme-entry-colors"><i :style="{ '--rw-preview-color': primaryPreview }"></i><i :style="{ '--rw-preview-color': secondaryPreview }"></i></span><span>主色 {{ primaryHue }}° · 副色 {{ secondaryHue }}°</span><span class="disclosure-triangle side" aria-hidden="true"></span></button></article>
      </div></div></div>
    </section>
  </div>
</template>
