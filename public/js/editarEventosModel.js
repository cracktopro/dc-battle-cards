/**
 * Modelo y validación de eventos.xlsx (editor editarEventos).
 */
(function () {
    'use strict';

    const COLUMNAS_EVENTO = [
        'ID_evento', 'nombre', 'Descripción',
        'enemigo1', 'enemigo2', 'enemigo3', 'enemigo4', 'enemigo5', 'enemigo6',
        'boss', 'mejora', 'mejora_especial', 'puntos', 'cartas', 'tablero',
    ];
    const ENEMIGO_KEYS = ['enemigo1','enemigo2','enemigo3','enemigo4','enemigo5','enemigo6'];
    const CAMPOS_NUMERICOS = ['ID_evento','mejora','mejora_especial','puntos'];

    function crearFilaEventoVacia() {
        const fila = {};
        COLUMNAS_EVENTO.forEach((col) => { fila[col] = ''; });
        fila.mejora = 0;
        fila.mejora_especial = 0;
        fila.puntos = 0;
        return fila;
    }

    function asegurarFilaEvento(fila, columnasOrden) {
        const out = {};
        const cols = columnasOrden || COLUMNAS_EVENTO;
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
        const columnas = Array.isArray(data?.columnas) ? data.columnas : COLUMNAS_EVENTO;
        const filas = Array.isArray(data?.filas) ? data.filas : [];
        return { columnas, filas: filas.map((f) => asegurarFilaEvento(f, columnas)) };
    }

    function nombresCartasEnCatalogoSet(filasCatalogo) {
        const set = new Set();
        (filasCatalogo || []).forEach((f) => {
            const n = String(f?.Nombre || '').trim().toLowerCase();
            if (n) set.add(n);
        });
        return set;
    }

    function leerNombreCartaRecompensa(fila) {
        const raw = String(fila?.cartas || '').trim();
        if (!raw) return '';
        return raw.split(/[;,|]/).map((s) => s.trim()).filter(Boolean)[0] || '';
    }

    function validarFilaEvento(fila, indice, todasLasFilas, nombresCatalogo, skinsIndexados) {
        const errores = [];
        const idx = indice + 1;
        const id = Number(fila.ID_evento);
        if (!Number.isFinite(id)) {
            errores.push(`Fila ${idx}: ID_evento inválido.`);
        } else if (Array.isArray(todasLasFilas)) {
            const dup = todasLasFilas.filter((f, i) => i !== indice && Number(f.ID_evento) === id);
            if (dup.length) errores.push(`Fila ${idx}: ID_evento duplicado (${id}).`);
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
        const cartaRecomp = leerNombreCartaRecompensa(fila);
        if (cartaRecomp) {
            if (window.DCSkinsCartas?.validarReferenciaCartaEnCatalogo) {
                window.DCSkinsCartas.validarReferenciaCartaEnCatalogo(cartaRecomp, nombresCatalogo, skinsIndexados)
                    .forEach((msg) => errores.push(`Fila ${idx} (recompensa): ${msg}`));
            } else if (nombresCatalogo && !nombresCatalogo.has(cartaRecomp.toLowerCase())) {
                errores.push(`Fila ${idx}: carta recompensa «${cartaRecomp}» no está en cartas.xlsx.`);
            }
        }
        return errores;
    }

    function validarCatalogo(filas, filasCatalogoCartas, skinsIndexados) {
        const nombresCatalogo = nombresCartasEnCatalogoSet(filasCatalogoCartas);
        const errores = [];
        (filas || []).forEach((fila, i) => errores.push(...validarFilaEvento(fila, i, filas, nombresCatalogo, skinsIndexados)));
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
        (filas || []).forEach((f) => { const id = Number(f.ID_evento); if (Number.isFinite(id) && id > max) max = id; });
        return max + 1;
    }

    window.DCEditarEventosModel = {
        COLUMNAS_EVENTO, ENEMIGO_KEYS,
        crearFilaEventoVacia, asegurarFilaEvento, filasDesdeRespuestaApi,
        validarCatalogo, validarFilaEvento, nombresCartasEnCatalogoSet,
        leerNombreCartaRecompensa, filaCoincideFiltros, siguienteId,
    };
})();
