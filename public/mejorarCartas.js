document.addEventListener('DOMContentLoaded', async function () {
    try {
        await enriquecerUsuarioSkillsDesdeCatalogoMejorar();
    } catch (error) {
        console.warn('No se pudieron fusionar habilidades desde el catálogo:', error);
    }
    cargarCartas(); // Carga inicial de cartas para mejorar
    configurarEventos(); // Configurar eventos de la página
});

async function enriquecerUsuarioSkillsDesdeCatalogoMejorar() {
    if (typeof XLSX === 'undefined' || typeof window.fusionarSkillDesdeFilaCatalogo !== 'function') {
        return;
    }

    const raw = localStorage.getItem('usuario');
    const usuario = raw ? JSON.parse(raw) : null;
    if (!usuario || !Array.isArray(usuario.cartas) || usuario.cartas.length === 0) {
        return;
    }

    const response = await fetch('resources/cartas.xlsx');
    if (!response.ok) {
        throw new Error('No se pudo cargar cartas.xlsx');
    }

    const data = await response.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(sheet);
    const mapa = new Map();

    filas.forEach(fila => {
        const clave = String(fila?.Nombre || '').trim().toLowerCase();
        if (clave) {
            mapa.set(clave, fila);
        }
    });

    let huboCambios = false;
    usuario.cartas = usuario.cartas.map(carta => {
        const clave = String(carta?.Nombre || '').trim().toLowerCase();
        const fila = mapa.get(clave);
        if (!fila) {
            return carta;
        }

        const mezclada = window.fusionarSkillDesdeFilaCatalogo(carta, fila);
        const distinto = ['skill_name', 'skill_info', 'skill_class', 'skill_trigger'].some(
            k => String(mezclada[k] || '') !== String(carta[k] || '')
        ) || String(mezclada.skill_power ?? '') !== String(carta.skill_power ?? '');

        if (distinto) {
            huboCambios = true;
        }
        return mezclada;
    });

    if (huboCambios) {
        localStorage.setItem('usuario', JSON.stringify(usuario));
        refrescarPanelPerfilLateral();
    }
}

let indiceCartaModalObjetos = null;
let faccionMejorasObjetosActiva = 'H';
let ordenarPoderMejorasObjetos = false;
let filtrosMejorasObjetosRegistrados = false;
let combinacionDuplicadosGrupo = null;
/** { index, carta, puntos, nombre } — destrucción individual en pestaña repetidas. */
let destruccionDuplicadoPendiente = null;
const seleccionIndicesCombinacion = new Set();
const ICONO_MEJORA = '/resources/icons/mejora.png';
const ICONO_MEJORA_ESPECIAL = '/resources/icons/mejora_especial.png';
const ICONO_MEJORA_SUPREMA = '/resources/icons/mejora_suprema.png';
const ICONO_MEJORA_DEFINITIVA = '/resources/icons/mejora_definitiva.png';

const OBJETOS_MEJORA_UI = [
    { key: 'mejoraCarta', nombre: 'Mejora de carta', descripcion: 'Solo 1★–3★ (+1 nivel, tope 4★)', icon: ICONO_MEJORA },
    { key: 'mejoraEspecial', nombre: 'Mejora especial', descripcion: 'Solo en 5★ → 6★', icon: ICONO_MEJORA_ESPECIAL },
    { key: 'mejoraSuprema', nombre: 'Mejora suprema', descripcion: 'Instantáneo a 5★', icon: ICONO_MEJORA_SUPREMA },
    { key: 'mejoraDefinitiva', nombre: 'Mejora definitiva', descripcion: 'Instantáneo a 6★', icon: ICONO_MEJORA_DEFINITIVA }
];

const ICONO_FRAGMENTO_ELITE_UI = '/resources/icons/mejora_elite.png';
const ICONO_FRAGMENTO_LEGENDARIA_UI = '/resources/icons/mejora_legendaria.png';
const ICONO_ANIM_ELITE = '/resources/icons/elite.png';
const ICONO_ANIM_LEGENDARY = '/resources/icons/legendary.png';
const COSTO_MEJORA_FRAGMENTOS = 12;

let indiceCartaModalFragmentos = null;
let faccionFragmentosActiva = 'H';
let ordenarPoderFragmentos = false;
let filtrosFragmentosRegistrados = false;
let fragmentoAnimEnCurso = false;

function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizarFaccion(valor) {
    const faccion = String(valor || '').trim().toUpperCase();
    return faccion === 'H' || faccion === 'V' ? faccion : '';
}

function refrescarPanelPerfilLateral() {
    if (typeof window.actualizarPanelPerfilTiempoReal === 'function') {
        window.actualizarPanelPerfilTiempoReal();
    }
    window.dispatchEvent(new Event('dc:usuario-actualizado'));
}

function esCartaLegendaria(carta) {
    return Number(carta?.Nivel || 1) >= 6;
}

function obtenerValorDestruccion(nivel) {
    const nivelSeguro = Math.max(1, Math.min(6, Number(nivel || 1)));
    const tabla = {
        1: 50,
        2: 100,
        3: 150,
        4: 200,
        5: 250,
        6: 400
    };
    return Number(tabla[nivelSeguro] || 50);
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

function construirGruposMejoraClasica(usuario) {
    const mapa = new Map();
    (usuario.cartas || []).forEach((carta, index) => {
        const nombre = String(carta.Nombre || '').trim();
        if (!nombre) {
            return;
        }
        if (!mapa.has(nombre)) {
            mapa.set(nombre, []);
        }
        mapa.get(nombre).push({ index, carta: { ...carta } });
    });

    const grupos = [];
    mapa.forEach((items, nombre) => {
        items.sort((a, b) => {
            const diffNivel = Number(b.carta.Nivel || 1) - Number(a.carta.Nivel || 1);
            if (diffNivel !== 0) {
                return diffNivel;
            }
            const diffPoder = Number(b.carta.Poder || 0) - Number(a.carta.Poder || 0);
            if (diffPoder !== 0) {
                return diffPoder;
            }
            return a.index - b.index;
        });
        const best = items[0];
        grupos.push({
            nombre,
            total: items.length,
            keeperIndex: best.index,
            keeperCarta: best.carta,
            sacrificables: items.slice(1).map(x => ({ index: x.index, carta: x.carta })),
            todos: items.map(x => ({ index: x.index, carta: x.carta }))
        });
    });
    grupos.sort((a, b) => a.nombre.localeCompare(b.nombre));
    return grupos;
}

function grupoVisibleEnVistaClasica(grupo) {
    const n = Math.max(1, Number(grupo.keeperCarta.Nivel || 1));
    if (n >= 6) {
        return false;
    }
    if (grupo.total > 1 && n >= 5) {
        return false;
    }
    if (grupo.total === 1 && n === 5) {
        return false;
    }
    return true;
}

function construirGruposDestruccion(usuario) {
    return construirGruposMejoraClasica(usuario)
        .filter((grupo) => Number(grupo?.keeperCarta?.Nivel || 1) >= 5 && Number(grupo?.total || 0) > 1)
        .map((grupo) => {
            const copiasDestruibles = grupo.sacrificables.map((item) => ({
                index: item.index,
                carta: { ...item.carta },
                puntos: obtenerValorDestruccion(item?.carta?.Nivel || 1)
            }));
            const puntosTotalesGrupo = copiasDestruibles.reduce((acc, item) => acc + Number(item.puntos || 0), 0);
            return {
                ...grupo,
                copiasDestruibles,
                puntosTotalesGrupo
            };
        });
}

function grupoEsClicableCombinar(grupo) {
    const n = Math.max(1, Number(grupo.keeperCarta.Nivel || 1));
    return grupo.total > 1 && n < 5;
}

function ordenarIndicesParaConsumo(usuario, indices) {
    return [...indices].sort((a, b) => {
        const ca = usuario.cartas[a];
        const cb = usuario.cartas[b];
        const na = Number(ca.Nivel || 1) - Number(cb.Nivel || 1);
        if (na !== 0) {
            return na;
        }
        const pa = Number(ca.Poder || 0) - Number(cb.Poder || 0);
        if (pa !== 0) {
            return pa;
        }
        return a - b;
    });
}

/**
 * Devuelve { nuevasCartas, cartaAntes, cartaMejorada } o null si no aplica.
 */
function calcularFusionDesdeSeleccion(usuario, keeperIndex, seleccionIndices) {
    const setSel = new Set(seleccionIndices);
    setSel.delete(keeperIndex);
    if (setSel.size === 0) {
        return null;
    }
    const nivelIni = Math.max(1, Number(usuario.cartas[keeperIndex].Nivel || 1));
    if (nivelIni >= 5) {
        return null;
    }
    const ordenados = ordenarIndicesParaConsumo(usuario, Array.from(setSel));
    const n = Math.min(ordenados.length, 5 - nivelIni);
    if (n <= 0) {
        return null;
    }
    const consumir = ordenados.slice(0, n);
    const cartaAntes = { ...usuario.cartas[keeperIndex] };
    const cartaMejorada = { ...usuario.cartas[keeperIndex] };
    cartaMejorada.Nivel = nivelIni + n;
    cartaMejorada.Poder = Number(cartaMejorada.Poder || 0) + (500 * n);
    if (typeof window.recalcularSkillPowerPorNivel === 'function') {
        window.recalcularSkillPowerPorNivel(cartaMejorada, cartaMejorada.Nivel);
    }
    const consumirSet = new Set(consumir);
    const nuevasCartas = [];
    for (let i = 0; i < usuario.cartas.length; i++) {
        if (consumirSet.has(i)) {
            continue;
        }
        if (i === keeperIndex) {
            nuevasCartas.push(cartaMejorada);
        } else {
            nuevasCartas.push(usuario.cartas[i]);
        }
    }
    return { nuevasCartas, cartaAntes, cartaMejorada };
}

function cerrarModalCombinarDuplicados() {
    const modal = document.getElementById('modal-combinar-duplicados');
    if (modal) {
        modal.style.display = 'none';
    }
    combinacionDuplicadosGrupo = null;
    seleccionIndicesCombinacion.clear();
}

function actualizarBotonAceptarCombinacion() {
    const btn = document.getElementById('btn-combinar-duplicados-aceptar');
    if (btn) {
        btn.disabled = seleccionIndicesCombinacion.size === 0;
    }
}

function renderListaSeleccionCombinacion(usuario) {
    const lista = document.getElementById('combinar-duplicados-lista');
    if (!lista || !combinacionDuplicadosGrupo) {
        return;
    }
    lista.innerHTML = '';
    combinacionDuplicadosGrupo.sacrificables.forEach(({ index, carta }) => {
        const item = document.createElement('div');
        item.className = `modal-combinar-duplicados-item${seleccionIndicesCombinacion.has(index) ? ' seleccionada' : ''}`;
        item.dataset.index = String(index);
        const mini = crearElementoCartaSoloVisual(carta, false, 168);
        const hint = document.createElement('div');
        hint.className = 'modal-combinar-duplicados-item-hint';
        hint.textContent = `Copia · Nivel ${Number(carta.Nivel || 1)} · índice ${index}`;
        item.appendChild(mini);
        item.appendChild(hint);
        item.addEventListener('click', () => {
            if (seleccionIndicesCombinacion.has(index)) {
                seleccionIndicesCombinacion.delete(index);
            } else {
                seleccionIndicesCombinacion.add(index);
            }
            renderListaSeleccionCombinacion(usuario);
            actualizarBotonAceptarCombinacion();
        });
        lista.appendChild(item);
    });
}

function abrirModalCombinarDuplicados(grupo) {
    if (!grupoEsClicableCombinar(grupo)) {
        return;
    }
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    if (!usuario?.cartas) {
        return;
    }
    combinacionDuplicadosGrupo = grupo;
    seleccionIndicesCombinacion.clear();

    const modal = document.getElementById('modal-combinar-duplicados');
    const desc = document.getElementById('combinar-duplicados-descripcion');
    const keeperWrap = document.getElementById('combinar-duplicados-keeper');
    if (!modal || !desc || !keeperWrap) {
        return;
    }

    const nivelK = Number(grupo.keeperCarta.Nivel || 1);
    const maxSubidas = Math.max(0, 5 - nivelK);
    desc.textContent = `Tienes ${grupo.total} copias de «${grupo.nombre}». Puedes subir hasta ${maxSubidas} nivel(es) fusionando copias (se consumen las que elijas, priorizando las de menor nivel).`;

    keeperWrap.innerHTML = '';
    keeperWrap.appendChild(crearElementoCartaSoloVisual(grupo.keeperCarta, false, 200));

    renderListaSeleccionCombinacion(usuario);
    actualizarBotonAceptarCombinacion();
    modal.style.display = 'flex';
}

async function confirmarCombinacionDuplicados() {
    if (!combinacionDuplicadosGrupo || seleccionIndicesCombinacion.size === 0) {
        return;
    }
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');
    if (!usuario?.cartas || !email) {
        mostrarMensaje('No se pudo validar la sesión.', 'danger');
        cerrarModalCombinarDuplicados();
        return;
    }

    const resultado = calcularFusionDesdeSeleccion(
        usuario,
        combinacionDuplicadosGrupo.keeperIndex,
        Array.from(seleccionIndicesCombinacion)
    );
    if (!resultado) {
        mostrarMensaje('No se puede aplicar esta combinación.', 'warning');
        return;
    }

    usuario.cartas = resultado.nuevasCartas;
    sincronizarMazosConColeccion(usuario);
    const facFusion = normalizarFaccion(resultado?.cartaMejorada?.faccion || resultado?.cartaMejorada?.Faccion || '');
    const fusionLlegaNivel6 = Number(resultado?.cartaAntes?.Nivel || 1) < 6 && Number(resultado?.cartaMejorada?.Nivel || 1) === 6;

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        if (window.DCMisiones?.track) {
            if (facFusion === 'H') window.DCMisiones.track('mejorar_cartas_h', { amount: 1 });
            if (facFusion === 'V') window.DCMisiones.track('mejorar_cartas_v', { amount: 1 });
            if (fusionLlegaNivel6) window.DCMisiones.track('mejorar_nivel', { amount: 1 });
        }
        refrescarPanelPerfilLateral();
        const { cartaAntes, cartaMejorada } = resultado;
        cerrarModalCombinarDuplicados();
        cargarCartas();
        mostrarResultadoMejoraObjeto(cartaAntes, cartaMejorada);
        mostrarMensaje('Fusión de duplicados aplicada correctamente.', 'success');
    } catch (error) {
        console.error('Error al fusionar duplicados:', error);
        mostrarMensaje('Error al guardar la fusión.', 'danger');
    }
}

function crearPoolCartasPorNombre(cartas) {
    const pool = new Map();

    cartas.forEach(carta => {
        const clave = String(carta?.Nombre || '').trim().toLowerCase();
        if (!clave) {
            return;
        }
        if (!pool.has(clave)) {
            pool.set(clave, []);
        }

        pool.get(clave).push({ ...carta });
    });

    pool.forEach(listaCartas => {
        listaCartas.sort((a, b) => {
            const diferenciaNivel = (b.Nivel || 1) - (a.Nivel || 1);
            if (diferenciaNivel !== 0) {
                return diferenciaNivel;
            }

            return (b.Poder || 0) - (a.Poder || 0);
        });
    });

    return pool;
}

function normalizarObjetosUsuario(usuario) {
    if (!usuario || typeof usuario !== 'object') {
        return;
    }

    const objetosBase = usuario.objetos && typeof usuario.objetos === 'object'
        ? { ...usuario.objetos }
        : { mejoraCarta: 0, mejoraEspecial: 0, mejoraSuprema: 0, mejoraDefinitiva: 0, mejoraElite: 0, mejoraLegendaria: 0 };

    objetosBase.mejoraCarta = Number(usuario.objetos?.mejoraCarta ?? objetosBase.mejoraCarta ?? 0);
    objetosBase.mejoraEspecial = Number(usuario.objetos?.mejoraEspecial ?? objetosBase.mejoraEspecial ?? 0);
    objetosBase.mejoraSuprema = Number(usuario.objetos?.mejoraSuprema ?? objetosBase.mejoraSuprema ?? 0);
    objetosBase.mejoraDefinitiva = Number(usuario.objetos?.mejoraDefinitiva ?? objetosBase.mejoraDefinitiva ?? 0);
    objetosBase.mejoraElite = Number(usuario.objetos?.mejoraElite ?? objetosBase.mejoraElite ?? 0);
    objetosBase.mejoraLegendaria = Number(usuario.objetos?.mejoraLegendaria ?? objetosBase.mejoraLegendaria ?? 0);

    if (Array.isArray(usuario.inventarioObjetos)) {
        const legacyMejoraCarta = usuario.inventarioObjetos.find(item => item.id === 'obj-mejora-carta');
        const legacyMejoraEspecial = usuario.inventarioObjetos.find(item => item.id === 'obj-mejora-especial');
        const legacyMejoraSuprema = usuario.inventarioObjetos.find(item => item.id === 'obj-mejora-suprema');
        const legacyMejoraDefinitiva = usuario.inventarioObjetos.find(item => item.id === 'obj-mejora-definitiva');

        objetosBase.mejoraCarta = Math.max(objetosBase.mejoraCarta, Number(legacyMejoraCarta?.cantidad || 0));
        objetosBase.mejoraEspecial = Math.max(objetosBase.mejoraEspecial, Number(legacyMejoraEspecial?.cantidad || 0));
        objetosBase.mejoraSuprema = Math.max(objetosBase.mejoraSuprema, Number(legacyMejoraSuprema?.cantidad || 0));
        objetosBase.mejoraDefinitiva = Math.max(objetosBase.mejoraDefinitiva, Number(legacyMejoraDefinitiva?.cantidad || 0));
    }

    if (typeof window.DC_SOBRES_MEZCLAR_INVENTARIO === 'function') {
        usuario.objetos = window.DC_SOBRES_MEZCLAR_INVENTARIO(objetosBase);
    } else {
        usuario.objetos = objetosBase;
    }
}

function crearElementoCartaSoloVisual(carta, destacarPoder = false, anchoCartaPx = 210) {
    const cartaDiv = document.createElement('div');
    cartaDiv.classList.add('carta');
    if (typeof window.dcAplicarClasesNivelCartaCompleta === 'function') {
        window.dcAplicarClasesNivelCartaCompleta(cartaDiv, carta);
    } else if (esCartaLegendaria(carta)) {
        cartaDiv.classList.add('nivel-legendaria');
    }
    if (Number.isFinite(anchoCartaPx) && anchoCartaPx > 0) {
        cartaDiv.style.width = `${anchoCartaPx}px`;
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
    if (destacarPoder && !esCartaLegendaria(carta)) {
        poderSpan.style.color = '#FFD700';
        poderSpan.style.fontWeight = '700';
    }

    detallesDiv.appendChild(nombreSpan);
    detallesDiv.appendChild(poderSpan);

    const estrellasDiv = document.createElement('div');
    estrellasDiv.classList.add('estrellas-carta');

    if (typeof window.dcRellenarEstrellasCartaCompleta === 'function') {
        window.dcRellenarEstrellasCartaCompleta(estrellasDiv, carta, {});
    } else {
        const nivel = carta.Nivel || 1;
        for (let i = 0; i < nivel; i++) {
            const estrella = document.createElement('img');
            estrella.classList.add('estrella');
            estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
            estrella.alt = 'star';
            estrellasDiv.appendChild(estrella);
        }
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
    return cartaDiv;
}

function actualizarContadoresObjetos(usuario) {
    normalizarObjetosUsuario(usuario);
    const mapa = {
        'contador-mejora-carta': { icon: ICONO_MEJORA, label: 'Mejora de carta', key: 'mejoraCarta' },
        'contador-mejora-especial': { icon: ICONO_MEJORA_ESPECIAL, label: 'Mejora especial', key: 'mejoraEspecial' },
        'contador-mejora-suprema': { icon: ICONO_MEJORA_SUPREMA, label: 'Mejora suprema', key: 'mejoraSuprema' },
        'contador-mejora-definitiva': { icon: ICONO_MEJORA_DEFINITIVA, label: 'Mejora definitiva', key: 'mejoraDefinitiva' }
    };
    Object.keys(mapa).forEach((id) => {
        const el = document.getElementById(id);
        if (!el) {
            return;
        }
        const { icon, label, key } = mapa[id];
        const n = Number(usuario.objetos?.[key] || 0);
        el.innerHTML = `<img src="${icon}" alt="" style="width:40px; height:40px; object-fit:contain;">${label}: <strong>${n}</strong>`;
    });
}

/** Una carta por nombre (mejor nivel/poder); solo niveles 1–5 (la 6★ no usa objetos aquí). */
function obtenerCartasPanelMejorasObjetos(usuario) {
    const cartas = Array.isArray(usuario?.cartas) ? usuario.cartas : [];
    const candidatos = cartas
        .map((carta, index) => ({ ...carta, originalIndex: index }))
        .filter((carta) => {
            const nivel = Number(carta.Nivel || 1);
            return nivel >= 1 && nivel <= 5;
        });

    const mejorPorNombre = new Map();
    candidatos.forEach((item) => {
        const nombre = String(item.Nombre || '').trim().toLowerCase();
        if (!nombre) {
            return;
        }
        const prev = mejorPorNombre.get(nombre);
        if (!prev) {
            mejorPorNombre.set(nombre, item);
            return;
        }
        const nPrev = Number(prev.Nivel || 1);
        const nCur = Number(item.Nivel || 1);
        if (nCur > nPrev) {
            mejorPorNombre.set(nombre, item);
            return;
        }
        if (nCur === nPrev) {
            const pPrev = Number(prev.Poder || 0);
            const pCur = Number(item.Poder || 0);
            if (pCur > pPrev || (pCur === pPrev && item.originalIndex < prev.originalIndex)) {
                mejorPorNombre.set(nombre, item);
            }
        }
    });

    return Array.from(mejorPorNombre.values()).sort((a, b) =>
        String(a.Nombre || '').localeCompare(String(b.Nombre || ''), undefined, { sensitivity: 'base' })
    );
}

function obtenerFaccionCartaMejorasObjetos(carta) {
    return normalizarFaccion(carta?.faccion || carta?.Faccion || '');
}

function filtrarYOrdenarCartasMejorasObjetos(cartas) {
    const lista = (Array.isArray(cartas) ? cartas : []).filter((carta) => {
        return obtenerFaccionCartaMejorasObjetos(carta) === faccionMejorasObjetosActiva;
    });
    lista.sort((a, b) => {
        if (ordenarPoderMejorasObjetos) {
            const diffPoder = Number(b.Poder || 0) - Number(a.Poder || 0);
            if (diffPoder !== 0) {
                return diffPoder;
            }
        }
        return String(a.Nombre || '').localeCompare(String(b.Nombre || ''), undefined, { sensitivity: 'base' });
    });
    return lista;
}

function actualizarTabsFaccionMejorasObjetos() {
    const tabH = document.getElementById('tab-mejoras-objetos-heroes');
    const tabV = document.getElementById('tab-mejoras-objetos-villanos');
    if (tabH) {
        tabH.classList.toggle('active', faccionMejorasObjetosActiva === 'H');
    }
    if (tabV) {
        tabV.classList.toggle('active', faccionMejorasObjetosActiva === 'V');
    }
}

function configurarFiltrosMejorasObjetos() {
    if (filtrosMejorasObjetosRegistrados) {
        return;
    }
    const tabH = document.getElementById('tab-mejoras-objetos-heroes');
    const tabV = document.getElementById('tab-mejoras-objetos-villanos');
    const chkPoder = document.getElementById('ordenar-poder-mejoras-objetos');
    if (!tabH && !tabV && !chkPoder) {
        return;
    }
    filtrosMejorasObjetosRegistrados = true;

    tabH?.addEventListener('click', () => {
        faccionMejorasObjetosActiva = 'H';
        actualizarTabsFaccionMejorasObjetos();
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        renderizarSeccionMejorasObjetos(usuario);
    });
    tabV?.addEventListener('click', () => {
        faccionMejorasObjetosActiva = 'V';
        actualizarTabsFaccionMejorasObjetos();
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        renderizarSeccionMejorasObjetos(usuario);
    });
    chkPoder?.addEventListener('change', function () {
        ordenarPoderMejorasObjetos = Boolean(this.checked);
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        renderizarSeccionMejorasObjetos(usuario);
    });
}

function puedeUsarObjetoEnCarta(keyObjeto, nivelCarta, cantidadInventario) {
    const n = Number(nivelCarta || 1);
    if (cantidadInventario <= 0) {
        return false;
    }
    if (n >= 6) {
        return false;
    }
    if (keyObjeto === 'mejoraCarta') {
        return n >= 1 && n <= 3;
    }
    if (keyObjeto === 'mejoraSuprema') {
        return n >= 1 && n <= 4;
    }
    if (keyObjeto === 'mejoraEspecial') {
        return n === 5;
    }
    if (keyObjeto === 'mejoraDefinitiva') {
        return n >= 1 && n <= 5;
    }
    return false;
}

function renderizarFilasModalObjetosMejora(usuario, carta) {
    const wrap = document.getElementById('modal-seleccion-objeto-filas');
    if (!wrap) {
        return;
    }
    wrap.innerHTML = '';
    const nivel = Number(carta.Nivel || 1);

    OBJETOS_MEJORA_UI.forEach((def) => {
        const cant = Number(usuario.objetos?.[def.key] || 0);
        const habilitado = puedeUsarObjetoEnCarta(def.key, nivel, cant);

        const fila = document.createElement('div');
        fila.className = 'modal-seleccion-objeto-fila';

        const iconWrap = document.createElement('div');
        iconWrap.className = 'modal-seleccion-objeto-fila-icono';
        const img = document.createElement('img');
        img.src = def.icon;
        img.alt = def.nombre;
        iconWrap.appendChild(img);

        const texto = document.createElement('div');
        texto.className = 'modal-seleccion-objeto-fila-texto';
        const strong = document.createElement('strong');
        strong.textContent = def.nombre;
        const small = document.createElement('small');
        small.textContent = `${def.descripcion} · En inventario: ${cant}`;
        texto.appendChild(strong);
        texto.appendChild(small);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-primary btn-usar-objeto';
        btn.textContent = 'Usar';
        btn.disabled = !habilitado;
        btn.addEventListener('click', () => {
            void aplicarMejoraObjetoDesdeModal(def.key, carta.originalIndex);
        });

        fila.appendChild(iconWrap);
        fila.appendChild(texto);
        fila.appendChild(btn);
        wrap.appendChild(fila);
    });
}

function abrirModalSeleccionObjetoMejora(indiceCarta) {
    const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
    normalizarObjetosUsuario(usuario);
    const carta = usuario?.cartas?.[indiceCarta];
    if (!carta) {
        mostrarMensaje('No se encontró la carta seleccionada.', 'danger');
        return;
    }
    const nivel = Number(carta.Nivel || 1);
    if (nivel < 1 || nivel > 5) {
        mostrarMensaje('Esta carta no admite mejoras con objetos.', 'warning');
        return;
    }

    indiceCartaModalObjetos = indiceCarta;
    const modal = document.getElementById('modal-seleccion-objeto-mejora');
    const sub = document.getElementById('modal-seleccion-objeto-subtitulo');
    if (sub) {
        sub.textContent = `${String(carta.Nombre || '')} · Nivel ${nivel}★`;
    }
    renderizarFilasModalObjetosMejora(usuario, { ...carta, originalIndex: indiceCarta });
    if (modal) {
        modal.style.display = 'flex';
    }
}

function cerrarModalSeleccionObjetoMejora() {
    const modal = document.getElementById('modal-seleccion-objeto-mejora');
    if (modal) {
        modal.style.display = 'none';
    }
    indiceCartaModalObjetos = null;
}

function renderizarSeccionMejorasObjetos(usuario) {
    actualizarContadoresObjetos(usuario);
    actualizarTabsFaccionMejorasObjetos();
    const contenedor = document.getElementById('contenedor-mejoras-objetos-todas');
    if (!contenedor) {
        return;
    }

    contenedor.innerHTML = '';
    const todas = obtenerCartasPanelMejorasObjetos(usuario);
    const cartas = filtrarYOrdenarCartasMejorasObjetos(todas);

    if (todas.length === 0) {
        const vacio = document.createElement('div');
        vacio.className = 'alert alert-info';
        vacio.textContent = 'No tienes cartas de nivel 1 a 5 para usar objetos de mejora.';
        contenedor.appendChild(vacio);
        return;
    }

    if (cartas.length === 0) {
        const vacio = document.createElement('div');
        vacio.className = 'alert alert-info';
        vacio.textContent = `No tienes cartas de ${faccionMejorasObjetosActiva === 'H' ? 'héroes' : 'villanos'} de nivel 1 a 5 en esta vista. Prueba la otra facción.`;
        contenedor.appendChild(vacio);
        return;
    }

    cartas.forEach((carta) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'mejora-objeto-fila';

        const cartaVisual = crearElementoCartaSoloVisual(carta, false, 0);
        const boton = document.createElement('button');
        boton.className = 'btn btn-mejora-objeto';
        boton.textContent = 'Mejorar';
        boton.addEventListener('click', () => abrirModalSeleccionObjetoMejora(carta.originalIndex));

        wrapper.appendChild(cartaVisual);
        wrapper.appendChild(boton);
        contenedor.appendChild(wrapper);
    });
}

function actualizarContadoresFragmentos(usuario) {
    normalizarObjetosUsuario(usuario);
    const elite = document.getElementById('contador-fragmento-elite');
    const leg = document.getElementById('contador-fragmento-legendario');
    const nElite = Number(usuario.objetos?.mejoraElite || 0);
    const nLeg = Number(usuario.objetos?.mejoraLegendaria || 0);
    if (elite) {
        elite.innerHTML = `<img src="${ICONO_FRAGMENTO_ELITE_UI}" alt="" style="width:40px; height:40px; object-fit:contain;">Fragmentos: <strong>${nElite}</strong>`;
    }
    if (leg) {
        leg.innerHTML = `<img src="${ICONO_FRAGMENTO_LEGENDARIA_UI}" alt="" style="width:40px; height:40px; object-fit:contain;">Fragmentos legendarios: <strong>${nLeg}</strong>`;
    }
}

/** Una carta por nombre (mejor nivel/poder); solo niveles 6 y 7 (8★ no se listan aquí). */
function obtenerCartasPanelFragmentos(usuario) {
    const cartas = Array.isArray(usuario?.cartas) ? usuario.cartas : [];
    const candidatos = cartas
        .map((carta, index) => ({ ...carta, originalIndex: index }))
        .filter((carta) => {
            const nivel = Number(carta.Nivel || 1);
            return nivel === 6 || nivel === 7;
        });

    const mejorPorNombre = new Map();
    candidatos.forEach((item) => {
        const nombre = String(item.Nombre || '').trim().toLowerCase();
        if (!nombre) {
            return;
        }
        const prev = mejorPorNombre.get(nombre);
        if (!prev) {
            mejorPorNombre.set(nombre, item);
            return;
        }
        const nPrev = Number(prev.Nivel || 1);
        const nCur = Number(item.Nivel || 1);
        if (nCur > nPrev) {
            mejorPorNombre.set(nombre, item);
            return;
        }
        if (nCur === nPrev) {
            const pPrev = Number(prev.Poder || 0);
            const pCur = Number(item.Poder || 0);
            if (pCur > pPrev || (pCur === pPrev && item.originalIndex < prev.originalIndex)) {
                mejorPorNombre.set(nombre, item);
            }
        }
    });

    return Array.from(mejorPorNombre.values()).sort((a, b) =>
        String(a.Nombre || '').localeCompare(String(b.Nombre || ''), undefined, { sensitivity: 'base' })
    );
}

function filtrarYOrdenarCartasFragmentos(cartas) {
    const lista = (Array.isArray(cartas) ? cartas : []).filter((carta) => {
        return obtenerFaccionCartaMejorasObjetos(carta) === faccionFragmentosActiva;
    });
    lista.sort((a, b) => {
        if (ordenarPoderFragmentos) {
            const diffPoder = Number(b.Poder || 0) - Number(a.Poder || 0);
            if (diffPoder !== 0) {
                return diffPoder;
            }
        }
        return String(a.Nombre || '').localeCompare(String(b.Nombre || ''), undefined, { sensitivity: 'base' });
    });
    return lista;
}

function actualizarTabsFaccionFragmentos() {
    const tabH = document.getElementById('tab-fragmentos-heroes');
    const tabV = document.getElementById('tab-fragmentos-villanos');
    if (tabH) {
        tabH.classList.toggle('active', faccionFragmentosActiva === 'H');
    }
    if (tabV) {
        tabV.classList.toggle('active', faccionFragmentosActiva === 'V');
    }
}

function configurarFiltrosFragmentos() {
    if (filtrosFragmentosRegistrados) {
        return;
    }
    const tabH = document.getElementById('tab-fragmentos-heroes');
    const tabV = document.getElementById('tab-fragmentos-villanos');
    const chkPoder = document.getElementById('ordenar-poder-fragmentos');
    if (!tabH && !tabV && !chkPoder) {
        return;
    }
    filtrosFragmentosRegistrados = true;

    tabH?.addEventListener('click', () => {
        faccionFragmentosActiva = 'H';
        actualizarTabsFaccionFragmentos();
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        renderizarSeccionFragmentos(usuario);
    });
    tabV?.addEventListener('click', () => {
        faccionFragmentosActiva = 'V';
        actualizarTabsFaccionFragmentos();
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        renderizarSeccionFragmentos(usuario);
    });
    chkPoder?.addEventListener('change', function () {
        ordenarPoderFragmentos = Boolean(this.checked);
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        renderizarSeccionFragmentos(usuario);
    });
}

function construirFilaModalFragmento(opts) {
    const {
        descripcion,
        iconSrc,
        habilitado,
        tipoFragmento
    } = opts;

    const fila = document.createElement('div');
    fila.className = 'modal-seleccion-objeto-fila';

    const iconWrap = document.createElement('div');
    iconWrap.className = 'modal-seleccion-objeto-fila-icono';
    const img = document.createElement('img');
    img.src = iconSrc;
    img.alt = '';
    iconWrap.appendChild(img);

    const texto = document.createElement('div');
    texto.className = 'modal-seleccion-objeto-fila-texto';
    const strong = document.createElement('strong');
    strong.textContent = tipoFragmento === 'elite' ? 'Ascenso a 7★ (Élite)' : 'Ascenso a 8★ (Legendario)';
    const small = document.createElement('small');
    small.textContent = descripcion;
    texto.appendChild(strong);
    texto.appendChild(small);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary btn-usar-objeto';
    btn.textContent = 'Usar';
    btn.disabled = !habilitado;
    btn.addEventListener('click', () => {
        void aplicarMejoraFragmentoDesdeModal(tipoFragmento);
    });

    fila.appendChild(iconWrap);
    fila.appendChild(texto);
    fila.appendChild(btn);

    return fila;
}

function renderizarFilasModalFragmentos(usuario, carta) {
    const wrap = document.getElementById('modal-fragmentos-filas');
    if (!wrap) {
        return;
    }
    wrap.innerHTML = '';
    const nivel = Number(carta.Nivel || 1);
    const stockElite = Number(usuario.objetos?.mejoraElite || 0);
    const stockLeg = Number(usuario.objetos?.mejoraLegendaria || 0);
    const okElite = nivel === 6 && stockElite >= COSTO_MEJORA_FRAGMENTOS;
    const okLeg = nivel === 7 && stockLeg >= COSTO_MEJORA_FRAGMENTOS;

    const hElite = document.createElement('h5');
    hElite.className = 'modal-fragmentos-bloque-titulo';
    hElite.textContent = 'Mejorar a nivel Élite';
    wrap.appendChild(hElite);
    wrap.appendChild(construirFilaModalFragmento({
        descripcion: `Consume ${COSTO_MEJORA_FRAGMENTOS} fragmentos (mejora élite). Solo cartas 6★. En inventario: ${stockElite}.`,
        iconSrc: ICONO_FRAGMENTO_ELITE_UI,
        habilitado: okElite,
        tipoFragmento: 'elite'
    }));

    const hLeg = document.createElement('h5');
    hLeg.className = 'modal-fragmentos-bloque-titulo';
    hLeg.textContent = 'Mejorar a nivel Legendario';
    wrap.appendChild(hLeg);
    wrap.appendChild(construirFilaModalFragmento({
        descripcion: `Consume ${COSTO_MEJORA_FRAGMENTOS} fragmentos legendarios (mejora legendaria). Solo cartas 7★. En inventario: ${stockLeg}.`,
        iconSrc: ICONO_FRAGMENTO_LEGENDARIA_UI,
        habilitado: okLeg,
        tipoFragmento: 'legendario'
    }));
}

function abrirModalSeleccionFragmentos(indiceCarta) {
    const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
    normalizarObjetosUsuario(usuario);
    const carta = usuario?.cartas?.[indiceCarta];
    if (!carta) {
        mostrarMensaje('No se encontró la carta seleccionada.', 'danger');
        return;
    }
    const nivel = Number(carta.Nivel || 1);
    if (nivel !== 6 && nivel !== 7) {
        mostrarMensaje('Los fragmentos solo aplican a cartas 6★ o 7★.', 'warning');
        return;
    }

    indiceCartaModalFragmentos = indiceCarta;
    const modal = document.getElementById('modal-seleccion-fragmentos-mejora');
    const sub = document.getElementById('modal-fragmentos-subtitulo');
    if (sub) {
        sub.textContent = `${String(carta.Nombre || '')} · Nivel ${nivel}★`;
    }
    renderizarFilasModalFragmentos(usuario, { ...carta, originalIndex: indiceCarta });
    if (modal) {
        modal.style.display = 'flex';
    }
}

function cerrarModalSeleccionFragmentos() {
    const modal = document.getElementById('modal-seleccion-fragmentos-mejora');
    if (modal) {
        modal.style.display = 'none';
    }
    indiceCartaModalFragmentos = null;
}

function renderizarSeccionFragmentos(usuario) {
    actualizarContadoresFragmentos(usuario);
    actualizarTabsFaccionFragmentos();
    const contenedor = document.getElementById('contenedor-fragmentos-todas');
    if (!contenedor) {
        return;
    }

    contenedor.innerHTML = '';
    const todas = obtenerCartasPanelFragmentos(usuario);
    const cartas = filtrarYOrdenarCartasFragmentos(todas);

    if (todas.length === 0) {
        const vacio = document.createElement('div');
        vacio.className = 'alert alert-info';
        vacio.textContent = 'No tienes cartas de nivel 6 o 7 para usar fragmentos.';
        contenedor.appendChild(vacio);
        return;
    }

    if (cartas.length === 0) {
        const vacio = document.createElement('div');
        vacio.className = 'alert alert-info';
        vacio.textContent = `No tienes cartas de ${faccionFragmentosActiva === 'H' ? 'héroes' : 'villanos'} de nivel 6 o 7 en esta vista. Prueba la otra facción.`;
        contenedor.appendChild(vacio);
        return;
    }

    cartas.forEach((carta) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'mejora-objeto-fila';

        const cartaVisual = crearElementoCartaSoloVisual(carta, false, 0);
        const boton = document.createElement('button');
        boton.className = 'btn btn-mejora-objeto';
        boton.textContent = 'Mejorar';
        boton.addEventListener('click', () => abrirModalSeleccionFragmentos(carta.originalIndex));

        wrapper.appendChild(cartaVisual);
        wrapper.appendChild(boton);
        contenedor.appendChild(wrapper);
    });
}

function crearCartaMejoradaPorFragmento(cartaOriginal, tipoFragmento) {
    const original = { ...cartaOriginal };
    const mejorada = { ...cartaOriginal };
    const saludBase = Number((mejorada.SaludMax ?? mejorada.Salud ?? mejorada.Poder) || 0);
    const nivelInicial = Number(mejorada.Nivel || 1);
    let nivelFinal = nivelInicial;
    if (tipoFragmento === 'elite') {
        nivelFinal = 7;
    } else if (tipoFragmento === 'legendario') {
        nivelFinal = 8;
    }
    const incrementoNiveles = Math.max(nivelFinal - nivelInicial, 0);
    mejorada.Nivel = nivelFinal;
    mejorada.Poder = Number(mejorada.Poder || 0) + (incrementoNiveles * 500);
    mejorada.SaludMax = saludBase + (incrementoNiveles * 500);
    mejorada.Salud = mejorada.SaludMax;

    if (typeof window.recalcularSkillPowerPorNivel === 'function') {
        window.recalcularSkillPowerPorNivel(mejorada, Number(mejorada.Nivel || 1));
    }

    return { original, mejorada };
}

function cerrarModalAnimacionFragmento() {
    const modal = document.getElementById('modal-animacion-fragmento');
    if (modal) {
        modal.style.display = 'none';
    }
    const flash = document.getElementById('fragmento-anim-flash');
    flash?.classList.remove('fragmento-anim-flash--on');
    fragmentoAnimEnCurso = false;
}

async function ejecutarAnimacionRevelacionFragmento(tipoFragmento, cartaMejorada) {
    const modal = document.getElementById('modal-animacion-fragmento');
    const faseIcono = document.getElementById('fragmento-anim-fase-icono');
    const flash = document.getElementById('fragmento-anim-flash');
    const resultado = document.getElementById('fragmento-anim-resultado');
    const btnCerrar = document.getElementById('btn-cerrar-animacion-fragmento');
    if (!modal || !faseIcono || !flash || !resultado || !btnCerrar) {
        return;
    }

    btnCerrar.style.display = 'none';
    resultado.innerHTML = '';
    resultado.style.display = 'none';
    faseIcono.innerHTML = '';
    faseIcono.style.display = '';
    flash.classList.remove('fragmento-anim-flash--on');
    void flash.offsetWidth;

    const imgSrc = tipoFragmento === 'elite' ? ICONO_ANIM_ELITE : ICONO_ANIM_LEGENDARY;
    const img = document.createElement('img');
    img.className = 'apertura-sobre-img-envelope';
    img.src = imgSrc;
    img.alt = tipoFragmento === 'elite' ? 'Élite' : 'Legendario';

    const envTxt = document.createElement('p');
    envTxt.className = 'apertura-sobre-texto-estado';
    envTxt.textContent = tipoFragmento === 'elite' ? 'Forjando nivel élite…' : 'Ascendiendo a legendario…';
    faseIcono.appendChild(img);
    faseIcono.appendChild(envTxt);

    modal.style.display = 'flex';

    await esperar(1650);

    flash.classList.add('fragmento-anim-flash--on');
    await esperar(460);
    flash.classList.remove('fragmento-anim-flash--on');

    faseIcono.style.display = 'none';
    resultado.style.display = 'flex';
    const wrap = document.createElement('div');
    wrap.className = 'fragmento-anim-resultado-wrap';
    const cartaEl = crearElementoCartaSoloVisual(cartaMejorada, true, 268);
    cartaEl.classList.add('apertura-sobre-mini-carta', 'apertura-sobre-carta-resplandor-oro');
    wrap.appendChild(cartaEl);
    resultado.appendChild(wrap);

    cartaEl.style.opacity = '0';
    cartaEl.style.transform = 'translateY(24px) scale(0.92)';
    requestAnimationFrame(() => {
        cartaEl.style.transition = 'opacity 0.48s ease, transform 0.55s cubic-bezier(0.22, 0.92, 0.28, 1)';
        cartaEl.style.opacity = '1';
        cartaEl.style.transform = 'translateY(0) scale(1)';
    });
    await esperar(520);
    btnCerrar.style.display = 'inline-block';
}

async function aplicarMejoraFragmentoDesdeModal(tipoFragmento) {
    if (fragmentoAnimEnCurso) {
        return;
    }
    const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
    const email = localStorage.getItem('email');
    normalizarObjetosUsuario(usuario);

    if (!usuario || !email) {
        mostrarMensaje('No se pudo validar la sesión del usuario.', 'danger');
        return;
    }

    const indiceCarta = indiceCartaModalFragmentos;
    if (indiceCarta === null || indiceCarta === undefined) {
        mostrarMensaje('No hay carta seleccionada para fragmentos.', 'warning');
        return;
    }

    const carta = usuario.cartas?.[indiceCarta];
    if (!carta) {
        mostrarMensaje('La carta seleccionada ya no está disponible.', 'danger');
        cerrarModalSeleccionFragmentos();
        return;
    }

    const nivel = Number(carta.Nivel || 1);
    const key = tipoFragmento === 'elite' ? 'mejoraElite' : 'mejoraLegendaria';
    const stock = Number(usuario.objetos?.[key] || 0);

    if (tipoFragmento === 'elite') {
        if (nivel !== 6 || stock < COSTO_MEJORA_FRAGMENTOS) {
            mostrarMensaje('Solo cartas 6★ con 12 fragmentos disponibles.', 'warning');
            return;
        }
    } else if (tipoFragmento === 'legendario') {
        if (nivel !== 7 || stock < COSTO_MEJORA_FRAGMENTOS) {
            mostrarMensaje('Solo cartas 7★ con 12 fragmentos legendarios disponibles.', 'warning');
            return;
        }
    } else {
        return;
    }

    const { original, mejorada } = crearCartaMejoradaPorFragmento(carta, tipoFragmento);
    if (Number(mejorada.Nivel || 1) === Number(original.Nivel || 1)) {
        mostrarMensaje('No se pudo calcular la mejora de nivel.', 'warning');
        return;
    }

    const faccionMejorada = normalizarFaccion(mejorada?.faccion || mejorada?.Faccion || '');
    usuario.cartas[indiceCarta] = mejorada;
    usuario.objetos[key] = stock - COSTO_MEJORA_FRAGMENTOS;
    sincronizarMazosConColeccion(usuario);

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        if (window.DCMisiones?.track) {
            if (faccionMejorada === 'H') window.DCMisiones.track('mejorar_cartas_h', { amount: 1 });
            if (faccionMejorada === 'V') window.DCMisiones.track('mejorar_cartas_v', { amount: 1 });
            window.DCMisiones.track('mejorar_nivel', { amount: 1 });
        }
        refrescarPanelPerfilLateral();
        cerrarModalSeleccionFragmentos();
        cargarCartas();
        fragmentoAnimEnCurso = true;
        try {
            await ejecutarAnimacionRevelacionFragmento(tipoFragmento, mejorada);
        } finally {
            fragmentoAnimEnCurso = false;
        }
    } catch (error) {
        console.error('Error al aplicar mejora con fragmentos:', error);
        fragmentoAnimEnCurso = false;
        mostrarMensaje('Error al guardar la mejora con fragmentos.', 'danger');
    }
}

function sincronizarMazosConColeccion(usuario) {
    if (!usuario.mazos || !Array.isArray(usuario.mazos)) {
        usuario.mazos = [];
        return;
    }

    const poolCartas = crearPoolCartasPorNombre(usuario.cartas || []);

    usuario.mazos = usuario.mazos.map(mazo => {
        const cartasSincronizadas = (mazo.Cartas || []).map(cartaMazo => {
            const clave = String(cartaMazo?.Nombre || '').trim().toLowerCase();
            const disponibles = poolCartas.get(clave) || [];

            // Tomamos la mejor versión disponible sin eliminar cartas del mazo
            // cuando no exista coincidencia en colección (evita mazos "vacíos").
            if (disponibles.length > 0) {
                return { ...disponibles[0] };
            }

            return { ...cartaMazo };
        });

        return {
            ...mazo,
            Cartas: cartasSincronizadas
        };
    });
}

function analizarMejoraAutomatica(cartas) {
    const grupos = new Map();

    cartas.forEach(carta => {
        if (!grupos.has(carta.Nombre)) {
            grupos.set(carta.Nombre, []);
        }

        grupos.get(carta.Nombre).push({ ...carta });
    });

    const cartasActualizadas = [];
    const mejoras = [];
    const destruidas = [];
    let puntosGanados = 0;

    grupos.forEach((grupoCartas, nombreCarta) => {
        grupoCartas.sort((a, b) => {
            const diferenciaNivel = (b.Nivel || 1) - (a.Nivel || 1);
            if (diferenciaNivel !== 0) {
                return diferenciaNivel;
            }

            return (b.Poder || 0) - (a.Poder || 0);
        });

        const cartaBase = { ...grupoCartas[0] };
        let duplicados = grupoCartas.slice(1).map(carta => ({ ...carta }));
        const nivelInicial = cartaBase.Nivel || 1;

        if (nivelInicial < 5 && duplicados.length > 0) {
            const mejorasPosibles = Math.min(5 - nivelInicial, duplicados.length);

            if (mejorasPosibles > 0) {
                cartaBase.Nivel = nivelInicial + mejorasPosibles;
                cartaBase.Poder = (cartaBase.Poder || 0) + (500 * mejorasPosibles);
                if (typeof window.recalcularSkillPowerPorNivel === 'function') {
                    window.recalcularSkillPowerPorNivel(cartaBase, cartaBase.Nivel);
                }
                duplicados = duplicados.slice(mejorasPosibles);

                mejoras.push({
                    nombre: nombreCarta,
                    nivelInicial,
                    nivelFinal: cartaBase.Nivel,
                    cartasConsumidas: mejorasPosibles,
                    cartaAntes: {
                        ...grupoCartas[0],
                        Nivel: nivelInicial
                    },
                    cartaDespues: {
                        ...cartaBase
                    }
                });
            }
        }

        cartasActualizadas.push(cartaBase, ...duplicados);
    });

    return {
        cartasActualizadas,
        mejoras,
        destruidas,
        puntosGanados
    };
}

function analizarDestruccionDuplicados(cartas) {
    const usuarioMock = { cartas: Array.isArray(cartas) ? cartas : [] };
    const grupos = construirGruposDestruccion(usuarioMock);
    const indicesADestruir = new Set();
    const destruidas = [];
    let puntosGanados = 0;

    grupos.forEach((grupo) => {
        grupo.copiasDestruibles.forEach((item) => {
            indicesADestruir.add(item.index);
            const nivel = Number(item?.carta?.Nivel || 1);
            const puntos = obtenerValorDestruccion(nivel);
            puntosGanados += puntos;
            destruidas.push({
                nombre: String(item?.carta?.Nombre || grupo.nombre),
                nivel,
                puntos
            });
        });
    });

    const cartasActualizadas = (Array.isArray(cartas) ? cartas : []).filter((_, idx) => !indicesADestruir.has(idx));
    return {
        cartasActualizadas,
        destruidas,
        puntosGanados
    };
}

function cargarCartas() {
    console.log('Cargando cartas del usuario...');

    const usuario = JSON.parse(localStorage.getItem('usuario'));
    normalizarObjetosUsuario(usuario);
    console.log('Datos del usuario cargados:', usuario);

    if (usuario && usuario.cartas) {
        const contenedorCartas = document.getElementById('contenedor-cartas');
        contenedorCartas.innerHTML = ''; // Limpiar el contenedor antes de agregar nuevas cartas

        const grupos = construirGruposMejoraClasica(usuario);
        grupos.filter(grupoVisibleEnVistaClasica).forEach(grupo => {
            const carta = grupo.keeperCarta;
            const wrap = document.createElement('div');
            wrap.className = 'carta-grupo-duplicados-wrap';
            if (grupoEsClicableCombinar(grupo)) {
                wrap.classList.add('carta-grupo-duplicados-wrap--clicable');
            }

            const cartaDiv = document.createElement('div');
            cartaDiv.classList.add('carta');
            if (typeof window.dcAplicarClasesNivelCartaCompleta === 'function') {
                window.dcAplicarClasesNivelCartaCompleta(cartaDiv, carta);
            } else if (esCartaLegendaria(carta)) {
                cartaDiv.classList.add('nivel-legendaria');
            }
            cartaDiv.dataset.keeperIndex = String(grupo.keeperIndex);

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

            detallesDiv.appendChild(nombreSpan);
            detallesDiv.appendChild(poderSpan);

            const estrellasDiv = document.createElement('div');
            estrellasDiv.classList.add('estrellas-carta');

            if (typeof window.dcRellenarEstrellasCartaCompleta === 'function') {
                window.dcRellenarEstrellasCartaCompleta(estrellasDiv, carta, {});
            } else {
                const nivel = carta.Nivel || 1;
                for (let i = 0; i < nivel; i++) {
                    const estrella = document.createElement('img');
                    estrella.classList.add('estrella');
                    estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
                    estrella.alt = 'star';
                    estrellasDiv.appendChild(estrella);
                }
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
            if (window.DCRedDot && typeof window.DCRedDot.attachCardBadge === 'function') {
                window.DCRedDot.attachCardBadge(cartaDiv, carta.Nombre);
            }

            wrap.appendChild(cartaDiv);

            if (grupo.total > 1) {
                const badgeDup = document.createElement('div');
                badgeDup.className = 'carta-duplicados-badge';
                badgeDup.textContent = String(grupo.total);
                badgeDup.title = `${grupo.total} copias en colección`;
                wrap.appendChild(badgeDup);
            }

            if (grupoEsClicableCombinar(grupo)) {
                wrap.addEventListener('click', () => abrirModalCombinarDuplicados(grupo));
            }

            contenedorCartas.appendChild(wrap);
        });
        renderizarSeccionDestruccion(usuario);
        renderizarSeccionMejorasObjetos(usuario);
        renderizarSeccionFragmentos(usuario);
    } else {
        console.error('No se encontraron cartas para el usuario.');
    }
}

function configurarEventos() {
    const botonAuto = document.getElementById('mejorar-duplicados-auto');
    if (botonAuto) {
        botonAuto.onclick = mejorarDuplicadosAutomaticamente;
    }
    const botonDestruirTodo = document.getElementById('destruir-duplicados-todo');
    if (botonDestruirTodo) {
        botonDestruirTodo.onclick = destruirDuplicadosNivel6;
    }

    const modalSeleccionObjeto = document.getElementById('modal-seleccion-objeto-mejora');
    const btnCerrarSeleccionObjeto = document.getElementById('btn-cerrar-seleccion-objeto');
    if (btnCerrarSeleccionObjeto) {
        btnCerrarSeleccionObjeto.onclick = cerrarModalSeleccionObjetoMejora;
    }
    if (modalSeleccionObjeto) {
        modalSeleccionObjeto.addEventListener('click', (event) => {
            if (event.target === modalSeleccionObjeto) {
                cerrarModalSeleccionObjetoMejora();
            }
        });
    }

    const btnCerrarResultado = document.getElementById('btn-cerrar-resultado-objeto');
    if (btnCerrarResultado) {
        btnCerrarResultado.onclick = cerrarModalResultadoObjeto;
    }
    const btnCerrarResultadoAuto = document.getElementById('btn-cerrar-resultado-auto');
    if (btnCerrarResultadoAuto) {
        btnCerrarResultadoAuto.onclick = cerrarModalResultadoAuto;
    }
    const btnCerrarResultadoDestruccion = document.getElementById('btn-cerrar-resultado-destruccion');
    if (btnCerrarResultadoDestruccion) {
        btnCerrarResultadoDestruccion.onclick = cerrarModalResultadoDestruccion;
    }

    const btnCombinarAceptar = document.getElementById('btn-combinar-duplicados-aceptar');
    const btnCombinarCancelar = document.getElementById('btn-combinar-duplicados-cancelar');
    const modalCombinar = document.getElementById('modal-combinar-duplicados');
    if (btnCombinarAceptar) {
        btnCombinarAceptar.onclick = () => void confirmarCombinacionDuplicados();
    }
    if (btnCombinarCancelar) {
        btnCombinarCancelar.onclick = cerrarModalCombinarDuplicados;
    }
    if (modalCombinar) {
        modalCombinar.addEventListener('click', (event) => {
            if (event.target === modalCombinar) {
                cerrarModalCombinarDuplicados();
            }
        });
    }

    const btnDestruirDupAceptar = document.getElementById('btn-destruir-duplicado-aceptar');
    const btnDestruirDupCancelar = document.getElementById('btn-destruir-duplicado-cancelar');
    const modalDestruirDup = document.getElementById('modal-destruir-duplicado');
    if (btnDestruirDupAceptar) {
        btnDestruirDupAceptar.onclick = () => void confirmarDestruirDuplicadoIndividual();
    }
    if (btnDestruirDupCancelar) {
        btnDestruirDupCancelar.onclick = cerrarModalDestruirDuplicado;
    }
    if (modalDestruirDup) {
        modalDestruirDup.addEventListener('click', (event) => {
            if (event.target === modalDestruirDup) {
                cerrarModalDestruirDuplicado();
            }
        });
    }

    const tabClasica = document.getElementById('tab-mejora-clasica');
    const tabDestruir = document.getElementById('tab-destruir-repetidas');
    const tabObjetos = document.getElementById('tab-mejoras-objetos');
    const tabFragmentos = document.getElementById('tab-fragmentos');
    if (tabClasica) {
        tabClasica.onclick = () => cambiarPestanaMejoras('clasica');
    }
    if (tabDestruir) {
        tabDestruir.onclick = () => cambiarPestanaMejoras('destruir');
    }
    if (tabObjetos) {
        tabObjetos.onclick = () => cambiarPestanaMejoras('objetos');
    }
    if (tabFragmentos) {
        tabFragmentos.onclick = () => cambiarPestanaMejoras('fragmentos');
    }

    const modalSeleccionFragmentos = document.getElementById('modal-seleccion-fragmentos-mejora');
    const btnCerrarSeleccionFragmentos = document.getElementById('btn-cerrar-seleccion-fragmentos');
    if (btnCerrarSeleccionFragmentos) {
        btnCerrarSeleccionFragmentos.onclick = cerrarModalSeleccionFragmentos;
    }
    if (modalSeleccionFragmentos) {
        modalSeleccionFragmentos.addEventListener('click', (event) => {
            if (event.target === modalSeleccionFragmentos) {
                cerrarModalSeleccionFragmentos();
            }
        });
    }

    const modalAnimFragmento = document.getElementById('modal-animacion-fragmento');
    const btnCerrarAnimFragmento = document.getElementById('btn-cerrar-animacion-fragmento');
    if (btnCerrarAnimFragmento) {
        btnCerrarAnimFragmento.onclick = cerrarModalAnimacionFragmento;
    }
    if (modalAnimFragmento) {
        modalAnimFragmento.addEventListener('click', (event) => {
            if (event.target === modalAnimFragmento) {
                cerrarModalAnimacionFragmento();
            }
        });
    }

    configurarFiltrosMejorasObjetos();
    configurarFiltrosFragmentos();
}

function cerrarModalResultadoAuto() {
    const modal = document.getElementById('modal-resultado-auto');
    if (modal) {
        modal.style.display = 'none';
    }
}

function mostrarResultadoMejoraAutomatica(analisis) {
    const modal = document.getElementById('modal-resultado-auto');
    const resumen = document.getElementById('resultado-auto-resumen');
    const mejoradas = document.getElementById('resultado-auto-mejoradas');
    if (!modal || !resumen || !mejoradas) {
        return;
    }

    resumen.textContent = `Cartas combinadas/mejoradas: ${analisis.mejoras.length}`;
    mejoradas.innerHTML = '';

    if (analisis.mejoras.length === 0) {
        const vacio = document.createElement('div');
        vacio.className = 'alert alert-secondary';
        vacio.textContent = 'No hubo mejoras de nivel.';
        mejoradas.appendChild(vacio);
    } else {
        analisis.mejoras.forEach(item => {
            const bloque = document.createElement('div');
            bloque.className = 'd-flex align-items-start';
            bloque.style.gap = '10px';
            bloque.style.padding = '8px';
            bloque.style.border = '1px solid rgba(0,209,255,0.25)';
            bloque.style.borderRadius = '10px';

            const antes = document.createElement('div');
            const tituloAntes = document.createElement('div');
            tituloAntes.textContent = 'Antes';
            tituloAntes.className = 'text-center';
            tituloAntes.style.marginBottom = '4px';
            antes.appendChild(tituloAntes);
            antes.appendChild(crearElementoCartaSoloVisual(item.cartaAntes));

            const despues = document.createElement('div');
            const tituloDespues = document.createElement('div');
            tituloDespues.textContent = 'Después';
            tituloDespues.className = 'text-center';
            tituloDespues.style.marginBottom = '4px';
            despues.appendChild(tituloDespues);
            despues.appendChild(crearElementoCartaSoloVisual(item.cartaDespues, true));

            const meta = document.createElement('div');
            meta.style.minWidth = '180px';
            meta.innerHTML = `
                <div><strong>${item.nombre}</strong></div>
                <div>Nivel: ${item.nivelInicial} → ${item.nivelFinal}</div>
                <div>Duplicados consumidos: ${item.cartasConsumidas}</div>
            `;

            bloque.appendChild(antes);
            bloque.appendChild(despues);
            bloque.appendChild(meta);
            mejoradas.appendChild(bloque);
        });
    }

    modal.style.display = 'flex';
}

function cambiarPestanaMejoras(pestana) {
    const tabClasica = document.getElementById('tab-mejora-clasica');
    const tabDestruir = document.getElementById('tab-destruir-repetidas');
    const tabObjetos = document.getElementById('tab-mejoras-objetos');
    const tabFragmentos = document.getElementById('tab-fragmentos');
    const seccionClasica = document.getElementById('seccion-mejora-clasica');
    const seccionDestruir = document.getElementById('seccion-destruir-repetidas');
    const seccionObjetos = document.getElementById('seccion-mejoras-objetos');
    const seccionFragmentos = document.getElementById('seccion-fragmentos');

    const mostrarClasica = pestana === 'clasica';
    const mostrarDestruir = pestana === 'destruir';
    const mostrarObjetos = pestana === 'objetos';
    const mostrarFragmentos = pestana === 'fragmentos';

    if (tabClasica) {
        tabClasica.classList.toggle('active', mostrarClasica);
    }
    if (tabDestruir) {
        tabDestruir.classList.toggle('active', mostrarDestruir);
    }
    if (tabObjetos) {
        tabObjetos.classList.toggle('active', mostrarObjetos);
    }
    if (tabFragmentos) {
        tabFragmentos.classList.toggle('active', mostrarFragmentos);
    }
    if (seccionClasica) {
        seccionClasica.style.display = mostrarClasica ? 'block' : 'none';
    }
    if (seccionDestruir) {
        seccionDestruir.style.display = mostrarDestruir ? 'block' : 'none';
    }
    if (seccionObjetos) {
        seccionObjetos.style.display = mostrarObjetos ? 'block' : 'none';
    }
    if (seccionFragmentos) {
        seccionFragmentos.style.display = mostrarFragmentos ? 'block' : 'none';
    }

    if (mostrarObjetos) {
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        if (usuario) {
            renderizarSeccionMejorasObjetos(usuario);
        }
    }
    if (mostrarFragmentos) {
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        if (usuario) {
            renderizarSeccionFragmentos(usuario);
        }
    }
}

function cerrarModalResultadoObjeto() {
    const modal = document.getElementById('modal-resultado-objeto');
    if (modal) {
        modal.style.display = 'none';
    }
}

function crearCartaMejoradaPorObjeto(cartaOriginal, tipo) {
    const original = { ...cartaOriginal };
    const mejorada = { ...cartaOriginal };
    const saludBase = Number((mejorada.SaludMax ?? mejorada.Salud ?? mejorada.Poder) || 0);
    const nivelInicial = Number(mejorada.Nivel || 1);
    let nivelFinal = nivelInicial;

    if (tipo === 'mejoraCarta') {
        nivelFinal = Math.min(nivelInicial + 1, 4);
    } else if (tipo === 'mejoraEspecial') {
        nivelFinal = 6;
    } else if (tipo === 'mejoraSuprema') {
        nivelFinal = 5;
    } else if (tipo === 'mejoraDefinitiva') {
        nivelFinal = 6;
    }

    const incrementoNiveles = Math.max(nivelFinal - nivelInicial, 0);
    mejorada.Nivel = nivelFinal;
    mejorada.Poder = Number(mejorada.Poder || 0) + (incrementoNiveles * 500);
    mejorada.SaludMax = saludBase + (incrementoNiveles * 500);
    mejorada.Salud = mejorada.SaludMax;

    if (typeof window.recalcularSkillPowerPorNivel === 'function') {
        window.recalcularSkillPowerPorNivel(mejorada, Number(mejorada.Nivel || 1));
    }

    return { original, mejorada };
}

function mostrarResultadoMejoraObjeto(cartaOriginal, cartaMejorada) {
    const contenedorOriginal = document.getElementById('resultado-carta-original');
    const contenedorMejorada = document.getElementById('resultado-carta-mejorada');
    const modal = document.getElementById('modal-resultado-objeto');

    if (!contenedorOriginal || !contenedorMejorada || !modal) {
        return;
    }

    contenedorOriginal.innerHTML = '';
    contenedorMejorada.innerHTML = '';

    contenedorOriginal.appendChild(crearElementoCartaSoloVisual(cartaOriginal));
    contenedorMejorada.appendChild(crearElementoCartaSoloVisual(cartaMejorada, true));
    modal.style.display = 'flex';
}

async function aplicarMejoraObjetoDesdeModal(tipo, indiceCarta) {
    const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
    const email = localStorage.getItem('email');
    normalizarObjetosUsuario(usuario);

    if (!usuario || !email) {
        mostrarMensaje('No se pudo validar la sesión del usuario.', 'danger');
        return;
    }

    const carta = usuario.cartas?.[indiceCarta];
    if (!carta) {
        mostrarMensaje('La carta seleccionada ya no está disponible.', 'danger');
        cerrarModalSeleccionObjetoMejora();
        return;
    }

    const nivel = Number(carta.Nivel || 1);
    const stock = Number(usuario.objetos?.[tipo] || 0);
    if (!puedeUsarObjetoEnCarta(tipo, nivel, stock)) {
        mostrarMensaje('No puedes usar este objeto en esta carta o no tienes stock.', 'warning');
        return;
    }

    const { original, mejorada } = crearCartaMejoradaPorObjeto(carta, tipo);
    if (Number(mejorada.Nivel || 1) === Number(original.Nivel || 1)) {
        mostrarMensaje('La carta ya está en el nivel objetivo para este objeto.', 'warning');
        return;
    }

    const faccionMejorada = normalizarFaccion(mejorada?.faccion || mejorada?.Faccion || '');
    const subeANivel6 = Number(original?.Nivel || 1) < 6 && Number(mejorada?.Nivel || 1) === 6;
    usuario.cartas[indiceCarta] = mejorada;
    usuario.objetos[tipo] = stock - 1;
    sincronizarMazosConColeccion(usuario);

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        if (window.DCMisiones?.track) {
            if (faccionMejorada === 'H') window.DCMisiones.track('mejorar_cartas_h', { amount: 1 });
            if (faccionMejorada === 'V') window.DCMisiones.track('mejorar_cartas_v', { amount: 1 });
            if (subeANivel6) window.DCMisiones.track('mejorar_nivel', { amount: 1 });
        }
        refrescarPanelPerfilLateral();
        cerrarModalSeleccionObjetoMejora();
        cargarCartas();
        mostrarResultadoMejoraObjeto(original, mejorada);
        mostrarMensaje('Mejora con objeto aplicada correctamente.', 'success');
    } catch (error) {
        console.error('Error al aplicar mejora con objeto:', error);
        mostrarMensaje('Error al aplicar mejora con objeto en Firebase.', 'danger');
    }
}

async function mejorarDuplicadosAutomaticamente() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');

    if (!usuario || !Array.isArray(usuario.cartas) || usuario.cartas.length === 0) {
        mostrarMensaje('No hay cartas disponibles para procesar.', 'warning');
        return;
    }

    if (!email) {
        mostrarMensaje('No se ha encontrado un email de usuario válido.', 'danger');
        return;
    }

    const analisis = analizarMejoraAutomatica(usuario.cartas);

    if (analisis.mejoras.length === 0) {
        mostrarMensaje('No hay duplicados combinables para mejorar automáticamente.', 'warning');
        return;
    }

    usuario.cartas = analisis.cartasActualizadas;
    sincronizarMazosConColeccion(usuario);
    let mejorasH = 0;
    let mejorasV = 0;
    let mejorasLleganNivel6 = 0;
    analisis.mejoras.forEach((m) => {
        const fac = normalizarFaccion(m?.cartaDespues?.faccion || m?.cartaDespues?.Faccion || '');
        if (fac === 'H') mejorasH++;
        if (fac === 'V') mejorasV++;
        const nA = Number(m?.cartaAntes?.Nivel || 1);
        const nD = Number(m?.cartaDespues?.Nivel || 1);
        if (nA < 6 && nD === 6) mejorasLleganNivel6++;
    });

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        if (window.DCMisiones?.track) {
            if (mejorasH > 0) window.DCMisiones.track('mejorar_cartas_h', { amount: mejorasH });
            if (mejorasV > 0) window.DCMisiones.track('mejorar_cartas_v', { amount: mejorasV });
            if (mejorasLleganNivel6 > 0) window.DCMisiones.track('mejorar_nivel', { amount: mejorasLleganNivel6 });
        }
        refrescarPanelPerfilLateral();
        cargarCartas();
        mostrarResultadoMejoraAutomatica(analisis);

        const resumenMejoras = analisis.mejoras.length > 0
            ? `${analisis.mejoras.length} cartas mejoradas`
            : 'sin mejoras de nivel';

        mostrarMensaje(`Combinación automática completada: ${resumenMejoras}.`, 'success');
    } catch (error) {
        console.error('Error al aplicar la mejora automática:', error);
        mostrarMensaje('Error al aplicar la mejora automática en Firebase.', 'danger');
    }
}

function esCopiaDestruibleEnColeccion(usuario, indexCarta) {
    const grupos = construirGruposDestruccion(usuario);
    return grupos.some((grupo) =>
        grupo.copiasDestruibles.some((item) => item.index === indexCarta)
    );
}

function cerrarModalDestruirDuplicado() {
    const modal = document.getElementById('modal-destruir-duplicado');
    if (modal) {
        modal.style.display = 'none';
    }
    destruccionDuplicadoPendiente = null;
}

function abrirModalDestruirDuplicado(item, grupo) {
    if (!item || !grupo) {
        return;
    }
    const puntos = Number(item.puntos || obtenerValorDestruccion(item?.carta?.Nivel || 1));
    destruccionDuplicadoPendiente = {
        index: item.index,
        carta: item.carta,
        puntos,
        nombre: String(grupo.nombre || item?.carta?.Nombre || '').trim()
    };

    const modal = document.getElementById('modal-destruir-duplicado');
    const texto = document.getElementById('destruir-duplicado-texto');
    const preview = document.getElementById('destruir-duplicado-preview');
    if (!modal || !texto || !preview) {
        return;
    }

    texto.innerHTML = `¿Quieres destruir esta carta duplicada a cambio de <strong>${puntos}</strong> <img src="/resources/icons/moneda.png" alt="Moneda" style="width:20px;height:20px;vertical-align:middle;object-fit:contain;">?`;
    preview.innerHTML = '';
    preview.appendChild(crearElementoCartaSoloVisual(item.carta, false, 200));
    modal.style.display = 'flex';
}

async function confirmarDestruirDuplicadoIndividual() {
    if (!destruccionDuplicadoPendiente) {
        return;
    }
    const pendiente = { ...destruccionDuplicadoPendiente };
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');
    if (!usuario || !Array.isArray(usuario.cartas) || !email) {
        mostrarMensaje('No se pudo validar la sesión para destruir cartas.', 'danger');
        cerrarModalDestruirDuplicado();
        return;
    }
    normalizarObjetosUsuario(usuario);

    if (!esCopiaDestruibleEnColeccion(usuario, pendiente.index)) {
        mostrarMensaje('Esta copia ya no está disponible para destruir.', 'warning');
        cerrarModalDestruirDuplicado();
        cargarCartas();
        return;
    }

    const carta = usuario.cartas[pendiente.index];
    if (!carta) {
        mostrarMensaje('No se encontró la carta seleccionada.', 'warning');
        cerrarModalDestruirDuplicado();
        cargarCartas();
        return;
    }

    const nivel = Number(carta.Nivel || 1);
    const puntos = obtenerValorDestruccion(nivel);
    const nombre = String(carta.Nombre || pendiente.nombre || '').trim();

    usuario.cartas = usuario.cartas.filter((_, idx) => idx !== pendiente.index);
    usuario.puntos = Number(usuario.puntos || 0) + puntos;
    sincronizarMazosConColeccion(usuario);

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        refrescarPanelPerfilLateral();
        cerrarModalDestruirDuplicado();
        cargarCartas();
        mostrarMensaje(`Se destruyó ${nombre} (Nivel ${nivel}) y ganaste ${puntos} puntos.`, 'success');
    } catch (error) {
        console.error('Error al destruir carta duplicada:', error);
        mostrarMensaje('Error al destruir la carta en Firebase.', 'danger');
    }
}

function renderizarSeccionDestruccion(usuario) {
    const contenedor = document.getElementById('contenedor-cartas-destruccion');
    const boton = document.getElementById('destruir-duplicados-todo');
    if (!contenedor) return;

    const grupos = construirGruposDestruccion(usuario);
    contenedor.innerHTML = '';
    let puntosTotales = 0;
    let totalCartasDestruibles = 0;
    grupos.forEach((grupo) => {
        grupo.copiasDestruibles.forEach((item) => {
            const puntos = Number(item.puntos || 0);
            puntosTotales += puntos;
            totalCartasDestruibles += 1;
            const wrap = document.createElement('div');
            wrap.className = 'carta-grupo-duplicados-wrap carta-grupo-duplicados-wrap--clicable';
            wrap.title = 'Clic para destruir esta copia';
            wrap.addEventListener('click', () => abrirModalDestruirDuplicado(item, grupo));

            const cartaDiv = crearElementoCartaSoloVisual(item.carta);
            wrap.appendChild(cartaDiv);

            const puntosTag = document.createElement('div');
            puntosTag.className = 'carta-destruccion-puntos';
            puntosTag.innerHTML = `+${puntos} <img src="/resources/icons/moneda.png" alt="Moneda">`;
            puntosTag.title = `${grupo.nombre}: copia a destruir (se conserva la de mayor nivel)`;
            wrap.appendChild(puntosTag);

            contenedor.appendChild(wrap);
        });
    });

    if (boton) {
        boton.disabled = totalCartasDestruibles === 0;
        boton.textContent = totalCartasDestruibles === 0
            ? 'No hay cartas para destruir'
            : `Destruir Todas las cartas (+${puntosTotales})`;
    }

    if (totalCartasDestruibles === 0) {
        const vacio = document.createElement('div');
        vacio.className = 'alert alert-info';
        vacio.textContent = 'No hay cartas repetidas para destruir en personajes con copia a 5★ o 6★.';
        contenedor.appendChild(vacio);
    }
}

function cerrarModalResultadoDestruccion() {
    const modal = document.getElementById('modal-resultado-destruccion');
    if (modal) {
        modal.style.display = 'none';
    }
}

function mostrarResultadoDestruccion(analisis) {
    const modal = document.getElementById('modal-resultado-destruccion');
    const resumen = document.getElementById('resultado-destruccion-resumen');
    const lista = document.getElementById('resultado-destruccion-lista');
    if (!modal || !resumen || !lista) return;

    resumen.innerHTML = `Cartas destruidas: <strong>${analisis.destruidas.length}</strong> · Total obtenido: <strong>${analisis.puntosGanados}</strong> <img src="/resources/icons/moneda.png" alt="Moneda" style="width:18px; height:18px; object-fit:contain;">`;
    lista.innerHTML = '';
    analisis.destruidas.forEach((item) => {
        const tag = document.createElement('div');
        tag.className = 'alert alert-warning';
        tag.style.margin = '0';
        tag.style.padding = '6px 10px';
        tag.textContent = `${item.nombre} (Nivel ${item.nivel}) +${item.puntos} pts`;
        lista.appendChild(tag);
    });
    modal.style.display = 'flex';
}

async function destruirDuplicadosNivel6() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');
    if (!usuario || !Array.isArray(usuario.cartas) || !email) {
        mostrarMensaje('No se pudo validar la sesión para destruir cartas.', 'danger');
        return;
    }

    const analisis = analizarDestruccionDuplicados(usuario.cartas);
    if (analisis.destruidas.length === 0) {
        mostrarMensaje('No hay cartas repetidas para destruir.', 'warning');
        return;
    }

    usuario.cartas = analisis.cartasActualizadas;
    usuario.puntos = Number(usuario.puntos || 0) + analisis.puntosGanados;
    sincronizarMazosConColeccion(usuario);

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        refrescarPanelPerfilLateral();
        cargarCartas();
        mostrarResultadoDestruccion(analisis);
        mostrarMensaje(`Se destruyeron ${analisis.destruidas.length} cartas y ganaste ${analisis.puntosGanados} puntos.`, 'success');
    } catch (error) {
        console.error('Error al destruir cartas repetidas:', error);
        mostrarMensaje('Error al destruir cartas repetidas en Firebase.', 'danger');
    }
}

async function actualizarUsuarioFirebase(usuario, email) {
    console.log('Actualizando usuario en Firebase...', { usuario, email });

    try {
        const response = await fetch('/update-user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ usuario, email }) // Incluye el email en la solicitud
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 409 && data?.usuario) {
                localStorage.setItem('usuario', JSON.stringify(data.usuario));
                window.dispatchEvent(new Event('dc:usuario-actualizado'));
            }
            throw new Error(data?.mensaje || 'Error en la solicitud de actualización.');
        }
        if (data?.usuario && usuario && typeof usuario === 'object') {
            Object.keys(usuario).forEach((k) => delete usuario[k]);
            Object.assign(usuario, data.usuario);
        }
        console.log('Respuesta de actualización de Firebase:', data);
        return data;
    } catch (error) {
        console.error('Error al actualizar el usuario en Firebase:', error);
        throw error;
    }
}

function resetFormulario() {
    console.log('Reiniciando formulario y recargando cartas...');
    cargarCartas(); // Recargar cartas
}

function mostrarMensaje(mensaje, tipo = 'warning') {
    const mensajeDiv = document.getElementById('mensaje');
    mensajeDiv.textContent = mensaje;
    mensajeDiv.className = `alert alert-${tipo}`;
    mensajeDiv.style.display = 'block';
    console.log(`Mostrando mensaje: ${mensaje} (${tipo})`);
    setTimeout(() => mensajeDiv.style.display = 'none', 3000);
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
