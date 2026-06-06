/**
 * Eventos cooperativos online (eventos_online.xlsx) en la vista multijugador.
 * Aislado del lobby PvP y de vistaJuego offline.
 */
(function () {
    const EVENTOS_COOP_GRID_ID = 'multi-eventos-coop-grid';
    /** Cartas que cada jugador selecciona para el evento coop (antes 6, ahora 4). */
    const CARTAS_POR_JUGADOR_COOP = 4;

    function normalizarNombre(nombre) {
        return String(nombre || '').trim().toLowerCase();
    }

    function resolverCartaEnemigoVistaSync(nombreRef, mapaCatalogo) {
        if (typeof window.DCSkinsCartas?.resolverCartaEnemigoVistaSync === 'function') {
            return window.DCSkinsCartas.resolverCartaEnemigoVistaSync(nombreRef, mapaCatalogo);
        }
        const nombreCatalogo = typeof window.DCSkinsCartas?.obtenerNombreCatalogoDesdeReferencia === 'function'
            ? window.DCSkinsCartas.obtenerNombreCatalogoDesdeReferencia(nombreRef)
            : nombreRef;
        return mapaCatalogo.get(normalizarNombre(nombreCatalogo)) || { Nombre: nombreRef, Nivel: 1 };
    }

    /* Helpers locales aislados (replican `crearMazos.js` / `partida.js`) para no
     * acoplar este módulo coop a esos ficheros, que no se cargan en multijugador.html.
     */
    function normalizarFaccionLocal(valor) {
        return window.DCFiltrosCartas?.normalizarFaccionValor(valor) || String(valor || '').trim().toUpperCase();
    }

    function cartaCoincideFaccionLocal(carta, faccionActiva) {
        return window.DCFiltrosCartas?.cartaCoincideFaccion(carta, faccionActiva)
            ?? normalizarFaccionLocal(carta?.faccion) === normalizarFaccionLocal(faccionActiva);
    }

    function normalizarAfiliacionLocal(afi) {
        return String(afi || '').trim().toLowerCase();
    }

    function obtenerAfiliacionesCartaLocal(carta) {
        const afiliacionRaw = String(carta?.Afiliacion || carta?.afiliacion || '');
        if (!afiliacionRaw.trim()) return [];
        return afiliacionRaw.split(';').map((item) => item.trim()).filter(Boolean);
    }

    function obtenerSaludMaxCartaLocal(carta) {
        if (!carta) return 0;
        const saludMax = Number(carta.SaludMax);
        if (Number.isFinite(saludMax) && saludMax > 0) return saludMax;
        const salud = Number(carta.Salud);
        if (Number.isFinite(salud) && salud > 0) return salud;
        return Math.max(Number(carta.Poder || 0), 0);
    }

    function obtenerSaludActualCartaLocal(carta) {
        const saludMax = Math.max(obtenerSaludMaxCartaLocal(carta), 0);
        const salud = Number(carta?.Salud);
        const saludValida = Number.isFinite(salud) ? salud : saludMax;
        return Math.max(0, Math.min(saludValida, saludMax));
    }

    function crearBarraSaludElementoLocal(carta) {
        const saludActual = obtenerSaludActualCartaLocal(carta);
        const saludMax = Math.max(obtenerSaludMaxCartaLocal(carta), 1);
        const porcentaje = Math.max(0, Math.min((saludActual / saludMax) * 100, 100));
        const ratio = porcentaje / 100;
        const cont = document.createElement('div');
        cont.classList.add('barra-salud-contenedor');
        const relleno = document.createElement('div');
        relleno.classList.add('barra-salud-relleno');
        relleno.style.width = `${porcentaje}%`;
        relleno.style.setProperty('--health-ratio', String(ratio));
        const span = document.createElement('span');
        span.classList.add('salud-carta');
        span.textContent = `${saludActual}/${saludMax}`;
        cont.appendChild(relleno);
        cont.appendChild(span);
        return cont;
    }

    const ROTACION_COOP_EVENTOS_MS = 60 * 60 * 1000;
    /**
     * Prefijo distinto al de eventos offline (`jugarPartida.js` usa `event-rotation-v1`).
     * Si compartieran clave, los IDs numéricos de `eventos.xlsx` y `eventos_online.xlsx` se
     * mezclarían y un evento VS BOT completado marcaría como jugado un coop con el mismo ID.
     */
    const VERSION_ROTACION_COOP_EVENTOS = 'event-rotation-coop-online-v1';
    /** Lista completa del XLSX; `obtenerEventosRotacionActualCoop` devuelve el lote de 4 vigente. */
    let eventosCoopListaCompleta = [];
    let eventosCoopEnRotacion = [];
    let temporizadorRotacionCoopEventos = null;
    let _mapaCatalogoCoopCache = null;
    let _colaMontajeCarruselesCoop = [];
    let _montajeCarruselesCoopProgramado = false;

    function obtenerVentanaRotacionCoopEventos() {
        const ahora = Date.now();
        const idVentana = Math.floor(ahora / ROTACION_COOP_EVENTOS_MS);
        const inicio = idVentana * ROTACION_COOP_EVENTOS_MS;
        const fin = inicio + ROTACION_COOP_EVENTOS_MS;
        return { ahora, idVentana, inicio, fin };
    }

    /**
     * Siempre 4 eventos (salvo catálogo vacío): misma lógica circular que `jugarPartida.js`
     * para no dejar huecos al final del Excel.
     */
    function obtenerEventosRotacionActualCoop() {
        if (!Array.isArray(eventosCoopListaCompleta) || eventosCoopListaCompleta.length === 0) {
            return [];
        }
        const { idVentana } = obtenerVentanaRotacionCoopEventos();
        const tamanoLote = 4;
        const N = eventosCoopListaCompleta.length;
        const start = ((idVentana * tamanoLote) % N + N) % N;
        const salida = [];
        for (let i = 0; i < tamanoLote; i += 1) {
            salida.push(eventosCoopListaCompleta[(start + i) % N]);
        }
        return salida;
    }

    function obtenerClaveRotacionEventosLocal() {
        const { idVentana } = obtenerVentanaRotacionCoopEventos();
        return `${VERSION_ROTACION_COOP_EVENTOS}-${idVentana}`;
    }

    function actualizarUIRotacionCoopEventos() {
        const timerValorEl = document.getElementById('coop-eventos-rotacion-timer-valor');
        const barraEl = document.getElementById('coop-eventos-rotacion-barra-progreso');
        if (!timerValorEl || !barraEl) {
            return;
        }

        const { ahora, inicio, fin } = obtenerVentanaRotacionCoopEventos();
        const restante = fin - ahora;
        const transcurrido = ahora - inicio;
        const progreso = Math.min(100, Math.max(0, (transcurrido / ROTACION_COOP_EVENTOS_MS) * 100));
        timerValorEl.textContent = typeof window.dcFormatearCuentaAtrasMs === 'function'
            ? window.dcFormatearCuentaAtrasMs(restante)
            : '0s';
        barraEl.style.width = `${progreso}%`;
    }

    function iniciarTemporizadorRotacionCoopEventos(catalogo) {
        if (temporizadorRotacionCoopEventos) {
            clearInterval(temporizadorRotacionCoopEventos);
            temporizadorRotacionCoopEventos = null;
        }

        eventosCoopEnRotacion = obtenerEventosRotacionActualCoop();
        actualizarUIRotacionCoopEventos();

        temporizadorRotacionCoopEventos = setInterval(async () => {
            const idsPrevios = eventosCoopEnRotacion.map((e) => e.id).join(',');
            const nuevos = obtenerEventosRotacionActualCoop();
            const idsNuevos = nuevos.map((e) => e.id).join(',');
            eventosCoopEnRotacion = nuevos;

            if (idsPrevios !== idsNuevos) {
                await renderizarEventosCoopGrid(nuevos, catalogo);
            }

            actualizarUIRotacionCoopEventos();
        }, 1000);
    }

    function obtenerUsuarioLocalCoop() {
        try {
            return JSON.parse(localStorage.getItem('usuario') || 'null');
        } catch (_e) {
            return null;
        }
    }

    async function obtenerUsuarioActualCoop() {
        const email = localStorage.getItem('email');
        if (!email) return obtenerUsuarioLocalCoop();
        try {
            const response = await fetch('/get-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            if (!response.ok) return obtenerUsuarioLocalCoop();
            const data = await response.json();
            return data?.usuario || obtenerUsuarioLocalCoop();
        } catch (_e) {
            return obtenerUsuarioLocalCoop();
        }
    }

    function mapearEventoOnlineDesdeFila(fila, fallbackIndex) {
        const enemigos = [];
        for (let i = 1; i <= 8; i += 1) {
            const nombreEnemigo = String(fila[`enemigo${i}`] || '').trim();
            if (nombreEnemigo) {
                enemigos.push(nombreEnemigo);
            }
        }
        const boss = String(fila.boss ?? fila.Boss ?? fila.BOSS ?? '').trim();
        return {
            id: Number(fila.ID_evento_online ?? fila.id ?? fallbackIndex),
            nombre: String(fila.nombre || `Evento ${fallbackIndex + 1}`).trim(),
            descripcion: String(fila.Descripción || fila.descripcion || '').trim(),
            enemigos,
            boss: boss || null,
            puntos: Number(fila.puntos || 0),
            mejora: Number(fila.mejora || 0),
            mejora_especial: Number(fila.mejora_especial || 0),
            cartaRecompensa: String(fila.cartas || fila.carta || '').trim(),
            dificultadSeleccionada: null,
            tablero: String(fila.tablero ?? fila.Tablero ?? '').trim()
        };
    }

    async function obtenerCatalogoCartas() {
        if (_mapaCatalogoCoopCache) {
            return Array.from(_mapaCatalogoCoopCache.values());
        }
        if (typeof window.DCCatalogoCartas?.obtenerFilas === 'function') {
            const filas = await window.DCCatalogoCartas.obtenerFilas();
            _mapaCatalogoCoopCache = new Map(
                filas.map((carta) => [normalizarNombre(carta.Nombre), carta])
            );
            return filas;
        }
        if (typeof window.DCCatalogoCartas?.cargarFilas === 'function') {
            const filas = await window.DCCatalogoCartas.cargarFilas();
            _mapaCatalogoCoopCache = new Map(
                filas.map((carta) => [normalizarNombre(carta.Nombre), carta])
            );
            return filas;
        }
        const response = await fetch('resources/cartas.xlsx');
        if (!response.ok) throw new Error('cartas');
        const data = await response.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        _mapaCatalogoCoopCache = new Map(
            filas.map((carta) => [normalizarNombre(carta.Nombre), carta])
        );
        return filas;
    }

    function cancelarMontajeCarruselesCoopPendiente() {
        _colaMontajeCarruselesCoop = [];
        _montajeCarruselesCoopProgramado = false;
    }

    function programarMontajeCarruselesCoop() {
        if (_montajeCarruselesCoopProgramado || _colaMontajeCarruselesCoop.length === 0) {
            return;
        }
        _montajeCarruselesCoopProgramado = true;
        const LOTE = 2;
        const procesarLote = () => {
            if (_colaMontajeCarruselesCoop.length === 0) {
                _montajeCarruselesCoopProgramado = false;
                return;
            }
            const lote = _colaMontajeCarruselesCoop.splice(0, LOTE);
            lote.forEach((entrada) => {
                if (!entrada?.mount?.isConnected || typeof window.DCCarrusel3d?.montar !== 'function') {
                    return;
                }
                entrada.mount.innerHTML = '';
                window.DCCarrusel3d.montar(entrada.mount, entrada.opciones);
            });
            if (_colaMontajeCarruselesCoop.length > 0) {
                requestAnimationFrame(procesarLote);
            } else {
                _montajeCarruselesCoopProgramado = false;
            }
        };
        requestAnimationFrame(procesarLote);
    }

    function encolarCarruselCoop(mount, opciones) {
        if (!mount) return;
        _colaMontajeCarruselesCoop.push({ mount, opciones });
        programarMontajeCarruselesCoop();
    }

    async function cargarEventosOnline() {
        const response = await fetch('resources/eventos_online.xlsx');
        if (!response.ok) {
            throw new Error('eventos_online');
        }
        const data = await response.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        return filas.map((fila, index) => mapearEventoOnlineDesdeFila(fila, index));
    }

    function mostrarMensajeCoop(texto, tipo = 'warning') {
        const el = document.getElementById('mensaje-multi');
        if (!el) return;
        el.textContent = texto;
        el.className = `alert alert-${tipo}`;
        el.style.display = 'block';
        setTimeout(() => {
            el.style.display = 'none';
        }, 3200);
    }

    async function renderizarEventosCoopGrid(eventos, catalogo, opciones = {}) {
        const contenedor = document.getElementById(EVENTOS_COOP_GRID_ID);
        if (!contenedor) return;

        cancelarMontajeCarruselesCoopPendiente();

        const mapaCatalogo = _mapaCatalogoCoopCache
            || new Map(catalogo.map((carta) => [normalizarNombre(carta.Nombre), carta]));

        /* Progreso coop online aislado: `claveRotacion` usa prefijo propio (no el de VS BOT). */
        const usuario = opciones.usuario || obtenerUsuarioLocalCoop();
        const claveRotacion = obtenerClaveRotacionEventosLocal();
        const jugadosPorRotacion = (usuario?.eventosJugadosPorRotacion && typeof usuario.eventosJugadosPorRotacion === 'object')
            ? usuario.eventosJugadosPorRotacion
            : {};
        const jugadosActual = new Set((jugadosPorRotacion[claveRotacion] || []).map((id) => Number(id)));

        contenedor.innerHTML = '';

        const panelUi = window.DCEventoPanelUi;

        eventos.forEach((evento) => {
            const yaJugado = jugadosActual.has(Number(evento.id));
            const card = document.createElement('div');
            card.className = `evento-card ${yaJugado ? 'completado' : 'pendiente'}`;

            const nombre = document.createElement('div');
            nombre.className = 'evento-nombre';
            nombre.textContent = evento.nombre;

            const descripcion = document.createElement('div');
            descripcion.className = 'evento-descripcion';
            descripcion.textContent = evento.descripcion || 'Sin descripción.';

            const enemigosEl = panelUi
                ? panelUi.montarBloqueEnemigosEvento(
                    evento,
                    mapaCatalogo,
                    resolverCartaEnemigoVistaSync,
                    { encolarCarrusel: encolarCarruselCoop }
                )
                : document.createElement('div');

            const { bloque: recompensasBloque, recompensasEl } = panelUi
                ? panelUi.crearBloqueRecompensasEvento(evento, evento.dificultadSeleccionada)
                : { bloque: document.createElement('div'), recompensasEl: document.createElement('div') };

            const contenedorDificultad = document.createElement('div');
            contenedorDificultad.className = 'evento-dificultad';
            const dificultadLabel = document.createElement('label');
            dificultadLabel.className = 'evento-dificultad-label';
            dificultadLabel.textContent = 'Dificultad';

            const pickerDificultad = panelUi
                ? panelUi.crearSelectorDificultadEvento(
                    evento,
                    (nivel) => {
                        evento.dificultadSeleccionada = nivel;
                        panelUi.actualizarRecompensasEventoUi(recompensasEl, evento, nivel);
                    },
                    { disabled: yaJugado }
                )
                : document.createElement('div');
            contenedorDificultad.appendChild(dificultadLabel);
            contenedorDificultad.appendChild(pickerDificultad);

            const empezarBtn = document.createElement('button');
            empezarBtn.type = 'button';
            empezarBtn.className = `btn ${yaJugado ? 'btn-success' : 'btn-primary'}`;
            empezarBtn.textContent = yaJugado ? 'Ya jugado en esta rotación' : 'Empezar Evento';
            empezarBtn.disabled = yaJugado;
            empezarBtn.addEventListener('click', () => {
                if (yaJugado) return;
                const dif = Number(evento.dificultadSeleccionada);
                if (!Number.isFinite(dif) || dif <= 0) {
                    mostrarMensajeCoop('Selecciona una dificultad antes de empezar el evento.', 'warning');
                    return;
                }
                if (typeof window.emitCoopEventoInvitar === 'function') {
                    window.emitCoopEventoInvitar({
                        eventoId: evento.id,
                        dificultad: dif,
                        eventoNombre: evento.nombre
                    });
                }
            });

            const bloqueInferior = document.createElement('div');
            bloqueInferior.className = 'evento-bottom';
            bloqueInferior.appendChild(recompensasBloque);
            bloqueInferior.appendChild(contenedorDificultad);
            bloqueInferior.appendChild(empezarBtn);

            card.appendChild(nombre);
            card.appendChild(descripcion);
            card.appendChild(enemigosEl);
            card.appendChild(bloqueInferior);
            contenedor.appendChild(card);
        });
    }

    function crearOverlayModal(innerNode) {
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.style.zIndex = '12000';
        const modal = document.createElement('div');
        modal.className = 'modal-invitacion multi-modal-panel';
        modal.style.maxWidth = '520px';
        modal.appendChild(innerNode);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        return { overlay, cerrar: () => overlay.parentElement && overlay.parentElement.removeChild(overlay) };
    }

    function modalInvitacionEventoCoop(payload) {
        const prepId = String(payload?.prepId || '').trim();
        const invitador = String(payload?.invitadorNombre || 'Un jugador').trim();
        const eventoNombre = String(payload?.eventoNombre || 'evento cooperativo').trim();

        const wrap = document.createElement('div');
        const p = document.createElement('p');
        p.innerHTML = `<span class="jugador-nombre">${invitador}</span> te ha invitado a jugar el evento cooperativo <strong>${eventoNombre}</strong>.`;

        const acciones = document.createElement('div');
        acciones.style.display = 'flex';
        acciones.style.gap = '10px';
        acciones.style.marginTop = '14px';

        const btnA = document.createElement('button');
        btnA.className = 'btn btn-aceptar';
        btnA.textContent = 'Aceptar';
        const btnC = document.createElement('button');
        btnC.className = 'btn btn-cancelar';
        btnC.textContent = 'Cancelar';

        const { overlay, cerrar } = crearOverlayModal(wrap);
        wrap.appendChild(p);
        wrap.appendChild(acciones);
        acciones.appendChild(btnA);
        acciones.appendChild(btnC);

        btnA.onclick = () => {
            if (typeof window.emitCoopEventoInvitacionResponder === 'function') {
                window.emitCoopEventoInvitacionResponder({ prepId, aceptada: true });
            }
            cerrar();
        };
        btnC.onclick = () => {
            if (typeof window.emitCoopEventoInvitacionResponder === 'function') {
                window.emitCoopEventoInvitacionResponder({ prepId, aceptada: false });
            }
            cerrar();
        };
        overlay.addEventListener('click', (ev) => {
            if (ev.target === overlay) {
                btnC.click();
            }
        });
    }

    let prepContext = null;
    /** Handler activo para sincronizar `coop:evento:preparacion:estado` con el modal de selección. */
    let coopPrepModalEstadoHandler = null;
    /** Handler activo para sincronizar la selección en vivo (`coop:evento:preparacion:seleccion:estado`). */
    let coopPrepModalSeleccionHandler = null;
    let ultimoDetalleEstadoPrepCoop = null;
    let ultimoDetalleSeleccionPrepCoop = null;
    let usuarioCartasSeleccion = [];
    let seleccionIndices = new Set();
    let cartasVistaSeleccionCoop = new Map();
    let mapaCatalogoSeleccionCoop = null;
    let busquedaSeleccionCoop = '';
    let faccionEventoCoopActiva = '';

    function obtenerCartaDisplaySeleccionCoop(item) {
        if (cartasVistaSeleccionCoop.has(item.index)) {
            return cartasVistaSeleccionCoop.get(item.index);
        }
        if (typeof window.DCSeleccionCartaApariencia?.obtenerCartaComoParent === 'function') {
            return window.DCSeleccionCartaApariencia.obtenerCartaComoParent(item.carta, mapaCatalogoSeleccionCoop);
        }
        return item.carta;
    }
    let afiliacionEventoCoopActiva = 'todas';
    let skillClassEventoCoopActiva = 'todas';

    /**
     * Modal de selección de cartas (CARTAS_POR_JUGADOR_COOP) para el evento coop. Replica el formato
     * de `#modal-seleccion-evento` de VS BOT (`vistaJuego.html`): pestañas
     * Héroes/Villanos, filtro de afiliación, grid `cartas-seleccion-grid` con
     * `carta-mini` (estrellas, nombre, poder, badges y barra de salud).
     * Usa un id propio (`modal-seleccion-evento-coop`) para no chocar con
     * el modal de VS BOT.
     */
    async function abrirModalSeleccionSeisCartas(payload) {
        prepContext = {
            prepId: String(payload?.prepId || '').trim(),
            rolCoop: String(payload?.rolCoop || 'A').trim().toUpperCase()
        };
        const rolCoop = prepContext.rolCoop;
        const rolCompanero = rolCoop === 'A' ? 'B' : 'A';
        const nombreJugadorA = String(payload?.nombreJugadorA || payload?.invitadorNombre || 'Jugador 1').trim();
        const nombreJugadorB = String(payload?.nombreJugadorB || 'Jugador 2').trim();
        let confirmadoLocal = false;
        /** Selección en vivo de cada jugador para el panel-resumen (`{ cartas: [{n, skin}], listo }`). */
        const panelSeleccion = {
            A: { cartas: [], listo: false },
            B: { cartas: [], listo: false }
        };

        const usuario = await obtenerUsuarioActualCoop();
        if (!usuario || !Array.isArray(usuario.cartas) || usuario.cartas.length < CARTAS_POR_JUGADOR_COOP) {
            mostrarMensajeCoop(`Necesitas al menos ${CARTAS_POR_JUGADOR_COOP} cartas en tu colección.`, 'danger');
            return;
        }
        try {
            localStorage.setItem('usuario', JSON.stringify(usuario));
        } catch (_e) { /* noop */ }

        const catalogo = await obtenerCatalogoCartas();
        mapaCatalogoSeleccionCoop = new Map();
        catalogo.forEach((carta) => {
            const clave = normalizarNombre(carta.Nombre);
            if (clave) {
                mapaCatalogoSeleccionCoop.set(clave, carta);
            }
        });
        const mapaFaccion = new Map();
        catalogo.forEach((carta) => {
            mapaFaccion.set(normalizarNombre(carta.Nombre), {
                faccion: carta.faccion,
                Afiliacion: carta.Afiliacion || '',
                skill_name: String(carta.skill_name || '').trim(),
                skill_info: String(carta.skill_info || '').trim(),
                skill_class: String(carta.skill_class || '').trim().toLowerCase(),
                skill_power: carta.skill_power ?? '',
                skill_trigger: String(carta.skill_trigger || '').trim().toLowerCase()
            });
        });

        const itemsEnriquecidos = usuario.cartas
            .map((carta, index) => {
                const datos = mapaFaccion.get(normalizarNombre(carta.Nombre));
                return {
                    index,
                    carta: {
                        ...carta,
                        faccion: carta.faccion || datos?.faccion || '',
                        Afiliacion: carta.Afiliacion || datos?.Afiliacion || '',
                        skill_name: String(carta.skill_name || '').trim() || datos?.skill_name || '',
                        skill_info: String(carta.skill_info || '').trim() || datos?.skill_info || '',
                        skill_class: String(carta.skill_class || '').trim().toLowerCase() || datos?.skill_class || '',
                        skill_power: carta.skill_power ?? datos?.skill_power ?? '',
                        skill_trigger: String(carta.skill_trigger || '').trim().toLowerCase() || datos?.skill_trigger || ''
                    }
                };
            })
            .sort((a, b) => Number(b.carta.Poder || 0) - Number(a.carta.Poder || 0));

        usuarioCartasSeleccion = typeof window.deduplicarItemsCartasUsuarioMejorNivel === 'function'
            ? window.deduplicarItemsCartasUsuarioMejorNivel(itemsEnriquecidos)
            : itemsEnriquecidos;

        if (usuarioCartasSeleccion.length < CARTAS_POR_JUGADOR_COOP) {
            mostrarMensajeCoop(`Necesitas al menos ${CARTAS_POR_JUGADOR_COOP} cartas distintas por nombre.`, 'danger');
            return;
        }

        seleccionIndices = new Set();
        cartasVistaSeleccionCoop = new Map();
        busquedaSeleccionCoop = '';
        faccionEventoCoopActiva = '';
        afiliacionEventoCoopActiva = 'todas';
        skillClassEventoCoopActiva = 'todas';

        /* Cualquier instancia previa colgada se elimina antes de abrir. */
        document.getElementById('modal-seleccion-evento-coop')?.remove();

        const modal = document.createElement('div');
        modal.id = 'modal-seleccion-evento-coop';
        modal.className = 'modal-seleccion-mazo';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-seleccion-contenido">
                <div class="modal-header-desafio">
                    <h4>Selecciona ${CARTAS_POR_JUGADOR_COOP} cartas para el evento cooperativo</h4>
                    <div class="estado-seleccion" data-coop-estado>Seleccionadas: 0 / ${CARTAS_POR_JUGADOR_COOP}</div>
                </div>
                <div class="coop-prep-resumen" data-coop-resumen>
                    <div class="coop-prep-resumen-col" data-coop-resumen-col="A">
                        <div class="coop-prep-resumen-titulo"><span data-coop-resumen-nombre="A"></span><span class="coop-prep-resumen-listo" data-coop-resumen-listo="A">✔</span></div>
                        <div class="coop-prep-resumen-cartas" data-coop-resumen-cartas="A"></div>
                    </div>
                    <div class="coop-prep-resumen-col" data-coop-resumen-col="B">
                        <div class="coop-prep-resumen-titulo"><span data-coop-resumen-nombre="B"></span><span class="coop-prep-resumen-listo" data-coop-resumen-listo="B">✔</span></div>
                        <div class="coop-prep-resumen-cartas" data-coop-resumen-cartas="B"></div>
                    </div>
                </div>
                <div class="filtros-seleccion">
                    <select class="form-control selector-faccion-cartas" data-coop-filtro-faccion aria-label="Facción" style="width:auto; min-width:200px;"></select>
                    <select class="form-control" data-coop-filtro-afi style="width:auto; min-width:220px;"></select>
                    <select class="form-control filtro-skill-class" data-coop-filtro-skill style="width:auto; min-width:240px;"></select>
                    <input type="search" class="form-control busqueda-seleccion-cartas" data-coop-busqueda placeholder="Buscar carta..." autocomplete="off" style="flex:1; min-width:180px;">
                </div>
                <div class="cartas-seleccion-grid" data-coop-grid></div>
                <div class="modal-footer-desafio">
                    <button type="button" class="btn btn-secondary" data-coop-cancelar>Cancelar</button>
                    <button type="button" class="btn btn-primary" data-coop-confirmar disabled>Listo</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const grid = modal.querySelector('[data-coop-grid]');
        const estadoEl = modal.querySelector('[data-coop-estado]');
        const filtroAfi = modal.querySelector('[data-coop-filtro-afi]');
        const filtroFaccion = modal.querySelector('[data-coop-filtro-faccion]');
        const filtroSkill = modal.querySelector('[data-coop-filtro-skill]');
        const inputBusqueda = modal.querySelector('[data-coop-busqueda]');
        const btnCancelar = modal.querySelector('[data-coop-cancelar]');
        const btnConfirmar = modal.querySelector('[data-coop-confirmar]');

        if (filtroSkill && window.DCFiltrosCartas) {
            window.DCFiltrosCartas.configurarSelectorSkillClass(filtroSkill, {
                valorInicial: skillClassEventoCoopActiva,
                onChange: (valor) => {
                    skillClassEventoCoopActiva = valor;
                    renderizarGrid();
                }
            });
        }

        const clavesBloqueadasInvitador = new Set();

        function aplicarClavesCartasA(arr) {
            clavesBloqueadasInvitador.clear();
            (arr || []).forEach((k) => {
                const n = typeof k === 'string'
                    ? String(k).trim().toLowerCase()
                    : String(k?.n || '').trim().toLowerCase();
                if (n) clavesBloqueadasInvitador.add(n);
            });
        }

        function esCartaNoDisponibleParaB(item) {
            if (rolCoop !== 'B') return false;
            return clavesBloqueadasInvitador.has(normalizarNombre(item.carta.Nombre));
        }

        function cerrarPrepCoop() {
            coopPrepModalEstadoHandler = null;
            coopPrepModalSeleccionHandler = null;
            prepContext = null;
            modal.remove();
        }

        const contenedorPrincipal = modal.querySelector('.modal-seleccion-contenido');
        let overlayEsperaEl = null;
        if (contenedorPrincipal) {
            contenedorPrincipal.style.position = 'relative';
            overlayEsperaEl = document.createElement('div');
            overlayEsperaEl.className = 'coop-prep-espera-overlay';
            overlayEsperaEl.innerHTML = `
                <div class="coop-prep-espera-panel">
                    <p class="coop-prep-espera-texto">Esperando a que <strong class="coop-prep-espera-nombre"></strong> seleccione sus cartas.</p>
                </div>
            `;
            const nombreStrong = overlayEsperaEl.querySelector('.coop-prep-espera-nombre');
            if (nombreStrong) nombreStrong.textContent = nombreJugadorA;
            contenedorPrincipal.insertBefore(overlayEsperaEl, contenedorPrincipal.firstChild);
            if (rolCoop === 'A') {
                overlayEsperaEl.style.display = 'none';
            }
        }

        const resumenNombreEl = {
            A: modal.querySelector('[data-coop-resumen-nombre="A"]'),
            B: modal.querySelector('[data-coop-resumen-nombre="B"]')
        };
        const resumenCartasEl = {
            A: modal.querySelector('[data-coop-resumen-cartas="A"]'),
            B: modal.querySelector('[data-coop-resumen-cartas="B"]')
        };
        const resumenListoEl = {
            A: modal.querySelector('[data-coop-resumen-listo="A"]'),
            B: modal.querySelector('[data-coop-resumen-listo="B"]')
        };
        if (resumenNombreEl.A) resumenNombreEl.A.textContent = nombreJugadorA + (rolCoop === 'A' ? ' (tú)' : '');
        if (resumenNombreEl.B) resumenNombreEl.B.textContent = nombreJugadorB + (rolCoop === 'B' ? ' (tú)' : '');

        /** Bloquea el modal mostrando el overlay de espera (mismo patrón que P2 mientras P1 elige). */
        function bloquearModalEsperandoCompanero() {
            if (!overlayEsperaEl) return;
            const companeroListo = Boolean(panelSeleccion[rolCompanero]?.listo);
            const nombreEspera = rolCoop === 'A' ? nombreJugadorB : nombreJugadorA;
            const texto = overlayEsperaEl.querySelector('.coop-prep-espera-texto');
            if (texto) {
                texto.innerHTML = companeroListo
                    ? 'Selección completa. Iniciando partida cooperativa...'
                    : `Selección enviada. Esperando a que <strong class="coop-prep-espera-nombre">${nombreEspera}</strong> termine su selección.`;
            }
            overlayEsperaEl.style.display = '';
        }

        /** Representación ligera `{n, skin}` de la selección propia para el panel y la sincronización. */
        function construirMiSeleccionLive() {
            const lista = [];
            seleccionIndices.forEach((idx) => {
                const item = usuarioCartasSeleccion.find((x) => x.index === idx);
                if (!item) return;
                const vista = cartasVistaSeleccionCoop.get(idx);
                let skin = null;
                if (vista && vista.skinActivoId !== null && vista.skinActivoId !== undefined && Number.isFinite(Number(vista.skinActivoId))) {
                    skin = Number(vista.skinActivoId);
                }
                lista.push({ n: String(item.carta.Nombre || ''), skin });
            });
            return lista;
        }

        /** Actualiza el panel propio y emite la selección al servidor para sincronizar al compañero. */
        function notificarSeleccionLiveCoop() {
            if (!prepContext?.prepId) return;
            panelSeleccion[rolCoop].cartas = construirMiSeleccionLive();
            renderResumenSeleccionCoop();
            if (typeof window.emitCoopEventoPreparacionSeleccion === 'function') {
                window.emitCoopEventoPreparacionSeleccion({
                    prepId: prepContext.prepId,
                    cartas: panelSeleccion[rolCoop].cartas
                });
            }
        }

        function crearMiniaturaResumenCoop(entry) {
            const div = document.createElement('div');
            div.className = 'coop-prep-resumen-carta';
            if (!entry || !entry.n) {
                div.classList.add('coop-prep-resumen-carta--vacia');
                return div;
            }
            const ref = (entry.skin !== null && entry.skin !== undefined) ? `${entry.n}[${entry.skin}]` : entry.n;
            const carta = resolverCartaEnemigoVistaSync(ref, mapaCatalogoSeleccionCoop);
            if (typeof window.aplicarImagenFondoCarta === 'function') {
                window.aplicarImagenFondoCarta(div, carta);
            } else {
                div.style.backgroundImage = `url(${obtenerImagenCarta(carta)})`;
            }
            div.title = String(carta?.Nombre || entry.n);
            return div;
        }

        function renderResumenSeleccionCoop() {
            ['A', 'B'].forEach((rol) => {
                const cont = resumenCartasEl[rol];
                if (cont) {
                    cont.innerHTML = '';
                    const cartas = Array.isArray(panelSeleccion[rol]?.cartas) ? panelSeleccion[rol].cartas : [];
                    for (let i = 0; i < CARTAS_POR_JUGADOR_COOP; i += 1) {
                        cont.appendChild(crearMiniaturaResumenCoop(cartas[i] || null));
                    }
                }
                if (resumenListoEl[rol]) {
                    resumenListoEl[rol].style.display = panelSeleccion[rol]?.listo ? '' : 'none';
                }
            });
        }

        function procesarEstadoPreparacionCoop(det) {
            if (!prepContext || String(det?.prepId || '') !== String(prepContext.prepId)) {
                return;
            }
            if (Array.isArray(det.clavesCartasA)) {
                aplicarClavesCartasA(det.clavesCartasA);
            }
            if (typeof det.listoA === 'boolean') panelSeleccion.A.listo = det.listoA;
            if (typeof det.listoB === 'boolean') panelSeleccion.B.listo = det.listoB;
            if (Array.isArray(det.seleccionA)) panelSeleccion.A.cartas = det.seleccionA;
            if (Array.isArray(det.seleccionB)) panelSeleccion.B.cartas = det.seleccionB;
            if (rolCoop === 'B' && det.listoA && !confirmadoLocal && overlayEsperaEl) {
                overlayEsperaEl.style.display = 'none';
            }
            renderResumenSeleccionCoop();
            renderizarGrid();
            actualizarEstado();
        }

        /** Sincroniza el panel-resumen con la selección en vivo emitida por el compañero. */
        function procesarSeleccionLiveCoop(det) {
            if (!prepContext || String(det?.prepId || '') !== String(prepContext.prepId)) {
                return;
            }
            if (Array.isArray(det.seleccionA)) panelSeleccion.A.cartas = det.seleccionA;
            if (Array.isArray(det.seleccionB)) panelSeleccion.B.cartas = det.seleccionB;
            if (typeof det.listoA === 'boolean') panelSeleccion.A.listo = det.listoA;
            if (typeof det.listoB === 'boolean') panelSeleccion.B.listo = det.listoB;
            renderResumenSeleccionCoop();
        }

        function alCambiarFaccionCoop() {
            afiliacionEventoCoopActiva = 'todas';
            skillClassEventoCoopActiva = 'todas';
            renderizarFiltroAfiliacion();
            if (filtroSkill && window.DCFiltrosCartas) {
                skillClassEventoCoopActiva = window.DCFiltrosCartas.poblarSelectorSkillClass(filtroSkill, 'todas');
            }
            renderizarGrid();
        }

        function poblarSelectorFaccionCoop() {
            if (!filtroFaccion || !window.DCFiltrosCartas) {
                return faccionEventoCoopActiva;
            }
            return window.DCFiltrosCartas.poblarSelectorFaccion(
                filtroFaccion,
                usuarioCartasSeleccion.map((item) => item.carta),
                faccionEventoCoopActiva
            );
        }

        function renderizarFiltroAfiliacion() {
            const mapa = new Map();
            usuarioCartasSeleccion
                .filter((item) => cartaCoincideFaccionLocal(item.carta, faccionEventoCoopActiva))
                .forEach((item) => {
                    obtenerAfiliacionesCartaLocal(item.carta).forEach((afi) => {
                        const key = normalizarAfiliacionLocal(afi);
                        if (key && !mapa.has(key)) mapa.set(key, afi);
                    });
                });

            filtroAfi.innerHTML = '';
            const optTodas = document.createElement('option');
            optTodas.value = 'todas';
            optTodas.textContent = 'Todas';
            filtroAfi.appendChild(optTodas);

            Array.from(mapa.entries())
                .sort((a, b) => a[1].localeCompare(b[1]))
                .forEach(([, afi]) => {
                    const option = document.createElement('option');
                    option.value = afi;
                    option.textContent = afi;
                    filtroAfi.appendChild(option);
                });
            filtroAfi.value = 'todas';
        }

        function actualizarEstado() {
            estadoEl.textContent = `Seleccionadas: ${seleccionIndices.size} / ${CARTAS_POR_JUGADOR_COOP}`;
            let puedeConfirmar = seleccionIndices.size === CARTAS_POR_JUGADOR_COOP;
            if (puedeConfirmar && rolCoop === 'B') {
                for (const idx of seleccionIndices) {
                    const item = usuarioCartasSeleccion.find((x) => x.index === idx);
                    if (item && esCartaNoDisponibleParaB(item)) {
                        puedeConfirmar = false;
                        break;
                    }
                }
            }
            btnConfirmar.disabled = !puedeConfirmar;
        }

        function renderizarGrid() {
            grid.innerHTML = '';
            const cartasFiltradas = usuarioCartasSeleccion
                .filter((item) => cartaCoincideFaccionLocal(item.carta, faccionEventoCoopActiva))
                .filter((item) => {
                    if (afiliacionEventoCoopActiva === 'todas') return true;
                    const afis = obtenerAfiliacionesCartaLocal(item.carta).map(normalizarAfiliacionLocal);
                    return afis.includes(afiliacionEventoCoopActiva);
                })
                .filter((item) => {
                    if (!busquedaSeleccionCoop) return true;
                    const cartaBusqueda = obtenerCartaDisplaySeleccionCoop(item);
                    return typeof window.DCSeleccionCartaApariencia?.cartaCoincideBusqueda === 'function'
                        ? window.DCSeleccionCartaApariencia.cartaCoincideBusqueda(cartaBusqueda, busquedaSeleccionCoop)
                        : String(cartaBusqueda?.Nombre || '').toLowerCase().includes(busquedaSeleccionCoop);
                })
                .filter((item) => window.DCFiltrosCartas?.cartaCoincideSkillClass(
                    obtenerCartaDisplaySeleccionCoop(item),
                    skillClassEventoCoopActiva
                ) ?? true);

            cartasFiltradas.forEach((item) => {
                const carta = obtenerCartaDisplaySeleccionCoop(item);
                const noDisponible = esCartaNoDisponibleParaB(item);
                const cartaDiv = document.createElement('div');
                cartaDiv.className = `carta-mini ${seleccionIndices.has(item.index) ? 'seleccionada' : ''}`;
                if (noDisponible) cartaDiv.classList.add('coop-carta-no-disponible');
                if (typeof window.dcAplicarClasesNivelCartaCompleta === 'function') {
                    window.dcAplicarClasesNivelCartaCompleta(cartaDiv, carta);
                } else if (Number(carta.Nivel || 1) >= 6) {
                    cartaDiv.classList.add('nivel-legendaria');
                }
                if (typeof window.aplicarImagenFondoCarta === 'function') {
                    window.aplicarImagenFondoCarta(cartaDiv, carta);
                } else {
                    cartaDiv.style.backgroundImage = `url(${obtenerImagenCarta(carta)})`;
                }

                const estrellasDiv = document.createElement('div');
                estrellasDiv.className = 'estrellas-carta';
                if (typeof window.dcRellenarEstrellasCartaCompleta === 'function') {
                    window.dcRellenarEstrellasCartaCompleta(estrellasDiv, carta, {});
                } else {
                    const nivel = Number(carta.Nivel || 1);
                    for (let i = 0; i < nivel; i += 1) {
                        const estrella = document.createElement('img');
                        estrella.className = 'estrella';
                        estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
                        estrella.alt = 'star';
                        estrellasDiv.appendChild(estrella);
                    }
                }

                const detallesDiv = document.createElement('div');
                detallesDiv.className = 'detalles-carta';
                const nombre = document.createElement('span');
                nombre.className = 'nombre-carta';
                nombre.textContent = carta.Nombre;
                const poder = document.createElement('span');
                poder.className = 'poder-carta';
                poder.textContent = carta.Poder;
                detallesDiv.appendChild(nombre);
                detallesDiv.appendChild(poder);

                cartaDiv.appendChild(estrellasDiv);
                cartaDiv.appendChild(detallesDiv);

                const badgeHabilidad = window.crearBadgeHabilidadCarta ? window.crearBadgeHabilidadCarta(carta) : null;
                if (badgeHabilidad) cartaDiv.appendChild(badgeHabilidad);
                const badgeAfiliacion = window.crearBadgeAfiliacionCarta ? window.crearBadgeAfiliacionCarta(carta) : null;
                if (badgeAfiliacion) cartaDiv.appendChild(badgeAfiliacion);
                cartaDiv.appendChild(crearBarraSaludElementoLocal(carta));

                if (noDisponible) {
                    const badgeNd = document.createElement('div');
                    badgeNd.className = 'coop-prep-no-disponible-badge';
                    badgeNd.textContent = 'No disponible';
                    cartaDiv.appendChild(badgeNd);
                }

                cartaDiv.onclick = async () => {
                    if (noDisponible) {
                        return;
                    }
                    if (seleccionIndices.has(item.index)) {
                        seleccionIndices.delete(item.index);
                        cartasVistaSeleccionCoop.delete(item.index);
                        notificarSeleccionLiveCoop();
                        actualizarEstado();
                        renderizarGrid();
                        return;
                    }
                    if (seleccionIndices.size >= CARTAS_POR_JUGADOR_COOP) {
                        mostrarMensajeCoop(`Solo puedes seleccionar ${CARTAS_POR_JUGADOR_COOP} cartas.`, 'warning');
                        return;
                    }
                    let cartaFinal = { ...item.carta };
                    if (typeof window.DCSeleccionCartaApariencia !== 'undefined') {
                        const conSkin = await window.DCSeleccionCartaApariencia.seleccionarCartaConAparienciaOpcional({
                            carta: item.carta,
                            usuario,
                            mapaCatalogo: mapaCatalogoSeleccionCoop
                        });
                        if (!conSkin) {
                            return;
                        }
                        cartaFinal = conSkin;
                    }
                    cartasVistaSeleccionCoop.set(item.index, cartaFinal);
                    seleccionIndices.add(item.index);
                    notificarSeleccionLiveCoop();
                    actualizarEstado();
                    renderizarGrid();
                };
                grid.appendChild(cartaDiv);
            });
        }

        if (filtroFaccion) {
            filtroFaccion.addEventListener('change', () => {
                faccionEventoCoopActiva = filtroFaccion.value;
                alCambiarFaccionCoop();
            });
        }
        filtroAfi.addEventListener('change', () => {
            afiliacionEventoCoopActiva = normalizarAfiliacionLocal(filtroAfi.value || 'todas');
            renderizarGrid();
        });
        if (inputBusqueda) {
            inputBusqueda.addEventListener('input', () => {
                busquedaSeleccionCoop = String(inputBusqueda.value || '').trim().toLowerCase();
                renderizarGrid();
            });
        }

        btnCancelar.addEventListener('click', () => {
            cerrarPrepCoop();
        });

        btnConfirmar.addEventListener('click', () => {
            if (seleccionIndices.size !== CARTAS_POR_JUGADOR_COOP || !prepContext?.prepId) return;
            if (rolCoop === 'B') {
                for (const idx of seleccionIndices) {
                    const item = usuarioCartasSeleccion.find((x) => x.index === idx);
                    if (item && esCartaNoDisponibleParaB(item)) {
                        mostrarMensajeCoop('No puedes enviar cartas que ya ha elegido tu compañero.', 'warning');
                        return;
                    }
                }
            }
            const indicesCartas = Array.from(seleccionIndices);
            const skinsPorIndice = {};
            indicesCartas.forEach((ix) => {
                const vista = cartasVistaSeleccionCoop.get(ix);
                if (vista && vista.skinActivoId !== null && vista.skinActivoId !== undefined) {
                    skinsPorIndice[ix] = vista.skinActivoId;
                }
            });
            if (typeof window.emitCoopEventoPreparacionListo === 'function') {
                window.emitCoopEventoPreparacionListo({
                    prepId: prepContext.prepId,
                    indicesCartas,
                    skinsPorIndice
                });
            }
            /**
             * Tras confirmar NO cerramos el modal: lo dejamos bloqueado con el overlay de espera
             * (igual que P2 mientras P1 elige), mostrando en el panel-resumen las cartas de ambos
             * en tiempo real. El inicio real lo dispara el servidor (`dc:coop-session-start`) cuando
             * los dos jugadores estén listos, y la redirección a `tablero_coop.html` retira el modal.
             */
            confirmadoLocal = true;
            if (panelSeleccion[rolCoop]) panelSeleccion[rolCoop].listo = true;
            bloquearModalEsperandoCompanero();
            renderResumenSeleccionCoop();
            mostrarMensajeCoop('Selección enviada. Esperando a tu compañero...', 'success');
        });

        faccionEventoCoopActiva = poblarSelectorFaccionCoop();
        renderizarFiltroAfiliacion();
        renderizarGrid();
        actualizarEstado();
        renderResumenSeleccionCoop();

        coopPrepModalEstadoHandler = procesarEstadoPreparacionCoop;
        coopPrepModalSeleccionHandler = procesarSeleccionLiveCoop;
        if (ultimoDetalleEstadoPrepCoop && String(ultimoDetalleEstadoPrepCoop.prepId || '') === String(prepContext.prepId)) {
            procesarEstadoPreparacionCoop(ultimoDetalleEstadoPrepCoop);
        }
        if (ultimoDetalleSeleccionPrepCoop && String(ultimoDetalleSeleccionPrepCoop.prepId || '') === String(prepContext.prepId)) {
            procesarSeleccionLiveCoop(ultimoDetalleSeleccionPrepCoop);
        }
    }

    function iniciarSesionCoopRedirect(payload = {}) {
        if (typeof window.limpiarEstadoPvpResiduoPartidaLocal === 'function') {
            window.limpiarEstadoPvpResiduoPartidaLocal();
        }
        try {
            sessionStorage.removeItem('dc_tablero_fondo_url');
        } catch (_e) {
            /* noop */
        }
        localStorage.setItem('partidaModo', 'coop_evento_online');
        localStorage.setItem('partidaCoopSessionId', String(payload.sessionId || '').trim());
        localStorage.setItem('partidaCoopRol', String(payload.rolCoop || 'A'));
        localStorage.setItem('partidaCoopPayload', JSON.stringify(payload));
        try {
            localStorage.removeItem('desafioActivo');
        } catch (_e) {
            /* noop */
        }
        window.location.href = 'tablero_coop.html';
    }

    async function inicializarVistaEventosCoopOnline() {
        const gridHost = document.getElementById(EVENTOS_COOP_GRID_ID);
        if (!gridHost) return;

        try {
            const [eventos, catalogo] = await Promise.all([
                cargarEventosOnline(),
                obtenerCatalogoCartas()
            ]);
            eventosCoopListaCompleta = Array.isArray(eventos) ? eventos : [];
            const loteInicial = obtenerEventosRotacionActualCoop();
            eventosCoopEnRotacion = loteInicial;
            await renderizarEventosCoopGrid(loteInicial, catalogo, { usuario: obtenerUsuarioLocalCoop() });
            iniciarTemporizadorRotacionCoopEventos(catalogo);

            const tareasFondo = [];
            if (typeof window.DCSkinsCartas?.asegurarSkinsCargados === 'function') {
                tareasFondo.push(window.DCSkinsCartas.asegurarSkinsCargados());
            }
            if (typeof window.refrescarUsuarioSesionDesdeServidor === 'function') {
                tareasFondo.push(window.refrescarUsuarioSesionDesdeServidor());
            } else {
                tareasFondo.push(obtenerUsuarioActualCoop());
            }
            if (tareasFondo.length > 0) {
                void Promise.all(tareasFondo)
                    .then(() => renderizarEventosCoopGrid(
                        obtenerEventosRotacionActualCoop(),
                        catalogo,
                        { usuario: obtenerUsuarioLocalCoop() }
                    ))
                    .catch((err) => console.warn('[coop-eventos] carga en segundo plano:', err));
            }
        } catch (e) {
            console.error(e);
            gridHost.innerHTML = '<p class="text-warning">No se pudieron cargar los eventos cooperativos online.</p>';
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        const gridHost = document.getElementById(EVENTOS_COOP_GRID_ID);
        if (!gridHost) return;

        void inicializarVistaEventosCoopOnline();

        window.addEventListener('dc:coop-evento-invitacion', (ev) => {
            modalInvitacionEventoCoop(ev.detail || {});
        });

        window.addEventListener('dc:coop-evento-invitacion-rechazada', () => {
            mostrarMensajeCoop('Tu compañero ha rechazado la invitación al evento cooperativo.', 'warning');
        });

        window.addEventListener('dc:coop-evento-preparacion', (ev) => {
            void abrirModalSeleccionSeisCartas(ev.detail || {});
        });

        window.addEventListener('dc:coop-session-start', (ev) => {
            iniciarSesionCoopRedirect(ev.detail || {});
        });

        window.addEventListener('dc:coop-evento-preparacion-estado', (ev) => {
            const det = ev.detail || {};
            ultimoDetalleEstadoPrepCoop = det;
            if (typeof coopPrepModalEstadoHandler === 'function') {
                coopPrepModalEstadoHandler(det);
            }
        });

        window.addEventListener('dc:coop-evento-preparacion-seleccion', (ev) => {
            const det = ev.detail || {};
            ultimoDetalleSeleccionPrepCoop = det;
            if (typeof coopPrepModalSeleccionHandler === 'function') {
                coopPrepModalSeleccionHandler(det);
            }
        });
    });
})();
