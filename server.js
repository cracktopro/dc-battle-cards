const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const XLSX = require('xlsx');
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, getDoc, collection, getDocs } = require('firebase/firestore/lite');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const DCHealDebuff = require(path.join(__dirname, 'public', 'js', 'healDebuffCombat.js'));
const DCSkinsCartas = require(path.join(__dirname, 'public', 'js', 'skinsCartas.js'));

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
// Subimos el límite para evitar 413 en perfiles con inventarios/cartas grandes.
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '5mb' }));

app.get('/api/pvp-debug/:sessionId', (req, res) => {
    if (!PVP_DEBUG_ENABLED) {
        return res.status(403).json({ ok: false, message: 'PVP_DEBUG desactivado en servidor.' });
    }
    const sessionId = String(req.params?.sessionId || '').trim();
    if (!sessionId) {
        return res.status(400).json({ ok: false, message: 'sessionId requerido.' });
    }
    const eventos = trazasPvpPorSesion.get(sessionId) || [];
    return res.json({
        ok: true,
        sessionId,
        total: eventos.length,
        eventos
    });
});

app.get('/healthz', (_req, res) => {
    const sesionesActivas = Array.from(sesionesPvpActivas.values()).filter(s => s && !s.finalizada).length;
    return res.status(200).json({
        ok: true,
        ts: Date.now(),
        sesionesPvpActivas: sesionesActivas
    });
});

/** Imágenes de fondo del tablero (VS BOT aleatorio en cliente). */
app.get('/api/tableros', (_req, res) => {
    const dir = path.join(__dirname, 'public/resources/tableros');
    try {
        const nombres = fs.readdirSync(dir, { withFileTypes: true })
            .filter((d) => d.isFile() && /\.(png|jpe?g|webp)$/i.test(d.name))
            .map((d) => d.name);
        return res.json({ archivos: nombres });
    } catch (error) {
        console.warn('[api/tableros]', error.message);
        return res.json({ archivos: ['tablero_background.png'] });
    }
});

// Lista para usuarios conectados
let usuariosConectados = [];
// Lista de jugadores en partida
let jugadoresEnPartida = [];
// Guardar el jugador en partida
let partidasActivas = {};
const gruposActivos = new Map(); // partyId -> { id, leaderEmail, memberEmail, createdAt }
const indiceGrupoPorEmail = new Map(); // email -> partyId
const invitacionesGrupoPendientes = new Map(); // targetEmail -> { fromEmail, createdAt }
const invitacionesSalientesPendientes = new Map(); // fromEmail -> targetEmail
const temporizadoresInvitacionGrupo = new Map(); // targetEmail -> timeoutId
const INVITACION_GRUPO_TIMEOUT_MS = 20000;
const chatGrupoPorParty = new Map(); // partyId -> mensajes[]
const lobbiesMultijugador = new Map(); // partyId -> estado lobby
const CHAT_GRUPO_MAX_MENSAJES = 60;
const GRUPO_RECONEXION_GRACIA_MS = 20000;
const disolucionesPendientesGrupo = new Map(); // partyId -> timeoutId
const sesionesPvpActivas = new Map(); // sessionId -> metadata
const preparacionesCoopEvento = new Map(); // prepId -> estado invitación / selección 6 cartas
const sesionesCoopEventoActivas = new Map(); // sessionId -> metadata coop vs BOT
const intercambiosActivos = new Map(); // partyId -> estado intercambio
let catalogoCartasServidorCache = null;
let filasEventosOnlineCache = null;
const LEGACY_SOCKET_COMBATE_ACTIVO = false;
const PVP_RECONEXION_GRACIA_MS = 20000;
const pvpDesconexionesPendientes = new Map(); // `${sessionId}::${email}` -> timeoutId
const PVP_DEBUG_ENABLED = String(process.env.PVP_DEBUG || 'false').trim().toLowerCase() === 'true';
const MAX_PVP_DEBUG_EVENTS = 500;
const trazasPvpPorSesion = new Map(); // sessionId -> eventos[]
const RENDER_KEEPALIVE_URL = String(
    process.env.RENDER_EXTERNAL_URL
    || process.env.PUBLIC_BASE_URL
    || process.env.APP_BASE_URL
    || ''
).trim().replace(/\/+$/, '');
const RENDER_KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;
const RENDER_KEEPALIVE_TIMEOUT_MS = 8000;
let renderKeepAliveTimer = null;

function registrarTrazaPvp(sessionId, eventType, payload = {}) {
    if (!PVP_DEBUG_ENABLED) return;
    const sid = String(sessionId || '').trim();
    if (!sid) return;
    const lista = trazasPvpPorSesion.get(sid) || [];
    lista.push({
        timestamp: Date.now(),
        eventType: String(eventType || 'evento'),
        payload
    });
    if (lista.length > MAX_PVP_DEBUG_EVENTS) {
        lista.splice(0, lista.length - MAX_PVP_DEBUG_EVENTS);
    }
    trazasPvpPorSesion.set(sid, lista);
}

function contarSesionesPvpEnCurso() {
    let total = 0;
    for (const sesion of sesionesPvpActivas.values()) {
        if (sesion && !sesion.finalizada) {
            total += 1;
        }
    }
    return total;
}

async function enviarPingKeepAliveRender() {
    if (!RENDER_KEEPALIVE_URL || typeof fetch !== 'function') {
        return;
    }
    if (contarSesionesPvpEnCurso() <= 0) {
        return;
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RENDER_KEEPALIVE_TIMEOUT_MS);
    try {
        await fetch(`${RENDER_KEEPALIVE_URL}/healthz?src=pvp_keepalive`, {
            method: 'GET',
            signal: controller.signal
        });
    } catch (_error) {
        // Keepalive best-effort: no afecta al flujo de partida.
    } finally {
        clearTimeout(timeoutId);
    }
}

function actualizarSupervisorKeepAliveRender() {
    const haySesionesActivas = contarSesionesPvpEnCurso() > 0;
    if (!haySesionesActivas || !RENDER_KEEPALIVE_URL) {
        if (renderKeepAliveTimer) {
            clearInterval(renderKeepAliveTimer);
            renderKeepAliveTimer = null;
        }
        return;
    }
    if (renderKeepAliveTimer) {
        return;
    }
    renderKeepAliveTimer = setInterval(() => {
        void enviarPingKeepAliveRender();
    }, RENDER_KEEPALIVE_INTERVAL_MS);
    void enviarPingKeepAliveRender();
}

function obtenerClaveDesconexionPvp(sessionId, email) {
    return `${String(sessionId || '').trim()}::${normalizarTexto(email)}`;
}

function cancelarDesconexionPendientePvp(sessionId, email) {
    const key = obtenerClaveDesconexionPvp(sessionId, email);
    const timer = pvpDesconexionesPendientes.get(key);
    if (timer) {
        clearTimeout(timer);
        pvpDesconexionesPendientes.delete(key);
    }
}

function normalizarTexto(valor) {
    return String(valor || '').trim().toLowerCase();
}

/**
 * Nombres de carta (sin nivel) para bloqueo cruzado en la selección coop:
 * si jugador A elige una carta, jugador B no puede elegir ninguna copia
 * con el mismo nombre, independientemente del nivel.
 */
function clavesCartasCoopParaBloqueo(cartas) {
    const unicos = new Set();
    (Array.isArray(cartas) ? cartas : []).forEach((c) => {
        const n = normalizarTexto(c?.Nombre || '');
        if (n) unicos.add(n);
    });
    return Array.from(unicos).map((n) => ({ n }));
}

function cartasBContienenClavesDeA(cartasB, clavesA) {
    if (!Array.isArray(cartasB) || !cartasB.length || !Array.isArray(clavesA) || !clavesA.length) {
        return false;
    }
    const setA = new Set(clavesA.map((k) => normalizarTexto(k?.n || '')).filter(Boolean));
    for (const c of cartasB) {
        const n = normalizarTexto(c?.Nombre || '');
        if (n && setA.has(n)) {
            return true;
        }
    }
    return false;
}

function obtenerUsuarioConectadoPorEmail(email) {
    const emailNorm = normalizarTexto(email);
    return usuariosConectados.find(u => normalizarTexto(u?.email) === emailNorm) || null;
}

function obtenerUsuarioConectadoPorSocketId(socketId) {
    return usuariosConectados.find(u => String(u?.id) === String(socketId)) || null;
}

function obtenerSnapshotJugadoresConectados() {
    return usuariosConectados.map(u => {
        const partyId = indiceGrupoPorEmail.get(u.email) || null;
        return {
            email: u.email,
            nombre: u.nombre,
            avatar: u.avatar || '',
            enGrupo: Boolean(partyId),
            partyId
        };
    });
}

function emitirJugadoresConectados() {
    io.emit('jugadoresConectados', obtenerSnapshotJugadoresConectados());
}

function crearIdGrupo(leaderEmail, memberEmail) {
    return `party_${Date.now()}_${Buffer.from(`${leaderEmail}|${memberEmail}`).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}`;
}

function construirEstadoGrupoParaEmail(email) {
    const partyId = indiceGrupoPorEmail.get(email);
    if (!partyId || !gruposActivos.has(partyId)) {
        return {
            enGrupo: false,
            partyId: null,
            lider: null,
            miembro: null,
            companero: null,
            puedeMultijugador: false
        };
    }

    const party = gruposActivos.get(partyId);
    const lider = obtenerUsuarioConectadoPorEmail(party.leaderEmail) || { email: party.leaderEmail, nombre: party.leaderEmail.split('@')[0], avatar: '' };
    const miembro = obtenerUsuarioConectadoPorEmail(party.memberEmail) || { email: party.memberEmail, nombre: party.memberEmail.split('@')[0], avatar: '' };
    const companero = normalizarTexto(email) === normalizarTexto(lider.email) ? miembro : lider;

    return {
        enGrupo: true,
        partyId,
        lider: { email: lider.email, nombre: lider.nombre, avatar: lider.avatar || '' },
        miembro: { email: miembro.email, nombre: miembro.nombre, avatar: miembro.avatar || '' },
        companero: { email: companero.email, nombre: companero.nombre, avatar: companero.avatar || '' },
        puedeMultijugador: true
    };
}

function emitirEstadoGrupo(email) {
    const usuario = obtenerUsuarioConectadoPorEmail(email);
    if (!usuario) {
        return;
    }
    io.to(usuario.id).emit('grupo:estado', construirEstadoGrupoParaEmail(email));
}

function emitirEstadoInvitacionSaliente(email, activa, targetEmail = null, expiresAt = null) {
    const usuario = obtenerUsuarioConectadoPorEmail(email);
    if (!usuario?.id) return;
    io.to(usuario.id).emit('grupo:invitacionEnCurso', {
        activa: Boolean(activa),
        targetEmail: targetEmail || null,
        expiresAt: Number.isFinite(Number(expiresAt)) ? Number(expiresAt) : null
    });
}

function limpiarInvitacionPendienteTarget(targetEmail, motivo = null, emitirCancelacionTarget = false) {
    const invitacion = invitacionesGrupoPendientes.get(targetEmail);
    if (!invitacion) {
        return null;
    }
    invitacionesGrupoPendientes.delete(targetEmail);
    invitacionesSalientesPendientes.delete(invitacion.fromEmail);
    if (temporizadoresInvitacionGrupo.has(targetEmail)) {
        clearTimeout(temporizadoresInvitacionGrupo.get(targetEmail));
        temporizadoresInvitacionGrupo.delete(targetEmail);
    }
    emitirEstadoInvitacionSaliente(invitacion.fromEmail, false, null, null);
    if (emitirCancelacionTarget) {
        const target = obtenerUsuarioConectadoPorEmail(targetEmail);
        if (target?.id) {
            io.to(target.id).emit('grupo:invitacionCancelada', {
                fromEmail: invitacion.fromEmail,
                motivo: motivo || 'Invitación cancelada.'
            });
        }
    }
    return invitacion;
}

function crearEstadoOfertaIntercambio(email) {
    return {
        email: String(email || '').trim(),
        indices: [],
        cartas: [],
        aceptado: false
    };
}

function obtenerIntercambioPorParty(partyId) {
    return partyId ? intercambiosActivos.get(partyId) || null : null;
}

function cancelarIntercambioPorParty(partyId, motivo = 'Intercambio cancelado.') {
    const trade = intercambiosActivos.get(partyId);
    if (!trade) {
        return;
    }
    intercambiosActivos.delete(partyId);
    emitirAGrupo(partyId, 'trade:cancelado', { motivo: String(motivo || 'Intercambio cancelado.') });
}

function agruparCartasPorNombreServidor(cartas) {
    const mapa = new Map();
    (Array.isArray(cartas) ? cartas : []).forEach((carta, index) => {
        const nombre = String(carta?.Nombre || '').trim().toLowerCase();
        if (!nombre) {
            return;
        }
        if (!mapa.has(nombre)) {
            mapa.set(nombre, []);
        }
        mapa.get(nombre).push({ index, carta });
    });
    return mapa;
}

function indicesIntercambiablesValidos(cartas, indicesOfrecidos) {
    const arr = Array.isArray(cartas) ? cartas : [];
    const indices = [...new Set((indicesOfrecidos || [])
        .map((i) => Number(i))
        .filter((i) => Number.isInteger(i) && i >= 0 && i < arr.length))];
    if (!indices.length) {
        return true;
    }
    const mapa = agruparCartasPorNombreServidor(arr);
    const conteoOferta = new Map();
    indices.forEach((idx) => {
        const nombre = String(arr[idx]?.Nombre || '').trim().toLowerCase();
        conteoOferta.set(nombre, (conteoOferta.get(nombre) || 0) + 1);
    });
    for (const [nombre, cantOfertada] of conteoOferta.entries()) {
        const grupo = mapa.get(nombre) || [];
        if (grupo.length < 2) {
            return false;
        }
        if (grupo.length - cantOfertada < 1) {
            return false;
        }
    }
    return true;
}

function sincronizarMazosConColeccionServidor(usuario) {
    if (!usuario || typeof usuario !== 'object') {
        return;
    }
    if (!Array.isArray(usuario.mazos)) {
        usuario.mazos = [];
        return;
    }
    const pool = new Map();
    (usuario.cartas || []).forEach((carta) => {
        const clave = String(carta?.Nombre || '').trim().toLowerCase();
        if (!clave) {
            return;
        }
        if (!pool.has(clave)) {
            pool.set(clave, []);
        }
        pool.get(clave).push(carta);
    });
    pool.forEach((lista) => {
        lista.sort((a, b) => Number(b?.Nivel || 1) - Number(a?.Nivel || 1));
    });
    usuario.mazos = usuario.mazos.map((mazo) => {
        const cartasSincronizadas = (mazo?.Cartas || []).map((cartaMazo) => {
            const clave = String(cartaMazo?.Nombre || '').trim().toLowerCase();
            const disponibles = pool.get(clave) || [];
            if (disponibles.length > 0) {
                return { ...disponibles[0] };
            }
            return { ...cartaMazo };
        });
        return { ...mazo, Cartas: cartasSincronizadas };
    });
}

function quitarCartasPorIndices(cartas, indices) {
    const arr = [...(Array.isArray(cartas) ? cartas : [])];
    const ordenados = [...indices].map(Number).filter(Number.isInteger).sort((a, b) => b - a);
    const extraidas = [];
    ordenados.forEach((idx) => {
        if (idx >= 0 && idx < arr.length) {
            extraidas.unshift(arr.splice(idx, 1)[0]);
        }
    });
    return { cartas: arr, extraidas };
}

function serializarCartaIntercambio(carta) {
    if (!carta || typeof carta !== 'object') {
        return null;
    }
    return {
        Nombre: carta.Nombre,
        Nivel: carta.Nivel,
        Poder: carta.Poder,
        Salud: carta.Salud,
        SaludMax: carta.SaludMax ?? carta.saludMax,
        faccion: carta.faccion,
        skill_name: carta.skill_name,
        skill_power: carta.skill_power,
        skill_trigger: carta.skill_trigger,
        imagen: carta.imagen,
        skin_id: carta.skin_id
    };
}

function construirPayloadEstadoIntercambio(partyId, trade) {
    const party = gruposActivos.get(partyId);
    if (!party || !trade) {
        return { activo: false };
    }
    const emails = [party.leaderEmail, party.memberEmail];
    const jugadores = {};
    emails.forEach((email) => {
        const conectado = obtenerUsuarioConectadoPorEmail(email);
        const oferta = trade.ofertas[email] || crearEstadoOfertaIntercambio(email);
        jugadores[email] = {
            email,
            nombre: conectado?.nombre || email.split('@')[0],
            avatar: conectado?.avatar || '',
            indices: [...(oferta.indices || [])],
            cartas: Array.isArray(oferta.cartas) ? oferta.cartas.map((c) => ({ ...c })) : [],
            aceptado: Boolean(oferta.aceptado)
        };
    });
    return {
        activo: trade.fase === 'activo',
        fase: trade.fase,
        solicitanteEmail: trade.solicitanteEmail || null,
        partyId,
        jugadores
    };
}

function emitirEstadoIntercambio(partyId) {
    const trade = intercambiosActivos.get(partyId);
    if (!trade) {
        emitirAGrupo(partyId, 'trade:estado', { activo: false });
        return;
    }
    emitirAGrupo(partyId, 'trade:estado', construirPayloadEstadoIntercambio(partyId, trade));
}

async function ejecutarIntercambioGrupo(partyId) {
    const trade = intercambiosActivos.get(partyId);
    const party = gruposActivos.get(partyId);
    if (!trade || !party || trade.fase !== 'activo') {
        return { ok: false, mensaje: 'No hay un intercambio activo.' };
    }
    const emailA = party.leaderEmail;
    const emailB = party.memberEmail;
    const ofertaA = trade.ofertas[emailA];
    const ofertaB = trade.ofertas[emailB];
    if (!ofertaA?.aceptado || !ofertaB?.aceptado) {
        return { ok: false, mensaje: 'Ambos jugadores deben aceptar.' };
    }
    const [userA, userB] = await Promise.all([
        obtenerUsuarioPersistidoPorEmail(emailA),
        obtenerUsuarioPersistidoPorEmail(emailB)
    ]);
    if (!userA || !userB) {
        return { ok: false, mensaje: 'No se pudo cargar el progreso de los jugadores.' };
    }
    const cartasA = [...(userA.cartas || [])];
    const cartasB = [...(userB.cartas || [])];
    if (!indicesIntercambiablesValidos(cartasA, ofertaA.indices) || !indicesIntercambiablesValidos(cartasB, ofertaB.indices)) {
        return { ok: false, mensaje: 'Oferta inválida: solo puedes intercambiar duplicados sobrantes.' };
    }
    const remA = quitarCartasPorIndices(cartasA, ofertaA.indices);
    const remB = quitarCartasPorIndices(cartasB, ofertaB.indices);
    remA.cartas.push(...remB.extraidas);
    remB.cartas.push(...remA.extraidas);
    const usuarioA = { ...userA, cartas: remA.cartas };
    const usuarioB = { ...userB, cartas: remB.cartas };
    sincronizarMazosConColeccionServidor(usuarioA);
    sincronizarMazosConColeccionServidor(usuarioB);
    const [saveA, saveB] = await Promise.all([
        guardarUsuarioConControlConcurrencia(emailA, usuarioA),
        guardarUsuarioConControlConcurrencia(emailB, usuarioB)
    ]);
    if (!saveA.ok || !saveB.ok) {
        return { ok: false, mensaje: 'Conflicto al guardar. Vuelve a intentar el intercambio.' };
    }
    intercambiosActivos.delete(partyId);
    emitirAGrupo(partyId, 'trade:completado', {
        usuarios: {
            [emailA]: saveA.usuario,
            [emailB]: saveB.usuario
        }
    });
    return { ok: true };
}

function disolverGrupoPorId(partyId, motivo = 'Grupo disuelto.') {
    const party = gruposActivos.get(partyId);
    if (!party) {
        return;
    }
    cancelarIntercambioPorParty(partyId, 'Intercambio cancelado: el grupo se disolvió.');
    if (disolucionesPendientesGrupo.has(partyId)) {
        clearTimeout(disolucionesPendientesGrupo.get(partyId));
        disolucionesPendientesGrupo.delete(partyId);
    }
    const lobby = lobbiesMultijugador.get(partyId);
    if (lobby?.countdownTimer) {
        clearInterval(lobby.countdownTimer);
    }
    lobbiesMultijugador.delete(partyId);
    chatGrupoPorParty.delete(partyId);
    const participantes = [party.leaderEmail, party.memberEmail];
    gruposActivos.delete(partyId);
    participantes.forEach(email => {
        indiceGrupoPorEmail.delete(email);
        emitirEstadoGrupo(email);
        const usuario = obtenerUsuarioConectadoPorEmail(email);
        if (usuario) {
            io.to(usuario.id).emit('grupo:notificacion', { tipo: 'info', mensaje: motivo });
        }
    });
    emitirJugadoresConectados();
}

function cancelarDisolucionPendienteGrupo(partyId) {
    if (!partyId || !disolucionesPendientesGrupo.has(partyId)) {
        return;
    }
    clearTimeout(disolucionesPendientesGrupo.get(partyId));
    disolucionesPendientesGrupo.delete(partyId);
}

function programarDisolucionGrupoPorDesconexion(partyId, emailQueSeDesconecto) {
    if (!partyId || !gruposActivos.has(partyId)) {
        return;
    }
    cancelarDisolucionPendienteGrupo(partyId);
    const timeoutId = setTimeout(() => {
        disolucionesPendientesGrupo.delete(partyId);
        if (!gruposActivos.has(partyId)) {
            return;
        }
        const sigueFuera = !obtenerUsuarioConectadoPorEmail(emailQueSeDesconecto);
        if (!sigueFuera) {
            return;
        }
        const party = gruposActivos.get(partyId);
        const otroEmail = [party?.leaderEmail, party?.memberEmail]
            .filter(Boolean)
            .find(email => normalizarTexto(email) !== normalizarTexto(emailQueSeDesconecto));
        disolverGrupoPorId(partyId, 'Grupo disuelto por desconexión prolongada de un miembro.');
        if (otroEmail) {
            emitirEstadoGrupo(otroEmail);
        }
    }, GRUPO_RECONEXION_GRACIA_MS);
    disolucionesPendientesGrupo.set(partyId, timeoutId);
}

function obtenerEmailsGrupo(partyId) {
    const party = gruposActivos.get(partyId);
    if (!party) return [];
    return [party.leaderEmail, party.memberEmail];
}

function emitirAGrupo(partyId, evento, payload) {
    obtenerEmailsGrupo(partyId).forEach(email => {
        const usuario = obtenerUsuarioConectadoPorEmail(email);
        if (usuario?.id) {
            io.to(usuario.id).emit(evento, payload);
        }
    });
}

function obtenerMensajeChatGrupo(payload = {}) {
    const timestamp = Date.now();
    return {
        usuario: String(payload.usuario || 'Jugador'),
        email: String(payload.email || '').trim(),
        avatar: String(payload.avatar || '').trim(),
        mensaje: String(payload.mensaje || '').trim(),
        timestamp,
        hora: new Date(timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    };
}

function obtenerSnapshotLobby(partyId) {
    const lobby = lobbiesMultijugador.get(partyId);
    const party = gruposActivos.get(partyId);
    if (!lobby || !party) {
        return {
            partyId,
            abierto: false,
            jugadores: [],
            ambosListos: false,
            countdown: null
        };
    }
    const emails = [party.leaderEmail, party.memberEmail];
    const jugadores = emails.map(email => {
        const user = obtenerUsuarioConectadoPorEmail(email);
        const estado = lobby.jugadores[email] || { mazoIndex: null, mazoNombre: null, listo: false };
        return {
            email,
            nombre: user?.nombre || email.split('@')[0],
            avatar: user?.avatar || '',
            mazoIndex: Number.isInteger(estado.mazoIndex) ? estado.mazoIndex : null,
            mazoNombre: String(estado?.mazoNombre || '').trim() || null,
            listo: Boolean(estado.listo)
        };
    });
    const ambosListos = jugadores.length === 2 && jugadores.every(j => j.listo && Number.isInteger(j.mazoIndex) && j.mazoIndex >= 0);
    return {
        partyId,
        abierto: true,
        jugadores,
        ambosListos,
        countdown: Number.isInteger(lobby.countdown) ? lobby.countdown : null
    };
}

function resolverMazoSeleccionado(datosUsuario, seleccion = {}) {
    const mazos = Array.isArray(datosUsuario?.mazos) ? datosUsuario.mazos : [];
    if (!mazos.length) return null;
    const idx = Number(seleccion?.mazoIndex);
    const nombreEsperado = String(seleccion?.mazoNombre || '').trim().toLowerCase();
    const porIndice = Number.isInteger(idx) && idx >= 0 && idx < mazos.length ? mazos[idx] : null;
    if (porIndice && Array.isArray(porIndice?.Cartas)) {
        if (!nombreEsperado) return porIndice.Cartas;
        const nombreIndice = String(porIndice?.Nombre || '').trim().toLowerCase();
        if (nombreIndice === nombreEsperado) return porIndice.Cartas;
    }
    if (nombreEsperado) {
        const porNombre = mazos.find(m => String(m?.Nombre || '').trim().toLowerCase() === nombreEsperado);
        if (porNombre && Array.isArray(porNombre?.Cartas)) {
            return porNombre.Cartas;
        }
    }
    return null;
}

function emitirSnapshotLobby(partyId) {
    emitirAGrupo(partyId, 'multiplayer:lobby:estado', obtenerSnapshotLobby(partyId));
}

async function obtenerUsuarioPersistidoPorEmail(email) {
    if (!email) return null;
    try {
        const ref = doc(db, 'users', email);
        const snap = await getDoc(ref);
        return snap.exists() ? snap.data() : null;
    } catch (error) {
        console.error('Error obteniendo usuario persistido:', error.message);
        return null;
    }
}

function calcularPoderTotalMazo(mazo = []) {
    return (Array.isArray(mazo) ? mazo : []).reduce((acc, carta) => {
        return acc + Math.max(0, Number(carta?.Poder || 0));
    }, 0);
}

function determinarPrimerTurnoPvp(mazoA = [], mazoB = []) {
    const poderA = calcularPoderTotalMazo(mazoA);
    const poderB = calcularPoderTotalMazo(mazoB);
    if (poderA > poderB) return 'A';
    if (poderB > poderA) return 'B';
    return Math.random() > 0.5 ? 'A' : 'B';
}

function seleccionarIndicesAleatorios(cantidad, longitudMazo) {
    const total = Math.max(0, Number(longitudMazo) || 0);
    const cantidadObjetivo = Math.min(Math.max(0, Number(cantidad) || 0), total);
    const indices = Array.from({ length: total }, (_, idx) => idx);
    for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    return indices.slice(0, cantidadObjetivo);
}

function obtenerRoomSesionPvp(sessionId) {
    return `pvp:${String(sessionId || '').trim()}`;
}

function obtenerSesionPvpPorEmail(email) {
    const emailNorm = normalizarTexto(email);
    for (const sesion of sesionesPvpActivas.values()) {
        if (normalizarTexto(sesion?.emailA) === emailNorm || normalizarTexto(sesion?.emailB) === emailNorm) {
            return sesion;
        }
    }
    return null;
}

function obtenerLadoPvpDesdeEmail(sesion, email) {
    const norm = normalizarTexto(email);
    if (norm === normalizarTexto(sesion?.emailA)) return 'A';
    if (norm === normalizarTexto(sesion?.emailB)) return 'B';
    return null;
}
function obtenerSaludMaxCarta(carta) {
    if (!carta) {
        return 0;
    }

    const saludMax = Number(carta.SaludMax ?? carta.saludMax);
    if (Number.isFinite(saludMax) && saludMax > 0) {
        return saludMax;
    }

    const salud = Number(carta.Salud ?? carta.salud);
    if (Number.isFinite(salud) && salud > 0) {
        return salud;
    }

    return Math.max(Number(carta.Poder || 0), 0);
}

function inicializarSaludCarta(carta) {
    const saludMax = obtenerSaludMaxCarta(carta);
    return {
        ...carta,
        SaludMax: saludMax,
        Salud: saludMax
    };
}

function obtenerPoderCartaServidor(carta) {
    return Math.max(0, Number(carta?.Poder || 0));
}

function normalizarClaseSkillServidor(carta) {
    return String(carta?.skill_class || '').trim().toLowerCase();
}

function cartaCuentaComoActivaEnMesaServidor(carta) {
    if (!carta) return false;
    const salud = obtenerSaludCartaServidor(carta);
    const escudo = Math.max(0, Number(carta?.escudoActual || 0));
    return (salud + escudo) > 0;
}

function normalizarAfiliacionServidor(afiliacion) {
    return String(afiliacion || '').trim().toLowerCase();
}

function obtenerAfiliacionesCartaServidor(carta) {
    const raw = String(carta?.Afiliacion || carta?.afiliacion || '').trim();
    if (!raw) return [];
    return raw.split(';').map(x => x.trim()).filter(Boolean);
}

function parsearNumeroSeguroServidor(valor) {
    if (typeof valor === 'number' && Number.isFinite(valor)) {
        return valor;
    }
    const texto = String(valor ?? '').trim().replace(',', '.');
    if (!texto) return null;
    const num = Number(texto);
    return Number.isFinite(num) ? num : null;
}

function prepararFormulaSkillPowerParaEvaluacionServidor(formulaRaw, contexto = {}) {
    const formula = String(formulaRaw || '').trim().toLowerCase();
    if (!formula) return null;
    const formulaSegura = formula
        .replace(/saludenemigo/g, String(Number(contexto.saludEnemigo || 0)))
        .replace(/\bsalud\b/g, String(Number(contexto.salud || 0)))
        .replace(/\bpoder\b/g, String(Number(contexto.poder || 0)))
        .replace(/,/g, '.')
        .replace(/\s+/g, '');
    if (!formulaSegura || !/^[0-9+\-*/().]+$/.test(formulaSegura)) {
        return null;
    }
    let profundidad = 0;
    for (let i = 0; i < formulaSegura.length; i += 1) {
        const ch = formulaSegura[i];
        if (ch === '(') profundidad += 1;
        else if (ch === ')') {
            profundidad -= 1;
            if (profundidad < 0) return null;
        }
    }
    if (profundidad !== 0) return null;
    return formulaSegura;
}

function evaluarFormulaSkillPowerServidor(formulaRaw, contexto = {}) {
    const formulaSegura = prepararFormulaSkillPowerParaEvaluacionServidor(formulaRaw, contexto);
    if (!formulaSegura) return null;
    try {
        // eslint-disable-next-line no-new-func
        const resultado = Function(`"use strict"; return (${formulaSegura});`)();
        const numero = Number(resultado);
        return Number.isFinite(numero) ? numero : null;
    } catch (_error) {
        return null;
    }
}

function calcularBonusAfiliacionesServidor(cartas = []) {
    const conteoAfiliaciones = new Map();
    (Array.isArray(cartas) ? cartas : [])
        .filter(carta => Boolean(carta) && !Boolean(carta?.esBoss) && cartaCuentaComoActivaEnMesaServidor(carta))
        .forEach(carta => {
            const afiliaciones = new Set(
                obtenerAfiliacionesCartaServidor(carta).map(normalizarAfiliacionServidor).filter(Boolean)
            );
            afiliaciones.forEach(af => {
                conteoAfiliaciones.set(af, (conteoAfiliaciones.get(af) || 0) + 1);
            });
        });
    let principal = null;
    conteoAfiliaciones.forEach((cantidad, afiliacion) => {
        let bonus = 0;
        if (cantidad >= 3) bonus = 1000;
        else if (cantidad >= 2) bonus = 500;
        if (!bonus) return;
        if (!principal || bonus > principal.bonus || (bonus === principal.bonus && cantidad > principal.cantidad)) {
            principal = { afiliacion, bonus, cantidad };
        }
    });
    return principal;
}

const SKILL_CLASSES_ESCALABLES_SERVIDOR = new Set(['buff', 'debuff', 'heal', 'shield', 'heal_all', 'shield_aoe', 'bonus_buff']);

const SKILL_CLASSES_CONTEXTO_BASE_SERVIDOR = new Set(['buff', 'debuff', 'bonus_buff']);

const SKILL_CLASSES_CON_FORMULA_SERVIDOR = new Set([
    'buff', 'debuff', 'heal', 'shield', 'aoe', 'heal_all', 'shield_aoe', 'bonus_buff',
    'tank', 'extra_attack', 'dot', 'life_steal'
]);

function esSkillPowerFormulaServidor(raw) {
    const texto = String(raw ?? '').trim();
    if (!texto) return false;
    if (parsearNumeroSeguroServidor(texto) !== null) return false;
    return prepararFormulaSkillPowerParaEvaluacionServidor(texto, { poder: 100, salud: 100, saludEnemigo: 100 }) !== null;
}

function normalizarValorSkillPowerPorClaseServidor(clase, valor) {
    const n = Number(valor);
    if (!Number.isFinite(n)) return 0;
    const claseNorm = normalizarClaseSkillServidor({ skill_class: clase });
    switch (claseNorm) {
        case 'aoe':
        case 'extra_attack':
        case 'dot':
            return Math.max(1, Math.floor(n));
        case 'tank':
            return Math.max(0, Math.round(n));
        default:
            return Math.max(0, Math.floor(n));
    }
}

function obtenerSkillPowerFallbackPorClaseServidor(clase, contexto = {}, fallback = 0) {
    const claseNorm = normalizarClaseSkillServidor({ skill_class: clase });
    const poder = Math.max(0, Number(contexto.poder || 0));
    const salud = Math.max(0, Number(contexto.salud || 0));
    const saludEnemigo = Math.max(0, Number(contexto.saludEnemigo || 0));
    switch (claseNorm) {
        case 'aoe':
            return Math.max(1, Math.floor(poder / 2));
        case 'extra_attack':
            return Math.max(1, Math.floor(poder));
        case 'tank':
            return Math.max(0, Math.round(salud * 2));
        case 'heal_debuff':
            if (saludEnemigo > 0) return Math.max(1, Math.floor(saludEnemigo * 0.75));
            return Number(fallback || 0);
        default:
            return Number(fallback || 0);
    }
}

function obtenerSkillPowerEscaladoPorNivelServidor(carta) {
    if (!carta || typeof carta !== 'object') return null;
    const clase = normalizarClaseSkillServidor(carta);
    if (!SKILL_CLASSES_ESCALABLES_SERVIDOR.has(clase)) return null;
    const nivel = Math.max(1, Number(carta?.Nivel || 1));
    const basePersistida = parsearNumeroSeguroServidor(carta?.skill_power_base);
    const valorActual = parsearNumeroSeguroServidor(carta?.skill_power);
    let baseNivel1;
    if (basePersistida !== null) {
        baseNivel1 = Math.max(0, basePersistida);
    } else if (valorActual !== null) {
        baseNivel1 = Math.max(0, valorActual);
    } else {
        return null;
    }
    return Math.max(0, Math.round(baseNivel1 * nivel));
}

function obtenerContextoSkillPowerServidor(carta, contexto = {}) {
    const clase = normalizarClaseSkillServidor(carta);
    if (SKILL_CLASSES_CONTEXTO_BASE_SERVIDOR.has(clase)) {
        return {
            poder: Math.max(0, Number(obtenerPoderCartaServidor(carta))),
            salud: Math.max(0, Number(obtenerSaludMaxCarta(carta))),
            saludEnemigo: Math.max(0, Number(contexto?.saludEnemigo ?? 0))
        };
    }
    const poder = Math.max(0, Number(contexto?.poder ?? carta?.Poder ?? 0));
    const salud = Math.max(0, Number(contexto?.salud ?? carta?.Salud ?? carta?.SaludMax ?? poder));
    return {
        poder,
        salud,
        saludEnemigo: Math.max(0, Number(contexto?.saludEnemigo ?? 0))
    };
}

function obtenerValorSkillServidor(carta, fallback = 0, contexto = {}) {
    const clase = normalizarClaseSkillServidor(carta);
    const ctx = obtenerContextoSkillPowerServidor(carta, contexto);
    const bruto = carta?.skill_power;

    if (clase === 'revive') return 1;
    if (clase === 'bonus_debuff') return Number(fallback || 0);
    if (clase === 'heal_debuff') {
        if (esSkillPowerFormulaServidor(bruto)) {
            const v = evaluarFormulaSkillPowerServidor(bruto, ctx);
            if (v !== null) return normalizarValorSkillPowerPorClaseServidor(clase, v);
        }
        return normalizarValorSkillPowerPorClaseServidor(
            clase,
            obtenerSkillPowerFallbackPorClaseServidor(clase, ctx, fallback)
        );
    }

    if (SKILL_CLASSES_CON_FORMULA_SERVIDOR.has(clase) && esSkillPowerFormulaServidor(bruto)) {
        const formulaEvaluada = evaluarFormulaSkillPowerServidor(bruto, ctx);
        if (formulaEvaluada !== null) {
            return normalizarValorSkillPowerPorClaseServidor(clase, formulaEvaluada);
        }
    }

    const escaladoPorNivel = obtenerSkillPowerEscaladoPorNivelServidor(carta);
    if (escaladoPorNivel !== null) {
        return normalizarValorSkillPowerPorClaseServidor(clase, escaladoPorNivel);
    }

    const numeroDirecto = parsearNumeroSeguroServidor(bruto);
    if (numeroDirecto !== null) {
        return normalizarValorSkillPowerPorClaseServidor(clase, numeroDirecto);
    }

    if (SKILL_CLASSES_CON_FORMULA_SERVIDOR.has(clase) || clase === 'aoe' || clase === 'tank' || clase === 'extra_attack') {
        return normalizarValorSkillPowerPorClaseServidor(
            clase,
            obtenerSkillPowerFallbackPorClaseServidor(clase, ctx, fallback)
        );
    }

    return normalizarValorSkillPowerPorClaseServidor(clase, fallback);
}

function obtenerPoderCartaConBonosServidor(carta, mesaAliada = [], mesaEnemiga = []) {
    if (!carta) return 0;
    const poderBase = obtenerPoderCartaServidor(carta);
    const debuffGlobal = (Array.isArray(mesaEnemiga) ? mesaEnemiga : []).reduce((total, c) => {
        if (!c || !cartaCuentaComoActivaEnMesaServidor(c)) return total;
        const clase = normalizarClaseSkillServidor(c);
        const trigger = String(c?.skill_trigger || '').trim().toLowerCase();
        if (trigger === 'auto' && clase === 'debuff') {
            return total + Math.max(0, Number(obtenerValorSkillServidor(c, 0, { poder: obtenerPoderCartaServidor(c), salud: obtenerSaludCartaServidor(c) })));
        }
        return total;
    }, 0);
    const pasivaBuff = (Array.isArray(mesaAliada) ? mesaAliada : []).reduce((total, c) => {
        if (!c || !cartaCuentaComoActivaEnMesaServidor(c)) return total;
        const clase = normalizarClaseSkillServidor(c);
        const trigger = String(c?.skill_trigger || '').trim().toLowerCase();
        if (trigger === 'auto' && (clase === 'buff' || clase === 'bonus_buff')) {
            return total + Math.max(0, Number(obtenerValorSkillServidor(c, 0, { poder: obtenerPoderCartaServidor(c), salud: obtenerSaludCartaServidor(c) })));
        }
        return total;
    }, 0);
    const poderConPasivas = poderBase + pasivaBuff - debuffGlobal;
    if (Boolean(carta?.esBoss)) {
        return Math.max(0, poderConPasivas);
    }
    const principal = calcularBonusAfiliacionesServidor(mesaAliada);
    if (!principal?.afiliacion) {
        return Math.max(0, poderConPasivas);
    }
    const anulaBonus = (Array.isArray(mesaEnemiga) ? mesaEnemiga : []).some(c => {
        if (!c || !cartaCuentaComoActivaEnMesaServidor(c)) return false;
        const clase = normalizarClaseSkillServidor(c);
        const trigger = String(c?.skill_trigger || '').trim().toLowerCase();
        return trigger === 'auto' && clase === 'bonus_debuff';
    });
    const afiliacionesCarta = new Set(
        obtenerAfiliacionesCartaServidor(carta).map(normalizarAfiliacionServidor).filter(Boolean)
    );
    const recibeBonus = afiliacionesCarta.has(principal.afiliacion);
    const bonus = recibeBonus && !anulaBonus ? Number(principal.bonus || 0) : 0;
    return Math.max(0, poderConPasivas + bonus);
}

function obtenerSaludCartaServidor(carta) {
    if (!carta) return 0;
    const saludMax = obtenerSaludMaxCarta(carta);
    const salud = Number(carta?.Salud ?? carta?.salud);
    if (Number.isFinite(salud)) {
        return Math.max(0, Math.min(salud, saludMax));
    }
    return saludMax;
}

function sincronizarHealDebuffPvpSesion(sesion) {
    if (!sesion?.snapshotEstado) return;
    if (!sesion.healDebuffFactor) {
        sesion.healDebuffFactor = { A: 1, B: 1 };
    }
    const snap = sesion.snapshotEstado;
    ['A', 'B'].forEach((lado) => {
        const mesaAliada = lado === 'A' ? snap.cartasEnJuegoA : snap.cartasEnJuegoB;
        const mesaEnemiga = lado === 'A' ? snap.cartasEnJuegoB : snap.cartasEnJuegoA;
        const factorNuevo = DCHealDebuff.obtenerFactorHealDebuff(mesaEnemiga);
        const factorAnterior = sesion.healDebuffFactor[lado] ?? 1;
        if (factorAnterior !== factorNuevo) {
            DCHealDebuff.sincronizarCartasConFactor(mesaAliada, factorAnterior, factorNuevo);
            sesion.healDebuffFactor[lado] = factorNuevo;
        }
    });
}

function aplicarAtaqueCanonicoSnapshot(snapshot, ladoActor, slotAtacante, slotObjetivo) {
    const mesaActor = ladoActor === 'A' ? snapshot.cartasEnJuegoA : snapshot.cartasEnJuegoB;
    const mesaObjetivo = ladoActor === 'A' ? snapshot.cartasEnJuegoB : snapshot.cartasEnJuegoA;
    const cementerioObjetivo = ladoActor === 'A' ? snapshot.cementerioB : snapshot.cementerioA;
    const atacante = mesaActor?.[slotAtacante];
    const objetivo = mesaObjetivo?.[slotObjetivo];
    if (!atacante || !objetivo) {
        return { ok: false, reason: 'carta_invalida' };
    }
    const poderDanioAtacante = Math.max(1, Math.round(obtenerPoderCartaConBonosServidor(atacante, mesaActor, mesaObjetivo)));
    const claseSkill = String(atacante?.skill_class || '').trim().toLowerCase();
    const triggerSkill = String(atacante?.skill_trigger || '').trim().toLowerCase();
    const usaDotAuto = triggerSkill === 'auto' && claseSkill === 'dot';
    const usaLifeSteal = claseSkill === 'life_steal' && (triggerSkill === 'auto' || Boolean(atacante?.lifeStealActiva));
    const estadoAntes = DCHealDebuff.obtenerSaludEfectiva(objetivo, mesaActor);
    const saludAntesObjetivo = estadoAntes.totalActual;
    const { murio } = DCHealDebuff.aplicarDanio(objetivo, poderDanioAtacante, mesaActor);
    const danioInfligido = Math.max(0, Math.min(poderDanioAtacante, saludAntesObjetivo));
    if (usaDotAuto && danioInfligido > 0) {
        const danoDot = Math.max(1, Math.floor(obtenerValorSkillServidor(atacante, 1)));
        objetivo.efectosDot = Array.isArray(objetivo.efectosDot) ? objetivo.efectosDot : [];
        objetivo.efectosDot.push({
            danoPorTurno: danoDot,
            turnosRestantes: 3,
            skillName: String(atacante?.skill_name || '').trim()
        });
    }
    if (murio) {
        if (Array.isArray(cementerioObjetivo)) {
            cementerioObjetivo.push({
                ...objetivo,
                Salud: obtenerSaludMaxCarta(objetivo),
                escudoActual: 0,
                habilidadCooldownRestante: 0,
                habilidadUsadaPartida: false,
                tankActiva: false,
                stunRestante: 0,
                stunSkillName: '',
                efectosDot: []
            });
        }
        mesaObjetivo[slotObjetivo] = null;
    }
    if (usaLifeSteal && danioInfligido > 0) {
        const robo = Math.max(1, Math.floor(obtenerValorSkillServidor(atacante, 1)));
        const saludAtacante = obtenerSaludCartaServidor(atacante);
        atacante.Salud = DCHealDebuff.capCuracion(atacante, saludAtacante + robo, mesaObjetivo);
    }
    return { ok: true };
}

function aplicarHabilidadCanonicaSnapshot(snapshot, ladoActor, slotAtacante, slotObjetivo = null, indiceCementerio = null) {
    const mesaActor = ladoActor === 'A' ? snapshot.cartasEnJuegoA : snapshot.cartasEnJuegoB;
    const mesaObjetivo = ladoActor === 'A' ? snapshot.cartasEnJuegoB : snapshot.cartasEnJuegoA;
    const mazoActor = ladoActor === 'A' ? snapshot.mazoA : snapshot.mazoB;
    const cementerioActor = ladoActor === 'A' ? snapshot.cementerioA : snapshot.cementerioB;
    const cementerioObjetivo = ladoActor === 'A' ? snapshot.cementerioB : snapshot.cementerioA;
    const atacante = mesaActor?.[slotAtacante];
    if (!atacante) {
        return { ok: false, reason: 'carta_invalida' };
    }
    const cooldownActual = Math.max(0, Number(atacante.habilidadCooldownRestante || 0));
    if (cooldownActual > 0) {
        return { ok: false, reason: 'cooldown_activo' };
    }
    if (Math.max(0, Number(atacante.stunRestante || 0)) > 0) {
        return { ok: false, reason: 'aturdida' };
    }
    const clase = String(atacante?.skill_class || '').trim().toLowerCase();
    const poderBaseAtacante = Math.max(0, Number(obtenerPoderCartaServidor(atacante)));
    const poderConBonosAtacante = Math.max(0, Math.round(obtenerPoderCartaConBonosServidor(atacante, mesaActor, mesaObjetivo)));
    const valorSkill = Math.max(0, Number(obtenerValorSkillServidor(atacante, 0, {
        poder: poderConBonosAtacante,
        salud: obtenerSaludCartaServidor(atacante)
    })));
    if (clase === 'tank') {
        const yaHayTank = (Array.isArray(mesaActor) ? mesaActor : []).some((carta, idx) => idx !== slotAtacante && Boolean(carta?.tankActiva));
        if (yaHayTank) return { ok: false, reason: 'tank_ya_activo' };
        atacante.tankActiva = true;
        atacante.habilidadUsadaPartida = true;
        const saludMaxAnterior = obtenerSaludMaxCarta(atacante);
        atacante.SaludMax = Math.max(1, saludMaxAnterior * 2);
        atacante.Salud = Math.min(atacante.SaludMax, obtenerSaludCartaServidor(atacante) + saludMaxAnterior);
    } else if (clase === 'heal_all') {
        if (valorSkill <= 0) return { ok: false, reason: 'valor_invalido' };
        let huboCuracion = false;
        (Array.isArray(mesaActor) ? mesaActor : []).forEach(carta => {
            if (!carta) return;
            const saludAntes = obtenerSaludCartaServidor(carta);
            carta.Salud = DCHealDebuff.capCuracion(carta, saludAntes + Math.floor(valorSkill), mesaObjetivo);
            if (carta.Salud > saludAntes) {
                huboCuracion = true;
            }
        });
        if (!huboCuracion) return { ok: false, reason: 'equipo_full_health' };
    } else if (clase === 'shield_aoe') {
        if (valorSkill <= 0) return { ok: false, reason: 'valor_invalido' };
        const indicesAliados = obtenerIndicesCartasVivasServidor(mesaActor);
        if (indicesAliados.length === 0) return { ok: false, reason: 'objetivo_invalido' };
        const escCantidad = Math.floor(valorSkill);
        indicesAliados.forEach((idx) => {
            if (!mesaActor[idx]) return;
            mesaActor[idx].escudoActual = Math.max(0, Number(mesaActor[idx].escudoActual || 0)) + escCantidad;
        });
    } else if (clase === 'life_steal') {
        atacante.lifeStealActiva = true;
    } else if (clase === 'heal') {
        if (valorSkill <= 0) return { ok: false, reason: 'valor_invalido' };
        const idxObjetivoSeleccionado = Number.isInteger(slotObjetivo) ? slotObjetivo : null;
        const idxObjetivo = idxObjetivoSeleccionado !== null
            ? idxObjetivoSeleccionado
            : obtenerIndicesCartasVivasServidor(mesaActor)
                .sort((a, b) => obtenerSaludCartaServidor(mesaActor[a]) - obtenerSaludCartaServidor(mesaActor[b]))[0];
        if (!Number.isInteger(idxObjetivo)) return { ok: false, reason: 'objetivo_invalido' };
        if (!mesaActor[idxObjetivo]) return { ok: false, reason: 'objetivo_invalido' };
        const objetivoHeal = mesaActor[idxObjetivo];
        const saludAntes = obtenerSaludCartaServidor(objetivoHeal);
        objetivoHeal.Salud = DCHealDebuff.capCuracion(objetivoHeal, saludAntes + Math.floor(valorSkill), mesaObjetivo);
    } else if (clase === 'shield') {
        if (valorSkill <= 0) return { ok: false, reason: 'valor_invalido' };
        const idxObjetivoSeleccionado = Number.isInteger(slotObjetivo) ? slotObjetivo : null;
        const idxObjetivo = idxObjetivoSeleccionado !== null
            ? idxObjetivoSeleccionado
            : obtenerIndicesCartasVivasServidor(mesaActor)
                .sort((a, b) => obtenerSaludCartaServidor(mesaActor[a]) - obtenerSaludCartaServidor(mesaActor[b]))[0];
        if (!Number.isInteger(idxObjetivo)) return { ok: false, reason: 'objetivo_invalido' };
        if (!mesaActor[idxObjetivo]) return { ok: false, reason: 'objetivo_invalido' };
        mesaActor[idxObjetivo].escudoActual = Math.max(0, Number(mesaActor[idxObjetivo].escudoActual || 0)) + Math.floor(valorSkill);
    } else if (clase === 'aoe') {
        const objetivosVivos = obtenerIndicesCartasVivasServidor(mesaObjetivo);
        const tankIdx = obtenerIndiceTankActivoServidor(mesaObjetivo);
        // Con tanque activo, el daño AOE se concentra en el tanque pero solo una vez por uso
        // (antes se repetía un golpe por cada carta viva en mesa, demasiado fuerte).
        const objetivos = Number.isInteger(tankIdx) && objetivosVivos.length > 0
            ? [tankIdx]
            : objetivosVivos;
        if (objetivos.length === 0) return { ok: false, reason: 'objetivo_invalido' };
        const poderFuente = Math.max(1, poderConBonosAtacante);
        const danioAoe = Math.max(1, Math.floor(valorSkill > 0 ? valorSkill : poderFuente / 2));
        for (let i = 0; i < objetivos.length; i++) {
            const idx = objetivos[i];
            const objetivoAoe = mesaObjetivo[idx];
            if (!objetivoAoe) continue;
            const { murio: murioAoe } = DCHealDebuff.aplicarDanio(objetivoAoe, danioAoe, mesaActor);
            if (murioAoe) {
                if (Array.isArray(cementerioObjetivo)) {
                    cementerioObjetivo.push({
                        ...objetivoAoe,
                        Salud: obtenerSaludMaxCarta(objetivoAoe),
                        escudoActual: 0,
                        habilidadCooldownRestante: 0,
                        habilidadUsadaPartida: false,
                        tankActiva: false,
                        stunRestante: 0,
                        stunSkillName: '',
                        efectosDot: []
                    });
                }
                mesaObjetivo[idx] = null;
            }
        }
    } else if (clase === 'revive') {
        if (!Array.isArray(cementerioActor) || !Array.isArray(mazoActor) || cementerioActor.length === 0) {
            return { ok: false, reason: 'cementerio_vacio' };
        }
        let idxRevive = null;
        if (Number.isInteger(indiceCementerio) && indiceCementerio >= 0 && indiceCementerio < cementerioActor.length) {
            idxRevive = indiceCementerio;
        } else {
            idxRevive = 0;
            for (let i = 1; i < cementerioActor.length; i++) {
                const actual = Number(cementerioActor[i]?.Poder || 0);
                const mejor = Number(cementerioActor[idxRevive]?.Poder || 0);
                if (actual > mejor) idxRevive = i;
            }
        }
        const cartaRevive = cementerioActor.splice(idxRevive, 1)[0];
        if (!cartaRevive) return { ok: false, reason: 'cementerio_vacio' };
        mazoActor.push({
            ...cartaRevive,
            Salud: obtenerSaludMaxCarta(cartaRevive),
            escudoActual: 0,
            habilidadCooldownRestante: 0,
            habilidadUsadaPartida: false,
            tankActiva: false,
            stunRestante: 0,
            stunSkillName: '',
            efectosDot: []
        });
    } else if (clase === 'extra_attack') {
        const keyAccionesExtra = ladoActor === 'A' ? 'accionesExtraA' : 'accionesExtraB';
        snapshot[keyAccionesExtra] = Math.max(0, Number(snapshot[keyAccionesExtra] || 0)) + 1;
    } else if (clase === 'stun') {
        const turnosStun = Math.max(1, Math.floor(valorSkill || 1));
        const tankIdx = obtenerIndiceTankActivoServidor(mesaObjetivo);
        let idx = Number.isInteger(slotObjetivo) ? slotObjetivo : null;
        if (tankIdx !== null) idx = tankIdx;
        if (!Number.isInteger(idx)) {
            const candidatos = obtenerIndicesCartasVivasServidor(mesaObjetivo).filter(i => !Boolean(mesaObjetivo[i]?.esBoss));
            idx = candidatos.length > 0 ? candidatos[0] : null;
        }
        if (!Number.isInteger(idx) || idx < 0 || idx > 2 || !mesaObjetivo[idx]) return { ok: false, reason: 'objetivo_invalido' };
        if (Boolean(mesaObjetivo[idx]?.esBoss)) return { ok: false, reason: 'boss_inmune' };
        const stunPrevio = Math.max(0, Number(mesaObjetivo[idx].stunRestante || 0));
        mesaObjetivo[idx].stunRestante = Math.max(stunPrevio, turnosStun);
        if (turnosStun >= stunPrevio) {
            mesaObjetivo[idx].stunSkillName = String(atacante?.skill_name || '').trim();
        }
    } else if (clase === 'dot') {
        const tankIdx = obtenerIndiceTankActivoServidor(mesaObjetivo);
        let idx = Number.isInteger(slotObjetivo) ? slotObjetivo : null;
        if (tankIdx !== null) idx = tankIdx;
        if (!Number.isInteger(idx)) {
            const candidatos = obtenerIndicesCartasVivasServidor(mesaObjetivo);
            idx = candidatos.length > 0 ? candidatos[0] : null;
        }
        if (!Number.isInteger(idx) || idx < 0 || idx > 2 || !mesaObjetivo[idx]) return { ok: false, reason: 'objetivo_invalido' };
        const danoDot = Math.max(1, Math.floor(valorSkill || 1));
        mesaObjetivo[idx].efectosDot = Array.isArray(mesaObjetivo[idx].efectosDot) ? mesaObjetivo[idx].efectosDot : [];
        mesaObjetivo[idx].efectosDot.push({
            danoPorTurno: danoDot,
            turnosRestantes: 3,
            skillName: String(atacante?.skill_name || '').trim()
        });
    }
    atacante.habilidadCooldownRestante = 2;
    return { ok: true };
}

function rellenarUnSlotSiMesaVaciaServidor(snapshot, lado) {
    const mazo = lado === 'A' ? snapshot?.mazoA : snapshot?.mazoB;
    const mesa = lado === 'A' ? snapshot?.cartasEnJuegoA : snapshot?.cartasEnJuegoB;
    if (!Array.isArray(mazo) || !Array.isArray(mesa) || mazo.length <= 0) return;
    const vivas = obtenerIndicesCartasVivasServidor(mesa).length;
    if (vivas > 0) return;
    for (let i = 0; i < mesa.length; i++) {
        if (!mesa[i] && mazo.length > 0) {
            mesa[i] = inicializarSaludCarta(mazo.shift());
        }
    }
}

function tieneAtaquePendienteServidor(snapshot, ladoActor) {
    const mesa = ladoActor === 'A' ? snapshot?.cartasEnJuegoA : snapshot?.cartasEnJuegoB;
    const keyActuaron = ladoActor === 'A' ? 'cartasYaActuaronA' : 'cartasYaActuaronB';
    const actuaron = Array.isArray(snapshot?.[keyActuaron]) ? snapshot[keyActuaron] : [];
    if (!Array.isArray(mesa)) return false;
    return mesa.some((carta, idx) => {
        if (!carta) return false;
        if (actuaron.includes(idx)) return false;
        const stun = Math.max(0, Number(carta.stunRestante || 0));
        return stun <= 0;
    });
}

function obtenerIndicesCartasVivasServidor(cartas = []) {
    return (Array.isArray(cartas) ? cartas : []).reduce((acc, carta, index) => {
        if (carta) acc.push(index);
        return acc;
    }, []);
}

function obtenerIndiceTankActivoServidor(cartas = []) {
    const indices = obtenerIndicesCartasVivasServidor(cartas);
    for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        if (Boolean(cartas[idx]?.tankActiva)) {
            return idx;
        }
    }
    return null;
}

function reducirCooldownHabilidadesServidor(cartas = []) {
    (Array.isArray(cartas) ? cartas : []).forEach(carta => {
        if (!carta) return;
        const cd = Math.max(0, Number(carta.habilidadCooldownRestante || 0));
        carta.habilidadCooldownRestante = Math.max(0, cd - 1);
    });
}

function consumirStunFinTurnoServidor(cartas = []) {
    (Array.isArray(cartas) ? cartas : []).forEach(carta => {
        if (!carta) return;
        const stun = Math.max(0, Number(carta.stunRestante || 0));
        if (stun > 0) {
            carta.stunRestante = Math.max(0, stun - 1);
            if (carta.stunRestante === 0) {
                carta.stunSkillName = '';
            }
        }
    });
}

function aplicarDotInicioTurnoServidor(cartas = [], cartasEnemigas = []) {
    (Array.isArray(cartas) ? cartas : []).forEach((carta, index, arr) => {
        if (!carta) return;
        const dots = Array.isArray(carta.efectosDot) ? carta.efectosDot : [];
        if (dots.length === 0) {
            carta.efectosDot = [];
            return;
        }
        dots.forEach(dot => {
            const dano = Math.max(0, Math.floor(Number(dot?.danoPorTurno || 0)));
            if (dano > 0) {
                DCHealDebuff.aplicarDanio(carta, dano, cartasEnemigas);
            }
        });
        carta.efectosDot = dots
            .map(dot => ({
                danoPorTurno: Math.max(0, Math.floor(Number(dot?.danoPorTurno || 0))),
                turnosRestantes: Math.max(0, Math.floor(Number(dot?.turnosRestantes || 0)) - 1),
                skillName: String(dot?.skillName || '').trim()
            }))
            .filter(dot => dot.turnosRestantes > 0 && dot.danoPorTurno > 0);
        const escudo = Math.max(0, Number(carta.escudoActual || 0));
        const salud = obtenerSaludCartaServidor(carta);
        if ((salud + escudo) <= 0) {
            arr[index] = null;
        }
    });
}

function aplicarDotInicioTurnoServidorConCementerio(cartas = [], cementerio = [], cartasEnemigas = []) {
    (Array.isArray(cartas) ? cartas : []).forEach((carta, index, arr) => {
        if (!carta) return;
        const dots = Array.isArray(carta.efectosDot) ? carta.efectosDot : [];
        if (dots.length === 0) {
            carta.efectosDot = [];
            return;
        }
        dots.forEach(dot => {
            const dano = Math.max(0, Math.floor(Number(dot?.danoPorTurno || 0)));
            if (dano > 0) {
                DCHealDebuff.aplicarDanio(carta, dano, cartasEnemigas);
            }
        });
        carta.efectosDot = dots
            .map(dot => ({
                danoPorTurno: Math.max(0, Math.floor(Number(dot?.danoPorTurno || 0))),
                turnosRestantes: Math.max(0, Math.floor(Number(dot?.turnosRestantes || 0)) - 1),
                skillName: String(dot?.skillName || '').trim()
            }))
            .filter(dot => dot.turnosRestantes > 0 && dot.danoPorTurno > 0);
        const escudo = Math.max(0, Number(carta.escudoActual || 0));
        const salud = obtenerSaludCartaServidor(carta);
        if ((salud + escudo) <= 0) {
            if (Array.isArray(cementerio)) {
                cementerio.push({
                    ...carta,
                    Salud: obtenerSaludMaxCarta(carta),
                    escudoActual: 0,
                    habilidadCooldownRestante: 0,
                    habilidadUsadaPartida: false,
                    tankActiva: false,
                    stunRestante: 0,
                    stunSkillName: '',
                    efectosDot: []
                });
            }
            arr[index] = null;
        }
    });
}

function rellenarSlotsDesdeMazoServidor(snapshot, lado) {
    const mazo = lado === 'A' ? snapshot.mazoA : snapshot.mazoB;
    const mesa = lado === 'A' ? snapshot.cartasEnJuegoA : snapshot.cartasEnJuegoB;
    if (!Array.isArray(mazo) || !Array.isArray(mesa)) return;
    for (let i = 0; i < mesa.length; i++) {
        if (!mesa[i] && mazo.length > 0) {
            mesa[i] = inicializarSaludCarta(mazo.shift());
        }
    }
}

function obtenerGanadorPorEstadoSnapshot(sesion, snapshot) {
    const vivasA = obtenerIndicesCartasVivasServidor(snapshot?.cartasEnJuegoA).length;
    const vivasB = obtenerIndicesCartasVivasServidor(snapshot?.cartasEnJuegoB).length;
    const mazoA = Array.isArray(snapshot?.mazoA) ? snapshot.mazoA.length : 0;
    const mazoB = Array.isArray(snapshot?.mazoB) ? snapshot.mazoB.length : 0;
    if (vivasA === 0 && mazoA === 0) return sesion?.emailB || null;
    if (vivasB === 0 && mazoB === 0) return sesion?.emailA || null;
    return null;
}
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

function obtenerRoomSesionCoop(sessionId) {
    return `coop:${String(sessionId || '').trim()}`;
}

function obtenerCatalogoCartasServidorCoop() {
    if (catalogoCartasServidorCache) {
        return catalogoCartasServidorCache;
    }
    try {
        const workbook = XLSX.readFile(path.join(__dirname, 'public/resources/cartas.xlsx'));
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        catalogoCartasServidorCache = filas;
        return filas;
    } catch (error) {
        console.error('Coop: error leyendo cartas.xlsx:', error.message);
        catalogoCartasServidorCache = [];
        return catalogoCartasServidorCache;
    }
}

function mapaCatalogoPorNombreCoop() {
    const catalogo = obtenerCatalogoCartasServidorCoop();
    const mapa = new Map();
    (Array.isArray(catalogo) ? catalogo : []).forEach(carta => {
        const clave = normalizarTexto(String(carta?.Nombre || ''));
        if (clave && !mapa.has(clave)) {
            mapa.set(clave, carta);
        }
    });
    return mapa;
}

function obtenerFilasEventosOnlineServidor() {
    if (filasEventosOnlineCache) {
        return filasEventosOnlineCache;
    }
    try {
        const workbook = XLSX.readFile(path.join(__dirname, 'public/resources/eventos_online.xlsx'));
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        filasEventosOnlineCache = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        return filasEventosOnlineCache;
    } catch (error) {
        console.error('Coop: error leyendo eventos_online.xlsx:', error.message);
        filasEventosOnlineCache = [];
        return filasEventosOnlineCache;
    }
}

function buscarFilaEventoOnlinePorId(idBuscado) {
    const filas = obtenerFilasEventosOnlineServidor();
    const idNum = Number(idBuscado);
    return filas.find(f => Number(f?.ID_evento_online ?? f?.id ?? -1) === idNum) || null;
}

function mezclarArrayServidor(arr) {
    const a = Array.isArray(arr) ? [...arr] : [];
    for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function escalarCartaEnemigoCoopServidor(cartaBase, dificultad) {
    const d = Math.min(6, Math.max(1, Number(dificultad) || 1));
    const nivelBase = Number(cartaBase?.Nivel || 1);
    const incrementoNiveles = Math.max(d - nivelBase, 0);
    const saludBase = obtenerSaludMaxCarta(cartaBase);
    const saludEscalada = saludBase + (incrementoNiveles * 500);
    const poderNum = Number(cartaBase?.Poder || 0);
    return inicializarSaludCarta({
        ...cartaBase,
        Nivel: d,
        Poder: poderNum + (incrementoNiveles * 500),
        SaludMax: saludEscalada,
        Salud: saludEscalada
    });
}

/** Misma fórmula que `escalarBossSegunDificultad` en partida.js (desafíos / eventos). */
function escalarBossSegunDificultadServidor(carta, dificultad) {
    const cartaBoss = { ...carta };
    const nivelBase = Number(cartaBoss.Nivel || 1);
    const dificultadObjetivo = Math.min(Math.max(Number(dificultad) || 1, 1), 6);
    const incrementoNiveles = Math.max(dificultadObjetivo - nivelBase, 0);
    const incrementoPorNivel = incrementoNiveles * 500;
    const saludBase = obtenerSaludMaxCarta(cartaBoss);
    const poderBase = Number(cartaBoss.Poder || 0);

    cartaBoss.Nivel = dificultadObjetivo;
    cartaBoss.Poder = Math.round(poderBase + incrementoPorNivel);
    const saludBossActual = Math.round((saludBase * 8) + incrementoPorNivel);
    cartaBoss.SaludMax = Math.round(saludBossActual * 1.75);
    cartaBoss.Salud = cartaBoss.SaludMax;
    cartaBoss.esBoss = true;
    return inicializarSaludCarta(cartaBoss);
}

/**
 * Enemigos normales van al mazo mezclado; el BOSS queda aparte y entra al tablero cuando caen todos
 * los rivales normales (como en desafíos: grupos y luego BOSS).
 */
function construirMazoBotCoopDesdeEvento(filaEvento, mapaCatalogo, dificultad) {
    const nombresNormales = [];
    for (let i = 1; i <= 8; i += 1) {
        const nombre = String(filaEvento[`enemigo${i}`] || '').trim();
        if (nombre) {
            nombresNormales.push(nombre);
        }
    }
    const cartasNormales = nombresNormales.map(nombre => {
        const base = DCSkinsCartas.resolverFilaCatalogoConSkinServidor(nombre, mapaCatalogo, path, __dirname) || {
            Nombre: DCSkinsCartas.obtenerNombreCatalogoDesdeReferencia(nombre) || nombre,
            Nivel: 1,
            Poder: 500,
            Salud: 500,
            SaludMax: 500
        };
        return escalarCartaEnemigoCoopServidor({ ...base }, dificultad);
    });

    let bossCarta = null;
    const bossNombre = String(filaEvento?.boss ?? filaEvento?.Boss ?? filaEvento?.BOSS ?? '').trim();
    if (bossNombre) {
        const baseBoss = DCSkinsCartas.resolverFilaCatalogoConSkinServidor(bossNombre, mapaCatalogo, path, __dirname) || {
            Nombre: DCSkinsCartas.obtenerNombreCatalogoDesdeReferencia(bossNombre) || bossNombre,
            Nivel: 1,
            Poder: 500,
            Salud: 500,
            SaludMax: 500
        };
        bossCarta = escalarBossSegunDificultadServidor({ ...baseBoss }, dificultad);
    }

    return { cartasNormales, bossCarta };
}

async function extraerCartasUsuarioPorIndicesCoop(email, indicesRaw) {
    const datos = await obtenerUsuarioPersistidoPorEmail(email);
    const cartasUsuario = Array.isArray(datos?.cartas) ? datos.cartas : [];
    const indices = Array.isArray(indicesRaw) ? indicesRaw.map(n => Number(n)) : [];
    if (indices.length !== 6) {
        return null;
    }
    const usados = new Set();
    const salida = [];
    for (const ix of indices) {
        if (!Number.isInteger(ix) || ix < 0 || ix >= cartasUsuario.length || usados.has(ix)) {
            return null;
        }
        usados.add(ix);
        salida.push(JSON.parse(JSON.stringify(cartasUsuario[ix])));
    }
    return salida;
}

function enriquecerCartasConCatalogoCoop(cartas, mapaCatalogo) {
    return (Array.isArray(cartas) ? cartas : []).map(carta => {
        const datos = mapaCatalogo.get(normalizarTexto(carta?.Nombre || ''));
        if (!datos) {
            return carta;
        }
        return {
            ...carta,
            faccion: carta.faccion || datos.faccion || datos.Faccion || '',
            Afiliacion: carta.Afiliacion || datos.Afiliacion || '',
            skill_name: String(carta.skill_name || '').trim() || String(datos.skill_name || '').trim(),
            skill_info: String(carta.skill_info || '').trim() || String(datos.skill_info || '').trim(),
            skill_class: String(carta.skill_class || '').trim().toLowerCase() || String(datos.skill_class || '').trim().toLowerCase(),
            skill_power: carta.skill_power ?? datos.skill_power ?? '',
            skill_power_base: carta.skill_power_base ?? datos.skill_power ?? '',
            skill_trigger: String(carta.skill_trigger || '').trim().toLowerCase() || String(datos.skill_trigger || '').trim().toLowerCase()
        };
    });
}

function construirSnapshotInicialCoopServidor({
    mazoBotCompleto,
    bossPendienteCoop,
    cartasA,
    cartasB
}) {
    const poderJug = calcularPoderTotalMazo(cartasA) + calcularPoderTotalMazo(cartasB);
    const mazoParaTotalBot = [...(Array.isArray(mazoBotCompleto) ? mazoBotCompleto : [])];
    if (bossPendienteCoop && typeof bossPendienteCoop === 'object') {
        mazoParaTotalBot.push(bossPendienteCoop);
    }
    const poderBot = calcularPoderTotalMazo(mazoParaTotalBot);
    const iniciativaJugadores = poderJug > poderBot;

    const mazoBot = mezclarArrayServidor([...mazoBotCompleto]);
    const cartasEnJuegoBot = [];
    for (let i = 0; i < 4; i += 1) {
        cartasEnJuegoBot.push(mazoBot.length > 0 ? inicializarSaludCarta(mazoBot.shift()) : null);
    }

    let mazoACopia = mezclarArrayServidor([...cartasA]);
    const cartasEnJuegoA = [
        mazoACopia.length > 0 ? inicializarSaludCarta(mazoACopia.shift()) : null,
        mazoACopia.length > 0 ? inicializarSaludCarta(mazoACopia.shift()) : null
    ];

    let mazoBCopia = mezclarArrayServidor([...cartasB]);
    const cartasEnJuegoB = [
        mazoBCopia.length > 0 ? inicializarSaludCarta(mazoBCopia.shift()) : null,
        mazoBCopia.length > 0 ? inicializarSaludCarta(mazoBCopia.shift()) : null
    ];

    const faseCoop = iniciativaJugadores ? 'P1' : 'BOT';

    return {
        revision: 0,
        faseCoop,
        iniciativaJugadores,
        cartasEnJuegoBot,
        cartasEnJuegoA,
        cartasEnJuegoB,
        mazoBot,
        mazoA: mazoACopia,
        mazoB: mazoBCopia,
        cementerioBot: [],
        cementerioA: [],
        cementerioB: [],
        cartasYaAtacaronA: [],
        cartasYaAtacaronB: [],
        cartasYaAtacaronBot: [],
        accionesExtraA: 0,
        accionesExtraB: 0,
        accionesExtraBot: 0,
        bossPendienteCoop: bossPendienteCoop && typeof bossPendienteCoop === 'object'
            ? JSON.parse(JSON.stringify(bossPendienteCoop))
            : null
    };
}

async function iniciarSesionCoopEventoDesdePrep(prep) {
    /**
     * Validaciones pre-carga: cualquier `return { ok: false }` aquí se notifica
     * al cliente como `grupo:notificacion` (handler `coop:evento:preparacion:listo`),
     * pero antes de eso conviene loguear con el contexto del evento + prep para
     * diagnosticar por qué algunos eventos del XLSX no llegan a iniciar.
     */
    const fila = buscarFilaEventoOnlinePorId(prep.eventoId);
    if (!fila) {
        console.error(`[coop] iniciarSesionCoopEventoDesdePrep: evento eventoId=${prep.eventoId} no encontrado en eventos_online.xlsx`);
        return { ok: false, mensaje: `Evento ${prep.eventoId} no encontrado en eventos_online.xlsx.` };
    }
    const mapaCatalogo = mapaCatalogoPorNombreCoop();
    if (!mapaCatalogo || mapaCatalogo.size === 0) {
        console.error('[coop] iniciarSesionCoopEventoDesdePrep: catálogo de cartas vacío (cartas.xlsx no se cargó)');
        return { ok: false, mensaje: 'No se pudo cargar el catálogo de cartas en el servidor.' };
    }
    const dificultad = Math.min(6, Math.max(1, Number(prep.dificultad) || 1));
    const { cartasNormales, bossCarta } = construirMazoBotCoopDesdeEvento(fila, mapaCatalogo, dificultad);
    /**
     * EVENTO_COOPERATIVO_ONLINE_ESPEC.md: el BOT necesita 4 cartas en mesa al
     * iniciar la partida + un BOSS pendiente. Validamos que la suma cubra esos
     * 4 huecos: si el evento aporta <4 enemigos pero tiene BOSS, el BOSS pasa
     * al mazo principal para llenar la mesa (el boss "real" sigue en
     * `bossPendienteCoop` solo si hay >=4 normales).
     */
    let mazoBotFinal = cartasNormales.slice();
    let bossFinal = bossCarta;
    if (mazoBotFinal.length < 4 && bossFinal) {
        console.warn(`[coop] evento ID=${prep.eventoId} '${fila.nombre}' solo tiene ${mazoBotFinal.length} enemigos normales; usando BOSS '${String(fila.boss || '').trim()}' como carta de mesa para alcanzar 4 slots.`);
        mazoBotFinal.push(bossFinal);
        bossFinal = null;
    }
    if (mazoBotFinal.length < 4) {
        const total = mazoBotFinal.length + (bossCarta ? 1 : 0);
        console.error(`[coop] evento ID=${prep.eventoId} '${fila.nombre}' rechazado: ${mazoBotFinal.length} enemigos normales + ${bossCarta ? 1 : 0} boss = ${total} (mínimo 4).`);
        return { ok: false, mensaje: `El evento "${fila.nombre || prep.eventoId}" no tiene suficientes enemigos (mínimo 4 entre enemigos y boss).` };
    }

    let cartasA = Array.isArray(prep.cartasA) ? prep.cartasA : null;
    let cartasB = Array.isArray(prep.cartasB) ? prep.cartasB : null;
    if (!cartasA || cartasA.length === 0 || !cartasB || cartasB.length === 0) {
        console.error(`[coop] iniciarSesionCoopEventoDesdePrep: cartasA=${cartasA?.length} cartasB=${cartasB?.length} (deben ser 6 cada uno)`);
        return { ok: false, mensaje: 'Faltan las cartas seleccionadas por uno de los jugadores.' };
    }
    cartasA = enriquecerCartasConCatalogoCoop(cartasA, mapaCatalogo);
    cartasB = enriquecerCartasConCatalogoCoop(cartasB, mapaCatalogo);

    let snapshotInicial;
    try {
        snapshotInicial = construirSnapshotInicialCoopServidor({
            mazoBotCompleto: mazoBotFinal,
            bossPendienteCoop: bossFinal,
            cartasA,
            cartasB
        });
    } catch (errSnap) {
        console.error('[coop] iniciarSesionCoopEventoDesdePrep: error construyendo snapshot inicial', errSnap);
        return { ok: false, mensaje: 'Error interno al construir el estado inicial de la partida.' };
    }

    const sessionId = `coop_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const emailLeader = prep.inviterEmail;
    const emailMember = prep.inviteeEmail;

    const userLead = obtenerUsuarioConectadoPorEmail(emailLeader);
    const userMem = obtenerUsuarioConectadoPorEmail(emailMember);
    if (!userLead?.id || !userMem?.id) {
        console.error(`[coop] iniciarSesionCoopEventoDesdePrep: jugadores desconectados (lead=${Boolean(userLead?.id)} mem=${Boolean(userMem?.id)})`);
        return { ok: false, mensaje: 'Uno de los jugadores se ha desconectado antes de iniciar la partida.' };
    }

    sesionesCoopEventoActivas.set(sessionId, {
        sessionId,
        partyId: prep.partyId,
        emailLeader,
        emailMember,
        eventoId: prep.eventoId,
        dificultad,
        snapshotEstado: snapshotInicial,
        revisionEstado: 0,
        finalizada: false,
        resultado: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ejecutorBotEmail: emailLeader
    });

    const nombreEvento = String(prep.eventoNombre || fila.nombre || 'Evento cooperativo').trim();
    /**
     * Lista de enemigos normales y BOSS del evento, para que el cliente pueda sortear
     * la carta de recompensa (80% un enemigo aleatorio, 20% el BOSS) sin tener que volver
     * a parsear `eventos_online.xlsx`.
     */
    const nombresEnemigosEvento = [];
    for (let i = 1; i <= 8; i += 1) {
        const n = String(fila[`enemigo${i}`] || '').trim();
        if (n) nombresEnemigosEvento.push(n);
    }
    const nombreBossEvento = String(fila.boss ?? fila.Boss ?? fila.BOSS ?? '').trim() || null;
    const payloadBase = {
        sessionId,
        partyId: prep.partyId,
        modo: 'coop_evento_online',
        evento: {
            id: Number(fila.ID_evento_online ?? prep.eventoId),
            nombre: nombreEvento,
            descripcion: String(fila.Descripción || fila.descripcion || '').trim(),
            puntos: Number(fila.puntos || 0),
            mejora: Number(fila.mejora || 0),
            mejora_especial: Number(fila.mejora_especial || 0),
            cartaRecompensa: String(fila.cartas || fila.carta || '').trim(),
            enemigos: nombresEnemigosEvento,
            boss: nombreBossEvento,
            dificultad,
            tablero: String(fila.tablero ?? fila.Tablero ?? '').trim()
        },
        snapshot: snapshotInicial,
        revision: 0,
        emailLeader,
        emailMember,
        ejecutorBotEmail: emailLeader,
        jugadorA: {
            email: emailLeader,
            nombre: userLead?.nombre || emailLeader.split('@')[0],
            avatar: userLead?.avatar || ''
        },
        jugadorB: {
            email: emailMember,
            nombre: userMem?.nombre || emailMember.split('@')[0],
            avatar: userMem?.avatar || ''
        }
    };

    const payloadA = {
        ...payloadBase,
        rolCoop: 'A'
    };
    const payloadB = {
        ...payloadBase,
        rolCoop: 'B'
    };

    if (userLead?.id) {
        io.to(userLead.id).emit('multiplayer:coop:session:start', payloadA);
    }
    if (userMem?.id) {
        io.to(userMem.id).emit('multiplayer:coop:session:start', payloadB);
    }

    return { ok: true };
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
        const partyIdUsuario = indiceGrupoPorEmail.get(emailUsuario);
        if (partyIdUsuario) {
            cancelarDisolucionPendienteGrupo(partyIdUsuario);
        }
        emitirJugadoresConectados();
        emitirEstadoGrupo(emailUsuario);
        if (partyIdUsuario) {
            const party = gruposActivos.get(partyIdUsuario);
            if (party) {
                const otroEmail = [party.leaderEmail, party.memberEmail]
                    .find(email => normalizarTexto(email) !== normalizarTexto(emailUsuario));
                if (otroEmail) {
                    emitirEstadoGrupo(otroEmail);
                    const otro = obtenerUsuarioConectadoPorEmail(otroEmail);
                    if (otro) {
                        io.to(otro.id).emit('grupo:notificacion', {
                            tipo: 'info',
                            mensaje: `${nombreVisible} volvió a conectarse al grupo.`
                        });
                    }
                }
            }
        }

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

    socket.on('solicitarRefrescoJugadoresConectados', () => {
        emitirJugadoresConectados();
    });

    // ---------Fase 1 multijugador: sistema de grupos (2 jugadores)------------
    socket.on('grupo:invitar', ({ targetEmail }) => {
        const emisor = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!emisor) {
            return;
        }
        const destino = obtenerUsuarioConectadoPorEmail(targetEmail);
        if (!destino) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Jugador no disponible para invitar.' });
            return;
        }
        if (normalizarTexto(destino.email) === normalizarTexto(emisor.email)) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'No puedes invitarte a ti mismo.' });
            return;
        }
        if (indiceGrupoPorEmail.has(emisor.email)) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Ya estás en un grupo.' });
            return;
        }
        if (indiceGrupoPorEmail.has(destino.email)) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Ese jugador ya está en un grupo.' });
            return;
        }
        if (invitacionesSalientesPendientes.has(emisor.email)) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Ya tienes una invitación en curso. Espera su respuesta.' });
            return;
        }
        if (invitacionesGrupoPendientes.has(destino.email)) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Ese jugador ya tiene una invitación pendiente.' });
            return;
        }
        const createdAt = Date.now();
        const expiresAt = createdAt + INVITACION_GRUPO_TIMEOUT_MS;
        invitacionesGrupoPendientes.set(destino.email, { fromEmail: emisor.email, createdAt, expiresAt });
        invitacionesSalientesPendientes.set(emisor.email, destino.email);
        emitirEstadoInvitacionSaliente(emisor.email, true, destino.email, expiresAt);
        io.to(destino.id).emit('grupo:invitacion', {
            fromEmail: emisor.email,
            fromNombre: emisor.nombre,
            fromAvatar: emisor.avatar || '',
            expiresAt
        });
        io.to(socket.id).emit('grupo:notificacion', { tipo: 'info', mensaje: `Invitación enviada a ${destino.nombre}.` });
        const timeoutId = setTimeout(() => {
            const invitacionVigente = invitacionesGrupoPendientes.get(destino.email);
            if (!invitacionVigente || normalizarTexto(invitacionVigente.fromEmail) !== normalizarTexto(emisor.email)) {
                return;
            }
            limpiarInvitacionPendienteTarget(destino.email, 'La invitación expiró por tiempo.', true);
            const emisorConectado = obtenerUsuarioConectadoPorEmail(emisor.email);
            if (emisorConectado?.id) {
                io.to(emisorConectado.id).emit('grupo:notificacion', {
                    tipo: 'warning',
                    mensaje: `La invitación a ${destino.nombre} expiró (20s).`
                });
            }
            const destinoConectado = obtenerUsuarioConectadoPorEmail(destino.email);
            if (destinoConectado?.id) {
                io.to(destinoConectado.id).emit('grupo:notificacion', {
                    tipo: 'warning',
                    mensaje: 'La invitación de grupo expiró.'
                });
            }
        }, INVITACION_GRUPO_TIMEOUT_MS);
        temporizadoresInvitacionGrupo.set(destino.email, timeoutId);
    });

    socket.on('grupo:respuestaInvitacion', ({ fromEmail, aceptada }) => {
        const receptor = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!receptor) {
            return;
        }
        const invitacion = invitacionesGrupoPendientes.get(receptor.email);
        if (!invitacion || normalizarTexto(invitacion.fromEmail) !== normalizarTexto(fromEmail)) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'La invitación ya no está disponible.' });
            return;
        }
        limpiarInvitacionPendienteTarget(receptor.email);
        const emisor = obtenerUsuarioConectadoPorEmail(fromEmail);
        if (!emisor) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'El jugador que invitó ya no está conectado.' });
            return;
        }
        if (!aceptada) {
            io.to(emisor.id).emit('grupo:notificacion', { tipo: 'info', mensaje: `${receptor.nombre} rechazó tu invitación.` });
            io.to(receptor.id).emit('grupo:notificacion', { tipo: 'info', mensaje: 'Has rechazado la invitación de grupo.' });
            return;
        }
        if (indiceGrupoPorEmail.has(emisor.email) || indiceGrupoPorEmail.has(receptor.email)) {
            io.to(emisor.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'No se pudo crear el grupo: uno de los jugadores ya está en grupo.' });
            io.to(receptor.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'No se pudo crear el grupo: estado inválido.' });
            return;
        }
        const partyId = crearIdGrupo(emisor.email, receptor.email);
        gruposActivos.set(partyId, {
            id: partyId,
            leaderEmail: emisor.email,
            memberEmail: receptor.email,
            createdAt: Date.now()
        });
        indiceGrupoPorEmail.set(emisor.email, partyId);
        indiceGrupoPorEmail.set(receptor.email, partyId);
        emitirEstadoGrupo(emisor.email);
        emitirEstadoGrupo(receptor.email);
        emitirJugadoresConectados();
        io.to(emisor.id).emit('grupo:notificacion', { tipo: 'success', mensaje: `Grupo creado con ${receptor.nombre}.` });
        io.to(receptor.id).emit('grupo:notificacion', { tipo: 'success', mensaje: `Te uniste al grupo de ${emisor.nombre}.` });
        io.to(emisor.id).emit('grupo:redirigirMultijugador', { partyId });
        io.to(receptor.id).emit('grupo:redirigirMultijugador', { partyId });
    });

    socket.on('grupo:abandonar', () => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) return;
        const partyId = indiceGrupoPorEmail.get(usuario.email);
        if (!partyId) {
            emitirEstadoGrupo(usuario.email);
            return;
        }
        disolverGrupoPorId(partyId, `${usuario.nombre} abandonó el grupo.`);
    });

    socket.on('grupo:chat:historial:solicitar', () => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) return;
        const partyId = indiceGrupoPorEmail.get(usuario.email);
        if (!partyId) {
            io.to(socket.id).emit('grupo:chat:historial', []);
            return;
        }
        io.to(socket.id).emit('grupo:chat:historial', chatGrupoPorParty.get(partyId) || []);
    });

    socket.on('grupo:chat:enviar', ({ mensaje }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) return;
        const partyId = indiceGrupoPorEmail.get(usuario.email);
        if (!partyId) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'No estás en un grupo.' });
            return;
        }
        const texto = String(mensaje || '').trim();
        if (!texto) return;
        const payloadMensaje = obtenerMensajeChatGrupo({
            usuario: usuario.nombre,
            email: usuario.email,
            avatar: usuario.avatar,
            mensaje: texto
        });
        const historial = [...(chatGrupoPorParty.get(partyId) || []), payloadMensaje].slice(-CHAT_GRUPO_MAX_MENSAJES);
        chatGrupoPorParty.set(partyId, historial);
        emitirAGrupo(partyId, 'grupo:chat:mensaje', payloadMensaje);
    });

    // --------- Intercambio de cartas entre miembros del grupo ---------
    socket.on('trade:solicitar', () => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) {
            return;
        }
        const partyId = indiceGrupoPorEmail.get(usuario.email);
        if (!partyId) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Debes estar en un grupo para intercambiar.' });
            return;
        }
        const trade = intercambiosActivos.get(partyId);
        if (trade?.fase === 'activo') {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'warning', mensaje: 'Ya hay un intercambio en curso.' });
            return;
        }
        if (trade?.fase === 'pendiente') {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'warning', mensaje: 'Ya hay una solicitud de intercambio pendiente.' });
            return;
        }
        const party = gruposActivos.get(partyId);
        const companeroEmail = normalizarTexto(party.leaderEmail) === normalizarTexto(usuario.email)
            ? party.memberEmail
            : party.leaderEmail;
        const companero = obtenerUsuarioConectadoPorEmail(companeroEmail);
        if (!companero?.id) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Tu compañero no está conectado.' });
            return;
        }
        intercambiosActivos.set(partyId, {
            fase: 'pendiente',
            solicitanteEmail: usuario.email,
            ofertas: {
                [party.leaderEmail]: crearEstadoOfertaIntercambio(party.leaderEmail),
                [party.memberEmail]: crearEstadoOfertaIntercambio(party.memberEmail)
            }
        });
        io.to(companero.id).emit('trade:solicitud', {
            fromEmail: usuario.email,
            fromNombre: usuario.nombre,
            fromAvatar: usuario.avatar || ''
        });
        io.to(socket.id).emit('trade:solicitudEnviada', {
            targetEmail: companeroEmail,
            targetNombre: companero.nombre
        });
    });

    socket.on('trade:respuestaSolicitud', ({ aceptada }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) {
            return;
        }
        const partyId = indiceGrupoPorEmail.get(usuario.email);
        const trade = partyId ? intercambiosActivos.get(partyId) : null;
        if (!trade || trade.fase !== 'pendiente') {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'No hay solicitud de intercambio pendiente.' });
            return;
        }
        if (normalizarTexto(trade.solicitanteEmail) === normalizarTexto(usuario.email)) {
            return;
        }
        const solicitante = obtenerUsuarioConectadoPorEmail(trade.solicitanteEmail);
        if (!aceptada) {
            intercambiosActivos.delete(partyId);
            if (solicitante?.id) {
                io.to(solicitante.id).emit('trade:rechazado', { porEmail: usuario.email, porNombre: usuario.nombre });
            }
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'info', mensaje: 'Has rechazado el intercambio.' });
            return;
        }
        trade.fase = 'activo';
        trade.ofertas[trade.solicitanteEmail].aceptado = false;
        trade.ofertas[trade.solicitanteEmail].indices = [];
        trade.ofertas[usuario.email].aceptado = false;
        trade.ofertas[usuario.email].indices = [];
        emitirEstadoIntercambio(partyId);
    });

    socket.on('trade:actualizarOferta', ({ indices }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) {
            return;
        }
        const partyId = indiceGrupoPorEmail.get(usuario.email);
        const trade = partyId ? intercambiosActivos.get(partyId) : null;
        if (!trade || trade.fase !== 'activo') {
            return;
        }
        const oferta = trade.ofertas[usuario.email];
        if (!oferta) {
            return;
        }
        obtenerUsuarioPersistidoPorEmail(usuario.email).then((persistido) => {
            const cartas = persistido?.cartas || [];
            const indicesLimpios = [...new Set((indices || [])
                .map((i) => Number(i))
                .filter((i) => Number.isInteger(i) && i >= 0 && i < cartas.length))];
            if (!indicesIntercambiablesValidos(cartas, indicesLimpios)) {
                io.to(socket.id).emit('grupo:notificacion', {
                    tipo: 'error',
                    mensaje: 'Solo puedes ofrecer cartas duplicadas (debes conservar al menos una copia).'
                });
                return;
            }
            oferta.indices = indicesLimpios;
            oferta.cartas = indicesLimpios
                .map((idx) => serializarCartaIntercambio(cartas[idx]))
                .filter(Boolean);
            oferta.aceptado = false;
            emitirEstadoIntercambio(partyId);
        });
    });

    socket.on('trade:toggleAceptar', ({ aceptado }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) {
            return;
        }
        const partyId = indiceGrupoPorEmail.get(usuario.email);
        const trade = partyId ? intercambiosActivos.get(partyId) : null;
        if (!trade || trade.fase !== 'activo') {
            return;
        }
        const oferta = trade.ofertas[usuario.email];
        if (!oferta) {
            return;
        }
        oferta.aceptado = Boolean(aceptado);
        emitirEstadoIntercambio(partyId);
        const party = gruposActivos.get(partyId);
        if (!party) {
            return;
        }
        const otraOferta = trade.ofertas[
            normalizarTexto(usuario.email) === normalizarTexto(party.leaderEmail)
                ? party.memberEmail
                : party.leaderEmail
        ];
        if (oferta.aceptado && otraOferta?.aceptado) {
            void ejecutarIntercambioGrupo(partyId).then((resultado) => {
                if (!resultado.ok) {
                    emitirAGrupo(partyId, 'grupo:notificacion', { tipo: 'error', mensaje: resultado.mensaje });
                    if (trade && intercambiosActivos.has(partyId)) {
                        Object.values(trade.ofertas).forEach((o) => { o.aceptado = false; });
                        emitirEstadoIntercambio(partyId);
                    }
                }
            });
        }
    });

    socket.on('trade:cancelar', () => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) {
            return;
        }
        const partyId = indiceGrupoPorEmail.get(usuario.email);
        if (!partyId || !intercambiosActivos.has(partyId)) {
            return;
        }
        cancelarIntercambioPorParty(partyId, `${usuario.nombre} canceló el intercambio.`);
    });

    socket.on('multiplayer:lobby:abrir', () => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) return;
        const partyId = indiceGrupoPorEmail.get(usuario.email);
        if (!partyId) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Debes estar en un grupo para crear lobby.' });
            return;
        }
        const emails = obtenerEmailsGrupo(partyId);
        if (emails.length !== 2) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'El grupo debe tener 2 jugadores.' });
            return;
        }
        const lobbyPrevio = lobbiesMultijugador.get(partyId);
        if (lobbyPrevio?.countdownTimer) {
            clearInterval(lobbyPrevio.countdownTimer);
        }
        lobbiesMultijugador.set(partyId, {
            partyId,
            jugadores: {
                [emails[0]]: { mazoIndex: null, mazoNombre: null, listo: false },
                [emails[1]]: { mazoIndex: null, mazoNombre: null, listo: false }
            },
            countdown: null,
            countdownTimer: null
        });
        emitirSnapshotLobby(partyId);
    });

    socket.on('multiplayer:lobby:estado:solicitar', () => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) return;
        const partyId = indiceGrupoPorEmail.get(usuario.email);
        if (!partyId) return;
        io.to(socket.id).emit('multiplayer:lobby:estado', obtenerSnapshotLobby(partyId));
    });

    socket.on('multiplayer:lobby:actualizarMazo', ({ mazoIndex, mazoNombre }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) return;
        const partyId = indiceGrupoPorEmail.get(usuario.email);
        if (!partyId || !lobbiesMultijugador.has(partyId)) return;
        const lobby = lobbiesMultijugador.get(partyId);
        const estadoJugador = lobby.jugadores[usuario.email];
        if (!estadoJugador) return;
        const idx = Number(mazoIndex);
        estadoJugador.mazoIndex = Number.isInteger(idx) && idx >= 0 ? idx : null;
        estadoJugador.mazoNombre = String(mazoNombre || '').trim() || null;
        estadoJugador.listo = false;
        if (lobby.countdownTimer) {
            clearInterval(lobby.countdownTimer);
            lobby.countdownTimer = null;
            lobby.countdown = null;
            emitirAGrupo(partyId, 'multiplayer:lobby:countdown', { activo: false, valor: null });
        }
        emitirSnapshotLobby(partyId);
    });

    socket.on('multiplayer:lobby:toggleListo', ({ listo }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) return;
        const partyId = indiceGrupoPorEmail.get(usuario.email);
        if (!partyId || !lobbiesMultijugador.has(partyId)) return;
        const lobby = lobbiesMultijugador.get(partyId);
        const estadoJugador = lobby.jugadores[usuario.email];
        if (!estadoJugador) return;
        if (!Number.isInteger(estadoJugador.mazoIndex) || estadoJugador.mazoIndex < 0) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Debes seleccionar mazo antes de marcar listo.' });
            return;
        }
        estadoJugador.listo = Boolean(listo);
        const snapshot = obtenerSnapshotLobby(partyId);
        const ambosListos = snapshot.ambosListos;
        if (!ambosListos && lobby.countdownTimer) {
            clearInterval(lobby.countdownTimer);
            lobby.countdownTimer = null;
            lobby.countdown = null;
            emitirAGrupo(partyId, 'multiplayer:lobby:countdown', { activo: false, valor: null });
        }
        emitirSnapshotLobby(partyId);

        if (ambosListos && !lobby.countdownTimer) {
            lobby.countdown = 3;
            emitirAGrupo(partyId, 'multiplayer:lobby:countdown', { activo: true, valor: lobby.countdown });
            lobby.countdownTimer = setInterval(async () => {
                if (!lobbiesMultijugador.has(partyId)) {
                    clearInterval(lobby.countdownTimer);
                    return;
                }
                const actual = lobbiesMultijugador.get(partyId);
                if (!actual) return;
                actual.countdown -= 1;
                if (actual.countdown > 0) {
                    emitirAGrupo(partyId, 'multiplayer:lobby:countdown', { activo: true, valor: actual.countdown });
                    return;
                }
                clearInterval(actual.countdownTimer);
                actual.countdownTimer = null;
                actual.countdown = null;
                emitirAGrupo(partyId, 'multiplayer:lobby:countdown', { activo: false, valor: 0 });
                const finalSnapshot = obtenerSnapshotLobby(partyId);
                const [emailA, emailB] = obtenerEmailsGrupo(partyId);
                const [datosA, datosB] = await Promise.all([
                    obtenerUsuarioPersistidoPorEmail(emailA),
                    obtenerUsuarioPersistidoPorEmail(emailB)
                ]);
                const jugadorA = finalSnapshot.jugadores.find(j => normalizarTexto(j.email) === normalizarTexto(emailA));
                const jugadorB = finalSnapshot.jugadores.find(j => normalizarTexto(j.email) === normalizarTexto(emailB));
                const mazoA = resolverMazoSeleccionado(datosA, jugadorA);
                const mazoB = resolverMazoSeleccionado(datosB, jugadorB);
                if (!Array.isArray(mazoA) || !Array.isArray(mazoB) || mazoA.length < 6 || mazoB.length < 6) {
                    emitirAGrupo(partyId, 'grupo:notificacion', {
                        tipo: 'error',
                        mensaje: 'No se pudo iniciar: mazo inválido o desactualizado.'
                    });
                    Object.keys(actual.jugadores).forEach(emailJugador => {
                        actual.jugadores[emailJugador].listo = false;
                    });
                    emitirSnapshotLobby(partyId);
                    return;
                }
                const sessionId = `pvp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
                const primerTurno = determinarPrimerTurnoPvp(mazoA, mazoB);
                const inicialesA = seleccionarIndicesAleatorios(3, mazoA.length);
                const inicialesB = seleccionarIndicesAleatorios(3, mazoB.length);
                sesionesPvpActivas.set(sessionId, {
                    sessionId,
                    partyId,
                    emailA,
                    emailB,
                    createdAt: Date.now(),
                    primerTurno,
                    inicialesA,
                    inicialesB,
                    turnEmail: primerTurno === 'A' ? emailA : emailB,
                    socketByEmail: {},
                    updatedAt: Date.now(),
                    finalizada: false,
                    resultado: null,
                    revisionEstado: 0,
                    snapshotEstado: null,
                    healDebuffFactor: { A: 1, B: 1 }
                });
                const payloadA = {
                    sessionId,
                    partyId,
                    modo: 'pvp',
                    rolPvp: 'A',
                    miMazo: mazoA,
                    oponenteMazo: mazoB,
                    oponente: {
                        email: jugadorB?.email || emailB,
                        nombre: jugadorB?.nombre || (emailB ? emailB.split('@')[0] : 'Oponente'),
                        avatar: jugadorB?.avatar || ''
                    },
                    primerTurno: primerTurno === 'A' ? 'jugador' : 'oponente',
                    inicialesMiMazoIndices: inicialesA,
                    inicialesOponenteMazoIndices: inicialesB
                };
                const payloadB = {
                    sessionId,
                    partyId,
                    modo: 'pvp',
                    rolPvp: 'B',
                    miMazo: mazoB,
                    oponenteMazo: mazoA,
                    oponente: {
                        email: jugadorA?.email || emailA,
                        nombre: jugadorA?.nombre || (emailA ? emailA.split('@')[0] : 'Oponente'),
                        avatar: jugadorA?.avatar || ''
                    },
                    primerTurno: primerTurno === 'B' ? 'jugador' : 'oponente',
                    inicialesMiMazoIndices: inicialesB,
                    inicialesOponenteMazoIndices: inicialesA
                };
                const userA = obtenerUsuarioConectadoPorEmail(emailA);
                const userB = obtenerUsuarioConectadoPorEmail(emailB);
                if (userA?.id) {
                    io.to(userA.id).emit('multiplayer:session:start', payloadA);
                }
                if (userB?.id) {
                    io.to(userB.id).emit('multiplayer:session:start', payloadB);
                }
                Object.keys(actual.jugadores).forEach(emailJugador => {
                    actual.jugadores[emailJugador].listo = false;
                });
                emitirSnapshotLobby(partyId);
            }, 1000);
        }
    });

    socket.on('multiplayer:pvp:join', ({ sessionId }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        const sesion = sesionesPvpActivas.get(String(sessionId || '').trim());
        if (!usuario || !sesion) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Sesión PvP inválida o expirada.' });
            return;
        }
        const emailNorm = normalizarTexto(usuario.email);
        const esMiembro = normalizarTexto(sesion.emailA) === emailNorm || normalizarTexto(sesion.emailB) === emailNorm;
        if (!esMiembro) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'No perteneces a esta sesión PvP.' });
            return;
        }
        const room = obtenerRoomSesionPvp(sesion.sessionId);
        socket.join(room);
        sesion.socketByEmail[usuario.email] = socket.id;
        sesion.updatedAt = Date.now();
        cancelarDesconexionPendientePvp(sesion.sessionId, usuario.email);
        registrarTrazaPvp(sesion.sessionId, 'join', {
            email: usuario.email,
            socketId: socket.id,
            revision: Number(sesion.revisionEstado || 0)
        });
        io.to(socket.id).emit('multiplayer:pvp:turno', {
            sessionId: sesion.sessionId,
            turnEmail: sesion.turnEmail
        });
        if (sesion.snapshotEstado) {
            io.to(socket.id).emit('multiplayer:pvp:estado', {
                sessionId: sesion.sessionId,
                revision: Number(sesion.revisionEstado || 0),
                snapshot: sesion.snapshotEstado
            });
        }
        if (sesion.finalizada && sesion.resultado) {
            io.to(socket.id).emit('multiplayer:pvp:resultado', sesion.resultado);
        }
    });

    socket.on('multiplayer:pvp:estado:solicitar', ({ sessionId }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        const sesion = sesionesPvpActivas.get(String(sessionId || '').trim());
        if (!usuario || !sesion) return;
        const lado = obtenerLadoPvpDesdeEmail(sesion, usuario.email);
        if (!lado) return;
        registrarTrazaPvp(sesion.sessionId, 'estado_solicitar', {
            email: usuario.email,
            revision: Number(sesion.revisionEstado || 0)
        });
        if (sesion.snapshotEstado) {
            io.to(socket.id).emit('multiplayer:pvp:estado', {
                sessionId: sesion.sessionId,
                revision: Number(sesion.revisionEstado || 0),
                snapshot: sesion.snapshotEstado
            });
        }
        io.to(socket.id).emit('multiplayer:pvp:turno', {
            sessionId: sesion.sessionId,
            turnEmail: sesion.turnEmail
        });
        if (sesion.finalizada && sesion.resultado) {
            io.to(socket.id).emit('multiplayer:pvp:resultado', sesion.resultado);
        }
    });

    socket.on('multiplayer:pvp:estado', ({ sessionId, snapshot, baseRevision }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        const sesion = sesionesPvpActivas.get(String(sessionId || '').trim());
        if (!usuario || !sesion || sesion.finalizada) return;
        const emailNorm = normalizarTexto(usuario.email);
        const esMiembro = emailNorm === normalizarTexto(sesion.emailA) || emailNorm === normalizarTexto(sesion.emailB);
        if (!esMiembro) return;
        const revisionActual = Number(sesion.revisionEstado || 0);
        const revisionBase = Number(baseRevision);
        if (!Number.isInteger(revisionBase) || revisionBase !== revisionActual) {
            io.to(socket.id).emit('multiplayer:pvp:resync-required', {
                sessionId: sesion.sessionId,
                reason: 'revision_mismatch_estado',
                revision: revisionActual
            });
            return;
        }
        if (!snapshot || typeof snapshot !== 'object') return;
        const mazoA = Array.isArray(snapshot?.mazoA) ? snapshot.mazoA : null;
        const mazoB = Array.isArray(snapshot?.mazoB) ? snapshot.mazoB : null;
        const mesaA = Array.isArray(snapshot?.cartasEnJuegoA) ? snapshot.cartasEnJuegoA : null;
        const mesaB = Array.isArray(snapshot?.cartasEnJuegoB) ? snapshot.cartasEnJuegoB : null;
        if (!mazoA || !mazoB || !mesaA || !mesaB) return;
        if (mesaA.length !== 3 || mesaB.length !== 3) return;
        sesion.snapshotEstado = snapshot;
        sesion.revisionEstado = revisionActual + 1;
        sesion.updatedAt = Date.now();
        registrarTrazaPvp(sesion.sessionId, 'estado_publicado', {
            email: usuario.email,
            baseRevision: revisionBase,
            newRevision: sesion.revisionEstado
        });
        io.to(obtenerRoomSesionPvp(sesion.sessionId)).emit('multiplayer:pvp:estado', {
            sessionId: sesion.sessionId,
            revision: sesion.revisionEstado,
            snapshot: sesion.snapshotEstado
        });
    });

    socket.on('multiplayer:pvp:accion', ({ sessionId, accion, expectedRevision }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        const sesion = sesionesPvpActivas.get(String(sessionId || '').trim());
        if (!usuario || !sesion) return;
        if (sesion.finalizada) return;
        if (normalizarTexto(usuario.email) !== normalizarTexto(sesion.turnEmail)) return;
        const revisionActual = Number(sesion.revisionEstado || 0);
        const revisionEsperada = Number(expectedRevision);
        if (!Number.isInteger(revisionEsperada) || revisionEsperada !== revisionActual) {
            io.to(socket.id).emit('multiplayer:pvp:resync-required', {
                sessionId: sesion.sessionId,
                reason: 'revision_mismatch_accion',
                revision: revisionActual
            });
            return;
        }
        const payloadAccion = typeof accion === 'object' && accion ? accion : null;
        if (!payloadAccion) return;
        const tipo = String(payloadAccion?.tipo || '').trim();
        if (tipo !== 'ataque' && tipo !== 'habilidad') return;
        const slotAtacante = Number(payloadAccion?.slotAtacante);
        if (!Number.isInteger(slotAtacante) || slotAtacante < 0 || slotAtacante > 2) return;
        const slotObjetivoHabilidad = payloadAccion?.slotObjetivo;
        const indiceCementerioHabilidad = Number(payloadAccion?.indiceCementerio);
        if (tipo === 'habilidad' && slotObjetivoHabilidad !== undefined && slotObjetivoHabilidad !== null) {
            const slotObjetivoNum = Number(slotObjetivoHabilidad);
            if (!Number.isInteger(slotObjetivoNum) || slotObjetivoNum < 0 || slotObjetivoNum > 2) {
                return;
            }
        }
        if (tipo === 'ataque') {
            const slotObjetivo = Number(payloadAccion?.slotObjetivo);
            if (!Number.isInteger(slotObjetivo) || slotObjetivo < 0 || slotObjetivo > 2) return;
        }
        const ladoActor = obtenerLadoPvpDesdeEmail(sesion, usuario.email);
        if (!ladoActor || !sesion.snapshotEstado) {
            io.to(socket.id).emit('multiplayer:pvp:resync-required', {
                sessionId: sesion.sessionId,
                reason: 'snapshot_unavailable',
                revision: revisionActual
            });
            return;
        }
        const mesaAliada = ladoActor === 'A' ? sesion.snapshotEstado.cartasEnJuegoA : sesion.snapshotEstado.cartasEnJuegoB;
        const mesaEnemiga = ladoActor === 'A' ? sesion.snapshotEstado.cartasEnJuegoB : sesion.snapshotEstado.cartasEnJuegoA;
        if (!Array.isArray(mesaAliada) || !Array.isArray(mesaEnemiga) || mesaAliada.length !== 3 || mesaEnemiga.length !== 3) {
            io.to(socket.id).emit('multiplayer:pvp:resync-required', {
                sessionId: sesion.sessionId,
                reason: 'snapshot_invalid',
                revision: revisionActual
            });
            return;
        }
        if (!mesaAliada[slotAtacante]) {
            io.to(socket.id).emit('multiplayer:pvp:resync-required', {
                sessionId: sesion.sessionId,
                reason: 'atacante_invalido',
                revision: revisionActual
            });
            return;
        }
        if (tipo === 'ataque') {
            const slotObjetivo = Number(payloadAccion?.slotObjetivo);
            if (!mesaEnemiga[slotObjetivo]) {
                io.to(socket.id).emit('multiplayer:pvp:resync-required', {
                    sessionId: sesion.sessionId,
                    reason: 'objetivo_invalido',
                    revision: revisionActual
                });
                return;
            }
            const tankIdx = obtenerIndiceTankActivoServidor(mesaEnemiga);
            if (tankIdx !== null && tankIdx !== slotObjetivo) {
                io.to(socket.id).emit('multiplayer:pvp:resync-required', {
                    sessionId: sesion.sessionId,
                    reason: 'tank_objetivo_requerido',
                    revision: revisionActual
                });
                return;
            }
        }
        if (Math.max(0, Number(mesaAliada[slotAtacante]?.stunRestante || 0)) > 0) {
            io.to(socket.id).emit('multiplayer:pvp:resync-required', {
                sessionId: sesion.sessionId,
                reason: 'atacante_aturdido',
                revision: revisionActual
            });
            return;
        }
        registrarTrazaPvp(sesion.sessionId, 'accion_recibida', {
            email: usuario.email,
            tipo,
            slotAtacante,
            slotObjetivo: payloadAccion?.slotObjetivo ?? null,
            expectedRevision: revisionEsperada,
            revisionActual
        });
        const keyActuaron = ladoActor === 'A' ? 'cartasYaActuaronA' : 'cartasYaActuaronB';
        const keyAccionesExtra = ladoActor === 'A' ? 'accionesExtraA' : 'accionesExtraB';
        sesion.snapshotEstado[keyActuaron] = Array.isArray(sesion.snapshotEstado[keyActuaron]) ? sesion.snapshotEstado[keyActuaron] : [];
        sesion.snapshotEstado[keyAccionesExtra] = Math.max(0, Number(sesion.snapshotEstado[keyAccionesExtra] || 0));
        const yaActuo = sesion.snapshotEstado[keyActuaron].includes(slotAtacante);
        if (yaActuo && !(tipo === 'ataque' && sesion.snapshotEstado[keyAccionesExtra] > 0)) {
            io.to(socket.id).emit('multiplayer:pvp:resync-required', {
                sessionId: sesion.sessionId,
                reason: 'carta_ya_actuo',
                revision: revisionActual
            });
            return;
        }
        const hayAccionExtraDisponible = tipo === 'ataque' && sesion.snapshotEstado[keyAccionesExtra] > 0;
        const consumeAccionExtra = hayAccionExtraDisponible;
        if (consumeAccionExtra) {
            sesion.snapshotEstado[keyAccionesExtra] = Math.max(0, Number(sesion.snapshotEstado[keyAccionesExtra] || 0) - 1);
        }
        if (tipo === 'ataque') {
            sincronizarHealDebuffPvpSesion(sesion);
            const slotObjetivo = Number(payloadAccion?.slotObjetivo);
            const resultado = aplicarAtaqueCanonicoSnapshot(sesion.snapshotEstado, ladoActor, slotAtacante, slotObjetivo);
            if (!resultado.ok) {
                io.to(socket.id).emit('multiplayer:pvp:resync-required', {
                    sessionId: sesion.sessionId,
                    reason: `ataque_invalido_${resultado.reason || 'error'}`,
                    revision: revisionActual
                });
                return;
            }
            // Si el ataque consume una acción extra y la carta aún no había actuado,
            // mantenemos su ataque básico disponible para este turno.
            if (!yaActuo && !consumeAccionExtra) {
                sesion.snapshotEstado[keyActuaron].push(slotAtacante);
            }
        } else {
            sincronizarHealDebuffPvpSesion(sesion);
            const resultado = aplicarHabilidadCanonicaSnapshot(
                sesion.snapshotEstado,
                ladoActor,
                slotAtacante,
                Number.isInteger(Number(slotObjetivoHabilidad)) ? Number(slotObjetivoHabilidad) : null,
                Number.isInteger(indiceCementerioHabilidad) ? indiceCementerioHabilidad : null
            );
            if (!resultado.ok) {
                io.to(socket.id).emit('multiplayer:pvp:resync-required', {
                    sessionId: sesion.sessionId,
                    reason: `habilidad_invalida_${resultado.reason || 'error'}`,
                    revision: revisionActual
                });
                return;
            }
        }
        const ladoObjetivo = ladoActor === 'A' ? 'B' : 'A';
        if (tieneAtaquePendienteServidor(sesion.snapshotEstado, ladoActor)) {
            rellenarUnSlotSiMesaVaciaServidor(sesion.snapshotEstado, ladoObjetivo);
        }
        const ganadorPorEstado = obtenerGanadorPorEstadoSnapshot(sesion, sesion.snapshotEstado);
        if (ganadorPorEstado) {
            sesion.finalizada = true;
            sesion.resultado = {
                sessionId: sesion.sessionId,
                ganadorEmail: ganadorPorEstado,
                motivo: 'sin_cartas'
            };
        }
        sesion.revisionEstado = revisionActual + 1;
        sesion.updatedAt = Date.now();
        registrarTrazaPvp(sesion.sessionId, 'accion_aplicada', {
            email: usuario.email,
            tipo,
            newRevision: sesion.revisionEstado,
            finalizada: Boolean(sesion.finalizada)
        });
        io.to(obtenerRoomSesionPvp(sesion.sessionId)).emit('multiplayer:pvp:accion', {
            sessionId: sesion.sessionId,
            actorEmail: usuario.email,
            accion: payloadAccion,
            revision: sesion.revisionEstado
        });
        io.to(obtenerRoomSesionPvp(sesion.sessionId)).emit('multiplayer:pvp:estado', {
            sessionId: sesion.sessionId,
            revision: sesion.revisionEstado,
            snapshot: sesion.snapshotEstado
        });
        if (sesion.finalizada && sesion.resultado) {
            io.to(obtenerRoomSesionPvp(sesion.sessionId)).emit('multiplayer:pvp:resultado', sesion.resultado);
        }
    });

    socket.on('multiplayer:pvp:seleccionAtacante', ({ sessionId, slotAtacante }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        const sesion = sesionesPvpActivas.get(String(sessionId || '').trim());
        if (!usuario || !sesion || sesion.finalizada) return;
        const emailNorm = normalizarTexto(usuario.email);
        const esMiembro = emailNorm === normalizarTexto(sesion.emailA) || emailNorm === normalizarTexto(sesion.emailB);
        if (!esMiembro) return;
        const slot = Number(slotAtacante);
        const slotNormalizado = Number.isInteger(slot) && slot >= 0 && slot <= 2 ? slot : null;
        io.to(obtenerRoomSesionPvp(sesion.sessionId)).emit('multiplayer:pvp:seleccionAtacante', {
            sessionId: sesion.sessionId,
            actorEmail: usuario.email,
            slotAtacante: slotNormalizado
        });
    });

    socket.on('multiplayer:pvp:finTurno', ({ sessionId, expectedRevision }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        const sesion = sesionesPvpActivas.get(String(sessionId || '').trim());
        if (!usuario || !sesion) return;
        if (sesion.finalizada) return;
        if (normalizarTexto(usuario.email) !== normalizarTexto(sesion.turnEmail)) return;
        const revisionActual = Number(sesion.revisionEstado || 0);
        const revisionEsperada = Number(expectedRevision);
        if (!Number.isInteger(revisionEsperada) || revisionEsperada !== revisionActual) {
            io.to(socket.id).emit('multiplayer:pvp:resync-required', {
                sessionId: sesion.sessionId,
                reason: 'revision_mismatch_fin_turno',
                revision: revisionActual
            });
            return;
        }
        const siguiente = normalizarTexto(usuario.email) === normalizarTexto(sesion.emailA) ? sesion.emailB : sesion.emailA;
        sesion.turnEmail = siguiente;
        const ladoSiguiente = obtenerLadoPvpDesdeEmail(sesion, siguiente);
        const ladoActual = ladoSiguiente === 'A' ? 'B' : 'A';
        if (sesion.snapshotEstado && (ladoSiguiente === 'A' || ladoSiguiente === 'B')) {
            const mesaActual = ladoActual === 'A' ? sesion.snapshotEstado.cartasEnJuegoA : sesion.snapshotEstado.cartasEnJuegoB;
            const mesaSiguiente = ladoSiguiente === 'A' ? sesion.snapshotEstado.cartasEnJuegoA : sesion.snapshotEstado.cartasEnJuegoB;
            const cementerioSiguiente = ladoSiguiente === 'A' ? sesion.snapshotEstado.cementerioA : sesion.snapshotEstado.cementerioB;
            sincronizarHealDebuffPvpSesion(sesion);
            consumirStunFinTurnoServidor(mesaActual);
            reducirCooldownHabilidadesServidor(mesaSiguiente);
            const mesaEnemigaDot = ladoSiguiente === 'A' ? sesion.snapshotEstado.cartasEnJuegoB : sesion.snapshotEstado.cartasEnJuegoA;
            aplicarDotInicioTurnoServidorConCementerio(mesaSiguiente, cementerioSiguiente, mesaEnemigaDot);
            rellenarSlotsDesdeMazoServidor(sesion.snapshotEstado, ladoSiguiente);
            const keyActuaronSiguiente = ladoSiguiente === 'A' ? 'cartasYaActuaronA' : 'cartasYaActuaronB';
            sesion.snapshotEstado[keyActuaronSiguiente] = [];
            sesion.snapshotEstado.accionesExtraA = 0;
            sesion.snapshotEstado.accionesExtraB = 0;
            sesion.snapshotEstado.turno = ladoSiguiente;
            const ganadorPorEstado = obtenerGanadorPorEstadoSnapshot(sesion, sesion.snapshotEstado);
            if (ganadorPorEstado && !sesion.finalizada) {
                sesion.finalizada = true;
                sesion.resultado = {
                    sessionId: sesion.sessionId,
                    ganadorEmail: ganadorPorEstado,
                    motivo: 'sin_cartas'
                };
            }
            sesion.revisionEstado = Number(sesion.revisionEstado || 0) + 1;
            io.to(obtenerRoomSesionPvp(sesion.sessionId)).emit('multiplayer:pvp:estado', {
                sessionId: sesion.sessionId,
                revision: sesion.revisionEstado,
                snapshot: sesion.snapshotEstado
            });
        }
        sesion.updatedAt = Date.now();
        registrarTrazaPvp(sesion.sessionId, 'fin_turno', {
            email: usuario.email,
            expectedRevision: revisionEsperada,
            revisionActual: Number(sesion.revisionEstado || 0),
            siguiente
        });
        io.to(obtenerRoomSesionPvp(sesion.sessionId)).emit('multiplayer:pvp:turno', {
            sessionId: sesion.sessionId,
            turnEmail: sesion.turnEmail
        });
        if (sesion.finalizada && sesion.resultado) {
            io.to(obtenerRoomSesionPvp(sesion.sessionId)).emit('multiplayer:pvp:resultado', sesion.resultado);
        }
    });

    socket.on('multiplayer:pvp:resultado', ({ sessionId, ganadorEmail, motivo }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        const sesion = sesionesPvpActivas.get(String(sessionId || '').trim());
        if (!usuario || !sesion || sesion.finalizada) return;
        const emailNorm = normalizarTexto(usuario.email);
        const esMiembro = emailNorm === normalizarTexto(sesion.emailA) || emailNorm === normalizarTexto(sesion.emailB);
        if (!esMiembro) return;
        const ganadorNorm = normalizarTexto(ganadorEmail);
        const ganadorValido = ganadorNorm === normalizarTexto(sesion.emailA) || ganadorNorm === normalizarTexto(sesion.emailB);
        if (!ganadorValido) return;
        sesion.finalizada = true;
        sesion.resultado = {
            sessionId: sesion.sessionId,
            ganadorEmail: ganadorEmail,
            motivo: String(motivo || 'fin_partida')
        };
        sesion.updatedAt = Date.now();
        registrarTrazaPvp(sesion.sessionId, 'resultado', {
            email: usuario.email,
            ganadorEmail,
            motivo: String(motivo || 'fin_partida')
        });
        io.to(obtenerRoomSesionPvp(sesion.sessionId)).emit('multiplayer:pvp:resultado', sesion.resultado);
    });

    socket.on('multiplayer:pvp:abandonar', ({ sessionId }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        const sesion = sesionesPvpActivas.get(String(sessionId || '').trim());
        if (!usuario || !sesion || sesion.finalizada) return;
        const emailNorm = normalizarTexto(usuario.email);
        const esA = emailNorm === normalizarTexto(sesion.emailA);
        const esB = emailNorm === normalizarTexto(sesion.emailB);
        if (!esA && !esB) return;
        const ganadorEmail = esA ? sesion.emailB : sesion.emailA;
        cancelarDesconexionPendientePvp(sesion.sessionId, sesion.emailA);
        cancelarDesconexionPendientePvp(sesion.sessionId, sesion.emailB);
        sesion.finalizada = true;
        sesion.resultado = {
            sessionId: sesion.sessionId,
            ganadorEmail,
            motivo: 'abandono'
        };
        sesion.updatedAt = Date.now();
        registrarTrazaPvp(sesion.sessionId, 'abandono', {
            email: usuario.email,
            ganadorEmail
        });
        io.to(obtenerRoomSesionPvp(sesion.sessionId)).emit('multiplayer:pvp:resultado', sesion.resultado);
    });

    socket.on('coop:evento:invitar', ({ eventoId, dificultad, eventoNombre }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) return;
        const partyId = indiceGrupoPorEmail.get(usuario.email);
        if (!partyId || !gruposActivos.has(partyId)) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Debes estar en un grupo para invitar.' });
            return;
        }
        const emails = obtenerEmailsGrupo(partyId);
        if (emails.length !== 2) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'El grupo debe tener 2 jugadores.' });
            return;
        }
        const otroEmail = emails.find(e => normalizarTexto(e) !== normalizarTexto(usuario.email));
        if (!otroEmail) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'No se encontró compañero de grupo.' });
            return;
        }
        const idNum = Number(eventoId);
        const difNum = Math.min(6, Math.max(1, Number(dificultad) || 1));
        if (!Number.isFinite(idNum)) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Evento inválido.' });
            return;
        }
        const fila = buscarFilaEventoOnlinePorId(idNum);
        if (!fila) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Evento no encontrado en el servidor.' });
            return;
        }
        const prepId = `coop_prep_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
        preparacionesCoopEvento.set(prepId, {
            prepId,
            partyId,
            inviterEmail: usuario.email,
            inviteeEmail: otroEmail,
            eventoId: idNum,
            dificultad: difNum,
            eventoNombre: String(eventoNombre || fila.nombre || '').trim() || `Evento ${idNum}`,
            estado: 'invitacion',
            listoA: false,
            listoB: false,
            cartasA: null,
            cartasB: null
        });
        const otro = obtenerUsuarioConectadoPorEmail(otroEmail);
        const nombreEv = String(eventoNombre || fila.nombre || 'Evento cooperativo').trim();
        if (otro?.id) {
            io.to(otro.id).emit('coop:evento:invitacion', {
                prepId,
                invitadorNombre: usuario.nombre || usuario.email.split('@')[0],
                eventoNombre: nombreEv,
                dificultad: difNum,
                eventoId: idNum
            });
        } else {
            preparacionesCoopEvento.delete(prepId);
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Tu compañero no está conectado.' });
            return;
        }
        io.to(socket.id).emit('grupo:notificacion', { tipo: 'success', mensaje: 'Invitación enviada.' });
    });

    socket.on('coop:evento:invitacion:responder', ({ prepId, aceptada }) => {
        const prep = preparacionesCoopEvento.get(String(prepId || '').trim());
        if (!prep || prep.estado !== 'invitacion') {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Invitación no válida o caducada.' });
            return;
        }
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario || normalizarTexto(usuario.email) !== normalizarTexto(prep.inviteeEmail)) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'No puedes responder esta invitación.' });
            return;
        }
        if (!aceptada) {
            preparacionesCoopEvento.delete(prep.prepId);
            const inv = obtenerUsuarioConectadoPorEmail(prep.inviterEmail);
            if (inv?.id) {
                io.to(inv.id).emit('coop:evento:invitacion:rechazada', {});
            }
            return;
        }
        prep.estado = 'seleccion';
        const inviter = obtenerUsuarioConectadoPorEmail(prep.inviterEmail);
        const invitee = usuario;
        const nombreJugadorA = String(inviter?.nombre || prep.inviterEmail.split('@')[0] || 'Jugador').trim();
        const basePayload = {
            prepId: prep.prepId,
            eventoId: prep.eventoId,
            eventoNombre: prep.eventoNombre,
            dificultad: prep.dificultad,
            nombreJugadorA
        };
        if (inviter?.id) {
            io.to(inviter.id).emit('coop:evento:preparacion', { ...basePayload, rolCoop: 'A' });
        }
        io.to(socket.id).emit('coop:evento:preparacion', { ...basePayload, rolCoop: 'B' });
    });

    socket.on('coop:evento:preparacion:listo', async ({ prepId, indicesCartas, skinsPorIndice }) => {
        const prepIdNorm = String(prepId || '').trim();
        const prep = preparacionesCoopEvento.get(prepIdNorm);
        if (!prep || prep.estado !== 'seleccion') {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Preparación no activa.' });
            return;
        }
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        if (!usuario) return;
        const esA = normalizarTexto(usuario.email) === normalizarTexto(prep.inviterEmail);
        const esB = normalizarTexto(usuario.email) === normalizarTexto(prep.inviteeEmail);
        if (!esA && !esB) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'No perteneces a esta preparación.' });
            return;
        }
        let cartas = await extraerCartasUsuarioPorIndicesCoop(usuario.email, indicesCartas);
        if (!cartas) {
            console.error(`[coop] preparacion:listo: cartas inválidas para ${usuario.email} (indices=${JSON.stringify(indicesCartas)})`);
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Debes elegir exactamente 6 cartas válidas de tu colección.' });
            return;
        }
        if (skinsPorIndice && typeof skinsPorIndice === 'object') {
            try {
                const mapaCatalogoCoop = mapaCatalogoPorNombreCoop();
                DCSkinsCartas.asegurarSkinsCargadosServidor(path.join, path.dirname);
                const indices = Array.isArray(indicesCartas) ? indicesCartas.map((n) => Number(n)) : [];
                cartas = cartas.map((carta, i) => {
                    const ix = indices[i];
                    const skinRaw = skinsPorIndice[ix] ?? skinsPorIndice[String(ix)];
                    if (skinRaw === undefined || skinRaw === null || skinRaw === '') {
                        return carta;
                    }
                    const skinId = Number(skinRaw);
                    if (!Number.isFinite(skinId)) {
                        return carta;
                    }
                    const parent = DCSkinsCartas.obtenerNombreParentCarta(carta);
                    const filaParent = mapaCatalogoCoop.get(normalizarTexto(parent)) || null;
                    return DCSkinsCartas.construirVistaCartaJugadorConSkin(carta, skinId, filaParent);
                });
            } catch (errSkinCoop) {
                console.warn('[coop] no se pudieron aplicar skins de selección:', errSkinCoop.message);
            }
        }
        if (esA && prep.listoA) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'info', mensaje: 'Ya enviaste tu selección de cartas.' });
            return;
        }
        if (esB && prep.listoB) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'info', mensaje: 'Ya enviaste tu selección de cartas.' });
            return;
        }
        if (esB && !prep.listoA) {
            io.to(socket.id).emit('grupo:notificacion', {
                tipo: 'warning',
                mensaje: 'Debes esperar a que tu compañero termine su selección de cartas.'
            });
            return;
        }
        if (esB && prep.cartasA && cartasBContienenClavesDeA(cartas, clavesCartasCoopParaBloqueo(prep.cartasA))) {
            io.to(socket.id).emit('grupo:notificacion', {
                tipo: 'error',
                mensaje: 'No puedes elegir cartas que ya haya seleccionado tu compañero (mismo nombre de carta).'
            });
            return;
        }
        if (esA) {
            prep.cartasA = cartas;
            prep.listoA = true;
        }
        if (esB) {
            prep.cartasB = cartas;
            prep.listoB = true;
        }
        const inviter = obtenerUsuarioConectadoPorEmail(prep.inviterEmail);
        const invitee = obtenerUsuarioConectadoPorEmail(prep.inviteeEmail);
        const clavesA = prep.cartasA ? clavesCartasCoopParaBloqueo(prep.cartasA) : [];
        const estadoPrep = {
            prepId: prep.prepId,
            listoA: Boolean(prep.listoA),
            listoB: Boolean(prep.listoB),
            clavesCartasA: clavesA
        };
        if (inviter?.id) io.to(inviter.id).emit('coop:evento:preparacion:estado', estadoPrep);
        if (invitee?.id) io.to(invitee.id).emit('coop:evento:preparacion:estado', estadoPrep);

        if (prep.listoA && prep.listoB) {
            console.log(`[coop] ambos jugadores listos en prep=${prep.prepId} eventoId=${prep.eventoId} dificultad=${prep.dificultad}; iniciando sesión coop`);
            let resultado;
            try {
                resultado = await iniciarSesionCoopEventoDesdePrep(prep);
            } catch (errInicio) {
                /**
                 * Sin este try/catch, una excepción dentro de
                 * `iniciarSesionCoopEventoDesdePrep` quedaba absorbida por el
                 * handler async y los clientes se quedaban "esperando" para
                 * siempre, sin recibir `multiplayer:coop:session:start` ni la
                 * notificación de error correspondiente.
                 */
                console.error('[coop] excepción al iniciar sesión coop:', errInicio);
                resultado = { ok: false, mensaje: `Error interno al iniciar la partida: ${errInicio?.message || errInicio}` };
            }
            preparacionesCoopEvento.delete(prep.prepId);
            if (!resultado || !resultado.ok) {
                const msg = (resultado && resultado.mensaje) || 'No se pudo iniciar la sesión cooperativa.';
                if (inviter?.id) io.to(inviter.id).emit('grupo:notificacion', { tipo: 'error', mensaje: msg });
                if (invitee?.id) io.to(invitee.id).emit('grupo:notificacion', { tipo: 'error', mensaje: msg });
            } else {
                console.log(`[coop] sesión coop iniciada correctamente para prep=${prep.prepId}`);
            }
        }
    });

    socket.on('multiplayer:coop:join', ({ sessionId }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        const sesion = sesionesCoopEventoActivas.get(String(sessionId || '').trim());
        if (!usuario || !sesion || sesion.finalizada) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'Sesión cooperativa inválida.' });
            return;
        }
        const emailNorm = normalizarTexto(usuario.email);
        const ok = emailNorm === normalizarTexto(sesion.emailLeader) || emailNorm === normalizarTexto(sesion.emailMember);
        if (!ok) {
            io.to(socket.id).emit('grupo:notificacion', { tipo: 'error', mensaje: 'No perteneces a esta sesión.' });
            return;
        }
        socket.join(obtenerRoomSesionCoop(sesion.sessionId));
        sesion.updatedAt = Date.now();
        if (sesion.snapshotEstado) {
            io.to(socket.id).emit('multiplayer:coop:estado', {
                sessionId: sesion.sessionId,
                revision: Number(sesion.revisionEstado || 0),
                snapshot: sesion.snapshotEstado
            });
        }
    });

    socket.on('multiplayer:coop:estado:solicitar', ({ sessionId }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        const sesion = sesionesCoopEventoActivas.get(String(sessionId || '').trim());
        if (!usuario || !sesion) return;
        const emailNorm = normalizarTexto(usuario.email);
        const ok = emailNorm === normalizarTexto(sesion.emailLeader) || emailNorm === normalizarTexto(sesion.emailMember);
        if (!ok) return;
        if (sesion.snapshotEstado) {
            io.to(socket.id).emit('multiplayer:coop:estado', {
                sessionId: sesion.sessionId,
                revision: Number(sesion.revisionEstado || 0),
                snapshot: sesion.snapshotEstado
            });
        }
    });

    socket.on('multiplayer:coop:estado', ({ sessionId, snapshot, baseRevision }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        const sesion = sesionesCoopEventoActivas.get(String(sessionId || '').trim());
        if (!usuario || !sesion || sesion.finalizada) return;
        const emailNorm = normalizarTexto(usuario.email);
        const miembro = emailNorm === normalizarTexto(sesion.emailLeader) || emailNorm === normalizarTexto(sesion.emailMember);
        if (!miembro) return;
        const esEjecutorBot = emailNorm === normalizarTexto(sesion.ejecutorBotEmail || sesion.emailLeader);
        const esLeader = emailNorm === normalizarTexto(sesion.emailLeader);
        const esMember = emailNorm === normalizarTexto(sesion.emailMember);
        /**
         * Validación de autoría por fase anterior (EVENTO_COOPERATIVO_ONLINE_ESPEC.md):
         * el emisor del snapshot debe ser el titular de la fase anterior del servidor
         * (P1→líder, P2→miembro, BOT→ejecutor). Cubre acciones dentro de la fase y el
         * cierre de fase (incluidos saltos legítimos hacia una fase no consecutiva
         * cuando el siguiente jugador no tiene cartas jugables).
         */
        const faseAnterior = sesion.snapshotEstado?.faseCoop || null;
        if (snapshot && typeof snapshot === 'object' && faseAnterior) {
            const autorValido = (
                (faseAnterior === 'P1' && esLeader)
                || (faseAnterior === 'P2' && esMember)
                || (faseAnterior === 'BOT' && esEjecutorBot)
            );
            if (!autorValido) {
                io.to(socket.id).emit('multiplayer:coop:resync-required', {
                    sessionId: sesion.sessionId,
                    revision: Number(sesion.revisionEstado || 0),
                    reason: 'fase_autor_invalido'
                });
                return;
            }
        } else if (snapshot && snapshot.faseCoop === 'BOT' && !esEjecutorBot) {
            return;
        }
        const revisionActual = Number(sesion.revisionEstado || 0);
        const revisionBase = Number(baseRevision);
        if (!Number.isInteger(revisionBase) || revisionBase !== revisionActual) {
            io.to(socket.id).emit('multiplayer:coop:resync-required', {
                sessionId: sesion.sessionId,
                revision: revisionActual
            });
            return;
        }
        if (!snapshot || typeof snapshot !== 'object') return;
        const tieneReplayVisual = Boolean(snapshot.coopReplayVisual);
        /**
         * Snapshot de broadcast: incluye `coopReplayVisual` para que el observador anime.
         * Snapshot persistido: se retira `coopReplayVisual` para que una reconexión futura
         * (estado:solicitar) no vuelva a repetir la animación del último turno.
         */
        const snapshotPersistido = { ...snapshot };
        if (Object.prototype.hasOwnProperty.call(snapshotPersistido, 'coopReplayVisual')) {
            delete snapshotPersistido.coopReplayVisual;
        }
        sesion.snapshotEstado = snapshotPersistido;
        sesion.revisionEstado = revisionActual + 1;
        sesion.updatedAt = Date.now();
        const roomCoop = obtenerRoomSesionCoop(sesion.sessionId);
        io.to(roomCoop).emit('multiplayer:coop:estado', {
            sessionId: sesion.sessionId,
            revision: sesion.revisionEstado,
            snapshot
        });
        io.to(roomCoop).emit('multiplayer:coop:debug', {
            sessionId: sesion.sessionId,
            revisionNuevo: sesion.revisionEstado,
            emitterEmail: usuario.email,
            fase: sesion.snapshotEstado?.faseCoop,
            tieneReplayVisual
        });
    });

    /**
     * Metadata explícita de una acción (ataque básico o habilidad) que acompaña al siguiente snapshot.
     * No es autoritativa: el servidor solo la retransmite para que el observador anime con certeza
     * sobre quién atacó / qué objetivo, sin inferir del diff (EVENTO_COOPERATIVO_ONLINE_ESPEC.md).
     */
    socket.on('multiplayer:coop:accion', ({ sessionId, accion, revisionNueva }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        const sesion = sesionesCoopEventoActivas.get(String(sessionId || '').trim());
        if (!usuario || !sesion || sesion.finalizada) return;
        const emailNorm = normalizarTexto(usuario.email);
        const miembro = emailNorm === normalizarTexto(sesion.emailLeader) || emailNorm === normalizarTexto(sesion.emailMember);
        if (!miembro) return;
        if (!accion || typeof accion !== 'object') return;
        const revisionNum = Number(revisionNueva);
        if (!Number.isInteger(revisionNum) || revisionNum <= 0) return;
        const roomCoop = obtenerRoomSesionCoop(sesion.sessionId);
        io.to(roomCoop).emit('multiplayer:coop:accion', {
            sessionId: sesion.sessionId,
            revision: revisionNum,
            actorEmail: usuario.email,
            accion
        });
    });

    socket.on('multiplayer:coop:resultado', ({ sessionId, ganaronJugadores, motivo }) => {
        const usuario = obtenerUsuarioConectadoPorSocketId(socket.id);
        const sesion = sesionesCoopEventoActivas.get(String(sessionId || '').trim());
        if (!usuario || !sesion || sesion.finalizada) return;
        const emailNorm = normalizarTexto(usuario.email);
        const miembro = emailNorm === normalizarTexto(sesion.emailLeader) || emailNorm === normalizarTexto(sesion.emailMember);
        if (!miembro) return;
        sesion.finalizada = true;
        sesion.resultado = {
            sessionId: sesion.sessionId,
            ganaronJugadores: Boolean(ganaronJugadores),
            motivo: String(motivo || 'fin_partida')
        };
        sesion.updatedAt = Date.now();
        io.to(obtenerRoomSesionCoop(sesion.sessionId)).emit('multiplayer:coop:resultado', sesion.resultado);
    });

    //-----------FUNCIONES SERVIDOR DE LA PARTIDA------------

    // Escuchar el evento unirseSala cuando el cliente se conecta a tablero.html
    socket.on('unirseSala', (idSala) => {
        if (!LEGACY_SOCKET_COMBATE_ACTIVO) return;
        // Unir al jugador a la sala
        socket.join(idSala);
        console.log(`Jugador ${socket.id} se unió a la sala ${idSala}`);

        // Emitir confirmación al cliente
        socket.emit('unidoSala');
    });

    socket.on('cargarCartasIniciales', ({ rol, mazoJugador, idSala }) => {
        if (!LEGACY_SOCKET_COMBATE_ACTIVO) return;
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
        if (!LEGACY_SOCKET_COMBATE_ACTIVO) return;
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
        if (!LEGACY_SOCKET_COMBATE_ACTIVO) return;
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
    
        // Aplicar daño sobre salud: el poder ofensivo no se modifica al recibir daño.
        const saludObjetivoActual = Math.max(
            0,
            Math.min(
                Number(cartasObjetivo[slotObjetivo].Salud ?? cartasObjetivo[slotObjetivo].salud ?? obtenerSaludMaxCarta(cartasObjetivo[slotObjetivo])),
                obtenerSaludMaxCarta(cartasObjetivo[slotObjetivo])
            )
        );
        const poderAtacante = Number(cartasAtacante[slotAtacante].Poder || 0);
        const saludRestanteObjetivo = Math.max(saludObjetivoActual - poderAtacante, 0);
        console.log(`Salud restante de la carta objetivo: ${saludRestanteObjetivo}`);
    
        if (saludRestanteObjetivo <= 0) {
            console.log(`Eliminando la carta objetivo: ${cartasObjetivo[slotObjetivo].Nombre}`);
            cartasObjetivo.splice(slotObjetivo, 1);
        } else {
            console.log(`Actualizando salud de la carta ${cartasObjetivo[slotObjetivo].Nombre} a ${saludRestanteObjetivo}`);
            cartasObjetivo[slotObjetivo].SaludMax = obtenerSaludMaxCarta(cartasObjetivo[slotObjetivo]);
            cartasObjetivo[slotObjetivo].Salud = saludRestanteObjetivo;
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
        if (!LEGACY_SOCKET_COMBATE_ACTIVO) return;
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
            const sesionPvp = obtenerSesionPvpPorEmail(jugador.email);
            if (sesionPvp?.socketByEmail) {
                delete sesionPvp.socketByEmail[jugador.email];
                if (!sesionPvp.finalizada) {
                    const keyPendiente = obtenerClaveDesconexionPvp(sesionPvp.sessionId, jugador.email);
                    const timer = setTimeout(() => {
                        pvpDesconexionesPendientes.delete(keyPendiente);
                        const sesionRef = sesionesPvpActivas.get(sesionPvp.sessionId);
                        if (!sesionRef || sesionRef.finalizada) return;
                        const socketActual = sesionRef.socketByEmail?.[jugador.email];
                        if (socketActual) return;
                        const desconectadoEsA = normalizarTexto(jugador.email) === normalizarTexto(sesionRef.emailA);
                        const ganadorEmail = desconectadoEsA ? sesionRef.emailB : sesionRef.emailA;
                        sesionRef.finalizada = true;
                        sesionRef.resultado = {
                            sessionId: sesionRef.sessionId,
                            ganadorEmail,
                            motivo: 'desconexion'
                        };
                        registrarTrazaPvp(sesionRef.sessionId, 'desconexion_timeout', {
                            desconectado: jugador.email,
                            ganadorEmail
                        });
                        io.to(obtenerRoomSesionPvp(sesionRef.sessionId)).emit('multiplayer:pvp:resultado', sesionRef.resultado);
                    }, PVP_RECONEXION_GRACIA_MS);
                    pvpDesconexionesPendientes.set(keyPendiente, timer);
                    registrarTrazaPvp(sesionPvp.sessionId, 'desconexion_programada', {
                        email: jugador.email,
                        graciaMs: PVP_RECONEXION_GRACIA_MS
                    });
                }
            }
            if (invitacionesGrupoPendientes.has(jugador.email)) {
                limpiarInvitacionPendienteTarget(
                    jugador.email,
                    'La invitación fue cancelada por desconexión.',
                    true
                );
            }
            if (invitacionesSalientesPendientes.has(jugador.email)) {
                const targetEmail = invitacionesSalientesPendientes.get(jugador.email);
                limpiarInvitacionPendienteTarget(
                    targetEmail,
                    'La invitación fue cancelada porque el emisor se desconectó.',
                    true
                );
            }
            const partyId = indiceGrupoPorEmail.get(jugador.email);
            if (partyId) {
                programarDisolucionGrupoPorDesconexion(partyId, jugador.email);
                const party = gruposActivos.get(partyId);
                if (party) {
                    const otroEmail = [party.leaderEmail, party.memberEmail]
                        .find(email => normalizarTexto(email) !== normalizarTexto(jugador.email));
                    const otro = obtenerUsuarioConectadoPorEmail(otroEmail);
                    if (otro) {
                        io.to(otro.id).emit('grupo:notificacion', {
                            tipo: 'warning',
                            mensaje: `${jugador.nombre} se desconectó. Esperando reconexión...`
                        });
                    }
                }
            }
            // Eliminar la partida si el jugador está en una
            if (LEGACY_SOCKET_COMBATE_ACTIVO) {
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
        }
        // Eliminar al jugador de la lista de usuarios conectados
        usuariosConectados = usuariosConectados.filter((u) => u.id !== socket.id);
        emitirJugadoresConectados();
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

function generarSyncTokenUsuario() {
    return `sync_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

function esEmailAdmin(email) {
    return String(email || '').trim().toLowerCase() === 'lorenzopablo93@gmail.com';
}

async function asegurarMetadataSyncUsuario(email, userData = {}) {
    const tokenActual = String(userData.syncToken || '').trim();
    const updatedAtActual = Number(userData.syncUpdatedAt || 0);
    if (tokenActual && Number.isFinite(updatedAtActual) && updatedAtActual > 0) {
        return userData;
    }
    const syncToken = tokenActual || generarSyncTokenUsuario();
    const syncUpdatedAt = Date.now();
    const docRef = doc(db, "users", email);
    await setDoc(docRef, { syncToken, syncUpdatedAt }, { merge: true });
    return { ...userData, syncToken, syncUpdatedAt };
}

/**
 * Evita perder progreso de misiones diarias/semanales si dos clientes o un guardado
 * intermedio envían distinto `windowId` o distinto avance en la misma ventana.
 * Misma ventana: por `uid` se toma max(progress) y claimed = OR lógico.
 * Ventana distinta: gana la ventana con id lexicográfico mayor (YYYY-MM-DD).
 */
function fusionarScopeMisionesServidor(scopeServidor, scopeCliente) {
    const a = scopeServidor && typeof scopeServidor === 'object' ? scopeServidor : { windowId: '', lista: [] };
    const b = scopeCliente && typeof scopeCliente === 'object' ? scopeCliente : { windowId: '', lista: [] };
    const wA = String(a.windowId || '');
    const wB = String(b.windowId || '');
    const listA = Array.isArray(a.lista) ? a.lista : [];
    const listB = Array.isArray(b.lista) ? b.lista : [];
    if (!wB && !wA) {
        return { windowId: '', lista: [] };
    }
    if (!wB) {
        return { windowId: wA, lista: listA.map((m) => ({ ...m })) };
    }
    if (!wA) {
        return { windowId: wB, lista: listB.map((m) => ({ ...m })) };
    }
    if (wA !== wB) {
        return wB > wA
            ? { windowId: wB, lista: listB.map((m) => ({ ...m })) }
            : { windowId: wA, lista: listA.map((m) => ({ ...m })) };
    }
    const byUid = new Map();
    listA.forEach((m) => {
        if (m && m.uid) {
            byUid.set(String(m.uid), { ...m });
        }
    });
    listB.forEach((m) => {
        if (!m || !m.uid) return;
        const uid = String(m.uid);
        const prev = byUid.get(uid);
        if (!prev) {
            byUid.set(uid, { ...m });
            return;
        }
        byUid.set(uid, {
            ...prev,
            ...m,
            progress: Math.max(Number(prev.progress || 0), Number(m.progress || 0)),
            claimed: Boolean(prev.claimed) || Boolean(m.claimed),
        });
    });
    return { windowId: wA, lista: Array.from(byUid.values()) };
}

function fusionarMisionesServidor(misionesServidor, misionesCliente) {
    const s = misionesServidor && typeof misionesServidor === 'object' ? misionesServidor : {};
    const c = misionesCliente && typeof misionesCliente === 'object' ? misionesCliente : {};
    return {
        version: String(c.version || s.version || 'v1'),
        diarias: fusionarScopeMisionesServidor(s.diarias, c.diarias),
        semanales: fusionarScopeMisionesServidor(s.semanales, c.semanales),
    };
}

async function guardarUsuarioConControlConcurrencia(email, usuarioPayload = {}) {
    const docRef = doc(db, "users", email);
    const docActual = await getDoc(docRef);
    const datosActuales = docActual.data() || {};
    const tokenServidor = String(datosActuales.syncToken || '').trim();
    const tokenCliente = String(usuarioPayload.syncToken || '').trim();

    if (tokenServidor && tokenCliente !== tokenServidor) {
        return {
            ok: false,
            conflict: true,
            usuario: datosActuales
        };
    }

    const usuario = (usuarioPayload && typeof usuarioPayload === 'object') ? { ...usuarioPayload } : {};
    if (!Array.isArray(usuario.cartas)) {
        usuario.cartas = datosActuales.cartas || [];
    }
    if (!Array.isArray(usuario.mazos)) {
        usuario.mazos = datosActuales.mazos || [];
    }
    if (!Array.isArray(usuario.skinsObtenidos)) {
        usuario.skinsObtenidos = Array.isArray(datosActuales.skinsObtenidos)
            ? datosActuales.skinsObtenidos
            : [];
    }
    const objsPrev = datosActuales.objetos && typeof datosActuales.objetos === 'object'
        ? datosActuales.objetos
        : {};
    const objsCli = usuario.objetos && typeof usuario.objetos === 'object'
        ? usuario.objetos
        : {};
    usuario.objetos = { ...objsPrev, ...objsCli };
    if (usuario.misiones && typeof usuario.misiones === 'object') {
        usuario.misiones = fusionarMisionesServidor(datosActuales.misiones || {}, usuario.misiones);
    } else if (datosActuales.misiones && typeof datosActuales.misiones === 'object') {
        usuario.misiones = datosActuales.misiones;
    }
    usuario.syncToken = generarSyncTokenUsuario();
    usuario.syncUpdatedAt = Date.now();

    await setDoc(docRef, { ...usuario }, { merge: true });
    return {
        ok: true,
        usuario
    };
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
            return cartas.map(carta =>
                inicializarSaludCarta({
                ...carta,
                Nivel: 1,
                Poder: parseInt(carta.Poder) || 0
                })
            );
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
            mazos: [],
            syncToken: generarSyncTokenUsuario(),
            syncUpdatedAt: Date.now()
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

        let userData = docSnap.data();
        const esCorrecta = await bcrypt.compare(contraseña, userData.contraseñaHash);

        if (esCorrecta) {
            userData = await asegurarMetadataSyncUsuario(email, userData);
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
            const userData = await asegurarMetadataSyncUsuario(email, docSnap.data());
            res.status(200).json({ usuario: userData });
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
        console.log("Actualizando documento en Firebase para el usuario con email:", email);
        console.log("Datos del usuario para actualizar:", usuario);
        const resultado = await guardarUsuarioConControlConcurrencia(email, usuario);
        if (!resultado.ok && resultado.conflict) {
            return res.status(409).json({
                mensaje: 'Conflicto de sincronización: tu sesión local está desactualizada. Recarga para continuar.',
                codigo: 'SYNC_CONFLICT',
                usuario: resultado.usuario
            });
        }

        // Log para confirmar que la actualización fue exitosa
        console.log("Datos del usuario actualizados correctamente en Firebase.");

        // Verificar datos después de la actualización
        const docRefUsuario = doc(db, "users", email);
        const updatedDoc = await getDoc(docRefUsuario);
        if (updatedDoc.exists()) {
            console.log("Datos actuales en Firebase después de la actualización:", updatedDoc.data());
        } else {
            console.log("El documento no existe después de la actualización.");
        }

        res.status(200).json({
            mensaje: 'Datos de usuario actualizados correctamente en Firebase.',
            usuario: resultado.usuario
        });
    } catch (error) {
        console.error("Error al actualizar los datos del usuario en Firebase:", error.message);
        res.status(500).json({ mensaje: 'Error al actualizar los datos del usuario en Firebase.' });
    }
});

app.post('/admin/users/list', async (req, res) => {
    const requesterEmail = String(req.body?.requesterEmail || '').trim().toLowerCase();
    if (!esEmailAdmin(requesterEmail)) {
        return res.status(403).json({ mensaje: 'Acceso denegado.' });
    }
    try {
        const snap = await getDocs(collection(db, "users"));
        const usuarios = [];
        snap.forEach((docSnap) => {
            const data = docSnap.data() || {};
            usuarios.push({
                email: docSnap.id,
                nickname: String(data.nickname || '').trim() || docSnap.id
            });
        });
        usuarios.sort((a, b) => a.email.localeCompare(b.email));
        return res.status(200).json({ usuarios });
    } catch (error) {
        console.error("Error al listar usuarios admin:", error.message);
        return res.status(500).json({ mensaje: 'No se pudo listar usuarios.' });
    }
});

app.post('/admin/user/get', async (req, res) => {
    const requesterEmail = String(req.body?.requesterEmail || '').trim().toLowerCase();
    const targetEmail = String(req.body?.targetEmail || '').trim().toLowerCase();
    if (!esEmailAdmin(requesterEmail)) {
        return res.status(403).json({ mensaje: 'Acceso denegado.' });
    }
    if (!targetEmail) {
        return res.status(400).json({ mensaje: 'targetEmail no proporcionado.' });
    }
    try {
        const docRef = doc(db, "users", targetEmail);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) {
            return res.status(404).json({ mensaje: 'Usuario no encontrado.' });
        }
        const usuario = await asegurarMetadataSyncUsuario(targetEmail, docSnap.data());
        return res.status(200).json({ usuario });
    } catch (error) {
        console.error("Error admin get usuario:", error.message);
        return res.status(500).json({ mensaje: 'No se pudo obtener el usuario.' });
    }
});

app.post('/admin/user/update', async (req, res) => {
    const requesterEmail = String(req.body?.requesterEmail || '').trim().toLowerCase();
    const targetEmail = String(req.body?.targetEmail || '').trim().toLowerCase();
    const usuario = req.body?.usuario;
    if (!esEmailAdmin(requesterEmail)) {
        return res.status(403).json({ mensaje: 'Acceso denegado.' });
    }
    if (!targetEmail || !usuario || typeof usuario !== 'object') {
        return res.status(400).json({ mensaje: 'Parámetros inválidos.' });
    }
    try {
        const resultado = await guardarUsuarioConControlConcurrencia(targetEmail, usuario);
        if (!resultado.ok && resultado.conflict) {
            return res.status(409).json({
                mensaje: 'El usuario fue actualizado desde otro cliente. Recarga y reintenta.',
                codigo: 'SYNC_CONFLICT',
                usuario: resultado.usuario
            });
        }
        return res.status(200).json({
            mensaje: 'Usuario actualizado correctamente.',
            usuario: resultado.usuario
        });
    } catch (error) {
        console.error("Error admin update usuario:", error.message);
        return res.status(500).json({ mensaje: 'No se pudo actualizar el usuario.' });
    }
});

// Inicia el servidor (0.0.0.0 para que Render y contenedores acepten tráfico externo)
const listenHost = process.env.HOST || '0.0.0.0';
server.listen(port, listenHost, () => {
    const base =
        process.env.RENDER_EXTERNAL_URL ||
        (listenHost === '0.0.0.0' ? `http://localhost:${port}` : `http://${listenHost}:${port}`);
    console.log(`Servidor escuchando en ${listenHost}:${port} — ${base}`);
    if (RENDER_KEEPALIVE_URL) {
        console.log(`Keepalive Render habilitado para sesiones PvP activas -> ${RENDER_KEEPALIVE_URL}/healthz`);
    } else {
        console.log('Keepalive Render desactivado: define RENDER_EXTERNAL_URL para activarlo.');
    }
});

setInterval(() => {
    actualizarSupervisorKeepAliveRender();
}, 30000);

actualizarSupervisorKeepAliveRender();
