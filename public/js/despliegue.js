/**
 * Vista Despliegue: registro de sesión + push a producción (rama main).
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const aviso = $('despliegue-aviso');
    const layout = $('despliegue-layout');
    const registroEl = $('despliegue-registro');
    const archivosEl = $('despliegue-archivos');
    const archivosDevEl = $('despliegue-archivos-dev');
    const btnProd = $('despliegue-btn-produccion');
    const btnRefrescar = $('despliegue-btn-refrescar');
    const toast = $('crear-ep-toast');

    let resumenServidor = null;

    function toastMsg(msg, esError = false) {
        if (!toast) return;
        toast.textContent = msg;
        toast.hidden = false;
        toast.classList.toggle('crear-ep-toast--error', esError);
        clearTimeout(toastMsg._t);
        toastMsg._t = setTimeout(() => { toast.hidden = true; }, 4200);
    }

    function motivoPendienteDev(item) {
        if (!item?.pendiente) return null;
        if (item.motivo === 'sin_push') return 'commits sin push';
        return 'cambios sin commit/push';
    }

    function pintarArchivosPendientes(archivos, contenedor, vacioMsg) {
        if (!contenedor) return;
        contenedor.innerHTML = '';
        if (!archivos?.length) {
            contenedor.innerHTML = `<li class="despliegue-archivos-vacio">${vacioMsg}</li>`;
            return;
        }
        archivos.forEach((ruta) => {
            const li = document.createElement('li');
            li.className = 'despliegue-archivos-item';
            li.innerHTML = `<code>${ruta}</code><span class="despliegue-archivos-badge">pendiente</span>`;
            contenedor.appendChild(li);
        });
    }

    function construirTextoRegistro() {
        const lineas = [];
        lineas.push('═══════════════════════════════════════════════════════');
        lineas.push('  REGISTRO DE CAMBIOS — SESIÓN DE HERRAMIENTAS DEV');
        lineas.push('═══════════════════════════════════════════════════════');
        lineas.push('');
        lineas.push(window.DCEditorSessionLog?.formatearRegistroTexto?.() || '(Sin registro de sesión)');
        lineas.push('');
        lineas.push('───────────────────────────────────────────────────────');
        lineas.push('  ESTADO EN SERVIDOR (dev → producción)');
        lineas.push('───────────────────────────────────────────────────────');
        lineas.push('');

        if (resumenServidor?.produccion) {
            const prod = resumenServidor.produccion;
            lineas.push(`Rama producción: ${prod.rama || 'main'}`);
            lineas.push(`Rama dev: ${prod.ramaDev || 'dev'}`);
            if (prod.comparacion) {
                lineas.push(`Comparación: ${prod.comparacion}`);
            }
            lineas.push(`Despliegue habilitado: ${prod.habilitado ? 'sí' : 'no'}`);
            lineas.push('');
            lineas.push('Archivos de editor distintos respecto a producción:');
            if (prod.archivosPendientes?.length) {
                prod.archivosPendientes.forEach((a) => lineas.push(`  • ${a}`));
            } else {
                lineas.push('  (ninguno)');
            }
            lineas.push('');
        }

        const pend = resumenServidor?.pendienteDevGithub;
        if (pend) {
            lineas.push('Pendiente de subir a GitHub (rama dev):');
            const todos = pend.todos;
            if (todos?.pendiente) {
                lineas.push(`  ⚠ Todos los editores: ${motivoPendienteDev(todos)}`);
                (pend.archivosModificados || []).forEach((a) => lineas.push(`    • ${a}`));
            } else {
                lineas.push('  ✓ Sin cambios pendientes en el servidor');
            }
            lineas.push('');
        }

        const commits = resumenServidor?.commitsRecientesEditor;
        if (commits?.length) {
            lineas.push('Últimos commits en dev (archivos de editor):');
            commits.forEach((c) => lineas.push(`  ${c}`));
        }

        return lineas.join('\n');
    }

    function actualizarRegistroVista() {
        if (registroEl) {
            registroEl.value = construirTextoRegistro();
        }
        pintarArchivosPendientes(
            resumenServidor?.pendienteDevGithub?.archivosModificados || [],
            archivosDevEl,
            'No hay archivos de editor pendientes de commit/push a dev.'
        );
        pintarArchivosPendientes(
            resumenServidor?.produccion?.archivosPendientes || [],
            archivosEl,
            resumenServidor?.produccion?.comparacion
                ? `No hay archivos de editor distintos entre ${resumenServidor.produccion.comparacion}.`
                : 'No hay archivos de editor distintos entre dev y main en GitHub.'
        );
        const puedeProd = Boolean(
            resumenServidor?.produccion?.habilitado
            && resumenServidor?.produccion?.archivosPendientes?.length
        );
        if (btnProd) {
            btnProd.disabled = !puedeProd;
            btnProd.title = puedeProd
                ? `Desplegar ${resumenServidor.produccion.archivosPendientes.length} archivo(s) a ${resumenServidor.produccion.rama}`
                : 'No hay archivos de editor pendientes de desplegar a producción';
        }
        void window.DCEditorGitPush?.actualizarEstadoPendienteGit?.($('despliegue-toolbar'));
    }

    async function cargarResumen() {
        const res = await fetch('/api/editors/despliegue/resumen');
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(body.detalle || body.error || `HTTP ${res.status}`);
        }
        resumenServidor = body;
        actualizarRegistroVista();
    }

    function mostrarAviso(msg) {
        if (layout) layout.hidden = true;
        if (aviso) {
            aviso.hidden = false;
            aviso.textContent = msg;
        }
    }

    async function confirmarDespliegue() {
        const archivos = resumenServidor?.produccion?.archivosPendientes || [];
        const rama = resumenServidor?.produccion?.rama || 'main';
        const lista = archivos.map((a) => `  • ${a}`).join('\n');
        return window.confirm(
            `¿Subir a PRODUCCIÓN (rama «${rama}»)?\n\n`
            + `Se copiarán ${archivos.length} archivo(s) desde el estado actual de dev:\n\n${lista}\n\n`
            + 'Esta acción afectará al entorno de producción. ¿Continuar?'
        );
    }

    async function abrirModalProduccion() {
        if (!(await confirmarDespliegue())) return;

        const dialog = $('despliegue-dialog-prod');
        const resultado = $('despliegue-prod-resultado');
        const progreso = $('despliegue-prod-progreso');
        const estado = $('despliegue-prod-estado');
        const mensajeInput = $('despliegue-prod-mensaje');
        const tokenInput = $('despliegue-prod-token');
        const tokenWrap = $('despliegue-prod-token-wrap');
        const ejecutar = $('despliegue-prod-ejecutar');

        if (!dialog) return;

        if (resultado) {
            resultado.hidden = true;
            resultado.textContent = '';
        }
        if (progreso) progreso.hidden = true;
        if (mensajeInput) mensajeInput.value = '';
        if (tokenWrap) {
            tokenWrap.hidden = !resumenServidor?.gitPush?.requiereTokenCliente;
        }
        if (tokenInput && resumenServidor?.gitPush?.requiereTokenCliente) {
            tokenInput.value = localStorage.getItem('dc_editor_git_push_token_v1') || '';
        }
        if (ejecutar) ejecutar.disabled = false;

        dialog.showModal();

        ejecutar.onclick = async () => {
            ejecutar.disabled = true;
            if (progreso) progreso.hidden = false;
            if (estado) estado.textContent = 'Desplegando a producción…';

            const headers = { 'Content-Type': 'application/json' };
            const token = tokenInput?.value?.trim() || '';
            if (token) {
                headers['X-Editor-Git-Token'] = token;
                localStorage.setItem('dc_editor_git_push_token_v1', token);
            }

            try {
                const res = await fetch('/api/editors/despliegue/produccion', {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        mensaje: mensajeInput?.value?.trim() || '',
                        archivos: resumenServidor?.produccion?.archivosPendientes,
                    }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(data.detalle || data.error || `HTTP ${res.status}`);
                }
                if (data.sinCambios) {
                    toastMsg('No había cambios nuevos respecto a producción.');
                } else {
                    window.DCEditorSessionLog?.registrarDespliegueProd?.(
                        data.commit || 'Despliegue completado',
                        data.archivos
                    );
                    toastMsg(`Push a ${data.rama || 'main'} completado. Esperando deploy en Render…`);
                }

                let htmlResultado = data.sinCambios
                    ? 'No había cambios nuevos.'
                    : `Push completado en <strong>${data.rama}</strong>.`
                        + (data.commit ? `<br><code>${data.commit}</code>` : '');

                if (!data.sinCambios && data.commitSha && window.DCEditorDeployMonitor) {
                    if (estado) estado.textContent = 'Esperando deploy en Render (producción)…';
                    const deployResult = await window.DCEditorDeployMonitor.esperarDeploy({
                        commitEsperado: data.commitSha,
                        destino: 'prod',
                        onProgreso: (p) => {
                            if (estado) estado.textContent = p.mensaje;
                        },
                    });
                    htmlResultado += window.DCEditorDeployMonitor.mensajeResultadoMonitor(deployResult, 'prod');
                    if (deployResult?.ok) {
                        toastMsg('Deploy en producción completado.');
                    } else if (deployResult?.motivo === 'timeout') {
                        toastMsg('Tiempo de espera agotado; el deploy puede seguir en Render.', true);
                    }
                } else if (!data.sinCambios) {
                    toastMsg(`Desplegado a ${data.rama || 'main'}.`);
                }

                if (resultado) {
                    resultado.hidden = false;
                    resultado.className = 'editor-git-push-resultado editor-git-push-resultado--ok';
                    resultado.innerHTML = htmlResultado;
                }
                await cargarResumen();
            } catch (err) {
                if (resultado) {
                    resultado.hidden = false;
                    resultado.className = 'editor-git-push-resultado editor-git-push-resultado--error';
                    resultado.textContent = String(err.message || err);
                }
                toastMsg(String(err.message || err), true);
            } finally {
                ejecutar.disabled = false;
                if (estado) estado.textContent = 'Listo';
            }
        };
    }

    async function init() {
        btnRefrescar?.addEventListener('click', () => {
            cargarResumen().catch((e) => toastMsg(e.message, true));
        });
        btnProd?.addEventListener('click', abrirModalProduccion);
        $('despliegue-prod-cerrar')?.addEventListener('click', () => {
            $('despliegue-dialog-prod')?.close();
        });

        try {
            const hab = await fetch('/api/editors/despliegue/habilitado').then((r) => r.json());
            if (!hab.habilitado) {
                mostrarAviso('Vista de despliegue no disponible en este entorno.');
                return;
            }
            window.DCEditorDevNav?.init({
                vistaActual: 'despliegue',
                getDirty: () => false,
            });
            await window.DCEditorGitPush?.montarEnDespliegue?.({
                toolbar: $('despliegue-toolbar'),
                onSuccess: async () => {
                    await cargarResumen();
                },
            });
            if (aviso) aviso.hidden = true;
            if (layout) layout.hidden = false;
            await cargarResumen();
        } catch (e) {
            mostrarAviso(e.message || 'No se pudo cargar la vista de despliegue.');
        }
    }

    init();
})();
