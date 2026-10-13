/**
 * End-to-end flows, over the real process.
 *
 * The unit tests and the phase smokes cover arithmetic and channels. What only a flow run can
 * see is the seams between layers: the preload bridge, the route, the form, and the SQLite file
 * on disk. Fase 3 shipped a form that parsed its tags and then saved the raw text, with every
 * unit test green — a defect that only exists *between* the layers, and the reason this file
 * exists.
 *
 * Scenarios go through the UI wherever a UI exists. Creating a task calls the dialog and the
 * submit button, not `window.taskDiary.tasks.create`, because a shortcut here would skip the
 * exact seam that broke in Fase 3.
 *
 * Usage: node scripts/e2e-flows.mjs
 */
import { rmSync } from 'node:fs'
import { createChecks, daysFromToday, launchApp, today } from './lib/cdp.mjs'

const PORT = 9350

const { check, report } = createChecks()

/**
 * Opens the form, types a title and submits.
 *
 * Goes through the dialog and the submit button rather than calling the IPC channel: the point
 * of a flow run is the path a user takes, and a shortcut here would skip the exact seam that
 * broke in Fase 3 — a form that parsed its tags and then saved something else.
 *
 * Every step waits for the previous one. Clicking "Nueva tarea" only sets state, so reading
 * the input in the same tick would find nothing and report a failure that is really a race.
 *
 * The needle is separate from the title on purpose. The row's `textContent` concatenates the
 * title and its tag chips with no separator — "Revisar el contrato#legal" — so searching for
 * what was typed finds nothing, and the failure looks like the task never saved rather than
 * like a wrong search string.
 *
 * @param {string} title Title to type.
 * @param {string} [needle] What to look for once saved; defaults to the title.
 * @returns {string} An expression that resolves when the row is on screen.
 */
const CREATE_TASK = (title, needle = title) => `(async () => {
  const waitFor = async (find, what) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const node = find()
      if (node) return node
      await new Promise((done) => requestAnimationFrame(done))
    }
    throw new Error('no apareció: ' + what)
  }
  const clickByText = (text) => {
    const button = [...document.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === text)
    if (!button) throw new Error('no se encontró el botón ' + text)
    button.click()
  }

  clickByText('Nueva tarea')
  const input = await waitFor(
    () => document.querySelector('[data-testid="task-title-input"]'),
    'el formulario'
  )
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(input, ${JSON.stringify(title)})
  input.dispatchEvent(new Event('input', { bubbles: true }))
  clickByText('Guardar')
  await waitFor(
    () => [...document.querySelectorAll('[data-testid="task-row"]')]
      .find((r) => r.textContent.includes(${JSON.stringify(needle)})),
    'la tarea recién guardada'
  )
  return true
})()`

/** Titles of the rows currently on screen. */
const VISIBLE_TITLES = `[...document.querySelectorAll('[data-testid="task-row"]')]
  .map((row) => row.textContent.trim())`

/** Status of the first row whose text contains `needle`. */
const STATUS_OF = (needle) => `(() => {
  const row = [...document.querySelectorAll('[data-testid="task-row"]')]
    .find((r) => r.textContent.includes(${JSON.stringify(needle)}))
  return row ? row.dataset.status : null
})()`

/** Clicks the button whose accessible name matches inside the row containing `needle`. */
const CLICK_ROW_BUTTON = (needle, pattern) => `(() => {
  const row = [...document.querySelectorAll('[data-testid="task-row"]')]
    .find((r) => r.textContent.includes(${JSON.stringify(needle)}))
  if (!row) return false
  const button = [...row.querySelectorAll('button')]
    .find((b) => new RegExp(${JSON.stringify(pattern)}).test(b.getAttribute('aria-label') || ''))
  if (!button) return false
  button.click()
  return true
})()`

const app = await launchApp(PORT)

// Every scenario below is sequential and builds on the last: the task created here is the one
// the navigation, the search and the persistence check go looking for.
try {
  // --- 1. Arranque ------------------------------------------------------------------
  const url = await app.expectEval('window.location.hash', 'la app debe abrir en una ruta')

  check('la app abre en el día de hoy', url.includes(`/day/${today()}`), String(url))
  check(
    'y la barra de título está montada',
    await app.expectEval(
      'Boolean(document.querySelector("[data-testid=title-bar]"))',
      'falta la barra'
    )
  )
  check(
    'con la vista Día activa',
    (await app.eval(
      `[...document.querySelectorAll('[data-testid="view-switcher"] button')]
        .find((b) => b.getAttribute('aria-pressed') === 'true').textContent.trim()`
    )) === 'Día'
  )

  // --- 2. Crear por el formulario ----------------------------------------------------
  await app.eval(CREATE_TASK('Revisar el contrato #legal', 'Revisar el contrato'))

  const created = await app.waitFor(
    `${VISIBLE_TITLES}.some((t) => t.includes('Revisar el contrato')) ? ${VISIBLE_TITLES} : null`
  )

  check(
    'una tarea creada por el formulario aparece en el día',
    Array.isArray(created),
    JSON.stringify(created)
  )
  // The title and the tag chips live in the same row and `textContent` runs them together, so
  // the row text is not where Fase 3's bug would show. The title element is: a form that
  // parsed `#legal` and then saved it as text leaves the `#` sitting there.
  const title = await app.eval(
    `document.querySelector('[data-testid="task-row-title"]').textContent.trim()`
  )

  check('el título no conserva el #literal', title === 'Revisar el contrato', String(title))
  check(
    'sino que la etiqueta se parseó a una etiqueta',
    (await app.eval(`document.querySelector('[data-testid="task-tag"]').textContent.trim()`)) ===
      '#legal'
  )

  // --- 3. Estados ---------------------------------------------------------------------
  const started = await app.eval(CLICK_ROW_BUTTON('Revisar el contrato', 'como en curso'))

  check('el botón de empezar existe en la fila', started === true)

  const inProgress = await app.waitFor(
    `${STATUS_OF('Revisar el contrato')} === 'in_progress' ? 'in_progress' : null`
  )

  check('la tarea pasa a «en curso»', inProgress === 'in_progress', String(inProgress))

  await app.eval(CLICK_ROW_BUTTON('Revisar el contrato', '^Completar'))

  const done = await app.waitFor(`${STATUS_OF('Revisar el contrato')} === 'done' ? 'done' : null`)

  check('y luego a «completada»', done === 'done', String(done))
  check(
    'que es terminal: no ofrece volver a pendiente',
    await app.eval(
      `(() => {
         const row = [...document.querySelectorAll('[data-testid="task-row"]')]
           .find((r) => r.textContent.includes('Revisar el contrato'))
         return row ? ![...row.querySelectorAll('button')].some((b) => (b.getAttribute('aria-label') || '').includes('pendiente')) : false
       })()`
    ),
    'ofrece una transición desde done'
  )

  // --- 4. Navegar --------------------------------------------------------------------
  const yesterday = daysFromToday(-1)

  await app.eval(
    `[...document.querySelectorAll('header button')].find((b) => b.textContent.trim() === 'Ayer').click(), true`
  )

  await app.waitFor(`window.location.hash.endsWith('/${yesterday}') ? true : null`)

  check(
    'navegar a ayer mueve la URL',
    (await app.eval('window.location.hash')).includes(`/day/${yesterday}`)
  )
  check(
    'y la lista la sigue, sin la tarea de hoy',
    (await app.eval(VISIBLE_TITLES)).length === 0,
    JSON.stringify(await app.eval(VISIBLE_TITLES))
  )

  await app.eval(
    `[...document.querySelectorAll('header button')].find((b) => b.textContent.trim() === 'Hoy').click(), true`
  )
  await app.waitFor(`window.location.hash.endsWith('/${today()}') ? true : null`)

  check(
    'y volver a hoy la recupera',
    (await app.eval(VISIBLE_TITLES)).some((title) => title.includes('Revisar el contrato'))
  )

  // --- 5. Búsqueda -------------------------------------------------------------------
  const setSearch = (value) => `(async () => {
    const input = document.querySelector('[data-testid="search-input"]')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`

  await app.eval(setSearch('contrato'))
  await app.waitFor(
    `${VISIBLE_TITLES}.length === 1 && ${VISIBLE_TITLES}[0].includes('Revisar') ? true : null`
  )

  check('la búsqueda encuentra la tarea', (await app.eval(VISIBLE_TITLES)).length === 1)

  await app.eval(setSearch('palabra que no existe'))
  await app.waitFor(`${VISIBLE_TITLES}.length === 0 ? true : null`)

  check('y una palabra ausente no devuelve nada', (await app.eval(VISIBLE_TITLES)).length === 0)

  await app.eval(`document.querySelector('[data-testid="clear-filters"]').click(), true`)
  await app.waitFor(`${VISIBLE_TITLES}.length === 1 ? true : null`)

  check('limpiar los filtros la devuelve', (await app.eval(VISIBLE_TITLES)).length === 1)

  // --- 6. Menú de datos --------------------------------------------------------------
  await app.eval(
    `document.querySelector('[data-testid="data-menu-trigger"]')
       .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })), true`
  )

  const menu = await app.waitFor(
    `(() => {
       const items = [...document.querySelectorAll('[data-slot="dropdown-menu-item"]')]
       return items.length === 11 ? items.map((i) => i.textContent.trim()) : null
     })()`
  )

  // The labels are asserted, not the count alone: a count of nine is also true if the same
  // format appears three times and another is missing, which is the failure that would hurt.
  const EXPECTED_MENU = [
    'Como JSON',
    'Como Markdown',
    'Como CSV',
    'Como Excel (.xlsx)',
    'Como Excel 97-2003 (.xls)',
    'Como OpenDocument (.ods)',
    'Desde JSON',
    'Desde CSV',
    'Desde Excel (.xlsx)',
    'Desde Excel 97-2003 (.xls)',
    'Desde OpenDocument (.ods)'
  ]

  check(
    'el menú de datos ofrece exportar en seis formatos e importar en cinco',
    Array.isArray(menu) && menu.length === 11,
    JSON.stringify(menu)
  )

  check(
    'cada formato aparece con su nombre real, y Markdown solo se exporta',
    Array.isArray(menu) &&
      menu.filter((item) => item.startsWith('Como ')).join('|') ===
        EXPECTED_MENU.slice(0, 6).join('|') &&
      menu.filter((item) => item.startsWith('Desde ')).join('|') ===
        EXPECTED_MENU.slice(6).join('|'),
    JSON.stringify(menu)
  )

  await app.eval('document.body.click(), true')

  // --- 7. Cambiar de vista -----------------------------------------------------------
  await app.eval(
    `[...document.querySelectorAll('[data-testid="view-switcher"] button')]
       .find((b) => b.textContent.trim() === 'Semana').click(), true`
  )

  const week = await app.waitFor(
    `document.querySelectorAll('[data-testid="week-column"]').length === 7 ? true : null`
  )

  check('la vista Semana dibuja sus siete columnas', week === true)
  check(
    'con el balance de cada día',
    (await app.eval(`document.querySelectorAll('[data-testid="week-balance"]').length`)) === 7
  )
  check(
    'y la barra no desborda al cambiar de vista',
    await app.eval(
      `(() => {
         const h = document.querySelector('[data-testid="title-bar"]')
         return h.scrollWidth - h.clientWidth <= 0
       })()`
    )
  )
} catch (error) {
  // Scenarios that throw still have to release the profile, or the next run inherits it.
  await app.close()
  throw error
}

// --- 8. Persistencia -------------------------------------------------------------------
// Deliberately after every other scenario, and in its own block rather than a `finally`: a
// `finally` runs on the way out even when an assertion throws, which would have reopened a
// half-written diary and reported it as a persistence failure.
const profile = app.userDataDir
await app.close({ keepProfile: true })

const reopened = await launchApp(PORT + 1, profile)

try {
  const survived = await reopened.waitFor(
    `${VISIBLE_TITLES}.some((t) => t.includes('Revisar el contrato')) ? ${VISIBLE_TITLES} : null`
  )

  check(
    'los datos sobreviven a cerrar y reabrir la app',
    Array.isArray(survived),
    JSON.stringify(survived)
  )
  check('con su estado intacto', (await reopened.eval(STATUS_OF('Revisar el contrato'))) === 'done')
} finally {
  await reopened.close()

  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    // The OS may still hold it; a leftover temp profile is not a failed test.
  }
}

process.exit(report() > 0 ? 1 : 0)
