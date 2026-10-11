# Fase 3 · Etiquetas, búsqueda y filtros

> Feature ODD derivada de `PLAN_IMPLEMENTACION.md` §3 «Fase 3 · Etiquetas, búsqueda y filtros — 1 día».
> Documento maestro: `docs/plan-tasks-app.md` v2.0 (2026-10-08) §2.1, §3 RF-06/RF-07, §7, §10.

## Objetivo

Poder encontrar cualquier tarea que se haya hecho alguna vez, y poder quedarte solo con
las que te interesan de un día concreto.

## Problema

Sin esto, la app es un cuaderno: se puede escribir y se puede mirar un día, pero nada
devuelve una tarea del pasado que sabes que existe.

## Por qué ahora

El plan fija aquí el entregable «filtrar y buscar en todo el histórico», y es la última
pieza que hace que el histórico tenga valor antes de las vistas agregadas de las Fases 4-5.

## Alcance autorizado

- Repositorio de etiquetas, canal `tag:list`, `tags` en `TaskDto`
- Búsqueda sobre todo el histórico: `search_text`, canal `task:search`
- Panel lateral con buscador, filtros de estado y de etiqueta, y contador
- Parseo de `#etiqueta` al guardar
- Etiquetas visibles en la fila

**Fuera de alcance:** campo de etiquetas por formulario (se parsing `#etiqueta` y se
muestran; un *chip input* sería un segundo camino a la misma regla), vistas de Fase 4,
import/export de Fase 5, virtualización de Fase 7.

## Contradicción del plan, resuelta con el usuario

El plan se contradice en el alcance de esta fase:

- **Entregable (§3 y maestro §11):** «filtrar y buscar en **todo el histórico**»
- **§14 «Búsqueda acotada»:** «Fuse.js sobre el **rango visible**, no sobre toda la base»

No es teórico: para ignorar acentos en SQL hacen falta dos cosas que no existían —
una columna `search_text` normalizada o cargar el histórico en el renderer, que es
justo lo que §14 prohíbe.

**Decidido con el usuario (2026-10-10): opción B.** Búsqueda real sobre todo el
histórico, con `search_text` normalizada y Fuse.js reordenando el resultado acotado.
Límite de 500 filas. Fuse.js se queda como reordenador — lo justificaba el plan — pero
**no** como filtro: el fuzzy sobre substring ya no aporta y cuesta ordenar 500 elementos.

## Decisiones de diseño

### D1 — `search_text`: una columna derivada, nunca aceptada del llamante

`migrations/0003_search_text.sql` añade `search_text TEXT`, escrita por el repositorio a
partir de título y notas con `buildSearchText`. SQLite `LIKE` ignora mayúsculas ASCII y
nada más; FTS5 no trae un tokenizador que pliegue acentos. Plegar una vez al escribir
convierte ambos problemas en un `LIKE` corriente.

El texto original **no se toca**: los acentos se quedan donde el usuario los escribió, y
las filas existentes se rellenan con `lower()`, que solo pliega ASCII. Esa limitación está
documentada en el propio SQL: una fila con acentos, escrita antes de esta migración,
sigue siendo encontrable por sus palabras sin acento.

### D2 — El total se cuenta aparte de las filas

`task:search` devuelve `total` y `truncated`, no solo las filas. Con el límite en 500, un
contador que dijera «500 resultados» mentiría en cuanto el histórico pasara de eso — y el
criterio de aceptación dice que el contador refleja el resultado.

### D3 — Las etiquetas son OR, no AND

Seleccionar dos etiquetas **amplía** el resultado. Es lo que significa una barra de
filtros, y es la convención que sigue GitHub para etiquetas. Hay un test que lo fija
explícitamente para que un cambio futuro a AND no parezca una mejora.

### D4 — Las reglas de etiqueta viven en `src/shared/tags.ts`

El formulario necesita ejecutar el mismo parser antes de guardar, y no tenía por qué
importar de `src/main/core/`. Las reglas de dominio que necesitan los dos procesos van en
`shared/`; `core/search.ts` se queda solo con lo que existe para dar forma al SQL.

### D5 — Una etiqueta sin usar se conserva, con contador 0

Borrarla haría que reapareciera como duplicado la próxima vez que alguien la escribiera,
y haría que la lista del panel se moviera bajo los dedos del usuario.

## Bugs encontrados durante la fase

| # | Qué | Por qué era un bug |
| --- | --- | --- |
| 1 | **Un update que solo cambia etiquetas no se aplicaba** | Las etiquetas viven en otra tabla, así que `diffTaskForUpdate` devuelve vacío y el atajo de «nada cambió» se las saltaba. Un usuario que quita una etiqueta desde el formulario no veía el cambio. **Arreglo:** las etiquetas se escriben *antes* del atajo, que solo gobierna la fila `tasks` |
| 2 | `foldForSearch` convertía `ñ` en `n` | `\p{Diacritic}` también alcanza el tilde combinante de `ñ`. Dos palabras distintas se volvían iguales — y lo contradecía un comentario escrito dos párrafos más abajo. **Arreglo:** centinela U+0000 antes del pliegue |
| 3 | El parser de `#tag` reconstruía mal el texto | Solo acumulaba los *matches*, así que todo el texto que no era etiqueta desaparecía: «acentos: José» se convertía en cadena vacía. **Arreglo:** recorrer los matches copiando los huecos |
| 4 | `ñ` en un nombre de etiqueta se conservaba pero el resto se plegaba | Consecuencia de (2); el mismo arreglo lo cubre, y ahora hay test de las dos direcciones |
| 5 | **El formulario parseaba las etiquetas y las tiraba a la basura** | `tags` se calculaba, se usaba solo para validar con Zod, y `onSubmit` mandaba el texto crudo sin ellas: `TaskFormValues` no tenía campo `tags`. El resultado es que **nunca se creaba una etiqueta desde la UI**, el panel se quedaba vacío y `#proyecto` se guardaba como título literal — contradiciendo el comentario del propio archivo. **Todos los checks en verde**: el parser tenía tests, el esquema tenía tests, el repositorio tenía tests, y ninguno tocaba la línea que decide qué se guarda |
| 6 | El panel no se enteraba de las etiquetas nuevas | `invalidateTags()` limpiaba la caché y emitía, pero `useTags` no estaba suscrito a los listeners: usaba un `useEffect` de una sola ejecución. Una etiqueta creada desde el formulario no aparecía hasta recargar |
| 7 | `refresh()` de la búsqueda no podía funcionar | Solo mutaba el Map; el efecto que lanza la petición depende de `applied.*`, que no cambian, así que la entrada se quedaba en `LOADING` para siempre. El doc prometía «vuelve a buscar» |
| 9 | Constantes muertas y una unicidad que no existía | `MAX_TAGS_PER_TASK` y `MAX_TAG_NAME_LENGTH` se exportaban sin usarse, mientras los esquemas llevaban literales inline (20 y 40) y `tags.ts` declaraba su propio `MAX_TAG_LENGTH = 40`. El comentario de arriba decía «una lista, unos números»; eran tres. **Arreglo:** `tagNameSchema` importa las constantes reales |
| 10 | **`update()` hacía tres escrituras sin transacción** | Fila, etiquetas y `search_text` eran sentencias independientes: un crash entre ellas dejaba las etiquetas sustituidas y la fila obsoleta. La clase ya exponía `transaction()` y el método que más la necesitaba no la usaba. **Arreglo:** una unidad de trabajo, con test que fuerza el fallo a mitad |
| 11 | **Editar desde resultados de búsqueda abría el formulario en blanco y sobrescribía** | `editingTask` se resolvía contra `tasks` (el día) en vez de contra `visibleTasks`. Con un filtro activo, editar un resultado de otro día daba `null`: el formulario se abría vacío titulado «Nueva tarea», y al guardar llamaba a `updateTask({id: editingTaskId, …})` — **borrando los datos de otra tarea**. **Arreglo:** se resuelve contra lo que está en pantalla, y si el id queda huérfano el guardado se niega en vez de escribir a ciegas |
| 12 | El contador de truncado decía «1200 resultados de más» | Renderizaba la palabra «de más» y tiraba el número que tenía a mano. Ahora dice «mostrando 500» |
| 8 | **Un byte NUL crudo en `src/shared/tags.ts`** | No rompe la ejecución — `/<NUL>/gu` es un regex válido y los tests pasan — pero hace el fichero **binario**: `Read` se niega a abrirlo, `Grep` lo salta, `file` lo marca `octet-stream`, y CodeGraph lo renderiza como `.replace(//gu, 'ñ')`, **idéntico a un comentario**. Cualquiera que «limpiara» ese `//gu` borraría en silencio la protección de la `ñ`. Sustituido por la secuencia `\\u0000` (`scripts/strip-nul-bytes.mjs` deja el escaneo reproducible) |

## Dos cosas que quiero que queden escritas

**El bug 8 no lo detectó ningún check propio.** Typecheck limpio, lint limpio, 228 tests
verdes, 40/40 en el smoke. Lo detectó la revisión del pre-commit. La lección no es «los
checks no sirven» — sirvieron para todo lo demás — sino que **un fichero que las
herramientas no pueden leer no es un fichero auditable**, y eso no lo mide ningún check.

Por eso queda `scripts/strip-nul-bytes.mjs`: dos líneas que barren el árbol y avisan, para
que la próxima vez lo encuentre una orden y no un revisor.

**El hook sigue sin ser una revisión de calidad.** Su único standard es la convención de
CodeGraph, que regula cómo un agente localiza código, no qué contiene un fichero. Que
encuentre un byte NUL es casualidad afortunada: funciona porque grep no ve el fichero y
eso le choca. En la revisión anterior de esta fase encontró, por el mismo mecanismo, el bug
crítico de las etiquetas — tampoco por el standard.

## La lección del bug 5

**Un test que no ejecuta el camino no es cobertura: es confianza falsa.** El bug 5
sobrevivió a 219 tests verdes porque los tests que existen cubrían las piezas —el parser,
el esquema, el repositorio— y ninguna la costura que las une.

Por eso el smoke de esta fase ahora **abre el formulario de verdad**, escribe un título con
`#desde-ui`, guarda, y comprueba que el título guardado no lleva el `#` y que la etiqueta
existe de verdad. Y por eso existe `src/shared/task-form-submit.test.ts`, que fija la
frontera exacta donde falló: lo que se manda a `onSubmit` son los valores parseados, no
las entradas.

## Qué se habría llevado por delante sin esto

Nada de esto lo detectó un check automático propio: lo encontró la revisión del pre-commit
inspeccionando el flujo, no los resultados. El mismo hook cuyo `PASSED` no significa nada
sobre calidad encontró, con grep, un bug que 219 tests no vieron.

## Checks ejecutados

| Check | Resultado |
| --- | --- |
| `npm run format:check` | ✅ 0 |
| `npm run lint` | ✅ 0 |
| `npm run typecheck` | ✅ 0 |
| `npm run test` | ✅ 10 archivos, **228 tests** |
| `npm run build` | ✅ renderer 1 182.99 kB |
| `npm run smoke` (Fase 1) | ✅ 37/37 |
| `npm run smoke:ui` (Fase 2) | ✅ 30/30 |
| `npm run smoke:tags` (Fase 3) | ✅ **40/40** |

## Qué prueba el smoke de Fase 3

Los tres criterios de aceptación, en la app real y sobre la BD real:

- **Acentos y mayúsculas:** `introduccion` encuentra «Introducción práctica»; `INTRODUCCIÓN`
  también; busca en las notas (`maria`); alcanza días que no son hoy (`documentación`).
- **Filtros combinados:** una etiqueta estrecha, dos amplían, el estado filtra, la
  combinación da 2 y la combinación imposible da 0; el límite trunca sin mentir el total.
- **CASCADE:** crear una tarea con etiqueta sube el contador; borrarla lo baja, y la
  etiqueta sobrevive para no reaparecer duplicada.

Más el camino que estaba roto y que el propio smoke sembraba por el puente, sin tocarlo:
abrir el formulario real, escribir un título con `#desde-ui`, guardar, y comprobar que el
título guardado no lleva el `#` y que la etiqueta existe — y que el panel la ve sin
recargar.

Y lo que no se negocia: `require`, `process` y `window.electron` siguen ausentes **después**
de haber ejercitado tres canales distintos y de haber guardado una tarea desde el formulario.

## Limitación conocida

La lista de etiquetas se invalida desde la UI (`invalidateTags`) y ahora el panel se
entera porque está suscrito al store. Una escritura hecha por otro camino — un import de
la Fase 5, o el smoke sembrando por el puente — deja el panel obsoleto hasta recargar. Con
un único usuario y todas las escrituras en la UI es aceptable; si algún día hay otra vía,
hace falta un canal de push del main al renderer en vez de caché.

## Próximo paso

Fase 4 · Vistas Semana, Mes y Heatmap. `task:listRange` ya está en el contrato y en el
repositorio desde la Fase 1; el heatmap necesita `GROUP BY task_date` en SQL, no la tabla
entera.