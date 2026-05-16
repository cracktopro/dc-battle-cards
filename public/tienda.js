const PRECIOS_CARTAS = {
    1: 100,
    2: 250,
    3: 500,
    4: 1000,
    5: 2000,
    6: 4000
};

/** 12 cartas por panel héroe / villano (misma distribución de niveles). */
const DISTRIBUCION_TIENDA_HV = [
    { nivel: 1, cantidad: 4 },
    { nivel: 2, cantidad: 3 },
    { nivel: 3, cantidad: 2 },
    { nivel: 4, cantidad: 1 },
    { nivel: 5, cantidad: 1 },
    { nivel: 6, cantidad: 1 }
];

const OBJETOS_MEJORAS_TIENDA = [
    {
        id: 'obj-mejora-carta',
        nombre: 'Mejora de carta',
        descripcion: 'Solo usable en cartas nivel 1 a 3. Permite subir hasta nivel 4.',
        precio: 500,
        icono: '/resources/icons/mejora.png',
        filaTienda: 1
    },
    {
        id: 'obj-mejora-especial',
        nombre: 'Mejora especial',
        descripcion: 'Solo usable en cartas de nivel 5. Eleva la carta a nivel 6.',
        precio: 3000,
        icono: '/resources/icons/mejora_especial.png',
        filaTienda: 1
    },
    {
        id: 'obj-mejora-suprema',
        nombre: 'Mejora suprema',
        descripcion: 'Mejora cualquier carta de héroe o villano al nivel 5 de forma inmediata.',
        precio: 5000,
        icono: '/resources/icons/mejora_suprema.png',
        filaTienda: 1
    },
    {
        id: 'obj-mejora-definitiva',
        nombre: 'Mejora definitiva',
        descripcion: 'Mejora cualquier carta de héroe o villano al nivel 6 de forma inmediata.',
        precio: 10000,
        icono: '/resources/icons/mejora_definitiva.png',
        filaTienda: 1
    },
    {
        id: 'obj-fragmento-mejora-elite',
        nombre: 'Mejora élite',
        descripcion: 'Este objeto incluye un único fragmento de mejora élite que puedes utilizar para subir una carta de nivel 6 a nivel Élite.',
        precio: 0,
        icono: '/resources/icons/mejora_elite.png',
        filaTienda: 2,
        esFragmentoMejora: true,
        precioMejoraCarta: 10
    },
    {
        id: 'obj-fragmento-mejora-legendaria',
        nombre: 'Mejora legendaria',
        descripcion: 'Este objeto incluye un único fragmento de mejora legendaria que puedes utilizar para subir una carta de nivel Élite a nivel Legendario.',
        precio: 0,
        icono: '/resources/icons/mejora_legendaria.png',
        filaTienda: 2,
        esFragmentoMejora: true,
        precioMejoraCarta: 20
    },
    {
        id: 'obj-cofre-elite',
        nombre: 'Cofre élite',
        descripcion: 'Este cofre contiene 12 fragmentos de mejora que pueden utilizarse para subir de nivel cartas de nivel 6 a nivel Élite.',
        precio: 0,
        icono: '/resources/icons/cofre_elite.png',
        filaTienda: 2,
        esCofre: true,
        precioMejoraEspecial: 10
    },
    {
        id: 'obj-cofre-legendario',
        nombre: 'Cofre legendario',
        descripcion: 'Este cofre contiene 12 fragmentos de mejora legendaria que pueden utilizarse para subir una carta de nivel Élite a nivel Legendario.',
        precio: 0,
        icono: '/resources/icons/cofre_legendario.png',
        filaTienda: 2,
        esCofre: true,
        precioMejoraEspecial: 20
    }
];
const ICONO_MEJORA_ESPECIAL_TIENDA = '/resources/icons/mejora_especial.png';
const ICONO_MEJORA_CARTA_TIENDA = '/resources/icons/mejora.png';
const ICONOS_OBJETO_POR_ID = {
    'obj-mejora-carta': '/resources/icons/mejora.png',
    'obj-mejora-especial': '/resources/icons/mejora_especial.png',
    'obj-mejora-suprema': '/resources/icons/mejora_suprema.png',
    'obj-mejora-definitiva': '/resources/icons/mejora_definitiva.png',
    'obj-fragmento-mejora-elite': '/resources/icons/mejora_elite.png',
    'obj-fragmento-mejora-legendaria': '/resources/icons/mejora_legendaria.png',
    'obj-cofre-elite': '/resources/icons/cofre_elite.png',
    'obj-cofre-legendario': '/resources/icons/cofre_legendario.png',
    ...(typeof window.DC_SOBRES_ICONOS_POR_ID === 'object' && window.DC_SOBRES_ICONOS_POR_ID ? window.DC_SOBRES_ICONOS_POR_ID : {})
};
const ICONO_MONEDA = '/resources/icons/moneda.png';

let usuarioActual = null;
let emailActual = null;
const VERSION_TIENDA_GLOBAL = 'global-rotation-v2-shop-tabs';
const ROTACION_TIENDA_MS = 2 * 60 * 60 * 1000;
let temporizadorRotacion = null;

/** Alinea token de concurrencia con `localStorage` (p. ej. tras guardar misiones) sin perder cambios en memoria. */
function mergeSyncUsuarioDesdeLocalStorage(ref) {
    if (!ref || typeof ref !== 'object') {
        return;
    }
    try {
        const raw = localStorage.getItem('usuario');
        const remoto = raw ? JSON.parse(raw) : null;
        if (!remoto || typeof remoto !== 'object') {
            return;
        }
        const tok = remoto.syncToken;
        if (tok != null && String(tok).trim() !== '') {
            ref.syncToken = tok;
        }
        const su = Number(remoto.syncUpdatedAt);
        if (Number.isFinite(su) && su > 0) {
            ref.syncUpdatedAt = su;
        }
    } catch (_e) {
        /* ignore */
    }
}

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
    usuarioActual.objetos.mejoraSuprema = Number(usuarioActual.objetos.mejoraSuprema || 0);
    usuarioActual.objetos.mejoraDefinitiva = Number(usuarioActual.objetos.mejoraDefinitiva || 0);
    usuarioActual.objetos.mejoraElite = Number(usuarioActual.objetos.mejoraElite || 0);
    usuarioActual.objetos.mejoraLegendaria = Number(usuarioActual.objetos.mejoraLegendaria || 0);
    if (typeof window.DC_SOBRES_MEZCLAR_INVENTARIO === 'function') {
        usuarioActual.objetos = window.DC_SOBRES_MEZCLAR_INVENTARIO(usuarioActual.objetos);
    }

    try {
        await prepararTiendaDiaria();
        inicializarPestanasTienda();
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

function leerFaccionHVDesdeFila(carta) {
    const raw = carta?.faccion ?? carta?.Faccion ?? carta?.FACCION ?? carta?.['Facción'];
    const u = String(raw || '').trim().toUpperCase();
    if (u === 'H' || u === 'V') {
        return u;
    }
    const lo = String(raw || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (lo.includes('vill')) {
        return 'V';
    }
    if (lo.includes('hero')) {
        return 'H';
    }
    return '';
}

function crearOfertaCarta(cartaBase, nivel, opciones = {}) {
    const srcCarta = typeof window.fusionarSkillDesdeFilaCatalogo === 'function'
        ? window.fusionarSkillDesdeFilaCatalogo({ ...cartaBase }, cartaBase)
        : { ...cartaBase };
    const saludBase = Number((srcCarta.SaludMax ?? srcCarta.Salud ?? srcCarta.Poder) || 0);
    const saludEscalada = escalarPoderPorNivel(saludBase, nivel);
    const precioCatalogo = PRECIOS_CARTAS[nivel];
    const precio = opciones.precio != null ? opciones.precio : precioCatalogo;
    const sufijoId = opciones.sufijoId || 'std';
    return {
        id: `oferta-${normalizarNombreCarta(cartaBase.Nombre)}-${nivel}-${sufijoId}`,
        carta: {
            ...srcCarta,
            Nivel: nivel,
            Poder: escalarPoderPorNivel(cartaBase.Poder, nivel),
            SaludMax: saludEscalada,
            Salud: saludEscalada
        },
        nivel,
        precio,
        precioOriginal: opciones.precioOriginal != null ? opciones.precioOriginal : null,
        descuentoPct: opciones.descuentoPct != null ? opciones.descuentoPct : null,
        esOfertaDia: Boolean(opciones.esOfertaDia),
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

function rellenarOfertasHasta12(ofertas, poolFaccion, usados, rng, etiquetaPool) {
    const nivelesCiclo = [1, 2, 3, 4, 5, 6, 1, 2, 3, 4, 5, 6];
    let i = 0;
    while (ofertas.length < 12 && poolFaccion.length > 0) {
        const nivel = nivelesCiclo[i % nivelesCiclo.length];
        i += 1;
        const poolNivel = poolFaccion.filter(carta => Number(carta.Nivel || 1) <= nivel);
        const candidatas = poolNivel.length > 0 ? poolNivel : poolFaccion;
        const extra = seleccionarSinDuplicados(candidatas, 1, usados, rng);
        if (extra.length === 0) {
            break;
        }
        ofertas.push(crearOfertaCarta(extra[0], nivel, { sufijoId: `pad-${etiquetaPool}-${ofertas.length}` }));
    }
}

function nombresEnPanelesTienda(cartasHeroes, cartasVillanos) {
    const s = new Set();
    (cartasHeroes || []).forEach((oferta) => {
        const n = normalizarNombreCarta(oferta?.carta?.Nombre);
        if (n) {
            s.add(n);
        }
    });
    (cartasVillanos || []).forEach((oferta) => {
        const n = normalizarNombreCarta(oferta?.carta?.Nombre);
        if (n) {
            s.add(n);
        }
    });
    return s;
}

function construirPanelesHVDesdeCatalogo(catalogo, fechaSemilla) {
    const rngHero = crearRngSemilla(`tienda-hero-${fechaSemilla}`);
    const rngVill = crearRngSemilla(`tienda-vill-${fechaSemilla}`);

    const poolH = catalogo.filter(carta => leerFaccionHVDesdeFila(carta) === 'H');
    const poolV = catalogo.filter(carta => leerFaccionHVDesdeFila(carta) === 'V');
    const poolHok = poolH.length > 0 ? poolH : catalogo;
    const poolVok = poolV.length > 0 ? poolV : catalogo;

    const usadosH = new Set();
    const usadosV = new Set();
    const heroes = [];
    const villanos = [];

    DISTRIBUCION_TIENDA_HV.forEach(({ nivel, cantidad }) => {
        const poolNivelH = poolHok.filter(carta => Number(carta.Nivel || 1) <= nivel);
        const candH = poolNivelH.length > 0 ? poolNivelH : poolHok;
        seleccionarSinDuplicados(candH, cantidad, usadosH, rngHero).forEach((carta) => {
            heroes.push(crearOfertaCarta(carta, nivel, { sufijoId: 'hero' }));
        });

        const poolNivelV = poolVok.filter(carta => Number(carta.Nivel || 1) <= nivel);
        const candV = poolNivelV.length > 0 ? poolNivelV : poolVok;
        seleccionarSinDuplicados(candV, cantidad, usadosV, rngVill).forEach((carta) => {
            villanos.push(crearOfertaCarta(carta, nivel, { sufijoId: 'vill' }));
        });
    });

    rellenarOfertasHasta12(heroes, poolHok, usadosH, rngHero, 'H');
    rellenarOfertasHasta12(villanos, poolVok, usadosV, rngVill, 'V');

    return {
        cartasHeroes: heroes.slice(0, 12),
        cartasVillanos: villanos.slice(0, 12)
    };
}

function construirOfertasDiaDesdeCatalogo(catalogo, fechaDia, cartasHeroes, cartasVillanos) {
    const rngOferta = crearRngSemilla(`tienda-oferta-${fechaDia}`);

    const poolH = catalogo.filter(carta => leerFaccionHVDesdeFila(carta) === 'H');
    const poolV = catalogo.filter(carta => leerFaccionHVDesdeFila(carta) === 'V');
    const poolHok = poolH.length > 0 ? poolH : catalogo;
    const poolVok = poolV.length > 0 ? poolV : catalogo;

    const todosNombres = nombresEnPanelesTienda(cartasHeroes, cartasVillanos);
    const poolH5 = poolHok.filter(c => Number(c.Nivel || 1) <= 5);
    const poolV5 = poolVok.filter(c => Number(c.Nivel || 1) <= 5);

    let cartaOfertaH = seleccionarSinDuplicados(poolH5, 1, new Set(todosNombres), rngOferta)[0];
    if (!cartaOfertaH) {
        cartaOfertaH = seleccionarSinDuplicados(poolH5, 1, new Set(), rngOferta)[0];
    }
    if (cartaOfertaH) {
        todosNombres.add(normalizarNombreCarta(cartaOfertaH.Nombre));
    }
    let cartaOfertaV = seleccionarSinDuplicados(poolV5, 1, new Set(todosNombres), rngOferta)[0];
    if (!cartaOfertaV) {
        cartaOfertaV = seleccionarSinDuplicados(poolV5, 1, new Set(), rngOferta)[0];
    }

    const ofertasDia = [];
    if (cartaOfertaH) {
        ofertasDia.push(crearOfertaCarta(cartaOfertaH, 5, {
            precio: 1000,
            precioOriginal: PRECIOS_CARTAS[5],
            descuentoPct: 50,
            esOfertaDia: true,
            sufijoId: 'odia-h'
        }));
    }
    if (cartaOfertaV) {
        ofertasDia.push(crearOfertaCarta(cartaOfertaV, 5, {
            precio: 1000,
            precioOriginal: PRECIOS_CARTAS[5],
            descuentoPct: 50,
            esOfertaDia: true,
            sufijoId: 'odia-v'
        }));
    }
    return ofertasDia;
}

function obtenerListaObjetosMejoras() {
    return OBJETOS_MEJORAS_TIENDA.map(objeto => ({ ...objeto }));
}

function obtenerListaSobresTienda() {
    const sobres = (typeof window.DC_SOBRES_ITEMS_TIENDA === 'function')
        ? window.DC_SOBRES_ITEMS_TIENDA()
        : [];
    return sobres.map((s) => ({
        ...s,
        icono: s.icono || ICONOS_OBJETO_POR_ID[s.id] || ''
    }));
}

function buscarDefinicionCompraPorId(id) {
    const sid = String(id || '').trim();
    const mejora = OBJETOS_MEJORAS_TIENDA.find(o => o.id === sid);
    if (mejora) {
        return { ...mejora };
    }
    const sobre = obtenerListaSobresTienda().find(o => o.id === sid);
    return sobre ? { ...sobre } : null;
}

function tiendaTieneEstructuraActual(tiendaUsuario) {
    return Boolean(tiendaUsuario
        && Array.isArray(tiendaUsuario.cartasHeroes) && tiendaUsuario.cartasHeroes.length === 12
        && Array.isArray(tiendaUsuario.cartasVillanos) && tiendaUsuario.cartasVillanos.length === 12
        && Array.isArray(tiendaUsuario.ofertasDia));
}

function construirMapaCatalogoPorNombre(catalogo) {
    const mapa = new Map();
    (Array.isArray(catalogo) ? catalogo : []).forEach((carta) => {
        const clave = normalizarNombreCarta(carta?.Nombre);
        if (clave && !mapa.has(clave)) {
            mapa.set(clave, carta);
        }
    });
    return mapa;
}

function extraerSufijoIdOfertaTienda(idOferta) {
    const m = String(idOferta || '').match(/-(\d+)-([^-]+)$/);
    return m ? m[2] : 'std';
}

/** Actualiza stats/skills de ofertas guardadas sin cambiar selección, precios ni estado agotada. */
function refrescarOfertaTiendaConCatalogo(oferta, mapaCatalogo) {
    if (!oferta?.carta?.Nombre || !mapaCatalogo) {
        return oferta;
    }
    const clave = normalizarNombreCarta(oferta.carta.Nombre);
    const fila = mapaCatalogo.get(clave);
    if (!fila) {
        return oferta;
    }
    const nivel = Math.max(1, Number(oferta.nivel || oferta.carta.Nivel || 1));
    const refreshed = crearOfertaCarta(fila, nivel, {
        precio: oferta.precio,
        precioOriginal: oferta.precioOriginal,
        descuentoPct: oferta.descuentoPct,
        esOfertaDia: oferta.esOfertaDia,
        sufijoId: extraerSufijoIdOfertaTienda(oferta.id)
    });
    refreshed.id = oferta.id;
    refreshed.agotada = Boolean(oferta.agotada);
    return refreshed;
}

function sincronizarTiendaConCatalogo(tienda, mapaCatalogo) {
    if (!tienda || !mapaCatalogo) {
        return { huboCambios: false };
    }
    let huboCambios = false;
    const syncLista = (lista) => {
        if (!Array.isArray(lista)) {
            return;
        }
        for (let i = 0; i < lista.length; i += 1) {
            const actualizada = refrescarOfertaTiendaConCatalogo(lista[i], mapaCatalogo);
            if (JSON.stringify(actualizada) !== JSON.stringify(lista[i])) {
                lista[i] = actualizada;
                huboCambios = true;
            }
        }
    };
    syncLista(tienda.cartasHeroes);
    syncLista(tienda.cartasVillanos);
    syncLista(tienda.ofertasDia);
    return { huboCambios };
}

function fechaOfertasDiaEfectiva(tienda) {
    const hoy = obtenerFechaHoy();
    const expl = String(tienda?.ofertasDiaFecha || '').trim();
    if (expl) {
        return expl;
    }
    if (String(tienda?.fecha || '').trim() === hoy) {
        return hoy;
    }
    return '';
}

async function prepararTiendaDiaria() {
    const hoy = obtenerFechaHoy();
    const { idVentana } = obtenerVentanaRotacion();
    const t = usuarioActual.tienda;
    const catalogo = await cargarCatalogoCartas();
    const mapaCatalogo = construirMapaCatalogoPorNombre(catalogo);

    const hvOk = Boolean(
        t
        && Number(t.ventanaId) === idVentana
        && t.version === VERSION_TIENDA_GLOBAL
        && tiendaTieneEstructuraActual(t)
    );

    const ofertasFechaOk = fechaOfertasDiaEfectiva(t) === hoy;

    if (hvOk && ofertasFechaOk) {
        const { huboCambios } = sincronizarTiendaConCatalogo(t, mapaCatalogo);
        let persistir = huboCambios;
        if (t && !t.ofertasDiaFecha) {
            t.ofertasDiaFecha = hoy;
            persistir = true;
        }
        if (persistir) {
            await persistirUsuario();
        }
        return;
    }

    if (!hvOk) {
        const panels = construirPanelesHVDesdeCatalogo(catalogo, String(idVentana));
        const preservarOfertas = ofertasFechaOk && Array.isArray(t?.ofertasDia);
        const ofertasDia = preservarOfertas
            ? t.ofertasDia
            : construirOfertasDiaDesdeCatalogo(catalogo, hoy, panels.cartasHeroes, panels.cartasVillanos);
        const ofertasDiaFecha = preservarOfertas ? (t.ofertasDiaFecha || hoy) : hoy;
        usuarioActual.tienda = {
            fecha: hoy,
            ventanaId: idVentana,
            ofertasDiaFecha,
            cartasHeroes: panels.cartasHeroes,
            cartasVillanos: panels.cartasVillanos,
            ofertasDia,
            version: VERSION_TIENDA_GLOBAL
        };
        await persistirUsuario();
        return;
    }

    sincronizarTiendaConCatalogo(t, mapaCatalogo);
    const ofertasDia = construirOfertasDiaDesdeCatalogo(catalogo, hoy, t.cartasHeroes, t.cartasVillanos);
    usuarioActual.tienda.ofertasDia = ofertasDia;
    usuarioActual.tienda.ofertasDiaFecha = hoy;
    usuarioActual.tienda.fecha = hoy;
    await persistirUsuario();
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

function crearEstrellasDesdeCartaTienda(carta) {
    const estrellasDiv = document.createElement('div');
    estrellasDiv.classList.add('estrellas-carta');
    if (typeof window.dcRellenarEstrellasCartaCompleta === 'function') {
        window.dcRellenarEstrellasCartaCompleta(estrellasDiv, carta, {});
    } else {
        const nivel = Math.max(1, Number(carta?.Nivel || 1));
        for (let i = 0; i < nivel; i++) {
            const estrella = document.createElement('img');
            estrella.classList.add('estrella');
            estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
            estrella.alt = 'star';
            estrellasDiv.appendChild(estrella);
        }
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

function crearItemOfertaCartaTienda(oferta, seccionLista, indice) {
    const item = document.createElement('div');
    item.className = `item-tienda ${oferta.agotada ? 'agotada' : ''}`;

    const preview = document.createElement('div');
    preview.className = 'preview-carta preview-carta-tienda';
    if (typeof window.dcAplicarClasesNivelCartaCompleta === 'function') {
        window.dcAplicarClasesNivelCartaCompleta(preview, oferta.carta);
    } else if (Number(oferta.carta.Nivel || 1) >= 6) {
        preview.classList.add('nivel-legendaria');
    }
    preview.style.backgroundImage = `url(${obtenerImagenCarta(oferta.carta)})`;

    if (oferta.esOfertaDia && Number(oferta.descuentoPct || 0) > 0) {
        preview.classList.add('preview-carta-tienda--oferta');
        const ribbon = document.createElement('div');
        ribbon.className = 'tienda-badge-descuento';
        ribbon.textContent = `-${Math.round(Number(oferta.descuentoPct))}%`;
        preview.appendChild(ribbon);
    }

    preview.appendChild(crearEstrellasDesdeCartaTienda(oferta.carta));
    preview.appendChild(crearDetallesCarta(oferta.carta));

    const badgeAfiliacion = window.crearBadgeAfiliacionCarta
        ? window.crearBadgeAfiliacionCarta(oferta.carta)
        : null;
    if (badgeAfiliacion) {
        preview.appendChild(badgeAfiliacion);
    }

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
    if (oferta.esOfertaDia && oferta.precioOriginal != null && oferta.precioOriginal > oferta.precio) {
        precio.innerHTML = `
            <span class="tienda-precio-original">${oferta.precioOriginal}</span>
            <span class="tienda-precio-oferta">${oferta.precio}</span>
            <img src="${ICONO_MONEDA}" alt="Moneda" class="tienda-precio-moneda">
        `;
    } else {
        precio.innerHTML = `Precio: ${oferta.precio} <img src="${ICONO_MONEDA}" alt="Moneda" style="width:18px;height:18px;object-fit:contain;vertical-align:text-bottom;margin-left:4px;">`;
    }

    const boton = document.createElement('button');
    boton.className = 'btn btn-primary';
    boton.textContent = oferta.agotada ? 'Comprada' : 'Comprar';

    const sinPuntos = usuarioActual.puntos < oferta.precio;
    boton.disabled = Boolean(oferta.agotada || sinPuntos);
    boton.addEventListener('click', () => comprarCarta(seccionLista, indice));

    item.appendChild(preview);
    item.appendChild(precio);
    item.appendChild(boton);
    return item;
}

function anadirSeccionCartasTienda(contenedorPadre, titulo, lista, seccionLista) {
    const esOfertasDia = seccionLista === 'ofertasDia';
    const destino = esOfertasDia ? document.createElement('div') : contenedorPadre;
    if (esOfertasDia) {
        destino.className = 'tienda-wrap-ofertas-dia';
        contenedorPadre.appendChild(destino);
    }

    const tit = document.createElement('h4');
    tit.className = 'tienda-seccion-cartas-titulo';
    tit.textContent = titulo;
    destino.appendChild(tit);

    if (esOfertasDia) {
        const timerWrap = document.createElement('div');
        timerWrap.className = 'tienda-ofertas-dia-timer-wrap';
        const timerRow = document.createElement('div');
        timerRow.className = 'tienda-ofertas-dia-timer';
        const timerLabel = document.createElement('span');
        timerLabel.className = 'tienda-ofertas-dia-timer-label';
        timerLabel.textContent = 'La oferta finaliza en:';
        const timerValor = document.createElement('span');
        timerValor.id = 'tienda-ofertas-dia-timer-valor';
        timerValor.className = 'tienda-ofertas-dia-timer-valor';
        timerValor.textContent = '0s';
        timerRow.appendChild(timerLabel);
        timerRow.appendChild(timerValor);
        const barraOuter = document.createElement('div');
        barraOuter.className = 'rotacion-barra tienda-ofertas-dia-barra';
        const barraProgreso = document.createElement('div');
        barraProgreso.id = 'tienda-ofertas-dia-barra-progreso';
        barraProgreso.className = 'rotacion-barra-progreso';
        barraOuter.appendChild(barraProgreso);
        timerWrap.appendChild(timerRow);
        timerWrap.appendChild(barraOuter);
        destino.appendChild(timerWrap);
    }

    const grid = document.createElement('div');
    grid.className = esOfertasDia ? 'tienda-grid-cartas tienda-grid-ofertas-dia' : 'tienda-grid-cartas';
    (lista || []).forEach((oferta, index) => {
        grid.appendChild(crearItemOfertaCartaTienda(oferta, seccionLista, index));
    });
    destino.appendChild(grid);
}

function renderizarCartasTienda() {
    const contenedor = document.getElementById('tienda-cartas');
    if (!contenedor) {
        return;
    }
    contenedor.innerHTML = '';
    const t = usuarioActual.tienda;
    anadirSeccionCartasTienda(contenedor, 'Ofertas del día', t.ofertasDia, 'ofertasDia');
    anadirSeccionCartasTienda(contenedor, 'Cartas de Héroe', t.cartasHeroes, 'heroes');
    anadirSeccionCartasTienda(contenedor, 'Cartas de Villano', t.cartasVillanos, 'villanos');
}

function renderizarObjetosTienda() {
    const contenedorPadre = document.getElementById('tienda-objetos');
    if (!contenedorPadre) {
        return;
    }
    contenedorPadre.innerHTML = '';
    contenedorPadre.classList.remove('tienda-objetos-layout');
    contenedorPadre.classList.add('tienda-objetos-grid-mezclas');

    const lista = obtenerListaObjetosMejoras();
    const filaSuperior = lista.filter((o) => Number(o.filaTienda) !== 2);
    const filaInferior = lista.filter((o) => Number(o.filaTienda) === 2);

    const wrap = document.createElement('div');
    wrap.className = 'tienda-objetos-dos-filas';

    const gridSup = document.createElement('div');
    gridSup.className = 'tienda-objetos-fila tienda-objetos-fila-superior tienda-objetos-cuadricula';
    filaSuperior.forEach((objeto) => {
        gridSup.appendChild(crearTarjetaObjetoTienda(objeto));
    });

    const gridInf = document.createElement('div');
    gridInf.className = 'tienda-objetos-fila tienda-objetos-fila-inferior tienda-objetos-cuadricula';
    filaInferior.forEach((objeto) => {
        gridInf.appendChild(crearTarjetaObjetoTienda(objeto));
    });

    wrap.appendChild(gridSup);
    wrap.appendChild(gridInf);
    contenedorPadre.appendChild(wrap);
}

function renderizarSobresTienda() {
    const contenedorPadre = document.getElementById('tienda-sobres');
    if (!contenedorPadre) {
        return;
    }
    contenedorPadre.innerHTML = '';
    contenedorPadre.classList.add('tienda-objetos-layout');

    const lista = obtenerListaSobresTienda();

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
        if (objeto.id && /^obj-sobre-h\d$/i.test(objeto.id)) {
            filaSobresHeroes.appendChild(item);
        } else if (objeto.id && /^obj-sobre-v\d$/i.test(objeto.id)) {
            filaSobresVill.appendChild(item);
        } else {
            filaSobresHeroes.appendChild(item);
        }
    });

    contenedorPadre.appendChild(subtHero);
    contenedorPadre.appendChild(filaSobresHeroes);
    contenedorPadre.appendChild(subtVill);
    contenedorPadre.appendChild(filaSobresVill);
}

function crearTarjetaObjetoTienda(objeto) {
    const esSobre = objeto.id && String(objeto.id).startsWith('obj-sobre-');
    const esCofre = Boolean(objeto.esCofre);
    const esFragmento = Boolean(objeto.esFragmentoMejora);
    const item = document.createElement('div');
    if (esSobre) {
        item.className = 'objeto-tienda objeto-tienda-sobre objeto-tienda--pie-alineado';
    } else if (esCofre) {
        item.className = 'objeto-tienda objeto-tienda-mejora objeto-tienda-cofre objeto-tienda--pie-alineado';
    } else if (esFragmento) {
        item.className = 'objeto-tienda objeto-tienda-mejora objeto-tienda-fragmento-mejora objeto-tienda--pie-alineado';
    } else {
        item.className = 'objeto-tienda objeto-tienda-mejora objeto-tienda-mejora-catalogo objeto-tienda--pie-alineado';
    }

    if (esCofre) {
        const wrapImg = document.createElement('div');
        wrapImg.className = 'objeto-tienda-cofre-imagen-wrap';
        const imgCofre = document.createElement('img');
        imgCofre.className = 'objeto-tienda-cofre-imagen';
        imgCofre.src = objeto.icono || '';
        imgCofre.alt = objeto.nombre;
        wrapImg.appendChild(imgCofre);
        item.appendChild(wrapImg);

        const cuerpo = document.createElement('div');
        cuerpo.className = 'objeto-tienda-cuerpo-principal';
        const nombreCofre = document.createElement('h5');
        nombreCofre.textContent = objeto.nombre;
        const descripcionCofre = document.createElement('p');
        descripcionCofre.className = 'objeto-tienda-desc';
        descripcionCofre.textContent = objeto.descripcion;
        cuerpo.appendChild(nombreCofre);
        cuerpo.appendChild(descripcionCofre);
        item.appendChild(cuerpo);
    } else if (esFragmento) {
        const wrapImg = document.createElement('div');
        wrapImg.className = 'objeto-tienda-fragmento-imagen-wrap';
        const imgFrag = document.createElement('img');
        imgFrag.className = 'objeto-tienda-fragmento-imagen';
        imgFrag.src = objeto.icono || '';
        imgFrag.alt = objeto.nombre;
        wrapImg.appendChild(imgFrag);
        item.appendChild(wrapImg);

        const cuerpoFrag = document.createElement('div');
        cuerpoFrag.className = 'objeto-tienda-cuerpo-principal';
        const nombreFrag = document.createElement('h5');
        nombreFrag.textContent = objeto.nombre;
        const descripcionFrag = document.createElement('p');
        descripcionFrag.className = 'objeto-tienda-desc';
        descripcionFrag.textContent = objeto.descripcion;
        cuerpoFrag.appendChild(nombreFrag);
        cuerpoFrag.appendChild(descripcionFrag);
        item.appendChild(cuerpoFrag);
    } else if (!esSobre) {
        const wrapImg = document.createElement('div');
        wrapImg.className = 'objeto-tienda-mejora-catalogo-imagen-wrap';
        const imgCat = document.createElement('img');
        imgCat.className = 'objeto-tienda-mejora-catalogo-imagen';
        imgCat.src = objeto.icono || '';
        imgCat.alt = objeto.nombre;
        wrapImg.appendChild(imgCat);
        item.appendChild(wrapImg);

        const cuerpoCat = document.createElement('div');
        cuerpoCat.className = 'objeto-tienda-cuerpo-principal';
        const nombreCat = document.createElement('h5');
        nombreCat.textContent = objeto.nombre;
        const descripcionCat = document.createElement('p');
        descripcionCat.className = 'objeto-tienda-desc';
        descripcionCat.textContent = objeto.descripcion;
        cuerpoCat.appendChild(nombreCat);
        cuerpoCat.appendChild(descripcionCat);
        item.appendChild(cuerpoCat);
    } else {
        const wrapSobre = document.createElement('div');
        wrapSobre.className = 'objeto-tienda-sobre-imagen-wrap';
        const preview = document.createElement('div');
        preview.className = 'preview-sobre-tienda';
        const url = objeto.icono || '';
        preview.style.backgroundImage = url ? `url(${url})` : 'none';
        wrapSobre.appendChild(preview);
        item.appendChild(wrapSobre);

        const cuerpoSobre = document.createElement('div');
        cuerpoSobre.className = 'objeto-tienda-cuerpo-principal';
        const nombre = document.createElement('h5');
        nombre.className = 'objeto-tienda-nombre-sobre';
        nombre.textContent = objeto.nombre;
        const descripcion = document.createElement('p');
        descripcion.className = 'objeto-tienda-desc objeto-tienda-desc-sobre';
        descripcion.textContent = objeto.descripcion;
        cuerpoSobre.appendChild(nombre);
        cuerpoSobre.appendChild(descripcion);
        item.appendChild(cuerpoSobre);
    }

    const precio = document.createElement('div');
    precio.className = 'precio-item';
    const costeEspecial = Number(objeto.precioMejoraEspecial);
    const costeMejoraCarta = Number(objeto.precioMejoraCarta);
    if (Number.isFinite(costeEspecial) && costeEspecial > 0) {
        precio.classList.add('precio-item--mejora-especial');
        const linea = document.createElement('span');
        linea.className = 'tienda-precio-objeto-linea';
        linea.appendChild(document.createTextNode('Precio: '));
        const iconoCoste = document.createElement('img');
        iconoCoste.src = ICONO_MEJORA_ESPECIAL_TIENDA;
        iconoCoste.alt = 'Mejora especial';
        iconoCoste.className = 'tienda-precio-mejora-especial-icono';
        const cantTxt = document.createElement('strong');
        cantTxt.textContent = `×${costeEspecial}`;
        linea.appendChild(iconoCoste);
        linea.appendChild(cantTxt);
        precio.appendChild(linea);
    } else if (Number.isFinite(costeMejoraCarta) && costeMejoraCarta > 0) {
        precio.classList.add('precio-item--mejora-carta');
        const linea = document.createElement('span');
        linea.className = 'tienda-precio-objeto-linea';
        linea.appendChild(document.createTextNode('Precio: '));
        const iconoCoste = document.createElement('img');
        iconoCoste.src = ICONO_MEJORA_CARTA_TIENDA;
        iconoCoste.alt = 'Mejora de carta';
        iconoCoste.className = 'tienda-precio-mejora-carta-icono';
        const cantTxt = document.createElement('strong');
        cantTxt.textContent = `×${costeMejoraCarta}`;
        linea.appendChild(iconoCoste);
        linea.appendChild(cantTxt);
        precio.appendChild(linea);
    } else {
        precio.innerHTML = `Precio: ${objeto.precio} <img src="${ICONO_MONEDA}" alt="Moneda" style="width:18px;height:18px;object-fit:contain;vertical-align:text-bottom;margin-left:4px;">`;
    }

    const boton = document.createElement('button');
    boton.className = 'btn btn-primary';
    boton.textContent = 'Comprar';
    if (Number.isFinite(costeEspecial) && costeEspecial > 0) {
        const disp = Number(usuarioActual.objetos?.mejoraEspecial || 0);
        boton.disabled = disp < costeEspecial;
    } else if (Number.isFinite(costeMejoraCarta) && costeMejoraCarta > 0) {
        const disp = Number(usuarioActual.objetos?.mejoraCarta || 0);
        boton.disabled = disp < costeMejoraCarta;
    } else {
        boton.disabled = usuarioActual.puntos < objeto.precio;
    }
    boton.addEventListener('click', () => comprarObjeto(objeto.id));

    const pie = document.createElement('div');
    pie.className = 'objeto-tienda-pie-compra';
    pie.appendChild(precio);
    pie.appendChild(boton);
    item.appendChild(pie);
    return item;
}

function renderizarTienda() {
    actualizarPuntosUI();
    actualizarFechaUI();
    renderizarCartasTienda();
    renderizarObjetosTienda();
    renderizarSobresTienda();
    actualizarUIOfertasDia();
}

function inicializarPestanasTienda() {
    const botones = document.querySelectorAll('[data-tienda-tab]');
    const paneles = {
        cartas: document.getElementById('panel-tienda-cartas'),
        objetos: document.getElementById('panel-tienda-objetos'),
        sobres: document.getElementById('panel-tienda-sobres')
    };
    function activar(clave) {
        botones.forEach((btn) => {
            const es = btn.getAttribute('data-tienda-tab') === clave;
            btn.classList.toggle('active', es);
        });
        Object.keys(paneles).forEach((k) => {
            const el = paneles[k];
            if (el) {
                el.hidden = k !== clave;
            }
        });
    }
    botones.forEach((btn) => {
        btn.addEventListener('click', () => {
            activar(btn.getAttribute('data-tienda-tab') || 'cartas');
        });
    });
    activar('cartas');
}

function formatearTiempoRestante(msRestantes) {
    return typeof window.dcFormatearCuentaAtrasMs === 'function'
        ? window.dcFormatearCuentaAtrasMs(msRestantes)
        : '0s';
}

/** Inicio (00:00) y fin (siguiente 00:00) del día local; respeta cambios de DST. */
function obtenerInicioFinDiaLocal(ahoraMs = Date.now()) {
    const d = new Date(ahoraMs);
    const inicio = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).getTime();
    const fin = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
    return { inicio, fin };
}

function formatearCuentaAtrasOfertaDia(msRestantes) {
    return typeof window.dcFormatearCuentaAtrasMs === 'function'
        ? window.dcFormatearCuentaAtrasMs(msRestantes)
        : '0s';
}

function actualizarUIOfertasDia() {
    const valorEl = document.getElementById('tienda-ofertas-dia-timer-valor');
    const barraEl = document.getElementById('tienda-ofertas-dia-barra-progreso');
    if (!valorEl || !barraEl) {
        return;
    }
    const ahora = Date.now();
    const { inicio, fin } = obtenerInicioFinDiaLocal(ahora);
    const restante = fin - ahora;
    const transcurrido = ahora - inicio;
    const total = fin - inicio;
    const progreso = total > 0 ? Math.min(100, Math.max(0, (transcurrido / total) * 100)) : 0;
    valorEl.textContent = formatearCuentaAtrasOfertaDia(restante);
    barraEl.style.width = `${progreso}%`;
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
    actualizarUIOfertasDia();
    temporizadorRotacion = setInterval(async () => {
        const { idVentana } = obtenerVentanaRotacion();
        const hoy = obtenerFechaHoy();
        const t = usuarioActual?.tienda;
        let necesitaPrep = Number(t?.ventanaId) !== idVentana;
        if (!necesitaPrep && t) {
            const feEfectiva = fechaOfertasDiaEfectiva(t);
            necesitaPrep = feEfectiva !== hoy;
        }
        if (necesitaPrep) {
            await prepararTiendaDiaria();
            renderizarTienda();
        }
        actualizarUIRotacion();
        actualizarUIOfertasDia();
    }, 1000);
}

function obtenerListaOfertasPorSeccion(seccion) {
    const t = usuarioActual.tienda;
    if (seccion === 'heroes') {
        return t.cartasHeroes;
    }
    if (seccion === 'villanos') {
        return t.cartasVillanos;
    }
    if (seccion === 'ofertasDia') {
        return t.ofertasDia;
    }
    return null;
}

async function comprarCarta(seccion, indexOferta) {
    mergeSyncUsuarioDesdeLocalStorage(usuarioActual);
    const lista = obtenerListaOfertasPorSeccion(seccion);
    const oferta = lista ? lista[indexOferta] : null;

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
    lista[indexOferta].agotada = true;
    const conteoCompra = typeof window.dcContarCartasNuevasPorFaccion === 'function'
        ? window.dcContarCartasNuevasPorFaccion([oferta.carta], snapshotPrevias, null)
        : { nuevasH: 0, nuevasV: 0 };

    try {
        await persistirUsuario();
        const tracksMision = [];
        if (window.DCMisiones?.track) {
            if (conteoCompra.nuevasH > 0) {
                tracksMision.push(window.DCMisiones.track('coleccion_h', { amount: conteoCompra.nuevasH }));
            }
            if (conteoCompra.nuevasV > 0) {
                tracksMision.push(window.DCMisiones.track('coleccion_v', { amount: conteoCompra.nuevasV }));
            }
        }
        if (tracksMision.length > 0) {
            await Promise.allSettled(tracksMision);
        }
        mergeSyncUsuarioDesdeLocalStorage(usuarioActual);
        if (typeof window.DCRedDot?.refresh === 'function') {
            window.DCRedDot.refresh();
        }
        renderizarTienda();
        mostrarMensaje(`Has comprado ${oferta.carta.Nombre}.`, 'success');
    } catch (error) {
        console.error('Error al comprar carta:', error);
        mostrarMensaje('No se pudo completar la compra de la carta.', 'danger');
    }
}

async function comprarObjeto(identificador) {
    mergeSyncUsuarioDesdeLocalStorage(usuarioActual);
    const objeto = typeof identificador === 'number'
        ? null
        : buscarDefinicionCompraPorId(identificador);

    if (!objeto) {
        return;
    }

    const costeEspecial = Number(objeto.precioMejoraEspecial);
    const costeMejoraCarta = Number(objeto.precioMejoraCarta);
    const pagaConMejoraEspecial = Number.isFinite(costeEspecial) && costeEspecial > 0;
    const pagaConMejoraCarta = Number.isFinite(costeMejoraCarta) && costeMejoraCarta > 0;

    if (pagaConMejoraEspecial) {
        const disp = Number(usuarioActual.objetos?.mejoraEspecial || 0);
        if (disp < costeEspecial) {
            mostrarMensaje('No tienes suficientes mejoras especiales para comprar este objeto.', 'danger');
            return;
        }
    } else if (pagaConMejoraCarta) {
        const disp = Number(usuarioActual.objetos?.mejoraCarta || 0);
        if (disp < costeMejoraCarta) {
            mostrarMensaje('No tienes suficientes mejoras de carta para comprar este objeto.', 'danger');
            return;
        }
    } else if (usuarioActual.puntos < objeto.precio) {
        mostrarMensaje('No tienes suficientes puntos para comprar este objeto.', 'danger');
        return;
    }

    let confirmar;
    if (pagaConMejoraEspecial) {
        confirmar = await pedirConfirmacionCompra(objeto.nombre, costeEspecial, { moneda: 'mejoraEspecial' });
    } else if (pagaConMejoraCarta) {
        confirmar = await pedirConfirmacionCompra(objeto.nombre, costeMejoraCarta, { moneda: 'mejoraCarta' });
    } else {
        confirmar = await pedirConfirmacionCompra(objeto.nombre, objeto.precio);
    }
    if (!confirmar) {
        return;
    }

    if (pagaConMejoraEspecial) {
        usuarioActual.objetos.mejoraEspecial = Math.max(0, Number(usuarioActual.objetos.mejoraEspecial || 0) - costeEspecial);
    } else if (pagaConMejoraCarta) {
        usuarioActual.objetos.mejoraCarta = Math.max(0, Number(usuarioActual.objetos.mejoraCarta || 0) - costeMejoraCarta);
    } else {
        usuarioActual.puntos -= objeto.precio;
    }
    usuarioActual.objetos = (usuarioActual.objetos && typeof usuarioActual.objetos === 'object')
        ? { ...usuarioActual.objetos }
        : {};
    usuarioActual.objetos.mejoraCarta = Number(usuarioActual.objetos.mejoraCarta || 0);
    usuarioActual.objetos.mejoraEspecial = Number(usuarioActual.objetos.mejoraEspecial || 0);
    usuarioActual.objetos.mejoraSuprema = Number(usuarioActual.objetos.mejoraSuprema || 0);
    usuarioActual.objetos.mejoraDefinitiva = Number(usuarioActual.objetos.mejoraDefinitiva || 0);
    usuarioActual.objetos.mejoraElite = Number(usuarioActual.objetos.mejoraElite || 0);
    usuarioActual.objetos.mejoraLegendaria = Number(usuarioActual.objetos.mejoraLegendaria || 0);
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
    } else if (objeto.id === 'obj-mejora-suprema') {
        usuarioActual.objetos.mejoraSuprema = Number(usuarioActual.objetos.mejoraSuprema || 0) + 1;
    } else if (objeto.id === 'obj-mejora-definitiva') {
        usuarioActual.objetos.mejoraDefinitiva = Number(usuarioActual.objetos.mejoraDefinitiva || 0) + 1;
    } else if (objeto.id === 'obj-cofre-elite') {
        usuarioActual.objetos.mejoraElite = Number(usuarioActual.objetos.mejoraElite || 0) + 12;
    } else if (objeto.id === 'obj-cofre-legendario') {
        usuarioActual.objetos.mejoraLegendaria = Number(usuarioActual.objetos.mejoraLegendaria || 0) + 12;
    } else if (objeto.id === 'obj-fragmento-mejora-elite') {
        usuarioActual.objetos.mejoraElite = Number(usuarioActual.objetos.mejoraElite || 0) + 1;
    } else if (objeto.id === 'obj-fragmento-mejora-legendaria') {
        usuarioActual.objetos.mejoraLegendaria = Number(usuarioActual.objetos.mejoraLegendaria || 0) + 1;
    }

    try {
        await persistirUsuario();
        let trackCompra = null;
        if (window.DCMisiones?.track) {
            trackCompra = defSobre
                ? window.DCMisiones.track('shop_sobres', { amount: 1 })
                : window.DCMisiones.track('shop_mejora', { amount: 1 });
        }
        if (trackCompra && typeof trackCompra.then === 'function') {
            await Promise.allSettled([trackCompra]);
        }
        mergeSyncUsuarioDesdeLocalStorage(usuarioActual);
        if (typeof window.DCRedDot?.refresh === 'function') {
            window.DCRedDot.refresh();
        }
        renderizarTienda();
        mostrarMensaje(`Has comprado ${objeto.nombre}.`, 'success');
    } catch (error) {
        console.error('Error al comprar objeto:', error);
        mostrarMensaje('No se pudo completar la compra del objeto.', 'danger');
    }
}

async function persistirUsuario() {
    mergeSyncUsuarioDesdeLocalStorage(usuarioActual);
    await actualizarUsuarioFirebase(usuarioActual, emailActual);
    localStorage.setItem('usuario', JSON.stringify(usuarioActual));
    if (typeof window.actualizarPanelPerfilTiempoReal === 'function') {
        window.actualizarPanelPerfilTiempoReal();
    }
    window.dispatchEvent(new Event('dc:usuario-actualizado'));
    if (typeof window.DCRedDot?.refresh === 'function') {
        window.DCRedDot.refresh();
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

function mostrarMensaje(mensaje, tipo = 'warning') {
    const mensajeDiv = document.getElementById('mensaje-tienda');
    mensajeDiv.textContent = mensaje;
    mensajeDiv.className = `alert alert-${tipo}`;
    mensajeDiv.style.display = 'block';
    setTimeout(() => {
        mensajeDiv.style.display = 'none';
    }, 2600);
}

function pedirConfirmacionCompra(nombre, precio, opcionesPrecio) {
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
        texto.appendChild(t1);
        texto.appendChild(nombreStrong);
        texto.appendChild(t2);
        if (opcionesPrecio && opcionesPrecio.moneda === 'mejoraEspecial') {
            const cant = Math.max(0, Number(precio || 0));
            const precioStrong = document.createElement('strong');
            precioStrong.textContent = String(cant);
            const iconoEsp = document.createElement('img');
            iconoEsp.src = ICONO_MEJORA_ESPECIAL_TIENDA;
            iconoEsp.alt = 'Mejora especial';
            iconoEsp.style.width = '20px';
            iconoEsp.style.height = '20px';
            iconoEsp.style.objectFit = 'contain';
            iconoEsp.style.verticalAlign = 'text-bottom';
            iconoEsp.style.margin = '0 5px';
            const tMul = document.createTextNode('×');
            const tFin = document.createTextNode(' Mejora especial?');
            texto.appendChild(precioStrong);
            texto.appendChild(document.createTextNode(' '));
            texto.appendChild(tMul);
            texto.appendChild(iconoEsp);
            texto.appendChild(tFin);
        } else if (opcionesPrecio && opcionesPrecio.moneda === 'mejoraCarta') {
            const cant = Math.max(0, Number(precio || 0));
            const precioStrong = document.createElement('strong');
            precioStrong.textContent = String(cant);
            const iconoMc = document.createElement('img');
            iconoMc.src = ICONO_MEJORA_CARTA_TIENDA;
            iconoMc.alt = 'Mejora de carta';
            iconoMc.style.width = '20px';
            iconoMc.style.height = '20px';
            iconoMc.style.objectFit = 'contain';
            iconoMc.style.verticalAlign = 'text-bottom';
            iconoMc.style.margin = '0 5px';
            const tMul = document.createTextNode('×');
            const tFin = document.createTextNode(' Mejora de carta?');
            texto.appendChild(precioStrong);
            texto.appendChild(document.createTextNode(' '));
            texto.appendChild(tMul);
            texto.appendChild(iconoMc);
            texto.appendChild(tFin);
        } else {
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
            texto.appendChild(precioStrong);
            texto.appendChild(document.createTextNode(' '));
            texto.appendChild(moneda);
            texto.appendChild(t3);
        }
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
