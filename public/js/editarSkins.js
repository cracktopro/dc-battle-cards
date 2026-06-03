/**
 * Editor visual de skins.xlsx (editarSkins.html).
 */
(function () {
    'use strict';

    const M = window.DCEditarSkinsModel;
    if (!M) {
        document.body.innerHTML = '<p style="color:#fff;padding:2rem">Falta editarSkinsModel.js</p>';
        return;
    }

    const $ = (id) => document.getElementById(id);
    const toolbar     = $('editar-skins-toolbar');
    const aviso       = $('editar-skins-aviso');
    const layout      = $('editar-skins-layout');
    const listaEl     = $('editar-skins-lista');
    const gridEl      = $('editar-skins-grid');
    const formEl      = $('editar-skins-form');
    const previewEl   = $('editar-skins-preview');
    const erroresEl   = $('editar-skins-errores');
    const contadorEl  = $('editar-skins-contador');
    const toast       = $('crear-ep-toast');

    let filasCatalogoCartas = [];
    let state = {
        columnas: M.COLUMNAS_SKINS.slice(),
        filas: [],
        selIndex: -1,
        dirty: false,
        filtros: { nombre: '', parent: '' },
        vistaCatalogo: 'imagenes',
        imagenRevision: {},
    };

    async function api(path, opts = {}) {
        const res = await fetch(path, {
            headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
            ...opts,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (res.status === 404 && String(path).includes('/api/skins-editor')) {
                const err = new Error('SKINS_EDITOR_API_MISSING');
                err.code = 'SKINS_EDITOR_API_MISSING';
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
        return window.confirm('Hay cambios sin guardar en skins.xlsx. ¿Descartarlos?');
    }

    function indicesFiltrados() {
        const f = {
            nombre: $('filtro-nombre-skin')?.value || '',
            parent: $('filtro-parent-skin')?.value || '',
        };
        return state.filas.map((fila, i) => ({ fila, i }))
            .filter(({ fila }) => M.filaCoincideFiltros(fila, f))
            .map(({ i }) => i);
    }

    function btn(texto, clase, onClick) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = `crear-ep-btn ${clase || ''}`.trim();
        b.textContent = texto; b.addEventListener('click', onClick); return b;
    }

    function fieldWrap(label, inputEl) {
        const wrap = document.createElement('div');
        wrap.className = 'crear-ep-field editar-desafios-field';
        const lab = document.createElement('label'); lab.textContent = label;
        wrap.appendChild(lab); wrap.appendChild(inputEl); return wrap;
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
            o.value = opt.value; o.textContent = opt.label;
            if (opt.value === value) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', () => onChange(sel.value));
        return fieldWrap(label, sel);
    }

    function bumpImagenRevision(indice) {
        if (indice < 0) return;
        state.imagenRevision[indice] = (state.imagenRevision[indice] || 0) + 1;
    }

    function crearCampoImagen(label, fila, columna, onUpdate) {
        const wrap = document.createElement('div');
        wrap.className = 'crear-ep-field editar-cartas-campo-imagen';
        const lab = document.createElement('label'); lab.textContent = label;
        wrap.appendChild(lab);

        const drop = document.createElement('div');
        drop.className = 'editar-cartas-imagen-preview-wrap';
        drop.setAttribute('tabindex', '-1');
        const img = document.createElement('img');
        img.className = 'editar-cartas-imagen-preview'; img.alt = ''; img.hidden = true;
        const ph = document.createElement('span');
        ph.className = 'editar-cartas-imagen-placeholder';
        ph.textContent = 'Arrastra una imagen o pega una URL abajo';
        drop.appendChild(img); drop.appendChild(ph);

        const inputUrl = document.createElement('input');
        inputUrl.type = 'url'; inputUrl.className = 'crear-ep-select';
        inputUrl.placeholder = 'https://…'; inputUrl.style.marginTop = '6px';

        function refresh(val) {
            const url = String(val || '').trim();
            if (url) { img.src = url; img.hidden = false; ph.hidden = true; }
            else { img.hidden = true; img.removeAttribute('src'); ph.hidden = false; }
            inputUrl.value = url;
        }
        refresh(fila[columna]);

        inputUrl.addEventListener('input', () => {
            fila[columna] = inputUrl.value;
            refresh(fila[columna]);
            bumpImagenRevision(state.selIndex);
            renderPreview(); renderCatalogo();
            onUpdate();
        });
        inputUrl.addEventListener('change', () => {
            fila[columna] = inputUrl.value.trim();
            refresh(fila[columna]);
            onUpdate();
        });

        drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('drag-over'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('drag-over'));
        drop.addEventListener('drop', (e) => {
            e.preventDefault(); drop.classList.remove('drag-over');
            const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '';
            if (url) { fila[columna] = url.trim(); refresh(fila[columna]); bumpImagenRevision(state.selIndex); renderPreview(); renderCatalogo(); onUpdate(); }
        });
        drop.addEventListener('paste', (e) => {
            const url = e.clipboardData?.getData('text')?.trim();
            if (url) { fila[columna] = url; refresh(fila[columna]); bumpImagenRevision(state.selIndex); renderPreview(); renderCatalogo(); onUpdate(); }
        });

        wrap.appendChild(drop); wrap.appendChild(inputUrl);
        return wrap;
    }

    function crearCampoParent(fila, onUpdate) {
        const wrap = document.createElement('div');
        wrap.className = 'crear-ep-field';
        const lab = document.createElement('label'); lab.textContent = 'parent (carta base)';
        wrap.appendChild(lab);

        const trigger = document.createElement('button');
        trigger.type = 'button'; trigger.className = 'crear-ep-recurso-trigger';
        const previewWrap = document.createElement('div');
        previewWrap.className = 'editar-skins-parent-mini-wrap';
        const nombreEl = document.createElement('span');
        nombreEl.className = 'crear-ep-recurso-trigger-nombre';
        const hint = document.createElement('span');
        hint.className = 'crear-ep-recurso-trigger-hint'; hint.textContent = 'Clic para elegir carta base';
        const meta = document.createElement('span'); meta.className = 'crear-ep-recurso-trigger-meta';
        meta.appendChild(nombreEl); meta.appendChild(hint);

        function refresh(nombre) {
            previewWrap.innerHTML = '';
            nombreEl.textContent = nombre || '— sin carta base —';
            if (nombre) {
                const mini = window.DCEditorCartaPicker?.crearVistaMiniCarta?.(nombre);
                if (mini) previewWrap.appendChild(mini);
            }
        }
        refresh(fila.parent);

        trigger.appendChild(previewWrap); trigger.appendChild(meta);
        trigger.addEventListener('click', () => {
            window.DCEditorCartaPicker?.abrir({
                titulo: 'Seleccionar carta base (parent)',
                value: fila.parent,
                allowEmpty: false,
                onAccept: (nombre) => {
                    fila.parent = nombre;
                    refresh(nombre);
                    renderPreview(); marcarDirty(); renderCatalogo();
                    onUpdate();
                },
            });
        });

        const clearRow = document.createElement('div');
        clearRow.className = 'crear-ep-recurso-clear-row'; clearRow.hidden = !fila.parent;
        clearRow.appendChild(btn('Quitar parent', 'crear-ep-btn--secundario', () => {
            fila.parent = ''; refresh(''); clearRow.hidden = true;
                    renderPreview(); marcarDirty(); renderCatalogo(); onUpdate();
        }));

        wrap.appendChild(trigger); wrap.appendChild(clearRow);
        return wrap;
    }

    function filaComoCartaPreview(fila) {
        const parentFila = filasCatalogoCartas.find((f) => String(f.Nombre || '').trim().toLowerCase() === String(fila.parent || '').trim().toLowerCase());
        return {
            Nombre: String(fila.Nombre || '').trim() || (parentFila?.Nombre || ''),
            Nivel: Number(parentFila?.Nivel) || 1,
            Salud: Number(fila.Salud) || Number(parentFila?.Salud) || 0,
            Poder: Number(fila.Poder) || Number(parentFila?.Poder) || 0,
            SaludMax: Number(fila.Salud) || Number(parentFila?.Salud) || 0,
            Tipo: parentFila?.Tipo || '',
            faccion: parentFila?.faccion || '',
            Afiliacion: String(fila.Afiliacion || '').trim(),
            Imagen: String(fila.Imagen || '').trim() || parentFila?.Imagen || '',
            imagen_final: '',
            skill_name: String(fila.skill_name || '').trim(),
            skill_info: String(fila.skill_info || '').trim(),
            skill_class: String(fila.skill_class || '').trim(),
            skill_power: Number(fila.skill_power) || 0,
            skill_trigger: String(fila.skill_trigger || '').trim(),
        };
    }

    function construirCartaMiniElement(cartaObj) {
        const cartaDiv = document.createElement('div');
        cartaDiv.className = 'carta-mini';
        if (typeof window.dcAplicarClasesNivelCartaCompleta === 'function')
            window.dcAplicarClasesNivelCartaCompleta(cartaDiv, cartaObj);

        const url = String(cartaObj.Imagen || '').trim();
        if (typeof window.aplicarImagenFondoCarta === 'function') {
            window.aplicarImagenFondoCarta(cartaDiv, cartaObj, { imagenUrl: url || 'img/default-image.jpg' });
        } else {
            cartaDiv.style.backgroundImage = `url(${url || 'img/default-image.jpg'})`;
            cartaDiv.style.backgroundSize = 'cover';
            cartaDiv.style.backgroundPosition = 'center top';
        }

        const estrellasDiv = document.createElement('div');
        estrellasDiv.className = 'estrellas-carta';
        if (typeof window.dcRellenarEstrellasCartaCompleta === 'function')
            window.dcRellenarEstrellasCartaCompleta(estrellasDiv, cartaObj, {});

        const detalles = document.createElement('div');
        detalles.className = 'detalles-carta';
        const nombre = document.createElement('span');
        nombre.className = 'nombre-carta';
        nombre.textContent = cartaObj.Nombre || '(sin nombre)';
        const poder = document.createElement('span');
        poder.className = 'poder-carta';
        poder.textContent = typeof window.obtenerPoderActualCarta === 'function'
            ? window.obtenerPoderActualCarta(cartaObj) : cartaObj.Poder;
        detalles.appendChild(nombre); detalles.appendChild(poder);

        cartaDiv.appendChild(estrellasDiv); cartaDiv.appendChild(detalles);

        if (typeof window.crearBadgeHabilidadCarta === 'function') {
            const badge = window.crearBadgeHabilidadCarta(cartaObj);
            if (badge) cartaDiv.appendChild(badge);
        }
        if (typeof window.crearBadgeAfiliacionCarta === 'function') {
            const bAfi = window.crearBadgeAfiliacionCarta(cartaObj);
            if (bAfi) cartaDiv.appendChild(bAfi);
        }

        const saludMax = Math.max(Number(cartaObj.Salud) || Number(cartaObj.Poder) || 1, 1);
        const cont = document.createElement('div'); cont.className = 'barra-salud-contenedor';
        const relleno = document.createElement('div');
        relleno.className = 'barra-salud-relleno';
        relleno.style.width = '100%'; relleno.style.setProperty('--health-ratio', '1');
        const span = document.createElement('span'); span.className = 'salud-carta';
        span.textContent = `${saludMax}/${saludMax}`;
        cont.appendChild(relleno); cont.appendChild(span);
        cartaDiv.appendChild(cont);

        return cartaDiv;
    }

    function renderPreview() {
        if (!previewEl) return;
        previewEl.innerHTML = '';
        const fila = getFilaActual();
        if (!fila) {
            previewEl.innerHTML = '<p class="crear-ep-field-ayuda">Sin previsualización</p>';
            return;
        }
        previewEl.appendChild(construirCartaMiniElement(filaComoCartaPreview(fila)));
    }

    function aplicarClasePanelHabilidad(panel, fila) {
        if (!panel || !window.DCFiltrosCartas) return;
        const clase = M.normalizarClaseSkillEditor(fila.skill_class);
        const badge = window.DCFiltrosCartas.CLASE_BADGE_POR_SKILL?.[clase];
        panel.className = 'editar-desafios-seccion editar-cartas-habilidad-panel';
        if (badge) panel.classList.add(badge);
    }

    function renderForm() {
        if (!formEl) return;
        formEl.innerHTML = '';
        const fila = getFilaActual();
        if (!fila) {
            formEl.innerHTML = '<p class="crear-ep-field-ayuda">Selecciona un skin de la lista o crea uno nuevo.</p>';
            return;
        }

        const basica = document.createElement('div');
        basica.className = 'editar-desafios-seccion';
        basica.innerHTML = '<h3>Datos básicos</h3>';
        basica.appendChild(fieldInput('skin_id', fila.skin_id, (v) => {
            fila.skin_id = Number(v) || 0; marcarDirty(); renderCatalogo();
        }, { type: 'number' }));
        basica.appendChild(crearCampoParent(fila, () => marcarDirty()));
        basica.appendChild(fieldInput('Nombre', fila.Nombre, (v) => { fila.Nombre = v; marcarDirty(); renderCatalogo(); renderPreview(); }));
        basica.appendChild(fieldInput('Salud', fila.Salud, (v) => { fila.Salud = Number(v) || 0; marcarDirty(); renderPreview(); }, { type: 'number' }));
        basica.appendChild(fieldInput('Poder', fila.Poder, (v) => { fila.Poder = Number(v) || 0; marcarDirty(); renderPreview(); }, { type: 'number' }));
        basica.appendChild(fieldInput('Afiliacion', fila.Afiliacion, (v) => { fila.Afiliacion = v; marcarDirty(); renderPreview(); }, { placeholder: 'Varias afiliaciones separadas por ;' }));
        formEl.appendChild(basica);

        const imgSec = document.createElement('div');
        imgSec.className = 'editar-desafios-seccion';
        imgSec.innerHTML = '<h3>Imagen del skin</h3>';
        imgSec.appendChild(crearCampoImagen('Imagen', fila, 'Imagen', () => { marcarDirty(); renderPreview(); }));
        formEl.appendChild(imgSec);

        const hab = document.createElement('div');
        hab.className = 'editar-desafios-seccion editar-cartas-habilidad-panel';
        hab.innerHTML = '<h3>Habilidad del skin</h3>';
        aplicarClasePanelHabilidad(hab, fila);

        hab.appendChild(fieldInput('skill_name', fila.skill_name, (v) => {
            fila.skill_name = v; aplicarClasePanelHabilidad(hab, fila); marcarDirty(); renderPreview();
        }));
        hab.appendChild(fieldInput('skill_info', fila.skill_info, (v) => {
            fila.skill_info = v; marcarDirty();
        }, { multiline: true }));

        const skillClassSel = document.createElement('select');
        skillClassSel.className = 'crear-ep-select filtro-skill-class';
        const optVacio = document.createElement('option'); optVacio.value = ''; optVacio.textContent = '—'; skillClassSel.appendChild(optVacio);
        M.ORDEN_SKILL_CLASS.forEach((sc) => {
            const o = document.createElement('option');
            o.value = sc; o.textContent = M.ETIQUETAS_SKILL_CLASS[sc] || sc;
            skillClassSel.appendChild(o);
        });
        skillClassSel.value = M.normalizarClaseSkillEditor(fila.skill_class) || '';
        skillClassSel.addEventListener('change', () => {
            fila.skill_class = skillClassSel.value;
            aplicarClasePanelHabilidad(hab, fila); marcarDirty(); renderPreview();
        });
        const scWrap = document.createElement('div');
        scWrap.className = 'crear-ep-field editar-desafios-field';
        const scLab = document.createElement('label'); scLab.textContent = 'skill_class';
        scWrap.appendChild(scLab); scWrap.appendChild(skillClassSel);
        hab.appendChild(scWrap);

        hab.appendChild(fieldInput('skill_power', fila.skill_power, (v) => {
            fila.skill_power = Number(v) || 0; marcarDirty();
        }, { type: 'number' }));
        hab.appendChild(fieldSelect('skill_trigger', fila.skill_trigger, M.SKILL_TRIGGER_OPCIONES, (v) => {
            fila.skill_trigger = v; marcarDirty(); renderPreview();
        }));

        formEl.appendChild(hab);

        const del = btn('Eliminar este skin', 'crear-ep-btn--peligro', () => {
            if (!window.confirm(`¿Eliminar skin #${fila.skin_id} «${fila.Nombre}»?`)) return;
            state.filas.splice(state.selIndex, 1);
            state.selIndex = Math.min(state.selIndex, state.filas.length - 1);
            marcarDirty(); renderAll();
        });
        del.style.marginTop = '8px';
        formEl.appendChild(del);

        renderErroresFila();
    }

    function renderErroresFila() {
        if (!erroresEl) return;
        const fila = getFilaActual();
        if (!fila) { erroresEl.hidden = true; return; }
        const nombresSet = new Set(filasCatalogoCartas.map((f) => String(f.Nombre || '').trim().toLowerCase()).filter(Boolean));
        const errs = M.validarFilaSkin(fila, state.selIndex, state.filas, nombresSet);
        if (!errs.length) { erroresEl.hidden = true; erroresEl.innerHTML = ''; return; }
        erroresEl.hidden = false;
        erroresEl.innerHTML = errs.map((x) => `<li>${x}</li>`).join('');
    }

    function seleccionarIndiceSkin(i) {
        state.selIndex = i;
        renderForm();
        renderPreview();
        renderCatalogo();
    }

    function actualizarVistaCatalogoUi() {
        const esImagenes = state.vistaCatalogo === 'imagenes';
        if (listaEl) listaEl.hidden = esImagenes;
        if (gridEl) gridEl.hidden = !esImagenes;
        const btnImg = $('editar-skins-vista-imagenes');
        const btnLista = $('editar-skins-vista-lista');
        if (btnImg) {
            btnImg.classList.toggle('editar-cartas-vista-btn--activo', esImagenes);
            btnImg.setAttribute('aria-pressed', esImagenes ? 'true' : 'false');
        }
        if (btnLista) {
            btnLista.classList.toggle('editar-cartas-vista-btn--activo', !esImagenes);
            btnLista.setAttribute('aria-pressed', !esImagenes ? 'true' : 'false');
        }
    }

    function setVistaCatalogo(modo) {
        state.vistaCatalogo = modo === 'lista' ? 'lista' : 'imagenes';
        actualizarVistaCatalogoUi();
        renderCatalogo();
    }

    function renderCatalogo() {
        actualizarVistaCatalogoUi();
        if (state.vistaCatalogo === 'imagenes') {
            renderGrid();
        } else {
            renderLista();
        }
    }

    function renderGrid() {
        if (!gridEl) return;
        gridEl.innerHTML = '';
        const indices = indicesFiltrados();
        if (contadorEl) {
            contadorEl.textContent = `${indices.length} / ${state.filas.length} skins`;
        }
        indices.forEach((i) => {
            const fila = state.filas[i];
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'editar-cartas-grid-item' + (i === state.selIndex ? ' editar-cartas-grid-item--sel' : '');
            item.appendChild(construirCartaMiniElement(filaComoCartaPreview(fila)));
            const lab = document.createElement('span');
            lab.className = 'editar-cartas-grid-item-label';
            lab.textContent = fila.Nombre || fila.parent || '(sin nombre)';
            lab.title = `${fila.Nombre || ''} · parent: ${fila.parent || '—'}`;
            item.appendChild(lab);
            item.addEventListener('click', () => seleccionarIndiceSkin(i));
            gridEl.appendChild(item);
        });
    }

    function renderLista() {
        if (!listaEl) return;
        listaEl.innerHTML = '';
        const indices = indicesFiltrados();
        if (contadorEl) {
            contadorEl.textContent = `${indices.length} / ${state.filas.length} skins`;
        }
        indices.forEach((i) => {
            const fila = state.filas[i];
            const li = document.createElement('li');
            li.className = 'editar-cartas-lista-item';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'editar-cartas-lista-btn' + (i === state.selIndex ? ' editar-cartas-lista-btn--sel' : '');
            const skillTxt = M.normalizarClaseSkillEditor(fila.skill_class) || 'sin skill';
            b.innerHTML = `<strong>${fila.Nombre || '(sin nombre)'}</strong>`
                + `<span class="editar-cartas-lista-meta">#${fila.skin_id} · parent: ${fila.parent || '—'} · ${skillTxt}</span>`;
            b.addEventListener('click', () => seleccionarIndiceSkin(i));
            li.appendChild(b);
            listaEl.appendChild(li);
        });
    }

    function renderToolbar() {
        if (!toolbar) return;
        toolbar.innerHTML = '';
        const span = document.createElement('span');
        span.className = 'crear-ep-archivo-activo';
        span.innerHTML = `<strong>skins.xlsx</strong>${state.dirty ? ' · sin guardar' : ''}`;
        toolbar.appendChild(span);
        toolbar.appendChild(btn('Recargar', 'crear-ep-btn--secundario', () => cargarCatalogo(true)));
        toolbar.appendChild(btn('Guardar Excel', 'crear-ep-btn--primario', () => guardarCatalogo()));
    }

    function renderAll() { renderToolbar(); renderCatalogo(); renderForm(); renderPreview(); }

    async function cargarCatalogoCartasMemoria() {
        if (typeof XLSX !== 'undefined' && typeof window.DCCatalogoCartas?.cargarFilas === 'function') {
            filasCatalogoCartas = await window.DCCatalogoCartas.cargarFilas();
        } else {
            const res = await fetch('/api/cartas-editor/catalogo');
            if (!res.ok) throw new Error('No se pudo cargar el catálogo de cartas.');
            filasCatalogoCartas = (await res.json()).filas || [];
        }
        await window.DCEditorCartaPicker?.asegurarCatalogo?.();
    }

    async function cargarCatalogo(force) {
        if (!force && !(await confirmarDescartar())) return;
        try {
            const data = await api('/api/skins-editor/catalogo');
            const parsed = M.filasDesdeRespuestaApi(data);
            state.columnas = parsed.columnas; state.filas = parsed.filas;
            state.dirty = false; state.imagenRevision = {};
            state.selIndex = state.filas.length ? 0 : -1;
            if (aviso) aviso.hidden = true;
            if (layout) layout.hidden = false;
            renderAll(); toastMsg('Catálogo de skins cargado.');
        } catch (e) { mostrarAvisoInhabilitado(e); }
    }

    async function guardarCatalogo() {
        const val = M.validarCatalogo(state.filas, filasCatalogoCartas);
        if (!val.ok) {
            toastMsg(val.errores[0] || 'Validación fallida', true);
            if (erroresEl) { erroresEl.hidden = false; erroresEl.innerHTML = val.errores.map((x) => `<li>${x}</li>`).join(''); }
            return;
        }
        try {
            await api('/api/skins-editor/catalogo', {
                method: 'PUT',
                body: JSON.stringify({ columnas: state.columnas, filas: state.filas }),
            });
            state.dirty = false; renderToolbar();
            window.DCEditorDevNav?.marcarCambiosEnDisco();
            window.DCEditorSessionLog?.registrarGuardado?.('skins', 'Guardado skins.xlsx', ['public/resources/skins.xlsx']);
            toastMsg('skins.xlsx guardado correctamente.');
        } catch (e) { toastMsg(e.message || 'Error al guardar', true); }
    }

    function nuevaFila() {
        const fila = M.crearFilaSkinVacia();
        fila.skin_id = M.siguienteId(state.filas);
        fila.Nombre = `Nuevo_skin_${fila.skin_id}`;
        state.filas.push(fila); state.selIndex = state.filas.length - 1;
        marcarDirty(); renderAll();
    }

    function mostrarAvisoInhabilitado(err) {
        if (layout) layout.hidden = true;
        if (!aviso) return;
        aviso.hidden = false;
        if (err?.code === 'SKINS_EDITOR_API_MISSING') {
            aviso.innerHTML = 'API del editor no disponible. Despliega la rama <code>dev</code> con las rutas <code>/api/skins-editor/*</code>.';
        } else {
            aviso.textContent = err?.message || 'Editor no disponible.';
        }
    }

    function actualizarFiltroParentOpciones() {
        const sel = $('filtro-parent-skin');
        if (!sel) return;
        const parents = [...new Set(state.filas.map((f) => String(f.parent || '').trim()).filter(Boolean))].sort();
        const val = sel.value;
        sel.innerHTML = '<option value="">Todos los parents</option>';
        parents.forEach((p) => {
            const o = document.createElement('option');
            o.value = p; o.textContent = p;
            if (p === val) o.selected = true;
            sel.appendChild(o);
        });
    }

    async function init() {
        $('editar-skins-nuevo')?.addEventListener('click', nuevaFila);
        $('editar-skins-vista-imagenes')?.addEventListener('click', () => setVistaCatalogo('imagenes'));
        $('editar-skins-vista-lista')?.addEventListener('click', () => setVistaCatalogo('lista'));
        ['filtro-nombre-skin', 'filtro-parent-skin'].forEach((id) => {
            $(id)?.addEventListener('input', () => renderCatalogo());
            $(id)?.addEventListener('change', () => renderCatalogo());
        });

        let hab = null;
        try {
            hab = await api('/api/skins-editor/habilitado');
            if (!hab.habilitado) { mostrarAvisoInhabilitado(new Error('Editor deshabilitado.')); return; }
            window.DCEditorDevNav?.init({
                vistaActual: 'skins',
                getDirty: () => state.dirty,
            });
            await cargarCatalogoCartasMemoria();
            await cargarCatalogo(false);
            actualizarFiltroParentOpciones();
        } catch (e) { mostrarAvisoInhabilitado(e); }
    }

    init();
})();
