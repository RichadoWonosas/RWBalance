<script setup lang="ts">
import { currencyRules } from '../core/domain/money'
import { currencies, type Account, type Currency, type TagCategory, type TransactionDraft, type TransactionKind } from '../core/domain/types'
import { expandTagAncestors } from '../core/domain/tag-hierarchy'
import AccountPicker from './AccountPicker.vue'

export interface DraftForm { kind: TransactionKind; sourceAccountId: string; sourceAmount: string; sourceCurrency: Currency; destinationAccountId: string; destinationAmount: string; destinationCurrency: Currency; selectedTagIds: string[]; primaryTagId: string; note: string; occurredAtLocal: string }
type PickerTag = { id: string; name: string; parentId?: string; category?: TagCategory; createdAt?: string; isNew?: boolean }
defineProps<{ form: DraftForm; accounts: Account[]; pickerTags: PickerTag[]; pendingDrafts: TransactionDraft[]; pendingDragIndex: number | null; impliedExchangeRate: string; busy: boolean; hasUnsavedInput: boolean; occurredAtOf: (draft: TransactionDraft) => string }>()
const emit = defineEmits<{
  sync: [side: 'source' | 'destination']; openPicker: []; addPending: []; commitPending: []; commitAll: []
  drop: [index: number]; dragStart: [event: DragEvent, index: number]; dragEnd: []
  pointerStart: [event: PointerEvent, index: number]; pointerMove: [event: PointerEvent]; pointerFinish: [event: PointerEvent]
  move: [index: number, target: number]; copy: [index: number]; remove: [index: number]
}>()
</script>

<template>
  <span class="eyebrow">BATCH ENTRY</span><div class="section-title"><h2>批量添加账目</h2><span class="pill">待提交 {{ pendingDrafts.length }} 笔</span></div>
  <div class="form-grid transaction-form" :class="`kind-${form.kind}`">
    <label class="entry-type">类型<select name="draft-form-kind" v-model="form.kind"><option value="expense">支出</option><option value="income">收入</option><option value="transfer">转移</option></select></label>
    <label class="entry-date">发生时间<input name="draft-form-occurred-at" v-model="form.occurredAtLocal" type="datetime-local" step="1" /></label>
    <div v-if="form.kind !== 'income'" class="picker-field entry-source-account"><span>支出账户</span><AccountPicker v-model="form.sourceAccountId" :accounts="accounts" placeholder="选择支出账户" search-placeholder="搜索支出账户" /></div>
    <label v-if="form.kind !== 'income'" class="entry-source-amount">支出金额<div class="money-input"><input name="draft-form-source-amount" v-model="form.sourceAmount" type="number" min="0" :max="currencyRules[form.sourceCurrency].maxMinorUnits / 10 ** currencyRules[form.sourceCurrency].fractionDigits" :step="10 ** -currencyRules[form.sourceCurrency].fractionDigits" @input="emit('sync','source')" /><select name="draft-form-source-currency" v-model="form.sourceCurrency" @change="emit('sync','source')"><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></div></label>
    <div v-if="form.kind !== 'expense'" class="picker-field entry-destination-account"><span>收入账户</span><AccountPicker v-model="form.destinationAccountId" :accounts="accounts" placeholder="选择收入账户" search-placeholder="搜索收入账户" /></div>
    <label v-if="form.kind !== 'expense'" class="entry-destination-amount">收入金额<div class="money-input"><input name="draft-form-destination-amount" v-model="form.destinationAmount" type="number" min="0" :max="currencyRules[form.destinationCurrency].maxMinorUnits / 10 ** currencyRules[form.destinationCurrency].fractionDigits" :step="10 ** -currencyRules[form.destinationCurrency].fractionDigits" @input="emit('sync','destination')" /><select name="draft-form-destination-currency" v-model="form.destinationCurrency" @change="emit('sync','destination')"><option v-for="currency in currencies" :key="currency">{{ currency }}</option></select></div></label>
    <label class="wide">备注<input name="draft-form-note" v-model="form.note" maxlength="240" placeholder="可选" /><small>{{ form.note.length }} / 240</small></label>
  </div>
  <p v-if="impliedExchangeRate" class="exchange-rate">推导汇率：{{ impliedExchangeRate }}</p>
  <div v-if="form.kind !== 'transfer'" class="tag-picker"><span>已确认{{ form.kind === 'income' ? '收入' : '支出' }}标签</span><div class="tag-cloud flex flex-wrap gap-[.55rem]"><button v-for="tagId in expandTagAncestors(pickerTags, form.selectedTagIds)" :key="tagId" class="tag-chip" :class="{ primaryTag: form.primaryTagId === tagId }" @click="emit('openPicker')">{{ pickerTags.find(tag => tag.id === tagId)?.name }} <small v-if="!form.selectedTagIds.includes(tagId)">由子标签带入</small> <b v-if="form.primaryTagId === tagId">主</b></button><button class="ghost small" @click="emit('openPicker')">{{ form.selectedTagIds.length ? '修改标签' : '选择标签' }}</button></div><slot name="picker" /></div>
  <div class="app-actions"><button class="ghost" @click="emit('addPending')">加入待提交列表</button><button class="ghost" :disabled="!pendingDrafts.length || busy" @click="emit('commitPending')">提交暂存</button><button class="primary" :disabled="(!pendingDrafts.length && !hasUnsavedInput) || busy" @click="emit('commitAll')">直接提交</button></div>
  <TransitionGroup v-if="pendingDrafts.length" name="reorder" tag="div" class="pending-list"><div v-for="(draft, index) in pendingDrafts" :key="draft.queueId ?? index" data-reorder-scope="pending" :data-reorder-index="index" :class="{ dragging: pendingDragIndex === index }" @dragover.prevent @drop="emit('drop',index)"><span class="drag-handle" draggable="true" role="button" tabindex="0" :aria-label="`拖动排序第 ${index + 1} 条暂存账目`" @dragstart="emit('dragStart',$event,index)" @dragend="emit('dragEnd')" @pointerdown="emit('pointerStart',$event,index)" @pointermove="emit('pointerMove',$event)" @pointerup="emit('pointerFinish',$event)" @pointercancel="emit('pointerFinish',$event)" @keydown.up.prevent="emit('move',index,index - 1)" @keydown.down.prevent="emit('move',index,index + 1)"><span class="drag-grip" aria-hidden="true"></span></span><span class="pending-summary"><strong>{{ index + 1 }}. {{ { income:'收入', expense:'支出', transfer:'转移' }[draft.kind] }} · {{ occurredAtOf(draft) }}</strong><small>暂存于 {{ new Date(draft.stagedAt!).toLocaleTimeString('zh-CN') }}</small></span><span class="pending-actions"><button @click="emit('copy',index)">复制</button><button @click="emit('remove',index)">移除</button></span></div></TransitionGroup>
</template>
