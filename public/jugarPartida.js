// Declarar las variables fuera del bloque para hacerlas accesibles en todo el código
let dificultadSeleccionada = null;
let mazoSeleccionado = null;
let usuarioTieneMazos = false;
let eventosActivos = [];
let eventoPendiente = null;
let dificultadEventoSeleccionada = null;
let usuarioCartasEvento = [];
let seleccionCartasEvento = new Set();
let faccionEventoActiva = 'H';
let afiliacionEventoActiva = 'todas';
let catalogoCartasCache = null;
let eventosEnRotacion = [];
let temporizadorRotacionEventos = null;
const ROTACION_EVENTOS_MS = 60 * 60 * 1000;
const VERSION_ROTACION_EVENTOS = 'event-rotation-v1';
const OBJETIVO_SINERGIA_POR_DIFICULTAD = {
    1: 4,
    2: 5,
    3: 6,
    4: 8,
    5: 10,
    6: 12
};
const ICONO_MEJORA = '/resources/icons/mejora.png';
const ICONO_MEJORA_ESPECIAL = '/resources/icons/mejora_especial.png';
const ICONO_MONEDA = '/resources/icons/moneda.png';
const ROTACION_CONSEJOS_MS = 9500;
let consejosCarrusel = [];
let consejoIndexActual = 0;
let timerConsejos = null;
let direccionAnimacionConsejos = 1;

function obtenerNombreVisibleUsuario() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const email = localStorage.getItem('email') || '';
    const nickname = String(usuario?.nickname || '').trim();
    if (nickname) {
        return nickname;
    }
    return email ? email.split('@')[0] : 'Jugador';
}

function obtenerAvatarVisibleUsuario() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const avatar = String(usuario?.avatar || '').trim();
    return avatar || 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';
}

function formatearHoraMensaje(payload = {}) {
    if (payload?.hora) {
        return String(payload.hora);
    }
    const timestamp = Number(payload?.timestamp || 0);
    if (!Number.isNaN(timestamp) && timestamp > 0) {
        return new Date(timestamp).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    }
    return new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function obtenerFechaMensaje(payload = {}) {
    const timestamp = Number(payload?.timestamp || 0);
    const fecha = (!Number.isNaN(timestamp) && timestamp > 0) ? new Date(timestamp) : new Date();
    const ahora = new Date();
    const hoyInicio = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
    const fechaInicio = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
    const diffMs = hoyInicio.getTime() - fechaInicio.getTime();
    const diffDias = Math.round(diffMs / (24 * 60 * 60 * 1000));

    let label = '';
    if (diffDias === 0) {
        label = 'Hoy';
    } else if (diffDias === 1) {
        label = 'Ayer';
    } else {
        label = fecha.toLocaleDateString('es-ES', {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    }

    return {
        key: `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`,
        label
    };
}

function insertarSeparadorFechaSiCorresponde(contenedor, payload = {}) {
    if (!contenedor) return;
    const { key, label } = obtenerFechaMensaje(payload);

    let ultimaFechaRenderizada = null;
    let cursor = contenedor.lastElementChild;
    while (cursor) {
        const keySeparador = cursor.dataset?.dateKey;
        if (keySeparador) {
            ultimaFechaRenderizada = keySeparador;
            break;
        }
        cursor = cursor.previousElementSibling;
    }

    if (ultimaFechaRenderizada === key) {
        return;
    }

    const separador = document.createElement('div');
    separador.className = 'chat-separador-fecha';
    separador.dataset.dateKey = key;
    separador.textContent = label;
    contenedor.appendChild(separador);
}

function verificarSeleccion() {
    const iniciarBtn = document.getElementById('iniciar-partida-btn');
    console.log('Verificación de selección - Dificultad:', dificultadSeleccionada, 'Mazo:', mazoSeleccionado);
    
    iniciarBtn.disabled = !(dificultadSeleccionada && mazoSeleccionado);
}

document.addEventListener('DOMContentLoaded', function () {
    verificarMazosUsuario();
    configurarChat();
    configurarJugadoresConectados();
    configurarModalEvento();
    cargarEventosActivos();
    configurarNotificacionesGrupo();
    void inicializarPanelConsejos();
    /* Recompensa diaria: solo cartas.js (DOMContentLoaded → procesarRecompensaDiariaGlobal).
       Evita doble modal al combinar con este mismo handler. */

    const dificultadBotones = document.querySelectorAll('.dificultad-btn');
    const selectMazo = document.getElementById('select-mazo');

    // Manejo de la selección de dificultad
    dificultadBotones.forEach(button => {
        button.addEventListener('click', function () {
            console.log('Dificultad seleccionada:', this.getAttribute('data-dificultad'));
            // Deseleccionar cualquier botón previamente seleccionado
            dificultadBotones.forEach(btn => btn.classList.remove('selected'));

            // Seleccionar el botón actual
            this.classList.add('selected');

            // Almacenar la dificultad seleccionada
            dificultadSeleccionada = parseInt(this.getAttribute('data-dificultad'));

            // Verificar si ambos (mazo y dificultad) están seleccionados para habilitar el botón de "Iniciar partida"
            verificarSeleccion();
        });
    });

    // Manejo de la selección de mazo
    selectMazo.addEventListener('change', function () {
        const selectedIndex = selectMazo.value; // Selecciona el índice del mazo
        const usuario = JSON.parse(localStorage.getItem('usuario')); // Obtiene el usuario del localStorage
        mazoSeleccionado = usuario.mazos[selectedIndex]; // Selecciona el mazo correcto
    
        console.log('Mazo seleccionado:', mazoSeleccionado); // Verificación del mazo
    
        // Guarda el mazo seleccionado en localStorage
        localStorage.setItem('mazoJugador', JSON.stringify({ Cartas: mazoSeleccionado.Cartas }));
        localStorage.setItem('mazoJugadorBase', JSON.stringify({ Cartas: mazoSeleccionado.Cartas }));
    
        // Verifica si tanto el mazo como la dificultad están seleccionados para habilitar el botón
        verificarSeleccion();
    });

    // Mostrar la ventana emergente al hacer clic en "Jugar"
    document.getElementById('jugar-btn').addEventListener('click', function () {
        console.log('Clic detectado en el botón Jugar');
        const modal = usuarioTieneMazos
            ? document.getElementById('configuracion-partida')
            : document.getElementById('aviso-sin-mazo-modal');
        if (modal) {
            console.log('Modal encontrado, intentando mostrar...');
            modal.style.display = 'block';
            console.log('Modal debería estar visible ahora.');
        } else {
            console.log('Modal no encontrado.');
        }
    });

    const cancelarPartidaBtn = document.getElementById('cancelar-partida-btn');
    if (cancelarPartidaBtn) {
        cancelarPartidaBtn.addEventListener('click', function () {
            const modal = document.getElementById('configuracion-partida');
            if (modal) {
                modal.style.display = 'none';
            }
        });
    }

    const irCrearMazosBtn = document.getElementById('ir-crear-mazos-btn');
    if (irCrearMazosBtn) {
        irCrearMazosBtn.addEventListener('click', function () {
            window.location.href = 'crearMazos.html';
        });
    }

    const cancelarSinMazoBtn = document.getElementById('cancelar-sin-mazo-btn');
    if (cancelarSinMazoBtn) {
        cancelarSinMazoBtn.addEventListener('click', function () {
            const modal = document.getElementById('aviso-sin-mazo-modal');
            if (modal) {
                modal.style.display = 'none';
            }
        });
    }

    document.getElementById('iniciar-partida-btn').addEventListener('click', function () {
        console.log('Botón de iniciar partida clicado');
        console.log('Dificultad seleccionada:', dificultadSeleccionada);
        console.log('Mazo seleccionado:', mazoSeleccionado);
    
        if (!dificultadSeleccionada || !mazoSeleccionado) {
            console.log('Faltan selecciones, no se puede iniciar la partida');
            return;  // Verificar si se seleccionaron ambos
        }

        // 🔥 LIMPIAR MODO DESAFÍO
        localStorage.removeItem('desafioActivo');

        const mazoJugador = JSON.parse(localStorage.getItem('mazoJugador')).Cartas;
        console.log('Mazo jugador:', mazoJugador);

        // Generar el mazo del oponente
        console.log('Iniciando fetch de cartas...');
        fetch('resources/cartas.xlsx')
        .then(response => response.arrayBuffer())
        .then(data => {
            console.log('Fetch exitoso');
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0]; // Asegúrate de que existe una hoja en el archivo
            const sheet = workbook.Sheets[sheetName];
            if (sheet) {
                const cartas = XLSX.utils.sheet_to_json(sheet);
                console.log('Cartas extraídas:', cartas);

                // Seleccionar 12 cartas para el oponente con sinergia de afiliación por dificultad
                let mazoOponente = generarMazoBotConSinergia(cartas, dificultadSeleccionada);
                if (!Array.isArray(mazoOponente) || mazoOponente.length !== 12) {
                    console.error('No se pudo construir un mazo BOT válido de 12 cartas para una sola facción.');
                    return;
                }

                // Ajustar siempre nivel/poder al nivel de dificultad seleccionado
                mazoOponente = mazoOponente.map(carta => {
                    const nivelBase = Number(carta.Nivel || 1);
                    const incrementoNiveles = Math.max(dificultadSeleccionada - nivelBase, 0);
                    const saludBase = Number((carta.SaludMax ?? carta.saludMax ?? carta.Salud ?? carta.salud ?? carta.Poder) || 0);
                    const saludEscalada = saludBase + (incrementoNiveles * 500);
                    const cartaEscalada = {
                        ...carta,
                        Nivel: dificultadSeleccionada,
                        Poder: Number(carta.Poder || 0) + (incrementoNiveles * 500),
                        SaludMax: saludEscalada,
                        Salud: saludEscalada
                    };
                    if (typeof window.recalcularSkillPowerPorNivel === 'function') {
                        window.recalcularSkillPowerPorNivel(cartaEscalada, dificultadSeleccionada, { rawEsBase: true });
                    }
                    return cartaEscalada;
                });

                // Guardar el mazo del oponente en localStorage con la misma estructura que el mazoJugador
                localStorage.setItem('mazoOponente', JSON.stringify({ Cartas: mazoOponente }));
                localStorage.setItem('mazoOponenteBase', JSON.stringify({ Cartas: mazoOponente }));
                localStorage.setItem('dificultad', dificultadSeleccionada);

                limpiarEstadoPvpAntesDePartidaVsBot();
                // Redirigir a tablero.html
                console.log('Redirigiendo a tablero.html...');
                window.location.href = 'tablero.html';
            } else {
                console.error('No se pudo encontrar una hoja en el archivo Excel');
            }
        })
        .catch(error => {
            console.error('Error al hacer fetch de cartas:', error);
        });
    });
});

async function cargarConsejosDesdeExcel() {
    if (typeof XLSX === 'undefined') {
        return [];
    }
    const response = await fetch('resources/consejos.xlsx');
    if (!response.ok) {
        return [];
    }
    const data = await response.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    return filas
        .map((fila, index) => ({
            id: index + 1,
            nombre: String(fila.nombre || fila.titulo || fila.Nombre || `Consejo ${index + 1}`).trim(),
            descripcion: String(fila.descripcion || fila.Descripcion || '').trim()
        }))
        .filter((c) => c.nombre && c.descripcion);
}

function escaparHTMLConsejos(texto) {
    return String(texto || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatearDescripcionConsejo(texto) {
    const textoEscapado = escaparHTMLConsejos(texto);
    return textoEscapado.replace(/\$([^$]+)\$/g, '<span class="consejos-highlight">$1</span>');
}

function aplicarContenidoConsejo(item) {
    const tituloEl = document.getElementById('consejos-titulo');
    const descEl = document.getElementById('consejos-descripcion');
    if (!tituloEl || !descEl) {
        return;
    }
    tituloEl.textContent = item?.nombre || '';
    descEl.innerHTML = formatearDescripcionConsejo(item?.descripcion || '');
}

function animarTransicionConsejo(item, direccion = 1) {
    const slideEl = document.getElementById('consejos-slide');
    if (!slideEl) {
        aplicarContenidoConsejo(item);
        return;
    }
    const claseSalida = direccion >= 0 ? 'anim-out-left' : 'anim-out-right';
    const claseEntrada = direccion >= 0 ? 'anim-in-right' : 'anim-in-left';
    slideEl.classList.remove('anim-out-left', 'anim-out-right', 'anim-in-left', 'anim-in-right');
    slideEl.classList.add(claseSalida);
    setTimeout(() => {
        aplicarContenidoConsejo(item);
        slideEl.classList.remove(claseSalida);
        slideEl.classList.add(claseEntrada);
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                slideEl.classList.remove('anim-in-left', 'anim-in-right');
            });
        });
    }, 160);
}

function renderConsejoActual({ animar = false } = {}) {
    const tituloEl = document.getElementById('consejos-titulo');
    const descEl = document.getElementById('consejos-descripcion');
    const dotsEl = document.getElementById('consejos-dots');
    if (!tituloEl || !descEl || !dotsEl) {
        return;
    }
    if (!Array.isArray(consejosCarrusel) || consejosCarrusel.length === 0) {
        tituloEl.textContent = 'Sin consejos';
        descEl.textContent = 'No se pudieron cargar consejos en este momento.';
        dotsEl.innerHTML = '';
        return;
    }
    const item = consejosCarrusel[consejoIndexActual] || consejosCarrusel[0];
    if (animar) {
        animarTransicionConsejo(item, direccionAnimacionConsejos);
    } else {
        aplicarContenidoConsejo(item);
    }
    dotsEl.innerHTML = '';
    consejosCarrusel.forEach((_, idx) => {
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = `consejos-dot ${idx === consejoIndexActual ? 'active' : ''}`;
        dot.setAttribute('aria-label', `Ir al consejo ${idx + 1}`);
        dot.addEventListener('click', () => {
            direccionAnimacionConsejos = idx >= consejoIndexActual ? 1 : -1;
            consejoIndexActual = idx;
            renderConsejoActual({ animar: true });
            reiniciarTimerConsejos();
        });
        dotsEl.appendChild(dot);
    });
}

function avanzarConsejo(delta) {
    if (!Array.isArray(consejosCarrusel) || consejosCarrusel.length === 0) {
        return;
    }
    direccionAnimacionConsejos = delta >= 0 ? 1 : -1;
    const total = consejosCarrusel.length;
    consejoIndexActual = (consejoIndexActual + delta + total) % total;
    renderConsejoActual({ animar: true });
}

function reiniciarTimerConsejos() {
    if (timerConsejos) {
        clearInterval(timerConsejos);
    }
    if (!Array.isArray(consejosCarrusel) || consejosCarrusel.length <= 1) {
        return;
    }
    timerConsejos = setInterval(() => {
        avanzarConsejo(1);
    }, ROTACION_CONSEJOS_MS);
}

async function inicializarPanelConsejos() {
    const prevBtn = document.getElementById('consejos-prev');
    const nextBtn = document.getElementById('consejos-next');
    if (!prevBtn || !nextBtn) {
        return;
    }
    try {
        consejosCarrusel = await cargarConsejosDesdeExcel();
    } catch (error) {
        console.error('Error cargando consejos:', error);
        consejosCarrusel = [];
    }
    consejoIndexActual = 0;
    direccionAnimacionConsejos = 1;
    renderConsejoActual({ animar: false });
    prevBtn.onclick = () => {
        avanzarConsejo(-1);
        reiniciarTimerConsejos();
    };
    nextBtn.onclick = () => {
        avanzarConsejo(1);
        reiniciarTimerConsejos();
    };
    reiniciarTimerConsejos();
}

function configurarNotificacionesGrupo() {
    window.addEventListener('dc:grupo-notificacion', (event) => {
        const payload = event?.detail || {};
        const mensaje = String(payload?.mensaje || '').trim();
        if (!mensaje) return;
        const tipoRaw = String(payload?.tipo || 'info').toLowerCase();
        const tipo = tipoRaw === 'error' ? 'danger'
            : (tipoRaw === 'success' ? 'success' : 'warning');
        mostrarMensajeJugadores(mensaje, tipo);
    });
}

function mostrarMensajeJugadores(mensaje, tipo = 'warning') {
    const el = document.getElementById('mensaje-jugadores');
    if (!el) return;
    el.textContent = mensaje;
    el.className = `alert alert-${tipo}`;
    el.style.display = 'block';
    setTimeout(() => {
        el.style.display = 'none';
    }, 2800);
}

function normalizarNombre(nombre) {
    return String(nombre || '').trim().toLowerCase();
}

function seleccionarCartasAleatorias(cartas, cantidad) {
    const cartasAleatorias = [];
    while (cartasAleatorias.length < cantidad) {
        const carta = cartas[Math.floor(Math.random() * cartas.length)];
        if (!cartasAleatorias.includes(carta)) {
            cartasAleatorias.push(carta);
        }
    }
    return cartasAleatorias;
}

function normalizarFaccion(valor) {
    const faccionRaw = String(valor || '').trim().toUpperCase();
    return faccionRaw === 'H' || faccionRaw === 'V' ? faccionRaw : '';
}

function normalizarAfiliacion(valor) {
    return String(valor || '').trim().toLowerCase();
}

function obtenerAfiliacionesCarta(carta) {
    const afiliacionRaw = String(carta?.Afiliacion || carta?.afiliacion || '');
    if (!afiliacionRaw.trim()) {
        return [];
    }

    return afiliacionRaw
        .split(';')
        .map(item => item.trim())
        .filter(Boolean)
        .map(normalizarAfiliacion);
}

function obtenerSaludMaxCarta(carta) {
    const saludMax = Number(carta?.SaludMax ?? carta?.salud_max ?? carta?.saludMax ?? carta?.Salud);
    if (Number.isFinite(saludMax) && saludMax > 0) {
        return saludMax;
    }
    const poder = Number(carta?.Poder ?? carta?.poder ?? 0);
    return Math.max(1, poder);
}

function obtenerSaludActualCarta(carta) {
    const saludMax = Math.max(obtenerSaludMaxCarta(carta), 1);
    const salud = Number(carta?.Salud ?? carta?.salud);
    const saludValida = Number.isFinite(salud) ? salud : saludMax;
    return Math.max(0, Math.min(saludValida, saludMax));
}

function crearBarraSaludElemento(carta) {
    const saludActual = obtenerSaludActualCarta(carta);
    const saludMax = Math.max(obtenerSaludMaxCarta(carta), 1);
    const porcentajeSalud = Math.max(0, Math.min((saludActual / saludMax) * 100, 100));
    const ratioSalud = porcentajeSalud / 100;

    const barraSaludContenedor = document.createElement('div');
    barraSaludContenedor.classList.add('barra-salud-contenedor');

    const barraSaludRelleno = document.createElement('div');
    barraSaludRelleno.classList.add('barra-salud-relleno');
    barraSaludRelleno.style.width = `${porcentajeSalud}%`;
    barraSaludRelleno.style.setProperty('--health-ratio', String(ratioSalud));

    const saludSpan = document.createElement('span');
    saludSpan.classList.add('salud-carta');
    saludSpan.textContent = `${saludActual}/${saludMax}`;

    barraSaludContenedor.appendChild(barraSaludRelleno);
    barraSaludContenedor.appendChild(saludSpan);
    return barraSaludContenedor;
}

async function obtenerCatalogoCartas() {
    if (catalogoCartasCache) {
        return catalogoCartasCache;
    }

    const response = await fetch('resources/cartas.xlsx');
    if (!response.ok) {
        throw new Error('No se pudo cargar el catálogo de cartas.');
    }

    const data = await response.arrayBuffer();
    const workbook = XLSX.read(data, { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    catalogoCartasCache = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    return catalogoCartasCache;
}

async function cargarEventosActivos() {
    try {
        const response = await fetch('resources/eventos.xlsx');
        if (!response.ok) {
            throw new Error('No se pudo cargar eventos.xlsx');
        }

        const data = await response.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const filas = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        eventosActivos = filas.map((fila, index) => mapearEventoDesdeFila(fila, index));
        iniciarTemporizadorRotacionEventos();
        await renderizarEventosActivos();
    } catch (error) {
        console.error('Error cargando eventos:', error);
        mostrarMensajeEventos('No se pudieron cargar los eventos activos.', 'danger');
    }
}

function obtenerVentanaRotacionEventos() {
    const ahora = Date.now();
    const idVentana = Math.floor(ahora / ROTACION_EVENTOS_MS);
    const inicio = idVentana * ROTACION_EVENTOS_MS;
    const fin = inicio + ROTACION_EVENTOS_MS;
    return { ahora, idVentana, inicio, fin };
}

/**
 * Siempre devuelve 4 entradas (salvo lista vacía): ventana circular sobre el catálogo.
 * Así el último tramo del Excel (p. ej. solo 2 eventos) se completa reenvolviendo al inicio (0,1…).
 */
function obtenerEventosRotacionActual() {
    if (!Array.isArray(eventosActivos) || eventosActivos.length === 0) {
        return [];
    }

    const { idVentana } = obtenerVentanaRotacionEventos();
    const tamanoLote = 4;
    const N = eventosActivos.length;
    const start = ((idVentana * tamanoLote) % N + N) % N;
    const salida = [];
    for (let i = 0; i < tamanoLote; i += 1) {
        salida.push(eventosActivos[(start + i) % N]);
    }
    return salida;
}

function obtenerClaveRotacionEventos() {
    const { idVentana } = obtenerVentanaRotacionEventos();
    return `${VERSION_ROTACION_EVENTOS}-${idVentana}`;
}

function actualizarUIRotacionEventos() {
    const timerValorEl = document.getElementById('eventos-rotacion-timer-valor');
    const barraEl = document.getElementById('eventos-rotacion-barra-progreso');
    if (!timerValorEl || !barraEl) {
        return;
    }

    const { ahora, inicio, fin } = obtenerVentanaRotacionEventos();
    const restante = fin - ahora;
    const transcurrido = ahora - inicio;
    const progreso = Math.min(100, Math.max(0, (transcurrido / ROTACION_EVENTOS_MS) * 100));
    timerValorEl.textContent = formatearTiempo(restante);
    barraEl.style.width = `${progreso}%`;
}

function iniciarTemporizadorRotacionEventos() {
    if (temporizadorRotacionEventos) {
        clearInterval(temporizadorRotacionEventos);
    }

    eventosEnRotacion = obtenerEventosRotacionActual();
    actualizarUIRotacionEventos();

    temporizadorRotacionEventos = setInterval(async () => {
        const idsPrevios = eventosEnRotacion.map(evento => evento.id).join(',');
        const nuevos = obtenerEventosRotacionActual();
        const idsNuevos = nuevos.map(evento => evento.id).join(',');
        eventosEnRotacion = nuevos;

        if (idsPrevios !== idsNuevos) {
            await renderizarEventosActivos();
        }

        actualizarUIRotacionEventos();
    }, 1000);
}

function formatearTiempo(msRestantes) {
    return typeof window.dcFormatearCuentaAtrasMs === 'function'
        ? window.dcFormatearCuentaAtrasMs(msRestantes)
        : '0s';
}

function mapearEventoDesdeFila(fila, fallbackIndex) {
    const enemigos = [];
    for (let i = 1; i <= 6; i++) {
        const nombreEnemigo = String(fila[`enemigo${i}`] || '').trim();
        if (nombreEnemigo) {
            enemigos.push(nombreEnemigo);
        }
    }

    if (enemigos.length === 0 && String(fila.enemigos || '').trim()) {
        String(fila.enemigos)
            .split(';')
            .map(item => item.trim())
            .filter(Boolean)
            .forEach(nombre => enemigos.push(nombre));
    }

    return {
        id: Number(fila.ID_evento ?? fila.id ?? fallbackIndex),
        nombre: String(fila.nombre || `Evento ${fallbackIndex + 1}`).trim(),
        descripcion: String(fila.Descripción || fila.descripcion || '').trim(),
        enemigos,
        boss: String(fila.boss ?? fila.Boss ?? fila.BOSS ?? '').trim() || null,
        puntos: Number(fila.puntos || 0),
        mejora: Number(fila.mejora || 0),
        mejora_especial: Number(fila.mejora_especial || 0),
        cartaRecompensa: String(fila.cartas || fila.carta || '').trim(),
        dificultadSeleccionada: null
    };
}

function mostrarMensajeEventos(mensaje, tipo = 'warning') {
    const el = document.getElementById('mensaje-eventos');
    if (!el) {
        return;
    }
    el.textContent = mensaje;
    el.className = `alert alert-${tipo}`;
    el.style.display = 'block';
}

async function renderizarEventosActivos() {
    const contenedor = document.getElementById('eventos-grid');
    if (!contenedor) {
        return;
    }

    contenedor.innerHTML = '';
    const catalogo = await obtenerCatalogoCartas();
    const mapaCatalogo = new Map(
        catalogo.map(carta => [normalizarNombre(carta.Nombre), carta])
    );

    const usuario = JSON.parse(localStorage.getItem('usuario')) || {};
    const claveRotacion = obtenerClaveRotacionEventos();
    const jugadosPorRotacion = (usuario.eventosJugadosPorRotacion && typeof usuario.eventosJugadosPorRotacion === 'object')
        ? usuario.eventosJugadosPorRotacion
        : {};
    const jugadosActual = new Set((jugadosPorRotacion[claveRotacion] || []).map(id => Number(id)));

    eventosEnRotacion.forEach(evento => {
        const card = document.createElement('div');
        const yaJugadoRotacion = jugadosActual.has(Number(evento.id));
        card.className = `evento-card ${yaJugadoRotacion ? 'completado' : 'pendiente'}`;

        const nombre = document.createElement('div');
        nombre.className = 'evento-nombre';
        nombre.textContent = evento.nombre;

        const descripcion = document.createElement('div');
        descripcion.className = 'evento-descripcion';
        descripcion.textContent = evento.descripcion || 'Sin descripción.';

        const enemigos = document.createElement('div');
        enemigos.className = 'evento-enemigos';
        const etiquetaEnemigos = document.createElement('div');
        etiquetaEnemigos.className = 'evento-enemigos-label';
        etiquetaEnemigos.textContent = 'Enemigos';

        const rivales = [
            ...(evento.enemigos || []).map(nombre => ({ nombre, boss: false })),
            ...(evento.boss ? [{ nombre: evento.boss, boss: true }] : [])
        ];

        rivales.forEach(rival => {
            const nombreEnemigo = rival.nombre;
            const cartaBase = mapaCatalogo.get(normalizarNombre(nombreEnemigo)) || { Nombre: nombreEnemigo, Nivel: 1 };
            const enemigoCard = document.createElement('div');
            enemigoCard.className = `evento-enemigo-card ${rival.boss ? 'boss' : ''}`;
            enemigoCard.style.backgroundImage = `url(${obtenerImagenCarta(cartaBase)})`;

            const etiqueta = document.createElement('div');
            etiqueta.className = 'evento-enemigo-nombre';
            etiqueta.textContent = nombreEnemigo;
            enemigoCard.appendChild(etiqueta);
            enemigos.appendChild(enemigoCard);
        });
        const recompensaLabel = document.createElement('div');
        recompensaLabel.className = 'evento-recompensas-label';
        recompensaLabel.textContent = 'Recompensas';

        const recompensas = document.createElement('div');
        recompensas.className = 'evento-recompensas';
        /** Carta de recompensa aleatoria (80 % enemigo / 20 % BOSS): mismo reverso que coop online. */
        const miniMisterio = document.createElement('div');
        miniMisterio.className = 'evento-recompensa-card evento-recompensa-carta-aleatoria';
        miniMisterio.setAttribute('title', 'Carta de recompensa aleatoria');
        miniMisterio.innerHTML = '<span class="evento-recompensa-carta-aleatoria-simbolo" aria-hidden="true">?</span>';
        recompensas.appendChild(miniMisterio);

        const puntosEvento = Math.max(0, Number(evento.puntos || 0));
        const metaPuntos = document.createElement('div');
        metaPuntos.className = 'evento-recompensa-tag';
        metaPuntos.innerHTML = `<img src="${ICONO_MONEDA}" alt="Moneda" style="width:28px;height:28px;object-fit:contain;"> <span>${puntosEvento}</span>`;
        recompensas.appendChild(metaPuntos);

        const cantidadMejoras = Math.max(0, Number(evento.mejora || 0));
        if (cantidadMejoras > 0) {
            const tagMejora = document.createElement('div');
            tagMejora.className = 'evento-recompensa-tag';
            tagMejora.innerHTML = `<img src="${ICONO_MEJORA}" alt="Mejora" style="width:28px;height:28px;object-fit:contain;"> <span>x${cantidadMejoras}</span>`;
            recompensas.appendChild(tagMejora);
        }
        const cantidadEspeciales = Math.max(0, Number(evento.mejora_especial || 0));
        if (cantidadEspeciales > 0) {
            const tagEspecial = document.createElement('div');
            tagEspecial.className = 'evento-recompensa-tag';
            tagEspecial.innerHTML = `<img src="${ICONO_MEJORA_ESPECIAL}" alt="Mejora especial" style="width:28px;height:28px;object-fit:contain;"> <span>x${cantidadEspeciales}</span>`;
            recompensas.appendChild(tagEspecial);
        }

        const contenedorDificultad = document.createElement('div');
        contenedorDificultad.className = 'evento-dificultad';
        const dificultadLabel = document.createElement('label');
        dificultadLabel.className = 'evento-dificultad-label';
        dificultadLabel.textContent = 'Dificultad';
        const selectDificultad = document.createElement('select');
        selectDificultad.className = 'evento-dificultad-select';
        const optionPlaceholder = document.createElement('option');
        optionPlaceholder.value = '';
        optionPlaceholder.textContent = 'Selecciona Dificultad';
        selectDificultad.appendChild(optionPlaceholder);
        for (let d = 1; d <= 6; d++) {
            const option = document.createElement('option');
            option.value = String(d);
            option.textContent = `${'★'.repeat(d)}  Nivel ${d}`;
            selectDificultad.appendChild(option);
        }
        selectDificultad.value = evento.dificultadSeleccionada ? String(Number(evento.dificultadSeleccionada)) : '';
        selectDificultad.addEventListener('change', () => {
            const valor = selectDificultad.value;
            seleccionarDificultadEvento(evento.id, valor ? Number(valor) : null);
        });
        contenedorDificultad.appendChild(dificultadLabel);
        contenedorDificultad.appendChild(selectDificultad);

        const botonIniciar = document.createElement('button');
        botonIniciar.className = `btn ${yaJugadoRotacion ? 'btn-success' : 'btn-primary'}`;
        botonIniciar.textContent = yaJugadoRotacion ? 'Ya jugado en esta rotación' : 'Empezar Evento';
        botonIniciar.disabled = yaJugadoRotacion;
        botonIniciar.addEventListener('click', async () => {
            await abrirModalSeleccionEvento(evento);
        });

        const bloqueInferior = document.createElement('div');
        bloqueInferior.className = 'evento-bottom';
        bloqueInferior.appendChild(recompensaLabel);
        bloqueInferior.appendChild(recompensas);
        bloqueInferior.appendChild(contenedorDificultad);
        bloqueInferior.appendChild(botonIniciar);

        card.appendChild(nombre);
        card.appendChild(descripcion);
        card.appendChild(etiquetaEnemigos);
        card.appendChild(enemigos);
        card.appendChild(bloqueInferior);
        contenedor.appendChild(card);
    });
}

function seleccionarDificultadEvento(eventoId, dificultad) {
    const evento = eventosActivos.find(item => item.id === eventoId);
    if (evento) {
        evento.dificultadSeleccionada = Number.isFinite(Number(dificultad)) && Number(dificultad) > 0
            ? Number(dificultad)
            : null;
    }
}

function mostrarModalSeleccionDificultadEvento() {
    const modal = document.createElement('div');
    modal.className = 'modal-dc';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-dc-content" style="max-width:520px;">
            <h4 style="margin-top:0;">Selecciona una dificultad</h4>
            <p style="margin-bottom:16px;">Debes elegir una dificultad antes de empezar el evento.</p>
            <div class="modal-dc-actions">
                <button type="button" class="btn btn-primary" id="cerrar-modal-dificultad-evento">Entendido</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const cerrar = () => {
        modal.remove();
    };
    modal.querySelector('#cerrar-modal-dificultad-evento')?.addEventListener('click', cerrar);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) {
            cerrar();
        }
    });
}

function configurarModalEvento() {
    const cancelarBtn = document.getElementById('cancelar-evento-btn');
    const confirmarBtn = document.getElementById('confirmar-evento-btn');
    const filtroAfi = document.getElementById('filtro-afiliacion-evento');
    const btnH = document.getElementById('filtro-evento-faccion-h');
    const btnV = document.getElementById('filtro-evento-faccion-v');

    if (!cancelarBtn || !confirmarBtn || !filtroAfi || !btnH || !btnV) {
        return;
    }

    cancelarBtn.onclick = cerrarModalSeleccionEvento;
    confirmarBtn.onclick = async () => {
        await confirmarSeleccionEvento();
    };
    filtroAfi.onchange = () => {
        afiliacionEventoActiva = normalizarAfiliacion(filtroAfi.value || 'todas');
        renderizarCartasSeleccionEvento();
    };

    btnH.onclick = () => {
        faccionEventoActiva = 'H';
        afiliacionEventoActiva = 'todas';
        actualizarBotonesFaccionEvento();
        renderizarFiltroAfiliacionEvento();
        renderizarCartasSeleccionEvento();
    };

    btnV.onclick = () => {
        faccionEventoActiva = 'V';
        afiliacionEventoActiva = 'todas';
        actualizarBotonesFaccionEvento();
        renderizarFiltroAfiliacionEvento();
        renderizarCartasSeleccionEvento();
    };
}

async function abrirModalSeleccionEvento(evento) {
    if (!evento?.dificultadSeleccionada) {
        mostrarModalSeleccionDificultadEvento();
        return;
    }

    const email = localStorage.getItem('email');
    const response = await fetch('/get-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
    });
    const data = await response.json();
    const usuario = data.usuario;
    if (typeof window.DCRecompensaDiaria?.aplicarRespaldoClaimLocalUsuario === 'function') {
        window.DCRecompensaDiaria.aplicarRespaldoClaimLocalUsuario(usuario);
    }
    localStorage.setItem('usuario', JSON.stringify(usuario));

    const claveRotacion = obtenerClaveRotacionEventos();
    const jugadosPorRotacion = (usuario.eventosJugadosPorRotacion && typeof usuario.eventosJugadosPorRotacion === 'object')
        ? usuario.eventosJugadosPorRotacion
        : {};
    const jugadosActual = new Set((jugadosPorRotacion[claveRotacion] || []).map(id => Number(id)));
    if (jugadosActual.has(Number(evento.id))) {
        mostrarMensajeEventos('Ya jugaste este evento en la rotación actual.', 'warning');
        await renderizarEventosActivos();
        return;
    }

    if (!usuario || !Array.isArray(usuario.cartas) || usuario.cartas.length < 6) {
        mostrarMensajeEventos('Necesitas al menos 6 cartas en tu colección para un evento.', 'warning');
        return;
    }

    const catalogo = await obtenerCatalogoCartas();
    const mapaFaccionAfiliacion = new Map();
    catalogo.forEach(carta => {
        mapaFaccionAfiliacion.set(normalizarNombre(carta.Nombre), {
            faccion: carta.faccion,
            Afiliacion: carta.Afiliacion || '',
            skill_name: String(carta.skill_name || '').trim(),
            skill_info: String(carta.skill_info || '').trim(),
            skill_class: String(carta.skill_class || '').trim().toLowerCase(),
            skill_power: carta.skill_power ?? '',
            skill_trigger: String(carta.skill_trigger || '').trim().toLowerCase()
        });
    });

    eventoPendiente = evento;
    dificultadEventoSeleccionada = evento.dificultadSeleccionada;
    const itemsEnriquecidos = usuario.cartas
        .map((carta, index) => {
            const datos = mapaFaccionAfiliacion.get(normalizarNombre(carta.Nombre));
            return {
                index,
                carta: {
                    ...carta,
                    faccion: carta.faccion || datos?.faccion || '',
                    Afiliacion: carta.Afiliacion || datos?.Afiliacion || '',
                    skill_name: String(carta.skill_name || '').trim() || datos?.skill_name || '',
                    skill_info: String(carta.skill_info || '').trim() || datos?.skill_info || '',
                    skill_class: String(carta.skill_class || '').trim().toLowerCase() || datos?.skill_class || '',
                    skill_power: carta.skill_power ?? datos?.skill_power ?? '',
                    skill_trigger: String(carta.skill_trigger || '').trim().toLowerCase() || datos?.skill_trigger || ''
                }
            };
        })
        .sort((a, b) => Number(b.carta.Poder || 0) - Number(a.carta.Poder || 0));

    usuarioCartasEvento = typeof window.deduplicarItemsCartasUsuarioMejorNivel === 'function'
        ? window.deduplicarItemsCartasUsuarioMejorNivel(itemsEnriquecidos)
        : itemsEnriquecidos;

    if (usuarioCartasEvento.length < 6) {
        mostrarMensajeEventos(
            'Necesitas al menos 6 cartas distintas por nombre en tu colección (se usa la de mayor nivel de cada una).',
            'warning'
        );
        return;
    }

    faccionEventoActiva = 'H';
    afiliacionEventoActiva = 'todas';
    seleccionCartasEvento = new Set();
    actualizarBotonesFaccionEvento();
    renderizarFiltroAfiliacionEvento();
    renderizarCartasSeleccionEvento();
    actualizarEstadoSeleccionEvento();
    document.getElementById('modal-seleccion-evento').style.display = 'flex';
}

function actualizarBotonesFaccionEvento() {
    document.getElementById('filtro-evento-faccion-h').classList.toggle('active', faccionEventoActiva === 'H');
    document.getElementById('filtro-evento-faccion-v').classList.toggle('active', faccionEventoActiva === 'V');
}

function renderizarFiltroAfiliacionEvento() {
    const filtro = document.getElementById('filtro-afiliacion-evento');
    const mapa = new Map();
    usuarioCartasEvento
        .filter(item => normalizarFaccion(item.carta.faccion) === faccionEventoActiva)
        .forEach(item => {
            obtenerAfiliacionesCarta(item.carta).forEach(afi => {
                const key = normalizarAfiliacion(afi);
                if (key && !mapa.has(key)) {
                    mapa.set(key, afi);
                }
            });
        });

    filtro.innerHTML = '';
    const optTodas = document.createElement('option');
    optTodas.value = 'todas';
    optTodas.textContent = 'Todas';
    filtro.appendChild(optTodas);

    Array.from(mapa.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .forEach(([, afi]) => {
            const option = document.createElement('option');
            option.value = afi;
            option.textContent = afi;
            filtro.appendChild(option);
        });

    filtro.value = 'todas';
}

function renderizarCartasSeleccionEvento() {
    const grid = document.getElementById('cartas-evento-grid');
    grid.innerHTML = '';

    const cartasFiltradas = usuarioCartasEvento
        .filter(item => normalizarFaccion(item.carta.faccion) === faccionEventoActiva)
        .filter(item => {
            if (afiliacionEventoActiva === 'todas') {
                return true;
            }
            const afiliaciones = obtenerAfiliacionesCarta(item.carta).map(normalizarAfiliacion);
            return afiliaciones.includes(afiliacionEventoActiva);
        });

    cartasFiltradas.forEach(item => {
        const carta = item.carta;
        const cartaDiv = document.createElement('div');
        cartaDiv.className = `carta-mini ${seleccionCartasEvento.has(item.index) ? 'seleccionada' : ''}`;
        if (Number(carta.Nivel || 1) >= 6) {
            cartaDiv.classList.add('nivel-legendaria');
        }
        cartaDiv.style.backgroundImage = `url(${obtenerImagenCarta(carta)})`;

        const estrellasDiv = document.createElement('div');
        estrellasDiv.className = 'estrellas-carta';
        const nivel = Number(carta.Nivel || 1);
        for (let i = 0; i < nivel; i++) {
            const estrella = document.createElement('img');
            estrella.className = 'estrella';
            estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
            estrella.alt = 'star';
            estrellasDiv.appendChild(estrella);
        }

        const detallesDiv = document.createElement('div');
        detallesDiv.className = 'detalles-carta';
        const nombre = document.createElement('span');
        nombre.className = 'nombre-carta';
        nombre.textContent = carta.Nombre;
        const poder = document.createElement('span');
        poder.className = 'poder-carta';
        poder.textContent = carta.Poder;
        detallesDiv.appendChild(nombre);
        detallesDiv.appendChild(poder);

        cartaDiv.appendChild(estrellasDiv);
        cartaDiv.appendChild(detallesDiv);
        const badgeHabilidad = window.crearBadgeHabilidadCarta ? window.crearBadgeHabilidadCarta(carta) : null;
        if (badgeHabilidad) {
            cartaDiv.appendChild(badgeHabilidad);
        }
        const badgeAfiliacion = window.crearBadgeAfiliacionCarta ? window.crearBadgeAfiliacionCarta(carta) : null;
        if (badgeAfiliacion) {
            cartaDiv.appendChild(badgeAfiliacion);
        }
        cartaDiv.appendChild(crearBarraSaludElemento(carta));
        cartaDiv.onclick = () => toggleSeleccionCartaEvento(item.index);
        grid.appendChild(cartaDiv);
    });
}

function toggleSeleccionCartaEvento(indexCarta) {
    if (seleccionCartasEvento.has(indexCarta)) {
        seleccionCartasEvento.delete(indexCarta);
    } else {
        if (seleccionCartasEvento.size >= 6) {
            mostrarMensajeEventos('Solo puedes seleccionar 6 cartas.', 'warning');
            return;
        }
        seleccionCartasEvento.add(indexCarta);
    }

    actualizarEstadoSeleccionEvento();
    renderizarCartasSeleccionEvento();
}

function actualizarEstadoSeleccionEvento() {
    const estado = document.getElementById('estado-seleccion-evento');
    const confirmarBtn = document.getElementById('confirmar-evento-btn');
    estado.textContent = `Seleccionadas: ${seleccionCartasEvento.size} / 6`;
    confirmarBtn.disabled = seleccionCartasEvento.size !== 6;
}

function cerrarModalSeleccionEvento() {
    document.getElementById('modal-seleccion-evento').style.display = 'none';
    eventoPendiente = null;
    seleccionCartasEvento = new Set();
}

function limpiarEstadoPvpAntesDePartidaVsBot() {
    if (typeof window.limpiarEstadoPvpResiduoPartidaLocal === 'function') {
        window.limpiarEstadoPvpResiduoPartidaLocal();
        return;
    }
    localStorage.removeItem('partidaModo');
    localStorage.removeItem('partidaPvpSessionId');
    localStorage.removeItem('partidaPvpRol');
    localStorage.removeItem('partidaPvpPrimerTurno');
    localStorage.removeItem('partidaPvpInicialesJugadorIdx');
    localStorage.removeItem('partidaPvpInicialesOponenteIdx');
    localStorage.removeItem('emailOponente');
    localStorage.removeItem('nombreOponente');
    localStorage.removeItem('avatarOponente');
}

async function confirmarSeleccionEvento() {
    if (!eventoPendiente || seleccionCartasEvento.size !== 6 || !dificultadEventoSeleccionada) {
        return;
    }

    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const cartasSeleccionadas = Array.from(seleccionCartasEvento).map(index => ({ ...usuario.cartas[index] }));
    const eventoParaPartida = {
        tipo: 'evento',
        id: eventoPendiente.id,
        nombre: eventoPendiente.nombre,
        descripcion: eventoPendiente.descripcion,
        dificultad: dificultadEventoSeleccionada,
        enemigos: eventoPendiente.enemigos || [],
        boss: eventoPendiente.boss || null,
        puntos: Number(eventoPendiente.puntos || 0),
        mejora: Number(eventoPendiente.mejora || 0),
        mejora_especial: Number(eventoPendiente.mejora_especial || 0),
        carta_recompensa: eventoPendiente.cartaRecompensa || '',
        rotacionClave: obtenerClaveRotacionEventos()
    };

    localStorage.setItem('desafioActivo', JSON.stringify(eventoParaPartida));
    localStorage.setItem('dificultad', String(dificultadEventoSeleccionada));
    localStorage.setItem('mazoJugador', JSON.stringify({ Cartas: cartasSeleccionadas }));
    localStorage.setItem('mazoJugadorBase', JSON.stringify({ Cartas: cartasSeleccionadas }));
    localStorage.removeItem('mazoOponente');
    localStorage.removeItem('mazoOponenteBase');
    limpiarEstadoPvpAntesDePartidaVsBot();
    window.location.href = 'tablero.html';
}

function mezclarArray(array) {
    const copia = [...array];
    for (let i = copia.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copia[i], copia[j]] = [copia[j], copia[i]];
    }
    return copia;
}

function obtenerObjetivoSinergiaPorDificultad(dificultad) {
    return OBJETIVO_SINERGIA_POR_DIFICULTAD[dificultad] || OBJETIVO_SINERGIA_POR_DIFICULTAD[1];
}

function construirPoolUnicoPorNombre(cartas) {
    const mapa = new Map();
    cartas.forEach(carta => {
        const nombre = String(carta?.Nombre || '').trim().toLowerCase();
        if (!nombre || mapa.has(nombre)) {
            return;
        }
        mapa.set(nombre, { ...carta });
    });
    return Array.from(mapa.values());
}

function escalarCartaANivel(carta, nivelObjetivo) {
    const nivelActual = Number(carta.Nivel || 1);
    const poderActual = Number(carta.Poder || 0);
    const poderBaseNivel1 = Math.max(0, poderActual - ((nivelActual - 1) * 500));
    const cartaEscalada = {
        ...carta,
        Nivel: nivelObjetivo,
        Poder: poderBaseNivel1 + ((nivelObjetivo - 1) * 500)
    };
    if (typeof window.recalcularSkillPowerPorNivel === 'function') {
        window.recalcularSkillPowerPorNivel(cartaEscalada, nivelObjetivo, { rawEsBase: true });
    }
    return cartaEscalada;
}

function generarMazoBotConSinergia(cartasDisponibles, dificultad) {
    const nivelObjetivo = Math.min(Math.max(Number(dificultad || 1), 1), 6);
    const poolHeroes = construirPoolUnicoPorNombre(cartasDisponibles.filter(c => normalizarFaccion(c?.faccion) === 'H'));
    const poolVillanos = construirPoolUnicoPorNombre(cartasDisponibles.filter(c => normalizarFaccion(c?.faccion) === 'V'));

    const faccionesElegibles = [];
    if (poolHeroes.length >= 12) {
        faccionesElegibles.push('H');
    }
    if (poolVillanos.length >= 12) {
        faccionesElegibles.push('V');
    }

    if (faccionesElegibles.length === 0) {
        return [];
    }

    const faccionObjetivo = faccionesElegibles[Math.floor(Math.random() * faccionesElegibles.length)];
    const pool = faccionObjetivo === 'H' ? poolHeroes : poolVillanos;
    const objetivoSinergia = Math.min(obtenerObjetivoSinergiaPorDificultad(nivelObjetivo), 12);
    const mazo = [];
    const nombresEnMazo = new Set();

    const mapaAfiliaciones = new Map();
    pool.forEach(carta => {
        const afiliaciones = new Set(obtenerAfiliacionesCarta(carta));
        afiliaciones.forEach(afiliacion => {
            if (!mapaAfiliaciones.has(afiliacion)) {
                mapaAfiliaciones.set(afiliacion, []);
            }
            mapaAfiliaciones.get(afiliacion).push(carta);
        });
    });

    const afiliacionesValidas = Array.from(mapaAfiliaciones.entries())
        .filter(([, cartas]) => cartas.length >= 2)
        .sort((a, b) => b[1].length - a[1].length);

    if (afiliacionesValidas.length > 0) {
        const [afiliacionObjetivo, cartasAfiliacion] = afiliacionesValidas[0];
        const cartasSinergia = mezclarArray(cartasAfiliacion).slice(0, objetivoSinergia);

        cartasSinergia.forEach(carta => {
            const clave = String(carta.Nombre).trim().toLowerCase();
            if (!nombresEnMazo.has(clave) && mazo.length < 12) {
                mazo.push(carta);
                nombresEnMazo.add(clave);
            }
        });

        if (mazo.length < 2) {
            const backup = mezclarArray(mapaAfiliaciones.get(afiliacionObjetivo) || []).slice(0, 2);
            backup.forEach(carta => {
                const clave = String(carta.Nombre).trim().toLowerCase();
                if (!nombresEnMazo.has(clave) && mazo.length < 12) {
                    mazo.push(carta);
                    nombresEnMazo.add(clave);
                }
            });
        }
    }

    const resto = mezclarArray(pool);
    for (const carta of resto) {
        if (mazo.length >= 12) {
            break;
        }
        const clave = String(carta.Nombre).trim().toLowerCase();
        if (nombresEnMazo.has(clave)) {
            continue;
        }
        mazo.push(carta);
        nombresEnMazo.add(clave);
    }

    return mazo.slice(0, 12).map(carta => escalarCartaANivel(carta, nivelObjetivo));
}

function verificarMazosUsuario() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const selectMazo = document.getElementById('select-mazo');
    const jugarBtn = document.getElementById('jugar-btn');

    // Limpiar cualquier opción anterior
    selectMazo.innerHTML = '';

    if (usuario && usuario.mazos && usuario.mazos.length > 0) {
        usuarioTieneMazos = true;
        console.log('Mazos del usuario:', usuario.mazos);
    
        usuario.mazos.forEach((mazo, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = mazo.Nombre;
            selectMazo.appendChild(option);
        });
    
        // Seleccionar el primer mazo por defecto
        mazoSeleccionado = usuario.mazos[0];
        localStorage.setItem('mazoJugador', JSON.stringify({ Cartas: mazoSeleccionado.Cartas }));
        localStorage.setItem('mazoJugadorBase', JSON.stringify({ Cartas: mazoSeleccionado.Cartas }));

        // Habilitar el botón "Jugar" porque ya hay mazos disponibles
        jugarBtn.disabled = false;
    
        // Habilitar el botón de iniciar partida si ya se seleccionaron mazo y dificultad
        verificarSeleccion();
    } else {
        usuarioTieneMazos = false;
        jugarBtn.disabled = false;
    }
}

//----------CHAT Y OTRAS FUNCIONALIDADES---------//

// Función para configurar el chat
function configurarChat() {
    const chatInput = document.getElementById('chat-input');
    const enviarBtn = document.getElementById('enviar-mensaje');
    const chatMensajes = document.getElementById('chat-mensajes');

    enviarBtn.addEventListener('click', function () {
        const mensaje = chatInput.value.trim();
        if (mensaje) {
            chatInput.value = '';
            enviarMensajeChat(mensaje);
        }
    });

    // Enviar mensaje al presionar Enter
    chatInput.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
            enviarBtn.click();
        }
    });
}

// Función para agregar mensajes al chat localmente
function agregarMensajeChat(payload, mensajeTexto) {
    const chatMensajes = document.getElementById('chat-mensajes');
    if (!chatMensajes) {
        return;
    }

    const payloadObj = (typeof payload === 'object' && payload !== null)
        ? payload
        : { usuario: payload, mensaje: mensajeTexto };

    const usuario = String(payloadObj.usuario || 'Jugador');
    const mensaje = String(payloadObj.mensaje || '');
    const hora = formatearHoraMensaje(payloadObj);
    const avatar = String(payloadObj.avatar || '').trim() || 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';

    insertarSeparadorFechaSiCorresponde(chatMensajes, payloadObj);

    const mensajeDiv = document.createElement('div');
    const cabeceraDiv = document.createElement('div');
    cabeceraDiv.className = 'chat-msg-header';

    const avatarImg = document.createElement('img');
    avatarImg.className = 'chat-msg-avatar';
    avatarImg.src = avatar;
    avatarImg.alt = `Avatar de ${usuario}`;
    avatarImg.loading = 'lazy';

    const nombreSpan = document.createElement('span');
    nombreSpan.className = 'nombre-usuario';
    nombreSpan.textContent = `${usuario}`;

    const horaSpan = document.createElement('span');
    horaSpan.className = 'chat-msg-hora';
    horaSpan.textContent = hora;

    const textoDiv = document.createElement('div');
    textoDiv.className = 'chat-msg-texto';
    textoDiv.textContent = mensaje;

    const nombreUsuario = obtenerNombreVisibleUsuario();
    if (usuario.trim().toLowerCase() === nombreUsuario.trim().toLowerCase()) {
        mensajeDiv.classList.add('mensaje-usuario'); // Clase para los mensajes del propio usuario
    } else {
        mensajeDiv.classList.add('mensaje-otro'); // Clase para los mensajes de otros usuarios
    }
    mensajeDiv.dataset.dateKey = obtenerFechaMensaje(payloadObj).key;

    cabeceraDiv.appendChild(avatarImg);
    cabeceraDiv.appendChild(nombreSpan);
    cabeceraDiv.appendChild(horaSpan);
    mensajeDiv.appendChild(cabeceraDiv);
    mensajeDiv.appendChild(textoDiv);
    chatMensajes.appendChild(mensajeDiv);

    // Autoscroll hacia abajo
    chatMensajes.scrollTop = chatMensajes.scrollHeight;
}

// Función para enviar mensajes al servidor mediante socket.io
function enviarMensajeChat(mensaje) {
    const nombreUsuario = obtenerNombreVisibleUsuario();
    const avatar = obtenerAvatarVisibleUsuario();
    
    if (typeof socket !== 'undefined') {
        socket.emit('mensajeChat', { usuario: nombreUsuario, mensaje, avatar }); // Enviar nombre + avatar + mensaje
    } else {
        console.error('Socket no está definido');
    }
}

// Configurar la lista de jugadores conectados
function configurarJugadoresConectados() {
    const listaJugadores = document.getElementById('lista-jugadores');
    const email = localStorage.getItem('email');
    const nombreUsuarioActual = obtenerNombreVisibleUsuario();

    if (typeof socket !== 'undefined') {
        window.addEventListener('dc:grupo-invitacion-en-curso', () => {
            socket.emit('solicitarRefrescoJugadoresConectados');
        });
        // Recibir actualización de la lista de jugadores conectados
        socket.on('jugadoresConectados', function (jugadores) {
            listaJugadores.innerHTML = '';
            const invitacionEnCurso = (() => {
                try {
                    const estado = JSON.parse(localStorage.getItem('grupoInvitacionEnCurso') || '{}');
                    const expiracion = Number(estado?.expiresAt || 0);
                    const expirada = Number.isFinite(expiracion) && expiracion > 0 && expiracion <= Date.now();
                    if (expirada) {
                        localStorage.setItem('grupoInvitacionEnCurso', JSON.stringify({
                            activa: false,
                            targetEmail: null,
                            expiresAt: null
                        }));
                        window.dispatchEvent(new Event('dc:grupo-invitacion-en-curso'));
                        return false;
                    }
                    return Boolean(estado?.activa);
                } catch (_error) {
                    return false;
                }
            })();

            const normalizados = (jugadores || []).map(jugador => {
                if (typeof jugador === 'string') {
                    return { email: '', nombre: jugador, enGrupo: false };
                }
                return {
                    email: String(jugador?.email || ''),
                    nombre: String(jugador?.nombre || '').trim() || String(jugador?.email || '').split('@')[0],
                    enGrupo: Boolean(jugador?.enGrupo)
                };
            });

            const otrosJugadores = normalizados.filter(jugador => {
                if (jugador.email && email) {
                    return jugador.email !== email;
                }
                return jugador.nombre !== nombreUsuarioActual;
            });

            otrosJugadores.forEach(jugador => {
                const jugadorItem = document.createElement('div');
                jugadorItem.classList.add('jugador-item');

                const nombreDiv = document.createElement('span');
                nombreDiv.textContent = jugador.nombre; // Mostrar nickname

                const botonInvitar = document.createElement('button');
                botonInvitar.textContent = invitacionEnCurso ? 'Invitación en curso' : 'Invitar a grupo';
                botonInvitar.classList.add('btn', 'btn-invitar');
                const invitacionDisponible = Boolean(jugador.email) && !jugador.enGrupo && !invitacionEnCurso;
                botonInvitar.disabled = !invitacionDisponible;
                if (!invitacionDisponible) {
                    botonInvitar.title = invitacionEnCurso
                        ? 'Ya tienes una invitación pendiente'
                        : (jugador.enGrupo
                        ? 'Este jugador ya está en un grupo'
                        : 'Jugador no disponible');
                }
                botonInvitar.addEventListener('click', function () {
                    if (typeof window.invitarAGrupo === 'function') {
                        window.invitarAGrupo(jugador.email);
                    }
                });

                jugadorItem.appendChild(nombreDiv);
                jugadorItem.appendChild(botonInvitar);
                listaJugadores.appendChild(jugadorItem);
            });
        });
    } else {
        console.error('Socket no está definido');
    }
}

function logout() {
    console.log('Cerrando sesión y limpiando localStorage...');
    localStorage.removeItem('usuario');
    localStorage.removeItem('email');
    localStorage.removeItem('grupoActual');
    localStorage.removeItem('grupoInvitacionEnCurso');
    localStorage.removeItem('jugandoPartida');
    localStorage.removeItem('mazoJugador');
    localStorage.removeItem('mazoOponente');
    window.location.href = '/login.html';
}
