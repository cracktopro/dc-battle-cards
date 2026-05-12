/**
 * Renderizado de cartas en tablero cooperativo: misma estructura DOM y reglas visuales que partida.js (crearCartaElemento).
 * No modifica partida.js ni otros modos.
 */
(function () {
    function normalizarAfiliacion(afi) {
        return String(afi || '').trim().toLowerCase();
    }

    function esCartaBoss(carta) {
        return Boolean(carta?.esBoss);
    }

    function obtenerAfiliacionesCarta(carta) {
        const raw = String(carta?.Afiliacion || carta?.afiliacion || '');
        if (!raw.trim()) return [];
        return raw.split(';').map(item => item.trim()).filter(Boolean);
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

    function obtenerSaludMaxCarta(carta) {
        if (!carta) return 0;
        const saludMax = Number(carta.SaludMax ?? carta.saludMax);
        if (Number.isFinite(saludMax) && saludMax > 0) return saludMax;
        const salud = Number(carta.Salud ?? carta.salud);
        if (Number.isFinite(salud) && salud > 0) return salud;
        return Math.max(Number(carta.Poder || 0), 0);
    }

    function obtenerSaludActualCarta(carta) {
        if (!carta) return 0;
        const saludMax = obtenerSaludMaxCarta(carta);
        const salud = Number(carta.Salud ?? carta.salud);
        const saludValida = Number.isFinite(salud) ? salud : saludMax;
        return Math.max(0, Math.min(saludValida, saludMax));
    }

    function cartaCuentaComoActivaEnMesa(carta) {
        if (!carta) return false;
        const salud = obtenerSaludActualCarta(carta);
        const escudo = Math.max(0, Number(carta.escudoActual || 0));
        return salud + escudo > 0;
    }

    function obtenerPoderCartaFinal(carta) {
        if (!carta) return 0;
        const finalNum = Number(carta.poderFinalAfiliacion);
        if (Number.isFinite(finalNum)) return finalNum;
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

    function calcularBonusAfiliaciones(cartas) {
        const conteoAfiliaciones = new Map();
        (Array.isArray(cartas) ? cartas : [])
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
            if (cantidad >= 3) bonus = 1000;
            else if (cantidad >= 2) bonus = 500;
            if (bonus > 0) afiliacionesActivas.push({ afiliacion, bonus, cantidad });
        });
        afiliacionesActivas.sort((a, b) => {
            if (b.bonus !== a.bonus) return b.bonus - a.bonus;
            if (b.cantidad !== a.cantidad) return b.cantidad - a.cantidad;
            return a.afiliacion.localeCompare(b.afiliacion);
        });
        const afiliacionPrincipal = afiliacionesActivas[0] || null;
        const bonusMaximo = afiliacionPrincipal ? afiliacionPrincipal.bonus : 0;
        return { bonusMaximo, afiliacionesActivas, afiliacionPrincipal };
    }

    /**
     * @param {Array} cartas Mesa a la que se aplican bonos (A, B o bot).
     * @param {Array} cartasEnemigas Enemigos para debuffs / bonus_debuff.
     * @param {Array|null} cartasParaConteoAfiliacion Si se pasa, el conteo de afiliación (x2/x3) usa este conjunto
     *        (p. ej. A+B en coop para bonus global del equipo humano).
     */
    function aplicarBonusAfiliaciones(cartas, cartasEnemigas = [], cartasParaConteoAfiliacion = null) {
        const poolAfiliacion = cartasParaConteoAfiliacion != null ? cartasParaConteoAfiliacion : cartas;
        const { bonusMaximo, afiliacionPrincipal } = calcularBonusAfiliaciones(poolAfiliacion);
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
            if (!carta) return null;
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
            const recibeBonus = Boolean(afiliacionPrincipal?.afiliacion)
                && afiliacionesCarta.has(afiliacionPrincipal.afiliacion);
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
            afiliacionPrincipal
        };
    }

    function obtenerFactorDebuffSaludDesdeEnemigos(cartasEnemigas) {
        if (!Array.isArray(cartasEnemigas)) return 1;
        const cantidadDebuffs = cartasEnemigas.filter(carta => {
            if (!carta || !cartaCuentaComoActivaEnMesa(carta)) return false;
            const meta = obtenerMetaHabilidad(carta);
            return meta.tieneHabilidad && meta.trigger === 'auto' && meta.clase === 'heal_debuff';
        }).length;
        if (cantidadDebuffs <= 0) return 1;
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

    function obtenerIndiceTankActivo(cartas) {
        for (let i = 0; i < cartas.length; i += 1) {
            const c = cartas[i];
            if (c?.tankActiva && cartaCuentaComoActivaEnMesa(c)) return i;
        }
        return null;
    }

    function cartaEstaAturdida(carta) {
        return Math.max(0, Number(carta?.stunRestante || 0)) > 0;
    }

    function obtenerImagenCartaSafe(carta) {
        if (typeof window.obtenerImagenCarta === 'function') {
            return window.obtenerImagenCarta(carta);
        }
        return 'img/default-image.jpg';
    }

    /**
     * Calcula mesas con bonos de afiliación para pintado (no muta el snapshot).
     */
    function calcularMesasConBonus(snapshot) {
        const bot = Array.isArray(snapshot?.cartasEnJuegoBot) ? snapshot.cartasEnJuegoBot : [];
        const a = Array.isArray(snapshot?.cartasEnJuegoA) ? snapshot.cartasEnJuegoA : [];
        const b = Array.isArray(snapshot?.cartasEnJuegoB) ? snapshot.cartasEnJuegoB : [];

        const enemigosDeA = [...bot, ...b].filter(Boolean);
        const enemigosDeB = [...bot, ...a].filter(Boolean);
        const enemigosDeBot = [...a, ...b].filter(Boolean);

        /** Equipo humano completo: el umbral x2/x3 de afiliación cuenta cartas vivas en A y B a la vez. */
        const equipoHumanoAfiliacion = [...a, ...b].filter(Boolean);

        const { cartasConBonus: mesaBot } = aplicarBonusAfiliaciones(bot, enemigosDeBot);
        const { cartasConBonus: mesaA } = aplicarBonusAfiliaciones(a, enemigosDeA, equipoHumanoAfiliacion);
        const { cartasConBonus: mesaB } = aplicarBonusAfiliaciones(b, enemigosDeB, equipoHumanoAfiliacion);

        return { mesaBot, mesaA, mesaB };
    }

    function crearCartaElementoCoop(carta, tipo, slotIndex, opciones = {}) {
        const soloVista = Boolean(opciones.soloVista);
        const cartasEnemigas = Array.isArray(opciones.enemigosParaSalud) ? opciones.enemigosParaSalud : [];

        const cartaDiv = document.createElement('div');
        cartaDiv.classList.add('carta');
        if (soloVista) cartaDiv.classList.add('carta-solo-vista');
        if (Number(carta?.Nivel || 1) >= 6) cartaDiv.classList.add('nivel-legendaria');

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

        const imagenUrl = obtenerImagenCartaSafe(carta);
        cartaDiv.style.backgroundImage = `url(${imagenUrl})`;
        cartaDiv.style.backgroundSize = 'cover';
        cartaDiv.style.backgroundPosition = 'center top';

        if (!soloVista) {
            if (opciones.onClickCarta) {
                cartaDiv.style.cursor = 'pointer';
                cartaDiv.addEventListener('click', (e) => {
                    e.stopPropagation();
                    opciones.onClickCarta(slotIndex);
                });
            }
            if (opciones.cartaAgotada) {
                cartaDiv.classList.add('carta-agotada');
            }
            if (opciones.destacadaSeleccion) {
                cartaDiv.classList.add('carta-seleccionada');
            }
            if (opciones.destacadaAtacando) {
                cartaDiv.classList.add('carta-atacando');
            }
            if (opciones.destacadaObjetivo) {
                cartaDiv.classList.add('carta-objetivo');
            }
            if (opciones.bloqueadaPorTank) {
                cartaDiv.classList.add('carta-bloqueada-por-tank');
            }
        }

        const detallesDiv = document.createElement('div');
        detallesDiv.classList.add('detalles-carta');

        const nombreSpan = document.createElement('span');
        nombreSpan.classList.add('nombre-carta');
        nombreSpan.textContent = carta.Nombre;
        const longitudNombre = String(carta?.Nombre || '').trim().length;
        if (longitudNombre >= 24) nombreSpan.classList.add('nombre-muy-largo');
        else if (longitudNombre >= 18) nombreSpan.classList.add('nombre-largo');

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
            .filter(dot => (
                Math.max(0, Math.floor(Number(dot?.turnosRestantes || 0))) > 0
                && Math.max(0, Math.floor(Number(dot?.danoPorTurno || 0))) > 0
            ));
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
        const dificultadBoss = Number(opciones.dificultadEvento || opciones.dificultadBoss || 1);
        const cantidadEstrellas = esCartaBoss(carta)
            ? Math.min(Math.max(dificultadBoss, 1), 6)
            : Number(carta.Nivel || 1);
        for (let i = 0; i < cantidadEstrellas; i += 1) {
            const estrella = document.createElement('img');
            estrella.classList.add('estrella');
            estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
            estrella.alt = 'star';
            estrellasDiv.appendChild(estrella);
        }

        cartaDiv.appendChild(detallesDiv);
        const badgeHabilidad = window.crearBadgeHabilidadCarta ? window.crearBadgeHabilidadCarta(carta) : null;
        if (badgeHabilidad) cartaDiv.appendChild(badgeHabilidad);
        const badgeAfiliacion = window.crearBadgeAfiliacionCarta ? window.crearBadgeAfiliacionCarta(carta) : null;
        if (badgeAfiliacion && !carta?.tankActiva) cartaDiv.appendChild(badgeAfiliacion);
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
        const mostrarBotonHabilidad = !soloVista && tipo === 'jugador' && metaHabilidad.tieneHabilidad && metaHabilidad.trigger === 'usar';
        if (mostrarBotonHabilidad) {
            const botonHabilidad = document.createElement('button');
            botonHabilidad.type = 'button';
            botonHabilidad.className = 'btn-habilidad-uso';
            const cooldownActual = Math.max(0, Number(carta.habilidadCooldownRestante || 0));
            botonHabilidad.textContent = cooldownActual > 0
                ? `Cooldown: ${cooldownActual} ${cooldownActual === 1 ? 'turno' : 'turnos'}`
                : 'Usar Habilidad';
            const deshabilitada = Boolean(
                cooldownActual > 0
                || cartaEstaAturdida(carta)
                || opciones.partidaFinalizada
                || opciones.deshabilitarBotonHabilidad
                || opciones.cartasYaAtacaron?.includes(slotIndex)
            );
            botonHabilidad.disabled = deshabilitada;
            if (typeof opciones.onUsarHabilidad === 'function') {
                botonHabilidad.addEventListener('click', (event) => {
                    event.stopPropagation();
                    opciones.onUsarHabilidad(slotIndex);
                });
            } else {
                botonHabilidad.disabled = true;
                botonHabilidad.title = 'Habilidad activa pendiente de sincronización en modo cooperativo.';
            }
            usarHabilidad = botonHabilidad;
        }

        return { root: cartaDiv, usarHabilidad };
    }

    function mostrarCartaEnSlotCoop(slot, carta, tipo, slotIndex, opciones = {}) {
        if (!slot) return;
        slot.innerHTML = '';
        if (!carta) return;

        const { root, usarHabilidad } = crearCartaElementoCoop(carta, tipo, slotIndex, opciones);
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

    window.tableroCoopCartaUi = {
        calcularMesasConBonus,
        mostrarCartaEnSlotCoop,
        crearCartaElementoCoop,
        aplicarBonusAfiliaciones,
        obtenerIndiceTankActivo,
        obtenerSaludEfectiva,
        obtenerSaludMaxCarta
    };
})();
