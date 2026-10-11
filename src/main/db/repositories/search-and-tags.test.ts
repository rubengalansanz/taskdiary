import { beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from '../database'
import { runMigrations } from '../migrate'
import { TagsRepository } from './tags-repo'
import { TasksRepository, type NewTaskInput } from './tasks-repo'
import type Database from 'better-sqlite3'

/**
 * Tags and search, against a real in-memory SQLite database.
 *
 * The acceptance criterion of Fase 3 says search must work "con acentos y mayúsculas".
 * That claim is only worth something if it is made against SQL rather than against a
 * JavaScript filter, so every search test here goes through `LIKE` on `search_text`.
 */

let database: Database.Database
let tasks: TasksRepository
let tags: TagsRepository

beforeEach(() => {
  database = openInMemoryDatabase()
  runMigrations(database)
  tags = new TagsRepository(database)
  tasks = new TasksRepository(database, tags)
})

function newTask(overrides: Partial<NewTaskInput> = {}): NewTaskInput {
  return {
    title: 'Preparar informe trimestral',
    notes: null,
    taskDate: '2026-10-10',
    startMin: 540,
    endMin: 600,
    estimateMin: 60,
    color: null,
    tags: [],
    rruleFreq: 'none',
    rruleInterval: 1,
    rruleDays: null,
    rruleUntil: null,
    rruleFrom: null,
    ...overrides
  }
}

describe('search_text', () => {
  it('is written on create, folded', () => {
    const created = tasks.create(newTask({ title: 'José Martínez', notes: 'Año nuevo' }))

    const row = database.prepare('SELECT search_text FROM tasks WHERE id = ?').get(created.id) as {
      search_text: string
    }

    // `ñ` survives the fold by design, so "Año" lands as "año" and only the acute accent
    // on "Martínez" is stripped.
    expect(row.search_text).toBe('jose martinez año nuevo')
  })

  it('never replaces the original text', () => {
    tasks.create(newTask({ title: 'José Martínez' }))

    const row = database.prepare('SELECT title FROM tasks').get() as { title: string }

    // The accent is preserved where the user typed it; only the derived column is folded.
    expect(row.title).toBe('José Martínez')
  })

  it('is rebuilt when the title changes', () => {
    const created = tasks.create(newTask({ title: 'Informe' }))

    tasks.update(created.id, { title: 'Presentación PowerPoint' })

    const row = database.prepare('SELECT search_text FROM tasks WHERE id = ?').get(created.id) as {
      search_text: string
    }

    expect(row.search_text).toContain('presentacion')
    expect(row.search_text).not.toContain('informe')
  })

  it('is rebuilt when the notes change', () => {
    const created = tasks.create(newTask({ notes: null }))

    tasks.update(created.id, { notes: 'revisar con Marta' })

    const row = database.prepare('SELECT search_text FROM tasks WHERE id = ?').get(created.id) as {
      search_text: string
    }

    expect(row.search_text).toContain('marta')
  })
})

describe('search: accents and case', () => {
  beforeEach(() => {
    tasks.create(newTask({ title: 'Introducción práctica', notes: 'José y María' }))
    tasks.create(newTask({ title: 'Revisar presupuesto', notes: 'sin acentos' }))
  })

  it('finds an accented word typed without the accent', () => {
    expect(tasks.search({ query: 'introduccion' }).tasks).toHaveLength(1)
  })

  it('finds an unaccented word typed with the accent', () => {
    expect(tasks.search({ query: 'acentós'.replace('ó', 'o') }).total).toBe(1)
  })

  it('is case-insensitive in both directions', () => {
    expect(tasks.search({ query: 'INTRODUCCION' }).total).toBe(1)
    expect(tasks.search({ query: 'introducción' }).total).toBe(1)
  })

  it('matches inside the notes as well as the title', () => {
    expect(tasks.search({ query: 'maria' }).total).toBe(1)
    expect(tasks.search({ query: 'jose' }).total).toBe(1)
  })

  it('keeps ñ distinct from n, in both directions', () => {
    tasks.create(newTask({ taskDate: '2026-10-01', title: 'Fiesta año nuevo' }))
    tasks.create(newTask({ taskDate: '2026-10-02', title: 'Fiesta ano nuevo' }))

    // Folding removes *marks*; it does not substitute one letter for another. If ñ
    // folded to n, both rows would be identical and neither query could tell them apart.
    expect(tasks.search({ query: 'año' }).tasks.map((task) => task.title)).toEqual([
      'Fiesta año nuevo'
    ])
    expect(tasks.search({ query: 'ano' }).tasks.map((task) => task.title)).toEqual([
      'Fiesta ano nuevo'
    ])
  })

  it('returns nothing for a word that is not there', () => {
    expect(tasks.search({ query: 'presupuesto' }).total).toBe(1)
    expect(tasks.search({ query: 'contrato' }).total).toBe(0)
  })

  it('treats a LIKE wildcard typed by the user as a literal', () => {
    tasks.create(newTask({ title: 'Descuento 100%' }))
    tasks.create(newTask({ title: 'Descuento 100 euros' }))

    // Unescaped, `%` would match both rows and then many more.
    const result = tasks.search({ query: '100%' })

    expect(result.tasks.map((task) => task.title)).toEqual(['Descuento 100%'])
  })

  it('treats an underscore as a literal, not as a single-character wildcard', () => {
    tasks.create(newTask({ title: 'archivo_final' }))
    tasks.create(newTask({ title: 'archivo final' }))

    expect(tasks.search({ query: 'archivo_final' }).total).toBe(1)
  })
})

describe('search: filters', () => {
  beforeEach(() => {
    tasks.create(newTask({ taskDate: '2026-10-01', title: 'Antigua', tags: ['proyecto'] }))
    tasks.create(newTask({ taskDate: '2026-10-05', title: 'Media', tags: ['proyecto', 'rutina'] }))
    tasks.create(newTask({ taskDate: '2026-10-10', title: 'Reciente', tags: ['rutina'] }))
  })

  it('filters by status', () => {
    const first = tasks.listByDate('2026-10-01')[0]
    tasks.update(first.id, { status: 'done' })

    const result = tasks.search({ statuses: ['done'] })

    expect(result.total).toBe(1)
    expect(result.tasks[0]?.title).toBe('Antigua')
  })

  it('filters by tag', () => {
    expect(tasks.search({ tagIds: [tags.findByName('proyecto')?.id ?? ''] }).total).toBe(2)
  })

  it('combines tag and status, and the total reflects the combination', () => {
    const first = tasks.listByDate('2026-10-01')[0]
    tasks.update(first.id, { status: 'done' })

    const result = tasks.search({
      tagIds: [tags.findByName('proyecto')?.id ?? ''],
      statuses: ['done']
    })

    expect(result.total).toBe(1)
    expect(result.tasks[0]?.title).toBe('Antigua')
  })

  it('treats several tags as "any of these", so selecting widens the result', () => {
    const proyecto = tags.findByName('proyecto')?.id ?? ''
    const rutina = tags.findByName('rutina')?.id ?? ''

    const either = tasks.search({ tagIds: [proyecto, rutina] })

    // Selecting a second tag must not narrow the list. "Antigua" carries only #proyecto,
    // "Media" carries both, "Reciente" only #rutina — all three match either tag.
    expect(either.total).toBe(3)
    expect(tasks.search({ tagIds: [proyecto] }).total).toBe(2)
    expect(tasks.search({ tagIds: [rutina] }).total).toBe(2)

    // AND semantics would return only "Media". This asserts we are not doing that, so a
    // future change to narrower semantics fails loudly rather than looking like a fix.
    expect(tasks.search({ tagIds: [proyecto, rutina], query: 'antigua' }).total).toBe(1)
    expect(tasks.search({ tagIds: [proyecto, rutina], query: 'media' }).total).toBe(1)
  })

  it('returns everything when no filter is set', () => {
    expect(tasks.search({}).total).toBe(3)
    expect(tasks.search({}).tasks).toHaveLength(3)
  })

  it('orders newest day first', () => {
    expect(tasks.search({}).tasks.map((task) => task.taskDate)).toEqual([
      '2026-10-10',
      '2026-10-05',
      '2026-10-01'
    ])
  })

  it('honours the limit and says whether it truncated', () => {
    const result = tasks.search({ limit: 2 })

    expect(result.tasks).toHaveLength(2)
    expect(result.total).toBe(3)
    expect(result.truncated).toBe(true)
  })

  it('does not report truncation when everything fits', () => {
    const result = tasks.search({ limit: 10 })

    expect(result.tasks).toHaveLength(3)
    expect(result.total).toBe(3)
    expect(result.truncated).toBe(false)
  })

  it('caps the limit so a caller cannot ask for the whole table', () => {
    const result = tasks.search({ limit: 100_000 })

    expect(result.tasks.length).toBeLessThanOrEqual(500)
  })

  it('carries the tags of each hit', () => {
    const result = tasks.search({ query: 'Media' })

    expect(result.tasks[0]?.tags).toEqual(['proyecto', 'rutina'])
  })
})

describe('tags', () => {
  it('attaches tags given on create', () => {
    const created = tasks.create(newTask({ tags: ['proyecto', 'rutina'] }))

    expect(tasks.findById(created.id).tags).toEqual(['proyecto', 'rutina'])
  })

  it('normalises them', () => {
    const created = tasks.create(newTask({ tags: ['#Proyecto', 'RUTINA'] }))

    expect(tasks.findById(created.id).tags).toEqual(['proyecto', 'rutina'])
  })

  it('treats the same tag written twice as one', () => {
    const created = tasks.create(newTask({ tags: ['proyecto', 'proyecto'] }))

    expect(tasks.findById(created.id).tags).toEqual(['proyecto'])
  })

  it('replaces the whole set on update, so a removed tag leaves', () => {
    const created = tasks.create(newTask({ tags: ['proyecto', 'rutina'] }))

    tasks.update(created.id, { tags: ['rutina'] })

    expect(tasks.findById(created.id).tags).toEqual(['rutina'])
  })

  it('leaves tags alone when the update does not mention them', () => {
    const created = tasks.create(newTask({ tags: ['proyecto'] }))

    tasks.update(created.id, { title: 'Otro nombre' })

    expect(tasks.findById(created.id).tags).toEqual(['proyecto'])
  })

  it('empties the set when the update sends an empty list', () => {
    const created = tasks.create(newTask({ tags: ['proyecto'] }))

    tasks.update(created.id, { tags: [] })

    expect(tasks.findById(created.id).tags).toEqual([])
  })

  it('counts how many tasks carry each tag, most used first', () => {
    tasks.create(newTask({ taskDate: '2026-10-01', tags: ['proyecto'] }))
    tasks.create(newTask({ taskDate: '2026-10-02', tags: ['proyecto', 'rutina'] }))

    const all = tags.listAll()

    expect(all[0]?.name).toBe('proyecto')
    expect(all[0]?.taskCount).toBe(2)
    expect(all[1]?.name).toBe('rutina')
    expect(all[1]?.taskCount).toBe(1)
  })

  it('keeps an unused tag, with a count of zero', () => {
    tags.findOrCreate('archivada')
    tasks.create(newTask({ tags: ['proyecto'] }))

    const all = tags.listAll()

    // Deleting it would make the same tag reappear as a duplicate if typed again.
    expect(all.map((tag) => tag.name)).toContain('archivada')
    expect(all.find((tag) => tag.name === 'archivada')?.taskCount).toBe(0)
  })

  it('is idempotent on findOrCreate', () => {
    const first = tags.findOrCreate('proyecto')
    const second = tags.findOrCreate('proyecto')

    expect(first.id).toBe(second.id)
    expect(tags.listAll()).toHaveLength(1)
  })

  it('is idempotent on attach', () => {
    const created = tasks.create(newTask())
    const tag = tags.findOrCreate('proyecto')

    expect(tags.attach(created.id, tag.id)).toBe(true)
    expect(tags.attach(created.id, tag.id)).toBe(false)
    expect(tags.listForTask(created.id)).toHaveLength(1)
  })

  it('cleans task_tags when a task is deleted', () => {
    // The acceptance criterion of Fase 3. Depends on `PRAGMA foreign_keys = ON`, which is
    // a per-connection setting and is applied by `openDatabase`.
    const created = tasks.create(newTask({ tags: ['proyecto'] }))
    const tagId = tags.findByName('proyecto')?.id ?? ''

    tasks.delete(created.id)

    const links = database
      .prepare('SELECT COUNT(*) AS total FROM task_tags WHERE task_id = ?')
      .get(created.id) as { total: number }

    expect(links.total).toBe(0)

    const orphans = database
      .prepare('SELECT COUNT(*) AS total FROM task_tags WHERE tag_id = ?')
      .get(tagId) as { total: number }

    expect(orphans.total).toBe(0)
    // The tag itself survives, so typing `#proyecto` again does not create a duplicate.
    expect(tags.findByName('proyecto')).not.toBeNull()
  })

  it('matches a tag exactly, not by prefix', () => {
    // `proj` and `proyecto` are different tags; a prefix match would conflate them.
    const other = tasks.create(newTask({ taskDate: '2026-10-11', title: 'Otra', tags: ['proj'] }))
    const exact = tasks.create(
      newTask({ taskDate: '2026-10-12', title: 'Exacta', tags: ['proyecto'] })
    )

    const proyecto = tags.findByName('proyecto')?.id ?? ''
    const found = tasks.search({ tagIds: [proyecto] }).tasks.map((task) => task.id)

    expect(found).toEqual([exact.id])
    expect(found).not.toContain(other.id)
  })
})

describe('update is atomic', () => {
  it('rolls back the row, the tags and the search text together', () => {
    const created = tasks.create(
      newTask({ title: 'Informe original', tags: ['proyecto'], notes: 'texto original' })
    )

    // A failure between the three writes would leave the row stale while the tags had
    // already been replaced — a task whose tags say one thing and whose row says another.
    expect(() =>
      tasks.transaction(() => {
        tasks.update(created.id, {
          title: 'Informe cambiado',
          notes: 'texto cambiado',
          tags: ['rutina']
        })
        throw new Error('fallo simulado a mitad')
      })
    ).toThrow(/fallo simulado/)

    const after = tasks.findById(created.id)
    const row = database.prepare('SELECT search_text FROM tasks WHERE id = ?').get(created.id) as {
      search_text: string
    }

    expect(after.title).toBe('Informe original')
    expect(after.tags).toEqual(['proyecto'])
    expect(row.search_text).toBe('informe original texto original')
  })

  it('applies all three when nothing fails', () => {
    const created = tasks.create(newTask({ title: 'Antes', tags: ['proyecto'] }))

    tasks.update(created.id, { title: 'Después', tags: ['rutina'] })

    const after = tasks.findById(created.id)

    expect(after.title).toBe('Después')
    expect(after.tags).toEqual(['rutina'])
  })
})

describe('repository transaction', () => {
  it('rolls back a tag replacement made inside it', () => {
    const created = tasks.create(newTask({ tags: ['proyecto'] }))

    expect(() =>
      tasks.transaction(() => {
        tags.setForTask(created.id, ['rutina'])
        throw new Error('aborto')
      })
    ).toThrow(/aborto/)

    expect(tasks.findById(created.id).tags).toEqual(['proyecto'])
  })
})
