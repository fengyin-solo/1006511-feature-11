import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

import {
  getChlorination,
  listChlorination,
  nextChlorinationId,
  upsertChlorination,
} from './store'
import {
  CHLORINATION_STATUSES,
  RESIDUAL_MAX,
  RESIDUAL_MIN,
  type CalibrationRecord,
  type ChlorinationFilters,
  type ChlorinationRecord,
  type ChlorinationStats,
  type ChlorinationStatus,
  type ServiceResult,
} from './types'

const QUALITY_KEY = 'quality'

// 在线水质检测待办里，由消毒加氯同步过去的记录统一打这两个标记，方便回写与去重。
const SOURCE_MODULE = '消毒加氯'

function now(): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = new Date()
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fail(message: string): ServiceResult {
  return { ok: false, message }
}

function parsePositive(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') {
    return null
  }
  const num = Number(trimmed)
  return Number.isFinite(num) && num > 0 ? num : null
}

function pushEvent(row: ChlorinationRecord, title: string, detail?: string): void {
  row.timeline.push({ time: now(), title, ...(detail ? { detail } : {}) })
}

function isInFlight(row: ChlorinationRecord): boolean {
  // 在跑的只有「投加中」这一条；同一加氯编号重复投加时它只算一份。
  return row.status === '投加中'
}

function findInFlightByCode(rows: ChlorinationRecord[], code: string, exceptId?: number): boolean {
  return rows.some((row) => row.code === code && row.id !== exceptId && !row.archived && isInFlight(row))
}

function checkWritable(row: ChlorinationRecord): ServiceResult | null {
  if (row.archived) {
    return fail(`加氯单 ${row.code} v${row.version} 已作废归档，整份记录只读`)
  }
  if (row.status === '已达标') {
    return fail(`加氯单 ${row.code} v${row.version} 已达标并锁定，不能改动；需要复核请新开一版补测`)
  }
  return null
}

/** 缺投加量或接触时间的记录要校验住，不许进入投加中。 */
function validateDosingInputs(row: ChlorinationRecord): ServiceResult | null {
  if (parsePositive(row.dose) === null) {
    return fail('投加量缺失或不是正数，按投加点核定后补齐再提交投加')
  }
  if (parsePositive(row.contactTime) === null) {
    return fail('接触时间缺失或不是正数，接触时间按投加点实测登记后再提交投加')
  }
  if (!row.line || !row.point.trim()) {
    return fail('投加线与加氯点未登记，无法提交投加')
  }
  return null
}

function nextQualityId(rows: EntryRow[]): number {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

/** 判定结论同步到在线水质检测的待办；同一单据同一判定结果只保留一条。 */
function syncQualityTodo(row: ChlorinationRecord, result: '已达标' | '余氯异常', residual: number, operator: string): number {
  const rows = [...listRows(QUALITY_KEY)]
  const code = `${row.code}-v${row.version}`
  const index = rows.findIndex(
    (item) => String(item.来源模块) === SOURCE_MODULE && String(item.来源单号) === code,
  )
  const abnormal = result === '余氯异常'
  const timestamp = now()
  const fields = {
    检测编号: `QWQ-${row.code}-V${row.version}`,
    检测项目: '出厂水游离余氯（在线）',
    实测值: `${residual.toFixed(2)} mg/L`,
    标准限值: `${RESIDUAL_MIN.toFixed(1)} ~ ${RESIDUAL_MAX.toFixed(1)} mg/L`,
    检测方法: '在线余氯探头',
    检测人员: operator,
    检测日期: timestamp.slice(0, 10),
    水质状态: abnormal ? '余氯超限' : '余氯合格',
    来源模块: SOURCE_MODULE,
    来源单号: code,
    同步结论: result,
    同步时间: timestamp,
  }
  if (index >= 0) {
    rows[index] = {
      ...rows[index],
      ...fields,
      status: '待检测',
      pending: true,
      abnormal,
    }
    saveRows(QUALITY_KEY, rows)
    return Number(rows[index].id)
  }
  const id = nextQualityId(rows)
  rows.push({
    id,
    status: '待检测',
    pending: true,
    abnormal,
    ...fields,
  })
  saveRows(QUALITY_KEY, rows)
  return id
}

export interface CreateInput {
  code: string
  line: ChlorinationRecord['line']
  point: string
  method: string
  dose?: string
  contactTime?: string
  residual?: string
  operator: string
  shift: string
  supplementOfId?: number
}

/** 登记一条新的加氯记录（或在达标班次上新开一版补测）。 */
export function createChlorinationRecord(input: CreateInput): ServiceResult & { id?: number } {
  const code = input.code.trim()
  const point = input.point.trim()
  const operator = input.operator.trim()
  const method = (input.method ?? '').trim()
  if (!code) {
    return fail('加氯编号不能为空')
  }
  if (!input.line) {
    return fail('请选择投加线（加氯点分散在投加线一、投加线二）')
  }
  if (!point) {
    return fail('加氯点不能为空，接触时间按投加点实测登记')
  }
  if (!operator) {
    return fail('操作人员不能为空')
  }
  // 登记阶段允许投加量、接触时间先空着，缺参记录在提交投加时会被拦住。
  const rows = listChlorination()
  const sameCode = rows.filter((row) => row.code === code)
  if (input.supplementOfId !== undefined) {
    const source = sameCode.find((row) => row.id === input.supplementOfId)
    if (!source) {
      return fail('要补测的原班次不存在')
    }
    if (source.status !== '已达标') {
      return fail('只有已达标的班次才允许新开一版补测')
    }
    if (findInFlightByCode(rows, code)) {
      return fail(`加氯编号 ${code} 已有在跑的投加记录，补测版等它收口后再开`)
    }
  } else if (findInFlightByCode(rows, code)) {
    // 同一加氯编号重复投加时，在跑的那条只算一份。
    return fail(`加氯编号 ${code} 已有一条投加中的记录，在跑的只算一份，不能重复登记`)
  }
  const version = sameCode.reduce((max, row) => Math.max(max, row.version), 0) + 1
  const id = nextChlorinationId()
  const timestamp = now()
  const row: ChlorinationRecord = {
    id,
    code,
    version,
    ...(input.supplementOfId !== undefined ? { supplementOfId: input.supplementOfId } : {}),
    status: '待投加',
    archived: false,
    line: input.line,
    point,
    method,
    dose: input.dose?.trim() ?? '',
    contactTime: input.contactTime?.trim() ?? '',
    contactMeasuredAt: input.contactTime?.trim() ? timestamp : '',
    residual: input.residual?.trim() ?? '',
    operator,
    shift: input.shift,
    createdAt: timestamp,
    failed: false,
    judgeHistory: [],
    disposals: [],
    calibrations: [],
    timeline: [
      {
        time: timestamp,
        title: input.supplementOfId !== undefined ? '达标班次新开一版补测' : '登记加氯单',
        ...(input.supplementOfId !== undefined ? { detail: `原达标记录 #${input.supplementOfId} 已锁定` } : {}),
      },
    ],
  }
  upsertChlorination(row)
  return { ok: true, message: `加氯单 ${code} v${version} 已登记，当前状态「待投加」`, id }
}

export interface UpdateInput {
  line?: ChlorinationRecord['line']
  point?: string
  method?: string
  dose?: string
  contactTime?: string
  residual?: string
  operator?: string
  shift?: string
}

/** 补登记投加量、接触时间（投加点实测）、余氯值等字段；达标/作废记录不允许改。 */
export function updateChlorinationRecord(id: number, input: UpdateInput): ServiceResult {
  const row = getChlorination(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的加氯记录`)
  }
  const locked = checkWritable(row)
  if (locked) {
    return locked
  }
  const next: ChlorinationRecord = {
    ...row,
    line: input.line ?? row.line,
    point: input.point?.trim() || row.point,
    method: input.method !== undefined ? input.method.trim() : row.method,
    dose: input.dose !== undefined ? input.dose.trim() : row.dose,
    contactTime: input.contactTime !== undefined ? input.contactTime.trim() : row.contactTime,
    contactMeasuredAt:
      input.contactTime !== undefined && input.contactTime.trim() && input.contactTime.trim() !== row.contactTime
        ? now()
        : row.contactMeasuredAt,
    residual: input.residual !== undefined ? input.residual.trim() : row.residual,
    operator: input.operator?.trim() || row.operator,
    shift: input.shift || row.shift,
  }
  upsertChlorination(next)
  return { ok: true, message: `加氯单 ${row.code} v${row.version} 已更新` }
}

/** 待投加 → 投加中；缺投加量或接触时间一律拦住，不允许跳过这一步。 */
export function startDosing(id: number, operator: string): ServiceResult {
  const row = getChlorination(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的加氯记录`)
  }
  const locked = checkWritable(row)
  if (locked) {
    return locked
  }
  if (row.status !== '待投加') {
    return fail(`当前状态「${row.status}」不能提交投加，只有待投加的记录能进入投加中`)
  }
  const invalid = validateDosingInputs(row)
  if (invalid) {
    return invalid
  }
  if (findInFlightByCode(listChlorination(), row.code, row.id)) {
    return fail(`加氯编号 ${row.code} 已有一条投加中的记录，在跑的只算一份`)
  }
  const next: ChlorinationRecord = {
    ...row,
    status: '投加中',
    failed: false,
    failureReason: undefined,
    dosedAt: now(),
    operator: operator.trim() || row.operator,
  }
  pushEvent(next, '提交投加，进入投加中', `投加量 ${next.dose} kg，接触时间 ${next.contactTime} 分钟`)
  upsertChlorination(next)
  return { ok: true, message: `加氯单 ${row.code} v${row.version} 已进入「投加中」` }
}

/** 投加中 → 已达标 / 余氯异常；余氯超限会自己切到余氯异常，不允许从待投加直接达标。 */
export function judgeChlorination(id: number, residualInput: string, operator: string): ServiceResult {
  const row = getChlorination(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的加氯记录`)
  }
  const locked = checkWritable(row)
  if (locked) {
    return locked
  }
  if (row.status !== '投加中') {
    return fail(`当前状态「${row.status}」不能判定：跳过投加中直接达标要拦住，余氯异常要先处置回投加中`)
  }
  const residual = Number(residualInput.trim())
  if (!residualInput.trim() || !Number.isFinite(residual) || residual < 0) {
    return fail('请录入有效的余氯实测值（mg/L）后再判定')
  }
  const abnormal = residual < RESIDUAL_MIN || residual > RESIDUAL_MAX
  const result: '已达标' | '余氯异常' = abnormal ? '余氯异常' : '已达标'
  const next: ChlorinationRecord = {
    ...row,
    status: result,
    residual: residualInput.trim(),
    operator: operator.trim() || row.operator,
    ...(abnormal
      ? { abnormalReason: `余氯 ${residual.toFixed(2)} mg/L 超出 ${RESIDUAL_MIN.toFixed(1)}~${RESIDUAL_MAX.toFixed(1)} mg/L 区间` }
      : { abnormalReason: undefined }),
  }
  const todoId = syncQualityTodo(next, result, residual, next.operator)
  next.judgeHistory = [
    ...row.judgeHistory,
    { judgedAt: now(), residual, result, operator: next.operator, todoId },
  ]
  pushEvent(
    next,
    abnormal ? '判定余氯异常' : '判定已达标',
    `余氯 ${residual.toFixed(2)} mg/L，已同步在线水质检测待办（#${todoId}）`,
  )
  upsertChlorination(next)
  return {
    ok: true,
    message: abnormal
      ? `余氯 ${residual.toFixed(2)} mg/L 超限，已切到「余氯异常」并同步在线水质检测待办`
      : `余氯 ${residual.toFixed(2)} mg/L 合格，已判定「已达标」并同步在线水质检测待办`,
  }
}

/** 投加中手动标记异常（探头报警等情况），结论同样同步到在线水质检测待办。 */
export function markAbnormal(id: number, reason: string, operator: string): ServiceResult {
  const row = getChlorination(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的加氯记录`)
  }
  const locked = checkWritable(row)
  if (locked) {
    return locked
  }
  if (row.status !== '投加中') {
    return fail(`当前状态「${row.status}」不能标记异常，只有投加中的记录可以标记`)
  }
  if (!reason.trim()) {
    return fail('请填写异常情况说明')
  }
  const residual = row.residual && Number.isFinite(Number(row.residual)) ? Number(row.residual) : 0
  const next: ChlorinationRecord = {
    ...row,
    status: '余氯异常',
    abnormalReason: reason.trim(),
    operator: operator.trim() || row.operator,
  }
  const todoId = syncQualityTodo(next, '余氯异常', residual, next.operator)
  next.judgeHistory = [
    ...row.judgeHistory,
    { judgedAt: now(), residual, result: '余氯异常', operator: next.operator, todoId },
  ]
  pushEvent(next, '标记余氯异常', `${reason.trim()}；已同步在线水质检测待办（#${todoId}）`)
  upsertChlorination(next)
  return { ok: true, message: `加氯单 ${row.code} v${row.version} 已标记「余氯异常」，待处置` }
}

/** 余氯异常之后先处置，处置完成回投加中，才能再次判定。 */
export function disposeAbnormal(id: number, measures: string, operator: string): ServiceResult {
  const row = getChlorination(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的加氯记录`)
  }
  if (row.archived) {
    return fail(`加氯单 ${row.code} v${row.version} 已作废归档，不能处置`)
  }
  if (row.status !== '余氯异常') {
    return fail(`当前状态「${row.status}」不需要处置，只有余氯异常的记录要先处置回投加中`)
  }
  if (!measures.trim()) {
    return fail('请填写处置措施（如调整投加量、冲洗管路、复测余氯）')
  }
  const invalid = validateDosingInputs(row)
  if (invalid) {
    return fail(`处置后回投加中仍被校验拦住：${invalid.message}`)
  }
  const timestamp = now()
  const next: ChlorinationRecord = {
    ...row,
    status: '投加中',
    abnormalReason: undefined,
    operator: operator.trim() || row.operator,
    disposals: [
      ...row.disposals,
      { disposedAt: timestamp, measures: measures.trim(), operator: operator.trim() || row.operator, result: '已回投加中' },
    ],
  }
  pushEvent(next, '异常处置完成，回到投加中', measures.trim())
  upsertChlorination(next)
  return { ok: true, message: `加氯单 ${row.code} v${row.version} 处置完成，已回「投加中」，可以再次判定` }
}

/** 投加失败登记：投加中 → 待投加（挂失败标记），之后可重试。 */
export function registerDosingFailure(id: number, reason: string): ServiceResult {
  const row = getChlorination(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的加氯记录`)
  }
  const locked = checkWritable(row)
  if (locked) {
    return locked
  }
  if (row.status !== '投加中') {
    return fail(`当前状态「${row.status}」不能登记投加失败，只有投加中的记录可以登记`)
  }
  if (!reason.trim()) {
    return fail('请填写投加失败原因')
  }
  const next: ChlorinationRecord = {
    ...row,
    status: '待投加',
    failed: true,
    failureReason: reason.trim(),
    dosedAt: undefined,
  }
  pushEvent(next, '登记投加失败', `${reason.trim()}；回到待投加，排除后可重试`)
  upsertChlorination(next)
  return { ok: true, message: `加氯单 ${row.code} v${row.version} 已登记投加失败，回到「待投加」等待重试` }
}

/** 投加失败的记录重试：重新校验投加量、接触时间后再进投加中。 */
export function retryDosing(id: number, operator: string): ServiceResult {
  const row = getChlorination(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的加氯记录`)
  }
  if (row.archived || row.status === '已达标') {
    return checkWritable(row) ?? fail('当前记录不能重试')
  }
  if (row.status !== '待投加' || !row.failed) {
    return fail('只有投加失败、回到待投加的记录才能重试')
  }
  const invalid = validateDosingInputs(row)
  if (invalid) {
    return invalid
  }
  if (findInFlightByCode(listChlorination(), row.code, row.id)) {
    return fail(`加氯编号 ${row.code} 已有一条投加中的记录，在跑的只算一份`)
  }
  const next: ChlorinationRecord = {
    ...row,
    status: '投加中',
    failed: false,
    failureReason: undefined,
    dosedAt: now(),
    operator: operator.trim() || row.operator,
  }
  pushEvent(next, '投加失败后重试', `投加量 ${next.dose} kg，接触时间 ${next.contactTime} 分钟`)
  upsertChlorination(next)
  return { ok: true, message: `加氯单 ${row.code} v${row.version} 重试成功，已回「投加中」` }
}

/** 作废：整份归档（含校准、判定、处置子记录），列表默认隐藏，明细只读。 */
export function archiveChlorination(id: number, reason: string): ServiceResult {
  const row = getChlorination(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的加氯记录`)
  }
  if (row.archived) {
    return fail(`加氯单 ${row.code} v${row.version} 已经是作废归档状态`)
  }
  if (row.status === '已达标') {
    return fail('已达标的班次不能作废，如需复核请新开一版补测')
  }
  if (!reason.trim()) {
    return fail('请填写作废原因')
  }
  const timestamp = now()
  const next: ChlorinationRecord = {
    ...row,
    archived: true,
    archivedAt: timestamp,
  }
  pushEvent(next, '整份作废归档', reason.trim())
  upsertChlorination(next)
  return { ok: true, message: `加氯单 ${row.code} v${row.version} 已整份作废归档` }
}

/** 在已达标的班次上新开一版补测（原记录保持锁定）。 */
export function openSupplement(id: number, operator: string, shift: string): ServiceResult & { id?: number } {
  const row = getChlorination(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的加氯记录`)
  }
  return createChlorinationRecord({
    code: row.code,
    line: row.line,
    point: row.point,
    method: row.method,
    operator,
    shift,
    supplementOfId: row.id,
  })
}

export interface CalibrationInput {
  shift: string
  standardValue: string
  beforeValue: string
  afterValue: string
  operator: string
  result: string
  note: string
}

/** 余氯探头每班校一次，记录跟着单据走；同一班次重复校准要拦住。 */
export function addCalibration(id: number, input: CalibrationInput): ServiceResult {
  const row = getChlorination(id)
  if (!row) {
    return fail(`没有找到编号为 ${id} 的加氯记录`)
  }
  const locked = checkWritable(row)
  if (locked) {
    return locked
  }
  if (!input.shift.trim()) {
    return fail('请选择校准班次')
  }
  if (row.calibrations.some((item) => item.shift === input.shift.trim())) {
    return fail(`该加氯单 ${input.shift} 已经登记过一次探头校准，每班只校一次`)
  }
  const standard = Number(input.standardValue)
  const after = Number(input.afterValue)
  if (!Number.isFinite(standard) || !Number.isFinite(after)) {
    return fail('标准液浓度与校准后示值必须是数字')
  }
  const timestamp = now()
  const calibration: CalibrationRecord = {
    id: row.calibrations.reduce((max, item) => Math.max(max, item.id), 0) + 1,
    shift: input.shift.trim(),
    calibratedAt: timestamp,
    standardValue: input.standardValue.trim(),
    beforeValue: input.beforeValue.trim(),
    afterValue: input.afterValue.trim(),
    operator: input.operator.trim() || row.operator,
    result: input.result || (Math.abs(after - standard) <= 0.05 ? '合格' : '需调整'),
    note: input.note.trim(),
  }
  const next: ChlorinationRecord = { ...row, calibrations: [...row.calibrations, calibration] }
  pushEvent(next, `余氯探头校准（${calibration.shift}）`, `结果：${calibration.result}`)
  upsertChlorination(next)
  return { ok: true, message: `已登记 ${calibration.shift} 探头校准记录，随单据保存` }
}

export function listChlorinationRecords(filters: ChlorinationFilters): ChlorinationRecord[] {
  const code = filters.code.trim()
  return listChlorination()
    .filter((row) => (filters.includeArchived ? true : !row.archived))
    .filter((row) => (code ? row.code.includes(code) : true))
    .filter((row) => (filters.status ? row.status === filters.status : true))
    .filter((row) => (filters.line ? row.line === filters.line : true))
    .sort((a, b) => (a.code === b.code ? b.version - a.version : a.code.localeCompare(b.code)))
}

export function chlorinationStats(rows: ChlorinationRecord[] = listChlorination()): ChlorinationStats {
  return {
    pending: rows.filter((row) => !row.archived && row.status === '待投加').length,
    dosing: rows.filter((row) => !row.archived && row.status === '投加中').length,
    passed: rows.filter((row) => !row.archived && row.status === '已达标').length,
    abnormal: rows.filter((row) => !row.archived && row.status === '余氯异常').length,
    failed: rows.filter((row) => !row.archived && row.failed).length,
    archived: rows.filter((row) => row.archived).length,
  }
}

export function residualHint(value: string): { level: 'ok' | 'high' | 'low' | 'empty'; text: string } {
  const trimmed = value.trim()
  if (!trimmed) {
    return { level: 'empty', text: '未测' }
  }
  const num = Number(trimmed)
  if (!Number.isFinite(num)) {
    return { level: 'empty', text: trimmed }
  }
  if (num < RESIDUAL_MIN) {
    return { level: 'low', text: `${trimmed}（低于下限）` }
  }
  if (num > RESIDUAL_MAX) {
    return { level: 'high', text: `${trimmed}（高于上限）` }
  }
  return { level: 'ok', text: trimmed }
}

export function exportChlorinationCsv(rows: ChlorinationRecord[]): { filename: string; content: string } {
  const header = ['加氯编号', '版本', '投加线', '加氯点', '消毒方式', '投加量(kg)', '接触时间(分钟)', '余氯值(mg/L)', '操作人员', '班次', '当前状态', '失败标记', '归档']
  const lines = [header.join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.code,
        `v${row.version}`,
        row.line,
        row.point,
        row.method,
        row.dose,
        row.contactTime,
        row.residual,
        row.operator,
        row.shift,
        row.archived ? '已作废归档' : row.status,
        row.failed ? '投加失败待重试' : '',
        row.archived ? (row.archivedAt ?? '') : '',
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','),
    )
  }
  return { filename: '消毒加氯-清单.csv', content: `﻿${lines.join('\n')}` }
}

export function downloadChlorination(rows: ChlorinationRecord[]): void {
  const { filename, content } = exportChlorinationCsv(rows)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function allowedActions(row: ChlorinationRecord): string[] {
  if (row.archived) {
    return []
  }
  switch (row.status) {
    case '待投加':
      return row.failed ? ['重试投加', '补登记字段', '作废归档'] : ['提交投加', '补登记字段', '作废归档']
    case '投加中':
      return ['判定达标', '标记异常', '投加失败', '补登记字段', '作废归档']
    case '余氯异常':
      return ['处置回投加中', '作废归档']
    case '已达标':
      return ['新开一版补测']
    default:
      return []
  }
}

export const STATUS_ORDER: ChlorinationStatus[] = [...CHLORINATION_STATUSES]
