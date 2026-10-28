"""Drives the Groq (gpt-oss-120b) tool-calling loop with a fake client — no network or API key needed."""
from __future__ import annotations

import json
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient

from app import config
from app.main import create_app


def _call(cid, name, args):
    return NS(id=cid, type="function", function=NS(name=name, arguments=json.dumps(args)))


class FakeCompletions:
    def __init__(self):
        self.calls = []

    def create(self, **kw):
        self.calls.append(kw)
        if len(self.calls) == 1:  # first turn: two tool calls in parallel
            msg = NS(content=None, tool_calls=[
                _call("c1", "recommend_beds", {"patient_code": "P-9003"}),
                _call("c2", "propose_allocation", {"patient_code": "P-9003", "bed_code": "ICU-005"}),
            ])
            return NS(choices=[NS(message=msg, finish_reason="tool_calls")])
        return NS(choices=[NS(message=NS(content="Put **P-9003** in ICU-005. Staff must confirm.", tool_calls=None), finish_reason="stop")])


def _install(monkeypatch, create):
    import groq

    monkeypatch.setattr(config, "GROQ_API_KEY", "test-key")
    monkeypatch.setattr(groq, "Groq", lambda **_kw: NS(chat=NS(completions=NS(create=create))))


@pytest.fixture()
def fake(monkeypatch, tmp_path):
    comp = FakeCompletions()
    _install(monkeypatch, comp.create)
    with TestClient(create_app(tmp_path / "g.db", seed=True, frontend=tmp_path / "none")) as c:
        yield c, comp


def test_groq_loop_runs_tools_and_returns_cards(fake):
    c, comp = fake
    r = c.post("/api/ai/assistant", json={"messages": [{"role": "user", "content": "Where should P-9003 go?"}]}).json()
    assert r["engine"] == "groq" and r["model"] == "openai/gpt-oss-120b"
    assert r["tools_used"] == ["recommend_beds", "propose_allocation"]
    assert r["cards"] and r["cards"][0]["kind"] == "ALLOCATION" and r["cards"][0]["bed_code"] == "ICU-005"
    first, second = comp.calls
    assert first["model"] == "openai/gpt-oss-120b" and first["tool_choice"] == "auto"
    assert first["messages"][0]["role"] == "system"
    assert {t["function"]["name"] for t in first["tools"]} >= {"find_beds", "recommend_beds", "propose_allocation"}
    tool_msgs = [m for m in second["messages"] if m["role"] == "tool"]
    assert [m["tool_call_id"] for m in tool_msgs] == ["c1", "c2"]
    assert second["messages"][-3]["role"] == "assistant" and len(second["messages"][-3]["tool_calls"]) == 2


def test_groq_bad_tool_arguments_are_reported_not_raised(monkeypatch, tmp_path):
    calls = []

    def create(**kw):
        calls.append(kw)
        if len(calls) == 1:
            bad = NS(id="x", type="function", function=NS(name="find_beds", arguments="{not json"))
            return NS(choices=[NS(message=NS(content=None, tool_calls=[bad]), finish_reason="tool_calls")])
        return NS(choices=[NS(message=NS(content="Sorry, try again.", tool_calls=None), finish_reason="stop")])

    _install(monkeypatch, create)
    with TestClient(create_app(tmp_path / "b.db", seed=True, frontend=tmp_path / "none")) as c:
        r = c.post("/api/ai/assistant", json={"messages": [{"role": "user", "content": "free beds?"}]}).json()
    assert r["engine"] == "groq" and r["reply"]
    assert "not valid JSON" in calls[1]["messages"][-1]["content"]


def test_groq_failure_falls_back_to_local(monkeypatch, tmp_path):
    def boom(**_kw):
        raise RuntimeError("network down")

    _install(monkeypatch, boom)
    with TestClient(create_app(tmp_path / "d.db", seed=True, frontend=tmp_path / "none")) as c:
        r = c.post("/api/ai/assistant", json={"messages": [{"role": "user", "content": "How many beds are free?"}]}).json()
        assert r["engine"] == "local" and "Groq unavailable" in r["notice"] and r["reply"]
        assert c.get("/api/meta").json()["ai_engine"] == "groq"
