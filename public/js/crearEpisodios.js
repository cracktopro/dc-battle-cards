/**
 * Editor visual de JSON de episodios (crearEpisodios.html).
 * Acceso solo por URL directa; persiste vía /api/episodios-editor/*.
 */
(function () {
    'use strict';

    const M = window.DCCrearEpisodiosModel;
    if (!M) {
        document.body.innerHTML = '<p style="color:#fff;padding:2rem">Falta crearEpisodiosModel.js</p>';
        return;
    }

    const $ = (id) => document.getElementById(id);
    const toolbar = $('crear-ep-toolbar');
    const aviso = $('crear-ep-aviso');
    const layout = $('crear-ep-layout');
    const listaArchivos = $('crear-ep-lista-archivos');
    const arbol = $('crear-ep-arbol');
    const inspector = $('crear-ep-inspector');
    const dialogJson = $('crear-ep-dialog-json');
    const jsonTextarea = $('crear-ep-json-textarea');
    const jsonError = $('crear-ep-json-error');
    const toast = $('crear-ep-toast');

    let recursos = { bustos: [], fondos: [], tableros: [] };
    let archivos = [];
    let state = {
        fileName: null,
        data: null,
        dirty: false,
        sel: { kind: 'meta' },
        /** Claves "capIdx-eventIdx" de cutscenes con diálogos desplegados */
        expandedCutscenes: new Set(),
    };

    function cutsceneExpandKey(capIdx, eventIdx) {
        return `${capIdx}-${eventIdx}`;
    }

    function isCutsceneExpanded(capIdx, eventIdx) {
        return state.expandedCutscenes.has(cutsceneExpandKey(capIdx, eventIdx));
    }

    function expandCutscene(capIdx, eventIdx) {
        state.expandedCutscenes.add(cutsceneExpandKey(capIdx, eventIdx));
    }

    function collapseCutscene(capIdx, eventIdx) {
        state.expandedCutscenes.delete(cutsceneExpandKey(capIdx, eventIdx));
    }

    function toggleCutsceneExpanded(capIdx, eventIdx) {
        const key = cutsceneExpandKey(capIdx, eventIdx);
        if (state.expandedCutscenes.has(key)) {
            state.expandedCutscenes.delete(key);
            return false;
        }
        state.expandedCutscenes.add(key);
        return true;
    }

    async function api(path, opts = {}) {
        const res = await fetch(path, {
            headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
            ...opts,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (res.status === 404 && String(path).includes('/api/episodios-editor')) {
                const err = new Error('EPISODIOS_EDITOR_API_MISSING');
                err.code = 'EPISODIOS_EDITOR_API_MISSING';
                throw err;
            }
            throw new Error(body.error || body.detalle || `HTTP ${res.status}`);
        }
        return body;
    }

    function toastMsg(msg, esError = false) {
        if (!toast) return;
        toast.textContent = msg;
        toast.hidden = false;
        toast.classList.toggle('crear-ep-toast--error', esError);
        clearTimeout(toastMsg._t);
        toastMsg._t = setTimeout(() => { toast.hidden = true; }, 3200);
    }

    function confirmarCambiosSinGuardar() {
        if (!state.dirty) return true;
        return window.confirm('Hay cambios sin guardar. ¿Descartarlos?');
    }

    function marcarDirty() {
        state.dirty = true;
        renderToolbar();
    }

    function setSel(sel, opts = {}) {
        state.sel = sel;
        if (!opts.skipExpand && sel.kind === 'evento') {
            const ev = state.data?.capitulos?.[sel.capIdx]?.timeline?.[sel.eventIdx];
            if (ev && String(ev.type || '').toLowerCase() === 'cutscene') {
                expandCutscene(sel.capIdx, sel.eventIdx);
            }
        }
        if (!opts.skipExpand && sel.kind === 'dialogo') {
            expandCutscene(sel.capIdx, sel.eventIdx);
        }
        renderArbol();
        renderInspector();
    }

    function getCap() {
        const i = state.sel.capIdx;
        return state.data?.capitulos?.[i];
    }

    function getEvento() {
        const cap = getCap();
        if (!cap) return null;
        return cap.timeline?.[state.sel.eventIdx];
    }

    function getLinea() {
        const ev = getEvento();
        if (!ev || !Array.isArray(ev.dialogos)) return null;
        return ev.dialogos[state.sel.dialogoIdx];
    }

    function moverEnArray(arr, idx, delta) {
        const j = idx + delta;
        if (!arr || j < 0 || j >= arr.length) return;
        const t = arr[idx];
        arr[idx] = arr[j];
        arr[j] = t;
        marcarDirty();
    }

    function eliminarEnArray(arr, idx) {
        if (!arr || idx < 0 || idx >= arr.length) return;
        arr.splice(idx, 1);
        marcarDirty();
    }

    function fieldText(label, value, onChange, opts = {}) {
        const wrap = document.createElement('div');
        wrap.className = 'crear-ep-field';
        const lab = document.createElement('label');
        lab.textContent = label;
        const input = document.createElement(opts.multiline ? 'textarea' : 'input');
        if (!opts.multiline) input.type = 'text';
        input.value = value ?? '';
        input.addEventListener('change', () => onChange(input.value));
        if (opts.placeholder) input.placeholder = opts.placeholder;
        wrap.appendChild(lab);
        wrap.appendChild(input);
        if (opts.ayuda) {
            const p = document.createElement('p');
            p.className = 'crear-ep-field-ayuda';
            p.textContent = opts.ayuda;
            wrap.appendChild(p);
        }
        return wrap;
    }

    function fieldNum(label, value, onChange) {
        const wrap = document.createElement('div');
        wrap.className = 'crear-ep-field';
        const lab = document.createElement('label');
        lab.textContent = label;
        const input = document.createElement('input');
        input.type = 'number';
        input.value = value ?? 0;
        input.addEventListener('change', () => onChange(Number(input.value)));
        wrap.appendChild(lab);
        wrap.appendChild(input);
        return wrap;
    }

    function fieldCheck(label, checked, onChange) {
        const wrap = document.createElement('div');
        wrap.className = 'crear-ep-field crear-ep-field--row';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!checked;
        input.addEventListener('change', () => onChange(input.checked));
        const lab = document.createElement('label');
        lab.textContent = label;
        wrap.appendChild(input);
        wrap.appendChild(lab);
        return wrap;
    }

    function fieldSelect(label, value, options, onChange, allowEmpty = true) {
        const wrap = document.createElement('div');
        wrap.className = 'crear-ep-field';
        const lab = document.createElement('label');
        lab.textContent = label;
        const sel = document.createElement('select');
        sel.className = 'crear-ep-select';
        if (allowEmpty) {
            const o0 = document.createElement('option');
            o0.value = '';
            o0.textContent = '—';
            sel.appendChild(o0);
        }
        options.forEach((opt) => {
            const o = document.createElement('option');
            o.value = opt;
            o.textContent = opt;
            if (opt === value) o.selected = true;
            sel.appendChild(o);
        });
        if (value && !options.includes(value)) {
            const ox = document.createElement('option');
            ox.value = value;
            ox.textContent = value;
            ox.selected = true;
            sel.appendChild(ox);
        }
        sel.addEventListener('change', () => onChange(sel.value));
        wrap.appendChild(lab);
        wrap.appendChild(sel);
        return wrap;
    }

    function btn(texto, clase, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `crear-ep-btn ${clase || ''}`.trim();
        b.textContent = texto;
        b.addEventListener('click', onClick);
        return b;
    }

    function btnIcono(simbolo, title, onClick) {
        const b = btn(simbolo, 'crear-ep-btn--icono', onClick);
        b.title = title;
        return b;
    }

    function renderPersonajesEscena(contenedor, lista, onUpdate) {
        const sub = document.createElement('div');
        sub.className = 'crear-ep-sublista';
        const tit = document.createElement('p');
        tit.className = 'crear-ep-bloque-titulo';
        tit.textContent = 'Personajes en escena';
        sub.appendChild(tit);

        (lista || []).forEach((p, pi) => {
            const box = document.createElement('div');
            box.className = 'crear-ep-bloque';
            box.style.marginBottom = '8px';
            box.appendChild(fieldText('id_character', p.id_character, (v) => { p.id_character = v; onUpdate(); }));
            box.appendChild(fieldSelect('bust_image', p.bust_image, recursos.bustos, (v) => { p.bust_image = v; onUpdate(); }));
            box.appendChild(fieldText('side', p.side, (v) => { p.side = v; onUpdate(); }, { ayuda: 'Ej: 35% o 120px' }));
            box.appendChild(fieldText('nombre', p.nombre, (v) => { p.nombre = v; onUpdate(); }));
            box.appendChild(fieldCheck('visible', p.visible !== false, (v) => { p.visible = v; onUpdate(); }));
            const acc = document.createElement('div');
            acc.className = 'crear-ep-fila-acciones';
            acc.appendChild(btnIcono('↑', 'Subir', () => { moverEnArray(lista, pi, -1); onUpdate(); renderInspector(); }));
            acc.appendChild(btnIcono('↓', 'Bajar', () => { moverEnArray(lista, pi, 1); onUpdate(); renderInspector(); }));
            acc.appendChild(btn('Eliminar', 'crear-ep-btn--peligro', () => {
                eliminarEnArray(lista, pi);
                onUpdate();
                renderInspector();
            }));
            box.appendChild(acc);
            sub.appendChild(box);
        });

        const add = btn('+ Personaje', 'crear-ep-btn--secundario', () => {
            if (!Array.isArray(lista)) return;
            lista.push(M.crearPersonajeEscena());
            onUpdate();
            renderInspector();
        });
        sub.appendChild(add);
        contenedor.appendChild(sub);
    }

    function crearSelectAccion(className, optionsHtml, onChange) {
        const sel = document.createElement('select');
        sel.className = `crear-ep-select ${className || ''}`.trim();
        sel.innerHTML = optionsHtml;
        sel.addEventListener('change', () => {
            const v = sel.value;
            if (!v) return;
            onChange(v);
            sel.value = '';
        });
        return sel;
    }

    function renderItemRow(label, badgeText, badgeClass, selKey, onSelect, idx, arr) {
        const row = document.createElement('div');
        row.className = 'crear-ep-item' + (selKey ? ' crear-ep-item--sel' : '');
        row.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            onSelect(e);
        });
        const badge = document.createElement('span');
        badge.className = `crear-ep-item-tipo ${badgeClass || ''}`.trim();
        badge.textContent = badgeText || 'item';
        const lab = document.createElement('span');
        lab.className = 'crear-ep-item-label';
        lab.textContent = label;
        const acc = document.createElement('div');
        acc.className = 'crear-ep-item-acciones';
        acc.appendChild(btnIcono('↑', 'Subir', (e) => { e.stopPropagation(); moverEnArray(arr, idx, -1); renderAll(); }));
        acc.appendChild(btnIcono('↓', 'Bajar', (e) => { e.stopPropagation(); moverEnArray(arr, idx, 1); renderAll(); }));
        acc.appendChild(btnIcono('×', 'Eliminar', (e) => {
            e.stopPropagation();
            if (!window.confirm('¿Eliminar este elemento?')) return;
            eliminarEnArray(arr, idx);
            setSel({ kind: 'capitulo', capIdx: state.sel.capIdx });
            renderAll();
        }));
        row.appendChild(badge);
        row.appendChild(lab);
        row.appendChild(acc);
        return row;
    }

    function isSel(kind, capIdx, eventIdx, dialogoIdx) {
        const s = state.sel;
        return s.kind === kind
            && s.capIdx === capIdx
            && (eventIdx === undefined || s.eventIdx === eventIdx)
            && (dialogoIdx === undefined || s.dialogoIdx === dialogoIdx);
    }

    function renderArbol() {
        if (!arbol || !state.data) return;
        arbol.innerHTML = '';

        const meta = document.createElement('div');
        meta.className = 'crear-ep-bloque';
        const metaRow = document.createElement('div');
        metaRow.className = 'crear-ep-item' + (state.sel.kind === 'meta' ? ' crear-ep-item--sel' : '');
        metaRow.addEventListener('click', () => setSel({ kind: 'meta' }));
        metaRow.innerHTML = '<span class="crear-ep-item-tipo">meta</span><span class="crear-ep-item-label">Episodio · ' + (state.data.nombre || '—') + '</span>';
        meta.appendChild(metaRow);
        arbol.appendChild(meta);

        state.data.capitulos.forEach((cap, ci) => {
            const bloque = document.createElement('div');
            bloque.className = 'crear-ep-bloque';
            const cab = document.createElement('div');
            cab.className = 'crear-ep-capitulo-cabecera';
            const capItem = document.createElement('div');
            capItem.className = 'crear-ep-item' + (isSel('capitulo', ci) ? ' crear-ep-item--sel' : '');
            capItem.style.flex = '1';
            capItem.addEventListener('click', () => setSel({ kind: 'capitulo', capIdx: ci }));
            capItem.innerHTML = `<span class="crear-ep-item-tipo">cap</span><span class="crear-ep-item-label">${cap.nombre || cap.capitulo_id}</span>`;
            cab.appendChild(capItem);

            cab.appendChild(crearSelectAccion(
                'crear-ep-select--toolbar',
                '<option value="">+ Evento</option>'
                + '<option value="cutscene">Cutscene</option>'
                + '<option value="escena">Escena (timeline)</option>'
                + '<option value="combate">Combate</option>'
                + '<option value="recompensa">Recompensa</option>',
                (tipo) => {
                    cap.timeline.push(M.crearEventoTimeline(tipo));
                    const ti = cap.timeline.length - 1;
                    marcarDirty();
                    if (tipo === 'cutscene') {
                        expandCutscene(ci, ti);
                    }
                    setSel({ kind: 'evento', capIdx: ci, eventIdx: ti });
                    renderAll();
                }
            ));
            bloque.appendChild(cab);

            (cap.timeline || []).forEach((ev, ti) => {
                const t = String(ev.type || '').toLowerCase();
                const expandido = t === 'cutscene' && isCutsceneExpanded(ci, ti);
                let etiquetaEv = M.etiquetaEvento(ev);
                if (t === 'cutscene') {
                    etiquetaEv = (expandido ? '▼ ' : '▶ ') + etiquetaEv;
                }
                bloque.appendChild(renderItemRow(
                    etiquetaEv,
                    t,
                    `crear-ep-item-tipo--${t}`,
                    isSel('evento', ci, ti) && state.sel.kind === 'evento',
                    (e) => {
                        if (t !== 'cutscene') {
                            setSel({ kind: 'evento', capIdx: ci, eventIdx: ti });
                            return;
                        }
                        e.stopPropagation();
                        const eventoActivo = isSel('evento', ci, ti) && state.sel.kind === 'evento';
                        if (expandido && eventoActivo) {
                            collapseCutscene(ci, ti);
                            setSel({ kind: 'capitulo', capIdx: ci }, { skipExpand: true });
                        } else {
                            expandCutscene(ci, ti);
                            setSel({ kind: 'evento', capIdx: ci, eventIdx: ti });
                        }
                    },
                    ti,
                    cap.timeline
                ));

                if (t === 'cutscene' && expandido) {
                    const sub = document.createElement('div');
                    sub.className = 'crear-ep-sublista';
                    (ev.dialogos || []).forEach((linea, di) => {
                        const badge = M.badgeLineaDialogo(linea);
                        sub.appendChild(renderItemRow(
                            M.etiquetaLineaDialogo(linea),
                            badge.text,
                            badge.class,
                            isSel('dialogo', ci, ti, di),
                            (e) => {
                                e.stopPropagation();
                                expandCutscene(ci, ti);
                                setSel({
                                    kind: 'dialogo',
                                    capIdx: ci,
                                    eventIdx: ti,
                                    dialogoIdx: di,
                                }, { skipExpand: true });
                            },
                            di,
                            ev.dialogos
                        ));
                    });
                    sub.appendChild(crearSelectAccion(
                        'crear-ep-select--inline',
                        '<option value="">+ Línea / comando</option>'
                        + '<option value="dialogo">Diálogo</option>'
                        + '<option value="voz_en_off">Voz en off</option>'
                        + '<option value="comando_escena">CMD · Comando escena</option>'
                        + '<option value="fondo_negro">CMD · Fondo negro</option>'
                        + '<option value="fundido_negro">CMD · Fundido a negro</option>'
                        + '<option value="fundido_fondo">CMD · Fundido a fondo</option>',
                        (tipoLinea) => {
                            const linea = M.crearLineaDialogo(tipoLinea);
                            if (tipoLinea === 'voz_en_off') {
                                linea.voz_en_off = true;
                            }
                            ev.dialogos.push(linea);
                            marcarDirty();
                            expandCutscene(ci, ti);
                            setSel({
                                kind: 'dialogo',
                                capIdx: ci,
                                eventIdx: ti,
                                dialogoIdx: ev.dialogos.length - 1,
                            }, { skipExpand: true });
                            renderAll();
                        }
                    ));
                    bloque.appendChild(sub);
                }
            });

            arbol.appendChild(bloque);
        });

        const addCap = btn('+ Capítulo', 'crear-ep-btn--secundario', () => {
            const n = state.data.capitulos.length;
            state.data.capitulos.push(M.crearCapituloVacio(n));
            marcarDirty();
            setSel({ kind: 'capitulo', capIdx: n });
            renderAll();
        });
        addCap.style.marginTop = '12px';
        arbol.appendChild(addCap);
    }

    function renderInspectorMeta() {
        const d = state.data;
        inspector.appendChild(fieldText('episodio_id', d.episodio_id, (v) => { d.episodio_id = v; marcarDirty(); renderArbol(); }));
        inspector.appendChild(fieldText('nombre', d.nombre, (v) => { d.nombre = v; marcarDirty(); renderArbol(); }));
        inspector.appendChild(fieldText('_comentario (opcional)', d._comentario || '', (v) => {
            if (v) d._comentario = v; else delete d._comentario;
            marcarDirty();
        }, { ayuda: 'Solo documentación; el motor lo ignora.' }));
    }

    function renderInspectorCapitulo() {
        const cap = getCap();
        if (!cap) return;
        inspector.appendChild(fieldText('capitulo_id', cap.capitulo_id, (v) => { cap.capitulo_id = v; marcarDirty(); renderArbol(); }));
        inspector.appendChild(fieldText('nombre', cap.nombre, (v) => { cap.nombre = v; marcarDirty(); renderArbol(); }));
        inspector.appendChild(fieldText('descripcion', cap.descripcion, (v) => { cap.descripcion = v; marcarDirty(); }, { multiline: true }));
        const del = btn('Eliminar capítulo', 'crear-ep-btn--peligro', () => {
            if (state.data.capitulos.length <= 1) {
                toastMsg('Debe quedar al menos un capítulo.', true);
                return;
            }
            if (!window.confirm('¿Eliminar este capítulo?')) return;
            state.data.capitulos.splice(state.sel.capIdx, 1);
            marcarDirty();
            setSel({ kind: 'meta' });
            renderAll();
        });
        del.style.marginTop = '16px';
        inspector.appendChild(del);
    }

    function renderInspectorCutscene(ev) {
        M.normalizarEscenaEnCutscene(ev);

        inspector.appendChild(fieldText('cutscene_id', ev.cutscene_id, (v) => { ev.cutscene_id = v; marcarDirty(); renderArbol(); }));
        inspector.appendChild(fieldSelect('background_image', ev.background_image, recursos.fondos, (v) => { ev.background_image = v; marcarDirty(); }));
        inspector.appendChild(fieldText('fondo_inicial', ev.fondo_inicial || '', (v) => { ev.fondo_inicial = v; marcarDirty(); }, { ayuda: 'Escribe negro para empezar en negro (también fondo_negro: true).' }));
        inspector.appendChild(fieldCheck('fondo_negro', ev.fondo_negro === true, (v) => { ev.fondo_negro = v || undefined; marcarDirty(); }));
        inspector.appendChild(fieldCheck('ocultar_ausentes (cutscene)', ev.ocultar_ausentes === true, (v) => { ev.ocultar_ausentes = v || undefined; marcarDirty(); }));

        const hEsc = document.createElement('p');
        hEsc.className = 'crear-ep-field-ayuda';
        hEsc.textContent = 'Escena inicial del cutscene (array escena / escena_inicial / personajes_iniciales en JSON).';
        inspector.appendChild(hEsc);

        if (!Array.isArray(ev.escena)) ev.escena = [];
        renderPersonajesEscena(inspector, ev.escena, () => { marcarDirty(); renderArbol(); });

        const hDlg = document.createElement('p');
        hDlg.className = 'crear-ep-bloque-titulo';
        hDlg.style.marginTop = '16px';
        hDlg.textContent = 'Diálogos y comandos (líneas)';
        inspector.appendChild(hDlg);

        const ayudaDlg = document.createElement('p');
        ayudaDlg.className = 'crear-ep-field-ayuda';
        ayudaDlg.textContent = 'Colores en texto: #azul# $rojo$ %amarillo%. Salto de línea: \\n en el campo texto.';
        inspector.appendChild(ayudaDlg);
    }

    function renderInspectorEscenaTimeline(ev) {
        inspector.appendChild(fieldText('titulo', ev.titulo || '', (v) => { ev.titulo = v; marcarDirty(); renderArbol(); }));
        inspector.appendChild(fieldText('texto / descripcion', ev.texto || ev.descripcion || '', (v) => { ev.texto = v; marcarDirty(); renderArbol(); }, { multiline: true }));
        inspector.appendChild(fieldSelect('background_image', ev.background_image, recursos.fondos, (v) => { ev.background_image = v; marcarDirty(); }));
        inspector.appendChild(fieldCheck('limpiar_escena', ev.limpiar_escena === true, (v) => { ev.limpiar_escena = v || undefined; marcarDirty(); }));
        inspector.appendChild(fieldCheck('ocultar_ausentes', ev.ocultar_ausentes === true, (v) => { ev.ocultar_ausentes = v || undefined; marcarDirty(); }));
        inspector.appendChild(fieldCheck('auto', ev.auto !== false, (v) => { ev.auto = v; marcarDirty(); }));
        if (!Array.isArray(ev.escena)) ev.escena = [];
        renderPersonajesEscena(inspector, ev.escena, () => { marcarDirty(); renderArbol(); });
    }

    function renderInspectorCombate(ev) {
        inspector.appendChild(fieldText('combate_id', ev.combate_id, (v) => { ev.combate_id = v; marcarDirty(); renderArbol(); }));
        inspector.appendChild(fieldSelect('tablero', ev.tablero, recursos.tableros, (v) => { ev.tablero = v; marcarDirty(); }));
        inspector.appendChild(fieldText('cartas_jugador (coma)', M.listaATexto(ev.cartas_jugador), (v) => {
            ev.cartas_jugador = M.parsearListaTexto(v);
            marcarDirty();
        }));
        inspector.appendChild(fieldNum('nivel_jugador (0 = colección)', ev.nivel_jugador ?? 1, (v) => { ev.nivel_jugador = v; marcarDirty(); }));
        inspector.appendChild(fieldText('cartas_BOT (coma)', M.listaATexto(ev.cartas_BOT), (v) => {
            ev.cartas_BOT = M.parsearListaTexto(v);
            marcarDirty();
        }));
        inspector.appendChild(fieldNum('nivel_BOT', ev.nivel_BOT ?? 1, (v) => { ev.nivel_BOT = v; marcarDirty(); }));
    }

    function renderInspectorRecompensa(ev) {
        inspector.appendChild(fieldNum('monedas', ev.monedas ?? 0, (v) => { ev.monedas = v; marcarDirty(); renderArbol(); }));
        inspector.appendChild(fieldText('objetos (coma)', M.listaATexto(ev.objetos), (v) => { ev.objetos = M.parsearListaTexto(v); marcarDirty(); }));
        inspector.appendChild(fieldText('cartas (coma)', M.listaATexto(ev.cartas), (v) => { ev.cartas = M.parsearListaTexto(v); marcarDirty(); }));
        inspector.appendChild(fieldText('skins (coma)', M.listaATexto(ev.skins), (v) => { ev.skins = M.parsearListaTexto(v); marcarDirty(); }));
    }

    function renderInspectorDialogo(linea) {
        const tipo = M.tipoLineaDialogo(linea);
        if (tipo === 'comando_escena') {
            inspector.appendChild(fieldCheck('auto', linea.auto !== false, (v) => { linea.auto = v; marcarDirty(); }));
            if (!Array.isArray(linea.escena)) linea.escena = [];
            renderPersonajesEscena(inspector, linea.escena, () => { marcarDirty(); renderArbol(); });
            return;
        }
        if (tipo === 'fondo_negro') {
            inspector.appendChild(fieldCheck('auto', linea.auto !== false, (v) => { linea.auto = v; marcarDirty(); }));
            return;
        }
        if (tipo === 'fundido_negro') {
            inspector.appendChild(fieldNum('duracion (ms)', linea.duracion ?? 700, (v) => { linea.duracion = v; marcarDirty(); }));
            inspector.appendChild(fieldCheck('auto', linea.auto !== false, (v) => { linea.auto = v; marcarDirty(); }));
            return;
        }
        if (tipo === 'fundido_fondo') {
            inspector.appendChild(fieldSelect('background_image', linea.background_image, recursos.fondos, (v) => { linea.background_image = v; marcarDirty(); }));
            inspector.appendChild(fieldNum('duracion (ms)', linea.duracion ?? 700, (v) => { linea.duracion = v; marcarDirty(); }));
            inspector.appendChild(fieldCheck('auto', linea.auto !== false, (v) => { linea.auto = v; marcarDirty(); }));
            return;
        }

        inspector.appendChild(fieldText('dialogo_id', linea.dialogo_id || '', (v) => { linea.dialogo_id = v; marcarDirty(); renderArbol(); }));
        inspector.appendChild(fieldCheck('voz_en_off', linea.voz_en_off === true, (v) => { linea.voz_en_off = v || undefined; marcarDirty(); }));
        inspector.appendChild(fieldCheck('voz_en_off_sin_personaje', linea.voz_en_off_sin_personaje === true, (v) => {
            linea.voz_en_off_sin_personaje = v || undefined;
            marcarDirty();
        }));
        inspector.appendChild(fieldText('id_character', linea.id_character || '', (v) => { linea.id_character = v; marcarDirty(); }));
        inspector.appendChild(fieldText('nombre', linea.nombre || '', (v) => { linea.nombre = v; marcarDirty(); renderArbol(); }));
        inspector.appendChild(fieldSelect('bust_image', linea.bust_image, recursos.bustos, (v) => { linea.bust_image = v; marcarDirty(); }));
        inspector.appendChild(fieldText('side', linea.side || '', (v) => { linea.side = v; marcarDirty(); }));
        inspector.appendChild(fieldCheck('visible', linea.visible !== false, (v) => { linea.visible = v; marcarDirty(); }));
        inspector.appendChild(fieldText('texto', linea.texto || '', (v) => { linea.texto = v; marcarDirty(); renderArbol(); }, {
            multiline: true,
            ayuda: '#azul# $rojo$ %amarillo% · \\n para salto de línea',
        }));

        if (!Array.isArray(linea.escena)) linea.escena = [];
        if (linea.escena.length) {
            renderPersonajesEscena(inspector, linea.escena, () => { marcarDirty(); renderArbol(); });
        } else {
            const addEsc = btn('+ Escena en esta línea', 'crear-ep-btn--secundario', () => {
                linea.escena = [M.crearPersonajeEscena()];
                marcarDirty();
                renderInspector();
            });
            inspector.appendChild(addEsc);
        }
    }

    function renderInspector() {
        if (!inspector) return;
        inspector.innerHTML = '';
        if (!state.data) {
            inspector.innerHTML = '<p class="crear-ep-field-ayuda">Selecciona o crea un archivo JSON.</p>';
            return;
        }

        const s = state.sel;
        if (s.kind === 'meta') {
            renderInspectorMeta();
            return;
        }
        if (s.kind === 'capitulo') {
            renderInspectorCapitulo();
            return;
        }
        if (s.kind === 'evento') {
            const ev = getEvento();
            if (!ev) return;
            const t = String(ev.type || '').toLowerCase();
            if (t === 'cutscene') renderInspectorCutscene(ev);
            else if (t === 'escena') renderInspectorEscenaTimeline(ev);
            else if (t === 'combate') renderInspectorCombate(ev);
            else if (t === 'recompensa') renderInspectorRecompensa(ev);
            else inspector.appendChild(fieldText('type', ev.type, (v) => { ev.type = v; marcarDirty(); renderArbol(); }));
            return;
        }
        if (s.kind === 'dialogo') {
            const linea = getLinea();
            if (linea) renderInspectorDialogo(linea);
        }
    }

    function renderToolbar() {
        if (!toolbar) return;
        toolbar.innerHTML = '';
        if (state.fileName) {
            const span = document.createElement('span');
            span.className = 'crear-ep-archivo-activo';
            span.innerHTML = 'Archivo: <strong>' + state.fileName + '</strong>' + (state.dirty ? ' · sin guardar' : '');
            toolbar.appendChild(span);
        }
        toolbar.appendChild(btn('Nuevo JSON', 'crear-ep-btn--secundario', crearArchivoNuevo));
        toolbar.appendChild(btn('Guardar', 'crear-ep-btn--primario', guardarArchivo));
        toolbar.appendChild(btn('Validar', 'crear-ep-btn--secundario', validarActual));
        toolbar.appendChild(btn('Vista JSON', 'crear-ep-btn--secundario', abrirVistaJson));
    }

    function renderListaArchivos() {
        if (!listaArchivos) return;
        listaArchivos.innerHTML = '';
        archivos.forEach((nombre) => {
            const li = document.createElement('li');
            li.className = 'crear-ep-archivo-item';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'crear-ep-archivo-btn' + (nombre === state.fileName ? ' crear-ep-archivo-btn--activo' : '');
            b.textContent = nombre;
            b.addEventListener('click', () => cargarArchivo(nombre));
            li.appendChild(b);
            listaArchivos.appendChild(li);
        });
    }

    function renderAll() {
        renderToolbar();
        renderListaArchivos();
        renderArbol();
        renderInspector();
    }

    async function cargarRecursos() {
        recursos = await api('/api/episodios-editor/recursos');
    }

    async function cargarListaArchivos() {
        const res = await api('/api/episodios-editor/archivos');
        archivos = res.archivos || [];
    }

    async function cargarArchivo(nombre) {
        if (!confirmarCambiosSinGuardar()) return;
        const res = await api(`/api/episodios-editor/archivo/${encodeURIComponent(nombre)}`);
        state.fileName = res.nombre;
        state.data = M.normalizarEpisodio(res.data);
        state.dirty = false;
        state.sel = { kind: 'meta' };
        state.expandedCutscenes = new Set();
        renderAll();
        toastMsg('Cargado: ' + nombre);
    }

    async function guardarArchivo() {
        if (!state.fileName || !state.data) {
            toastMsg('No hay archivo cargado.', true);
            return;
        }
        const val = M.validarEpisodio(state.data);
        if (!val.ok) {
            toastMsg(val.errores[0] || 'Validación fallida', true);
            window.alert('Errores de validación:\n\n' + val.errores.join('\n'));
            return;
        }
        const payload = M.limpiarParaGuardar(state.data);
        delete payload.timeline;
        await api(`/api/episodios-editor/archivo/${encodeURIComponent(state.fileName)}`, {
            method: 'PUT',
            body: JSON.stringify({ data: payload }),
        });
        state.dirty = false;
        renderToolbar();
        toastMsg('Guardado correctamente.');
    }

    function validarActual() {
        const val = M.validarEpisodio(state.data);
        if (val.ok) {
            toastMsg('Estructura válida.');
        } else {
            window.alert('Errores:\n\n' + val.errores.join('\n'));
            toastMsg(val.errores[0], true);
        }
    }

    function crearArchivoNuevo() {
        if (!confirmarCambiosSinGuardar()) return;
        const nombre = window.prompt('Nombre del archivo (ej: episodio3.json):', 'episodio_nuevo.json');
        if (!nombre) return;
        const base = nombre.endsWith('.json') ? nombre : `${nombre}.json`;
        const data = M.crearEpisodioVacio();
        api('/api/episodios-editor/archivo', {
            method: 'POST',
            body: JSON.stringify({ nombre: base, data }),
        }).then(async () => {
            await cargarListaArchivos();
            await cargarArchivo(base);
            toastMsg('Archivo creado.');
        }).catch((e) => toastMsg(e.message, true));
    }

    function abrirVistaJson() {
        if (!state.data || !dialogJson) return;
        jsonTextarea.value = JSON.stringify(state.data, null, 2);
        jsonError.hidden = true;
        dialogJson.showModal();
    }

    async function init() {
        try {
            const hab = await api('/api/episodios-editor/habilitado');
            if (!hab.habilitado) {
                aviso.hidden = false;
                aviso.textContent = 'El editor de episodios no está habilitado en producción. En local funciona por defecto; en servidor define EPISODIOS_EDITOR=1.';
                return;
            }
        } catch (e) {
            aviso.hidden = false;
            if (e.code === 'EPISODIOS_EDITOR_API_MISSING' || e.message === 'EPISODIOS_EDITOR_API_MISSING') {
                aviso.textContent =
                    'El servidor en ejecución no tiene las rutas del editor de episodios. '
                    + 'Detén el proceso actual y vuelve a arrancar con npm run dev o npm start '
                    + '(después de actualizar server.js con /api/episodios-editor/*).';
            } else {
                aviso.textContent = 'No se pudo conectar con el servidor: ' + e.message;
            }
            return;
        }

        layout.hidden = false;
        await cargarRecursos();
        await cargarListaArchivos();
        renderAll();

        $('crear-ep-json-cancelar')?.addEventListener('click', () => dialogJson.close());
        dialogJson?.addEventListener('close', () => {
            if (dialogJson.returnValue !== 'default' && dialogJson.returnValue !== 'submit') return;
        });
        dialogJson?.querySelector('form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            try {
                const parsed = JSON.parse(jsonTextarea.value);
                state.data = M.normalizarEpisodio(parsed);
                state.dirty = true;
                jsonError.hidden = true;
                dialogJson.close();
                renderAll();
                toastMsg('JSON aplicado en memoria. Pulsa Guardar para escribir el archivo.');
            } catch (err) {
                jsonError.hidden = false;
                jsonError.textContent = err.message;
            }
        });

        window.addEventListener('beforeunload', (e) => {
            if (state.dirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    init();
})();
