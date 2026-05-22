/**
 * Sesión única por cuenta: un nuevo login invalida dispositivos anteriores.
 */
(function iniciarModuloSesionUnica() {
    if (window.__dcSesionUnicaInit) {
        return;
    }
    window.__dcSesionUnicaInit = true;

    const DC_SESSION_ID_KEY = 'dc_active_session_id_v1';
    const RUTAS_CON_SESION = /^\/(get-user|update-user|validate-session)(\?|$)/;
    let _cerrandoSesion = false;

    function obtenerSessionIdActiva() {
        return String(localStorage.getItem(DC_SESSION_ID_KEY) || '').trim();
    }

    function adjuntarSesionAlCuerpo(cuerpo) {
        const base = (cuerpo && typeof cuerpo === 'object') ? { ...cuerpo } : {};
        const email = String(localStorage.getItem('email') || base.email || '').trim();
        const sessionId = obtenerSessionIdActiva();
        if (email) {
            base.email = email;
        }
        if (sessionId) {
            base.sessionId = sessionId;
        }
        return base;
    }

    function cerrarSesionPorReemplazo(mensaje) {
        if (_cerrandoSesion) {
            return;
        }
        _cerrandoSesion = true;
        const aviso = mensaje || 'Tu sesión se cerró porque iniciaste sesión en otro dispositivo.';
        try {
            sessionStorage.setItem('dc_sesion_cerrada_aviso', aviso);
        } catch (_e) {
            /* ignore */
        }
        localStorage.removeItem('usuario');
        localStorage.removeItem('email');
        localStorage.removeItem(DC_SESSION_ID_KEY);
        try {
            sessionStorage.removeItem('dc_menu_profile_snapshot_v1');
        } catch (_e2) {
            /* ignore */
        }
        localStorage.removeItem('grupoActual');
        localStorage.removeItem('grupoInvitacionEnCurso');
        localStorage.removeItem('jugandoPartida');
        localStorage.removeItem('mazoJugador');
        localStorage.removeItem('mazoOponente');
        localStorage.removeItem('nombreOponente');
        window.location.replace('/login.html?sesion=cerrada');
    }

    async function validarSesionActivaEnServidor() {
        const email = String(localStorage.getItem('email') || '').trim();
        const sessionId = obtenerSessionIdActiva();
        if (!email || !sessionId) {
            cerrarSesionPorReemplazo('Debes iniciar sesión de nuevo para continuar.');
            return false;
        }
        try {
            const response = await window.__dcFetchOriginal('/validate-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, sessionId })
            });
            const data = await response.json().catch(() => ({}));
            if (response.status === 401 && data?.codigo === 'SESSION_REPLACED') {
                cerrarSesionPorReemplazo(data.mensaje);
                return false;
            }
            return response.ok;
        } catch (_err) {
            return true;
        }
    }

    function guardarSesionActivaTrasLogin(email, usuario, sessionId) {
        const sid = String(sessionId || '').trim();
        if (!sid || !email) {
            return;
        }
        localStorage.setItem('email', email);
        localStorage.setItem(DC_SESSION_ID_KEY, sid);
        if (usuario && typeof usuario === 'object') {
            const copia = { ...usuario };
            delete copia.activeSessionId;
            delete copia.activeSessionAt;
            localStorage.setItem('usuario', JSON.stringify(copia));
        }
    }

    window.__dcFetchOriginal = window.__dcFetchOriginal || window.fetch.bind(window);
    window.fetch = async function fetchConSesionUnica(input, init) {
        const url = typeof input === 'string' ? input : String(input?.url || '');
        const rutaRelativa = url.replace(/^https?:\/\/[^/]+/i, '');
        const requiereSesion = RUTAS_CON_SESION.test(rutaRelativa);
        let opciones = init ? { ...init } : {};

        if (requiereSesion && String(opciones.method || 'GET').toUpperCase() === 'POST') {
            let cuerpo = {};
            if (opciones.body) {
                try {
                    cuerpo = JSON.parse(opciones.body);
                } catch (_parseErr) {
                    cuerpo = {};
                }
            }
            opciones = {
                ...opciones,
                body: JSON.stringify(adjuntarSesionAlCuerpo(cuerpo))
            };
        }

        const response = await window.__dcFetchOriginal(input, opciones);

        if (requiereSesion && response.status === 401) {
            const data = await response.clone().json().catch(() => ({}));
            if (data?.codigo === 'SESSION_REPLACED') {
                cerrarSesionPorReemplazo(data.mensaje);
            }
        }

        return response;
    };

    function tieneSesionActivaLocal() {
        return Boolean(
            String(localStorage.getItem('email') || '').trim()
            && obtenerSessionIdActiva()
        );
    }

    function exigirSesionActivaLocal() {
        if (tieneSesionActivaLocal()) {
            return true;
        }
        cerrarSesionPorReemplazo('Debes iniciar sesión de nuevo para continuar.');
        return false;
    }

    window.DCSesionUnica = {
        DC_SESSION_ID_KEY,
        obtenerSessionIdActiva,
        guardarSesionActivaTrasLogin,
        cerrarSesionPorReemplazo,
        validarSesionActivaEnServidor,
        adjuntarSesionAlCuerpo,
        tieneSesionActivaLocal,
        exigirSesionActivaLocal
    };
})();
