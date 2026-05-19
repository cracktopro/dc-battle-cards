/**
 * UI compartida para paneles de evento (vistaJuego offline y multijugador coop online).
 */
(function (root) {
    const ICONO_MEJORA = '/resources/icons/mejora.png';
    const ICONO_MEJORA_ESPECIAL = '/resources/icons/mejora_especial.png';
    const ICONO_MONEDA = '/resources/icons/moneda.png';
    const ICONO_STAR6 = '/resources/icons/star6.png';
    const ICONO_CARDBACK_RANDOM = '/resources/icons/cardback_random.png';
    const EVENTO_DIFICULTAD_MAX = 6;
    const EVENTO_DIFICULTAD_MIN_MEJORA_ESPECIAL = 6;

    function escaparHTMLConsejos(texto) {
        return String(texto || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function crearContenidoEtiquetaDificultadEvento(nivel) {
        const frag = document.createDocumentFragment();
        frag.appendChild(document.createTextNode(`Nivel ${nivel} `));
        const estrellas = document.createElement('span');
        estrellas.className = 'evento-dificultad-estrellas';
        estrellas.setAttribute('aria-hidden', 'true');
        for (let i = 0; i < nivel; i++) {
            const img = document.createElement('img');
            img.src = ICONO_STAR6;
            img.alt = '';
            img.className = 'evento-dificultad-estrella';
            img.draggable = false;
            estrellas.appendChild(img);
        }
        frag.appendChild(estrellas);
        return frag;
    }

    function formatearHtmlTooltipCartaAleatoriaEvento() {
        const raw = 'Al completar este evento recibirás como recompensa una carta aleatoria. Tienes un $80%$ de recibir una carta de enemigo estándar y un $20%$ de recibir como recompensa la carta del Boss. El nivel de la carta obtenida equivaldrá al nivel de dificultad que escojas.';
        let html = escaparHTMLConsejos(raw);
        html = html.replace(/\$20%\$/g, '<span class="evento-tooltip-pct-boss">20%</span>');
        html = html.replace(/\$([^$]+)\$/g, '<span class="consejos-highlight">$1</span>');
        return html;
    }

    function enlazarTooltipCartaAleatoriaEvento(elemento) {
        if (!elemento) {
            return;
        }
        const meta = {
            nombre: 'Carta aleatoria',
            infoHtml: formatearHtmlTooltipCartaAleatoriaEvento(),
        };
        if (typeof root.enlazarTooltipHabilidadGlobal === 'function') {
            root.enlazarTooltipHabilidadGlobal(elemento, meta);
            return;
        }
        elemento.addEventListener('mouseenter', (ev) => {
            if (typeof root.mostrarTooltipHabilidadGlobal === 'function') {
                root.mostrarTooltipHabilidadGlobal(ev.clientX, ev.clientY, meta);
            }
        });
        elemento.addEventListener('mouseleave', () => {
            if (typeof root.ocultarTooltipHabilidadGlobal === 'function') {
                root.ocultarTooltipHabilidadGlobal();
            }
        });
    }

    function crearTagRecompensaEvento(iconSrc, alt, texto, { objeto = false } = {}) {
        const tag = document.createElement('div');
        tag.className = 'evento-recompensa-item';
        if (objeto) {
            tag.classList.add('evento-recompensa-item--objeto');
        }
        const img = document.createElement('img');
        img.src = iconSrc;
        img.alt = alt;
        img.className = 'evento-recompensa-item-icon';
        img.draggable = false;
        const span = document.createElement('span');
        span.className = 'evento-recompensa-item-txt';
        span.textContent = texto;
        tag.appendChild(img);
        tag.appendChild(span);
        return tag;
    }

    function calcularMonedasRecompensaEventoUi(puntosExcel, dificultad) {
        if (!Number.isFinite(Number(dificultad)) || Number(dificultad) < 1) {
            return null;
        }
        if (typeof root.calcularPuntosRecompensaEventoPorDificultad === 'function') {
            return root.calcularPuntosRecompensaEventoPorDificultad(puntosExcel, dificultad);
        }
        const pts = Math.max(0, Number(puntosExcel || 0));
        const dif = Math.min(EVENTO_DIFICULTAD_MAX, Math.max(1, Number(dificultad)));
        return Math.max(0, Math.round((dif / EVENTO_DIFICULTAD_MAX) * pts));
    }

    function actualizarRecompensasEventoUi(recompensasEl, evento, dificultad) {
        if (!recompensasEl || !evento) {
            return;
        }
        recompensasEl.innerHTML = '';

        const miniCarta = document.createElement('div');
        miniCarta.className = 'evento-recompensa-card evento-recompensa-carta-aleatoria';
        const imgBack = document.createElement('img');
        imgBack.src = ICONO_CARDBACK_RANDOM;
        imgBack.alt = 'Carta aleatoria de recompensa';
        imgBack.className = 'evento-recompensa-cardback-img';
        miniCarta.appendChild(imgBack);
        enlazarTooltipCartaAleatoriaEvento(miniCarta);
        recompensasEl.appendChild(miniCarta);

        const puntosExcel = Math.max(0, Number(evento.puntos || 0));
        const monedas = calcularMonedasRecompensaEventoUi(puntosExcel, dificultad);
        const textoMonedas = monedas != null ? monedas.toLocaleString('es-ES') : '—';
        recompensasEl.appendChild(crearTagRecompensaEvento(ICONO_MONEDA, 'Moneda', textoMonedas));

        const cantidadMejoras = Math.max(0, Number(evento.mejora || 0));
        if (cantidadMejoras > 0) {
            recompensasEl.appendChild(
                crearTagRecompensaEvento(ICONO_MEJORA, 'Mejora', `x${cantidadMejoras}`, { objeto: true })
            );
        }

        const cantidadEspeciales = Math.max(0, Number(evento.mejora_especial || 0));
        const difNum = Number(dificultad);
        if (cantidadEspeciales > 0 && Number.isFinite(difNum) && difNum >= EVENTO_DIFICULTAD_MIN_MEJORA_ESPECIAL) {
            recompensasEl.appendChild(
                crearTagRecompensaEvento(ICONO_MEJORA_ESPECIAL, 'Mejora especial', `x${cantidadEspeciales}`, { objeto: true })
            );
        }
    }

    function crearBloqueRecompensasEvento(evento, dificultadInicial) {
        const recompensasBloque = document.createElement('div');
        recompensasBloque.className = 'evento-recompensas-bloque';

        const recompensaLabel = document.createElement('div');
        recompensaLabel.className = 'evento-recompensas-label';
        recompensaLabel.textContent = 'Recompensas';

        const recompensasCaja = document.createElement('div');
        recompensasCaja.className = 'evento-recompensas-caja';

        const recompensas = document.createElement('div');
        recompensas.className = 'evento-recompensas';
        actualizarRecompensasEventoUi(recompensas, evento, dificultadInicial);

        recompensasCaja.appendChild(recompensas);
        recompensasBloque.appendChild(recompensaLabel);
        recompensasBloque.appendChild(recompensasCaja);

        return { bloque: recompensasBloque, recompensasEl: recompensas };
    }

    function crearSelectorDificultadEvento(evento, onChange, opciones = {}) {
        const wrap = document.createElement('div');
        wrap.className = 'evento-dificultad-picker';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'evento-dificultad-picker-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        if (opciones.disabled) {
            trigger.disabled = true;
        }

        const placeholder = document.createElement('span');
        placeholder.className = 'evento-dificultad-picker-placeholder';
        placeholder.textContent = 'Selecciona Dificultad';

        const valorEl = document.createElement('span');
        valorEl.className = 'evento-dificultad-picker-valor';
        valorEl.hidden = true;

        trigger.appendChild(placeholder);
        trigger.appendChild(valorEl);

        const lista = document.createElement('ul');
        lista.className = 'evento-dificultad-picker-lista';
        lista.setAttribute('role', 'listbox');
        lista.hidden = true;

        let cerrarFueraHandler = null;

        function cerrarLista() {
            lista.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            if (cerrarFueraHandler) {
                document.removeEventListener('click', cerrarFueraHandler);
                cerrarFueraHandler = null;
            }
        }

        function abrirLista() {
            if (opciones.disabled) {
                return;
            }
            lista.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            cerrarFueraHandler = (ev) => {
                if (!wrap.contains(ev.target)) {
                    cerrarLista();
                }
            };
            setTimeout(() => document.addEventListener('click', cerrarFueraHandler), 0);
        }

        function seleccionar(nivel) {
            const n = Number(nivel);
            valorEl.innerHTML = '';
            valorEl.appendChild(crearContenidoEtiquetaDificultadEvento(n));
            valorEl.hidden = false;
            placeholder.hidden = true;
            lista.querySelectorAll('.evento-dificultad-picker-opcion').forEach((op) => {
                const activa = Number(op.dataset.nivel) === n;
                op.classList.toggle('evento-dificultad-picker-opcion--activa', activa);
                op.setAttribute('aria-selected', activa ? 'true' : 'false');
            });
            if (typeof onChange === 'function') {
                onChange(n);
            }
        }

        for (let d = 1; d <= EVENTO_DIFICULTAD_MAX; d++) {
            const li = document.createElement('li');
            li.className = 'evento-dificultad-picker-opcion';
            li.setAttribute('role', 'option');
            li.dataset.nivel = String(d);
            li.appendChild(crearContenidoEtiquetaDificultadEvento(d));
            if (!opciones.disabled) {
                li.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    seleccionar(d);
                    cerrarLista();
                });
            }
            lista.appendChild(li);
        }

        trigger.addEventListener('click', (ev) => {
            ev.stopPropagation();
            if (lista.hidden) {
                abrirLista();
            } else {
                cerrarLista();
            }
        });

        if (evento.dificultadSeleccionada) {
            seleccionar(Number(evento.dificultadSeleccionada));
        }

        wrap.appendChild(trigger);
        wrap.appendChild(lista);
        return wrap;
    }

    /**
     * @param {object} evento — { enemigos?, boss? }
     * @param {Map} mapaCatalogo
     * @param {function} resolverCartaEnemigo — (nombreRef, mapa) => carta
     */
    function montarBloqueEnemigosEvento(evento, mapaCatalogo, resolverCartaEnemigo) {
        const enemigos = document.createElement('div');
        enemigos.className = 'evento-enemigos';
        const etiquetaEnemigos = document.createElement('div');
        etiquetaEnemigos.className = 'evento-enemigos-label';
        etiquetaEnemigos.textContent = 'Enemigos';

        const rivales = [
            ...(evento.enemigos || []).map((nombre) => ({ nombre, boss: false })),
            ...(evento.boss ? [{ nombre: evento.boss, boss: true }] : []),
        ];

        const obtenerImg = typeof root.obtenerImagenCarta === 'function'
            ? root.obtenerImagenCarta
            : () => '';

        const itemsCarruselEnemigos = rivales.map((rival) => {
            const cartaBase = resolverCartaEnemigo(rival.nombre, mapaCatalogo);
            return {
                nombre: cartaBase.Nombre || rival.nombre,
                imagenUrl: obtenerImg(cartaBase),
                boss: Boolean(rival.boss),
            };
        });

        const tieneBoss = rivales.some((rival) => rival.boss);
        const carruselMount = document.createElement('div');
        carruselMount.className = 'evento-enemigos-carrusel-mount';

        if (typeof root.DCCarrusel3d?.montar === 'function') {
            enemigos.appendChild(etiquetaEnemigos);
            enemigos.appendChild(carruselMount);
            root.DCCarrusel3d.montar(carruselMount, {
                items: itemsCarruselEnemigos,
                claseExtra: 'evento-enemigos-carrusel',
                ariaAnterior: 'Enemigo anterior',
                ariaSiguiente: 'Siguiente enemigo',
                sufijoBoss: ' (Boss)',
                iniciarEnBoss: tieneBoss,
            });
        } else {
            enemigos.classList.add('evento-enemigos--rejilla');
            enemigos.appendChild(etiquetaEnemigos);
            rivales.forEach((rival) => {
                const cartaBase = resolverCartaEnemigo(rival.nombre, mapaCatalogo);
                const enemigoCard = document.createElement('div');
                enemigoCard.className = `evento-enemigo-card ${rival.boss ? 'boss' : ''}`;
                enemigoCard.style.backgroundImage = `url(${obtenerImg(cartaBase)})`;

                const etiqueta = document.createElement('div');
                etiqueta.className = 'evento-enemigo-nombre';
                const nombreBase = cartaBase.Nombre || rival.nombre;
                etiqueta.textContent = rival.boss ? `${nombreBase} (Boss)` : nombreBase;
                enemigoCard.appendChild(etiqueta);
                enemigos.appendChild(enemigoCard);
            });
        }

        return enemigos;
    }

    root.DCEventoPanelUi = {
        EVENTO_DIFICULTAD_MAX,
        EVENTO_DIFICULTAD_MIN_MEJORA_ESPECIAL,
        actualizarRecompensasEventoUi,
        calcularMonedasRecompensaEventoUi,
        crearBloqueRecompensasEvento,
        crearContenidoEtiquetaDificultadEvento,
        crearSelectorDificultadEvento,
        crearTagRecompensaEvento,
        enlazarTooltipCartaAleatoriaEvento,
        montarBloqueEnemigosEvento,
    };
}(typeof window !== 'undefined' ? window : globalThis));
