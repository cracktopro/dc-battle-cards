# CONTEXT

Documento vivo de referencia técnica para trabajar sobre DC Battle Cards sin romper flujos existentes.

> **Última validación contra código:** 2026-06-02. Incluye editores dev, git push, navegación `editorDevNav` y menú Herramientas Desarrollo.

## Visión General

- Arquitectura: `Node/Express` + `Socket.IO` en `server.js`, frontend vanilla en `public/` (HTML/CSS/JS), persistencia en Firestore.
- Runtime principal:
  - Login/registro: `public/main.js` -> API backend.
  - Hub: `public/vistaJuego.html` + `public/jugarPartida.js`.
  - Motor de combate principal: `public/tablero.html` + `public/partida.js`.
  - Coop online dedicado: `public/tablero_coop.html` + `public/partidaCoop.js`.
- Fuente de datos de catálogo/configuración: Excel en `public/resources/*.xlsx` (`cartas.xlsx`, `eventos.xlsx`, `desafios.xlsx`, `asaltos.xlsx`, etc.).
- Patrón crítico: la app usa mucho `localStorage` como bus de estado entre vistas/modos. Cualquier cambio en keys o limpieza afecta múltiples flujos.

## Glosario de Términos

- **VS BOT (padre)**: flujo base PvE, desde `vistaJuego` a `tablero`, sobre el que derivan varios modos.
- **PvP online**: versión sincronizada por sockets del combate base.
- **Desafío (camino)**: progresión por niveles/facción desde `desafios.html`, Excel `desafios.xlsx`.
- **Evento rotativo (hub)**: PvE desde Centro de Operaciones (`vistaJuego`), Excel `eventos.xlsx`, rotación horaria. **Importante:** también persiste en `desafioActivo` con `tipo: 'evento'` (misma key que desafíos, distinto origen).
- **Asalto**: PvE tipo VS BOT con mazos predefinidos y dificultad 6/7/8.
- **Coop online**: dos jugadores aliados contra BOT/BOSS, sincronizado por snapshots.
- **Episodios**: timeline lineal `cutscene -> combate -> recompensa` con estado persistido.
- **Sync token**: control de concurrencia multi-dispositivo para Firestore.
- **Parent card**: nomenclatura para carta base sin skin; se usa para deduplicar progresos/colección.

### Nomenclaturas y keys críticas

- Sesión:
  - `usuario`, `email`, `dc_active_session_id_v1`
- Modo/partida:
  - `partidaModo`, `mazoJugador`, `mazoJugadorBase`, `mazoOponente`, `mazoOponenteBase`, `dificultad`
  - `desafioActivo`, `asaltoActivo`, `episodioActivo`
  - `partidaPvpSessionId`, `partidaPvpRol`, `partidaPvpPrimerTurno`
  - `partidaPvpInicialesJugadorIdx`, `partidaPvpInicialesOponenteIdx`
- Oponente:
  - `nombreOponente`, `avatarOponente`, `emailOponente`
- UI/estado temporal:
  - `dc_tablero_fondo_url` (sessionStorage), `dc_tablero_abandonado` (sessionStorage)
- Recompensa diaria:
  - `dc_daily_reward_claim_lock_v1` (`RECOMPENSA_DIARIA_LOCK_KEY`)
  - `dc_diaria_last_claim_at_v1` (`DC_DIARIA_LAST_CLAIM_LS_KEY`)
  - `dc_daily_reward_modal_ack_claim_ts` (sessionStorage, `RECOMPENSA_DIARIA_MODAL_ACK_KEY`)
  - En `usuario`: `recompensas.diariaSobres.lastClaimAt`
- Otros:
  - `partidaRecompensada` (evita doble otorgamiento en misma partida)
  - `grupoActual`, `grupoInvitacionEnCurso`
  - `pvpDebugUI`

## Árbol del Proyecto Comentado

- `server.js`: backend único (API auth/user/admin, sockets, sesiones, concurrencia sync, lógica lobby/coop/pvp).
- `public/cliente.js`: cliente socket central (chat, grupos, lobby, invitaciones, puentes a `window`).
- `public/js/cartas.js`: núcleo transversal (sync usuario, recompensa diaria, color RGB, helpers de cartas/skills/estrellas).
- `public/js/sesionUnica.js`: inyección de `sessionId` y control de sesión única.
- `public/tablero.html` + `public/partida.js`: motor combate principal (VS BOT, desafíos, asaltos, PvP, episodios).
- `public/tablero_coop.html` + `public/partidaCoop.js`: motor combate coop online.
- `public/vistaJuego.html` + `public/jugarPartida.js`: hub principal, paneles, chat, eventos activos, partida rápida.
- `public/multijugador.html` + `public/multijugador.js` + `public/multijugadorEventosCoop.js`: PvP/Coop lobby y preparación.
- `public/desafios.html` + `public/desafios.js`: flujo eventos/desafíos offline.
- `public/asaltos.html` + `public/js/asaltos.js`: asaltos rotativos con dificultades altas.
- `public/episodios.html` + `public/js/episodios.js` + `public/js/episodio-engine.js`: carrusel, cutscenes y timeline episódica.
- `public/tienda.html` + `public/tienda.js`: tienda, rotaciones, pagos y persistencia.
- `public/coleccion.html` + `public/coleccion.js`: colección/sobres/filtros.
- `public/crearMazos.html` + `public/crearMazos.js`: construcción de mazos.
- `public/mazos.html` + `public/mazos.js`: edición de mazos.
- `public/mejorarCartas.html` + `public/mejorarCartas.js`: mejora clásica/especial/fragmentos/destrucción.
- `public/resources/*.xlsx`: catálogos y definición de contenido.

### Catálogos Excel (rutas reales)

| Archivo | Uso principal |
|---------|----------------|
| `cartas.xlsx` | Catálogo maestro de cartas, stats base, skills, imágenes. Columnas: `Nombre`, `Nivel`, `Salud`, `Poder`, `Tipo` (Meta/Tecnología/Magia), `Imagen`, `faccion` (H/V), `Afiliacion`, `imagen_final`, `skill_*`. `skill_trigger`: `usar` (activa) / `auto` (pasiva). `skill_class`: ver `ORDEN_SKILL_CLASS` en `filtrosCartas.js` |
| `desafios.xlsx` | Camino de desafíos (`desafios.html`) |
| `eventos.xlsx` | Eventos rotativos del hub (`jugarPartida.js`) |
| `eventos_online.xlsx` | Eventos coop online (`multijugadorEventosCoop.js`) |
| `asaltos.xlsx` | Asaltos semanales |
| `episodios.xlsx` | *(legacy, ya no usado)* — metadatos del carrusel viven en cada `resources/episodios/*.json` |
| `misiones_diarias.xlsx` | Misiones diarias/semanales |
| `skins.xlsx` | Apariencias / skins |
| `consejos.xlsx` | Carrusel de consejos en `vistaJuego` |

### Módulos globales en `window` (usar siempre estos nombres)

| API global | Archivo | Rol |
|----------|---------|-----|
| `DCEscaladoStatsCarta` | `js/escaladoStatsCarta.js` | Fórmulas de poder/salud por nivel |
| `DCCatalogoCartas` | `js/cartas.js` | Caché compartida de `cartas.xlsx` |
| `actualizarUsuarioConSyncFirebase` | `js/cartas.js` | Persistencia con control de concurrencia |
| `DCFiltrosCartas` | `js/filtrosCartas.js` | Filtro `skill_class`, etiquetas ES |
| `DCSkinsCartas` | `js/skinsCartas.js` | Parent card, skins, resolver catálogo; notación Excel `Parent[skin_id]` (p. ej. `Cyborg[0]`) |
| `DCSeleccionCartaApariencia` | `js/seleccionCartaApariencia.js` | Modal apariencias (colección/mazos); `abrirModalAparienciaEditor` en editores PvE (confirmación vía `skinSeleccionPendiente`, botones `crear-ep-btn`) |
| `DCMisiones` | `js/misionesDiarias.js` | Track misiones (cola FIFO interna) |
| `DCRedDot` | `js/menu-mobile.js` | Badges “nuevo” en cartas/sobres/menú |
| `DCEpisodioEngine` | `js/episodio-engine.js` | Timeline episodios |
| `DCEpisodiosCatalogo` | `js/episodiosCatalogo.js` | Catálogo carrusel (`GET /api/episodios/catalogo`) |
| `DCEpisodiosRequisitos` | `js/episodiosRequisitos.js` | Cartas requeridas, niveles catálogo (`nivel_jugador: 0`) |
| `aplicarColorPrincipalUsuario` | `js/cartas.js` | Tema RGB del jugador |

## Flujos Funcionales

## Carga de vistas (patrón)

- Carga frecuente de scripts:
  - `/socket.io/socket.io.js`
  - `cliente.js` (si la vista usa realtime)
  - `js/sesionUnica.js`
  - `js/cartas.js`
  - script específico de la vista
- Inicialización en `DOMContentLoaded` por módulo.

## Flujo de combate por modo

### 1) Jugador VS BOT (modo padre) — incluye “Partida rápida”

- Origen: `vistaJuego` (`jugarPartida.js`), botón **Comenzar** del panel Partida rápida.
- Configura mazo del jugador + dificultad (1–6).
- Genera mazo bot con `generarMazoBotConSinergia()` (12 cartas, una facción, sinergia por afiliación según `OBJETIVO_SINERGIA_POR_DIFICULTAD`).
- Escala cartas del bot al nivel elegido (`DCEscaladoStatsCarta` / `escalarCartaSegunDificultad` en `partida.js`).
- Limpia: `desafioActivo`, `asaltoActivo`, residuos PvP (`limpiarEstadoPvpAntesDePartidaVsBot`).
- **No** setea `partidaModo` (queda vacío o se elimina).
- Entra a `tablero.html`; detección en combate:
  - `ES_MODO_PVP === false`
  - `ES_MODO_ASALTO === false`
  - `ES_MODO_EPISODIO === false`
  - `estadoDesafio.activo === false`
  - Entonces `esPartidaRapidaVsBot() === true` → recompensas de partida rápida.
- Victoria: `otorgarRecompensasVictoria()` + `/update-user` + misiones `bot`, `bot_defeat`, colección H/V.
- Fondo opcional: `js/tableroFondo.js` + `GET /api/tableros`.

### 2) PvP Online Multijugador

- Lobby en `multijugador.html` con `multiplayer:lobby:*`.
- Servidor emite `multiplayer:session:start`.
- Cliente guarda contexto PvP en LS (`partidaModo=pvp`, `partidaPvpSessionId`, rol...).
- `partida.js` sincroniza acciones/estado por sockets (`multiplayer:pvp:*`) con revisiones y resync.
- No usa recompensas PvE del modo BOT.

### 3a) Desafíos (camino `desafios.html`)

- Excel: `resources/desafios.xlsx` (`desafios.js`).
- Progresión por nivel/facción (camino Héroes o Villanos), desbloqueo secuencial.
- Jugador elige **6 cartas** (no 12) + dificultad del desafío.
- Persiste `desafioActivo` (sin `tipo: 'evento'` o con tipo desafío según payload).
- `partida.js` → `construirEstadoDesafio()`, oleadas de enemigos, posible **BOSS** (`escalarBossSegunDificultad`).
- Recompensas: `otorgarRecompensasDesafio()`; primera victoria otorga cartas/objetos; repeticiones suelen dar solo puntos.

### 3b) Eventos rotativos (hub `vistaJuego`)

- Excel: `resources/eventos.xlsx` (`jugarPartida.js` → `cargarEventosActivos`, `renderizarEventosActivos`).
- Rotación: `ROTACION_EVENTOS_MS = 3_600_000` (1 h), clave `event-rotation-v1-{idVentana}`.
- Muestra 4 eventos por ventana (carrusel 3D, `js/carrusel3d.js`).
- Al confirmar: construye objeto con `tipo: 'evento'` y lo guarda en **`desafioActivo`** (misma key LS que desafíos).
- Limpia `asaltoActivo`, `partidaModo`, `mazoOponente`; 6 cartas jugador; dificultad en `dificultad`.
- `partida.js` trata `desafioActivo.tipo === 'evento'` para recompensas/progreso (`eventosJugadosPorRotacion`, clave distinta a coop).
- Puntos de recompensa: total Excel pensado para dificultad 6; escala `(dificultad/6) * puntosExcel`.

### 4) Asaltos

- Flujo en `js/asaltos.js`, rotación semanal.
- Mazo enemigo predefinido (no aleatorio), dificultad 6/7/8.
- `partidaModo=asalto`, `asaltoActivo` en LS.
- `partida.js` aplica rama asalto con reglas/recompensas particulares.

### 5) Evento Coop Online

- Deriva de Eventos + PvP (2 jugadores aliados).
- Preparación por fases en `multijugadorEventosCoop.js`.
- Servidor crea sesión coop y arranca `tablero_coop.html`.
- `partidaCoop.js` usa snapshots y revisiones por socket.
- Habilidades aliadas (shield/heal/heal_all etc.) aplicables entre P1/P2.

### 6) Episodios

- Catálogo carrusel: `GET /api/episodios/catalogo` lee metadatos de cada `public/resources/episodios/*.json` (`evento_id`, `nombre`, `descripcion`, `imagen`, `jsonPath`). Sin `episodios.xlsx`.
- **JSON episodio:** metadatos en raíz (`evento_id`, `nombre`, `descripcion`, `imagen` portada carrusel; alias legacy `episodio_id`) y array **`capitulos[]`**. Opcional `mostrar_carrusel: false` para excluir del carrusel (p. ej. copias legacy). Cada capítulo: `capitulo_id`, `nombre`, `descripcion` (opcional), `timeline[]` (misma sintaxis que antes). **Compatibilidad:** si solo existe `timeline` en raíz, el motor lo trata como un único capítulo (`DCEpisodiosCapitulos.normalizarCapitulos`).
- UI: `episodios.html` + carrusel 3D (`episodios.js`) + botón **Comenzar** → modal **capítulos** (`#episodios-modal-capitulos`, estilo panel asaltos: marco neón ~920px, lista con número, estado y botón Jugar/Repetir/Bloqueado). Capítulo 0 siempre desbloqueado; el N+1 requiere completar el N (`js/episodiosProgreso.js`, LS `dc_episodios_progreso_v1`). → `DCEpisodioEngine.iniciarEpisodio(ep, capituloIndex)`.
- **Editor cartas (solo URL):** `editarCartas.html` — sin enlace en menús. API `GET/PUT /api/cartas-editor/catalogo` (habilitado con `CARTAS_EDITOR=1`, `EPISODIOS_EDITOR=1`, rama Render `dev` o no producción). Catálogo: vista por defecto **imágenes** (`carta-mini` en rejilla) o **lista** (texto); toggle ▦ / ☰. Filtros: nombre, afiliación, facción, `skill_class`. Layout: catálogo y ficha **mismo ancho** (`1fr` + `1fr`); preview ~300–340px con miniatura centrada (~200px ancho, proporción 154:216). En `editarCartas.html`, `cartas.js` no llama a `/get-user` ni monta menú de sesión (evita 401 con email obsoleto en `localStorage`). Mini-cartas: `box-sizing` en franja nombre/poder; nombre alineado a la izquierda en rejilla del catálogo (`text-align` del botón no hereda al nombre). Selects `filtro-skill-class`: color de fondo vía `DCFiltrosCartas.aplicarClaseVisualSelectSkillClass` (clase + estilo inline) para que `crear-ep-select` / filtros del editor no lo pisen al cambiar valor; en `filtros-cartas.css`, reglas `:focus`/`:active` conservan el color de badge y la flecha del select (evitan el `background` de `select:focus` en `mazos.css` al clicar). Toolbar **Subir a GitHub** (`editorGitPush.js`) → `POST /api/cartas-editor/git-push` si `GIT_PUSH_TOKEN` está definido en el servidor. Al cambiar `Imagen` / `imagen_final` repinta al instante (URL desde la fila en edición, `registrarImagenesCatalogoEnMemoria`, bust de caché del navegador). Campos UI: imágenes (URL + drag&drop), `Tipo`, `faccion`, panel habilidad con colores `badge-habilidad--*` (`filtrosCartas.js`), resto en inputs. Validación antes de guardar; no altera lectores existentes de `cartas.xlsx`.
- **Editor JSON (solo URL):** `crearEpisodios.html` — sin enlace en menús. API `GET/PUT/POST /api/episodios-editor/*` (habilitado en desarrollo, `EPISODIOS_EDITOR=1` o rama Render `dev`). Toolbar **Subir a GitHub** → `POST /api/episodios-editor/git-push` (JSON en `public/resources/episodios/`). Módulos `crearEpisodiosModel.js` + `crearEpisodios.js`: metadatos carrusel (`evento_id`, `nombre`, `descripcion`, `imagen` con URL + drag&drop como `editarCartas`, `mostrar_carrusel`); capítulos, timeline (cutscene / escena / combate / recompensa), diálogos (**dlg**), comandos (**cmd**: escena, fondo_negro, fundido_negro, fundido_fondo), voz en off (**voz**); cutscene desplegable independiente de la selección de línea; botón **⧉ Duplicar** en cada línea del cutscene (clon profundo debajo); **reordenar por arrastre** (asa ⠿ en eventos del timeline y líneas de cutscene; misma lista; actualiza selección y cutscenes expandidos); **selector visual de imágenes** (modal grande con rejilla, filtro por nombre y Aceptar) para `bust_image` (diálogo y personajes en escena/comando escena), `background_image` (cutscene y fundido_fondo), `tablero` (combate); checkbox **Invertir imagen** (`invertir_imagen`) en diálogo y en cada personaje de comando escena; escena inicial vía array `escena`; validación y vista JSON cruda. Cliente carrusel: `js/episodiosCatalogo.js`.
- Engine: `js/episodio-engine.js`, timeline lineal **por capítulo**:
  - `cutscene`: `background_image`, `dialogos[]`, comandos de escena (ver abajo). **Layout bustos:** `bottom: 0` en CSS; `side` = posición horizontal %.
  - **Comandos de escena** (`episodio-engine.js` → `aplicarComandosEscena`):
    - **Al inicio del cutscene:** array `escena`, `escena_inicial` o `personajes_iniciales` en el objeto cutscene (todos los bustos visibles antes del primer diálogo).
    - **Entre diálogos:** línea con `"comando": "escena"` y array `escena` (sin `texto`) — solo actualiza personajes. Por defecto **avanza solo** tras el fade de bustos; `"auto": false` obliga a pulsar «Siguiente».
    - **Junto a un diálogo:** mismo array `escena` en la línea de diálogo (se aplica antes del texto; el hablante sigue siendo `id_character` de esa línea).
    - **En la timeline:** `{ "type": "escena", "escena": [...], "background_image"?, "limpiar_escena"?, "ocultar_ausentes"?, "auto"? }` — paso suelto sin diálogo; por defecto avanza solo (`auto: false` para pausa manual).
    - Cada entrada de escena: `id_character` (obligatorio), `bust_image`, `side`, `nombre`, `visible` (true/false), **`invertir_imagen`** (opcional, `true` → `transform: scaleX(-1)` en el busto). **`side`:** porcentaje o px; el **centro** del busto se ancla en esa coordenada horizontal (`translateX(-50%)`), misma regla en `escena` inicial, `escena[]` en diálogo y campos `side` del hablante (`resolverSidePersonaje` / `normalizarSideBusto`). Valores numéricos sin unidad (`5`) → `5%`.
    - Opciones: `ocultar_ausentes: true` oculta personajes no listados en ese comando; `limpiar_escena: true` (solo en `type: escena`) vacía la escena antes de aplicar.
  - **Comandos de fondo** (`#cutscene-fade` + `#cutscene-bg` en `episodio-engine.js`):
    - **Inicio cutscene en negro:** `fondo_inicial: "negro"`, `fondo_negro: true` o `background_image: "negro"`.
    - **Líneas en `dialogos[]` (sin `texto`):** `"comando": "fondo_negro"` (negro instantáneo, **manual** salvo `"auto": true`); `"comando": "fundido_negro"` / `"fundido_fondo"` (fundidos, opcional `duracion` ms; por defecto **avanza solo** al terminar el fade; `"auto": false` para confirmar con «Siguiente»). `fundido_fondo` requiere `background_image` en la línea o fondo ya definido en el cutscene. Alias: `fade_negro`, `fade_from_black`, etc. Parámetro **`auto`**: booleano `true` | `false` (también `"true"` / `"false"`).
  - **Bustos cutscene:** tamaño fijo CSS (`--cutscene-busto-w/h` 520×720; móvil 400×556 / 336×464); al hablar no escalan ni brillan en naranja; los no hablantes usan `brightness(0.76)` + `saturate(0.9)` (clase `--silencio`). **`invertir_imagen: true`** en la línea de diálogo del hablante o en cada entrada de `escena[]` aplica `scaleX(-1)` al `<img>` del busto. Al cambiar `visible` en comandos `escena` / diálogo: **fade-in** y **fade-out** (~380 ms, `renderizarBustosDOM` incremental); `limpiar_escena` o nuevo cutscene vacía al instante.
  - **Voz en off** (línea de diálogo): `voz_en_off: true` (alias `vozEnOff`, `voiceover`). El texto se muestra como `*texto en negrita*` (`<strong class="cutscene-dialog-voz-en-off">`). Con personaje: `id_character` + `nombre` → caja de nombre visible (bustos sin resaltar hablante). Sin personaje: `voz_en_off_sin_personaje: true` (alias `sin_personaje`, `sin_nombre`, `anonima`) u omitir `id_character`/`nombre` → se oculta la caja de nombre. Referencia: `resources/episodios/ejemplo.json`.
  - `combate`: `cartas_jugador[]`, `nivel_jugador`, `cartas_BOT[]`, `nivel_BOT`, **`tablero`** (opcional, nombre de archivo en `resources/tableros/`, p. ej. `"tablero_background_gotham"` — misma convención que eventos/asaltos en Excel). **`nivel_jugador: 0`** → cada carta del jugador usa el **nivel de su copia en colección** (`DCEpisodiosRequisitos.construirEntradasMazoJugadorEpisodio`). Cualquier otro valor fija ese nivel para todas (como antes). Previa de combate: miniaturas `carta-mini` completas (poder, salud, estrellas, badges) vía `DCEpisodiosRequisitos.construirCartasEnriquecidasDesdeEntradas`.
  - **Saltos de línea en diálogo:** `\n` en `texto` (JSON o literal `\\n`) → nueva línea en el cuadro (`white-space: pre-line`; typewriter y voz en off incluidos).
  - **Color en `texto`:** `#texto#` azul, `$texto$` rojo, `%texto%` amarillo (`parsearSegmentosTextoDialogo`; clases `cutscene-dialog-color--*`; compatible con `\n` y voz en off).
  - **Cartas requeridas (jugador):** todas las entradas únicas de `cartas_jugador` en los bloques `combate` del timeline deben estar en la colección del usuario (copia base parent, misma regla que colección — `esCopiaBaseParentEnColeccion` en `cartas.js`). Módulo `js/episodiosRequisitos.js`; UI en panel del carrusel (`episodios.js`: sub-panel «Cartas requeridas», miniaturas `evento-enemigo-card`); validación al pulsar **Comenzar** y en `DCEpisodioEngine.iniciarEpisodio` / `lanzarCombate`.
  - `recompensa`: `monedas`, `objetos[]`, `cartas[]`, `skins[]`
- Estado LS `episodioActivo` (sesión en curso):
  ```json
  { "episodio_id", "json_path", "nombre", "capitulo_index", "capitulo_id", "capitulo_nombre", "timeline_index", "estado": "activo"|"combate", "combate_resultado": null|"victoria"|"derrota", "tablero": string (opcional) }
  ```
- Progreso persistente capítulos: `dc_episodios_progreso_v1` → `{ "id|json_path": { "capitulosCompletados": [0,1,...] } }`. Al terminar un capítulo (`recompensa` o fin de `timeline`): se marca índice completado y se desbloquea el siguiente; capítulo intermedio muestra panel «Capítulo completado»; el último muestra «Episodio completado».
- Al lanzar combate: `estado: 'combate'`, `tablero` copiado del bloque JSON, mazos en LS, limpia `desafioActivo`/`asaltoActivo`/`partidaModo` y `dc_tablero_fondo_url` (sessionStorage), navega a `tablero.html`. Fondo en partida: `js/tableroFondo.js` → `fondoDesdeEpisodioActivoLs()` si `episodioActivo.estado === 'combate'` y hay `tablero`; si no, fondo aleatorio VS BOT como partida rápida.
- En `partida.js`:
  - `ES_MODO_EPISODIO` solo si `episodioActivo.estado === 'combate'` (no basta con existir la key).
  - Mazos: `construirMazoEpisodioDesdeNombres()` (catálogo + `fusionarCartaCompletaDesdeCatalogo` + `escalarCartaSegunDificultad`).
  - Sin recompensas de partida rápida; al terminar escribe `combate_resultado` y vuelve a `episodios.html`.
  - `limpiarEstadoPartidaEnCurso()` **no** borra `episodioActivo` (lo gestiona el engine).

### Herramientas de desarrollo (rama `dev` / Render testing)

**Entorno:** en Render con `RENDER_GIT_BRANCH=dev` (p. ej. `dc-battle-cards-testing.onrender.com`) los editores internos se habilitan automáticamente (`lib/editorGitPush.js` → `esRamaDevRender()`). En **producción (`main`)** no aparecen salvo flags explícitos (`EPISODIOS_EDITOR=1`, etc.).

**Vistas:**
| Vista | URL | Persistencia local servidor |
|-------|-----|----------------------------|
| Editor cartas | `editarCartas.html` | `public/resources/cartas.xlsx` |
| Editor skins | `editarSkins.html` | `public/resources/skins.xlsx` |
| Editor episodios | `crearEpisodios.html` | `public/resources/episodios/*.json` |
| Editor desafíos | `editarDesafios.html` | `public/resources/desafios.xlsx` |
| Editor asaltos | `editarAsaltos.html` | `public/resources/asaltos.xlsx` |
| Editor eventos | `editarEventos.html` | `public/resources/eventos.xlsx` |
| Editor eventos coop | `editarEventosCoop.html` | `public/resources/eventos_online.xlsx` |
| Despliegue | `despliegue.html` | — (push selectivo a rama `main`) |

**Menú de juego (solo dev):** en vistas con `.menu-container` + `cartas.js`, un único enlace **Herramientas Desarrollo** → `editarCartas.html` (`actualizarEnlaceHerramientasDesarrolloMenu`; cola async + limpieza de duplicados; clase `menu-link-dev-tools` con estilo amarillo en `mazos.css` / `app-layout.css`) si:
1. `GET /api/editors/entorno` → `mostrarMenuDevTools: true` (rama Render `dev` o `NODE_ENV !== 'production'`)
2. Email en LS ∈ `{ lorenzopablo93@gmail.com, lailacozar@gmail.com }`

Nunca se muestra en producción (`main` en Render).

**Navegación entre editores:** barra `editor-dev-nav` (`editorDevNav.js`) en cada herramienta con botones **Cartas**, **Skins**, **Episodios**, **Desafíos**, **Asaltos**, **Eventos**, **Eventos Coop**, **Despliegue** y **Volver al juego** (rojo, → `vistaJuego.html`; guardia de cambios sin guardar / sin push). Extensible añadiendo entradas en `DCEditorDevNav.VISTAS`.

**Botón «Subir a GitHub»:** clase `crear-ep-btn--git-pendiente` (amarillo) cuando `GET /api/editors/git-push/pendiente` indica cambios sin commit/push en la rama **dev**. Sigue haciendo push solo a **dev**.

**Registro de sesión:** `editorSessionLog.js` → `localStorage` `dc_editor_session_log_v1` (guardados y pushes desde editores).

**Despliegue (`despliegue.html`):** registro visual de cambios de sesión + lista de archivos de editor distintos entre **dev** y **main**. Botón **Subir a Producción** → modal de confirmación → `POST /api/editors/despliegue/produccion` copia solo rutas de editores (`cartas.xlsx`, `desafios.xlsx`, `asaltos.xlsx`, `eventos.xlsx`, `eventos_online.xlsx`, `skins.xlsx`, `episodios/*.json`) a rama `main`. Requiere `GIT_PUSH_TOKEN` y entorno Render `dev` (`gitPushProduccionPermitido`). Opcional `GIT_PUSH_BRANCH_PROD` (default `main`), `GIT_PUSH_PROD_ENABLED=0` para desactivar.

**Editor desafíos (`editarDesafios.html`):** columnas Excel en orden fijo (`ID_desafio`, `faccion`, `nombre`, `Descripción`, `dificultad`, `enemigo1`…`enemigo6`, `boss`, `mejora`, `mejora_especial`, `puntos`, `cartas`, `tablero`). UI: selector H/V; rejilla 6 enemigos + boss con slots visuales compactos (~180px; recompensa ~160px; `editorCartaPicker.js`); slot recompensa → `cartas`; selector tablero (modal `/api/tableros`, estilo `crearEpisodios`). Carga SheetJS (`xlsx.full.min.js`, igual que `editarCartas.html`) para el catálogo de cartas. Validación cruzada con `cartas.xlsx` (`editarDesafiosModel.nombresCartasEnCatalogoSet`).

**Flujo guardar → GitHub → producción:**
1. **Guardar** / **Guardar Excel** → escribe en disco del servidor (API PUT).
2. **Subir a GitHub** (`editorGitPush.js`) → `git add` + `commit` + `push` a rama `dev` (requiere `GIT_PUSH_TOKEN` en Render).
3. **Despliegue** (`despliegue.html`) → **Subir a Producción** → commit+push de archivos de editor a rama `main`.

**Avisos al salir / cambiar vista:** `DCEditorDevNav.confirmarAntesDeNavegar()` avisa si:
- Hay cambios **sin guardar** en memoria (`state.dirty`), o
- Hay cambios **en disco sin commit/push** (`GET /api/editors/git-push/pendiente?alcance=episodios|cartas|desafios` — `git status` + commits sin push).

También engancha `beforeunload` del navegador.

**Módulos:** `lib/editorGitPush.js` (servidor), `public/js/editorGitPush.js` (modal push dev), `public/js/editorDevNav.js` (nav + guardias), `public/js/editorSessionLog.js` (registro sesión), `public/js/despliegue.js`, `public/js/editorCartaPicker.js`, `public/js/editarDesafiosModel.js`, `public/js/editarDesafios.js`, `public/js/editarAsaltosModel.js`, `public/js/editarAsaltos.js`, `public/js/editarEventosModel.js`, `public/js/editarEventos.js`, `public/js/editarEventosCoopModel.js`, `public/js/editarEventosCoop.js`, `public/js/editarSkinsModel.js`, `public/js/editarSkins.js`.

**Referencias carta con skin (Excel y editores PvE):** en celdas de enemigos/recompensas/asaltos puede guardarse `NombreParent[skin_id]` (misma convención que el juego en `skinsCartas.js`). `editorCartaPicker.js` resuelve miniaturas con skin; con `permitirSkin: true` tras elegir carta abre `abrirModalAparienciaEditor` (todas las apariencias del parent). Validación cliente/servidor vía `validarReferenciaCartaEnCatalogo`.

**Editor skins (`editarSkins.html`):** columnas Excel (`skin_id`, `parent`, `Nombre`, `Salud`, `Poder`, `Imagen`, `Afiliacion`, `skill_*`). Layout 3 columnas como `editarCartas`. Catálogo izquierdo con toggle **grid/lista** (▦/☰) y miniaturas `carta-mini` como `editarCartas`. Parent en ficha: mini ~165px; panel derecho vista previa ~200px (`editar-cartas-preview-wrap`). Parent picker vía `editorCartaPicker.js`; imagen drag-drop. Filtros: nombre, parent.

**Editor asaltos (`editarAsaltos.html`):** `carta1`…`carta12` con picker + skins (`skinsCartas.js`, `seleccionCartaApariencia.js`). Imagen drag-drop; tablero modal. Filtros: nombre, dificultad.

**Editor desafíos / eventos / eventos coop:** slots enemigos (y recompensa en desafíos/eventos) con `permitirSkin: true` y mismos scripts de skins que asaltos. Grid de enemigos: cada slot va en `.editar-desafios-carta-slot-wrap` con etiqueta «Enemigo» o «Carta boss»; el slot boss (`.editar-desafios-carta-slot--boss`) muestra destello naranja cuando tiene `.carta-mini` (`editarDesafios.css`).

**Editor eventos (`editarEventos.html`):** columnas Excel (`ID_evento`, `nombre`, `Descripción`, `enemigo1`…`enemigo6`, `boss`, `mejora`, `mejora_especial`, `puntos`, `cartas`, `tablero`). Sin facción/dificultad.

**Editor eventos coop (`editarEventosCoop.html`):** `enemigo1`…`enemigo8`, `boss`; sin recompensa carta.

**Variables Render (dev):** `GIT_PUSH_TOKEN` (PAT GitHub write); opcional `GIT_PUSH_BRANCH`, `GIT_PUSH_SECRET`, `GIT_USER_NAME`, `GIT_USER_EMAIL`, `GIT_PUSH_REPO_URL`. Documentadas en `render.yaml`.

## Sincronización con Firebase (SyncToken)

- Campos en Firestore (`users/{email}`):
  - `syncToken` (string UUID)
  - `syncUpdatedAt` (timestamp ms)
- Cliente (`public/js/cartas.js`):
  - `actualizarUsuarioConSyncFirebase(usuario, email, { maxIntentos })`
  - `refrescarUsuarioSesionDesdeServidor()`, `fusionarUsuarioSesionTrasUpdate(...)`
  - `js/sesionUnica.js` inyecta `sessionId` en `POST /get-user`, `/update-user`, `/validate-session`
- Servidor (`server.js`):
  - `guardarUsuarioConControlConcurrencia(email, usuarioPayload)`
  - `asegurarMetadataSyncUsuario(email, userData)`
  - Si cliente desactualizado: HTTP **409**, body `{ codigo: 'SYNC_CONFLICT', usuario: <snapshot servidor> }`
  - Regenera `syncToken` + `syncUpdatedAt` en cada guardado exitoso
- **Regla crítica (tienda):** no confiar solo en `syncUpdatedAt` local; el token manda (comentario explícito en servidor).
- Módulos que persisten usuario (usar siempre el helper): `partida.js`, `partidaCoop.js`, `tienda.js`, `mazos.js`, `crearMazos.js`, `mejorarCartas.js`, `opciones.js`, `misionesDiarias.js`, `episodio-engine.js` (recompensas finales).

## Tienda

- Archivo: `public/tienda.js`.
- Rotación global de cartas en tienda:
  - `ROTACION_TIENDA_MS = 2 * 60 * 60 * 1000` (2 h)
  - `VERSION_TIENDA_GLOBAL = 'global-rotation-v2-shop-tabs'`
  - Estado en `usuario.tienda`: `ventanaId`, `version`, listas `cartasHeroes`, `cartasVillanos`, flags `agotada`
- Ofertas del día:
  - `usuario.tienda.ofertasDia`, `ofertasDiaFecha`, `fecha` (día local)
  - UI con barra de progreso hasta siguiente rotación
- Compra:
  - Puede pagar con `usuario.puntos` o con objetos (`mejoraCarta`, `mejoraEspecial`, etc.) según ítem
  - Sobres: claves `sobreH1`…`sobreV3` en `usuario.objetos`
  - Marca oferta `agotada: true`, merge LS antes de guardar, luego `/update-user`
- Al abrir tienda: sincroniza stats de cartas del catálogo sin resetear rotación/agotados.

## Sistema de niveles y habilidades

### Escalado de stats (`js/escaladoStatsCarta.js`)

- Niveles 2–6: **+500 poder** y **+500 salud** por nivel subido (acumulativo desde `nivelBase` del catálogo).
- Nivel 7: +1000 poder, +1500 salud (incremento de ese escalón).
- Nivel 8: +1500 poder, +2000 salud.
- API: `calcularPoderEscaladoDesdeBase`, `calcularSaludEscaladaDesdeBase`, `escalarCartaStatsANivel`, `escalarCartaDeltaDificultad` (usada en `partida.js` como `escalarCartaSegunDificultad`).
- Boss: `escalarBossSegunDificultad` — multiplicadores extra de vida (×8 base, ×1.75 en `SaludMax`).

### Habilidades en combate (`partida.js` / `partidaCoop.js`)

- Campos en carta: `skill_name`, `skill_info`, `skill_class`, `skill_trigger`, `skill_power` (recalculado con `recalcularSkillPowerPorNivel`).
- Clases reconocidas en motor (lista de referencia, ver también `DCFiltrosCartas`):
  - `aoe`, `extra_attack`, `buff`, `bonus_buff`, `debuff`, `bonus_debuff`, `heal_debuff`, `revive`, `heal`, `heal_all`, `life_steal`, `shield`, `shield_aoe`, `tank`, `stun`, `dot`
- Alias corregido en parseo: `heall_all` → `heal_all`.
- Módulo auxiliar: `js/healDebuffCombat.js` (factor de curación/debuff en combate).
- PvP: habilidades sincronizadas por socket; coop usa snapshots + metadata de acción.

### Visual nivel 8 y estrellas

- Holo: `DC_NIVEL_MIN_CARTA_HOLO = 8`, clase CSS `carta-holo`, estilos `css/carta-holo.css`, animación sincronizada globalmente.
- Estrellas: `dcRellenarEstrellasCartaCompleta` — niveles 1–5 estrellas clásicas; 6/7/8 usan iconografía especial (`star6`, etc.).

## Recompensa diaria

- Implementación: `procesarRecompensaDiariaGlobal()` en `public/js/cartas.js` (DOMContentLoaded de vistas con `cartas.js`).
- **No** duplicar en `jugarPartida.js` (comentario explícito: evita doble modal).
- Constantes: `RECOMPENSA_DIARIA_CHECK_INTERVAL_MS = 60_000`, lock `dc_daily_reward_claim_lock_v1`.
- Persistencia: `usuario.recompensas.diariaSobres.lastClaimAt` + respaldo LS `dc_diaria_last_claim_at_v1`.
- Modal ack por sesión: `dc_daily_reward_modal_ack_claim_ts` (sessionStorage).
- Recompensa típica: sobres H1/V1 (ver lógica en `persistirUsuarioConRecompensaDiaria`).
- UI: temporizador en perfil del menú lateral (`menu-mobile.js` / panel perfil).

## RGB color custom por jugador

- Gestión principal en `public/opciones.js` (selector/guardado).
- Aplicación global desde `public/js/cartas.js` via CSS vars:
  - `--dc-accent-user-rgb`
  - `--dc-accent-user`
- Impacta estilo visual en múltiples vistas y componentes.

## Filtros de búsqueda (vistas)

- Núcleo de skill-class/filtros: `public/js/filtrosCartas.js`.
- Implementaciones en:
  - `coleccion.js`
  - `crearMazos.js`
  - `mejorarCartas.js`
  - modales de selección en eventos/desafíos/coop.
- Criterios comunes:
  - nombre
  - afiliación
  - ordenar por poder
  - tipo de habilidad (`skill_class`)
  - pestañas Héroes/Villanos.

## Crear mazos (crearMazos)

- Selección de cartas con límites y reglas de facción.
- Selector de apariencias integrado (`public/js/seleccionCartaApariencia.js`).
- Conteo de poder total y feedback visual por rango.

## Red Dot (nuevas cartas)

- API en `js/menu-mobile.js`: `DCRedDot.attachCardBadge`, `markSeen`, `refresh`, `hasUnseenPacks`, `markPacksSeen`.
- Eventos que refrescan: `dc:usuario-actualizado`, `storage`, `focus`, `visibilitychange`.
- Colección: pestaña sobres con indicador “Nuevo” (`coleccion.js`).
- Tras compras/mejoras/sobres: llamar `DCRedDot.refresh()` cuando corresponda.

## Colección y sobres

- `coleccion.js` + `js/sobresCartas.js`: apertura de sobres, cartas nuevas con facción H/V explícita.
- Deduplicación por nombre parent para progreso de colección (no contar skins como cartas distintas).
- Filtros: tabs H/V, nombre, afiliación, orden poder, `skill_class` (`DCFiltrosCartas`).

## Misiones diarias/semanales

- `js/misionesDiarias.js` → `window.DCMisiones`.
- Track con cola FIFO (evita carreras al encadenar eventos).
- Tipos usados en combate: `bot`, `bot_defeat`, `boss`, `desafios`, `coleccion_h`, `coleccion_v`, `online`, `mejorar_cartas_*`, etc.
- Coop/PvP: `registrarPartidaOnlineCompletada` al finalizar partida.

## Edición de mazos (mazos)

- Renombrado, reemplazo de cartas/apariencias y borrado.
- Persistencia con sync para evitar conflictos de estado.

## Mejorar Cartas (mejorarCartas)

### Mejora clásica

- Combina duplicados para subir nivel según reglas actuales.

### Destruir repetidas

- Convierte duplicados en monedas/puntos con tabla por nivel.

### Mejoras especiales

- Objetos:
  - `mejoraCarta`
  - `mejoraEspecial`
  - `mejoraSuprema`
  - `mejoraDefinitiva`
- Reglas por nivel implementadas en `mejorarCartas.js`.

### Fragmentos (niveles 7 y 8)

- `mejoraElite` para nivel 7.
- `mejoraLegendaria` para nivel 8.

## Reglas de Oro

- No tocar `partida.js` sin validar todos los modos (BOT, desafío, asalto, PvP, episodios).
- Mantener invariantes de `localStorage` (flags de modo mutuamente consistentes).
- Toda escritura de `usuario` debe pasar por flujo con sync/concurrencia.
- No romper contratos de sockets (`multiplayer:pvp:*`, `multiplayer:coop:*`, `grupo:*`, `trade:*`).
- Si se cambia estructura de `usuario` o Excel, actualizar parseos/migraciones cliente+servidor.
- Evitar introducir lógica nueva que dependa de campos ambiguos sin normalización (`boss/Boss/BOSS`, `faccion/Faccion`, etc.).

## Riesgos y Acoplamientos Críticos

- Alto acoplamiento entre módulos por uso compartido de LS.
- Coexistencia de flujos legacy y modernos en sockets.
- Múltiples puntos de escritura de `usuario` (tienda, combate, misiones, diario, mejora, admin).
- Dependencia de formato/columnas de Excel para reglas de juego.

## Checklist Rápido Post-Cambio

- Sesión única: reemplazo sesión entre pestañas.
- Sync 409: conflicto y merge correcto.
- VS BOT: arranque, combate, recompensa, retorno.
- PvP: lobby -> sesión -> tablero -> cierre.
- Desafío camino: selección 6 cartas + boss + recompensa.
- Evento hub: rotación 4 eventos + modal selección + `tipo:'evento'`.
- Asalto 6/7/8: entrada, dificultad, recompensa.
- Coop online: invitación, preparación, sincronía de combate, recompensa para ambos.
- Episodios: cutscene -> combate -> reanudar -> recompensa.
- Tienda: compra cartas/objetos/ofertas, puntos e inventario.
- Mejorar cartas: clásica, especiales y fragmentos.
- Filtros: nombre/afiliación/poder/habilidad/H-V en todas las vistas relevantes.
- Color RGB: persistencia y aplicación global.
- Recompensa diaria: timer, bloqueo y no doble claim.

## Referencias técnicas clave (rutas)

- Backend: `server.js`
- Socket client core: `public/cliente.js`
- Sync y utilidades globales: `public/js/cartas.js`
- Sesión única: `public/js/sesionUnica.js`
- Hub: `public/vistaJuego.html`, `public/jugarPartida.js`
- Combate principal: `public/tablero.html`, `public/partida.js`
- Coop: `public/tablero_coop.html`, `public/partidaCoop.js`, `public/multijugadorEventosCoop.js`
- PvP/lobby: `public/multijugador.js`
- Desafíos camino: `public/desafios.js`
- Eventos hub: `public/jugarPartida.js` (`eventos.xlsx`)
- Asaltos: `public/js/asaltos.js`
- Episodios: `public/episodios.html`, `public/js/episodios.js`, `public/js/episodio-engine.js`
- Editor episodios (oculto): `public/crearEpisodios.html`, `public/js/crearEpisodios.js`, `public/js/crearEpisodiosModel.js`, `public/js/editorGitPush.js`
- Editor cartas (oculto): `public/editarCartas.html`, `public/js/editarCartas.js`, `public/js/editarCartasModel.js`, `public/js/editorGitPush.js` — edita `public/resources/cartas.xlsx` (mismas columnas que el Excel del juego); previsualización `carta-mini` vía `cartas.js`
- Editor desafíos (oculto): `public/editarDesafios.html`, `public/js/editarDesafios.js`, `public/js/editarDesafiosModel.js`, `public/js/editorCartaPicker.js` — edita `public/resources/desafios.xlsx`
- Editor asaltos (oculto): `public/editarAsaltos.html`, `public/js/editarAsaltos.js`, `public/js/editarAsaltosModel.js` — edita `public/resources/asaltos.xlsx`; 12 slots de cartas (todas normales, sin boss), imagen drag-drop, tablero modal
- Editor eventos (oculto): `public/editarEventos.html`, `public/js/editarEventos.js`, `public/js/editarEventosModel.js` — edita `public/resources/eventos.xlsx`; 6 enemigos + boss, slot recompensa, tablero modal
- Editor eventos coop (oculto): `public/editarEventosCoop.html`, `public/js/editarEventosCoop.js`, `public/js/editarEventosCoopModel.js` — edita `public/resources/eventos_online.xlsx`; 8 enemigos + boss, sin recompensa de carta, tablero modal
- Editor skins (oculto): `public/editarSkins.html`, `public/js/editarSkins.js`, `public/js/editarSkinsModel.js` — edita `public/resources/skins.xlsx`; parent card picker (modal catálogo), imagen drag-drop, preview de carta renderizada, campos skill completos
- Git push editores: `lib/editorGitPush.js` (servidor) — incluye rutas para asaltos.xlsx, eventos.xlsx, eventos_online.xlsx, skins.xlsx en despliegue a producción
- Tienda: `public/tienda.js`
- Crear/editar mazos: `public/crearMazos.js`, `public/mazos.js`
- Mejoras: `public/mejorarCartas.js`
- Colección: `public/coleccion.js`
- Escalado stats: `public/js/escaladoStatsCarta.js`

## Nota de mantenimiento

- Este archivo debe actualizarse cada vez que:
  - se añada un modo de juego nuevo,
  - cambie la estructura de `usuario`,
  - cambien keys de `localStorage`,
  - se modifique el contrato de sockets/API,
  - se alteren reglas de escalado/recompensas/progreso.

## Apéndice A: Matriz de Modos (rápida)

| Modo | Entrada | Flags LS / detección | Motor | Recompensa |
|------|---------|----------------------|-------|------------|
| Partida rápida / VS BOT | `jugarPartida.js` | Sin `partidaModo`, sin `desafioActivo`, sin `asaltoActivo`, sin PvP, sin episodio en combate | `partida.js` | `otorgarRecompensasVictoria` |
| Desafío camino | `desafios.js` | `desafioActivo` (≠ evento hub) | `partida.js` | `otorgarRecompensasDesafio` |
| Evento hub | `jugarPartida.js` | `desafioActivo` con `tipo: 'evento'` | `partida.js` | recompensa evento + `eventosJugadosPorRotacion` |
| Asalto | `js/asaltos.js` | `partidaModo=asalto`, `asaltoActivo.tipo=asalto` | `partida.js` | `otorgarRecompensasAsalto` |
| PvP | `multijugador.js` | `partidaModo=pvp` o `partidaPvpSessionId` | `partida.js` | ninguna PvE; misión `online` |
| Coop online | `multijugadorEventosCoop.js` | `partidaModo=coop_evento_online` | `partidaCoop.js` | por jugador al ganar |
| Episodio | `episodio-engine.js` | `episodioActivo.estado==='combate'` → `ES_MODO_EPISODIO` | engine + `partida.js` | bloque `recompensa` del JSON al final |
| Escena (timeline) | JSON `type: escena` | — | `episodio-engine.js` (overlay cutscene) | — |

### Constantes de detección en `partida.js` (orden de precedencia)

1. `HAY_DESAFIO_ACTIVO_STORAGE` → si hay `desafioActivo` en LS, **no** es PvP por flags base.
2. `ES_MODO_PVP` = `partidaModo==='pvp'` o `partidaPvpSessionId`.
3. `ES_MODO_ASALTO` = `partidaModo==='asalto'` + `asaltoActivo.tipo==='asalto'`.
4. `ES_MODO_EPISODIO` = `episodioActivo` válido + `estado==='combate'`.
5. `esPartidaRapidaVsBot()` = ninguno de los anteriores + `!estadoDesafio.activo`.

## Apéndice B: Contratos API clave

- `POST /login`
  - Input: credenciales
  - Output: `usuario`, `email`, `sessionId` (si OK)
- `POST /register`
  - Input: datos alta
  - Output: alta + sesión inicial
- `POST /get-user`
  - Input: `email`, `sessionId`
  - Output: snapshot usuario
- `POST /validate-session`
  - Input: `email`, `sessionId`
  - Output: validez de sesión
- `POST /update-user`
  - Input: `email`, `usuario`, `sessionId`, opcional metadata sync
  - Output: usuario guardado o `409 SYNC_CONFLICT`
- `GET /api/tableros`
  - Output: lista de fondos disponibles
- `GET /api/episodios/catalogo`
  - Output: `{ episodios: [{ evento_id, nombre, descripcion, imagen, jsonPath, archivo }] }` — metadatos carrusel desde cada JSON en `public/resources/episodios/` (`mostrar_carrusel !== false`, `evento_id` único)
- Editor episodios (`crearEpisodios.html`; requiere `NODE_ENV !== 'production'`, `EPISODIOS_EDITOR=1` o `RENDER_GIT_BRANCH=dev`):
  - `GET /api/episodios-editor/habilitado` → `{ habilitado, gitPush? }`
  - `GET /api/episodios-editor/archivos` · `GET /api/episodios-editor/archivo/:nombre`
  - `PUT /api/episodios-editor/archivo/:nombre` body `{ data: object }`
  - `POST /api/episodios-editor/archivo` body `{ nombre, data }`
  - `GET /api/episodios-editor/recursos` → `{ bustos, fondos, tableros }`
  - `POST /api/episodios-editor/git-push` body `{ mensaje?, token? }` — commit+push JSON episodios (requiere `GIT_PUSH_TOKEN` en servidor)
- Editor cartas (`editarCartas.html`; `CARTAS_EDITOR=1`, `EPISODIOS_EDITOR=1`, rama `dev` o no producción):
  - `GET /api/cartas-editor/habilitado` → `{ habilitado, gitPush? }`
  - `GET /api/cartas-editor/catalogo` → `{ columnas, filas, skillClasses }`
  - `PUT /api/cartas-editor/catalogo` body `{ columnas?, filas }` — valida y escribe `public/resources/cartas.xlsx`
  - `POST /api/cartas-editor/git-push` body `{ mensaje?, token? }` — commit+push `cartas.xlsx`
- Editor desafíos (`editarDesafios.html`; misma habilitación que cartas / rama `dev`):
  - `GET /api/desafios-editor/habilitado` → `{ habilitado, gitPush? }`
  - `GET /api/desafios-editor/catalogo` → `{ columnas, filas }`
  - `PUT /api/desafios-editor/catalogo` body `{ columnas?, filas }` — valida y escribe `public/resources/desafios.xlsx`
  - `POST /api/desafios-editor/git-push` body `{ mensaje?, token? }`
- Editor asaltos (`editarAsaltos.html`; misma habilitación):
  - `GET/PUT /api/asaltos-editor/catalogo` — `public/resources/asaltos.xlsx`
  - `POST /api/asaltos-editor/git-push`
- Editor eventos (`editarEventos.html`; misma habilitación):
  - `GET/PUT /api/eventos-editor/catalogo` — `public/resources/eventos.xlsx`
  - `POST /api/eventos-editor/git-push`
- Editor eventos coop (`editarEventosCoop.html`; misma habilitación):
  - `GET/PUT /api/eventos-online-editor/catalogo` — `public/resources/eventos_online.xlsx`
  - `POST /api/eventos-online-editor/git-push`
- Editor skins (`editarSkins.html`; misma habilitación):
  - `GET/PUT /api/skins-editor/catalogo` — `public/resources/skins.xlsx`
  - `POST /api/skins-editor/git-push`
- Git push editores (compartido):
  - `GET /api/editors/entorno` → `{ esDev, mostrarMenuDevTools, editoresHabilitados, rama, ramaDevRender }`
  - `GET /api/editors/git-push/estado` → `{ habilitado, rama, requiereTokenCliente, ramaDevRender }`
  - `GET /api/editors/git-push/pendiente?alcance=episodios|cartas|desafios|asaltos|eventos|eventosCoop|skins` → `{ pendiente, motivo? }` (`sin_commit` | `sin_push`)
  - `GET /api/editors/despliegue/habilitado` · `GET /api/editors/despliegue/resumen` · `POST /api/editors/despliegue/produccion` body `{ mensaje?, token?, archivos? }` — push archivos de editor a rama `main`
  - Lógica servidor: `lib/editorGitPush.js`. Env: `GIT_PUSH_TOKEN` (PAT GitHub), opcional `GIT_PUSH_BRANCH`, `GIT_PUSH_BRANCH_PROD`, `GIT_PUSH_PROD_ENABLED`, `GIT_PUSH_SECRET`, `GIT_PUSH_REPO_URL`, `GIT_USER_NAME`, `GIT_USER_EMAIL`
  - UI cliente: `editorGitPush.js`, `editorDevNav.js`, `editorSessionLog.js`, `despliegue.js`; menú dev en `cartas.js` (`DEV_TOOLS_MENU_EMAILS`)
- `POST /admin/users/list`, `/admin/user/get`, `/admin/user/update`
  - Solo cuenta admin (`opciones.js`); mismo control de sync que `/update-user`

## Apéndice C: Eventos Socket (mapa mínimo)

- Sesión/registro:
  - `registrarUsuario`, `socket:registrado`, `sesion:invalida`
- Grupo/chat:
  - `grupo:estado`, `grupo:invitacion`, `mensajeChat`, `chatHistorial`, `grupo:redirigirMultijugador`
- Lobby PvP:
  - `multiplayer:lobby:*`, `multiplayer:session:start`
- PvP combate:
  - `multiplayer:pvp:join`, `multiplayer:pvp:estado:*`, `multiplayer:pvp:accion:*`, `multiplayer:pvp:resultado:*`
- Coop online:
  - `coop:evento:*`, `multiplayer:coop:session:start`, `multiplayer:coop:estado:*`, `multiplayer:coop:accion:*`
- Trade:
  - `trade:*`

## Apéndice D: Orden de Carga por Vista (resumen operativo)

- `login.html` → `sesionUnica.js` → `main.js` (POST `/login`, guarda `usuario`/`email`/`sessionId`).
- `vistaJuego.html` (script al inicio: `removeItem mazoOponente`, `nombreOponente`):
  - `escaladoStatsCarta`, `carrusel3d`, `sesionUnica`, `cartas`, `filtrosCartas`, `skinsCartas`, `seleccionCartaApariencia`, `sobresCartas`, `misionesDiarias`, `limpiarPvpPartidaLocal`, `tableroFondo`, `tradeGrupo`, `cliente`, `jugarPartida`.
- `tablero.html`:
  - XLSX, `socket.io`, `cliente`, `tradeGrupo`, `escaladoStatsCarta`, `sesionUnica`, `cartas`, `skinsCartas`, `misionesDiarias`, `limpiarPvpPartidaLocal`, `tableroFondo`, **`healDebuffCombat`**, `partida.js`.
- `tablero_coop.html` → `partidaCoop.js` (+ render coop, fondos, limpieza coop).
- `multijugador.html` → `cliente`, `multijugador.js`, `multijugadorEventosCoop.js`.
- `episodios.html` → `cartas`, `episodiosCapitulos`, `episodiosProgreso`, `episodiosRequisitos`, `episodios.js`, `episodio-engine.js`.

## Apéndice E: Modelo `usuario` (campos críticos)

- Identidad/sesión:
  - `email`, `nickname`, `avatar`, metadata de sync
- Progreso:
  - `puntos`, `cartas`, `mazos`, `misiones`, `eventosJugadosPorRotacion`
- Inventario:
  - `objetos` (mejoras, fragmentos, sobres)
- Personalización:
  - `skinsObtenidos`, `preferencias.colorPrincipal`
- Tienda:
  - estado de rotaciones/ofertas y agotados

## Apéndice F: Playbook de Diagnóstico Rápido

- Si se rompen recompensas:
  - revisar `partida.js` (rama de modo) + `cartas.js` (sync) + respuesta `/update-user`.
- Si se rompen modos al entrar a `tablero`:
  - revisar colisión de flags (`partidaModo`, `desafioActivo`, `asaltoActivo`, `episodioActivo`, `partidaPvpSessionId`).
- Si hay desync multi-dispositivo:
  - confirmar manejo de `409 SYNC_CONFLICT` y merge cliente.
- Si falla coop/pvp:
  - validar revisiones de estado, room/session id y orden de eventos socket.
- Si hay stats incorrectos por nivel:
  - revisar `escaladoStatsCarta.js`, `partida.js`, y el origen de nivel en el modo concreto.

## Apéndice G: Deuda Técnica / Zonas delicadas

- `LEGACY_SOCKET_COMBATE_ACTIVO = false` en `server.js` — handlers viejos (`unirseSala`, `realizarAtaque`…) desactivados; flujo moderno es `multiplayer:*` / coop.
- **`desafioActivo` compartido** por desafíos camino y eventos hub (diferenciar por `tipo` y origen).
- Claves de rotación de eventos **no mezclar**: `event-rotation-v1` (offline), `event-rotation-coop-online-v1` (coop), `asaltos-rotation-v2-monday` (asaltos).
- Convivencia código legacy en `cliente.js` (`invitacionJuego`, `redirigirTablero`) vs lobby moderno.
- Escritura paralela de `usuario` desde muchos módulos.
- `cartas.js` con muchas responsabilidades globales (riesgo de efectos colaterales).
- Dependencia total de Excel para reglas; variantes de columnas (`boss`/`Boss`, `faccion`/`Faccion`) requieren normalización.

---

## Apéndice H: Rotaciones y timers

| Sistema | Intervalo | Constante / clave |
|---------|-----------|-------------------|
| Eventos hub | 1 h | `ROTACION_EVENTOS_MS`, `event-rotation-v1` |
| Eventos coop | 1 h (misma ventana que hub en admin) | `event-rotation-coop-online-v1` |
| Tienda global | 2 h | `ROTACION_TIENDA_MS`, `global-rotation-v2-shop-tabs` |
| Asaltos | Semanal (lunes 00:00 local) | `asaltos-rotation-v2-monday` |
| Recompensa diaria | Cooldown propio + check cada 60 s | `RECOMPENSA_DIARIA_*` |
| Consejos hub | 9,5 s auto | `ROTACION_CONSEJOS_MS` en `jugarPartida.js` |

---

## Apéndice I: Mejoras — reglas por objeto (`mejorarCartas.js`)

| Key `usuario.objetos` | Uso |
|----------------------|-----|
| `mejoraCarta` | Solo cartas 1★–3★ → +1 nivel (tope 4★) |
| `mejoraSuprema` | Niveles 1–4 → salta a 5★ |
| `mejoraEspecial` | Solo 5★ → 6★ |
| `mejoraDefinitiva` | Niveles 1–5 → salta a 6★ |
| `mejoraElite` | Fragmento: sube a 7★ |
| `mejoraLegendaria` | Fragmento: sube a 8★ |

- Normalización legacy: claves antiguas del inventario se mapean a estas en carga.
- Destrucción duplicados: tabla de puntos por nivel (`obtenerValorDestruccion`).
- Pestañas H/V + orden por poder en paneles de mejora.

---

## Apéndice J: Grupos, trade y chat

- `cliente.js`: socket único, `registrarUsuario`, chat global (`mensajeChat`, `chatHistorial`).
- Grupo: `grupo:estado`, invitaciones, redirección a multijugador.
- Trade: eventos `trade:*` vía `js/tradeGrupo.js`.
- Perfil en menú: `js/perfilModal.js`, snapshot `dc_menu_profile_snapshot_v1`.

---

## Apéndice K: Correcciones respecto a borrador anterior

- **Eventos del hub** no vienen de `desafios.xlsx` sino de `eventos.xlsx`.
- **Partida rápida** es un subconjunto de VS BOT detectado por `esPartidaRapidaVsBot()`, no un `partidaModo` aparte.
- **Episodio en tablero** requiere `episodioActivo.estado === 'combate'`, no solo existir `episodioActivo`.
- **Login** entra por `login.html` + `main.js`, no solo “main genérico”.
- **Recompensa diaria** persiste en `usuario.recompensas.diariaSobres`, no solo en LS.
