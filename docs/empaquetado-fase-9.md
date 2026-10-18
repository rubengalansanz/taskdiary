# Fase 9 · Los tres targets y el tamaño del instalador

Qué cambió en el empaquetado el 2026-10-18, y por qué el objetivo de RNF-04 (instalador por
debajo de 100 MB) sigue sin cumplirse después de dos intentos razonados.

## El número

| | Antes | Ahora |
| --- | --- | --- |
| Instalador NSIS (Windows) | 125,10 MB | **101,95 MB** |
| Instalador portable (Windows) | — | **101,78 MB** |
| `app.asar` | 68,34 MB | **15,44 MB** |
| `app.asar` del artefacto sin comprimir | 403 MB | **339,85 MB** |

Objetivo: 100 MB. **Faltan 1,95 MB, un 2 %.**

## Los tres targets, y dónde se compila cada uno

Declarados los tres en `electron-builder.yml`. Lo que sigue no es una convención del plan, es la
documentación de electron-builder leída:

| Plataforma | Targets | ¿Dónde se compila? |
| --- | --- | --- |
| Windows | `nsis`, `portable` | **Aquí.** Compilado y verificado. |
| macOS | `dmg` (x64 + arm64) | **Solo en macOS.** El builder de `dmg` invoca `hdiutil`, que no existe fuera de macOS — tampoco dentro de un contenedor Linux. |
| Linux | `AppImage`, `deb` | En un runner Linux. electron-builder permite compilarlo desde cualquier SO con el contenedor `electronuserland/builder`, pero aquí no hay Docker. |

Los dos últimos existen como configuración y se compilarán donde el SO lo permita. Eso es
justo para lo que sirve `release.yml`, que todavía **no existe**: sin una matriz de tres SO en
GitHub Actions, «los tres targets» es una intención y no un hecho verificable.

## Qué se cambió, y cuánto valió cada cosa

**1. Las dependencias del renderer estaban dentro del instalador.** Este fue el cambio grande.
`dependencies` de `package.json` listaba trece paquetes que solo usa el renderer — React,
`lucide-react`, `react-dom`, `date-fns`… — y electron-builder copia `node_modules` a partir de
ese campo. Vite los empaqueta dentro del bundle, así que en el artefacto eran **55 MB de
código muerto**: `lucide-react` solo eran 34 MB.

`out/main/index.js` requiere exactamente cuatro paquetes en runtime (`better-sqlite3`, `xlsx`,
`zod`, `@electron-toolkit/utils`) y el preload uno más. Esos cinco son los que se quedan en
`dependencies`; los trece restantes pasaron a `devDependencies`.

**2. El allowlist de `files` era una lista de exclusiones. Y para `node_modules` era inútil.**
La primera versión de la Fase 9 pasó de lista de exclusiones a lista de inclusiones, y el
`app.asar` bajó de 68 a 50 MB. Después se descubrió que eso no podía tocar `node_modules`: con
`files: [package.json, out/**]` el artefacto seguía trayendo `node_modules` entero, porque
esa resolución la hace el packer desde `dependencies`, no desde los globs. Un ensayo de «suelo»
que pretendía medir el coste mínimo de Electron produjo un instalador **byte a byte idéntico**
al de la app completa — la prueba de que la palanca de `files` nunca había tocado
`node_modules`. (Sí: otro residuo de otro idioma. Corregido.)

**3. Los binarios nativos de ocho plataformas.** better-sqlite3 trae un `.node` precompilado
por plataforma y `asarUnpack` los ponía los ocho en disco: 27 MB de los que se carga uno. Un
hook `afterPack` deja solo el de la plataforma que se está empaquetando — usando
`electronPlatformName`, no `process.platform`, para que un cross-build siga siendo correcto —
y borra además `deps/`, `src/` y `binding.gyp`, que son el C++ con el que se compila algo que
aquí nunca se compila.

**4. El icono del tray desaparecía en el build empaquetado.** Este bug era **preexistente** y
solo apareció al ejecutar el artefacto: el icono se importa de `resources/icon.png`, y
`asarUnpack` lo deja junto al archivo, así que la ruta que resuelve el código apunta dentro de
`app.asar` a un fichero que ya no está ahí. `nativeImage.createFromPath` devuelve una imagen
vacía en vez de lanzar, así que el fallo era silencioso: la app se quedaba en la barra de tareas
sin bandeja. Corregido con `resolveUnpackedResource` (`src/main/core/packaged-resource.ts`),
que busca el archivo en los dos sitios en vez de suponer en cuál está.

## Por qué 100 MB no se alcanzan

El desglose del artefacto, medido:

| Pieza | Sin comprimir |
| --- | --- |
| `TaskDiary.exe` (Chromium 44) | **234,97 MB** |
| `resources/app.asar` (la app entera) | 15,44 MB |
| `.pak`, `icudtl.dat`, locales (recortados a `es-ES` + `en-US`) | ~25 MB |

**La app aporta 15 MB de un artefacto cuyo suelo es Chromium.** Ninguna idea más de
optimización cambia ese orden de magnitud: para bajar de 101,95 a 100 habría que quitar 2 MB
de 15, y el resto del peso no es de esta aplicación.

La lectura honesta del plan es que **RNF-04 está mal fijado para este stack**, no que la app
esté mal. Un objetivo de 100 MB comprimido es alcanzable para una aplicación Tauri o para un
Electron antiguo y recortado; con Electron 44 el runtime ya se come el presupuesto. El plan
debe cambiar el número o declarar la excepción, y esa decisión es del usuario.

## Cómo se verificó

No por el tamaño, sino **por ejecutar el artefacto**: cada build se lanzó y se comprobó que monta la vista, que el puente `window.taskDiary` está completo y que
`task:list` responde contra el fichero SQLite real. Es exactamente el hueco que dejó el test
de persistencia de la Fase 6, que pasaba verde contra una base en memoria.

Eso encontró tres bugs que ninguna medida de peso habría mostrado:

1. Un allowlist de `files` con las reinclusiones escritas con `!` — que en electron-builder
   significa *excluir* — dejó el primer artefacto **sin `better-sqlite3`**: 104 MB que no
   abrían su base de datos.
2. El icono del tray ausente por el allowlist demasiado cerrado.
3. El hook `afterPack` colocado en `beforePack`, que corre **antes** de que los archivos se
   copien: el hook se ejecutaba, no encontraba el directorio y no hacía nada, en silencio.

Un instalador más pequeño que no arranca no es un instalador más pequeño.

## Pendiente

- `release.yml` con la matriz de tres SO: sin eso, `dmg` y AppImage/deb no se compilan nunca.
- `electron-updater` sigue instalado y **sin cablear** (`grep` de `autoUpdater` en `src/` no
  devuelve nada). Sin eso, el entregable «autoactualizable» del plan no existe.
- `date-fns` (10,40 MB) y `fuse.js` no se importan en ningún sitio de `src/`. No se han
  borrado: quitar dependencias es una decisión propia, no un efecto secundario de empaquetar.