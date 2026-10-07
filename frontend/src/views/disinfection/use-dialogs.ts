import { computed, ref } from 'vue'

import {
  addCalibration,
  archiveChlorination,
  createChlorinationRecord,
  disposeAbnormal,
  judgeChlorination,
  markAbnormal,
  openSupplement,
  registerDosingFailure,
  retryDosing,
  startDosing,
  updateChlorinationRecord,
} from '@/data/disinfection/service'
import type { CalibrationRecord, ChlorinationRecord } from '@/data/disinfection/types'
import type { DialogField } from '@/components/ActionDialog.vue'

const SHIFTS = ['白班', '夜班']
const LINES = ['投加线一', '投加线二']

interface DialogState {
  mode:
    | 'create'
    | 'start'
    | 'retry'
    | 'judge'
    | 'abnormal'
    | 'failure'
    | 'dispose'
    | 'archive'
    | 'edit'
    | 'supplement'
    | 'calibrate'
  title: string
  hint: string
  fields: DialogField[]
  initial: Record<string, string>
  row?: ChlorinationRecord
}

const operatorField: DialogField = { name: 'operator', label: '操作人员', placeholder: '默认本班操作人员' }
const shiftField: DialogField = { name: 'shift', label: '班次', type: 'select', options: SHIFTS, required: true }

function editFields(row: ChlorinationRecord): DialogField[] {
  return [
    { name: 'line', label: '投加线', type: 'select', options: LINES, required: true },
    { name: 'point', label: '加氯点', required: true, placeholder: '按投加线登记实际加氯点' },
    { name: 'method', label: '消毒方式', placeholder: '如 液氯投加 / 次氯酸钠投加' },
    { name: 'dose', label: '投加量（kg/班）', type: 'number', placeholder: '缺它不许进入投加中' },
    { name: 'contactTime', label: '接触时间（分钟，投加点实测）', type: 'number', placeholder: '缺它不许进入投加中' },
    { name: 'residual', label: '余氯值（mg/L）', type: 'number', placeholder: '判定前由在线探头实测' },
    operatorField,
    { ...shiftField },
  ]
}

export function useChlorinationDialogs(defaults: { operator: string; shift: string }, onDone: (message: string) => void) {
  const state = ref<DialogState | null>(null)
  const errorMessage = ref('')

  const open = ref(false)
  const title = computed(() => state.value?.title ?? '')
  const hint = computed(() => state.value?.hint ?? '')
  const fields = computed<DialogField[]>(() => state.value?.fields ?? [])
  const initial = computed<Record<string, string>>(() => state.value?.initial ?? {})

  function show(next: DialogState) {
    errorMessage.value = ''
    state.value = next
    open.value = true
  }

  function close() {
    open.value = false
    state.value = null
  }

  function openCreate() {
    show({
      mode: 'create',
      title: '登记消毒加氯记录',
      hint: '加氯点分散在两条投加线上；投加量、接触时间可以登记后补，但缺参记录提交投加时会被拦住。',
      fields: [
        { name: 'code', label: '加氯编号', required: true, placeholder: '如 DISI-0007' },
        { name: 'line', label: '投加线', type: 'select', options: LINES, required: true },
        { name: 'point', label: '加氯点', required: true, placeholder: '按投加线登记实际加氯点' },
        { name: 'method', label: '消毒方式', placeholder: '如 液氯投加 / 次氯酸钠投加' },
        { name: 'dose', label: '投加量（kg/班，可后补）', type: 'number' },
        { name: 'contactTime', label: '接触时间（分钟，可后补）', type: 'number' },
        operatorField,
        shiftField,
      ],
      initial: { line: '投加线一', operator: defaults.operator, shift: defaults.shift },
    })
  }

  function openAction(action: string, row: ChlorinationRecord) {
    const base = { operator: defaults.operator, shift: defaults.shift }
    switch (action) {
      case '提交投加':
        show({
          mode: 'start',
          row,
          title: `提交投加 · ${row.code} v${row.version}`,
          hint: '校验投加量与接触时间齐备后，状态由「待投加」进入「投加中」。',
          fields: [operatorField],
          initial: { ...base },
        })
        break
      case '重试投加':
        show({
          mode: 'retry',
          row,
          title: `重试投加 · ${row.code} v${row.version}`,
          hint: `上次失败原因：${row.failureReason ?? '—'}。重试会重新校验投加量与接触时间。`,
          fields: [operatorField],
          initial: { ...base },
        })
        break
      case '判定达标':
        show({
          mode: 'judge',
          row,
          title: `余氯判定 · ${row.code} v${row.version}`,
          hint: '余氯超出 0.3~4.0 mg/L 会自动切到「余氯异常」，判定结论同步在线水质检测待办。',
          fields: [
            { name: 'residual', label: '余氯实测值（mg/L）', type: 'number', required: true },
            operatorField,
          ],
          initial: { residual: row.residual, ...base },
        })
        break
      case '标记异常':
        show({
          mode: 'abnormal',
          row,
          title: `标记余氯异常 · ${row.code} v${row.version}`,
          hint: '异常结论同样同步到在线水质检测待办，处置后才能回投加中再判。',
          fields: [
            { name: 'reason', label: '异常情况', type: 'textarea', required: true, placeholder: '如 探头示值突增、复测超限' },
            operatorField,
          ],
          initial: { ...base },
        })
        break
      case '投加失败':
        show({
          mode: 'failure',
          row,
          title: `登记投加失败 · ${row.code} v${row.version}`,
          hint: '失败记录回到「待投加」挂失败标记，排除问题后可以重试。',
          fields: [
            { name: 'reason', label: '失败原因', type: 'textarea', required: true, placeholder: '如 计量泵跳停、管路气堵' },
          ],
          initial: {},
        })
        break
      case '处置回投加中':
        show({
          mode: 'dispose',
          row,
          title: `异常处置 · ${row.code} v${row.version}`,
          hint: `${row.abnormalReason ?? '余氯异常'}。处置完成后回「投加中」，才能再次判定。`,
          fields: [
            { name: 'measures', label: '处置措施', type: 'textarea', required: true, placeholder: '如 调低投加量、冲洗管路、复测余氯' },
            operatorField,
          ],
          initial: { ...base },
        })
        break
      case '作废归档':
        show({
          mode: 'archive',
          row,
          title: `作废归档 · ${row.code} v${row.version}`,
          hint: '整份加氯记录（含校准、判定、处置子记录）归档，列表默认不再展示，明细只读。',
          fields: [{ name: 'reason', label: '作废原因', type: 'textarea', required: true }],
          initial: {},
        })
        break
      case '补登记字段':
        show({
          mode: 'edit',
          row,
          title: `补登记字段 · ${row.code} v${row.version}`,
          hint: '接触时间按投加点实测登记；已达标/已作废的记录不允许改。',
          fields: editFields(row),
          initial: {
            line: row.line,
            point: row.point,
            method: row.method,
            dose: row.dose,
            contactTime: row.contactTime,
            residual: row.residual,
            operator: row.operator,
            shift: row.shift,
          },
        })
        break
      case '新开一版补测':
        show({
          mode: 'supplement',
          row,
          title: `新开一版补测 · ${row.code}`,
          hint: '已达标的原班次保持锁定不再改动，补测版沿用加氯编号从「待投加」重新走完整状态线。',
          fields: [operatorField, shiftField],
          initial: { ...base },
        })
        break
      default:
        break
    }
  }

  function openCalibration(row: ChlorinationRecord) {
    show({
      mode: 'calibrate',
      row,
      title: `余氯探头校准 · ${row.code} v${row.version}`,
      hint: '余氯探头每班校一次，同一班次重复登记会被拦住，校准记录跟着这张单据走。',
      fields: [
        { ...shiftField },
        { name: 'standardValue', label: '标准液浓度（mg/L）', type: 'number', required: true },
        { name: 'beforeValue', label: '校准前示值（mg/L）', type: 'number' },
        { name: 'afterValue', label: '校准后示值（mg/L）', type: 'number', required: true },
        { name: 'result', label: '校准结果', type: 'select', options: ['合格', '需调整', '探头故障'] },
        { name: 'note', label: '备注', type: 'textarea', rows: 2 },
        operatorField,
      ],
      initial: { shift: defaults.shift, standardValue: '1.0', result: '合格', operator: defaults.operator },
    })
  }

  function submit(value: Record<string, string>) {
    const current = state.value
    if (!current) {
      return
    }
    const row = current.row
    let result: { ok: boolean; message: string } = { ok: false, message: '未知操作' }
    switch (current.mode) {
      case 'create':
        result = createChlorinationRecord({
          code: value.code ?? '',
          line: (value.line || '') as ChlorinationRecord['line'],
          point: value.point ?? '',
          method: value.method ?? '',
          dose: value.dose,
          contactTime: value.contactTime,
          operator: value.operator ?? defaults.operator,
          shift: value.shift || defaults.shift,
        })
        break
      case 'start':
        result = row ? startDosing(row.id, value.operator || defaults.operator) : result
        break
      case 'retry':
        result = row ? retryDosing(row.id, value.operator || defaults.operator) : result
        break
      case 'judge':
        result = row ? judgeChlorination(row.id, value.residual ?? '', value.operator || defaults.operator) : result
        break
      case 'abnormal':
        result = row ? markAbnormal(row.id, value.reason ?? '', value.operator || defaults.operator) : result
        break
      case 'failure':
        result = row ? registerDosingFailure(row.id, value.reason ?? '') : result
        break
      case 'dispose':
        result = row ? disposeAbnormal(row.id, value.measures ?? '', value.operator || defaults.operator) : result
        break
      case 'archive':
        result = row ? archiveChlorination(row.id, value.reason ?? '') : result
        break
      case 'edit':
        result = row
          ? updateChlorinationRecord(row.id, {
              line: (value.line || '') as ChlorinationRecord['line'],
              point: value.point,
              method: value.method,
              dose: value.dose,
              contactTime: value.contactTime,
              residual: value.residual,
              operator: value.operator,
              shift: value.shift,
            })
          : result
        break
      case 'supplement':
        result = row ? openSupplement(row.id, value.operator || defaults.operator, value.shift || defaults.shift) : result
        break
      case 'calibrate':
        result = row
          ? addCalibration(row.id, {
              shift: value.shift ?? '',
              standardValue: value.standardValue ?? '',
              beforeValue: value.beforeValue ?? '',
              afterValue: value.afterValue ?? '',
              operator: value.operator || defaults.operator,
              result: value.result ?? '',
              note: value.note ?? '',
            } as Omit<CalibrationRecord, 'id' | 'calibratedAt'>)
          : result
        break
    }
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    close()
    onDone(result.message)
  }

  return {
    open,
    title,
    hint,
    fields,
    initial,
    errorMessage,
    openCreate,
    openAction,
    openCalibration,
    close,
    submit,
  }
}
