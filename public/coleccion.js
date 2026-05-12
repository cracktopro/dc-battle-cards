let faccionColeccionActiva = 'H';
/** `'cartas'` | `'sobres'` */
let vistaColeccionActiva = 'cartas';
let todasLasCartasCatalogo = [];
let nombresCartasConseguidas = new Set();
let busquedaColeccion = '';
let afiliacionFiltroActiva = 'todas';
let ordenarPorPoderActivo = false;
let mapaCatalogo = new Map();
let mapaMejorVersionUsuario = new Map();

document.addEventListener('DOMContentLoaded', function () {
    configurarTabsColeccion();
    configurarFiltrosColeccion();
    configurarModalAperturaSobre();
    cargarColeccion();
});

function normalizarFaccion(valor) {
    const faccion = String(valor || '').trim().toUpperCase();
    return faccion === 'H' || faccion === 'V' ? faccion : '';
}

function normalizarAfiliacion(valor) {
    return String(valor || '').trim().toLowerCase();
}

function obtenerClaveCarta(nombre) {
    return String(nombre || '').trim().toLowerCase();
}

function obtenerFaccionCarta(carta) {
    return normalizarFaccion(carta?.faccion || carta?.Faccion || '');
}

function obtenerAfiliacionCarta(carta) {
    return String(carta?.Afiliacion || carta?.afiliacion || '').trim();
}

function obtenerAfiliacionesCarta(carta) {
    const raw = obtenerAfiliacionCarta(carta);
    if (!raw) {
        return [];
    }
    return raw.split(';').map(item => item.trim()).filter(Boolean);
}

function configurarTabsColeccion() {
    const btnSobres = document.getElementById('tab-coleccion-sobres');
    const btnHeroes = document.getElementById('tab-coleccion-heroes');
    const btnVillanos = document.getElementById('tab-coleccion-villanos');

    btnSobres?.addEventListener('click', function () {
        vistaColeccionActiva = 'sobres';
        if (window.DCRedDot && typeof window.DCRedDot.markPacksSeen === 'function') {
            window.DCRedDot.markPacksSeen();
        }
        actualizarTabsColeccion();
        actualizarIndicadorNuevoSobres();
        actualizarVisibilidadFiltrosCartas();
        renderizarVistaColeccion();
    });

    btnHeroes?.addEventListener('click', function () {
        vistaColeccionActiva = 'cartas';
        faccionColeccionActiva = 'H';
        actualizarTabsColeccion();
        actualizarIndicadorNuevoSobres();
        actualizarSelectorAfiliacionColeccion();
        actualizarVisibilidadFiltrosCartas();
        renderizarVistaColeccion();
    });

    btnVillanos?.addEventListener('click', function () {
        vistaColeccionActiva = 'cartas';
        faccionColeccionActiva = 'V';
        actualizarTabsColeccion();
        actualizarIndicadorNuevoSobres();
        actualizarSelectorAfiliacionColeccion();
        actualizarVisibilidadFiltrosCartas();
        renderizarVistaColeccion();
    });
}

function actualizarIndicadorNuevoSobres() {
    const tab = document.getElementById('tab-coleccion-sobres');
    if (!tab) {
        return;
    }
    const dotExistente = tab.querySelector('.dc-tab-red-dot-nuevo');
    if (dotExistente) {
        dotExistente.remove();
    }
    const mostrar = Boolean(
        window.DCRedDot
        && typeof window.DCRedDot.hasUnseenPacks === 'function'
        && window.DCRedDot.hasUnseenPacks()
    );
    if (!mostrar) {
        return;
    }
    const badge = document.createElement('span');
    badge.className = 'dc-tab-red-dot-nuevo';
    badge.textContent = 'Nuevo';
    tab.appendChild(badge);
}

function configurarFiltrosColeccion() {
    const inputBusqueda = document.getElementById('busqueda-coleccion');
    const selectorAfiliacion = document.getElementById('selector-afiliacion-coleccion');
    const toggleOrdenPoder = document.getElementById('ordenar-poder-coleccion');

    inputBusqueda?.addEventListener('input', function () {
        busquedaColeccion = String(this.value || '').trim().toLowerCase();
        renderizarVistaColeccion();
    });

    selectorAfiliacion?.addEventListener('change', function () {
        afiliacionFiltroActiva = normalizarAfiliacion(this.value || 'todas') || 'todas';
        renderizarVistaColeccion();
    });

    toggleOrdenPoder?.addEventListener('change', function () {
        ordenarPorPoderActivo = Boolean(this.checked);
        renderizarVistaColeccion();
    });
}

function actualizarTabsColeccion() {
    document.getElementById('tab-coleccion-sobres')?.classList.toggle(
        'active',
        vistaColeccionActiva === 'sobres'
    );
    document.getElementById('tab-coleccion-heroes')?.classList.toggle(
        'active',
        vistaColeccionActiva === 'cartas' && faccionColeccionActiva === 'H'
    );
    document.getElementById('tab-coleccion-villanos')?.classList.toggle(
        'active',
        vistaColeccionActiva === 'cartas' && faccionColeccionActiva === 'V'
    );

    const indicador = document.getElementById('faccion-coleccion-actual');
    if (indicador) {
        if (vistaColeccionActiva === 'sobres') {
            indicador.textContent = 'Vista actual: Sobres de cartas';
        } else {
            indicador.textContent = `Vista actual: ${faccionColeccionActiva === 'H' ? 'Héroes' : 'Villanos'}`;
        }
    }
}

function actualizarVisibilidadFiltrosCartas() {
    const barra = document.getElementById('coleccion-barra-filtros');
    if (!barra) {
        return;
    }
    barra.style.display = vistaColeccionActiva === 'cartas' ? 'flex' : 'none';
}

function sincronizarEstadoUsuarioColeccionDesdeLs() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
    const cartasUsuario = usuario && Array.isArray(usuario.cartas) ? usuario.cartas : [];
    nombresCartasConseguidas = new Set(
        cartasUsuario
            .map(carta => obtenerClaveCarta(carta?.Nombre))
            .filter(Boolean)
    );
    mapaMejorVersionUsuario = construirMapaMejorVersionUsuario(cartasUsuario);
}

/**
 * Actualiza los tres contadores (total, héroes, villanos) frente al catálogo cargado.
 */
function actualizarTextosProgresoColeccion() {
    const elTotal = document.getElementById('progreso-coleccion-total');
    const elH = document.getElementById('progreso-coleccion-heroes');
    const elV = document.getElementById('progreso-coleccion-villanos');
    if (!elTotal || !elH || !elV) {
        return;
    }

    const nCat = todasLasCartasCatalogo.length;
    const ownedAll = nombresCartasConseguidas.size;
    elTotal.textContent = nCat > 0 ? `${ownedAll}/${nCat}` : '0/0';

    const heroesCat = todasLasCartasCatalogo.filter(carta => obtenerFaccionCarta(carta) === 'H');
    const villCat = todasLasCartasCatalogo.filter(carta => obtenerFaccionCarta(carta) === 'V');
    const setHero = new Set(heroesCat.map(carta => obtenerClaveCarta(carta.Nombre)));
    const setVill = new Set(villCat.map(carta => obtenerClaveCarta(carta.Nombre)));

    let ownedH = 0;
    let ownedV = 0;
    nombresCartasConseguidas.forEach((clave) => {
        if (setHero.has(clave)) {
            ownedH += 1;
        }
        if (setVill.has(clave)) {
            ownedV += 1;
        }
    });

    const nh = heroesCat.length;
    const nv = villCat.length;
    elH.textContent = nh > 0 ? `${ownedH}/${nh}` : '0/0';
    elV.textContent = nv > 0 ? `${ownedV}/${nv}` : '0/0';
}

function deduplicarCatalogoPorNombre(cartas) {
    const mapa = new Map();
    (Array.isArray(cartas) ? cartas : []).forEach((carta) => {
        const clave = obtenerClaveCarta(carta?.Nombre);
        if (!clave) return;
        const actual = mapa.get(clave);
        if (!actual) {
            mapa.set(clave, { ...carta });
            return;
        }
        const nivelNuevo = Number(carta?.Nivel || 1);
        const poderNuevo = Number(carta?.Poder || 0);
        const nivelActual = Number(actual?.Nivel || 1);
        const poderActual = Number(actual?.Poder || 0);
        if (nivelNuevo > nivelActual || (nivelNuevo === nivelActual && poderNuevo > poderActual)) {
            mapa.set(clave, { ...carta });
        }
    });
    return Array.from(mapa.values());
}

async function cargarColeccion() {
    try {
        sincronizarEstadoUsuarioColeccionDesdeLs();

        const catalogoExcel = await cargarCatalogoExcel();

        const catalogoSinDuplicados = deduplicarCatalogoPorNombre(catalogoExcel);

        mapaCatalogo = new Map();
        catalogoSinDuplicados.forEach(carta => {
            mapaCatalogo.set(obtenerClaveCarta(carta.Nombre), {
                faccion: obtenerFaccionCarta(carta),
                Afiliacion: obtenerAfiliacionCarta(carta),
                Imagen: carta.Imagen || carta.imagen || '',
                imagen_final: carta.imagen_final || ''
            });
        });

        // Usar Excel como fuente única evita depender de rutas backend no existentes.
        todasLasCartasCatalogo = catalogoSinDuplicados.map(carta => ({
            ...carta,
            faccion: obtenerFaccionCarta(carta),
            Afiliacion: obtenerAfiliacionCarta(carta),
            Imagen: carta.Imagen || carta.imagen || '',
            imagen_final: carta.imagen_final || ''
        }));

        actualizarTextosProgresoColeccion();
        actualizarTabsColeccion();
        actualizarIndicadorNuevoSobres();
        actualizarVisibilidadFiltrosCartas();
        actualizarSelectorAfiliacionColeccion();
        renderizarVistaColeccion();
    } catch (error) {
        console.error('Error al cargar la colección de cartas:', error);
    }
}

function construirMapaMejorVersionUsuario(cartasUsuario) {
    const mapa = new Map();

    (Array.isArray(cartasUsuario) ? cartasUsuario : []).forEach(carta => {
        const clave = obtenerClaveCarta(carta?.Nombre);
        if (!clave) {
            return;
        }

        const actual = mapa.get(clave);
        const nivelNuevo = Number(carta?.Nivel || 1);
        const poderNuevo = Number(carta?.Poder || 0);

        if (!actual) {
            mapa.set(clave, { ...carta });
            return;
        }

        const nivelActual = Number(actual?.Nivel || 1);
        const poderActual = Number(actual?.Poder || 0);
        if (nivelNuevo > nivelActual || (nivelNuevo === nivelActual && poderNuevo > poderActual)) {
            mapa.set(clave, { ...carta });
        }
    });

    return mapa;
}

async function cargarCatalogoExcel() {
    const response = await fetch('resources/cartas.xlsx');
    if (!response.ok) {
        return [];
    }
    const data = await response.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

function actualizarSelectorAfiliacionColeccion() {
    const selector = document.getElementById('selector-afiliacion-coleccion');
    if (!selector) {
        return;
    }

    const mapa = new Map();
    todasLasCartasCatalogo
        .filter(carta => obtenerFaccionCarta(carta) === faccionColeccionActiva)
        .forEach(carta => {
            obtenerAfiliacionesCarta(carta).forEach(afi => {
                const key = normalizarAfiliacion(afi);
                if (key && !mapa.has(key)) {
                    mapa.set(key, afi);
                }
            });
        });

    const valorPrevio = afiliacionFiltroActiva;
    selector.innerHTML = '';

    const optTodas = document.createElement('option');
    optTodas.value = 'todas';
    optTodas.textContent = 'Todas las afiliaciones';
    selector.appendChild(optTodas);

    Array.from(mapa.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .forEach(([, afiliacion]) => {
            const option = document.createElement('option');
            option.value = afiliacion;
            option.textContent = afiliacion;
            selector.appendChild(option);
        });

    const existePrevio = Array.from(selector.options).some(
        option => normalizarAfiliacion(option.value) === normalizarAfiliacion(valorPrevio)
    );
    afiliacionFiltroActiva = existePrevio ? valorPrevio : 'todas';
    selector.value = afiliacionFiltroActiva;
}

function crearCartaColeccionElemento(carta, estaObtenida) {
    const claveCarta = obtenerClaveCarta(carta?.Nombre);
    const versionJugador = mapaMejorVersionUsuario.get(claveCarta);
    const cartaVisual = estaObtenida && versionJugador
        ? { ...carta, ...versionJugador }
        : carta;
    // En colección, la imagen debe seguir siempre el catálogo (Excel),
    // aunque el usuario tenga una copia persistida con URL anterior.
    cartaVisual.Imagen = carta.Imagen || carta.imagen || '';
    cartaVisual.imagen = carta.imagen || carta.Imagen || '';
    cartaVisual.imagen_final = carta.imagen_final || carta.Imagen_final || '';

    const cartaDiv = document.createElement('div');
    cartaDiv.classList.add('carta', 'carta-coleccion');
    if (Number(cartaVisual.Nivel || 1) >= 6) {
        cartaDiv.classList.add('nivel-legendaria');
    }

    if (!estaObtenida) {
        cartaDiv.classList.add('no-conseguida');
    }

    const imagenUrl = obtenerImagenCarta(cartaVisual);
    cartaDiv.style.backgroundImage = `url(${imagenUrl})`;
    cartaDiv.style.backgroundSize = 'cover';
    cartaDiv.style.backgroundPosition = 'center top';

    const detallesDiv = document.createElement('div');
    detallesDiv.classList.add('detalles-carta');

    const nombreSpan = document.createElement('span');
    nombreSpan.classList.add('nombre-carta');
    nombreSpan.textContent = cartaVisual.Nombre;

    const poderSpan = document.createElement('span');
    poderSpan.classList.add('poder-carta');
    poderSpan.textContent = cartaVisual.Poder;
    if (Number(cartaVisual.Nivel || 1) >= 6) {
        poderSpan.style.color = '#d5b5ff';
    }

    detallesDiv.appendChild(nombreSpan);
    detallesDiv.appendChild(poderSpan);

    const estrellasDiv = document.createElement('div');
    estrellasDiv.classList.add('estrellas-carta');
    const nivel = Number(cartaVisual.Nivel || 1);
    for (let i = 0; i < nivel; i++) {
        const estrella = document.createElement('img');
        estrella.classList.add('estrella');
        estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
        estrella.alt = 'star';
        estrellasDiv.appendChild(estrella);
    }

    const estadoDiv = document.createElement('div');
    estadoDiv.classList.add('estado-coleccion', estaObtenida ? 'obtenida' : 'no-obtenida');
    estadoDiv.textContent = estaObtenida ? 'Obtenida' : 'No conseguida';

    cartaDiv.appendChild(detallesDiv);
    const badgeAfiliacion = window.crearBadgeAfiliacionCarta ? window.crearBadgeAfiliacionCarta(cartaVisual) : null;
    if (badgeAfiliacion) {
        cartaDiv.appendChild(badgeAfiliacion);
    }
    cartaDiv.appendChild(estrellasDiv);
    cartaDiv.appendChild(estadoDiv);
    if (estaObtenida && window.DCRedDot && typeof window.DCRedDot.attachCardBadge === 'function') {
        window.DCRedDot.attachCardBadge(cartaDiv, cartaVisual.Nombre);
    }

    return cartaDiv;
}

function obtenerPoderVisualColeccion(carta) {
    const claveCarta = obtenerClaveCarta(carta?.Nombre);
    const estaObtenida = nombresCartasConseguidas.has(claveCarta);
    const versionJugador = mapaMejorVersionUsuario.get(claveCarta);
    const cartaVisual = estaObtenida && versionJugador
        ? versionJugador
        : carta;
    return Number(cartaVisual?.Poder || 0);
}

function renderizarVistaColeccion() {
    if (vistaColeccionActiva === 'sobres') {
        renderizarPestanyaSobres();
        return;
    }
    renderizarGrillaCartasColeccion();
}

function renderizarGrillaCartasColeccion() {
    const contenedorCartas = document.getElementById('contenedor-cartas');
    contenedorCartas.innerHTML = '';

    const cartasFiltradas = [...todasLasCartasCatalogo]
        .filter(carta => obtenerFaccionCarta(carta) === faccionColeccionActiva)
        .filter(carta => {
            if (!busquedaColeccion) {
                return true;
            }
            return String(carta?.Nombre || '').toLowerCase().includes(busquedaColeccion);
        })
        .filter(carta => {
            if (afiliacionFiltroActiva === 'todas') {
                return true;
            }
            const afiliaciones = obtenerAfiliacionesCarta(carta).map(normalizarAfiliacion);
            return afiliaciones.includes(normalizarAfiliacion(afiliacionFiltroActiva));
        })
        .sort((a, b) => {
            if (ordenarPorPoderActivo) {
                const diffPoder = obtenerPoderVisualColeccion(b) - obtenerPoderVisualColeccion(a);
                if (diffPoder !== 0) {
                    return diffPoder;
                }
            }
            return String(a.Nombre || '').localeCompare(String(b.Nombre || ''));
        });

    cartasFiltradas.forEach(carta => {
        const estaObtenida = nombresCartasConseguidas.has(String(carta?.Nombre || '').toLowerCase());
        contenedorCartas.appendChild(crearCartaColeccionElemento(carta, estaObtenida));
    });
}

/** --- Sobres de cartas (inventario + apertura) --- */

let aperturaSobreEnCurso = false;

function obtenerUsuarioDesdeLsNormalizado() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
    if (!usuario) {
        return null;
    }
    usuario.cartas = Array.isArray(usuario.cartas) ? usuario.cartas : [];
    usuario.puntos = Number(usuario.puntos || 0);
    usuario.objetos = usuario.objetos && typeof usuario.objetos === 'object' ? usuario.objetos : {
        mejoraCarta: 0,
        mejoraEspecial: 0
    };
    usuario.objetos.mejoraCarta = Number(usuario.objetos.mejoraCarta || 0);
    usuario.objetos.mejoraEspecial = Number(usuario.objetos.mejoraEspecial || 0);
    if (typeof window.DC_SOBRES_MEZCLAR_INVENTARIO === 'function') {
        usuario.objetos = window.DC_SOBRES_MEZCLAR_INVENTARIO(usuario.objetos);
    }
    return usuario;
}

function obtenerSaludMaxMini(carta) {
    if (!carta) return 0;
    const saludMax = Number(carta.SaludMax);
    if (Number.isFinite(saludMax) && saludMax > 0) return saludMax;
    const salud = Number(carta.Salud);
    if (Number.isFinite(salud) && salud > 0) return salud;
    return Math.max(Number(carta.Poder || 0), 0);
}

function obtenerSaludActualMini(carta) {
    const saludMax = Math.max(obtenerSaludMaxMini(carta), 0);
    const salud = Number(carta?.Salud);
    const saludValida = Number.isFinite(salud) ? salud : saludMax;
    return Math.max(0, Math.min(saludValida, saludMax));
}

function crearBarraSaludMini(carta) {
    const saludActual = obtenerSaludActualMini(carta);
    const saludMax = Math.max(obtenerSaludMaxMini(carta), 1);
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

function crearTarjetaRevelacionSobre(carta) {
    const nivelNum = Number(carta.Nivel || 1);
    const cartaDiv = document.createElement('div');
    cartaDiv.classList.add('carta', 'apertura-sobre-mini-carta');
    if (nivelNum >= 6) {
        cartaDiv.classList.add('nivel-legendaria', 'apertura-sobre-carta-resplandor-oro');
    }

    const imagenUrl = obtenerImagenCarta(carta);
    cartaDiv.style.backgroundImage = `url(${imagenUrl})`;
    cartaDiv.style.backgroundSize = 'cover';
    cartaDiv.style.backgroundPosition = 'center top';

    const detallesDiv = document.createElement('div');
    detallesDiv.classList.add('detalles-carta');

    const nombreSpan = document.createElement('span');
    nombreSpan.classList.add('nombre-carta');
    nombreSpan.textContent = carta.Nombre;

    const poderSpan = document.createElement('span');
    poderSpan.classList.add('poder-carta');
    poderSpan.textContent = carta.Poder;
    if (nivelNum >= 6) {
        poderSpan.style.color = '#d5b5ff';
    }

    detallesDiv.appendChild(nombreSpan);
    detallesDiv.appendChild(poderSpan);

    const estrellasDiv = document.createElement('div');
    estrellasDiv.classList.add('estrellas-carta');
    for (let i = 0; i < nivelNum; i++) {
        const estrella = document.createElement('img');
        estrella.classList.add('estrella');
        estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
        estrella.alt = 'star';
        estrellasDiv.appendChild(estrella);
    }

    cartaDiv.appendChild(estrellasDiv);

    cartaDiv.appendChild(detallesDiv);
    const badgeHabilidad = window.crearBadgeHabilidadCarta ? window.crearBadgeHabilidadCarta(carta) : null;
    if (badgeHabilidad) cartaDiv.appendChild(badgeHabilidad);
    const badgeAfiliacion = window.crearBadgeAfiliacionCarta ? window.crearBadgeAfiliacionCarta(carta) : null;
    if (badgeAfiliacion) cartaDiv.appendChild(badgeAfiliacion);
    cartaDiv.appendChild(crearBarraSaludMini(carta));

    return cartaDiv;
}

function renderizarPestanyaSobres() {
    const contenedor = document.getElementById('contenedor-cartas');
    if (!contenedor) return;
    contenedor.innerHTML = '';
    const usuario = obtenerUsuarioDesdeLsNormalizado();
    const defs = window.DC_SOBRES_DEFINICIONES;
    if (!usuario || !Array.isArray(defs)) {
        const p = document.createElement('div');
        p.className = 'alert alert-warning';
        p.textContent = 'No se pudo cargar el inventario de sobres.';
        contenedor.appendChild(p);
        return;
    }

    let hayAlguno = false;
    defs.forEach((def) => {
        const cantidad = Number(usuario.objetos[def.inventarioKey] || 0);
        if (cantidad <= 0) return;
        hayAlguno = true;

        const wrap = document.createElement('div');
        wrap.className = 'coleccion-sobre-tile';

        const img = document.createElement('img');
        img.className = 'coleccion-sobre-imagen';
        img.src = def.imagen;
        img.alt = def.nombre;

        const cuenta = document.createElement('div');
        cuenta.className = 'coleccion-sobre-cantidad';
        cuenta.textContent = `×${cantidad}`;

        const bt = document.createElement('button');
        bt.type = 'button';
        bt.className = 'btn btn-primary';
        bt.textContent = 'Abrir';
        bt.addEventListener('click', () => void ejecutarAnimacionYAperturaSobre(def.inventarioKey));

        wrap.appendChild(img);
        wrap.appendChild(cuenta);
        wrap.appendChild(bt);
        contenedor.appendChild(wrap);
    });

    if (!hayAlguno) {
        const vacio = document.createElement('div');
        vacio.className = 'alert alert-info coleccion-sobres-vacio';
        vacio.textContent = 'No tienes sobres en el inventario. Cómpralos en la tienda.';
        contenedor.appendChild(vacio);
    }
}

function configurarModalAperturaSobre() {
    const modal = document.getElementById('modal-apertura-sobre');
    const btn = document.getElementById('btn-cerrar-apertura-sobre');
    btn?.addEventListener('click', () => cerrarModalAperturaSobre());
}

function cerrarModalAperturaSobre() {
    const modal = document.getElementById('modal-apertura-sobre');
    const gridCards = document.getElementById('apertura-sobre-reveladas');
    gridCards?.classList.remove('apertura-sobre-pack-12');
    if (modal) modal.style.display = 'none';
}

function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ejecutarAnimacionYAperturaSobre(inventarioKey) {
    if (aperturaSobreEnCurso || !todasLasCartasCatalogo.length) return;

    const def = (window.DC_SOBRES_DEFINICIONES || []).find((d) => d.inventarioKey === inventarioKey);
    const usuarioPrep = obtenerUsuarioDesdeLsNormalizado();
    if (!def || !usuarioPrep || Number(usuarioPrep.objetos[def.inventarioKey] || 0) <= 0) return;

    aperturaSobreEnCurso = true;

    const cartasGeneradas =
        typeof window.DC_SOBRES_GENERAR_CARTAS === 'function'
            ? window.DC_SOBRES_GENERAR_CARTAS(todasLasCartasCatalogo, def)
            : [];

    if (cartasGeneradas.length === 0) {
        aperturaSobreEnCurso = false;
        window.alert('No hay cartas disponibles en el catálogo para esta facción.');
        return;
    }

    const modal = document.getElementById('modal-apertura-sobre');
    const faseEnv = document.getElementById('apertura-sobre-fase-envelope');
    const gridCards = document.getElementById('apertura-sobre-reveladas');
    const btnCerrar = document.getElementById('btn-cerrar-apertura-sobre');
    if (!modal || !faseEnv || !gridCards || !btnCerrar) {
        aperturaSobreEnCurso = false;
        return;
    }

    gridCards.innerHTML = '';
    gridCards.classList.toggle('apertura-sobre-pack-12', cartasGeneradas.length >= 12);
    faseEnv.innerHTML = '';
    btnCerrar.style.display = 'none';
    modal.style.display = 'flex';
    faseEnv.style.display = '';
    gridCards.style.display = 'none';

    const envImg = document.createElement('img');
    envImg.className = 'apertura-sobre-img-envelope';
    envImg.src = def.imagen;
    envImg.alt = def.nombre;

    const envTxt = document.createElement('p');
    envTxt.className = 'apertura-sobre-texto-estado';
    envTxt.textContent = 'Abriendo sobre.';
    faseEnv.appendChild(envImg);
    faseEnv.appendChild(envTxt);

    let persistOk = false;
    let nuevasH = 0;
    let nuevasV = 0;
    try {
        const maxIntentos = 3;
        for (let intento = 0; intento < maxIntentos && !persistOk; intento++) {
            try {
                const usuario = obtenerUsuarioDesdeLsNormalizado();
                if (!usuario || Number(usuario.objetos[def.inventarioKey] || 0) <= 0) {
                    cerrarModalAperturaSobre();
                    aperturaSobreEnCurso = false;
                    return;
                }
                const snapshotPrevias = (usuario.cartas || []).slice();
                usuario.objetos[def.inventarioKey] = Number(usuario.objetos[def.inventarioKey] || 0) - 1;
                cartasGeneradas.forEach((carta) => {
                    usuario.cartas.push({ ...carta });
                });
                const conteo = typeof window.dcContarCartasNuevasPorFaccion === 'function'
                    ? window.dcContarCartasNuevasPorFaccion(cartasGeneradas, snapshotPrevias, todasLasCartasCatalogo)
                    : { nuevasH: 0, nuevasV: 0 };
                nuevasH = conteo.nuevasH;
                nuevasV = conteo.nuevasV;
                await persistirUsuarioDesdeColeccion(usuario);
                persistOk = true;
            } catch (e) {
                const es409 =
                    e?.status === 409 ||
                    e?.codigo === 'SYNC_CONFLICT' ||
                    /SYNC_CONFLICT|conflicto de sincronizaci/i.test(String(e?.message || ''));
                if (!es409 || intento === maxIntentos - 1) {
                    throw e;
                }
                await esperar(120);
            }
        }
        if (window.DCMisiones?.track) {
            window.DCMisiones.track('sobres', { amount: 1 });
            if (nuevasH > 0) window.DCMisiones.track('coleccion_h', { amount: nuevasH });
            if (nuevasV > 0) window.DCMisiones.track('coleccion_v', { amount: nuevasV });
        }
    } catch (e) {
        console.error(e);
        window.alert('No se pudo guardar el resultado. Inténtalo de nuevo.');
        cerrarModalAperturaSobre();
        aperturaSobreEnCurso = false;
        return;
    }

    sincronizarEstadoUsuarioColeccionDesdeLs();
    actualizarTextosProgresoColeccion();
    if (persistOk && vistaColeccionActiva === 'sobres') {
        renderizarPestanyaSobres();
    }

    await esperar(1350);

    faseEnv.style.display = 'none';
    gridCards.style.display = 'flex';

    for (let i = 0; i < cartasGeneradas.length; i++) {
        const el = crearTarjetaRevelacionSobre(cartasGeneradas[i]);
        el.style.opacity = '0';
        el.style.transform = 'translateY(28px) scale(0.92)';
        gridCards.appendChild(el);
        await esperar(24);
        el.style.transition = 'opacity 0.45s ease, transform 0.5s cubic-bezier(0.22, 0.92, 0.28, 1)';
        requestAnimationFrame(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0) scale(1)';
        });
        await esperar(480);
    }

    btnCerrar.style.display = 'inline-block';
    aperturaSobreEnCurso = false;
}

async function persistirUsuarioDesdeColeccion(usuario) {
    const email = localStorage.getItem('email');
    if (!email) {
        throw new Error('Sin sesión');
    }
    const response = await fetch('/update-user', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ usuario, email })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        if (response.status === 409 && data?.usuario) {
            localStorage.setItem('usuario', JSON.stringify(data.usuario));
            window.dispatchEvent(new Event('dc:usuario-actualizado'));
        }
        const err = new Error(data?.mensaje || 'update-user failed');
        err.status = response.status;
        err.codigo = data?.codigo;
        throw err;
    }
    if (data?.usuario && usuario && typeof usuario === 'object') {
        Object.keys(usuario).forEach((k) => delete usuario[k]);
        Object.assign(usuario, data.usuario);
    }
    localStorage.setItem('usuario', JSON.stringify(usuario));
    if (typeof window.actualizarPanelPerfilTiempoReal === 'function') {
        window.actualizarPanelPerfilTiempoReal();
    }
    window.dispatchEvent(new Event('dc:usuario-actualizado'));
}


function logout() {
    console.log('Cerrando sesión y limpiando localStorage...');
    localStorage.removeItem('usuario');
    localStorage.removeItem('email');
    localStorage.removeItem('jugandoPartida');
    localStorage.removeItem('mazoJugador');
    localStorage.removeItem('mazoOponente');
    window.location.href = '/login.html';
}
