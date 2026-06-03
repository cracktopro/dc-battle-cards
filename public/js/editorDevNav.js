/**
 * Navegación entre herramientas internas de desarrollo + avisos al salir
 * (cambios sin guardar o guardados sin push a GitHub).
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

    let config = null;
    let gitPendiente = false;

    function mensajeGitPendiente(motivo) {
        if (motivo === 'sin_push') {
            return 'Hay commits locales que aún no se han subido a GitHub.';
        }
        return 'Hay cambios guardados en el servidor que aún no están en GitHub.';
    }

    async function consultarGitPendiente() {
        if (!config?.alcance) {
            return gitPendiente;
        }
        try {
            const res = await fetch(`/api/editors/git-push/pendiente?alcance=${encodeURIComponent(config.alcance)}`);
            if (!res.ok) {
                return gitPendiente;
            }
            const data = await res.json();
            gitPendiente = Boolean(data.pendiente);
            config.motivoGitPendiente = data.motivo || null;
            return gitPendiente;
        } catch (_e) {
            return gitPendiente;
        }
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
                + 'Si sales sin pulsar «Subir a GitHub», esos cambios pueden perderse en el próximo despliegue.\n\n'
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
        if (dirty || gitPendiente) {
            event.preventDefault();
            event.returnValue = '';
        }
    }

    /**
     * @param {{ vistaActual: string, alcance: 'cartas'|'episodios', getDirty: () => boolean, gitPushHabilitado?: boolean }} opts
     */
    function init(opts) {
        config = {
            ...opts,
            motivoGitPendiente: null,
        };
        montarNav(opts.vistaActual);
        window.addEventListener('beforeunload', onBeforeUnload);
        void consultarGitPendiente();
    }

    function marcarCambiosEnDisco() {
        gitPendiente = true;
        void consultarGitPendiente().then(() => {
            document.querySelectorAll('.crear-ep-header-acciones').forEach((tb) => {
                window.DCEditorGitPush?.actualizarEstadoPendienteGit?.(tb);
            });
        });
    }

    function marcarGitSincronizado() {
        gitPendiente = false;
        config.motivoGitPendiente = null;
        void consultarGitPendiente().then(() => {
            document.querySelectorAll('.crear-ep-header-acciones').forEach((tb) => {
                window.DCEditorGitPush?.actualizarEstadoPendienteGit?.(tb);
            });
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
