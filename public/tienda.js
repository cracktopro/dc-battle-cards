const PRECIOS_CARTAS = {
    1: 100,
    2: 250,
    3: 500,
    4: 1000,
    5: 2000
};

const DISTRIBUCION_TIENDA = [
    { nivel: 1, cantidad: 4 },
    { nivel: 2, cantidad: 3 },
    { nivel: 3, cantidad: 2 },
    { nivel: 4, cantidad: 2 },
    { nivel: 5, cantidad: 1 }
];

const OBJETOS_TIENDA = [
    {
        id: 'obj-mejora-carta',
        nombre: 'Mejora de carta',
        descripcion: 'Solo usable en cartas nivel 1 a 3. Permite subir hasta nivel 4.',
        precio: 500,
        icono: '/resources/icons/mejora.png'
    },
    {
        id: 'obj-mejora-especial',
        nombre: 'Mejora especial',
        descripcion: 'Solo usable en cartas de nivel 5. Eleva la carta a nivel 6.',
        precio: 3000,
        icono: '/resources/icons/mejora_especial.png'
    }
];
const ICONOS_OBJETO_POR_ID = {
    'obj-mejora-carta': '/resources/icons/mejora.png',
    'obj-mejora-especial': '/resources/icons/mejora_especial.png',
    ...(typeof window.DC_SOBRES_ICONOS_POR_ID === 'object' && window.DC_SOBRES_ICONOS_POR_ID ? window.DC_SOBRES_ICONOS_POR_ID : {})
};
const ICONO_MONEDA = '/resources/icons/moneda.png';

let usuarioActual = null;
let emailActual = null;
const VERSION_TIENDA_GLOBAL = 'global-rotation-v1';
const ROTACION_TIENDA_MS = 2 * 60 * 60 * 1000;
let temporizadorRotacion = null;

document.addEventListener('DOMContentLoaded', async () => {
    usuarioActual = JSON.parse(localStorage.getItem('usuario'));
    emailActual = localStorage.getItem('email');

    if (!usuarioActual || !emailActual) {
        window.location.href = '/login.html';
        return;
    }

    usuarioActual.cartas = Array.isArray(usuarioActual.cartas) ? usuarioActual.cartas : [];
    usuarioActual.puntos = Number(usuarioActual.puntos || 0);
    const objsRaw = (usuarioActual.objetos && typeof usuarioActual.objetos === 'object') ? usuarioActual.objetos : {};
    usuarioActual.objetos = { ...objsRaw };
    usuarioActual.objetos.mejoraCarta = Number(usuarioActual.objetos.mejoraCarta || 0);
    usuarioActual.objetos.mejoraEspecial = Number(usuarioActual.objetos.mejoraEspecial || 0);
    if (typeof window.DC_SOBRES_MEZCLAR_INVENTARIO === 'function') {
        usuarioActual.objetos = window.DC_SOBRES_MEZCLAR_INVENTARIO(usuarioActual.objetos);
    }

    try {
        await prepararTiendaDiaria();
        renderizarTienda();
        iniciarTemporizadorRotacion();
    } catch (error) {
        console.error('Error al preparar la tienda:', error);
        mostrarMensaje('No se pudo cargar la tienda diaria.', 'danger');
    }
});

function obtenerFechaHoy() {
    const fecha = new Date();
    const yyyy = fecha.getFullYear();
    const mm = String(fecha.getMonth() + 1).padStart(2, '0');
    const dd = String(fecha.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function obtenerVentanaRotacion() {
    const ahora = Date.now();
    const idVentana = Math.floor(ahora / ROTACION_TIENDA_MS);
    const inicio = idVentana * ROTACION_TIENDA_MS;
    const fin = inicio + ROTACION_TIENDA_MS;
    return { ahora, idVentana, inicio, fin };
}

function hashString(valor) {
    let hash = 2166136261;
    for (let i = 0; i < valor.length; i++) {
        hash ^= valor.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return hash >>> 0;
}

function crearRngSemilla(semillaTexto) {
    let estado = hashString(semillaTexto) || 123456789;
    return () => {
        estado = (1664525 * estado + 1013904223) >>> 0;
        return estado / 4294967296;
    };
}

function normalizarNombreCarta(nombre) {
    return String(nombre || '').trim().toLowerCase();
}

/** Mejor nivel que el jugador tiene de esa carta en colección (0 si no la tiene). */
function obtenerMejorNivelUsuarioEnColeccion(nombreCarta) {
    const clave = normalizarNombreCarta(nombreCarta);
    if (!clave) {
        return 0;
    }
    let mejor = 0;
    (usuarioActual.cartas || []).forEach((carta) => {
        if (normalizarNombreCarta(carta?.Nombre) !== clave) {
            return;
        }
        mejor = Math.max(mejor, Number(carta?.Nivel || 1));
    });
    return mejor;
}

function crearBadgeYaObtenidaTienda(nivelColeccion) {
    const wrap = document.createElement('div');
    wrap.className = 'tienda-badge-carta-obtenida';
    const linea1 = document.createElement('div');
    linea1.className = 'tienda-badge-carta-obtenida-titulo';
    linea1.textContent = 'Ya obtenida';
    const linea2 = document.createElement('div');
    linea2.className = 'tienda-badge-carta-obtenida-nivel';
    linea2.textContent = `Nivel: ${Math.max(1, Math.floor(Number(nivelColeccion || 1)))}`;
    wrap.appendChild(linea1);
    wrap.appendChild(linea2);
    return wrap;
}

function escalarPoderPorNivel(poderBase, nivel) {
    const base = Number(poderBase || 0);
    const objetivo = Math.max(1, Number(nivel || 1));
    return base + ((objetivo - 1) * 500);
}

function crearOfertaCarta(cartaBase, nivel) {
    const srcCarta = typeof window.fusionarSkillDesdeFilaCatalogo === 'function'
        ? window.fusionarSkillDesdeFilaCatalogo({ ...cartaBase }, cartaBase)
        : { ...cartaBase };
    const saludBase = Number((srcCarta.SaludMax ?? srcCarta.Salud ?? srcCarta.Poder) || 0);
    const saludEscalada = escalarPoderPorNivel(saludBase, nivel);
    return {
        id: `oferta-${normalizarNombreCarta(cartaBase.Nombre)}-${nivel}`,
        carta: {
            ...srcCarta,
            Nivel: nivel,
            Poder: escalarPoderPorNivel(cartaBase.Poder, nivel),
            SaludMax: saludEscalada,
            Salud: saludEscalada
        },
        nivel,
        precio: PRECIOS_CARTAS[nivel],
        agotada: false
    };
}

function seleccionarSinDuplicados(pool, cantidad, nombresUsados, rng) {
    const copia = [...pool];
    const seleccion = [];

    while (copia.length > 0 && seleccion.length < cantidad) {
        const indexAleatorio = Math.floor(rng() * copia.length);
        const carta = copia.splice(indexAleatorio, 1)[0];
        const claveNombre = normalizarNombreCarta(carta.Nombre);

        if (!claveNombre || nombresUsados.has(claveNombre)) {
            continue;
        }

        nombresUsados.add(claveNombre);
        seleccion.push(carta);
    }

    return seleccion;
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

async function generarCartasTienda(fechaSemilla) {
    const catalogo = await cargarCatalogoCartas();
    const nombresUsados = new Set();
    const ofertas = [];
    const rng = crearRngSemilla(`tienda-cartas-${fechaSemilla}`);

    DISTRIBUCION_TIENDA.forEach(({ nivel, cantidad }) => {
        const poolNivel = catalogo.filter(carta => Number(carta.Nivel || 1) <= nivel);
        const candidatas = poolNivel.length > 0 ? poolNivel : catalogo;
        const seleccion = seleccionarSinDuplicados(candidatas, cantidad, nombresUsados, rng);

        seleccion.forEach(carta => {
            ofertas.push(crearOfertaCarta(carta, nivel));
        });
    });

    if (ofertas.length < 11) {
        const faltantes = 11 - ofertas.length;
        const extras = seleccionarSinDuplicados(catalogo, faltantes, nombresUsados, rng);
        extras.forEach((carta, index) => {
            const nivel = index % 5 + 1;
            ofertas.push(crearOfertaCarta(carta, nivel));
        });
    }

    return ofertas.slice(0, 11);
}

function crearObjetosTienda() {
    const objetosFijos = OBJETOS_TIENDA.map(objeto => ({ ...objeto }));
    const sobres = (typeof window.DC_SOBRES_ITEMS_TIENDA === 'function')
        ? window.DC_SOBRES_ITEMS_TIENDA()
        : [];
    return objetosFijos.concat(sobres.map((s) => ({
        ...s,
        icono: s.icono || ICONOS_OBJETO_POR_ID[s.id] || ''
    })));
}

function normalizarObjetosTienda() {
    return crearObjetosTienda();
}

async function prepararTiendaDiaria() {
    const { idVentana } = obtenerVentanaRotacion();
    const tiendaUsuario = usuarioActual.tienda;

    const tiendaVigente = tiendaUsuario
        && Number(tiendaUsuario.ventanaId) === idVentana
        && Array.isArray(tiendaUsuario.cartas)
        && Array.isArray(tiendaUsuario.objetos)
        && tiendaUsuario.version === VERSION_TIENDA_GLOBAL;

    if (!tiendaVigente) {
        usuarioActual.tienda = {
            fecha: obtenerFechaHoy(),
            ventanaId: idVentana,
            cartas: await generarCartasTienda(String(idVentana)),
            objetos: crearObjetosTienda(),
            version: VERSION_TIENDA_GLOBAL
        };
        await persistirUsuario();
    } else {
        usuarioActual.tienda.objetos = normalizarObjetosTienda();
    }
}

function actualizarPuntosUI() {
    const puntosDiv = document.getElementById('puntos-usuario');
    puntosDiv.innerHTML = `
        <span style="display:inline-flex;align-items:center;gap:8px;">
            <img src="${ICONO_MONEDA}" alt="Moneda" style="width:28px;height:28px;object-fit:contain;">
            <span>${Number(usuarioActual.puntos || 0)}</span>
        </span>
    `;
}

function actualizarFechaUI() {
    // Reemplazado por temporizador de rotación.
}

function crearEstrellasNivel(nivel) {
    const estrellasDiv = document.createElement('div');
    estrellasDiv.classList.add('estrellas-carta');

    for (let i = 0; i < nivel; i++) {
        const estrella = document.createElement('img');
        estrella.classList.add('estrella');
        estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
        estrella.alt = 'star';
        estrellasDiv.appendChild(estrella);
    }

    return estrellasDiv;
}

function crearDetallesCarta(carta) {
    const detallesDiv = document.createElement('div');
    detallesDiv.classList.add('detalles-carta');

    const nombreSpan = document.createElement('span');
    nombreSpan.classList.add('nombre-carta');
    nombreSpan.textContent = carta.Nombre;

    const poderSpan = document.createElement('span');
    poderSpan.classList.add('poder-carta');
    poderSpan.textContent = carta.Poder;
    if (Number(carta.Nivel || 1) >= 6) {
        poderSpan.style.color = '#d5b5ff';
    }

    detallesDiv.appendChild(nombreSpan);
    detallesDiv.appendChild(poderSpan);
    return detallesDiv;
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

function renderizarCartasTienda() {
    const contenedor = document.getElementById('tienda-cartas');
    contenedor.innerHTML = '';

    usuarioActual.tienda.cartas.forEach((oferta, index) => {
        const item = document.createElement('div');
        item.className = `item-tienda ${oferta.agotada ? 'agotada' : ''}`;

        const preview = document.createElement('div');
        preview.className = 'preview-carta';
        if (Number(oferta.carta.Nivel || 1) >= 6) {
            preview.classList.add('nivel-legendaria');
        }
        preview.style.backgroundImage = `url(${obtenerImagenCarta(oferta.carta)})`;

        preview.appendChild(crearEstrellasNivel(oferta.nivel));
        preview.appendChild(crearDetallesCarta(oferta.carta));
        const badgeHabilidad = window.crearBadgeHabilidadCarta ? window.crearBadgeHabilidadCarta(oferta.carta) : null;
        if (badgeHabilidad) {
            preview.appendChild(badgeHabilidad);
        }
        preview.appendChild(crearBarraSaludElemento(oferta.carta));

        const nivelColeccionUsuario = obtenerMejorNivelUsuarioEnColeccion(oferta.carta.Nombre);
        if (nivelColeccionUsuario > 0) {
            preview.appendChild(crearBadgeYaObtenidaTienda(nivelColeccionUsuario));
        }

        const precio = document.createElement('div');
        precio.className = 'precio-item';
        precio.innerHTML = `Precio: ${oferta.precio} <img src="${ICONO_MONEDA}" alt="Moneda" style="width:18px;height:18px;object-fit:contain;vertical-align:text-bottom;margin-left:4px;">`;

        const boton = document.createElement('button');
        boton.className = 'btn btn-primary';
        boton.textContent = oferta.agotada ? 'Comprada' : 'Comprar';

        const sinPuntos = usuarioActual.puntos < oferta.precio;
        boton.disabled = Boolean(oferta.agotada || sinPuntos);
        boton.addEventListener('click', () => comprarCarta(index));

        item.appendChild(preview);
        item.appendChild(precio);
        item.appendChild(boton);
        contenedor.appendChild(item);
    });
}
function renderizarObjetosTienda() {
    const contenedorPadre = document.getElementById('tienda-objetos');
    if (!contenedorPadre) {
        return;
    }
    contenedorPadre.innerHTML = '';
    contenedorPadre.classList.remove('objetos-grid');
    contenedorPadre.classList.add('tienda-objetos-layout');

    const lista = normalizarObjetosTienda();
    usuarioActual.tienda.objetos = lista;

    const filaMejoras = document.createElement('div');
    filaMejoras.className = 'tienda-objetos-fila tienda-objetos-mejoras';

    const subtHero = document.createElement('h5');
    subtHero.className = 'tienda-objetos-subtitulo';
    subtHero.textContent = 'Sobres de héroe';

    const filaSobresHeroes = document.createElement('div');
    filaSobresHeroes.className = 'tienda-objetos-fila tienda-objetos-sobres-heroes';

    const subtVill = document.createElement('h5');
    subtVill.className = 'tienda-objetos-subtitulo';
    subtVill.textContent = 'Sobres de villano';

    const filaSobresVill = document.createElement('div');
    filaSobresVill.className = 'tienda-objetos-fila tienda-objetos-sobres-villanos';

    lista.forEach((objeto) => {
        const item = crearTarjetaObjetoTienda(objeto);

        if (objeto.id === 'obj-mejora-carta' || objeto.id === 'obj-mejora-especial') {
            filaMejoras.appendChild(item);
        } else if (objeto.id && /^obj-sobre-h\d$/i.test(objeto.id)) {
            filaSobresHeroes.appendChild(item);
        } else if (objeto.id && /^obj-sobre-v\d$/i.test(objeto.id)) {
            filaSobresVill.appendChild(item);
        } else {
            filaMejoras.appendChild(item);
        }
    });

    contenedorPadre.appendChild(filaMejoras);
    contenedorPadre.appendChild(subtHero);
    contenedorPadre.appendChild(filaSobresHeroes);
    contenedorPadre.appendChild(subtVill);
    contenedorPadre.appendChild(filaSobresVill);
}

function crearTarjetaObjetoTienda(objeto) {
    const esSobre = objeto.id && String(objeto.id).startsWith('obj-sobre-');
    const item = document.createElement('div');
    item.className = esSobre ? 'objeto-tienda objeto-tienda-sobre' : 'objeto-tienda objeto-tienda-mejora';

    if (!esSobre) {
        const header = document.createElement('div');
        header.className = 'objeto-tienda-mejora-cabecera';

        const icono = document.createElement('img');
        icono.className = 'objeto-tienda-mejora-icono';
        icono.src = objeto.icono || '';
        icono.alt = objeto.nombre;

        const titWrap = document.createElement('div');
        titWrap.className = 'objeto-tienda-mejora-texto-top';
        const nombre = document.createElement('h5');
        nombre.textContent = objeto.nombre;
        titWrap.appendChild(nombre);

        header.appendChild(icono);
        header.appendChild(titWrap);
        item.appendChild(header);

        const descripcion = document.createElement('p');
        descripcion.className = 'objeto-tienda-desc';
        descripcion.textContent = objeto.descripcion;
        item.appendChild(descripcion);
    } else {
        const preview = document.createElement('div');
        preview.className = 'preview-sobre-tienda';
        const url = objeto.icono || '';
        preview.style.backgroundImage = url ? `url(${url})` : 'none';

        const nombre = document.createElement('h5');
        nombre.className = 'objeto-tienda-nombre-sobre';
        nombre.textContent = objeto.nombre;

        const descripcion = document.createElement('p');
        descripcion.className = 'objeto-tienda-desc objeto-tienda-desc-sobre';
        descripcion.textContent = objeto.descripcion;

        item.appendChild(preview);
        item.appendChild(nombre);
        item.appendChild(descripcion);
    }

    const precio = document.createElement('div');
    precio.className = 'precio-item';
    precio.innerHTML = `Precio: ${objeto.precio} <img src="${ICONO_MONEDA}" alt="Moneda" style="width:18px;height:18px;object-fit:contain;vertical-align:text-bottom;margin-left:4px;">`;

    const boton = document.createElement('button');
    boton.className = 'btn btn-primary';
    boton.textContent = 'Comprar';
    boton.disabled = usuarioActual.puntos < objeto.precio;
    boton.addEventListener('click', () => comprarObjeto(objeto.id));

    item.appendChild(precio);
    item.appendChild(boton);
    return item;
}

function renderizarTienda() {
    actualizarPuntosUI();
    actualizarFechaUI();
    renderizarCartasTienda();
    renderizarObjetosTienda();
}

function formatearTiempoRestante(msRestantes) {
    const totalSegundos = Math.max(0, Math.floor(msRestantes / 1000));
    const horas = Math.floor(totalSegundos / 3600);
    const minutos = Math.floor((totalSegundos % 3600) / 60);
    const segundos = totalSegundos % 60;
    return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
}

function actualizarUIRotacion() {
    const timerEl = document.getElementById('rotacion-timer');
    const timerValorEl = document.getElementById('rotacion-timer-valor');
    const barraEl = document.getElementById('rotacion-barra-progreso');
    if (!timerEl || !timerValorEl || !barraEl) {
        return;
    }

    const { ahora, inicio, fin } = obtenerVentanaRotacion();
    const restante = fin - ahora;
    const transcurrido = ahora - inicio;
    const progreso = Math.min(100, Math.max(0, (transcurrido / ROTACION_TIENDA_MS) * 100));

    timerValorEl.textContent = formatearTiempoRestante(restante);
    barraEl.style.width = `${progreso}%`;
}

function iniciarTemporizadorRotacion() {
    if (temporizadorRotacion) {
        clearInterval(temporizadorRotacion);
    }

    actualizarUIRotacion();
    temporizadorRotacion = setInterval(async () => {
        const { idVentana } = obtenerVentanaRotacion();
        if (Number(usuarioActual?.tienda?.ventanaId) !== idVentana) {
            await prepararTiendaDiaria();
            renderizarTienda();
        }
        actualizarUIRotacion();
    }, 1000);
}

async function comprarCarta(indexOferta) {
    const oferta = usuarioActual.tienda.cartas[indexOferta];

    if (!oferta || oferta.agotada) {
        return;
    }

    if (usuarioActual.puntos < oferta.precio) {
        mostrarMensaje('No tienes suficientes puntos para comprar esta carta.', 'danger');
        return;
    }

    const confirmar = await pedirConfirmacionCompra(oferta.carta.Nombre, oferta.precio);
    if (!confirmar) {
        return;
    }

    const snapshotPrevias = (usuarioActual.cartas || []).slice();
    usuarioActual.puntos -= oferta.precio;
    usuarioActual.cartas.push({ ...oferta.carta });
    usuarioActual.tienda.cartas[indexOferta].agotada = true;
    const conteoCompra = typeof window.dcContarCartasNuevasPorFaccion === 'function'
        ? window.dcContarCartasNuevasPorFaccion([oferta.carta], snapshotPrevias, null)
        : { nuevasH: 0, nuevasV: 0 };

    try {
        await persistirUsuario();
        if (window.DCMisiones?.track) {
            if (conteoCompra.nuevasH > 0) {
                window.DCMisiones.track('coleccion_h', { amount: conteoCompra.nuevasH });
            }
            if (conteoCompra.nuevasV > 0) {
                window.DCMisiones.track('coleccion_v', { amount: conteoCompra.nuevasV });
            }
        }
        renderizarTienda();
        mostrarMensaje(`Has comprado ${oferta.carta.Nombre}.`, 'success');
    } catch (error) {
        console.error('Error al comprar carta:', error);
        mostrarMensaje('No se pudo completar la compra de la carta.', 'danger');
    }
}

async function comprarObjeto(identificador) {
    usuarioActual.tienda.objetos = normalizarObjetosTienda();
    const objeto =
        typeof identificador === 'number'
            ? usuarioActual.tienda.objetos[identificador]
            : usuarioActual.tienda.objetos.find(o => o.id === identificador);

    if (!objeto) {
        return;
    }

    if (usuarioActual.puntos < objeto.precio) {
        mostrarMensaje('No tienes suficientes puntos para comprar este objeto.', 'danger');
        return;
    }

    const confirmar = await pedirConfirmacionCompra(objeto.nombre, objeto.precio);
    if (!confirmar) {
        return;
    }

    usuarioActual.puntos -= objeto.precio;
    usuarioActual.objetos = (usuarioActual.objetos && typeof usuarioActual.objetos === 'object')
        ? { ...usuarioActual.objetos }
        : {};
    usuarioActual.objetos.mejoraCarta = Number(usuarioActual.objetos.mejoraCarta || 0);
    usuarioActual.objetos.mejoraEspecial = Number(usuarioActual.objetos.mejoraEspecial || 0);
    if (typeof window.DC_SOBRES_MEZCLAR_INVENTARIO === 'function') {
        usuarioActual.objetos = window.DC_SOBRES_MEZCLAR_INVENTARIO(usuarioActual.objetos);
    }

    const defSobre = window.DC_SOBRES_POR_ID && window.DC_SOBRES_POR_ID[objeto.id];
    if (defSobre && defSobre.inventarioKey) {
        usuarioActual.objetos[defSobre.inventarioKey] = Number(usuarioActual.objetos[defSobre.inventarioKey] || 0) + 1;
    } else if (objeto.id === 'obj-mejora-carta') {
        usuarioActual.objetos.mejoraCarta = Number(usuarioActual.objetos.mejoraCarta || 0) + 1;
    } else if (objeto.id === 'obj-mejora-especial') {
        usuarioActual.objetos.mejoraEspecial = Number(usuarioActual.objetos.mejoraEspecial || 0) + 1;
    }

    try {
        await persistirUsuario();
        if (window.DCMisiones?.track) {
            if (defSobre) {
                window.DCMisiones.track('shop_sobres', { amount: 1 });
            } else {
                window.DCMisiones.track('shop_mejora', { amount: 1 });
            }
        }
        renderizarTienda();
        mostrarMensaje(`Has comprado ${objeto.nombre}.`, 'success');
    } catch (error) {
        console.error('Error al comprar objeto:', error);
        mostrarMensaje('No se pudo completar la compra del objeto.', 'danger');
    }
}

async function persistirUsuario() {
    await actualizarUsuarioFirebase(usuarioActual, emailActual);
    localStorage.setItem('usuario', JSON.stringify(usuarioActual));
    if (typeof window.actualizarPanelPerfilTiempoReal === 'function') {
        window.actualizarPanelPerfilTiempoReal();
    }
    window.dispatchEvent(new Event('dc:usuario-actualizado'));
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

function mostrarMensaje(mensaje, tipo = 'warning') {
    const mensajeDiv = document.getElementById('mensaje-tienda');
    mensajeDiv.textContent = mensaje;
    mensajeDiv.className = `alert alert-${tipo}`;
    mensajeDiv.style.display = 'block';
    setTimeout(() => {
        mensajeDiv.style.display = 'none';
    }, 2600);
}

function pedirConfirmacionCompra(nombre, precio) {
    return new Promise(resolve => {
        const modal = document.getElementById('modal-confirmacion');
        const texto = document.getElementById('texto-confirmacion');
        const btnConfirmar = document.getElementById('btn-confirmar-compra');
        const btnCancelar = document.getElementById('btn-cancelar-compra');

        if (!modal || !texto || !btnConfirmar || !btnCancelar) {
            resolve(true);
            return;
        }

        texto.innerHTML = '';
        const t1 = document.createTextNode('¿Deseas comprar ');
        const nombreStrong = document.createElement('strong');
        nombreStrong.textContent = String(nombre || '');
        const t2 = document.createTextNode(' por ');
        const precioStrong = document.createElement('strong');
        precioStrong.textContent = String(precio || 0);
        const moneda = document.createElement('img');
        moneda.src = ICONO_MONEDA;
        moneda.alt = 'Moneda';
        moneda.style.width = '18px';
        moneda.style.height = '18px';
        moneda.style.objectFit = 'contain';
        moneda.style.verticalAlign = 'text-bottom';
        const t3 = document.createTextNode('?');
        texto.appendChild(t1);
        texto.appendChild(nombreStrong);
        texto.appendChild(t2);
        texto.appendChild(precioStrong);
        texto.appendChild(document.createTextNode(' '));
        texto.appendChild(moneda);
        texto.appendChild(t3);
        modal.style.display = 'block';

        const limpiar = () => {
            modal.style.display = 'none';
            btnConfirmar.removeEventListener('click', onConfirmar);
            btnCancelar.removeEventListener('click', onCancelar);
        };

        const onConfirmar = () => {
            limpiar();
            resolve(true);
        };

        const onCancelar = () => {
            limpiar();
            resolve(false);
        };

        btnConfirmar.addEventListener('click', onConfirmar);
        btnCancelar.addEventListener('click', onCancelar);
    });
}

function logout() {
    localStorage.removeItem('usuario');
    window.location.href = '/login.html';
}
