from __future__ import annotations

import base64
import hashlib
import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from ._utils import compact_json_dumps

DID_PATTERN = re.compile(r"^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$")


@dataclass(frozen=True)
class AgentIdentityConfig:
    agent_did: str
    agent_private_key: str


def _load_private_key(seed: str) -> Ed25519PrivateKey:
    try:
        raw_key = base64.b64decode(seed, validate=True)
    except ValueError as exc:
        raise ValueError("agent_private_key must be canonical base64") from exc
    if len(raw_key) != 32:
        raise ValueError("agent_private_key must decode to a 32-byte Ed25519 private key seed")
    return Ed25519PrivateKey.from_private_bytes(raw_key)


def _canonical_body_bytes(body: Any) -> bytes:
    if body is None:
        return b""
    if isinstance(body, bytes):
        return body
    if isinstance(body, str):
        return body.encode("utf-8")
    return compact_json_dumps(body)


def sign_agent_identity_request(
    *,
    method: str,
    path: str,
    body: Any,
    agent_did: str,
    agent_private_key: str,
    timestamp: str | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    if not DID_PATTERN.match(agent_did):
        raise ValueError("agent_did must be a valid DID string")
    private_key = _load_private_key(agent_private_key)
    timestamp_value = timestamp or datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")
    nonce_value = nonce or secrets.token_hex(16)
    body_hash = hashlib.sha256(_canonical_body_bytes(body)).hexdigest()
    canonical = "\n".join([method.upper(), path, timestamp_value, nonce_value, body_hash])
    signature = private_key.sign(canonical.encode("utf-8"))
    return {
        "X-OpenBox-Agent-DID": agent_did,
        "X-OpenBox-Agent-Timestamp": timestamp_value,
        "X-OpenBox-Agent-Nonce": nonce_value,
        "X-OpenBox-Agent-Signature": base64.b64encode(signature).decode("ascii"),
    }
