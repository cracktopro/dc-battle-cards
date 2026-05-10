// public/js/cartas.js
let _mapaImagenesCatalogoPorNombre = null;

function obtenerClaveCartaImagen(nombreCarta) {
    return String(nombreCarta || '').trim().toLowerCase();
}

function registrarImagenesCatalogoEnMemoria(cartasExcel = []) {
    const mapa = new Map();
    (Array.isArray(cartasExcel) ? cartasExcel : []).forEach(carta => {
        const clave = obtenerClaveCartaImagen(carta?.Nombre);
        if (!clave || mapa.has(clave)) {
            return;
        }
        mapa.set(clave, {
            Imagen: String(carta?.Imagen || carta?.imagen || '').trim(),
            imagen_final: String(carta?.imagen_final || carta?.Imagen_final || '').trim()
        });
    });
    _mapaImagenesCatalogoPorNombre = mapa;
}

function resolverImagenesCartaDesdeCatalogo(carta) {
    const clave = obtenerClaveCartaImagen(carta?.Nombre);
    if (!clave || !_mapaImagenesCatalogoPorNombre?.has(clave)) {
        return null;
    }
    return _mapaImagenesCatalogoPorNombre.get(clave) || null;
}

function obtenerImagenCarta(carta) {
    if (!carta) return 'img/default-image.jpg';

    const nivel = Number(carta.Nivel || 1);
    const imagenesCatalogo = resolverImagenesCartaDesdeCatalogo(carta);
    const imagenBase = (imagenesCatalogo?.Imagen || String(carta.Imagen || carta.imagen || '').trim());
    const imagenFinal = (imagenesCatalogo?.imagen_final || String(carta.imagen_final || carta.Imagen_final || carta.imagenFinal || '').trim());

    if (nivel === 6 && imagenFinal && String(imagenFinal).trim() !== '') {
        return imagenFinal;
    }

    return imagenBase || 'img/default-image.jpg';
}

// opcional: exponer global (por seguridad)
window.obtenerImagenCarta = obtenerImagenCarta;

function normalizarTextoHabilidad(valor) {
    return String(valor || '').trim();
}

const SKILL_CLASSES_ESCALABLES = new Set(['buff', 'debuff', 'heal', 'shield', 'heal_all', 'bonus_buff']);

function normalizarClaseSkill(carta) {
    const claseRaw = String(carta?.skill_class || '').trim().toLowerCase();
    if (claseRaw === 'heall_all') {
        return 'heal_all';
    }
    if (claseRaw === 'life-steal' || claseRaw === 'lifesteal') {
        return 'life_steal';
    }
    return claseRaw;
}

function obtenerNivelCartaSeguro(carta) {
    return Math.max(1, Number(carta?.Nivel || 1));
}

/**
 * Lista de { index, carta } (index en usuario.cartas). Deja una entrada por nombre de carta:
 * la de mayor nivel; si empatan, conserva la de menor índice en la colección.
 */
function deduplicarItemsCartasUsuarioMejorNivel(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }
    const mejorPorClave = new Map();
    items.forEach(item => {
        if (!item || typeof item.index !== 'number' || !item.carta) {
            return;
        }
        const clave = String(item.carta.Nombre || '').trim().toLowerCase();
        if (!clave) {
            return;
        }
        const nivel = obtenerNivelCartaSeguro(item.carta);
        const prev = mejorPorClave.get(clave);
        if (!prev) {
            mejorPorClave.set(clave, item);
            return;
        }
        const nivelPrev = obtenerNivelCartaSeguro(prev.carta);
        if (nivel > nivelPrev || (nivel === nivelPrev && item.index < prev.index)) {
            mejorPorClave.set(clave, item);
        }
    });
    return Array.from(mejorPorClave.values())
        .sort((a, b) => Number(b.carta.Poder || 0) - Number(a.carta.Poder || 0));
}

window.deduplicarItemsCartasUsuarioMejorNivel = deduplicarItemsCartasUsuarioMejorNivel;

function parsearNumeroSeguro(valor) {
    if (typeof valor === 'number' && Number.isFinite(valor)) {
        return valor;
    }
    const texto = String(valor ?? '').trim().replace(',', '.');
    if (!texto) {
        return null;
    }
    const num = Number(texto);
    return Number.isFinite(num) ? num : null;
}

function evaluarFormulaSkillPower(formulaRaw, contexto = {}) {
    const formula = String(formulaRaw || '').trim().toLowerCase();
    if (!formula) {
        return null;
    }

    // Solo permitimos aritmética simple y variables conocidas para evitar expresiones arbitrarias.
    const formulaSegura = formula
        .replace(/saludenemigo/g, String(Number(contexto.saludEnemigo || 0)))
        .replace(/\bsalud\b/g, String(Number(contexto.salud || 0)))
        .replace(/\bpoder\b/g, String(Number(contexto.poder || 0)))
        .replace(/,/g, '.')
        .replace(/\s+/g, '');

    if (!/^[0-9+\-*/().]+$/.test(formulaSegura)) {
        return null;
    }

    try {
        // eslint-disable-next-line no-new-func
        const resultado = Function(`"use strict"; return (${formulaSegura});`)();
        return Number.isFinite(Number(resultado)) ? Number(resultado) : null;
    } catch (_error) {
        return null;
    }
}

function obtenerMetaHabilidadCarta(carta) {
    const triggerRaw = normalizarTextoHabilidad(carta?.skill_trigger).toLowerCase();
    const trigger = triggerRaw === 'usar' ? 'usar' : (triggerRaw === 'auto' ? 'auto' : null);
    const nombre = normalizarTextoHabilidad(carta?.skill_name);
    const info = normalizarTextoHabilidad(carta?.skill_info);
    const claseRaw = normalizarTextoHabilidad(carta?.skill_class).toLowerCase();
    const clase = normalizarClaseSkill({ skill_class: claseRaw });
    const powerRaw = carta?.skill_power;
    const tieneHabilidad = Boolean(trigger && nombre && clase);
    return {
        tieneHabilidad,
        trigger,
        clase,
        nombre,
        info,
        powerRaw
    };
}

function obtenerSkillPowerNumericoCarta(carta, opciones = {}) {
    const clase = normalizarClaseSkill(carta);
    const fallback = Number(opciones.fallback ?? 0);
    const poder = Number(opciones.poder ?? carta?.Poder ?? 0);
    const salud = Number(opciones.salud ?? carta?.Salud ?? carta?.SaludMax ?? poder ?? 0);
    const saludEnemigo = Number(opciones.saludEnemigo ?? 0);
    const bruto = carta?.skill_power;

    // Clases con comportamiento fijo (no escalan por skill_power numérico).
    if (clase === 'revive') {
        return 1;
    }
    if (clase === 'aoe') {
        return Math.max(1, Math.floor(poder / 2));
    }
    if (clase === 'tank') {
        return Math.max(0, Math.round(salud * 2));
    }
    if (clase === 'heal_debuff') {
        if (saludEnemigo > 0) {
            return Math.max(1, Math.floor(saludEnemigo * 0.75));
        }
        return fallback;
    }
    if (clase === 'extra_attack') {
        return Math.max(1, Math.floor(poder));
    }
    if (clase === 'bonus_debuff') {
        return fallback;
    }

    const numeroDirecto = parsearNumeroSeguro(bruto);
    if (numeroDirecto !== null) {
        return numeroDirecto;
    }

    const formulaEvaluada = evaluarFormulaSkillPower(bruto, { poder, salud, saludEnemigo });
    if (formulaEvaluada !== null) {
        return formulaEvaluada;
    }

    return fallback;
}

function formatearSkillPowerParaTexto(valor) {
    const num = Number(valor);
    if (!Number.isFinite(num)) {
        return '0';
    }
    if (Math.abs(num - Math.round(num)) < 0.0001) {
        return String(Math.round(num));
    }
    return String(Math.round(num * 100) / 100);
}

function interpolarSkillInfoConValores(carta, infoTemplate = '', opciones = {}) {
    const texto = String(infoTemplate || '');
    if (!texto) {
        return '';
    }
    if (!/@skill_power/gi.test(texto)) {
        return texto;
    }
    const valorSkill = obtenerSkillPowerNumericoCarta(carta, opciones);
    return texto.replace(/@skill_power/gi, formatearSkillPowerParaTexto(valorSkill));
}

function escaparHtml(texto) {
    return String(texto || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function construirInfoTooltipHabilidadHtml(carta, meta = {}, opciones = {}) {
    const template = String(meta?.info || '');
    if (!template) {
        return 'Sin descripción.';
    }

    const claseSkill = normalizarClaseSkill({ skill_class: meta?.clase || carta?.skill_class || '' });
    const claseColor = CLASE_COLOR_SKILL_POWER_TOOLTIP[claseSkill] || 'tooltip-skill-power--default';
    const valor = formatearSkillPowerParaTexto(obtenerSkillPowerNumericoCarta(carta, opciones));
    const marcador = '___DC_SKILL_POWER___';

    let htmlSeguro = escaparHtml(template).replace(/\r\n|\r|\n/g, '<br>');
    htmlSeguro = htmlSeguro.replace(/@skill_power/gi, marcador);
    htmlSeguro = htmlSeguro.replace(
        new RegExp(marcador, 'g'),
        `<span class="tooltip-skill-power ${claseColor}">${escaparHtml(valor)}</span>`
    );
    return htmlSeguro;
}

function recalcularSkillPowerPorNivel(carta, nivelObjetivo = null, opciones = {}) {
    if (!carta || typeof carta !== 'object') {
        return carta;
    }

    const clase = normalizarClaseSkill(carta);
    if (!SKILL_CLASSES_ESCALABLES.has(clase)) {
        return carta;
    }

    const skillRaw = carta.skill_power;
    const valorActual = parsearNumeroSeguro(skillRaw);
    if (valorActual === null) {
        // Fórmula u otro formato: se respeta y no se toca.
        return carta;
    }

    const nivelActual = obtenerNivelCartaSeguro(carta);
    const nivelFinal = Math.max(1, Number(nivelObjetivo || nivelActual));
    const rawEsBase = Boolean(opciones?.rawEsBase);
    const basePersistida = parsearNumeroSeguro(carta.skill_power_base);
    const baseNivel1 = rawEsBase
        ? (basePersistida !== null
            ? Math.max(0, basePersistida)
            : Math.max(0, valorActual))
        : (basePersistida !== null
            ? Math.max(0, basePersistida)
            : Math.max(0, valorActual / Math.max(1, nivelActual)));
    const escalado = baseNivel1 * nivelFinal;
    carta.skill_power_base = Math.max(0, Math.round(baseNivel1));
    carta.skill_power = Math.max(0, Math.round(escalado));
    return carta;
}

const CLASE_BADGE_POR_SKILL = {
    buff: 'badge-habilidad--buff',
    debuff: 'badge-habilidad--debuff',
    heal: 'badge-habilidad--heal',
    revive: 'badge-habilidad--revive',
    shield: 'badge-habilidad--shield',
    aoe: 'badge-habilidad--aoe',
    heal_all: 'badge-habilidad--heal-all',
    bonus_buff: 'badge-habilidad--bonus-buff',
    bonus_debuff: 'badge-habilidad--bonus-debuff',
    tank: 'badge-habilidad--tank',
    heal_debuff: 'badge-habilidad--heal-debuff',
    extra_attack: 'badge-habilidad--extra-attack',
    stun: 'badge-habilidad--stun',
    life_steal: 'badge-habilidad--life-steal',
    dot: 'badge-habilidad--dot'
};

const CLASE_COLOR_SKILL_POWER_TOOLTIP = {
    buff: 'tooltip-skill-power--buff',
    debuff: 'tooltip-skill-power--debuff',
    heal: 'tooltip-skill-power--heal',
    revive: 'tooltip-skill-power--revive',
    shield: 'tooltip-skill-power--shield',
    aoe: 'tooltip-skill-power--aoe',
    heal_all: 'tooltip-skill-power--heal-all',
    bonus_buff: 'tooltip-skill-power--bonus-buff',
    bonus_debuff: 'tooltip-skill-power--bonus-debuff',
    tank: 'tooltip-skill-power--tank',
    heal_debuff: 'tooltip-skill-power--heal-debuff',
    extra_attack: 'tooltip-skill-power--extra-attack',
    stun: 'tooltip-skill-power--stun',
    life_steal: 'tooltip-skill-power--life-steal',
    dot: 'tooltip-skill-power--dot'
};

let tooltipHabilidadGlobalEl = null;
let tooltipHabilidadRaf = null;

function asegurarListenersCierreTooltipHabilidad() {
    if (window._dcTooltipHabilidadCierreRegistrado) {
        return;
    }
    window._dcTooltipHabilidadCierreRegistrado = true;
    window.addEventListener('scroll', () => ocultarTooltipHabilidadGlobal(), true);
    window.addEventListener('resize', ocultarTooltipHabilidadGlobal);
}

function obtenerTooltipHabilidadGlobal() {
    if (tooltipHabilidadGlobalEl) {
        return tooltipHabilidadGlobalEl;
    }
    asegurarListenersCierreTooltipHabilidad();
    const el = document.createElement('div');
    el.id = 'tooltip-habilidad-carta-global';
    el.className = 'tooltip-habilidad-carta-global';
    el.style.display = 'none';
    el.setAttribute('role', 'tooltip');
    el.innerHTML = `
        <div class="tooltip-habilidad-carta-inner">
            <div class="tooltip-habilidad-carta-nombre"></div>
            <div class="tooltip-habilidad-carta-desc"></div>
        </div>
    `;
    document.body.appendChild(el);
    tooltipHabilidadGlobalEl = el;
    return el;
}

function ocultarTooltipHabilidadGlobal() {
    if (!tooltipHabilidadGlobalEl) {
        return;
    }
    tooltipHabilidadGlobalEl.style.display = 'none';
    if (tooltipHabilidadRaf) {
        cancelAnimationFrame(tooltipHabilidadRaf);
        tooltipHabilidadRaf = null;
    }
}

function posicionarTooltipHabilidadGlobal(clientX, clientY) {
    const el = tooltipHabilidadGlobalEl;
    if (!el || el.style.display === 'none') {
        return;
    }
    const margen = 12;
    const offsetX = 14;
    const offsetY = 18;
    el.style.visibility = 'hidden';
    el.style.display = 'block';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = clientX + offsetX;
    let y = clientY + offsetY;
    if (x + w > window.innerWidth - margen) {
        x = Math.max(margen, window.innerWidth - w - margen);
    }
    if (y + h > window.innerHeight - margen) {
        y = Math.max(margen, clientY - h - offsetY);
    }
    if (x < margen) {
        x = margen;
    }
    if (y < margen) {
        y = margen;
    }
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.visibility = 'visible';
}

function mostrarTooltipHabilidadGlobal(clientX, clientY, meta) {
    const el = obtenerTooltipHabilidadGlobal();
    const nombreLinea = el.querySelector('.tooltip-habilidad-carta-nombre');
    const descLinea = el.querySelector('.tooltip-habilidad-carta-desc');
    const nombre = normalizarTextoHabilidad(meta?.nombre);
    const info = normalizarTextoHabilidad(meta?.info);

    nombreLinea.textContent = nombre ? `${nombre}:` : 'Habilidad:';
    if (meta?.infoHtml) {
        descLinea.innerHTML = String(meta.infoHtml);
    } else {
        descLinea.textContent = info || 'Sin descripción.';
    }

    el.style.display = 'block';
    posicionarTooltipHabilidadGlobal(clientX, clientY);
}

function enlazarTooltipHabilidadABadge(badge, meta) {
    const onEnter = (ev) => {
        mostrarTooltipHabilidadGlobal(ev.clientX, ev.clientY, meta);
    };
    const onMove = (ev) => {
        if (tooltipHabilidadRaf) {
            cancelAnimationFrame(tooltipHabilidadRaf);
        }
        const cx = ev.clientX;
        const cy = ev.clientY;
        tooltipHabilidadRaf = requestAnimationFrame(() => {
            tooltipHabilidadRaf = null;
            posicionarTooltipHabilidadGlobal(cx, cy);
        });
    };
    const onLeave = () => {
        ocultarTooltipHabilidadGlobal();
    };
    badge.addEventListener('mouseenter', onEnter);
    badge.addEventListener('mousemove', onMove);
    badge.addEventListener('mouseleave', onLeave);
}

function crearBadgeHabilidadCarta(carta) {
    const meta = obtenerMetaHabilidadCarta(carta);
    if (!meta.tieneHabilidad) {
        return null;
    }

    const badge = document.createElement('div');
    badge.className = 'badge-habilidad-carta';
    const sub = CLASE_BADGE_POR_SKILL[meta.clase];
    if (sub) {
        badge.classList.add(sub);
    }
    badge.textContent = `${meta.trigger === 'auto' ? 'Pasiva' : 'Activa'}: ${meta.nombre}`;
    badge.removeAttribute('title');
    enlazarTooltipHabilidadABadge(badge, {
        ...meta,
        info: interpolarSkillInfoConValores(carta, meta.info, {
            poder: Number(carta?.Poder || 0),
            salud: Number(carta?.Salud ?? carta?.SaludMax ?? carta?.Poder ?? 0)
        }),
        infoHtml: construirInfoTooltipHabilidadHtml(carta, meta, {
            poder: Number(carta?.Poder || 0),
            salud: Number(carta?.Salud ?? carta?.SaludMax ?? carta?.Poder ?? 0)
        })
    });
    return badge;
}

function obtenerAfiliacionesCarta(carta) {
    const raw = String(carta?.Afiliacion || carta?.afiliacion || '').trim();
    if (!raw) {
        return [];
    }
    return raw
        .split(';')
        .map(item => item.trim())
        .filter(Boolean);
}

function aplicarPrefijoAfiliacionNombreCarta(nombreEl, carta, nombreBase = '') {
    if (!nombreEl) {
        return;
    }
    const nombre = String(nombreBase || carta?.Nombre || '').trim() || 'Carta sin nombre';
    nombreEl.textContent = nombre;

    const afiliaciones = obtenerAfiliacionesCarta(carta);
    if (afiliaciones.length === 0) {
        return;
    }

    const prefijo = document.createElement('span');
    prefijo.className = 'badge-afiliacion-inline';
    prefijo.textContent = 'A';
    prefijo.removeAttribute('title');

    const info = afiliaciones.map(afi => `- ${afi}`).join('\n');
    enlazarTooltipHabilidadABadge(prefijo, {
        nombre: 'Afiliación',
        info
    });

    nombreEl.textContent = '';
    nombreEl.appendChild(prefijo);
    nombreEl.appendChild(document.createTextNode(` ${nombre}`));
}

function crearBadgeAfiliacionCarta(carta) {
    const afiliaciones = obtenerAfiliacionesCarta(carta);
    if (afiliaciones.length === 0) {
        return null;
    }

    const badge = document.createElement('div');
    badge.className = 'badge-afiliacion-carta badge-afiliacion-carta-tablero';
    badge.textContent = 'A';
    badge.removeAttribute('title');

    const info = afiliaciones.map(afi => `- ${afi}`).join('\n');
    enlazarTooltipHabilidadABadge(badge, {
        nombre: 'Afiliación',
        info
    });

    return badge;
}

window.obtenerMetaHabilidadCarta = obtenerMetaHabilidadCarta;
window.crearBadgeHabilidadCarta = crearBadgeHabilidadCarta;
window.aplicarPrefijoAfiliacionNombreCarta = aplicarPrefijoAfiliacionNombreCarta;
window.crearBadgeAfiliacionCarta = crearBadgeAfiliacionCarta;
window.obtenerSkillPowerNumericoCarta = obtenerSkillPowerNumericoCarta;
window.recalcularSkillPowerPorNivel = recalcularSkillPowerPorNivel;
window.interpolarSkillInfoConValores = interpolarSkillInfoConValores;

/** Mezcla skill_* del catálogo Excel en una carta de usuario si faltan en almacenamiento. */
function fusionarSkillDesdeFilaCatalogo(carta, filaCatalogo) {
    if (!carta) {
        return carta;
    }
    if (!filaCatalogo) {
        return carta;
    }
    return {
        ...carta,
        skill_name: String(carta.skill_name || '').trim() || String(filaCatalogo.skill_name || '').trim(),
        skill_info: String(carta.skill_info || '').trim() || String(filaCatalogo.skill_info || '').trim(),
        skill_class: String(carta.skill_class || '').trim().toLowerCase()
            || String(filaCatalogo.skill_class || '').trim().toLowerCase(),
        skill_power: carta.skill_power ?? filaCatalogo.skill_power ?? '',
        skill_power_base: carta.skill_power_base ?? filaCatalogo.skill_power ?? '',
        skill_trigger: String(carta.skill_trigger || '').trim().toLowerCase()
            || String(filaCatalogo.skill_trigger || '').trim().toLowerCase(),
        Imagen: String(filaCatalogo.Imagen || filaCatalogo.imagen || '').trim() || String(carta.Imagen || carta.imagen || '').trim(),
        imagen: String(filaCatalogo.Imagen || filaCatalogo.imagen || '').trim() || String(carta.imagen || carta.Imagen || '').trim(),
        imagen_final: String(filaCatalogo.imagen_final || filaCatalogo.Imagen_final || '').trim() || String(carta.imagen_final || carta.Imagen_final || '').trim()
    };
}

function forzarSkillDesdeFilaCatalogo(carta, filaCatalogo) {
    if (!carta) {
        return carta;
    }
    if (!filaCatalogo) {
        return carta;
    }
    return {
        ...carta,
        skill_name: String(filaCatalogo.skill_name || '').trim(),
        skill_info: String(filaCatalogo.skill_info || '').trim(),
        skill_class: String(filaCatalogo.skill_class || '').trim().toLowerCase(),
        skill_power: filaCatalogo.skill_power ?? '',
        skill_power_base: filaCatalogo.skill_power ?? '',
        skill_trigger: String(filaCatalogo.skill_trigger || '').trim().toLowerCase(),
        Imagen: String(filaCatalogo.Imagen || filaCatalogo.imagen || '').trim(),
        imagen: String(filaCatalogo.Imagen || filaCatalogo.imagen || '').trim(),
        imagen_final: String(filaCatalogo.imagen_final || filaCatalogo.Imagen_final || '').trim()
    };
}

function extraerSkillRowDeCartaExcel(carta) {
    if (!carta) {
        return null;
    }
    return {
        skill_name: String(carta.skill_name || '').trim(),
        skill_info: String(carta.skill_info || '').trim(),
        skill_class: String(carta.skill_class || '').trim().toLowerCase(),
        skill_power: carta.skill_power ?? '',
        skill_power_base: carta.skill_power ?? '',
        skill_trigger: String(carta.skill_trigger || '').trim().toLowerCase()
    };
}

window.fusionarSkillDesdeFilaCatalogo = fusionarSkillDesdeFilaCatalogo;
window.extraerSkillRowDeCartaExcel = extraerSkillRowDeCartaExcel;

let _migracionSkillsUsuarioEnCurso = false;
const VERSION_MIGRACION_SKILLS_USUARIO = 5;

function hashTextoSimple(texto) {
    let hash = 5381;
    const entrada = String(texto || '');
    for (let i = 0; i < entrada.length; i++) {
        hash = ((hash << 5) + hash) + entrada.charCodeAt(i);
        hash = hash >>> 0;
    }
    return hash.toString(16);
}

function construirFirmaCatalogoSkills(cartasExcel = []) {
    const filas = (Array.isArray(cartasExcel) ? cartasExcel : [])
        .map(carta => ({
            nombre: String(carta?.Nombre || '').trim().toLowerCase(),
            skill_name: String(carta?.skill_name || '').trim(),
            skill_info: String(carta?.skill_info || '').trim(),
            skill_class: String(carta?.skill_class || '').trim().toLowerCase(),
            skill_power: String(carta?.skill_power ?? '').trim(),
            skill_power_base: String(carta?.skill_power ?? '').trim(),
            skill_trigger: String(carta?.skill_trigger || '').trim().toLowerCase(),
            imagen: String(carta?.Imagen || carta?.imagen || '').trim(),
            imagen_final: String(carta?.imagen_final || carta?.Imagen_final || '').trim()
        }))
        .filter(fila => Boolean(fila.nombre))
        .sort((a, b) => a.nombre.localeCompare(b.nombre));

    const textoFirma = filas
        .map(fila => [
            fila.nombre,
            fila.skill_name,
            fila.skill_info,
            fila.skill_class,
            fila.skill_power,
            fila.skill_power_base,
            fila.skill_trigger,
            fila.imagen,
            fila.imagen_final
        ].join('||'))
        .join('\n');

    return `skills-v2-${hashTextoSimple(textoFirma)}`;
}

function skillFilaSerializada(carta) {
    return JSON.stringify({
        skill_name: String(carta?.skill_name || '').trim(),
        skill_info: String(carta?.skill_info || '').trim(),
        skill_class: String(carta?.skill_class || '').trim().toLowerCase(),
        skill_power: carta?.skill_power ?? '',
        skill_power_base: carta?.skill_power_base ?? '',
        skill_trigger: String(carta?.skill_trigger || '').trim().toLowerCase(),
        Imagen: String(carta?.Imagen || carta?.imagen || '').trim(),
        imagen_final: String(carta?.imagen_final || carta?.Imagen_final || '').trim()
    });
}

function construirMapaCatalogoPorNombre(cartasExcel = []) {
    const mapa = new Map();
    (Array.isArray(cartasExcel) ? cartasExcel : []).forEach(carta => {
        const clave = String(carta?.Nombre || '').trim().toLowerCase();
        if (!clave || mapa.has(clave)) {
            return;
        }
        mapa.set(clave, carta);
    });
    return mapa;
}

async function cargarCatalogoCartasExcelParaMigracion() {
    const response = await fetch('resources/cartas.xlsx');
    if (!response.ok) {
        throw new Error('No se pudo cargar cartas.xlsx para migración de skills.');
    }
    const data = await response.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const cartasExcel = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    registrarImagenesCatalogoEnMemoria(cartasExcel);
    return cartasExcel;
}

function aplicarMigracionSkillsAColeccion(cartasUsuario, mapaCatalogo) {
    let huboCambios = false;
    const cartasActualizadas = (Array.isArray(cartasUsuario) ? cartasUsuario : []).map(carta => {
        const clave = String(carta?.Nombre || '').trim().toLowerCase();
        const fila = mapaCatalogo.get(clave);
        if (!fila) {
            return carta;
        }
        const antes = skillFilaSerializada(carta);
        const despuesCarta = forzarSkillDesdeFilaCatalogo(carta, fila);
        if (typeof window.recalcularSkillPowerPorNivel === 'function') {
            window.recalcularSkillPowerPorNivel(
                despuesCarta,
                Number(despuesCarta?.Nivel || 1),
                { rawEsBase: true }
            );
        }
        const despues = skillFilaSerializada(despuesCarta);
        if (antes !== despues) {
            huboCambios = true;
        }
        return despuesCarta;
    });
    return { cartasActualizadas, huboCambios };
}

function aplicarMigracionSkillsAMazos(mazosUsuario, mapaCatalogo) {
    let huboCambios = false;
    const mazosActualizados = (Array.isArray(mazosUsuario) ? mazosUsuario : []).map(mazo => {
        const cartasOriginales = Array.isArray(mazo?.Cartas) ? mazo.Cartas : [];
        const { cartasActualizadas, huboCambios: cambioMazo } = aplicarMigracionSkillsAColeccion(cartasOriginales, mapaCatalogo);
        if (cambioMazo) {
            huboCambios = true;
            return { ...mazo, Cartas: cartasActualizadas };
        }
        return mazo;
    });
    return { mazosActualizados, huboCambios };
}

async function persistirMigracionSkillsUsuario(usuario, email) {
    if (!email) {
        return;
    }
    try {
        await fetch('/update-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, email })
        });
    } catch (error) {
        console.warn('No se pudo persistir la migración de skills en backend:', error);
    }
}

async function migrarSkillsUsuarioDesdeCatalogo() {
    if (_migracionSkillsUsuarioEnCurso) {
        return;
    }
    if (typeof XLSX === 'undefined') {
        if (typeof window !== 'undefined' && document?.readyState !== 'complete') {
            window.addEventListener('load', () => {
                void migrarSkillsUsuarioDesdeCatalogo();
            }, { once: true });
        }
        return;
    }
    _migracionSkillsUsuarioEnCurso = true;
    try {
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        const email = localStorage.getItem('email');
        if (!usuario || typeof usuario !== 'object') {
            return;
        }

        const cartasExcel = await cargarCatalogoCartasExcelParaMigracion();
        const versionActual = Number(usuario?.versionMigracionSkills || 0);
        const firmaCatalogoActual = String(usuario?.firmaCatalogoSkills || '');
        const firmaCatalogoNueva = construirFirmaCatalogoSkills(cartasExcel);
        const requiereMigracionPorVersion = versionActual < VERSION_MIGRACION_SKILLS_USUARIO;
        const requiereMigracionPorCatalogo = firmaCatalogoActual !== firmaCatalogoNueva;

        if (!requiereMigracionPorVersion && !requiereMigracionPorCatalogo) {
            return;
        }

        const mapaCatalogo = construirMapaCatalogoPorNombre(cartasExcel);
        const { cartasActualizadas, huboCambios: cambiosColeccion } = aplicarMigracionSkillsAColeccion(usuario.cartas, mapaCatalogo);
        const { mazosActualizados, huboCambios: cambiosMazos } = aplicarMigracionSkillsAMazos(usuario.mazos, mapaCatalogo);

        usuario.cartas = cartasActualizadas;
        usuario.mazos = mazosActualizados;
        usuario.versionMigracionSkills = VERSION_MIGRACION_SKILLS_USUARIO;
        usuario.firmaCatalogoSkills = firmaCatalogoNueva;

        /** Evitar pisar recompensa diaria u objetos si hubo claim entre la lectura inicial y el guardado. */
        const enStorage = JSON.parse(localStorage.getItem('usuario') || 'null');
        if (enStorage && typeof enStorage === 'object') {
            if (enStorage.recompensas && typeof enStorage.recompensas === 'object') {
                usuario.recompensas = { ...(usuario.recompensas || {}), ...enStorage.recompensas };
            }
            if (enStorage.objetos && typeof enStorage.objetos === 'object') {
                usuario.objetos = { ...(usuario.objetos || {}), ...enStorage.objetos };
            }
        }
        aplicarRespaldoClaimLocalUsuario(usuario);
        normalizarObjetosConSobresGlobal(usuario);

        localStorage.setItem('usuario', JSON.stringify(usuario));

        if (cambiosColeccion || cambiosMazos || requiereMigracionPorVersion || requiereMigracionPorCatalogo) {
            await persistirMigracionSkillsUsuario(usuario, email);
        }
    } catch (error) {
        console.warn('Migración de skills omitida:', error);
    } finally {
        _migracionSkillsUsuarioEnCurso = false;
    }
}

function obtenerNombreVisibleSesion() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const email = localStorage.getItem('email') || '';
    const nickname = String(usuario?.nickname || '').trim();
    if (nickname) {
        return nickname;
    }
    return email ? email.split('@')[0] : 'Jugador';
}

function obtenerAvatarSesion() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const avatar = String(usuario?.avatar || '').trim();
    return avatar || 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';
}

function obtenerResumenInventarioSesion() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const puntos = Math.max(0, Number(usuario?.puntos || 0));
    const objetos = (usuario?.objetos && typeof usuario.objetos === 'object') ? usuario.objetos : {};
    const mejoras = Math.max(0, Number(objetos?.mejoraCarta || 0));
    const mejorasEspeciales = Math.max(0, Number(objetos?.mejoraEspecial || 0));
    return { puntos, mejoras, mejorasEspeciales };
}

function obtenerEstadoGrupoSesion() {
    try {
        const estado = JSON.parse(localStorage.getItem('grupoActual') || '{}');
        return (estado && typeof estado === 'object') ? estado : {};
    } catch (_error) {
        return {};
    }
}

const DC_COLOR_ACENTO_DEFAULT = { r: 0, g: 123, b: 255 };

function normalizarCanalColorAcento(valor, fallback = 0) {
    const numero = Number.parseInt(String(valor ?? ''), 10);
    if (!Number.isFinite(numero)) {
        return Math.min(255, Math.max(0, Number.parseInt(String(fallback ?? 0), 10) || 0));
    }
    return Math.min(255, Math.max(0, numero));
}

function obtenerColorPrincipalUsuarioSesion() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const color = usuario?.preferencias?.colorPrincipal;
    if (!color || typeof color !== 'object') {
        return { ...DC_COLOR_ACENTO_DEFAULT };
    }
    return {
        r: normalizarCanalColorAcento(color.r, DC_COLOR_ACENTO_DEFAULT.r),
        g: normalizarCanalColorAcento(color.g, DC_COLOR_ACENTO_DEFAULT.g),
        b: normalizarCanalColorAcento(color.b, DC_COLOR_ACENTO_DEFAULT.b)
    };
}

function aplicarColorPrincipalUsuario(colorRaw) {
    const color = {
        r: normalizarCanalColorAcento(colorRaw?.r, DC_COLOR_ACENTO_DEFAULT.r),
        g: normalizarCanalColorAcento(colorRaw?.g, DC_COLOR_ACENTO_DEFAULT.g),
        b: normalizarCanalColorAcento(colorRaw?.b, DC_COLOR_ACENTO_DEFAULT.b)
    };
    const root = document.documentElement;
    if (!root) {
        return;
    }
    root.style.setProperty('--dc-accent-user-rgb', `${color.r}, ${color.g}, ${color.b}`);
    root.style.setProperty('--dc-accent-user', `rgb(${color.r}, ${color.g}, ${color.b})`);
}

function aplicarColorPrincipalDesdeSesion() {
    aplicarColorPrincipalUsuario(obtenerColorPrincipalUsuarioSesion());
}

window.aplicarColorPrincipalUsuario = aplicarColorPrincipalUsuario;
window.aplicarColorPrincipalDesdeSesion = aplicarColorPrincipalDesdeSesion;

/** Clave de nombre para deduplicar cartas en colección / misiones. */
function dcNormalizarNombreCartaColeccion(nombre) {
    return String(nombre || '').trim().toLowerCase();
}

/**
 * Resuelve facción H/V desde valores típicos del Excel y variantes de texto.
 */
function dcNormalizarFaccionHeroeVillano(valor) {
    const u = String(valor || '').trim().toUpperCase();
    if (u === 'H' || u === 'V') {
        return u;
    }
    const lo = String(valor || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!lo) {
        return '';
    }
    if (lo.includes('vill') || lo.includes('villain')) {
        return 'V';
    }
    if (lo.includes('hero')) {
        return 'H';
    }
    return '';
}

/**
 * Cuenta cartas cuyo nombre no estaba en la colección (solo cuentan como nuevas la primera vez).
 * Usa catálogo opcional si la carta no trae facción explícita (coherente con el resto del juego).
 */
function dcContarCartasNuevasPorFaccion(cartasAAñadir, cartasUsuarioPrevias, catalogoOpcional) {
    const prev = new Set((cartasUsuarioPrevias || []).map((c) => dcNormalizarNombreCartaColeccion(c?.Nombre)));
    const mapaCat = Array.isArray(catalogoOpcional) && catalogoOpcional.length > 0
        ? new Map(catalogoOpcional.map((c) => [dcNormalizarNombreCartaColeccion(c?.Nombre), c]))
        : null;
    let nuevasH = 0;
    let nuevasV = 0;
    (cartasAAñadir || []).forEach((carta) => {
        const clave = dcNormalizarNombreCartaColeccion(carta?.Nombre);
        if (!clave || prev.has(clave)) {
            return;
        }
        let fac = dcNormalizarFaccionHeroeVillano(carta?.faccion ?? carta?.Faccion);
        if (!fac && mapaCat) {
            const base = mapaCat.get(clave);
            if (base) {
                fac = dcNormalizarFaccionHeroeVillano(base.faccion ?? base.Faccion);
            }
        }
        if (fac === 'H') {
            nuevasH++;
        } else if (fac === 'V') {
            nuevasV++;
        }
        prev.add(clave);
    });
    return { nuevasH, nuevasV };
}

window.dcContarCartasNuevasPorFaccion = dcContarCartasNuevasPorFaccion;

function construirFilaStatMenu({ icono, alt, valor, titulo }) {
    return `
        <span class="menu-user-stat-icon-wrap" title="${titulo}">
            <img src="${icono}" alt="${alt}" class="menu-user-stat-icon">
        </span>
        <span class="menu-user-stat-value">${valor}</span>
    `;
}

const RECOMPENSA_DIARIA_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const RECOMPENSA_DIARIA_CHECK_INTERVAL_MS = 60 * 1000;
const RECOMPENSA_DIARIA_LOCK_KEY = 'dc_daily_reward_claim_lock_v1';
/** Respaldo del último claim (evita perder cooldown si otra rutina pisa `usuario` en localStorage). */
const DC_DIARIA_LAST_CLAIM_LS_KEY = 'dc_diaria_last_claim_at_v1';
/** Evita mostrar el modal dos veces en la misma sesión para el mismo claim (p. ej. foco + cambio de vista). */
const RECOMPENSA_DIARIA_MODAL_ACK_KEY = 'dc_daily_reward_modal_ack_claim_ts';
let timerMenuRecompensaDiaria = null;
let timerCheckRecompensaDiaria = null;
let recompensaDiariaEnProceso = false;

function leerUsuarioSesionSeguro() {
    try {
        const raw = JSON.parse(localStorage.getItem('usuario') || 'null');
        return (raw && typeof raw === 'object') ? raw : null;
    } catch (_err) {
        return null;
    }
}

function normalizarObjetosConSobresGlobal(usuario) {
    if (!usuario || typeof usuario !== 'object') return;
    const base = (usuario.objetos && typeof usuario.objetos === 'object') ? { ...usuario.objetos } : {};
    base.mejoraCarta = Number(base.mejoraCarta || 0);
    base.mejoraEspecial = Number(base.mejoraEspecial || 0);
    if (typeof window.DC_SOBRES_MEZCLAR_INVENTARIO === 'function') {
        usuario.objetos = window.DC_SOBRES_MEZCLAR_INVENTARIO(base);
        return;
    }
    usuario.objetos = {
        ...base,
        sobreH1: Number(base.sobreH1 || 0),
        sobreH2: Number(base.sobreH2 || 0),
        sobreH3: Number(base.sobreH3 || 0),
        sobreV1: Number(base.sobreV1 || 0),
        sobreV2: Number(base.sobreV2 || 0),
        sobreV3: Number(base.sobreV3 || 0)
    };
}

function formatearHMSGlobal(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function obtenerTimestampUltimaRecompensaDiaria(usuario) {
    const fromUser = Number(usuario?.recompensas?.diariaSobres?.lastClaimAt || 0);
    const fromLs = Number(localStorage.getItem(DC_DIARIA_LAST_CLAIM_LS_KEY) || 0);
    const v = (t) => (Number.isFinite(t) && t > 0 ? t : 0);
    return Math.max(v(fromUser), v(fromLs));
}

/** Fusiona en memoria el respaldo local si Firebase/`usuario` llegaron sin recompensa diaria (p. ej. tras GET /get-user). */
function aplicarRespaldoClaimLocalUsuario(usuario) {
    if (!usuario || typeof usuario !== 'object') {
        return usuario;
    }
    const claimLs = Number(localStorage.getItem(DC_DIARIA_LAST_CLAIM_LS_KEY) || 0);
    if (!(claimLs > 0)) {
        return usuario;
    }
    const prev = Number(usuario?.recompensas?.diariaSobres?.lastClaimAt || 0);
    usuario.recompensas = (usuario.recompensas && typeof usuario.recompensas === 'object') ? usuario.recompensas : {};
    usuario.recompensas.diariaSobres = {
        ...(usuario.recompensas.diariaSobres || {}),
        lastClaimAt: Math.max(prev, claimLs)
    };
    return usuario;
}

function obtenerEstadoRecompensaDiaria(usuario) {
    const ahora = Date.now();
    const ultimaValida = obtenerTimestampUltimaRecompensaDiaria(usuario || {});
    const siguiente = ultimaValida > 0 ? (ultimaValida + RECOMPENSA_DIARIA_COOLDOWN_MS) : ahora;
    const restante = Math.max(0, siguiente - ahora);
    const progreso = ultimaValida <= 0
        ? 100
        : Math.max(0, Math.min(((RECOMPENSA_DIARIA_COOLDOWN_MS - restante) / RECOMPENSA_DIARIA_COOLDOWN_MS) * 100, 100));
    return {
        disponible: restante <= 0,
        restanteMs: restante,
        progreso,
        siguienteClaimAt: siguiente
    };
}

function renderTimerRecompensaDiariaMenu() {
    const tiempoEl = document.getElementById('menu-recompensa-diaria-tiempo');
    const barEl = document.getElementById('menu-recompensa-diaria-bar');
    const wrapEl = document.getElementById('menu-recompensa-diaria');
    if (!tiempoEl || !barEl || !wrapEl) return;

    const usuario = leerUsuarioSesionSeguro();
    const estado = obtenerEstadoRecompensaDiaria(usuario || {});
    if (estado.disponible) {
        tiempoEl.textContent = 'Recompensa diaria disponible';
        barEl.style.width = '100%';
        wrapEl.classList.add('ready');
        return;
    }
    tiempoEl.textContent = `Siguiente recompensa en: ${formatearHMSGlobal(estado.restanteMs)}`;
    barEl.style.width = `${estado.progreso}%`;
    wrapEl.classList.remove('ready');
}

function crearModalRecompensaDiariaFallback() {
    if (document.getElementById('modal-recompensa-diaria-fallback')) return;
    const modal = document.createElement('div');
    modal.id = 'modal-recompensa-diaria-fallback';
    modal.className = 'modal-dc';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="modal-dc-content">
            <h4>Recompensa diaria recibida</h4>
            <p>Has recibido:</p>
            <div style="display:flex;justify-content:center;gap:18px;flex-wrap:wrap;margin:10px 0 14px;">
                <img src="/resources/hud/sobre_H1.png" alt="Sobre héroe H1" class="coleccion-sobre-imagen" style="width:min(170px,34vw);">
                <img src="/resources/hud/sobre_V1.png" alt="Sobre villano V1" class="coleccion-sobre-imagen" style="width:min(170px,34vw);">
            </div>
            <div class="modal-dc-actions">
                <button id="btn-aceptar-recompensa-diaria-fallback" class="btn btn-primary">Aceptar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function abrirModalRecompensaDiariaGlobal(claimTs) {
    const tsStr = claimTs != null && Number.isFinite(Number(claimTs)) ? String(claimTs) : '';
    if (tsStr && sessionStorage.getItem(RECOMPENSA_DIARIA_MODAL_ACK_KEY) === tsStr) {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const marcarVisto = () => {
            if (tsStr) {
                sessionStorage.setItem(RECOMPENSA_DIARIA_MODAL_ACK_KEY, tsStr);
            }
        };
        const modalPrincipal = document.getElementById('modal-recompensa-diaria');
        const btnPrincipal = document.getElementById('btn-aceptar-recompensa-diaria');
        if (modalPrincipal && btnPrincipal) {
            modalPrincipal.style.display = 'flex';
            const cerrar = () => {
                marcarVisto();
                modalPrincipal.style.display = 'none';
                btnPrincipal.removeEventListener('click', onAceptar);
                resolve();
            };
            const onAceptar = () => cerrar();
            btnPrincipal.addEventListener('click', onAceptar);
            return;
        }

        crearModalRecompensaDiariaFallback();
        const modal = document.getElementById('modal-recompensa-diaria-fallback');
        const btn = document.getElementById('btn-aceptar-recompensa-diaria-fallback');
        if (!modal || !btn) {
            resolve();
            return;
        }
        modal.style.display = 'flex';
        const cerrar = () => {
            marcarVisto();
            modal.style.display = 'none';
            btn.removeEventListener('click', onAceptar);
            resolve();
        };
        const onAceptar = () => cerrar();
        btn.addEventListener('click', onAceptar);
    });
}

function adquirirLockRecompensaDiaria() {
    const ahora = Date.now();
    const lockTs = Number(localStorage.getItem(RECOMPENSA_DIARIA_LOCK_KEY) || 0);
    if (Number.isFinite(lockTs) && lockTs > 0 && (ahora - lockTs) < 15000) {
        return false;
    }
    localStorage.setItem(RECOMPENSA_DIARIA_LOCK_KEY, String(ahora));
    return true;
}

function liberarLockRecompensaDiaria() {
    localStorage.removeItem(RECOMPENSA_DIARIA_LOCK_KEY);
}

async function persistirUsuarioConRecompensaDiaria(usuario) {
    const email = localStorage.getItem('email');
    if (!email) throw new Error('No hay email en sesión');
    const payloadUsuario = {
        objetos: usuario?.objetos || {},
        recompensas: usuario?.recompensas || {}
    };
    const response = await fetch('/update-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: payloadUsuario, email })
    });
    if (!response.ok) {
        throw new Error('No se pudo actualizar usuario en servidor');
    }
    localStorage.setItem('usuario', JSON.stringify(usuario));
    const tsClaim = Number(usuario?.recompensas?.diariaSobres?.lastClaimAt);
    if (Number.isFinite(tsClaim) && tsClaim > 0) {
        localStorage.setItem(DC_DIARIA_LAST_CLAIM_LS_KEY, String(tsClaim));
    }
    window.dispatchEvent(new Event('dc:usuario-actualizado'));
    if (typeof window.DCRedDot?.refresh === 'function') {
        window.DCRedDot.refresh();
    }
}

async function procesarRecompensaDiariaGlobal() {
    if (recompensaDiariaEnProceso) return false;
    if (!adquirirLockRecompensaDiaria()) return false;
    recompensaDiariaEnProceso = true;
    try {
        const usuario = leerUsuarioSesionSeguro();
        if (!usuario) return false;
        normalizarObjetosConSobresGlobal(usuario);
        const estado = obtenerEstadoRecompensaDiaria(usuario);
        if (!estado.disponible) return false;

        usuario.objetos.sobreH1 = Number(usuario.objetos.sobreH1 || 0) + 1;
        usuario.objetos.sobreV1 = Number(usuario.objetos.sobreV1 || 0) + 1;
        usuario.recompensas = (usuario.recompensas && typeof usuario.recompensas === 'object') ? usuario.recompensas : {};
        const claimAt = Date.now();
        usuario.recompensas.diariaSobres = { lastClaimAt: claimAt };

        await persistirUsuarioConRecompensaDiaria(usuario);
        renderTimerRecompensaDiariaMenu();
        await abrirModalRecompensaDiariaGlobal(claimAt);
        return true;
    } catch (error) {
        console.error('Error aplicando recompensa diaria global:', error);
        return false;
    } finally {
        recompensaDiariaEnProceso = false;
        liberarLockRecompensaDiaria();
    }
}

function sincronizarUsuarioConRespaldoClaimDiaria() {
    try {
        const usuario = JSON.parse(localStorage.getItem('usuario') || 'null');
        if (!usuario || typeof usuario !== 'object') {
            return;
        }
        aplicarRespaldoClaimLocalUsuario(usuario);
        const ts = Number(usuario?.recompensas?.diariaSobres?.lastClaimAt || 0);
        if (Number.isFinite(ts) && ts > 0) {
            localStorage.setItem(DC_DIARIA_LAST_CLAIM_LS_KEY, String(ts));
        }
        localStorage.setItem('usuario', JSON.stringify(usuario));
    } catch (_e) {
        /* ignore */
    }
}

function iniciarTimerRecompensaDiariaMenu() {
    if (timerMenuRecompensaDiaria) {
        clearInterval(timerMenuRecompensaDiaria);
    }
    sincronizarUsuarioConRespaldoClaimDiaria();
    renderTimerRecompensaDiariaMenu();
    timerMenuRecompensaDiaria = setInterval(renderTimerRecompensaDiariaMenu, 1000);
}

function iniciarChequeoRecompensaDiariaGlobal() {
    if (timerCheckRecompensaDiaria) {
        clearInterval(timerCheckRecompensaDiaria);
    }
    timerCheckRecompensaDiaria = setInterval(() => {
        void procesarRecompensaDiariaGlobal();
    }, RECOMPENSA_DIARIA_CHECK_INTERVAL_MS);
}

function normalizarMenuLateral() {
    const menu = document.querySelector('.menu-container');
    if (!menu) {
        return;
    }

    const linkCentro = menu.querySelector('a[href="vistaJuego.html"]');
    const linkDesafios = menu.querySelector('a[href="desafios.html"]');
    if (linkCentro) {
        linkCentro.textContent = 'Centro de Operaciones';
    }
    if (linkCentro && linkDesafios && linkDesafios.previousElementSibling !== linkCentro) {
        menu.insertBefore(linkDesafios, linkCentro.nextElementSibling);
    }

    let perfil = document.getElementById('menu-user-profile');
    if (!perfil) {
        perfil = document.createElement('div');
        perfil.id = 'menu-user-profile';
        perfil.className = 'menu-user-profile';
        perfil.innerHTML = `
            <img id="menu-user-avatar" class="menu-user-avatar" alt="Avatar">
            <div id="menu-user-name" class="menu-user-name"></div>
            <div id="menu-group-companion" class="menu-group-companion" style="display:none;">
                <img id="menu-group-avatar" class="menu-group-avatar" alt="Compañero">
                <div id="menu-group-name" class="menu-group-name"></div>
            </div>
            <button id="menu-group-leave-btn" class="btn btn-menu menu-group-leave-btn" type="button" style="display:none;">
                <svg class="menu-group-leave-icon" viewBox="0 0 600 600" aria-hidden="true" focusable="false">
                    <path d="M130 0C58.672245 0 0 58.672245 0 130V470C0 541.32776 58.672245 600 130 600H301.57812C367.83331 600 423.13643 549.36696 430.67188 485H349.43555C343.32179 505.66026 324.7036 520 301.57812 520H130C101.60826 520 80 498.39174 80 470V130C80 101.60826 101.60826 80 130 80H301.57812C324.7036 80 343.32179 94.339739 349.43555 115H430.67188C423.13642 50.633038 367.83331 0 301.57812 0H130Z"></path>
                    <path d="M476.86328 179.99911A40 40 0 0 0 448.57812 191.71395A40 40 0 0 0 448.57812 248.28427L460.29297 259.99911H163.72656A40 40 0 0 0 123.72656 299.99911A40 40 0 0 0 163.72656 339.99911H460.29297L448.57812 351.71395A40 40 0 0 0 448.57812 408.28427A40 40 0 0 0 505.14844 408.28427L577.93945 335.49325A40 40 0 0 0 600 299.99911A40 40 0 0 0 577.5293 264.09481L505.14844 191.71395A40 40 0 0 0 476.86328 179.99911Z"></path>
                </svg>
                <span class="menu-group-leave-text">Dejar grupo</span>
            </button>
            <div id="menu-user-stats" class="menu-user-stats">
                <div class="menu-user-stat-row" id="menu-user-puntos"></div>
                <div class="menu-user-stat-row" id="menu-user-mejoras"></div>
                <div class="menu-user-stat-row" id="menu-user-mejoras-especiales"></div>
            </div>
            <div id="menu-recompensa-diaria" class="menu-recompensa-diaria">
                <div id="menu-recompensa-diaria-tiempo" class="menu-recompensa-diaria-tiempo">Siguiente recompensa en: 00:00:00</div>
                <div class="menu-recompensa-diaria-progress">
                    <div id="menu-recompensa-diaria-bar" class="menu-recompensa-diaria-progress-fill"></div>
                </div>
            </div>
        `;
        menu.insertBefore(perfil, menu.firstChild);
    }

    const avatar = menu.querySelector('#menu-user-avatar');
    const nombre = menu.querySelector('#menu-user-name');
    const puntosEl = menu.querySelector('#menu-user-puntos');
    const mejorasEl = menu.querySelector('#menu-user-mejoras');
    const mejorasEspecialesEl = menu.querySelector('#menu-user-mejoras-especiales');
    const grupoCompanion = menu.querySelector('#menu-group-companion');
    const grupoAvatar = menu.querySelector('#menu-group-avatar');
    const grupoName = menu.querySelector('#menu-group-name');
    const grupoLeaveBtn = menu.querySelector('#menu-group-leave-btn');
    const resumen = obtenerResumenInventarioSesion();
    const grupoEstado = obtenerEstadoGrupoSesion();
    if (avatar) {
        avatar.src = obtenerAvatarSesion();
    }
    if (nombre) {
        nombre.textContent = obtenerNombreVisibleSesion();
    }
    if (puntosEl) {
        puntosEl.innerHTML = construirFilaStatMenu({
            icono: '/resources/icons/moneda.png',
            alt: 'Puntos',
            valor: resumen.puntos,
            titulo: 'Puntos'
        });
    }
    if (mejorasEl) {
        mejorasEl.innerHTML = construirFilaStatMenu({
            icono: '/resources/icons/mejora.png',
            alt: 'Mejora',
            valor: resumen.mejoras,
            titulo: 'Mejoras'
        });
    }
    if (mejorasEspecialesEl) {
        mejorasEspecialesEl.innerHTML = construirFilaStatMenu({
            icono: '/resources/icons/mejora_especial.png',
            alt: 'Mejora especial',
            valor: resumen.mejorasEspeciales,
            titulo: 'Mejoras especiales'
        });
    }
    if (grupoCompanion && grupoAvatar && grupoName) {
        const companion = grupoEstado?.companero;
        const mostrarCompanion = Boolean(grupoEstado?.enGrupo && companion?.email);
        grupoCompanion.style.display = mostrarCompanion ? 'flex' : 'none';
        if (mostrarCompanion) {
            grupoAvatar.src = String(companion?.avatar || '').trim() || 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';
            grupoName.textContent = companion?.nombre || companion?.email || 'Compañero';
        }
    }
    if (grupoLeaveBtn) {
        const enGrupo = Boolean(grupoEstado?.enGrupo);
        grupoLeaveBtn.style.display = enGrupo ? 'inline-flex' : 'none';
        grupoLeaveBtn.onclick = () => {
            if (typeof window.confirmarAbandonoGrupo === 'function') {
                window.confirmarAbandonoGrupo().then(confirmado => {
                    if (confirmado && typeof window.abandonarGrupoActual === 'function') {
                        window.abandonarGrupoActual();
                    }
                });
                return;
            }
            if (typeof window.abandonarGrupoActual === 'function') {
                window.abandonarGrupoActual();
            }
        };
    }
    renderTimerRecompensaDiariaMenu();

    let linkMultijugador = menu.querySelector('#menu-link-multijugador');
    if (!linkMultijugador) {
        linkMultijugador = document.createElement('a');
        linkMultijugador.id = 'menu-link-multijugador';
        linkMultijugador.href = 'multijugador.html';
        linkMultijugador.className = 'btn btn-menu btn-menu-disabled';
        linkMultijugador.textContent = 'Multijugador';
        if (linkDesafios?.nextElementSibling) {
            menu.insertBefore(linkMultijugador, linkDesafios.nextElementSibling);
        } else {
            menu.appendChild(linkMultijugador);
        }
    }
    const multijugadorHabilitado = Boolean(grupoEstado?.enGrupo && grupoEstado?.puedeMultijugador);
    linkMultijugador.classList.toggle('btn-menu-disabled', !multijugadorHabilitado);
    linkMultijugador.setAttribute('aria-disabled', multijugadorHabilitado ? 'false' : 'true');
    linkMultijugador.tabIndex = multijugadorHabilitado ? 0 : -1;
    if (!multijugadorHabilitado) {
        linkMultijugador.title = 'Debes estar en un grupo para habilitar Multijugador';
        linkMultijugador.addEventListener('click', bloquearNavegacionMultijugador);
    } else {
        linkMultijugador.title = 'Acceder a sala multijugador';
        linkMultijugador.removeEventListener('click', bloquearNavegacionMultijugador);
    }

    const versionLabelTexto = 'Version: Beta-1.0.13-08.05.26';
    let versionLabel = menu.querySelector('#menu-version-label');
    if (!versionLabel) {
        versionLabel = document.createElement('div');
        versionLabel.id = 'menu-version-label';
        versionLabel.className = 'menu-version-label';
    }
    versionLabel.textContent = versionLabelTexto;
    const botonLogout = menu.querySelector('.btn-logout');
    if (botonLogout) {
        botonLogout.insertAdjacentElement('afterend', versionLabel);
    } else if (!versionLabel.parentElement) {
        menu.appendChild(versionLabel);
    }
}

function actualizarPanelPerfilTiempoReal() {
    normalizarMenuLateral();
}

window.actualizarPanelPerfilTiempoReal = actualizarPanelPerfilTiempoReal;
window.DCRecompensaDiaria = {
    procesar: procesarRecompensaDiariaGlobal,
    renderTimerMenu: renderTimerRecompensaDiariaMenu,
    obtenerEstado: () => obtenerEstadoRecompensaDiaria(leerUsuarioSesionSeguro() || {}),
    aplicarRespaldoClaimLocalUsuario
};

function asegurarModalLogout() {
    if (document.getElementById('logout-confirm-modal')) {
        return;
    }
    const modal = document.createElement('div');
    modal.id = 'logout-confirm-modal';
    modal.className = 'modal-dc';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="modal-dc-content">
            <h4>¿Desconectarse de DC Battle Cards?</h4>
            <div class="modal-dc-actions">
                <button id="logout-confirm-accept" class="btn btn-danger">Aceptar</button>
                <button id="logout-confirm-cancel" class="btn btn-secondary">Cancelar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('logout-confirm-cancel')?.addEventListener('click', cerrarModalLogout);
    document.getElementById('logout-confirm-accept')?.addEventListener('click', confirmarLogoutSistema);
}

function abrirModalLogout() {
    asegurarModalLogout();
    const modal = document.getElementById('logout-confirm-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function cerrarModalLogout() {
    const modal = document.getElementById('logout-confirm-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function confirmarLogoutSistema() {
    localStorage.removeItem('usuario');
    localStorage.removeItem(DC_DIARIA_LAST_CLAIM_LS_KEY);
    localStorage.removeItem('email');
    localStorage.removeItem('grupoActual');
    localStorage.removeItem('grupoInvitacionEnCurso');
    localStorage.removeItem('jugandoPartida');
    localStorage.removeItem('mazoJugador');
    localStorage.removeItem('mazoOponente');
    localStorage.removeItem('nombreOponente');
    window.location.href = '/login.html';
}

window.abrirModalLogout = abrirModalLogout;
window.cerrarModalLogout = cerrarModalLogout;
window.confirmarLogoutSistema = confirmarLogoutSistema;

document.addEventListener('DOMContentLoaded', async () => {
    aplicarColorPrincipalDesdeSesion();
    normalizarMenuLateral();
    asegurarModalLogout();
    await migrarSkillsUsuarioDesdeCatalogo();
    iniciarTimerRecompensaDiariaMenu();
    iniciarChequeoRecompensaDiariaGlobal();
    void procesarRecompensaDiariaGlobal();
});

window.addEventListener('dc:usuario-actualizado', () => {
    aplicarColorPrincipalDesdeSesion();
    actualizarPanelPerfilTiempoReal();
    renderTimerRecompensaDiariaMenu();
});

window.addEventListener('dc:grupo-actualizado', () => {
    actualizarPanelPerfilTiempoReal();
});

window.addEventListener('focus', () => {
    renderTimerRecompensaDiariaMenu();
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        renderTimerRecompensaDiariaMenu();
    }
});

function bloquearNavegacionMultijugador(event) {
    event.preventDefault();
}