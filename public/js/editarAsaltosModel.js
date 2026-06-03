/**
 * Modelo y validación de asaltos.xlsx (editor editarAsaltos).
 */
(function () {
    'use strict';

    const COLUMNAS_ASALTO = [
        'asalto_ID', 'nombre', 'imagen', 'descripcion', 'dificultad',
        'carta1', 'carta2', 'carta3', 'carta4', 'carta5', 'carta6',
        'carta7', 'carta8', 'carta9', 'carta10', 'carta11', 'carta12',
        'tablero', 'puntos', 'mejora', 'mejora_especial', 'mejora_suprema', 'mejora_definitiva',
    ];
    const CARTA_KEYS = ['carta1','carta2','carta3','carta4','carta5','carta6','carta7','carta8','carta9','carta10','carta11','carta12'];
    const CAMPOS_NUMERICOS = ['asalto_ID','dificultad','puntos','mejora','mejora_especial','mejora_suprema','mejora_definitiva'];
    const DIFICULTADES = [6, 7, 8];

    function crearFilaAsaltoVacia() {
        const fila = {};
        COLUMNAS_ASALTO.forEach((col) => { fila[col] = ''; });
        fila.dificultad = 6;
        fila.puntos = 0;
        fila.mejora = 0;
        fila.mejora_especial = 0;
        fila.mejora_suprema = 0;
        fila.mejora_definitiva = 0;
        return fila;
    }

    function asegurarFilaAsalto(fila, columnasOrden) {
        const out = {};
        const cols = columnasOrden || COLUMNAS_ASALTO;
        cols.forEach((col) => {
            let v = fila && Object.prototype.hasOwnProperty.call(fila, col) ? fila[col] : '';
            if (CAMPOS_NUMERICOS.includes(col)) {
                const n = Number(v);
                v = Number.isFinite(n) ? n : 0;
            } else if (v === null || v === undefined) {
                v = '';
            } else if (typeof v !== 'string') {
                v = String(v);
            }
            out[col] = v;
        });
        return out;
    }

    function filasDesdeRespuestaApi(data) {
        const columnas = Array.isArray(data?.columnas) ? data.columnas : COLUMNAS_ASALTO;
        const filas = Array.isArray(data?.filas) ? data.filas : [];
        return { columnas, filas: filas.map((f) => asegurarFilaAsalto(f, columnas)) };
    }

    function nombresCartasEnCatalogoSet(filasCatalogo) {
        const set = new Set();
        (filasCatalogo || []).forEach((f) => {
            const n = String(f?.Nombre || '').trim().toLowerCase();
            if (n) set.add(n);
        });
        return set;
    }

    function validarFilaAsalto(fila, indice, todasLasFilas, nombresCatalogo, skinsIndexados) {
        const errores = [];
        const idx = indice + 1;
        const id = Number(fila.asalto_ID);
        if (!Number.isFinite(id)) {
            errores.push(`Fila ${idx}: asalto_ID inválido.`);
        } else if (Array.isArray(todasLasFilas)) {
            const dup = todasLasFilas.filter((f, i) => i !== indice && Number(f.asalto_ID) === id);
            if (dup.length) errores.push(`Fila ${idx}: asalto_ID duplicado (${id}).`);
        }
        if (!String(fila.nombre || '').trim()) errores.push(`Fila ${idx}: falta nombre.`);
        CARTA_KEYS.forEach((key) => {
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
        (filas || []).forEach((fila, i) => errores.push(...validarFilaAsalto(fila, i, filas, nombresCatalogo, skinsIndexados)));
        return { ok: errores.length === 0, errores };
    }

    function filaCoincideFiltros(fila, filtros) {
        const q = String(filtros?.nombre || '').trim().toLowerCase();
        if (q && !String(fila.nombre || '').toLowerCase().includes(q)
            && !String(fila.descripcion || '').toLowerCase().includes(q)) return false;
        const dif = String(filtros?.dificultad || 'todas').trim();
        if (dif && dif !== 'todas' && String(fila.dificultad) !== dif) return false;
        return true;
    }

    function siguienteId(filas) {
        let max = -1;
        (filas || []).forEach((f) => { const id = Number(f.asalto_ID); if (Number.isFinite(id) && id > max) max = id; });
        return max + 1;
    }

    window.DCEditarAsaltosModel = {
        COLUMNAS_ASALTO, CARTA_KEYS, DIFICULTADES,
        crearFilaAsaltoVacia, asegurarFilaAsalto, filasDesdeRespuestaApi,
        validarCatalogo, validarFilaAsalto, nombresCartasEnCatalogoSet,
        filaCoincideFiltros, siguienteId,
    };
})();
