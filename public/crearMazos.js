document.addEventListener('DOMContentLoaded', async function () {
    await cargarCartas();
    configurarEventos();
});

const cartasSeleccionadas = new Set();
let faccionVistaActiva = 'H';
let mapaDatosCartasCatalogo = null;
let afiliacionFiltroActiva = 'todas';

function normalizarFaccion(valor) {
    if (!valor) {
        return '';
    }

    const faccion = String(valor).trim().toUpperCase();
    if (faccion === 'H' || faccion === 'V') {
        return faccion;
    }

    return '';
}

function obtenerEtiquetaFaccion(faccion) {
    return faccion === 'H' ? 'Héroes' : 'Villanos';
}

function normalizarAfiliacion(afi) {
    return String(afi || '').trim().toLowerCase();
}

function calcularPoderTotalMazo(usuario) {
    let total = 0;

    cartasSeleccionadas.forEach(id => {
        const carta = usuario.cartas[id];
        if (carta) {
            total += Number(carta.Poder || 0);
        }
    });

    return total;
}

function obtenerSaludMaxCarta(carta) {
    if (!carta) {
        return 0;
    }

    const saludMax = Number(carta.SaludMax);
    if (Number.isFinite(saludMax) && saludMax > 0) {
        return saludMax;
    }

    const salud = Number(carta.Salud);
    if (Number.isFinite(salud) && salud > 0) {
        return salud;
    }

    return Math.max(Number(carta.Poder || 0), 0);
}

function obtenerSaludActualCarta(carta) {
    const saludMax = Math.max(obtenerSaludMaxCarta(carta), 0);
    const salud = Number(carta?.Salud);
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

function obtenerAfiliacionesCarta(carta) {
    const afiliacionRaw = String(carta?.Afiliacion || carta?.afiliacion || '');
    if (!afiliacionRaw.trim()) {
        return [];
    }

    return afiliacionRaw
        .split(';')
        .map(item => item.trim())
        .filter(Boolean);
}

function crearEtiquetaAfiliacion(afiliacion) {
    const texto = String(afiliacion || '').trim();
    if (!texto) {
        return '';
    }

    return texto
        .split(/\s+/)
        .map(parte => parte.charAt(0).toUpperCase() + parte.slice(1))
        .join(' ');
}

function obtenerAfiliacionesUnicasPorFaccion(usuario, faccionObjetivo) {
    const mapa = new Map();

    if (!usuario || !Array.isArray(usuario.cartas)) {
        return [];
    }

    usuario.cartas.forEach(carta => {
        if (normalizarFaccion(carta?.faccion) !== faccionObjetivo) {
            return;
        }

        obtenerAfiliacionesCarta(carta).forEach(afiliacion => {
            const clave = normalizarAfiliacion(afiliacion);
            if (clave && !mapa.has(clave)) {
                mapa.set(clave, afiliacion.trim());
            }
        });
    });

    return Array.from(mapa.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([, afiliacionOriginal]) => afiliacionOriginal);
}

function asegurarSelectorAfiliacion() {
    let wrapper = document.getElementById('afiliacion-filter-wrapper');
    let selector = document.getElementById('selector-afiliacion');

    if (wrapper && selector) {
        return selector;
    }

    const toolbar = document.querySelector('.faccion-toolbar');
    if (!toolbar) {
        return null;
    }

    wrapper = document.createElement('div');
    wrapper.id = 'afiliacion-filter-wrapper';
    wrapper.className = 'd-flex align-items-center';
    wrapper.style.gap = '8px';

    const etiqueta = document.createElement('label');
    etiqueta.htmlFor = 'selector-afiliacion';
    etiqueta.textContent = 'Afiliación:';
    etiqueta.style.margin = '0';

    selector = document.createElement('select');
    selector.id = 'selector-afiliacion';
    selector.className = 'form-control';
    selector.style.width = 'auto';
    selector.style.minWidth = '220px';

    selector.addEventListener('change', (event) => {
        afiliacionFiltroActiva = normalizarAfiliacion(event.target.value) || 'todas';
        const usuario = JSON.parse(localStorage.getItem('usuario'));
        if (usuario) {
            actualizarSeleccionUI(usuario);
        }
    });

    wrapper.appendChild(etiqueta);
    wrapper.appendChild(selector);
    toolbar.appendChild(wrapper);

    return selector;
}

function actualizarSelectorAfiliacion(usuario) {
    const selector = asegurarSelectorAfiliacion();
    if (!selector) {
        return;
    }

    const afiliaciones = obtenerAfiliacionesUnicasPorFaccion(usuario, faccionVistaActiva);
    const valorActual = afiliacionFiltroActiva;

    selector.innerHTML = '';

    const opcionTodas = document.createElement('option');
    opcionTodas.value = 'todas';
    opcionTodas.textContent = 'Todas';
    selector.appendChild(opcionTodas);

    afiliaciones.forEach(afiliacion => {
        const option = document.createElement('option');
        option.value = afiliacion;
        option.textContent = crearEtiquetaAfiliacion(afiliacion);
        selector.appendChild(option);
    });

    const existeValor = Array.from(selector.options)
        .some(option => normalizarAfiliacion(option.value) === normalizarAfiliacion(valorActual));
    afiliacionFiltroActiva = existeValor ? valorActual : 'todas';
    selector.value = afiliacionFiltroActiva === 'todas'
        ? 'todas'
        : (afiliaciones.find(af => normalizarAfiliacion(af) === normalizarAfiliacion(afiliacionFiltroActiva)) || 'todas');
}

function obtenerClaveCarta(nombreCarta) {
    return String(nombreCarta || '').trim().toLowerCase();
}

async function obtenerMapaDatosCartasCatalogo() {
    if (mapaDatosCartasCatalogo) {
        return mapaDatosCartasCatalogo;
    }

    const response = await fetch('resources/cartas.xlsx');
    if (!response.ok) {
        throw new Error('No se pudo cargar el Excel de cartas.');
    }

    const data = await response.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const cartasExcel = XLSX.utils.sheet_to_json(sheet);

    mapaDatosCartasCatalogo = new Map();
    cartasExcel.forEach(carta => {
        const faccion = normalizarFaccion(carta.faccion);
        const afiliacion = String(carta.Afiliacion || carta.afiliacion || '').trim();

        if (carta.Nombre && faccion) {
            mapaDatosCartasCatalogo.set(obtenerClaveCarta(carta.Nombre), {
                faccion,
                Afiliacion: afiliacion,
                Imagen: carta.Imagen || carta.imagen || '',
                imagen_final: carta.imagen_final || '',
                skill_name: String(carta.skill_name || '').trim(),
                skill_info: String(carta.skill_info || '').trim(),
                skill_class: String(carta.skill_class || '').trim().toLowerCase(),
                skill_power: carta.skill_power ?? '',
                skill_trigger: String(carta.skill_trigger || '').trim().toLowerCase()
            });
        }
    });

    return mapaDatosCartasCatalogo;
}

async function enriquecerCartasConDatosCatalogo(usuario) {
    if (!usuario || !Array.isArray(usuario.cartas)) {
        return usuario;
    }

    const mapaCatalogo = await obtenerMapaDatosCartasCatalogo();
    let huboCambios = false;

    usuario.cartas = usuario.cartas.map(carta => {
        const faccionActual = normalizarFaccion(carta.faccion);
        const afiliacionActual = String(carta?.Afiliacion || carta?.afiliacion || '').trim();
        const imagenActual = String(carta?.Imagen || carta?.imagen || '').trim();
        const imagenFinalActual = String(carta?.imagen_final || '').trim();
        const skillNameActual = String(carta?.skill_name || '').trim();
        const skillInfoActual = String(carta?.skill_info || '').trim();
        const skillClassActual = String(carta?.skill_class || '').trim().toLowerCase();
        const skillTriggerActual = String(carta?.skill_trigger || '').trim().toLowerCase();

        const datosCatalogo = mapaCatalogo.get(obtenerClaveCarta(carta.Nombre));
        if (!datosCatalogo) {
            return carta;
        }

        const faccionFinal = faccionActual || datosCatalogo.faccion;
        const afiliacionFinal = afiliacionActual || datosCatalogo.Afiliacion || '';
        const imagenFinal = datosCatalogo.Imagen || imagenActual || '';
        const imagenFinalNivel6 = datosCatalogo.imagen_final || imagenFinalActual || '';
        const fusionada = typeof window.fusionarSkillDesdeFilaCatalogo === 'function'
            ? window.fusionarSkillDesdeFilaCatalogo(carta, datosCatalogo)
            : carta;
        if (typeof window.recalcularSkillPowerPorNivel === 'function') {
            window.recalcularSkillPowerPorNivel(fusionada, Number(fusionada.Nivel || carta.Nivel || 1));
        }
        const skillNameFinal = String(fusionada.skill_name || '').trim();
        const skillInfoFinal = String(fusionada.skill_info || '').trim();
        const skillClassFinal = String(fusionada.skill_class || '').trim().toLowerCase();
        const skillTriggerFinal = String(fusionada.skill_trigger || '').trim().toLowerCase();
        const skillPowerFinal = fusionada.skill_power;

        // 🔥 Detectar si hay cambios reales
        if (
            faccionFinal === faccionActual &&
            afiliacionFinal === afiliacionActual &&
            imagenFinal === imagenActual &&
            imagenFinalNivel6 === imagenFinalActual &&
            skillNameFinal === skillNameActual &&
            skillInfoFinal === skillInfoActual &&
            skillClassFinal === skillClassActual &&
            skillTriggerFinal === skillTriggerActual &&
            String(skillPowerFinal ?? '') === String(carta.skill_power ?? '')
        ) {
            return carta;
        }

        huboCambios = true;

        return {
            ...fusionada,
            faccion: faccionFinal,
            Afiliacion: afiliacionFinal,
            Imagen: imagenFinal,
            imagen_final: imagenFinalNivel6
        };
    });

    if (huboCambios) {
        localStorage.setItem('usuario', JSON.stringify(usuario));
    }

    return usuario;
}

function obtenerFaccionSeleccionActual(usuario) {
    const facciones = new Set(
        Array.from(cartasSeleccionadas)
            .map(id => normalizarFaccion(usuario.cartas[id]?.faccion))
            .filter(Boolean)
    );

    if (facciones.size === 1) {
        return Array.from(facciones)[0];
    }

    return null;
}

function actualizarIndicadorFaccion(usuario) {
    const indicador = document.getElementById('faccion-actual');
    const faccionSeleccionada = obtenerFaccionSeleccionActual(usuario);

    if (faccionSeleccionada) {
        indicador.textContent = `Mazo en preparación: ${obtenerEtiquetaFaccion(faccionSeleccionada)}`;
        return;
    }

    indicador.textContent = `Vista actual: ${obtenerEtiquetaFaccion(faccionVistaActiva)}`;
}

function actualizarPestanas() {
    document.querySelectorAll('.faccion-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.faccion === faccionVistaActiva);
    });
}

function aplicarFiltroFaccion(usuario) {
    const faccionSeleccionada = obtenerFaccionSeleccionActual(usuario);
    const afiliacionFiltroNormalizada = normalizarAfiliacion(afiliacionFiltroActiva);

    document.querySelectorAll('#contenedor-cartas .carta').forEach(cartaDiv => {
        const idCarta = Number(cartaDiv.dataset.id);
        const faccionCarta = normalizarFaccion(usuario.cartas[idCarta]?.faccion);
        const afiliacionesCarta = obtenerAfiliacionesCarta(usuario.cartas[idCarta]).map(normalizarAfiliacion);
        const coincideAfiliacion = afiliacionFiltroNormalizada === 'todas'
            ? true
            : afiliacionesCarta.includes(afiliacionFiltroNormalizada);
        const debeMostrarse = faccionCarta === faccionVistaActiva && coincideAfiliacion;

        cartaDiv.classList.toggle('oculta-por-faccion', !debeMostrarse);

        if (!debeMostrarse) {
            return;
        }

        if (faccionSeleccionada && faccionCarta !== faccionSeleccionada) {
            cartaDiv.style.pointerEvents = 'none';
            cartaDiv.style.opacity = '0.35';
            cartaDiv.style.filter = 'grayscale(100%)';
        } else {
            cartaDiv.style.pointerEvents = 'auto';
            cartaDiv.style.opacity = '1';
            cartaDiv.style.filter = 'none';
        }
    });
}

async function cargarCartas() {
    let usuario = JSON.parse(localStorage.getItem('usuario'));

    try {
        usuario = await enriquecerCartasConDatosCatalogo(usuario);
    } catch (error) {
        console.error('No se pudieron enriquecer las cartas del usuario desde el Excel:', error);
    }

    if (!usuario || !Array.isArray(usuario.cartas)) {
        console.error('No se encontraron cartas para el usuario.');
        return;
    }

    const contenedorCartas = document.getElementById('contenedor-cartas');
    contenedorCartas.innerHTML = '';

    const itemsCartas = usuario.cartas
        .map((carta, index) => ({ carta, index }));

    const cartasSinDuplicados = typeof window.deduplicarItemsCartasUsuarioMejorNivel === 'function'
        ? window.deduplicarItemsCartasUsuarioMejorNivel(itemsCartas)
        : (() => {
            const mejorPorNombre = new Map();
            itemsCartas.forEach((item) => {
                const clave = String(item?.carta?.Nombre || '').trim().toLowerCase();
                if (!clave) {
                    return;
                }
                const nivelActual = Math.max(1, Number(item.carta?.Nivel || 1));
                const previo = mejorPorNombre.get(clave);
                if (!previo) {
                    mejorPorNombre.set(clave, item);
                    return;
                }
                const nivelPrevio = Math.max(1, Number(previo.carta?.Nivel || 1));
                if (nivelActual > nivelPrevio || (nivelActual === nivelPrevio && item.index < previo.index)) {
                    mejorPorNombre.set(clave, item);
                }
            });
            return Array.from(mejorPorNombre.values());
        })();

    const cartasOrdenadas = cartasSinDuplicados
        .sort((a, b) => {
            const diferenciaFaccion = normalizarFaccion(a.carta.faccion).localeCompare(normalizarFaccion(b.carta.faccion));
            if (diferenciaFaccion !== 0) {
                return diferenciaFaccion;
            }

            const diferenciaPoder = (b.carta.Poder || 0) - (a.carta.Poder || 0);
            if (diferenciaPoder !== 0) {
                return diferenciaPoder;
            }

            return a.carta.Nombre.localeCompare(b.carta.Nombre);
        });

    cartasOrdenadas.forEach(({ carta, index }) => {
        const faccionCarta = normalizarFaccion(carta.faccion);

        if (!faccionCarta) {
            return;
        }

        const cartaDiv = document.createElement('div');
        cartaDiv.classList.add('carta');
        if (Number(carta.Nivel || 1) >= 6) {
            cartaDiv.classList.add('nivel-legendaria');
        }
        cartaDiv.dataset.id = index;

        const imagenUrl = obtenerImagenCarta(carta);
        cartaDiv.style.backgroundImage = `url(${imagenUrl})`;
        cartaDiv.style.backgroundSize = 'cover';
        cartaDiv.style.backgroundPosition = 'center';

        const detallesDiv = document.createElement('div');
        detallesDiv.classList.add('detalles-carta');

        const nombreSpan = document.createElement('span');
        nombreSpan.classList.add('nombre-carta');
        nombreSpan.textContent = carta.Nombre;

        const poderSpan = document.createElement('span');
        poderSpan.classList.add('poder-carta');
        poderSpan.textContent = carta.Poder;

        detallesDiv.appendChild(nombreSpan);
        detallesDiv.appendChild(poderSpan);

        const estrellasDiv = document.createElement('div');
        estrellasDiv.classList.add('estrellas-carta');

        const nivel = carta.Nivel || 1;
        for (let i = 0; i < nivel; i++) {
            const estrella = document.createElement('img');
            estrella.classList.add('estrella');
            estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
            estrella.alt = 'star';
            estrellasDiv.appendChild(estrella);
        }

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
        cartaDiv.appendChild(estrellasDiv);
        cartaDiv.onclick = () => seleccionarCarta(cartaDiv);

        contenedorCartas.appendChild(cartaDiv);
    });

    actualizarSeleccionUI(usuario);
}

function actualizarSeleccionUI(usuario) {
    const faccionSeleccionada = obtenerFaccionSeleccionActual(usuario);
    const formulario = document.getElementById('formulario-mazo');
    const botonGuardar = document.getElementById('guardar-mazo');
    const botonDeseleccionarTodo = document.getElementById('btn-deseleccionar-todo');
    actualizarSelectorAfiliacion(usuario);

    document.querySelectorAll('#contenedor-cartas .carta').forEach(cartaDiv => {
        const idCarta = cartaDiv.dataset.id;
        const faccionCarta = normalizarFaccion(usuario.cartas[idCarta]?.faccion);
        const estaSeleccionada = cartasSeleccionadas.has(idCarta);

        if (estaSeleccionada) {
            cartaDiv.style.boxShadow = cartasSeleccionadas.size === 12
                ? '0 0 10px 5px green'
                : '0 0 10px 5px yellow';
        } else {
            cartaDiv.style.boxShadow = '';
        }

        if (faccionSeleccionada && faccionCarta !== faccionSeleccionada) {
            cartaDiv.style.pointerEvents = 'none';
            cartaDiv.style.opacity = '0.35';
            cartaDiv.style.filter = 'grayscale(100%)';
        } else {
            cartaDiv.style.pointerEvents = 'auto';
            cartaDiv.style.opacity = '1';
            cartaDiv.style.filter = 'none';
        }
    });

    if (formulario) {
        formulario.style.display = 'block';
    }
    if (botonGuardar) {
        botonGuardar.disabled = cartasSeleccionadas.size !== 12;
    }
    if (botonDeseleccionarTodo) {
        botonDeseleccionarTodo.disabled = cartasSeleccionadas.size === 0;
    }
    actualizarIndicadorFaccion(usuario);
    actualizarPestanas();
    aplicarFiltroFaccion(usuario);

    const poderTotal = calcularPoderTotalMazo(usuario);
    const label = document.getElementById('poder-total-mazo');
    const contadorCartas = document.getElementById('contador-cartas-mazo');

    if (label) {
        label.textContent = poderTotal;

        // 🔥 Limpia clases anteriores
        label.classList.remove(
            'poder-bajo',
            'poder-medio',
            'poder-alto',
            'poder-legendario'
        );

        // 🎯 Asignar nivel
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

    if (contadorCartas) {
        const seleccionadas = cartasSeleccionadas.size;
        contadorCartas.textContent = `${seleccionadas}/12`;
        contadorCartas.classList.toggle('cartas-completas', seleccionadas === 12);
        contadorCartas.classList.toggle('cartas-incompletas', seleccionadas < 12);
    }

}

function seleccionarCarta(cartaDiv) {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const idCarta = cartaDiv.dataset.id;
    const carta = usuario?.cartas?.[idCarta];

    if (!carta) {
        mostrarMensaje('No se ha podido leer la carta seleccionada.', 'danger');
        return;
    }

    const faccionCarta = normalizarFaccion(carta.faccion);
    if (!faccionCarta) {
        mostrarMensaje(`La carta ${carta.Nombre} no tiene una facción válida.`, 'danger');
        return;
    }

    const faccionActual = obtenerFaccionSeleccionActual(usuario);

    if (cartasSeleccionadas.has(idCarta)) {
        cartasSeleccionadas.delete(idCarta);
        actualizarSeleccionUI(usuario);
        return;
    }

    if (cartasSeleccionadas.size >= 12) {
        mostrarMensaje('Has alcanzado el máximo de 12 cartas.');
        return;
    }

    if (faccionActual && faccionCarta !== faccionActual) {
        mostrarMensaje(`Este mazo ya es de ${obtenerEtiquetaFaccion(faccionActual)}. No puedes mezclar facciones.`, 'danger');
        return;
    }

    cartasSeleccionadas.add(idCarta);
    faccionVistaActiva = faccionCarta;
    actualizarSeleccionUI(usuario);
}

function deseleccionarTodasLasCartas() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    if (!usuario || cartasSeleccionadas.size === 0) {
        return;
    }
    cartasSeleccionadas.clear();
    actualizarSeleccionUI(usuario);
}

function cambiarVistaFaccion(faccion) {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const faccionNormalizada = normalizarFaccion(faccion);

    if (!usuario || !faccionNormalizada) {
        return;
    }

    const faccionSeleccionada = obtenerFaccionSeleccionActual(usuario);
    if (faccionSeleccionada && faccionSeleccionada !== faccionNormalizada) {
        mostrarMensaje(`Tu selección actual ya está bloqueada a ${obtenerEtiquetaFaccion(faccionSeleccionada)}.`, 'warning');
        return;
    }

    faccionVistaActiva = faccionNormalizada;
    afiliacionFiltroActiva = 'todas';
    actualizarSeleccionUI(usuario);
}

function configurarEventos() {
    document.getElementById('guardar-mazo').onclick = guardarMazo;
    const btnDeseleccionarTodo = document.getElementById('btn-deseleccionar-todo');
    if (btnDeseleccionarTodo) {
        btnDeseleccionarTodo.onclick = deseleccionarTodasLasCartas;
    }

    document.querySelectorAll('.faccion-tab').forEach(tab => {
        tab.addEventListener('click', () => cambiarVistaFaccion(tab.dataset.faccion));
    });
}

async function guardarMazo() {
    const nombreMazo = document.getElementById('nombre-mazo').value.trim();

    if (!nombreMazo) {
        mostrarMensaje('Por favor, introduce un nombre para el mazo.');
        return;
    }

    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');

    if (!email) {
        mostrarMensaje('No se ha encontrado un email de usuario válido.', 'danger');
        return;
    }

    if (!usuario.mazos) {
        usuario.mazos = [];
    }

    const cartasSeleccionadasArray = Array.from(cartasSeleccionadas).map(id => usuario.cartas[id]);
    const faccionesMazo = new Set(cartasSeleccionadasArray.map(carta => normalizarFaccion(carta?.faccion)).filter(Boolean));

    if (cartasSeleccionadasArray.length !== 12) {
        mostrarMensaje('El mazo debe contener exactamente 12 cartas.', 'warning');
        return;
    }

    if (faccionesMazo.size !== 1) {
        mostrarMensaje('Cada mazo debe contener cartas de una única facción: Héroes o Villanos.', 'danger');
        return;
    }

    const faccionMazo = Array.from(faccionesMazo)[0];
    const nuevoMazo = {
        Nombre: nombreMazo,
        Faccion: faccionMazo,
        Cartas: cartasSeleccionadasArray
    };

    usuario.mazos.push(nuevoMazo);

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        mostrarMensaje(`Mazo de ${obtenerEtiquetaFaccion(faccionMazo)} guardado correctamente en Firebase.`, 'success');
        resetFormulario();
    } catch (error) {
        console.error('Error al guardar el mazo en Firebase:', error);
        mostrarMensaje('Error al guardar el mazo en Firebase.', 'danger');
    }
}

async function actualizarUsuarioFirebase(usuario, email) {
    try {
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
    } catch (error) {
        console.error('Error al actualizar el usuario en Firebase:', error);
        throw error;
    }
}

function mostrarMensaje(mensaje, tipo = 'warning') {
    const mensajeDiv = document.getElementById('mensaje');
    mensajeDiv.textContent = mensaje;
    mensajeDiv.className = `alert alert-${tipo}`;
    mensajeDiv.style.display = 'block';
    setTimeout(() => mensajeDiv.style.display = 'none', 3000);
}

function resetFormulario() {
    cartasSeleccionadas.clear();
    faccionVistaActiva = 'H';
    const botonGuardar = document.getElementById('guardar-mazo');
    if (botonGuardar) {
        botonGuardar.disabled = true;
    }
    document.getElementById('nombre-mazo').value = '';
    cargarCartas();
}

function actualizarSelectorMazo() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const selectMazo = document.getElementById('select-mazo');

    selectMazo.innerHTML = '';
    const todasLasCartasOption = document.createElement('option');
    todasLasCartasOption.value = 'todas';
    todasLasCartasOption.textContent = 'Todas las cartas';
    selectMazo.appendChild(todasLasCartasOption);

    if (usuario && usuario.mazos) {
        usuario.mazos.forEach((mazo, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = mazo.Nombre;
            selectMazo.appendChild(option);
        });
    }
}

function logout() {
    localStorage.removeItem('usuario');
    window.location.href = '/login.html';
}
