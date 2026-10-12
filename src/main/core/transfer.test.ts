import { describe, expect, it } from 'vitest'
import { parseImportCsv, parseImportJson, toMarkdown, toTransferJson } from './transfer'
import type { TransferTask } from './transfer'

/**
 * Export and import, as pure functions.
 *
 * Two of Fase 5's five acceptance criteria live here, and both are about a promise the app
 * makes to its user: what you take out comes back the same, and what you take in that is
 * broken changes nothing.
 *
 * Everything is text in and text out. The file dialogs and the database are somebody else's
 * problem, which is what lets a round trip be tested without either.
 */

/** A task as it travels in a file, with every field and its type. */
function task(overrides: Partial<TransferTask> = {}): TransferTask {
  return {
    title: 'Preparar informe',
    notes: 'Traer los datos de Q3',
    taskDate: '2026-10-05',
    status: 'done',
    startMin: 540,
    endMin: 600,
    estimateMin: 60,
    color: null,
    tags: ['proyecto', 'rutina'],
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

/** Round-trips a payload through JSON and back. */
function roundTrip(tasks: TransferTask[]): TransferTask[] {
  const result = parseImportJson(toTransferJson(tasks))

  if (!result.ok) {
    // Throwing names the refusal. Returning `undefined` would produce an assertion that reads
    // "expected undefined", which hides the message the user would actually have seen.
    throw new Error(`la exportación fue rechazada: ${result.error}`)
  }

  return result.tasks
}

describe('acceptance criterion 3 — export then import returns the same data', () => {
  it('survives a JSON round trip field for field', () => {
    expect(roundTrip([task()])).toEqual([task()])
  })

  it('keeps several tasks in order', () => {
    const tasks = [
      task({ title: 'Primera', taskDate: '2026-10-01' }),
      task({ title: 'Segunda', taskDate: '2026-10-02' }),
      task({ title: 'Tercera', taskDate: '2026-10-03' })
    ]

    expect(roundTrip(tasks).map((t) => t.title)).toEqual(['Primera', 'Segunda', 'Tercera'])
  })

  it('preserves the fields that are easy to lose — nulls included', () => {
    // An exporter that writes `""` for a null notes field, or drops empty tags, is the kind of
    // loss nobody notices until the second copy of their diary is already wrong.
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

    expect(roundTrip([sparse])).toEqual([sparse])
  })

  it('preserves a recurring series, not just one-offs', () => {
    const series = task({
      status: 'pending',
      rruleFreq: 'weekly',
      rruleDays: [1, 3, 5],
      rruleUntil: '2026-12-31',
      rruleFrom: '2026-10-05',
      startedAt: null,
      completedAt: null
    })

    expect(roundTrip([series])).toEqual([series])
  })

  it('preserves minute-zero, which a truthiness check would drop', () => {
    // `startMin: 0` is midnight and `estimateMin: 0` is a deliberate zero. Writing them only
    // when truthy turns both into null on the way back — and `0` is the one value here that is
    // both falsy and meaningful. `endMin` is 60 rather than 0 because a zero-length task is
    // not a valid one: the end has to be strictly after the start.
    const midnight = task({ startMin: 0, endMin: 60, estimateMin: 0 })

    expect(roundTrip([midnight])).toEqual([midnight])
  })

  it('round-trips an empty diary without inventing a task', () => {
    expect(roundTrip([])).toEqual([])
  })

  it('records a version, so a future format can be recognised rather than guessed at', () => {
    const payload = JSON.parse(toTransferJson([task()])) as { version?: unknown }

    expect(payload.version).toBe(1)
  })
})

describe('acceptance criterion 4 — an invalid import changes nothing', () => {
  it('refuses text that is not JSON, naming what it got', () => {
    // The message is the whole feature here. "Invalid JSON" tells a user nothing they can act
    // on; the first line of what they handed over tells them which file they opened wrong.
    const result = parseImportJson('esto no es json')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('no es JSON válido')
      expect(result.error.length).toBeGreaterThan(20)
    }
  })

  it('refuses an empty file', () => {
    expect(parseImportJson('').ok).toBe(false)
    expect(parseImportJson('   ').ok).toBe(false)
  })

  it('refuses valid JSON that is not an export', () => {
    const result = parseImportJson('{"hola":"mundo"}')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('tareas')
    }
  })

  it('refuses a tasks array with one bad entry, naming the position', () => {
    const payload = JSON.stringify({
      version: 1,
      tasks: [task(), { title: 'Sin fecha', taskDate: 'ayer' }]
    })

    const result = parseImportJson(payload)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('2')
      expect(result.error).toContain('taskDate')
    }
  })

  it('refuses a task with no title, naming the field', () => {
    const result = parseImportJson(
      JSON.stringify({ version: 1, tasks: [{ ...task(), title: '' }] })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('title')
    }
  })

  it('refuses an unknown status rather than guessing', () => {
    const result = parseImportJson(
      JSON.stringify({ version: 1, tasks: [{ ...task(), status: 'cancelled-ish' }] })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('status')
    }
  })

  it('refuses a minute value outside the day', () => {
    const result = parseImportJson(
      JSON.stringify({ version: 1, tasks: [{ ...task(), startMin: 1500 }] })
    )

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('startMin')
    }
  })

  it('refuses an end that is not after its start', () => {
    const result = parseImportJson(
      JSON.stringify({ version: 1, tasks: [{ ...task(), startMin: 600, endMin: 540 }] })
    )

    expect(result.ok).toBe(false)
  })

  it('rejects the whole file when one task is bad, never a partial list', () => {
    // The dangerous version of this feature accepts the good ones and reports the bad ones.
    // Then a user imports a half-corrupted file, believes it worked, and discovers the missing
    // weeks later with no way to tell which tasks never made it.
    const payload = JSON.stringify({
      version: 1,
      tasks: [task({ title: 'Buena' }), task({ title: 'Mala', taskDate: 'nope' })]
    })

    const result = parseImportJson(payload)

    expect(result.ok).toBe(false)
    expect((result as { tasks?: unknown }).tasks).toBeUndefined()
  })

  it('refuses a version it does not know', () => {
    const result = parseImportJson(JSON.stringify({ version: 99, tasks: [] }))

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('99')
    }
  })

  it('never throws, whatever it is handed', () => {
    for (const payload of ['null', '[]', '"texto"', '123', '{', '{"tasks":{}}']) {
      expect(() => parseImportJson(payload)).not.toThrow()
      expect(parseImportJson(payload).ok).toBe(false)
    }
  })
})

describe('toMarkdown', () => {
  it('writes a heading per day', () => {
    const md = toMarkdown([task({ taskDate: '2026-10-05', title: 'Informe' })])

    expect(md).toContain('2026-10-05')
    expect(md).toContain('Informe')
  })

  it('groups the tasks of a day under it', () => {
    const md = toMarkdown([
      task({ taskDate: '2026-10-05', title: 'Primera' }),
      task({ taskDate: '2026-10-05', title: 'Segunda' }),
      task({ taskDate: '2026-10-06', title: 'Tercera' })
    ])

    expect(md.indexOf('Primera')).toBeLessThan(md.indexOf('Segunda'))
    expect(md.indexOf('Segunda')).toBeLessThan(md.indexOf('2026-10-06'))
  })

  it('shows the status in words rather than a code', () => {
    const md = toMarkdown([task({ status: 'done' })])

    expect(md.toLowerCase()).toContain('completada')
  })

  it('renders the times, which is the part a human reads the file for', () => {
    const md = toMarkdown([task({ startMin: 540, endMin: 600 })])

    expect(md).toContain('09:00')
    expect(md).toContain('10:00')
  })

  it('leaves out the times when there are none', () => {
    const md = toMarkdown([task({ startMin: null, endMin: null })])

    expect(md).not.toContain('— —')
  })

  it('writes an untimed task without a broken row', () => {
    const md = toMarkdown([task({ startMin: null, endMin: null, status: 'pending' })])

    expect(md.split('\n').filter((line) => line.includes('Sin hora')).length).toBe(1)
  })

  it('escapes a pipe so a title cannot break the table', () => {
    const md = toMarkdown([task({ title: 'Informar | revisar | archivar' })])

    // One row per task means one pipe-count per task. A raw pipe in the title would add three
    // more and split the row into four columns.
    expect(md.split('\n').filter((line) => line.includes('Informar')).length).toBe(1)
    expect(md).toContain('Informar \\| revisar \\| archivar')
  })

  it('says so when there is nothing to export', () => {
    expect(toMarkdown([]).trim().length).toBeGreaterThan(0)
  })
})

describe('parseImportCsv', () => {
  it('reads a header row and maps it onto the fields', () => {
    const csv = [
      'title,taskDate,status,startMin,endMin,estimateMin',
      'Revisar contrato,2026-10-05,pending,540,600,30'
    ].join('\n')

    const result = parseImportCsv(csv)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tasks[0].title).toBe('Revisar contrato')
      expect(result.tasks[0].taskDate).toBe('2026-10-05')
      expect(result.tasks[0].startMin).toBe(540)
    }
  })

  it('handles quoted fields containing commas', () => {
    const csv = [
      'title,taskDate',
      '"Revisar, y corregir, el contrato",2026-10-05'
    ].join('\n')

    const result = parseImportCsv(csv)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tasks[0].title).toBe('Revisar, y corregir, el contrato')
    }
  })

  it('handles a quoted field containing a newline', () => {
    const csv = ['title,taskDate', '"Primera línea\nsegunda",2026-10-05'].join('\n')

    const result = parseImportCsv(csv)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tasks[0].title).toBe('Primera línea\nsegunda')
    }
  })

  it('reads a semicolon-separated file, the European default', () => {
    // Excel in a Spanish locale writes `;` and a decimal comma. A parser that only knows `,`
    // reads the whole file as one column and reports a title per row.
    const csv = ['title;taskDate;status', 'Revisar;2026-10-05;pending'].join('\n')

    const result = parseImportCsv(csv)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tasks[0].title).toBe('Revisar')
      expect(result.tasks[0].taskDate).toBe('2026-10-05')
    }
  })

  it('splits tags on a semicolon-free separator without eating the title', () => {
    const csv = ['title,taskDate,tags', 'Informe,2026-10-05,"proyecto|rutina"'].join('\n')

    const result = parseImportCsv(csv)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tasks[0].tags).toEqual(['proyecto', 'rutina'])
    }
  })

  it('leaves empty optional cells as null rather than zero or empty string', () => {
    const csv = ['title,taskDate,startMin,endMin,notes', 'Informe,2026-10-05,,,'].join('\n')

    const result = parseImportCsv(csv)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tasks[0].startMin).toBeNull()
      expect(result.tasks[0].notes).toBeNull()
    }
  })

  it('refuses a file with no header row', () => {
    expect(parseImportCsv('').ok).toBe(false)
    expect(parseImportCsv('\n\n').ok).toBe(false)
  })

  it('refuses a header it cannot map', () => {
    const result = parseImportCsv('columna_sin_sentido,otra\n1,2')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('columna_sin_sentido')
    }
  })

  it('refuses a header with no title column', () => {
    const result = parseImportCsv('taskDate,status\n2026-10-05,pending')

    expect(result.ok).toBe(false)
  })

  it('rejects the whole file when one row is bad', () => {
    const csv = ['title,taskDate', 'Buena,2026-10-05', 'Mala,ayer'].join('\n')

    expect(parseImportCsv(csv).ok).toBe(false)
  })

  it('tolerates CRLF, which is what a Windows spreadsheet writes', () => {
    const csv = 'title,taskDate\r\nRevisar,2026-10-05\r\n'

    const result = parseImportCsv(csv)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tasks[0].title).toBe('Revisar')
    }
  })

  it('skips a trailing blank line instead of reporting an empty task', () => {
    const csv = 'title,taskDate\nRevisar,2026-10-05\n\n'

    const result = parseImportCsv(csv)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tasks).toHaveLength(1)
    }
  })
})
