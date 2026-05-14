/**
 * Misiones diarias/semanales + tracker global.
 * - Diario: 4 misiones aleatorias (reset 00:00 local)
 * - Semanal: 4 misiones aleatorias (lunes 00:00 local), steps/recompensa x5
 */
(function () {
    const XLSX_PATH = 'resources/misiones_diarias.xlsx';
    const DAILY_SIZE = 4;
    const WEEKLY_SIZE = 4;
    const WEEKLY_MULT = 5;
    const MISIONES_VERSION = 'v1';

    let catalogoMisiones = null;
    let renderTimer = null;
    /** Serializa guardados de misiones para que `await track()` espere el POST real (evita 409 en la siguiente compra de la tienda). */
    let persistMisionesChain = Promise.resolve();

    function nowMs() {
        return Date.now();
    }

    function normalizarClase(valor) {
        return String(valor || '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function leerUsuario() {
        try {
            return JSON.parse(localStorage.getItem('usuario') || 'null');
        } catch (_err) {
            return null;
        }
    }

    function leerEmail() {
        return String(localStorage.getItem('email') || '').trim();
    }

    function escribirUsuario(usuario) {
        localStorage.setItem('usuario', JSON.stringify(usuario));
        window.dispatchEvent(new Event('dc:usuario-actualizado'));
    }

    /** Paridad con server.js: max(progress), claimed OR, ventana más reciente si difiere. */
    function fusionarScopeMisionesCliente(scopeServidor, scopeCliente) {
        const a = scopeServidor && typeof scopeServidor === 'object' ? scopeServidor : { windowId: '', lista: [] };
        const b = scopeCliente && typeof scopeCliente === 'object' ? scopeCliente : { windowId: '', lista: [] };
        const wA = String(a.windowId || '');
        const wB = String(b.windowId || '');
        const listA = Array.isArray(a.lista) ? a.lista : [];
        const listB = Array.isArray(b.lista) ? b.lista : [];
        if (!wB && !wA) {
            return { windowId: '', lista: [] };
        }
        if (!wB) {
            return { windowId: wA, lista: listA.map((m) => ({ ...m })) };
        }
        if (!wA) {
            return { windowId: wB, lista: listB.map((m) => ({ ...m })) };
        }
        if (wA !== wB) {
            return wB > wA
                ? { windowId: wB, lista: listB.map((m) => ({ ...m })) }
                : { windowId: wA, lista: listA.map((m) => ({ ...m })) };
        }
        const byUid = new Map();
        listA.forEach((m) => {
            if (m && m.uid) {
                byUid.set(String(m.uid), { ...m });
            }
        });
        listB.forEach((m) => {
            if (!m || !m.uid) return;
            const uid = String(m.uid);
            const prev = byUid.get(uid);
            if (!prev) {
                byUid.set(uid, { ...m });
                return;
            }
            byUid.set(uid, {
                ...prev,
                ...m,
                progress: Math.max(Number(prev.progress || 0), Number(m.progress || 0)),
                claimed: Boolean(prev.claimed) || Boolean(m.claimed),
            });
        });
        return { windowId: wA, lista: Array.from(byUid.values()) };
    }

    function fusionarMisionesCliente(misionesServidor, misionesCliente) {
        const s = misionesServidor && typeof misionesServidor === 'object' ? misionesServidor : {};
        const c = misionesCliente && typeof misionesCliente === 'object' ? misionesCliente : {};
        return {
            version: String(c.version || s.version || 'v1'),
            diarias: fusionarScopeMisionesCliente(s.diarias, c.diarias),
            semanales: fusionarScopeMisionesCliente(s.semanales, c.semanales),
        };
    }

    async function persistirUsuario(usuario, reintento409 = false) {
        const email = leerEmail();
        if (!email) {
            escribirUsuario(usuario);
            return;
        }
        const response = await fetch('/update-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario, email })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 409 && data?.usuario) {
                if (!reintento409 && usuario?.misiones && typeof usuario.misiones === 'object') {
                    const merged = { ...data.usuario };
                    merged.misiones = fusionarMisionesCliente(data.usuario.misiones || {}, usuario.misiones);
                    escribirUsuario(merged);
                    return persistirUsuario(merged, true);
                }
                escribirUsuario(data.usuario);
            }
            throw new Error(data?.mensaje || 'No se pudo guardar progreso de misiones');
        }
        if (data?.usuario && usuario && typeof usuario === 'object') {
            Object.keys(usuario).forEach((k) => delete usuario[k]);
            Object.assign(usuario, data.usuario);
        }
        escribirUsuario(usuario);
    }

    async function persistirUsuarioDebounced(usuario) {
        const work = async () => {
            await persistirUsuario(usuario);
        };
        persistMisionesChain = persistMisionesChain.then(work).catch((e) => {
            console.warn('[misiones persist]', e);
        });
        return persistMisionesChain;
    }

    function inicioDelDia(d = new Date()) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function idDiario(d = new Date()) {
        const yy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yy}-${mm}-${dd}`;
    }

    function inicioSemanaLunes(d = new Date()) {
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const day = x.getDay(); // 0 domingo
        const diffToMonday = (day + 6) % 7;
        x.setDate(x.getDate() - diffToMonday);
        x.setHours(0, 0, 0, 0);
        return x;
    }

    function idSemanal(d = new Date()) {
        const ini = inicioSemanaLunes(d);
        const yy = ini.getFullYear();
        const mm = String(ini.getMonth() + 1).padStart(2, '0');
        const dd = String(ini.getDate()).padStart(2, '0');
        return `${yy}-${mm}-${dd}`;
    }

    function hashString(valor) {
        let h = 2166136261;
        for (let i = 0; i < valor.length; i++) {
            h ^= valor.charCodeAt(i);
            h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
        }
        return h >>> 0;
    }

    function crearRng(seedText) {
        let s = hashString(seedText) || 123456789;
        return () => {
            s = (1664525 * s + 1013904223) >>> 0;
            return s / 4294967296;
        };
    }

    async function cargarCatalogoMisiones() {
        if (catalogoMisiones) return catalogoMisiones;
        if (typeof XLSX === 'undefined') {
            return [];
        }
        const res = await fetch(XLSX_PATH);
        if (!res.ok) return [];
        const data = await res.arrayBuffer();
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
        catalogoMisiones = rows.map((r, i) => ({
            id: Number(r.ID ?? r.id ?? i + 1),
            descripcion: String(r.descripcion || '').trim(),
            classKey: normalizarClase(r.class),
            steps: Math.max(1, Number(r.steps || 1)),
            recompensa: Math.max(0, Number(r.recompensa || 0))
        })).filter((m) => m.descripcion && m.classKey);
        return catalogoMisiones;
    }

    function tomarAleatoriasDeterministas(items, n, seed) {
        const arr = [...items];
        const out = [];
        const rng = crearRng(seed);
        while (arr.length > 0 && out.length < n) {
            const idx = Math.floor(rng() * arr.length);
            out.push(arr.splice(idx, 1)[0]);
        }
        return out;
    }

    function crearEntradaMision(base, scope, mult = 1) {
        return {
            uid: `${scope}-${base.id}`,
            id: Number(base.id),
            descripcion: String(base.descripcion || ''),
            classKey: normalizarClase(base.classKey),
            steps: Math.max(1, Math.floor(Number(base.steps || 1) * mult)),
            recompensa: Math.max(0, Math.floor(Number(base.recompensa || 0) * mult)),
            progress: 0,
            claimed: false
        };
    }

    function normalizarEstadoMisiones(usuario) {
        usuario.misiones = (usuario.misiones && typeof usuario.misiones === 'object') ? usuario.misiones : {};
        usuario.misiones.version = MISIONES_VERSION;
        usuario.misiones.diarias = (usuario.misiones.diarias && typeof usuario.misiones.diarias === 'object')
            ? usuario.misiones.diarias
            : { windowId: '', lista: [] };
        usuario.misiones.semanales = (usuario.misiones.semanales && typeof usuario.misiones.semanales === 'object')
            ? usuario.misiones.semanales
            : { windowId: '', lista: [] };
    }

    async function ensureWindowsActualizadas(usuario) {
        normalizarEstadoMisiones(usuario);
        const catalogo = await cargarCatalogoMisiones();
        if (!catalogo.length) return false;
        const email = leerEmail() || 'anon';
        const dId = idDiario();
        const wId = idSemanal();
        let changed = false;

        if (usuario.misiones.diarias.windowId !== dId || !Array.isArray(usuario.misiones.diarias.lista) || usuario.misiones.diarias.lista.length !== DAILY_SIZE) {
            const seed = `misiones-diarias-${dId}-${email}-${MISIONES_VERSION}`;
            const picks = tomarAleatoriasDeterministas(catalogo, DAILY_SIZE, seed);
            usuario.misiones.diarias = {
                windowId: dId,
                lista: picks.map((p) => crearEntradaMision(p, `d-${dId}`, 1))
            };
            changed = true;
        }

        if (usuario.misiones.semanales.windowId !== wId || !Array.isArray(usuario.misiones.semanales.lista) || usuario.misiones.semanales.lista.length !== WEEKLY_SIZE) {
            const seed = `misiones-semanales-${wId}-${email}-${MISIONES_VERSION}`;
            const picks = tomarAleatoriasDeterministas(catalogo, WEEKLY_SIZE, seed);
            usuario.misiones.semanales = {
                windowId: wId,
                lista: picks.map((p) => crearEntradaMision(p, `w-${wId}`, WEEKLY_MULT))
            };
            changed = true;
        }
        return changed;
    }

    function reemplazarStepsDescripcion(desc, steps) {
        return String(desc || '').replace(/@steps/gi, String(steps));
    }

    function escapeHtml(texto) {
        return String(texto || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function descripcionConStepsResaltado(desc, steps) {
        const safe = escapeHtml(String(desc || ''));
        const stepsTxt = escapeHtml(String(steps));
        if (!/@steps/gi.test(String(desc || ''))) {
            return `${safe} <span class="misiones-steps-highlight">${stepsTxt}</span>`;
        }
        return safe.replace(/@steps/gi, `<span class="misiones-steps-highlight">${stepsTxt}</span>`);
    }

    function crearFilaMision(item, scope) {
        const done = Number(item.progress || 0) >= Number(item.steps || 1);
        const row = document.createElement('div');
        row.className = `misiones-item ${done ? 'done' : ''}`;

        const d = document.createElement('div');
        d.className = 'misiones-item-desc';
        d.innerHTML = descripcionConStepsResaltado(item.descripcion, item.steps);

        const p = document.createElement('div');
        p.className = 'misiones-item-progreso';
        const value = Math.min(Number(item.progress || 0), Number(item.steps || 1));
        p.textContent = `Progreso: ${value}/${item.steps}`;

        const bar = document.createElement('div');
        bar.className = 'misiones-progress';
        const fill = document.createElement('div');
        fill.className = 'misiones-progress-fill';
        const ratio = Math.max(0, Math.min((value / Math.max(1, Number(item.steps || 1))) * 100, 100));
        fill.style.width = `${ratio}%`;
        bar.appendChild(fill);

        const r = document.createElement('div');
        r.className = 'misiones-item-recompensa';
        r.innerHTML = `Recompensa: ${item.recompensa} <img src="/resources/icons/moneda.png" alt="Moneda" style="width:15px;height:15px;object-fit:contain;vertical-align:text-bottom;margin-left:4px;">`;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn misiones-btn-claim';
        if (item.claimed) {
            btn.classList.add('misiones-btn-claim--reclamada');
            btn.textContent = 'Reclamada';
            btn.disabled = true;
        } else if (done) {
            btn.classList.add('misiones-btn-claim--listo');
            btn.textContent = 'Reclamar';
            btn.disabled = false;
        } else {
            btn.classList.add('btn-primary', 'misiones-btn-claim--pendiente');
            btn.textContent = 'Reclamar recompensa';
            btn.disabled = true;
        }
        btn.addEventListener('click', () => void reclamar(scope, item.uid));

        row.appendChild(d);
        row.appendChild(p);
        row.appendChild(bar);
        row.appendChild(r);
        row.appendChild(btn);
        return row;
    }

    function render() {
        const diariasEl = document.getElementById('misiones-diarias-lista');
        const semanalesEl = document.getElementById('misiones-semanales-lista');
        if (!diariasEl || !semanalesEl) return;
        const usuario = leerUsuario();
        if (!usuario || !usuario.misiones) return;
        const diarias = Array.isArray(usuario.misiones.diarias?.lista) ? usuario.misiones.diarias.lista : [];
        const semanales = Array.isArray(usuario.misiones.semanales?.lista) ? usuario.misiones.semanales.lista : [];
        diariasEl.innerHTML = '';
        semanalesEl.innerHTML = '';
        diarias.forEach((m) => diariasEl.appendChild(crearFilaMision(m, 'diarias')));
        semanales.forEach((m) => semanalesEl.appendChild(crearFilaMision(m, 'semanales')));
        renderResetTimers();
    }

    function msHastaProximoDiario() {
        const n = new Date();
        const next = inicioDelDia(n);
        next.setDate(next.getDate() + 1);
        return Math.max(0, next.getTime() - n.getTime());
    }

    function msHastaProximoSemanal() {
        const n = new Date();
        const next = inicioSemanaLunes(n);
        next.setDate(next.getDate() + 7);
        return Math.max(0, next.getTime() - n.getTime());
    }

    function formatCuentaAtrasMisiones(ms) {
        return typeof window.dcFormatearCuentaAtrasMs === 'function'
            ? window.dcFormatearCuentaAtrasMs(ms)
            : '0s';
    }

    function renderResetTimers() {
        const d = document.getElementById('misiones-diarias-reset');
        const w = document.getElementById('misiones-semanales-reset');
        const dBar = document.getElementById('misiones-diarias-reset-bar');
        const wBar = document.getElementById('misiones-semanales-reset-bar');
        const dMs = msHastaProximoDiario();
        const wMs = msHastaProximoSemanal();
        if (d) d.textContent = `Tiempo restante: ${formatCuentaAtrasMisiones(dMs)}`;
        if (w) w.textContent = `Tiempo restante: ${formatCuentaAtrasMisiones(wMs)}`;

        const DAY_MS = 24 * 60 * 60 * 1000;
        const WEEK_MS = 7 * DAY_MS;
        const dProgress = Math.max(0, Math.min(100, ((DAY_MS - dMs) / DAY_MS) * 100));
        const wProgress = Math.max(0, Math.min(100, ((WEEK_MS - wMs) / WEEK_MS) * 100));
        if (dBar) dBar.style.width = `${dProgress}%`;
        if (wBar) wBar.style.width = `${wProgress}%`;
    }

    async function reclamar(scope, uid) {
        const usuario = leerUsuario();
        if (!usuario) return;
        const lista = Array.isArray(usuario?.misiones?.[scope]?.lista) ? usuario.misiones[scope].lista : [];
        const item = lista.find((m) => m.uid === uid);
        if (!item || item.claimed) return;
        if (Number(item.progress || 0) < Number(item.steps || 1)) return;
        item.claimed = true;
        usuario.puntos = Number(usuario.puntos || 0) + Number(item.recompensa || 0);
        await persistirUsuarioDebounced(usuario);
        render();
    }

    function incrementarMisionLista(lista, predicate, amount) {
        let touched = false;
        const inc = Math.max(0, Number(amount || 0));
        if (inc <= 0) return false;
        (Array.isArray(lista) ? lista : []).forEach((m) => {
            if (m.claimed) return;
            if (!predicate(m.classKey)) return;
            const maxSteps = Math.max(1, Number(m.steps || 1));
            const next = Math.min(maxSteps, Number(m.progress || 0) + inc);
            if (next !== Number(m.progress || 0)) {
                m.progress = next;
                touched = true;
            }
        });
        return touched;
    }

    function mapearEventoAIncrementos(tipo, payload = {}) {
        const cls = normalizarClase(tipo);
        const incs = [];
        if (cls === 'shop_mejora') incs.push({ classKey: 'shop_mejora', amount: Number(payload.amount || 1) });
        if (cls === 'shop_sobres') incs.push({ classKey: 'shop_sobres', amount: Number(payload.amount || 1) });
        if (cls === 'sobres') incs.push({ classKey: 'sobres', amount: Number(payload.amount || 1) });
        if (cls === 'desafios') incs.push({ classKey: 'desafios', amount: Number(payload.amount || 1) });
        if (cls === 'pvp') incs.push({ classKey: 'pvp', amount: Number(payload.amount || 1) });
        if (cls === 'evento_coop') incs.push({ classKey: 'evento_coop', amount: Number(payload.amount || 1) });
        if (cls === 'bot') incs.push({ classKey: 'bot', amount: Number(payload.amount || 1) });
        if (cls === 'bot_defeat') incs.push({ classKey: 'bot_defeat', amount: Number(payload.amount || 1) });
        if (cls === 'boss') incs.push({ classKey: 'boss', amount: Number(payload.amount || 1) });
        if (cls === 'mejorar_cartas_h') incs.push({ classKey: 'mejorar_cartas_h', amount: Number(payload.amount || 1) });
        if (cls === 'mejorar_cartas_v') incs.push({ classKey: 'mejorar_cartas_v', amount: Number(payload.amount || 1) });
        if (cls === 'mejorar_nivel' || cls === 'mejora_nivel') {
            const amt = Number(payload.amount || 1);
            incs.push({ classKey: 'mejorar_nivel', amount: amt });
            incs.push({ classKey: 'mejora_nivel', amount: amt });
        }
        if (cls === 'coleccion_h') incs.push({ classKey: 'coleccion_h', amount: Number(payload.amount || 1) });
        if (cls === 'coleccion_v') incs.push({ classKey: 'coleccion_v', amount: Number(payload.amount || 1) });
        return incs;
    }

    async function aplicarIncrementoTrack(tipo, payload = {}) {
        const incs = mapearEventoAIncrementos(tipo, payload);
        if (incs.length === 0) return;

        const latest = leerUsuario();
        if (!latest) return;

        const changedWindow = await ensureWindowsActualizadas(latest);
        let changed = changedWindow;
        incs.forEach((inc) => {
            const pred = (k) => normalizarClase(k) === normalizarClase(inc.classKey);
            if (incrementarMisionLista(latest.misiones.diarias.lista, pred, inc.amount)) changed = true;
            if (incrementarMisionLista(latest.misiones.semanales.lista, pred, inc.amount)) changed = true;
        });
        if (!changed) return;

        const fresh = leerUsuario();
        if (!fresh) return;
        fresh.misiones = fusionarMisionesCliente(fresh.misiones || {}, latest.misiones);
        await persistirUsuarioDebounced(fresh);
        render();
    }

    /**
     * Cola FIFO: varias llamadas seguidas (p. ej. sobres + coleccion_h + coleccion_v) no deben
     * solaparse; cada track lee/persiste en paralelo y la última podía pisar `misiones` en Firebase/LS.
     */
    let trackCola = Promise.resolve();

    function track(tipo, payload = {}) {
        const run = trackCola.then(() => aplicarIncrementoTrack(tipo, payload));
        trackCola = run.catch((e) => {
            console.warn('[DCMisiones.track]', tipo, e);
        });
        return run;
    }

    async function inicializar() {
        const usuario = leerUsuario();
        if (!usuario) return;
        const changed = await ensureWindowsActualizadas(usuario);
        if (changed) {
            await persistirUsuarioDebounced(usuario);
        }
        render();

        if (!renderTimer && document.getElementById('misiones-diarias-lista')) {
            renderTimer = setInterval(async () => {
                const u = leerUsuario();
                if (!u) return;
                const c = await ensureWindowsActualizadas(u);
                if (c) {
                    await persistirUsuarioDebounced(u);
                } else {
                    renderResetTimers();
                }
            }, 1000);
        }
    }

    // API global
    window.DCMisiones = {
        init: () => void inicializar(),
        track,
        refresh: () => void inicializar()
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => void inicializar());
    } else {
        void inicializar();
    }
})();
