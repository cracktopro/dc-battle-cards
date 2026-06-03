/**
 * UI compartida: botón y modal para subir cambios del editor a GitHub (rama dev).
 */
(function () {
    'use strict';

    const LS_TOKEN_KEY = 'dc_editor_git_push_token_v1';

    let dialogEl = null;
    let gitPushEstado = null;
    const toolbarConfigs = new WeakMap();

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

    function resetModal(alcance, rama) {
        const ayuda = $('editor-git-push-ayuda');
        const mensaje = $('editor-git-push-mensaje');
        const tokenWrap = $('editor-git-push-token-wrap');
        const tokenInput = $('editor-git-push-token');
        const resultado = $('editor-git-push-resultado');
        const ejecutar = $('editor-git-push-ejecutar');

        if (ayuda) {
            ayuda.textContent = alcance === 'cartas'
                ? `Se hará commit de public/resources/cartas.xlsx y push a la rama «${rama}». Guarda el Excel antes de subir.`
                : alcance === 'desafios'
                    ? `Se hará commit de public/resources/desafios.xlsx y push a la rama «${rama}». Guarda el Excel antes de subir.`
                    : `Se hará commit de los JSON en public/resources/episodios/ y push a la rama «${rama}». Guarda los archivos antes de subir.`;
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

    async function abrirModal(opciones) {
        const dialog = asegurarDialogo();
        resetModal(opciones.alcance, gitPushEstado?.rama || 'dev');

        const ejecutar = $('editor-git-push-ejecutar');
        const handler = async () => {
            if (opciones.getDirty?.()) {
                window.alert('Hay cambios sin guardar en disco. Pulsa Guardar antes de subir a GitHub.');
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
                const res = await fetch(opciones.endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ mensaje }),
                });
                setProgreso(true, 'Enviando a GitHub…', 80);
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(data.detalle || data.error || `HTTP ${res.status}`);
                }
                setProgreso(true, 'Completado', 100);
                if (data.sinCambios) {
                    mostrarResultado('No había cambios nuevos respecto al último commit en el servidor.', false);
                } else {
                    mostrarResultado(
                        `Subida completada a <strong>${data.rama || gitPushEstado?.rama || 'dev'}</strong>.`
                        + (data.commit ? `<br><code>${data.commit}</code>` : ''),
                        false
                    );
                    window.DCEditorSessionLog?.registrarGitPushDev?.(
                        opciones.alcance,
                        data.commit || 'Push a dev completado',
                        data.archivos || archivosPorAlcance(opciones.alcance)
                    );
                }
                window.DCEditorDevNav?.marcarGitSincronizado();
                void actualizarEstadoPendienteGit(document.querySelector('.crear-ep-header-acciones'));
                document.querySelectorAll('.crear-ep-header-acciones').forEach((tb) => {
                    void actualizarEstadoPendienteGit(tb);
                });
                opciones.onSuccess?.(data);
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
        b.title = 'Commit y push a la rama dev en GitHub';
        b.addEventListener('click', onClick);
        return b;
    }

    async function actualizarEstadoPendienteGit(toolbar) {
        const opciones = toolbarConfigs.get(toolbar);
        if (!opciones?.alcance || !gitPushEstado?.habilitado) {
            return;
        }
        const btn = toolbar?.querySelector('[data-editor-git-push]');
        if (!btn) {
            return;
        }
        try {
            const res = await fetch(`/api/editors/git-push/pendiente?alcance=${encodeURIComponent(opciones.alcance)}`);
            if (!res.ok) {
                return;
            }
            const data = await res.json();
            btn.classList.toggle('crear-ep-btn--git-pendiente', Boolean(data.pendiente));
            btn.title = data.pendiente
                ? 'Hay cambios pendientes de subir a GitHub (rama dev)'
                : 'Commit y push a la rama dev en GitHub';
        } catch (_e) { /* ignorar */ }
    }

    function archivosPorAlcance(alcance) {
        if (alcance === 'cartas') return ['public/resources/cartas.xlsx'];
        if (alcance === 'desafios') return ['public/resources/desafios.xlsx'];
        return ['public/resources/episodios/*.json'];
    }

    function refrescarBotonEnToolbar(toolbar) {
        const opciones = toolbarConfigs.get(toolbar);
        if (!opciones || !gitPushEstado?.habilitado) {
            return;
        }
        toolbar.querySelector('[data-editor-git-push]')?.remove();
        const boton = crearBotonGitPush(() => {
            abrirModal({
                alcance: opciones.alcance,
                endpoint: opciones.endpoint,
                getDirty: opciones.getDirty || (() => false),
                onSuccess: opciones.onSuccess,
            });
        });
        toolbar.appendChild(boton);
        void actualizarEstadoPendienteGit(toolbar);
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
     * @param {{ toolbar: HTMLElement|null, alcance: 'episodios'|'cartas', endpoint: string, getDirty: () => boolean, onSuccess?: Function }} opciones
     */
    async function montarEnToolbar(opciones) {
        if (!opciones?.toolbar) return;

        gitPushEstado = await cargarEstado();
        if (!gitPushEstado?.habilitado) {
            return;
        }

        toolbarConfigs.set(opciones.toolbar, opciones);
        refrescarBotonEnToolbar(opciones.toolbar);
    }

    window.DCEditorGitPush = {
        montarEnToolbar,
        refrescarBotonEnToolbar,
        actualizarEstadoPendienteGit,
        recargarEstado: cargarEstado,
    };
})();
