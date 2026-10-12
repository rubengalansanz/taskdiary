# Fase 5 · Recurrencia, estadísticas e import/export

## Objetivo

Cerrar el MVP: tareas recurrentes que aparecen solas en su día, una vista de estadísticas que
responda "¿cómo voy?", y un ciclo exportar → importar que devuelva exactamente lo que se
sacò.

## Problema

Las Fases 1–4 dejaron el almacenamiento y las tres lecturas del pasado. Falta lo que convierte
un registro en un diario: la serie que se repite sin que nadie laTecree 200 veces, el número
que dice si la semana fue buena, y la posibilidad de sacar los datos antes de perder el disco.

## Qué ya estaba hecho y no se reimplementa

El plan pide "Canal `day:summary` y `stats:summary` + `DaySummaryDto`". **`DaySummaryDto` y el
resumen por día ya existen desde la Fase 4**, como `task:summaryRange` y
`TasksRepository.summarizeRange()`. Se marcan cumplidos. Lo que sí falta para las
Estadísticas es un agregado distinto: racha, media y totales, que no son "una fila por día".

## Decisiones derivadas

### D1 · La materialización ocurre dentro de `listByDate`

El plan dice "al abrir cada día". La lectura de un día es la operación que el usuario dispara
al abrir un día, y meter la materialización dentro de ella es lo que garantiza que la lista y
el agregado coincidan.

La alternativa —un canal aparte que el renderer tendría que acordarse de llamar— deja una
ventana en la que la vista Semana cuenta una serie que la vista Día aún no materializó, y el
balance y las columnas se contradicen. Un GET que escribe es inusual en HTTP; en una base de
datos local de un solo usuario, con la escritura en una transacción y el índice único detrás,
es el reparto correcto entre rareza y consistencia.

La repetición del propio GET es idempotente por construcción: la segunda pasada no encuentra
nada que insertar porque el índice `idx_tasks_occurrence` ya tiene la fila.

### D2 · Las ocurrencias nacen `pending`, nunca `done`

Una serie materializada no se completó sola. Copiar el estado de la fila de la serie haría que
el heatmap marcara en verde días que nadie trabajó, y `done` es terminal (ADR-014): una
ocurrencia marcada `done` no admitiría nunca el trabajo real de ese día.

### D3 · El JSON es el único ciclo cerrado; el Markdown es para ojos humanos

El criterio "exportar a Markdown → reimportar JSON → mismos datos" se lee como dos formatos
con dos papeles, no como una conversión entre ellos: **exporta** a Markdown y JSON, **importa**
desde JSON y CSV. El JSON conserva cada campo con su tipo y es lo que vuelve dentro. El
Markdown es para leer y archivar; el CSV es entrada, para lo que venga de otra herramienta.

Reimportar un Markdown no tiene sentido: es una proyección de los datos, no una fuente.

### D4 · Un import inválido no toca la base de datos

Se valida el archivo entero ANTES de abrir la transacción de escritura. Si una sola tarea
falla, no se inserta ninguna. Y todo lo que sí se inserta, se inserta en una sola
transacción. La razón es la misma que motivó la transacción en `update()`: tres mitades
escritas dejan datos que nadie nota hasta que son caros.

## Alcance

### Dentro
- `core/recurrence.ts`: motor puro, sin base de datos ni Electron.
- Materialización perezosa en `listByDate`, en transacción.
- `stats:summary`: racha actual, racha máxima, completadas hoy, media semanal, tiempo total y
  % de cumplimiento de estimaciones.
- Vista de Estadísticas con tarjetas y un gráfico.
- Exportar a Markdown y JSON con `dialog.showSaveDialog`.
- Importar desde JSON y CSV con `dialog.showOpenDialog`.

### Fuera
- Copias de seguridad automáticas en `userData/backups/` (§15.4): es infraestructura de
  despliegue, no parte del ciclo exportar/importar.
- Reordenación, undo, paleta de comandos (Fase 6).
- Notificaciones nativas (RF-13, `Could`).

## Tareas

### T5.1 · Motor de recurrencia
- [x] `core/recurrence.ts` puro: `occursOn(series, date)`.
- [x] `daily`, `weekly` con días concretos, `monthly`, `weekdays`.
- [x] `interval` respetado en cada frecuencia.
- [x] `until` en el pasado → ninguna ocurrencia futura.
- [x] Una serie `none` nunca ocurre.

### T5.2 · Materialización perezosa
- [x] `materializeDay()` en una transacción.
- [x] Idempotente: el índice único `(rrule_from, task_date)` cierra la carrera.
- [x] Invocada desde `listByDate`.
- [x] Las ocurrencias heredan título, notas, horas, estimación y etiquetas de la serie.

### T5.3 · Estadísticas
- [x] `stats:summary` en SQL, no en el renderer.
- [x] Racha actual y máxima, completadas hoy, media semanal, tiempo total, cumplimiento.
- [x] Sin `completed_min`: el tiempo total sale de `completed_at - started_at`.

### T5.4 · Vista de Estadísticas
- [x] Tarjetas + gráfico semanal.
- [x] Ruta `/stats`.

### T5.5 · Exportar
- [x] JSON con cada campo y su tipo.
- [x] Markdown legible.
- [x] `dialog.showSaveDialog` en el main; el renderer nunca toca el disco.

### T5.6 · Importar
- [x] JSON y CSV.
- [x] Validación completa antes de escribir.
- [x] Una sola transacción; un fallo no deja nada a medias.

## Criterios de aceptación

1. Una tarea recurrente semanal aparece en el día correcto, **exactamente una vez por día**.
2. Una serie con `until` en el pasado no genera ocurrencias futuras.
3. Exportar a JSON y reimportar devuelve los mismos datos.
4. Importar un JSON inválido da un error claro **sin corromper la base de datos**.
5. El índice único `(rrule_from, task_date)` más la transacción evitan ocurrencias duplicadas.

## Comprobaciones aplicables

- `npm run verify`.
- `node scripts/fase5-smoke.mjs` — los cinco criterios sobre la app real vía CDP.
- Tests de `core/recurrence.ts` que fallen si el motor acepta un rango que no le pertenece.
- Test de import que falle si una importación parcial deja filas escritas.

## Estado

**Completa.** 427 tests, smoke de Fase 5 **21/21**, sin regresión en las Fases 1–4
(37/37 · 30/30 · 40/40 · 30/30).

### Los cinco criterios

1. **Serie semanal, exactamente una vez por día.** El smoke lee un día vence ocho veces y
   obtiene `[1,1,1,1,1,1,1,1]`.
2. **`until` en el pasado.** La serie produce su último día y ninguno después.
3. **Exportar y reimportar.** Cubierto por `transfer-roundtrip.test.ts` (13 casos), que
   compara campo a campo contra una base nueva. El diálogo nativo no se puede automatizar por
   CDP, y el smoke comprueba lo que sí se puede: que el canal rechaza un payload inválido y
   el diario queda intacto.
4. **JSON inválido sin corromper.** Una fila mala de nueve importa cero. El parser rechaza
   antes de abrir la transacción; `importMany` envuelve el lote en una sola.
5. **Duplicados.** El índice único sobre `(series_id, task_date)` rechaza la segunda fila.

### Migración `0004`, y por qué hacía falta

`0001` indexaba de forma única `(rrule_from, task_date)`. `rrule_from` es una **fecha**, y una
fecha no identifica una serie: dos tareas recurrentes creadas el mismo día compartían origen y
la segunda moría con `UNIQUE constraint failed`. Crear «Standup» y «Gimnasio» como series
diarias — el uso más ordinario que tiene la función — era imposible. Lo encontró el hook de
revisión bloqueando el commit mientras aún lo comprobaba.

### Tres decisiones que el plan no tomaba

- **El "real" de las Estadísticas no necesita columna**: sale de `completed_at - started_at`,
  igual que en la Fase 4.
- **La racha se cuenta hacia atrás desde hoy.** Medir desde el último día completado daría 0
  cada mañana, y ese número existe justo para mirarlo por la mañana.
- **La barra semanal tiene siete días, no los transcurridos.** Un gráfico que crece una
  columna al día cambia de ancho bajo el lector.

### Bugs encontrados en la fase

Diez, ocho de ellos míos y tres por el hook de revisión: el `writeUpdate` que reventaba al
editar los días de una serie; la fusión con `??` que impedía borrar una lista de días; el
índice de `0001` que hacía imposible tener dos series el mismo día; el lector CSV lanzando en
lugar de rechazar; `rruleInterval` sin validar y `Number('abc')` pasando como `NaN`;
`parseWeekdays` descartando en silencio lo que no entendía; `setState` síncrono en un efecto;
el gráfico semanal de ancho variable; y tres aserciones mías que construían ficheros o tareas
imposibles y luego fallaban por la razón equivocada.

### Fuera de alcance

Copias de seguridad automáticas en `userData/backups/` (§15.4): es infraestructura de
despliegue. Reordenación, undo, paleta de comandos y notificaciones son Fase 6.
