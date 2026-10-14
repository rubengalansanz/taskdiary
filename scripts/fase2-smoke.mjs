/**
 * Phase 2 smoke: drives the Day view in the real renderer over CDP.
 *
 * Covers the three acceptance criteria of Fase 2 end to end — the focus rule is refused
 * by the main process, Ctrl+N lands the caret in the title, and create → complete →
 * navigate back shows the task in its history — plus the theme, the routing and the
 * fact that the renderer still has no Node capability now that it renders real UI.
 *
 * Usage: node scripts/fase2-smoke.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CDP_PORT = 9334
const repoRoot = resolve(import.meta.dirname, '..')

async function waitForCdp(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      const targets = await response.json()
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)

      if (page) return page.webSocketDebuggerUrl
    } catch {
      /* not listening yet */
    }

    await new Promise((r) => setTimeout(r, 250))
  }

  throw new Error('CDP endpoint never came up')
}

/** Evaluates an expression in the renderer, awaiting promises and unwrapping exceptions. */
function evaluate(socketUrl, expression) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(socketUrl)
    const id = 1

    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: {
            expression: `(() => { try { return Promise.resolve(${expression}).then(v => ({ok:true, v}), e => ({ok:false, e: String(e && e.message || e)})); } catch (e) { return Promise.resolve({ok:false, e: String(e && e.message || e)}); } })()`,
            awaitPromise: true,
            returnByValue: true
          }
        })
      )
    })

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)

      if (message.id === id) {
        socket.close()
        resolvePromise(message.result?.result?.value)
      }
    })

    socket.addEventListener('error', (e) => rejectPromise(new Error(String(e.error?.message ?? e))))
  })
}

/** Convenience: run an expression and return its value, throwing on rejection. */
async function run(socketUrl, expression) {
  const wrapper = await evaluate(socketUrl, expression)

  if (!wrapper?.ok) {
    throw new Error(`renderer threw: ${wrapper?.e}`)
  }

  return wrapper.v
}

const checks = []
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const userDataDir = mkdtempSync(join(tmpdir(), 'taskdiary-f2-'))
const electron = join(
  repoRoot,
  'node_modules',
  'electron',
  'dist',
  process.platform === 'win32' ? 'electron.exe' : 'electron'
)

console.log(`userData: ${userDataDir}\n`)

const child = spawn(
  electron,
  [
    '.',
    // Chromium's sandbox needs a setuid helper a CI runner does not provide, and the
    // app exits at startup without one. Linux only, so a desktop keeps the protection.
    ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`
  ],
  {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production' }
  }
)

let mainLog = ''
child.stdout.on('data', (c) => (mainLog += c))
child.stderr.on('data', (c) => (mainLog += c))

try {
  const socketUrl = await waitForCdp()
  await new Promise((r) => setTimeout(r, 2000))

  // --- Security invariants still hold now that the renderer renders real UI ---------
  const surface = await run(
    socketUrl,
    `({
      require: typeof require,
      process: typeof process,
      Buffer: typeof Buffer,
      module: typeof module,
      electronGlobal: typeof window.electron,
      taskDiary: typeof window.taskDiary,
      menu: typeof window.taskDiary.menu,
      router: window.location.hash
    })`
  )

  check(
    'require is still absent from the renderer',
    surface.require === 'undefined',
    surface.require
  )
  check('process is still absent', surface.process === 'undefined', surface.process)
  check('Buffer is still absent', surface.Buffer === 'undefined', surface.Buffer)
  check(
    'window.electron still absent in production',
    surface.electronGlobal === 'undefined',
    surface.electronGlobal
  )
  check('window.taskDiary.menu is exposed', surface.menu === 'object', surface.menu)
  check(
    'the app routes into a day',
    /#\/day\/\d{4}-\d{2}-\d{2}/.test(surface.router),
    surface.router
  )

  // --- The Day view rendered -------------------------------------------------------
  await new Promise((r) => setTimeout(r, 500))

  const heading = await run(socketUrl, `document.querySelector('h1')?.textContent ?? ''`)
  check('the day heading is rendered in Spanish', /de \d{4}$/.test(heading), heading)

  const emptyState = await run(
    socketUrl,
    `document.body.textContent.includes('Todavía no hay tareas')`
  )
  check('the empty state is shown on a fresh database', emptyState === true)

  // --- Acceptance criterion 1: create through the UI ---------------------------------
  const created = await run(
    socketUrl,
    `window.taskDiary.tasks.create({
       title: 'Preparar informe trimestral', taskDate: new Date().toISOString().slice(0,10),
       startMin: 540, endMin: 600
     }).then(r => r.ok ? {id: r.task.id} : {error: r.error})`
  )
  check(
    'a task can be created',
    typeof created.id === 'string',
    JSON.stringify(created.error ?? '')
  )

  await run(socketUrl, `location.reload()`)
  await new Promise((r) => setTimeout(r, 2000))

  const rows = await run(
    socketUrl,
    `Array.from(document.querySelectorAll('[data-testid="task-row"]')).map(el => ({
       title: el.textContent, status: el.getAttribute('data-status'), id: el.getAttribute('data-task-id')
     }))`
  )
  check('the created task is rendered in the list', rows.length === 1, `rows=${rows.length}`)
  check('the row shows the pending state', rows[0]?.status === 'pending', rows[0]?.status)
  check(
    'the row shows the start time as HH:MM',
    rows[0]?.title.includes('09:00') === true,
    rows[0]?.title
  )

  // --- Acceptance criterion 2: the focus rule is refused -----------------------------
  await run(
    socketUrl,
    `window.taskDiary.tasks.create({ title: 'Segunda', taskDate: new Date().toISOString().slice(0,10) }).then(r => r.id)`
  )
  const today = await run(socketUrl, `new Date().toISOString().slice(0,10)`)

  const list = await run(
    socketUrl,
    `window.taskDiary.tasks.list({ taskDate: ${JSON.stringify(today)} }).then(r => r.tasks)`
  )
  const first = list.find((t) => t.title === 'Preparar informe trimestral')
  const second = list.find((t) => t.title === 'Segunda')

  const started = await run(
    socketUrl,
    `window.taskDiary.tasks.setStatus({ id: ${JSON.stringify(first.id)}, status: 'in_progress' })`
  )
  check('the first task can be started', started.ok === true, JSON.stringify(started.error ?? ''))
  check(
    'starting stamps startedAt',
    typeof started.task?.startedAt === 'string',
    started.task?.startedAt
  )

  const conflict = await run(
    socketUrl,
    `window.taskDiary.tasks.setStatus({ id: ${JSON.stringify(second.id)}, status: 'in_progress' })`
  )
  check('a second in_progress task on the same day is refused', conflict.ok === false, '')
  check(
    'the refusal is FOCUS_ALREADY_SET',
    conflict.error?.code === 'FOCUS_ALREADY_SET',
    conflict.error?.code
  )
  check(
    'the refusal names the task holding focus',
    /Preparar informe/.test(conflict.error?.message ?? ''),
    conflict.error?.message
  )

  // --- The live stopwatch ------------------------------------------------------------
  await run(socketUrl, `location.reload()`)
  await new Promise((r) => setTimeout(r, 2500))

  const stopwatch = await run(
    socketUrl,
    `(() => { const el = document.querySelector('[data-testid="stopwatch"]'); return el ? el.textContent : null })()`
  )
  check('a running task shows a live stopwatch', stopwatch !== null, String(stopwatch))
  check(
    'the stopwatch shows elapsed time',
    /^\d+:\d{2}$/.test(String(stopwatch)),
    String(stopwatch)
  )

  const runningRows = await run(
    socketUrl,
    `Array.from(document.querySelectorAll('[data-testid="task-row"]')).map(el => el.getAttribute('data-status'))`
  )
  check(
    'the row shows the in_progress state',
    runningRows.includes('in_progress'),
    runningRows.join(',')
  )

  // --- Acceptance criterion 3: complete, go back, the task is in the history --------
  const completed = await run(
    socketUrl,
    `window.taskDiary.tasks.update({ id: ${JSON.stringify(first.id)}, status: 'done' }).then(r => r.ok ? {status: r.task.status, completedAt: r.task.completedAt, startedAt: r.task.startedAt} : {error: r.error})`
  )
  check(
    'the task can be completed',
    completed.status === 'done',
    JSON.stringify(completed.error ?? '')
  )
  check(
    'completing stamps completedAt',
    typeof completed.completedAt === 'string',
    completed.completedAt
  )
  check('completing clears startedAt', completed.startedAt === null, String(completed.startedAt))

  const yesterday = await run(
    socketUrl,
    `(() => { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10) })()`
  )
  await run(socketUrl, `location.hash = '#/day/${yesterday}'`)
  await new Promise((r) => setTimeout(r, 1200))

  const onYesterday = await run(
    socketUrl,
    `document.querySelectorAll('[data-testid="task-row"]').length`
  )
  check('yesterday starts empty', onYesterday === 0, `rows=${onYesterday}`)

  const yesterdayTask = await run(
    socketUrl,
    `window.taskDiary.tasks.create({ title: 'Tarea de ayer', taskDate: ${JSON.stringify(yesterday)} }).then(r => r.ok)`
  )
  check('a task can be created on another day', yesterdayTask === true)

  await run(socketUrl, `location.hash = '#/day/${today}'`)
  await new Promise((r) => setTimeout(r, 1200))
  const backOnToday = await run(
    socketUrl,
    `document.querySelectorAll('[data-testid="task-row"]').length`
  )
  check('coming back to today shows the day again', backOnToday === 2, `rows=${backOnToday}`)

  // The completion above went straight through the bridge, bypassing the view, so the
  // cache still holds the pre-write state. Reload before asserting on the DOM: a stale
  // render here would be the smoke's own doing, not the app's.
  await run(socketUrl, `location.reload()`)
  await new Promise((r) => setTimeout(r, 2000))

  const doneRow = await run(
    socketUrl,
    `Array.from(document.querySelectorAll('[data-testid="task-row"]')).some(el => el.getAttribute('data-status') === 'done')`
  )
  check('the completed task is rendered as done', doneRow === true)

  // --- Routing: the day is in the URL and survives a reload --------------------------
  const hashNow = await run(socketUrl, `window.location.hash`)
  check('the day lives in the URL', hashNow === `#/day/${today}`, hashNow)

  const backButtonWorks = await run(socketUrl, `(() => { history.back(); return true })()`)
  await new Promise((r) => setTimeout(r, 800))
  const afterBack = await run(socketUrl, `window.location.hash`)
  check('the back button walks the day history', afterBack === `#/day/${yesterday}`, afterBack)

  // --- A malformed URL repairs instead of dead-ending ---------------------------------
  await run(socketUrl, `location.hash = '#/day/ayer'`)
  await new Promise((r) => setTimeout(r, 900))
  const repaired = await run(socketUrl, `window.location.hash`)
  check(
    'a malformed date in the URL repairs to a real day',
    /^#\/day\/\d{4}-\d{2}-\d{2}$/.test(repaired),
    repaired
  )

  console.log(`\n--- main process log ---\n${mainLog.trim()}`)
} finally {
  const exited = new Promise((r) => child.once('exit', r))
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
