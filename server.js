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

function disolverGrupoPorId(partyId, motivo = 'Grupo disuelto.') {
    const party = gruposActivos.get(partyId);
    if (!party) {
        return;
    }
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

function evaluarFormulaSkillPowerServidor(formulaRaw, contexto = {}) {
    const formula = String(formulaRaw || '').trim().toLowerCase();
    if (!formula) return null;
    const formulaSegura = formula
        .replace(/saludenemigo/g, String(Number(contexto.saludEnemigo || 0)))
        .replace(/\bsalud\b/g, String(Number(contexto.salud || 0)))
        .replace(/\bpoder\b/g, String(Number(contexto.poder || 0)))
        .replace(/,/g, '.')
        .replace(/\s+/g, '');
    if (!/^[0-9+\-*/().]+$/.test(formulaSegura)) {
        return null;
    }
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

function obtenerValorSkillServidor(carta, fallback = 0, contexto = {}) {
    const clase = normalizarClaseSkillServidor(carta);
    const poder = Math.max(0, Number(contexto?.poder ?? carta?.Poder ?? 0));
    const salud = Math.max(0, Number(contexto?.salud ?? carta?.Salud ?? carta?.SaludMax ?? poder));
    const saludEnemigo = Math.max(0, Number(contexto?.saludEnemigo ?? 0));
    if (clase === 'revive') return 1;
    if (clase === 'aoe') return Math.max(1, Math.floor(poder / 2));
    if (clase === 'tank') return Math.max(0, Math.round(salud * 2));
    if (clase === 'heal_debuff') {
        if (saludEnemigo > 0) return Math.max(1, Math.floor(saludEnemigo * 0.75));
        return fallback;
    }
    if (clase === 'extra_attack') return Math.max(1, Math.floor(poder));
    if (clase === 'bonus_debuff') return fallback;

    const raw = carta?.skill_power;
    const numeroDirecto = parsearNumeroSeguroServidor(raw);
    if (numeroDirecto !== null) return numeroDirecto;
    const formula = evaluarFormulaSkillPowerServidor(raw, { poder, salud, saludEnemigo });
    if (formula !== null) return formula;
    return Number(fallback || 0);
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
    let danio = poderDanioAtacante;
    let escudo = Math.max(0, Number(objetivo.escudoActual || 0));
    if (escudo > 0 && danio > 0) {
        const absorbido = Math.min(escudo, danio);
        escudo -= absorbido;
        danio -= absorbido;
    }
    const saludActual = obtenerSaludCartaServidor(objetivo);
    const saludAntesObjetivo = saludActual + escudo;
    const nuevaSalud = Math.max(0, saludActual - danio);
    objetivo.escudoActual = escudo;
    objetivo.Salud = nuevaSalud;
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
    if (nuevaSalud <= 0 && escudo <= 0) {
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
        const saludMaxAtacante = obtenerSaludMaxCarta(atacante);
        atacante.Salud = Math.min(saludMaxAtacante, saludAtacante + robo);
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
    // Las habilidades usan siempre su escala propia (skill_power por nivel),
    // sin mezclar buffs/debuffs de daño de combate.
    const poderBaseAtacante = Math.max(0, Number(obtenerPoderCartaServidor(atacante)));
    const valorSkill = Math.max(0, Number(obtenerValorSkillServidor(atacante, 0, {
        poder: poderBaseAtacante,
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
            const saludMax = obtenerSaludMaxCarta(carta);
            carta.Salud = Math.min(saludMax, saludAntes + Math.floor(valorSkill));
            if (carta.Salud > saludAntes) {
                huboCuracion = true;
            }
        });
        if (!huboCuracion) return { ok: false, reason: 'equipo_full_health' };
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
        const saludMax = obtenerSaludMaxCarta(objetivoHeal);
        objetivoHeal.Salud = Math.min(saludMax, saludAntes + Math.floor(valorSkill));
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
        const poderFuente = Math.max(1, poderBaseAtacante);
        const danioAoe = Math.max(1, Math.floor(valorSkill || (poderFuente / 2)));
        for (let i = 0; i < objetivos.length; i++) {
            const idx = objetivos[i];
            const objetivoAoe = mesaObjetivo[idx];
            if (!objetivoAoe) continue;
            let dano = danioAoe;
            let escudo = Math.max(0, Number(objetivoAoe.escudoActual || 0));
            if (escudo > 0) {
                const absorbido = Math.min(escudo, dano);
                escudo -= absorbido;
                dano -= absorbido;
            }
            const saludAntes = obtenerSaludCartaServidor(objetivoAoe);
            const saludDespues = Math.max(0, saludAntes - dano);
            objetivoAoe.escudoActual = escudo;
            objetivoAoe.Salud = saludDespues;
            if (saludDespues <= 0 && escudo <= 0) {
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

function aplicarDotInicioTurnoServidor(cartas = []) {
    (Array.isArray(cartas) ? cartas : []).forEach((carta, index, arr) => {
        if (!carta) return;
        const dots = Array.isArray(carta.efectosDot) ? carta.efectosDot : [];
        if (dots.length === 0) {
            carta.efectosDot = [];
            return;
        }
        let salud = obtenerSaludCartaServidor(carta);
        let escudo = Math.max(0, Number(carta.escudoActual || 0));
        dots.forEach(dot => {
            let dano = Math.max(0, Number(dot?.danoPorTurno || 0));
            if (dano <= 0) return;
            if (escudo > 0) {
                const absorbido = Math.min(escudo, dano);
                escudo -= absorbido;
                dano -= absorbido;
            }
            if (dano > 0) {
                salud = Math.max(0, salud - dano);
            }
        });
        carta.escudoActual = escudo;
        carta.Salud = salud;
        carta.efectosDot = dots
            .map(dot => ({
                danoPorTurno: Math.max(0, Number(dot?.danoPorTurno || 0)),
                turnosRestantes: Math.max(0, Number(dot?.turnosRestantes || 0) - 1),
                skillName: String(dot?.skillName || '').trim()
            }))
            .filter(dot => dot.turnosRestantes > 0 && dot.danoPorTurno > 0);
        if ((salud + escudo) <= 0) {
            arr[index] = null;
        }
    });
}

function aplicarDotInicioTurnoServidorConCementerio(cartas = [], cementerio = []) {
    (Array.isArray(cartas) ? cartas : []).forEach((carta, index, arr) => {
        if (!carta) return;
        const dots = Array.isArray(carta.efectosDot) ? carta.efectosDot : [];
        if (dots.length === 0) {
            carta.efectosDot = [];
            return;
        }
        let salud = obtenerSaludCartaServidor(carta);
        let escudo = Math.max(0, Number(carta.escudoActual || 0));
        dots.forEach(dot => {
            let dano = Math.max(0, Number(dot?.danoPorTurno || 0));
            if (dano <= 0) return;
            if (escudo > 0) {
                const absorbido = Math.min(escudo, dano);
                escudo -= absorbido;
                dano -= absorbido;
            }
            if (dano > 0) {
                salud = Math.max(0, salud - dano);
            }
        });
        carta.escudoActual = escudo;
        carta.Salud = salud;
        carta.efectosDot = dots
            .map(dot => ({
                danoPorTurno: Math.max(0, Number(dot?.danoPorTurno || 0)),
                turnosRestantes: Math.max(0, Number(dot?.turnosRestantes || 0) - 1),
                skillName: String(dot?.skillName || '').trim()
            }))
            .filter(dot => dot.turnosRestantes > 0 && dot.danoPorTurno > 0);
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
                    snapshotEstado: null
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
            consumirStunFinTurnoServidor(mesaActual);
            reducirCooldownHabilidadesServidor(mesaSiguiente);
            aplicarDotInicioTurnoServidorConCementerio(mesaSiguiente, cementerioSiguiente);
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
