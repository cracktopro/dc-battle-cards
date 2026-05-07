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
const DEBUG_COMBATE_ACTIVO = false;
const MENSAJE_SALIDA_PARTIDA = 'Hay una partida en curso. ¿Seguro que quieres abandonar esta vista?';
let proteccionSalidaActiva = true;

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
const PVP_SESSION_ID = String(localStorage.getItem('partidaPvpSessionId') || '').trim();
const HAY_DESAFIO_ACTIVO_STORAGE = (() => {
    try {
        const raw = localStorage.getItem('desafioActivo');
        return Boolean(raw && raw !== 'null' && raw !== 'undefined');
    } catch (_error) {
        return false;
    }
})();
const ES_MODO_PVP = !HAY_DESAFIO_ACTIVO_STORAGE
    && (
        String(localStorage.getItem('partidaModo') || '').trim().toLowerCase() === 'pvp'
        || Boolean(PVP_SESSION_ID)
    );
const EMAIL_SESION_ACTUAL = String(localStorage.getItem('email') || '').trim().toLowerCase();
const ROL_PVP = String(localStorage.getItem('partidaPvpRol') || 'A').trim().toUpperCase() === 'B' ? 'B' : 'A';
const PVP_DEBUG_UI = String(localStorage.getItem('pvpDebugUI') || 'false').trim().toLowerCase() === 'true';
let socketPvp = null;
let esMiTurnoPvp = false;
let resultadoPvpEmitido = false;
let aplicandoSnapshotPvp = false;
let revisionPvpLocal = 0;
let ultimoEventoPvp = '';
let pvpDespliegueTableroListo = !ES_MODO_PVP;
let pvpTurnoPendienteDesdeSocket = null;
let pvpUltimoTurnEmailSocket = '';
let pvpUltimoTurnEmailSocketTs = 0;
let cartasYaActuaronOponentePvp = [];
let atacanteSeleccionadoOponentePvp = null;
let accionesExtraPvpLocal = 0;
let accionesExtraOponentePvp = 0;
let pvpPendienteEmitirFinTurno = false;
let pvpFinTurnoFallbackTimer = null;
let pvpFinTurnoDelayTimer = null;
let pvpTurnoJugadorYaPreparado = false;
let pvpUltimaAccionRecibidaTs = 0;
let pvpRetrasoHabilidadHastaTs = 0;
let pvpEstadoProcesando = false;
let pvpTurnoSocketPendiente = null;
let pvpEstadoPayloadPendiente = null;
let pvpTurnoAplicacionTimer = null;
let pvpAvisoHabilidadTimer = null;
let pvpUltimaAccionPayload = null;
let pvpMantenerOpacidadFinTurno = false;
let pvpResetDestacadosTimer = null;
let pvpCartasAgotadasConfirmadas = [];
const pvpAccionesPorRevision = new Map();
const pvpRevisionWaiters = [];
const PVP_RETARDO_CAMBIO_TURNO_MS = 900;
const PVP_RETARDO_ROBO_TRAS_BAJA_MS = 700;
const PVP_RETARDO_EFECTO_HABILIDAD_MS = 3200;
const PVP_RETARDO_MENSAJE_HABILIDAD_MS = 500;
const PVP_RETARDO_PRE_IMPACTO_ATAQUE_MS = 700;
const PVP_RETARDO_POST_IMPACTO_ATAQUE_MS = 700;
const PVP_RETARDO_POST_BAJA_MS = 700;
/** Tras letal + robo en el mismo slot, dar tiempo a que termine la animación de barra antes de pintar el snapshot. */
const PVP_RETARDO_ANTES_SNAPSHOT_TRAS_REFILL_MS = 380;
const RETARDO_MODAL_FIN_PARTIDA_MS = 700;

function despacharWaitersRevisionPvp() {
    const rev = Number(revisionPvpLocal || 0);
    for (let i = pvpRevisionWaiters.length - 1; i >= 0; i -= 1) {
        const w = pvpRevisionWaiters[i];
        if (rev > w.desde) {
            w.resolve(rev);
            pvpRevisionWaiters.splice(i, 1);
        }
    }
}

function esperarRevisionPvpMayorQue(revisionInicial, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const desde = Number(revisionInicial || 0);
        if (Number(revisionPvpLocal) > desde) {
            resolve(Number(revisionPvpLocal));
            return;
        }
        const obj = { desde, resolve, reject };
        const to = setTimeout(() => {
            const idx = pvpRevisionWaiters.indexOf(obj);
            if (idx !== -1) {
                pvpRevisionWaiters.splice(idx, 1);
            }
            reject(new Error('pvp_revision_timeout'));
        }, timeoutMs);
        obj.cancel = () => {
            clearTimeout(to);
            const idx = pvpRevisionWaiters.indexOf(obj);
            if (idx !== -1) {
                pvpRevisionWaiters.splice(idx, 1);
            }
        };
        pvpRevisionWaiters.push(obj);
    });
}

function refrescarEtiquetasTurnoPvpDesdeEmail(turnEmailRaw) {
    const turnEmail = String(turnEmailRaw || '').trim().toLowerCase();
    if (!turnEmail) {
        return;
    }
    const esMio = turnEmail === EMAIL_SESION_ACTUAL;
    turnoActual = esMio ? 'jugador' : 'oponente';
    const nombreTurno = esMio ? obtenerNombreVisibleJugador() : obtenerNombreVisibleOponente();
    actualizarTextoTurno(`Turno de ${nombreTurno}`);
    mostrarAvisoTurno(`Turno de ${nombreTurno}`);
    renderizarTablero();
}

async function animarDaniosTrasSnapshotPvp(prevJ, prevO) {
    if (!ES_MODO_PVP || partidaFinalizada) {
        return;
    }
    const pulsoBarra = async (tipo, slotIndex) => {
        const idSlot = obtenerIdSlot(tipo, slotIndex);
        const slot = document.getElementById(idSlot);
        const barra = slot?.querySelector('.barra-salud-contenedor');
        if (!barra) return;
        barra.classList.add('recibiendo-danio');
        await esperar(260);
        barra.classList.remove('recibiendo-danio');
    };
    for (let i = 0; i < 3; i += 1) {
        const antes = prevO[i];
        const desp = cartasOponenteEnJuego[i];
        if (!antes) {
            continue;
        }
        if (!desp) {
            const salAnt = obtenerSaludActualCarta(antes);
            const danioFinal = Math.max(1, salAnt);
            cartasOponenteEnJuego[i] = {
                ...antes,
                SaludMax: obtenerSaludMaxCarta(antes),
                Salud: salAnt,
                escudoActual: 0
            };
            renderizarTablero();
            mostrarValorFlotante('oponente', i, danioFinal, 'danio');
            await animarBajadaSaludCarta(cartasOponenteEnJuego, i, salAnt, 0, 'oponente');
            cartasOponenteEnJuego[i] = null;
            renderizarTablero();
            continue;
        }
        const salAnt = obtenerSaludActualCarta(antes);
        const salPost = obtenerSaludActualCarta(desp);
        if (salAnt > salPost) {
            const d = salAnt - salPost;
            mostrarValorFlotante('oponente', i, d, 'danio');
            await pulsoBarra('oponente', i);
        } else if (salPost > salAnt) {
            mostrarValorFlotante('oponente', i, salPost - salAnt, 'cura');
        }
    }
    for (let i = 0; i < 3; i += 1) {
        const antes = prevJ[i];
        const desp = cartasJugadorEnJuego[i];
        if (!antes) {
            continue;
        }
        if (!desp) {
            const salAnt = obtenerSaludActualCarta(antes);
            const danioFinal = Math.max(1, salAnt);
            cartasJugadorEnJuego[i] = {
                ...antes,
                SaludMax: obtenerSaludMaxCarta(antes),
                Salud: salAnt,
                escudoActual: 0
            };
            renderizarTablero();
            mostrarValorFlotante('jugador', i, danioFinal, 'danio');
            await animarBajadaSaludCarta(cartasJugadorEnJuego, i, salAnt, 0, 'jugador');
            cartasJugadorEnJuego[i] = null;
            renderizarTablero();
            continue;
        }
        const salAnt = obtenerSaludActualCarta(antes);
        const salPost = obtenerSaludActualCarta(desp);
        if (salAnt > salPost) {
            const d = salAnt - salPost;
            mostrarValorFlotante('jugador', i, d, 'danio');
            await pulsoBarra('jugador', i);
        } else if (salPost > salAnt) {
            mostrarValorFlotante('jugador', i, salPost - salAnt, 'cura');
        }
    }
}

function actualizarLineaDebugPvp(msg) {
    if (!PVP_DEBUG_UI) return;
    const el = document.getElementById('pvp-debug-line');
    if (el) {
        el.textContent = msg;
    }
    const log = document.getElementById('pvp-debug-log');
    if (log) {
        const stamp = new Date().toISOString().slice(11, 23);
        log.value += `${stamp} ${msg}\n`;
        log.scrollTop = log.scrollHeight;
    }
}

function trazaAccionPvp(etapa, detalle = '') {
    if (!PVP_DEBUG_UI) return;
    const rev = Number(revisionPvpLocal || 0);
    const sufijo = detalle ? ` | ${detalle}` : '';
    actualizarLineaDebugPvp(`[ACCION:${etapa}] rev=${rev}${sufijo}`);
}

function describirAccionPvpEnLog(accion = {}, actorEmailRaw = '') {
    const tipo = String(accion?.tipo || '').trim();
    if (!tipo) return;
    const actorEmail = String(actorEmailRaw || '').trim().toLowerCase();
    const actor = actorEmail && actorEmail === EMAIL_SESION_ACTUAL ? 'Tú' : obtenerNombreVisibleOponente();
    if (tipo === 'habilidad') {
        const skill = String(accion?.debugSkillName || 'habilidad').trim();
        const caster = String(accion?.debugCasterName || actor).trim();
        const target = String(accion?.debugTargetName || '').trim();
        const detalle = target ? ` sobre ${target}` : '';
        escribirLog(`${caster} utiliza ${skill}${detalle}.`);
        return;
    }
    if (tipo === 'ataque') {
        escribirLog(`Acción de ataque recibida (${actor}). Sincronizando estado...`);
    }
}

function procesarTurnoPvpSocket(payload = {}) {
    if (!ES_MODO_PVP || partidaFinalizada) {
        return;
    }
    const turnEmail = String(payload?.turnEmail || '').trim().toLowerCase();
    esMiTurnoPvp = Boolean(turnEmail && turnEmail === EMAIL_SESION_ACTUAL);
    ultimoEventoPvp = `turno:${turnEmail || '-'}`;
    actualizarLineaDebugPvp(`Turno -> ${turnEmail || '-'}`);
    if (esMiTurnoPvp) {
        pvpMantenerOpacidadFinTurno = false;
        iniciarTurnoJugador();
        return;
    }
    pvpMantenerOpacidadFinTurno = false;
    pvpTurnoJugadorYaPreparado = false;
    turnoActual = 'oponente';
    escribirLog(`Esperando la jugada de ${obtenerNombreVisibleOponente()}...`);
    renderizarTablero();
}

function encolarOProcesarTurnoPvp(payload = {}) {
    if (!ES_MODO_PVP) {
        return;
    }
    if (pvpTurnoAplicacionTimer) {
        clearTimeout(pvpTurnoAplicacionTimer);
        pvpTurnoAplicacionTimer = null;
    }
    if (!pvpDespliegueTableroListo) {
        pvpTurnoPendienteDesdeSocket = payload;
        return;
    }
    const turnEmail = String(payload?.turnEmail || '').trim().toLowerCase();
    refrescarEtiquetasTurnoPvpDesdeEmail(turnEmail);
    const now = Date.now();
    const esMio = Boolean(turnEmail && turnEmail === EMAIL_SESION_ACTUAL);
    if (
        turnEmail
        && pvpUltimoTurnEmailSocket === turnEmail
        && now - pvpUltimoTurnEmailSocketTs < 900
    ) {
        if (esMio && turnoActual === 'jugador' && esMiTurnoPvp && pvpTurnoJugadorYaPreparado) {
            return;
        }
        if (!esMio && turnoActual === 'oponente' && !esMiTurnoPvp) {
            return;
        }
    }
    const msDesdeUltimaAccion = now - Number(pvpUltimaAccionRecibidaTs || 0);
    const retardoAplicacion = pvpUltimaAccionRecibidaTs > 0
        ? Math.max(0, PVP_RETARDO_CAMBIO_TURNO_MS - msDesdeUltimaAccion)
        : 0;
    const aplicarTurno = () => {
        pvpUltimoTurnEmailSocket = turnEmail;
        pvpUltimoTurnEmailSocketTs = Date.now();
        procesarTurnoPvpSocket(payload);
    };
    if (retardoAplicacion > 0) {
        pvpTurnoAplicacionTimer = setTimeout(() => {
            pvpTurnoAplicacionTimer = null;
            aplicarTurno();
        }, retardoAplicacion);
        return;
    }
    aplicarTurno();
}

async function animarEntradasMazoPvp(prevJ, prevO, proxJ, proxO) {
    const tareas = [];
    for (let i = 0; i < 3; i += 1) {
        if (!prevJ[i] && proxJ[i]) {
            tareas.push({ tipo: 'jugador', slot: i });
        }
    }
    for (let i = 0; i < 3; i += 1) {
        if (!prevO[i] && proxO[i]) {
            tareas.push({ tipo: 'oponente', slot: i });
        }
    }
    for (let i = 0; i < tareas.length; i += 1) {
        const t = tareas[i];
        const idSlot = obtenerIdSlot(t.tipo, t.slot);
        const slotEl = document.getElementById(idSlot);
        const cartaEl = slotEl?.querySelector('.carta');
        cartaEl?.classList.add('carta-entrada');
        await esperar(250);
    }
}

function obtenerLadosDesdeSnapshotPvp(snapshot = {}) {
    const jugador = ROL_PVP === 'A'
        ? (Array.isArray(snapshot?.cartasEnJuegoA) ? snapshot.cartasEnJuegoA : [])
        : (Array.isArray(snapshot?.cartasEnJuegoB) ? snapshot.cartasEnJuegoB : []);
    const oponente = ROL_PVP === 'A'
        ? (Array.isArray(snapshot?.cartasEnJuegoB) ? snapshot.cartasEnJuegoB : [])
        : (Array.isArray(snapshot?.cartasEnJuegoA) ? snapshot.cartasEnJuegoA : []);
    return { jugador, oponente };
}

function firmaCartaMesaPvp(carta) {
    if (!carta) return '';
    return `${String(carta.Nombre || '').trim()}|${Number(carta.Nivel || 0)}|${Number(carta.Poder || 0)}`;
}

/** Vacío→carta o carta distinta en la misma casilla (letales + robo en mismo slot no marcaban solo `!prev && prox`). */
function hayCambioVisualPorRoboOMesa(prevArr, proxArr) {
    if (!Array.isArray(prevArr) || !Array.isArray(proxArr)) return false;
    for (let i = 0; i < 3; i += 1) {
        const p = prevArr[i];
        const q = proxArr[i];
        if (!p && q) return true;
        if (p && q && firmaCartaMesaPvp(p) !== firmaCartaMesaPvp(q)) return true;
    }
    return false;
}

function emitirSeleccionAtacantePvp(slotAtacante = null) {
    if (!ES_MODO_PVP || !socketPvp || !PVP_SESSION_ID) {
        return;
    }
    socketPvp.emit('multiplayer:pvp:seleccionAtacante', {
        sessionId: PVP_SESSION_ID,
        slotAtacante: Number.isInteger(slotAtacante) ? slotAtacante : null
    });
}

/**
 * Índice de mesa 0–2 desde payload de red (PvP). Evita `Number(null) === 0` y `Number("") === 0`,
 * que resaltaban por error la carta izquierda al sincronizar selección/ataque del rival.
 */
function parseSlotIndicePvp(raw) {
    if (raw === null || raw === undefined || raw === '') {
        return null;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 2) {
        return null;
    }
    return n;
}

async function animarImpactoAtaquePvpConSnapshot(prevJ, prevO, proxJ, proxO, accion = {}, actorEmailRaw = '') {
    const slotObjetivo = parseSlotIndicePvp(accion?.slotObjetivo);
    if (slotObjetivo === null) {
        return;
    }
    const actorEmail = String(actorEmailRaw || '').trim().toLowerCase();
    const atacaYo = Boolean(actorEmail && actorEmail === EMAIL_SESION_ACTUAL);
    const tipoObjetivo = atacaYo ? 'oponente' : 'jugador';
    const prevArr = tipoObjetivo === 'oponente' ? prevO : prevJ;
    const proxArr = tipoObjetivo === 'oponente' ? proxO : proxJ;
    const liveArr = tipoObjetivo === 'oponente' ? cartasOponenteEnJuego : cartasJugadorEnJuego;
    const cartaAntes = prevArr[slotObjetivo];
    if (!cartaAntes) {
        return;
    }
    const cartaDespues = proxArr[slotObjetivo] || null;
    const mismaCarta = Boolean(cartaDespues && firmaCartaMesaPvp(cartaAntes) === firmaCartaMesaPvp(cartaDespues));
    const cartasEnemigasBarra = tipoObjetivo === 'jugador' ? cartasOponenteEnJuego : cartasJugadorEnJuego;

    const saludAntesHp = Math.max(0, Number(obtenerSaludActualCarta(cartaAntes) || 0));
    const escAnt = Math.max(0, Number(cartaAntes.escudoActual || 0));

    let saludDespuesHp;
    let escudoFinalAnim;
    if (!cartaDespues || !mismaCarta) {
        // Hueco vacío o carta distinta (letal + robo en el mismo slot): el snapshot ya trae la nueva carta;
        // hay que animar la bajada de la carta antigua hasta 0 antes de aplicar el estado oficial.
        saludDespuesHp = 0;
        escudoFinalAnim = 0;
    } else {
        saludDespuesHp = Math.max(0, Number(obtenerSaludActualCarta(cartaDespues) || 0));
        escudoFinalAnim = Math.max(0, Number(cartaDespues.escudoActual || 0));
    }

    const totAnt = obtenerSaludEfectiva(cartaAntes, cartasEnemigasBarra).totalActual;
    const totDesp = !cartaDespues || !mismaCarta
        ? 0
        : obtenerSaludEfectiva(cartaDespues, cartasEnemigasBarra).totalActual;

    if (totAnt <= totDesp) {
        return;
    }
    await esperar(PVP_RETARDO_PRE_IMPACTO_ATAQUE_MS);
    const danio = Math.max(1, Math.floor(totAnt - totDesp));
    mostrarValorFlotante(tipoObjetivo, slotObjetivo, danio, 'danio');
    await animarBajadaSaludCarta(liveArr, slotObjetivo, saludAntesHp, saludDespuesHp, tipoObjetivo, {
        escudoInicial: escAnt,
        escudoFinal: escudoFinalAnim
    });
    await esperar(PVP_RETARDO_POST_IMPACTO_ATAQUE_MS);
    if (!cartaDespues || !mismaCarta) {
        liveArr[slotObjetivo] = null;
        renderizarTablero();
        await esperar(PVP_RETARDO_POST_BAJA_MS);
    }
}

async function animarCambiosHabilidadPvp(prevJ, prevO, proxJ, proxO, accion = {}, actorEmailRaw = '') {
    const clase = String(accion?.debugSkillClass || '').trim().toLowerCase();
    const actorEmail = String(actorEmailRaw || '').trim().toLowerCase();
    const usaYo = Boolean(actorEmail && actorEmail === EMAIL_SESION_ACTUAL);
    if (clase === 'heal_all') {
        const tipoAliado = usaYo ? 'jugador' : 'oponente';
        const arrAntes = usaYo ? prevJ : prevO;
        const arrDespues = usaYo ? proxJ : proxO;
        const arrLive = tipoAliado === 'jugador' ? cartasJugadorEnJuego : cartasOponenteEnJuego;
        const cartasEnemigosParaEfectiva = tipoAliado === 'jugador' ? cartasOponenteEnJuego : cartasJugadorEnJuego;

        for (let i = 0; i < 3; i += 1) {
            const antes = arrAntes[i];
            const despues = arrDespues[i];
            if (!antes || !despues) continue;
            if (firmaCartaMesaPvp(antes) !== firmaCartaMesaPvp(despues)) continue;

            const totAnt = obtenerSaludEfectiva(antes, cartasEnemigosParaEfectiva).totalActual;
            const totDesp = obtenerSaludEfectiva(despues, cartasEnemigosParaEfectiva).totalActual;
            if (totDesp <= totAnt) continue;

            const salAntes = obtenerSaludActualCarta(antes);
            const salDespues = obtenerSaludActualCarta(despues);
            const escAnt = Math.max(0, Number(antes.escudoActual || 0));
            const escPost = Math.max(0, Number(despues.escudoActual || 0));

            if (!arrLive[i]) continue;
            Object.assign(arrLive[i], antes);
            arrLive[i].Salud = salAntes;
            arrLive[i].escudoActual = escAnt;

            const curaMostrar = Math.max(1, Math.floor(totDesp - totAnt));
            mostrarValorFlotante(tipoAliado, i, curaMostrar, 'cura');
            await animarBajadaSaludCarta(arrLive, i, salAntes, salDespues, tipoAliado, {
                escudoInicial: escAnt,
                escudoFinal: escPost,
                esCura: true
            });
        }
        renderizarTablero();
        return;
    }
    if (clase === 'aoe') {
        const tipoObjetivo = usaYo ? 'oponente' : 'jugador';
        const arrAntes = usaYo ? prevO : prevJ;
        const arrDespues = usaYo ? proxO : proxJ;
        const arrLive = tipoObjetivo === 'oponente' ? cartasOponenteEnJuego : cartasJugadorEnJuego;
        const cartasEnemigosParaEfectiva = tipoObjetivo === 'jugador' ? cartasOponenteEnJuego : cartasJugadorEnJuego;
        const indicesImpactados = [0, 1, 2].filter(i => {
            const antes = arrAntes[i];
            if (!antes) return false;
            const despues = arrDespues[i];
            const mismaCarta = Boolean(despues && firmaCartaMesaPvp(antes) === firmaCartaMesaPvp(despues));
            const totAnt = obtenerSaludEfectiva(antes, cartasEnemigosParaEfectiva).totalActual;
            const totPost = !despues || !mismaCarta
                ? 0
                : obtenerSaludEfectiva(despues, cartasEnemigosParaEfectiva).totalActual;
            return totAnt > totPost;
        });
        if (indicesImpactados.length === 0) {
            return;
        }
        for (let ii = 0; ii < indicesImpactados.length; ii += 1) {
            const idx = indicesImpactados[ii];
            const antes = arrAntes[idx];
            const despues = arrDespues[idx];
            const mismaCarta = Boolean(despues && firmaCartaMesaPvp(antes) === firmaCartaMesaPvp(despues));
            const salAntHp = obtenerSaludActualCarta(antes);
            const salPostHp = mismaCarta && despues ? obtenerSaludActualCarta(despues) : 0;
            const escAnt = Math.max(0, Number(antes.escudoActual || 0));
            const escPost = mismaCarta && despues ? Math.max(0, Number(despues.escudoActual || 0)) : 0;
            const totAnt = obtenerSaludEfectiva(antes, cartasEnemigosParaEfectiva).totalActual;
            const totPost = !despues || !mismaCarta
                ? 0
                : obtenerSaludEfectiva(despues, cartasEnemigosParaEfectiva).totalActual;
            const danoMostrar = Math.max(1, Math.floor(totAnt - totPost));

            if (!arrLive[idx]) {
                arrLive[idx] = { ...antes };
            } else {
                Object.assign(arrLive[idx], antes);
                arrLive[idx].Salud = salAntHp;
                arrLive[idx].escudoActual = escAnt;
            }

            mostrarValorFlotante(tipoObjetivo, idx, danoMostrar, 'danio');

            await animarBajadaSaludCarta(arrLive, idx, salAntHp, salPostHp, tipoObjetivo, {
                escudoInicial: escAnt,
                escudoFinal: escPost
            });

            if (!despues || !mismaCarta) {
                arrLive[idx] = null;
            }
        }
        renderizarTablero();
        await esperar(500);
        return;
    }

    const slotObjSkill = parseSlotIndicePvp(accion?.slotObjetivo);
    if (
        slotObjSkill !== null
        && clase !== 'heal'
        && clase !== 'shield'
        && clase !== 'revive'
    ) {
        // stun, dot, etc.: mismo problema letal + robo en el hueco que el ataque básico.
        await animarImpactoAtaquePvpConSnapshot(
            prevJ,
            prevO,
            proxJ,
            proxO,
            { slotObjetivo: slotObjSkill },
            actorEmailRaw
        );
    }
}

function completarFinTurnoPvpConRevision(revisionOficial) {
    if (!pvpPendienteEmitirFinTurno || !ES_MODO_PVP || !socketPvp || !PVP_SESSION_ID || partidaFinalizada) {
        return;
    }
    if (pvpFinTurnoDelayTimer) {
        return;
    }
    if (pvpFinTurnoFallbackTimer) {
        clearTimeout(pvpFinTurnoFallbackTimer);
        pvpFinTurnoFallbackTimer = null;
    }
    pvpFinTurnoDelayTimer = setTimeout(() => {
        pvpFinTurnoDelayTimer = null;
        if (!pvpPendienteEmitirFinTurno || !ES_MODO_PVP || !socketPvp || !PVP_SESSION_ID || partidaFinalizada) {
            return;
        }
        pvpPendienteEmitirFinTurno = false;
        const rev = Number.isInteger(Number(revisionOficial)) ? Number(revisionOficial) : Number(revisionPvpLocal || 0);
        trazaAccionPvp('emit_fin_turno', `expectedRevision=${rev}`);
        socketPvp.emit('multiplayer:pvp:finTurno', {
            sessionId: PVP_SESSION_ID,
            expectedRevision: rev
        });
    }, PVP_RETARDO_CAMBIO_TURNO_MS);
}

function programarFinTurnoPvpCuandoLlegueEstadoOficial() {
    if (!ES_MODO_PVP || !socketPvp || !PVP_SESSION_ID) {
        return;
    }
    pvpPendienteEmitirFinTurno = true;
    trazaAccionPvp('fin_turno_pendiente', 'esperando estado oficial');
    if (pvpFinTurnoFallbackTimer) {
        clearTimeout(pvpFinTurnoFallbackTimer);
    }
    pvpFinTurnoFallbackTimer = setTimeout(() => {
        pvpFinTurnoFallbackTimer = null;
        if (!pvpPendienteEmitirFinTurno) {
            return;
        }
        completarFinTurnoPvpConRevision(revisionPvpLocal);
    }, 900);
}

function clonarJsonSeguro(valor, fallback) {
    try {
        return JSON.parse(JSON.stringify(valor));
    } catch (error) {
        return fallback;
    }
}

function construirSnapshotCanonicoPvp() {
    if (ROL_PVP === 'A') {
        return {
            turno: turnoActual === 'jugador' ? 'A' : 'B',
            mazoA: clonarJsonSeguro(mazoJugador, []),
            mazoB: clonarJsonSeguro(mazoOponente, []),
            cartasEnJuegoA: clonarJsonSeguro(cartasJugadorEnJuego, [null, null, null]),
            cartasEnJuegoB: clonarJsonSeguro(cartasOponenteEnJuego, [null, null, null]),
            cementerioA: clonarJsonSeguro(cementerioJugador, []),
            cementerioB: clonarJsonSeguro(cementerioOponente, []),
            cartasYaActuaronA: clonarJsonSeguro(cartasQueYaAtacaron, []),
            cartasYaActuaronB: clonarJsonSeguro(cartasYaActuaronOponentePvp, []),
            accionesExtraA: Math.max(0, Number(accionesExtraPvpLocal || 0)),
            accionesExtraB: Math.max(0, Number(accionesExtraOponentePvp || 0)),
            atacanteSeleccionadoA: atacanteSeleccionado,
            atacanteSeleccionadoB: atacanteSeleccionadoOponentePvp
        };
    }
    return {
        turno: turnoActual === 'jugador' ? 'B' : 'A',
        mazoA: clonarJsonSeguro(mazoOponente, []),
        mazoB: clonarJsonSeguro(mazoJugador, []),
        cartasEnJuegoA: clonarJsonSeguro(cartasOponenteEnJuego, [null, null, null]),
        cartasEnJuegoB: clonarJsonSeguro(cartasJugadorEnJuego, [null, null, null]),
        cementerioA: clonarJsonSeguro(cementerioOponente, []),
        cementerioB: clonarJsonSeguro(cementerioJugador, []),
        cartasYaActuaronA: clonarJsonSeguro(cartasYaActuaronOponentePvp, []),
        cartasYaActuaronB: clonarJsonSeguro(cartasQueYaAtacaron, []),
        accionesExtraA: Math.max(0, Number(accionesExtraOponentePvp || 0)),
        accionesExtraB: Math.max(0, Number(accionesExtraPvpLocal || 0)),
        atacanteSeleccionadoA: atacanteSeleccionadoOponentePvp,
        atacanteSeleccionadoB: atacanteSeleccionado
    };
}

function aplicarSnapshotCanonicoPvp(snapshot = {}) {
    aplicandoSnapshotPvp = true;
    try {
        if (ROL_PVP === 'A') {
            mazoJugador = Array.isArray(snapshot?.mazoA) ? clonarJsonSeguro(snapshot.mazoA, []) : mazoJugador;
            mazoOponente = Array.isArray(snapshot?.mazoB) ? clonarJsonSeguro(snapshot.mazoB, []) : mazoOponente;
            cartasJugadorEnJuego = Array.isArray(snapshot?.cartasEnJuegoA) ? clonarJsonSeguro(snapshot.cartasEnJuegoA, [null, null, null]) : cartasJugadorEnJuego;
            cartasOponenteEnJuego = Array.isArray(snapshot?.cartasEnJuegoB) ? clonarJsonSeguro(snapshot.cartasEnJuegoB, [null, null, null]) : cartasOponenteEnJuego;
            cementerioJugador = Array.isArray(snapshot?.cementerioA) ? clonarJsonSeguro(snapshot.cementerioA, []) : cementerioJugador;
            cementerioOponente = Array.isArray(snapshot?.cementerioB) ? clonarJsonSeguro(snapshot.cementerioB, []) : cementerioOponente;
            cartasQueYaAtacaron = Array.isArray(snapshot?.cartasYaActuaronA) ? clonarJsonSeguro(snapshot.cartasYaActuaronA, []) : cartasQueYaAtacaron;
            cartasYaActuaronOponentePvp = Array.isArray(snapshot?.cartasYaActuaronB)
                ? clonarJsonSeguro(snapshot.cartasYaActuaronB, [])
                : [];
            accionesExtraPvpLocal = Math.max(0, Number(snapshot?.accionesExtraA || 0));
            accionesExtraOponentePvp = Math.max(0, Number(snapshot?.accionesExtraB || 0));
            // En PvP la selección visual del atacante se sincroniza por evento en tiempo real
            // (`multiplayer:pvp:seleccionAtacante`). Evitamos restaurar índices enteros
            // desde snapshot porque pueden llegar desfasados y resaltar cartas incorrectas.
            if (snapshot?.atacanteSeleccionadoA === null) {
                atacanteSeleccionado = null;
            }
            if (snapshot?.atacanteSeleccionadoB === null) {
                atacanteSeleccionadoOponentePvp = null;
            }
            turnoActual = snapshot?.turno === 'A' ? 'jugador' : 'oponente';
        } else {
            mazoJugador = Array.isArray(snapshot?.mazoB) ? clonarJsonSeguro(snapshot.mazoB, []) : mazoJugador;
            mazoOponente = Array.isArray(snapshot?.mazoA) ? clonarJsonSeguro(snapshot.mazoA, []) : mazoOponente;
            cartasJugadorEnJuego = Array.isArray(snapshot?.cartasEnJuegoB) ? clonarJsonSeguro(snapshot.cartasEnJuegoB, [null, null, null]) : cartasJugadorEnJuego;
            cartasOponenteEnJuego = Array.isArray(snapshot?.cartasEnJuegoA) ? clonarJsonSeguro(snapshot.cartasEnJuegoA, [null, null, null]) : cartasOponenteEnJuego;
            cementerioJugador = Array.isArray(snapshot?.cementerioB) ? clonarJsonSeguro(snapshot.cementerioB, []) : cementerioJugador;
            cementerioOponente = Array.isArray(snapshot?.cementerioA) ? clonarJsonSeguro(snapshot.cementerioA, []) : cementerioOponente;
            cartasQueYaAtacaron = Array.isArray(snapshot?.cartasYaActuaronB) ? clonarJsonSeguro(snapshot.cartasYaActuaronB, []) : cartasQueYaAtacaron;
            cartasYaActuaronOponentePvp = Array.isArray(snapshot?.cartasYaActuaronA)
                ? clonarJsonSeguro(snapshot.cartasYaActuaronA, [])
                : [];
            accionesExtraPvpLocal = Math.max(0, Number(snapshot?.accionesExtraB || 0));
            accionesExtraOponentePvp = Math.max(0, Number(snapshot?.accionesExtraA || 0));
            // En PvP la selección visual del atacante se sincroniza por evento en tiempo real
            // (`multiplayer:pvp:seleccionAtacante`). Evitamos restaurar índices enteros
            // desde snapshot porque pueden llegar desfasados y resaltar cartas incorrectas.
            if (snapshot?.atacanteSeleccionadoB === null) {
                atacanteSeleccionado = null;
            }
            if (snapshot?.atacanteSeleccionadoA === null) {
                atacanteSeleccionadoOponentePvp = null;
            }
            turnoActual = snapshot?.turno === 'B' ? 'jugador' : 'oponente';
        }
        renderizarTablero();
    } finally {
        aplicandoSnapshotPvp = false;
    }
}

function emitirSnapshotPvp(reason = 'sync') {
    if (!ES_MODO_PVP || !socketPvp || !PVP_SESSION_ID || aplicandoSnapshotPvp || partidaFinalizada) {
        return;
    }
    socketPvp.emit('multiplayer:pvp:estado', {
        sessionId: PVP_SESSION_ID,
        snapshot: construirSnapshotCanonicoPvp(),
        baseRevision: Number(revisionPvpLocal || 0),
        reason
    });
}

function obtenerEmailOponentePvp() {
    const directo = String(localStorage.getItem('emailOponente') || '').trim().toLowerCase();
    if (directo) return directo;
    const grupo = JSON.parse(localStorage.getItem('grupoActual') || '{}');
    const companeroEmail = String(grupo?.companero?.email || '').trim().toLowerCase();
    return companeroEmail || '';
}

function notificarResultadoPvp(ganadorClaveLocal, motivo = 'fin_partida') {
    if (!ES_MODO_PVP || !socketPvp || !PVP_SESSION_ID || resultadoPvpEmitido) {
        return;
    }
    const ganadorEmail = ganadorClaveLocal === 'jugador'
        ? EMAIL_SESION_ACTUAL
        : obtenerEmailOponentePvp();
    if (!ganadorEmail) {
        return;
    }
    resultadoPvpEmitido = true;
    socketPvp.emit('multiplayer:pvp:resultado', {
        sessionId: PVP_SESSION_ID,
        ganadorEmail,
        motivo
    });
}

function obtenerNombreVisibleOponente() {
    const nombre = String(localStorage.getItem('nombreOponente') || '').trim();
    if (nombre) {
        return nombre;
    }
    // Solo PvP online: el compañero de grupo no es el oponente en partidas vs BOT / desafío / evento.
    if (ES_MODO_PVP) {
        try {
            const grupo = JSON.parse(localStorage.getItem('grupoActual') || '{}');
            const companeroNombre = String(grupo?.companero?.nombre || '').trim();
            if (companeroNombre) {
                return companeroNombre;
            }
            const companeroEmail = String(grupo?.companero?.email || '').trim();
            if (companeroEmail) {
                return companeroEmail.split('@')[0] || 'Jugador rival';
            }
        } catch (_) {
            /* noop */
        }
        return 'Jugador rival';
    }
    return 'BOT';
}

function intentarInicializarSocketPvp() {
    if (!ES_MODO_PVP || !PVP_SESSION_ID || typeof io !== 'function') {
        return;
    }
    if (socketPvp) {
        return;
    }
    socketPvp = io();
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const emailRaw = String(localStorage.getItem('email') || '').trim();
    const nicknameRaw = String(usuario?.nickname || '').trim();
    const nombreVisible = nicknameRaw || (emailRaw ? emailRaw.split('@')[0] : 'Jugador');
    const avatar = String(usuario?.avatar || '').trim();

    socketPvp.on('connect', () => {
        socketPvp.emit('registrarUsuario', { email: emailRaw, nickname: nombreVisible, avatar });
        socketPvp.emit('multiplayer:pvp:join', { sessionId: PVP_SESSION_ID });
        socketPvp.emit('multiplayer:pvp:estado:solicitar', { sessionId: PVP_SESSION_ID });
    });

    socketPvp.on('multiplayer:pvp:turno', (payload = {}) => {
        if (String(payload?.sessionId || '').trim() !== PVP_SESSION_ID) {
            return;
        }
        if (partidaFinalizada) {
            return;
        }
        configurarNombresTablero();
        actualizarTextoTurno();
        if (pvpEstadoProcesando) {
            pvpTurnoSocketPendiente = payload;
            return;
        }
        encolarOProcesarTurnoPvp(payload);
    });

    socketPvp.on('multiplayer:pvp:seleccionAtacante', (payload = {}) => {
        if (String(payload?.sessionId || '').trim() !== PVP_SESSION_ID || partidaFinalizada) {
            return;
        }
        const actorEmail = String(payload?.actorEmail || '').trim().toLowerCase();
        if (!actorEmail || actorEmail === EMAIL_SESION_ACTUAL) {
            return;
        }
        // Si ya estamos mostrando el ataque básico del rival (acción), no aplicar selección:
        // eventos desordenados pueden reaplicar un slot antiguo y resaltar la carta equivocada.
        if (cartaOponenteDestacada != null) {
            return;
        }
        atacanteSeleccionadoOponentePvp = parseSlotIndicePvp(payload?.slotAtacante);
        renderizarTablero();
    });

    socketPvp.on('multiplayer:pvp:accion', async (payload = {}) => {
        if (String(payload?.sessionId || '').trim() !== PVP_SESSION_ID || partidaFinalizada) {
            return;
        }
        const revision = Number(payload?.revision);
        if (Number.isInteger(revision) && revision > Number(revisionPvpLocal || 0)) {
            revisionPvpLocal = revision;
            const revEl = document.getElementById('pvp-debug-rev');
            if (revEl) revEl.textContent = String(revisionPvpLocal);
            despacharWaitersRevisionPvp();
        }
        const accion = payload?.accion || {};
        const actorEmailNorm = String(payload?.actorEmail || '').trim().toLowerCase();
        pvpUltimaAccionPayload = {
            actorEmail: actorEmailNorm,
            accion
        };
        if (Number.isInteger(revision)) {
            pvpAccionesPorRevision.set(revision, {
                actorEmail: actorEmailNorm,
                accion
            });
            const limite = revision - 10;
            [...pvpAccionesPorRevision.keys()].forEach(key => {
                if (key < limite) pvpAccionesPorRevision.delete(key);
            });
        }
        const tipoAccion = String(accion?.tipo || '').trim();
        if (tipoAccion === 'ataque' || tipoAccion === 'habilidad') {
            pvpUltimaAccionRecibidaTs = Date.now();
            if (actorEmailNorm !== EMAIL_SESION_ACTUAL) {
                atacanteSeleccionadoOponentePvp = null;
                if (tipoAccion === 'ataque') {
                    const slotAtk = parseSlotIndicePvp(accion?.slotAtacante);
                    const slotObj = parseSlotIndicePvp(accion?.slotObjetivo);
                    cartaOponenteDestacada = slotAtk;
                    cartaJugadorDestacada = slotObj;
                    renderizarTablero();
                    if (pvpResetDestacadosTimer) {
                        clearTimeout(pvpResetDestacadosTimer);
                    }
                    pvpResetDestacadosTimer = setTimeout(() => {
                        pvpResetDestacadosTimer = null;
                        limpiarDestacados();
                        renderizarTablero();
                    }, 2200);
                }
            }
        }
        if (tipoAccion === 'habilidad') {
            pvpRetrasoHabilidadHastaTs = Date.now() + PVP_RETARDO_EFECTO_HABILIDAD_MS;
            if (pvpAvisoHabilidadTimer) {
                clearTimeout(pvpAvisoHabilidadTimer);
                pvpAvisoHabilidadTimer = null;
            }
            const actor = actorEmailNorm && actorEmailNorm === EMAIL_SESION_ACTUAL ? 'Tú' : obtenerNombreVisibleOponente();
            const skill = String(accion?.debugSkillName || 'habilidad').trim();
            const caster = String(accion?.debugCasterName || actor).trim();
            const target = String(accion?.debugTargetName || '').trim();
            pvpAvisoHabilidadTimer = setTimeout(() => {
                pvpAvisoHabilidadTimer = null;
                if (partidaFinalizada) return;
                const textoAviso = construirMensajeUsoHabilidadActiva(caster, skill, target || caster);
                mostrarAvisoHabilidad(textoAviso, PAUSA_AVISO_HABILIDAD_MS);
            }, PVP_RETARDO_MENSAJE_HABILIDAD_MS);
        }
        ultimoEventoPvp = `accion:${tipoAccion || '-'}`;
        actualizarLineaDebugPvp(`Acción rival -> ${tipoAccion || '-'}`);
        describirAccionPvpEnLog(accion, payload?.actorEmail);
    });

    socketPvp.on('multiplayer:pvp:estado', async (payload = {}) => {
        if (String(payload?.sessionId || '').trim() !== PVP_SESSION_ID || partidaFinalizada) {
            return;
        }
        const revisionIn = Number(payload?.revision);
        if (!Number.isInteger(revisionIn)) {
            return;
        }
        if (revisionIn < Number(revisionPvpLocal || 0)) {
            return;
        }
        if (pvpEstadoProcesando) {
            const revPendiente = Number(pvpEstadoPayloadPendiente?.revision);
            if (!pvpEstadoPayloadPendiente || !Number.isInteger(revPendiente) || revisionIn >= revPendiente) {
                pvpEstadoPayloadPendiente = payload;
            }
            return;
        }
        pvpEstadoProcesando = true;
        let payloadActual = payload;
        try {
            while (payloadActual && !partidaFinalizada) {
                const revision = Number(payloadActual?.revision);
                if (!Number.isInteger(revision) || revision < Number(revisionPvpLocal || 0)) {
                    break;
                }
                revisionPvpLocal = revision;
                const revEl = document.getElementById('pvp-debug-rev');
                if (revEl) revEl.textContent = String(revisionPvpLocal);
                despacharWaitersRevisionPvp();
                ultimoEventoPvp = `estado:rev${revisionPvpLocal}`;
                actualizarLineaDebugPvp(`Estado oficial rev ${revisionPvpLocal}`);
                const snapshot = payloadActual?.snapshot;
                if (!snapshot || typeof snapshot !== 'object') {
                    break;
                }
                const prevJ = clonarJsonSeguro(cartasJugadorEnJuego, [null, null, null]);
                const prevO = clonarJsonSeguro(cartasOponenteEnJuego, [null, null, null]);
                const { jugador: proxJ, oponente: proxO } = obtenerLadosDesdeSnapshotPvp(snapshot);
                const ahora = Date.now();
                if (pvpRetrasoHabilidadHastaTs > ahora) {
                    await esperar(Math.max(0, pvpRetrasoHabilidadHastaTs - ahora));
                }
                const hayRoboTrasBaja = [0, 1, 2].some(i => (!prevJ[i] && proxJ[i]) || (!prevO[i] && proxO[i]));
                const accionRevisionExacta = pvpAccionesPorRevision.get(revision) || null;
                const accionRevision = accionRevisionExacta || pvpUltimaAccionPayload;
                if (Number.isInteger(revision)) {
                    pvpAccionesPorRevision.delete(revision);
                }
                const animacionAsociadaAccion =
                    ES_MODO_PVP
                    && Boolean(accionRevisionExacta)
                    && pvpUltimaAccionRecibidaTs > 0
                    && (Date.now() - pvpUltimaAccionRecibidaTs) < 7000;
                const tipoAccionReciente = String(accionRevision?.accion?.tipo || '').trim();
                if (animacionAsociadaAccion && tipoAccionReciente === 'ataque') {
                    await animarImpactoAtaquePvpConSnapshot(
                        prevJ,
                        prevO,
                        proxJ,
                        proxO,
                        accionRevision?.accion || {},
                        accionRevision?.actorEmail || ''
                    );
                }
                if (animacionAsociadaAccion && tipoAccionReciente === 'habilidad') {
                    await animarCambiosHabilidadPvp(
                        prevJ,
                        prevO,
                        proxJ,
                        proxO,
                        accionRevision?.accion || {},
                        accionRevision?.actorEmail || ''
                    );
                }
                const hayRefillOMesaNueva =
                    hayRoboTrasBaja
                    || hayCambioVisualPorRoboOMesa(prevO, proxO)
                    || hayCambioVisualPorRoboOMesa(prevJ, proxJ);
                if (hayRefillOMesaNueva && animacionAsociadaAccion) {
                    await esperar(PVP_RETARDO_ROBO_TRAS_BAJA_MS);
                    if (
                        hayCambioVisualPorRoboOMesa(prevO, proxO)
                        || hayCambioVisualPorRoboOMesa(prevJ, proxJ)
                    ) {
                        await esperar(PVP_RETARDO_ANTES_SNAPSHOT_TRAS_REFILL_MS);
                    }
                }
                aplicarSnapshotCanonicoPvp(snapshot);
                if (animacionAsociadaAccion && tipoAccionReciente === 'ataque') {
                    const actorAccion = String(accionRevision?.actorEmail || '').trim().toLowerCase();
                    if (actorAccion && actorAccion === EMAIL_SESION_ACTUAL) {
                        const slotAtacanteConfirmado = parseSlotIndicePvp(accionRevision?.accion?.slotAtacante);
                        // El estado oficial ya trae `cartasYaActuaron*`: solo consume índice si fue ataque básico.
                        // Los ataques extra (extra_attack) no añaden slot en servidor; no debemos forzarlo aquí
                        // o la carta queda como "agotada" sin poder hacer su ataque normal.
                        if (
                            slotAtacanteConfirmado !== null
                            && cartasQueYaAtacaron.includes(slotAtacanteConfirmado)
                            && !pvpCartasAgotadasConfirmadas.includes(slotAtacanteConfirmado)
                        ) {
                            pvpCartasAgotadasConfirmadas.push(slotAtacanteConfirmado);
                        }
                    }
                    limpiarDestacados();
                    renderizarTablero();
                }
                if (hayRoboTrasBaja) {
                    await animarEntradasMazoPvp(prevJ, prevO, proxJ, proxO);
                }
                if (ES_MODO_PVP && esMiTurnoPvp && turnoActual === 'jugador' && !partidaFinalizada) {
                    const enemigosActivos = obtenerIndicesCartasDisponibles(cartasOponenteEnJuego).length;
                    if (enemigosActivos === 0) {
                        if (verificarFinDePartida()) {
                            break;
                        }
                        if (!pvpPendienteEmitirFinTurno) {
                            escribirLog('No quedan enemigos activos. Finalizando turno automáticamente...');
                            finalizarTurnoJugador();
                            break;
                        }
                    }
                }
                if (pvpPendienteEmitirFinTurno) {
                    completarFinTurnoPvpConRevision(revision);
                }
                payloadActual = pvpEstadoPayloadPendiente;
                pvpEstadoPayloadPendiente = null;
            }
        } finally {
            pvpEstadoProcesando = false;
            if (pvpTurnoSocketPendiente) {
                const turnoPendiente = pvpTurnoSocketPendiente;
                pvpTurnoSocketPendiente = null;
                encolarOProcesarTurnoPvp(turnoPendiente);
            }
        }
    });

    socketPvp.on('multiplayer:pvp:resync-required', (payload = {}) => {
        if (String(payload?.sessionId || '').trim() !== PVP_SESSION_ID) {
            return;
        }
        if (Number.isInteger(Number(payload?.revision))) {
            revisionPvpLocal = Number(payload.revision);
            const revEl = document.getElementById('pvp-debug-rev');
            if (revEl) revEl.textContent = String(revisionPvpLocal);
            despacharWaitersRevisionPvp();
        }
        ultimoEventoPvp = `resync:${payload?.reason || 'unknown'}`;
        actualizarLineaDebugPvp(`Resync requerido: ${payload?.reason || 'unknown'}`);
        const reason = String(payload?.reason || '').trim();
        if (reason) {
            escribirLog(`Sincronización requerida (${reason}). Reintentando estado oficial...`);
        }
        socketPvp.emit('multiplayer:pvp:estado:solicitar', { sessionId: PVP_SESSION_ID });
    });

    socketPvp.on('multiplayer:pvp:resultado', (payload = {}) => {
        if (String(payload?.sessionId || '').trim() !== PVP_SESSION_ID || partidaFinalizada) {
            return;
        }
        resultadoPvpEmitido = true;
        ultimoEventoPvp = `resultado:${payload?.motivo || 'fin_partida'}`;
        actualizarLineaDebugPvp(`Resultado PvP: ${payload?.motivo || 'fin_partida'}`);
        const ganadorEmail = String(payload?.ganadorEmail || '').trim().toLowerCase();
        const ganoYo = ganadorEmail && ganadorEmail === EMAIL_SESION_ACTUAL;
        partidaFinalizada = true;
        actualizarTextoTurno('Partida finalizada');
        mostrarAvisoTurno(ganoYo ? 'Has ganado' : 'Has perdido');
        setTimeout(() => {
            if (!partidaFinalizada) return;
            mostrarVentanaFinPartida(ganoYo ? 'jugador' : 'oponente');
        }, RETARDO_MODAL_FIN_PARTIDA_MS);
    });
}

function obtenerNombreVisibleJugador() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const email = localStorage.getItem('email') || '';
    const nickname = String(usuario?.nickname || '').trim();
    return nickname || (email ? email.split('@')[0] : 'Jugador');
}

function obtenerAvatarVisibleJugador() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const avatar = String(usuario?.avatar || '').trim();
    return avatar || 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';
}

function obtenerAvatarVisibleOponente() {
    if (!ES_MODO_PVP) return 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';
    const avatar = String(localStorage.getItem('avatarOponente') || '').trim();
    return avatar || 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';
}

function leerIndicesInicialesPvp(claveStorage) {
    if (!ES_MODO_PVP) return [];
    try {
        const raw = JSON.parse(localStorage.getItem(claveStorage) || '[]');
        return Array.isArray(raw) ? raw.filter(v => Number.isInteger(v) && v >= 0) : [];
    } catch (error) {
        return [];
    }
}

function extraerCartasInicialesConIndices(mazo, indices, cantidadFallback = 3) {
    const base = Array.isArray(mazo) ? mazo : [];
    const unicos = [...new Set((Array.isArray(indices) ? indices : []).filter(i => Number.isInteger(i) && i >= 0 && i < base.length))];
    if (unicos.length === 0) {
        const cantidad = Math.max(0, Math.min(Number(cantidadFallback || 0), base.length));
        const seleccionDeterminista = base.splice(0, cantidad);
        return seleccionDeterminista.map(crearCartaCombateDesdeMazo);
    }
    const ordenAsc = [...unicos].sort((a, b) => a - b);
    const seleccionadas = ordenAsc.map(idx => base[idx]).filter(Boolean);
    const ordenDesc = [...ordenAsc].sort((a, b) => b - a);
    ordenDesc.forEach(idx => {
        base.splice(idx, 1);
    });
    return seleccionadas.map(crearCartaCombateDesdeMazo);
}

function configurarNombresTablero() {
    const nombreJugadorEl = document.getElementById('nombre-jugador');
    const nombreOponenteEl = document.getElementById('nombre-oponente');
    const nombreJugador = obtenerNombreVisibleJugador();
    const nombreOponente = obtenerNombreVisibleOponente();
    const avatarJugadorEl = document.getElementById('panel-jugador-avatar');
    const avatarOponenteEl = document.getElementById('panel-oponente-avatar');

    if (nombreJugadorEl) {
        nombreJugadorEl.textContent = nombreJugador;
    }
    if (nombreOponenteEl) {
        nombreOponenteEl.textContent = nombreOponente;
    }
    if (avatarJugadorEl) {
        avatarJugadorEl.src = obtenerAvatarVisibleJugador();
    }
    if (avatarOponenteEl) {
        avatarOponenteEl.src = obtenerAvatarVisibleOponente();
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
        const skillPowerBaseCatalogo = datosCatalogo.skill_power ?? '';
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
            skill_power_base: skillPowerBaseCatalogo,
            skill_trigger: skillTrigger,
            Imagen: datosCatalogo.Imagen || carta.Imagen || carta.imagen || '',
            imagen: datosCatalogo.Imagen || carta.imagen || carta.Imagen || '',
            imagen_final: datosCatalogo.imagen_final || carta.imagen_final || carta.Imagen_final || '',
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
                poderModHabilidadVisual: modHabilidad,
                bonusAfiliacionBase: 0,
                bonusBuffAplicado: 0,
                bonusBuffSoloUiAfiliacion: 0,
                bonusEsperadoAfiliacion: 0,
                bonusCanceladoAfiliacion: 0,
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
    cartaCombate.stunRestante = Math.max(0, Number(cartaCombate.stunRestante || 0));
    cartaCombate.stunSkillName = String(cartaCombate.stunSkillName || '').trim();
    cartaCombate.efectosDot = Array.isArray(cartaCombate.efectosDot) ? cartaCombate.efectosDot : [];
    cartaCombate.lifeStealActiva = Boolean(cartaCombate.lifeStealActiva);
    cartaCombate.habilidadAutoAplicadaEnJuego = false;
    cartaCombate.tankActiva = Boolean(cartaCombate.tankActiva);
    return cartaCombate;
}

function escribirLog(mensaje, clase = '') {
    const logsCombate = document.getElementById('logs-combate');
    if (!logsCombate) {
        escribirDebug('LOG', { mensaje, clase, renderizado: false });
        return;
    }
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

    const logsContainer = document.querySelector('.logs-container')
        || document.querySelector('.tablero-container');
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

async function animarBajadaSaludCarta(cartasObjetivo, slotObjetivo, saludRawInicial, saludRawFinal, tipoObjetivo, opciones = {}) {
    const carta = cartasObjetivo[slotObjetivo];
    if (!carta) {
        return;
    }

    const saludInicial = Math.max(0, Number(saludRawInicial || 0));
    const saludFinal = Math.max(0, Number(saludRawFinal || 0));

    const idSlotObjetivo = obtenerIdSlot(tipoObjetivo, slotObjetivo);
    const cartasEnemigasSalud = tipoObjetivo === 'jugador' ? cartasOponenteEnJuego : cartasJugadorEnJuego;
    const esCura = Boolean(opciones && opciones.esCura);
    const claseImpactoBarra = esCura ? 'recibiendo-cura' : 'recibiendo-danio';

    carta.SaludMax = obtenerSaludMaxCarta(carta);
    carta.Salud = saludInicial;
    if (opciones && Object.prototype.hasOwnProperty.call(opciones, 'escudoInicial')) {
        carta.escudoActual = Math.max(0, Number(opciones.escudoInicial || 0));
    }
    renderizarTablero();
    const slotTrasRender = document.getElementById(idSlotObjetivo);
    const barraTrasRender = slotTrasRender?.querySelector('.barra-salud-contenedor');
    barraTrasRender?.classList.add(claseImpactoBarra);
    await esperar(120);

    const estadoIni = obtenerSaludEfectiva(carta, cartasEnemigasSalud);
    const pctIni = Math.max(0, Math.min((estadoIni.totalActual / Math.max(estadoIni.totalMax, 1)) * 100, 100));

    carta.Salud = saludFinal;
    if (opciones && Object.prototype.hasOwnProperty.call(opciones, 'escudoFinal')) {
        carta.escudoActual = Math.max(0, Number(opciones.escudoFinal || 0));
    }
    const estadoFin = obtenerSaludEfectiva(carta, cartasEnemigasSalud);
    const pctFin = Math.max(0, Math.min((estadoFin.totalActual / Math.max(estadoFin.totalMax, 1)) * 100, 100));

    const rellenoAnim = slotTrasRender?.querySelector('.barra-salud-relleno');
    if (!rellenoAnim) {
        renderizarTablero();
        barraTrasRender?.classList.remove(claseImpactoBarra);
        return;
    }

    // Un segundo renderizarTablero() aquí recreaba el nodo .barra-salud-relleno y la transición CSS
    // de width no corría entre valores (sobre todo al pasar a 0%). Animamos el mismo elemento.
    rellenoAnim.style.width = `${pctIni}%`;
    rellenoAnim.style.setProperty('--health-ratio', String(pctIni / 100));
    void rellenoAnim.offsetWidth;
    rellenoAnim.style.transition = 'width 0.38s cubic-bezier(0.22, 0.8, 0.2, 1), background-color 0.3s ease, filter 0.25s ease';
    rellenoAnim.style.width = `${pctFin}%`;
    rellenoAnim.style.setProperty('--health-ratio', String(pctFin / 100));

    const saludTxt = slotTrasRender?.querySelector('.salud-carta');
    if (saludTxt) {
        saludTxt.textContent = `${Math.round(estadoFin.totalActual)}/${Math.round(estadoFin.totalMax)}`;
    }

    await esperar(420);
    barraTrasRender?.classList.remove(claseImpactoBarra);
    renderizarTablero();
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
    const nombresPrevios = new Set(usuario.cartas.map(c => normalizarNombre(c?.Nombre)));
    let nuevasH = 0;
    let nuevasV = 0;
    usuario.puntos = Number(usuario.puntos || 0) + puntosGanados;
    cartasPremio.forEach((carta) => {
        const clave = normalizarNombre(carta?.Nombre);
        if (clave && !nombresPrevios.has(clave)) {
            const fac = normalizarFaccion(carta?.faccion || carta?.Faccion || '');
            if (fac === 'H') nuevasH++;
            if (fac === 'V') nuevasV++;
            nombresPrevios.add(clave);
        }
    });
    usuario.cartas.push(...cartasPremio);

    await actualizarUsuarioFirebase(usuario, email);
    localStorage.setItem('usuario', JSON.stringify(usuario));
    if (window.DCMisiones?.track) {
        window.DCMisiones.track('bot', { amount: 1 });
        window.DCMisiones.track('bot_defeat', { amount: 1 });
        if (nuevasH > 0) window.DCMisiones.track('coleccion_h', { amount: nuevasH });
        if (nuevasV > 0) window.DCMisiones.track('coleccion_v', { amount: nuevasV });
    }

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

    /**
     * Recompensas (eventos): la mejora especial solo se entrega si la dificultad
     * elegida es 6 o superior. En desafíos no-evento se mantiene el comportamiento
     * previo (siempre se otorga lo definido por el desafío).
     */
    const dificultadEntregaEspecial = Math.max(1, Number(desafioActivo?.dificultad || 0));
    const otorgaMejoraEspecial = esEvento ? dificultadEntregaEspecial >= 6 : true;
    const mejoraEspecialEntregada = otorgaMejoraEspecial ? Number(recompensas.mejoraEspecial || 0) : 0;

    usuario.puntos = Number(usuario.puntos || 0) + Number(recompensas.puntos || 0);
    usuario.objetos = (usuario.objetos && typeof usuario.objetos === 'object')
        ? usuario.objetos
        : { mejoraCarta: 0, mejoraEspecial: 0 };
    usuario.objetos.mejoraCarta = Number(usuario.objetos.mejoraCarta || 0) + Number(recompensas.mejora || 0);
    usuario.objetos.mejoraEspecial = Number(usuario.objetos.mejoraEspecial || 0) + mejoraEspecialEntregada;

    const cartasGanadas = [];
    const cartasRecompensaDesafio = Array.isArray(desafioActivo?.cartas)
        ? desafioActivo.cartas.map(nombre => String(nombre || '').trim()).filter(Boolean)
        : String(desafioActivo?.cartas || '')
            .split(/[;,|]/)
            .map(nombre => String(nombre || '').trim())
            .filter(Boolean);

    /**
     * Recompensa de carta para EVENTOS: 80% una carta aleatoria de los enemigos normales
     * y 20% la carta del BOSS, ambas escaladas a la dificultad elegida (`Nivel = dificultad`).
     * Si la opción sorteada no está disponible (sin enemigos o sin BOSS) cae en la otra
     * disponible. Si no hay ni enemigos ni BOSS no se entrega carta.
     */
    const enemigosEvento = Array.isArray(desafioActivo?.enemigos)
        ? desafioActivo.enemigos.map(n => String(n || '').trim()).filter(Boolean)
        : [];
    const bossEvento = String(desafioActivo?.boss || '').trim();
    const requiereCatalogoCartas = Boolean(esEvento && (enemigosEvento.length > 0 || bossEvento))
        || (!esEvento && cartasRecompensaDesafio.length > 0);
    const cartasDisponibles = requiereCatalogoCartas ? await obtenerCartasDisponibles() : [];

    if (esEvento && (enemigosEvento.length > 0 || bossEvento)) {
        const tirada = Math.random();
        const sortearEnemigo = () => enemigosEvento[Math.floor(Math.random() * enemigosEvento.length)];
        let nombreElegido = '';
        if (tirada < 0.8 && enemigosEvento.length > 0) {
            nombreElegido = sortearEnemigo();
        } else if (bossEvento) {
            nombreElegido = bossEvento;
        } else if (enemigosEvento.length > 0) {
            nombreElegido = sortearEnemigo();
        }
        if (nombreElegido) {
            const cartaEvento = cartasDisponibles.find(
                carta => normalizarNombre(carta?.Nombre) === normalizarNombre(nombreElegido)
            );
            if (cartaEvento) {
                const dificultadEvento = Math.min(Math.max(Number(desafioActivo.dificultad || 1), 1), 6);
                cartasGanadas.push({
                    ...escalarCartaSegunDificultad(cartaEvento, dificultadEvento),
                    tipoRecompensa: 'evento'
                });
            }
        }
    }
    if (!esEvento && cartasRecompensaDesafio.length > 0) {
        const dificultadDesafio = Math.min(Math.max(Number(desafioActivo?.dificultad || 1), 1), 6);
        const nombresUnicos = Array.from(new Set(cartasRecompensaDesafio.map(normalizarNombre)));
        nombresUnicos.forEach(nombreNormalizado => {
            const cartaBase = cartasDisponibles.find(
                carta => normalizarNombre(carta?.Nombre) === nombreNormalizado
            );
            if (!cartaBase) {
                return;
            }
            cartasGanadas.push({
                ...escalarCartaSegunDificultad(cartaBase, dificultadDesafio),
                tipoRecompensa: 'desafio'
            });
        });
    }

    let nuevasH = 0;
    let nuevasV = 0;
    if (cartasGanadas.length > 0) {
        usuario.cartas = Array.isArray(usuario.cartas) ? usuario.cartas : [];
        const nombresPrevios = new Set(usuario.cartas.map(c => normalizarNombre(c?.Nombre)));
        cartasGanadas.forEach((carta) => {
            const clave = normalizarNombre(carta?.Nombre);
            if (clave && !nombresPrevios.has(clave)) {
                const fac = normalizarFaccion(carta?.faccion || carta?.Faccion || '');
                if (fac === 'H') nuevasH++;
                if (fac === 'V') nuevasV++;
                nombresPrevios.add(clave);
            }
        });
        usuario.cartas.push(...cartasGanadas);
    }

    await actualizarUsuarioFirebase(usuario, email);
    localStorage.setItem('usuario', JSON.stringify(usuario));
    if (window.DCMisiones?.track) {
        if (esEvento) {
            // Misión de desafíos excluye eventos.
            if (String(desafioActivo?.boss || '').trim()) {
                window.DCMisiones.track('boss', { amount: 1 });
            }
        } else {
            window.DCMisiones.track('desafios', { amount: 1 });
            if (String(desafioActivo?.boss || '').trim()) {
                window.DCMisiones.track('boss', { amount: 1 });
            }
        }
        if (nuevasH > 0) window.DCMisiones.track('coleccion_h', { amount: nuevasH });
        if (nuevasV > 0) window.DCMisiones.track('coleccion_v', { amount: nuevasV });
    }
    localStorage.removeItem('desafioActivo');

    return {
        puntosGanados: Number(recompensas.puntos || 0),
        mejorasGanadas: Number(recompensas.mejora || 0),
        mejorasEspecialesGanadas: mejoraEspecialEntregada,
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
    const nombreJugador = obtenerNombreVisibleJugador();
    const nombreOponente = obtenerNombreVisibleOponente();
    const turnoJugadorEl = document.getElementById('turno-jugador-label');
    const turnoOponenteEl = document.getElementById('turno-oponente-label');
    if (turnoJugadorEl) {
        turnoJugadorEl.textContent = `Turno de ${nombreJugador}`;
        turnoJugadorEl.classList.toggle('activo', turnoActual === 'jugador');
    }
    if (turnoOponenteEl) {
        turnoOponenteEl.textContent = `Turno de ${nombreOponente}`;
        turnoOponenteEl.classList.toggle('activo', turnoActual === 'oponente');
    }
}

function mostrarAvisoTurno(texto, duracionMs = 1400) {
    const avisoTurno = document.getElementById('aviso-turno');

    if (!avisoTurno) {
        return;
    }

    avisoTurno.textContent = texto;
    avisoTurno.classList.add('visible');

    if (temporizadorAvisoTurno) {
        clearTimeout(temporizadorAvisoTurno);
    }

    const duracionFinal = Math.max(300, Number(duracionMs || 1400));
    temporizadorAvisoTurno = setTimeout(() => {
        avisoTurno.classList.remove('visible');
    }, duracionFinal);
}

function mostrarAvisoHabilidad(texto, duracionMs = PAUSA_AVISO_HABILIDAD_MS) {
    mostrarAvisoTurno(texto, duracionMs);
}

const PAUSA_AVISO_HABILIDAD_MS = 2300;

function construirMensajeUsoHabilidadActiva(nombreCarta, nombreHabilidad, objetivoTexto) {
    const carta = String(nombreCarta || 'Carta').trim();
    const habilidad = String(nombreHabilidad || 'Habilidad').trim();
    const objetivo = String(objetivoTexto || carta).trim();
    return `${carta} utiliza su habilidad ${habilidad} en ${objetivo}`;
}

async function anunciarUsoHabilidadActiva(carta, meta, objetivoTexto) {
    const mensaje = construirMensajeUsoHabilidadActiva(carta?.Nombre, meta?.nombre, objetivoTexto);
    mostrarAvisoHabilidad(mensaje, PAUSA_AVISO_HABILIDAD_MS);
    await esperar(PAUSA_AVISO_HABILIDAD_MS);
}

/** Aviso central "usa habilidad en …" solo en VS BOT offline para estas clases (habilidad activa "usar"). PvP y jugador local sin filtrar. */
const CLASES_AVISO_HABILIDAD_USAR_BOT = new Set([
    'heal', 'revive', 'shield', 'aoe', 'heal_all', 'tank', 'extra_attack'
]);

async function anunciarUsoHabilidadActivaSiUI(carta, meta, objetivoTexto, propietario) {
    if (!ES_MODO_PVP && propietario === 'oponente') {
        const c = String(meta?.clase || '').trim().toLowerCase();
        if (!CLASES_AVISO_HABILIDAD_USAR_BOT.has(c)) {
            return;
        }
    }
    await anunciarUsoHabilidadActiva(carta, meta, objetivoTexto);
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

    if (botonMazoJugador) {
        botonMazoJugador.textContent = '';
    }
    if (botonMazoOponente) {
        botonMazoOponente.textContent = '';
    }

    if (contadorJugador) {
        contadorJugador.textContent = `Cartas en mazo: ${mazoJugador.length}`;
    }

    if (contadorOponente) {
        contadorOponente.textContent = `Cartas en mazo ${obtenerNombreVisibleOponente()}: ${mazoOponente.length}`;
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

function cartaEstaAturdida(carta) {
    return Math.max(0, Number(carta?.stunRestante || 0)) > 0;
}

function aplicarEfectosInicioTurno(propietario) {
    const aliados = obtenerSlotsAliados(propietario);
    let huboCambios = false;

    aliados.forEach((carta, index) => {
        if (!carta) {
            return;
        }

        const stunActual = Math.max(0, Number(carta.stunRestante || 0));
        if (stunActual > 0) {
            escribirLog(`${carta.Nombre} está aturdida (${stunActual} turno(s)) y no puede actuar.`);
        }

        const dots = Array.isArray(carta.efectosDot) ? carta.efectosDot : [];
        if (dots.length === 0) {
            carta.efectosDot = [];
            return;
        }

        let saludActual = obtenerSaludActualCarta(carta);
        let escudoActual = Math.max(0, Number(carta.escudoActual || 0));
        let danoTotalTurno = 0;

        dots.forEach(dot => {
            const danoTick = Math.max(0, Number(dot?.danoPorTurno || 0));
            if (danoTick <= 0) {
                return;
            }
            let danoRestante = danoTick;
            if (escudoActual > 0) {
                const absorbido = Math.min(escudoActual, danoRestante);
                escudoActual -= absorbido;
                danoRestante -= absorbido;
            }
            if (danoRestante > 0) {
                saludActual = Math.max(0, saludActual - danoRestante);
            }
            danoTotalTurno += danoTick;
        });

        carta.efectosDot = dots
            .map(dot => ({
                danoPorTurno: Math.max(0, Number(dot?.danoPorTurno || 0)),
                turnosRestantes: Math.max(0, Number(dot?.turnosRestantes || 0) - 1),
                skillName: String(dot?.skillName || '').trim()
            }))
            .filter(dot => dot.turnosRestantes > 0 && dot.danoPorTurno > 0);

        carta.escudoActual = escudoActual;
        carta.Salud = saludActual;
        huboCambios = true;

        if (danoTotalTurno > 0) {
            mostrarValorFlotante(propietario, index, danoTotalTurno, 'danio');
            escribirLog(`${carta.Nombre} sufre ${danoTotalTurno} de daño por sangrado.`);
        }

        if ((saludActual + escudoActual) <= 0) {
            registrarCartaDerrotada(carta, propietario);
            aliados[index] = null;
            escribirLog(`${carta.Nombre} cae derrotada por sangrado.`);
        }
    });

    return huboCambios;
}

function consumirStunFinTurno(propietario) {
    const aliados = obtenerSlotsAliados(propietario);
    aliados.forEach(carta => {
        if (!carta) {
            return;
        }
        const stunActual = Math.max(0, Number(carta.stunRestante || 0));
        if (stunActual > 0) {
            carta.stunRestante = Math.max(0, stunActual - 1);
            if (carta.stunRestante === 0) {
                carta.stunSkillName = '';
                escribirLog(`${carta.Nombre} deja de estar aturdida.`);
            }
        }
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
    if (meta.clase === 'tank' && Boolean(carta.habilidadUsadaPartida)) {
        escribirLog(`${carta.Nombre} ya usó ${meta.nombre} en esta partida. Solo puede volver a usarla si es revivida.`);
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
        const disponibles = obtenerIndicesCartasDisponibles(aliados)
            .filter(index => {
                const cartaAliada = aliados[index];
                return cartaAliada && obtenerSaludActualCarta(cartaAliada) < obtenerSaludMaxCarta(cartaAliada);
            })
            .map(index => ({
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
        await anunciarUsoHabilidadActivaSiUI(carta, meta, objetivo.Nombre, propietario);
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
        await anunciarUsoHabilidadActivaSiUI(carta, meta, cartaRevive.Nombre, propietario);
        mazo.push({
            ...cartaRevive,
            Salud: obtenerSaludMaxCarta(cartaRevive),
            escudoActual: 0,
            habilidadAutoAplicadaEnJuego: false,
            habilidadCooldownRestante: 0,
            habilidadUsadaPartida: false,
            tankActiva: false
        });
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
        await anunciarUsoHabilidadActivaSiUI(carta, meta, objetivo.Nombre, propietario);
        objetivo.escudoActual = Math.max(0, Number(objetivo.escudoActual || 0)) + Math.floor(valor);
        escribirLog(`${carta.Nombre} usa ${meta.nombre}: escudo +${Math.floor(valor)} para ${objetivo.Nombre}.`);
    } else if (meta.clase === 'aoe') {
        const { cartasConBonus: aliadosConBonusAoe } = aplicarBonusAfiliaciones(aliados, enemigos);
        const cartaAoeConBonus = aliadosConBonusAoe[slotCarta] || carta;
        const poderFuenteAoe = obtenerPoderCartaFinal(cartaAoeConBonus);
        const danioAoe = Math.max(1, Math.floor(valor || (poderFuenteAoe / 2)));
        const objetivos = obtenerIndicesCartasDisponibles(enemigos);
        if (objetivos.length === 0) return false;
        await anunciarUsoHabilidadActivaSiUI(carta, meta, 'todo el equipo rival', propietario);
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
        if (valor <= 0) return false;
        let huboCuracion = false;
        await anunciarUsoHabilidadActivaSiUI(carta, meta, 'todo su equipo', propietario);
        aliados.forEach(objetivo => {
            if (!objetivo) return;
            const idxObjetivo = aliados.indexOf(objetivo);
            const saludAntes = obtenerSaludActualCarta(objetivo);
            const saludMax = obtenerSaludMaxCarta(objetivo);
            objetivo.Salud = Math.min(saludMax, saludAntes + Math.floor(valor));
            const curado = Math.max(0, objetivo.Salud - saludAntes);
            if (curado > 0 && idxObjetivo >= 0) {
                huboCuracion = true;
                mostrarValorFlotante(propietario, idxObjetivo, curado, 'cura');
            }
        });
        if (!huboCuracion) {
            escribirLog(`${carta.Nombre} no puede usar ${meta.nombre}: todo su equipo está con salud completa.`);
            return false;
        }
        escribirLog(`${carta.Nombre} usa ${meta.nombre}: cura grupal +${Math.floor(valor)}.`);
    } else if (meta.clase === 'tank') {
        if (carta.tankActiva) return false;
        await anunciarUsoHabilidadActivaSiUI(carta, meta, carta.Nombre, propietario);
        carta.tankActiva = true;
        carta.habilidadUsadaPartida = true;
        const saludMaxAnterior = obtenerSaludMaxCarta(carta);
        carta.SaludMax = Math.max(1, saludMaxAnterior * 2);
        carta.Salud = Math.min(carta.SaludMax, obtenerSaludActualCarta(carta) + saludMaxAnterior);
        carta.poderModHabilidad = Number(carta.poderModHabilidad || 0) - Math.floor(Number(carta.Poder || 0) * 0.5);
        escribirLog(`${carta.Nombre} activa ${meta.nombre}: modo tanque activo.`);
    } else if (meta.clase === 'stun') {
        const turnosStun = Math.max(1, Math.floor(valor || 1));
        const filtrarObjetivosNoBoss = (indices = []) => indices.filter(index => enemigos[index] && !esCartaBoss(enemigos[index]));
        let idx = null;
        if (propietario === 'jugador') {
            const tankActivo = obtenerIndiceTankActivo(enemigos);
            const indicesElegiblesBase = tankActivo !== null
                ? [tankActivo]
                : obtenerIndicesCartasDisponibles(enemigos);
            const indicesElegibles = filtrarObjetivosNoBoss(indicesElegiblesBase);
            if (indicesElegibles.length === 0) {
                escribirLog(`${carta.Nombre} intenta usar ${meta.nombre}, pero no afecta a objetivos BOSS.`);
                return false;
            }
            const { cartasConBonus: enemigosConBonusStun } = aplicarBonusAfiliaciones(enemigos, aliados);
            const disponibles = indicesElegibles.map(index => ({
                index,
                carta: enemigosConBonusStun[index]
            }));
            idx = await abrirModalSeleccionHabilidad({
                titulo: `Objetivo para aturdir con ${carta.Nombre}`,
                cartas: disponibles,
                textoConfirmar: 'Aturdir',
                textoCancelar: 'Cancelar',
                tipoCartaTablero: 'oponente',
                enemigosParaSalud: aliados
            });
        } else {
            const tankActivo = obtenerIndiceTankActivo(enemigos);
            if (tankActivo !== null && !esCartaBoss(enemigos[tankActivo])) {
                idx = tankActivo;
            } else {
                const objetivosNoBoss = filtrarObjetivosNoBoss(obtenerIndicesCartasDisponibles(enemigos));
                idx = objetivosNoBoss.length > 0 ? objetivosNoBoss[Math.floor(Math.random() * objetivosNoBoss.length)] : null;
            }
        }
        if (idx === null || idx === undefined || !enemigos[idx]) return false;
        const objetivo = enemigos[idx];
        if (esCartaBoss(objetivo)) {
            escribirLog(`${carta.Nombre} intenta usar ${meta.nombre}, pero ${objetivo.Nombre} es BOSS e inmune al aturdimiento.`);
            return false;
        }
        await anunciarUsoHabilidadActivaSiUI(carta, meta, objetivo.Nombre, propietario);
        const stunPrevio = Math.max(0, Number(objetivo.stunRestante || 0));
        if (turnosStun >= stunPrevio) {
            objetivo.stunSkillName = String(meta.nombre || '').trim();
        }
        objetivo.stunRestante = Math.max(stunPrevio, turnosStun);
        escribirLog(`${carta.Nombre} usa ${meta.nombre} y aturde a ${objetivo.Nombre} durante ${turnosStun} turno(s).`);
    } else if (meta.clase === 'dot') {
        const danoDot = Math.max(1, Math.floor(valor || 1));
        let idx = null;
        if (propietario === 'jugador') {
            const tankActivo = obtenerIndiceTankActivo(enemigos);
            const indicesElegibles = tankActivo !== null
                ? [tankActivo]
                : obtenerIndicesCartasDisponibles(enemigos);
            const { cartasConBonus: enemigosConBonusDot } = aplicarBonusAfiliaciones(enemigos, aliados);
            const disponibles = indicesElegibles.map(index => ({
                index,
                carta: enemigosConBonusDot[index]
            }));
            idx = await abrirModalSeleccionHabilidad({
                titulo: `Objetivo para sangrado de ${carta.Nombre}`,
                cartas: disponibles,
                textoConfirmar: 'Aplicar DOT',
                textoCancelar: 'Cancelar',
                tipoCartaTablero: 'oponente',
                enemigosParaSalud: aliados
            });
        } else {
            const tankActivo = obtenerIndiceTankActivo(enemigos);
            idx = tankActivo !== null ? tankActivo : elegirObjetivoBot();
        }
        if (idx === null || idx === undefined || !enemigos[idx]) return false;
        const objetivo = enemigos[idx];
        await anunciarUsoHabilidadActivaSiUI(carta, meta, objetivo.Nombre, propietario);
        objetivo.efectosDot = Array.isArray(objetivo.efectosDot) ? objetivo.efectosDot : [];
        objetivo.efectosDot.push({ danoPorTurno: danoDot, turnosRestantes: 3, skillName: String(meta.nombre || '').trim() });
        escribirLog(`${carta.Nombre} aplica sangrado a ${objetivo.Nombre}: ${danoDot} de daño por 3 turnos.`);
    } else if (meta.clase === 'life_steal') {
        await anunciarUsoHabilidadActivaSiUI(carta, meta, carta.Nombre, propietario);
        carta.lifeStealActiva = true;
        escribirLog(`${carta.Nombre} activa ${meta.nombre}: robo de vida habilitado.`);
    } else if (meta.clase === 'extra_attack') {
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
        await anunciarUsoHabilidadActivaSiUI(carta, meta, objetivo.Nombre, propietario);
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
    if (ES_MODO_PVP && !esMiTurnoPvp) {
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
    if (cartaEstaAturdida(carta)) {
        escribirLog(`${carta.Nombre} está aturdida y no puede usar habilidades este turno.`);
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

    if (ES_MODO_PVP && socketPvp && PVP_SESSION_ID) {
        let slotObjetivoPvp = null;
        if (meta.clase === 'stun' || meta.clase === 'dot') {
            const tankActivo = obtenerIndiceTankActivo(cartasOponenteEnJuego);
            const indicesElegibles = tankActivo !== null
                ? [tankActivo]
                : obtenerIndicesCartasDisponibles(cartasOponenteEnJuego);
            const { cartasConBonus: enemigosConBonus } = aplicarBonusAfiliaciones(cartasOponenteEnJuego, cartasJugadorEnJuego);
            const disponibles = indicesElegibles
                .filter(index => cartasOponenteEnJuego[index])
                .map(index => ({ index, carta: enemigosConBonus[index] }));
            if (disponibles.length === 0) {
                escribirLog('No hay objetivos enemigos válidos para esa habilidad.');
                return;
            }
            slotObjetivoPvp = await abrirModalSeleccionHabilidad({
                titulo: `Objetivo para ${meta.nombre}`,
                cartas: disponibles,
                textoConfirmar: 'Confirmar',
                textoCancelar: 'Cancelar',
                tipoCartaTablero: 'oponente',
                enemigosParaSalud: cartasJugadorEnJuego
            });
            if (!Number.isInteger(slotObjetivoPvp)) {
                return;
            }
        } else if (meta.clase === 'heal' || meta.clase === 'shield') {
            const { cartasConBonus: aliadosConBonus } = aplicarBonusAfiliaciones(cartasJugadorEnJuego, cartasOponenteEnJuego);
            const indicesAliados = obtenerIndicesCartasDisponibles(cartasJugadorEnJuego).filter(index => {
                if (meta.clase !== 'heal') return true;
                const cartaAliada = cartasJugadorEnJuego[index];
                return cartaAliada && obtenerSaludActualCarta(cartaAliada) < obtenerSaludMaxCarta(cartaAliada);
            });
            const disponibles = indicesAliados.map(index => ({
                index,
                carta: aliadosConBonus[index]
            }));
            if (disponibles.length === 0) {
                escribirLog(meta.clase === 'heal'
                    ? 'No hay aliados heridos para curar.'
                    : 'No hay aliados válidos para esa habilidad.');
                return;
            }
            slotObjetivoPvp = await abrirModalSeleccionHabilidad({
                titulo: `Objetivo para ${meta.nombre}`,
                cartas: disponibles,
                textoConfirmar: 'Confirmar',
                textoCancelar: 'Cancelar',
                tipoCartaTablero: 'jugador',
                enemigosParaSalud: cartasOponenteEnJuego
            });
            if (!Number.isInteger(slotObjetivoPvp)) {
                return;
            }
        } else if (meta.clase === 'extra_attack') {
            const tankActivo = obtenerIndiceTankActivo(cartasOponenteEnJuego);
            const indicesElegibles = tankActivo !== null
                ? [tankActivo]
                : obtenerIndicesCartasDisponibles(cartasOponenteEnJuego);
            const { cartasConBonus: enemigosConBonusExtra } = aplicarBonusAfiliaciones(cartasOponenteEnJuego, cartasJugadorEnJuego);
            const disponibles = indicesElegibles
                .filter(index => cartasOponenteEnJuego[index])
                .map(index => ({ index, carta: enemigosConBonusExtra[index] }));
            if (disponibles.length === 0) {
                escribirLog('No hay objetivos enemigos válidos para el ataque extra.');
                return;
            }
            const slotObjetivoAtaque = await abrirModalSeleccionHabilidad({
                titulo: `Objetivo para ataque adicional de ${carta.Nombre}`,
                cartas: disponibles,
                textoConfirmar: 'Atacar',
                textoCancelar: 'Cancelar',
                tipoCartaTablero: 'oponente',
                enemigosParaSalud: cartasJugadorEnJuego
            });
            if (!Number.isInteger(slotObjetivoAtaque)) {
                return;
            }
            const nombreObjetivoExtra = String(cartasOponenteEnJuego[slotObjetivoAtaque]?.Nombre || 'objetivo').trim();
            atacanteSeleccionado = null;
            const revisionAntesHabilidad = Number(revisionPvpLocal || 0);
            trazaAccionPvp('emit_habilidad', `extra_attack slot=${slotIndex}`);
            socketPvp.emit('multiplayer:pvp:accion', {
                sessionId: PVP_SESSION_ID,
                expectedRevision: revisionAntesHabilidad,
                accion: {
                    tipo: 'habilidad',
                    slotAtacante: slotIndex,
                    slotObjetivo: null,
                    debugSkillName: meta.nombre,
                    debugSkillClass: meta.clase,
                    debugCasterName: carta.Nombre,
                    debugTargetName: nombreObjetivoExtra
                }
            });
            escribirLog(`${carta.Nombre} activa ${meta.nombre}. Esperando confirmación del servidor...`);
            try {
                await esperarRevisionPvpMayorQue(revisionAntesHabilidad);
                trazaAccionPvp('habilidad_confirmada', `extra_attack slot=${slotIndex}`);
            } catch (error) {
                trazaAccionPvp('habilidad_timeout', `extra_attack slot=${slotIndex}`);
                escribirLog('No se confirmó la habilidad a tiempo. Reintenta o espera a sincronizar.');
                renderizarTablero();
                return;
            }
            trazaAccionPvp('emit_ataque_extra', `slot=${slotIndex}->${slotObjetivoAtaque}`);
            socketPvp.emit('multiplayer:pvp:accion', {
                sessionId: PVP_SESSION_ID,
                expectedRevision: Number(revisionPvpLocal || 0),
                accion: {
                    tipo: 'ataque',
                    slotAtacante: slotIndex,
                    slotObjetivo: slotObjetivoAtaque,
                    debugCasterName: carta.Nombre,
                    debugTargetName: nombreObjetivoExtra
                }
            });
            escribirLog(`Ataque extra enviado contra el objetivo elegido.`);
            renderizarTablero();
            if (!quedanAtaquesJugadorDisponibles()) {
                finalizarTurnoJugador();
            }
            return;
        } else if (meta.clase === 'revive') {
            if (cementerioJugador.length === 0) {
                escribirLog('No hay cartas en tu cementerio para revivir.');
                return;
            }
            const opciones = cementerioJugador.map((cartaCementerio, index) => ({ index, carta: cartaCementerio }));
            const indiceCementerio = await abrirModalSeleccionHabilidad({
                titulo: `Revivir con ${carta.Nombre}`,
                cartas: opciones,
                textoConfirmar: 'Revivir carta',
                textoCancelar: 'Cancelar',
                tipoCartaTablero: 'jugador',
                enemigosParaSalud: []
            });
            if (!Number.isInteger(indiceCementerio)) {
                return;
            }
            slotObjetivoPvp = indiceCementerio;
        } else if (meta.clase === 'heal_all') {
            const hayAliadoHerido = obtenerSlotsAliados('jugador').some(cartaAliada => (
                cartaAliada && obtenerSaludActualCarta(cartaAliada) < obtenerSaludMaxCarta(cartaAliada)
            ));
            if (!hayAliadoHerido) {
                escribirLog(`${carta.Nombre} no puede usar ${meta.nombre}: todo tu equipo está con salud completa.`);
                return;
            }
        }
        const objetivoTexto = (() => {
            if (meta.clase === 'revive') {
                return 'una carta del cementerio';
            }
            if (meta.clase === 'aoe') {
                return 'todo el equipo rival';
            }
            if (meta.clase === 'heal_all') {
                return 'todo tu equipo';
            }
            if (!Number.isInteger(slotObjetivoPvp)) {
                return null;
            }
            if (meta.clase === 'heal' || meta.clase === 'shield') {
                return String(cartasJugadorEnJuego[slotObjetivoPvp]?.Nombre || '').trim() || null;
            }
            if (meta.clase === 'stun' || meta.clase === 'dot') {
                return String(cartasOponenteEnJuego[slotObjetivoPvp]?.Nombre || '').trim() || null;
            }
            return null;
        })();
        atacanteSeleccionado = null;
        trazaAccionPvp('emit_habilidad', `${meta.clase} slot=${slotIndex}`);
        socketPvp.emit('multiplayer:pvp:accion', {
            sessionId: PVP_SESSION_ID,
            expectedRevision: Number(revisionPvpLocal || 0),
            accion: {
                tipo: 'habilidad',
                slotAtacante: slotIndex,
                slotObjetivo: (meta.clase === 'revive' ? null : (Number.isInteger(slotObjetivoPvp) ? slotObjetivoPvp : null)),
                indiceCementerio: (meta.clase === 'revive' && Number.isInteger(slotObjetivoPvp)) ? slotObjetivoPvp : null,
                debugSkillName: meta.nombre,
                debugSkillClass: meta.clase,
                debugCasterName: carta.Nombre,
                debugTargetName: objetivoTexto || null
            }
        });
        escribirLog(`${carta.Nombre} intenta usar ${meta.nombre}. Esperando confirmación del servidor...`);
        renderizarTablero();
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
    cartaDiv.style.backgroundPosition = 'center top';

    if (!soloVista) {
        if (tipo === 'jugador' && turnoActual === 'jugador' && !cartasQueYaAtacaron.includes(slotIndex)) {
            cartaDiv.style.cursor = 'pointer';
            cartaDiv.addEventListener('click', () => seleccionarCartaAtacante(slotIndex));
        }

        const cartaAgotadaPorTurno = cartasQueYaAtacaron.includes(slotIndex)
            && (!ES_MODO_PVP || pvpCartasAgotadasConfirmadas.includes(slotIndex) || pvpMantenerOpacidadFinTurno)
            && (turnoActual === 'jugador' || (ES_MODO_PVP && pvpMantenerOpacidadFinTurno));
        if (tipo === 'jugador' && (cartaAgotadaPorTurno || cartaEstaAturdida(carta))) {
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

        const destacadaAtaqueJugador = tipo === 'jugador' && cartaJugadorDestacada === slotIndex;
        if (tipo === 'jugador' && atacanteSeleccionado === slotIndex && !destacadaAtaqueJugador) {
            cartaDiv.classList.add('carta-seleccionada');
        }
        if (
            ES_MODO_PVP
            && tipo === 'oponente'
            && cartaOponenteDestacada == null
            && Number.isInteger(atacanteSeleccionadoOponentePvp)
            && atacanteSeleccionadoOponentePvp === slotIndex
        ) {
            cartaDiv.classList.add('carta-atacando');
        }

        if (destacadaAtaqueJugador) {
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
    if (Math.max(0, Number(carta?.stunRestante || 0)) > 0) {
        const stunChip = document.createElement('span');
        stunChip.className = 'estado-stun';
        const skillName = String(carta?.stunSkillName || '').trim() || 'Stun';
        stunChip.textContent = `Incapacitado: ${skillName}`;
        saludStack.appendChild(stunChip);
    }
    const dotsActivos = (Array.isArray(carta?.efectosDot) ? carta.efectosDot : [])
        .filter(dot => Math.max(0, Number(dot?.turnosRestantes || 0)) > 0 && Math.max(0, Number(dot?.danoPorTurno || 0)) > 0);
    if (dotsActivos.length > 0) {
        const dotChip = document.createElement('span');
        dotChip.className = 'estado-dot';
        const skillName = String(dotsActivos[0]?.skillName || '').trim() || 'DoT';
        dotChip.textContent = `DoT: ${skillName}`;
        saludStack.appendChild(dotChip);
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
    if (badgeAfiliacion && !carta?.tankActiva) {
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
            || cartaEstaAturdida(carta)
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
    if (ES_MODO_PVP) {
        atacanteSeleccionadoOponentePvp = null;
    }
}

async function rellenarSlotsVacios(mazo, cartasEnJuego, propietario) {
    for (let i = 0; i < cartasEnJuego.length; i++) {
        if (!cartasEnJuego[i] && mazo.length > 0) {
            const cartaBase = ES_MODO_PVP ? mazo.shift() : seleccionarCartasAleatorias(mazo, 1)[0];
            cartasEnJuego[i] = crearCartaCombateDesdeMazo(cartaBase);
            aplicarHabilidadAutoSiCorresponde(cartasEnJuego[i], propietario);
            escribirLog(
                `${propietario === 'jugador' ? 'Robas' : `${obtenerNombreVisibleOponente()} roba`} ${cartasEnJuego[i].Nombre} al slot ${i + 1}.`
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

/**
 * Misma regla que `determinarPrimerTurnoPvp` en server.js: suma de Poder de cada mazo completo.
 * No usar `determinarPrimerTurno` (solo 3 cartas en mesa + bonos): desincroniza el primer turno respecto al servidor.
 */
function determinarPrimerTurnoPvpDesdeMazosLocales() {
    const sumaPoderMazo = mazo => (Array.isArray(mazo) ? mazo : []).reduce(
        (acc, c) => acc + Math.max(0, Number(c?.Poder || 0)),
        0
    );
    const poderJ = sumaPoderMazo(mazoJugador);
    const poderO = sumaPoderMazo(mazoOponente);
    if (poderJ > poderO) return 'jugador';
    if (poderO > poderJ) return 'oponente';
    return Math.random() > 0.5 ? 'jugador' : 'oponente';
}

async function cargarCartasIniciales() {
    if (ES_MODO_PVP) {
        pvpDespliegueTableroListo = false;
        pvpTurnoPendienteDesdeSocket = null;
        pvpUltimoTurnEmailSocket = '';
        pvpUltimoTurnEmailSocketTs = 0;
        cartasYaActuaronOponentePvp = [];
        atacanteSeleccionadoOponentePvp = null;
        accionesExtraPvpLocal = 0;
        accionesExtraOponentePvp = 0;
        pvpPendienteEmitirFinTurno = false;
        pvpTurnoJugadorYaPreparado = false;
        pvpRetrasoHabilidadHastaTs = 0;
        pvpUltimaAccionPayload = null;
        pvpAccionesPorRevision.clear();
        pvpCartasAgotadasConfirmadas = [];
        revisionPvpLocal = 0;
        pvpMantenerOpacidadFinTurno = false;
        pvpEstadoProcesando = false;
        pvpTurnoSocketPendiente = null;
        pvpEstadoPayloadPendiente = null;
        if (pvpAvisoHabilidadTimer) {
            clearTimeout(pvpAvisoHabilidadTimer);
            pvpAvisoHabilidadTimer = null;
        }
        if (pvpTurnoAplicacionTimer) {
            clearTimeout(pvpTurnoAplicacionTimer);
            pvpTurnoAplicacionTimer = null;
        }
        while (pvpRevisionWaiters.length) {
            const w = pvpRevisionWaiters.pop();
            try {
                w.cancel?.();
                w.reject?.(new Error('pvp_reset'));
            } catch (_) {
                /* noop */
            }
        }
        if (pvpFinTurnoFallbackTimer) {
            clearTimeout(pvpFinTurnoFallbackTimer);
            pvpFinTurnoFallbackTimer = null;
        }
        if (pvpFinTurnoDelayTimer) {
            clearTimeout(pvpFinTurnoDelayTimer);
            pvpFinTurnoDelayTimer = null;
        }
    }
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
        } else if (ES_MODO_PVP) {
            // PvP online: ambos mazos vienen de la sesión (jugador real vs jugador real).
            // No usar esMazoBotValido/generarMazoBot: un mazo de jugador no cumple reglas de bot
            // y se sustituía por cartas aleatorias del catálogo, rompiendo índices y tablero.
            mazoOponente = await enriquecerCartasConDatosCatalogo(mazoOponente);
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
    const indicesInicialesJugadorPvp = leerIndicesInicialesPvp('partidaPvpInicialesJugadorIdx');
    const indicesInicialesOponentePvp = leerIndicesInicialesPvp('partidaPvpInicialesOponenteIdx');
    const inicialesJugador = ES_MODO_PVP
        ? extraerCartasInicialesConIndices(mazoJugador, indicesInicialesJugadorPvp, 3)
        : seleccionarCartasAleatorias(mazoJugador, 3).map(crearCartaCombateDesdeMazo);
    const inicialesOponente = estadoDesafio.activo
        ? (estadoDesafio.gruposPendientes.shift() || []).map(crearCartaCombateDesdeMazo)
        : (ES_MODO_PVP
            ? extraerCartasInicialesConIndices(mazoOponente, indicesInicialesOponentePvp, 3)
            : seleccionarCartasAleatorias(mazoOponente, 3).map(crearCartaCombateDesdeMazo));

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
    const primerTurnoPersistido = String(localStorage.getItem('partidaPvpPrimerTurno') || '').trim().toLowerCase();
    const primerTurno = ES_MODO_PVP && (primerTurnoPersistido === 'jugador' || primerTurnoPersistido === 'oponente')
        ? primerTurnoPersistido
        : (ES_MODO_PVP
            ? determinarPrimerTurnoPvpDesdeMazosLocales()
            : determinarPrimerTurno(cartasJugadorEnJuego, cartasOponenteEnJuego));
    if (ES_MODO_PVP) {
        esMiTurnoPvp = primerTurno === 'jugador';
        turnoActual = primerTurno === 'jugador' ? 'jugador' : 'oponente';
    } else {
        turnoActual = primerTurno === 'jugador' ? 'jugador' : 'oponente';
        actualizarTextoTurno();
    }
    escribirLog(`El primer turno es para: ${primerTurno === 'jugador' ? 'Jugador' : obtenerNombreVisibleOponente()}`);

    if (ES_MODO_PVP) {
        if (ROL_PVP === 'A' && Number(revisionPvpLocal || 0) === 0) {
            emitirSnapshotPvp('inicio_partida');
        }
        pvpDespliegueTableroListo = true;
        const pendiente = pvpTurnoPendienteDesdeSocket;
        pvpTurnoPendienteDesdeSocket = null;
        const marcarTurnoSocketProcesado = (turnEmailRaw) => {
            const te = String(turnEmailRaw || '').trim().toLowerCase();
            if (!te) {
                return;
            }
            pvpUltimoTurnEmailSocket = te;
            pvpUltimoTurnEmailSocketTs = Date.now();
        };
        if (pendiente && String(pendiente.turnEmail || '').trim()) {
            marcarTurnoSocketProcesado(pendiente.turnEmail);
            refrescarEtiquetasTurnoPvpDesdeEmail(pendiente.turnEmail);
            procesarTurnoPvpSocket(pendiente);
        } else if (primerTurno === 'jugador') {
            marcarTurnoSocketProcesado(EMAIL_SESION_ACTUAL);
            refrescarEtiquetasTurnoPvpDesdeEmail(EMAIL_SESION_ACTUAL);
            iniciarTurnoJugador();
        } else {
            marcarTurnoSocketProcesado(obtenerEmailOponentePvp());
            refrescarEtiquetasTurnoPvpDesdeEmail(obtenerEmailOponentePvp());
            iniciarTurnoOponente();
        }
        return;
    }

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
    const esPvp = ES_MODO_PVP;

    tituloFinPartida.textContent = ganador === 'jugador' ? 'Has ganado' : 'Has perdido';
    mensajeFinPartida.textContent = ganador === 'jugador'
        ? `Has derrotado a ${obtenerNombreVisibleOponente()}.`
        : `${obtenerNombreVisibleOponente()} ha ganado la partida.`;

    recompensasContainer.innerHTML = '';
    ventanaEmergente.style.display = 'flex';
    botonReiniciar.onclick = reiniciarPartida;
    botonVolverMenu.onclick = volverAlMenu;
    botonVolverMenu.textContent = esPvp
        ? 'Volver al multijugador'
        : (esEventoActivo ? 'Terminar Evento' : (estadoDesafio.activo ? 'Terminar Desafío' : 'Volver al menú'));

    if (esPvp) {
        if (window.DCMisiones?.track) {
            window.DCMisiones.track('pvp', { amount: 1 });
        }
        const notaPvp = document.createElement('p');
        notaPvp.classList.add('texto-recompensa-estado');
        notaPvp.textContent = 'Resultado PvP sincronizado. Esta partida no otorga recompensas PvE.';
        recompensasContainer.appendChild(notaPvp);
        return;
    }

    if (ganador !== 'jugador') {
        if (!esPvp && !estadoDesafio.activo && window.DCMisiones?.track) {
            window.DCMisiones.track('bot', { amount: 1 });
        }
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
        notificarResultadoPvp('oponente', 'sin_cartas');
        setTimeout(() => {
            if (!partidaFinalizada) return;
            mostrarVentanaFinPartida('oponente');
        }, RETARDO_MODAL_FIN_PARTIDA_MS);
        return true;
    }

    if (cartasVivasOponente === 0 && mazoOponente.length === 0) {
        if (intentarDesplegarSiguienteGrupoDesafio()) {
            return false;
        }
        partidaFinalizada = true;
        actualizarTextoTurno('Partida finalizada');
        mostrarAvisoTurno('Has ganado');
        escribirLog(`${obtenerNombreVisibleOponente()} se ha quedado sin cartas en mesa y en el mazo. Has ganado.`);
        notificarResultadoPvp('jugador', 'sin_cartas');
        setTimeout(() => {
            if (!partidaFinalizada) return;
            mostrarVentanaFinPartida('jugador');
        }, RETARDO_MODAL_FIN_PARTIDA_MS);
        return true;
    }

    return false;
}

function finalizarTurnoJugador() {
    if (partidaFinalizada) {
        return;
    }

    atacanteSeleccionado = null;
    if (ES_MODO_PVP) {
        emitirSeleccionAtacantePvp(null);
    }
    if (!ES_MODO_PVP) {
        cartasQueYaAtacaron = [];
    } else {
        pvpCartasAgotadasConfirmadas = [];
    }
    consumirStunFinTurno('jugador');
    limpiarDestacados();
    renderizarTablero();
    escribirLog('Tu turno ha terminado.');

    if (verificarFinDePartida()) {
        return;
    }

    if (ES_MODO_PVP) {
        esMiTurnoPvp = false;
        pvpTurnoJugadorYaPreparado = false;
        pvpMantenerOpacidadFinTurno = true;
        turnoActual = 'oponente';
        actualizarTextoTurno('Sincronizando turno...');
        escribirLog('Esperando confirmación de fin de turno...');
        renderizarTablero();
        programarFinTurnoPvpCuandoLlegueEstadoOficial();
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

    consumirStunFinTurno('oponente');
    limpiarDestacados();
    renderizarTablero();
    escribirLog(`El turno de ${obtenerNombreVisibleOponente()} ha terminado.`);

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
    if (ES_MODO_PVP && !esMiTurnoPvp) {
        return;
    }

    if (!cartasJugadorEnJuego[slotIndex]) {
        return;
    }

    if (cartaEstaAturdida(cartasJugadorEnJuego[slotIndex])) {
        escribirLog(`${cartasJugadorEnJuego[slotIndex].Nombre} está aturdida y no puede atacar este turno.`);
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
    if (ES_MODO_PVP) {
        emitirSeleccionAtacantePvp(slotIndex);
    }
    escribirLog(`Atacante seleccionado: ${cartasJugadorEnJuego[slotIndex].Nombre}. Elige un objetivo.`);
    renderizarTablero();
}

async function resolverAtaque(cartasAtacante, slotAtacante, cartasObjetivo, slotObjetivo, nombreAtacante, nombreObjetivo, tipoObjetivo, multiplicadorDanioAtacante = 1) {
    const { cartasConBonus: atacanteConBonus } = aplicarBonusAfiliaciones(cartasAtacante, cartasObjetivo);
    const propietarioAtacante = cartasAtacante === cartasJugadorEnJuego ? 'jugador' : 'oponente';
    const cartasEnemigasObjetivo = propietarioAtacante === 'jugador' ? cartasJugadorEnJuego : cartasOponenteEnJuego;
    const { cartasConBonus: objetivoConBonus } = aplicarBonusAfiliaciones(cartasObjetivo, cartasAtacante);
    const cartaAtacanteBase = cartasAtacante[slotAtacante];
    const metaAtacante = obtenerMetaHabilidad(cartaAtacanteBase);
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

        if (metaAtacante.tieneHabilidad && metaAtacante.trigger === 'auto' && metaAtacante.clase === 'dot' && danioInfligido > 0) {
            const danoDot = Math.max(1, Math.floor(obtenerValorNumericoSkillPower(cartaAtacanteBase, 1)));
            const objetivo = cartasObjetivo[slotObjetivo];
            objetivo.efectosDot = Array.isArray(objetivo.efectosDot) ? objetivo.efectosDot : [];
            objetivo.efectosDot.push({ danoPorTurno: danoDot, turnosRestantes: 3, skillName: String(metaAtacante.nombre || '').trim() });
            escribirLog(`${nombreAtacante} aplica sangrado a ${nombreObjetivo}: ${danoDot} de daño por 3 turnos.`);
        }
    }

    const lifeStealActivo = (
        metaAtacante.tieneHabilidad
        && metaAtacante.clase === 'life_steal'
        && (metaAtacante.trigger === 'auto' || Boolean(cartaAtacanteBase?.lifeStealActiva))
    );
    if (lifeStealActivo && danioInfligido > 0) {
        const valorRobo = Math.max(1, Math.floor(obtenerValorNumericoSkillPower(cartaAtacanteBase, 1)));
        const atacanteReal = cartasAtacante[slotAtacante];
        if (atacanteReal) {
            const saludAntes = obtenerSaludActualCarta(atacanteReal);
            const saludMax = obtenerSaludMaxCarta(atacanteReal);
            atacanteReal.Salud = Math.min(saludMax, saludAntes + valorRobo);
            const curado = Math.max(0, atacanteReal.Salud - saludAntes);
            if (curado > 0) {
                mostrarValorFlotante(propietarioAtacante, slotAtacante, curado, 'cura');
                escribirLog(`${nombreAtacante} roba vida y recupera ${curado} de salud.`);
            }
        }
    }

    const mazoObjetivo = cartasObjetivo === cartasJugadorEnJuego ? mazoJugador : mazoOponente;
    if (!ES_MODO_PVP && obtenerIndicesCartasDisponibles(cartasObjetivo).length === 0 && mazoObjetivo.length > 0) {
        await rellenarSlotsVacios(
            mazoObjetivo,
            cartasObjetivo,
            cartasObjetivo === cartasJugadorEnJuego ? 'jugador' : 'oponente'
        );
        renderizarTablero();
    }
}

function quedanAtaquesJugadorDisponibles() {
    const hayObjetivos = obtenerIndicesCartasDisponibles(cartasOponenteEnJuego).length > 0;
    if (!hayObjetivos) {
        return false;
    }

    return obtenerIndicesCartasDisponibles(cartasJugadorEnJuego)
        .some(index => !cartasQueYaAtacaron.includes(index) && !cartaEstaAturdida(cartasJugadorEnJuego[index]));
}

function quedanAtaquesJugadorDisponiblesTrasConsumir(slotConsumido) {
    const hayObjetivos = obtenerIndicesCartasDisponibles(cartasOponenteEnJuego).length > 0;
    if (!hayObjetivos) {
        return false;
    }
    return obtenerIndicesCartasDisponibles(cartasJugadorEnJuego)
        .some(index => index !== slotConsumido && !cartasQueYaAtacaron.includes(index) && !cartaEstaAturdida(cartasJugadorEnJuego[index]));
}

function seleccionarCartaObjetivo(slotIndex) {
    if (partidaFinalizada || turnoActual !== 'jugador' || atacanteSeleccionado === null) {
        return;
    }
    if (ES_MODO_PVP && !esMiTurnoPvp) {
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

    if (ES_MODO_PVP && socketPvp && PVP_SESSION_ID) {
        const nombreAtacante = String(cartaAtacante?.Nombre || '').trim();
        const nombreObjetivo = String(cartaObjetivo?.Nombre || '').trim();
        trazaAccionPvp('emit_ataque', `slot=${slotAtacante}->${slotIndex}`);
        socketPvp.emit('multiplayer:pvp:accion', {
            sessionId: PVP_SESSION_ID,
            expectedRevision: Number(revisionPvpLocal || 0),
            accion: {
                tipo: 'ataque',
                slotAtacante,
                slotObjetivo: slotIndex,
                debugCasterName: nombreAtacante || null,
                debugTargetName: nombreObjetivo || null
            }
        });
        atacanteSeleccionado = null;
        emitirSeleccionAtacantePvp(null);
        escribirLog(`Ataque enviado. Esperando estado oficial del servidor...`);
        renderizarTablero();
        if (!quedanAtaquesJugadorDisponiblesTrasConsumir(slotAtacante)) {
            finalizarTurnoJugador();
        }
        return;
    }

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

    if (cartaEstaAturdida(cartaAtacante)) {
        escribirLog(`${cartaAtacante.Nombre} está aturdida y pierde su acción.`);
        await esperar(350);
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
    const multiplicadorDanio = 1;

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
    if (ES_MODO_PVP && !esMiTurnoPvp) {
        turnoActual = 'oponente';
        actualizarTextoTurno(`Turno de ${obtenerNombreVisibleOponente()}`);
        renderizarTablero();
        return;
    }
    if (ES_MODO_PVP && turnoActual === 'jugador' && esMiTurnoPvp && pvpTurnoJugadorYaPreparado) {
        return;
    }

    turnoActual = 'jugador';
    atacanteSeleccionado = null;
    cartasQueYaAtacaron = [];
    pvpCartasAgotadasConfirmadas = [];
    if (ES_MODO_PVP) {
        pvpTurnoJugadorYaPreparado = true;
    } else {
        reducirCooldownHabilidadesActivas('jugador');
    }
    const huboEstados = ES_MODO_PVP ? false : aplicarEfectosInicioTurno('jugador');

    actualizarTextoTurno('Tu turno');
    if (ES_MODO_PVP) {
        mostrarAvisoTurno('Es tu turno');
    }
    escribirLog('Comienza tu turno.');

    if (huboEstados) {
        renderizarTablero();
        if (verificarFinDePartida()) {
            return;
        }
    }

    if (!ES_MODO_PVP) {
        await rellenarSlotsVacios(mazoJugador, cartasJugadorEnJuego, 'jugador');
        renderizarTablero();
    }

    if (verificarFinDePartida()) {
        return;
    }

    if (!ES_MODO_PVP) {
        mostrarAvisoTurno(`Turno de ${obtenerNombreVisibleJugador()}`, 2200);
    }

    if (obtenerIndicesCartasDisponibles(cartasJugadorEnJuego).length === 0) {
        escribirLog('No tienes cartas disponibles para atacar.');
        finalizarTurnoJugador();
        return;
    }
    if (!quedanAtaquesJugadorDisponibles()) {
        escribirLog('No hay ataques disponibles para este turno. Pasas turno.');
        finalizarTurnoJugador();
        return;
    }

    if (obtenerIndicesCartasDisponibles(cartasOponenteEnJuego).length === 0) {
        escribirLog(`${obtenerNombreVisibleOponente()} no tiene cartas en mesa. Pasas turno.`);
        finalizarTurnoJugador();
        return;
    }

    escribirLog('Selecciona una de tus cartas y después el objetivo enemigo.');
}

async function iniciarTurnoOponente() {
    if (partidaFinalizada) {
        return;
    }
    if (ES_MODO_PVP) {
        turnoActual = 'oponente';
        actualizarTextoTurno(`Turno de ${obtenerNombreVisibleOponente()}`);
        mostrarAvisoTurno(`Turno de ${obtenerNombreVisibleOponente()}`);
        escribirLog(`Esperando la jugada de ${obtenerNombreVisibleOponente()}...`);
        renderizarTablero();
        return;
    }

    turnoActual = 'oponente';
    atacanteSeleccionado = null;
    cartasQueYaAtacaron = [];
    limpiarDestacados();
    reducirCooldownHabilidadesActivas('oponente');
    const huboEstados = aplicarEfectosInicioTurno('oponente');

    actualizarTextoTurno(`Turno de ${obtenerNombreVisibleOponente()}`);
    escribirLog(`Comienza el turno de ${obtenerNombreVisibleOponente()}.`);

    if (huboEstados) {
        renderizarTablero();
        if (verificarFinDePartida()) {
            return;
        }
    }

    await rellenarSlotsVacios(mazoOponente, cartasOponenteEnJuego, 'oponente');
    renderizarTablero();

    if (verificarFinDePartida()) {
        return;
    }

    mostrarAvisoTurno(`Turno de ${obtenerNombreVisibleOponente()}`, 2200);

    if (obtenerIndicesCartasDisponibles(cartasOponenteEnJuego).length === 0) {
        escribirLog(`${obtenerNombreVisibleOponente()} no tiene cartas disponibles para atacar.`);
        finalizarTurnoOponente();
        return;
    }

    if (obtenerIndicesCartasDisponibles(cartasJugadorEnJuego).length === 0) {
        escribirLog(`No tienes cartas en mesa. ${obtenerNombreVisibleOponente()} pasa turno.`);
        finalizarTurnoOponente();
        return;
    }

    ejecutarAtaqueBot();
}

function abandonarPartida() {
    mostrarModalConfirmarAbandono().then(confirmado => {
        if (!confirmado) {
            return;
        }
        if (ES_MODO_PVP && socketPvp && PVP_SESSION_ID) {
            socketPvp.emit('multiplayer:pvp:abandonar', { sessionId: PVP_SESSION_ID });
        }
        abandonarVistaConLimpieza(ES_MODO_PVP ? 'multijugador.html' : 'vistaJuego.html');
    });
}

function limpiarEstadoPartidaEnCurso() {
    partidaFinalizada = true;
    atacanteSeleccionado = null;
    cartasQueYaAtacaron = [];
    pvpCartasAgotadasConfirmadas = [];
    pvpRetrasoHabilidadHastaTs = 0;
    pvpUltimaAccionPayload = null;
    pvpAccionesPorRevision.clear();
    pvpMantenerOpacidadFinTurno = false;
    pvpEstadoProcesando = false;
    pvpTurnoSocketPendiente = null;
    pvpEstadoPayloadPendiente = null;
    if (pvpAvisoHabilidadTimer) {
        clearTimeout(pvpAvisoHabilidadTimer);
        pvpAvisoHabilidadTimer = null;
    }
    if (pvpTurnoAplicacionTimer) {
        clearTimeout(pvpTurnoAplicacionTimer);
        pvpTurnoAplicacionTimer = null;
    }
    if (pvpResetDestacadosTimer) {
        clearTimeout(pvpResetDestacadosTimer);
        pvpResetDestacadosTimer = null;
    }
    pvpPendienteEmitirFinTurno = false;
    if (pvpFinTurnoFallbackTimer) {
        clearTimeout(pvpFinTurnoFallbackTimer);
        pvpFinTurnoFallbackTimer = null;
    }
    if (pvpFinTurnoDelayTimer) {
        clearTimeout(pvpFinTurnoDelayTimer);
        pvpFinTurnoDelayTimer = null;
    }
    localStorage.removeItem('mazoJugador');
    localStorage.removeItem('mazoJugadorBase');
    localStorage.removeItem('mazoOponente');
    localStorage.removeItem('mazoOponenteBase');
    localStorage.removeItem('desafioActivo');
    localStorage.removeItem('partidaRecompensada');
    localStorage.removeItem('partidaModo');
    localStorage.removeItem('partidaPvpSessionId');
    localStorage.removeItem('partidaPvpRol');
    localStorage.removeItem('partidaPvpPrimerTurno');
    localStorage.removeItem('partidaPvpInicialesJugadorIdx');
    localStorage.removeItem('partidaPvpInicialesOponenteIdx');
    localStorage.removeItem('nombreOponente');
    localStorage.removeItem('avatarOponente');
    localStorage.removeItem('emailOponente');
}

function abandonarVistaConLimpieza(destino = 'vistaJuego.html') {
    proteccionSalidaActiva = false;
    sessionStorage.removeItem('dc_tablero_abandonado');
    limpiarEstadoPartidaEnCurso();
    window.location.replace(destino);
}

function mostrarModalConfirmarAbandono() {
    return new Promise(resolve => {
        const modal = document.getElementById('modal-abandonar-partida');
        const btnConfirmar = document.getElementById('modal-abandonar-confirmar');
        const btnCancelar = document.getElementById('modal-abandonar-cancelar');
        const mensaje = document.getElementById('modal-abandonar-mensaje');
        if (!modal || !btnConfirmar || !btnCancelar) {
            resolve(window.confirm(MENSAJE_SALIDA_PARTIDA));
            return;
        }
        if (mensaje) {
            mensaje.textContent = MENSAJE_SALIDA_PARTIDA;
        }
        const cerrar = (ok) => {
            btnConfirmar.onclick = null;
            btnCancelar.onclick = null;
            modal.style.display = 'none';
            resolve(ok);
        };
        btnConfirmar.onclick = () => cerrar(true);
        btnCancelar.onclick = () => cerrar(false);
        modal.style.display = 'flex';
    });
}

function reiniciarPartida() {
    if (ES_MODO_PVP) {
        if (typeof window.limpiarEstadoPvpResiduoPartidaLocal === 'function') {
            window.limpiarEstadoPvpResiduoPartidaLocal();
        }
        window.location.href = 'multijugador.html';
        return;
    }
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
    if (ES_MODO_PVP) {
        if (typeof window.limpiarEstadoPvpResiduoPartidaLocal === 'function') {
            window.limpiarEstadoPvpResiduoPartidaLocal();
        }
        window.location.href = 'multijugador.html';
        return;
    }
    const esEventoActivo = Boolean(estadoDesafio.activo && desafioActivo?.tipo === 'evento');
    const esDesafioActivo = Boolean(estadoDesafio.activo && !esEventoActivo);
    if (esDesafioActivo) {
        window.location.href = 'desafios.html';
        return;
    }
    window.location.href = 'vistaJuego.html';
}

document.addEventListener('DOMContentLoaded', () => {
    if (sessionStorage.getItem('dc_tablero_abandonado') === '1') {
        sessionStorage.removeItem('dc_tablero_abandonado');
        window.location.replace('vistaJuego.html');
        return;
    }

    window.addEventListener('beforeunload', (event) => {
        if (!proteccionSalidaActiva || partidaFinalizada) {
            return;
        }
        event.preventDefault();
        event.returnValue = MENSAJE_SALIDA_PARTIDA;
    });

    window.addEventListener('pagehide', () => {
        if (!proteccionSalidaActiva || partidaFinalizada) {
            return;
        }
        sessionStorage.setItem('dc_tablero_abandonado', '1');
        limpiarEstadoPartidaEnCurso();
    });

    asegurarPanelDebug();
    intentarInicializarSocketPvp();
    configurarNombresTablero();
    cargarCartasIniciales();
    escribirDebug('INIT', { desafioActivo: obtenerDesafioActivo(), estado: snapshotTableroDebug() });
});
