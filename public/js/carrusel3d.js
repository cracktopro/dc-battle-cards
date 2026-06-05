/**
 * Carrusel 3D genérico (N ítems): flechas, cara al frente y nombre debajo.
 * Usado en paneles de eventos (vistaJuego); inspirado en el carrusel de asaltos.
 */
(function (root) {
    /**
     * @param {HTMLElement} contenedor
     * @param {{ items: Array<{ nombre: string, imagenUrl: string, boss?: boolean }>, claseExtra?: string, ariaAnterior?: string, ariaSiguiente?: string, onFrenteChange?: function }} opciones
     */
    function montarCarrusel3d(contenedor, opciones = {}) {
        if (!contenedor) {
            return { destroy() {} };
        }

        const items = Array.isArray(opciones.items) ? opciones.items : [];
        contenedor.innerHTML = '';
        contenedor.classList.add('carrusel-3d');
        if (opciones.claseExtra) {
            opciones.claseExtra.split(/\s+/).filter(Boolean).forEach((c) => contenedor.classList.add(c));
        }

        if (items.length === 0) {
            const vacio = document.createElement('p');
            vacio.className = 'carrusel-3d-vacio';
            vacio.textContent = 'Sin enemigos';
            contenedor.appendChild(vacio);
            return { destroy() { contenedor.innerHTML = ''; } };
        }

        const n = items.length;
        let spin = 0;
        if (opciones.indiceInicial != null && Number.isFinite(Number(opciones.indiceInicial))) {
            const idx = Number(opciones.indiceInicial);
            if (idx >= 0 && idx < n) {
                spin = idx;
            }
        } else if (opciones.iniciarEnBoss) {
            let indiceBoss = -1;
            items.forEach((item, i) => {
                if (item.boss) {
                    indiceBoss = i;
                }
            });
            if (indiceBoss >= 0) {
                spin = indiceBoss;
            }
        }
        const stepDeg = 360 / n;

        const controles = document.createElement('div');
        controles.className = 'carrusel-3d-controles';

        const btnIzq = document.createElement('button');
        btnIzq.type = 'button';
        btnIzq.className = 'carrusel-3d-flecha carrusel-3d-flecha--izq';
        btnIzq.setAttribute('aria-label', opciones.ariaAnterior || 'Anterior');
        btnIzq.textContent = '‹';

        const escena = document.createElement('div');
        escena.className = 'carrusel-3d-escena';
        escena.style.setProperty('--carrusel-3d-step', `${stepDeg}deg`);
        escena.style.setProperty('--carrusel-3d-spin', '0');

        const rueda = document.createElement('div');
        rueda.className = 'carrusel-3d-rueda';

        const caras = [];
        items.forEach((item, i) => {
            const cara = document.createElement('div');
            cara.className = 'carrusel-3d-cara';
            cara.style.setProperty('--carrusel-3d-i', String(i));
            if (item.boss) {
                cara.classList.add('carrusel-3d-cara--boss');
            }

            const billboard = document.createElement('div');
            billboard.className = 'carrusel-3d-cara-billboard';

            const img = document.createElement('img');
            img.src = String(item.imagenUrl || '').trim() || 'img/default-image.jpg';
            img.alt = '';
            img.draggable = false;
            img.loading = 'lazy';
            img.decoding = 'async';

            billboard.appendChild(img);
            cara.appendChild(billboard);
            rueda.appendChild(cara);
            caras.push(cara);
        });

        escena.appendChild(rueda);

        const btnDer = document.createElement('button');
        btnDer.type = 'button';
        btnDer.className = 'carrusel-3d-flecha carrusel-3d-flecha--der';
        btnDer.setAttribute('aria-label', opciones.ariaSiguiente || 'Siguiente');
        btnDer.textContent = '›';

        controles.appendChild(btnIzq);
        controles.appendChild(escena);
        controles.appendChild(btnDer);

        const nombreFrente = document.createElement('div');
        nombreFrente.className = 'carrusel-3d-nombre-frente';

        contenedor.appendChild(controles);
        contenedor.appendChild(nombreFrente);

        function aplicarSpin() {
            escena.style.setProperty('--carrusel-3d-spin', String(spin));
            const frente = ((spin % n) + n) % n;
            caras.forEach((cara, j) => {
                cara.classList.toggle('carrusel-3d-cara--frente', j === frente);
            });
            const item = items[frente];
            const baseNombre = String(item?.nombre || '—').trim() || '—';
            const sufijoBoss = item?.boss && opciones.sufijoBoss != null && opciones.sufijoBoss !== false
                ? String(opciones.sufijoBoss)
                : '';
            nombreFrente.textContent = sufijoBoss && !baseNombre.includes('(Boss)')
                ? `${baseNombre}${sufijoBoss}`
                : baseNombre;
            nombreFrente.classList.toggle('carrusel-3d-nombre-frente--boss', Boolean(item?.boss));
            if (typeof opciones.onFrenteChange === 'function') {
                opciones.onFrenteChange(frente, item);
            }
        }

        btnIzq.addEventListener('click', () => {
            spin -= 1;
            aplicarSpin();
        });
        btnDer.addEventListener('click', () => {
            spin += 1;
            aplicarSpin();
        });

        const navUnico = n <= 1;
        btnIzq.disabled = navUnico;
        btnDer.disabled = navUnico;

        aplicarSpin();

        return {
            destroy() {
                contenedor.innerHTML = '';
                contenedor.classList.remove('carrusel-3d');
                if (opciones.claseExtra) {
                    opciones.claseExtra.split(/\s+/).filter(Boolean).forEach((c) => contenedor.classList.remove(c));
                }
            },
        };
    }

    root.DCCarrusel3d = { montar: montarCarrusel3d };
}(typeof window !== 'undefined' ? window : globalThis));
