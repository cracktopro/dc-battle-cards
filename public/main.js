document.addEventListener('DOMContentLoaded', function () {
    const registroForm = document.getElementById('registroForm');
    const loginForm = document.getElementById('loginForm');
    const mensajeDivLogin = document.getElementById('mensaje');
    if (mensajeDivLogin) {
        try {
            const aviso = sessionStorage.getItem('dc_sesion_cerrada_aviso');
            if (aviso) {
                mensajeDivLogin.textContent = aviso;
                mensajeDivLogin.className = 'text-warning';
                sessionStorage.removeItem('dc_sesion_cerrada_aviso');
            }
        } catch (_e) {
            /* ignore */
        }
    }

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
                    mensajeDiv.className = 'text-success';
                    if (typeof window.DCSesionUnica?.guardarSesionActivaTrasLogin === 'function') {
                        window.DCSesionUnica.guardarSesionActivaTrasLogin(email, data.usuario, data.sessionId);
                    } else {
                        localStorage.setItem('usuario', JSON.stringify(data.usuario));
                        localStorage.setItem('email', email);
                        if (data.sessionId) {
                            localStorage.setItem('dc_active_session_id_v1', data.sessionId);
                        }
                    }
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
    const email = localStorage.getItem('email');
    const sessionId = localStorage.getItem('dc_active_session_id_v1');
    if (!usuario || !email || !sessionId) {
        window.location.href = '/login.html';
    }
}
