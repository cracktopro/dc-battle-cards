let mazoJugador = JSON.parse(localStorage.getItem('mazoJugador') || '{"Cartas":[]}').Cartas || [];
let mazoOponente = JSON.parse(localStorage.getItem('mazoOponente') || '{"Cartas":[]}').Cartas || [];
let turnoActual = null;
let atacanteSeleccionado = null;
let cartasQueYaAtacaron = [];
let partidaFinalizada = false;
let cartaJugadorDestacada = null;
let cartaOponenteDestacada = null;
let recompensasProcesadas = false;
let temporizadorAvisoTurno = null;

let cartasJugadorEnJuego = [null, null, null];
let cartasOponenteEnJuego = [null, null, null];
let mapaDatosCartasCatalogo = null;
let desafioActivo = null;
let estadoDesafio = {
    activo: false,
    gruposPendientes: [],
    bossPendiente: null,
    recompensas: null
};
const ICONO_MEJORA = '/resources/icons/mejora.png';
const ICONO_MEJORA_ESPECIAL = '/resources/icons/mejora_especial.png';

function obtenerNombreVisibleJugador() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const email = localStorage.getItem('email') || '';
    const nickname = String(usuario?.nickname || '').trim();
    return nickname || (email ? email.split('@')[0] : 'Jugador');
}

function configurarNombresTablero() {
    const nombreJugadorEl = document.getElementById('nombre-jugador');
    const nombreOponenteEl = document.getElementById('nombre-oponente');
    const nombreJugador = obtenerNombreVisibleJugador();
    const nombreOponente = String(localStorage.getItem('nombreOponente') || '').trim() || 'BOT';

    if (nombreJugadorEl) {
        nombreJugadorEl.textContent = nombreJugador;
    }
    if (nombreOponenteEl) {
        nombreOponenteEl.textContent = nombreOponente;
    }
}

function normalizarAfiliacion(afi) {
    return String(afi || '').trim().toLowerCase();
}

function normalizarFaccion(valor) {
    const faccion = String(valor || '').trim().toUpperCase();
    return faccion === 'H' || faccion === 'V' ? faccion : '';
}

function obtenerClaveCarta(nombreCarta) {
    return String(nombreCarta || '').trim().toLowerCase();
}

function obtenerDesafioActivo() {
    try {
        const desafio = JSON.parse(localStorage.getItem('desafioActivo') || 'null');
        if (!desafio || !Array.isArray(desafio.enemigos)) {
            return null;
        }
        return desafio;
    } catch (error) {
        console.error('No se pudo leer desafioActivo:', error);
        return null;
    }
}

function normalizarNombre(nombre) {
    return String(nombre || '').trim().toLowerCase();
}

function esCartaBoss(carta) {
    return Boolean(carta?.esBoss);
}

function dividirEnGrupos(cartas, tamano = 3) {
    const grupos = [];
    for (let i = 0; i < cartas.length; i += tamano) {
        grupos.push(cartas.slice(i, i + tamano));
    }
    return grupos;
}

async function obtenerMapaDatosCartasCatalogo() {
    if (mapaDatosCartasCatalogo) {
        return mapaDatosCartasCatalogo;
    }

    const response = await fetch('resources/cartas.xlsx');
    if (!response.ok) {
        throw new Error('No se pudo cargar el catálogo de cartas.');
    }

    const data = await response.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const cartasExcel = XLSX.utils.sheet_to_json(sheet);

    mapaDatosCartasCatalogo = new Map();
    cartasExcel.forEach(carta => {
        const nombre = obtenerClaveCarta(carta.Nombre);
        if (!nombre) {
            return;
        }

        mapaDatosCartasCatalogo.set(nombre, {
            faccion: normalizarFaccion(carta.faccion),
            Afiliacion: String(carta.Afiliacion || carta.afiliacion || '').trim(),
            nivelBase: Number(carta.Nivel || carta.nivel || 1),
            saludBase: Number(carta.Salud ?? carta.salud ?? carta.Poder ?? 0)
        });
    });

    return mapaDatosCartasCatalogo;
}

function calcularSaludEscaladaDesdeCatalogo(carta, datosCatalogo) {
    if (!carta || !datosCatalogo) {
        return obtenerSaludMaxCarta(carta);
    }

    const nivelCarta = Math.max(1, Number(carta.Nivel || 1));
    const nivelBaseCatalogo = Math.max(1, Number(datosCatalogo.nivelBase || 1));
    const incrementoNiveles = Math.max(nivelCarta - nivelBaseCatalogo, 0);
    const saludBase = Math.max(0, Number(datosCatalogo.saludBase || 0));
    return saludBase + (incrementoNiveles * 500);
}

async function enriquecerCartasConDatosCatalogo(cartas) {
    if (!Array.isArray(cartas)) {
        return cartas;
    }

    const mapaCatalogo = await obtenerMapaDatosCartasCatalogo();

    return cartas.map(carta => {
        if (!carta) {
            return carta;
        }

        const datosCatalogo = mapaCatalogo.get(obtenerClaveCarta(carta.Nombre));
        if (!datosCatalogo) {
            return carta;
        }

        const faccionActual = normalizarFaccion(carta.faccion);
        const afiliacionActual = String(carta.Afiliacion || carta.afiliacion || '').trim();
        const faccionFinal = faccionActual || datosCatalogo.faccion;
        const afiliacionFinal = afiliacionActual || datosCatalogo.Afiliacion || '';

        const saludEscalada = calcularSaludEscaladaDesdeCatalogo(carta, datosCatalogo);
        const saludActual = Number(carta.Salud ?? carta.salud);
        const saludNormalizada = Number.isFinite(saludActual)
            ? Math.max(0, Math.min(saludActual, saludEscalada))
            : saludEscalada;

        return {
            ...carta,
            faccion: faccionFinal,
            Afiliacion: afiliacionFinal,
            SaludMax: saludEscalada,
            Salud: saludNormalizada
        };
    });
}

async function construirEstadoDesafio(desafio) {
    const mapaCatalogo = await obtenerMapaDatosCartasCatalogo();
    const cartasCatalogo = await obtenerCartasDisponibles();
    const mapaPorNombre = new Map();
    cartasCatalogo.forEach(carta => {
        mapaPorNombre.set(normalizarNombre(carta.Nombre), carta);
    });

    const dificultadDesafio = Math.min(Math.max(Number(desafio.dificultad || 1), 1), 6);
    const enemigosBase = (desafio.enemigos || [])
        .map(nombre => mapaPorNombre.get(normalizarNombre(nombre)))
        .filter(Boolean)
        .map(carta => {
            const faccion = normalizarFaccion(carta.faccion) || mapaCatalogo.get(obtenerClaveCarta(carta.Nombre))?.faccion || 'V';
            return escalarCartaSegunDificultad({
                ...carta,
                faccion
            }, dificultadDesafio);
        });

    const gruposPendientes = dividirEnGrupos(enemigosBase, 3);

    let bossPendiente = null;
    if (desafio.boss) {
        const bossBase = mapaPorNombre.get(normalizarNombre(desafio.boss));
        if (bossBase) {
            const faccionBoss = normalizarFaccion(bossBase.faccion) || mapaCatalogo.get(obtenerClaveCarta(bossBase.Nombre))?.faccion || 'V';
            bossPendiente = escalarBossSegunDificultad({
                ...bossBase,
                faccion: faccionBoss
            }, dificultadDesafio);
        }
    }

    return {
        activo: true,
        gruposPendientes,
        bossPendiente,
        recompensas: {
            puntos: Number(desafio.puntos || 0),
            mejora: Number(desafio.mejora || 0),
            mejoraEspecial: Number(desafio.mejora_especial || desafio.mejoraEspecial || 0)
        }
    };
}

function intentarDesplegarSiguienteGrupoDesafio() {
    if (!estadoDesafio.activo) {
        return false;
    }

    const siguienteGrupo = estadoDesafio.gruposPendientes.shift();
    if (Array.isArray(siguienteGrupo) && siguienteGrupo.length > 0) {
        cartasOponenteEnJuego = [null, null, null];
        siguienteGrupo.forEach((carta, index) => {
            if (index < 3) {
                cartasOponenteEnJuego[index] = carta;
            }
        });
        renderizarTablero();
        escribirLog('Un nuevo grupo enemigo entra al combate.');
        return true;
    }

    if (estadoDesafio.bossPendiente) {
        cartasOponenteEnJuego = [null, crearCartaCombateDesdeMazo(estadoDesafio.bossPendiente), null];
        estadoDesafio.bossPendiente = null;
        renderizarTablero();
        escribirLog('El BOSS aparece en el campo de batalla.');
        return true;
    }

    return false;
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

function calcularBonusAfiliaciones(cartas) {
    const conteoAfiliaciones = new Map();

    cartas
        .filter(carta => Boolean(carta) && !esCartaBoss(carta))
        .forEach(carta => {
            const afiliacionesUnicasCarta = new Set(
                obtenerAfiliacionesCarta(carta).map(normalizarAfiliacion).filter(Boolean)
            );

            afiliacionesUnicasCarta.forEach(afiliacion => {
                conteoAfiliaciones.set(afiliacion, (conteoAfiliaciones.get(afiliacion) || 0) + 1);
            });
        });

    const afiliacionesActivas = [];

    conteoAfiliaciones.forEach((cantidad, afiliacion) => {
        let bonus = 0;
        if (cantidad >= 3) {
            bonus = 1000;
        } else if (cantidad >= 2) {
            bonus = 500;
        }

        if (bonus > 0) {
            afiliacionesActivas.push({ afiliacion, bonus, cantidad });
        }
    });

    afiliacionesActivas.sort((a, b) => {
        if (b.bonus !== a.bonus) {
            return b.bonus - a.bonus;
        }

        if (b.cantidad !== a.cantidad) {
            return b.cantidad - a.cantidad;
        }

        return a.afiliacion.localeCompare(b.afiliacion);
    });

    const afiliacionPrincipal = afiliacionesActivas[0] || null;
    const bonusMaximo = afiliacionPrincipal ? afiliacionPrincipal.bonus : 0;

    return {
        bonusMaximo,
        afiliacionesActivas,
        afiliacionPrincipal
    };
}

function aplicarBonusAfiliaciones(cartas) {
    const { bonusMaximo, afiliacionesActivas, afiliacionPrincipal } = calcularBonusAfiliaciones(cartas);

    const cartasConBonus = cartas.map(carta => {
        if (!carta) {
            return null;
        }

        if (esCartaBoss(carta)) {
            const poderBaseBoss = Number(carta.Poder || 0);
            return {
                ...carta,
                poderBaseAfiliacion: poderBaseBoss,
                bonusAfiliacion: 0,
                poderFinalAfiliacion: poderBaseBoss
            };
        }

        const poderBase = Number(carta.Poder || 0);
        const afiliacionesCarta = new Set(
            obtenerAfiliacionesCarta(carta).map(normalizarAfiliacion).filter(Boolean)
        );
        const recibeBonus = Boolean(afiliacionPrincipal?.afiliacion) && afiliacionesCarta.has(afiliacionPrincipal.afiliacion);
        const bonusAplicado = recibeBonus ? bonusMaximo : 0;

        return {
            ...carta,
            poderBaseAfiliacion: poderBase,
            bonusAfiliacion: bonusAplicado,
            poderFinalAfiliacion: poderBase + bonusAplicado
        };
    });

    return {
        cartasConBonus,
        bonusMaximo,
        afiliacionesActivas,
        afiliacionPrincipal
    };
}

function formatearEtiquetaAfiliacion(afiliacion) {
    const texto = String(afiliacion || '').trim();
    if (!texto) {
        return '';
    }

    return texto
        .split(/\s+/)
        .map(parte => parte.charAt(0).toUpperCase() + parte.slice(1))
        .join(' ');
}

function obtenerPoderCartaFinal(carta) {
    if (!carta) {
        return 0;
    }

    if (typeof carta.poderFinalAfiliacion === 'number') {
        return carta.poderFinalAfiliacion;
    }

    return Number(carta.Poder || 0);
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
    if (!carta) {
        return 0;
    }

    const saludMax = obtenerSaludMaxCarta(carta);
    const salud = Number(carta.Salud ?? carta.salud);
    const saludValida = Number.isFinite(salud) ? salud : saludMax;
    return Math.max(0, Math.min(saludValida, saludMax));
}

function crearCartaCombateDesdeMazo(carta) {
    if (!carta) {
        return null;
    }

    const cartaCombate = { ...carta };
    const saludMax = obtenerSaludMaxCarta(cartaCombate);
    cartaCombate.SaludMax = saludMax;
    cartaCombate.Salud = saludMax;
    return cartaCombate;
}

function escribirLog(mensaje, clase = '') {
    const logsCombate = document.getElementById('logs-combate');
    const log = document.createElement('div');
    log.textContent = mensaje;

    if (clase) {
        log.classList.add(clase);
    }

    logsCombate.appendChild(log);
    logsCombate.scrollTop = logsCombate.scrollHeight;
}

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function obtenerIdSlot(tipo, slotIndex) {
    return `slot-${tipo === 'jugador' ? 'jugador' : 'oponente'}-${slotIndex + 1}`;
}

function animarCartaRobada(tipo, slotIndex) {
    const slot = document.getElementById(obtenerIdSlot(tipo, slotIndex));
    const carta = slot?.querySelector('.carta');

    if (!carta) {
        return;
    }

    carta.classList.remove('carta-robada');
    void carta.offsetWidth;
    carta.classList.add('carta-robada');
}

function mostrarDanioFlotante(tipo, slotIndex, danio) {
    const slot = document.getElementById(obtenerIdSlot(tipo, slotIndex));

    if (!slot) {
        return;
    }

    const slotRect = slot.getBoundingClientRect();
    const centroX = slotRect.left + (slotRect.width / 2);
    const centroY = slotRect.top + (slotRect.height * 0.46);

    const danioDiv = document.createElement('div');
    danioDiv.classList.add('danio-flotante');
    danioDiv.classList.add(tipo === 'jugador' ? 'impacto-jugador' : 'impacto-oponente');
    danioDiv.textContent = `-${danio}`;
    danioDiv.style.left = `${centroX}px`;
    danioDiv.style.top = `${centroY}px`;
    document.body.appendChild(danioDiv);

    setTimeout(() => {
        danioDiv.remove();
    }, 1200);
}

async function animarBajadaSaludCarta(cartasObjetivo, slotObjetivo, saludObjetivoInicial, saludObjetivoFinal, tipoObjetivo) {
    const carta = cartasObjetivo[slotObjetivo];
    if (!carta) {
        return;
    }

    const saludInicial = Math.max(0, Number(saludObjetivoInicial || 0));
    const saludFinal = Math.max(0, Number(saludObjetivoFinal || 0));

    const idSlotObjetivo = obtenerIdSlot(tipoObjetivo, slotObjetivo);

    carta.SaludMax = obtenerSaludMaxCarta(carta);
    carta.Salud = saludInicial;
    renderizarTablero();
    const slotTrasRender = document.getElementById(idSlotObjetivo);
    const barraTrasRender = slotTrasRender?.querySelector('.barra-salud-contenedor');
    barraTrasRender?.classList.add('recibiendo-danio');
    await esperar(120);

    carta.Salud = saludFinal;
    renderizarTablero();
    const slotFinal = document.getElementById(idSlotObjetivo);
    const barraFinal = slotFinal?.querySelector('.barra-salud-contenedor');
    barraFinal?.classList.add('recibiendo-danio');
    await esperar(380);
    barraFinal?.classList.remove('recibiendo-danio');
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
        throw new Error('No se pudieron guardar los datos del usuario en Firebase.');
    }

    return response.json();
}

async function obtenerCartasDisponibles() {
    const response = await fetch('resources/cartas.xlsx');

    if (!response.ok) {
        throw new Error('No se pudo cargar el archivo de cartas para generar las recompensas.');
    }

    const data = await response.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
        throw new Error('No se encontró ninguna hoja válida en el archivo de cartas.');
    }

    return XLSX.utils.sheet_to_json(sheet);
}

function seleccionarCartasRecompensa(cartasDisponibles, cantidad) {
    const cartasPremio = [];

    for (let i = 0; i < cantidad; i++) {
        const indexAleatorio = Math.floor(Math.random() * cartasDisponibles.length);
        cartasPremio.push({ ...cartasDisponibles[indexAleatorio] });
    }

    return cartasPremio;
}

function determinarNivelCartaBonus(dificultad) {
    const nivelesPosibles = [dificultad];

    if (dificultad > 1) {
        nivelesPosibles.push(dificultad - 1);
    }

    if (dificultad < 6) {
        nivelesPosibles.push(dificultad + 1);
    }

    const pesos = nivelesPosibles.map(nivel => {
        if (nivel === dificultad) {
            return 0.5;
        }

        return 0.25;
    });

    const pesoTotal = pesos.reduce((total, peso) => total + peso, 0);
    let tirada = Math.random() * pesoTotal;

    for (let i = 0; i < nivelesPosibles.length; i++) {
        tirada -= pesos[i];

        if (tirada <= 0) {
            return nivelesPosibles[i];
        }
    }

    return dificultad;
}

function obtenerDificultadActual() {
    const dificultadGuardada = Number(localStorage.getItem('dificultad') || 1);

    if (Number.isNaN(dificultadGuardada) || dificultadGuardada < 1) {
        return 1;
    }

    return Math.min(dificultadGuardada, 6);
}

function calcularPuntosVictoria(dificultad) {
    return 100 + ((dificultad - 1) * 50);
}

function escalarCartaSegunDificultad(carta, dificultad) {
    const cartaEscalada = { ...carta };
    const nivelBase = Number(cartaEscalada.Nivel || 1);
    const dificultadObjetivo = Math.min(Math.max(dificultad, 1), 6);
    const incrementoNiveles = Math.max(dificultadObjetivo - nivelBase, 0);
    const saludBase = obtenerSaludMaxCarta(cartaEscalada);

    cartaEscalada.Nivel = dificultadObjetivo;
    cartaEscalada.Poder = Number(cartaEscalada.Poder || 0) + (incrementoNiveles * 500);
    cartaEscalada.SaludMax = saludBase + (incrementoNiveles * 500);
    cartaEscalada.Salud = cartaEscalada.SaludMax;

    return cartaEscalada;
}

function escalarBossSegunDificultad(carta, dificultad) {
    const cartaBoss = { ...carta };
    const nivelBase = Number(cartaBoss.Nivel || 1);
    const dificultadObjetivo = Math.min(Math.max(dificultad, 1), 6);
    const incrementoNiveles = Math.max(dificultadObjetivo - nivelBase, 0);
    const incrementoPorNivel = incrementoNiveles * 500;
    const saludBase = obtenerSaludMaxCarta(cartaBoss);
    const poderBase = Number(cartaBoss.Poder || 0);

    cartaBoss.Nivel = dificultadObjetivo;
    cartaBoss.Poder = Math.round((poderBase * 1.5) + incrementoPorNivel);
    cartaBoss.SaludMax = Math.round((saludBase * 6) + incrementoPorNivel);
    cartaBoss.Salud = cartaBoss.SaludMax;
    cartaBoss.esBoss = true;

    return cartaBoss;
}

function obtenerNivelPorProbabilidad(dificultad) {
    let probabilidades = [
        { nivel: 1, peso: 40 },
        { nivel: 2, peso: 30 },
        { nivel: 3, peso: 15 },
        { nivel: 4, peso: 9 },
        { nivel: 5, peso: 5 },
        { nivel: 6, peso: 1 }
    ];

    // Buff en dificultades altas
    if (dificultad >= 5) {
        probabilidades[4].peso += 2; // +5⭐
        probabilidades[5].peso += 1; // +6⭐
    }

    const total = probabilidades.reduce((sum, p) => sum + p.peso, 0);
    let tirada = Math.random() * total;

    for (const p of probabilidades) {
        tirada -= p.peso;
        if (tirada <= 0) {
            return p.nivel;
        }
    }

    return 1;
}

function construirPoolUnicoPorNombre(cartas) {
    const mapa = new Map();

    cartas.forEach(carta => {
        const clave = obtenerClaveCarta(carta?.Nombre);
        if (!clave || mapa.has(clave)) {
            return;
        }
        mapa.set(clave, { ...carta });
    });

    return Array.from(mapa.values());
}

function mezclarArray(array) {
    const copia = [...array];
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

function obtenerAfiliacionesNormalizadas(carta) {
    return obtenerAfiliacionesCarta(carta).map(normalizarAfiliacion).filter(Boolean);
}

function esMazoBotValido(mazo, dificultad) {
    if (!Array.isArray(mazo) || mazo.length !== 12) {
        return false;
    }

    const faccionesValidas = mazo
        .map(carta => normalizarFaccion(carta?.faccion))
        .filter(Boolean);

    if (faccionesValidas.length !== 12) {
        return false;
    }

    const faccionUnica = new Set(faccionesValidas);
    if (faccionUnica.size !== 1) {
        return false;
    }

    const dificultadObjetivo = Math.min(Math.max(Number(dificultad || 1), 1), 6);
    return mazo.every(carta => Number(carta?.Nivel || 0) === dificultadObjetivo);
}

async function otorgarRecompensasVictoria() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');

    if (!usuario || !email) {
        throw new Error('No se encontró una sesión de usuario válida para guardar las recompensas.');
    }

    const dificultad = obtenerDificultadActual();
    const puntosGanados = calcularPuntosVictoria(dificultad);
    const cartasDisponibles = await obtenerCartasDisponibles();
    const cartasBasePremio = seleccionarCartasRecompensa(cartasDisponibles, 2);
    const hayCartaBonus = Math.random() < 0.5;
    const cartaBonusBase = hayCartaBonus ? seleccionarCartasRecompensa(cartasDisponibles, 1)[0] : null;

    const cartasPremio = cartasBasePremio.map(carta => {
        const nivel = obtenerNivelPorProbabilidad(dificultad);
        return {
            ...escalarCartaSegunDificultad(carta, nivel),
            tipoRecompensa: 'base'
        };
    });

    if (cartaBonusBase) {
        const nivelBonus = obtenerNivelPorProbabilidad(dificultad);
        cartasPremio.push({
            ...escalarCartaSegunDificultad(cartaBonusBase, nivelBonus),
            tipoRecompensa: 'bonus'
        });
    }

    usuario.cartas = Array.isArray(usuario.cartas) ? usuario.cartas : [];
    usuario.puntos = Number(usuario.puntos || 0) + puntosGanados;
    usuario.cartas.push(...cartasPremio);

    await actualizarUsuarioFirebase(usuario, email);
    localStorage.setItem('usuario', JSON.stringify(usuario));

    return {
        dificultad,
        puntosGanados,
        cartasGanadas: cartasPremio
    };
}

async function otorgarRecompensasDesafio() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');
    if (!usuario || !email) {
        throw new Error('No se encontró una sesión de usuario válida para guardar las recompensas del desafío.');
    }

    const recompensas = estadoDesafio.recompensas || { puntos: 0, mejora: 0, mejoraEspecial: 0 };

    // ✅ Guardar desafío completado
    usuario.desafiosCompletados = Array.isArray(usuario.desafiosCompletados)
        ? usuario.desafiosCompletados
        : [];

    const idDesafio = desafioActivo?.id;

    if (idDesafio !== undefined && !usuario.desafiosCompletados.includes(idDesafio)) {
        usuario.desafiosCompletados.push(idDesafio);
    }

    usuario.puntos = Number(usuario.puntos || 0) + Number(recompensas.puntos || 0);
    usuario.objetos = (usuario.objetos && typeof usuario.objetos === 'object')
        ? usuario.objetos
        : { mejoraCarta: 0, mejoraEspecial: 0 };
    usuario.objetos.mejoraCarta = Number(usuario.objetos.mejoraCarta || 0) + Number(recompensas.mejora || 0);
    usuario.objetos.mejoraEspecial = Number(usuario.objetos.mejoraEspecial || 0) + Number(recompensas.mejoraEspecial || 0);

    const cartasGanadas = [];
    if (desafioActivo?.tipo === 'evento' && desafioActivo?.carta_recompensa) {
        const cartasDisponibles = await obtenerCartasDisponibles();
        const cartaEvento = cartasDisponibles.find(
            carta => normalizarNombre(carta?.Nombre) === normalizarNombre(desafioActivo.carta_recompensa)
        );

        if (cartaEvento) {
            const dificultadEvento = Math.min(Math.max(Number(desafioActivo.dificultad || 1), 1), 6);
            cartasGanadas.push({
                ...escalarCartaSegunDificultad(cartaEvento, dificultadEvento),
                tipoRecompensa: 'evento'
            });
        }
    }

    if (cartasGanadas.length > 0) {
        usuario.cartas = Array.isArray(usuario.cartas) ? usuario.cartas : [];
        usuario.cartas.push(...cartasGanadas);
    }

    await actualizarUsuarioFirebase(usuario, email);
    localStorage.setItem('usuario', JSON.stringify(usuario));
    localStorage.removeItem('desafioActivo');

    return {
        puntosGanados: Number(recompensas.puntos || 0),
        mejorasGanadas: Number(recompensas.mejora || 0),
        mejorasEspecialesGanadas: Number(recompensas.mejoraEspecial || 0),
        cartasGanadas
    };
}

function calcularPoderTotal(cartas) {
    return cartas.reduce((total, carta) => total + obtenerPoderCartaFinal(carta), 0);
}

function crearCartaRecompensaElemento(carta) {
    const contenedor = document.createElement('div');
    contenedor.classList.add('carta-recompensa-slot');

    if (carta.tipoRecompensa === 'bonus') {
        const etiquetaBonus = document.createElement('div');
        etiquetaBonus.classList.add('etiqueta-recompensa-bonus');
        etiquetaBonus.textContent = 'Carta Bonus';
        contenedor.appendChild(etiquetaBonus);
    }

    contenedor.appendChild(crearCartaElemento(carta, 'recompensa', -1));
    return contenedor;
}

function crearEtiquetaObjetoRecompensa(tipo, cantidad) {
    const badge = document.createElement('div');
    badge.style.display = 'inline-flex';
    badge.style.alignItems = 'center';
    badge.style.gap = '6px';
    badge.style.padding = '6px 10px';
    badge.style.borderRadius = '999px';
    badge.style.border = '1px solid rgba(255, 215, 0, 0.6)';
    badge.style.background = 'rgba(255, 215, 0, 0.12)';
    badge.style.color = '#ffd700';
    badge.style.fontWeight = '700';
    badge.style.fontSize = '0.84rem';

    const icono = document.createElement('img');
    icono.src = tipo === 'mejoraEspecial' ? ICONO_MEJORA_ESPECIAL : ICONO_MEJORA;
    icono.alt = tipo === 'mejoraEspecial' ? 'Mejora especial' : 'Mejora';
    icono.style.width = '40px';
    icono.style.height = '40px';
    icono.style.objectFit = 'contain';

    const texto = document.createElement('span');
    texto.textContent = `x${Number(cantidad || 0)}`;

    badge.appendChild(icono);
    badge.appendChild(texto);
    return badge;
}

function seleccionarCartasAleatorias(mazo, cantidad) {
    const cartasSeleccionadas = [];

    while (cartasSeleccionadas.length < cantidad && mazo.length > 0) {
        const indexAleatorio = Math.floor(Math.random() * mazo.length);
        const cartaSeleccionada = mazo.splice(indexAleatorio, 1)[0];
        cartasSeleccionadas.push(cartaSeleccionada);
    }

    return cartasSeleccionadas;
}

function actualizarTextoTurno(texto) {
    document.getElementById('turno-texto').textContent = texto;
}

function mostrarAvisoTurno(texto) {
    const avisoTurno = document.getElementById('aviso-turno');

    if (!avisoTurno) {
        return;
    }

    avisoTurno.textContent = texto;
    avisoTurno.classList.add('visible');

    if (temporizadorAvisoTurno) {
        clearTimeout(temporizadorAvisoTurno);
    }

    temporizadorAvisoTurno = setTimeout(() => {
        avisoTurno.classList.remove('visible');
    }, 1400);
}

async function generarMazoBot(dificultad) {
    const cartasDisponibles = await obtenerCartasDisponibles();
    const nivelObjetivo = Math.min(Math.max(Number(dificultad || 1), 1), 6);
    const poolHeroes = construirPoolUnicoPorNombre(
        cartasDisponibles.filter(carta => normalizarFaccion(carta?.faccion) === 'H')
    );
    const poolVillanos = construirPoolUnicoPorNombre(
        cartasDisponibles.filter(carta => normalizarFaccion(carta?.faccion) === 'V')
    );

    const faccionesElegibles = [];
    if (poolHeroes.length >= 12) {
        faccionesElegibles.push('H');
    }
    if (poolVillanos.length >= 12) {
        faccionesElegibles.push('V');
    }

    if (faccionesElegibles.length === 0) {
        throw new Error('No hay suficientes cartas por facción para construir mazo BOT.');
    }

    const faccionObjetivo = faccionesElegibles[Math.floor(Math.random() * faccionesElegibles.length)];
    const pool = faccionObjetivo === 'H' ? poolHeroes : poolVillanos;

    const mazo = [];
    const usadas = new Set();
    const mapaAfiliaciones = new Map();

    pool.forEach(carta => {
        const afiliaciones = new Set(obtenerAfiliacionesNormalizadas(carta));
        afiliaciones.forEach(afiliacion => {
            if (!mapaAfiliaciones.has(afiliacion)) {
                mapaAfiliaciones.set(afiliacion, []);
            }
            mapaAfiliaciones.get(afiliacion).push(carta);
        });
    });

    const afiliacionesOrdenadas = Array.from(mapaAfiliaciones.entries())
        .filter(([, cartas]) => cartas.length >= 2)
        .sort((a, b) => b[1].length - a[1].length);

    if (afiliacionesOrdenadas.length > 0) {
        const cartasSinergia = mezclarArray(afiliacionesOrdenadas[0][1]).slice(0, 8);
        cartasSinergia.forEach(carta => {
            const clave = obtenerClaveCarta(carta.Nombre);
            if (!usadas.has(clave) && mazo.length < 12) {
                mazo.push(carta);
                usadas.add(clave);
            }
        });
    }

    for (const carta of mezclarArray(pool)) {
        if (mazo.length >= 12) {
            break;
        }
        const clave = obtenerClaveCarta(carta.Nombre);
        if (usadas.has(clave)) {
            continue;
        }
        mazo.push(carta);
        usadas.add(clave);
    }

    return mazo.slice(0, 12).map(carta => escalarCartaSegunDificultad({ ...carta }, nivelObjetivo));
}

function actualizarContadoresMazo() {
    const botonMazoJugador = document.getElementById('mazo-jugador');
    const botonMazoOponente = document.getElementById('mazo-oponente');
    const contadorJugador = document.getElementById('contador-mazo-jugador');
    const contadorOponente = document.getElementById('contador-mazo-oponente');

    botonMazoJugador.textContent = `Mazo (${mazoJugador.length})`;
    botonMazoOponente.textContent = `Mazo BOT (${mazoOponente.length})`;

    if (contadorJugador) {
        contadorJugador.textContent = `Cartas en mazo: ${mazoJugador.length}`;
    }

    if (contadorOponente) {
        contadorOponente.textContent = `Cartas en mazo BOT: ${mazoOponente.length}`;
    }
}

function crearCartaElemento(carta, tipo, slotIndex) {
    const cartaDiv = document.createElement('div');
    cartaDiv.classList.add('carta');
    if (Number(carta?.Nivel || 1) >= 6) {
        cartaDiv.classList.add('nivel-legendaria');
    }
    if (esCartaBoss(carta)) {
        cartaDiv.classList.add('boss-carta');
        cartaDiv.style.transform = 'scale(1.12)';
        cartaDiv.style.boxShadow = '0 0 22px rgba(255, 66, 66, 0.9), 0 0 34px rgba(255, 205, 66, 0.65)';
        cartaDiv.style.border = '2px solid rgba(255, 130, 66, 0.95)';
        cartaDiv.style.zIndex = '5';
    }

    const imagenUrl = obtenerImagenCarta(carta);
    cartaDiv.style.backgroundImage = `url(${imagenUrl})`;
    cartaDiv.style.backgroundSize = 'cover';
    cartaDiv.style.backgroundPosition = 'center';

    if (tipo === 'jugador' && turnoActual === 'jugador' && !cartasQueYaAtacaron.includes(slotIndex)) {
        cartaDiv.style.cursor = 'pointer';
        cartaDiv.addEventListener('click', () => seleccionarCartaAtacante(slotIndex));
    }

    if (tipo === 'jugador' && cartasQueYaAtacaron.includes(slotIndex)) {
        cartaDiv.classList.add('carta-agotada');
    }

    if (tipo === 'oponente' && turnoActual === 'jugador' && atacanteSeleccionado !== null) {
        cartaDiv.style.cursor = 'pointer';
        cartaDiv.addEventListener('click', () => seleccionarCartaObjetivo(slotIndex));
    }

    if (tipo === 'jugador' && atacanteSeleccionado === slotIndex) {
        cartaDiv.classList.add('carta-seleccionada');
    }

    if (tipo === 'jugador' && cartaJugadorDestacada === slotIndex) {
        cartaDiv.classList.add('carta-atacando');
    }

    if (tipo === 'oponente' && cartaOponenteDestacada === slotIndex) {
        cartaDiv.classList.add('carta-objetivo');
    }

    const detallesDiv = document.createElement('div');
    detallesDiv.classList.add('detalles-carta');

    const nombreSpan = document.createElement('span');
    nombreSpan.classList.add('nombre-carta');
    nombreSpan.textContent = carta.Nombre;
    const longitudNombre = String(carta?.Nombre || '').trim().length;
    if (longitudNombre >= 24) {
        nombreSpan.classList.add('nombre-muy-largo');
    } else if (longitudNombre >= 18) {
        nombreSpan.classList.add('nombre-largo');
    }

    const poderSpan = document.createElement('span');
    poderSpan.classList.add('poder-carta');
    poderSpan.textContent = obtenerPoderCartaFinal(carta);
    if (Number(carta?.bonusAfiliacion || 0) > 0) {
        poderSpan.style.color = '#FFD700';
    }

    detallesDiv.appendChild(nombreSpan);
    detallesDiv.appendChild(poderSpan);

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

    const estrellasDiv = document.createElement('div');
    estrellasDiv.classList.add('estrellas-carta');

    const cantidadEstrellas = esCartaBoss(carta)
        ? Math.min(Math.max(Number(desafioActivo?.dificultad || 1), 1), 6)
        : Number(carta.Nivel || 1);
    for (let i = 0; i < cantidadEstrellas; i++) {
        const estrella = document.createElement('img');
        estrella.classList.add('estrella');
        estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
        estrella.alt = 'star';
        estrellasDiv.appendChild(estrella);
    }

    cartaDiv.appendChild(detallesDiv);
    cartaDiv.appendChild(barraSaludContenedor);
    cartaDiv.appendChild(estrellasDiv);

    return cartaDiv;
}

function mostrarCartaEnSlot(slot, carta, tipo, slotIndex) {
    slot.innerHTML = '';

    if (!carta) {
        return;
    }

    slot.appendChild(crearCartaElemento(carta, tipo, slotIndex));
}

function actualizarPoderVisual() {
    const { cartasConBonus: cartasJugadorConBonus } = aplicarBonusAfiliaciones(cartasJugadorEnJuego);
    const { cartasConBonus: cartasOponenteConBonus } = aplicarBonusAfiliaciones(cartasOponenteEnJuego);
    const pTotalJugador = calcularPoderTotal(cartasJugadorConBonus);
    const pTotalOponente = calcularPoderTotal(cartasOponenteConBonus);
    
    const actualizarLabel = (id, selector, texto, valor) => {
        let label = document.getElementById(id);
        if (!label) {
            const contenedor = document.querySelector(selector);
            if (contenedor) {
                label = document.createElement('div');
                label.id = id;
                label.className = 'poder-total-ui';
                contenedor.appendChild(label);
            }
        }
        if (label && label.textContent !== `${texto}: ${valor}`) {
            label.textContent = `${texto}: ${valor}`;
            label.classList.add('cambio');
            setTimeout(() => label.classList.remove('cambio'), 300);
        }
    };

    actualizarLabel('poder-total-jugador', '.jugador-propio .info-jugador', 'Poder Jugador', pTotalJugador);
    actualizarLabel('poder-total-oponente', '.jugador-oponente .info-jugador', 'Poder BOT', pTotalOponente);
}

function actualizarIndicadoresAfiliacionesActivas() {
    const { afiliacionPrincipal: activaJugador } = calcularBonusAfiliaciones(cartasJugadorEnJuego);
    const { afiliacionPrincipal: activaOponente } = calcularBonusAfiliaciones(cartasOponenteEnJuego);

    const actualizar = (id, selectorJugador, afiliacionActiva) => {
        let contenedor = document.getElementById(id);
        if (!contenedor) {
            const jugador = document.querySelector(selectorJugador);
            const slots = jugador?.querySelector('.slots-jugador');
            if (!jugador || !slots) {
                return;
            }

            contenedor = document.createElement('div');
            contenedor.id = id;
            contenedor.className = 'bonus-activo-tablero';
            jugador.insertBefore(contenedor, slots);
        }

        contenedor.innerHTML = '';
        if (afiliacionActiva) {
            const linea = document.createElement('div');
            linea.className = 'bonus-activo-item';
            linea.textContent = `Bonus activo: ${formatearEtiquetaAfiliacion(afiliacionActiva.afiliacion)} (+${afiliacionActiva.bonus})`;
            contenedor.appendChild(linea);
        }
    };

    actualizar('bonus-activo-oponente', '.jugador-oponente', activaOponente);
    actualizar('bonus-activo-jugador', '.jugador-propio', activaJugador);
}

function renderizarTablero() {
    const { cartasConBonus: cartasJugadorConBonus } = aplicarBonusAfiliaciones(cartasJugadorEnJuego);
    const { cartasConBonus: cartasOponenteConBonus } = aplicarBonusAfiliaciones(cartasOponenteEnJuego);

    cartasJugadorConBonus.forEach((carta, index) => {
        const slot = document.getElementById(`slot-jugador-${index + 1}`);
        mostrarCartaEnSlot(slot, carta, 'jugador', index);
    });

    cartasOponenteConBonus.forEach((carta, index) => {
        const slot = document.getElementById(`slot-oponente-${index + 1}`);
        mostrarCartaEnSlot(slot, carta, 'oponente', index);
    });

    actualizarContadoresMazo();
    actualizarPoderVisual();
    actualizarIndicadoresAfiliacionesActivas();
}

function limpiarDestacados() {
    cartaJugadorDestacada = null;
    cartaOponenteDestacada = null;
}

async function rellenarSlotsVacios(mazo, cartasEnJuego, propietario) {
    for (let i = 0; i < cartasEnJuego.length; i++) {
        if (!cartasEnJuego[i] && mazo.length > 0) {
            cartasEnJuego[i] = crearCartaCombateDesdeMazo(seleccionarCartasAleatorias(mazo, 1)[0]);
            escribirLog(
                `${propietario === 'jugador' ? 'Robas' : 'El BOT roba'} ${cartasEnJuego[i].Nombre} al slot ${i + 1}.`
            );
            localStorage.setItem('mazoJugador', JSON.stringify({ Cartas: mazoJugador }));
            localStorage.setItem('mazoOponente', JSON.stringify({ Cartas: mazoOponente }));
            renderizarTablero();
            animarCartaRobada(propietario, i);
            await esperar(420);
        }
    }
}

function determinarPrimerTurno(cartasJugador, cartasOponente) {
    const { cartasConBonus: cartasJugadorConBonus } = aplicarBonusAfiliaciones(cartasJugador);
    const { cartasConBonus: cartasOponenteConBonus } = aplicarBonusAfiliaciones(cartasOponente);
    const poderJugador = calcularPoderTotal(cartasJugadorConBonus);
    const poderOponente = calcularPoderTotal(cartasOponenteConBonus);

    if (poderJugador > poderOponente) {
        return 'jugador';
    }

    if (poderOponente > poderJugador) {
        return 'oponente';
    }

    return Math.random() > 0.5 ? 'jugador' : 'oponente';
}

async function cargarCartasIniciales() {
    desafioActivo = obtenerDesafioActivo();
    estadoDesafio = {
        activo: false,
        gruposPendientes: [],
        bossPendiente: null,
        recompensas: null
    };

    try {
        mazoJugador = await enriquecerCartasConDatosCatalogo(mazoJugador);
        if (desafioActivo) {
            estadoDesafio = await construirEstadoDesafio(desafioActivo);
            mazoOponente = [];
        } else {
            const dificultad = obtenerDificultadActual();
            const mazoBotGuardado = JSON.parse(localStorage.getItem('mazoOponente') || '{"Cartas":[]}').Cartas || [];
            mazoOponente = esMazoBotValido(mazoBotGuardado, dificultad)
                ? mazoBotGuardado
                : await generarMazoBot(dificultad);

            // 🔥 ENRIQUECER
            mazoOponente = await enriquecerCartasConDatosCatalogo(mazoOponente);
        }
        localStorage.setItem('mazoJugador', JSON.stringify({ Cartas: mazoJugador }));
        localStorage.removeItem('mazoOponente');
        localStorage.setItem('mazoOponente', JSON.stringify({ Cartas: mazoOponente }));
    } catch (error) {
        console.error('No se pudieron enriquecer los mazos con datos del catálogo:', error);
    }

    // 1. Empezar con tablero vacío
    cartasJugadorEnJuego = [null, null, null];
    cartasOponenteEnJuego = [null, null, null];
    
    // Preparar cartas del mazo (sin ponerlas aún)
    const inicialesJugador = seleccionarCartasAleatorias(mazoJugador, 3).map(crearCartaCombateDesdeMazo);
    const inicialesOponente = estadoDesafio.activo
        ? (estadoDesafio.gruposPendientes.shift() || []).map(crearCartaCombateDesdeMazo)
        : seleccionarCartasAleatorias(mazoOponente, 3).map(crearCartaCombateDesdeMazo);

    renderizarTablero(); 
    escribirLog("Iniciando partida... Desplegando unidades.");
    await esperar(500);

    // 2. Despliegue progresivo (una a una)
    for (let i = 0; i < 3; i++) {
        // Carta Jugador
        cartasJugadorEnJuego[i] = inicialesJugador[i];
        renderizarTablero();
        const slotJ = document.getElementById(`slot-jugador-${i + 1}`);
        slotJ?.querySelector('.carta')?.classList.add('carta-entrada');
        await esperar(250); // Delay entre cartas

        // Carta Oponente
        cartasOponenteEnJuego[i] = inicialesOponente[i] || null;
        renderizarTablero();
        const slotO = document.getElementById(`slot-oponente-${i + 1}`);
        slotO?.querySelector('.carta')?.classList.add('carta-entrada');
        await esperar(250);
    }

    localStorage.setItem('mazoJugador', JSON.stringify({ Cartas: mazoJugador }));
    localStorage.setItem('mazoOponente', JSON.stringify({ Cartas: mazoOponente }));

    // 3. Determinar turno tras el despliegue
    await esperar(400);
    const primerTurno = determinarPrimerTurno(cartasJugadorEnJuego, cartasOponenteEnJuego);
    escribirLog(`El primer turno es para: ${primerTurno === 'jugador' ? 'Jugador' : 'BOT'}`);

    if (primerTurno === 'jugador') {
        iniciarTurnoJugador();
    } else {
        iniciarTurnoOponente();
    }
}

function obtenerIndicesCartasDisponibles(cartasEnJuego) {
    return cartasEnJuego
        .map((carta, index) => ({ carta, index }))
        .filter(({ carta }) => carta !== null)
        .map(({ index }) => index);
}

async function mostrarVentanaFinPartida(ganador) {
    const ventanaEmergente = document.getElementById('ventana-emergente-fin');
    const tituloFinPartida = document.getElementById('titulo-fin-partida');
    const mensajeFinPartida = document.getElementById('mensaje-fin-partida');
    const recompensasContainer = document.getElementById('recompensas-container');
    const botonReiniciar = document.getElementById('boton-reiniciar-partida');
    const botonVolverMenu = document.getElementById('boton-volver-menu');

    const esEventoActivo = Boolean(estadoDesafio.activo && desafioActivo?.tipo === 'evento');

    tituloFinPartida.textContent = ganador === 'jugador' ? 'Has ganado' : 'Has perdido';
    mensajeFinPartida.textContent = ganador === 'jugador'
        ? 'Has derrotado al BOT.'
        : 'El BOT ha ganado la partida.';

    recompensasContainer.innerHTML = '';
    ventanaEmergente.style.display = 'flex';
    botonReiniciar.onclick = reiniciarPartida;
    botonVolverMenu.onclick = volverAlMenu;
    botonVolverMenu.textContent = esEventoActivo ? 'Terminar Evento' : 'Volver al menú';

    if (ganador !== 'jugador') {
        return;
    }

    if (recompensasProcesadas) {
        const recompensa = document.createElement('p');
        recompensa.classList.add('texto-recompensa-estado');
        recompensa.textContent = 'Las recompensas de esta victoria ya se han aplicado.';
        recompensasContainer.appendChild(recompensa);
        return;
    }

    recompensasProcesadas = true;

    const estadoGuardado = document.createElement('p');
    estadoGuardado.classList.add('texto-recompensa-estado');
    estadoGuardado.textContent = 'Guardando recompensas y progreso...';
    recompensasContainer.appendChild(estadoGuardado);

    botonReiniciar.disabled = true;
    botonVolverMenu.disabled = true;

    try {
        recompensasContainer.innerHTML = '';

        if (estadoDesafio.activo) {
            const recompensaDesafio = await otorgarRecompensasDesafio();
            const resumenDesafio = document.createElement('p');
            resumenDesafio.classList.add('texto-recompensa-resumen');
            resumenDesafio.textContent = `Recompensas del desafío: ${recompensaDesafio.puntosGanados} puntos.`;
            recompensasContainer.appendChild(resumenDesafio);

            const filaObjetos = document.createElement('div');
            filaObjetos.style.display = 'flex';
            filaObjetos.style.justifyContent = 'center';
            filaObjetos.style.gap = '10px';
            filaObjetos.style.flexWrap = 'wrap';
            filaObjetos.style.marginBottom = '10px';
            if (Number(recompensaDesafio.mejorasGanadas || 0) > 0) {
                filaObjetos.appendChild(crearEtiquetaObjetoRecompensa('mejoraCarta', recompensaDesafio.mejorasGanadas));
            }
            if (Number(recompensaDesafio.mejorasEspecialesGanadas || 0) > 0) {
                filaObjetos.appendChild(crearEtiquetaObjetoRecompensa('mejoraEspecial', recompensaDesafio.mejorasEspecialesGanadas));
            }
            if (filaObjetos.childElementCount > 0) {
                recompensasContainer.appendChild(filaObjetos);
            }

            if (Array.isArray(recompensaDesafio.cartasGanadas) && recompensaDesafio.cartasGanadas.length > 0) {
                const rejillaRecompensasEvento = document.createElement('div');
                rejillaRecompensasEvento.classList.add('recompensas-grid');
                recompensaDesafio.cartasGanadas.forEach(carta => {
                    rejillaRecompensasEvento.appendChild(crearCartaRecompensaElemento(carta));
                });
                recompensasContainer.appendChild(rejillaRecompensasEvento);
            }
        } else {
            const recompensa = await otorgarRecompensasVictoria();
            const resumen = document.createElement('p');
            resumen.classList.add('texto-recompensa-resumen');
            resumen.textContent = `Recompensas: ${recompensa.puntosGanados} puntos y ${recompensa.cartasGanadas.length} cartas nuevas.`;
            recompensasContainer.appendChild(resumen);

            const rejillaRecompensas = document.createElement('div');
            rejillaRecompensas.classList.add('recompensas-grid');
            recompensa.cartasGanadas.forEach(carta => {
                rejillaRecompensas.appendChild(crearCartaRecompensaElemento(carta));
            });
            recompensasContainer.appendChild(rejillaRecompensas);
        }

        const usuarioActualizado = JSON.parse(localStorage.getItem('usuario'));
        const totalPuntos = Number(usuarioActualizado?.puntos || 0);
        const puntosTotales = document.createElement('p');
        puntosTotales.classList.add('texto-recompensa-puntos');
        puntosTotales.textContent = `Puntos totales: ${totalPuntos}.`;
        recompensasContainer.appendChild(puntosTotales);

        escribirLog('Victoria guardada correctamente. Las recompensas se han añadido a tu usuario.');
    } catch (error) {
        recompensasContainer.innerHTML = '';

        const errorGuardado = document.createElement('p');
        errorGuardado.classList.add('texto-recompensa-error');
        errorGuardado.textContent = `No se pudieron guardar las recompensas: ${error.message}`;
        recompensasContainer.appendChild(errorGuardado);

        escribirLog(`Error al guardar las recompensas: ${error.message}`);
    } finally {
        botonReiniciar.disabled = false;
        botonVolverMenu.disabled = false;
    }
}

function verificarFinDePartida() {
    const cartasVivasJugador = obtenerIndicesCartasDisponibles(cartasJugadorEnJuego).length;
    const cartasVivasOponente = obtenerIndicesCartasDisponibles(cartasOponenteEnJuego).length;

    if (cartasVivasJugador === 0 && mazoJugador.length === 0) {
        partidaFinalizada = true;
        actualizarTextoTurno('Partida finalizada');
        mostrarAvisoTurno('Has perdido');
        escribirLog('No te quedan cartas en mesa ni en el mazo. Has perdido.');
        mostrarVentanaFinPartida('oponente');
        return true;
    }

    if (cartasVivasOponente === 0 && mazoOponente.length === 0) {
        if (intentarDesplegarSiguienteGrupoDesafio()) {
            return false;
        }
        partidaFinalizada = true;
        actualizarTextoTurno('Partida finalizada');
        mostrarAvisoTurno('Has ganado');
        escribirLog('El BOT se ha quedado sin cartas en mesa y en el mazo. Has ganado.');
        mostrarVentanaFinPartida('jugador');
        return true;
    }

    return false;
}

function finalizarTurnoJugador() {
    if (partidaFinalizada) {
        return;
    }

    atacanteSeleccionado = null;
    cartasQueYaAtacaron = [];
    limpiarDestacados();
    renderizarTablero();
    escribirLog('Tu turno ha terminado.');

    if (verificarFinDePartida()) {
        return;
    }

    setTimeout(() => {
        iniciarTurnoOponente();
    }, 900);
}

function finalizarTurnoOponente() {
    if (partidaFinalizada) {
        return;
    }

    limpiarDestacados();
    renderizarTablero();
    escribirLog('El turno del BOT ha terminado.');

    if (verificarFinDePartida()) {
        return;
    }

    setTimeout(() => {
        iniciarTurnoJugador();
    }, 900);
}

function seleccionarCartaAtacante(slotIndex) {
    if (partidaFinalizada || turnoActual !== 'jugador') {
        return;
    }

    if (!cartasJugadorEnJuego[slotIndex]) {
        return;
    }

    if (cartasQueYaAtacaron.includes(slotIndex)) {
        escribirLog(`${cartasJugadorEnJuego[slotIndex].Nombre} ya ha atacado en este turno.`);
        return;
    }

    if (obtenerIndicesCartasDisponibles(cartasOponenteEnJuego).length === 0) {
        escribirLog('No hay objetivos enemigos en mesa.');
        finalizarTurnoJugador();
        return;
    }

    atacanteSeleccionado = slotIndex;
    escribirLog(`Atacante seleccionado: ${cartasJugadorEnJuego[slotIndex].Nombre}. Elige un objetivo.`);
    renderizarTablero();
}

async function resolverAtaque(cartasAtacante, slotAtacante, cartasObjetivo, slotObjetivo, nombreAtacante, nombreObjetivo, tipoObjetivo, divisorDanioAtacante = 1) {
    const { cartasConBonus: atacanteConBonus } = aplicarBonusAfiliaciones(cartasAtacante);
    const { cartasConBonus: objetivoConBonus } = aplicarBonusAfiliaciones(cartasObjetivo);
    const poderAtacante = obtenerPoderCartaFinal(atacanteConBonus[slotAtacante]);
    const poderDanioAtacante = divisorDanioAtacante > 1
        ? Math.max(1, Math.floor(poderAtacante / divisorDanioAtacante))
        : poderAtacante;
    const saludObjetivo = obtenerSaludActualCarta(objetivoConBonus[slotObjetivo]);
    const saludRestante = Math.max(saludObjetivo - poderDanioAtacante, 0);
    const danioInfligido = Math.min(poderDanioAtacante, saludObjetivo);

    mostrarDanioFlotante(tipoObjetivo, slotObjetivo, danioInfligido);

    escribirLog(`${nombreAtacante} golpea a ${nombreObjetivo} con ${poderDanioAtacante} de daño.`);
    await animarBajadaSaludCarta(cartasObjetivo, slotObjetivo, saludObjetivo, saludRestante, tipoObjetivo);

    if (saludRestante <= 0) {
        cartasObjetivo[slotObjetivo] = null;
        escribirLog(`${nombreObjetivo} es derrotada y sale del tablero.`);
    } else {
        cartasObjetivo[slotObjetivo].SaludMax = obtenerSaludMaxCarta(cartasObjetivo[slotObjetivo]);
        cartasObjetivo[slotObjetivo].Salud = saludRestante;
        escribirLog(`${nombreObjetivo} sobrevive con ${saludRestante} de salud.`);
    }
}

function quedanAtaquesJugadorDisponibles() {
    const hayObjetivos = obtenerIndicesCartasDisponibles(cartasOponenteEnJuego).length > 0;
    if (!hayObjetivos) {
        return false;
    }

    return obtenerIndicesCartasDisponibles(cartasJugadorEnJuego)
        .some(index => !cartasQueYaAtacaron.includes(index));
}

function seleccionarCartaObjetivo(slotIndex) {
    if (partidaFinalizada || turnoActual !== 'jugador' || atacanteSeleccionado === null) {
        return;
    }

    if (!cartasOponenteEnJuego[slotIndex]) {
        return;
    }

    const slotAtacante = atacanteSeleccionado;
    const cartaAtacante = cartasJugadorEnJuego[slotAtacante];
    const cartaObjetivo = cartasOponenteEnJuego[slotIndex];

    cartaJugadorDestacada = slotAtacante;
    cartaOponenteDestacada = slotIndex;
    renderizarTablero();

    setTimeout(async () => {
        await resolverAtaque(
            cartasJugadorEnJuego,
            slotAtacante,
            cartasOponenteEnJuego,
            slotIndex,
            cartaAtacante.Nombre,
            cartaObjetivo.Nombre,
            'oponente'
        );

        cartasQueYaAtacaron.push(slotAtacante);
        atacanteSeleccionado = null;
        
        setTimeout(() => {
            limpiarDestacados();
            renderizarTablero();

            if (verificarFinDePartida()) {
                return;
            }

            if (!quedanAtaquesJugadorDisponibles()) {
                finalizarTurnoJugador();
                return;
            }

            escribirLog('Selecciona otra carta aliada para continuar tu turno.');
        }, 760);
    }, 540);
}

function elegirObjetivoBot() {
    const { cartasConBonus: cartasJugadorConBonus } = aplicarBonusAfiliaciones(cartasJugadorEnJuego);
    const indicesObjetivo = obtenerIndicesCartasDisponibles(cartasJugadorEnJuego);

    if (indicesObjetivo.length === 0) {
        return null;
    }

    return indicesObjetivo.reduce((mejorIndice, indiceActual) => {
        if (mejorIndice === null) {
            return indiceActual;
        }

        return obtenerPoderCartaFinal(cartasJugadorConBonus[indiceActual]) < obtenerPoderCartaFinal(cartasJugadorConBonus[mejorIndice])
            ? indiceActual
            : mejorIndice;
    }, null);
}

async function ejecutarAtaqueBot(indiceSecuencia = 0, atacantes = null) {
    if (partidaFinalizada) {
        return;
    }

    const atacantesDisponibles = atacantes || obtenerIndicesCartasDisponibles(cartasOponenteEnJuego);

    if (indiceSecuencia >= atacantesDisponibles.length) {
        finalizarTurnoOponente();
        return;
    }

    const slotAtacante = atacantesDisponibles[indiceSecuencia];
    const cartaAtacante = cartasOponenteEnJuego[slotAtacante];

    if (!cartaAtacante) {
        await ejecutarAtaqueBot(indiceSecuencia + 1, atacantesDisponibles);
        return;
    }

    const cantidadAtaques = esCartaBoss(cartaAtacante) ? 3 : 1;

    for (let ataqueActual = 0; ataqueActual < cantidadAtaques; ataqueActual++) {
        const slotObjetivo = elegirObjetivoBot();
        if (slotObjetivo === null) {
            break;
        }

        const cartaObjetivo = cartasJugadorEnJuego[slotObjetivo];
        cartaOponenteDestacada = slotAtacante;
        cartaJugadorDestacada = slotObjetivo;
        renderizarTablero();

        escribirLog(
            `${cartaAtacante.Nombre} prepara el ataque ${ataqueActual + 1}${cantidadAtaques > 1 ? `/${cantidadAtaques}` : ''} sobre ${cartaObjetivo.Nombre}.`
        );
        await esperar(760);

        if (partidaFinalizada || !cartasOponenteEnJuego[slotAtacante] || !cartasJugadorEnJuego[slotObjetivo]) {
            limpiarDestacados();
            renderizarTablero();
            return;
        }

        await resolverAtaque(
            cartasOponenteEnJuego,
            slotAtacante,
            cartasJugadorEnJuego,
            slotObjetivo,
            cartaAtacante.Nombre,
            cartaObjetivo.Nombre,
            'jugador',
            esCartaBoss(cartaAtacante) ? 8 : 1
        );

        await esperar(700);
        limpiarDestacados();
        renderizarTablero();

        if (verificarFinDePartida()) {
            return;
        }
    }

    await esperar(420);
    await ejecutarAtaqueBot(indiceSecuencia + 1, atacantesDisponibles);
}

async function iniciarTurnoJugador() {
    if (partidaFinalizada) {
        return;
    }

    turnoActual = 'jugador';
    atacanteSeleccionado = null;
    cartasQueYaAtacaron = [];

    actualizarTextoTurno('Tu turno');
    mostrarAvisoTurno('Es tu turno');
    escribirLog('Comienza tu turno.');

    await rellenarSlotsVacios(mazoJugador, cartasJugadorEnJuego, 'jugador');
    renderizarTablero();

    if (verificarFinDePartida()) {
        return;
    }

    if (obtenerIndicesCartasDisponibles(cartasJugadorEnJuego).length === 0) {
        escribirLog('No tienes cartas disponibles para atacar.');
        finalizarTurnoJugador();
        return;
    }

    if (obtenerIndicesCartasDisponibles(cartasOponenteEnJuego).length === 0) {
        escribirLog('El BOT no tiene cartas en mesa. Pasas turno.');
        finalizarTurnoJugador();
        return;
    }

    escribirLog('Selecciona una de tus cartas y después el objetivo enemigo.');
}

async function iniciarTurnoOponente() {
    if (partidaFinalizada) {
        return;
    }

    turnoActual = 'oponente';
    atacanteSeleccionado = null;
    cartasQueYaAtacaron = [];
    limpiarDestacados();

    actualizarTextoTurno('Turno del BOT');
    mostrarAvisoTurno('Turno del BOT');
    escribirLog('Comienza el turno del BOT.');

    await rellenarSlotsVacios(mazoOponente, cartasOponenteEnJuego, 'oponente');
    renderizarTablero();

    if (verificarFinDePartida()) {
        return;
    }

    if (obtenerIndicesCartasDisponibles(cartasOponenteEnJuego).length === 0) {
        escribirLog('El BOT no tiene cartas disponibles para atacar.');
        finalizarTurnoOponente();
        return;
    }

    if (obtenerIndicesCartasDisponibles(cartasJugadorEnJuego).length === 0) {
        escribirLog('No tienes cartas en mesa. El BOT pasa turno.');
        finalizarTurnoOponente();
        return;
    }

    ejecutarAtaqueBot();
}

function sacarCarta() {
    escribirLog('Las cartas se roban automaticamente al inicio de cada turno.');
}

function abandonarPartida() {
    window.location.href = 'vistaJuego.html';
}

function reiniciarPartida() {
    const mazoJugadorBase = localStorage.getItem('mazoJugadorBase');
    const mazoOponenteBase = localStorage.getItem('mazoOponenteBase');

    if (mazoJugadorBase) {
        localStorage.setItem('mazoJugador', mazoJugadorBase);
    }

    if (mazoOponenteBase) {
        localStorage.setItem('mazoOponente', mazoOponenteBase);
    }

    localStorage.removeItem('partidaRecompensada');
    location.reload();
}

function volverAlMenu() {
    window.location.href = 'vistaJuego.html';
}

document.addEventListener('DOMContentLoaded', () => {
    configurarNombresTablero();
    cargarCartasIniciales();
});
