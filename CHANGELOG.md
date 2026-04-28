# Changelog

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
