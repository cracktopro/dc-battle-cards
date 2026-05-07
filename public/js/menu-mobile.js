/**
 * Barra superior + menú lateral tipo drawer en viewport <= 899px.
 * Inserta UI mínima en el DOM; el aspecto se controla en css/app-layout.css
 */
(function () {
    var BP = 899;
    var mq = window.matchMedia("(max-width: " + BP + "px)");
    var LS_SEEN_CARD_NAMES = "dc_seen_card_names_v1";
    var LS_SEEN_INIT = "dc_seen_card_names_initialized_v1";
    var LS_SEEN_PACKS_SIGNATURE = "dc_seen_packs_signature_v1";

    function getMenu() {
        return document.querySelector("body > .menu-container");
    }

    function obtenerUsuarioActual() {
        try {
            return JSON.parse(localStorage.getItem("usuario") || "null");
        } catch (_err) {
            return null;
        }
    }

    function normalizarNombreCarta(valor) {
        return String(valor || "").trim().toLowerCase();
    }

    function obtenerNombresCartaUsuario() {
        var usuario = obtenerUsuarioActual();
        var cartas = Array.isArray(usuario && usuario.cartas) ? usuario.cartas : [];
        var set = new Set();
        for (var i = 0; i < cartas.length; i++) {
            var clave = normalizarNombreCarta(cartas[i] && cartas[i].Nombre);
            if (clave) set.add(clave);
        }
        return set;
    }

    function obtenerFirmaSobresUsuario() {
        var usuario = obtenerUsuarioActual();
        var objetos = usuario && typeof usuario.objetos === "object" ? usuario.objetos : {};
        var keys = ["sobreH1", "sobreH2", "sobreH3", "sobreV1", "sobreV2", "sobreV3"];
        var partes = [];
        var total = 0;
        for (var i = 0; i < keys.length; i++) {
            var valor = Math.max(0, Math.floor(Number(objetos[keys[i]] || 0)));
            total += valor;
            partes.push(keys[i] + ":" + valor);
        }
        return { firma: partes.join("|"), total: total };
    }

    function leerSetCartasVistas() {
        try {
            var raw = JSON.parse(localStorage.getItem(LS_SEEN_CARD_NAMES) || "[]");
            if (!Array.isArray(raw)) return new Set();
            return new Set(raw.map(normalizarNombreCarta).filter(Boolean));
        } catch (_err) {
            return new Set();
        }
    }

    function guardarSetCartasVistas(setNombres) {
        localStorage.setItem(LS_SEEN_CARD_NAMES, JSON.stringify(Array.from(setNombres)));
    }

    function inicializarCartasVistasSiHaceFalta() {
        if (localStorage.getItem(LS_SEEN_INIT) === "1") return;
        var actuales = obtenerNombresCartaUsuario();
        guardarSetCartasVistas(actuales);
        localStorage.setItem(LS_SEEN_INIT, "1");
    }

    function obtenerSetNoVistas() {
        inicializarCartasVistasSiHaceFalta();
        var vistas = leerSetCartasVistas();
        var actuales = obtenerNombresCartaUsuario();
        var noVistas = new Set();
        actuales.forEach(function (nombre) {
            if (!vistas.has(nombre)) noVistas.add(nombre);
        });
        return noVistas;
    }

    function haySobresNoVistos() {
        var packs = obtenerFirmaSobresUsuario();
        if (packs.total <= 0) return false;
        var firmaVista = String(localStorage.getItem(LS_SEEN_PACKS_SIGNATURE) || "");
        return firmaVista !== packs.firma;
    }

    function marcarSobresVistos() {
        var packs = obtenerFirmaSobresUsuario();
        localStorage.setItem(LS_SEEN_PACKS_SIGNATURE, packs.firma);
        actualizarRedDots();
    }

    function marcarCartaVista(nombreCarta) {
        var clave = normalizarNombreCarta(nombreCarta);
        if (!clave) return;
        var vistas = leerSetCartasVistas();
        if (vistas.has(clave)) return;
        vistas.add(clave);
        guardarSetCartasVistas(vistas);
        var badges = document.querySelectorAll(".dc-card-red-dot-nueva[data-card-key='" + clave + "']");
        for (var i = 0; i < badges.length; i++) {
            badges[i].remove();
        }
        actualizarRedDots();
    }

    function enlazarBadgeNuevaEnCarta(cardElement, nombreCarta) {
        if (!cardElement || !nombreCarta) return;
        var clave = normalizarNombreCarta(nombreCarta);
        if (!clave) return;
        var noVistas = obtenerSetNoVistas();
        if (!noVistas.has(clave)) return;

        var existente = cardElement.querySelector(".dc-card-red-dot-nueva");
        if (!existente) {
            var badge = document.createElement("div");
            badge.className = "dc-card-red-dot-nueva";
            badge.dataset.cardKey = clave;
            badge.textContent = "NUEVA";
            cardElement.appendChild(badge);
        }

        var handler = function () {
            marcarCartaVista(clave);
            var localBadge = cardElement.querySelector(".dc-card-red-dot-nueva");
            if (localBadge) localBadge.remove();
            cardElement.removeEventListener("mouseenter", handler);
            cardElement.removeEventListener("touchstart", handler);
        };
        cardElement.addEventListener("mouseenter", handler, { once: true });
        cardElement.addEventListener("touchstart", handler, { once: true, passive: true });
    }

    function renderizarRedDotEnBotonMenu(anchor, visible) {
        if (!anchor) return;
        var dot = anchor.querySelector(".dc-menu-red-dot");
        if (visible) {
            if (!dot) {
                dot = document.createElement("span");
                dot.className = "dc-menu-red-dot";
                dot.setAttribute("aria-hidden", "true");
                anchor.appendChild(dot);
            }
            anchor.classList.add("dc-menu-item-con-red-dot");
        } else {
            if (dot) dot.remove();
            anchor.classList.remove("dc-menu-item-con-red-dot");
        }
    }

    function actualizarRedDotsMenuLateral() {
        var noVistas = obtenerSetNoVistas();
        var hayNoVistasCartas = noVistas.size > 0;
        var hayNoVistasSobres = haySobresNoVistos();
        var menu = getMenu();
        if (!menu) return;
        var anchors = menu.querySelectorAll("a[href]");
        for (var i = 0; i < anchors.length; i++) {
            var href = String(anchors[i].getAttribute("href") || "").toLowerCase();
            var esColeccion = href.endsWith("coleccion.html");
            var esMejorar = href.endsWith("mejorarcartas.html");
            if (!esColeccion && !esMejorar) continue;
            var visible = esColeccion
                ? (hayNoVistasCartas || hayNoVistasSobres)
                : hayNoVistasCartas;
            renderizarRedDotEnBotonMenu(anchors[i], visible);
        }
    }

    function actualizarRedDots() {
        actualizarRedDotsMenuLateral();
        window.dispatchEvent(new CustomEvent("dc:red-dot-updated"));
    }

    function ensureNavId(menu) {
        if (menu.id) return menu.id;
        menu.id = "dc-main-navigation";
        return menu.id;
    }

    function buildChrome() {
        var menu = getMenu();
        if (!menu || document.querySelector(".dc-mobile-nav-bar")) return;

        var navId = ensureNavId(menu);

        var bar = document.createElement("header");
        bar.className = "dc-mobile-nav-bar";
        bar.setAttribute("role", "banner");

        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "dc-nav-toggle";
        btn.setAttribute("aria-label", "Abrir menú");
        btn.setAttribute("aria-expanded", "false");
        btn.setAttribute("aria-controls", navId);
        btn.innerHTML = '<span class="dc-nav-toggle-bars" aria-hidden="true"></span>';

        var title = document.createElement("span");
        title.className = "dc-mobile-nav-title";
        title.textContent = "DC Battle Cards";

        bar.appendChild(btn);
        bar.appendChild(title);

        var backdrop = document.createElement("div");
        backdrop.className = "dc-nav-backdrop";
        backdrop.setAttribute("aria-hidden", "true");

        var body = document.body;
        body.insertBefore(backdrop, body.firstChild);
        body.insertBefore(bar, body.firstChild);

        function isMobile() {
            return mq.matches;
        }

        function open() {
            if (!isMobile()) return;
            body.classList.add("dc-nav-open");
            btn.setAttribute("aria-expanded", "true");
            btn.setAttribute("aria-label", "Cerrar menú");
            backdrop.setAttribute("aria-hidden", "false");
        }

        function close() {
            body.classList.remove("dc-nav-open");
            btn.setAttribute("aria-expanded", "false");
            btn.setAttribute("aria-label", "Abrir menú");
            backdrop.setAttribute("aria-hidden", "true");
        }

        function toggle() {
            if (body.classList.contains("dc-nav-open")) close();
            else open();
        }

        btn.addEventListener("click", function (e) {
            e.stopPropagation();
            toggle();
        });

        backdrop.addEventListener("click", function () {
            close();
        });

        if (typeof mq.addEventListener === "function") {
            mq.addEventListener("change", function (e) {
                if (!e.matches) close();
            });
        } else if (typeof mq.addListener === "function") {
            mq.addListener(function (e) {
                if (!e.matches) close();
            });
        }

        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && body.classList.contains("dc-nav-open")) close();
        });

        menu.addEventListener("click", function (e) {
            if (e.target.closest("a, button")) close();
        });

        actualizarRedDotsMenuLateral();
    }

    window.DCRedDot = {
        attachCardBadge: enlazarBadgeNuevaEnCarta,
        markSeen: marcarCartaVista,
        refresh: actualizarRedDots,
        getUnseenCount: function () { return obtenerSetNoVistas().size; },
        hasUnseenPacks: haySobresNoVistos,
        markPacksSeen: marcarSobresVistos
    };

    window.addEventListener("dc:usuario-actualizado", actualizarRedDotsMenuLateral);
    window.addEventListener("storage", actualizarRedDotsMenuLateral);
    window.addEventListener("focus", actualizarRedDotsMenuLateral);
    document.addEventListener("visibilitychange", function () {
        if (document.visibilityState === "visible") {
            actualizarRedDotsMenuLateral();
        }
    });

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", buildChrome);
    } else {
        buildChrome();
    }
})();
