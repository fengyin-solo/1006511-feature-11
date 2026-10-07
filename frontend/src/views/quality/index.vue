<template>
  <section class="page" data-module="quality">
    <header class="page-head">
      <div>
        <h2>出厂水质检测管理</h2>
        <p class="page-desc">维护出厂水质检测记录，并承接消毒加氯判定同步过来的在线余氯待办：达标/异常结论都会进这张待办清单。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记出厂水质检测记录</button>
        <button class="btn" type="button" @click="exportRows">导出厂水质检测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">在线水质检测待办（加氯同步）</span>
        <strong class="stat-value stat-warn">{{ syncTodoCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">其中余氯超限</span>
        <strong class="stat-value stat-warn">{{ syncAbnormalCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已达标项目</span>
        <strong class="stat-value">{{ passedCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">未达标项目</span>
        <strong class="stat-value stat-warn">{{ failedCount }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-check">
        <input v-model="onlySyncTodo" type="checkbox" @change="reload" />
        <span>只看加氯同步的在线待办</span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>同步来源</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-sync-todo': isSyncTodo(row) }">
          <td v-for="column in columns" :key="column">
            {{ row[column] ?? '—' }}
            <span v-if="column === '检测编号' && isSyncTodo(row)" class="sync-flag">在线待办</span>
          </td>
          <td>
            <span class="status-badge" :class="qualityBadge(row)">{{ row.status }}</span>
            <span v-if="isSyncTodo(row)" class="tag" :class="row.abnormal ? 'tag-warn' : 'tag-info'">
              {{ row['同步结论'] }}
            </span>
          </td>
          <td>
            <template v-if="isSyncTodo(row)">
              消毒加氯 {{ row['来源单号'] }}
              <RouterLink class="link" :to="syncLink(row)">单据</RouterLink>
            </template>
            <span v-else class="cell-sub">人工登记</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无符合条件的水质检测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条水质检测记录，其中 {{ syncTodoCount }} 条来自消毒加氯同步</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
} from '@/api/local-service'
import { listChlorination } from '@/data/disinfection/store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('quality')
const columns = ["检测编号", "检测项目", "实测值", "标准限值", "检测方法", "检测人员", "检测日期", "水质状态"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const onlySyncTodo = ref(false)
const filterFields = columns.slice(0, 3)

function isSyncTodo(row: EntryRow): boolean {
  return String(row['来源模块'] ?? '') === '消毒加氯'
}

const syncTodoCount = computed(() => rows.value.filter(isSyncTodo).length)
const syncAbnormalCount = computed(() => rows.value.filter((row) => isSyncTodo(row) && row.abnormal).length)
const passedCount = computed(() => rows.value.filter((row) => String(row.status) === '已达标').length)
const failedCount = computed(() => rows.value.filter((row) => ['未达标'].includes(String(row.status)) || row.abnormal).length)

function qualityBadge(row: EntryRow): string {
  if (row.abnormal) {
    return 'badge-余氯异常'
  }
  return String(row.status) === '已达标' ? 'badge-已达标' : 'badge-投加中'
}

function syncLink(row: EntryRow): string {
  const source = String(row['来源单号'] ?? '')
  const match = source.match(/^(.+)-v(\d+)$/)
  if (!match) {
    return '/disinfection'
  }
  const found = listChlorination().find((item) => item.code === match[1] && item.version === Number(match[2]))
  return found ? `/disinfection/${found.id}` : '/disinfection'
}

function resetFilters() {
  filters.value = {}
  onlySyncTodo.value = false
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '出厂水质检测记录登记入口尚未接入审批流'
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    const items = onlySyncTodo.value ? payload.items.filter(isSyncTodo) : payload.items
    rows.value = items
    total.value = items.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '出厂水质检测列表读取失败'
  }
}

onMounted(reload)
</script>
