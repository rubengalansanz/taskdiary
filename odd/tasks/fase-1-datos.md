# Fase 1 · Datos

> Feature ODD derivada de `PLAN_IMPLEMENTACION.md` §3 «Fase 1 · Datos — 1 día».
> Documento maestro: `docs/plan-tasks-app.md` v2.0 (2026-10-08) §7 y §11.

## Objetivo

Que el main proceso sea dueño del dominio: esquema real en disco, migraciones versionadas,
modelo de tareas con su máquina de estados, un repositorio con CRUD completo y un contrato
IPC cerrado que valide con Zod **antes** de tocar la base de datos.

## Problema

Hoy `src/main/db/database.ts` abre la BD y responde `SELECT 1`, pero no hay esquema. La
ventana muestra un smoke de Fase 0 que solo prueba que el puente vive. El riesgo real de
esta fase no es escribir SQL: es escribir SQL que acepte basura.

`better-sqlite3` no valida nada por sí mismo. Si el renderer manda `task_date: "ayer"` o un
título de 40.000 caracteres, SQLite lo guarda tal cual y el error aparece tres vistas más
abajo, cuando ya no se sabe de dónde salió. El criterio de aceptación es explícito: *un
payload mal formado se rechaza en el main y la base de datos no se toca*.

## Por qué ahora

Fase 2 construye la Vista Día sobre este contrato. Si el esquema o el contrato cambian
después de que existan componentes de UI, el retrabajo toca las tres capas a la vez.

## Alcance autorizado

Solo Fase 1:

- `core/errors.ts` · `core/task.ts` · `core/validation.ts`
- `db/database.ts` (transacciones) · `db/migrate.ts` · `db/repositories/tasks-repo.ts`
- `migrations/0001_init.sql`
- Contrato IPC + esquemas Zod + proxy del preload + registro de canales
- Canales `task:list`, `task:create`, `task:update`, `task:delete`
- Tests de repositorio sobre BD `:memory:`

**Fuera de alcance explícito:**

- **Ninguna UI de tareas.** `TaskList`, `TaskRow`, `TaskForm` y `TitleBar` son de Fase 2.
  La ventana sigue mostrando el smoke de Fase 0; lo que cambia es que el probe ahora
  verifica el esquema real (la tabla `tasks` existe) en lugar de solo `SELECT 1`.
  Decisión tomada con el usuario: la entrega es *capa de datos + puente*.
- **Tags y `task_tags`** — Fase 3. La tabla existe en `0001_init.sql` (el esquema es
  unitario y §7.1 la define), pero sin repositorio ni canal.
- **Recurrencia y materialización** — Fase 5. Las columnas `rrule_*` existen por el mismo
  motivo; el motor no.
- **`task:setStatus`** — Fase 2, con la regla de foco. El repositorio ya expone el método
  porque es una operación de escritura más, pero el canal se registra en Fase 2.
- **Husky/lint-staged cableados** — Fase 8.

## Restricciones

- Reglas §2.1–§2.11 del plan, todas. En Fase 1 aplican la 3, 4, 5, 7, 8, 9 y 10.
- `src/main/core/` y `src/main/db/` importan **solo** `node:*`, `better-sqlite3` y los
  módulos internos entre sí. Cero imports de `electron`, cero de `react`.
- Consultas parametrizadas siempre. Ni una concatenación de SQL en el repositorio.
- Fechas como cadenas locales `YYYY-MM-DD`. Horas como minutos desde medianoche (enteros).
  Ni `Date` en el dominio.
- Migraciones incrementales numeradas. `0001_init.sql` no se edita una vez publicada.
- ADR-011: sin `install-app-deps`. Los tests corren en Node normal sobre `:memory:`.
- **Idioma:** identificadores, comentarios y ADRs en inglés. **La UI y los mensajes de
  `AppError` que ve el usuario, en español.** Decisión del usuario (2026-10-10): es una app
  personal y los mensajes de error se leen en el momento de frustrated, no en un log.

## Mapa de rutas (heredado de Fase 0)

El plan nombra `electron/core/` y `electron/db/` (§2.10); el scaffold de `electron-vite`
resuelve `main` desde `src/main/`. **Decisión: `src/main/core/` y `src/main/db/`.** La regla
§2.10 trata de una frontera de imports, no de un nombre de carpeta.

## Decisiones de diseño

### D1 — El esquema completo en `0001_init.sql`, no un esquema mínimo

`0001_init.sql` crea `tasks`, `tags`, `task_tags`, `settings` y todos sus índices de una
vez, tal cual §7.1 del plan maestro. No se crea solo `tasks` y se añaden las demás tablas en
`0002`, `0003`… 

**Por qué:** §2.8 dice *nunca se edita una migración ya publicada*. Un esquema parcial obliga
a una cadena de migraciones incrementales para llegar al §7.1 que el plan ya diseñó y
documentó — y esas migraciones se ejecutan en la máquina de un usuario único, sin másBeneficio
que el de evitar escribir cuatro ficheros que describe un diseño cerrado. La regla §2.8 protege
al usuario de migraciones *editadas*, no le obliga a fragmentar un esquema *completo*.

Además, `tags` y `task_tags` sin usar no cuestan nada: SQLite no paga por tablas vacías, y
`ON DELETE CASCADE` queda probado desde el día 1.

### D2 — `PRAGMA user_version` como reloj de migraciones

El plan §15.3 lo fija: *la base de datos lleva su propia versión en `PRAGMA user_version`*.
No se crea una tabla `schema_migrations`. El runner lee `user_version`, aplica los `.sql`
pendientes en orden ascendente dentro de una transacción, y escribe el nuevo valor.

**Consecuencia:** si una migración se aplica a medias y falla, la transacción revierte tanto
el DDL como el `user_version`. SQLite DDL es transaccional — esto funciona.

### D3 — Las migraciones se importan como strings, no se leen del disco

`db/migrations.ts` importa cada `.sql` con el sufijo `?raw` de Vite y los exporta en un
array ordenado. `migrate.ts` consume ese array.

**Por qué en vez de `fs.readFileSync`:** `electron-vite` empaqueta el main como un único
fichero en `out/main/`. Leer migraciones del disco obligaría a copiar `migrations/` al
artefacto y a resolver rutas relativas al bundle — con `asar: true` (§9 Fase 9) eso es una
fuente clásica de `ENOENT` en producción. Importándolas, el SQL viaja dentro del código y
`migrations/` sigue siendo un directorio legible y revisable en el repo.

**Consecuencia en tests:** Vitest usa el mismo transformador de Vite, así que `:memory:`
ejecuta el SQL real. No hay doble fuente de verdad ni mock de migraciones.

### D4 — Errores de dominio como `AppError` con código, traducidos en el borde

`core/errors.ts` define códigos estables (`TASK_NOT_FOUND`, `TASK_TITLE_REQUIRED`,
`FOCUS_ALREADY_SET`, `VALIDATION_FAILED`…). Cada código tiene un mensaje en español y una
función que recibe los datos del error y devuelve el texto final.

El main **no** devuelve el `AppError` crudo por IPC: lo convierte a un `AppErrorDto`
`{ code, message, details? }`. El renderer muestra `message`. El código queda disponible
para lógica, no para traducir dos veces.

**Por qué no se devuelve el `Error`:** el stack trace y las rutas absolutas del disco
(`C:\Users\...\taskdiary.db`) no deben cruzar el puente hacia un renderer que no los necesita.

### D5 — La validación vive en dos capas, y las dos se ejecutan

1. **Zod** en el borde IPC: forma, tipos, rangos. Rechaza `task_date: "ayer"`.
2. **`core/validation.ts`**: reglas que el esquema no puede expresar sola. Por ejemplo
   `endMin > startMin` es un `refine`, sí, pero *«cambiar el día de una tarea completada»*
   es una regla de negocio que necesita consultar la fila.

Ambas se ejecutan en el main antes de la escritura. El repositorio asume entrada ya
validada y no repite reglas de negocio: hace lo que le dicen.

### D6 — `task:list` devuelve un día; `task:listRange` se añade en Fase 4

El plan §6.3 lista `task:listRange` y §11 Fase 4 lo implementa. Fase 1 implementa `task:list`
por fecha, que es lo que necesita la Vista Día. El repositorio sí expone `listByRange()` desde
el día uno, porque es el mismo SQL con dos parámetros y probarlo cuesta lo mismo.

## Tareas

- [x] **T1.1** `core/errors.ts` — `AppError`, catálogo de códigos, mensajes en español
- [x] **T1.2** `core/task.ts` — `TaskStatus`, `RruleFreq`, `Task`, máquina de estados
- [x] **T1.3** `core/datetime.ts` + `core/validation.ts` — fechas, minutos, reglas de negocio
- [x] **T1.4** `db/database.ts` — `transaction()`, `openInMemoryDatabase()`, `hasTable()`
- [x] **T1.5** `migrations/0001_init.sql` + `db/migrations.ts` + `db/migrate.ts`
- [x] **T1.6** `db/repositories/tasks-repo.ts` — CRUD + `listByRange` + máquina de estados
- [x] **T1.7** `shared/ipc.ts` — contratos `task:*` + esquemas Zod v4 + uniones discriminadas
- [x] **T1.8** `main/ipc/tasks.ts` — registro, validación Zod, `AppError`→`AppErrorDto`
- [x] **T1.9** `src/preload/index.ts` + `index.d.ts` — extender `window.taskDiary.tasks`
- [x] **T1.10** Tests de dominio, migraciones, repositorio y frontera IPC sobre `:memory:`
- [x] **T1.11** Verificación completa + `scripts/fase1-smoke.mjs` (37 checks por CDP)
- [x] **T1.12** Commit de work unit + actualizar `PLAN_IMPLEMENTACION.md` §3 y §7

## Bugs encontrados por los tests (corregidos en el código, no en las expectativas)

Cinco fallos reales que aparecieron al escribir los tests. Se documentan porque el patrón
—**el test falla, y la culpa casi nunca es del test**— se repite en cada fase.

| # | Qué pasó | Por qué era un bug de verdad |
| --- | --- | --- |
| 1 | `updated_at` se bumpeaba **siempre** | `updatedAt: now` entraba en el diff antes de saber si había cambio, así que todo update escribía. Un guardado sin cambios reescribía la fila y "última modificación" no significaba nada en el heatmap. **Arreglo:** el sello va *después* de comprobar que hay diff |
| 2 | `clockToMinutes('08:60')` devolvía 540 | `8*60+60 = 540` es un minuto-de-día perfectamente válido, así que la hora malformada se reinterpretaba silenciosamente como 09:00. **Arreglo:** minutos y segundos se validan contra su propio rango, no solo a través del total |
| 3 | `guard()` devolvía el `AppErrorDto` **suelto** | El contrato declara uniones discriminadas `{ok: true, …} \| {ok: false, error}`, pero la mitad de fallo no tenía `ok`. El renderer no podía ramificar sin un `code in result`. **Lo detectó el smoke, no los tests de Node** — que llamaban al handler directamente y nunca veían la forma del cable |
| 4 | `last_insert_rowid()` usado como si fuera el UUID | Devuelve el rowid entero, no el id de texto. Habría devuelto la tarea equivocada sin fallar |
| 5 | `done → cancelled → pending` esquivaba la transición prohibida | `done → pending` estaba rechazada "para no reescribir la historia", pero el paso intermedio la rodeaba. Una ruta de dos pasos hacia un estado prohibido no es una restricción, es un comentario. **Arreglo:** `done` es terminal de verdad (ADR-014) |

## Agujeros de validación encontrados por la revisión del pre-commit

La revisión automática del hook列出 seis observaciones. Cinco eran reales, y dos eran
**agujeros por los que una tarea inválida llegaba a la base de datos**. Ninguno lo detectó
`npm run test`: los tests de Node llamaban al repositorio directamente y nunca componían
un update parcial sobre una fila ya guardada.

| # | Agujero | Por qué importa | Arreglo |
| --- | --- | --- | --- |
| 1 | `assertTimeRange` solo se llamaba en el IPC **si el payload traía ambos extremos** | Una tarea con `startMin: 600` almacenado podía recibir un update con solo `endMin: 300` y quedaba **10:00 → 05:00** en la base de datos. El límite no puede vivir en el borde: la capa que valida no ve el valor guardado | Se valida el rango **fusionado** en `TasksRepository.update`, que es el único que ve ambos extremos. El chequeo del IPC se queda como rechazo temprano |
| 2 | Un update que enviaba solo `rruleDays` **se saltaba** la validación de recurrencia | La condición era `rruleFreq !== undefined`, y cambiar la lista de días cambia la regla igual | Se revalida cuando llega **cualquier** campo `rrule*`, y **fusionado con la regla almacenada** antes de validar. Antes de arreglarlo, `content as RecurrenceInput` pasaba un objeto parcial: `rruleInterval` llegaba `undefined` y el validador fallaba por un motivo que no tenía que ver con el cambio |
| 3 | `COLUMN_BY_FIELD`, `WRITABLE_FIELDS` y `writableKeys` eran **tres listas** a mano | El comentario afirmaba que "no pueden divergir" y era falso: añadir un campo a `Task` compilaba limpio y quedaba sin escribir | `WRITABLE_TASK_FIELDS` en `core/task.ts` es la lista de dominio; `COLUMN_BY_FIELD` es un `Record` **total** sobre ella, así que olvidar una columna es error de compilación |
| 4 | `MAX_TITLE_LENGTH` valía 200 en el dominio y `.max(500)` en Zod | Dos fuentes de verdad **ya discrepaban**: un título de 300 caracteres pasaba Zod y lo rechazaba el dominio | Los límites se declaran una vez en `src/shared/ipc.ts`. `core/` importa de `shared/`, que es la dirección permitida — la inversa arrastraría el dominio al bundle del preload |
| 5 | `export type { AppErrorDetails, ListTasksRequest }` sin nadie que lo importara | Ruido | Eliminado |

Los casts `as TaskStatus` / `as RruleFreq` de `toTask` se conservan: los `CHECK` del esquema
lo garantizan. Se documentó el vínculo en el JSDoc, porque a un revisor le parecen sin
verificar.

## Checks ejecutados

| Check | Resultado |
| --- | --- |
| `npm run format:check` | ✅ 0 |
| `npm run lint` | ✅ 0 |
| `npm run typecheck` | ✅ 0 |
| `npm run test` | ✅ 5 archivos, **126 tests** |
| `npm run build` | ✅ main 8.63 kB · preload 195.14 kB · renderer 646.70 kB |
| `npm run smoke` | ✅ **37/37 checks** en el build real vía CDP |

Detalle del smoke (`scripts/fase1-smoke.mjs`, 37 checks contra el build de producción):

- `window.taskDiary.tasks` expuesto; `require`/`process`/`Buffer`/`module` ausentes;
  `window.electron` ausente en producción.
- Probe: `ok`, `schemaVersion === 1`, `hasTasksTable === true`.
- CRUD completo con normalización: título recortado y colapsado, `task_date` como cadena
  local, minutos como enteros, `completed_at` nulo al crear, update que solo toca lo enviado.
- Rechazos: fecha inexistente (`2026-02-30` pasa el regex de Zod y lo caza `core/`), título
  vacío, `endMin <= startMin` — los tres con `AppErrorDto` en español y **la BD sin tocar**
  (`rows=1` antes y después).
- Regla de foco: segunda tarea `in_progress` del mismo día rechazada con `FOCUS_ALREADY_SET`
  nombrando la tarea que ya lo tiene.
- `done` terminal: ni `done → pending` ni `done → cancelled` pasan.
- Ninguna ruta absoluta ni stack trace cruza el puente.

## Progreso

| Tarea | Estado |
| --- | --- |
| T1.1–T1.12 | ✅ completadas |

## Próximo paso

Fase 2 · Vista Día — `useTasks` con caché e invalidación por IPC, `TitleBar`, `TaskList` +
`TaskRow`, `TaskForm` en modal, cronómetro en vivo, menú nativo con atajos globales.

La primera decisión de Fase 2 ya está forzada por el diseño: el canal `task:setStatus` se
registró en Fase 1, así que la regla de foco ya es comprobable desde el renderer.

## Criterios de aceptación (§3, Fase 1)

1. Un payload IPC mal formado (fecha inválida, título vacío) se rechaza en el main y **la
   base de datos no se toca**.
2. `task_date` se persiste como cadena local; `start_min`/`end_min` como enteros.
3. Las migraciones pendientes se aplican dentro de una transacción al abrir.

## Checks aplicables

```bash
npm ls typescript vite electron-vite @vitejs/plugin-react   # sin invalid/extraneous
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Verificación funcional adicional (no sustituye a los checks anteriores): `npm run smoke`
compila y lanza el build de producción con `--remote-debugging-port`, y por CDP invoca los
seis canales sobre la base real, comprueba que un payload inválido devuelve `AppErrorDto` sin
que la tabla cambie, y verifica que `require` sigue sin existir en el renderer.