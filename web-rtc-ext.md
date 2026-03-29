# WebRTC para SSB/Oasis — Extensión: Cámara CSI vs USB + RPi-WebRTC + µStreamer

> **Tipo**: extensión (*patch*) de [web-rtc.md](./web-rtc.md)
>
> **Principio DRY**: este documento **no repite** el contenido del original. Cada sección indica a qué punto de `web-rtc.md` extiende y por qué. Leer como un diff conceptual sobre el documento base.
>
> **Temas**:
> 1. Implicaciones técnicas de **cámara CSI vs. USB** — asegurar que todas las arquitecturas y caminos cubren ambas alternativas.
> 2. Integración de **RPi-WebRTC** (streaming WebRTC nativo en Raspberry Pi) como vía alternativa en cada sección y camino del documento original.
> 3. Integración de **µStreamer** (servidor MJPEG ultraligero del proyecto PiKVM) como alternativa de streaming de vídeo que encaja naturalmente con la restricción "cero JS en cliente".

---

### Índice de extensiones

- EXT-1. [Cámara CSI vs. USB: ficha técnica comparativa](#ext-1-cámara-csi-vs-usb-ficha-técnica-comparativa)
- EXT-2. [Implicaciones en el pipeline de captura (extiende §1.7)](#ext-2-implicaciones-en-el-pipeline-de-captura)
- EXT-3. [RPi-WebRTC: ficha técnica del proyecto](#ext-3-rpi-webrtc-ficha-técnica-del-proyecto)
- EXT-4. [Impacto CSI/USB en §2.1 — Retransmisión al navegador](#ext-4-impacto-csiusb-en-21--retransmisión-al-navegador)
- EXT-5. [Impacto CSI/USB + RPi-WebRTC en §2.2 — Servidores media dedicados](#ext-5-impacto-csiusb--rpi-webrtc-en-22--servidores-media-dedicados)
  - EXT-5A. [Arquitectura 1 (go2rtc): CSI vs. USB](#ext-5a-arquitectura-1-go2rtc-csi-vs-usb)
  - EXT-5B. [Arquitectura 2 (MediaMTX): CSI vs. USB](#ext-5b-arquitectura-2-mediamtx-csi-vs-usb)
  - EXT-5C. [Arquitectura 3 (Mumble hybrid): CSI vs. USB](#ext-5c-arquitectura-3-mumble-hybrid-csi-vs-usb)
  - EXT-5D. [Arquitectura 5 — RPi-WebRTC como vía nativa (★ nueva)](#ext-5d-arquitectura-5--rpi-webrtc-como-vía-nativa--nueva)
- EXT-6. [Impacto en §3 — Implementación: Caminos A, B, C + nuevo Camino D](#ext-6-impacto-en-3--implementación-caminos-a-b-c--nuevo-camino-d)
- EXT-7. [Matriz de decisión unificada CSI/USB × Arquitectura × RPi-WebRTC](#ext-7-matriz-de-decisión-unificada)
- EXT-8. [Extensión del glosario (§4)](#ext-8-extensión-del-glosario-4)

**Patch 2 — µStreamer**:
- EXT-9. [µStreamer: ficha técnica del proyecto](#ext-9-µstreamer-ficha-técnica-del-proyecto)
- EXT-10. [Impacto de µStreamer en §2.2 — Nueva Arq. 6](#ext-10-impacto-de-µstreamer-en-22--nueva-arq-6)
  - EXT-10A. [µStreamer como alternativa a go2rtc para MJPEG](#ext-10a-µstreamer-como-alternativa-a-go2rtc-para-mjpeg)
  - EXT-10B. [Arquitectura 6 — µStreamer + Mumble (ultra-ligera)](#ext-10b-arquitectura-6--µstreamer--mumble-ultra-ligera)
  - EXT-10C. [µStreamer + Janus: variante WebRTC](#ext-10c-µstreamer--janus-variante-webrtc)

---

## EXT-1. Cámara CSI vs. USB: ficha técnica comparativa

> **Extiende**: [web-rtc.md §1.7](./web-rtc.md#17-el-caso-ssb-oasis-solar) — donde se menciona "Puerto cámara: CSI (ribbon, interfaz nativa RPi)" y [§2.2 Perfil del dispositivo destino](./web-rtc.md#perfil-del-dispositivo-destino).
>
> **Motivo**: el documento original asume implícitamente una cámara CSI. Sin embargo, varios casos de uso del SNH (cámara remota, cámara pan-tilt USB, webcam genérica) requieren o permiten una cámara USB. Las diferencias técnicas afectan al pipeline de captura, a elección de servidor media, y al consumo de CPU/RAM.

### 1.1 Comparativa hardware

| Criterio | Cámara CSI (ribbon) | Cámara USB (UVC) |
|---|---|---|
| **Interfaz física** | Flat Flexible Cable (FFC) 15-pin (RPi 3B) / 22-pin (RPi 5, Zero). Bus MIPI CSI-2 dedicado | USB 2.0 (480 Mbps) o USB 3.0 (5 Gbps). Conector estándar USB-A/micro-B |
| **Protocolo** | MIPI CSI-2 (D-PHY lanes, reloj dedicado). Datos RAW Bayer del sensor directo al ISP del SoC | USB Video Class (UVC 1.1/1.5). La cámara entrega frames ya procesados (YUYV, MJPEG, o H.264 según modelo) |
| **Acceso al GPU/ISP** | ✅ Directo. El VideoCore IV (RPi 3B) / VideoCore VII (RPi 5) procesa el RAW Bayer y entrega frames procesados (YUV, encode H.264 por HW) | ❌ No pasa por el ISP nativo. El frame llega como YUYV/MJPEG al driver UVC en userspace. El encode H.264 HW es posible vía V4L2 M2M pero con una copia extra |
| **Encoder H.264 por hardware** | ✅ `rpicam-vid` codifica H.264/H.265 directamente desde el ISP con ~5% CPU | ⚠️ Requiere paso extra: captura UVC → buffer userspace → V4L2 M2M `/dev/video11` → H.264 HW. CPU ~10–15% por la copia y conversión de formatos |
| **Latencia captura→frame** | ~20–50 ms (ISP pipeline directo, zero-copy posible) | ~50–150 ms (USB polling + decode MJPEG/YUYV + posible re-encode) |
| **Driver Linux** | `bcm2835-unicam` (RPi 3B) / `rp1-cfe` (RPi 5). Framework `libcamera` completo | `uvcvideo` (kernel genérico). Framework V4L2 estándar. `libcamera` NO gestiona cámaras USB |
| **Herramientas rpicam-**** | ✅ `rpicam-vid`, `rpicam-still`, `rpicam-hello` — acceso completo a ISP, AWB, AEC, HDR | ❌ `rpicam-*` no detecta cámaras USB. Usar `ffmpeg -f v4l2` o `v4l2-ctl` |
| **Resolución típica** | Cam Module 2: 8 MP (3280×2464), Cam Module 3: 12 MP (4608×2592), HQ Cam: 12 MP (4056×3040) | Variable: desde 0.3 MP (VGA webcam) hasta 4K (Logitech Brio). Dependiente del modelo |
| **Distancia máxima** | ~20 cm (ribbon flexible, frágil). Extensores CSI disponibles (~1 m máximo) con pérdida de señal | Hasta 5 m (USB 2.0) o 3 m (USB 3.0) estándar. Con hub activo o extensor: >10 m |
| **Hot-plug** | ❌ Requiere apagado para conectar/desconectar. El ribbon es delicado | ✅ Plug & play en caliente. `uvcvideo` detecta automáticamente |
| **Consumo energético** | ~250 mW (Cam Module 3). Alimentado por los 3.3V del conector CSI | ~500 mW–1.5W (según modelo). Alimentado por el bus USB (5V, 500 mA max en USB 2.0) |
| **Compatibilidad térmica** | Buena. Sin componentes activos significativos | Variable. Algunas webcams USB tienen chip de procesamiento interno que calienta |
| **Coste (marzo 2026)** | Cam Module 3: ~€25. HQ Camera: ~€50 | Webcams con H.264 HW: €15–€80. Webcams USB genéricas: €5–€20 |
| **Nodo `/dev/videoN`** | Sí (vía `bcm2835-unicam` / `rp1-cfe`), pero el acceso óptimo es vía `libcamera` | Sí (`/dev/video0` típicamente). Acceso directo V4L2 estándar |

### 1.2 Implicaciones para el Solar Net Hub

El Solar Net Hub (RPi 3B, 1 GB RAM, panel solar 22W) tiene **puerto CSI nativo**. Sin embargo, hay escenarios legítimos para USB:

| Escenario | CSI preferible | USB preferible | Justificación |
|---|---|---|---|
| **Cámara fija integrada** | ✅ | | Máximo rendimiento, mínimo consumo, ribbon corto |
| **Cámara a distancia (>30 cm)** | | ✅ | El ribbon CSI pierde señal a distancias largas |
| **Pan-tilt-zoom (PTZ)** | | ✅ | Las PTZ baratas son USB; las CSI-PTZ requieren HAT I²C adicional |
| **Webcam existente reciclada** | | ✅ | Reutilización de hardware, coste cero |
| **Visión nocturna (IR)** | ✅ (NoIR) | ⚠️ | Cam Module 3 NoIR es una solución integrada con IR; USB varía |
| **Múltiples cámaras** | ⚠️ (1 CSI en RPi 3B) | ✅ | RPi 3B tiene un único puerto CSI; varios USB posibles |
| **Docker/contenedores** | ⚠️ | ✅ | V4L2 (`/dev/video0`) es más fácil de pasar a Docker que el bus CSI completo |

> **Dato crítico para Oasis**: el SNH corre la app dentro de **Docker → Debian Bookworm**. Pasar el dispositivo CSI al contenedor requiere `--device /dev/vchiq` (RPi 3B legacy) o `--device /dev/video0` + `--device /dev/media0` + montaje de `/dev/dma_heap/` (libcamera moderno). Un USB es más simple: `--device /dev/video0`.

### 1.3 Diagrama de flujo de captura: CSI vs. USB

```
  CÁMARA CSI                                    CÁMARA USB
  ══════════                                    ══════════

  ┌──────────┐                                  ┌──────────┐
  │ Sensor   │                                  │ Sensor   │
  │ IMX219/  │                                  │ (varios) │
  │ IMX708   │                                  └────┬─────┘
  └────┬─────┘                                       │
       │ MIPI CSI-2                                  │ USB UVC
       │ (RAW Bayer, D-PHY lanes)                    │ (YUYV/MJPEG/H.264)
       │                                             │
  ┌────┴──────────────┐                         ┌────┴────────────────┐
  │ ISP VideoCore IV  │                         │ Driver uvcvideo     │
  │ (en GPU del SoC)  │                         │ (kernel, genérico)  │
  │                   │                         │                     │
  │ Debayer + AWB +   │                         │ Decode YUYV/MJPEG   │
  │ AEC + NR + encode │                         │ → Buffer userspace  │
  │ H.264 HW          │                         │ (sin ISP nativo)    │
  └────┬──────────────┘                         └────┬────────────────┘
       │                                             │
       │ /dev/video0 (libcamera)                     │ /dev/video0 (V4L2)
       │ o rpicam-vid -t 0 -o -                      │
       │                                             │
  ┌────┴──────────────────────────────────────────────┴──────────────┐
  │                                                                  │
  │  Opción A: ffmpeg                                                │
  │    CSI: ffmpeg -f v4l2 -input_format h264 -i /dev/video0 ...    │
  │    USB: ffmpeg -f v4l2 -input_format mjpeg -i /dev/video0 ...   │
  │                                                                  │
  │  Opción B: rpicam-vid (SOLO CSI)                                 │
  │    rpicam-vid -t 0 --codec h264 --inline -o - | ...              │
  │    (USB no soportado por rpicam-*)                               │
  │                                                                  │
  │  Opción C: libcamera-vid (SOLO CSI)                              │
  │    libcamera-vid -t 0 --codec h264 --inline -o - | ...           │
  │    (libcamera no gestiona UVC)                                   │
  │                                                                  │
  │  Opción D: go2rtc / MediaMTX (ambas)                             │
  │    CSI: fuente v4l2 o rpicam-vid pipe                            │
  │    USB: fuente v4l2 directa                                      │
  │                                                                  │
  │  Opción E: RPi-WebRTC (SOLO CSI, ver EXT-3)                     │
  │    Acceso nativo MMAL/libcamera → WebRTC H.264 HW directo       │
  │                                                                  │
  └──────────────────────────────────────────────────────────────────┘
```

### 1.4 Encoder H.264 por hardware: la diferencia clave

La GPU VideoCore IV del RPi 3B dispone de un encoder H.264 por hardware (`/dev/video11` vía V4L2 M2M). El acceso óptimo es diferente según la cámara:

**CSI — pipeline zero-copy**:
```
Sensor → MIPI CSI-2 → ISP (GPU) → H.264 encode (GPU) → buffer DMA
                                                         │
                                              Sin copia a RAM principal
                                              CPU: ~5%
```

**USB — pipeline con copia**:
```
Sensor → USB → uvcvideo → buffer YUYV en RAM → V4L2 M2M → H.264 encode (GPU)
                                    │                          │
                              Copia a userspace           Copia a GPU
                              CPU: ~10–15%
```

La diferencia de 2–3× en consumo de CPU es significativa en un dispositivo solar con 1 GB de RAM compartida entre CPU y GPU. Si se usa CSI, la GPU codifica H.264 "gratis"; si se usa USB, cada frame debe copiarse dos veces.

> **Excepción**: algunas webcams USB con encoder H.264 integrado (ej. Logitech C920, Logitech C930e) entregan H.264 directamente por USB. En ese caso, el encode ya viene hecho y la GPU del RPi no se usa. La CPU lee H.264 directamente de V4L2 sin re-encode. Pero estas cámaras son más caras (~€50–80) y consumen más energía (~1–1.5W).

---

## EXT-2. Implicaciones en el pipeline de captura

> **Extiende**: [web-rtc.md §1.7 — Pipeline de transmisión por pista](./web-rtc.md#17-el-caso-ssb-oasis-solar), tabla "Pista / Captura (origen) / Codec transporte".
>
> **Patch**: la tabla original dice `ffmpeg -f v4l2` para vídeo. Hay que bifurcar por tipo de cámara.

**Pipeline de transmisión por pista — versión CSI/USB-aware** (sustituye tabla original):

| Pista | Origen CSI | Origen USB | Codec transporte | Notas |
|---|---|---|---|---|
| **Vídeo** | `rpicam-vid --codec h264 --inline -o -` (zero-copy, ~5% CPU) | `ffmpeg -f v4l2 -input_format mjpeg -i /dev/video0` + re-encode H.264 (~15% CPU) | H.264 (HW) o VP8 (SW) | CSI preferible por eficiencia energética |
| **Vídeo (USB con H.264 HW integrado)** | N/A | `ffmpeg -f v4l2 -input_format h264 -i /dev/video0` (passthrough, ~3% CPU) | H.264 (passthrough) | Solo webcams con encoder HW (C920, C930e, etc.) |
| **Audio** | — | `ffmpeg -f alsa -i default` o Mumble (ver §2.2 Arq. 3) | Opus a 48 kHz | Independiente de CSI/USB |
| **Datos** | — | — | N/A (SCTP) | Independiente de cámara |
| **Archivos** | — | — | N/A (SCTP) | Independiente de cámara |

**Comandos ffmpeg por tipo de cámara**:

```bash
# ═══ CSI: captura H.264 HW directo ═══
# Opción 1: rpicam-vid (recomendado, zero-copy)
rpicam-vid -t 0 --width 1280 --height 720 --framerate 25 \
           --codec h264 --profile baseline --level 3.1 \
           --inline --listen -o tcp://127.0.0.1:8888

# Opción 2: ffmpeg vía V4L2 (si rpicam-vid no disponible)
ffmpeg -f v4l2 -input_format h264 -video_size 1280x720 -framerate 25 \
       -i /dev/video0 -c:v copy -f rtp rtp://127.0.0.1:5004

# ═══ USB: captura MJPEG + re-encode H.264 HW ═══
# La mayoría de webcams USB entregan MJPEG por V4L2
ffmpeg -f v4l2 -input_format mjpeg -video_size 1280x720 -framerate 25 \
       -i /dev/video0 \
       -c:v h264_v4l2m2m -b:v 1M -pix_fmt yuv420p \
       -f rtp rtp://127.0.0.1:5004

# ═══ USB con H.264 HW integrado: passthrough ═══
# Webcams tipo Logitech C920 que entregan H.264 directo
ffmpeg -f v4l2 -input_format h264 -video_size 1280x720 -framerate 25 \
       -i /dev/video0 -c:v copy -f rtp rtp://127.0.0.1:5004
```

**Detección automática del tipo de cámara**:

```bash
# Listar formatos soportados por la cámara conectada
v4l2-ctl --list-formats-ext -d /dev/video0

# CSI típica: aparece "H264" o "YUYV" con resoluciones altas
# USB típica: aparece "MJPG" y/o "YUYV"
# USB H264 HW: aparece "H264" entre los formatos

# Detectar si la cámara es CSI (libcamera) o USB (UVC)
libcamera-hello --list-cameras    # Si lista algo: es CSI
# Si no lista nada: no hay CSI, buscar /dev/video0 de USB
```

---

## EXT-3. RPi-WebRTC: ficha técnica del proyecto

> **Extiende**: [web-rtc.md §1.6.2 — Librerías WebRTC en otros lenguajes](./web-rtc.md#162-librerías-webrtc-en-otros-lenguajes-relevantes-para-22) y [§2.2 — Servidor media dedicado](./web-rtc.md#22-servidor-media-dedicado-la-alternativa-fuera-de-la-caja).
>
> **Motivo**: el documento original evalúa go2rtc, MediaMTX, y Janus como servidores media para RPi, pero no incluye **rpi-webrtc-streamer** (kclyu/rpi-webrtc-streamer), un proyecto diseñado específicamente para hacer streaming WebRTC nativo desde la RPi, accediendo directamente al encoder H.264 por hardware.

### 3.1 ¿Qué es RPi-WebRTC?

RPi-WebRTC (rpi-webrtc-streamer) es una implementación nativa en C++ de un servidor WebRTC diseñado **exclusivamente** para Raspberry Pi. A diferencia de go2rtc o MediaMTX (que son genéricos), RPi-WebRTC se compila contra las APIs de la GPU del RPi para acceder directamente al encoder H.264 por hardware **sin pasar por ffmpeg ni por V4L2**.

| | RPi-WebRTC Streamer |
|---|---|
| **Lenguaje** | C++ (basado en libwebrtc de Google, parcheado para RPi) |
| **Repo** | [github.com/kclyu/rpi-webrtc-streamer](https://github.com/kclyu/rpi-webrtc-streamer) |
| **Licencia** | BSD (derivado de libwebrtc/Chromium) |
| **Arquitectura** | WebRTC nativo completo: señalización + ICE + DTLS-SRTP + H.264 HW. Servidor HTTP embebido para señalización |
| **Captura** | Directa vía MMAL (legacy) / libcamera (moderno). **Solo cámaras CSI** |
| **Encode** | H.264 HW del VideoCore IV/VI, zero-copy. Sin ffmpeg |
| **Transporte** | WebRTC nativo: SRTP sobre DTLS, ICE completo (host/srflx/relay) |
| **Señalización** | HTTP + WebSocket embebidos. Compatible con AppRTC signaling |
| **Audio** | ALSA capture → Opus encode (libwebrtc's AudioEncoder) |
| **DataChannel** | ✅ Soportado (SCTP sobre DTLS, igual que los browsers) |
| **RAM típica** | ~30–50 MB (libwebrtc es pesada, pero el encode es HW) |
| **CPU RPi 3B** | ~10–15% (encode HW) + ~5% (stack ICE/DTLS/SRTP) = ~15–20% total |
| **Binario** | ~25–40 MB (libwebrtc compilada estáticamente). Cross-compile desde x86 |
| **Estado** | ⚠️ Mantenimiento irregular. Último commit significativo: 2023. Fork community activo |
| **Cámaras USB** | ❌ **No soportadas**. Requiere MMAL/libcamera (solo CSI) |

### 3.2 RPi-WebRTC vs. los otros servidores media

| Criterio | RPi-WebRTC | go2rtc | MediaMTX | Janus |
|---|---|---|---|---|
| **Protocolo de salida** | WebRTC nativo (SRTP) | MJPEG, HLS, WebRTC (WHEP), RTSP | RTSP, HLS, WebRTC, MJPEG | WebRTC nativo |
| **Cámara CSI** | ✅ MMAL/libcamera directo, zero-copy | ✅ vía v4l2 (con copia) | ✅ rpicam nativo (zero-copy) | ⚠️ Requiere fuente RTSP/RTP |
| **Cámara USB** | ❌ No | ✅ v4l2 directo | ✅ v4l2 directo | ⚠️ Requiere fuente RTSP/RTP |
| **Encode H.264 HW** | ✅ Nativo, sin ffmpeg | ⚠️ Solo si la fuente ya es H.264 | ✅ rpicam nativo (CSI) / ffmpeg (USB) | Depende de fuente |
| **Necesita ffmpeg** | ❌ No | ❌ No (captura v4l2/ALSA directa) | Solo para USB audio | ⚠️ Normalmente sí para ingest |
| **Navegador sin JS** | ❌ Requiere JS (WebRTC API del browser) | ✅ MJPEG/HLS sin JS | ✅ MJPEG/HLS sin JS | ❌ Requiere JS |
| **Funciona sobre Tor** | ❌ WebRTC + ICE incompatible con Tor | ⚠️ MJPEG/HLS sí; WebRTC no | ⚠️ MJPEG/HLS sí; WebRTC no | ❌ |
| **Señalización propia** | ✅ HTTP+WS embebidos | ✅ API HTTP embebida | ✅ Hooks HTTP | ✅ API HTTP + plugins |
| **RAM** | ~30–50 MB | ~20–40 MB | ~15–30 MB | ~10–20 MB |
| **Complejidad compilación** | Alta (cross-compile libwebrtc, ~4 GB build) | Baja (binario Go pre-compilado) | Baja (binario Go pre-compilado) | Media (C, dependencias) |
| **Madurez** | ⚠️ Mantenimiento irregular desde 2023 | ✅ Activo (7k ★, releases frecuentes) | ✅ Activo (13k ★) | ✅ Activo (8.5k ★) |

### 3.3 Arquitectura interna de RPi-WebRTC

```
  ┌───────────────────────────────────────────────────────────────┐
  │               RPi-WebRTC Streamer (C++)                       │
  │                                                               │
  │  ┌─────────────┐   MMAL/libcamera   ┌──────────────────────┐ │
  │  │ 🎥 Cam CSI  │───────────────────>│ RaspiCamEncoder      │ │
  │  └─────────────┘    (zero-copy)     │ (H.264 HW encode)    │ │
  │                                     └──────────┬───────────┘ │
  │  ┌─────────────┐   ALSA             ┌──────────┴───────────┐ │
  │  │ 🎤 Mic      │──────────────────>│ AudioEncoder (Opus)   │ │
  │  └─────────────┘                    └──────────┬───────────┘ │
  │                                                │              │
  │                                     ┌──────────┴───────────┐ │
  │                                     │ libwebrtc stack      │ │
  │                                     │ PeerConnection       │ │
  │                                     │ ICE + DTLS + SRTP    │ │
  │                                     │ DataChannel (SCTP)   │ │
  │                                     └──────────┬───────────┘ │
  │                                                │              │
  │  ┌───────────────────────────────────┐         │              │
  │  │ HTTP Server (señalización)        │◄────────┘              │
  │  │ WebSocket (ICE candidates)        │                        │
  │  │ Sirve: SDP offer/answer           │                        │
  │  │ Conf.: resolución, bitrate, etc.  │                        │
  │  └───────────────┬───────────────────┘                        │
  └──────────────────┼────────────────────────────────────────────┘
                     │ HTTP/WS (:8889)
  ┌──────────────────┴─────────────────────────────────────────────┐
  │         Navegador (CON JavaScript — WebRTC API)                │
  │                                                                │
  │  const pc = new RTCPeerConnection({...});                      │
  │  // fetch offer desde RPi-WebRTC                               │
  │  // setRemoteDescription + createAnswer                        │
  │  // → video.srcObject = event.streams[0]                       │
  │  <video autoplay playsinline></video>                          │
  └────────────────────────────────────────────────────────────────┘
```

### 3.4 El problema fundamental para Oasis: JS en cliente

**RPi-WebRTC requiere JavaScript en el navegador** para el handshake WebRTC (`RTCPeerConnection`, `setRemoteDescription`, `createAnswer`). Esto **viola directamente** la restricción de Oasis ("cero JS en cliente").

Sin embargo, RPi-WebRTC sigue siendo relevante para estas configuraciones:

| Configuración | JS en browser | Compatible con Oasis | Notas |
|---|---|---|---|
| **Browser del SNH (servido por Oasis)** | ❌ Prohibido | ❌ | Caso principal. RPi-WebRTC no sirve aquí directamente |
| **Browser del peer remoto** | ✅ Permitido | ✅ | La restricción "cero JS" es del browser **del SNH**, no del peer remoto |
| **RPi-WebRTC como fuente para go2rtc/MediaMTX** | N/A | ✅ | RPi-WebRTC genera el stream; go2rtc/MediaMTX lo re-sirve como MJPEG/HLS |
| **RPi-WebRTC + proxy HTTP** | N/A | ✅ | Un proxy Node.js consume WebRTC y re-sirve como `<img>` MJPEG / `<video>` HLS |

**La clave**: RPi-WebRTC puede actuar como **fuente de captura** ultra-eficiente (encode H.264 HW zero-copy), aunque el consumo final en el browser del SNH sea vía MJPEG/HLS (sin JS). Se combina con otro servidor que haga la reconversión.

### 3.5 RPi-WebRTC como fuente para go2rtc (patrón composable)

```
  ┌───────────────────────────────────────────────────────────────────┐
  │                    Raspberry Pi 3B (Solar Net Hub)                │
  │                                                                   │
  │  ┌────────────┐  MMAL   ┌───────────────┐  WebRTC   ┌─────────┐  │
  │  │ 🎥 Cam CSI │────────>│ RPi-WebRTC    │──(WHEP)──>│ go2rtc  │  │
  │  └────────────┘         │ H.264 HW      │           │ :1984   │  │
  │                         │ zero-copy      │           │         │  │
  │  ┌────────────┐  ALSA   │ + Opus audio  │           │ MJPEG   │  │
  │  │ 🎤 Mic     │────────>│ :8889         │           │ HLS     │  │
  │  └────────────┘         └───────────────┘           │ JPEG    │  │
  │                                                     └────┬────┘  │
  │                                                          │       │
  │  ┌───────────────────────────────────────────────────────┤       │
  │  │ Node.js (Oasis :3000)                                 │       │
  │  │ Sirve HTML con <img>/<video> apuntando a go2rtc       │       │
  │  └───────────────────────────────────────────────────────┘       │
  └──────────────────────────────────────────────────────────────────┘
```

**Ventaja** de este patrón: el encode H.264 lo hace el HW del RPi vía RPi-WebRTC (zero-copy), y go2rtc re-sirve sin re-encode como MJPEG/HLS al browser sin JS. **Lo mejor de ambos mundos**.

**Desventaja**: dos procesos de media (~30 MB RPi-WebRTC + ~20 MB go2rtc = ~50 MB) vs. solo go2rtc (~20–40 MB) capturando directamente de v4l2. El beneficio de CPU puede no compensar el coste de RAM en un dispositivo de 1 GB.

---

## EXT-4. Impacto CSI/USB en §2.1 — Retransmisión al navegador

> **Extiende**: [web-rtc.md §2.1 — Alternativas de retransmisión HTML/CSS al navegador](./web-rtc.md#21-alternativas-de-retransmisión-htmlcss-al-navegador).

La tabla de "Recomendación por escenario" del documento original es idéntica para CSI y USB en lo que respecta al **formato de entrega** al navegador (MJPEG, HLS, WAV, OGG). Lo que cambia es el **pipeline servidor** que genera esos formatos:

| Formato de entrega | Pipeline con CSI | Pipeline con USB | Diferencia CPU |
|---|---|---|---|
| **MJPEG** `<img>` | `rpicam-vid --codec mjpeg -o -` → HTTP | `ffmpeg -f v4l2 -input_format mjpeg -i /dev/video0 -c:v copy` → HTTP | ~0% (ambos leen MJPEG nativo o lo generan en HW) |
| **HLS** `<video>` | `rpicam-vid --codec h264 -o -` → `ffmpeg -f h264 -i - -f hls` | `ffmpeg -f v4l2 -input_format mjpeg -i /dev/video0 -c:v h264_v4l2m2m -f hls` | CSI: ~5% CPU (encode HW). USB: ~15% CPU (decode MJPEG + encode HW) |
| **HLS (USB con H.264 HW)** | N/A | `ffmpeg -f v4l2 -input_format h264 -i /dev/video0 -c:v copy -f hls` | ~3% CPU (passthrough) |

**Implicación directa**: para **Fase 3 (Internet)** donde se recomienda HLS por eficiencia de BW, lo que **CSI gana ~10% de CPU** vs. USB es significativo. En un dispositivo solar con budget de 22W, esos ciclos de CPU se traducen en vatios.

---

## EXT-5. Impacto CSI/USB + RPi-WebRTC en §2.2 — Servidores media dedicados

> **Extiende**: [web-rtc.md §2.2 — Servidor media dedicado](./web-rtc.md#22-servidor-media-dedicado-la-alternativa-fuera-de-la-caja) completo.

### EXT-5A. Arquitectura 1 (go2rtc): CSI vs. USB

**go2rtc.yaml para CSI**:
```yaml
streams:
  solar-cam:
    - v4l2:///dev/video0      # CSI expuesta como V4L2
    # Alternativa más eficiente: usar rpicam-vid como fuente exec
    # - exec:rpicam-vid -t 0 --codec h264 --inline --width 1280 --height 720 -o -
  solar-mic:
    - alsa:///default
api:
  listen: "127.0.0.1:1984"
```

**go2rtc.yaml para USB**:
```yaml
streams:
  solar-cam:
    - v4l2:///dev/video0      # USB (UVC) — go2rtc lee MJPEG de V4L2
    # Si la webcam soporta H.264 nativo:
    # - v4l2:///dev/video0#format=h264
  solar-mic:
    - alsa:///default
api:
  listen: "127.0.0.1:1984"
```

**Diferencias operativas**:

| | go2rtc + CSI | go2rtc + USB |
|---|---|---|
| **Captura** | V4L2 o exec rpicam-vid | V4L2 directo (MJPEG/YUYV) |
| **Encode H.264** | HW vía rpicam-vid exec (si se usa esa fuente) | Solo si webcam lo entrega nativo; sino, software en go2rtc |
| **RAM** | ~20–30 MB | ~20–40 MB (MJPEG→H.264 en memoria si hay re-encode) |
| **CPU** | ~5–10% | ~10–20% (depende de re-encode) |
| **Config Docker** | `--device /dev/video0 --device /dev/vchiq` | `--device /dev/video0` |

### EXT-5B. Arquitectura 2 (MediaMTX): CSI vs. USB

MediaMTX tiene una **ventaja diferencial para CSI**: soporta `rpicam-vid` como fuente nativa, obteniendo H.264 HW sin ffmpeg intermedio.

**mediamtx.yml para CSI**:
```yaml
paths:
  solar-cam:
    source: rpiCamera
    rpiCameraWidth: 1280
    rpiCameraHeight: 720
    rpiCameraFPS: 25
    rpiCameraCodec: h264
    rpiCameraProfile: baseline
    rpiCameraLevel: "3.1"
    rpiCameraBitrate: 1000000
```

**mediamtx.yml para USB**:
```yaml
paths:
  solar-cam:
    # USB requiere ffmpeg como fuente (MediaMTX no lee UVC directo como go2rtc)
    runOnInit: >
      ffmpeg -f v4l2 -input_format mjpeg -video_size 1280x720 -framerate 25
      -i /dev/video0 -c:v h264_v4l2m2m -b:v 1M
      -f rtsp rtsp://localhost:$RTSP_PORT/$MTX_PATH
    runOnInitRestart: yes
```

| | MediaMTX + CSI | MediaMTX + USB |
|---|---|---|
| **Fuente** | `rpiCamera` nativo (zero-copy) | ffmpeg exec → RTSP local |
| **ffmpeg necesario** | ❌ No | ✅ Sí (decode MJPEG + encode H.264 → RTSP) |
| **CPU** | ~5% (HW encode directo) | ~15–20% (ffmpeg transcoding) |
| **Complejidad config** | 10 líneas YAML | 10 líneas YAML + ffmpeg command |
| **Auto-conversión** | RTSP→HLS→WebRTC automática | Igual (una vez el stream RTSP existe) |

**Veredicto**: MediaMTX es **óptima para CSI** (zero-copy nativo) y **subóptima para USB** (necesita ffmpeg). go2rtc es más equilibrada para ambas.

### EXT-5C. Arquitectura 3 (Mumble hybrid): CSI vs. USB

La Arquitectura 3 del documento original usa go2rtc para vídeo y Mumble para audio. El impacto CSI/USB se hereda del análisis de go2rtc (EXT-5A):

```
  Arq. 3 + CSI                              Arq. 3 + USB
  ════════════                               ════════════

  🎤 Mic ──> murmurd (audio)                🎤 Mic ──> murmurd (audio)
  🎥 CSI ──> go2rtc (v4l2/rpicam)           🎥 USB ──> go2rtc (v4l2 MJPEG)
              │                                          │
              └─ MJPEG/HLS → <img>/<video>               └─ MJPEG/HLS → <img>/<video>

  Audio: idéntico en ambos (Mumble)
  Vídeo: CSI ~5-10% CPU / USB ~10-20% CPU
  RAM total: ~65 MB (CSI) / ~75 MB (USB, por buffer MJPEG→H.264)
```

**Recomendación refinada para Arq. 3**: si se usa **USB**, considerar MediaMTX en vez de go2rtc NO tiene ventaja (ambos necesitan ffmpeg para USB). go2rtc captura v4l2 directo sin ffmpeg, por lo que sigue siendo preferible para USB.

### EXT-5D. Arquitectura 5 — RPi-WebRTC como vía nativa (★ nueva)

> **Nueva arquitectura** no presente en el documento original.

Esta arquitectura posiciona a RPi-WebRTC como el servidor de captura y encode, con un proxy HTTP para consumo sin JS.

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                    Raspberry Pi 3B (Solar Net Hub)                  │
  │                                                                     │
  │  ┌────────────┐  MMAL     ┌────────────────┐                       │
  │  │ 🎥 Cam CSI │──────────>│ RPi-WebRTC     │                       │
  │  └────────────┘           │ :8889           │                       │
  │                           │ H.264 HW encode │                       │
  │  ┌────────────┐  ALSA     │ + Opus audio    │                       │
  │  │ 🎤 Mic     │──────────>│ + DataChannel   │                       │
  │  └────────────┘           └───┬────────────┘                       │
  │                               │ WebRTC (localhost SRTP)             │
  │                               │                                     │
  │  ┌────────────────────────────┴────────────────────────────────────┐│
  │  │               Node.js (Oasis :3000)                             ││
  │  │                                                                 ││
  │  │  ┌─────────────────────────────────────────────────────┐        ││
  │  │  │  WebRTC Consumer (node-datachannel)                 │        ││
  │  │  │  Conecta como peer a RPi-WebRTC (localhost)         │        ││
  │  │  │  Recibe H.264 RTP → decode → MJPEG/HLS             │        ││
  │  │  │  Recibe Opus RTP → decode → OGG/WAV                │        ││
  │  │  └────────────┬────────────────────┬───────────────────┘        ││
  │  │               │                    │                            ││
  │  │  GET /video → MJPEG stream    GET /audio → OGG stream          ││
  │  │                                                                 ││
  │  │  webrtc_view.js → <img src="/video"> + <audio src="/audio">     ││
  │  └─────────────────────────────────────────────────────────────────┘│
  └─────────────────────────────────────────────────────────────────────┘
```

| | Arq. 5 (RPi-WebRTC) |
|---|---|
| **Complejidad** | Alta (compilar RPi-WebRTC + consumer Node.js) |
| **RAM** | ~80–100 MB (RPi-WebRTC ~40 MB + node-datachannel decode + ffmpeg) |
| **CPU (CSI)** | ~15–20% (encode HW) + ~10% (decode en Node.js para MJPEG) |
| **Cámara USB** | ❌ **No soportada** — descarta esta arquitectura si se usa USB |
| **Cero JS en browser SNH** | ✅ (el consumer Node.js reconvierte a MJPEG/HLS) |
| **WebRTC P2P remoto** | ✅ (RPi-WebRTC habla WebRTC nativo con browsers remotos) |
| **Funciona sobre Tor** | ⚠️ WebRTC necesita TURN. Peor que Arq. 3 (Mumble) para audio |
| **Gran ventaja** | Peer remoto con browser estándar (Chrome/Firefox) puede ver stream WebRTC nativo con latencia ~100 ms, sin go2rtc ni MediaMTX intermedios |
| **Gran desventaja** | Complejidad de compilación, sin soporte USB, proyecto con mantenimiento irregular |

**¿Cuándo elegir Arq. 5?**:
- Se usa **solo cámara CSI** (requisito hard).
- Se necesita **WebRTC P2P nativo** con el peer remoto (no MJPEG/HLS, sino video WebRTC real con latencia <100 ms).
- Se acepta la complejidad de compilar y mantener RPi-WebRTC.
- El peer remoto **no pasa por Tor** (WebRTC directo o con STUN/TURN convencional).

**¿Cuándo NO elegir Arq. 5?**:
- Se usa o podría usar **cámara USB** → RPi-WebRTC no funciona.
- Se necesita **funcionar sobre Tor** → WebRTC no es viable.
- Se prefiere **componentes mantenidos activamente** → RPi-WebRTC tiene mantenimiento irregular.
- **La RAM es crítica** → ~80–100 MB es mucho para un device de 1 GB.

---

## EXT-6. Impacto en §3 — Implementación: Caminos A, B, C + nuevo Camino D

> **Extiende**: [web-rtc.md §3 — Implementación](./web-rtc.md#3-implementación).

### Refactorización de los caminos existentes para cubrir CSI/USB

Los caminos A, B y C del documento original necesitan un paso previo: **detección del tipo de cámara**. Se añade como Fase 0 común a los tres caminos:

**Fase 0: Detección de hardware (común a todos los caminos)**

| Fichero | Líneas est. | Función |
|---|---|---|
| `hardware_detect.js` | ~50 | Detecta si hay cámara CSI (vía `libcamera-hello --list-cameras`) o USB (vía `v4l2-ctl --list-devices`). Retorna `{ type: 'csi' | 'usb' | 'usb-h264' | 'none', device: '/dev/video0', formats: [...] }` |

```js
// Pseudocódigo hardware_detect.js (esquema, no implementación)
// Detectar tipo de cámara:
// 1. Ejecutar libcamera-hello --list-cameras
//    Si retorna cámaras → type: 'csi'
// 2. Si no, ejecutar v4l2-ctl --list-devices
//    Para cada /dev/videoN: v4l2-ctl --list-formats-ext
//    Si tiene H264 → type: 'usb-h264'
//    Si tiene MJPG  → type: 'usb'
//    Si solo YUYV   → type: 'usb' (YUYV)
// 3. Retornar info al caller para elegir pipeline
```

### Caminos existentes — delta CSI/USB

| Camino | Impacto CSI→USB | Ficheros afectados |
|---|---|---|
| **A: node-datachannel + ffmpeg** | El comando ffmpeg de captura cambia (`rpicam-vid` para CSI vs. `ffmpeg -f v4l2` para USB). `media_capture.js` necesita branch por tipo de cámara | `media_capture.js`, `hardware_detect.js` (nuevo) |
| **B: go2rtc** | `go2rtc.yaml` cambia la fuente (`exec:rpicam-vid` vs. `v4l2:///dev/video0`). Config seleccionable | `go2rtc.yaml` (template con variable), `hardware_detect.js` |
| **C: Mumble hybrid** | Mismo que B para la parte de vídeo (go2rtc). Audio (Mumble) no cambia | `go2rtc.yaml`, `hardware_detect.js` |

### Camino D: RPi-WebRTC + proxy (nuevo, solo CSI)

| Fase | Alcance | Ficheros / componentes |
|---|---|---|
| **0. Detección HW** | Verificar que hay CSI presente. Abortar si solo USB | `hardware_detect.js` |
| **1. DataChannel** | Idéntico al camino A | `webrtc_model.js`, `webrtc_view.js`, `backend.js` |
| **2. Señalización SSB** | Idéntico al camino A | `signaling/ssb.js`, `signaling/index.js` |
| **3. Captura + encode** | RPi-WebRTC captura CSI + encode H.264 HW + Opus audio. Servidor en `:8889` | `rpi-webrtc-streamer` (binario C++, pre-compilado ARM64) |
| **3b. Proxy WebRTC→HTTP** | Node.js se conecta como peer WebRTC local a RPi-WebRTC, decodifica, y sirve MJPEG/OGG | `media_proxy.js` (~200 líneas), usa `node-datachannel` como consumer |
| **4. File transfer** | Idéntico al camino A | Extensión de `webrtc_model.js` |

```
  webrtc_view.js ─── renderiza HTML con <img>/<video>/<audio> sin JS
       │
  backend.js ───── rutas GET/POST /webrtc/*
       │
  webrtc_model.js ─ estado + node-datachannel (DataChannel para datos)
       │
  media_proxy.js ── consume WebRTC de RPi-WebRTC (localhost:8889)
       │              └─ decode H.264→MJPEG (ffmpeg)
       │              └─ decode Opus→OGG (ffmpeg)
       │              └─ sirve GET /video, GET /audio
       │
  RPi-WebRTC ────── binario C++: CSI → H.264 HW → WebRTC server (:8889)
       │
  signaling/ ───── abstracción: manual | ssb | ssb-lan
```

**Riesgo principal del Camino D**: RPi-WebRTC tiene mantenimiento irregular. Si deja de compilar en aarch64 con kernels nuevos, se necesita mantener el fork. **Mitigación**: usar como fallback el Camino B (go2rtc) que es genérico.

### Camino E: µStreamer + Mumble (solo vídeo MJPEG, audio Mumble)

| Fase | Alcance | Ficheros / componentes |
|---|---|---|
| **0. Detección HW** | `hardware_detect.js` — detecta CSI/USB, elige flags de µStreamer | `hardware_detect.js` |
| **1. DataChannel** | Idéntico al camino A (si se quiere chat P2P) | `webrtc_model.js`, `webrtc_view.js`, `backend.js` |
| **2. Señalización SSB** | Idéntico al camino A | `signaling/ssb.js`, `signaling/index.js` |
| **3. Vídeo** | µStreamer captura V4L2 (CSI o USB) → MJPEG HTTP. Oasis proxies el stream | `ustreamer` (binario C, `apt install` o `make`), config en systemd unit |
| **3b. Audio** | Mumble (murmurd ya corriendo) + bridge HTTP como en Arq. 3 variante 3A | `mumble_bridge.js` (~100 líneas), gumble bot |
| **4. File transfer** | Idéntico al camino A | Extensión de `webrtc_model.js` |

```
  webrtc_view.js ─── renderiza HTML con <img>/<audio> sin JS
       │
  backend.js ───── rutas GET /video (proxy µStreamer), GET /audio (bridge Mumble)
       │
  webrtc_model.js ─ estado + node-datachannel (DataChannel para datos)
       │
  µStreamer ──────── binario C: V4L2 (CSI/USB) → MJPEG HTTP (:8080)
       │
  murmurd ─────── audio bidireccional (ya corriendo, :64738)
       │
  mumble_bridge.js ── bot gumble → Opus→OGG → GET /audio
```

**Riesgo principal del Camino E**: µStreamer solo sirve MJPEG, no HLS. Para peers remotos con baja BW, MJPEG consume ~×10 más ancho de banda que H.264/HLS. **Mitigación**: si surge la necesidad remota, migrar a Camino C (go2rtc) que es drop-in para la parte de vídeo.

### Comparativa actualizada de caminos (con CSI/USB)

| | Camino A | Camino B | Camino C | **Camino D** | **Camino E** |
|---|---|---|---|---|---|
| **Cámara CSI** | ✅ (rpicam-vid) | ✅ (go2rtc exec/v4l2) | ✅ (go2rtc) | ✅ (MMAL/libcamera nativo) | ✅ (V4L2 + M2M HW) |
| **Cámara USB** | ✅ (ffmpeg v4l2) | ✅ (go2rtc v4l2) | ✅ (go2rtc v4l2) | ❌ **No soportada** | ✅ (V4L2 directo) |
| **CPU vídeo CSI** | ~5% (rpicam-vid → ffmpeg copy) | ~5–10% (go2rtc v4l2) | ~5–10% (go2rtc v4l2) | ~15–20% (encode HW + proxy decode) | **~3–8%** (M2M HW) |
| **CPU vídeo USB** | ~15% (ffmpeg transcode) | ~10–20% (go2rtc) | ~10–20% (go2rtc) | N/A | ~15–30% (CPU multihilo) |
| **RAM nueva** | ~80 MB | ~20–40 MB | ~65 MB | ~80–100 MB | **~10–20 MB** |
| **Audio Tor** | ⚠️ TURN | ⚠️ TURN | ✅ Mumble TCP | ⚠️ TURN | ✅ Mumble TCP |
| **WebRTC P2P real** | ✅ | ⚠️ (WHEP, no full P2P) | ⚠️ (solo datos) | ✅ (nativo) | ⚠️ (solo datos) |
| **Cero JS browser SNH** | ✅ | ✅ | ✅ | ✅ (vía proxy) | ✅ |
| **Mantenimiento deps** | Alto (ffmpeg pipes) | Bajo (binario go2rtc) | Medio (gumble + go2rtc) | ⚠️ (RPi-WebRTC irregular) | **Bajo** (µStreamer `apt` + Mumble ya existe) |

---

## EXT-7. Matriz de decisión unificada

> **Extiende**: [web-rtc.md §2.2 — Recomendación](./web-rtc.md#recomendación) y [§2.2 — Comparativa de arquitecturas](./web-rtc.md#comparativa-de-arquitecturas).

### Pregunta: ¿Qué cámara tengo / quiero?

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │           DECISIÓN: CSI / USB / AMBAS                                │
  ├──────────────────────────────────────────────────────────────────────┤
  │                                                                      │
  │  ¿Tengo cámara CSI en RPi?                                          │
  │    SÍ → ¿Quiero máxima eficiencia HW encode?                        │
  │           SÍ → MediaMTX (CSI nativo, zero-copy) → Arq. 2            │
  │                o RPi-WebRTC (si WebRTC P2P nativo) → Arq. 5         │
  │           NO → go2rtc (CSI vía v4l2, simple) → Arq. 1               │
  │                o µStreamer (si solo MJPEG + RAM mínima) → Arq. 6    │
  │                                                                      │
  │  ¿Tengo cámara USB?                                                  │
  │    SÍ → ¿La webcam tiene H.264 HW integrado?                        │
  │           SÍ → go2rtc v4l2 (passthrough) → Arq. 1                   │
  │           NO → go2rtc v4l2 (MJPEG, re-encode si HLS) → Arq. 1      │
  │                o µStreamer v4l2 (si solo MJPEG) → Arq. 6            │
  │         RPi-WebRTC está DESCARTADO (no soporta USB)                  │
  │         MediaMTX requiere ffmpeg para USB → menos ventaja            │
  │                                                                      │
  │  ¿Podría tener ambas (o cambiar en el futuro)?                       │
  │    SÍ → go2rtc + hardware_detect.js (Arq. 1 + Fase 0)              │
  │         o µStreamer + hardware_detect.js (Arq. 6 + Fase 0)          │
  │         Ambas soportan CSI y USB sin cambios                        │
  │                                                                      │
  │  ¿Necesito audio sobre Tor?                                         │
  │    SÍ → Mumble (invariante de CSI/USB)                               │
  │         + go2rtc (si HLS remoto) → Arq. 3                           │
  │         + µStreamer (si solo MJPEG LAN) → Arq. 6                    │
  │                                                                      │
  │  ¿Solo LAN, RAM mínima, pipeline simple?                             │
  │    SÍ → µStreamer + Mumble → Arq. 6 (★ ultra-ligera)               │
  │                                                                      │
  └──────────────────────────────────────────────────────────────────────┘
```

### Tabla cruzada: Cámara × Arquitectura × Fase

| Cámara | Fase 1 (LAN) | Fase 2 (LAN+) | Fase 3 (Internet) | Fase 3 + Tor |
|---|---|---|---|---|
| **CSI** | Arq. 6 (µStreamer, MJPEG, mínima RAM) **o** Arq. 1 (go2rtc, MJPEG+HLS) **o** Arq. 2 (MediaMTX zero-copy) | Arq. 1 o 2 (MJPEG/HLS) | Arq. 3 (Mumble audio + HLS go2rtc) **o** Arq. 5 (RPi-WebRTC P2P) | **Arq. 3** (Mumble TCP tunnel + HLS) |
| **USB** | Arq. 6 (µStreamer, MJPEG) **o** Arq. 1 (go2rtc, MJPEG+HLS) | Arq. 1 (MJPEG/HLS) | Arq. 3 (Mumble + go2rtc HLS) | **Arq. 3** (Mumble TCP tunnel + HLS) |
| **USB con H.264 HW** | Arq. 1 (go2rtc, passthrough) | Arq. 1 (HLS passthrough H.264) | Arq. 3 (Mumble + go2rtc) | **Arq. 3** |
| **Ambas / incierto** | Arq. 6 o 1 + `hardware_detect.js` | Arq. 1 + detect | Arq. 3 + detect | **Arq. 3** + detect |

### Recomendación actualizada (post-extensión)

**La recomendación del documento original (Arq. 3 Mumble hybrid para Fase 3) se mantiene y se refuerza**, porque:

1. **Mumble es agnóstico de cámara** — el audio no depende de CSI/USB.
2. **go2rtc para vídeo soporta CSI y USB** — la opción más flexible para multi-protocolo.
3. **µStreamer + Mumble (Arq. 6) es la alternativa ultra-ligera** para escenarios solo-LAN donde HLS/WebRTC no se necesitan.
4. **MediaMTX zero-copy (CSI) no justifica la pérdida de flexibilidad USB** a menos que los watts ahorrados sean decisivos.
5. **RPi-WebRTC (Arq. 5) es un nicho**: solo CSI, mantenimiento irregular, alta RAM. Se registra para evaluación futura si el proyecto se reactiva y la cámara es CSI fija.

**Recomendación refinada por prioridad**:

| Prioridad | Arquitectura | Condición |
|---|---|---|
| **1ª** | **Arq. 3 (Mumble + go2rtc)** | Siempre válida. CSI + USB. Tor compatible. Audio superior. HLS para remoto |
| **1ª bis** | **Arq. 6 (Mumble + µStreamer)** | Solo LAN / RAM crítica. CSI + USB. Tor compatible. Audio Mumble. MJPEG only. **La más ligera** |
| **2ª** | **Arq. 1 (go2rtc integral)** | Si no se necesita Tor para audio; simplicidad máxima |
| **3ª** | **Arq. 2 (MediaMTX)** | Solo CSI fija; cada mW cuenta; no se prevé USB nunca |
| **4ª** | **Arq. 5 (RPi-WebRTC)** | Solo CSI fija; se necesita WebRTC P2P real; no Tor; se acepta riesgo de mantenimiento |
| **5ª** | **Camino A (todo Node.js)** | Máximo control del código; dispuesto a mantener ffmpeg pipelines complejos |

---

## EXT-8. Extensión del glosario (§4)

> **Extiende**: [web-rtc.md §4 — Glosario](./web-rtc.md#4-glosario).

| Sigla | Nombre completo | Función en una línea |
|---|---|---|
| **CSI-2** | Camera Serial Interface 2 (MIPI) | Bus serie de alta velocidad entre sensor de imagen y SoC; 2 o 4 data lanes D-PHY |
| **MIPI** | Mobile Industry Processor Interface | Consorcio que define los estándares CSI y DSI para cámaras y displays en dispositivos embebidos |
| **UVC** | USB Video Class | Estándar USB para cámaras; permite plug-and-play sin driver propietario (driver `uvcvideo` en Linux) |
| **MMAL** | Multi-Media Abstraction Layer | API legacy del VideoCore IV (RPi ≤4) para acceder al ISP y encoder H.264 HW; reemplazada por libcamera |
| **libcamera** | (nombre propio) | Framework de cámara moderno de Linux; abstrae ISP y sensores. Usado por `rpicam-vid`. No soporta cámaras USB |
| **rpicam-vid** | Raspberry Pi Camera Video | Herramienta CLI del stack `rpicam-apps` para captura de vídeo desde cámaras CSI vía libcamera |
| **V4L2 M2M** | Video4Linux 2 Memory-to-Memory | Interfaz del kernel Linux para dispositivos de transformación de vídeo (ej. encode H.264 en GPU) |
| **D-PHY** | Data Physical Layer (MIPI) | Capa física de la interfaz CSI-2; define señalización diferencial para data lanes y reloj |
| **ISP** | Image Signal Processor | Unidad de la GPU que procesa RAW Bayer del sensor: debayer, balance de blancos, exposición, noise reduction |
| **WHEP** | WebRTC-HTTP Egress Protocol | Estándar IETF para consumir streams WebRTC vía HTTP simple (sin señalización custom) |
| **RPi-WebRTC** | rpi-webrtc-streamer | Servidor WebRTC nativo C++ para RPi; encode H.264 HW vía MMAL/libcamera; solo cámaras CSI |
| **FFC** | Flat Flexible Cable | Cable ribbon utilizado para conectar cámaras CSI a los puertos 15-pin/22-pin de la RPi |
| **hot-plug** | (concepto) | Capacidad de conectar/desconectar un dispositivo en caliente sin apagar el sistema; USB sí, CSI no |
| **µStreamer** | (nombre propio, también ustreamer) | Servidor HTTP MJPEG ultraligero en C, parte del proyecto PiKVM; captura de cualquier V4L2 (CSI+USB); encode JPEG multihilo o HW M2M |
| **memsink** | Memory Sink (shared memory) | Mecanismo de µStreamer para compartir frames H.264 vía memoria compartida POSIX con otros procesos (ej. Janus plugin) |
| **PiKVM** | Pi Keyboard Video Mouse | Proyecto open-source para construir un KVM-over-IP con Raspberry Pi; µStreamer es su componente de vídeo |
| **M2M (encode)** | Memory-to-Memory image encoder | Encoder V4L2 que toma frames de memoria y produce JPEG/H.264 vía GPU RPi; usado por `--encoder=m2m-image` en µStreamer |

---

<!-- ═══════════ PATCH 2 — µStreamer ═══════════ -->

## EXT-9. µStreamer: ficha técnica del proyecto

> **Extiende**: [web-rtc.md §1.6.2 — Librerías WebRTC en otros lenguajes](./web-rtc.md#162-librerías-webrtc-en-otros-lenguajes-relevantes-para-22) y [§2.2 — Servidor media dedicado](./web-rtc.md#22-servidor-media-dedicado-la-alternativa-fuera-de-la-caja).
>
> **Motivo**: el documento original evalúa go2rtc, MediaMTX y Janus como servidores media, y la extensión EXT-3 añade RPi-WebRTC. Falta **µStreamer** (pikvm/ustreamer), un servidor MJPEG ultraligero escrito en C que encaja de forma natural con la restricción "cero JS en cliente" de Oasis: su salida principal (**MJPEG sobre HTTP**) es exactamente el formato que `<img src="/stream">` consume sin JavaScript.

### 9.1 ¿Qué es µStreamer?

µStreamer es un servidor HTTP de streaming MJPEG diseñado para capturar vídeo de **cualquier dispositivo V4L2** (cámaras CSI, USB, capturas HDMI) y servirlo con la menor latencia y el mayor FPS posibles. Es el componente de vídeo del proyecto [PiKVM](https://github.com/pikvm/pikvm) (KVM-over-IP en Raspberry Pi), creado por Maxim Devaev.

A diferencia de go2rtc o MediaMTX (servidores multi-protocolo), µStreamer hace **una sola cosa**: MJPEG HTTP. Lo hace extremadamente bien y con un footprint mínimo.

| | µStreamer |
|---|---|
| **Lenguaje** | C (95.8%), ~6k LOC. Sin runtime (no Go, no Node.js, no JVM) |
| **Repo** | [github.com/pikvm/ustreamer](https://github.com/pikvm/ustreamer) |
| **Versión** | 6.55 (marzo 2026, activamente mantenido) |
| **Estrellas** | ~2k ★, 273 forks, 42 contributors |
| **Licencia** | **GPL-3.0** |
| **Proyecto padre** | [PiKVM](https://pikvm.org/) |
| **Captura** | Cualquier dispositivo V4L2: **CSI** (vía `bcm2835-v4l2` + `libcamerify`), **USB** (UVC directo), **HDMI** (TC358743) |
| **Encode vídeo** | JPEG multihilo (CPU) **o** V4L2 M2M (HW encode en GPU RPi). Kernel ≥5.15.32 para M2M |
| **Encode H.264** | Vía `--h264-sink` (memsink): genera H.264 en shared memory para consumo por Janus plugin |
| **Transporte** | HTTP MJPEG (`multipart/x-mixed-replace`). Snapshot JPEG (`/snapshot`). Compatibilidad con API mjpg-streamer |
| **Audio** | ❌ Solo vídeo en modo normal. Audio (ALSA → Opus) solo con plugin Janus (`WITH_JANUS=1`) |
| **RAM típica** | ~5–15 MB (C puro, deps mínimas: libevent, libjpeg-turbo, libbsd) |
| **CPU RPi 3B** | ~3–8% con M2M HW encode @ 720p; ~15–30% con encode CPU multihilo |
| **Binario** | ~2–5 MB (compilado, sin deps estáticas externas) |
| **Docker** | `pikvm/ustreamer:latest` (imágenes oficiales ARM) |
| **Paquetes** | Debian, Ubuntu, Fedora, Arch (AUR), OpenWRT, FreeBSD |
| **Cámara CSI** | ✅ `modprobe bcm2835-v4l2` + `libcamerify ./ustreamer --encoder=m2m-image` |
| **Cámara USB** | ✅ Directo: `./ustreamer --device=/dev/video0` |
| **Estado** | ✅ Mantenimiento activo. Releases frecuentes. Discord community |

**Características diferenciales vs. mjpg-streamer** (su predecesor):

| Característica | µStreamer | mjpg-streamer |
|---|---|---|
| Encode JPEG multihilo | ✅ | ❌ |
| HW encode RPi (M2M) | ✅ | ❌ |
| Desconexión de dispositivo | Muestra pantalla `NO LIVE VIDEO` | Se detiene |
| DV-timings (cambio de resolución en caliente) | ✅ | Parcial |
| Drop-same-frames (ahorro de tráfico) | ✅ `--drop-same-frames=N` | ❌ |
| UNIX domain socket | ✅ | ❌ |
| Systemd socket activation | ✅ | ❌ |
| GPIO signaling (libgpiod) | ✅ | ❌ |
| Servir archivos estáticos desde HTTP server | ✅ | Solo regulares |
| Compatibilidad API mjpg-streamer | ✅ | N/A |

### 9.2 µStreamer vs. los otros servidores media

| Criterio | µStreamer | go2rtc | MediaMTX | RPi-WebRTC | Janus |
|---|---|---|---|---|---|
| **Salida principal** | MJPEG HTTP | MJPEG, HLS, WebRTC (WHEP), RTSP, snapshots | RTSP, HLS, WebRTC, MJPEG | WebRTC nativo (SRTP) | WebRTC nativo |
| **Cámara CSI** | ✅ vía V4L2 + libcamerify | ✅ vía V4L2 | ✅ rpicam nativo (zero-copy) | ✅ MMAL/libcamera directo | ⚠️ Requiere fuente RTSP/RTP |
| **Cámara USB** | ✅ V4L2 directo | ✅ V4L2 directo | ✅ V4L2 directo | ❌ No | ⚠️ Requiere fuente |
| **Encode HW RPi** | ✅ V4L2 M2M (JPEG) | ⚠️ Solo si fuente ya es H.264 | ✅ rpicam (CSI) / ffmpeg (USB) | ✅ MMAL/libcamera (H.264) | Depende de fuente |
| **HLS** | ❌ | ✅ | ✅ | ❌ | ❌ (necesita proxy) |
| **WebRTC nativo** | ❌ (solo vía Janus plugin) | ✅ WHEP | ✅ | ✅ | ✅ |
| **Audio streaming** | ❌ (solo vía Janus) | ✅ ALSA directo | ✅ | ✅ Opus (libwebrtc) | ✅ (plugins) |
| **Navegador sin JS** | ✅ MJPEG en `<img>` | ✅ MJPEG/HLS en `<img>`/`<video>` | ✅ MJPEG/HLS | ❌ Requiere JS | ❌ Requiere JS |
| **Funciona sobre Tor** | ✅ (HTTP puro) | ⚠️ MJPEG/HLS sí; WebRTC no | ⚠️ MJPEG/HLS sí; WebRTC no | ❌ | ❌ |
| **RAM** | **~5–15 MB** | ~20–40 MB | ~15–30 MB | ~30–50 MB | ~10–20 MB |
| **Lenguaje** | C | Go | Go | C++ (libwebrtc) | C |
| **Licencia** | GPL-3.0 | MIT | MIT | BSD | GPL-3.0 |
| **Complejidad instalación** | Baja (`apt install` o `make`) | Baja (binario pre-compilado) | Baja (binario pre-compilado) | Alta (cross-compile libwebrtc) | Media (C, deps) |
| **Madurez** | ✅ Activo (2k★, v6.55) | ✅ Activo (7k★) | ✅ Activo (13k★) | ⚠️ Irregular desde 2023 | ✅ Activo (8.5k★) |

**Lectura clave de la tabla**: µStreamer es el **más ligero** de todos y el **único** cuya salida principal (MJPEG HTTP) es directamente consumible en `<img>` sin conversión ni protocolo intermedio. go2rtc también sirve MJPEG, pero es ×3–4 más pesado en RAM porque mantiene toda la maquinaria multi-protocolo.

### 9.3 Arquitectura interna de µStreamer

```
  ┌─────────────────────────────────────────────────────────────────────┐
  │                     µStreamer (C, ~5-15 MB RAM)                      │
  │                                                                     │
  │  ┌────────────┐  V4L2     ┌───────────────────────┐                │
  │  │ 🎥 Cámara  │─────────>│ Capture Ring Buffer    │                │
  │  │ CSI / USB  │          │ (mmap V4L2 buffers)    │                │
  │  └────────────┘          └──────────┬────────────┘                │
  │                                     │                              │
  │              ┌──────────────────────┼───────────────────┐          │
  │              │                      │                   │          │
  │     ┌────────┴────────┐   ┌────────┴────────┐  ┌───────┴───────┐ │
  │     │ JPEG Worker #1  │   │ JPEG Worker #2  │  │ JPEG Worker #N│ │
  │     │ (CPU o M2M HW)  │   │ (CPU o M2M HW)  │  │ (CPU o M2M HW)│ │
  │     └────────┬────────┘   └────────┬────────┘  └───────┬───────┘ │
  │              │                      │                   │          │
  │              └──────────────────────┼───────────────────┘          │
  │                                     │                              │
  │  ┌──────────────────────────────────┴────────────────────────────┐ │
  │  │               HTTP Server (libevent)                          │ │
  │  │                                                               │ │
  │  │  GET /stream → multipart/x-mixed-replace (MJPEG continuo)    │ │
  │  │  GET /snapshot → image/jpeg (último frame)                    │ │
  │  │  GET / → página de status + enlaces                           │ │
  │  └──────────────┬───────────────────────────────────────────────┘ │
  │                 │                                                  │
  │  (opcional)     │  --h264-sink                                     │
  │  ┌──────────────┴──────────────────┐                               │
  │  │ H.264 M2M Encoder              │                               │
  │  │ → Shared Memory (memsink)       │                               │
  │  │ → Janus plugin lee de aquí      │                               │
  │  └─────────────────────────────────┘                               │
  └─────────────────────────────────────────────────────────────────────┘
              │ HTTP (:8080)                           │ memsink (SHM)
              ▼                                        ▼
  ┌─────────────────────────┐           ┌──────────────────────────────┐
  │ Navegador (SIN JS)      │           │ Janus Gateway (opcional)     │
  │ <img src="/stream">     │           │ → WebRTC al peer remoto      │
  │ <img src="/snapshot">   │           │ (necesita JS en ese browser) │
  └─────────────────────────┘           └──────────────────────────────┘
```

### 9.4 El encaje natural con Oasis: MJPEG nativo, cero JS

A diferencia de RPi-WebRTC (cuya salida WebRTC **requiere JS en el browser**, ver [EXT-3 §3.4](#34-el-problema-fundamental-para-oasis-js-en-cliente)), µStreamer tiene un **encaje directo e inmediato** con la restricción de Oasis:

| Propiedad | µStreamer | RPi-WebRTC | go2rtc |
|---|---|---|---|
| ¿La salida principal funciona sin JS? | ✅ **Sí** — MJPEG en `<img>` | ❌ Necesita `RTCPeerConnection` | ✅ Sí (MJPEG/HLS) |
| ¿Necesita proxy/reconversión para Oasis? | ❌ **No** — sirve MJPEG directamente | ✅ Sí (proxy WebRTC→MJPEG) | ❌ No |
| ¿Streaming de audio? | ❌ No (solo vídeo) | ✅ Opus nativo | ✅ ALSA/OGG/HLS |
| ¿RAM adicional? | **~5–15 MB** | ~30–50 MB + proxy ~30 MB | ~20–40 MB |
| ¿Soporta CSI + USB? | ✅ Ambas | ❌ Solo CSI | ✅ Ambas |
| ¿Funciona sobre Tor? | ✅ (HTTP puro) | ❌ | ⚠️ Solo MJPEG/HLS |

**La observación clave**: µStreamer es el **único** servidor evaluado donde la salida principal es exactamente lo que Oasis necesita, sin conversión, sin proxy, sin overhead. Es el camino más corto entre la cámara y `<img>`.

**Limitación principal**: solo vídeo. Para audio, se necesita otro componente (Mumble, go2rtc, ffmpeg, etc.).

### 9.5 Patrón directo: µStreamer → Oasis (el más simple posible)

```
  ┌────────────────────────────────────────────────────────────────────┐
  │                    Raspberry Pi 3B (Solar Net Hub)                  │
  │                                                                    │
  │  ┌────────────┐  V4L2    ┌──────────────────┐                     │
  │  │ 🎥 Cam     │─────────>│ µStreamer :8080   │                     │
  │  │ CSI / USB  │          │ --encoder=m2m-image (CSI)               │
  │  └────────────┘          │ (sin flag = CPU encode para USB)        │
  │                          │ GET /stream → MJPEG                     │
  │                          │ GET /snapshot → JPEG                    │
  │                          └───────────┬────────┘                    │
  │                                      │ localhost                    │
  │  ┌───────────────────────────────────┴──────────────────────────┐  │
  │  │ Node.js (Oasis :3000)                                        │  │
  │  │                                                              │  │
  │  │  GET /video → proxy a http://localhost:8080/stream           │  │
  │  │  webrtc_view.js → <img src="/video">                         │  │
  │  │                                                              │  │
  │  │  (audio vía otro componente: Mumble / go2rtc / ffmpeg)       │  │
  │  └──────────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────────┘
```

**Proxy o redirect**: Oasis puede:
- **a) Proxy** (recomendado): Node.js hace pipe del stream MJPEG de µStreamer al browser. Añade ~0 latencia. Beneficio: un solo puerto expuesto (:3000), headers de seguridad (CORS, CSP) controlados por Oasis.
- **b) Redirect directo**: `<img src="http://localhost:8080/stream">`. Más simple pero expone el puerto de µStreamer; no viable si se accede desde fuera del dispositivo.

**Comandos de inicio según cámara**:

```bash
# CSI (v3 cam, Bookworm) — HW encode JPEG vía M2M
sudo modprobe bcm2835-v4l2
libcamerify ustreamer --host 127.0.0.1 --port 8080 --encoder=m2m-image --workers=3

# USB (webcam UVC) — CPU encode multihilo
ustreamer --host 127.0.0.1 --port 8080 --device=/dev/video0 --workers=3

# USB con drop-same-frames (ahorro BW si imagen estática frecuente)
ustreamer --host 127.0.0.1 --port 8080 --device=/dev/video0 --workers=3 --drop-same-frames=20
```

**Lo que falta en este patrón**: audio. µStreamer no hace audio. Soluciones:
- Mumble (ya instalado) para audio bidireccional → combina con este patrón en Arq. 6 ([EXT-10B](#ext-10b-arquitectura-6--µstreamer--mumble-ultra-ligera)).
- ffmpeg captura ALSA → OGG chunked por HTTP → `<audio>` (Camino A del original).
- go2rtc para audio ALSA → OGG (pero si usas go2rtc para audio, ¿por qué no usarlo también para vídeo?).

### 9.6 µStreamer + Janus: H.264/WebRTC para el peer remoto

µStreamer puede generar H.264 vía V4L2 M2M y compartirlo con Janus Gateway a través de shared memory (memsink). Esto permite streaming WebRTC eficiente al peer remoto.

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │                    Raspberry Pi 3B (Solar Net Hub)                      │
  │                                                                        │
  │  ┌────────────┐  V4L2    ┌──────────────────────┐                     │
  │  │ 🎥 Cam     │─────────>│ µStreamer             │                     │
  │  │ CSI / USB  │          │ :8080 (MJPEG→Oasis)  │                     │
  │  └────────────┘          │                      │                     │
  │                          │ --h264-sink=demo::h264│                     │
  │                          │ (shared memory)       │                     │
  │                          └───┬──────────┬───────┘                     │
  │                              │ MJPEG    │ memsink H.264               │
  │                              │          ▼                              │
  │  ┌────────────┐  ALSA   ┌───┼──────────────────┐                     │
  │  │ 🎤 Mic     │────────>│   │ Janus Gateway     │                     │
  │  └────────────┘ (Opus)  │   │ + plugin ustreamer│                     │
  │                         │   │ + audio Opus       │                     │
  │                         │   │ :8188 (WebSocket)  │                     │
  │                         │   └─────────┬─────────┘                     │
  │                         │             │ WebRTC (SRTP)                   │
  │  ┌──────────────────────┴─────────────┤                                │
  │  │ Oasis :3000                        │                                │
  │  │ <img src="/video"> (MJPEG local)   │                                │
  │  └────────────────────────────────────┘                                │
  └───────────────────────────────────────┼────────────────────────────────┘
                                          │ Internet / LAN
                          ┌───────────────┴───────────────────────────┐
                          │ Peer remoto (CON JavaScript)               │
                          │ Janus JS client → RTCPeerConnection        │
                          │ <video autoplay> H.264 + Opus              │
                          └────────────────────────────────────────────┘
```

**Ventajas de este patrón**:
- H.264 eficiente para el peer remoto (×10 menos BW que MJPEG).
- Audio Opus integrado (vía Janus audio capture).
- El browser local del SNH sigue usando MJPEG sin JS (doble salida simultánea).

**Desventajas**:
- Janus Gateway añade ~10–20 MB RAM + complejidad de compilación/config.
- El peer remoto **necesita JavaScript** (Janus JS client).
- Janus es GPL-3.0 (coincide con µStreamer; sin problema de licencia).
- La señalización es vía Janus WebSocket, no vía SSB dataChannels.
- **No funciona sobre Tor** (WebRTC + ICE incompatible).

**¿Cuándo usar este patrón?**: Cuando hay un peer remoto con browser estándar que necesita vídeo H.264 eficiente, Y además se quiere MJPEG sin JS en el browser local. Es el patrón de **doble consumo**: local MJPEG + remoto WebRTC, desde una sola instancia de µStreamer.

**Comparación con go2rtc WHEP**: go2rtc también ofrece WebRTC vía WHEP, pero no necesita Janus — está integrado. Si se necesita WebRTC remoto, go2rtc puede ser más práctico que µStreamer + Janus. El punto fuerte de µStreamer es cuando **solo** se necesita MJPEG local (sin WebRTC remoto) y se busca el mínimo RAM.

---

## EXT-10. Impacto de µStreamer en §2.2 — Nueva Arq. 6

> **Extiende**: [web-rtc.md §2.2 — Servidor media dedicado](./web-rtc.md#22-servidor-media-dedicado-la-alternativa-fuera-de-la-caja) y [EXT-5](#ext-5-impacto-csiusb--rpi-webrtc-en-22--servidores-media-dedicados).

### EXT-10A. µStreamer como alternativa a go2rtc para MJPEG

go2rtc es la "navaja suiza" (Arq. 1): MJPEG + HLS + WebRTC + RTSP en un binario Go de ~15 MB. Pero si el caso de uso se reduce a **solo MJPEG para el browser local**, toda esa maquinaria es overhead innecesario.

| Criterio | go2rtc | µStreamer |
|---|---|---|
| **RAM** | ~20–40 MB | **~5–15 MB** |
| **MJPEG HTTP** | ✅ | ✅ |
| **HLS** | ✅ | ❌ |
| **WebRTC (WHEP)** | ✅ | ❌ (solo vía Janus) |
| **RTSP** | ✅ | ❌ |
| **Audio streaming** | ✅ ALSA/OGG/HLS | ❌ (solo vía Janus) |
| **HW JPEG encode** | ❌ (passthrough si fuente ya MJPEG) | ✅ V4L2 M2M nativo |
| **Snapshots JPEG** | ✅ | ✅ |
| **Drop-same-frames** | ❌ | ✅ (ahorro tráfico) |
| **Captura V4L2 directa** | ✅ | ✅ |
| **Captura ALSA directa** | ✅ | ❌ |
| **Config** | YAML (`go2rtc.yaml`) | CLI flags |
| **Paquete Debian** | ❌ (binario manual) | ✅ `apt install ustreamer` |

**Cuándo µStreamer reemplaza a go2rtc**: cuando **solo se necesita vídeo MJPEG** (no HLS, no RTSP, no WebRTC, no audio streaming), y cada MB de RAM cuenta. En el RPi 3B de 1 GB, ahorrar ~15–25 MB de RAM es significativo.

**Cuándo NO reemplaza**: cuando se necesita HLS para peers remotos con alta latencia, audio integrado, o WebRTC sin la complejidad de Janus.

### EXT-10B. Arquitectura 6 — µStreamer + Mumble (ultra-ligera)

Esta arquitectura combina µStreamer para vídeo MJPEG con Mumble (ya instalado) para audio bidireccional. Es la **combinación más ligera en RAM** de todas las evaluadas.

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │                    Raspberry Pi 3B (Solar Net Hub)                      │
  │                                                                        │
  │  ┌────────────┐  V4L2    ┌──────────────────────┐                     │
  │  │ 🎥 Cam     │─────────>│ µStreamer :8080       │                     │
  │  │ CSI / USB  │          │ MJPEG + Snapshot      │                     │
  │  └────────────┘          └──────────┬───────────┘                     │
  │                                     │ localhost                        │
  │  ┌────────────┐  ALSA    ┌──────────┼───────────┐                     │
  │  │ 🎤 Mic     │────────>│ murmurd (ya corriendo) │                     │
  │  └────────────┘          │ :64738 (Mumble)       │                     │
  │                          └──────────┼───────────┘                     │
  │                                     │                                  │
  │  ┌──────────────────────────────────┴──────────────────────────────┐  │
  │  │ Node.js (Oasis :3000)                                            │  │
  │  │                                                                  │  │
  │  │  GET /video → proxy µStreamer MJPEG                              │  │
  │  │  Audio → bridge Mumble (ver Arq. 3, variante 3A)                │  │
  │  │                                                                  │  │
  │  │  webrtc_view.js → <img src="/video"> + <audio src="/audio">     │  │
  │  └──────────────────────────────────────────────────────────────────┘  │
  └────────────────────────────────────────────────────────────────────────┘
```

| | Arq. 6: µStreamer + Mumble |
|---|---|
| **Complejidad** | Baja–Media (µStreamer trivial + bridge audio = Arq. 3 audio) |
| **RAM adicional** | **~10–20 MB** (µStreamer ~10 MB; murmurd ya corre → +0 MB; bridge audio ~10 MB) |
| **RAM total nuevos procesos** | Menor de todas las arquitecturas evaluadas |
| **Latencia vídeo** | 100–300 ms (MJPEG) |
| **Latencia audio** | ~200 ms (bridge HTTP) / ~20 ms (cliente nativo Mumble) |
| **Necesita ffmpeg** | Solo para bridge audio (Opus→OGG para `<audio>`). No para vídeo |
| **Necesita node-datachannel** | Solo si se quiere DataChannel P2P (datos, no media) |
| **Cero JS en browser SNH** | ✅ |
| **Bidireccional** | ✅ (Mumble = audio bidireccional nativo) |
| **Funciona sobre Tor** | ✅ (MJPEG sobre HTTP + Mumble sobre TCP tunnel) |
| **Escritura a microSD** | No (streaming en memoria) |
| **Cámara CSI** | ✅ (V4L2 + M2M HW encode) |
| **Cámara USB** | ✅ (V4L2 directo) |
| **Reutiliza infra existente** | ✅ (murmurd ya desplegado) |
| **HLS para remoto** | ❌ (solo MJPEG; BW alto fuera de LAN) |
| **WebRTC P2P remoto** | ⚠️ Solo datos vía node-datachannel; vídeo necesitaría Janus |

**Comparativa directa con Arq. 3 (Mumble hybrid recomendada)**:

| | Arq. 3 (go2rtc + Mumble) | Arq. 6 (µStreamer + Mumble) |
|---|---|---|
| **RAM nuevos procesos** | ~20 MB (go2rtc) | **~10 MB** (µStreamer) |
| **Formatos vídeo** | MJPEG, HLS, RTSP, WebRTC | MJPEG solamente |
| **Audio** | Igual (Mumble) | Igual (Mumble) |
| **Tor** | ✅ (MJPEG/HLS) | ✅ (MJPEG) |
| **Remoto alta latencia** | ✅ HLS (BW eficiente) | ⚠️ Solo MJPEG (BW alto) |
| **HW JPEG encode** | ❌ (go2rtc no usa M2M) | ✅ (µStreamer M2M) |
| **CPU vídeo CSI @ 720p** | ~5–10% | **~3–8%** (M2M HW) |

**¿Cuándo elegir Arq. 6 sobre Arq. 3?**:
- El SNH opera **solo en LAN** (no hay peers remotos con alta latencia → no se necesita HLS).
- Cada MB de RAM **es crítico** (otros servicios compiten por el 1 GB).
- Se quiere el **pipeline más simple posible**: un binario C + murmurd ya existente.
- Se quiere **HW JPEG encode** M2M para minimizar uso de CPU.

**¿Cuándo NO elegir Arq. 6?**:
- Se prevén peers remotos que necesitan **HLS o WebRTC** → go2rtc (Arq. 3) es más versátil.
- Se necesita **audio integrado** en el mismo servidor de vídeo → go2rtc captura ALSA.
- Se quiere un **único servidor** para todo (vídeo + audio + multi-protocolo) → go2rtc.

### EXT-10C. µStreamer + Janus: variante WebRTC

Si la Arq. 6 necesita también servir WebRTC al peer remoto, se añade Janus Gateway con el plugin µStreamer:

| | Arq. 6b: µStreamer + Janus + Mumble |
|---|---|
| **RAM adicional** | ~20–35 MB (µStreamer ~10 MB + Janus ~10–20 MB; murmurd ya corre) |
| **Vídeo local (SNH)** | MJPEG sin JS (vía µStreamer directo) |
| **Vídeo remoto** | H.264 WebRTC vía Janus (necesita JS en remote browser) |
| **Audio local** | Bridge Mumble HTTP (sin JS) |
| **Audio remoto** | Opus vía Janus (WebRTC) **o** Mumble nativo |
| **Complejidad** | Alta (µStreamer + Janus + Mumble + bridge) |
| **Tor** | ⚠️ Video: solo MJPEG sobre HTTP. WebRTC: no |

**Valoración**: Arq. 6b añade complejidad significativa. Si se necesita WebRTC remoto, go2rtc (Arq. 3) logra lo mismo con menos piezas (go2rtc tiene WHEP integrado, sin Janus). **La Arq. 6b solo se justifica** si se necesita H.264 WebRTC remoto Y se quiere el M2M HW encode de µStreamer para JPEG local Y el peer remoto acepta Janus JS client. En la práctica, Arq. 3 (go2rtc + Mumble) es preferible para el caso combinado local+remoto.
