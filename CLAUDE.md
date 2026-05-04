# Cava Lácteos — Workspace

Workspace multi-proyecto para la empresa **Cava Lácteos**. Cada subcarpeta es un proyecto independiente con su propio stack y ciclo de vida.

## Estructura

```
cava_lacteos/
├── website/        ← Sitio web y catálogo de productos (Astro)
├── chatbot/
│   ├── facebook/   ← Chatbot para Facebook Messenger
│   ├── instagram/  ← Chatbot para Instagram DM
│   └── whatsapp/   ← Chatbot para WhatsApp Business
└── CLAUDE.md
```

## Proyectos

### `website/`
Sitio web principal y catálogo de productos de Cava Lácteos.
- **Stack:** Astro (por inicializar)
- **Estado:** Carpeta vacía — pendiente de `npm create astro`

### `chatbot/`
Chatbots de atención al cliente por canal de mensajería.
- **Stack:** Por definir
- **Estado:** Carpeta vacía — pendiente de definir tecnología

## Convenciones

- Cada proyecto maneja sus propias dependencias (`package.json` dentro de su subcarpeta)
- Variables de entorno en `.env` dentro de cada subcarpeta (nunca en la raíz)
- No mezclar código de proyectos distintos entre carpetas
