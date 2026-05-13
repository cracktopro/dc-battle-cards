/**
 * Fondos de tablero: /resources/tableros/ (por defecto tablero_background.png).
 * - VS BOT: aleatorio vía GET /api/tableros (sessionStorage dc_tablero_fondo_url antes de tablero.html).
 * - Desafío / evento VS BOT / coop online: campo `tablero` del Excel (nombre archivo, con o sin extensión).
 */
(function () {
    const SESSION_KEY_VS_BOT = 'dc_tablero_fondo_url';
    const DEFAULT_TABLERO_URL = '/resources/tableros/tablero_background.png';

    function esVistaTableroJuego() {
        const p = String(location.pathname || '').toLowerCase();
        return p.endsWith('tablero.html') || p.endsWith('tablero_coop.html');
    }

    function aplicarFondo(url) {
        const u = url && String(url).trim() ? String(url).trim() : DEFAULT_TABLERO_URL;
        document.body.style.backgroundColor = '#020711';
        document.body.style.backgroundImage = `url("${u}")`;
        document.body.style.backgroundRepeat = 'no-repeat';
        document.body.style.backgroundPosition = 'center center';
        document.body.style.backgroundAttachment = 'fixed';
        document.body.style.backgroundSize = 'cover';
    }

    function nombreArchivoSeguro(raw) {
        const s = String(raw || '').trim();
        if (!s) return null;
        const base = s.replace(/^.*[/\\]/, '');
        if (!base || base === '.' || base === '..') return null;
        if (!/^[a-zA-Z0-9._-]+$/.test(base)) return null;
        return base;
    }

    function urlDesdeCampoExcel(valor) {
        const seg = nombreArchivoSeguro(valor);
        if (!seg) return null;
        const withExt = /\.(png|jpe?g|webp)$/i.test(seg) ? seg : `${seg}.png`;
        return `/resources/tableros/${withExt}`;
    }

    function fondoDesdeDesafioActivoLs() {
        try {
            const raw = localStorage.getItem('desafioActivo');
            if (!raw || raw === 'null' || raw === 'undefined') return null;
            const d = JSON.parse(raw);
            if (!d || typeof d !== 'object') return null;
            const t = String(d.tablero || '').trim();
            if (!t) return DEFAULT_TABLERO_URL;
            return urlDesdeCampoExcel(t) || DEFAULT_TABLERO_URL;
        } catch (_e) {
            return null;
        }
    }

    function esModoPvpVsHumano() {
        try {
            const raw = localStorage.getItem('desafioActivo');
            if (raw && raw !== 'null' && raw !== 'undefined') return false;
            const modo = String(localStorage.getItem('partidaModo') || '').trim().toLowerCase();
            if (modo === 'pvp') return true;
            if (String(localStorage.getItem('partidaPvpSessionId') || '').trim()) return true;
            return false;
        } catch (_e) {
            return false;
        }
    }

    function aplicarInicialTableroCoop() {
        try {
            const raw = localStorage.getItem('partidaCoopPayload');
            const payload = raw ? JSON.parse(raw) : null;
            const t = String(payload?.evento?.tablero || '').trim();
            if (t) {
                const u = urlDesdeCampoExcel(t);
                if (u) {
                    aplicarFondo(u);
                    return;
                }
            }
        } catch (_e) {
            /* noop */
        }
        aplicarFondo(DEFAULT_TABLERO_URL);
    }

    function aplicarInicialTableroClasico() {
        const fd = fondoDesdeDesafioActivoLs();
        if (fd) {
            aplicarFondo(fd);
            return;
        }

        if (esModoPvpVsHumano()) {
            aplicarFondo(DEFAULT_TABLERO_URL);
            return;
        }

        try {
            const urlSesion = sessionStorage.getItem(SESSION_KEY_VS_BOT);
            if (urlSesion && String(urlSesion).trim()) {
                aplicarFondo(String(urlSesion).trim());
                return;
            }
        } catch (_e) {
            /* noop */
        }

        aplicarFondo(DEFAULT_TABLERO_URL);
        void (async () => {
            const url = await elegirFondoVsBotDesdeApi();
            if (url) aplicarFondo(url);
        })();
    }

    async function elegirFondoVsBotDesdeApi() {
        try {
            const res = await fetch('/api/tableros');
            if (!res.ok) return null;
            const data = await res.json();
            const archivos = Array.isArray(data.archivos) ? data.archivos : [];
            const validos = archivos
                .map((f) => String(f || '').trim())
                .filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
            if (validos.length === 0) return null;
            const pick = validos[Math.floor(Math.random() * validos.length)];
            return `/resources/tableros/${pick}`;
        } catch (_e) {
            return null;
        }
    }

    window.dcLimpiarSesionFondoTableroVsBot = function dcLimpiarSesionFondoTableroVsBot() {
        try {
            sessionStorage.removeItem(SESSION_KEY_VS_BOT);
        } catch (_e) {
            /* noop */
        }
    };

    window.dcPrepararFondoTableroVsBot = async function dcPrepararFondoTableroVsBot() {
        const url = (await elegirFondoVsBotDesdeApi()) || DEFAULT_TABLERO_URL;
        try {
            sessionStorage.setItem(SESSION_KEY_VS_BOT, url);
        } catch (_e) {
            /* noop */
        }
        return url;
    };

    window.dcAplicarFondoTablero = aplicarFondo;
    window.dcUrlTableroDesdeNombreExcel = urlDesdeCampoExcel;

    if (!esVistaTableroJuego()) {
        return;
    }

    if (document.body.classList.contains('tablero-coop-body')) {
        aplicarInicialTableroCoop();
    } else {
        aplicarInicialTableroClasico();
    }
})();
