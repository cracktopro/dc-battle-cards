/**
 * Barra superior + menú lateral tipo drawer en viewport <= 899px.
 * Inserta UI mínima en el DOM; el aspecto se controla en css/app-layout.css
 */
(function () {
    var BP = 899;
    var mq = window.matchMedia("(max-width: " + BP + "px)");

    function getMenu() {
        return document.querySelector("body > .menu-container");
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
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", buildChrome);
    } else {
        buildChrome();
    }
})();
