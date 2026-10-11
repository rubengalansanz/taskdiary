# Fase 4 · Vistas Semana, Mes y Heatmap

## Objetivo

Dar visibilidad completa del pasado y del mes: tres vistas nuevas (Semana, Mes, Heatmap)
alimentadas por una única agregación SQL por día, no por lecturas de filas individuales.

## Problema

Hoy la app solo tiene la vista Día. `plan-tasks-app.md` §10.2 describe cuatro vistas más, y la
Fase 4 del plan es la única que las agrupa. Sin ellas el usuario no puede responder "¿cómo voy
esta semana?" ni "¿qué días昌 trabajo de verdad?", que es el caso de uso UC-4 declarado en §3.1.

## Por qué una agregación y no `task:listRange`

El criterio de aceptación de la fase es explícito: el heatmap se construye con `GROUP BY
task_date` en SQL, "no cargando la tabla entera". Un heatmap de 26 semanas son 182 días. Pedir
las tareas de esos 182 días para contar en el renderer es exactamente lo que la fase prohíbe:
mueve al renderer datos ya agregables y escala con el tamaño de la tarea, no con el del rango.

`task:listRange` existe desde la Fase 1 y sí se usa — pero para lo que le corresponde: pintar las
tareas de la vista Semana. El conteo por día va en SQL.

## Alcance

### Dentro
- Canal `task:summaryRange` con una consulta `GROUP BY task_date`.
- `WeekView` (7 columnas + barra de balance estimado/real por día).
- `MonthView` (celdas con mini-ring de % completadas + punto si hay tareas en curso).
- `Heatmap` (26 semanas, tooltip, clic que salta a ese día).
- Rutas `/week/:date`, `/month/:date`, `/heatmap` y selector de vista.
- Helpers de fecha de semana y mes.

### Fuera
- Recurrencia (Fase 5). Ninguna vista materializa series.
- Estadísticas completas: racha, media, tiempo total (Fase 5, §10.2 última viñeta).
- Reordenar y arrastrar tareas (§10.3). La vista Día tampoco lo tiene; no se adelanta aquí.

## Restricciones

- Migraciones publicadas inmutables. **Ninguna migración nueva**: `estimate_min` (0001) y
  `started_at` (0002) ya bastan para el balance.
- ADR-016: la fecha seleccionada vive en la URL, no en Zustand.
- ADR-017: la caché es un store externo con `useSyncExternalStore`.
- ADR-015: UI y mensajes en español; identificadores y comentarios en inglés.
- ADR-005: contrato IPC en un único fichero con validación Zod.

## Decisiones derivadas

Estas cuatro no estaban escritas. Se derivan de decisiones ya aceptadas y quedan registradas
para poder revisarlas.

### D1 · El "real" es `completed_at - started_at`, sin columna nueva

`docs/plan-tasks-app.md` §10.2 pide "balance estimado/real" y §7.1 define `estimate_min` como
la estimación. Para el real, UC-2 dice que "la app cronometra el tiempo real": el cronómetro ya
existe desde la Fase 2 y se apoya en `started_at` (0002). El tiempo real de una tarea completada
es por tanto la diferencia entre sus dos timestamps. No hace falta `completed_min`.

**Consecuencia honesta:** una tarea completada sin `started_at` —el caso de backfill que la
propia migración 0002 describe— no tiene real medible. No se inventa ni se cuenta como 0: se
reporta en `unmeasuredDone` y la vista lo dice. Es el mismo criterio que 0002 fijó para el
cronómetro ("shows the elapsed time as unknown rather than inventing a value").

### D2 · Las rutas generalizan ADR-016

ADR-016 sitúa la fecha en la URL para Día. No hay razón para que Semana y Mes hagan otra cosa,
así que la fecha viaja también: `/week/:date` muestra la semana que contiene a esa fecha y
`/month/:date` el mes que la contiene. El heatmap **no** lleva fecha porque no tiene selección:
§10.2 lo define como "las últimas 26 semanas", anclado a hoy.

### D3 · El heatmap tiene tres estados, no cuatro

§10.2 da tres: verde = completadas, ámbar = pendientes, gris = sin registro. Una tarea en curso
no completada cae en ámbar (es pendiente de terminar); una cancelada no es trabajo y no cuenta
como registro. `inProgress` se expone igualmente en el DTO porque el punto azul de la vista Mes
sí lo necesita.

### D4 · "Sin parpadeo" significa no vaciar la caché

RNF-03 exige < 100 ms sin parpadeo. La forma de parpadear no es una animación: es poner la vista
en blanco mientras llega el dato. Por eso la caché de rangos, al invalidarse, **conserva el
valor anterior** y sólo lo sustituye cuando el nuevo llega, en vez de volver a `null`.

## Tareas

### T4.1 · Agregación SQL por día
- [x] `summarizeRange(from, to)` en `TasksRepository`.
- [x] Una sola sentencia con `GROUP BY task_date`.
- [x] Rango invertido → `VALIDATION_FAILED`, como `listByRange`.

### T4.2 · Contrato y canal
- [x] `DaySummaryDto` y `task:summaryRange` en `src/shared/ipc.ts`.
- [x] Handler en `src/main/ipc/tasks.ts`, preload exposure, `tasks-api`.

### T4.3 · Tests RED → GREEN
- [x] Agregación por día con el balance estimado/real.
- [x] Tarea sin `started_at` excluida del real, contada en `unmeasuredDone`.
- [x] Rango invertido y rango vacío.
- [x] El heatmap NO carga tareas: la consulta lleva `GROUP BY` y devuelve una fila por día con tareas.

### T4.4 · Helpers de fecha
- [x] `startOfWeek`, `weekDates`, `addMonths`, `startOfMonth`, `monthGrid`.

### T4.5 · `WeekView`
- [x] 7 columnas con las tareas apiladas.
- [x] Barra superior con el balance estimado/real por día.

### T4.6 · `MonthView`
- [x] Calendario convencional.
- [x] Mini-ring con el % de completadas por celda.
- [x] Punto si hay tareas en curso.

### T4.7 · `Heatmap`
- [x] Rejilla de 26 semanas.
- [x] Tooltip con el detalle del día.
- [x] Clic que navega a `/day/:date`.

### T4.8 · Rutas y selector de vista
- [x] `ViewMode` ampliado.
- [x] Rutas nuevas y selector en el shell.

### T4.9 · Verificación y cierre
- [x] `npm run verify` en verde.
- [x] Smoke CDP de los tres criterios de aceptación.
- [x] Actualizar `PLAN_IMPLEMENTACION.md` y la tabla de ADRs.

## Criterios de aceptación

1. El heatmap se construye con `GROUP BY task_date` en SQL, no cargando la tabla entera.
2. Clic en un día del heatmap navega a esa fecha.
3. El cambio de vista o de día no produce parpadeo (RNF-03 < 100 ms).

## Comprobaciones aplicables

- `npm run verify` — format, lint, typecheck y suite completa.
- `node scripts/fase4-smoke.mjs` — los tres criterios sobre la app real vía CDP.
- Test de repositorio que falle si la consulta deja de llevar `GROUP BY`.

## Estado

**Completa.** `task:listRange` (línea 182 del plan) ya existía desde la Fase 1: se marca
cumplida, no se reimplementa. La fase añadió `task:summaryRange`.

### Verificación

- `npm run verify`: 13 ficheros, 274 tests.
- `node scripts/fase4-smoke.mjs`: **30/30** sobre la app real vía CDP.
- Regresión: Fase 1 **37/37**, Fase 2 **30/30**, Fase 3 **40/40**.

Los tres criterios de aceptación, comprobados:

1. **`GROUP BY task_date`, no la tabla entera.** El smoke pide el mismo rango de 182 días por
   los dos caminos: `summaryRange` devuelve 4 filas con 44 tareas dentro; `listRange` devuelve
   las 44 filas. Un día con 40 tareas ocupa 1 fila. El test de repositorio además falla si la
   consulta deja de llevar el `GROUP BY`, porque una vista puede pintar el heatmap correcto
   leyendo cada fila y aun así incumplir el criterio.
2. **Clic en un día del heatmap navega a esa fecha.** `#/heatmap` → celda `2026-10-10` →
   `#/day/2026-10-10`, con la vista Día listando esa day's tareas.
3. **Sin parpadeo.** Una semana con cero trabajo dibuja sus 7 columnas con el balance en `—`,
   no un spinner. El cambio de ruta a semana laid-out se mide en **1 ms**, dentro del < 100 ms
   de RNF-03.

### Desviación

La fase no declara migración nueva. El "real" del balance se deriva de `started_at` +
`completed_at` (ADR-023); el plan no definía cómo calcularlo y añadir `completed_min` habría
duplicado un dato que el cronómetro de la Fase 2 ya guarda.

### Fuera de alcance, pendiente

- Reordenar y arrastrar tareas (§10.3). La vista Día tampoco lo tiene.
- Estadísticas completas: racha, media, tiempo total (Fase 5).