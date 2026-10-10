# Fase 2 · Vista Día

> Feature ODD derivada de `PLAN_IMPLEMENTACION.md` §3 «Fase 2 · Vista Día — 1,5 días».
> Documento maestro: `docs/plan-tasks-app.md` v2.0 (2026-10-08) §10.

## Objetivo

Que abrir la app baste para saber qué se hizo hoy: una línea de tiempo del día, editable,
con navegación por fechas y el atajo de creación que el plan promete (crear la primera
tarea en 3 segundos, UC-1).

## Problema

Tras la Fase 1 hay una base de datos correcta y una ventana que no muestra nada de ella.
El hueco no es «falta pintar filas»: es que **no existe ninguna forma de llegar a los
datos desde la interfaz**, ni de volver desde una escritura.

## Por qué ahora

Es la fase que entrega el 80 % del valor del producto (RF-01 a RF-05). Todo lo demás —
vistas, heatmap, recurrencia — es superficie sobre esta.

## Alcance autorizado

- `useTasks` con caché en memoria e invalidación
- Store Zustand de estado de UI
- Router con la fecha en la URL
- `TitleBar`, `TaskList`, `TaskRow`, `TaskForm`
- Cronómetro en vivo
- Menú nativo con accelerators y atajos

**Fuera de alcance:** etiquetas y búsqueda (Fase 3), vistas Semana/Mes/Heatmap (Fase 4),
recurrencia (Fase 5), arrastrar para reordenar y undo (Fase 6), virtualización (Fase 7).

## Decisiones de diseño

### D1 — La fecha vive en la URL, no en Zustand

El plan se contradice: §8 y §5.2-specified `routes.tsx` con `/day/:date`, mientras §2.6 y
ADR-006 ponen «fecha seleccionada» en Zustand. Ambas cosas no pueden ser verdad.

**Decidido con el usuario (2026-10-10): la fecha va en la URL, el resto en Zustand.**
Resuelve la contradicción en la lectura que ADR-006 sustain: habla de estado *transitorio*,
y la fecha no lo es. Es la razón de ser del producto — «retroceder en el tiempo» — y con la
fecha en la URL el botón atrás del sistema recorre los días sin código adicional.

`HashRouter`, no `BrowserRouter`: la app empaquetada se sirve desde `file://`, donde no hay
servidor que resuelva `/day/2026-10-10`.

### D2 — La caché de tareas es un store externo, no Zustand

`useSyncExternalStore` sobre un `Map` módulo, con `emit()` a los suscriptores.

La versión previa —`useState` + `useEffect` con `setState` síncrono para el acierto de
caché— la marquesina de React rechaza, y con razón: provoca renders en cascada. El
arreglo correcto no era reordenar el efecto sino reconocer que **la caché es estado
externo** (lo es: el dueño es el proceso main) y que React debe suscribirse a ella.

Consecuencia de diseño: `invalidateDate` desde cualquier escritura deja la vista
obsoleta de inmediato, sin `refresh` explícito ni estado duplicado.

### D3 — `started_at` es una migración nueva, no una columna añadida a `0001`

El plan maestro §7.1 no tiene `started_at`, y el cronómetro de esta fase lo necesita:
`updated_at` no sirve, porque editar el título de una tarea en curso reiniciaría el reloj.

`0001_init.sql` está commiteada y pusheada, así que la regla §2.8 manda: **`0002_started_at.sql`**.
Las filas existentes reciben `NULL` — nadie sabe cuándo empezó una tarea que ya estaba en
curso, y el cronómetro muestra `—` en vez de inventar un valor.

El plan maestro §7.1 y §7.3 se corrigieron para que el documento no se contradiga con el
código.

### D4 — Componentes shadcn reales, no stand-ins

El `button` de Fase 0 era un stand-in escrito a mano porque faltaban `@radix-ui/react-slot`,
`class-variance-authority`, `clsx` y `tailwind-merge` — nada de eso estaba en la matriz de
versiones de Fase 0. Un modal de verdad necesita Radix: trampa de foco, `Esc` y roles ARIA.

Se añaden como dependencias fijadas: `radix-ui@1.7.0` (el paquete unificado que genera
shadcn 4.21), `class-variance-authority@0.7.1`, `clsx@2.1.1`, `tailwind-merge@3.7.0`,
`lucide-react@1.55.0`. El `button` stand-in se sustituye por el del registro.

El alias de shadcn pasa de `@renderer/*` (que el CLI no resolvió) al convencional `@/*`.

### D5 — El formulario se resetea montando, no con un efecto

`TaskForm` se monta y desmonta con `key={dialog}:{editingTaskId}`. Su estado se siembra en
los inicializadores de `useState`, no con `setState` dentro de un efecto. El efecto
original pintaba los valores viejos una vez antes de limpiarlos, y la regla de React lo
marca como antipatrón.

### D6 — Un comando, dos disparadores

Los accelerators del menú nativo viven en `Menu` porque disparan aunque el foco esté fuera
de la página. Pero la tabla de comandos es una sola: `keydown` y el push por IPC terminan en
el mismo `runCommand`. Un atajo de teclado y su entrada de menú no pueden divergir porque
son la misma entrada.

`Ctrl+Enter` no está en la tabla global: completar necesita la vista Día, que posee la
escritura y la superficie de error. El comando se anuncia como evento y la vista decide.

## Tareas

- [x] **T2.1** `migrations/0002_started_at.sql` + plan maestro §7.1 y §7.3 corregidos
- [x] **T2.2** `startedAt` en dominio, contrato, repositorio y migraciones + tests
- [x] **T2.3** `shared/api/tasks-api.ts` + caché como store externo (`useSyncExternalStore`)
- [x] **T2.4** `stores/ui-store.ts` (Zustand, sin la fecha)
- [x] **T2.5** `routes/routes.tsx` — `/day/:date` con reparación de URL
- [x] **T2.6** `shell/title-bar.tsx` — navegación, ayer/hoy/mañana, selector de vista
- [x] **T2.7** `features/tasks/task-list.tsx` + `task-row.tsx` con los 4 estados
- [x] **T2.8** `features/tasks/task-form.tsx` — modal con foco en el título
- [x] **T2.9** Cronómetro en vivo por segundo
- [x] **T2.10** Menú nativo con accelerators + atajos `Ctrl+N/Enter/←→/T/Esc`
- [x] **T2.11** Componentes shadcn reales (`dialog`, `input`, `textarea`, `label`, `select`,
      `separator`, `badge`, `button`) y `lib/utils.ts`
- [x] **T2.12** Verificación completa + `scripts/fase2-smoke.mjs` (30 checks por CDP)
- [x] **T2.13** Commit de work unit + `PLAN_IMPLEMENTACION.md` §3 y §7

## Criterios de aceptación (§3, Fase 2)

1. Marcar una segunda tarea como «en curso» → el canal la **rechaza** con error de dominio.
2. `Ctrl+N` abre el formulario con el foco ya en el título.
3. Crear → completar → navegar a ayer → la tarea aparece en el histórico.

## Checks ejecutados

| Check | Resultado |
| --- | --- |
| `npm run format:check` | ✅ 0 |
| `npm run lint` | ✅ 0 |
| `npm run typecheck` | ✅ 0 |
| `npm run test` | ✅ 6 archivos, **156 tests** |
| `npm run build` | ✅ main 45.12 kB · preload 197.08 kB · renderer 1 164.43 kB |
| `npm run smoke` (Fase 1) | ✅ 37/37 |
| `npm run smoke:ui` (Fase 2) | ✅ **30/30** |

## Bugs encontrados durante la fase

| # | Qué | Por qué era un bug |
| --- | --- | --- |
| 1 | `#/day/ayer` **no** se corregía en la URL | `normalizeDateParam` arreglaba lo que se *pintaba* pero no la URL. La app mostraba el día correcto bajo una URL que mentía sobre qué día es, y cada copia de ese enlace repetía el error |
| 2 | El arreglo del #1 **rompió el render** | El `<Navigate>` iba en un early return **antes** de los hooks. React exige los mismos hooks en el mismo orden: el número de hooks cambia cuando el param pasa de válido a malformado y el render se rompe. La decisión se toma arriba, se aplica abajo |
| 3 | `import { cn } from "cn"` del CLI de shadcn **pasaba typecheck** | Existe un `node_modules/cn` como dependencia transitiva. Un import mal escrito resuelve a un paquete sin relación y la puerta de calidad dice que todo bien |
| 4 | `setState` síncrono dentro de un efecto, dos veces | En la caché y en el formulario. Ambos.marked por la regla de React como renders en cascada |
| 5 | Promesas flotantes en los manejadores de `navigate` | `void navigate(...)` en vez de dejar la promesa sin tratar |

## Lo que el smoke de Fase 1 destapó

`npm run smoke` falló con «schema version is 1» después de añadir `0002`. El número estaba
escrito a mano en el script: un literal que meses después habría reportado como rota una
base de datos perfectamente sana. Ahora se cuenta leyendo `migrations/*.sql`.

## Pruebas del renderer

25 tests para `shared/lib/date.ts`: cambios de mes, año y día bisiesto; `daysBetween`
inmune al horario de verano; round-trip de los 1440 minutos del día; reparación de fechas
del URL. Un test estaba mal escrito (el 10 de octubre de 2026 es sábado, no viernes) y lo
corrigió la aserción, no el código.

## Próximo paso

Fase 3 · Etiquetas, búsqueda y filtros — tablas `tags`/`task_tags` ya existen desde
`0001_init.sql`, así que la fase es repositorio + canal + panel de filtros + Fuse.js.