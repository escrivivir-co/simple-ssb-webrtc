# Plan: Multi-Transport WebRTC Signaling

El sistema de señalización evoluciona de "copy-paste" a una **capa de abstracción multi-transporte** donde el usuario elige el mejor modo para su escenario.

### Arquitectura

```
┌─────────────────────────────────────┐
│         Oasis WebRTC UI             │  webrtc_view.js + webrtc-app.js
│  (selector de modo, video, chat)    │
├─────────────────────────────────────┤
│      Signaling Abstraction Layer    │  ssb-webrtc/signaling/index.js
│  .send(peer, type, payload)         │
│  .onSignal(cb)                      │
│  .listPeers()                       │
├───────┬───────┬──────────┬──────────┤
│manual │  ssb  │ ssb-lan  │socket.io │
│(HECHO)│       │          │          │
└───────┴───────┴──────────┴──────────┘
```

| Transporte | Escenario | Tipo msg SSB | Requisitos |
|---|---|---|---|
| **manual** | Testing, sin red | N/A | Ninguno (ya funciona) |
| **ssb-conn** | Peers SSB conectados | `webrtc-signal` privado | ssb-private, peers online |
| **ssb-lan** | Misma LAN | `webrtc-signal` privado | ssb-lan, red local |
| **socket.io** | Peers remotos, pub relay | `post` privado o directo | Pub con socket.io |

---

### Steps

**Phase 1: Signaling Abstraction Layer** (ssb-webrtc/)

1. **Interfaz común de transporte** — `signaling/transport.js` — Define: `{ name, init(config), send(peerId, type, payload), onSignal(cb), listPeers(), destroy() }`
2. **Refactorizar manual.js** — Adaptar al formato de la interfaz. `send()` muestra código, `onSignal()` espera paste. *Depende de 1*
3. **Crear ssb.js** — Usa `sbot.private.publish()` + `createLogStream({ live })` + unbox. Tombstone automático post-conexión. *Depende de 1*
4. **Crear lan.js** — Wrapper sobre ssb.js que filtra peers por ssb-lan. *Depende de 3*
5. **Crear socketio.js** — Basado en patrón de `ProjectRTC-001/app/socketHandler.js`. *Depende de 1*
6. **Crear registry** — `signaling/index.js` con `getTransport(name)`, `listTransports()`, auto-detección de disponibilidad. *Depende de 2-5*

**Phase 2: Configuración ICE** (*paralelo con Phase 1*)

7. **ICE defaults en plugin** — `ssb-webrtc/index.js` lee `config.webrtc.iceServers`
8. **ICE override en Oasis** — `oasis-config.json` sección `webrtcIceServers`, merge con defaults del plugin

**Phase 3: Integración Oasis Backend**

9. **webrtc_model.js** — Modelo con `listAvailableTransports()`, `listPeers(transport)`, `sendSignal()`, `listenSignals()`. Usa `cooler.open()`. *Depende de 6*
10. **API routes** en backend.js: `GET /webrtc/peers`, `POST /webrtc/signal`, `GET /webrtc/signals` (SSE), `GET /webrtc/transports`. *Depende de 9*

**Phase 4: Integración Oasis Frontend**

11. **webrtc-app.js** — Selector de transporte, lista de peers SSB, SSE listener para señales entrantes, flujo automático SSB. *Depende de 10*
12. **webrtc_view.js** — UI: panel peers, llamada entrante, selector transporte. *Depende de 11*
13. **webrtc.css** — Estilos nuevos. *Paralelo con 11-12*

**Phase 5: Tipo de mensaje configurable**

14. **Dual type** en ssb.js — `webrtc-signal` (default) o `post` con subject `[webrtc-signal]`. Configurable en oasis-config.json. *Depende de 3*

---

### Relevant files

**ssb-webrtc/** (plugin):
- `ssb-webrtc/index.js` — Añadir ICE config defaults
- `ssb-webrtc/signaling/manual.js` — Refactorizar a interfaz
- Crear: `signaling/transport.js`, `signaling/ssb.js`, `signaling/lan.js`, `signaling/socketio.js`, `signaling/index.js`

**oasis-main/** (integración):
- Crear: `src/models/webrtc_model.js`
- `oasis-main/src/backend/backend.js` — API routes
- `oasis-main/src/views/webrtc_view.js` — UI transporte + peers
- `oasis-main/src/client/public/js/webrtc-app.js` — Lógica multi-transporte
- `oasis-main/src/client/assets/styles/webrtc.css` — Estilos nuevos
- `oasis-main/src/configs/oasis-config.json` — webrtcIceServers, webrtcMessageType

**Referencia**:
- `ProjectRTC-001/app/socketHandler.js` — Patrón Socket.io a reutilizar

### Verification

1. Manual mode sigue funcionando (regression test Playwright)
2. SSB mode: 2 instancias Oasis --offline → offer vía SSB → answer → conexión
3. LAN mode: peers en misma red, descubrimiento automático
4. Socket.io mode: señalización vía pub server
5. ICE config merge (defaults + override)
6. Tombstone post-conexión verificado en log
7. Tipo de mensaje dual (webrtc-signal / post)

### Decisions

- **Multi-transporte**: manual, ssb-conn, ssb-lan, socket.io — todos intercambiables
- **ICE config**: defaults en plugin + override en oasis-config.json (merge)
- **Tipo de mensaje**: configurable `webrtc-signal` (default) y `post`
- **SSE**: Server-Sent Events para push backend→frontend (compatible con CSP)
- **Tombstone**: automático post-conexión

### Further Considerations

1. **CSP connect-src**: SSE necesita `connect-src 'self'` en middleware.js. Socket.io necesitaría la URL del pub. Recomendación: añadir dinámicamente según transportes.
2. **Orden de implementación**: Recomiendo Phase 1→3 (SSB funcional) primero, luego Phase 4 (LAN + Socket.io).
3. **Llamada entrante**: ¿Auto-aceptar de friends o siempre pedir confirmación? Recomendación: siempre pedir confirmación con notificación visual.
