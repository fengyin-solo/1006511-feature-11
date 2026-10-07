<template>
  <section class="page" data-module="disinfection">
    <header class="page-head">
      <div>
        <h2>消毒加氯管理</h2>
        <p class="page-desc">
          状态线按「待投加 → 投加中 → 已达标 / 余氯异常」次第流转；缺投加量、接触时间不许进投加中；达标锁定只能新开补测版，作废整份归档。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="dialogs.openCreate()">登记消毒加氯记录</button>
        <button class="btn" type="button" @click="exportRows">导出消毒加氯清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待投加班次</span>
        <strong class="stat-value">{{ stats.pending }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">投加中</span>
        <strong class="stat-value">{{ stats.dosing }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已达标班次</span>
        <strong class="stat-value">{{ stats.passed }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">余氯异常</span>
        <strong class="stat-value stat-warn">{{ stats.abnormal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">失败待重试</span>
        <strong class="stat-value stat-warn">{{ stats.failed }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">作废归档</span>
        <strong class="stat-value stat-muted">{{ stats.archived }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item" :class="`legend-${item.status}`">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item legend-line">出厂水游离余氯合格区间 0.3~4.0 mg/L，超限自动转余氯异常</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>加氯编号</span>
        <input v-model="filters.code" placeholder="按加氯编号检索" />
      </label>
      <label class="filter-item">
        <span>状态</span>
        <select v-model="filters.status">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label class="filter-item">
        <span>投加线</span>
        <select v-model="filters.line">
          <option value="">全部</option>
          <option v-for="line in dosingLines" :key="line" :value="line">{{ line }}</option>
        </select>
      </label>
      <label class="filter-check">
        <input v-model="filters.includeArchived" type="checkbox" @change="reload" />
        <span>含作废归档记录</span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>加氯编号 / 版本</th>
          <th>投加线 · 加氯点</th>
          <th>消毒方式</th>
          <th>投加量(kg)</th>
          <th>接触时间(分)</th>
          <th>余氯值(mg/L)</th>
          <th>班次 / 人员</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :class="{ 'row-archived': row.archived, 'row-failed': row.failed && !row.archived }">
          <td>
            <RouterLink class="link" :to="`/disinfection/${row.id}`">{{ row.code }} · v{{ row.version }}</RouterLink>
            <span v-if="row.supplementOfId" class="tag tag-info">补测版</span>
            <span v-if="row.archived" class="tag tag-muted">已作废</span>
          </td>
          <td>{{ row.line || '—' }}<br /><span class="cell-sub">{{ row.point || '—' }}</span></td>
          <td>{{ row.method || '—' }}</td>
          <td :class="{ 'cell-missing': !row.dose }">{{ row.dose || '缺' }}</td>
          <td :class="{ 'cell-missing': !row.contactTime }">{{ row.contactTime || '缺' }}</td>
          <td>
            <span :class="`residual-${residualHint(row.residual).level}`">{{ residualHint(row.residual).text }}</span>
          </td>
          <td>{{ row.shift }}<br /><span class="cell-sub">{{ row.operator }}</span></td>
          <td>
            <span class="status-badge" :class="`badge-${row.status}`">{{ row.archived ? '已作废' : row.status }}</span>
            <span v-if="row.failed" class="tag tag-warn">失败待重试</span>
          </td>
          <td class="row-actions">
            <button
              v-for="action in allowedActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="dialogs.openAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="9" class="empty-state">暂无符合条件的消毒加氯记录，可先登记一条加氯单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条记录（{{ filters.includeArchived ? '含作废归档' : '默认隐藏作废归档' }}），列表与明细读取同一份数据</span>
      <span v-if="notice" class="notice-text">{{ notice }}</span>
      <span v-else-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

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
import { computed, onMounted, reactive, ref } from 'vue'

import ActionDialog from '@/components/ActionDialog.vue'
import { useSessionStore } from '@/stores/session'
import {
  allowedActions,
  chlorinationStats,
  downloadChlorination,
  listChlorinationRecords,
  residualHint,
} from '@/data/disinfection/service'
import { DOSING_LINES, type ChlorinationRecord, type ChlorinationStatus } from '@/data/disinfection/types'

import { useChlorinationDialogs } from './use-dialogs'

const session = useSessionStore()
const statuses: ChlorinationStatus[] = ['待投加', '投加中', '已达标', '余氯异常']
const dosingLines = [...DOSING_LINES]

const rows = ref<ChlorinationRecord[]>([])
const errorMessage = ref('')
const notice = ref('')
const filters = reactive({ code: '', status: '', line: '', includeArchived: false })

const stats = computed(() => chlorinationStats())
const total = computed(() => rows.value.length)
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => !row.archived && row.status === status).length,
  })),
)

const dialogs = useChlorinationDialogs(
  {
    operator: session.operator,
    shift: session.shiftLabel.startsWith('夜') ? '夜班' : '白班',
  },
  (message) => {
    notice.value = message
    window.setTimeout(() => (notice.value = ''), 4000)
    reload()
  },
)

function resetFilters() {
  filters.code = ''
  filters.status = ''
  filters.line = ''
  filters.includeArchived = false
  reload()
}

function exportRows() {
  downloadChlorination(rows.value)
}

function reload() {
  errorMessage.value = ''
  try {
    rows.value = listChlorinationRecords({ ...filters })
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '消毒加氯列表读取失败'
  }
}

onMounted(reload)
</script>
