/**
 * Partida cooperativa online vs BOT (4+2+2). Aislado de partida.js / PvP.
 */
(function () {
    const AVATAR_FALLBACK = 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';

    const payloadRaw = localStorage.getItem('partidaCoopPayload');
    const modo = String(localStorage.getItem('partidaModo') || '').trim();
    let payload = null;
    try {
        payload = payloadRaw ? JSON.parse(payloadRaw) : null;
    } catch (_e) {
        payload = null;
    }

    if (!payload?.sessionId || modo !== 'coop_evento_online') {
        window.location.replace('multijugador.html');
        return;
    }

    const SESSION_ID = String(payload.sessionId || '').trim();
    const MI_EMAIL = String(localStorage.getItem('email') || '').trim().toLowerCase();
    const ROL = String(payload.rolCoop || 'A').trim().toUpperCase() === 'B' ? 'B' : 'A';
    const EMAIL_LEADER = String(payload.emailLeader || payload.jugadorA?.email || '').trim().toLowerCase();
    const EMAIL_MEMBER = String(payload.emailMember || payload.jugadorB?.email || '').trim().toLowerCase();
    const EJECUTOR_BOT_EMAIL = String(payload.ejecutorBotEmail || EMAIL_LEADER || '').trim().toLowerCase();

    let snapshot = payload.snapshot ? JSON.parse(JSON.stringify(payload.snapshot)) : null;
    const coopHealDebuffFactors = { A: 1, B: 1, bot: 1 };
    /** Revisión confirmada por el servidor (eco de `multiplayer:coop:estado`). */
    let revisionConfirmada = Number(payload.revision ?? snapshot?.revision ?? 0);

    function normalizarCartaCombateCoop(carta) {
        if (!carta || typeof carta !== 'object') return carta;
        const saludMax = Number(carta.SaludMax ?? carta.saludMax);
        const saludActual = Number(carta.Salud ?? carta.salud);
        const base = Number.isFinite(saludMax) && saludMax > 0
            ? saludMax
            : (Number.isFinite(saludActual) && saludActual > 0 ? saludActual : Math.max(1, Number(carta.Poder || 0)));
        carta.SaludMax = base;
        carta.Salud = Math.max(0, Math.min(Number.isFinite(saludActual) ? saludActual : base, base));
        carta.escudoActual = Math.max(0, Number(carta.escudoActual || 0));
        carta.poderModHabilidad = Number(carta.poderModHabilidad || 0);
        carta.habilidadUsadaPartida = Boolean(carta.habilidadUsadaPartida);
        carta.habilidadCooldownRestante = Math.max(0, Number(carta.habilidadCooldownRestante || 0));
        carta.habilidadAutoAplicadaEnJuego = Boolean(carta.habilidadAutoAplicadaEnJuego);
        carta.stunRestante = Math.max(0, Number(carta.stunRestante || 0));
        carta.stunSkillName = String(carta.stunSkillName || '').trim();
        carta.tankActiva = Boolean(carta.tankActiva);
        carta.lifeStealActiva = Boolean(carta.lifeStealActiva);
        if (typeof window.recalcularSkillPowerPorNivel === 'function' && carta.skill_class) {
            const baseCatalogo = carta.skill_power_base ?? carta.skill_power;
            if (carta.skill_power_base === undefined || carta.skill_power_base === null || String(carta.skill_power_base).trim() === '') {
                carta.skill_power_base = baseCatalogo;
            }
            window.recalcularSkillPowerPorNivel(carta, Number(carta.Nivel || 1), { rawEsBase: true });
        }
        carta.efectosDot = Array.isArray(carta.efectosDot)
            ? carta.efectosDot
                .map((fx) => {
                    const dano = Math.max(1, Math.floor(Number(fx?.danoPorTurno || 0)));
                    const turnos = Math.max(0, Math.floor(Number(fx?.turnosRestantes || 0)));
                    if (turnos <= 0) return null;
                    return {
                        danoPorTurno: dano,
                        turnosRestantes: turnos,
                        skillName: String(fx?.skillName || '').trim()
                    };
                })
                .filter(Boolean)
            : [];
        return carta;
    }

    function normalizarSnapshotCoop(snap) {
        if (!snap || typeof snap !== 'object') return;
        const mk = (x) => (Array.isArray(x) ? x : []);
        snap.cartasEnJuegoBot = mk(snap.cartasEnJuegoBot);
        snap.cartasEnJuegoA = mk(snap.cartasEnJuegoA);
        snap.cartasEnJuegoB = mk(snap.cartasEnJuegoB);
        while (snap.cartasEnJuegoBot.length < 4) snap.cartasEnJuegoBot.push(null);
        while (snap.cartasEnJuegoA.length < 2) snap.cartasEnJuegoA.push(null);
        while (snap.cartasEnJuegoB.length < 2) snap.cartasEnJuegoB.push(null);
        snap.mazoBot = mk(snap.mazoBot);
        snap.mazoA = mk(snap.mazoA);
        snap.mazoB = mk(snap.mazoB);
        snap.cementerioBot = mk(snap.cementerioBot);
        snap.cementerioA = mk(snap.cementerioA);
        snap.cementerioB = mk(snap.cementerioB);
        snap.cartasYaAtacaronA = mk(snap.cartasYaAtacaronA);
        snap.cartasYaAtacaronB = mk(snap.cartasYaAtacaronB);
        snap.cartasYaAtacaronBot = mk(snap.cartasYaAtacaronBot);
        snap.cartasEnJuegoBot.forEach(normalizarCartaCombateCoop);
        snap.cartasEnJuegoA.forEach(normalizarCartaCombateCoop);
        snap.cartasEnJuegoB.forEach(normalizarCartaCombateCoop);
        if (!Object.prototype.hasOwnProperty.call(snap, 'bossPendienteCoop')) {
            snap.bossPendienteCoop = null;
        }
    }

    if (snapshot) normalizarSnapshotCoop(snapshot);
    let partidaFinalizada = false;
    let procesandoBot = false;
    /** Evita doble envío mientras se resuelve un ataque humano. */
    let aplicandoAccionCoop = false;

    /**
     * Estado de la animación de entrada inicial (apertura de partida): mientras está activa,
     * `renderSlotsPlano` mantiene ocultas (opacity 0) las cartas cuyo slot todavía NO ha sido
     * revelado por `animarEntradaInicialCoop`. Los `renderTodo()` que se disparen durante la
     * animación (toast de turno, etc.) no vuelven a hacer aparecer las cartas todavía no entradas.
     */
    let coopAnimEntradaInicialActiva = false;
    const coopSlotsAperturaRevelados = new Set();

    let atacanteSel = null;
    let atacanteZona = null;
    /** Resaltado temporal durante animación de impacto (como carta-atacando / carta-objetivo en partida.js). */
    let coopAnimAtacante = null;
    let coopAnimObjetivo = null;

    /** Emisor que ya animó localmente: no repetir replay al recibir el eco (misma idea que actor en PvP). */
    let coopSaltarReplayProximaRevision = null;
    /** Ejecutor ya mostró el relleno de mazos al cerrar el ciclo BOT: no repetir `animarEntradaRellenosCicloBotPostAplicar` en el eco. */
    let coopSaltarAnimRellenoCicloRevision = null;
    /** Callback que cierra la promesa de `emitSnapshotCoopYEsperarEco` al llegar el eco correcto. */
    let coopEmitDone = null;
    /** Revisión local al emitir; el eco debe tener `revision` mayor para cerrar la espera. */
    let coopEmitRevAntes = null;
    let coopEmitTimerEsperaEco = null;
    /** Timestamp mínimo (Date.now) para permitir arranque BOT tras transición P2→BOT. */
    let coopBloqueoArranqueBotHastaMs = 0;
    /** Serializa `dc:coop-estado` para no solapar animaciones entre revisiones. */
    let coopCadenaEstadosRed = Promise.resolve();
    /**
     * Metadata explícita por revisión que acompaña al snapshot correspondiente (ataque básico o habilidad).
     * Permite al observador animar sin inferir el atacante desde el diff.
     */
    const coopAccionesPorRevision = new Map();
    /** Marca local `sessionStorage` para no repetir la animación de entrada inicial al reentrar. */
    const COOP_CLAVE_ENTRADA_INICIAL = `coop-entrada-inicial:${SESSION_ID}`;
    /**
     * Ventana máxima (ms) que el emisor espera a que el servidor le devuelva su propio broadcast
     * antes de empezar a animar. Sirve para arrancar la animación casi al mismo tiempo que el observador
     * (ambos parten del mismo evento `multiplayer:coop:estado` de la sala) y reducir la latencia visible.
     * Si el RTT es menor que este umbral ambos quedan sincronizados; si es mayor, el emisor arranca solo.
     */
    const COOP_MS_ESPERA_ECO_SYNC = 150;

    /** Solo mostrar el toast de turno cuando cambie la fase (P1 / P2 / BOT), no en cada render. */
    let ultimaFaseCoopParaAvisoTurno = null;

    const COOP_MS_PRE_IMPACTO_ATAQUE = 540;
    const COOP_MS_POST_IMPACTO_ATAQUE = 760;
    /**
     * Cadencia específica del turno BOT (ataques básicos y BOSS multi-objetivo). Más cortas que las
     * humanas para que el ritmo del BOT no se sienta lento frente a PvP/VS BOT. SOLO se aplican en
     * `ejecutarTurnoBotSecuencial` y en `animarTransicionCoopDesdeDiff` cuando el atacante es BOT;
     * los ataques humanos siguen usando COOP_MS_PRE/POST_IMPACTO_ATAQUE.
     */
    const COOP_MS_PRE_IMPACTO_BOT = 380;
    const COOP_MS_POST_IMPACTO_BOT = 480;
    /** Evita que el primer ataque BOT arranque pegado al último impacto remoto de P2. */
    const COOP_MS_BLOQUEO_ARRANQUE_BOT_TRAS_P2 = 120;
    /** Misma pausa que en `resolverAtaqueHumanoAZona` cuando el daño afecta escudo (impacto visual sin barra completa). */
    const COOP_MS_IMPACTO_ESCUDO_HUMANO = 280;
    const COOLDOWN_HABILIDAD_ACTIVA_TURNOS = 2;
    const PAUSA_AVISO_HABILIDAD_MS = 2300;
    /** Pausa entre cartas robadas del mazo al rellenar slots (misma base que `rellenarSlotsVacios` en partida.js). */
    const COOP_MS_ENTRE_ROBO_MAZO = 420;
    /**
     * Tras el último impacto del BOT, el ejecutor no reproduce el eco en cola (`marcarSaltarReplayVisual`);
     * sin esta pausa, cementerio + vaciado de slot y el salto a P1/robos se solapan en el cliente del líder.
     */
    const COOP_MS_RESPIRO_TRAS_ULTIMO_ATAQUE_BOT = 140;
    /** Aviso central de cambio de fase (nombre + tiempo de lectura). */
    const COOP_MS_AVISO_CAMBIO_FASE = 2200;

    /** Un solo temporizador para `#aviso-turno-coop` (turno + habilidades); evita que un hide viejo quite el aviso del compañero. */
    let avisoTurnoCoopHideTimer = null;

    function programarOcultarAvisoTurnoCoop(avisoEl, delayMs) {
        if (avisoTurnoCoopHideTimer !== null) {
            clearTimeout(avisoTurnoCoopHideTimer);
            avisoTurnoCoopHideTimer = null;
        }
        const ms = Math.max(200, Number(delayMs) || 800);
        avisoTurnoCoopHideTimer = setTimeout(() => {
            avisoTurnoCoopHideTimer = null;
            if (avisoEl && avisoEl.classList) {
                avisoEl.classList.remove('visible');
            }
        }, ms);
    }

    function esLider() {
        return MI_EMAIL === EMAIL_LEADER;
    }

    function esperar(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function logCoop(msg) {
        const el = document.getElementById('coop-log-mini');
        if (el) el.textContent = msg;
        console.log('[coop]', msg);
    }

    /** Depuración temporal coop online (paneles en tablero_coop). */
    const COOP_DEBUG_MAX_LINES = 320;

    function coopDebugTs() {
        const d = new Date();
        const p2 = (n) => String(n).padStart(2, '0');
        const p3 = (n) => String(n).padStart(3, '0');
        return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${p3(d.getMilliseconds())}`;
    }

    function coopDebugAppend(elId, texto) {
        const el = document.getElementById(elId);
        if (!el) return;
        const row = document.createElement('div');
        row.textContent = `${coopDebugTs()} ${String(texto || '').trim()}`;
        el.appendChild(row);
        while (el.childNodes.length > COOP_DEBUG_MAX_LINES) {
            el.removeChild(el.firstChild);
        }
        el.scrollTop = el.scrollHeight;
    }

    function coopDebugYo(line) {
        coopDebugAppend('coop-debug-cliente-yo', `R${ROL} ${line}`);
    }

    function coopDebugEco(line) {
        coopDebugAppend('coop-debug-cliente-otro', `R${ROL} ${line}`);
    }

    function coopDebugServidor(line) {
        coopDebugAppend('coop-debug-servidor', line);
    }

    function mostrarAvisoHabilidadCoop(texto, duracionMs = PAUSA_AVISO_HABILIDAD_MS) {
        const aviso = document.getElementById('aviso-turno-coop');
        if (!aviso) return;
        aviso.textContent = String(texto || '').trim();
        aviso.classList.add('visible');
        const dur = Math.max(300, Number(duracionMs || PAUSA_AVISO_HABILIDAD_MS));
        programarOcultarAvisoTurnoCoop(aviso, dur);
    }

    function construirMensajeUsoHabilidadActiva(nombreCarta, nombreHabilidad, objetivoTexto) {
        const carta = String(nombreCarta || 'Carta').trim();
        const habilidad = String(nombreHabilidad || 'Habilidad').trim();
        const objetivo = String(objetivoTexto || carta).trim();
        return `${carta} utiliza su habilidad ${habilidad} en ${objetivo}`;
    }

    async function anunciarUsoHabilidadActivaCoop(carta, meta, objetivoTexto) {
        const mensaje = construirMensajeUsoHabilidadActiva(carta?.Nombre, meta?.nombre, objetivoTexto);
        mostrarAvisoHabilidadCoop(mensaje, PAUSA_AVISO_HABILIDAD_MS);
        await esperar(PAUSA_AVISO_HABILIDAD_MS);
    }

    /**
     * Anuncio + números flotantes reproducidos en ambos clientes al procesar el eco (ver `coopReplayVisual` en snapshot).
     * `soloAnuncio`: solo mensaje central (p. ej. `extra_attack` antes del diff de daño en el observador).
     * `omitirAnuncio`: no repetir el mensaje (p. ej. tras mostrarlo ya antes del daño).
     */
    async function animarBarraImpactoCoopDesdeFloat(snapAntes, snapDespues, f) {
        if (!f || typeof f !== 'object' || !snapAntes || !snapDespues) return;
        const clase = String(f.claseVisual || '').trim();
        if (clase !== 'escudo' && clase !== 'cura') return;
        const zona = f.zona;
        const slot = Number(f.slot);
        if ((zona !== 'A' && zona !== 'B' && zona !== 'bot') || !Number.isFinite(slot)) return;

        const prevMesa = obtenerMesaEnSnapshot(snapAntes, zona);
        const proxMesa = obtenerMesaEnSnapshot(snapDespues, zona);
        const c0 = prevMesa[slot];
        const c1 = proxMesa[slot];
        const live = obtenerMesaPorZona(zona)[slot];
        if (!c0 || !live) return;

        const salHpIni = obtenerSaludActualCarta(c0);
        const salHpFin = c1 ? obtenerSaludActualCarta(c1) : salHpIni;
        const escIni = Math.max(0, Number(c0.escudoActual || 0));
        const escFin = Math.max(0, Number((c1 || c0).escudoActual || 0));

        restaurarSaludEscudoVisual(live, salHpIni, escIni);
        renderTodo();

        if (clase === 'escudo') {
            await animarBajadaSaludCartaCoop(zona, slot, salHpIni, salHpIni, {
                escudoInicial: escIni,
                escudoFinal: escFin,
                esEscudo: true
            });
        } else {
            await animarBajadaSaludCartaCoop(zona, slot, salHpIni, salHpFin, {
                escudoInicial: escIni,
                escudoFinal: escFin,
                esCura: true
            });
        }

        if (c1) {
            restaurarSaludEscudoVisual(live, salHpFin, escFin);
            renderTodo();
        }
    }

    async function ejecutarCoopReplayVisual(rep, opts = {}) {
        if (!rep || typeof rep !== 'object') return;
        const omitirAnuncio = Boolean(opts.omitirAnuncio);
        const soloAnuncio = Boolean(opts.soloAnuncio);
        const snapAntes = opts.snapAntes;
        const snapDespues = opts.snapDespues;
        const ms = Math.max(300, Number(rep.msAviso || PAUSA_AVISO_HABILIDAD_MS));
        const txt = String(rep.textoAnuncio || '').trim();
        if (!omitirAnuncio && txt) {
            mostrarAvisoHabilidadCoop(txt, ms);
            await esperar(ms);
        }
        if (soloAnuncio) return;
        const floats = Array.isArray(rep.floats) ? rep.floats : [];
        for (let fi = 0; fi < floats.length; fi += 1) {
            const f = floats[fi];
            if (!f || typeof f !== 'object') continue;
            const zona = f.zona;
            const slot = Number(f.slot);
            if (zona !== 'A' && zona !== 'B' && zona !== 'bot') continue;
            if (!Number.isFinite(slot)) continue;
            mostrarValorFlotanteCoop(
                zona,
                slot,
                f.valor,
                f.tipoImpacto === 'oponente' ? 'oponente' : 'jugador',
                f.claseVisual || 'danio'
            );
            if (snapAntes && snapDespues) {
                await animarBarraImpactoCoopDesdeFloat(snapAntes, snapDespues, f);
            }
        }
    }

    function atacanteDesdeReplayCoop(replay) {
        if (!replay || typeof replay !== 'object') return null;
        const zona = String(replay.actorZona || '').trim();
        const slot = Number(replay.actorSlot);
        if ((zona !== 'A' && zona !== 'B' && zona !== 'bot') || !Number.isInteger(slot)) {
            return null;
        }
        if ((zona === 'A' || zona === 'B') && (slot < 0 || slot > 1)) return null;
        if (zona === 'bot' && (slot < 0 || slot > 3)) return null;
        return { zona, slot };
    }

    async function animarTransicionCoopAoeDesdeReplay(prev, prox, replay) {
        if (!prev || !prox || !replay || typeof replay !== 'object') return;
        const impactosPrev = Array.isArray(replay.floats) ? replay.floats.length : 0;
        coopDebugEco(`anim AoE hits=${impactosPrev}`);
        const msAviso = Math.max(300, Number(replay.msAviso || PAUSA_AVISO_HABILIDAD_MS));
        const txtAviso = String(replay.textoAnuncio || '').trim();
        if (txtAviso) {
            mostrarAvisoHabilidadCoop(txtAviso, msAviso);
            await esperar(msAviso);
        }
        const impactos = Array.isArray(replay.floats) ? replay.floats : [];
        if (!impactos.length) return;
        const primerZonaHum = impactos.find((h) => h && (h.zona === 'A' || h.zona === 'B'));
        const atk = atacanteDesdeReplayCoop(replay)
            || inferirSlotAtacanteCoop(prev, prox, primerZonaHum ? primerZonaHum.zona : 'bot');
        for (const hit of impactos) {
            if (!hit || typeof hit !== 'object') continue;
            const zonaObj = hit.zona;
            const slotObj = Number(hit.slot);
            if ((zonaObj !== 'A' && zonaObj !== 'B' && zonaObj !== 'bot') || !Number.isFinite(slotObj)) continue;

            const key = zonaObj === 'bot' ? 'cartasEnJuegoBot' : zonaObj === 'A' ? 'cartasEnJuegoA' : 'cartasEnJuegoB';
            const prevMesa = prev[key] || [];
            const proxMesa = prox[key] || [];
            const c0 = prevMesa[slotObj];
            const c1 = proxMesa[slotObj];
            const mesaSnap = obtenerMesaPorZona(zonaObj);
            const live = mesaSnap[slotObj];
            /** `c0` confirma que había carta en el eco anterior; la animación debe leer salud/escudo del `snapshot` vivo. */
            if (!c0 || !live) continue;

            /**
             * Si tras el AoE el mazo BOT repuso el slot con otra carta, `c1` es una carta distinta:
             * tratamos el impacto como letal sobre la original y la carta nueva aparecerá cuando se
             * aplique `snapDespuesCanon` al final de la animación.
             */
            const cambioCarta = Boolean(c1) && String(c0.Nombre || '') !== String(c1.Nombre || '');
            const saludRawIni = obtenerSaludActualCarta(live);
            const escIni = Math.max(0, Number(live.escudoActual || 0));
            const saludRawFin = (c1 && !cambioCarta) ? obtenerSaludActualCarta(c1) : 0;
            const escFin = (c1 && !cambioCarta) ? Math.max(0, Number(c1.escudoActual || 0)) : 0;
            const esLetal = !c1 || cambioCarta;
            const impactoEsc = escIni > 0 || escFin > 0;
            const danioMostrar = Math.max(1, Number(hit.valor) || 1);

            coopAnimAtacante = atk;
            coopAnimObjetivo = { zona: zonaObj, slot: slotObj };
            renderTodo();
            await esperar(COOP_MS_PRE_IMPACTO_ATAQUE);

            mostrarValorFlotanteCoop(
                zonaObj,
                slotObj,
                danioMostrar,
                zonaObj === 'A' || zonaObj === 'B' ? 'jugador' : 'oponente',
                'danio'
            );

            if (esLetal) {
                await animarBajadaSaludCartaCoop(zonaObj, slotObj, saludRawIni, 0, {
                    escudoInicial: escIni,
                    escudoFinal: 0
                });
            } else if (impactoEsc) {
                live.Salud = saludRawFin;
                live.escudoActual = escFin;
                renderTodo();
                await esperar(COOP_MS_IMPACTO_ESCUDO_HUMANO);
            } else {
                await animarBajadaSaludCartaCoop(zonaObj, slotObj, saludRawIni, saludRawFin, {
                    escudoInicial: escIni,
                    escudoFinal: escFin
                });
            }

            limpiarCoopAnimHighlights();
            renderTodo();
            await esperar(COOP_MS_POST_IMPACTO_ATAQUE);
        }
    }

    async function animarTransicionCoopExtraAttackDesdeReplay(prev, prox, replay) {
        if (!prev || !prox || !replay || typeof replay !== 'object') return false;
        const extra = replay.extraAttack;
        if (!extra || typeof extra !== 'object') return false;

        const zonaObj = extra.zonaObjetivo;
        const slotObj = Number(extra.slotObjetivo);
        const zonaAtk = extra.zonaAtacante;
        const slotAtk = Number(extra.slotAtacante);
        if ((zonaObj !== 'A' && zonaObj !== 'B' && zonaObj !== 'bot') || !Number.isInteger(slotObj)) return false;
        if ((zonaAtk !== 'A' && zonaAtk !== 'B' && zonaAtk !== 'bot') || !Number.isInteger(slotAtk)) return false;

        coopDebugEco(`anim extra_attack ${zonaAtk}:${slotAtk}→${zonaObj}:${slotObj}`);
        const msAviso = Math.max(300, Number(replay.msAviso || PAUSA_AVISO_HABILIDAD_MS));
        const txtAviso = String(replay.textoAnuncio || '').trim();
        if (txtAviso) {
            mostrarAvisoHabilidadCoop(txtAviso, msAviso);
            await esperar(msAviso);
        }

        const danioMostrar = Math.max(1, Number(extra.danioMostrar || 1));
        const saludRawIni = Math.max(0, Number(extra.saludRawIni || 0));
        const saludRawFin = Math.max(0, Number(extra.saludRawFin || 0));
        const escIni = Math.max(0, Number(extra.escIni || 0));
        const escFin = Math.max(0, Number(extra.escFin || 0));
        const esLetal = Boolean(extra.esLetal);
        const impactoEsc = escIni > 0 || escFin > 0;

        const mesaObj = obtenerMesaPorZona(zonaObj);
        const live = mesaObj[slotObj];
        if (!live && !esLetal) return false;

        coopAnimAtacante = { zona: zonaAtk, slot: slotAtk };
        coopAnimObjetivo = { zona: zonaObj, slot: slotObj };
        if (live) {
            restaurarSaludEscudoVisual(live, saludRawIni, escIni);
        }
        renderTodo();
        await esperar(COOP_MS_PRE_IMPACTO_ATAQUE);

        const tipoFloat = (zonaObj === 'A' || zonaObj === 'B') ? 'jugador' : 'oponente';
        mostrarValorFlotanteCoop(zonaObj, slotObj, danioMostrar, tipoFloat, 'danio');

        if (esLetal && live) {
            await animarBajadaSaludCartaCoop(zonaObj, slotObj, saludRawIni, 0, {
                escudoInicial: escIni,
                escudoFinal: 0
            });
        } else if (!esLetal && impactoEsc && live) {
            restaurarSaludEscudoVisual(live, saludRawFin, escFin);
            renderTodo();
            await esperar(COOP_MS_IMPACTO_ESCUDO_HUMANO);
        } else if (!esLetal && live) {
            await animarBajadaSaludCartaCoop(zonaObj, slotObj, saludRawIni, saludRawFin, {
                escudoInicial: escIni,
                escudoFinal: escFin
            });
        }

        limpiarCoopAnimHighlights();
        renderTodo();
        await esperar(COOP_MS_POST_IMPACTO_ATAQUE);
        return true;
    }

    function tipoFloatImpactoParaZonaCarta(zonaCarta) {
        return zonaCarta === 'bot' ? 'oponente' : 'jugador';
    }

    function limpiarCoopAnimHighlights() {
        coopAnimAtacante = null;
        coopAnimObjetivo = null;
    }

    function obtenerCoopTableroRoot() {
        return document.querySelector('.tablero-coop-tablero-inner')
            || document.querySelector('.tablero-coop-wrap')
            || document.body;
    }

    function obtenerSlotElementCoop(zona, slotIdx) {
        const root = obtenerCoopTableroRoot();
        return root.querySelector(`.slot[data-zona="${zona}"][data-slot="${String(slotIdx)}"]`);
    }

    /** Misma idea que `animarCartaRobada` en partida.js: animación al robar y colocar en mesa. */
    function animarCartaRobadaCoop(zona, slotIdx) {
        const slot = obtenerSlotElementCoop(zona, slotIdx);
        const carta = slot?.querySelector('.carta');
        if (!carta) return;
        carta.classList.remove('carta-robada');
        void carta.offsetWidth;
        carta.classList.add('carta-robada');
    }

    function listaSlotsNuevosRellenoMesa(prev, prox) {
        if (!prev || !prox) return [];
        const out = [];
        const zonas = [
            { zona: 'bot', key: 'cartasEnJuegoBot', n: 4 },
            { zona: 'A', key: 'cartasEnJuegoA', n: 2 },
            { zona: 'B', key: 'cartasEnJuegoB', n: 2 }
        ];
        for (const { zona, key, n } of zonas) {
            const pm = prev[key] || [];
            const px = prox[key] || [];
            for (let i = 0; i < n; i += 1) {
                if (!pm[i] && px[i]) out.push({ zona, slot: i });
            }
        }
        return out;
    }

    /**
     * Tras un eco con nuevo ciclo (fase P1), revela sucesivamente las cartas robadas (observador / compañero).
     * Requiere que el snapshot global ya sea `prox` y el DOM esté renderizado.
     */
    async function animarEntradaRellenosCicloBotPostAplicar(prev, prox) {
        if (partidaFinalizada) return;
        if (!prev || !prox) return;
        if (prev.faseCoop !== 'BOT' || prox.faseCoop !== 'P1') return;
        const pasos = listaSlotsNuevosRellenoMesa(prev, prox);
        if (pasos.length === 0) return;
        for (let p = 0; p < pasos.length; p += 1) {
            const { zona, slot } = pasos[p];
            const slotEl = obtenerSlotElementCoop(zona, slot);
            const carta = slotEl?.querySelector('.carta');
            if (carta) carta.style.opacity = '0';
        }
        await esperar(12);
        for (let p = 0; p < pasos.length; p += 1) {
            const { zona, slot } = pasos[p];
            const slotEl = obtenerSlotElementCoop(zona, slot);
            const carta = slotEl?.querySelector('.carta');
            if (carta) {
                carta.style.opacity = '1';
                animarCartaRobadaCoop(zona, slot);
            }
            await esperar(COOP_MS_ENTRE_ROBO_MAZO);
        }
        for (let p = 0; p < pasos.length; p += 1) {
            const { zona, slot } = pasos[p];
            const slotEl = obtenerSlotElementCoop(zona, slot);
            slotEl?.querySelector('.carta')?.style.removeProperty('opacity');
        }
    }

    /** Cartas enemigas para salud efectiva (heal_debuff) usando un snapshot concreto. */
    function enemigosSaludParaZonaDesdeSnapshot(zonaCarta, snap) {
        if (!snap) return [];
        if (zonaCarta === 'bot') {
            return [...(snap.cartasEnJuegoA || []), ...(snap.cartasEnJuegoB || [])].filter(Boolean);
        }
        /** Aliados humanos: solo el BOT aplica heal_debuff; P1 y P2 no se penalizan entre sí. */
        return [...(snap.cartasEnJuegoBot || [])].filter(Boolean);
    }

    function enemigosSaludParaZonaCoop(zonaCarta) {
        return enemigosSaludParaZonaDesdeSnapshot(zonaCarta, snapshot);
    }

    function sincronizarHealDebuffCoop() {
        const H = window.DCHealDebuffCombat;
        if (!H || !snapshot) return;
        ['A', 'B', 'bot'].forEach((zona) => {
            const enemigos = enemigosSaludParaZonaCoop(zona);
            const mesa = obtenerMesaPorZona(zona);
            const factorNuevo = H.obtenerFactorHealDebuff(enemigos);
            const factorAnterior = coopHealDebuffFactors[zona] ?? 1;
            H.sincronizarCartasConFactor(mesa, factorAnterior, factorNuevo);
            coopHealDebuffFactors[zona] = factorNuevo;
        });
    }

    function inferirAtacanteBotActivoDesdeProx(prox) {
        if (!prox) return null;
        const mesaBot = prox.cartasEnJuegoBot || [];
        const yaBot = prox.cartasYaAtacaronBot || [];
        for (let slot = 0; slot < 4; slot += 1) {
            if (yaBot.includes(slot)) continue;
            if (cartaViva(mesaBot[slot])) {
                return { zona: 'bot', slot };
            }
        }
        return null;
    }

    /**
     * `zonaObjetivoDaño`: zona del primer cambio de vida (o hint en AoE). Evita atribuir al jugador humano
     * un ataque del BOT cuando el diff incluye daño en A/B en fase BOT (mismo slot atacante/objetivo).
     * Transición P2→BOT / P1→P2 con daño en `bot`: el eco puede traer `cartasYaAtacaron*` vacío al cambiar de fase;
     * entonces el atacante es el primer slot vivo de esa mesa que en `prev` aún no estaba en la lista de "ya atacó".
     */
    function inferirSlotAtacanteCoop(prev, prox, zonaObjetivoDaño) {
        if (!prox) return null;
        const fP = prev && prev.faseCoop;
        const fX = prox.faseCoop;
        const zObj = zonaObjetivoDaño;

        const dañoEnMesaHumana = zObj === 'A' || zObj === 'B';
        if (dañoEnMesaHumana && (fX === 'BOT' || fP === 'BOT')) {
            return inferirAtacanteBotActivoDesdeProx(prox);
        }

        /**
         * Tras el último ataque de la fase, `avanzarFaseTrasHumanoEnSnapshot` vacía `cartasYaAtacaronA|B`;
         * el eco trae `prox` ya en la fase nueva con array vacío. No usar solo el último índice de `prev`:
         * el atacante es el primer slot vivo de esa mesa que en `prev` aún no constaba como "ya atacó".
         */
        if (zObj === 'bot' && fP === 'P2' && fX === 'BOT') {
            const mesaB = (prev && prev.cartasEnJuegoB) || [];
            const ya = (prev && prev.cartasYaAtacaronB) || [];
            for (let s = 0; s < mesaB.length && s < 2; s += 1) {
                if (ya.includes(s)) continue;
                if (cartaViva(mesaB[s])) return { zona: 'B', slot: s };
            }
            if (Array.isArray(ya) && ya.length) return { zona: 'B', slot: ya[ya.length - 1] };
        }

        if (zObj === 'bot' && fP === 'P1' && fX === 'P2') {
            const mesaA = (prev && prev.cartasEnJuegoA) || [];
            const ya = (prev && prev.cartasYaAtacaronA) || [];
            for (let s = 0; s < mesaA.length && s < 2; s += 1) {
                if (ya.includes(s)) continue;
                if (cartaViva(mesaA[s])) return { zona: 'A', slot: s };
            }
            if (Array.isArray(ya) && ya.length) return { zona: 'A', slot: ya[ya.length - 1] };
        }

        const pa = prox.cartasYaAtacaronA || [];
        const pap = (prev && prev.cartasYaAtacaronA) || [];
        if (pa.length > pap.length) {
            const added = pa.filter(x => !pap.includes(x));
            const slot = added.length ? added[added.length - 1] : pa[pa.length - 1];
            return { zona: 'A', slot };
        }
        const pbb = prox.cartasYaAtacaronB || [];
        const pbpb = (prev && prev.cartasYaAtacaronB) || [];
        if (pbb.length > pbpb.length) {
            const added = pbb.filter(x => !pbpb.includes(x));
            const slot = added.length ? added[added.length - 1] : pbb[pbb.length - 1];
            return { zona: 'B', slot };
        }
        /**
         * Turno BOT: el eco se envía antes de `cartasYaAtacaronBot.push(ib)`, así que no hay diff de longitud.
         * El atacante activo es el primer slot en orden 0..3 vivo y aún no marcado como terminado.
         */
        return inferirAtacanteBotActivoDesdeProx(prox);
    }

    /**
     * Detecta un único cambio de vida entre snapshots (un eco = una acción de combate en coop).
     */
    function encontrarPrimerCambioDanioVisual(prev, prox) {
        const ui = window.tableroCoopCartaUi;
        if (!ui || typeof ui.obtenerSaludEfectiva !== 'function') return null;

        const zonas = [
            { zona: 'bot', key: 'cartasEnJuegoBot', n: 4 },
            { zona: 'A', key: 'cartasEnJuegoA', n: 2 },
            { zona: 'B', key: 'cartasEnJuegoB', n: 2 }
        ];

        for (const { zona, key, n } of zonas) {
            const pk = prox[key] || [];
            const prevk = prev[key] || [];
            const en0 = enemigosSaludParaZonaDesdeSnapshot(zona, prev);
            const en1 = enemigosSaludParaZonaDesdeSnapshot(zona, prox);
            for (let i = 0; i < n; i += 1) {
                const c0 = prevk[i];
                const c1 = pk[i];
                if (!c0 && !c1) continue;
                if (c0 && !c1) {
                    const tot0 = ui.obtenerSaludEfectiva(c0, en0).totalActual;
                    if (tot0 > 0) {
                        return {
                            zona,
                            slot: i,
                            esLetal: true,
                            danioMostrar: Math.max(1, Math.round(tot0)),
                            saludRawIni: obtenerSaludActualCarta(c0),
                            saludRawFin: 0,
                            escIni: Math.max(0, Number(c0.escudoActual || 0)),
                            escFin: 0
                        };
                    }
                    continue;
                }
                if (c0 && c1 && String(c0.Nombre || '') === String(c1.Nombre || '')) {
                    const t0 = ui.obtenerSaludEfectiva(c0, en0).totalActual;
                    const t1 = ui.obtenerSaludEfectiva(c1, en1).totalActual;
                    if (t1 < t0) {
                        return {
                            zona,
                            slot: i,
                            esLetal: false,
                            danioMostrar: Math.max(1, Math.round(t0 - t1)),
                            saludRawIni: obtenerSaludActualCarta(c0),
                            saludRawFin: obtenerSaludActualCarta(c1),
                            escIni: Math.max(0, Number(c0.escudoActual || 0)),
                            escFin: Math.max(0, Number(c1.escudoActual || 0))
                        };
                    }
                }
            }
        }
        return null;
    }

    /**
     * Reproduce la secuencia visual en el otro cliente (snapshot global sigue siendo `prev` hasta aplicar al final).
     */
    /**
     * `accionExplicita` (opcional) = metadata de la acción emitida (`multiplayer:coop:accion`).
     * Si viene, se usa directamente y no se infiere el atacante desde el diff.
     */
    async function animarTransicionCoopDesdeDiff(prev, prox, accionExplicita = null) {
        const cambio = encontrarPrimerCambioDanioVisual(prev, prox);
        if (!cambio) return;

        const atkExplicito = (() => {
            if (!accionExplicita || typeof accionExplicita !== 'object') return null;
            const zona = String(accionExplicita.zonaAtacante || '').trim();
            const slot = Number(accionExplicita.slotAtacante);
            if ((zona !== 'A' && zona !== 'B' && zona !== 'bot') || !Number.isInteger(slot)) return null;
            if ((zona === 'A' || zona === 'B') && (slot < 0 || slot > 1)) return null;
            if (zona === 'bot' && (slot < 0 || slot > 3)) return null;
            return { zona, slot };
        })();

        const atk = atkExplicito || inferirSlotAtacanteCoop(prev, prox, cambio.zona);
        coopDebugEco(`anim diff atk=${atk ? `${atk.zona}:${atk.slot}` : '?'} → ${cambio.zona}:${cambio.slot}${atkExplicito ? ' (explícito)' : ''}`);
        const { zona: zonaObj, slot: slotObj, esLetal, danioMostrar, saludRawIni, saludRawFin, escIni, escFin } = cambio;

        const mesaKey = zonaObj === 'bot' ? 'cartasEnJuegoBot' : zonaObj === 'A' ? 'cartasEnJuegoA' : 'cartasEnJuegoB';
        const live = snapshot[mesaKey][slotObj];
        if (!live && !esLetal) return;

        /**
         * Cadencia coherente con el ejecutor: cuando el atacante es BOT usamos la pareja
         * COOP_MS_PRE/POST_IMPACTO_BOT (más cortas) para que el observador no vaya por detrás
         * del ejecutor. En ataques humanos seguimos la cadencia humana clásica.
         */
        const esAtaqueBotObs = atk && atk.zona === 'bot';
        const msPreImpacto = esAtaqueBotObs ? COOP_MS_PRE_IMPACTO_BOT : COOP_MS_PRE_IMPACTO_ATAQUE;
        const msPostImpacto = esAtaqueBotObs ? COOP_MS_POST_IMPACTO_BOT : COOP_MS_POST_IMPACTO_ATAQUE;

        coopAnimAtacante = atk;
        coopAnimObjetivo = { zona: zonaObj, slot: slotObj };
        renderTodo();
        await esperar(msPreImpacto);

        const tipoFloat = (zonaObj === 'A' || zonaObj === 'B') ? 'jugador' : 'oponente';
        mostrarValorFlotanteCoop(zonaObj, slotObj, danioMostrar, tipoFloat, 'danio');

        const impactoEsc = escIni > 0 || escFin > 0;

        if (esLetal && live) {
            await animarBajadaSaludCartaCoop(zonaObj, slotObj, saludRawIni, 0, {
                escudoInicial: escIni,
                escudoFinal: 0
            });
        } else if (!esLetal && impactoEsc) {
            if (live) {
                live.Salud = saludRawFin;
                live.escudoActual = escFin;
                renderTodo();
                await esperar(COOP_MS_IMPACTO_ESCUDO_HUMANO);
            }
        } else if (!esLetal && live) {
            await animarBajadaSaludCartaCoop(zonaObj, slotObj, saludRawIni, saludRawFin, {
                escudoInicial: escIni,
                escudoFinal: escFin
            });
        }

        limpiarCoopAnimHighlights();
        renderTodo();
        await esperar(msPostImpacto);
    }

    function resolverEcoEmitSiCorresponde(revisionDet) {
        if (coopEmitRevAntes === null || typeof coopEmitDone !== 'function') return;
        if (!(Number(revisionDet) > coopEmitRevAntes)) return;
        coopEmitDone();
    }

    async function esperarFinAccionLocalCoop(maxMs = 600) {
        const inicio = Date.now();
        while (aplicandoAccionCoop) {
            if ((Date.now() - inicio) >= maxMs) break;
            await esperar(10);
        }
    }

    async function procesarEstadoCoopDesdeRed(det) {
        const prox = det.snapshot;
        const rev = Number(det.revision);
        if (!prox || typeof prox !== 'object') {
            return;
        }
        /**
         * El snapshot del eco puede llegar sin padding de huecos null; sin esto `proxMesa[slot]` puede ser
         * `undefined` mientras `prevMesa[slot]` tiene carta y se saltan todos los impactos AoE en el otro cliente.
         */
        normalizarSnapshotCoop(prox);

        /**
         * Si este cliente está terminando una acción local (p. ej. último ataque de P2), no empezar a pintar
         * el siguiente estado remoto (p. ej. primer ataque BOT) hasta cerrar su secuencia visual.
         */
        await esperarFinAccionLocalCoop();

        /** El eco del propio emit se resuelve en el listener de `dc:coop-estado` sin pasar por esta cola (ver ahí). */

        const prev = snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
        const replay = prox.coopReplayVisual && typeof prox.coopReplayVisual === 'object'
            ? JSON.parse(JSON.stringify(prox.coopReplayVisual))
            : null;
        const accionExplicita = consumirAccionCoopPorRevision(rev);

        coopDebugEco(
            `procesar inicio rev=${rev} ${prev?.faseCoop || '?'}→${prox.faseCoop} replay=${replay?.tipoAccion || '—'} accion=${accionExplicita ? accionExplicita.tipo : '—'}`
        );

        const replaySeEncargaAnim = Boolean(replay && replay.tipoAccion === 'aoe');
        const replayExtraAttackConAnim = Boolean(replay && replay.tipoAccion === 'extra_attack' && replay.extraAttack);
        const replayExtraAttack = Boolean(replay && replay.tipoAccion === 'extra_attack');
        try {
            if (prev && !partidaFinalizada) {
                if (replaySeEncargaAnim) {
                    await animarTransicionCoopAoeDesdeReplay(prev, prox, replay);
                } else if (replayExtraAttackConAnim) {
                    await animarTransicionCoopExtraAttackDesdeReplay(prev, prox, replay);
                } else {
                    if (replayExtraAttack) {
                        await ejecutarCoopReplayVisual(replay, { soloAnuncio: true });
                    }
                    await animarTransicionCoopDesdeDiff(prev, prox, accionExplicita);
                }
            }
        } catch (e) {
            console.error('[coop] anim estado remoto', e);
        }
        coopDebugEco(`procesar post-diff-anim rev=${rev}`);
        aplicarSnapshotRemoto(prox, rev);
        coopDebugEco(`procesar snapshot aplicado rev=${rev} fase=${snapshot?.faseCoop}`);
        try {
            if (replay && !replaySeEncargaAnim && !replayExtraAttackConAnim && !partidaFinalizada) {
                coopDebugEco(`replayVisual post-snapshot tipo=${replay.tipoAccion || '?'}`);
                if (replayExtraAttack) {
                    await ejecutarCoopReplayVisual(replay, {
                        omitirAnuncio: true,
                        snapAntes: prev,
                        snapDespues: prox
                    });
                } else {
                    await ejecutarCoopReplayVisual(replay, {
                        snapAntes: prev,
                        snapDespues: prox
                    });
                }
            }
        } catch (e) {
            console.error('[coop] replay visual habilidad', e);
        }
        let omitirAnimRellenoCiclo = false;
        if (coopSaltarAnimRellenoCicloRevision !== null && rev === coopSaltarAnimRellenoCicloRevision) {
            coopSaltarAnimRellenoCicloRevision = null;
            omitirAnimRellenoCiclo = true;
        } else if (coopSaltarAnimRellenoCicloRevision !== null) {
            coopSaltarAnimRellenoCicloRevision = null;
        }
        try {
            if (prev && !partidaFinalizada && !omitirAnimRellenoCiclo) {
                await animarEntradaRellenosCicloBotPostAplicar(prev, prox);
            }
        } catch (e) {
            console.error('[coop] anim relleno ciclo bot', e);
        }
        coopDebugEco(`procesar fin cadena rev=${rev} omitirRellenoCiclo=${omitirAnimRellenoCiclo ? 'sí' : 'no'}`);
        resolverEcoEmitSiCorresponde(rev);
        if (prev && prev.faseCoop === 'P2' && prox.faseCoop === 'BOT') {
            coopBloqueoArranqueBotHastaMs = Math.max(
                coopBloqueoArranqueBotHastaMs,
                Date.now() + COOP_MS_BLOQUEO_ARRANQUE_BOT_TRAS_P2
            );
        }
        /**
         * Debe ejecutarse al terminar todo el procesamiento del eco (replay + rellenos). Si se dispara desde
         * `aplicarSnapshotRemoto`, el microtask del BOT puede intercalar con `animarEntradaRellenosCicloBotPostAplicar`
         * y solapar robo/ataque/mensajes en la primera fase BOT.
         */
        intentarTurnoBotSiCorresponde();
    }

    /**
     * Daño flotante rojo (misma estructura que partida.js / tablero.css .danio-flotante).
     * tipoImpacto: 'jugador' | 'oponente' según la carta objetivo (humano vs campo BOT).
     */
    function mostrarValorFlotanteCoop(zonaObjetivo, slotIdx, valor, tipoImpacto, claseVisual = 'danio') {
        const slot = obtenerSlotElementCoop(zonaObjetivo, slotIdx);
        if (!slot) return;

        const slotRect = slot.getBoundingClientRect();
        const centroX = slotRect.left + (slotRect.width / 2);
        const centroY = slotRect.top + (slotRect.height * 0.46);

        const danioDiv = document.createElement('div');
        danioDiv.classList.add('danio-flotante');
        danioDiv.classList.add(tipoImpacto === 'jugador' ? 'impacto-jugador' : 'impacto-oponente');
        if (claseVisual === 'cura') {
            danioDiv.classList.add('cura');
            danioDiv.textContent = `${Math.max(0, Math.floor(Number(valor) || 0))}`;
        } else if (claseVisual === 'escudo') {
            danioDiv.classList.add('escudo');
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

    /**
     * Animación de barra de salud (equivalente a animarBajadaSaludCarta en partida.js).
     */
    async function animarBajadaSaludCartaCoop(zonaObjetivo, slotObjetivo, saludRawInicial, saludRawFinal, opciones = {}) {
        const mesaObj = obtenerMesaPorZona(zonaObjetivo);
        const carta = mesaObj[slotObjetivo];
        if (!carta) return;

        const ui = window.tableroCoopCartaUi;
        if (!ui || typeof ui.obtenerSaludEfectiva !== 'function') {
            carta.Salud = Math.max(0, Number(saludRawFinal || 0));
            if (opciones && Object.prototype.hasOwnProperty.call(opciones, 'escudoFinal')) {
                carta.escudoActual = Math.max(0, Number(opciones.escudoFinal || 0));
            }
            renderTodo();
            return;
        }

        const saludInicial = Math.max(0, Number(saludRawInicial || 0));
        const saludFinal = Math.max(0, Number(saludRawFinal || 0));
        const cartasEnemigasSalud = enemigosSaludParaZonaCoop(zonaObjetivo);
        const esCura = Boolean(opciones && opciones.esCura);
        const esEscudo = Boolean(opciones && opciones.esEscudo);
        const claseImpactoBarra = esCura
            ? 'recibiendo-cura'
            : (esEscudo ? 'recibiendo-escudo' : 'recibiendo-danio');
        const ritmoBot = Boolean(opciones && opciones.ritmoAtaqueBot);
        const msAntesBarra = ritmoBot ? 70 : 120;
        const msDespuesBarra = ritmoBot ? 260 : 420;
        const durTransBarra = ritmoBot ? '0.24s' : '0.38s';

        carta.SaludMax = obtenerSaludMaxCarta(carta);
        carta.Salud = saludInicial;
        if (opciones && Object.prototype.hasOwnProperty.call(opciones, 'escudoInicial')) {
            carta.escudoActual = Math.max(0, Number(opciones.escudoInicial || 0));
        }
        renderTodo();

        const slotTrasRender = obtenerSlotElementCoop(zonaObjetivo, slotObjetivo);
        const barraTrasRender = slotTrasRender?.querySelector('.barra-salud-contenedor');
        barraTrasRender?.classList.add(claseImpactoBarra);
        await esperar(msAntesBarra);

        const estadoIni = ui.obtenerSaludEfectiva(carta, cartasEnemigasSalud);
        const barraIni = typeof ui.obtenerPresentacionBarraSalud === 'function'
            ? ui.obtenerPresentacionBarraSalud(estadoIni)
            : window.DCHealDebuffCombat?.obtenerPresentacionBarraSalud?.(estadoIni);

        carta.Salud = saludFinal;
        if (opciones && Object.prototype.hasOwnProperty.call(opciones, 'escudoFinal')) {
            carta.escudoActual = Math.max(0, Number(opciones.escudoFinal || 0));
        }
        const estadoFin = ui.obtenerSaludEfectiva(carta, cartasEnemigasSalud);
        const barraFin = typeof ui.obtenerPresentacionBarraSalud === 'function'
            ? ui.obtenerPresentacionBarraSalud(estadoFin)
            : window.DCHealDebuffCombat?.obtenerPresentacionBarraSalud?.(estadoFin);

        const rellenoAnim = slotTrasRender?.querySelector('.barra-salud-relleno');
        if (!rellenoAnim) {
            renderTodo();
            barraTrasRender?.classList.remove(claseImpactoBarra);
            return;
        }

        if (barraIni) {
            rellenoAnim.style.width = `${barraIni.porcentaje}%`;
            rellenoAnim.style.setProperty('--health-ratio', String(barraIni.ratio));
            rellenoAnim.classList.toggle('con-escudo', Boolean(barraIni.barraAzul));
        }
        void rellenoAnim.offsetWidth;
        rellenoAnim.style.transition = `width ${durTransBarra} cubic-bezier(0.22, 0.8, 0.2, 1), background-color 0.3s ease, filter 0.25s ease`;
        if (barraFin) {
            rellenoAnim.style.width = `${barraFin.porcentaje}%`;
            rellenoAnim.style.setProperty('--health-ratio', String(barraFin.ratio));
            rellenoAnim.classList.toggle('con-escudo', Boolean(barraFin.barraAzul));
        }

        const saludTxt = slotTrasRender?.querySelector('.salud-carta');
        if (saludTxt && barraFin) {
            saludTxt.textContent = `${Math.round(barraFin.textoNumerador)}/${Math.round(barraFin.textoDenominador)}`;
        }

        await esperar(msDespuesBarra);
        barraTrasRender?.classList.remove(claseImpactoBarra);
        renderTodo();
    }

    function obtenerSaludMaxCarta(carta) {
        if (!carta) return 0;
        const sm = Number(carta.SaludMax ?? carta.saludMax);
        if (Number.isFinite(sm) && sm > 0) return sm;
        const s = Number(carta.Salud ?? carta.salud);
        if (Number.isFinite(s) && s > 0) return s;
        return Math.max(0, Number(carta.Poder || 0));
    }

    function obtenerSaludActualCarta(carta) {
        if (!carta) return 0;
        const max = obtenerSaludMaxCarta(carta);
        const s = Number(carta.Salud ?? carta.salud);
        const saludVal = Number.isFinite(s) ? s : max;
        return Math.max(0, Math.min(saludVal, max));
    }

    /** Daño/ataque usando poder final con bonos de afiliación (alineado con la vista de carta). */
    function obtenerPoderAtaqueCoop(zona, slotIdx) {
        const ui = window.tableroCoopCartaUi;
        if (!ui || !snapshot) return 1;
        const { mesaBot, mesaA, mesaB } = ui.calcularMesasConBonus(snapshot);
        const mesa = zona === 'bot' ? mesaBot : zona === 'A' ? mesaA : mesaB;
        const c = mesa[slotIdx];
        if (!c) return 1;
        const pf = Number(c.poderFinalAfiliacion);
        if (Number.isFinite(pf) && pf > 0) return Math.max(1, Math.round(pf));
        return Math.max(1, Math.round(Number(c.Poder || 0)));
    }

    function cartaEstaAturdidaCoop(carta) {
        return Math.max(0, Number(carta?.stunRestante || 0)) > 0;
    }

    function cartaViva(carta) {
        if (!carta) return false;
        const escudo = Math.max(0, Number(carta.escudoActual || 0));
        return obtenerSaludActualCarta(carta) + escudo > 0;
    }

    function esCartaBoss(carta) {
        return Boolean(carta?.esBoss);
    }

    /** Enemigos normales vivos en mesa BOT + cartas restantes en mazo (el BOSS va aparte hasta desplegar). */
    function cuentaNormalesBotRestantesEnSnap(snap) {
        if (!snap || typeof snap !== 'object') return 0;
        let n = (snap.mazoBot || []).length;
        (snap.cartasEnJuegoBot || []).forEach((c) => {
            if (c && !esCartaBoss(c) && cartaViva(c)) n += 1;
        });
        return n;
    }

    function cuentaNormalesBotRestantes() {
        return cuentaNormalesBotRestantesEnSnap(snapshot);
    }

    function obtenerTankHumanoCoop() {
        if (!snapshot) return null;
        for (let i = 0; i < 2; i += 1) {
            const c = snapshot.cartasEnJuegoA[i];
            if (c?.tankActiva && cartaViva(c)) return { zona: 'A', slot: i };
        }
        for (let i = 0; i < 2; i += 1) {
            const c = snapshot.cartasEnJuegoB[i];
            if (c?.tankActiva && cartaViva(c)) return { zona: 'B', slot: i };
        }
        return null;
    }

    function obtenerCartasHumanosConcatenadasCoop() {
        return [...(snapshot?.cartasEnJuegoA || []), ...(snapshot?.cartasEnJuegoB || [])];
    }

    /** Índices en mesa A‖B que el BOT puede dañar (tank humano concentra todo el daño, incl. AoE). */
    function obtenerIndicesObjetivosBotContraHumanosCoop() {
        const enemigos = obtenerCartasHumanosConcatenadasCoop();
        const tank = obtenerTankHumanoCoop();
        if (tank) {
            const idx = tank.zona === 'A' ? tank.slot : tank.slot + 2;
            if (enemigos[idx] && cartaViva(enemigos[idx])) return [idx];
            return [];
        }
        return obtenerIndicesDisponiblesCoop(enemigos);
    }

    /** Como `elegirObjetivosBotAleatorios` en partida.js: hasta N objetivos humanos distintos (mezcla). */
    function elegirObjetivosHumanosBossCoop(cantidadObjetivos) {
        const tank = obtenerTankHumanoCoop();
        if (tank) {
            return Array.from({ length: Math.max(1, cantidadObjetivos) }, () => tank);
        }
        const vivos = objetivosHumanosAleatorios();
        if (!vivos.length) return [];
        const mezclados = [...vivos];
        for (let i = mezclados.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [mezclados[i], mezclados[j]] = [mezclados[j], mezclados[i]];
        }
        return mezclados.slice(0, Math.max(0, cantidadObjetivos));
    }

    /**
     * Cuando no quedan rivales normales en mesa ni en mazo, despliega el BOSS (slot preferente 1, como desafíos).
     */
    function intentarDesplegarBossEnSnap(snap) {
        if (!snap || typeof snap !== 'object' || partidaFinalizada || !snap.bossPendienteCoop) return false;
        if (cuentaNormalesBotRestantesEnSnap(snap) > 0) return false;
        const mesa = snap.cartasEnJuegoBot || [];
        const hayBossVivo = mesa.some(c => c && esCartaBoss(c) && cartaViva(c));
        if (hayBossVivo) {
            snap.bossPendienteCoop = null;
            return false;
        }
        const datosBoss = snap.bossPendienteCoop;
        snap.bossPendienteCoop = null;
        const preferIdx = 1;
        const cartaColocada = crearCartaEnMesaDesdeMazo(datosBoss);
        if (!mesa[preferIdx]) {
            mesa[preferIdx] = cartaColocada;
        } else {
            let ok = false;
            for (let i = 0; i < 4; i += 1) {
                if (!mesa[i]) {
                    mesa[i] = cartaColocada;
                    ok = true;
                    break;
                }
            }
            if (!ok) {
                snap.bossPendienteCoop = datosBoss;
                return false;
            }
        }
        logCoop('El BOSS aparece en el campo de batalla.');
        return true;
    }

    function intentarDesplegarBossCoop() {
        return intentarDesplegarBossEnSnap(snapshot);
    }

    function crearCartaEnMesaDesdeMazo(carta) {
        if (!carta) return null;
        const max = obtenerSaludMaxCarta(carta);
        const salud = Number.isFinite(Number(carta.Salud)) ? Number(carta.Salud) : max;
        return normalizarCartaCombateCoop({
            ...carta,
            SaludMax: max,
            Salud: Math.max(0, Math.min(salud, max)),
            escudoActual: Math.max(0, Number(carta.escudoActual || 0))
        });
    }

    function aplicarDanioCarta(carta, danioBruto, zonaCarta) {
        const H = window.DCHealDebuffCombat;
        if (H && zonaCarta) {
            const enemigos = enemigosSaludParaZonaCoop(zonaCarta);
            const { murio } = H.aplicarDanio(carta, danioBruto, enemigos);
            return !murio;
        }
        let escudo = Math.max(0, Number(carta.escudoActual || 0));
        let salud = obtenerSaludActualCarta(carta);
        let restante = Math.max(0, Number(danioBruto) || 0);
        const absorbEscudo = Math.min(escudo, restante);
        escudo -= absorbEscudo;
        restante -= absorbEscudo;
        if (restante > 0) {
            salud = Math.max(0, salud - restante);
        }
        carta.escudoActual = escudo;
        carta.Salud = salud;
        return cartaViva(carta);
    }

    function moverACementerio(cementerio, carta) {
        if (!carta || !Array.isArray(cementerio)) return;
        cementerio.push({
            ...carta,
            Salud: obtenerSaludMaxCarta(carta),
            escudoActual: 0
        });
    }

    function indicesAtacantesVivos(mesa) {
        const idx = [];
        if (!Array.isArray(mesa)) return idx;
        mesa.forEach((c, i) => {
            if (cartaViva(c)) idx.push(i);
        });
        return idx;
    }

    /**
     * Slots con carta viva que aún no han atacado y no están incapacitadas (aturdidas).
     * Sirve para cerrar fase P1/P2 cuando solo quedan cartas que no pueden actuar.
     */
    function indicesPuedenAtacarMesaCoop(mesa, yaAtacaron) {
        const idx = [];
        if (!Array.isArray(mesa)) return idx;
        const ya = Array.isArray(yaAtacaron) ? yaAtacaron : [];
        mesa.forEach((c, i) => {
            if (!cartaViva(c)) return;
            if (cartaEstaAturdidaCoop(c)) return;
            if (ya.includes(i)) return;
            idx.push(i);
        });
        return idx;
    }

    function indicesPuedenAtacarEnSnapshot(snap, zona) {
        if (!snap || typeof snap !== 'object') return [];
        const mesa = zona === 'A' ? snap.cartasEnJuegoA : snap.cartasEnJuegoB;
        const ya = zona === 'A' ? snap.cartasYaAtacaronA : snap.cartasYaAtacaronB;
        return indicesPuedenAtacarMesaCoop(mesa, ya);
    }

    /** True si no queda ningún ataque humano posible en esa mesa (vacía, todo aturdido o ya atacaron todos los que podían). */
    function mesaSinAtaquesPendientesCoop(snap, zona) {
        return indicesPuedenAtacarEnSnapshot(snap, zona).length === 0;
    }

    /**
     * Si la fase humana actual no tiene jugada posible (mesa vacía / solo aturdidas / ya actuaron quienes podían),
     * avanza P1→P2 y/o P2→BOT en el mismo snapshot (p. ej. clon para red o estado local tras eco).
     */
    function aplicarSaltosFaseHumanaHastaJugableOFinEnSnap(snap) {
        if (!snap || typeof snap !== 'object') return;
        normalizarSnapshotCoop(snap);
        let guard = 0;
        while (guard < 4) {
            guard += 1;
            if (snap.faseCoop === 'P1' && mesaSinAtaquesPendientesCoop(snap, 'A')) {
                if (!avanzarFaseTrasHumanoEnSnapshot(snap, 'A')) break;
                continue;
            }
            if (snap.faseCoop === 'P2' && mesaSinAtaquesPendientesCoop(snap, 'B')) {
                if (!avanzarFaseTrasHumanoEnSnapshot(snap, 'B')) break;
                continue;
            }
            break;
        }
    }

    function obtenerMesaPorZona(zona) {
        if (zona === 'bot') return snapshot.cartasEnJuegoBot;
        if (zona === 'A') return snapshot.cartasEnJuegoA;
        if (zona === 'B') return snapshot.cartasEnJuegoB;
        return [];
    }

    function obtenerCementerioPorZona(zona) {
        if (zona === 'bot') return snapshot.cementerioBot;
        if (zona === 'A') return snapshot.cementerioA;
        if (zona === 'B') return snapshot.cementerioB;
        return [];
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

    function obtenerPoderCartaFinalCoop(carta) {
        if (!carta) return 0;
        const finalNum = Number(carta.poderFinalAfiliacion);
        if (Number.isFinite(finalNum)) {
            return Math.max(0, Math.round(finalNum));
        }
        const baseAf = Number(carta.poderBaseAfiliacion);
        const bonAf = Number(carta.bonusAfiliacion || 0);
        if (Number.isFinite(baseAf)) {
            return Math.max(0, baseAf + (Number.isFinite(bonAf) ? bonAf : 0));
        }
        return Math.max(0, Number(carta.Poder || 0));
    }

    function obtenerValorNumericoSkillPower(carta, fallback = 0) {
        if (typeof window.obtenerSkillPowerNumericoCarta === 'function') {
            const poder = obtenerPoderCartaFinalCoop(carta);
            const salud = obtenerSaludActualCarta(carta);
            return window.obtenerSkillPowerNumericoCarta(carta, { fallback, poder, salud });
        }
        return fallback;
    }

    function obtenerIndicesDisponiblesCoop(mesa) {
        const out = [];
        (Array.isArray(mesa) ? mesa : []).forEach((carta, idx) => {
            if (cartaViva(carta)) out.push(idx);
        });
        return out;
    }

    function obtenerIndiceTankActivoEnMesa(mesa) {
        for (let i = 0; i < (Array.isArray(mesa) ? mesa.length : 0); i += 1) {
            const c = mesa[i];
            if (c?.tankActiva && cartaViva(c)) return i;
        }
        return null;
    }

    function elegirAliadoMasHeridoEnMesa(aliados, enemigos) {
        const ui = window.tableroCoopCartaUi;
        const indices = obtenerIndicesDisponiblesCoop(aliados);
        if (!indices.length) return null;
        if (!ui || typeof ui.obtenerSaludEfectiva !== 'function') return indices[0];
        return indices.reduce((peor, idx) => {
            const estado = ui.obtenerSaludEfectiva(aliados[idx], enemigos);
            const ratio = estado.totalMax > 0 ? estado.totalActual / estado.totalMax : 1;
            if (peor === null) return { idx, ratio };
            return ratio < peor.ratio ? { idx, ratio } : peor;
        }, null)?.idx ?? null;
    }

    /** Mejor ratio de salud entre mesas A y B (coop vs BOT). */
    function elegirSlotHumanoPorRatioSaludCoop(soloHeridos) {
        const ui = window.tableroCoopCartaUi;
        let mejor = null;
        ['A', 'B'].forEach((z) => {
            const mesa = obtenerMesaPorZona(z);
            const ene = enemigosSaludParaZonaCoop(z);
            obtenerIndicesDisponiblesCoop(mesa).forEach((idx) => {
                const c = mesa[idx];
                if (soloHeridos && obtenerSaludActualCarta(c) >= obtenerSaludMaxCarta(c)) return;
                const ratio = ui && typeof ui.obtenerSaludEfectiva === 'function'
                    ? (() => {
                        const estado = ui.obtenerSaludEfectiva(c, ene);
                        return estado.totalMax > 0 ? estado.totalActual / estado.totalMax : 1;
                    })()
                    : 1;
                if (mejor === null || ratio < mejor.ratio) mejor = { ratio, zona: z, slot: idx };
            });
        });
        return mejor ? { zona: mejor.zona, slot: mejor.slot } : null;
    }

    function obtenerCartaPorSelObjetivoEnemigo(sel) {
        if (!sel || typeof sel !== 'object') return null;
        if (sel.tipo === 'mesaBotEnemigo') return snapshot.cartasEnJuegoBot?.[sel.slot] || null;
        if (sel.tipo === 'mesaHumanoEnemigo') return obtenerMesaPorZona(sel.zona)?.[sel.slot] || null;
        return null;
    }

    function obtenerContextoZonasHabilidad(zonaActor) {
        if (zonaActor === 'A') {
            return {
                aliados: snapshot.cartasEnJuegoA,
                enemigos: snapshot.cartasEnJuegoBot,
                cementerioAliado: snapshot.cementerioA,
                mazoAliado: snapshot.mazoA,
                tipoCartaAliada: 'jugador',
                tipoCartaEnemiga: 'oponente',
                zonaAliada: 'A'
            };
        }
        if (zonaActor === 'B') {
            return {
                aliados: snapshot.cartasEnJuegoB,
                enemigos: snapshot.cartasEnJuegoBot,
                cementerioAliado: snapshot.cementerioB,
                mazoAliado: snapshot.mazoB,
                tipoCartaAliada: 'jugador',
                tipoCartaEnemiga: 'oponente',
                zonaAliada: 'B'
            };
        }
        return {
            aliados: snapshot.cartasEnJuegoBot,
            enemigos: [...snapshot.cartasEnJuegoA, ...snapshot.cartasEnJuegoB],
            cementerioAliado: snapshot.cementerioBot,
            mazoAliado: snapshot.mazoBot,
            tipoCartaAliada: 'oponente',
            tipoCartaEnemiga: 'jugador',
            zonaAliada: 'bot'
        };
    }

    function enemigosSaludParaIndiceHumanoConcatenado(idx) {
        if (idx < 2) return enemigosSaludParaZonaCoop('A');
        return enemigosSaludParaZonaCoop('B');
    }

    /**
     * Opciones de modal para aliados humanos (mesas A y B). Cada ítem debe incluir `sel` (se devuelve al confirmar).
     * `filtroCarta` opcional: si devuelve false se omite la carta.
     */
    function construirOpcionesModalMesasAliadasHumano(filtroCarta) {
        const opciones = [];
        ['A', 'B'].forEach((z) => {
            const mesa = obtenerMesaPorZona(z);
            for (let s = 0; s < 2; s += 1) {
                const c = mesa[s];
                if (!cartaViva(c)) continue;
                if (typeof filtroCarta === 'function' && !filtroCarta(c, z, s)) continue;
                opciones.push({
                    carta: c,
                    slotUi: s,
                    tipoCartaTablero: 'jugador',
                    enemigosParaSalud: enemigosSaludParaZonaCoop(z),
                    sel: { tipo: 'mesaAliado', zona: z, slot: s }
                });
            }
        });
        return opciones;
    }

    function construirOpcionesModalCementeriosAliadosHumano() {
        const opciones = [];
        (snapshot.cementerioA || []).forEach((c, i) => {
            if (!c) return;
            opciones.push({
                carta: c,
                slotUi: i,
                tipoCartaTablero: 'jugador',
                enemigosParaSalud: [],
                sel: { tipo: 'cementerioAliado', zona: 'A', idx: i }
            });
        });
        (snapshot.cementerioB || []).forEach((c, i) => {
            if (!c) return;
            opciones.push({
                carta: c,
                slotUi: i,
                tipoCartaTablero: 'jugador',
                enemigosParaSalud: [],
                sel: { tipo: 'cementerioAliado', zona: 'B', idx: i }
            });
        });
        return opciones;
    }

    function abrirModalSeleccionHabilidadCoop({
        titulo = 'Selecciona objetivo',
        cartas = [],
        textoConfirmar = 'Confirmar',
        textoCancelar = 'Cancelar',
        tipoCartaTablero = 'jugador',
        enemigosParaSalud = null
    }) {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal-seleccion-habilidad');
            const tituloEl = document.getElementById('modal-habilidad-titulo');
            const listaEl = document.getElementById('modal-habilidad-lista');
            const btnConfirmar = document.getElementById('modal-habilidad-confirmar');
            const btnCancelar = document.getElementById('modal-habilidad-cancelar');
            if (!modal || !tituloEl || !listaEl || !btnConfirmar || !btnCancelar) {
                resolve(null);
                return;
            }

            /** @type {{ sel: any } | null} */
            let itemSeleccionado = null;
            tituloEl.textContent = titulo;
            btnConfirmar.textContent = textoConfirmar;
            btnCancelar.textContent = textoCancelar;
            btnConfirmar.disabled = true;
            listaEl.replaceChildren();

            const limpiar = () => {
                btnConfirmar.onclick = null;
                btnCancelar.onclick = null;
                modal.style.display = 'none';
            };

            cartas.forEach((item) => {
                const cartaEl = document.createElement('div');
                cartaEl.className = 'modal-habilidad-carta';
                const slotInner = document.createElement('div');
                slotInner.className = 'modal-habilidad-carta-slot';
                const tipo = item.tipoCartaTablero || tipoCartaTablero;
                const slotUi = Number.isFinite(Number(item.slotUi)) ? Number(item.slotUi) : 0;
                const ene = item.enemigosParaSalud !== undefined && item.enemigosParaSalud !== null
                    ? item.enemigosParaSalud
                    : (enemigosParaSalud || []);
                const root = window.tableroCoopCartaUi?.crearCartaElementoCoop?.(
                    item.carta,
                    tipo,
                    slotUi,
                    {
                        soloVista: true,
                        enemigosParaSalud: ene
                    }
                )?.root;
                if (root) slotInner.appendChild(root);
                cartaEl.appendChild(slotInner);
                cartaEl.addEventListener('click', () => {
                    itemSeleccionado = item;
                    btnConfirmar.disabled = false;
                    Array.from(listaEl.children).forEach((h) => h.classList.remove('seleccionada'));
                    cartaEl.classList.add('seleccionada');
                });
                listaEl.appendChild(cartaEl);
            });

            btnConfirmar.onclick = () => {
                limpiar();
                resolve(itemSeleccionado && Object.prototype.hasOwnProperty.call(itemSeleccionado, 'sel')
                    ? itemSeleccionado.sel
                    : null);
            };
            btnCancelar.onclick = () => {
                limpiar();
                resolve(null);
            };
            modal.style.display = 'flex';
        });
    }

    function obtenerMesaEnSnapshot(snap, zona) {
        if (!snap || typeof snap !== 'object') return [];
        if (zona === 'bot') return snap.cartasEnJuegoBot || [];
        if (zona === 'A') return snap.cartasEnJuegoA || [];
        if (zona === 'B') return snap.cartasEnJuegoB || [];
        return [];
    }

    function obtenerCementerioEnSnapshot(snap, zona) {
        if (!snap || typeof snap !== 'object') return [];
        if (zona === 'bot') return snap.cementerioBot || [];
        if (zona === 'A') return snap.cementerioA || [];
        if (zona === 'B') return snap.cementerioB || [];
        return [];
    }

    /** Copia profunda del snapshot global lista para enviar (incluye cementerio si la carta ya no está viva). */
    function clonarSnapshotParaRed() {
        const s = JSON.parse(JSON.stringify(snapshot));
        normalizarSnapshotCoop(s);
        /**
         * `coopReplayVisual` es una propiedad transitoria que viaja en el snapshot de red para
         * que el observador anime la habilidad actual. Debe limpiarse del snapshot vivo tras
         * clonarlo para no reusarla en la siguiente emisión (causa de ecos de AoE repetidos).
         */
        if (snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'coopReplayVisual')) {
            delete snapshot.coopReplayVisual;
        }
        return s;
    }

    function promoverObjetivoMuertoACementerioEnSnapshot(snap, zonaObj, slotIdx) {
        const mesa = obtenerMesaEnSnapshot(snap, zonaObj);
        const carta = mesa[slotIdx];
        if (!carta || cartaViva(carta)) return;
        const cement = obtenerCementerioEnSnapshot(snap, zonaObj);
        moverACementerio(cement, carta);
        mesa[slotIdx] = null;
    }

    /**
     * Según EVENTO_COOPERATIVO_ONLINE_ESPEC.md, en turno humano (P1/P2) se roba del mazo BOT
     * solo si la mesa BOT quedó totalmente vacía durante el turno activo. Se usa tras resolver
     * la habilidad humana (AoE / extra_attack letal) para no dejar a P2 sin objetivos válidos.
     */
    function rellenarMesaBotSiVaciaEnSnap(snap) {
        if (!snap || typeof snap !== 'object') return;
        if (snap.faseCoop !== 'P1' && snap.faseCoop !== 'P2') return;
        if (!mesaTotalmenteVacia(snap.cartasEnJuegoBot)) return;
        rellenarVaciosDesdeMazoEnSnapshot(snap, 'bot', 4);
        intentarDesplegarBossEnSnap(snap);
    }

    function prepararSnapshotEmitConReplayHabilidad(snap) {
        if (!snap || typeof snap !== 'object') return;
        const replay = snap.coopReplayVisual;
        if (!replay || typeof replay !== 'object') return;
        if (replay.tipoAccion === 'aoe') {
            /**
             * AOE puede vaciar las últimas normales del BOT manteniendo la fase humana.
             * Para no bloquear el turno por falta de objetivos, evaluar despliegue del BOSS
             * y, si sigue sin cartas, robar del mazo BOT (caso "turno humano con mesa BOT vacía").
             */
            intentarDesplegarBossEnSnap(snap);
            rellenarMesaBotSiVaciaEnSnap(snap);
            return;
        }
        if (replay.tipoAccion !== 'extra_attack') return;
        const extra = replay.extraAttack;
        if (!extra || typeof extra !== 'object') return;
        const zonaObj = extra.zonaObjetivo;
        const slotObj = Number(extra.slotObjetivo);
        if ((zonaObj !== 'A' && zonaObj !== 'B' && zonaObj !== 'bot') || !Number.isInteger(slotObj)) return;
        if (extra.esLetal) {
            promoverObjetivoMuertoACementerioEnSnapshot(snap, zonaObj, slotObj);
        }
        if (zonaObj === 'bot') {
            /**
             * Salvaguarda: aunque el payload de letalidad venga incompleto, reevaluar aquí evita quedarnos
             * sin objetivos BOT al final de la acción humana.
             */
            intentarDesplegarBossEnSnap(snap);
            rellenarMesaBotSiVaciaEnSnap(snap);
        }
    }

    /** Devuelve la carta al estado previo al daño solo para la animación local (la red usa otro snapshot). */
    function restaurarSaludEscudoVisual(carta, saludRaw, escudoRaw) {
        if (!carta) return;
        const max = obtenerSaludMaxCarta(carta);
        carta.Salud = Math.max(0, Math.min(Number(saludRaw) || 0, max));
        carta.escudoActual = Math.max(0, Number(escudoRaw) || 0);
    }

    /**
     * Copia mesas y cementerios (y `bossPendienteCoop`) desde `fuente` al snapshot vivo sin tocar
     * fase, mazos, `cartasYaAtacaron*` ni `revisionConfirmada`. Sirve al emisor para volver visualmente
     * al estado previo a la habilidad y luego dejar el estado canónico tras animar.
     */
    function aplicarEstadoVisualDesdeSnapshotCoop(fuente) {
        if (!snapshot || !fuente || typeof fuente !== 'object') return;
        snapshot.cartasEnJuegoBot = JSON.parse(JSON.stringify(fuente.cartasEnJuegoBot || []));
        snapshot.cartasEnJuegoA = JSON.parse(JSON.stringify(fuente.cartasEnJuegoA || []));
        snapshot.cartasEnJuegoB = JSON.parse(JSON.stringify(fuente.cartasEnJuegoB || []));
        snapshot.cementerioBot = JSON.parse(JSON.stringify(fuente.cementerioBot || []));
        snapshot.cementerioA = JSON.parse(JSON.stringify(fuente.cementerioA || []));
        snapshot.cementerioB = JSON.parse(JSON.stringify(fuente.cementerioB || []));
        if (Object.prototype.hasOwnProperty.call(fuente, 'bossPendienteCoop')) {
            snapshot.bossPendienteCoop = fuente.bossPendienteCoop && typeof fuente.bossPendienteCoop === 'object'
                ? JSON.parse(JSON.stringify(fuente.bossPendienteCoop))
                : null;
        }
        normalizarSnapshotCoop(snapshot);
    }

    /**
     * Animación local en el emisor de una habilidad activa coop. Equivalente al flujo que hace el
     * observador al procesar el eco: mostrar aviso + floats para heal/shield/stun/..., y para AoE
     * o extra_attack bajar la barra de salud carta a carta. Requiere dos snapshots clonados:
     *   - `snapAntes`: estado del snapshot vivo antes de llamar a `usarHabilidadActivaCoop`.
     *   - `snapDespuesCanon`: estado canónico tras la habilidad, ya con cementerios promovidos
     *     (el mismo que se enviará por red en `snapshotParaRed`).
     * El snapshot vivo queda reposicionado en `snapDespuesCanon` al terminar.
     */
    async function animarHabilidadLocalEnEmisorCoop(snapAntes, snapDespuesCanon, replay) {
        if (!snapAntes || !snapDespuesCanon || !replay || typeof replay !== 'object') {
            return;
        }
        /** Retrocede visualmente mesas/cementerios al estado anterior para que la animación tenga recorrido. */
        aplicarEstadoVisualDesdeSnapshotCoop(snapAntes);
        renderTodo();
        try {
            if (replay.tipoAccion === 'aoe') {
                await animarTransicionCoopAoeDesdeReplay(snapAntes, snapDespuesCanon, replay);
            } else if (replay.tipoAccion === 'extra_attack') {
                await animarTransicionCoopExtraAttackDesdeReplay(snapAntes, snapDespuesCanon, replay);
            } else {
                await ejecutarCoopReplayVisual(replay, {
                    snapAntes,
                    snapDespues: snapDespuesCanon
                });
            }
        } catch (e) {
            console.error('[coop] animar habilidad (emisor)', e);
        }
        /** Reposiciona al estado canónico (con cementerio y huecos finales) tras la animación. */
        aplicarEstadoVisualDesdeSnapshotCoop(snapDespuesCanon);
        limpiarCoopAnimHighlights();
        renderTodo();
    }

    function obtenerMesaPorZonaEnSnapshot(snap, zona) {
        if (zona === 'bot') return snap.cartasEnJuegoBot;
        if (zona === 'A') return snap.cartasEnJuegoA;
        if (zona === 'B') return snap.cartasEnJuegoB;
        return [];
    }

    function obtenerCementerioPorZonaEnSnapshot(snap, zona) {
        if (zona === 'bot') return snap.cementerioBot;
        if (zona === 'A') return snap.cementerioA;
        if (zona === 'B') return snap.cementerioB;
        return [];
    }

    function reducirCooldownHabilidadesActivasZonaEnSnapshot(snap, zona) {
        const mesa = obtenerMesaPorZonaEnSnapshot(snap, zona);
        (Array.isArray(mesa) ? mesa : []).forEach((carta) => {
            if (!carta) return;
            const meta = obtenerMetaHabilidad(carta);
            if (!meta.tieneHabilidad || meta.trigger !== 'usar') return;
            const cd = Math.max(0, Number(carta.habilidadCooldownRestante || 0));
            carta.habilidadCooldownRestante = Math.max(0, cd - 1);
        });
    }

    function aplicarDanioDirectoSinAnimCoop(cartaObjetivo, zonaObjetivo, slotObjetivo, danio, snapRef = snapshot) {
        if (!cartaObjetivo || danio <= 0) return false;
        aplicarDanioCarta(cartaObjetivo, danio, zonaObjetivo);
        if (cartaViva(cartaObjetivo)) return true;
        const cement = obtenerCementerioPorZonaEnSnapshot(snapRef, zonaObjetivo);
        const mesa = obtenerMesaPorZonaEnSnapshot(snapRef, zonaObjetivo);
        moverACementerio(cement, cartaObjetivo);
        mesa[slotObjetivo] = null;
        return true;
    }

    function aplicarEfectosInicioFaseZonaEnSnapshot(snap, zona) {
        const mesa = obtenerMesaPorZonaEnSnapshot(snap, zona);
        (Array.isArray(mesa) ? mesa : []).forEach((carta, idx) => {
            if (!carta) return;
            const stunActual = Math.max(0, Number(carta.stunRestante || 0));

            const dots = Array.isArray(carta.efectosDot) ? carta.efectosDot : [];
            if (dots.length > 0) {
                let danoTotal = 0;
                dots.forEach((fx) => {
                    const d = Math.max(0, Math.floor(Number(fx?.danoPorTurno || 0)));
                    danoTotal += d;
                    fx.turnosRestantes = Math.max(0, Math.floor(Number(fx.turnosRestantes || 0)) - 1);
                });
                carta.efectosDot = dots.filter((fx) => (
                    fx.turnosRestantes > 0 && Math.max(0, Math.floor(Number(fx?.danoPorTurno || 0))) > 0
                ));
                if (danoTotal > 0 && cartaViva(carta)) {
                    aplicarDanioDirectoSinAnimCoop(carta, zona, idx, danoTotal, snap);
                }
            }

            if (stunActual > 0) {
                carta.stunRestante = Math.max(0, stunActual - 1);
                if (carta.stunRestante === 0) {
                    carta.stunSkillName = '';
                }
            }
        });
        reducirCooldownHabilidadesActivasZonaEnSnapshot(snap, zona);
    }

    function aplicarInicioDeFaseEnSnapshot(snap, fase) {
        if (!snap || typeof snap !== 'object') return;
        if (fase === 'P1') aplicarEfectosInicioFaseZonaEnSnapshot(snap, 'A');
        else if (fase === 'P2') aplicarEfectosInicioFaseZonaEnSnapshot(snap, 'B');
        else if (fase === 'BOT') aplicarEfectosInicioFaseZonaEnSnapshot(snap, 'bot');
    }

    async function usarHabilidadActivaCoop(zonaActor, slotCarta, esBotAuto = false) {
        const ctx = obtenerContextoZonasHabilidad(zonaActor);
        const carta = ctx.aliados?.[slotCarta];
        if (!carta || !cartaViva(carta) || cartaEstaAturdidaCoop(carta)) return false;
        const meta = obtenerMetaHabilidad(carta);
        const cooldownActual = Math.max(0, Number(carta.habilidadCooldownRestante || 0));
        if (!meta.tieneHabilidad || meta.trigger !== 'usar' || cooldownActual > 0) return false;
        if (meta.clase === 'tank' && Boolean(carta.habilidadUsadaPartida)) return false;

        delete snapshot.coopReplayVisual;
        let coopReplayTexto = '';
        const coopReplayFloats = [];
        let coopReplayExtraAttack = null;

        const aliados = ctx.aliados;
        const enemigos = ctx.enemigos;
        let cartaCaster = carta;
        const uiBonus = window.tableroCoopCartaUi;
        if (uiBonus && typeof uiBonus.calcularMesasConBonus === 'function' && snapshot) {
            const { mesaBot, mesaA, mesaB } = uiBonus.calcularMesasConBonus(snapshot);
            const mesaCaster = zonaActor === 'bot' ? mesaBot : zonaActor === 'A' ? mesaA : mesaB;
            cartaCaster = mesaCaster?.[slotCarta] || carta;
        }
        const valor = Math.max(0, Number(obtenerValorNumericoSkillPower(cartaCaster, 0)));

        if (meta.clase === 'heal') {
            if (valor <= 0) return false;
            let selMesa = null;
            if (esBotAuto) {
                selMesa = elegirSlotHumanoPorRatioSaludCoop(true);
            } else if (zonaActor === 'A' || zonaActor === 'B') {
                const opciones = construirOpcionesModalMesasAliadasHumano(
                    (c) => obtenerSaludActualCarta(c) < obtenerSaludMaxCarta(c)
                );
                if (!opciones.length) return false;
                selMesa = await abrirModalSeleccionHabilidadCoop({
                    titulo: `Curar con ${carta.Nombre}`,
                    cartas: opciones,
                    textoConfirmar: 'Curar',
                    textoCancelar: 'Cancelar',
                    tipoCartaTablero: 'jugador',
                    enemigosParaSalud: null
                });
            } else {
                const disp = obtenerIndicesDisponiblesCoop(aliados).filter(
                    (idx) => obtenerSaludActualCarta(aliados[idx]) < obtenerSaludMaxCarta(aliados[idx])
                );
                if (!disp.length) return false;
                const idx = elegirAliadoMasHeridoEnMesa(aliados, enemigos);
                if (!Number.isInteger(idx) || !aliados[idx]) return false;
                selMesa = { tipo: 'mesaAliado', zona: 'bot', slot: idx };
            }
            if (!selMesa || selMesa.tipo !== 'mesaAliado') return false;
            const mesaObj = obtenerMesaPorZona(selMesa.zona);
            const objetivo = mesaObj[selMesa.slot];
            if (!objetivo) return false;
            const saludAntes = obtenerSaludActualCarta(objetivo);
            const H = window.DCHealDebuffCombat;
            const enObjHeal = enemigosSaludParaZonaCoop(selMesa.zona);
            objetivo.Salud = H
                ? H.capCuracion(objetivo, saludAntes + Math.floor(valor), enObjHeal)
                : Math.min(obtenerSaludMaxCarta(objetivo), saludAntes + Math.floor(valor));
            const curado = Math.max(0, objetivo.Salud - saludAntes);
            if (curado <= 0) return false;
            coopReplayTexto = construirMensajeUsoHabilidadActiva(carta.Nombre, meta.nombre, objetivo.Nombre);
            coopReplayFloats.push({
                zona: selMesa.zona,
                slot: selMesa.slot,
                valor: curado,
                tipoImpacto: tipoFloatImpactoParaZonaCarta(selMesa.zona),
                claseVisual: 'cura'
            });
            logCoop(`${carta.Nombre} usa ${meta.nombre} y cura ${curado} a ${objetivo.Nombre}.`);
        } else if (meta.clase === 'shield') {
            if (valor <= 0) return false;
            let selMesa = null;
            if (esBotAuto) {
                selMesa = elegirSlotHumanoPorRatioSaludCoop(false)
                    || elegirSlotHumanoPorRatioSaludCoop(true);
            } else if (zonaActor === 'A' || zonaActor === 'B') {
                const opciones = construirOpcionesModalMesasAliadasHumano(() => true);
                if (!opciones.length) return false;
                selMesa = await abrirModalSeleccionHabilidadCoop({
                    titulo: `Escudo con ${carta.Nombre}`,
                    cartas: opciones,
                    textoConfirmar: 'Aplicar Escudo',
                    textoCancelar: 'Cancelar',
                    tipoCartaTablero: 'jugador',
                    enemigosParaSalud: null
                });
            } else {
                const disp = obtenerIndicesDisponiblesCoop(aliados);
                if (!disp.length) return false;
                const idx = elegirAliadoMasHeridoEnMesa(aliados, enemigos);
                if (!Number.isInteger(idx) || !aliados[idx]) return false;
                selMesa = { tipo: 'mesaAliado', zona: 'bot', slot: idx };
            }
            if (!selMesa || selMesa.tipo !== 'mesaAliado') return false;
            const mesaObj = obtenerMesaPorZona(selMesa.zona);
            const objetivo = mesaObj[selMesa.slot];
            if (!objetivo) return false;
            const escCantidad = Math.floor(valor);
            coopReplayTexto = construirMensajeUsoHabilidadActiva(carta.Nombre, meta.nombre, objetivo.Nombre);
            objetivo.escudoActual = Math.max(0, Number(objetivo.escudoActual || 0)) + escCantidad;
            coopReplayFloats.push({
                zona: selMesa.zona,
                slot: selMesa.slot,
                valor: escCantidad,
                tipoImpacto: tipoFloatImpactoParaZonaCarta(selMesa.zona),
                claseVisual: 'escudo'
            });
            logCoop(`${carta.Nombre} usa ${meta.nombre}: escudo +${escCantidad} para ${objetivo.Nombre}.`);
        } else if (meta.clase === 'stun' || meta.clase === 'dot' || meta.clase === 'extra_attack') {
            const disp = zonaActor === 'bot'
                ? obtenerIndicesObjetivosBotContraHumanosCoop()
                : (() => {
                    const tank = obtenerIndiceTankActivoEnMesa(enemigos);
                    return tank !== null ? [tank] : obtenerIndicesDisponiblesCoop(enemigos);
                })();
            if (!disp.length) return false;

            let selObj = null;
            if (esBotAuto) {
                const pick = disp[Math.floor(Math.random() * disp.length)];
                if (zonaActor === 'bot') {
                    selObj = pick < 2
                        ? { tipo: 'mesaHumanoEnemigo', zona: 'A', slot: pick }
                        : { tipo: 'mesaHumanoEnemigo', zona: 'B', slot: pick - 2 };
                } else {
                    selObj = { tipo: 'mesaBotEnemigo', slot: pick };
                }
            } else {
                const cartasModal = disp.map((index) => {
                    const c = enemigos[index];
                    if (zonaActor === 'bot') {
                        const slotUi = index < 2 ? index : index - 2;
                        const zonaHum = index < 2 ? 'A' : 'B';
                        return {
                            carta: c,
                            slotUi,
                            tipoCartaTablero: ctx.tipoCartaEnemiga,
                            enemigosParaSalud: enemigosSaludParaIndiceHumanoConcatenado(index),
                            sel: { tipo: 'mesaHumanoEnemigo', zona: zonaHum, slot: slotUi }
                        };
                    }
                    return {
                        carta: c,
                        slotUi: index,
                        tipoCartaTablero: ctx.tipoCartaEnemiga,
                        enemigosParaSalud: enemigosSaludParaZonaCoop('bot'),
                        sel: { tipo: 'mesaBotEnemigo', slot: index }
                    };
                });
                selObj = await abrirModalSeleccionHabilidadCoop({
                    titulo: `Objetivo para ${meta.nombre}`,
                    cartas: cartasModal,
                    textoConfirmar: 'Confirmar',
                    textoCancelar: 'Cancelar',
                    tipoCartaTablero: ctx.tipoCartaEnemiga,
                    enemigosParaSalud: null
                });
            }
            if (!selObj) return false;
            const objetivo = obtenerCartaPorSelObjetivoEnemigo(selObj);
            if (!objetivo) return false;
            if (meta.clase === 'stun' && esCartaBoss(objetivo)) return false;
            coopReplayTexto = construirMensajeUsoHabilidadActiva(carta.Nombre, meta.nombre, objetivo.Nombre);
            if (meta.clase === 'stun') {
                const turnos = Math.max(1, Math.floor(valor || 1));
                objetivo.stunRestante = Math.max(Math.max(0, Number(objetivo.stunRestante || 0)), turnos);
                objetivo.stunSkillName = String(meta.nombre || '').trim();
                logCoop(`${carta.Nombre} usa ${meta.nombre} y aturde a ${objetivo.Nombre} durante ${turnos} turno(s).`);
            } else if (meta.clase === 'dot') {
                const dano = Math.max(1, Math.floor(valor || 1));
                objetivo.efectosDot = Array.isArray(objetivo.efectosDot) ? objetivo.efectosDot : [];
                objetivo.efectosDot.push({ danoPorTurno: dano, turnosRestantes: 3, skillName: String(meta.nombre || '').trim() });
                logCoop(`${carta.Nombre} aplica sangrado a ${objetivo.Nombre}: ${dano} de daño por 3 turnos.`);
            } else {
                const danioExtra = obtenerPoderAtaqueCoop(zonaActor === 'bot' ? 'bot' : zonaActor, slotCarta);
                let zonaObjetivo;
                let slotObjetivo;
                if (selObj.tipo === 'mesaBotEnemigo') {
                    zonaObjetivo = 'bot';
                    slotObjetivo = selObj.slot;
                } else {
                    zonaObjetivo = selObj.zona;
                    slotObjetivo = selObj.slot;
                }
                const objetivoReal = obtenerMesaPorZona(zonaObjetivo)[slotObjetivo];
                if (objetivoReal) {
                    const uiExtra = window.tableroCoopCartaUi;
                    const enObjExtra = enemigosSaludParaZonaCoop(zonaObjetivo);
                    const estadoAntesTotExtra = uiExtra && typeof uiExtra.obtenerSaludEfectiva === 'function'
                        ? uiExtra.obtenerSaludEfectiva(objetivoReal, enObjExtra).totalActual
                        : obtenerSaludActualCarta(objetivoReal) + Math.max(0, Number(objetivoReal.escudoActual || 0));
                    const danioMostrarExtra = Math.min(danioExtra, Math.max(0, estadoAntesTotExtra));
                    const saludIniExtra = obtenerSaludActualCarta(objetivoReal);
                    const escIniExtra = Math.max(0, Number(objetivoReal.escudoActual || 0));
                    const tempExtra = JSON.parse(JSON.stringify(objetivoReal));
                    aplicarDanioCarta(tempExtra, danioExtra, zonaObjetivo);
                    const saludFinExtra = obtenerSaludActualCarta(tempExtra);
                    const escFinExtra = Math.max(0, Number(tempExtra.escudoActual || 0));
                    const esLetalExtra = !cartaViva(tempExtra);

                    aplicarDanioCarta(objetivoReal, danioExtra, zonaObjetivo);
                    coopReplayFloats.push({
                        zona: zonaObjetivo,
                        slot: slotObjetivo,
                        valor: Math.max(1, Number(danioMostrarExtra || 1)),
                        tipoImpacto: tipoFloatImpactoParaZonaCarta(zonaObjetivo),
                        claseVisual: 'danio'
                    });
                    coopReplayExtraAttack = {
                        zonaAtacante: zonaActor,
                        slotAtacante: slotCarta,
                        zonaObjetivo,
                        slotObjetivo,
                        danioMostrar: Math.max(1, Number(danioMostrarExtra || 1)),
                        saludRawIni: saludIniExtra,
                        saludRawFin: saludFinExtra,
                        escIni: escIniExtra,
                        escFin: escFinExtra,
                        esLetal: esLetalExtra
                    };
                    logCoop(`${carta.Nombre} usa ${meta.nombre} y ejecuta un ataque extra sobre ${objetivoReal.Nombre}.`);
                }
            }
        } else if (meta.clase === 'heal_all') {
            if (valor <= 0) return false;
            let hubo = false;
            coopReplayTexto = construirMensajeUsoHabilidadActiva(carta.Nombre, meta.nombre, 'todo su equipo');
            if (zonaActor === 'A' || zonaActor === 'B') {
                ['A', 'B'].forEach((z) => {
                    const mesa = obtenerMesaPorZona(z);
                    mesa.forEach((objetivo, idx) => {
                        if (!objetivo) return;
                        const antes = obtenerSaludActualCarta(objetivo);
                        const H = window.DCHealDebuffCombat;
                        const enObj = enemigosSaludParaZonaCoop(z);
                        objetivo.Salud = H
                            ? H.capCuracion(objetivo, antes + Math.floor(valor), enObj)
                            : Math.min(obtenerSaludMaxCarta(objetivo), antes + Math.floor(valor));
                        const curado = Math.max(0, objetivo.Salud - antes);
                        if (curado > 0) {
                            hubo = true;
                            coopReplayFloats.push({
                                zona: z,
                                slot: idx,
                                valor: curado,
                                tipoImpacto: 'jugador',
                                claseVisual: 'cura'
                            });
                        }
                    });
                });
            } else {
                aliados.forEach((objetivo, idx) => {
                    if (!objetivo) return;
                    const antes = obtenerSaludActualCarta(objetivo);
                    const H = window.DCHealDebuffCombat;
                    const enObj = enemigosSaludParaZonaCoop(ctx.zonaAliada);
                    objetivo.Salud = H
                        ? H.capCuracion(objetivo, antes + Math.floor(valor), enObj)
                        : Math.min(obtenerSaludMaxCarta(objetivo), antes + Math.floor(valor));
                    const curado = Math.max(0, objetivo.Salud - antes);
                    if (curado > 0) {
                        hubo = true;
                        coopReplayFloats.push({
                            zona: ctx.zonaAliada,
                            slot: idx,
                            valor: curado,
                            tipoImpacto: ctx.tipoCartaAliada === 'oponente' ? 'oponente' : 'jugador',
                            claseVisual: 'cura'
                        });
                    }
                });
            }
            if (!hubo) return false;
            logCoop(`${carta.Nombre} usa ${meta.nombre}: cura grupal +${Math.floor(valor)}.`);
        } else if (meta.clase === 'shield_aoe') {
            if (valor <= 0) return false;
            let hubo = false;
            const escCantidad = Math.floor(valor);
            coopReplayTexto = construirMensajeUsoHabilidadActiva(carta.Nombre, meta.nombre, 'todo su equipo');
            if (zonaActor === 'A' || zonaActor === 'B') {
                ['A', 'B'].forEach((z) => {
                    const mesa = obtenerMesaPorZona(z);
                    mesa.forEach((objetivo, idx) => {
                        if (!objetivo) return;
                        objetivo.escudoActual = Math.max(0, Number(objetivo.escudoActual || 0)) + escCantidad;
                        hubo = true;
                        coopReplayFloats.push({
                            zona: z,
                            slot: idx,
                            valor: escCantidad,
                            tipoImpacto: 'jugador',
                            claseVisual: 'escudo'
                        });
                    });
                });
            } else {
                aliados.forEach((objetivo, idx) => {
                    if (!objetivo) return;
                    objetivo.escudoActual = Math.max(0, Number(objetivo.escudoActual || 0)) + escCantidad;
                    hubo = true;
                    coopReplayFloats.push({
                        zona: ctx.zonaAliada,
                        slot: idx,
                        valor: escCantidad,
                        tipoImpacto: ctx.tipoCartaAliada === 'oponente' ? 'oponente' : 'jugador',
                        claseVisual: 'escudo'
                    });
                });
            }
            if (!hubo) return false;
            logCoop(`${carta.Nombre} usa ${meta.nombre}: escudo grupal +${escCantidad}.`);
        } else if (meta.clase === 'aoe') {
            const poderAoe = obtenerPoderAtaqueCoop(ctx.zonaAliada, slotCarta);
            const cartaAoeCtx = ctx.zonaAliada === 'bot'
                ? snapshot.cartasEnJuegoBot[slotCarta]
                : ctx.zonaAliada === 'A'
                    ? snapshot.cartasEnJuegoA[slotCarta]
                    : snapshot.cartasEnJuegoB[slotCarta];
            const danoAoe = typeof window.calcularDanioSkillDesdePoder === 'function'
                ? window.calcularDanioSkillDesdePoder('aoe', poderAoe, cartaAoeCtx, {
                    salud: cartaAoeCtx?.Salud ?? cartaAoeCtx?.SaludMax ?? poderAoe
                })
                : Math.max(1, Math.floor(poderAoe / 2));
            const disp = zonaActor === 'bot'
                ? obtenerIndicesObjetivosBotContraHumanosCoop()
                : obtenerIndicesDisponiblesCoop(enemigos);
            if (!disp.length) return false;
            coopReplayTexto = construirMensajeUsoHabilidadActiva(carta.Nombre, meta.nombre, 'todo el equipo rival');
            const ui = window.tableroCoopCartaUi;
            disp.forEach((idx) => {
                if (zonaActor === 'bot') {
                    const zonaObj = idx < 2 ? 'A' : 'B';
                    const slotObj = idx < 2 ? idx : idx - 2;
                    const objetivo = obtenerMesaPorZona(zonaObj)[slotObj];
                    if (objetivo) {
                        const enObj = enemigosSaludParaZonaCoop(zonaObj);
                        const estadoAntesTot = ui && typeof ui.obtenerSaludEfectiva === 'function'
                            ? ui.obtenerSaludEfectiva(objetivo, enObj).totalActual
                            : obtenerSaludActualCarta(objetivo) + Math.max(0, Number(objetivo.escudoActual || 0));
                        const danioMostrar = Math.min(danoAoe, Math.max(0, estadoAntesTot));
                        aplicarDanioDirectoSinAnimCoop(objetivo, zonaObj, slotObj, danoAoe);
                        if (danioMostrar > 0) {
                            coopReplayFloats.push({
                                zona: zonaObj,
                                slot: slotObj,
                                valor: danioMostrar,
                                tipoImpacto: 'jugador',
                                claseVisual: 'danio'
                            });
                        }
                    }
                } else {
                    const objetivo = snapshot.cartasEnJuegoBot[idx];
                    if (objetivo) {
                        const enObj = enemigosSaludParaZonaCoop('bot');
                        const estadoAntesTot = ui && typeof ui.obtenerSaludEfectiva === 'function'
                            ? ui.obtenerSaludEfectiva(objetivo, enObj).totalActual
                            : obtenerSaludActualCarta(objetivo) + Math.max(0, Number(objetivo.escudoActual || 0));
                        const danioMostrar = Math.min(danoAoe, Math.max(0, estadoAntesTot));
                        aplicarDanioDirectoSinAnimCoop(objetivo, 'bot', idx, danoAoe);
                        if (danioMostrar > 0) {
                            coopReplayFloats.push({
                                zona: 'bot',
                                slot: idx,
                                valor: danioMostrar,
                                tipoImpacto: 'oponente',
                                claseVisual: 'danio'
                            });
                        }
                    }
                }
            });
            logCoop(`${carta.Nombre} desata ${meta.nombre} e impacta a todo el equipo enemigo.`);
        } else if (meta.clase === 'tank') {
            coopReplayTexto = construirMensajeUsoHabilidadActiva(carta.Nombre, meta.nombre, carta.Nombre);
            carta.tankActiva = true;
            carta.habilidadUsadaPartida = true;
            const saludMaxAnterior = obtenerSaludMaxCarta(carta);
            carta.SaludMax = Math.max(1, saludMaxAnterior * 2);
            carta.Salud = Math.min(carta.SaludMax, obtenerSaludActualCarta(carta) + saludMaxAnterior);
            carta.poderModHabilidad = Number(carta.poderModHabilidad || 0) - Math.floor(Number(carta.Poder || 0) * 0.5);
            logCoop(`${carta.Nombre} activa ${meta.nombre}: modo tanque activo.`);
        } else if (meta.clase === 'revive') {
            let selCement = null;
            if (esBotAuto) {
                if (Array.isArray(snapshot.cementerioA) && snapshot.cementerioA.length > 0) {
                    selCement = { tipo: 'cementerioAliado', zona: 'A', idx: 0 };
                } else if (Array.isArray(snapshot.cementerioB) && snapshot.cementerioB.length > 0) {
                    selCement = { tipo: 'cementerioAliado', zona: 'B', idx: 0 };
                }
            } else if (zonaActor === 'A' || zonaActor === 'B') {
                const opciones = construirOpcionesModalCementeriosAliadosHumano();
                if (!opciones.length) return false;
                selCement = await abrirModalSeleccionHabilidadCoop({
                    titulo: `Revivir con ${carta.Nombre}`,
                    cartas: opciones,
                    textoConfirmar: 'Revivir Carta',
                    textoCancelar: 'Cancelar',
                    tipoCartaTablero: 'jugador',
                    enemigosParaSalud: null
                });
            } else {
                const cement = ctx.cementerioAliado;
                if (!Array.isArray(cement) || cement.length === 0) return false;
                selCement = { tipo: 'cementerioAliado', zona: 'bot', idx: 0 };
            }
            if (!selCement || selCement.tipo !== 'cementerioAliado') return false;
            const cementArr = obtenerCementerioPorZona(selCement.zona);
            if (!Array.isArray(cementArr) || !cementArr[selCement.idx]) return false;
            const cartaRevive = cementArr.splice(selCement.idx, 1)[0];
            coopReplayTexto = construirMensajeUsoHabilidadActiva(carta.Nombre, meta.nombre, cartaRevive.Nombre);
            const mazoDestino = obtenerMazoPorZona(selCement.zona);
            mazoDestino.push({
                ...cartaRevive,
                Salud: obtenerSaludMaxCarta(cartaRevive),
                escudoActual: 0,
                habilidadAutoAplicadaEnJuego: false,
                habilidadCooldownRestante: 0,
                habilidadUsadaPartida: false,
                tankActiva: false
            });
            logCoop(`${carta.Nombre} usa ${meta.nombre} y revive a ${cartaRevive.Nombre} al mazo.`);
        } else {
            return false;
        }

        if (coopReplayTexto) {
            snapshot.coopReplayVisual = {
                textoAnuncio: coopReplayTexto,
                msAviso: PAUSA_AVISO_HABILIDAD_MS,
                tipoAccion: meta.clase === 'aoe'
                    ? 'aoe'
                    : meta.clase === 'extra_attack'
                        ? 'extra_attack'
                        : (meta.clase === 'shield' || meta.clase === 'shield_aoe')
                            ? 'shield'
                            : meta.clase === 'heal'
                                ? 'heal'
                                : 'general',
                actorZona: zonaActor,
                actorSlot: slotCarta,
                extraAttack: coopReplayExtraAttack,
                floats: coopReplayFloats
            };
        }

        carta.habilidadCooldownRestante = COOLDOWN_HABILIDAD_ACTIVA_TURNOS;
        renderTodo();
        verificarFinPartidaCoop();
        return true;
    }

    function obtenerMazoPorZona(zona) {
        if (zona === 'bot') return snapshot.mazoBot;
        if (zona === 'A') return snapshot.mazoA;
        if (zona === 'B') return snapshot.mazoB;
        return [];
    }

    function rellenarVaciosDesdeMazo(zona, maxSlots) {
        const mesa = obtenerMesaPorZona(zona);
        const mazo = obtenerMazoPorZona(zona);
        if (!Array.isArray(mesa) || !Array.isArray(mazo)) return;
        for (let i = 0; i < maxSlots; i += 1) {
            if (!mesa[i] && mazo.length > 0) {
                mesa[i] = crearCartaEnMesaDesdeMazo(mazo.shift());
            }
        }
    }

    /** Roba del mazo al snapshot de red (sin animación). Devuelve si colocó al menos una carta. */
    function rellenarVaciosDesdeMazoEnSnapshot(snap, zona, maxSlots) {
        if (!snap || typeof snap !== 'object') return false;
        normalizarSnapshotCoop(snap);
        const mesa = obtenerMesaPorZonaEnSnapshot(snap, zona);
        const mazo = zona === 'bot' ? snap.mazoBot : zona === 'A' ? snap.mazoA : snap.mazoB;
        if (!Array.isArray(mesa) || !Array.isArray(mazo)) return false;
        let hubo = false;
        for (let i = 0; i < maxSlots; i += 1) {
            if (!mesa[i] && mazo.length > 0) {
                mesa[i] = crearCartaEnMesaDesdeMazo(mazo.shift());
                hubo = true;
            }
        }
        return hubo;
    }

    function mesaTotalmenteVacia(mesa) {
        if (!Array.isArray(mesa)) return true;
        return mesa.every((c) => !cartaViva(c));
    }

    /**
     * Rellena huecos desde el mazo según el flujo del documento (EVENTO_COOPERATIVO_ONLINE_ESPEC.md):
     *   - Turno humano (P1/P2): solo se roba del mazo BOT si la mesa BOT quedó totalmente vacía durante el turno.
     *   - Turno BOT: solo se roba al mazo humano si AMBAS mesas humanas están vacías (doc: "jugador_1 y jugador_2
     *     se han quedado sin cartas en el tablero").
     */
    function aplicarRobosInicioDeFaseSegunFaseActual() {
        if (!snapshot || partidaFinalizada) return;
        const fase = snapshot.faseCoop;
        if (fase === 'P1' || fase === 'P2') {
            if (mesaTotalmenteVacia(snapshot.cartasEnJuegoBot)) {
                rellenarVaciosDesdeMazo('bot', 4);
                intentarDesplegarBossCoop();
            }
        } else if (fase === 'BOT') {
            const mesaAVacia = mesaTotalmenteVacia(snapshot.cartasEnJuegoA);
            const mesaBVacia = mesaTotalmenteVacia(snapshot.cartasEnJuegoB);
            if (mesaAVacia && mesaBVacia) {
                rellenarVaciosDesdeMazo('A', 2);
                rellenarVaciosDesdeMazo('B', 2);
            }
            if (mesaTotalmenteVacia(snapshot.cartasEnJuegoBot)) {
                rellenarVaciosDesdeMazo('bot', 4);
                intentarDesplegarBossCoop();
            }
        }
    }

    function aplicarRobosInicioDeFaseEnSnapshotEmit(snap) {
        if (!snap || typeof snap !== 'object') return;
        normalizarSnapshotCoop(snap);
        if (snap.faseCoop === 'P1' || snap.faseCoop === 'P2') {
            if (mesaTotalmenteVacia(snap.cartasEnJuegoBot)) {
                rellenarVaciosDesdeMazoEnSnapshot(snap, 'bot', 4);
                intentarDesplegarBossEnSnap(snap);
            }
        } else if (snap.faseCoop === 'BOT') {
            const mesaAVacia = mesaTotalmenteVacia(snap.cartasEnJuegoA);
            const mesaBVacia = mesaTotalmenteVacia(snap.cartasEnJuegoB);
            if (mesaAVacia && mesaBVacia) {
                rellenarVaciosDesdeMazoEnSnapshot(snap, 'A', 2);
                rellenarVaciosDesdeMazoEnSnapshot(snap, 'B', 2);
            }
            if (mesaTotalmenteVacia(snap.cartasEnJuegoBot)) {
                rellenarVaciosDesdeMazoEnSnapshot(snap, 'bot', 4);
                intentarDesplegarBossEnSnap(snap);
            }
        }
    }

    /** Rellena vacíos robando del mazo con la misma cadencia que partida.js (render + `carta-robada` + pausa). */
    async function rellenarVaciosDesdeMazoAnimado(zona, maxSlots) {
        const mesa = obtenerMesaPorZona(zona);
        const mazo = obtenerMazoPorZona(zona);
        if (!Array.isArray(mesa) || !Array.isArray(mazo)) return false;
        let hubo = false;
        for (let i = 0; i < maxSlots; i += 1) {
            if (!mesa[i] && mazo.length > 0) {
                mesa[i] = crearCartaEnMesaDesdeMazo(mazo.shift());
                hubo = true;
                renderTodo();
                animarCartaRobadaCoop(zona, i);
                await esperar(COOP_MS_ENTRE_ROBO_MAZO);
            }
        }
        return hubo;
    }

    function puedeActuarSegunFase() {
        if (!snapshot || partidaFinalizada) return false;
        const fase = snapshot.faseCoop;
        if (fase === 'P1') return MI_EMAIL === EMAIL_LEADER;
        if (fase === 'P2') return MI_EMAIL === EMAIL_MEMBER;
        if (fase === 'BOT') return MI_EMAIL === EJECUTOR_BOT_EMAIL;
        return false;
    }

    function destacarTurnoUi() {
        const fase = snapshot?.faseCoop;
        const badgeA = document.getElementById('coop-turno-a-badge');
        const badgeB = document.getElementById('coop-turno-b-badge');
        const badgeBot = document.getElementById('coop-turno-bot-badge');
        const tuP1 = fase === 'P1' && MI_EMAIL === EMAIL_LEADER;
        const tuP2 = fase === 'P2' && MI_EMAIL === EMAIL_MEMBER;
        if (badgeA) badgeA.textContent = tuP1 ? 'Tu turno' : '';
        if (badgeB) badgeB.textContent = tuP2 ? 'Tu turno' : '';
        if (badgeBot) badgeBot.textContent = fase === 'BOT' ? 'Turno BOT' : 'BOT';
    }

    /** Temporizador propio del toast de cambio de turno; NO compartido con `#aviso-turno-coop`. */
    let coopToastTurnoHideTimer = null;
    function mostrarCoopToastTurno(texto, duracionMs = COOP_MS_AVISO_CAMBIO_FASE) {
        const toast = document.getElementById('coop-toast-turno');
        const txtEl = document.getElementById('coop-toast-turno-texto');
        if (!toast || !txtEl) return;
        txtEl.textContent = String(texto || '').trim();
        toast.classList.add('visible');
        toast.setAttribute('aria-hidden', 'false');
        if (coopToastTurnoHideTimer !== null) {
            clearTimeout(coopToastTurnoHideTimer);
            coopToastTurnoHideTimer = null;
        }
        const dur = Math.max(600, Number(duracionMs) || COOP_MS_AVISO_CAMBIO_FASE);
        coopToastTurnoHideTimer = setTimeout(() => {
            coopToastTurnoHideTimer = null;
            toast.classList.remove('visible');
            toast.setAttribute('aria-hidden', 'true');
        }, dur);
    }

    function actualizarAvisoTurnoCoopSiNuevaFase() {
        if (!snapshot || partidaFinalizada) return;
        const f = snapshot.faseCoop;
        if (f !== 'P1' && f !== 'P2' && f !== 'BOT') return;
        if (f === ultimaFaseCoopParaAvisoTurno) return;
        ultimaFaseCoopParaAvisoTurno = f;
        const jaNombre = String((payload.jugadorA || {}).nombre || '').trim() || 'Jugador 1';
        const jbNombre = String((payload.jugadorB || {}).nombre || '').trim() || 'Jugador 2';
        let txt = '';
        if (f === 'P1') {
            txt = `Turno de ${jaNombre}`;
        } else if (f === 'P2') {
            txt = `Turno de ${jbNombre}`;
        } else if (f === 'BOT') {
            txt = 'Turno del BOT';
        }
        /** Toast propio (no se pisa con los avisos de habilidad, que siguen usando `#aviso-turno-coop`). */
        mostrarCoopToastTurno(txt, COOP_MS_AVISO_CAMBIO_FASE);
    }

    function actualizarContadores() {
        const cb = document.getElementById('coop-contador-bot');
        const ca = document.getElementById('coop-contador-a');
        const cbb = document.getElementById('coop-contador-b');
        if (cb) cb.textContent = `Mazo: ${snapshot.mazoBot?.length ?? 0}`;
        if (ca) ca.textContent = `Mazo: ${snapshot.mazoA?.length ?? 0}`;
        if (cbb) cbb.textContent = `Mazo: ${snapshot.mazoB?.length ?? 0}`;
    }

    function renderSlotsPlano() {
        const ui = window.tableroCoopCartaUi;
        const botHost = document.getElementById('coop-fila-bot');
        const aHost = document.getElementById('coop-slots-a');
        const bHost = document.getElementById('coop-slots-b');
        if (!botHost || !aHost || !bHost || !snapshot || !ui) return;

        const { mesaBot, mesaA, mesaB } = ui.calcularMesasConBonus(snapshot);
        const dificultadEv = Math.min(6, Math.max(1, Number(payload?.evento?.dificultad || 1)));
        const fase = snapshot.faseCoop;
        const puede = puedeActuarSegunFase();

        const eligiendoBotObjetivo = (fase === 'P1' || fase === 'P2')
            && atacanteSel !== null
            && atacanteZona
            && ((fase === 'P1' && atacanteZona === 'A') || (fase === 'P2' && atacanteZona === 'B'))
            && puede;

        botHost.innerHTML = '';
        for (let i = 0; i < 4; i += 1) {
            const s = document.createElement('div');
            s.className = 'slot';
            s.dataset.zona = 'bot';
            s.dataset.slot = String(i);
            const raw = snapshot.cartasEnJuegoBot[i];
            if (!raw) {
                s.classList.add('vacio');
                botHost.appendChild(s);
                continue;
            }
            const carta = mesaBot[i];
            const tankIdx = ui.obtenerIndiceTankActivo(snapshot.cartasEnJuegoBot);
            const bloqueadaTank = Boolean(eligiendoBotObjetivo && tankIdx !== null && tankIdx !== i);
            const clickBot = Boolean(eligiendoBotObjetivo && !bloqueadaTank);
            ui.mostrarCartaEnSlotCoop(s, carta, 'oponente', i, {
                enemigosParaSalud: enemigosSaludParaZonaCoop('bot'),
                dificultadEvento: dificultadEv,
                onClickCarta: clickBot ? () => onClickSlot('bot', i) : undefined,
                bloqueadaPorTank: bloqueadaTank,
                partidaFinalizada,
                destacadaAtacando: coopAnimAtacante?.zona === 'bot' && coopAnimAtacante.slot === i,
                destacadaObjetivo: coopAnimObjetivo?.zona === 'bot' && coopAnimObjetivo.slot === i
            });
            botHost.appendChild(s);
        }

        aHost.innerHTML = '';
        for (let i = 0; i < 2; i += 1) {
            const s = document.createElement('div');
            s.className = 'slot';
            s.dataset.zona = 'A';
            s.dataset.slot = String(i);
            const raw = snapshot.cartasEnJuegoA[i];
            if (!raw) {
                s.classList.add('vacio');
                aHost.appendChild(s);
                continue;
            }
            const carta = mesaA[i];
            const clickA = fase === 'P1' && puede && MI_EMAIL === EMAIL_LEADER;
            const yaAtac = snapshot.cartasYaAtacaronA.includes(i);
            const puedeSelAtacante = clickA && !yaAtac && !cartaEstaAturdidaCoop(raw);
            const puedeUsarHab = puedeSelAtacante;
            ui.mostrarCartaEnSlotCoop(s, carta, 'jugador', i, {
                enemigosParaSalud: enemigosSaludParaZonaCoop('A'),
                dificultadEvento: dificultadEv,
                onClickCarta: puedeSelAtacante ? () => onClickSlot('A', i) : undefined,
                cartaAgotada: yaAtac || cartaEstaAturdidaCoop(raw),
                destacadaSeleccion: atacanteZona === 'A' && atacanteSel === i,
                destacadaAtacando: coopAnimAtacante?.zona === 'A' && coopAnimAtacante.slot === i,
                destacadaObjetivo: coopAnimObjetivo?.zona === 'A' && coopAnimObjetivo.slot === i,
                partidaFinalizada,
                cartasYaAtacaron: snapshot.cartasYaAtacaronA,
                deshabilitarBotonHabilidad: !puedeUsarHab,
                onUsarHabilidad: () => void manejarUsoHabilidadHumanaCoop('A', i)
            });
            aHost.appendChild(s);
        }

        bHost.innerHTML = '';
        for (let i = 0; i < 2; i += 1) {
            const s = document.createElement('div');
            s.className = 'slot';
            s.dataset.zona = 'B';
            s.dataset.slot = String(i);
            const raw = snapshot.cartasEnJuegoB[i];
            if (!raw) {
                s.classList.add('vacio');
                bHost.appendChild(s);
                continue;
            }
            const carta = mesaB[i];
            const clickB = fase === 'P2' && puede && MI_EMAIL === EMAIL_MEMBER;
            const yaAtac = snapshot.cartasYaAtacaronB.includes(i);
            const puedeSelAtacante = clickB && !yaAtac && !cartaEstaAturdidaCoop(raw);
            const puedeUsarHab = puedeSelAtacante;
            ui.mostrarCartaEnSlotCoop(s, carta, 'jugador', i, {
                enemigosParaSalud: enemigosSaludParaZonaCoop('B'),
                dificultadEvento: dificultadEv,
                onClickCarta: puedeSelAtacante ? () => onClickSlot('B', i) : undefined,
                cartaAgotada: yaAtac || cartaEstaAturdidaCoop(raw),
                destacadaSeleccion: atacanteZona === 'B' && atacanteSel === i,
                destacadaAtacando: coopAnimAtacante?.zona === 'B' && coopAnimAtacante.slot === i,
                destacadaObjetivo: coopAnimObjetivo?.zona === 'B' && coopAnimObjetivo.slot === i,
                partidaFinalizada,
                cartasYaAtacaron: snapshot.cartasYaAtacaronB,
                deshabilitarBotonHabilidad: !puedeUsarHab,
                onUsarHabilidad: () => void manejarUsoHabilidadHumanaCoop('B', i)
            });
            bHost.appendChild(s);
        }
    }

    function formatearEtiquetaAfiliacionCoop(afiliacion) {
        const txt = String(afiliacion || '').trim();
        return txt ? txt.charAt(0).toUpperCase() + txt.slice(1) : 'Sin afiliación';
    }

    function obtenerCartaBonusDebuffActivaCoop(cartas = []) {
        for (const carta of (Array.isArray(cartas) ? cartas : [])) {
            if (!cartaViva(carta)) continue;
            const meta = obtenerMetaHabilidad(carta);
            if (meta.tieneHabilidad && meta.trigger === 'auto' && meta.clase === 'bonus_debuff') {
                return carta;
            }
        }
        return null;
    }

    function actualizarIndicadoresAfiliacionesActivasCoop() {
        const ui = window.tableroCoopCartaUi;
        if (!ui || typeof ui.aplicarBonusAfiliaciones !== 'function' || !snapshot) return;
        const cartasA = Array.isArray(snapshot.cartasEnJuegoA) ? snapshot.cartasEnJuegoA : [];
        const cartasB = Array.isArray(snapshot.cartasEnJuegoB) ? snapshot.cartasEnJuegoB : [];
        const cartasBot = Array.isArray(snapshot.cartasEnJuegoBot) ? snapshot.cartasEnJuegoBot : [];
        const equipoHumano = [...cartasA, ...cartasB].filter(Boolean);
        const enemigosA = cartasBot.filter(Boolean);
        const enemigosB = cartasBot.filter(Boolean);
        const enemigosBot = equipoHumano;

        const { afiliacionPrincipal: activaA } = ui.aplicarBonusAfiliaciones(cartasA, enemigosA, equipoHumano, equipoHumano);
        const { afiliacionPrincipal: activaB } = ui.aplicarBonusAfiliaciones(cartasB, enemigosB, equipoHumano, equipoHumano);
        const { afiliacionPrincipal: activaBot } = ui.aplicarBonusAfiliaciones(cartasBot, enemigosBot);

        const anulaA = obtenerCartaBonusDebuffActivaCoop(enemigosA);
        const anulaB = obtenerCartaBonusDebuffActivaCoop(enemigosB);
        const anulaBot = obtenerCartaBonusDebuffActivaCoop(enemigosBot);

        const actualizar = (id, parentSelector, beforeSelector, afiliacionActiva, anulador = null) => {
            let contenedor = document.getElementById(id);
            if (!contenedor) {
                const parent = document.querySelector(parentSelector);
                if (!parent) return;
                contenedor = document.createElement('div');
                contenedor.id = id;
                contenedor.className = 'bonus-activo-tablero';
                const before = beforeSelector ? parent.querySelector(beforeSelector) : null;
                if (before) parent.insertBefore(contenedor, before);
                else parent.appendChild(contenedor);
            }

            contenedor.innerHTML = '';
            if (!afiliacionActiva) return;

            const linea = document.createElement('div');
            if (anulador) {
                linea.className = 'bonus-anulado-item';
                linea.textContent = `Bonus Anulado por "${anulador.Nombre}": ${formatearEtiquetaAfiliacionCoop(afiliacionActiva.afiliacion)} (+${afiliacionActiva.bonus})`;
            } else {
                linea.className = 'bonus-activo-item';
                linea.textContent = `Bonus activo: ${formatearEtiquetaAfiliacionCoop(afiliacionActiva.afiliacion)} (+${afiliacionActiva.bonus})`;
            }
            contenedor.appendChild(linea);
        };

        actualizar('coop-bonus-activo-bot', '.coop-mesa', '#coop-fila-bot', activaBot, anulaBot);
        actualizar('coop-bonus-activo-a', '#coop-zona-a', '#coop-slots-a', activaA, anulaA);
        actualizar('coop-bonus-activo-b', '#coop-zona-b', '#coop-slots-b', activaB, anulaB);
    }

    /**
     * Aplica `opacity: 0` a las cartas montadas por `renderSlotsPlano` cuyo slot aún
     * NO ha sido revelado en la animación de apertura. Se llama síncronamente después
     * de cada `renderSlotsPlano` mientras `coopAnimEntradaInicialActiva` esté activo,
     * antes de que el navegador pueda pintar el frame.
     */
    function ocultarCartasAperturaSinRevelarSync() {
        if (!coopAnimEntradaInicialActiva) return;
        const aplicarA = (zona, n) => {
            for (let i = 0; i < n; i += 1) {
                if (coopSlotsAperturaRevelados.has(`${zona}:${i}`)) continue;
                const slotEl = obtenerSlotElementCoop(zona, i);
                const carta = slotEl?.querySelector('.carta');
                if (carta) carta.style.opacity = '0';
            }
        };
        aplicarA('bot', 4);
        aplicarA('A', 2);
        aplicarA('B', 2);
    }

    function renderTodo() {
        sincronizarHealDebuffCoop();
        destacarTurnoUi();
        actualizarContadores();
        renderSlotsPlano();
        actualizarIndicadoresAfiliacionesActivasCoop();
        ocultarCartasAperturaSinRevelarSync();
        actualizarAvisoTurnoCoopSiNuevaFase();
    }

    function emitirEstadoServidor(snapshotWire) {
        if (typeof window.emitMultiplayerCoopEstado !== 'function') return;
        window.emitMultiplayerCoopEstado({
            sessionId: SESSION_ID,
            snapshot: snapshotWire != null ? snapshotWire : snapshot,
            baseRevision: revisionConfirmada
        });
    }

    /**
     * Emite metadata explícita de la acción actual (ataque básico / habilidad) para que el
     * observador no tenga que inferirla desde el diff. Debe llamarse inmediatamente antes
     * de `emitirEstadoServidor` de esa misma revisión.
     */
    function emitirAccionServidor(accion) {
        if (typeof window.emitMultiplayerCoopAccion !== 'function') return;
        if (!accion || typeof accion !== 'object') return;
        window.emitMultiplayerCoopAccion({
            sessionId: SESSION_ID,
            revisionNueva: revisionConfirmada + 1,
            accion
        });
    }

    function consumirAccionCoopPorRevision(rev) {
        const r = Number(rev);
        if (!Number.isFinite(r)) return null;
        const a = coopAccionesPorRevision.has(r) ? coopAccionesPorRevision.get(r) : null;
        coopAccionesPorRevision.delete(r);
        /** Pasa del hueco las revisiones anteriores (resync o mensajes perdidos). */
        for (const k of Array.from(coopAccionesPorRevision.keys())) {
            if (k < r) coopAccionesPorRevision.delete(k);
        }
        return a;
    }

    /** Espera el siguiente dc:coop-estado de esta sesión (p. ej. respuesta a estado:solicitar). */
    function esperarProximoEstadoCoopCualquiera(timeoutMs = 5000) {
        return new Promise(resolve => {
            const fn = (ev) => {
                const det = ev.detail || {};
                if (String(det.sessionId || '') !== SESSION_ID) return;
                window.removeEventListener('dc:coop-estado', fn);
                clearTimeout(t);
                resolve();
            };
            const t = setTimeout(() => {
                window.removeEventListener('dc:coop-estado', fn);
                resolve();
            }, timeoutMs);
            window.addEventListener('dc:coop-estado', fn);
        });
    }

    /**
     * Emite estado y espera a que `procesarEstadoCoopDesdeRed` aplique el eco (animación + snapshot).
     * `marcarSaltarReplayVisual`: quien ya jugó la animación local no repite al recibir el mismo eco.
     * `marcarSaltarAnimRellenoCiclo`: el ejecutor ya animó el relleno de mazos al cerrar el ciclo BOT.
     */
    async function emitSnapshotCoopYEsperarEco(timeoutMs = 8000, opts = {}) {
        if (opts.marcarSaltarReplayVisual) {
            coopSaltarReplayProximaRevision = revisionConfirmada + 1;
        } else {
            /** Evita que un `coopSaltarReplayProximaRevision` viejo haga saltar el procesado del eco equivocado. */
            coopSaltarReplayProximaRevision = null;
        }
        if (opts.marcarSaltarAnimRellenoCiclo) {
            coopSaltarAnimRellenoCicloRevision = revisionConfirmada + 1;
        }
        const revAlEmitir = revisionConfirmada;
        const snapWire = opts.snapshotParaRed != null ? opts.snapshotParaRed : snapshot;
        await new Promise((resolve) => {
            let terminado = false;
            const done = () => {
                if (terminado) return;
                terminado = true;
                if (coopEmitTimerEsperaEco !== null) {
                    clearTimeout(coopEmitTimerEsperaEco);
                    coopEmitTimerEsperaEco = null;
                }
                coopEmitRevAntes = null;
                coopEmitDone = null;
                resolve();
            };
            coopEmitDone = done;
            coopEmitRevAntes = revAlEmitir;
            coopEmitTimerEsperaEco = setTimeout(() => {
                (async () => {
                    if (typeof coopEmitDone !== 'function') return;
                    coopDebugYo(`emit timeout→solicitar estado revAntes=${revAlEmitir}`);
                    if (typeof window.emitMultiplayerCoopEstadoSolicitar === 'function') {
                        window.emitMultiplayerCoopEstadoSolicitar(SESSION_ID);
                    }
                    await esperarProximoEstadoCoopCualquiera(5000);
                    if (typeof coopEmitDone === 'function') coopEmitDone();
                })();
            }, timeoutMs);
            /** Estado canónico en red (p. ej. con cementerio); el tablero local puede seguir un frame “de animación”. */
            coopDebugYo(
                `emit→srv revAntes=${revAlEmitir} fase=${snapWire?.faseCoop} skipReplay=${opts.marcarSaltarReplayVisual ? 'sí' : 'no'} skipRellenoCiclo=${opts.marcarSaltarAnimRellenoCiclo ? 'sí' : 'no'}`
            );
            emitirEstadoServidor(snapWire);
        });
    }

    function verificarFinPartidaCoop() {
        if (partidaFinalizada) return false;
        const pendienteBoss = snapshot.bossPendienteCoop ? 1 : 0;
        const quedanBot = indicesAtacantesVivos(snapshot.cartasEnJuegoBot).length
            + (snapshot.mazoBot?.length || 0)
            + pendienteBoss;
        const quedanA = indicesAtacantesVivos(snapshot.cartasEnJuegoA).length + (snapshot.mazoA?.length || 0);
        const quedanB = indicesAtacantesVivos(snapshot.cartasEnJuegoB).length + (snapshot.mazoB?.length || 0);
        if (quedanBot <= 0) {
            partidaFinalizada = true;
            mostrarFin(true);
            if (typeof window.emitMultiplayerCoopResultado === 'function') {
                window.emitMultiplayerCoopResultado({
                    sessionId: SESSION_ID,
                    ganaronJugadores: true,
                    motivo: 'sin_cartas_bot'
                });
            }
            return true;
        }
        if (quedanA <= 0 && quedanB <= 0) {
            partidaFinalizada = true;
            mostrarFin(false);
            if (typeof window.emitMultiplayerCoopResultado === 'function') {
                window.emitMultiplayerCoopResultado({
                    sessionId: SESSION_ID,
                    ganaronJugadores: false,
                    motivo: 'sin_cartas_jugadores'
                });
            }
            return true;
        }
        return false;
    }

    /* =========================================================================
     * RECOMPENSAS COOP (espec. EVENTO_COOPERATIVO_ONLINE_ESPEC.md):
     * Si el equipo humano gana, cada cliente otorga su propia recompensa al
     * usuario logueado (puntos, mejoras y carta del evento) y la persiste en
     * Firebase con `actualizarUsuarioFirebase` (idéntico flujo que el VS BOT
     * en `partida.js#otorgarRecompensasDesafio`). Cada cliente guarda solo su
     * propio progreso para no interferir con la cuenta del compañero.
     * ========================================================================= */

    const COOP_ICONO_MEJORA = '/resources/icons/mejora.png';
    const COOP_ICONO_MEJORA_ESPECIAL = '/resources/icons/mejora_especial.png';
    const COOP_ICONO_MONEDA = '/resources/icons/moneda.png';

    /** Marca local que evita aplicar las recompensas más de una vez por sesión. */
    let coopRecompensasProcesadas = false;

    function coopNormalizarNombre(nombre) {
        return String(nombre || '').trim().toLowerCase();
    }

    async function coopActualizarUsuarioFirebase(usuario, email) {
        const response = await fetch('/update-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, email })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 409 && data?.usuario) {
                localStorage.setItem('usuario', JSON.stringify(data.usuario));
            }
            throw new Error(data?.mensaje || 'No se pudieron guardar los datos del usuario en Firebase.');
        }
        if (data?.usuario && usuario && typeof usuario === 'object') {
            Object.keys(usuario).forEach((k) => delete usuario[k]);
            Object.assign(usuario, data.usuario);
        }
        return data;
    }

    async function coopObtenerCartasDisponibles() {
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

    /**
     * Replica `escalarCartaSegunDificultad` de `partida.js` sin tocar ese fichero.
     * `obtenerSaludMaxCarta` y `recalcularSkillPowerPorNivel` ya están expuestos
     * por `tableroCoopCartaUi` y `cartas.js` respectivamente.
     */
    function coopEscalarCartaSegunDificultad(carta, dificultad) {
        const obtenerSaludMaxCartaCoop = window.tableroCoopCartaUi?.obtenerSaludMaxCarta;
        const cartaEscalada = { ...carta };
        const nivelBase = Number(cartaEscalada.Nivel || 1);
        const dificultadObjetivo = Math.min(Math.max(Number(dificultad || 1), 1), 6);
        const incrementoNiveles = Math.max(dificultadObjetivo - nivelBase, 0);
        const saludBase = typeof obtenerSaludMaxCartaCoop === 'function'
            ? Number(obtenerSaludMaxCartaCoop(cartaEscalada) || 0)
            : Number(cartaEscalada.SaludMax || cartaEscalada.Salud || 0);
        cartaEscalada.Nivel = dificultadObjetivo;
        cartaEscalada.Poder = Number(cartaEscalada.Poder || 0) + (incrementoNiveles * 500);
        cartaEscalada.SaludMax = saludBase + (incrementoNiveles * 500);
        cartaEscalada.Salud = cartaEscalada.SaludMax;
        if (typeof window.recalcularSkillPowerPorNivel === 'function') {
            window.recalcularSkillPowerPorNivel(cartaEscalada, dificultadObjetivo, { rawEsBase: true });
        }
        return cartaEscalada;
    }

    /**
     * Clave de rotación solo para eventos cooperativos online (debe coincidir con
     * `multijugadorEventosCoop.js`). No usar `event-rotation-v1` de VS BOT: los IDs de
     * evento offline y online se solapan y compartir bucket marcaba coop como completado por error.
     */
    function coopObtenerClaveRotacionEventos() {
        const ROT_MS = 60 * 60 * 1000;
        const VERSION = 'event-rotation-coop-online-v1';
        const idVentana = Math.floor(Date.now() / ROT_MS);
        return `${VERSION}-${idVentana}`;
    }

    /**
     * Otorga las recompensas del evento al usuario local (cada cliente guarda solo
     * su propia cuenta). Equivalente coop de `otorgarRecompensasDesafio` (VS BOT).
     */
    async function otorgarRecompensasCoop() {
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        const email = localStorage.getItem('email');
        if (!usuario || !email) {
            throw new Error('No se encontró una sesión de usuario válida para guardar las recompensas.');
        }

        const evento = (payload && typeof payload.evento === 'object') ? payload.evento : null;
        const puntosExcel = Number(evento?.puntos || 0);
        const mejorasEvento = Number(evento?.mejora || 0);
        const mejorasEspecialesEventoBase = Number(evento?.mejora_especial || 0);
        const dificultadEvento = Math.min(Math.max(Number(evento?.dificultad || 1), 1), 6);
        const puntosEvento = typeof window.calcularPuntosRecompensaEventoPorDificultad === 'function'
            ? window.calcularPuntosRecompensaEventoPorDificultad(puntosExcel, dificultadEvento)
            : Math.max(0, Math.round((dificultadEvento / 6) * puntosExcel));
        const idEvento = Number(evento?.id);
        /**
         * La mejora especial solo se entrega si la dificultad elegida es 6 o superior.
         * En dificultades inferiores el valor entregado es 0, aunque el evento defina
         * `mejora_especial > 0`.
         */
        const otorgaMejoraEspecial = dificultadEvento >= 6;
        const mejorasEspecialesEvento = otorgaMejoraEspecial ? mejorasEspecialesEventoBase : 0;

        /**
         * Pool de candidatos para la carta de recompensa: enemigos normales + BOSS del evento.
         * El sorteo es local en cada cliente (cada jugador tira por su cuenta).
         */
        const enemigosEvento = Array.isArray(evento?.enemigos)
            ? evento.enemigos.map(n => String(n || '').trim()).filter(Boolean)
            : [];
        const bossEvento = String(evento?.boss ?? evento?.Boss ?? evento?.BOSS ?? '').trim();

        usuario.puntos = Number(usuario.puntos || 0) + puntosEvento;
        usuario.objetos = (usuario.objetos && typeof usuario.objetos === 'object')
            ? usuario.objetos
            : { mejoraCarta: 0, mejoraEspecial: 0 };
        usuario.objetos.mejoraCarta = Number(usuario.objetos.mejoraCarta || 0) + mejorasEvento;
        usuario.objetos.mejoraEspecial = Number(usuario.objetos.mejoraEspecial || 0) + mejorasEspecialesEvento;

        if (Number.isFinite(idEvento)) {
            const claveRotacion = coopObtenerClaveRotacionEventos();
            usuario.eventosJugadosPorRotacion = (usuario.eventosJugadosPorRotacion && typeof usuario.eventosJugadosPorRotacion === 'object')
                ? usuario.eventosJugadosPorRotacion
                : {};
            const jugadosActual = new Set(
                (usuario.eventosJugadosPorRotacion[claveRotacion] || []).map((id) => Number(id))
            );
            jugadosActual.add(idEvento);
            usuario.eventosJugadosPorRotacion[claveRotacion] = Array.from(jugadosActual);
        }

        const cartasGanadas = [];
        usuario.cartas = Array.isArray(usuario.cartas) ? usuario.cartas : [];
        const cartasUsuarioAntesRecompensa = usuario.cartas.slice();
        let nuevasH = 0;
        let nuevasV = 0;
        let catalogoCoopParaMision = null;
        if (enemigosEvento.length > 0 || bossEvento) {
            /**
             * 80% probabilidad → carta aleatoria de los enemigos normales del evento.
             * 20% probabilidad → carta del BOSS del evento.
             * Si la opción sorteada no está disponible (sin BOSS o sin enemigos),
             * cae en la otra disponible. Si ninguna existe, no se entrega carta.
             */
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
                try {
                    const skinsApi = typeof window.DCSkinsCartas !== 'undefined' ? window.DCSkinsCartas : null;
                    if (skinsApi?.esReferenciaRecompensaSkin?.(nombreElegido)) {
                        const skinRec = await skinsApi.construirRecompensaSkinDesdeReferencia(nombreElegido);
                        if (skinRec) {
                            skinsApi.persistirSkinsRecompensaEnUsuario(usuario, [skinRec]);
                            cartasGanadas.push(skinRec);
                        }
                    } else {
                        const nombreCatalogo = skinsApi?.obtenerNombreCatalogoDesdeReferencia
                            ? skinsApi.obtenerNombreCatalogoDesdeReferencia(nombreElegido)
                            : nombreElegido;
                        const catalogo = await coopObtenerCartasDisponibles();
                        catalogoCoopParaMision = catalogo;
                        const cartaBase = catalogo.find((c) => coopNormalizarNombre(c?.Nombre) === coopNormalizarNombre(nombreCatalogo));
                        if (cartaBase) {
                            const cartaEscalada = coopEscalarCartaSegunDificultad(cartaBase, dificultadEvento);
                            cartaEscalada.tipoRecompensa = 'evento';
                            cartasGanadas.push(cartaEscalada);
                            usuario.cartas.push(cartaEscalada);
                        } else {
                            console.warn('[coop] carta de recompensa sorteada no encontrada en catálogo:', nombreElegido);
                        }
                    }
                } catch (errCarta) {
                    console.error('[coop] no se pudo añadir carta recompensa:', errCarta);
                }
            }
        }

        const skinsApiCoop = typeof window.DCSkinsCartas !== 'undefined' ? window.DCSkinsCartas : null;
        const separadoCoop = skinsApiCoop?.separarRecompensasCartasYSkins
            ? skinsApiCoop.separarRecompensasCartasYSkins(cartasGanadas)
            : { cartas: cartasGanadas, skins: [] };
        if (separadoCoop.cartas.length > 0 && typeof window.dcContarCartasNuevasPorFaccion === 'function') {
            const c = window.dcContarCartasNuevasPorFaccion(
                separadoCoop.cartas,
                cartasUsuarioAntesRecompensa,
                catalogoCoopParaMision
            );
            nuevasH = c.nuevasH;
            nuevasV = c.nuevasV;
        }

        await coopActualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));

        return {
            puntosGanados: puntosEvento,
            mejorasGanadas: mejorasEvento,
            mejorasEspecialesGanadas: mejorasEspecialesEvento,
            cartasGanadas,
            nuevasH,
            nuevasV,
            /** Misiones diarias (class boss): mismo criterio que recompensa carta 20 % boss. */
            huboBossMision: Boolean(bossEvento)
        };
    }

    function coopFormatoPuntosConMoneda(valor) {
        return `${Number(valor || 0)} <img src="${COOP_ICONO_MONEDA}" alt="Moneda" style="width:18px;height:18px;object-fit:contain;vertical-align:text-bottom;margin-left:4px;">`;
    }

    function coopCrearEtiquetaObjetoRecompensa(tipo, cantidad) {
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
        icono.src = tipo === 'mejoraEspecial' ? COOP_ICONO_MEJORA_ESPECIAL : COOP_ICONO_MEJORA;
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

    function coopCrearCartaRecompensaElemento(carta) {
        if (carta?.tipoRecompensa === 'skin'
            && typeof window.DCSkinsCartas !== 'undefined'
            && typeof window.DCSkinsCartas.crearElementoRecompensaSkin === 'function') {
            const elSkin = window.DCSkinsCartas.crearElementoRecompensaSkin(carta);
            if (elSkin) {
                return elSkin;
            }
        }
        const contenedor = document.createElement('div');
        contenedor.classList.add('carta-recompensa-slot');
        const ui = window.tableroCoopCartaUi;
        if (ui && typeof ui.crearCartaElementoCoop === 'function') {
            const res = ui.crearCartaElementoCoop(carta, 'recompensa', -1, { soloVista: true });
            if (res?.root) contenedor.appendChild(res.root);
        } else {
            const fallback = document.createElement('div');
            fallback.className = 'carta carta-solo-vista';
            fallback.textContent = String(carta?.Nombre || '').trim() || 'Carta';
            contenedor.appendChild(fallback);
        }
        return contenedor;
    }

    function mostrarFin(ganaron) {
        const modal = document.getElementById('ventana-emergente-fin-coop');
        const t = document.getElementById('titulo-fin-partida-coop');
        const m = document.getElementById('mensaje-fin-partida-coop');
        if (t) t.textContent = ganaron ? 'Victoria' : 'Derrota';
        if (m) m.textContent = ganaron
            ? 'Habéis derrotado al BOT en el evento cooperativo.'
            : 'El BOT ha eliminado a tu equipo.';
        if (modal) modal.style.display = 'flex';

        const recompensasContainer = document.getElementById('coop-recompensas-container');
        if (recompensasContainer) recompensasContainer.innerHTML = '';

        if (!ganaron || !recompensasContainer) return;

        if (coopRecompensasProcesadas) {
            const aviso = document.createElement('p');
            aviso.classList.add('texto-recompensa-estado');
            aviso.textContent = 'Las recompensas de esta victoria ya se han aplicado.';
            recompensasContainer.appendChild(aviso);
            return;
        }
        coopRecompensasProcesadas = true;

        const estadoGuardado = document.createElement('p');
        estadoGuardado.classList.add('texto-recompensa-estado');
        estadoGuardado.textContent = 'Guardando recompensas y progreso...';
        recompensasContainer.appendChild(estadoGuardado);

        const botonVolver = document.getElementById('boton-volver-multi-coop');
        if (botonVolver) botonVolver.disabled = true;

        (async () => {
            try {
                const recompensa = await otorgarRecompensasCoop();
                recompensasContainer.innerHTML = '';
                /** Tras persistir recompensas en LS/Firebase para no pisar puntos/cartas con el POST de misiones. */
                if (window.DCMisiones?.track) {
                    window.DCMisiones.track('evento_coop', { amount: 1 });
                    if (recompensa.huboBossMision) {
                        window.DCMisiones.track('boss', { amount: 1 });
                    }
                    if (Number(recompensa.nuevasH || 0) > 0) window.DCMisiones.track('coleccion_h', { amount: Number(recompensa.nuevasH || 0) });
                    if (Number(recompensa.nuevasV || 0) > 0) window.DCMisiones.track('coleccion_v', { amount: Number(recompensa.nuevasV || 0) });
                }

                const resumen = document.createElement('p');
                resumen.classList.add('texto-recompensa-resumen');
                const cartasTxt = recompensa.cartasGanadas.length > 0
                    ? ` y ${recompensa.cartasGanadas.length} carta${recompensa.cartasGanadas.length === 1 ? '' : 's'} nueva${recompensa.cartasGanadas.length === 1 ? '' : 's'}`
                    : '';
                resumen.innerHTML = `Recompensas: ${coopFormatoPuntosConMoneda(recompensa.puntosGanados)}${cartasTxt}.`;
                recompensasContainer.appendChild(resumen);

                if (recompensa.mejorasGanadas > 0 || recompensa.mejorasEspecialesGanadas > 0) {
                    const filaObjetos = document.createElement('div');
                    filaObjetos.classList.add('coop-recompensas-objetos');
                    if (recompensa.mejorasGanadas > 0) {
                        filaObjetos.appendChild(coopCrearEtiquetaObjetoRecompensa('mejoraCarta', recompensa.mejorasGanadas));
                    }
                    if (recompensa.mejorasEspecialesGanadas > 0) {
                        filaObjetos.appendChild(coopCrearEtiquetaObjetoRecompensa('mejoraEspecial', recompensa.mejorasEspecialesGanadas));
                    }
                    recompensasContainer.appendChild(filaObjetos);
                }

                if (recompensa.cartasGanadas.length > 0) {
                    const rejilla = document.createElement('div');
                    rejilla.classList.add('coop-recompensas-grid', 'recompensas-grid');
                    recompensa.cartasGanadas.forEach((carta) => {
                        rejilla.appendChild(coopCrearCartaRecompensaElemento(carta));
                    });
                    recompensasContainer.appendChild(rejilla);
                }

                const usuarioActualizado = JSON.parse(localStorage.getItem('usuario') || 'null');
                const totalPuntos = Number(usuarioActualizado?.puntos || 0);
                const puntosTotales = document.createElement('p');
                puntosTotales.classList.add('texto-recompensa-puntos');
                puntosTotales.innerHTML = `Puntos totales: ${coopFormatoPuntosConMoneda(totalPuntos)}.`;
                recompensasContainer.appendChild(puntosTotales);
            } catch (error) {
                console.error('[coop] error al otorgar recompensas:', error);
                recompensasContainer.innerHTML = '';
                const errorEl = document.createElement('p');
                errorEl.classList.add('texto-recompensa-error');
                errorEl.textContent = `No se pudieron guardar las recompensas: ${error.message || error}`;
                recompensasContainer.appendChild(errorEl);
                /**
                 * Si falla la persistencia, permitir reintento manual: liberamos la
                 * marca para que el siguiente refresco del modal pueda volver a guardar.
                 */
                coopRecompensasProcesadas = false;
            } finally {
                if (botonVolver) botonVolver.disabled = false;
            }
        })();
    }

    /** Lógica de `avanzarFaseTrasHumano` sobre un snapshot concreto (p. ej. clon para enviar a red antes de avanzar el tablero local). */
    function avanzarFaseTrasHumanoEnSnapshot(snap, zonaActor) {
        if (!snap || typeof snap !== 'object') return false;
        normalizarSnapshotCoop(snap);
        if (zonaActor === 'A') {
            const pendientes = indicesPuedenAtacarEnSnapshot(snap, 'A');
            if (pendientes.length > 0) return false;
            snap.faseCoop = 'P2';
            snap.cartasYaAtacaronA = [];
            aplicarInicioDeFaseEnSnapshot(snap, 'P2');
            return true;
        }
        if (zonaActor === 'B') {
            const pendientes = indicesPuedenAtacarEnSnapshot(snap, 'B');
            if (pendientes.length > 0) return false;
            snap.faseCoop = 'BOT';
            snap.cartasYaAtacaronB = [];
            aplicarInicioDeFaseEnSnapshot(snap, 'BOT');
            return true;
        }
        return false;
    }

    function avanzarFaseTrasHumano(zonaActor) {
        const faseAntes = snapshot?.faseCoop;
        if (avanzarFaseTrasHumanoEnSnapshot(snapshot, zonaActor)) {
            if (snapshot.faseCoop === 'P2' && faseAntes === 'P1') logCoop('Turno del jugador 2.');
            if (snapshot.faseCoop === 'BOT' && faseAntes === 'P2') logCoop('Turno del BOT.');
        }
    }

    function registrarAtaqueHumano(zona, slotAtacante) {
        if (zona === 'A') {
            if (!snapshot.cartasYaAtacaronA.includes(slotAtacante)) {
                snapshot.cartasYaAtacaronA.push(slotAtacante);
            }
        }
        if (zona === 'B') {
            if (!snapshot.cartasYaAtacaronB.includes(slotAtacante)) {
                snapshot.cartasYaAtacaronB.push(slotAtacante);
            }
        }
    }

    async function manejarUsoHabilidadHumanaCoop(zona, slotIndex) {
        if (partidaFinalizada || procesandoBot || aplicandoAccionCoop || !puedeActuarSegunFase()) return;
        const fase = snapshot?.faseCoop;
        if ((zona === 'A' && fase !== 'P1') || (zona === 'B' && fase !== 'P2')) return;
        const mesa = obtenerMesaPorZona(zona);
        const carta = mesa?.[slotIndex];
        if (!carta || !cartaViva(carta)) return;
        const yaAtacaron = zona === 'A' ? snapshot.cartasYaAtacaronA : snapshot.cartasYaAtacaronB;
        if (Array.isArray(yaAtacaron) && yaAtacaron.includes(slotIndex)) {
            logCoop(`${carta.Nombre} ya actuó este turno.`);
            return;
        }
        if (cartaEstaAturdidaCoop(carta)) {
            logCoop(`${carta.Nombre} está aturdida y no puede usar habilidades este turno.`);
            return;
        }
        const meta = obtenerMetaHabilidad(carta);
        if (!meta.tieneHabilidad || meta.trigger !== 'usar') return;
        const cooldownActual = Math.max(0, Number(carta.habilidadCooldownRestante || 0));
        if (cooldownActual > 0) {
            logCoop(`${carta.Nombre} tiene la habilidad en cooldown (${cooldownActual} turno(s)).`);
            return;
        }

        aplicandoAccionCoop = true;
        try {
            /** Guardamos el estado previo a la habilidad para reproducir la animación local en el emisor. */
            const snapAntes = JSON.parse(JSON.stringify(snapshot));
            const usada = await usarHabilidadActivaCoop(zona, slotIndex, false);
            if (!usada) return;
            coopDebugYo(`habilidad activa zona=${zona} slot=${slotIndex}`);
            /** Clon con `coopReplayVisual` incluido; `prepararSnapshotEmitConReplayHabilidad` promueve a cementerio si aplica. */
            const snapEmit = clonarSnapshotParaRed();
            prepararSnapshotEmitConReplayHabilidad(snapEmit);
            const replayLocal = snapEmit.coopReplayVisual
                ? JSON.parse(JSON.stringify(snapEmit.coopReplayVisual))
                : null;
            const snapDespuesCanon = JSON.parse(JSON.stringify(snapEmit));
            /**
             * Emitir ANTES de animar para que el observador reciba el snapshot y arranque
             * su animación en paralelo. Tras emitir esperamos el propio broadcast del servidor
             * (máx `COOP_MS_ESPERA_ECO_SYNC`) y SOLO entonces animamos localmente: así ambos
             * clientes arrancan la animación partiendo del mismo `multiplayer:coop:estado`,
             * eliminando la latencia visible entre jugador_1 y jugador_2.
             */
            emitirAccionServidor({
                tipo: 'habilidad',
                zonaAtacante: zona,
                slotAtacante: slotIndex,
                skillClass: replayLocal?.tipoAccion || null,
                skillName: replayLocal?.textoAnuncio || null
            });
            const emitPromise = emitSnapshotCoopYEsperarEco(8000, {
                marcarSaltarReplayVisual: true,
                snapshotParaRed: snapEmit
            });
            try {
                await Promise.race([emitPromise, esperar(COOP_MS_ESPERA_ECO_SYNC)]);
                if (replayLocal) {
                    await animarHabilidadLocalEnEmisorCoop(snapAntes, snapDespuesCanon, replayLocal);
                }
            } finally {
                await emitPromise;
            }
        } finally {
            aplicandoAccionCoop = false;
            renderTodo();
        }
    }

    async function resolverAtaqueHumanoAZona(zonaAtacante, slotAtacante, zonaObjetivo, slotObjetivo) {
        const mesaAt = obtenerMesaPorZona(zonaAtacante);
        const mesaObj = obtenerMesaPorZona(zonaObjetivo);
        const cementObj = obtenerCementerioPorZona(zonaObjetivo);
        const atacante = mesaAt[slotAtacante];
        const objetivo = mesaObj[slotObjetivo];
        if (!atacante || !objetivo) return;
        if (cartaEstaAturdidaCoop(atacante)) {
            logCoop(`${atacante.Nombre} está incapacitada y no puede atacar.`);
            return;
        }

        const danio = obtenerPoderAtaqueCoop(zonaAtacante, slotAtacante);
        logCoop(`${atacante.Nombre} ataca a ${objetivo.Nombre} (${danio}).`);
        coopDebugYo(`ataque humano ${zonaAtacante}:${slotAtacante}→${zonaObjetivo}:${slotObjetivo} daño=${danio}`);

        const ui = window.tableroCoopCartaUi;
        const enemigosObj = enemigosSaludParaZonaCoop(zonaObjetivo);
        const estadoAntesTotal = ui && typeof ui.obtenerSaludEfectiva === 'function'
            ? ui.obtenerSaludEfectiva(objetivo, enemigosObj).totalActual
            : obtenerSaludActualCarta(objetivo) + Math.max(0, Number(objetivo.escudoActual || 0));
        const danioMostrar = Math.min(danio, Math.max(0, estadoAntesTotal));

        const objetivoRef = objetivo;
        const saludRawAntes = obtenerSaludActualCarta(objetivoRef);
        const escudoAntes = Math.max(0, Number(objetivoRef.escudoActual || 0));

        const temp = JSON.parse(JSON.stringify(objetivoRef));
        aplicarDanioCarta(temp, danio, zonaObjetivo);
        const saludRawFinal = obtenerSaludActualCarta(temp);
        const escudoFinal = Math.max(0, Number(temp.escudoActual || 0));

        const impactoConEscudo = escudoAntes > 0 || escudoFinal > 0;

        aplicarDanioCarta(objetivoRef, danio, zonaObjetivo);
        const murio = !cartaViva(objetivoRef);

        atacanteSel = null;
        atacanteZona = null;

        registrarAtaqueHumano(zonaAtacante, slotAtacante);
        if (verificarFinPartidaCoop()) {
            const snapEmit = clonarSnapshotParaRed();
            if (murio) promoverObjetivoMuertoACementerioEnSnapshot(snapEmit, zonaObjetivo, slotObjetivo);
            emitirAccionServidor({
                tipo: 'ataque_basico',
                zonaAtacante,
                slotAtacante,
                zonaObjetivo,
                slotObjetivo
            });
            const emitFin = emitSnapshotCoopYEsperarEco(8000, {
                marcarSaltarReplayVisual: true,
                snapshotParaRed: snapEmit
            });
            coopAnimAtacante = { zona: zonaAtacante, slot: slotAtacante };
            coopAnimObjetivo = { zona: zonaObjetivo, slot: slotObjetivo };
            restaurarSaludEscudoVisual(objetivoRef, saludRawAntes, escudoAntes);
            renderTodo();
            try {
                await esperar(COOP_MS_PRE_IMPACTO_ATAQUE);
                const tipoFloat = (zonaObjetivo === 'A' || zonaObjetivo === 'B') ? 'jugador' : 'oponente';
                mostrarValorFlotanteCoop(zonaObjetivo, slotObjetivo, danioMostrar, tipoFloat, 'danio');
                if (murio) {
                    await animarBajadaSaludCartaCoop(zonaObjetivo, slotObjetivo, saludRawAntes, saludRawFinal, {
                        escudoInicial: escudoAntes,
                        escudoFinal
                    });
                } else if (impactoConEscudo) {
                    restaurarSaludEscudoVisual(objetivoRef, saludRawFinal, escudoFinal);
                    renderTodo();
                    await esperar(COOP_MS_IMPACTO_ESCUDO_HUMANO);
                } else {
                    await animarBajadaSaludCartaCoop(zonaObjetivo, slotObjetivo, saludRawAntes, saludRawFinal, {
                        escudoInicial: escudoAntes,
                        escudoFinal
                    });
                }
                limpiarCoopAnimHighlights();
                renderTodo();
                await esperar(COOP_MS_POST_IMPACTO_ATAQUE);
            } finally {
                await emitFin;
            }
            if (murio) {
                moverACementerio(cementObj, objetivoRef);
                mesaObj[slotObjetivo] = null;
                renderTodo();
            }
            return;
        }
        const snapEmitFin = clonarSnapshotParaRed();
        if (murio) {
            promoverObjetivoMuertoACementerioEnSnapshot(snapEmitFin, zonaObjetivo, slotObjetivo);
            /** En el observador solo aparece tras el impacto (snapshot aplicado al final de su animación). */
            intentarDesplegarBossEnSnap(snapEmitFin);
        }
        avanzarFaseTrasHumanoEnSnapshot(snapEmitFin, zonaAtacante);
        aplicarRobosInicioDeFaseEnSnapshotEmit(snapEmitFin);
        aplicarSaltosFaseHumanaHastaJugableOFinEnSnap(snapEmitFin);

        emitirAccionServidor({
            tipo: 'ataque_basico',
            zonaAtacante,
            slotAtacante,
            zonaObjetivo,
            slotObjetivo
        });
        const emitP = emitSnapshotCoopYEsperarEco(8000, {
            marcarSaltarReplayVisual: true,
            snapshotParaRed: snapEmitFin
        });

        coopAnimAtacante = { zona: zonaAtacante, slot: slotAtacante };
        coopAnimObjetivo = { zona: zonaObjetivo, slot: slotObjetivo };
        restaurarSaludEscudoVisual(objetivoRef, saludRawAntes, escudoAntes);
        renderTodo();
        try {
            await esperar(COOP_MS_PRE_IMPACTO_ATAQUE);

            const tipoFloat = (zonaObjetivo === 'A' || zonaObjetivo === 'B') ? 'jugador' : 'oponente';
            mostrarValorFlotanteCoop(zonaObjetivo, slotObjetivo, danioMostrar, tipoFloat, 'danio');

            if (murio) {
                await animarBajadaSaludCartaCoop(zonaObjetivo, slotObjetivo, saludRawAntes, saludRawFinal, {
                    escudoInicial: escudoAntes,
                    escudoFinal
                });
            } else if (impactoConEscudo) {
                restaurarSaludEscudoVisual(objetivoRef, saludRawFinal, escudoFinal);
                renderTodo();
                await esperar(COOP_MS_IMPACTO_ESCUDO_HUMANO);
            } else {
                await animarBajadaSaludCartaCoop(zonaObjetivo, slotObjetivo, saludRawAntes, saludRawFinal, {
                    escudoInicial: escudoAntes,
                    escudoFinal
                });
            }

            limpiarCoopAnimHighlights();
            renderTodo();
            await esperar(COOP_MS_POST_IMPACTO_ATAQUE);
        } finally {
            await emitP;
        }
        if (murio) {
            moverACementerio(cementObj, objetivoRef);
            mesaObj[slotObjetivo] = null;
            /** Mantener orden visual: primero baja del objetivo, luego retirada y solo entonces nuevas entradas/BOSS. */
            intentarDesplegarBossCoop();
        }
        avanzarFaseTrasHumano(zonaAtacante);
        aplicarRobosInicioDeFaseSegunFaseActual();
        aplicarSaltosFaseHumanaHastaJugableOFinEnSnap(snapshot);
        renderTodo();
    }

    function onClickSlot(zona, slot) {
        if (partidaFinalizada || procesandoBot || aplicandoAccionCoop || !puedeActuarSegunFase()) return;

        if (snapshot.faseCoop === 'BOT') return;

        const fase = snapshot.faseCoop;
        if (fase === 'P1' && (zona !== 'A' && zona !== 'bot')) return;
        if (fase === 'P2' && (zona !== 'B' && zona !== 'bot')) return;

        const mesaAtacante = fase === 'P1' ? snapshot.cartasEnJuegoA : snapshot.cartasEnJuegoB;
        const zonaAt = fase === 'P1' ? 'A' : 'B';

        if (zona === zonaAt) {
            const carta = mesaAtacante[slot];
            if (!cartaViva(carta)) return;
            const yaAtacados = zonaAt === 'A' ? snapshot.cartasYaAtacaronA : snapshot.cartasYaAtacaronB;
            if (Array.isArray(yaAtacados) && yaAtacados.includes(slot)) {
                logCoop('Esa carta ya atacó en esta fase.');
                return;
            }
            atacanteSel = slot;
            atacanteZona = zonaAt;
            renderTodo();
            logCoop('Elige objetivo en el campo del BOT.');
            coopDebugYo(`selección atacante ${zonaAt}:${slot}`);
            return;
        }

        if (zona === 'bot' && atacanteSel !== null && atacanteZona === zonaAt) {
            const obj = snapshot.cartasEnJuegoBot[slot];
            if (!cartaViva(obj)) return;
            const slotAtk = atacanteSel;
            const zonaAtk = atacanteZona;
            atacanteSel = null;
            atacanteZona = null;
            renderTodo();
            coopDebugYo(`confirmar objetivo BOT slot=${slot} desde ${zonaAtk}:${slotAtk}`);
            aplicandoAccionCoop = true;
            void resolverAtaqueHumanoAZona(zonaAtk, slotAtk, 'bot', slot).finally(() => {
                aplicandoAccionCoop = false;
            });
        }
    }

    function objetivosHumanosAleatorios() {
        const t = [];
        snapshot.cartasEnJuegoA.forEach((c, i) => {
            if (cartaViva(c)) t.push({ zona: 'A', slot: i });
        });
        snapshot.cartasEnJuegoB.forEach((c, i) => {
            if (cartaViva(c)) t.push({ zona: 'B', slot: i });
        });
        return t;
    }

    async function ejecutarTurnoBotSecuencial() {
        if (partidaFinalizada || MI_EMAIL !== EJECUTOR_BOT_EMAIL || snapshot.faseCoop !== 'BOT' || procesandoBot) {
            return;
        }
        coopDebugYo('BOT ejecutor: secuencial inicio');
        procesandoBot = true;
        try {
            /**
             * Inicio del ciclo BOT: si la mesa BOT quedó vacía durante P1/P2 se roba ahora;
             * aunque no esté vacía, el BOSS se despliega solo si no quedan rivales normales
             * (`intentarDesplegarBossCoop`). Alineado con EVENTO_COOPERATIVO_ONLINE_ESPEC.md.
             */
            let huboRoboInicio = false;
            if (mesaTotalmenteVacia(snapshot.cartasEnJuegoBot)) {
                huboRoboInicio = await rellenarVaciosDesdeMazoAnimado('bot', 4);
            }
            const despBossInicio = intentarDesplegarBossCoop();
            renderTodo();
            if (huboRoboInicio || despBossInicio) {
                await emitSnapshotCoopYEsperarEco(8000, {
                    marcarSaltarReplayVisual: false,
                    snapshotParaRed: clonarSnapshotParaRed()
                });
                if (partidaFinalizada) return;
            }

            const ordenBot = [0, 1, 2, 3];
            for (const ib of ordenBot) {
                if (partidaFinalizada) break;
                const cartaBot = snapshot.cartasEnJuegoBot[ib];
                if (!cartaViva(cartaBot)) continue;
                if (snapshot.cartasYaAtacaronBot.includes(ib)) continue;

                const metaHabilidadBot = obtenerMetaHabilidad(cartaBot);
                if (
                    metaHabilidadBot.tieneHabilidad
                    && metaHabilidadBot.trigger === 'usar'
                    && Math.max(0, Number(cartaBot.habilidadCooldownRestante || 0)) <= 0
                ) {
                    const snapAntesBot = JSON.parse(JSON.stringify(snapshot));
                    const usoHabilidad = await usarHabilidadActivaCoop('bot', ib, true);
                    if (usoHabilidad) {
                        const snapHabBot = clonarSnapshotParaRed();
                        prepararSnapshotEmitConReplayHabilidad(snapHabBot);
                        const replayBot = snapHabBot.coopReplayVisual
                            ? JSON.parse(JSON.stringify(snapHabBot.coopReplayVisual))
                            : null;
                        const snapHabBotCanon = JSON.parse(JSON.stringify(snapHabBot));
                        /** Mismo orden que habilidad humana: emitir primero, esperar breve eco propio y luego animar. */
                        emitirAccionServidor({
                            tipo: 'habilidad',
                            zonaAtacante: 'bot',
                            slotAtacante: ib,
                            skillClass: replayBot?.tipoAccion || null,
                            skillName: replayBot?.textoAnuncio || null
                        });
                        const emitBotHabPromise = emitSnapshotCoopYEsperarEco(8000, {
                            marcarSaltarReplayVisual: true,
                            snapshotParaRed: snapHabBot
                        });
                        try {
                            await Promise.race([emitBotHabPromise, esperar(COOP_MS_ESPERA_ECO_SYNC)]);
                            if (replayBot) {
                                await animarHabilidadLocalEnEmisorCoop(snapAntesBot, snapHabBotCanon, replayBot);
                            }
                        } finally {
                            await emitBotHabPromise;
                        }
                        if (partidaFinalizada) break;
                    }
                }

                const esBoss = esCartaBoss(cartaBot);
                const objetivosAtaque = esBoss
                    ? elegirObjetivosHumanosBossCoop(2)
                    : (() => {
                        const tank = obtenerTankHumanoCoop();
                        if (tank) return [tank];
                        const vivos = objetivosHumanosAleatorios();
                        if (!vivos.length) return [];
                        return [vivos[Math.floor(Math.random() * vivos.length)]];
                    })();

                if (!objetivosAtaque.length) {
                    snapshot.cartasYaAtacaronBot.push(ib);
                    continue;
                }

                for (let hi = 0; hi < objetivosAtaque.length; hi += 1) {
                    if (partidaFinalizada) break;
                    const pick = objetivosAtaque[hi];
                    const mesaObj = obtenerMesaPorZona(pick.zona);
                    const objetivo = mesaObj[pick.slot];
                    if (!cartaViva(objetivo)) continue;

                    const danio = obtenerPoderAtaqueCoop('bot', ib);
                    const suf = objetivosAtaque.length > 1 ? ` (${hi + 1}/${objetivosAtaque.length})` : '';
                    logCoop(`${esBoss ? 'BOSS' : 'BOT'}: ${cartaBot.Nombre} ataca a ${objetivo.Nombre}${suf} (${danio}).`);
                    coopDebugYo(`BOT ataque ib=${ib}→${pick.zona}:${pick.slot} d=${danio}`);

                    const uiBot = window.tableroCoopCartaUi;
                    const enObj = enemigosSaludParaZonaCoop(pick.zona);
                    const estadoAntesTot = uiBot && typeof uiBot.obtenerSaludEfectiva === 'function'
                        ? uiBot.obtenerSaludEfectiva(objetivo, enObj).totalActual
                        : obtenerSaludActualCarta(objetivo) + Math.max(0, Number(objetivo.escudoActual || 0));
                    const danioMostrar = Math.min(danio, Math.max(0, estadoAntesTot));

                    const saludAnt = obtenerSaludActualCarta(objetivo);
                    const escAnt = Math.max(0, Number(objetivo.escudoActual || 0));
                    const tempB = JSON.parse(JSON.stringify(objetivo));
                    aplicarDanioCarta(tempB, danio, pick.zona);
                    const saludFin = obtenerSaludActualCarta(tempB);
                    const escFinB = Math.max(0, Number(tempB.escudoActual || 0));

                    const impactoEsc = escAnt > 0 || escFinB > 0;

                    aplicarDanioCarta(objetivo, danio, pick.zona);
                    const cement = obtenerCementerioPorZona(pick.zona);
                    const murioBot = !cartaViva(objetivo);

                    const snapEmitBot = clonarSnapshotParaRed();
                    if (murioBot) {
                        promoverObjetivoMuertoACementerioEnSnapshot(snapEmitBot, pick.zona, pick.slot);
                        /** En red puede aparecer tras el impacto, pero nunca antes: se calcula sobre el snapshot post-baja. */
                        intentarDesplegarBossEnSnap(snapEmitBot);
                    }

                    emitirAccionServidor({
                        tipo: 'ataque_basico',
                        zonaAtacante: 'bot',
                        slotAtacante: ib,
                        zonaObjetivo: pick.zona,
                        slotObjetivo: pick.slot
                    });
                    const emitBot = emitSnapshotCoopYEsperarEco(8000, {
                        marcarSaltarReplayVisual: true,
                        snapshotParaRed: snapEmitBot
                    });

                    try {
                        /**
                         * Sincronización ejecutor↔observador: tras emitir esperamos brevemente al propio
                         * broadcast del servidor para que ambos clientes arranquen la animación a partir
                         * del mismo `multiplayer:coop:estado` (mismo patrón que las habilidades). Si el
                         * RTT es menor que `COOP_MS_ESPERA_ECO_SYNC` quedan totalmente sincronizados.
                         */
                        await Promise.race([emitBot, esperar(COOP_MS_ESPERA_ECO_SYNC)]);

                        coopAnimAtacante = { zona: 'bot', slot: ib };
                        coopAnimObjetivo = { zona: pick.zona, slot: pick.slot };
                        restaurarSaludEscudoVisual(objetivo, saludAnt, escAnt);
                        renderTodo();

                        await esperar(COOP_MS_PRE_IMPACTO_BOT);

                        const tipoFlBot = (pick.zona === 'A' || pick.zona === 'B') ? 'jugador' : 'oponente';
                        mostrarValorFlotanteCoop(pick.zona, pick.slot, danioMostrar, tipoFlBot, 'danio');

                        if (murioBot) {
                            await animarBajadaSaludCartaCoop(pick.zona, pick.slot, saludAnt, saludFin, {
                                escudoInicial: escAnt,
                                escudoFinal: escFinB
                            });
                        } else if (impactoEsc) {
                            restaurarSaludEscudoVisual(objetivo, saludFin, escFinB);
                            renderTodo();
                            await esperar(COOP_MS_IMPACTO_ESCUDO_HUMANO);
                        } else {
                            await animarBajadaSaludCartaCoop(pick.zona, pick.slot, saludAnt, saludFin, {
                                escudoInicial: escAnt,
                                escudoFinal: escFinB
                            });
                        }

                        limpiarCoopAnimHighlights();
                        renderTodo();
                        await esperar(COOP_MS_POST_IMPACTO_BOT);
                    } finally {
                        await emitBot;
                    }
                    if (murioBot) {
                        moverACementerio(cement, objetivo);
                        mesaObj[pick.slot] = null;
                        /**
                         * Mantener misma secuencia visual que en el observador:
                         * 1) finalizar animación 2) retirar carta derrotada 3) desplegar cartas nuevas (incl. BOSS).
                         */
                        intentarDesplegarBossCoop();
                        renderTodo();
                    }
                    if (verificarFinPartidaCoop()) break;
                }

                snapshot.cartasYaAtacaronBot.push(ib);
                if (partidaFinalizada) break;
            }

            if (!partidaFinalizada) {
                await esperar(COOP_MS_RESPIRO_TRAS_ULTIMO_ATAQUE_BOT);
                snapshot.cartasYaAtacaronBot = [];
                snapshot.cartasYaAtacaronA = [];
                snapshot.cartasYaAtacaronB = [];
                snapshot.faseCoop = 'P1';
                aplicarInicioDeFaseEnSnapshot(snapshot, 'P1');
                /**
                 * Cierre de ciclo BOT → nuevo P1: al comienzo del nuevo ciclo ambos humanos
                 * reponen huecos desde su mazo (misma idea que VS BOT al arrancar turno humano).
                 *
                 * No se roba aquí del mazo BOT: si la mesa del BOT quedó sin cartas vivas durante
                 * la fase BOT (p. ej. daño reflejado), volver a sacar 4 del mazo haría reaparecer
                 * enemigos derrotados. Las reservas del BOT ya se aplican al entrar en fase BOT
                 * (`ejecutarTurnoBotSecuencial` inicio) y en turno humano vía `aplicarRobosInicioDeFase*`.
                 */
                await rellenarVaciosDesdeMazoAnimado('A', 2);
                await rellenarVaciosDesdeMazoAnimado('B', 2);
                const refAntesBoss = JSON.parse(JSON.stringify(snapshot));
                intentarDesplegarBossCoop();
                for (let iboss = 0; iboss < 4; iboss += 1) {
                    if (!refAntesBoss.cartasEnJuegoBot[iboss] && snapshot.cartasEnJuegoBot[iboss]) {
                        renderTodo();
                        animarCartaRobadaCoop('bot', iboss);
                        await esperar(COOP_MS_ENTRE_ROBO_MAZO);
                        break;
                    }
                }
                logCoop('Nuevo ciclo: turno jugador 1.');
                aplicarSaltosFaseHumanaHastaJugableOFinEnSnap(snapshot);
                await emitSnapshotCoopYEsperarEco(8000, { marcarSaltarAnimRellenoCiclo: true });
                renderTodo();
            }
        } finally {
            procesandoBot = false;
        }
    }

    /**
     * El ejecutor del BOT es siempre el líder (servidor). La transición a fase BOT la emite
     * el jugador 2 desde su cliente; el líder debe arrancar la IA al recibir ese estado por red.
     */
    function intentarTurnoBotSiCorresponde() {
        if (partidaFinalizada || procesandoBot) return;
        if (!snapshot || snapshot.faseCoop !== 'BOT') return;
        if (MI_EMAIL !== EJECUTOR_BOT_EMAIL) return;
        const esperaMs = Math.max(0, Number(coopBloqueoArranqueBotHastaMs || 0) - Date.now());
        if (esperaMs > 0) {
            coopDebugYo(`BOT arranque diferido ${esperaMs}ms`);
            setTimeout(() => {
                intentarTurnoBotSiCorresponde();
            }, esperaMs);
            return;
        }
        coopDebugYo('BOT queueMicrotask ejecutar');
        queueMicrotask(() => {
            if (partidaFinalizada || procesandoBot) return;
            if (!snapshot || snapshot.faseCoop !== 'BOT') return;
            if (MI_EMAIL !== EJECUTOR_BOT_EMAIL) return;
            void ejecutarTurnoBotSecuencial();
        });
    }

    function aplicarSnapshotRemoto(snap, rev) {
        snapshot = JSON.parse(JSON.stringify(snap));
        /** Solo transporte temporal para sincronizar UI; no conservar en estado local. */
        if (snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'coopReplayVisual')) {
            delete snapshot.coopReplayVisual;
        }
        normalizarSnapshotCoop(snapshot);
        const H = window.DCHealDebuffCombat;
        if (H) {
            ['A', 'B', 'bot'].forEach((zona) => {
                coopHealDebuffFactors[zona] = H.obtenerFactorHealDebuff(enemigosSaludParaZonaCoop(zona));
            });
        }
        const r = Number(rev);
        revisionConfirmada = Number.isFinite(r) ? r : revisionConfirmada;
        atacanteSel = null;
        atacanteZona = null;
        limpiarCoopAnimHighlights();
        renderTodo();
        verificarFinPartidaCoop();
    }

    function configurarCabecera() {
        const ja = payload.jugadorA || {};
        const jb = payload.jugadorB || {};
        document.getElementById('coop-label-a').textContent = ja.nombre || 'Jugador 1';
        document.getElementById('coop-label-b').textContent = jb.nombre || 'Jugador 2';
        document.getElementById('coop-nombre-a').textContent = ja.nombre || 'J1';
        document.getElementById('coop-nombre-b').textContent = jb.nombre || 'J2';
        const aa = document.getElementById('coop-avatar-a');
        const ab = document.getElementById('coop-avatar-b');
        if (aa) {
            aa.src = String(ja.avatar || '').trim() || AVATAR_FALLBACK;
        }
        if (ab) {
            ab.src = String(jb.avatar || '').trim() || AVATAR_FALLBACK;
        }
        const botIm = document.getElementById('coop-bot-avatar');
        if (botIm) botIm.src = AVATAR_FALLBACK;
    }

    function wireUi() {
        document.getElementById('boton-volver-multi-coop')?.addEventListener('click', () => {
            if (typeof window.limpiarEstadoCoopResiduoPartidaLocal === 'function') {
                window.limpiarEstadoCoopResiduoPartidaLocal();
            }
            if (typeof window.limpiarEstadoPvpResiduoPartidaLocal === 'function') {
                window.limpiarEstadoPvpResiduoPartidaLocal();
            }
            window.location.href = 'multijugador.html';
        });
        document.getElementById('coop-btn-abandonar')?.addEventListener('click', () => {
            const modal = document.getElementById('modal-abandonar-coop');
            if (modal) modal.style.display = 'flex';
        });
        document.getElementById('modal-coop-abandonar-no')?.addEventListener('click', () => {
            const modal = document.getElementById('modal-abandonar-coop');
            if (modal) modal.style.display = 'none';
        });
        document.getElementById('modal-coop-abandonar-si')?.addEventListener('click', () => {
            if (typeof window.limpiarEstadoCoopResiduoPartidaLocal === 'function') {
                window.limpiarEstadoCoopResiduoPartidaLocal();
            }
            if (typeof window.limpiarEstadoPvpResiduoPartidaLocal === 'function') {
                window.limpiarEstadoPvpResiduoPartidaLocal();
            }
            window.location.href = 'multijugador.html';
        });
        document.getElementById('coop-debug-toggle')?.addEventListener('click', () => {
            const p = document.getElementById('coop-debug-panel');
            if (!p) return;
            const abierto = p.style.display === 'none';
            p.style.display = abierto ? 'grid' : 'none';
            document.getElementById('coop-debug-wrap')?.setAttribute('aria-hidden', abierto ? 'false' : 'true');
        });
        window.addEventListener('dc:coop-debug', (ev) => {
            const det = ev.detail || {};
            if (String(det.sessionId || '') !== SESSION_ID) return;
            coopDebugServidor(
                `srv rev=${det.revisionNuevo} emit=${String(det.emitterEmail || '').trim()} fase=${det.fase} replay=${det.tieneReplayVisual ? 'sí' : 'no'}`
            );
        });
        /**
         * Registro de acciones explícitas por revisión: se consumen en `procesarEstadoCoopDesdeRed`
         * para animar sin depender del diff (EVENTO_COOPERATIVO_ONLINE_ESPEC.md).
         */
        window.addEventListener('dc:coop-accion', (ev) => {
            const det = ev.detail || {};
            if (String(det.sessionId || '') !== SESSION_ID) return;
            const rev = Number(det.revision);
            if (!Number.isFinite(rev)) return;
            const accion = det.accion && typeof det.accion === 'object' ? det.accion : null;
            if (!accion) return;
            coopAccionesPorRevision.set(rev, accion);
            coopDebugServidor(
                `srv accion rev=${rev} tipo=${accion.tipo || '?'} ${accion.zonaAtacante || '?'}:${accion.slotAtacante ?? '?'}→${accion.zonaObjetivo || '?'}:${accion.slotObjetivo ?? '—'}`
            );
        });
    }

    window.addEventListener('dc:coop-estado', (ev) => {
        const det = ev.detail || {};
        if (String(det.sessionId || '') !== SESSION_ID) return;
        const rev = Number(det.revision);
        /**
         * Quien emitió ya tiene el snapshot correcto: resolver la espera del emit al instante.
         * Si esto pasara por `coopCadenaEstadosRed` detrás del procesamiento del compañero,
         * `await emitBot` podía quedar ~1,5–2 s bloqueado antes del siguiente ataque del BOT.
         */
        if (coopSaltarReplayProximaRevision !== null) {
            if (Number.isFinite(rev) && rev === coopSaltarReplayProximaRevision) {
                coopSaltarReplayProximaRevision = null;
                if (Number.isFinite(rev)) revisionConfirmada = rev;
                resolverEcoEmitSiCorresponde(rev);
                coopDebugYo(`eco propio (sin cola anim) rev=${rev}`);
                return;
            }
            coopDebugYo(`eco saltarReplay flag descartado, rev recibida=${rev}`);
            coopSaltarReplayProximaRevision = null;
        }
        coopDebugEco(`cola red rev=${rev} fase=${det.snapshot?.faseCoop}`);
        coopCadenaEstadosRed = coopCadenaEstadosRed
            .then(() => procesarEstadoCoopDesdeRed(det))
            .catch((err) => console.error('[coop] procesar estado red', err));
    });

    window.addEventListener('dc:coop-resync-required', (ev) => {
        const det = ev.detail || {};
        if (String(det.sessionId || '') !== SESSION_ID) return;
        if (Number.isFinite(Number(det.revision))) {
            revisionConfirmada = Number(det.revision);
        }
        if (typeof window.emitMultiplayerCoopEstadoSolicitar === 'function') {
            window.emitMultiplayerCoopEstadoSolicitar(SESSION_ID);
        }
    });

    window.addEventListener('dc:coop-resultado', (ev) => {
        const det = ev.detail || {};
        if (String(det.sessionId || '') !== SESSION_ID) return;
        partidaFinalizada = true;
        mostrarFin(Boolean(det.ganaronJugadores));
    });

    function obtenerNombreJugadorParaFase(faseCoop) {
        const ja = payload.jugadorA || {};
        const jb = payload.jugadorB || {};
        if (faseCoop === 'P1') return String(ja.nombre || 'Jugador 1').trim() || 'Jugador 1';
        if (faseCoop === 'P2') return String(jb.nombre || 'Jugador 2').trim() || 'Jugador 2';
        if (faseCoop === 'BOT') return 'BOT';
        return '';
    }

    /**
     * Modal central "Turno de $nombre$" (EVENTO_COOPERATIVO_ONLINE_ESPEC.md).
     * Se cierra solo tras `duracionMs`; no bloquea interacción del fondo.
     */
    function mostrarModalTurnoInicialCoop(nombre, duracionMs = 2200) {
        return new Promise((resolve) => {
            const modal = document.getElementById('modal-turno-inicial-coop');
            const titulo = document.getElementById('modal-turno-inicial-coop-titulo');
            if (!modal || !titulo) {
                resolve();
                return;
            }
            const nombreLimpio = String(nombre || '').trim() || '—';
            titulo.textContent = `Turno de ${nombreLimpio}`;
            modal.style.display = 'flex';
            const dur = Math.max(600, Number(duracionMs) || 2200);
            setTimeout(() => {
                modal.style.display = 'none';
                resolve();
            }, dur);
        });
    }

    /**
     * Animación de entrada inicial: el tablero arranca con las cartas ocultas
     * (`coopAnimEntradaInicialActiva` mantiene `opacity:0` en cualquier render que ocurra
     * durante la animación) y se van revelando en parejas con la animación
     * `animarCartaRobadaCoop`, en este orden:
     *   1) bot[0] + A[0]
     *   2) bot[1] + A[1]
     *   3) bot[2] + B[0]
     *   4) bot[3] + B[1]
     * Se ejecuta solo una vez por `sessionId` (marca en sessionStorage).
     */
    async function animarEntradaInicialCoop() {
        try {
            if (sessionStorage.getItem(COOP_CLAVE_ENTRADA_INICIAL) === '1') {
                /** Reconexión / segunda carga: no animar pero asegurar que ningún slot quede oculto. */
                coopAnimEntradaInicialActiva = false;
                coopSlotsAperturaRevelados.clear();
                renderTodo();
                return;
            }
        } catch (_e) { /* sessionStorage puede no estar disponible en algunos contextos */ }
        if (!snapshot) return;

        const parejas = [
            [{ zona: 'bot', slot: 0 }, { zona: 'A', slot: 0 }],
            [{ zona: 'bot', slot: 1 }, { zona: 'A', slot: 1 }],
            [{ zona: 'bot', slot: 2 }, { zona: 'B', slot: 0 }],
            [{ zona: 'bot', slot: 3 }, { zona: 'B', slot: 1 }]
        ];

        const cartaEnSlot = ({ zona, slot }) => {
            if (zona === 'bot') return snapshot.cartasEnJuegoBot?.[slot];
            if (zona === 'A') return snapshot.cartasEnJuegoA?.[slot];
            if (zona === 'B') return snapshot.cartasEnJuegoB?.[slot];
            return null;
        };

        const PAUSA_ENTRE_PAREJAS_MS = 500;
        for (let p = 0; p < parejas.length; p += 1) {
            const [a, b] = parejas[p];
            const haySomething = cartaEnSlot(a) || cartaEnSlot(b);
            if (haySomething) {
                if (cartaEnSlot(a)) coopSlotsAperturaRevelados.add(`${a.zona}:${a.slot}`);
                if (cartaEnSlot(b)) coopSlotsAperturaRevelados.add(`${b.zona}:${b.slot}`);
                /**
                 * Quitar `opacity:0` y disparar la animación de robo en ambos slots a la vez.
                 * Forzamos un reflow tras quitar el `opacity` para que el `carta-robada` arranque
                 * desde el estado visible (si no, el navegador podría agrupar los dos cambios).
                 */
                for (const pos of [a, b]) {
                    if (!cartaEnSlot(pos)) continue;
                    const slotEl = obtenerSlotElementCoop(pos.zona, pos.slot);
                    const carta = slotEl?.querySelector('.carta');
                    if (!carta) continue;
                    carta.style.removeProperty('opacity');
                    void carta.offsetWidth;
                    animarCartaRobadaCoop(pos.zona, pos.slot);
                }
                if (p < parejas.length - 1) {
                    await esperar(PAUSA_ENTRE_PAREJAS_MS);
                }
            }
        }

        /** Limpieza: liberar el modo "ocultar no revelados" y restaurar opacidad por si quedó algún inline. */
        coopAnimEntradaInicialActiva = false;
        coopSlotsAperturaRevelados.clear();
        const limpiarOpacidades = (zona, n) => {
            for (let i = 0; i < n; i += 1) {
                const slotEl = obtenerSlotElementCoop(zona, i);
                const carta = slotEl?.querySelector('.carta');
                if (carta) carta.style.removeProperty('opacity');
            }
        };
        limpiarOpacidades('bot', 4);
        limpiarOpacidades('A', 2);
        limpiarOpacidades('B', 2);

        try { sessionStorage.setItem(COOP_CLAVE_ENTRADA_INICIAL, '1'); } catch (_e) { /* noop */ }
    }

    async function inicializarPartidaCoopUi() {
        if (!snapshot) {
            window.location.replace('multijugador.html');
            return;
        }
        configurarCabecera();
        wireUi();

        /**
         * Apertura de partida: marcamos el flag ANTES del primer `renderTodo` para que
         * `renderSlotsPlano` pinte las cartas ya con `opacity:0` (sin reveladas en el set).
         * Como el bloque hasta el primer `await` es síncrono, el navegador no llega a pintar
         * el frame con las cartas visibles → no hay flash inicial. La animación
         * `animarEntradaInicialCoop` revelará las cartas por parejas y desactivará el flag.
         */
        const esAperturaPartida = Number(revisionConfirmada) === 0
            && sessionStorage.getItem(COOP_CLAVE_ENTRADA_INICIAL) !== '1';
        if (esAperturaPartida) {
            coopAnimEntradaInicialActiva = true;
            coopSlotsAperturaRevelados.clear();
        }

        /**
         * En apertura de partida mostramos el modal central "Turno de …" (bloqueante);
         * pre-poblamos `ultimaFaseCoopParaAvisoTurno` con la fase actual para que el
         * primer render NO dispare también el toast no-bloqueante por encima.
         */
        if (esAperturaPartida
            && (snapshot.faseCoop === 'P1' || snapshot.faseCoop === 'P2' || snapshot.faseCoop === 'BOT')) {
            ultimaFaseCoopParaAvisoTurno = snapshot.faseCoop;
        }
        const HInit = window.DCHealDebuffCombat;
        if (HInit && snapshot) {
            ['A', 'B', 'bot'].forEach((zona) => {
                coopHealDebuffFactors[zona] = HInit.obtenerFactorHealDebuff(enemigosSaludParaZonaCoop(zona));
            });
        }
        renderTodo();
        if (typeof window.emitMultiplayerCoopJoin === 'function') {
            window.emitMultiplayerCoopJoin(SESSION_ID);
        }
        if (typeof window.emitMultiplayerCoopEstadoSolicitar === 'function') {
            window.emitMultiplayerCoopEstadoSolicitar(SESSION_ID);
        }

        /**
         * Entrada inicial solo cuando el snapshot local representa la apertura de partida (revisión 0).
         * En reconexiones posteriores el `estado:solicitar` devolverá una revisión >0 y nos saltamos.
         */
        if (esAperturaPartida) {
            aplicandoAccionCoop = true;
            try {
                await animarEntradaInicialCoop();
                const nombre = obtenerNombreJugadorParaFase(snapshot.faseCoop);
                if (nombre) await mostrarModalTurnoInicialCoop(nombre, 2200);
            } catch (err) {
                console.error('[coop] entrada inicial', err);
            } finally {
                /** Asegurar que el flag queda desactivado aunque se haya lanzado un error. */
                coopAnimEntradaInicialActiva = false;
                coopSlotsAperturaRevelados.clear();
                aplicandoAccionCoop = false;
                renderTodo();
            }
        }

        /** Mismo arranque diferido que `intentarTurnoBotSiCorresponde`: deja aplicar primero un eco pendiente de `estado:solicitar`. */
        if (snapshot.faseCoop === 'BOT' && MI_EMAIL === EJECUTOR_BOT_EMAIL) {
            queueMicrotask(() => {
                if (partidaFinalizada || procesandoBot) return;
                if (!snapshot || snapshot.faseCoop !== 'BOT') return;
                if (MI_EMAIL !== EJECUTOR_BOT_EMAIL) return;
                void ejecutarTurnoBotSecuencial();
            });
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        void inicializarPartidaCoopUi();
    });
})();
