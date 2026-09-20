#!/usr/bin/env python3
"""
local_vision_server.py — FastAPI shim around the local ViT pipeline.

Replaces tsx-spawn-python per-request pattern with a long-lived server.
Model loaded once at startup; subsequent requests reuse it (no cold-load).

Endpoints:
  POST /analyze   multipart/form-data with 'image' field  -> {tiles, ...}
  POST /analyze   { "image_b64": "..." }                  -> {tiles, ...}  (JSON)
  GET  /health   -> {status, device, num_classes, ...}
  GET  /ready    -> {ready: true}

Run with:
  ./mlvenv/bin/python scripts/local_vision_server.py --port 8789

The Node side (localVision.ts) talks to this server at LOCAL_VISION_HTTP_URL
(default http://localhost:8789). Falls back to spawning the CLI script if
the HTTP URL is unreachable (so existing tests/dev still work).
"""

import argparse
import sys
import time
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).parent))
from local_vision_recognizer import get_service, ImageQualityError  # noqa: E402

import cv2
import numpy as np

app = FastAPI(title='mahjong local vision', version='0.3.0')


class HealthState:
    ready = False
    load_time_ms = 0
    load_error: str | None = None


@app.on_event('startup')
def startup():
    """Load model eagerly so /health reports ready."""
    t0 = time.time()
    try:
        get_service()
        HealthState.ready = True
        HealthState.load_time_ms = int((time.time() - t0) * 1000)
        print(f'[startup] model loaded in {HealthState.load_time_ms}ms, service ready', flush=True)
    except Exception as e:  # pragma: no cover
        HealthState.ready = False
        HealthState.load_error = str(e)
        print(f'[startup] FATAL: model load failed: {e}', flush=True)


@app.get('/health')
def health():
    svc = get_service()
    state = svc.health()
    state['load_time_ms'] = HealthState.load_time_ms
    if HealthState.load_error:
        state['load_error'] = HealthState.load_error
    return state


@app.get('/ready')
def ready():
    if not HealthState.ready:
        raise HTTPException(status_code=503, detail='model not loaded yet')
    return {'ready': True}


@app.post('/analyze')
async def analyze(image: UploadFile = File(...)):
    """Accept multipart/form-data with 'image' field. Returns tile list + bboxes.

    Validates image quality (resolution / blur / brightness). Returns a
    structured 400 response with retry instructions if the image is too
    low-quality to recognize reliably.
    """
    contents = await image.read()
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail='empty image')

    nparr = np.frombuffer(contents, np.uint8)
    image_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise HTTPException(status_code=400, detail='cv2 failed to decode image')

    svc = get_service()
    try:
        return svc.classify_hand(image_bgr, file_size=len(contents))
    except ImageQualityError as e:
        # 422 Unprocessable Entity: image is valid but unrecognizable.
        # The Node side reads error_code + retry_hint to show a useful message.
        return JSONResponse(
            status_code=422,
            content=e.to_dict(),
        )


class AnalyzeJSON(BaseModel):
    image_b64: str


@app.post('/analyze_json')
async def analyze_json(body: AnalyzeJSON):
    """Accept { image_b64: "..." } JSON body (matches npm Buffer.toString('base64')).

    Same quality validation as /analyze — returns 422 with retry instructions
    for low-quality images.
    """
    import base64
    try:
        raw = base64.b64decode(body.image_b64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f'invalid base64: {e}') from e
    nparr = np.frombuffer(raw, np.uint8)
    image_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image_bgr is None:
        raise HTTPException(status_code=400, detail='cv2 failed to decode image')

    svc = get_service()
    try:
        return svc.classify_hand(image_bgr, file_size=len(raw))
    except ImageQualityError as e:
        return JSONResponse(
            status_code=422,
            content=e.to_dict(),
        )


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--port', type=int, default=8789)
    p.add_argument('--workers', type=int, default=1)
    args = p.parse_args()

    # Each uvicorn worker loads its own model (so workers=1 by default).
    # Multiple workers would multiply RAM by N — for mahjong scoring a single
    # worker handles ~1-2 requests/s without queueing.
    uvicorn.run(app, host=args.host, port=args.port, workers=args.workers, log_level='info')


if __name__ == '__main__':
    main()
