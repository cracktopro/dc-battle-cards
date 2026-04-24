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
const ICONO_MEJORA = '/resources/icons/mejora.png';
const ICONO_MEJORA_ESPECIAL = '/resources/icons/mejora_especial.png';

function normalizarNombre(nombre) {
    return String(nombre || '').trim().toLowerCase();
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

        const boss = String(fila.boss || '').trim();

        return {
            id: Number(fila.ID_desafio ?? fila.id ?? 0),
            nombre: String(fila.nombre || `Desafío ${fila.ID_desafio ?? ''}`).trim(),
            descripcion: String(fila.Descripción || fila.descripcion || '').trim(),
            dificultad: Math.min(Math.max(Number(fila.dificultad || 1), 1), 6),
            enemigos,
            boss: boss || null,
            mejora: Number(fila.mejora || 0),
            mejora_especial: Number(fila.mejora_especial || 0),
            puntos: Number(fila.puntos || 0)
        };
    });
}

function estaDesbloqueado(desafio, completados) {
    if (desafio.id === 0) return true;
    return completados.includes(desafio.id - 1);
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
    const grid = document.getElementById('desafios-grid');
    grid.innerHTML = '';
    const catalogo = await cargarCatalogoCartas();
    const mapaCatalogo = new Map(
        catalogo.map(carta => [normalizarNombre(carta.Nombre), carta])
    );

    desafios.forEach(desafio => {
        const usuario = JSON.parse(localStorage.getItem('usuario')) || {};
        const completados = usuario.desafiosCompletados || [];
        const completado = completados.includes(desafio.id);
        const desbloqueado = estaDesbloqueado(desafio, completados);

        const card = document.createElement('div');
        card.className = `desafio-card ${completado ? 'completado' : 'pendiente'}`;
        if (!desbloqueado) {
            card.style.opacity = '0.6';
        }

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
        etiquetaRecompensas.className = 'desafio-recompensas-label';
        etiquetaRecompensas.textContent = 'Recompensas';

        const recompensas = document.createElement('div');
        recompensas.className = 'desafio-recompensas';
        const meta = document.createElement('div');
        meta.className = 'desafio-recompensas-meta';
        meta.textContent = `Puntos: ${desafio.puntos}`;
        recompensas.appendChild(meta);

        if (Number(desafio.mejora || 0) > 0) {
            const tagMejora = document.createElement('div');
            tagMejora.className = 'desafio-recompensa-tag';
            tagMejora.innerHTML = `<img src="${ICONO_MEJORA}" alt="Mejora" style="width:28px;height:28px;object-fit:contain;"> <span>x${desafio.mejora}</span>`;
            recompensas.appendChild(tagMejora);
        }

        if (Number(desafio.mejora_especial || 0) > 0) {
            const tagEspecial = document.createElement('div');
            tagEspecial.className = 'desafio-recompensa-tag';
            tagEspecial.innerHTML = `<img src="${ICONO_MEJORA_ESPECIAL}" alt="Mejora especial" style="width:28px;height:28px;object-fit:contain;"> <span>x${desafio.mejora_especial}</span>`;
            recompensas.appendChild(tagEspecial);
        }

        const boton = document.createElement('button');

        if (!desbloqueado) {
            boton.className = 'btn btn-secondary mt-2';
            boton.textContent = 'Bloqueado 🔒';
            boton.disabled = true;
        } else {
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
        }

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
        faccionFiltroActiva = 'H';
        afiliacionFiltroActiva = 'todas';
        actualizarBotonesFaccion();
        renderizarFiltroAfiliacion();
        renderizarCartasSeleccionDesafio();
    };

    btnV.onclick = () => {
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
            Afiliacion: carta.Afiliacion || ''
        });
    });

    usuarioCartasSeleccion = usuario.cartas
        .map((carta, index) => {
            const datos = mapaFaccionAfiliacion.get(normalizarNombre(carta.Nombre));
            return {
                index,
                carta: {
                    ...carta,
                    faccion: carta.faccion || datos?.faccion || '',
                    Afiliacion: carta.Afiliacion || datos?.Afiliacion || ''
                }
            };
        })
        .sort((a, b) => (Number(b.carta.Poder || 0) - Number(a.carta.Poder || 0)));

    faccionFiltroActiva = 'H';
    afiliacionFiltroActiva = 'todas';
    seleccionCartasDesafio.clear();
    actualizarBotonesFaccion();
    renderizarFiltroAfiliacion();
    renderizarCartasSeleccionDesafio();
    actualizarEstadoSeleccion();

    document.getElementById('modal-seleccion-desafio').style.display = 'flex';
}

function cerrarModalSeleccionDesafio() {
    document.getElementById('modal-seleccion-desafio').style.display = 'none';
    desafioPendiente = null;
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
