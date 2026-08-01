"""Tests del store del panel (memoria + write-through, aquí en modo memoria)."""
from app.whatsapp import store


async def test_add_inbound_and_list():
    await store.add_inbound("57300", "Ana", {"id": "m1", "ts": 1000, "type": "text", "text": "hola"})
    convs = store.list_conversations()
    assert len(convs) == 1
    c = convs[0]
    assert c["name"] == "Ana" and c["unread"] == 1 and c["preview"] == "hola" and c["aiOn"] is True


async def test_inbound_dedup_same_id():
    await store.add_inbound("57300", "Ana", {"id": "m1", "ts": 1, "type": "text", "text": "a"})
    await store.add_inbound("57300", "Ana", {"id": "m1", "ts": 2, "type": "text", "text": "a"})
    assert len(store.get_conversation("57300")["messages"]) == 1


async def test_status_climbs_never_drops():
    await store.add_outbound("57300", {"id": "o1", "ts": 1, "type": "text", "text": "hi"})
    await store.apply_status("o1", "delivered")
    await store.apply_status("o1", "read")
    await store.apply_status("o1", "sent")  # no debe bajar de read
    assert store.get_conversation("57300")["messages"][0]["status"] == "read"


async def test_failed_status_overrides():
    await store.add_outbound("57300", {"id": "o1", "ts": 1, "type": "text", "text": "hi"})
    await store.apply_status("o1", "read")
    await store.apply_status("o1", "failed", {"code": 131047})
    m = store.get_conversation("57300")["messages"][0]
    assert m["status"] == "failed" and m["error"]["code"] == 131047


async def test_ai_toggle_and_rename():
    await store.add_inbound("57300", "Ana", {"id": "m1", "ts": 1, "type": "text", "text": "hola"})
    assert (await store.set_ai_on("57300", False))["aiOn"] is False
    assert (await store.rename("57300", "Nuevo"))["name"] == "Nuevo"


async def test_rename_empty_falls_back_to_waid():
    await store.add_inbound("57300", "Ana", {"id": "m1", "ts": 1, "type": "text", "text": "hola"})
    assert (await store.rename("57300", "   "))["name"] == "57300"


async def test_list_sorted_by_recent():
    await store.add_inbound("A", "A", {"id": "a", "ts": 100, "type": "text", "text": "x"})
    await store.add_inbound("B", "B", {"id": "b", "ts": 200, "type": "text", "text": "y"})
    assert [c["waId"] for c in store.list_conversations()][0] == "B"


async def test_delete_message_and_conversation():
    await store.add_inbound("57300", "Ana", {"id": "m1", "ts": 1, "type": "text", "text": "hola"})
    assert await store.delete_message("57300", "m1") is True
    assert store.get_conversation("57300")["messages"] == []
    assert await store.delete_conversation("57300") is True
    assert store.get_conversation("57300") is None


async def test_preview_media_types():
    await store.add_inbound("57300", "Ana", {"id": "m1", "ts": 1, "type": "image", "text": ""})
    assert store.list_conversations()[0]["preview"] == "📷 Foto"


async def test_mark_read_resets_unread():
    await store.add_inbound("57300", "Ana", {"id": "m1", "ts": 1, "type": "text", "text": "hola"})
    await store.mark_read("57300")
    assert store.get_conversation("57300")["unread"] == 0


async def test_apply_reaction_attaches_to_message():
    await store.add_inbound("57300", "Ana", {"id": "m1", "ts": 1, "type": "text", "text": "hola"})
    assert await store.apply_reaction("57300", "m1", "❤️", 5) is True
    assert store.get_conversation("57300")["messages"][0]["reaction"] == "❤️"


async def test_apply_reaction_missing_target_returns_false():
    await store.add_inbound("57300", "Ana", {"id": "m1", "ts": 1, "type": "text", "text": "hola"})
    assert await store.apply_reaction("57300", "no-existe", "❤️", 5) is False
