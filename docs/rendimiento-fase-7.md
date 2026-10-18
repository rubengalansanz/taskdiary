# Fase 7 · Medición de los RNF

Medición de los cinco requisitos no funcionales que el plan pone como entregable de la Fase 7
(`PLAN_IMPLEMENTACION.md` §3: «cumple RNF-01 a RNF-05»). Hasta ahora ninguna se había observado
una sola vez: la tabla de aceptación eran cinco objetivos sin un número detrás.

**Cómo reproducir:** `npm run build:renderer` no hace falta — el script empaqueta él mismo.
Con el bundle construido (`npx electron-vite build`):

```bash
node scripts/fase7-perf.mjs
```

Tarda unos seis minutos, de los cuales cuatro son el instalador. Necesita red para descargar
NSIS; sin ella, RNF-04 sale «sin medir» en vez de inventarse un número.

**Entorno de esta corrida:** Windows 11 x64 · Node v24.18.0 · Electron 44.7.0 · perfil temporal
desechable. No es una máquina limpia y no pretende serlo: los números absolutos son de esta
máquina, y la metodología es lo que hace comparables las corridas.

---

## Resultado

| RNF | Métrica | Objetivo | Medido | |
| --- | --- | --- | --- | --- |
| RNF-01 | Arranque en frío hasta ventana visible | ≤ 3000 ms | **1846 ms** (mediana de 3) | Cumple |
| RNF-02 | `Ctrl+N` hasta el campo de título | ≤ 120 ms | **31,3 ms** | Cumple |
| RNF-02 | Enviar hasta la fila nueva en pantalla | ≤ 120 ms | **31,2 ms** (mediana de 5) | Cumple |
| RNF-03 | Cambio de día hasta el frame asentado | ≤ 100 ms | **21,9 ms** | Cumple |
| RNF-03 | Cambio de vista hasta el frame asentado | ≤ 100 ms | **23,9 ms** | Cumple |
| RNF-03 | Sin parpadeo al cambiar de día | 0 frames | **0 frames** | Cumple |
| RNF-04 | Tamaño del instalador comprimido | ≤ 100 MB | **125,1 MB** | **No cumple** |
| RNF-05 | RAM en reposo | ≤ 250 MB | **118,2 MB** (privada) | Cumple |

Siete de ocho. Un solo requisito falla de verdad, y no es de rendimiento puro.

---

## El fallo

### RNF-04 · El instalador pesa 125,1 MB y el objetivo son 100

La causa está localizada y no es el código:

| Pieza | Sin comprimir |
| --- | --- |
| `taskdiary.exe` (Electron) | 235 MB |
| `resources/` completo | 108 MB |
| └ `app.asar` | **81,0 MB** |
| `locales/` (49 MB, uno por idioma) | 49 MB |

**El `app.asar` pesa 81 MB para una aplicación cuyo bundle de renderer son 1,37 MB.** La causa
no es el código: el allowlist `files` de `electron-builder.yml` excluye `src/*` y unos pocos
ficheros, pero no las devDependencies, así que `@types/*`, `electron` y dependencias de
desarrollo viajan dentro del archivo. El propio `electron-builder` lo dice en su salida, en una
línea que dice «duplicate dependency references» y lista `@types/react@19.3.0` seis veces.

Los dos controles que quedan son de la Fase 9, no de esta: un `files` que excluya
`devDependencies` y `electronLanguages` para podar los 49 MB de locales que nadie va a usar.

---

## Lo que el script NO mide, y por qué

Un número sin método al lado es una cifra elegida. Estas son las cuatro cosas que este
informe **no** cubre:

1. **El atajo de enviar.** `CmdOrCtrl+Return` es un acelerador de **menú nativo**: lo resuelve
   el proceso del navegador antes de que el renderer vea la tecla, así que CDP no lo puede
   pulsar. El script despacha el evento `submit` del formulario, que es el handler al que
   acaba llegando ese ítem de menú. Queda fuera el salto SO → menú.
2. **Los eventos de teclado son sintéticos** (`isTrusted: false`). A React le da igual, pero una
   pulsación real arrastra además unos milisegundos de latencia de entrega: esta cifra va
   sistemáticamente **por debajo** de lo que siente el usuario.
3. **El arranque es una cota superior.** Se mide desde justo antes del `spawn` hasta que la barra
   de título está en el documento, así que incluye el arranque del proceso, Node, Chromium, el
   ida y vuelta del puente de tema, el montaje de React y el primer pintado. El momento en que
   el usuario ve la ventana es anterior.
4. **El arranque se mide tres veces y se informa la mediana.** Una sola medida en una máquina de
   desarrollo es ruido: Defender, un disco ocupado y la caché caliente lo mueven cientos de
   milisegundos en cualquier dirección. Las tres de esta corrida: 2121 · 1899 · 1764 ms.

Y una decisión de diseño: **el script no sale con código de error por un RNF incumplido**, solo
si la medición no se pudo ejecutar. Un portátil saturado falla estos números por motivos que no
tienen que ver con la app, y una comprobación que se pone roja por eso enseña a ignorar las
verdes. Es el mismo argumento por el que los flujos van por CDP en vez de Playwright.

---

## Cuatro instrumentalidades que este trabajo encontró

La mitad del valor de este informe está en lo que el script **dio por bueno y era falso**. Las
cuatro se corrigieron antes de escribir una línea de conclusión, y las cuatro son el tipo de
error que sobrevive porque el número que produce parece normal.

**1. Sumar el working set entre procesos cuenta las páginas compartidas N veces.**
La primera versión summed `WorkingSetSize` del árbol entero de procesos y dio **444 MB** contra
un presupuesto de 250 MB: un fallo del 78 % que habría mandado la fase entera a optimizar
memoria. La app usa **118 MB**. Chromium comparte sus DLL, sus fuentes y parte grande de sus
arenas de reserva entre los cuatro procesos, y el working set suma las páginas compartidas
una vez por proceso. Aquí la misma corrida da 445 MB de working set contra 118 MB privado. El
RNF se responde con memoria privada (`WorkingSetPrivate` en Windows, PSS en `/proc/*/smaps_rollup`
en Linux).

**2. `ConvertTo-Csv` entrecomilla los valores, y `Number('"92"')` es `NaN`.**
Un `Map` indexado por `NaN` no encuentra nada, así que el árbol de procesos salía vacío y el
script informaba **0,0 MB** con un PASS cómodo. Un instrumento que reporta 0 con confianza es
peor que uno que no mide. Ahora, si el árbol no encuentra ni el proceso raíz, el script falla en
vez de inventarse un número.

**3. Una referencia a un nodo de React sobrevive al unmount, y el resultado parece un bug.**
El cambio de vista daba 5007 ms — un timeout clean — cuando la app lo hace en dos frames. Al
cambiar de vista, la barra de título deja de pintar los botones del día, eso desplaza al
selector de vistas dentro del árbol, y React lo remonta: el nodo que la sonda tenía guardado
quedaba huérfano con su `aria-pressed` viejo. **La app funcionaba; la sonda mentía.** La sonda
ahora vuelve a consultar el nodo en cada frame.

**4. Contar muestras en `requestAnimationFrame` cuenta el estado previo al pintado.**
La sonda de parpadeo marcaba las filas del día saliente y contaba cuántas muestras las
encontraban. Dio **1 frame con filas del día anterior**, y el plan llegó a registrar un defecto
que no existía. La verdad es que `requestAnimationFrame` se ejecuta **antes** de pintar: la
primera muestra tras un clic siempre ve el DOM tal como estaba antes del commit, que es el
estado previo a la pintura y no un frame que nadie llegara a ver. Tres corridas adicionales
dieron **cero** frames seguidos. Lo que cuenta no es cuántas muestras salieron así, sino
la **racha más larga de muestras consecutivas** con las filas viejas: dos seguidas significan
que el contenido sobrevivió a un límite de frame, que es un parpadeo; una no. El defecto que
casi se reporta era, irónicamente, un artefacto de la medición del defecto.

---

## Qué decide esto sobre el resto de la Fase 7

La fase pedía dos optimizaciones más. Con estos números, ninguna se justifica:

| Pedido por el plan | Lo que dice la medición |
| --- | --- |
| Virtualización de listas de más de 100 elementos | El cambio de día con 30 filas cuesta 21,9 ms, poco más de un quinto del presupuesto. El coste no está en el número de filas. |
| Lazy-loading de vistas pesadas | El arranque completa en 1846 ms con 1154 ms de margen, y el cambio de vista en 23,9 ms. El bundle del renderer son 1,37 MB. |

Ninguna de las dos se construye **por ahora**. Se anotan en el documento de fase como
disponibles, con el número que las justifies, para que la decisión se pueda revisar si el
volumen de un día cambia.

Lo que sí queda por hacer en la fase: los planos de consulta (`EXPLAIN QUERY PLAN`), que es
trabajo cierto y verificable, y corregir el plan y la CI, que hoy mienten o se rompen solos.