/**
 * Cartas de jugador requeridas en combates de episodios (catálogo del usuario).
 */
(function (root) {
    function normalizarClave(nombre) {
        if (typeof root.normalizarClaveNombreCatalogo === 'function') {
            return root.normalizarClaveNombreCatalogo(nombre);
        }
        return String(nombre || '').trim().toLowerCase();
    }

    function nombreCatalogoDesdeRef(nombreRef) {
        if (typeof root.DCSkinsCartas !== 'undefined'
            && typeof root.DCSkinsCartas.obtenerNombreCatalogoDesdeReferencia === 'function') {
            return root.DCSkinsCartas.obtenerNombreCatalogoDesdeReferencia(nombreRef);
        }
        return String(nombreRef || '').trim();
    }

    /**
     * Nombres únicos de cartas_jugador en todos los bloques type:"combate" del timeline.
     * @param {object} episodioData
     * @returns {{ nombreRef: string, nombreCatalogo: string, clave: string }[]}
     */
    function iterarEventosTimelineEpisodio(episodioData, visitarEvento) {
        const caps = root.DCEpisodiosCapitulos?.normalizarCapitulos
            ? root.DCEpisodiosCapitulos.normalizarCapitulos(episodioData)
            : (Array.isArray(episodioData?.timeline) ? [{ timeline: episodioData.timeline }] : []);
        caps.forEach((cap) => {
            (Array.isArray(cap.timeline) ? cap.timeline : []).forEach((ev) => {
                if (typeof visitarEvento === 'function') {
                    visitarEvento(ev);
                }
            });
        });
    }

    function extraerCartasJugadorRequeridas(episodioData) {
        const vistos = new Set();
        const lista = [];

        iterarEventosTimelineEpisodio(episodioData, (ev) => {
            if (String(ev?.type || '').toLowerCase() !== 'combate') {
                return;
            }
            (Array.isArray(ev.cartas_jugador) ? ev.cartas_jugador : []).forEach((raw) => {
                const nombreRef = String(raw || '').trim();
                if (!nombreRef) {
                    return;
                }
                const nombreCatalogo = nombreCatalogoDesdeRef(nombreRef);
                const clave = normalizarClave(nombreCatalogo);
                if (!clave || vistos.has(clave)) {
                    return;
                }
                vistos.add(clave);
                lista.push({ nombreRef, nombreCatalogo, clave });
            });
        });

        return lista;
    }

    /** @returns {Set<string>} claves parent obtenidas en colección */
    function construirSetParentsObtenidos(usuario) {
        const set = new Set();
        const cartas = Array.isArray(usuario?.cartas) ? usuario.cartas : [];
        cartas.forEach((carta) => {
            if (typeof root.esCopiaBaseParentEnColeccion === 'function'
                && !root.esCopiaBaseParentEnColeccion(carta)) {
                return;
            }
            const clave = typeof root.obtenerClaveParentCartaColeccion === 'function'
                ? root.obtenerClaveParentCartaColeccion(carta)
                : normalizarClave(carta?.Nombre);
            if (clave) {
                set.add(clave);
            }
        });
        return set;
    }

    /**
     * @param {object|null} usuario
     * @param {{ nombreRef, nombreCatalogo, clave }[]} requeridas
     */
    function evaluarRequisitosCartasEpisodio(usuario, requeridas) {
        const lista = Array.isArray(requeridas) ? requeridas : [];
        if (!lista.length) {
            return { cumple: true, faltantes: [], detalle: [] };
        }

        const obtenidos = construirSetParentsObtenidos(usuario);
        const faltantes = [];
        const detalle = lista.map((req) => {
            const obtenida = obtenidos.has(req.clave);
            if (!obtenida) {
                faltantes.push(req);
            }
            return { ...req, obtenida };
        });

        return {
            cumple: faltantes.length === 0,
            faltantes,
            detalle,
        };
    }

    function resolverFilaCatalogo(nombreRef, mapaCatalogo) {
        if (typeof root.DCSkinsCartas?.resolverCartaEnemigoVistaSync === 'function'
            && mapaCatalogo instanceof Map) {
            const resuelta = root.DCSkinsCartas.resolverCartaEnemigoVistaSync(nombreRef, mapaCatalogo);
            if (resuelta) {
                return resuelta;
            }
        }
        const nombre = nombreCatalogoDesdeRef(nombreRef);
        const clave = normalizarClave(nombre);
        if (mapaCatalogo instanceof Map && mapaCatalogo.has(clave)) {
            return mapaCatalogo.get(clave);
        }
        return { Nombre: nombre || nombreRef, Nivel: 1 };
    }

    function obtenerImagenCarta(carta) {
        if (typeof root.obtenerImagenCarta === 'function') {
            return root.obtenerImagenCarta(carta);
        }
        const img = String(carta?.Imagen ?? carta?.imagen ?? '').trim();
        return img ? (img.startsWith('/') ? img : `/${img}`) : '';
    }

    function leerUsuarioLocal() {
        try {
            const raw = root.localStorage?.getItem('usuario');
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function esReferenciaApariencia(nombreRef) {
        return typeof root.DCSkinsCartas?.esReferenciaRecompensaSkin === 'function'
            && root.DCSkinsCartas.esReferenciaRecompensaSkin(nombreRef);
    }

    /** Etiqueta legible para UI y mensajes de error (incluye apariencias Parent[n]). */
    function etiquetaRequisitoCarta(req) {
        const nombreRef = String(req?.nombreRef || '').trim();
        const nombreCatalogo = String(req?.nombreCatalogo || nombreCatalogoDesdeRef(nombreRef)).trim();
        if (!esReferenciaApariencia(nombreRef)) {
            return nombreCatalogo || nombreRef;
        }
        const skinsApi = root.DCSkinsCartas;
        const ref = skinsApi?.parsearReferenciaCartaConSkin?.(nombreRef);
        const skin = ref?.skinId != null ? skinsApi?.obtenerSkinPorId?.(ref.skinId) : null;
        const nombreSkin = String(skin?.Nombre || '').trim();
        if (nombreSkin) {
            return `${nombreSkin} (apariencia de ${nombreCatalogo})`;
        }
        return `${nombreRef} (apariencia de ${nombreCatalogo})`;
    }

    function crearCartaRequeridaElemento(item, mapaCatalogo) {
        const cartaBase = resolverFilaCatalogo(item.nombreRef, mapaCatalogo);
        const card = document.createElement('div');
        card.className = 'evento-enemigo-card episodios-carta-requerida';
        if (!item.obtenida) {
            card.classList.add('episodios-carta-requerida--falta');
        }
        card.style.backgroundImage = `url(${obtenerImagenCarta(cartaBase)})`;
        const etiquetaTexto = etiquetaRequisitoCarta(item);
        card.title = item.obtenida
            ? `${etiquetaTexto} — en tu colección`
            : `${etiquetaTexto} — no la tienes en tu colección`;

        if (item.obtenida) {
            const badge = document.createElement('span');
            badge.className = 'episodios-carta-requerida-badge episodios-carta-requerida-badge--ok';
            badge.setAttribute('aria-label', 'En tu colección');
            badge.textContent = '✓';
            card.appendChild(badge);
        }

        const etiqueta = document.createElement('div');
        etiqueta.className = 'evento-enemigo-nombre';
        etiqueta.textContent = cartaBase.Nombre || item.nombreCatalogo;
        card.appendChild(etiqueta);
        return card;
    }

    function destruirCarruselRequeridas(caja) {
        if (caja?._carrusel3dDestroy) {
            caja._carrusel3dDestroy();
            caja._carrusel3dDestroy = null;
        }
    }

    function aplicarEstadoVisualCaraRequerida(cara, item) {
        if (!cara || !item) {
            return;
        }
        cara.classList.toggle('episodios-carta-requerida-cara--falta', !item.obtenida);
        if (!item.obtenida) {
            return;
        }
        const billboard = cara.querySelector('.carrusel-3d-cara-billboard');
        if (!billboard) {
            return;
        }
        const badge = document.createElement('span');
        badge.className = 'episodios-carta-requerida-badge episodios-carta-requerida-badge--ok';
        badge.setAttribute('aria-label', 'En tu colección');
        badge.textContent = '✓';
        billboard.appendChild(badge);
    }

    /**
     * Carrusel 3D de cartas requeridas (DCCarrusel3d, mismo patrón que eventos/desafíos).
     * @param {HTMLElement} caja — `.episodios-cartas-requeridas-caja`
     * @param {{ detalle: object[] }} evaluacion
     * @param {Map} mapaCatalogo
     */
    function renderizarCarruselCartasRequeridas(caja, evaluacion, mapaCatalogo) {
        if (!caja) {
            return;
        }
        const mount = caja.querySelector('.episodios-cartas-requeridas-carrusel-mount');
        if (!mount) {
            return;
        }

        destruirCarruselRequeridas(caja);
        mount.innerHTML = '';

        const detalle = Array.isArray(evaluacion?.detalle) ? evaluacion.detalle : [];
        caja.dataset.totalSlides = String(detalle.length);

        if (!detalle.length) {
            caja.dataset.indiceSlide = '0';
            const vacio = document.createElement('p');
            vacio.className = 'episodios-cartas-requeridas-vacio';
            vacio.textContent = 'Sin cartas de jugador en los combates de este episodio.';
            mount.appendChild(vacio);
            return;
        }

        const indicePrevio = Number(caja.dataset.indiceSlide || 0);
        const itemsCarrusel = detalle.map((item) => {
            const cartaBase = resolverFilaCatalogo(item.nombreRef, mapaCatalogo);
            return {
                nombre: cartaBase.Nombre || item.nombreCatalogo || etiquetaRequisitoCarta(item),
                imagenUrl: obtenerImagenCarta(cartaBase),
            };
        });

        if (typeof root.DCCarrusel3d?.montar !== 'function') {
            mount.appendChild(crearCartaRequeridaElemento(detalle[0], mapaCatalogo));
            return;
        }

        const handle = root.DCCarrusel3d.montar(mount, {
            items: itemsCarrusel,
            claseExtra: 'evento-enemigos-carrusel',
            ariaAnterior: 'Carta requerida anterior',
            ariaSiguiente: 'Siguiente carta requerida',
            indiceInicial: indicePrevio >= 0 && indicePrevio < detalle.length ? indicePrevio : 0,
            onFrenteChange: (idx) => {
                caja.dataset.indiceSlide = String(idx);
            },
        });
        caja._carrusel3dDestroy = handle.destroy;

        const caras = mount.querySelectorAll('.carrusel-3d-cara');
        detalle.forEach((item, i) => {
            aplicarEstadoVisualCaraRequerida(caras[i], item);
        });
    }

    /** @deprecated El carrusel 3D gestiona sus propios controles vía DCCarrusel3d. */
    function enlazarControlesCarruselCartasRequeridas(_caja) {
        /* noop */
    }

    /** @deprecated El carrusel 3D gestiona su propio índice vía onFrenteChange. */
    function actualizarCarruselCartasRequeridas(_caja, _indice) {
        /* noop */
    }

    /**
     * @deprecated Usar renderizarCarruselCartasRequeridas sobre la caja del carrusel.
     */
    function renderizarGridCartasRequeridas(contenedor, evaluacion, mapaCatalogo) {
        const caja = contenedor?.closest?.('.episodios-cartas-requeridas-caja') || contenedor;
        renderizarCarruselCartasRequeridas(caja, evaluacion, mapaCatalogo);
    }

    /**
     * Nivel de la copia base del jugador para una carta del catálogo (mayor Nivel si hay duplicados parent).
     * @param {object|null} usuario
     * @param {string} nombreRef — nombre como en JSON del episodio
     * @returns {number}
     */
    function obtenerMejorNivelCartaUsuario(usuario, nombreRef) {
        const claveObjetivo = normalizarClave(nombreCatalogoDesdeRef(nombreRef));
        if (!claveObjetivo) {
            return 1;
        }
        const cartas = Array.isArray(usuario?.cartas) ? usuario.cartas : [];
        let mejor = 0;
        cartas.forEach((carta) => {
            if (typeof root.esCopiaBaseParentEnColeccion === 'function'
                && !root.esCopiaBaseParentEnColeccion(carta)) {
                return;
            }
            const clave = typeof root.obtenerClaveParentCartaColeccion === 'function'
                ? root.obtenerClaveParentCartaColeccion(carta)
                : normalizarClave(carta?.Nombre);
            if (clave !== claveObjetivo) {
                return;
            }
            const nivel = Math.max(1, Number(carta?.Nivel || 1));
            if (nivel > mejor) {
                mejor = nivel;
            }
        });
        return mejor > 0 ? mejor : 1;
    }

    /**
     * @param {object} eventoCombate — bloque type combate del timeline
     * @param {object|null} usuario
     * @returns {{ Nombre: string, Nivel: number }[]}
     */
    function construirEntradasMazoJugadorEpisodio(eventoCombate, usuario) {
        const nombres = Array.isArray(eventoCombate?.cartas_jugador) ? eventoCombate.cartas_jugador : [];
        const nivelConfig = Number(eventoCombate?.nivel_jugador);
        const usarNivelCatalogo = nivelConfig === 0;

        return nombres.map((raw) => {
            const nombre = String(raw || '').trim();
            const nivel = usarNivelCatalogo
                ? obtenerMejorNivelCartaUsuario(usuario, nombre)
                : Math.max(1, Number.isFinite(nivelConfig) ? nivelConfig : 1);
            return { Nombre: nombre, Nivel: nivel };
        }).filter((e) => e.Nombre);
    }

    function obtenerSaludMaxCartaEpisodio(carta) {
        const salud = Number(carta?.SaludMax ?? carta?.Salud ?? carta?.Poder ?? 0);
        return Math.max(Number.isFinite(salud) ? salud : 0, 1);
    }

    function escalarCartaEpisodio(carta, nivelObjetivo) {
        const objetivo = Math.min(8, Math.max(1, Math.floor(Number(nivelObjetivo) || 1)));
        if (typeof root.DCEscaladoStatsCarta?.escalarCartaDeltaDificultad === 'function') {
            return root.DCEscaladoStatsCarta.escalarCartaDeltaDificultad(carta, objetivo, {
                maxNivel: 8,
                obtenerSaludMaxCarta: obtenerSaludMaxCartaEpisodio,
            });
        }
        const cartaEscalada = { ...carta };
        const nivelBase = Number(cartaEscalada.Nivel || 1);
        const incremento = Math.max(objetivo - nivelBase, 0) * 500;
        const saludBase = obtenerSaludMaxCartaEpisodio(cartaEscalada);
        cartaEscalada.Nivel = objetivo;
        cartaEscalada.Poder = Number(cartaEscalada.Poder || 0) + incremento;
        cartaEscalada.SaludMax = saludBase + incremento;
        cartaEscalada.Salud = cartaEscalada.SaludMax;
        if (typeof root.recalcularSkillPowerPorNivel === 'function') {
            root.recalcularSkillPowerPorNivel(cartaEscalada, objetivo, { rawEsBase: true });
        }
        return cartaEscalada;
    }

    /**
     * Cartas con stats de combate (Poder, Salud, habilidad…) para previa o UI.
     * @param {{ Nombre: string, Nivel: number }[]} entradas
     * @param {Map} mapaCatalogo
     * @returns {Promise<object[]>}
     */
    async function construirCartasEnriquecidasDesdeEntradas(entradas, mapaCatalogo) {
        const lista = Array.isArray(entradas) ? entradas : [];
        const mapa = mapaCatalogo instanceof Map ? mapaCatalogo : new Map();
        const salida = [];

        for (const entrada of lista) {
            const nombreRef = String(entrada?.Nombre || '').trim();
            const nivelObjetivo = Math.min(8, Math.max(1, Number(entrada?.Nivel || 1)));
            if (!nombreRef) {
                continue;
            }

            let fila = null;
            if (typeof root.DCSkinsCartas?.resolverFilaCatalogoConSkin === 'function') {
                fila = await root.DCSkinsCartas.resolverFilaCatalogoConSkin(nombreRef, mapa);
            } else {
                fila = resolverFilaCatalogo(nombreRef, mapa);
            }

            if (!fila || !String(fila.Nombre || '').trim()) {
                continue;
            }

            const stub = {
                Nombre: String(fila.Nombre || nombreRef).trim(),
                Nivel: 1,
                Poder: 0,
                Salud: 0,
                SaludMax: 0,
                faccion: fila.faccion || fila.Faccion || '',
                Faccion: fila.Faccion || fila.faccion || '',
                Afiliacion: fila.Afiliacion || fila.afiliacion || '',
            };

            let base = typeof root.fusionarCartaCompletaDesdeCatalogo === 'function'
                ? root.fusionarCartaCompletaDesdeCatalogo(stub, fila)
                : { ...fila, ...stub };

            base = escalarCartaEpisodio(base, nivelObjetivo);
            if (typeof root.DCSkinsCartas?.propagarAspectoSkinDesdeFilaResuelta === 'function') {
                base = root.DCSkinsCartas.propagarAspectoSkinDesdeFilaResuelta(base, fila);
            }
            salida.push(base);
        }

        return salida;
    }

    function mensajeFaltantes(evaluacion) {
        const faltantes = Array.isArray(evaluacion?.faltantes) ? evaluacion.faltantes : [];
        const nombres = faltantes
            .map((f) => etiquetaRequisitoCarta(f))
            .filter(Boolean);
        if (!nombres.length) {
            return '';
        }
        if (nombres.length === 1) {
            return `Te falta en tu colección: ${nombres[0]}.`;
        }
        return `Te faltan estas cartas en tu colección: ${nombres.join(', ')}.`;
    }

    root.DCEpisodiosRequisitos = {
        extraerCartasJugadorRequeridas,
        construirSetParentsObtenidos,
        evaluarRequisitosCartasEpisodio,
        resolverFilaCatalogo,
        renderizarGridCartasRequeridas,
        renderizarCarruselCartasRequeridas,
        enlazarControlesCarruselCartasRequeridas,
        actualizarCarruselCartasRequeridas,
        etiquetaRequisitoCarta,
        mensajeFaltantes,
        leerUsuarioLocal,
        nombreCatalogoDesdeRef,
        obtenerMejorNivelCartaUsuario,
        construirEntradasMazoJugadorEpisodio,
        construirCartasEnriquecidasDesdeEntradas,
    };
}(typeof window !== 'undefined' ? window : globalThis));
