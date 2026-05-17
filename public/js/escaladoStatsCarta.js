/**
 * Escalado de Poder/SaludMax por nivel de carta.
 * Niveles 2–6: +500 poder y +500 salud por nivel.
 * Nivel 7: +1000 poder, +1500 salud.
 * Nivel 8: +1500 poder, +2000 salud.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.DCEscaladoStatsCarta = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
    const DC_INCREMENTO_STATS_POR_NIVEL_CARTA = 500;
    const DC_NIVEL_STATS_CARTA_MAX = 8;
    const DC_INCREMENTO_PODER_NIVEL_7 = 1000;
    const DC_INCREMENTO_SALUD_NIVEL_7 = 1500;
    const DC_INCREMENTO_PODER_NIVEL_8 = 1500;
    const DC_INCREMENTO_SALUD_NIVEL_8 = 2000;

    function normalizarNivelCarta(nivel, maxNivel = DC_NIVEL_STATS_CARTA_MAX) {
        return Math.min(maxNivel, Math.max(1, Math.floor(Number(nivel) || 1)));
    }

    function obtenerIncrementoStatsPorNivel(nivel) {
        const n = normalizarNivelCarta(nivel);
        if (n === 7) {
            return { poder: DC_INCREMENTO_PODER_NIVEL_7, salud: DC_INCREMENTO_SALUD_NIVEL_7 };
        }
        if (n === 8) {
            return { poder: DC_INCREMENTO_PODER_NIVEL_8, salud: DC_INCREMENTO_SALUD_NIVEL_8 };
        }
        return {
            poder: DC_INCREMENTO_STATS_POR_NIVEL_CARTA,
            salud: DC_INCREMENTO_STATS_POR_NIVEL_CARTA
        };
    }

    function calcularIncrementoStatsAcumulado(nivelObjetivo, nivelBase = 1) {
        const objetivo = normalizarNivelCarta(nivelObjetivo);
        const base = normalizarNivelCarta(nivelBase);
        let poder = 0;
        let salud = 0;
        if (objetivo <= base) {
            return { poder, salud };
        }
        for (let n = base + 1; n <= objetivo; n += 1) {
            const inc = obtenerIncrementoStatsPorNivel(n);
            poder += inc.poder;
            salud += inc.salud;
        }
        return { poder, salud };
    }

    function calcularPoderEscaladoDesdeBase(poderBase, nivelObjetivo, nivelBase = 1) {
        const inc = calcularIncrementoStatsAcumulado(nivelObjetivo, nivelBase);
        return Math.max(0, Math.floor(Number(poderBase || 0) + inc.poder));
    }

    function calcularSaludEscaladaDesdeBase(saludBase, nivelObjetivo, nivelBase = 1) {
        const inc = calcularIncrementoStatsAcumulado(nivelObjetivo, nivelBase);
        return Math.max(1, Math.floor(Number(saludBase || 1) + inc.salud));
    }

    function inferirStatsBaseDesdeCartaNivel(carta, nivelActual, nivelBase = 1) {
        const nivel = normalizarNivelCarta(nivelActual);
        const baseNivel = normalizarNivelCarta(nivelBase);
        const poder = Number(carta?.Poder ?? carta?.poder ?? 0);
        const salud = Number(carta?.SaludMax ?? carta?.Salud ?? carta?.Poder ?? 0);
        const inc = calcularIncrementoStatsAcumulado(nivel, baseNivel);
        return {
            poderBase: Math.max(0, Math.floor(poder - inc.poder)),
            saludBase: Math.max(1, Math.floor(salud - inc.salud))
        };
    }

    function escalarCartaStatsANivel(carta, nivelObjetivo, opciones = {}) {
        const maxNivel = opciones.maxNivel ?? DC_NIVEL_STATS_CARTA_MAX;
        const nivelBase = opciones.nivelBase != null
            ? normalizarNivelCarta(opciones.nivelBase, maxNivel)
            : 1;
        const nivelActual = opciones.nivelActual != null
            ? normalizarNivelCarta(opciones.nivelActual, maxNivel)
            : normalizarNivelCarta(carta?.Nivel ?? 1, maxNivel);
        const objetivo = normalizarNivelCarta(nivelObjetivo, maxNivel);
        let poderBase;
        let saludBase;
        if (opciones.poderBase != null && opciones.saludBase != null) {
            poderBase = Number(opciones.poderBase);
            saludBase = Number(opciones.saludBase);
        } else {
            const inferidos = inferirStatsBaseDesdeCartaNivel(carta, nivelActual, nivelBase);
            poderBase = inferidos.poderBase;
            saludBase = inferidos.saludBase;
        }
        return {
            poderBase,
            saludBase,
            poderEscalado: calcularPoderEscaladoDesdeBase(poderBase, objetivo, nivelBase),
            saludEscalada: calcularSaludEscaladaDesdeBase(saludBase, objetivo, nivelBase)
        };
    }

    function escalarCartaANivel(carta, nivelObjetivo, opciones = {}) {
        const maxNivel = opciones.maxNivel ?? DC_NIVEL_STATS_CARTA_MAX;
        const nivelNormalizado = normalizarNivelCarta(nivelObjetivo, maxNivel);
        const escalado = escalarCartaStatsANivel(carta, nivelNormalizado, {
            ...opciones,
            maxNivel
        });
        const cartaEscalada = {
            ...carta,
            Nivel: nivelNormalizado,
            Poder: escalado.poderEscalado,
            SaludMax: escalado.saludEscalada,
            Salud: escalado.saludEscalada
        };
        if (typeof window !== 'undefined' && typeof window.recalcularSkillPowerPorNivel === 'function') {
            const skillOpts = opciones.recalcularSkillOpciones || { rawEsBase: true };
            window.recalcularSkillPowerPorNivel(cartaEscalada, nivelNormalizado, skillOpts);
        }
        return cartaEscalada;
    }

    function aplicarIncrementoStatsEntreNiveles(carta, nivelInicial, nivelFinal) {
        const nivelIni = normalizarNivelCarta(nivelInicial);
        const nivelFin = normalizarNivelCarta(nivelFinal);
        const inc = calcularIncrementoStatsAcumulado(nivelFin, nivelIni);
        const resultado = { ...carta };
        resultado.Nivel = nivelFin;
        resultado.Poder = Number(resultado.Poder || 0) + inc.poder;
        const saludActual = Number(resultado.SaludMax ?? resultado.Salud ?? resultado.Poder ?? 0);
        resultado.SaludMax = saludActual + inc.salud;
        resultado.Salud = resultado.SaludMax;
        return resultado;
    }

    function escalarCartaDeltaDificultad(carta, dificultadObjetivo, opciones = {}) {
        const obtenerSalud = opciones.obtenerSaludMaxCarta
            || ((c) => Number(c?.SaludMax ?? c?.Salud ?? c?.Poder ?? 0));
        const maxNivel = opciones.maxNivel ?? DC_NIVEL_STATS_CARTA_MAX;
        const cartaEscalada = { ...carta };
        const nivelBase = Number(cartaEscalada.Nivel || 1);
        const objetivo = normalizarNivelCarta(dificultadObjetivo, maxNivel);
        const inc = calcularIncrementoStatsAcumulado(objetivo, nivelBase);
        const saludBase = obtenerSalud(cartaEscalada);

        cartaEscalada.Nivel = objetivo;
        cartaEscalada.Poder = Number(cartaEscalada.Poder || 0) + inc.poder;
        cartaEscalada.SaludMax = saludBase + inc.salud;
        cartaEscalada.Salud = cartaEscalada.SaludMax;
        if (typeof window !== 'undefined' && typeof window.recalcularSkillPowerPorNivel === 'function') {
            window.recalcularSkillPowerPorNivel(cartaEscalada, objetivo, opciones.recalcularSkillOpciones || { rawEsBase: true });
        }
        return cartaEscalada;
    }

    function escalarBossSegunDificultad(carta, dificultad, opciones = {}) {
        const obtenerSalud = opciones.obtenerSaludMaxCarta
            || ((c) => Number(c?.SaludMax ?? c?.Salud ?? c?.Poder ?? 0));
        const maxNivel = opciones.maxNivel ?? DC_NIVEL_STATS_CARTA_MAX;
        const cartaBoss = { ...carta };
        const nivelBase = Number(cartaBoss.Nivel || 1);
        const objetivo = normalizarNivelCarta(dificultad, maxNivel);
        const inc = calcularIncrementoStatsAcumulado(objetivo, nivelBase);
        const saludBase = obtenerSalud(cartaBoss);
        const poderBase = Number(cartaBoss.Poder || 0);

        cartaBoss.Nivel = objetivo;
        cartaBoss.Poder = Math.round(poderBase + inc.poder);
        const saludBossActual = Math.round((saludBase * 8) + inc.salud);
        cartaBoss.SaludMax = Math.round(saludBossActual * 1.75);
        cartaBoss.Salud = cartaBoss.SaludMax;
        cartaBoss.esBoss = true;
        if (typeof window !== 'undefined' && typeof window.recalcularSkillPowerPorNivel === 'function') {
            window.recalcularSkillPowerPorNivel(cartaBoss, objetivo, opciones.recalcularSkillOpciones || { rawEsBase: true });
        }
        return cartaBoss;
    }

    return {
        DC_INCREMENTO_STATS_POR_NIVEL_CARTA,
        DC_NIVEL_STATS_CARTA_MAX,
        normalizarNivelCarta,
        obtenerIncrementoStatsPorNivel,
        calcularIncrementoStatsAcumulado,
        calcularPoderEscaladoDesdeBase,
        calcularSaludEscaladaDesdeBase,
        inferirStatsBaseDesdeCartaNivel,
        escalarCartaStatsANivel,
        escalarCartaANivel,
        aplicarIncrementoStatsEntreNiveles,
        escalarCartaDeltaDificultad,
        escalarBossSegunDificultad
    };
});
