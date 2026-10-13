import * as XLSX from 'xlsx'
import type { ImportResult, TransferTask } from './transfer'

/**
 * The diary as a spreadsheet.
 *
 * A spreadsheet has cells, not a model, so the whole design is one fixed mapping between a
 * domain field and a column, declared once below. Write and read both go through it, which is
 * what stops them from drifting apart the moment a field is renamed — a sheet written by one
 * version and read by another then either round-trips or fails loudly, and never half of each.
 *
 * The four formats differ only in `bookType`; the rows are identical. That is why the round
 * trip is tested per format anyway: writing a file is worth nothing unless reading it back
 * gives the same data, and that is the only part a user can observe.
 */

/** Formats this module can write and read. */
export const SHEET_FORMATS = ['xlsx', 'xls', 'ods', 'csv'] as const

/** One of the spreadsheet formats. */
export type SheetFormat = (typeof SHEET_FORMATS)[number]

/**
 * The column mapping: domain field to header name.
 *
 * Header names are the domain field names, which is what lets a sheet be read by column name
 * rather than by position. People rearrange spreadsheets; a parser that reads by index tells
 * them their file is wrong when all that happened is that they moved a column.
 */
const COLUMNS = [
  'title',
  'notes',
  'taskDate',
  'status',
  'startMin',
  'endMin',
  'estimateMin',
  'color',
  'tags',
  'rruleFreq',
  'rruleInterval',
  'rruleDays',
  'rruleUntil',
  'rruleFrom',
  'startedAt',
  'completedAt'
] as const

/**
 * Separator for list-valued cells.
 *
 * A pipe, not a comma: commas are the CSV field separator and would need quoting that a
 * spreadsheet a person typed into by hand will not do.
 */
const LIST_SEPARATOR = '|'

/** A cell value as a spreadsheet holds it. */
type Cell = string | number | null

/** One row as a spreadsheet holds it. */
type SheetRow = Record<string, Cell>

/** The status values a sheet may carry. */
const STATUSES: readonly TransferTask['status'][] = ['pending', 'in_progress', 'done', 'cancelled']

/** The recurrence frequencies a sheet may carry. */
const FREQUENCIES: readonly TransferTask['rruleFreq'][] = [
  'none',
  'daily',
  'weekly',
  'monthly',
  'weekdays'
]

/**
 * The column names, in order.
 *
 * @returns Every column this module reads or writes.
 */
export function spreadsheetHeaders(): readonly string[] {
  return COLUMNS
}

/**
 * Turns tasks into spreadsheet rows.
 *
 * Minutes go out as integers rather than `"09:00"`. A clock string is text in one application
 * and a time in another, so the same file behaves differently depending on who opens it; the
 * integer is a number everywhere and is formatted at display time instead.
 *
 * @param tasks The tasks to lay out.
 * @returns One row per task, keyed by column name.
 */
export function toSheetRows(tasks: TransferTask[]): SheetRow[] {
  return tasks.map((task) => ({
    title: task.title,
    notes: task.notes,
    taskDate: task.taskDate,
    status: task.status,
    startMin: task.startMin,
    endMin: task.endMin,
    estimateMin: task.estimateMin,
    color: task.color,
    tags: task.tags.length === 0 ? null : task.tags.join(LIST_SEPARATOR),
    rruleFreq: task.rruleFreq,
    rruleInterval: task.rruleInterval,
    rruleDays: task.rruleDays === null ? null : task.rruleDays.join(LIST_SEPARATOR),
    rruleUntil: task.rruleUntil,
    rruleFrom: task.rruleFrom,
    startedAt: task.startedAt,
    completedAt: task.completedAt
  }))
}

/**
 * Writes tasks as a spreadsheet.
 *
 * @param tasks The tasks to write.
 * @param format Which format to write.
 * @returns The file contents.
 */
export function toSpreadsheet(tasks: TransferTask[], format: SheetFormat): Buffer {
  const sheet = XLSX.utils.json_to_sheet(toSheetRows(tasks), { header: [...COLUMNS] })
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, 'Tareas')

  // SheetJS types `write` as `any` because its return type depends on `type`. Here it is always
  // a Buffer, so the cast states what the options already guarantee.
  return XLSX.write(book, { bookType: format, type: 'buffer' }) as Buffer
}

/**
 * Reads a spreadsheet into tasks.
 *
 * Never throws and never returns a partial result: a sheet whose ninth row is broken imports
 * nothing, because a file that half-arrived looks exactly like a file that arrived.
 *
 * @param contents The file bytes.
 * @param format Which format to read.
 * @returns The tasks, or a message the user can act on.
 */
export function parseSpreadsheet(contents: Buffer, format: SheetFormat): ImportResult {
  let rows: Record<string, unknown>[]

  const wrongFormat = detectsWrongFormat(contents, format)

  if (wrongFormat !== null) {
    return { ok: false, error: wrongFormat }
  }

  try {
    // `raw` keeps every cell exactly as it was typed.
    //
    // Without it the reader infers types and turns `2026-10-05` into the number 46300 — the
    // spreadsheet's serial date. Every date in the diary would arrive as a plausible-looking
    // integer that is not a date at all, and the failure would be silent.
    const book = XLSX.read(contents, { type: 'buffer', raw: true })
    const first = book.SheetNames[0]

    if (first === undefined) {
      return { ok: false, error: 'El archivo no contiene ninguna hoja.' }
    }

    rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[first], {
      // An empty cell is `null` rather than the empty string, so "no value" and "a blank
      // answer" are the same thing — which is what a person means by leaving a cell empty.
      defval: null
    })
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'no se pudo leer'

    return {
      ok: false,
      error: `No se pudo leer el archivo como ${format.toUpperCase()} (${detail}). Si es una copia exportada por la app, vuelva a exportarla.`
    }
  }

  const tasks: TransferTask[] = []

  for (const [index, row] of rows.entries()) {
    const read = toTransferTask(row)

    if (!read.ok) {
      return {
        ok: false,
        error: `La fila ${index + 2} no es válida: ${read.problem}. No se ha importado nada, para que el archivo no quede a medias.`
      }
    }

    tasks.push(read.task)
  }

  return { ok: true, tasks }
}

/**
 * Reads one spreadsheet row into a task.
 *
 * Tolerant in what a person can change and strict in what the domain owns. A spreadsheet is
 * something people rearrange: columns come in any order, extra columns are ignored, numbers
 * may arrive as text, and an empty cell means absent. What is not negotiable is the task's own
 * rules, and those are the same ones `parseImportJson` applies.
 *
 * @param row The row, keyed by header name.
 * @returns The task, or what is wrong with the row.
 */
function toTransferTask(row: Record<string, unknown>): TaskReadResult {
  const title = readText(row['title'])

  if (title === null || title.trim().length === 0) {
    return fail('el campo "title" está vacío')
  }

  const taskDate = readText(row['taskDate'])

  if (taskDate === null || !/^\d{4}-\d{2}-\d{2}$/.test(taskDate)) {
    return fail(
      `el campo "taskDate" debe ser una fecha YYYY-MM-DD y vale ${describe(row['taskDate'])}`
    )
  }

  const rawStatus = readText(row['status'])
  const status = rawStatus === null ? 'pending' : (rawStatus as TransferTask['status'])

  if (!STATUSES.includes(status)) {
    return fail(`el campo "status" vale "${rawStatus}" y no es ninguno de ${STATUSES.join(', ')}`)
  }

  const start = readMinute(row['startMin'], 'startMin')
  const end = readMinute(row['endMin'], 'endMin')
  const estimate = readMinute(row['estimateMin'], 'estimateMin')

  // Checked one by one rather than in a loop: narrowing a `for...of` over an array does not
  // carry to the variables afterwards, and three named fields are not worth a helper.
  if (!start.ok) {
    return { ok: false, problem: start.problem }
  }

  if (!end.ok) {
    return { ok: false, problem: end.problem }
  }

  if (!estimate.ok) {
    return { ok: false, problem: estimate.problem }
  }

  const startMin = start.value
  const endMin = end.value
  const estimateMin = estimate.value

  if (typeof startMin === 'number' && typeof endMin === 'number' && endMin <= startMin) {
    return fail('la hora de fin no es posterior a la de inicio')
  }

  const rawFreq = readText(row['rruleFreq'])
  const rruleFreq = rawFreq === null ? 'none' : (rawFreq as TransferTask['rruleFreq'])

  if (!FREQUENCIES.includes(rruleFreq)) {
    return fail(
      `el campo "rruleFreq" vale "${rawFreq}" y no es ninguna de ${FREQUENCIES.join(', ')}`
    )
  }

  const readDays = readWeekdays(row['rruleDays'])

  if (!readDays.ok) {
    return { ok: false, problem: readDays.problem }
  }

  const rruleDays = readDays.value

  return {
    ok: true,
    task: {
      title: title.trim(),
      notes: readText(row['notes']),
      taskDate,
      status,
      startMin,
      endMin,
      estimateMin,
      color: readText(row['color']),
      tags: readList(row['tags']),
      rruleFreq,
      rruleInterval: readInterval(row['rruleInterval']),
      rruleDays,
      rruleUntil: readText(row['rruleUntil']),
      rruleFrom: readText(row['rruleFrom']),
      startedAt: readText(row['startedAt']),
      completedAt: readText(row['completedAt'])
    }
  }
}

/**
 * Names the format a file really is, when it is not the one it was claimed to be.
 *
 * SheetJS is forgiving by design: handed the wrong bytes it will happily return an empty
 * result rather than fail. So a renamed `.xlsx` that is really a CSV imports as *zero tasks
 * and reports success*, which is the worst possible outcome — a user who renamed their file
 * by hand sees a clean import and an empty diary.
 *
 * Each container has a fixed signature, so the mismatch is detected before parsing instead of
 * after it.
 *
 * @param contents The file bytes.
 * @param format The format the file is being read as.
 * @returns A message to show the user, or `null` when the signature is plausible.
 */
function detectsWrongFormat(contents: Buffer, format: SheetFormat): string | null {
  if (format === 'csv') {
    // CSV has no signature: any bytes can be CSV. A binary file renamed to `.csv` does carry
    // NUL bytes or invalid UTF-8, which is enough to recognise it.
    const text = contents.toString('utf8')

    if (contents.includes(0) || text.includes('�')) {
      return 'El archivo no es texto CSV válido. Si es una hoja de cálculo, guárdala con su extensión original.'
    }

    return null
  }

  if (format === 'xls') {
    // OLE2 compound file: the legacy binary container.
    const isOle2 =
      contents.length >= 8 &&
      contents[0] === 0xd0 &&
      contents[1] === 0xcf &&
      contents[2] === 0x11 &&
      contents[3] === 0xe0

    if (!isOle2) {
      return 'El archivo no es una hoja de cálculo .xls de Excel 97-2003. Si lo guardaste desde otra aplicación, usa .xlsx u .ods.'
    }

    return null
  }

  // .xlsx and .ods are both ZIP containers, so "PK" only rules out the obviously wrong case:
  // a legacy .xls renamed to .xlsx.
  const isZip = contents.length >= 2 && contents[0] === 0x50 && contents[1] === 0x4b

  if (!isZip) {
    return `El archivo no es una hoja de cálculo ${format.toUpperCase()}. Si lo guardaste desde otra aplicación, comprueba su extensión.`
  }

  return null
}

/**
 * Either a task or the reason a row cannot become one.
 *
 * A discriminated result rather than `Task | string`: with that signature every *valid* row is
 * an object, so a `problem !== null` check treats every good row as a failure. The mistake was
 * made once already; the shape now makes it impossible.
 */
/** The refusal arm, named once so both result shapes can share it. */
type Problem = { ok: false; problem: string }

/** A value read from a cell: the value, `null` when absent, or why it is not usable. */
type ReadResult<T> = { ok: true; value: T | null } | Problem

/** A read row: either the task it describes, or what is wrong with it. */
type TaskReadResult = { ok: true; task: TransferTask } | Problem

/**
 * Builds a refusal.
 *
 * @param problem What is wrong with the row.
 * @returns The refusal.
 */
function fail(problem: string): Problem {
  return { ok: false, problem }
}

/**
 * Reads a cell as text.
 *
 * @param value The raw cell.
 * @returns The trimmed text, or `null` when the cell is empty.
 */
function readText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()

    return trimmed.length === 0 ? null : trimmed
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  // A date cell in a spreadsheet arrives as a Date when the cell was formatted as one.
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  return null
}

/**
 * Reads a minute cell.
 *
 * Spreadsheets store 540 as a number in one application and as the text "540" in another, and
 * both turn up in real files. The integer is the thing both agree on.
 *
 * @param value The raw cell.
 * @param field Field name, for the error message.
 * @returns The minutes, `null`, or a message naming what is wrong.
 */
function readMinute(value: unknown, field: string): ReadResult<number> {
  const text = readText(value)

  if (text === null) {
    return { ok: true, value: null }
  }

  const parsed = Number(text)

  if (!Number.isInteger(parsed)) {
    return fail(`el campo "${field}" vale "${text}" y no es un número entero`)
  }

  // An estimate is a duration and may exceed a day; a clock time cannot.
  if (field === 'estimateMin' ? parsed < 0 : parsed < 0 || parsed >= 1440) {
    return fail(`el campo "${field}" vale ${parsed} y no es un valor válido`)
  }

  return { ok: true, value: parsed }
}

/**
 * Reads an interval cell.
 *
 * @param value The raw cell.
 * @returns The interval, always ≥ 1.
 */
function readInterval(value: unknown): number {
  const parsed = Number(readText(value) ?? '1')

  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 52 ? parsed : 1
}

/**
 * Reads a weekday list cell.
 *
 * Nothing is dropped. `1,banana,5` used to become `[1, 5]` in a sibling parser: the silent
 * subset this whole module refuses everywhere else, hiding a typo that reschedules a series.
 *
 * @param value The raw cell.
 * @returns The weekdays, `null`, or a message naming what is wrong.
 */
function readWeekdays(value: unknown): ReadResult<number[]> {
  const text = readText(value)

  if (text === null) {
    return { ok: true, value: null }
  }

  const days: number[] = []

  for (const part of text.split(LIST_SEPARATOR)) {
    const parsed = Number(part.trim())

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 7) {
      return fail(`la lista "rruleDays" contiene "${part.trim()}" y solo admite números del 1 al 7`)
    }

    days.push(parsed)
  }

  return { ok: true, value: days }
}

/**
 * Reads a tag list cell.
 *
 * @param value The raw cell.
 * @returns The tags, without a leading `#`.
 */
function readList(value: unknown): string[] {
  const text = readText(value)

  if (text === null) {
    return []
  }

  return text
    .split(LIST_SEPARATOR)
    .map((entry) => entry.replace(/^#/, '').trim())
    .filter((entry) => entry.length > 0)
}

/**
 * Renders a rejected value for a message.
 *
 * @param value The offending cell.
 * @returns A short description safe to show.
 */
function describe(value: unknown): string {
  if (value === null || value === undefined) {
    return 'está vacío'
  }

  if (typeof value === 'string') {
    return `"${value}"`
  }

  return `un ${typeof value}`
}
