/**
 * Editor visual de asaltos.xlsx (editarAsaltos.html).
 */
(function () {
    'use strict';

    const M = window.DCEditarAsaltosModel;
    if (!M) {
        document.body.innerHTML = '<p style="color:#fff;padding:2rem">Falta editarAsaltosModel.js</p>';
        return;
    }

    const $ = (id) => document.getElementById(id);
    const toolbar     = $('editar-asaltos-toolbar');
    const aviso       = $('editar-asaltos-aviso');
    const layout      = $('editar-asaltos-layout');
    const listaEl     = $('editar-asaltos-lista');
    const formEl      = $('editar-asaltos-form');
    const erroresEl   = $('editar-asaltos-errores');
    const contadorEl  = $('editar-asaltos-contador');
    const toast       = $('crear-ep-toast');

    let tablerosLista = [];
    let tableroPickerSession = null;
    let filasCatalogoCartas = [];
    let skinsIndexadosCache = null;

    let state = {
        columnas: M.COLUMNAS_ASALTO.slice(),
        filas: [],
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
            if (res.status === 404 && String(path).includes('/api/asaltos-editor')) {
                const err = new Error('ASALTOS_EDITOR_API_MISSING');
                err.code = 'ASALTOS_EDITOR_API_MISSING';
                throw err;
            }
            const msg = body.errores?.length
                ? body.errores.join('\n')
                : (body.error || body.detalle || `HTTP ${res.status}`);
            throw new Error(msg);
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

    function marcarDirty() { state.dirty = true; renderToolbar(); }
    function getFilaActual() {
        if (state.selIndex < 0 || state.selIndex >= state.filas.length) return null;
        return state.filas[state.selIndex];
    }

    async function confirmarDescartar() {
        if (window.DCEditorDevNav?.confirmarAntesDeNavegar) return window.DCEditorDevNav.confirmarAntesDeNavegar();
        if (!state.dirty) return true;
        return window.confirm('Hay cambios sin guardar en asaltos.xlsx. ¿Descartarlos?');
    }

    function filtrosLista() {
        return {
            nombre: $('filtro-nombre-asalto')?.value || '',
            dificultad: $('filtro-dificultad-asalto')?.value || 'todas',
        };
    }

    function indicesFiltrados() {
        const f = filtrosLista();
        return state.filas.map((fila, i) => ({ fila, i }))
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

    function crearCampoImagen(label, fila, columna, onUpdate) {
        const wrap = document.createElement('div');
        wrap.className = 'crear-ep-field editar-cartas-campo-imagen';
        const lab = document.createElement('label');
        lab.textContent = label;
        wrap.appendChild(lab);

        const drop = document.createElement('div');
        drop.className = 'editar-cartas-imagen-preview-wrap';
        drop.setAttribute('tabindex', '-1');
        const img = document.createElement('img');
        img.className = 'editar-cartas-imagen-preview';
        img.alt = '';
        img.hidden = true;
        const ph = document.createElement('span');
        ph.className = 'editar-cartas-imagen-placeholder';
        ph.textContent = 'Arrastra una imagen o pega una URL abajo';
        drop.appendChild(img);
        drop.appendChild(ph);

        const inputUrl = document.createElement('input');
        inputUrl.type = 'url';
        inputUrl.className = 'crear-ep-select';
        inputUrl.placeholder = 'https://…';
        inputUrl.style.marginTop = '6px';

        function refresh(val) {
            const url = String(val || '').trim();
            if (url) { img.src = url; img.hidden = false; ph.hidden = true; }
            else { img.hidden = true; img.removeAttribute('src'); ph.hidden = false; }
            inputUrl.value = url;
        }
        refresh(fila[columna]);

        inputUrl.addEventListener('input', () => { fila[columna] = inputUrl.value; refresh(fila[columna]); onUpdate(); });
        inputUrl.addEventListener('change', () => { fila[columna] = inputUrl.value.trim(); refresh(fila[columna]); onUpdate(); });

        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag-over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
        drop.addEventListener('drop', (e) => {
            e.preventDefault();
            drop.classList.remove('drag-over');
            const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '';
            if (url) { fila[columna] = url.trim(); refresh(fila[columna]); onUpdate(); }
        });
        drop.addEventListener('paste', (e) => {
            const url = e.clipboardData?.getData('text')?.trim();
            if (url) { fila[columna] = url; refresh(fila[columna]); onUpdate(); }
        });

        wrap.appendChild(drop);
        wrap.appendChild(inputUrl);
        return wrap;
    }

    function urlTablero(nombre) {
        const n = String(nombre || '').trim();
        if (!n) return '';
        return /\.(png|jpe?g|webp)$/i.test(n)
            ? `/resources/tableros/${encodeURIComponent(n)}`
            : `/resources/tableros/${encodeURIComponent(n)}.png`;
    }

    function initTableroPicker() {
        const dialog = $('editar-asaltos-dialog-tablero');
        const grid   = $('editar-asaltos-tablero-grid');
        const filtro = $('editar-asaltos-tablero-filtro');
        const selLabel = $('editar-asaltos-tablero-seleccion');
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
                ph.textContent = '—'; ph.style.fontSize = '2rem';
                media.appendChild(ph);
            } else {
                const i = document.createElement('img');
                i.alt = nombre; i.loading = 'lazy'; i.src = urlTablero(nombre);
                media.appendChild(i);
            }
            const cap = document.createElement('span');
            cap.className = 'crear-ep-recurso-card-nombre';
            cap.textContent = esVacio ? '(sin tablero)' : nombre;
            card.appendChild(media); card.appendChild(cap);
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
            if (val && !items.includes(val) && (!q || String(val).toLowerCase().includes(q))) items.unshift(val);
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
        $('editar-asaltos-tablero-aceptar')?.addEventListener('click', confirmar);
        $('editar-asaltos-tablero-cancelar')?.addEventListener('click', () => {
            dialog.close(); tableroPickerSession = null;
        });
        dialog.addEventListener('cancel', () => { tableroPickerSession = null; });

        window._abrirTableroPickerAsaltos = function (opts) {
            tableroPickerSession = { value: opts.value || '', pending: opts.value || '', onAccept: opts.onAccept };
            filtro.value = '';
            pintar(); updateLabel();
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
        meta.appendChild(nombreEl); meta.appendChild(hint);

        function refresh(v) {
            current = v ?? '';
            nombreEl.textContent = current || '— sin tablero —';
            if (current) { thumb.src = urlTablero(current); thumb.hidden = false; }
            else { thumb.hidden = true; thumb.removeAttribute('src'); }
        }
        refresh(current);

        trigger.appendChild(thumb); trigger.appendChild(meta);
        trigger.addEventListener('click', () => {
            window._abrirTableroPickerAsaltos?.({ value: current, onAccept: (v) => { refresh(v); onChange(v); } });
        });

        const clearRow = document.createElement('div');
        clearRow.className = 'crear-ep-recurso-clear-row';
        clearRow.hidden = !current;
        clearRow.appendChild(btn('Quitar tablero', 'crear-ep-btn--secundario', () => {
            refresh(''); onChange(''); clearRow.hidden = true;
        }));

        wrap.appendChild(lab); wrap.appendChild(trigger); wrap.appendChild(clearRow);
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

    function crearSlotCarta(campoExcel, etiqueta) {
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.className = 'editar-desafios-carta-slot';
        const fila = getFilaActual();
        const valor = fila ? String(fila[campoExcel] || '').trim() : '';
        pintarSlot(slot, valor, etiqueta);
        slot.addEventListener('click', () => {
            const f = getFilaActual();
            if (!f) return;
            window.DCEditorCartaPicker?.abrir({
                titulo: 'Seleccionar carta',
                value: String(f[campoExcel] || '').trim(),
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
        return slot;
    }

    function renderForm() {
        if (!formEl) return;
        formEl.innerHTML = '';
        const fila = getFilaActual();
        if (!fila) {
            formEl.innerHTML = '<p class="crear-ep-field-ayuda">Selecciona un asalto de la lista o crea uno nuevo.</p>';
            return;
        }

        const basica = document.createElement('div');
        basica.className = 'editar-desafios-seccion';
        basica.innerHTML = '<h3>Datos generales</h3>';
        basica.appendChild(fieldInput('asalto_ID', fila.asalto_ID, (v) => {
            fila.asalto_ID = Number(v) || 0; marcarDirty(); renderLista();
        }, { type: 'number' }));
        basica.appendChild(fieldInput('nombre', fila.nombre, (v) => { fila.nombre = v; marcarDirty(); renderLista(); }));
        basica.appendChild(fieldInput('descripcion', fila.descripcion, (v) => { fila.descripcion = v; marcarDirty(); }, { multiline: true }));
        basica.appendChild(fieldInput('dificultad', fila.dificultad, (v) => {
            fila.dificultad = Number(v) || 6; marcarDirty(); renderLista();
        }, { type: 'number', placeholder: '6, 7 u 8' }));
        basica.appendChild(fieldInput('puntos', fila.puntos, (v) => { fila.puntos = Number(v) || 0; marcarDirty(); }, { type: 'number' }));
        basica.appendChild(fieldInput('mejora', fila.mejora, (v) => { fila.mejora = Number(v) || 0; marcarDirty(); }, { type: 'number' }));
        basica.appendChild(fieldInput('mejora_especial', fila.mejora_especial, (v) => { fila.mejora_especial = Number(v) || 0; marcarDirty(); }, { type: 'number' }));
        basica.appendChild(fieldInput('mejora_suprema', fila.mejora_suprema, (v) => { fila.mejora_suprema = Number(v) || 0; marcarDirty(); }, { type: 'number' }));
        basica.appendChild(fieldInput('mejora_definitiva', fila.mejora_definitiva, (v) => { fila.mejora_definitiva = Number(v) || 0; marcarDirty(); }, { type: 'number' }));
        formEl.appendChild(basica);

        const imgSec = document.createElement('div');
        imgSec.className = 'editar-desafios-seccion';
        imgSec.innerHTML = '<h3>Imagen del asalto</h3>';
        imgSec.appendChild(crearCampoImagen('imagen', fila, 'imagen', () => marcarDirty()));
        formEl.appendChild(imgSec);

        const cartasSec = document.createElement('div');
        cartasSec.className = 'editar-desafios-seccion';
        cartasSec.innerHTML = '<h3>Cartas del asalto (12 slots)</h3>';
        const grid = document.createElement('div');
        grid.className = 'editar-desafios-enemigos-grid';
        M.CARTA_KEYS.forEach((key, i) => grid.appendChild(crearSlotCarta(key, `Carta ${i + 1}`)));
        cartasSec.appendChild(grid);
        formEl.appendChild(cartasSec);

        const tab = document.createElement('div');
        tab.className = 'editar-desafios-seccion';
        tab.innerHTML = '<h3>Tablero de combate</h3>';
        tab.appendChild(fieldTablero('tablero', fila.tablero, (v) => { fila.tablero = v; marcarDirty(); }));
        formEl.appendChild(tab);

        const del = btn('Eliminar este asalto', 'crear-ep-btn--peligro', () => {
            if (!window.confirm(`¿Eliminar asalto #${fila.asalto_ID} «${fila.nombre}»?`)) return;
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
        if (!fila) { erroresEl.hidden = true; return; }
        const errs = M.validarFilaAsalto(fila, state.selIndex, state.filas, M.nombresCartasEnCatalogoSet(filasCatalogoCartas), skinsIndexadosCache);
        if (!errs.length) { erroresEl.hidden = true; erroresEl.innerHTML = ''; return; }
        erroresEl.hidden = false;
        erroresEl.innerHTML = errs.map((x) => `<li>${x}</li>`).join('');
    }

    function renderLista() {
        if (!listaEl) return;
        listaEl.innerHTML = '';
        const indices = indicesFiltrados();
        indices.forEach((i) => {
            const fila = state.filas[i];
            const li = document.createElement('li');
            li.className = 'editar-desafios-lista-item';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'editar-desafios-lista-btn' + (i === state.selIndex ? ' editar-desafios-lista-btn--sel' : '');
            b.innerHTML = `<strong>#${fila.asalto_ID} ${fila.nombre || '(sin nombre)'}</strong>`
                + `<span class="editar-desafios-lista-meta">dif. ${fila.dificultad}</span>`;
            b.addEventListener('click', () => { state.selIndex = i; renderAll(); });
            li.appendChild(b);
            listaEl.appendChild(li);
        });
        if (contadorEl) contadorEl.textContent = `${indices.length} de ${state.filas.length} asalto(s)`;
    }

    function renderToolbar() {
        if (!toolbar) return;
        toolbar.innerHTML = '';
        const dirtyLabel = state.dirty ? ' · sin guardar' : '';
        const span = document.createElement('span');
        span.className = 'crear-ep-archivo-activo';
        span.innerHTML = `<strong>asaltos.xlsx</strong>${dirtyLabel}`;
        toolbar.appendChild(span);
        toolbar.appendChild(btn('Recargar', 'crear-ep-btn--secundario', () => cargarCatalogo(true)));
        toolbar.appendChild(btn('Guardar Excel', 'crear-ep-btn--primario', () => guardarCatalogo()));
        window.DCEditorGitPush?.refrescarBotonEnToolbar(toolbar);
    }

    function renderAll() { renderToolbar(); renderLista(); renderForm(); }

    async function cargarTableros() {
        try { const res = await fetch('/api/tableros'); const data = await res.json(); tablerosLista = data.archivos || []; }
        catch (_e) { tablerosLista = []; }
    }

    async function cargarCatalogoCartasMemoria() {
        if (typeof XLSX !== 'undefined' && typeof window.DCCatalogoCartas?.cargarFilas === 'function') {
            filasCatalogoCartas = await window.DCCatalogoCartas.cargarFilas();
        } else {
            const res = await fetch('/api/cartas-editor/catalogo');
            if (!res.ok) throw new Error('No se pudo cargar el catálogo de cartas.');
            filasCatalogoCartas = (await res.json()).filas || [];
        }
        await window.DCEditorCartaPicker?.asegurarCatalogo?.();
        if (window.DCSkinsCartas?.asegurarSkinsCargados) {
            skinsIndexadosCache = await window.DCSkinsCartas.asegurarSkinsCargados();
        }
    }

    async function cargarCatalogo(force) {
        if (!force && !(await confirmarDescartar())) return;
        try {
            const data = await api('/api/asaltos-editor/catalogo');
            const parsed = M.filasDesdeRespuestaApi(data);
            state.columnas = parsed.columnas;
            state.filas = parsed.filas;
            state.dirty = false;
            state.selIndex = state.filas.length ? 0 : -1;
            if (aviso) aviso.hidden = true;
            if (layout) layout.hidden = false;
            renderAll();
            toastMsg('Catálogo de asaltos cargado.');
        } catch (e) { mostrarAvisoInhabilitado(e); }
    }

    async function guardarCatalogo() {
        const val = M.validarCatalogo(state.filas, filasCatalogoCartas, skinsIndexadosCache);
        if (!val.ok) {
            toastMsg(val.errores[0] || 'Validación fallida', true);
            if (erroresEl) { erroresEl.hidden = false; erroresEl.innerHTML = val.errores.map((x) => `<li>${x}</li>`).join(''); }
            return;
        }
        try {
            await api('/api/asaltos-editor/catalogo', {
                method: 'PUT',
                body: JSON.stringify({ columnas: state.columnas, filas: state.filas }),
            });
            state.dirty = false;
            renderToolbar();
            window.DCEditorDevNav?.marcarCambiosEnDisco();
            window.DCEditorSessionLog?.registrarGuardado?.('asaltos', 'Guardado asaltos.xlsx', ['public/resources/asaltos.xlsx']);
            toastMsg('asaltos.xlsx guardado correctamente.');
        } catch (e) { toastMsg(e.message || 'Error al guardar', true); }
    }

    function nuevaFila() {
        const fila = M.crearFilaAsaltoVacia();
        fila.asalto_ID = M.siguienteId(state.filas);
        fila.nombre = `Nuevo_asalto_${fila.asalto_ID}`;
        state.filas.push(fila);
        state.selIndex = state.filas.length - 1;
        marcarDirty();
        renderAll();
    }

    function mostrarAvisoInhabilitado(err) {
        if (layout) layout.hidden = true;
        if (!aviso) return;
        aviso.hidden = false;
        if (err?.code === 'ASALTOS_EDITOR_API_MISSING') {
            aviso.innerHTML = 'API del editor no disponible. Despliega la rama <code>dev</code> con las rutas <code>/api/asaltos-editor/*</code>.';
        } else {
            aviso.textContent = err?.message || 'Editor no disponible.';
        }
    }

    async function init() {
        $('editar-asaltos-nuevo')?.addEventListener('click', nuevaFila);
        ['filtro-nombre-asalto', 'filtro-dificultad-asalto'].forEach((id) => {
            $(id)?.addEventListener('input', () => renderLista());
            $(id)?.addEventListener('change', () => renderLista());
        });

        initTableroPicker();
        await cargarTableros();

        let hab = null;
        try {
            hab = await api('/api/asaltos-editor/habilitado');
            if (!hab.habilitado) { mostrarAvisoInhabilitado(new Error('Editor deshabilitado.')); return; }
            window.DCEditorDevNav?.init({
                vistaActual: 'asaltos',
                alcance: 'asaltos',
                getDirty: () => state.dirty,
                gitPushHabilitado: Boolean(hab.gitPush?.habilitado),
            });
            await window.DCEditorGitPush?.montarEnToolbar({
                toolbar,
                alcance: 'asaltos',
                endpoint: '/api/asaltos-editor/git-push',
                getDirty: () => state.dirty,
                onSuccess: () => toastMsg('Cambios subidos a GitHub.'),
            });
            await cargarCatalogoCartasMemoria();
            await cargarCatalogo(false);
        } catch (e) { mostrarAvisoInhabilitado(e); }
    }

    init();
})();
