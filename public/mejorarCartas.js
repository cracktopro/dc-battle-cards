document.addEventListener('DOMContentLoaded', function () {
    cargarCartas(); // Carga inicial de cartas para mejorar
    configurarEventos(); // Configurar eventos de la página
});

let mejoraObjetoPendiente = null;
const ICONO_MEJORA = '/resources/icons/mejora.png';
const ICONO_MEJORA_ESPECIAL = '/resources/icons/mejora_especial.png';

function esCartaLegendaria(carta) {
    return Number(carta?.Nivel || 1) >= 6;
}

function obtenerValorDestruccion(nivel) {
    const nivelSeguro = Number(nivel || 1);
    return nivelSeguro * 10;
}

function crearPoolCartasPorNombre(cartas) {
    const pool = new Map();

    cartas.forEach(carta => {
        if (!pool.has(carta.Nombre)) {
            pool.set(carta.Nombre, []);
        }

        pool.get(carta.Nombre).push({ ...carta });
    });

    pool.forEach(listaCartas => {
        listaCartas.sort((a, b) => {
            const diferenciaNivel = (b.Nivel || 1) - (a.Nivel || 1);
            if (diferenciaNivel !== 0) {
                return diferenciaNivel;
            }

            return (b.Poder || 0) - (a.Poder || 0);
        });
    });

    return pool;
}

function normalizarObjetosUsuario(usuario) {
    if (!usuario || typeof usuario !== 'object') {
        return;
    }

    const objetosBase = {
        mejoraCarta: 0,
        mejoraEspecial: 0
    };

    if (usuario.objetos && typeof usuario.objetos === 'object') {
        objetosBase.mejoraCarta = Number(usuario.objetos.mejoraCarta || 0);
        objetosBase.mejoraEspecial = Number(usuario.objetos.mejoraEspecial || 0);
    }

    if (Array.isArray(usuario.inventarioObjetos)) {
        const legacyMejoraCarta = usuario.inventarioObjetos.find(item => item.id === 'obj-mejora-carta');
        const legacyMejoraEspecial = usuario.inventarioObjetos.find(item => item.id === 'obj-mejora-especial');

        objetosBase.mejoraCarta = Math.max(objetosBase.mejoraCarta, Number(legacyMejoraCarta?.cantidad || 0));
        objetosBase.mejoraEspecial = Math.max(objetosBase.mejoraEspecial, Number(legacyMejoraEspecial?.cantidad || 0));
    }

    usuario.objetos = objetosBase;
}

function crearElementoCartaSoloVisual(carta, destacarPoder = false) {
    const cartaDiv = document.createElement('div');
    cartaDiv.classList.add('carta');
    if (esCartaLegendaria(carta)) {
        cartaDiv.classList.add('nivel-legendaria');
    }
    cartaDiv.style.width = '210px';

    const imagenUrl = obtenerImagenCarta(carta);
    cartaDiv.style.backgroundImage = `url(${imagenUrl})`;
    cartaDiv.style.backgroundSize = 'cover';
    cartaDiv.style.backgroundPosition = 'center';

    const detallesDiv = document.createElement('div');
    detallesDiv.classList.add('detalles-carta');

    const nombreSpan = document.createElement('span');
    nombreSpan.classList.add('nombre-carta');
    nombreSpan.textContent = carta.Nombre;

    const poderSpan = document.createElement('span');
    poderSpan.classList.add('poder-carta');
    poderSpan.textContent = carta.Poder;
    if (destacarPoder && !esCartaLegendaria(carta)) {
        poderSpan.style.color = '#FFD700';
        poderSpan.style.fontWeight = '700';
    }

    detallesDiv.appendChild(nombreSpan);
    detallesDiv.appendChild(poderSpan);

    const estrellasDiv = document.createElement('div');
    estrellasDiv.classList.add('estrellas-carta');

    const nivel = carta.Nivel || 1;
    for (let i = 0; i < nivel; i++) {
        const estrella = document.createElement('img');
        estrella.classList.add('estrella');
        estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
        estrella.alt = 'star';
        estrellasDiv.appendChild(estrella);
    }

    cartaDiv.appendChild(detallesDiv);
    cartaDiv.appendChild(estrellasDiv);
    return cartaDiv;
}

function actualizarContadoresObjetos(usuario) {
    normalizarObjetosUsuario(usuario);
    const contadorMejora = document.getElementById('contador-mejora-carta');
    const contadorEspecial = document.getElementById('contador-mejora-especial');

    if (contadorMejora) {
        contadorMejora.innerHTML = `<img src="${ICONO_MEJORA}" alt="Mejora" style="width:40px; height:40px; object-fit:contain; margin-right:6px;">Mejoras disponibles: ${Number(usuario.objetos.mejoraCarta || 0)}`;
    }

    if (contadorEspecial) {
        contadorEspecial.innerHTML = `<img src="${ICONO_MEJORA_ESPECIAL}" alt="Mejora especial" style="width:40px; height:40px; object-fit:contain; margin-right:6px;">Mejoras especiales: ${Number(usuario.objetos.mejoraEspecial || 0)}`;
    }
}

function obtenerCartasValidasMejoraObjeto(usuario, tipo) {
    const cartas = Array.isArray(usuario?.cartas) ? usuario.cartas : [];
    const filtradas = cartas
        .map((carta, index) => ({ ...carta, originalIndex: index }))
        .filter(carta => {
            const nivel = Number(carta.Nivel || 1);
            if (tipo === 'mejoraCarta') {
                return nivel >= 1 && nivel <= 3;
            }
            return nivel === 5;
        })
        .sort((a, b) => {
            const diffNivel = (a.Nivel || 1) - (b.Nivel || 1);
            if (diffNivel !== 0) {
                return diffNivel;
            }
            return a.Nombre.localeCompare(b.Nombre);
        });

    return filtradas;
}

function renderizarBloqueMejoraObjetos(usuario, tipo, contenedorId) {
    const contenedor = document.getElementById(contenedorId);
    if (!contenedor) {
        return;
    }

    contenedor.innerHTML = '';
    const cartas = obtenerCartasValidasMejoraObjeto(usuario, tipo);
    const cantidadObjetos = Number(usuario.objetos?.[tipo] || 0);

    if (cartas.length === 0) {
        const vacio = document.createElement('div');
        vacio.className = 'alert alert-info';
        vacio.textContent = 'No hay cartas válidas para este tipo de mejora.';
        contenedor.appendChild(vacio);
        return;
    }

    cartas.forEach(carta => {
        const wrapper = document.createElement('div');
        wrapper.className = 'd-flex flex-column';
        wrapper.style.gap = '8px';
        wrapper.style.animation = 'entradaSuave 0.35s ease-out';

        const cartaVisual = crearElementoCartaSoloVisual(carta);
        const boton = document.createElement('button');
        boton.className = 'btn btn-primary';
        boton.textContent = 'Mejorar';
        boton.disabled = cantidadObjetos <= 0;
        boton.addEventListener('click', () => abrirModalConfirmacionMejora(tipo, carta.originalIndex));

        wrapper.appendChild(cartaVisual);
        wrapper.appendChild(boton);
        contenedor.appendChild(wrapper);
    });
}

function renderizarSeccionMejorasObjetos(usuario) {
    actualizarContadoresObjetos(usuario);
    renderizarBloqueMejoraObjetos(usuario, 'mejoraCarta', 'contenedor-mejora-carta-objeto');
    renderizarBloqueMejoraObjetos(usuario, 'mejoraEspecial', 'contenedor-mejora-especial-objeto');
}

function sincronizarMazosConColeccion(usuario) {
    if (!usuario.mazos || !Array.isArray(usuario.mazos)) {
        usuario.mazos = [];
        return;
    }

    const poolCartas = crearPoolCartasPorNombre(usuario.cartas || []);

    usuario.mazos = usuario.mazos.map(mazo => {
        const cartasSincronizadas = [];

        (mazo.Cartas || []).forEach(cartaMazo => {
            const disponibles = poolCartas.get(cartaMazo.Nombre) || [];

            if (disponibles.length > 0) {
                cartasSincronizadas.push(disponibles.shift());
            }
        });

        return {
            ...mazo,
            Cartas: cartasSincronizadas
        };
    });
}

function analizarMejoraAutomatica(cartas) {
    const grupos = new Map();

    cartas.forEach(carta => {
        if (!grupos.has(carta.Nombre)) {
            grupos.set(carta.Nombre, []);
        }

        grupos.get(carta.Nombre).push({ ...carta });
    });

    const cartasActualizadas = [];
    const mejoras = [];
    const destruidas = [];
    let puntosGanados = 0;

    grupos.forEach((grupoCartas, nombreCarta) => {
        grupoCartas.sort((a, b) => {
            const diferenciaNivel = (b.Nivel || 1) - (a.Nivel || 1);
            if (diferenciaNivel !== 0) {
                return diferenciaNivel;
            }

            return (b.Poder || 0) - (a.Poder || 0);
        });

        const cartaBase = { ...grupoCartas[0] };
        let duplicados = grupoCartas.slice(1).map(carta => ({ ...carta }));
        const nivelInicial = cartaBase.Nivel || 1;

        if (nivelInicial < 5 && duplicados.length > 0) {
            const mejorasPosibles = Math.min(5 - nivelInicial, duplicados.length);

            if (mejorasPosibles > 0) {
                cartaBase.Nivel = nivelInicial + mejorasPosibles;
                cartaBase.Poder = (cartaBase.Poder || 0) + (500 * mejorasPosibles);
                duplicados = duplicados.slice(mejorasPosibles);

                mejoras.push({
                    nombre: nombreCarta,
                    nivelInicial,
                    nivelFinal: cartaBase.Nivel,
                    cartasConsumidas: mejorasPosibles,
                    cartaAntes: {
                        ...grupoCartas[0],
                        Nivel: nivelInicial
                    },
                    cartaDespues: {
                        ...cartaBase
                    }
                });
            }
        }

        if ((cartaBase.Nivel || 1) >= 5 && duplicados.length > 0) {
            duplicados.forEach(carta => {
                const puntos = obtenerValorDestruccion(carta.Nivel);
                puntosGanados += puntos;
                destruidas.push({
                    nombre: carta.Nombre,
                    nivel: carta.Nivel || 1,
                    puntos
                });
            });

            duplicados = [];
        }

        cartasActualizadas.push(cartaBase, ...duplicados);
    });

    return {
        cartasActualizadas,
        mejoras,
        destruidas,
        puntosGanados
    };
}

function cargarCartas() {
    console.log('Cargando cartas del usuario...');

    const usuario = JSON.parse(localStorage.getItem('usuario'));
    normalizarObjetosUsuario(usuario);
    console.log('Datos del usuario cargados:', usuario);

    if (usuario && usuario.cartas) {
        const contenedorCartas = document.getElementById('contenedor-cartas');
        contenedorCartas.innerHTML = ''; // Limpiar el contenedor antes de agregar nuevas cartas

        // Ordenar las cartas por nombre para localizar duplicados rápido.
        const cartasOrdenadas = usuario.cartas.map((carta, index) => ({ ...carta, originalIndex: index }))
                                              .sort((a, b) => {
                                                  const comparacionNombre = a.Nombre.localeCompare(b.Nombre);
                                                  if (comparacionNombre !== 0) {
                                                      return comparacionNombre;
                                                  }

                                                  const comparacionNivel = (b.Nivel || 1) - (a.Nivel || 1);
                                                  if (comparacionNivel !== 0) {
                                                      return comparacionNivel;
                                                  }

                                                  return (b.Poder || 0) - (a.Poder || 0);
                                              });
        console.log('Cartas ordenadas por nombre:', cartasOrdenadas);

        cartasOrdenadas
            .filter(carta => Number(carta.Nivel || 1) < 5)
            .forEach((carta, index) => {
            console.log(`Generando carta ${index}:`, carta);

            const cartaDiv = document.createElement('div');
            cartaDiv.classList.add('carta');
            if (esCartaLegendaria(carta)) {
                cartaDiv.classList.add('nivel-legendaria');
            }
            cartaDiv.dataset.id = carta.originalIndex; // Mantener el índice original del array para referencia

            // Verifica si hay una imagen válida; si no, usa una imagen de respaldo
            const imagenUrl = obtenerImagenCarta(carta);
            cartaDiv.style.backgroundImage = `url(${imagenUrl})`;
            cartaDiv.style.backgroundSize = 'cover';
            cartaDiv.style.backgroundPosition = 'center';

            // Crear el contenedor de detalles (nombre y poder)
            const detallesDiv = document.createElement('div');
            detallesDiv.classList.add('detalles-carta');

            const nombreSpan = document.createElement('span');
            nombreSpan.classList.add('nombre-carta');
            nombreSpan.textContent = carta.Nombre;

            const poderSpan = document.createElement('span');
            poderSpan.classList.add('poder-carta');
            poderSpan.textContent = carta.Poder;

            detallesDiv.appendChild(nombreSpan);
            detallesDiv.appendChild(poderSpan);

            const estrellasDiv = document.createElement('div');
            estrellasDiv.classList.add('estrellas-carta');

            const nivel = carta.Nivel || 1;
            for (let i = 0; i < nivel; i++) {
                const estrella = document.createElement('img');
                estrella.classList.add('estrella');
                estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
                estrella.alt = 'star';
                estrellasDiv.appendChild(estrella);
            }

            cartaDiv.appendChild(detallesDiv);
            cartaDiv.appendChild(estrellasDiv);
            contenedorCartas.appendChild(cartaDiv);
        });
        renderizarSeccionMejorasObjetos(usuario);
    } else {
        console.error('No se encontraron cartas para el usuario.');
    }
}

function configurarEventos() {
    const botonAuto = document.getElementById('mejorar-duplicados-auto');
    if (botonAuto) {
        botonAuto.onclick = mejorarDuplicadosAutomaticamente;
    }

    const btnConfirmarObjeto = document.getElementById('btn-confirmar-objeto');
    if (btnConfirmarObjeto) {
        btnConfirmarObjeto.onclick = confirmarMejoraConObjeto;
    }

    const btnCancelarObjeto = document.getElementById('btn-cancelar-objeto');
    if (btnCancelarObjeto) {
        btnCancelarObjeto.onclick = cerrarModalConfirmacionObjeto;
    }

    const btnCerrarResultado = document.getElementById('btn-cerrar-resultado-objeto');
    if (btnCerrarResultado) {
        btnCerrarResultado.onclick = cerrarModalResultadoObjeto;
    }
    const btnCerrarResultadoAuto = document.getElementById('btn-cerrar-resultado-auto');
    if (btnCerrarResultadoAuto) {
        btnCerrarResultadoAuto.onclick = cerrarModalResultadoAuto;
    }

    const tabClasica = document.getElementById('tab-mejora-clasica');
    const tabObjetos = document.getElementById('tab-mejoras-objetos');
    if (tabClasica && tabObjetos) {
        tabClasica.onclick = () => cambiarPestanaMejoras('clasica');
        tabObjetos.onclick = () => cambiarPestanaMejoras('objetos');
    }

    const subtabMejoraCarta = document.getElementById('subtab-mejora-carta');
    const subtabMejoraEspecial = document.getElementById('subtab-mejora-especial');
    if (subtabMejoraCarta && subtabMejoraEspecial) {
        subtabMejoraCarta.onclick = () => cambiarSubpestanaObjetos('mejoraCarta');
        subtabMejoraEspecial.onclick = () => cambiarSubpestanaObjetos('mejoraEspecial');
    }
}

function cerrarModalResultadoAuto() {
    const modal = document.getElementById('modal-resultado-auto');
    if (modal) {
        modal.style.display = 'none';
    }
}

function mostrarResultadoMejoraAutomatica(analisis) {
    const modal = document.getElementById('modal-resultado-auto');
    const resumen = document.getElementById('resultado-auto-resumen');
    const mejoradas = document.getElementById('resultado-auto-mejoradas');
    const destruidas = document.getElementById('resultado-auto-destruidas');
    if (!modal || !resumen || !mejoradas || !destruidas) {
        return;
    }

    resumen.textContent = `Cartas mejoradas: ${analisis.mejoras.length} | Cartas destruidas: ${analisis.destruidas.length} | Puntos obtenidos: ${analisis.puntosGanados}`;
    mejoradas.innerHTML = '';
    destruidas.innerHTML = '';

    if (analisis.mejoras.length === 0) {
        const vacio = document.createElement('div');
        vacio.className = 'alert alert-secondary';
        vacio.textContent = 'No hubo mejoras de nivel.';
        mejoradas.appendChild(vacio);
    } else {
        analisis.mejoras.forEach(item => {
            const bloque = document.createElement('div');
            bloque.className = 'd-flex align-items-start';
            bloque.style.gap = '10px';
            bloque.style.padding = '8px';
            bloque.style.border = '1px solid rgba(0,209,255,0.25)';
            bloque.style.borderRadius = '10px';

            const antes = document.createElement('div');
            const tituloAntes = document.createElement('div');
            tituloAntes.textContent = 'Antes';
            tituloAntes.className = 'text-center';
            tituloAntes.style.marginBottom = '4px';
            antes.appendChild(tituloAntes);
            antes.appendChild(crearElementoCartaSoloVisual(item.cartaAntes));

            const despues = document.createElement('div');
            const tituloDespues = document.createElement('div');
            tituloDespues.textContent = 'Después';
            tituloDespues.className = 'text-center';
            tituloDespues.style.marginBottom = '4px';
            despues.appendChild(tituloDespues);
            despues.appendChild(crearElementoCartaSoloVisual(item.cartaDespues, true));

            const meta = document.createElement('div');
            meta.style.minWidth = '180px';
            meta.innerHTML = `
                <div><strong>${item.nombre}</strong></div>
                <div>Nivel: ${item.nivelInicial} → ${item.nivelFinal}</div>
                <div>Duplicados consumidos: ${item.cartasConsumidas}</div>
            `;

            bloque.appendChild(antes);
            bloque.appendChild(despues);
            bloque.appendChild(meta);
            mejoradas.appendChild(bloque);
        });
    }

    if (analisis.destruidas.length === 0) {
        const vacio = document.createElement('div');
        vacio.className = 'alert alert-secondary';
        vacio.textContent = 'No se destruyeron cartas.';
        destruidas.appendChild(vacio);
    } else {
        analisis.destruidas.forEach(item => {
            const tag = document.createElement('div');
            tag.className = 'alert alert-warning';
            tag.style.margin = '0';
            tag.style.padding = '6px 10px';
            tag.textContent = `${item.nombre} (Nivel ${item.nivel}) +${item.puntos} pts`;
            destruidas.appendChild(tag);
        });
    }

    modal.style.display = 'flex';
}

function cambiarPestanaMejoras(pestana) {
    const tabClasica = document.getElementById('tab-mejora-clasica');
    const tabObjetos = document.getElementById('tab-mejoras-objetos');
    const seccionClasica = document.getElementById('seccion-mejora-clasica');
    const seccionObjetos = document.getElementById('seccion-mejoras-objetos');

    const mostrarObjetos = pestana === 'objetos';
    if (tabClasica) {
        tabClasica.classList.toggle('active', !mostrarObjetos);
    }
    if (tabObjetos) {
        tabObjetos.classList.toggle('active', mostrarObjetos);
    }
    if (seccionClasica) {
        seccionClasica.style.display = mostrarObjetos ? 'none' : 'block';
    }
    if (seccionObjetos) {
        seccionObjetos.style.display = mostrarObjetos ? 'block' : 'none';
    }
    if (mostrarObjetos) {
        cambiarSubpestanaObjetos('mejoraCarta');
    }
}

function cambiarSubpestanaObjetos(tipo) {
    const subtabMejoraCarta = document.getElementById('subtab-mejora-carta');
    const subtabMejoraEspecial = document.getElementById('subtab-mejora-especial');
    const panelCarta = document.getElementById('panel-subtab-mejora-carta');
    const panelEspecial = document.getElementById('panel-subtab-mejora-especial');
    const esMejoraCarta = tipo === 'mejoraCarta';

    if (subtabMejoraCarta) {
        subtabMejoraCarta.classList.toggle('active', esMejoraCarta);
    }
    if (subtabMejoraEspecial) {
        subtabMejoraEspecial.classList.toggle('active', !esMejoraCarta);
    }
    if (panelCarta) {
        panelCarta.style.display = esMejoraCarta ? 'block' : 'none';
    }
    if (panelEspecial) {
        panelEspecial.style.display = esMejoraCarta ? 'none' : 'block';
    }
}

function abrirModalConfirmacionMejora(tipo, indiceCarta) {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    normalizarObjetosUsuario(usuario);
    const carta = usuario?.cartas?.[indiceCarta];

    if (!carta) {
        mostrarMensaje('No se encontró la carta seleccionada.', 'danger');
        return;
    }

    if (tipo === 'mejoraCarta') {
        const nivel = Number(carta.Nivel || 1);
        if (nivel < 1 || nivel > 3) {
            mostrarMensaje('La mejora de carta solo aplica a niveles 1 a 3.', 'warning');
            return;
        }
        if (Number(usuario.objetos.mejoraCarta || 0) <= 0) {
            mostrarMensaje('No tienes mejoras de carta disponibles.', 'warning');
            return;
        }
    } else {
        if (Number(carta.Nivel || 1) !== 5) {
            mostrarMensaje('La mejora especial solo aplica a cartas de nivel 5.', 'warning');
            return;
        }
        if (Number(usuario.objetos.mejoraEspecial || 0) <= 0) {
            mostrarMensaje('No tienes mejoras especiales disponibles.', 'warning');
            return;
        }
    }

    mejoraObjetoPendiente = { tipo, indiceCarta };
    const modal = document.getElementById('modal-confirmacion-objeto');
    const texto = document.getElementById('texto-confirmacion-objeto');
    const etiquetaObjeto = tipo === 'mejoraCarta' ? 'mejora de carta' : 'mejora especial';
    texto.textContent = `¿Quieres mejorar esta carta usando ${etiquetaObjeto}?`;
    modal.style.display = 'flex';
}

function cerrarModalConfirmacionObjeto() {
    const modal = document.getElementById('modal-confirmacion-objeto');
    if (modal) {
        modal.style.display = 'none';
    }
    mejoraObjetoPendiente = null;
}

function cerrarModalResultadoObjeto() {
    const modal = document.getElementById('modal-resultado-objeto');
    if (modal) {
        modal.style.display = 'none';
    }
}

function crearCartaMejoradaPorObjeto(cartaOriginal, tipo) {
    const original = { ...cartaOriginal };
    const mejorada = { ...cartaOriginal };

    if (tipo === 'mejoraCarta') {
        const nivelInicial = Number(mejorada.Nivel || 1);
        const nivelFinal = Math.min(nivelInicial + 1, 4);
        const incrementoNiveles = Math.max(nivelFinal - nivelInicial, 0);
        mejorada.Nivel = nivelFinal;
        mejorada.Poder = Number(mejorada.Poder || 0) + (incrementoNiveles * 500);
    } else {
        const nivelInicial = Number(mejorada.Nivel || 1);
        const incrementoNiveles = Math.max(6 - nivelInicial, 0);
        mejorada.Nivel = 6;
        mejorada.Poder = Number(mejorada.Poder || 0) + (incrementoNiveles * 500);
    }

    return { original, mejorada };
}

function mostrarResultadoMejoraObjeto(cartaOriginal, cartaMejorada) {
    const contenedorOriginal = document.getElementById('resultado-carta-original');
    const contenedorMejorada = document.getElementById('resultado-carta-mejorada');
    const modal = document.getElementById('modal-resultado-objeto');

    if (!contenedorOriginal || !contenedorMejorada || !modal) {
        return;
    }

    contenedorOriginal.innerHTML = '';
    contenedorMejorada.innerHTML = '';

    contenedorOriginal.appendChild(crearElementoCartaSoloVisual(cartaOriginal));
    contenedorMejorada.appendChild(crearElementoCartaSoloVisual(cartaMejorada, true));
    modal.style.display = 'flex';
}

async function confirmarMejoraConObjeto() {
    if (!mejoraObjetoPendiente) {
        return;
    }

    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');
    normalizarObjetosUsuario(usuario);

    if (!usuario || !email) {
        mostrarMensaje('No se pudo validar la sesión del usuario.', 'danger');
        cerrarModalConfirmacionObjeto();
        return;
    }

    const { tipo, indiceCarta } = mejoraObjetoPendiente;
    const carta = usuario.cartas[indiceCarta];
    if (!carta) {
        mostrarMensaje('La carta seleccionada ya no está disponible.', 'danger');
        cerrarModalConfirmacionObjeto();
        return;
    }

    const stock = Number(usuario.objetos?.[tipo] || 0);
    if (stock <= 0) {
        mostrarMensaje('No tienes objetos suficientes para esta mejora.', 'warning');
        cerrarModalConfirmacionObjeto();
        return;
    }

    const { original, mejorada } = crearCartaMejoradaPorObjeto(carta, tipo);
    usuario.cartas[indiceCarta] = mejorada;
    usuario.objetos[tipo] = stock - 1;
    sincronizarMazosConColeccion(usuario);

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        cerrarModalConfirmacionObjeto();
        cargarCartas();
        mostrarResultadoMejoraObjeto(original, mejorada);
        mostrarMensaje('Mejora con objeto aplicada correctamente.', 'success');
    } catch (error) {
        console.error('Error al aplicar mejora con objeto:', error);
        mostrarMensaje('Error al aplicar mejora con objeto en Firebase.', 'danger');
        cerrarModalConfirmacionObjeto();
    }
}

async function mejorarDuplicadosAutomaticamente() {
    const usuario = JSON.parse(localStorage.getItem('usuario'));
    const email = localStorage.getItem('email');

    if (!usuario || !Array.isArray(usuario.cartas) || usuario.cartas.length === 0) {
        mostrarMensaje('No hay cartas disponibles para procesar.', 'warning');
        return;
    }

    if (!email) {
        mostrarMensaje('No se ha encontrado un email de usuario válido.', 'danger');
        return;
    }

    const analisis = analizarMejoraAutomatica(usuario.cartas);

    if (analisis.mejoras.length === 0 && analisis.destruidas.length === 0) {
        mostrarMensaje('No hay duplicados que mejorar o destruir automáticamente.', 'warning');
        return;
    }

    usuario.cartas = analisis.cartasActualizadas;
    usuario.puntos = Number(usuario.puntos || 0) + analisis.puntosGanados;
    sincronizarMazosConColeccion(usuario);

    try {
        await actualizarUsuarioFirebase(usuario, email);
        localStorage.setItem('usuario', JSON.stringify(usuario));
        cargarCartas();
        mostrarResultadoMejoraAutomatica(analisis);

        const resumenMejoras = analisis.mejoras.length > 0
            ? `${analisis.mejoras.length} cartas mejoradas`
            : 'sin mejoras de nivel';
        const resumenDestrucciones = analisis.destruidas.length > 0
            ? `, ${analisis.destruidas.length} duplicados destruidos por ${analisis.puntosGanados} puntos`
            : '';

        mostrarMensaje(`Mejora automática completada: ${resumenMejoras}${resumenDestrucciones}.`, 'success');
    } catch (error) {
        console.error('Error al aplicar la mejora automática:', error);
        mostrarMensaje('Error al aplicar la mejora automática en Firebase.', 'danger');
    }
}

async function actualizarUsuarioFirebase(usuario, email) {
    console.log('Actualizando usuario en Firebase...', { usuario, email });

    try {
        const response = await fetch('/update-user', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ usuario, email }) // Incluye el email en la solicitud
        });

        if (!response.ok) {
            throw new Error('Error en la solicitud de actualización.');
        }

        const data = await response.json();
        console.log('Respuesta de actualización de Firebase:', data);
        return data;
    } catch (error) {
        console.error('Error al actualizar el usuario en Firebase:', error);
        throw error;
    }
}

function resetFormulario() {
    console.log('Reiniciando formulario y recargando cartas...');
    cargarCartas(); // Recargar cartas
}

function mostrarMensaje(mensaje, tipo = 'warning') {
    const mensajeDiv = document.getElementById('mensaje');
    mensajeDiv.textContent = mensaje;
    mensajeDiv.className = `alert alert-${tipo}`;
    mensajeDiv.style.display = 'block';
    console.log(`Mostrando mensaje: ${mensaje} (${tipo})`);
    setTimeout(() => mensajeDiv.style.display = 'none', 3000);
}

function logout() {
    console.log('Cerrando sesión y limpiando localStorage...');
    localStorage.removeItem('usuario');
    localStorage.removeItem('email');
    localStorage.removeItem('jugandoPartida');
    localStorage.removeItem('mazoJugador');
    localStorage.removeItem('mazoOponente');
    window.location.href = '/login.html';
}
