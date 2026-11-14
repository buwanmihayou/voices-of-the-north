"""Create a runnable synthetic pending-review fixture against a running API."""

from __future__ import annotations

import argparse
import base64
import io
import json
import time
import wave

import requests


def synthetic_wav_base64(seconds: float = 0.5) -> str:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(b"\x00\x00" * int(8000 * seconds))
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    base = args.base.rstrip("/")

    contributor = requests.post(
        base + "/api/auth/verify",
        json={"school_id": "fixture-contributor", "password": "fixture-pass"},
        timeout=10,
    )
    contributor.raise_for_status()
    token = contributor.json()["token"]
    headers = {"Authorization": "Bearer " + token}
    record_id = "SYN-PENDING-" + time.strftime("%Y%m%d%H%M%S")
    record = {
        "id": record_id,
        "createdAt": int(time.time() * 1000),
        "status": "done",
        "source": "live",
        "title": "Synthetic pending-review recording",
        "rawText": "This is a synthetic transcript for manual review.",
        "formalText": "This is a synthetic transcript for manual review.",
        "words": [
            {"word": "synthetic", "start": 0.0, "end": 0.25, "confidence": None},
            {"word": "transcript", "start": 0.25, "end": 0.5, "confidence": None},
        ],
        "qaList": [],
        "consentRef": "CONSENT-2026-11-v2",
        "mime": "audio/wav",
        "contributionFlow": True,
        "requestedScope": "public",
        "scope": "public",
        "audioBase64": synthetic_wav_base64(),
    }
    created = requests.post(base + "/api/records", headers=headers, json=record, timeout=10)
    created.raise_for_status()
    submitted = requests.post(
        base + f"/api/contributions/{record_id}/submit",
        headers=headers,
        json={
            "transcriptConfirmed": True,
            "requestedScope": "public",
            "policyVersion": "CONSENT-2026-11-v2",
        },
        timeout=10,
    )
    submitted.raise_for_status()
    print(json.dumps({
        "recordId": record_id,
        "submitted": submitted.json(),
        "reviewerQueue": "GET /api/contributions?status=submitted with an admin bearer token",
        "approve": f"POST /api/contributions/{record_id}/review with approved=true and approvedScope=public",
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
