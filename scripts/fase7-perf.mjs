/**
 * Fase 7, S1 — measures the RNF the phase is supposed to deliver.
 *
 * The phase's whole deliverable is "cumple RNF-01 a RNF-05", and until now those five numbers
 * had never been observed once. A plan full of targets is not evidence that the targets hold,
 * and Fase 6 is the proof: every box ticked, and half the acceptance criteria turned out to be
 * unreachable or already true. So this script does not assert — it *reports*, and the report
 * says as loudly what it does not cover as what it found.
 *
 * What each number means, and what it leaves out:
 *
 *   RNF-01 cold start  `startedAt`, taken immediately before the spawn, to the title bar being
 *                      in the document. This is an UPPER BOUND: it includes process spawn,
 *                      Node and Chromium boot, the theme bridge round trip, React mount and
 *                      first paint. The real "user sees the window" is earlier, by however much
 *                      `ready-to-show` leads that first row. Measured three times and reported
 *                      as a list plus a median, because one cold start on a developer machine
 *                      is noise: Defender, a busy disk and a warm cache move it by hundreds of
 *                      milliseconds in either direction.
 *   RNF-02 create      Two numbers, because "con atajo" hides two different costs. `formOpen`
 *                      is Ctrl+N to the title field being on screen; `commit` is submitting to
 *                      the new row being on screen, median of five. Neither includes typing,
 *                      which is the user's time and not the app's latency.
 *   RNF-03 view/day    Click to the settled frame, plus a flicker probe. "Blank" is a frame
 *                      where the list area held nothing at all — not rows, not the skeleton,
 *                      not the empty message. "Stale" is a frame after the click where a row
 *                      belonging to the day being left was still on screen, which is the
 *                      flicker a user actually notices.
 *   RNF-05 idle RAM    Working set summed over the whole process tree, because Electron is
 *                      several processes and the main one alone is not the app's memory.
 *
 * What it does NOT cover, on purpose:
 *
 *   - The submit accelerator is a NATIVE menu item (`CmdOrCtrl+Return`), handled in the browser
 *     process before the renderer ever sees the key, so CDP cannot press it. The script
 *     dispatches the form's own `submit` event, which is the handler that menu item ends up
 *     invoking. The OS-to-menu hop is excluded.
 *   - Keyboard events are synthetic (`isTrusted: false`). React does not care; a real keystroke
 *     would also carry OS key-delivery latency, a few milliseconds this therefore under-reports.
 *   - Installer size (RNF-04) needs `electron-builder`, which may have no network here. It is
 *     reported separately and says "not measured" rather than guessing.
 *
 * The exit code is the run's, not the grades'. A laptop that is busy fails these numbers for
 * reasons that have nothing to do with the app, and a check that goes red for that teaches
 * people to ignore red — the same reason the flows run over CDP instead of Playwright. Only a
 * measurement that could not run at all fails.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createChecks, daysFromToday, launchApp, repoRoot, today } from './lib/cdp.mjs'

/** The RNF targets, copied from PLAN_IMPLEMENTACION.md §3, Fase 7. */
const TARGETS = {
  coldStartMs: 3000,
  createMs: 120,
  viewChangeMs: 100,
  idleRamMb: 250,
  installerMb: 100
}

/** Cold launches behind the RNF-01 figure. One is a sample; three is a measurement. */
const STARTUP_RUNS = 3

/** Commits behind the RNF-02 commit figure, because the first one pays for a cold cache. */
const COMMIT_RUNS = 5

/** Tasks seeded into today so the navigation measures real rows instead of an empty state. */
const SEEDED_TASKS = 25

/** DevTools ports. Fixed and distinct: nothing else in the suite runs concurrently. */
const PORT = 9457

/**
 * Middle value, which is the only honest summary of a handful of noisy samples: the mean
 * inherits every outlier and the minimum describes a day that will not repeat.
 *
 * @param {number[]} values Samples.
 * @returns {number} The middle one, sorted.
 */
function median(values) {
  const sorted = [...values].sort((a, b) => a - b)

  return sorted[Math.floor(sorted.length / 2)]
}

/**
 * Reads the whole process tree of a running Electron app and returns two memory figures.
 *
 * Electron runs a main process, a renderer, a GPU process and utility processes. Two traps make
 * the obvious version of this measurement wrong, and both were hit before this one was right:
 *
 * 1. Summing *working set* across processes counts shared pages once per process. Chromium
 *    shares its DLLs, its font data and large parts of its allocator arenas, so the sum runs
 *    to roughly three times the memory the app actually costs the machine. That is how a
 *    123 MB app once reported 367 MB and looked like it was blowing a 250 MB budget by 47 %.
 * 2. `ConvertTo-Csv` quotes every value, so `Number('"92"')` is `NaN` and a Map keyed by `NaN`
 *    matches nothing — which is how the same measurement reported a confident 0.0 MB.
 *
 * So this returns private bytes as the number that answers RNF-05 and keeps the working set
 * beside it, labelled, because knowing the gap between the two is the whole lesson. Windows
 * calls the private figure `WorkingSetPrivate`; Linux calls the equivalent PSS and it lives in
 * `/proc/<pid>/smaps_rollup`.
 *
 * @param {number} rootPid Pid of the spawned Electron process.
 * @returns {{ privateMb: number, workingSetMb: number, processes: number }} Over the whole tree.
 */
function treeMemoryMb(rootPid) {
  const rows =
    process.platform === 'win32'
      ? execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,WorkingSetSize | ConvertTo-Csv -NoTypeInformation'
          ],
          { encoding: 'utf8' }
        )
          .replace(/"/g, '')
          .trim()
          .split(/\r?\n/)
          .slice(1)
          .map((line) => line.split(','))
          .map(([pid, ppid, bytes]) => ({
            pid: Number(pid),
            ppid: Number(ppid),
            workingSetMb: Number(bytes) / 1048576,
            privateMb: null
          }))
      : execFileSync('ps', ['-eo', 'pid=,ppid=,rss='], { encoding: 'utf8' })
          .trim()
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/))
          .map(([pid, ppid, rss]) => ({
            pid: Number(pid),
            ppid: Number(ppid),
            workingSetMb: Number(rss) / 1024,
            privateMb: null
          }))

  if (process.platform === 'win32') {
    const privateByPid = new Map(
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ' +
            'Select-Object IDProcess,WorkingSetPrivate | ConvertTo-Csv -NoTypeInformation'
        ],
        { encoding: 'utf8' }
      )
        .replace(/"/g, '')
        .trim()
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.split(','))
        .map(([pid, bytes]) => [Number(pid), Number(bytes) / 1048576])
    )

    for (const row of rows) {
      row.privateMb = privateByPid.get(row.pid) ?? 0
    }
  } else {
    for (const row of rows) {
      try {
        // PSS divides each shared page among the processes mapping it, which is exactly the
        // correction the working-set sum is missing.
        const rollup = readFileSync(`/proc/${row.pid}/smaps_rollup`, 'utf8')
        row.privateMb = Number(/^Pss:\s+(\d+) kB$/m.exec(rollup)?.[1] ?? 0) / 1024
      } catch {
        row.privateMb = 0
      }
    }
  }

  const byPid = new Map(rows.map((row) => [row.pid, row]))
  const childrenByParent = new Map()

  for (const row of rows) {
    childrenByParent.set(row.ppid, [...(childrenByParent.get(row.ppid) ?? []), row.pid])
  }

  let workingSetMb = 0
  let privateMb = 0
  let processes = 0
  const seen = new Set()
  const pending = [rootPid]

  while (pending.length > 0) {
    const pid = pending.pop()

    // Electron re-parents some of its own processes, so a cycle would otherwise spin forever.
    if (seen.has(pid)) {
      continue
    }

    seen.add(pid)
    const row = byPid.get(pid)

    if (row) {
      workingSetMb += row.workingSetMb
      privateMb += row.privateMb
      processes++
    }

    pending.push(...(childrenByParent.get(pid) ?? []))
  }

  // A tree with only the root in it is a broken reading, not a small app. Saying so beats
  // reporting 0.0 MB and calling it a pass.
  if (processes === 0) {
    throw new Error(
      `no se encontró ningún proceso bajo el pid ${rootPid}: la lectura de memoria no es válida`
    )
  }

  return { privateMb, workingSetMb, processes }
}

/**
 * Builds the real installer and measures it.
 *
 * `--dir` was the first attempt and it answered the wrong question: RNF-04 asks for the
 * *compressed* installer, and an unpacked tree is an upper bound that proves nothing about it.
 * The NSIS target is the artifact a user downloads, so that is what gets built and weighed. It
 * takes a few minutes and needs the network to fetch NSIS; a machine without either gets "not
 * measured" rather than a guess.
 *
 * @returns {{ mb: number | null, note: string }} Size and how it was obtained.
 */
function measureInstaller() {
  const outDir = join(repoRoot, 'dist')

  try {
    execFileSync(
      process.execPath,
      [join(repoRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'), '--win', 'nsis'],
      { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 1_500_000 }
    )
  } catch (cause) {
    const stderr = String(cause.stderr ?? '')
      .trim()
      .split(/\r?\n/)
      .slice(-3)
      .join(' ')
      .trim()

    return {
      mb: null,
      note: `electron-builder falló: ${String(cause.message).split('\n')[0]}${stderr ? ` — ${stderr}` : ''}`
    }
  }

  try {
    const files = readdirSync(outDir, { withFileTypes: true }).map((entry) =>
      join(outDir, entry.name)
    )

    const setup = files
      .filter((file) => file.endsWith('-setup.exe'))
      .map((file) => ({ file, mb: statSync(file).size / 1048576 }))
      .sort((a, b) => b.mb - a.mb)[0]

    if (!setup) {
      return { mb: null, note: `no se encontró ningún instalador en ${outDir}` }
    }

    const unpacked = files.find((dir) => dir.includes('win-unpacked'))
    const asar = unpacked ? statSync(join(unpacked, 'resources', 'app.asar')).size / 1048576 : null

    return {
      mb: setup.mb,
      note: `instalador NSIS comprimido${asar === null ? '' : `; app.asar sin comprimir ${asar.toFixed(1)} MB`}`
    }
  } catch (cause) {
    return { mb: null, note: `no se pudo medir ${outDir}: ${String(cause.message).split('\n')[0]}` }
  }
}

async function main() {
  const checks = createChecks()

  /**
   * Records one RNF against its target.
   *
   * @param {string} rnf The requirement id.
   * @param {string} name What was measured.
   * @param {number | null} measured The observed value, or null when it could not be observed.
   * @param {number} target The plan's objective.
   * @param {string} unit Unit for both.
   * @param {string} [detail] Anything that qualifies the number.
   */
  const record = (rnf, name, measured, target, unit, detail = '') => {
    const ok = measured !== null && measured <= target
    const shown = measured === null ? 'sin medir' : `${measured.toFixed(1)} ${unit}`

    checks.check(
      `${rnf} ${name}`,
      ok,
      `${shown} (objetivo ≤ ${target} ${unit})${detail ? ` — ${detail}` : ''}`
    )
  }

  console.log('Fase 7 · medición de los RNF sobre la app real\n')

  // RNF-01, first: it needs a launch per sample, and the app this script keeps for the rest of
  // the measurements must be the one that starts last.
  const startups = []

  for (let run = 0; run < STARTUP_RUNS; run++) {
    const launched = await launchApp(PORT + run)

    startups.push(Date.now() - launched.startedAt)
    await launched.close()
  }

  console.log(
    `Arranques en frío (${STARTUP_RUNS}): ${startups.map((ms) => ms.toFixed(0)).join(' · ')} ms\n`
  )
  record(
    'RNF-01',
    'arranque en frío hasta ventana visible',
    median(startups),
    TARGETS.coldStartMs,
    'ms',
    `mediana de ${STARTUP_RUNS}; cota superior que incluye arranque de proceso y montaje`
  )

  const app = await launchApp(PORT + 100)

  try {
    // Give the renderer time to be quiet before reading its memory, or the figure is a
    // mid-boot reading wearing a resting one's name.
    await new Promise((done) => setTimeout(done, 2000))

    const memory = treeMemoryMb(app.pid)
    record(
      'RNF-05',
      'RAM en reposo',
      memory.privateMb,
      TARGETS.idleRamMb,
      'MB',
      `memoria privada de ${memory.processes} procesos; la suma de working set da ${memory.workingSetMb.toFixed(1)} MB y cuenta las páginas compartidas ${memory.processes} veces`
    )

    // Seed today so the navigation renders real rows. An empty day would make the number fast
    // for the wrong reason, which is the classic way a latency measurement lies.
    await app.eval(
      `(async () => {
         for (let i = 0; i < ${SEEDED_TASKS}; i++) {
           await window.taskDiary.tasks.create({ title: 'Tarea de medición ' + i, taskDate: '${today()}' })
         }
         return true
       })()`
    )
    await app.waitFor(
      `document.querySelectorAll('[data-testid="task-row"]').length >= ${SEEDED_TASKS}`,
      30_000
    )

    // RNF-02, first half: the shortcut opening the form.
    const formOpenMs = await app.eval(
      `new Promise(resolve => {
         const t0 = performance.now()
         window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }))
         const tick = () => {
           if (document.querySelector('[data-testid="task-title-input"]')) return resolve(performance.now() - t0)
           requestAnimationFrame(tick)
         }
         requestAnimationFrame(tick)
       })`
    )
    record(
      'RNF-02',
      'Ctrl+N hasta el campo de título en pantalla',
      formOpenMs,
      TARGETS.createMs,
      'ms'
    )

    // RNF-02, second half: committing to the row being on screen. The value goes in through the
    // native setter because React's controlled input ignores a plain `.value =`.
    const commits = []

    for (let run = 0; run < COMMIT_RUNS; run++) {
      const ms = await app.eval(
        `(async () => {
           window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true, bubbles: true, cancelable: true }))
           await new Promise(resolve => {
             const tick = () => (document.querySelector('[data-testid="task-title-input"]') ? resolve(true) : requestAnimationFrame(tick))
             requestAnimationFrame(tick)
           })
           const input = document.querySelector('[data-testid="task-title-input"]')
           const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
           setter.call(input, 'Tarea creada con atajo ${run}')
           input.dispatchEvent(new Event('input', { bubbles: true }))
           await new Promise(resolve => requestAnimationFrame(resolve))
           const t0 = performance.now()
           input.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
           return await new Promise(resolve => {
             const wait = () => {
               const created = [...document.querySelectorAll('[data-testid="task-row-title"]')]
                 .some(node => node.textContent.includes('Tarea creada con atajo ${run}'))
               if (created) return resolve(performance.now() - t0)
               requestAnimationFrame(wait)
             }
             wait()
           })
         })()`
      )

      commits.push(ms)
    }

    record(
      'RNF-02',
      'enviar hasta la fila nueva en pantalla',
      median(commits),
      TARGETS.createMs,
      'ms',
      `mediana de ${COMMIT_RUNS} (${commits.map((ms) => ms.toFixed(0)).join(' · ')}); acelerador de menú nativo, CDP no lo puede pulsar`
    )

    // RNF-03, day change. Every row on screen is tagged before the click so the probe can tell
    // "the previous day is still showing" apart from "the new day is up".
    //
    // What counts is the longest *run* of consecutive samples still carrying a tagged row, not
    // how many samples carried one in total. `requestAnimationFrame` fires before the browser
    // paints, so the first sample after a click always sees the DOM as it was before the commit
    // — the state before the paint, not a frame the user ever looked at. Counting samples
    // invents a flicker that never reached a screen, which is exactly what it did: the first
    // version of this probe reported one stale frame, and three further runs found none at all.
    // Two consecutive samples mean the old content survived a frame boundary, which is a
    // flicker. One does not.
    const dayChange = await app.eval(
      `new Promise(resolve => {
         const t0 = performance.now()
         const target = '${daysFromToday(1)}'
         let staleRun = 0
         let maxStaleRun = 0
         let blankFrames = 0
         for (const row of document.querySelectorAll('[data-testid="task-row"]')) row.dataset.perfMark = '1'
         const probe = () => {
           const stale = Boolean(document.querySelector('[data-perf-mark]'))
           staleRun = stale ? staleRun + 1 : 0
           maxStaleRun = Math.max(maxStaleRun, staleRun)
           const area = document.querySelector('[data-testid="task-list"]')
           if (area && area.childElementCount === 1 && !area.textContent.includes('Todavía no hay tareas')) blankFrames++
           if (location.hash.includes(target)) {
             // One extra frame, so the number lands on the settled paint and not on the frame
             // in which the route merely changed.
             return requestAnimationFrame(() => resolve({ ms: performance.now() - t0, maxStaleRun, blankFrames }))
           }
           if (performance.now() - t0 > 5000) return resolve({ ms: performance.now() - t0, maxStaleRun, blankFrames, timedOut: true })
           requestAnimationFrame(probe)
         }
         document.querySelector('[aria-label="Periodo siguiente"]').click()
         requestAnimationFrame(probe)
       })`
    )
    record(
      'RNF-03',
      'cambio de día hasta el frame asentado',
      dayChange.ms,
      TARGETS.viewChangeMs,
      'ms'
    )
    checks.check(
      'RNF-03 sin parpadeo al cambiar de día',
      dayChange.maxStaleRun === 0 && dayChange.blankFrames === 0,
      `${dayChange.maxStaleRun} frames seguidos con filas del día anterior, ${dayChange.blankFrames} frames sin lista`
    )

    // RNF-03, second axis: the view switcher.
    //
    // The button is re-queried on every frame instead of being captured once. Changing the view
    // changes which buttons the title bar renders to the left of the switcher, React reconciles
    // that list by position, and the switcher is therefore unmounted and remounted: a reference
    // captured before the click points at a detached node whose `aria-pressed` never changes,
    // which reads as a transition that never finishes. The app switches views correctly and in
    // a couple of frames — this probe was wrong, not the app.
    const viewChange = await app.eval(
      `new Promise(resolve => {
         const t0 = performance.now()
         const isWeekUp = () => [...document.querySelectorAll('[data-testid="view-switcher"] button')]
           .some(button => /semana/i.test(button.textContent) && button.getAttribute('aria-pressed') === 'true')
         const button = [...document.querySelectorAll('[data-testid="view-switcher"] button')]
           .find(candidate => /semana/i.test(candidate.textContent))
         if (!button) return resolve({ ms: null })
         const probe = () => {
           if (isWeekUp()) {
             return requestAnimationFrame(() => resolve({ ms: performance.now() - t0 }))
           }
           if (performance.now() - t0 > 5000) return resolve({ ms: performance.now() - t0, timedOut: true })
           requestAnimationFrame(probe)
         }
         button.click()
         requestAnimationFrame(probe)
       })`
    )
    record(
      'RNF-03',
      'cambio de vista hasta el frame asentado',
      viewChange.ms,
      TARGETS.viewChangeMs,
      'ms'
    )
  } finally {
    await app.close()
  }

  const installer = measureInstaller()
  record('RNF-04', 'tamaño del instalador', installer.mb, TARGETS.installerMb, 'MB', installer.note)

  console.log(
    `\nEntorno: ${process.platform} ${process.arch} · node ${process.version} · perfil temporal desechable`
  )
  console.log(
    'Estos números no son un gate: un portátil saturado los falla por motivos ajenos a la app.'
  )

  const failed = checks.report()

  if (failed > 0) {
    console.log(
      '\nUn requisito por encima del objetivo no significa "optimizar todavía": significa que la'
    )
    console.log('medición tiene que decir cuál, antes de escribir una línea de rendimiento.')
  }
}

main().catch((error) => {
  console.error(`\nLa medición no pudo ejecutarse: ${error.message}`)
  process.exit(1)
})
