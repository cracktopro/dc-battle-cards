/**
 * Editor visual de cartas.xlsx (editarCartas.html).
 */
(function () {
    'use strict';

    const M = window.DCEditarCartasModel;
    if (!M) {
        document.body.innerHTML = '<p style="color:#fff;padding:2rem">Falta editarCartasModel.js</p>';
        return;
    }

    const $ = (id) => document.getElementById(id);
    const toolbar = $('editar-cartas-toolbar');
    const aviso = $('editar-cartas-aviso');
    const layout = $('editar-cartas-layout');
    const listaEl = $('editar-cartas-lista');
    const gridEl = $('editar-cartas-grid');
    const formEl = $('editar-cartas-form');
    const previewEl = $('editar-cartas-preview');
    const erroresEl = $('editar-cartas-errores');
    const contadorEl = $('editar-cartas-contador');
    const toast = $('crear-ep-toast');

    const CAMPOS_TEXTO = ['Nombre', 'Nivel', 'Salud', 'Poder', 'Afiliacion'];
    const COL_IMAGEN = 'Imagen';
    const COL_IMAGEN_FINAL = 'imagen_final';

    let state = {
        columnas: M.COLUMNAS_CARTAS.slice(),
        filas: [],
        filasAlCargar: 0,
        selIndex: -1,
        dirty: false,
        filtros: { nombre: '', afiliacion: 'todas', faccion: 'todas', skillClass: 'todas' },
        /** 'imagenes' | 'lista' — por defecto miniaturas de juego */
        vistaCatalogo: 'imagenes',
        /** Por índice de fila: invalida caché de background-image del navegador */
        imagenRevision: {},
    };

    async function api(path, opts = {}) {
        const res = await fetch(path, {
            headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
            ...opts,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            if (res.status === 404 && String(path).includes('/api/cartas-editor')) {
                const err = new Error('CARTAS_EDITOR_API_MISSING');
                err.code = 'CARTAS_EDITOR_API_MISSING';
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
        return window.confirm('Hay cambios sin guardar en cartas.xlsx. ¿Descartarlos?');
    }

    function getFilaActual() {
        if (state.selIndex < 0 || state.selIndex >= state.filas.length) return null;
        return state.filas[state.selIndex];
    }

    function filtrosActuales() {
        return {
            nombre: $('filtro-nombre-carta')?.value || '',
            afiliacion: $('filtro-afiliacion-carta')?.value || 'todas',
            faccion: $('filtro-faccion-carta')?.value || 'todas',
            skillClass: $('filtro-skill-class-carta')?.value || 'todas',
        };
    }

    function indicesFiltrados() {
        const f = filtrosActuales();
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
        wrap.className = 'crear-ep-field editar-cartas-field';
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

    function resolverUrlImagenPreview(valor) {
        const v = String(valor || '').trim();
        if (!v) return '';
        if (/^https?:\/\//i.test(v) || v.startsWith('data:') || v.startsWith('/')) return v;
        return v.includes('/') ? v : `img/${v}`;
    }

    function bumpImagenRevision(indice) {
        if (indice < 0) return;
        state.imagenRevision[indice] = (state.imagenRevision[indice] || 0) + 1;
    }

    function sincronizarImagenesCatalogoMemoria() {
        if (typeof window.registrarImagenesCatalogoEnMemoria === 'function') {
            window.registrarImagenesCatalogoEnMemoria(state.filas);
        }
    }

    function resolverImagenUrlDesdeFila(fila) {
        const nivel = Math.min(8, Math.max(1, Number(fila.Nivel) || 1));
        const imagen = String(fila.Imagen || fila.imagen || '').trim();
        const imagenFinal = String(fila.imagen_final || fila.Imagen_final || fila.imagenFinal || '').trim();
        if (typeof window.cartaMuestraImagenFinal === 'function' && window.cartaMuestraImagenFinal(nivel) && imagenFinal) {
            return imagenFinal;
        }
        return imagen || 'img/default-image.jpg';
    }

    function urlImagenConCacheBust(url, cardIndex) {
        const u = String(url || '').trim();
        if (!u || u.startsWith('data:')) return u;
        const rev = state.imagenRevision[cardIndex] || 0;
        if (!rev) return u;
        const sep = u.includes('?') ? '&' : '?';
        return `${u}${sep}dcRev=${rev}`;
    }

    function aplicarImagenCartaEditor(cartaDiv, carta, fila, cardIndex) {
        const url = urlImagenConCacheBust(resolverImagenUrlDesdeFila(fila), cardIndex);
        if (typeof window.quitarCapasHoloDeCarta === 'function') {
            window.quitarCapasHoloDeCarta(cartaDiv);
        }
        cartaDiv.classList.remove('carta--con-holo');
        delete cartaDiv.dataset.dcHoloImagen;
        delete cartaDiv.dataset.dcHoloActivo;
        delete cartaDiv.dataset.dcHoloModo;
        cartaDiv.style.backgroundImage = '';
        if (typeof window.aplicarImagenFondoCarta === 'function') {
            window.aplicarImagenFondoCarta(cartaDiv, carta, { imagenUrl: url });
        } else {
            cartaDiv.style.backgroundImage = `url(${url})`;
            cartaDiv.style.backgroundSize = 'cover';
            cartaDiv.style.backgroundPosition = 'center top';
        }
    }

    function onImagenCampoChange() {
        if (state.selIndex >= 0) {
            bumpImagenRevision(state.selIndex);
        }
        sincronizarImagenesCatalogoMemoria();
        onFilaChange();
    }

    function crearCampoImagen(label, columna, fila, onUpdate) {
        const wrap = document.createElement('div');
        wrap.className = 'crear-ep-field editar-cartas-campo-imagen';

        const lab = document.createElement('label');
        lab.textContent = label;
        wrap.appendChild(lab);

        const drop = document.createElement('div');
        drop.className = 'editar-cartas-imagen-preview-wrap';
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
        inputUrl.placeholder = 'https://… o ruta img/…';
        inputUrl.style.marginTop = '6px';

        function refresh(val) {
            const url = resolverUrlImagenPreview(val);
            if (url) {
                img.src = url;
                img.hidden = false;
                ph.hidden = true;
            } else {
                img.hidden = true;
                img.removeAttribute('src');
                ph.hidden = false;
            }
            inputUrl.value = String(val || '').trim();
        }
        refresh(fila[columna]);

        inputUrl.addEventListener('change', () => {
            fila[columna] = inputUrl.value.trim();
            refresh(fila[columna]);
            onUpdate();
        });
        inputUrl.addEventListener('input', () => {
            fila[columna] = inputUrl.value;
            refresh(fila[columna]);
            if (state.selIndex >= 0) {
                bumpImagenRevision(state.selIndex);
                sincronizarImagenesCatalogoMemoria();
                renderPreview();
                renderCatalogo();
            }
        });
        inputUrl.addEventListener('blur', () => {
            fila[columna] = inputUrl.value.trim();
            onUpdate();
        });

        drop.addEventListener('dragover', (e) => {
            e.preventDefault();
            drop.classList.add('editar-cartas-imagen-preview-wrap--drag');
        });
        drop.addEventListener('dragleave', () => {
            drop.classList.remove('editar-cartas-imagen-preview-wrap--drag');
        });
        drop.addEventListener('drop', (e) => {
            e.preventDefault();
            drop.classList.remove('editar-cartas-imagen-preview-wrap--drag');
            const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
            if (url && String(url).trim().startsWith('http')) {
                fila[columna] = String(url).trim();
                refresh(fila[columna]);
                onUpdate();
                return;
            }
            const file = e.dataTransfer.files?.[0];
            if (file && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = () => {
                    const data = String(reader.result || '');
                    if (data.length > 120000) {
                        toastMsg('Imagen demasiado grande para guardar en Excel. Usa una URL externa.', true);
                        return;
                    }
                    fila[columna] = data;
                    refresh(fila[columna]);
                    onUpdate();
                };
                reader.readAsDataURL(file);
            }
        });

        wrap.appendChild(drop);
        wrap.appendChild(inputUrl);
        return wrap;
    }

    function aplicarClasePanelHabilidad(panel, fila) {
        if (!panel || !window.DCFiltrosCartas) return;
        const clase = M.normalizarClaseSkillEditor(fila.skill_class);
        const badge = window.DCFiltrosCartas.CLASE_BADGE_POR_SKILL?.[clase];
        panel.className = 'editar-cartas-seccion editar-cartas-habilidad-panel';
        if (badge) panel.classList.add(badge);
    }

    function onFilaChange() {
        marcarDirty();
        renderErroresFila();
        renderPreview();
        renderCatalogo();
    }

    function renderErroresFila() {
        if (!erroresEl) return;
        const fila = getFilaActual();
        if (!fila) {
            erroresEl.hidden = true;
            erroresEl.innerHTML = '';
            return;
        }
        const errs = M.validarFilaCarta(fila, state.selIndex, state.filas);
        if (!errs.length) {
            erroresEl.hidden = true;
            erroresEl.innerHTML = '';
            return;
        }
        erroresEl.hidden = false;
        erroresEl.innerHTML = errs.map((e) => `<li>${e}</li>`).join('');
    }

    function renderForm() {
        if (!formEl) return;
        formEl.innerHTML = '';
        const fila = getFilaActual();
        if (!fila) {
            formEl.innerHTML = '<p class="crear-ep-field-ayuda">Selecciona una carta de la lista o crea una nueva.</p>';
            return;
        }

        const basica = document.createElement('div');
        basica.className = 'editar-cartas-seccion';
        basica.innerHTML = '<h3>Datos básicos</h3>';
        CAMPOS_TEXTO.forEach((col) => {
            const esNum = col === 'Nivel' || col === 'Salud' || col === 'Poder';
            basica.appendChild(fieldInput(col, fila[col], (v) => {
                fila[col] = esNum ? (v === '' ? '' : Number(v)) : v;
                if (col === 'Nivel') {
                    bumpImagenRevision(state.selIndex);
                }
                onFilaChange();
            }, esNum ? { type: 'number' } : (col === 'Afiliacion' ? {
                placeholder: 'Varias afiliaciones separadas por ;',
            } : {})));
        });
        basica.appendChild(fieldSelect('Tipo', fila.Tipo, [
            { value: '', label: '—' },
            ...M.TIPOS_CARTA.map((t) => ({ value: t, label: t })),
        ], (v) => {
            fila.Tipo = v;
            onFilaChange();
        }));
        basica.appendChild(fieldSelect('faccion', fila.faccion, [
            { value: '', label: '—' },
            ...M.FACCIONES.map((f) => ({ value: f, label: f === 'H' ? 'Héroe (H)' : 'Villano (V)' })),
        ], (v) => {
            fila.faccion = v;
            onFilaChange();
        }));
        formEl.appendChild(basica);

        const imgs = document.createElement('div');
        imgs.className = 'editar-cartas-seccion';
        imgs.innerHTML = '<h3>Imágenes</h3>';
        imgs.appendChild(crearCampoImagen('Imagen (arte base)', COL_IMAGEN, fila, onImagenCampoChange));
        imgs.appendChild(crearCampoImagen('imagen_final (nivel alto)', COL_IMAGEN_FINAL, fila, onImagenCampoChange));
        formEl.appendChild(imgs);

        const hab = document.createElement('div');
        hab.className = 'editar-cartas-seccion editar-cartas-habilidad-panel';
        hab.innerHTML = '<h3>Habilidad de la carta</h3>';
        aplicarClasePanelHabilidad(hab, fila);

        hab.appendChild(fieldInput('skill_name', fila.skill_name, (v) => {
            fila.skill_name = v;
            aplicarClasePanelHabilidad(hab, fila);
            onFilaChange();
        }));

        const skillClassSel = document.createElement('select');
        skillClassSel.className = 'crear-ep-select filtro-skill-class';
        skillClassSel.appendChild(document.createElement('option')).value = '';
        skillClassSel.options[0].textContent = '—';
        M.ORDEN_SKILL_CLASS.forEach((sc) => {
            const o = document.createElement('option');
            o.value = sc;
            o.textContent = M.ETIQUETAS_SKILL_CLASS[sc] || sc;
            const badge = window.DCFiltrosCartas?.CLASE_BADGE_POR_SKILL?.[sc];
            if (badge) o.className = badge;
            skillClassSel.appendChild(o);
        });
        skillClassSel.value = M.normalizarClaseSkillEditor(fila.skill_class) || '';
        if (window.DCFiltrosCartas?.aplicarClaseVisualSelectSkillClass) {
            window.DCFiltrosCartas.aplicarClaseVisualSelectSkillClass(skillClassSel, skillClassSel.value);
        }
        skillClassSel.addEventListener('change', () => {
            fila.skill_class = skillClassSel.value;
            if (window.DCFiltrosCartas?.aplicarClaseVisualSelectSkillClass) {
                window.DCFiltrosCartas.aplicarClaseVisualSelectSkillClass(skillClassSel, skillClassSel.value);
            }
            aplicarClasePanelHabilidad(hab, fila);
            onFilaChange();
        });
        hab.appendChild(fieldWrap('skill_class', skillClassSel));

        hab.appendChild(fieldInput('skill_info', fila.skill_info, (v) => {
            fila.skill_info = v;
            onFilaChange();
        }, { multiline: true }));

        hab.appendChild(fieldInput('skill_power', fila.skill_power, (v) => {
            fila.skill_power = v;
            onFilaChange();
        }, { placeholder: 'Número o fórmula (ej. Poder*0.5)' }));

        hab.appendChild(fieldSelect('skill_trigger', fila.skill_trigger, M.SKILL_TRIGGER_OPCIONES, (v) => {
            fila.skill_trigger = v;
            onFilaChange();
        }));

        formEl.appendChild(hab);

        const del = btn('Eliminar esta carta del catálogo', 'crear-ep-btn--peligro', () => {
            if (!window.confirm(`¿Eliminar «${fila.Nombre}» del catálogo?`)) return;
            state.filas.splice(state.selIndex, 1);
            state.selIndex = Math.min(state.selIndex, state.filas.length - 1);
            marcarDirty();
            renderAll();
        });
        del.style.marginTop = '8px';
        formEl.appendChild(del);

        renderErroresFila();
    }

    function crearBarraSaludPreview(carta) {
        const saludMax = Math.max(Number(carta.Salud) || Number(carta.Poder) || 1, 1);
        const saludActual = saludMax;
        const porcentaje = 100;
        const cont = document.createElement('div');
        cont.className = 'barra-salud-contenedor';
        const relleno = document.createElement('div');
        relleno.className = 'barra-salud-relleno';
        relleno.style.width = `${porcentaje}%`;
        relleno.style.setProperty('--health-ratio', '1');
        const span = document.createElement('span');
        span.className = 'salud-carta';
        span.textContent = `${saludActual}/${saludMax}`;
        cont.appendChild(relleno);
        cont.appendChild(span);
        return cont;
    }

    function filaComoCartaJuego(fila) {
        const carta = { ...fila };
        carta.Nivel = Math.min(8, Math.max(1, Number(fila.Nivel) || 1));
        carta.Poder = Number(fila.Poder) || 0;
        carta.Salud = Number(fila.Salud) || carta.Poder;
        carta.SaludMax = carta.Salud;
        return carta;
    }

    function construirCartaMiniElement(carta, filaOrigen, cardIndex) {
        const fila = filaOrigen || carta;
        const idx = cardIndex ?? state.selIndex;
        const cartaDiv = document.createElement('div');
        cartaDiv.className = 'carta-mini';

        if (typeof window.dcAplicarClasesNivelCartaCompleta === 'function') {
            window.dcAplicarClasesNivelCartaCompleta(cartaDiv, carta);
        }
        aplicarImagenCartaEditor(cartaDiv, carta, fila, idx);

        const estrellasDiv = document.createElement('div');
        estrellasDiv.className = 'estrellas-carta';
        if (typeof window.dcRellenarEstrellasCartaCompleta === 'function') {
            window.dcRellenarEstrellasCartaCompleta(estrellasDiv, carta, {});
        }

        const detalles = document.createElement('div');
        detalles.className = 'detalles-carta';
        const nombre = document.createElement('span');
        nombre.className = 'nombre-carta';
        nombre.textContent = carta.Nombre;
        const poder = document.createElement('span');
        poder.className = 'poder-carta';
        poder.textContent = typeof window.obtenerPoderActualCarta === 'function'
            ? window.obtenerPoderActualCarta(carta)
            : carta.Poder;
        detalles.appendChild(nombre);
        detalles.appendChild(poder);

        cartaDiv.appendChild(estrellasDiv);
        cartaDiv.appendChild(detalles);

        if (typeof window.crearBadgeHabilidadCarta === 'function') {
            const badge = window.crearBadgeHabilidadCarta(carta);
            if (badge) cartaDiv.appendChild(badge);
        }
        if (typeof window.crearBadgeAfiliacionCarta === 'function') {
            const bAfi = window.crearBadgeAfiliacionCarta(carta);
            if (bAfi) cartaDiv.appendChild(bAfi);
        }
        cartaDiv.appendChild(crearBarraSaludPreview(carta));
        return cartaDiv;
    }

    function seleccionarIndiceCarta(i) {
        state.selIndex = i;
        renderForm();
        renderPreview();
        renderCatalogo();
    }

    function renderPreview() {
        if (!previewEl) return;
        previewEl.innerHTML = '';
        const fila = getFilaActual();
        if (!fila || !String(fila.Nombre || '').trim()) {
            previewEl.innerHTML = '<p class="crear-ep-field-ayuda">Sin previsualización</p>';
            return;
        }
        previewEl.appendChild(construirCartaMiniElement(filaComoCartaJuego(fila), fila, state.selIndex));
    }

    function actualizarVistaCatalogoUi() {
        const esImagenes = state.vistaCatalogo === 'imagenes';
        if (listaEl) listaEl.hidden = esImagenes;
        if (gridEl) gridEl.hidden = !esImagenes;
        const btnImg = $('editar-cartas-vista-imagenes');
        const btnLista = $('editar-cartas-vista-lista');
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
            contadorEl.textContent = `${indices.length} / ${state.filas.length} cartas`;
        }
        indices.forEach((i) => {
            const fila = state.filas[i];
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'editar-cartas-grid-item' + (i === state.selIndex ? ' editar-cartas-grid-item--sel' : '');
            item.appendChild(construirCartaMiniElement(filaComoCartaJuego(fila), fila, i));
            const lab = document.createElement('span');
            lab.className = 'editar-cartas-grid-item-label';
            lab.textContent = fila.Nombre || '(sin nombre)';
            lab.title = fila.Nombre || '';
            item.appendChild(lab);
            item.addEventListener('click', () => seleccionarIndiceCarta(i));
            gridEl.appendChild(item);
        });
    }

    function renderLista() {
        if (!listaEl) return;
        listaEl.innerHTML = '';
        const indices = indicesFiltrados();
        if (contadorEl) {
            contadorEl.textContent = `${indices.length} / ${state.filas.length} cartas`;
        }
        indices.forEach((i) => {
            const fila = state.filas[i];
            const li = document.createElement('li');
            li.className = 'editar-cartas-lista-item';
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'editar-cartas-lista-btn' + (i === state.selIndex ? ' editar-cartas-lista-btn--sel' : '');
            b.innerHTML = `<strong>${fila.Nombre || '(sin nombre)'}</strong><span class="editar-cartas-lista-meta">${fila.Tipo || '—'} · ${fila.faccion || '—'} · ${M.normalizarClaseSkillEditor(fila.skill_class) || 'sin skill'}</span>`;
            b.addEventListener('click', () => seleccionarIndiceCarta(i));
            li.appendChild(b);
            listaEl.appendChild(li);
        });
    }

    function poblarFiltroAfiliacion() {
        const sel = $('filtro-afiliacion-carta');
        if (!sel) return;
        const prev = sel.value || 'todas';
        sel.innerHTML = '<option value="todas">Todas las afiliaciones</option>';
        M.obtenerAfiliacionesUnicas(state.filas).forEach((a) => {
            const o = document.createElement('option');
            o.value = a;
            o.textContent = a;
            sel.appendChild(o);
        });
        sel.value = [...sel.options].some((o) => o.value === prev) ? prev : 'todas';
    }

    function configurarFiltros() {
        const selSkill = $('filtro-skill-class-carta');
        if (selSkill && window.DCFiltrosCartas?.configurarSelectorSkillClass) {
            window.DCFiltrosCartas.configurarSelectorSkillClass(selSkill, {
                valorInicial: 'todas',
                onChange: () => renderCatalogo(),
            });
        }
        ['filtro-nombre-carta', 'filtro-afiliacion-carta', 'filtro-faccion-carta'].forEach((id) => {
            $(id)?.addEventListener('input', () => renderCatalogo());
            $(id)?.addEventListener('change', () => renderCatalogo());
        });
        $('editar-cartas-vista-imagenes')?.addEventListener('click', () => setVistaCatalogo('imagenes'));
        $('editar-cartas-vista-lista')?.addEventListener('click', () => setVistaCatalogo('lista'));
    }

    function renderToolbar() {
        if (!toolbar) return;
        toolbar.innerHTML = '';
        const dirtyLabel = state.dirty ? ' · sin guardar' : '';
        const span = document.createElement('span');
        span.className = 'crear-ep-archivo-activo';
        span.innerHTML = `<strong>cartas.xlsx</strong>${dirtyLabel}`;
        toolbar.appendChild(span);
        toolbar.appendChild(btn('Recargar', 'crear-ep-btn--secundario', () => cargarCatalogo(true)));
        toolbar.appendChild(btn('Guardar Excel', 'crear-ep-btn--primario', () => guardarCatalogo()));
    }

    function renderAll() {
        renderToolbar();
        poblarFiltroAfiliacion();
        renderCatalogo();
        renderForm();
        renderPreview();
    }

    async function cargarCatalogo(force) {
        if (!force && !(await confirmarDescartar())) return;
        try {
            const data = await api('/api/cartas-editor/catalogo');
            const parsed = M.filasDesdeRespuestaApi(data);
            state.columnas = parsed.columnas;
            state.filas = parsed.filas;
            state.filasAlCargar = window.DCEditorGuardadoSeguro?.contarFilasCatalogo(state.filas, 'Nombre') ?? state.filas.length;
            state.dirty = false;
            state.selIndex = state.filas.length ? 0 : -1;
            state.imagenRevision = {};
            sincronizarImagenesCatalogoMemoria();
            if (aviso) aviso.hidden = true;
            if (layout) layout.hidden = false;
            renderAll();
            toastMsg('Catálogo cargado.');
        } catch (e) {
            mostrarAvisoInhabilitado(e);
        }
    }

    async function guardarCatalogo() {
        const val = M.validarCatalogo(state.filas);
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
                campoClave: 'Nombre',
                minAbsoluto: 40,
                etiquetaRecurso: 'cartas.xlsx',
                guardarFn: ({ confirmarTruncamiento }) => api('/api/cartas-editor/catalogo', {
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
            state.filasAlCargar = window.DCEditorGuardadoSeguro.contarFilasCatalogo(state.filas, 'Nombre');
            renderToolbar();
            window.DCEditorDevNav?.marcarCambiosEnDisco();
            window.DCEditorSessionLog?.registrarGuardado?.(
                'cartas',
                'Guardado cartas.xlsx',
                ['public/resources/cartas.xlsx']
            );
            toastMsg('cartas.xlsx guardado correctamente.');
        } catch (e) {
            toastMsg(e.message || 'Error al guardar', true);
        }
    }

    function nuevaCarta() {
        const fila = M.crearFilaCartaVacia();
        fila.Nombre = `Nueva_carta_${Date.now().toString(36).slice(-5)}`;
        state.filas.push(fila);
        state.selIndex = state.filas.length - 1;
        marcarDirty();
        renderAll();
    }

    function mostrarAvisoInhabilitado(err) {
        if (layout) layout.hidden = true;
        if (!aviso) return;
        aviso.hidden = false;
        if (err?.code === 'CARTAS_EDITOR_API_MISSING') {
            aviso.innerHTML = 'API del editor no disponible. Reinicia el servidor con <code>CARTAS_EDITOR=1</code> o en desarrollo local.';
        } else {
            aviso.textContent = err?.message || 'Editor no disponible.';
        }
    }

    async function init() {
        $('editar-cartas-nueva')?.addEventListener('click', nuevaCarta);
        configurarFiltros();
        actualizarVistaCatalogoUi();

        let hab = null;
        try {
            hab = await api('/api/cartas-editor/habilitado');
            if (!hab.habilitado) {
                mostrarAvisoInhabilitado(new Error('Editor deshabilitado en este entorno (producción sin CARTAS_EDITOR=1 o rama distinta de dev).'));
                return;
            }
            window.DCEditorDevNav?.init({
                vistaActual: 'cartas',
                getDirty: () => state.dirty,
            });
            await cargarCatalogo(false);
        } catch (e) {
            mostrarAvisoInhabilitado(e);
        }
    }

    init();
})();
