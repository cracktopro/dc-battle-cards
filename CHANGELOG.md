# Changelog

## 1.2.3

- Etiqueta de versión del menú lateral: **`Versión: 1.2.3`** (`public/js/cartas.js`, `package.json`).
- **Navegación de mazos**: eliminados «Crear Mazos» y «Mejorar Cartas» del menú lateral global; barra de enlaces con estilo `faccion-tab` en `mazos.html`, `crearMazos.html` y `mejorarCartas.html` (páginas independientes, sin hub unificado).
- **Cartas** (`public/js/cartas.js`): corrección al deduplicar ítems del usuario por índice numérico.
- **Apariencias / mazos** (`public/js/seleccionCartaApariencia.js`, `public/css/mazos.css`): ajustes de skins, destrucción de duplicados y modales.

## 1.2.1

- Etiqueta de versión del menú lateral: **`Versión: 1.2.1`** (`public/js/cartas.js`, `package.json`).
- Habilidades y `skill_power`: fórmulas con `poder`/`salud` y aritmética; `aoe`/`extra_attack` con poder efectivo y tooltips; buff/debuff/bonus_buff sin escalar por bonos de mesa; tienda sincroniza ofertas con el Excel al abrir.

## 1.2.0

- Etiqueta de versión del menú lateral: **`Versión: 1.2.0`** (`public/js/cartas.js`, `package.json`).
- Mejora con fragmentos: sin alert Bootstrap de éxito al finalizar (la animación ya confirma el resultado).

## 1.1.1

- Etiqueta de versión del menú lateral: **`Versión: 1.1.1`** (`public/js/cartas.js`, `package.json`).
- **Eventos (offline VS BOT y cooperativo online) — puntos de recompensa** (`public/js/cartas.js`, `public/partida.js`, `public/partidaCoop.js`): los puntos del Excel (`eventos.xlsx` / `eventos_online.xlsx`) se interpretan como el total a **dificultad 6**; a menor dificultad se otorga la parte proporcional `(dificultad / 6) × puntosExcel` (redondeo entero). Cartas y objetos de mejora no cambian.

## 1.1.0

- Etiqueta de versión del menú lateral: **`Versión: 1.1.0`** (`public/js/cartas.js`, `package.json`).
- **Tienda** (`public/tienda.html`, `public/tienda.js`): objetos de mejora **suprema** y **definitiva** en la sección de objetos; persistencia en `usuario.objetos` (`mejoraSuprema`, `mejoraDefinitiva`); iconos `public/resources/icons/mejora_suprema.png`, `mejora_definitiva.png`.
- **Mejorar cartas — Mejoras especiales** (`public/mejorarCartas.html`, `public/mejorarCartas.js`, `public/css/mazos.css`): panel unificado de cartas 1★–5★; resumen con cuatro contadores; **modal de elección de objeto** con reglas por nivel (mejora +1 hasta 5★, especial 5→6★, suprema a 5★, definitiva a 6★); antes/después en modal de resultado; normalización de inventario e inventario legacy para las nuevas claves; pestañas **Héroes | Villanos** y checkbox **Ordenar por poder** (por defecto orden alfabético estable).
- **Menú lateral / perfil** (`public/js/cartas.js`, `public/css/mazos.css`): una sola fila con los **cuatro** objetos de mejora (icono + cantidad).
- **Opciones — panel administrador** (`public/opciones.html`, `public/opciones.js`): campos numéricos para editar **mejora suprema** y **mejora definitiva** del usuario cargado; reinicio de progreso incluye esas claves.
- **Cuenta atrás unificada** (`public/js/cartas.js`): helper global `dcFormatearCuentaAtrasMs`; **misiones diarias / semanales**, **rotación de eventos** (`public/jugarPartida.js`, `public/css/jugarPartida.css`) y **rotación coop** (`public/multijugadorEventosCoop.js`, `public/multijugador.html`) reutilizan el mismo formato; textos placeholder en `public/vistaJuego.html` (“Nuevos eventos en:”, `0s`).
- **Catálogo** (`public/resources/cartas.xlsx`): datos actualizados en repositorio.

## 1.0.3

- Etiqueta de versión del menú lateral: **`Versión: 1.0.3`** (`public/js/cartas.js`, `package.json`).
- **Eventos cooperativos online — progreso “completado”** (`public/multijugadorEventosCoop.js`, `public/partidaCoop.js`): clave de rotación en `eventosJugadosPorRotacion` con prefijo propio `event-rotation-coop-online-v1`, separada de los eventos offline (`event-rotation-v1`), para no marcar como jugados eventos coop por IDs cruzados con VS BOT.
- **Rotación de eventos — siempre 4 paneles** (`public/jugarPartida.js`, `public/multijugadorEventosCoop.js`): ventana circular `start = (idVentana * 4) % N`; si el final del Excel no llena 4 huecos, se reenvuelve al inicio del catálogo (misma hora / `idVentana` y claves de rotación sin cambios).
- **Recursos Excel** (`public/resources/eventos.xlsx`, `eventos_online.xlsx`): actualización en repositorio.

## 1.0.2

- Etiqueta de versión del menú lateral: **`Versión: 1.0.2`** (`public/js/cartas.js`, `package.json`).
- **Servidor** (`server.js`): corrección de `GET` post-guardado en `POST /update-user` (`docRef` indefinido → 500 tras guardado correcto en Firebase). Lectura de columna **boss** en eventos online con variantes `boss` / `Boss` / `BOSS`; misma idea en construcción de mazo coop desde evento.
- **Misiones diarias** (`public/js/misionesDiarias.js`): cola **FIFO** para `DCMisiones.track` y evitar condiciones de carrera cuando se encadenan varios eventos (p. ej. sobres + `coleccion_h` + `coleccion_v`) que pisaban el progreso en persistencia.
- **Colección / sobres** (`public/js/sobresCartas.js`, `public/js/cartas.js`): cartas del sobre llevan **facción H/V** explícita; contador `dcContarCartasNuevasPorFaccion` admite más variantes de campo de facción en carta y catálogo (`dcLeerFaccionHVBruta`).
- **Misión class boss** (`public/partida.js`, `public/partidaCoop.js`, `public/jugarPartida.js`, `public/desafios.js`, `public/multijugadorEventosCoop.js`): lectura robusta del nombre de boss; rehidratación de `desafioActivo` desde LS al otorgar recompensas; `obtenerDesafioActivo` normaliza `enemigos` a array vacío; coop devuelve `huboBossMision` desde recompensas para `track('boss')`.
- **Combate** (`public/partida.js`, `public/partidaCoop.js`): al confirmar **ataque básico**, se consume de inmediato la selección de atacante / objetivo y se ignoran clics repetidos mientras hay animación (evita múltiples `resolverAtaque` o doble envío PvP); coop limpia selección de atacante antes de resolver el golpe al BOT.
- **Recursos Excel** (`public/resources/cartas.xlsx`, `eventos.xlsx`, `eventos_online.xlsx`, `misiones_diarias.xlsx`): datos y misiones actualizados en el repositorio.

## 1.0.1

- Etiqueta de versión del menú lateral: **`Versión: 1.0.1`** (`public/js/cartas.js`).
- Sincronización multi-dispositivo: `syncToken` / `syncUpdatedAt` en Firestore; `/update-user` y guardado admin rechazan escrituras obsoletas con **409**; respuesta con `usuario` actualizado; clientes fusionan estado local (`server.js`, `partida.js`, `partidaCoop.js`, `misionesDiarias.js`, `tienda.js`, `coleccion.js`, `mejorarCartas.js`, `mazos.js`, `crearMazos.js`, `opciones.js`, `cartas.js`).
- Opciones — panel administrador (`lorenzopablo93@gmail.com`): gestión de usuarios (listar, cargar, editar puntos, mejoras, inventario de **sobres** `sobreH1`…`sobreV3`, cartas con vista previa, guardado vía `/admin/*`); layout a ancho completo bajo el resto de paneles; escalado de nivel alinea **poder, salud y skill** con `recalcularSkillPowerPorNivel`; corrección de sintaxis `??`/`||` en `escalarCartaANivel`.
- Endpoints admin en servidor: `POST /admin/users/list`, `/admin/user/get`, `/admin/user/update` (solo cuenta admin); refactor interno de guardado con control de concurrencia.

## 1.0.0

- Etiqueta de versión del menú lateral: formato **`Versión: 1.0.0`** (sustituye el esquema anterior `Version: Beta-…-fecha`).
- Coop online: las recompensas y el progreso de misiones (diarias, boss, colección) se aplican de forma coherente en ambos jugadores; el guardado de misiones fusiona con el usuario más reciente en `localStorage` para no pisar en Firebase puntos, cartas u objetos (`misionesDiarias.js`, `partidaCoop.js`).
- Desafíos (`partida.js`): objetos **mejora** y **mejora especial**, y **cartas de recompensa** del desafío o evento, solo en la **primera** victoria (o primera vez del evento en la ventana de rotación); en repeticiones siguen otorgándose los **puntos**.

## Beta-1.0.13-08.05.26

- Vista `vistaJuego`: panel **Consejos** con carrusel automático (Excel `resources/consejos.xlsx`), flechas, dots y texto con resaltado `$…$` según color RGB del jugador.
- Recompensa diaria (sobres H1/V1): temporizador y barra de progreso en el perfil del menú lateral; procesamiento global desde `cartas.js` con modal en todas las vistas; corrección de conflicto `RECOMPENSA_DIARIA_COOLDOWN_MS` en `jugarPartida.js`; persistencia de payload reducido para `/update-user`; `server.js`: límite JSON/urlencoded a 5 MB para evitar 413.
- Mejorar cartas (`mejorarCartas`): pestaña **Destruir cartas repetidas** separada de la mejora clásica; botón **Combinar todas las cartas duplicadas** sin destruir duplicados de nivel máximo; destrucción masiva con tabla de puntos (50–400 por nivel) y modal de resumen con icono de moneda; panel informativo con estilo de juego (`.panel-info-destruccion-duplicados`).
- Colección (`coleccion.js`): el catálogo se deduplica por nombre (se prioriza mayor nivel / poder) para no mostrar filas duplicadas; nombres conseguidos normalizados con la misma clave.
- Tablero / render de cartas: `background-position: center top` en estilos y en JS donde aplica, para alinear el arte de la carta.
- Coop online: ajustes de latencia del BOT, layout en `tablero_coop.css` e indicadores de **bonus de afiliación** (y anulación en rojo) alineados con otros modos.
- Etiqueta de versión del menú lateral actualizada a `Version: Beta-1.0.13-08.05.26`.

## Beta-1.0.12-05.05.26

- Coop online (`server.js`): endurecidas las validaciones de inicio de sesión coop (`iniciarSesionCoopEventoDesdePrep`) — se valida catálogo de cartas cargado, selecciones de cartas no vacías de ambos jugadores y conexión activa de líder y miembro, con `console.error` específico en cada fallo y `try/catch` alrededor de `construirSnapshotInicialCoopServidor`.
- Coop online (`server.js`): se relaja el mínimo de enemigos del BOT — si el evento define < 4 enemigos normales pero hay BOSS, el BOSS se usa como una de las 4 cartas iniciales del tablero (`bossPendienteCoop = null`) y solo se rechaza si `enemigos + boss < 4`.
- Coop online (`server.js`): handler `coop:evento:preparacion:listo` envuelto en `try/catch` y limpieza garantizada de `preparacionesCoopEvento.delete(prep.prepId)` en cualquier resultado; ambos clientes reciben `grupo:notificacion` con mensaje claro si el inicio falla.
- Coop online (`public/multijugadorEventosCoop.js`): modales de selección de personaje replican el formato de eventos/desafíos VS BOT (pestañas Héroes/Villanos, filtro de afiliación, `carta-mini` con estrellas, poder, badges de habilidad/afiliación y barra de salud); helpers locales para no introducir dependencias entre módulos.
- Coop online (`public/multijugador.html` + `public/multijugadorEventosCoop.js`): grid de eventos coop con descripción arriba, etiqueta de enemigos sobre las cartas, recompensas y dificultad fijadas abajo; eventos ya jugados se marcan como `completado` y se inhabilita la invitación.
- Coop online (`public/multijugador.html`): se añade `<link href="css/salud.css">` para que la barra de salud del modal de selección coop se renderice con el estilo correcto.
- Coop online — Recompensas (`public/partidaCoop.js`, `public/css/tablero_coop.css`, `public/tablero_coop.html`): al ganar la partida ambos jugadores reciben puntos, mejoras, mejora especial y carta del evento (escalada por dificultad), se marca el evento como jugado en `eventosJugadosPorRotacion` y se persiste en Firebase + `localStorage`. Modal final muestra mensaje "Guardando recompensas…" y tarjeta de recompensas con el mismo formato que VS BOT.
- Coop online — Latencia BOT (`public/partidaCoop.js`): cadencia específica del turno BOT (`COOP_MS_PRE_IMPACTO_BOT = 380`, `COOP_MS_POST_IMPACTO_BOT = 480`) sin tocar la cadencia de los ataques humanos; bloqueo P2→BOT reducido a `COOP_MS_POST_IMPACTO_BOT + 80`; `COOP_MS_RESPIRO_TRAS_ULTIMO_ATAQUE_BOT` reducido a 240 ms; el observador (`animarTransicionCoopDesdeDiff`) usa los mismos tiempos cuando el atacante es BOT.
- Coop online — Sincronía ataques BOT (`public/partidaCoop.js`): los ataques básicos del BOT también esperan brevemente el propio broadcast del servidor (`Promise.race([emit, esperar(420)])`) antes de iniciar la animación local, igual que las habilidades, eliminando el desfase visual entre jugador 1 y jugador 2.
- Coop online — Refill mesa humanos al cierre de turno BOT (`public/partidaCoop.js`): tras el último ataque del BOT siempre se rellenan los huecos de A y B con cartas del mazo (animadas) antes de pasar a P1, en línea con la lógica de VS BOT.
- Coop online — Animación de entrada inicial (`public/partidaCoop.js`): el tablero arranca con todas las cartas ocultas (sin flash) y se revelan por parejas en el orden bot[0]+A[0] → bot[1]+A[1] → bot[2]+B[0] → bot[3]+B[1] con `animarCartaRobadaCoop` y 500 ms entre parejas; `coopAnimEntradaInicialActiva` evita que cualquier `renderTodo()` durante la animación reaparezca cartas aún no entradas.
- Etiqueta de versión del menú lateral actualizada a `Version: Beta-1.0.12-05.05.26`.

## Beta-1.0.11-04.05.26

- Coop online (`public/partidaCoop.js`): corrección de solapamiento en transición P2→BOT y primer ataque del BOSS; el arranque de IA BOT se ejecuta al final del procesamiento del eco para no intercalar replay/robos/ataques.
- Coop online (`public/partidaCoop.js`): ajuste de inferencia de atacante y de reproducción de `extra_attack`/AOE en el cliente observador; se evita atribuir daño al slot humano equivocado y se estabiliza la animación multiobjetivo con snapshot normalizado.
- Coop online (`public/partidaCoop.js`): avisos de turno robustos para ambos jugadores (incl. jugador 2) con temporizador único compartido con avisos de habilidad y textos con nombres reales de jugador A/B.
- Coop online (`public/partidaCoop.js`): cierre de turno BOT más limpio en ejecutor local; se añade pausa corta antes de pasar a P1 para evitar solape entre eliminación de carta, cambio de fase y robos del nuevo ciclo.
- Coop online (`public/partidaCoop.js`): arranque inicial de BOT en `DOMContentLoaded` alineado con el flujo diferido por microtask para respetar estados pendientes de `estado:solicitar`.
- Etiqueta de versión del menú lateral actualizada a `Version: Beta-1.0.11-04.05.26`.

## Beta-1.0.10-03.05.26

- Evento cooperativo online vs BOT: flujo de sesión en `server.js` (creación de partida, room, revisiones de estado, ejecutor del BOT, resultado y abandono) y cliente en `public/cliente.js` + `public/multijugador.html` / `public/multijugadorEventosCoop.js` (invitación, preparación, tablero y eventos Socket.IO).
- Tablero coop dedicado `public/tablero_coop.html` con estilos `public/css/tablero_coop.css`, render de cartas `public/js/tableroCoopCartaRender.js` y motor `public/partidaCoop.js` (fases P1 / P2 / BOT, combate, habilidades, cementerio y sincronización por snapshots).
- Sincronización visual entre jugadores: avisos de habilidad activa y números flotantes mediante `coopReplayVisual` + cola de estado; AOE con animación multiobjetivo y daño mostrado acotado a vida/escudo efectivos; cierre de partida coherente tras eliminar rivales (incl. AOE del BOT) y comprobación de fin al aplicar snapshot remoto.
- Turno BOT: robo desde mazo al inicio de la fase cuando la mesa está vacía (eco a compañero); transiciones P2→BOT y P2 con relleno de huecos en el snapshot emitido y espejo en el emisor; despliegue de BOSS reutilizable sobre snapshot (`intentarDesplegarBossEnSnap`).
- Multijugador / `public/partida.js`: limpieza de estado residual coop al iniciar otras partidas y al volver al hub; script `public/js/limpiarCoopPartidaLocal.js` para residuos en `localStorage`.
- Recursos: actualización de `public/resources/cartas.xlsx` y recurso de apoyo `public/resources/eventos_online.xlsx` para el flujo online.
- Etiqueta de versión del menú lateral actualizada a `Version: Beta-1.0.10-03.05.26`.

## Beta-1.0.9-02.05.26

- Partida vs BOT (offline): restaurado el mensaje inicial de turno (`Turno de …`) al iniciar partida normal, evento o desafío; el primer turno actualiza el HUD antes de la acción y el aviso central se muestra tras el relleno de huecos en mesa (sin cambios en PvP online).
- VS BOT (offline): el aviso central de uso de habilidad solo aparece para habilidades activas (`usar`) de clase `heal`, `revive`, `shield`, `aoe`, `heal_all`, `tank`, `extra_attack`; no para efectos tipo pasiva (`buff`, `debuff`, `bonus_buff`, `bonus_debuff`, `heal_debuff`, ni otros como `stun`/`dot`/`life_steal`). El combate PvP online no se modifica.
- Tablero (`tablero.css`): cartas en mesa, modal de selección de objetivo y recompensas finales sin escalado ni `transform` de tamaño en hover, clic y estados de combate; se mantienen sombras y brillos; animación de carta robada sin desplazamiento vertical.
- Etiqueta de versión del menú lateral actualizada a `Version: Beta-1.0.9-02.05.26`.

## Beta-1.0.8-02.05.26

- PvP online: corrección de animaciones de daño y barra de salud cuando el golpe letal vacía la mesa y el snapshot ya trae cartas nuevas en el mismo hueco (ataque básico y habilidades con objetivo único); la animación usa la carta previa hasta 0 antes de aplicar el estado oficial.
- PvP online: AOE en cliente alinea daño/animación con vida + escudo efectivos; slots con carta sustituida por robo se tratan como letal para la carta anterior.
- PvP online: `heal_all` anima la barra por aliado de forma secuencial al número verde (salud efectiva + escudo); clase visual `recibiendo-cura` en barra sin escalado brusco.
- PvP online: panel de debug en tablero oculto (deja de crearse `pvp-debug-panel`); solo permanece el debug de combate si está activo.
- Servidor PvP: AOE con tanque activo concentra el daño en el tanque **una sola vez** por uso (antes se aplicaba un golpe por cada carta viva en mesa).
- Tablero (PvE/PvP): eliminados escalados/transform de tamaño en cartas durante selección, ataque, objetivo, agotado, robo y entrada; se mantienen resaltados por brillo/sombra; hover de escala desde `mazos.css` con transición ~0.5s solo en slots del tablero.
- Barras de salud (`salud.css`): pulsos de impacto/cura sin `scale` para evitar efecto de “cartas que palpitan”.
- Flujo local tras PvP: nuevo `js/limpiarPvpPartidaLocal.js` y llamadas al iniciar partida vs BOT, desafíos/eventos y al salir del tablero PvP al multijugador; evita modo PvP residual en `partida.js`.
- Tablero: si una carta jugador está destacada en ataque, no se superpone `carta-seleccionada` con `carta-atacando`; boss sin `scale` inline (solo borde/sombra).
- Etiqueta de versión del menú lateral actualizada a `Version: Beta-1.0.8-02.05.26`.

## Beta-1.0.7-01.05.26

- PvP online: mejoras de sincronizacion de turnos/revisiones para reducir solapamientos visuales entre ultima accion, cambio de turno y refresco de estado.
- PvP online: ajustes de timing y cola de estados para animaciones de ataque/habilidad mas estables, incluyendo dano, bajas y entrada de cartas desde mazo.
- PvP online: correcciones de UI en combate (opacidad de cartas usadas al cerrar turno, resaltado remoto de carta atacante seleccionada y mejoras en avisos de habilidad).
- Habilidades: correcciones de animacion y aplicacion visual para `aoe`, `extra_attack` y `heal_all` en combate sincronizado.
- Grupos/multijugador: nuevo modal de confirmacion al abandonar grupo (menu lateral y vista multijugador) con texto `¿Quieres abandonar el grupo?` y acciones `Aceptar | Cancelar`.
- Centro de Operaciones: robustez en estado de `invitacion en curso` para evitar botones atascados por expiraciones o estado local desfasado.
- Menu lateral: actualizacion de icono de `Dejar grupo` con SVG y color dinamico segun RGB configurado por jugador.
- Etiqueta de version del menu lateral actualizada a `Version: Beta-1.0.7-01.05.26`.

## Beta-1.0.6-30.04.26

- Opciones: nuevo selector visual de color principal (`input type="color"`) con vista previa en tiempo real y persistencia en cuenta (`preferencias.colorPrincipal`).
- Theming global: el color personalizado ahora se aplica automáticamente entre vistas usando variables CSS (`--dc-accent-user-rgb`, `--dc-accent-user`) y refresco en caliente al actualizar usuario.
- Centro de Operaciones: paneles, bordes, botones principales, modales, tarjetas de evento y metadatos secundarios actualizados para respetar el acento de color del jugador.
- Desafíos: fondos de `desafio-card`, textos/meta y botón `Jugar` (solo estado no completado) adaptados al color dinámico, manteniendo intacto `Volver a jugar`.
- Eventos/Tienda/Perfil lateral: botón `Empezar Evento` (solo estado activo), paneles y botones de compra en tienda, además de los 3 bloques de estadísticas del perfil lateral, ahora siguen el color principal configurado.
- UX visual adicional: scrollbar global y selects con gradiente dinámico unificados con el color elegido por el jugador.
- Vista `desafios`: consolidación de Camino del Héroe/Villano con filtrado por facción, bloqueo progresivo por nivel y recompensas de cartas visibles en tarjetas de desafío.
- Recompensas de desafío en combate: soporte de entrega de cartas desde columna `cartas` en `desafios.xlsx`, escaladas al nivel de dificultad del desafío.
- Etiqueta de versión del menú lateral actualizada a `Version: Beta-1.0.6-30.04.26`.

## Beta-1.0.5-29.04.26

- Combate (`tank`): la habilidad `tank` ahora solo puede usarse una vez por partida; si la carta es revivida, vuelve a estar disponible.
- Combate (`revive`): al revivir una carta se resetea su cooldown de habilidad activa (`habilidadCooldownRestante = 0`) y se limpia su estado de uso de habilidad.
- Vista `tablero`: rediseño de HUD para layout limpio (sin logs/panel lateral antiguo), nuevos indicadores de turno en amarillo, panel de jugador con avatar y ajustes de fondo/centrado para la nueva estética.
- Navegación segura en `tablero`: confirmación al abandonar/recargar partida en curso y redirección coherente al salir.
- `tablero`: correcciones de estabilidad tras limpieza de HUD (evita error cuando no existe contenedor de logs).
- Vista `desafios`: organización por pestañas de nivel (1 a 6) con bloqueo progresivo por nivel completado y estado visual con candado.
- Modales de selección (eventos y desafíos): barras de salud visibles y tamaño de carta unificado en ambos modales.
- Recompensas de desafío en `tablero`: botón de cierre final ajustado para volver a `desafios.html` y mantener coherencia de navegación.
- Etiqueta de versión del menú lateral actualizada a `Version: Beta-1.0.5-29.04.26`.

## Beta-1.0.4-29.04.26

- Se aplican habilidades a TODAS las cartas del catálogo actualizado (`cartas.xlsx`), asegurando consistencia global para jugador, BOT y BOSS.
- Ajuste de color unificado para `buff`: ahora usa el mismo amarillo que `bonus_buff` en badges, tooltip de `@skill_power` y modificadores de poder en tablero.
- Ajuste de regla de combate para `stun`: no afecta a cartas BOSS bajo ninguna circunstancia (inmunidad total).
- Limpieza de recursos: eliminación de `public/resources/icons/red_arrow.jpg` del repositorio.
- Etiqueta de versión del menú lateral actualizada a `Version: Beta-1.0.4-29.04.26`.

## Beta-1.0.3-29.04.26

- Sincronización robusta de catálogo: al cambiar `cartas.xlsx`, las cartas de usuario actualizan automáticamente habilidades e imágenes usando firma de catálogo para forzar migración cuando haya cambios.
- Corrección de carga de imágenes en todas las vistas (incluida colección), priorizando datos actuales del catálogo para evitar rutas obsoletas persistidas en cuentas antiguas.
- Nuevas `skill_class` añadidas e integradas para jugador, BOT y BOSS: `stun`, `life_steal` y `dot`.
- `stun`: bloquea ataques y uso de habilidades; la carta afectada queda no seleccionable con el mismo efecto visual de carta agotada.
- `dot`: aplica sangrado durante 3 turnos y permanece activo aunque la carta que lo aplicó sea eliminada.
- `life_steal`: recuperación de salud al infligir daño, aplicada en los flujos de combate correspondientes.
- Nuevos indicadores de estado sobre la barra de salud en combate: `Incapacitado: skill_name` y `DoT: skill_name` en color naranja.
- Ajuste visual de estilos: `debuff` pasa a morado (badge e interpolación `@skill_power`) para unificar la paleta.
- Actualización de recursos del catálogo con nuevas cartas de héroe y villano en `cartas.xlsx`, además de ajustes en `eventos.xlsx` y nuevos assets en `resources/icons`.
- Etiqueta de versión del menú lateral actualizada a `Version: Beta-1.0.3-29.04.26`.

## Beta-1.0.2-28.04.26

- Eventos: las recompensas de puntos dejan de escalar por dificultad y pasan a usar el valor fijo definido en `eventos.xlsx`.
- Eventos: soporte de cantidades para `mejora` y `mejora_especial` (>1), igualando el comportamiento de desafíos al otorgar y visualizar recompensas.
- Eventos: interfaz de recompensas actualizada para mostrar formato con iconos (`moneda.png`, `mejora.png`, `mejora_especial.png`) y cantidades.
- Combate: corrección del escalado de `skill_power` en jugador y BOT durante partida para mantener la fórmula `base * nivel` en todos los flujos de carga/escalado.
- Boss: aumento de vida final en +75% sobre su vida escalada actual.
- Boss: ajuste de daño por ataque para usar su poder final completo (sin multiplicador reductor), incluyendo sus dos ataques aleatorios cuando corresponde.
- Boss: blindaje de aplicación/visualización de modificadores de pasivas sobre su poder efectivo en combate.
- Plataforma: actualización de favicon a archivos locales (`/favicon.png`, `/favicon.ico`) para compatibilidad en Render y navegadores.
- UX: actualización en tiempo real del panel lateral de perfil (puntos y mejoras) al gastar recursos, sin necesitar cambio de vista.
- Routing: `index.html` convertido en entrada inteligente, redirigiendo a `vistaJuego.html` con sesión válida o a `login.html` sin sesión.
- Etiqueta de versión del menú lateral actualizada a `Version: Beta-1.0.2-28.04.26`.

## Beta-1.0.1-28.04.26

- Vista `mejorarCartas`: agrupacion de duplicados por nombre mostrando una sola carta base, badge central con cantidad de copias y resaltado visual para combinaciones disponibles.
- Nuevo modal de combinacion manual de duplicados con seleccion parcial (permitiendo elegir cuantas copias fusionar), validacion de minimo una seleccion y reutilizacion del modal de resultado antes/despues.
- Ajuste de escalado para `skill_power` en clases `buff`, `debuff`, `heal`, `shield`, `heal_all` y `bonus_buff`: ahora se calcula como `base * nivel`.
- Actualizacion de migracion de skills de usuario para recalcular `skill_power` con la nueva formula y aplicar los cambios en coleccion/mazos.
- Actualizacion de recursos de datos (`cartas.xlsx` y `eventos.xlsx`) a la ultima revision.
- Etiqueta de version del menu lateral actualizada a `Version: Beta-1.0.1-28.04.26`.

## Beta-1.0.0-27.04.26

- Ajustes responsive para uso horizontal en movil y tablet, incluyendo layout del tablero y vistas asociadas.
- Correccion del sistema de progresion para evitar desbloqueos cruzados entre desafios y eventos, con refuerzo de desbloqueo secuencial.
- Correcciones especificas de Firefox en el modal de cambio de carta de Mazos para eliminar solapamientos sin romper Chrome.
- Sincronizacion de habilidades pasivas para que las cartas nuevas en mesa reciban efectos auto en ambos lados (jugador/BOT).
- Nuevo filtro en Coleccion para ordenar por poder (descendente), manteniendo el orden alfabetico por defecto.
- Implementacion del badge de afiliacion "A" con tooltip y posicion unificada en la esquina superior derecha de las cartas en todas las vistas.
- Escalado dinamico de `skill_power` por nivel para clases aplicables, interpolacion de `@skill_power` en descripciones y coloreado contextual por clase.
- Migracion de cartas de usuario existentes para actualizar metadatos de habilidades y visualizacion consistente.
- Mejora del perfil lateral con puntos y gemas disponibles usando iconos del juego.
- Sustitucion visual de puntos por `moneda.png` en menu, tienda y recompensas.
- Reemplazo del limite "1 uso por partida" por cooldown de 2 turnos para habilidades activas (jugador y BOT).
- Texto de boton de habilidad activa ajustado a formato legible de cooldown (`Cooldown: n turno(s)`).
- Aumento de tamano del icono `moneda.png` en cabecera de la tienda.
- Etiqueta de version agregada bajo el boton de cerrar sesion en el menu lateral: `Version: Beta-1.0.0-27.04.26`.
