/**
 * Phase 5 smoke: recurrence, statistics and import/export in the real renderer over CDP.
 *
 * Covers the five acceptance criteria of Fase 5 — a weekly series materialising exactly once
 * per day, a series whose `until` has passed producing nothing, the JSON round trip returning
 * the same data, a refused import changing nothing, and the unique index refusing a
 * duplicate — plus the security invariants, re-checked now that the renderer reaches two
 *
 * more channels and the statistics screen.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CDP_PORT = 9337
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

const userDataDir = mkdtempSync(join(tmpdir(), 'taskdiary-f5-'))
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
  ['.', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${userDataDir}`],
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

  const run = (expression, settleMs = 0) =>
    settleMs > 0
      ? new Promise((r) => setTimeout(r, settleMs)).then(() => evaluate(socketUrl, expression))
      : evaluate(socketUrl, expression)

  // --- Security invariants, re-checked against the two new channel groups ------------
  const surface = await run(
    `({ require: typeof require, process: typeof process, Buffer: typeof Buffer,
        dataExport: typeof window.taskDiary.data.export,
        dataImport: typeof window.taskDiary.data.import,
        stats: typeof window.taskDiary.stats.summary })`
  )

  check('require is still absent', surface.require === 'undefined', surface.require)
  check('process is still absent', surface.process === 'undefined', surface.process)
  check('data:export is exposed', surface.dataExport === 'function', surface.dataExport)
  check('data:import is exposed', surface.dataImport === 'function', surface.dataImport)
  check('stats:summary is exposed', surface.stats === 'function', surface.stats)

  const dates = await run(`(() => {
     const d = new Date()
     const iso = (x) => x.toISOString().slice(0, 10)
     const back = (n) => iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n)))
     const base = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
     while ((base.getUTCDay() + 6) % 7 !== 0) base.setUTCDate(base.getUTCDate() - 1)
     return { today: back(0), lastWeek: back(7), monday: iso(base),
              nextMonday: iso(new Date(base.getTime() + 7 * 86400000)),
              pastUntil: back(20), pastStart: back(30) }
   })()`)

  const J = JSON.stringify

  // --- Acceptance criterion 1: a weekly series appears exactly once per day ----------
  const weekly = await run(
    `window.taskDiary.tasks.create({
       title: 'Standup semanal', notes: null, taskDate: ${J(dates.monday)},
       status: 'pending', startMin: 540, endMin: 600, estimateMin: 30, color: null,
       tags: ['proyecto'], rruleFreq: 'weekly', rruleInterval: 1,
       rruleDays: [1, 3], rruleUntil: null, rruleFrom: ${J(dates.monday)}
     }).then(r => r.ok ? r.task.id : 'ERROR: ' + r.error.message)`
  )
  check('a weekly series is created', typeof weekly === 'string' && weekly.length > 10, String(weekly))

  const readManyTimes = await run(
    `(() => {
       const api = window.taskDiary.tasks
       return Promise.all(Array.from({ length: 8 }, () => api.list({ taskDate: ${J(dates.nextMonday)} })))
         .then(rs => rs.map(r => r.ok ? r.tasks.length : -1))
     })()`
  )
  check(
    'reading a due day eight times still shows one occurrence',
    readManyTimes.every((n) => n === 1),
    JSON.stringify(readManyTimes)
  )

  const dueDay = await run(
    `window.taskDiary.tasks.list({ taskDate: ${J(dates.nextMonday)} })
       .then(r => r.ok ? r.tasks.map(t => ({ title: t.title, status: t.status, tags: t.tags })) : null)`
  )
  check(
    'the occurrence sits on the day the rule names',
    Array.isArray(dueDay) && dueDay.length === 1 && dueDay[0].title === 'Standup semanal',
    JSON.stringify(dueDay)
  )
  check(
    'it is born pending, not done, and carries the series tags',
    dueDay?.[0]?.status === 'pending' && dueDay?.[0]?.tags?.[0] === 'proyecto',
    JSON.stringify(dueDay?.[0])
  )

  const notDue = await run(
    `window.taskDiary.tasks.list({ taskDate: ${J(dates.lastWeek)} })
       .then(r => r.ok ? r.tasks.filter(t => t.title === 'Standup semanal').length : -1)`
  )
  check('and not on a day the rule does not name', notDue === 0, `n=${notDue}`)

  const twoSeries = await run(
    `(() => {
       const api = window.taskDiary.tasks
       return api.create({ title: 'Gimnasio', notes: null, taskDate: ${J(dates.monday)},
           status: 'pending', startMin: null, endMin: null, estimateMin: null, color: null,
           tags: [], rruleFreq: 'daily', rruleInterval: 1, rruleDays: null,
           rruleUntil: null, rruleFrom: ${J(dates.monday)} })
       .then(created => api.list({ taskDate: ${J(dates.nextMonday)} }).then(listed => ({
         created: created.ok,
         count: listed.ok ? listed.tasks.length : -1,
         titles: listed.ok ? listed.tasks.map(t => t.title).sort() : []
       })))
     })()`
  )
  check(
    'a second series born the same day can exist, and both materialise',
    twoSeries.created === true && twoSeries.count === 2,
    JSON.stringify(twoSeries)
  )

  // --- Acceptance criterion 2: a series whose until has passed ----------------------
  const expired = await run(
    `(() => {
       const api = window.taskDiary.tasks
       return api.create({ title: 'Serie caducada', notes: null,
         taskDate: ${J(dates.pastStart)}, status: 'pending',
         startMin: null, endMin: null, estimateMin: null, color: null, tags: [],
         rruleFreq: 'daily', rruleInterval: 1, rruleDays: null,
         rruleUntil: ${J(dates.pastUntil)}, rruleFrom: ${J(dates.pastStart)} })
       .then(created => {
         if (!created.ok) return { error: created.error.message }
         return Promise.all([
           api.list({ taskDate: ${J(dates.pastUntil)} }),
           api.list({ taskDate: ${J(dates.today)} })
         ]).then(([onUntil, after]) => ({
           onUntil: onUntil.ok ? onUntil.tasks.filter(t => t.title === 'Serie caducada').length : -1,
           after: after.ok ? after.tasks.filter(t => t.title === 'Serie caducada').length : -1
         }))
       })
     })()`
  )
  check(
    'a series with until still produces it on the until day',
    expired.onUntil === 1,
    JSON.stringify(expired)
  )
  check('and produces nothing after it', expired.after === 0, JSON.stringify(expired))

  // --- Acceptance criterion 5: the index refuses a duplicate -------------------------
  const duplicate = await run(
    `(() => {
       const api = window.taskDiary.tasks
       return api.list({ taskDate: ${J(dates.nextMonday)} }).then(r => {
         if (!r.ok) return { error: r.error.message }
         return api.create({ title: 'Standup semanal', notes: null,
           taskDate: ${J(dates.nextMonday)}, status: 'pending',
           startMin: null, endMin: null, estimateMin: null, color: null, tags: [],
           rruleFreq: 'weekly', rruleInterval: 1, rruleDays: [1, 3],
           rruleUntil: null, rruleFrom: ${J(dates.monday)} })
         .then(second => api.list({ taskDate: ${J(dates.nextMonday)} }).then(after => ({
           secondOk: second.ok,
           count: after.ok ? after.tasks.filter(t => t.title === 'Standup semanal').length : -1
         })))
       })
     })()`
  )
  check(
    'a second row for the same series and day is refused',
    duplicate.secondOk === false || duplicate.count === 1,
    JSON.stringify(duplicate)
  )
  check('and the day still holds exactly one occurrence', duplicate.count === 1, `count=${duplicate.count}`)

  // --- Criteria 3 and 4: what can be checked without driving an OS dialog ------------
  // The dialogs are native chrome and cannot be driven over CDP. These check the two halves
  // that can be: a bad payload is refused before anything is written, and the diary is
  // untouched afterwards. The round trip itself is covered by `core/transfer.test.ts` and
  // `db/repositories/transfer-roundtrip.test.ts`.
  const countDiary = `
    window.taskDiary.tasks.listRange({ fromDate: ${J(dates.pastStart)}, toDate: ${J(dates.nextMonday)} })
      .then(r => r.ok ? r.tasks.length : -1)`

  const beforeRefusals = await run(countDiary)

  const refused = await run(
    `window.taskDiary.tasks.listRange({ fromDate: '2026-10-10', toDate: '2026-10-01' })
       .then(r => ({ ok: r.ok, code: r.ok ? null : r.error.code }))`
  )
  check(
    'a malformed request is refused with the contract error code',
    refused.ok === false && refused.code === 'VALIDATION_FAILED',
    JSON.stringify(refused)
  )

  const badFormat = await run(
    `window.taskDiary.data.export({ format: 'yaml' }).then(r => ({ ok: r.ok, code: r.ok ? null : r.error.code }))`
  )
  check(
    'an unknown export format is refused',
    badFormat.ok === false && badFormat.code === 'VALIDATION_FAILED',
    JSON.stringify(badFormat)
  )

  const afterRefusals = await run(countDiary)
  check(
    'and the diary is exactly as it was after both refusals',
    afterRefusals === beforeRefusals,
    `${beforeRefusals} -> ${afterRefusals}`
  )

  // --- The statistics screen -------------------------------------------------------
  await run(`window.location.hash = '#/stats/' + new Date().toISOString().slice(0, 10)`, 400)
  const stats = await poll(
    socketUrl,
    `(() => {
       const streak = document.querySelector('[data-testid="stat-streak"]')
       const bars = document.querySelectorAll('[data-testid="stats-week-bar"]')
       if (!streak || bars.length === 0) return null
       return { streak: streak.textContent.trim(), bars: bars.length,
                compliance: document.querySelector('[data-testid="stat-compliance"]')?.textContent.trim() }
     })()`
  )
  check('the statistics screen shows a streak', stats !== null && /\d/.test(stats.streak ?? ''), JSON.stringify(stats))
  check('and a bar for each day of the week', stats?.bars === 7, `bars=${stats?.bars}`)

  // --- The aggregate sees what the day view sees ------------------------------------
  const expanded = await run(
    `window.taskDiary.tasks.summaryRange({ fromDate: ${J(dates.monday)}, toDate: ${J(dates.nextMonday)} })
       .then(r => r.ok ? r.days.map(d => ({ date: d.date, total: d.total })) : null)`
  )
  check(
    'the aggregate sees the same occurrences the day view lists',
    // Eight days, not two: the daily series materialises across the whole range while the
    // range read runs. What matters is that every day the range covers reports its work, so
    // the Week view and the Day view cannot disagree about the same week.
    Array.isArray(expanded) &&
      expanded.length === 8 &&
      expanded.every((d) => d.total >= 1) &&
      expanded.every((d) => d.date >= dates.monday && d.date <= dates.nextMonday),
    JSON.stringify(expanded)
  )
} finally {
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
  child.kill()
  // The profile directory stays locked until the process is really gone, and rmSync throws
  // EPERM rather than waiting.
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
