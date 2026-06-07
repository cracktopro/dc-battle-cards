/**
 * Confirmaciones de guardado seguro en editores internos (evitar truncamiento accidental).
 */
(function () {
    'use strict';

    const RATIO_MINIMO = 0.85;

    function contarFilasCatalogo(filas, campoClave) {
        if (!Array.isArray(filas)) {
            return 0;
        }
        if (!campoClave) {
            return filas.length;
        }
        return filas.filter((f) => String(f?.[campoClave] ?? '').trim() !== '').length;
    }

    function evaluarTruncamiento({
        totalActual,
        totalAlCargar,
        minAbsoluto = 1,
        ratioMinimo = RATIO_MINIMO,
        etiquetaRecurso = 'el catálogo',
    } = {}) {
        const actual = Number(totalActual) || 0;
        const alCargar = Number(totalAlCargar) || 0;
        const minAbs = Number(minAbsoluto) || 0;
        const ratio = Number(ratioMinimo) || RATIO_MINIMO;

        if (alCargar <= 0) {
            return { permitir: true, requiereConfirmacion: false };
        }

        const umbral = Math.max(minAbs, Math.ceil(alCargar * ratio));
        if (actual >= umbral) {
            return { permitir: true, requiereConfirmacion: false, umbral, totalActual: actual, totalAlCargar: alCargar };
        }

        return {
            permitir: false,
            requiereConfirmacion: true,
            umbral,
            totalActual: actual,
            totalAlCargar: alCargar,
            mensaje: [
                `Atención: vas a guardar ${actual} filas en ${etiquetaRecurso}, pero al abrir el editor había ${alCargar}.`,
                'Guardar ahora podría borrar gran parte del catálogo en el servidor.',
                '',
                '¿Confirmas que quieres sobrescribir el Excel con este contenido reducido?',
            ].join('\n'),
        };
    }

    function evaluarTruncamientoBytes({
        bytesActual,
        bytesAlCargar,
        minBytes = 80,
        ratioMinimo = RATIO_MINIMO,
        etiquetaRecurso = 'el archivo',
    } = {}) {
        const actual = Number(bytesActual) || 0;
        const alCargar = Number(bytesAlCargar) || 0;
        const minAbs = Number(minBytes) || 0;
        const ratio = Number(ratioMinimo) || RATIO_MINIMO;

        if (alCargar <= 0) {
            return { permitir: true, requiereConfirmacion: false };
        }

        const umbral = Math.max(minAbs, Math.floor(alCargar * ratio));
        if (actual >= umbral) {
            return { permitir: true, requiereConfirmacion: false, umbral, bytesActual: actual, bytesAlCargar: alCargar };
        }

        return {
            permitir: false,
            requiereConfirmacion: true,
            umbral,
            bytesActual: actual,
            bytesAlCargar: alCargar,
            mensaje: [
                `Atención: el archivo a guardar (${actual} B) es mucho más pequeño que al cargar (${alCargar} B) en ${etiquetaRecurso}.`,
                'Guardar ahora podría borrar gran parte del contenido en el servidor.',
                '',
                '¿Confirmas que quieres sobrescribir el archivo con este contenido reducido?',
            ].join('\n'),
        };
    }

    function esErrorTruncamiento(error) {
        return Boolean(
            error?.codigo === 'TRUNCAMIENTO_CATALOGO'
            || String(error?.message || '').toLowerCase().includes('truncamiento')
            || String(error?.message || '').toLowerCase().includes('no se guardó')
            || String(error?.message || '').toLowerCase().includes('demasiado pequeño')
        );
    }

    function errorDesdeRespuestaApi(body, status) {
        const msg = body?.errores?.length
            ? body.errores.join('\n')
            : (body?.error || body?.detalle || `HTTP ${status}`);
        const err = new Error(msg);
        if (body?.codigo) {
            err.codigo = body.codigo;
        }
        if (body) {
            err.detalles = body;
        }
        err.httpStatus = status;
        return err;
    }

    async function intentarGuardarConProteccion({ evaluar, guardarFn }) {
        let confirmarTruncamiento = false;
        const evaluacion = evaluar();
        if (evaluacion?.requiereConfirmacion) {
            if (!window.confirm(evaluacion.mensaje)) {
                return { cancelado: true };
            }
            confirmarTruncamiento = true;
        }

        try {
            const result = await guardarFn({ confirmarTruncamiento });
            return { ok: true, result };
        } catch (e) {
            if (esErrorTruncamiento(e) && !confirmarTruncamiento) {
                const msg = e.message || 'El servidor bloqueó el guardado por riesgo de truncamiento.';
                if (window.confirm(`${msg}\n\n¿Confirmas que quieres sobrescribir el archivo de todas formas?`)) {
                    const result = await guardarFn({ confirmarTruncamiento: true });
                    return { ok: true, result };
                }
                return { cancelado: true };
            }
            throw e;
        }
    }

    async function intentarGuardarCatalogo({
        filas,
        filasAlCargar,
        campoClave,
        minAbsoluto,
        etiquetaRecurso,
        guardarFn,
    }) {
        return intentarGuardarConProteccion({
            evaluar: () => evaluarTruncamiento({
                totalActual: contarFilasCatalogo(filas, campoClave),
                totalAlCargar: filasAlCargar,
                minAbsoluto,
                etiquetaRecurso,
            }),
            guardarFn,
        });
    }

    async function intentarGuardarBytes({
        bytesActual,
        bytesAlCargar,
        minBytes,
        etiquetaRecurso,
        guardarFn,
    }) {
        return intentarGuardarConProteccion({
            evaluar: () => evaluarTruncamientoBytes({
                bytesActual,
                bytesAlCargar,
                minBytes,
                etiquetaRecurso,
            }),
            guardarFn,
        });
    }

    window.DCEditorGuardadoSeguro = {
        contarFilasCatalogo,
        evaluarTruncamiento,
        evaluarTruncamientoBytes,
        esErrorTruncamiento,
        errorDesdeRespuestaApi,
        intentarGuardarCatalogo,
        intentarGuardarBytes,
    };
})();
