document.addEventListener('DOMContentLoaded', function () {
    // Obtén los datos del usuario desde localStorage
    const usuario = JSON.parse(localStorage.getItem('usuario'));

    if (usuario && usuario.cartas) {
        cargarCartas(usuario.cartas);
    } else {
        console.error('No se encontraron cartas para el usuario.');
    }
});

function cargarCartas(cartas) {
    const contenedorCartas = document.getElementById('contenedor-cartas');

    cartas.forEach(carta => {
        const cartaDiv = document.createElement('div');
        cartaDiv.classList.add('carta');
        if (Number(carta.Nivel || 1) >= 6) {
            cartaDiv.classList.add('nivel-legendaria');
        }

        const imagenUrl = obtenerImagenCarta(carta);
        cartaDiv.style.backgroundImage = `url(${imagenUrl})`;
        cartaDiv.style.backgroundSize = 'cover';

        // Añadir nombre de la carta
        const nombreDiv = document.createElement('div');
        nombreDiv.classList.add('nombre-carta');
        nombreDiv.textContent = carta.Nombre;
        cartaDiv.appendChild(nombreDiv);

        // Añadir poder de la carta
        const poderDiv = document.createElement('div');
        poderDiv.classList.add('poder-carta');
        poderDiv.textContent = carta.Poder;
        cartaDiv.appendChild(poderDiv);

        // Añadir estrellas según el nivel de la carta
        const nivelDiv = document.createElement('div');
        nivelDiv.classList.add('nivel-carta');
        for (let i = 0; i < carta.Nivel; i++) {
            const estrella = document.createElement('img');
            estrella.src = 'https://i.ibb.co/zZt4R3x/star-level.png';
            estrella.classList.add('estrella');
            nivelDiv.appendChild(estrella);
        }
        cartaDiv.appendChild(nivelDiv);

        contenedorCartas.appendChild(cartaDiv);
    });
}
