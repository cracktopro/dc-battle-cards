/**
 * Vista Despliegue: registro de sesión + push a dev / actualización dev+main.
 */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const aviso = $('despliegue-aviso');
    const layout = $('despliegue-layout');
    const registroEl = $('despliegue-registro');
    const archivosEl = $('despliegue-archivos');
    const archivosDevEl = $('despliegue-archivos-dev');
    const btnActualizar = $('despliegue-btn-produccion');
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
            lineas.push(`Actualización habilitada: ${prod.habilitado ? 'sí' : 'no'}`);
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
            lineas.push('Pendiente de subir a dev (GitHub):');
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

    function hayCambiosParaActualizar() {
        const pendDev = Boolean(resumenServidor?.pendienteDevGithub?.todos?.pendiente);
        const pendMain = Boolean(resumenServidor?.produccion?.archivosPendientes?.length);
        return pendDev || pendMain;
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
        const puedeActualizar = Boolean(
            resumenServidor?.produccion?.habilitado
            && hayCambiosParaActualizar()
        );
        if (btnActualizar) {
            btnActualizar.disabled = !puedeActualizar;
            btnActualizar.title = puedeActualizar
                ? 'Commit + push a dev (si hace falta) y a main; espera deploy en ambos servicios Render'
                : 'No hay cambios pendientes de actualizar en dev o main';
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

    function formatearResumenPush(parte, etiqueta) {
        if (!parte) {
            return '';
        }
        if (parte.omitido) {
            return `<p><strong>${etiqueta}:</strong> ${parte.mensaje || 'Sin cambios.'}</p>`;
        }
        if (parte.sinCambios) {
            return `<p><strong>${etiqueta}:</strong> Sin cambios nuevos.</p>`;
        }
        return `<p><strong>${etiqueta}:</strong> Push completado en <strong>${parte.rama || etiqueta}</strong>.`
            + (parte.commit ? `<br><code>${parte.commit}</code>` : '') + '</p>';
    }

    async function confirmarActualizacion() {
        const pendDev = resumenServidor?.pendienteDevGithub?.todos?.pendiente;
        const archivosMain = resumenServidor?.produccion?.archivosPendientes || [];
        const ramaMain = resumenServidor?.produccion?.rama || 'main';
        const lineas = [];
        if (pendDev) {
            lineas.push('  • Push a dev (GitHub) — cambios aún no subidos');
        } else {
            lineas.push('  • Dev ya sincronizado — no se repetirá el push a dev');
        }
        if (archivosMain.length) {
            lineas.push(`  • Push a ${ramaMain} — ${archivosMain.length} archivo(s):`);
            archivosMain.forEach((a) => lineas.push(`      · ${a}`));
        } else if (!pendDev) {
            lineas.push(`  • ${ramaMain} ya alineado con dev`);
        }
        return window.confirm(
            '¿Actualizar cambios en dev y producción?\n\n'
            + 'Se hará commit + push según corresponda:\n\n'
            + lineas.join('\n')
            + '\n\nSe esperará el deploy en Render (dev y producción). ¿Continuar?'
        );
    }

    async function abrirModalActualizar() {
        if (!(await confirmarActualizacion())) return;

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
        if (ejecutar) {
            ejecutar.disabled = false;
            ejecutar.hidden = false;
        }

        dialog.showModal();

        ejecutar.onclick = async () => {
            ejecutar.disabled = true;
            if (progreso) progreso.hidden = false;
            if (estado) estado.textContent = 'Actualizando cambios…';

            const headers = { 'Content-Type': 'application/json' };
            const token = tokenInput?.value?.trim() || '';
            if (token) {
                headers['X-Editor-Git-Token'] = token;
                localStorage.setItem('dc_editor_git_push_token_v1', token);
            }

            let exito = false;
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

                let htmlResultado = '';
                if (data.sinCambios) {
                    htmlResultado = `<p>${data.mensaje || 'No había cambios pendientes en dev ni en main.'}</p>`;
                    toastMsg('No había cambios pendientes.');
                } else {
                    htmlResultado = formatearResumenPush(data.dev, 'Dev');
                    htmlResultado += formatearResumenPush(data.main, 'Producción (main)');

                    if (data.dev && !data.dev.omitido && !data.dev.sinCambios) {
                        window.DCEditorSessionLog?.registrarGitPushDev?.(
                            'despliegue',
                            data.dev.commit || 'Push a dev (actualizar cambios)',
                            data.dev.archivos || []
                        );
                    }
                    if (data.main && !data.main.omitido && !data.main.sinCambios) {
                        window.DCEditorSessionLog?.registrarDespliegueProd?.(
                            data.main.commit || 'Actualización main completada',
                            data.main.archivos
                        );
                    }

                    const necesitaDev = data.dev?.commitSha && !data.dev.omitido && !data.dev.sinCambios;
                    const necesitaMain = data.main?.commitSha && !data.main.omitido && !data.main.sinCambios;

                    if ((necesitaDev || necesitaMain) && window.DCEditorDeployMonitor) {
                        if (estado) estado.textContent = 'Esperando deploys en Render…';
                        const deployResults = await window.DCEditorDeployMonitor.esperarDeploysTrasActualizar({
                            dev: necesitaDev ? data.dev : null,
                            main: necesitaMain ? data.main : null,
                            onProgreso: (p) => {
                                if (estado) estado.textContent = p.mensaje;
                            },
                        });
                        htmlResultado += window.DCEditorDeployMonitor.mensajeResultadoActualizacion(deployResults);
                        if (deployResults.dev?.ok && deployResults.prod?.ok) {
                            toastMsg('Deploys en dev y producción completados.');
                        } else if (deployResults.dev?.ok || deployResults.prod?.ok) {
                            toastMsg('Deploy completado en al menos un servicio.');
                        } else if (necesitaDev || necesitaMain) {
                            toastMsg('Push completado; revisa el estado de deploy en Render.', true);
                        }
                    } else {
                        toastMsg('Cambios actualizados en GitHub.');
                    }
                }

                if (resultado) {
                    resultado.hidden = false;
                    resultado.className = 'editor-git-push-resultado editor-git-push-resultado--ok';
                    resultado.innerHTML = htmlResultado;
                }
                if (estado) estado.textContent = 'Listo';
                await cargarResumen();
                exito = true;
            } catch (err) {
                if (resultado) {
                    resultado.hidden = false;
                    resultado.className = 'editor-git-push-resultado editor-git-push-resultado--error';
                    resultado.textContent = String(err.message || err);
                }
                toastMsg(String(err.message || err), true);
                if (estado) estado.textContent = 'Error';
            } finally {
                if (exito) {
                    if (ejecutar) ejecutar.hidden = true;
                } else if (ejecutar) {
                    ejecutar.disabled = false;
                    ejecutar.hidden = false;
                }
            }
        };
    }

    async function init() {
        btnRefrescar?.addEventListener('click', () => {
            cargarResumen().catch((e) => toastMsg(e.message, true));
        });
        btnActualizar?.addEventListener('click', abrirModalActualizar);
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
