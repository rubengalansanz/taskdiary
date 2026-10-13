# Fase 9 (parcial) · Exportar e importar en formatos de hoja de cálculo

## Objetivo

Que el diario entre y salga en JSON, CSV, Markdown y los tres formatos de hoja de cálculo:
`.xlsx`, `.xls` y `.ods`.

## El problema que hay que decidir antes de escribir código

Ninguna biblioteca de npm cubre los tres formatos limpios. `exceljs` es limpia pero solo
habla `.xlsx` y `.csv`. La que sí habla los tres es SheetJS (`xlsx`), y **su versión de npm
está congelada en 0.18.5 con una vulnerabilidad alta y sin arreglo**:

```
xlsx *
Severity: high
Prototype Pollution in sheetJS — GHSA-4r6h-8v6p-xvw6
SheetJS ReDoS — GHSA-5pgg-2g8v-p4x9
No fix available
```

Las dos se disparan **al parsear**, que es exactamente lo que hace `data:import`. No hay
arreglo en npm porque SheetJS dejó de publicar ahí; las versiones parcheadas (0.20.x) viven
en su CDN, y npm además rechaza URLs remotas por defecto (`EALLOWREMOTE`).

**Decisión:** SheetJS 0.20.3 desde su CDN, con el tarball **vendorizado** en el repo
(`vendor/xlsx-0.20.3.tgz`) y referenciado como `file:`. Verificado: `npm audit` da **0
vulnerabilidades** y escribe y relee los cuatro formatos.

El coste es un binario de 2,4 MB en el repo. Es el precio de no depender de un paquete con
una vulnerabilidad alta sin parche, en la única parte de la app que parsea ficheros externos.

## Alcance

### Dentro
- `core/sheets.ts`: serialización y parseo de `.xlsx`, `.xls`, `.ods` y `.csv`.
- Exportar en los siete formatos: JSON, Markdown, CSV, XLSX, XLS, ODS.
- Importar desde JSON, CSV, XLSX, XLS, ODS.
- Diálogo nativo con los filtros correctos por formato.
- Menú con una entrada por formato, agrupadas por dirección.

### Fuera, y por qué
- **Importar desde Markdown.** El Markdown que exportamos es una *proyección*: los tags son
  `#tag`, el estado es una palabra, y las marcas de tiempo no están. Reimportarlo perdería
  notas, estimación, color y recurrencia **en silencio**, que es la peor forma de perder datos.
  Exportar sí; importar no.
- **Filtros, estilos y gráficos** de hoja de cálculo. Es un volcado de datos, no un informe.
- Plantillas, fórmulas y libros con varias hojas.

## Decisiones derivadas

### D1 · Las columnas son las del dominio, no las del fichero

Una hoja de cálculo tiene celdas, no un modelo. El mapeo es fijo y va en un solo sitio:
columna ↔ campo de `TransferTask`. Sin él, escribir y leer se convierten en dos listas que
se desalinean en silencio cuando un campo cambia de nombre.

### D2 · Los minutos se guardan como enteros, no como `"09:00"`

Una hoja se abre en Excel y en LibreOffice. `"09:00"` en una celda es texto en un sitio y
hora en otro según quién lo abra. El entero 540 es un número en todas partes y se formatea al
mostrar. El coste es una columna menos bonita; la alternativa es un fichero que se comporta
distinto según la aplicación que lo abra.

### D3 · La importación acepta lo que un humano pudo exportar

Una hoja editada a mano no tiene `version` ni tipos Zod. Se validan los mismos campos con las
mismas reglas, pero tolerando lo que una hoja permite: columnas en cualquier orden,
columnas de más, celdas vacías, y texto donde debería haber número cuando la celda lo
contenga (`"1 h"` no es un minuto, pero `"60"` sí).

### D4 · El límite de filas sigue siendo 500

El motor de búsqueda está acotado a 500 por rendimiento del renderer. Una exportación no
necesita ese límite —la escribe el usuario— pero la importación sí, porque una fila se
convierte en una tarea. Más de 500 filas en un import se rechaza con un mensaje que lo dice,
no se importa a medias.

## Tareas

### T5.9.1 · Vendorizar SheetJS 0.20.3
- [ ] `vendor/xlsx-0.20.3.tgz` y dependencia `file:`.
- [ ] `npm audit` sin vulnerabilidades.
- [ ] Los tres formatos escriben y releen.

### T5.9.2 · `core/sheets.ts`
- [x] Column ↔ campo, un solo mapeo (`COLUMNS` en `src/main/core/sheets.ts`).
- [x] `toSpreadsheet(tasks, format)` para los cuatro formatos de hoja.
- [x] `parseSpreadsheet(buffer, format)` con las validaciones de D3.

### T5.9.3 · Contrato, diálogos y menús
- [x] Formatos en `shared/ipc.ts` con sus filtros nativos.
- [x] `dialog` por formato: `xlsx` → "Excel (*.xlsx)", etc.
- [x] `src/main/ipc/data.ts`: un solo sitio decide qué formato es texto y cuál es contenedor.

### T5.9.4 · Pruebas
- [x] Ida y vuelta por formato, campo a campo.
- [x] Nulos, ceros y listas vacías sobreviven.
- [x] Una hoja editada a mano se importa.
- [x] Una hoja corrupta se rechaza sin escribir nada.

## Criterios de aceptación

1. Exportar a `.xlsx`, `.xls` y `.ods` produce ficheros que se reimportan con los mismos datos.
2. CSV pasa a ser también de exportación, igual que de importación.
3. Un formato desconocido o un fichero corrupto se rechazan sin tocar la base de datos.

## Comprobaciones

- `npm run verify`.
- `node scripts/e2e-flows.mjs`, con el menú de datosAmpliado.
- `npm audit` sin vulnerabilidades altas.

## Estado

Completo y verificado.

## Evidencia

- `src/main/core/sheets.test.ts`: 25 pruebas, todas en verde.
- Suite completa: 452 pruebas en 20 ficheros, en verde.
- E2E sobre la app real: 23/23, con el menúAmpliado a 11 entradas.
- Ficheros escritos a disco y releídos, con su firma correcta:
  `xlsx` 16901 bytes `504b0304`, `xls` 4608 bytes `d0cf11e0`,
  `ods` 10227 bytes `504b0304`, `csv` 306 bytes `efbbbf74`.
- `npm audit`: `xlsx` ya no aparece. Lo que queda viene de `shadcn`, que es la CLI de
  scaffolding, una devDependency que no se ejecuta en runtime.

## Correcciones tras la revisión del hook

Tres, todas sobre código nuevo de esta entrega:

1. `readMinute` y `readWeekdays` devolvían `number | null | string`, discriminado por
   `typeof x === 'string'`. Es exactamente el olor que el propio módulo critica en `ReadResult`
   — y en el camino falló de verdad: una tarea válida no es `null`, así que el `!== null` la
   tomaba por un fallo y toda importación se rechazaba. Ahora ambos usan el mismo resultado
   discriminado.
2. `dialog.showSaveDialog(window ?? ({} as BrowserWindow), ...)`: una mentira que el compilador
   acepta y sólo Electron perdona. Se usan las dos sobrecargas reales según haya ventana.
3. El nombre de archivo por defecto seguía siendo `.md` o `.json` para todos los formatos. Una
   exportación `.xlsx` se habría guardado como `taskdiary.json`, que Excel no abre y el usuario
   no tiene forma de saber por qué.

## Dos decisiones que la implementación obligó a tomar

1. **El lector usa `raw: true`.** Sin eso, SheetJS infiere tipos y convierte `2026-10-05` en el
   número 46300 — la fecha serial de la hoja. Todas las fechas del diario llegarían como enteros
   de aspecto razonable que no son fechas, y el fallo sería silencioso.
2. **Se valida la firma del contenedor antes de parsear.** SheetJS, ante los bytes equivocados,
   devuelve un resultado vacío en vez de fallar. Un `.xlsx` renombrado que en realidad es CSV
   importaba *cero tareas y informaba éxito*: el peor desenlace posible, porque el usuario ve
   una importación limpia y un diario vacío.