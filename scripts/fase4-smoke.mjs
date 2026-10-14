/**
 * Phase 4 smoke: Week, Month and Heatmap views in the real renderer over CDP.
 *
 * Covers the three acceptance criteria of Fase 4 — the heatmap built from a grouped SQL
 * aggregate rather than from task rows, a click on a day navigating to that date, and a view
 * change that lays its grid out before the data lands — plus the security invariants,
 * re-checked now that the renderer reaches a fourth channel.
 *
 * Usage: node scripts/fase4-smoke.mjs
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CDP_PORT = 9336
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
        const wrapper = message.result?.result?.value

        if (!wrapper?.ok) {
          rejectPromise(new Error(`renderer threw: ${wrapper?.e}`))
        } else {
          resolvePromise(wrapper.v)
        }
      }
    })

    socket.addEventListener('error', rejectPromise)
  })
}

/** Runs a batch of checks against the renderer, tolerating an early settle. */
async function run(socketUrl, expression, settleMs = 0) {
  if (settleMs > 0) {
    await new Promise((r) => setTimeout(r, settleMs))
  }

  return evaluate(socketUrl, expression)
}

/**
 * Polls an expression until it returns a truthy value.
 *
 * Every view draws its layout from the URL synchronously and fills it in when the aggregate
 * arrives, so "is the cell painted" and "has the number landed" are two different moments.
 * Sleeping a fixed 800 ms and hoping is how a smoke ends up asserting on a half-loaded screen
 * and calling it green.
 *
 * @param socketUrl CDP target.
 * @param expression Expression evaluated in the renderer.
 * @param timeoutMs How long to keep trying.
 * @returns The first truthy value, or the last value seen.
 */
async function poll(socketUrl, expression, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let last

  while (Date.now() < deadline) {
    last = await evaluate(socketUrl, expression)

    if (last) return last

    await new Promise((r) => setTimeout(r, 100))
  }

  return last
}

const checks = []
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const userDataDir = mkdtempSync(join(tmpdir(), 'taskdiary-f4-'))
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

  // --- Security invariants, re-checked against the new channel ---------------------
  const surface = await run(
    socketUrl,
    `({ require: typeof require, process: typeof process, Buffer: typeof Buffer,
        summaryRange: typeof window.taskDiary.tasks.summaryRange })`
  )

  check('require is still absent', surface.require === 'undefined', surface.require)
  check('process is still absent', surface.process === 'undefined', surface.process)
  check('task:summaryRange is exposed', surface.summaryRange === 'function', surface.summaryRange)

  // --- Seed a spread of days so the aggregate has something to aggregate -------------
  const today = await run(
    socketUrl,
    `(() => {
     const d = new Date()
     const iso = (x) => x.toISOString().slice(0, 10)
     const back = (n) => iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n)))
     return { today: back(0), yesterday: back(1), twoDaysAgo: back(2), threeDaysAgo: back(3), lastWeek: back(9), twoWeeksAgo: back(30) }
   })()`
  )

  const seeded = await run(
    socketUrl,
    `(() => {
       const api = window.taskDiary.tasks
       const t = ${JSON.stringify(today)}
       return Promise.all([
         api.create({ title: 'Tarea medida uno', taskDate: t.today, estimateMin: 60 }),
         api.create({ title: 'Tarea medida dos', taskDate: t.today, estimateMin: 30 }),
         api.create({ title: 'Tarea sin medir', taskDate: t.yesterday, estimateMin: 45 }),
         api.create({ title: 'Tarea antigua', taskDate: t.twoWeeksAgo, estimateMin: 15 })
       ]).then(async created => {
         const tasks = created.map(r => r.task)
         // pending -> done directly leaves started_at NULL: the case migration 0002 could
         // not back-fill, where the real duration is unknowable.
         const unmeasured = await api.setStatus({ id: tasks[2].id, status: 'done' })
         // pending -> in_progress -> done is the measured path: both stamps are real.
         await api.setStatus({ id: tasks[0].id, status: 'in_progress' })
         const measured = await api.setStatus({ id: tasks[0].id, status: 'done' })
         const running = await api.setStatus({ id: tasks[3].id, status: 'in_progress' })
         return {
           n: created.length,
           allOk: [unmeasured, measured, running].every(r => r.ok),
           statuses: tasks.map(t => t.status).join(',')
         }
       })
     })()`
  )
  check(
    'four tasks seeded across three days, and every status change landed',
    seeded?.n === 4 && seeded?.allOk === true,
    JSON.stringify(seeded)
  )

  // --- Acceptance criterion 1: the grid is built from an aggregate ------------------
  // The decisive comparison: the same 182-day range, read both ways. If summaryRange were
  // secretly loading task rows, these two counts would agree.
  const wideRange = await run(
    socketUrl,
    `(() => {
       const end = new Date()
       const endIso = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()))
       const startIso = new Date(endIso); startIso.setUTCDate(startIso.getUTCDate() - 181)
       const fmt = (d) => d.toISOString().slice(0, 10)
       const from = fmt(startIso), to = fmt(endIso)
       return Promise.all([
         window.taskDiary.tasks.summaryRange({ fromDate: from, toDate: to }),
         window.taskDiary.tasks.listRange({ fromDate: from, toDate: to })
       ]).then(([summary, list]) => ({
         ok: summary.ok && list.ok,
         dayCount: summary.ok ? summary.days.length : -1,
         taskCount: list.ok ? list.tasks.length : -1,
         fields: summary.ok && summary.days.length > 0 ? Object.keys(summary.days[0]).sort() : [],
         days: summary.ok ? summary.days : []
       }))
     })()`
  )

  check('summaryRange succeeds over 182 days', wideRange.ok === true)
  check(
    'it returns one row per day with work, not one per task',
    wideRange.dayCount === 3 && wideRange.taskCount === 4,
    `days=${wideRange.dayCount} tasks=${wideRange.taskCount}`
  )
  check(
    'a day carries counts and sums, never a task',
    wideRange.fields.includes('done') &&
      wideRange.fields.includes('estimateMin') &&
      wideRange.fields.includes('realMin') &&
      wideRange.fields.includes('unmeasuredDone') &&
      !wideRange.fields.includes('title'),
    JSON.stringify(wideRange.fields)
  )

  // The scale proof. A heatmap sized window with a busy week inside it must still cost one
  // row per day; the number that matters is that it does not scale with the task count.
  const scale = await run(
    socketUrl,
    `(async () => {
       const api = window.taskDiary.tasks
       const d = new Date(); const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
       const day = (n) => { const x = new Date(base); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0,10) }
       // 40 tasks on one single day.
       await Promise.all(Array.from({ length: 40 }, (_, i) => api.create({ title: 'Carga ' + i, taskDate: day(4) })))
       const from = day(181), to = day(0)
       const summary = await api.summaryRange({ fromDate: from, toDate: to })
       const list = await api.listRange({ fromDate: from, toDate: to })
       return {
         dayCount: summary.ok ? summary.days.length : -1,
         taskCount: list.ok ? list.tasks.length : -1,
         busiest: summary.ok ? summary.days.find(x => x.date === day(4)) : null
       }
     })()`
  )
  check(
    '44 tasks across 182 days still cost 4 grouped rows',
    scale.dayCount === 4,
    `days=${scale.dayCount} tasks=${scale.taskCount}`
  )
  check(
    'while the row reader has to carry every task',
    scale.taskCount === 44,
    `tasks=${scale.taskCount}`
  )
  check(
    'and the busy day carries the whole count in one row',
    scale.busiest?.total === 40,
    JSON.stringify(scale.busiest)
  )

  // --- The balance, and the honest handling of what cannot be measured ---------------
  const balance = await run(
    socketUrl,
    `(() => {
       const d = new Date()
       const iso = (x) => x.toISOString().slice(0, 10)
       const back = (n) => iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n)))
       return window.taskDiary.tasks.summaryRange({ fromDate: back(1), toDate: back(1) })
         .then(r => r.ok ? r.days[0] : null)
     })()`
  )

  check(
    'a task completed without ever running is counted as unmeasured, not as zero real time',
    balance?.done === 1 && balance?.unmeasuredDone === 1 && balance?.realMin === 0,
    JSON.stringify(balance)
  )
  check(
    'and it does not inflate the day as finished work twice',
    balance?.total === 1,
    `total=${balance?.total}`
  )

  const inverted = await run(
    socketUrl,
    `window.taskDiary.tasks.summaryRange({ fromDate: '2026-10-10', toDate: '2026-10-01' }).then(r => ({ ok: r.ok, code: r.ok ? null : r.error.code }))`
  )
  check(
    'an inverted range is refused with the contract error code',
    inverted.ok === false && inverted.code === 'VALIDATION_FAILED',
    JSON.stringify(inverted)
  )

  // --- Acceptance criterion 2: clicking a heatmap day navigates to that date ---------
  await run(socketUrl, `window.location.hash = '#/heatmap'`, 400)
  const grid = await poll(
    socketUrl,
    `(() => {
       const cells = document.querySelectorAll('[data-testid="heatmap-cell"]')
       return cells.length === 182 && cells.length > document.querySelectorAll('[data-testid="heatmap-cell"][data-state="empty"]').length ? {
         cells: cells.length,
         done: document.querySelectorAll('[data-testid="heatmap-cell"][data-state="done"]').length,
         empty: document.querySelectorAll('[data-testid="heatmap-cell"][data-state="empty"]').length
       } : null
})()`
  )
  check('the heatmap draws 182 cells', grid.cells === 182, `cells=${grid.cells}`)
  check(
    'and days with work are not marked empty',
    grid.done > 0 && grid.empty > 0,
    JSON.stringify(grid)
  )

  // Hover first, so the tooltip is on screen when the click lands.
  const hovered = await run(
    socketUrl,
    `(() => {
       const cell = document.querySelector('[data-testid="heatmap-cell"][data-state="done"]')
       if (!cell) return { found: false }
       cell.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
       cell.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
       return { found: true, date: cell.dataset.date }
     })()`
  )
  check('a completed day exists to click', hovered.found === true, JSON.stringify(hovered))

  const tooltip = await run(
    socketUrl,
    `document.querySelector('[data-testid="heatmap-tooltip"]')?.textContent ?? null`
  )
  check(
    'hovering shows a tooltip with the day detail',
    Boolean(tooltip) && tooltip.includes(hovered.date),
    String(tooltip)
  )

  await run(
    socketUrl,
    `(() => { const c = document.querySelector('[data-testid="heatmap-cell"][data-state="done"]'); c.click(); return true })()`
  )
  await new Promise((r) => setTimeout(r, 700))

  const afterClick = await run(
    socketUrl,
    `({ hash: window.location.hash, dayView: document.querySelectorAll('[data-testid="task-row"]').length })`
  )
  check(
    'clicking a heatmap day navigates to that date',
    afterClick.hash === `#/day/${hovered.date}`,
    `${afterClick.hash} (expected #/day/${hovered.date})`
  )
  check(
    'and the day view listed that day’s tasks',
    afterClick.dayView > 0,
    `rows=${afterClick.dayView}`
  )

  // --- Acceptance criterion 3: the grid exists before the data does -----------------
  // A week with no work at all is the honest proof that the layout does not wait for data:
  // seven columns with an empty balance, not a spinner and not a blank frame.
  await run(socketUrl, `(() => { window.location.hash = '#/week/2019-01-07'; return true })()`, 300)
  const emptyWeek = await poll(
    socketUrl,
    `(() => {
       if (document.querySelectorAll('[data-testid="week-column"]').length !== 7) return null
       return { balances: [...document.querySelectorAll('[data-testid="week-balance"]')].map(b => b.textContent.trim()) }
     })()`
  )
  check(
    'a week with no work at all still draws its seven columns',
    emptyWeek?.balances?.length === 7,
    JSON.stringify(emptyWeek?.balances)
  )
  check(
    'with an empty balance rather than a spinner or a blank frame',
    emptyWeek?.balances?.every((text) => text === '—'),
    JSON.stringify(emptyWeek?.balances)
  )

  // RNF-03, measured rather than asserted: route change to a laid-out week, in milliseconds.
  const elapsed = await run(
    socketUrl,
    `(() => {
       const started = performance.now()
       window.location.hash = '#/week/2026-10-05'
       return new Promise(resolve => {
         const tick = () => {
           if (document.querySelectorAll('[data-testid="week-column"]').length === 7) {
             resolve(Math.round(performance.now() - started))
           } else {
             requestAnimationFrame(tick)
           }
         }
         tick()
       })
     })()`
  )
  check(
    "a week view is laid out inside RNF-03's 100 ms",
    typeof elapsed === 'number' && elapsed < 100,
    `${elapsed} ms`
  )

  const week = await poll(
    socketUrl,
    `(() => {
       const balances = document.querySelectorAll('[data-testid="week-balance"]')
       if (balances.length !== 7) return null
       return { hash: window.location.hash,
                columns: document.querySelectorAll('[data-testid="week-column"]').length,
                balances: balances.length }
     })()`
  )
  check('the week view routes from the URL', week?.hash === '#/week/2026-10-05', week?.hash)
  check(
    'and shows seven columns with a balance each',
    week?.columns === 7 && week?.balances === 7,
    JSON.stringify(week)
  )

  await run(
    socketUrl,
    `(() => { window.location.hash = '#/month/2026-10-15'; return true })()`,
    300
  )
  const monthGrid = await poll(
    socketUrl,
    `(() => {
       const rings = document.querySelectorAll('[data-testid="month-ring"]').length
       return rings > 0 ? {
         hash: window.location.hash,
         cells: document.querySelectorAll('[data-testid="month-cell"]').length,
         inMonth: document.querySelectorAll('[data-testid="month-cell"][data-in-month="true"]').length,
         rings
       } : null
     })()`
  )
  check(
    'the month view routes from the URL',
    monthGrid?.hash === '#/month/2026-10-15',
    monthGrid?.hash
  )
  check(
    'and draws a whole-month grid',
    monthGrid?.cells % 7 === 0 && monthGrid?.inMonth === 31,
    JSON.stringify(monthGrid)
  )
  check('with a ring on the days that have tasks', monthGrid.rings > 0, `rings=${monthGrid.rings}`)

  // --- Switching views keeps the date -----------------------------------------------
  const kept = await run(
    socketUrl,
    `(() => {
       window.location.hash = '#/day/2026-10-07'
       return true
     })()`,
    600
  )
  void kept
  const switched = await run(
    socketUrl,
    `(() => {
       const buttons = [...document.querySelectorAll('header button')]
       const week = buttons.find(b => b.textContent.trim() === 'Semana')
       if (!week) return { found: false }
       week.click()
       return { found: true }
     })()`
  )
  check('the title bar offers the other views', switched.found === true)

  await new Promise((r) => setTimeout(r, 700))
  const afterSwitch = await run(
    socketUrl,
    `({ hash: window.location.hash,
        pressed: [...document.querySelectorAll('header button[aria-pressed="true"]')].map(b => b.textContent.trim()) })`
  )
  check(
    'switching views keeps the day instead of jumping to today',
    afterSwitch.hash === '#/week/2026-10-07',
    afterSwitch.hash
  )
  check(
    'and the pressed button matches the route',
    afterSwitch.pressed.includes('Semana'),
    JSON.stringify(afterSwitch.pressed)
  )
} finally {
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
  child.kill()
  // The profile directory stays locked until the process is really gone, and rmSync throws
  // EPERM rather than waiting. Draining first is what makes the cleanup reliable on Windows.
  await Promise.race([exited, new Promise((r) => setTimeout(r, 4000))])
  try {
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    // A profile the OS still holds is not a failed smoke.
  }
}

const failed = checks.filter((c) => !c.ok)

console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)

if (failed.length > 0) {
  console.log('\nFailing checks:')
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)
}

if (mainLog.trim().length > 0) {
  console.log('\n--- main process log ---')
  console.log(mainLog.slice(-3000))
}

process.exit(failed.length > 0 ? 1 : 0)
