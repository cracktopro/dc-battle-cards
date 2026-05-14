let usuarioActual = null;
let emailActual = null;
let catalogoCartas = [];
let faccionAvatarActiva = 'H';
let afiliacionAvatarActiva = 'todas';
let busquedaAvatar = '';
let cartaAvatarSeleccionada = null;
let adminUsuariosRegistrados = [];
let adminUsuarioObjetivo = null;
let adminUsuarioObjetivoEmail = '';
let adminCartaObjetivoIndex = -1;
let adminBusquedaCartas = '';
const COLOR_PRINCIPAL_DEFAULT = { r: 0, g: 123, b: 255 };

/** Coherente con `jugarPartida.js` / `cartas.js` (combate y colección hasta 8★). */
const ADMIN_NIVEL_CARTA_MAX = 8;
/** Misma ventana horaria que eventos VS BOT y eventos coop online (`ROTACION_EVENTOS_MS`). */
const ADMIN_ROTACION_EVENTOS_MS = 60 * 60 * 1000;
const ADMIN_VERSION_ROT_EVENTOS = 'event-rotation-v1';
const ADMIN_VERSION_ROT_EVENTOS_COOP = 'event-rotation-coop-online-v1';
const ADMIN_VERSION_ROT_ASALTOS = 'asaltos-rotation-v2-monday';

function adminObtenerInicioSemanaLunesLocalMs(ahora = Date.now()) {
    const t = new Date(ahora);
    const d = new Date(t.getFullYear(), t.getMonth(), t.getDate());
    const dow = d.getDay();
    d.setDate(d.getDate() - ((dow + 6) % 7));
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function adminClavesRotacionEventosActivas() {
    const idVentana = Math.floor(Date.now() / ADMIN_ROTACION_EVENTOS_MS);
    return [
        `${ADMIN_VERSION_ROT_EVENTOS}-${idVentana}`,
        `${ADMIN_VERSION_ROT_EVENTOS_COOP}-${idVentana}`,
    ];
}

function adminClaveRotacionAsaltosActual() {
    return `${ADMIN_VERSION_ROT_ASALTOS}-${adminObtenerInicioSemanaLunesLocalMs()}`;
}

document.addEventListener('DOMContentLoaded', async () => {
    usuarioActual = JSON.parse(localStorage.getItem('usuario'));
    emailActual = localStorage.getItem('email');

    if (!usuarioActual || !emailActual) {
        window.location.href = '/login.html';
        return;
    }

    // El panel admin debe mostrarse aunque falle alguna carga secundaria.
    renderizarPanelAdmin();

    try {
        configurarEventos();
        await cargarCatalogoCartas();
        renderizarPerfil();
        renderizarColorPrincipalUI();
        await inicializarAdminGestionUsuarios();
    } catch (error) {
        console.error(error);
        renderizarPanelAdmin();
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
    document.getElementById('admin-user-load-btn')?.addEventListener('click', cargarUsuarioObjetivoAdmin);
    document.getElementById('admin-target-save-btn')?.addEventListener('click', guardarUsuarioObjetivoAdmin);
    document.getElementById('admin-card-add-btn')?.addEventListener('click', adminAgregarCartaObjetivo);
    document.getElementById('admin-card-remove-btn')?.addEventListener('click', adminEliminarCartaObjetivo);
    document.getElementById('admin-card-level-up-btn')?.addEventListener('click', () => adminCambiarNivelCartaObjetivo(1));
    document.getElementById('admin-card-level-down-btn')?.addEventListener('click', () => adminCambiarNivelCartaObjetivo(-1));
    document.getElementById('admin-card-search-input')?.addEventListener('input', (event) => {
        adminBusquedaCartas = normalizarNombre(event.target.value);
        renderizarCartasAdminObjetivo();
    });
    document.getElementById('admin-target-puntos')?.addEventListener('input', sincronizarCamposBasicosObjetivoAdmin);
    document.getElementById('admin-target-mejora')?.addEventListener('input', sincronizarCamposBasicosObjetivoAdmin);
    document.getElementById('admin-target-mejora-especial')?.addEventListener('input', sincronizarCamposBasicosObjetivoAdmin);
    document.getElementById('admin-target-mejora-suprema')?.addEventListener('input', sincronizarCamposBasicosObjetivoAdmin);
    document.getElementById('admin-target-mejora-definitiva')?.addEventListener('input', sincronizarCamposBasicosObjetivoAdmin);
    document.getElementById('admin-target-mejora-elite')?.addEventListener('input', sincronizarCamposBasicosObjetivoAdmin);
    document.getElementById('admin-target-mejora-legendaria')?.addEventListener('input', sincronizarCamposBasicosObjetivoAdmin);
    obtenerClavesSobreInventarioAdmin().forEach((key) => {
        document.getElementById(`admin-target-${key}`)?.addEventListener('input', sincronizarCamposBasicosObjetivoAdmin);
    });
    document.getElementById('admin-reset-eventos-btn')?.addEventListener('click', adminReiniciarProgresoEventosRotacionActiva);
    document.getElementById('admin-reset-asaltos-btn')?.addEventListener('click', adminReiniciarProgresoAsaltosRotacionActiva);
    document.getElementById('admin-reset-desafios-btn')?.addEventListener('click', adminReiniciarDesafiosCompletados);

    document.getElementById('color-principal-input')?.addEventListener('input', actualizarPreviewColorPrincipal);
    document.getElementById('color-principal-input')?.addEventListener('change', actualizarPreviewColorPrincipal);
    document.getElementById('guardar-color-principal-btn')?.addEventListener('click', guardarColorPrincipal);
    document.getElementById('restablecer-color-principal-btn')?.addEventListener('click', restablecerColorPrincipal);
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
    adminPanel.style.display = esCuentaAdminActual() ? 'flex' : 'none';
}

function esCuentaAdminActual() {
    const emailSesion = String(emailActual || '').trim().toLowerCase();
    const emailUsuario = String(usuarioActual?.email || '').trim().toLowerCase();
    return emailSesion === 'lorenzopablo93@gmail.com' || emailUsuario === 'lorenzopablo93@gmail.com';
}

async function inicializarAdminGestionUsuarios() {
    if (!esCuentaAdminActual()) return;
    await cargarUsuariosRegistradosAdmin();
    poblarCatalogoCartasAdmin();
}

function normalizarCanalRgb(valor, fallback = 0) {
    const numero = Number.parseInt(String(valor ?? ''), 10);
    if (!Number.isFinite(numero)) {
        return Math.min(255, Math.max(0, Number.parseInt(String(fallback ?? 0), 10) || 0));
    }
    return Math.min(255, Math.max(0, numero));
}

function obtenerColorPrincipalUsuario() {
    const color = usuarioActual?.preferencias?.colorPrincipal;
    if (!color || typeof color !== 'object') {
        return { ...COLOR_PRINCIPAL_DEFAULT };
    }
    return {
        r: normalizarCanalRgb(color.r, COLOR_PRINCIPAL_DEFAULT.r),
        g: normalizarCanalRgb(color.g, COLOR_PRINCIPAL_DEFAULT.g),
        b: normalizarCanalRgb(color.b, COLOR_PRINCIPAL_DEFAULT.b)
    };
}

function renderizarColorPrincipalUI() {
    const color = obtenerColorPrincipalUsuario();
    const colorInput = document.getElementById('color-principal-input');
    if (colorInput) {
        colorInput.value = rgbAHex(color.r, color.g, color.b);
    }
    actualizarPreviewColorPrincipal();
}

function rgbAHex(r, g, b) {
    const canalAHex = (canal) => normalizarCanalRgb(canal).toString(16).padStart(2, '0');
    return `#${canalAHex(r)}${canalAHex(g)}${canalAHex(b)}`;
}

function hexAColor(hex) {
    const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
    if (!match) {
        return { ...COLOR_PRINCIPAL_DEFAULT };
    }
    return {
        r: normalizarCanalRgb(Number.parseInt(match[1], 16), COLOR_PRINCIPAL_DEFAULT.r),
        g: normalizarCanalRgb(Number.parseInt(match[2], 16), COLOR_PRINCIPAL_DEFAULT.g),
        b: normalizarCanalRgb(Number.parseInt(match[3], 16), COLOR_PRINCIPAL_DEFAULT.b)
    };
}

function obtenerColorDesdeInputs() {
    const colorInput = document.getElementById('color-principal-input');
    return hexAColor(colorInput?.value || '');
}

function aplicarColorPrincipalEnVista(color) {
    if (typeof window.aplicarColorPrincipalUsuario === 'function') {
        window.aplicarColorPrincipalUsuario(color);
    }
}

function actualizarPreviewColorPrincipal() {
    const color = obtenerColorDesdeInputs();
    const preview = document.getElementById('color-principal-preview');
    const texto = document.getElementById('color-principal-rgb-texto');
    const valorRgb = `rgb(${color.r}, ${color.g}, ${color.b})`;
    if (preview) {
        preview.style.background = valorRgb;
        preview.style.boxShadow = `0 0 16px rgba(${color.r}, ${color.g}, ${color.b}, 0.55)`;
    }
    if (texto) {
        texto.textContent = valorRgb;
    }
    aplicarColorPrincipalEnVista(color);
}

async function guardarColorPrincipal() {
    const color = obtenerColorDesdeInputs();
    usuarioActual.preferencias = (usuarioActual.preferencias && typeof usuarioActual.preferencias === 'object')
        ? usuarioActual.preferencias
        : {};
    usuarioActual.preferencias.colorPrincipal = color;
    aplicarColorPrincipalEnVista(color);
    await persistirUsuario('Color principal actualizado correctamente.');
}

async function restablecerColorPrincipal() {
    const color = { ...COLOR_PRINCIPAL_DEFAULT };
    const colorInput = document.getElementById('color-principal-input');
    if (colorInput) colorInput.value = rgbAHex(color.r, color.g, color.b);
    usuarioActual.preferencias = (usuarioActual.preferencias && typeof usuarioActual.preferencias === 'object')
        ? usuarioActual.preferencias
        : {};
    usuarioActual.preferencias.colorPrincipal = color;
    actualizarPreviewColorPrincipal();
    await persistirUsuario('Color principal restablecido al valor por defecto.');
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
    usuarioActual.objetos = { mejoraCarta: 0, mejoraEspecial: 0, mejoraSuprema: 0, mejoraDefinitiva: 0 };
    if (typeof window.DC_SOBRES_MEZCLAR_INVENTARIO === 'function') {
        usuarioActual.objetos = window.DC_SOBRES_MEZCLAR_INVENTARIO(usuarioActual.objetos);
    }
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
    const nivelNormalizado = Math.min(Math.max(Number(nivelObjetivo || 1), 1), ADMIN_NIVEL_CARTA_MAX);
    const nivelActual = Math.max(1, Number(carta.Nivel || 1));
    const poderActual = Number(carta.Poder || 0);
    const saludActualBase = Number(carta.SaludMax ?? carta.Salud ?? carta.Poder ?? 0);
    const poderBaseNivel1 = Math.max(0, poderActual - ((nivelActual - 1) * 500));
    const saludBaseNivel1 = Math.max(1, saludActualBase - ((nivelActual - 1) * 500));
    const poderEscalado = poderBaseNivel1 + ((nivelNormalizado - 1) * 500);
    const saludEscalada = saludBaseNivel1 + ((nivelNormalizado - 1) * 500);
    const cartaEscalada = {
        ...carta,
        Nivel: nivelNormalizado,
        Poder: Math.max(0, poderEscalado),
        SaludMax: Math.max(1, saludEscalada),
        Salud: Math.max(1, saludEscalada)
    };
    if (typeof window.recalcularSkillPowerPorNivel === 'function') {
        window.recalcularSkillPowerPorNivel(cartaEscalada, nivelNormalizado, { rawEsBase: true });
    }
    return cartaEscalada;
}

async function adminMejorarTodasCartas() {
    const nivel = Math.min(Math.max(Number(document.getElementById('admin-nivel-cartas').value || 1), 1), ADMIN_NIVEL_CARTA_MAX);
    usuarioActual.cartas = (usuarioActual.cartas || []).map(carta => escalarCartaANivel(carta, nivel));
    await persistirUsuario(`Todas tus cartas se han ajustado a nivel ${nivel}.`, 'success');
}

function obtenerClavesSobreInventarioAdmin() {
    if (typeof window.DC_SOBRES_KEYS_INVENTARIO === 'function') {
        const keys = window.DC_SOBRES_KEYS_INVENTARIO();
        if (Array.isArray(keys) && keys.length > 0) {
            return keys;
        }
    }
    return ['sobreH1', 'sobreH2', 'sobreH3', 'sobreV1', 'sobreV2', 'sobreV3'];
}

function poblarCatalogoCartasAdmin() {
    const selector = document.getElementById('admin-card-catalog-select');
    if (!selector) return;
    selector.innerHTML = '';
    const optionVacia = document.createElement('option');
    optionVacia.value = '';
    optionVacia.textContent = 'Selecciona carta para agregar';
    selector.appendChild(optionVacia);
    [...catalogoCartas]
        .sort((a, b) => String(a?.Nombre || '').localeCompare(String(b?.Nombre || '')))
        .forEach((carta) => {
            const option = document.createElement('option');
            option.value = String(carta?.Nombre || '');
            option.textContent = String(carta?.Nombre || '(Sin nombre)');
            selector.appendChild(option);
        });
}

function normalizarUsuarioObjetivoAdmin() {
    if (!adminUsuarioObjetivo || typeof adminUsuarioObjetivo !== 'object') return;
    adminUsuarioObjetivo.puntos = Math.max(0, Math.floor(Number(adminUsuarioObjetivo.puntos || 0)));
    adminUsuarioObjetivo.objetos = (adminUsuarioObjetivo.objetos && typeof adminUsuarioObjetivo.objetos === 'object')
        ? adminUsuarioObjetivo.objetos
        : {};
    if (typeof window.DC_SOBRES_MEZCLAR_INVENTARIO === 'function') {
        adminUsuarioObjetivo.objetos = window.DC_SOBRES_MEZCLAR_INVENTARIO(adminUsuarioObjetivo.objetos);
    }
    adminUsuarioObjetivo.objetos.mejoraCarta = Math.max(0, Math.floor(Number(adminUsuarioObjetivo.objetos.mejoraCarta || 0)));
    adminUsuarioObjetivo.objetos.mejoraEspecial = Math.max(0, Math.floor(Number(adminUsuarioObjetivo.objetos.mejoraEspecial || 0)));
    adminUsuarioObjetivo.objetos.mejoraSuprema = Math.max(0, Math.floor(Number(adminUsuarioObjetivo.objetos.mejoraSuprema || 0)));
    adminUsuarioObjetivo.objetos.mejoraDefinitiva = Math.max(0, Math.floor(Number(adminUsuarioObjetivo.objetos.mejoraDefinitiva || 0)));
    adminUsuarioObjetivo.objetos.mejoraElite = Math.max(0, Math.floor(Number(adminUsuarioObjetivo.objetos.mejoraElite || 0)));
    adminUsuarioObjetivo.objetos.mejoraLegendaria = Math.max(0, Math.floor(Number(adminUsuarioObjetivo.objetos.mejoraLegendaria || 0)));
    obtenerClavesSobreInventarioAdmin().forEach((key) => {
        adminUsuarioObjetivo.objetos[key] = Math.max(0, Math.floor(Number(adminUsuarioObjetivo.objetos[key] || 0)));
    });
    adminUsuarioObjetivo.cartas = Array.isArray(adminUsuarioObjetivo.cartas) ? adminUsuarioObjetivo.cartas : [];
}

function renderizarCamposBasicosObjetivoAdmin() {
    const puntosEl = document.getElementById('admin-target-puntos');
    const mejoraEl = document.getElementById('admin-target-mejora');
    const mejoraEspEl = document.getElementById('admin-target-mejora-especial');
    const mejoraSupremaEl = document.getElementById('admin-target-mejora-suprema');
    const mejoraDefinitivaEl = document.getElementById('admin-target-mejora-definitiva');
    const mejoraEliteEl = document.getElementById('admin-target-mejora-elite');
    const mejoraLegendariaEl = document.getElementById('admin-target-mejora-legendaria');
    if (!adminUsuarioObjetivo) {
        if (puntosEl) puntosEl.value = '0';
        if (mejoraEl) mejoraEl.value = '0';
        if (mejoraEspEl) mejoraEspEl.value = '0';
        if (mejoraSupremaEl) mejoraSupremaEl.value = '0';
        if (mejoraDefinitivaEl) mejoraDefinitivaEl.value = '0';
        if (mejoraEliteEl) mejoraEliteEl.value = '0';
        if (mejoraLegendariaEl) mejoraLegendariaEl.value = '0';
        obtenerClavesSobreInventarioAdmin().forEach((key) => {
            const el = document.getElementById(`admin-target-${key}`);
            if (el) el.value = '0';
        });
        return;
    }
    normalizarUsuarioObjetivoAdmin();
    if (puntosEl) puntosEl.value = String(adminUsuarioObjetivo.puntos || 0);
    if (mejoraEl) mejoraEl.value = String(adminUsuarioObjetivo.objetos.mejoraCarta || 0);
    if (mejoraEspEl) mejoraEspEl.value = String(adminUsuarioObjetivo.objetos.mejoraEspecial || 0);
    if (mejoraSupremaEl) mejoraSupremaEl.value = String(adminUsuarioObjetivo.objetos.mejoraSuprema || 0);
    if (mejoraDefinitivaEl) mejoraDefinitivaEl.value = String(adminUsuarioObjetivo.objetos.mejoraDefinitiva || 0);
    if (mejoraEliteEl) mejoraEliteEl.value = String(adminUsuarioObjetivo.objetos.mejoraElite || 0);
    if (mejoraLegendariaEl) mejoraLegendariaEl.value = String(adminUsuarioObjetivo.objetos.mejoraLegendaria || 0);
    obtenerClavesSobreInventarioAdmin().forEach((key) => {
        const el = document.getElementById(`admin-target-${key}`);
        if (el) el.value = String(adminUsuarioObjetivo.objetos[key] || 0);
    });
}

function sincronizarCamposBasicosObjetivoAdmin() {
    if (!adminUsuarioObjetivo) return;
    const puntosEl = document.getElementById('admin-target-puntos');
    const mejoraEl = document.getElementById('admin-target-mejora');
    const mejoraEspEl = document.getElementById('admin-target-mejora-especial');
    const mejoraSupremaEl = document.getElementById('admin-target-mejora-suprema');
    const mejoraDefinitivaEl = document.getElementById('admin-target-mejora-definitiva');
    const mejoraEliteEl = document.getElementById('admin-target-mejora-elite');
    const mejoraLegendariaEl = document.getElementById('admin-target-mejora-legendaria');
    adminUsuarioObjetivo.puntos = Math.max(0, Math.floor(Number(puntosEl?.value || 0)));
    adminUsuarioObjetivo.objetos = (adminUsuarioObjetivo.objetos && typeof adminUsuarioObjetivo.objetos === 'object')
        ? adminUsuarioObjetivo.objetos
        : {};
    adminUsuarioObjetivo.objetos.mejoraCarta = Math.max(0, Math.floor(Number(mejoraEl?.value || 0)));
    adminUsuarioObjetivo.objetos.mejoraEspecial = Math.max(0, Math.floor(Number(mejoraEspEl?.value || 0)));
    adminUsuarioObjetivo.objetos.mejoraSuprema = Math.max(0, Math.floor(Number(mejoraSupremaEl?.value || 0)));
    adminUsuarioObjetivo.objetos.mejoraDefinitiva = Math.max(0, Math.floor(Number(mejoraDefinitivaEl?.value || 0)));
    adminUsuarioObjetivo.objetos.mejoraElite = Math.max(0, Math.floor(Number(mejoraEliteEl?.value || 0)));
    adminUsuarioObjetivo.objetos.mejoraLegendaria = Math.max(0, Math.floor(Number(mejoraLegendariaEl?.value || 0)));
    obtenerClavesSobreInventarioAdmin().forEach((key) => {
        const el = document.getElementById(`admin-target-${key}`);
        adminUsuarioObjetivo.objetos[key] = Math.max(0, Math.floor(Number(el?.value || 0)));
    });
}

async function cargarUsuariosRegistradosAdmin() {
    const selector = document.getElementById('admin-user-select');
    if (!selector) return;
    try {
        const response = await fetch('/admin/users/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requesterEmail: emailActual })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.mensaje || 'No se pudo cargar usuarios');
        }
        adminUsuariosRegistrados = Array.isArray(data?.usuarios) ? data.usuarios : [];
        selector.innerHTML = '';
        const vacio = document.createElement('option');
        vacio.value = '';
        vacio.textContent = 'Selecciona un usuario';
        selector.appendChild(vacio);
        adminUsuariosRegistrados.forEach((u) => {
            const opt = document.createElement('option');
            opt.value = String(u.email || '');
            opt.textContent = `${u.nickname || u.email} (${u.email})`;
            selector.appendChild(opt);
        });
    } catch (error) {
        console.error(error);
        mostrarMensaje('No se pudo cargar la lista de usuarios.', 'danger');
    }
}

async function cargarUsuarioObjetivoAdmin() {
    const selector = document.getElementById('admin-user-select');
    const targetEmail = String(selector?.value || '').trim().toLowerCase();
    if (!targetEmail) {
        mostrarMensaje('Selecciona un usuario primero.', 'warning');
        return;
    }
    try {
        const response = await fetch('/admin/user/get', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requesterEmail: emailActual, targetEmail })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.mensaje || 'No se pudo cargar el usuario');
        }
        adminUsuarioObjetivoEmail = targetEmail;
        adminUsuarioObjetivo = data?.usuario || null;
        adminCartaObjetivoIndex = -1;
        adminBusquedaCartas = '';
        const searchInput = document.getElementById('admin-card-search-input');
        if (searchInput) searchInput.value = '';
        renderizarCamposBasicosObjetivoAdmin();
        renderizarCartasAdminObjetivo();
        mostrarMensaje(`Usuario cargado: ${targetEmail}`, 'success');
    } catch (error) {
        console.error(error);
        mostrarMensaje('No se pudo cargar el usuario objetivo.', 'danger');
    }
}

function crearCartaAdminDesdeCatalogo(cartaCatalogo, nivelObjetivo = 1) {
    const nivel = Math.min(Math.max(Number(nivelObjetivo || 1), 1), ADMIN_NIVEL_CARTA_MAX);
    const base = {
        ...cartaCatalogo,
        Nivel: 1,
        Poder: Number(cartaCatalogo?.Poder || 0),
        SaludMax: Number(cartaCatalogo?.SaludMax || cartaCatalogo?.Salud || cartaCatalogo?.Poder || 1),
        Salud: Number(cartaCatalogo?.Salud || cartaCatalogo?.SaludMax || cartaCatalogo?.Poder || 1)
    };
    return escalarCartaANivel(base, nivel);
}

function crearCardAdminElemento(carta, indexReal) {
    const card = document.createElement('div');
    card.className = `admin-card-item ${adminCartaObjetivoIndex === indexReal ? 'selected' : ''}`;

    const visual = document.createElement('div');
    visual.className = 'admin-card-visual';
    const img = String(carta?.Imagen_final || carta?.Imagen || carta?.imagen || '').trim();
    visual.style.backgroundImage = `url(${img || 'img/default-image.jpg'})`;

    const estrellasDiv = document.createElement('div');
    estrellasDiv.className = 'estrellas-carta';
    const nivel = Math.min(ADMIN_NIVEL_CARTA_MAX, Math.max(Number(carta?.Nivel || 1), 1));
    const cartaNivelUi = { ...carta, Nivel: nivel };
    if (typeof window.dcRellenarEstrellasCartaCompleta === 'function') {
        window.dcRellenarEstrellasCartaCompleta(estrellasDiv, cartaNivelUi);
    } else {
        const nVis = Math.min(nivel, 6);
        for (let i = 0; i < nVis; i += 1) {
            const estrella = document.createElement('img');
            estrella.className = 'estrella';
            estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
            estrella.alt = 'star';
            estrellasDiv.appendChild(estrella);
        }
    }
    visual.appendChild(estrellasDiv);
    if (typeof window.dcAplicarClasesNivelCartaCompleta === 'function') {
        window.dcAplicarClasesNivelCartaCompleta(visual, cartaNivelUi);
    }

    const habilidad = String(carta?.SkillName || carta?.NombreHabilidad || '').trim();
    const saludMax = Number(carta?.SaludMax || carta?.Salud || 0);
    const saludAct = Number(carta?.Salud || saludMax || 0);
    const overlay = document.createElement('div');
    overlay.className = 'admin-card-overlay';
    overlay.innerHTML = `
        <span class="admin-card-name">${String(carta?.Nombre || '(Sin nombre)')}</span>
        <span class="admin-card-meta">Nivel ${nivel} | Poder ${Number(carta?.Poder || 0)}</span>
        <span class="admin-card-meta">Salud ${Math.max(0, saludAct)}/${Math.max(0, saludMax)}</span>
        <span class="admin-card-meta">${habilidad ? `Hab: ${habilidad}` : 'Sin habilidad'}</span>
    `;
    visual.appendChild(overlay);
    card.appendChild(visual);

    const badgeHabilidad = window.crearBadgeHabilidadCarta ? window.crearBadgeHabilidadCarta(carta) : null;
    if (badgeHabilidad) card.appendChild(badgeHabilidad);
    const badgeAfiliacion = window.crearBadgeAfiliacionCarta ? window.crearBadgeAfiliacionCarta(carta) : null;
    if (badgeAfiliacion) card.appendChild(badgeAfiliacion);

    card.addEventListener('click', () => {
        adminCartaObjetivoIndex = indexReal;
        renderizarCartasAdminObjetivo();
    });
    return card;
}

function renderizarCartasAdminObjetivo() {
    const grid = document.getElementById('admin-cards-grid');
    const summary = document.getElementById('admin-card-summary');
    if (!grid) return;
    grid.innerHTML = '';
    if (!adminUsuarioObjetivo) {
        if (summary) summary.textContent = 'Cartas: 0';
        return;
    }
    normalizarUsuarioObjetivoAdmin();
    const cartas = adminUsuarioObjetivo.cartas;
    const filtradas = cartas
        .map((carta, index) => ({ carta, index }))
        .filter(({ carta }) => {
            if (!adminBusquedaCartas) return true;
            return normalizarNombre(carta?.Nombre).includes(adminBusquedaCartas);
        });
    filtradas.forEach(({ carta, index }) => {
        grid.appendChild(crearCardAdminElemento(carta, index));
    });
    if (summary) {
        summary.textContent = `Cartas: ${cartas.length} | Mostrando: ${filtradas.length}`;
    }
}

function adminAgregarCartaObjetivo() {
    if (!adminUsuarioObjetivo) {
        mostrarMensaje('Carga primero un usuario objetivo.', 'warning');
        return;
    }
    const selector = document.getElementById('admin-card-catalog-select');
    const nombre = String(selector?.value || '').trim();
    if (!nombre) {
        mostrarMensaje('Selecciona una carta del catálogo.', 'warning');
        return;
    }
    const cartaCatalogo = catalogoCartas.find((c) => String(c?.Nombre || '').trim() === nombre);
    if (!cartaCatalogo) {
        mostrarMensaje('No se encontró esa carta en catálogo.', 'danger');
        return;
    }
    adminUsuarioObjetivo.cartas.push(crearCartaAdminDesdeCatalogo(cartaCatalogo, 1));
    adminCartaObjetivoIndex = adminUsuarioObjetivo.cartas.length - 1;
    renderizarCartasAdminObjetivo();
}

function adminEliminarCartaObjetivo() {
    if (!adminUsuarioObjetivo || adminCartaObjetivoIndex < 0) {
        mostrarMensaje('Selecciona una carta para eliminar.', 'warning');
        return;
    }
    if (!Array.isArray(adminUsuarioObjetivo.cartas) || !adminUsuarioObjetivo.cartas[adminCartaObjetivoIndex]) {
        return;
    }
    adminUsuarioObjetivo.cartas.splice(adminCartaObjetivoIndex, 1);
    adminCartaObjetivoIndex = -1;
    renderizarCartasAdminObjetivo();
}

function adminCambiarNivelCartaObjetivo(delta) {
    if (!adminUsuarioObjetivo || adminCartaObjetivoIndex < 0) {
        mostrarMensaje('Selecciona una carta para modificar nivel.', 'warning');
        return;
    }
    const carta = adminUsuarioObjetivo.cartas[adminCartaObjetivoIndex];
    if (!carta) return;
    const nivelActual = Math.min(ADMIN_NIVEL_CARTA_MAX, Math.max(Number(carta.Nivel || 1), 1));
    const nuevoNivel = Math.min(Math.max(nivelActual + Number(delta || 0), 1), ADMIN_NIVEL_CARTA_MAX);
    adminUsuarioObjetivo.cartas[adminCartaObjetivoIndex] = escalarCartaANivel(carta, nuevoNivel);
    renderizarCartasAdminObjetivo();
}

function adminReiniciarProgresoEventosRotacionActiva() {
    if (!adminUsuarioObjetivo) {
        mostrarMensaje('Carga primero un usuario objetivo.', 'warning');
        return;
    }
    if (!window.confirm('¿Reiniciar eventos VS BOT y eventos cooperativos online ya completados en la rotación actual (ventana de 1 h)? Los demás periodos no se modifican.')) {
        return;
    }
    const prev = (adminUsuarioObjetivo.eventosJugadosPorRotacion && typeof adminUsuarioObjetivo.eventosJugadosPorRotacion === 'object')
        ? { ...adminUsuarioObjetivo.eventosJugadosPorRotacion }
        : {};
    adminClavesRotacionEventosActivas().forEach((k) => {
        delete prev[k];
    });
    adminUsuarioObjetivo.eventosJugadosPorRotacion = prev;
    mostrarMensaje('Progreso de eventos de la rotación actual borrado en memoria. Pulsa «Guardar en Firebase» para persistir.', 'success');
}

function adminReiniciarProgresoAsaltosRotacionActiva() {
    if (!adminUsuarioObjetivo) {
        mostrarMensaje('Carga primero un usuario objetivo.', 'warning');
        return;
    }
    if (!window.confirm('¿Reiniciar todos los asaltos completados de la semana en curso (lunes–domingo local)? Otras semanas guardadas no se modifican.')) {
        return;
    }
    const k = adminClaveRotacionAsaltosActual();
    const prev = (adminUsuarioObjetivo.asaltosCompletadosPorRotacion && typeof adminUsuarioObjetivo.asaltosCompletadosPorRotacion === 'object')
        ? { ...adminUsuarioObjetivo.asaltosCompletadosPorRotacion }
        : {};
    delete prev[k];
    adminUsuarioObjetivo.asaltosCompletadosPorRotacion = prev;
    mostrarMensaje('Progreso de asaltos de la semana actual borrado en memoria. Pulsa «Guardar en Firebase» para persistir.', 'success');
}

function adminReiniciarDesafiosCompletados() {
    if (!adminUsuarioObjetivo) {
        mostrarMensaje('Carga primero un usuario objetivo.', 'warning');
        return;
    }
    if (!window.confirm('¿Borrar todas las listas de desafíos completados (formato clásico y V2)?')) {
        return;
    }
    adminUsuarioObjetivo.desafiosCompletados = [];
    adminUsuarioObjetivo.desafiosCompletadosV2 = [];
    mostrarMensaje('Desafíos completados reiniciados en memoria. Pulsa «Guardar en Firebase» para persistir.', 'success');
}

async function guardarUsuarioObjetivoAdmin() {
    if (!adminUsuarioObjetivo || !adminUsuarioObjetivoEmail) {
        mostrarMensaje('No hay usuario objetivo cargado.', 'warning');
        return;
    }
    sincronizarCamposBasicosObjetivoAdmin();
    try {
        const response = await fetch('/admin/user/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                requesterEmail: emailActual,
                targetEmail: adminUsuarioObjetivoEmail,
                usuario: adminUsuarioObjetivo
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 409 && data?.usuario) {
                adminUsuarioObjetivo = data.usuario;
                renderizarCamposBasicosObjetivoAdmin();
                renderizarCartasAdminObjetivo();
            }
            throw new Error(data?.mensaje || 'No se pudo guardar usuario objetivo');
        }
        adminUsuarioObjetivo = data?.usuario || adminUsuarioObjetivo;
        renderizarCamposBasicosObjetivoAdmin();
        renderizarCartasAdminObjetivo();
        if (normalizarNombre(adminUsuarioObjetivoEmail) === normalizarNombre(emailActual)) {
            usuarioActual = adminUsuarioObjetivo;
            localStorage.setItem('usuario', JSON.stringify(usuarioActual));
            renderizarPerfil();
            renderizarColorPrincipalUI();
            window.dispatchEvent(new Event('dc:usuario-actualizado'));
        }
        mostrarMensaje('Cambios guardados correctamente en Firebase.', 'success');
    } catch (error) {
        console.error(error);
        mostrarMensaje('No se pudieron guardar los cambios del usuario objetivo.', 'danger');
    }
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
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 409 && data?.usuario) {
                localStorage.setItem('usuario', JSON.stringify(data.usuario));
                usuarioActual = data.usuario;
                window.dispatchEvent(new Event('dc:usuario-actualizado'));
            }
            throw new Error(data?.mensaje || 'Error al actualizar los datos de usuario.');
        }
        if (data?.usuario) {
            usuarioActual = data.usuario;
        }

        localStorage.setItem('usuario', JSON.stringify(usuarioActual));
        window.dispatchEvent(new Event('dc:usuario-actualizado'));
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
