/**
 * Modelo y validación de desafios.xlsx (editor editarDesafios).
 */
(function () {
    'use strict';

    const COLUMNAS_DESAFIO = [
        'ID_desafio', 'faccion', 'nombre', 'Descripción', 'dificultad',
        'enemigo1', 'enemigo2', 'enemigo3', 'enemigo4', 'enemigo5', 'enemigo6',
        'boss', 'mejora', 'mejora_especial', 'puntos', 'cartas', 'tablero',
    ];

    const ENEMIGO_KEYS = ['enemigo1', 'enemigo2', 'enemigo3', 'enemigo4', 'enemigo5', 'enemigo6'];
    const FACCIONES = ['H', 'V'];
    const CAMPOS_TEXTO_SIMPLE = [
        'ID_desafio', 'nombre', 'Descripción', 'dificultad',
        'mejora', 'mejora_especial', 'puntos',
    ];

    function crearFilaDesafioVacia() {
        const fila = {};
        COLUMNAS_DESAFIO.forEach((col) => { fila[col] = ''; });
        fila.faccion = 'H';
        fila.dificultad = 1;
        fila.mejora = 0;
        fila.mejora_especial = 0;
        fila.puntos = 0;
        return fila;
    }

    function asegurarFilaDesafio(fila, columnasOrden) {
        const out = {};
        const cols = columnasOrden || COLUMNAS_DESAFIO;
        cols.forEach((col) => {
            let v = fila && Object.prototype.hasOwnProperty.call(fila, col) ? fila[col] : '';
            if (col === 'ID_desafio' || col === 'dificultad' || col === 'mejora' || col === 'mejora_especial' || col === 'puntos') {
                const n = Number(v);
                v = Number.isFinite(n) ? n : (col === 'dificultad' ? 1 : 0);
            } else if (col === 'faccion') {
                v = String(v || '').trim().toUpperCase() === 'V' ? 'V' : 'H';
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
        const columnas = Array.isArray(data?.columnas) ? data.columnas : COLUMNAS_DESAFIO;
        const filas = Array.isArray(data?.filas) ? data.filas : [];
        return {
            columnas,
            filas: filas.map((f) => asegurarFilaDesafio(f, columnas)),
        };
    }

    function normalizarFaccion(valor) {
        return String(valor || '').trim().toUpperCase() === 'V' ? 'V' : 'H';
    }

    function leerNombreCartaRecompensa(fila) {
        const raw = String(fila?.cartas || '').trim();
        if (!raw) return '';
        return raw.split(/[;,|]/).map((s) => s.trim()).filter(Boolean)[0] || '';
    }

    function nombresCartasEnCatalogoSet(filasCatalogo) {
        const set = new Set();
        (filasCatalogo || []).forEach((f) => {
            const n = String(f?.Nombre || '').trim().toLowerCase();
            if (n) set.add(n);
        });
        return set;
    }

    function validarFilaDesafio(fila, indice, todasLasFilas, nombresCatalogo, skinsIndexados) {
        const errores = [];
        const idx = indice + 1;
        const id = Number(fila.ID_desafio);
        if (!Number.isFinite(id)) {
            errores.push(`Fila ${idx}: ID_desafio inválido.`);
        } else if (Array.isArray(todasLasFilas)) {
            const dup = todasLasFilas.filter((f, i) => i !== indice && Number(f.ID_desafio) === id);
            if (dup.length) {
                errores.push(`Fila ${idx}: ID_desafio duplicado (${id}).`);
            }
        }

        const nombre = String(fila.nombre || '').trim();
        if (!nombre) {
            errores.push(`Fila ${idx}: falta nombre.`);
        }

        const fac = normalizarFaccion(fila.faccion);
        if (!FACCIONES.includes(fac)) {
            errores.push(`Fila ${idx} (${nombre || '?'}): faccion debe ser H o V.`);
        }

        const dif = Number(fila.dificultad);
        if (!Number.isFinite(dif) || dif < 1 || dif > 6) {
            errores.push(`Fila ${idx} (${nombre || '?'}): dificultad debe ser 1–6.`);
        }

        const refs = [...ENEMIGO_KEYS.map((k) => fila[k]), fila.boss];
        refs.forEach((ref, i) => {
            const nom = String(ref || '').trim();
            if (!nom) return;
            const key = i < ENEMIGO_KEYS.length ? ENEMIGO_KEYS[i] : 'boss';
            if (window.DCSkinsCartas?.validarReferenciaCartaEnCatalogo) {
                window.DCSkinsCartas.validarReferenciaCartaEnCatalogo(nom, nombresCatalogo, skinsIndexados)
                    .forEach((msg) => errores.push(`Fila ${idx} (${nombre || '?'}, ${key}): ${msg}`));
            } else if (nombresCatalogo && !nombresCatalogo.has(nom.toLowerCase())) {
                errores.push(`Fila ${idx} (${nombre || '?'}): «${nom}» (${key}) no está en cartas.xlsx.`);
            }
        });

        const cartaRecomp = leerNombreCartaRecompensa(fila);
        if (cartaRecomp) {
            if (window.DCSkinsCartas?.validarReferenciaCartaEnCatalogo) {
                window.DCSkinsCartas.validarReferenciaCartaEnCatalogo(cartaRecomp, nombresCatalogo, skinsIndexados)
                    .forEach((msg) => errores.push(`Fila ${idx} (${nombre || '?'}, recompensa): ${msg}`));
            } else if (nombresCatalogo && !nombresCatalogo.has(cartaRecomp.toLowerCase())) {
                errores.push(`Fila ${idx} (${nombre || '?'}): carta recompensa «${cartaRecomp}» no está en cartas.xlsx.`);
            }
        }

        return errores;
    }

    function validarCatalogo(filas, filasCatalogoCartas, skinsIndexados) {
        const nombresCatalogo = nombresCartasEnCatalogoSet(filasCatalogoCartas);
        const errores = [];
        (filas || []).forEach((fila, i) => {
            errores.push(...validarFilaDesafio(fila, i, filas, nombresCatalogo, skinsIndexados));
        });
        return { ok: errores.length === 0, errores };
    }

    function filaCoincideFiltros(fila, filtros) {
        const q = String(filtros?.nombre || '').trim().toLowerCase();
        if (q && !String(fila.nombre || '').toLowerCase().includes(q)
            && !String(fila.Descripción || '').toLowerCase().includes(q)) {
            return false;
        }
        const fac = String(filtros?.faccion || 'todas').trim().toUpperCase();
        if (fac && fac !== 'TODAS' && normalizarFaccion(fila.faccion) !== fac) {
            return false;
        }
        const dif = String(filtros?.dificultad || 'todas').trim();
        if (dif && dif !== 'todas' && String(fila.dificultad) !== dif) {
            return false;
        }
        return true;
    }

    function siguienteIdDesafio(filas) {
        let max = -1;
        (filas || []).forEach((f) => {
            const id = Number(f.ID_desafio);
            if (Number.isFinite(id) && id > max) max = id;
        });
        return max + 1;
    }

    window.DCEditarDesafiosModel = {
        COLUMNAS_DESAFIO,
        ENEMIGO_KEYS,
        FACCIONES,
        CAMPOS_TEXTO_SIMPLE,
        crearFilaDesafioVacia,
        asegurarFilaDesafio,
        filasDesdeRespuestaApi,
        validarCatalogo,
        validarFilaDesafio,
        normalizarFaccion,
        leerNombreCartaRecompensa,
        nombresCartasEnCatalogoSet,
        filaCoincideFiltros,
        siguienteIdDesafio,
    };
})();
