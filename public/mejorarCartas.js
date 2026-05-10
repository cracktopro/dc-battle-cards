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

let mejoraObjetoPendiente = null;
let combinacionDuplicadosGrupo = null;
const seleccionIndicesCombinacion = new Set();
const ICONO_MEJORA = '/resources/icons/mejora.png';
const ICONO_MEJORA_ESPECIAL = '/resources/icons/mejora_especial.png';

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
    if (grupo.total === 1 && n === 5) {
        return false;
    }
    return true;
}

function construirGruposDestruccion(usuario) {
    return construirGruposMejoraClasica(usuario)
        .filter((grupo) => Number(grupo?.keeperCarta?.Nivel || 1) >= 6 && Number(grupo?.total || 0) > 1)
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
    const fusionNivel5 = Number(resultado?.cartaAntes?.Nivel || 1) < 5 && Number(resultado?.cartaMejorada?.Nivel || 1) >= 5;

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        if (window.DCMisiones?.track) {
            if (facFusion === 'H') window.DCMisiones.track('mejorar_cartas_h', { amount: 1 });
            if (facFusion === 'V') window.DCMisiones.track('mejorar_cartas_v', { amount: 1 });
            if (fusionNivel5) window.DCMisiones.track('mejorar_nivel', { amount: 1 });
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
        : { mejoraCarta: 0, mejoraEspecial: 0 };

    objetosBase.mejoraCarta = Number(usuario.objetos?.mejoraCarta ?? objetosBase.mejoraCarta ?? 0);
    objetosBase.mejoraEspecial = Number(usuario.objetos?.mejoraEspecial ?? objetosBase.mejoraEspecial ?? 0);

    if (Array.isArray(usuario.inventarioObjetos)) {
        const legacyMejoraCarta = usuario.inventarioObjetos.find(item => item.id === 'obj-mejora-carta');
        const legacyMejoraEspecial = usuario.inventarioObjetos.find(item => item.id === 'obj-mejora-especial');

        objetosBase.mejoraCarta = Math.max(objetosBase.mejoraCarta, Number(legacyMejoraCarta?.cantidad || 0));
        objetosBase.mejoraEspecial = Math.max(objetosBase.mejoraEspecial, Number(legacyMejoraEspecial?.cantidad || 0));
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
    if (esCartaLegendaria(carta)) {
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
    return cartaDiv;
}

function actualizarContadoresObjetos(usuario) {
    normalizarObjetosUsuario(usuario);
    const contadorMejora = document.getElementById('contador-mejora-carta');
    const contadorEspecial = document.getElementById('contador-mejora-especial');

    if (contadorMejora) {
        contadorMejora.innerHTML = `<img src="${ICONO_MEJORA}" alt="Mejora" style="width:40px; height:40px; object-fit:contain; margin-right:6px;">Mejoras disponibles: ${Number(usuario.objetos.mejoraCarta || 0)}`;
    }

    if (contadorEspecial) {
        contadorEspecial.innerHTML = `<img src="${ICONO_MEJORA_ESPECIAL}" alt="Mejora especial" style="width:40px; height:40px; object-fit:contain; margin-right:6px;">Mejoras especiales: ${Number(usuario.objetos.mejoraEspecial || 0)}`;
    }
}

function obtenerCartasValidasMejoraObjeto(usuario, tipo) {
    const cartas = Array.isArray(usuario?.cartas) ? usuario.cartas : [];
    const candidatos = cartas
        .map((carta, index) => ({ ...carta, originalIndex: index }))
        .filter(carta => {
            const nivel = Number(carta.Nivel || 1);
            if (tipo === 'mejoraCarta') {
                return nivel >= 1 && nivel <= 3;
            }
            return nivel === 5;
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

    return Array.from(mejorPorNombre.values()).sort((a, b) => {
        const diffNivel = (a.Nivel || 1) - (b.Nivel || 1);
        if (diffNivel !== 0) {
            return diffNivel;
        }
        return String(a.Nombre || '').localeCompare(String(b.Nombre || ''));
    });
}

function renderizarBloqueMejoraObjetos(usuario, tipo, contenedorId) {
    const contenedor = document.getElementById(contenedorId);
    if (!contenedor) {
        return;
    }

    contenedor.innerHTML = '';
    const cartas = obtenerCartasValidasMejoraObjeto(usuario, tipo);
    const cantidadObjetos = Number(usuario.objetos?.[tipo] || 0);

    if (cartas.length === 0) {
        const vacio = document.createElement('div');
        vacio.className = 'alert alert-info';
        vacio.textContent = 'No hay cartas válidas para este tipo de mejora.';
        contenedor.appendChild(vacio);
        return;
    }

    cartas.forEach(carta => {
        const wrapper = document.createElement('div');
        wrapper.className = 'mejora-objeto-fila';

        const cartaVisual = crearElementoCartaSoloVisual(carta, false, 0);
        const boton = document.createElement('button');
        boton.className = 'btn btn-mejora-objeto';
        boton.textContent = 'Mejorar';
        boton.disabled = cantidadObjetos <= 0;
        boton.addEventListener('click', () => abrirModalConfirmacionMejora(tipo, carta.originalIndex));

        wrapper.appendChild(cartaVisual);
        wrapper.appendChild(boton);
        contenedor.appendChild(wrapper);
    });
}

function renderizarSeccionMejorasObjetos(usuario) {
    actualizarContadoresObjetos(usuario);
    renderizarBloqueMejoraObjetos(usuario, 'mejoraCarta', 'contenedor-mejora-carta-objeto');
    renderizarBloqueMejoraObjetos(usuario, 'mejoraEspecial', 'contenedor-mejora-especial-objeto');
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
            if (esCartaLegendaria(carta)) {
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

    const btnConfirmarObjeto = document.getElementById('btn-confirmar-objeto');
    if (btnConfirmarObjeto) {
        btnConfirmarObjeto.onclick = confirmarMejoraConObjeto;
    }

    const btnCancelarObjeto = document.getElementById('btn-cancelar-objeto');
    if (btnCancelarObjeto) {
        btnCancelarObjeto.onclick = cerrarModalConfirmacionObjeto;
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

    const tabClasica = document.getElementById('tab-mejora-clasica');
    const tabDestruir = document.getElementById('tab-destruir-repetidas');
    const tabObjetos = document.getElementById('tab-mejoras-objetos');
    if (tabClasica && tabObjetos && tabDestruir) {
        tabClasica.onclick = () => cambiarPestanaMejoras('clasica');
        tabDestruir.onclick = () => cambiarPestanaMejoras('destruir');
        tabObjetos.onclick = () => cambiarPestanaMejoras('objetos');
    }

    const subtabMejoraCarta = document.getElementById('subtab-mejora-carta');
    const subtabMejoraEspecial = document.getElementById('subtab-mejora-especial');
    if (subtabMejoraCarta && subtabMejoraEspecial) {
        subtabMejoraCarta.onclick = () => cambiarSubpestanaObjetos('mejoraCarta');
        subtabMejoraEspecial.onclick = () => cambiarSubpestanaObjetos('mejoraEspecial');
    }
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
    const seccionClasica = document.getElementById('seccion-mejora-clasica');
    const seccionDestruir = document.getElementById('seccion-destruir-repetidas');
    const seccionObjetos = document.getElementById('seccion-mejoras-objetos');

    const mostrarObjetos = pestana === 'objetos';
    const mostrarDestruir = pestana === 'destruir';
    if (tabClasica) {
        tabClasica.classList.toggle('active', !mostrarObjetos && !mostrarDestruir);
    }
    if (tabDestruir) {
        tabDestruir.classList.toggle('active', mostrarDestruir);
    }
    if (tabObjetos) {
        tabObjetos.classList.toggle('active', mostrarObjetos);
    }
    if (seccionClasica) {
        seccionClasica.style.display = (!mostrarObjetos && !mostrarDestruir) ? 'block' : 'none';
    }
    if (seccionDestruir) {
        seccionDestruir.style.display = mostrarDestruir ? 'block' : 'none';
    }
    if (seccionObjetos) {
        seccionObjetos.style.display = mostrarObjetos ? 'block' : 'none';
    }
    if (mostrarObjetos) {
        cambiarSubpestanaObjetos('mejoraCarta');
    }
}

function cambiarSubpestanaObjetos(tipo) {
    const subtabMejoraCarta = document.getElementById('subtab-mejora-carta');
    const subtabMejoraEspecial = document.getElementById('subtab-mejora-especial');
    const panelCarta = document.getElementById('panel-subtab-mejora-carta');
    const panelEspecial = document.getElementById('panel-subtab-mejora-especial');
    const esMejoraCarta = tipo === 'mejoraCarta';

    if (subtabMejoraCarta) {
        subtabMejoraCarta.classList.toggle('active', esMejoraCarta);
    }
    if (subtabMejoraEspecial) {
        subtabMejoraEspecial.classList.toggle('active', !esMejoraCarta);
    }
    if (panelCarta) {
        panelCarta.style.display = esMejoraCarta ? 'block' : 'none';
    }
    if (panelEspecial) {
        panelEspecial.style.display = esMejoraCarta ? 'none' : 'block';
    }
}

function abrirModalConfirmacionMejora(tipo, indiceCarta) {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    normalizarObjetosUsuario(usuario);
    const carta = usuario?.cartas?.[indiceCarta];

    if (!carta) {
        mostrarMensaje('No se encontró la carta seleccionada.', 'danger');
        return;
    }

    if (tipo === 'mejoraCarta') {
        const nivel = Number(carta.Nivel || 1);
        if (nivel < 1 || nivel > 3) {
            mostrarMensaje('La mejora de carta solo aplica a niveles 1 a 3.', 'warning');
            return;
        }
        if (Number(usuario.objetos.mejoraCarta || 0) <= 0) {
            mostrarMensaje('No tienes mejoras de carta disponibles.', 'warning');
            return;
        }
    } else {
        if (Number(carta.Nivel || 1) !== 5) {
            mostrarMensaje('La mejora especial solo aplica a cartas de nivel 5.', 'warning');
            return;
        }
        if (Number(usuario.objetos.mejoraEspecial || 0) <= 0) {
            mostrarMensaje('No tienes mejoras especiales disponibles.', 'warning');
            return;
        }
    }

    mejoraObjetoPendiente = { tipo, indiceCarta };
    const modal = document.getElementById('modal-confirmacion-objeto');
    const texto = document.getElementById('texto-confirmacion-objeto');
    const etiquetaObjeto = tipo === 'mejoraCarta' ? 'mejora de carta' : 'mejora especial';
    texto.textContent = `¿Quieres mejorar esta carta usando ${etiquetaObjeto}?`;
    modal.style.display = 'flex';
}

function cerrarModalConfirmacionObjeto() {
    const modal = document.getElementById('modal-confirmacion-objeto');
    if (modal) {
        modal.style.display = 'none';
    }
    mejoraObjetoPendiente = null;
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

    if (tipo === 'mejoraCarta') {
        const nivelInicial = Number(mejorada.Nivel || 1);
        const nivelFinal = Math.min(nivelInicial + 1, 4);
        const incrementoNiveles = Math.max(nivelFinal - nivelInicial, 0);
        mejorada.Nivel = nivelFinal;
        mejorada.Poder = Number(mejorada.Poder || 0) + (incrementoNiveles * 500);
        mejorada.SaludMax = saludBase + (incrementoNiveles * 500);
        mejorada.Salud = mejorada.SaludMax;
    } else {
        const nivelInicial = Number(mejorada.Nivel || 1);
        const incrementoNiveles = Math.max(6 - nivelInicial, 0);
        mejorada.Nivel = 6;
        mejorada.Poder = Number(mejorada.Poder || 0) + (incrementoNiveles * 500);
        mejorada.SaludMax = saludBase + (incrementoNiveles * 500);
        mejorada.Salud = mejorada.SaludMax;
    }
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

async function confirmarMejoraConObjeto() {
    if (!mejoraObjetoPendiente) {
        return;
    }

    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');
    normalizarObjetosUsuario(usuario);

    if (!usuario || !email) {
        mostrarMensaje('No se pudo validar la sesión del usuario.', 'danger');
        cerrarModalConfirmacionObjeto();
        return;
    }

    const { tipo, indiceCarta } = mejoraObjetoPendiente;
    const carta = usuario.cartas[indiceCarta];
    if (!carta) {
        mostrarMensaje('La carta seleccionada ya no está disponible.', 'danger');
        cerrarModalConfirmacionObjeto();
        return;
    }

    const stock = Number(usuario.objetos?.[tipo] || 0);
    if (stock <= 0) {
        mostrarMensaje('No tienes objetos suficientes para esta mejora.', 'warning');
        cerrarModalConfirmacionObjeto();
        return;
    }

    const { original, mejorada } = crearCartaMejoradaPorObjeto(carta, tipo);
    const faccionMejorada = normalizarFaccion(mejorada?.faccion || mejorada?.Faccion || '');
    const subeANivel5 = Number(original?.Nivel || 1) < 5 && Number(mejorada?.Nivel || 1) >= 5;
    usuario.cartas[indiceCarta] = mejorada;
    usuario.objetos[tipo] = stock - 1;
    sincronizarMazosConColeccion(usuario);

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        if (window.DCMisiones?.track) {
            if (faccionMejorada === 'H') window.DCMisiones.track('mejorar_cartas_h', { amount: 1 });
            if (faccionMejorada === 'V') window.DCMisiones.track('mejorar_cartas_v', { amount: 1 });
            if (subeANivel5) window.DCMisiones.track('mejorar_nivel', { amount: 1 });
        }
        refrescarPanelPerfilLateral();
        cerrarModalConfirmacionObjeto();
        cargarCartas();
        mostrarResultadoMejoraObjeto(original, mejorada);
        mostrarMensaje('Mejora con objeto aplicada correctamente.', 'success');
    } catch (error) {
        console.error('Error al aplicar mejora con objeto:', error);
        mostrarMensaje('Error al aplicar mejora con objeto en Firebase.', 'danger');
        cerrarModalConfirmacionObjeto();
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
    let mejorasNivel5 = 0;
    analisis.mejoras.forEach((m) => {
        const fac = normalizarFaccion(m?.cartaDespues?.faccion || m?.cartaDespues?.Faccion || '');
        if (fac === 'H') mejorasH++;
        if (fac === 'V') mejorasV++;
        const nA = Number(m?.cartaAntes?.Nivel || 1);
        const nD = Number(m?.cartaDespues?.Nivel || 1);
        if (nA < 5 && nD >= 5) mejorasNivel5++;
    });

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        if (window.DCMisiones?.track) {
            if (mejorasH > 0) window.DCMisiones.track('mejorar_cartas_h', { amount: mejorasH });
            if (mejorasV > 0) window.DCMisiones.track('mejorar_cartas_v', { amount: mejorasV });
            if (mejorasNivel5 > 0) window.DCMisiones.track('mejorar_nivel', { amount: mejorasNivel5 });
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

function renderizarSeccionDestruccion(usuario) {
    const contenedor = document.getElementById('contenedor-cartas-destruccion');
    const boton = document.getElementById('destruir-duplicados-todo');
    if (!contenedor) return;

    const grupos = construirGruposDestruccion(usuario);
    contenedor.innerHTML = '';
    let puntosTotales = 0;
    grupos.forEach((grupo) => {
        puntosTotales += Number(grupo.puntosTotalesGrupo || 0);
        const wrap = document.createElement('div');
        wrap.className = 'carta-grupo-duplicados-wrap';

        const cartaDiv = crearElementoCartaSoloVisual(grupo.keeperCarta);
        wrap.appendChild(cartaDiv);

        const badgeDup = document.createElement('div');
        badgeDup.className = 'carta-duplicados-badge';
        badgeDup.textContent = String(grupo.total);
        badgeDup.title = `${grupo.total} copias · ${grupo.puntosTotalesGrupo} puntos potenciales`;
        wrap.appendChild(badgeDup);

        const puntosTag = document.createElement('div');
        puntosTag.className = 'carta-destruccion-puntos';
        puntosTag.innerHTML = `+${grupo.puntosTotalesGrupo} <img src="/resources/icons/moneda.png" alt="Moneda">`;
        wrap.appendChild(puntosTag);

        contenedor.appendChild(wrap);
    });

    if (boton) {
        boton.disabled = grupos.length === 0;
        boton.textContent = grupos.length === 0
            ? 'No hay cartas para destruir'
            : `Destruir Todas las cartas (+${puntosTotales})`;
    }

    if (grupos.length === 0) {
        const vacio = document.createElement('div');
        vacio.className = 'alert alert-info';
        vacio.textContent = 'No hay cartas repetidas para destruir en personajes con nivel 6.';
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

        if (!response.ok) {
            throw new Error('Error en la solicitud de actualización.');
        }

        const data = await response.json();
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
