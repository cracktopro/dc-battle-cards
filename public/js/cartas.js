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
    const nombreClave = (typeof window !== 'undefined' && window.DCSkinsCartas?.obtenerNombreParentCarta)
        ? window.DCSkinsCartas.obtenerNombreParentCarta(carta)
        : carta?.Nombre;
    const clave = obtenerClaveCartaImagen(nombreClave);
    if (!clave || !_mapaImagenesCatalogoPorNombre?.has(clave)) {
        return null;
    }
    return _mapaImagenesCatalogoPorNombre.get(clave) || null;
}

function cartaMuestraImagenFinal(nivel) {
    return Number(nivel || 1) >= 6;
}

function obtenerImagenCarta(carta) {
    if (!carta) return 'img/default-image.jpg';

    const nivel = Number(carta.Nivel || 1);
    const tieneSkinActivo = carta.skinActivoId !== null && carta.skinActivoId !== undefined;
    if (tieneSkinActivo) {
        const imagenFinalSkin = String(carta.imagen_final || carta.Imagen_final || carta.imagenFinal || '').trim();
        if (cartaMuestraImagenFinal(nivel) && imagenFinalSkin) {
            return imagenFinalSkin;
        }
        const imagenSkin = String(carta.Imagen || carta.imagen || '').trim();
        if (imagenSkin) {
            return imagenSkin;
        }
    }

    const imagenesCatalogo = resolverImagenesCartaDesdeCatalogo(carta);
    const imagenBase = (imagenesCatalogo?.Imagen || String(carta.Imagen || carta.imagen || '').trim());
    const imagenFinal = (imagenesCatalogo?.imagen_final || String(carta.imagen_final || carta.Imagen_final || carta.imagenFinal || '').trim());

    if (cartaMuestraImagenFinal(nivel) && imagenFinal && String(imagenFinal).trim() !== '') {
        return imagenFinal;
    }

    return imagenBase || 'img/default-image.jpg';
}

// opcional: exponer global (por seguridad)
window.obtenerImagenCarta = obtenerImagenCarta;
window.cartaMuestraImagenFinal = cartaMuestraImagenFinal;

const DC_NIVEL_MIN_CARTA_HOLO = 8;

/** Reloj global: nuevas capas holo entran en la misma fase (evita saltos al re-renderizar). */
const DC_HOLO_ANIM = {
    scrollMs: 5500,
    vivoMs: 1600,
    vivoSecundariaOffsetMs: 800,
};
const DC_HOLO_EPOCH_MS = typeof performance !== 'undefined' ? performance.now() : 0;

function holoAnimacionesReducidas() {
    return typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function calcularRetrasosAnimacionHoloTextura(vivoOffsetExtraMs = 0) {
    const t = performance.now() - DC_HOLO_EPOCH_MS;
    const scrollDelay = -(((t % DC_HOLO_ANIM.scrollMs) + DC_HOLO_ANIM.scrollMs) % DC_HOLO_ANIM.scrollMs);
    const vivoT = t + vivoOffsetExtraMs;
    const vivoDelay = -(((vivoT % DC_HOLO_ANIM.vivoMs) + DC_HOLO_ANIM.vivoMs) % DC_HOLO_ANIM.vivoMs);
    return { scrollDelay, vivoDelay };
}

function sincronizarAnimacionesHoloTextura(texturaEl, vivoOffsetExtraMs = 0) {
    if (!texturaEl || holoAnimacionesReducidas()) {
        return;
    }
    const { scrollDelay, vivoDelay } = calcularRetrasosAnimacionHoloTextura(vivoOffsetExtraMs);
    texturaEl.style.animationDelay = `${scrollDelay}ms, ${vivoDelay}ms`;
}

function sincronizarAnimacionesHoloCapa(holoEl) {
    if (!holoEl) {
        return;
    }
    sincronizarAnimacionesHoloTextura(holoEl.querySelector('.carta-holo__textura--primaria'), 0);
    sincronizarAnimacionesHoloTextura(
        holoEl.querySelector('.carta-holo__textura--secundaria'),
        DC_HOLO_ANIM.vivoSecundariaOffsetMs
    );
}

function cartaDebeMostrarEfectoHolo(carta) {
    return Number(carta?.Nivel || 1) >= DC_NIVEL_MIN_CARTA_HOLO;
}

function quitarCapasHoloDeCarta(cartaDiv) {
    if (!cartaDiv) {
        return;
    }
    cartaDiv.querySelectorAll(':scope > .carta-fondo, :scope > .carta-holo').forEach((nodo) => nodo.remove());
    cartaDiv.classList.remove('carta--con-holo');
    delete cartaDiv.dataset.dcHoloActivo;
    delete cartaDiv.dataset.dcHoloModo;
    delete cartaDiv.dataset.dcHoloImagen;
}

function crearCapaHoloElemento() {
    const holo = document.createElement('div');
    holo.className = 'carta-holo';
    holo.setAttribute('aria-hidden', 'true');

    const texturaPrimaria = document.createElement('div');
    texturaPrimaria.className = 'carta-holo__textura carta-holo__textura--primaria';
    const texturaSecundaria = document.createElement('div');
    texturaSecundaria.className = 'carta-holo__textura carta-holo__textura--secundaria';

    holo.appendChild(texturaPrimaria);
    holo.appendChild(texturaSecundaria);
    sincronizarAnimacionesHoloCapa(holo);
    return holo;
}

/** Colección: arte en .carta-fondo (filtro sin afectar texto/UI). */
function insertarCapasArteYHoloEnCarta(cartaDiv, imagenUrl) {
    const fondo = document.createElement('div');
    fondo.className = 'carta-fondo';
    fondo.style.backgroundImage = `url(${imagenUrl})`;
    fondo.setAttribute('aria-hidden', 'true');

    cartaDiv.insertBefore(crearCapaHoloElemento(), cartaDiv.firstChild);
    cartaDiv.insertBefore(fondo, cartaDiv.firstChild);
}

/** Resto de vistas: overlay holo sin quitar background-image del contenedor. */
function insertarCapaHoloEnCarta(cartaDiv) {
    if (cartaDiv.querySelector(':scope > .carta-holo')) {
        return;
    }
    cartaDiv.insertBefore(crearCapaHoloElemento(), cartaDiv.firstChild);
}

/**
 * Imagen + holo nivel 8.
 * Por defecto conserva la maquetación existente (background en el mismo nodo).
 * modoColeccion: capa .carta-fondo + holo (solo vista colección).
 */
function aplicarImagenFondoCarta(cartaDiv, carta, opciones = {}) {
    if (!cartaDiv) {
        return;
    }
    const imagenUrl = opciones.imagenUrl
        || (typeof obtenerImagenCarta === 'function' ? obtenerImagenCarta(carta) : 'img/default-image.jpg');
    const modoColeccion = Boolean(opciones.modoColeccion);
    const mostrarHolo = cartaDebeMostrarEfectoHolo(carta);
    const modoClave = modoColeccion ? 'coleccion' : 'overlay';
    const urlFondo = `url(${imagenUrl})`;

    const holoExistente = cartaDiv.querySelector(':scope > .carta-holo');
    const fondoExistente = cartaDiv.querySelector(':scope > .carta-fondo');
    const holoActivoPrev = cartaDiv.dataset.dcHoloActivo === '1';
    const modoPrev = cartaDiv.dataset.dcHoloModo || '';
    const estructuraHoloIntacta = Boolean(mostrarHolo && holoExistente && holoActivoPrev && modoPrev === modoClave
        && ((modoColeccion && fondoExistente) || (!modoColeccion && !fondoExistente)));

    if (estructuraHoloIntacta) {
        if (modoColeccion) {
            if (fondoExistente.style.backgroundImage !== urlFondo) {
                fondoExistente.style.backgroundImage = urlFondo;
            }
            cartaDiv.style.backgroundImage = '';
        } else {
            if (cartaDiv.style.backgroundImage !== urlFondo) {
                cartaDiv.style.backgroundImage = urlFondo;
                cartaDiv.style.backgroundSize = 'cover';
                cartaDiv.style.backgroundPosition = 'center top';
            }
        }
        cartaDiv.classList.add('carta--con-holo');
        cartaDiv.dataset.dcHoloActivo = '1';
        cartaDiv.dataset.dcHoloModo = modoClave;
        cartaDiv.dataset.dcHoloImagen = imagenUrl;
        return;
    }

    if (!mostrarHolo && !holoExistente && !fondoExistente && cartaDiv.dataset.dcHoloImagen === imagenUrl
        && cartaDiv.style.backgroundImage === urlFondo) {
        return;
    }

    quitarCapasHoloDeCarta(cartaDiv);

    if (mostrarHolo && modoColeccion) {
        cartaDiv.classList.add('carta--con-holo');
        cartaDiv.style.backgroundImage = '';
        cartaDiv.style.backgroundSize = '';
        cartaDiv.style.backgroundPosition = '';
        insertarCapasArteYHoloEnCarta(cartaDiv, imagenUrl);
        cartaDiv.dataset.dcHoloActivo = '1';
        cartaDiv.dataset.dcHoloModo = modoClave;
        cartaDiv.dataset.dcHoloImagen = imagenUrl;
        return;
    }

    cartaDiv.style.backgroundImage = urlFondo;
    cartaDiv.style.backgroundSize = 'cover';
    cartaDiv.style.backgroundPosition = 'center top';

    if (mostrarHolo) {
        cartaDiv.classList.add('carta--con-holo');
        insertarCapaHoloEnCarta(cartaDiv);
        cartaDiv.dataset.dcHoloActivo = '1';
        cartaDiv.dataset.dcHoloModo = modoClave;
    } else {
        cartaDiv.dataset.dcHoloActivo = '0';
        cartaDiv.dataset.dcHoloModo = '';
    }
    cartaDiv.dataset.dcHoloImagen = imagenUrl;
}

function asegurarCssCartaHoloCargado() {
    if (typeof document === 'undefined' || document.querySelector('link[data-dc-carta-holo-css]')) {
        return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/carta-holo.css';
    link.dataset.dcCartaHoloCss = '1';
    document.head.appendChild(link);
}

window.DC_NIVEL_MIN_CARTA_HOLO = DC_NIVEL_MIN_CARTA_HOLO;
window.cartaDebeMostrarEfectoHolo = cartaDebeMostrarEfectoHolo;
window.aplicarImagenFondoCarta = aplicarImagenFondoCarta;
window.quitarCapasHoloDeCarta = quitarCapasHoloDeCarta;

asegurarCssCartaHoloCargado();

function normalizarTextoHabilidad(valor) {
    return String(valor || '').trim();
}

const SKILL_CLASSES_ESCALABLES = new Set(['buff', 'debuff', 'heal', 'shield', 'heal_all', 'shield_aoe', 'bonus_buff']);

/** Pasivas de mesa: el valor de la habilidad no usa poder/salud con buffs de combate ajenos ni propios. */
const SKILL_CLASSES_CONTEXTO_BASE = new Set(['buff', 'debuff', 'bonus_buff']);

/** Clases que pueden usar fórmulas en skill_power (poder, salud, *, /). */
const SKILL_CLASSES_CON_FORMULA = new Set([
    'buff', 'debuff', 'heal', 'shield', 'aoe', 'heal_all', 'shield_aoe', 'bonus_buff',
    'tank', 'extra_attack', 'dot', 'life_steal'
]);

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

window.normalizarClaseSkill = normalizarClaseSkill;

function obtenerNivelCartaSeguro(carta) {
    return Math.max(1, Number(carta?.Nivel || 1));
}

/**
 * Copia real desbloqueada del catálogo (nombre = parent). Las apariencias guardadas solo
 * con `skinParentNombre` y otro `Nombre` no cuentan como tener la carta parent.
 */
function esCopiaBaseParentEnColeccion(carta) {
    if (!carta || typeof carta !== 'object' || carta.tipoRecompensa === 'skin') {
        return false;
    }
    const parentKey = obtenerClaveParentCartaColeccion(carta);
    if (!parentKey) {
        return false;
    }
    const nombreKey = normalizarClaveNombreCatalogo(carta.Nombre);
    return nombreKey === parentKey;
}

function obtenerClaveDedupItemCartaUsuario(carta) {
    const porParent = obtenerClaveParentCartaColeccion(carta);
    if (porParent) {
        return porParent;
    }
    return normalizarClaveNombreCatalogo(carta?.Nombre);
}

/**
 * Lista de { index, carta } (index en usuario.cartas). Deja una entrada por parent del catálogo:
 * la de mayor nivel; si empatan, conserva la de menor índice en la colección.
 */
function deduplicarItemsCartasUsuarioMejorNivel(items) {
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }
    const mejorPorClave = new Map();
    items.forEach(item => {
        const indice = Number(item?.index);
        if (!item || !Number.isFinite(indice) || !item.carta) {
            return;
        }
        const clave = obtenerClaveDedupItemCartaUsuario(item.carta);
        if (!clave) {
            return;
        }
        const nivel = obtenerNivelCartaSeguro(item.carta);
        const prev = mejorPorClave.get(clave);
        const itemNormalizado = { carta: item.carta, index: indice };
        if (!prev) {
            mejorPorClave.set(clave, itemNormalizado);
            return;
        }
        const nivelPrev = obtenerNivelCartaSeguro(prev.carta);
        if (nivel > nivelPrev || (nivel === nivelPrev && indice < prev.index)) {
            mejorPorClave.set(clave, itemNormalizado);
        }
    });
    return Array.from(mejorPorClave.values())
        .sort((a, b) => Number(b.carta.Poder || 0) - Number(a.carta.Poder || 0));
}

window.deduplicarItemsCartasUsuarioMejorNivel = deduplicarItemsCartasUsuarioMejorNivel;
window.esCopiaBaseParentEnColeccion = esCopiaBaseParentEnColeccion;
window.obtenerClaveDedupItemCartaUsuario = obtenerClaveDedupItemCartaUsuario;

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

/**
 * Convierte skill_power con variables a expresión aritmética segura.
 * Soporta: poder, salud, saludenemigo, +, -, *, /, paréntesis y decimales (0.25 o 0,25).
 * Ejemplos: poder/2, (poder/3)*2, poder+poder*0.25, salud*3-(poder/4)
 */
function prepararFormulaSkillPowerParaEvaluacion(formulaRaw, contexto = {}) {
    const formula = String(formulaRaw || '').trim().toLowerCase();
    if (!formula) {
        return null;
    }

    const formulaSegura = formula
        .replace(/saludenemigo/g, String(Number(contexto.saludEnemigo || 0)))
        .replace(/\bsalud\b/g, String(Number(contexto.salud || 0)))
        .replace(/\bpoder\b/g, String(Number(contexto.poder || 0)))
        .replace(/,/g, '.')
        .replace(/\s+/g, '');

    if (!formulaSegura || !/^[0-9+\-*/().]+$/.test(formulaSegura)) {
        return null;
    }

    let profundidad = 0;
    for (let i = 0; i < formulaSegura.length; i += 1) {
        const ch = formulaSegura[i];
        if (ch === '(') {
            profundidad += 1;
        } else if (ch === ')') {
            profundidad -= 1;
            if (profundidad < 0) {
                return null;
            }
        }
    }
    if (profundidad !== 0) {
        return null;
    }

    return formulaSegura;
}

function evaluarFormulaSkillPower(formulaRaw, contexto = {}) {
    const formulaSegura = prepararFormulaSkillPowerParaEvaluacion(formulaRaw, contexto);
    if (!formulaSegura) {
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

function esSkillPowerFormula(raw) {
    const texto = String(raw ?? '').trim();
    if (!texto) {
        return false;
    }
    if (parsearNumeroSeguro(texto) !== null) {
        return false;
    }
    return prepararFormulaSkillPowerParaEvaluacion(texto, { poder: 100, salud: 100, saludEnemigo: 100 }) !== null;
}

function normalizarValorSkillPowerPorClase(clase, valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) {
        return 0;
    }
    const claseNorm = normalizarClaseSkill({ skill_class: clase });
    switch (claseNorm) {
        case 'aoe':
        case 'extra_attack':
        case 'dot':
            return Math.max(1, Math.floor(n));
        case 'tank':
            return Math.max(0, Math.round(n));
        default:
            return Math.max(0, Math.floor(n));
    }
}

/** Valores por defecto si skill_power está vacío (cartas legacy sin Excel actualizado). */
function obtenerSkillPowerFallbackPorClase(clase, contexto = {}, fallback = 0) {
    const claseNorm = normalizarClaseSkill({ skill_class: clase });
    const poder = Math.max(0, Number(contexto.poder || 0));
    const salud = Math.max(0, Number(contexto.salud || 0));
    const saludEnemigo = Math.max(0, Number(contexto.saludEnemigo || 0));
    switch (claseNorm) {
        case 'aoe':
            return Math.max(1, Math.floor(poder / 2));
        case 'extra_attack':
            return Math.max(1, Math.floor(poder));
        case 'tank':
            return Math.max(0, Math.round(salud * 2));
        case 'heal_debuff':
            if (saludEnemigo > 0) {
                return Math.max(1, Math.floor(saludEnemigo * 0.75));
            }
            return Number(fallback || 0);
        default:
            return Number(fallback || 0);
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

/** skill_power efectivo (base × nivel) para clases que escalan por nivel. */
/**
 * Contexto para evaluar skill_power: buff/debuff/bonus_buff usan solo stats base de la carta (Poder/SaludMax + nivel).
 */
function obtenerContextoSkillPowerCarta(carta, opciones = {}) {
    const clase = normalizarClaseSkill(carta);
    if (SKILL_CLASSES_CONTEXTO_BASE.has(clase)) {
        const poder = Math.max(0, Number(carta?.Poder ?? 0));
        const salud = Math.max(
            0,
            Number(carta?.SaludMax ?? carta?.Salud ?? carta?.Poder ?? poder)
        );
        return {
            poder,
            salud,
            saludEnemigo: Math.max(0, Number(opciones.saludEnemigo ?? 0))
        };
    }
    return {
        poder: Number(opciones.poder ?? carta?.Poder ?? 0),
        salud: Number(opciones.salud ?? carta?.Salud ?? carta?.SaludMax ?? carta?.Poder ?? 0),
        saludEnemigo: Number(opciones.saludEnemigo ?? 0)
    };
}

function obtenerSkillPowerEscaladoPorNivel(carta) {
    if (!carta || typeof carta !== 'object') {
        return null;
    }
    const clase = normalizarClaseSkill(carta);
    if (!SKILL_CLASSES_ESCALABLES.has(clase)) {
        return null;
    }
    const copia = { ...carta };
    recalcularSkillPowerPorNivel(copia, obtenerNivelCartaSeguro(carta), { rawEsBase: true });
    return parsearNumeroSeguro(copia.skill_power);
}

function obtenerSkillPowerNumericoCarta(carta, opciones = {}) {
    const clase = normalizarClaseSkill(carta);
    const fallback = Number(opciones.fallback ?? 0);
    const contexto = obtenerContextoSkillPowerCarta(carta, opciones);
    const bruto = carta?.skill_power;

    if (clase === 'revive') {
        return 1;
    }
    if (clase === 'bonus_debuff') {
        return fallback;
    }
    if (clase === 'heal_debuff') {
        if (esSkillPowerFormula(bruto)) {
            const v = evaluarFormulaSkillPower(bruto, contexto);
            if (v !== null) {
                return normalizarValorSkillPowerPorClase(clase, v);
            }
        }
        return normalizarValorSkillPowerPorClase(
            clase,
            obtenerSkillPowerFallbackPorClase(clase, contexto, fallback)
        );
    }

    // 1) Fórmula del Excel — se evalúa en tiempo real (poder/salud actuales en partida o de la carta fuera de ella).
    if (SKILL_CLASSES_CON_FORMULA.has(clase) && esSkillPowerFormula(bruto)) {
        const formulaEvaluada = evaluarFormulaSkillPower(bruto, contexto);
        if (formulaEvaluada !== null) {
            return normalizarValorSkillPowerPorClase(clase, formulaEvaluada);
        }
    }

    // 2) Literal escalable × nivel (buff, heal, etc.).
    const escaladoPorNivel = obtenerSkillPowerEscaladoPorNivel(carta);
    if (escaladoPorNivel !== null) {
        return normalizarValorSkillPowerPorClase(clase, escaladoPorNivel);
    }

    // 3) Literal fijo del Excel.
    const numeroDirecto = parsearNumeroSeguro(bruto);
    if (numeroDirecto !== null) {
        return normalizarValorSkillPowerPorClase(clase, numeroDirecto);
    }

    // 4) Compatibilidad: skill_power vacío → comportamiento legacy por clase.
    if (SKILL_CLASSES_CON_FORMULA.has(clase) || clase === 'aoe' || clase === 'tank' || clase === 'extra_attack') {
        return normalizarValorSkillPowerPorClase(
            clase,
            obtenerSkillPowerFallbackPorClase(clase, contexto, fallback)
        );
    }

    return normalizarValorSkillPowerPorClase(clase, fallback);
}

/** Poder de referencia para colorear tooltips: stat impreso de la carta (sin buffs/debuffs de combate en mesa). */
function obtenerPoderBaseReferenciaCarta(carta) {
    if (!carta) return 0;
    const poderImpreso = Number(carta.Poder || 0);
    const enMesa = Number.isFinite(Number(carta.poderFinalAfiliacion))
        || Number.isFinite(Number(carta.poderBaseAfiliacion));
    if (enMesa) {
        return Math.max(0, poderImpreso);
    }
    const mod = Number(carta.poderModHabilidadVisual ?? carta.poderModHabilidad ?? 0);
    return Math.max(0, poderImpreso + (Number.isFinite(mod) ? mod : 0));
}

/** Poder efectivo actual (con bonus de afiliación en tablero si aplica). */
function obtenerPoderActualCarta(carta, opciones = {}) {
    if (opciones && Number.isFinite(Number(opciones.poder))) {
        return Math.max(0, Number(opciones.poder));
    }
    if (!carta) return 0;
    const finalNum = Number(carta.poderFinalAfiliacion);
    if (Number.isFinite(finalNum)) {
        return Math.max(0, finalNum);
    }
    const baseAf = Number(carta.poderBaseAfiliacion);
    const bonAf = Number(carta.bonusAfiliacion || 0);
    if (Number.isFinite(baseAf)) {
        return Math.max(0, baseAf + (Number.isFinite(bonAf) ? bonAf : 0));
    }
    const poder = Number(carta.Poder || 0);
    const modVis = Number(carta.poderModHabilidadVisual);
    if (Number.isFinite(modVis)) {
        const bon = Number(carta.bonusAfiliacion || 0);
        return Math.max(0, poder + modVis + (Number.isFinite(bon) ? bon : 0));
    }
    return Math.max(0, poder);
}

function calcularDanioSkillDesdePoder(claseSkill, poderActual, carta = null, opciones = {}) {
    if (carta && typeof carta === 'object') {
        return obtenerSkillPowerNumericoCarta(carta, {
            ...opciones,
            poder: poderActual,
            salud: Number(
                opciones.salud
                ?? carta?.Salud
                ?? carta?.SaludMax
                ?? poderActual
                ?? 0
            )
        });
    }
    const clase = normalizarClaseSkill({ skill_class: claseSkill });
    const poder = Math.max(0, Number(poderActual) || 0);
    return normalizarValorSkillPowerPorClase(
        clase,
        obtenerSkillPowerFallbackPorClase(clase, { poder, salud: poder }, 0)
    );
}

/**
 * Valor y color del @skill_power en tooltip para habilidades de daño según poder actual en mesa.
 */
function resolverPresentacionSkillPowerTooltip(carta, meta = {}, opciones = {}) {
    const clase = normalizarClaseSkill({ skill_class: meta?.clase || carta?.skill_class || '' });
    const poderBase = obtenerPoderBaseReferenciaCarta(carta);
    const poderActual = obtenerPoderActualCarta(carta, opciones);

    const saludContexto = Number(opciones.salud ?? carta?.Salud ?? carta?.SaludMax ?? carta?.Poder ?? 0);
    const valorMostrar = obtenerSkillPowerNumericoCarta(carta, {
        ...opciones,
        poder: poderActual,
        salud: saludContexto
    });

    let claseColor = CLASE_COLOR_SKILL_POWER_TOOLTIP[clase] || 'tooltip-skill-power--default';
    const usaPoderEnFormula = esSkillPowerFormula(carta?.skill_power)
        && /\bpoder\b/i.test(String(carta?.skill_power || ''));
    if (clase === 'aoe' || clase === 'extra_attack' || usaPoderEnFormula) {
        if (poderActual > poderBase) {
            claseColor = 'tooltip-skill-power--power-buff';
        } else if (poderActual < poderBase) {
            claseColor = 'tooltip-skill-power--power-debuff';
        }
    }

    return { valor: valorMostrar, claseColor, poderActual, poderBase };
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
    const meta = obtenerMetaHabilidadCarta(carta);
    const presentacion = resolverPresentacionSkillPowerTooltip(carta, meta, opciones);
    return texto.replace(/@skill_power/gi, formatearSkillPowerParaTexto(presentacion.valor));
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
    const presentacion = resolverPresentacionSkillPowerTooltip(carta, meta, opciones);
    const claseColor = presentacion.claseColor;
    const valor = formatearSkillPowerParaTexto(presentacion.valor);
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
    shield_aoe: 'badge-habilidad--shield-aoe',
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
    shield_aoe: 'tooltip-skill-power--shield-aoe',
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
    const poderActual = obtenerPoderActualCarta(carta);
    const opcionesSkill = {
        poder: poderActual,
        salud: Number(carta?.Salud ?? carta?.SaludMax ?? carta?.Poder ?? 0)
    };
    enlazarTooltipHabilidadABadge(badge, {
        ...meta,
        info: interpolarSkillInfoConValores(carta, meta.info, opcionesSkill),
        infoHtml: construirInfoTooltipHabilidadHtml(carta, meta, opcionesSkill)
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
window.enlazarTooltipHabilidadGlobal = enlazarTooltipHabilidadABadge;
window.mostrarTooltipHabilidadGlobal = mostrarTooltipHabilidadGlobal;
window.ocultarTooltipHabilidadGlobal = ocultarTooltipHabilidadGlobal;
window.aplicarPrefijoAfiliacionNombreCarta = aplicarPrefijoAfiliacionNombreCarta;
window.crearBadgeAfiliacionCarta = crearBadgeAfiliacionCarta;
window.obtenerSkillPowerNumericoCarta = obtenerSkillPowerNumericoCarta;
window.obtenerContextoSkillPowerCarta = obtenerContextoSkillPowerCarta;
window.evaluarFormulaSkillPower = evaluarFormulaSkillPower;
window.prepararFormulaSkillPowerParaEvaluacion = prepararFormulaSkillPowerParaEvaluacion;
window.esSkillPowerFormula = esSkillPowerFormula;
window.obtenerSkillPowerEscaladoPorNivel = obtenerSkillPowerEscaladoPorNivel;
window.obtenerPoderActualCarta = obtenerPoderActualCarta;
window.obtenerPoderBaseReferenciaCarta = obtenerPoderBaseReferenciaCarta;
window.calcularDanioSkillDesdePoder = calcularDanioSkillDesdePoder;
window.resolverPresentacionSkillPowerTooltip = resolverPresentacionSkillPowerTooltip;
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
const VERSION_MIGRACION_SKILLS_USUARIO = 6;
/** @deprecated Usar `DCEscaladoStatsCarta` — reexportado para compatibilidad. */
const DC_INCREMENTO_STATS_POR_NIVEL_CARTA = (typeof window !== 'undefined' && window.DCEscaladoStatsCarta)
    ? window.DCEscaladoStatsCarta.DC_INCREMENTO_STATS_POR_NIVEL_CARTA
    : 500;

function _escaladoStatsApi() {
    if (typeof window !== 'undefined' && window.DCEscaladoStatsCarta) {
        return window.DCEscaladoStatsCarta;
    }
    return null;
}

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
        .map((carta) => {
            const nombre = String(carta?.Nombre || '').trim().toLowerCase();
            if (!nombre) {
                return null;
            }
            const poder = String(Math.max(0, Number(carta?.Poder ?? carta?.poder ?? 0)));
            const saludRaw = carta?.SaludMax ?? carta?.Salud ?? carta?.salud ?? carta?.Poder ?? carta?.poder;
            const salud = saludRaw === '' || saludRaw == null ? '' : String(Math.max(0, Number(saludRaw)));
            const fac = String(dcNormalizarFaccionHeroeVillano(dcLeerFaccionHVBruta(carta)) || '');
            const afi = String(carta?.Afiliacion ?? carta?.afiliacion ?? '').trim();
            return {
                nombre,
                poder,
                salud,
                fac,
                afi,
                skill_name: String(carta?.skill_name || '').trim(),
                skill_info: String(carta?.skill_info || '').trim(),
                skill_class: String(carta?.skill_class || '').trim().toLowerCase(),
                skill_power: String(carta?.skill_power ?? '').trim(),
                skill_trigger: String(carta?.skill_trigger || '').trim().toLowerCase(),
                imagen: String(carta?.Imagen || carta?.imagen || '').trim(),
                imagen_final: String(carta?.imagen_final || carta?.Imagen_final || '').trim()
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.nombre.localeCompare(b.nombre));

    const textoFirma = filas
        .map((fila) => [
            fila.nombre,
            fila.poder,
            fila.salud,
            fila.fac,
            fila.afi,
            fila.skill_name,
            fila.skill_info,
            fila.skill_class,
            fila.skill_power,
            fila.skill_trigger,
            fila.imagen,
            fila.imagen_final
        ].join('||'))
        .join('\n');

    return `cartas-sync-v2-${hashTextoSimple(textoFirma)}`;
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

function serializarCartaParaSyncMigracion(carta) {
    if (!carta || typeof carta !== 'object') {
        return '';
    }
    const skill = JSON.parse(skillFilaSerializada(carta));
    return JSON.stringify({
        Nombre: String(carta.Nombre || '').trim(),
        Nivel: Math.min(8, Math.max(1, Number(carta.Nivel || 1))),
        Poder: Number(carta.Poder || 0),
        Salud: Number(carta.Salud ?? ''),
        SaludMax: Number(carta.SaludMax ?? ''),
        faccion: String(carta.faccion || carta.Faccion || '').trim().toUpperCase(),
        Afiliacion: String(carta.Afiliacion || carta.afiliacion || '').trim(),
        ...skill
    });
}

/**
 * Alinea una carta de usuario con la fila del catálogo (Excel): stats base + escalado por nivel conservado,
 * habilidades, imágenes y metadatos. No altera el nivel del jugador.
 */
function fusionarCartaCompletaDesdeCatalogo(cartaUsuario, filaCatalogo) {
    if (!cartaUsuario || !filaCatalogo) {
        return cartaUsuario;
    }
    const nivel = Math.min(8, Math.max(1, Number(cartaUsuario.Nivel || 1)));
    let carta = { ...cartaUsuario };

    const nombreCat = String(filaCatalogo.Nombre || carta.Nombre || '').trim();
    if (nombreCat) {
        carta.Nombre = nombreCat;
    }

    const fac = dcNormalizarFaccionHeroeVillano(dcLeerFaccionHVBruta(filaCatalogo));
    if (fac) {
        carta.faccion = fac;
        carta.Faccion = fac;
    }

    const afiVal = String(filaCatalogo.Afiliacion ?? filaCatalogo.afiliacion ?? '').trim();
    carta.Afiliacion = afiVal;
    carta.afiliacion = afiVal;

    carta = forzarSkillDesdeFilaCatalogo(carta, filaCatalogo);

    let poderBase = Math.max(0, Number(filaCatalogo.Poder ?? filaCatalogo.poder ?? 0));
    const escaladoApi = _escaladoStatsApi();
    if (poderBase <= 0 && Number(cartaUsuario.Poder) > 0) {
        if (escaladoApi) {
            poderBase = escaladoApi.inferirStatsBaseDesdeCartaNivel(cartaUsuario, nivel).poderBase;
        } else {
            poderBase = Math.max(0, Number(cartaUsuario.Poder) - ((nivel - 1) * DC_INCREMENTO_STATS_POR_NIVEL_CARTA));
        }
    }
    const saludBaseRaw = filaCatalogo.SaludMax ?? filaCatalogo.Salud ?? filaCatalogo.salud ?? filaCatalogo.Poder ?? filaCatalogo.poder;
    let saludBase = Number(saludBaseRaw);
    if (!Number.isFinite(saludBase) || saludBase <= 0) {
        saludBase = Math.max(1, poderBase || 1);
    } else {
        saludBase = Math.max(1, saludBase);
    }
    if (saludBase <= 1 && Number(cartaUsuario.SaludMax ?? cartaUsuario.Salud ?? 0) > 0) {
        const sm = Number(cartaUsuario.SaludMax ?? cartaUsuario.Salud ?? cartaUsuario.Poder);
        if (Number.isFinite(sm) && sm > 0) {
            if (escaladoApi) {
                saludBase = escaladoApi.inferirStatsBaseDesdeCartaNivel(
                    { SaludMax: sm, Poder: cartaUsuario.Poder },
                    nivel
                ).saludBase;
            } else {
                saludBase = Math.max(1, sm - ((nivel - 1) * DC_INCREMENTO_STATS_POR_NIVEL_CARTA));
            }
        }
    }
    const poderNuevo = escaladoApi
        ? escaladoApi.calcularPoderEscaladoDesdeBase(poderBase, nivel)
        : Math.max(0, poderBase + ((nivel - 1) * DC_INCREMENTO_STATS_POR_NIVEL_CARTA));
    const saludMaxNuevo = escaladoApi
        ? escaladoApi.calcularSaludEscaladaDesdeBase(saludBase, nivel)
        : Math.max(1, saludBase + ((nivel - 1) * DC_INCREMENTO_STATS_POR_NIVEL_CARTA));

    const oldMax = Math.max(
        1,
        Number(cartaUsuario.SaludMax ?? cartaUsuario.Salud ?? cartaUsuario.Poder ?? 0) || 1
    );
    const oldSalud = Number.isFinite(Number(cartaUsuario.Salud))
        ? Number(cartaUsuario.Salud)
        : oldMax;
    const ratio = Math.max(0, Math.min(1, oldSalud / oldMax));
    const saludNueva = Math.max(1, Math.min(saludMaxNuevo, Math.round(ratio * saludMaxNuevo)));

    carta.Nivel = nivel;
    carta.Poder = poderNuevo;
    carta.SaludMax = saludMaxNuevo;
    carta.Salud = saludNueva;

    if (typeof window.recalcularSkillPowerPorNivel === 'function') {
        window.recalcularSkillPowerPorNivel(carta, nivel, { rawEsBase: true });
    }
    return carta;
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

/** Clave de catálogo (parent); las apariencias/skin no cuentan como carta distinta en colección. */
function normalizarClaveNombreCatalogo(nombre) {
    return String(nombre ?? '').trim().toLowerCase();
}

function obtenerClaveParentCartaColeccion(carta) {
    if (!carta || typeof carta !== 'object') {
        return '';
    }
    const parentGuardado = String(carta.skinParentNombre || '').trim();
    if (parentGuardado) {
        return normalizarClaveNombreCatalogo(parentGuardado);
    }
    if (typeof window.DCSkinsCartas !== 'undefined' && typeof window.DCSkinsCartas.obtenerNombreParentCarta === 'function') {
        return normalizarClaveNombreCatalogo(window.DCSkinsCartas.obtenerNombreParentCarta(carta));
    }
    const nombre = String(carta.Nombre || '').trim();
    if (!nombre) {
        return '';
    }
    if (typeof window.DCSkinsCartas !== 'undefined' && typeof window.DCSkinsCartas.obtenerNombreCatalogoDesdeReferencia === 'function') {
        return normalizarClaveNombreCatalogo(window.DCSkinsCartas.obtenerNombreCatalogoDesdeReferencia(nombre));
    }
    return normalizarClaveNombreCatalogo(nombre);
}

function normalizarFaccionCatalogoColeccion(valor) {
    const faccion = String(valor || '').trim().toUpperCase();
    return faccion === 'H' || faccion === 'V' ? faccion : '';
}

function filasCatalogoUnicasParaProgreso(catalogoEntrada) {
    if (catalogoEntrada instanceof Map) {
        return Array.from(catalogoEntrada.values());
    }
    if (catalogoEntrada && typeof catalogoEntrada === 'object' && catalogoEntrada.mapa instanceof Map) {
        return Array.from(catalogoEntrada.mapa.values());
    }
    const mapa = new Map();
    (Array.isArray(catalogoEntrada) ? catalogoEntrada : []).forEach((fila) => {
        const clave = normalizarClaveNombreCatalogo(fila?.Nombre);
        if (!clave || mapa.has(clave)) {
            return;
        }
        mapa.set(clave, fila);
    });
    return Array.from(mapa.values());
}

function calcularProgresoColeccionDesdeCatalogo(usuario, catalogoEntrada) {
    const cartasUsuario = Array.isArray(usuario?.cartas) ? usuario.cartas : [];
    const nombresObtenidos = new Set();
    cartasUsuario.forEach((carta) => {
        if (!esCopiaBaseParentEnColeccion(carta)) {
            return;
        }
        const clave = obtenerClaveParentCartaColeccion(carta);
        if (clave) {
            nombresObtenidos.add(clave);
        }
    });

    const filas = filasCatalogoUnicasParaProgreso(catalogoEntrada);
    const total = filas.length;
    let obtenidas = 0;
    let heroesObtenidos = 0;
    let villanosObtenidos = 0;
    let heroesCat = 0;
    let villCat = 0;

    filas.forEach((fila) => {
        const fac = normalizarFaccionCatalogoColeccion(fila.faccion || fila.Faccion);
        if (fac === 'H') {
            heroesCat += 1;
        } else if (fac === 'V') {
            villCat += 1;
        }
        const clave = normalizarClaveNombreCatalogo(fila?.Nombre);
        if (!clave || !nombresObtenidos.has(clave)) {
            return;
        }
        obtenidas += 1;
        if (fac === 'H') {
            heroesObtenidos += 1;
        } else if (fac === 'V') {
            villanosObtenidos += 1;
        }
    });

    const pct = total > 0 ? Math.round((obtenidas / total) * 100) : 0;
    return {
        total,
        obtenidas,
        pct,
        heroesObtenidos,
        heroesCat,
        villanosObtenidos,
        villCat
    };
}

function construirMapaSaludCatalogoDesdeFilas(cartasExcel = []) {
    const mapa = new Map();
    (Array.isArray(cartasExcel) ? cartasExcel : []).forEach((carta) => {
        const nombre = String(carta?.Nombre || '').trim().toLowerCase();
        if (!nombre) {
            return;
        }
        mapa.set(nombre, {
            nivelBase: Number(carta.Nivel || carta.nivel || 1),
            saludBase: Number(carta.Salud ?? carta.salud ?? carta.Poder ?? 0),
            skill_name: String(carta.skill_name || '').trim(),
            skill_info: String(carta.skill_info || '').trim(),
            skill_class: String(carta.skill_class || '').trim().toLowerCase(),
            skill_power: carta.skill_power ?? '',
            skill_trigger: String(carta.skill_trigger || '').trim().toLowerCase()
        });
    });
    return mapa;
}

let _promesaCatalogoCartasXlsx = null;
let _filasCatalogoCartasCache = null;
let _mapaCatalogoPorNombreCache = null;
let _mapaSaludCatalogoCache = null;

async function cargarFilasCatalogoCartasCompartido() {
    if (_filasCatalogoCartasCache) {
        return _filasCatalogoCartasCache;
    }
    if (_promesaCatalogoCartasXlsx) {
        return _promesaCatalogoCartasXlsx;
    }
    _promesaCatalogoCartasXlsx = (async () => {
        if (typeof XLSX === 'undefined') {
            throw new Error('XLSX no disponible');
        }
        const response = await fetch('resources/cartas.xlsx');
        if (!response.ok) {
            throw new Error('No se pudo cargar cartas.xlsx');
        }
        const data = await response.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        _filasCatalogoCartasCache = filas;
        _mapaCatalogoPorNombreCache = construirMapaCatalogoPorNombre(filas);
        _mapaSaludCatalogoCache = construirMapaSaludCatalogoDesdeFilas(filas);
        registrarImagenesCatalogoEnMemoria(filas);
        return filas;
    })().catch((error) => {
        _promesaCatalogoCartasXlsx = null;
        throw error;
    });
    return _promesaCatalogoCartasXlsx;
}

async function cargarCatalogoCartasExcelParaMigracion() {
    return cargarFilasCatalogoCartasCompartido();
}

function aplicarMigracionSkillsAColeccion(cartasUsuario, mapaCatalogo) {
    let huboCambios = false;
    const cartasActualizadas = (Array.isArray(cartasUsuario) ? cartasUsuario : []).map((carta) => {
        const clave = String(carta?.Nombre || '').trim().toLowerCase();
        const fila = mapaCatalogo.get(clave);
        if (!fila) {
            return carta;
        }
        const antes = serializarCartaParaSyncMigracion(carta);
        const despuesCarta = fusionarCartaCompletaDesdeCatalogo(carta, fila);
        const despues = serializarCartaParaSyncMigracion(despuesCarta);
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
        if (typeof window.actualizarUsuarioConSyncFirebase === 'function') {
            await window.actualizarUsuarioConSyncFirebase(usuario, email, { maxIntentos: 3 });
            return;
        }
        const response = await fetch('/update-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, email })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 409 && data?.usuario) {
                const fusionado = fusionarUsuarioSesionTrasUpdate(
                    leerUsuarioSesionSeguro() || {},
                    usuario,
                    data.usuario
                );
                localStorage.setItem('usuario', JSON.stringify(fusionado));
                window.dispatchEvent(new Event('dc:usuario-actualizado'));
            }
            throw new Error(data?.mensaje || 'No se pudo persistir la migración de skills');
        }
        if (data?.usuario && usuario && typeof usuario === 'object') {
            const fusionado = fusionarUsuarioSesionTrasUpdate(leerUsuarioSesionSeguro() || {}, usuario, data.usuario);
            Object.keys(usuario).forEach((k) => delete usuario[k]);
            Object.assign(usuario, fusionado);
            localStorage.setItem('usuario', JSON.stringify(fusionado));
        }
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
    const mejorasElite = Math.max(0, Number(objetos?.mejoraElite || 0));
    const mejorasLegendaria = Math.max(0, Number(objetos?.mejoraLegendaria || 0));
    const mejorasSuprema = Math.max(0, Number(objetos?.mejoraSuprema || 0));
    const mejorasDefinitiva = Math.max(0, Number(objetos?.mejoraDefinitiva || 0));
    return {
        puntos,
        mejoras,
        mejorasEspeciales,
        mejorasElite,
        mejorasLegendaria,
        mejorasSuprema,
        mejorasDefinitiva
    };
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

/** Estrella clásica (1–5★) en vistas de carta completa. */
const DC_STAR_CLASSIC_URL = 'https://i.ibb.co/zZt4R3x/star-level.png';

/**
 * Clases de borde / detalle para cartas completas según nivel 6 / 7 / 8.
 * No aplica a bosses (usan .boss-carta u otras reglas).
 */
function dcAplicarClasesNivelCartaCompleta(cartaDiv, carta) {
    if (!cartaDiv || !carta || typeof carta !== 'object') {
        return;
    }
    if (Boolean(carta.esBoss)) {
        return;
    }
    const nv = Math.min(8, Math.max(1, Number(carta.Nivel || 1)));
    cartaDiv.classList.remove('nivel-legendaria', 'nivel-elite-tablero', 'nivel-mitica-tablero');
    if (nv >= 8) {
        cartaDiv.classList.add('nivel-mitica-tablero');
    } else if (nv >= 7) {
        cartaDiv.classList.add('nivel-elite-tablero');
    } else if (nv >= 6) {
        cartaDiv.classList.add('nivel-legendaria');
    }
}

/**
 * Rellena el bloque de nivel (1–5 estrellas o icono 6/7/8) en cartas completas.
 * @param {HTMLElement} estrellasDiv
 * @param {object} carta
 * @param {object} [opts]
 * @param {boolean} [opts.esCartaBoss]
 * @param {object|null} [opts.desafioActivo] p. ej. { dificultad: n } para nº de estrellas del boss (1–6)
 */
function dcRellenarEstrellasCartaCompleta(estrellasDiv, carta, opts = {}) {
    if (!estrellasDiv || !carta || typeof carta !== 'object') {
        return;
    }
    const esBoss = Boolean(opts.esCartaBoss || carta.esBoss);
    estrellasDiv.classList.remove('estrellas-carta--modo-icono');
    estrellasDiv.innerHTML = '';

    if (esBoss) {
        const meta = opts.desafioActivo && typeof opts.desafioActivo === 'object' ? opts.desafioActivo : null;
        let cant = Math.min(6, Math.max(1, Number(carta.Nivel || 1)));
        if (meta && Number.isFinite(Number(meta.dificultad))) {
            cant = Math.min(6, Math.max(1, Number(meta.dificultad)));
        }
        for (let i = 0; i < cant; i += 1) {
            const estrella = document.createElement('img');
            estrella.classList.add('estrella');
            estrella.src = DC_STAR_CLASSIC_URL;
            estrella.alt = 'star';
            estrellasDiv.appendChild(estrella);
        }
        return;
    }

    const nivelUi = Math.min(8, Math.max(1, Number(carta.Nivel || 1)));

    if (nivelUi === 6) {
        estrellasDiv.classList.add('estrellas-carta--modo-icono');
        const icono = document.createElement('img');
        icono.className = 'estrella-icono-nivel estrella-icono-nivel--seis';
        icono.src = '/resources/icons/star6.png';
        icono.alt = 'Nivel 6';
        estrellasDiv.appendChild(icono);
    } else if (nivelUi === 7) {
        estrellasDiv.classList.add('estrellas-carta--modo-icono');
        const icono = document.createElement('img');
        icono.className = 'estrella-icono-nivel estrella-icono-nivel--elite';
        icono.src = '/resources/icons/elite_star.png';
        icono.alt = 'Nivel élite';
        estrellasDiv.appendChild(icono);
    } else if (nivelUi === 8) {
        estrellasDiv.classList.add('estrellas-carta--modo-icono');
        const icono = document.createElement('img');
        icono.className = 'estrella-icono-nivel estrella-icono-nivel--legendary';
        icono.src = '/resources/icons/legendary_star.png';
        icono.alt = 'Nivel legendario';
        estrellasDiv.appendChild(icono);
    } else {
        const cantidadEstrellas = Math.min(5, Math.max(1, nivelUi));
        for (let i = 0; i < cantidadEstrellas; i += 1) {
            const estrella = document.createElement('img');
            estrella.classList.add('estrella');
            estrella.src = DC_STAR_CLASSIC_URL;
            estrella.alt = 'star';
            estrellasDiv.appendChild(estrella);
        }
    }
}

window.dcAplicarClasesNivelCartaCompleta = dcAplicarClasesNivelCartaCompleta;
window.dcRellenarEstrellasCartaCompleta = dcRellenarEstrellasCartaCompleta;

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
function dcLeerFaccionHVBruta(obj) {
    if (!obj || typeof obj !== 'object') return '';
    const v = obj.faccion ?? obj.Faccion ?? obj.FACCION ?? obj['Facción'];
    return v != null && String(v).trim() !== '' ? v : '';
}

function dcMapaCatalogoPorNombre(catalogoOpcional) {
    return Array.isArray(catalogoOpcional) && catalogoOpcional.length > 0
        ? new Map(catalogoOpcional.map((c) => [dcNormalizarNombreCartaColeccion(c?.Nombre), c]))
        : null;
}

function dcResolverFaccionHVDeCarta(carta, mapaCat) {
    const clave = dcNormalizarNombreCartaColeccion(carta?.Nombre);
    if (!clave) {
        return '';
    }
    let fac = dcNormalizarFaccionHeroeVillano(dcLeerFaccionHVBruta(carta));
    if (!fac && mapaCat) {
        const base = mapaCat.get(clave);
        if (base) {
            fac = dcNormalizarFaccionHeroeVillano(dcLeerFaccionHVBruta(base));
        }
    }
    return fac;
}

/**
 * Cuenta todas las cartas obtenidas por facción (H/V), aunque ya estuvieran en colección.
 * Usar para misiones diarias/semanales `coleccion_h` / `coleccion_v`.
 */
function dcContarCartasObtenidasPorFaccion(cartasAAñadir, catalogoOpcional) {
    const mapaCat = dcMapaCatalogoPorNombre(catalogoOpcional);
    let h = 0;
    let v = 0;
    (cartasAAñadir || []).forEach((carta) => {
        const fac = dcResolverFaccionHVDeCarta(carta, mapaCat);
        if (fac === 'H') {
            h += 1;
        } else if (fac === 'V') {
            v += 1;
        }
    });
    return { nuevasH: h, nuevasV: v };
}

function dcContarCartasNuevasPorFaccion(cartasAAñadir, cartasUsuarioPrevias, catalogoOpcional) {
    const prev = new Set((cartasUsuarioPrevias || []).map((c) => dcNormalizarNombreCartaColeccion(c?.Nombre)));
    const mapaCat = dcMapaCatalogoPorNombre(catalogoOpcional);
    let nuevasH = 0;
    let nuevasV = 0;
    (cartasAAñadir || []).forEach((carta) => {
        const clave = dcNormalizarNombreCartaColeccion(carta?.Nombre);
        if (!clave || prev.has(clave)) {
            return;
        }
        const fac = dcResolverFaccionHVDeCarta(carta, mapaCat);
        if (fac === 'H') {
            nuevasH++;
        } else if (fac === 'V') {
            nuevasV++;
        }
        prev.add(clave);
    });
    return { nuevasH, nuevasV };
}

window.dcContarCartasObtenidasPorFaccion = dcContarCartasObtenidasPorFaccion;
window.dcContarCartasNuevasPorFaccion = dcContarCartasNuevasPorFaccion;
window.fusionarCartaCompletaDesdeCatalogo = fusionarCartaCompletaDesdeCatalogo;
window.migrarCatalogoCartasDesdeExcel = migrarSkillsUsuarioDesdeCatalogo;

/**
 * Puntos de recompensa de evento (offline / coop): el Excel define el total a dificultad 6;
 * a menor dificultad se aplica factor (dificultad / 6).
 */
function calcularPuntosRecompensaEventoPorDificultad(puntosExcel, dificultadElegida) {
    const pts = Math.max(0, Number(puntosExcel || 0));
    const dif = Math.min(6, Math.max(1, Number(dificultadElegida || 1)));
    return Math.max(0, Math.round((dif / 6) * pts));
}

window.calcularPuntosRecompensaEventoPorDificultad = calcularPuntosRecompensaEventoPorDificultad;

function construirFilaStatMenu({ icono, alt, valor, titulo }) {
    return `
        <span class="menu-user-stat-icon-wrap" title="${titulo}">
            <img src="${icono}" alt="${alt}" class="menu-user-stat-icon">
        </span>
        <span class="menu-user-stat-value">${valor}</span>
    `;
}

function construirLineaObjetosMejoraMenu(resumen) {
    const item = ({ icono, alt, valor, titulo }) => `
        <span class="menu-user-objeto-grupo" title="${titulo}">
            <span class="menu-user-stat-icon-wrap">
                <img src="${icono}" alt="${alt}" class="menu-user-stat-icon">
            </span>
            <span class="menu-user-stat-value">${valor}</span>
        </span>`;
    const filaSuperior = [
        { icono: '/resources/icons/mejora.png', alt: 'Mejora', valor: resumen.mejoras, titulo: 'Mejoras de carta' },
        { icono: '/resources/icons/mejora_especial.png', alt: 'Mejora especial', valor: resumen.mejorasEspeciales, titulo: 'Mejoras especiales' },
        { icono: '/resources/icons/mejora_suprema.png', alt: 'Mejora suprema', valor: resumen.mejorasSuprema, titulo: 'Mejoras supremas' },
    ];
    const filaInferior = [
        { icono: '/resources/icons/mejora_definitiva.png', alt: 'Mejora definitiva', valor: resumen.mejorasDefinitiva, titulo: 'Mejoras definitivas' },
        { icono: '/resources/icons/mejora_elite.png', alt: 'Mejora élite', valor: resumen.mejorasElite, titulo: 'Mejoras élite' },
        { icono: '/resources/icons/mejora_legendaria.png', alt: 'Mejora legendaria', valor: resumen.mejorasLegendaria, titulo: 'Mejoras legendarias' },
    ];
    return `
        <div class="menu-user-objetos-mejora-fila">${filaSuperior.map(item).join('')}</div>
        <div class="menu-user-objetos-mejora-fila">${filaInferior.map(item).join('')}</div>
    `;
}

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

/**
 * Respuestas de /update-user con payload parcial (p. ej. solo objetos + recompensas diarias)
 * no deben sustituir el perfil completo en localStorage.
 */
function elegirCartasTrasUpdate(base, pendiente, servidor, opts = {}) {
    const arrB = Array.isArray(base) ? base : [];
    const arrP = Array.isArray(pendiente) ? pendiente : [];
    const arrS = Array.isArray(servidor) ? servidor : [];
    const lenP = arrP.length;
    const lenS = arrS.length;
    const lenB = arrB.length;
    const tsB = Number(opts.tsBase) || 0;
    const tsP = Number(opts.tsPendiente) || 0;
    const tsS = Number(opts.tsServidor) || 0;
    const tsMaxP = Math.max(tsP, tsB);

    // Fusión/destrucción en este cliente: menos copias que el LS aún no actualizado.
    if (lenP > 0 && (lenP < lenB || lenP < lenS)) {
        return arrP;
    }
    // Recompensas / colección ampliada: el payload enviado es la fuente si es el write más reciente.
    if (lenP > lenS && tsMaxP >= tsS && tsMaxP >= tsB) {
        return arrP;
    }
    // Otro dispositivo o servidor más nuevo con más cartas.
    if (lenS > lenP && tsS > tsMaxP) {
        return arrS;
    }
    if (lenP >= lenS && lenP >= lenB) {
        return arrP;
    }
    if (lenS >= lenB) {
        return arrS;
    }
    return lenB > 0 ? arrB : arrP;
}

/** Marca el write como reciente y persiste en LS antes de /update-user (recompensas de partida). */
function prepararUsuarioTrasRecompensaPartida(usuario) {
    if (!usuario || typeof usuario !== 'object') {
        return;
    }
    usuario.syncUpdatedAt = Date.now();
    if (typeof window.DCNormalizarObjetosUsuario === 'function') {
        window.DCNormalizarObjetosUsuario(usuario);
    }
    try {
        localStorage.setItem('usuario', JSON.stringify(usuario));
    } catch (_err) {
        /* ignore */
    }
}

function fusionarMisionesSesionTrasUpdate(base, pendiente, servidor) {
    if (typeof window.DCMisiones?.fusionarMisionesCliente === 'function') {
        return window.DCMisiones.fusionarMisionesCliente(servidor || {}, pendiente || {});
    }
    const b = base && typeof base === 'object' ? base : {};
    const p = pendiente && typeof pendiente === 'object' ? pendiente : {};
    const s = servidor && typeof servidor === 'object' ? servidor : {};
    return (Object.keys(p).length > 0) ? p : ((Object.keys(s).length > 0) ? s : b);
}

function tienePreferenciasDefinidas(preferencias) {
    return preferencias && typeof preferencias === 'object' && Object.keys(preferencias).length > 0;
}

/** Evita que caché local pise color/tema guardados en otro dispositivo. */
function fusionarPreferenciasUsuario(base, pendiente, servidor) {
    const b = tienePreferenciasDefinidas(base?.preferencias) ? base.preferencias : {};
    const p = tienePreferenciasDefinidas(pendiente?.preferencias) ? pendiente.preferencias : {};
    const s = tienePreferenciasDefinidas(servidor?.preferencias) ? servidor.preferencias : {};
    const tieneP = Object.keys(p).length > 0;
    const tieneS = Object.keys(s).length > 0;
    if (!tieneP && !tieneS) {
        return Object.keys(b).length > 0 ? b : base?.preferencias;
    }
    if (!tieneP && tieneS) {
        return { ...b, ...s };
    }
    if (tieneP && !tieneS) {
        return { ...b, ...p };
    }
    const tsP = Number(pendiente?.syncUpdatedAt) || 0;
    const tsS = Number(servidor?.syncUpdatedAt) || 0;
    const colorP = p.colorPrincipal && typeof p.colorPrincipal === 'object';
    const merged = { ...b, ...s, ...p };
    if (s.colorPrincipal && typeof s.colorPrincipal === 'object' && (!colorP || tsS > tsP)) {
        merged.colorPrincipal = s.colorPrincipal;
    }
    return merged;
}

function timestampRecompensaDiariaDe(usuario) {
    if (!usuario || typeof usuario !== 'object') {
        return 0;
    }
    const t = Number(usuario?.recompensas?.diariaSobres?.lastClaimAt || 0);
    return (Number.isFinite(t) && t > 0) ? t : 0;
}

/** El cooldown diario usa el claim más reciente (servidor > caché antigua). */
function fusionarRecompensasSesionTrasUpdate(base, pendiente, servidor) {
    const merged = {
        ...(base?.recompensas && typeof base.recompensas === 'object' ? base.recompensas : {}),
        ...(servidor?.recompensas && typeof servidor.recompensas === 'object' ? servidor.recompensas : {}),
        ...(pendiente?.recompensas && typeof pendiente.recompensas === 'object' ? pendiente.recompensas : {})
    };
    const maxClaim = Math.max(
        timestampRecompensaDiariaDe(base),
        timestampRecompensaDiariaDe(pendiente),
        timestampRecompensaDiariaDe(servidor)
    );
    if (maxClaim > 0) {
        merged.diariaSobres = {
            ...(merged.diariaSobres && typeof merged.diariaSobres === 'object' ? merged.diariaSobres : {}),
            lastClaimAt: maxClaim
        };
    }
    return Object.keys(merged).length > 0 ? merged : undefined;
}

function elegirTiendaTrasUpdate(base, pendiente, servidor) {
    const b = base?.tienda;
    const p = pendiente?.tienda;
    const s = servidor?.tienda;
    const pActiva = p && typeof p === 'object' && Object.keys(p).length > 0;
    const sActiva = s && typeof s === 'object';
    if (!pActiva && sActiva) {
        return s;
    }
    if (pActiva && !sActiva) {
        return p;
    }
    if (!pActiva && !sActiva) {
        return b;
    }
    const tsP = Number(pendiente?.syncUpdatedAt) || 0;
    const tsS = Number(servidor?.syncUpdatedAt) || 0;
    const tsB = Number(base?.syncUpdatedAt) || 0;
    if (tsS >= tsP && tsS >= tsB) {
        return s;
    }
    if (tsP >= tsS && tsP >= tsB) {
        return p;
    }
    return s || p || b;
}

/** Prioriza el snapshot con `syncUpdatedAt` más reciente (compras, recompensas, etc.). */
function elegirPuntosTrasUpdate(base, pendiente, servidor) {
    const candidatos = [
        { pts: Number(base?.puntos), ts: Number(base?.syncUpdatedAt) || 0 },
        { pts: Number(pendiente?.puntos), ts: Number(pendiente?.syncUpdatedAt) || 0 },
        { pts: Number(servidor?.puntos), ts: Number(servidor?.syncUpdatedAt) || 0 }
    ].filter((c) => Number.isFinite(c.pts));
    if (candidatos.length === 0) {
        return 0;
    }
    candidatos.sort((a, b) => b.ts - a.ts);
    return candidatos[0].pts;
}

function fusionarUsuarioSesionTrasUpdate(base, pendiente, servidor) {
    const b = base && typeof base === 'object' ? base : {};
    const p = pendiente && typeof pendiente === 'object' ? pendiente : {};
    const s = servidor && typeof servidor === 'object' ? servidor : {};
    const nickServidor = String(s.nickname || '').trim();
    const nickPendiente = String(p.nickname || '').trim();
    const nickBase = String(b.nickname || '').trim();
    const avatarServidor = String(s.avatar || '').trim();
    const avatarPendiente = String(p.avatar || '').trim();
    const avatarBase = String(b.avatar || '').trim();
    const puntosFinal = elegirPuntosTrasUpdate(b, p, s);

    return {
        ...b,
        ...s,
        ...p,
        nickname: nickServidor || nickPendiente || nickBase || b.nickname,
        avatar: avatarServidor || avatarPendiente || avatarBase || b.avatar,
        puntos: puntosFinal,
        preferencias: fusionarPreferenciasUsuario(b, p, s),
        cartas: elegirCartasTrasUpdate(b.cartas, p.cartas, s.cartas, {
            tsBase: Number(b.syncUpdatedAt) || 0,
            tsPendiente: Number(p.syncUpdatedAt) || 0,
            tsServidor: Number(s.syncUpdatedAt) || 0
        }),
        mazos: Array.isArray(p.mazos) && p.mazos.length > 0
            ? p.mazos
            : (Array.isArray(s.mazos) && s.mazos.length > 0 ? s.mazos : b.mazos),
        skinsObtenidos: Array.isArray(p.skinsObtenidos) && p.skinsObtenidos.length > 0
            ? p.skinsObtenidos
            : (Array.isArray(s.skinsObtenidos) ? s.skinsObtenidos : b.skinsObtenidos),
        objetos: { ...(b.objetos || {}), ...(s.objetos || {}), ...(p.objetos || {}) },
        recompensas: fusionarRecompensasSesionTrasUpdate(b, p, s),
        misiones: fusionarMisionesSesionTrasUpdate(b.misiones, p.misiones, s.misiones),
        tienda: elegirTiendaTrasUpdate(b, p, s),
        syncToken: s.syncToken || p.syncToken || b.syncToken,
        syncUpdatedAt: Math.max(
            Number(s.syncUpdatedAt) || 0,
            Number(p.syncUpdatedAt) || 0,
            Number(b.syncUpdatedAt) || 0
        ) || (s.syncUpdatedAt || p.syncUpdatedAt || b.syncUpdatedAt)
    };
}

let _promesaRefrescoSesionServidor = null;

async function refrescarUsuarioSesionDesdeServidor() {
    if (_promesaRefrescoSesionServidor) {
        return _promesaRefrescoSesionServidor;
    }
    _promesaRefrescoSesionServidor = (async () => {
        const email = String(localStorage.getItem('email') || '').trim();
        if (!email) {
            return null;
        }
        try {
            const response = await fetch('/get-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data?.usuario) {
                return null;
            }
            const local = leerUsuarioSesionSeguro() || {};
            const fusionado = fusionarUsuarioSesionTrasUpdate(local, {}, data.usuario);
            aplicarRespaldoClaimLocalUsuario(fusionado);
            localStorage.setItem('usuario', JSON.stringify(fusionado));
            window.dispatchEvent(new Event('dc:usuario-actualizado'));
            return fusionado;
        } catch (error) {
            console.warn('[sesión] No se pudo refrescar usuario desde servidor:', error);
            return null;
        } finally {
            _promesaRefrescoSesionServidor = null;
        }
    })();
    return _promesaRefrescoSesionServidor;
}

function aplicarSyncTokenDesdeLocalStorage(usuario) {
    if (!usuario || typeof usuario !== 'object') {
        return;
    }
    const desdeLs = leerUsuarioSesionSeguro();
    if (!desdeLs) {
        return;
    }
    const tok = String(desdeLs.syncToken || '').trim();
    if (tok) {
        usuario.syncToken = desdeLs.syncToken;
    }
    const su = Number(desdeLs.syncUpdatedAt);
    if (Number.isFinite(su) && su > 0) {
        usuario.syncUpdatedAt = su;
    }
}

/**
 * POST /update-user con reintento ante 409 (syncToken desfasado entre pestañas o módulos).
 * Fusiona la respuesta sin vaciar cartas/mazos/tienda del cliente.
 */
async function actualizarUsuarioConSyncFirebase(usuario, email, opciones = {}) {
    const maxIntentos = Math.max(1, Number(opciones.maxIntentos || 3));
    let ultimoError = null;
    let refrescoTokenHecho = false;

    for (let intento = 0; intento < maxIntentos; intento += 1) {
        aplicarSyncTokenDesdeLocalStorage(usuario);
        if (!String(usuario?.syncToken || '').trim() && !refrescoTokenHecho) {
            refrescoTokenHecho = true;
            await refrescarUsuarioSesionDesdeServidor();
            aplicarSyncTokenDesdeLocalStorage(usuario);
        }
        const response = await fetch('/update-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, email })
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok) {
            const baseLs = leerUsuarioSesionSeguro() || {};
            const fusionado = fusionarUsuarioSesionTrasUpdate(baseLs, usuario, data?.usuario);
            if (usuario && typeof usuario === 'object') {
                Object.keys(usuario).forEach((k) => delete usuario[k]);
                Object.assign(usuario, fusionado);
            }
            localStorage.setItem('usuario', JSON.stringify(fusionado));
            window.dispatchEvent(new Event('dc:usuario-actualizado'));
            return data;
        }

        if (response.status === 401 && data?.codigo === 'SESSION_REPLACED') {
            throw new Error(data?.mensaje || 'Sesión cerrada en otro dispositivo.');
        }

        if (response.status === 409 && data?.usuario) {
            const baseLs = leerUsuarioSesionSeguro() || {};
            const fusionado = fusionarUsuarioSesionTrasUpdate(baseLs, usuario, data.usuario);
            if (usuario && typeof usuario === 'object') {
                Object.keys(usuario).forEach((k) => delete usuario[k]);
                Object.assign(usuario, fusionado);
            }
            localStorage.setItem('usuario', JSON.stringify(fusionado));
            window.dispatchEvent(new Event('dc:usuario-actualizado'));
            ultimoError = new Error(data?.mensaje || 'Conflicto de sincronización');
            continue;
        }

        throw new Error(data?.mensaje || 'No se pudieron guardar los datos del usuario en Firebase.');
    }

    throw ultimoError || new Error('No se pudo sincronizar con Firebase tras varios intentos.');
}

window.fusionarUsuarioSesionTrasUpdate = fusionarUsuarioSesionTrasUpdate;
window.actualizarUsuarioConSyncFirebase = actualizarUsuarioConSyncFirebase;
window.aplicarSyncTokenDesdeLocalStorage = aplicarSyncTokenDesdeLocalStorage;
window.refrescarUsuarioSesionDesdeServidor = refrescarUsuarioSesionDesdeServidor;
window.obtenerClaveParentCartaColeccion = obtenerClaveParentCartaColeccion;
window.calcularProgresoColeccionDesdeCatalogo = calcularProgresoColeccionDesdeCatalogo;
window.prepararUsuarioTrasRecompensaPartida = prepararUsuarioTrasRecompensaPartida;
window.DCCatalogoCartas = {
    cargarFilas: cargarFilasCatalogoCartasCompartido,
    obtenerFilas: cargarFilasCatalogoCartasCompartido,
    async obtenerMapaPorNombre() {
        await cargarFilasCatalogoCartasCompartido();
        return _mapaCatalogoPorNombreCache;
    },
    async obtenerMapaSalud() {
        await cargarFilasCatalogoCartasCompartido();
        return _mapaSaludCatalogoCache;
    }
};
window.aplicarRespaldoClaimLocalUsuario = aplicarRespaldoClaimLocalUsuario;

const DC_SYNC_REFRESH_DEBOUNCE_MS = 1200;
let _dcSyncRefreshTimer = null;
let _dcSyncRefreshEnCurso = false;

function debeOmitirRefrescoSesionPorVistaActiva() {
    const ruta = String(window.location.pathname || '').toLowerCase();
    return /partida|tablero/i.test(ruta);
}

async function refrescarSesionDesdeServidorSiAplica() {
    if (debeOmitirRefrescoSesionPorVistaActiva() || !localStorage.getItem('email')) {
        return null;
    }
    if (_dcSyncRefreshEnCurso) {
        return null;
    }
    _dcSyncRefreshEnCurso = true;
    try {
        if (typeof window.DCSesionUnica?.validarSesionActivaEnServidor === 'function') {
            const sesionOk = await window.DCSesionUnica.validarSesionActivaEnServidor();
            if (!sesionOk) {
                return null;
            }
        }
        return await refrescarUsuarioSesionDesdeServidor();
    } finally {
        _dcSyncRefreshEnCurso = false;
    }
}

function programarRefrescoSesionDesdeServidor() {
    if (debeOmitirRefrescoSesionPorVistaActiva() || !localStorage.getItem('email')) {
        return;
    }
    clearTimeout(_dcSyncRefreshTimer);
    _dcSyncRefreshTimer = setTimeout(() => {
        void refrescarSesionDesdeServidorSiAplica();
    }, DC_SYNC_REFRESH_DEBOUNCE_MS);
}

function iniciarSincronizacionSesionMultiCliente() {
    window.addEventListener('storage', (evento) => {
        if (evento.key !== 'usuario' || !evento.newValue) {
            return;
        }
        window.dispatchEvent(new Event('dc:usuario-actualizado'));
    });
    window.addEventListener('focus', () => {
        programarRefrescoSesionDesdeServidor();
        renderTimerRecompensaDiariaMenu();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            programarRefrescoSesionDesdeServidor();
            renderTimerRecompensaDiariaMenu();
        }
    });
}

window.programarRefrescoSesionDesdeServidor = programarRefrescoSesionDesdeServidor;
window.refrescarSesionDesdeServidorSiAplica = refrescarSesionDesdeServidorSiAplica;

function normalizarObjetosConSobresGlobal(usuario) {
    if (!usuario || typeof usuario !== 'object') return;
    const base = (usuario.objetos && typeof usuario.objetos === 'object') ? { ...usuario.objetos } : {};
    base.mejoraCarta = Number(base.mejoraCarta || 0);
    base.mejoraEspecial = Number(base.mejoraEspecial || 0);
    base.mejoraElite = Number(base.mejoraElite || 0);
    base.mejoraLegendaria = Number(base.mejoraLegendaria || 0);
    base.mejoraSuprema = Number(base.mejoraSuprema || 0);
    base.mejoraDefinitiva = Number(base.mejoraDefinitiva || 0);
    if (typeof window.DC_SOBRES_MEZCLAR_INVENTARIO === 'function') {
        usuario.objetos = window.DC_SOBRES_MEZCLAR_INVENTARIO(base);
        return;
    }
    usuario.objetos = {
        ...base,
        mejoraSuprema: Number(base.mejoraSuprema || 0),
        mejoraDefinitiva: Number(base.mejoraDefinitiva || 0),
        mejoraElite: Number(base.mejoraElite || 0),
        mejoraLegendaria: Number(base.mejoraLegendaria || 0),
        sobreH1: Number(base.sobreH1 || 0),
        sobreH2: Number(base.sobreH2 || 0),
        sobreH3: Number(base.sobreH3 || 0),
        sobreV1: Number(base.sobreV1 || 0),
        sobreV2: Number(base.sobreV2 || 0),
        sobreV3: Number(base.sobreV3 || 0)
    };
}

window.DCNormalizarObjetosUsuario = normalizarObjetosConSobresGlobal;

/**
 * Cuenta atrás legible: omite unidades en cero (p. ej. 16m 47s, 47s, 2h 5s).
 * Sin ceros a la izquierda en horas/días. Incluye días si dura >= 24h (p. ej. misiones semanales).
 */
function dcFormatearCuentaAtrasMs(ms) {
    const totalSegundos = Math.max(0, Math.floor(Number(ms) / 1000));
    const dias = Math.floor(totalSegundos / 86400);
    const resto = totalSegundos % 86400;
    const h = Math.floor(resto / 3600);
    const m = Math.floor((resto % 3600) / 60);
    const s = resto % 60;
    const parts = [];
    if (dias > 0) {
        parts.push(`${dias}d`);
    }
    if (h > 0) {
        parts.push(`${h}h`);
    }
    if (m > 0) {
        parts.push(`${m}m`);
    }
    if (s > 0 || parts.length === 0) {
        parts.push(`${s}s`);
    }
    return parts.join(' ');
}

window.dcFormatearCuentaAtrasMs = dcFormatearCuentaAtrasMs;

function formatearHMSGlobal(ms) {
    return dcFormatearCuentaAtrasMs(ms);
}

/** Inicio del día civil local (00:00). Misma convención que `misionesDiarias.js`. */
function inicioDelDiaLocalRecompensa(ts = Date.now()) {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function idDiaCalendarioLocalRecompensa(ts = Date.now()) {
    const d = new Date(ts);
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

function obtenerProximaMedianocheLocalRecompensa(ts = Date.now()) {
    const siguiente = inicioDelDiaLocalRecompensa(ts);
    siguiente.setDate(siguiente.getDate() + 1);
    return siguiente.getTime();
}

function yaReclamoRecompensaDiariaHoy(usuario) {
    const ultima = obtenerTimestampUltimaRecompensaDiaria(usuario || {});
    if (!(ultima > 0)) {
        return false;
    }
    return idDiaCalendarioLocalRecompensa(ultima) === idDiaCalendarioLocalRecompensa(Date.now());
}

function obtenerTimestampUltimaRecompensaDiaria(usuario) {
    const fromUser = timestampRecompensaDiariaDe(usuario);
    const fromLs = Number(localStorage.getItem(DC_DIARIA_LAST_CLAIM_LS_KEY) || 0);
    const v = (t) => (Number.isFinite(t) && t > 0 ? t : 0);
    return Math.max(v(fromUser), v(fromLs));
}

/**
 * Alinea `recompensas.diariaSobres` y el respaldo LS con el claim más reciente
 * (p. ej. tras GET /get-user o claim en otra pestaña).
 */
function aplicarRespaldoClaimLocalUsuario(usuario) {
    if (!usuario || typeof usuario !== 'object') {
        return usuario;
    }
    const claimLs = Number(localStorage.getItem(DC_DIARIA_LAST_CLAIM_LS_KEY) || 0);
    const desdeUsuario = timestampRecompensaDiariaDe(usuario);
    const maxTs = Math.max(
        Number.isFinite(desdeUsuario) && desdeUsuario > 0 ? desdeUsuario : 0,
        Number.isFinite(claimLs) && claimLs > 0 ? claimLs : 0
    );
    if (!(maxTs > 0)) {
        return usuario;
    }
    usuario.recompensas = (usuario.recompensas && typeof usuario.recompensas === 'object') ? usuario.recompensas : {};
    usuario.recompensas.diariaSobres = {
        ...(usuario.recompensas.diariaSobres || {}),
        lastClaimAt: maxTs
    };
    localStorage.setItem(DC_DIARIA_LAST_CLAIM_LS_KEY, String(maxTs));
    return usuario;
}

/**
 * Una recompensa por día civil (00:00 local → 00:00). No se acumulan días perdidos:
 * si el jugador vuelve tras varios días sin entrar, solo puede reclamar una vez ese día.
 */
function obtenerEstadoRecompensaDiaria(usuario) {
    const ahora = Date.now();
    const disponible = !yaReclamoRecompensaDiariaHoy(usuario || {});
    const inicioHoy = inicioDelDiaLocalRecompensa(ahora).getTime();
    const proximaMedianoche = obtenerProximaMedianocheLocalRecompensa(ahora);
    const duracionVentana = Math.max(1, proximaMedianoche - inicioHoy);
    const restante = disponible ? 0 : Math.max(0, proximaMedianoche - ahora);
    const progreso = disponible
        ? 100
        : Math.max(0, Math.min(((ahora - inicioHoy) / duracionVentana) * 100, 100));
    return {
        disponible,
        restanteMs: restante,
        progreso,
        siguienteClaimAt: proximaMedianoche,
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
    tiempoEl.textContent = `Próxima recompensa en:\n${formatearHMSGlobal(estado.restanteMs)}`;
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

function finalizarPersistenciaRecompensaDiariaOk(usuario) {
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

/**
 * Persiste sobres diarios + `recompensas.diariaSobres` en Firebase.
 * Debe enviar `syncToken` (y `syncUpdatedAt` si existe): un payload solo con `objetos`/`recompensas`
 * provoca 409 si el servidor exige concurrencia.
 * @returns {Promise<boolean>} true si este cliente aplicó el claim; false si el servidor ya tenía cooldown activo (no mostrar modal duplicado).
 */
async function persistirUsuarioConRecompensaDiaria(usuario) {
    const email = localStorage.getItem('email');
    if (!email) throw new Error('No hay email en sesión');

    const claimAt = Number(usuario?.recompensas?.diariaSobres?.lastClaimAt || Date.now());
    if (!Number.isFinite(claimAt) || claimAt <= 0) {
        throw new Error('Falta timestamp de claim de recompensa diaria.');
    }

    for (let intento = 0; intento < 3; intento += 1) {
        const desdeLs = leerUsuarioSesionSeguro();
        if (desdeLs && typeof desdeLs === 'object') {
            const tok = String(desdeLs.syncToken || '').trim();
            if (tok) {
                usuario.syncToken = desdeLs.syncToken;
            }
            const su = Number(desdeLs.syncUpdatedAt);
            if (Number.isFinite(su) && su > 0) {
                usuario.syncUpdatedAt = su;
            }
        }

        const syncTok = String(usuario?.syncToken || '').trim();
        const payloadUsuario = {
            objetos: usuario?.objetos && typeof usuario.objetos === 'object' ? { ...usuario.objetos } : {},
            recompensas: usuario?.recompensas && typeof usuario.recompensas === 'object' ? { ...usuario.recompensas } : {}
        };
        if (syncTok) {
            payloadUsuario.syncToken = syncTok;
            const su = Number(usuario?.syncUpdatedAt);
            if (Number.isFinite(su) && su > 0) {
                payloadUsuario.syncUpdatedAt = su;
            }
        }

        const response = await fetch('/update-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: payloadUsuario, email })
        });
        const data = await response.json().catch(() => ({}));

        if (response.ok) {
            const baseLs = leerUsuarioSesionSeguro() || {};
            const fusionado = fusionarUsuarioSesionTrasUpdate(baseLs, usuario, data?.usuario);
            normalizarObjetosConSobresGlobal(fusionado);
            aplicarRespaldoClaimLocalUsuario(fusionado);
            finalizarPersistenciaRecompensaDiariaOk(fusionado);
            return true;
        }

        if (response.status === 409 && data?.usuario) {
            const baseLs = leerUsuarioSesionSeguro() || {};
            const fusionado = fusionarUsuarioSesionTrasUpdate(baseLs, usuario, data.usuario);
            normalizarObjetosConSobresGlobal(fusionado);
            aplicarRespaldoClaimLocalUsuario(fusionado);
            localStorage.setItem('usuario', JSON.stringify(fusionado));
            window.dispatchEvent(new Event('dc:usuario-actualizado'));
            Object.keys(usuario).forEach((k) => delete usuario[k]);
            Object.assign(usuario, fusionado);

            const estadoTrasConflicto = obtenerEstadoRecompensaDiaria(usuario);
            if (!estadoTrasConflicto.disponible) {
                finalizarPersistenciaRecompensaDiariaOk(usuario);
                return false;
            }

            usuario.objetos.sobreH1 = Number(usuario.objetos.sobreH1 || 0) + 1;
            usuario.objetos.sobreV1 = Number(usuario.objetos.sobreV1 || 0) + 1;
            usuario.recompensas = (usuario.recompensas && typeof usuario.recompensas === 'object')
                ? usuario.recompensas
                : {};
            usuario.recompensas.diariaSobres = { lastClaimAt: claimAt };
            continue;
        }

        throw new Error(data?.mensaje || 'No se pudo actualizar usuario en servidor');
    }

    throw new Error('No se pudo sincronizar la recompensa diaria tras varios intentos. Recarga e inténtalo de nuevo.');
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

        const mostrarModal = await persistirUsuarioConRecompensaDiaria(usuario);
        renderTimerRecompensaDiariaMenu();
        if (mostrarModal) {
            await abrirModalRecompensaDiariaGlobal(claimAt);
        }
        return mostrarModal;
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

const DC_MENU_PROFILE_SNAPSHOT_KEY = 'dc_menu_profile_snapshot_v1';
let _menuLateralEstructuraLista = false;

function obtenerHtmlPlantillaPerfilMenu() {
    return `
            <img id="menu-user-avatar" class="menu-user-avatar" alt="Avatar">
            <div id="menu-user-name" class="menu-user-name"></div>
            <div id="menu-group-companion" class="menu-group-companion" style="display:none;" aria-label="Compañero de grupo">
                <img id="menu-group-avatar" class="menu-group-avatar" alt="Compañero">
                <span id="menu-group-name" class="menu-group-name"></span>
            </div>
            <button type="button" id="menu-group-trade-btn" class="btn btn-menu menu-group-trade-btn" style="display:none;" title="Intercambiar cartas con tu compañero">Intercambiar</button>
            <button id="menu-group-leave-btn" class="btn btn-menu menu-group-leave-btn" type="button" style="display:none;">
                <svg class="menu-group-leave-icon" viewBox="0 0 600 600" aria-hidden="true" focusable="false">
                    <path d="M130 0C58.672245 0 0 58.672245 0 130V470C0 541.32776 58.672245 600 130 600H301.57812C367.83331 600 423.13643 549.36696 430.67188 485H349.43555C343.32179 505.66026 324.7036 520 301.57812 520H130C101.60826 520 80 498.39174 80 470V130C80 101.60826 101.60826 80 130 80H301.57812C324.7036 80 343.32179 94.339739 349.43555 115H430.67188C423.13642 50.633038 367.83331 0 301.57812 0H130Z"></path>
                    <path d="M476.86328 179.99911A40 40 0 0 0 448.57812 191.71395A40 40 0 0 0 448.57812 248.28427L460.29297 259.99911H163.72656A40 40 0 0 0 123.72656 299.99911A40 40 0 0 0 163.72656 339.99911H460.29297L448.57812 351.71395A40 40 0 0 0 448.57812 408.28427A40 40 0 0 0 505.14844 408.28427L577.93945 335.49325A40 40 0 0 0 600 299.99911A40 40 0 0 0 577.5293 264.09481L505.14844 191.71395A40 40 0 0 0 476.86328 179.99911Z"></path>
                </svg>
                <span class="menu-group-leave-text">Dejar grupo</span>
            </button>
            <div id="menu-user-stats" class="menu-user-stats">
                <div class="menu-user-stat-row" id="menu-user-puntos"></div>
                <div class="menu-user-stat-row menu-user-objetos-mejora-line" id="menu-user-objetos-mejora-line"></div>
            </div>
            <div id="menu-recompensa-diaria" class="menu-recompensa-diaria">
                <div id="menu-recompensa-diaria-tiempo" class="menu-recompensa-diaria-tiempo">Siguiente recompensa en: 0s</div>
                <div class="menu-recompensa-diaria-progress">
                    <div id="menu-recompensa-diaria-bar" class="menu-recompensa-diaria-progress-fill"></div>
                </div>
            </div>
        `;
}

function limpiarEstadoEnlacePerfilModalEnPerfil(perfil) {
    const avatar = perfil?.querySelector?.('#menu-user-avatar');
    if (!avatar) {
        return;
    }
    delete avatar.dataset.perfilModalBound;
    avatar.classList.remove('perfil-avatar-btn');
    avatar.removeAttribute('role');
    avatar.removeAttribute('tabindex');
    avatar.removeAttribute('aria-label');
    avatar.removeAttribute('title');
}

function guardarSnapshotPerfilMenu(perfil) {
    if (!perfil) {
        return;
    }
    try {
        const clon = perfil.cloneNode(true);
        limpiarEstadoEnlacePerfilModalEnPerfil(clon);
        sessionStorage.setItem(DC_MENU_PROFILE_SNAPSHOT_KEY, clon.outerHTML);
    } catch (_err) {
        /* ignore */
    }
}

function restaurarPerfilMenuDesdeSnapshot(menu) {
    try {
        const html = sessionStorage.getItem(DC_MENU_PROFILE_SNAPSHOT_KEY);
        if (!html) {
            return null;
        }
        const temp = document.createElement('div');
        temp.innerHTML = html.trim();
        const perfil = temp.querySelector('#menu-user-profile') || temp.firstElementChild;
        if (!perfil || perfil.id !== 'menu-user-profile') {
            return null;
        }
        menu.insertBefore(perfil, menu.firstChild);
        limpiarEstadoEnlacePerfilModalEnPerfil(perfil);
        return perfil;
    } catch (_err) {
        return null;
    }
}

function ordenarEnlacesMenuLateral(menu) {
    const linkCentro = menu.querySelector('a[href="vistaJuego.html"]');
    if (linkCentro && linkCentro.textContent !== 'Centro de Operaciones') {
        linkCentro.textContent = 'Centro de Operaciones';
    }
    const linkMultijugador = menu.querySelector('#menu-link-multijugador');
    if (linkCentro && linkMultijugador && linkMultijugador.previousElementSibling !== linkCentro) {
        menu.insertBefore(linkMultijugador, linkCentro.nextElementSibling);
    }
}

function asegurarFilasStatsMenu(perfil) {
    const statsWrap = perfil.querySelector('#menu-user-stats');
    if (!statsWrap) {
        return;
    }
    if (!statsWrap.querySelector('#menu-user-puntos')) {
        statsWrap.innerHTML = `
            <div class="menu-user-stat-row" id="menu-user-puntos"></div>
            <div class="menu-user-stat-row menu-user-objetos-mejora-line" id="menu-user-objetos-mejora-line"></div>
        `;
    }
}

function asegurarEnlaceMultijugadorMenu(menu) {
    const linkCentro = menu.querySelector('a[href="vistaJuego.html"]');
    let linkMultijugador = menu.querySelector('#menu-link-multijugador');
    if (!linkMultijugador) {
        linkMultijugador = document.createElement('a');
        linkMultijugador.id = 'menu-link-multijugador';
        linkMultijugador.href = 'multijugador.html';
        linkMultijugador.className = 'btn btn-menu btn-menu-disabled';
        linkMultijugador.textContent = 'Multijugador';
    }
    if (linkCentro) {
        const destino = linkCentro.nextElementSibling;
        if (destino !== linkMultijugador) {
            if (destino) {
                menu.insertBefore(linkMultijugador, destino);
            } else {
                menu.appendChild(linkMultijugador);
            }
        }
    } else if (!linkMultijugador.parentElement) {
        menu.appendChild(linkMultijugador);
    }
    return linkMultijugador;
}

function asegurarVersionLabelMenu(menu) {
    const versionLabelTexto = 'Versión: 1.2.7';
    let versionLabel = menu.querySelector('#menu-version-label');
    if (!versionLabel) {
        versionLabel = document.createElement('div');
        versionLabel.id = 'menu-version-label';
        versionLabel.className = 'menu-version-label';
    }
    versionLabel.textContent = versionLabelTexto;
    const botonLogout = menu.querySelector('.btn-logout');
    if (botonLogout && versionLabel.parentElement !== menu) {
        botonLogout.insertAdjacentElement('afterend', versionLabel);
    } else if (!versionLabel.parentElement) {
        menu.appendChild(versionLabel);
    }
}

function asegurarEstructuraMenuLateral() {
    const menu = document.querySelector('.menu-container');
    if (!menu) {
        return null;
    }

    if (!_menuLateralEstructuraLista) {
        ordenarEnlacesMenuLateral(menu);
    }

    let perfil = document.getElementById('menu-user-profile');
    if (!perfil) {
        perfil = restaurarPerfilMenuDesdeSnapshot(menu);
    }
    if (!perfil) {
        perfil = document.createElement('div');
        perfil.id = 'menu-user-profile';
        perfil.className = 'menu-user-profile';
        perfil.innerHTML = obtenerHtmlPlantillaPerfilMenu();
        menu.insertBefore(perfil, menu.firstChild);
    }

    asegurarFilasStatsMenu(perfil);
    asegurarEstructuraGrupoMenu(perfil);
    asegurarEnlaceMultijugadorMenu(menu);
    asegurarVersionLabelMenu(menu);
    guardarSnapshotPerfilMenu(perfil);
    _menuLateralEstructuraLista = true;
    menu.classList.add('dc-menu-listo');
    return menu;
}

function actualizarDatosMenuLateral() {
    const menu = asegurarEstructuraMenuLateral();
    if (!menu) {
        return;
    }

    const perfil = document.getElementById('menu-user-profile');
    if (!perfil) {
        return;
    }

    const avatar = menu.querySelector('#menu-user-avatar');
    const nombre = menu.querySelector('#menu-user-name');
    const puntosEl = menu.querySelector('#menu-user-puntos');
    const objetosMejoraLineEl = menu.querySelector('#menu-user-objetos-mejora-line');
    const grupoCompanion = menu.querySelector('#menu-group-companion');
    const grupoAvatar = menu.querySelector('#menu-group-avatar');
    const grupoName = menu.querySelector('#menu-group-name');
    const grupoTradeBtn = menu.querySelector('#menu-group-trade-btn');
    const grupoLeaveBtn = menu.querySelector('#menu-group-leave-btn');
    const resumen = obtenerResumenInventarioSesion();
    const grupoEstado = obtenerEstadoGrupoSesion();

    const avatarSrc = obtenerAvatarSesion();
    if (avatar && avatar.src !== avatarSrc) {
        avatar.src = avatarSrc;
    }
    enlazarAvatarPerfilMenu(avatar);

    const nombreVisible = obtenerNombreVisibleSesion();
    if (nombre && nombre.textContent !== nombreVisible) {
        nombre.textContent = nombreVisible;
    }

    if (puntosEl) {
        const puntosHtml = construirFilaStatMenu({
            icono: '/resources/icons/moneda.png',
            alt: 'Puntos',
            valor: resumen.puntos,
            titulo: 'Puntos'
        });
        if (puntosEl.innerHTML !== puntosHtml) {
            puntosEl.innerHTML = puntosHtml;
        }
    }
    if (objetosMejoraLineEl) {
        const objetosHtml = construirLineaObjetosMejoraMenu(resumen);
        if (objetosMejoraLineEl.innerHTML !== objetosHtml) {
            objetosMejoraLineEl.innerHTML = objetosHtml;
        }
    }

    if (grupoCompanion && grupoAvatar && grupoName) {
        const companion = grupoEstado?.companero;
        const mostrarCompanion = Boolean(grupoEstado?.enGrupo && companion?.email);
        const displayCompanion = mostrarCompanion ? 'flex' : 'none';
        if (grupoCompanion.style.display !== displayCompanion) {
            grupoCompanion.style.display = displayCompanion;
        }
        if (grupoTradeBtn) {
            const displayTrade = mostrarCompanion ? 'inline-flex' : 'none';
            if (grupoTradeBtn.style.display !== displayTrade) {
                grupoTradeBtn.style.display = displayTrade;
            }
            grupoTradeBtn.onclick = mostrarCompanion
                ? () => {
                    if (typeof window.DCTradeGrupo?.solicitarIntercambio === 'function') {
                        window.DCTradeGrupo.solicitarIntercambio();
                    }
                }
                : null;
        }
        if (mostrarCompanion) {
            const srcCompanion = String(companion?.avatar || '').trim() || 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';
            if (grupoAvatar.src !== srcCompanion) {
                grupoAvatar.src = srcCompanion;
            }
            const nombreCompanion = companion?.nombre || companion?.email || 'Compañero';
            if (grupoName.textContent !== nombreCompanion) {
                grupoName.textContent = nombreCompanion;
            }
        }
    }

    if (grupoLeaveBtn) {
        const enGrupo = Boolean(grupoEstado?.enGrupo);
        const displayLeave = enGrupo ? 'inline-flex' : 'none';
        if (grupoLeaveBtn.style.display !== displayLeave) {
            grupoLeaveBtn.style.display = displayLeave;
        }
        if (!grupoLeaveBtn.dataset.dcLeaveBound) {
            grupoLeaveBtn.dataset.dcLeaveBound = '1';
            grupoLeaveBtn.onclick = () => {
                if (typeof window.confirmarAbandonoGrupo === 'function') {
                    window.confirmarAbandonoGrupo().then((confirmado) => {
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
    }

    const linkMultijugador = menu.querySelector('#menu-link-multijugador');
    if (linkMultijugador) {
        const multijugadorHabilitado = Boolean(grupoEstado?.enGrupo && grupoEstado?.puedeMultijugador);
        linkMultijugador.classList.toggle('btn-menu-disabled', !multijugadorHabilitado);
        linkMultijugador.setAttribute('aria-disabled', multijugadorHabilitado ? 'false' : 'true');
        linkMultijugador.tabIndex = multijugadorHabilitado ? 0 : -1;
        linkMultijugador.title = multijugadorHabilitado
            ? 'Acceder a sala multijugador'
            : 'Debes estar en un grupo para habilitar Multijugador';
        if (!linkMultijugador.dataset.dcMultijugadorBound) {
            linkMultijugador.dataset.dcMultijugadorBound = '1';
            linkMultijugador.addEventListener('click', (event) => {
                if (linkMultijugador.classList.contains('btn-menu-disabled')) {
                    bloquearNavegacionMultijugador(event);
                }
            });
        }
    }

    renderTimerRecompensaDiariaMenu();
    guardarSnapshotPerfilMenu(perfil);
}

function asegurarEstructuraGrupoMenu(perfil) {
    if (!perfil) {
        return;
    }
    let companion = perfil.querySelector('#menu-group-companion');
    let tradeBtn = perfil.querySelector('#menu-group-trade-btn');
    const leaveBtn = perfil.querySelector('#menu-group-leave-btn');

    if (companion && companion.tagName === 'BUTTON') {
        const div = document.createElement('div');
        div.id = 'menu-group-companion';
        div.className = 'menu-group-companion';
        div.style.display = companion.style.display;
        div.setAttribute('aria-label', 'Compañero de grupo');
        Array.from(companion.childNodes).forEach((nodo) => {
            if (nodo.nodeType === Node.ELEMENT_NODE && nodo.classList?.contains('menu-group-trade-label')) {
                return;
            }
            div.appendChild(nodo);
        });
        companion.replaceWith(div);
        companion = div;
    }

    if (!tradeBtn) {
        tradeBtn = document.createElement('button');
        tradeBtn.type = 'button';
        tradeBtn.id = 'menu-group-trade-btn';
        tradeBtn.className = 'btn btn-menu menu-group-trade-btn';
        tradeBtn.style.display = 'none';
        tradeBtn.title = 'Intercambiar cartas con tu compañero';
        tradeBtn.textContent = 'Intercambiar';
        if (companion && companion.parentNode === perfil) {
            if (leaveBtn && leaveBtn.parentNode === perfil) {
                perfil.insertBefore(tradeBtn, leaveBtn);
            } else {
                companion.insertAdjacentElement('afterend', tradeBtn);
            }
        } else {
            perfil.appendChild(tradeBtn);
        }
    }
}

function normalizarMenuLateral() {
    asegurarEstructuraMenuLateral();
    actualizarDatosMenuLateral();
}

function actualizarPanelPerfilTiempoReal() {
    actualizarDatosMenuLateral();
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
    localStorage.removeItem('dc_active_session_id_v1');
    sessionStorage.removeItem(DC_MENU_PROFILE_SNAPSHOT_KEY);
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

function reemplazarAvatarMenuSinListeners() {
    const avatar = document.getElementById('menu-user-avatar');
    if (!avatar || !avatar.parentNode) {
        return null;
    }
    const nuevo = avatar.cloneNode(true);
    delete nuevo.dataset.perfilModalPending;
    delete nuevo.dataset.perfilModalBound;
    avatar.parentNode.replaceChild(nuevo, avatar);
    return nuevo;
}

function enlazarAvatarPerfilMenu(avatarEl) {
    const avatar = avatarEl || document.getElementById('menu-user-avatar');
    if (!avatar) {
        return;
    }
    if (typeof window.DCPerfilModal?.enlazarAvatarMenu === 'function') {
        window.DCPerfilModal.enlazarAvatarMenu();
        return;
    }
    if (document.querySelector('script[data-dc-perfil-modal-js]')) {
        return;
    }
    if (avatar.dataset.perfilModalPending === '1') {
        return;
    }
    avatar.dataset.perfilModalPending = '1';
    avatar.classList.add('perfil-avatar-btn');
    avatar.setAttribute('role', 'button');
    avatar.setAttribute('tabindex', '0');
    avatar.setAttribute('aria-label', 'Abrir perfil del jugador');
    avatar.title = 'Ver perfil';
    const abrir = () => {
        if (typeof window.DCPerfilModal?.abrir === 'function') {
            void window.DCPerfilModal.abrir();
            return;
        }
        cargarRecursosPerfilModal();
    };
    avatar.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        abrir();
    });
    avatar.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            abrir();
        }
    });
}

function cargarRecursosPerfilModal() {
    if (document.querySelector('script[data-dc-perfil-modal-js]')) {
        if (typeof window.DCPerfilModal?.init === 'function') {
            window.DCPerfilModal.init();
        }
        return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'css/perfil-modal.css';
    link.dataset.dcPerfilModalCss = '1';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'js/perfilModal.js';
    script.dataset.dcPerfilModalJs = '1';
    script.onload = () => {
        reemplazarAvatarMenuSinListeners();
        if (typeof window.DCPerfilModal?.init === 'function') {
            window.DCPerfilModal.init();
        }
        if (typeof window.DCPerfilModal?.enlazarAvatarMenu === 'function') {
            window.DCPerfilModal.enlazarAvatarMenu();
        }
    };
    document.body.appendChild(script);
}

document.addEventListener('DOMContentLoaded', () => {
    iniciarSincronizacionSesionMultiCliente();
    asegurarEstructuraMenuLateral();
    actualizarDatosMenuLateral();
    if (typeof window.DCSesionUnica?.exigirSesionActivaLocal === 'function') {
        if (!window.DCSesionUnica.exigirSesionActivaLocal()) {
            return;
        }
    }
    aplicarColorPrincipalDesdeSesion();
    asegurarModalLogout();
    iniciarTimerRecompensaDiariaMenu();
    cargarRecursosPerfilModal();

    void (async () => {
        try {
            if (typeof XLSX !== 'undefined' && typeof window.DCCatalogoCartas?.cargarFilas === 'function') {
                void window.DCCatalogoCartas.cargarFilas().catch(() => {});
            }
            if (localStorage.getItem('email') && typeof window.refrescarUsuarioSesionDesdeServidor === 'function') {
                await window.refrescarUsuarioSesionDesdeServidor();
            }
            actualizarDatosMenuLateral();
            await migrarSkillsUsuarioDesdeCatalogo();
            iniciarChequeoRecompensaDiariaGlobal();
            void procesarRecompensaDiariaGlobal();
        } catch (error) {
            console.warn('[cartas] Inicialización en segundo plano:', error);
        }
    })();
});

window.addEventListener('dc:usuario-actualizado', () => {
    aplicarColorPrincipalDesdeSesion();
    actualizarPanelPerfilTiempoReal();
    renderTimerRecompensaDiariaMenu();
    enlazarAvatarPerfilMenu();
});

window.addEventListener('dc:grupo-actualizado', () => {
    actualizarPanelPerfilTiempoReal();
});

function bloquearNavegacionMultijugador(event) {
    event.preventDefault();
}

if (document.querySelector('.menu-container')) {
    asegurarEstructuraMenuLateral();
    actualizarDatosMenuLateral();
}