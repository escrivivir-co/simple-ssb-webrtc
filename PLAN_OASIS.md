NOTA: EN LA RAMA oasis-pr hay una implementación no segura js en cliente.

[https://github.com/escrivivir-co/simple-ssb-webrtc/commit/36106a959137d6ea252c2f0b53bda83a31490d12](https://github.com/escrivivir-co/simple-ssb-webrtc/commit/36106a959137d6ea252c2f0b53bda83a31490d12)

# Plan: Backend-Only WebRTC (sin JavaScript en cliente)

> **Decisión arquitectónica**: Todo el WebRTC se ejecuta en el servidor Node.js
> mediante `node-datachannel`. El navegador solo utiliza formularios HTML nativos
> (`<form method="POST">`) y `<meta http-equiv="refresh">` para polling. **Cero
> JavaScript en el cliente.**
>
> **Motivo**: Los mantenedores de Oasis rechazaron el PR con JS en cliente.
> La filosofía de Oasis es "server-rendered HTML, no client-side JS".
> Además, JS en localhost expone a CSRF desde otras pestañas.
>
> **Media streams (audio/video)**: Oasis es una app local — Node.js corre en la
> máquina del usuario. Por tanto, ffmpeg tiene acceso directo al micrófono y la
> cámara del sistema operativo. La captura, codificación y transporte de media
> se realizan enteramente en Node.js. El navegador reproduce vía elementos HTML
> nativos: `<img>` para MJPEG (vídeo) y `<audio>` para streaming (audio).
> **No se necesita `getUserMedia` ni JavaScript para media.**

---

> ### 🔍 Convención de revisión
>
> Los bloques marcados con **⚠️ REVISIÓN** contienen observaciones de una
> auditoría técnica externa. Cada bloque:
> 1. Identifica el contenido original que precede al warning.
> 2. Explica la objeción o mejora propuesta.
> 3. Propone una alternativa concreta y validada.
>
> El contenido original **no se elimina**: permanece tal cual para trazabilidad.
> Las propuestas son adiciones, no parches.

---

## Índice

1. [Arquitectura general](#arquitectura-general)
2. [Arquitectura de media streams](#arquitectura-de-media-streams)
3. [Flujo de datos detallado](#flujo-de-datos-detallado)
4. [Estados de la vista](#estados-de-la-vista)
5. [ICE / STUN / TURN](#ice--stun--turn)
6. [Steps (Phases)](#steps)
7. [Ficheros relevantes](#ficheros-relevantes)
8. [Detalle de implementación](#detalle-de-implementación)
9. [Verificación](#verificación)
10. [Decisiones](#decisiones)
11. [Consideraciones futuras](#consideraciones-futuras)

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
│  <form method="POST" action="/webrtc/*">│  <img src="/webrtc/media/video"> (MJPEG)
│  <audio src="/webrtc/media/audio">      │  <audio autoplay> (streaming nativo)
├─────────────────────────────────────────┤
│        webrtc_view.js                   │  Vista hyperaxe, renderiza según estado
│  webrtcView(state, data)                │  Patrón: cipher_view.js
├─────────────────────────────────────────┤
│        backend.js (rutas)               │  GET /webrtc + POST /webrtc/*
│  koaBody() + ctx.request.body           │  GET /webrtc/media/{video,audio} streams
├─────────────────────────────────────────┤
│        webrtc_model.js                  │  Estado en memoria + node-datachannel
│  createOffer(), processOffer(),         │  Patrón: cipher_model.js (stateless)
│  processAnswer(), sendMessage(), etc.   │  + tasks_model.js (factory con cooler)
├─────────────────────────────────────────┤
│        media_capture.js                 │  ffmpeg child_process: captura mic/cam
│  startCapture(devices), stopCapture()   │  Encode → RTP → node-datachannel Track
│  startPlayback(), getVideoStream()      │  Decode RTP remoto → MJPEG/PCM HTTP
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
| Audio/Video | getUserMedia + `<video>` | ffmpeg captura mic/cam local → node-datachannel media tracks → browser reproduce vía `<img>` MJPEG + `<audio>` streaming (sin JS) |
| Estado de sesión | Variables JS en el navegador | Variables en memoria del proceso Node.js |
| Seguridad CSRF | Vulnerable (JS en localhost) | Protegido (referer validation + CSP form-action) |
| Complejidad cliente | ~370 líneas JS (webrtc-app.js) | 0 líneas JS |

> ⚠️ **REVISIÓN — Endurecimiento CSRF: Referer estricto + SameSite cookies**
>
> La tabla anterior cita "referer validation + CSP form-action" como protección
> CSRF. Esto es correcto pero incompleto. Un atacante en otra pestaña podría
> ejecutar un formulario cross-origin si el navegador no envía Referer (algunos
> proxies lo eliminan).
>
> **Propuesta — defensa en profundidad**:
>
> 1. **Referer check estricto**: en el middleware Koa, rechazar todo POST a
>    `/webrtc/*` cuyo `Referer` header no sea exactamente `http://localhost:PORT`
>    o `http://127.0.0.1:PORT`. Si el header está ausente, rechazar también
>    (política estricta, no permisiva):
>    ```js
>    // En backend.js, antes de las rutas /webrtc POST:
>    router.use('/webrtc', (ctx, next) => {
>      if (ctx.method === 'POST') {
>        const ref = ctx.get('referer') || '';
>        const origin = `http://localhost:${ctx.app.port}`;
>        const originAlt = `http://127.0.0.1:${ctx.app.port}`;
>        if (!ref.startsWith(origin) && !ref.startsWith(originAlt)) {
>          ctx.status = 403;
>          ctx.body = 'Forbidden: invalid referer';
>          return;
>        }
>      }
>      return next();
>    });
>    ```
>
> 2. **Cookie `SameSite=Strict`**: si Oasis ya usa cookies de sesión (o si se
>    introduce una para el zombie timeout), configurarlas con `SameSite=Strict`.
>    Esto impide que el navegador envíe la cookie en requests cross-origin
>    (incluyendo formularios desde otras pestañas/dominios):
>    ```js
>    ctx.cookies.set('oasis-session', value, {
>      httpOnly: true,
>      sameSite: 'strict',
>      secure: false  // localhost no usa HTTPS
>    });
>    ```
>
> 3. **CSP `form-action 'self'`**: ya existente en Oasis, refuerza que los
>    formularios solo pueden hacer POST a `'self'`. Mantener sin cambios.
>
> Las tres capas son complementarias: Referer bloquea en el servidor, SameSite
> bloquea en el navegador, CSP bloquea en el DOM. Un atacante necesitaría
> saltarse las tres simultáneamente.

### Transporte de señalización

| Transporte | Escenario | Tipo msg SSB | Requisitos |
|---|---|---|---|
| **manual** | Testing, cualquier red | N/A | Ninguno (ya funciona) |
| **ssb-conn** | Peers SSB conectados | `webrtc-signal` privado | ssb-private, peers online |
| **ssb-lan** | Misma LAN | `webrtc-signal` privado | ssb-lan, red local |
| **socket.io** | Peers remotos, pub relay | `post` privado o directo | Pub con socket.io |

---

## Arquitectura de media streams

> **Premisa clave**: Oasis es una **app local** — el proceso Node.js corre en la
> misma máquina que el usuario. Por tanto, `ffmpeg` tiene acceso directo al
> micrófono y la cámara del sistema operativo, exactamente igual que un navegador
> tendría acceso vía `getUserMedia()`. La diferencia es que no necesitamos
> JavaScript en el cliente para nada: ni para capturar, ni para codificar, ni
> para reproducir.

### Por qué funciona sin JS en el navegador

| Función | Navegador tradicional (JS) | Oasis backend-only (sin JS) |
|---|---|---|
| **Captura** de cámara/mic | `getUserMedia()` en JS | `ffmpeg -f avfoundation\|v4l2\|dshow` en Node.js |
| **Codificación** | WebRTC stack interno del browser | ffmpeg encode (VP8/H.264 + Opus) |
| **Transporte** | RTCPeerConnection media tracks | `node-datachannel` media tracks (mismo protocolo WebRTC) |
| **Reproducción vídeo** | `<video>` con `srcObject = stream` (JS) | `<img src="/webrtc/media/video">` con MJPEG stream (HTML nativo) |
| **Reproducción audio** | `<audio>` con `srcObject = stream` (JS) | `<audio src="/webrtc/media/audio" autoplay>` con HTTP chunked (HTML nativo) |

### Pipeline completo

```
  Peer A (máquina local)                                           Peer B (máquina remota)
  ═════════════════════                                           ══════════════════════

  ┌──────────────────┐
  │  Mic / Cámara OS   │  Hardware del usuario
  └────────┬─────────┘
           │
  ┌────────┴─────────┐
  │  ffmpeg (captura)  │  child_process.spawn()
  │  -f avfoundation   │  macOS: avfoundation
  │  -i "0:0"          │  Linux: v4l2 + pulse
  │  -c:v vp8/h264     │  Windows: dshow
  │  -c:a opus         │
  │  -f rtp            │  Salida: paquetes RTP
  └────────┬─────────┘
           │ RTP (UDP localhost o pipe)
  ┌────────┴─────────┐
  │ media_capture.js  │  Orquesta ffmpeg + alimenta tracks
  └────────┬─────────┘
           │ RTP packets
  ┌────────┴─────────┐
  │ node-datachannel  │  pc.addTrack() + track.sendMessage(rtp)
  │ Audio/Video Track │
  └────────┬─────────┘
           │ WebRTC (DTLS-SRTP, ICE)
           ║
           ║ ========= Internet / LAN =========
           ║
  ┌────────┴─────────┐
  │ node-datachannel  │  track.onMessage(rtp)
  │ Audio/Video Track │
  └────────┬─────────┘
           │ RTP packets
  ┌────────┴─────────┐
  │ media_capture.js  │  Recibe RTP, alimenta ffmpeg decoder
  └────┬──────┬───────┘
       │          │
       │ MJPEG    │ PCM/OGG
       │          │
  ┌────┴───┐  ┌───┴─────┐
  │ ffmpeg  │  │ ffmpeg   │  Decodifica RTP → formatos HTTP
  │ decode  │  │ decode   │
  │ →MJPEG │  │ →PCM/OGG│
  └────┬───┘  └───┬─────┘
       │          │
  ┌────┴──────────┴─────┐
  │ HTTP streaming endpoints │  Koa routes en backend.js
  │ GET /webrtc/media/video  │  Content-Type: multipart/x-mixed-replace
  │ GET /webrtc/media/audio  │  Content-Type: audio/ogg (chunked transfer)
  └────────┬─────────┬─────┘
           │         │
  ┌────────┴─────────┴─────┐
  │ Navegador (sin JS)        │
  │ <img src=".../video">      │  MJPEG: el browser renderiza frames
  │ <audio src=".../audio"     │  Audio: el browser reproduce streaming
  │        autoplay controls>  │  Todo nativo, cero JavaScript
  └───────────────────────────┘
```

> ⚠️ **REVISIÓN — Aceleración por hardware en el encoding de transporte**
>
> El pipeline anterior muestra `-c:v vp8` como codec de transporte. VP8 en
> software consume CPU significativa (~30-50% de un core a 640x480@15fps).
>
> **Propuesta**: usar codificadores H.264 acelerados por hardware donde estén
> disponibles. Esto reduce la carga de CPU drásticamente (~5%) y deja margen
> para la decodificación MJPEG simultánea:
>
> | OS | Encoder HW | Flag ffmpeg | Fallback SW |
> |---|---|---|---|
> | **macOS** | VideoToolbox | `-c:v h264_videotoolbox` | `-c:v libx264 -preset ultrafast` |
> | **Linux** (Intel/AMD) | VA-API | `-c:v h264_vaapi` | `-c:v libx264 -preset ultrafast` |
> | **Linux** (NVIDIA) | NVENC | `-c:v h264_nvenc` | `-c:v libx264 -preset ultrafast` |
> | **Windows** | MediaFoundation | `-c:v h264_mf` | `-c:v libx264 -preset ultrafast` |
>
> **Nota importante**: la aceleración HW aplica al codec de **transporte WebRTC**
> (H.264 sobre DTLS-SRTP), no al formato **HTTP de salida** (MJPEG para `<img>`).
> El decoder remoto sigue emitiendo MJPEG para compatibilidad con `<img>`. El
> beneficio es reducir CPU en el peer que **envía** vídeo.
>
> **Detección en `media_capture.js`**: ejecutar `ffmpeg -encoders 2>/dev/null |
> grep h264` al inicio y elegir el encoder más eficiente disponible, con fallback
> a `libx264 -preset ultrafast` (software) si no hay HW.
>
> **Además — piping directo por stdout**: en vez de RTP sobre UDP localhost
> (`rtp://127.0.0.1:PORT`), se puede usar piping directo:
> ```
> ffmpeg -f avfoundation -i "default:default" -c:v h264_videotoolbox -f rtp pipe:1
> ```
> Esto elimina la necesidad de un socket UDP local y simplifica el wiring con
> `node-datachannel`. El child_process.stdout es un readable stream que se
> alimenta directamente a `track.sendMessage()`.

### Captura por sistema operativo

ffmpeg detecta los dispositivos de entrada según el OS. `media_capture.js` auto-
detecta la plataforma (`process.platform`) y usa el backend correcto:

| OS | Backend ffmpeg | Comando captura cámara | Comando captura mic | Deteccdión de dispositivos |
|---|---|---|---|---|
| **macOS** | `avfoundation` | `ffmpeg -f avfoundation -i "0" -c:v vp8 -f rtp rtp://...` | `ffmpeg -f avfoundation -i ":0" -c:a libopus -f rtp rtp://...` | `ffmpeg -f avfoundation -list_devices true -i ""` |
| **Linux** | `v4l2` + `pulse` | `ffmpeg -f v4l2 -i /dev/video0 -c:v vp8 -f rtp rtp://...` | `ffmpeg -f pulse -i default -c:a libopus -f rtp rtp://...` | `v4l2-ctl --list-devices` + `pactl list sources` |
| **Windows** | `dshow` | `ffmpeg -f dshow -i video="Camera" -c:v vp8 -f rtp rtp://...` | `ffmpeg -f dshow -i audio="Mic" -c:a libopus -f rtp rtp://...` | `ffmpeg -f dshow -list_devices true -i dummy` |

> ⚠️ **REVISIÓN — Matriz de captura: inputs por defecto y variantes de audio**
>
> La tabla anterior usa `"0"` / `":0"` (avfoundation) y `/dev/video0` (Linux).
> Estos índices son frágiles: cambian si se conecta un segundo dispositivo.
>
> **Correcciones propuestas**:
>
> 1. **macOS**: usar `"default:default"` en lugar de `"0:0"`. avfoundation
>    resuelve el dispositivo por defecto del sistema sin depender del índice:
>    ```
>    ffmpeg -f avfoundation -i "default:default" -c:v ... -c:a ...
>    ```
>
> 2. **Linux — audio**: la tabla muestra `-f pulse` (PulseAudio). En distros
>    modernas PulseAudio corre sobre PipeWire, pero en sistemas mínimos (servers,
>    containers) puede no existir. Considerar fallback a ALSA:
>    ```
>    # PulseAudio/PipeWire (preferido, más común en desktops):
>    ffmpeg -f pulse -i default ...
>    # ALSA fallback (sistemas sin PulseAudio):
>    ffmpeg -f alsa -i default ...
>    ```
>    `media_capture.js` debería probar `pactl info` para detectar PulseAudio;
>    si falla, usar ALSA.
>
> 3. **Enumeración de dispositivos al arranque**: ejecutar `listDevices()` una
>    sola vez al cargar el módulo WebRTC (no en cada request). Cachear el
>    resultado en `state.media.availableDevices`. Esto permite:
>    - Mostrar selector `<select name="camera">` en la vista idle (futuro)
>    - Detectar "no hay cámara/mic" antes de intentar la captura
>    - Evitar latencia de spawn ffmpeg en cada request
>
> **Tabla corregida (propuesta)**:
>
> | OS | Input cámara | Input mic | Detección |
> |---|---|---|---|
> | **macOS** | `-i "default:default"` | (incluido en el mismo input) | `-list_devices true -i ""` |
> | **Linux** | `-f v4l2 -i /dev/video0` | `-f pulse -i default` (fallback: `-f alsa -i default`) | `v4l2-ctl --list-devices` + `pactl list sources` (fallback: `arecord -l`) |
> | **Windows** | `-f dshow -i video="Camera"` | `-f dshow -i audio="Mic"` | `-list_devices true -i dummy` |

### Reproducción en el navegador sin JavaScript

#### Vídeo: MJPEG sobre `<img>`

`multipart/x-mixed-replace` es un content-type estándar que los navegadores
soportan nativamente en tags `<img>`. Cada "parte" es un frame JPEG. El browser
reemplaza la imagen continuamente, creando la ilusión de vídeo.

```
GET /webrtc/media/video HTTP/1.1

HTTP/1.1 200 OK
Content-Type: multipart/x-mixed-replace; boundary=frame

--frame
Content-Type: image/jpeg
Content-Length: 12345

<JPEG data>
--frame
Content-Type: image/jpeg
Content-Length: 12346

<JPEG data>
... (infinito mientras la conexión esté abierta)
```

A nivel de vista:
```html
<img src="/webrtc/media/video" class="webrtc-video" alt="Remote video">
```

**Limitaciones de MJPEG**:
- Mayor ancho de banda que H.264/VP8 (×10 aprox.) — aceptable en LAN
- No tiene audio integrado — se transporta por separado
- Latencia típica: 100-300ms (excelente para videoconferencia)
- Calidad ajustable vía `-q:v` de ffmpeg (2=alta, 10=baja, 5=balance)

#### Audio: Streaming HTTP sobre `<audio>`

```html
<audio src="/webrtc/media/audio" autoplay controls></audio>
```

El endpoint sirve audio codificado con `Transfer-Encoding: chunked`.
Formatos posibles (por orden de preferencia):

| Formato | Latencia | Soporte browser | Calidad | Comando ffmpeg |
|---|---|---|---|---|
| **OGG/Opus** | ~200ms | Chrome, Firefox | Excelente | `-c:a libopus -f ogg` |
| **MP3** (CBR) | ~500ms | Universal | Buena | `-c:a libmp3lame -f mp3` |
| **WAV** (PCM) | ~50ms | Universal | Máxima | `-c:a pcm_s16le -f wav` |

**Recomendación**: OGG/Opus como default (buen balance latencia/calidad/ancho de
banda). Fallback a MP3 si el browser no soporta Opus (Edge antiguo, Safari <15).

> ⚠️ **REVISIÓN — WAV/PCM como default en localhost**
>
> La recomendación anterior elige OGG/Opus como formato por defecto. Para
> conexiones **remotas** (Internet/LAN), es la elección correcta: ~48 kbps para
> calidad excelente.
>
> Sin embargo, Oasis es primariamente una **app local** (navegador y servidor en
> la misma máquina). En localhost, el ancho de banda es infinito y la prioridad
> es minimizar latencia. WAV/PCM tiene ~50ms de latencia vs. ~200ms de OGG/Opus,
> porque no necesita decodificación — el browser reproduce los samples crudos.
>
> **Propuesta**: selección condicional del formato según el escenario:
>
> | Escenario | Formato recomendado | Motivo |
> |---|---|---|
> | **Localhost** (ambos peers misma máquina) | **WAV/PCM** | Latencia mínima (~50ms), BW irrelevante (~1.4 Mbps, todo local) |
> | **LAN** (misma red) | **OGG/Opus** o **WAV/PCM** | LAN soporta 1.4 Mbps sin problema, pero Opus es más eficiente |
> | **Internet** (STUN/TURN) | **OGG/Opus** | Ancho de banda limitado — 1.4 Mbps de PCM inviable por TURN |
>
> **Implementación**: `media_capture.js` acepta un parámetro `audioFormat` en
> `startDecoder()`. El modelo elige según si la conexión usa TURN (remoto) o
> candidato host/srflx (local/LAN). Valor por defecto: `'wav'` para la primera
> versión (solo se usa en localhost). Se expone en `oasis-config.json` →
> `webrtcAudioFormat: "wav" | "ogg" | "mp3"`.
>
> **Coste**: WAV/PCM 16-bit 44.1kHz stereo = ~1.4 Mbps. Mono 16kHz (suficiente
> para voz) = ~256 kbps. Incluso reducido, irrelevante en localhost/LAN.

### Modos de llamada

El selector de modo en el estado `idle` determina qué tracks se negocian en SDP:

| Modo | DataChannel | Audio Track | Video Track | Vista `connected` |
|---|---|---|---|---|
| `data` | ✅ | ❌ | ❌ | Solo chat |
| `audio` | ✅ | ✅ | ❌ | Chat + `<audio>` |
| `video` | ✅ | ✅ | ✅ | Chat + `<audio>` + `<img>` MJPEG |
| `av` | ✅ | ✅ | ✅ | Chat + `<audio>` + `<img>` MJPEG (alias de video) |

El modo se incluye en `state.mode` y viaja en el SDP. El respondedor detecta
automáticamente qué tracks ofrece el creador y activa los suyos en reciprocidad.

### Controles de media (sin JS)

Sin JavaScript no hay toggles instantáneos. Los controles se implementan como
formularios POST que el backend procesa:

```html
<!-- Mute mic -->
<form method="POST" action="/webrtc/media/mic/toggle">
  <button type="submit">🎙 Mute Mic</button>
</form>

<!-- Hide cam -->
<form method="POST" action="/webrtc/media/cam/toggle">
  <button type="submit">📷 Hide Cam</button>
</form>
```

`media_capture.js` implementa mute/unmute pausando el pipe de ffmpeg (envía
silencio/negro) sin cerrar la conexión WebRTC. Esto evita renegociación SDP.

### Requisito: ffmpeg instalado

ffmpeg es un requisito del sistema para media streams. El modelo verifica su
presencia al intentar activar audio/video:

```js
const { execSync } = require('child_process');
function checkFfmpeg() {
  try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true; }
  catch { return false; }
}
```

Si ffmpeg no está instalado, el modo `data` (solo chat) sigue funcionando.
Los modos `audio`/`video` muestran un mensaje de error indicando que ffmpeg
es necesario, con instrucciones de instalación por OS:
- macOS: `brew install ffmpeg`
- Linux: `sudo apt install ffmpeg` / `sudo dnf install ffmpeg`
- Windows: `choco install ffmpeg` / descarga directa

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
| `idle` | GET /webrtc (sin sesión) o POST /disconnect | Botones "Crear sala" / "Unirse", selector transporte, selector modo (data/audio/video) | `<form POST /webrtc/create>`, link a formulario join | No |
| `offer-created` | POST /webrtc/create | Textarea readonly con offer code, formulario para pegar answer | `<form POST /webrtc/answer>` | No |
| `answer-created` | POST /webrtc/join | Textarea readonly con answer code, mensaje "esperando conexión..." | `<form POST /webrtc/disconnect>` | Sí (5s) — para detectar cuando DataChannel abre |
| `waiting-answer` | POST /webrtc/create (SSB) | Mensaje "Esperando respuesta de @peer..." | `<form POST /webrtc/disconnect>` | Sí (5s) — para detectar answer vía pull-stream |
| `connected` | DataChannel `onOpen` callback | Chat + media (según modo) + controles + botón desconectar. **mode=data**: solo chat. **mode=audio**: chat + `<audio>` stream. **mode=video**: chat + `<audio>` + `<img>` MJPEG + controles mic/cam. | `<form POST /webrtc/chat/send>`, `<form POST /webrtc/media/mic/toggle>`, `<form POST /webrtc/media/cam/toggle>`, `<form POST /webrtc/disconnect>` | Sí (5s) — polling mensajes entrantes |
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
      <label>Modo:</label>
      <select name="mode">
        <option value="data">Solo datos (chat)</option>
        <option value="audio">Audio + chat</option>
        <option value="video">Audio/Vídeo + chat</option>
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

#### Estado `connected` (chat + media)

```html
<meta http-equiv="refresh" content="5">
<section>
  <div class="card">
    <h3>☍ Conectado</h3>
    <p>Estado: connected | DataChannel: open | Modo: video</p>
  </div>

  <!-- ═══ Panel de media (solo si mode=audio o mode=video) ═══ -->
  <div class="card">
    <h3>▶ Media</h3>
    <div class="webrtc-video-grid">
      <!-- Vídeo local: preview de lo que se envía (mode=video) -->
      <div class="webrtc-video-box">
        <label>Local</label>
        <img src="/webrtc/media/video/local" class="webrtc-video" alt="Local video">
      </div>
      <!-- Vídeo remoto: decodificado del RTP entrante (mode=video) -->
      <div class="webrtc-video-box">
        <label>Remote</label>
        <img src="/webrtc/media/video/remote" class="webrtc-video" alt="Remote video">
      </div>
    </div>

    <!-- Audio remoto: solo si mode=audio o mode=video -->
    <audio src="/webrtc/media/audio" autoplay controls></audio>

    <!-- Controles media — formularios POST, sin JS -->
    <div class="webrtc-media-controls">
      <form method="POST" action="/webrtc/media/mic/toggle" style="display:inline">
        <button type="submit">🎙 Mute Mic</button>
      </form>
      <form method="POST" action="/webrtc/media/cam/toggle" style="display:inline">
        <button type="submit">📷 Hide Cam</button>
      </form>
    </div>
  </div>

  <!-- ═══ Chat (siempre, en todos los modos) ═══ -->
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

> ⚠️ **REVISIÓN — `<iframe>` para preservar scroll, foco e input del chat**
>
> El diseño anterior usa `<meta http-equiv="refresh" content="5">` en la página
> completa. Esto recarga **todo**: el formulario de chat pierde el texto que el
> usuario estaba escribiendo, el scroll de mensajes vuelve arriba, y si había
> media streams (`<img>` MJPEG, `<audio>`), se cierran y reconectan (~100-200ms
> de interrupción visible).
>
> **Propuesta**: mover el panel de chat a un `<iframe>` interno. Solo el iframe
> lleva `<meta refresh>`. La página padre permanece estática (sin refresh):
>
> ```html
> <!-- Página padre /webrtc — SIN meta-refresh -->
> <section>
>   <div class="card">
>     <h3>☍ Conectado</h3>
>     <p>Estado: connected | DataChannel: open | Modo: video</p>
>   </div>
>
>   <!-- Media panel: NO se recarga, streams MJPEG/audio permanecen abiertos -->
>   <div class="card">
>     <h3>▶ Media</h3>
>     <img src="/webrtc/media/video/local" class="webrtc-video" alt="Local">
>     <img src="/webrtc/media/video/remote" class="webrtc-video" alt="Remote">
>     <audio src="/webrtc/media/audio" autoplay controls></audio>
>     <!-- Controles media siguen como formularios POST normales -->
>   </div>
>
>   <!-- Chat: iframe con su propio meta-refresh -->
>   <iframe
>     src="/webrtc/chat"
>     name="chatframe"
>     class="webrtc-chat-frame"
>     style="width:100%; height:400px; border:1px solid #ccc;">
>   </iframe>
>
>   <!-- Disconnect sigue en la página padre -->
>   <form method="POST" action="/webrtc/disconnect">
>     <button type="submit">Desconectar</button>
>   </form>
> </section>
> ```
>
> ```html
> <!-- Endpoint GET /webrtc/chat — renderizado DENTRO del iframe -->
> <meta http-equiv="refresh" content="3">
> <div class="webrtc-chat-messages">
>   <div class="webrtc-chat-msg"><span class="webrtc-chat-you">You:</span> hola</div>
>   <div class="webrtc-chat-msg"><span class="webrtc-chat-peer">Peer:</span> hola!</div>
> </div>
> <form method="POST" action="/webrtc/chat/send" target="chatframe">
>   <input type="text" name="message" placeholder="Escribe..." autocomplete="off">
>   <button type="submit">Enviar</button>
> </form>
> ```
>
> **Ventajas**:
> - El scroll de chat se preserva (solo el iframe recarga, no la página)
> - El texto en el input del formulario **no se pierde** al hacer refresh
>   (el refresh del iframe recarga su contenido, pero el campo del formulario
>   se puede preservar con `target="chatframe"` — el POST va al iframe, no a
>   la página padre)
> - Los streams MJPEG y `<audio>` **nunca se interrumpen** (viven en la página
>   padre que no recarga)
> - Compatible al 100% con la filosofía "sin JS": `<iframe>`, `<meta refresh>`,
>   y `target` son HTML puro
> - Se puede reducir el refresh interval a 2-3s sin penalizar la UX (solo recarga
>   el iframe ligero, no todo el DOM)
>
> **Impacto en implementación**:
> - Nueva ruta `GET /webrtc/chat` que renderiza solo el panel de chat (sin
>   template/layout wrapper — HTML minimal para el iframe)
> - `POST /webrtc/chat/send` redirige a `GET /webrtc/chat` (no a `GET /webrtc`)
> - `webrtc_view.js` renderiza la página padre con el `<iframe>` en vez del
>   chat inline
> - CSS: añadir `.webrtc-chat-frame` (dimensiones, scroll interno)
>
> **Nota**: el `target="chatframe"` en el formulario de envío hace que la
> respuesta del POST (redirect a GET /webrtc/chat) se cargue dentro del iframe.
> El usuario escribe, pulsa Enter/Enviar, y solo el iframe recarga mostrando el
> mensaje nuevo. El resto de la página permanece intacto.

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
     let state = { phase: 'idle', pc: null, dc: null, offerCode: '', answerCode: '', messages: [], error: null, mode: 'data', media: null };
     return { createOffer, processOffer, processAnswer, sendMessage, getState, getMessages, disconnect, startMedia, stopMedia, toggleMic, toggleCam, getVideoStream, getAudioStream };
   };
   ```
   **Funciones del modelo:**
   - `createOffer(transport, peerId, mode)` — Crea PeerConnection + DataChannel (+ media tracks si `mode` != 'data'), genera offer, retorna offerCode. Si `transport='ssb'`, publica offer vía `sbot.webrtc.offer()`.
   - `processOffer(offerCode)` — Decodifica offer, crea PeerConnection, setRemoteDescription, genera answer. Auto-detecta si el offer incluye media tracks y añade los suyos en reciprocidad.
   - `processAnswer(answerCode)` — Decodifica answer, setRemoteDescription. DataChannel se abre vía callback.
   - `sendMessage(text)` — `dc.sendMessage(text)`, push a `state.messages[]`.
   - `getState()` — Retorna `{ phase, offerCode, answerCode, error, mode, micMuted, camHidden }` (sin exponer pc/dc).
   - `getMessages()` — Retorna `state.messages[]` y opcionalmente marca como leídos.
   - `disconnect()` — Para ffmpeg (si activo), cierra dc + pc, resetea state a idle.
   - `startMedia()` — Lanza ffmpeg para captura de mic/cam según `state.mode`. Alimenta RTP a los tracks de `node-datachannel`. Inicia ffmpeg decoder para media remoto entrante.
   - `stopMedia()` — Mata procesos ffmpeg (captura + decodificación).
   - `toggleMic()` — Pausa/reanuda pipe de audio a ffmpeg (envía silencio sin cerrar track).
   - `toggleCam()` — Pausa/reanuda pipe de vídeo a ffmpeg (envía negro sin cerrar track).
   - `getVideoStream(type)` — Retorna readable stream MJPEG para `type='local'|'remote'`. Usado por la ruta GET `/webrtc/media/video/:type`.
   - `getAudioStream()` — Retorna readable stream OGG/Opus del audio remoto. Usado por GET `/webrtc/media/audio`.
   - `startListening()` — (SSB) Inicia pull-stream `sbot.webrtc.listen()` para señales entrantes.

2. **Gestión de estado en memoria** — El estado vive en el closure del módulo:
   - Solo una conexión WebRTC a la vez (Oasis es single-user)
   - Si el proceso se reinicia, se pierde el estado → `phase: 'idle'`
   - Los mensajes se acumulan en un array en memoria (no persisten en SSB)
   - Máximo ~1000 mensajes en buffer, FIFO si se excede

   > ⚠️ **REVISIÓN — Limpieza de sesiones zombie y concurrencia de pestañas**
   >
   > El punto anterior asume que el usuario siempre desconecta limpiamente
   > (`POST /webrtc/disconnect`). En la práctica, el usuario puede:
   > - Cerrar la pestaña del navegador sin pulsar "Desconectar"
   > - Perder conectividad de red
   > - Dejar la sesión abierta indefinidamente
   >
   > En estos casos, los procesos ffmpeg y el PeerConnection se quedan huérfanos
   > (zombies), consumiendo CPU y manteniendo el estado en `connected` para
   > siempre.
   >
   > **Propuesta — timeout de inactividad**:
   > - El modelo registra `state.lastHttpActivity = Date.now()` en cada request
   >   a rutas `/webrtc/*` (GET o POST).
   > - Un `setInterval` cada 30s comprueba: si `Date.now() - lastHttpActivity >
   >   ZOMBIE_TIMEOUT_MS` (ej. 60000ms = 1 minuto), ejecuta `disconnect()`
   >   automáticamente.
   > - Esto mata ffmpeg, cierra PeerConnection, y resetea a `idle`.
   > - El meta-refresh cada 5s actúa como "heartbeat" — si el usuario tiene la
   >   pestaña abierta, `lastHttpActivity` se renueva cada 5s.
   > - Configurable: `oasis-config.json` → `webrtcZombieTimeoutMs: 60000`
   >
   > **Propuesta — sesiones concurrentes (múltiples pestañas)**:
   > - Oasis es single-user pero el usuario puede abrir `/webrtc` en 2+ pestañas.
   > - Actualmente, ambas pestañas ven el mismo estado (singleton en closure).
   > - Problema: si una pestaña hace `POST /webrtc/disconnect` mientras la otra
   >   muestra `connected`, la segunda queda desincronizada hasta su refresh.
   > - Opción conservadora (recomendada): no cambiar nada — el singleton es
   >   correcto para single-user. La segunda pestaña simplemente refleja el
   >   mismo estado tras su próximo refresh.
   > - Opción avanzada: un cookie `sessionId` que identifica la pestaña activa.
   >   Solo la pestaña que creó la sesión puede hacer `disconnect`. Las otras
   >   son read-only. Complejidad adicional, beneficio marginal para single-user.

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
   GET  /webrtc                    → Lee estado del modelo, renderiza webrtcView(state, data)
   POST /webrtc/create             → webrtcModel.createOffer(transport, peerId, mode), re-render
   POST /webrtc/join               → webrtcModel.processOffer(offerCode), re-render
   POST /webrtc/answer             → webrtcModel.processAnswer(answerCode), redirect GET /webrtc
   POST /webrtc/chat/send          → webrtcModel.sendMessage(message), redirect GET /webrtc
   POST /webrtc/media/mic/toggle   → webrtcModel.toggleMic(), redirect GET /webrtc
   POST /webrtc/media/cam/toggle   → webrtcModel.toggleCam(), redirect GET /webrtc
   POST /webrtc/disconnect         → webrtcModel.disconnect(), redirect GET /webrtc
   GET  /webrtc/media/video/local  → streaming MJPEG del vídeo local (preview)
   GET  /webrtc/media/video/remote → streaming MJPEG del vídeo remoto
   GET  /webrtc/media/audio        → streaming OGG/Opus del audio remoto
   ```

   **Rutas de media streaming** (long-lived HTTP responses):
   ```js
   .get('/webrtc/media/video/:type', async (ctx) => {
     if (!checkMod(ctx, 'webrtcMod')) { ctx.status = 403; return; }
     const stream = webrtcModel.getVideoStream(ctx.params.type); // 'local' | 'remote'
     if (!stream) { ctx.status = 404; return; }
     ctx.type = 'multipart/x-mixed-replace; boundary=frame';
     ctx.body = stream; // readable stream que emite frames MJPEG
   })
   .get('/webrtc/media/audio', async (ctx) => {
     if (!checkMod(ctx, 'webrtcMod')) { ctx.status = 403; return; }
     const stream = webrtcModel.getAudioStream();
     if (!stream) { ctx.status = 404; return; }
     ctx.type = 'audio/ogg';
     ctx.body = stream; // readable stream de audio OGG/Opus
   })
   ```

   **Patrón de ruta** (ejemplo para `/webrtc/create` con mode):
   ```js
   .post('/webrtc/create', koaBody(), async (ctx) => {
     if (!checkMod(ctx, 'webrtcMod')) { ctx.redirect('/modules'); return; }
     const { transport, peerId, mode } = ctx.request.body;
     await webrtcModel.createOffer(transport, peerId, mode || 'data');
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
   - `mode`: whitelist `['data', 'audio', 'video']`
   - `peerId`: si transport=ssb, validar formato `@xxx.ed25519`
   - Rutas de media streaming: validar que `state.phase === 'connected'` y `state.mode` incluye el tipo solicitado

### Phase 4: Vista (webrtc_view.js) — reescritura completa

9. **Firma de la vista** — Recibe estado y datos, renderiza condicionalmente:
   ```js
   const webrtcView = (phase = 'idle', data = {}) => {
     // phase: 'idle' | 'offer-created' | 'answer-created' | 'waiting-answer' | 'connected' | 'error'
     // data: { offerCode, answerCode, messages, error, transport, peerId, status, mode, micMuted, camHidden, hasFfmpeg }
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

    // Panel de media — solo si mode != 'data' y phase === 'connected'
    const mediaPanel = (phase === 'connected' && data.mode !== 'data')
      ? div({ class: "card" },
          h3("▶ Media"),
          // Vídeo: <img> con MJPEG stream (solo si mode === 'video')
          data.mode === 'video' ? div({ class: "webrtc-video-grid" },
            div({ class: "webrtc-video-box" },
              label("Local"),
              img({ src: "/webrtc/media/video/local", class: "webrtc-video", alt: "Local" })
            ),
            div({ class: "webrtc-video-box" },
              label("Remote"),
              img({ src: "/webrtc/media/video/remote", class: "webrtc-video", alt: "Remote" })
            )
          ) : null,
          // Audio: <audio> con streaming HTTP (mode=audio o mode=video)
          audio({ src: "/webrtc/media/audio", autoplay: true, controls: true }),
          // Controles: formularios POST
          div({ class: "webrtc-media-controls" },
            form({ method: "POST", action: "/webrtc/media/mic/toggle", style: "display:inline" },
              button({ type: "submit" }, data.micMuted ? "🎙 Unmute" : "🎙 Mute")
            ),
            data.mode === 'video'
              ? form({ method: "POST", action: "/webrtc/media/cam/toggle", style: "display:inline" },
                  button({ type: "submit" }, data.camHidden ? "📷 Show" : "📷 Hide")
                )
              : null
          )
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

    **Nota sobre meta-refresh y media streams**: El `<meta refresh>` recarga la
    página completa cada 5s. Las conexiones HTTP de los streams MJPEG/audio se
    cierran y reabren. Esto es aceptable: ffmpeg sigue capturando/decodificando
    en background, y el browser reconecta al endpoint inmediatamente. La latencia
    de reconexión es ~100ms porque el stream ya está preparado en el servidor.

    > ⚠️ **REVISIÓN — Véase propuesta `<iframe>`**: La sección "Estado connected"
    > incluye una propuesta para mover el chat a un `<iframe>` con su propio
    > meta-refresh. Si se adopta, el meta-refresh **no se aplica** a la página
    > padre — solo al iframe del chat. Los streams MJPEG/audio dejan de
    > interrumpirse por completo. El punto 11 simplificaría a: "Meta-refresh
    > solo en el iframe de chat (`GET /webrtc/chat`), no en la página principal."

12. **Sin `<script>` tag** — La línea actual que inyecta `webrtc-app.js` se elimina:
    ```js
    // ELIMINAR esta línea:
    // + '<script src="/js/webrtc-app.js"></script>';
    ```

13. **CSS** — Se mantiene `webrtc.css` (105 líneas, prefijo `webrtc-*`), pero:
    - Eliminar `.webrtc-hidden` (ya no hay toggle JS de visibilidad)
    - Eliminar estilos de elementos que ya no existen (`#btn-toggle-mic`, `#btn-toggle-cam`, etc.)
    - Mantener `.webrtc-video-grid`, `.webrtc-video-box`, `.webrtc-video` (ahora usan `<img>` en vez de `<video>`)
    - Mantener `.webrtc-media-controls` para los botones de mute/hide
    - Añadir estilos para textarea readonly (selección fácil para copiar)
    - Añadir `.webrtc-audio-player` para el elemento `<audio>`

### Phase 4b: Media capture (media_capture.js)

> **Módulo nuevo** que encapsula toda la interacción con ffmpeg.
> Se usa desde `webrtc_model.js` cuando `mode` != 'data'.

14. **Crear `src/models/media_capture.js`** — Funciones puras + child_process:

    ```js
    const { spawn, execSync } = require('child_process');
    const { PassThrough } = require('stream');

    module.exports = {
      checkFfmpeg,      // → boolean: ¿está ffmpeg instalado?
      listDevices,      // → { cameras: [...], mics: [...] }
      startCapture,     // (mode, onRtpAudio, onRtpVideo) → { process, stop() }
      startDecoder,     // (type, onFrame) → { process, feed(rtpPacket), stop() }
      createMjpegStream,  // () → PassThrough (multipart/x-mixed-replace)
      createAudioStream,  // () → PassThrough (audio/ogg chunked)
    };
    ```

    **`checkFfmpeg()`** — verifica que ffmpeg está en PATH:
    ```js
    function checkFfmpeg() {
      try { execSync('ffmpeg -version', { stdio: 'ignore' }); return true; }
      catch { return false; }
    }
    ```

    **`listDevices()`** — enumera cámaras y micrófonos disponibles:
    ```js
    function listDevices() {
      const platform = process.platform;
      // macOS: ffmpeg -f avfoundation -list_devices true -i ""
      // Linux: v4l2-ctl --list-devices + pactl list sources short
      // Windows: ffmpeg -f dshow -list_devices true -i dummy
      // Parsea stdout/stderr → { cameras: [{id, name}], mics: [{id, name}] }
    }
    ```

    **`startCapture(mode, callbacks)`** — lanza ffmpeg para captura local:
    ```js
    function startCapture(mode, { onRtpAudio, onRtpVideo }) {
      const platform = process.platform;
      const args = buildCaptureArgs(platform, mode);
      // Ejemplo macOS, mode=video:
      //   ffmpeg -f avfoundation -i "0:0"
      //     -c:v vp8 -f rtp pipe:1     ← video RTP al stdout
      //     -c:a libopus -f rtp pipe:3  ← audio RTP a fd 3
      //
      // Alternativa más simple (2 procesos separados):
      //   ffmpeg -f avfoundation -i "0" -c:v vp8 -f rtp rtp://127.0.0.1:PORT_V
      //   ffmpeg -f avfoundation -i ":0" -c:a libopus -f rtp rtp://127.0.0.1:PORT_A
      //
      // Los paquetes RTP se capturan vía UDP socket en localhost
      // y se alimentan a node-datachannel Track.sendMessage(rtpBuffer)
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      return { process: proc, stop: () => proc.kill('SIGTERM') };
    }
    ```

    **`startDecoder(type)`** — decodifica RTP remoto a formato HTTP-streameable:
    ```js
    function startDecoder(type) {
      // type = 'video' → ffmpeg lee RTP → emite MJPEG frames
      //   ffmpeg -protocol_whitelist pipe,rtp,udp -i pipe:0
      //     -c:v mjpeg -f image2pipe -q:v 5 pipe:1
      //
      // type = 'audio' → ffmpeg lee RTP → emite OGG/Opus chunked
      //   ffmpeg -protocol_whitelist pipe,rtp,udp -i pipe:0
      //     -c:a libopus -f ogg pipe:1
      const proc = spawn('ffmpeg', decoderArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
      return {
        process: proc,
        feed: (rtpPacket) => proc.stdin.write(rtpPacket),
        stdout: proc.stdout, // readable stream para HTTP response
        stop: () => proc.kill('SIGTERM')
      };
    }
    ```

    **`createMjpegStream()`** — formatea frames JPEG como multipart:
    ```js
    function createMjpegStream() {
      // PassThrough que recibe frames JPEG del decoder
      // y los emite con headers multipart/x-mixed-replace
      const stream = new PassThrough();
      return {
        stream,
        pushFrame(jpegBuffer) {
          stream.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpegBuffer.length}\r\n\r\n`);
          stream.write(jpegBuffer);
          stream.write('\r\n');
        },
        end() { stream.end(); }
      };
    }
    ```

15. **Detección automática de plataforma** — `media_capture.js` usa `process.platform`:

    | `process.platform` | Backend ffmpeg input | Notas |
    |---|---|---|
    | `darwin` | `-f avfoundation` | macOS, dispositivos indexados (0=primera cámara, :0=primer mic) |
    | `linux` | `-f v4l2` (video) + `-f pulse` (audio) | Requiere v4l2 y PulseAudio/PipeWire |
    | `win32` | `-f dshow` | Dispositivos por nombre |

    El módulo lanza un error claro si la plataforma no está soportada o si los
    dispositivos no se detectan.

### Phase 5: Signaling Abstraction Layer (ssb-webrtc/)

16. **Interfaz común** — `signaling/transport.js`:
    ```js
    { name, init(config), send(peerId, type, payload), onSignal(cb), listPeers(), destroy() }
    ```

17. **Refactorizar `manual.js`** — Adaptar a la interfaz. En backend-only, `send()` retorna el código, `onSignal()` acepta código via parámetro (no espera paste interactivo).

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
    **Nota**: `ffmpeg` NO es una dependencia npm — es un binario del sistema.
    Se documenta como requisito opcional (solo necesario para modos audio/video).

---

## Ficheros relevantes

### Ficheros a CREAR

| Fichero | Descripción | Patrón de referencia |
|---|---|---|
| `oasis-main/src/models/webrtc_model.js` | Modelo: PeerConnection + DataChannel + media + estado en memoria | `tasks_model.js` (factory + cooler), `cipher_model.js` (funciones puras) |
| `oasis-main/src/models/media_capture.js` | Captura/reproducción de media vía ffmpeg: startCapture, startDecoder, createMjpegStream, createAudioStream | `cipher_model.js` (funciones puras, sin dependencia SSB) |
| `ssb-webrtc/signaling/transport.js` | Interfaz abstracta de transporte | Nuevo |
| `ssb-webrtc/signaling/ssb.js` | Transporte vía SSB private messages | Basado en `ssb-webrtc/index.js` |
| `ssb-webrtc/signaling/lan.js` | Transporte LAN (wrapper de ssb.js) | Nuevo |
| `ssb-webrtc/signaling/socketio.js` | Transporte Socket.io | `ProjectRTC-001/app/socketHandler.js` |
| `ssb-webrtc/signaling/index.js` | Registry de transportes | Nuevo |

### Ficheros a MODIFICAR

| Fichero | Cambios | Líneas aprox. |
|---|---|---|
| `oasis-main/src/views/webrtc_view.js` | **Reescritura completa**: eliminar IDs/buttons JS, usar `<form>`, renderizado condicional por estado, media panel con `<img>`/`<audio>` condicional según mode, controles media como formularios POST, meta-refresh | 140 → ~220 |
| `oasis-main/src/backend/backend.js` | Añadir 8 rutas (5 POST + 3 GET streaming), importar webrtcModel, modificar GET /webrtc existente | +~80 líneas (L1713+) |
| `oasis-main/src/client/assets/styles/webrtc.css` | Eliminar `.webrtc-hidden`, estilos de botones JS; mantener `.webrtc-video-grid` (ahora para `<img>`); añadir `.webrtc-audio-player`, estilos textarea readonly | ~105 → ~100 |
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
| `webrtcModeLabel` | "Mode:" |
| `webrtcModeData` | "Data Only (chat)" |
| `webrtcModeAudio` | "Audio + chat" |
| `webrtcModeVideo` | "Audio/Video + chat" |
| `webrtcMuteMic` | "Mute Mic" |
| `webrtcUnmuteMic` | "Unmute Mic" |
| `webrtcHideCam` | "Hide Cam" |
| `webrtcShowCam` | "Show Cam" |
| `webrtcFfmpegRequired` | "ffmpeg is required for audio/video. Install it: brew install ffmpeg (macOS), apt install ffmpeg (Linux)" |
| `webrtcLocalVideo` | "Local" |
| `webrtcRemoteVideo` | "Remote" |
| `webrtcNoMediaDevices` | "No camera or microphone detected" |

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
  peerId: null,         // '@xxx.ed25519' (solo para SSB)
  // ── Media state ──
  mode: 'data',         // 'data' | 'audio' | 'video'
  media: {
    captureProc: null,  // child_process de ffmpeg captura (mic/cam)
    decoderVideo: null,  // child_process de ffmpeg decoder vídeo RTP → MJPEG
    decoderAudio: null,  // child_process de ffmpeg decoder audio RTP → OGG
    mjpegStream: null,  // PassThrough para endpoint /webrtc/media/video/remote
    mjpegLocalStream: null, // PassThrough para endpoint /webrtc/media/video/local
    audioStream: null,  // PassThrough para endpoint /webrtc/media/audio
    audioTrack: null,   // node-datachannel Audio Track
    videoTrack: null,   // node-datachannel Video Track
    micMuted: false,    // true si el mic está muteado (envía silencio)
    camHidden: false,   // true si la cam está oculta (envía negro)
    hasFfmpeg: false    // true si ffmpeg está instalado en el sistema
  }
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

> ⚠️ **REVISIÓN — Campo `lastHttpActivity` para detección de zombies**
>
> Si se adopta la propuesta de limpieza de zombies (ver Phase 1, punto 2),
> el estado singleton debe incluir:
> ```js
> let state = {
>   // ... campos existentes ...
>   lastHttpActivity: Date.now(),  // timestamp del último request HTTP a /webrtc/*
> };
>
> // En el init del módulo:
> const ZOMBIE_TIMEOUT_MS = config.webrtcZombieTimeoutMs || 60000;
> setInterval(() => {
>   if (state.phase !== 'idle' && Date.now() - state.lastHttpActivity > ZOMBIE_TIMEOUT_MS) {
>     disconnect(); // mata ffmpeg, cierra PeerConnection, resetea a idle
>   }
> }, 30000);
> ```
>
> Cada ruta `/webrtc/*` actualiza `state.lastHttpActivity = Date.now()` al
> inicio del handler. El meta-refresh cada 5s (o el iframe refresh cada 3s)
> actúa como heartbeat automático.

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
    transport: state.transport,
    mode: state.mode,
    micMuted: state.media.micMuted,
    camHidden: state.media.camHidden,
    hasFfmpeg: state.media.hasFfmpeg
  });
})

// En webrtc_view.js:
const webrtcView = (phase = 'idle', data = {}) => {
  const needsRefresh = ['answer-created', 'waiting-answer', 'connected'].includes(phase);

  const idlePanel = (phase === 'idle') ? div({ class: "card" }, /* formularios con selector mode */) : null;
  const offerPanel = (phase === 'offer-created') ? div({ class: "card" }, /* offer code */) : null;
  const answerPanel = (phase === 'answer-created') ? div({ class: "card" }, /* answer code */) : null;
  const waitingPanel = (phase === 'waiting-answer') ? div({ class: "card" }, /* waiting msg */) : null;

  // Panel de media — condicional al modo
  const mediaPanel = (phase === 'connected' && data.mode !== 'data')
    ? div({ class: "card" },
        h3("▶ Media"),
        data.mode === 'video' ? div({ class: "webrtc-video-grid" },
          div({ class: "webrtc-video-box" }, label("Local"),
            img({ src: "/webrtc/media/video/local", class: "webrtc-video", alt: "Local" })),
          div({ class: "webrtc-video-box" }, label("Remote"),
            img({ src: "/webrtc/media/video/remote", class: "webrtc-video", alt: "Remote" }))
        ) : null,
        audio({ src: "/webrtc/media/audio", autoplay: true, controls: true }),
        div({ class: "webrtc-media-controls" },
          form({ method: "POST", action: "/webrtc/media/mic/toggle" },
            button({ type: "submit" }, data.micMuted ? "🎙 Unmute" : "🎙 Mute")),
          data.mode === 'video'
            ? form({ method: "POST", action: "/webrtc/media/cam/toggle" },
                button({ type: "submit" }, data.camHidden ? "📷 Show" : "📷 Hide"))
            : null
        )
      )
    : null;

  // Aviso si ffmpeg no está instalado y se seleccionó modo media
  const ffmpegWarning = (phase === 'idle' && !data.hasFfmpeg)
    ? p({ class: "webrtc-warning" }, i18n.webrtcFfmpegRequired || "ffmpeg is required for audio/video modes")
    : null;

  const chatPanel = (phase === 'connected') ? div({ class: "card" }, /* chat */) : null;
  const errorPanel = (phase === 'error') ? div({ class: "card" }, /* error */) : null;

  let pageTpl = template(
    i18n.webrtcTitle || "WebRTC",
    section(idlePanel, ffmpegWarning, offerPanel, answerPanel, waitingPanel, mediaPanel, chatPanel, errorPanel)
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

### Tests de media streams

| # | Test | Cómo verificar | Resultado esperado |
|---|---|---|---|
| 12b | ffmpeg check | GET /webrtc sin ffmpeg instalado | Selector mode muestra warning "ffmpeg required" |
| 12c | Crear sala audio | POST /webrtc/create con mode=audio | Offer SDP incluye audio track (m=audio en SDP) |
| 12d | Crear sala video | POST /webrtc/create con mode=video | Offer SDP incluye audio + video tracks |
| 12e | Stream vídeo MJPEG | GET /webrtc/media/video/remote estando connected (mode=video) | Content-Type multipart/x-mixed-replace, frames JPEG llegan |
| 12f | Stream audio | GET /webrtc/media/audio estando connected (mode=audio) | Content-Type audio/ogg, audio suena en el browser |
| 12g | Toggle mic | POST /webrtc/media/mic/toggle estando connected | `state.media.micMuted` cambia, botón muestra "Unmute"/"Mute" |
| 12h | Toggle cam | POST /webrtc/media/cam/toggle estando connected (mode=video) | `state.media.camHidden` cambia, botón muestra "Show"/"Hide" |
| 12i | Disconnect mata ffmpeg | POST /webrtc/disconnect con media activa | Procesos ffmpeg terminados (no quedan zombis) |
| 12j | Media sin ffmpeg | POST /webrtc/create con mode=video, sin ffmpeg | Estado `error` con mensaje descriptivo |
| 12k | Preview local | GET /webrtc/media/video/local estando connected (mode=video) | Stream MJPEG local funciona (preview de lo que envía la cámara) |
| 12l | Meta-refresh + streams | Estar en connected con media, esperar 5s | Página recarga, streams MJPEG/audio se reconectan sin interrupción visible |
| 12m | Audio-only mode | Crear sala con mode=audio | Chat + `<audio>` visible, sin grid de vídeo |
| 12n | Plataforma no soportada | Ejecutar en OS sin backend ffmpeg conocido | Error claro, modo data sigue disponible |

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
| **Audio/Video** | ffmpeg captura local + node-datachannel media tracks + MJPEG/OGG HTTP streaming | Oasis es app local — Node.js tiene acceso al mic/cam del usuario. ffmpeg es el estándar de facto para captura/codificación multimedia en todas las plataformas (macOS/Linux/Windows). El browser reproduce nativamente MJPEG (`<img>`) y audio streaming (`<audio>`), sin JavaScript. |
| **MJPEG para vídeo** | `multipart/x-mixed-replace` sobre `<img>` | Los browsers renderizan MJPEG nativamente sin JS. Mayor ancho de banda que H.264 (~×10) pero aceptable en LAN/localhost. Latencia baja (~100-300ms). Alternativa: H.264 via `<video>` necesitaría MSE (ya requiere JS). |
| **OGG/Opus para audio** | `<audio>` con HTTP chunked Transfer-Encoding | Buen balance latencia/calidad/ancho de banda. Soporte Chrome+Firefox nativo. Fallback a MP3 para Safari antiguo. |
| **ffmpeg como dependencia optativa** | Solo necesario para modes audio/video | El modo `data` (solo chat) funciona sin ffmpeg. Audio/video son opt-in. Instalación trivial en los 3 OS mayoritarios. |
| **Mute/hide sin JS** | Formularios POST que pausan pipe ffmpeg | ffmpeg sigue corriendo pero recibe silencio/negro. Evita cerrar el track WebRTC (no requiere renegociación SDP). Latencia del toggle: 1 round-trip HTTP. |
| **Polling vs SSE** | `<meta http-equiv="refresh" content="5">` | SSE requiere JS (`EventSource`). Meta-refresh es HTML puro. Latencia de 0-5s aceptable para chat. Las conexiones de streams media se reconectan automáticamente al recargar. |
| **Estado en memoria** | Singleton en closure del modelo | Oasis es single-user. No necesita base de datos ni sesiones HTTP. Si el proceso muere, la conexión WebRTC muere igual → estado limpio. Los procesos ffmpeg se matan en el cleanup. |
| **Patrón POST** | Re-render para create/join, PRG para chat/disconnect/toggle | Create/join necesitan mostrar códigos inmediatamente (como cipher encrypt). Chat/disconnect/toggle son acciones que no generan output → PRG evita re-submit. |
| **Multi-transporte** | manual, ssb-conn, ssb-lan, socket.io | Todos intercambiables vía selectSignaling layer. Manual es el primero. |
| **ICE config** | Defaults en plugin + override en oasis-config.json | Merge de arrays: config del operador prevalece. |
| **Tipo de mensaje SSB** | Configurable: `webrtc-signal` (default) o `post` | Flexibilidad para redes SSB que filtran tipos desconocidos. |
| **Tombstone** | Automático post-conexión (SSB mode) | Evita acumulación de señales obsoletas en el log SSB. |
| **Buffer mensajes** | 1000 max, FIFO | Previene memory leak en chats largos. No persiste a disco. |

> ⚠️ **REVISIÓN — Decisiones adicionales propuestas por auditoría**
>
> | Decisión | Elección propuesta | Justificación |
> |---|---|---|
> | **CSRF hardening** | Referer estricto + SameSite=Strict + CSP form-action | Defensa en profundidad. Ver sección "Diferencias clave" para detalle. |
> | **Zombie timeout** | `setInterval` 30s, disconnect si inactividad > 60s | Evita procesos ffmpeg huérfanos. Configurable en oasis-config.json. |
> | **Audio localhost** | WAV/PCM por defecto en localhost, OGG/Opus para remoto | Latencia mínima (~50ms) en el caso de uso primario (app local). |
> | **Chat en iframe** | `<iframe src="/webrtc/chat">` con meta-refresh propio | Preserva scroll, input, y streams media. 100% HTML sin JS. |
> | **HW video encoding** | h264_videotoolbox / h264_vaapi con fallback SW | Reduce CPU ~90% en la captura de vídeo. Detección automática. |
> | **Device defaults** | `"default:default"` (macOS), auto-detect (Linux) | Más robusto que índices numéricos ("0:0"). |

---

## Consideraciones futuras

### 1. Calidad de vídeo MJPEG vs. codecs modernos

MJPEG consume ~10x más ancho de banda que H.264/VP8 para la misma calidad. Esto
es aceptable en LAN o localhost, pero para conexiones remotas con ancho de banda
limitado puede ser un problema.

**Opciones de mejora futura**:
- **Reducir calidad MJPEG**: `-q:v 10` (baja) en vez de `-q:v 5` (media) reduce
  el ancho de banda ~50% con pérdida visible de calidad
- **Reducir resolución**: `-s 320x240` en vez de resolución nativa de la cámara
- **Reducir framerate**: `-r 10` (10 fps) en vez de 30 fps
- **H.264 sobre `<video>` sin JS**: Teóricamente posible con fMP4 (fragmented MP4)
  servido por HTTP chunked → `<video src="/webrtc/media/video">`. Requiere
  investigar compatibilidad cross-browser sin MSE.

**Configuración recomendada por escenario**:

| Escenario | Resolución | FPS | Calidad | Ancho de banda aprox. |
|---|---|---|---|---|
| Localhost (2 instancias) | 640x480 | 15 | q:v 5 | ~2 Mbps |
| LAN | 640x480 | 15 | q:v 5 | ~2 Mbps |
| Internet (STUN) | 320x240 | 10 | q:v 8 | ~500 Kbps |
| Internet (TURN relay) | 320x240 | 10 | q:v 10 | ~300 Kbps |

Estas configuraciones podrían exponerse en `oasis-config.json` → `webrtcVideoQuality`.

> ⚠️ **REVISIÓN — HW acceleration reduce el coste de este tradeoff**
>
> Si se adopta `h264_videotoolbox` / `h264_vaapi` para el encoding de transporte
> WebRTC (ver propuesta en "Pipeline completo"), el cuello de botella de CPU se
> desplaza del encoding al decoding MJPEG. Esto permite:
> - Subir resolución/fps sin saturar CPU (el encoding ya no es el bottleneck)
> - Dedicar más CPU al decoder MJPEG (que no tiene aceleración HW estándar)
> - La opción futura de fMP4/H.264 sobre `<video>` se vuelve más atractiva:
>   el decoder HW del **navegador** haría todo el trabajo, y el servidor solo
>   actúa como proxy de los paquetes H.264 que ya recibió por WebRTC

### 2. Latencia del meta-refresh y media

El polling cada 5 segundos introduce latencia de 0-5s en mensajes entrantes del chat.
Esto es aceptable para chat asíncrono pero no para conversaciones en tiempo real.

Para los **streams de media**, la reconexión tras meta-refresh es ~100ms (el stream
ya está preparado en el servidor). El impacto visible es mínimo: un breve flash
en el `<img>` MJPEG. El `<audio>` puede tener un micro-corte de ~200ms.

**Opciones**:
- Reducir meta-refresh a 2-3 segundos (más tráfico HTTP, menos cortes)
- Hacer configurable en oasis-config.json: `webrtcRefreshInterval: 5`
- Tradeoff explícito: **sin JS = sin WebSocket/SSE = sin push en tiempo real**

> ⚠️ **REVISIÓN — La propuesta `<iframe>` resuelve esta sección**
>
> Si se adopta el diseño con `<iframe>` para el chat (ver "Estado connected"),
> este problema desaparece en gran medida:
> - Los streams MJPEG/audio **nunca se interrumpen** (viven en la página padre)
> - Solo el iframe del chat recarga cada 3-5s (HTML ligero, ~1 KB)
> - El flash/micro-corte de media citado arriba ya no ocurre
> - La latencia del chat sigue siendo 0-5s, pero sin penalizar la UX de media
>
> La configurabilidad del refresh interval sigue siendo útil, pero ahora solo
> afecta al iframe del chat, no a toda la página.

### 3. NAT traversal / TURN

La config actual solo usa STUN (Google), cubre ~80% de NATs domésticos.
**No funcionará** con NATs simétricos (redes corporativas, algunos carriers móviles).
Para conectividad universal se necesita TURN (coturn, Metered.ca, Xirsys).
Se configura en Phase 2 vía `oasis-config.json` → `webrtcIceServers`.

**Nota sobre media y TURN**: Los streams de audio/vídeo vía TURN consumen ancho
de banda del relay. MJPEG con TURN requiere un TURN server con buena capacidad.
Reducir calidad de vídeo es crítico cuando se usa TURN.

### 4. Concurrencia

Oasis es single-user pero podría recibir múltiples requests simultáneas
(e.g., meta-refresh mientras el usuario hace POST, más las conexiones abiertas
de los streams MJPEG/audio). El modelo debe ser thread-safe en su gestión de
estado. Node.js es single-threaded por defecto, así que esto no es un problema
real. Las conexiones de streaming son long-lived pero read-only (consumen del
PassThrough del decoder). El único riesgo es que un `disconnect()` mate los
procesos ffmpeg mientras un stream HTTP está sirviéndolos — se maneja con
cleanup del PassThrough que cierra la conexión HTTP limpiamente.

> ⚠️ **REVISIÓN — Véase propuesta zombie timeout en Phase 1, punto 2**
>
> El riesgo de concurrencia más grave no es el threading (correcto: Node.js es
> single-threaded) sino las **sesiones zombie**: el usuario cierra la pestaña
> y los procesos ffmpeg + PeerConnection quedan vivos indefinidamente. La
> propuesta de `lastHttpActivity` + `setInterval` cleanup resuelve esto.
> Además, si se adopta el `<iframe>`, el `disconnect()` durante streaming activo
> es más limpio: la página padre con los streams se cierra normalmente, y el
> iframe deja de hacer requests (dejando de renovar el heartbeat).

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
- `img-src 'self'` debe permitir las rutas de streaming MJPEG (son `'self'`)
- **No se requieren cambios en CSP** para la implementación backend-only con media

### 8. Llamada entrante (SSB mode)

Cuando otro peer envía un offer vía SSB, el listener (`sbot.webrtc.listen()`)
lo detecta. ¿Cómo notificar al usuario sin JS?

- **Opción A**: El usuario visita /webrtc y ve "Llamada entrante de @peer" + botón "Aceptar"
- **Opción B**: Banner en cualquier página de Oasis (requiere modificar template global)
- **Recomendación**: Opción A para el scope inicial. El usuario debe visitar /webrtc periódicamente o tener la pestaña abierta con meta-refresh.

### 9. Selección de dispositivos de captura

En la primera versión se usa el dispositivo por defecto del sistema (device "0"
en avfoundation, `/dev/video0` en Linux, etc.). Para futuras versiones:

- `media_capture.listDevices()` ya enumera los dispositivos disponibles
- Se podría añadir un selector `<select name="camera">` / `<select name="mic">`
  en el formulario de `/webrtc/create`
- Los IDs se pasan a ffmpeg: `-i "1:2"` (avfoundation) o `-i /dev/video1` (v4l2)
- Configurar defaults en `oasis-config.json` → `webrtcDefaultCamera`, `webrtcDefaultMic`

### 10. Screensharing

ffmpeg puede capturar la pantalla del sistema:
- macOS: `-f avfoundation -i "Capture screen 0"`
- Linux: `-f x11grab -i :0.0`
- Windows: `-f gdigrab -i desktop`

Esto se podría añadir como un modo adicional (`mode=screen`). El pipeline es
idéntico al video: ffmpeg captura → RTP → node-datachannel → MJPEG HTTP → `<img>`.
No requiere ningún cambio arquitectónico, solo un nuevo valor en el selector de modo.
