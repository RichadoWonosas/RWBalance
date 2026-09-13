<script setup lang="ts">
export interface LedgerDeleteForm { ledgerId: string; name: string; secret: string; confirmed: boolean }
defineProps<{ form: LedgerDeleteForm; busy: boolean }>()
const emit = defineEmits<{ backup: []; confirm: [] }>()
</script>

<template>
  <span class="eyebrow">DELETE LEDGER</span><h2>删除“{{ form.name }}”</h2>
  <p class="modal-copy">此操作会永久删除本机账本索引和加密容器，无法从应用内恢复。你可以先下载完整的 `.rwbl` 密文备份。</p>
  <button class="ghost full" :disabled="busy" @click="emit('backup')">↓ 先导出密文备份</button>
  <label>账本访问口令<input name="delete-form-secret" v-model="form.secret" type="password" autocomplete="current-password" /></label>
  <label class="delete-confirm"><input name="delete-form-confirmed" v-model="form.confirmed" type="checkbox" />我理解删除后无法恢复</label>
  <button class="danger full" :disabled="busy || !form.confirmed" @click="emit('confirm')">{{ busy ? '正在验证…' : '永久删除账本' }}</button>
</template>
