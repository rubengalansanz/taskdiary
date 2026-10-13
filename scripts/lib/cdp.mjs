/**
 * Shared CDP harness: launch the real app and evaluate expressions in its renderer.
 *
 * Extracted from the phase smokes, which each carried their own copy. Six copies of the same
 * thirty lines is six places to fix a bug in the harness instead of one.
 *
 * Why CDP and not Playwright: Playwright's Electron launcher waits for the Node inspector
 * announcement (`Debugger listening on ws://…`) that Electron 44 does not emit to it on this
 * stack, so `_electron.launch()` fails with "Process failed to launch!" even though the binary
 * starts and prints that line when run directly. A suite that cannot launch is worse than one
 * that can — it teaches people to ignore red — so the flows are driven over the DevTools
 * protocol instead, against the same real process, the same preload bridge and the same
 * SQLite file a user would get.
 *
 * @typedef {{ eval: (expression: string) => Promise<unknown>,
 *             expectEval: (expression: string, message: string) => Promise<unknown>,
 *             waitFor: (expression: string, timeoutMs?: number) => Promise<unknown>,
 *             logs: () => string,
 *             userDataDir: string,
 *             close: (options?: { keepProfile?: boolean }) => Promise<void> }} RunningApp
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Repository root, resolved from this file rather than from the cwd. */
export const repoRoot = resolve(import.meta.dirname, '..', '..')

/**
 * Waits for the DevTools endpoint to answer.
 *
 * @param {number} port Port the app was told to listen on.
 * @param {number} [timeoutMs] How long to keep trying.
 * @returns {Promise<string>} WebSocket URL of the page target.
 */
async function waitForCdp(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)

      if (page) {
        return page.webSocketDebuggerUrl
      }
    } catch {
      // Not listening yet.
    }

    await new Promise((done) => setTimeout(done, 250))
  }

  throw new Error('el endpoint de DevTools no llegó a levantarse')
}

/**
 * Evaluates one expression over the DevTools protocol.
 *
 * Every expression is wrapped so a throw inside the renderer becomes a rejected promise
 * carrying the renderer's own message, rather than a protocol error that says nothing about
 * what actually failed.
 *
 * @param {string} socketUrl The page target.
 * @param {string} expression JavaScript, possibly a promise.
 * @returns {Promise<unknown>} Whatever the expression resolved to.
 */
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
            expression:
              '(() => { try { return Promise.resolve(' +
              expression +
              ').then(v => ({ok:true, v}), e => ({ok:false, e: String(e && e.message || e)})); }' +
              ' catch (e) { return Promise.resolve({ok:false, e: String(e && e.message || e)}); } })()',
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
          rejectPromise(new Error(`el renderer lanzó: ${wrapper?.e}`))
        } else {
          resolvePromise(wrapper.v)
        }
      }
    })

    socket.addEventListener('error', rejectPromise)
  })
}

/**
 * Launches the app against a throwaway profile.
 *
 * @param {number} port DevTools port. Must be unique per concurrent run.
 * @param {string} [reuseUserDataDir] Reuse an existing profile instead of creating one. The
 *   persistence scenario needs it: reopening the same `--user-data-dir` is what makes it the
 *   same file rather than a second empty diary.
 * @returns {Promise<RunningApp>} A handle on the running app.
 */
export async function launchApp(port, reuseUserDataDir) {
  const userDataDir = reuseUserDataDir ?? mkdtempSync(join(tmpdir(), 'taskdiary-e2e-'))
  const electron = join(
    repoRoot,
    'node_modules',
    'electron',
    'dist',
    process.platform === 'win32' ? 'electron.exe' : 'electron'
  )

  const child = spawn(
    electron,
    ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
    {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'production' }
    }
  )

  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))

  const socketUrl = await waitForCdp(port)

  // The renderer mounts after the theme bridge resolves; without this the first assertion can
  // run against a document that does not exist yet.
  await evaluate(
    socketUrl,
    `new Promise(resolve => {
       const tick = () => {
         if (document.querySelector('[data-testid="title-bar"]')) resolve(true)
         else requestAnimationFrame(tick)
       }
       tick()
     })`
  )

  return {
    eval: (expression) => evaluate(socketUrl, expression),
    expectEval: async (expression, message) => {
      const value = await evaluate(socketUrl, expression)

      if (!value) {
        throw new Error(`${message} — valor: ${JSON.stringify(value)}`)
      }

      return value
    },
    waitFor: async (expression, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs
      let last

      while (Date.now() < deadline) {
        last = await evaluate(socketUrl, expression)

        if (last) {
          return last
        }

        await new Promise((done) => setTimeout(done, 100))
      }

      return last
    },
    logs: () => output,
    userDataDir,
    close: async (options = {}) => {
      const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
      child.kill()
      // The profile stays locked until the process is really gone, and rmSync throws EPERM
      // rather than waiting for it.
      await Promise.race([exited, new Promise((done) => setTimeout(done, 4000))])

      // The caller may reopen this profile — the persistence scenario does — and deleting it
      // here would leave the second launch reading a different, empty diary.
      if (reuseUserDataDir !== undefined || options.keepProfile === true) {
        return
      }

      try {
        rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      } catch {
        // A profile the OS still holds is not a failed test.
      }
    }
  }
}

/** The local calendar day, as the app names it. */
export function today() {
  const now = new Date()

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate()
  ).padStart(2, '0')}`
}

/** A day offset from today; negative for the past. */
export function daysFromToday(delta) {
  const date = new Date()
  date.setDate(date.getDate() + delta)

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

/**
 * A collector shared by every scenario in a run.
 *
 * @returns {{ check: (name: string, ok: unknown, detail?: string) => void,
 *             report: () => number }} The collector and a summary that returns the failure count.
 */
export function createChecks() {
  const results = []

  return {
    check: (name, ok, detail = '') => {
      results.push({ name, ok: Boolean(ok), detail })
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
    },
    report: () => {
      const failed = results.filter((result) => !result.ok)

      console.log(`\n${results.length - failed.length}/${results.length} comprobaciones`)

      if (failed.length > 0) {
        console.log('\nFallan:')
        for (const failure of failed) {
          console.log(`  - ${failure.name}${failure.detail ? ` — ${failure.detail}` : ''}`)
        }
      }

      return failed.length
    }
  }
}
