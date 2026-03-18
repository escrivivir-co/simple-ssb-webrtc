# Plan: Backend-Only WebRTC (sin JavaScript en cliente)

> **Decisión arquitectónica**: Todo el WebRTC se ejecuta en el servidor Node.js
> mediante `node-datachannel`. El navegador solo utiliza formularios HTML nativos
> (`<form method="POST">`) y `<meta http-equiv="refresh">` para polling. **Cero
> JavaScript en el cliente.**
>
> **Motivo**: Los mantenedores de Oasis rechazaron el PR con JS en cliente.
> La filosofía de Oasis es "server-rendered HTML, no client-side JS".
> Además, JS en localhost expone a CSRF desde otras pestañas.

---

## Índice

1. [Arquitectura general](#arquitectura-general)
2. [Flujo de datos detallado](#flujo-de-datos-detallado)
3. [Estados de la vista](#estados-de-la-vista)
4. [ICE / STUN / TURN](#ice--stun--turn)
5. [Steps (Phases)](#steps)
6. [Ficheros relevantes](#ficheros-relevantes)
7. [Detalle de implementación](#detalle-de-implementación)
8. [Verificación](#verificación)
9. [Decisiones](#decisiones)
10. [Consideraciones futuras](#consideraciones-futuras)

---

## Arquitectura general

```
  Usuario A (navegador)          Oasis Server A (Node.js)                     Oasis Server B (Node.js)          Usuario B (navegador)
  ═══════════════════            ═══════════════════════                      ═══════════════════════            ═══════════════════
        │                              │                                              │                              │
        │── GET /webrtc ──────────────>│                                              │                              │
        │<── HTML (estado: idle) ──────│                                              │                              │
        │                              │                                              │                              │
        │── POST /webrtc/create ──────>│                                              │                              │
        │                         [node-datachannel]                                  │                              │
        │                         · new PeerConnection()                              │                              │
        │                         · createDataChannel()                               │                              │
        │                         · createOffer()                                     │                              │
        │                         · waitForIceComplete()                              │                              │
        │<── HTML (estado: offer) ─────│                                              │                              │
        │    (muestra offer code)      │                                              │                              │
        │                              │                                              │                              │
        │  ┄ usuario copia offer ┄┄┄┄┄┄│┄┄┄┄ (canal externo: email, chat) ┄┄┄┄┄┄┄┄┄>│┄┄┄┄┄ usuario pega offer ┄┄>│
        │                              │                                              │                              │
        │                              │                                              │<── POST /webrtc/join ────────│
        │                              │                                         [node-datachannel]                  │
        │                              │                                         · new PeerConnection()              │
        │                              │                                         · setRemoteDescription(offer)       │
        │                              │                                         · createAnswer()                    │
        │                              │                                         · waitForIceComplete()              │
        │                              │                                              │── HTML (estado: answer) ────>│
        │                              │                                              │   (muestra answer code)      │
        │                              │                                              │                              │
        │  <┄┄┄ usuario pega answer ┄┄│┄┄┄┄ (canal externo) ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄│┄┄┄ usuario copia answer ┄┄┄│
        │                              │                                              │                              │
        │── POST /webrtc/answer ──────>│                                              │                              │
        │                         [setRemoteDescription]                              │                              │
        │                         [DataChannel opens] <═══════════════════════════════> [DataChannel opens]           │
        │<── HTML (estado: connected)──│                                              │                              │
        │    (con <meta refresh=5>)    │                                              │── HTML (estado: connected) ─>│
        │                              │                                              │   (con <meta refresh=5>)     │
        │                              │                                              │                              │
        │── POST /webrtc/chat/send ──>│                                              │                              │
        │                         [dc.sendMessage(text)]═══════════>  [onMessage → buffer]                           │
        │<── redirect GET /webrtc ─────│                                              │                              │
        │                              │                                              │                              │
        │                              │                                              │<── GET /webrtc (auto-poll) ──│
        │                              │                                              │── HTML + mensajes nuevos ──>│
        │                              │                                              │                              │
        │── POST /webrtc/disconnect ─>│                                              │                              │
        │                         [pc.close()]                                        │                              │
        │<── redirect GET /webrtc ─────│                                              │── evento onClosed ──────────>│
        │    (estado: idle)            │                                              │   (estado: disconnected)     │
```

### Capas del sistema

```
┌─────────────────────────────────────────┐
│        Navegador (sin JS)               │  Formularios HTML + <meta refresh>
│  <form method="POST" action="/webrtc/*">│
├─────────────────────────────────────────┤
│        webrtc_view.js                   │  Vista hyperaxe, renderiza según estado
│  webrtcView(state, data)                │  Patrón: cipher_view.js
├─────────────────────────────────────────┤
│        backend.js (rutas)               │  GET /webrtc + POST /webrtc/*
│  koaBody() + ctx.request.body           │  Patrón: cipher encrypt/decrypt
├─────────────────────────────────────────┤
│        webrtc_model.js                  │  Estado en memoria + node-datachannel
│  createOffer(), processOffer(),         │  Patrón: cipher_model.js (stateless)
│  processAnswer(), sendMessage(), etc.   │  + tasks_model.js (factory con cooler)
├─────────────────────────────────────────┤
│     Signaling Abstraction Layer         │  ssb-webrtc/signaling/index.js
│  .send(peer, type, payload)             │
│  .onSignal(cb)                          │
├───────┬───────┬──────────┬──────────────┤
│manual │  ssb  │ ssb-lan  │  socket.io   │
│(HECHO)│       │          │              │
└───────┴───────┴──────────┴──────────────┘
```

### Diferencias clave vs. la versión anterior (con JS en cliente)

| Aspecto | Antes (JS en cliente) | Ahora (backend-only) |
|---|---|---|
| RTCPeerConnection | En el navegador (WebRTC API) | En Node.js (node-datachannel) |
| DataChannel | Browser ↔ Browser | Server ↔ Server |
| Interacción usuario | JavaScript DOM manipulation | `<form method="POST">` nativo |
| Actualización de chat | JS `onmessage` event en tiempo real | `<meta http-equiv="refresh" content="5">` polling |
| Audio/Video | getUserMedia + `<video>` | ❌ No disponible (getUserMedia es solo browser) |
| Estado de sesión | Variables JS en el navegador | Variables en memoria del proceso Node.js |
| Seguridad CSRF | Vulnerable (JS en localhost) | Protegido (referer validation + CSP form-action) |
| Complejidad cliente | ~370 líneas JS (webrtc-app.js) | 0 líneas JS |

### Transporte de señalización

| Transporte | Escenario | Tipo msg SSB | Requisitos |
|---|---|---|---|
| **manual** | Testing, cualquier red | N/A | Ninguno (ya funciona) |
| **ssb-conn** | Peers SSB conectados | `webrtc-signal` privado | ssb-private, peers online |
| **ssb-lan** | Misma LAN | `webrtc-signal` privado | ssb-lan, red local |
| **socket.io** | Peers remotos, pub relay | `post` privado o directo | Pub con socket.io |

---

## Flujo de datos detallado

### Modo manual (copy-paste) — paso a paso

#### Creador (Peer A)

1. **GET /webrtc** → vista en estado `idle` con dos botones-formulario: "Crear sala" y "Unirse"
2. **POST /webrtc/create** → `webrtcModel.createOffer()`:
   - Instancia `new nodeDatachannel.PeerConnection("PeerA", { iceServers: [...] })`
   - Crea DataChannel `"oasis-webrtc"` con `pc.createDataChannel("oasis-webrtc")`
   - Registra callbacks: `onLocalDescription`, `onLocalCandidate`, `onDataChannel`
   - `pc.setLocalDescription()` inicia ICE gathering
   - Espera a que ICE complete (gathering state → `complete`)
   - Serializa SDP offer → Base64
   - Guarda en `state.offerCode`, `state.phase = 'offer-created'`
   - **Respuesta**: re-render `webrtcView('offer-created', { offerCode })` (patrón cipher_view)
3. Usuario copia el offer code manualmente y lo envía al peer B
4. **POST /webrtc/answer** con `ctx.request.body.answerCode`:
   - `webrtcModel.processAnswer(answerCode)`:
     - Decodifica Base64 → SDP answer
     - `pc.setRemoteDescription(answer.sdp, answer.type)`
     - DataChannel se abre (callback `onOpen`)
     - `state.phase = 'connected'`
   - **Respuesta**: redirect → `GET /webrtc` (PRG pattern) → muestra chat

#### Respondedor (Peer B)

1. **GET /webrtc** → estado `idle`, click "Unirse" → formulario para pegar offer
2. **POST /webrtc/join** con `ctx.request.body.offerCode`:
   - `webrtcModel.processOffer(offerCode)`:
     - Decodifica Base64 → SDP offer
     - Instancia `new PeerConnection("PeerB", { iceServers })`
     - Registra callbacks DataChannel
     - `pc.setRemoteDescription(offer.sdp, offer.type)`
     - `onLocalDescription` callback recibe el answer SDP
     - Espera ICE complete
     - Serializa answer → Base64
     - `state.answerCode = ...`, `state.phase = 'answer-created'`
   - **Respuesta**: re-render `webrtcView('answer-created', { answerCode })`
3. Usuario copia el answer code y lo envía al peer A
4. Cuando peer A conecta con el answer, el DataChannel se abre
5. `state.phase → 'connected'` (detectado en callback `onOpen`)

#### Chat (ambos peers, una vez conectados)

1. **GET /webrtc** → estado `connected`, muestra:
   - Lista de mensajes (del buffer en memoria)
   - Formulario para enviar mensaje
   - `<meta http-equiv="refresh" content="5">` para auto-polling
   - Botón "Desconectar"
2. **POST /webrtc/chat/send** con `ctx.request.body.message`:
   - `webrtcModel.sendMessage(message)` → `dc.sendMessage(message)`
   - Añade al buffer local: `{ who: 'You', text, timestamp }`
   - **Respuesta**: redirect → `GET /webrtc` (PRG, evita re-submit)
3. Mensajes entrantes via DataChannel:
   - Callback `dc.onMessage(msg)` → push a `state.messages[]`
   - Se muestran en el próximo GET /webrtc (vía meta-refresh o recarga manual)

#### Desconexión

1. **POST /webrtc/disconnect** → `webrtcModel.disconnect()`:
   - `dc.close()`, `pc.close()`
   - Limpia estado: `state = { phase: 'idle', messages: [], ... }`
   - **Respuesta**: redirect → `GET /webrtc`

### Modo SSB (automático) — paso a paso

1. **GET /webrtc** → estado `idle`, usuario selecciona transporte "SSB"
2. **POST /webrtc/create** con `ctx.request.body.transport=ssb` y `ctx.request.body.peerId`:
   - `webrtcModel.createOffer()` igual que manual
   - Pero en vez de mostrar el offer code, lo publica:
     `sbot.webrtc.offer(peerId, offerSDP, cb)`
   - `state.phase = 'waiting-answer'`
   - **Respuesta**: re-render con `<meta http-equiv="refresh" content="5">`
   - Mensaje: "Esperando respuesta de @peer..."
3. En background, `sbot.webrtc.listen()` (pull-stream) detecta answer entrante:
   - Se procesa igual: `pc.setRemoteDescription(answer)`
   - `state.phase → 'connected'`
4. Al hacer refresh (meta-refresh cada 5s), GET /webrtc ve `state.phase = 'connected'`
   → muestra pantalla de chat

**Nota**: `sbot.webrtc.listen()` se inicia al cargar el módulo WebRTC (lazy,
cuando el usuario visita /webrtc por primera vez). Es un pull-stream `live: true`
que corre mientras el proceso Oasis esté vivo.

---

## Estados de la vista

La vista `webrtcView(state, data)` renderiza condicionalmente según el estado,
siguiendo el patrón de `cipher_view.js` (argumentos determinan qué mostrar).

### Diagrama de estados

```
                    ┌───────────┐
                    │   idle    │ ← GET /webrtc (sin sesión activa)
                    └─────┬─────┘
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
    POST /webrtc/create       POST /webrtc/join
              │                       │
              ▼                       ▼
    ┌─────────────────┐     ┌─────────────────┐
    │  offer-created  │     │  answer-created  │
    │  (muestra code) │     │  (muestra code)  │
    └────────┬────────┘     └────────┬─────────┘
             │                       │
    POST /webrtc/answer              │ (peer A conecta)
             │                       │
             ▼                       ▼
    ┌─────────────────────────────────────────┐
    │              connected                   │
    │  (chat + meta-refresh + desconectar)     │
    └────────────────┬────────────────────────┘
                     │
           POST /webrtc/disconnect
                     │
                     ▼
               ┌───────────┐
               │   idle    │
               └───────────┘

  Estado especial para SSB:
    ┌─────────────────┐
    │  waiting-answer  │ ← offer enviada vía SSB, esperando respuesta
    │  (meta-refresh)  │   del peer remoto
    └─────────┬────────┘
              │ (answer recibida vía SSB pull-stream)
              ▼
        ┌───────────┐
        │ connected  │
        └────────────┘
```

### Tabla de estados

| Estado | Se llega por | Vista renderiza | Formularios disponibles | Meta-refresh |
|---|---|---|---|---|
| `idle` | GET /webrtc (sin sesión) o POST /disconnect | Botones "Crear sala" / "Unirse", selector transporte | `<form POST /webrtc/create>`, link a formulario join | No |
| `offer-created` | POST /webrtc/create | Textarea readonly con offer code, formulario para pegar answer | `<form POST /webrtc/answer>` | No |
| `answer-created` | POST /webrtc/join | Textarea readonly con answer code, mensaje "esperando conexión..." | `<form POST /webrtc/disconnect>` | Sí (5s) — para detectar cuando DataChannel abre |
| `waiting-answer` | POST /webrtc/create (SSB) | Mensaje "Esperando respuesta de @peer..." | `<form POST /webrtc/disconnect>` | Sí (5s) — para detectar answer vía pull-stream |
| `connected` | DataChannel `onOpen` callback | Chat: lista mensajes + formulario enviar + botón desconectar | `<form POST /webrtc/chat/send>`, `<form POST /webrtc/disconnect>` | Sí (5s) — polling mensajes entrantes |
| `error` | Cualquier error irrecuperable | Mensaje de error + botón "Volver" | `<form POST /webrtc/disconnect>` (limpia estado) | No |

### Detalle de cada estado renderizado

#### Estado `idle`

```html
<!-- Renderizado por hyperaxe, aquí representado como HTML resultante -->
<section>
  <h2>WebRTC</h2>
  <p>Conexión peer-to-peer...</p>

  <div class="card">
    <h3>① Iniciar</h3>
    <form method="POST" action="/webrtc/create">
      <label>Transporte:</label>
      <select name="transport">
        <option value="manual">Manual (copy-paste)</option>
        <option value="ssb">SSB (automático)</option>
      </select>
      <!-- Si transport=ssb, se muestra campo peerId -->
      <!-- Pero sin JS, AMBOS campos se muestran siempre; -->
      <!-- el backend ignora peerId si transport=manual -->
      <label>Peer ID (solo para SSB):</label>
      <input type="text" name="peerId" placeholder="@xxxx.ed25519">
      <button type="submit">Crear sala</button>
    </form>
  </div>

  <div class="card">
    <h3>② Unirse a una sala</h3>
    <form method="POST" action="/webrtc/join">
      <label>Pega el código Offer del creador:</label>
      <textarea name="offerCode" rows="4" placeholder="Pega aquí..."></textarea>
      <button type="submit">Generar respuesta</button>
    </form>
  </div>
</section>
```

#### Estado `offer-created`

```html
<section>
  <div class="card">
    <h3>② Tu código Offer</h3>
    <p>Copia este código y envíalo a tu peer:</p>
    <textarea readonly rows="4">{offerCode base64}</textarea>
    <!-- Sin JS no hay botón "copiar al portapapeles" — el usuario selecciona y copia -->
  </div>

  <div class="card">
    <h3>③ Pega el código Answer de tu peer</h3>
    <form method="POST" action="/webrtc/answer">
      <textarea name="answerCode" rows="4" placeholder="Pega el answer aquí..."></textarea>
      <button type="submit">Conectar</button>
    </form>
  </div>

  <div class="card">
    <form method="POST" action="/webrtc/disconnect">
      <button type="submit">Cancelar</button>
    </form>
  </div>
</section>
```

#### Estado `connected` (chat)

```html
<meta http-equiv="refresh" content="5">
<section>
  <div class="card">
    <h3>☍ Conectado</h3>
    <p>Estado: connected | DataChannel: open</p>
  </div>

  <div class="card">
    <h3>ꕕ Chat</h3>
    <div class="webrtc-chat-messages">
      <!-- Mensajes renderizados server-side desde state.messages[] -->
      <div class="webrtc-chat-msg"><span class="webrtc-chat-you">You:</span> hola</div>
      <div class="webrtc-chat-msg"><span class="webrtc-chat-peer">Peer:</span> hola!</div>
    </div>

    <form method="POST" action="/webrtc/chat/send">
      <input type="text" name="message" placeholder="Escribe un mensaje..." autocomplete="off">
      <button type="submit">Enviar</button>
    </form>
  </div>

  <div class="card">
    <form method="POST" action="/webrtc/disconnect">
      <button type="submit">Desconectar</button>
    </form>
  </div>
</section>
```

---

## ICE / STUN / TURN

> Esta sección no cambia respecto a la arquitectura anterior. ICE/STUN/TURN
> aplica igual a `node-datachannel` en el servidor que a WebRTC en el navegador.
> La diferencia es que ahora los candidatos ICE reflejan la IP del servidor,
> no la del navegador del usuario.

### Conceptos

| Concepto | Qué hace | Analogía |
|---|---|---|
| **ICE** | Framework que prueba múltiples rutas de conexión y elige la mejor | El "GPS" que prueba todas las rutas posibles |
| **STUN** | Le dice a un peer cuál es su IP pública (resuelve NAT) | Un espejo: "tu IP pública es X.X.X.X" |
| **TURN** | Relay intermedio cuando la conexión directa es imposible | Un mensajero que pasa datos entre ambos |

### Cuándo se necesita cada uno

| Escenario de red | STUN | TURN | Conexión directa P2P |
|---|---|---|---|
| Misma LAN | No necesario | No | Sí (IP local) |
| NAT doméstico típico ("cone") | ✅ Suficiente | No | Sí (tras STUN) |
| Un peer con IP pública | ✅ Suficiente | No | Sí |
| Ambos detrás de NAT simétrico (empresas) | ❌ No basta | ✅ Necesario | No (relay vía TURN) |
| Firewalls que bloquean UDP | ❌ No basta | ✅ Necesario (TCP) | No (relay vía TURN) |
| Carriers móviles (4G/5G) | ✅ Funciona | ✅ Recomendado | Varía (muchos carriers usan NAT simétrico) |

### Nota sobre ICE en backend vs. browser

Cuando `node-datachannel` corre en un servidor:
- Los candidatos ICE reflejan la red **del servidor**, no la del navegador
- Si Oasis corre localmente (localhost), la situación es idéntica a browser WebRTC
- Si Oasis corriera en un VPS, tendría IP pública → STUN innecesario, TURN innecesario
- Para el caso de uso típico (Oasis en localhost), aplican las mismas reglas que antes

### Relación con los 4 transportes de señalización

| Transporte | Escenario típico | ¿Necesita STUN? | ¿Necesita TURN? | Notas |
|---|---|---|---|---|
| **manual** | Testing, cualquier red | Sí (si remoto) | Recomendado (si remoto) | El usuario copia el SDP por canal externo; la conectividad depende de ICE |
| **ssb-conn** | Peers SSB remotos | Sí | Recomendado | Los peers SSB pueden estar en cualquier red |
| **ssb-lan** | Misma LAN | No | No | Conectividad directa por IP local |
| **socket.io** | Remotos vía pub | Sí | Recomendado | Similar a ssb-conn, redes arbitrarias |

### Opciones de infraestructura TURN

| Opción | Coste | Mantenimiento | Capacidad | Privacidad | Notas |
|---|---|---|---|---|---|
| **Sin TURN** | 0 | 0 | N/A | Máxima | ~80% de conexiones funcionan solo con STUN |
| **coturn propio** | VPS ~5€/mes | Medio | Ilimitada* | Total | Open source, requiere VPS con puertos UDP |
| **Metered.ca (free)** | 0 | Ninguno | Free tier limitado | Tercero | Verificar límites actuales en metered.ca |
| **Xirsys (free)** | 0 | Ninguno | Free tier limitado | Tercero | Verificar límites actuales en xirsys.com |
| **Twilio (pay)** | Variable | Ninguno | Ilimitada | Tercero | Verificar pricing actual |
| **Cloudflare Calls** | Free tier | Ninguno | Free tier limitado | Tercero | Verificar disponibilidad y límites actuales |

*\*Limitada por ancho de banda del VPS*

### Recomendación escalonada

```
Sprint actual  →  Solo STUN (ya funciona, cubre ~80% de casos)
Sprint N+1     →  coturn propio en VPS del proyecto (100% cobertura, privacidad total)
Fallback       →  Metered.ca free tier para validar sin infra propia
```

La configuración ICE se gestiona en Phase 2 del plan — JSON en `oasis-config.json`
que mezcla defaults (STUN Google) con overrides del operador (TURN propio/servicio).

---

## Steps

### Phase 1: Modelo backend (webrtc_model.js)

> Dependencia: `npm install node-datachannel` en oasis-main

1. **Crear `src/models/webrtc_model.js`** — Módulo siguiendo patrón factory de `tasks_model.js`:
   ```js
   module.exports = ({ cooler }) => {
     // Estado en memoria (singleton por proceso Oasis — single-user app)
     let state = { phase: 'idle', pc: null, dc: null, offerCode: '', answerCode: '', messages: [], error: null };
     return { createOffer, processOffer, processAnswer, sendMessage, getState, getMessages, disconnect };
   };
   ```
   **Funciones del modelo:**
   - `createOffer(transport, peerId)` — Crea PeerConnection + DataChannel, genera offer, retorna offerCode. Si `transport='ssb'`, publica offer vía `sbot.webrtc.offer()`.
   - `processOffer(offerCode)` — Decodifica offer, crea PeerConnection, setRemoteDescription, genera answer, retorna answerCode.
   - `processAnswer(answerCode)` — Decodifica answer, setRemoteDescription. DataChannel se abre vía callback.
   - `sendMessage(text)` — `dc.sendMessage(text)`, push a `state.messages[]`.
   - `getState()` — Retorna `{ phase, offerCode, answerCode, error }` (sin exponer pc/dc).
   - `getMessages()` — Retorna `state.messages[]` y opcionalmente marca como leídos.
   - `disconnect()` — Cierra dc + pc, resetea state a idle.
   - `startListening()` — (SSB) Inicia pull-stream `sbot.webrtc.listen()` para señales entrantes.

2. **Gestión de estado en memoria** — El estado vive en el closure del módulo:
   - Solo una conexión WebRTC a la vez (Oasis es single-user)
   - Si el proceso se reinicia, se pierde el estado → `phase: 'idle'`
   - Los mensajes se acumulan en un array en memoria (no persisten en SSB)
   - Máximo ~1000 mensajes en buffer, FIFO si se excede

3. **API de `node-datachannel`** — Diferencias con la WebRTC browser API:
   ```js
   const nodeDatachannel = require('node-datachannel');

   // Crear PeerConnection
   const pc = new nodeDatachannel.PeerConnection("PeerA", {
     iceServers: ["stun:stun.l.google.com:19302"]
   });

   // Callbacks (NO son Promises, son event-style)
   pc.onLocalDescription((sdp, type) => { /* offer o answer lista */ });
   pc.onLocalCandidate((candidate, mid) => { /* candidato ICE */ });
   pc.onStateChange((state) => { /* "connected", "disconnected", etc. */ });
   pc.onGatheringStateChange((state) => { /* "complete" cuando ICE terminó */ });

   // Crear DataChannel
   const dc = pc.createDataChannel("oasis-webrtc");
   dc.onOpen(() => { /* canal abierto */ });
   dc.onMessage((msg) => { /* mensaje recibido */ });
   dc.onClosed(() => { /* canal cerrado */ });

   // Para el respondedor, recibir DataChannel remoto:
   pc.onDataChannel((dc) => { /* DataChannel del peer */ });

   // Generar offer
   pc.setLocalDescription(); // Inicia gathering + genera offer

   // Procesar offer del remoto (respondedor)
   pc.setRemoteDescription(sdp, type); // type = "offer"
   // pc.onLocalDescription recibirá el answer automáticamente

   // Procesar answer del remoto (creador)
   pc.setRemoteDescription(sdp, type); // type = "answer"
   ```

   **Nota**: `node-datachannel` usa strings para SDP, no objetos `RTCSessionDescription`.
   El formato de serialización será `JSON.stringify({ sdp, type })` → Base64.

### Phase 2: Configuración ICE (*paralelo con Phase 1*)

4. **ICE defaults en `ssb-webrtc/index.js`** — Lee `config.webrtc.iceServers` y los pasa al modelo.
5. **ICE override en `oasis-config.json`** — Sección `webrtcIceServers`:
   ```json
   {
     "webrtcIceServers": [
       "stun:stun.l.google.com:19302",
       "stun:stun1.l.google.com:19302",
       "turn:user:pass@turn.example.com:3478"
     ]
   }
   ```
   El modelo lee config vía `getConfig()` y hace merge con defaults.

### Phase 3: Rutas backend (backend.js)

6. **Registrar modelo** — Igual que otros modelos, importar factory y pasar `cooler`:
   ```js
   const webrtcModel = require('../models/webrtc_model')({ cooler });
   ```

7. **Rutas POST** — Siguiendo patrones cipher (re-render) y pm (PRG):
   ```
   GET  /webrtc              → Lee estado del modelo, renderiza webrtcView(state, data)
   POST /webrtc/create       → webrtcModel.createOffer(transport, peerId), re-render
   POST /webrtc/join         → webrtcModel.processOffer(offerCode), re-render
   POST /webrtc/answer       → webrtcModel.processAnswer(answerCode), redirect GET /webrtc
   POST /webrtc/chat/send    → webrtcModel.sendMessage(message), redirect GET /webrtc
   POST /webrtc/disconnect   → webrtcModel.disconnect(), redirect GET /webrtc
   ```

   **Patrón de ruta** (ejemplo para `/webrtc/create`):
   ```js
   .post('/webrtc/create', koaBody(), async (ctx) => {
     if (!checkMod(ctx, 'webrtcMod')) { ctx.redirect('/modules'); return; }
     const { transport, peerId } = ctx.request.body;
     await webrtcModel.createOffer(transport, peerId);
     const state = webrtcModel.getState();
     ctx.body = webrtcView(state.phase, state);
   })
   ```

   **Patrón de ruta** (ejemplo para `/webrtc/chat/send` — PRG):
   ```js
   .post('/webrtc/chat/send', koaBody(), async (ctx) => {
     if (!checkMod(ctx, 'webrtcMod')) { ctx.redirect('/modules'); return; }
     const { message } = ctx.request.body;
     if (message && message.trim()) {
       webrtcModel.sendMessage(message.trim());
     }
     ctx.redirect('/webrtc');
   })
   ```

8. **Validación de inputs** — En cada ruta POST:
   - `offerCode`: validar que es Base64 válido, longitud razonable (< 10KB)
   - `answerCode`: ídem
   - `message`: trim, longitud máxima (1000 chars), no vacío
   - `transport`: whitelist `['manual', 'ssb']`
   - `peerId`: si transport=ssb, validar formato `@xxx.ed25519`

### Phase 4: Vista (webrtc_view.js) — reescritura completa

9. **Firma de la vista** — Recibe estado y datos, renderiza condicionalmente:
   ```js
   const webrtcView = (phase = 'idle', data = {}) => {
     // phase: 'idle' | 'offer-created' | 'answer-created' | 'waiting-answer' | 'connected' | 'error'
     // data: { offerCode, answerCode, messages, error, transport, peerId, status }
   };
   ```

10. **Renderizado condicional** — Patrón cipher_view.js (ternarios con null):
    ```js
    const offerPanel = (phase === 'offer-created')
      ? div({ class: "card" },
          h3("② Tu código Offer"),
          textarea({ readonly: true, rows: 4 }, data.offerCode),
          // ... formulario para pegar answer
        )
      : null;
    ```
    Cada estado produce su propio bloque. `template()` envuelve todo.

11. **Meta-refresh** — Para estados que requieren polling:
    ```js
    const needsRefresh = ['answer-created', 'waiting-answer', 'connected'].includes(phase);
    // Se inyecta: meta({ "http-equiv": "refresh", content: 5 })
    // Solo en los estados que lo necesitan
    ```
    **Nota**: El meta-refresh de 5 segundos se añade vía `pageTpl.replace('</head>',
    '<meta http-equiv="refresh" content="5"></head>')`, similar al patrón de
    `indexing_view.js` que usa `content: 10`.

12. **Sin `<script>` tag** — La línea actual que inyecta `webrtc-app.js` se elimina:
    ```js
    // ELIMINAR esta línea:
    // + '<script src="/js/webrtc-app.js"></script>';
    ```

13. **CSS** — Se mantiene `webrtc.css` (105 líneas, prefijo `webrtc-*`), pero:
    - Eliminar `.webrtc-hidden` (ya no hay toggle JS de visibilidad)
    - Eliminar estilos de elementos que ya no existen (`#btn-toggle-mic`, `#btn-toggle-cam`, etc.)
    - Añadir estilos para textarea readonly (selección fácil para copiar)

### Phase 5: Signaling Abstraction Layer (ssb-webrtc/)

14. **Interfaz común** — `signaling/transport.js`:
    ```js
    { name, init(config), send(peerId, type, payload), onSignal(cb), listPeers(), destroy() }
    ```

15. **Refactorizar `manual.js`** — Adaptar a la interfaz. En backend-only, `send()` retorna el código, `onSignal()` acepta código via parámetro (no espera paste interactivo).

16. **Crear `ssb.js`** — Usa `sbot.private.publish()` (offer/answer/candidate/hangup) + `sbot.webrtc.listen()` (pull-stream live). Tombstone automático post-conexión.

17. **Crear `lan.js`** — Wrapper sobre ssb.js, filtra peers por ssb-lan.

18. **Crear `socketio.js`** — Basado en patrón de `ProjectRTC-001/app/socketHandler.js`.

19. **Registry** — `signaling/index.js` con `getTransport(name)`, `listTransports()`.

### Phase 6: Tipo de mensaje configurable

20. **Dual type** en ssb.js — `webrtc-signal` (default) o `post` con subject `[webrtc-signal]`.
    Configurable en `oasis-config.json` → `webrtcMessageType: "webrtc-signal" | "post"`.

### Phase 7: Limpieza

21. **Eliminar `webrtc-app.js`** — Borrar `src/client/public/js/webrtc-app.js` (368 líneas).
22. **Middleware** — Revisar exemptions en backend.js (líneas ~3230, ~3249):
    - Mantener `/webrtc` en las exemptions de sync-check y stats-refresh
    - `/js/` puede que ya no necesite exemption si no hay otros scripts WebRTC
23. **package.json** — Añadir `node-datachannel` como dependencia.

---

## Ficheros relevantes

### Ficheros a CREAR

| Fichero | Descripción | Patrón de referencia |
|---|---|---|
| `oasis-main/src/models/webrtc_model.js` | Modelo: PeerConnection + DataChannel + estado en memoria | `tasks_model.js` (factory + cooler), `cipher_model.js` (funciones puras) |
| `ssb-webrtc/signaling/transport.js` | Interfaz abstracta de transporte | Nuevo |
| `ssb-webrtc/signaling/ssb.js` | Transporte vía SSB private messages | Basado en `ssb-webrtc/index.js` |
| `ssb-webrtc/signaling/lan.js` | Transporte LAN (wrapper de ssb.js) | Nuevo |
| `ssb-webrtc/signaling/socketio.js` | Transporte Socket.io | `ProjectRTC-001/app/socketHandler.js` |
| `ssb-webrtc/signaling/index.js` | Registry de transportes | Nuevo |

### Ficheros a MODIFICAR

| Fichero | Cambios | Líneas aprox. |
|---|---|---|
| `oasis-main/src/views/webrtc_view.js` | **Reescritura completa**: eliminar IDs/buttons JS, usar `<form>`, renderizado condicional por estado, meta-refresh | 140 → ~180 |
| `oasis-main/src/backend/backend.js` | Añadir 5 rutas POST, importar webrtcModel, modificar GET /webrtc existente | +~50 líneas (L1713+) |
| `oasis-main/src/client/assets/styles/webrtc.css` | Eliminar `.webrtc-hidden`, estilos de botones JS; añadir estilos textarea readonly | ~105 → ~90 |
| `oasis-main/src/configs/oasis-config.json` | Añadir `webrtcIceServers` | +3 líneas |
| `oasis-main/package.json` | Añadir `node-datachannel` | +1 línea |
| `ssb-webrtc/index.js` | Leer ICE config, integrar con signaling layer | ~80 → ~100 |
| `ssb-webrtc/signaling/manual.js` | Refactorizar a interfaz transport | ~30 → ~40 |

### Ficheros a ELIMINAR

| Fichero | Motivo |
|---|---|
| `oasis-main/src/client/public/js/webrtc-app.js` | 368 líneas de JS en cliente — toda la lógica migra al modelo backend |

### Ficheros de traducción (i18n) — ya actualizados

Los 11 ficheros `oasis-main/src/client/assets/translations/oasis_XX.js` ya tienen
las ~36 claves WebRTC. Habrá que **revisar** algunas claves que ya no aplican
(e.g., `webrtcCopyToClipboard` — sin JS no hay botón de copiar programático) y
**añadir** claves nuevas para los estados adicionales:

| Clave nueva | Valor (en) |
|---|---|
| `webrtcSelectTransport` | "Transport:" |
| `webrtcManualMode` | "Manual (copy-paste)" |
| `webrtcSsbMode` | "SSB (automatic)" |
| `webrtcPeerIdLabel` | "Peer ID (SSB only):" |
| `webrtcWaitingAnswerSsb` | "Waiting for response from peer..." |
| `webrtcSelectAndCopy` | "Select the code above and copy it manually" |
| `webrtcAutoRefresh` | "This page refreshes automatically every 5 seconds" |
| `webrtcCancel` | "Cancel" |
| `webrtcErrorTitle` | "Error" |
| `webrtcBackToStart` | "Back to start" |

---

## Detalle de implementación

### `node-datachannel` — API reference

```js
const nodeDatachannel = require('node-datachannel');

// ══════════════════════════════════════════════════
// CREADOR (Peer A) — genera offer
// ══════════════════════════════════════════════════

const pc = new nodeDatachannel.PeerConnection("PeerA", {
  iceServers: ["stun:stun.l.google.com:19302"]
});

let localSdp = null;
let localType = null;
let gatheringDone = false;

pc.onLocalDescription((sdp, type) => {
  localSdp = sdp;
  localType = type;  // "offer" o "answer"
});

pc.onGatheringStateChange((state) => {
  if (state === 'complete') {
    gatheringDone = true;
    // Ahora localSdp contiene todos los candidatos ICE
  }
});

pc.onStateChange((state) => {
  // "new", "connecting", "connected", "disconnected", "failed", "closed"
  if (state === 'connected') { /* actualizar state.phase */ }
  if (state === 'disconnected' || state === 'failed') { /* cleanup */ }
});

// Crear DataChannel ANTES de setLocalDescription
const dc = pc.createDataChannel("oasis-webrtc");

dc.onOpen(() => {
  // DataChannel listo para enviar/recibir  
  // state.phase = 'connected'
});

dc.onMessage((msg) => {
  // msg es string
  // Push a state.messages[]
});

dc.onClosed(() => {
  // Peer desconectó
});

// Generar offer
pc.setLocalDescription();  // Sin argumentos → genera offer automáticamente

// Esperar a que ICE gathering termine (polling en el modelo):
// while (!gatheringDone) await sleep(100);
// offerCode = btoa(JSON.stringify({ sdp: localSdp, type: localType }));


// ══════════════════════════════════════════════════
// RESPONDEDOR (Peer B) — procesa offer, genera answer
// ══════════════════════════════════════════════════

const pc2 = new nodeDatachannel.PeerConnection("PeerB", {
  iceServers: ["stun:stun.l.google.com:19302"]
});

pc2.onLocalDescription((sdp, type) => {
  // type será "answer"
  // answerCode = btoa(JSON.stringify({ sdp, type }));
});

pc2.onDataChannel((dc) => {
  // DataChannel creado por el peer remoto
  dc.onOpen(() => { /* listo */ });
  dc.onMessage((msg) => { /* mensaje recibido */ });
});

// Procesar offer
pc2.setRemoteDescription(offerSdp, "offer");
// node-datachannel genera answer automáticamente → llega a onLocalDescription


// ══════════════════════════════════════════════════
// CREADOR: procesar answer
// ══════════════════════════════════════════════════

pc.setRemoteDescription(answerSdp, "answer");
// DataChannel se abre → dc.onOpen()
```

### Serialización SDP para copy-paste

```js
// Codificar (servidor → textarea readonly)
function encodeSdp(sdp, type) {
  return Buffer.from(JSON.stringify({ sdp, type })).toString('base64');
}

// Decodificar (formulario POST → servidor)
function decodeSdp(code) {
  const json = JSON.parse(Buffer.from(code.trim(), 'base64').toString('utf8'));
  if (!json.sdp || !json.type) throw new Error('Invalid SDP format');
  return json; // { sdp: "v=0\r\n...", type: "offer"|"answer" }
}
```

### Esperar ICE gathering (Promise wrapper)

```js
function waitForGatheringComplete(pc, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ICE gathering timeout')), timeoutMs);

    if (pc.gatheringState() === 'complete') {
      clearTimeout(timer);
      return resolve();
    }

    pc.onGatheringStateChange((state) => {
      if (state === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
}
```

### Patrón de estado en el modelo

```js
// Estado singleton — solo una conexión a la vez
let state = {
  phase: 'idle',        // idle | offer-created | answer-created | waiting-answer | connected | error
  pc: null,             // PeerConnection instance (node-datachannel)
  dc: null,             // DataChannel instance
  offerCode: '',        // Base64 encoded offer SDP
  answerCode: '',       // Base64 encoded answer SDP
  messages: [],         // [{ who: 'You'|'Peer'|'System', text: String, ts: Number }]
  error: null,          // String o null
  transport: 'manual',  // 'manual' | 'ssb'
  peerId: null          // '@xxx.ed25519' (solo para SSB)
};

// Máximo mensajes en buffer
const MAX_MESSAGES = 1000;

function addMessage(who, text) {
  state.messages.push({ who, text, ts: Date.now() });
  if (state.messages.length > MAX_MESSAGES) {
    state.messages = state.messages.slice(-MAX_MESSAGES);
  }
}
```

### Integración con vista — patrón cipher_view.js

```js
// En backend.js:
.get('/webrtc', async (ctx) => {
  if (!checkMod(ctx, 'webrtcMod')) { ctx.redirect('/modules'); return; }
  const state = webrtcModel.getState();
  const messages = webrtcModel.getMessages();
  ctx.body = webrtcView(state.phase, {
    offerCode: state.offerCode,
    answerCode: state.answerCode,
    messages: messages,
    error: state.error,
    transport: state.transport
  });
})

// En webrtc_view.js:
const webrtcView = (phase = 'idle', data = {}) => {
  const needsRefresh = ['answer-created', 'waiting-answer', 'connected'].includes(phase);

  const idlePanel = (phase === 'idle') ? div({ class: "card" }, /* formularios */) : null;
  const offerPanel = (phase === 'offer-created') ? div({ class: "card" }, /* offer code */) : null;
  const answerPanel = (phase === 'answer-created') ? div({ class: "card" }, /* answer code */) : null;
  const waitingPanel = (phase === 'waiting-answer') ? div({ class: "card" }, /* waiting msg */) : null;
  const chatPanel = (phase === 'connected') ? div({ class: "card" }, /* chat */) : null;
  const errorPanel = (phase === 'error') ? div({ class: "card" }, /* error */) : null;

  let pageTpl = template(
    i18n.webrtcTitle || "WebRTC",
    section(idlePanel, offerPanel, answerPanel, waitingPanel, chatPanel, errorPanel)
  );

  pageTpl = pageTpl.replace('</head>', '<link rel="stylesheet" href="/assets/styles/webrtc.css"></head>');

  if (needsRefresh) {
    pageTpl = pageTpl.replace('</head>', '<meta http-equiv="refresh" content="5"></head>');
  }

  return pageTpl;
};
```

---

## Verificación

### Tests funcionales (manuales)

| # | Test | Cómo verificar | Resultado esperado |
|---|---|---|---|
| 1 | Crear sala manual | POST /webrtc/create con transport=manual | Vista muestra offer code Base64 en textarea readonly |
| 2 | Unirse a sala | POST /webrtc/join con offer code válido | Vista muestra answer code Base64 |
| 3 | Conectar | POST /webrtc/answer con answer code | Estado cambia a `connected`, chat visible |
| 4 | Enviar mensaje | POST /webrtc/chat/send con texto | Mensaje aparece en el buffer, redirect a GET /webrtc |
| 5 | Recibir mensaje | Peer envía vía DataChannel | Mensaje aparece tras meta-refresh (≤5s) |
| 6 | Desconectar | POST /webrtc/disconnect | Estado vuelve a `idle`, PeerConnection cerrado |
| 7 | Offer inválido | POST /webrtc/join con texto basura | Estado `error` con mensaje descriptivo |
| 8 | Answer inválido | POST /webrtc/answer con texto basura | Estado `error` con mensaje descriptivo |
| 9 | Doble sesión | POST /webrtc/create cuando ya hay sesión activa | Comportamiento definido: error o auto-disconnect prev |
| 10 | Módulo desactivado | GET /webrtc con webrtcMod=off | Redirect a /modules |
| 11 | CSRF | POST desde origen externo (curl sin referer) | 400 Bad Request (middleware referer validation) |
| 12 | Meta-refresh | Estar en estado `connected` | Página se recarga cada 5s mostrando mensajes nuevos |

### Tests entre dos instancias Oasis

| # | Test | Setup | Resultado esperado |
|---|---|---|---|
| 13 | Manual localhost | 2 instancias Oasis en puertos distintos del mismo PC | Chat funciona |
| 14 | Manual remoto (LAN) | 2 PCs en misma red | Chat funciona (STUN puede no ser necesario) |
| 15 | SSB offline | 2 instancias `--offline`, peers mutuos | Offer vía SSB, answer automático, chat funciona |
| 16 | SSB online | 2 instancias con pub, peers remotos | Ídem pero con conectividad real Internet |

### Zero client JS check

| # | Verificación | Cómo |
|---|---|---|
| 17 | Sin `<script>` tags | Ver source de GET /webrtc → no debe haber `<script>` |
| 18 | Sin event handlers inline | No `onclick`, `onsubmit`, etc. en el HTML |
| 19 | Funciona con JS deshabilitado | Deshabilitar JS en browser → toda la funcionalidad OK |
| 20 | CSP script-src | CSP `script-src 'self'` no se necesita para WebRTC (no hay scripts) |

---

## Decisiones

| Decisión | Elección | Justificación |
|---|---|---|
| **WebRTC en servidor** | `node-datachannel` (bindings a libdatachannel C++) | Única forma de WebRTC sin JS en cliente. Librería activa, bindings nativos. |
| **Sin audio/video** | Solo DataChannel (texto) | `getUserMedia` es API exclusiva del navegador. No existe equivalente server-side sin ffmpeg+pulse. Se puede añadir en futuro como feature separada. |
| **Polling vs SSE** | `<meta http-equiv="refresh" content="5">` | SSE requiere JS (`EventSource`). Meta-refresh es HTML puro. Latencia de 0-5s aceptable para chat. Precedente: `indexing_view.js` usa `content: 10`. |
| **Estado en memoria** | Singleton en closure del modelo | Oasis es single-user. No necesita base de datos ni sesiones HTTP. Si el proceso muere, la conexión WebRTC muere igual → estado limpio. |
| **Patrón POST** | Re-render para create/join, PRG para chat/disconnect | Create/join necesitan mostrar códigos inmediatamente (como cipher encrypt). Chat/disconnect son acciones que no generan output → PRG evita re-submit. |
| **Multi-transporte** | manual, ssb-conn, ssb-lan, socket.io | Todos intercambiables vía selectSignaling layer. Manual es el primero. |
| **ICE config** | Defaults en plugin + override en oasis-config.json | Merge de arrays: config del operador prevalece. |
| **Tipo de mensaje SSB** | Configurable: `webrtc-signal` (default) o `post` | Flexibilidad para redes SSB que filtran tipos desconocidos. |
| **Tombstone** | Automático post-conexión (SSB mode) | Evita acumulación de señales obsoletas en el log SSB. |
| **Buffer mensajes** | 1000 max, FIFO | Previene memory leak en chats largos. No persiste a disco. |

---

## Consideraciones futuras

### 1. Audio/Video

`getUserMedia()` es una API exclusiva del navegador — **no existe en Node.js**.
Para soportar audio/video en backend-only se necesitaría:

- **Opción A**: ffmpeg + PulseAudio/ALSA para captura server-side → complejamente inviable para el caso de uso (cada usuario tendría que tener un micrófono/cámara conectado al servidor)
- **Opción B**: GStreamer con `node-datachannel` media support → mismo problema
- **Opción C**: Aceptar JS mínimo **solo** para audio/video (`getUserMedia` + `<video>`) mientras el signaling y DataChannel siguen siendo backend-only. Esto requeriría una excepción a la política "zero JS".

**Recomendación**: Dejar audio/video fuera del scope inicial. El valor principal del módulo es chat P2P cifrado sin servidores intermedios. Si en el futuro se quiere audio/video, discutir opciones con mantenedores.

### 2. Latencia del meta-refresh

El polling cada 5 segundos introduce latencia de 0-5s en mensajes entrantes.
Esto es aceptable para chat asíncrono pero no para conversaciones en tiempo real.

- Se podría reducir a 2-3 segundos (más tráfico HTTP)
- Se podría hacer configurable en oasis-config.json
- Es un tradeoff explícito: **sin JS = sin WebSocket/SSE = sin push en tiempo real**

### 3. NAT traversal / TURN

La config actual solo usa STUN (Google), cubre ~80% de NATs domésticos.
**No funcionará** con NATs simétricos (redes corporativas, algunos carriers móviles).
Para conectividad universal se necesita TURN (coturn, Metered.ca, Xirsys).
Se configura en Phase 2 vía `oasis-config.json` → `webrtcIceServers`.

### 4. Concurrencia

Oasis es single-user pero podría recibir múltiples requests simultáneas
(e.g., meta-refresh mientras el usuario hace POST). El modelo debe ser
thread-safe en su gestión de estado. Node.js es single-threaded por defecto,
así que esto no es un problema real, pero las operaciones async del modelo
(createOffer, processAnswer) deben evitar race conditions con locks simples
o flags de "operación en curso".

### 5. Persistencia de mensajes

Los mensajes se pierden al reiniciar Oasis. Opciones:
- **Sin persistencia** (actual): Simple, privacidad máxima (nada en disco)
- **Fichero temporal**: `fs.writeFileSync` a un fichero en `/tmp/` o `~/.ssb/webrtc-chat.json`
- **Publicar en SSB**: Los mensajes de chat se publican como `post` privado → persisten en el log SSB → se pueden releer. Esto cambiaría la semántica (ya no es efímero).

**Recomendación**: Sin persistencia por ahora. Si se necesita historial, usar SSB private messages directamente (que ya existe como feature de Oasis).

### 6. Dependencia nativa (node-datachannel)

`node-datachannel` usa bindings C++ nativos (libdatachannel). Implicaciones:
- Necesita compilación nativa (`node-gyp`) o prebuild binarios
- Puede fallar en arquitecturas no comunes (ARM 32-bit, musl/Alpine)
- Alternativa: `werift` (WebRTC puro TypeScript, sin bindings nativos) — más lento pero portátil
- **Recomendación**: Usar `node-datachannel` y documentar requisitos de build. Si hay problemas de portabilidad, evaluar `werift`.

### 7. CSP

- `form-action 'self'` ya está configurado → los formularios POST funcionan
- `script-src 'self'` sigue en CSP pero no se usa para WebRTC (no hay scripts)
- No se necesita `connect-src` (no hay fetch/XHR/SSE/WebSocket)
- **No se requieren cambios en CSP** para la implementación backend-only

### 8. Llamada entrante (SSB mode)

Cuando otro peer envía un offer vía SSB, el listener (`sbot.webrtc.listen()`)
lo detecta. ¿Cómo notificar al usuario sin JS?

- **Opción A**: El usuario visita /webrtc y ve "Llamada entrante de @peer" + botón "Aceptar"
- **Opción B**: Banner en cualquier página de Oasis (requiere modificar template global)
- **Recomendación**: Opción A para el scope inicial. El usuario debe visitar /webrtc periódicamente o tener la pestaña abierta con meta-refresh.
