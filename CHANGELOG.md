# Changelog

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
