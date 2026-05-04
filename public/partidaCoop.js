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
    /** Serializa `dc:coop-estado` para no solapar animaciones entre revisiones. */
    let coopCadenaEstadosRed = Promise.resolve();

    /** Solo mostrar el toast de turno cuando cambie la fase (P1 / P2 / BOT), no en cada render. */
    let ultimaFaseCoopParaAvisoTurno = null;

    const COOP_MS_PRE_IMPACTO_ATAQUE = 540;
    const COOP_MS_POST_IMPACTO_ATAQUE = 760;
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
    const COOP_MS_RESPIRO_TRAS_ULTIMO_ATAQUE_BOT = 520;
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
    async function ejecutarCoopReplayVisual(rep, opts = {}) {
        if (!rep || typeof rep !== 'object') return;
        const omitirAnuncio = Boolean(opts.omitirAnuncio);
        const soloAnuncio = Boolean(opts.soloAnuncio);
        const ms = Math.max(300, Number(rep.msAviso || PAUSA_AVISO_HABILIDAD_MS));
        const txt = String(rep.textoAnuncio || '').trim();
        if (!omitirAnuncio && txt) {
            mostrarAvisoHabilidadCoop(txt, ms);
            await esperar(ms);
        }
        if (soloAnuncio) return;
        const floats = Array.isArray(rep.floats) ? rep.floats : [];
        floats.forEach((f) => {
            if (!f || typeof f !== 'object') return;
            const zona = f.zona;
            const slot = Number(f.slot);
            if (zona !== 'A' && zona !== 'B' && zona !== 'bot') return;
            if (!Number.isFinite(slot)) return;
            mostrarValorFlotanteCoop(
                zona,
                slot,
                f.valor,
                f.tipoImpacto === 'oponente' ? 'oponente' : 'jugador',
                f.claseVisual || 'danio'
            );
        });
    }

    async function animarTransicionCoopAoeDesdeReplay(prev, prox, replay) {
        if (!prev || !prox || !replay || typeof replay !== 'object') return;
        const msAviso = Math.max(300, Number(replay.msAviso || PAUSA_AVISO_HABILIDAD_MS));
        const txtAviso = String(replay.textoAnuncio || '').trim();
        if (txtAviso) {
            mostrarAvisoHabilidadCoop(txtAviso, msAviso);
            await esperar(msAviso);
        }
        const impactos = Array.isArray(replay.floats) ? replay.floats : [];
        if (!impactos.length) return;
        const primerZonaHum = impactos.find((h) => h && (h.zona === 'A' || h.zona === 'B'));
        const atk = inferirSlotAtacanteCoop(prev, prox, primerZonaHum ? primerZonaHum.zona : 'bot');
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

            const saludRawIni = obtenerSaludActualCarta(live);
            const escIni = Math.max(0, Number(live.escudoActual || 0));
            const saludRawFin = c1 ? obtenerSaludActualCarta(c1) : 0;
            const escFin = c1 ? Math.max(0, Number(c1.escudoActual || 0)) : 0;
            const esLetal = !c1;
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
        await esperar(32);
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

    /** Cartas enemigas para salud efectiva usando un snapshot concreto (diff visual entre clientes). */
    function enemigosSaludParaZonaDesdeSnapshot(zonaCarta, snap) {
        if (!snap) return [];
        if (zonaCarta === 'bot') {
            return [...(snap.cartasEnJuegoA || []), ...(snap.cartasEnJuegoB || [])].filter(Boolean);
        }
        if (zonaCarta === 'A') {
            return [...(snap.cartasEnJuegoBot || []), ...(snap.cartasEnJuegoB || [])].filter(Boolean);
        }
        return [...(snap.cartasEnJuegoBot || []), ...(snap.cartasEnJuegoA || [])].filter(Boolean);
    }

    function enemigosSaludParaZonaCoop(zonaCarta) {
        return enemigosSaludParaZonaDesdeSnapshot(zonaCarta, snapshot);
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
     * Transición P2→BOT con daño en `bot`: el atacante es el último slot registrado en `prev.cartasYaAtacaronB`.
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

        if (zObj === 'bot' && fP === 'P2' && fX === 'BOT') {
            const yaPrev = prev && prev.cartasYaAtacaronB;
            if (Array.isArray(yaPrev) && yaPrev.length) {
                return { zona: 'B', slot: yaPrev[yaPrev.length - 1] };
            }
        }

        if (zObj === 'bot' && fP === 'P1' && fX === 'P2') {
            const yaPrev = prev && prev.cartasYaAtacaronA;
            if (Array.isArray(yaPrev) && yaPrev.length) {
                return { zona: 'A', slot: yaPrev[yaPrev.length - 1] };
            }
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
    async function animarTransicionCoopDesdeDiff(prev, prox) {
        const cambio = encontrarPrimerCambioDanioVisual(prev, prox);
        if (!cambio) return;

        const atk = inferirSlotAtacanteCoop(prev, prox, cambio.zona);
        const { zona: zonaObj, slot: slotObj, esLetal, danioMostrar, saludRawIni, saludRawFin, escIni, escFin } = cambio;

        const mesaKey = zonaObj === 'bot' ? 'cartasEnJuegoBot' : zonaObj === 'A' ? 'cartasEnJuegoA' : 'cartasEnJuegoB';
        const live = snapshot[mesaKey][slotObj];
        if (!live && !esLetal) return;

        /** Misma cadencia que `resolverAtaqueHumanoAZona` (incl. turno BOT en el ejecutador local). */
        const msPreImpacto = COOP_MS_PRE_IMPACTO_ATAQUE;
        const msPostImpacto = COOP_MS_POST_IMPACTO_ATAQUE;

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

        /** El eco del propio emit se resuelve en el listener de `dc:coop-estado` sin pasar por esta cola (ver ahí). */

        const replay = prox.coopReplayVisual && typeof prox.coopReplayVisual === 'object'
            ? JSON.parse(JSON.stringify(prox.coopReplayVisual))
            : null;

        const prev = snapshot ? JSON.parse(JSON.stringify(snapshot)) : null;
        const replaySeEncargaAnim = Boolean(replay && replay.tipoAccion === 'aoe');
        const replayExtraAttack = Boolean(replay && replay.tipoAccion === 'extra_attack');
        try {
            if (prev && !partidaFinalizada) {
                if (replaySeEncargaAnim) {
                    await animarTransicionCoopAoeDesdeReplay(prev, prox, replay);
                } else {
                    if (replayExtraAttack) {
                        await ejecutarCoopReplayVisual(replay, { soloAnuncio: true });
                    }
                    await animarTransicionCoopDesdeDiff(prev, prox);
                }
            }
        } catch (e) {
            console.error('[coop] anim estado remoto', e);
        }
        aplicarSnapshotRemoto(prox, rev);
        try {
            if (replay && !replaySeEncargaAnim && !partidaFinalizada) {
                if (replayExtraAttack) {
                    await ejecutarCoopReplayVisual(replay, { omitirAnuncio: true });
                } else {
                    await ejecutarCoopReplayVisual(replay);
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
        resolverEcoEmitSiCorresponde(rev);
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
        const claseImpactoBarra = esCura ? 'recibiendo-cura' : 'recibiendo-danio';
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
        const pctIni = Math.max(0, Math.min((estadoIni.totalActual / Math.max(estadoIni.totalMax, 1)) * 100, 100));

        carta.Salud = saludFinal;
        if (opciones && Object.prototype.hasOwnProperty.call(opciones, 'escudoFinal')) {
            carta.escudoActual = Math.max(0, Number(opciones.escudoFinal || 0));
        }
        const estadoFin = ui.obtenerSaludEfectiva(carta, cartasEnemigasSalud);
        const pctFin = Math.max(0, Math.min((estadoFin.totalActual / Math.max(estadoFin.totalMax, 1)) * 100, 100));

        const rellenoAnim = slotTrasRender?.querySelector('.barra-salud-relleno');
        if (!rellenoAnim) {
            renderTodo();
            barraTrasRender?.classList.remove(claseImpactoBarra);
            return;
        }

        rellenoAnim.style.width = `${pctIni}%`;
        rellenoAnim.style.setProperty('--health-ratio', String(pctIni / 100));
        void rellenoAnim.offsetWidth;
        rellenoAnim.style.transition = `width ${durTransBarra} cubic-bezier(0.22, 0.8, 0.2, 1), background-color 0.3s ease, filter 0.25s ease`;
        rellenoAnim.style.width = `${pctFin}%`;
        rellenoAnim.style.setProperty('--health-ratio', String(pctFin / 100));

        const saludTxt = slotTrasRender?.querySelector('.salud-carta');
        if (saludTxt) {
            saludTxt.textContent = `${Math.round(estadoFin.totalActual)}/${Math.round(estadoFin.totalMax)}`;
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

    function aplicarDanioCarta(carta, danioBruto) {
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

    function obtenerValorNumericoSkillPower(carta, fallback = 0) {
        if (typeof window.obtenerSkillPowerNumericoCarta === 'function') {
            const poder = Math.max(1, Number(carta?.Poder || 0));
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

    /** Devuelve la carta al estado previo al daño solo para la animación local (la red usa otro snapshot). */
    function restaurarSaludEscudoVisual(carta, saludRaw, escudoRaw) {
        if (!carta) return;
        const max = obtenerSaludMaxCarta(carta);
        carta.Salud = Math.max(0, Math.min(Number(saludRaw) || 0, max));
        carta.escudoActual = Math.max(0, Number(escudoRaw) || 0);
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
        aplicarDanioCarta(cartaObjetivo, danio);
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
                    danoTotal += Math.max(1, Math.floor(Number(fx?.danoPorTurno || 0)));
                    fx.turnosRestantes = Math.max(0, Math.floor(Number(fx.turnosRestantes || 0)) - 1);
                });
                carta.efectosDot = dots.filter((fx) => fx.turnosRestantes > 0);
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

        const valor = Math.max(0, Number(obtenerValorNumericoSkillPower(carta, 0)));
        const aliados = ctx.aliados;
        const enemigos = ctx.enemigos;

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
            objetivo.Salud = Math.min(obtenerSaludMaxCarta(objetivo), saludAntes + Math.floor(valor));
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
            coopReplayTexto = construirMensajeUsoHabilidadActiva(carta.Nombre, meta.nombre, objetivo.Nombre);
            objetivo.escudoActual = Math.max(0, Number(objetivo.escudoActual || 0)) + Math.floor(valor);
            logCoop(`${carta.Nombre} usa ${meta.nombre}: escudo +${Math.floor(valor)} para ${objetivo.Nombre}.`);
        } else if (meta.clase === 'stun' || meta.clase === 'dot' || meta.clase === 'extra_attack') {
            const tank = obtenerIndiceTankActivoEnMesa(enemigos);
            const disp = tank !== null ? [tank] : obtenerIndicesDisponiblesCoop(enemigos);
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
                    aplicarDanioDirectoSinAnimCoop(objetivoReal, zonaObjetivo, slotObjetivo, danioExtra);
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
                        objetivo.Salud = Math.min(obtenerSaludMaxCarta(objetivo), antes + Math.floor(valor));
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
                    objetivo.Salud = Math.min(obtenerSaludMaxCarta(objetivo), antes + Math.floor(valor));
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
        } else if (meta.clase === 'aoe') {
            const danoAoe = Math.max(1, Math.floor(valor || (obtenerPoderAtaqueCoop(ctx.zonaAliada, slotCarta) / 2)));
            const disp = obtenerIndicesDisponiblesCoop(enemigos);
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
                        : 'general',
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

    /** Rellena huecos desde el mazo del jugador/BOT al inicio de su fase (p. ej. mesa vacía con cartas en mazo). */
    function aplicarRobosInicioDeFaseSegunFaseActual() {
        if (!snapshot || partidaFinalizada) return;
        const fase = snapshot.faseCoop;
        if (fase === 'P2') {
            rellenarVaciosDesdeMazo('A', 2);
            rellenarVaciosDesdeMazo('B', 2);
        } else if (fase === 'BOT') {
            rellenarVaciosDesdeMazo('bot', 4);
            intentarDesplegarBossCoop();
        }
    }

    function aplicarRobosInicioDeFaseEnSnapshotEmit(snap) {
        if (!snap || typeof snap !== 'object') return;
        normalizarSnapshotCoop(snap);
        if (snap.faseCoop === 'P2') {
            rellenarVaciosDesdeMazoEnSnapshot(snap, 'A', 2);
            rellenarVaciosDesdeMazoEnSnapshot(snap, 'B', 2);
        } else if (snap.faseCoop === 'BOT') {
            rellenarVaciosDesdeMazoEnSnapshot(snap, 'bot', 4);
            intentarDesplegarBossEnSnap(snap);
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

    function actualizarAvisoTurnoCoopSiNuevaFase() {
        if (!snapshot || partidaFinalizada) return;
        const f = snapshot.faseCoop;
        if (f !== 'P1' && f !== 'P2' && f !== 'BOT') return;
        if (f === ultimaFaseCoopParaAvisoTurno) return;
        ultimaFaseCoopParaAvisoTurno = f;
        const aviso = document.getElementById('aviso-turno-coop');
        if (!aviso) return;
        const jaNombre = String((payload.jugadorA || {}).nombre || '').trim() || 'Jugador 1';
        const jbNombre = String((payload.jugadorB || {}).nombre || '').trim() || 'Jugador 2';
        let txt = '';
        if (f === 'P1') {
            txt = `Turno de ${jaNombre} (izquierda)`;
        } else if (f === 'P2') {
            txt = `Turno de ${jbNombre} (derecha)`;
        } else if (f === 'BOT') {
            txt = 'Turno del BOT';
        }
        aviso.textContent = txt;
        aviso.classList.add('visible');
        programarOcultarAvisoTurnoCoop(aviso, COOP_MS_AVISO_CAMBIO_FASE);
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
            const enemigosSaludBot = [...snapshot.cartasEnJuegoA, ...snapshot.cartasEnJuegoB].filter(Boolean);
            ui.mostrarCartaEnSlotCoop(s, carta, 'oponente', i, {
                enemigosParaSalud: enemigosSaludBot,
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
            const enemigosA = [...snapshot.cartasEnJuegoBot, ...snapshot.cartasEnJuegoB].filter(Boolean);
            const puedeUsarHab = puedeSelAtacante;
            ui.mostrarCartaEnSlotCoop(s, carta, 'jugador', i, {
                enemigosParaSalud: enemigosA,
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
            const enemigosB = [...snapshot.cartasEnJuegoBot, ...snapshot.cartasEnJuegoA].filter(Boolean);
            const puedeUsarHab = puedeSelAtacante;
            ui.mostrarCartaEnSlotCoop(s, carta, 'jugador', i, {
                enemigosParaSalud: enemigosB,
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

    function renderTodo() {
        destacarTurnoUi();
        actualizarContadores();
        renderSlotsPlano();
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
                    if (typeof window.emitMultiplayerCoopEstadoSolicitar === 'function') {
                        window.emitMultiplayerCoopEstadoSolicitar(SESSION_ID);
                    }
                    await esperarProximoEstadoCoopCualquiera(5000);
                    if (typeof coopEmitDone === 'function') coopEmitDone();
                })();
            }, timeoutMs);
            /** Estado canónico en red (p. ej. con cementerio); el tablero local puede seguir un frame “de animación”. */
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

    function mostrarFin(ganaron) {
        const modal = document.getElementById('ventana-emergente-fin-coop');
        const t = document.getElementById('titulo-fin-partida-coop');
        const m = document.getElementById('mensaje-fin-partida-coop');
        if (t) t.textContent = ganaron ? 'Victoria' : 'Derrota';
        if (m) m.textContent = ganaron
            ? 'Habéis derrotado al BOT en el evento cooperativo.'
            : 'El BOT ha eliminado a tu equipo.';
        if (modal) modal.style.display = 'flex';
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
            const usada = await usarHabilidadActivaCoop(zona, slotIndex, false);
            if (!usada) return;
            const snapEmit = clonarSnapshotParaRed();
            await emitSnapshotCoopYEsperarEco(8000, {
                marcarSaltarReplayVisual: false,
                snapshotParaRed: snapEmit
            });
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
        aplicarDanioCarta(temp, danio);
        const saludRawFinal = obtenerSaludActualCarta(temp);
        const escudoFinal = Math.max(0, Number(temp.escudoActual || 0));

        const impactoConEscudo = escudoAntes > 0 || escudoFinal > 0;

        aplicarDanioCarta(objetivoRef, danio);
        const murio = !cartaViva(objetivoRef);

        atacanteSel = null;
        atacanteZona = null;

        registrarAtaqueHumano(zonaAtacante, slotAtacante);
        if (verificarFinPartidaCoop()) {
            const snapEmit = clonarSnapshotParaRed();
            if (murio) promoverObjetivoMuertoACementerioEnSnapshot(snapEmit, zonaObjetivo, slotObjetivo);
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
        intentarDesplegarBossCoop();

        const snapEmitFin = clonarSnapshotParaRed();
        if (murio) promoverObjetivoMuertoACementerioEnSnapshot(snapEmitFin, zonaObjetivo, slotObjetivo);
        avanzarFaseTrasHumanoEnSnapshot(snapEmitFin, zonaAtacante);
        aplicarRobosInicioDeFaseEnSnapshotEmit(snapEmitFin);
        aplicarSaltosFaseHumanaHastaJugableOFinEnSnap(snapEmitFin);

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
            return;
        }

        if (zona === 'bot' && atacanteSel !== null && atacanteZona === zonaAt) {
            const obj = snapshot.cartasEnJuegoBot[slot];
            if (!cartaViva(obj)) return;
            aplicandoAccionCoop = true;
            void resolverAtaqueHumanoAZona(zonaAt, atacanteSel, 'bot', slot).finally(() => {
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
        procesandoBot = true;
        try {
            const huboRoboInicio = await rellenarVaciosDesdeMazoAnimado('bot', 4);
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
                    const usoHabilidad = await usarHabilidadActivaCoop('bot', ib, true);
                    if (usoHabilidad) {
                        const snapHabBot = clonarSnapshotParaRed();
                        await emitSnapshotCoopYEsperarEco(8000, {
                            marcarSaltarReplayVisual: false,
                            snapshotParaRed: snapHabBot
                        });
                        if (partidaFinalizada) break;
                    }
                }

                const esBoss = esCartaBoss(cartaBot);
                const objetivosAtaque = esBoss
                    ? elegirObjetivosHumanosBossCoop(2)
                    : (() => {
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

                    const uiBot = window.tableroCoopCartaUi;
                    const enObj = enemigosSaludParaZonaCoop(pick.zona);
                    const estadoAntesTot = uiBot && typeof uiBot.obtenerSaludEfectiva === 'function'
                        ? uiBot.obtenerSaludEfectiva(objetivo, enObj).totalActual
                        : obtenerSaludActualCarta(objetivo) + Math.max(0, Number(objetivo.escudoActual || 0));
                    const danioMostrar = Math.min(danio, Math.max(0, estadoAntesTot));

                    const saludAnt = obtenerSaludActualCarta(objetivo);
                    const escAnt = Math.max(0, Number(objetivo.escudoActual || 0));
                    const tempB = JSON.parse(JSON.stringify(objetivo));
                    aplicarDanioCarta(tempB, danio);
                    const saludFin = obtenerSaludActualCarta(tempB);
                    const escFinB = Math.max(0, Number(tempB.escudoActual || 0));

                    const impactoEsc = escAnt > 0 || escFinB > 0;

                    aplicarDanioCarta(objetivo, danio);
                    const cement = obtenerCementerioPorZona(pick.zona);
                    const murioBot = !cartaViva(objetivo);

                    intentarDesplegarBossCoop();
                    renderTodo();

                    const snapEmitBot = clonarSnapshotParaRed();
                    if (murioBot) promoverObjetivoMuertoACementerioEnSnapshot(snapEmitBot, pick.zona, pick.slot);

                    const emitBot = emitSnapshotCoopYEsperarEco(8000, {
                        marcarSaltarReplayVisual: true,
                        snapshotParaRed: snapEmitBot
                    });

                    coopAnimAtacante = { zona: 'bot', slot: ib };
                    coopAnimObjetivo = { zona: pick.zona, slot: pick.slot };
                    restaurarSaludEscudoVisual(objetivo, saludAnt, escAnt);
                    renderTodo();
                    try {
                        await esperar(COOP_MS_PRE_IMPACTO_ATAQUE);

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
                        await esperar(COOP_MS_POST_IMPACTO_ATAQUE);
                    } finally {
                        await emitBot;
                    }
                    if (murioBot) {
                        moverACementerio(cement, objetivo);
                        mesaObj[pick.slot] = null;
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
                await rellenarVaciosDesdeMazoAnimado('bot', 4);
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
                return;
            }
            coopSaltarReplayProximaRevision = null;
        }
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

    document.addEventListener('DOMContentLoaded', () => {
        if (!snapshot) {
            window.location.replace('multijugador.html');
            return;
        }
        configurarCabecera();
        wireUi();
        renderTodo();
        if (typeof window.emitMultiplayerCoopJoin === 'function') {
            window.emitMultiplayerCoopJoin(SESSION_ID);
        }
        if (typeof window.emitMultiplayerCoopEstadoSolicitar === 'function') {
            window.emitMultiplayerCoopEstadoSolicitar(SESSION_ID);
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
    });
})();
