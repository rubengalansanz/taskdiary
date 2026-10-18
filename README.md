# TaskDiary

Un diario de escritorio, offline, para registrar tareas por día y mirar atrás. Sin cuenta, sin
nube, sin sincronización: el archivo SQLite vive en tu máquina y solo tú decides qué pasa con él.

El objetivo con el que se construyó, del `PLAN_IMPLEMENTACION.md` §0: **abrir la app y, en menos
de 3 segundos, saber qué se hizo hoy, qué queda pendiente y cómo va la semana.**

---

## Instalar

| Plataforma | Artefacto                          | Notas                                                                    |
| ---------- | ---------------------------------- | ------------------------------------------------------------------------ |
| Windows    | `taskdiary-<versión>-setup.exe`    | Instalador. Crea acceso directo en el escritorio                         |
| Windows    | `taskdiary-<versión>-portable.exe` | **Sin instalar nada.** Se ejecuta desde donde esté y se borra su carpeta |
| macOS      | `taskdiary-<versión>.dmg`          | Arrastrar a Aplicaciones                                                 |
| Linux      | `taskdiary-<versión>.AppImage`     | `chmod +x` y doble clic                                                  |
| Linux      | `taskdiary-<versión>.deb`          | Instalación del sistema                                                  |

Se publican con cada etiqueta `v*.*.*` en [GitHub Releases](https://github.com/rubengalansanz/taskdiary/releases).

> **macOS sin firmar.** No hay certificado de desarrollador, así que Gatekeeper avisará la primera
> vez. Abrir con clic derecho → «Abrir». Es lo esperado y no indica un problema.
>
> **La actualización automática necesita firma.** Hasta que el repositorio tenga los secretos de
> publicación, «Buscar actualizaciones» informará de que la versión no está firmada — que es el
> comportamiento correcto, no un fallo.

## Usa la app

**Cinco vistas**, en el selector de la barra superior:

- **Día** — las tareas de una fecha. Crear con `Ctrl+N`, completar y arrastrar para reordenar.
- **Semana** — siete columnas con el balance estimado y el real de cada día.
- **Mes** — el mes entero con un mini-anillo de progreso por día.
- **Actividad** — 26 semanas en una rejilla. Pasa el ratón para el detalle; haz clic en un día
  para ir a él.
- **Estadísticas** — racha, totales y el gráfico semanal.

### Atajos

| Atajo               | Qué hace                                              |
| ------------------- | ----------------------------------------------------- |
| `Ctrl+N`            | Nueva tarea                                           |
| `Ctrl+K`            | Paleta de comandos: busca cualquier acción por nombre |
| `Ctrl+T`            | Ir a hoy                                              |
| `Ctrl+←` / `Ctrl+→` | Día anterior / siguiente                              |
| `Ctrl+Enter`        | Completar la tarea seleccionada                       |
| `Esc`               | Cerrar el diálogo abierto                             |

En macOS, `Cmd` sustituye a `Ctrl`.

### Lo que hace sola

- **Aviso de tareas con hora.** Si una tarea tiene hora asignada, avisa cuando llega. Solo si la
  app está en segundo plano.
- **Minimizar a la bandeja.** Si el sistema tiene bandeja, la ventana se oculta y se vuelve
  desde el icono. Si no la hay, la app se queda en la barra de tareas: es lo correcto, porque
  esconder una ventana sin forma de volver a sacarla sería peor.
- **Deshacer durante 5 segundos** después de completar o borrar.

## Tus datos

### Dónde están

Un solo fichero SQLite, y su ruta es estable:

| SO      | Ruta                                                   |
| ------- | ------------------------------------------------------ |
| Windows | `%APPDATA%\taskdiary\taskdiary.db`                     |
| macOS   | `~/Library/Application Support/taskdiary/taskdiary.db` |
| Linux   | `~/.config/taskdiary/taskdiary.db`                     |

### Copias de seguridad

**No hay copia automática todavía.** El plan la contempla (una diaria, conservando 7) pero no está
implementada, así que no te la vamos a prometer.

Mientras tanto, lo que sí funciona:

1. **Copiar el fichero a mano.** Cerrada la app, copiar `taskdiary.db` es una copia completa.
2. **Exportar desde la app** (menú de datos): `.json`, `.csv`, `.markdown`, `.xlsx`, `.xls` y
   `.ods`. El JSON es el único formato que se puede reimportar sin pérdida.

> Importar **rechaza el archivo entero** si una sola tarea no es válida. No importa un
> subconjunto a medias: preferimos que sepas que algo falló a que te quede una base que no esperabas.

### Importar y exportar

Desde el menú de datos. Exportar abre el diálogo nativo del sistema y escribe donde tú elijas.
Importar valida el archivo antes de tocar la base.

## Para desarrollar

**Necesitas** Node 22.12 o superior. Para instalar el código, nada más: `better-sqlite3` trae
binarios precompilados para los ocho sistemas y no hace falta compilador.

```bash
npm ci
npm run dev          # la app con recarga en caliente
```

### Antes de decir que está

```bash
npm run verify       # eslint + tsc de los dos proyectos + vitest
```

Eso es lo que corre la CI. Y sobre la app real, que es donde aparecen los fallos que los tests
unitarios no ven:

```bash
npm run ci           # verify + los 23 flujos E2E sobre el proceso real
npm run smoke:all    # los cinco smokes de fase, 37/30/40/30/26 comprobaciones
npm run test:coverage # cobertura: 92,45 % global, core/ 90,70 %
node scripts/fase7-perf.mjs   # los cinco RNF medidos sobre la app real
```

`fase7-perf.mjs` deja el informe en [`docs/rendimiento-fase-7.md`](docs/rendimiento-fase-7.md), con
su metodología y, también, con los cuatro casos en los que el propio instrumento dio números
falsos antes de corregirse. **Un número sin el método al lado es una cifra elegida.**

### Publicar

```bash
git tag v1.0.0 && git push origin v1.0.0
```

Eso dispara `.github/workflows/release.yml`: verifica, empaqueta en Windows, macOS y Linux en
paralelo, y publica en GitHub Releases. La matriz de tres SO no es un capricho — el `.dmg` llama
a `hdiutil`, que solo existe en macOS, así que ese artefacto no se puede generar desde ningún
otro runner.

## Documentos

| Documento                                                  | Qué contiene                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------- |
| [`PLAN_IMPLEMENTACION.md`](PLAN_IMPLEMENTACION.md)         | El plan por fases, con el estado real de cada una                   |
| [`docs/rendimiento-fase-7.md`](docs/rendimiento-fase-7.md) | Los RNF medidos y su metodología                                    |
| [`docs/empaquetado-fase-9.md`](docs/empaquetado-fase-9.md) | El tamaño del instalador, con el desglose                           |
| [`docs/checklist-release.md`](docs/checklist-release.md)   | La matriz SO × vista × tema, **sin rellenar**: necesita una persona |
| [`docs/plan-tasks-app.md`](docs/plan-tasks-app.md)         | El plan maestro del que sale todo lo demás                          |
| [`odd/tasks/`](odd/tasks/)                                 | El documento de cada fase, con su log                               |

## Licencia

Privado. Sin licencia declarada.
