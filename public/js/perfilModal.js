/**
 * Modal de perfil: colección, mazo más poderoso e inventario RPG.
 */
(function () {
    const GRID_FILAS = 8;
    const GRID_COLUMNAS = 6;
    const SLOTS_TOTAL = GRID_FILAS * GRID_COLUMNAS;

    let catalogoCache = null;
    let catalogoCarga = null;
    let modalInicializado = false;

    const ITEMS_INVENTARIO = [
        { key: 'puntos', titulo: 'Monedas', icono: '/resources/icons/moneda.png', leer: (u) => Math.max(0, Number(u?.puntos || 0)) },
        { key: 'mejoraCarta', titulo: 'Mejora', icono: '/resources/icons/mejora.png', leer: (u) => leerObjeto(u, 'mejoraCarta') },
        { key: 'mejoraEspecial', titulo: 'Mejora especial', icono: '/resources/icons/mejora_especial.png', leer: (u) => leerObjeto(u, 'mejoraEspecial') },
        { key: 'mejoraSuprema', titulo: 'Mejora suprema', icono: '/resources/icons/mejora_suprema.png', leer: (u) => leerObjeto(u, 'mejoraSuprema') },
        { key: 'mejoraDefinitiva', titulo: 'Mejora definitiva', icono: '/resources/icons/mejora_definitiva.png', leer: (u) => leerObjeto(u, 'mejoraDefinitiva') },
        { key: 'mejoraElite', titulo: 'Mejora élite', icono: '/resources/icons/mejora_elite.png', leer: (u) => leerObjeto(u, 'mejoraElite') },
        { key: 'mejoraLegendaria', titulo: 'Mejora legendaria', icono: '/resources/icons/mejora_legendaria.png', leer: (u) => leerObjeto(u, 'mejoraLegendaria') },
        { key: 'sobreH1', titulo: 'Sobre héroe (3)', icono: '/resources/hud/sobre_H1.png', leer: (u) => leerObjeto(u, 'sobreH1') },
        { key: 'sobreH2', titulo: 'Sobre héroe (6)', icono: '/resources/hud/sobre_H2.png', leer: (u) => leerObjeto(u, 'sobreH2') },
        { key: 'sobreH3', titulo: 'Sobre héroe (12)', icono: '/resources/hud/sobre_H3.png', leer: (u) => leerObjeto(u, 'sobreH3') },
        { key: 'sobreV1', titulo: 'Sobre villano (3)', icono: '/resources/hud/sobre_V1.png', leer: (u) => leerObjeto(u, 'sobreV1') },
        { key: 'sobreV2', titulo: 'Sobre villano (6)', icono: '/resources/hud/sobre_V2.png', leer: (u) => leerObjeto(u, 'sobreV2') },
        { key: 'sobreV3', titulo: 'Sobre villano (12)', icono: '/resources/hud/sobre_V3.png', leer: (u) => leerObjeto(u, 'sobreV3') }
    ];

    function leerObjeto(usuario, clave) {
        const objetos = usuario?.objetos && typeof usuario.objetos === 'object' ? usuario.objetos : {};
        return Math.max(0, Math.floor(Number(objetos[clave] || 0)));
    }

    function leerUsuario() {
        try {
            return JSON.parse(localStorage.getItem('usuario') || 'null');
        } catch (_err) {
            return null;
        }
    }

    function normalizarNombreCarta(valor) {
        if (typeof window.DCSkinsCartas !== 'undefined' && typeof window.DCSkinsCartas.obtenerNombreParentCarta === 'function') {
            return String(window.DCSkinsCartas.obtenerNombreParentCarta({ Nombre: valor }) || '').trim().toLowerCase();
        }
        return String(valor || '').trim().toLowerCase();
    }

    function normalizarFaccion(valor) {
        const f = String(valor || '').trim().toUpperCase();
        return f === 'H' || f === 'V' ? f : '';
    }

    function obtenerNombreVisible() {
        if (typeof window.obtenerNombreVisibleSesion === 'function') {
            return window.obtenerNombreVisibleSesion();
        }
        const usuario = leerUsuario() || {};
        const nick = String(usuario.nickname || '').trim();
        if (nick) {
            return nick;
        }
        const email = localStorage.getItem('email') || '';
        return email ? email.split('@')[0] : 'Jugador';
    }

    function obtenerAvatar() {
        if (typeof window.obtenerAvatarSesion === 'function') {
            return window.obtenerAvatarSesion();
        }
        const usuario = leerUsuario() || {};
        return String(usuario.avatar || '').trim() || 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';
    }

    async function cargarCatalogo() {
        if (catalogoCache) {
            return catalogoCache;
        }
        if (catalogoCarga) {
            return catalogoCarga;
        }
        catalogoCarga = (async () => {
            const response = await fetch('resources/cartas.xlsx');
            if (!response.ok) {
                throw new Error('No se pudo cargar el catálogo');
            }
            const data = await response.arrayBuffer();
            if (typeof XLSX === 'undefined') {
                throw new Error('XLSX no disponible');
            }
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const filas = XLSX.utils.sheet_to_json(sheet, { defval: '' });
            const mapa = new Map();
            filas.forEach((fila) => {
                const nombre = String(fila?.Nombre || '').trim();
                const clave = nombre.toLowerCase();
                if (!clave || mapa.has(clave)) {
                    return;
                }
                mapa.set(clave, fila);
            });
            catalogoCache = { filas, mapa };
            return catalogoCache;
        })().catch((error) => {
            catalogoCarga = null;
            throw error;
        });
        return catalogoCarga;
    }

    function calcularProgresoColeccion(usuario, catalogo) {
        const cartasUsuario = Array.isArray(usuario?.cartas) ? usuario.cartas : [];
        const nombresObtenidos = new Set();
        cartasUsuario.forEach((carta) => {
            const clave = normalizarNombreCarta(carta?.Nombre);
            if (clave) {
                nombresObtenidos.add(clave);
            }
        });

        const filas = catalogo?.filas || [];
        const total = filas.length;
        let obtenidas = 0;
        let heroesObtenidos = 0;
        let villanosObtenidos = 0;
        const heroesCat = filas.filter((c) => normalizarFaccion(c.faccion || c.Faccion) === 'H').length;
        const villCat = filas.filter((c) => normalizarFaccion(c.faccion || c.Faccion) === 'V').length;

        filas.forEach((fila) => {
            const clave = String(fila?.Nombre || '').trim().toLowerCase();
            if (!clave || !nombresObtenidos.has(clave)) {
                return;
            }
            obtenidas += 1;
            const fac = normalizarFaccion(fila.faccion || fila.Faccion);
            if (fac === 'H') {
                heroesObtenidos += 1;
            } else if (fac === 'V') {
                villanosObtenidos += 1;
            }
        });

        const pct = total > 0 ? Math.round((obtenidas / total) * 100) : 0;
        return {
            total,
            obtenidas,
            pct,
            heroesObtenidos,
            heroesCat,
            villanosObtenidos,
            villCat
        };
    }

    function calcularPoderMazo(cartas) {
        return (Array.isArray(cartas) ? cartas : []).reduce((sum, carta) => sum + Number(carta?.Poder || 0), 0);
    }

    function obtenerMazoMasPoderoso(usuario) {
        const mazos = Array.isArray(usuario?.mazos) ? usuario.mazos : [];
        let mejor = null;
        let mejorPoder = -1;
        mazos.forEach((mazo) => {
            const poder = calcularPoderMazo(mazo?.Cartas);
            if (poder > mejorPoder) {
                mejorPoder = poder;
                mejor = mazo;
            }
        });
        return { mazo: mejor, poder: Math.max(0, mejorPoder) };
    }

    function obtenerSaludMaxCarta(carta) {
        const saludMax = Number(carta?.SaludMax ?? carta?.saludMax);
        if (Number.isFinite(saludMax) && saludMax > 0) {
            return saludMax;
        }
        const salud = Number(carta?.Salud ?? carta?.salud);
        if (Number.isFinite(salud) && salud > 0) {
            return salud;
        }
        return Math.max(Number(carta?.Poder || 0), 0);
    }

    function obtenerSaludActualCarta(carta) {
        const max = Math.max(obtenerSaludMaxCarta(carta), 1);
        const salud = Number(carta?.Salud ?? carta?.salud);
        const val = Number.isFinite(salud) ? salud : max;
        return Math.max(0, Math.min(val, max));
    }

    function crearBarraSaludPerfil(carta) {
        const saludActual = obtenerSaludActualCarta(carta);
        const saludMax = Math.max(obtenerSaludMaxCarta(carta), 1);
        const porcentaje = Math.max(0, Math.min((saludActual / saludMax) * 100, 100));

        const cont = document.createElement('div');
        cont.className = 'barra-salud-contenedor';

        const relleno = document.createElement('div');
        relleno.className = 'barra-salud-relleno';
        relleno.style.width = `${porcentaje}%`;
        relleno.style.setProperty('--health-ratio', String(porcentaje / 100));

        const texto = document.createElement('span');
        texto.className = 'salud-carta';
        texto.textContent = `${saludActual}/${saludMax}`;

        cont.appendChild(relleno);
        cont.appendChild(texto);
        return cont;
    }

    function crearCartaPerfilMazo(carta) {
        const cartaDiv = document.createElement('div');
        cartaDiv.className = 'carta perfil-mazo-carta';

        if (typeof window.dcAplicarClasesNivelCartaCompleta === 'function') {
            window.dcAplicarClasesNivelCartaCompleta(cartaDiv, carta);
        } else if (Number(carta?.Nivel || 1) >= 6) {
            cartaDiv.classList.add('nivel-legendaria');
        }

        const imagenFn = typeof window.obtenerImagenCarta === 'function' ? window.obtenerImagenCarta : () => '';
        cartaDiv.style.backgroundImage = `url(${imagenFn(carta)})`;
        cartaDiv.style.backgroundSize = 'cover';
        cartaDiv.style.backgroundPosition = 'center top';

        const detalles = document.createElement('div');
        detalles.className = 'detalles-carta';
        const nombre = document.createElement('span');
        nombre.className = 'nombre-carta';
        nombre.textContent = carta?.Nombre || 'Carta';
        const poder = document.createElement('span');
        poder.className = 'poder-carta';
        poder.textContent = carta?.Poder ?? 0;
        detalles.appendChild(nombre);
        detalles.appendChild(poder);

        const estrellas = document.createElement('div');
        estrellas.className = 'estrellas-carta';
        if (typeof window.dcRellenarEstrellasCartaCompleta === 'function') {
            window.dcRellenarEstrellasCartaCompleta(estrellas, carta, {});
        }

        if (typeof window.crearBadgeHabilidadCarta === 'function') {
            const badge = window.crearBadgeHabilidadCarta(carta);
            if (badge) {
                cartaDiv.appendChild(badge);
            }
        }
        if (typeof window.crearBadgeAfiliacionCarta === 'function') {
            const badgeAfi = window.crearBadgeAfiliacionCarta(carta);
            if (badgeAfi) {
                cartaDiv.appendChild(badgeAfi);
            }
        }

        cartaDiv.appendChild(crearBarraSaludPerfil(carta));
        cartaDiv.appendChild(detalles);
        cartaDiv.appendChild(estrellas);
        return cartaDiv;
    }

    function renderizarInventario(usuario) {
        const grid = document.getElementById('perfil-inventario-grid');
        if (!grid) {
            return;
        }
        grid.innerHTML = '';

        const itemsConStock = ITEMS_INVENTARIO
            .map((def) => ({ def, cantidad: def.leer(usuario) }))
            .filter(({ cantidad }) => cantidad > 0);

        let indiceItem = 0;
        for (let i = 0; i < SLOTS_TOTAL; i += 1) {
            const slot = document.createElement('div');
            slot.className = 'perfil-inventario-slot';

            if (indiceItem < itemsConStock.length) {
                const { def, cantidad } = itemsConStock[indiceItem];
                indiceItem += 1;
                slot.classList.add('tiene-item');
                slot.title = `${def.titulo}: ${cantidad}`;

                const img = document.createElement('img');
                img.className = 'perfil-inventario-icono';
                img.src = def.icono;
                img.alt = def.titulo;
                slot.appendChild(img);

                const badge = document.createElement('span');
                badge.className = 'perfil-inventario-cantidad';
                badge.textContent = String(cantidad);
                slot.appendChild(badge);
            } else {
                slot.classList.add('vacio');
            }

            grid.appendChild(slot);
        }
    }

    function renderizarMazoMasPoderoso(usuario) {
        const contenedor = document.getElementById('perfil-mazo-cartas');
        const nombreEl = document.getElementById('perfil-mazo-nombre');
        const poderEl = document.getElementById('perfil-mazo-poder');
        if (!contenedor) {
            return;
        }
        contenedor.innerHTML = '';

        const { mazo, poder } = obtenerMazoMasPoderoso(usuario);
        if (!mazo || !Array.isArray(mazo.Cartas) || mazo.Cartas.length === 0) {
            if (nombreEl) {
                nombreEl.textContent = 'Sin mazos';
            }
            if (poderEl) {
                poderEl.textContent = '';
            }
            contenedor.innerHTML = '<p class="perfil-mazo-vacio">Crea un mazo para verlo aquí.</p>';
            return;
        }

        if (nombreEl) {
            nombreEl.textContent = String(mazo.Nombre || 'Mazo').trim() || 'Mazo';
        }
        if (poderEl) {
            poderEl.textContent = `Poder total: ${poder}`;
        }

        const cartasOrdenadas = [...mazo.Cartas].sort((a, b) => {
            const diff = Number(b?.Poder || 0) - Number(a?.Poder || 0);
            if (diff !== 0) {
                return diff;
            }
            return String(a?.Nombre || '').localeCompare(String(b?.Nombre || ''), undefined, { sensitivity: 'base' });
        });

        cartasOrdenadas.forEach((carta) => {
            if (carta) {
                contenedor.appendChild(crearCartaPerfilMazo(carta));
            }
        });
    }

    function renderizarColeccion(progreso) {
        const elTotal = document.getElementById('perfil-coleccion-total');
        const elHeroes = document.getElementById('perfil-coleccion-heroes');
        const elVillanos = document.getElementById('perfil-coleccion-villanos');
        const barra = document.getElementById('perfil-coleccion-barra-fill');

        if (elTotal) {
            elTotal.textContent = `${progreso.obtenidas}/${progreso.total}`;
        }
        if (elHeroes) {
            elHeroes.textContent = `${progreso.heroesObtenidos}/${progreso.heroesCat}`;
        }
        if (elVillanos) {
            elVillanos.textContent = `${progreso.villanosObtenidos}/${progreso.villCat}`;
        }
        if (barra) {
            barra.style.width = `${progreso.pct}%`;
        }
    }

    async function actualizarContenidoPerfil() {
        const usuario = leerUsuario();
        if (!usuario) {
            return;
        }

        if (typeof window.DCNormalizarObjetosUsuario === 'function') {
            window.DCNormalizarObjetosUsuario(usuario);
        }

        const avatarEl = document.getElementById('perfil-modal-avatar');
        const nombreEl = document.getElementById('perfil-modal-nombre');
        if (avatarEl) {
            avatarEl.src = obtenerAvatar();
        }
        if (nombreEl) {
            nombreEl.textContent = obtenerNombreVisible();
        }

        try {
            const catalogo = await cargarCatalogo();
            renderizarColeccion(calcularProgresoColeccion(usuario, catalogo));
        } catch (error) {
            console.warn('Perfil: no se pudo calcular progreso de colección', error);
            renderizarColeccion({
                total: 0,
                obtenidas: 0,
                pct: 0,
                heroesObtenidos: 0,
                heroesCat: 0,
                villanosObtenidos: 0,
                villCat: 0
            });
        }

        renderizarMazoMasPoderoso(usuario);
        renderizarInventario(usuario);
    }

    function asegurarModalPerfil() {
        if (document.getElementById('perfil-jugador-modal')) {
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'perfil-jugador-modal';
        modal.className = 'modal-dc';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-dc-content perfil-modal-content">
                <h4>Perfil</h4>
                <div class="perfil-modal-scroll">
                    <header class="perfil-modal-header">
                        <img id="perfil-modal-avatar" class="perfil-modal-avatar" alt="Avatar del jugador">
                        <div id="perfil-modal-nombre" class="perfil-modal-nombre"></div>
                    </header>
                    <section class="perfil-seccion" aria-labelledby="perfil-coleccion-titulo">
                        <h5 id="perfil-coleccion-titulo" class="perfil-seccion-titulo">Progreso de colección</h5>
                        <div class="perfil-coleccion-stats">
                            <div class="perfil-coleccion-stat">
                                <span class="perfil-coleccion-stat-label">Total</span>
                                <span id="perfil-coleccion-total" class="perfil-coleccion-stat-valor">0/0</span>
                            </div>
                            <div class="perfil-coleccion-stat">
                                <span class="perfil-coleccion-stat-label">Héroes</span>
                                <span id="perfil-coleccion-heroes" class="perfil-coleccion-stat-valor">0/0</span>
                            </div>
                            <div class="perfil-coleccion-stat">
                                <span class="perfil-coleccion-stat-label">Villanos</span>
                                <span id="perfil-coleccion-villanos" class="perfil-coleccion-stat-valor">0/0</span>
                            </div>
                        </div>
                        <div class="perfil-coleccion-barra" aria-hidden="true">
                            <div id="perfil-coleccion-barra-fill" class="perfil-coleccion-barra-fill"></div>
                        </div>
                    </section>
                    <section class="perfil-seccion" aria-labelledby="perfil-mazo-titulo">
                        <h5 id="perfil-mazo-titulo" class="perfil-seccion-titulo">Mazo más poderoso</h5>
                        <div class="perfil-mazo-meta">
                            <span id="perfil-mazo-nombre" class="perfil-mazo-nombre"></span>
                            <span id="perfil-mazo-poder" class="perfil-mazo-poder"></span>
                        </div>
                        <div id="perfil-mazo-cartas" class="perfil-mazo-cartas"></div>
                    </section>
                    <section class="perfil-seccion" aria-labelledby="perfil-inventario-titulo">
                        <h5 id="perfil-inventario-titulo" class="perfil-seccion-titulo">Inventario</h5>
                        <div id="perfil-inventario-grid" class="perfil-inventario-grid" role="grid" aria-label="Inventario del jugador"></div>
                    </section>
                </div>
                <div class="modal-dc-actions perfil-modal-actions">
                    <button type="button" id="perfil-modal-cerrar-btn" class="btn btn-secondary">Cerrar</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('perfil-modal-cerrar-btn')?.addEventListener('click', cerrarPerfil);
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                cerrarPerfil();
            }
        });
        document.addEventListener('keydown', onEscapePerfil);
    }

    function onEscapePerfil(event) {
        if (event.key !== 'Escape') {
            return;
        }
        const modal = document.getElementById('perfil-jugador-modal');
        if (modal && modal.style.display === 'flex') {
            cerrarPerfil();
        }
    }

    async function abrirPerfil() {
        asegurarModalPerfil();
        const modal = document.getElementById('perfil-jugador-modal');
        if (!modal) {
            return;
        }
        modal.style.display = 'flex';
        await actualizarContenidoPerfil();
    }

    function cerrarPerfil() {
        const modal = document.getElementById('perfil-jugador-modal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    function enlazarAvatarMenu() {
        const avatar = document.getElementById('menu-user-avatar');
        if (!avatar || avatar.dataset.perfilModalBound === '1') {
            return;
        }
        avatar.dataset.perfilModalBound = '1';
        avatar.classList.add('perfil-avatar-btn');
        avatar.setAttribute('role', 'button');
        avatar.setAttribute('tabindex', '0');
        avatar.setAttribute('aria-label', 'Abrir perfil del jugador');
        avatar.title = 'Ver perfil';

        avatar.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            void abrirPerfil();
        });
        avatar.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                void abrirPerfil();
            }
        });
    }

    function init() {
        if (modalInicializado) {
            enlazarAvatarMenu();
            return;
        }
        modalInicializado = true;
        asegurarModalPerfil();
        enlazarAvatarMenu();

        window.addEventListener('dc:usuario-actualizado', () => {
            const modal = document.getElementById('perfil-jugador-modal');
            if (modal && modal.style.display === 'flex') {
                void actualizarContenidoPerfil();
            }
            enlazarAvatarMenu();
        });
    }

    window.DCPerfilModal = {
        init,
        abrir: abrirPerfil,
        cerrar: cerrarPerfil,
        actualizar: actualizarContenidoPerfil,
        enlazarAvatarMenu
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
