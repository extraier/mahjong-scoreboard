#!/usr/bin/env python3
"""
Mahjong Scoreboard — upload signed AAB to Google Play Internal Testing.

Prerequisites (do these ONCE in Play Console browser):
  1. Sign in to https://play.google.com/console with the developer account
  2. Create app:
       - App name: 麻雀神器 PRO
       - Default language: Chinese (Traditional, Hong Kong)
       - App or Game: App
       - Free or Paid: Free
  3. Fill in the store listing / data safety / content rating (14-step UI checklist)
     until "Send for review" becomes available.
  4. Users & permissions → Invite new user:
       Email: hermes@foodswipe-fe76a.iam.gserviceaccount.com
       Permissions: Release manager (or Admin)

Once those steps are done, run this script:
    python3 scripts/play-upload-aab.py
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error
import jwt  # pyjwt[crypto]

SA_PATH = os.path.expanduser("~/.hermes/secrets/foodswipe-fe76a-sa.json")
AAB_PATH = os.path.expanduser(
    "~/mahjong-scoreboard/android/app/build/outputs/bundle/release/app-release.aab"
)
PACKAGE = "com.comparetiger.mahjongscoreboard"

def get_access_token():
    with open(SA_PATH) as f:
        sa = json.load(f)
    now = int(time.time())
    tok = jwt.encode({
        "iss": sa["client_email"],
        "scope": "https://www.googleapis.com/auth/androidpublisher",
        "aud": "https://oauth2.googleapis.com/token",
        "iat": now, "exp": now + 3600,
    }, sa["private_key"], algorithm="RS256")
    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=f"grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion={tok}".encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    return json.loads(urllib.request.urlopen(req, timeout=15).read())["access_token"]

def api(method, url, token, body=None):
    data = (json.dumps(body).encode() if body is not None else b"{}")
    req = urllib.request.Request(
        url, method=method, data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    try:
        return urllib.request.urlopen(req, timeout=120)
    except urllib.error.HTTPError as e:
        sys.stderr.write(f"  HTTP {e.code}: {e.read().decode()}\n")
        raise

def main():
    if not os.path.exists(AAB_PATH):
        sys.exit(f"AAB not found at {AAB_PATH} — run ./gradlew bundleRelease first")
    if not os.path.exists(SA_PATH):
        sys.exit(f"SA JSON not found at {SA_PATH}")

    token = get_access_token()
    print(f"✓ Got access token (scope: androidpublisher)")

    # 1. Create empty edit
    print(f"\n[1/4] Creating edit for {PACKAGE}...")
    r = api("POST", f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}/edits", token)
    edit = json.loads(r.read())
    edit_id = edit.get("id") or edit.get("editId")
    print(f"  ✓ edit_id = {edit_id}")

    # 2. Resumable upload (two-step protocol — single multipart POST is deprecated)
    print(f"\n[2/4] Uploading {os.path.basename(AAB_PATH)} ({os.path.getsize(AAB_PATH):,} bytes)...")
    session_url = (
        f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/"
        f"applications/{PACKAGE}/edits/{edit_id}/bundles?uploadType=resumable"
    )
    req = urllib.request.Request(session_url, method="POST", headers={
        "Authorization": f"Bearer {token}",
        "X-Upload-Protocol": "resumable",
        "X-Upload-Content-Type": "application/octet-stream",
        "Content-Type": "application/json",
    }, data=b"{}")
    r = urllib.request.urlopen(req, timeout=30)
    upload_url = r.headers.get("Location")
    if not upload_url:
        sys.exit("✗ No Location header in resumable session response")
    print(f"  ✓ got upload session URL")

    with open(AAB_PATH, "rb") as f:
        aab_bytes = f.read()
    req = urllib.request.Request(upload_url, method="PUT", data=aab_bytes, headers={
        "Content-Type": "application/octet-stream",
        "Content-Length": str(len(aab_bytes)),
    })
    bundle = json.loads(urllib.request.urlopen(req, timeout=300).read())
    version_code = bundle["versionCode"]
    print(f"  ✓ bundle uploaded — versionCode = {version_code}")

    # 3. Bind to Internal Testing track
    print(f"\n[3/4] Binding version {version_code} to internal track...")
    api("PUT", f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}/edits/{edit_id}/tracks/internal", token, {
        "releases": [{"versionCodes": [str(version_code)], "status": "completed"}],
    })
    print("  ✓ internal track updated")

    # 4. Commit
    print(f"\n[4/4] Committing edit...")
    api("POST", f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PACKAGE}/edits/{edit_id}:commit", token)
    print(f"  ✓ edit committed")

    print(f"\n🎉 Done! Open Play Console → Internal Testing to add testers and view install link.")
    print(f"   https://play.google.com/console/u/0/app/{PACKAGE}/internal-testing")

if __name__ == "__main__":
    main()
