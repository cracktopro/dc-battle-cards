/**
 * Sobres de cartas (tienda fija + inventario / apertura en colección).
 */
(function () {
    const HUD_BASE = '/resources/hud/';
    /** Drop rate nivel de la carta otorgada (suma 100); H3/V3 garantizan 1 × nivel 6 adicional al reparto. */
    const DROP_NIVEL = [
        { nivel: 1, pct: 47 },
        { nivel: 2, pct: 20 },
        { nivel: 3, pct: 15 },
        { nivel: 4, pct: 10 },
        { nivel: 5, pct: 6 },
        { nivel: 6, pct: 2 }
    ];

    const ITEMS_SOBRES = [
        {
            id: 'obj-sobre-h1',
            inventarioKey: 'sobreH1',
            nombre: 'Sobre de cartas de héroe',
            descripcion: 'Contiene 3 cartas aleatorias de facción héroe. Rareza por probabilidad estándar.',
            precio: 1500,
            imagen: `${HUD_BASE}sobre_H1.png`,
            cantidadCartas: 3,
            faccion: 'H',
            garantiaNivel6: false
        },
        {
            id: 'obj-sobre-h2',
            inventarioKey: 'sobreH2',
            nombre: 'Sobre de cartas de héroe',
            descripcion: 'Contiene 6 cartas aleatorias de facción héroe. Rareza por probabilidad estándar.',
            precio: 3000,
            imagen: `${HUD_BASE}sobre_H2.png`,
            cantidadCartas: 6,
            faccion: 'H',
            garantiaNivel6: false
        },
        {
            id: 'obj-sobre-h3',
            inventarioKey: 'sobreH3',
            nombre: 'Sobre de cartas de héroe',
            descripcion: 'Contiene 12 cartas aleatorias de facción héroe. Incluye siempre una carta de nivel 6.',
            precio: 6000,
            imagen: `${HUD_BASE}sobre_H3.png`,
            cantidadCartas: 12,
            faccion: 'H',
            garantiaNivel6: true
        },
        {
            id: 'obj-sobre-v1',
            inventarioKey: 'sobreV1',
            nombre: 'Sobre de cartas de villano',
            descripcion: 'Contiene 3 cartas aleatorias de facción villano. Rareza por probabilidad estándar.',
            precio: 1500,
            imagen: `${HUD_BASE}sobre_V1.png`,
            cantidadCartas: 3,
            faccion: 'V',
            garantiaNivel6: false
        },
        {
            id: 'obj-sobre-v2',
            inventarioKey: 'sobreV2',
            nombre: 'Sobre de cartas de villano',
            descripcion: 'Contiene 6 cartas aleatorias de facción villano. Rareza por probabilidad estándar.',
            precio: 3000,
            imagen: `${HUD_BASE}sobre_V2.png`,
            cantidadCartas: 6,
            faccion: 'V',
            garantiaNivel6: false
        },
        {
            id: 'obj-sobre-v3',
            inventarioKey: 'sobreV3',
            nombre: 'Sobre de cartas de villano',
            descripcion: 'Contiene 12 cartas aleatorias de facción villano. Incluye siempre una carta de nivel 6.',
            precio: 6000,
            imagen: `${HUD_BASE}sobre_V3.png`,
            cantidadCartas: 12,
            faccion: 'V',
            garantiaNivel6: true
        }
    ];

    function normalizarFaccionSobre(valor) {
        const f = String(valor || '').trim().toUpperCase();
        return f === 'H' || f === 'V' ? f : '';
    }

    /** @returns {(carta:any) => boolean} */
    function filtroCatalogoPorFaccion(faccion) {
        const F = normalizarFaccionSobre(faccion);
        return (carta) => normalizarFaccionSobre(
            carta?.faccion || carta?.Faccion || ''
        ) === F;
    }

    function obtenerItemsSobresParaTienda() {
        return ITEMS_SOBRES.map((s) => ({
            id: s.id,
            nombre: s.nombre,
            descripcion: s.descripcion,
            precio: s.precio,
            icono: s.imagen
        }));
    }

    function mapIconosSobrePorId() {
        const m = {};
        ITEMS_SOBRES.forEach((s) => {
            m[s.id] = s.imagen;
        });
        return m;
    }

    function mapSobresPorId() {
        const m = {};
        ITEMS_SOBRES.forEach((s) => {
            m[s.id] = s;
        });
        return m;
    }

    function escalarPoderPorNivel(poderBase, nivel) {
        const base = Number(poderBase || 0);
        const objetivo = Math.max(1, Number(nivel || 1));
        return base + ((objetivo - 1) * 500);
    }

    function crearCartaReveladaDesdeCatalogo(cartaBase, nivel) {
        const fuente = typeof window.fusionarSkillDesdeFilaCatalogo === 'function'
            ? window.fusionarSkillDesdeFilaCatalogo({ ...cartaBase }, cartaBase)
            : { ...cartaBase };
        const saludBase = Number((fuente.SaludMax ?? fuente.Salud ?? fuente.Poder) || 0);
        const saludEscalada = escalarPoderPorNivel(saludBase, nivel);
        return {
            ...fuente,
            Nivel: nivel,
            Poder: escalarPoderPorNivel(cartaBase.Poder, nivel),
            SaludMax: saludEscalada,
            Salud: saludEscalada
        };
    }

    function tirarNivelPorDropRate() {
        const r = Math.random() * 100;
        let ac = 0;
        for (let i = 0; i < DROP_NIVEL.length; i++) {
            ac += DROP_NIVEL[i].pct;
            if (r < ac) {
                return DROP_NIVEL[i].nivel;
            }
        }
        return 6;
    }

    /** @returns {number[]} niveles ya mezclados */
    function generarNivelesParaSobre(cantidad, garantiaNivel6) {
        const total = Math.max(0, Math.floor(Number(cantidad || 0)));
        const niveles = [];
        const regulares = garantiaNivel6 ? Math.max(0, total - 1) : total;
        for (let i = 0; i < regulares; i++) {
            niveles.push(tirarNivelPorDropRate());
        }
        if (garantiaNivel6 && total >= 1) {
            niveles.push(6);
        }
        for (let i = niveles.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const t = niveles[i];
            niveles[i] = niveles[j];
            niveles[j] = t;
        }
        return niveles;
    }

    function elegirCartaBaseAleatoria(pool) {
        if (!Array.isArray(pool) || pool.length === 0) {
            return null;
        }
        const i = Math.floor(Math.random() * pool.length);
        return pool[i];
    }

    /**
     * @param catalogoEjemplo filas tipo Excel (colección/tienda)
     * @param {{ id:string }} def ITEMS_SOBRES entry
     */
    function generarCartasPremioDelSobre(catalogoEjemplo, def) {
        if (!def || !Array.isArray(catalogoEjemplo)) {
            return [];
        }
        const pred = filtroCatalogoPorFaccion(def.faccion);
        const pool = catalogoEjemplo.filter(pred);
        if (pool.length === 0) {
            return [];
        }
        const niveles = generarNivelesParaSobre(def.cantidadCartas, def.garantiaNivel6);
        const salida = [];
        niveles.forEach((nivel) => {
            const base = elegirCartaBaseAleatoria(pool);
            if (base) {
                salida.push(crearCartaReveladaDesdeCatalogo(base, nivel));
            }
        });
        return salida;
    }

    function clavesInventarioSobres() {
        return ITEMS_SOBRES.map((s) => s.inventarioKey);
    }

    function objetoInventarioPorDefecto() {
        const o = {};
        ITEMS_SOBRES.forEach((s) => {
            o[s.inventarioKey] = 0;
        });
        return o;
    }

    /**
     * Rellena claves sobreH1… sobreV3 sobre un objeto usuario.objetos existente sin pisar mejoras.
     */
    function mezclarInventarioSobresEnObjetos(objetos) {
        const base = objetos && typeof objetos === 'object' ? { ...objetos } : {};
        ITEMS_SOBRES.forEach((s) => {
            if (!(s.inventarioKey in base)) {
                base[s.inventarioKey] = 0;
            } else {
                base[s.inventarioKey] = Math.max(0, Math.floor(Number(base[s.inventarioKey] || 0)));
            }
        });
        return base;
    }

    window.DC_SOBRES_ITEMS_TIENDA = obtenerItemsSobresParaTienda;
    window.DC_SOBRES_ICONOS_POR_ID = mapIconosSobrePorId();
    window.DC_SOBRES_POR_ID = mapSobresPorId();
    window.DC_SOBRES_KEYS_INVENTARIO = clavesInventarioSobres;
    window.DC_SOBRES_INVENTARIO_CEROS = objetoInventarioPorDefecto;
    window.DC_SOBRES_MEZCLAR_INVENTARIO = mezclarInventarioSobresEnObjetos;
    window.DC_SOBRES_GENERAR_CARTAS = generarCartasPremioDelSobre;
    window.DC_SOBRES_DEFINICIONES = ITEMS_SOBRES;
}());
