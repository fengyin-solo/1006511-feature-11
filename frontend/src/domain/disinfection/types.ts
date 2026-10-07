/** 消毒加氯领域模型：列表页与明细页共用同一份数据与同一套状态判定。 */

/** 加氯编号下的记录只允许在这六个状态间按规则流转。 */
export type ChlorinationStatus =
  | '待投加'
  | '投加中'
  | '已达标'
  | '余氯异常'
  | '投加失败'
  | '已作废'

/** 已作废的记录整份归档，不进入正常列表，只在明细与归档视图里只读查看。 */
export const ACTIVE_STATUSES: ChlorinationStatus[] = [
  '待投加',
  '投加中',
  '已达标',
  '余氯异常',
  '投加失败',
]

/** 正常状态线：待投加 → 投加中 → 已达标；余氯异常是投加中与已达标之间必须先处置的岔路。 */
export const WORKFLOW_STATUSES: ChlorinationStatus[] = [
  '待投加',
  '投加中',
  '已达标',
  '余氯异常',
]

/** 投加点分散在两条投加线上，接触时间按投加点实测登记。 */
export const DOSING_POINTS = ['一线#1投加点', '一线#2投加点', '二线#1投加点', '二线#2投加点'] as const

export type DosingPoint = (typeof DOSING_POINTS)[number]

/** 余氯探头编号与投加线绑定，每班校一次，校准记录跟着加氯单据走。 */
export const PROBE_OPTIONS = ['CL-A线探头', 'CL-B线探头'] as const

export type ProbeCode = (typeof PROBE_OPTIONS)[number]

export const SHIFT_OPTIONS = ['白班 08:00-20:00', '夜班 20:00-08:00'] as const

/** 出厂水余氯合格区间（mg/L，GB 5749 末梢水限值思路：低于下限或高于上限都算异常）。 */
export const RESIDUAL_CHLORINE_MIN = 0.3
export const RESIDUAL_CHLORINE_MAX = 4.0

/** 单个投加点的实测接触时间（分钟）。 */
export type PointContact = {
  point: DosingPoint
  contactMinutes: number
  registeredAt: string
}

/** 余氯探头校准记录，跟单据走；同一探头同一班次（日期+班次）只允许校一次。 */
export type ProbeCalibration = {
  probeCode: string
  shiftLabel: string
  shiftDate: string
  readingBefore: number
  readingAfter: number
  operator: string
  calibratedAt: string
}

/** 状态线动作留痕，明细页时间线读这份。 */
export type ChlorinationLog = {
  at: string
  action: string
  operator: string
  detail: string
  fromStatus?: ChlorinationStatus
  toStatus?: ChlorinationStatus
}

export type ChlorinationRecord = {
  id: number
  /** 同一加氯编号可以有多版（已达标后只能新开一版补测）。 */
  code: string
  version: number
  status: ChlorinationStatus
  dosingMethod: string
  dosingLine: '一线' | '二线'
  probeCode: string
  shiftLabel: string
  shiftDate: string
  operator: string
  /** 投加量（kg），缺了不许进入投加中。 */
  doseAmount: number | null
  createdAt: string
  /** 进入投加中的时间。 */
  startedAt: string | null
  /** 实测余氯值（mg/L），判定/补测时登记。 */
  residualChlorine: number | null
  residualCheckedAt: string | null
  judgeConclusion: '待判定' | '合格' | '超限'
  failureReason: string | null
  disposeNote: string | null
  /** 已达标后新开的补测版指向上一版，形成版本链。 */
  supersedesId: number | null
  archived: boolean
  archivedAt: string | null
  archiveReason: string | null
  contacts: PointContact[]
  calibrations: ProbeCalibration[]
  logs: ChlorinationLog[]
}

export type CreateDraftInput = {
  code: string
  dosingMethod: string
  dosingLine: '一线' | '二线'
  probeCode: string
  shiftLabel: string
  shiftDate: string
  operator: string
  supersedesId?: number | null
}

export type ServiceResult<T = unknown> = {
  ok: boolean
  message: string
  data?: T
}
