/**
 * Filtro por skill_class (tipo de habilidad) reutilizable en vistas de selección de cartas.
 */
(function () {
    const ETIQUETAS_SKILL_CLASS = {
        aoe: 'Daño en area',
        extra_attack: 'Ataque extra',
        buff: 'Aumento de poder',
        bonus_buff: 'Bonus de afiliación aumentado',
        debuff: 'Reducción de poder enemigo',
        bonus_debuff: 'Anula bonus de afiliación enemigo',
        heal_debuff: 'Reduce salud de los enemigos',
        revive: 'Revive un aliado',
        heal: 'Cura a un aliado',
        heal_all: 'Cura en area',
        life_steal: 'Robo de vida',
        shield: 'Aplicar escudo',
        shield_aoe: 'Aplicar escudo en area',
        tank: 'Tanque',
        stun: 'Incapacitar enemigo',
        dot: 'Daño sostenido'
    };

    const ORDEN_SKILL_CLASS = [
        'aoe',
        'extra_attack',
        'buff',
        'bonus_buff',
        'debuff',
        'bonus_debuff',
        'heal_debuff',
        'revive',
        'heal',
        'heal_all',
        'life_steal',
        'shield',
        'shield_aoe',
        'tank',
        'stun',
        'dot'
    ];

    const CLASE_BADGE_POR_SKILL = {
        buff: 'badge-habilidad--buff',
        debuff: 'badge-habilidad--debuff',
        heal: 'badge-habilidad--heal',
        revive: 'badge-habilidad--revive',
        shield: 'badge-habilidad--shield',
        shield_aoe: 'badge-habilidad--shield-aoe',
        aoe: 'badge-habilidad--aoe',
        heal_all: 'badge-habilidad--heal-all',
        bonus_buff: 'badge-habilidad--bonus-buff',
        bonus_debuff: 'badge-habilidad--bonus-debuff',
        tank: 'badge-habilidad--tank',
        heal_debuff: 'badge-habilidad--heal-debuff',
        extra_attack: 'badge-habilidad--extra-attack',
        stun: 'badge-habilidad--stun',
        life_steal: 'badge-habilidad--life-steal',
        dot: 'badge-habilidad--dot'
    };

    const CLASES_BADGE_TODAS = Object.values(CLASE_BADGE_POR_SKILL);

    /** Colores del select cerrado (mismos que filtros-cartas.css); inline evita que otros `background` del editor los pisen al cambiar valor. */
    const ESTILOS_SELECT_SKILL_CLASS = {
        heal: { backgroundColor: '#18462a', color: '#c8ffd8' },
        heal_all: { backgroundColor: '#18462a', color: '#c8ffd8' },
        debuff: { backgroundColor: '#281248', color: '#f0e4ff' },
        aoe: { backgroundColor: '#3c0e0e', color: '#ffd4d4' },
        extra_attack: { backgroundColor: '#3c0e0e', color: '#ffd4d4' },
        stun: { backgroundColor: '#582e0a', color: '#ffe7c8' },
        dot: { backgroundColor: '#582e0a', color: '#ffe7c8' },
        life_steal: { backgroundColor: '#18462a', color: '#c8ffd8' },
        revive: { backgroundColor: '#281248', color: '#f0e4ff' },
        heal_debuff: { backgroundColor: '#281248', color: '#f0e4ff' },
        bonus_debuff: { backgroundColor: '#281248', color: '#f0e4ff' },
        shield: { backgroundColor: '#0c284e', color: '#d8f6ff' },
        shield_aoe: { backgroundColor: '#0c284e', color: '#d8f6ff' },
        tank: { backgroundColor: '#0c284e', color: '#d8f6ff' },
        bonus_buff: { backgroundColor: '#c89400', color: '#1a1200' },
        buff: { backgroundColor: '#c89400', color: '#1a1200' }
    };

    function normalizarSkillClassCarta(carta) {
        if (typeof window.normalizarClaseSkill === 'function') {
            return window.normalizarClaseSkill(carta) || '';
        }
        const claseRaw = String(carta?.skill_class || '').trim().toLowerCase();
        if (claseRaw === 'heall_all') {
            return 'heal_all';
        }
        if (claseRaw === 'life-steal' || claseRaw === 'lifesteal') {
            return 'life_steal';
        }
        return claseRaw;
    }

    function cartaCoincideSkillClass(carta, filtroActivo) {
        if (!filtroActivo || filtroActivo === 'todas') {
            return true;
        }
        return normalizarSkillClassCarta(carta) === String(filtroActivo).trim().toLowerCase();
    }

    function aplicarClaseVisualSelectSkillClass(selector, valor) {
        if (!selector) {
            return;
        }
        selector.classList.add('filtro-skill-class');
        CLASES_BADGE_TODAS.forEach((clase) => selector.classList.remove(clase));
        const normalizado = String(valor || '').trim().toLowerCase();
        if (normalizado && normalizado !== 'todas') {
            const claseBadge = CLASE_BADGE_POR_SKILL[normalizado];
            if (claseBadge) {
                selector.classList.add(claseBadge);
            }
            const estilos = ESTILOS_SELECT_SKILL_CLASS[normalizado];
            if (estilos) {
                selector.style.backgroundColor = estilos.backgroundColor;
                selector.style.color = estilos.color;
                return;
            }
        }
        selector.style.backgroundColor = '';
        selector.style.color = '';
    }

    function crearOpcionSkillClass(value, label) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        if (value !== 'todas') {
            const claseBadge = CLASE_BADGE_POR_SKILL[value];
            if (claseBadge) {
                option.className = claseBadge;
            }
        }
        return option;
    }

    function poblarSelectorSkillClass(selector, valorGuardado) {
        if (!selector) {
            return valorGuardado || 'todas';
        }
        const valorPrevio = valorGuardado || selector.value || 'todas';
        selector.innerHTML = '';
        selector.appendChild(crearOpcionSkillClass('todas', 'Todas las habilidades'));
        ORDEN_SKILL_CLASS.forEach((skillClass) => {
            const etiqueta = ETIQUETAS_SKILL_CLASS[skillClass];
            if (etiqueta) {
                selector.appendChild(crearOpcionSkillClass(skillClass, etiqueta));
            }
        });
        const existe = valorPrevio === 'todas' || ORDEN_SKILL_CLASS.includes(valorPrevio);
        const valorFinal = existe ? valorPrevio : 'todas';
        selector.value = valorFinal;
        aplicarClaseVisualSelectSkillClass(selector, valorFinal);
        return valorFinal;
    }

    function configurarSelectorSkillClass(selector, opciones) {
        if (!selector) {
            return;
        }
        const valorInicial = opciones?.valorInicial ?? 'todas';
        poblarSelectorSkillClass(selector, valorInicial);
        const onChange = typeof opciones?.onChange === 'function' ? opciones.onChange : null;
        selector.addEventListener('change', () => {
            aplicarClaseVisualSelectSkillClass(selector, selector.value);
            if (onChange) {
                onChange(selector.value || 'todas', selector);
            }
        });
    }

    function obtenerSelectorSkillClassPorId(id) {
        if (!id) {
            return null;
        }
        return document.getElementById(id);
    }

    window.DCFiltrosCartas = {
        ETIQUETAS_SKILL_CLASS,
        ORDEN_SKILL_CLASS,
        CLASE_BADGE_POR_SKILL,
        normalizarSkillClassCarta,
        cartaCoincideSkillClass,
        poblarSelectorSkillClass,
        configurarSelectorSkillClass,
        aplicarClaseVisualSelectSkillClass,
        obtenerSelectorSkillClassPorId
    };
})();
