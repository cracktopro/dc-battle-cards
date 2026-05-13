/**
 * Vista Asaltos: carrusel 3D + datos desde asaltos.xlsx con rotación semanal (6 asaltos por ventana).
 */
(function () {
    const MS_SEMANA = 7 * 24 * 60 * 60 * 1000;
    const VERSION_ROTACION_ASALTOS = 'asaltos-rotation-v1';
    const STAR_SRC = 'https://i.ibb.co/zZt4R3x/star-level.png';
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
    const panelEstrellas = document.getElementById('asaltos-panel-estrellas');
    const btnComenzar = document.getElementById('asaltos-panel-comenzar');
    const rotTimerVal = document.getElementById('asaltos-rotacion-timer-valor');
    const rotBar = document.getElementById('asaltos-rotacion-barra-progreso');
    const rotBarWrap = document.getElementById('asaltos-rotacion-barra-wrap');

    if (!escena || !btnIzq || !btnDer) {
        return;
    }

    const caras = escena.querySelectorAll('.asaltos-carrusel-cara');
    let spin = 0;
    let asaltosListaCompleta = [];
    let asaltosSemana = [];
    let panelAbierto = false;
    let rotacionTimerId = null;

    /** Panel en overlay: sin atributo hidden (para poder animar opacity). */
    function sincronizarAccesibilidadPanel(abierto) {
        if (!panelDetalle) return;
        panelDetalle.setAttribute('aria-hidden', abierto ? 'false' : 'true');
        if ('inert' in panelDetalle) {
            panelDetalle.inert = !abierto;
        }
    }

    function obtenerVentanaRotacionAsaltos() {
        const ahora = Date.now();
        const idVentana = Math.floor(ahora / MS_SEMANA);
        const inicio = idVentana * MS_SEMANA;
        const fin = inicio + MS_SEMANA;
        return { ahora, idVentana, inicio, fin };
    }

    function obtenerClaveRotacionAsaltos() {
        const { idVentana } = obtenerVentanaRotacionAsaltos();
        return `${VERSION_ROTACION_ASALTOS}-${idVentana}`;
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
        const { idVentana } = obtenerVentanaRotacionAsaltos();
        const start = ((idVentana * 6) % N + N) % N;
        const salida = [];
        for (let i = 0; i < 6; i += 1) {
            salida.push(L[(start + i) % N]);
        }
        return salida;
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
            mejora: Number(fila.mejora || 0),
            mejora_especial: Number(fila.mejora_especial || 0),
            mejora_suprema: Number(fila.mejora_suprema || 0),
            mejora_definitiva: Number(fila.mejora_definitiva || 0),
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

    function pintarEstrellas(contenedor, cantidad) {
        if (!contenedor) return;
        contenedor.innerHTML = '';
        const n = Math.min(6, Math.max(1, Number(cantidad) || 1));
        for (let i = 0; i < n; i += 1) {
            const img = document.createElement('img');
            img.className = 'estrella';
            img.src = STAR_SRC;
            img.alt = '★';
            contenedor.appendChild(img);
        }
    }

    function actualizarUiFrente() {
        const { asalto } = asaltoEnFrente();
        if (elNombreFrente) {
            elNombreFrente.textContent = asalto ? asalto.nombre : '—';
        }
        if (panelAbierto && asalto) {
            rellenarPanel(asalto);
        }
    }

    function rellenarPanel(asalto) {
        if (panelNombre) panelNombre.textContent = asalto.nombre || 'Asalto';
        if (panelDesc) panelDesc.textContent = asalto.descripcion || 'Sin descripción.';
        if (panelImagen) {
            panelImagen.src = urlImagenAsalto(asalto);
            panelImagen.alt = asalto.nombre || '';
        }
        pintarEstrellas(panelEstrellas, asalto.dificultad);
    }

    function aplicarSpin() {
        escena.style.setProperty('--asaltos-spin', String(spin));
        const frente = ((spin % 6) + 6) % 6;
        caras.forEach((el, j) => {
            el.classList.toggle('asaltos-carrusel-cara--frente', j === frente);
        });
        actualizarUiFrente();
    }

    function abrirPanel() {
        const { asalto } = asaltoEnFrente();
        if (!asalto || !panelDetalle || !btnTogglePanel) return;
        rellenarPanel(asalto);
        panelAbierto = true;
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

        panelAbierto = false;
        if (btnIzq) btnIzq.disabled = false;
        if (btnDer) btnDer.disabled = false;
        sincronizarAccesibilidadPanel(false);
        btnTogglePanel.setAttribute('aria-expanded', 'false');
        btnTogglePanel.setAttribute('aria-label', 'Desplegar detalle del asalto');
        btnTogglePanel.classList.remove('asaltos-btn-expand-panel--abierto');
        panelDetalle.classList.remove('asaltos-panel-detalle--visible');
    }

    function togglePanel() {
        const { asalto } = asaltoEnFrente();
        if (!asalto || !btnTogglePanel || btnTogglePanel.disabled) return;
        if (panelAbierto) {
            cerrarPanel();
        } else {
            abrirPanel();
        }
    }

    function construirPayloadAsaltoActivo(asalto) {
        return {
            tipo: 'asalto',
            id: asalto.asalto_ID,
            nombre: asalto.nombre,
            descripcion: asalto.descripcion,
            dificultad: asalto.dificultad,
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
            rotacionClave: asalto.rotacionClave
        };
    }

    function onComenzar() {
        const { asalto } = asaltoEnFrente();
        if (!asalto) return;
        try {
            localStorage.setItem('asaltoActivo', JSON.stringify(construirPayloadAsaltoActivo(asalto)));
        } catch (e) {
            console.error('No se pudo guardar asaltoActivo:', e);
            return;
        }
        window.location.href = 'vistaJuego.html';
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

    if (btnTogglePanel) {
        btnTogglePanel.addEventListener('click', togglePanel);
    }
    if (btnComenzar) {
        btnComenzar.addEventListener('click', onComenzar);
    }

    if (panelDetalle) {
        sincronizarAccesibilidadPanel(false);
    }

    aplicarSpin();
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
            actualizarUiFrente();
            actualizarBarraRotacion();
        })
        .catch((err) => {
            console.error('Asaltos:', err);
            asaltosListaCompleta = [];
            asaltosSemana = [];
            if (elNombreFrente) elNombreFrente.textContent = 'No se pudieron cargar los asaltos';
            if (btnTogglePanel) btnTogglePanel.disabled = true;
        });
})();
