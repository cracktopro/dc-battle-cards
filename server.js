const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const XLSX = require('xlsx');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc } = require('firebase/firestore/lite');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

// Configuración de Firebase
const firebaseConfig = {
    apiKey: "AIzaSyBDx7E1BRInP2toeW-c_BLXsryQ_toPJRI",
    authDomain: "dc-card-battle.firebaseapp.com",
    projectId: "dc-card-battle",
    storageBucket: "dc-card-battle.appspot.com",
    messagingSenderId: "389571370658",
    appId: "1:389571370658:web:eb9c69029ce677aab201fb"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Inicializa la aplicación Express
const app = express();
// Detrás del proxy de Render (IPs reales en req.ip, cookies secure si aplica)
app.set('trust proxy', 1);
const port = Number(process.env.PORT) || 3000;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Servir archivos estáticos desde la carpeta 'public'
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());

// Middleware para procesar datos JSON
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Lista para usuarios conectados
let usuariosConectados = [];
// Lista de jugadores en partida
let jugadoresEnPartida = [];
// Guardar el jugador en partida
let partidasActivas = {};
const CHAT_DOC_ID = 'global-chat-history';
const CHAT_MAX_MENSAJES = 50;

async function obtenerHistorialChat() {
    try {
        const chatRef = doc(db, 'chat', CHAT_DOC_ID);
        const chatSnap = await getDoc(chatRef);
        if (!chatSnap.exists()) {
            return [];
        }
        const mensajes = Array.isArray(chatSnap.data()?.mensajes) ? chatSnap.data().mensajes : [];
        return mensajes.slice(-CHAT_MAX_MENSAJES);
    } catch (error) {
        console.error('Error obteniendo historial de chat:', error.message);
        return [];
    }
}

async function guardarMensajeChatEnHistorial(mensaje) {
    const historial = await obtenerHistorialChat();
    const nuevoHistorial = [...historial, mensaje].slice(-CHAT_MAX_MENSAJES);
    const chatRef = doc(db, 'chat', CHAT_DOC_ID);
    await setDoc(chatRef, { mensajes: nuevoHistorial }, { merge: true });
    return nuevoHistorial;
}


// Configuración de Socket.IO
io.on('connection', (socket) => {
    console.log('Un jugador se ha conectado:', socket.id);

    socket.on('registrarUsuario', async (payload) => {
        const emailUsuario = typeof payload === 'string' ? payload : payload?.email;
        if (!emailUsuario) {
            return;
        }

        const nicknameRaw = typeof payload === 'object' ? String(payload?.nickname || '').trim() : '';
        const nombreVisible = nicknameRaw || emailUsuario.split('@')[0];
        const avatar = typeof payload === 'object' ? String(payload?.avatar || '').trim() : '';

        usuariosConectados = usuariosConectados.filter(u => u.email !== emailUsuario);

        const usuario = { id: socket.id, email: emailUsuario, nombre: nombreVisible, avatar };
        usuariosConectados.push(usuario);
        io.emit('jugadoresConectados', usuariosConectados.map(u => ({ email: u.email, nombre: u.nombre, avatar: u.avatar || '' })));

        const historial = await obtenerHistorialChat();
        socket.emit('chatHistorial', historial);
    });

    // Manejar mensajes de chat recibidos
    socket.on('mensajeChat', async ({ usuario, mensaje, avatar }) => {
        const texto = String(mensaje || '').trim();
        if (!texto) {
            return;
        }

        const usuarioConectado = usuariosConectados.find(u => u.id === socket.id);
        const nombre = String(usuarioConectado?.nombre || usuario || 'Jugador').trim();
        const avatarFinal = String(usuarioConectado?.avatar || avatar || '').trim();
        const timestamp = Date.now();
        const hora = new Date(timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        const payloadMensaje = { usuario: nombre, mensaje: texto, avatar: avatarFinal, timestamp, hora };

        console.log('Mensaje recibido:', texto);
        await guardarMensajeChatEnHistorial(payloadMensaje);
        io.emit('mensajeChat', payloadMensaje);
    });

    // ---------Recibimos la invitación desde el cliente que invita------------
    socket.on('invitarJugador', ({ nombreReceptor, mazoEmisor, nombreEmisor }) => {
        // Encontrar al jugador invitado en el array de usuariosConectados
        const nombreReceptorNormalizado = String(nombreReceptor || '').trim().toLowerCase();
        const jugadorInvitado = usuariosConectados.find(u =>
            String(u?.nombre || '').trim().toLowerCase() === nombreReceptorNormalizado
            || String(u?.email || '').split('@')[0].toLowerCase() === nombreReceptorNormalizado
        );

        // Verificar si el jugador invitado existe
        if (jugadorInvitado) {
            console.log(`Enviando invitación a: ${jugadorInvitado.email}, ID de socket: ${jugadorInvitado.id}`);


            //---ENVIAMOS INVITACION AL CLIENTE RECEPTOR----
            io.to(jugadorInvitado.id).emit('invitacionRecibida', {mazoEmisor, nombreEmisor, nombreReceptor});


        } else {
            console.log(`No se encontró al jugador: ${nombreReceptor}`);
        }
    });

    // Servidor: Manejar la respuesta a la invitación
    socket.on('respuestaInvitacion', ({ aceptada, nombreEmisor, nombreReceptor, mazoReceptor}) => {
        
        const nombreEmisorNorm = String(nombreEmisor || '').trim().toLowerCase();
        const nombreReceptorNorm = String(nombreReceptor || '').trim().toLowerCase();
        const emisor = usuariosConectados.find(u =>
            String(u?.nombre || '').trim().toLowerCase() === nombreEmisorNorm
            || String(u?.email || '').split('@')[0].toLowerCase() === nombreEmisorNorm
        );
        const receptor = usuariosConectados.find(u =>
            String(u?.nombre || '').trim().toLowerCase() === nombreReceptorNorm
            || String(u?.email || '').split('@')[0].toLowerCase() === nombreReceptorNorm
        );

        if (aceptada) {
            // Si la invitación fue aceptada
            if (emisor && receptor) {
                console.log(`El jugador ${nombreReceptor} ha aceptado la invitación de ${nombreEmisor}.`);

                // Crear una sala única para la partida
                const idSala = `${nombreEmisor}_${nombreReceptor}_room`;  // ID único basado en los nombres


                // Enviar la llamada comenzarPartida a ambos jugadores
                io.to(emisor.id).emit('comenzarPartidaEmisor', {
                    nombreOponente: nombreReceptor,
                    mazoOponente: mazoReceptor,
                    idSala
                });

                io.to(receptor.id).emit('comenzarPartidaReceptor', {
                    nombreOponente: nombreEmisor,
                    idSala
                });
            }
        } else {
            // Si la invitación fue rechazada
            if (emisor) {
                console.log(`El jugador ${nombreReceptor} ha rechazado la invitación de ${nombreEmisor}.`);
                // Enviar la notificación de que la invitación fue rechazada al jugador que envió la invitación
                io.to(emisor.id).emit('invitacionRechazada', nombreReceptor);
            }
        }
    });

    //-----------FUNCIONES SERVIDOR DE LA PARTIDA------------

    // Escuchar el evento unirseSala cuando el cliente se conecta a tablero.html
    socket.on('unirseSala', (idSala) => {
        // Unir al jugador a la sala
        socket.join(idSala);
        console.log(`Jugador ${socket.id} se unió a la sala ${idSala}`);

        // Emitir confirmación al cliente
        socket.emit('unidoSala');
    });

    socket.on('cargarCartasIniciales', ({ rol, mazoJugador, idSala }) => {
        if (!partidasActivas[idSala]) {
            partidasActivas[idSala] = {
                emisor: { mazo: [], cartasEnJuego: [], socketId: null },
                receptor: { mazo: [], cartasEnJuego: [], socketId: null }
            };
        }
    
        if (rol === 'emisor') {
            partidasActivas[idSala].emisor.mazo = mazoJugador;
            partidasActivas[idSala].emisor.socketId = socket.id;
        } else if (rol === 'receptor') {
            partidasActivas[idSala].receptor.mazo = mazoJugador;
            partidasActivas[idSala].receptor.socketId = socket.id;
        }
    
        // Verificar si ambos jugadores han enviado sus mazos
        if (partidasActivas[idSala].emisor.mazo.length > 0 && partidasActivas[idSala].receptor.mazo.length > 0) {
            const mazoEmisor = partidasActivas[idSala].emisor.mazo;
            const mazoReceptor = partidasActivas[idSala].receptor.mazo;
    
            const cartasEmisor = seleccionarCartasAleatorias(mazoEmisor, 3);
            const cartasReceptor = seleccionarCartasAleatorias(mazoReceptor, 3);
    
            partidasActivas[idSala].emisor.cartasEnJuego = cartasEmisor;
            partidasActivas[idSala].receptor.cartasEnJuego = cartasReceptor;
    
            // Determinar quién tiene el primer turno (solo en el servidor)
            const jugadorConTurno = determinarPrimerTurno(cartasEmisor, cartasReceptor);
            partidasActivas[idSala].turnoActual = jugadorConTurno;

             // Aquí agregamos el log
            console.log(`El primer turno es de: ${jugadorConTurno}`);
            
            // Emitir las cartas y el turno a ambos jugadores
            io.to(partidasActivas[idSala].emisor.socketId).emit('cartasSeleccionadas', {
                cartasJugador: cartasEmisor,
                cartasOponente: cartasReceptor,
                turnoActual: jugadorConTurno
            });
            
            io.to(partidasActivas[idSala].receptor.socketId).emit('cartasSeleccionadas', {
                cartasJugador: cartasReceptor,
                cartasOponente: cartasEmisor,
                turnoActual: jugadorConTurno
            });
        }
    });
    

    // Función para calcular el poder total de las cartas
    function calcularPoderTotal(cartas) {
        return cartas.reduce((total, carta) => {
            // Si la carta es null o undefined, la ignoramos
            if (!carta || carta.Poder === null || carta.Poder === undefined) {
                return total;
            }
            return total + carta.Poder;
        }, 0);
    }

    // Escuchar evento de sacar carta
    socket.on('sacarCarta', ({ idSala, rol }) => {
        const partida = partidasActivas[idSala];

        // Verificar si es el turno del jugador y si tiene cartas en su mazo
        const mazoJugador = rol === 'emisor' ? partida.emisor : partida.receptor;
        const slotsJugador = rol === 'emisor' ? partida.slotsEmisor : partida.slotsReceptor;

        // Buscar el primer slot vacío
        const slotDisponible = slotsJugador.findIndex(slot => slot === null);
        
        if (slotDisponible === -1 || mazoJugador.length === 0) {
            // No quedan cartas en el mazo o no hay slots vacíos
            socket.emit('noHayCartas', { mensaje: "No quedan cartas o los slots están llenos." });
            return;
        }

        // Sacar carta aleatoria del mazo
        const cartaSacada = seleccionarCartasAleatorias(mazoJugador, 1)[0];

        // Asignar la carta al primer slot vacío
        slotsJugador[slotDisponible] = cartaSacada;

        // Enviar la actualización a ambos jugadores
        io.to(partida.emisorSocketId).emit('cartaSacada', { cartaSacada, slot: slotDisponible + 1 });
        io.to(partida.receptorSocketId).emit('cartaSacada', { cartaSacada, slot: slotDisponible + 1 });
    });


    socket.on('realizarAtaque', ({ idSala, rol, cartaAtacante, cartaObjetivo }) => {
        const partida = partidasActivas[idSala];
        console.log('Realizando ataque:', cartaAtacante, 'contra', cartaObjetivo);
    
        const cartasAtacante = rol === 'emisor' ? partida.emisor.cartasEnJuego : partida.receptor.cartasEnJuego;
        const cartasObjetivo = rol === 'emisor' ? partida.receptor.cartasEnJuego : partida.emisor.cartasEnJuego;
    
        const slotAtacante = cartasAtacante.findIndex(carta => carta.Nombre.trim().toLowerCase() === cartaAtacante.Nombre.trim().toLowerCase());
        const slotObjetivo = cartasObjetivo.findIndex(carta => carta.Nombre.trim().toLowerCase() === cartaObjetivo.Nombre.trim().toLowerCase());
    
        if (slotAtacante === -1 || slotObjetivo === -1) {
            console.error('Error: No se encontraron las cartas en el tablero');
            return;
        }
    
        // Aplicar la fórmula de daño solo a la carta objetivo
        const poderRestanteObjetivo = cartasObjetivo[slotObjetivo].Poder - cartasAtacante[slotAtacante].Poder;
        console.log(`Poder restante de la carta objetivo: ${poderRestanteObjetivo}`);
    
        if (poderRestanteObjetivo <= 0) {
            console.log(`Eliminando la carta objetivo: ${cartasObjetivo[slotObjetivo].Nombre}`);
            cartasObjetivo.splice(slotObjetivo, 1);  // Eliminar la carta si su poder es menor o igual a 0
        } else {
            console.log(`Actualizando poder de la carta ${cartasObjetivo[slotObjetivo].Nombre} a ${poderRestanteObjetivo}`);
            cartasObjetivo[slotObjetivo].Poder = poderRestanteObjetivo;  // Actualizar poder si sigue en juego
        }
    
        // Emitir eventos separados para el emisor y receptor
        io.to(partida.emisor.socketId).emit('resultadoAtaque', {
            cartaAtacanteActualizada: cartasAtacante[slotAtacante],
            cartaObjetivoActualizada: cartasObjetivo[slotObjetivo] || null,
            slotAtacante: slotAtacante + 1,  // Enviar el slot del atacante
            slotObjetivo: slotObjetivo + 1   // Enviar el slot del objetivo
        });
    
        io.to(partida.receptor.socketId).emit('resultadoAtaque', {
            cartaAtacanteActualizada: cartasAtacante[slotAtacante],
            cartaObjetivoActualizada: cartasObjetivo[slotObjetivo] || null,
            slotAtacante: slotAtacante + 1,  // Enviar el slot del atacante
            slotObjetivo: slotObjetivo + 1   // Enviar el slot del objetivo
        });
    
        // Cambiar el turno al oponente
        const nuevoTurno = rol === 'emisor' ? 'receptor' : 'emisor';
        partida.turnoActual = nuevoTurno;
    
        console.log(`Cambiando turno a: ${nuevoTurno}`);
        
        // Enviar el nuevo turno a ambos jugadores
        io.to(partida.emisor.socketId).emit('actualizarTurno', { turnoActual: nuevoTurno });
        io.to(partida.receptor.socketId).emit('actualizarTurno', { turnoActual: nuevoTurno });
    });
    

    // Escuchar evento de partida terminada
    socket.on('partidaTerminada', ({ ganador }) => {
        const nombreJugador = localStorage.getItem('email').split('@')[0];
        
        if (ganador === 'emisor' && localStorage.getItem('rol') === 'emisor' || ganador === 'receptor' && localStorage.getItem('rol') === 'receptor') {
            alert(`${nombreJugador}, ¡Has ganado la partida!`);
        } else {
            alert(`${nombreJugador}, ¡Has perdido la partida!`);
        }

        // Redirigir al menú principal o a la vista de resumen
        window.location.href = 'vistaJuego.html';
    });


    // Función para determinar quién tiene el primer turno
    function determinarPrimerTurno(cartasEmisor, cartasReceptor) {
        const poderEmisor = calcularPoderTotal(cartasEmisor);
        const poderReceptor = calcularPoderTotal(cartasReceptor);

        if (poderEmisor > poderReceptor) {
            return 'emisor';
        } else if (poderReceptor > poderEmisor) {
            return 'receptor';
        } else {
            // Si hay empate, seleccionar aleatoriamente
            return Math.random() > 0.5 ? 'emisor' : 'receptor';
        }
    }
    
    socket.on('disconnect', () => {
        const jugador = usuariosConectados.find(u => u.id === socket.id);
        if (jugador) {
            // Eliminar la partida si el jugador está en una
            const partida = Object.values(partidasActivas).find(p => p.jugadores.includes(socket.id));
            if (partida) {
                const oponenteId = partida.jugadores.find(j => j !== socket.id);
                if (oponenteId) {
                    // Notificar al oponente que el jugador se ha desconectado
                    console.log(`Notificando al oponente que ${jugador.nombre || jugador.email.split('@')[0]} se ha desconectado.`);
                    io.to(oponenteId).emit('oponenteAbandono', jugador.nombre || jugador.email.split('@')[0]);
                }
                delete partidasActivas[jugador.email];
            }
        }
        // Eliminar al jugador de la lista de usuarios conectados
        usuariosConectados = usuariosConectados.filter((u) => u.id !== socket.id);
        io.emit('jugadoresConectados', usuariosConectados.map(u => ({ email: u.email, nombre: u.nombre, avatar: u.avatar || '' })));
    });
});

// Rutas de tu servidor (dejar todas las demás rutas tal cual están)

//----------CLIENTE - SERVIDOR END-----------//

// Función para seleccionar 3 cartas aleatorias
function seleccionarCartasAleatorias(mazo, cantidad) {
    const cartasSeleccionadas = [];

    for (let i = 0; i < cantidad; i++) {
        const indexAleatorio = Math.floor(Math.random() * mazo.length);
        cartasSeleccionadas.push(mazo.splice(indexAleatorio, 1)[0]); // Eliminar la carta seleccionada del mazo
    }

    return cartasSeleccionadas;
}

function obtenerCartas() {
    const workbook = XLSX.readFile(path.join(__dirname, 'public/resources/cartas.xlsx'));
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const cartas = XLSX.utils.sheet_to_json(sheet);

    return cartas;
}

// Ruta de registro de usuario
app.post('/register', async (req, res) => {
    const nickname = String(req.body?.nickname || '').trim();
    const { email, contraseña } = req.body;

    if (!nickname) {
        return res.status(400).json({ mensaje: 'El nickname es obligatorio.' });
    }

    try {
        const docRef = doc(db, "users", email);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            return res.status(400).json({ mensaje: 'El usuario ya existe' });
        }

        // Hash de la contraseña
        const contraseñaHash = await bcrypt.hash(contraseña, 10);

        // Leer el archivo cartas.xlsx
        const workbook = XLSX.readFile('public/resources/cartas.xlsx');
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);

        console.log("Primer fila Excel:", data[0]);
        // Obtener las cartas de héroe y villano
        const heroes = data.filter(row => 
            (row.Faccion || row['faccion'] || row.faccion || '')
                .toString()
                .trim()
                .toUpperCase() === 'H'
        );

        const villanos = data.filter(row => 
            (row.Faccion || row['faccion'] || row.faccion || '')
                .toString()
                .trim()
                .toUpperCase() === 'V'
        );

        if (heroes.length < 12 || villanos.length < 12) {
            return res.status(500).json({ mensaje: 'No hay suficientes cartas de héroe o villano en el archivo' });
        }

        // Seleccionar 12 cartas aleatorias de cada uno
        const cartasHeroes = seleccionarCartasAleatorias([...heroes], 12);
        const cartasVillanos = seleccionarCartasAleatorias([...villanos], 12);

        function inicializarCartas(cartas) {
            return cartas.map(carta => ({
                ...carta,
                Nivel: 1,
                Poder: parseInt(carta.Poder) || 0
            }));
        }

        // Inicializar nivel y poder
        const cartasAsignadas = [...inicializarCartas(cartasHeroes), ...inicializarCartas(cartasVillanos)];

        // Crear el usuario en Firebase Firestore
        await setDoc(docRef, {
            contraseñaHash,
            nickname,
            avatar: '',
            puntos: 0,
            cartas: cartasAsignadas,
            mazos: []
        });

        res.status(201).json({ mensaje: 'Usuario registrado con éxito' });
    } catch (error) {
        console.error("Error al registrar el usuario:", error.message);
        res.status(500).json({ mensaje: 'Error al procesar la solicitud' });
    }
});

// Ruta de inicio de sesión
app.post('/login', async (req, res) => {
    const { email, contraseña } = req.body;

    try {
        const docRef = doc(db, "users", email);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            return res.status(400).json({ mensaje: 'Usuario no encontrado' });
        }

        const userData = docSnap.data();
        const esCorrecta = await bcrypt.compare(contraseña, userData.contraseñaHash);

        if (esCorrecta) {
            res.status(200).json({ mensaje: 'Inicio de sesión exitoso', usuario: userData });
        } else {
            res.status(400).json({ mensaje: 'Contraseña incorrecta' });
        }
    } catch (error) {
        console.error("Error en el inicio de sesión:", error.message);
        res.status(500).json({ mensaje: 'Error al procesar la solicitud' });
    }
});
// server.js

// Ruta para obtener el usuario desde Firebase
app.post('/get-user', async (req, res) => {
    const { email } = req.body; // Obtener el email del cuerpo de la solicitud

    if (!email) {
        return res.status(400).json({ mensaje: 'Email no proporcionado.' });
    }

    try {
        const docRef = doc(db, "users", email);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            res.status(200).json({ usuario: docSnap.data() });
        } else {
            res.status(404).json({ mensaje: 'Usuario no encontrado.' });
        }
    } catch (error) {
        console.error("Error al obtener los datos del usuario desde Firebase:", error.message);
        res.status(500).json({ mensaje: 'Error al obtener los datos del usuario desde Firebase.' });
    }
});


// Ruta para actualizar el usuario en Firebase
app.post('/update-user', async (req, res) => {
    const { usuario, email } = req.body; // Obtener el usuario y el email del cuerpo de la solicitud

    // Log para verificar los datos recibidos del cliente
    console.log("Datos recibidos en /update-user:");
    console.log("Usuario:", usuario);
    console.log("Email:", email);

    if (!usuario || !email) {
        console.error("Datos de usuario o email no válidos.");
        return res.status(400).json({ mensaje: 'Datos de usuario o email no válidos.' });
    }

    try {
        const docRef = doc(db, "users", email);
        
        // Log para verificar el documento que se va a actualizar en Firebase
        console.log("Actualizando documento en Firebase para el usuario con email:", email);
        console.log("Datos del usuario para actualizar:", usuario);

        // Actualizar el documento del usuario en Firebase Firestore
        const docActual = await getDoc(docRef);
        const datosActuales = docActual.data();

        // PROTECCIÓN DE CARTAS: solo rellenar cuando venga undefined/null.
        if (!Array.isArray(usuario.cartas)) {
            usuario.cartas = datosActuales.cartas || [];
        }

        // PROTECCIÓN DE MAZOS: solo rellenar cuando venga undefined/null.
        if (!Array.isArray(usuario.mazos)) {
            usuario.mazos = datosActuales.mazos || [];
        }

        await setDoc(docRef, { ...usuario }, { merge: true });

        // Log para confirmar que la actualización fue exitosa
        console.log("Datos del usuario actualizados correctamente en Firebase.");

        // Verificar datos después de la actualización
        const updatedDoc = await getDoc(docRef);
        if (updatedDoc.exists()) {
            console.log("Datos actuales en Firebase después de la actualización:", updatedDoc.data());
        } else {
            console.log("El documento no existe después de la actualización.");
        }

        res.status(200).json({ mensaje: 'Datos de usuario actualizados correctamente en Firebase.' });
    } catch (error) {
        console.error("Error al actualizar los datos del usuario en Firebase:", error.message);
        res.status(500).json({ mensaje: 'Error al actualizar los datos del usuario en Firebase.' });
    }
});

// Inicia el servidor (0.0.0.0 para que Render y contenedores acepten tráfico externo)
const listenHost = process.env.HOST || '0.0.0.0';
server.listen(port, listenHost, () => {
    const base =
        process.env.RENDER_EXTERNAL_URL ||
        (listenHost === '0.0.0.0' ? `http://localhost:${port}` : `http://${listenHost}:${port}`);
    console.log(`Servidor escuchando en ${listenHost}:${port} — ${base}`);
});
