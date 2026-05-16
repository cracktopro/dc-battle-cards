/**
 * Modal de apariencia al seleccionar cartas (desafíos, eventos, coop, crear mazo).
 * No modifica la colección del usuario; solo devuelve una copia con skin para esa selección.
 */
(function (root) {
    const MODAL_ID = 'modal-apariencia-seleccion-carta';
    const TAG = 'd' + 'iv';
    let skinSeleccionPendiente = null;
    let resolverPendiente = null;

    function obtenerApiSkins() {
        return typeof root.DCSkinsCartas !== 'undefined' ? root.DCSkinsCartas : null;
    }

    function normalizarClaveBusqueda(texto) {
        return String(texto || '').trim().toLowerCase();
    }

    function cartaCoincideBusqueda(carta, termino) {
        const t = normalizarClaveBusqueda(termino);
        if (!t) {
            return true;
        }
        const skins = obtenerApiSkins();
        const parent = skins?.obtenerNombreParentCarta
            ? skins.obtenerNombreParentCarta(carta)
            : String(carta?.Nombre || '');
        const nombre = String(carta?.Nombre || '');
        return normalizarClaveBusqueda(nombre).includes(t)
            || normalizarClaveBusqueda(parent).includes(t);
    }

    function resolverFilaCatalogo(carta, mapaCatalogo) {
        if (!carta || !mapaCatalogo) {
            return null;
        }
        const skins = obtenerApiSkins();
        const parent = skins?.obtenerNombreParentCarta
            ? skins.obtenerNombreParentCarta(carta)
            : String(carta?.Nombre || '').trim();
        const clave = typeof root.obtenerClaveCarta === 'function'
            ? root.obtenerClaveCarta(parent)
            : normalizarClaveBusqueda(parent);
        return mapaCatalogo.get(clave) || null;
    }

    async function aplicarSkinTemporalACarta(carta, skinId, mapaCatalogo) {
        const skins = obtenerApiSkins();
        if (!skins || !carta) {
            return { ...carta };
        }
        await skins.asegurarSkinsCargados();
        const filaParent = resolverFilaCatalogo(carta, mapaCatalogo);
        return skins.construirVistaCartaJugadorConSkin({ ...carta }, skinId, filaParent);
    }

    function requiereSeleccionApariencia(carta) {
        const skins = obtenerApiSkins();
        return Boolean(skins?.cartaTieneSkinsDisponibles?.(carta));
    }

    /** Vista parent para grids de selección: ignora skin guardado en colección/mazo ajeno. */
    function obtenerCartaComoParent(carta, mapaCatalogo) {
        const skins = obtenerApiSkins();
        if (!carta) {
            return carta;
        }
        const copia = { ...carta };
        if (!skins || typeof skins.quitarSkinJugadorDeCarta !== 'function') {
            copia.skinActivoId = null;
            delete copia._skinAplicado;
            return copia;
        }
        const filaParent = resolverFilaCatalogo(copia, mapaCatalogo);
        return skins.quitarSkinJugadorDeCarta(copia, filaParent);
    }

    function asegurarModal() {
        if (document.getElementById(MODAL_ID)) {
            return;
        }
        const modal = document.createElement(TAG);
        modal.id = MODAL_ID;
        modal.className = 'modal-dc';
        modal.style.display = 'none';

        const contenido = document.createElement(TAG);
        contenido.className = 'modal-dc-content modal-apariencias-carta modal-apariencia-seleccion-carta';

        const titulo = document.createElement('h4');
        titulo.className = 'modal-apariencia-seleccion-titulo';
        titulo.textContent = 'Elige una apariencia';

        const subtitulo = document.createElement('p');
        subtitulo.className = 'apariencias-carta-subtitulo modal-apariencia-seleccion-sub';

        const lista = document.createElement(TAG);
        lista.className = 'lista-apariencias-carta';
        lista.setAttribute('data-lista-apariencias', '');

        const acciones = document.createElement(TAG);
        acciones.className = 'modal-dc-actions';

        const btnCancelar = document.createElement('button');
        btnCancelar.type = 'button';
        btnCancelar.className = 'btn btn-secondary';
        btnCancelar.setAttribute('data-cancelar-apariencia', '');
        btnCancelar.textContent = 'Cancelar';

        const btnConfirmar = document.createElement('button');
        btnConfirmar.type = 'button';
        btnConfirmar.className = 'btn btn-primary';
        btnConfirmar.setAttribute('data-confirmar-apariencia', '');
        btnConfirmar.textContent = 'Aplicar';

        acciones.appendChild(btnCancelar);
        acciones.appendChild(btnConfirmar);
        contenido.appendChild(titulo);
        contenido.appendChild(subtitulo);
        contenido.appendChild(lista);
        contenido.appendChild(acciones);
        modal.appendChild(contenido);
        document.body.appendChild(modal);

        btnCancelar.addEventListener('click', () => cerrarModal(false));
        btnConfirmar.addEventListener('click', () => {
            if (!resolverPendiente) {
                cerrarModal(false);
                return;
            }
            resolverPendiente(skinSeleccionPendiente);
            resolverPendiente = null;
            cerrarModal(true);
        });
        modal.addEventListener('click', (ev) => {
            if (ev.target === modal) {
                cerrarModal(false);
            }
        });
    }

    function cerrarModal(confirmado) {
        const modal = document.getElementById(MODAL_ID);
        if (modal) {
            modal.style.display = 'none';
        }
        if (!confirmado && resolverPendiente) {
            const reject = resolverPendiente._onCancel;
            resolverPendiente = null;
            if (typeof reject === 'function') {
                reject();
            }
        }
        skinSeleccionPendiente = null;
    }

    function crearItemApariencia(cartaVista, opciones) {
        const item = document.createElement(TAG);
        item.className = 'carta item-carta-apariencia';
        if (opciones.seleccionada) {
            item.classList.add('seleccionada');
        }
        if (opciones.bloqueada) {
            item.classList.add('bloqueada');
        }
        if (typeof root.dcAplicarClasesNivelCartaCompleta === 'function') {
            root.dcAplicarClasesNivelCartaCompleta(item, cartaVista);
        } else if (Number(cartaVista?.Nivel || 1) >= 6) {
            item.classList.add('nivel-legendaria');
        }
        const imagenUrl = typeof root.obtenerImagenCarta === 'function'
            ? root.obtenerImagenCarta(cartaVista)
            : (cartaVista?.Imagen || 'img/default-image.jpg');
        item.style.backgroundImage = `url(${imagenUrl})`;
        item.style.backgroundSize = 'cover';
        item.style.backgroundPosition = 'center top';

        const detallesDiv = document.createElement(TAG);
        detallesDiv.className = 'detalles-carta';
        const nombreSpan = document.createElement('span');
        nombreSpan.className = 'nombre-carta';
        nombreSpan.textContent = cartaVista?.Nombre || '';
        const poderSpan = document.createElement('span');
        poderSpan.className = 'poder-carta';
        poderSpan.textContent = cartaVista?.Poder ?? 0;
        detallesDiv.appendChild(nombreSpan);
        detallesDiv.appendChild(poderSpan);
        item.appendChild(detallesDiv);

        if (typeof root.dcRellenarEstrellasCartaCompleta === 'function') {
            const estrellasDiv = document.createElement(TAG);
            estrellasDiv.className = 'estrellas-carta';
            root.dcRellenarEstrellasCartaCompleta(estrellasDiv, cartaVista, {});
            item.appendChild(estrellasDiv);
        }
        return item;
    }

    function abrirModalApariencia({ carta, usuario, mapaCatalogo }) {
        const skins = obtenerApiSkins();
        if (!skins || !carta) {
            return Promise.resolve(null);
        }
        return new Promise(async (resolve, reject) => {
            try {
                await skins.asegurarSkinsCargados();
                asegurarModal();
                const modal = document.getElementById(MODAL_ID);
                const lista = modal.querySelector('[data-lista-apariencias]');
                const subtitulo = modal.querySelector('.modal-apariencia-seleccion-sub');
                const parentNombre = skins.obtenerNombreParentCarta(carta);
                const filaParent = resolverFilaCatalogo(carta, mapaCatalogo);
                const skinsParent = skins.obtenerSkinsDelParent(parentNombre);

                skinSeleccionPendiente = null;

                if (subtitulo) {
                    subtitulo.textContent = `${parentNombre}: elige la apariencia para esta selección.`;
                }
                lista.innerHTML = '';

                const opciones = [
                    { skinId: null, desbloqueada: true },
                    ...skinsParent.map((skin) => ({
                        skinId: skin.skin_id,
                        desbloqueada: skins.jugadorPoseeSkin(usuario, skin)
                    }))
                ];

                opciones.forEach((opcion) => {
                    const cartaVista = skins.construirVistaCartaJugadorConSkin(carta, opcion.skinId, filaParent);
                    const seleccionada = skinSeleccionPendiente === opcion.skinId
                        || (opcion.skinId === null && (skinSeleccionPendiente === null || skinSeleccionPendiente === undefined));
                    const item = crearItemApariencia(cartaVista, {
                        seleccionada,
                        bloqueada: !opcion.desbloqueada
                    });
                    if (opcion.desbloqueada) {
                        item.addEventListener('click', () => {
                            lista.querySelectorAll('.item-carta-apariencia').forEach((el) => el.classList.remove('seleccionada'));
                            item.classList.add('seleccionada');
                            skinSeleccionPendiente = opcion.skinId;
                        });
                    }
                    lista.appendChild(item);
                });

                resolverPendiente = (skinId) => resolve(skinId);
                resolverPendiente._onCancel = reject;
                modal.style.display = 'flex';
            } catch (err) {
                reject(err);
            }
        });
    }

    async function seleccionarCartaConAparienciaOpcional({ carta, usuario, mapaCatalogo }) {
        const base = obtenerCartaComoParent(carta, mapaCatalogo);
        if (!requiereSeleccionApariencia(base)) {
            return base;
        }
        try {
            const skinId = await abrirModalApariencia({ carta: base, usuario, mapaCatalogo });
            return aplicarSkinTemporalACarta(base, skinId, mapaCatalogo);
        } catch (_cancelado) {
            return null;
        }
    }

    root.DCSeleccionCartaApariencia = {
        cartaCoincideBusqueda,
        requiereSeleccionApariencia,
        obtenerCartaComoParent,
        aplicarSkinTemporalACarta,
        seleccionarCartaConAparienciaOpcional,
        abrirModalApariencia,
        resolverFilaCatalogo
    };
})(typeof window !== 'undefined' ? window : globalThis);
