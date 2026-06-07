/**
 * Editor visual de desafios.xlsx (editarDesafios.html).
 */
(function () {
    'use strict';

    const M = window.DCEditarDesafiosModel;
    if (!M) {
        document.body.innerHTML = '<p style="color:#fff;padding:2rem">Falta editarDesafiosModel.js</p>';
        return;
    }

    const $ = (id) => document.getElementById(id);
    const toolbar = $('editar-desafios-toolbar');
    const aviso = $('editar-desafios-aviso');
    const layout = $('editar-desafios-layout');
    const listaEl = $('editar-desafios-lista');
    const formEl = $('editar-desafios-form');
    const erroresEl = $('editar-desafios-errores');
    const contadorEl = $('editar-desafios-contador');
    const toast = $('crear-ep-toast');

    let tablerosLista = [];
    let tableroPickerSession = null;
    let filasCatalogoCartas = [];
    let skinsIndexadosCache = null;

    let state = {
        columnas: M.COLUMNAS_DESAFIO.slice(),
        filas: [],
        filasAlCargar: 0,
        selIndex: -1,
        dirty: false,
    };

    async function api(path, opts = {}) {
        const res = await fetch(path, {
            headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
            ...opts,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (res.status === 404 && String(path).includes('/api/desafios-editor')) {
                const err = new Error('DESAFIOS_EDITOR_API_MISSING');
                err.code = 'DESAFIOS_EDITOR_API_MISSING';
                throw err;
            }
            throw window.DCEditorGuardadoSeguro?.errorDesdeRespuestaApi(body, res.status)
                || new Error(body.error || body.detalle || `HTTP ${res.status}`);
        }
        return body;
    }

    function toastMsg(msg, esError = false) {
        if (!toast) return;
        toast.textContent = msg;
        toast.hidden = false;
        toast.classList.toggle('crear-ep-toast--error', esError);
        clearTimeout(toastMsg._t);
        toastMsg._t = setTimeout(() => { toast.hidden = true; }, 3600);
    }

    function marcarDirty() {
        state.dirty = true;
        renderToolbar();
    }

    async function confirmarDescartar() {
        if (window.DCEditorDevNav?.confirmarAntesDeNavegar) {
            return window.DCEditorDevNav.confirmarAntesDeNavegar();
        }
        if (!state.dirty) return true;
        return window.confirm('Hay cambios sin guardar en desafios.xlsx. ¿Descartarlos?');
    }

    function getFilaActual() {
        if (state.selIndex < 0 || state.selIndex >= state.filas.length) return null;
        return state.filas[state.selIndex];
    }

    function filtrosLista() {
        return {
            nombre: $('filtro-nombre-desafio')?.value || '',
            faccion: $('filtro-faccion-desafio')?.value || 'todas',
            dificultad: $('filtro-dificultad-desafio')?.value || 'todas',
        };
    }

    function indicesFiltrados() {
        const f = filtrosLista();
        return state.filas
            .map((fila, i) => ({ fila, i }))
            .filter(({ fila }) => M.filaCoincideFiltros(fila, f))
            .map(({ i }) => i);
    }

    function btn(texto, clase, onClick) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `crear-ep-btn ${clase || ''}`.trim();
        b.textContent = texto;
        b.addEventListener('click', onClick);
        return b;
    }

    function fieldWrap(label, inputEl) {
        const wrap = document.createElement('div');
        wrap.className = 'crear-ep-field editar-desafios-field';
        const lab = document.createElement('label');
        lab.textContent = label;
        wrap.appendChild(lab);
        wrap.appendChild(inputEl);
        return wrap;
    }

    function fieldInput(label, value, onChange, opts = {}) {
        const input = document.createElement(opts.multiline ? 'textarea' : 'input');
        if (!opts.multiline) input.type = opts.type || 'text';
        input.value = value ?? '';
        if (opts.placeholder) input.placeholder = opts.placeholder;
        input.addEventListener('input', () => onChange(input.value));
        return fieldWrap(label, input);
    }

    function fieldSelect(label, value, options, onChange) {
        const sel = document.createElement('select');
        sel.className = 'crear-ep-select';
        options.forEach((opt) => {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            if (opt.value === value) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', () => onChange(sel.value));
        return fieldWrap(label, sel);
    }

    function urlTablero(nombre) {
        const n = String(nombre || '').trim();
        if (!n) return '';
        if (/\.(png|jpe?g|webp)$/i.test(n)) return `/resources/tableros/${encodeURIComponent(n)}`;
        return `/resources/tableros/${encodeURIComponent(n)}.png`;
    }

    function initTableroPicker() {
        const dialog = $('editar-desafios-dialog-tablero');
        const grid = $('editar-desafios-tablero-grid');
        const filtro = $('editar-desafios-tablero-filtro');
        const selLabel = $('editar-desafios-tablero-seleccion');
        if (!dialog || !grid || !filtro) return;

        function updateLabel() {
            if (!selLabel || !tableroPickerSession) return;
            selLabel.innerHTML = tableroPickerSession.pending
                ? `Selección: <strong>${tableroPickerSession.pending}</strong>`
                : 'Selección: <strong>— sin tablero —</strong>';
        }

        function seleccionar(nombre) {
            if (!tableroPickerSession) return;
            tableroPickerSession.pending = nombre;
            grid.querySelectorAll('.crear-ep-recurso-card').forEach((card) => {
                card.classList.toggle('crear-ep-recurso-card--sel', card.dataset.nombre === nombre);
            });
            updateLabel();
        }

        function crearCard(nombre, esVacio) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'crear-ep-recurso-card';
            card.dataset.nombre = nombre;
            if (nombre === tableroPickerSession?.pending) card.classList.add('crear-ep-recurso-card--sel');

            const media = document.createElement('div');
            media.className = 'crear-ep-recurso-card-media';
            if (esVacio) {
                const ph = document.createElement('span');
                ph.textContent = '—';
                ph.style.fontSize = '2rem';
                media.appendChild(ph);
            } else {
                const img = document.createElement('img');
                img.alt = nombre;
                img.loading = 'lazy';
                img.src = urlTablero(nombre);
                media.appendChild(img);
            }
            const cap = document.createElement('span');
            cap.className = 'crear-ep-recurso-card-nombre';
            cap.textContent = esVacio ? '(sin tablero)' : nombre;
            card.appendChild(media);
            card.appendChild(cap);
            card.addEventListener('click', () => seleccionar(nombre));
            card.addEventListener('dblclick', () => { seleccionar(nombre); confirmar(); });
            return card;
        }

        function pintar() {
            if (!tableroPickerSession) return;
            const q = filtro.value.trim().toLowerCase();
            grid.innerHTML = '';
            const items = tablerosLista.filter((n) => !q || String(n).toLowerCase().includes(q));
            const val = tableroPickerSession.value;
            if (val && !items.includes(val) && (!q || String(val).toLowerCase().includes(q))) {
                items.unshift(val);
            }
            grid.appendChild(crearCard('', true));
            items.forEach((n) => grid.appendChild(crearCard(n, false)));
        }

        function confirmar() {
            if (!tableroPickerSession) return;
            tableroPickerSession.onAccept(tableroPickerSession.pending);
            dialog.close();
            tableroPickerSession = null;
        }

        filtro.addEventListener('input', pintar);
        $('editar-desafios-tablero-aceptar')?.addEventListener('click', confirmar);
        $('editar-desafios-tablero-cancelar')?.addEventListener('click', () => {
            dialog.close();
            tableroPickerSession = null;
        });
        dialog.addEventListener('cancel', () => { tableroPickerSession = null; });

        window._abrirTableroPickerDesafios = function (opts) {
            tableroPickerSession = {
                value: opts.value || '',
                pending: opts.value || '',
                onAccept: opts.onAccept,
            };
            filtro.value = '';
            pintar();
            updateLabel();
            dialog.showModal();
            requestAnimationFrame(() => filtro.focus());
        };
    }

    function fieldTablero(label, value, onChange) {
        let current = value ?? '';
        const wrap = document.createElement('div');
        wrap.className = 'crear-ep-field';
        const lab = document.createElement('label');
        lab.textContent = label;

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'crear-ep-recurso-trigger';
        const thumb = document.createElement('img');
        thumb.className = 'crear-ep-recurso-trigger-thumb';
        thumb.alt = '';
        const meta = document.createElement('span');
        meta.className = 'crear-ep-recurso-trigger-meta';
        const nombreEl = document.createElement('span');
        nombreEl.className = 'crear-ep-recurso-trigger-nombre';
        const hint = document.createElement('span');
        hint.className = 'crear-ep-recurso-trigger-hint';
        hint.textContent = 'Clic para elegir tablero';
        meta.appendChild(nombreEl);
        meta.appendChild(hint);

        function refresh(v) {
            current = v ?? '';
            nombreEl.textContent = current || '— sin tablero —';
            if (current) {
                thumb.src = urlTablero(current);
                thumb.hidden = false;
            } else {
                thumb.hidden = true;
                thumb.removeAttribute('src');
            }
        }
        refresh(current);

        trigger.appendChild(thumb);
        trigger.appendChild(meta);
        trigger.addEventListener('click', () => {
            window._abrirTableroPickerDesafios?.({
                value: current,
                onAccept: (v) => {
                    refresh(v);
                    onChange(v);
                },
            });
        });

        const clearRow = document.createElement('div');
        clearRow.className = 'crear-ep-recurso-clear-row';
        clearRow.hidden = !current;
        clearRow.appendChild(btn('Quitar tablero', 'crear-ep-btn--secundario', () => {
            refresh('');
            onChange('');
            clearRow.hidden = true;
        }));

        wrap.appendChild(lab);
        wrap.appendChild(trigger);
        wrap.appendChild(clearRow);
        return wrap;
    }

    function pintarSlot(slotEl, nombreCarta, etiquetaVacio) {
        slotEl.innerHTML = '';
        const nom = String(nombreCarta || '').trim();
        if (!nom) {
            const vacio = document.createElement('div');
            vacio.className = 'editar-desafios-carta-slot-vacio';
            vacio.innerHTML = `<span class="editar-desafios-carta-slot-vacio-icon">+</span><span>${etiquetaVacio || 'Añadir'}</span>`;
            slotEl.appendChild(vacio);
            return;
        }
        const mini = window.DCEditorCartaPicker?.crearVistaMiniCarta?.(nom);
        if (mini) {
            slotEl.appendChild(mini);
        } else {
            const vacio = document.createElement('div');
            vacio.className = 'editar-desafios-carta-slot-vacio';
            vacio.innerHTML = `<span>${nom}</span><span style="font-size:0.6rem">(no en catálogo)</span>`;
            slotEl.appendChild(vacio);
        }
    }

    function crearSlotCarta(campoExcel, etiqueta, esBoss) {
        const wrap = document.createElement('div');
        wrap.className = 'editar-desafios-carta-slot-wrap'
            + (esBoss ? ' editar-desafios-carta-slot-wrap--boss' : '');
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.className = 'editar-desafios-carta-slot' + (esBoss ? ' editar-desafios-carta-slot--boss' : '');
        const fila = getFilaActual();
        const valor = fila ? String(fila[campoExcel] || '').trim() : '';
        pintarSlot(slot, valor, etiqueta);

        slot.addEventListener('click', () => {
            const f = getFilaActual();
            if (!f) return;
            const actual = String(f[campoExcel] || '').trim();
            window.DCEditorCartaPicker?.abrir({
                titulo: esBoss ? 'Seleccionar boss' : 'Seleccionar enemigo',
                value: actual,
                allowEmpty: true,
                permitirSkin: true,
                onAccept: (nombre) => {
                    f[campoExcel] = nombre;
                    pintarSlot(slot, nombre, etiqueta);
                    marcarDirty();
                    renderLista();
                },
            });
        });

        const cap = document.createElement('span');
        cap.className = 'editar-desafios-carta-slot-label';
        cap.textContent = esBoss ? 'Carta boss' : 'Enemigo';
        wrap.appendChild(slot);
        wrap.appendChild(cap);
        return wrap;
    }

    function renderForm() {
        if (!formEl) return;
        const fila = getFilaActual();
        formEl.innerHTML = '';
        if (!fila) {
            formEl.innerHTML = '<p class="crear-ep-field-ayuda">Selecciona un desafío de la lista o crea uno nuevo.</p>';
            return;
        }

        const basica = document.createElement('div');
        basica.className = 'editar-desafios-seccion';
        basica.innerHTML = '<h3>Datos generales</h3>';
        basica.appendChild(fieldInput('ID_desafio', fila.ID_desafio, (v) => {
            fila.ID_desafio = Number(v) || 0;
            marcarDirty();
            renderLista();
        }, { type: 'number' }));
        basica.appendChild(fieldSelect('faccion', fila.faccion, [
            { value: 'H', label: 'Héroe (H)' },
            { value: 'V', label: 'Villano (V)' },
        ], (v) => { fila.faccion = v; marcarDirty(); renderLista(); }));
        basica.appendChild(fieldInput('nombre', fila.nombre, (v) => { fila.nombre = v; marcarDirty(); renderLista(); }));
        basica.appendChild(fieldInput('Descripción', fila.Descripción, (v) => { fila.Descripción = v; marcarDirty(); }, { multiline: true }));
        basica.appendChild(fieldInput('dificultad', fila.dificultad, (v) => {
            fila.dificultad = Number(v) || 1;
            marcarDirty();
            renderLista();
        }, { type: 'number' }));
        basica.appendChild(fieldInput('mejora', fila.mejora, (v) => { fila.mejora = Number(v) || 0; marcarDirty(); }, { type: 'number' }));
        basica.appendChild(fieldInput('mejora_especial', fila.mejora_especial, (v) => {
            fila.mejora_especial = Number(v) || 0;
            marcarDirty();
        }, { type: 'number' }));
        basica.appendChild(fieldInput('puntos', fila.puntos, (v) => { fila.puntos = Number(v) || 0; marcarDirty(); }, { type: 'number' }));
        formEl.appendChild(basica);

        const enemigos = document.createElement('div');
        enemigos.className = 'editar-desafios-seccion';
        enemigos.innerHTML = '<h3>Enemigos del desafío</h3>';
        const grid = document.createElement('div');
        grid.className = 'editar-desafios-enemigos-grid';
        M.ENEMIGO_KEYS.forEach((key, i) => {
            grid.appendChild(crearSlotCarta(key, `Enemigo ${i + 1}`, false));
        });
        grid.appendChild(crearSlotCarta('boss', 'Boss', true));
        enemigos.appendChild(grid);
        formEl.appendChild(enemigos);

        const recomp = document.createElement('div');
        recomp.className = 'editar-desafios-seccion';
        recomp.innerHTML = '<h3>Recompensa</h3>';
        const recompWrap = document.createElement('div');
        recompWrap.className = 'editar-desafios-recompensa-wrap';
        const slotRecomp = document.createElement('button');
        slotRecomp.type = 'button';
        slotRecomp.className = 'editar-desafios-carta-slot';
        const nombreRecomp = M.leerNombreCartaRecompensa(fila);
        pintarSlot(slotRecomp, nombreRecomp, 'Carta recompensa');
        slotRecomp.addEventListener('click', () => {
            window.DCEditorCartaPicker?.abrir({
                titulo: 'Carta de recompensa',
                value: nombreRecomp,
                allowEmpty: true,
                permitirSkin: true,
                onAccept: (nombre) => {
                    fila.cartas = nombre;
                    pintarSlot(slotRecomp, nombre, 'Carta recompensa');
                    marcarDirty();
                },
            });
        });
        recompWrap.appendChild(slotRecomp);
        recomp.appendChild(recompWrap);
        formEl.appendChild(recomp);

        const tab = document.createElement('div');
        tab.className = 'editar-desafios-seccion';
        tab.innerHTML = '<h3>Tablero de combate</h3>';
        tab.appendChild(fieldTablero('tablero', fila.tablero, (v) => { fila.tablero = v; marcarDirty(); }));
        formEl.appendChild(tab);

        const del = btn('Eliminar este desafío', 'crear-ep-btn--peligro', () => {
            if (!window.confirm(`¿Eliminar desafío #${fila.ID_desafio} «${fila.nombre}»?`)) return;
            state.filas.splice(state.selIndex, 1);
            state.selIndex = Math.min(state.selIndex, state.filas.length - 1);
            marcarDirty();
            renderAll();
        });
        del.style.marginTop = '8px';
        formEl.appendChild(del);

        renderErroresFila();
    }

    function renderErroresFila() {
        if (!erroresEl) return;
        const fila = getFilaActual();
        if (!fila) {
            erroresEl.hidden = true;
            return;
        }
        const val = M.validarFilaDesafio(fila, state.selIndex, state.filas, M.nombresCartasEnCatalogoSet(filasCatalogoCartas), skinsIndexadosCache);
        if (!val.length) {
            erroresEl.hidden = true;
            return;
        }
        erroresEl.hidden = false;
        erroresEl.innerHTML = val.map((x) => `<li>${x}</li>`).join('');
    }

    function renderLista() {
        if (!listaEl) return;
        const indices = indicesFiltrados();
        listaEl.innerHTML = '';
        indices.forEach((i) => {
            const fila = state.filas[i];
            const li = document.createElement('li');
            li.className = 'editar-desafios-lista-item';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'editar-desafios-lista-btn' + (i === state.selIndex ? ' editar-desafios-lista-btn--sel' : '');
            const facLabel = fila.faccion === 'V' ? 'V' : 'H';
            b.innerHTML = `<strong>#${fila.ID_desafio} ${fila.nombre || '(sin nombre)'}</strong>`
                + `<span class="editar-desafios-lista-meta">${facLabel} · dif. ${fila.dificultad}</span>`;
            b.addEventListener('click', () => {
                state.selIndex = i;
                renderAll();
            });
            li.appendChild(b);
            listaEl.appendChild(li);
        });
        if (contadorEl) {
            contadorEl.textContent = `${indices.length} de ${state.filas.length} desafío(s)`;
        }
    }

    function renderToolbar() {
        if (!toolbar) return;
        toolbar.innerHTML = '';
        const dirtyLabel = state.dirty ? ' · sin guardar' : '';
        const span = document.createElement('span');
        span.className = 'crear-ep-archivo-activo';
        span.innerHTML = `<strong>desafios.xlsx</strong>${dirtyLabel}`;
        toolbar.appendChild(span);
        toolbar.appendChild(btn('Recargar', 'crear-ep-btn--secundario', () => cargarCatalogo(true)));
        toolbar.appendChild(btn('Guardar Excel', 'crear-ep-btn--primario', () => guardarCatalogo()));
    }

    function renderAll() {
        renderToolbar();
        renderLista();
        renderForm();
    }

    async function cargarTableros() {
        try {
            const res = await fetch('/api/tableros');
            const data = await res.json();
            tablerosLista = data.archivos || [];
        } catch (_e) {
            tablerosLista = [];
        }
    }

    async function cargarCatalogoCartasMemoria() {
        if (typeof XLSX !== 'undefined' && typeof window.DCCatalogoCartas?.cargarFilas === 'function') {
            filasCatalogoCartas = await window.DCCatalogoCartas.cargarFilas();
        } else {
            const res = await fetch('/api/cartas-editor/catalogo');
            if (!res.ok) throw new Error('No se pudo cargar el catálogo de cartas.');
            const data = await res.json();
            filasCatalogoCartas = data.filas || [];
        }
        await window.DCEditorCartaPicker?.asegurarCatalogo?.();
        if (window.DCSkinsCartas?.asegurarSkinsCargados) {
            skinsIndexadosCache = await window.DCSkinsCartas.asegurarSkinsCargados();
        }
    }

    async function cargarCatalogo(force) {
        if (!force && !(await confirmarDescartar())) return;
        try {
            const data = await api('/api/desafios-editor/catalogo');
            const parsed = M.filasDesdeRespuestaApi(data);
            state.columnas = parsed.columnas;
            state.filas = parsed.filas;
            state.filasAlCargar = window.DCEditorGuardadoSeguro?.contarFilasCatalogo(state.filas, 'nombre') ?? state.filas.length;
            state.dirty = false;
            state.selIndex = state.filas.length ? 0 : -1;
            if (aviso) aviso.hidden = true;
            if (layout) layout.hidden = false;
            renderAll();
            toastMsg('Catálogo de desafíos cargado.');
        } catch (e) {
            mostrarAvisoInhabilitado(e);
        }
    }

    async function guardarCatalogo() {
        const val = M.validarCatalogo(state.filas, filasCatalogoCartas, skinsIndexadosCache);
        if (!val.ok) {
            toastMsg(val.errores[0] || 'Validación fallida', true);
            if (erroresEl) {
                erroresEl.hidden = false;
                erroresEl.innerHTML = val.errores.map((x) => `<li>${x}</li>`).join('');
            }
            return;
        }
        try {
            const guardado = await window.DCEditorGuardadoSeguro.intentarGuardarCatalogo({
                filas: state.filas,
                filasAlCargar: state.filasAlCargar,
                campoClave: 'nombre',
                minAbsoluto: 3,
                etiquetaRecurso: 'desafios.xlsx',
                guardarFn: ({ confirmarTruncamiento }) => api('/api/desafios-editor/catalogo', {
                    method: 'PUT',
                    body: JSON.stringify({
                        columnas: state.columnas,
                        filas: state.filas,
                        confirmarTruncamiento,
                    }),
                }),
            });
            if (guardado.cancelado) {
                return;
            }
            state.dirty = false;
            state.filasAlCargar = window.DCEditorGuardadoSeguro.contarFilasCatalogo(state.filas, 'nombre');
            renderToolbar();
            window.DCEditorDevNav?.marcarCambiosEnDisco();
            window.DCEditorSessionLog?.registrarGuardado?.(
                'desafios',
                'Guardado desafios.xlsx',
                ['public/resources/desafios.xlsx']
            );
            toastMsg('desafios.xlsx guardado correctamente.');
        } catch (e) {
            toastMsg(e.message || 'Error al guardar', true);
        }
    }

    function nuevaFila() {
        const fila = M.crearFilaDesafioVacia();
        fila.ID_desafio = M.siguienteIdDesafio(state.filas);
        fila.nombre = `Nuevo_desafio_${fila.ID_desafio}`;
        state.filas.push(fila);
        state.selIndex = state.filas.length - 1;
        marcarDirty();
        renderAll();
    }

    function mostrarAvisoInhabilitado(err) {
        if (layout) layout.hidden = true;
        if (!aviso) return;
        aviso.hidden = false;
        if (err?.code === 'DESAFIOS_EDITOR_API_MISSING') {
            aviso.innerHTML = 'API del editor no disponible. Despliega la rama <code>dev</code> con las rutas <code>/api/desafios-editor/*</code>.';
        } else {
            aviso.textContent = err?.message || 'Editor no disponible.';
        }
    }

    async function init() {
        $('editar-desafios-nuevo')?.addEventListener('click', nuevaFila);
        ['filtro-nombre-desafio', 'filtro-faccion-desafio', 'filtro-dificultad-desafio'].forEach((id) => {
            $(id)?.addEventListener('input', () => renderLista());
            $(id)?.addEventListener('change', () => renderLista());
        });

        initTableroPicker();
        await cargarTableros();

        let hab = null;
        try {
            hab = await api('/api/desafios-editor/habilitado');
            if (!hab.habilitado) {
                mostrarAvisoInhabilitado(new Error('Editor deshabilitado en este entorno.'));
                return;
            }
            window.DCEditorDevNav?.init({
                vistaActual: 'desafios',
                getDirty: () => state.dirty,
            });
            await cargarCatalogoCartasMemoria();
            await cargarCatalogo(false);
        } catch (e) {
            mostrarAvisoInhabilitado(e);
        }
    }

    init();
})();
