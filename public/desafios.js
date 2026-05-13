document.addEventListener('DOMContentLoaded', async () => {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    if (!usuario) {
        window.location.href = '/login.html';
        return;
    }

    try {
        const desafios = await cargarDesafiosDesdeExcel();
        configurarModalSeleccion();
        await renderizarDesafios(desafios);
    } catch (error) {
        console.error('Error al cargar desafíos:', error);
        mostrarMensaje('No se pudieron cargar los desafíos.', 'danger');
    }
});

let desafioPendiente = null;
let usuarioCartasSeleccion = [];
let seleccionCartasDesafio = new Set();
let faccionFiltroActiva = 'H';
let afiliacionFiltroActiva = 'todas';
let faccionCaminoActiva = 'H';
let faccionFijadaModalDesafio = null;
let nivelDesafioActivo = 1;
let desafiosCache = [];
const ICONO_MEJORA = '/resources/icons/mejora.png';
const ICONO_MEJORA_ESPECIAL = '/resources/icons/mejora_especial.png';
const ICONO_MONEDA = '/resources/icons/moneda.png';

function normalizarNombre(nombre) {
    return String(nombre || '').trim().toLowerCase();
}

function normalizarFaccionCamino(valor) {
    const faccion = String(valor || '').trim().toUpperCase();
    return faccion === 'V' ? 'V' : 'H';
}

async function cargarDesafiosDesdeExcel() {
    const response = await fetch('resources/desafios.xlsx');
    if (!response.ok) {
        throw new Error('No se pudo cargar desafios.xlsx.');
    }

    const data = await response.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    return filas.map(fila => {
        const enemigos = [];
        for (let i = 1; i <= 6; i++) {
            const nombreEnemigo = String(fila[`enemigo${i}`] || '').trim();
            if (nombreEnemigo) {
                enemigos.push(nombreEnemigo);
            }
        }
        const cartasRecompensa = String(fila.cartas || '')
            .split(/[;,|]/)
            .map(nombre => String(nombre || '').trim())
            .filter(Boolean);

        const boss = String(fila.boss ?? fila.Boss ?? fila.BOSS ?? '').trim();

        return {
            id: Number(fila.ID_desafio ?? fila.id ?? 0),
            nombre: String(fila.nombre || `Desafío ${fila.ID_desafio ?? ''}`).trim(),
            descripcion: String(fila.Descripción || fila.descripcion || '').trim(),
            dificultad: Math.min(Math.max(Number(fila.dificultad || 1), 1), 6),
            faccion: normalizarFaccionCamino(fila.faccion),
            enemigos,
            boss: boss || null,
            mejora: Number(fila.mejora || 0),
            mejora_especial: Number(fila.mejora_especial || 0),
            puntos: Number(fila.puntos || 0),
            cartas: cartasRecompensa,
            tablero: String(fila.tablero ?? fila.Tablero ?? '').trim()
        };
    });
}

function obtenerCompletadosDesafiosSet(idsDesafios = new Set()) {
    const usuario = JSON.parse(localStorage.getItem('usuario')) || {};
    const completadosPreferidos = Array.isArray(usuario.desafiosCompletadosV2)
        ? usuario.desafiosCompletadosV2
        : usuario.desafiosCompletados;
    return new Set(
        (Array.isArray(completadosPreferidos) ? completadosPreferidos : [])
            .map(id => Number(id))
            .filter(id => Number.isFinite(id) && (idsDesafios.size === 0 || idsDesafios.has(id)))
    );
}

function agruparDesafiosPorNivel(desafios = []) {
    const mapa = new Map();
    for (let nivel = 1; nivel <= 6; nivel++) {
        mapa.set(nivel, []);
    }
    desafios.forEach(desafio => {
        const nivel = Math.min(Math.max(Number(desafio?.dificultad || 1), 1), 6);
        mapa.get(nivel).push(desafio);
    });
    for (let nivel = 1; nivel <= 6; nivel++) {
        mapa.set(
            nivel,
            (mapa.get(nivel) || []).sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
        );
    }
    return mapa;
}

function construirEstadoDesbloqueoPorNivel(mapaDesafiosNivel, completadosSet) {
    const desbloqueado = new Map();
    desbloqueado.set(1, true);
    for (let nivel = 2; nivel <= 6; nivel++) {
        const desafiosPrevios = mapaDesafiosNivel.get(nivel - 1) || [];
        const nivelPrevioCompletado = desafiosPrevios.length === 0
            || desafiosPrevios.every(desafio => completadosSet.has(Number(desafio.id)));
        desbloqueado.set(nivel, nivelPrevioCompletado);
    }
    return desbloqueado;
}

function filtrarDesafiosPorFaccion(desafios = [], faccion = 'H') {
    const faccionObjetivo = normalizarFaccionCamino(faccion);
    return (Array.isArray(desafios) ? desafios : []).filter(
        desafio => normalizarFaccionCamino(desafio?.faccion) === faccionObjetivo
    );
}

function primerNivelDisponible(desbloqueadoPorNivel) {
    for (let nivel = 1; nivel <= 6; nivel++) {
        if (desbloqueadoPorNivel.get(nivel)) {
            return nivel;
        }
    }
    return 1;
}

function renderizarTabsCaminoDesafio() {
    const tabs = document.getElementById('desafios-camino-tabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    const contenedor = document.querySelector('.content-container');
    if (contenedor) {
        contenedor.classList.toggle('camino-villano-activo', faccionCaminoActiva === 'V');
    }

    [
        { id: 'H', label: 'Camino del Héroe' },
        { id: 'V', label: 'Camino del Villano' }
    ].forEach(camino => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn faccion-tab desafio-nivel-tab';
        btn.textContent = camino.label;
        btn.classList.toggle('active', faccionCaminoActiva === camino.id);
        btn.onclick = () => {
            faccionCaminoActiva = camino.id;
            nivelDesafioActivo = 1;
            renderizarDesafiosGlobal();
        };
        tabs.appendChild(btn);
    });
}

function renderizarTabsNivelesDesafio(mapaDesafiosNivel, desbloqueadoPorNivel, completadosSet) {
    const tabs = document.getElementById('desafios-nivel-tabs');
    if (!tabs) {
        return;
    }

    tabs.innerHTML = '';
    for (let nivel = 1; nivel <= 6; nivel++) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn faccion-tab desafio-nivel-tab';
        const desbloqueado = Boolean(desbloqueadoPorNivel.get(nivel));
        const desafiosNivel = mapaDesafiosNivel.get(nivel) || [];
        const completado = desafiosNivel.length > 0 && desafiosNivel.every(d => completadosSet.has(Number(d.id)));

        if (desbloqueado) {
            btn.innerHTML = `Nivel ${nivel} <img src="https://i.ibb.co/zZt4R3x/star-level.png" alt="star" style="width:14px;height:14px;object-fit:contain;">`;
            btn.classList.toggle('active', nivelDesafioActivo === nivel);
            btn.onclick = () => {
                nivelDesafioActivo = nivel;
                renderizarDesafiosGlobal();
            };
            if (completado) {
                btn.title = 'Nivel completado';
            }
        } else {
            btn.innerHTML = `Bloqueado <span class="candado">🔒</span>`;
            btn.classList.add('tab-bloqueada');
            btn.onclick = () => {
                mostrarMensaje(`Completa todos los desafíos del nivel ${nivel - 1} del ${faccionCaminoActiva === 'H' ? 'Camino del Héroe' : 'Camino del Villano'} para desbloquear este nivel.`, 'warning');
            };
        }

        tabs.appendChild(btn);
    }
}

function crearEstrellas(cantidad) {
    const wrapper = document.createElement('div');
    wrapper.className = 'd-flex';
    wrapper.style.gap = '3px';

    for (let i = 0; i < cantidad; i++) {
        const estrella = document.createElement('img');
        estrella.className = 'estrella';
        estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
        estrella.alt = 'star';
        wrapper.appendChild(estrella);
    }

    return wrapper;
}

async function renderizarDesafios(desafios) {
    desafiosCache = Array.isArray(desafios) ? desafios : [];
    await renderizarDesafiosGlobal();
}

async function renderizarDesafiosGlobal() {
    const grid = document.getElementById('desafios-grid');
    grid.innerHTML = '';
    const catalogo = await cargarCatalogoCartas();
    const desafiosOrdenados = [...desafiosCache]
        .map(item => ({ ...item, id: Number(item.id) }))
        .filter(item => Number.isFinite(item.id))
        .sort((a, b) => a.id - b.id);
    const idsDesafios = new Set(desafiosOrdenados.map(item => item.id));
    const completadosSet = obtenerCompletadosDesafiosSet(idsDesafios);
    renderizarTabsCaminoDesafio();

    const desafiosPorFaccion = filtrarDesafiosPorFaccion(desafiosOrdenados, faccionCaminoActiva);
    const desafiosPorNivel = agruparDesafiosPorNivel(desafiosPorFaccion);
    const desbloqueadoPorNivel = construirEstadoDesbloqueoPorNivel(desafiosPorNivel, completadosSet);
    if (!desbloqueadoPorNivel.get(nivelDesafioActivo)) {
        nivelDesafioActivo = primerNivelDisponible(desbloqueadoPorNivel);
    }
    renderizarTabsNivelesDesafio(desafiosPorNivel, desbloqueadoPorNivel, completadosSet);
    const desafiosVisibles = desafiosPorNivel.get(nivelDesafioActivo) || [];
    const mapaCatalogo = new Map(
        catalogo.map(carta => [normalizarNombre(carta.Nombre), carta])
    );

    if (desafiosVisibles.length === 0) {
        const vacio = document.createElement('div');
        vacio.className = 'desafio-meta';
        vacio.textContent = `No hay desafíos disponibles para el nivel ${nivelDesafioActivo} en el ${faccionCaminoActiva === 'H' ? 'Camino del Héroe' : 'Camino del Villano'}.`;
        grid.appendChild(vacio);
        return;
    }

    desafiosVisibles.forEach(desafio => {
        const completado = completadosSet.has(Number(desafio.id));

        const card = document.createElement('div');
        card.className = `desafio-card ${completado ? 'completado' : 'pendiente'}`;

        const nombre = document.createElement('div');
        nombre.className = 'desafio-nombre';
        nombre.textContent = desafio.nombre;

        const descripcion = document.createElement('div');
        descripcion.className = 'desafio-descripcion';
        descripcion.textContent = desafio.descripcion || 'Sin descripción.';

        const dificultad = document.createElement('div');
        dificultad.className = 'desafio-meta';
        dificultad.textContent = 'Dificultad';
        dificultad.appendChild(crearEstrellas(desafio.dificultad));

        const etiquetaEnemigos = document.createElement('div');
        etiquetaEnemigos.className = 'desafio-enemigos-label';
        etiquetaEnemigos.textContent = 'Enemigos';

        const composicion = document.createElement('div');
        composicion.className = 'desafio-enemigos';
        const rivales = [
            ...(desafio.enemigos || []).map(nombreRival => ({ nombre: nombreRival, boss: false })),
            ...(desafio.boss ? [{ nombre: desafio.boss, boss: true }] : [])
        ];

        rivales.forEach(rival => {
            const cartaBase = mapaCatalogo.get(normalizarNombre(rival.nombre)) || { Nombre: rival.nombre, Nivel: 1 };
            const enemigoCard = document.createElement('div');
            enemigoCard.className = `desafio-enemigo-card ${rival.boss ? 'boss' : ''}`;
            enemigoCard.style.backgroundImage = `url(${obtenerImagenCarta(cartaBase)})`;

            const etiqueta = document.createElement('div');
            etiqueta.className = 'desafio-enemigo-nombre';
            etiqueta.textContent = rival.nombre;
            enemigoCard.appendChild(etiqueta);
            composicion.appendChild(enemigoCard);
        });

        const etiquetaRecompensas = document.createElement('div');
        etiquetaRecompensas.className = 'evento-recompensas-label';
        etiquetaRecompensas.textContent = 'Recompensas';

        const recompensas = document.createElement('div');
        recompensas.className = 'evento-recompensas';
        const cartasRecompensa = Array.isArray(desafio.cartas)
            ? desafio.cartas.map(nombre => String(nombre || '').trim()).filter(Boolean)
            : [];
        cartasRecompensa.forEach(nombreCarta => {
            const cartaRecompensaCatalogo = mapaCatalogo.get(normalizarNombre(nombreCarta)) || { Nombre: nombreCarta, Nivel: 1 };
            const mini = document.createElement('div');
            mini.className = 'desafio-recompensa-card';
            mini.style.backgroundImage = `url(${obtenerImagenCarta(cartaRecompensaCatalogo)})`;
            const nombreMini = document.createElement('div');
            nombreMini.className = 'desafio-enemigo-nombre';
            nombreMini.textContent = cartaRecompensaCatalogo.Nombre || nombreCarta;
            mini.appendChild(nombreMini);
            recompensas.appendChild(mini);
        });

        const puntosDesafio = Math.max(0, Number(desafio.puntos || 0));
        const metaPuntos = document.createElement('div');
        metaPuntos.className = 'evento-recompensa-tag';
        metaPuntos.innerHTML = `<img src="${ICONO_MONEDA}" alt="Moneda" style="width:28px;height:28px;object-fit:contain;"> <span>${puntosDesafio}</span>`;
        recompensas.appendChild(metaPuntos);

        if (Number(desafio.mejora || 0) > 0) {
            const tagMejora = document.createElement('div');
            tagMejora.className = 'evento-recompensa-tag';
            tagMejora.innerHTML = `<img src="${ICONO_MEJORA}" alt="Mejora" style="width:28px;height:28px;object-fit:contain;"> <span>x${desafio.mejora}</span>`;
            recompensas.appendChild(tagMejora);
        }

        if (Number(desafio.mejora_especial || 0) > 0) {
            const tagEspecial = document.createElement('div');
            tagEspecial.className = 'evento-recompensa-tag';
            tagEspecial.innerHTML = `<img src="${ICONO_MEJORA_ESPECIAL}" alt="Mejora especial" style="width:28px;height:28px;object-fit:contain;"> <span>x${desafio.mejora_especial}</span>`;
            recompensas.appendChild(tagEspecial);
        }

        const boton = document.createElement('button');
        boton.className = `btn mt-2 ${completado ? 'btn-success' : 'btn-primary'}`;
        boton.textContent = completado ? 'Volver a jugar' : 'Jugar';
        boton.onclick = async () => {
            try {
                await abrirModalSeleccionDesafio(desafio);
            } catch (error) {
                console.error('No se pudo abrir el selector del desafío:', error);
                mostrarMensaje('No se pudo abrir la selección de cartas.', 'danger');
            }
        };

        const bloqueInferior = document.createElement('div');
        bloqueInferior.className = 'desafio-bottom';
        bloqueInferior.appendChild(etiquetaRecompensas);
        bloqueInferior.appendChild(recompensas);
        bloqueInferior.appendChild(boton);

        card.appendChild(nombre);
        card.appendChild(descripcion);
        card.appendChild(dificultad);
        card.appendChild(etiquetaEnemigos);
        card.appendChild(composicion);
        card.appendChild(bloqueInferior);
        grid.appendChild(card);
    });
}

function iniciarDesafio(desafio, cartasSeleccionadas) {
    if (typeof window.limpiarEstadoPvpResiduoPartidaLocal === 'function') {
        window.limpiarEstadoPvpResiduoPartidaLocal();
    }
    try {
        sessionStorage.removeItem('dc_tablero_fondo_url');
    } catch (_e) {
        /* noop */
    }
    localStorage.setItem('desafioActivo', JSON.stringify(desafio));
    localStorage.setItem('dificultad', String(desafio.dificultad));
    localStorage.setItem('mazoJugador', JSON.stringify({ Cartas: cartasSeleccionadas }));
    localStorage.setItem('mazoJugadorBase', JSON.stringify({ Cartas: cartasSeleccionadas }));
    localStorage.removeItem('mazoOponente');
    localStorage.removeItem('mazoOponenteBase');
    window.location.href = 'tablero.html';
}

async function cargarCatalogoCartas() {
    const response = await fetch('resources/cartas.xlsx');
    if (!response.ok) {
        throw new Error('No se pudo cargar el catálogo de cartas.');
    }
    const data = await response.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet);
}

function normalizarFaccion(valor) {
    const faccion = String(valor || '').trim().toUpperCase();
    return faccion === 'H' || faccion === 'V' ? faccion : '';
}

function normalizarAfiliacion(valor) {
    return String(valor || '').trim().toLowerCase();
}

function obtenerAfiliacionesCarta(carta) {
    const raw = String(carta?.Afiliacion || carta?.afiliacion || '').trim();
    if (!raw) {
        return [];
    }

    return raw.split(';').map(v => v.trim()).filter(Boolean);
}

function obtenerSaludMaxCarta(carta) {
    const saludMax = Number(carta?.SaludMax ?? carta?.salud_max ?? carta?.saludMax ?? carta?.Salud);
    if (Number.isFinite(saludMax) && saludMax > 0) {
        return saludMax;
    }
    const poder = Number(carta?.Poder ?? carta?.poder ?? 0);
    return Math.max(1, poder);
}

function obtenerSaludActualCarta(carta) {
    const saludMax = Math.max(obtenerSaludMaxCarta(carta), 1);
    const salud = Number(carta?.Salud ?? carta?.salud);
    const saludValida = Number.isFinite(salud) ? salud : saludMax;
    return Math.max(0, Math.min(saludValida, saludMax));
}

function crearBarraSaludElemento(carta) {
    const saludActual = obtenerSaludActualCarta(carta);
    const saludMax = Math.max(obtenerSaludMaxCarta(carta), 1);
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

function configurarModalSeleccion() {
    const cancelarBtn = document.getElementById('cancelar-desafio-btn');
    const confirmarBtn = document.getElementById('confirmar-desafio-btn');
    const filtroAfi = document.getElementById('filtro-afiliacion-desafio');
    const btnH = document.getElementById('filtro-faccion-h');
    const btnV = document.getElementById('filtro-faccion-v');

    cancelarBtn.onclick = cerrarModalSeleccionDesafio;
    confirmarBtn.onclick = confirmarSeleccionDesafio;

    filtroAfi.onchange = () => {
        afiliacionFiltroActiva = normalizarAfiliacion(filtroAfi.value || 'todas');
        renderizarCartasSeleccionDesafio();
    };

    btnH.onclick = () => {
        if (faccionFijadaModalDesafio && faccionFijadaModalDesafio !== 'H') return;
        faccionFiltroActiva = 'H';
        afiliacionFiltroActiva = 'todas';
        actualizarBotonesFaccion();
        renderizarFiltroAfiliacion();
        renderizarCartasSeleccionDesafio();
    };

    btnV.onclick = () => {
        if (faccionFijadaModalDesafio && faccionFijadaModalDesafio !== 'V') return;
        faccionFiltroActiva = 'V';
        afiliacionFiltroActiva = 'todas';
        actualizarBotonesFaccion();
        renderizarFiltroAfiliacion();
        renderizarCartasSeleccionDesafio();
    };
}

function actualizarBotonesFaccion() {
    document.getElementById('filtro-faccion-h').classList.toggle('active', faccionFiltroActiva === 'H');
    document.getElementById('filtro-faccion-v').classList.toggle('active', faccionFiltroActiva === 'V');
}

function actualizarEstadoSeleccion() {
    const estado = document.getElementById('estado-seleccion-desafio');
    const confirmarBtn = document.getElementById('confirmar-desafio-btn');
    estado.textContent = `Seleccionadas: ${seleccionCartasDesafio.size} / 6`;
    confirmarBtn.disabled = seleccionCartasDesafio.size !== 6;
}

function renderizarFiltroAfiliacion() {
    const filtro = document.getElementById('filtro-afiliacion-desafio');
    const mapa = new Map();

    usuarioCartasSeleccion
        .filter(item => normalizarFaccion(item.carta.faccion) === faccionFiltroActiva)
        .forEach(item => {
            obtenerAfiliacionesCarta(item.carta).forEach(afi => {
                const key = normalizarAfiliacion(afi);
                if (key && !mapa.has(key)) {
                    mapa.set(key, afi);
                }
            });
        });

    filtro.innerHTML = '';
    const optTodas = document.createElement('option');
    optTodas.value = 'todas';
    optTodas.textContent = 'Todas';
    filtro.appendChild(optTodas);

    Array.from(mapa.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .forEach(([, afi]) => {
            const option = document.createElement('option');
            option.value = afi;
            option.textContent = afi;
            filtro.appendChild(option);
        });

    filtro.value = 'todas';
}

function renderizarCartasSeleccionDesafio() {
    const grid = document.getElementById('cartas-desafio-grid');
    grid.innerHTML = '';

    const cartasFiltradas = usuarioCartasSeleccion
        .filter(item => normalizarFaccion(item.carta.faccion) === faccionFiltroActiva)
        .filter(item => {
            if (afiliacionFiltroActiva === 'todas') {
                return true;
            }
            const afiliaciones = obtenerAfiliacionesCarta(item.carta).map(normalizarAfiliacion);
            return afiliaciones.includes(afiliacionFiltroActiva);
        });

    cartasFiltradas.forEach(item => {
        const carta = item.carta;
        const cartaDiv = document.createElement('div');
        cartaDiv.className = `carta-mini ${seleccionCartasDesafio.has(item.index) ? 'seleccionada' : ''}`;
        if (Number(carta.Nivel || 1) >= 6) {
            cartaDiv.classList.add('nivel-legendaria');
        }
        cartaDiv.style.backgroundImage = `url(${obtenerImagenCarta(carta)})`;

        const estrellasDiv = document.createElement('div');
        estrellasDiv.className = 'estrellas-carta';
        const nivel = Number(carta.Nivel || 1);
        for (let i = 0; i < nivel; i++) {
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
        if (badgeHabilidad) {
            cartaDiv.appendChild(badgeHabilidad);
        }
        const badgeAfiliacion = window.crearBadgeAfiliacionCarta ? window.crearBadgeAfiliacionCarta(carta) : null;
        if (badgeAfiliacion) {
            cartaDiv.appendChild(badgeAfiliacion);
        }
        cartaDiv.appendChild(crearBarraSaludElemento(carta));
        cartaDiv.onclick = () => toggleSeleccionCartaDesafio(item.index);

        grid.appendChild(cartaDiv);
    });
}

function toggleSeleccionCartaDesafio(indexCarta) {
    if (seleccionCartasDesafio.has(indexCarta)) {
        seleccionCartasDesafio.delete(indexCarta);
    } else {
        if (seleccionCartasDesafio.size >= 6) {
            mostrarMensaje('Solo puedes seleccionar 6 cartas.', 'warning');
            return;
        }
        seleccionCartasDesafio.add(indexCarta);
    }

    actualizarEstadoSeleccion();
    renderizarCartasSeleccionDesafio();
}

async function abrirModalSeleccionDesafio(desafio) {
    desafioPendiente = desafio;
    faccionFijadaModalDesafio = normalizarFaccionCamino(desafio?.faccion || 'H');
   
    const email = localStorage.getItem('email');

    const response = await fetch('/get-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });

    const data = await response.json();
    const usuario = data.usuario;

    localStorage.setItem('usuario', JSON.stringify(usuario));

    if (!usuario || !Array.isArray(usuario.cartas) || usuario.cartas.length < 6) {
        mostrarMensaje('Necesitas al menos 6 cartas en tu colección.', 'warning');
        return;
    }

    const catalogo = await cargarCatalogoCartas();
    const mapaFaccionAfiliacion = new Map();
    catalogo.forEach(carta => {
        mapaFaccionAfiliacion.set(normalizarNombre(carta.Nombre), {
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
            const datos = mapaFaccionAfiliacion.get(normalizarNombre(carta.Nombre));
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
        .sort((a, b) => (Number(b.carta.Poder || 0) - Number(a.carta.Poder || 0)));

    usuarioCartasSeleccion = typeof window.deduplicarItemsCartasUsuarioMejorNivel === 'function'
        ? window.deduplicarItemsCartasUsuarioMejorNivel(itemsEnriquecidos)
        : itemsEnriquecidos;

    if (usuarioCartasSeleccion.length < 6) {
        mostrarMensaje(
            'Necesitas al menos 6 cartas distintas por nombre en tu colección (se usa la de mayor nivel de cada una).',
            'warning'
        );
        return;
    }

    faccionFiltroActiva = faccionFijadaModalDesafio;
    afiliacionFiltroActiva = 'todas';
    seleccionCartasDesafio.clear();
    const tabsFaccion = document.getElementById('filtro-faccion-tabs-desafio');
    if (tabsFaccion) {
        tabsFaccion.style.display = 'none';
    }
    actualizarBotonesFaccion();
    renderizarFiltroAfiliacion();
    const disponiblesPorFaccion = usuarioCartasSeleccion.filter(
        item => normalizarFaccion(item.carta.faccion) === faccionFiltroActiva
    );
    if (disponiblesPorFaccion.length < 6) {
        if (tabsFaccion) {
            tabsFaccion.style.display = '';
        }
        faccionFijadaModalDesafio = null;
        mostrarMensaje(
            `Necesitas al menos 6 cartas ${faccionFiltroActiva === 'H' ? 'de héroe' : 'de villano'} para este desafío.`,
            'warning'
        );
        return;
    }
    renderizarCartasSeleccionDesafio();
    actualizarEstadoSeleccion();

    document.getElementById('modal-seleccion-desafio').style.display = 'flex';
}

function cerrarModalSeleccionDesafio() {
    document.getElementById('modal-seleccion-desafio').style.display = 'none';
    const tabsFaccion = document.getElementById('filtro-faccion-tabs-desafio');
    if (tabsFaccion) {
        tabsFaccion.style.display = '';
    }
    desafioPendiente = null;
    faccionFijadaModalDesafio = null;
    seleccionCartasDesafio.clear();
}

function confirmarSeleccionDesafio() {
    if (!desafioPendiente || seleccionCartasDesafio.size !== 6) {
        return;
    }

    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const cartasSeleccionadas = Array.from(seleccionCartasDesafio).map(index => ({ ...usuario.cartas[index] }));
    iniciarDesafio(desafioPendiente, cartasSeleccionadas);
}

function mostrarMensaje(mensaje, tipo = 'warning') {
    const el = document.getElementById('mensaje-desafios');
    el.textContent = mensaje;
    el.className = `alert alert-${tipo}`;
    el.style.display = 'block';
}

function logout() {
    localStorage.removeItem('usuario');
    window.location.href = '/login.html';
}
