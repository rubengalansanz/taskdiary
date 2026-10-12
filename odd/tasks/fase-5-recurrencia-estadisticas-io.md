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
- [ ] `core/recurrence.ts` puro: `occursOn(series, date)`.
- [ ] `daily`, `weekly` con días concretos, `monthly`, `weekdays`.
- [ ] `interval` respetado en cada frecuencia.
- [ ] `until` en el pasado → ninguna ocurrencia futura.
- [ ] Una serie `none` nunca ocurre.

### T5.2 · Materialización perezosa
- [ ] `materializeDay()` en una transacción.
- [ ] Idempotente: el índice único `(rrule_from, task_date)` cierra la carrera.
- [ ] Invocada desde `listByDate`.
- [ ] Las ocurrencias heredan título, notas, horas, estimación y etiquetas de la serie.

### T5.3 · Estadísticas
- [ ] `stats:summary` en SQL, no en el renderer.
- [ ] Racha actual y máxima, completadas hoy, media semanal, tiempo total, cumplimiento.
- [ ] Sin `completed_min`: el tiempo total sale de `completed_at - started_at`.

### T5.4 · Vista de Estadísticas
- [ ] Tarjetas + gráfico semanal.
- [ ] Ruta `/stats`.

### T5.5 · Exportar
- [ ] JSON con cada campo y su tipo.
- [ ] Markdown legible.
- [ ] `dialog.showSaveDialog` en el main; el renderer nunca toca el disco.

### T5.6 · Importar
- [ ] JSON y CSV.
- [ ] Validación completa antes de escribir.
- [ ] Una sola transacción; un fallo no deja nada a medias.

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

En curso.
