import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

import {
  type ChlorinationLog,
  type ChlorinationRecord,
  type PointContact,
  type ProbeCalibration,
} from './types'

const STORAGE_KEY = 'waterworks-ops:disinfection:v1'

/** 同步到「出厂水质检测」的待办用这个字段回链加氯单据，按它去重与回写。 */
export const QUALITY_LINK_FIELD = '加氯单据'

export function qualityTag(record: Pick<ChlorinationRecord, 'code' | 'version'>): string {
  return `${record.code}#v${record.version}`
}

function log(
  action: string,
  operator: string,
  detail: string,
  fromStatus?: ChlorinationLog['fromStatus'],
  toStatus?: ChlorinationLog['toStatus'],
): ChlorinationLog {
  return { at: new Date().toISOString(), action, operator, detail, fromStatus, toStatus }
}

function contact(point: PointContact['point'], minutes: number, at: string): PointContact {
  return { point, contactMinutes: minutes, registeredAt: at }
}

function calibration(input: Omit<ProbeCalibration, 'calibratedAt'>, at: string): ProbeCalibration {
  return { ...input, calibratedAt: at }
}

// 示例单据覆盖状态线上的每个环节，首次进入时播种，之后以浏览器里的改动为准。
function seedRecords(): ChlorinationRecord[] {
  return [
    {
      id: 1,
      code: 'CL-20261005-01',
      version: 1,
      status: '已达标',
      dosingMethod: '液氯投加',
      dosingLine: '一线',
      probeCode: 'CL-A线探头',
      shiftLabel: '白班 08:00-20:00',
      shiftDate: '2026-10-05',
      operator: '王建国',
      doseAmount: 12.5,
      createdAt: '2026-10-05T08:30:00.000Z',
      startedAt: '2026-10-05T09:20:00.000Z',
      residualChlorine: 0.85,
      residualCheckedAt: '2026-10-05T09:55:00.000Z',
      judgeConclusion: '合格',
      failureReason: null,
      disposeNote: null,
      supersedesId: null,
      archived: false,
      archivedAt: null,
      archiveReason: null,
      contacts: [
        contact('一线#1投加点', 30, '2026-10-05T09:18:00.000Z'),
        contact('一线#2投加点', 32, '2026-10-05T09:19:00.000Z'),
      ],
      calibrations: [
        calibration(
          {
            probeCode: 'CL-A线探头',
            shiftLabel: '白班 08:00-20:00',
            shiftDate: '2026-10-05',
            readingBefore: 0.28,
            readingAfter: 0.3,
            operator: '王建国',
          },
          '2026-10-05T08:10:00.000Z',
        ),
      ],
      logs: [
        log('登记单据', '王建国', '新开消毒加氯单据', undefined, '待投加'),
        log('提交投加', '王建国', '投加量12.5kg，一线两点位接触时间已登记', '待投加', '投加中'),
        log('判定达标', '王建国', '余氯0.85mg/L，处于0.30~4.00mg/L合格区间', '投加中', '已达标'),
      ],
    },
    {
      id: 2,
      code: 'CL-20261006-02',
      version: 1,
      status: '余氯异常',
      dosingMethod: '次氯酸钠投加',
      dosingLine: '二线',
      probeCode: 'CL-B线探头',
      shiftLabel: '夜班 20:00-08:00',
      shiftDate: '2026-10-06',
      operator: '李秀兰',
      doseAmount: 8.2,
      createdAt: '2026-10-06T20:20:00.000Z',
      startedAt: '2026-10-06T21:05:00.000Z',
      residualChlorine: 4.6,
      residualCheckedAt: '2026-10-06T21:40:00.000Z',
      judgeConclusion: '超限',
      failureReason: null,
      disposeNote: null,
      supersedesId: null,
      archived: false,
      archivedAt: null,
      archiveReason: null,
      contacts: [
        contact('二线#1投加点', 28, '2026-10-06T21:02:00.000Z'),
        contact('二线#2投加点', 31, '2026-10-06T21:03:00.000Z'),
      ],
      calibrations: [
        calibration(
          {
            probeCode: 'CL-B线探头',
            shiftLabel: '夜班 20:00-08:00',
            shiftDate: '2026-10-06',
            readingBefore: 0.31,
            readingAfter: 0.3,
            operator: '李秀兰',
          },
          '2026-10-06T20:05:00.000Z',
        ),
      ],
      logs: [
        log('登记单据', '李秀兰', '新开消毒加氯单据', undefined, '待投加'),
        log('提交投加', '李秀兰', '投加量8.2kg，二线两点位接触时间已登记', '待投加', '投加中'),
        log('余氯判定', '李秀兰', '余氯4.60mg/L超出上限4.00mg/L，自动切为余氯异常', '投加中', '余氯异常'),
      ],
    },
    {
      id: 3,
      code: 'CL-20261007-03',
      version: 1,
      status: '待投加',
      dosingMethod: '液氯投加',
      dosingLine: '一线',
      probeCode: 'CL-A线探头',
      shiftLabel: '白班 08:00-20:00',
      shiftDate: '2026-10-07',
      operator: '赵敏',
      doseAmount: null,
      createdAt: '2026-10-07T08:40:00.000Z',
      startedAt: null,
      residualChlorine: null,
      residualCheckedAt: null,
      judgeConclusion: '待判定',
      failureReason: null,
      disposeNote: null,
      supersedesId: null,
      archived: false,
      archivedAt: null,
      archiveReason: null,
      contacts: [],
      calibrations: [],
      logs: [log('登记单据', '赵敏', '新开消毒加氯单据，投加量与接触时间尚未登记', undefined, '待投加')],
    },
    {
      id: 4,
      code: 'CL-20261007-01',
      version: 1,
      status: '投加中',
      dosingMethod: '液氯投加',
      dosingLine: '一线',
      probeCode: 'CL-A线探头',
      shiftLabel: '白班 08:00-20:00',
      shiftDate: '2026-10-07',
      operator: '王建国',
      doseAmount: 11.0,
      createdAt: '2026-10-07T08:05:00.000Z',
      startedAt: '2026-10-07T08:45:00.000Z',
      residualChlorine: null,
      residualCheckedAt: null,
      judgeConclusion: '待判定',
      failureReason: null,
      disposeNote: null,
      supersedesId: null,
      archived: false,
      archivedAt: null,
      archiveReason: null,
      contacts: [contact('一线#1投加点', 30, '2026-10-07T08:43:00.000Z')],
      calibrations: [
        calibration(
          {
            probeCode: 'CL-A线探头',
            shiftLabel: '白班 08:00-20:00',
            shiftDate: '2026-10-07',
            readingBefore: 0.32,
            readingAfter: 0.3,
            operator: '王建国',
          },
          '2026-10-07T08:00:00.000Z',
        ),
      ],
      logs: [
        log('登记单据', '王建国', '新开消毒加氯单据', undefined, '待投加'),
        log('提交投加', '王建国', '投加量11.0kg，一线#1点位接触时间30分钟', '待投加', '投加中'),
      ],
    },
    {
      id: 5,
      code: 'CL-20261006-04',
      version: 1,
      status: '投加失败',
      dosingMethod: '次氯酸钠投加',
      dosingLine: '二线',
      probeCode: 'CL-B线探头',
      shiftLabel: '夜班 20:00-08:00',
      shiftDate: '2026-10-06',
      operator: '陈大勇',
      doseAmount: 9.4,
      createdAt: '2026-10-06T20:40:00.000Z',
      startedAt: null,
      residualChlorine: null,
      residualCheckedAt: null,
      judgeConclusion: '待判定',
      failureReason: '加氯机管路漏气，提交投加时失败',
      disposeNote: null,
      supersedesId: null,
      archived: false,
      archivedAt: null,
      archiveReason: null,
      contacts: [contact('二线#1投加点', 26, '2026-10-06T20:38:00.000Z')],
      calibrations: [],
      logs: [
        log('登记单据', '陈大勇', '新开消毒加氯单据', undefined, '待投加'),
        log('登记投加失败', '陈大勇', '加氯机管路漏气，提交投加时失败', '待投加', '投加失败'),
      ],
    },
    {
      id: 6,
      code: 'CL-20261005-03',
      version: 1,
      status: '已作废',
      dosingMethod: '液氯投加',
      dosingLine: '二线',
      probeCode: 'CL-B线探头',
      shiftLabel: '白班 08:00-20:00',
      shiftDate: '2026-10-05',
      operator: '赵敏',
      doseAmount: null,
      createdAt: '2026-10-05T10:00:00.000Z',
      startedAt: null,
      residualChlorine: null,
      residualCheckedAt: null,
      judgeConclusion: '待判定',
      failureReason: null,
      disposeNote: null,
      supersedesId: null,
      archived: true,
      archivedAt: '2026-10-05T10:30:00.000Z',
      archiveReason: '重复登记，整份作废归档',
      contacts: [],
      calibrations: [],
      logs: [
        log('登记单据', '赵敏', '新开消毒加氯单据', undefined, '待投加'),
        log('作废归档', '赵敏', '重复登记，整份作废归档', '待投加', '已作废'),
      ],
    },
    {
      id: 7,
      code: 'CL-20261007-02',
      version: 1,
      status: '待投加',
      dosingMethod: '次氯酸钠投加',
      dosingLine: '二线',
      probeCode: 'CL-B线探头',
      shiftLabel: '白班 08:00-20:00',
      shiftDate: '2026-10-07',
      operator: '李秀兰',
      doseAmount: 10.2,
      createdAt: '2026-10-07T08:25:00.000Z',
      startedAt: null,
      residualChlorine: null,
      residualCheckedAt: null,
      judgeConclusion: '待判定',
      failureReason: null,
      disposeNote: null,
      supersedesId: null,
      archived: false,
      archivedAt: null,
      archiveReason: null,
      contacts: [
        contact('二线#1投加点', 30, '2026-10-07T08:22:00.000Z'),
        contact('二线#2投加点', 29, '2026-10-07T08:23:00.000Z'),
      ],
      calibrations: [],
      logs: [
        log('登记单据', '李秀兰', '新开消毒加氯单据，投加量与接触时间已齐，待提交投加', undefined, '待投加'),
      ],
    },
    {
      id: 8,
      code: 'CL-20261005-01',
      version: 2,
      status: '待投加',
      dosingMethod: '液氯投加',
      dosingLine: '一线',
      probeCode: 'CL-A线探头',
      shiftLabel: '白班 08:00-20:00',
      shiftDate: '2026-10-07',
      operator: '王建国',
      doseAmount: 12.5,
      createdAt: '2026-10-07T09:10:00.000Z',
      startedAt: null,
      residualChlorine: null,
      residualCheckedAt: null,
      judgeConclusion: '待判定',
      failureReason: null,
      disposeNote: null,
      supersedesId: 1,
      archived: false,
      archivedAt: null,
      archiveReason: null,
      contacts: [contact('一线#1投加点', 30, '2026-10-07T09:08:00.000Z')],
      calibrations: [],
      logs: [
        log('新开补测版', '王建国', 'v1已达标锁定，新开第2版安排补测', undefined, '待投加'),
      ],
    },
  ]
}

// 随单据状态同步过去的水质待办：投加中挂检测中待办，判定结论回填，异常挂未达标待办。
function seedQualityLinks(records: ChlorinationRecord[]): EntryRow[] {
  const make = (
    id: number,
    record: ChlorinationRecord,
    patch: Partial<EntryRow>,
  ): EntryRow => ({
    id,
    status: '检测中',
    pending: true,
    abnormal: false,
    检测编号: `CLQ-${String(record.id).padStart(4, '0')}`,
    检测项目: '出厂水余氯（加氯复核）',
    实测值: '',
    标准限值: '0.30~4.00 mg/L',
    检测方法: '在线余氯探头',
    检测人员: record.operator,
    检测日期: record.shiftDate,
    水质状态: '',
    [QUALITY_LINK_FIELD]: qualityTag(record),
    ...patch,
  })
  const byId = new Map(records.map((record) => [record.id, record]))
  return [
    make(9001, byId.get(4)!, { status: '检测中', pending: true, abnormal: false, 水质状态: '检测中' }),
    make(9002, byId.get(2)!, {
      status: '未达标',
      pending: true,
      abnormal: true,
      实测值: 4.6,
      水质状态: '未达标',
    }),
    make(9003, byId.get(1)!, {
      status: '已达标',
      pending: false,
      abnormal: false,
      实测值: 0.85,
      检测日期: '2026-10-05',
      水质状态: '已达标',
    }),
  ]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

let cache: ChlorinationRecord[] | null = null

function readStorage(): ChlorinationRecord[] {
  const fallback = seedRecords()
  if (typeof window === 'undefined' || !window.localStorage) {
    hydrateQualityLinks(fallback)
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    hydrateQualityLinks(fallback)
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as ChlorinationRecord[]
    hydrateQualityLinks(parsed)
    return parsed
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    hydrateQualityLinks(fallback)
    return fallback
  }
}

// 把加氯单据带出的水质待办合并进水质模块的存储；已存在（按加氯单据字段）就不重复播种。
function hydrateQualityLinks(records: ChlorinationRecord[]): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return
  }
  const seeded = seedQualityLinks(seedRecords())
  const existing = listRows('quality')
  const tags = new Set(
    existing.map((row) => String(row[QUALITY_LINK_FIELD] ?? '')).filter((value) => value !== ''),
  )
  const merged = [...existing]
  const usedIds = new Set(existing.map((row) => Number(row.id)))
  for (const link of seeded) {
    const tag = String(link[QUALITY_LINK_FIELD])
    const record = records.find((item) => qualityTag(item) === tag)
    // 单据已作废或已彻底不存在时，不再播种它的待办。
    if (!record || record.archived) {
      continue
    }
    if (tags.has(tag)) {
      continue
    }
    let nextId = Number(link.id)
    while (usedIds.has(nextId)) {
      nextId += 1
    }
    usedIds.add(nextId)
    merged.push({ ...link, id: nextId })
  }
  saveRows('quality', merged)
}

export function allRecords(): ChlorinationRecord[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRecords(includeArchived = false): ChlorinationRecord[] {
  const rows = allRecords()
  return includeArchived ? clone(rows) : clone(rows.filter((row) => !row.archived))
}

export function getRecord(id: number): ChlorinationRecord | undefined {
  const found = allRecords().find((row) => row.id === id)
  return found ? clone(found) : undefined
}

export function saveRecords(records: ChlorinationRecord[]): void {
  cache = clone(records)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
  }
}

export function nextRecordId(): number {
  return allRecords().reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
}

/** 同一加氯编号下一版的版本号。 */
export function nextVersion(code: string): number {
  return allRecords()
    .filter((row) => row.code === code)
    .reduce((max, row) => Math.max(max, row.version), 0) + 1
}
