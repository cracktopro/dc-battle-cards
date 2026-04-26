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

function normalizarTextoHabilidad(valor) {
    return String(valor || '').trim();
}

function obtenerMetaHabilidadCarta(carta) {
    const triggerRaw = normalizarTextoHabilidad(carta?.skill_trigger).toLowerCase();
    const trigger = triggerRaw === 'usar' ? 'usar' : (triggerRaw === 'auto' ? 'auto' : null);
    const nombre = normalizarTextoHabilidad(carta?.skill_name);
    const info = normalizarTextoHabilidad(carta?.skill_info);
    const clase = normalizarTextoHabilidad(carta?.skill_class).toLowerCase();
    const powerRaw = carta?.skill_power;
    const tieneHabilidad = Boolean(trigger && nombre && clase);
    return {
        tieneHabilidad,
        trigger,
        clase,
        nombre,
        info,
        powerRaw
    };
}

const CLASE_BADGE_POR_SKILL = {
    buff: 'badge-habilidad--buff',
    debuff: 'badge-habilidad--debuff',
    heal: 'badge-habilidad--heal',
    revive: 'badge-habilidad--revive',
    shield: 'badge-habilidad--shield',
    aoe: 'badge-habilidad--aoe',
    heal_all: 'badge-habilidad--heal-all',
    bonus_buff: 'badge-habilidad--bonus-buff',
    bonus_debuff: 'badge-habilidad--bonus-debuff',
    tank: 'badge-habilidad--tank',
    heal_debuff: 'badge-habilidad--heal-debuff',
    extra_attack: 'badge-habilidad--extra-attack'
};

let tooltipHabilidadGlobalEl = null;
let tooltipHabilidadRaf = null;

function asegurarListenersCierreTooltipHabilidad() {
    if (window._dcTooltipHabilidadCierreRegistrado) {
        return;
    }
    window._dcTooltipHabilidadCierreRegistrado = true;
    window.addEventListener('scroll', () => ocultarTooltipHabilidadGlobal(), true);
    window.addEventListener('resize', ocultarTooltipHabilidadGlobal);
}

function obtenerTooltipHabilidadGlobal() {
    if (tooltipHabilidadGlobalEl) {
        return tooltipHabilidadGlobalEl;
    }
    asegurarListenersCierreTooltipHabilidad();
    const el = document.createElement('div');
    el.id = 'tooltip-habilidad-carta-global';
    el.className = 'tooltip-habilidad-carta-global';
    el.style.display = 'none';
    el.setAttribute('role', 'tooltip');
    el.innerHTML = `
        <div class="tooltip-habilidad-carta-inner">
            <div class="tooltip-habilidad-carta-nombre"></div>
            <div class="tooltip-habilidad-carta-desc"></div>
        </div>
    `;
    document.body.appendChild(el);
    tooltipHabilidadGlobalEl = el;
    return el;
}

function ocultarTooltipHabilidadGlobal() {
    if (!tooltipHabilidadGlobalEl) {
        return;
    }
    tooltipHabilidadGlobalEl.style.display = 'none';
    if (tooltipHabilidadRaf) {
        cancelAnimationFrame(tooltipHabilidadRaf);
        tooltipHabilidadRaf = null;
    }
}

function posicionarTooltipHabilidadGlobal(clientX, clientY) {
    const el = tooltipHabilidadGlobalEl;
    if (!el || el.style.display === 'none') {
        return;
    }
    const margen = 12;
    const offsetX = 14;
    const offsetY = 18;
    el.style.visibility = 'hidden';
    el.style.display = 'block';
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = clientX + offsetX;
    let y = clientY + offsetY;
    if (x + w > window.innerWidth - margen) {
        x = Math.max(margen, window.innerWidth - w - margen);
    }
    if (y + h > window.innerHeight - margen) {
        y = Math.max(margen, clientY - h - offsetY);
    }
    if (x < margen) {
        x = margen;
    }
    if (y < margen) {
        y = margen;
    }
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.visibility = 'visible';
}

function mostrarTooltipHabilidadGlobal(clientX, clientY, meta) {
    const el = obtenerTooltipHabilidadGlobal();
    const nombreLinea = el.querySelector('.tooltip-habilidad-carta-nombre');
    const descLinea = el.querySelector('.tooltip-habilidad-carta-desc');
    const nombre = normalizarTextoHabilidad(meta?.nombre);
    const info = normalizarTextoHabilidad(meta?.info);

    nombreLinea.textContent = nombre ? `${nombre}:` : 'Habilidad:';
    descLinea.textContent = info || 'Sin descripción.';

    el.style.display = 'block';
    posicionarTooltipHabilidadGlobal(clientX, clientY);
}

function enlazarTooltipHabilidadABadge(badge, meta) {
    const onEnter = (ev) => {
        mostrarTooltipHabilidadGlobal(ev.clientX, ev.clientY, meta);
    };
    const onMove = (ev) => {
        if (tooltipHabilidadRaf) {
            cancelAnimationFrame(tooltipHabilidadRaf);
        }
        const cx = ev.clientX;
        const cy = ev.clientY;
        tooltipHabilidadRaf = requestAnimationFrame(() => {
            tooltipHabilidadRaf = null;
            posicionarTooltipHabilidadGlobal(cx, cy);
        });
    };
    const onLeave = () => {
        ocultarTooltipHabilidadGlobal();
    };
    badge.addEventListener('mouseenter', onEnter);
    badge.addEventListener('mousemove', onMove);
    badge.addEventListener('mouseleave', onLeave);
}

function crearBadgeHabilidadCarta(carta) {
    const meta = obtenerMetaHabilidadCarta(carta);
    if (!meta.tieneHabilidad) {
        return null;
    }

    const badge = document.createElement('div');
    badge.className = 'badge-habilidad-carta';
    const sub = CLASE_BADGE_POR_SKILL[meta.clase];
    if (sub) {
        badge.classList.add(sub);
    }
    badge.textContent = `${meta.trigger === 'auto' ? 'Pasiva' : 'Activa'}: ${meta.nombre}`;
    badge.removeAttribute('title');
    enlazarTooltipHabilidadABadge(badge, meta);
    return badge;
}

window.obtenerMetaHabilidadCarta = obtenerMetaHabilidadCarta;
window.crearBadgeHabilidadCarta = crearBadgeHabilidadCarta;

/** Mezcla skill_* del catálogo Excel en una carta de usuario si faltan en almacenamiento. */
function fusionarSkillDesdeFilaCatalogo(carta, filaCatalogo) {
    if (!carta) {
        return carta;
    }
    if (!filaCatalogo) {
        return carta;
    }
    return {
        ...carta,
        skill_name: String(carta.skill_name || '').trim() || String(filaCatalogo.skill_name || '').trim(),
        skill_info: String(carta.skill_info || '').trim() || String(filaCatalogo.skill_info || '').trim(),
        skill_class: String(carta.skill_class || '').trim().toLowerCase()
            || String(filaCatalogo.skill_class || '').trim().toLowerCase(),
        skill_power: carta.skill_power ?? filaCatalogo.skill_power ?? '',
        skill_trigger: String(carta.skill_trigger || '').trim().toLowerCase()
            || String(filaCatalogo.skill_trigger || '').trim().toLowerCase()
    };
}

function extraerSkillRowDeCartaExcel(carta) {
    if (!carta) {
        return null;
    }
    return {
        skill_name: String(carta.skill_name || '').trim(),
        skill_info: String(carta.skill_info || '').trim(),
        skill_class: String(carta.skill_class || '').trim().toLowerCase(),
        skill_power: carta.skill_power ?? '',
        skill_trigger: String(carta.skill_trigger || '').trim().toLowerCase()
    };
}

window.fusionarSkillDesdeFilaCatalogo = fusionarSkillDesdeFilaCatalogo;
window.extraerSkillRowDeCartaExcel = extraerSkillRowDeCartaExcel;

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