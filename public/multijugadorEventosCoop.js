/**
 * Eventos cooperativos online (eventos_online.xlsx) en la vista multijugador.
 * Aislado del lobby PvP y de vistaJuego offline.
 */
(function () {
    const EVENTOS_COOP_GRID_ID = 'multi-eventos-coop-grid';
    const ICONO_MEJORA = '/resources/icons/mejora.png';
    const ICONO_MEJORA_ESPECIAL = '/resources/icons/mejora_especial.png';
    const ICONO_MONEDA = '/resources/icons/moneda.png';

    function normalizarNombre(nombre) {
        return String(nombre || '').trim().toLowerCase();
    }

    /* Helpers locales aislados (replican `crearMazos.js` / `partida.js`) para no
     * acoplar este módulo coop a esos ficheros, que no se cargan en multijugador.html.
     */
    function normalizarFaccionLocal(valor) {
        if (!valor) return '';
        const f = String(valor).trim().toUpperCase();
        return (f === 'H' || f === 'V') ? f : '';
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
    const VERSION_ROTACION_COOP_EVENTOS = 'event-rotation-v1';
    /** Lista completa del XLSX; `obtenerEventosRotacionActualCoop` devuelve el lote de 3 vigente. */
    let eventosCoopListaCompleta = [];
    let eventosCoopEnRotacion = [];
    let temporizadorRotacionCoopEventos = null;

    function obtenerVentanaRotacionCoopEventos() {
        const ahora = Date.now();
        const idVentana = Math.floor(ahora / ROTACION_COOP_EVENTOS_MS);
        const inicio = idVentana * ROTACION_COOP_EVENTOS_MS;
        const fin = inicio + ROTACION_COOP_EVENTOS_MS;
        return { ahora, idVentana, inicio, fin };
    }

    function obtenerEventosRotacionActualCoop() {
        if (!Array.isArray(eventosCoopListaCompleta) || eventosCoopListaCompleta.length === 0) {
            return [];
        }
        const { idVentana } = obtenerVentanaRotacionCoopEventos();
        const tamanoLote = 3;
        const totalLotes = Math.ceil(eventosCoopListaCompleta.length / tamanoLote);
        const loteActual = totalLotes > 0 ? (idVentana % totalLotes) : 0;
        const inicio = loteActual * tamanoLote;
        return eventosCoopListaCompleta.slice(inicio, inicio + tamanoLote);
    }

    function obtenerClaveRotacionEventosLocal() {
        const { idVentana } = obtenerVentanaRotacionCoopEventos();
        return `${VERSION_ROTACION_COOP_EVENTOS}-${idVentana}`;
    }

    function formatearTiempoRestanteCoop(msRestantes) {
        const totalSegundos = Math.max(0, Math.floor(msRestantes / 1000));
        const horas = Math.floor(totalSegundos / 3600);
        const minutos = Math.floor((totalSegundos % 3600) / 60);
        const segundos = totalSegundos % 60;
        return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
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
        timerValorEl.textContent = formatearTiempoRestanteCoop(restante);
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

    async function obtenerUsuarioActualCoop() {
        const email = localStorage.getItem('email');
        if (!email) return null;
        try {
            const response = await fetch('/get-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            if (!response.ok) return null;
            const data = await response.json();
            return data?.usuario || null;
        } catch (_e) {
            return null;
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
        const boss = String(fila.boss || '').trim();
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
            dificultadSeleccionada: null
        };
    }

    async function obtenerCatalogoCartas() {
        const response = await fetch('resources/cartas.xlsx');
        if (!response.ok) throw new Error('cartas');
        const data = await response.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        return XLSX.utils.sheet_to_json(sheet, { defval: '' });
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

    async function renderizarEventosCoopGrid(eventos, catalogo) {
        const contenedor = document.getElementById(EVENTOS_COOP_GRID_ID);
        if (!contenedor) return;

        const mapaCatalogo = new Map(
            catalogo.map((carta) => [normalizarNombre(carta.Nombre), carta])
        );

        /* Mismo criterio que VS BOT: marcar eventos ya jugados en la rotación
         * actual usando `usuario.eventosJugadosPorRotacion[claveRotacion]`. */
        const usuario = await obtenerUsuarioActualCoop();
        const claveRotacion = obtenerClaveRotacionEventosLocal();
        const jugadosPorRotacion = (usuario?.eventosJugadosPorRotacion && typeof usuario.eventosJugadosPorRotacion === 'object')
            ? usuario.eventosJugadosPorRotacion
            : {};
        const jugadosActual = new Set((jugadosPorRotacion[claveRotacion] || []).map((id) => Number(id)));

        contenedor.innerHTML = '';

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

            /* Mismo orden visual que VS BOT: la etiqueta "Enemigos" va FUERA y
             * encima del grid de enemigos, no dentro. */
            const etiquetaEnemigos = document.createElement('div');
            etiquetaEnemigos.className = 'evento-enemigos-label';
            etiquetaEnemigos.textContent = 'Enemigos';

            const enemigosEl = document.createElement('div');
            enemigosEl.className = 'evento-enemigos';

            const rivales = [
                ...(evento.enemigos || []).map((n) => ({ nombre: n, boss: false })),
                ...(evento.boss ? [{ nombre: evento.boss, boss: true }] : [])
            ];

            rivales.forEach((rival) => {
                const nombreEnemigo = rival.nombre;
                const cartaBase = mapaCatalogo.get(normalizarNombre(nombreEnemigo)) || { Nombre: nombreEnemigo, Nivel: 1 };
                const enemigoCard = document.createElement('div');
                enemigoCard.className = `evento-enemigo-card ${rival.boss ? 'boss' : ''}`;
                enemigoCard.style.backgroundImage = `url(${typeof obtenerImagenCarta === 'function' ? obtenerImagenCarta(cartaBase) : ''})`;

                const etiqueta = document.createElement('div');
                etiqueta.className = 'evento-enemigo-nombre';
                etiqueta.textContent = nombreEnemigo;
                enemigoCard.appendChild(etiqueta);
                enemigosEl.appendChild(enemigoCard);
            });

            const recompensaLabel = document.createElement('div');
            recompensaLabel.className = 'evento-recompensas-label';
            recompensaLabel.textContent = 'Recompensas';

            const recompensas = document.createElement('div');
            recompensas.className = 'evento-recompensas';
            const cartaRecompensaCatalogo = mapaCatalogo.get(normalizarNombre(evento.cartaRecompensa || ''));
            if (cartaRecompensaCatalogo) {
                const mini = document.createElement('div');
                mini.className = 'evento-recompensa-card';
                mini.style.backgroundImage = `url(${obtenerImagenCarta(cartaRecompensaCatalogo)})`;
                const nombreMini = document.createElement('div');
                nombreMini.className = 'evento-enemigo-nombre';
                nombreMini.textContent = cartaRecompensaCatalogo.Nombre;
                mini.appendChild(nombreMini);
                recompensas.appendChild(mini);
            }
            const puntosEvento = Math.max(0, Number(evento.puntos || 0));
            const metaPuntos = document.createElement('div');
            metaPuntos.className = 'evento-recompensa-tag';
            metaPuntos.innerHTML = `<img src="${ICONO_MONEDA}" alt="Moneda" style="width:28px;height:28px;object-fit:contain;"> <span>${puntosEvento}</span>`;
            recompensas.appendChild(metaPuntos);
            const cantidadMejoras = Math.max(0, Number(evento.mejora || 0));
            if (cantidadMejoras > 0) {
                const tagMejora = document.createElement('div');
                tagMejora.className = 'evento-recompensa-tag';
                tagMejora.innerHTML = `<img src="${ICONO_MEJORA}" alt="Mejora" style="width:28px;height:28px;object-fit:contain;"> <span>x${cantidadMejoras}</span>`;
                recompensas.appendChild(tagMejora);
            }
            const cantidadEspeciales = Math.max(0, Number(evento.mejora_especial || 0));
            if (cantidadEspeciales > 0) {
                const tagEspecial = document.createElement('div');
                tagEspecial.className = 'evento-recompensa-tag';
                tagEspecial.innerHTML = `<img src="${ICONO_MEJORA_ESPECIAL}" alt="Mejora especial" style="width:28px;height:28px;object-fit:contain;"> <span>x${cantidadEspeciales}</span>`;
                recompensas.appendChild(tagEspecial);
            }

            const contenedorDificultad = document.createElement('div');
            contenedorDificultad.className = 'evento-dificultad';
            const dificultadLabel = document.createElement('label');
            dificultadLabel.className = 'evento-dificultad-label';
            dificultadLabel.textContent = 'Dificultad';
            const selectDificultad = document.createElement('select');
            selectDificultad.className = 'evento-dificultad-select';
            const optionPlaceholder = document.createElement('option');
            optionPlaceholder.value = '';
            optionPlaceholder.textContent = 'Selecciona Dificultad';
            selectDificultad.appendChild(optionPlaceholder);
            for (let d = 1; d <= 6; d += 1) {
                const option = document.createElement('option');
                option.value = String(d);
                option.textContent = `${'★'.repeat(d)}  Nivel ${d}`;
                selectDificultad.appendChild(option);
            }
            selectDificultad.value = evento.dificultadSeleccionada ? String(Number(evento.dificultadSeleccionada)) : '';
            selectDificultad.disabled = yaJugado;
            selectDificultad.addEventListener('change', () => {
                const valor = selectDificultad.value;
                evento.dificultadSeleccionada = valor ? Number(valor) : null;
            });
            contenedorDificultad.appendChild(dificultadLabel);
            contenedorDificultad.appendChild(selectDificultad);

            const empezarBtn = document.createElement('button');
            empezarBtn.type = 'button';
            empezarBtn.className = `btn ${yaJugado ? 'btn-success' : 'btn-primary'}`;
            empezarBtn.textContent = yaJugado ? 'Ya jugado en esta rotación' : 'Empezar Evento';
            empezarBtn.disabled = yaJugado;
            empezarBtn.addEventListener('click', () => {
                if (yaJugado) return;
                const dif = Number(selectDificultad.value);
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

            /* Mismo bloque inferior que VS BOT (clase `evento-bottom`) para que
             * recompensas/dificultad/botón queden anclados al fondo y todas las
             * cards queden alineadas independientemente del nº de enemigos. */
            const bloqueInferior = document.createElement('div');
            bloqueInferior.className = 'evento-bottom';
            bloqueInferior.appendChild(recompensaLabel);
            bloqueInferior.appendChild(recompensas);
            bloqueInferior.appendChild(contenedorDificultad);
            bloqueInferior.appendChild(empezarBtn);

            card.appendChild(nombre);
            card.appendChild(descripcion);
            card.appendChild(etiquetaEnemigos);
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
    let usuarioCartasSeleccion = [];
    let seleccionIndices = new Set();
    let faccionEventoCoopActiva = 'H';
    let afiliacionEventoCoopActiva = 'todas';

    /**
     * Modal de selección de 6 cartas para el evento coop. Replica el formato
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

        const usuario = await obtenerUsuarioActualCoop();
        if (!usuario || !Array.isArray(usuario.cartas) || usuario.cartas.length < 6) {
            mostrarMensajeCoop('Necesitas al menos 6 cartas en tu colección.', 'danger');
            return;
        }
        try {
            localStorage.setItem('usuario', JSON.stringify(usuario));
        } catch (_e) { /* noop */ }

        const catalogo = await obtenerCatalogoCartas();
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

        if (usuarioCartasSeleccion.length < 6) {
            mostrarMensajeCoop('Necesitas al menos 6 cartas distintas por nombre.', 'danger');
            return;
        }

        seleccionIndices = new Set();
        faccionEventoCoopActiva = 'H';
        afiliacionEventoCoopActiva = 'todas';

        /* Cualquier instancia previa colgada se elimina antes de abrir. */
        document.getElementById('modal-seleccion-evento-coop')?.remove();

        const modal = document.createElement('div');
        modal.id = 'modal-seleccion-evento-coop';
        modal.className = 'modal-seleccion-mazo';
        modal.style.display = 'flex';
        modal.innerHTML = `
            <div class="modal-seleccion-contenido">
                <div class="modal-header-desafio">
                    <h4>Selecciona 6 cartas para el evento cooperativo</h4>
                    <div class="estado-seleccion" data-coop-estado>Seleccionadas: 0 / 6</div>
                </div>
                <div class="filtros-seleccion">
                    <div class="faccion-tabs">
                        <button type="button" class="btn faccion-tab active" data-coop-tab="H">Héroes</button>
                        <button type="button" class="btn faccion-tab" data-coop-tab="V">Villanos</button>
                    </div>
                    <select class="form-control" data-coop-filtro-afi style="width:auto; min-width:220px;"></select>
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
        const btnTabH = modal.querySelector('[data-coop-tab="H"]');
        const btnTabV = modal.querySelector('[data-coop-tab="V"]');
        const btnCancelar = modal.querySelector('[data-coop-cancelar]');
        const btnConfirmar = modal.querySelector('[data-coop-confirmar]');

        function cerrarPrepCoop() {
            prepContext = null;
            modal.remove();
        }

        function actualizarBotonesFaccion() {
            btnTabH.classList.toggle('active', faccionEventoCoopActiva === 'H');
            btnTabV.classList.toggle('active', faccionEventoCoopActiva === 'V');
        }

        function renderizarFiltroAfiliacion() {
            const mapa = new Map();
            usuarioCartasSeleccion
                .filter((item) => normalizarFaccionLocal(item.carta.faccion) === faccionEventoCoopActiva)
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
            estadoEl.textContent = `Seleccionadas: ${seleccionIndices.size} / 6`;
            btnConfirmar.disabled = seleccionIndices.size !== 6;
        }

        function renderizarGrid() {
            grid.innerHTML = '';
            const cartasFiltradas = usuarioCartasSeleccion
                .filter((item) => normalizarFaccionLocal(item.carta.faccion) === faccionEventoCoopActiva)
                .filter((item) => {
                    if (afiliacionEventoCoopActiva === 'todas') return true;
                    const afis = obtenerAfiliacionesCartaLocal(item.carta).map(normalizarAfiliacionLocal);
                    return afis.includes(afiliacionEventoCoopActiva);
                });

            cartasFiltradas.forEach((item) => {
                const carta = item.carta;
                const cartaDiv = document.createElement('div');
                cartaDiv.className = `carta-mini ${seleccionIndices.has(item.index) ? 'seleccionada' : ''}`;
                if (Number(carta.Nivel || 1) >= 6) cartaDiv.classList.add('nivel-legendaria');
                cartaDiv.style.backgroundImage = `url(${obtenerImagenCarta(carta)})`;

                const estrellasDiv = document.createElement('div');
                estrellasDiv.className = 'estrellas-carta';
                const nivel = Number(carta.Nivel || 1);
                for (let i = 0; i < nivel; i += 1) {
                    const estrella = document.createElement('img');
                    estrella.className = 'estrella';
                    estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
                    estrella.alt = 'star';
                    estrellasDiv.appendChild(estrella);
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

                cartaDiv.onclick = () => {
                    if (seleccionIndices.has(item.index)) {
                        seleccionIndices.delete(item.index);
                    } else {
                        if (seleccionIndices.size >= 6) {
                            mostrarMensajeCoop('Solo puedes seleccionar 6 cartas.', 'warning');
                            return;
                        }
                        seleccionIndices.add(item.index);
                    }
                    actualizarEstado();
                    renderizarGrid();
                };
                grid.appendChild(cartaDiv);
            });
        }

        btnTabH.addEventListener('click', () => {
            faccionEventoCoopActiva = 'H';
            afiliacionEventoCoopActiva = 'todas';
            actualizarBotonesFaccion();
            renderizarFiltroAfiliacion();
            renderizarGrid();
        });
        btnTabV.addEventListener('click', () => {
            faccionEventoCoopActiva = 'V';
            afiliacionEventoCoopActiva = 'todas';
            actualizarBotonesFaccion();
            renderizarFiltroAfiliacion();
            renderizarGrid();
        });
        filtroAfi.addEventListener('change', () => {
            afiliacionEventoCoopActiva = normalizarAfiliacionLocal(filtroAfi.value || 'todas');
            renderizarGrid();
        });

        btnCancelar.addEventListener('click', () => {
            cerrarPrepCoop();
        });

        btnConfirmar.addEventListener('click', () => {
            if (seleccionIndices.size !== 6 || !prepContext?.prepId) return;
            const indicesCartas = Array.from(seleccionIndices);
            if (typeof window.emitCoopEventoPreparacionListo === 'function') {
                window.emitCoopEventoPreparacionListo({
                    prepId: prepContext.prepId,
                    indicesCartas
                });
            }
            /* Mantener el modal cerrado pero con un aviso (mismo patrón que la
             * versión previa), ya que el inicio real depende del compañero. */
            mostrarMensajeCoop('Esperando a que tu compañero termine la selección...', 'success');
            cerrarPrepCoop();
        });

        actualizarBotonesFaccion();
        renderizarFiltroAfiliacion();
        renderizarGrid();
        actualizarEstado();
    }

    function iniciarSesionCoopRedirect(payload = {}) {
        if (typeof window.limpiarEstadoPvpResiduoPartidaLocal === 'function') {
            window.limpiarEstadoPvpResiduoPartidaLocal();
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

    document.addEventListener('DOMContentLoaded', async () => {
        const gridHost = document.getElementById(EVENTOS_COOP_GRID_ID);
        if (!gridHost) return;

        try {
            const [eventos, catalogo] = await Promise.all([cargarEventosOnline(), obtenerCatalogoCartas()]);
            eventosCoopListaCompleta = Array.isArray(eventos) ? eventos : [];
            const loteInicial = obtenerEventosRotacionActualCoop();
            eventosCoopEnRotacion = loteInicial;
            await renderizarEventosCoopGrid(loteInicial, catalogo);
            iniciarTemporizadorRotacionCoopEventos(catalogo);
        } catch (e) {
            console.error(e);
            gridHost.innerHTML = '<p class="text-warning">No se pudieron cargar los eventos cooperativos online.</p>';
        }

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
    });
})();
