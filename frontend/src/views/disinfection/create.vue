<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>{{ base ? `新开补测版：${base.code}` : '登记消毒加氯记录' }}</h2>
        <p class="page-desc">
          新建单据先落「待投加」；投加量与接触时间可在明细页补齐，缺项时会被拦在投加中之外。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" :to="base ? `/disinfection/${base.id}` : '/disinfection'">返回</RouterLink>
      </div>
    </header>

    <div v-if="base" class="qualified-banner">
      {{ base.code }} v{{ base.version }} 已达标锁定，本版为第 {{ nextVer }} 版补测，沿用上一版投加线与探头信息。
    </div>

    <form class="panel create-form" @submit.prevent="submit">
      <div class="form-grid">
        <label class="form-item">
          <span>加氯编号 *</span>
          <input v-model="form.code" :disabled="!!base" placeholder="如 CL-20261007-01" />
        </label>
        <label class="form-item">
          <span>消毒方式</span>
          <input v-model="form.dosingMethod" placeholder="液氯投加 / 次氯酸钠投加" />
        </label>
        <label class="form-item">
          <span>投加线 *</span>
          <select v-model="form.dosingLine">
            <option value="一线">一线（一线#1/#2投加点）</option>
            <option value="二线">二线（二线#1/#2投加点）</option>
          </select>
        </label>
        <label class="form-item">
          <span>余氯探头 *</span>
          <select v-model="form.probeCode">
            <option v-for="probe in PROBE_OPTIONS" :key="probe" :value="probe">{{ probe }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>班次日期 *</span>
          <input v-model="form.shiftDate" type="date" />
        </label>
        <label class="form-item">
          <span>班次 *</span>
          <select v-model="form.shiftLabel">
            <option v-for="shift in SHIFT_OPTIONS" :key="shift" :value="shift">{{ shift }}</option>
          </select>
        </label>
        <label class="form-item">
          <span>操作人员 *</span>
          <input v-model="form.operator" />
        </label>
      </div>
      <p v-if="error" class="error-text">{{ error }}</p>
      <div class="modal-actions">
        <button class="btn primary" type="submit">{{ base ? '开立补测版' : '登记为待投加' }}</button>
      </div>
    </form>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { createDraft, recordById } from '@/domain/disinfection/service'
import { PROBE_OPTIONS, SHIFT_OPTIONS } from '@/domain/disinfection/types'

const route = useRoute()
const router = useRouter()

const fromId = Number(route.query.from ?? 0) || null
const base = fromId ? recordById(fromId) : undefined
const nextVer = base ? base.version + 1 : 1

const today = new Date().toISOString().slice(0, 10)
const form = reactive({
  code: base?.code ?? '',
  dosingMethod: base?.dosingMethod ?? '液氯投加',
  dosingLine: (base?.dosingLine ?? '一线') as '一线' | '二线',
  probeCode: base?.probeCode ?? PROBE_OPTIONS[0],
  shiftDate: today,
  shiftLabel: base?.shiftLabel ?? SHIFT_OPTIONS[0],
  operator: base?.operator ?? '值班管理员',
})

const error = ref('')
const canSubmit = computed(() => true)
void canSubmit

function submit() {
  const result = createDraft({
    code: form.code,
    dosingMethod: form.dosingMethod,
    dosingLine: form.dosingLine,
    probeCode: form.probeCode,
    shiftDate: form.shiftDate,
    shiftLabel: form.shiftLabel,
    operator: form.operator,
    supersedesId: base?.id ?? null,
  })
  if (!result.ok || !result.data) {
    error.value = result.message
    return
  }
  router.replace(`/disinfection/${result.data.id}`)
}
</script>
