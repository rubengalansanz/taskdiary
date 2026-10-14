/**
 * Phase 3 smoke: tags, search and filters in the real renderer over CDP.
 *
 * Covers the three acceptance criteria of Fase 3 — search that ignores accents and case,
 * tag and status filters that combine with a counter that reflects them, and ON DELETE
 * CASCADE clearing task_tags — plus the security invariants, re-checked now that the
 * renderer reaches a second and third channel.
 *
 * Usage: node scripts/fase3-smoke.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CDP_PORT = 9335
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

/** Evaluates an expression in the renderer, turning a throw into a value. */
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

const userDataDir = mkdtempSync(join(tmpdir(), 'taskdiary-f3-'))
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

  const surface = await run(
    socketUrl,
    `({ require: typeof require, process: typeof process, Buffer: typeof Buffer,
        tags: typeof window.taskDiary.tags, search: typeof window.taskDiary.tasks.search })`
  )

  check('require is still absent', surface.require === 'undefined', surface.require)
  check('process is still absent', surface.process === 'undefined', surface.process)
  check('window.taskDiary.tags is exposed', surface.tags === 'object', surface.tags)
  check('task:search is exposed', surface.search === 'function', surface.search)

  const today = await run(socketUrl, `new Date().toISOString().slice(0,10)`)

  // --- Seed across three days so the search really reaches the history ---------------
  await run(
    socketUrl,
    `Promise.all([
       window.taskDiary.tasks.create({ title: 'Introducción práctica', notes: 'José y María', taskDate: ${JSON.stringify(today)}, tags: ['proyecto'] }),
       window.taskDiary.tasks.create({ title: 'Revisar presupuesto', notes: 'sin acentos', taskDate: '2026-09-01', tags: ['rutina'] }),
       window.taskDiary.tasks.create({ title: 'Actualizar documentación', notes: 'detalle', taskDate: '2026-08-15', tags: ['proyecto', 'rutina'] })
     ]).then(() => true)`
  )

  // --- Acceptance criterion 1: search ignores accents and case ---------------------
  const accentHit = await run(
    socketUrl,
    `window.taskDiary.tasks.search({ query: 'introduccion' }).then(r => r.ok ? { n: r.total, titles: r.tasks.map(t => t.title) } : { error: r.error })`
  )
  check(
    'search finds an accented word typed without the accent',
    accentHit.n === 1,
    `n=${accentHit.n}`
  )
  check(
    'and returns the right task',
    accentHit.titles?.[0] === 'Introducción práctica',
    JSON.stringify(accentHit.titles)
  )

  const caseHit = await run(
    socketUrl,
    `window.taskDiary.tasks.search({ query: 'INTRODUCCIÓN' }).then(r => r.total)`
  )
  check('search is case-insensitive in both directions', caseHit === 1, `n=${caseHit}`)

  const notesHit = await run(
    socketUrl,
    `window.taskDiary.tasks.search({ query: 'maria' }).then(r => r.total)`
  )
  check('search reaches the notes too', notesHit === 1, `n=${notesHit}`)

  const wholeHistory = await run(
    socketUrl,
    `window.taskDiary.tasks.search({ query: 'documentación' }).then(r => r.total)`
  )
  check('search reaches days that are not today', wholeHistory === 1, `n=${wholeHistory}`)

  const none = await run(
    socketUrl,
    `window.taskDiary.tasks.search({ query: 'contrato' }).then(r => r.total)`
  )
  check('a word that is not there finds nothing', none === 0, `n=${none}`)

  // --- Acceptance criterion 2: filters combine and the counter follows --------------
  const tagList = await run(socketUrl, `window.taskDiary.tags.list().then(r => r.ok ? r.tags : [])`)
  check(
    'tag:list returns the tags',
    Array.isArray(tagList) && tagList.length === 2,
    JSON.stringify(tagList)
  )
  check(
    'with their usage counts',
    tagList.find((t) => t.name === 'proyecto')?.taskCount === 2,
    JSON.stringify(tagList.map((t) => [t.name, t.taskCount]))
  )
  check('ordered most used first', tagList[0]?.taskCount >= tagList[tagList.length - 1]?.taskCount)

  const proyectoId = tagList.find((t) => t.name === 'proyecto')?.id
  const rutinaId = tagList.find((t) => t.name === 'rutina')?.id

  const byTag = await run(
    socketUrl,
    `window.taskDiary.tasks.search({ tagIds: [${JSON.stringify(proyectoId)}] }).then(r => r.total)`
  )
  check('filtering by one tag narrows the result', byTag === 2, `n=${byTag}`)

  const eitherTag = await run(
    socketUrl,
    `window.taskDiary.tasks.search({ tagIds: [${JSON.stringify(proyectoId)}, ${JSON.stringify(rutinaId)}] }).then(r => r.total)`
  )
  check('selecting a second tag widens it, not narrows', eitherTag === 3, `n=${eitherTag}`)

  const byStatus = await run(
    socketUrl,
    `window.taskDiary.tasks.search({ statuses: ['pending'] }).then(r => r.total)`
  )
  check('filtering by status works', byStatus === 3, `n=${byStatus}`)

  const combined = await run(
    socketUrl,
    `window.taskDiary.tasks.search({ tagIds: [${JSON.stringify(proyectoId)}], statuses: ['pending'] }).then(r => r.total)`
  )
  check('tag and status combine', combined === 2, `n=${combined}`)

  const emptyCombo = await run(
    socketUrl,
    `window.taskDiary.tasks.search({ tagIds: [${JSON.stringify(rutinaId)}], statuses: ['done'] }).then(r => r.total)`
  )
  check('and can combine to nothing', emptyCombo === 0, `n=${emptyCombo}`)

  const truncated = await run(
    socketUrl,
    `window.taskDiary.tasks.search({ limit: 1 }).then(r => ({ n: r.tasks.length, total: r.total, t: r.truncated }))`
  )
  check(
    'the limit truncates but the counter stays honest',
    truncated.n === 1 && truncated.total === 3 && truncated.t === true,
    JSON.stringify(truncated)
  )

  // --- Acceptance criterion 3: cascade on delete ------------------------------------
  const beforeDelete = await run(
    socketUrl,
    `window.taskDiary.tags.list().then(r => r.tags.reduce((n, t) => n + t.taskCount, 0))`
  )
  const victim = await run(
    socketUrl,
    `window.taskDiary.tasks.create({ title: 'Temporal', taskDate: ${JSON.stringify(today)}, tags: ['proyecto'] }).then(r => r.task.id)`
  )

  const afterCreate = await run(
    socketUrl,
    `window.taskDiary.tags.list().then(r => r.tags.find(t => t.name === 'proyecto').taskCount)`
  )
  check('a new tag raises the count', afterCreate === 3, `count=${afterCreate}`)

  await run(
    socketUrl,
    `window.taskDiary.tasks.delete({ id: ${JSON.stringify(victim)} }).then(r => r.ok)`
  )
  const afterDelete = await run(
    socketUrl,
    `window.taskDiary.tags.list().then(r => r.tags.find(t => t.name === 'proyecto').taskCount)`
  )
  check(
    'deleting the task drops the link, through ON DELETE CASCADE',
    afterDelete === 2,
    `count=${afterDelete}`
  )

  // --- The sidebar in the real UI ---------------------------------------------------
  // Reload first. The sidebar loads the tag list once on mount and caches it for the
  // session, and the seeding above went straight through the bridge, bypassing the UI that
  // would have invalidated it. Reloading rebuilds the cache from what is really stored.
  await run(socketUrl, `location.reload()`)
  await new Promise((r) => setTimeout(r, 2500))

  const sidebar = await run(
    socketUrl,
    `({
       input: !!document.querySelector('[data-testid="search-input"]'),
       counter: document.querySelector('[data-testid="result-count"]')?.textContent ?? '',
       tagBoxes: Array.from(document.querySelectorAll('[data-testid^="filter-tag-"]')).length,
       statusBoxes: Array.from(document.querySelectorAll('[data-testid^="filter-status-"]')).length
     })`
  )
  check('the search box is rendered', sidebar.input === true)
  check('the sidebar lists the tags', sidebar.tagBoxes === 2, `boxes=${sidebar.tagBoxes}`)
  check(
    'the sidebar lists the four statuses',
    sidebar.statusBoxes === 4,
    `boxes=${sidebar.statusBoxes}`
  )
  check(
    'the counter is shown before any filter',
    /\d+ resultado/.test(sidebar.counter),
    sidebar.counter
  )

  // Type into the search box and let the debounce fire.
  await run(
    socketUrl,
    `(() => {
       const input = document.querySelector('[data-testid="search-input"]');
       const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       setter.call(input, 'introduccion');
       input.dispatchEvent(new Event('input', { bubbles: true }));
       return true;
     })()`
  )
  await new Promise((r) => setTimeout(r, 1200))

  const searched = await run(
    socketUrl,
    `({
       counter: document.querySelector('[data-testid="result-count"]')?.textContent ?? '',
       heading: document.querySelector('h1')?.textContent ?? '',
       rows: document.querySelectorAll('[data-testid="task-row"]').length
     })`
  )
  check('typing filters the list down to one row', searched.rows === 1, `rows=${searched.rows}`)
  check('the counter follows the search', /1 resultado/.test(searched.counter), searched.counter)
  check(
    'the heading switches to results mode',
    /Resultados/.test(searched.heading),
    searched.heading
  )

  // The security boundary, last, after everything above has exercised the bridge.
  const stillSandboxed = await run(
    socketUrl,
    `({ require: typeof require, process: typeof process, Buffer: typeof Buffer, electronGlobal: typeof window.electron })`
  )
  check(
    'require still absent after three channels were used',
    stillSandboxed.require === 'undefined',
    stillSandboxed.require
  )
  check('process still absent', stillSandboxed.process === 'undefined', stillSandboxed.process)
  check(
    'window.electron still absent in production',
    stillSandboxed.electronGlobal === 'undefined',
    stillSandboxed.electronGlobal
  )

  // --- The form itself, driven through the UI ---------------------------------------
  // This block exists because the seed above went through the bridge and therefore
  // never exercised the path that was broken: the form used to parse `#tag`, validate the
  // parsed value, and then submit the raw text with no tags at all. Driving the real form
  // is the only check that could have caught it.
  await run(
    socketUrl,
    `(() => {
       const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Nueva tarea'));
       button.click();
       return true;
     })()`
  )
  await new Promise((r) => setTimeout(r, 700))

  const dialogOpen = await run(socketUrl, `!!document.querySelector('#task-title')`)
  check('the form opens', dialogOpen === true)

  const focused = await run(socketUrl, `document.activeElement?.id ?? ''`)
  check('the caret lands in the title', focused === 'task-title', focused)

  // Type a title carrying a tag, exactly as a user would.
  await run(
    socketUrl,
    `(() => {
       const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
       const input = document.querySelector('#task-title');
       set.call(input, 'Tarea desde el formulario #desde-ui');
       input.dispatchEvent(new Event('input', { bubbles: true }));
       return true;
     })()`
  )
  await new Promise((r) => setTimeout(r, 300))

  await run(
    socketUrl,
    `(() => {
       const submit = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Guardar');
       submit.click();
       return true;
     })()`
  )
  await new Promise((r) => setTimeout(r, 1500))

  const saved = await run(
    socketUrl,
    `window.taskDiary.tasks.list({ taskDate: ${JSON.stringify(today)} }).then(r => r.tasks.find(t => t.title.includes('formulario')) ?? null)`
  )
  check('the form created the task', saved !== null, JSON.stringify(saved))
  check(
    'the #tag token was stripped from the title',
    saved?.title === 'Tarea desde el formulario',
    saved?.title
  )
  check(
    'and became a real tag',
    Array.isArray(saved?.tags) && saved.tags.includes('desde-ui'),
    JSON.stringify(saved?.tags)
  )

  const tagsAfterForm = await run(
    socketUrl,
    `window.taskDiary.tags.list().then(r => r.tags.map(t => t.name))`
  )
  check(
    'the tag appears in the sidebar list after a UI write',
    tagsAfterForm.includes('desde-ui'),
    JSON.stringify(tagsAfterForm)
  )

  const sidebarTagsNow = await run(
    socketUrl,
    `Array.from(document.querySelectorAll('[data-testid^="filter-tag-"]')).length`
  )
  check(
    'and the sidebar picks it up without a reload',
    sidebarTagsNow === 3,
    `boxes=${sidebarTagsNow}`
  )

  const securityBefore = await run(
    socketUrl,
    `({ require: typeof require, process: typeof process, Buffer: typeof Buffer, electronGlobal: typeof window.electron })`
  )
  check(
    'require still absent after the form was used',
    securityBefore.require === 'undefined',
    securityBefore.require
  )
  check(
    'window.electron still absent in production',
    securityBefore.electronGlobal === 'undefined',
    securityBefore.electronGlobal
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
