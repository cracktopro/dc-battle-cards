/**
 * Modal reutilizable para elegir una carta del catálogo (miniatura completa + filtros).
 */
(function () {
    'use strict';

    let dialogEl = null;
    let session = null;
    let catalogoFilas = [];
    let mapaCatalogo = new Map();
    let skinsIndexados = null;

    function $(id) {
        return document.getElementById(id);
    }

    function normalizarNombre(n) {
        return String(n || '').trim().toLowerCase();
    }

    function asegurarDialogo() {
        if (dialogEl) return dialogEl;
        dialogEl = document.createElement('dialog');
        dialogEl.id = 'editor-carta-picker-dialog';
        dialogEl.className = 'editor-carta-picker-dialog';
        dialogEl.innerHTML = `
            <div class="editor-carta-picker-panel">
                <h3 class="crear-ep-dialog-titulo" id="editor-carta-picker-titulo">Seleccionar carta</h3>
                <div class="editor-carta-picker-filtros">
                    <input type="search" id="editor-carta-picker-nombre" placeholder="Nombre…" autocomplete="off" spellcheck="false">
                    <select id="editor-carta-picker-faccion" class="crear-ep-select" aria-label="Facción">
                        <option value="todas">Todas las facciones</option>
                        <option value="H">Héroes (H)</option>
                        <option value="V">Villanos (V)</option>
                    </select>
                    <select id="editor-carta-picker-afiliacion" class="crear-ep-select" aria-label="Afiliación">
                        <option value="todas">Todas las afiliaciones</option>
                    </select>
                    <select id="editor-carta-picker-skill" class="crear-ep-select filtro-skill-class" aria-label="Tipo de habilidad"></select>
                </div>
                <div id="editor-carta-picker-grid" class="editor-carta-picker-grid" role="listbox"></div>
                <p id="editor-carta-picker-seleccion" class="editor-carta-picker-seleccion" aria-live="polite"></p>
                <div class="crear-ep-dialog-acciones crear-ep-dialog-acciones--recurso">
                    <button type="button" id="editor-carta-picker-aceptar" class="crear-ep-btn crear-ep-btn--primario">Aceptar</button>
                    <button type="button" id="editor-carta-picker-cancelar" class="crear-ep-btn crear-ep-btn--secundario">Cancelar</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialogEl);

        $('editor-carta-picker-cancelar')?.addEventListener('click', () => {
            dialogEl.close();
            session = null;
        });
        $('editor-carta-picker-aceptar')?.addEventListener('click', confirmar);
        dialogEl.addEventListener('cancel', () => { session = null; });
        dialogEl.addEventListener('close', () => { session = null; });

        ['editor-carta-picker-nombre', 'editor-carta-picker-faccion', 'editor-carta-picker-afiliacion', 'editor-carta-picker-skill']
            .forEach((id) => {
                $(id)?.addEventListener('input', pintarGrid);
                $(id)?.addEventListener('change', pintarGrid);
            });

        if (window.DCFiltrosCartas?.configurarSelectorSkillClass) {
            window.DCFiltrosCartas.configurarSelectorSkillClass($('editor-carta-picker-skill'), { valorInicial: 'todas' });
        }

        return dialogEl;
    }

    async function asegurarCatalogo() {
        if (typeof XLSX !== 'undefined' && typeof window.DCCatalogoCartas?.cargarFilas === 'function') {
            catalogoFilas = await window.DCCatalogoCartas.cargarFilas();
        } else {
            const res = await fetch('/api/cartas-editor/catalogo');
            if (!res.ok) throw new Error('No se pudo cargar el catálogo de cartas.');
            const data = await res.json();
            catalogoFilas = data.filas || [];
        }
        mapaCatalogo = new Map();
        catalogoFilas.forEach((f) => {
            const n = String(f.Nombre || '').trim();
            if (n) mapaCatalogo.set(normalizarNombre(n), f);
        });
        poblarAfiliaciones();
        if (window.DCSkinsCartas?.asegurarSkinsCargados) {
            skinsIndexados = await window.DCSkinsCartas.asegurarSkinsCargados();
        }
    }

    function parseValorInicial(value) {
        const texto = String(value || '').trim();
        if (!texto) {
            return { refTexto: '', parent: '', skinId: null };
        }
        if (window.DCSkinsCartas?.parsearReferenciaCartaConSkin) {
            const ref = window.DCSkinsCartas.parsearReferenciaCartaConSkin(texto);
            return {
                refTexto: ref.textoOriginal || texto,
                parent: ref.nombreCatalogo || texto,
                skinId: ref.skinId,
            };
        }
        return { refTexto: texto, parent: texto, skinId: null };
    }

    function resolverFilaParaMini(referencia) {
        const texto = String(referencia || '').trim();
        if (!texto) {
            return null;
        }
        const S = window.DCSkinsCartas;
        if (S?.resolverFilaCatalogoConSkinSync && skinsIndexados) {
            const resuelta = S.resolverFilaCatalogoConSkinSync(texto, mapaCatalogo, skinsIndexados);
            if (resuelta) {
                return resuelta;
            }
        }
        const parent = S?.obtenerNombreCatalogoDesdeReferencia
            ? S.obtenerNombreCatalogoDesdeReferencia(texto)
            : texto;
        const fila = mapaCatalogo.get(normalizarNombre(parent));
        return fila ? { ...fila } : null;
    }

    function poblarAfiliaciones() {
        const sel = $('editor-carta-picker-afiliacion');
        if (!sel) return;
        const set = new Set();
        catalogoFilas.forEach((f) => {
            String(f.Afiliacion || '').split(';').map((s) => s.trim()).filter(Boolean).forEach((a) => set.add(a));
        });
        const prev = sel.value || 'todas';
        sel.innerHTML = '<option value="todas">Todas las afiliaciones</option>';
        [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).forEach((a) => {
            const o = document.createElement('option');
            o.value = a;
            o.textContent = a;
            sel.appendChild(o);
        });
        if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
    }

    function filaComoCartaJuego(fila) {
        const carta = { ...fila };
        carta.Nivel = Math.min(8, Math.max(1, Number(fila.Nivel) || 1));
        carta.Poder = Number(fila.Poder) || 0;
        carta.Salud = Number(fila.Salud) || carta.Poder;
        carta.SaludMax = carta.Salud;
        return carta;
    }

    function resolverUrlImagen(fila) {
        const nivel = Math.min(8, Math.max(1, Number(fila.Nivel) || 1));
        const imagen = String(fila.Imagen || '').trim();
        const imagenFinal = String(fila.imagen_final || '').trim();
        if (typeof window.cartaMuestraImagenFinal === 'function' && window.cartaMuestraImagenFinal(nivel) && imagenFinal) {
            return imagenFinal;
        }
        const v = imagen || 'img/default-image.jpg';
        if (/^https?:\/\//i.test(v) || v.startsWith('data:') || v.startsWith('/')) return v;
        return v.includes('/') ? v : `img/${v}`;
    }

    function construirMiniCarta(fila) {
        const cartaDiv = crearCartaMiniDiv(fila);
        const wrap = document.createElement('button');
        wrap.type = 'button';
        wrap.className = 'editor-carta-picker-item';
        wrap.dataset.nombre = String(fila.Nombre || '').trim();
        wrap.appendChild(cartaDiv);
        return wrap;
    }

    function crearCartaMiniDiv(fila) {
        const carta = filaComoCartaJuego(fila);
        const cartaDiv = document.createElement('div');
        cartaDiv.className = 'carta-mini';
        if (typeof window.dcAplicarClasesNivelCartaCompleta === 'function') {
            window.dcAplicarClasesNivelCartaCompleta(cartaDiv, carta);
        }
        const url = resolverUrlImagen(fila);
        if (typeof window.aplicarImagenFondoCarta === 'function') {
            window.aplicarImagenFondoCarta(cartaDiv, carta, { imagenUrl: url });
        } else {
            cartaDiv.style.backgroundImage = `url(${url})`;
            cartaDiv.style.backgroundSize = 'cover';
        }

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

        const saludMax = Math.max(Number(carta.Salud) || 1, 1);
        const barra = document.createElement('div');
        barra.className = 'barra-salud-contenedor';
        const relleno = document.createElement('div');
        relleno.className = 'barra-salud-relleno';
        relleno.style.width = '100%';
        const span = document.createElement('span');
        span.className = 'salud-carta';
        span.textContent = `${saludMax}/${saludMax}`;
        barra.appendChild(relleno);
        barra.appendChild(span);
        cartaDiv.appendChild(barra);

        return cartaDiv;
    }

    function crearVistaMiniCarta(nombreReferencia) {
        const fila = resolverFilaParaMini(nombreReferencia);
        if (!fila) {
            const S = window.DCSkinsCartas;
            const parent = S?.obtenerNombreCatalogoDesdeReferencia
                ? S.obtenerNombreCatalogoDesdeReferencia(nombreReferencia)
                : String(nombreReferencia || '').trim();
            if (!parent) {
                return null;
            }
            const vacio = document.createElement('div');
            vacio.className = 'editar-desafios-carta-slot-vacio';
            vacio.innerHTML = `<span>${parent}</span><span style="font-size:0.6rem">(no en catálogo)</span>`;
            return vacio;
        }
        return crearCartaMiniDiv(fila);
    }

    function filtrosActuales() {
        return {
            nombre: $('editor-carta-picker-nombre')?.value || '',
            faccion: $('editor-carta-picker-faccion')?.value || 'todas',
            afiliacion: $('editor-carta-picker-afiliacion')?.value || 'todas',
            skillClass: $('editor-carta-picker-skill')?.value || 'todas',
        };
    }

    function filaCoincide(fila, f) {
        const q = String(f.nombre || '').trim().toLowerCase();
        if (q && !String(fila.Nombre || '').toLowerCase().includes(q)) return false;
        const fac = String(f.faccion || 'todas').trim().toUpperCase();
        if (fac && fac !== 'TODAS' && String(fila.faccion || '').trim().toUpperCase() !== fac) return false;
        const afi = String(f.afiliacion || 'todas').trim();
        if (afi && afi !== 'todas') {
            const lista = String(fila.Afiliacion || '').split(';').map((s) => s.trim().toLowerCase());
            if (!lista.includes(afi.toLowerCase())) return false;
        }
        if (window.DCFiltrosCartas?.cartaCoincideSkillClass) {
            if (!window.DCFiltrosCartas.cartaCoincideSkillClass(fila, f.skillClass)) return false;
        }
        return true;
    }

    function updateSeleccionLabel() {
        const el = $('editor-carta-picker-seleccion');
        if (!el || !session) return;
        const ref = session.pendingRef;
        el.innerHTML = ref
            ? `Selección: <strong>${ref}</strong>`
            : 'Selección: <strong>— ninguna —</strong>';
    }

    function seleccionarNombre(nombreParent) {
        if (!session) return;
        const parent = String(nombreParent || '').trim();
        session.pendingParent = parent;
        session.pendingRef = parent;
        session.pendingSkinId = null;
        const grid = $('editor-carta-picker-grid');
        grid?.querySelectorAll('.editor-carta-picker-item').forEach((item) => {
            item.classList.toggle('editor-carta-picker-item--sel', item.dataset.nombre === parent);
        });
        updateSeleccionLabel();
    }

    function pintarGrid() {
        const grid = $('editor-carta-picker-grid');
        if (!grid || !session) return;
        const f = filtrosActuales();
        grid.innerHTML = '';

        if (session.allowEmpty) {
            const vacio = document.createElement('button');
            vacio.type = 'button';
            vacio.className = 'editor-carta-picker-item editor-carta-picker-item--vacio'
                + (!session.pendingRef ? ' editor-carta-picker-item--sel' : '');
            vacio.dataset.nombre = '';
            vacio.innerHTML = '<span class="editor-carta-picker-vacio-label">+</span><span>Quitar carta</span>';
            vacio.addEventListener('click', () => seleccionarNombre(''));
            vacio.addEventListener('dblclick', () => { seleccionarNombre(''); confirmar(); });
            grid.appendChild(vacio);
        }

        const filtradas = catalogoFilas.filter((row) => filaCoincide(row, f));
        if (!filtradas.length && !(session.allowEmpty)) {
            grid.innerHTML = '<p class="editor-carta-picker-vacio-msg">Ninguna carta coincide con los filtros.</p>';
            return;
        }

        const selParent = session.pendingParent || '';
        filtradas.forEach((fila) => {
            const item = construirMiniCarta(fila);
            if (String(fila.Nombre || '').trim() === selParent) {
                item.classList.add('editor-carta-picker-item--sel');
            }
            item.addEventListener('click', () => seleccionarNombre(String(fila.Nombre || '').trim()));
            item.addEventListener('dblclick', () => {
                seleccionarNombre(String(fila.Nombre || '').trim());
                confirmar();
            });
            grid.appendChild(item);
        });
    }

    async function confirmar() {
        if (!session) return;
        const onAccept = session.onAccept;
        const permitirSkin = Boolean(session.permitirSkin);
        const refActual = session.pendingRef || '';

        if (!refActual && session.allowEmpty) {
            dialogEl.close();
            session = null;
            onAccept('');
            return;
        }

        const parent = session.pendingParent || refActual;
        if (!parent) {
            return;
        }

        let valorFinal = refActual;

        if (permitirSkin && window.DCSkinsCartas && window.DCSeleccionCartaApariencia?.abrirModalAparienciaEditor) {
            await window.DCSkinsCartas.asegurarSkinsCargados();
            const skinsParent = window.DCSkinsCartas.obtenerSkinsDelParent(parent, skinsIndexados);
            if (skinsParent.length > 0) {
                dialogEl.close();
                try {
                    const skinId = await window.DCSeleccionCartaApariencia.abrirModalAparienciaEditor({
                        parentNombre: parent,
                        mapaCatalogo,
                        skinIdInicial: session.pendingSkinId,
                    });
                    valorFinal = window.DCSkinsCartas.formatearReferenciaCartaConSkin(parent, skinId);
                } catch (_e) {
                    session = null;
                    return;
                }
            } else {
                valorFinal = parent;
            }
        } else if (!refActual.includes('[')) {
            valorFinal = parent;
        }

        session = null;
        onAccept(valorFinal);
    }

    /**
     * @param {{ titulo?: string, value?: string, allowEmpty?: boolean, permitirSkin?: boolean, onAccept: (nombre: string) => void }} opts
     */
    async function abrir(opts) {
        await asegurarCatalogo();
        asegurarDialogo();
        const parsed = parseValorInicial(opts.value);
        session = {
            pendingRef: parsed.refTexto,
            pendingParent: parsed.parent,
            pendingSkinId: parsed.skinId,
            allowEmpty: opts.allowEmpty !== false,
            permitirSkin: Boolean(opts.permitirSkin),
            onAccept: opts.onAccept,
        };
        const titulo = $('editor-carta-picker-titulo');
        if (titulo) titulo.textContent = opts.titulo || 'Seleccionar carta';
        $('editor-carta-picker-nombre').value = '';
        $('editor-carta-picker-faccion').value = 'todas';
        $('editor-carta-picker-afiliacion').value = 'todas';
        if ($('editor-carta-picker-skill')) {
            $('editor-carta-picker-skill').value = 'todas';
            window.DCFiltrosCartas?.aplicarClaseVisualSelectSkillClass?.($('editor-carta-picker-skill'), 'todas');
        }
        pintarGrid();
        updateSeleccionLabel();
        dialogEl.showModal();
        requestAnimationFrame(() => $('editor-carta-picker-nombre')?.focus());
    }

    function buscarFilaCatalogo(nombre) {
        return mapaCatalogo.get(normalizarNombre(nombre)) || null;
    }

    window.DCEditorCartaPicker = {
        abrir,
        asegurarCatalogo,
        buscarFilaCatalogo,
        crearVistaMiniCarta,
        resolverFilaParaMini,
        parseValorInicial,
    };
})();
