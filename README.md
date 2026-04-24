# DC Battle Cards - Documento Funcional

## Descripción General
**DC Battle Cards** es una aplicación web de duelos de cartas coleccionables ambientada en el universo de DC Comics. El proyecto permite a los usuarios registrarse, gestionar su propia colección de cartas, construir mazos personalizados, mejorar sus cartas y enfrentarse a otros jugadores en tiempo real mediante un sistema de combate por turnos.

---

## Arquitectura Técnica

### Backend (Servidor)
- **Node.js & Express**: Actúa como el servidor web y API REST para la gestión de usuarios y sincronización de datos.
- **Socket.io**: Facilita la comunicación bidireccional en tiempo real para el chat, el sistema de invitaciones y la lógica de las partidas.
- **Firebase (Firestore)**: Utilizado para la persistencia de datos de usuario (perfiles, colecciones de cartas, mazos y estadísticas).
- **BCrypt**: Empleado para el hashing y seguridad de las contraseñas de los usuarios.
- **XLSX (SheetJS)**: Permite la lectura del catálogo base de cartas desde un archivo Excel (`cartas.xlsx`).

### Frontend (Cliente)
- **Tecnologías**: HTML5, CSS3 y JavaScript Vanilla.
- **Socket.io Client**: Para la conexión en tiempo real con el servidor.
- **Interfaz de Usuario**: Diseño modular con vistas separadas para cada funcionalidad (Colección, Mazos, Mejora, Tablero).

---

## Estructura del Proyecto

```text
DC Battle Cards/
├── server.js               # Servidor principal (Express + Socket.io + Firebase)
├── package.json            # Dependencias y scripts del proyecto
├── public/                 # Archivos estáticos del cliente
│   ├── index.html          # Punto de entrada / Login
│   ├── registro.html       # Formulario de registro
│   ├── menu.html           # Menú principal de navegación
│   ├── coleccion.html      # Visualización de la colección de cartas
│   ├── mazos.html          # Gestión de mazos creados
│   ├── crearMazos.html     # Editor de mazos
│   ├── mejorarCartas.html  # Sistema de mejora y fusión de cartas
│   ├── vistaJuego.html     # Lobby de juego (Chat y búsqueda de oponentes)
│   ├── tablero.html        # Interfaz de combate (La Partida)
│   ├── css/                # Hojas de estilo (tablero, mazos, etc.)
│   ├── js/                 # Lógica del cliente (configuración Firebase, scripts auxiliares)
│   └── resources/
│       └── cartas.xlsx     # Base de datos de cartas (Catálogo)
└── socket.io/              # Librería del cliente de Socket.io
```

---

## Funcionalidades Principales

### 1. Gestión de Usuarios y Autenticación
- **Registro**: Al registrarse, el sistema asigna automáticamente una colección inicial de 20 cartas aleatorias al usuario.
- **Login**: Validación de credenciales mediante Firebase y BCrypt.
- **Persistencia**: Los datos se guardan en la nube (Firestore), permitiendo recuperar el progreso desde cualquier dispositivo.

### 2. Colección y Mazos
- **Colección**: Los usuarios pueden ver todas las cartas que poseen, filtrarlas por nombre o facción.
- **Creador de Mazos**: Permite construir mazos de 12 cartas. El sistema valida que el mazo sea legal para su uso en partida.
- **Sincronización**: Los mazos se actualizan automáticamente si las cartas que los componen sufren cambios (como mejoras de nivel).

### 3. Sistema de Mejora de Cartas
- **Mejora Automática**: El sistema puede detectar cartas duplicadas y fusionarlas para subir de nivel (Nivel 1 a 5), incrementando su poder de combate.
- **Destrucción**: Las cartas sobrantes se pueden destruir para obtener puntos de victoria, que pueden usarse para otras mejoras.
- **Escalado de Poder**: Cada nivel de mejora aumenta significativamente el atributo de "Poder" de la carta.

### 4. Lobby y Comunicación
- **Chat en Tiempo Real**: Los jugadores conectados pueden comunicarse a través de un chat global en la vista de juego.
- **Lista de Conectados**: Muestra los usuarios activos disponibles para un desafío.
- **Sistema de Invitaciones**: Los jugadores pueden enviarse invitaciones de duelo. Si el receptor acepta, ambos son redirigidos automáticamente al tablero de juego.

### 5. Sistema de Combate (El Tablero)
- **Inicio de Partida**: Se seleccionan 3 cartas iniciales del mazo de cada jugador. El primer turno se determina comparando el poder total de las cartas en mano.
- **Turnos Dinámicos**: Los jugadores se turnan para atacar con sus cartas.
- **Lógica de Ataque**: Las cartas infligen daño basado en su poder. Si el poder de una carta llega a 0, es eliminada del tablero.
- **Robo de Cartas**: Posibilidad de sacar nuevas cartas del mazo cuando hay espacios vacíos.
- **Victoria y Recompensas**: Al ganar una partida, el usuario recibe puntos de victoria y nuevas cartas para su colección, cuyo nivel depende de la dificultad del duelo superado.

---

## Flujo de Juego Típico
1. El usuario inicia sesión y accede al **Menú Principal**.
2. Gestiona su **Colección** y se asegura de tener un **Mazo** de 12 cartas listo.
3. Entra en **Jugar Partida**, donde puede chatear y esperar a que alguien lo invite o invitar a un jugador conectado.
4. Se desarrolla el duelo en el **Tablero** mediante estrategia de ataques por turnos.
5. Tras el duelo, el jugador recibe recompensas y vuelve a la **Colección** para mejorar sus cartas.

---

## Instalación y Ejecución

1. Clonar el repositorio.
2. Instalar dependencias:
   ```bash
   npm install
   ```
3. Ejecutar el servidor:
   ```bash
   node server.js
   ```
4. Abrir en el navegador: `http://localhost:3000`
