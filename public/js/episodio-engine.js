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
 *   completado: boolean
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

    /* ──────────────────────────────────────────
       Estado del engine
    ────────────────────────────────────────── */
    let episodioData = null;
    let currentTimelineIndex = 0;
    let sceneCharacters = {};   // { id: { bust_image, side, visible, speaking } }
    let currentDialogos = [];
    let currentDialogoIndex = 0;
    let typewriterTimer = null;
    let typewriterCompleto = false;

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
    async function iniciarEpisodio(ep) {
        try {
            const res = await fetch(ep.jsonPath);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            episodioData = await res.json();
        } catch (e) {
            mostrarErrorCarga('No se pudo cargar el episodio: ' + e.message);
            return;
        }

        guardarProgreso({
            episodio_id: ep.evento_id,
            json_path: ep.jsonPath,
            nombre: ep.nombre,
            timeline_index: 0,
            estado: 'activo',
            combate_resultado: null,
            completado: false
        });

        sceneCharacters = {};
        currentTimelineIndex = 0;
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
            const res = await fetch(estado.json_path);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            episodioData = await res.json();
        } catch (e) {
            mostrarErrorCarga('No se pudo reanudar el episodio: ' + e.message);
            limpiarEstado();
            return;
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
                const evento = episodioData.timeline[currentTimelineIndex];
                if (evento && evento.type === 'combate') {
                    mostrarPreviaCombate(evento);
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
        if (!episodioData || !Array.isArray(episodioData.timeline)) {
            cerrarOverlay();
            return;
        }

        if (currentTimelineIndex >= episodioData.timeline.length) {
            onEpisodioTerminado();
            return;
        }

        const evento = episodioData.timeline[currentTimelineIndex];
        switch (String(evento.type || '').toLowerCase()) {
            case 'cutscene':
                mostrarCutscene(evento);
                break;
            case 'combate':
                mostrarPreviaCombate(evento);
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

    function onEpisodioTerminado() {
        const estado = leerEstado() || {};
        guardarProgreso({ ...estado, completado: true });
        limpiarEstado();
        cerrarOverlay();
    }

    /* ──────────────────────────────────────────
       CUTSCENE
    ────────────────────────────────────────── */
    function mostrarCutscene(evento) {
        mostrarPanel('cutscene');

        // Fondo
        const bgEl = el('cutscene-bg');
        if (bgEl) {
            bgEl.style.backgroundImage = evento.background_image
                ? `url('${BACKGROUND_BASE}${evento.background_image}')`
                : 'none';
        }

        // Limpiar escena (nueva cutscene = nueva escena de personajes)
        sceneCharacters = {};
        limpiarBustosDOM();

        currentDialogos = Array.isArray(evento.dialogos) ? evento.dialogos : [];
        currentDialogoIndex = 0;

        if (!currentDialogos.length) {
            avanzarTimeline();
            return;
        }

        renderizarDialogo(currentDialogos[0]);
    }

    function renderizarDialogo(dialogo) {
        if (!dialogo) return;

        // Procesar actualizaciones de escena (personajes no hablantes)
        if (Array.isArray(dialogo.escena)) {
            dialogo.escena.forEach(upd => {
                if (!upd.id_character) return;
                if (!sceneCharacters[upd.id_character]) {
                    sceneCharacters[upd.id_character] = {
                        bust_image: upd.bust_image || null,
                        side: upd.side || '10%',
                        visible: true,
                        speaking: false
                    };
                }
                if (upd.visible !== undefined) {
                    sceneCharacters[upd.id_character].visible = upd.visible !== false;
                }
                if (upd.bust_image) sceneCharacters[upd.id_character].bust_image = upd.bust_image;
                if (upd.side !== undefined) sceneCharacters[upd.id_character].side = upd.side;
            });
        }

        // Actualizar personaje hablante
        const speakerId = dialogo.id_character;
        if (speakerId) {
            const prevData = sceneCharacters[speakerId] || {};
            sceneCharacters[speakerId] = {
                bust_image: dialogo.bust_image || prevData.bust_image || null,
                side: dialogo.side || prevData.side || '10%',
                visible: dialogo.visible !== false,
                speaking: true
            };
        }

        // Marcar los demás como silencio
        Object.keys(sceneCharacters).forEach(id => {
            if (id !== speakerId) sceneCharacters[id].speaking = false;
        });

        // Renderizar bustos
        renderizarBustosDOM();

        // Nombre e-box
        const nameEl = el('cutscene-char-name');
        if (nameEl) nameEl.textContent = dialogo.nombre || dialogo.id_character || '';

        // Texto (typewriter)
        const textEl = el('cutscene-dialog-text');
        if (textEl) iniciarTypewriter(textEl, dialogo.texto || '');

        // Label del botón
        const btnNext = el('cutscene-btn-next');
        if (btnNext) {
            const esUltimo = currentDialogoIndex >= currentDialogos.length - 1;
            btnNext.textContent = esUltimo ? '✦ Continuar' : '▶ Siguiente';
        }
    }

    function renderizarBustosDOM() {
        const container = el('cutscene-bustos-container');
        if (!container) return;
        container.innerHTML = '';

        Object.entries(sceneCharacters).forEach(([id, char]) => {
            if (!char.visible || !char.bust_image) return;

            const wrap = document.createElement('div');
            wrap.className = 'cutscene-busto ' +
                (char.speaking ? 'cutscene-busto--hablando' : 'cutscene-busto--silencio');
            wrap.dataset.characterId = id;
            wrap.style.left = char.side || '10%';

            const img = document.createElement('img');
            img.src = BUSTOS_BASE + char.bust_image;
            img.alt = id;
            img.draggable = false;
            img.onerror = () => { wrap.style.opacity = '0'; };
            wrap.appendChild(img);
            container.appendChild(wrap);
        });
    }

    function limpiarBustosDOM() {
        const container = el('cutscene-bustos-container');
        if (container) container.innerHTML = '';
    }

    /* ── Typewriter ─────────────────────────── */
    function iniciarTypewriter(textEl, texto) {
        if (typewriterTimer) {
            clearTimeout(typewriterTimer);
            typewriterTimer = null;
        }
        typewriterCompleto = false;
        textEl.textContent = '';
        let i = 0;

        const step = () => {
            if (i < texto.length) {
                textEl.textContent += texto[i];
                i++;
                typewriterTimer = setTimeout(step, TYPEWRITER_DELAY_MS);
            } else {
                typewriterTimer = null;
                typewriterCompleto = true;
            }
        };
        typewriterTimer = setTimeout(step, TYPEWRITER_DELAY_MS);
    }

    function completarTypewriterInstante() {
        if (typewriterTimer) {
            clearTimeout(typewriterTimer);
            typewriterTimer = null;
        }
        const textEl = el('cutscene-dialog-text');
        const dialogo = currentDialogos[currentDialogoIndex];
        if (textEl && dialogo) textEl.textContent = dialogo.texto || '';
        typewriterCompleto = true;
    }

    function onClickSiguiente() {
        // Si el typewriter sigue, completar al instante
        if (!typewriterCompleto) {
            completarTypewriterInstante();
            return;
        }
        currentDialogoIndex++;
        if (currentDialogoIndex < currentDialogos.length) {
            renderizarDialogo(currentDialogos[currentDialogoIndex]);
        } else {
            // Fin de cutscene
            limpiarBustosDOM();
            avanzarTimeline();
        }
    }

    /* ──────────────────────────────────────────
       PREVIA COMBATE
    ────────────────────────────────────────── */
    function mostrarPreviaCombate(evento) {
        mostrarPanel('combate');

        const tituloEl = el('episodio-combate-titulo');
        if (tituloEl) tituloEl.textContent = '⚔ Combate';

        const infoEl = el('episodio-combate-info');
        if (infoEl) {
            const nJ  = Number(evento.nivel_jugador || 1);
            const nB  = Number(evento.nivel_BOT || 1);
            const cartasJ = (evento.cartas_jugador || []).join(', ') || '(automático)';
            const cartasB = (evento.cartas_BOT || []).join(', ') || '(automático)';

            infoEl.innerHTML = `
                <div class="combate-previa-fila">
                    <span class="combate-previa-etiqueta">Tu mazo</span>
                    <span class="combate-previa-valor">
                        ${cartasJ}
                        <span class="combate-previa-nivel">Nivel ${nJ}</span>
                    </span>
                </div>
                <div class="combate-previa-fila">
                    <span class="combate-previa-etiqueta">Enemigo</span>
                    <span class="combate-previa-valor">
                        ${cartasB}
                        <span class="combate-previa-nivel">Nivel ${nB}</span>
                    </span>
                </div>`;
        }

        const btnIniciar = el('episodio-btn-iniciar-combate');
        if (btnIniciar) btnIniciar.onclick = () => lanzarCombate(evento);

        const btnCancelarCombate = el('episodio-btn-cancelar-combate');
        if (btnCancelarCombate) btnCancelarCombate.onclick = () => cerrarOverlay();
    }

    function lanzarCombate(evento) {
        const nivelJ = Number(evento.nivel_jugador || 1);
        const nivelB = Number(evento.nivel_BOT || 1);

        const mazoJ = (evento.cartas_jugador || []).map(n => ({ Nombre: String(n), Nivel: nivelJ }));
        const mazoB = (evento.cartas_BOT || []).map(n => ({ Nombre: String(n), Nivel: nivelB }));

        // Guardar estado como 'combate' antes de navegar
        const estado = leerEstado() || {};
        guardarProgreso({
            ...estado,
            timeline_index: currentTimelineIndex,
            estado: 'combate',
            combate_resultado: null
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

        // Marcar como completado
        const estado = leerEstado() || {};
        guardarProgreso({ ...estado, completado: true });

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
            btnFin.onclick = () => {
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
        const overlay = el('episodio-overlay');
        if (overlay) overlay.style.display = 'none';

        // Limpiar paneles
        ['episodio-cutscene', 'episodio-previa-combate', 'episodio-recompensas', 'episodio-pausa'].forEach(id => {
            const panel = el(id);
            if (panel) panel.style.display = 'none';
        });

        // Reset estado
        episodioData = null;
        currentTimelineIndex = 0;
        sceneCharacters = {};
        currentDialogos = [];
        currentDialogoIndex = 0;
        if (typewriterTimer) { clearTimeout(typewriterTimer); typewriterTimer = null; }
        typewriterCompleto = false;
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
        cerrarOverlay
    };

})();
