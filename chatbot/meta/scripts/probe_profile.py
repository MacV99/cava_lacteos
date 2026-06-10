"""Sonda: prueba combinaciones de endpoint/campos para traer el nombre de un PSID.

Imprime SOLO status + body de Meta (no imprime tokens). Diagnóstico empírico.
Uso (desde chatbot/meta/):  python -m scripts.probe_profile
"""
import asyncio

import httpx

from app.config import settings
from app.sheets import activity

PAGE = settings.meta_page_access_token
IG = settings.meta_ig_access_token


async def probe(client: httpx.AsyncClient, label: str, url: str, params: dict, headers: dict | None = None):
    try:
        r = await client.get(url, params=params, headers=headers or {})
        print(f"\n[{label}] {r.status_code}\n  {r.text[:300]}")
    except Exception as exc:
        print(f"\n[{label}] EXC {exc}")


async def main():
    ws = activity._ws()
    rows = ws.get_all_values()[1:]
    ids = [r[0] for r in rows if r and r[0]][:3]
    print("Probando con PSIDs:", ids)
    print("page_token set:", bool(PAGE), "| ig_token set:", bool(IG))

    async with httpx.AsyncClient(timeout=10) as client:
        for psid in ids:
            print(f"\n===== PSID {psid} =====")
            # 1) FB graph + page token, fields=name
            await probe(client, "fb name", f"https://graph.facebook.com/v20.0/{psid}",
                        {"fields": "name", "access_token": PAGE})
            # 2) FB graph + page token, fields=first_name,last_name
            await probe(client, "fb first/last", f"https://graph.facebook.com/v20.0/{psid}",
                        {"fields": "first_name,last_name", "access_token": PAGE})
            # 3) FB graph + page token, fields=name,username (IG user via page token)
            await probe(client, "fb name,username", f"https://graph.facebook.com/v20.0/{psid}",
                        {"fields": "name,username", "access_token": PAGE})
            # 4) IG graph + ig token (si existe)
            if IG:
                await probe(client, "ig name,username", f"https://graph.instagram.com/v21.0/{psid}",
                            {"fields": "name,username"}, {"Authorization": f"Bearer {IG}"})


if __name__ == "__main__":
    asyncio.run(main())
