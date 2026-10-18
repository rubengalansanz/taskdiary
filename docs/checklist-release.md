# Checklist de release

La matriz SO × vista × tema que el plan pide como entregable de la Fase 8, y que solo puede
rellenar una persona. Existe porque el plan la nombra y porque las tres cosas que se comprueban
aquí —bandeja, notificaciones del SO y rutas del sistema de archivos— **no son observables desde
un proceso**: por eso los smokes de fase dejan esos puntos sin cubrir a propósito.

Nada de esto lo puede hacer la CI. Los cinco smokes y los 23 flujos E2E pasan en Linux sin
ventana visible, y aun así no pueden afirmar que un icono aparezca en la bandeja del sistema.

## Cómo rellenarlo

Una casilla por celda. Marcada solo si **se miró la pantalla**, no si el proceso arrancó. Cuando
falle algo: qué SO, qué versión, qué se veía, y una foto si la hay — una frase sin el SO no
sirve de nada.

---

## 1 · Las cinco vistas, en ambos temas

Cada vista se abre con su botón del selector y tiene que renderizar sin errores en la consola
y con contenido coherente. Repetir con tema claro y oscuro: **el tema se cambia siguiendo al SO**
(`nativeTheme`), así que basta con cambiar el tema del sistema y reabrir.

| Vista | Átomo | Tema claro | Tema oscuro | Qué mirar |
| --- | --- | --- | --- | --- |
| Día | `#/day/AAAA-MM-DD` | ☐ | ☐ | Fecha en el título, lista o estado vacío, cronómetro al correr una tarea |
| Semana | `#/week/AAAA-MM-DD` | ☐ | ☐ | Siete columnas, balance estimado/real por día |
| Mes | `#/month/AAAA-MM-DD` | ☐ | ☐ | Rejilla del mes, mini-anillo de progreso por día |
| Actividad | `#/heatmap/AAAA-MM-DD` | ☐ | ☐ | 26 semanas de rejilla, tooltip al pasar, navegación al hacer clic |
| Estadísticas | `#/stats` | ☐ | ☐ | Racha, totales, gráfico semanal, días sin medir |

**En todas:** la app abre en menos de 3 s, el idioma de la interfaz es español, y no hay texto
en inglés salvo nombres propios de campos.

## 2 · Las rutas del SO, que es donde Electron más se equivoca

Esto es lo que `base: './'` en la config de Vite previene, y solo se ve en el artefacto.

| SO | ☐ | Qué mirar |
| --- | --- | --- |
| Windows | ☐ | El menú de la app lleva «Archivo / Editar / Ir / Ver / Ayuda», no el menú del sistema |
| macOS | ☐ | Barra de título `hiddenInset`: los botones de tráfico no se solapan con la barra de la app |
| macOS | ☐ | El icono del tray es una plantilla: se recolorea al cambiar el tema del sistema |
| Linux | ☐ | El menú aparece con «Archivo / Editar / Ir / Ver / Ayuda», no con nombres de GTK |

## 3 · Bandeja y ventana oculta — **imposible de automatizar**

| SO | ☐ | Qué mirar |
| --- | --- | --- |
| Windows | ☐ | Minimizar **oculta** la ventana y aparece un icono en la bandeja |
| Windows | ☐ | Clic en el icono de la bandeja devuelve la ventana |
| Linux | ☐ | Minimizar oculta. **Si el escritorio no tiene indicador de bandeja, no hay bandeja** y la app se queda en la barra de tareas: es el comportamiento correcto y está documentado en `src/main/tray.ts` |
| macOS | ☐ | El icono está en la barra de menús, no en el «dock» |

> El clic físico sobre el icono de la bandeja nunca se ha ejercitado por script, porque no es
> programático. Es la única comprobación de toda la Fase 6 que quedó abierta, y esta tabla la
> incluye porque sigue sin cubrir.

## 4 · Notificaciones del SO — **imposible de automatizar**

| SO | ☐ | Qué mirar |
| --- | --- | --- |
| Windows | ☐ | Una tarea **con hora** avisa cuando llega. Una sin hora no avisa nunca |
| macOS | ☐ | Igual, y el permiso aparece en Ajustes → Notificaciones tras el primer aviso |

Requisito previo: la ventana tiene que estar **en segundo plano**. Con la app enfocada el bucle
no anuncia nada, a propósito — ver `core/reminders.ts`.

## 5 · Datos: importar y exportar, en cada SO

| SO | ☐ | Qué mirar |
| --- | --- | --- |
| Windows | ☐ | Exportar a `.xlsx` abre el diálogo **nativo**, no una ventana del navegador |
| macOS | ☐ | Exportar a `.csv` cae en Documentos o Descargas y el diálogo ofrece ambas |
| Linux | ☐ | Importar un JSON con una sola tarea inválida **rechaza el archivo entero** y no deja la base a medias |

## 6 · La instalación, en el SO de destino

| SO | ☐ | Qué mirar |
| --- | --- | --- |
| Windows | ☐ | El instalador crea acceso directo en el escritorio y desinstala limpio |
| Windows | ☐ | El portable **arranca sin instalar nada**, desde una carpeta que el usuario puede borrar |
| macOS | ☐ | El `.dmg` monta y la app se arrastra a Aplicaciones |
| macOS | ☐ | La app abre **sin avisar de que está damagesada** (Gatekeeper) |
| Linux | ☐ | El AppImage arranca con doble clic tras darle permiso de ejecución |
| Linux | ☐ | El `.deb` instala y aparece la entrada correcta en el menú de aplicaciones |

## 7 · La actualización automática — **solo después de un release firmado**

| SO | ☐ | Qué mirar |
| --- | --- | --- |
| Windows | ☐ | «Buscar actualizaciones» en Ayuda encuentra la versión publicada |
| Windows | ☐ | La descarga ocurre **solo** al pedirla, nunca sola |
| Windows | ☐ | Al reiniciar instala y deja la versión nueva |
| macOS | ☐ | Igual que en Windows |

> Sin firma real, electron-updater rechaza el artefacto y la app informará de que la versión no
> está firmada. **Eso es el comportamiento correcto**: es preferible a instalar algo sin
> verificar. Hasta que existan los secretos de publicación en el repositorio, esta sección no se
> puede rellenar y no debe marcarse.

---

## Firmar el checklist

- [ ] Las tres plataformas marcadas, sin celdas vacías
- [ ] Sin fallos abiertos, o cada uno con su SO y su versión anotados
- [ ] La sección 7 rellena **solo** si hubo un release firmado

Un checklist a medio rellenar no es un checklist: es una fuente de confianza falsa. Si algo no se
puede comprobar en la máquina disponible, se deja en blanco y se dice por qué.