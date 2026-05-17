/**
 * Skins de carta: capa opcional sobre una fila del catálogo (cartas.xlsx) sin modificar la parent.
 * Referencia en Excel de modos PvE: "Batman[17]" → parent Batman + skin_id 17.
 */
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (root) {
        root.DCSkinsCartas = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this, function () {
    const SKIN_REF_REGEX = /^(.+?)\s*\[\s*(\d+)\s*\]\s*$/;

    let skinsPorIdCache = null;
    let skinsPorParentCache = null;
    let skinsLoadPromise = null;

    function normalizarClaveNombre(nombre) {
        return String(nombre || '').trim().toLowerCase();
    }

    function campoInformado(valor) {
        return String(valor ?? '').trim() !== '';
    }

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
     * @returns {{ nombreCatalogo: string, skinId: number|null, textoOriginal: string }}
     */
    function parsearReferenciaCartaConSkin(textoRaw) {
        const textoOriginal = String(textoRaw || '').trim();
        if (!textoOriginal) {
            return { nombreCatalogo: '', skinId: null, textoOriginal: '' };
        }
        const match = textoOriginal.match(SKIN_REF_REGEX);
        if (!match) {
            return { nombreCatalogo: textoOriginal, skinId: null, textoOriginal };
        }
        const nombreCatalogo = String(match[1] || '').trim();
        const skinId = Number(match[2]);
        return {
            nombreCatalogo: nombreCatalogo || textoOriginal,
            skinId: Number.isFinite(skinId) ? skinId : null,
            textoOriginal
        };
    }

    function obtenerNombreCatalogoDesdeReferencia(textoRaw) {
        return parsearReferenciaCartaConSkin(textoRaw).nombreCatalogo;
    }

    function normalizarFilaSkin(fila) {
        if (!fila || typeof fila !== 'object') {
            return null;
        }
        const skinId = parsearNumeroSeguro(fila.skin_id ?? fila.skinId ?? fila.id);
        if (skinId === null) {
            return null;
        }
        const parent = String(fila.parent ?? fila.Parent ?? '').trim();
        if (!parent) {
            return null;
        }
        return {
            skin_id: Math.round(skinId),
            parent,
            Nombre: String(fila.Nombre ?? fila.nombre ?? '').trim(),
            Salud: fila.Salud ?? fila.salud ?? '',
            Poder: fila.Poder ?? fila.poder ?? '',
            Imagen: String(fila.Imagen ?? fila.imagen ?? '').trim(),
            Afiliacion: String(fila.Afiliacion ?? fila.afiliacion ?? '').trim(),
            skill_name: String(fila.skill_name ?? '').trim(),
            skill_info: String(fila.skill_info ?? '').trim(),
            skill_class: String(fila.skill_class ?? '').trim().toLowerCase(),
            skill_power: fila.skill_power ?? fila.skill_poder ?? '',
            skill_trigger: String(fila.skill_trigger ?? '').trim().toLowerCase(),
            gratis: esTruthyExcel(fila.gratis ?? fila.Gratis ?? fila.GRATIS)
        };
    }

    function esTruthyExcel(valor) {
        const texto = String(valor ?? '').trim().toLowerCase();
        return texto === '1' || texto === 'true' || texto === 'si' || texto === 'sí' || texto === 'yes';
    }

    /** Nombre de catálogo (parent) de una carta de jugador/mazo. */
    function obtenerNombreParentCarta(carta) {
        const parentGuardado = String(carta?.skinParentNombre || '').trim();
        if (parentGuardado) {
            return parentGuardado;
        }
        const nombre = String(carta?.Nombre || '').trim();
        if (!nombre) {
            return '';
        }
        return parsearReferenciaCartaConSkin(nombre).nombreCatalogo || nombre;
    }

    function obtenerSkinsDelParent(parentNombre, indexados = null) {
        const clave = normalizarClaveNombre(parentNombre);
        if (!clave) {
            return [];
        }
        const mapa = indexados?.porParent || skinsPorParentCache;
        return mapa?.get(clave) ? [...mapa.get(clave)] : [];
    }

    function cartaTieneSkinsDisponibles(carta, indexados = null) {
        const parent = obtenerNombreParentCarta(carta);
        return obtenerSkinsDelParent(parent, indexados).length > 0;
    }

    function asegurarSkinsObtenidosUsuario(usuario) {
        if (!usuario || typeof usuario !== 'object') {
            return [];
        }
        if (!Array.isArray(usuario.skinsObtenidos)) {
            usuario.skinsObtenidos = [];
        }
        return usuario.skinsObtenidos;
    }

    function jugadorPoseeSkin(usuario, skin) {
        if (!skin) {
            return false;
        }
        if (skin.gratis) {
            return true;
        }
        const id = Math.round(Number(skin.skin_id));
        if (!Number.isFinite(id)) {
            return false;
        }
        const lista = asegurarSkinsObtenidosUsuario(usuario);
        return lista.some((item) => Math.round(Number(item)) === id);
    }

    function otorgarSkinUsuario(usuario, skinId) {
        const id = Math.round(Number(skinId));
        if (!Number.isFinite(id)) {
            return false;
        }
        const lista = asegurarSkinsObtenidosUsuario(usuario);
        if (lista.some((item) => Math.round(Number(item)) === id)) {
            return false;
        }
        lista.push(id);
        return true;
    }

    function fusionarAspectoDesdeFilaCatalogo(carta, filaCatalogo) {
        if (!carta || !filaCatalogo) {
            return carta;
        }
        const resultado = { ...carta };
        const nombreCat = String(filaCatalogo.Nombre || '').trim();
        if (nombreCat) {
            resultado.Nombre = nombreCat;
        }
        const img = String(filaCatalogo.Imagen ?? filaCatalogo.imagen ?? '').trim();
        if (img) {
            resultado.Imagen = img;
            resultado.imagen = img;
        }
        const afi = String(filaCatalogo.Afiliacion ?? filaCatalogo.afiliacion ?? '').trim();
        if (afi) {
            resultado.Afiliacion = afi;
            resultado.afiliacion = afi;
        }
        if (typeof window !== 'undefined' && typeof window.fusionarSkillDesdeFilaCatalogo === 'function') {
            return window.fusionarSkillDesdeFilaCatalogo(resultado, filaCatalogo);
        }
        if (String(filaCatalogo.skill_name || '').trim()) {
            resultado.skill_name = String(filaCatalogo.skill_name).trim();
        }
        if (String(filaCatalogo.skill_info || '').trim()) {
            resultado.skill_info = String(filaCatalogo.skill_info).trim();
        }
        if (String(filaCatalogo.skill_class || '').trim()) {
            resultado.skill_class = String(filaCatalogo.skill_class).trim().toLowerCase();
        }
        if (filaCatalogo.skill_power !== undefined && filaCatalogo.skill_power !== null && String(filaCatalogo.skill_power).trim() !== '') {
            resultado.skill_power = filaCatalogo.skill_power;
            resultado.skill_power_base = undefined;
        }
        if (String(filaCatalogo.skill_trigger || '').trim()) {
            resultado.skill_trigger = String(filaCatalogo.skill_trigger).trim().toLowerCase();
        }
        return resultado;
    }

    function obtenerEscaladoStatsApi() {
        const g = typeof globalThis !== 'undefined' ? globalThis : null;
        if (g?.DCEscaladoStatsCarta) {
            return g.DCEscaladoStatsCarta;
        }
        if (typeof window !== 'undefined' && window.DCEscaladoStatsCarta) {
            return window.DCEscaladoStatsCarta;
        }
        try {
            return require('./escaladoStatsCarta');
        } catch (_) {
            return null;
        }
    }

    function escalarStatJugadorDesdeBase(valorBase, nivelCarta, nivelBaseCatalogo, tipoStat) {
        const nivel = Math.max(1, Number(nivelCarta || 1));
        const nivelBase = Math.max(1, Number(nivelBaseCatalogo || 1));
        const base = Math.max(0, Number(valorBase || 0));
        const E = obtenerEscaladoStatsApi();
        if (E) {
            if (tipoStat === 'salud') {
                return E.calcularSaludEscaladaDesdeBase(Math.max(1, base), nivel, nivelBase);
            }
            return E.calcularPoderEscaladoDesdeBase(base, nivel, nivelBase);
        }
        const incremento = Math.max(nivel - nivelBase, 0) * 500;
        return base + incremento;
    }

    function restaurarStatsJugadorDesdeCatalogo(cartaJugador, filaCatalogoParent) {
        if (!cartaJugador || !filaCatalogoParent) {
            return cartaJugador;
        }
        const resultado = { ...cartaJugador };
        const nivelBase = Math.max(1, Number(filaCatalogoParent.Nivel || filaCatalogoParent.nivel || 1));
        const saludBase = Number(
            filaCatalogoParent.Salud ?? filaCatalogoParent.salud ?? filaCatalogoParent.Poder ?? filaCatalogoParent.poder ?? 0
        );
        const poderBase = Number(filaCatalogoParent.Poder ?? filaCatalogoParent.poder ?? 0);
        const saludEscalada = escalarStatJugadorDesdeBase(saludBase, resultado.Nivel, nivelBase, 'salud');
        const poderEscalado = escalarStatJugadorDesdeBase(poderBase, resultado.Nivel, nivelBase, 'poder');
        resultado.SaludMax = Math.max(1, saludEscalada);
        resultado.Salud = resultado.SaludMax;
        resultado.Poder = Math.max(0, poderEscalado);
        return resultado;
    }

    /**
     * Aplica un skin sobre la carta del jugador (aspecto + stats si el skin los define).
     */
    function aplicarSkinJugadorSobreCarta(cartaJugador, skin, filaCatalogoParent = null) {
        if (!cartaJugador || !skin) {
            return cartaJugador;
        }
        const parentNombre = obtenerNombreParentCarta(cartaJugador);
        const resultado = { ...cartaJugador };
        resultado.skinActivoId = skin.skin_id;
        resultado.skinParentNombre = parentNombre;
        const nivelBase = Math.max(1, Number(filaCatalogoParent?.Nivel || filaCatalogoParent?.nivel || 1));

        if (campoInformado(skin.Nombre)) {
            resultado.Nombre = String(skin.Nombre).trim();
        }
        if (campoInformado(skin.Imagen)) {
            const img = String(skin.Imagen).trim();
            resultado.Imagen = img;
            resultado.imagen = img;
            resultado.imagen_final = '';
            resultado.Imagen_final = '';
        }
        if (campoInformado(skin.Afiliacion)) {
            const afi = String(skin.Afiliacion).trim();
            resultado.Afiliacion = afi;
            resultado.afiliacion = afi;
        }
        if (campoInformado(skin.skill_name)) {
            resultado.skill_name = String(skin.skill_name).trim();
        }
        if (campoInformado(skin.skill_info)) {
            resultado.skill_info = String(skin.skill_info).trim();
        }
        if (campoInformado(skin.skill_class)) {
            resultado.skill_class = String(skin.skill_class).trim().toLowerCase();
        }
        if (campoInformado(skin.skill_power)) {
            resultado.skill_power = skin.skill_power;
            resultado.skill_power_base = undefined;
        }
        if (campoInformado(skin.skill_trigger)) {
            resultado.skill_trigger = String(skin.skill_trigger).trim().toLowerCase();
        }

        const saludSkin = parsearNumeroSeguro(skin.Salud);
        if (saludSkin !== null && saludSkin > 0) {
            const saludEscalada = escalarStatJugadorDesdeBase(saludSkin, resultado.Nivel, nivelBase, 'salud');
            resultado.SaludMax = Math.max(1, saludEscalada);
            resultado.Salud = resultado.SaludMax;
        }

        const poderSkin = parsearNumeroSeguro(skin.Poder);
        if (poderSkin !== null && poderSkin >= 0) {
            resultado.Poder = escalarStatJugadorDesdeBase(poderSkin, resultado.Nivel, nivelBase, 'poder');
        }

        if (typeof window !== 'undefined' && typeof window.recalcularSkillPowerPorNivel === 'function') {
            window.recalcularSkillPowerPorNivel(resultado, Number(resultado.Nivel || 1), { rawEsBase: true });
        }
        return resultado;
    }

    /** Restaura apariencia base (parent) y stats del catálogo escalados al nivel del jugador. */
    function quitarSkinJugadorDeCarta(cartaJugador, filaCatalogoParent) {
        if (!cartaJugador) {
            return cartaJugador;
        }
        const parentNombre = obtenerNombreParentCarta(cartaJugador);
        let resultado = { ...cartaJugador };
        resultado.skinActivoId = null;
        resultado.skinParentNombre = parentNombre;
        delete resultado._skinAplicado;

        if (filaCatalogoParent) {
            resultado = fusionarAspectoDesdeFilaCatalogo(resultado, filaCatalogoParent);
            resultado = restaurarStatsJugadorDesdeCatalogo(resultado, filaCatalogoParent);
        } else if (parentNombre) {
            resultado.Nombre = parentNombre;
        }

        if (typeof window !== 'undefined' && typeof window.recalcularSkillPowerPorNivel === 'function') {
            window.recalcularSkillPowerPorNivel(resultado, Number(resultado.Nivel || 1), { rawEsBase: true });
        }
        return resultado;
    }

    function construirVistaCartaJugadorConSkin(cartaJugador, skinId, filaCatalogoParent, indexados = null) {
        if (skinId === null || skinId === undefined) {
            return quitarSkinJugadorDeCarta(cartaJugador, filaCatalogoParent);
        }
        const skin = obtenerSkinPorId(skinId, indexados);
        if (!skin) {
            return { ...cartaJugador };
        }
        return aplicarSkinJugadorSobreCarta(cartaJugador, skin, filaCatalogoParent);
    }

    function indexarSkins(filas) {
        const porId = new Map();
        const porParent = new Map();
        (Array.isArray(filas) ? filas : []).forEach((fila) => {
            const skin = normalizarFilaSkin(fila);
            if (!skin) {
                return;
            }
            porId.set(skin.skin_id, skin);
            const claveParent = normalizarClaveNombre(skin.parent);
            if (!porParent.has(claveParent)) {
                porParent.set(claveParent, []);
            }
            porParent.get(claveParent).push(skin);
        });
        return { porId, porParent };
    }

    function obtenerUtilidadesXlsx() {
        if (typeof XLSX !== 'undefined' && XLSX?.utils?.sheet_to_json) {
            return XLSX.utils;
        }
        try {
            // eslint-disable-next-line global-require
            return require('xlsx').utils;
        } catch (_error) {
            return null;
        }
    }

    function leerSkinsDesdeWorkbook(workbook) {
        const utils = obtenerUtilidadesXlsx();
        if (!utils?.sheet_to_json || !workbook?.SheetNames?.length) {
            return indexarSkins([]);
        }
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const filas = utils.sheet_to_json(sheet, { defval: '' });
        return indexarSkins(filas);
    }

    async function cargarSkinsDesdeFetch() {
        const response = await fetch('resources/skins.xlsx');
        if (!response.ok) {
            throw new Error('No se pudo cargar skins.xlsx');
        }
        const data = await response.arrayBuffer();
        if (typeof XLSX === 'undefined') {
            throw new Error('XLSX no disponible para leer skins.xlsx');
        }
        const workbook = XLSX.read(data, { type: 'array' });
        return leerSkinsDesdeWorkbook(workbook);
    }

    function cargarSkinsDesdeFilesystem(rutaAbsoluta) {
        // eslint-disable-next-line global-require
        const XLSXNode = require('xlsx');
        // eslint-disable-next-line global-require
        const fs = require('fs');
        const buffer = fs.readFileSync(rutaAbsoluta);
        const workbook = XLSXNode.read(buffer, { type: 'buffer' });
        return leerSkinsDesdeWorkbook(workbook);
    }

    async function asegurarSkinsCargados(opciones = {}) {
        if (skinsPorIdCache && skinsPorParentCache) {
            return { porId: skinsPorIdCache, porParent: skinsPorParentCache };
        }
        if (!skinsLoadPromise) {
            skinsLoadPromise = (async () => {
                if (opciones.rutaFs) {
                    return cargarSkinsDesdeFilesystem(opciones.rutaFs);
                }
                return cargarSkinsDesdeFetch();
            })().catch((error) => {
                console.warn('skinsCartas: no se pudo cargar skins.xlsx', error);
                return indexarSkins([]);
            });
        }
        const indexados = await skinsLoadPromise;
        skinsPorIdCache = indexados.porId;
        skinsPorParentCache = indexados.porParent;
        return indexados;
    }

    function asegurarSkinsCargadosServidor(pathJoin, dirname) {
        if (skinsPorIdCache && skinsPorParentCache) {
            return { porId: skinsPorIdCache, porParent: skinsPorParentCache };
        }
        try {
            const ruta = pathJoin(dirname, 'public', 'resources', 'skins.xlsx');
            const indexados = cargarSkinsDesdeFilesystem(ruta);
            skinsPorIdCache = indexados.porId;
            skinsPorParentCache = indexados.porParent;
        } catch (error) {
            console.warn('skinsCartas (servidor): no se pudo cargar skins.xlsx', error.message);
            const vacio = indexarSkins([]);
            skinsPorIdCache = vacio.porId;
            skinsPorParentCache = vacio.porParent;
        }
        return { porId: skinsPorIdCache, porParent: skinsPorParentCache };
    }

    function obtenerSkinPorId(skinId, indexados = null) {
        const id = Number(skinId);
        if (!Number.isFinite(id)) {
            return null;
        }
        const mapa = indexados?.porId || skinsPorIdCache;
        return mapa?.get(Math.round(id)) || null;
    }

    function aplicarSkinSobreFilaCatalogo(filaParent, skin, ref = {}) {
        if (!filaParent || !skin) {
            return filaParent ? { ...filaParent } : null;
        }

        const parent = { ...filaParent };
        const resultado = { ...parent };

        resultado.skinActivoId = skin.skin_id;
        resultado.skinParentNombre = String(skin.parent || ref.nombreCatalogo || parent.Nombre || '').trim();
        resultado._skinAplicado = true;

        if (campoInformado(skin.Nombre)) {
            resultado.Nombre = String(skin.Nombre).trim();
        }

        const saludSkin = parsearNumeroSeguro(skin.Salud);
        if (saludSkin !== null && saludSkin > 0) {
            resultado.Salud = saludSkin;
            resultado.SaludMax = saludSkin;
        }

        const poderSkin = parsearNumeroSeguro(skin.Poder);
        if (poderSkin !== null && poderSkin >= 0) {
            resultado.Poder = poderSkin;
        }

        if (campoInformado(skin.Imagen)) {
            const img = String(skin.Imagen).trim();
            resultado.Imagen = img;
            resultado.imagen = img;
        }

        if (campoInformado(skin.Afiliacion)) {
            const afi = String(skin.Afiliacion).trim();
            resultado.Afiliacion = afi;
            resultado.afiliacion = afi;
        }

        if (campoInformado(skin.skill_name)) {
            resultado.skill_name = String(skin.skill_name).trim();
        }
        if (campoInformado(skin.skill_info)) {
            resultado.skill_info = String(skin.skill_info).trim();
        }
        if (campoInformado(skin.skill_class)) {
            resultado.skill_class = String(skin.skill_class).trim().toLowerCase();
        }
        if (campoInformado(skin.skill_power)) {
            resultado.skill_power = skin.skill_power;
            resultado.skill_power_base = undefined;
        }
        if (campoInformado(skin.skill_trigger)) {
            resultado.skill_trigger = String(skin.skill_trigger).trim().toLowerCase();
        }

        if (typeof window !== 'undefined' && typeof window.recalcularSkillPowerPorNivel === 'function') {
            window.recalcularSkillPowerPorNivel(resultado, Number(resultado.Nivel || 1), { rawEsBase: true });
        }

        return resultado;
    }

    function resolverFilaCatalogoConSkinSync(textoRaw, mapaPorNombre, indexados = null) {
        const ref = parsearReferenciaCartaConSkin(textoRaw);
        if (!ref.nombreCatalogo) {
            return null;
        }
        const claveParent = normalizarClaveNombre(ref.nombreCatalogo);
        const filaParent = mapaPorNombre?.get?.(claveParent) || mapaPorNombre?.[claveParent] || null;
        if (!filaParent) {
            return null;
        }
        if (ref.skinId === null || ref.skinId === undefined) {
            return { ...filaParent };
        }
        const skin = obtenerSkinPorId(ref.skinId, indexados);
        if (!skin) {
            console.warn(`Skin no encontrado: ${ref.textoOriginal} (id ${ref.skinId})`);
            return { ...filaParent };
        }
        const claveSkinParent = normalizarClaveNombre(skin.parent);
        if (claveSkinParent !== claveParent) {
            console.warn(
                `Skin ${ref.skinId} parent "${skin.parent}" no coincide con carta "${ref.nombreCatalogo}"`
            );
        }
        return aplicarSkinSobreFilaCatalogo(filaParent, skin, ref);
    }

    async function resolverFilaCatalogoConSkin(textoRaw, mapaPorNombre) {
        const indexados = await asegurarSkinsCargados();
        return resolverFilaCatalogoConSkinSync(textoRaw, mapaPorNombre, indexados);
    }

    function resolverFilaCatalogoConSkinServidor(textoRaw, mapaPorNombre, pathJoin, dirname) {
        const indexados = asegurarSkinsCargadosServidor(pathJoin, dirname);
        return resolverFilaCatalogoConSkinSync(textoRaw, mapaPorNombre, indexados);
    }

    /** Vista previa (eventos/desafíos): carta con skin si aplica. */
    async function resolverCartaParaVista(textoRaw, mapaPorNombre) {
        const resuelta = await resolverFilaCatalogoConSkin(textoRaw, mapaPorNombre);
        if (resuelta) {
            return resuelta;
        }
        const ref = parsearReferenciaCartaConSkin(textoRaw);
        const clave = normalizarClaveNombre(ref.nombreCatalogo);
        return mapaPorNombre?.get?.(clave) || null;
    }

    function esReferenciaRecompensaSkin(textoRaw) {
        const ref = parsearReferenciaCartaConSkin(textoRaw);
        return ref.skinId !== null && ref.skinId !== undefined;
    }

    /**
     * Payload de recompensa visual/persistencia cuando el Excel entrega "Parent[n]".
     * @returns {Promise<object|null>}
     */
    async function construirRecompensaSkinDesdeReferencia(textoRaw) {
        if (!esReferenciaRecompensaSkin(textoRaw)) {
            return null;
        }
        const ref = parsearReferenciaCartaConSkin(textoRaw);
        const indexados = await asegurarSkinsCargados();
        const skin = obtenerSkinPorId(ref.skinId, indexados);
        if (!skin) {
            throw new Error(`No se encontró la apariencia de recompensa: "${ref.textoOriginal}".`);
        }
        const nombreSkin = String(skin.Nombre || '').trim();
        const img = String(skin.Imagen || '').trim();
        return {
            tipoRecompensa: 'skin',
            skinId: Math.round(Number(ref.skinId)),
            nombreSkin: nombreSkin || `${skin.parent} (${ref.skinId})`,
            skinParentNombre: String(skin.parent || ref.nombreCatalogo || '').trim(),
            Imagen: img,
            imagen: img,
            referenciaOriginal: ref.textoOriginal,
        };
    }

    function aplicarRecompensaSkinEnUsuario(usuario, recompensaSkin) {
        if (!recompensaSkin || recompensaSkin.tipoRecompensa !== 'skin') {
            return { otorgado: false, yaTenia: false };
        }
        const skin = obtenerSkinPorId(recompensaSkin.skinId);
        const yaTenia = skin ? jugadorPoseeSkin(usuario, skin) : false;
        const otorgado = otorgarSkinUsuario(usuario, recompensaSkin.skinId);
        return { otorgado, yaTenia: yaTenia && !otorgado };
    }

    function separarRecompensasCartasYSkins(items) {
        const cartas = [];
        const skins = [];
        (Array.isArray(items) ? items : []).forEach((item) => {
            if (item?.tipoRecompensa === 'skin') {
                skins.push(item);
            } else if (item) {
                cartas.push(item);
            }
        });
        return { cartas, skins };
    }

    function persistirSkinsRecompensaEnUsuario(usuario, recompensasSkin) {
        (Array.isArray(recompensasSkin) ? recompensasSkin : []).forEach((skinRec) => {
            aplicarRecompensaSkinEnUsuario(usuario, skinRec);
        });
    }

    /** Panel de victoria: solo imagen + texto de apariencia obtenida. */
    function crearElementoRecompensaSkin(recompensaSkin) {
        if (typeof document === 'undefined' || !recompensaSkin) {
            return null;
        }
        const contenedor = document.createElement('div');
        contenedor.classList.add('carta-recompensa-slot', 'carta-recompensa-slot--skin');

        const etiqueta = document.createElement('div');
        etiqueta.classList.add('etiqueta-recompensa-skin');
        const nombre = String(recompensaSkin.nombreSkin || '').trim() || 'Apariencia';
        etiqueta.textContent = `Nueva apariencia obtenida: ${nombre}`;
        contenedor.appendChild(etiqueta);

        const cartaDiv = document.createElement('div');
        cartaDiv.classList.add('carta', 'carta-solo-vista', 'recompensa-skin-solo-imagen');
        const stubImagen = {
            skinActivoId: recompensaSkin.skinId,
            Imagen: recompensaSkin.Imagen || recompensaSkin.imagen,
            imagen: recompensaSkin.imagen || recompensaSkin.Imagen,
        };
        const imagenUrl = (typeof window !== 'undefined' && typeof window.obtenerImagenCarta === 'function')
            ? window.obtenerImagenCarta(stubImagen)
            : (String(stubImagen.Imagen || '').trim() || 'img/default-image.jpg');
        cartaDiv.style.backgroundImage = `url(${imagenUrl})`;
        cartaDiv.style.backgroundSize = 'cover';
        cartaDiv.style.backgroundPosition = 'center top';
        cartaDiv.setAttribute('aria-label', nombre);
        contenedor.appendChild(cartaDiv);

        return contenedor;
    }

    return {
        parsearReferenciaCartaConSkin,
        obtenerNombreCatalogoDesdeReferencia,
        obtenerNombreParentCarta,
        obtenerSkinsDelParent,
        cartaTieneSkinsDisponibles,
        asegurarSkinsObtenidosUsuario,
        jugadorPoseeSkin,
        otorgarSkinUsuario,
        aplicarSkinJugadorSobreCarta,
        quitarSkinJugadorDeCarta,
        construirVistaCartaJugadorConSkin,
        fusionarAspectoDesdeFilaCatalogo,
        asegurarSkinsCargados,
        asegurarSkinsCargadosServidor,
        obtenerSkinPorId,
        aplicarSkinSobreFilaCatalogo,
        resolverFilaCatalogoConSkin,
        resolverFilaCatalogoConSkinSync,
        resolverFilaCatalogoConSkinServidor,
        resolverCartaParaVista,
        esReferenciaRecompensaSkin,
        construirRecompensaSkinDesdeReferencia,
        aplicarRecompensaSkinEnUsuario,
        separarRecompensasCartasYSkins,
        persistirSkinsRecompensaEnUsuario,
        crearElementoRecompensaSkin
    };
});
