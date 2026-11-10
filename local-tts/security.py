"""Small standard-library request validation helpers for the local TTS sidecar."""
from __future__ import annotations

from urllib.parse import urlsplit


def is_loopback_host_header(value: str) -> bool:
    """Accept only explicit loopback Host names and valid optional TCP ports."""
    candidate = value.strip()
    if not candidate or any(char in candidate for char in "/\\@?#\r\n\t "):
        return False
    try:
        parsed = urlsplit("//" + candidate)
        _ = parsed.port
    except ValueError:
        return False
    host = parsed.hostname
    return host is not None and host.lower() in {"127.0.0.1", "localhost", "::1"}
