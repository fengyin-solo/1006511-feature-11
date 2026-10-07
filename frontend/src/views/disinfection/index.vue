<template>
  <section class="page" data-module="disinfection">
    <header class="page-head">
      <div>
        <h2>消毒加氯管理</h2>
        <p class="page-desc">
          加氯编号下记录按 待投加 → 投加中 → 已达标 次第流转，余氯异常须处置回投加中再判；已达标锁定只补测，作废整份归档。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="goCreate">登记消毒加氯记录</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span
        v-for="item in statusSummary"
        :key="item.status"
        class="legend-item"
        :class="{ active: filters.status === item.status }"
      >
        <button type="button" class="chip-btn" @click="toggleStatus(item.status)">
          {{ item.status }}：{{ item.count }}
        </button>
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>加氯编号</span>
        <input v-model="filters.code" placeholder="按加氯编号检索" />
      </label>
      <label class="filter-item">
        <span>投加线</span>
        <select v-model="filters.line">
          <option value="">全部</option>
          <option value="一线">一线</option>
          <option value="二线">二线</option>
        </select>
      </label>
      <label class="filter-item">
        <span>班次</span>
        <input v-model="filters.keyword" placeholder="操作人员/班次/探头" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      <label class="filter-item archive-toggle">
        <input v-model="includeArchived" type="checkbox" @change="reload" />
        <span>显示已作废归档（{{ stats.archived }}）</span>
      </label>
    </form>

    <table class="data-table chlor-table">
      <thead>
        <tr>
          <th>加氯编号/版本</th>
          <th>投加线</th>
          <th>消毒方式</th>
          <th>投加量(kg)</th>
          <th>接触时间(分)</th>
          <th>余氯值(mg/L)</th>
          <th>班次/探头校准</th>
          <th>操作人员</th>
          <th>当前状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row.id" :class="{ archived: row.archived }">
          <td>
            <RouterLink class="link" :to="`/disinfection/${row.id}`">{{ row.code }}</RouterLink>
            <span class="version-tag">v{{ row.version }}</span>
            <span v-if="row.supersedesId" class="version-tag link-v">补测版</span>
          </td>
          <td>{{ row.dosingLine }}</td>
          <td>{{ row.dosingMethod }}</td>
          <td :class="{ invalid: row.doseAmount === null }">
            {{ row.doseAmount === null ? '缺登记' : row.doseAmount }}
          </td>
          <td :class="{ invalid: row.contacts.length === 0 }">
            {{ row.contacts.length === 0 ? '缺登记' : contactSummary(row) }}
          </td>
          <td>
            <span :class="residualClass(row)">{{ residualText(row) }}</span>
          </td>
          <td>
            {{ row.shiftDate }} {{ shortShift(row.shiftLabel) }}
            <span class="calib-dot" :class="calibrated(row) ? 'ok' : 'no'">
              {{ calibrated(row) ? '探头已校' : '探头未校' }}
            </span>
          </td>
          <td>{{ row.operator }}</td>
          <td>
            <span class="status-badge" :class="`st-${statusKey(row.status)}`">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <RouterLink class="link" :to="`/disinfection/${row.id}`">
              {{ row.status === '已达标' ? '查看/补测' : '明细处置' }}
            </RouterLink>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td colspan="10" class="empty-state">暂无符合条件的加氯记录，可先登记消毒加氯记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ rows.length }} 条记录，数据保存在本机浏览器</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'

import { listRecords } from '@/domain/disinfection/store'
import { findShiftCalibration } from '@/domain/disinfection/rules'
import {
  WORKFLOW_STATUSES,
  type ChlorinationRecord,
  type ChlorinationStatus,
} from '@/domain/disinfection/types'

const router = useRouter()

const rows = ref<ChlorinationRecord[]>([])
const errorMessage = ref('')
const includeArchived = ref(false)
const filters = reactive({ code: '', line: '', keyword: '', status: '' as '' | ChlorinationStatus })

const stats = ref({ total: 0, waiting: 0, running: 0, qualified: 0, abnormal: 0, failed: 0, archived: 0 })

const statCards = computed(() => [
  { label: '待投加班次', value: stats.value.waiting },
  { label: '投加中（在跑只算一份）', value: stats.value.running },
  { label: '已达标班次', value: stats.value.qualified },
  { label: '余氯异常', value: stats.value.abnormal },
  { label: '投加失败可重试', value: stats.value.failed },
])

const statusSummary = computed(() => {
  const all = listRecords(includeArchived.value)
  const ordered: ChlorinationStatus[] = [...WORKFLOW_STATUSES, '投加失败', '已作废']
  return ordered.map((status) => ({
    status,
    count: all.filter((row) => row.status === status).length,
  }))
})

function shortShift(label: string): string {
  return label.startsWith('白班') ? '白班' : '夜班'
}

function contactSummary(row: ChlorinationRecord): string {
  const points = row.contacts
    .map((item) => `${item.point.replace(/^.+#/, '#')}·${item.contactMinutes}分`)
    .join('、')
  return `${row.contacts.length}点位：${points}`
}

function calibrated(row: ChlorinationRecord): boolean {
  return Boolean(findShiftCalibration(row))
}

function residualText(row: ChlorinationRecord): string {
  if (row.residualChlorine === null) {
    return row.status === '已达标' ? '—' : '未测'
  }
  return `${row.residualChlorine.toFixed(2)} mg/L`
}

function residualClass(row: ChlorinationRecord): string {
  if (row.residualChlorine === null) {
    return 'muted'
  }
  return row.judgeConclusion === '超限' ? 'invalid' : 'ok-text'
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

function toggleStatus(status: ChlorinationStatus) {
  filters.status = filters.status === status ? '' : status
  reload()
}

function resetFilters() {
  filters.code = ''
  filters.line = ''
  filters.keyword = ''
  filters.status = ''
  reload()
}

function reload() {
  errorMessage.value = ''
  const all = listRecords(includeArchived.value)
  rows.value = all.filter((row) => {
    if (filters.code && !row.code.includes(filters.code.trim())) {
      return false
    }
    if (filters.line && row.dosingLine !== filters.line) {
      return false
    }
    if (filters.status && row.status !== filters.status) {
      return false
    }
    if (filters.keyword) {
      const key = filters.keyword.trim()
      const haystack = `${row.operator} ${row.shiftLabel} ${row.probeCode}`
      if (!haystack.includes(key)) {
        return false
      }
    }
    return true
  })
  stats.value = {
    total: listRecords(false).length,
    waiting: all.filter((r) => r.status === '待投加').length,
    running: all.filter((r) => r.status === '投加中').length,
    qualified: all.filter((r) => r.status === '已达标').length,
    abnormal: all.filter((r) => r.status === '余氯异常').length,
    failed: all.filter((r) => r.status === '投加失败').length,
    archived: listRecords(true).filter((r) => r.archived).length,
  }
}

function goCreate() {
  router.push('/disinfection/new')
}

onMounted(reload)
</script>
