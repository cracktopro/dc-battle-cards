/**
 * Modelo y validación de eventos_online.xlsx (editor editarEventosCoop).
 */
(function () {
    'use strict';

    const COLUMNAS_EVENTO_COOP = [
        'ID_evento_online', 'nombre', 'Descripción',
        'enemigo1', 'enemigo2', 'enemigo3', 'enemigo4', 'enemigo5', 'enemigo6', 'enemigo7', 'enemigo8',
        'boss', 'mejora', 'mejora_especial', 'puntos', 'tablero',
    ];
    const ENEMIGO_KEYS = ['enemigo1','enemigo2','enemigo3','enemigo4','enemigo5','enemigo6','enemigo7','enemigo8'];
    const CAMPOS_NUMERICOS = ['ID_evento_online','mejora','mejora_especial','puntos'];

    function crearFilaEventoCoopVacia() {
        const fila = {};
        COLUMNAS_EVENTO_COOP.forEach((col) => { fila[col] = ''; });
        fila.mejora = 0;
        fila.mejora_especial = 0;
        fila.puntos = 0;
        return fila;
    }

    function asegurarFilaEventoCoop(fila, columnasOrden) {
        const out = {};
        const cols = columnasOrden || COLUMNAS_EVENTO_COOP;
        cols.forEach((col) => {
            let v = fila && Object.prototype.hasOwnProperty.call(fila, col) ? fila[col] : '';
            if (CAMPOS_NUMERICOS.includes(col)) {
                const n = Number(v); v = Number.isFinite(n) ? n : 0;
            } else if (v === null || v === undefined) { v = ''; }
            else if (typeof v !== 'string') { v = String(v); }
            out[col] = v;
        });
        return out;
    }

    function filasDesdeRespuestaApi(data) {
        const columnas = Array.isArray(data?.columnas) ? data.columnas : COLUMNAS_EVENTO_COOP;
        const filas = Array.isArray(data?.filas) ? data.filas : [];
        return { columnas, filas: filas.map((f) => asegurarFilaEventoCoop(f, columnas)) };
    }

    function nombresCartasEnCatalogoSet(filasCatalogo) {
        const set = new Set();
        (filasCatalogo || []).forEach((f) => {
            const n = String(f?.Nombre || '').trim().toLowerCase();
            if (n) set.add(n);
        });
        return set;
    }

    function validarFilaEventoCoop(fila, indice, todasLasFilas, nombresCatalogo, skinsIndexados) {
        const errores = [];
        const idx = indice + 1;
        const id = Number(fila.ID_evento_online);
        if (!Number.isFinite(id)) {
            errores.push(`Fila ${idx}: ID_evento_online inválido.`);
        } else if (Array.isArray(todasLasFilas)) {
            const dup = todasLasFilas.filter((f, i) => i !== indice && Number(f.ID_evento_online) === id);
            if (dup.length) errores.push(`Fila ${idx}: ID_evento_online duplicado (${id}).`);
        }
        if (!String(fila.nombre || '').trim()) errores.push(`Fila ${idx}: falta nombre.`);
        [...ENEMIGO_KEYS, 'boss'].forEach((key) => {
            const nom = String(fila[key] || '').trim();
            if (!nom) return;
            if (window.DCSkinsCartas?.validarReferenciaCartaEnCatalogo) {
                window.DCSkinsCartas.validarReferenciaCartaEnCatalogo(nom, nombresCatalogo, skinsIndexados)
                    .forEach((msg) => errores.push(`Fila ${idx} (${key}): ${msg}`));
            } else if (nombresCatalogo && !nombresCatalogo.has(nom.toLowerCase())) {
                errores.push(`Fila ${idx}: «${nom}» (${key}) no está en cartas.xlsx.`);
            }
        });
        return errores;
    }

    function validarCatalogo(filas, filasCatalogoCartas, skinsIndexados) {
        const nombresCatalogo = nombresCartasEnCatalogoSet(filasCatalogoCartas);
        const errores = [];
        (filas || []).forEach((fila, i) => errores.push(...validarFilaEventoCoop(fila, i, filas, nombresCatalogo, skinsIndexados)));
        return { ok: errores.length === 0, errores };
    }

    function filaCoincideFiltros(fila, filtros) {
        const q = String(filtros?.nombre || '').trim().toLowerCase();
        if (q && !String(fila.nombre || '').toLowerCase().includes(q)
            && !String(fila['Descripción'] || '').toLowerCase().includes(q)) return false;
        return true;
    }

    function siguienteId(filas) {
        let max = -1;
        (filas || []).forEach((f) => { const id = Number(f.ID_evento_online); if (Number.isFinite(id) && id > max) max = id; });
        return max + 1;
    }

    window.DCEditarEventosCoopModel = {
        COLUMNAS_EVENTO_COOP, ENEMIGO_KEYS,
        crearFilaEventoCoopVacia, asegurarFilaEventoCoop, filasDesdeRespuestaApi,
        validarCatalogo, validarFilaEventoCoop, nombresCartasEnCatalogoSet,
        filaCoincideFiltros, siguienteId,
    };
})();
