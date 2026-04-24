// cliente.js

const socket = io(); // Initialize socket.io client

// Obtener el email del usuario del localStorage
const email = localStorage.getItem('email');
const usuarioLS = JSON.parse(localStorage.getItem('usuario') || '{}');
const nombreUsuario = String(usuarioLS?.nickname || '').trim() || (email ? email.split('@')[0] : 'Jugador');
const avatarUsuario = String(usuarioLS?.avatar || '').trim();

console.log(`Nombre de usuario extraído del email: ${nombreUsuario}`);

// Registrar usuario con email + nickname + avatar.
socket.emit('registrarUsuario', { email, nickname: nombreUsuario, avatar: avatarUsuario });

console.log('Usuario registrado en el servidor:', nombreUsuario);

// Escuchar eventos de conexión y desconexión
socket.on('connect', () => {
    console.log('Conectado al servidor de Socket.IO');
});

socket.on('disconnect', () => {
    console.log('Desconectado del servidor de Socket.IO');
});

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
