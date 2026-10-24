#!/usr/bin/env python3
"""Upload Play Store listing assets (icon, feature graphic, phone screenshots).

Discovered from the official discovery document
(`https://androidpublisher.googleapis.com/$discovery/rest?version=v3`),
resource `edits.images`:

    POST androidpublisher/v3/applications/{packageName}/edits/{editId}
         /listings/{language}/{imageType}

Three things that are easy to get wrong:

1. It is **POST**, not PUT.
2. `imageType` is a path segment — `icon`, `featureGraphic`,
   `phoneScreenshots` — NOT a nested resource. There is no
   `/listings/{lang}/images/phoneScreenshots/{id}` path.
3. The binary goes to the **upload** host:
   `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/...`
   Hitting the metadata host with a PNG returns a bare 404 HTML page that
   looks like a permissions problem but isn't.

Commit is `POST .../edits/{editId}:commit`.

Usage:
    python3 scripts/play-upload-listing-assets.py [--lang zh-HK]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

import jwt

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STORE_ASSETS = PROJECT_ROOT / "store-assets"
SA_PATH = os.path.expanduser("~/.hermes/secrets/foodswipe-fe76a-sa.json")
PACKAGE = "com.comparetiger.mahjongscoreboard"

API = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}/edits"
UPLOAD = f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PACKAGE}/edits"

# imageType -> list of local files. Each file is uploaded as one image.
UPLOADS = {
    "icon": ["play-store-icon-512.png"],
    "featureGraphic": ["play-store-feature-graphic-1024x500.png"],
    "phoneScreenshots": [
        "play-store-screenshot-phone-1.png",
        "play-store-screenshot-phone-2.png",
    ],
}


def get_token() -> str:
    with open(SA_PATH) as f:
        sa = json.load(f)
    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": sa["client_email"],
            "scope": "https://www.googleapis.com/auth/androidpublisher",
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,
        },
        sa["private_key"],
        algorithm="RS256",
    )
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=f"grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion={assertion}".encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=20).read())["access_token"]


def request(url: str, token: str, method: str = "GET", data: bytes | None = None,
            content_type: str | None = None) -> tuple[int, bytes]:
    headers = {"Authorization": f"Bearer {token}"}
    if content_type:
        headers["Content-Type"] = content_type
    req = urllib.request.Request(url, method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", default="zh-HK")
    args = ap.parse_args()

    token = get_token()
    print("✓ Got access token (scope: androidpublisher)")

    status, body = request(API, token, method="POST", data=b"{}", content_type="application/json")
    if status != 200:
        print(f"✗ Could not create edit: HTTP {status}\n{body.decode()[:600]}", file=sys.stderr)
        return 1
    edit = json.loads(body)["id"]
    print(f"✓ edit_id = {edit}")

    ok = True
    uploaded: dict[str, list[str]] = {}

    for image_type, filenames in UPLOADS.items():
        ids: list[str] = []
        for filename in filenames:
            path = STORE_ASSETS / filename
            if not path.exists():
                print(f"✗ {image_type}/{filename}: missing {path}", file=sys.stderr)
                ok = False
                continue
            data = path.read_bytes()
            url = f"{UPLOAD}/{edit}/listings/{args.lang}/{image_type}"
            status, body = request(url, token, method="POST", data=data, content_type="image/png")
            if status == 200:
                img = json.loads(body).get("image", {})
                image_id = img.get("id", "?")
                ids.append(image_id)
                print(f"✓ {image_type}/{filename} ({len(data):,} bytes) → id={image_id}")
            else:
                print(f"✗ {image_type}/{filename}: HTTP {status}\n{body.decode()[:500]}", file=sys.stderr)
                ok = False
        uploaded[image_type] = ids

    if not ok:
        print("\n✗ Some uploads failed — edit NOT committed.", file=sys.stderr)
        return 1

    status, body = request(f"{API}/{edit}:commit", token, method="POST", data=b"{}",
                           content_type="application/json")
    if status == 200:
        print("✓ edit committed — listing assets are live")
        print(json.dumps(uploaded, indent=2))
        return 0
    print(f"✗ commit failed: HTTP {status}\n{body.decode()[:500]}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
