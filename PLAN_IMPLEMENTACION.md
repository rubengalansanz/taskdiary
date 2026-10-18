# Plan de implementación — TaskDiary

> **Derivado de:** `docs/plan-tasks-app.md` (v2.0 · 2026-10-08) — copia versionada en este repo del plan maestro
> **Alcance:** fases 0–10 · **≈ 12 días útiles** (~6 h/día, un desarrollador)
> **Documento:** `PLAN_IMPLEMENTACION.md` · ejecutable, con criterio de aceptación por fase

---

## 0. Contexto

Aplicación de escritorio **offline-first** para registrar y consultar las tareas diarias, con foco en ver de un vistazo qué se hizo hoy y poder retroceder en el tiempo.

**Principio rector:** abrir la app y, en menos de 3 segundos, saber qué se hizo hoy, qué queda pendiente y cómo va la semana.

**Usuario único:** el propio desarrollador. Sin autenticación, roles, multi-tenancy ni sincronización.

**Stack (verificado contra npm el 2026-10-09):** Electron 44 + React 19 + TypeScript 5.9 + Vite 7 · Tailwind 4 + shadcn/ui · Zustand 5 · SQLite (`better-sqlite3` 13) · Zod 4 · date-fns 4 · Fuse.js 7 · Vitest 5 + Playwright 1.64. Versiones exactas en §8.

### 0.1 Pendientes de resolver antes de la Fase 0

| # | Pendiente | Impacto | Estado |
| --- | --- | --- | --- |
| 1 | El plan maestro vivía fuera del repo (`Proyectos provisional/Planes/`). Este repo tenía **0 commits**. | El documento que gobierna el trabajo no está versionado | **Resuelto** — `docs/plan-tasks-app.md` versionado en el commit inicial; ambos planes quedan bajo control de versiones |
| 2 | El plan declara el proyecto como `taskdiary/` y `appId com.local.taskdiary`; el repo se llamaba `tasks-app`. | Decidir si Electron se inicializa en la raíz o en un subdirectorio | **Resuelto** — el directorio pasó a `taskdiary/`, Electron se inicializó en la **raíz** y los tres identificadores coinciden ahora: `package.json#name: taskdiary`, `electron-builder.yml#appId: com.local.taskdiary` y `setAppUserModelId('com.local.taskdiary')`. ADR-010 |
| 3 | El stack del plan estaba fijado a versiones de 2024 (Electron 32, Vite 5, React 18, Tailwind 3, Zustand 4) sin verificar compatibilidad. | Arrancar hoy sobre versiones caducas arrastra deuda y bloquea el lint | **Resuelto** — matriz verificada en §8, con dos conflictos de peer resueltos explícitamente |
| 4 | `install-app-deps` dejaría `better-sqlite3` compilado contra el ABI de Electron, inservible para Vitest en Node (137 vs 149) | Fase 1 y Fase 8 exigen tests de repositorio con BD real | **Resuelto y desmentido** — `better-sqlite3@13` usa N-API: un único binario sirve para ambos runtimes. Verificado ejecutando. §8.3 y ADR-011 |

---

## 1. Resumen de fases

| Fase | Nombre | Tiempo | Entregable | Depende de | Estado |
| :--- | --- | :--- | --- | --- | --- |
| **0** | Cimientos | 1 día | Ventana con estilos, SQLite abierto y `SELECT 1` correcto | — | Completada |
| **1** | Datos | 1 día | Crear y leer tareas desde la ventana | 0 | Completada |
| **2** | Vista Día | 1,5 días | El 80 % del valor del producto ya funciona | 1 | Completada |
| **3** | Etiquetas, búsqueda y filtros | 1 día | Filtrar y buscar en todo el histórico | 2 | Completada |
| **4** | Vistas Semana, Mes y Heatmap | 1,5 días | Visibilidad completa del pasado y del mes | 3 | Completada |
| **5** | Recurrencia, estadísticas e import/export | 1,5 días | **MVP completo** | 4 | Completada |
| **6** | Pulido de UX | 1 día | La app se siente terminada | 5 | Completada y verificada |
| **7** | Rendimiento y seguridad | 1 día | Cumple RNF-01..05 y RNF-11/12 | 6 | Pendiente |
| **8** | Tests y calidad | 1,5 días | Pipeline verde | 7 | Pendiente |
| **9** | Empaquetado y distribución | 1,5 días | Instalador descargable y autoactualizable | 8 | Pendiente |
| **10** | Documentación y lanzamiento | ½ día | Notas de la v1.0 | 9 | Pendiente |

> **Hito del MVP:** fin de la **Fase 5**. Las fases 0–5 entregan el producto utilizable; 6–10 lo endurecen y lo publican.

---

## 2. Reglas innegociables

Aplican a **todas** las fases. Si una fase las contradice, la fase está mal.

1. **El renderer no tiene capacidades.** Sin `nodeIntegration`, sin `fs`, sin `remote`. Todo pasa por `contextBridge`.
2. **`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`** en toda `BrowserWindow`. Sin excepciones ni atajos.
3. **La base de datos vive en el proceso main.** El renderer pide datos por un conjunto cerrado de canales IPC.
4. **El contrato IPC es la única fuente de verdad.** Un solo fichero declara canales y payloads; Zod los valida en el main antes de tocar la BD. Añadir un canal es un cambio explícito y revisable.
5. **El main es el dueño del dominio.** Validación, transiciones de estado y recurrencia viven fuera de React y se testean como funciones puras.
6. **Zustand solo para estado de UI.** Fecha seleccionada, vista activa, filtros, preferencias. Los datos se piden bajo demanda con caché en memoria.
7. **Fechas como cadenas locales `YYYY-MM-DD`, nunca UTC.** Horas como **minutos desde medianoche** (enteros), nunca objetos `Date`. Solo `created_at`, `updated_at` y `completed_at` son ISO-8601 UTC.
8. **Migraciones incrementales numeradas.** `migrations/*.sql`. Nunca se edita una migración ya publicada.
9. **Consultas parametrizadas siempre**, sin concatenar SQL.
10. **`electron/core/` y `electron/db/` no importan nada de Electron.** Solo `node:*` y `better-sqlite3`.
11. **Fuera de alcance en v1** (§2.2 del plan maestro): sincronización cloud, multiusuario, colaboración, móvil, calendarios externos, extensiones, CLI. Toda feature nueva pasa el filtro *«¿sirve al objetivo de §1?»*.

---

## 3. Fases en detalle

### Fase 0 · Cimientos — 1 día

- [x] Versionar `docs/plan-tasks-app.md` y `PLAN_IMPLEMENTACION.md` (§0.1, pendiente 1)
- [x] Inicializar `electron-vite` en la **raíz** + React 19 + TS 5.9, con las versiones de §8.1
- [x] Tailwind 4 + shadcn/ui + tema claro/oscuro con `nativeTheme` y `@custom-variant dark`
- [x] `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, ventana oculta hasta `ready-to-show`
- [x] Verificar `better-sqlite3` abre la BD en `app.getPath('userData')` y `SELECT 1` responde (sin rebuild; §8.3)
- [x] ESLint + Prettier + `tsc --strict` limpios
- [x] Vitest configurado para `electron/core` y `electron/db`
- [x] Git init, commit inicial, `docs/ADR-001-electron.md`

**Entregable:** ventana con estilos, SQLite abierto y `SELECT 1` correcto.

**Criterio de aceptación**
- `npm run dev` abre la ventana con Tailwind aplicado y sin flash blanco.
- `window.taskDiary` definido; `require` inexistente en el renderer.
- `better-sqlite3` abre la BD en `app.getPath('userData')` y `SELECT 1` responde.
- `npm run test` en verde con al menos un test trivial.
- `npm ls typescript vite electron-vite @vitejs/plugin-react` sin `invalid` ni `extraneous`; `npx tsc --version` devuelve `5.9.3`.

---

### Fase 1 · Datos — 1 día

- [x] `Database` con `better-sqlite3` + pragmas (`WAL`, `foreign_keys`) + transacciones
- [x] Migración `0001_init.sql` y runner
- [x] Modelos de dominio + máquina de estados de `TaskStatus`
- [x] Repositorio de tareas con CRUD completo
- [x] Contrato IPC (`src/shared/ipc.ts`) + proxy del preload + esquemas Zod
- [x] Canales `task:list`, `task:create`, `task:update`, `task:delete`
- [x] Manejo de errores: `AppError` con código, mapeado a mensaje legible en el renderer
- [x] Tests unitarios de los repositorios (BD en memoria, Vitest en Node normal — §8.3)

**Entregable:** crear y leer tareas desde la ventana.

> **Desviación documentada (alcance):** el entregable dice «desde la ventana», pero la lista
> de esta fase no incluye ningún componente de UI — `TaskList`, `TaskForm` y `TitleBar` son
> de Fase 2. **Decisión tomada con el usuario (2026-10-10): Fase 1 entrega la capa de datos
> y el puente; la UI real llega en Fase 2.** Lo que sí se entrega desde la ventana es la
> prueba funcional: `npm run smoke` lanza el build real y ejercita los seis canales por CDP.
> El smoke verifica en la app real que `task:create`, `list`, `update`, `delete` y
> `setStatus` funcionan, que un payload inválido devuelve `AppErrorDto` **sin tocar la BD**,
> y que `require`/`process`/`Buffer` siguen sin existir en el renderer.

**Criterio de aceptación**
- Un payload IPC mal formado (fecha inválida, título vacío) se rechaza en el main y **la BD no se toca**.
- `task_date` se persiste como cadena local; `start_min`/`end_min` como enteros.
- Las migraciones pendientes se aplican dentro de una transacción al abrir.

---

### Fase 2 · Vista Día — 1,5 días

- [x] `useTasks` con caché en memoria e invalidación por IPC
- [x] `TitleBar` con navegación de fecha y selector de vista
- [x] `TaskList` + `TaskRow` con los 4 estados
- [x] `TaskForm` en modal (crear y editar)
- [x] Regla de foco: solo una tarea `in_progress` (transición validada en `core`)
- [x] Cronómetro en vivo de la tarea en curso
- [x] Menú nativo con los atajos globales de la app
- [x] Atajos `Ctrl+N`, `Ctrl+Enter`, `Ctrl+←/→`, `Ctrl+T`, `Esc`

> **Desviaciones documentadas.** (1) **La fecha vive en la URL** (`#/day/AAAA-MM-DD`), no
> en Zustand: el plan se contradice entre §8/§5.2 y §2.6/ADR-006, y con la fecha en la URL
> el botón atrás del sistema recorre los días sin código adicional. Decidido con el usuario
> el 2026-10-10. (2) **`started_at`** se añadió en `0002_started_at.sql`, no en `0001`:
> el cronómetro lo necesita, `updated_at` no sirve porque editar el título de una tarea en
> curso reiniciaría el reloj, y §2.8 prohíbe editar una migración publicada. El plan maestro
> §7.1 y §7.3 se corrigieron. (3) **shadcn/ui pasa a componentes reales** con Radix: el
> `button` de Fase 0 era un stand-in porque faltaban las dependencias, y un modal de verdad
> necesita trampa de foco y roles ARIA.

**Entregable:** el 80 % del valor del producto ya funciona.

**Criterio de aceptación**
- Marcar una segunda tarea como «en curso» → el canal la **rechaza** con error de dominio.
- `Ctrl+N` abre el formulario con el foco ya en el título.
- Crear → completar → navegar a ayer → la tarea aparece en el histórico.

---

### Fase 3 · Etiquetas, búsqueda y filtros — 1 día

- [x] Tablas `tags` / `task_tags` + repositorio + canal `tag:*`
- [x] Parseo de `#etiqueta` al escribir en el editor
- [x] Panel lateral con filtros y contador de resultados
- [x] Búsqueda con debounce de 150 ms sobre título y notas

> **Desviaciones documentadas.** (1) Las tablas ya existían desde `0001_init.sql`; la
> fase es repositorio, canal y UI. (2) **La búsqueda es sobre todo el histórico**, no sobre
> el rango visible: el plan se contradice entre el entregable («todo el histórico») y §14
> («no toda la base»), y para ignorar acentos en SQL hacía falta o una columna
> `search_text` normalizada (`0003`) o cargar el histórico en el renderer. Decidido con el
> usuario el 2026-10-10: columna normalizada, límite de 500 filas. (3) **Fuse.js queda como
> reordenador, no como filtro**: ya no es necesario para el fuzzy, porque el substring
> plegado cubre el caso; el plan lo nominaba por la búsqueda difusa. El límite de 500 filas
> es lo que mantiene acotada la memoria, como pedía §14.

**Entregable:** filtrar y buscar en todo el histórico.

**Criterio de aceptación**
- Búsqueda funciona con acentos y mayúsculas.
- El filtro por etiqueta y por estado se combina y el contador refleja el resultado.
- `ON DELETE CASCADE` limpia `task_tags` al borrar una tarea.

---

### Fase 4 · Vistas Semana, Mes y Heatmap — 1,5 días

- [x] `WeekView` con columnas y balance estimado/real
- [x] `MonthView` con mini-ring de progreso por día
- [x] `Heatmap` de 26 semanas + tooltip + navegación por clic
- [x] Canal `task:listRange` para consultas por rango — ya existía desde la Fase 1; no se reimplementa
- [x] Canal `task:summaryRange`: una fila agregada por día vía `GROUP BY task_date`

**Entregable:** visibilidad completa del pasado y del mes.

**Criterio de aceptación**
- El heatmap se construye con `GROUP BY task_date` en SQL, no cargando la tabla entera.
- Clic en un día del heatmap navega a esa fecha.
- El cambio de vista o de día no produce parpadeo (RNF-03 < 100 ms).

---

### Fase 5 · Recurrencia, estadísticas e import/export — 1,5 días

- [x] `core/recurrence.ts` + tests exhaustivos (diario, semanal, días concretos, `until`)
- [x] Migración `0004_series_id`: una serie tiene identidad propia, no su fecha de origen
- [x] Materialización perezosa de ocurrencias al abrir cada día
- [x] `DaySummaryDto` ya existía desde la Fase 4; `stats:summary` añade racha, media y totales
- [x] Vista de Estadísticas con tarjetas y gráfico semanal, ruta `/stats`
- [x] Exportar a Markdown y JSON (dialogs nativos); importar desde JSON y CSV

**Entregable:** MVP completo.

**Criterio de aceptación**
- Tarea recurrente semanal → aparece en el día correcto, **exactamente una vez por día**.
- Tarea recurrente con `until` en el pasado → no genera ocurrencias futuras.
- Exportar a Markdown → reimportar JSON → mismos datos.
- Importar un JSON inválido → error claro, **sin corromper la base de datos**.
- El índice único `(rrule_from, task_date)` + transacción evitan ocurrencias duplicadas.

---

### Fase 6 · Pulido de UX — 1 día — **COMPLETADA**

- [x] Paleta de comandos (`Ctrl+K`)
- [x] Undo para completar/eliminar (con aviso de 5 s)
- [x] Reordenación por arrastre en la vista Día
- [x] Estados vacíos, esqueleto de carga y mensajes de error claros
- [x] Notificaciones nativas para tareas con hora (`Notification` de Electron)
- [x] Minimize a bandeja y reaparición desde el tray

**Entregable:** la app se siente terminada.

**Criterio de aceptación**
- [x] Cerrar y abrir la app: los datos persisten.
- [x] Abrir un enlace externo → se abre en el navegador del sistema, **no dentro de la app**.
- [x] `app.requestSingleInstanceLock()` evita la instancia duplicada.

**Estado (2026-10-17).** Las siete tareas del documento de fase
(`odd/tasks/fase-6-pulido-ux.md`, S1-S7, L1-L19) están implementadas y las siete verificadas en
comportamiento. `npm run verify` en 534/534 y los cinco smokes en baseline exacto
(37/37 - 30/30 - 40/40 - 30/30 - 26/26). Commits `58f099b` (undo), `cd85061` (estados),
`376c12a` (notificaciones), `43f354d` (tray), `8cecd18` (verificación), mas `ea51a77`
(PR #1: paleta y arrastre) y `d52c064` (`.gitattributes`).

*Limitaciones anotadas, que no deben leerse como resueltas:*
- El **clic físico sobre el icono del tray** nunca se ejercitó: no es programático. Todo lo
  demás de la bandeja sí está verificado, incluido que minimizar **oculte** la ventana
  (`IsWindowVisible` pasa a `false`) y que una segunda instancia la restaure.
- La notificación se verificó **a mano** por una persona: el centro de notificaciones del SO no
  es observable desde el proceso.
- La revisión del hook de GGA no es una revisión de código: puntúa contra `AGENTS.md`, que es
  casi enteramente el bloque de CodeGraph.

**Lo que la fase encontró más allá de sus seis entregables.** Los tres llevaban meses instalados
y ninguno se veía desde los números en verde:
- La pantalla muerta de S4 **ya existía** y era un panel literalmente vacío, no un texto feo:
  `DayState.tasks` nunca es `null`, pero `TaskListProps.tasks` estaba tipado como si lo fuera y
  las cuatro condiciones del render dependían de ese `null`.
- S2 no podía implementarse como transición: `done` es terminal, así que el undo es un
  **restore** de un snapshot, y por eso `TasksRepository.restore()` es el único write del
  repositorio que saltea los chequeos del dominio.
- La **persistencia nunca se había testeado**: todos los tests corren sobre
  `openInMemoryDatabase()`, que por definición no sobrevive a nada, y `transfer-roundtrip`
  abría un *segundo* `openInMemoryDatabase()` - otra base - aparentando verificarlo.

---

### Fase 7 · Rendimiento y seguridad — 1 día — **EN CURSO**

- [x] Revisión de consultas con `EXPLAIN QUERY PLAN` — **hecho y fijado en test** (2026-10-18). `src/main/db/query-plan.test.ts` planifica el SQL exportado del repositorio, no una copia
- [x] Virtualización en listas de más de 100 elementos — **no procede**: la medición dice que no hay presión. Ver «Estado» abajo
- [x] Lazy-loading de vistas pesadas — **no procede**: el arranque deja 1093 ms de margen
- [x] Hardening: `setWindowOpenHandler` bloqueando ventanas nuevas, `will-navigate` bloqueado, CSP en `index.html`, sin `remote` — **ya estaba hecho**, no pendiente (ver «Estado»)
- [ ] Desactivar funciones de Chromium no usadas y `backgroundThrottling: false` solo si hace falta — **decidido en contra**, con motivo (ver «Estado»)
- [x] Medición de arranque, tamaño del instalador y RAM frente a los RNF — `scripts/fase7-perf.mjs`; informe en `docs/rendimiento-fase-7.md`

**Entregable:** cumple RNF-01 a RNF-05 y RNF-11/12.

**Criterio de aceptación**

| Métrica | Objetivo | Medido (2026-10-18) | |
| --- | --- | --- | --- |
| Arranque en frío hasta ventana visible | < 3 s | 1,85 s (mediana de 3) | Cumple |
| Crear una tarea (con atajo) | < 120 ms | 31,3 ms abrir · 31,2 ms enviar | Cumple |
| Cambio de vista o de día | < 100 ms, sin parpadeo | 21,9 ms · 23,9 ms · 0 frames | Cumple |
| RAM en reposo | < 250 MB | 118,2 MB (memoria privada) | Cumple |
| Tamaño del instalador | < 100 MB comprimido | **125,1 MB** | **No cumple** |

**Estado (2026-10-18).** Cuatro de los cinco objetivos se cumplen con margen; **el único
requisito que falla es el tamaño del instalador**, y no es de rendimiento puro:

- **RNF-04, el instalador pesa 125,1 MB.** La causa está localizada y no es el código: el
  allowlist `files` de `electron-builder.yml` no excluye las devDependencies, así que
  `app.asar` pesa 81 MB para un bundle de renderer de 1,37 MB. Suman 49 MB más de locales que
  la app no usa. **Los dos controles pertenecen a la Fase 9**, que es quien posee
  `electron-builder.yml`; aquí solo se deja medido y con la causa apuntada.

Todo lo demás pasó con holgura, y esa holgura es lo que decidió el resto de la fase: no hay
presión medida que justifique virtualización ni lazy-loading (ver arriba).

**Las tres líneas de este checklist que el plan daba por pendientes y ya estaban hechas**
(el plan las describía como trabajo futuro; el código las tenía desde antes):

| Línea del plan | Dónde está |
| --- | --- |
| `setWindowOpenHandler` bloqueando ventanas | `src/main/index.ts:216` |
| `will-navigate` bloqueado | `src/main/index.ts:225` |
| CSP en `index.html` | `src/renderer/index.html:8` |
| `sandbox` / `contextIsolation` / `nodeIntegration` | `src/main/index.ts:198` |
| Sin `remote` | nunca se instaló |

Además hay dos medidas que el plan no pedía y ya existen: los handlers de permiso deniegan
todo (`index.ts:234`) y `backgroundThrottling` se deja **en su valor por defecto a
propósito**. Chromium estrangula los temporizadores del renderer cuando la ventana está
oculta, y desde la Fase 6 la app se minimiza a bandeja, así que la pregunta era real. La
respuesta es que lo que depende del tiempo —el bucle de recordatorios de 30 s— vive en el
proceso main, que no se estrangula; y desactivar el estrangulamiento costaría CPU constante
con la ventana oculta a cambio de nada que la app necesite. Dejar un flag de seguridad o de
rendimiento puesto «por si acaso» es optimización especulativa: aquí no se pone.

**Medición, no casillas.** El script y su metodología están en
`docs/rendimiento-fase-7.md`, que incluye los cuatro límites de lo que mide y **cuatro casos en
los que el propio instrumento dio números falsos antes de corregirse** — uno de ellos un
parpadeo que casi se reporta como defecto y no existía. Una cifra sin método al lado es una
cifra elegida.

---

### Fase 8 · Tests y calidad — 1,5 días

- [ ] Tests unitarios de `core/` (100 %) y de los repositorios — 538 tests en 28 archivos, pero **el umbral de cobertura del criterio de aceptación nunca se ha medido**: `@vitest/coverage-v8` está instalado y ningún script lo ejecuta. La casilla queda sin marcar a propósito; los tests existen, la medición del porcentaje no
- [x] Tests del contrato IPC con Zod (entradas inválidas rechazadas) — `src/main/ipc/boundary.test.ts`, 24 tests que verifican la cadena Zod → `core/validation` → repositorio y que **la BD no se toca** tras cada rechazo
- [x] E2E sobre el proceso real (crear → completar → navegar → buscar → reabrir) — **no** con Playwright: su lanzador de Electron espera el anuncio del inspector de Node que Electron 44 no le emite en este stack. Los flujos van por CDP contra el mismo proceso, puente y fichero SQLite
- [x] `scripts/lib/cdp.mjs` compartido: los seis smokes llevaban cada uno su copia del harness
- [x] CI en GitHub Actions: lint+tipos+unit primero, luego flujos y un paso por fase
- [x] Husky + lint-staged, encadenados **con** el hook de revisión por IA (`core.hooksPath` haría que git ignorase `.git/hooks/pre-commit`)
- [ ] Tests E2E con Playwright — bloqueado por el lanzador; reevaluar en Fase 9 con otra versión de Electron
- [x] Lint y formateo en el pipeline — el job `quality` ejecuta `npm run verify`, que es `eslint` + `tsc` de los dos proyectos + `vitest`

**Entregable:** pipeline verde.

**Criterio de aceptación**

| Nivel | Alcance | Objetivo de cobertura |
| --- | --- | --- |
| Unitario | `core/`, `recurrence.ts`, utilidades de fecha | ≥ 90 % en `core/` |
| Integración | Repositorios y canales IPC sobre BD en memoria | ≥ 80 % en `db/` e `ipc/` |
| E2E | Flujos críticos de la UI sobre el proceso real | 5–8 escenarios |
| Manual | Matriz SO × vista × tema | Checklist de release |

**Estandarización:** `typescript-eslint` estricto + `eslint-plugin-security` · Prettier · Conventional Commits · Husky + lint-staged.

---

### Fase 9 · Empaquetado y distribución — 1,5 días

- [ ] `electron-builder.yml`: Windows (NSIS + portable), macOS (dmg, universal), Linux (AppImage + deb)
- [ ] `asar: true`, `files` allowlist, `npmRebuild: false` con la reconstrucción en CI
- [ ] Iconos y metadatos (nombre, publisher, copyright)
- [ ] `electron-updater` con feed de GitHub Releases y publicación silenciosa
- [ ] GitHub Actions: `ci.yml` (tests en cada push) y `release.yml` (build + firma por etiqueta)

**Entregable:** instalador descargable y autoactualizable.

**Criterio de aceptación**
- `tag v*.*.*` dispara build, firma y publicación del feed de actualizaciones.
- `better-sqlite3` se recompila en CI, nunca en la máquina del usuario final.
- SemVer estricto `MAJOR.MINOR.PATCH`; la BD lleva su versión en `PRAGMA user_version`.

---

### Fase 10 · Documentación y lanzamiento — ½ día

- [ ] `README` con instalación, uso, atajos, respaldos y requisitos
- [ ] `CHANGELOG` y versión `1.0.0`

**Entregable:** notas de la v1.0.

---

## 4. Cadena de dependencias

```
Fase 0 ──▶ Fase 1 ──▶ Fase 2 ──▶ Fase 3 ──▶ Fase 4 ──▶ Fase 5 ──┐
 Cimientos   Datos     Vista Día  Etiquetas  Vistas     MVP ◀──────┘
                                                              │
                                                    ┌─────────┴─────────┐
                                                    ▼                   ▼
                                              Fase 6              Fase 7
                                              Pulido UX     Rendim. y seguridad
                                                    │                   │
                                                    └─────────┬─────────┘
                                                              ▼
                                                              Fase 8
                                                          Tests y calidad
                                                              │
                                                              ▼
                                                              Fase 9
                                                      Empaquetado y CI
                                                              │
                                                              ▼
                                                              Fase 10
                                                       Documentación v1.0
```

**Paralelizables:** con un solo desarrollador, las fases son secuenciales. La excepción: los tests E2E de la Fase 8 pueden escribirse en paralelo con las Fases 6–7 si se cede el contexto.

---

## 5. Riesgos

| # | Riesgo | Impacto | Prob. | Mitigación | Fase |
| --- | --- | --- | --- | --- | --- |
| 1 | Tamaño y RAM por encima de lo esperado | Medio | Media | Medir en Fase 7; aplicar §14 del plan; plan B sin Chromium | 7 |
| 2 | `better-sqlite3` no compila en la máquina del usuario | ~~Alto~~ **Bajo** | **Mitigado por §8.3:** con N-API no hay compilación en el flujo normal; el binario viene precompilado en el tarball. Mantener `install-app-deps` en CI para el empaquetado | 0, 9 |
| 9 | Deriva del stack: el plan fijaba versiones de 2024, sin verificar peer-deps | Alto | **Alta** | Matriz fijada y verificada en §8.1; conflictos A y B resueltos explícitamente antes de escribir código | 0 |
| 3 | Recurrencias con casos límite (fin de mes, horario de verano, series antiguas) | Alto | Media | Motor aislado con tabla de tests exhaustiva; fechas como cadenas, nunca `Date` | 5 |
| 4 | XSS o navegación inesperada desde el renderer | Alto | Media | `sandbox`, CSP, `setWindowOpenHandler` deny, `will-navigate` cancelado, Zod | 7 |
| 5 | Sobrediseño del MVP | Alto | **Alta** | §2.2 es explícito; toda feature pasa el filtro *«¿sirve al objetivo?»* | todas |
| 6 | Dejar de usar la app tras dos semanas | Alto | Media | Heatmap y racha: la gamificación ligera sostiene el hábito | 4, 5 |
| 7 | Occurrencias duplicadas por fallo de materialización | Medio | Baja | Índice único `(rrule_from, task_date)` + transacción | 5 |
| 8 | Firma de binarios en macOS (notarización) | Medio | Media | Distribuir primero sin firmar en Windows/Linux; notarizar al final | 9 |

---

## 6. Métricas de éxito

Definidas **30 días después de instalar la v1.0**.

| Métrica | Objetivo |
| --- | --- |
| Días consecutivos de uso | ≥ 20 de 30 |
| Tareas registradas por día | ≥ 5 |
| Tiempo hasta ver «hoy» | < 3 s |
| Latencia percibida al añadir tarea | < 120 ms |
| Consultas al histórico por semana | ≥ 3 |
| RAM en reposo | < 250 MB |
| Tamaño del instalador | < 100 MB |

---

## 7. Decisiones arquitectónicas vigentes

| ADR | Decisión | Estado |
| --- | --- | --- |
| ADR-001 | Electron en lugar de Tauri (un solo lenguaje, ecosistema maduro) | Aceptada |
| ADR-002 | SQLite vía `better-sqlite3` en el main, no en el renderer | Aceptada |
| ADR-003 | Fechas como cadenas locales `YYYY-MM-DD`, horas como minutos enteros | Aceptada |
| ADR-004 | Recurrencias por materialización perezosa, no por fila expandida | Aceptada |
| ADR-005 | Contrato IPC tipado en un único fichero + validación Zod | Aceptada |
| ADR-006 | Zustand solo para estado de UI; los datos viven en el main | Aceptada |
| ADR-007 | `sandbox: true` y `contextIsolation: true` en todas las ventanas | Aceptada |
| ADR-008 | `electron-vite` como bundler en lugar de webpack | Aceptada |
| ADR-009 | Stack fijado a versiones estables verificadas; `typescript@5.9.3` y `vite@7.3.7` anclados por peer-deps de `typescript-eslint` y `electron-vite` | Aceptada |
| ADR-010 | Electron inicializado en la raíz del repo, con `name`/`appId` coherentes con el directorio | Aceptada |
| ADR-011 | `better-sqlite3` se usa directamente desde N-API: **sin** `install-app-deps` en `postinstall`, y tests de repositorio en Node normal con BD `:memory:` | Aceptada |
| ADR-012 | Esquema completo en una sola migración `0001_init.sql`, versionado en `PRAGMA user_version` | Aceptada (Fase 1) |
| ADR-013 | Las migraciones se importan como strings (`?raw`), no se leen del disco | Aceptada (Fase 1) |
| ADR-014 | `done` es terminal: ninguna transición sale de él, ni en dos pasos | Aceptada (Fase 1) |
| ADR-015 | La UI y los mensajes de error van en español; identificadores y comentarios en inglés | Aceptada (Fase 1) |
| ADR-016 | La fecha seleccionada vive en la URL (`#/day/:date`), no en Zustand | Aceptada (Fase 2) |
| ADR-017 | La caché de tareas es un store externo con `useSyncExternalStore`, no estado de Zustand | Aceptada (Fase 2) |
| ADR-018 | `started_at` se añade en `0002`; `0001` no se edita (§2.8) | Aceptada (Fase 2) |
| ADR-019 | Columna derivada `search_text` para búsqueda sin acentos ni mayúsculas | Aceptada (Fase 3) |
| ADR-020 | La búsqueda abarca todo el histórico, acotada a 500 filas | Aceptada (Fase 3) |
| ADR-021 | Las reglas de etiqueta viven en `src/shared/tags.ts`, no en `main/core` | Aceptada (Fase 3) |
| ADR-022 | Varias etiquetas significan OR, no AND | Aceptada (Fase 3) |
| ADR-023 | El tiempo real de una tarea completada es `completed_at - started_at`; sin columna nueva, y lo no medido se reporta como tal | Aceptada (Fase 4) |
| ADR-024 | La vista activa vive en la ruta (`/week/:date`), no en Zustand: la URL responde a fecha y vista a la vez | Aceptada (Fase 4) |
| ADR-025 | Semana, Mes y Heatmap leen agregados por día, nunca tareas | Aceptada (Fase 4) |
| ADR-026 | Una serie recurrente tiene identidad propia (`series_id`), no su fecha de origen | Aceptada (Fase 5) |
| ADR-027 | Una tarea recurrente es su propia primera ocurrencia: `task_date = rrule_from` | Aceptada (Fase 5) |
| ADR-028 | La materialización ocurre dentro de `listByDate`, en una transacción, idempotente | Aceptada (Fase 5) |
| ADR-029 | Importar rechaza el archivo entero ante una sola tarea inválida; nunca un subconjunto | Aceptada (Fase 5) |
| ADR-030 | Ninguna ruta cruza el bridge: el renderer pide un formato, el main abre el diálogo | Aceptada (Fase 5) |
| ADR-031 | La racha se cuenta hacia atrás desde hoy; un hoy sin terminar no la rompe | Aceptada (Fase 5) |

---

## 8. Requisitos previos (antes de la Fase 0)

**Toolchain:** Node 22.12+ y un compilador nativo para `better-sqlite3`
- Windows: Visual Studio Build Tools con C++
- Linux: `build-essential` + `python3`
- macOS: Xcode CLI Tools (ya instalado por defecto)

> Verificado en la máquina de desarrollo: **Node 24.18.0 · npm 12.2.0 · git 2.41.0**. Cumple el mínimo (`electron-vite@5` exige Node `^20.19.0 || >=22.12.0`; `better-sqlite3@13` exige `node >=22`).

### 8.1 Matriz de versiones

Todas consultadas en el registro de npm el 2026-10-09. **Son las que hay que instalar; no subestimar ni «dejar que npm resuelva»**, porque los rangos abiertos son exactamente donde aparecen los conflictos de peer.

**Runtime y build**

| Paquete | Versión | Motivo |
| --- | --- | --- |
| `electron` | `44.7.0` | Rama estable actual |
| `electron-vite` | `5.0.0` | Ver conflicto B. No usar `6.0.0-beta` |
| `vite` | `7.3.7` | Tope del rango de `electron-vite@5` |
| `@vitejs/plugin-react` | `5.2.0` | `6.x` exige `vite ^8` — incompatible |
| `react` · `react-dom` | `19.3.0` | — |
| `typescript` | `5.9.3` | Ver conflicto A. **No subir a 7.x** |

**Datos y dominio**

| Paquete | Versión |
| --- | --- |
| `better-sqlite3` | `13.0.3` |
| `zod` | `4.6.5` |
| `zustand` | `5.0.15` |
| `date-fns` | `4.4.0` |
| `fuse.js` | `7.5.0` |
| `react-router-dom` | `7.18.4` |

**UI**

| Paquete | Versión |
| --- | --- |
| `tailwindcss` | `4.3.3` |
| `@tailwindcss/vite` | `4.3.3` |
| `shadcn` (CLI) | `4.21.4` |

**Tooling**

| Paquete | Versión |
| --- | --- |
| `vitest` · `@vitest/coverage-v8` | `5.0.3` |
| `@playwright/test` | `1.64.0` |
| `electron-builder` | `26.15.3` |
| `electron-updater` | `6.8.9` |
| `@electron-toolkit/preload` | `3.0.2` |
| `@electron-toolkit/utils` | `4.0.0` |
| `eslint` | `10.12.0` |
| `typescript-eslint` | `8.71.1` |
| `eslint-plugin-security` | `4.2.0` |
| `eslint-config-prettier` | `10.1.8` |
| `prettier` | `3.9.9` |
| `husky` | `9.1.7` |
| `lint-staged` | `17.6.0` |
| `@types/better-sqlite3` | `9.6.0` |
| `@types/react` · `@types/react-dom` | `19.3.0` |

#### Conflictos de peer-dependency y cómo se resuelven

Estos dos no son opcionales. Si se dejan al criterio de npm, el árbol falla con `ERESOLVE`.

**Conflicto A — TypeScript 7 rompe el lint.**
`typescript-eslint@8.71.1` declara `peer: typescript >=4.8.4 <6.1.0`. La última estable de TS es **7.0.2**, fuera de rango; TS 6 solo existe como `6.0.0-beta` y no hay `typescript-eslint@9` que lo admita.
→ **Fijar `typescript@5.9.3`.** El plan exige `eslint` + `tsc --noEmit` en el pipeline (§10), así que renunciar a TS 7 no es opción. Revisar el salto a 7 cuando `typescript-eslint` lo soporte.

**Conflicto B — Vite 8 rompe electron-vite.**
`electron-vite@5.0.0` declara `peer: vite ^5.0.0 || ^6.0.0 || ^7.0.0` — sin 8. En el otro extremo, `@vitejs/plugin-react@6.1.2` exige `vite ^8.0.0`, así que no se puede subir el plugin para escapar.
→ **Fijar `vite@7.3.7` + `@vitejs/plugin-react@5.2.0` + `electron-vite@5.0.0`.** Los tres se satisfacen mutuamente y los tres están estables.
→ La rama alternativa es `vite@8` + `electron-vite@6.0.0-beta.7` (sí acepta vite 8). **Descartada:** meter una beta de bundler en la base de un proyecto de 12 días que además tiene que producir instaladores es riesgo sin contrapartida.

#### Tailwind 4 no es «Tailwind 3 actualizado»

Es un cambio de modelo, no de versión. Tailwind 4 es **CSS-first**: no hay `tailwind.config.js`.

| | Tailwind 3 (plan original) | Tailwind 4 (actual) |
| --- | --- | --- |
| Configuración | `tailwind.config.js` | `@import "tailwindcss"` en el CSS |
| Plugin | `postcss.config.js` | `@tailwindcss/vite` en `vite.config.*` |
| Inicializar | `npx tailwindcss init -p` | **No existe.** No hay comando |
| Modo oscuro | `darkMode: 'class'` | `@custom-variant dark (&:where(.dark, .dark *))` |
| Tokens | `theme.extend` | `@theme { --color-*: … }` |

Consecuencia para la Fase 0: el checklist dice «Tailwind + shadcn/ui + tema claro/oscuro con `nativeTheme`». El mapeo es `nativeTheme.shouldUseDarkColors` → alternar `document.documentElement.classList` → `@custom-variant dark` hace el resto. shadcn 4.21.4 ya genera código compatible con TW4.

### 8.2 Arranque del proyecto

El repositorio es `taskdiary`. **Inicializar Electron en la raíz**, no en un subdirectorio: el nombre del repo, el `name` de `package.json` y el `appId` deben coincidir, o cada ruta del código, cada script y cada artefacto de `electron-builder` arrastra un nombre que no describe lo que es. Los tres están alineados en `com.local.taskdiary` / `taskdiary` (ADR-010, pendiente 2 de §0.1).

> `npm create @quick-start/electron` **no** es un paquete. npm resuelve `create @scope/name` → `@scope/create-name`, y el paquete real es `@quick-start/create-electron` (1.0.30). El comando del plan original es correcto; el que falla es `npm view @quick-start/electron`, que consulta el nombre literal.

```bash
# 0. El plan maestro ya está versionado en docs/plan-tasks-app.md — no hace falta copiarlo

# 1. Scaffold en la raíz (`.` = este directorio), template React + TypeScript
npm create @quick-start/electron . -- --template react-ts

# 2. Dependencias de runtime — versiones fijadas, sin ^ ni latest
npm install better-sqlite3@13.0.3 zod@4.6.5 zustand@5.0.15 \
            date-fns@4.4.0 fuse.js@7.5.0 react-router-dom@7.18.4

# 3. Dependencias de desarrollo — fijadas por conflicto A y B
npm install -D typescript@5.9.3 vite@7.3.7 @vitejs/plugin-react@5.2.0 \
               @types/better-sqlite3@9.6.0 @types/react@19.3.0 @types/react-dom@19.3.0 \
               electron-builder@26.15.3 electron-updater@6.8.9 \
               vitest@5.0.3 @vitest/coverage-v8@5.0.3 @playwright/test@1.64.0 \
               tailwindcss@4.3.3 @tailwindcss/vite@4.3.3 shadcn@4.21.4 \
               eslint@10.12.0 typescript-eslint@8.71.1 eslint-plugin-security@4.2.0 \
               eslint-config-prettier@10.1.8 prettier@3.9.9 husky@9.1.7 lint-staged@17.6.0

# 4. Tailwind 4 — NO hay `tailwindcss init`. Registrar el plugin en electron.vite.config.ts
#    y poner `@import "tailwindcss";` en el CSS de entrada del renderer.

# 5. shadcn/ui (ya soporta Tailwind 4)
npx shadcn@latest init
npx shadcn@latest add button dialog input dropdown-menu tooltip badge

# 6. Rebuild de better-sqlite3 — SOLO en CI, no aquí (ver §8.3)
#    Con la versión fijada (N-API) el binario sirve para Node y Electron.
#    Ejecutarlo aquí solo añade una descarga a electronjs.org que puede fallar.
# npx electron-builder install-app-deps

npm run dev
```

**Verificación inmediata del árbol** (si algo se resolvió mal, salta acá antes de escribir código):

```bash
npm ls typescript vite electron-vite @vitejs/plugin-react   # sin invalid / extraneous
npx tsc --version                                            # 5.9.3, no 7.x
```

> `install-app-deps` (paso 6) queda **verificado en rojo**: véase §8.3. Con `better-sqlite3@13` (N-API) el rebuild no es necesario para que la app funcione, y activarlo sin red puede romper el `npm install`. Mantenerlo **solo en CI**, no en `postinstall`.

### 8.3 better-sqlite3 y el ABI — medido, no supuesto

Este apartado **reemplaza** a la advertencia de §8.2. El supuesto clásico «el binario de `better-sqlite3` se compila contra el ABI de Node y revienta en Electron» **es falso en la versión fijada**, y se comprobó ejecutándolo, no leyéndolo.

**Medición (2026-10-09, Node 24.18.0 · Electron 44.7.0 · better-sqlite3 13.0.3 · Vitest 5.0.3):**

| Escenario | Resultado |
| --- | --- |
| `better-sqlite3` recién instalado, `SELECT 1` en Node | ✅ `{"v":1}`, SQLite 3.53.4 |
| ABI de Node vs ABI de Electron | 137 vs 149 — **12 de diferencia** |
| `electron-builder install-app-deps` | ✅ RC=0, pero **no genera ningún `.node`** |
| Vitest en Node **después** del rebuild | ✅ 3/3 tests, SQL real (CREATE/INSERT/SELECT) |
| Electron 44 **después** del rebuild | ✅ `SELECT 1` → 1, con SQL real |

**Por qué:** `better-sqlite3@13` se apoya en `node-addon-api@8` y compila con `NAPI_VERSION=10`. N-API es una **interfaz estable entre runtimes**: el binario es *uno*, no uno por ABI. Su cargador (`lib/binding.js`) resuelve primero `prebuilds/<platform>-<arch>.node` y solo cae a `build/Release` si no lo encuentra. Como el tarball ya trae los prebuilds de las 8 plataformas, `build/Release` nunca se crea.

**Consecuencias para el plan:**

1. **Los tests de repositorio van en Node normal.** No hace falta `ELECTRON_RUN_AS_NODE`, ni Vitest dentro de Electron, ni mockear la capa de BD. La Fase 1 puede usar `:memory:` directamente con SQL real, y la cobertura ≥ 80 % de `db/` de la Fase 8 es alcanzable de verdad.
2. **`install-app-deps` no va en `postinstall`.** Es un no-op que además depende de descargar cabeceras de `www.electronjs.org` (falló con `ConnectTimeoutError` en esta máquina). Ponerlo en `postinstall` convierte un `npm install` offline en un fallo de instalación. En CI sí, porque es donde se empaqueta (riesgo 2 de §5).
3. **Riesgo 2 de §5 baja de probabilidad.** De «`better-sqlite3` no compila en la máquina del usuario» a «no aplica en la práctica»: no hay compilación en el flujo normal, solo en el empaquetado.

**Lo que SÍ sigue siendo real:** si alguna vez se fuerza compilar desde fuente (`buildFromSource`), o se añade un módulo nativo que no sea N-API, el desajuste de ABI reaparece y hay que rebuildar para Electron.

### 8.4 Trampas conocidas de Electron

| Trampa | Síntoma | Solución |
| --- | --- | --- |
| Rutas del renderer | Pantalla en blanco al empaquetar | `base: './'` en la config de Vite |
| Módulo nativo | `NODE_MODULE_VERSION` mismatch | **No aplica a `better-sqlite3@13`** (N-API, binario único) — medido en §8.3. Rebuild solo si se fuerza compilar desde fuente |
| `npm install` sin red | `install-app-deps` falla con `ConnectTimeoutError` a `www.electronjs.org` | No poner `install-app-deps` en `postinstall` (§8.3); dejarlo solo en CI |
| Barra de título | Doble barra en macOS | `titleBarStyle: 'hiddenInset'` + `trafficLightPosition` |
| Zoom heredado | `Ctrl+±` hace zoom del contenido | Interceptar antes de Chromium |
| Links externos | Se abren dentro de la app | `setWindowOpenHandler` + `shell.openExternal` |
| Permisos | La app pide cámara/micrófono | `setPermissionRequestHandler` denegando todo |
| Instancia duplicada | Dos apps al hacer doble clic | `app.requestSingleInstanceLock()` + evento `second-instance` |
| Scaffold mal interpretado | `404` al consultar el paquete | `npm create @quick-start/electron` resuelve a `@quick-start/create-electron`; no existe un paquete `@quick-start/electron` |
| Peer dependency irresoluble | `npm install` falla con `ERESOLVE` | Respetar §8.1: `typescript@5.9.3` y `vite@7.3.7` están fijados por conflicto, no por preferencia |
| Tailwind 4 sin config | No se aplica ningún estilo | No hay `tailwind.config.js` ni comando `init`; registrar `@tailwindcss/vite` e importar `tailwindcss` en el CSS |
| Types de React 19 | `children` implícito y refs rechazados | Revisar tipos de componentes propios al adoptar React 19; Radix/shadcn ya están migrados |
| Import de `better-sqlite3` | `Database is not a constructor` bajo Vitest | Es interop ESM/CJS, no el ABI: usar `import Database from 'better-sqlite3'` (default), no `{ Database }` |

### 8.5 Trampas de la máquina de desarrollo (Windows)

Detectadas al medir §8.3. No son properties del proyecto, pero rompen el arranque si no se saben.

| Trampa | Síntoma | Solución |
| --- | --- | --- |
| `npm install` con `allow-scripts` restringido | npm 12 bloquea los scripts de instalación: `electron` no descarga su binario y `better-sqlite3` no ejecuta `node-gyp` | `~/.npmrc` trae `allow-scripts=opencode-ai`. Añadir los paquetes del proyecto o ejecutar el script manualmente |
| `electron-builder` vía `npx` en Windows | El shim `.cmd` se come la salida y devuelve 0 sin imprimir nada — parece que no hace nada | Invocar el CLI con `node node_modules/electron-builder/out/cli/cli.js` cuando se necesite depurar |
| `node-gyp` sin red | `ConnectTimeoutError` a `www.electronjs.org:443` al bajar cabeceras | Reintentar: es transitorio. Con `better-sqlite3@13` no hace falta para nada (§8.3) |
| `cmd //c 'a && b'` con redirección | La cadena no ejecuta y no crea el fichero de salida | Usar un `.bat` explícito con `call vcvars64.bat` y `cd /d "%~dp0"` |

---

## 9. Copias de seguridad

- **Automático:** copia del `.db` en `userData/backups/`, una por día, conservando las 7 últimas.
- **Manual:** Ajustes → «Exportar copia de seguridad» (`.db` o `.json`) mediante dialog nativo.
- **Documentado:** la ruta del `.db` es estable y se muestra en Ajustes, para que el usuario pueda copiarlo a mano.

---

## 10. Pipeline de CI

```
push / PR  ──▶  ci.yml      →  eslint · tsc --noEmit · vitest run
                           →  playwright test (E2E sobre Electron)
                           →  (sin install-app-deps: N-API, §8.3)

tag v*.*.* ──▶  release.yml →  npm ci
                           →  electron-builder install-app-deps
                           →  electron-builder --publish always
                           →  electron-updater publica el feed de actualizaciones
```

---

_Plan de implementación generado a partir de `docs/plan-tasks-app.md` v2.0 (2026-10-08). Actualizar este documento al cerrar cada fase._

_Revisión de stack 2026-10-09: §0 y §8 actualizados contra el registro de npm; matriz de versiones fijada en §8.1 con los conflictos de peer-dependency resueltos; §8.3 ampliada con las trampas nuevas; ADRs 009 y 010 añadidos._

_Verificación 2026-10-09: §8.3 (better-sqlite3 y N-API) y §8.5 (trampas de la máquina) añadidas **midiendo**, no consultando documentación. El supuesto de §8.2 sobre el desajuste de ABI era incorrecto para `better-sqlite3@13` y quedó corregido en el riesgo 2 de §5, en el paso 6 de §8.2 y en el checklist de Fase 0._

_Banco de pruebas de esa medición: `%TEMP%\abi-probe` (`RESULTADOS.md`, `probe.test.ts`, `rebuild.bat`). Se puede reproducir para revalidar el apartado._
