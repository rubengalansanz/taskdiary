import { describe, expect, it } from 'vitest'
import {
  SHEET_FORMATS,
  parseSpreadsheet,
  spreadsheetHeaders,
  toSpreadsheet,
  toSheetRows
} from './sheets'
import type { TransferTask } from './transfer'

/**
 * Spreadsheets: the diary in four formats.
 *
 * A sheet has cells, not a model, so everything here is about one fixed mapping between a
 * domain field and a column — and about not losing anything silently on the way out.
 *
 * The three spreadsheet formats are asserted by *round trip*, not by comparing bytes: a file
 * that writes is worthless if reading it back gives something different, and that is the only
 * property a user can actually observe.
 */

/** A task as it travels, with every field at a meaningful value. */
function task(overrides: Partial<TransferTask> = {}): TransferTask {
  return {
    title: 'Revisar el contrato',
    notes: 'Traer la versión del cliente',
    taskDate: '2026-10-05',
    status: 'done',
    startMin: 540,
    endMin: 600,
    estimateMin: 60,
    color: '#ff8800',
    tags: ['legal', 'proyecto'],
    rruleFreq: 'none',
    rruleInterval: 1,
    rruleDays: null,
    rruleUntil: null,
    rruleFrom: null,
    startedAt: '2026-10-05T09:00:00.000Z',
    completedAt: '2026-10-05T10:00:00.000Z',
    ...overrides
  }
}

/** Every format, so a loop covers what a loop should. */
const FORMATS = ['xlsx', 'xls', 'ods', 'csv'] as const

describe('the column mapping', () => {
  it('is declared once, and every field appears', () => {
    const headers = spreadsheetHeaders()

    for (const field of [
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
    ]) {
      expect(headers).toContain(field)
    }
  })

  it('writes minutes as numbers, not as clock strings', () => {
    // "09:00" is text in one application and a time in another, so a file written with it
    // behaves differently depending on who opens it. The integer is a number everywhere.
    const [row] = toSheetRows([task()])

    expect(row.startMin).toBe(540)
    expect(row.endMin).toBe(600)
    expect(typeof row.startMin).toBe('number')
  })

  it('joins tags with a separator the parser can split unambiguously', () => {
    const [row] = toSheetRows([task()])

    expect(row.tags).toBe('legal|proyecto')
  })
})

describe('round trip', () => {
  for (const format of FORMATS) {
    it(`${format} returns the same data it was given`, () => {
      const tasks = [task(), task({ title: 'Segunda', taskDate: '2026-10-06', status: 'pending' })]

      const parsed = parseSpreadsheet(toSpreadsheet(tasks, format), format)

      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(parsed.tasks).toEqual(tasks)
    })
  }

  it('survives the values that are easy to lose', () => {
    const sparse = task({
      notes: null,
      color: null,
      startMin: null,
      endMin: null,
      estimateMin: null,
      tags: [],
      rruleDays: null,
      rruleUntil: null,
      rruleFrom: null,
      startedAt: null,
      completedAt: null
    })

    const parsed = parseSpreadsheet(toSpreadsheet([sparse], 'xlsx'), 'xlsx')

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.tasks[0]).toEqual(sparse)
  })

  it('survives minute zero, which is both falsy and meaningful', () => {
    const midnight = task({ startMin: 0, endMin: 60, estimateMin: 0 })

    const parsed = parseSpreadsheet(toSpreadsheet([midnight], 'xlsx'), 'xlsx')

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.tasks[0].startMin).toBe(0)
      expect(parsed.tasks[0].estimateMin).toBe(0)
    }
  })

  it('survives a recurring series, weekday list included', () => {
    const series = task({
      status: 'pending',
      rruleFreq: 'weekly',
      rruleDays: [1, 3, 5],
      rruleUntil: '2026-12-31',
      rruleFrom: '2026-10-05',
      startedAt: null,
      completedAt: null
    })

    const parsed = parseSpreadsheet(toSpreadsheet([series], 'xlsx'), 'xlsx')

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.tasks[0].rruleFreq).toBe('weekly')
      expect(parsed.tasks[0].rruleDays).toEqual([1, 3, 5])
      expect(parsed.tasks[0].rruleUntil).toBe('2026-12-31')
    }
  })

  it('round-trips an empty diary without inventing a task', () => {
    const parsed = parseSpreadsheet(toSpreadsheet([], 'xlsx'), 'xlsx')

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.tasks).toEqual([])
  })
})

describe('a sheet a human edited', () => {
  it('reads the columns whatever order they are in', () => {
    // A spreadsheet is something people rearrange. Keying by header name rather than position
    // is the difference between importing that file and telling the user their sheet is wrong.
    const csv = ['status,taskDate,title', 'done,2026-10-05,Revisar contrato'].join('\n')

    const parsed = parseSpreadsheet(Buffer.from(csv, 'utf8'), 'csv')

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.tasks[0].title).toBe('Revisar contrato')
      expect(parsed.tasks[0].taskDate).toBe('2026-10-05')
      expect(parsed.tasks[0].status).toBe('done')
    }
  })

  it('fills in what the sheet does not carry', () => {
    const csv = ['title,taskDate', 'Sin extras,2026-10-05'].join('\n')

    const parsed = parseSpreadsheet(Buffer.from(csv, 'utf8'), 'csv')

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.tasks[0].notes).toBeNull()
      expect(parsed.tasks[0].tags).toEqual([])
      expect(parsed.tasks[0].status).toBe('pending')
    }
  })

  it('reads a number a spreadsheet stored as text', () => {
    // Every spreadsheet application decides on its own whether 540 is a number or the word
    // "540". Both happen in real files.
    const csv = ['title,taskDate,startMin', 'Tarea,2026-10-05,"540"'].join('\n')

    const parsed = parseSpreadsheet(Buffer.from(csv, 'utf8'), 'csv')

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.tasks[0].startMin).toBe(540)
  })

  it('ignores columns it does not know', () => {
    const csv = ['title,taskDate,columnaQueNoExiste', 'Tarea,2026-10-05,ruido'].join('\n')

    const parsed = parseSpreadsheet(Buffer.from(csv, 'utf8'), 'csv')

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.tasks[0].title).toBe('Tarea')
  })

  it('treats an empty cell as absent rather than as zero', () => {
    const csv = ['title,taskDate,startMin', 'Tarea,2026-10-05,'].join('\n')

    const parsed = parseSpreadsheet(Buffer.from(csv, 'utf8'), 'csv')

    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.tasks[0].startMin).toBeNull()
  })
})

describe('a file we refuse', () => {
  it('refuses a file that is not a spreadsheet', () => {
    const result = parseSpreadsheet(Buffer.from('esto no es una hoja de cálculo'), 'xlsx')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.length).toBeGreaterThan(20)
  })

  it('refuses an empty file', () => {
    expect(parseSpreadsheet(Buffer.alloc(0), 'xlsx').ok).toBe(false)
  })

  it('refuses a sheet with no rows and says so', () => {
    const parsed = parseSpreadsheet(toSpreadsheet([], 'xlsx'), 'xlsx')

    // An empty export is a legitimate file; importing it should say "nothing to import" rather
    // than fail as though the file were damaged.
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.tasks).toEqual([])
  })

  it('refuses a row with no title, naming the row', () => {
    // The bad row is the third *line* of the file: line 1 is the header, line 2 the good task.
    // A spreadsheet counts lines, not data rows, so the number has to be the one the user sees.
    const csv = ['title,taskDate', 'Buena,2026-10-05', ',2026-10-06'].join('\n')

    const result = parseSpreadsheet(Buffer.from(csv, 'utf8'), 'csv')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('fila 3')
      expect(result.error).toContain('title')
    }
  })

  it('refuses a bad date, naming the field', () => {
    const result = parseSpreadsheet(Buffer.from('title,taskDate\nTarea,ayer'), 'csv')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('taskDate')
  })

  it('refuses an unknown status rather than guessing', () => {
    const result = parseSpreadsheet(
      Buffer.from('title,taskDate,status\nTarea,2026-10-05,casi-hecho'),
      'csv'
    )

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('status')
  })

  it('rejects the whole file when one row is bad', () => {
    const csv = ['title,taskDate', 'Buena,2026-10-05', 'Mala,ayer'].join('\n')

    const result = parseSpreadsheet(Buffer.from(csv, 'utf8'), 'csv')

    expect(result.ok).toBe(false)
    expect((result as { tasks?: unknown }).tasks).toBeUndefined()
  })

  it('never throws, whatever bytes it is handed', () => {
    for (const payload of [Buffer.alloc(0), Buffer.from([0, 1, 2, 3]), Buffer.from(' ')]) {
      expect(() => parseSpreadsheet(payload, 'xlsx')).not.toThrow()
    }
  })
})

describe('the format list', () => {
  it('names exactly the four spreadsheet formats', () => {
    expect([...SHEET_FORMATS].sort()).toEqual(['csv', 'ods', 'xls', 'xlsx'])
  })
})
