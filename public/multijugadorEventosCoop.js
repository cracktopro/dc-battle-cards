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
            catalogo.map(carta => [normalizarNombre(carta.Nombre), carta])
        );

        contenedor.innerHTML = '';

        eventos.forEach(evento => {
            const card = document.createElement('div');
            card.className = 'evento-card pendiente';

            const nombre = document.createElement('div');
            nombre.className = 'evento-nombre';
            nombre.textContent = evento.nombre;

            const descripcion = document.createElement('div');
            descripcion.className = 'evento-descripcion';
            descripcion.textContent = evento.descripcion || 'Sin descripción.';

            const enemigosEl = document.createElement('div');
            enemigosEl.className = 'evento-enemigos';
            const etiquetaEnemigos = document.createElement('div');
            etiquetaEnemigos.className = 'evento-enemigos-label';
            etiquetaEnemigos.textContent = 'Enemigos';
            enemigosEl.appendChild(etiquetaEnemigos);

            const rivales = [
                ...(evento.enemigos || []).map(nombre => ({ nombre, boss: false })),
                ...(evento.boss ? [{ nombre: evento.boss, boss: true }] : [])
            ];

            rivales.forEach(rival => {
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
            for (let d = 1; d <= 6; d += 1) {
                const option = document.createElement('option');
                option.value = String(d);
                option.textContent = `${'★'.repeat(d)}  Nivel ${d}`;
                selectDificultad.appendChild(option);
            }
            selectDificultad.value = evento.dificultadSeleccionada ? String(Number(evento.dificultadSeleccionada)) : '1';
            selectDificultad.addEventListener('change', () => {
                evento.dificultadSeleccionada = Number(selectDificultad.value);
            });
            evento.dificultadSeleccionada = Number(selectDificultad.value);
            contenedorDificultad.appendChild(dificultadLabel);
            contenedorDificultad.appendChild(selectDificultad);

            const empezarBtn = document.createElement('button');
            empezarBtn.type = 'button';
            empezarBtn.className = 'btn btn-primary btn-block evento-empezar-btn';
            empezarBtn.textContent = 'Empezar evento';
            empezarBtn.addEventListener('click', () => {
                const dif = Number(selectDificultad.value);
                if (typeof window.emitCoopEventoInvitar === 'function') {
                    window.emitCoopEventoInvitar({
                        eventoId: evento.id,
                        dificultad: dif,
                        eventoNombre: evento.nombre
                    });
                }
            });

            card.appendChild(nombre);
            card.appendChild(descripcion);
            card.appendChild(enemigosEl);
            card.appendChild(recompensaLabel);
            card.appendChild(recompensas);
            card.appendChild(contenedorDificultad);
            card.appendChild(empezarBtn);
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
    const seleccionIndices = new Set();

    async function abrirModalSeleccionSeisCartas(payload) {
        prepContext = {
            prepId: String(payload?.prepId || '').trim(),
            rolCoop: String(payload?.rolCoop || 'A').trim().toUpperCase()
        };
        seleccionIndices.clear();

        const email = localStorage.getItem('email');
        const response = await fetch('/get-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        const data = await response.json();
        const usuario = data.usuario;
        if (!usuario || !Array.isArray(usuario.cartas) || usuario.cartas.length < 6) {
            mostrarMensajeCoop('Necesitas al menos 6 cartas en tu colección.', 'danger');
            return;
        }

        const catalogo = await obtenerCatalogoCartas();
        const mapaFaccion = new Map();
        catalogo.forEach(carta => {
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

        const wrap = document.createElement('div');
        const titulo = document.createElement('h4');
        titulo.textContent = 'Selecciona 6 cartas para el evento cooperativo';
        titulo.style.marginTop = '0';

        const estado = document.createElement('p');
        estado.id = 'coop-prep-seleccion-estado';
        estado.textContent = 'Seleccionadas: 0 / 6';

        const grid = document.createElement('div');
        grid.className = 'evento-seleccion-grid';
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(72px, 1fr))';
        grid.style.gap = '8px';
        grid.style.maxHeight = '48vh';
        grid.style.overflowY = 'auto';
        grid.style.marginTop = '10px';

        function actualizarEstado() {
            estado.textContent = `Seleccionadas: ${seleccionIndices.size} / 6`;
            listoBtn.disabled = seleccionIndices.size !== 6;
            grid.querySelectorAll('.carta-mini').forEach(el => {
                const idx = Number(el.dataset.index);
                el.classList.toggle('seleccionada', seleccionIndices.has(idx));
            });
        }

        usuarioCartasSeleccion.forEach(item => {
            const div = document.createElement('div');
            div.className = 'carta-mini';
            div.dataset.index = String(item.index);
            div.style.backgroundImage = `url(${obtenerImagenCarta(item.carta)})`;
            div.style.height = '96px';
            div.style.borderRadius = '8px';
            div.style.border = '2px solid transparent';
            div.style.cursor = 'pointer';
            div.title = item.carta.Nombre || '';
            div.addEventListener('click', () => {
                if (seleccionIndices.has(item.index)) {
                    seleccionIndices.delete(item.index);
                } else {
                    if (seleccionIndices.size >= 6) {
                        mostrarMensajeCoop('Ya tienes 6 cartas seleccionadas.', 'warning');
                        return;
                    }
                    seleccionIndices.add(item.index);
                }
                actualizarEstado();
            });
            grid.appendChild(div);
        });

        const listoBtn = document.createElement('button');
        listoBtn.type = 'button';
        listoBtn.className = 'btn btn-primary';
        listoBtn.textContent = 'Listo';
        listoBtn.disabled = true;
        listoBtn.style.marginTop = '12px';

        const cancelWrap = document.createElement('p');
        cancelWrap.style.fontSize = '0.85rem';
        cancelWrap.style.opacity = '0.85';
        cancelWrap.textContent = 'Cuando ambos jugadores marquen listo, comenzará la partida en el tablero cooperativo.';

        const filaListo = document.createElement('div');
        filaListo.appendChild(listoBtn);

        listoBtn.addEventListener('click', () => {
            if (seleccionIndices.size !== 6 || !prepContext?.prepId) return;
            const indicesCartas = Array.from(seleccionIndices);
            if (typeof window.emitCoopEventoPreparacionListo === 'function') {
                window.emitCoopEventoPreparacionListo({
                    prepId: prepContext.prepId,
                    indicesCartas
                });
            }
            cerrarPrep();
        });

        wrap.appendChild(titulo);
        wrap.appendChild(estado);
        wrap.appendChild(grid);
        wrap.appendChild(filaListo);
        wrap.appendChild(cancelWrap);

        const { overlay, cerrar } = crearOverlayModal(wrap);
        function cerrarPrep() {
            prepContext = null;
            cerrar();
        }
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
            await renderizarEventosCoopGrid(eventos, catalogo);
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
