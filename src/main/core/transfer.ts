/**
 * Moving the diary in and out of a file.
 *
 * Pure text in, pure text out. The file dialogs belong to the main process and the rows
 * belong to the repository; keeping the transformation itself free of both is what lets a
 * round trip be tested without a window, a disk or a database.
 *
 * Two of Fase 5's acceptance criteria are decided in this file:
 *
 *   * what you export comes back the same — including the nulls and the zeros, which are the
 *     fields a careless exporter loses;
 *   * what you import that is broken changes nothing — which means the whole file is refused,
 *     never a subset of it.
 */

/** Format version written into every export. A reader refuses one it does not know. */
export const TRANSFER_VERSION = 1

/** A task as it travels in a file. Every domain field, with its real type. */
export interface TransferTask {
  title: string
  notes: string | null
  taskDate: string
  status: 'pending' | 'in_progress' | 'done' | 'cancelled'
  startMin: number | null
  endMin: number | null
  estimateMin: number | null
  color: string | null
  tags: string[]
  rruleFreq: 'none' | 'daily' | 'weekly' | 'monthly' | 'weekdays'
  rruleInterval: number
  rruleDays: number[] | null
  rruleUntil: string | null
  rruleFrom: string | null
  startedAt: string | null
  completedAt: string | null
}

/** A parsed file, or the reason it was refused. */
export type ImportResult =
  | { ok: true; tasks: TransferTask[] }
  | { ok: false; error: string }

/** Minutes in a day, for the bounds check. */
const MINUTES_PER_DAY = 1440

/** Every status the domain allows. */
const STATUSES: readonly TransferTask['status'][] = [
  'pending',
  'in_progress',
  'done',
  'cancelled'
]

/** Every recurrence frequency the domain allows. */
const FREQUENCIES: readonly TransferTask['rruleFreq'][] = [
  'none',
  'daily',
  'weekly',
  'monthly',
  'weekdays'
]

/** Task statuses, as a Markdown reader sees them (ADR-015). */
const STATUS_LABEL: Readonly<Record<TransferTask['status'], string>> = {
  pending: 'pendiente',
  in_progress: 'en curso',
  done: 'completada',
  cancelled: 'cancelada'
}

/**
 * Serialises tasks as JSON.
 *
 * Nulls are written as nulls and zeros as zeros, because that is what they are. An exporter
 * that skips "empty" fields cannot tell a task with no notes from a task whose notes were
 * lost, and the round trip silently fills in the difference.
 *
 * @param tasks The tasks to write.
 * @returns A pretty-printed JSON document.
 */
export function toTransferJson(tasks: TransferTask[]): string {
  return JSON.stringify(
    {
      version: TRANSFER_VERSION,
      exportedAt: new Date().toISOString(),
      tasks
    },
    null,
    2
  )
}

/**
 * Parses a JSON export.
 *
 * Never throws and never returns a partial result. A file where the fourth of nine tasks is
 * broken is refused whole: accepting the eight good ones would leave the user believing their
 * diary came back completely when a quarter of it did not, with nothing to tell them which
 * quarter.
 *
 * @param text The file contents.
 * @returns The tasks, or a message the user can act on.
 */
export function parseImportJson(text: string): ImportResult {
  if (text.trim().length === 0) {
    return { ok: false, error: 'El archivo está vacío. No hay nada que importar.' }
  }

  let payload: unknown

  try {
    payload = JSON.parse(text)
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : 'error de análisis'

    return {
      ok: false,
      error: `El archivo no es JSON válido (${detail}). Si es una copia de seguridad antigua o un CSV, use el importador correspondiente.`
    }
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, error: 'El archivo no contiene una exportación de tareas.' }
  }

  const document = payload as Record<string, unknown>

  // A file with no version field at all is not an export — it is some other JSON the user
  // opened by mistake. Reporting "declares version undefined" for that is technically true
  // and practically useless: it sends someone to upgrade an app that is already current.
  if (document.version === undefined) {
    return {
      ok: false,
      error: 'El archivo no contiene tareas exportadas: le falta la cabecera "version". Si es un CSV, use el importador de CSV.'
    }
  }

  if (document.version !== TRANSFER_VERSION) {
    return {
      ok: false,
      error: `El archivo declara la versión ${describeValue(document.version)} y esta versión de la app entiende la ${TRANSFER_VERSION}. Actualice la app o exporte de nuevo.`
    }
  }

  if (!Array.isArray(document.tasks)) {
    return { ok: false, error: 'El archivo no contiene una lista de tareas.' }
  }

  const tasks: TransferTask[] = []

  for (const [index, entry] of document.tasks.entries()) {
    const problem = validateTask(entry)

    if (problem !== null) {
      return {
        ok: false,
        error: `La tarea ${index + 1} del archivo no es válida: ${problem}. No se ha importado nada, para que el archivo no quede a medias.`
      }
    }

    tasks.push(entry as TransferTask)
  }

  return { ok: true, tasks }
}

/**
 * Renders a rejected value for a message.
 *
 * `String({})` is "[object Object]" and `String([])` is "": both are useless in front of a
 * user who has to guess which field is wrong. Naming the type turns "vale [object Object]"
 * into "vale un objeto", which at least points somewhere.
 *
 * @param value The offending value.
 * @returns A short description safe to show.
 */
function describeValue(value: unknown): string {
  // Numbers and booleans render fine and are the most useful thing to see: a version field
  // that says 99 tells the user exactly which file they have.
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (value === null) {
    return 'null'
  }

  if (value === undefined) {
    return 'undefined'
  }

  if (Array.isArray(value)) {
    return `una lista de ${value.length}`
  }

  return `un ${typeof value}`
}

/**
 * Checks one entry of an export against the domain.
 *
 * @param entry The candidate task.
 * @returns What is wrong with it, or `null` when it is sound.
 */
function validateTask(entry: unknown): string | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return 'no es un objeto'
  }

  const task = entry as Record<string, unknown>

  if (typeof task.title !== 'string' || task.title.trim().length === 0) {
    return 'el campo "title" está vacío o no es texto'
  }

  if (typeof task.taskDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(task.taskDate)) {
    return `el campo "taskDate" debe ser una fecha YYYY-MM-DD y no es "taskDate"`
  }

  if (typeof task.status !== 'string' || !STATUSES.includes(task.status as never)) {
    return `el campo "status" vale "${describeValue(task.status)}" y no es ninguno de ${STATUSES.join(', ')}`
  }

  for (const field of ['startMin', 'endMin', 'estimateMin'] as const) {
    const value = task[field]

    if (value === null || value === undefined) {
      continue
    }

    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return `el campo "${field}" no es un número entero`
    }

    // `estimateMin` is a duration and can exceed a day; a clock time cannot.
    if (field !== 'estimateMin' && (value < 0 || value >= MINUTES_PER_DAY)) {
      return `el campo "${field}" vale ${value} y no es una hora del día`
    }

    if (field === 'estimateMin' && value < 0) {
      return `el campo "estimateMin" vale ${value} y no puede ser negativo`
    }
  }

  if (
    typeof task.startMin === 'number' &&
    typeof task.endMin === 'number' &&
    task.endMin <= task.startMin
  ) {
    return 'la hora de fin no es posterior a la de inicio'
  }

  for (const field of ['notes', 'color', 'rruleUntil', 'rruleFrom', 'startedAt', 'completedAt']) {
    const value = task[field]

    if (value !== null && value !== undefined && typeof value !== 'string') {
      return `el campo "${field}" debería ser texto o null`
    }
  }

  if (task.rruleUntil !== null && task.rruleUntil !== undefined) {
    if (typeof task.rruleUntil !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(task.rruleUntil)) {
      return 'el campo "rruleUntil" no es una fecha YYYY-MM-DD'
    }
  }

  if (task.rruleFrom !== null && task.rruleFrom !== undefined) {
    if (typeof task.rruleFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(task.rruleFrom)) {
      return 'el campo "rruleFrom" no es una fecha YYYY-MM-DD'
    }
  }

  if (task.rruleFreq !== undefined && task.rruleFreq !== null) {
    if (!FREQUENCIES.includes(task.rruleFreq as never)) {
      return `el campo "rruleFreq" vale "${describeValue(task.rruleFreq)}" y no es ninguna de ${FREQUENCIES.join(', ')}`
    }
  }

  if (task.tags !== undefined && task.tags !== null && !Array.isArray(task.tags)) {
    return 'el campo "tags" no es una lista'
  }

  if (Array.isArray(task.tags)) {
    for (const tag of task.tags) {
      if (typeof tag !== 'string' || tag.trim().length === 0) {
        return 'la lista "tags" tiene una entrada vacía'
      }
    }
  }

  if (task.rruleDays !== undefined && task.rruleDays !== null && !Array.isArray(task.rruleDays)) {
    return 'el campo "rruleDays" no es una lista'
  }

  if (Array.isArray(task.rruleDays)) {
    for (const day of task.rruleDays) {
      if (!Number.isInteger(day) || (day as number) < 1 || (day as number) > 7) {
        return `la lista "rruleDays" contiene "${String(day)}" y solo admite 1 a 7`
      }
    }
  }

  return null
}

/**
 * Renders tasks as Markdown, for a human to read.
 *
 * Not an import format. It is a projection — the tags of a row are a list in JSON and a word
 * in a table — so a round trip through it would lose information by construction, and reading
 * it back would look like it worked.
 *
 * @param tasks The tasks to write.
 * @returns A Markdown document.
 */
export function toMarkdown(tasks: TransferTask[]): string {
  const lines: string[] = ['# TaskDiary', '']

  if (tasks.length === 0) {
    lines.push('_No hay tareas que exportar._', '')

    return lines.join('\n')
  }

  lines.push(
    `_${tasks.length} ${tasks.length === 1 ? 'tarea' : 'tareas'} · exportado el ${new Date()
      .toISOString()
      .slice(0, 10)}_`,
    ''
  )

  const byDate = new Map<string, TransferTask[]>()

  for (const task of tasks) {
    const bucket = byDate.get(task.taskDate)

    if (bucket === undefined) {
      byDate.set(task.taskDate, [task])
    } else {
      bucket.push(task)
    }
  }

  for (const date of [...byDate.keys()].sort()) {
    lines.push(`## ${date}`, '', '| Hora | Tarea | Estado | Etiquetas |', '| --- | --- | --- | --- |')

    for (const task of byDate.get(date) ?? []) {
      lines.push(
        `| ${formatSchedule(task)} | ${escapeCell(task.title)} | ${STATUS_LABEL[task.status]} | ${formatTags(task.tags)} |`
      )
    }

    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Renders a task's hours for the Markdown table.
 *
 * @param task The task to render.
 * @returns The clock range, or a word for an unscheduled task.
 */
function formatSchedule(task: TransferTask): string {
  if (task.startMin === null && task.endMin === null) {
    return 'Sin hora'
  }

  const start = formatClock(task.startMin)
  const end = formatClock(task.endMin)

  return end === null ? `${start}` : `${start}–${end}`
}

/**
 * Formats minutes since midnight as `HH:MM`.
 *
 * @param minutes Minutes since midnight, or `null`.
 * @returns The clock time, or an em dash when unset.
 */
function formatClock(minutes: number | null): string {
  if (minutes === null) {
    return '—'
  }

  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/**
 * Escapes the character that would break a Markdown table row.
 *
 * @param value The cell text.
 * @returns The text, safe inside a table.
 */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

/**
 * Renders a tag list for the Markdown table.
 *
 * @param tags The tags.
 * @returns The tags, or an em dash when there are none.
 */
function formatTags(tags: string[]): string {
  return tags.length === 0 ? '—' : tags.map((tag) => `#${tag}`).join(' ')
}

/**
 * Parses a CSV export.
 *
 * Written for the file a spreadsheet produces, not for the format in the abstract: semicolon
 * separators because that is what Excel writes in a Spanish locale, quoted fields holding
 * commas and newlines, CRLF line endings, and a trailing blank line that is not a row.
 *
 * @param text The file contents.
 * @returns The tasks, or a message the user can act on.
 */
export function parseImportCsv(text: string): ImportResult {
  if (text.trim().length === 0) {
    return { ok: false, error: 'El archivo está vacío. No hay nada que importar.' }
  }

  const headerText = firstRecord(text)
  const separator = headerText === null ? ',' : detectSeparator(headerText)
  const rows = parseCsvRows(text, separator)

  if (rows.length === 0) {
    return { ok: false, error: 'El archivo no tiene ninguna fila.' }
  }

  const header = rows[0]

  if (!header.some((cell) => cell.trim().toLowerCase() === 'title')) {
    return {
      ok: false,
      error: `La primera fila debe ser la cabecera con una columna "title". Encontradas: ${header.join(', ')}.`
    }
  }

  const headerNames = header.map((cell) => cell.trim())
  const tasks: TransferTask[] = []

  for (const [index, row] of rows.slice(1).entries()) {
    if (row.every((cell) => cell.trim().length === 0)) {
      continue
    }

    const record: Record<string, string> = {}

    for (const [column, name] of headerNames.entries()) {
      record[name] = row[column] ?? ''
    }

    const candidate = {
      title: (record.title ?? '').trim(),
      notes: emptyToNull(record.notes),
      taskDate: (record.taskDate ?? '').trim(),
      status: (record.status ?? '').trim() || 'pending',
      startMin: parseOptionalMinute(record.startMin, 'startMin', index + 2),
      endMin: parseOptionalMinute(record.endMin, 'endMin', index + 2),
      estimateMin: parseOptionalMinute(record.estimateMin, 'estimateMin', index + 2),
      color: emptyToNull(record.color),
      tags: parseTags(record.tags),
      rruleFreq: ((record.rruleFreq ?? '').trim() || 'none') as TransferTask['rruleFreq'],
      rruleInterval: Number((record.rruleInterval ?? '').trim() || '1'),
      rruleDays: parseWeekdays(record.rruleDays),
      rruleUntil: emptyToNull(record.rruleUntil),
      rruleFrom: emptyToNull(record.rruleFrom),
      startedAt: emptyToNull(record.startedAt),
      completedAt: emptyToNull(record.completedAt)
    }

    const problem = validateTask(candidate)

    if (problem !== null) {
      return {
        ok: false,
        error: `La fila ${index + 2} no es válida: ${problem}. No se ha importado nada, para que el archivo no quede a medias.`
      }
    }

    tasks.push(candidate as TransferTask)
  }

  return { ok: true, tasks }
}

/**
 * Decides which character separates the columns.
 *
 * Counts candidates outside quoted fields only, so a header column called "title, notes" does
 * not convince the reader that the file is comma-separated.
 *
 * @param header The header record, as raw text.
 * @returns The separator character.
 */
function detectSeparator(header: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  let insideQuotes = false

  for (const character of header) {
    if (character === '"') {
      insideQuotes = !insideQuotes
      continue
    }

    if (!insideQuotes && character in counts) {
      counts[character] += 1
    }
  }

  // Ties go to the comma, which is what a file written by this app uses.
  return Object.entries(counts).reduce((best, entry) =>
    entry[1] > counts[best] ? entry[0] : best
  , ',')
}

/**
 * Returns the first record of a CSV, which is its header.
 *
 * Scans for the newline rather than splitting on it, because a header cell may itself be
 * quoted and contain one.
 *
 * @param text The file contents.
 * @returns The header record, or `null` when there is none.
 */
function firstRecord(text: string): string | null {
  let insideQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (character === '"') {
      insideQuotes = !insideQuotes
    } else if (character === '\n' && !insideQuotes) {
      return index === 0 ? null : text.slice(0, index)
    }
  }

  return text.trim().length === 0 ? null : text
}

/**
 * Splits CSV text into rows on one separator, honouring quoted fields.
 *
 * The separator is fixed before reading, not guessed per character. A reader that accepted
 * all three at once would split a `;`-separated file on the comma inside a quoted title and
 * turn one row into four.
 *
 * @param text The file contents.
 * @param separator The column separator the file uses.
 * @returns One array of cells per row.
 */
function parseCsvRows(text: string, separator: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let insideQuotes = false

  // A lone carriage return before a line feed is part of the line ending, not content.
  // Normalising first means a quoted field can still carry a newline of its own.
  const source = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]

    if (insideQuotes) {
      if (character === '"') {
        // Two quotes in a row are one escaped quote, not the end of the field.
        if (source[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          insideQuotes = false
        }
      } else {
        cell += character
      }

      continue
    }

    if (character === '"') {
      insideQuotes = true
      continue
    }

    if (character === separator) {
      row.push(cell)
      cell = ''
      continue
    }

    if (character === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }

    cell += character
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }

  return rows
}

/**
 * Reads an empty cell as "no value".
 *
 * @param value The raw cell.
 * @returns `null` when the cell is blank, the text otherwise.
 */
function emptyToNull(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim()

  return trimmed.length === 0 ? null : trimmed
}

/**
 * Reads a minute cell.
 *
 * @param value The raw cell.
 * @param field Field name, for the error message.
 * @param rowNumber Row number, for the error message.
 * @returns The minutes, or `null`.
 * @throws Error When the cell is not a number. The caller turns that into a refusal.
 */
function parseOptionalMinute(value: string | undefined, field: string, rowNumber: number): number | null {
  const trimmed = (value ?? '').trim()

  if (trimmed.length === 0) {
    return null
  }

  const parsed = Number(trimmed)

  if (!Number.isInteger(parsed)) {
    throw new Error(`el campo "${field}" de la fila ${rowNumber} vale "${trimmed}" y no es un número`)
  }

  return parsed
}

/**
 * Reads a tag cell.
 *
 * @param value The raw cell.
 * @returns The tags, without a leading `#`.
 */
function parseTags(value: string | undefined): string[] {
  const trimmed = (value ?? '').trim()

  if (trimmed.length === 0) {
    return []
  }

  return trimmed
    .split('|')
    .map((tag) => tag.replace(/^#/, '').trim())
    .filter((tag) => tag.length > 0)
}

/**
 * Reads a weekday cell.
 *
 * @param value The raw cell, as `1,3,5`.
 * @returns The ISO weekdays, or `null`.
 */
function parseWeekdays(value: string | undefined): number[] | null {
  const trimmed = (value ?? '').trim()

  if (trimmed.length === 0) {
    return null
  }

  const days = trimmed
    .split(/[,;|]/)
    .map((day) => Number(day.trim()))
    .filter((day) => Number.isInteger(day))

  return days.length === 0 ? null : days
}
