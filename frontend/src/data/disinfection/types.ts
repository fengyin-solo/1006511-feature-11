/** 消毒加氯专属领域模型：状态线、版本补测、作废归档、探头校准都在这里描述。 */

// 加氯编号下的记录只许按这条状态线次第流转。
export const CHLORINATION_STATUSES = ['待投加', '投加中', '已达标', '余氯异常'] as const
export type ChlorinationStatus = (typeof CHLORINATION_STATUSES)[number]

export const DOSING_LINES = ['投加线一', '投加线二'] as const
export type DosingLine = (typeof DOSING_LINES)[number]

// 出厂水游离余氯参考区间（mg/L），超出即自动切「余氯异常」。
export const RESIDUAL_MIN = 0.3
export const RESIDUAL_MAX = 4.0

export interface TimelineEvent {
  time: string
  title: string
  detail?: string
}

/** 余氯探头每班校一次，校准记录跟着加氯单据走。 */
export interface CalibrationRecord {
  id: number
  shift: string
  calibratedAt: string
  standardValue: string
  beforeValue: string
  afterValue: string
  operator: string
  result: string
  note: string
}

export interface JudgeRecord {
  judgedAt: string
  residual: number
  result: Extract<ChlorinationStatus, '已达标' | '余氯异常'>
  operator: string
  todoId?: number
}

export interface DisposalRecord {
  disposedAt: string
  measures: string
  operator: string
  result: string
}

export interface ChlorinationRecord {
  id: number
  /** 加氯编号：同一编号下可以有多版补测记录。 */
  code: string
  version: number
  /** 新开一版补测时指向原达标记录。 */
  supplementOfId?: number
  status: ChlorinationStatus
  /** 作废的加氯记录整份归档，列表默认不再展示。 */
  archived: boolean
  archivedAt?: string
  /** 加氯点分散在两条投加线上。 */
  line: DosingLine | ''
  point: string
  method: string
  /** 投加量（kg/班），缺它不许进入投加中。 */
  dose: string
  /** 接触时间（分钟），按投加点实测登记；缺它不许进入投加中。 */
  contactTime: string
  contactMeasuredAt: string
  /** 余氯实测值（mg/L）。 */
  residual: string
  operator: string
  shift: string
  createdAt: string
  dosedAt?: string
  /** 投加失败：回到待投加挂失败标记，等待重试。 */
  failed: boolean
  failureReason?: string
  abnormalReason?: string
  judgeHistory: JudgeRecord[]
  disposals: DisposalRecord[]
  calibrations: CalibrationRecord[]
  timeline: TimelineEvent[]
}

export interface ChlorinationStats {
  pending: number
  dosing: number
  passed: number
  abnormal: number
  failed: number
  archived: number
}

export interface ServiceResult {
  ok: boolean
  message: string
}

export interface ChlorinationFilters {
  code: string
  status: string
  line: string
  includeArchived: boolean
}
