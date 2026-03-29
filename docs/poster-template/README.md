# Poster Template — Fanzine B/W Spec Posters

Kit reutilizable para crear **posters tipo specification** con estética fanzine monocromo (Courier New, blanco/negro, recortable).

## Estructura

```
poster-template/
├── fanzine.css          ← CSS compartido (no tocar, solo linkar)
├── template.html        ← Esqueleto del poster (copiar y rellenar)
├── spec-template.html   ← Esqueleto de sub-ficha spec (copiar y rellenar)
└── README.md            ← Este fichero
```

## Cómo Crear un Nuevo Poster

### 1. Copiar el esqueleto

```bash
# Desde la raíz del proyecto:
cp poster-template/template.html poster-arqN.html
mkdir -p spec-arqN
```

### 2. Linkar el CSS compartido

En el `<head>` del nuevo poster:

```html
<link rel="stylesheet" href="poster-template/fanzine.css">
```

En los sub-ficheros spec (dentro de `spec-arqN/`):

```html
<link rel="stylesheet" href="../poster-template/fanzine.css">
```

### 3. Rellenar los `{{placeholders}}`

Buscar y reemplazar en el HTML:

| Placeholder | Qué poner |
|---|---|
| `{{TITLE}}` | Título del `<title>` (pestaña del browser) |
| `{{STAMP}}` | Sello superior derecho (ej: "SOLAR NET HUB") |
| `{{POSTER_NAME}}` | Nombre grande del `<h1>` (ej: "Arq. 3") |
| `{{SUBTITLE}}` | Componentes principales |
| `{{DESCRIPTION}}` | Línea descriptiva corta |
| `{{SOURCE_REF}}` | Referencia al doc fuente (ej: "web-rtc-ext.md · EXT-5C") |
| `{{DEVICE}}` | Hardware target (ej: "RPi 3B") |
| `{{STACK}}` | Stack resumido para el footer |
| `{{ONE-LINE TAGLINE}}` | Frase estrella del callout |

### 4. Crear sub-ficheros spec (opcional)

```bash
cp poster-template/spec-template.html spec-arqN/component.html
```

Ajustar el `<link>` al CSS y el `<a>` de "volver al poster".

## Clases CSS Disponibles

### Layout
| Clase | Uso |
|---|---|
| `.header` | Bloque cabecera con h1, stamp, issue |
| `.stats-bar` | Barra de estadísticas numéricas |
| `.cols` > `.col` | Dos columnas responsive |
| `.cutout` | Caja con borde + dashed exterior |
| `.diagram-wrap` + `.diagram` | Diagrama ASCII (pre, blanco sobre negro) |
| `.callout` | Caja centrada con estrellas ★ |
| `.washi` | Separador decorativo tipo washi tape |
| `.footer` | Pie de página |

### Componentes
| Clase | Uso |
|---|---|
| `.card` + `.card-title` + `.card-body` + `.card-port` | Tarjeta de componente |
| `.tbl` | Tabla con headers invertidos |
| `.cmd` + `.comment` + `.prompt` | Bloque de código/comando |
| `<details>` + `<summary>` + `.detail-body` | Sección colapsable |

### Decoración
| Clase | Uso |
|---|---|
| `.tape` + `.tape-tl/.tape-tr/.tape-bl/.tape-br` | Tiras decorativas de celo |
| `.tilt-l` / `.tilt-r` / `.tilt-l2` / `.tilt-r2` | Rotaciones sutiles |
| `.hl-box` | Texto invertido (fondo negro, texto blanco) |
| `.kw` / `.kw-inv` | Tags de keywords (borde / invertido) |

### Contenido inline
| Clase | Uso |
|---|---|
| `.tip` | Caja con 💡 (consejo) |
| `.warn` | Caja con ⚠️ (aviso) |
| `.key-concept` | Caja con ◆ (concepto clave) |
| `.deep-link` | Link a sub-ficha spec (→ prefijo) |
| `.nav-back` | Enlace "volver al poster" (para spec pages) |
| `.step-title` | Título de paso numerado en setup |

## Imprimir

- **Ctrl+P / Cmd+P** en el browser
- Tamaño: A3 portrait (definido en `@page`)
- Los `<details>` cerrados se ocultan en impresión (solo se imprime lo abierto)

## Convenciones DRY

1. **Un solo CSS**: `fanzine.css` — nunca duplicar estilos en los posters
2. **Sub-ficheros para detalle**: mantener el poster principal compacto, los deep-dives van en `spec/`
3. **`<details>` para extensión vertical**: el poster se ve limpio colapsado; el dev abre lo que necesita
4. **Keywords al final**: facilitan búsqueda visual rápida para todo el equipo
