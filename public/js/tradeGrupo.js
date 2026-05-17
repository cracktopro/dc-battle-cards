/**
 * Intercambio de cartas duplicadas entre miembros del mismo grupo (socket vía cliente.js).
 */
(function () {
    const ICONO_MONEDA = '/resources/icons/moneda.png';
    const AVATAR_FALLBACK = 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';

    let estadoRemoto = { activo: false };
    let miEmail = '';
    let modalSolicitudEntrante = null;
    const filtrosInventarioTrade = {
        vista: 'duplicados',
        nombre: '',
        faccion: 'todas',
        afiliacion: 'todas'
    };

    function obtenerEmailSesion() {
        return String(localStorage.getItem('email') || '').trim();
    }

    function obtenerUsuarioLocal() {
        try {
            return JSON.parse(localStorage.getItem('usuario') || 'null');
        } catch (_e) {
            return null;
        }
    }

    function obtenerEstadoGrupo() {
        try {
            return JSON.parse(localStorage.getItem('grupoActual') || '{}');
        } catch (_e) {
            return {};
        }
    }

    function emitir(evento, payload) {
        if (typeof window.emitTradeGrupo === 'function') {
            window.emitTradeGrupo(evento, payload);
        }
    }

    function normalizarFaccionCarta(carta) {
        const faccion = String(carta?.faccion || carta?.Faccion || '').trim().toUpperCase();
        return faccion === 'H' || faccion === 'V' ? faccion : '';
    }

    function obtenerAfiliacionesCartaTrade(carta) {
        if (typeof window.obtenerAfiliacionesCarta === 'function') {
            return window.obtenerAfiliacionesCarta(carta);
        }
        const raw = String(carta?.Afiliacion || carta?.afiliacion || '').trim();
        if (!raw) {
            return [];
        }
        return raw.split(';').map((s) => s.trim()).filter(Boolean);
    }

    function agruparCartasPorNombreTrade(cartas) {
        const mapa = new Map();
        (cartas || []).forEach((carta, index) => {
            const nombre = String(carta?.Nombre || '').trim();
            if (!nombre) {
                return;
            }
            if (!mapa.has(nombre)) {
                mapa.set(nombre, []);
            }
            mapa.get(nombre).push({ index, carta });
        });
        return mapa;
    }

    /** Índices de copias sobrantes intercambiables (misma regla que el servidor). */
    function obtenerIndicesDuplicadosIntercambiables(cartas) {
        const indices = new Set();
        agruparCartasPorNombreTrade(cartas).forEach((grupo) => {
            if (grupo.length < 2) {
                return;
            }
            grupo.sort((a, b) => {
                const dn = Number(b.carta?.Nivel || 1) - Number(a.carta?.Nivel || 1);
                if (dn !== 0) {
                    return dn;
                }
                return Number(b.carta?.Poder || 0) - Number(a.carta?.Poder || 0);
            });
            grupo.slice(1).forEach((item) => {
                indices.add(item.index);
            });
        });
        return indices;
    }

    function construirItemsInventarioTrade(cartas) {
        const indicesDuplicados = obtenerIndicesDuplicadosIntercambiables(cartas);
        const items = [];
        (cartas || []).forEach((carta, index) => {
            const nombre = String(carta?.Nombre || '').trim();
            if (!nombre || !carta) {
                return;
            }
            items.push({
                index,
                carta,
                nombre,
                esDuplicadoIntercambiable: indicesDuplicados.has(index),
                faccion: normalizarFaccionCarta(carta),
                afiliaciones: obtenerAfiliacionesCartaTrade(carta)
            });
        });
        return items;
    }

    function obtenerAfiliacionesUnicasInventario(cartas) {
        const set = new Set();
        construirItemsInventarioTrade(cartas).forEach((item) => {
            item.afiliaciones.forEach((a) => set.add(a));
        });
        return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }

    function filtrarItemsInventarioTrade(items) {
        const nombreFiltro = String(filtrosInventarioTrade.nombre || '').trim().toLowerCase();
        const faccionFiltro = filtrosInventarioTrade.faccion;
        const afiliacionFiltro = filtrosInventarioTrade.afiliacion;
        const vista = filtrosInventarioTrade.vista;

        return items.filter((item) => {
            if (vista === 'duplicados' && !item.esDuplicadoIntercambiable) {
                return false;
            }
            if (vista === 'otras' && item.esDuplicadoIntercambiable) {
                return false;
            }
            if (nombreFiltro && !item.nombre.toLowerCase().includes(nombreFiltro)) {
                return false;
            }
            if (faccionFiltro === 'H' || faccionFiltro === 'V') {
                if (item.faccion !== faccionFiltro) {
                    return false;
                }
            }
            if (afiliacionFiltro && afiliacionFiltro !== 'todas') {
                const coincide = item.afiliaciones.some(
                    (a) => a.localeCompare(afiliacionFiltro, undefined, { sensitivity: 'base' }) === 0
                );
                if (!coincide) {
                    return false;
                }
            }
            return true;
        });
    }

    function obtenerSaludMaxCartaTrade(carta) {
        if (!carta) {
            return 0;
        }
        const saludMax = Number(carta.SaludMax ?? carta.saludMax);
        if (Number.isFinite(saludMax) && saludMax > 0) {
            return saludMax;
        }
        const salud = Number(carta.Salud ?? carta.salud);
        if (Number.isFinite(salud) && salud > 0) {
            return salud;
        }
        return Math.max(Number(carta.Poder || 0), 0);
    }

    function obtenerSaludActualCartaTrade(carta) {
        const saludMax = Math.max(obtenerSaludMaxCartaTrade(carta), 0);
        const salud = Number(carta?.Salud ?? carta?.salud);
        const saludValida = Number.isFinite(salud) ? salud : saludMax;
        return Math.max(0, Math.min(saludValida, saludMax));
    }

    function crearBarraSaludElementoTrade(carta) {
        const saludActual = obtenerSaludActualCartaTrade(carta);
        const saludMax = Math.max(obtenerSaludMaxCartaTrade(carta), 1);
        const porcentajeSalud = Math.max(0, Math.min((saludActual / saludMax) * 100, 100));
        const ratioSalud = porcentajeSalud / 100;

        const barraSaludContenedor = document.createElement('div');
        barraSaludContenedor.classList.add('barra-salud-contenedor');

        const barraSaludRelleno = document.createElement('div');
        barraSaludRelleno.classList.add('barra-salud-relleno');
        barraSaludRelleno.style.width = `${porcentajeSalud}%`;
        barraSaludRelleno.style.setProperty('--health-ratio', String(ratioSalud));

        const saludSpan = document.createElement('span');
        saludSpan.classList.add('salud-carta');
        saludSpan.textContent = `${saludActual}/${saludMax}`;

        barraSaludContenedor.appendChild(barraSaludRelleno);
        barraSaludContenedor.appendChild(saludSpan);
        return barraSaludContenedor;
    }

    function crearMiniCarta(carta, opciones = {}) {
        const wrap = document.createElement('div');
        wrap.className = 'trade-carta-wrap';
        if (opciones.seleccionada) {
            wrap.classList.add('trade-carta-wrap--seleccionada');
        }
        if (opciones.enOferta) {
            wrap.classList.add('trade-carta-wrap--en-oferta');
        }
        if (opciones.soloVista) {
            wrap.classList.add('trade-carta-wrap--solo-vista');
            wrap.title = opciones.titleSoloVista || 'Solo las copias duplicadas sobrantes se pueden intercambiar.';
        }
        if (opciones.onClick) {
            wrap.classList.add('trade-carta-wrap--clicable');
            wrap.addEventListener('click', opciones.onClick);
        }

        const cartaDiv = document.createElement('div');
        cartaDiv.classList.add('carta');
        if (typeof window.dcAplicarClasesNivelCartaCompleta === 'function') {
            window.dcAplicarClasesNivelCartaCompleta(cartaDiv, carta);
        } else if (Number(carta?.Nivel || 1) >= 6) {
            cartaDiv.classList.add('nivel-legendaria');
        }

        const imagenUrl = typeof window.obtenerImagenCarta === 'function'
            ? window.obtenerImagenCarta(carta)
            : (carta?.imagen || AVATAR_FALLBACK);
        cartaDiv.style.backgroundImage = `url(${imagenUrl})`;
        cartaDiv.style.backgroundSize = 'cover';
        cartaDiv.style.backgroundPosition = 'center top';

        const detallesDiv = document.createElement('div');
        detallesDiv.classList.add('detalles-carta');

        const nombreSpan = document.createElement('span');
        nombreSpan.classList.add('nombre-carta');
        nombreSpan.textContent = carta?.Nombre || 'Carta sin nombre';

        const poderSpan = document.createElement('span');
        poderSpan.classList.add('poder-carta');
        poderSpan.textContent = carta?.Poder ?? 0;

        detallesDiv.appendChild(nombreSpan);
        detallesDiv.appendChild(poderSpan);

        const estrellasDiv = document.createElement('div');
        estrellasDiv.classList.add('estrellas-carta');
        if (typeof window.dcRellenarEstrellasCartaCompleta === 'function') {
            window.dcRellenarEstrellasCartaCompleta(estrellasDiv, carta, {});
        } else {
            const nivel = Number(carta?.Nivel || 1);
            for (let i = 0; i < nivel; i++) {
                const estrella = document.createElement('img');
                estrella.classList.add('estrella');
                estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
                estrella.alt = 'star';
                estrellasDiv.appendChild(estrella);
            }
        }

        const badgeHabilidad = window.crearBadgeHabilidadCarta ? window.crearBadgeHabilidadCarta(carta) : null;
        if (badgeHabilidad) {
            cartaDiv.appendChild(badgeHabilidad);
        }
        const badgeAfiliacion = window.crearBadgeAfiliacionCarta ? window.crearBadgeAfiliacionCarta(carta) : null;
        if (badgeAfiliacion) {
            cartaDiv.appendChild(badgeAfiliacion);
        }
        cartaDiv.appendChild(crearBarraSaludElementoTrade(carta));
        cartaDiv.appendChild(detallesDiv);
        cartaDiv.appendChild(estrellasDiv);

        wrap.appendChild(cartaDiv);
        return wrap;
    }

    let filtrosInventarioTradeEnlazados = false;

    function marcarTabVistaInventarioTrade() {
        const vista = filtrosInventarioTrade.vista;
        document.getElementById('trade-tab-duplicados')?.classList.toggle('active', vista === 'duplicados');
        document.getElementById('trade-tab-otras')?.classList.toggle('active', vista === 'otras');
    }

    function actualizarSelectAfiliacionesTrade(cartas) {
        const select = document.getElementById('trade-filtro-afiliacion');
        if (!select) {
            return;
        }
        const actual = filtrosInventarioTrade.afiliacion;
        const afiliaciones = obtenerAfiliacionesUnicasInventario(cartas);
        select.innerHTML = '<option value="todas">Todas las afiliaciones</option>';
        afiliaciones.forEach((nombre) => {
            const opt = document.createElement('option');
            opt.value = nombre;
            opt.textContent = nombre;
            select.appendChild(opt);
        });
        const sigueValida = actual === 'todas' || afiliaciones.some(
            (a) => a.localeCompare(actual, undefined, { sensitivity: 'base' }) === 0
        );
        select.value = sigueValida ? actual : 'todas';
        if (!sigueValida) {
            filtrosInventarioTrade.afiliacion = 'todas';
        }
    }

    function htmlFiltrosInventarioTrade() {
        return `
            <div class="trade-inventario-filtros" id="trade-inventario-filtros">
                <div class="faccion-tabs trade-inventario-tabs" role="tablist" aria-label="Vista inventario">
                    <button type="button" id="trade-tab-duplicados" class="btn faccion-tab active" data-vista="duplicados">Duplicadas</button>
                    <button type="button" id="trade-tab-otras" class="btn faccion-tab" data-vista="otras">Otras cartas</button>
                </div>
                <input type="search" id="trade-filtro-nombre" class="form-control form-control-sm trade-filtro-nombre" placeholder="Buscar por nombre…" autocomplete="off">
                <div class="trade-inventario-filtros-fila">
                    <select id="trade-filtro-faccion" class="form-control form-control-sm trade-filtro-select" aria-label="Filtrar por facción">
                        <option value="todas">Todas las facciones</option>
                        <option value="H">Héroes</option>
                        <option value="V">Villanos</option>
                    </select>
                    <select id="trade-filtro-afiliacion" class="form-control form-control-sm trade-filtro-select" aria-label="Filtrar por afiliación">
                        <option value="todas">Todas las afiliaciones</option>
                    </select>
                </div>
                <p id="trade-inventario-contador" class="trade-inventario-contador"></p>
            </div>
        `;
    }

    function asegurarFiltrosInventarioTradeEnModal() {
        const panel = document.querySelector('.trade-panel-inventario');
        const grid = document.getElementById('trade-inventario-grid');
        if (!panel || !grid) {
            return;
        }
        const titulo = panel.querySelector('.trade-panel-titulo');
        if (titulo) {
            titulo.textContent = 'Tu inventario';
        }
        if (!document.getElementById('trade-inventario-filtros')) {
            const contenedor = document.createElement('div');
            contenedor.innerHTML = htmlFiltrosInventarioTrade();
            const filtros = contenedor.firstElementChild;
            if (filtros) {
                panel.insertBefore(filtros, grid);
            }
        }
        const inputNombre = document.getElementById('trade-filtro-nombre');
        if (inputNombre) {
            inputNombre.value = filtrosInventarioTrade.nombre;
        }
        const selectFaccion = document.getElementById('trade-filtro-faccion');
        if (selectFaccion) {
            selectFaccion.value = filtrosInventarioTrade.faccion;
        }
        marcarTabVistaInventarioTrade();
    }

    function enlazarEventosFiltrosInventarioTrade() {
        if (filtrosInventarioTradeEnlazados) {
            return;
        }
        const filtros = document.getElementById('trade-inventario-filtros');
        if (!filtros) {
            return;
        }
        filtrosInventarioTradeEnlazados = true;

        filtros.querySelector('#trade-tab-duplicados')?.addEventListener('click', () => {
            filtrosInventarioTrade.vista = 'duplicados';
            marcarTabVistaInventarioTrade();
            renderizarInventarioTrade();
        });
        filtros.querySelector('#trade-tab-otras')?.addEventListener('click', () => {
            filtrosInventarioTrade.vista = 'otras';
            marcarTabVistaInventarioTrade();
            renderizarInventarioTrade();
        });
        filtros.querySelector('#trade-filtro-nombre')?.addEventListener('input', (ev) => {
            filtrosInventarioTrade.nombre = String(ev.target?.value || '');
            renderizarInventarioTrade();
        });
        filtros.querySelector('#trade-filtro-faccion')?.addEventListener('change', (ev) => {
            filtrosInventarioTrade.faccion = String(ev.target?.value || 'todas');
            renderizarInventarioTrade();
        });
        filtros.querySelector('#trade-filtro-afiliacion')?.addEventListener('change', (ev) => {
            filtrosInventarioTrade.afiliacion = String(ev.target?.value || 'todas');
            renderizarInventarioTrade();
        });
    }

    function asegurarModalesTrade() {
        if (document.getElementById('modal-trade-solicitud')) {
            asegurarFiltrosInventarioTradeEnModal();
            enlazarEventosFiltrosInventarioTrade();
            return;
        }

        const solicitud = document.createElement('div');
        solicitud.id = 'modal-trade-solicitud';
        solicitud.className = 'overlay trade-overlay';
        solicitud.style.display = 'none';
        solicitud.innerHTML = `
            <div class="modal-invitacion trade-modal-solicitud">
                <h4 class="trade-modal-titulo">Solicitud de intercambio</h4>
                <p id="trade-solicitud-mensaje" class="trade-modal-mensaje"></p>
                <div class="trade-modal-acciones">
                    <button type="button" id="btn-trade-solicitud-aceptar" class="btn btn-aceptar">Aceptar</button>
                    <button type="button" id="btn-trade-solicitud-cancelar" class="btn btn-cancelar">Cancelar</button>
                </div>
            </div>
        `;
        document.body.appendChild(solicitud);

        const intercambio = document.createElement('div');
        intercambio.id = 'modal-trade-intercambio';
        intercambio.className = 'overlay trade-overlay';
        intercambio.style.display = 'none';
        intercambio.innerHTML = `
            <div class="trade-modal-intercambio">
                <div class="trade-modal-intercambio-header">
                    <h4>Intercambio</h4>
                    <button type="button" id="btn-trade-cerrar" class="btn btn-secondary btn-sm">Cerrar</button>
                </div>
                <div class="trade-intercambio-layout">
                    <div class="trade-panel trade-panel-inventario">
                        <h5 class="trade-panel-titulo">Tu inventario</h5>
                        <div class="trade-inventario-filtros" id="trade-inventario-filtros">
                            <div class="faccion-tabs trade-inventario-tabs" role="tablist" aria-label="Vista inventario">
                                <button type="button" id="trade-tab-duplicados" class="btn faccion-tab active" data-vista="duplicados">Duplicadas</button>
                                <button type="button" id="trade-tab-otras" class="btn faccion-tab" data-vista="otras">Otras cartas</button>
                            </div>
                            <input type="search" id="trade-filtro-nombre" class="form-control form-control-sm trade-filtro-nombre" placeholder="Buscar por nombre…" autocomplete="off">
                            <div class="trade-inventario-filtros-fila">
                                <select id="trade-filtro-faccion" class="form-control form-control-sm trade-filtro-select" aria-label="Filtrar por facción">
                                    <option value="todas">Todas las facciones</option>
                                    <option value="H">Héroes</option>
                                    <option value="V">Villanos</option>
                                </select>
                                <select id="trade-filtro-afiliacion" class="form-control form-control-sm trade-filtro-select" aria-label="Filtrar por afiliación">
                                    <option value="todas">Todas las afiliaciones</option>
                                </select>
                            </div>
                            <p id="trade-inventario-contador" class="trade-inventario-contador"></p>
                        </div>
                        <div id="trade-inventario-grid" class="trade-cartas-grid"></div>
                    </div>
                    <div class="trade-panel trade-panel-ofertas">
                        <div id="trade-oferta-yo-wrap" class="trade-oferta-bloque">
                            <h5 id="trade-oferta-yo-titulo" class="trade-panel-titulo">Tus cartas</h5>
                            <div id="trade-oferta-yo-grid" class="trade-cartas-grid trade-oferta-grid"></div>
                            <button type="button" id="btn-trade-aceptar-yo" class="btn btn-primary trade-btn-aceptar">Aceptar intercambio</button>
                        </div>
                        <div id="trade-oferta-companero-wrap" class="trade-oferta-bloque">
                            <h5 id="trade-oferta-companero-titulo" class="trade-panel-titulo">Cartas del compañero</h5>
                            <div id="trade-oferta-companero-grid" class="trade-cartas-grid trade-oferta-grid"></div>
                            <div id="trade-companero-estado" class="trade-companero-estado"></div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(intercambio);

        document.getElementById('btn-trade-solicitud-aceptar')?.addEventListener('click', () => {
            emitir('respuestaSolicitud', { aceptada: true });
            cerrarModalSolicitudEntrante();
        });
        document.getElementById('btn-trade-solicitud-cancelar')?.addEventListener('click', () => {
            emitir('respuestaSolicitud', { aceptada: false });
            cerrarModalSolicitudEntrante();
        });
        document.getElementById('btn-trade-cerrar')?.addEventListener('click', () => {
            emitir('cancelar', {});
            cerrarModalIntercambio();
        });
        document.getElementById('btn-trade-aceptar-yo')?.addEventListener('click', onToggleAceptarYo);
        asegurarFiltrosInventarioTradeEnModal();
        enlazarEventosFiltrosInventarioTrade();
    }

    function cerrarModalSolicitudEntrante() {
        const modal = document.getElementById('modal-trade-solicitud');
        if (modal) {
            modal.style.display = 'none';
        }
        modalSolicitudEntrante = null;
    }

    function cerrarModalIntercambio() {
        const modal = document.getElementById('modal-trade-intercambio');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    function mostrarToastGrupo(mensaje, tipo) {
        const texto = String(mensaje || '').trim();
        if (!texto) {
            return;
        }
        window.dispatchEvent(new CustomEvent('dc:grupo-notificacion', {
            detail: { mensaje: texto, tipo: tipo || 'info' }
        }));
        let el = document.getElementById('dc-toast-grupo');
        if (!el) {
            el = document.createElement('div');
            el.id = 'dc-toast-grupo';
            el.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;max-width:340px;padding:10px 14px;border-radius:8px;font-size:0.85rem;color:#fff;display:none;pointer-events:none;';
            document.body.appendChild(el);
        }
        const t = tipo || 'info';
        el.style.background = t === 'error'
            ? 'rgba(160, 40, 40, 0.95)'
            : t === 'success'
                ? 'rgba(40, 130, 70, 0.95)'
                : t === 'warning'
                    ? 'rgba(150, 110, 20, 0.95)'
                    : 'rgba(25, 55, 110, 0.95)';
        el.textContent = texto;
        el.style.display = 'block';
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(() => {
            el.style.display = 'none';
        }, 3500);
    }

    function abrirModalSolicitudEntrante(payload) {
        asegurarModalesTrade();
        const modal = document.getElementById('modal-trade-solicitud');
        const msg = document.getElementById('trade-solicitud-mensaje');
        if (!modal || !msg) {
            return;
        }
        const nombre = String(payload?.fromNombre || payload?.fromEmail || 'Un jugador');
        msg.textContent = `${nombre} quiere realizar un intercambio`;
        modalSolicitudEntrante = payload;
        modal.style.display = 'flex';
    }

    function obtenerMiOfertaRemota() {
        if (!estadoRemoto?.activo || !estadoRemoto?.jugadores) {
            return { indices: [], aceptado: false };
        }
        const yo = estadoRemoto.jugadores[miEmail] || { indices: [], aceptado: false };
        return {
            indices: [...(yo.indices || [])],
            aceptado: Boolean(yo.aceptado)
        };
    }

    function obtenerOfertaCompanero() {
        if (!estadoRemoto?.jugadores) {
            return { indices: [], aceptado: false, nombre: 'Compañero' };
        }
        const entry = Object.entries(estadoRemoto.jugadores).find(([email]) => email !== miEmail);
        if (!entry) {
            return { indices: [], aceptado: false, nombre: 'Compañero' };
        }
        const [, data] = entry;
        return {
            indices: [...(data.indices || [])],
            cartas: Array.isArray(data.cartas) ? data.cartas : [],
            aceptado: Boolean(data.aceptado),
            nombre: data.nombre || data.email || 'Compañero'
        };
    }

    function renderizarInventarioTrade() {
        const grid = document.getElementById('trade-inventario-grid');
        if (!grid) {
            return;
        }
        asegurarFiltrosInventarioTradeEnModal();
        enlazarEventosFiltrosInventarioTrade();

        const usuario = obtenerUsuarioLocal();
        const cartas = usuario?.cartas || [];
        const miOferta = obtenerMiOfertaRemota();
        const enOferta = new Set(miOferta.indices);

        actualizarSelectAfiliacionesTrade(cartas);

        const itemsBase = construirItemsInventarioTrade(cartas).filter((item) => !enOferta.has(item.index));
        const itemsFiltrados = filtrarItemsInventarioTrade(itemsBase);

        const contador = document.getElementById('trade-inventario-contador');
        if (contador) {
            const vista = filtrosInventarioTrade.vista;
            const etiquetaVista = vista === 'duplicados' ? 'duplicadas intercambiables' : 'otras cartas';
            contador.textContent = itemsFiltrados.length
                ? `${itemsFiltrados.length} ${itemsFiltrados.length === 1 ? 'carta' : 'cartas'} (${etiquetaVista})`
                : `0 cartas (${etiquetaVista})`;
        }

        grid.innerHTML = '';
        if (!itemsFiltrados.length) {
            const vacio = document.createElement('p');
            vacio.className = 'trade-vacio';
            if (filtrosInventarioTrade.vista === 'duplicados') {
                vacio.textContent = itemsBase.some((i) => i.esDuplicadoIntercambiable)
                    ? 'Ningún duplicado coincide con los filtros.'
                    : 'No tienes duplicados disponibles para ofrecer.';
            } else {
                vacio.textContent = itemsBase.length
                    ? 'Ninguna carta coincide con los filtros.'
                    : 'No tienes más cartas en esta vista.';
            }
            grid.appendChild(vacio);
            return;
        }

        itemsFiltrados.forEach((item) => {
            const puedeOfrecer = item.esDuplicadoIntercambiable;
            grid.appendChild(crearMiniCarta(item.carta, puedeOfrecer
                ? {
                    onClick: () => {
                        const nueva = [...miOferta.indices, item.index];
                        emitir('actualizarOferta', { indices: nueva });
                    }
                }
                : {
                    soloVista: true,
                    titleSoloVista: 'Solo las copias duplicadas sobrantes se pueden intercambiar.'
                }));
        });
    }

    function renderizarOfertaPropia() {
        const grid = document.getElementById('trade-oferta-yo-grid');
        const wrap = document.getElementById('trade-oferta-yo-wrap');
        const btn = document.getElementById('btn-trade-aceptar-yo');
        const titulo = document.getElementById('trade-oferta-yo-titulo');
        if (!grid || !wrap) {
            return;
        }
        const usuario = obtenerUsuarioLocal();
        const cartas = usuario?.cartas || [];
        const miOferta = obtenerMiOfertaRemota();
        const grupo = obtenerEstadoGrupo();
        const miNombre = grupo?.lider?.email === miEmail
            ? (grupo.lider?.nombre || 'Tú')
            : (grupo.miembro?.email === miEmail ? grupo.miembro?.nombre : 'Tú');
        if (titulo) {
            titulo.textContent = `Cartas de ${miNombre || 'ti'}`;
        }
        grid.innerHTML = '';
        miOferta.indices.forEach((idx) => {
            const carta = cartas[idx];
            if (!carta) {
                return;
            }
            grid.appendChild(crearMiniCarta(carta, {
                seleccionada: true,
                enOferta: true,
                onClick: () => {
                    const nueva = miOferta.indices.filter((i) => i !== idx);
                    emitir('actualizarOferta', { indices: nueva });
                }
            }));
        });
        wrap.classList.toggle('trade-oferta-bloque--aceptado', miOferta.aceptado);
        if (btn) {
            btn.textContent = miOferta.aceptado ? 'Cancelar aceptación' : 'Aceptar intercambio';
            btn.classList.toggle('btn-success', miOferta.aceptado);
            btn.classList.toggle('btn-primary', !miOferta.aceptado);
        }
    }

    function renderizarOfertaCompanero() {
        const grid = document.getElementById('trade-oferta-companero-grid');
        const wrap = document.getElementById('trade-oferta-companero-wrap');
        const titulo = document.getElementById('trade-oferta-companero-titulo');
        const estadoEl = document.getElementById('trade-companero-estado');
        if (!grid || !wrap) {
            return;
        }
        const oferta = obtenerOfertaCompanero();
        if (titulo) {
            titulo.textContent = `Cartas de ${oferta.nombre}`;
        }
        grid.innerHTML = '';
        const cartasMostrar = oferta.cartas || [];
        if (!cartasMostrar.length) {
            const vacio = document.createElement('p');
            vacio.className = 'trade-vacio';
            vacio.textContent = 'Sin cartas en la oferta.';
            grid.appendChild(vacio);
        } else {
            cartasMostrar.forEach((carta) => {
                grid.appendChild(crearMiniCarta(carta, { enOferta: true }));
            });
        }
        wrap.classList.toggle('trade-oferta-bloque--aceptado', oferta.aceptado);
        if (estadoEl) {
            estadoEl.textContent = oferta.aceptado
                ? `${oferta.nombre} ha aceptado el intercambio.`
                : `Esperando confirmación de ${oferta.nombre}…`;
        }
    }

    function abrirModalIntercambio() {
        asegurarModalesTrade();
        const modal = document.getElementById('modal-trade-intercambio');
        if (!modal) {
            return;
        }
        renderizarInventarioTrade();
        renderizarOfertaPropia();
        renderizarOfertaCompanero();
        modal.style.display = 'flex';
    }

    function onToggleAceptarYo() {
        const miOferta = obtenerMiOfertaRemota();
        emitir('toggleAceptar', { aceptado: !miOferta.aceptado });
    }

    function aplicarEstadoRemoto(payload) {
        estadoRemoto = payload && typeof payload === 'object' ? payload : { activo: false };
        if (!estadoRemoto.activo) {
            cerrarModalIntercambio();
            return;
        }
        if (estadoRemoto.fase === 'activo') {
            abrirModalIntercambio();
        }
    }

    function aplicarUsuarioTrasTrade(usuario) {
        if (!usuario || typeof usuario !== 'object') {
            return;
        }
        localStorage.setItem('usuario', JSON.stringify(usuario));
        if (typeof window.actualizarPanelPerfilTiempoReal === 'function') {
            window.actualizarPanelPerfilTiempoReal();
        }
        window.dispatchEvent(new Event('dc:usuario-actualizado'));
    }

    function solicitarIntercambio() {
        const grupo = obtenerEstadoGrupo();
        if (!grupo?.enGrupo || !grupo?.companero?.email) {
            mostrarToastGrupo('Debes estar en un grupo con un compañero conectado.', 'error');
            return;
        }
        if (typeof window.emitTradeGrupo !== 'function') {
            mostrarToastGrupo('Conexión multijugador no disponible en esta página.', 'warning');
            return;
        }
        emitir('solicitar', {});
    }

    function initTradeGrupo() {
        asegurarModalesTrade();
        miEmail = obtenerEmailSesion();

        window.addEventListener('dc:trade-estado', (ev) => {
            aplicarEstadoRemoto(ev.detail?.estado);
            if (estadoRemoto.activo && estadoRemoto.fase === 'activo') {
                renderizarInventarioTrade();
                renderizarOfertaPropia();
                renderizarOfertaCompanero();
            }
        });
        window.addEventListener('dc:trade-solicitud', (ev) => {
            abrirModalSolicitudEntrante(ev.detail || {});
        });
        window.addEventListener('dc:trade-solicitud-enviada', () => {
            mostrarToastGrupo('Solicitud de intercambio enviada.', 'info');
        });
        window.addEventListener('dc:trade-rechazado', (ev) => {
            const nombre = ev.detail?.porNombre || 'Tu compañero';
            mostrarToastGrupo(`${nombre} rechazó el intercambio.`, 'warning');
        });
        window.addEventListener('dc:trade-cancelado', (ev) => {
            cerrarModalIntercambio();
            cerrarModalSolicitudEntrante();
            const motivo = ev.detail?.motivo || 'Intercambio cancelado.';
            mostrarToastGrupo(motivo, 'info');
        });
        window.addEventListener('dc:trade-completado', (ev) => {
            cerrarModalIntercambio();
            const usuarios = ev.detail?.usuarios || {};
            if (usuarios[miEmail]) {
                aplicarUsuarioTrasTrade(usuarios[miEmail]);
            }
            mostrarToastGrupo('Intercambio completado correctamente.', 'success');
        });
    }

    window.DCTradeGrupo = {
        solicitarIntercambio,
        init: initTradeGrupo
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTradeGrupo);
    } else {
        initTradeGrupo();
    }
})();
