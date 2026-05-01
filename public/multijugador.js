const MULTI_AVATAR_FALLBACK = 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';
let estadoLobbyActual = null;
let miEmailMulti = '';
let ultimoDiaChat = '';

function leerUsuarioSesionMulti() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const email = String(localStorage.getItem('email') || '').trim();
    return { usuario, email };
}

function mostrarMensajeMulti(mensaje, tipo = 'warning') {
    const el = document.getElementById('mensaje-multi');
    if (!el) return;
    el.textContent = mensaje;
    el.className = `alert alert-${tipo}`;
    el.style.display = 'block';
    setTimeout(() => {
        el.style.display = 'none';
    }, 2800);
}

function construirOpcionesMazo() {
    const { usuario } = leerUsuarioSesionMulti();
    const select = document.getElementById('multi-select-mazo');
    if (!select) return;
    const mazos = Array.isArray(usuario?.mazos) ? usuario.mazos : [];
    select.innerHTML = '';
    if (mazos.length === 0) {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No tienes mazos creados';
        select.appendChild(option);
        return;
    }
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Selecciona mazo';
    select.appendChild(placeholder);
    mazos.forEach((mazo, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = mazo?.Nombre || `Mazo ${index + 1}`;
        select.appendChild(option);
    });
}

function obtenerFechaKey(timestamp) {
    const fecha = Number.isFinite(Number(timestamp)) ? new Date(Number(timestamp)) : new Date();
    return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`;
}

function insertarSeparadorChatSiCorresponde(contenedor, mensaje) {
    const key = obtenerFechaKey(mensaje?.timestamp);
    if (key === ultimoDiaChat) return;
    ultimoDiaChat = key;
    const sep = document.createElement('div');
    sep.className = 'chat-separador-fecha';
    sep.textContent = 'Hoy';
    contenedor.appendChild(sep);
}

function appendMensajeChatGrupo(mensaje = {}) {
    const contenedor = document.getElementById('multi-chat-mensajes');
    if (!contenedor) return;
    insertarSeparadorChatSiCorresponde(contenedor, mensaje);
    const item = document.createElement('div');
    const esMio = String(mensaje?.email || '').trim().toLowerCase() === miEmailMulti.toLowerCase();
    item.className = esMio ? 'mensaje-usuario' : 'mensaje-otro';
    const header = document.createElement('div');
    header.className = 'chat-msg-header';
    const avatar = document.createElement('img');
    avatar.className = 'chat-msg-avatar';
    avatar.src = String(mensaje?.avatar || '').trim() || MULTI_AVATAR_FALLBACK;
    avatar.alt = `Avatar de ${mensaje?.usuario || 'Jugador'}`;
    const nombre = document.createElement('span');
    nombre.className = 'nombre-usuario';
    nombre.textContent = mensaje?.usuario || 'Jugador';
    const hora = document.createElement('span');
    hora.className = 'chat-msg-hora';
    hora.textContent = mensaje?.hora || '';
    header.appendChild(avatar);
    header.appendChild(nombre);
    header.appendChild(hora);
    const texto = document.createElement('div');
    texto.className = 'chat-msg-texto';
    texto.textContent = mensaje?.mensaje || '';
    item.appendChild(header);
    item.appendChild(texto);
    contenedor.appendChild(item);
    contenedor.scrollTop = contenedor.scrollHeight;
}

function renderizarEstadoJugadoresLobby(estado) {
    const host = document.getElementById('multi-jugadores-estado');
    if (!host) return;
    host.innerHTML = '';
    const jugadores = Array.isArray(estado?.jugadores) ? estado.jugadores : [];
    jugadores.forEach(jugador => {
        const row = document.createElement('div');
        row.className = 'multi-player-row';
        const avatar = document.createElement('img');
        avatar.className = 'multi-player-avatar';
        avatar.src = String(jugador?.avatar || '').trim() || MULTI_AVATAR_FALLBACK;
        const name = document.createElement('span');
        name.textContent = jugador?.nombre || jugador?.email || 'Jugador';
        const state = document.createElement('span');
        const listo = Boolean(jugador?.listo);
        state.className = `multi-player-state ${listo ? 'listo' : 'no-listo'}`;
        state.textContent = listo ? 'Listo' : 'No listo';
        row.appendChild(avatar);
        row.appendChild(name);
        row.appendChild(state);
        host.appendChild(row);
    });
}

function actualizarUIEstadoLobby(estado) {
    estadoLobbyActual = estado;
    renderizarEstadoJugadoresLobby(estado);
    const info = document.getElementById('multi-lobby-info');
    const listoBtn = document.getElementById('multi-listo-btn');
    const select = document.getElementById('multi-select-mazo');
    if (!info || !listoBtn || !select) return;

    const abierto = Boolean(estado?.abierto);
    if (!abierto) {
        listoBtn.disabled = true;
        info.textContent = '';
        return;
    }

    const jugadores = Array.isArray(estado?.jugadores) ? estado.jugadores : [];
    const yo = jugadores.find(j => String(j?.email || '').toLowerCase() === miEmailMulti.toLowerCase());
    const miMazo = yo?.mazoIndex;
    select.value = Number.isInteger(miMazo) ? String(miMazo) : '';
    listoBtn.disabled = !Number.isInteger(miMazo);
    listoBtn.textContent = yo?.listo ? 'Quitar listo' : 'Listo';

    if (estado?.ambosListos) {
        info.textContent = 'Ambos jugadores están listos. Preparando inicio...';
    } else {
        info.textContent = 'Selecciona mazo y pulsa listo. La partida empezará cuando ambos estén listos.';
    }
}

function validarAccesoGrupo() {
    const estadoGrupo = JSON.parse(localStorage.getItem('grupoActual') || '{}');
    if (!estadoGrupo?.enGrupo) {
        window.location.replace('vistaJuego.html');
        return false;
    }
    return true;
}

function configurarEventosUI() {
    const enviarBtn = document.getElementById('multi-chat-enviar');
    const input = document.getElementById('multi-chat-input');
    const abrirLobbyBtn = document.getElementById('multi-abrir-lobby-btn');
    const abandonarGrupoBtn = document.getElementById('multi-abandonar-grupo-btn');
    const selectMazo = document.getElementById('multi-select-mazo');
    const listoBtn = document.getElementById('multi-listo-btn');

    enviarBtn?.addEventListener('click', () => {
        const mensaje = String(input?.value || '').trim();
        if (!mensaje) return;
        if (typeof window.enviarMensajeChatGrupo === 'function') {
            window.enviarMensajeChatGrupo(mensaje);
            input.value = '';
        }
    });
    input?.addEventListener('keypress', (event) => {
        if (event.key === 'Enter') {
            enviarBtn?.click();
        }
    });
    abrirLobbyBtn?.addEventListener('click', () => {
        if (typeof window.abrirLobbyMultijugador === 'function') {
            window.abrirLobbyMultijugador();
        }
    });
    abandonarGrupoBtn?.addEventListener('click', () => {
        if (typeof window.confirmarAbandonoGrupo === 'function') {
            window.confirmarAbandonoGrupo().then(confirmado => {
                if (confirmado && typeof window.abandonarGrupoActual === 'function') {
                    window.abandonarGrupoActual();
                }
            });
            return;
        }
        if (typeof window.abandonarGrupoActual === 'function') {
            window.abandonarGrupoActual();
        }
    });
    selectMazo?.addEventListener('change', () => {
        const value = selectMazo.value;
        const idx = value === '' ? null : Number(value);
        if (typeof window.actualizarMazoLobbyMultijugador === 'function') {
            window.actualizarMazoLobbyMultijugador(Number.isInteger(idx) ? idx : null);
        }
    });
    listoBtn?.addEventListener('click', () => {
        const jugadores = Array.isArray(estadoLobbyActual?.jugadores) ? estadoLobbyActual.jugadores : [];
        const yo = jugadores.find(j => String(j?.email || '').toLowerCase() === miEmailMulti.toLowerCase());
        const nuevoEstado = !Boolean(yo?.listo);
        if (typeof window.toggleListoLobbyMultijugador === 'function') {
            window.toggleListoLobbyMultijugador(nuevoEstado);
        }
    });
}

function configurarEventosSocketUI() {
    window.addEventListener('dc:grupo-chat-historial', (event) => {
        const mensajes = Array.isArray(event?.detail?.mensajes) ? event.detail.mensajes : [];
        const contenedor = document.getElementById('multi-chat-mensajes');
        if (!contenedor) return;
        contenedor.innerHTML = '';
        ultimoDiaChat = '';
        mensajes.forEach(appendMensajeChatGrupo);
    });
    window.addEventListener('dc:grupo-chat-mensaje', (event) => {
        appendMensajeChatGrupo(event?.detail?.mensaje || {});
    });
    window.addEventListener('dc:lobby-estado', (event) => {
        actualizarUIEstadoLobby(event?.detail?.estado || {});
    });
    window.addEventListener('dc:lobby-countdown', (event) => {
        const payload = event?.detail || {};
        const el = document.getElementById('multi-countdown');
        if (!el) return;
        if (payload?.activo && Number(payload?.valor) > 0) {
            el.textContent = `Empezando partida en ${Number(payload.valor)}...`;
        } else {
            el.textContent = '';
        }
    });
    window.addEventListener('dc:lobby-session-start', (event) => {
        const payload = event?.detail || {};
        showStartMessage('Partida preparada. Iniciando...');
        setTimeout(() => {
            iniciarSesionPvp(payload);
        }, 300);
    });
    window.addEventListener('dc:grupo-notificacion', (event) => {
        const payload = event?.detail || {};
        const tipo = payload?.tipo === 'error' ? 'danger' : (payload?.tipo === 'success' ? 'success' : 'warning');
        if (payload?.mensaje) {
            mostrarMensajeMulti(payload.mensaje, tipo);
        }
    });
    window.addEventListener('dc:grupo-actualizado', () => {
        validarAccesoGrupo();
        if (typeof window.solicitarEstadoLobbyMultijugador === 'function') {
            window.solicitarEstadoLobbyMultijugador();
        }
    });
}

function showStartMessage(mensaje) {
    const el = document.getElementById('multi-countdown');
    if (el) {
        el.textContent = mensaje;
    }
}

function iniciarSesionPvp(payload = {}) {
    const sessionId = String(payload?.sessionId || '').trim();
    const miMazo = Array.isArray(payload?.miMazo) ? payload.miMazo : [];
    const oponenteMazo = Array.isArray(payload?.oponenteMazo) ? payload.oponenteMazo : [];
    if (!sessionId || miMazo.length === 0 || oponenteMazo.length === 0) {
        mostrarMensajeMulti('No se pudo iniciar la sesión PvP.', 'danger');
        return;
    }
    localStorage.setItem('partidaModo', 'pvp');
    localStorage.setItem('partidaPvpSessionId', sessionId);
    localStorage.setItem('partidaPvpRol', String(payload?.rolPvp || 'A'));
    localStorage.setItem('partidaPvpPrimerTurno', String(payload?.primerTurno || 'jugador'));
    localStorage.setItem('partidaPvpInicialesJugadorIdx', JSON.stringify(
        Array.isArray(payload?.inicialesMiMazoIndices) ? payload.inicialesMiMazoIndices : []
    ));
    localStorage.setItem('partidaPvpInicialesOponenteIdx', JSON.stringify(
        Array.isArray(payload?.inicialesOponenteMazoIndices) ? payload.inicialesOponenteMazoIndices : []
    ));
    localStorage.setItem('mazoJugador', JSON.stringify({ Cartas: miMazo }));
    localStorage.setItem('mazoJugadorBase', JSON.stringify({ Cartas: miMazo }));
    localStorage.setItem('mazoOponente', JSON.stringify({ Cartas: oponenteMazo }));
    localStorage.setItem('mazoOponenteBase', JSON.stringify({ Cartas: oponenteMazo }));
    localStorage.removeItem('desafioActivo');
    localStorage.removeItem('dificultad');
    const oponente = payload?.oponente || {};
    const nombreOponente = String(oponente?.nombre || '').trim()
        || (String(oponente?.email || '').split('@')[0] || 'Oponente');
    localStorage.setItem('emailOponente', String(oponente?.email || ''));
    localStorage.setItem('nombreOponente', nombreOponente);
    localStorage.setItem('avatarOponente', String(oponente?.avatar || ''));
    window.location.href = 'tablero.html';
}

document.addEventListener('DOMContentLoaded', () => {
    const { email } = leerUsuarioSesionMulti();
    miEmailMulti = email;
    construirOpcionesMazo();
    configurarEventosUI();
    configurarEventosSocketUI();
    validarAccesoGrupo();
    if (typeof window.solicitarHistorialChatGrupo === 'function') {
        window.solicitarHistorialChatGrupo();
    }
    if (typeof window.solicitarEstadoLobbyMultijugador === 'function') {
        window.solicitarEstadoLobbyMultijugador();
    }
});
