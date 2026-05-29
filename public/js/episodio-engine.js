/**
 * DC Battle Cards — Motor de Episodios
 *
 * Gestiona el flujo lineal: cutscene → combate → recompensas.
 * Opera sobre el DOM del overlay definido en episodios.html.
 *
 * localStorage key utilizada: 'episodioActivo'
 * Estructura del estado:
 * {
 *   episodio_id, json_path, nombre,
 *   timeline_index: number,
 *   estado: 'activo' | 'combate',
 *   combate_resultado: null | 'victoria' | 'derrota',
 *   tablero: string (opcional, nombre de fondo en /resources/tableros/),
 *   capitulo_index: number,
 *   capitulo_id: string,
 *   completado: boolean (sesión; progreso persistente en dc_episodios_progreso_v1)
 * }
 */

(function () {
    'use strict';

    /* ──────────────────────────────────────────
       Constantes
    ────────────────────────────────────────── */
    const LS_KEY = 'episodioActivo';
    const BUSTOS_BASE = 'resources/episodios/bust/';
    const BACKGROUND_BASE = 'resources/episodios/background/';
    const TYPEWRITER_DELAY_MS = 22;
    const FADE_FONDO_DEFAULT_MS = 700;
    const BUSTO_FADE_MS = 380;

    /* ──────────────────────────────────────────
       Estado del engine
    ────────────────────────────────────────── */
    let episodioData = null;
    let capitulosEpisodio = [];
    let currentCapituloIndex = 0;
    let currentTimelineIndex = 0;
    let sceneCharacters = {};   // { id: { bust_image, side, visible, speaking } }
    let currentDialogos = [];
    let currentDialogoIndex = 0;
    let typewriterTimer = null;
    let typewriterCompleto = false;
    /** 'dialogos' = líneas del cutscene actual; 'timeline_escena' = paso type:escena suelto en timeline */
    let cutsceneModo = 'dialogos';
    let cutsceneBgImageActual = null;
    let cutsceneFondoNegro = false;
    let cutsceneAnimacionEnCurso = false;
    let cutsceneAutoAvanceTimer = null;
    let cutsceneAvanceGen = 0;

    /* ──────────────────────────────────────────
       Comandos de escena (visibilidad / posición de bustos)
    ────────────────────────────────────────── */
    function obtenerEscenaDesdeEvento(evento) {
        if (!evento || typeof evento !== 'object') return [];
        const lista = evento.escena ?? evento.escena_inicial ?? evento.personajes_iniciales;
        return Array.isArray(lista) ? lista : [];
    }

    /**
     * Normaliza side a un valor CSS horizontal coherente (p. ej. "5", 5 → "5%").
     */
    function normalizarSideBusto(side, fallback = '10%') {
        if (side === undefined || side === null || String(side).trim() === '') {
            const fb = String(fallback || '10%').trim();
            return fb || '10%';
        }
        if (typeof side === 'number' && Number.isFinite(side)) {
            return `${side}%`;
        }
        const raw = String(side).trim();
        if (/^\d+(\.\d+)?$/.test(raw)) {
            return `${raw}%`;
        }
        if (/^\d+(\.\d+)?(%|px|vw|vh)$/i.test(raw)) {
            return raw;
        }
        return raw;
    }

    function resolverSidePersonaje(upd, prev) {
        if (upd && upd.side !== undefined && upd.side !== null && String(upd.side).trim() !== '') {
            return normalizarSideBusto(upd.side);
        }
        if (prev && prev.side) {
            return normalizarSideBusto(prev.side);
        }
        return normalizarSideBusto('10%');
    }

    /** Ancla el centro horizontal del busto en el % indicado (escena y diálogo usan la misma regla). */
    function aplicarPosicionBustoDOM(wrap, side) {
        if (!wrap) return;
        const valor = normalizarSideBusto(side);
        wrap.style.left = valor;
        wrap.style.right = 'auto';
        wrap.dataset.side = valor;
    }

    function actualizarPersonajeEnEscena(id, upd, opciones = {}) {
        const { hablando = false } = opciones;
        const prev = sceneCharacters[id] || {};
        const existia = Object.prototype.hasOwnProperty.call(sceneCharacters, id);
        let visible;
        if (upd.visible !== undefined) {
            visible = upd.visible !== false;
        } else if (existia) {
            visible = prev.visible !== false;
        } else {
            visible = true;
        }

        sceneCharacters[id] = {
            bust_image: String(upd.bust_image || prev.bust_image || '').trim() || null,
            side: resolverSidePersonaje(upd, prev),
            visible,
            speaking: Boolean(hablando),
            nombre: String(upd.nombre || prev.nombre || id).trim(),
        };
    }

    function aplicarComandosEscena(comandos, opciones = {}) {
        const {
            hablanteId = null,
            sinHablante = false,
            ocultarAusentes = false,
        } = opciones;

        if (!Array.isArray(comandos) || !comandos.length) {
            if (sinHablante) {
                Object.keys(sceneCharacters).forEach((id) => {
                    sceneCharacters[id].speaking = false;
                });
            }
            return;
        }

        if (ocultarAusentes) {
            const idsPresentes = new Set(
                comandos.map((c) => String(c.id_character || '').trim()).filter(Boolean)
            );
            Object.keys(sceneCharacters).forEach((id) => {
                if (!idsPresentes.has(id)) {
                    sceneCharacters[id].visible = false;
                    sceneCharacters[id].speaking = false;
                }
            });
        }

        comandos.forEach((upd) => {
            const id = String(upd.id_character || '').trim();
            if (!id) return;
            actualizarPersonajeEnEscena(id, upd, { hablando: false });
        });

        if (hablanteId && sceneCharacters[hablanteId]) {
            sceneCharacters[hablanteId].speaking = true;
        }
        if (sinHablante || hablanteId) {
            Object.keys(sceneCharacters).forEach((id) => {
                if (id !== hablanteId) {
                    sceneCharacters[id].speaking = false;
                }
            });
        }
    }

    function esLineaComandoEscenaPuro(dialogo) {
        const cmd = String(dialogo?.comando || dialogo?.tipo || '').toLowerCase();
        if (cmd !== 'escena') return false;
        if (!Array.isArray(dialogo.escena) || !dialogo.escena.length) return false;
        return !String(dialogo.texto || '').trim();
    }

    function normalizarTokenComando(valor) {
        return String(valor || '').trim().toLowerCase().replace(/\s+/g, '_');
    }

    function esValorFondoNegro(valor) {
        const v = normalizarTokenComando(valor);
        return v === 'negro' || v === 'black' || v === 'fondo_negro' || v === '#000';
    }

    function obtenerTipoComandoFondo(dialogo) {
        const cmd = normalizarTokenComando(dialogo?.comando || dialogo?.tipo);
        if (!cmd) return null;
        if (cmd === 'fondo_negro' || cmd === 'negro') return 'fondo_negro';
        if (cmd === 'fundido_negro' || cmd === 'fade_negro' || cmd === 'fade_to_black') {
            return 'fundido_negro';
        }
        if (cmd === 'fundido_fondo' || cmd === 'fade_fondo' || cmd === 'fade_from_black'
            || cmd === 'revelar_fondo') {
            return 'fundido_fondo';
        }
        return null;
    }

    function esLineaComandoFondoPuro(dialogo) {
        const tipo = obtenerTipoComandoFondo(dialogo);
        if (!tipo) return false;
        return !String(dialogo.texto || '').trim();
    }

    function leerFlagAutoComando(linea) {
        if (!linea || typeof linea !== 'object' || !('auto' in linea)) {
            return null;
        }
        const v = linea.auto;
        if (v === true || v === 1) return true;
        if (v === false || v === 0) return false;
        const s = String(v).trim().toLowerCase();
        if (s === 'true' || s === '1' || s === 'si' || s === 'sí' || s === 'yes') return true;
        if (s === 'false' || s === '0' || s === 'no') return false;
        return null;
    }

    /** Comandos que admiten avance automático (por defecto sí, salvo `auto: false`). */
    function esComandoConAvanceAutoOpcional(linea) {
        if (!linea || typeof linea !== 'object') return false;
        if (String(linea.type || '').toLowerCase() === 'escena') return true;
        if (esLineaComandoEscenaPuro(linea)) return true;
        const tipoFondo = obtenerTipoComandoFondo(linea);
        return tipoFondo === 'fundido_negro' || tipoFondo === 'fundido_fondo';
    }

    function debeAvanzarAutomaticoComando(linea) {
        const flag = leerFlagAutoComando(linea);
        if (flag === false) return false;
        if (flag === true) return true;
        return esComandoConAvanceAutoOpcional(linea);
    }

    function cancelarAvanceAutomaticoCutscene() {
        cutsceneAvanceGen += 1;
        if (cutsceneAutoAvanceTimer) {
            clearTimeout(cutsceneAutoAvanceTimer);
            cutsceneAutoAvanceTimer = null;
        }
    }

    function programarAvanceAutomaticoCutscene(linea, delayExtraMs = 0) {
        cancelarAvanceAutomaticoCutscene();
        if (!debeAvanzarAutomaticoComando(linea)) {
            return;
        }
        const gen = cutsceneAvanceGen;
        const delay = Math.max(0, Number(delayExtraMs) || 0);
        cutsceneAutoAvanceTimer = setTimeout(() => {
            cutsceneAutoAvanceTimer = null;
            if (gen !== cutsceneAvanceGen) {
                return;
            }
            avanzarDialogoCutsceneAutomatico();
        }, delay);
    }

    function avanzarDialogoCutsceneAutomatico() {
        if (cutsceneAnimacionEnCurso) {
            return;
        }
        if (cutsceneModo === 'timeline_escena') {
            cutsceneModo = 'dialogos';
            avanzarTimeline();
            return;
        }
        if (!typewriterCompleto) {
            return;
        }
        currentDialogoIndex += 1;
        if (currentDialogoIndex < currentDialogos.length) {
            void renderizarDialogoAsync(currentDialogos[currentDialogoIndex]);
        } else {
            limpiarBustosDOM();
            avanzarTimeline();
        }
    }

    function duracionFadeDesdeLinea(linea) {
        const ms = Number(linea?.duracion ?? linea?.duration ?? linea?.duration_ms);
        return Number.isFinite(ms) && ms >= 0 ? ms : FADE_FONDO_DEFAULT_MS;
    }

    function elFadeCutscene() {
        return el('cutscene-fade');
    }

    function setOpacidadFade(valor, { animar = false, duracionMs = FADE_FONDO_DEFAULT_MS } = {}) {
        const fade = elFadeCutscene();
        if (!fade) return;
        if (animar) {
            fade.style.transition = `opacity ${duracionMs}ms ease`;
        } else {
            fade.style.transition = 'none';
        }
        fade.style.opacity = String(Math.max(0, Math.min(1, valor)));
        if (!animar) {
            void fade.offsetWidth;
            fade.style.transition = '';
        }
    }

    function resetCapaFade(instante = true) {
        setOpacidadFade(0, { animar: !instante });
    }

    function animarCapaFade(haciaOpacidad, duracionMs) {
        return new Promise((resolve) => {
            const fade = elFadeCutscene();
            if (!fade) {
                resolve();
                return;
            }
            const ms = Math.max(0, Number(duracionMs) || 0);
            if (ms === 0) {
                setOpacidadFade(haciaOpacidad, { animar: false });
                resolve();
                return;
            }
            const onEnd = () => {
                fade.removeEventListener('transitionend', onEnd);
                resolve();
            };
            fade.addEventListener('transitionend', onEnd);
            setOpacidadFade(haciaOpacidad, { animar: true, duracionMs: ms });
            setTimeout(() => {
                fade.removeEventListener('transitionend', onEnd);
                resolve();
            }, ms + 80);
        });
    }

    function aplicarFondoNegroInstante() {
        const bgEl = el('cutscene-bg');
        if (bgEl) {
            bgEl.style.backgroundImage = 'none';
            bgEl.classList.add('cutscene-bg--negro');
        }
        cutsceneBgImageActual = null;
        cutsceneFondoNegro = true;
    }

    function aplicarImagenFondoCutscene(nombreArchivo) {
        const bgEl = el('cutscene-bg');
        const archivo = String(nombreArchivo || '').trim();
        if (!bgEl || !archivo || esValorFondoNegro(archivo)) {
            aplicarFondoNegroInstante();
            return;
        }
        bgEl.classList.remove('cutscene-bg--negro');
        bgEl.style.backgroundImage = `url('${BACKGROUND_BASE}${archivo}')`;
        cutsceneBgImageActual = archivo;
        cutsceneFondoNegro = false;
    }

    function eventoUsaFondoNegroInicial(evento) {
        if (!evento || typeof evento !== 'object') return false;
        if (evento.fondo_negro === true || evento.fondoNegro === true) return true;
        if (esValorFondoNegro(evento.fondo_inicial)) return true;
        if (esValorFondoNegro(evento.background_image)) return true;
        return false;
    }

    async function ejecutarComandoFondo(linea) {
        const tipo = obtenerTipoComandoFondo(linea);
        if (!tipo) return;

        const duracion = duracionFadeDesdeLinea(linea);

        if (tipo === 'fondo_negro') {
            aplicarFondoNegroInstante();
            setOpacidadFade(0, { animar: false });
            return;
        }

        if (tipo === 'fundido_negro') {
            await animarCapaFade(1, duracion);
            aplicarFondoNegroInstante();
            return;
        }

        if (tipo === 'fundido_fondo') {
            const imagen = String(
                linea.background_image || linea.fondo || linea.imagen_fondo || cutsceneBgImageActual || ''
            ).trim();
            if (imagen && !esValorFondoNegro(imagen)) {
                aplicarImagenFondoCutscene(imagen);
            } else if (!cutsceneFondoNegro && cutsceneBgImageActual) {
                aplicarImagenFondoCutscene(cutsceneBgImageActual);
            }
            setOpacidadFade(1, { animar: false });
            await animarCapaFade(0, duracion);
        }
    }

    function esDialogoVozEnOff(dialogo) {
        if (!dialogo || typeof dialogo !== 'object') return false;
        if (dialogo.voz_en_off === true || dialogo.vozEnOff === true || dialogo.voiceover === true) {
            return true;
        }
        const tipo = normalizarTokenComando(dialogo.tipo);
        return tipo === 'voz_en_off' || tipo === 'voiceover';
    }

    /** Voz en off sin nombre en la caja superior (narrador anónimo). */
    function esVozEnOffSinPersonaje(dialogo) {
        if (!esDialogoVozEnOff(dialogo)) return false;
        if (dialogo.voz_en_off_sin_personaje === true
            || dialogo.vozEnOffSinPersonaje === true
            || dialogo.sin_personaje === true
            || dialogo.sin_nombre === true
            || dialogo.anonima === true) {
            return true;
        }
        const id = String(dialogo.id_character || '').trim();
        const nombre = String(dialogo.nombre || '').trim();
        return !id && !nombre;
    }

    function obtenerNombreDialogoCutscene(dialogo) {
        return String(dialogo?.nombre || dialogo?.id_character || '').trim();
    }

    function aplicarCajaNombreCutscene(dialogo) {
        const nameBox = document.querySelector('#episodio-cutscene .cutscene-name-box');
        const nameEl = el('cutscene-char-name');
        if (esVozEnOffSinPersonaje(dialogo)) {
            if (nameBox) nameBox.classList.add('cutscene-name-box--oculto');
            if (nameEl) nameEl.textContent = '';
            return;
        }
        if (nameBox) nameBox.classList.remove('cutscene-name-box--oculto');
        if (nameEl) {
            const nombre = obtenerNombreDialogoCutscene(dialogo);
            nameEl.textContent = nombre || '—';
        }
    }

    /** Convierte secuencias \\n del JSON y saltos reales en \n para mostrar con pre-line / <br>. */
    function normalizarTextoDialogo(texto) {
        return String(texto ?? '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .replace(/\\n/g, '\n');
    }

    const CLASE_COLOR_DIALOGO = {
        azul: 'cutscene-dialog-color--azul',
        rojo: 'cutscene-dialog-color--rojo',
        amarillo: 'cutscene-dialog-color--amarillo',
    };

    /**
     * Parsea #texto# (azul), $texto$ (rojo), %texto% (amarillo).
     * @returns {{ tipo: 'plain'|'azul'|'rojo'|'amarillo', texto: string }[]}
     */
    function parsearSegmentosTextoDialogo(texto) {
        const s = normalizarTextoDialogo(texto);
        if (!s) {
            return [];
        }
        const segmentos = [];
        const re = /#([^#]*)#|\$([^$]*)\$|%([^%]*)%/g;
        let lastIndex = 0;
        let match;
        while ((match = re.exec(s)) !== null) {
            if (match.index > lastIndex) {
                segmentos.push({ tipo: 'plain', texto: s.slice(lastIndex, match.index) });
            }
            if (match[1] !== undefined) {
                segmentos.push({ tipo: 'azul', texto: match[1] });
            } else if (match[2] !== undefined) {
                segmentos.push({ tipo: 'rojo', texto: match[2] });
            } else if (match[3] !== undefined) {
                segmentos.push({ tipo: 'amarillo', texto: match[3] });
            }
            lastIndex = re.lastIndex;
        }
        if (lastIndex < s.length) {
            segmentos.push({ tipo: 'plain', texto: s.slice(lastIndex) });
        }
        if (!segmentos.length) {
            segmentos.push({ tipo: 'plain', texto: s });
        }
        return segmentos;
    }

    function crearNodoSegmentoDialogo(seg, contenidoInicial = '') {
        if (seg.tipo === 'plain') {
            return { el: document.createTextNode(contenidoInicial), esTexto: true, seg };
        }
        const span = document.createElement('span');
        span.className = CLASE_COLOR_DIALOGO[seg.tipo] || '';
        span.textContent = contenidoInicial;
        return { el: span, esTexto: false, seg };
    }

    function renderizarSegmentosDialogoEn(contenedor, segmentos, completo = true) {
        if (!contenedor) {
            return [];
        }
        const nodos = [];
        segmentos.forEach((seg) => {
            const item = crearNodoSegmentoDialogo(seg, completo ? seg.texto : '');
            contenedor.appendChild(item.el);
            nodos.push(item);
        });
        return nodos;
    }

    function aplicarTextoPlanoDialogo(textEl, texto) {
        if (!textEl) return;
        textEl.classList.remove('cutscene-dialog-text--voz-en-off');
        textEl.replaceChildren();
        renderizarSegmentosDialogoEn(textEl, parsearSegmentosTextoDialogo(texto), true);
    }

    function aplicarTextoVozEnOffCompleto(textEl, texto) {
        if (!textEl) return;
        textEl.classList.add('cutscene-dialog-text--voz-en-off');
        textEl.replaceChildren();
        textEl.appendChild(document.createTextNode('*'));
        const strong = document.createElement('strong');
        strong.className = 'cutscene-dialog-voz-en-off';
        renderizarSegmentosDialogoEn(strong, parsearSegmentosTextoDialogo(texto), true);
        textEl.appendChild(strong);
        textEl.appendChild(document.createTextNode('*'));
    }

    let typewriterNodosActuales = null;
    let typewriterSegIdx = 0;
    let typewriterCharIdx = 0;

    function detenerTypewriter() {
        if (typewriterTimer) {
            clearTimeout(typewriterTimer);
            typewriterTimer = null;
        }
        typewriterNodosActuales = null;
        typewriterSegIdx = 0;
        typewriterCharIdx = 0;
    }

    function iniciarTypewriterEnContenedor(contenedor, segmentos) {
        detenerTypewriter();
        typewriterCompleto = false;
        contenedor.replaceChildren();
        typewriterNodosActuales = renderizarSegmentosDialogoEn(contenedor, segmentos, false);
        typewriterSegIdx = 0;
        typewriterCharIdx = 0;

        const step = () => {
            if (!typewriterNodosActuales || typewriterSegIdx >= typewriterNodosActuales.length) {
                typewriterTimer = null;
                typewriterNodosActuales = null;
                typewriterCompleto = true;
                return;
            }
            const item = typewriterNodosActuales[typewriterSegIdx];
            const textoSeg = item.seg.texto;
            if (typewriterCharIdx < textoSeg.length) {
                const frag = textoSeg[typewriterCharIdx];
                if (item.esTexto) {
                    item.el.textContent += frag;
                } else {
                    item.el.textContent += frag;
                }
                typewriterCharIdx += 1;
                typewriterTimer = setTimeout(step, TYPEWRITER_DELAY_MS);
                return;
            }
            typewriterSegIdx += 1;
            typewriterCharIdx = 0;
            typewriterTimer = setTimeout(step, TYPEWRITER_DELAY_MS);
        };
        typewriterTimer = setTimeout(step, TYPEWRITER_DELAY_MS);
    }

    function prepararUiLineaComandoPuro(dialogo) {
        const textEl = el('cutscene-dialog-text');
        aplicarCajaNombreCutscene(dialogo || {});
        if (textEl) {
            aplicarTextoPlanoDialogo(textEl, String(dialogo?.texto_aux || dialogo?.descripcion || '').trim());
        }
        typewriterCompleto = true;
        actualizarBotonSiguienteCutscene(currentDialogoIndex >= currentDialogos.length - 1);
    }

    function setBotonSiguienteHabilitado(habilitado) {
        const btnNext = el('cutscene-btn-next');
        if (btnNext) btnNext.disabled = !habilitado;
    }

    function actualizarBotonSiguienteCutscene(esUltimoEnSecuencia) {
        const btnNext = el('cutscene-btn-next');
        if (!btnNext) return;
        if (cutsceneModo === 'timeline_escena') {
            btnNext.textContent = '▶ Continuar';
            return;
        }
        btnNext.textContent = esUltimoEnSecuencia ? '✦ Continuar' : '▶ Siguiente';
    }

    /* ──────────────────────────────────────────
       Progreso (localStorage)
    ────────────────────────────────────────── */
    function guardarProgreso(data) {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify(data));
        } catch (_e) { /* noop */ }
    }

    function leerEstado() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return null;
            const obj = JSON.parse(raw);
            return obj && obj.json_path ? obj : null;
        } catch (_e) { return null; }
    }

    function limpiarEstado() {
        try { localStorage.removeItem(LS_KEY); } catch (_e) { /* noop */ }
    }

    /* ──────────────────────────────────────────
       Helpers DOM
    ────────────────────────────────────────── */
    function el(id) { return document.getElementById(id); }

    function mostrarPanel(activo) {
        const cutscenePanel = el('episodio-cutscene');
        const combatePanel  = el('episodio-previa-combate');
        const recompPanel   = el('episodio-recompensas');
        const pausaPanel    = el('episodio-pausa');
        const overlay       = el('episodio-overlay');

        if (overlay) overlay.style.display = 'flex';
        if (cutscenePanel) cutscenePanel.style.display = (activo === 'cutscene') ? 'flex' : 'none';
        if (combatePanel)  combatePanel.style.display  = (activo === 'combate')  ? 'flex' : 'none';
        if (recompPanel)   recompPanel.style.display   = (activo === 'recompensa') ? 'flex' : 'none';
        if (pausaPanel)    pausaPanel.style.display    = (activo === 'pausa')    ? 'flex' : 'none';
    }

    function mostrarErrorCarga(msg) {
        const msgEl = el('episodios-mensaje');
        if (msgEl) { msgEl.textContent = msg; msgEl.style.display = 'block'; }
    }

    /* ──────────────────────────────────────────
       INICIAR EPISODIO (desde botón Comenzar)
    ────────────────────────────────────────── */
    function validarCartasRequeridasEpisodio(data) {
        const req = window.DCEpisodiosRequisitos;
        if (!req || typeof req.extraerCartasJugadorRequeridas !== 'function') {
            return { cumple: true };
        }
        const requeridas = req.extraerCartasJugadorRequeridas(data);
        if (!requeridas.length) {
            return { cumple: true };
        }
        const usuario = typeof req.leerUsuarioLocal === 'function' ? req.leerUsuarioLocal() : null;
        const evaluacion = req.evaluarRequisitosCartasEpisodio(usuario, requeridas);
        if (evaluacion.cumple) {
            return { cumple: true };
        }
        return {
            cumple: false,
            mensaje: typeof req.mensajeFaltantes === 'function'
                ? req.mensajeFaltantes(evaluacion)
                : 'No tienes todas las cartas requeridas en tu colección.',
        };
    }

    function normalizarCapitulosDesdeDatos(data) {
        if (window.DCEpisodiosCapitulos?.normalizarCapitulos) {
            return window.DCEpisodiosCapitulos.normalizarCapitulos(data);
        }
        const timeline = Array.isArray(data?.timeline) ? data.timeline : [];
        return [{ capitulo_id: 'cap_01', nombre: 'Capítulo 1', descripcion: '', timeline }];
    }

    function obtenerTimelineActiva() {
        const cap = capitulosEpisodio[currentCapituloIndex];
        return Array.isArray(cap?.timeline) ? cap.timeline : [];
    }

    function indiceCapituloValido(idx, total) {
        const i = Number(idx);
        return Number.isFinite(i) && i >= 0 && i < total;
    }

    function capituloActual() {
        return capitulosEpisodio[currentCapituloIndex] || null;
    }

    async function cargarJsonEpisodio(jsonPath) {
        const res = await fetch(jsonPath);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
    }

    async function iniciarEpisodio(ep, capituloIndex = 0) {
        try {
            episodioData = await cargarJsonEpisodio(ep.jsonPath);
        } catch (e) {
            mostrarErrorCarga('No se pudo cargar el episodio: ' + e.message);
            return;
        }

        capitulosEpisodio = normalizarCapitulosDesdeDatos(episodioData);
        const idxCap = Number(capituloIndex);
        if (!indiceCapituloValido(idxCap, capitulosEpisodio.length)) {
            mostrarErrorCarga('Capítulo no válido.');
            return;
        }

        const progreso = window.DCEpisodiosProgreso?.obtenerProgreso
            ? window.DCEpisodiosProgreso.obtenerProgreso(ep.evento_id, ep.jsonPath)
            : { capitulosCompletados: [] };
        const desbloqueado = window.DCEpisodiosProgreso?.capituloDesbloqueado
            ? window.DCEpisodiosProgreso.capituloDesbloqueado(
                progreso, idxCap, capitulosEpisodio.length
            )
            : idxCap === 0;
        if (!desbloqueado) {
            mostrarErrorCarga('Este capítulo está bloqueado. Completa el anterior primero.');
            return;
        }

        const checkInicio = validarCartasRequeridasEpisodio(episodioData);
        if (!checkInicio.cumple) {
            mostrarErrorCarga(checkInicio.mensaje || 'No puedes comenzar este episodio.');
            return;
        }

        const cap = capitulosEpisodio[idxCap];
        currentCapituloIndex = idxCap;
        currentTimelineIndex = 0;

        guardarProgreso({
            episodio_id: ep.evento_id,
            json_path: ep.jsonPath,
            nombre: ep.nombre,
            capitulo_index: idxCap,
            capitulo_id: cap.capitulo_id,
            capitulo_nombre: cap.nombre,
            timeline_index: 0,
            estado: 'activo',
            combate_resultado: null,
            completado: false,
        });

        sceneCharacters = {};
        procesarTimeline();
    }

    /* ──────────────────────────────────────────
       REANUDAR (al volver de tablero.html)
    ────────────────────────────────────────── */
    async function reanudarSiCorresponde() {
        const estado = leerEstado();
        if (!estado) return;

        if (estado.completado) {
            limpiarEstado();
            return;
        }

        // Solo reanudar automáticamente si volvemos de un combate
        if (estado.estado !== 'combate') return;

        try {
            episodioData = await cargarJsonEpisodio(estado.json_path);
        } catch (e) {
            mostrarErrorCarga('No se pudo reanudar el episodio: ' + e.message);
            limpiarEstado();
            return;
        }

        capitulosEpisodio = normalizarCapitulosDesdeDatos(episodioData);
        currentCapituloIndex = Number.isFinite(Number(estado.capitulo_index))
            ? Number(estado.capitulo_index)
            : 0;
        if (!indiceCapituloValido(currentCapituloIndex, capitulosEpisodio.length)) {
            currentCapituloIndex = 0;
        }

        sceneCharacters = {};
        currentTimelineIndex = estado.timeline_index || 0;

        if (estado.combate_resultado === 'victoria') {
            // Avanzar al siguiente evento
            currentTimelineIndex++;
            guardarProgreso({
                ...estado,
                timeline_index: currentTimelineIndex,
                combate_resultado: null,
                estado: 'activo'
            });
            procesarTimeline();
        } else {
            // Derrota: mostrar pantalla de pausa
            mostrarPausaDerrota(estado);
        }
    }

    function mostrarPausaDerrota(estado) {
        mostrarPanel('pausa');

        const titEl = el('episodio-pausa-titulo');
        const descEl = el('episodio-pausa-desc');
        const nombreEp = estado.nombre || 'Episodio';

        if (titEl) titEl.textContent = '¡Has sido derrotado!';
        if (descEl) descEl.textContent =
            `El combate del episodio "${nombreEp}" no ha sido superado. ¿Deseas intentarlo de nuevo?`;

        const btnReintentar = el('episodio-pausa-btn-reintentar');
        const btnAbandonar  = el('episodio-pausa-btn-abandonar');

        if (btnReintentar) {
            btnReintentar.onclick = () => {
                // Restablecer resultado y mostrar previa de combate
                guardarProgreso({ ...estado, combate_resultado: null });
                const evento = obtenerTimelineActiva()[currentTimelineIndex];
                if (evento && String(evento.type || '').toLowerCase() === 'combate') {
                    void mostrarPreviaCombate(evento);
                }
            };
        }

        if (btnAbandonar) {
            btnAbandonar.onclick = () => {
                limpiarEstado();
                cerrarOverlay();
            };
        }
    }

    /* ──────────────────────────────────────────
       TIMELINE
    ────────────────────────────────────────── */
    function procesarTimeline() {
        const timeline = obtenerTimelineActiva();
        if (!episodioData) {
            cerrarOverlay();
            return;
        }

        if (currentTimelineIndex >= timeline.length) {
            finalizarCapituloAlAgotarTimeline();
            return;
        }

        const evento = timeline[currentTimelineIndex];
        switch (String(evento.type || '').toLowerCase()) {
            case 'cutscene':
                mostrarCutscene(evento);
                break;
            case 'escena':
                mostrarEscenaTimeline(evento);
                break;
            case 'combate':
                void mostrarPreviaCombate(evento);
                break;
            case 'recompensa':
                mostrarRecompensas(evento);
                break;
            default:
                avanzarTimeline();
        }
    }

    function avanzarTimeline() {
        currentTimelineIndex++;
        const estado = leerEstado();
        if (estado) {
            guardarProgreso({ ...estado, timeline_index: currentTimelineIndex });
        }
        procesarTimeline();
    }

    function marcarCapituloActualCompletadoEnProgreso() {
        const estado = leerEstado() || {};
        if (window.DCEpisodiosProgreso?.marcarCapituloCompletado) {
            window.DCEpisodiosProgreso.marcarCapituloCompletado(
                estado.episodio_id,
                estado.json_path,
                currentCapituloIndex
            );
        }
    }

    function esUltimoCapituloEpisodio() {
        return currentCapituloIndex >= capitulosEpisodio.length - 1;
    }

    function mostrarFinCapituloIntermedio() {
        mostrarPanel('recompensa');
        const tituloRecomp = document.querySelector('#episodio-recompensas .episodio-recomp-titulo');
        if (tituloRecomp) {
            tituloRecomp.textContent = '✦ Capítulo completado';
        }
        const contenedor = el('episodio-recompensas-contenido');
        if (contenedor) {
            const cap = capituloActual();
            contenedor.innerHTML = '';
            const p = document.createElement('p');
            p.className = 'episodio-recomp-guardando';
            p.textContent = `¡${cap?.nombre || 'Capítulo'} completado!`;
            contenedor.appendChild(p);
            const p2 = document.createElement('p');
            p2.className = 'episodio-recomp-subtitulo';
            p2.textContent = 'Ya puedes jugar el siguiente capítulo desde la lista de episodios.';
            contenedor.appendChild(p2);
        }
        const btnFin = el('episodio-recompensas-btn-fin');
        if (btnFin) {
            btnFin.textContent = 'Volver a episodios';
            btnFin.onclick = () => {
                limpiarEstado();
                cerrarOverlay();
            };
        }
    }

    function finalizarCapituloAlAgotarTimeline() {
        marcarCapituloActualCompletadoEnProgreso();
        if (esUltimoCapituloEpisodio()) {
            onEpisodioTerminado();
        } else {
            mostrarFinCapituloIntermedio();
        }
    }

    function onEpisodioTerminado() {
        marcarCapituloActualCompletadoEnProgreso();
        limpiarEstado();
        cerrarOverlay();
    }

    /* ──────────────────────────────────────────
       CUTSCENE
    ────────────────────────────────────────── */
    function aplicarFondoCutscene(evento) {
        if (!evento) return;
        if (eventoUsaFondoNegroInicial(evento)) {
            aplicarFondoNegroInstante();
            setOpacidadFade(0, { animar: false });
            return;
        }
        const imagen = String(evento.background_image || '').trim();
        if (imagen) {
            aplicarImagenFondoCutscene(imagen);
        } else {
            aplicarFondoNegroInstante();
        }
        resetCapaFade(true);
    }

    function mostrarCutscene(evento) {
        cancelarAvanceAutomaticoCutscene();
        mostrarPanel('cutscene');
        cutsceneModo = 'dialogos';
        cutsceneAnimacionEnCurso = false;
        aplicarFondoCutscene(evento);

        // Nueva cutscene = reinicio de personajes en escena
        sceneCharacters = {};
        limpiarBustosDOM({ instante: true });

        const escenaInicial = obtenerEscenaDesdeEvento(evento);
        if (escenaInicial.length) {
            aplicarComandosEscena(escenaInicial, {
                sinHablante: true,
                ocultarAusentes: evento.ocultar_ausentes === true || evento.ocultarAusentes === true,
            });
            renderizarBustosDOM();
        }

        currentDialogos = Array.isArray(evento.dialogos) ? evento.dialogos : [];
        currentDialogoIndex = 0;

        if (!currentDialogos.length) {
            avanzarTimeline();
            return;
        }

        void renderizarDialogoAsync(currentDialogos[0]);
    }

    async function renderizarDialogoAsync(dialogo) {
        if (!dialogo) return;

        if (esLineaComandoFondoPuro(dialogo)) {
            setBotonSiguienteHabilitado(false);
            cutsceneAnimacionEnCurso = true;
            try {
                await ejecutarComandoFondo(dialogo);
            } finally {
                cutsceneAnimacionEnCurso = false;
                setBotonSiguienteHabilitado(true);
            }
            prepararUiLineaComandoPuro(dialogo);
            programarAvanceAutomaticoCutscene(dialogo, 0);
            return;
        }

        renderizarDialogo(dialogo);

        if (esLineaComandoEscenaPuro(dialogo)) {
            const delayEscena = bustosAnimacionReducida() ? 0 : (BUSTO_FADE_MS + 60);
            programarAvanceAutomaticoCutscene(dialogo, delayEscena);
        }
    }

    /**
     * Paso suelto en timeline: solo actualiza quién está en escena (sin diálogo).
     * Útil entre combates/cutscenes sin abrir un bloque cutscene completo.
     */
    function mostrarEscenaTimeline(evento) {
        cancelarAvanceAutomaticoCutscene();
        mostrarPanel('cutscene');
        cutsceneModo = 'timeline_escena';
        aplicarFondoCutscene(evento);

        if (evento.limpiar_escena === true) {
            sceneCharacters = {};
            limpiarBustosDOM({ instante: true });
        }

        const comandos = obtenerEscenaDesdeEvento(evento);
        aplicarComandosEscena(comandos, {
            sinHablante: true,
            ocultarAusentes: evento.ocultar_ausentes === true || evento.ocultarAusentes === true,
        });
        renderizarBustosDOM();

        const textEl = el('cutscene-dialog-text');
        const titulo = String(evento.titulo || evento.nombre || '').trim();
        aplicarCajaNombreCutscene({ nombre: titulo });
        if (textEl) {
            aplicarTextoPlanoDialogo(textEl, String(evento.texto || evento.descripcion || '').trim());
        }
        typewriterCompleto = true;
        actualizarBotonSiguienteCutscene(true);
        const delayEscena = bustosAnimacionReducida() ? 0 : (BUSTO_FADE_MS + 60);
        programarAvanceAutomaticoCutscene(evento, delayEscena);
    }

    function renderizarDialogo(dialogo) {
        if (!dialogo) return;

        const esSoloEscena = esLineaComandoEscenaPuro(dialogo);
        const esVozOff = esDialogoVozEnOff(dialogo);
        const speakerId = String(dialogo.id_character || '').trim() || null;

        if (Array.isArray(dialogo.escena) && dialogo.escena.length) {
            aplicarComandosEscena(dialogo.escena, {
                sinHablante: esSoloEscena,
                hablanteId: esSoloEscena ? null : (esVozOff ? null : speakerId),
                ocultarAusentes: dialogo.ocultar_ausentes === true || dialogo.ocultarAusentes === true,
            });
        }

        if (esSoloEscena) {
            renderizarBustosDOM();
            prepararUiLineaComandoPuro(dialogo);
            return;
        }

        if (speakerId) {
            actualizarPersonajeEnEscena(speakerId, dialogo, { hablando: !esVozOff });
        }

        Object.keys(sceneCharacters).forEach((id) => {
            if (esVozOff) {
                sceneCharacters[id].speaking = false;
            } else if (id !== speakerId) {
                sceneCharacters[id].speaking = false;
            }
        });

        renderizarBustosDOM();
        aplicarCajaNombreCutscene(dialogo);

        const textEl = el('cutscene-dialog-text');
        if (textEl) iniciarTypewriterDialogo(textEl, dialogo);

        actualizarBotonSiguienteCutscene(currentDialogoIndex >= currentDialogos.length - 1);
    }

    function bustosAnimacionReducida() {
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch {
            return false;
        }
    }

    function aplicarClasesEstadoBusto(wrap, char) {
        wrap.classList.remove('cutscene-busto--hablando', 'cutscene-busto--silencio');
        wrap.classList.add(char.speaking ? 'cutscene-busto--hablando' : 'cutscene-busto--silencio');
    }

    function crearElementoBusto(id, char) {
        const wrap = document.createElement('div');
        wrap.className = 'cutscene-busto cutscene-busto--entrando ' +
            (char.speaking ? 'cutscene-busto--hablando' : 'cutscene-busto--silencio');
        wrap.dataset.characterId = id;
        aplicarPosicionBustoDOM(wrap, char.side);

        const img = document.createElement('img');
        img.src = BUSTOS_BASE + char.bust_image;
        img.alt = id;
        img.draggable = false;
        img.onerror = () => { wrap.classList.add('cutscene-busto--saliendo'); };
        wrap.appendChild(img);
        return wrap;
    }

    function iniciarFadeInBusto(wrap) {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                wrap.classList.remove('cutscene-busto--entrando', 'cutscene-busto--saliendo');
                wrap.classList.add('cutscene-busto--visible');
            });
        });
    }

    function fadeOutYRemover(wrap, container) {
        if (!wrap || !container || wrap.classList.contains('cutscene-busto--saliendo')) {
            return;
        }
        wrap.classList.remove('cutscene-busto--entrando', 'cutscene-busto--visible');
        wrap.classList.add('cutscene-busto--saliendo');

        let removido = false;
        const quitar = () => {
            if (removido) return;
            removido = true;
            if (wrap.parentElement === container) {
                container.removeChild(wrap);
            }
        };

        const onEnd = (ev) => {
            if (ev.propertyName !== 'opacity') return;
            wrap.removeEventListener('transitionend', onEnd);
            quitar();
        };
        wrap.addEventListener('transitionend', onEnd);
        setTimeout(quitar, BUSTO_FADE_MS + 60);
    }

    function actualizarImagenBustoSiCambio(wrap, char) {
        const img = wrap.querySelector('img');
        const archivo = String(char.bust_image || '').trim();
        if (!img || !archivo) return;
        const nuevaSrc = BUSTOS_BASE + archivo;
        const actual = img.getAttribute('src') || '';
        if (!actual.endsWith(archivo)) {
            img.src = nuevaSrc;
        }
    }

    /**
     * Sincroniza bustos con sceneCharacters; fade-in al mostrar y fade-out al ocultar.
     * @param {{ instante?: boolean }} [opciones]
     */
    function renderizarBustosDOM(opciones = {}) {
        const instante = opciones.instante === true || bustosAnimacionReducida();
        const container = el('cutscene-bustos-container');
        if (!container) return;

        const existentes = Array.from(container.querySelectorAll('.cutscene-busto[data-character-id]'));

        existentes.forEach((wrap) => {
            const id = wrap.dataset.characterId;
            const char = sceneCharacters[id];
            const debeMostrar = Boolean(char && char.visible && char.bust_image);

            if (!debeMostrar) {
                if (instante) {
                    wrap.remove();
                } else {
                    fadeOutYRemover(wrap, container);
                }
                return;
            }

            if (wrap.classList.contains('cutscene-busto--saliendo')) {
                wrap.classList.remove('cutscene-busto--saliendo');
                if (instante) {
                    wrap.classList.add('cutscene-busto--visible');
                } else {
                    wrap.classList.add('cutscene-busto--entrando');
                    iniciarFadeInBusto(wrap);
                }
            }

            aplicarClasesEstadoBusto(wrap, char);
            aplicarPosicionBustoDOM(wrap, char.side);
            actualizarImagenBustoSiCambio(wrap, char);

            if (!wrap.classList.contains('cutscene-busto--visible')
                && !wrap.classList.contains('cutscene-busto--entrando')
                && !wrap.classList.contains('cutscene-busto--saliendo')) {
                if (instante) {
                    wrap.classList.add('cutscene-busto--visible');
                } else {
                    wrap.classList.add('cutscene-busto--entrando');
                    iniciarFadeInBusto(wrap);
                }
            }
        });

        Object.entries(sceneCharacters).forEach(([id, char]) => {
            if (!char.visible || !char.bust_image) return;
            const yaExiste = Array.from(container.querySelectorAll('.cutscene-busto'))
                .some((n) => n.dataset.characterId === id);
            if (yaExiste) {
                return;
            }

            const wrap = crearElementoBusto(id, char);
            container.appendChild(wrap);
            if (instante) {
                wrap.classList.remove('cutscene-busto--entrando');
                wrap.classList.add('cutscene-busto--visible');
            } else {
                iniciarFadeInBusto(wrap);
            }
        });
    }

    function limpiarBustosDOM(opciones = {}) {
        const instante = opciones.instante === true || bustosAnimacionReducida();
        const container = el('cutscene-bustos-container');
        if (!container) return;

        const wraps = Array.from(container.querySelectorAll('.cutscene-busto'));
        if (instante || !wraps.length) {
            container.innerHTML = '';
            return;
        }

        wraps.forEach((wrap) => fadeOutYRemover(wrap, container));
    }

    /* ── Typewriter ─────────────────────────── */
    function iniciarTypewriter(textEl, texto) {
        textEl.classList.remove('cutscene-dialog-text--voz-en-off');
        iniciarTypewriterEnContenedor(textEl, parsearSegmentosTextoDialogo(texto));
    }

    function iniciarTypewriterVozEnOff(textEl, texto) {
        detenerTypewriter();
        typewriterCompleto = false;
        textEl.classList.add('cutscene-dialog-text--voz-en-off');
        textEl.replaceChildren();
        textEl.appendChild(document.createTextNode('*'));
        const strong = document.createElement('strong');
        strong.className = 'cutscene-dialog-voz-en-off';
        textEl.appendChild(strong);
        textEl.appendChild(document.createTextNode('*'));
        iniciarTypewriterEnContenedor(strong, parsearSegmentosTextoDialogo(texto));
    }

    function iniciarTypewriterDialogo(textEl, dialogo) {
        const texto = String(dialogo?.texto || '');
        if (esDialogoVozEnOff(dialogo)) {
            iniciarTypewriterVozEnOff(textEl, texto);
        } else {
            iniciarTypewriter(textEl, texto);
        }
    }

    function completarTypewriterInstante() {
        detenerTypewriter();
        const textEl = el('cutscene-dialog-text');
        const dialogo = currentDialogos[currentDialogoIndex];
        if (textEl && dialogo) {
            if (esDialogoVozEnOff(dialogo)) {
                aplicarTextoVozEnOffCompleto(textEl, dialogo.texto || '');
            } else {
                aplicarTextoPlanoDialogo(textEl, dialogo.texto || '');
            }
        }
        typewriterCompleto = true;
    }

    function onClickSiguiente() {
        if (cutsceneAnimacionEnCurso) {
            return;
        }
        cancelarAvanceAutomaticoCutscene();

        if (cutsceneModo === 'timeline_escena') {
            cutsceneModo = 'dialogos';
            avanzarTimeline();
            return;
        }

        // Si el typewriter sigue, completar al instante
        if (!typewriterCompleto) {
            completarTypewriterInstante();
            return;
        }
        currentDialogoIndex++;
        if (currentDialogoIndex < currentDialogos.length) {
            void renderizarDialogoAsync(currentDialogos[currentDialogoIndex]);
        } else {
            // Fin de cutscene
            limpiarBustosDOM();
            avanzarTimeline();
        }
    }

    /* ──────────────────────────────────────────
       PREVIA COMBATE
    ────────────────────────────────────────── */
    function etiquetaNivelJugadorEnPrevia(evento) {
        const raw = Number(evento?.nivel_jugador);
        if (raw === 0) {
            return 'Nivel de tu colección';
        }
        return `Nivel ${Math.max(1, Number.isFinite(raw) ? raw : 1)}`;
    }

    function construirMazoJugadorParaCombate(evento) {
        const req = window.DCEpisodiosRequisitos;
        if (req && typeof req.construirEntradasMazoJugadorEpisodio === 'function') {
            const usuario = typeof req.leerUsuarioLocal === 'function' ? req.leerUsuarioLocal() : null;
            return req.construirEntradasMazoJugadorEpisodio(evento, usuario);
        }
        const nivelJ = Math.max(1, Number(evento.nivel_jugador || 1));
        return (evento.cartas_jugador || []).map((n) => ({
            Nombre: String(n),
            Nivel: nivelJ,
        }));
    }

    function obtenerSaludMaxCartaPrevia(carta) {
        const salud = Number(carta?.SaludMax ?? carta?.Salud ?? carta?.Poder ?? 0);
        return Math.max(Number.isFinite(salud) ? salud : 0, 1);
    }

    function obtenerSaludActualCartaPrevia(carta) {
        const saludMax = obtenerSaludMaxCartaPrevia(carta);
        const salud = Number(carta?.Salud ?? carta?.salud);
        const saludValida = Number.isFinite(salud) ? salud : saludMax;
        return Math.max(0, Math.min(saludValida, saludMax));
    }

    function crearBarraSaludCartaPrevia(carta) {
        const saludActual = obtenerSaludActualCartaPrevia(carta);
        const saludMax = obtenerSaludMaxCartaPrevia(carta);
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

    function crearCartaMiniPrevia(carta) {
        const cartaDiv = document.createElement('div');
        cartaDiv.className = 'carta-mini episodio-combate-carta-mini';
        cartaDiv.setAttribute('role', 'img');
        cartaDiv.setAttribute('aria-label', carta?.Nombre || 'Carta');

        if (typeof window.dcAplicarClasesNivelCartaCompleta === 'function') {
            window.dcAplicarClasesNivelCartaCompleta(cartaDiv, carta);
        } else if (Number(carta?.Nivel || 1) >= 6) {
            cartaDiv.classList.add('nivel-legendaria');
        }

        if (typeof window.aplicarImagenFondoCarta === 'function') {
            window.aplicarImagenFondoCarta(cartaDiv, carta);
        } else if (typeof window.obtenerImagenCarta === 'function') {
            cartaDiv.style.backgroundImage = `url(${window.obtenerImagenCarta(carta)})`;
        }

        const estrellasDiv = document.createElement('div');
        estrellasDiv.className = 'estrellas-carta';
        if (typeof window.dcRellenarEstrellasCartaCompleta === 'function') {
            window.dcRellenarEstrellasCartaCompleta(estrellasDiv, carta, {});
        } else {
            const nivel = Number(carta.Nivel || 1);
            for (let i = 0; i < nivel; i += 1) {
                const estrella = document.createElement('img');
                estrella.className = 'estrella';
                estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
                estrella.alt = 'star';
                estrellasDiv.appendChild(estrella);
            }
        }

        const detallesDiv = document.createElement('div');
        detallesDiv.className = 'detalles-carta';
        const nombre = document.createElement('span');
        nombre.className = 'nombre-carta';
        nombre.textContent = carta.Nombre || '';
        const poder = document.createElement('span');
        poder.className = 'poder-carta';
        poder.textContent = carta.Poder ?? '';
        detallesDiv.appendChild(nombre);
        detallesDiv.appendChild(poder);

        cartaDiv.appendChild(estrellasDiv);
        cartaDiv.appendChild(detallesDiv);

        const badgeHabilidad = typeof window.crearBadgeHabilidadCarta === 'function'
            ? window.crearBadgeHabilidadCarta(carta)
            : null;
        if (badgeHabilidad) {
            cartaDiv.appendChild(badgeHabilidad);
        }
        const badgeAfiliacion = typeof window.crearBadgeAfiliacionCarta === 'function'
            ? window.crearBadgeAfiliacionCarta(carta)
            : null;
        if (badgeAfiliacion) {
            cartaDiv.appendChild(badgeAfiliacion);
        }
        cartaDiv.appendChild(crearBarraSaludCartaPrevia(carta));

        return cartaDiv;
    }

    function renderizarGridCartasPrevia(contenedor, cartas) {
        if (!contenedor) {
            return;
        }
        contenedor.innerHTML = '';
        const lista = Array.isArray(cartas) ? cartas : [];
        if (!lista.length) {
            const vacio = document.createElement('p');
            vacio.className = 'episodio-combate-cartas-vacio';
            vacio.textContent = '(sin cartas definidas)';
            contenedor.appendChild(vacio);
            return;
        }
        lista.forEach((carta) => {
            contenedor.appendChild(crearCartaMiniPrevia(carta));
        });
    }

    async function obtenerMapaCatalogoEpisodio() {
        if (typeof window.DCCatalogoCartas?.obtenerMapaPorNombre === 'function') {
            return window.DCCatalogoCartas.obtenerMapaPorNombre();
        }
        const mapa = new Map();
        if (typeof window.DCCatalogoCartas?.obtenerFilas !== 'function') {
            return mapa;
        }
        const filas = await window.DCCatalogoCartas.obtenerFilas();
        const normalizar = typeof window.normalizarClaveNombreCatalogo === 'function'
            ? window.normalizarClaveNombreCatalogo
            : (n) => String(n || '').trim().toLowerCase();
        (Array.isArray(filas) ? filas : []).forEach((fila) => {
            const clave = normalizar(fila?.Nombre);
            if (clave && !mapa.has(clave)) {
                mapa.set(clave, fila);
            }
        });
        return mapa;
    }

    async function mostrarPreviaCombate(evento) {
        mostrarPanel('combate');

        const tituloEl = el('episodio-combate-titulo');
        if (tituloEl) tituloEl.textContent = '⚔ Combate';

        const infoEl = el('episodio-combate-info');
        const etiquetaNJ = etiquetaNivelJugadorEnPrevia(evento);
        const nB = Math.max(1, Number(evento.nivel_BOT || 1));

        if (infoEl) {
            infoEl.innerHTML = `
                <div class="episodio-combate-mazos">
                    <section class="episodio-combate-mazo-bloque" aria-labelledby="episodio-combate-tu-mazo">
                        <div class="combate-previa-fila combate-previa-fila--encabezado">
                            <span id="episodio-combate-tu-mazo" class="combate-previa-etiqueta">Tu mazo</span>
                            <span class="combate-previa-nivel">${etiquetaNJ}</span>
                        </div>
                        <div id="episodio-combate-grid-jugador" class="episodio-combate-cartas-grid" aria-busy="true"></div>
                    </section>
                    <section class="episodio-combate-mazo-bloque" aria-labelledby="episodio-combate-enemigo">
                        <div class="combate-previa-fila combate-previa-fila--encabezado">
                            <span id="episodio-combate-enemigo" class="combate-previa-etiqueta">Enemigo</span>
                            <span class="combate-previa-nivel">Nivel ${nB}</span>
                        </div>
                        <div id="episodio-combate-grid-bot" class="episodio-combate-cartas-grid" aria-busy="true"></div>
                    </section>
                </div>`;
        }

        const btnIniciar = el('episodio-btn-iniciar-combate');
        if (btnIniciar) btnIniciar.onclick = () => lanzarCombate(evento);

        const btnCancelarCombate = el('episodio-btn-cancelar-combate');
        if (btnCancelarCombate) btnCancelarCombate.onclick = () => cerrarOverlay();

        const gridJ = el('episodio-combate-grid-jugador');
        const gridB = el('episodio-combate-grid-bot');
        const req = window.DCEpisodiosRequisitos;

        try {
            const mapa = await obtenerMapaCatalogoEpisodio();
            const entradasJ = construirMazoJugadorParaCombate(evento);
            const entradasB = (evento.cartas_BOT || []).map((n) => ({
                Nombre: String(n),
                Nivel: nB,
            }));

            let cartasJ = [];
            let cartasB = [];
            if (req && typeof req.construirCartasEnriquecidasDesdeEntradas === 'function') {
                cartasJ = await req.construirCartasEnriquecidasDesdeEntradas(entradasJ, mapa);
                cartasB = await req.construirCartasEnriquecidasDesdeEntradas(entradasB, mapa);
            }

            renderizarGridCartasPrevia(gridJ, cartasJ);
            renderizarGridCartasPrevia(gridB, cartasB);
            if (gridJ) gridJ.removeAttribute('aria-busy');
            if (gridB) gridB.removeAttribute('aria-busy');
        } catch (err) {
            console.warn('[Episodio] No se pudieron renderizar las cartas de la previa:', err);
            if (gridJ) {
                gridJ.innerHTML = '<p class="episodio-combate-cartas-vacio">No se pudieron cargar las cartas.</p>';
                gridJ.removeAttribute('aria-busy');
            }
            if (gridB) {
                gridB.innerHTML = '<p class="episodio-combate-cartas-vacio">No se pudieron cargar las cartas.</p>';
                gridB.removeAttribute('aria-busy');
            }
        }
    }

    function lanzarCombate(evento) {
        if (episodioData) {
            const check = validarCartasRequeridasEpisodio(episodioData);
            if (!check.cumple) {
                mostrarErrorCarga(check.mensaje || 'No puedes iniciar el combate.');
                return;
            }
        }

        const nivelB = Math.max(1, Number(evento.nivel_BOT || 1));
        const mazoJ = construirMazoJugadorParaCombate(evento);
        const mazoB = (evento.cartas_BOT || []).map((n) => ({
            Nombre: String(n),
            Nivel: nivelB,
        }));

        try {
            sessionStorage.removeItem('dc_tablero_fondo_url');
        } catch (_e) {
            /* noop */
        }

        const tableroNombre = String(evento.tablero || '').trim();

        // Guardar estado como 'combate' antes de navegar
        const estado = leerEstado() || {};
        guardarProgreso({
            ...estado,
            timeline_index: currentTimelineIndex,
            estado: 'combate',
            combate_resultado: null,
            tablero: tableroNombre,
        });

        // Preparar localStorage para partida.js
        localStorage.setItem('mazoJugador',     JSON.stringify({ Cartas: mazoJ }));
        localStorage.setItem('mazoOponente',    JSON.stringify({ Cartas: mazoB }));
        localStorage.setItem('mazoJugadorBase', JSON.stringify({ Cartas: mazoJ }));
        localStorage.setItem('mazoOponenteBase',JSON.stringify({ Cartas: mazoB }));
        localStorage.setItem('dificultad',      String(nivelB));

        // Asegurar que no hay otros modos activos
        localStorage.removeItem('desafioActivo');
        localStorage.removeItem('asaltoActivo');
        localStorage.removeItem('partidaModo');
        localStorage.removeItem('partidaPvpSessionId');
        localStorage.removeItem('mazoOponente'); // lo acabamos de poner, solo limpiamos legacy
        localStorage.setItem('mazoOponente', JSON.stringify({ Cartas: mazoB }));

        window.location.href = 'tablero.html';
    }

    /* ──────────────────────────────────────────
       RECOMPENSAS
    ────────────────────────────────────────── */
    async function mostrarRecompensas(evento) {
        mostrarPanel('recompensa');

        const estado = leerEstado() || {};
        const ultimoCap = esUltimoCapituloEpisodio();
        const tituloRecomp = document.querySelector('#episodio-recompensas .episodio-recomp-titulo');
        if (tituloRecomp) {
            tituloRecomp.textContent = ultimoCap && capitulosEpisodio.length <= 1
                ? '✦ Episodio completado'
                : (ultimoCap ? '✦ Episodio completado' : '✦ Capítulo completado');
        }

        const contenedor = el('episodio-recompensas-contenido');
        if (contenedor) {
            contenedor.innerHTML = '<p class="episodio-recomp-guardando">Guardando recompensas…</p>';
        }

        try {
            await aplicarRecompensas(evento);
            renderizarPanelRecompensas(evento, contenedor);
        } catch (e) {
            if (contenedor) {
                contenedor.innerHTML =
                    `<p class="episodio-recomp-error">Error al guardar recompensas: ${e.message}</p>`;
            }
        }

        const btnFin = el('episodio-recompensas-btn-fin');
        if (btnFin) {
            btnFin.textContent = ultimoCap ? 'Finalizar episodio' : 'Volver a episodios';
            btnFin.onclick = () => {
                marcarCapituloActualCompletadoEnProgreso();
                limpiarEstado();
                cerrarOverlay();
            };
        }
    }

    async function aplicarRecompensas(recompensa) {
        const usuario = (() => {
            try { return JSON.parse(localStorage.getItem('usuario') || 'null'); } catch (_e) { return null; }
        })();
        const email = localStorage.getItem('email') || '';
        if (!usuario || !email) return;

        const monedas = Number(recompensa.monedas || 0);
        if (monedas > 0) usuario.puntos = (Number(usuario.puntos || 0)) + monedas;

        if (Array.isArray(recompensa.objetos)) {
            usuario.objetos = usuario.objetos || {};
            recompensa.objetos.forEach(obj => {
                usuario.objetos[String(obj)] = (Number(usuario.objetos[String(obj)] || 0)) + 1;
            });
        }

        if (Array.isArray(recompensa.skins) && recompensa.skins.length > 0) {
            usuario.skinsObtenidos = usuario.skinsObtenidos || {};
            recompensa.skins.forEach(sid => {
                usuario.skinsObtenidos[String(sid)] = true;
            });
        }

        if (Array.isArray(recompensa.cartas) && recompensa.cartas.length > 0) {
            if (!Array.isArray(usuario.cartas)) usuario.cartas = [];
            recompensa.cartas.forEach(nombreCarta => {
                usuario.cartas.push({ Nombre: String(nombreCarta), Nivel: 1 });
            });
        }

        localStorage.setItem('usuario', JSON.stringify(usuario));

        try {
            await fetch('/update-user', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, usuario })
            });
        } catch (e) {
            console.warn('[EpisodioEngine] No se pudo persistir recompensas:', e);
        }
    }

    function renderizarPanelRecompensas(recompensa, contenedor) {
        if (!contenedor) return;
        contenedor.innerHTML = '';

        const monedas = Number(recompensa.monedas || 0);
        if (monedas > 0) {
            const item = document.createElement('div');
            item.className = 'episodio-recomp-item';
            item.innerHTML = `<img src="resources/icons/moneda.png" class="episodio-recomp-icon" alt="Monedas">
                              <span>+${monedas} puntos</span>`;
            contenedor.appendChild(item);
        }

        const crearGrupo = (titulo, badges, claseExtra) => {
            const grupo = document.createElement('div');
            grupo.className = 'episodio-recomp-grupo';
            const h4 = document.createElement('h4');
            h4.className = 'episodio-recomp-subtitulo';
            h4.textContent = titulo;
            grupo.appendChild(h4);
            const fila = document.createElement('div');
            fila.className = 'episodio-recomp-badges-fila';
            badges.forEach(txt => {
                const b = document.createElement('span');
                b.className = 'episodio-recomp-badge' + (claseExtra ? ' ' + claseExtra : '');
                b.textContent = txt;
                fila.appendChild(b);
            });
            grupo.appendChild(fila);
            contenedor.appendChild(grupo);
        };

        if (Array.isArray(recompensa.cartas) && recompensa.cartas.length > 0) {
            crearGrupo('Cartas obtenidas', recompensa.cartas, '');
        }
        if (Array.isArray(recompensa.skins) && recompensa.skins.length > 0) {
            crearGrupo('Apariencias obtenidas', recompensa.skins, 'episodio-recomp-badge--skin');
        }
        if (Array.isArray(recompensa.objetos) && recompensa.objetos.length > 0) {
            crearGrupo('Objetos obtenidos', recompensa.objetos, '');
        }

        if (monedas === 0 &&
            (!recompensa.cartas || !recompensa.cartas.length) &&
            (!recompensa.skins || !recompensa.skins.length) &&
            (!recompensa.objetos || !recompensa.objetos.length)) {
            const p = document.createElement('p');
            p.className = 'episodio-recomp-guardando';
            p.textContent = '¡Episodio completado!';
            contenedor.appendChild(p);
        }
    }

    /* ──────────────────────────────────────────
       CERRAR OVERLAY
    ────────────────────────────────────────── */
    function cerrarOverlay() {
        cancelarAvanceAutomaticoCutscene();
        const overlay = el('episodio-overlay');
        if (overlay) overlay.style.display = 'none';

        // Limpiar paneles
        ['episodio-cutscene', 'episodio-previa-combate', 'episodio-recompensas', 'episodio-pausa'].forEach(id => {
            const panel = el(id);
            if (panel) panel.style.display = 'none';
        });

        // Reset estado
        episodioData = null;
        capitulosEpisodio = [];
        currentCapituloIndex = 0;
        currentTimelineIndex = 0;
        sceneCharacters = {};
        currentDialogos = [];
        currentDialogoIndex = 0;
        if (typewriterTimer) { clearTimeout(typewriterTimer); typewriterTimer = null; }
        typewriterCompleto = false;
        cutsceneModo = 'dialogos';
        limpiarBustosDOM();
    }

    /* ──────────────────────────────────────────
       DOMContentLoaded — wire up
    ────────────────────────────────────────── */
    document.addEventListener('DOMContentLoaded', () => {
        // Botón siguiente en cutscene
        const btnNext = el('cutscene-btn-next');
        if (btnNext) btnNext.addEventListener('click', onClickSiguiente);

        // Comprobar si volvemos de un combate de episodio
        const estado = leerEstado();
        if (estado && estado.estado === 'combate') {
            reanudarSiCorresponde();
        }
    });

    /* ──────────────────────────────────────────
       API pública
    ────────────────────────────────────────── */
    window.DCEpisodioEngine = {
        iniciarEpisodio,
        reanudarSiCorresponde,
        cerrarOverlay,
        cargarJsonEpisodio,
        normalizarCapitulosDesdeDatos,
    };

})();
