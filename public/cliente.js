// cliente.js

const socket = io(); // Initialize socket.io client

// Obtener el email del usuario del localStorage
const email = localStorage.getItem('email');
const usuarioLS = JSON.parse(localStorage.getItem('usuario') || '{}');
const nombreUsuario = String(usuarioLS?.nickname || '').trim() || (email ? email.split('@')[0] : 'Jugador');
const avatarUsuario = String(usuarioLS?.avatar || '').trim();
const AVATAR_FALLBACK = 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';
let modalInvitacionGrupoActiva = null;
let timerInvitacionGrupoInterval = null;

console.log(`Nombre de usuario extraído del email: ${nombreUsuario}`);

// Registrar usuario con email + nickname + avatar.
socket.emit('registrarUsuario', { email, nickname: nombreUsuario, avatar: avatarUsuario });

console.log('Usuario registrado en el servidor:', nombreUsuario);

// Escuchar eventos de conexión y desconexión
socket.on('connect', () => {
    console.log('Conectado al servidor de Socket.IO');
    depurarEstadoInvitacionGrupo();
});

socket.on('disconnect', () => {
    console.log('Desconectado del servidor de Socket.IO');
});

function guardarEstadoGrupoLocal(estado = {}) {
    const estadoNormalizado = {
        enGrupo: Boolean(estado?.enGrupo),
        partyId: estado?.partyId || null,
        lider: estado?.lider || null,
        miembro: estado?.miembro || null,
        companero: estado?.companero || null,
        puedeMultijugador: Boolean(estado?.puedeMultijugador)
    };
    localStorage.setItem('grupoActual', JSON.stringify(estadoNormalizado));
    window.dispatchEvent(new Event('dc:grupo-actualizado'));
}

function leerEstadoInvitacionGrupo() {
    try {
        const estado = JSON.parse(localStorage.getItem('grupoInvitacionEnCurso') || '{}');
        return (estado && typeof estado === 'object') ? estado : {};
    } catch (_error) {
        return {};
    }
}

function persistirEstadoInvitacionGrupo(estado = {}) {
    localStorage.setItem('grupoInvitacionEnCurso', JSON.stringify({
        activa: Boolean(estado?.activa),
        targetEmail: estado?.targetEmail || null,
        expiresAt: estado?.expiresAt || null
    }));
    window.dispatchEvent(new Event('dc:grupo-invitacion-en-curso'));
}

function depurarEstadoInvitacionGrupo() {
    const estado = leerEstadoInvitacionGrupo();
    const expiracion = Number(estado?.expiresAt || 0);
    const expirada = Number.isFinite(expiracion) && expiracion > 0 && expiracion <= Date.now();
    if (!estado?.activa || expirada) {
        persistirEstadoInvitacionGrupo({ activa: false, targetEmail: null, expiresAt: null });
        return false;
    }
    return true;
}

function mostrarInvitacionGrupo({ fromEmail, fromNombre, fromAvatar, expiresAt }) {
    if (modalInvitacionGrupoActiva?.overlay?.parentElement) {
        modalInvitacionGrupoActiva.overlay.parentElement.removeChild(modalInvitacionGrupoActiva.overlay);
    }
    if (timerInvitacionGrupoInterval) {
        clearInterval(timerInvitacionGrupoInterval);
        timerInvitacionGrupoInterval = null;
    }
    const overlay = document.createElement('div');
    overlay.classList.add('overlay');

    const modal = document.createElement('div');
    modal.classList.add('modal-invitacion');

    const mensaje = document.createElement('p');
    mensaje.innerHTML = `<span class="jugador-nombre">${fromNombre}</span> te ha invitado a unirte a su grupo.`;

    const aceptarBtn = document.createElement('button');
    aceptarBtn.textContent = 'Aceptar';
    aceptarBtn.classList.add('btn', 'btn-aceptar');
    aceptarBtn.addEventListener('click', () => {
        socket.emit('grupo:respuestaInvitacion', { fromEmail, aceptada: true });
        if (timerInvitacionGrupoInterval) {
            clearInterval(timerInvitacionGrupoInterval);
            timerInvitacionGrupoInterval = null;
        }
        modalInvitacionGrupoActiva = null;
        document.body.removeChild(overlay);
    });

    const cancelarBtn = document.createElement('button');
    cancelarBtn.textContent = 'Cancelar';
    cancelarBtn.classList.add('btn', 'btn-cancelar');
    cancelarBtn.addEventListener('click', () => {
        socket.emit('grupo:respuestaInvitacion', { fromEmail, aceptada: false });
        if (timerInvitacionGrupoInterval) {
            clearInterval(timerInvitacionGrupoInterval);
            timerInvitacionGrupoInterval = null;
        }
        modalInvitacionGrupoActiva = null;
        document.body.removeChild(overlay);
    });

    const timerText = document.createElement('div');
    timerText.style.margin = '8px 0 6px';
    timerText.style.fontWeight = '700';
    timerText.style.color = '#ffd700';
    timerText.style.textShadow = '0 0 8px rgba(255, 215, 0, 0.6)';

    const timerBarWrap = document.createElement('div');
    timerBarWrap.style.width = '100%';
    timerBarWrap.style.height = '10px';
    timerBarWrap.style.borderRadius = '999px';
    timerBarWrap.style.overflow = 'hidden';
    timerBarWrap.style.background = 'rgba(50, 40, 8, 0.8)';
    timerBarWrap.style.border = '1px solid rgba(255, 215, 0, 0.5)';
    timerBarWrap.style.boxShadow = 'inset 0 0 8px rgba(0,0,0,0.45)';

    const timerBarFill = document.createElement('div');
    timerBarFill.style.height = '100%';
    timerBarFill.style.width = '100%';
    timerBarFill.style.background = 'linear-gradient(90deg, #ffd700, #ffea70)';
    timerBarFill.style.boxShadow = '0 0 10px rgba(255,215,0,0.55)';
    timerBarFill.style.transition = 'width 0.2s linear';
    timerBarWrap.appendChild(timerBarFill);

    const tiempoExpira = Number(expiresAt || (Date.now() + 20000));
    const totalMs = Math.max(tiempoExpira - Date.now(), 1000);
    const renderTimer = () => {
        const restanteMs = Math.max(0, tiempoExpira - Date.now());
        const restanteSec = Math.ceil(restanteMs / 1000);
        timerText.textContent = `La invitación expira en ${restanteSec}s`;
        const porcentaje = Math.max(0, Math.min((restanteMs / totalMs) * 100, 100));
        timerBarFill.style.width = `${porcentaje}%`;
        if (restanteMs <= 0 && timerInvitacionGrupoInterval) {
            clearInterval(timerInvitacionGrupoInterval);
            timerInvitacionGrupoInterval = null;
            if (overlay.parentElement) {
                overlay.parentElement.removeChild(overlay);
            }
            modalInvitacionGrupoActiva = null;
        }
    };
    renderTimer();
    timerInvitacionGrupoInterval = setInterval(renderTimer, 200);

    const avatar = document.createElement('img');
    avatar.src = String(fromAvatar || '').trim() || AVATAR_FALLBACK;
    avatar.alt = `Avatar de ${fromNombre}`;
    avatar.style.width = '56px';
    avatar.style.height = '56px';
    avatar.style.borderRadius = '50%';
    avatar.style.objectFit = 'cover';
    avatar.style.margin = '0 auto 8px';
    avatar.style.display = 'block';

    modal.appendChild(avatar);
    modal.appendChild(mensaje);
    modal.appendChild(timerText);
    modal.appendChild(timerBarWrap);
    modal.appendChild(aceptarBtn);
    modal.appendChild(cancelarBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    modalInvitacionGrupoActiva = { overlay, fromEmail };
}

socket.on('grupo:estado', (estado) => {
    guardarEstadoGrupoLocal(estado || {});
    if (Boolean(estado?.enGrupo)) {
        persistirEstadoInvitacionGrupo({ activa: false, targetEmail: null, expiresAt: null });
    } else {
        depurarEstadoInvitacionGrupo();
    }
});

socket.on('grupo:invitacion', (payload = {}) => {
    mostrarInvitacionGrupo(payload);
});

socket.on('grupo:invitacionCancelada', () => {
    if (timerInvitacionGrupoInterval) {
        clearInterval(timerInvitacionGrupoInterval);
        timerInvitacionGrupoInterval = null;
    }
    if (modalInvitacionGrupoActiva?.overlay?.parentElement) {
        modalInvitacionGrupoActiva.overlay.parentElement.removeChild(modalInvitacionGrupoActiva.overlay);
    }
    modalInvitacionGrupoActiva = null;
});

socket.on('grupo:notificacion', (payload = {}) => {
    const mensaje = String(payload?.mensaje || '').trim();
    if (!mensaje) return;
    window.dispatchEvent(new CustomEvent('dc:grupo-notificacion', { detail: payload }));
});

socket.on('grupo:redirigirMultijugador', () => {
    const rutaActual = String(window.location.pathname || '').toLowerCase();
    if (rutaActual.endsWith('/multijugador.html') || rutaActual.endsWith('multijugador.html')) {
        return;
    }
    window.location.href = 'multijugador.html';
});

window.invitarAGrupo = function invitarAGrupo(targetEmail) {
    const emailObjetivo = String(targetEmail || '').trim();
    if (!emailObjetivo) {
        return;
    }
    socket.emit('grupo:invitar', { targetEmail: emailObjetivo });
};

window.abandonarGrupoActual = function abandonarGrupoActual() {
    socket.emit('grupo:abandonar');
};

window.confirmarAbandonoGrupo = function confirmarAbandonoGrupo() {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.classList.add('overlay');
        overlay.style.position = 'fixed';
        overlay.style.inset = '0';
        overlay.style.background = 'rgba(0, 0, 0, 0.72)';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.zIndex = '4000';
        overlay.style.padding = '12px';

        const modal = document.createElement('div');
        modal.classList.add('modal-invitacion');
        modal.style.width = 'min(320px, 92vw)';
        modal.style.background = 'rgba(20, 20, 20, 0.95)';
        modal.style.border = '2px solid rgba(0, 123, 255, 0.5)';
        modal.style.borderRadius = '10px';
        modal.style.padding = '20px';
        modal.style.textAlign = 'center';
        modal.style.color = '#fff';
        modal.style.boxSizing = 'border-box';

        const mensaje = document.createElement('p');
        mensaje.textContent = '¿Quieres abandonar el grupo?';
        mensaje.style.margin = '0 0 12px';

        const aceptarBtn = document.createElement('button');
        aceptarBtn.textContent = 'Aceptar';
        aceptarBtn.classList.add('btn', 'btn-aceptar');
        aceptarBtn.style.margin = '8px';
        aceptarBtn.style.padding = '10px 18px';
        aceptarBtn.style.borderRadius = '6px';
        aceptarBtn.addEventListener('click', () => {
            if (overlay.parentElement) {
                overlay.parentElement.removeChild(overlay);
            }
            resolve(true);
        });

        const cancelarBtn = document.createElement('button');
        cancelarBtn.textContent = 'Cancelar';
        cancelarBtn.classList.add('btn', 'btn-cancelar');
        cancelarBtn.style.margin = '8px';
        cancelarBtn.style.padding = '10px 18px';
        cancelarBtn.style.borderRadius = '6px';
        cancelarBtn.addEventListener('click', () => {
            if (overlay.parentElement) {
                overlay.parentElement.removeChild(overlay);
            }
            resolve(false);
        });

        overlay.addEventListener('click', (event) => {
            if (event.target !== overlay) {
                return;
            }
            if (overlay.parentElement) {
                overlay.parentElement.removeChild(overlay);
            }
            resolve(false);
        });

        modal.appendChild(mensaje);
        modal.appendChild(aceptarBtn);
        modal.appendChild(cancelarBtn);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    });
};

socket.on('grupo:invitacionEnCurso', (payload = {}) => {
    persistirEstadoInvitacionGrupo(payload);
    depurarEstadoInvitacionGrupo();
});

socket.on('grupo:chat:historial', (mensajes = []) => {
    window.dispatchEvent(new CustomEvent('dc:grupo-chat-historial', { detail: { mensajes } }));
});

socket.on('grupo:chat:mensaje', (mensaje = {}) => {
    window.dispatchEvent(new CustomEvent('dc:grupo-chat-mensaje', { detail: { mensaje } }));
});

socket.on('multiplayer:lobby:estado', (estado = {}) => {
    window.dispatchEvent(new CustomEvent('dc:lobby-estado', { detail: { estado } }));
});

socket.on('multiplayer:lobby:countdown', (payload = {}) => {
    window.dispatchEvent(new CustomEvent('dc:lobby-countdown', { detail: payload }));
});

socket.on('multiplayer:session:start', (payload = {}) => {
    window.dispatchEvent(new CustomEvent('dc:lobby-session-start', { detail: payload }));
});

socket.on('coop:evento:invitacion', (payload = {}) => {
    window.dispatchEvent(new CustomEvent('dc:coop-evento-invitacion', { detail: payload }));
});

socket.on('coop:evento:invitacion:rechazada', () => {
    window.dispatchEvent(new CustomEvent('dc:coop-evento-invitacion-rechazada'));
});

socket.on('coop:evento:preparacion', (payload = {}) => {
    window.dispatchEvent(new CustomEvent('dc:coop-evento-preparacion', { detail: payload }));
});

socket.on('coop:evento:preparacion:estado', (payload = {}) => {
    window.dispatchEvent(new CustomEvent('dc:coop-evento-preparacion-estado', { detail: payload }));
});

socket.on('multiplayer:coop:session:start', (payload = {}) => {
    window.dispatchEvent(new CustomEvent('dc:coop-session-start', { detail: payload }));
});

window.emitCoopEventoInvitar = function emitCoopEventoInvitar(payload) {
    socket.emit('coop:evento:invitar', payload || {});
};

window.emitCoopEventoInvitacionResponder = function emitCoopEventoInvitacionResponder(payload) {
    socket.emit('coop:evento:invitacion:responder', payload || {});
};

window.emitCoopEventoPreparacionListo = function emitCoopEventoPreparacionListo(payload) {
    socket.emit('coop:evento:preparacion:listo', payload || {});
};

window.emitMultiplayerCoopJoin = function emitMultiplayerCoopJoin(sessionId) {
    socket.emit('multiplayer:coop:join', { sessionId: String(sessionId || '').trim() });
};

window.emitMultiplayerCoopEstado = function emitMultiplayerCoopEstado(payload) {
    socket.emit('multiplayer:coop:estado', payload || {});
};

window.emitMultiplayerCoopEstadoSolicitar = function emitMultiplayerCoopEstadoSolicitar(sessionId) {
    socket.emit('multiplayer:coop:estado:solicitar', { sessionId: String(sessionId || '').trim() });
};

window.emitMultiplayerCoopResultado = function emitMultiplayerCoopResultado(payload) {
    socket.emit('multiplayer:coop:resultado', payload || {});
};

window.emitMultiplayerCoopAccion = function emitMultiplayerCoopAccion(payload) {
    socket.emit('multiplayer:coop:accion', payload || {});
};

socket.on('multiplayer:coop:estado', (payload = {}) => {
    window.dispatchEvent(new CustomEvent('dc:coop-estado', { detail: payload }));
});

socket.on('multiplayer:coop:resync-required', (payload = {}) => {
    window.dispatchEvent(new CustomEvent('dc:coop-resync-required', { detail: payload }));
});

socket.on('multiplayer:coop:resultado', (payload = {}) => {
    window.dispatchEvent(new CustomEvent('dc:coop-resultado', { detail: payload }));
});

socket.on('multiplayer:coop:debug', (payload = {}) => {
    window.dispatchEvent(new CustomEvent('dc:coop-debug', { detail: payload }));
});

socket.on('multiplayer:coop:accion', (payload = {}) => {
    window.dispatchEvent(new CustomEvent('dc:coop-accion', { detail: payload }));
});

window.solicitarHistorialChatGrupo = function solicitarHistorialChatGrupo() {
    socket.emit('grupo:chat:historial:solicitar');
};

window.enviarMensajeChatGrupo = function enviarMensajeChatGrupo(mensaje) {
    const texto = String(mensaje || '').trim();
    if (!texto) return;
    socket.emit('grupo:chat:enviar', { mensaje: texto });
};

window.abrirLobbyMultijugador = function abrirLobbyMultijugador() {
    socket.emit('multiplayer:lobby:abrir');
};

window.solicitarEstadoLobbyMultijugador = function solicitarEstadoLobbyMultijugador() {
    socket.emit('multiplayer:lobby:estado:solicitar');
};

window.actualizarMazoLobbyMultijugador = function actualizarMazoLobbyMultijugador(mazoIndex) {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const idx = Number(mazoIndex);
    const mazoNombre = (Number.isInteger(idx) && idx >= 0 && Array.isArray(usuario?.mazos))
        ? String(usuario.mazos[idx]?.Nombre || '').trim()
        : '';
    socket.emit('multiplayer:lobby:actualizarMazo', { mazoIndex, mazoNombre });
};

window.toggleListoLobbyMultijugador = function toggleListoLobbyMultijugador(listo) {
    socket.emit('multiplayer:lobby:toggleListo', { listo: Boolean(listo) });
};

function mostrarModalAbandono(nombreOponente) {
    const overlay = document.createElement('div');
    overlay.classList.add('overlay');

    const modal = document.createElement('div');
    modal.classList.add('modal-abandono');

    const mensaje = document.createElement('p');
    mensaje.innerHTML = `<span class="jugador-nombre">${nombreOponente}</span> ha abandonado la partida. Volverás al menú principal.`;

    const aceptarBtn = document.createElement('button');
    aceptarBtn.textContent = 'Aceptar';
    aceptarBtn.classList.add('btn', 'btn-aceptar');
    aceptarBtn.addEventListener('click', () => {
        limpiarPartida();
        window.location.href = 'vistaJuego.html'; // Redirigir al menú principal
    });

    modal.appendChild(mensaje);
    modal.appendChild(aceptarBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// Manejar mensajes de chat recibidos
socket.on('mensajeChat', function (payload = {}) {
    console.log(`Mensaje de chat recibido de ${payload.usuario}: ${payload.mensaje}`);
    agregarMensajeChat(payload); // Mantener avatar/hora/timestamp
});

socket.on('chatHistorial', function (mensajes = []) {
    const chatMensajes = document.getElementById('chat-mensajes');
    if (!chatMensajes) return;
    chatMensajes.innerHTML = '';
    mensajes.forEach(msg => agregarMensajeChat(msg));
});

// Función para agregar mensajes al chat en la interfaz
function agregarMensajeChat(usuario, mensaje) {
    const chatMensajes = document.getElementById('chat-mensajes');
    const mensajeDiv = document.createElement('div');
    const nombreSpan = document.createElement('span');
    
    nombreSpan.classList.add('nombre-usuario');
    nombreSpan.textContent = `${usuario}: `;
    
    mensajeDiv.appendChild(nombreSpan);
    mensajeDiv.appendChild(document.createTextNode(mensaje));
    chatMensajes.appendChild(mensajeDiv);
    
    // Autoscroll
    chatMensajes.scrollTop = chatMensajes.scrollHeight;
}

function mostrarInvitacion(jugador, mazoJugador) {
    const overlay = document.createElement('div');
    overlay.classList.add('overlay');

    const modal = document.createElement('div');
    modal.classList.add('modal-invitacion');

    const mensaje = document.createElement('p');
    mensaje.innerHTML = `<span class="jugador-nombre">${jugador}</span> te ha invitado a jugar una partida. ¿Aceptas?`;

    const aceptarBtn = document.createElement('button');
    aceptarBtn.textContent = 'Aceptar';
    aceptarBtn.classList.add('btn', 'btn-aceptar');
    aceptarBtn.addEventListener('click', () => {
        console.log(`Aceptando invitación de ${jugador}`);
        socket.emit('respuestaInvitacion', { jugador, aceptado: true, mazoEmisor: mazoJugador }); // Enviar el mazo del jugador
        document.body.removeChild(overlay);
    });

    const cancelarBtn = document.createElement('button');
    cancelarBtn.textContent = 'Cancelar';
    cancelarBtn.classList.add('btn', 'btn-cancelar');
    cancelarBtn.addEventListener('click', () => {
        console.log(`Rechazando invitación de ${jugador}`);
        socket.emit('respuestaInvitacion', { jugador, aceptado: false });
        document.body.removeChild(overlay);
    });

    modal.appendChild(mensaje);
    modal.appendChild(aceptarBtn);
    modal.appendChild(cancelarBtn);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

socket.on('invitacionJuego', function (jugador) {
    console.log(`Recibida invitación de: ${jugador}`);
    
    const mazoJugador = JSON.parse(localStorage.getItem('mazoJugador')); // Obtener el mazo del jugador del localStorage

    if (!mazoJugador) {
        console.error('No se encontró el mazo del jugador en el localStorage.');
        return;
    }

    mostrarInvitacion(jugador, mazoJugador);  // Aquí se muestra la ventana emergente y se pasa el mazo
});

socket.on('redirigirTablero', function (datos) {
    console.log(`Redirigiendo al tablero con el oponente: ${datos.oponente}`);
    
    // Almacenar el mazo del oponente en localStorage
    localStorage.setItem('mazoOponente', JSON.stringify(datos.mazoOponente.Cartas)); // Guarda solo el array de cartas
    localStorage.setItem('nombreOponente', datos.oponente);

    // Verificar si el mazoJugador aún está disponible
    const mazoJugador = JSON.parse(localStorage.getItem('mazoJugador'));
    if (mazoJugador) {
        console.log('Mazo del jugador cargado correctamente.');
    } else {
        console.error("Error al cargar el mazo del jugador.");
        return;
    }

    // Redirigir al tablero
    window.location.href = 'tablero.html';
});

// Función para enviar mensajes en el chat
function enviarMensajeChat(mensaje) {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const emailLocal = localStorage.getItem('email') || '';
    const nombreUsuario = String(usuario?.nickname || '').trim() || (emailLocal ? emailLocal.split('@')[0] : 'Jugador');
    const avatar = String(usuario?.avatar || '').trim();
    socket.emit('mensajeChat', { usuario: nombreUsuario, mensaje, avatar });
}
