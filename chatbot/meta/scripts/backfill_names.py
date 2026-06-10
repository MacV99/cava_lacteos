"""Backfill de nombres en la hoja 'actividad'.

Para cada contacto con `nombre` vacío, consulta el perfil en Meta y escribe el
nombre en la columna B. Como `canal` puede estar vacío, prueba Messenger y, si
no obtiene nombre, Instagram; si descubre la plataforma y `canal` está vacío,
también la guarda en la columna H.

Uso (desde chatbot/meta/):
    python -m scripts.backfill_names           # aplica los cambios
    python -m scripts.backfill_names --dry-run  # solo muestra qué haría
"""
import asyncio
import sys

from app.messenger.client import get_profile_name
from app.sheets import activity

DRY_RUN = "--dry-run" in sys.argv


async def resolve_name(sender_id: str) -> tuple[str, str]:
    """Retorna (nombre, canal_detectado). canal_detectado="" si no se logró."""
    nombre = await get_profile_name(sender_id, "messenger")
    if nombre:
        return nombre, "messenger"
    nombre = await get_profile_name(sender_id, "instagram")
    if nombre:
        return nombre, "instagram"
    return "", ""


async def main() -> None:
    ws = activity._ws()
    values = ws.row_values  # noqa: F841 (solo para claridad)
    all_rows = ws.get_all_values()
    if not all_rows:
        print("Hoja vacía.")
        return

    header, *rows = all_rows
    updates: list[dict] = []
    resueltos = 0

    for idx, row in enumerate(rows, start=2):  # fila 2 en adelante (1 = header)
        sender_id = row[0] if len(row) > 0 else ""
        nombre_actual = (row[1] if len(row) > 1 else "").strip()
        canal_actual = (row[7] if len(row) > 7 else "").strip()
        if not sender_id or nombre_actual:
            continue

        nombre, canal = await resolve_name(sender_id)
        if not nombre:
            print(f"  fila {idx}  {sender_id}  -> sin perfil (no resuelto)")
            continue

        resueltos += 1
        print(f"  fila {idx}  {sender_id}  -> '{nombre}' [{canal}]")
        updates.append({"range": f"B{idx}", "values": [[nombre]]})
        if canal and not canal_actual:
            updates.append({"range": f"H{idx}", "values": [[canal]]})

    print(f"\nResueltos {resueltos} de {len(rows)} contactos.")

    if not updates:
        print("Nada que escribir.")
        return
    if DRY_RUN:
        print(f"[dry-run] No se escribió nada. {len(updates)} celdas se actualizarían.")
        return

    ws.batch_update(updates)
    print(f"Escritas {len(updates)} celdas en la hoja.")


if __name__ == "__main__":
    asyncio.run(main())
