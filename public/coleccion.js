let faccionColeccionActiva = 'H';
let todasLasCartasCatalogo = [];
let nombresCartasConseguidas = new Set();
let busquedaColeccion = '';
let afiliacionFiltroActiva = 'todas';
let mapaCatalogo = new Map();
let mapaMejorVersionUsuario = new Map();

document.addEventListener('DOMContentLoaded', function () {
    configurarTabsColeccion();
    configurarFiltrosColeccion();
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
    const btnHeroes = document.getElementById('tab-coleccion-heroes');
    const btnVillanos = document.getElementById('tab-coleccion-villanos');

    btnHeroes?.addEventListener('click', function () {
        faccionColeccionActiva = 'H';
        actualizarTabsColeccion();
        actualizarSelectorAfiliacionColeccion();
        renderizarColeccion();
    });

    btnVillanos?.addEventListener('click', function () {
        faccionColeccionActiva = 'V';
        actualizarTabsColeccion();
        actualizarSelectorAfiliacionColeccion();
        renderizarColeccion();
    });
}

function configurarFiltrosColeccion() {
    const inputBusqueda = document.getElementById('busqueda-coleccion');
    const selectorAfiliacion = document.getElementById('selector-afiliacion-coleccion');

    inputBusqueda?.addEventListener('input', function () {
        busquedaColeccion = String(this.value || '').trim().toLowerCase();
        renderizarColeccion();
    });

    selectorAfiliacion?.addEventListener('change', function () {
        afiliacionFiltroActiva = normalizarAfiliacion(this.value || 'todas') || 'todas';
        renderizarColeccion();
    });
}

function actualizarTabsColeccion() {
    document.getElementById('tab-coleccion-heroes')?.classList.toggle('active', faccionColeccionActiva === 'H');
    document.getElementById('tab-coleccion-villanos')?.classList.toggle('active', faccionColeccionActiva === 'V');

    const indicador = document.getElementById('faccion-coleccion-actual');
    if (indicador) {
        indicador.textContent = `Vista actual: ${faccionColeccionActiva === 'H' ? 'Héroes' : 'Villanos'}`;
    }
}

async function cargarColeccion() {
    try {
        const usuario = JSON.parse(localStorage.getItem('usuario'));
        const cartasUsuario = usuario && Array.isArray(usuario.cartas) ? usuario.cartas : [];
        nombresCartasConseguidas = new Set(cartasUsuario.map(carta => String(carta?.Nombre || '').toLowerCase()));
        mapaMejorVersionUsuario = construirMapaMejorVersionUsuario(cartasUsuario);

        const catalogoExcel = await cargarCatalogoExcel();

        mapaCatalogo = new Map();
        catalogoExcel.forEach(carta => {
            mapaCatalogo.set(obtenerClaveCarta(carta.Nombre), {
                faccion: obtenerFaccionCarta(carta),
                Afiliacion: obtenerAfiliacionCarta(carta),
                Imagen: carta.Imagen || carta.imagen || '',
                imagen_final: carta.imagen_final || ''
            });
        });

        // Usar Excel como fuente única evita depender de rutas backend no existentes.
        todasLasCartasCatalogo = catalogoExcel.map(carta => ({
            ...carta,
            faccion: obtenerFaccionCarta(carta),
            Afiliacion: obtenerAfiliacionCarta(carta),
            Imagen: carta.Imagen || carta.imagen || '',
            imagen_final: carta.imagen_final || ''
        }));

        const progresoTexto = `${nombresCartasConseguidas.size}/${todasLasCartasCatalogo.length}`;
        document.getElementById('progreso-coleccion').textContent = progresoTexto;
        actualizarTabsColeccion();
        actualizarSelectorAfiliacionColeccion();
        renderizarColeccion();
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
    cartaDiv.style.backgroundPosition = 'center';

    const detallesDiv = document.createElement('div');
    detallesDiv.classList.add('detalles-carta');

    const nombreSpan = document.createElement('span');
    nombreSpan.classList.add('nombre-carta');
    nombreSpan.textContent = cartaVisual.Nombre;

    const poderSpan = document.createElement('span');
    poderSpan.classList.add('poder-carta');
    poderSpan.textContent = cartaVisual.Poder;

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
    cartaDiv.appendChild(estrellasDiv);
    cartaDiv.appendChild(estadoDiv);

    return cartaDiv;
}

function renderizarColeccion() {
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
        .sort((a, b) => String(a.Nombre || '').localeCompare(String(b.Nombre || '')));

    cartasFiltradas.forEach(carta => {
        const estaObtenida = nombresCartasConseguidas.has(String(carta?.Nombre || '').toLowerCase());
        contenedorCartas.appendChild(crearCartaColeccionElemento(carta, estaObtenida));
    });
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
