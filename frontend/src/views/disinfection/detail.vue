<template>
  <section class="page" data-module="disinfection-detail">
    <header class="page-head">
      <div>
        <h2>
          加氯单 {{ row?.code ?? '' }}
          <span v-if="row" class="title-version">v{{ row.version }}</span>
          <span v-if="row" class="status-badge" :class="`badge-${row.status}`">
            {{ row.archived ? '已作废归档' : row.status }}
          </span>
          <span v-if="row?.supplementOfId" class="tag tag-info">补测新版</span>
          <span v-if="row?.failed" class="tag tag-warn">投加失败待重试</span>
        </h2>
        <p class="page-desc">
          明细页与列表页读取同一份数据；已达标记录锁定只读、作废记录整份归档只读。
        </p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" to="/disinfection">返回列表</RouterLink>
      </div>
    </header>

    <div v-if="!row" class="empty-state detail-empty">找不到这条加氯记录，可能已被重置，请回列表查看。</div>

    <template v-else>
      <div v-if="row.failed && row.failureReason" class="alert alert-warn">
        投加失败原因：{{ row.failureReason }} —— 排除问题后点「重试投加」，会重新校验投加量与接触时间。
      </div>
      <div v-if="row.status === '余氯异常' && row.abnormalReason" class="alert alert-error">
        {{ row.abnormalReason }}。余氯异常之后要先处置回投加中，才能再次判定。
      </div>
      <div v-if="row.archived" class="alert alert-muted">
        本单于 {{ row.archivedAt }} 整份作废归档，校准、判定、处置子记录一并封存，不再允许任何操作。
      </div>

      <section class="detail-grid">
        <article class="detail-card">
          <h3>投加信息</h3>
          <dl>
            <dt>投加线</dt><dd>{{ row.line }}</dd>
            <dt>加氯点</dt><dd>{{ row.point }}</dd>
            <dt>消毒方式</dt><dd>{{ row.method || '—' }}</dd>
            <dt>投加量（kg/班）</dt>
            <dd :class="{ 'cell-missing': !row.dose }">{{ row.dose || '缺失（不允许进投加中）' }}</dd>
            <dt>接触时间（分钟）</dt>
            <dd :class="{ 'cell-missing': !row.contactTime }">
              {{ row.contactTime || '缺失（不允许进投加中）' }}
              <span v-if="row.contactMeasuredAt" class="cell-sub">实测登记于 {{ formatTime(row.contactMeasuredAt) }}</span>
            </dd>
            <dt>余氯值（mg/L）</dt>
            <dd :class="`residual-${residualHint(row.residual).level}`">{{ residualHint(row.residual).text }}</dd>
            <dt>班次 / 操作人员</dt><dd>{{ row.shift }} · {{ row.operator }}</dd>
            <dt>登记时间</dt><dd>{{ formatTime(row.createdAt) }}</dd>
            <dt>开始投加时间</dt><dd>{{ row.dosedAt ? formatTime(row.dosedAt) : '—' }}</dd>
          </dl>
        </article>

        <article class="detail-card">
          <h3>状态线流转</h3>
          <ol class="status-flow">
            <li
              v-for="status in statusOrder"
              :key="status"
              class="flow-step"
              :class="flowClass(row, status)"
            >
              <span class="flow-dot"></span>
              <span class="flow-label">{{ status }}</span>
            </li>
          </ol>
          <div class="detail-actions">
            <button
              v-for="action in allowedActions(row)"
              :key="action"
              class="btn"
              :class="{ primary: action === '提交投加' || action === '重试投加' || action === '判定达标' }"
              type="button"
              @click="dialogs.openAction(action, row)"
            >
              {{ action }}
            </button>
            <button
              v-if="!row.archived && row.status !== '已达标'"
              class="btn ghost"
              type="button"
              @click="dialogs.openCalibration(row)"
            >
              登记探头校准
            </button>
          </div>
        </article>
      </section>

      <section class="detail-grid detail-grid-wide">
        <article class="detail-card">
          <h3>判定记录（同步在线水质检测待办）</h3>
          <table v-if="row.judgeHistory.length" class="data-table sub-table">
            <thead>
              <tr><th>判定时间</th><th>余氯值</th><th>结论</th><th>判定人</th><th>同步待办</th></tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in row.judgeHistory" :key="index">
                <td>{{ formatTime(item.judgedAt) }}</td>
                <td>{{ item.residual.toFixed(2) }} mg/L</td>
                <td>
                  <span class="status-badge" :class="item.result === '已达标' ? 'badge-已达标' : 'badge-余氯异常'">
                    {{ item.result }}
                  </span>
                </td>
                <td>{{ item.operator }}</td>
                <td>
                  <RouterLink v-if="item.todoId" class="link" to="/quality">在线检测待办 #{{ item.todoId }}</RouterLink>
                  <span v-else>—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="cell-sub">还没有判定记录；只有投加中的单据能判定，余氯超限会自动转异常。</p>
        </article>

        <article class="detail-card">
          <h3>异常处置记录</h3>
          <table v-if="row.disposals.length" class="data-table sub-table">
            <thead>
              <tr><th>处置时间</th><th>处置措施</th><th>处置人</th><th>结果</th></tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in row.disposals" :key="index">
                <td>{{ formatTime(item.disposedAt) }}</td>
                <td>{{ item.measures }}</td>
                <td>{{ item.operator }}</td>
                <td>{{ item.result }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="cell-sub">无异常处置记录。</p>
        </article>
      </section>

      <section class="detail-card">
        <h3>余氯探头校准（每班一次，跟着单据走）</h3>
        <table v-if="row.calibrations.length" class="data-table sub-table">
          <thead>
            <tr>
              <th>班次</th><th>校准时间</th><th>标准液(mg/L)</th><th>校准前</th><th>校准后</th><th>结果</th><th>校准人</th><th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in row.calibrations" :key="item.id">
              <td>{{ item.shift }}</td>
              <td>{{ formatTime(item.calibratedAt) }}</td>
              <td>{{ item.standardValue }}</td>
              <td>{{ item.beforeValue || '—' }}</td>
              <td>{{ item.afterValue }}</td>
              <td>{{ item.result }}</td>
              <td>{{ item.operator }}</td>
              <td>{{ item.note || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="cell-sub">本班还没有登记探头校准。</p>
      </section>

      <section class="detail-card">
        <h3>操作时间线</h3>
        <ol class="timeline">
          <li v-for="(event, index) in [...row.timeline].reverse()" :key="index">
            <span class="timeline-time">{{ formatTime(event.time) }}</span>
            <span class="timeline-title">{{ event.title }}</span>
            <span v-if="event.detail" class="timeline-detail">{{ event.detail }}</span>
          </li>
        </ol>
      </section>
    </template>

    <ActionDialog
      :open="dialogs.open.value"
      :title="dialogs.title.value"
      :hint="dialogs.hint.value"
      :fields="dialogs.fields.value"
      :initial="dialogs.initial.value"
      :error-message="dialogs.errorMessage.value"
      :confirm-text="'确认'"
      @close="dialogs.close()"
      @submit="dialogs.submit"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import ActionDialog from '@/components/ActionDialog.vue'
import { useSessionStore } from '@/stores/session'
import { getChlorination } from '@/data/disinfection/store'
import { allowedActions, residualHint, STATUS_ORDER } from '@/data/disinfection/service'
import type { ChlorinationRecord, ChlorinationStatus } from '@/data/disinfection/types'

import { useChlorinationDialogs } from './use-dialogs'

const route = useRoute()
const session = useSessionStore()

const recordId = Number(route.params.id)
// 明细与列表同读一个缓存：任何动作完成后 bump 一下计数器，强制重新取数，保证两处状态一致。
const reloadTick = ref(0)
const row = computed<ChlorinationRecord | undefined>(() => {
  void reloadTick.value
  void route.fullPath
  return getChlorination(recordId)
})

const statusOrder = STATUS_ORDER

const dialogs = useChlorinationDialogs(
  {
    operator: session.operator,
    shift: session.shiftLabel.startsWith('夜') ? '夜班' : '白班',
  },
  () => {
    reloadTick.value++
  },
)

function formatTime(value: string): string {
  return value ? value.replace('T', ' ') : '—'
}

function flowClass(record: ChlorinationRecord, status: ChlorinationStatus): string {
  const index = STATUS_ORDER.indexOf(status)
  const current = STATUS_ORDER.indexOf(record.status)
  if (record.archived) {
    return 'flow-archived'
  }
  if (index < current || record.status === '已达标') {
    return index <= current ? 'flow-done' : 'flow-todo'
  }
  if (index === current) {
    return record.status === '余氯异常' ? 'flow-abnormal' : 'flow-current'
  }
  // 异常处置后会回到投加中：投加中保持已到达过的高亮。
  if (status === '投加中' && record.disposals.length > 0) {
    return 'flow-done'
  }
  return 'flow-todo'
}
</script>
