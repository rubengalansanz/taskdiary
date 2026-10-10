# Fase 0 · Cimientos

> Feature ODD derivada de `PLAN_IMPLEMENTACION.md` §3 «Fase 0 · Cimientos — 1 día».
> Documento maestro: `docs/plan-tasks-app.md` v2.0 (2026-10-08).

## Objetivo

Ventana con estilos, SQLite abierto y `SELECT 1` correcto. Es la base sobre la que se
construyen las fases 1–10 y la que fija de forma definitiva el **contrato de seguridad**
(§2 reglas 1–3) que las 2 reglas innegociables no pueden negociar después.

## Problema

El repo no tiene una sola línea de código: 0 commits, sin `package.json`, sin configuración.
El plan (§8.1) fija una matriz de versiones exacta y **dos conflictos de peer-dependency
resueltos a propósito** (`typescript@5.9.3`, `vite@7.3.7`). Si el árbol se resuelve «a criterio
de npm», el proyecto nace con `ERESOLVE` o con TypeScript 7 y lint muerto, y el daño se
arrastra a las 10 fases siguientes.

## Por qué ahora

Todas las fases dependen de Fase 0. No hay atajo: la cadena de dependencias de §4 es
estrictamente lineal hasta la Fase 5.

## Alcance autorizado

Solo Fase 0. Ninguna functionality de las Fases 1+ (nada de tareas, etiquetas, vistas,
recurrencia, import/export). El modelo de dominio entra en Fase 1.

Fuera de alcance explícito: `electron-builder.yml` completo de Fase 9 (solo se sanea lo
mínimo para que el repo sea coherente), Husky/lint-staged cableados (se cablean en Fase 8),
`@testing-library` (no hay UI que testear todavía más allá del smoke).

## Restricciones

- Reglas §2.1–§2.11 del plan, **todas**. En Fase 0 aplican la 1, 2, 3, 10.
- Versiones exactas de §8.1. Sin `^`, sin `latest`.
- ADR-011: **sin** `electron-builder install-app-deps` en `postinstall`. `better-sqlite3@13`
  usa N-API (§8.3, medido).
- Tailwind 4 es CSS-first: **no existe** `tailwind.config.js` ni comando `init` (§8.1).
- Artefactos técnicos en inglés (§ Language Domain Contract).
- `.gitignore` y `AGENTS.md` del repo se respetan: el scaffold **no** sobrescribe
  `.gitignore`; se conserva la versión del repo y se le añaden las reglas del scaffold.

## Mapa de rutas (desviación documentada)

El plan nombra `electron/core/` y `electron/db/` (§2.10). El scaffold de `electron-vite`
estructura el main en `src/main/`. **Decisión: `src/main/core/` y `src/main/db/`.**

Motivo: `electron-vite` resuelve `main` desde `src/main/`; poner el dominio en
`electron/core/` obligaría a mover el entrypoint o a reconfigurar el layout. La regla §2.10
trata de una **frontera de imports**, no de un nombre de carpeta: `src/main/core/` y
`src/main/db/` cumplen la misma frontera (`solo node:*` y `better-sqlite3`, cero imports
de Electron).

## Tareas

- [x] **T0.1** Versionar `docs/plan-tasks-app.md` y `PLAN_IMPLEMENTACION.md` (§0.1 pendiente 1)
- [x] **T0.2** Scaffold `electron-vite` + React 19 + TS 5.9 en la raíz (§8.2)
- [x] **T0.3** `package.json` con la matriz de §8.1 exacta, sin rangos abiertos
- [x] **T0.4** `npm install` con el árbol verificado (`npm ls` sin `invalid`/`extraneous`)
- [x] **T0.5** Tailwind 4 (`@tailwindcss/vite` + `@import "tailwindcss"`) y shadcn/ui
- [x] **T0.6** Tema claro/oscuro: `nativeTheme.shouldUseDarkColors` → clase `.dark` + `@custom-variant dark`
- [x] **T0.7** Ventana segura: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, oculta hasta `ready-to-show`
- [x] **T0.8** `better-sqlite3` abre la BD en `app.getPath('userData')` y `SELECT 1` responde
- [x] **T0.9** `window.taskDiary` vía `contextBridge`; `require` inexistente en el renderer
- [x] **T0.10** ESLint (`typescript-eslint` + `eslint-plugin-security`) + Prettier + `tsc --strict` limpios
- [x] **T0.11** Vitest configurado para `src/main/core` y `src/main/db`, con un test trivial en verde
- [x] **T0.12** `docs/ADR-001-electron.md`
- [x] **T0.13** Commit inicial (work-unit, Conventional Commits)

## Criterios de aceptación (§3, Fase 0)

1. `npm run dev` abre la ventana con Tailwind aplicado y sin flash blanco.
2. `window.taskDiary` definido; `require` inexistente en el renderer.
3. `better-sqlite3` abre la BD en `app.getPath('userData')` y `SELECT 1` responde.
4. `npm run test` en verde con al menos un test trivial.
5. `npm ls typescript vite electron-vite @vitejs/plugin-react` sin `invalid` ni
   `extraneous`; `npx tsc --version` devuelve `5.9.3`.

## Conflictos de peer-dependency resueltos

| # | Conflicto | Resolución |
| --- | --- | --- |
| A | `typescript-eslint@8.71.1` exige `typescript >=4.8.4 <6.1.0`; la última estable es 7.x | Fijar `typescript@5.9.3` (§8.1) |
| B | `electron-vite@5.0.0` admite `vite ^5||^6||^7`; `@vitejs/plugin-react@6.x` exige `vite ^8` | Fijar `vite@7.3.7` + `@vitejs/plugin-react@5.2.0` (§8.1) |
| C *(nuevo)* | `eslint-plugin-react@7.37.5` declara `peer: eslint ^3..^9.7` — **no** admite `eslint@10`; no hay versión estable que lo admita | **No instalar `eslint-plugin-react`.** El stack de lint queda `eslint@10` + `typescript-eslint@8` + `eslint-plugin-react-hooks@7` (peer `^10` ✓) + `eslint-plugin-react-refresh@0.5.7` (peer `^10` ✓) + `eslint-plugin-security@4.2.0` + `eslint-config-prettier@10.1.8`. Para TSX, `typescript-eslint` cubre lo esencial |
| D *(nuevo)* | `npm install` con `allow-scripts=opencode-ai` (§8.5) bloquea los postinstall de `electron` y `better-sqlite3` | Ampliar `allow-scripts` en el `.npmrc` de usuario con los paquetes del proyecto. Sin esto, `electron` no descarga su binario |
| E *(nuevo, bloqueante)* | `electron-vite` externaliza **todas** las dependencias por defecto (`build.externalizeDeps: true`). Con `sandbox: true` el preload solo puede `require` built-ins, así que `require('@electron-toolkit/preload')` lanzaba `module not found`, el preload entero fallaba y `window.taskDiary` quedaba `undefined` — rompiendo el criterio 2 sin que ningún check local lo viera | `preload.build.externalizeDeps: false` en `electron.vite.config.ts`. El preload queda autocontenido y solo queda `require("electron")`. Detectado con un smoke test real vía CDP, no con los checks estáticos |
| F *(nuevo)* | `src/preload/index.d.ts` importaba `'../../shared/ipc'` (inexistente). `skipLibCheck: true` de `@electron-toolkit/tsconfig` **oculta** el error de TS, así que `typecheck` pasaba en verde mientras todos los tipos cruzados caían a `any` y ESLint `strictTypeChecked` se quejaba con 31 errores | Corregido a `'../shared/ipc'`. Lección: `skipLibCheck` puede enmascarar rutas rotas en `.d.ts`, revisar siempre con lint type-aware encendido |
| G *(nuevo)* | `electron-builder.yml` venía del scaffold con `appId: com.electron.app`, `publish.provider: generic` apuntando a `https://example.com/auto-updates`, `maintainer: electronjs.org`, target `snap` (fuera del §9 de la Fase 9) y `NSCameraUsageDescription`/`NSMicrophoneUsageDescription` para capacidades que el main deniega por completo | Saneado: `appId: com.local.taskdiary` (coherente con `setAppUserModelId`), `publish.provider: github` → `rubengalansanz/taskdiary` (§10), `maintainer: TaskDiary`, sin `snap`, y sin declaraciones de cámara/micrófono. El `maintainer` del scaffold era además un email de terceros |

## Coherencia de identificadores

| Identificador | Valor | Fuente |
| --- | --- | --- |
| Directorio del repo | `taskdiary/` | — |
| `package.json#name` | `taskdiary` | `package.json:2` |
| `package.json#version` | `1.0.0` | `package.json:3` |
| `electron-builder.yml#appId` | `com.local.taskdiary` | `electron-builder.yml:1` |
| `setAppUserModelId(...)` | `com.local.taskdiary` | `src/main/index.ts:195` |
| Repositorio remoto | `github.com/rubengalansanz/taskdiary` | `PLAN_IMPLEMENTACION.md` §10 |

El plan maestro (`docs/plan-tasks-app.md`) nombra el proyecto `taskdiary/`; el repo se llamaba
`tasks-app` al escribir el plan. Electron se inicializó en la raíz y los tres identificadores
quedan alineados, que es lo que pedía el pendiente 2 de §0.1.

## Checks aplicables

```bash
npm ls typescript vite electron-vite @vitejs/plugin-react   # sin invalid/extraneous
npx tsc --version                                            # 5.9.3
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Verificación funcional adicional (no sustituye a los checks anteriores): lanzar
Electron con `--remote-debugging-port` y medir por CDP dentro del renderer real
`typeof window.taskDiary`, `typeof require`, `typeof process`, `typeof Buffer`,
y `await window.taskDiary.db.probe()`. Fue lo que descubrió el conflicto E.

## Progreso

| Tarea | Estado |
| --- | --- |
| T0.1–T0.13 | ✅ completadas |

Checks medidos el 2026-10-09 después del fix del conflicto E:

| Check | Resultado |
| --- | --- |
| `npm run format:check` | ✅ 0 |
| `npm run lint` | ✅ 0 (31 errores resueltos) |
| `npm run typecheck` | ✅ 0 |
| `npm run test` | ✅ 1 archivo, 6 tests |
| `npm run build` | ✅ main 6.36 kB · preload 3.36 kB · renderer 646.70 kB |
| CDP en producción | ✅ `taskDiary: object`, `require/process/module/Buffer: undefined`, `window.electron: undefined`, probe `ok:true` en `AppData\Roaming\taskdiary\taskdiary.db` (SQLite 3.53.4) |
| CDP en `npm run dev` | ✅ igual, más `window.electron: object` (gate dev-only funciona) |

Checks revalidados el 2026-10-10 antes del commit inicial, tras sanear `electron-builder.yml`
(conflicto G): `format:check` ✅ · `lint` ✅ · `typecheck` ✅ · `test` ✅ 6/6 · `build` ✅
main 6.36 kB · preload 3.36 kB · renderer 646.70 kB · `npm ls` sin `invalid`/`extraneous` ·
`npx tsc --version` → `5.9.3`. Los cinco criterios de aceptación de §3 quedan cumplidos.

## Próximo paso

Fase 1 · Datos — `Database` con pragmas, migración `0001_init.sql`, modelos de dominio,
repositorio de tareas y contrato IPC.
