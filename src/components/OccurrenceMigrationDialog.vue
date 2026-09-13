<script setup lang="ts">
import type { Money } from '../core/domain/types'
import type { OccurrenceMigrationEntry } from '../core/domain/ledger'
import type { LedgerWorkerResult } from '../worker/protocol'
import PickerDialog from './PickerDialog.vue'

export type MigrationTimeRow = OccurrenceMigrationEntry & { occurredAtLocal: string }
defineProps<{
  open: boolean
  info?: NonNullable<LedgerWorkerResult['migrationInfo']>
  rows: MigrationTimeRow[]
  dragIndex: number | null
  formatMoney: (money: Money) => string
}>()
const emit = defineEmits<{
  close: []
  generate: []
  drop: [index: number]
  dragStart: [event: DragEvent, index: number]
  dragEnd: []
  pointerStart: [event: PointerEvent, index: number]
  pointerMove: [event: PointerEvent]
  pointerFinish: [event: PointerEvent]
  nudge: [index: number, direction: -1 | 1]
  export: []
  confirm: []
}>()
</script>

<template>
  <PickerDialog :open="open" :title="rows.length ? '补充账目发生时间' : '升级账本数据格式'" wide @close="emit('close')">
    <p class="modal-copy">“{{ info?.name }}”正在从数据格式 v{{ info?.fromVersion }} 升级。金额、余额、标签和审计引用不会改变。</p>
    <template v-if="rows.length">
      <p class="hierarchy-warning">旧账目只有日期。下面按当前账目顺序生成了可编辑的建议时间；请逐条核对。只有确认全部发生时间后才能进入账本。</p>
      <div class="migration-time-toolbar"><span>同一天内按从新到旧排列</span><button class="ghost small" @click="emit('generate')">按当前顺序重新生成</button></div>
      <TransitionGroup name="reorder" tag="div" class="migration-time-list">
        <article v-for="(row, index) in rows" :key="row.id" data-reorder-scope="migration" :data-reorder-index="index" :class="{ dragging: dragIndex === index }" @dragover.prevent @drop="emit('drop', index)">
          <span class="drag-handle" draggable="true" role="button" tabindex="0" :aria-label="`拖动排序 ${row.note || row.kind}`" @dragstart="emit('dragStart',$event,index)" @dragend="emit('dragEnd')" @pointerdown="emit('pointerStart',$event,index)" @pointermove="emit('pointerMove',$event)" @pointerup="emit('pointerFinish',$event)" @pointercancel="emit('pointerFinish',$event)" @keydown.up.prevent="emit('nudge',index,-1)" @keydown.down.prevent="emit('nudge',index,1)"><span class="drag-grip" aria-hidden="true"></span></span>
          <div><strong>{{ row.kind === 'income' ? `收入至 ${row.destinationAccountName}` : row.kind === 'expense' ? `从 ${row.sourceAccountName} 支出` : `${row.sourceAccountName} → ${row.destinationAccountName}` }}</strong><small>{{ row.amount ? formatMoney(row.amount) : '' }} · {{ row.note || '无备注' }}<template v-if="row.corrected"> · 已更正</template><template v-if="row.deleted"> · 已删除</template></small></div>
          <label>发生时间<input :name="`migration-occurred-at-${row.id}`" v-model="row.occurredAtLocal" type="datetime-local" step="1" /></label>
        </article>
      </TransitionGroup>
    </template>
    <p v-else class="hierarchy-warning">该账本没有需要手动补时的业务账目。系统记录将使用原操作时间，旧版标签将保持原有名称和选择顺序。</p>
    <p class="migration-boundary">确认前不会写入数据；升级成功时会先原子保存当前密文备份。旧版客户端将无法打开升级后的账本。</p>
    <button class="ghost full" @click="emit('export')">导出升级前 .rwbl 备份</button>
    <div class="modal-actions"><button class="ghost" @click="emit('close')">暂后处理并锁定</button><button class="primary" @click="emit('confirm')">确认时间并升级</button></div>
  </PickerDialog>
</template>
