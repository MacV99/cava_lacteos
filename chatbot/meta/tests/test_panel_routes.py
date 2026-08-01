"""Tests de las rutas del panel (/api/*) con TestClient, Graph mockeado."""
import app.whatsapp.graph as graph


def test_me_login_guard_flow(client, panel_password):
    assert client.get("/api/me").json() == {"authed": False, "needsPassword": True}
    assert client.get("/api/conversations").status_code == 401       # guard
    assert client.post("/api/login", json={"password": "nope"}).status_code == 401
    assert client.post("/api/login", json={"password": panel_password}).status_code == 200
    assert client.get("/api/conversations").status_code == 200       # con cookie


def test_logout_clears_session(client, panel_password):
    client.post("/api/login", json={"password": panel_password})
    assert client.get("/api/conversations").status_code == 200
    client.post("/api/logout")
    assert client.get("/api/conversations").status_code == 401


def test_send_success_records_outbound(client, panel_password, monkeypatch):
    client.post("/api/login", json={"password": panel_password})

    async def fake_send_text(to, body, reply_to=None):
        return {"messages": [{"id": "wamid.OK"}]}

    monkeypatch.setattr(graph, "send_text", fake_send_text)
    r = client.post("/api/send", json={"to": "57300", "text": "hola"})
    assert r.status_code == 200 and r.json()["id"] == "wamid.OK"
    convs = client.get("/api/conversations").json()["conversations"]
    assert convs[0]["messages"][-1]["text"] == "hola"


def test_send_graph_error_surfaces_code(client, panel_password, monkeypatch):
    client.post("/api/login", json={"password": panel_password})

    async def boom(to, body, reply_to=None):
        raise graph.GraphError("fuera de ventana", code=131047)

    monkeypatch.setattr(graph, "send_text", boom)
    r = client.post("/api/send", json={"to": "57300", "text": "hola"})
    assert r.status_code == 502
    body = r.json()
    assert body["ok"] is False and body["code"] == 131047 and "error" in body


def test_send_validates_required_fields(client, panel_password):
    client.post("/api/login", json={"password": panel_password})
    assert client.post("/api/send", json={"to": "57300"}).status_code == 400


def test_ai_toggle_updates_conversation(client, panel_password, monkeypatch):
    client.post("/api/login", json={"password": panel_password})

    async def fake_send_text(to, body, reply_to=None):
        return {"messages": [{"id": "wamid.OK"}]}

    monkeypatch.setattr(graph, "send_text", fake_send_text)
    client.post("/api/send", json={"to": "57300", "text": "hola"})  # crea la conversación
    r = client.post("/api/ai-toggle", json={"waId": "57300", "on": False})
    assert r.status_code == 200 and r.json()["aiOn"] is False


def test_ai_toggle_unknown_conversation_404(client, panel_password):
    client.post("/api/login", json={"password": panel_password})
    assert client.post("/api/ai-toggle", json={"waId": "no-existe", "on": True}).status_code == 404


def test_errors_json_requires_login(client, panel_password):
    # /api/errors.json está tras el guard (app.js lo pide tras loguear).
    assert client.get("/api/errors.json").status_code == 401
    client.post("/api/login", json={"password": panel_password})
    r = client.get("/api/errors.json")
    assert r.status_code == 200 and "map" in r.json() and "fallback" in r.json()
