import { SEED_CHLORINATION } from './seed'
import type { ChlorinationRecord } from './types'

// 消毒加氯数据单独放一个 key：通用模块的结构装不下校准、判定、处置这些跟着单据走的子记录。
const STORAGE_KEY = 'waterworks-ops:chlorination'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): ChlorinationRecord[] {
  const fallback = clone(SEED_CHLORINATION)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as ChlorinationRecord[]
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: ChlorinationRecord[] | null = null

export function listChlorination(): ChlorinationRecord[] {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function getChlorination(id: number): ChlorinationRecord | undefined {
  return listChlorination().find((row) => row.id === id)
}

export function nextChlorinationId(): number {
  const rows = listChlorination()
  return rows.reduce((max, row) => Math.max(max, row.id), 0) + 1
}

export function saveChlorination(rows: ChlorinationRecord[]): void {
  cache = rows
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
  }
}

export function upsertChlorination(row: ChlorinationRecord): void {
  const rows = listChlorination()
  const index = rows.findIndex((item) => item.id === row.id)
  const next = [...rows]
  if (index >= 0) {
    next[index] = clone(row)
  } else {
    next.push(clone(row))
  }
  saveChlorination(next)
}

export function resetChlorination(): ChlorinationRecord[] {
  const rows = clone(SEED_CHLORINATION)
  saveChlorination(rows)
  return rows
}
