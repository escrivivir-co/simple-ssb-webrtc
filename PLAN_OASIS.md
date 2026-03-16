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

### ICE / STUN / TURN — Opciones para decisión

#### Conceptos

| Concepto | Qué hace | Analogía |
|---|---|---|
| **ICE** | Framework que prueba múltiples rutas de conexión y elige la mejor | El "GPS" que prueba todas las rutas posibles |
| **STUN** | Le dice a un peer cuál es su IP pública (resuelve NAT) | Un espejo: "tu IP pública es X.X.X.X" |
| **TURN** | Relay intermedio cuando la conexión directa es imposible | Un mensajero que pasa datos entre ambos |

#### Cuándo se necesita cada uno

| Escenario de red | STUN | TURN | Conexión directa P2P |
|---|---|---|---|
| Misma LAN | No necesario | No | Sí (IP local) |
| NAT doméstico típico ("cone") | ✅ Suficiente | No | Sí (tras STUN) |
| Un peer con IP pública | ✅ Suficiente | No | Sí |
| Ambos detrás de NAT simétrico (empresas) | ❌ No basta | ✅ Necesario | No (relay vía TURN) |
| Firewalls que bloquean UDP | ❌ No basta | ✅ Necesario (TCP) | No (relay vía TURN) |
| Carriers móviles (4G/5G) | ✅ Funciona | ✅ Recomendado | Varía (muchos carriers usan NAT simétrico) |

#### Relación con los 4 transportes de señalización

| Transporte | Escenario típico | ¿Necesita STUN? | ¿Necesita TURN? | Notas |
|---|---|---|---|---|
| **manual** | Testing, cualquier red | Sí (si remoto) | Recomendado (si remoto) | El usuario copia el SDP por canal externo; la conectividad depende de ICE, no del transporte |
| **ssb-conn** | Peers SSB remotos | Sí | Recomendado | Los peers SSB pueden estar en cualquier red |
| **ssb-lan** | Misma LAN | No | No | Conectividad directa por IP local |
| **socket.io** | Remotos vía pub | Sí | Recomendado | Similar a ssb-conn, redes arbitrarias |

#### Opciones de infraestructura TURN

| Opción | Coste | Mantenimiento | Capacidad | Privacidad | Notas |
|---|---|---|---|---|---|
| **Sin TURN** | 0 | 0 | N/A | Máxima | ~80% de conexiones funcionan solo con STUN (estimación industria) |
| **coturn propio** | VPS ~5€/mes | Medio | Ilimitada* | Total (tu servidor) | Open source, configuración manual, requiere VPS con puertos UDP abiertos |
| **Metered.ca (free)** | 0 | Ninguno | Free tier limitado | Tercero | Verificar límites actuales en metered.ca, requiere signup |
| **Xirsys (free)** | 0 | Ninguno | Free tier limitado | Tercero | Verificar límites actuales en xirsys.com, API REST para credenciales efímeras |
| **Twilio (pay)** | ~$0.004/min | Ninguno | Ilimitada | Tercero | Escalable, caro a volumen. Verificar pricing actual |
| **Cloudflare Calls** | Free tier | Ninguno | Free tier limitado | Tercero | Producto reciente, verificar disponibilidad y límites actuales |

*\*Limitada por ancho de banda del VPS*

#### Recomendación para la reunión

```
Propuesta escalonada:

  Sprint actual  →  Solo STUN (ya funciona, cubre ~80% de casos)
  Sprint N+1     →  coturn propio en VPS del proyecto (100% cobertura, privacidad total)
  Fallback       →  Metered.ca free tier para validar sin infra propia
```

La configuración ICE se gestiona en Phase 2 del plan — es un JSON en `oasis-config.json` que mezcla defaults (STUN Google) con overrides del operador (TURN propio/servicio). El código WebRTC no cambia, solo la config.

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
4. **NAT traversal / TURN**: La config actual solo usa STUN (Google), que resuelve la mayoría de NATs domésticos tipo "cone". **No funcionará** cuando ambos peers estén detrás de NATs simétricos (redes corporativas, algunos ISPs, carriers móviles) o firewalls que bloqueen UDP. Para conectividad universal se necesita un servidor TURN como relay. Opciones: montar [coturn](https://github.com/coturn/coturn) (open source) o usar servicios como Metered.ca/Xirsys. El servidor TURN se configuraría en Phase 2 vía `oasis-config.json` → `webrtcIceServers`.
