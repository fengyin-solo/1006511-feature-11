<template>
  <section class="page detail-page" v-if="record">
    <header class="page-head">
      <div>
        <h2>
          加氯单据 {{ record.code }}
          <span class="version-tag">v{{ record.version }}</span>
          <span v-if="record.supersedesId" class="version-tag link-v">补测版</span>
        </h2>
        <p class="page-desc">
          {{ record.shiftDate }} {{ record.shiftLabel }} · {{ record.dosingLine }} ·
          {{ record.dosingMethod }} · 探头 {{ record.probeCode }} · 操作人 {{ record.operator }}
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/disinfection">返回列表</RouterLink>
        <button
          v-for="item in actions"
          :key="item.key"
          class="btn"
          :class="item.tone === 'primary' ? 'primary' : item.tone === 'danger' ? 'danger' : ''"
          type="button"
          @click="openAction(item.key)"
        >
          {{ item.action }}
        </button>
      </div>
    </header>

    <div v-if="record.archived" class="archive-banner">
      该记录已于 {{ formatDateTime(record.archivedAt) }} 整份作废归档，全程只读。原因：{{ record.archiveReason }}
    </div>

    <div v-else-if="record.status === '已达标'" class="qualified-banner">
      本班次已达标并锁定（余氯
      {{ record.residualChlorine === null ? '—' : record.residualChlorine.toFixed(2) }}mg/L），状态不再改动；需要补测只能新开一版。
    </div>

    <div class="detail-grid">
      <article class="panel">
        <h3>状态线</h3>
        <ol class="stepper">
          <li
            v-for="step in steps"
            :key="step.status"
            class="step"
            :class="stepClass(step)"
          >
            <span class="step-dot"></span>
            <div>
              <strong>{{ step.status }}</strong>
              <small>{{ step.hint }}</small>
            </div>
          </li>
        </ol>
        <dl class="kv">
          <div><dt>当前状态</dt><dd><span class="status-badge" :class="`st-${statusKey(record.status)}`">{{ record.status }}</span></dd></div>
          <div><dt>投加量</dt><dd :class="{ invalid: record.doseAmount === null }">{{ record.doseAmount === null ? '缺登记' : `${record.doseAmount} kg` }}</dd></div>
          <div><dt>实测余氯</dt><dd :class="residualClass">{{ residualText }}</dd></div>
          <div><dt>合格区间</dt><dd>{{ rangeLabel }}</dd></div>
          <div><dt>进入投加中</dt><dd>{{ formatDateTime(record.startedAt) }}</dd></div>
          <div v-if="record.failureReason"><dt>失败原因</dt><dd class="invalid">{{ record.failureReason }}</dd></div>
          <div v-if="record.disposeNote"><dt>异常处置</dt><dd>{{ record.disposeNote }}</dd></div>
        </dl>
      </article>

      <article class="panel">
        <h3>投加点实测接触时间（{{ record.dosingLine }}）</h3>
        <p class="panel-hint">加氯点分散在两条投加线上，接触时间按投加点实测登记；至少登记一个点位才允许进入投加中。</p>
        <table class="sub-table">
          <thead>
            <tr><th>投加点</th><th>接触时间(分)</th><th>登记时间</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="point in pointsOfLine" :key="point">
              <td>{{ point }}</td>
              <td :class="{ invalid: !contactOf(point) }">{{ contactOf(point)?.contactMinutes ?? '未登记' }}</td>
              <td>{{ contactOf(point) ? formatDateTime(contactOf(point)!.registeredAt) : '—' }}</td>
              <td>
                <button
                  v-if="canEdit"
                  class="link"
                  type="button"
                  @click="openContact(point)"
                >
                  {{ contactOf(point) ? '更正' : '登记' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <h3 class="panel-sub">余氯探头校准（每班一次，记录跟单据走）</h3>
        <table class="sub-table">
          <thead>
            <tr><th>班次</th><th>校准前(mg/L)</th><th>校准后(mg/L)</th><th>校准人</th><th>时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="(calib, i) in record.calibrations" :key="i">
              <td>{{ calib.shiftDate }} {{ shortShift(calib.shiftLabel) }}</td>
              <td>{{ calib.readingBefore.toFixed(2) }}</td>
              <td>{{ calib.readingAfter.toFixed(2) }}</td>
              <td>{{ calib.operator }}</td>
              <td>{{ formatDateTime(calib.calibratedAt) }}</td>
            </tr>
            <tr v-if="!record.calibrations.length">
              <td colspan="5" class="empty-state">本班探头尚未校准，余氯判定前必须先校一次</td>
            </tr>
          </tbody>
        </table>
        <button v-if="canEdit" class="btn" type="button" @click="openCalibrate">登记/挂接本班探头校准</button>
      </article>
    </div>

    <div class="detail-grid">
      <article class="panel">
        <h3>投加量登记</h3>
        <div class="inline-form">
          <input
            v-model="doseInput"
            type="number"
            min="0"
            step="0.1"
            placeholder="投加量（kg）"
            :disabled="!canEdit"
          />
          <button class="btn primary" type="button" :disabled="!canEdit" @click="submitDose">登记投加量</button>
        </div>
        <p class="panel-hint">缺投加量的记录会被拦住，不许进入投加中。</p>
      </article>

      <article class="panel">
        <h3>同编号版本链</h3>
        <ul class="version-list">
          <li v-for="item in versions" :key="item.id" :class="{ current: item.id === record.id }">
            <RouterLink class="link" :to="`/disinfection/${item.id}`">
              {{ item.code }} v{{ item.version }}
            </RouterLink>
            <span class="status-badge" :class="`st-${statusKey(item.status)}`">{{ item.status }}</span>
            <small>{{ item.shiftDate }} {{ shortShift(item.shiftLabel) }}</small>
          </li>
        </ul>
      </article>
    </div>

    <article class="panel">
      <h3>流转留痕</h3>
      <ol class="timeline">
        <li v-for="(entry, i) in [...record.logs].reverse()" :key="i">
          <span class="timeline-time">{{ formatDateTime(entry.at) }}</span>
          <div>
            <strong>{{ entry.action }}</strong>
            <span v-if="entry.fromStatus && entry.toStatus" class="timeline-flow">
              {{ entry.fromStatus }} → {{ entry.toStatus }}
            </span>
            <p>{{ entry.detail }}</p>
            <small>{{ entry.operator }}</small>
          </div>
        </li>
      </ol>
    </article>

    <footer class="page-foot">
      <span>列表页与明细页读取同一存储，状态口径一致；判定结论实时同步到「出厂水质检测」待办。</span>
      <span v-if="feedback" :class="feedbackOk ? 'ok-text' : 'error-text'">{{ feedback }}</span>
    </footer>

    <!-- 通用动作弹窗 -->
    <div v-if="activeAction" class="modal-mask" @click.self="closeAction">
      <form class="modal" @submit.prevent="submitAction">
        <h3>{{ actionMeta.title }}</h3>
        <p class="modal-tip">{{ actionMeta.tip }}</p>

        <template v-if="activeAction === 'residual'">
          <label class="form-item">
            <span>实测余氯值（mg/L）*</span>
            <input v-model.number="residualInput" type="number" min="0" step="0.01" placeholder="合格区间 0.30~4.00" />
          </label>
        </template>

        <template v-else-if="activeAction === 'contact'">
          <label class="form-item">
            <span>{{ contactPoint }} 实测接触时间（分钟）*</span>
            <input v-model.number="contactMinutes" type="number" min="1" step="1" placeholder="如 30" />
          </label>
        </template>

        <template v-else-if="activeAction === 'calibrate'">
          <div class="form-grid">
            <label class="form-item">
              <span>校准前读数 *</span>
              <input v-model.number="calibBefore" type="number" step="0.01" min="0" />
            </label>
            <label class="form-item">
              <span>校准后读数 *</span>
              <input v-model.number="calibAfter" type="number" step="0.01" min="0" />
            </label>
          </div>
          <label class="form-item">
            <span>校准人 *</span>
            <input v-model="calibOperator" />
          </label>
        </template>

        <template v-else>
          <label class="form-item">
            <span>{{ actionMeta.textLabel }} *</span>
            <textarea v-model="actionNote" rows="3" :placeholder="actionMeta.placeholder"></textarea>
          </label>
        </template>

        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeAction">取消</button>
          <button class="btn primary" type="submit">{{ actionMeta.confirm }}</button>
        </div>
      </form>
    </div>
  </section>

  <section v-else class="page">
    <p class="empty-state">没有找到这份加氯单据。</p>
    <RouterLink class="btn" to="/disinfection">返回列表</RouterLink>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'

import {
  availableActions,
  calibrateProbe,
  disposeBackToDosing,
  markAbnormal,
  markFailure,
  recordById,
  registerContact,
  registerDoseAmount,
  registerResidual,
  retryDosing,
  startDosing,
  voidRecord,
} from '@/domain/disinfection/service'
import { allRecords } from '@/domain/disinfection/store'
import { residualRangeLabel } from '@/domain/disinfection/rules'
import {
  DOSING_POINTS,
  type ChlorinationRecord,
  type ChlorinationStatus,
  type DosingPoint,
} from '@/domain/disinfection/types'

const route = useRoute()
const router = useRouter()

const record = ref<ChlorinationRecord | undefined>(undefined)
const feedback = ref('')
const feedbackOk = ref(false)

const doseInput = ref<number | null>(null)

function load() {
  feedback.value = ''
  record.value = recordById(Number(route.params.id))
  doseInput.value = record.value?.doseAmount ?? null
}
load()
onBeforeRouteUpdate(load)

const actions = computed(() => (record.value ? availableActions(record.value) : []))
const versions = computed(() =>
  record.value
    ? allRecords()
        .filter((row) => row.code === record.value!.code)
        .sort((a, b) => a.version - b.version)
    : [],
)

const canEdit = computed(
  () =>
    !!record.value &&
    !record.value.archived &&
    record.value.status !== '已达标' &&
    record.value.status !== '已作废',
)

const pointsOfLine = computed(() =>
  DOSING_POINTS.filter((point) => point.startsWith(record.value?.dosingLine ?? '一线')),
)

function contactOf(point: DosingPoint) {
  return record.value?.contacts.find((item) => item.point === point)
}

const rangeLabel = residualRangeLabel()
const residualText = computed(() => {
  const value = record.value?.residualChlorine
  if (value === null || value === undefined) {
    return '未登记'
  }
  return `${value.toFixed(2)} mg/L（${record.value?.judgeConclusion === '超限' ? '超限' : '合格'}）`
})
const residualClass = computed(() => {
  if (record.value?.judgeConclusion === '超限') {
    return 'invalid'
  }
  if (record.value?.judgeConclusion === '合格') {
    return 'ok-text'
  }
  return 'muted'
})

const steps = computed(() => {
  const status = record.value?.status
  const list: { status: ChlorinationStatus; hint: string; level: number }[] = [
    { status: '待投加', hint: '登记投加量与接触时间', level: 0 },
    { status: '投加中', hint: '提交投加后在线判定', level: 1 },
    { status: '已达标', hint: '终态锁定，只补测', level: 3 },
  ]
  if (status === '余氯异常') {
    list.splice(2, 0, { status: '余氯异常', hint: '处置后回投加中再判', level: 2 })
  }
  return list
})

const STATUS_LEVEL: Record<string, number> = {
  待投加: 0,
  投加中: 1,
  余氯异常: 2,
  投加失败: 1,
  已达标: 3,
  已作废: -1,
}

function stepClass(step: { status: ChlorinationStatus; level: number }) {
  const current = record.value?.status
  if (current === '已作废') {
    return ''
  }
  const currentLevel = STATUS_LEVEL[current ?? '待投加']
  if (step.status === current) {
    return 'active'
  }
  // 异常分支单独标：在异常时，投加中仍是上一步已完成
  if (current === '余氯异常') {
    return step.status === '投加中' || step.status === '待投加' ? 'done' : step.status === '已达标' ? 'blocked' : ''
  }
  if (current === '投加失败') {
    return step.level <= 1 && step.status !== '已达标' ? 'failed-step' : 'blocked'
  }
  return step.level < currentLevel ? 'done' : 'blocked'
}

function statusKey(status: string): string {
  const map: Record<string, string> = {
    待投加: 'waiting',
    投加中: 'running',
    已达标: 'qualified',
    余氯异常: 'abnormal',
    投加失败: 'failed',
    已作废: 'void',
  }
  return map[status] ?? 'waiting'
}

function shortShift(label: string): string {
  return label.startsWith('白班') ? '白班' : '夜班'
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/* ---------------- 动作弹窗 ---------------- */

type ActionKey =
  | 'start'
  | 'fail'
  | 'void'
  | 'residual'
  | 'abnormal'
  | 'dispose'
  | 'retry'
  | 'newVersion'
  | 'contact'
  | 'calibrate'

const activeAction = ref<ActionKey | null>(null)
const actionNote = ref('')
const residualInput = ref<number | null>(null)
const contactPoint = ref<DosingPoint | ''>('')
const contactMinutes = ref<number | null>(null)
const calibBefore = ref<number | null>(null)
const calibAfter = ref<number | null>(null)
const calibOperator = ref('')

const ACTION_META: Record<string, { title: string; tip: string; confirm: string; textLabel: string; placeholder: string }> = {
  start: { title: '提交投加', tip: '系统校验投加量与至少一个点位接触时间，且同一加氯编号没有其他在跑记录。', confirm: '确认进入投加中', textLabel: '', placeholder: '' },
  fail: { title: '登记投加失败', tip: '失败后保留已登记数据，可重试投加。', confirm: '登记失败', textLabel: '失败原因', placeholder: '如：加氯机管路漏气' },
  void: { title: '作废并整份归档', tip: '作废后列表默认隐藏、明细只读，同步出去的水质待办一并撤销。', confirm: '确认作废归档', textLabel: '作废原因', placeholder: '如：重复登记' },
  residual: { title: '登记余氯并判定', tip: `超出 ${rangeLabel} 自动切余氯异常；合格且在投加中即判达标。判定前需有本班探头校准。`, confirm: '提交判定', textLabel: '', placeholder: '' },
  abnormal: { title: '标记余氯异常', tip: '异常后必须先“处置回投加中”，才能再判定达标。', confirm: '标记异常', textLabel: '异常情况', placeholder: '如：出厂水余氯偏高' },
  dispose: { title: '处置余氯异常', tip: '填写处置措施后回到投加中，再登记余氯判定。', confirm: '处置并回投加中', textLabel: '处置说明', placeholder: '如：下调投加量并冲洗管路' },
  retry: { title: '重试投加', tip: '重新校验投加量、接触时间与在跑唯一性。', confirm: '重试提交投加', textLabel: '', placeholder: '' },
  newVersion: { title: '新开一版补测', tip: '已达标版本保持不变，新建同编号补测版。', confirm: '开立补测版', textLabel: '', placeholder: '' },
}

const actionMeta = computed(() => ACTION_META[activeAction.value ?? 'start'])

function openAction(key: string) {
  if (key === 'newVersion') {
    router.push({ path: '/disinfection/new', query: { from: String(record.value?.id) } })
    return
  }
  activeAction.value = key as ActionKey
  actionNote.value = ''
  residualInput.value = null
  const current = record.value
  if (key === 'residual' && current && current.residualChlorine !== null) {
    residualInput.value = current.residualChlorine
  }
}

function openContact(point: DosingPoint) {
  activeAction.value = 'contact'
  contactPoint.value = point
  contactMinutes.value = contactOf(point)?.contactMinutes ?? null
}

function openCalibrate() {
  activeAction.value = 'calibrate'
  calibBefore.value = null
  calibAfter.value = null
  calibOperator.value = record.value?.operator ?? ''
}

function closeAction() {
  activeAction.value = null
}

function applyResult(result: { ok: boolean; message: string }) {
  if (!result.ok) {
    feedbackOk.value = false
    feedback.value = result.message
    return
  }
  feedbackOk.value = true
  feedback.value = result.message
  activeAction.value = null
  record.value = recordById(Number(route.params.id))
}

function submitAction() {
  if (!record.value) {
    return
  }
  const id = record.value.id
  let result: { ok: boolean; message: string } = { ok: false, message: '未识别的动作' }

  switch (activeAction.value) {
    case 'start':
      result = startDosing(id)
      break
    case 'retry':
      result = retryDosing(id)
      break
    case 'fail':
      result = markFailure(id, actionNote.value)
      break
    case 'void':
      result = voidRecord(id, actionNote.value)
      break
    case 'residual':
      result = registerResidual(id, Number(residualInput.value))
      break
    case 'abnormal':
      result = markAbnormal(id, actionNote.value)
      break
    case 'dispose':
      result = disposeBackToDosing(id, actionNote.value)
      break
    case 'contact':
      result = registerContact(id, contactPoint.value as DosingPoint, Number(contactMinutes.value))
      break
    case 'calibrate':
      result = calibrateProbe(id, {
        readingBefore: Number(calibBefore.value),
        readingAfter: Number(calibAfter.value),
        operator: calibOperator.value,
      })
      break
  }
  applyResult(result)
}

function submitDose() {
  if (!record.value || doseInput.value === null) {
    feedbackOk.value = false
    feedback.value = '请填写大于 0 的投加量'
    return
  }
  applyResult(registerDoseAmount(record.value.id, Number(doseInput.value)))
}
</script>
