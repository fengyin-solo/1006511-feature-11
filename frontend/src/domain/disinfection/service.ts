import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

import {
  canTransition,
  ensureNoRunningSibling,
  ensureProbeCalibrated,
  ensureReadyToDose,
  ensureTransition,
  isTerminal,
  judgeResidual,
  residualRangeLabel,
} from './rules'
import {
  QUALITY_LINK_FIELD,
  allRecords,
  getRecord,
  listRecords,
  nextRecordId,
  nextVersion,
  qualityTag,
  saveRecords,
} from './store'
import {
  DOSING_POINTS,
  type ChlorinationRecord,
  type ChlorinationStatus,
  type CreateDraftInput,
  type DosingPoint,
  type ServiceResult,
} from './types'

function nowIso(): string {
  return new Date().toISOString()
}

function fail(message: string): ServiceResult<ChlorinationRecord> {
  return { ok: false, message }
}

/** 用 id 定位单据，回写后落盘；回调里直接改 draft。 */
function mutate(
  id: number,
  fn: (record: ChlorinationRecord, rows: ChlorinationRecord[]) => ServiceResult<unknown>,
): ServiceResult<ChlorinationRecord> {
  const rows = allRecords()
  const index = rows.findIndex((row) => row.id === id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的加氯单据`)
  }
  const record = rows[index]
  const result = fn(record, rows)
  if (!result.ok) {
    return { ok: false, message: result.message }
  }
  saveRecords(rows)
  return { ok: true, message: result.message, data: record }
}

/* ---------------- 与「出厂水质检测」待办的同步 ---------------- */

function qualityRows(): EntryRow[] {
  return listRows('quality')
}

function qualitySerial(rows: EntryRow[]): string {
  const max = rows.reduce((acc, row) => {
    const match = /^CLQ-(\d+)$/.exec(String(row.检测编号 ?? ''))
    return match ? Math.max(acc, Number(match[1])) : acc
  }, 0)
  return `CLQ-${String(max + 1).padStart(4, '0')}`
}

/** 加氯判定结论同步到在线水质检测待办；同一单据版本只维护一条，靠加氯单据字段去重。 */
function syncQualityTodo(
  record: ChlorinationRecord,
  status: '检测中' | '已达标' | '未达标',
): void {
  const rows = qualityRows()
  const tag = qualityTag(record)
  const index = rows.findIndex((row) => String(row[QUALITY_LINK_FIELD] ?? '') === tag)
  const base: EntryRow = {
    id: 0,
    status,
    pending: status !== '已达标',
    abnormal: status === '未达标',
    检测编号: '',
    检测项目: '出厂水余氯（加氯复核）',
    实测值: record.residualChlorine ?? '',
    标准限值: residualRangeLabel(),
    检测方法: '在线余氯探头',
    检测人员: record.operator,
    检测日期: record.residualCheckedAt
      ? record.residualCheckedAt.slice(0, 10)
      : record.shiftDate,
    水质状态: status,
    [QUALITY_LINK_FIELD]: tag,
  }
  if (index >= 0) {
    rows[index] = { ...rows[index], ...base, id: rows[index].id, 检测编号: rows[index].检测编号 }
  } else {
    const used = new Set(rows.map((row) => Number(row.id)))
    let id = 9000
    while (used.has(id)) {
      id += 1
    }
    rows.push({ ...base, id, 检测编号: qualitySerial(rows) })
  }
  saveRows('quality', rows)
}

function removeQualityTodo(record: ChlorinationRecord): void {
  const tag = qualityTag(record)
  const rows = qualityRows().filter((row) => String(row[QUALITY_LINK_FIELD] ?? '') !== tag)
  saveRows('quality', rows)
}

/* ---------------- 登记与补测 ---------------- */

export function createDraft(input: CreateDraftInput): ServiceResult<ChlorinationRecord> {
  const code = input.code.trim()
  if (!code) {
    return fail('加氯编号不能为空')
  }
  if (!input.operator.trim()) {
    return fail('操作人员不能为空')
  }
  if (!input.shiftDate) {
    return fail('请选择班次日期')
  }
  if (!DOSING_POINTS.some((point) => point.startsWith(input.dosingLine))) {
    return fail('请选择投加线')
  }

  const rows = allRecords()
  let version = 1
  let supersedesId: number | null = input.supersedesId ?? null

  if (supersedesId !== null) {
    const base = rows.find((row) => row.id === supersedesId)
    if (!base || base.code !== code) {
      return fail('补测底版不存在或加氯编号不一致')
    }
    if (base.status !== '已达标') {
      return fail('只有已达标的班次才允许新开一版补测')
    }
  }

  const siblings = rows.filter((row) => row.code === code)
  if (supersedesId === null) {
    // 已达标后只许新开补测版，不许另起一份普通单据。
    if (siblings.some((row) => row.status === '已达标' && !row.archived)) {
      return fail(`加氯编号 ${code} 已有达标班次，补测请使用「新开一版补测」`)
    }
    if (siblings.some((row) => !row.archived)) {
      // 同一编号已有在途单据（含在跑/失败），普通新登记要拦住，避免重复投加。
      const running = siblings.find((row) => !row.archived && (row.status === '投加中' || row.status === '余氯异常'))
      if (running) {
        return fail(`加氯编号 ${code} 已有 v${running.version} 在跑，在跑的只算一份`)
      }
    }
    version = siblings.length === 0 ? 1 : nextVersion(code)
  } else {
    version = nextVersion(code)
    // 补测版在跑期间，同一编号也不能再多开。
    const active = siblings.find(
      (row) => !row.archived && (row.status === '待投加' || row.status === '投加中' || row.status === '余氯异常' || row.status === '投加失败'),
    )
    if (active && active.id !== supersedesId) {
      return fail(`加氯编号 ${code} 已有 v${active.version} 在途，等该版收尾后再开补测`)
    }
  }

  // 同一编号在跑唯一性（覆盖两种入口）。
  const runningGuard = ensureNoRunningSibling(code, -1, rows)
  if (!runningGuard.ok && supersedesId === null) {
    return { ok: false, message: runningGuard.message }
  }

  const record: ChlorinationRecord = {
    id: nextRecordId(),
    code,
    version,
    status: '待投加',
    dosingMethod: input.dosingMethod.trim() || '液氯投加',
    dosingLine: input.dosingLine,
    probeCode: input.probeCode,
    shiftLabel: input.shiftLabel,
    shiftDate: input.shiftDate,
    operator: input.operator.trim(),
    doseAmount: null,
    createdAt: nowIso(),
    startedAt: null,
    residualChlorine: null,
    residualCheckedAt: null,
    judgeConclusion: '待判定',
    failureReason: null,
    disposeNote: null,
    supersedesId,
    archived: false,
    archivedAt: null,
    archiveReason: null,
    contacts: [],
    calibrations: [],
    logs: [
      {
        at: nowIso(),
        action: supersedesId === null ? '登记单据' : '新开补测版',
        operator: input.operator.trim(),
        detail:
          supersedesId === null
            ? '新开消毒加氯单据，待登记投加量与接触时间'
            : `v${version - 1}已达标锁定，新开第${version}版安排补测`,
        toStatus: '待投加',
      },
    ],
  }
  rows.push(record)
  saveRecords(rows)
  return { ok: true, message: `已登记 ${code} v${version}（待投加）`, data: record }
}

/* ---------------- 投加量 / 点位接触时间 ---------------- */

export function registerDoseAmount(id: number, amount: number): ServiceResult<ChlorinationRecord> {
  if (!Number.isFinite(amount) || amount <= 0) {
    return fail('投加量需为大于 0 的数值（kg）')
  }
  return mutate(id, (record) => {
    if (record.archived || isTerminal(record.status)) {
      return fail(isTerminal(record.status) ? '已达标的班次不能再改动投加量，请新开一版补测' : '已作废归档的单据只读')
    }
    record.doseAmount = amount
    record.logs.push({
      at: nowIso(),
      action: '登记投加量',
      operator: record.operator,
      detail: `登记投加量 ${amount}kg`,
    })
    return { ok: true, message: '投加量已登记' }
  })
}

export function registerContact(
  id: number,
  point: DosingPoint,
  minutes: number,
): ServiceResult<ChlorinationRecord> {
  if (!DOSING_POINTS.includes(point)) {
    return fail('投加点不在两条投加线的登记范围内')
  }
  if (!Number.isInteger(minutes) || minutes <= 0) {
    return fail('接触时间需为大于 0 的整数（分钟）')
  }
  return mutate(id, (record) => {
    if (record.archived || record.status === '已作废') {
      return fail('已作废归档的单据只读，不能登记接触时间')
    }
    if (record.status === '已达标') {
      return fail('该班次已达标锁定，接触时间不能再改，请新开一版补测')
    }
    if (!point.startsWith(record.dosingLine)) {
      return fail(`${point}不属于${record.dosingLine}，请登记本投加线上的点位`)
    }
    const existing = record.contacts.findIndex((item) => item.point === point)
    if (existing >= 0) {
      const before = record.contacts[existing].contactMinutes
      record.contacts[existing] = { point, contactMinutes: minutes, registeredAt: nowIso() }
      record.logs.push({
        at: nowIso(),
        action: '更正接触时间',
        operator: record.operator,
        detail: `${point}接触时间由 ${before} 分钟更正为 ${minutes} 分钟`,
      })
      return { ok: true, message: `${point}接触时间已更正为 ${minutes} 分钟` }
    }
    record.contacts.push({ point, contactMinutes: minutes, registeredAt: nowIso() })
    record.logs.push({
      at: nowIso(),
      action: '登记接触时间',
      operator: record.operator,
      detail: `${point}实测接触时间 ${minutes} 分钟`,
    })
    return { ok: true, message: `${point}接触时间已登记（${minutes} 分钟）` }
  })
}

/* ---------------- 余氯探头校准（每班一次，记录跟单据走） ---------------- */

export function calibrateProbe(
  id: number,
  input: { readingBefore: number; readingAfter: number; operator: string },
): ServiceResult<ChlorinationRecord> {
  if (![input.readingBefore, input.readingAfter].every((value) => Number.isFinite(value) && value >= 0)) {
    return fail('校准前后读数需为不小于 0 的数值（mg/L）')
  }
  if (!input.operator.trim()) {
    return fail('请填写校准操作人员')
  }
  return mutate(id, (record, rows) => {
    if (record.archived || record.status === '已作废') {
      return fail('已作废归档的单据只读，不能登记校准')
    }
    if (record.status === '已达标') {
      return fail('该班次已达标锁定，探头校准请挂到新补测版上')
    }
    const key = (item: { probeCode: string; shiftLabel: string; shiftDate: string }) =>
      `${item.probeCode}|${item.shiftLabel}|${item.shiftDate}`
    const targetKey = key({
      probeCode: record.probeCode,
      shiftLabel: record.shiftLabel,
      shiftDate: record.shiftDate,
    })

    // 本单据已挂同班次校准：每班只许一次。
    if (record.calibrations.some((item) => key(item) === targetKey)) {
      return fail(`${record.probeCode} 在 ${record.shiftDate} ${record.shiftLabel} 已校准过，每班只校一次`)
    }

    // 别的在跑/在途单据是否已经为同一探头同一班次做过校准。
    const owner = rows.find(
      (row) =>
        row.id !== record.id &&
        !row.archived &&
        row.calibrations.some((item) => key(item) === targetKey),
    )
    if (owner) {
      // 同一班次已有校准：把既有校准快照挂到本单据上复用，不再新建第二条。
      const shared = owner.calibrations.find((item) => key(item) === targetKey)!
      record.calibrations.push({ ...shared })
      record.logs.push({
        at: nowIso(),
        action: '挂接探头校准',
        operator: input.operator.trim(),
        detail: `复用 ${owner.code} v${owner.version} 已登记的 ${record.probeCode} 本班校准（${shared.readingBefore}→${shared.readingAfter} mg/L）`,
      })
      return { ok: true, message: '本班探头已在其他单据校准，已把校准记录挂接到本单据' }
    }

    record.calibrations.push({
      probeCode: record.probeCode,
      shiftLabel: record.shiftLabel,
      shiftDate: record.shiftDate,
      readingBefore: input.readingBefore,
      readingAfter: input.readingAfter,
      operator: input.operator.trim(),
      calibratedAt: nowIso(),
    })
    record.logs.push({
      at: nowIso(),
      action: '探头校准',
      operator: input.operator.trim(),
      detail: `${record.probeCode} 本班校准：${input.readingBefore}→${input.readingAfter} mg/L`,
    })
    return { ok: true, message: `${record.probeCode} 本班校准已登记并跟随本单据` }
  })
}

/* ---------------- 状态线流转 ---------------- */

function applyTransition(
  record: ChlorinationRecord,
  target: ChlorinationStatus,
  action: string,
  detail: string,
  onEnter?: (record: ChlorinationRecord) => void,
): ServiceResult<unknown> {
  const guard = ensureTransition(record, target)
  if (!guard.ok) {
    return guard
  }
  const from = record.status
  record.status = target
  onEnter?.(record)
  record.logs.push({
    at: nowIso(),
    action,
    operator: record.operator,
    detail,
    fromStatus: from,
    toStatus: target,
  })
  return { ok: true, message: '' }
}

/** 待投加/投加失败 → 投加中：校验投加量、接触时间、同编号在跑唯一，并挂水质检测待办。 */
export function startDosing(id: number): ServiceResult<ChlorinationRecord> {
  return mutate(id, (record, rows) => {
    const ready = ensureReadyToDose(record)
    if (!ready.ok) {
      return ready
    }
    const unique = ensureNoRunningSibling(record.code, record.id, rows)
    if (!unique.ok) {
      return unique
    }
    const result = applyTransition(
      record,
      '投加中',
      '提交投加',
      `投加量${record.doseAmount}kg，${record.contacts.length}个点位接触时间已登记`,
      (draft) => {
        draft.startedAt = nowIso()
      },
    )
    if (!result.ok) {
      return result
    }
    syncQualityTodo(record, '检测中')
    return { ok: true, message: '已进入投加中，并已同步一条出厂水余氯检测待办' }
  })
}

/** 投加失败登记：投加中也允许失败；失败后可重试，不丢已登记数据。 */
export function markFailure(id: number, reason: string): ServiceResult<ChlorinationRecord> {
  if (!reason.trim()) {
    return fail('请填写投加失败原因，便于重试前排查')
  }
  return mutate(id, (record) => {
    if (!canTransition(record.status, '投加失败')) {
      return fail(`「${record.status}」状态下不能登记投加失败`)
    }
    const result = applyTransition(
      record,
      '投加失败',
      '登记投加失败',
      reason.trim(),
      (draft) => {
        draft.failureReason = reason.trim()
      },
    )
    if (!result.ok) {
      return result
    }
    removeQualityTodo(record)
    return { ok: true, message: '已登记为投加失败，可在补齐条件后重试提交投加' }
  })
}

/** 失败重试：重新走进入投加中的全部校验。 */
export function retryDosing(id: number): ServiceResult<ChlorinationRecord> {
  return mutate(id, (record, rows) => {
    if (record.status !== '投加失败') {
      return fail('只有投加失败的记录可以重试')
    }
    const ready = ensureReadyToDose(record)
    if (!ready.ok) {
      return ready
    }
    const unique = ensureNoRunningSibling(record.code, record.id, rows)
    if (!unique.ok) {
      return unique
    }
    const reason = record.failureReason ?? '前次投加失败'
    record.failureReason = null
    const result = applyTransition(
      record,
      '投加中',
      '重试投加',
      `按「${reason}」排查后重新提交投加`,
      (draft) => {
        draft.startedAt = nowIso()
      },
    )
    if (!result.ok) {
      return result
    }
    syncQualityTodo(record, '检测中')
    return { ok: true, message: '重试成功，已重新进入投加中' }
  })
}

/** 登记实测余氯值；超限当场自动切余氯异常，合格则按当前状态走判定。 */
export function registerResidual(
  id: number,
  value: number,
): ServiceResult<ChlorinationRecord> {
  if (!Number.isFinite(value) || value < 0) {
    return fail('实测余氯值需为不小于 0 的数值（mg/L）')
  }
  return mutate(id, (record) => {
    if (record.archived || record.status === '已作废') {
      return fail('已作废归档的单据只读')
    }
    if (record.status === '已达标') {
      return fail('该班次已达标锁定，余氯补测请新开一版')
    }
    if (record.status !== '投加中' && record.status !== '余氯异常') {
      return fail(`「${record.status}」状态下不能登记余氯实测，请先提交投加`)
    }
    const calibration = ensureProbeCalibrated(record)
    if (!calibration.ok) {
      return calibration
    }
    const verdict = judgeResidual(record, value)
    if (!verdict.ok || !verdict.data) {
      return verdict
    }
    record.residualChlorine = value
    record.residualCheckedAt = nowIso()

    if (verdict.data.kind === 'over') {
      const from = record.status
      record.status = '余氯异常'
      record.judgeConclusion = '超限'
      record.logs.push({
        at: nowIso(),
        action: '余氯判定',
        operator: record.operator,
        detail: `余氯${value.toFixed(2)}mg/L超出上限，自动切为余氯异常，待处置后回投加中`,
        fromStatus: from,
        toStatus: '余氯异常',
      })
      syncQualityTodo(record, '未达标')
      return { ok: true, message: `余氯 ${value.toFixed(2)}mg/L 超限，已自动切为余氯异常，并同步未达标待办` }
    }

    // 合格但当前是余氯异常：不允许直接达标，必须先处置回投加中再判。
    if (record.status === '余氯异常') {
      record.judgeConclusion = '合格'
      record.logs.push({
        at: nowIso(),
        action: '登记余氯',
        operator: record.operator,
        detail: `余氯${value.toFixed(2)}mg/L已回到合格区间，仍须先“处置回投加中”再判定达标`,
      })
      return { ok: true, message: '余氯已回到合格区间，请先处置回投加中，再做达标判定' }
    }

    // 投加中 + 合格：判达标。
    const from = record.status
    record.status = '已达标'
    record.judgeConclusion = '合格'
    record.logs.push({
      at: nowIso(),
      action: '判定达标',
      operator: record.operator,
      detail: `余氯${value.toFixed(2)}mg/L处于${residualRangeLabel()}合格区间，班次锁定`,
      fromStatus: from,
      toStatus: '已达标',
    })
    syncQualityTodo(record, '已达标')
    return { ok: true, message: `余氯 ${value.toFixed(2)}mg/L 合格，已判定达标并锁定，水质待办同步达标` }
  })
}

/** 手动标记异常（不依赖实测值的现场异常上报）。 */
export function markAbnormal(id: number, note: string): ServiceResult<ChlorinationRecord> {
  if (!note.trim()) {
    return fail('请填写余氯异常情况说明')
  }
  return mutate(id, (record) => {
    const result = applyTransition(
      record,
      '余氯异常',
      '标记余氯异常',
      note.trim(),
    )
    if (!result.ok) {
      return result
    }
    record.judgeConclusion = '超限'
    syncQualityTodo(record, '未达标')
    return { ok: true, message: '已标记余氯异常，并同步未达标待办' }
  })
}

/** 异常处置：余氯异常必须先处置回投加中，才能再做达标判定。 */
export function disposeBackToDosing(
  id: number,
  note: string,
): ServiceResult<ChlorinationRecord> {
  if (!note.trim()) {
    return fail('请填写异常处置说明（如调整投加量、冲洗管路等）')
  }
  return mutate(id, (record, rows) => {
    const unique = ensureNoRunningSibling(record.code, record.id, rows)
    if (!unique.ok) {
      return unique
    }
    const result = applyTransition(
      record,
      '投加中',
      '处置回投加中',
      note.trim(),
      (draft) => {
        draft.disposeNote = note.trim()
      },
    )
    if (!result.ok) {
      return result
    }
    syncQualityTodo(record, '检测中')
    return { ok: true, message: '异常已处置，回到投加中，可重新登记余氯判定' }
  })
}

/** 作废：整份归档（含点位接触与探头校准记录），并撤销同步出去的水质待办。 */
export function voidRecord(id: number, reason: string): ServiceResult<ChlorinationRecord> {
  if (!reason.trim()) {
    return fail('请填写作废原因，作废后整份归档')
  }
  return mutate(id, (record) => {
    if (record.status === '已达标') {
      return fail('已达标的班次不能作废；确需纠正请新开一版补测')
    }
    if (record.archived || record.status === '已作废') {
      return fail('该单据已作废归档')
    }
    const from = record.status
    record.status = '已作废'
    record.archived = true
    record.archivedAt = nowIso()
    record.archiveReason = reason.trim()
    record.logs.push({
      at: nowIso(),
      action: '作废归档',
      operator: record.operator,
      detail: reason.trim(),
      fromStatus: from,
      toStatus: '已作废',
    })
    removeQualityTodo(record)
    return { ok: true, message: '该加氯记录已整份作废归档，列表默认不再展示' }
  })
}

/* ---------------- 查询辅助 ---------------- */

export function recordById(id: number): ChlorinationRecord | undefined {
  return getRecord(id)
}

export function summary(includeArchived = false) {
  const rows = listRecords(includeArchived)
  const count = (status: ChlorinationStatus) =>
    rows.filter((row) => row.status === status).length
  return {
    total: rows.filter((row) => !row.archived).length,
    waiting: count('待投加'),
    running: count('投加中'),
    qualified: count('已达标'),
    abnormal: count('余氯异常'),
    failed: count('投加失败'),
    archived: allRecords().filter((row) => row.archived).length,
  }
}

/** 明细页按状态给出可用动作，列表页复用同一判定，保证两处口径一致。 */
export function availableActions(
  record: ChlorinationRecord,
): { action: string; key: string; tone: 'primary' | 'danger' | 'plain' }[] {
  if (record.archived || record.status === '已作废') {
    return []
  }
  switch (record.status) {
    case '待投加':
      return [
        { action: '提交投加', key: 'start', tone: 'primary' },
        { action: '登记失败', key: 'fail', tone: 'plain' },
        { action: '作废归档', key: 'void', tone: 'danger' },
      ]
    case '投加中':
      return [
        { action: '登记余氯判定', key: 'residual', tone: 'primary' },
        { action: '标记异常', key: 'abnormal', tone: 'plain' },
        { action: '登记失败', key: 'fail', tone: 'plain' },
        { action: '作废归档', key: 'void', tone: 'danger' },
      ]
    case '余氯异常':
      return [
        { action: '处置回投加中', key: 'dispose', tone: 'primary' },
        { action: '登记余氯', key: 'residual', tone: 'plain' },
        { action: '作废归档', key: 'void', tone: 'danger' },
      ]
    case '投加失败':
      return [
        { action: '重试投加', key: 'retry', tone: 'primary' },
        { action: '作废归档', key: 'void', tone: 'danger' },
      ]
    case '已达标':
      return [{ action: '新开一版补测', key: 'newVersion', tone: 'primary' }]
    default:
      return []
  }
}
