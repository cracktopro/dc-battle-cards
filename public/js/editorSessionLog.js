/**
 * Registro de cambios de la sesión en herramientas internas (localStorage).
 */
(function () {
    'use strict';

    const LS_KEY = 'dc_editor_session_log_v1';
    const MAX_ENTRADAS = 120;

    const ETIQUETAS_VISTA = {
        cartas: 'Editor cartas',
        skins: 'Editor skins',
        episodios: 'Editor episodios',
        desafios: 'Editor desafíos',
        asaltos: 'Editor asaltos',
        eventos: 'Editor eventos',
        eventosCoop: 'Editor eventos coop',
        despliegue: 'Despliegue',
    };

    function leerEntradas() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            const data = raw ? JSON.parse(raw) : [];
            return Array.isArray(data) ? data : [];
        } catch (_e) {
            return [];
        }
    }

    function guardarEntradas(lista) {
        localStorage.setItem(LS_KEY, JSON.stringify(lista.slice(-MAX_ENTRADAS)));
    }

    function formatearHora(iso) {
        try {
            const d = new Date(iso);
            return d.toLocaleString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            });
        } catch (_e) {
            return iso;
        }
    }

    function registrar(opts) {
        const entrada = {
            ts: new Date().toISOString(),
            vista: String(opts?.vista || 'desconocida'),
            accion: String(opts?.accion || 'cambio'),
            detalle: String(opts?.detalle || '').trim(),
            archivos: Array.isArray(opts?.archivos)
                ? opts.archivos.map((a) => String(a).trim()).filter(Boolean)
                : [],
        };
        const lista = leerEntradas();
        lista.push(entrada);
        guardarEntradas(lista);
        return entrada;
    }

    function registrarGuardado(vista, detalle, archivos) {
        return registrar({
            vista,
            accion: 'guardado',
            detalle: detalle || 'Guardado en disco del servidor',
            archivos,
        });
    }

    function registrarGitPushDev(vista, detalle, archivos) {
        return registrar({
            vista,
            accion: 'git_push_dev',
            detalle: detalle || 'Subida a GitHub (rama dev)',
            archivos,
        });
    }

    function registrarDespliegueProd(detalle, archivos) {
        return registrar({
            vista: 'despliegue',
            accion: 'git_push_prod',
            detalle: detalle || 'Subida a producción (rama main)',
            archivos,
        });
    }

    function limpiar() {
        localStorage.removeItem(LS_KEY);
    }

    function formatearEntrada(e) {
        const vista = ETIQUETAS_VISTA[e.vista] || e.vista;
        const archivos = e.archivos?.length ? `\n    └─ ${e.archivos.join('\n    └─ ')}` : '';
        const detalle = e.detalle ? `\n    ${e.detalle}` : '';
        let accion = e.accion;
        if (accion === 'guardado') accion = '💾 Guardado';
        else if (accion === 'git_push_dev') accion = '⬆ GitHub (dev)';
        else if (accion === 'git_push_prod') accion = '🚀 Producción (main)';
        return `[${formatearHora(e.ts)}] ${vista} — ${accion}${detalle}${archivos}`;
    }

    function formatearRegistroTexto(entradas) {
        const lista = Array.isArray(entradas) ? entradas : leerEntradas();
        if (!lista.length) {
            return 'Sin cambios registrados en esta sesión de navegador.\n\n'
                + 'Los registros aparecen al guardar desde los editores internos. '
                + 'La subida a GitHub se hace desde Despliegue → «Subir a GitHub».';
        }
        return lista.map(formatearEntrada).join('\n\n');
    }

    /** true si hay guardados en sesión sin un git_push_dev posterior */
    function tieneCambiosPendientesPush() {
        const entradas = leerEntradas();
        for (let i = entradas.length - 1; i >= 0; i -= 1) {
            if (entradas[i].accion === 'git_push_dev') {
                return false;
            }
            if (entradas[i].accion === 'guardado') {
                return true;
            }
        }
        return false;
    }

    window.DCEditorSessionLog = {
        registrar,
        registrarGuardado,
        registrarGitPushDev,
        registrarDespliegueProd,
        leerEntradas,
        limpiar,
        formatearRegistroTexto,
        formatearEntrada,
        tieneCambiosPendientesPush,
    };
})();
