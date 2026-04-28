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
let cementerioJugador = [];
let cementerioOponente = [];
const DEBUG_COMBATE_ACTIVO = true;

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
const ICONO_MONEDA = '/resources/icons/moneda.png';
const COOLDOWN_HABILIDAD_ACTIVA_TURNOS = 2;

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

function obtenerMetaHabilidad(carta) {
    if (!carta) {
        return { tieneHabilidad: false, trigger: null, clase: '', nombre: '', info: '', powerRaw: null };
    }

    if (typeof window.obtenerMetaHabilidadCarta === 'function') {
        return window.obtenerMetaHabilidadCarta(carta);
    }

    const triggerRaw = String(carta.skill_trigger || '').trim().toLowerCase();
    const trigger = triggerRaw === 'usar' ? 'usar' : (triggerRaw === 'auto' ? 'auto' : null);
    const nombre = String(carta.skill_name || '').trim();
    const info = String(carta.skill_info || '').trim();
    const claseRaw = String(carta.skill_class || '').trim().toLowerCase();
    const clase = claseRaw === 'heall_all' ? 'heal_all' : claseRaw;
    return {
        tieneHabilidad: Boolean(trigger && nombre && clase),
        trigger,
        clase,
        nombre,
        info,
        powerRaw: carta.skill_power
    };
}

function obtenerValorNumericoSkillPower(carta, fallback = 0) {
    if (typeof window.obtenerSkillPowerNumericoCarta === 'function') {
        return window.obtenerSkillPowerNumericoCarta(carta, {
            fallback,
            poder: obtenerPoderCartaFinal(carta),
            salud: obtenerSaludActualCarta(carta)
        });
    }
    return fallback;
}

function registrarCartaDerrotada(carta, propietario) {
    if (!carta) {
        return;
    }
    const copia = {
        ...carta,
        Salud: 0,
        escudoActual: 0,
        habilidadAutoAplicadaEnJuego: false
    };
    if (propietario === 'jugador') {
        cementerioJugador.push(copia);
    } else {
        cementerioOponente.push(copia);
    }
}

function obtenerIndiceTankActivo(cartas) {
    for (let i = 0; i < cartas.length; i++) {
        const c = cartas[i];
        if (c?.tankActiva && cartaCuentaComoActivaEnMesa(c)) {
            return i;
        }
    }
    return null;
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
            saludBase: Number(carta.Salud ?? carta.salud ?? carta.Poder ?? 0),
            skill_name: String(carta.skill_name || '').trim(),
            skill_info: String(carta.skill_info || '').trim(),
            skill_class: String(carta.skill_class || '').trim().toLowerCase(),
            skill_power: carta.skill_power ?? '',
            skill_trigger: String(carta.skill_trigger || '').trim().toLowerCase()
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
        const skillName = String(carta.skill_name || '').trim() || datosCatalogo.skill_name || '';
        const skillInfo = String(carta.skill_info || '').trim() || datosCatalogo.skill_info || '';
        const skillClass = String(carta.skill_class || '').trim().toLowerCase() || datosCatalogo.skill_class || '';
        const skillTrigger = String(carta.skill_trigger || '').trim().toLowerCase() || datosCatalogo.skill_trigger || '';
        const skillPower = carta.skill_power ?? datosCatalogo.skill_power ?? '';
        const usaSkillPowerCatalogo = (carta.skill_power === undefined || carta.skill_power === null || String(carta.skill_power).trim() === '');

        const saludEscalada = calcularSaludEscaladaDesdeCatalogo(carta, datosCatalogo);
        const saludNormalizada = saludEscalada;

        const cartaEnriquecida = {
            ...carta,
            faccion: faccionFinal,
            Afiliacion: afiliacionFinal,
            skill_name: skillName,
            skill_info: skillInfo,
            skill_class: skillClass,
            skill_power: skillPower,
            skill_trigger: skillTrigger,
            SaludMax: saludEscalada,
            Salud: saludNormalizada,
            escudoActual: Math.max(0, Number(carta.escudoActual || 0)),
            poderModHabilidad: Number(carta.poderModHabilidad || 0),
            habilidadUsadaPartida: false,
            habilidadCooldownRestante: Math.max(0, Number(carta.habilidadCooldownRestante || 0)),
            habilidadAutoAplicadaEnJuego: Boolean(carta.habilidadAutoAplicadaEnJuego),
            tankActiva: Boolean(carta.tankActiva)
        };
        if (typeof window.recalcularSkillPowerPorNivel === 'function') {
            window.recalcularSkillPowerPorNivel(
                cartaEnriquecida,
                Number(cartaEnriquecida.Nivel || 1),
                { rawEsBase: usaSkillPowerCatalogo }
            );
        }
        return cartaEnriquecida;
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
                aplicarHabilidadAutoSiCorresponde(cartasOponenteEnJuego[index], 'oponente');
            }
        });
        renderizarTablero();
        escribirLog('Un nuevo grupo enemigo entra al combate.');
        return true;
    }

    if (estadoDesafio.bossPendiente) {
        cartasOponenteEnJuego = [null, crearCartaCombateDesdeMazo(estadoDesafio.bossPendiente), null];
        aplicarHabilidadAutoSiCorresponde(cartasOponenteEnJuego[1], 'oponente');
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
        .filter(carta => Boolean(carta) && !esCartaBoss(carta) && cartaCuentaComoActivaEnMesa(carta))
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

function aplicarBonusAfiliaciones(cartas, cartasEnemigas = []) {
    const { bonusMaximo, afiliacionesActivas, afiliacionPrincipal } = calcularBonusAfiliaciones(cartas);
    const debuffGlobal = (Array.isArray(cartasEnemigas) ? cartasEnemigas : []).reduce((total, carta) => {
        if (!carta || !cartaCuentaComoActivaEnMesa(carta)) return total;
        const meta = obtenerMetaHabilidad(carta);
        if (meta.tieneHabilidad && meta.trigger === 'auto' && meta.clase === 'debuff') {
            return total + Math.max(0, Number(obtenerValorNumericoSkillPower(carta, 0)));
        }
        return total;
    }, 0);
    const pasivaBuffExtra = cartas.reduce((total, carta) => {
        if (!carta || !cartaCuentaComoActivaEnMesa(carta)) return total;
        const meta = obtenerMetaHabilidad(carta);
        if (meta.tieneHabilidad && meta.trigger === 'auto' && meta.clase === 'buff') {
            return total + Math.max(0, Number(obtenerValorNumericoSkillPower(carta, 0)));
        }
        return total;
    }, 0);
    const pasivaBonusBuffExtra = cartas.reduce((total, carta) => {
        if (!carta || !cartaCuentaComoActivaEnMesa(carta)) return total;
        const meta = obtenerMetaHabilidad(carta);
        if (meta.tieneHabilidad && meta.trigger === 'auto' && meta.clase === 'bonus_buff') {
            return total + Math.max(0, Number(obtenerValorNumericoSkillPower(carta, 0)));
        }
        return total;
    }, 0);
    const bonusBuffExtra = pasivaBuffExtra + pasivaBonusBuffExtra;
    const anulaBonusAfiliacion = (Array.isArray(cartasEnemigas) ? cartasEnemigas : []).some(carta => {
        if (!carta || !cartaCuentaComoActivaEnMesa(carta)) return false;
        const meta = obtenerMetaHabilidad(carta);
        return meta.tieneHabilidad && meta.trigger === 'auto' && meta.clase === 'bonus_debuff';
    });

    const cartasConBonus = cartas.map(carta => {
        if (!carta) {
            return null;
        }

        const poderBase = Number(carta.Poder || 0);
        const modHabilidad = Number(carta.poderModHabilidad || 0) + bonusBuffExtra - debuffGlobal;
        const poderBaseConHabilidad = poderBase + modHabilidad;

        if (esCartaBoss(carta)) {
            return {
                ...carta,
                poderBaseAfiliacion: poderBaseConHabilidad,
                bonusAfiliacion: 0,
                poderFinalAfiliacion: poderBaseConHabilidad
            };
        }

        const afiliacionesCarta = new Set(
            obtenerAfiliacionesCarta(carta).map(normalizarAfiliacion).filter(Boolean)
        );
        const recibeBonus = Boolean(afiliacionPrincipal?.afiliacion) && afiliacionesCarta.has(afiliacionPrincipal.afiliacion);
        const bonusBuffAplicado = (recibeBonus && bonusMaximo > 0) ? bonusBuffExtra : 0;
        const bonusBuffSoloUiAfiliacion = (recibeBonus && bonusMaximo > 0) ? pasivaBonusBuffExtra : 0;
        const bonusEsperado = recibeBonus ? (bonusMaximo + bonusBuffAplicado) : 0;
        const bonusAplicado = (recibeBonus && !anulaBonusAfiliacion) ? bonusEsperado : 0;
        const bonusCancelado = recibeBonus && anulaBonusAfiliacion ? bonusEsperado : 0;

        return {
            ...carta,
            poderBaseAfiliacion: poderBaseConHabilidad,
            poderModHabilidadVisual: modHabilidad,
            bonusAfiliacionBase: recibeBonus ? bonusMaximo : 0,
            bonusBuffAplicado,
            bonusBuffSoloUiAfiliacion,
            bonusEsperadoAfiliacion: bonusEsperado,
            bonusCanceladoAfiliacion: bonusCancelado,
            bonusAfiliacion: bonusAplicado,
            poderFinalAfiliacion: poderBaseConHabilidad + bonusAplicado
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

    const finalNum = Number(carta.poderFinalAfiliacion);
    if (Number.isFinite(finalNum)) {
        return finalNum;
    }

    const baseAf = Number(carta.poderBaseAfiliacion);
    const bonAf = Number(carta.bonusAfiliacion || 0);
    if (Number.isFinite(baseAf)) {
        return baseAf + (Number.isFinite(bonAf) ? bonAf : 0);
    }

    const poder = Number(carta.Poder || 0);
    const modVis = Number(carta.poderModHabilidadVisual);
    if (Number.isFinite(modVis)) {
        const bon = Number(carta.bonusAfiliacion || 0);
        return poder + modVis + (Number.isFinite(bon) ? bon : 0);
    }

    return poder;
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

function cartaCuentaComoActivaEnMesa(carta) {
    if (!carta) {
        return false;
    }
    const salud = obtenerSaludActualCarta(carta);
    const escudo = Math.max(0, Number(carta.escudoActual || 0));
    return salud + escudo > 0;
}

function obtenerFactorDebuffSaludDesdeEnemigos(cartasEnemigas) {
    if (!Array.isArray(cartasEnemigas)) {
        return 1;
    }
    const cantidadDebuffs = cartasEnemigas.filter(carta => {
        if (!carta || !cartaCuentaComoActivaEnMesa(carta)) {
            return false;
        }
        const meta = obtenerMetaHabilidad(carta);
        return meta.tieneHabilidad && meta.trigger === 'auto' && meta.clase === 'heal_debuff';
    }).length;
    if (cantidadDebuffs <= 0) {
        return 1;
    }
    return Math.max(0.1, Math.pow(0.75, cantidadDebuffs));
}

function obtenerSaludEfectiva(carta, cartasEnemigas) {
    if (!carta) {
        return { saludActual: 0, saludMax: 0, escudo: 0, totalActual: 0, totalMax: 0 };
    }
    const factorDebuff = obtenerFactorDebuffSaludDesdeEnemigos(cartasEnemigas);
    const saludMaxBase = obtenerSaludMaxCarta(carta);
    const saludActualBase = obtenerSaludActualCarta(carta);
    const saludMaxEfectiva = Math.max(1, Math.round(saludMaxBase * factorDebuff));
    const saludActualEfectiva = Math.max(0, Math.min(saludActualBase, saludMaxEfectiva));
    const escudo = Math.max(0, Number(carta.escudoActual || 0));
    return {
        saludActual: saludActualEfectiva,
        saludMax: saludMaxEfectiva,
        escudo,
        totalActual: saludActualEfectiva + escudo,
        totalMax: saludMaxEfectiva + escudo
    };
}

function crearCartaCombateDesdeMazo(carta) {
    if (!carta) {
        return null;
    }

    const cartaCombate = { ...carta };
    const saludMax = obtenerSaludMaxCarta(cartaCombate);
    cartaCombate.SaludMax = saludMax;
    cartaCombate.Salud = Number.isFinite(Number(cartaCombate.Salud))
        ? Math.max(0, Math.min(Number(cartaCombate.Salud), saludMax))
        : saludMax;
    cartaCombate.escudoActual = Math.max(0, Number(cartaCombate.escudoActual || 0));
    cartaCombate.poderModHabilidad = Number(cartaCombate.poderModHabilidad || 0);
    cartaCombate.habilidadUsadaPartida = false;
    cartaCombate.habilidadCooldownRestante = Math.max(0, Number(cartaCombate.habilidadCooldownRestante || 0));
    cartaCombate.habilidadAutoAplicadaEnJuego = false;
    cartaCombate.tankActiva = Boolean(cartaCombate.tankActiva);
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
    escribirDebug('LOG', { mensaje, clase });
}

function asegurarPanelDebug() {
    if (!DEBUG_COMBATE_ACTIVO) {
        return;
    }
    if (document.getElementById('debug-combate-textarea')) {
        return;
    }

    const logsContainer = document.querySelector('.logs-container');
    if (!logsContainer) {
        return;
    }

    const titulo = document.createElement('h4');
    titulo.className = 'debug-combate-titulo';
    titulo.textContent = 'Debug Combate';

    const textarea = document.createElement('textarea');
    textarea.id = 'debug-combate-textarea';
    textarea.className = 'debug-combate-textarea';
    textarea.readOnly = true;
    textarea.spellcheck = false;

    logsContainer.appendChild(titulo);
    logsContainer.appendChild(textarea);
}

function resumirCartaDebug(carta, cartasEnemigasParaSaludEfectiva = null) {
    if (!carta) return null;
    const meta = obtenerMetaHabilidad(carta);
    const res = {
        nombre: carta.Nombre,
        poder: obtenerPoderCartaFinal(carta),
        salud: obtenerSaludActualCarta(carta),
        saludMax: obtenerSaludMaxCarta(carta),
        escudo: Number(carta.escudoActual || 0),
        skill: meta.tieneHabilidad ? `${meta.trigger}:${meta.clase}` : 'none',
        cdHabilidad: Math.max(0, Number(carta.habilidadCooldownRestante || 0)),
        tank: Boolean(carta.tankActiva)
    };
    if (Array.isArray(cartasEnemigasParaSaludEfectiva)) {
        const eff = obtenerSaludEfectiva(carta, cartasEnemigasParaSaludEfectiva);
        res.saludEfectiva = eff.totalActual;
        res.saludMaxEfectiva = eff.totalMax;
    }
    return res;
}

function snapshotTableroDebug() {
    return {
        turno: turnoActual,
        jugador: cartasJugadorEnJuego.map(c => resumirCartaDebug(c, cartasOponenteEnJuego)),
        oponente: cartasOponenteEnJuego.map(c => resumirCartaDebug(c, cartasJugadorEnJuego)),
        mazoJugador: mazoJugador.length,
        mazoOponente: mazoOponente.length,
        cementerioJugador: cementerioJugador.length,
        cementerioOponente: cementerioOponente.length
    };
}

function escribirDebug(tag, payload = null) {
    if (!DEBUG_COMBATE_ACTIVO) {
        return;
    }
    const area = document.getElementById('debug-combate-textarea');
    if (!area) {
        return;
    }
    const hora = new Date().toLocaleTimeString();
    const linea = `[${hora}] ${tag}${payload ? ` :: ${JSON.stringify(payload)}` : ''}`;
    area.value = `${area.value}${linea}\n`;
    const maxChars = 22000;
    if (area.value.length > maxChars) {
        area.value = area.value.slice(area.value.length - maxChars);
    }
    area.scrollTop = area.scrollHeight;
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

function mostrarValorFlotante(tipo, slotIndex, valor, claseVisual = 'danio') {
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
    if (claseVisual === 'cura') {
        danioDiv.classList.add('cura');
        danioDiv.textContent = `${Math.max(0, Math.floor(Number(valor) || 0))}`;
    } else {
        danioDiv.textContent = `-${Math.max(0, Math.floor(Number(valor) || 0))}`;
    }
    danioDiv.style.left = `${centroX}px`;
    danioDiv.style.top = `${centroY}px`;
    document.body.appendChild(danioDiv);

    setTimeout(() => {
        danioDiv.remove();
    }, 1200);
}

async function animarBajadaSaludCarta(cartasObjetivo, slotObjetivo, saludRawInicial, saludRawFinal, tipoObjetivo) {
    const carta = cartasObjetivo[slotObjetivo];
    if (!carta) {
        return;
    }

    const saludInicial = Math.max(0, Number(saludRawInicial || 0));
    const saludFinal = Math.max(0, Number(saludRawFinal || 0));

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
    if (typeof window.recalcularSkillPowerPorNivel === 'function') {
        window.recalcularSkillPowerPorNivel(cartaEscalada, dificultadObjetivo, { rawEsBase: true });
    }

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
    cartaBoss.Poder = Math.round(poderBase + incrementoPorNivel);
    const saludBossActual = Math.round((saludBase * 8) + incrementoPorNivel);
    cartaBoss.SaludMax = Math.round(saludBossActual * 1.75);
    cartaBoss.Salud = cartaBoss.SaludMax;
    cartaBoss.esBoss = true;
    if (typeof window.recalcularSkillPowerPorNivel === 'function') {
        window.recalcularSkillPowerPorNivel(cartaBoss, dificultadObjetivo, { rawEsBase: true });
    }

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

    // Guardar progreso: eventos y desafios se rastrean por separado para evitar cruces de IDs.
    usuario.desafiosCompletados = Array.isArray(usuario.desafiosCompletados)
        ? usuario.desafiosCompletados.map(id => Number(id)).filter(Number.isFinite)
        : [];
    usuario.desafiosCompletadosV2 = Array.isArray(usuario.desafiosCompletadosV2)
        ? usuario.desafiosCompletadosV2.map(id => Number(id)).filter(Number.isFinite)
        : [];

    const idDesafio = Number(desafioActivo?.id);
    const esEvento = desafioActivo?.tipo === 'evento';

    if (!esEvento && Number.isFinite(idDesafio) && !usuario.desafiosCompletados.includes(idDesafio)) {
        usuario.desafiosCompletados.push(idDesafio);
    }
    if (!esEvento && Number.isFinite(idDesafio) && !usuario.desafiosCompletadosV2.includes(idDesafio)) {
        usuario.desafiosCompletadosV2.push(idDesafio);
    }

    if (esEvento) {
        const claveRotacionEvento = String(desafioActivo?.rotacionClave || '').trim();
        if (claveRotacionEvento) {
            usuario.eventosJugadosPorRotacion = (usuario.eventosJugadosPorRotacion && typeof usuario.eventosJugadosPorRotacion === 'object')
                ? usuario.eventosJugadosPorRotacion
                : {};
            const jugadosActual = new Set(
                (usuario.eventosJugadosPorRotacion[claveRotacionEvento] || []).map(id => Number(id))
            );
            jugadosActual.add(Number(idDesafio));
            usuario.eventosJugadosPorRotacion[claveRotacionEvento] = Array.from(jugadosActual);
        }
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

    contenedor.appendChild(crearCartaElemento(carta, 'recompensa', -1).root);
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

function formatoPuntosConMoneda(valor) {
    return `${Number(valor || 0)} <img src="${ICONO_MONEDA}" alt="Moneda" style="width:18px;height:18px;object-fit:contain;vertical-align:text-bottom;margin-left:4px;">`;
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

function mostrarAvisoHabilidad(texto) {
    mostrarAvisoTurno(texto);
}

function obtenerCartaBonusDebuffActiva(cartas = []) {
    return (Array.isArray(cartas) ? cartas : []).find(carta => {
        if (!carta || !cartaCuentaComoActivaEnMesa(carta)) return false;
        const meta = obtenerMetaHabilidad(carta);
        return meta.tieneHabilidad && meta.trigger === 'auto' && meta.clase === 'bonus_debuff';
    }) || null;
}

function abrirModalSeleccionHabilidad({
    titulo = 'Selecciona objetivo',
    cartas = [],
    textoConfirmar = 'Confirmar',
    textoCancelar = 'Cancelar',
    tipoCartaTablero = 'jugador',
    enemigosParaSalud = null
}) {
    return new Promise(resolve => {
        const modal = document.getElementById('modal-seleccion-habilidad');
        const tituloEl = document.getElementById('modal-habilidad-titulo');
        const listaEl = document.getElementById('modal-habilidad-lista');
        const btnConfirmar = document.getElementById('modal-habilidad-confirmar');
        const btnCancelar = document.getElementById('modal-habilidad-cancelar');
        if (!modal || !tituloEl || !listaEl || !btnConfirmar || !btnCancelar) {
            resolve(null);
            return;
        }

        let indiceSeleccionado = null;
        tituloEl.textContent = titulo;
        btnConfirmar.textContent = textoConfirmar;
        btnCancelar.textContent = textoCancelar;
        btnConfirmar.disabled = true;
        listaEl.replaceChildren();

        const enemigosSalud = enemigosParaSalud !== undefined && enemigosParaSalud !== null
            ? enemigosParaSalud
            : (tipoCartaTablero === 'jugador' ? cartasOponenteEnJuego : cartasJugadorEnJuego);

        const limpiar = () => {
            btnConfirmar.onclick = null;
            btnCancelar.onclick = null;
            modal.style.display = 'none';
        };

        cartas.forEach(item => {
            const cartaEl = document.createElement('div');
            cartaEl.className = 'modal-habilidad-carta';
            const slotInner = document.createElement('div');
            slotInner.className = 'modal-habilidad-carta-slot';
            const { root } = crearCartaElemento(item.carta, tipoCartaTablero, item.index, {
                soloVista: true,
                enemigosParaSalud: enemigosSalud
            });
            slotInner.appendChild(root);
            cartaEl.appendChild(slotInner);
            cartaEl.addEventListener('click', () => {
                indiceSeleccionado = item.index;
                btnConfirmar.disabled = false;
                Array.from(listaEl.children).forEach(h => h.classList.remove('seleccionada'));
                cartaEl.classList.add('seleccionada');
            });
            listaEl.appendChild(cartaEl);
        });

        btnConfirmar.onclick = () => {
            limpiar();
            resolve(indiceSeleccionado);
        };
        btnCancelar.onclick = () => {
            limpiar();
            resolve(null);
        };
        modal.style.display = 'flex';
    });
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

function obtenerSlotsAliados(propietario) {
    return propietario === 'jugador' ? cartasJugadorEnJuego : cartasOponenteEnJuego;
}

function obtenerSlotsEnemigos(propietario) {
    return propietario === 'jugador' ? cartasOponenteEnJuego : cartasJugadorEnJuego;
}

function obtenerTipoObjetivoPorPropietario(propietarioObjetivo) {
    return propietarioObjetivo === 'jugador' ? 'jugador' : 'oponente';
}

function aplicarHabilidadAutoSiCorresponde(carta, propietario) {
    if (!carta) {
        return;
    }
    const meta = obtenerMetaHabilidad(carta);
    if (!meta.tieneHabilidad || meta.trigger !== 'auto' || carta.habilidadAutoAplicadaEnJuego) {
        return;
    }
    escribirDebug('SKILL_AUTO_INTENTO', { propietario, carta: carta.Nombre, clase: meta.clase, skill: meta.nombre });

    const valor = Math.max(0, Number(obtenerValorNumericoSkillPower(carta, 0)));
    if (meta.clase === 'buff' && valor > 0) {
        escribirLog(`${carta.Nombre} activa ${meta.nombre}: +${valor} poder aliado.`);
    } else if (meta.clase === 'debuff' && valor > 0) {
        escribirLog(`${carta.Nombre} activa ${meta.nombre}: -${valor} poder global.`);
    } else if (meta.clase === 'bonus_buff' || meta.clase === 'bonus_debuff' || meta.clase === 'heal_debuff') {
        escribirLog(`${carta.Nombre} activa pasiva ${meta.nombre}.`);
    }

    carta.habilidadAutoAplicadaEnJuego = true;
    escribirDebug('SKILL_AUTO_OK', { propietario, carta: carta.Nombre, clase: meta.clase, estado: snapshotTableroDebug() });
}

function reducirCooldownHabilidadesActivas(propietario) {
    const aliados = obtenerSlotsAliados(propietario);
    aliados.forEach(carta => {
        if (!carta) {
            return;
        }
        const meta = obtenerMetaHabilidad(carta);
        if (!meta.tieneHabilidad || meta.trigger !== 'usar') {
            return;
        }
        const cd = Math.max(0, Number(carta.habilidadCooldownRestante || 0));
        carta.habilidadCooldownRestante = Math.max(0, cd - 1);
    });
}

function sincronizarPasivasAutoEnMesa() {
    cartasJugadorEnJuego.forEach(carta => aplicarHabilidadAutoSiCorresponde(carta, 'jugador'));
    cartasOponenteEnJuego.forEach(carta => aplicarHabilidadAutoSiCorresponde(carta, 'oponente'));
}

function obtenerIndicesAliadosDisponibles(propietario) {
    return obtenerIndicesCartasDisponibles(obtenerSlotsAliados(propietario));
}

function elegirAliadoMasHerido(propietario) {
    const aliados = obtenerSlotsAliados(propietario);
    const enemigos = obtenerSlotsEnemigos(propietario);
    const indices = obtenerIndicesCartasDisponibles(aliados);
    if (indices.length === 0) return null;
    return indices.reduce((peor, idx) => {
        const estado = obtenerSaludEfectiva(aliados[idx], enemigos);
        const ratio = estado.totalMax > 0 ? estado.totalActual / estado.totalMax : 1;
        if (peor === null) return { idx, ratio };
        return ratio < peor.ratio ? { idx, ratio } : peor;
    }, null)?.idx ?? null;
}

async function usarHabilidadActiva(carta, propietario, slotCarta) {
    const meta = obtenerMetaHabilidad(carta);
    const cooldownActual = Math.max(0, Number(carta.habilidadCooldownRestante || 0));
    if (!meta.tieneHabilidad || meta.trigger !== 'usar' || cooldownActual > 0) {
        return false;
    }
    escribirDebug('SKILL_USAR_INTENTO', { propietario, slot: slotCarta, carta: carta.Nombre, clase: meta.clase, skill: meta.nombre });

    const valor = Math.max(0, Number(obtenerValorNumericoSkillPower(carta, 0)));
    const aliados = obtenerSlotsAliados(propietario);
    const enemigos = obtenerSlotsEnemigos(propietario);
    const tipoObjetivoEnemigo = obtenerTipoObjetivoPorPropietario(propietario === 'jugador' ? 'oponente' : 'jugador');

    if (meta.clase === 'heal') {
        if (valor <= 0) return false;
        const { cartasConBonus: aliadosConBonus } = aplicarBonusAfiliaciones(aliados, enemigos);
        const disponibles = obtenerIndicesCartasDisponibles(aliados).map(index => ({
            index,
            carta: aliadosConBonus[index]
        }));
        if (disponibles.length === 0) return false;
        const idx = propietario === 'jugador'
            ? await abrirModalSeleccionHabilidad({
                titulo: `Curar con ${carta.Nombre}`,
                cartas: disponibles,
                textoConfirmar: 'Curar',
                textoCancelar: 'Cancelar',
                tipoCartaTablero: 'jugador',
                enemigosParaSalud: enemigos
            })
            : elegirAliadoMasHerido(propietario);
        if (idx === null || idx === undefined || !aliados[idx]) return false;
        const objetivo = aliados[idx];
        const saludAntes = obtenerSaludActualCarta(objetivo);
        const saludMax = obtenerSaludMaxCarta(objetivo);
        objetivo.Salud = Math.min(saludMax, saludAntes + Math.floor(valor));
        const curado = Math.max(0, objetivo.Salud - saludAntes);
        if (curado <= 0) return false;
        mostrarAvisoHabilidad(`Curando a "${objetivo.Nombre}"`);
        if (propietario === 'oponente') {
            mostrarAvisoHabilidad(`"${carta.Nombre}" utiliza la habilidad "${meta.nombre}" en "${objetivo.Nombre}"`);
        }
        mostrarValorFlotante(propietario, idx, curado, 'cura');
        escribirLog(`${carta.Nombre} usa ${meta.nombre} y cura ${curado} a ${objetivo.Nombre}.`);
    } else if (meta.clase === 'revive') {
        const cementerio = propietario === 'jugador' ? cementerioJugador : cementerioOponente;
        const mazo = propietario === 'jugador' ? mazoJugador : mazoOponente;
        if (cementerio.length === 0) return false;
        let indiceCementerio = null;
        if (propietario === 'jugador') {
            const opciones = cementerio.map((cartaCementerio, index) => ({ index, carta: cartaCementerio }));
            indiceCementerio = await abrirModalSeleccionHabilidad({
                titulo: `Revivir con ${carta.Nombre}`,
                cartas: opciones,
                textoConfirmar: 'Revivir Carta',
                textoCancelar: 'Cancelar',
                tipoCartaTablero: 'jugador',
                enemigosParaSalud: []
            });
        } else {
            indiceCementerio = cementerio
                .map((c, i) => ({ c, i }))
                .sort((a, b) => Number(b.c.Poder || 0) - Number(a.c.Poder || 0))[0]?.i ?? null;
        }
        if (indiceCementerio === null || indiceCementerio === undefined) return false;
        const cartaRevive = cementerio.splice(indiceCementerio, 1)[0];
        if (!cartaRevive) return false;
        mazo.push({ ...cartaRevive, Salud: obtenerSaludMaxCarta(cartaRevive), escudoActual: 0, habilidadAutoAplicadaEnJuego: false });
        if (propietario === 'oponente') {
            mostrarAvisoHabilidad(`"${carta.Nombre}" utiliza la habilidad "${meta.nombre}" en "${cartaRevive.Nombre}"`);
        }
        escribirLog(`${carta.Nombre} usa ${meta.nombre} y revive a ${cartaRevive.Nombre} al mazo.`);
    } else if (meta.clase === 'shield') {
        if (valor <= 0) return false;
        const { cartasConBonus: aliadosConBonusShield } = aplicarBonusAfiliaciones(aliados, enemigos);
        const disponibles = obtenerIndicesCartasDisponibles(aliados).map(index => ({
            index,
            carta: aliadosConBonusShield[index]
        }));
        if (disponibles.length === 0) return false;
        const idx = propietario === 'jugador'
            ? await abrirModalSeleccionHabilidad({
                titulo: `Escudo con ${carta.Nombre}`,
                cartas: disponibles,
                textoConfirmar: 'Aplicar Escudo',
                textoCancelar: 'Cancelar',
                tipoCartaTablero: 'jugador',
                enemigosParaSalud: enemigos
            })
            : elegirAliadoMasHerido(propietario);
        if (idx === null || idx === undefined || !aliados[idx]) return false;
        const objetivo = aliados[idx];
        objetivo.escudoActual = Math.max(0, Number(objetivo.escudoActual || 0)) + Math.floor(valor);
        if (propietario === 'oponente') {
            mostrarAvisoHabilidad(`"${carta.Nombre}" utiliza la habilidad "${meta.nombre}" en "${objetivo.Nombre}"`);
        }
        escribirLog(`${carta.Nombre} usa ${meta.nombre}: escudo +${Math.floor(valor)} para ${objetivo.Nombre}.`);
    } else if (meta.clase === 'aoe') {
        mostrarAvisoHabilidad(`${carta.Nombre} va a realizar un ataque multiple`);
        if (propietario === 'oponente') {
            mostrarAvisoHabilidad(`"${carta.Nombre}" utiliza la habilidad "${meta.nombre}" en "todo el equipo rival"`);
        }
        const { cartasConBonus: aliadosConBonusAoe } = aplicarBonusAfiliaciones(aliados, enemigos);
        const cartaAoeConBonus = aliadosConBonusAoe[slotCarta] || carta;
        const poderFuenteAoe = obtenerPoderCartaFinal(cartaAoeConBonus);
        const danioAoe = Math.max(1, Math.floor(valor || (poderFuenteAoe / 2)));
        const objetivos = obtenerIndicesCartasDisponibles(enemigos);
        if (objetivos.length === 0) return false;
        for (const idx of objetivos) {
            await resolverAtaque(
                aliados,
                slotCarta,
                enemigos,
                idx,
                carta.Nombre,
                enemigos[idx].Nombre,
                tipoObjetivoEnemigo,
                danioAoe / Math.max(poderFuenteAoe, 1)
            );
        }
        escribirLog(`${carta.Nombre} desata ${meta.nombre} e impacta a todo el equipo enemigo.`);
    } else if (meta.clase === 'heal_all') {
        mostrarAvisoHabilidad(`${carta.Nombre} va a realizar un ataque multiple`);
        if (propietario === 'oponente') {
            mostrarAvisoHabilidad(`"${carta.Nombre}" utiliza la habilidad "${meta.nombre}" en "todo su equipo"`);
        }
        if (valor <= 0) return false;
        aliados.forEach(objetivo => {
            if (!objetivo) return;
            const idxObjetivo = aliados.indexOf(objetivo);
            const saludAntes = obtenerSaludActualCarta(objetivo);
            const saludMax = obtenerSaludMaxCarta(objetivo);
            objetivo.Salud = Math.min(saludMax, saludAntes + Math.floor(valor));
            const curado = Math.max(0, objetivo.Salud - saludAntes);
            if (curado > 0 && idxObjetivo >= 0) {
                mostrarValorFlotante(propietario, idxObjetivo, curado, 'cura');
            }
        });
        escribirLog(`${carta.Nombre} usa ${meta.nombre}: cura grupal +${Math.floor(valor)}.`);
    } else if (meta.clase === 'tank') {
        if (carta.tankActiva) return false;
        mostrarAvisoHabilidad(`${carta.Nombre} cambia a modo Tank`);
        if (propietario === 'oponente') {
            mostrarAvisoHabilidad(`"${carta.Nombre}" utiliza la habilidad "${meta.nombre}" en "${carta.Nombre}"`);
        }
        carta.tankActiva = true;
        const saludMaxAnterior = obtenerSaludMaxCarta(carta);
        carta.SaludMax = Math.max(1, saludMaxAnterior * 2);
        carta.Salud = Math.min(carta.SaludMax, obtenerSaludActualCarta(carta) + saludMaxAnterior);
        carta.poderModHabilidad = Number(carta.poderModHabilidad || 0) - Math.floor(Number(carta.Poder || 0) * 0.5);
        escribirLog(`${carta.Nombre} activa ${meta.nombre}: modo tanque activo.`);
    } else if (meta.clase === 'extra_attack') {
        mostrarAvisoHabilidad(`${carta.Nombre} va a realizar un ataque adicional`);
        let idx = (() => {
            const indices = obtenerIndicesCartasDisponibles(enemigos);
            if (indices.length === 0) return null;
            const tankActivo = obtenerIndiceTankActivo(enemigos);
            if (tankActivo !== null) return tankActivo;
            if (propietario === 'jugador') {
                return null;
            }
            return elegirAliadoMasHerido('jugador');
        })();
        if (propietario === 'jugador') {
            const tankActivo = obtenerIndiceTankActivo(enemigos);
            const indicesElegibles = tankActivo !== null
                ? [tankActivo]
                : obtenerIndicesCartasDisponibles(enemigos);
            const { cartasConBonus: enemigosConBonusExtra } = aplicarBonusAfiliaciones(enemigos, aliados);
            const disponibles = indicesElegibles.map(index => ({
                index,
                carta: enemigosConBonusExtra[index]
            }));
            idx = await abrirModalSeleccionHabilidad({
                titulo: `Objetivo para ataque adicional de ${carta.Nombre}`,
                cartas: disponibles,
                textoConfirmar: 'Atacar',
                textoCancelar: 'Cancelar',
                tipoCartaTablero: 'oponente',
                enemigosParaSalud: aliados
            });
        }
        if (idx === null) return false;
        const objetivo = enemigos[idx];
        if (propietario === 'oponente') {
            mostrarAvisoHabilidad(`"${carta.Nombre}" utiliza la habilidad "${meta.nombre}" en "${objetivo.Nombre}"`);
        }
        await resolverAtaque(
            aliados,
            slotCarta,
            enemigos,
            idx,
            carta.Nombre,
            objetivo.Nombre,
            tipoObjetivoEnemigo,
            1
        );
        escribirLog(`${carta.Nombre} usa ${meta.nombre} y ejecuta un ataque extra.`);
    } else {
        return false;
    }

    carta.habilidadCooldownRestante = COOLDOWN_HABILIDAD_ACTIVA_TURNOS;
    renderizarTablero();
    escribirDebug('SKILL_USAR_OK', { propietario, carta: carta.Nombre, clase: meta.clase, estado: snapshotTableroDebug() });
    return true;
}

async function manejarUsoHabilidadJugador(event, slotIndex) {
    event?.preventDefault?.();
    event?.stopPropagation?.();

    if (partidaFinalizada || turnoActual !== 'jugador') {
        return;
    }
    if (cartasQueYaAtacaron.includes(slotIndex)) {
        escribirLog(`${cartasJugadorEnJuego[slotIndex]?.Nombre || 'Esta carta'} ya actuó en este turno.`);
        return;
    }

    const carta = cartasJugadorEnJuego[slotIndex];
    if (!carta) {
        return;
    }
    const meta = obtenerMetaHabilidad(carta);
    if (!meta.tieneHabilidad || meta.trigger !== 'usar') {
        return;
    }
    const cooldownActual = Math.max(0, Number(carta.habilidadCooldownRestante || 0));
    if (cooldownActual > 0) {
        escribirLog(`${carta.Nombre} tiene la habilidad en cooldown (${cooldownActual} turno(s)).`);
        return;
    }

    const usada = await usarHabilidadActiva(carta, 'jugador', slotIndex);
    if (!usada) {
        escribirLog(`No se pudo usar ${meta.nombre} en este momento.`);
        return;
    }

    atacanteSeleccionado = null;

    if (verificarFinDePartida()) {
        return;
    }
    if (!quedanAtaquesJugadorDisponibles()) {
        finalizarTurnoJugador();
        return;
    }

    renderizarTablero();
    escribirLog(`${carta.Nombre} usó ${meta.nombre}. Puedes seguir actuando con otra carta.`);
}

function crearCartaElemento(carta, tipo, slotIndex, opciones = {}) {
    const soloVista = Boolean(opciones.soloVista);
    const cartasEnemigas = opciones.enemigosParaSalud !== undefined
        ? opciones.enemigosParaSalud
        : (tipo === 'jugador' ? cartasOponenteEnJuego : cartasJugadorEnJuego);

    const cartaDiv = document.createElement('div');
    cartaDiv.classList.add('carta');
    if (soloVista) {
        cartaDiv.classList.add('carta-solo-vista');
    }
    if (Number(carta?.Nivel || 1) >= 6) {
        cartaDiv.classList.add('nivel-legendaria');
    }
    if (esCartaBoss(carta)) {
        cartaDiv.classList.add('boss-carta');
        if (!soloVista) {
            cartaDiv.style.transform = 'scale(1.12)';
            cartaDiv.style.boxShadow = '0 0 22px rgba(255, 66, 66, 0.9), 0 0 34px rgba(255, 205, 66, 0.65)';
            cartaDiv.style.border = '2px solid rgba(255, 130, 66, 0.95)';
            cartaDiv.style.zIndex = '5';
        } else {
            cartaDiv.style.boxShadow = '0 0 14px rgba(255, 90, 70, 0.55), 0 0 22px rgba(255, 190, 66, 0.35)';
            cartaDiv.style.border = '1px solid rgba(255, 130, 90, 0.75)';
        }
    }

    const imagenUrl = obtenerImagenCarta(carta);
    cartaDiv.style.backgroundImage = `url(${imagenUrl})`;
    cartaDiv.style.backgroundSize = 'cover';
    cartaDiv.style.backgroundPosition = 'center';

    if (!soloVista) {
        if (tipo === 'jugador' && turnoActual === 'jugador' && !cartasQueYaAtacaron.includes(slotIndex)) {
            cartaDiv.style.cursor = 'pointer';
            cartaDiv.addEventListener('click', () => seleccionarCartaAtacante(slotIndex));
        }

        if (tipo === 'jugador' && cartasQueYaAtacaron.includes(slotIndex)) {
            cartaDiv.classList.add('carta-agotada');
        }

        if (!soloVista && tipo === 'oponente' && turnoActual === 'jugador' && atacanteSeleccionado !== null) {
            const tankIdx = obtenerIndiceTankActivo(cartasOponenteEnJuego);
            if (tankIdx !== null && slotIndex !== tankIdx) {
                cartaDiv.classList.add('carta-bloqueada-por-tank');
            } else {
                cartaDiv.style.cursor = 'pointer';
                cartaDiv.addEventListener('click', () => seleccionarCartaObjetivo(slotIndex));
            }
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
    const penalizacionTankVisual = carta?.tankActiva
        ? Math.floor(Number(carta.Poder || 0) * 0.5)
        : 0;
    const modHabilidad = Number((carta?.poderModHabilidadVisual ?? carta?.poderModHabilidad) || 0) + penalizacionTankVisual;
    const bonusAfiliacionBase = Number(carta?.bonusAfiliacionBase || 0);
    const bonusBuffSoloUiAfiliacion = Number(carta?.bonusBuffSoloUiAfiliacion || 0);
    const bonusCancelado = Number(carta?.bonusCanceladoAfiliacion || 0);
    if (bonusAfiliacionBase > 0 && bonusCancelado <= 0) {
        poderSpan.style.color = '#FFD700';
    }

    detallesDiv.appendChild(nombreSpan);
    detallesDiv.appendChild(poderSpan);
    if (modHabilidad !== 0) {
        const modSpan = document.createElement('span');
        modSpan.className = `modificador-poder ${modHabilidad > 0 ? 'mod-buff' : 'mod-debuff'}`;
        modSpan.textContent = `(${modHabilidad > 0 ? '+' : ''}${modHabilidad})`;
        detallesDiv.appendChild(modSpan);
    }
    if (bonusBuffSoloUiAfiliacion > 0 && bonusCancelado <= 0) {
        const bonusSpan = document.createElement('span');
        bonusSpan.className = 'modificador-poder mod-bonus-buff';
        bonusSpan.textContent = `(+${bonusBuffSoloUiAfiliacion})`;
        detallesDiv.appendChild(bonusSpan);
    } else if (bonusCancelado > 0) {
        const cancelSpan = document.createElement('span');
        cancelSpan.className = 'modificador-poder mod-bonus-debuff';
        cancelSpan.textContent = `(-${bonusCancelado})`;
        detallesDiv.appendChild(cancelSpan);
    }

    const factorDebuffHeal = obtenerFactorDebuffSaludDesdeEnemigos(cartasEnemigas);
    const estadoSalud = obtenerSaludEfectiva(carta, cartasEnemigas);
    const saludActual = estadoSalud.totalActual;
    const saludMax = Math.max(estadoSalud.totalMax, 1);
    const porcentajeSalud = Math.max(0, Math.min((saludActual / saludMax) * 100, 100));
    const ratioSalud = porcentajeSalud / 100;

    const barraSaludContenedor = document.createElement('div');
    barraSaludContenedor.classList.add('barra-salud-contenedor');
    if (factorDebuffHeal < 1) {
        barraSaludContenedor.classList.add('barra-salud--debuff-salud');
    }

    const barraSaludRelleno = document.createElement('div');
    barraSaludRelleno.classList.add('barra-salud-relleno');
    if (estadoSalud.escudo > 0) {
        barraSaludRelleno.classList.add('con-escudo');
    }
    barraSaludRelleno.style.width = `${porcentajeSalud}%`;
    barraSaludRelleno.style.setProperty('--health-ratio', String(ratioSalud));

    const saludSpan = document.createElement('span');
    saludSpan.classList.add('salud-carta');
    saludSpan.textContent = `${saludActual}/${saludMax}`;

    barraSaludContenedor.appendChild(barraSaludRelleno);
    barraSaludContenedor.appendChild(saludSpan);

    const saludStack = document.createElement('div');
    saludStack.className = 'carta-salud-bloque';
    if (factorDebuffHeal < 1) {
        const marcadorDebuff = document.createElement('span');
        marcadorDebuff.className = 'estado-heal-debuff';
        marcadorDebuff.textContent = `-${Math.round((1 - factorDebuffHeal) * 100)}%`;
        saludStack.appendChild(marcadorDebuff);
    }
    saludStack.appendChild(barraSaludContenedor);

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
    const badgeHabilidad = window.crearBadgeHabilidadCarta ? window.crearBadgeHabilidadCarta(carta) : null;
    if (badgeHabilidad) {
        cartaDiv.appendChild(badgeHabilidad);
    }
    const badgeAfiliacion = window.crearBadgeAfiliacionCarta ? window.crearBadgeAfiliacionCarta(carta) : null;
    if (badgeAfiliacion) {
        cartaDiv.appendChild(badgeAfiliacion);
    }
    if (carta?.tankActiva) {
        const tankBadge = document.createElement('div');
        tankBadge.className = 'badge-tank-carta';
        tankBadge.textContent = '(TANK)';
        cartaDiv.appendChild(tankBadge);
    }
    cartaDiv.appendChild(saludStack);
    cartaDiv.appendChild(estrellasDiv);

    const metaHabilidad = obtenerMetaHabilidad(carta);
    let usarHabilidad = null;
    if (!soloVista && tipo === 'jugador' && metaHabilidad.tieneHabilidad && metaHabilidad.trigger === 'usar') {
        const botonHabilidad = document.createElement('button');
        botonHabilidad.type = 'button';
        botonHabilidad.className = 'btn-habilidad-uso';
        const cooldownActual = Math.max(0, Number(carta.habilidadCooldownRestante || 0));
        botonHabilidad.textContent = cooldownActual > 0
            ? `Cooldown: ${cooldownActual} ${cooldownActual === 1 ? 'turno' : 'turnos'}`
            : 'Usar Habilidad';
        botonHabilidad.disabled = Boolean(
            cooldownActual > 0
            || partidaFinalizada
            || turnoActual !== 'jugador'
            || cartasQueYaAtacaron.includes(slotIndex)
        );
        botonHabilidad.addEventListener('click', (event) => manejarUsoHabilidadJugador(event, slotIndex));
        usarHabilidad = botonHabilidad;
    }

    return { root: cartaDiv, usarHabilidad };
}

function mostrarCartaEnSlot(slot, carta, tipo, slotIndex) {
    slot.innerHTML = '';

    if (!carta) {
        return;
    }

    const { root, usarHabilidad } = crearCartaElemento(carta, tipo, slotIndex);
    if (usarHabilidad) {
        const inner = document.createElement('div');
        inner.className = 'slot-combate-inner';
        inner.appendChild(root);
        inner.appendChild(usarHabilidad);
        slot.appendChild(inner);
    } else {
        slot.appendChild(root);
    }
}

function actualizarPoderVisual() {
    const { cartasConBonus: cartasJugadorConBonus } = aplicarBonusAfiliaciones(cartasJugadorEnJuego, cartasOponenteEnJuego);
    const { cartasConBonus: cartasOponenteConBonus } = aplicarBonusAfiliaciones(cartasOponenteEnJuego, cartasJugadorEnJuego);
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
    const anulaJugador = obtenerCartaBonusDebuffActiva(cartasOponenteEnJuego);
    const anulaOponente = obtenerCartaBonusDebuffActiva(cartasJugadorEnJuego);

    const actualizar = (id, selectorJugador, afiliacionActiva, anulador = null) => {
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
            if (anulador) {
                linea.className = 'bonus-anulado-item';
                linea.textContent = `Bonus Anulado por "${anulador.Nombre}": ${formatearEtiquetaAfiliacion(afiliacionActiva.afiliacion)} (+${afiliacionActiva.bonus})`;
            } else {
                linea.className = 'bonus-activo-item';
                linea.textContent = `Bonus activo: ${formatearEtiquetaAfiliacion(afiliacionActiva.afiliacion)} (+${afiliacionActiva.bonus})`;
            }
            contenedor.appendChild(linea);
        }
    };

    actualizar('bonus-activo-oponente', '.jugador-oponente', activaOponente, anulaOponente);
    actualizar('bonus-activo-jugador', '.jugador-propio', activaJugador, anulaJugador);
}

function renderizarTablero() {
    // Garantiza que cualquier carta recién entrada en mesa active su pasiva AUTO
    // antes de recalcular poder/vida efectiva y pintar el tablero.
    sincronizarPasivasAutoEnMesa();

    const { cartasConBonus: cartasJugadorConBonus } = aplicarBonusAfiliaciones(cartasJugadorEnJuego, cartasOponenteEnJuego);
    const { cartasConBonus: cartasOponenteConBonus } = aplicarBonusAfiliaciones(cartasOponenteEnJuego, cartasJugadorEnJuego);

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
            aplicarHabilidadAutoSiCorresponde(cartasEnJuego[i], propietario);
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
    const { cartasConBonus: cartasJugadorConBonus } = aplicarBonusAfiliaciones(cartasJugador, cartasOponente);
    const { cartasConBonus: cartasOponenteConBonus } = aplicarBonusAfiliaciones(cartasOponente, cartasJugador);
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
    cementerioJugador = [];
    cementerioOponente = [];
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
        aplicarHabilidadAutoSiCorresponde(cartasJugadorEnJuego[i], 'jugador');
        renderizarTablero();
        const slotJ = document.getElementById(`slot-jugador-${i + 1}`);
        slotJ?.querySelector('.carta')?.classList.add('carta-entrada');
        await esperar(250); // Delay entre cartas

        // Carta Oponente
        cartasOponenteEnJuego[i] = inicialesOponente[i] || null;
        aplicarHabilidadAutoSiCorresponde(cartasOponenteEnJuego[i], 'oponente');
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
            resumenDesafio.innerHTML = `Recompensas del desafío: ${formatoPuntosConMoneda(recompensaDesafio.puntosGanados)}.`;
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
            resumen.innerHTML = `Recompensas: ${formatoPuntosConMoneda(recompensa.puntosGanados)} y ${recompensa.cartasGanadas.length} cartas nuevas.`;
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
        puntosTotales.innerHTML = `Puntos totales: ${formatoPuntosConMoneda(totalPuntos)}.`;
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

async function seleccionarCartaAtacante(slotIndex) {
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

async function resolverAtaque(cartasAtacante, slotAtacante, cartasObjetivo, slotObjetivo, nombreAtacante, nombreObjetivo, tipoObjetivo, multiplicadorDanioAtacante = 1) {
    const { cartasConBonus: atacanteConBonus } = aplicarBonusAfiliaciones(cartasAtacante, cartasObjetivo);
    const propietarioAtacante = cartasAtacante === cartasJugadorEnJuego ? 'jugador' : 'oponente';
    const cartasEnemigasObjetivo = propietarioAtacante === 'jugador' ? cartasJugadorEnJuego : cartasOponenteEnJuego;
    const { cartasConBonus: objetivoConBonus } = aplicarBonusAfiliaciones(cartasObjetivo, cartasAtacante);
    const poderAtacante = obtenerPoderCartaFinal(atacanteConBonus[slotAtacante]);
    const poderDanioAtacante = Math.max(
        1,
        Math.round(poderAtacante * Math.max(0, Number(multiplicadorDanioAtacante) || 0))
    );
    const objetivoBase = cartasObjetivo[slotObjetivo];
    const estadoAntes = obtenerSaludEfectiva(objetivoConBonus[slotObjetivo], cartasEnemigasObjetivo);
    const saludObjetivo = estadoAntes.totalActual;
    const saludRawAntes = obtenerSaludActualCarta(objetivoBase);
    let escudoRestante = Math.max(0, Number(objetivoBase?.escudoActual || 0));
    let saludRestanteBase = saludRawAntes;
    let danioRestante = poderDanioAtacante;

    if (escudoRestante > 0) {
        const absorbidoEscudo = Math.min(escudoRestante, danioRestante);
        escudoRestante -= absorbidoEscudo;
        danioRestante -= absorbidoEscudo;
    }

    if (danioRestante > 0) {
        saludRestanteBase = Math.max(0, saludRestanteBase - danioRestante);
    }

    const cartaEstadoFin = { ...objetivoConBonus[slotObjetivo], Salud: saludRestanteBase, escudoActual: escudoRestante };
    const estadoFin = obtenerSaludEfectiva(cartaEstadoFin, cartasEnemigasObjetivo);
    const estadoDespuesTotal = estadoFin.totalActual;
    const danioInfligido = Math.min(poderDanioAtacante, saludObjetivo);
    escribirDebug('ATAQUE', {
        atacante: nombreAtacante,
        objetivo: nombreObjetivo,
        mult: multiplicadorDanioAtacante,
        poderAtacante,
        danio: poderDanioAtacante,
        vidaObjetivoAntes: saludObjetivo,
        vidaObjetivoDespues: estadoDespuesTotal,
        escudoRestante
    });

    mostrarValorFlotante(tipoObjetivo, slotObjetivo, danioInfligido, 'danio');

    escribirLog(`${nombreAtacante} golpea a ${nombreObjetivo} con ${poderDanioAtacante} de daño.`);
    if (Number(objetivoBase?.escudoActual || 0) > 0 || escudoRestante > 0) {
        cartasObjetivo[slotObjetivo].escudoActual = escudoRestante;
        cartasObjetivo[slotObjetivo].Salud = saludRestanteBase;
        renderizarTablero();
    } else {
        await animarBajadaSaludCarta(cartasObjetivo, slotObjetivo, saludRawAntes, saludRestanteBase, tipoObjetivo);
    }

    if (estadoFin.totalActual <= 0) {
        registrarCartaDerrotada(cartasObjetivo[slotObjetivo], tipoObjetivo === 'jugador' ? 'jugador' : 'oponente');
        cartasObjetivo[slotObjetivo] = null;
        escribirLog(`${nombreObjetivo} es derrotada y sale del tablero.`);
    } else {
        cartasObjetivo[slotObjetivo].SaludMax = obtenerSaludMaxCarta(cartasObjetivo[slotObjetivo]);
        cartasObjetivo[slotObjetivo].Salud = saludRestanteBase;
        cartasObjetivo[slotObjetivo].escudoActual = escudoRestante;
        escribirLog(`${nombreObjetivo} sobrevive con ${estadoDespuesTotal} de vida total.`);
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

    const tankOponente = obtenerIndiceTankActivo(cartasOponenteEnJuego);
    if (tankOponente !== null && slotIndex !== tankOponente) {
        escribirLog(`Debes atacar a ${cartasOponenteEnJuego[tankOponente].Nombre} (Tanque activo).`);
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
    const tankJugador = obtenerIndiceTankActivo(cartasJugadorEnJuego);
    if (tankJugador !== null) {
        return tankJugador;
    }

    const { cartasConBonus: cartasJugadorConBonus } = aplicarBonusAfiliaciones(cartasJugadorEnJuego, cartasOponenteEnJuego);
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

function elegirObjetivosBotAleatorios(cantidadObjetivos) {
    const tankJugador = obtenerIndiceTankActivo(cartasJugadorEnJuego);
    if (tankJugador !== null) {
        return Array.from({ length: Math.max(1, cantidadObjetivos) }, () => tankJugador);
    }

    const indicesObjetivo = obtenerIndicesCartasDisponibles(cartasJugadorEnJuego);
    if (indicesObjetivo.length === 0) {
        return [];
    }

    const objetivosMezclados = [...indicesObjetivo];
    for (let i = objetivosMezclados.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [objetivosMezclados[i], objetivosMezclados[j]] = [objetivosMezclados[j], objetivosMezclados[i]];
    }

    return objetivosMezclados.slice(0, Math.max(0, cantidadObjetivos));
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

    const metaHabilidadAtacante = obtenerMetaHabilidad(cartaAtacante);
    if (
        metaHabilidadAtacante.tieneHabilidad
        && metaHabilidadAtacante.trigger === 'usar'
        && Math.max(0, Number(cartaAtacante.habilidadCooldownRestante || 0)) <= 0
    ) {
        await usarHabilidadActiva(cartaAtacante, 'oponente', slotAtacante);
    }

    const esBossAtacante = esCartaBoss(cartaAtacante);
    const objetivosAtaque = esBossAtacante
        ? elegirObjetivosBotAleatorios(2)
        : [elegirObjetivoBot()];
    const multiplicadorDanio = esBossAtacante ? 0.75 : 1;

    for (let ataqueActual = 0; ataqueActual < objetivosAtaque.length; ataqueActual++) {
        const slotObjetivo = objetivosAtaque[ataqueActual];
        if (slotObjetivo === null) {
            break;
        }

        const cartaObjetivo = cartasJugadorEnJuego[slotObjetivo];
        cartaOponenteDestacada = slotAtacante;
        cartaJugadorDestacada = slotObjetivo;
        renderizarTablero();

        escribirLog(
            `${cartaAtacante.Nombre} prepara el ataque ${ataqueActual + 1}${objetivosAtaque.length > 1 ? `/${objetivosAtaque.length}` : ''} sobre ${cartaObjetivo.Nombre}.`
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
            multiplicadorDanio
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
    reducirCooldownHabilidadesActivas('jugador');

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
    reducirCooldownHabilidadesActivas('oponente');

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
    asegurarPanelDebug();
    configurarNombresTablero();
    cargarCartasIniciales();
    escribirDebug('INIT', { desafioActivo: obtenerDesafioActivo(), estado: snapshotTableroDebug() });
});
