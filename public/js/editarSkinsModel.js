/**
 * Modelo y validación de skins.xlsx (editor editarSkins).
 */
(function () {
    'use strict';

    const COLUMNAS_SKINS = [
        'skin_id', 'parent', 'Nombre', 'Salud', 'Poder', 'Imagen', 'Afiliacion',
        'skill_name', 'skill_info', 'skill_class', 'skill_power', 'skill_trigger',
    ];

    const ORDEN_SKILL_CLASS = [
        'aoe', 'extra_attack', 'buff', 'bonus_buff', 'debuff', 'bonus_debuff',
        'heal_debuff', 'revive', 'heal', 'heal_all', 'life_steal', 'shield',
        'shield_aoe', 'tank', 'stun', 'dot',
    ];

    const ETIQUETAS_SKILL_CLASS = {
        aoe: 'Daño en area', extra_attack: 'Ataque extra',
        buff: 'Aumento de poder', bonus_buff: 'Bonus de afiliación aumentado',
        debuff: 'Reducción de poder enemigo', bonus_debuff: 'Anula bonus de afiliación enemigo',
        heal_debuff: 'Reduce salud de los enemigos', revive: 'Revive un aliado',
        heal: 'Cura a un aliado', heal_all: 'Cura en area', life_steal: 'Robo de vida',
        shield: 'Aplicar escudo', shield_aoe: 'Aplicar escudo en area',
        tank: 'Tanque', stun: 'Incapacitar enemigo', dot: 'Daño sostenido',
    };

    const SKILL_TRIGGER_OPCIONES = [
        { value: '', label: '— (sin habilidad)' },
        { value: 'usar', label: 'Activa' },
        { value: 'auto', label: 'Pasiva' },
    ];

    function normalizarClaseSkillEditor(valor) {
        const raw = String(valor || '').trim().toLowerCase();
        if (raw === 'heall_all') return 'heal_all';
        if (raw === 'life-steal' || raw === 'lifesteal') return 'life_steal';
        return raw;
    }

    function crearFilaSkinVacia() {
        const fila = {};
        COLUMNAS_SKINS.forEach((col) => { fila[col] = ''; });
        fila.skin_id = 0;
        fila.Salud = 0;
        fila.Poder = 0;
        fila.skill_power = 0;
        return fila;
    }

    function asegurarFilaSkin(fila, columnasOrden) {
        const out = {};
        const cols = columnasOrden || COLUMNAS_SKINS;
        cols.forEach((col) => {
            let v = fila && Object.prototype.hasOwnProperty.call(fila, col) ? fila[col] : '';
            if (['skin_id','Salud','Poder','skill_power'].includes(col)) {
                const n = Number(v); v = Number.isFinite(n) ? n : 0;
            } else if (col === 'skill_trigger') {
                v = String(v || '').trim().toLowerCase();
                if (v !== 'usar' && v !== 'auto') v = '';
            } else if (v === null || v === undefined) { v = ''; }
            else if (typeof v !== 'string') { v = String(v); }
            out[col] = v;
        });
        return out;
    }

    function filasDesdeRespuestaApi(data) {
        const columnas = Array.isArray(data?.columnas) ? data.columnas : COLUMNAS_SKINS;
        const filas = Array.isArray(data?.filas) ? data.filas : [];
        return { columnas, filas: filas.map((f) => asegurarFilaSkin(f, columnas)) };
    }

    function validarFilaSkin(fila, indice, todasLasFilas, nombresCartasCatalogo) {
        const errores = [];
        const idx = indice + 1;
        const id = Number(fila.skin_id);
        if (!Number.isFinite(id)) {
            errores.push(`Fila ${idx}: skin_id inválido.`);
        } else if (Array.isArray(todasLasFilas)) {
            const dup = todasLasFilas.filter((f, i) => i !== indice && Number(f.skin_id) === id);
            if (dup.length) errores.push(`Fila ${idx}: skin_id duplicado (${id}).`);
        }
        if (!String(fila.Nombre || '').trim()) errores.push(`Fila ${idx}: falta Nombre.`);
        const parent = String(fila.parent || '').trim();
        if (!parent) {
            errores.push(`Fila ${idx}: falta parent.`);
        } else if (nombresCartasCatalogo && nombresCartasCatalogo.size && !nombresCartasCatalogo.has(parent.toLowerCase())) {
            errores.push(`Fila ${idx}: parent «${parent}» no está en cartas.xlsx.`);
        }
        if (fila.skill_trigger && !['usar','auto'].includes(fila.skill_trigger)) {
            errores.push(`Fila ${idx}: skill_trigger debe ser «usar» o «auto».`);
        }
        return errores;
    }

    function validarCatalogo(filas, filasCatalogoCartas) {
        const nombresSet = new Set((filasCatalogoCartas || []).map((f) => String(f.Nombre || '').trim().toLowerCase()).filter(Boolean));
        const errores = [];
        (filas || []).forEach((fila, i) => errores.push(...validarFilaSkin(fila, i, filas, nombresSet)));
        return { ok: errores.length === 0, errores };
    }

    function filaCoincideFiltros(fila, filtros) {
        const q = String(filtros?.nombre || '').trim().toLowerCase();
        if (q && !String(fila.Nombre || '').toLowerCase().includes(q)
            && !String(fila.parent || '').toLowerCase().includes(q)) return false;
        const parent = String(filtros?.parent || '').trim().toLowerCase();
        if (parent && String(fila.parent || '').trim().toLowerCase() !== parent) return false;
        return true;
    }

    function siguienteId(filas) {
        let max = -1;
        (filas || []).forEach((f) => { const id = Number(f.skin_id); if (Number.isFinite(id) && id > max) max = id; });
        return max + 1;
    }

    window.DCEditarSkinsModel = {
        COLUMNAS_SKINS, ORDEN_SKILL_CLASS, ETIQUETAS_SKILL_CLASS, SKILL_TRIGGER_OPCIONES,
        normalizarClaseSkillEditor,
        crearFilaSkinVacia, asegurarFilaSkin, filasDesdeRespuestaApi,
        validarCatalogo, validarFilaSkin, filaCoincideFiltros, siguienteId,
    };
})();
