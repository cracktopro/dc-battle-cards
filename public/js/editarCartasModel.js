/**
 * Modelo y validación del catálogo cartas.xlsx (editor editarCartas).
 */
(function () {
    'use strict';

    const COLUMNAS_CARTAS = [
        'Nombre', 'Nivel', 'Salud', 'Poder', 'Tipo', 'Imagen', 'faccion', 'Afiliacion',
        'imagen_final', 'skill_name', 'skill_info', 'skill_class', 'skill_power', 'skill_trigger',
    ];

    const TIPOS_CARTA = ['Meta', 'Tecnología', 'Magia'];
    const FACCIONES = ['H', 'V'];

    const ORDEN_SKILL_CLASS = [
        'aoe', 'extra_attack', 'buff', 'bonus_buff', 'debuff', 'bonus_debuff',
        'heal_debuff', 'revive', 'heal', 'heal_all', 'life_steal', 'shield',
        'shield_aoe', 'tank', 'stun', 'dot',
    ];

    const ETIQUETAS_SKILL_CLASS = {
        aoe: 'Daño en area',
        extra_attack: 'Ataque extra',
        buff: 'Aumento de poder',
        bonus_buff: 'Bonus de afiliación aumentado',
        debuff: 'Reducción de poder enemigo',
        bonus_debuff: 'Anula bonus de afiliación enemigo',
        heal_debuff: 'Reduce salud de los enemigos',
        revive: 'Revive un aliado',
        heal: 'Cura a un aliado',
        heal_all: 'Cura en area',
        life_steal: 'Robo de vida',
        shield: 'Aplicar escudo',
        shield_aoe: 'Aplicar escudo en area',
        tank: 'Tanque',
        stun: 'Incapacitar enemigo',
        dot: 'Daño sostenido',
    };

    const SKILL_TRIGGER_OPCIONES = [
        { value: '', label: '— (sin habilidad)' },
        { value: 'usar', label: 'Activa' },
        { value: 'auto', label: 'Pasiva' },
    ];

    const COLUMNAS_SKILL = ['skill_name', 'skill_info', 'skill_class', 'skill_power', 'skill_trigger'];
    const COLUMNAS_IMAGEN = ['Imagen', 'imagen_final'];

    function normalizarClaseSkillEditor(valor) {
        const raw = String(valor || '').trim().toLowerCase();
        if (raw === 'heall_all') return 'heal_all';
        if (raw === 'life-steal' || raw === 'lifesteal') return 'life_steal';
        return raw;
    }

    function crearFilaCartaVacia() {
        const fila = {};
        COLUMNAS_CARTAS.forEach((col) => { fila[col] = ''; });
        fila.Nivel = 1;
        fila.Salud = 0;
        fila.Poder = 0;
        return fila;
    }

    function asegurarColumnasFila(fila, columnasOrden) {
        const out = {};
        const cols = columnasOrden || COLUMNAS_CARTAS;
        cols.forEach((col) => {
            out[col] = fila && Object.prototype.hasOwnProperty.call(fila, col) ? fila[col] : '';
        });
        if (out.Nivel === '' || out.Nivel === null || out.Nivel === undefined) {
            out.Nivel = 1;
        }
        return out;
    }

    function filasDesdeRespuestaApi(data) {
        const columnas = Array.isArray(data?.columnas) ? data.columnas : COLUMNAS_CARTAS;
        const filas = Array.isArray(data?.filas) ? data.filas : [];
        return {
            columnas,
            filas: filas.map((f) => asegurarColumnasFila(f, columnas)),
        };
    }

    function tieneHabilidad(fila) {
        return Boolean(
            String(fila?.skill_name || '').trim()
            || String(fila?.skill_class || '').trim()
            || String(fila?.skill_trigger || '').trim()
        );
    }

    function validarFilaCarta(fila, indice, todasLasFilas) {
        const errores = [];
        const idx = indice + 1;
        const nombre = String(fila?.Nombre || '').trim();
        if (!nombre) {
            errores.push(`Fila ${idx}: falta Nombre.`);
        }

        const nivel = Number(fila.Nivel);
        if (!Number.isFinite(nivel) || nivel < 1 || nivel > 8) {
            errores.push(`Fila ${idx} (${nombre || '?'}): Nivel debe ser 1–8.`);
        }

        const salud = Number(fila.Salud);
        if (!Number.isFinite(salud) || salud < 0) {
            errores.push(`Fila ${idx} (${nombre || '?'}): Salud inválida.`);
        }

        const poder = Number(fila.Poder);
        if (!Number.isFinite(poder) || poder < 0) {
            errores.push(`Fila ${idx} (${nombre || '?'}): Poder inválido.`);
        }

        const tipo = String(fila.Tipo || '').trim();
        if (tipo && !TIPOS_CARTA.includes(tipo)) {
            errores.push(`Fila ${idx} (${nombre || '?'}): Tipo debe ser Meta, Tecnología o Magia.`);
        }

        const fac = String(fila.faccion || '').trim().toUpperCase();
        if (fac && !FACCIONES.includes(fac)) {
            errores.push(`Fila ${idx} (${nombre || '?'}): faccion debe ser H o V.`);
        }

        if (tieneHabilidad(fila)) {
            const sn = String(fila.skill_name || '').trim();
            if (!sn) {
                errores.push(`Fila ${idx} (${nombre || '?'}): con habilidad, skill_name es obligatorio.`);
            }
            const clase = normalizarClaseSkillEditor(fila.skill_class);
            if (!clase || !ORDEN_SKILL_CLASS.includes(clase)) {
                errores.push(`Fila ${idx} (${nombre || '?'}): skill_class no válida.`);
            }
            const trig = String(fila.skill_trigger || '').trim().toLowerCase();
            if (trig !== 'usar' && trig !== 'auto') {
                errores.push(`Fila ${idx} (${nombre || '?'}): skill_trigger debe ser Activa (usar) o Pasiva (auto).`);
            }
        } else if (String(fila.skill_name || '').trim()) {
            errores.push(`Fila ${idx} (${nombre || '?'}): complete skill_class y skill_trigger o vacíe la habilidad.`);
        }

        if (nombre && Array.isArray(todasLasFilas)) {
            const dup = todasLasFilas.filter((f, i) => i !== indice && String(f?.Nombre || '').trim().toLowerCase() === nombre.toLowerCase());
            if (dup.length) {
                errores.push(`Fila ${idx}: nombre duplicado «${nombre}».`);
            }
        }

        return errores;
    }

    function validarCatalogo(filas) {
        const errores = [];
        (filas || []).forEach((fila, i) => {
            errores.push(...validarFilaCarta(fila, i, filas));
        });
        return { ok: errores.length === 0, errores };
    }

    function obtenerAfiliacionesUnicas(filas) {
        const set = new Set();
        (filas || []).forEach((f) => {
            const raw = String(f.Afiliacion || '').trim();
            if (!raw) return;
            raw.split(';').map((s) => s.trim()).filter(Boolean).forEach((a) => set.add(a));
        });
        return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }

    function filaCoincideFiltros(fila, filtros) {
        const qNombre = String(filtros?.nombre || '').trim().toLowerCase();
        if (qNombre && !String(fila.Nombre || '').toLowerCase().includes(qNombre)) {
            return false;
        }
        const afi = String(filtros?.afiliacion || 'todas').trim();
        if (afi && afi !== 'todas') {
            const lista = String(fila.Afiliacion || '').split(';').map((s) => s.trim().toLowerCase());
            if (!lista.includes(afi.toLowerCase())) return false;
        }
        const fac = String(filtros?.faccion || 'todas').trim().toUpperCase();
        if (fac && fac !== 'TODAS' && String(fila.faccion || '').trim().toUpperCase() !== fac) {
            return false;
        }
        const skillF = String(filtros?.skillClass || 'todas').trim().toLowerCase();
        if (skillF && skillF !== 'todas') {
            if (normalizarClaseSkillEditor(fila.skill_class) !== skillF) return false;
        }
        return true;
    }

    window.DCEditarCartasModel = {
        COLUMNAS_CARTAS,
        TIPOS_CARTA,
        FACCIONES,
        ORDEN_SKILL_CLASS,
        ETIQUETAS_SKILL_CLASS,
        SKILL_TRIGGER_OPCIONES,
        COLUMNAS_SKILL,
        COLUMNAS_IMAGEN,
        crearFilaCartaVacia,
        asegurarColumnasFila,
        filasDesdeRespuestaApi,
        validarFilaCarta,
        validarCatalogo,
        normalizarClaseSkillEditor,
        obtenerAfiliacionesUnicas,
        filaCoincideFiltros,
        tieneHabilidad,
    };
})();
