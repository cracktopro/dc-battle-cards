/**
 * Espera a que Render complete un deploy comprobando el commit en ejecución.
 */
(function () {
    'use strict';

    const DEFAULT_INTERVAL_MS = 8000;
    const DEFAULT_TIMEOUT_MS = 900000;

    function extraerSha(commitStr) {
        if (!commitStr) {
            return '';
        }
        const match = String(commitStr).match(/^([0-9a-f]{7,40})/i);
        return match ? match[1].toLowerCase() : String(commitStr).trim().toLowerCase();
    }

    function formatearTiempo(ms) {
        const totalSec = Math.max(0, Math.floor(ms / 1000));
        const min = Math.floor(totalSec / 60);
        const sec = totalSec % 60;
        return `${min}:${String(sec).padStart(2, '0')}`;
    }

    function dormir(ms, signal) {
        return new Promise((resolve, reject) => {
            if (signal?.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            const id = setTimeout(resolve, ms);
            const onAbort = () => {
                clearTimeout(id);
                reject(new DOMException('Aborted', 'AbortError'));
            };
            signal?.addEventListener('abort', onAbort, { once: true });
        });
    }

    async function obtenerConfig() {
        try {
            const res = await fetch('/api/editors/deploy/config');
            if (!res.ok) {
                return null;
            }
            return res.json();
        } catch (_e) {
            return null;
        }
    }

    async function consultarVersion(destino) {
        const url = destino === 'prod'
            ? '/api/editors/deploy/version?destino=prod'
            : '/api/public/deploy-version';
        const res = await fetch(url);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(body.detalle || body.error || `HTTP ${res.status}`);
        }
        return body;
    }

    /**
     * @param {{ commitEsperado: string, destino?: 'dev'|'prod', onProgreso?: Function, signal?: AbortSignal }} opts
     */
    async function esperarDeploy(opts = {}) {
        const shaEsperado = extraerSha(opts.commitEsperado);
        const destino = opts.destino === 'prod' ? 'prod' : 'dev';
        const onProgreso = typeof opts.onProgreso === 'function' ? opts.onProgreso : null;
        const signal = opts.signal;

        if (!shaEsperado) {
            return { ok: false, motivo: 'sin_commit' };
        }

        const config = await obtenerConfig();
        if (destino === 'prod' && !config?.monitorProdDisponible) {
            return { ok: false, motivo: 'prod_url_no_configurada' };
        }
        if (destino === 'dev' && config && !config.monitorDevDisponible) {
            return { ok: false, motivo: 'monitor_no_disponible' };
        }

        const intervaloMs = config?.intervaloMs || DEFAULT_INTERVAL_MS;
        const timeoutMs = config?.timeoutMs || DEFAULT_TIMEOUT_MS;
        const inicio = Date.now();
        const etiqueta = destino === 'prod' ? 'producción' : 'dev';

        onProgreso?.({
            fase: 'esperando',
            mensaje: `Push completado. Esperando deploy en Render (${etiqueta})…`,
            transcurrido: 0,
        });

        while (Date.now() - inicio < timeoutMs) {
            if (signal?.aborted) {
                return { ok: false, motivo: 'cancelado' };
            }

            try {
                const version = await consultarVersion(destino);
                const shaActual = extraerSha(version.commit);
                if (shaActual && (shaActual.startsWith(shaEsperado) || shaEsperado.startsWith(shaActual))) {
                    onProgreso?.({
                        fase: 'completado',
                        mensaje: `Deploy en Render (${etiqueta}) completado.`,
                        transcurrido: Date.now() - inicio,
                        version,
                    });
                    return { ok: true, version, transcurrido: Date.now() - inicio };
                }

                onProgreso?.({
                    fase: 'esperando',
                    mensaje: `Render desplegando (${etiqueta})… ${formatearTiempo(Date.now() - inicio)} — commit en servicio: ${version.commitCorto || shaActual || '?'}`,
                    transcurrido: Date.now() - inicio,
                    versionActual: version,
                });
            } catch (_e) {
                onProgreso?.({
                    fase: 'esperando',
                    mensaje: `Servicio reiniciando (${etiqueta})… ${formatearTiempo(Date.now() - inicio)}`,
                    transcurrido: Date.now() - inicio,
                });
            }

            try {
                await dormir(intervaloMs, signal);
            } catch (e) {
                if (e?.name === 'AbortError') {
                    return { ok: false, motivo: 'cancelado' };
                }
                throw e;
            }
        }

        onProgreso?.({
            fase: 'timeout',
            mensaje: `Tiempo de espera agotado (${formatearTiempo(timeoutMs)}). El deploy puede seguir en Render.`,
            transcurrido: Date.now() - inicio,
        });
        return { ok: false, motivo: 'timeout', transcurrido: Date.now() - inicio };
    }

    function mensajeResultadoMonitor(result, destino) {
        const etiqueta = destino === 'prod' ? 'producción' : 'dev';
        if (result?.ok) {
            const corto = result.version?.commitCorto || window.DCEditorDeployMonitor?.extraerSha?.(result.version?.commit)?.slice(0, 7) || '';
            return `<br><br>✓ Deploy en Render (${etiqueta}) completado${corto ? ` — commit <code>${corto}</code>` : ''}.`;
        }
        if (result?.motivo === 'prod_url_no_configurada') {
            return '<br><br>ℹ Push a main completado. Define <code>RENDER_PROD_PUBLIC_URL</code> en Render dev para avisar automáticamente cuando producción termine de desplegar.';
        }
        if (result?.motivo === 'monitor_no_disponible') {
            return '';
        }
        if (result?.motivo === 'timeout') {
            return `<br><br>⚠ Tiempo de espera agotado esperando el deploy en Render (${etiqueta}). Puede seguir en curso; revisa el panel de Render si hace falta.`;
        }
        return '';
    }

    window.DCEditorDeployMonitor = {
        extraerSha,
        obtenerConfig,
        esperarDeploy,
        mensajeResultadoMonitor,
    };
})();
