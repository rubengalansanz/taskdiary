# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
El versionado sigue [SemVer](https://semver.org/lang/es/).

## [No publicado]

Todavía **no hay ninguna etiqueta publicada**. La primera release sale con `git tag v1.0.0`.
Esta sección recoge lo que existe hoy, para que la diferencia con esa release sea legible.

### Añadido

- **Vista Día** con creación, edición y borrado de tareas, cronómetro en vivo de la tarea en
  curso, y el resto de estados (`in_progress`, `done`, `cancelled`).
- **Vista Semana**, con el balance estimado y el real de cada día.
- **Vista Mes**, con un mini-anillo de progreso por día.
- **Heatmap de 26 semanas**, con tooltip y navegación al hacer clic en un día.
- **Vista de Estadísticas**: racha, totales y gráfico semanal.
- **Recurrencias** por regla semanal o diaria, con materialización perezosa al abrir cada día y
  «exactamente una ocurrencia por día» garantizado por índice único y transacción.
- **Búsqueda** sobre todo el histórico, con acentos y mayúsculas, y filtros por etiqueta y estado.
- **Importación y exportación**: JSON, CSV, Markdown, `.xlsx`, `.xls` y `.ods`. Un JSON inválido
  rechaza el archivo entero y no deja la base a medias.
- **Paleta de comandos** (`Ctrl+K`).
- **Deshacer** de 5 segundos tras completar o borrar.
- **Reordenación por arrastre** en la vista Día, persistida.
- **Notificaciones nativas** para tareas con hora.
- **Minimizar a la bandeja** y reaparición desde el icono.
- **Gestos de seguridad** del renderer: `contextIsolation`, `sandbox`, sin `nodeIntegration`, CSP,
  ventanas nuevas y navegación externa bloqueadas, permisos denegados.
- **CI** con tres jobs: lint + tipos + tests, flujos E2E sobre el proceso real, y un smoke por
  fase. **23 flujos** y **163 comprobaciones** de humo en total.
- **`release.yml`**: empaquetado en Windows, macOS y Linux desde una etiqueta, con publicación en
  GitHub Releases y comprobación de que el feed de actualizaciones existe.
- **Actualizaciones automáticas** (`electron-updater`), alcanzables desde el menú y la paleta.
  No descargan nada sin que se pidan.

### Corregido

- Un **icono del tray que no aparecía en el build empaquetado**: `asarUnpack` deja el icono fuera
  del archivo y la ruta resuelta apuntaba dentro. Era un fallo previo a la Fase 9 y fallaba en
  silencio.
- **La persistencia nunca se había verificado**: todos los tests de repositorio corrían sobre una
  base en memoria, que por definición no sobrevive a nada, y uno de ellos abría una segunda base
  en memoria y lo llamaba persistencia.
- Un **instalador de 104 MB que no arrancaba**: el allowlist de empaquetado excluiría las
  dependencias que la app necesita.
- **El instalador pesa 125,10 MB** contra un objetivo de 100, por 55 MB de dependencias que solo
  usa el renderer y que iban dentro del artefacto. Medido hoy: **101,95 MB**.

### Rendimiento

Medido sobre la app real, no estimado. Objetivo entre paréntesis.

|                                        | Medido          |
| -------------------------------------- | --------------- |
| Arranque en frío hasta ventana visible | 1846 ms (3000)  |
| `Ctrl+N` hasta el campo de título      | 31,3 ms (120)   |
| Enviar hasta la fila nueva en pantalla | 31,2 ms (120)   |
| Cambio de día                          | 21,9 ms (100)   |
| Cambio de vista                        | 23,9 ms (100)   |
| RAM en reposo, memoria privada         | 118,2 MB (250)  |
| Instalador comprimido                  | 101,95 MB (100) |

### Cobertura de tests

`92,45 %` global; `core/` al `90,70 %` y `db/` al `89,65 %`, los dos umbrales que pedía el plan.
568 tests en 31 archivos.

### Sin publicar todavía, y dicho explícitamente

- **Copias de seguridad automáticas.** El plan las contempla; no están implementadas.
- **Firma de binarios.** Sin ella, macOS avisa en el primer arranque y el auto-updater rechaza la
  actualización. Es el comportamiento correcto, no un fallo.
- **Checklist de release sin rellenar.** La matriz SO × vista × tema necesita una persona y una
  máquina por sistema.
