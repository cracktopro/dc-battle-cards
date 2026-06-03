/**
 * Navegación entre herramientas internas de desarrollo + avisos al salir
 * (cambios sin guardar o guardados sin push a GitHub) + keepalive Render.
 */
(function () {
    'use strict';

    const VISTAS = [
        { id: 'cartas', href: 'editarCartas.html', label: 'Cartas' },
        { id: 'skins', href: 'editarSkins.html', label: 'Skins' },
        { id: 'episodios', href: 'crearEpisodios.html', label: 'Episodios' },
        { id: 'desafios', href: 'editarDesafios.html', label: 'Desafíos' },
        { id: 'asaltos', href: 'editarAsaltos.html', label: 'Asaltos' },
        { id: 'eventos', href: 'editarEventos.html', label: 'Eventos' },
        { id: 'eventosCoop', href: 'editarEventosCoop.html', label: 'Eventos Coop' },
        { id: 'despliegue', href: 'despliegue.html', label: 'Despliegue' },
    ];

    const VISTA_JUEGO_HREF = 'vistaJuego.html';
    const KEEPALIVE_MS = 60 * 1000;

    let config = null;
    let gitPendiente = false;
    let keepaliveTimer = null;

    function mensajeGitPendiente(motivo) {
        if (motivo === 'sin_push') {
            return 'Hay commits locales que aún no se han subido a GitHub.';
        }
        return 'Hay cambios guardados en el servidor que aún no están en GitHub (sube desde Despliegue).';
    }

    async function consultarGitPendiente() {
        try {
            const res = await fetch('/api/editors/git-push/pendiente?alcance=todos');
            if (!res.ok) {
                return gitPendiente;
            }
            const data = await res.json();
            gitPendiente = Boolean(data.pendiente);
            if (config) {
                config.motivoGitPendiente = data.motivo || null;
            }
            return gitPendiente;
        } catch (_e) {
            return gitPendiente;
        }
    }

    function debeMantenerKeepalive() {
        if (Boolean(config?.getDirty?.())) {
            return true;
        }
        if (window.DCEditorSessionLog?.tieneCambiosPendientesPush?.()) {
            return true;
        }
        return gitPendiente;
    }

    async function enviarKeepalive() {
        if (!debeMantenerKeepalive()) {
            return;
        }
        try {
            await fetch('/api/editors/keepalive');
        } catch (_e) { /* ignorar */ }
    }

    function iniciarKeepalive() {
        if (keepaliveTimer) {
            return;
        }
        keepaliveTimer = setInterval(() => {
            void enviarKeepalive();
        }, KEEPALIVE_MS);
        void enviarKeepalive();
    }

    async function confirmarAntesDeNavegar() {
        const dirty = Boolean(config?.getDirty?.());
        if (dirty) {
            const ok = window.confirm(
                'Hay cambios sin guardar en el editor. Si sales ahora, se perderán.\n\n¿Descartar y continuar?'
            );
            if (!ok) {
                return false;
            }
        }
        const pendiente = await consultarGitPendiente();
        if (pendiente) {
            const ok = window.confirm(
                `${mensajeGitPendiente(config?.motivoGitPendiente)}\n\n`
                + 'Sube los cambios desde la vista «Despliegue» → «Subir a GitHub» antes de salir, '
                + 'o Render puede perder los datos no subidos.\n\n'
                + '¿Continuar de todos modos?'
            );
            if (!ok) {
                return false;
            }
        }
        return true;
    }

    function montarNav(vistaActual) {
        const header = document.querySelector('.crear-ep-header');
        if (!header) {
            return;
        }
        let nav = document.getElementById('editor-dev-nav');
        if (!nav) {
            nav = document.createElement('nav');
            nav.id = 'editor-dev-nav';
            nav.className = 'editor-dev-nav';
            nav.setAttribute('aria-label', 'Herramientas de desarrollo');
            header.insertAdjacentElement('afterend', nav);
        }
        nav.innerHTML = '';
        VISTAS.forEach((vista) => {
            const link = document.createElement('a');
            link.href = vista.href;
            link.className = 'editor-dev-nav-btn'
                + (vista.id === vistaActual ? ' editor-dev-nav-btn--activo' : '');
            link.textContent = vista.label;
            if (vista.id === vistaActual) {
                link.setAttribute('aria-current', 'page');
            }
            link.addEventListener('click', async (event) => {
                if (vista.id === vistaActual) {
                    event.preventDefault();
                    return;
                }
                event.preventDefault();
                if (await confirmarAntesDeNavegar()) {
                    window.location.href = vista.href;
                }
            });
            nav.appendChild(link);
        });

        const volver = document.createElement('a');
        volver.href = VISTA_JUEGO_HREF;
        volver.className = 'editor-dev-nav-btn editor-dev-nav-btn--volver';
        volver.textContent = 'Volver al juego';
        volver.addEventListener('click', async (event) => {
            event.preventDefault();
            if (await confirmarAntesDeNavegar()) {
                window.location.href = VISTA_JUEGO_HREF;
            }
        });
        nav.appendChild(volver);
    }

    function onBeforeUnload(event) {
        const dirty = Boolean(config?.getDirty?.());
        if (dirty || gitPendiente || window.DCEditorSessionLog?.tieneCambiosPendientesPush?.()) {
            event.preventDefault();
            event.returnValue = '';
        }
    }

    /**
     * @param {{ vistaActual: string, getDirty?: () => boolean }} opts
     */
    function init(opts) {
        config = {
            ...opts,
            motivoGitPendiente: null,
        };
        montarNav(opts.vistaActual);
        window.addEventListener('beforeunload', onBeforeUnload);
        void consultarGitPendiente();
        iniciarKeepalive();
    }

    function marcarCambiosEnDisco() {
        gitPendiente = true;
        void consultarGitPendiente().then(() => {
            window.DCEditorGitPush?.actualizarEstadoPendienteGit?.(
                document.getElementById('despliegue-toolbar')
            );
        });
        void enviarKeepalive();
    }

    function marcarGitSincronizado() {
        gitPendiente = false;
        if (config) {
            config.motivoGitPendiente = null;
        }
        void consultarGitPendiente().then(() => {
            window.DCEditorGitPush?.actualizarEstadoPendienteGit?.(
                document.getElementById('despliegue-toolbar')
            );
        });
    }

    window.DCEditorDevNav = {
        VISTAS,
        init,
        confirmarAntesDeNavegar,
        consultarGitPendiente,
        marcarCambiosEnDisco,
        marcarGitSincronizado,
        hayGitPendiente: () => gitPendiente,
    };
})();
