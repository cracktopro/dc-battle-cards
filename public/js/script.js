
import { auth } from './firebase-config.js';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from "firebase/auth";

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'red';
    ctx.fillRect(50, 50, 200, 100);
});

// Registro de usuarios
function registrarUsuario(email, password) {
    createUserWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            // Usuario registrado
            const user = userCredential.user;
            console.log("Usuario registrado:", user);
        })
        .catch((error) => {
            console.error("Error al registrar:", error);
        });
}

// Inicio de sesión de usuarios
function iniciarSesion(email, password) {
    signInWithEmailAndPassword(auth, email, password)
        .then((userCredential) => {
            // Sesión iniciada
            const user = userCredential.user;
            console.log("Sesión iniciada:", user);
        })
        .catch((error) => {
            console.error("Error al iniciar sesión:", error);
        });
}
