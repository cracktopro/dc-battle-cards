/**
 * Catálogo de episodios para carrusel (metadatos en cada JSON de resources/episodios/).
 */
(function () {
    'use strict';

    const PLACEHOLDER = 'resources/hud/universo.png';

    function urlImagenEpisodio(ep) {
        const raw = String(ep?.imagen || '').trim();
        if (!raw) {
            return PLACEHOLDER;
        }
        if (/^https?:\/\//i.test(raw) || /^data:image\//i.test(raw)) {
            return raw;
        }
        if (raw.startsWith('resources/')) {
            return raw;
        }
        return `resources/${raw.replace(/^\/+/, '')}`;
    }

    async function cargarLista() {
        const res = await fetch('/api/episodios/catalogo');
        if (!res.ok) {
            throw new Error('No se pudo cargar el catálogo de episodios.');
        }
        const body = await res.json();
        return Array.isArray(body.episodios) ? body.episodios : [];
    }

    window.DCEpisodiosCatalogo = {
        PLACEHOLDER,
        urlImagenEpisodio,
        cargarLista,
    };
})();
