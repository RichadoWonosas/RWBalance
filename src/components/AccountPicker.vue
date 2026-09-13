<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PickerDialog from './PickerDialog.vue'
import type { Account } from '../core/domain/types'

const props = defineProps<{
  accounts: Account[]
  modelValue: string
  placeholder: string
  searchPlaceholder: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)
const search = ref('')
const selectedAccount = computed(() => props.accounts.find((account) => account.id === props.modelValue))
const normalizedSearch = computed(() => search.value.trim().normalize('NFKC').toLocaleLowerCase())
const filteredAccounts = computed(() => props.accounts.filter((account) => account.name.normalize('NFKC').toLocaleLowerCase().includes(normalizedSearch.value)))

watch(open, (isOpen) => { if (!isOpen) search.value = '' })

function choose(accountId: string) {
  emit('update:modelValue', accountId)
  open.value = false
}
</script>

<template>
  <div class="account-picker">
    <button class="account-picker-trigger" type="button" :aria-expanded="open" @click="open = !open">
      <span :class="{ placeholder: !selectedAccount }">{{ selectedAccount?.name || placeholder }}</span>
      <span class="disclosure-triangle" :class="{ expanded: open }" aria-hidden="true"></span>
    </button>
    <PickerDialog :open="open" :title="placeholder" @close="open = false">
      <div class="collapse-content">
        <section class="account-picker-panel">
          <input name="account-search" :aria-label="searchPlaceholder" v-model="search" :placeholder="searchPlaceholder" :tabindex="open ? 0 : -1" />
          <div class="account-picker-options">
            <button
              v-for="account in filteredAccounts"
              :key="account.id"
              type="button"
              class="tag-chip"
              :class="{ selected: account.id === modelValue }"
              :tabindex="open ? 0 : -1"
              @click="choose(account.id)"
            >{{ account.name }}</button>
            <span v-if="!filteredAccounts.length" class="account-picker-empty">没有匹配的账户</span>
          </div>
        </section>
      </div>
    </PickerDialog>
  </div>
</template>
