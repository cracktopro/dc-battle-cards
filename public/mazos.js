let mazoIndexSeleccionado = -1;
let indiceCartaEnEdicion = -1;
let cartaReemplazoSeleccionada = null;
let mazoPendienteBorrado = -1;

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

async function inicializarVistaMazos() {
    await sincronizarLocalStorage();
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
        cargarCartasDelMazo();
    });

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

    document.getElementById('cancelar-cambio-carta-btn').addEventListener('click', function () {
        cerrarModalCambioCarta();
    });

    document.getElementById('confirmar-cambio-carta-btn').addEventListener('click', async function () {
        await confirmarCambioCarta();
    });

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
    if (Number(carta?.Nivel || 1) >= 6) {
        cartaDiv.classList.add('nivel-legendaria');
    }

    const imagenUrl = obtenerImagenCarta(carta);
    cartaDiv.style.backgroundImage = `url(${imagenUrl})`;
    cartaDiv.style.backgroundSize = 'cover';
    cartaDiv.style.backgroundPosition = 'center';

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
    const nivel = Number(carta?.Nivel || 1);
    for (let i = 0; i < nivel; i++) {
        const estrella = document.createElement('img');
        estrella.classList.add('estrella');
        estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
        estrella.alt = 'star';
        estrellasDiv.appendChild(estrella);
    }

    cartaDiv.appendChild(detallesDiv);
    cartaDiv.appendChild(estrellasDiv);
    cartaDiv.addEventListener('click', function () {
        abrirModalCambioCarta(indiceCarta);
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
        .sort((a, b) => String(a.carta?.Nombre || '').localeCompare(String(b.carta?.Nombre || '')));

    cartasOrdenadasConIndiceReal.forEach(({ carta, originalIndex }) => {
        // Usar el índice real del mazo evita reemplazar la carta equivocada.
        contenedorCartas.appendChild(crearCartaMazoElemento(carta, originalIndex));
    });

    renderizarPoderTotal(cartasMazoOriginal);
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
            .map(carta => String(carta?.Nombre || '').trim().toLowerCase())
            .filter(Boolean)
    );

    // No permitimos reemplazar por cartas que ya forman parte del mazo.
    return (usuario.cartas || []).filter(carta => {
        if (normalizarFaccion(carta?.faccion) !== faccionMazo) {
            return false;
        }

        const nombre = String(carta?.Nombre || '').trim().toLowerCase();
        return Boolean(nombre) && !nombresEnMazo.has(nombre);
    });
}

function crearCartaReemplazoElemento(carta) {
    const item = document.createElement('div');
    item.classList.add('carta', 'item-carta-reemplazo');
    if (Number(carta?.Nivel || 1) >= 6) {
        item.classList.add('nivel-legendaria');
    }

    const imagenUrl = obtenerImagenCarta(carta);
    item.style.backgroundImage = `url(${imagenUrl})`;
    item.style.backgroundSize = 'cover';
    item.style.backgroundPosition = 'center';

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
    const nivel = Number(carta?.Nivel || 1);
    for (let i = 0; i < nivel; i++) {
        const estrella = document.createElement('img');
        estrella.classList.add('estrella');
        estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
        estrella.alt = 'star';
        estrellasDiv.appendChild(estrella);
    }

    item.appendChild(detallesDiv);
    item.appendChild(estrellasDiv);
    return item;
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
    document.getElementById('carta-a-reemplazar-texto').textContent =
        `Carta actual: ${cartaActual.Nombre} (Nivel ${cartaActual.Nivel || 1}, Poder ${cartaActual.Poder || 0})`;

    const lista = document.getElementById('lista-cartas-reemplazo');
    lista.innerHTML = '';

    const candidatas = obtenerCartasCandidatasReemplazo();
    if (candidatas.length === 0) {
        lista.innerHTML = '<p>No hay cartas disponibles para reemplazar en este mazo.</p>';
    }

    candidatas.forEach(carta => {
        const item = crearCartaReemplazoElemento(carta);
        item.title = `${carta.Nombre} | Nivel ${carta.Nivel || 1} | Poder ${carta.Poder || 0} | ${obtenerEtiquetaFaccion(normalizarFaccion(carta.faccion))}`;

        item.addEventListener('click', function () {
            document.querySelectorAll('.item-carta-reemplazo').forEach(el => el.classList.remove('seleccionada'));
            item.classList.add('seleccionada');
            cartaReemplazoSeleccionada = { ...carta };
        });

        lista.appendChild(item);
    });

    document.getElementById('cambiar-carta-modal').style.display = 'flex';
}

function cerrarModalCambioCarta() {
    indiceCartaEnEdicion = -1;
    cartaReemplazoSeleccionada = null;
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

    if (!response.ok) {
        throw new Error('Error en la solicitud de actualización.');
    }

    return response.json();
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
