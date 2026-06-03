/**
 * Vista Episodios: carrusel 3D + catálogo desde metadatos en JSON (resources/episodios/).
 */
(function () {
    const PLACEHOLDER_IMG = window.DCEpisodiosCatalogo?.PLACEHOLDER || 'resources/hud/universo.png';

    const escena = document.getElementById('episodios-carrusel-escena');
    const rueda = document.getElementById('episodios-carrusel-rueda');
    const btnIzq = document.getElementById('episodios-flecha-izq');
    const btnDer = document.getElementById('episodios-flecha-der');
    const elNombreFrente = document.getElementById('episodios-nombre-frente');
    const elMensaje = document.getElementById('episodios-mensaje');
    const controles = document.getElementById('episodios-carrusel-controles');

    if (!escena || !rueda || !btnIzq || !btnDer) {
        return;
    }

    let episodios = [];
    let spin = 0;
    let caras = [];
    let mapaCatalogoCartas = null;
    let usuarioActual = null;

    function mostrarMensaje(texto) {
        if (!elMensaje) {
            return;
        }
        if (!texto) {
            elMensaje.style.display = 'none';
            elMensaje.textContent = '';
            return;
        }
        elMensaje.textContent = texto;
        elMensaje.style.display = 'block';
    }

    async function cargarCapitulosEpisodio(ep) {
        if (Array.isArray(ep._capitulos)) {
            return ep._capitulos;
        }
        if (ep._capitulosPromise) {
            return ep._capitulosPromise;
        }
        ep._capitulosPromise = (async () => {
            try {
                if (typeof window.DCEpisodioEngine?.cargarJsonEpisodio === 'function'
                    && typeof window.DCEpisodioEngine?.normalizarCapitulosDesdeDatos === 'function') {
                    const data = await window.DCEpisodioEngine.cargarJsonEpisodio(ep.jsonPath);
                    ep._capitulos = window.DCEpisodioEngine.normalizarCapitulosDesdeDatos(data);
                } else {
                    const res = await fetch(ep.jsonPath);
                    if (!res.ok) {
                        throw new Error(`HTTP ${res.status}`);
                    }
                    const data = await res.json();
                    ep._capitulos = window.DCEpisodiosCapitulos?.normalizarCapitulos
                        ? window.DCEpisodiosCapitulos.normalizarCapitulos(data)
                        : [{ capitulo_id: 'cap_01', nombre: 'Capítulo 1', descripcion: '', timeline: data.timeline || [] }];
                }
            } catch (err) {
                console.warn('No se pudieron cargar capítulos', ep.jsonPath, err);
                ep._capitulos = [];
            }
            return ep._capitulos;
        })();
        return ep._capitulosPromise;
    }

    function mostrarModalSeleccionCapitulos(ep, capitulos) {
        return new Promise((resolve) => {
            const overlay = document.getElementById('episodios-modal-capitulos');
            const titulo = document.getElementById('episodios-modal-capitulos-titulo');
            const subtitulo = document.getElementById('episodios-modal-capitulos-subtitulo');
            const lista = document.getElementById('episodios-modal-capitulos-lista');
            const btnCerrar = document.getElementById('episodios-modal-capitulos-cerrar');
            if (!overlay || !lista || !btnCerrar) {
                resolve(null);
                return;
            }

            const progreso = window.DCEpisodiosProgreso?.obtenerProgreso
                ? window.DCEpisodiosProgreso.obtenerProgreso(ep.evento_id, ep.jsonPath)
                : { capitulosCompletados: [] };
            const total = capitulos.length;

            if (titulo) {
                titulo.textContent = ep.nombre || 'Episodio';
            }
            if (subtitulo) {
                subtitulo.textContent = total > 1
                    ? 'Completa cada capítulo en orden para desbloquear el siguiente.'
                    : 'Elige el capítulo con el que quieres continuar la historia.';
            }

            lista.innerHTML = '';
            capitulos.forEach((cap, idx) => {
                const desbloqueado = window.DCEpisodiosProgreso?.capituloDesbloqueado
                    ? window.DCEpisodiosProgreso.capituloDesbloqueado(progreso, idx, total)
                    : idx === 0;
                const completado = window.DCEpisodiosProgreso?.capituloCompletado
                    ? window.DCEpisodiosProgreso.capituloCompletado(progreso, idx)
                    : false;

                const li = document.createElement('li');
                li.className = 'episodios-modal-capitulo-item';
                if (!desbloqueado) {
                    li.classList.add('episodios-modal-capitulo-item--bloqueado');
                }
                if (completado) {
                    li.classList.add('episodios-modal-capitulo-item--completado');
                }

                const num = document.createElement('span');
                num.className = 'episodios-modal-capitulo-num';
                num.textContent = String(idx + 1).padStart(2, '0');
                num.setAttribute('aria-hidden', 'true');

                const cuerpo = document.createElement('div');
                cuerpo.className = 'episodios-modal-capitulo-cuerpo';

                const filaTitulo = document.createElement('div');
                filaTitulo.className = 'episodios-modal-capitulo-fila-titulo';

                const nombre = document.createElement('span');
                nombre.className = 'episodios-modal-capitulo-nombre';
                nombre.textContent = cap.nombre || `Capítulo ${idx + 1}`;

                const estado = document.createElement('span');
                estado.className = 'episodios-modal-capitulo-estado';
                if (completado) {
                    estado.classList.add('episodios-modal-capitulo-estado--hecho');
                    estado.textContent = 'Completado';
                    estado.setAttribute('aria-label', 'Capítulo completado');
                } else if (!desbloqueado) {
                    estado.classList.add('episodios-modal-capitulo-estado--bloqueado');
                    estado.textContent = 'Bloqueado';
                    estado.setAttribute('aria-label', 'Capítulo bloqueado');
                }

                filaTitulo.appendChild(nombre);
                if (estado.textContent) {
                    filaTitulo.appendChild(estado);
                }

                cuerpo.appendChild(filaTitulo);

                const descTexto = String(cap.descripcion || '').trim();
                if (descTexto) {
                    const desc = document.createElement('p');
                    desc.className = 'episodios-modal-capitulo-desc';
                    desc.textContent = descTexto;
                    cuerpo.appendChild(desc);
                }

                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'episodios-modal-capitulo-btn';
                if (completado) {
                    btn.textContent = 'Repetir';
                } else if (desbloqueado) {
                    btn.textContent = idx === 0 && !progreso.capitulosCompletados.length ? 'Comenzar' : 'Jugar';
                } else {
                    btn.textContent = 'Bloqueado';
                }
                btn.disabled = !desbloqueado;
                btn.setAttribute('aria-label', `${cap.nombre || `Capítulo ${idx + 1}`}${desbloqueado ? '' : ' (bloqueado)'}`);

                li.appendChild(num);
                li.appendChild(cuerpo);
                li.appendChild(btn);
                lista.appendChild(li);

                if (desbloqueado) {
                    btn.addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        cerrar(idx);
                    }, { once: true });
                }
            });

            const marco = overlay.querySelector('.episodios-modal-capitulos-marco');
            if (marco) {
                marco.addEventListener('click', (ev) => ev.stopPropagation());
            }

            const onOverlayClick = (ev) => {
                if (ev.target === overlay) {
                    cerrar(null);
                }
            };

            const cerrar = (capituloIndex) => {
                overlay.hidden = true;
                overlay.style.display = 'none';
                overlay.removeEventListener('click', onOverlayClick);
                resolve(capituloIndex);
            };

            overlay.hidden = false;
            overlay.style.display = 'flex';
            btnCerrar.addEventListener('click', () => cerrar(null), { once: true });
            overlay.addEventListener('click', onOverlayClick);

            const primerJugable = lista.querySelector('.episodios-modal-capitulo-btn:not(:disabled)');
            if (primerJugable) {
                primerJugable.focus();
            } else {
                btnCerrar.focus();
            }
        });
    }

    function urlImagenEpisodio(ep) {
        if (typeof window.DCEpisodiosCatalogo?.urlImagenEpisodio === 'function') {
            return window.DCEpisodiosCatalogo.urlImagenEpisodio(ep);
        }
        const raw = String(ep?.imagen || '').trim();
        if (!raw) {
            return PLACEHOLDER_IMG;
        }
        if (/^https?:\/\//i.test(raw)) {
            return raw;
        }
        return raw.startsWith('resources/') ? raw : `resources/${raw.replace(/^\/+/, '')}`;
    }

    function episodioEnFrente() {
        const n = episodios.length;
        if (!n) {
            return null;
        }
        const frente = ((spin % n) + n) % n;
        return episodios[frente] || null;
    }

    function indiceCaraFrente() {
        const n = episodios.length;
        if (!n) {
            return -1;
        }
        return ((spin % n) + n) % n;
    }

    function actualizarUiFrente() {
        const ep = episodioEnFrente();
        if (elNombreFrente) {
            elNombreFrente.textContent = ep?.nombre || '—';
        }
        const multiples = episodios.length > 1;
        btnIzq.disabled = !multiples;
        btnDer.disabled = !multiples;
    }

    function normalizarClaveNombre(nombre) {
        if (typeof window.normalizarClaveNombreCatalogo === 'function') {
            return window.normalizarClaveNombreCatalogo(nombre);
        }
        return String(nombre || '').trim().toLowerCase();
    }

    async function asegurarCatalogoCartas() {
        if (mapaCatalogoCartas) {
            return mapaCatalogoCartas;
        }
        if (typeof window.DCCatalogoCartas?.obtenerMapaPorNombre === 'function') {
            mapaCatalogoCartas = await window.DCCatalogoCartas.obtenerMapaPorNombre();
            return mapaCatalogoCartas;
        }
        let filas = [];
        if (typeof window.DCCatalogoCartas?.obtenerFilas === 'function') {
            filas = await window.DCCatalogoCartas.obtenerFilas();
        } else {
            const res = await fetch('resources/cartas.xlsx');
            if (!res.ok) {
                throw new Error('No se pudo cargar cartas.xlsx');
            }
            const data = await res.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            filas = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        }
        mapaCatalogoCartas = new Map();
        (Array.isArray(filas) ? filas : []).forEach((carta) => {
            const clave = normalizarClaveNombre(carta.Nombre);
            if (clave && !mapaCatalogoCartas.has(clave)) {
                mapaCatalogoCartas.set(clave, carta);
            }
        });
        return mapaCatalogoCartas;
    }

    function refrescarUsuarioActual() {
        if (typeof window.DCEpisodiosRequisitos?.leerUsuarioLocal === 'function') {
            usuarioActual = window.DCEpisodiosRequisitos.leerUsuarioLocal();
        } else {
            try {
                const raw = localStorage.getItem('usuario');
                usuarioActual = raw ? JSON.parse(raw) : null;
            } catch {
                usuarioActual = null;
            }
        }
    }

    async function cargarCartasRequeridasEpisodio(ep) {
        if (!ep?.jsonPath) {
            ep._cartasRequeridas = [];
            return ep._cartasRequeridas;
        }
        if (Array.isArray(ep._cartasRequeridas)) {
            return ep._cartasRequeridas;
        }
        if (ep._cartasRequeridasPromise) {
            return ep._cartasRequeridasPromise;
        }
        ep._cartasRequeridasPromise = (async () => {
            try {
                const res = await fetch(ep.jsonPath);
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                const data = await res.json();
                const req = window.DCEpisodiosRequisitos;
                ep._cartasRequeridas = req && typeof req.extraerCartasJugadorRequeridas === 'function'
                    ? req.extraerCartasJugadorRequeridas(data)
                    : [];
            } catch (err) {
                console.warn('No se pudieron cargar requisitos del episodio', ep.jsonPath, err);
                ep._cartasRequeridas = [];
            }
            return ep._cartasRequeridas;
        })();
        return ep._cartasRequeridasPromise;
    }

    function evaluarEpisodio(ep) {
        const req = window.DCEpisodiosRequisitos;
        const requeridas = Array.isArray(ep?._cartasRequeridas) ? ep._cartasRequeridas : [];
        if (!req || typeof req.evaluarRequisitosCartasEpisodio !== 'function') {
            return { cumple: true, detalle: [], faltantes: [] };
        }
        return req.evaluarRequisitosCartasEpisodio(usuarioActual, requeridas);
    }

    function aplicarEstadoBotonComenzar(btn, evaluacion, cargando) {
        if (!btn) {
            return;
        }
        if (cargando) {
            btn.disabled = true;
            btn.textContent = 'Comenzar';
            btn.title = 'Cargando requisitos del episodio…';
            btn.classList.remove('episodios-item-panel-btn--bloqueado');
            return;
        }
        if (!evaluacion.cumple) {
            btn.disabled = true;
            btn.textContent = 'Cartas faltantes';
            btn.title = window.DCEpisodiosRequisitos?.mensajeFaltantes(evaluacion) || '';
            btn.classList.add('episodios-item-panel-btn--bloqueado');
            return;
        }
        btn.disabled = false;
        btn.textContent = 'Comenzar';
        btn.title = '';
        btn.classList.remove('episodios-item-panel-btn--bloqueado');
    }

    async function actualizarPanelCartasRequeridas(ep, elementosUi) {
        const {
            gridEl,
            avisoEl,
            bloqueEl,
            btnComenzar,
        } = elementosUi;

        if (!ep || !gridEl) {
            return;
        }

        aplicarEstadoBotonComenzar(btnComenzar, { cumple: true }, true);

        await cargarCartasRequeridasEpisodio(ep);
        const evaluacion = evaluarEpisodio(ep);
        const req = window.DCEpisodiosRequisitos;

        if (bloqueEl) {
            bloqueEl.hidden = !evaluacion.detalle.length && !(ep._cartasRequeridas || []).length;
        }

        if (req && typeof req.renderizarGridCartasRequeridas === 'function') {
            req.renderizarGridCartasRequeridas(gridEl, evaluacion, mapaCatalogoCartas);
        }

        if (avisoEl) {
            if (!evaluacion.cumple) {
                avisoEl.textContent = req?.mensajeFaltantes(evaluacion) || '';
                avisoEl.hidden = false;
            } else {
                avisoEl.textContent = '';
                avisoEl.hidden = true;
            }
        }

        aplicarEstadoBotonComenzar(btnComenzar, evaluacion, false);
    }

    async function actualizarRequisitosCaraFrente() {
        const idx = indiceCaraFrente();
        if (idx < 0 || !caras[idx]) {
            return;
        }
        const ep = episodios[idx];
        const panel = caras[idx].querySelector('.episodios-item-panel');
        if (!panel || !ep) {
            return;
        }
        await actualizarPanelCartasRequeridas(ep, {
            gridEl: panel.querySelector('.episodios-cartas-requeridas-grid'),
            avisoEl: panel.querySelector('.episodios-cartas-requeridas-aviso'),
            bloqueEl: panel.querySelector('.episodios-cartas-requeridas-bloque'),
            btnComenzar: panel.querySelector('.episodios-item-panel-btn'),
        });
    }

    function precargarRequisitosTodos() {
        episodios.forEach((ep) => {
            void cargarCartasRequeridasEpisodio(ep).then(() => {
                const idx = episodios.indexOf(ep);
                if (idx === indiceCaraFrente()) {
                    void actualizarRequisitosCaraFrente();
                }
            });
        });
    }

    function aplicarSpin() {
        const n = episodios.length;
        if (!n) {
            return;
        }
        const step = 360 / n;
        escena.classList.toggle('episodios-carrusel-escena--unico', n <= 1);
        escena.style.setProperty('--episodios-spin', String(spin));
        escena.style.setProperty('--episodios-step-num', String(step));
        const frente = ((spin % n) + n) % n;
        caras.forEach((cara, j) => {
            cara.classList.toggle('episodios-carrusel-cara--frente', j === frente);
        });
        actualizarUiFrente();
        void actualizarRequisitosCaraFrente();
    }

    function crearBloqueCartasRequeridas() {
        const bloque = document.createElement('div');
        bloque.className = 'episodios-cartas-requeridas-bloque';

        const label = document.createElement('div');
        label.className = 'episodios-cartas-requeridas-label';
        label.textContent = 'Cartas requeridas';

        const caja = document.createElement('div');
        caja.className = 'episodios-cartas-requeridas-caja';

        const grid = document.createElement('div');
        grid.className = 'episodios-cartas-requeridas-grid evento-enemigos--rejilla';

        const aviso = document.createElement('p');
        aviso.className = 'episodios-cartas-requeridas-aviso';
        aviso.hidden = true;

        caja.appendChild(grid);
        bloque.appendChild(label);
        bloque.appendChild(caja);
        bloque.appendChild(aviso);
        return bloque;
    }

    function crearCaraEpisodio(ep, indice) {
        const cara = document.createElement('div');
        cara.className = 'episodios-carrusel-cara';
        cara.style.setProperty('--episodios-i', String(indice));
        cara.dataset.eventoId = String(ep.evento_id);

        const billboard = document.createElement('div');
        billboard.className = 'episodios-carrusel-cara-billboard';

        const panel = document.createElement('article');
        panel.className = 'episodios-item-panel';

        const marcoImg = document.createElement('div');
        marcoImg.className = 'episodios-item-panel-img';
        const img = document.createElement('img');
        img.src = urlImagenEpisodio(ep);
        img.alt = ep.nombre || 'Episodio';
        img.loading = 'lazy';
        img.draggable = false;
        img.addEventListener('error', () => {
            img.src = PLACEHOLDER_IMG;
        });
        marcoImg.appendChild(img);

        const titulo = document.createElement('h3');
        titulo.className = 'episodios-item-panel-titulo';
        titulo.textContent = ep.nombre || 'Sin título';

        const desc = document.createElement('p');
        desc.className = 'episodios-item-panel-descripcion';
        desc.textContent = ep.descripcion || '';

        const bloqueCartas = crearBloqueCartasRequeridas();

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'episodios-item-panel-btn';
        btn.textContent = 'Comenzar';
        btn.setAttribute('aria-label', `Comenzar episodio: ${ep.nombre || 'Sin título'}`);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            void (async () => {
                const evaluacion = evaluarEpisodio(ep);
                if (!evaluacion.cumple) {
                    mostrarMensaje(
                        window.DCEpisodiosRequisitos?.mensajeFaltantes(evaluacion)
                        || 'No tienes todas las cartas requeridas en tu colección.'
                    );
                    return;
                }
                const capitulos = await cargarCapitulosEpisodio(ep);
                if (!capitulos.length) {
                    mostrarMensaje('Este episodio no tiene capítulos definidos.');
                    return;
                }
                const capituloIndex = await mostrarModalSeleccionCapitulos(ep, capitulos);
                if (capituloIndex == null || capituloIndex < 0) {
                    return;
                }
                mostrarMensaje('');
                if (typeof window.DCEpisodioEngine?.iniciarEpisodio === 'function') {
                    window.DCEpisodioEngine.iniciarEpisodio(ep, capituloIndex);
                }
            })();
        });

        const medio = document.createElement('div');
        medio.className = 'episodios-item-panel-medio';

        const cuerpo = document.createElement('div');
        cuerpo.className = 'episodios-item-panel-scroll';
        cuerpo.appendChild(titulo);
        cuerpo.appendChild(desc);

        medio.appendChild(cuerpo);
        medio.appendChild(bloqueCartas);

        panel.appendChild(marcoImg);
        panel.appendChild(medio);
        panel.appendChild(btn);
        billboard.appendChild(panel);
        cara.appendChild(billboard);
        return cara;
    }

    function construirCarrusel(lista) {
        episodios = lista;
        rueda.innerHTML = '';
        spin = 0;

        if (!episodios.length) {
            caras = [];
            if (controles) {
                controles.hidden = true;
            }
            actualizarUiFrente();
            return;
        }

        if (controles) {
            controles.hidden = false;
        }

        const n = episodios.length;
        const step = 360 / Math.max(n, 1);
        const radio = n <= 1 ? '0px' : `min(${Math.round(260 + n * 22)}px, ${Math.round(44 + n * 5)}vw)`;
        escena.classList.toggle('episodios-carrusel-escena--unico', n <= 1);
        escena.style.setProperty('--episodios-step-num', String(step));
        escena.style.setProperty('--episodios-radio', radio);

        episodios.forEach((ep, i) => {
            rueda.appendChild(crearCaraEpisodio(ep, i));
        });

        caras = rueda.querySelectorAll('.episodios-carrusel-cara');
        aplicarSpin();
        precargarRequisitosTodos();
    }

    async function cargarEpisodiosCatalogo() {
        if (typeof window.DCEpisodiosCatalogo?.cargarLista === 'function') {
            return window.DCEpisodiosCatalogo.cargarLista();
        }
        const response = await fetch('/api/episodios/catalogo');
        if (!response.ok) {
            throw new Error('No se pudo cargar el catálogo de episodios.');
        }
        const body = await response.json();
        return Array.isArray(body.episodios) ? body.episodios : [];
    }

    btnIzq.addEventListener('click', () => {
        if (episodios.length <= 1) {
            return;
        }
        spin -= 1;
        aplicarSpin();
    });

    btnDer.addEventListener('click', () => {
        if (episodios.length <= 1) {
            return;
        }
        spin += 1;
        aplicarSpin();
    });

    async function iniciar() {
        try {
            mostrarMensaje('');
            refrescarUsuarioActual();
            await asegurarCatalogoCartas();
            const lista = await cargarEpisodiosCatalogo();
            construirCarrusel(lista);
            if (!lista.length) {
                mostrarMensaje('No hay episodios disponibles en el catálogo.');
            }
        } catch (err) {
            console.error(err);
            construirCarrusel([]);
            mostrarMensaje('No se pudieron cargar los episodios. Inténtalo de nuevo más tarde.');
        }
    }

    document.addEventListener('DOMContentLoaded', iniciar);
})();
