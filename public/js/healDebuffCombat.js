/**
 * Mecánica heal_debuff: −25% salud máxima efectiva por fuente activa (×0.75 apilable).
 * SaludMax en carta = salud base; Salud = HP actual (clamp al aplicar, cura +25% base al retirar por fuente).
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.DCHealDebuffCombat = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
    const FACTOR_POR_FUENTE = 0.75;
    const MIN_FACTOR = 0.1;
    const CURA_POR_FUENTE_BASE = 0.25;

    function defaultObtenerMetaHabilidad(carta) {
        if (typeof window !== 'undefined' && typeof window.obtenerMetaHabilidadCarta === 'function') {
            return window.obtenerMetaHabilidadCarta(carta);
        }
        const triggerRaw = String(carta?.skill_trigger || '').trim().toLowerCase();
        const trigger = triggerRaw === 'usar' ? 'usar' : (triggerRaw === 'auto' ? 'auto' : null);
        const claseRaw = String(carta?.skill_class || '').trim().toLowerCase();
        const clase = claseRaw === 'heall_all' ? 'heal_all' : claseRaw;
        const nombre = String(carta?.skill_name || '').trim();
        return {
            tieneHabilidad: Boolean(trigger && nombre && clase),
            trigger,
            clase,
            nombre
        };
    }

    function obtenerSaludMaxBase(carta) {
        if (!carta) return 0;
        const saludMax = Number(carta.SaludMax ?? carta.saludMax);
        if (Number.isFinite(saludMax) && saludMax > 0) return saludMax;
        const salud = Number(carta.Salud ?? carta.salud);
        if (Number.isFinite(salud) && salud > 0) return salud;
        return Math.max(Number(carta.Poder || 0), 0);
    }

    function obtenerSaludActualBase(carta) {
        if (!carta) return 0;
        const saludMax = obtenerSaludMaxBase(carta);
        const salud = Number(carta.Salud ?? carta.salud);
        const saludValida = Number.isFinite(salud) ? salud : saludMax;
        return Math.max(0, Math.min(saludValida, saludMax));
    }

    function cartaActivaEnMesa(carta) {
        if (!carta) return false;
        const salud = obtenerSaludActualBase(carta);
        const escudo = Math.max(0, Number(carta.escudoActual || 0));
        return salud + escudo > 0;
    }

    function contarFuentesHealDebuff(cartasEnemigas, obtenerMeta = defaultObtenerMetaHabilidad) {
        if (!Array.isArray(cartasEnemigas)) return 0;
        return cartasEnemigas.filter(carta => {
            if (!cartaActivaEnMesa(carta)) return false;
            const meta = obtenerMeta(carta);
            return meta.tieneHabilidad && meta.trigger === 'auto' && meta.clase === 'heal_debuff';
        }).length;
    }

    function obtenerFactorHealDebuff(cartasEnemigas, obtenerMeta = defaultObtenerMetaHabilidad) {
        const n = contarFuentesHealDebuff(cartasEnemigas, obtenerMeta);
        if (n <= 0) return 1;
        return Math.max(MIN_FACTOR, Math.pow(FACTOR_POR_FUENTE, n));
    }

    function stacksDesdeFactor(factor) {
        if (!Number.isFinite(factor) || factor >= 1 - 1e-9) return 0;
        return Math.max(0, Math.round(Math.log(factor) / Math.log(FACTOR_POR_FUENTE)));
    }

    function saludMaxEfectiva(saludMaxBase, factor) {
        return Math.max(1, Math.round(saludMaxBase * factor));
    }

    function obtenerSaludEfectiva(carta, cartasEnemigas, obtenerMeta = defaultObtenerMetaHabilidad) {
        if (!carta) {
            return { saludActual: 0, saludMax: 0, escudo: 0, totalActual: 0, totalMax: 0, factor: 1 };
        }
        const factor = obtenerFactorHealDebuff(cartasEnemigas, obtenerMeta);
        const saludMaxBase = obtenerSaludMaxBase(carta);
        const saludMaxEff = saludMaxEfectiva(saludMaxBase, factor);
        const saludEff = Math.max(0, Math.min(obtenerSaludActualBase(carta), saludMaxEff));
        const escudo = Math.max(0, Number(carta.escudoActual || 0));
        return {
            saludActual: saludEff,
            saludMax: saludMaxEff,
            escudo,
            totalActual: saludEff + escudo,
            /** Máximo de la barra y del texto (salud base/efectiva, sin escudo). */
            totalMax: saludMaxEff,
            factor
        };
    }

    /**
     * Métricas de UI: numerador = salud+escudo, denominador = salud máx. (sin escudo).
     * Barra azul si hay escudo o si el total supera el máximo de salud.
     */
    function obtenerPresentacionBarraSalud(estadoSalud) {
        const saludMaxBarra = Math.max(Number(estadoSalud?.saludMax) || 0, 1);
        const totalActual = Math.max(0, Number(estadoSalud?.totalActual) || 0);
        const escudo = Math.max(0, Number(estadoSalud?.escudo) || 0);
        const excedeMax = totalActual > saludMaxBarra;
        const porcentaje = excedeMax
            ? 100
            : Math.max(0, Math.min((totalActual / saludMaxBarra) * 100, 100));
        return {
            textoNumerador: totalActual,
            textoDenominador: saludMaxBarra,
            porcentaje,
            ratio: porcentaje / 100,
            barraAzul: escudo > 0 || excedeMax
        };
    }

    function aplicarTransicionFactor(carta, factorAnterior, factorNuevo) {
        if (!carta || factorAnterior === factorNuevo) return carta;
        const saludMaxBase = obtenerSaludMaxBase(carta);
        let salud = obtenerSaludActualBase(carta);

        if (factorNuevo < factorAnterior) {
            salud = Math.min(salud, saludMaxEfectiva(saludMaxBase, factorNuevo));
        } else {
            const stacksRemoved = stacksDesdeFactor(factorAnterior) - stacksDesdeFactor(factorNuevo);
            if (stacksRemoved > 0 && salud > 0) {
                const cura = Math.round(saludMaxBase * CURA_POR_FUENTE_BASE) * stacksRemoved;
                const maxEff = saludMaxEfectiva(saludMaxBase, factorNuevo);
                salud = Math.min(maxEff, salud + cura);
            }
        }

        carta.Salud = salud;
        carta.SaludMax = saludMaxBase;
        return carta;
    }

    function sincronizarCartasConFactor(cartas, factorAnterior, factorNuevo) {
        if (factorAnterior === factorNuevo) return;
        (Array.isArray(cartas) ? cartas : []).forEach(carta => {
            if (carta) aplicarTransicionFactor(carta, factorAnterior, factorNuevo);
        });
    }

    function aplicarDanio(carta, danioBruto, cartasEnemigas, obtenerMeta = defaultObtenerMetaHabilidad) {
        if (!carta) {
            return { salud: 0, escudo: 0, murio: true };
        }
        const factor = obtenerFactorHealDebuff(cartasEnemigas, obtenerMeta);
        const maxBase = obtenerSaludMaxBase(carta);
        const maxEff = saludMaxEfectiva(maxBase, factor);
        let salud = Math.min(obtenerSaludActualBase(carta), maxEff);
        let escudo = Math.max(0, Number(carta.escudoActual || 0));
        let restante = Math.max(0, Number(danioBruto) || 0);

        if (escudo > 0 && restante > 0) {
            const absorbido = Math.min(escudo, restante);
            escudo -= absorbido;
            restante -= absorbido;
        }
        if (restante > 0) {
            salud = Math.max(0, salud - restante);
        }

        carta.Salud = salud;
        carta.SaludMax = maxBase;
        carta.escudoActual = escudo;
        return { salud, escudo, murio: salud + escudo <= 0 };
    }

    function capCuracion(carta, saludDeseada, cartasEnemigas, obtenerMeta = defaultObtenerMetaHabilidad) {
        const factor = obtenerFactorHealDebuff(cartasEnemigas, obtenerMeta);
        const maxBase = obtenerSaludMaxBase(carta);
        const maxEff = saludMaxEfectiva(maxBase, factor);
        return Math.min(maxBase, Math.min(maxEff, saludDeseada));
    }

    return {
        FACTOR_POR_FUENTE,
        obtenerSaludMaxBase,
        obtenerSaludActualBase,
        cartaActivaEnMesa,
        contarFuentesHealDebuff,
        obtenerFactorHealDebuff,
        obtenerSaludEfectiva,
        obtenerPresentacionBarraSalud,
        aplicarTransicionFactor,
        sincronizarCartasConFactor,
        aplicarDanio,
        capCuracion,
        saludMaxEfectiva
    };
});
