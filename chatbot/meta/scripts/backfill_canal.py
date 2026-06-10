"""Backfill de `canal` cruzando las conversaciones de la página por plataforma.

1. Lista hilos de Messenger e Instagram (API de conversaciones, con paginación).
2. Mapea cada participante (excluyendo el page_id) a su plataforma.
3. Para cada fila de 'actividad' con canal vacío, escribe el canal detectado.

Uso (desde chatbot/meta/):
    python -m scripts.backfill_canal --dry-run   # solo muestra
    python -m scripts.backfill_canal             # escribe en la hoja
"""
import asyncio
import sys

import httpx

from app.config import settings
from app.sheets import activity

PAGE = settings.meta_page_access_token
DRY_RUN = "--dry-run" in sys.argv
# IDs propios del negocio (página de Facebook + cuenta de Instagram); se excluyen.
BUSINESS_IDS = {"254611111077911", "17841436769814214"}


async def collect(client: httpx.AsyncClient, platform: str, limit: int, max_pages: int = 200) -> set[str]:
    """Recorre todas las páginas de conversaciones y junta IDs de participantes.

    Instagram exige limit=1 (timeout con más por 'demasiadas conversaciones').
    """
    ids: set[str] = set()
    url = "https://graph.facebook.com/v20.0/me/conversations"
    params = {"platform": platform, "fields": "participants", "limit": limit, "access_token": PAGE}
    for _ in range(max_pages):
        r = await client.get(url, params=params)
        if r.status_code != 200:
            print(f"  [{platform}] HTTP {r.status_code}: {r.text[:200]}")
            break
        data = r.json()
        for t in data.get("data", []):
            for p in t.get("participants", {}).get("data", []):
                pid = str(p.get("id", ""))
                if pid and pid not in BUSINESS_IDS:
                    ids.add(pid)
        nxt = data.get("paging", {}).get("next")
        if not nxt:
            break
        url, params = nxt, None  # next ya trae todos los query params
    return ids


async def main() -> None:
    async with httpx.AsyncClient(timeout=30) as client:
        # Messenger enumera completo y rápido (pocos hilos). Es la lista AUTORITATIVA.
        messenger = await collect(client, "messenger", 100)

    print(f"Messenger (lista completa): {len(messenger)} usuarios")
    print("Regla: PSID en esa lista = messenger; cualquier otro de la hoja = instagram "
          "(el bot solo opera en esas 2 plataformas).\n")

    ws = activity._ws()
    rows = ws.get_all_values()
    updates: list[dict] = []

    for idx, row in enumerate(rows[1:], start=2):
        sid = row[0] if row else ""
        canal_actual = (row[7] if len(row) > 7 else "").strip()
        if not sid or canal_actual:
            continue
        if sid in messenger:
            canal = "messenger"
            origen = "confirmado"
        else:
            canal = "instagram"
            origen = "inferido"
        print(f"  fila {idx}  {sid}  -> {canal} ({origen})")
        updates.append({"range": f"H{idx}", "values": [[canal]]})

    print(f"\nA escribir: {len(updates)} celdas.")
    if not updates:
        return
    if DRY_RUN:
        print("[dry-run] No se escribió nada.")
        return
    ws.batch_update(updates)
    print(f"Escritas {len(updates)} celdas de canal.")


if __name__ == "__main__":
    asyncio.run(main())
