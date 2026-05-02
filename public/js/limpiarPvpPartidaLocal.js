/**
 * Quita flags y metadatos de PvP online del localStorage para partidas locales (BOT, desafío, evento).
 * No borra mazos ni desafío activo. Debe ejecutarse antes de abrir tablero.html en modo no-PvP,
 * o al salir del tablero PvP hacia el lobby sin usar abandono completo.
 */
function limpiarEstadoPvpResiduoPartidaLocal() {
    [
        'partidaModo',
        'partidaPvpSessionId',
        'partidaPvpRol',
        'partidaPvpPrimerTurno',
        'partidaPvpInicialesJugadorIdx',
        'partidaPvpInicialesOponenteIdx',
        'emailOponente',
        'nombreOponente',
        'avatarOponente'
    ].forEach(k => {
        try {
            localStorage.removeItem(k);
        } catch (_) {
            /* noop */
        }
    });
}

window.limpiarEstadoPvpResiduoPartidaLocal = limpiarEstadoPvpResiduoPartidaLocal;
