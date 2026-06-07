/**
 * UI compartida: modal para subir cambios de editores a GitHub (rama dev).
 * El botón vive centralizado en despliegue.html; incluye todos los Excel/JSON de editores.
 */
(function () {
    'use strict';

    const LS_TOKEN_KEY = 'dc_editor_git_push_token_v1';
    const ENDPOINT_SESION = '/api/editors/git-push/dev';

    let dialogEl = null;
    let gitPushEstado = null;

    function $(id) {
        return document.getElementById(id);
    }

    function asegurarDialogo() {
        if (dialogEl) {
            return dialogEl;
        }
        dialogEl = document.createElement('dialog');
        dialogEl.id = 'editor-git-push-dialog';
        dialogEl.className = 'crear-ep-dialog-git-push';
        dialogEl.innerHTML = `
            <form method="dialog" class="crear-ep-dialog-git-push-inner">
                <h3 class="crear-ep-dialog-titulo">Subir cambios a GitHub</h3>
                <p id="editor-git-push-ayuda" class="crear-ep-dialog-ayuda"></p>
                <label class="crear-ep-field crear-ep-field--git-push" for="editor-git-push-mensaje">
                    <span>Mensaje del commit (opcional)</span>
                    <input type="text" id="editor-git-push-mensaje" class="crear-ep-select" autocomplete="off" spellcheck="false">
                </label>
                <label id="editor-git-push-token-wrap" class="crear-ep-field crear-ep-field--git-push" for="editor-git-push-token" hidden>
                    <span>Token de autorización</span>
                    <input type="password" id="editor-git-push-token" class="crear-ep-select" autocomplete="off" spellcheck="false">
                </label>
                <div id="editor-git-push-progreso" class="editor-git-push-progreso" hidden>
                    <div class="editor-git-push-progreso-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
                        <div class="editor-git-push-progreso-fill"></div>
                    </div>
                    <p id="editor-git-push-estado" class="editor-git-push-estado" aria-live="polite">Preparando…</p>
                </div>
                <p id="editor-git-push-resultado" class="editor-git-push-resultado" hidden></p>
                <div class="crear-ep-dialog-acciones">
                    <button type="button" id="editor-git-push-ejecutar" class="crear-ep-btn crear-ep-btn--primario">Subir a GitHub</button>
                    <button type="button" id="editor-git-push-cerrar" class="crear-ep-btn crear-ep-btn--secundario">Cerrar</button>
                </div>
            </form>
        `;
        document.body.appendChild(dialogEl);

        $('editor-git-push-cerrar')?.addEventListener('click', () => dialogEl.close());
        return dialogEl;
    }

    function setProgreso(visible, texto, pct) {
        const wrap = $('editor-git-push-progreso');
        const estado = $('editor-git-push-estado');
        const bar = wrap?.querySelector('.editor-git-push-progreso-bar');
        const fill = wrap?.querySelector('.editor-git-push-progreso-fill');
        if (wrap) wrap.hidden = !visible;
        if (estado && texto) estado.textContent = texto;
        const valor = typeof pct === 'number' ? Math.max(0, Math.min(100, pct)) : null;
        if (bar && valor !== null) {
            bar.setAttribute('aria-valuenow', String(valor));
        }
        if (fill && valor !== null) {
            fill.style.width = `${valor}%`;
        }
    }

    function mostrarResultado(html, esError) {
        const el = $('editor-git-push-resultado');
        if (!el) return;
        el.hidden = false;
        el.className = 'editor-git-push-resultado' + (esError ? ' editor-git-push-resultado--error' : ' editor-git-push-resultado--ok');
        el.innerHTML = html;
    }

    function resetModal(rama) {
        const ayuda = $('editor-git-push-ayuda');
        const mensaje = $('editor-git-push-mensaje');
        const tokenWrap = $('editor-git-push-token-wrap');
        const tokenInput = $('editor-git-push-token');
        const resultado = $('editor-git-push-resultado');
        const ejecutar = $('editor-git-push-ejecutar');

        if (ayuda) {
            ayuda.textContent = `Se hará un único commit con todos los archivos de editor modificados (cartas, desafíos, asaltos, eventos, skins, episodios…) y push a la rama «${rama}». Guarda en cada vista antes de subir.`;
        }
        if (mensaje) mensaje.value = '';
        if (resultado) {
            resultado.hidden = true;
            resultado.textContent = '';
        }
        if (tokenWrap) {
            tokenWrap.hidden = !gitPushEstado?.requiereTokenCliente;
        }
        if (tokenInput && gitPushEstado?.requiereTokenCliente) {
            tokenInput.value = localStorage.getItem(LS_TOKEN_KEY) || '';
        }
        if (ejecutar) ejecutar.disabled = false;
        setProgreso(false);
    }

    async function esperarDeployTrasPush(data, destino, onProgreso) {
        if (!data || data.sinCambios || !data.commitSha || !window.DCEditorDeployMonitor) {
            return null;
        }
        return window.DCEditorDeployMonitor.esperarDeploy({
            commitEsperado: data.commitSha,
            destino,
            onProgreso,
        });
    }

    async function abrirModal(opciones) {
        const dialog = asegurarDialogo();
        gitPushEstado = gitPushEstado || await cargarEstado();
        resetModal(gitPushEstado?.rama || 'dev');

        const ejecutar = $('editor-git-push-ejecutar');
        const handler = async () => {
            if (opciones?.getDirty?.()) {
                window.alert('Hay cambios sin guardar en el editor actual. Pulsa Guardar antes de subir a GitHub.');
                return;
            }

            ejecutar.disabled = true;
            setProgreso(true, 'Preparando commit…', 15);

            const mensaje = $('editor-git-push-mensaje')?.value?.trim() || '';
            const token = $('editor-git-push-token')?.value?.trim() || '';
            if (gitPushEstado?.requiereTokenCliente && token) {
                localStorage.setItem(LS_TOKEN_KEY, token);
            }

            const headers = { 'Content-Type': 'application/json' };
            if (token) {
                headers['X-Editor-Git-Token'] = token;
            }

            try {
                setProgreso(true, 'Creando commit…', 45);
                const res = await fetch(ENDPOINT_SESION, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ mensaje }),
                });
                setProgreso(true, 'Enviando a GitHub…', 80);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(data.detalle || data.error || `HTTP ${res.status}`);
                }

                let htmlResultado = '';
                if (data.sinCambios) {
                    htmlResultado = 'No había cambios nuevos respecto al último commit en el servidor.';
                } else {
                    htmlResultado = `Subida completada a <strong>${data.rama || gitPushEstado?.rama || 'dev'}</strong>.`
                        + (data.commit ? `<br><code>${data.commit}</code>` : '');

                    const deployResult = await esperarDeployTrasPush(data, 'dev', (p) => {
                        if (p.fase === 'completado') {
                            setProgreso(true, p.mensaje, 100);
                        } else {
                            setProgreso(true, p.mensaje, 95);
                        }
                    });
                    htmlResultado += window.DCEditorDeployMonitor?.mensajeResultadoMonitor?.(deployResult, 'dev') || '';

                    window.DCEditorSessionLog?.registrarGitPushDev?.(
                        'despliegue',
                        data.commit || 'Push a dev completado',
                        data.archivos || []
                    );
                }

                setProgreso(true, data.sinCambios ? 'Completado' : 'Listo', 100);
                mostrarResultado(htmlResultado, false);
                if (!data.sinCambios) {
                    window.DCEditorDevNav?.marcarGitSincronizado();
                }
                void actualizarEstadoPendienteGit(document.getElementById('despliegue-toolbar'));
                opciones?.onSuccess?.(data);
            } catch (err) {
                setProgreso(true, 'Error', 100);
                mostrarResultado(String(err.message || err), true);
            } finally {
                ejecutar.disabled = false;
            }
        };

        ejecutar.onclick = handler;
        dialog.showModal();
    }

    function crearBotonGitPush(onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'crear-ep-btn crear-ep-btn--secundario';
        b.dataset.editorGitPush = '1';
        b.textContent = 'Subir a GitHub';
        b.title = 'Commit y push de todos los editores a la rama dev';
        b.addEventListener('click', onClick);
        return b;
    }

    async function actualizarEstadoPendienteGit(toolbar) {
        const btn = toolbar?.querySelector('[data-editor-git-push]');
        if (!btn || !gitPushEstado?.habilitado) {
            return;
        }
        try {
            const res = await fetch('/api/editors/git-push/pendiente?alcance=todos');
            if (!res.ok) {
                return;
            }
            const data = await res.json();
            const sessionPend = window.DCEditorSessionLog?.tieneCambiosPendientesPush?.();
            const pendiente = Boolean(data.pendiente || sessionPend);
            btn.classList.toggle('crear-ep-btn--git-pendiente', pendiente);
            btn.disabled = !pendiente;
            btn.title = pendiente
                ? 'Hay cambios guardados pendientes de subir a GitHub (rama dev)'
                : 'No hay cambios pendientes de subir a GitHub';
        } catch (_e) { /* ignorar */ }
    }

    async function cargarEstado() {
        try {
            const res = await fetch('/api/editors/git-push/estado');
            if (!res.ok) return null;
            return res.json();
        } catch (_e) {
            return null;
        }
    }

    /**
     * Monta el botón «Subir a GitHub» en la toolbar de despliegue.html.
     * @param {{ toolbar: HTMLElement|null, getDirty?: () => boolean, onSuccess?: Function }} opciones
     */
    async function montarEnDespliegue(opciones) {
        if (!opciones?.toolbar) return;

        gitPushEstado = await cargarEstado();
        if (!gitPushEstado?.habilitado) {
            return;
        }

        opciones.toolbar.querySelector('[data-editor-git-push]')?.remove();
        const boton = crearBotonGitPush(() => {
            abrirModal({
                getDirty: opciones.getDirty || (() => false),
                onSuccess: opciones.onSuccess,
            });
        });
        opciones.toolbar.insertBefore(boton, opciones.toolbar.firstChild);
        void actualizarEstadoPendienteGit(opciones.toolbar);
    }

    /** @deprecated El push a dev está centralizado en despliegue. */
    async function montarEnToolbar() {
        /* noop: compatibilidad con editores que aún importan el script */
    }

    window.DCEditorGitPush = {
        montarEnDespliegue,
        montarEnToolbar,
        actualizarEstadoPendienteGit,
        abrirModal,
        recargarEstado: cargarEstado,
    };
})();
