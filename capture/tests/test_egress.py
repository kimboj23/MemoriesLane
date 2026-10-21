"""egress.py: one way out per capture; only the chosen platforms use the proxy; credentials apart for Chromium."""

from dataclasses import replace

from memlane_capture import egress
from memlane_capture.config import settings


def with_settings(monkeypatch, **kw):
    monkeypatch.setattr(egress, "settings", replace(settings, **kw))


def test_direct_without_a_proxy(monkeypatch):
    with_settings(monkeypatch, http_proxy="")
    e = egress.for_capture("threads")
    assert e.url is None and e.label == "direct" and e.playwright() is None


def test_only_chosen_platforms_and_a_sticky_port_per_capture(monkeypatch):
    with_settings(monkeypatch, http_proxy="http://user__cr.vn:p%40ss@gw.example.org:{port}", proxy_ports="10000-20000",
                  proxy_platforms="threads,instagram", proxy_bypass=".cdninstagram.com,.fbcdn.net")
    assert egress.for_capture("facebook").url is None and egress.for_capture("web").url is None
    ports = {int(egress.for_capture("threads").url.rsplit(":", 1)[1]) for _ in range(40)}
    assert all(10000 <= p <= 20000 for p in ports) and len(ports) > 1          # a new IP per capture
    pw = egress.for_capture("instagram").playwright()
    assert pw["server"].startswith("http://gw.example.org:") and "@" not in pw["server"]
    assert (pw["username"], pw["password"]) == ("user__cr.vn", "p@ss") and pw["bypass"] == ".cdninstagram.com,.fbcdn.net"


def test_all_platforms_when_the_list_is_empty(monkeypatch):
    with_settings(monkeypatch, http_proxy="http://u:p@gw.example.org:823", proxy_platforms="")
    assert egress.for_capture("web").url == "http://u:p@gw.example.org:823"
