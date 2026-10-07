<template>
  <div v-if="open" class="modal-mask" @click.self="$emit('close')">
    <div class="modal-card" role="dialog" :aria-label="title">
      <header class="modal-head">
        <h3>{{ title }}</h3>
        <button class="link" type="button" @click="$emit('close')">关闭</button>
      </header>
      <p v-if="hint" class="modal-hint">{{ hint }}</p>
      <form class="modal-form" @submit.prevent="emit('submit', { ...model })">
        <label v-for="field in fields" :key="field.name" class="modal-field">
          <span>
            {{ field.label }}
            <em v-if="field.required" class="required-mark">*</em>
          </span>
          <select v-if="field.type === 'select'" v-model="model[field.name]">
            <option value="" disabled>请选择</option>
            <option v-for="option in field.options" :key="option" :value="option">{{ option }}</option>
          </select>
          <textarea
            v-else-if="field.type === 'textarea'"
            v-model="model[field.name]"
            :rows="field.rows ?? 3"
            :placeholder="field.placeholder ?? ''"
          ></textarea>
          <input
            v-else
            v-model="model[field.name]"
            :type="field.type === 'number' ? 'text' : field.type ?? 'text'"
            :placeholder="field.placeholder ?? ''"
          />
        </label>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="$emit('close')">取消</button>
          <button class="btn primary" type="submit">{{ confirmText }}</button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, watch } from 'vue'

export interface DialogField {
  name: string
  label: string
  type?: 'text' | 'number' | 'textarea' | 'select'
  required?: boolean
  placeholder?: string
  options?: string[]
  rows?: number
}

const props = defineProps<{
  open: boolean
  title: string
  hint?: string
  fields: DialogField[]
  initial?: Record<string, string>
  confirmText?: string
  errorMessage?: string
}>()

const emit = defineEmits<{
  close: []
  submit: [value: Record<string, string>]
}>()

const model = reactive<Record<string, string>>({})

watch(
  () => [props.open, props.fields],
  ([open]) => {
    if (open) {
      for (const field of props.fields) {
        model[field.name] = props.initial?.[field.name] ?? ''
      }
    }
  },
  { immediate: true },
)

defineExpose({ model })
</script>
