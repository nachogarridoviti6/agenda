# Agenda

Calendario de escritorio para Windows 11 inspirado en Apple Calendar, con un **widget fijado en el fondo del escritorio** que muestra la semana actual y las tareas pendientes.

Hecho con **Tauri 2** (Rust) + **React** + **TypeScript**. Los datos se guardan en local, en **SQLite**.

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | App principal: vistas Semana y Mes, eventos, tareas, calendarios con color, persistencia, modo claro/oscuro | ✅ |
| 2 | Widget anclado al escritorio, bandeja del sistema, arranque con Windows | ⏳ |
| 3 | Repeticiones, alertas, añadir rápido en lenguaje natural, vistas Día y Año, búsqueda | ⏳ |
| 4 | Importar/exportar `.ics` (y CalDAV con iCloud, opcional) | ⏳ |
| 5 | Instalador `.exe` pulido | ⏳ (ya se genera uno básico en cada build) |

## Instalar (lo normal)

1. En GitHub, abre la pestaña **Actions** del repositorio.
2. Entra en la ejecución más reciente con ✅ verde.
3. Abajo, en **Artifacts**, descarga **Agenda-instalador-windows** (es un `.zip`).
4. Descomprime y ejecuta `Agenda_x.y.z_x64-setup.exe`.
   Windows SmartScreen avisará porque el instalador no está firmado: pulsa **Más información → Ejecutar de todas formas**.

Los datos se guardan en `%APPDATA%\com.nachogarrido.agenda\agenda.db`.

## Uso

| Acción | Cómo |
|---|---|
| Nuevo evento | `N`, botón `+`, doble clic en un hueco o **arrastrar** en la rejilla |
| Mover / cambiar duración | Arrastrar el evento / arrastrar su borde inferior |
| Ir a hoy | `T` o botón **Hoy** |
| Semana anterior / siguiente | `←` / `→` |
| Vista Semana / Mes | `2` / `3` |
| Nueva tarea | `+` de **Tareas** en la barra lateral, o menú `+` |
| Completar tarea | Clic en su círculo (en la barra lateral o en el calendario) |
| Calendarios | Casilla para mostrar/ocultar, lápiz para renombrar, recolorear o borrar |
| Tema claro/oscuro | ⚙️ abajo a la izquierda (por defecto sigue a Windows) |

Campos de hora: puedes escribir `9`, `930`, `9:30` o `21h`, y usar las flechas `↑`/`↓` para sumar o restar 15 minutos.

## Desarrollo

### Requisitos (en Windows)

- [Node.js 22](https://nodejs.org/)
- [Rust](https://rustup.rs/) (stable)
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) → carga de trabajo «Desarrollo de escritorio con C++»
- WebView2: ya viene con Windows 11

### Comandos

```bash
npm install
npm run tauri dev       # app de escritorio con recarga en caliente
npm run tauri build     # instalador en src-tauri/target/release/bundle/nsis/

npm run dev             # solo la interfaz, en el navegador: http://localhost:1420/?demo
npm test                # tests de lógica (Vitest)
npm run test:e2e        # tests de interfaz (Playwright)
cargo test --manifest-path src-tauri/Cargo.toml   # tests del backend
```

En el navegador, la app usa un backend simulado sobre `localStorage`. Con `?demo` arranca con datos de ejemplo.

## Arquitectura

```
src-tauri/            Backend (Rust)
  src/db.rs           SQLite: migraciones y CRUD (única fuente de verdad)
  src/lib.rs          Comandos de Tauri; tras cada cambio emite "data-changed" a todas las ventanas
src/                  Frontend (React + TS)
  lib/dates.ts        Fechas siempre en Europe/Madrid (cambios de hora incluidos)
  lib/layout.ts       Colocación de eventos solapados y barras de varios días
  lib/occurrences.ts  Expansión de eventos en apariciones (aquí irán las repeticiones)
  lib/backend.ts      Contrato con el backend: Tauri o simulado
  components/         Vistas, barra lateral, editores
  widget/             Widget de escritorio (fase 2)
```

- **Fechas**: se guardan como instantes UTC en ms. Todo lo que depende del día (qué día es, la semana, la hora que se muestra) se calcula en `Europe/Madrid`, con independencia de la zona horaria del PC. Los eventos de todo el día van de medianoche a medianoche, con fin exclusivo como en iCalendar.
- **Repeticiones** (fase 3): se guardan como `RRULE` estándar (RFC 5545), con `EXDATE` y excepciones `RECURRENCE-ID`. Es el mismo modelo que usan `.ics` e iCloud.
