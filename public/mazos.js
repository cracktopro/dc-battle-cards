let mazoIndexSeleccionado = -1;
let indiceCartaEnEdicion = -1;
let indiceCartaAcciones = -1;
let cartaReemplazoSeleccionada = null;
let mazoPendienteBorrado = -1;
let mapaSaludCatalogo = null;
let mapaFilasCatalogoCompleto = null;
/** null = apariencia base (parent); number = skin_id elegido en el modal. */
let skinAparienciaSeleccionada = null;
let candidatasReemplazoCache = [];
let busquedaReemplazoMazo = '';
let afiliacionFiltroReemplazoMazo = 'todas';

document.addEventListener('DOMContentLoaded', async function () {
    configurarEventos();
    await inicializarVistaMazos();
});

function normalizarFaccion(valor) {
    const faccion = String(valor || '').trim().toUpperCase();
    return faccion === 'H' || faccion === 'V' ? faccion : '';
}

function obtenerEtiquetaFaccion(faccion) {
    return faccion === 'H' ? 'Héroes' : 'Villanos';
}

function calcularPoderMazo(cartas) {
    return (cartas || []).reduce((total, carta) => total + Number(carta?.Poder || 0), 0);
}

function compararCartasPorPoderDesc(a, b) {
    const diff = Number(b?.Poder || 0) - Number(a?.Poder || 0);
    if (diff !== 0) {
        return diff;
    }
    return String(a?.Nombre || '').localeCompare(String(b?.Nombre || ''), undefined, { sensitivity: 'base' });
}

function obtenerSaludMaxCarta(carta) {
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

function obtenerSaludActualCarta(carta) {
    const saludMax = Math.max(obtenerSaludMaxCarta(carta), 0);
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

function obtenerNombreParentCartaMazo(carta) {
    if (typeof window.DCSkinsCartas !== 'undefined' && typeof window.DCSkinsCartas.obtenerNombreParentCarta === 'function') {
        return window.DCSkinsCartas.obtenerNombreParentCarta(carta);
    }
    return String(carta?.Nombre || '').trim();
}

async function obtenerMapaFilasCatalogoCompleto() {
    if (mapaFilasCatalogoCompleto) {
        return mapaFilasCatalogoCompleto;
    }
    const response = await fetch('resources/cartas.xlsx');
    if (!response.ok) {
        throw new Error('No se pudo cargar cartas.xlsx');
    }
    const data = await response.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    mapaFilasCatalogoCompleto = new Map();
    filas.forEach((fila) => {
        const nombre = String(fila?.Nombre || '').trim().toLowerCase();
        if (nombre && !mapaFilasCatalogoCompleto.has(nombre)) {
            mapaFilasCatalogoCompleto.set(nombre, fila);
        }
    });
    return mapaFilasCatalogoCompleto;
}

async function inicializarVistaMazos() {
    await sincronizarLocalStorage();
    if (typeof window.DCSkinsCartas !== 'undefined' && typeof window.DCSkinsCartas.asegurarSkinsCargados === 'function') {
        try {
            await window.DCSkinsCartas.asegurarSkinsCargados();
        } catch (error) {
            console.warn('No se pudieron cargar los skins:', error);
        }
    }
    try {
        await obtenerMapaFilasCatalogoCompleto();
    } catch (error) {
        console.warn('No se pudo cargar el catálogo completo de cartas:', error);
    }
    try {
        await enriquecerSaludDesdeCatalogo();
    } catch (error) {
        console.warn('No se pudo enriquecer la salud de las cartas desde el catálogo:', error);
    }
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const tieneMazos = Boolean(usuario?.mazos?.length);

    if (!tieneMazos) {
        mostrarModalSinMazos();
        bloquearGestionMazos(true);
        return;
    }

    bloquearGestionMazos(false);
    configurarSelectorMazo();
    cargarCartasDelMazo();
}

async function obtenerMapaSaludCatalogo() {
    if (mapaSaludCatalogo) {
        return mapaSaludCatalogo;
    }

    const response = await fetch('resources/cartas.xlsx');
    if (!response.ok) {
        throw new Error('No se pudo cargar el catálogo de cartas para salud.');
    }

    const data = await response.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const cartasExcel = XLSX.utils.sheet_to_json(sheet);

    mapaSaludCatalogo = new Map();
    cartasExcel.forEach(carta => {
        const nombre = String(carta?.Nombre || '').trim().toLowerCase();
        if (!nombre) {
            return;
        }
        mapaSaludCatalogo.set(nombre, {
            nivelBase: Number(carta.Nivel || carta.nivel || 1),
            saludBase: Number(carta.Salud ?? carta.salud ?? carta.Poder ?? 0),
            skill_name: String(carta.skill_name || '').trim(),
            skill_info: String(carta.skill_info || '').trim(),
            skill_class: String(carta.skill_class || '').trim().toLowerCase(),
            skill_power: carta.skill_power ?? '',
            skill_trigger: String(carta.skill_trigger || '').trim().toLowerCase()
        });
    });

    return mapaSaludCatalogo;
}

function calcularSaludEscalada(carta, datosCatalogo) {
    if (!datosCatalogo) {
        return obtenerSaludMaxCarta(carta);
    }

    const nivelCarta = Math.max(1, Number(carta?.Nivel || 1));
    const nivelBase = Math.max(1, Number(datosCatalogo.nivelBase || 1));
    if (window.DCEscaladoStatsCarta?.calcularSaludEscaladaDesdeBase) {
        return window.DCEscaladoStatsCarta.calcularSaludEscaladaDesdeBase(
            Number(datosCatalogo.saludBase || 0),
            nivelCarta,
            nivelBase
        );
    }
    const incrementoNiveles = Math.max(nivelCarta - nivelBase, 0);
    return Math.max(0, Number(datosCatalogo.saludBase || 0)) + (incrementoNiveles * 500);
}

async function enriquecerSaludDesdeCatalogo() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    if (!usuario || !Array.isArray(usuario.cartas) || !Array.isArray(usuario.mazos)) {
        return;
    }

    const mapaCatalogo = await obtenerMapaSaludCatalogo();
    let mapaFilas = mapaFilasCatalogoCompleto;
    try {
        mapaFilas = await obtenerMapaFilasCatalogoCompleto();
    } catch (_error) {
        mapaFilas = null;
    }
    if (typeof window.DCSkinsCartas !== 'undefined' && typeof window.DCSkinsCartas.asegurarSkinsCargados === 'function') {
        try {
            await window.DCSkinsCartas.asegurarSkinsCargados();
        } catch (_error) {
            /* sin skins */
        }
    }

    const normalizarCarta = (carta) => {
        if (!carta) {
            return carta;
        }
        const clave = String(obtenerNombreParentCartaMazo(carta) || '').trim().toLowerCase();
        const datos = mapaCatalogo.get(clave);
        const saludEscalada = calcularSaludEscalada(carta, datos);
        const base = {
            ...carta,
            SaludMax: saludEscalada,
            Salud: saludEscalada
        };
        let resultado = base;
        if (datos && typeof window.fusionarSkillDesdeFilaCatalogo === 'function') {
            resultado = window.fusionarSkillDesdeFilaCatalogo(base, datos);
        }
        const skinId = carta.skinActivoId;
        if (
            skinId !== null
            && skinId !== undefined
            && typeof window.DCSkinsCartas !== 'undefined'
            && typeof window.DCSkinsCartas.aplicarSkinJugadorSobreCarta === 'function'
        ) {
            const skin = window.DCSkinsCartas.obtenerSkinPorId(skinId);
            const filaParent = mapaFilas?.get(clave) || null;
            if (skin) {
                resultado = window.DCSkinsCartas.aplicarSkinJugadorSobreCarta(resultado, skin, filaParent);
            }
        }
        if (typeof window.recalcularSkillPowerPorNivel === 'function') {
            window.recalcularSkillPowerPorNivel(resultado, Number(resultado.Nivel || 1));
        }
        return resultado;
    };

    usuario.cartas = usuario.cartas.map(normalizarCarta);
    usuario.mazos = usuario.mazos.map(mazo => ({
        ...mazo,
        Cartas: Array.isArray(mazo?.Cartas) ? mazo.Cartas.map(normalizarCarta) : []
    }));

    localStorage.setItem('usuario', JSON.stringify(usuario));
}

function bloquearGestionMazos(bloquear) {
    const selectMazo = document.getElementById('select-mazo');
    const borrarBtn = document.getElementById('borrar-mazo');
    if (selectMazo) {
        selectMazo.disabled = bloquear;
    }
    if (borrarBtn) {
        borrarBtn.disabled = bloquear;
    }
}

function configurarEventos() {
    const selectMazo = document.getElementById('select-mazo');
    selectMazo.addEventListener('change', function () {
        mazoIndexSeleccionado = Number(this.value);
        actualizarEditorNombreMazo();
        cargarCartasDelMazo();
    });

    const inputNombreMazo = document.getElementById('input-nombre-mazo');
    const guardarNombreBtn = document.getElementById('guardar-nombre-mazo');
    if (guardarNombreBtn) {
        guardarNombreBtn.addEventListener('click', async () => {
            await guardarNombreMazoSeleccionado();
        });
    }
    if (inputNombreMazo) {
        inputNombreMazo.addEventListener('keydown', async (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                await guardarNombreMazoSeleccionado();
            }
        });
    }

    document.getElementById('borrar-mazo').addEventListener('click', async function () {
        if (mazoIndexSeleccionado < 0) {
            mostrarMensaje('No hay un mazo seleccionado para borrar.', 'warning');
            return;
        }
        abrirModalConfirmacionBorrado(mazoIndexSeleccionado);
    });

    document.getElementById('ir-crear-mazos-btn').addEventListener('click', function () {
        window.location.href = 'crearMazos.html';
    });

    document.getElementById('cancelar-sin-mazo-btn').addEventListener('click', function () {
        ocultarModalSinMazos();
    });

    document.getElementById('cancelar-acciones-carta-btn').addEventListener('click', function () {
        cerrarModalAcciones();
    });

    document.getElementById('btn-sustituir-carta').addEventListener('click', function () {
        const indice = indiceCartaAcciones;
        cerrarModalAcciones();
        if (indice >= 0) {
            abrirModalCambioCarta(indice);
        }
    });

    document.getElementById('btn-apariencias-carta').addEventListener('click', async function () {
        await abrirModalApariencias();
    });

    document.getElementById('cancelar-apariencia-btn').addEventListener('click', function () {
        cerrarModalApariencias();
    });

    document.getElementById('confirmar-apariencia-btn').addEventListener('click', async function () {
        await confirmarAparienciaCarta();
    });

    document.getElementById('cancelar-cambio-carta-btn').addEventListener('click', function () {
        cerrarModalCambioCarta();
    });

    document.getElementById('confirmar-cambio-carta-btn').addEventListener('click', async function () {
        await confirmarCambioCarta();
    });

    const inputBusquedaReemplazo = document.getElementById('busqueda-reemplazo-mazo');
    if (inputBusquedaReemplazo) {
        inputBusquedaReemplazo.addEventListener('input', function () {
            busquedaReemplazoMazo = String(this.value || '').trim().toLowerCase();
            renderizarListaCartasReemplazo();
        });
    }

    const selectorAfiliacionReemplazo = document.getElementById('selector-afiliacion-reemplazo');
    if (selectorAfiliacionReemplazo) {
        selectorAfiliacionReemplazo.addEventListener('change', function () {
            afiliacionFiltroReemplazoMazo = normalizarAfiliacionMazo(this.value || 'todas') || 'todas';
            renderizarListaCartasReemplazo();
        });
    }

    document.getElementById('cancelar-borrado-mazo-btn').addEventListener('click', function () {
        cerrarModalConfirmacionBorrado();
    });

    document.getElementById('aceptar-borrado-mazo-btn').addEventListener('click', async function () {
        if (mazoPendienteBorrado < 0) {
            cerrarModalConfirmacionBorrado();
            return;
        }

        const indiceABorrar = mazoPendienteBorrado;
        cerrarModalConfirmacionBorrado();
        await borrarMazo(indiceABorrar);
    });
}

function actualizarEditorNombreMazo() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const input = document.getElementById('input-nombre-mazo');
    if (!input) {
        return;
    }
    const nombreActual = String(usuario?.mazos?.[mazoIndexSeleccionado]?.Nombre || '').trim();
    input.value = nombreActual;
}

async function sincronizarLocalStorage() {
    const email = localStorage.getItem('email');
    if (!email) {
        return;
    }

    try {
        const response = await fetch('/get-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        if (!response.ok) {
            throw new Error('Respuesta de red no OK');
        }

        const data = await response.json();
        if (data?.usuario) {
            localStorage.setItem('usuario', JSON.stringify(data.usuario));
        }
    } catch (error) {
        console.error('Error al sincronizar los datos del usuario:', error);
        mostrarMensaje('No se pudo sincronizar la información del usuario.', 'danger');
    }
}

function configurarSelectorMazo() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const selectMazo = document.getElementById('select-mazo');

    selectMazo.innerHTML = '';

    (usuario?.mazos || []).forEach((mazo, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = mazo.Nombre || `Mazo ${index + 1}`;
        selectMazo.appendChild(option);
    });

    // Por defecto se selecciona el primer mazo creado
    mazoIndexSeleccionado = 0;
    selectMazo.value = '0';
    actualizarEditorNombreMazo();
}

async function guardarNombreMazoSeleccionado() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');
    const input = document.getElementById('input-nombre-mazo');
    const select = document.getElementById('select-mazo');
    if (!usuario || !Array.isArray(usuario.mazos) || !email || mazoIndexSeleccionado < 0) {
        mostrarMensaje('No se pudo guardar el nombre del mazo.', 'danger');
        return;
    }
    const mazo = usuario.mazos[mazoIndexSeleccionado];
    if (!mazo) {
        mostrarMensaje('No hay un mazo seleccionado.', 'warning');
        return;
    }
    const nuevoNombre = String(input?.value || '').trim();
    if (!nuevoNombre) {
        mostrarMensaje('El nombre del mazo no puede estar vacío.', 'warning');
        return;
    }
    mazo.Nombre = nuevoNombre;
    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        if (select?.options?.[mazoIndexSeleccionado]) {
            select.options[mazoIndexSeleccionado].textContent = nuevoNombre;
        }
        mostrarMensaje('Nombre del mazo actualizado correctamente.', 'success');
    } catch (error) {
        console.error('Error al guardar el nombre del mazo:', error);
        mostrarMensaje('Error al guardar el nombre del mazo en Firebase.', 'danger');
    }
}

function renderizarPoderTotal(cartasMazo) {
    const poderTotal = calcularPoderMazo(cartasMazo);
    const label = document.getElementById('poder-total-mazo');
    if (!label) {
        return;
    }

    label.textContent = poderTotal;
    label.classList.remove('poder-bajo', 'poder-medio', 'poder-alto', 'poder-legendario');

    if (poderTotal < 25000) {
        label.classList.add('poder-bajo');
    } else if (poderTotal < 45000) {
        label.classList.add('poder-medio');
    } else if (poderTotal < 70000) {
        label.classList.add('poder-alto');
    } else {
        label.classList.add('poder-legendario');
    }
}

function crearCartaMazoElemento(carta, indiceCarta) {
    const cartaDiv = document.createElement('div');
    cartaDiv.classList.add('carta', 'carta-modificable');
    if (typeof window.dcAplicarClasesNivelCartaCompleta === 'function') {
        window.dcAplicarClasesNivelCartaCompleta(cartaDiv, carta);
    } else if (Number(carta?.Nivel || 1) >= 6) {
        cartaDiv.classList.add('nivel-legendaria');
    }

    const imagenUrl = obtenerImagenCarta(carta);
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
    cartaDiv.appendChild(crearBarraSaludElemento(carta));
    cartaDiv.appendChild(detallesDiv);
    cartaDiv.appendChild(estrellasDiv);
    cartaDiv.addEventListener('click', function () {
        abrirModalAcciones(indiceCarta);
    });

    return cartaDiv;
}

function cargarCartasDelMazo() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const contenedorCartas = document.getElementById('contenedor-cartas');
    contenedorCartas.innerHTML = '';

    if (!usuario?.mazos?.[mazoIndexSeleccionado]) {
        renderizarPoderTotal([]);
        return;
    }

    const cartasMazoOriginal = [...(usuario.mazos[mazoIndexSeleccionado].Cartas || [])];
    const cartasOrdenadasConIndiceReal = cartasMazoOriginal
        .map((carta, originalIndex) => ({ carta, originalIndex }))
        .sort((a, b) => compararCartasPorPoderDesc(a.carta, b.carta));

    cartasOrdenadasConIndiceReal.forEach(({ carta, originalIndex }) => {
        // Usar el índice real del mazo evita reemplazar la carta equivocada.
        contenedorCartas.appendChild(crearCartaMazoElemento(carta, originalIndex));
    });

    renderizarPoderTotal(cartasMazoOriginal);
}

function esMejorVersionCartaMazo(candidata, actual) {
    const nivelCandidata = Number(candidata?.Nivel || 1);
    const nivelActual = Number(actual?.Nivel || 1);
    if (nivelCandidata !== nivelActual) {
        return nivelCandidata > nivelActual;
    }
    const poderCandidata = Number(candidata?.Poder || 0);
    const poderActual = Number(actual?.Poder || 0);
    return poderCandidata > poderActual;
}

/** Una sola entrada por carta (nombre parent): la de mayor nivel; si empatan, mayor poder. */
function deduplicarCartasPorMejorVersion(cartas) {
    const mapa = new Map();
    (Array.isArray(cartas) ? cartas : []).forEach((carta) => {
        const clave = String(obtenerNombreParentCartaMazo(carta) || '').trim().toLowerCase();
        if (!clave) {
            return;
        }
        const actual = mapa.get(clave);
        if (!actual || esMejorVersionCartaMazo(carta, actual)) {
            mapa.set(clave, carta);
        }
    });
    return [...mapa.values()];
}

function obtenerCartasCandidatasReemplazo() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const mazo = usuario?.mazos?.[mazoIndexSeleccionado];
    if (!usuario || !mazo) {
        return [];
    }

    const faccionMazo = normalizarFaccion(mazo.Faccion || mazo.Cartas?.[0]?.faccion);
    const nombresEnMazo = new Set(
        (mazo.Cartas || [])
            .map(carta => String(obtenerNombreParentCartaMazo(carta) || '').trim().toLowerCase())
            .filter(Boolean)
    );

    const filtradas = (usuario.cartas || []).filter(carta => {
        if (normalizarFaccion(carta?.faccion) !== faccionMazo) {
            return false;
        }

        const nombre = String(obtenerNombreParentCartaMazo(carta) || '').trim().toLowerCase();
        return Boolean(nombre) && !nombresEnMazo.has(nombre);
    });

    return deduplicarCartasPorMejorVersion(filtradas);
}

function crearCartaReemplazoElemento(carta) {
    const item = document.createElement('div');
    item.classList.add('carta', 'item-carta-reemplazo');
    if (typeof window.dcAplicarClasesNivelCartaCompleta === 'function') {
        window.dcAplicarClasesNivelCartaCompleta(item, carta);
    } else if (Number(carta?.Nivel || 1) >= 6) {
        item.classList.add('nivel-legendaria');
    }

    const imagenUrl = obtenerImagenCarta(carta);
    item.style.backgroundImage = `url(${imagenUrl})`;
    item.style.backgroundSize = 'cover';
    item.style.backgroundPosition = 'center top';

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

    item.appendChild(detallesDiv);
    const badgeHabilidad = window.crearBadgeHabilidadCarta ? window.crearBadgeHabilidadCarta(carta) : null;
    if (badgeHabilidad) {
        item.appendChild(badgeHabilidad);
    }
    const badgeAfiliacion = window.crearBadgeAfiliacionCarta ? window.crearBadgeAfiliacionCarta(carta) : null;
    if (badgeAfiliacion) {
        item.appendChild(badgeAfiliacion);
    }
    item.appendChild(crearBarraSaludElemento(carta));
    item.appendChild(estrellasDiv);
    return item;
}

function crearCartaAparienciaElemento(cartaVista, opciones = {}) {
    const item = crearCartaReemplazoElemento(cartaVista);
    item.classList.remove('item-carta-reemplazo');
    item.classList.add('item-carta-apariencia');
    if (opciones.seleccionada) {
        item.classList.add('seleccionada');
    }
    if (opciones.bloqueada) {
        item.classList.add('bloqueada');
    }

    return item;
}

function sincronizarSkinEnColeccion(usuario, cartaReferencia) {
    if (!usuario || !Array.isArray(usuario.cartas) || !cartaReferencia) {
        return;
    }
    const parent = obtenerNombreParentCartaMazo(cartaReferencia);
    const claveParent = parent.trim().toLowerCase();
    if (!claveParent) {
        return;
    }
    usuario.cartas = usuario.cartas.map((carta) => {
        if (String(obtenerNombreParentCartaMazo(carta) || '').trim().toLowerCase() !== claveParent) {
            return carta;
        }
        const actualizada = {
            ...carta,
            skinActivoId: cartaReferencia.skinActivoId ?? null,
            skinParentNombre: parent,
            Nombre: cartaReferencia.Nombre,
            Imagen: cartaReferencia.Imagen,
            imagen: cartaReferencia.imagen,
            Afiliacion: cartaReferencia.Afiliacion,
            afiliacion: cartaReferencia.afiliacion,
            skill_name: cartaReferencia.skill_name,
            skill_info: cartaReferencia.skill_info,
            skill_class: cartaReferencia.skill_class,
            skill_power: cartaReferencia.skill_power,
            skill_trigger: cartaReferencia.skill_trigger,
            Poder: cartaReferencia.Poder,
            Salud: cartaReferencia.Salud,
            SaludMax: cartaReferencia.SaludMax
        };
        if (typeof window.recalcularSkillPowerPorNivel === 'function') {
            window.recalcularSkillPowerPorNivel(actualizada, Number(actualizada.Nivel || 1), { rawEsBase: true });
        }
        return actualizada;
    });
}

function abrirModalAcciones(indiceCarta) {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const mazo = usuario?.mazos?.[mazoIndexSeleccionado];
    const cartaActual = mazo?.Cartas?.[indiceCarta];
    if (!cartaActual) {
        return;
    }

    indiceCartaAcciones = indiceCarta;
    const btnApariencias = document.getElementById('btn-apariencias-carta');
    const tieneSkins = typeof window.DCSkinsCartas !== 'undefined'
        && typeof window.DCSkinsCartas.cartaTieneSkinsDisponibles === 'function'
        && window.DCSkinsCartas.cartaTieneSkinsDisponibles(cartaActual);
    if (btnApariencias) {
        btnApariencias.disabled = !tieneSkins;
    }
    document.getElementById('acciones-carta-modal').style.display = 'flex';
}

function ocultarModalAcciones() {
    const modal = document.getElementById('acciones-carta-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function cerrarModalAcciones() {
    indiceCartaAcciones = -1;
    ocultarModalAcciones();
}

async function abrirModalApariencias() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const mazo = usuario?.mazos?.[mazoIndexSeleccionado];
    const cartaActual = mazo?.Cartas?.[indiceCartaAcciones];
    if (!usuario || !cartaActual || typeof window.DCSkinsCartas === 'undefined') {
        return;
    }

    await window.DCSkinsCartas.asegurarSkinsCargados();
    const mapaCatalogo = await obtenerMapaFilasCatalogoCompleto();
    const parentNombre = window.DCSkinsCartas.obtenerNombreParentCarta(cartaActual);
    const filaParent = mapaCatalogo.get(String(parentNombre || '').trim().toLowerCase()) || null;
    const skins = window.DCSkinsCartas.obtenerSkinsDelParent(parentNombre);

    skinAparienciaSeleccionada = cartaActual.skinActivoId ?? null;
    if (skinAparienciaSeleccionada === undefined) {
        skinAparienciaSeleccionada = null;
    }

    const subtitulo = document.getElementById('apariencias-carta-subtitulo');
    if (subtitulo) {
        subtitulo.textContent = 'Selecciona una apariencia. Las no obtenidas aparecen bloqueadas.';
    }

    const lista = document.getElementById('lista-apariencias-carta');
    lista.innerHTML = '';

    const opciones = [
        { skinId: null, desbloqueada: true },
        ...skins.map((skin) => ({
            skinId: skin.skin_id,
            desbloqueada: window.DCSkinsCartas.jugadorPoseeSkin(usuario, skin)
        }))
    ];

    opciones.forEach((opcion) => {
        const cartaVista = window.DCSkinsCartas.construirVistaCartaJugadorConSkin(
            cartaActual,
            opcion.skinId,
            filaParent
        );
        const item = crearCartaAparienciaElemento(cartaVista, {
            seleccionada: skinAparienciaSeleccionada === opcion.skinId
                || (opcion.skinId === null && (cartaActual.skinActivoId === null || cartaActual.skinActivoId === undefined)),
            bloqueada: !opcion.desbloqueada
        });

        if (opcion.desbloqueada) {
            item.addEventListener('click', function () {
                document.querySelectorAll('.item-carta-apariencia').forEach((el) => el.classList.remove('seleccionada'));
                item.classList.add('seleccionada');
                skinAparienciaSeleccionada = opcion.skinId;
            });
        }

        lista.appendChild(item);
    });

    ocultarModalAcciones();
    document.getElementById('apariencias-carta-modal').style.display = 'flex';
}

function cerrarModalApariencias() {
    skinAparienciaSeleccionada = null;
    indiceCartaAcciones = -1;
    document.getElementById('apariencias-carta-modal').style.display = 'none';
}

async function confirmarAparienciaCarta() {
    if (indiceCartaAcciones < 0) {
        mostrarMensaje('No hay una carta seleccionada.', 'warning');
        return;
    }

    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');
    const mazo = usuario?.mazos?.[mazoIndexSeleccionado];
    const cartaActual = mazo?.Cartas?.[indiceCartaAcciones];
    if (!usuario || !email || !mazo || !cartaActual || typeof window.DCSkinsCartas === 'undefined') {
        mostrarMensaje('No se pudo aplicar la apariencia.', 'danger');
        return;
    }

    const mapaCatalogo = await obtenerMapaFilasCatalogoCompleto();
    const parentNombre = window.DCSkinsCartas.obtenerNombreParentCarta(cartaActual);
    const filaParent = mapaCatalogo.get(String(parentNombre || '').trim().toLowerCase()) || null;

    if (skinAparienciaSeleccionada !== null && skinAparienciaSeleccionada !== undefined) {
        const skin = window.DCSkinsCartas.obtenerSkinPorId(skinAparienciaSeleccionada);
        if (!skin || !window.DCSkinsCartas.jugadorPoseeSkin(usuario, skin)) {
            mostrarMensaje('No puedes aplicar una apariencia que no has obtenido.', 'warning');
            return;
        }
    }

    const cartaActualizada = window.DCSkinsCartas.construirVistaCartaJugadorConSkin(
        cartaActual,
        skinAparienciaSeleccionada,
        filaParent
    );

    mazo.Cartas[indiceCartaAcciones] = cartaActualizada;

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        cerrarModalApariencias();
        indiceCartaAcciones = -1;
        cargarCartasDelMazo();
        mostrarMensaje('Apariencia aplicada y mazo guardado.', 'success');
    } catch (error) {
        console.error('Error al guardar apariencia:', error);
        mostrarMensaje('Error al guardar la apariencia en Firebase.', 'danger');
    }
}

function normalizarAfiliacionMazo(valor) {
    return String(valor || '').trim().toLowerCase();
}

function obtenerAfiliacionesCartaMazo(carta) {
    const raw = String(carta?.Afiliacion || carta?.afiliacion || '').trim();
    if (!raw) {
        return [];
    }
    return raw.split(';').map((item) => item.trim()).filter(Boolean);
}

function poblarSelectorAfiliacionReemplazo(candidatas) {
    const selector = document.getElementById('selector-afiliacion-reemplazo');
    if (!selector) {
        return;
    }
    const afiliaciones = new Map();
    candidatas.forEach((carta) => {
        obtenerAfiliacionesCartaMazo(carta).forEach((afi) => {
            const clave = normalizarAfiliacionMazo(afi);
            if (clave) {
                afiliaciones.set(clave, afi);
            }
        });
    });

    const valorPrevio = afiliacionFiltroReemplazoMazo;
    selector.innerHTML = '';
    const optTodas = document.createElement('option');
    optTodas.value = 'todas';
    optTodas.textContent = 'Todas las afiliaciones';
    selector.appendChild(optTodas);

    [...afiliaciones.entries()]
        .sort((a, b) => a[1].localeCompare(b[1], undefined, { sensitivity: 'base' }))
        .forEach(([, etiqueta]) => {
            const option = document.createElement('option');
            option.value = normalizarAfiliacionMazo(etiqueta);
            option.textContent = etiqueta;
            selector.appendChild(option);
        });

    const existePrevio = [...selector.options].some((opt) => opt.value === valorPrevio);
    afiliacionFiltroReemplazoMazo = existePrevio ? valorPrevio : 'todas';
    selector.value = afiliacionFiltroReemplazoMazo;
}

function renderizarListaCartasReemplazo() {
    const lista = document.getElementById('lista-cartas-reemplazo');
    if (!lista) {
        return;
    }
    lista.innerHTML = '';

    const candidatasFiltradas = candidatasReemplazoCache
        .filter((carta) => {
            if (!busquedaReemplazoMazo) {
                return true;
            }
            const nombreBusqueda = String(obtenerNombreParentCartaMazo(carta) || carta?.Nombre || '').toLowerCase();
            return nombreBusqueda.includes(busquedaReemplazoMazo);
        })
        .filter((carta) => {
            if (afiliacionFiltroReemplazoMazo === 'todas') {
                return true;
            }
            const afiliaciones = obtenerAfiliacionesCartaMazo(carta).map(normalizarAfiliacionMazo);
            return afiliaciones.includes(normalizarAfiliacionMazo(afiliacionFiltroReemplazoMazo));
        })
        .sort(compararCartasPorPoderDesc);

    if (candidatasFiltradas.length === 0) {
        lista.innerHTML = '<p class="modal-reemplazo-vacio">No hay cartas que coincidan con los filtros.</p>';
        return;
    }

    candidatasFiltradas.forEach((carta) => {
        const item = crearCartaReemplazoElemento(carta);
        item.title = `${carta.Nombre} | Nivel ${carta.Nivel || 1} | Poder ${carta.Poder || 0} | ${obtenerEtiquetaFaccion(normalizarFaccion(carta.faccion))}`;

        item.addEventListener('click', function () {
            document.querySelectorAll('.item-carta-reemplazo').forEach((el) => el.classList.remove('seleccionada'));
            item.classList.add('seleccionada');
            cartaReemplazoSeleccionada = { ...carta };
        });

        lista.appendChild(item);
    });
}

function abrirModalCambioCarta(indiceCarta) {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const mazo = usuario?.mazos?.[mazoIndexSeleccionado];
    const cartaActual = mazo?.Cartas?.[indiceCarta];
    if (!cartaActual) {
        return;
    }

    indiceCartaEnEdicion = indiceCarta;
    cartaReemplazoSeleccionada = null;
    busquedaReemplazoMazo = '';
    afiliacionFiltroReemplazoMazo = 'todas';

    const inputBusqueda = document.getElementById('busqueda-reemplazo-mazo');
    if (inputBusqueda) {
        inputBusqueda.value = '';
    }

    document.getElementById('carta-a-reemplazar-texto').textContent =
        `Carta actual: ${cartaActual.Nombre} (Nivel ${cartaActual.Nivel || 1}, Poder ${cartaActual.Poder || 0})`;

    candidatasReemplazoCache = obtenerCartasCandidatasReemplazo().slice();
    poblarSelectorAfiliacionReemplazo(candidatasReemplazoCache);
    renderizarListaCartasReemplazo();

    document.getElementById('cambiar-carta-modal').style.display = 'flex';
}

function cerrarModalCambioCarta() {
    indiceCartaEnEdicion = -1;
    cartaReemplazoSeleccionada = null;
    busquedaReemplazoMazo = '';
    afiliacionFiltroReemplazoMazo = 'todas';
    candidatasReemplazoCache = [];
    document.getElementById('cambiar-carta-modal').style.display = 'none';
}

function abrirModalConfirmacionBorrado(mazoIndex) {
    mazoPendienteBorrado = mazoIndex;
    document.getElementById('confirmar-borrado-mazo-modal').style.display = 'flex';
}

function cerrarModalConfirmacionBorrado() {
    mazoPendienteBorrado = -1;
    document.getElementById('confirmar-borrado-mazo-modal').style.display = 'none';
}

async function confirmarCambioCarta() {
    if (indiceCartaEnEdicion < 0 || !cartaReemplazoSeleccionada) {
        mostrarMensaje('Selecciona una carta para reemplazar.', 'warning');
        return;
    }

    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');
    const mazo = usuario?.mazos?.[mazoIndexSeleccionado];
    if (!usuario || !email || !mazo) {
        mostrarMensaje('No se pudo actualizar el mazo.', 'danger');
        return;
    }

    mazo.Cartas[indiceCartaEnEdicion] = { ...cartaReemplazoSeleccionada };
    const faccionMazo = normalizarFaccion(mazo.Faccion || mazo.Cartas?.[0]?.faccion);
    mazo.Faccion = faccionMazo;

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        cerrarModalCambioCarta();
        cargarCartasDelMazo();
        mostrarMensaje('Carta cambiada y mazo guardado correctamente.', 'success');
    } catch (error) {
        console.error('Error al guardar cambios del mazo:', error);
        mostrarMensaje('Error al guardar el cambio de carta en Firebase.', 'danger');
    }
}

async function borrarMazo(mazoIndex) {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');
    if (!usuario || !Array.isArray(usuario.mazos) || !email) {
        mostrarMensaje('No se encontraron datos válidos del usuario.', 'danger');
        return;
    }

    try {
        usuario.mazos.splice(mazoIndex, 1);
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));

        if (usuario.mazos.length === 0) {
            document.getElementById('select-mazo').innerHTML = '';
            document.getElementById('contenedor-cartas').innerHTML = '';
            renderizarPoderTotal([]);
            bloquearGestionMazos(true);
            mostrarModalSinMazos();
        } else {
            configurarSelectorMazo();
            cargarCartasDelMazo();
        }

        mostrarMensaje('Mazo borrado correctamente de Firebase.', 'success');
    } catch (error) {
        console.error('Error al borrar el mazo en Firebase:', error);
        mostrarMensaje('Error al borrar el mazo en Firebase.', 'danger');
    }
}

async function actualizarUsuarioFirebase(usuario, email) {
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
        }
        throw new Error(data?.mensaje || 'Error en la solicitud de actualización.');
    }
    if (data?.usuario && usuario && typeof usuario === 'object') {
        Object.keys(usuario).forEach((k) => delete usuario[k]);
        Object.assign(usuario, data.usuario);
    }
    return data;
}

function mostrarModalSinMazos() {
    document.getElementById('aviso-sin-mazo-modal').style.display = 'flex';
}

function ocultarModalSinMazos() {
    document.getElementById('aviso-sin-mazo-modal').style.display = 'none';
}

function mostrarMensaje(mensaje, tipo = 'warning') {
    const mensajeDiv = document.getElementById('mensaje');
    if (!mensajeDiv) {
        return;
    }
    mensajeDiv.textContent = mensaje;
    mensajeDiv.className = `alert alert-${tipo}`;
    mensajeDiv.style.display = 'block';
    setTimeout(() => {
        mensajeDiv.style.display = 'none';
    }, 3000);
}

function logout() {
    localStorage.removeItem('usuario');
    localStorage.removeItem('email');
    localStorage.removeItem('jugandoPartida');
    localStorage.removeItem('mazoJugador');
    localStorage.removeItem('mazoOponente');
    window.location.href = '/login.html';
}
