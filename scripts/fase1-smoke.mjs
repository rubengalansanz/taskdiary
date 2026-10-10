/**
 * Fase 1 smoke: drives the real Electron renderer over CDP.
 *
 * Not a substitute for `npm run test` — it proves the things a Node test cannot: that
 * the migration SQL survives bundling into `out/main/index.js`, that the preload bridge
 * exposes `tasks` after `externalizeDeps: false`, and that a rejected payload leaves
 * the on-disk database untouched.
 *
 * Usage: node scripts/fase1-smoke.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CDP_PORT = 9333
const repoRoot = resolve(import.meta.dirname, '..')

/** Waits until the renderer exposes its debugging endpoint. */
async function waitForCdp(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      const targets = await response.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)

      if (page) return page.webSocketDebuggerUrl
    } catch {
      // Not listening yet.
    }

    await new Promise((r) => setTimeout(r, 250))
  }

  throw new Error('CDP endpoint never came up')
}

/** Evaluates an async expression inside the renderer and returns its value. */
function evaluate(socketUrl, expression) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(socketUrl)
    let nextId = 1

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: nextId++,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true }
        })
      )
    })

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)

      if (message.id === 1) {
        socket.close()

        if (message.result?.exceptionDetails) {
          rejectPromise(new Error(JSON.stringify(message.result.exceptionDetails)))
          return
        }

        resolvePromise(message.result?.result?.value)
      }
    })

    socket.addEventListener('error', (e) => rejectPromise(new Error(String(e.error?.message ?? e))))
  })
}

const checks = []
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

// A throwaway userData dir so the smoke never touches the real database.
const userDataDir = mkdtempSync(join(tmpdir(), 'taskdiary-smoke-'))

// The real binary, not the `.bin` shim: spawning `electron.cmd` without a shell fails
// with EINVAL on Windows, and the shim swallows the child's output anyway.
const electron = join(
  repoRoot,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
)

/**
 * Expected schema version, counted from the migration files on disk.
 *
 * Reading it from the repo rather than hard-coding a number is the point: a literal would
 * have kept saying "1" after Fase 2 added `0002`, and this check would have reported a
 * perfectly healthy database as broken.
 */
const expectedSchemaVersion = readdirSync(join(repoRoot, 'migrations')).filter((name) =>
  name.endsWith('.sql')
).length

console.log(`userData: ${userDataDir}\n`)

const child = spawn(
  electron,
  ['.', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDataDir}`],
  {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' }
  }
)

let mainLog = ''
child.stdout.on('data', (chunk) => (mainLog += chunk))
child.stderr.on('data', (chunk) => (mainLog += chunk))

try {
  const socketUrl = await waitForCdp()
  await new Promise((r) => setTimeout(r, 1500))

  // --- Security invariants from Fase 0, re-checked after the bridge grew ----------
  const surface = await evaluate(
    socketUrl,
    `({
      taskDiary: typeof window.taskDiary,
      tasks: typeof window.taskDiary?.tasks,
      create: typeof window.taskDiary?.tasks?.create,
      list: typeof window.taskDiary?.tasks?.list,
      update: typeof window.taskDiary?.tasks?.update,
      remove: typeof window.taskDiary?.tasks?.delete,
      setStatus: typeof window.taskDiary?.tasks?.setStatus,
      require: typeof require,
      process: typeof process,
      Buffer: typeof Buffer,
      module: typeof module,
      electronGlobal: typeof window.electron
    })`
  )

  check('window.taskDiary is an object', surface.taskDiary === 'object', surface.taskDiary)
  check('window.taskDiary.tasks is exposed', surface.tasks === 'object', surface.tasks)
  check(
    'task channels are callable',
    ['create', 'list', 'update', 'remove', 'setStatus'].every((k) => surface[k] === 'function')
  )
  check('require is absent from the renderer', surface.require === 'undefined', surface.require)
  check('process is absent from the renderer', surface.process === 'undefined', surface.process)
  check('Buffer is absent from the renderer', surface.Buffer === 'undefined', surface.Buffer)
  check('module is absent from the renderer', surface.module === 'undefined', surface.module)
  check(
    'window.electron absent in production',
    surface.electronGlobal === 'undefined',
    surface.electronGlobal
  )

  // --- Probe now reports the real schema, not just SELECT 1 ----------------------
  const probe = await evaluate(socketUrl, 'window.taskDiary.db.probe()')
  check('probe ok', probe.ok === true, probe.error ?? '')
  // The expected version is whatever the bundled migrations declare, not a literal:
  // Fase 2 added 0002_started_at, and hard-coding the number here would have made this
  // check lie about a healthy database.
  check(
    'schema version matches the bundled migrations',
    probe.schemaVersion === expectedSchemaVersion,
    `got ${probe.schemaVersion}, expected ${expectedSchemaVersion}`
  )
  check('tasks table exists after migrations', probe.hasTasksTable === true)

  // --- CRUD round trip through the real bridge ------------------------------------
  const created = await evaluate(
    socketUrl,
    `window.taskDiary.tasks.create({
       title: '  Preparar   informe trimestral  ',
       notes: 'con detalle',
       taskDate: '2026-10-10',
       startMin: 540,
       endMin: 600,
       estimateMin: 60
     })`
  )
  check('create returns ok', created.ok === true, JSON.stringify(created.error ?? ''))
  check(
    'title is trimmed and collapsed',
    created.task?.title === 'Preparar informe trimestral',
    created.task?.title
  )
  check('new task is pending', created.task?.status === 'pending', created.task?.status)
  check(
    'task_date persisted as a local string',
    created.task?.taskDate === '2026-10-10',
    created.task?.taskDate
  )
  check(
    'minutes persisted as integers',
    created.task?.startMin === 540 && created.task?.endMin === 600
  )
  check('completed_at is null on create', created.task?.completedAt === null)

  const id = created.task.id

  const listed = await evaluate(
    socketUrl,
    "window.taskDiary.tasks.list({ taskDate: '2026-10-10' })"
  )
  check(
    'list returns the created task',
    listed.ok === true && listed.tasks.length === 1,
    String(listed.tasks?.length)
  )
  check('list round-trips the id', listed.tasks?.[0]?.id === id)

  const updated = await evaluate(
    socketUrl,
    `window.taskDiary.tasks.update({ id: ${JSON.stringify(id)}, title: 'Informe Q3' })`
  )
  check(
    'update changes only what was sent',
    updated.ok === true && updated.task.title === 'Informe Q3',
    updated.task?.title
  )
  check(
    'update preserves untouched fields',
    updated.task?.startMin === 540 && updated.task?.notes === 'con detalle'
  )

  // --- Domain rules refused through the bridge ------------------------------------
  const badDate = await evaluate(
    socketUrl,
    `window.taskDiary.tasks.create({ title: 'X', taskDate: '2026-02-30' })`
  )
  check(
    'non-existent date rejected',
    badDate.ok === false && badDate.error?.code === 'VALIDATION_FAILED',
    badDate.error?.code
  )
  check(
    'rejection carries a Spanish message',
    /inválida/i.test(badDate.error?.message ?? ''),
    badDate.error?.message
  )
  check(
    'rejection names the offending field',
    badDate.error?.details?.field === 'taskDate' ||
      badDate.error?.details?.fieldMessages?.taskDate !== undefined,
    JSON.stringify(badDate.error?.details ?? {})
  )

  const badTitle = await evaluate(
    socketUrl,
    `window.taskDiary.tasks.create({ title: '   ', taskDate: '2026-10-10' })`
  )
  check(
    'empty title rejected',
    badTitle.ok === false && badTitle.error?.code === 'TASK_TITLE_REQUIRED',
    badTitle.error?.code
  )

  const badRange = await evaluate(
    socketUrl,
    `window.taskDiary.tasks.create({ title: 'Y', taskDate: '2026-10-10', startMin: 600, endMin: 540 })`
  )
  check(
    'end before start rejected',
    badRange.ok === false && badRange.error?.code === 'TASK_INVALID_TIME_RANGE',
    badRange.error?.code
  )

  // --- The acceptance criterion: rejected payloads left the database untouched ----
  const afterRejections = await evaluate(
    socketUrl,
    "window.taskDiary.tasks.list({ taskDate: '2026-10-10' })"
  )
  check(
    'rejected payloads wrote nothing',
    afterRejections.ok === true && afterRejections.tasks.length === 1,
    `rows=${afterRejections.tasks?.length}`
  )

  // --- Focus rule ----------------------------------------------------------------
  const second = await evaluate(
    socketUrl,
    "window.taskDiary.tasks.create({ title: 'Segunda', taskDate: '2026-10-10' })"
  )
  await evaluate(
    socketUrl,
    `window.taskDiary.tasks.setStatus({ id: ${JSON.stringify(id)}, status: 'in_progress' })`
  )
  const conflict = await evaluate(
    socketUrl,
    `window.taskDiary.tasks.setStatus({ id: ${JSON.stringify(second.task.id)}, status: 'in_progress' })`
  )
  check(
    'second in_progress on the same day is refused',
    conflict.ok === false && conflict.error?.code === 'FOCUS_ALREADY_SET',
    conflict.error?.code
  )
  check(
    'the conflict names the task holding focus',
    /Informe Q3/.test(conflict.error?.message ?? ''),
    conflict.error?.message
  )

  // --- Terminal status -----------------------------------------------------------
  // The focused task is `in_progress`, and `in_progress → pending` is a legal move.
  // Completing it first is what makes the next call an illegal one.
  const completed = await evaluate(
    socketUrl,
    `window.taskDiary.tasks.update({ id: ${JSON.stringify(id)}, status: 'done' })`
  )
  check(
    'the task can be completed',
    completed.ok === true && completed.task?.status === 'done',
    JSON.stringify(completed.error ?? {})
  )
  check(
    'completing stamps completed_at',
    typeof completed.task?.completedAt === 'string',
    completed.task?.completedAt
  )

  const reopen = await evaluate(
    socketUrl,
    `window.taskDiary.tasks.update({ id: ${JSON.stringify(id)}, status: 'pending' })`
  )
  check(
    'a completed task cannot be reopened',
    reopen.ok === false && reopen.error?.code === 'TASK_INVALID_TRANSITION',
    reopen.error?.code
  )

  // No two-step route either: `done → cancelled` is closed, so cancelling cannot be used
  // to slip back to `pending`.
  const viaCancel = await evaluate(
    socketUrl,
    `window.taskDiary.tasks.update({ id: ${JSON.stringify(id)}, status: 'cancelled' })`
  )
  check(
    'and there is no two-step route back either',
    viaCancel.ok === false && viaCancel.error?.code === 'TASK_INVALID_TRANSITION',
    viaCancel.error?.code
  )

  // --- Delete --------------------------------------------------------------------
  const deleted = await evaluate(
    socketUrl,
    `window.taskDiary.tasks.delete({ id: ${JSON.stringify(second.task.id)} })`
  )
  check('delete removes the row', deleted.ok === true && deleted.removed === true)

  const empty = await evaluate(socketUrl, "window.taskDiary.tasks.list({ taskDate: '2026-10-10' })")
  check(
    'list reflects the deletion',
    empty.ok === true && empty.tasks.length === 1,
    `rows=${empty.tasks.length}`
  )

  // --- No path or stack leaked into the renderer ---------------------------------
  const dbPath = probe.path
  check(
    'no absolute path in any error message',
    ![badDate, badTitle, badRange, conflict].some((r) =>
      JSON.stringify(r.error ?? {}).includes(dbPath.slice(0, 12))
    )
  )
  check(
    'no stack trace in any error message',
    ![badDate, badTitle, badRange, conflict].some((r) =>
      /at\s+\w+\s+\(/.test(r.error?.message ?? '')
    )
  )

  console.log(`\n--- main process log ---\n${mainLog.trim()}`)
} finally {
  // Wait for the process to actually exit before deleting its userData dir: on Windows
  // the SQLite handle and the crashpad process keep the directory locked for a moment
  // after `kill`, and `rmSync` would fail with EPERM.
  const exited = new Promise((resolve) => child.once('exit', resolve))
  child.kill()

  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))])

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      if (existsSync(userDataDir))
        rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 })
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)

if (failed.length > 0) {
  console.error('FAILED: ' + failed.map((c) => c.name).join('; '))
  process.exit(1)
}
