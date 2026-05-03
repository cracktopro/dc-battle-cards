/**
 * Elimina metadatos del modo cooperativo online del localStorage (no borra mazos base del usuario).
 */
function limpiarEstadoCoopResiduoPartidaLocal() {
    [
        'partidaModo',
        'partidaCoopSessionId',
        'partidaCoopRol',
        'partidaCoopPayload'
    ].forEach(k => {
        try {
            localStorage.removeItem(k);
        } catch (_e) {
            /* noop */
        }
    });
}

window.limpiarEstadoCoopResiduoPartidaLocal = limpiarEstadoCoopResiduoPartidaLocal;
