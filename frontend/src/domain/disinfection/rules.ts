import {
  RESIDUAL_CHLORINE_MAX,
  RESIDUAL_CHLORINE_MIN,
  type ChlorinationRecord,
  type ChlorinationStatus,
  type ServiceResult,
} from './types'

/**
 * 加氯编号下的状态线：
 *   待投加 ──提交投加──▶ 投加中 ──判定达标──▶ 已达标（终态、锁死）
 *                          │  ▲                  │
 *                          │  └──处置回投加── 余氯异常
 *                          ▼
 *                       投加失败 ──重试──▶ 投加中
 * 余氯实测超限：投加中自动切「余氯异常」；异常不允许直接判达标，必须先处置回投加中再判。
 */
const ALLOWED_TRANSITIONS: Record<ChlorinationStatus, ChlorinationStatus[]> = {
  待投加: ['投加中', '投加失败', '已作废'],
  投加中: ['已达标', '余氯异常', '投加失败', '已作废'],
  余氯异常: ['投加中', '投加失败', '已作废'],
  投加失败: ['投加中', '已作废'],
  已达标: [],
  已作废: [],
}

/** 终态：已达标只能新开一版补测，已作废整份归档，两者都不允许再改动。 */
export function isTerminal(status: ChlorinationStatus): boolean {
  return status === '已达标' || status === '已作废'
}

export function isActiveRunning(status: ChlorinationStatus): boolean {
  return status === '投加中' || status === '余氯异常'
}

export function canTransition(from: ChlorinationStatus, to: ChlorinationStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/** 拦住“跳过投加中直接达标”：只有投加中能判达标，待投加与余氯异常都不行。 */
export function ensureTransition(
  record: ChlorinationRecord,
  target: ChlorinationStatus,
): ServiceResult {
  if (record.archived || record.status === '已作废') {
    return { ok: false, message: '该加氯记录已作废归档，整份只读，不能再流转' }
  }
  if (record.status === '已达标') {
    return { ok: false, message: '该班次已达标并锁定，不能再改动；如需补测请新开一版' }
  }
  if (record.status === target) {
    return { ok: false, message: `单据当前已是「${target}」，不用重复操作` }
  }
  if (!canTransition(record.status, target)) {
    const hint =
      target === '已达标'
        ? '只能从「投加中」判定达标；余氯异常须先处置回投加中，待投加须先提交投加'
        : `「${record.status}」不允许流转到「${target}」`
    return { ok: false, message: `状态流转被拦住：${hint}` }
  }
  return { ok: true, message: '' }
}

export function missingDosingFields(record: ChlorinationRecord): string[] {
  const missing: string[] = []
  if (record.doseAmount === null || Number.isNaN(record.doseAmount) || record.doseAmount <= 0) {
    missing.push('投加量')
  }
  if (record.contacts.length === 0) {
    missing.push('接触时间')
  }
  return missing
}

/** 缺投加量或缺接触时间，一律不许进入投加中。 */
export function ensureReadyToDose(record: ChlorinationRecord): ServiceResult {
  const missing = missingDosingFields(record)
  if (missing.length > 0) {
    return {
      ok: false,
      message: `缺${missing.join('、')}的实测登记，不允许进入投加中；请先补齐再提交投加`,
    }
  }
  return { ok: true, message: '' }
}

/** 同一加氯编号重复投加时，在跑的那条只算一份：投加中/余氯异常都算占用。 */
export function ensureNoRunningSibling(
  code: string,
  selfId: number,
  rows: ChlorinationRecord[],
): ServiceResult {
  const occupied = rows.find(
    (row) =>
      row.id !== selfId &&
      !row.archived &&
      row.code === code &&
      isActiveRunning(row.status),
  )
  if (occupied) {
    return {
      ok: false,
      message: `加氯编号 ${code} 已有 v${occupied.version} 处于「${occupied.status}」，在跑的只算一份，请先处置或作废该条`,
    }
  }
  return { ok: true, message: '' }
}

export type ResidualVerdict =
  | { kind: 'unknown'; message: string }
  | { kind: 'qualified'; status: '已达标' }
  | { kind: 'over'; status: '余氯异常' }

/** 余氯判定：没登记值不能判；超上限即超限；在区间内为合格（能否直接达标由调用方按状态决定）。 */
export function judgeResidual(
  _record: ChlorinationRecord,
  value: number | null,
): ServiceResult<ResidualVerdict> {
  if (value === null || Number.isNaN(value) || value < 0) {
    return { ok: false, message: '请先登记有效的实测余氯值（mg/L）再判定' }
  }
  if (value < RESIDUAL_CHLORINE_MIN || value > RESIDUAL_CHLORINE_MAX) {
    return {
      ok: true,
      message: '',
      data: { kind: 'over', status: '余氯异常' },
    }
  }
  return { ok: true, message: '', data: { kind: 'qualified', status: '已达标' } }
}

export function residualRangeLabel(): string {
  return `${RESIDUAL_CHLORINE_MIN.toFixed(2)}~${RESIDUAL_CHLORINE_MAX.toFixed(2)} mg/L`
}

/** 余氯探头每班校一次：判定时单据所在班次必须挂着同探头、同班次、同日期的校准记录。 */
export function findShiftCalibration(
  record: ChlorinationRecord,
): ChlorinationRecord['calibrations'][number] | undefined {
  return record.calibrations.find(
    (item) =>
      item.probeCode === record.probeCode &&
      item.shiftLabel === record.shiftLabel &&
      item.shiftDate === record.shiftDate,
  )
}

export function ensureProbeCalibrated(record: ChlorinationRecord): ServiceResult {
  const calibration = findShiftCalibration(record)
  if (!calibration) {
    return {
      ok: false,
      message: `余氯探头 ${record.probeCode} 在 ${record.shiftDate} ${record.shiftLabel} 尚未校准（每班一次，校准记录跟随本单据），不能做余氯判定`,
    }
  }
  return { ok: true, message: '' }
}
