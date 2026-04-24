document.addEventListener('DOMContentLoaded', function () {
    const registroForm = document.getElementById('registroForm');
    const loginForm = document.getElementById('loginForm');

    if (registroForm) {
        registroForm.addEventListener('submit', function (e) {
            e.preventDefault();

            const nickname = document.getElementById('nickname').value.trim();
            const email = document.getElementById('email').value;
            const contraseña = document.getElementById('contraseña').value;

            if (!nickname) {
                const mensajeDiv = document.getElementById('mensaje');
                mensajeDiv.textContent = 'El nickname es obligatorio.';
                mensajeDiv.className = 'text-danger';
                return;
            }

            fetch('/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nickname, email, contraseña })
            })
            .then(response => {
                if (!response.ok) { 
                    return response.json().then(errorData => {
                        throw new Error(errorData.mensaje || 'Error al registrar el usuario.');
                    });
                }
                return response.json(); 
            })
            .then(data => {
                const mensajeDiv = document.getElementById('mensaje');
                mensajeDiv.textContent = data.mensaje;

                if (data.mensaje === 'Usuario registrado con éxito') {
                    mensajeDiv.className = 'text-success'; // Aplica la clase de éxito (verde)
                    setTimeout(() => window.location.href = '/login.html', 2000);
                } else {
                    mensajeDiv.className = 'text-danger'; // Aplica la clase de error (rojo)
                }
            })
            .catch(error => {
                console.error('Error:', error);
                const mensajeDiv = document.getElementById('mensaje');
                mensajeDiv.textContent = error.message;
                mensajeDiv.className = 'text-danger'; // Aplica la clase de error (rojo)
            });
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', function (e) {
            e.preventDefault();

            const email = document.getElementById('email').value;
            const contraseña = document.getElementById('contraseña').value;

            fetch('/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, contraseña })
            })
            .then(response => {
                if (!response.ok) { 
                    return response.json().then(errorData => { 
                        throw new Error(errorData.mensaje || 'Error al iniciar sesión.');
                    });
                }
                return response.json(); 
            })
            .then(data => {
                const mensajeDiv = document.getElementById('mensaje');
                mensajeDiv.textContent = data.mensaje;

                if (data.mensaje === 'Inicio de sesión exitoso') {
                    mensajeDiv.className = 'text-success'; // Aplica la clase de éxito (verde)
                    // Almacena los datos del usuario en el localStorage
                    localStorage.setItem('usuario', JSON.stringify(data.usuario));
                    // Almacena el email del usuario por separado
                    localStorage.setItem('email', email);
                    setTimeout(() => window.location.href = '/vistaJuego.html', 2000);
                } else {
                    mensajeDiv.className = 'text-danger'; // Aplica la clase de error (rojo)
                }
            })
            .catch(error => {
                console.error('Error:', error);
                const mensajeDiv = document.getElementById('mensaje');
                mensajeDiv.textContent = error.message;
                mensajeDiv.className = 'text-danger'; // Aplica la clase de error (rojo)
            });
        });
    }

    // Verifica la sesión en páginas que requieren autenticación
    if (window.location.pathname !== '/login.html' && window.location.pathname !== '/registro.html') {
        verificarSesion();
    }
});

// Verifica si existe un objeto de usuario en el localStorage
function verificarSesion() {
    const usuario = localStorage.getItem('usuario');
    console.log("Usuario desde localStorage:", usuario); // Añade esta línea para depurar
    if (!usuario) {
        window.location.href = '/login.html';
    }
}
