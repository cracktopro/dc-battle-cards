// public/js/cartas.js

function obtenerImagenCarta(carta) {
    if (!carta) return 'img/default-image.jpg';

    const nivel = Number(carta.Nivel || 1);

    const imagenBase = carta.Imagen || carta.imagen;
    const imagenFinal = carta.imagen_final || carta.Imagen_final || carta.imagenFinal;

    if (nivel === 6 && imagenFinal && String(imagenFinal).trim() !== '') {
        return imagenFinal;
    }

    return imagenBase || 'img/default-image.jpg';
}

// opcional: exponer global (por seguridad)
window.obtenerImagenCarta = obtenerImagenCarta;

function obtenerNombreVisibleSesion() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const email = localStorage.getItem('email') || '';
    const nickname = String(usuario?.nickname || '').trim();
    if (nickname) {
        return nickname;
    }
    return email ? email.split('@')[0] : 'Jugador';
}

function obtenerAvatarSesion() {
    const usuario = JSON.parse(localStorage.getItem('usuario') || '{}');
    const avatar = String(usuario?.avatar || '').trim();
    return avatar || 'https://i.ibb.co/QJvLStm/zzz-Carta-Back.png';
}

function normalizarMenuLateral() {
    const menu = document.querySelector('.menu-container');
    if (!menu) {
        return;
    }

    const linkCentro = menu.querySelector('a[href="vistaJuego.html"]');
    const linkDesafios = menu.querySelector('a[href="desafios.html"]');
    if (linkCentro) {
        linkCentro.textContent = 'Centro de Operaciones';
    }
    if (linkCentro && linkDesafios && linkDesafios.previousElementSibling !== linkCentro) {
        menu.insertBefore(linkDesafios, linkCentro.nextElementSibling);
    }

    let perfil = document.getElementById('menu-user-profile');
    if (!perfil) {
        perfil = document.createElement('div');
        perfil.id = 'menu-user-profile';
        perfil.className = 'menu-user-profile';
        perfil.innerHTML = `
            <img id="menu-user-avatar" class="menu-user-avatar" alt="Avatar">
            <div id="menu-user-name" class="menu-user-name"></div>
        `;
        menu.insertBefore(perfil, menu.firstChild);
    }

    const avatar = menu.querySelector('#menu-user-avatar');
    const nombre = menu.querySelector('#menu-user-name');
    if (avatar) {
        avatar.src = obtenerAvatarSesion();
    }
    if (nombre) {
        nombre.textContent = obtenerNombreVisibleSesion();
    }
}

function asegurarModalLogout() {
    if (document.getElementById('logout-confirm-modal')) {
        return;
    }
    const modal = document.createElement('div');
    modal.id = 'logout-confirm-modal';
    modal.className = 'modal-dc';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="modal-dc-content">
            <h4>¿Desconectarse de DC Battle Cards?</h4>
            <div class="modal-dc-actions">
                <button id="logout-confirm-accept" class="btn btn-danger">Aceptar</button>
                <button id="logout-confirm-cancel" class="btn btn-secondary">Cancelar</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('logout-confirm-cancel')?.addEventListener('click', cerrarModalLogout);
    document.getElementById('logout-confirm-accept')?.addEventListener('click', confirmarLogoutSistema);
}

function abrirModalLogout() {
    asegurarModalLogout();
    const modal = document.getElementById('logout-confirm-modal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function cerrarModalLogout() {
    const modal = document.getElementById('logout-confirm-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function confirmarLogoutSistema() {
    localStorage.removeItem('usuario');
    localStorage.removeItem('email');
    localStorage.removeItem('jugandoPartida');
    localStorage.removeItem('mazoJugador');
    localStorage.removeItem('mazoOponente');
    localStorage.removeItem('nombreOponente');
    window.location.href = '/login.html';
}

window.abrirModalLogout = abrirModalLogout;
window.cerrarModalLogout = cerrarModalLogout;
window.confirmarLogoutSistema = confirmarLogoutSistema;

document.addEventListener('DOMContentLoaded', () => {
    normalizarMenuLateral();
    asegurarModalLogout();
});