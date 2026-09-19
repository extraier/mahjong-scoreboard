#!/usr/bin/env python3
"""
compare_models.py — compare two ViT models on the same /analyze request.

Spins up the FastAPI server with each model path, sends the test images,
and reports detected tile multisets + confidence for each.

Usage:
  python scripts/compare_models.py <model-a> <model-b> <image_path> [<image2>...]

Example:
  python scripts/compare_models.py \\
    /Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned \\
    /Users/roger/mahjong-scoreboard/models/mahjong-vision-finetuned-v2 \\
    tests/fixtures/multi-row-composition.jpg
"""

import argparse
import json
import subprocess
import sys
import time
import urllib.request
import urllib.error
import uuid
from pathlib import Path


def kill_existing_server():
    subprocess.run(['pkill', '-f', 'local_vision_server'], capture_output=True)
    time.sleep(1)


def wait_for_ready(url: str, timeout: float = 30) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            r = urllib.request.urlopen(url, timeout=2)
            if r.status == 200:
                body = json.loads(r.read())
                if body.get('status') == 'ready':
                    return True
        except Exception:
            pass
        time.sleep(0.5)
    return False


def analyze_via_fastapi(image_path: str, port: int = 8789) -> dict:
    img_bytes = Path(image_path).read_bytes()
    boundary = uuid.uuid4().hex
    body = (
        f'--{boundary}\r\n'
        f'Content-Disposition: form-data; name="image"; filename="hand.jpg"\r\n'
        f'Content-Type: image/jpeg\r\n\r\n'
    ).encode() + img_bytes + f'\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(
        f'http://127.0.0.1:{port}/analyze',
        data=body,
        headers={'Content-Type': f'multipart/form-data; boundary={boundary}'},
        method='POST',
    )
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=60) as r:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        result = json.loads(r.read())
        result['_e2e_ms'] = round(elapsed_ms, 1)
        return result


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--model-a', required=True, help='Path to first model directory')
    p.add_argument('--model-b', required=True, help='Path to second model directory')
    p.add_argument('--mlvenv', default='/Users/roger/mahjong-scoreboard/server/.mlvenv')
    p.add_argument('--server-cmd', default='/Users/roger/mahjong-scoreboard/server/scripts/local_vision_server.py')
    p.add_argument('--port', type=int, default=8789)
    p.add_argument('--images', nargs='+', required=True, help='Image paths to test')
    p.add_argument('--runs-per-image', type=int, default=3)
    args = p.parse_args()

    for label, model_path in [('A (v1)', args.model_a), ('B (v2)', args.model_b)]:
        if not Path(model_path).exists():
            print(f'!! {label}: model not found at {model_path} — skipping')
            continue

        print(f'\n{"=" * 70}')
        print(f'Testing {label}: {model_path}')
        print(f'{"=" * 70}')

        # Stop any existing server
        kill_existing_server()

        # Start fresh with this model
        env = {
            **__import__('os').environ,
            'LOCAL_VISION_MODEL_PATH': model_path,
        }
        proc = subprocess.Popen(
            [f'{args.mlvenv}/bin/python', args.server_cmd, '--host', '127.0.0.1', '--port', str(args.port)],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            env=env,
        )

        # Wait for ready
        url = f'http://127.0.0.1:{args.port}/health'
        if not wait_for_ready(url, timeout=60):
            print(f'!! Server failed to start within timeout')
            proc.terminate()
            continue

        # Run each image
        for img_path in args.images:
            if not Path(img_path).exists():
                print(f'  [skip] {img_path} not found')
                continue
            print(f'\n  Image: {img_path}')
            for run_idx in range(args.runs_per_image):
                r = analyze_via_fastapi(img_path, args.port)
                print(f'    Run {run_idx+1}:')
                print(f'      tile_count  = {r.get("tile_count")}')
                print(f'      avg_conf    = {r.get("avg_confidence", 0):.4f}')
                print(f'      tiles       = {r.get("tiles")}')
                print(f'      e2e_ms      = {r.get("_e2e_ms")}')

        # Shutdown
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    # Cleanup
    kill_existing_server()
    print('\n=== done ===')


if __name__ == '__main__':
    main()
