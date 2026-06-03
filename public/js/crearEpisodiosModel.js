/**
 * Modelo y validación para JSON de episodios (editor crearEpisodios).
 */
(function (root) {
    function clone(o) {
        return JSON.parse(JSON.stringify(o));
    }

    function crearCapituloVacio(idx = 0) {
        const n = String(idx + 1).padStart(2, '0');
        return {
            capitulo_id: `cap_${n}`,
            nombre: `Capítulo ${idx + 1}`,
            descripcion: '',
            timeline: [],
        };
    }

    function crearEpisodioVacio() {
        return {
            evento_id: 0,
            nombre: 'Nuevo episodio',
            descripcion: '',
            imagen: '',
            capitulos: [crearCapituloVacio(0)],
        };
    }

    function normalizarEscenaEnCutscene(ev) {
        if (!ev || String(ev.type || '').toLowerCase() !== 'cutscene') {
            return;
        }
        const alt = ev.escena_inicial || ev.personajes_iniciales;
        if ((!Array.isArray(ev.escena) || !ev.escena.length) && Array.isArray(alt) && alt.length) {
            ev.escena = clone(alt);
        }
        if (!Array.isArray(ev.dialogos)) {
            ev.dialogos = [];
        }
    }

    function normalizarEpisodio(raw) {
        const data = raw && typeof raw === 'object' ? clone(raw) : crearEpisodioVacio();
        if (data.evento_id == null && data.episodio_id != null && data.episodio_id !== '') {
            const n = Number(data.episodio_id);
            data.evento_id = Number.isFinite(n) ? n : data.episodio_id;
        }
        if (data.evento_id != null) {
            delete data.episodio_id;
        }
        if (data.evento_id == null) {
            data.evento_id = 0;
        }
        if (data.descripcion == null) {
            data.descripcion = '';
        }
        if (data.imagen == null) {
            data.imagen = '';
        }
        delete data.JSON_file;
        delete data.json_file;
        if (!Array.isArray(data.capitulos) || !data.capitulos.length) {
            const timeline = Array.isArray(data.timeline) ? data.timeline : [];
            data.capitulos = [{
                capitulo_id: 'cap_01',
                nombre: String(data.nombre || 'Capítulo 1'),
                descripcion: '',
                timeline,
            }];
            delete data.timeline;
        }
        data.capitulos = data.capitulos.map((cap, i) => ({
            capitulo_id: String(cap.capitulo_id || `cap_${String(i + 1).padStart(2, '0')}`),
            nombre: String(cap.nombre ?? `Capítulo ${i + 1}`),
            descripcion: String(cap.descripcion ?? ''),
            timeline: Array.isArray(cap.timeline) ? cap.timeline.map((ev) => {
                const copia = clone(ev);
                normalizarEscenaEnCutscene(copia);
                return copia;
            }) : [],
        }));
        return data;
    }

    function crearEventoTimeline(tipo) {
        const t = String(tipo || 'cutscene').toLowerCase();
        if (t === 'combate') {
            return {
                type: 'combate',
                combate_id: 'comb_01',
                tablero: 'tablero_background',
                cartas_jugador: [],
                nivel_jugador: 1,
                cartas_BOT: [],
                nivel_BOT: 1,
            };
        }
        if (t === 'recompensa') {
            return { type: 'recompensa', monedas: 0, objetos: [], cartas: [], skins: [] };
        }
        if (t === 'escena') {
            return {
                type: 'escena',
                titulo: '',
                texto: '',
                background_image: '',
                escena: [],
                auto: true,
            };
        }
        return {
            type: 'cutscene',
            cutscene_id: 'cs_01',
            background_image: '',
            fondo_inicial: '',
            dialogos: [],
            escena: [],
        };
    }

    function crearPersonajeEscena() {
        return {
            id_character: '',
            bust_image: '',
            side: '50%',
            nombre: '',
            visible: true,
        };
    }

    function crearLineaDialogo(tipo) {
        const t = String(tipo || 'dialogo').toLowerCase();
        if (t === 'escena' || t === 'comando_escena') {
            return { comando: 'escena', escena: [], auto: true };
        }
        if (t === 'fondo_negro') {
            return { comando: 'fondo_negro', auto: true };
        }
        if (t === 'fundido_negro') {
            return { comando: 'fundido_negro', duracion: 700, auto: true };
        }
        if (t === 'fundido_fondo') {
            return {
                comando: 'fundido_fondo',
                background_image: '',
                duracion: 700,
                auto: true,
            };
        }
        return {
            dialogo_id: `d_${Date.now().toString(36).slice(-6)}`,
            id_character: '',
            nombre: '',
            bust_image: '',
            side: '50%',
            visible: true,
            texto: '',
        };
    }

    function tipoLineaDialogo(linea) {
        if (!linea || typeof linea !== 'object') return 'desconocido';
        const cmd = String(linea.comando || linea.tipo || '').toLowerCase();
        if (cmd === 'escena') return 'comando_escena';
        if (!cmd && Array.isArray(linea.escena) && linea.escena.length && !String(linea.texto || '').trim()) {
            return 'comando_escena';
        }
        if (cmd === 'fondo_negro') return 'fondo_negro';
        if (cmd === 'fundido_negro' || cmd === 'fade_negro') return 'fundido_negro';
        if (cmd === 'fundido_fondo' || cmd === 'fade_fondo') return 'fundido_fondo';
        if (linea.voz_en_off) return 'voz_en_off';
        if (linea.texto != null || linea.dialogo_id) return 'dialogo';
        return 'vacio';
    }

    function etiquetaEvento(ev) {
        const t = String(ev?.type || '').toLowerCase();
        if (t === 'cutscene') {
            const n = (ev.dialogos || []).length;
            return `Cutscene · ${ev.cutscene_id || '—'} (${n} líneas)`;
        }
        if (t === 'escena') return `Escena · ${ev.titulo || ev.texto?.slice(0, 24) || '—'}`;
        if (t === 'combate') return `Combate · ${ev.combate_id || '—'}`;
        if (t === 'recompensa') return `Recompensa · ${ev.monedas || 0} monedas`;
        return t || 'Evento';
    }

    function etiquetaLineaDialogo(linea) {
        const tipo = tipoLineaDialogo(linea);
        if (tipo === 'comando_escena') {
            const n = (linea.escena || []).length;
            return `Comando escena (${n} personaje${n === 1 ? '' : 's'})`;
        }
        if (tipo === 'fondo_negro') return 'Comando · Fondo negro';
        if (tipo === 'fundido_negro') {
            return `Comando · Fundido a negro (${linea.duracion ?? 700} ms)`;
        }
        if (tipo === 'fundido_fondo') {
            const img = linea.background_image ? ` → ${linea.background_image}` : '';
            return `Comando · Fundido a fondo${img}`;
        }
        if (tipo === 'voz_en_off') return `Voz en off · ${(linea.texto || '').slice(0, 40)}`;
        return (linea.nombre || linea.id_character || 'Diálogo') + ': ' + (linea.texto || '').slice(0, 50);
    }

    /** Badge del árbol: dlg | cmd | voz */
    function badgeLineaDialogo(linea) {
        const tipo = tipoLineaDialogo(linea);
        if (tipo === 'comando_escena' || tipo === 'fondo_negro' || tipo === 'fundido_negro' || tipo === 'fundido_fondo') {
            return { text: 'cmd', class: 'crear-ep-item-tipo--cmd' };
        }
        if (tipo === 'voz_en_off') {
            return { text: 'voz', class: 'crear-ep-item-tipo--voz' };
        }
        return { text: 'dlg', class: 'crear-ep-item-tipo--dlg' };
    }

    function esLineaComando(linea) {
        const t = tipoLineaDialogo(linea);
        return t === 'comando_escena' || t === 'fondo_negro' || t === 'fundido_negro' || t === 'fundido_fondo';
    }

    function parsearListaTexto(str) {
        return String(str || '')
            .split(/[,;\n]/)
            .map((s) => s.trim())
            .filter(Boolean);
    }

    function listaATexto(arr) {
        return (Array.isArray(arr) ? arr : []).map((x) => String(x).trim()).filter(Boolean).join(', ');
    }

    function limpiarParaGuardar(data) {
        const out = JSON.parse(JSON.stringify(data));
        delete out.episodio_id;
        delete out.JSON_file;
        delete out.json_file;
        return out;
    }

    function validarEpisodio(data) {
        const errores = [];
        if (!data || typeof data !== 'object') {
            return { ok: false, errores: ['Datos de episodio inválidos.'] };
        }
        if (!String(data.nombre || '').trim()) {
            errores.push('Falta el nombre del episodio.');
        }
        if (data.evento_id == null && data.episodio_id == null) {
            errores.push('Falta evento_id (orden en carrusel).');
        }
        const caps = data.capitulos;
        if (!Array.isArray(caps) || !caps.length) {
            errores.push('Debe haber al menos un capítulo.');
        }
        (caps || []).forEach((cap, ci) => {
            const pref = `Capítulo ${ci + 1}`;
            if (!String(cap.capitulo_id || '').trim()) {
                errores.push(`${pref}: falta capitulo_id.`);
            }
            (cap.timeline || []).forEach((ev, ti) => {
                const t = String(ev?.type || '').toLowerCase();
                const ep = `${pref}, evento ${ti + 1}`;
                if (!t) {
                    errores.push(`${ep}: falta type.`);
                    return;
                }
                if (t === 'cutscene' && !Array.isArray(ev.dialogos)) {
                    errores.push(`${ep}: cutscene sin array dialogos.`);
                }
                if (t === 'combate') {
                    if (!Array.isArray(ev.cartas_jugador) || !ev.cartas_jugador.length) {
                        errores.push(`${ep}: combate sin cartas_jugador.`);
                    }
                    if (!Array.isArray(ev.cartas_BOT) || !ev.cartas_BOT.length) {
                        errores.push(`${ep}: combate sin cartas_BOT.`);
                    }
                }
            });
        });
        return { ok: errores.length === 0, errores };
    }

    root.DCCrearEpisodiosModel = {
        clone,
        crearEpisodioVacio,
        crearCapituloVacio,
        crearEventoTimeline,
        crearPersonajeEscena,
        crearLineaDialogo,
        normalizarEpisodio,
        tipoLineaDialogo,
        etiquetaEvento,
        etiquetaLineaDialogo,
        badgeLineaDialogo,
        esLineaComando,
        normalizarEscenaEnCutscene,
        parsearListaTexto,
        listaATexto,
        limpiarParaGuardar,
        validarEpisodio,
    };
}(typeof window !== 'undefined' ? window : globalThis));
