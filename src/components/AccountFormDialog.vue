<script setup lang="ts">
import { currencyRules, formatMinorUnits } from '../core/domain/money'
import { currencies, type Account, type BalanceMap, type Currency } from '../core/domain/types'

export interface AccountCreateForm { name: string; pending: boolean; initial: Record<Currency, string> }
export interface AccountEditForm { id: string; name: string; pending: boolean }

defineProps<{
  mode: 'create' | 'edit' | 'delete'
  createForm: AccountCreateForm
  editForm: AccountEditForm
  deleteTarget?: Account
  balances: BalanceMap
  busy: boolean
}>()
const emit = defineEmits<{ close: []; create: []; save: []; delete: [] }>()
</script>

<template>
  <template v-if="mode === 'create'"><span class="eyebrow">NEW ACCOUNT</span><h2>添加账户</h2><div class="form-grid"><label>账户名称<input name="account-form-name" v-model="createForm.name" placeholder="例如：日常银行卡" /></label><label class="checkbox"><input name="account-form-pending" v-model="createForm.pending" type="checkbox" />设为待支出账户</label><label v-for="currency in currencies" :key="currency">{{ currency }} 初始金额<input name="account-form-initial-currency" v-model="createForm.initial[currency]" type="number" min="0" :max="currencyRules[currency].maxMinorUnits / 10 ** currencyRules[currency].fractionDigits" :step="10 ** -currencyRules[currency].fractionDigits" /></label></div><button class="primary" :disabled="busy" @click="emit('create')">保存账户</button></template>
  <template v-else-if="mode === 'edit'"><span class="eyebrow">EDIT ACCOUNT</span><h2>编辑账户</h2><label>账户名称<input name="account-edit-form-name" v-model="editForm.name" autofocus /></label><label class="delete-confirm"><input name="account-edit-form-pending" v-model="editForm.pending" type="checkbox" />设置为待支出账户</label><p class="modal-copy">修改余额分类不会产生资金账目；初始金额创建后不可直接修改。</p><button class="primary full" :disabled="busy" @click="emit('save')">保存修改</button></template>
  <template v-else><span class="eyebrow">DELETE ACCOUNT</span><h2>删除“{{ deleteTarget?.name }}”</h2><p class="modal-copy">确认后账户将被逻辑删除，并为以下四个币种分别生成系统支出记录；零余额也会保留 0 金额记录。</p><div class="impact-list"><div v-for="currency in currencies" :key="currency"><span>{{ currency }}</span><strong>{{ formatMinorUnits(balances[deleteTarget?.id ?? '']?.[currency] ?? 0, currency) }}</strong></div></div><div class="modal-actions"><button class="ghost" @click="emit('close')">取消</button><button class="danger" :disabled="busy" @click="emit('delete')">确认删除账户</button></div></template>
</template>
