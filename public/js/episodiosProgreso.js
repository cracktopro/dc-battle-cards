/**
 * Progreso local de capítulos por episodio (desbloqueo secuencial).
 */
(function (root) {
    const LS_KEY = 'dc_episodios_progreso_v1';

    function claveEpisodio(episodioId, jsonPath) {
        const id = String(episodioId ?? '').trim();
        const path = String(jsonPath || '').trim();
        return `${id}|${path}`;
    }

    function leerAlmacen() {
        try {
            const raw = root.localStorage?.getItem(LS_KEY);
            if (!raw) return {};
            const obj = JSON.parse(raw);
            return obj && typeof obj === 'object' ? obj : {};
        } catch {
            return {};
        }
    }

    function guardarAlmacen(almacen) {
        try {
            root.localStorage.setItem(LS_KEY, JSON.stringify(almacen));
        } catch {
            /* noop */
        }
    }

    function obtenerProgreso(episodioId, jsonPath) {
        const almacen = leerAlmacen();
        const key = claveEpisodio(episodioId, jsonPath);
        const entry = almacen[key];
        const completados = Array.isArray(entry?.capitulosCompletados)
            ? entry.capitulosCompletados.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n >= 0)
            : [];
        return {
            key,
            capitulosCompletados: [...new Set(completados)].sort((a, b) => a - b),
        };
    }

    function marcarCapituloCompletado(episodioId, jsonPath, capituloIndex) {
        const idx = Number(capituloIndex);
        if (!Number.isFinite(idx) || idx < 0) {
            return obtenerProgreso(episodioId, jsonPath);
        }
        const almacen = leerAlmacen();
        const key = claveEpisodio(episodioId, jsonPath);
        const prev = obtenerProgreso(episodioId, jsonPath);
        const set = new Set(prev.capitulosCompletados);
        set.add(idx);
        almacen[key] = {
            capitulosCompletados: [...set].sort((a, b) => a - b),
            actualizadoEn: Date.now(),
        };
        guardarAlmacen(almacen);
        return obtenerProgreso(episodioId, jsonPath);
    }

    /** Capítulo 0 siempre desbloqueado; el N requiere completar N-1. */
    function capituloDesbloqueado(progreso, capituloIndex, totalCapitulos) {
        const idx = Number(capituloIndex);
        if (!Number.isFinite(idx) || idx < 0) {
            return false;
        }
        const total = Number(totalCapitulos);
        if (Number.isFinite(total) && total > 0 && idx >= total) {
            return false;
        }
        if (idx === 0) {
            return true;
        }
        const completados = Array.isArray(progreso?.capitulosCompletados)
            ? progreso.capitulosCompletados
            : [];
        return completados.includes(idx - 1);
    }

    function capituloCompletado(progreso, capituloIndex) {
        const idx = Number(capituloIndex);
        const completados = Array.isArray(progreso?.capitulosCompletados)
            ? progreso.capitulosCompletados
            : [];
        return completados.includes(idx);
    }

    root.DCEpisodiosProgreso = {
        obtenerProgreso,
        marcarCapituloCompletado,
        capituloDesbloqueado,
        capituloCompletado,
        claveEpisodio,
    };
}(typeof window !== 'undefined' ? window : globalThis));
