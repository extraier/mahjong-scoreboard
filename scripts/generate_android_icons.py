#!/usr/bin/env python3
"""
generate_android_icons.py — install the 麻雀神器 PRO brand emblem as the
Android launcher icon + splash screen.

The source emblem is a circular badge on a pale background (no alpha).
This script:
  1. Detects the circular badge bounds, crops to it
  2. Applies a circular alpha mask (feathered edge)
  3. Emits legacy launcher icons (ic_launcher.png) at all 5 mipmap densities
  4. Emits round variants (ic_launcher_round.png) with a circular crop
  5. Emits adaptive-icon foregrounds (ic_launcher_foreground.png) at 108dp
     scale with the badge inside the 66dp safe zone (Android adaptive
     icons get masked to various shapes, so the logo must be inset)
  6. Emits splash.png at 9 densities x 2 orientations, logo centered on
     the brand emerald-950 background

Usage:
  python3 scripts/generate_android_icons.py <source-image> [output-root]
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

# Android launcher icon densities: (folder suffix, launcher px, foreground px)
MIPMAPS = [
    ("mdpi", 48, 108),
    ("hdpi", 72, 162),
    ("xhdpi", 96, 216),
    ("xxhdpi", 144, 324),
    ("xxxhdpi", 192, 432),
]

# Splash densities: (folder suffix, base px for portrait width)
SPLASH_PORTRAIT = [
    ("port-mdpi", 320),
    ("port-hdpi", 480),
    ("port-xhdpi", 720),
    ("port-xxhdpi", 960),
    ("port-xxxhdpi", 1280),
]
SPLASH_LANDSCAPE = [
    ("land-mdpi", 480),
    ("land-hdpi", 720),
    ("land-xhdpi", 1280),
    ("land-xxhdpi", 1600),
    ("land-xxxhdpi", 1920),
]

BRAND_BG = (6, 78, 59)  # #064e3b emerald-950, matches capacitor.config.ts
SPLASH_BG = (6, 78, 59)


def detect_badge_bounds(img: Image.Image) -> tuple[int, int, int, int]:
    """Find the bounding box of the circular badge.

    The emblem is a light circular disk on a pale background. We find it by
    scanning for pixels that differ noticeably from the corner (background)
    colour, then take the tight bounding box.
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()

    # Background reference = median of the four corners
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
    bg = tuple(sorted(c[i] for c in corners)[2] for i in range(3))

    def differs(p, thresh=26):
        return sum(abs(p[i] - bg[i]) for i in range(3)) > thresh

    # Column/row profiles of non-background pixels
    cols = [0] * w
    rows = [0] * h
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if differs(px[x, y]):
                cols[x] += 1
                rows[y] += 1

    # Ignore sparse noise at the edges
    col_thresh = max(2, int(h * 0.02))
    row_thresh = max(2, int(w * 0.02))
    xs = [x for x in range(w) if cols[x] > col_thresh]
    ys = [y for y in range(h) if rows[y] > row_thresh]
    if not xs or not ys:
        return (0, 0, w, h)

    x0, x1 = min(xs), max(xs)
    y0, y1 = min(ys), max(ys)
    return (x0, y0, x1 + 1, y1 + 1)


def crop_badge(img: Image.Image) -> Image.Image:
    """Crop to the circular badge and apply a feathered circular alpha mask."""
    box = detect_badge_bounds(img)
    badge = img.convert("RGB").crop(box)

    # Square it up — the badge is circular so we want a square crop
    w, h = badge.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    badge = badge.crop((left, top, left + side, top + side))

    # Circular alpha mask with a small feather so the edge isn't jagged
    size = badge.size[0]
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    pad = int(size * 0.005)
    draw.ellipse((pad, pad, size - pad, size - pad), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=max(1, size * 0.004)))

    out = badge.convert("RGBA")
    out.putalpha(mask)
    return out


def make_legacy(badge: Image.Image, px: int) -> Image.Image:
    """Legacy square launcher icon — badge fills the frame with small padding."""
    pad = int(px * 0.04)
    canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    inner = badge.resize((px - pad * 2, px - pad * 2), Image.LANCZOS)
    canvas.paste(inner, (pad, pad), inner)
    return canvas


def make_round(badge: Image.Image, px: int) -> Image.Image:
    """Round launcher icon — badge cropped to a perfect circle."""
    canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    inner = badge.resize((px, px), Image.LANCZOS)
    canvas.paste(inner, (0, 0), inner)
    return canvas


def make_adaptive_foreground(badge: Image.Image, px: int) -> Image.Image:
    """Adaptive-icon foreground (108dp canvas, logo within the 66dp safe zone).

    The safe zone is a 66dp circle centred in the 108dp canvas; we inset the
    badge to 60dp (90% of safe zone) so no part of the emblem gets clipped
    by the OEM shape mask (circle, squircle, teardrop, etc.).
    """
    canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    logo_px = int(px * 60 / 108)
    logo = badge.resize((logo_px, logo_px), Image.LANCZOS)
    offset = (px - logo_px) // 2
    canvas.paste(logo, (offset, offset), logo)
    return canvas


def make_splash(badge: Image.Image, width: int, landscape: bool) -> Image.Image:
    """Splash screen — brand green background, emblem centred."""
    if landscape:
        height = int(width * 0.5625)  # 16:9
    else:
        height = int(width * 1.7778)  # 9:16

    canvas = Image.new("RGB", (width, height), SPLASH_BG)

    logo_px = int(width * 0.42)
    logo = badge.resize((logo_px, logo_px), Image.LANCZOS)
    # Composite preserving the emblem's alpha over the green background
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(logo, ((width - logo_px) // 2, (height - logo_px) // 2), logo)
    return Image.alpha_composite(canvas.convert("RGBA"), layer).convert("RGB")


def save_web_image(img: Image.Image, path: Path, webp: bool = False) -> None:
    """Save an image, using WebP when it shrinks the file meaningfully.

    Android splash screens are flat colour + a small logo — WebP encodes
    those in a fraction of the PNG bytes, which matters because the PNG
    variants are otherwise stored near-raw in the APK.
    """
    if webp:
        img.save(path, "WEBP", quality=92, method=6)
        return
    # Quantise to an adaptive palette so flat areas collapse to few bytes
    quantised = img.convert("RGBA").quantize(colors=256, method=Image.FASTOCTREE)
    quantised.save(path, "PNG", optimize=True)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(f"usage: {sys.argv[0]} <source-image> [output-root]")

    src_path = Path(sys.argv[1]).expanduser()
    res_root = (
        Path(sys.argv[2]).expanduser()
        if len(sys.argv) > 2
        else Path.home() / "mahjong-scoreboard/android/app/src/main/res"
    )
    if not src_path.exists():
        sys.exit(f"source image not found: {src_path}")

    src = Image.open(src_path)
    print(f"source: {src_path} ({src.size[0]}×{src.size[1]})")

    badge = crop_badge(src)
    print(f"badge cropped to {badge.size[0]}×{badge.size[1]} with circular alpha mask")

    # 1. Launcher icons
    for suffix, launcher_px, fg_px in MIPMAPS:
        folder = res_root / f"mipmap-{suffix}"
        folder.mkdir(parents=True, exist_ok=True)

        save_web_image(make_legacy(badge, launcher_px), folder / "ic_launcher.png")
        save_web_image(make_round(badge, launcher_px), folder / "ic_launcher_round.png")
        save_web_image(
            make_adaptive_foreground(badge, fg_px), folder / "ic_launcher_foreground.png"
        )
        print(f"  mipmap-{suffix}: ic_launcher + ic_launcher_round @{launcher_px}px, foreground @{fg_px}px")

    # 2. Splash screens — WebP (flat colour + logo compresses ~10x better)
    for suffix, width in SPLASH_PORTRAIT:
        folder = res_root / f"drawable-{suffix}"
        folder.mkdir(parents=True, exist_ok=True)
        save_web_image(make_splash(badge, width, landscape=False), folder / "splash.webp", webp=True)
        print(f"  drawable-{suffix}: splash.webp @{width}px portrait")

    for suffix, width in SPLASH_LANDSCAPE:
        folder = res_root / f"drawable-{suffix}"
        folder.mkdir(parents=True, exist_ok=True)
        save_web_image(make_splash(badge, width, landscape=True), folder / "splash.webp", webp=True)
        print(f"  drawable-{suffix}: splash.webp @{width}px landscape")

    # 3. Web favicon + PWA icons (Play Console wants 512×512 for the store listing)
    # res_root = <project>/android/app/src/main/res  → 5 parents up = <project>
    project_root = res_root.parent.parent.parent.parent.parent
    web_public = project_root / "public"
    web_public.mkdir(parents=True, exist_ok=True)
    # Quantised PNGs — these get bundled into the APK's assets/public/ dir, so
    # every byte counts (an unquantised 512px PNG was 321 KB).
    save_web_image(make_legacy(badge, 512), web_public / "icon-512.png")
    save_web_image(make_legacy(badge, 192), web_public / "icon-192.png")
    save_web_image(make_legacy(badge, 32), web_public / "favicon.png")
    print(f"  web public: icon-512.png, icon-192.png, favicon.png")

    # 4. Play Store listing icon (512×512 PNG, no transparency allowed).
    #    Kept at full quality (not quantised) — this file is NOT bundled into
    #    the APK, so there's no size cost, and Play Console displays it large.
    listing = project_root / "dist" / "play-store-icon-512.png"
    listing.parent.mkdir(parents=True, exist_ok=True)
    make_legacy(badge, 512).convert("RGB").save(listing, optimize=True)
    print(f"  play store listing: {listing} (512×512 opaque, full quality)")


if __name__ == "__main__":
    main()
