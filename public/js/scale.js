(() => {
    const BASE_WIDTH = 1920;
    const BASE_HEIGHT = 1080;

    function ensureGlobalContainer() {
        let container = document.getElementById('game-container');
        if (container) {
            return container;
        }

        container = document.createElement('div');
        container.id = 'game-container';
        container.style.width = `${BASE_WIDTH}px`;
        container.style.height = `${BASE_HEIGHT}px`;
        container.style.transformOrigin = 'top left';
        container.style.position = 'absolute';
        container.style.left = '0';
        container.style.top = '0';

        const bodyNodes = Array.from(document.body.childNodes);
        const uiNodes = bodyNodes.filter((node) => {
            return !(node.nodeType === Node.ELEMENT_NODE && node.tagName === 'SCRIPT');
        });

        uiNodes.forEach((node) => container.appendChild(node));

        const firstScript = document.body.querySelector('script');
        if (firstScript) {
            document.body.insertBefore(container, firstScript);
        } else {
            document.body.appendChild(container);
        }

        return container;
    }

    function aplicarEscalado() {
        const container = ensureGlobalContainer();

        document.body.style.margin = '0';
        document.body.style.overflow = 'hidden';
        document.body.style.position = 'relative';
        document.body.style.width = '100vw';
        document.body.style.height = '100vh';

        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const scaleX = viewportWidth / BASE_WIDTH;
        const scaleY = viewportHeight / BASE_HEIGHT;

        // Modo estable para navegador: nunca recorta UI ni scroll interno.
        const scale = Math.min(scaleX, scaleY);

        const offsetX = (viewportWidth - (BASE_WIDTH * scale)) / 2;
        const offsetY = (viewportHeight - (BASE_HEIGHT * scale)) / 2;

        container.style.transform = `scale(${scale})`;
        container.style.left = `${offsetX}px`;
        container.style.top = `${offsetY}px`;
    }

    let rafId = 0;
    function aplicarEscaladoConRAF() {
        if (rafId) {
            cancelAnimationFrame(rafId);
        }
        rafId = requestAnimationFrame(() => {
            aplicarEscalado();
            rafId = 0;
        });
    }

    window.addEventListener('load', aplicarEscaladoConRAF);
    window.addEventListener('resize', aplicarEscaladoConRAF);
})();
