# Documento Contexto Funcionamiento Evento Cooperativo Online

Documento que explica al detalle las directrices que en TODO momento deben cumplirse durante el transcurso de una partida de evento cooperativo online:

## PREVIO A INICIO DE PARTIDA

- jugador_1 y jugador_2 eligen 6 cartas cada uno para jugar la partida.
- las cartas que usara el bot están definidas en eventos_online.xlsx y se cargan al iniciar el evento cooperativo.

## INICIO DE PARTIDA

- aparecen en el tablero_coop 4 cartas del BOT en la parte superior
- aparecen en el tablero_coop 2 cartas aleatorias de jugador_1 y 2 cartas aleatorias jugador_2 en la parte inferior. (de las 6 que haya elegido cada uno, logicamente)

Por lo tanto:

- **BOT:** tendrá 4 cartas extra en el mazo + carta de tipo BOSS. 5 en total.
- **jugador_1:** tendrá 4 cartas extra en su mazo.
- **jugador_2:** tendrá 4 cartas extra en su mazo.

**Animación de aparecer cartas en tablero:** Esta animación pinta las cartas en orden de slot (slot1, slot2, slot3...) con un pequeño wait entre ellas (0.5s) siempre que estos slots no tengan ya cartas en ellos.

## TURNO INICIAL

El turno inicial se determina sumando por un lado, el poder total de las cartas del BOT y el poder total de las cartas de jugador_1 + las cartas del jugador_2. Si BOT tiene más poder, es su turno. si jugador_1 + jugador_2 tienen más poder, es turno del jugador_1 (SIEMPRE).

Cuando se hace este calculo, una vez resuelto se muestra un mensaje modal en el centro de la pantalla que indica: "Turno de $nombre$"

## FASE DE TURNO (JUGADOR_1)

- Cuando es el turno de un jugador, este dispondrá de varias acciones en función de las cartas de que disponga en el tablero:

### Habilidad activa:

- Habilidades que afectan a cartas aliadas o a si mismas (shield, heal, heal_all, tank)
- Habilidades que afectan a cartas del rival (extra_attack, aoe, stun, dot)

### ataque básico:

el jugador selecciona una de sus cartas y después una carta del rival, el ataque se efectua y la carta queda inutilizada durante ese turno.

**las habilidades activas NUNCA inutilizan una carta durante el turno.** la lógica es, primero usar la habilidad de una carta y después su ataque basico, para asi completar el uso de esa carta durante el turno activo.

si la carta objetivo llega a 0 de salud, se elimina del tablero, pero siempre después de haber finalizado las animaciones de daño.

### cuando finaliza el turno:

Si no hay ninguna habilidad o ataque en curso, es decir, que se hayan finalizado las animaciones de daño y barra de salud, eliminación de carta rival del tablero si aplica etc, se comprueba si el jugador ha usado ya todas sus cartas activas. si esto se cumple, entonces se pasa al turno del siguiente jugador/BOT.

### consideraciones adiciones:

- Tanto jugador_1 como jugador_2 deben visualizar todo lo que ocurre en tablero de forma simultanea.

### El flujo de la habilidad activa extra_daño siempre será el siguiente:

se activa habilidad. Antes de aplicar el daño sobre la carta objetivo mostramos el mensaje modal.

Después y solo después aplicamos el efecto con el pop up de daño en rojo en la carta objetivo y mostramos la animación de barra de salud reduciendose progresivamente hasta el punto correcto.

una vez terminado todo esto, si la salud = 0, eliminamos carta.

### El flujo de la habilidad activa aoe siempre será el siguiente:

se activa habilidad. Antes de aplicar el daño sobre la cartas objetivo disponibles en tablero mostramos el mensaje modal.

Después y solo después aplicamos el efecto con el pop up de daño en rojo en las cartas objetivo y mostramos la animación de barra de salud reduciendose progresivamente hasta el punto correcto.

una vez terminado todo esto, si la salud = 0, eliminamos cartas donde se cumpla.

### Solo se sacarán cartas al tablero del mazo durante un turno activo si:

- en turno BOT, jugador_1 y jugador_2 se han quedado sin cartas en el tablero (y si no les quedan cartas en los mazos han perdido la partida, obviamente)
- en turno de jugador_1 o jugador_2 si durante turno activo BOT ya no tiene cartas. (y si mazo está vácio, obviamente bot también ha perdido)

Para más contexto, puedes revisar el funcionamiento de partida VS BOT y de partida PVP online, que podrás encontrar el código en partida.js, server.js, tablero.html, etc...

TODO ESTE FLUJO DE COMBATE DE EVENTO COOPERATIVO ONLINE ESTÁ UBICADO EN partidaCoop.js, tablero_coop.html y server.js.
