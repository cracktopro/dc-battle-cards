/**
 * Vista Episodios: carrusel 3D + catálogo desde episodios.xlsx.
 */
(function () {
    const PLACEHOLDER_IMG = 'resources/hud/universo.png';

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

    function urlImagenEpisodio(ep) {
        const raw = String(ep?.imagen || '').trim();
        if (!raw) {
            return PLACEHOLDER_IMG;
        }
        if (/^https?:\/\//i.test(raw)) {
            return raw;
        }
        return raw.startsWith('resources/') ? raw : `resources/${raw.replace(/^\/+/, '')}`;
    }

    function resolverJsonFile(ep) {
        const raw = String(ep?.JSON_file || ep?.json_file || '').trim();
        if (raw) {
            return raw.startsWith('resources/') ? raw : `resources/episodios/${raw.replace(/^\/+/, '')}`;
        }
        const id = String(ep?.evento_id ?? '').trim();
        if (id !== '') {
            return 'resources/episodios/ejemplo.json';
        }
        return '';
    }

    function mapearEpisodioDesdeFila(fila, idx) {
        const eventoId = fila.evento_id ?? fila.eventoId ?? idx;
        const ep = {
            evento_id: Number.isFinite(Number(eventoId)) ? Number(eventoId) : idx,
            nombre: String(fila.nombre || '').trim(),
            descripcion: String(fila.descripcion || '').trim(),
            imagen: String(fila.imagen || '').trim(),
            JSON_file: String(fila.JSON_file || fila.json_file || '').trim(),
        };
        ep.jsonPath = resolverJsonFile(ep);
        return ep;
    }

    function episodioEnFrente() {
        const n = episodios.length;
        if (!n) {
            return null;
        }
        const frente = ((spin % n) + n) % n;
        return episodios[frente] || null;
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

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'episodios-item-panel-btn';
        btn.textContent = 'Comenzar';
        btn.setAttribute('aria-label', `Comenzar episodio: ${ep.nombre || 'Sin título'}`);
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof window.DCEpisodioEngine?.iniciarEpisodio === 'function') {
                window.DCEpisodioEngine.iniciarEpisodio(ep);
            }
        });

        panel.appendChild(marcoImg);
        panel.appendChild(titulo);
        panel.appendChild(desc);
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
    }

    async function cargarEpisodiosDesdeExcel() {
        const response = await fetch('resources/episodios.xlsx');
        if (!response.ok) {
            throw new Error('No se pudo cargar episodios.xlsx');
        }
        const data = await response.arrayBuffer();
        if (typeof XLSX === 'undefined') {
            throw new Error('Biblioteca XLSX no disponible');
        }
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        return filas
            .map((fila, idx) => mapearEpisodioDesdeFila(fila, idx))
            .filter((ep) => ep.nombre)
            .sort((a, b) => a.evento_id - b.evento_id);
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
            const lista = await cargarEpisodiosDesdeExcel();
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
