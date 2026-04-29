let usuarioActual = null;
let emailActual = null;
let catalogoCartas = [];
let faccionAvatarActiva = 'H';
let afiliacionAvatarActiva = 'todas';
let busquedaAvatar = '';
let cartaAvatarSeleccionada = null;

document.addEventListener('DOMContentLoaded', async () => {
    usuarioActual = JSON.parse(localStorage.getItem('usuario'));
    emailActual = localStorage.getItem('email');

    if (!usuarioActual || !emailActual) {
        window.location.href = '/login.html';
        return;
    }

    try {
        configurarEventos();
        await cargarCatalogoCartas();
        renderizarPerfil();
        renderizarPanelAdmin();
    } catch (error) {
        console.error(error);
        mostrarMensaje('No se pudo cargar la vista de opciones.', 'danger');
    }
});

function normalizarFaccion(valor) {
    const faccion = String(valor || '').trim().toUpperCase();
    return faccion === 'H' || faccion === 'V' ? faccion : '';
}

function normalizarNombre(valor) {
    return String(valor || '').trim().toLowerCase();
}

function normalizarAfiliacion(valor) {
    return String(valor || '').trim().toLowerCase();
}

function seleccionarCartasAleatorias(cartas, cantidad) {
    const disponibles = [...cartas];
    const seleccionadas = [];
    const total = Math.min(cantidad, disponibles.length);
    while (seleccionadas.length < total) {
        const index = Math.floor(Math.random() * disponibles.length);
        const [carta] = disponibles.splice(index, 1);
        seleccionadas.push(carta);
    }
    return seleccionadas;
}

function crearCartasInicialesPorDefecto() {
    const heroes = catalogoCartas.filter(carta => normalizarFaccion(carta?.faccion || carta?.Faccion) === 'H');
    const villanos = catalogoCartas.filter(carta => normalizarFaccion(carta?.faccion || carta?.Faccion) === 'V');

    const cartasHeroes = seleccionarCartasAleatorias(heroes, 12);
    const cartasVillanos = seleccionarCartasAleatorias(villanos, 12);

    const inicializar = (cartas) => cartas.map(carta => ({
        ...carta,
        Nivel: 1,
        Poder: Number.parseInt(carta?.Poder, 10) || 0
    }));

    return [...inicializar(cartasHeroes), ...inicializar(cartasVillanos)];
}

function obtenerAfiliacionesCarta(carta) {
    const raw = String(carta?.Afiliacion || carta?.afiliacion || '').trim();
    if (!raw) {
        return [];
    }
    return raw.split(';').map(item => item.trim()).filter(Boolean);
}

function mostrarMensaje(mensaje, tipo = 'warning') {
    const el = document.getElementById('mensaje-opciones');
    if (!el) return;
    el.textContent = mensaje;
    el.className = `alert alert-${tipo}`;
    el.style.display = 'block';
    setTimeout(() => {
        el.style.display = 'none';
    }, 2600);
}

function configurarEventos() {
    document.getElementById('guardar-perfil-btn')?.addEventListener('click', guardarPerfil);
    document.getElementById('abrir-selector-avatar-btn')?.addEventListener('click', abrirModalAvatar);
    document.getElementById('cancelar-avatar-btn')?.addEventListener('click', cerrarModalAvatar);
    document.getElementById('confirmar-avatar-btn')?.addEventListener('click', confirmarAvatar);

    document.getElementById('filtro-avatar-h')?.addEventListener('click', () => {
        faccionAvatarActiva = 'H';
        actualizarTabsAvatar();
        renderizarSelectorAfiliacionAvatar();
        renderizarGridAvatar();
    });
    document.getElementById('filtro-avatar-v')?.addEventListener('click', () => {
        faccionAvatarActiva = 'V';
        actualizarTabsAvatar();
        renderizarSelectorAfiliacionAvatar();
        renderizarGridAvatar();
    });

    document.getElementById('buscar-avatar-input')?.addEventListener('input', (event) => {
        busquedaAvatar = normalizarNombre(event.target.value);
        renderizarGridAvatar();
    });

    document.getElementById('filtro-afiliacion-avatar')?.addEventListener('change', (event) => {
        afiliacionAvatarActiva = normalizarAfiliacion(event.target.value || 'todas') || 'todas';
        renderizarGridAvatar();
    });

    document.getElementById('abrir-reset-btn')?.addEventListener('click', () => {
        document.getElementById('confirmacion-borrado-input').value = '';
        document.getElementById('confirmar-reset-btn').disabled = true;
        document.getElementById('modal-reset-progreso').style.display = 'flex';
    });
    document.getElementById('cancelar-reset-btn')?.addEventListener('click', () => {
        document.getElementById('modal-reset-progreso').style.display = 'none';
    });
    document.getElementById('confirmar-reset-btn')?.addEventListener('click', reiniciarProgresoCuenta);
    document.getElementById('confirmacion-borrado-input')?.addEventListener('input', (event) => {
        const boton = document.getElementById('confirmar-reset-btn');
        if (!boton) return;
        const texto = String(event.target.value || '').trim();
        boton.disabled = texto !== 'BORRAR';
    });

    document.getElementById('admin-sumar-puntos-btn')?.addEventListener('click', adminSumarPuntos);
    document.getElementById('admin-obtener-cartas-btn')?.addEventListener('click', adminObtenerTodasCartas);
    document.getElementById('admin-mejorar-cartas-btn')?.addEventListener('click', adminMejorarTodasCartas);
}

async function cargarCatalogoCartas() {
    const response = await fetch('resources/cartas.xlsx');
    if (!response.ok) {
        throw new Error('No se pudo cargar el catálogo de cartas.');
    }
    const data = await response.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    catalogoCartas = XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function renderizarPerfil() {
    const nicknameInput = document.getElementById('nickname-input');
    nicknameInput.value = usuarioActual.nickname || '';

    const avatarPreview = document.getElementById('avatar-preview');
    const avatarUrl = String(usuarioActual.avatar || '').trim();
    avatarPreview.style.backgroundImage = avatarUrl
        ? `url(${avatarUrl})`
        : 'url(https://i.ibb.co/QJvLStm/zzz-Carta-Back.png)';
}

function renderizarPanelAdmin() {
    const adminPanel = document.getElementById('admin-panel');
    if (!adminPanel) return;
    adminPanel.style.display = emailActual === 'lorenzopablo93@gmail.com' ? 'flex' : 'none';
}

async function guardarPerfil() {
    const nickname = String(document.getElementById('nickname-input').value || '').trim();
    usuarioActual.nickname = nickname;
    await persistirUsuario('Perfil actualizado correctamente.');
}

function abrirModalAvatar() {
    cartaAvatarSeleccionada = null;
    faccionAvatarActiva = 'H';
    afiliacionAvatarActiva = 'todas';
    busquedaAvatar = '';
    document.getElementById('buscar-avatar-input').value = '';
    document.getElementById('confirmar-avatar-btn').disabled = true;
    document.getElementById('personaje-seleccionado-label').textContent = 'Ninguno';
    actualizarTabsAvatar();
    renderizarSelectorAfiliacionAvatar();
    renderizarGridAvatar();
    document.getElementById('modal-seleccion-personaje').style.display = 'flex';
}

function cerrarModalAvatar() {
    document.getElementById('modal-seleccion-personaje').style.display = 'none';
}

function actualizarTabsAvatar() {
    document.getElementById('filtro-avatar-h')?.classList.toggle('active', faccionAvatarActiva === 'H');
    document.getElementById('filtro-avatar-v')?.classList.toggle('active', faccionAvatarActiva === 'V');
}

function renderizarSelectorAfiliacionAvatar() {
    const selector = document.getElementById('filtro-afiliacion-avatar');
    const mapa = new Map();

    catalogoCartas
        .filter(carta => normalizarFaccion(carta?.faccion || carta?.Faccion) === faccionAvatarActiva)
        .forEach(carta => {
            obtenerAfiliacionesCarta(carta).forEach(afi => {
                const key = normalizarAfiliacion(afi);
                if (key && !mapa.has(key)) {
                    mapa.set(key, afi);
                }
            });
        });

    selector.innerHTML = '';
    const optTodas = document.createElement('option');
    optTodas.value = 'todas';
    optTodas.textContent = 'Todas';
    selector.appendChild(optTodas);

    Array.from(mapa.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .forEach(([, afiliacion]) => {
            const option = document.createElement('option');
            option.value = afiliacion;
            option.textContent = afiliacion;
            selector.appendChild(option);
        });

    afiliacionAvatarActiva = 'todas';
    selector.value = 'todas';
}

function crearCartaMiniAvatar(carta) {
    const div = document.createElement('div');
    div.className = `carta-mini-opcion ${cartaAvatarSeleccionada?.Nombre === carta.Nombre ? 'seleccionada' : ''}`;

    // Avatar siempre usa imagen base (no imagen_final).
    const imagenBase = String(carta?.Imagen || carta?.imagen || '').trim() || 'img/default-image.jpg';
    div.style.backgroundImage = `url(${imagenBase})`;

    const estrellasDiv = document.createElement('div');
    estrellasDiv.className = 'estrellas-carta';
    const nivel = Number(carta?.Nivel || 1);
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

    div.appendChild(estrellasDiv);
    div.appendChild(detallesDiv);
    const badgeHabilidad = window.crearBadgeHabilidadCarta ? window.crearBadgeHabilidadCarta(carta) : null;
    if (badgeHabilidad) {
        div.appendChild(badgeHabilidad);
    }
    const badgeAfiliacion = window.crearBadgeAfiliacionCarta ? window.crearBadgeAfiliacionCarta(carta) : null;
    if (badgeAfiliacion) {
        div.appendChild(badgeAfiliacion);
    }
    div.addEventListener('click', () => {
        cartaAvatarSeleccionada = { ...carta };
        document.getElementById('personaje-seleccionado-label').textContent = carta.Nombre;
        document.getElementById('confirmar-avatar-btn').disabled = false;
        renderizarGridAvatar();
    });

    return div;
}

function renderizarGridAvatar() {
    const grid = document.getElementById('personajes-grid');
    grid.innerHTML = '';

    const cartas = catalogoCartas
        .filter(carta => normalizarFaccion(carta?.faccion || carta?.Faccion) === faccionAvatarActiva)
        .filter(carta => {
            if (!busquedaAvatar) return true;
            return normalizarNombre(carta.Nombre).includes(busquedaAvatar);
        })
        .filter(carta => {
            if (afiliacionAvatarActiva === 'todas') return true;
            return obtenerAfiliacionesCarta(carta)
                .map(normalizarAfiliacion)
                .includes(afiliacionAvatarActiva);
        })
        .sort((a, b) => String(a.Nombre || '').localeCompare(String(b.Nombre || '')));

    cartas.forEach(carta => {
        grid.appendChild(crearCartaMiniAvatar(carta));
    });
}

async function confirmarAvatar() {
    if (!cartaAvatarSeleccionada) {
        return;
    }
    const imagenBase = String(cartaAvatarSeleccionada?.Imagen || cartaAvatarSeleccionada?.imagen || '').trim();
    usuarioActual.avatar = imagenBase || '';
    usuarioActual.avatarNombre = cartaAvatarSeleccionada.Nombre || '';
    await persistirUsuario('Avatar actualizado correctamente.');
    cerrarModalAvatar();
    renderizarPerfil();
}

async function reiniciarProgresoCuenta() {
    const texto = String(document.getElementById('confirmacion-borrado-input').value || '').trim();
    if (texto !== 'BORRAR') {
        mostrarMensaje('Debes escribir BORRAR para confirmar.', 'danger');
        return;
    }

    usuarioActual.puntos = 0;
    usuarioActual.cartas = crearCartasInicialesPorDefecto();
    usuarioActual.mazos = [];
    usuarioActual.objetos = { mejoraCarta: 0, mejoraEspecial: 0 };
    usuarioActual.desafiosCompletados = [];
    usuarioActual.tienda = null;
    usuarioActual.eventosJugadosPorRotacion = {};
    localStorage.removeItem('desafioActivo');
    localStorage.removeItem('mazoJugador');
    localStorage.removeItem('mazoJugadorBase');
    localStorage.removeItem('mazoOponente');
    localStorage.removeItem('mazoOponenteBase');

    await persistirUsuario('Progreso reiniciado correctamente.', 'success');
    document.getElementById('modal-reset-progreso').style.display = 'none';
}

async function adminSumarPuntos() {
    usuarioActual.puntos = Number(usuarioActual.puntos || 0) + 5000;
    await persistirUsuario('Se han agregado 5000 puntos.', 'success');
}

async function adminObtenerTodasCartas() {
    const mapaActual = new Set((usuarioActual.cartas || []).map(c => normalizarNombre(c?.Nombre)));
    const mapaNuevas = new Map();
    catalogoCartas.forEach(carta => {
        const clave = normalizarNombre(carta?.Nombre);
        if (!clave || mapaActual.has(clave) || mapaNuevas.has(clave)) return;
        mapaNuevas.set(clave, { ...carta });
    });
    const nuevas = Array.from(mapaNuevas.values());
    usuarioActual.cartas = Array.isArray(usuarioActual.cartas) ? usuarioActual.cartas : [];
    usuarioActual.cartas.push(...nuevas);
    await persistirUsuario('Se han otorgado todas las cartas del juego.', 'success');
}

function escalarCartaANivel(carta, nivelObjetivo) {
    const nivelActual = Number(carta.Nivel || 1);
    const poderActual = Number(carta.Poder || 0);
    const poderBaseNivel1 = Math.max(0, poderActual - ((nivelActual - 1) * 500));
    const cartaEscalada = {
        ...carta,
        Nivel: nivelObjetivo,
        Poder: poderBaseNivel1 + ((nivelObjetivo - 1) * 500)
    };
    if (typeof window.recalcularSkillPowerPorNivel === 'function') {
        window.recalcularSkillPowerPorNivel(cartaEscalada, nivelObjetivo, { rawEsBase: true });
    }
    return cartaEscalada;
}

async function adminMejorarTodasCartas() {
    const nivel = Math.min(Math.max(Number(document.getElementById('admin-nivel-cartas').value || 1), 1), 6);
    usuarioActual.cartas = (usuarioActual.cartas || []).map(carta => escalarCartaANivel(carta, nivel));
    await persistirUsuario(`Todas tus cartas se han ajustado a nivel ${nivel}.`, 'success');
}

async function persistirUsuario(mensajeExito, tipo = 'success') {
    try {
        const response = await fetch('/update-user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ usuario: usuarioActual, email: emailActual })
        });

        if (!response.ok) {
            throw new Error('Error al actualizar los datos de usuario.');
        }

        localStorage.setItem('usuario', JSON.stringify(usuarioActual));
        mostrarMensaje(mensajeExito, tipo);
    } catch (error) {
        console.error(error);
        mostrarMensaje('No se pudieron guardar los cambios.', 'danger');
    }
}

function logout() {
    localStorage.removeItem('usuario');
    localStorage.removeItem('email');
    localStorage.removeItem('jugandoPartida');
    localStorage.removeItem('mazoJugador');
    localStorage.removeItem('mazoOponente');
    window.location.href = '/login.html';
}
