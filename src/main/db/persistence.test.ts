import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './database'
import { runMigrations } from './migrate'
import { TasksRepository } from './repositories/tasks-repo'
import { TagsRepository } from './repositories/tags-repo'
import type Database from 'better-sqlite3'

/**
 * "Cerrar y abrir: datos persisten" (Fase 6, S7).
 *
 * This is the acceptance criterion every other guarantee rests on, and nothing tested it. Every
 * repository test in this project runs on `openInMemoryDatabase()`, which is right for testing
 * behaviour and useless for testing persistence: an in-memory database is discarded the moment
 * the handle goes away, so it survives nothing by definition. Even the round-trip test opened a
 * *second* in-memory database, which is a different database — it proved a clean write and a
 * clean read of unrelated data, not that anything persisted.
 *
 * So this file uses a real file in a real temporary directory, closes the handle, and opens it
 * again. The directory lives under the OS temp dir, never in the worktree.
 */

const scratch: string[] = []

afterEach(() => {
  // Windows holds file locks for a beat after `close()`, so a failed test leaves the directory
  // behind rather than failing the next one.
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
})

/**
 * A closed-then-reopened database file, with its schema at the current version.
 *
 * @returns The path to the file and an opener for it.
 */
function aDatabaseFile(): { path: string; open: () => Database.Database } {
  const directory = mkdtempSync(join(tmpdir(), 'taskdiary-persist-'))
  scratch.push(directory)

  const path = join(directory, 'taskdiary.db')

  // Opened once so the migrations run and the file exists with a real schema on disk.
  const seed = openDatabase(path)
  runMigrations(seed)
  seed.close()

  return { path, open: (): Database.Database => openDatabase(path) }
}

/** A one-off task payload. */
function aTask(title: string) {
  return {
    title,
    notes: 'notas que deben sobrevivir',
    taskDate: '2026-10-10',
    startMin: 9 * 60,
    endMin: 10 * 60,
    estimateMin: 60,
    color: null,
    tags: ['proyecto'],
    rruleFreq: 'none' as const,
    rruleInterval: 1,
    rruleDays: null,
    rruleUntil: null,
    rruleFrom: null
  }
}

describe('closing and reopening the diary (S7)', () => {
  it('finds a task that was written before the app closed', () => {
    const file = aDatabaseFile()

    const first = file.open()
    const tags = new TagsRepository(first)
    const created = new TasksRepository(first, tags).create(aTask('Preparar informe'))

    first.close()

    const second = file.open()
    const reopened = new TasksRepository(second, new TagsRepository(second)).findById(created.id)

    expect(reopened.title).toBe('Preparar informe')
    expect(reopened.notes).toBe('notas que deben sobrevivir')
    second.close()
  })

  it('keeps the tags, which live in their own table', () => {
    const file = aDatabaseFile()

    const first = file.open()
    const tags = new TagsRepository(first)
    const created = new TasksRepository(first, tags).create(aTask('Con etiquetas'))

    first.close()

    const second = file.open()
    const reopened = new TasksRepository(second, new TagsRepository(second)).findById(created.id)

    // The row and its labels are written by two different statements; persistence has to hold
    // for both or a task comes back unlabelled with nothing indicating why.
    expect(reopened.tags).toEqual(['proyecto'])
    second.close()
  })

  it('keeps a completion, so the diary is still a record of what happened', () => {
    const file = aDatabaseFile()

    const first = file.open()
    const tags = new TagsRepository(first)
    const repository = new TasksRepository(first, tags)
    const created = repository.create(aTask('Se completó'))
    repository.update(created.id, { status: 'done' })

    first.close()

    const second = file.open()
    const reopened = new TasksRepository(second, new TagsRepository(second)).findById(created.id)

    expect(reopened.status).toBe('done')
    expect(reopened.completedAt).not.toBeNull()
    second.close()
  })

  it('survives more than one restart', () => {
    const file = aDatabaseFile()

    const first = file.open()
    new TasksRepository(first, new TagsRepository(first)).create(aTask('Primera sesión'))
    first.close()

    const second = file.open()
    const secondRepository = new TasksRepository(second, new TagsRepository(second))
    secondRepository.create(aTask('Segunda sesión'))
    second.close()

    const third = file.open()
    const titles = new TasksRepository(third, new TagsRepository(third))
      .listByDate('2026-10-10')
      .map((task) => task.title)

    expect(titles).toContain('Primera sesión')
    expect(titles).toContain('Segunda sesión')
    third.close()
  })

  it('leaves a real file behind, not just a working handle', () => {
    // The assertion that matters for every test above: if this were still in-memory, reopening
    // would return a different empty database and the others would fail in a confusing way.
    const file = aDatabaseFile()

    const database = file.open()
    new TasksRepository(database, new TagsRepository(database)).create(aTask('En disco'))
    database.close()

    // The path comes from mkdtempSync in this very test, not from input; the rule guards against
    // untrusted filenames and there is nothing untrusted here.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    expect(existsSync(file.path)).toBe(true)
    expect(file.path.endsWith('taskdiary.db')).toBe(true)
  })
})
