/**
 * Vista Asaltos: carrusel 3D + datos desde asaltos.xlsx con rotación semanal (6 asaltos por ventana).
 */
(function () {
    const MS_SEMANA = 7 * 24 * 60 * 60 * 1000;
    /** v2: ventana semanal de lunes 00:00 a domingo 23:59:59 (hora local del dispositivo). */
    const VERSION_ROTACION_ASALTOS = 'asaltos-rotation-v2-monday';
    const PLACEHOLDER_IMG = 'resources/hud/universo.png';

    const escena = document.getElementById('asaltos-carrusel-escena');
    const btnIzq = document.getElementById('asaltos-flecha-izq');
    const btnDer = document.getElementById('asaltos-flecha-der');
    const elNombreFrente = document.getElementById('asaltos-nombre-frente');
    const btnTogglePanel = document.getElementById('asaltos-btn-toggle-panel');
    const panelDetalle = document.getElementById('asaltos-panel-detalle');
    const panelNombre = document.getElementById('asaltos-panel-nombre');
    const panelImagen = document.getElementById('asaltos-panel-imagen');
    const panelDesc = document.getElementById('asaltos-panel-descripcion');
    const panelRecompRoot = document.getElementById('asaltos-panel-recompensas-root');
    const btnComenzar = document.getElementById('asaltos-panel-comenzar');
    const rotTimerVal = document.getElementById('asaltos-rotacion-timer-valor');
    const rotBar = document.getElementById('asaltos-rotacion-barra-progreso');
    const rotBarWrap = document.getElementById('asaltos-rotacion-barra-wrap');
    const escenaDif = document.getElementById('asaltos-panel-dif-escena');
    const btnDifIzq = document.getElementById('asaltos-panel-dif-izq');
    const btnDifDer = document.getElementById('asaltos-panel-dif-der');
    const selectMazoPanel = document.getElementById('asaltos-panel-select-mazo');
    const poderMazoPanelEl = document.getElementById('asaltos-panel-poder-total-mazo');
    const modalPoderAsalto = document.getElementById('asaltos-modal-poder-asalto');
    const modalPoderMensaje = document.getElementById('asaltos-modal-poder-mensaje');
    const modalPoderEntendido = document.getElementById('asaltos-modal-poder-entendido');

    if (!escena || !btnIzq || !btnDer) {
        return;
    }

    const carasDif = escenaDif ? escenaDif.querySelectorAll('.asaltos-panel-dif-cara') : [];

    const caras = escena.querySelectorAll('.asaltos-carrusel-cara');
    let spin = 0;
    /** Índice de modo en carrusel del panel: 0 normal (6★), 1 élite (7★), 2 legendario (8★). */
    let spinDif = 0;
    const DIF_MODO_RIVAL_ESTRELLAS = [6, 7, 8];
    let asaltosListaCompleta = [];
    let asaltosSemana = [];
    let panelAbierto = false;
    let rotacionTimerId = null;
    /** Índice del mazo elegido en el panel (persiste al cerrar el panel). */
    let indiceMazoPanelSeleccionado = 0;

    const PODER_MINIMO_ASALTO = 60000;

    function sincronizarAccesibilidadPanel(abierto) {
        if (!panelDetalle) return;
        panelDetalle.setAttribute('aria-hidden', abierto ? 'false' : 'true');
        if ('inert' in panelDetalle) {
            panelDetalle.inert = !abierto;
        }
    }

    async function sincronizarUsuarioParaAsaltos() {
        const email = localStorage.getItem('email');
        if (!email) return;
        try {
            const response = await fetch('/get-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            if (response.ok) {
                const data = await response.json();
                if (data?.usuario) {
                    localStorage.setItem('usuario', JSON.stringify(data.usuario));
                }
            }
        } catch (_e) {
            /* No bloquear la vista si el servidor no responde. */
        }
    }

    function calcularPoderMazoCartas(cartas) {
        return (cartas || []).reduce((acc, carta) => acc + Number(carta?.Poder || 0), 0);
    }

    /** Umbrales alineados con mazos.js → renderizarPoderTotal. */
    function aplicarClasesPoderTotalMazo(elemento, poderTotal) {
        if (!elemento) return;
        elemento.textContent = String(poderTotal);
        elemento.classList.remove('poder-bajo', 'poder-medio', 'poder-alto', 'poder-legendario');
        if (poderTotal < 25000) {
            elemento.classList.add('poder-bajo');
        } else if (poderTotal < 45000) {
            elemento.classList.add('poder-medio');
        } else if (poderTotal < 70000) {
            elemento.classList.add('poder-alto');
        } else {
            elemento.classList.add('poder-legendario');
        }
    }

    function actualizarPoderMazoPanelDesdeSelect() {
        if (!selectMazoPanel || !poderMazoPanelEl) return;
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        const mazos = Array.isArray(usuario?.mazos) ? usuario.mazos : [];
        if (!mazos.length || selectMazoPanel.disabled) {
            aplicarClasesPoderTotalMazo(poderMazoPanelEl, 0);
            return;
        }
        const idx = Number(selectMazoPanel.value);
        const cartas = mazos[idx]?.Cartas || [];
        aplicarClasesPoderTotalMazo(poderMazoPanelEl, calcularPoderMazoCartas(cartas));
    }

    function refrescarSelectorMazosPanel() {
        if (!selectMazoPanel) return;
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        const mazos = Array.isArray(usuario?.mazos) ? usuario.mazos : [];
        selectMazoPanel.innerHTML = '';
        if (!mazos.length) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = 'Sin mazos guardados';
            selectMazoPanel.appendChild(opt);
            selectMazoPanel.disabled = true;
            indiceMazoPanelSeleccionado = 0;
            actualizarPoderMazoPanelDesdeSelect();
            return;
        }
        selectMazoPanel.disabled = false;
        mazos.forEach((mazo, index) => {
            const opt = document.createElement('option');
            opt.value = String(index);
            opt.textContent = String(mazo?.Nombre || '').trim() || `Mazo ${index + 1}`;
            selectMazoPanel.appendChild(opt);
        });
        if (indiceMazoPanelSeleccionado >= mazos.length) {
            indiceMazoPanelSeleccionado = 0;
        }
        if (indiceMazoPanelSeleccionado < 0) {
            indiceMazoPanelSeleccionado = 0;
        }
        selectMazoPanel.value = String(indiceMazoPanelSeleccionado);
        actualizarPoderMazoPanelDesdeSelect();
    }

    function ocultarModalPoderAsalto() {
        if (!modalPoderAsalto) return;
        modalPoderAsalto.hidden = true;
        modalPoderAsalto.setAttribute('aria-hidden', 'true');
    }

    /**
     * @param {string} mensaje
     * @param {{ poderRequerido?: number }} [opciones] Si incluye `poderRequerido`, se añade la línea
     *   "Poder requerido: …" con el número en el color de acento del usuario (`--dc-accent-user`).
     */
    function mostrarModalPoderAsalto(mensaje, opciones) {
        if (!modalPoderMensaje || !modalPoderAsalto) return;
        if (typeof window.aplicarColorPrincipalDesdeSesion === 'function') {
            window.aplicarColorPrincipalDesdeSesion();
        }
        const pr = opciones?.poderRequerido;
        const prNum = pr != null ? Number(pr) : NaN;
        if (Number.isFinite(prNum)) {
            modalPoderMensaje.replaceChildren();
            const p1 = document.createElement('p');
            p1.className = 'asaltos-modal-poder-linea';
            p1.textContent = mensaje;
            const p2 = document.createElement('p');
            p2.className = 'asaltos-modal-poder-linea asaltos-modal-poder-linea-req';
            p2.appendChild(document.createTextNode('Poder requerido: '));
            const spanNum = document.createElement('span');
            spanNum.className = 'asaltos-modal-poder-requerido-num';
            spanNum.textContent = String(Math.round(prNum));
            p2.appendChild(spanNum);
            modalPoderMensaje.append(p1, p2);
        } else {
            modalPoderMensaje.textContent = mensaje;
        }
        modalPoderAsalto.hidden = false;
        modalPoderAsalto.setAttribute('aria-hidden', 'false');
    }

    /** Inicio de la semana de asaltos: lunes 00:00:00.000 en hora local. */
    function obtenerInicioSemanaLunesLocalMs(ahora = Date.now()) {
        const t = new Date(ahora);
        const d = new Date(t.getFullYear(), t.getMonth(), t.getDate());
        const dow = d.getDay();
        d.setDate(d.getDate() - ((dow + 6) % 7));
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }

    function obtenerVentanaRotacionAsaltos(ahora = Date.now()) {
        const ahoraTs = ahora;
        const inicio = obtenerInicioSemanaLunesLocalMs(ahoraTs);
        const fin = inicio + MS_SEMANA;
        const idVentana = Math.floor(inicio / MS_SEMANA);
        return { ahora: ahoraTs, idVentana, inicio, fin };
    }

    function obtenerClaveRotacionAsaltos(ahora = Date.now()) {
        const inicio = obtenerInicioSemanaLunesLocalMs(ahora);
        return `${VERSION_ROTACION_ASALTOS}-${inicio}`;
    }

    function leerMapaAsaltosCompletados() {
        try {
            const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
            const raw = usuario?.asaltosCompletadosPorRotacion;
            return (raw && typeof raw === 'object') ? raw : {};
        } catch (_e) {
            return {};
        }
    }

    /**
     * Valor guardado por clave de rotación: objeto `{ [asaltoId]: [6,7,8] }` (estrellas del rival).
     * Formato legado: array de ids → se interpreta como las 3 dificultades ya completadas.
     */
    function normalizarValorProgresoRotacion(val) {
        const porAsalto = {};
        if (Array.isArray(val)) {
            val.forEach((idRaw) => {
                const idNum = Number(idRaw);
                if (Number.isFinite(idNum)) {
                    porAsalto[String(idNum)] = [6, 7, 8];
                }
            });
            return porAsalto;
        }
        if (val && typeof val === 'object') {
            Object.keys(val).forEach((k) => {
                const v = val[k];
                if (!Array.isArray(v)) return;
                const ok = v.map((x) => Number(x)).filter((n) => n === 6 || n === 7 || n === 8);
                if (ok.length) {
                    porAsalto[String(k)] = [...new Set(ok)].sort((a, b) => a - b);
                }
            });
            return porAsalto;
        }
        return porAsalto;
    }

    function obtenerProgresoPorAsaltoRotacionActual() {
        const clave = obtenerClaveRotacionAsaltos();
        const map = leerMapaAsaltosCompletados();
        return normalizarValorProgresoRotacion(map[clave]);
    }

    function dificultadRivalCompletadaParaAsalto(asalto, estrellasRival) {
        if (!asalto) return false;
        const id = Number(asalto.asalto_ID);
        if (!Number.isFinite(id)) return false;
        const s = Math.min(8, Math.max(6, Number(estrellasRival)));
        const prog = obtenerProgresoPorAsaltoRotacionActual();
        const arr = prog[String(id)] || [];
        return arr.includes(s);
    }

    /** Tierra + nombre “Completado”: solo si están hechas Normal, Élite y Legendario en esta rotación. */
    function asaltoTotalmenteCompletadoEnRotacion(asalto) {
        if (!asalto) return false;
        return DIF_MODO_RIVAL_ESTRELLAS.every((stars) => dificultadRivalCompletadaParaAsalto(asalto, stars));
    }

    function actualizarBadgesCarruselEarth() {
        if (!caras || !caras.length) return;
        caras.forEach((caraEl, j) => {
            const badge = caraEl.querySelector('.asaltos-earth-completado-badge');
            const as = asaltosSemana[j];
            const comp = Boolean(as && asaltoTotalmenteCompletadoEnRotacion(as));
            caraEl.classList.toggle('asaltos-carrusel-cara--completada', comp);
            if (badge) {
                badge.hidden = !comp;
            }
        });
    }

    function actualizarBadgesDificultadPanel(asalto) {
        if (!carasDif || !carasDif.length) return;
        carasDif.forEach((caraEl, j) => {
            const est = DIF_MODO_RIVAL_ESTRELLAS[j];
            const badge = caraEl.querySelector('.asaltos-dif-completado-badge');
            const comp = Boolean(asalto && dificultadRivalCompletadaParaAsalto(asalto, est));
            caraEl.classList.toggle('asaltos-panel-dif-cara--completada', comp);
            if (badge) {
                badge.hidden = !comp;
            }
        });
    }

    function aplicarEstadoBotonComenzar(asalto) {
        if (!btnComenzar) return;
        const comp = Boolean(asalto && dificultadRivalCompletadaParaAsalto(asalto, rivalEstrellasModoSeleccionado()));
        if (comp) {
            btnComenzar.textContent = 'Completado';
            btnComenzar.disabled = true;
            btnComenzar.classList.add('asaltos-panel-btn-comenzar--completado');
            btnComenzar.setAttribute('aria-disabled', 'true');
        } else {
            btnComenzar.textContent = 'Comenzar';
            btnComenzar.disabled = false;
            btnComenzar.classList.remove('asaltos-panel-btn-comenzar--completado');
            btnComenzar.setAttribute('aria-disabled', 'false');
        }
    }

    /**
     * 6 asaltos consecutivos del catálogo (circular), avanzando de 6 en 6 cada ventana semanal.
     */
    function obtenerAsaltosSemanaActual(lista) {
        const L = Array.isArray(lista) ? lista : [];
        const N = L.length;
        if (N === 0) {
            return [];
        }
        const { inicio } = obtenerVentanaRotacionAsaltos();
        const weekIndex = Math.floor(inicio / MS_SEMANA);
        const start = ((weekIndex * 6) % N + N) % N;
        const clave = obtenerClaveRotacionAsaltos();
        const salida = [];
        for (let i = 0; i < 6; i += 1) {
            const base = L[(start + i) % N];
            salida.push({ ...base, rotacionClave: clave });
        }
        return salida;
    }

    function parseNumFlexible(val) {
        let s = String(val ?? '').trim().replace(/\s+/g, '').replace(',', '.');
        if (s.endsWith('%')) {
            s = s.slice(0, -1);
        }
        const n = Number(s);
        return Number.isFinite(n) ? n : 0;
    }

    function mapearAsaltoDesdeFila(fila, index = 0) {
        const rawId = Number(fila.asalto_ID ?? fila.id);
        const cartas = [];
        for (let i = 1; i <= 12; i += 1) {
            const n = String(fila[`carta${i}`] || '').trim();
            if (n) cartas.push(n);
        }
        const difRaw = Number(fila.dificultad ?? fila.Dificultad ?? 1);
        return {
            asalto_ID: Number.isFinite(rawId) ? rawId : index,
            nombre: String(fila.nombre || '').trim() || 'Asalto',
            imagen: String(fila.imagen || '').trim(),
            descripcion: String(fila.descripcion || fila.Descripción || '').trim(),
            dificultad: Math.min(6, Math.max(1, Math.round(Number.isFinite(difRaw) ? difRaw : 1))),
            dificultadRaw: Number.isFinite(difRaw) ? difRaw : 1,
            tablero: String(fila.tablero ?? fila.Tablero ?? '').trim(),
            puntos: Number(fila.puntos || 0),
            /** Porcentajes de drop (victoria) para el pool aleatorio; ver panel en la vista Asaltos. */
            mejora: parseNumFlexible(fila.mejora),
            mejora_especial: parseNumFlexible(fila.mejora_especial),
            mejora_suprema: parseNumFlexible(fila.mejora_suprema),
            mejora_definitiva: parseNumFlexible(fila.mejora_definitiva),
            fragmentos: Number(fila.fragmentos || 0),
            cartas,
            rotacionClave: obtenerClaveRotacionAsaltos()
        };
    }

    function urlImagenAsalto(asalto) {
        const raw = String(asalto?.imagen || '').trim();
        if (!raw) {
            return PLACEHOLDER_IMG;
        }
        if (/^https?:\/\//i.test(raw)) {
            return raw;
        }
        const rel = raw.replace(/^\//, '');
        return rel.startsWith('resources/') ? rel : `resources/${rel}`;
    }

    function asaltoEnFrente() {
        const frente = ((spin % 6) + 6) % 6;
        return { frente, asalto: asaltosSemana[frente] || null };
    }

    function indiceModoDificultadActual() {
        return ((spinDif % 3) + 3) % 3;
    }

    function rivalEstrellasModoSeleccionado() {
        return DIF_MODO_RIVAL_ESTRELLAS[indiceModoDificultadActual()];
    }

    function aplicarSpinDif() {
        if (!escenaDif || !carasDif.length) return;
        escenaDif.style.setProperty('--asaltos-dif-spin', String(spinDif));
        const frente = indiceModoDificultadActual();
        carasDif.forEach((el, j) => {
            el.classList.toggle('asaltos-panel-dif-cara--frente', j === frente);
        });
        if (panelAbierto) {
            const { asalto } = asaltoEnFrente();
            if (asalto) {
                pintarPanelRecompensasAsalto(asalto);
                aplicarEstadoBotonComenzar(asalto);
            }
        }
    }

    function actualizarUiFrente() {
        actualizarBadgesCarruselEarth();
        const { asalto } = asaltoEnFrente();
        if (elNombreFrente) {
            if (!asalto) {
                elNombreFrente.textContent = '—';
                elNombreFrente.classList.remove('asaltos-nombre-frente--completado');
            } else {
                const base = String(asalto.nombre || '').trim() || 'Asalto';
                const comp = asaltoTotalmenteCompletadoEnRotacion(asalto);
                elNombreFrente.textContent = comp ? `${base} (Completado)` : base;
                elNombreFrente.classList.toggle('asaltos-nombre-frente--completado', comp);
            }
        }
        if (panelAbierto && asalto) {
            rellenarPanel(asalto);
        }
    }

    function etiquetaPctDrop(val) {
        const n = parseNumFlexible(val);
        if (!(n > 0)) return '0%';
        if (n < 1) return `${Math.round(n * 1000) / 10}%`;
        return `${Math.round(n * 10) / 10}%`;
    }

    /** Puntos base del Excel × bono por dificultad de rival (6→×1, 7→×1,25, 8→×1,5). */
    function puntosGarantizadosAsalto(puntosBase, estrellasRival) {
        const b = Math.max(0, Number(puntosBase || 0));
        const s = Math.min(8, Math.max(6, Number(estrellasRival || 6)));
        const mult = 1 + 0.25 * (s - 6);
        return Math.max(0, Math.round(b * mult));
    }

    function objetosGarantizadosPorEstrellasRival(estrellasRival) {
        const s = Math.min(8, Math.max(6, Number(estrellasRival || 6)));
        if (s >= 8) {
            return [
                { key: 'mejoraElite', label: 'Mejora élite', icon: 'resources/icons/mejora_elite.png', cant: 8 },
                { key: 'mejoraLegendaria', label: 'Mejora legendaria', icon: 'resources/icons/mejora_legendaria.png', cant: 4 },
            ];
        }
        if (s >= 7) {
            return [
                { key: 'mejoraElite', label: 'Mejora élite', icon: 'resources/icons/mejora_elite.png', cant: 4 },
                { key: 'mejoraLegendaria', label: 'Mejora legendaria', icon: 'resources/icons/mejora_legendaria.png', cant: 2 },
            ];
        }
        return [
            { key: 'mejoraElite', label: 'Mejora élite', icon: 'resources/icons/mejora_elite.png', cant: 2 },
        ];
    }

    function pintarPanelRecompensasAsalto(asalto) {
        if (!panelRecompRoot || !asalto) return;
        const rival = rivalEstrellasModoSeleccionado();
        const pts = puntosGarantizadosAsalto(asalto.puntos, rival);
        const objs = objetosGarantizadosPorEstrellasRival(rival);
        const difLabel = rival === 8 ? 'Legendario' : (rival === 7 ? 'Élite' : 'Normal');

        const filaObjs = objs.map((o) => `
            <div class="asaltos-recomp-fila-obj">
                <img class="asaltos-recomp-obj-icon" src="${o.icon}" alt="">
                <span class="asaltos-recomp-obj-txt">${o.label} ×${o.cant}</span>
            </div>
        `).join('');

        const drops = [
            { icon: 'resources/icons/mejora.png', label: 'Mejora', pct: etiquetaPctDrop(asalto.mejora) },
            { icon: 'resources/icons/mejora_especial.png', label: 'Mejora especial', pct: etiquetaPctDrop(asalto.mejora_especial) },
            { icon: 'resources/icons/mejora_suprema.png', label: 'Mejora suprema', pct: etiquetaPctDrop(asalto.mejora_suprema) },
            { icon: 'resources/icons/mejora_definitiva.png', label: 'Mejora definitiva', pct: etiquetaPctDrop(asalto.mejora_definitiva) },
        ];
        const filaDrops = drops.map((d) => `
            <div class="asaltos-recomp-drop-item" title="Probabilidad por victoria">
                <img class="asaltos-recomp-obj-icon" src="${d.icon}" alt="">
                <span class="asaltos-recomp-drop-pct">${d.pct}</span>
            </div>
        `).join('');

        panelRecompRoot.innerHTML = `
            <div class="asaltos-recomp-bloque">
                <div class="asaltos-recomp-bloque-titulo">Recompensas garantizadas</div>
                <div class="asaltos-recomp-garant-inner">
                    <div class="asaltos-recomp-carta-linea" title="Una carta aleatoria del pool del asalto">Carta aleatoria</div>
                    <div class="asaltos-recomp-garant-datos">
                        <div class="asaltos-recomp-meta">
                            <img class="asaltos-recomp-moneda-icon" src="resources/icons/moneda.png" alt="">
                            <span><strong>${pts.toLocaleString('es-ES')}</strong> <span class="asaltos-recomp-dif-tag">(${difLabel})</span></span>
                        </div>
                        <div class="asaltos-recomp-objs-g">${filaObjs}</div>
                    </div>
                </div>
            </div>
            <div class="asaltos-recomp-bloque">
                <div class="asaltos-recomp-bloque-titulo">Recompensas aleatorias</div>
                <p class="asaltos-recomp-alea-desc">Objetos que pueden obtenerse al completar el asalto (probabilidad por victoria).</p>
                <div class="asaltos-recomp-drops-row">${filaDrops}</div>
            </div>
        `;
    }

    function rellenarPanel(asalto) {
        if (panelNombre) panelNombre.textContent = asalto.nombre || 'Asalto';
        if (panelDesc) panelDesc.textContent = asalto.descripcion || 'Sin descripción.';
        if (panelImagen) {
            panelImagen.src = urlImagenAsalto(asalto);
            panelImagen.alt = asalto.nombre || '';
        }
        pintarPanelRecompensasAsalto(asalto);
        aplicarEstadoBotonComenzar(asalto);
        actualizarBadgesDificultadPanel(asalto);
    }

    function aplicarSpin() {
        escena.style.setProperty('--asaltos-spin', String(spin));
        const frente = ((spin % 6) + 6) % 6;
        caras.forEach((el, j) => {
            el.classList.toggle('asaltos-carrusel-cara--frente', j === frente);
        });
        actualizarUiFrente();
    }

    async function abrirPanel() {
        const { asalto } = asaltoEnFrente();
        if (!asalto || !panelDetalle || !btnTogglePanel) return;
        rellenarPanel(asalto);
        panelAbierto = true;
        spinDif = 0;
        aplicarSpinDif();
        await sincronizarUsuarioParaAsaltos();
        refrescarSelectorMazosPanel();
        rellenarPanel(asalto);
        if (btnIzq) btnIzq.disabled = true;
        if (btnDer) btnDer.disabled = true;
        sincronizarAccesibilidadPanel(true);
        btnTogglePanel.setAttribute('aria-expanded', 'true');
        btnTogglePanel.setAttribute('aria-label', 'Cerrar detalle del asalto');
        btnTogglePanel.classList.add('asaltos-btn-expand-panel--abierto');
        requestAnimationFrame(() => {
            panelDetalle.classList.add('asaltos-panel-detalle--visible');
        });
    }

    function cerrarPanel() {
        if (!panelDetalle || !btnTogglePanel) return;

        ocultarModalPoderAsalto();
        panelAbierto = false;
        if (btnIzq) btnIzq.disabled = false;
        if (btnDer) btnDer.disabled = false;
        sincronizarAccesibilidadPanel(false);
        btnTogglePanel.setAttribute('aria-expanded', 'false');
        btnTogglePanel.setAttribute('aria-label', 'Desplegar detalle del asalto');
        btnTogglePanel.classList.remove('asaltos-btn-expand-panel--abierto');
        panelDetalle.classList.remove('asaltos-panel-detalle--visible');
    }

    async function togglePanel() {
        const { asalto } = asaltoEnFrente();
        if (!asalto || !btnTogglePanel || btnTogglePanel.disabled) return;
        if (panelAbierto) {
            cerrarPanel();
        } else {
            await abrirPanel();
        }
    }

    function construirPayloadAsaltoActivo(asalto, metaMazo = {}) {
        const modoRival = rivalEstrellasModoSeleccionado();
        return {
            tipo: 'asalto',
            id: asalto.asalto_ID,
            nombre: asalto.nombre,
            descripcion: asalto.descripcion,
            dificultad: modoRival,
            dificultadAsaltoCatalogo: asalto.dificultad,
            dificultadRaw: asalto.dificultadRaw,
            imagen: asalto.imagen,
            tablero: asalto.tablero,
            puntos: asalto.puntos,
            mejora: asalto.mejora,
            mejora_especial: asalto.mejora_especial,
            mejora_suprema: asalto.mejora_suprema,
            mejora_definitiva: asalto.mejora_definitiva,
            fragmentos: asalto.fragmentos,
            enemigos: asalto.cartas.slice(),
            rotacionClave: asalto.rotacionClave,
            mazoIndex: metaMazo.mazoIndex,
            mazoNombre: metaMazo.mazoNombre || '',
            mazoPoderTotal: metaMazo.mazoPoderTotal ?? 0,
        };
    }

    async function onComenzar() {
        const { asalto } = asaltoEnFrente();
        if (!asalto) return;
        if (dificultadRivalCompletadaParaAsalto(asalto, rivalEstrellasModoSeleccionado())) {
            return;
        }
        await sincronizarUsuarioParaAsaltos();
        if (!selectMazoPanel || selectMazoPanel.disabled || selectMazoPanel.value === '') {
            mostrarModalPoderAsalto(
                'No tienes mazos guardados. Crea uno desde la sección Mazos.',
            );
            return;
        }
        const idx = Number(selectMazoPanel.value);
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        const mazo = usuario?.mazos?.[idx];
        if (!mazo) {
            mostrarModalPoderAsalto('No se pudo leer el mazo seleccionado.');
            return;
        }
        const poderTotal = calcularPoderMazoCartas(mazo.Cartas);
        if (poderTotal < PODER_MINIMO_ASALTO) {
            mostrarModalPoderAsalto(
                'Tu mazo no tiene suficiente poder para participar en este asalto',
                { poderRequerido: PODER_MINIMO_ASALTO },
            );
            return;
        }
        try {
            localStorage.removeItem('desafioActivo');
            localStorage.setItem('mazoJugador', JSON.stringify({ Cartas: mazo.Cartas || [] }));
            localStorage.setItem('mazoJugadorBase', JSON.stringify({ Cartas: mazo.Cartas || [] }));
            localStorage.removeItem('mazoOponente');
            localStorage.removeItem('mazoOponenteBase');
            localStorage.setItem('partidaModo', 'asalto');
            const nomOponente = String(asalto?.nombre || 'Asalto').trim();
            if (nomOponente) {
                localStorage.setItem('nombreOponente', nomOponente);
            }
            try {
                const tab = String(asalto.tablero || '').trim();
                if (tab && typeof window.dcUrlTableroDesdeNombreExcel === 'function') {
                    const u = window.dcUrlTableroDesdeNombreExcel(tab);
                    if (u) {
                        sessionStorage.setItem('dc_tablero_fondo_url', u);
                    } else {
                        sessionStorage.removeItem('dc_tablero_fondo_url');
                    }
                } else {
                    sessionStorage.removeItem('dc_tablero_fondo_url');
                }
            } catch (_s) {
                /* noop */
            }
            localStorage.setItem(
                'asaltoActivo',
                JSON.stringify(
                    construirPayloadAsaltoActivo(asalto, {
                        mazoIndex: idx,
                        mazoNombre: String(mazo?.Nombre || '').trim(),
                        mazoPoderTotal: poderTotal,
                    }),
                ),
            );
        } catch (e) {
            console.error('No se pudo guardar asaltoActivo:', e);
            return;
        }
        window.location.href = 'tablero.html';
    }

    function actualizarBarraRotacion() {
        if (!rotTimerVal || !rotBar || !rotBarWrap) return;
        const { ahora, inicio, fin } = obtenerVentanaRotacionAsaltos();
        const restante = fin - ahora;
        const transcurrido = ahora - inicio;
        const pct = Math.min(100, Math.max(0, (transcurrido / MS_SEMANA) * 100));
        rotBar.style.width = `${pct}%`;
        rotBarWrap.setAttribute('aria-valuenow', String(Math.round(pct)));
        rotTimerVal.textContent = typeof window.dcFormatearCuentaAtrasMs === 'function'
            ? window.dcFormatearCuentaAtrasMs(restante)
            : `${Math.ceil(restante / 86400000)}d`;
    }

    function recomputeRotacionSiCambiaVentana() {
        const nuevos = obtenerAsaltosSemanaActual(asaltosListaCompleta);
        const clave = nuevos.map((a) => a?.asalto_ID).join(',');
        const prev = asaltosSemana.map((a) => a?.asalto_ID).join(',');
        if (clave !== prev) {
            asaltosSemana = nuevos;
            if (panelAbierto) {
                cerrarPanel();
            }
            actualizarUiFrente();
        }
    }

    function actualizarEscenaEarthClickeable() {
        if (!escena) {
            return;
        }
        escena.classList.toggle(
            'asaltos-carrusel-escena--earth-clickeable',
            Boolean(btnTogglePanel && !btnTogglePanel.disabled),
        );
    }

    async function cargarAsaltosDesdeExcel() {
        const response = await fetch('resources/asaltos.xlsx');
        if (!response.ok) {
            throw new Error('asaltos.xlsx');
        }
        const data = await response.arrayBuffer();
        if (typeof XLSX === 'undefined') {
            throw new Error('XLSX');
        }
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        return filas
            .map((fila, idx) => mapearAsaltoDesdeFila(fila, idx))
            .filter((a) => a.nombre)
            .sort((a, b) => a.asalto_ID - b.asalto_ID);
    }

    btnIzq.addEventListener('click', () => {
        spin -= 1;
        aplicarSpin();
    });

    btnDer.addEventListener('click', () => {
        spin += 1;
        aplicarSpin();
    });

    if (btnDifIzq) {
        btnDifIzq.addEventListener('click', () => {
            spinDif -= 1;
            aplicarSpinDif();
        });
    }
    if (btnDifDer) {
        btnDifDer.addEventListener('click', () => {
            spinDif += 1;
            aplicarSpinDif();
        });
    }

    if (btnTogglePanel) {
        btnTogglePanel.addEventListener('click', togglePanel);
    }

    if (escena) {
        escena.addEventListener('click', (event) => {
            if (!escena.classList.contains('asaltos-carrusel-escena--earth-clickeable')) {
                return;
            }
            const cara = event.target.closest('.asaltos-carrusel-cara');
            if (!cara || !cara.classList.contains('asaltos-carrusel-cara--frente')) {
                return;
            }
            void togglePanel();
        });
    }

    if (btnComenzar) {
        btnComenzar.addEventListener('click', () => {
            void onComenzar();
        });
    }

    if (selectMazoPanel) {
        selectMazoPanel.addEventListener('change', () => {
            const v = Number(selectMazoPanel.value);
            indiceMazoPanelSeleccionado = Number.isFinite(v) && !Number.isNaN(v) ? v : 0;
            actualizarPoderMazoPanelDesdeSelect();
        });
    }
    if (modalPoderEntendido) {
        modalPoderEntendido.addEventListener('click', ocultarModalPoderAsalto);
    }

    if (panelDetalle) {
        sincronizarAccesibilidadPanel(false);
    }

    aplicarSpin();
    aplicarSpinDif();
    actualizarBarraRotacion();
    rotacionTimerId = setInterval(() => {
        actualizarBarraRotacion();
        recomputeRotacionSiCambiaVentana();
    }, 1000);

    window.addEventListener('beforeunload', () => {
        if (rotacionTimerId) clearInterval(rotacionTimerId);
    });

    cargarAsaltosDesdeExcel()
        .then((lista) => {
            asaltosListaCompleta = lista;
            asaltosSemana = obtenerAsaltosSemanaActual(lista);
            if (btnTogglePanel) btnTogglePanel.disabled = false;
            actualizarEscenaEarthClickeable();
            actualizarUiFrente();
            actualizarBarraRotacion();
            void sincronizarUsuarioParaAsaltos().then(() => {
                refrescarSelectorMazosPanel();
                actualizarUiFrente();
            });
        })
        .catch((err) => {
            console.error('Asaltos:', err);
            asaltosListaCompleta = [];
            asaltosSemana = [];
            if (elNombreFrente) elNombreFrente.textContent = 'No se pudieron cargar los asaltos';
            if (btnTogglePanel) btnTogglePanel.disabled = true;
            actualizarEscenaEarthClickeable();
        });
})();
