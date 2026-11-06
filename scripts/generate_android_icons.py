#!/usr/bin/env python3
"""
generate_android_icons.py — install the 麻雀神器 brand emblem as the
Android launcher icon + splash screen.

The source emblem is a circular badge on a pale background (no alpha).
This script:
  1. Detects the circular badge bounds, crops to it
  2. Applies a circular alpha mask (feathered edge)
  3. Emits legacy launcher icons (ic_launcher.png) at all 5 mipmap densities
  4. Emits round variants (ic_launcher_round.png) with a circular crop
  5. Emits adaptive-icon foregrounds (ic_launcher_foreground.png) at 108dp
     with the circular badge at 72/108 — the diameter of the circular OEM
     mask. The gold rim then sits on the mask edge (full-bleed clips the
     rim; a deep inset leaves a background ring).
  6. Emits splash.webp at 9 densities x 2 orientations, plus an unqualified
     fallback, emblem centered on the brand emerald-950 background at 28%
     of the shorter edge
  7. Emits drawable-nodpi/splash_icon.png for the Android 12+ splash icon.
     Only the center 2/3 of that slot is drawn, so the emblem is padded
     to ~100dp instead of filling the masked circle.

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

# Circular launcher masks reveal the center 72dp of the 108dp foreground.
# 60/108 sat inside the keyline and left a ring; 108/108 (1.0.7) was
# clipped by the mask, so the gold rim was cut and the emblem looked zoomed.
ADAPTIVE_LOGO_NUMER = 72
ADAPTIVE_LOGO_DENOM = 108

# Splash bitmap: fraction of the shorter edge. 0.42 of the image width was
# ~134dp on portrait phones and, in landscape, 0.42 of the long edge.
# 0.28 of the shorter edge is a typical centered mark (~90dp on a 320dp-wide
# phone, ~100dp on a 360dp-wide one) in both orientations.
SPLASH_LOGO_OF_SHORT_SIDE = 0.28

# Android 12+ splash icon slot is 288dp and only the center 192dp circle is
# drawn (outer third masked, same idea as adaptive icons). 100/288 lands the
# emblem at ~100dp — inside that circle, and in line with the bitmap above
# on a typical phone — instead of a clipped ~192dp disc.
SPLASH_ICON_PX = 1152  # 288dp at xxxhdpi; nodpi so the system does not prescale
SPLASH_ICON_LOGO_NUMER = 100
SPLASH_ICON_LOGO_DENOM = 288


def detect_badge_bounds(img: Image.Image) -> tuple[int, int, int, int]:
    """Return a square crop centred on the circular badge.

    The emblem is a coloured disk on a pale field. That field is not flat:
    the source JPEG vignettes toward the bottom-right, and the badge casts
    a soft gray shadow. Thresholding against one corner colour treats the
    vignette as content, so the box runs to the image edge and the emblem
    sits up-left inside the circular mask.

    Measure the border, set the threshold above that spread, and ignore
    low-saturation pixels (vignette and shadow). The widest content row and
    the tallest content column are the circle's diameters; the crop is a
    square about their centre.
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()

    border: list[tuple[int, int, int]] = []
    for x in range(w):
        border.append(px[x, 0])
        border.append(px[x, h - 1])
    for y in range(1, h - 1):
        border.append(px[0, y])
        border.append(px[w - 1, y])

    def median_channel(i: int) -> int:
        vals = sorted(p[i] for p in border)
        return vals[len(vals) // 2]

    bg = tuple(median_channel(i) for i in range(3))

    def dist(p: tuple[int, int, int]) -> int:
        return abs(p[0] - bg[0]) + abs(p[1] - bg[1]) + abs(p[2] - bg[2])

    border_dists = sorted(dist(p) for p in border)
    p99 = border_dists[min(len(border_dists) - 1, int(len(border_dists) * 0.99))]
    # Above the vignette (border p99 is ~30 on the master emblem) so a
    # darker corner cannot stretch the box to the image edge.
    thresh = max(48, p99 + 16)

    def is_badge(p: tuple[int, int, int]) -> bool:
        if dist(p) <= thresh:
            return False
        # Low chroma is the vignette or the drop shadow, not the badge.
        return (max(p) - min(p)) > 20

    best_row: tuple[int, int, int] | None = None  # (span, x0, x1)
    for y in range(h):
        x0 = -1
        x1 = -1
        for x in range(w):
            if is_badge(px[x, y]):
                if x0 < 0:
                    x0 = x
                x1 = x
        if x0 >= 0:
            span = x1 - x0
            if best_row is None or span > best_row[0]:
                best_row = (span, x0, x1)

    best_col: tuple[int, int, int] | None = None  # (span, y0, y1)
    for x in range(w):
        y0 = -1
        y1 = -1
        for y in range(h):
            if is_badge(px[x, y]):
                if y0 < 0:
                    y0 = y
                y1 = y
        if y0 >= 0:
            span = y1 - y0
            if best_col is None or span > best_col[0]:
                best_col = (span, y0, y1)

    if best_row is None or best_col is None:
        return (0, 0, w, h)

    cx = (best_row[1] + best_row[2]) / 2
    cy = (best_col[1] + best_col[2]) / 2
    # Larger diameter so the rim is not clipped on the shorter axis.
    # One extra pixel keeps the antialiased outer edge inside the crop
    # without reintroducing a visible pale ring.
    side = max(best_row[0], best_col[0]) + 1
    x0 = int(round(cx - side / 2))
    y0 = int(round(cy - side / 2))
    x1 = x0 + side
    y1 = y0 + side

    # Slide the square back into frame instead of clipping one side, which
    # would shift the emblem again.
    if x0 < 0:
        x1 -= x0
        x0 = 0
    if y0 < 0:
        y1 -= y0
        y0 = 0
    if x1 > w:
        shift = x1 - w
        x0 -= shift
        x1 -= shift
    if y1 > h:
        shift = y1 - h
        y0 -= shift
        y1 -= shift
    x0 = max(0, x0)
    y0 = max(0, y0)
    x1 = min(w, x1)
    y1 = min(h, y1)
    return (x0, y0, x1, y1)


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
    """Adaptive-icon foreground: circular badge at the 72dp mask diameter.

    The canvas is 108dp. Circular OEM masks show the center 72dp and clip
    the rest, so a badge at 72/108 fills the launcher circle: gold rim on
    the mask edge, no empty ring. Full-bleed (logo_px == px) is cropped by
    that mask. Every density we emit divides evenly (108, 162, 216, 324, 432).
    """
    canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    logo_px = px * ADAPTIVE_LOGO_NUMER // ADAPTIVE_LOGO_DENOM
    logo = badge.resize((logo_px, logo_px), Image.LANCZOS)
    offset = (px - logo_px) // 2
    canvas.paste(logo, (offset, offset), logo)
    return canvas


def make_splash(badge: Image.Image, width: int, landscape: bool) -> Image.Image:
    """Splash screen — brand green background, emblem centred.

    The emblem is SPLASH_LOGO_OF_SHORT_SIDE of the shorter edge so portrait
    and landscape keep the same visual weight. It used to be 0.42 of the
    image width, which crowded portrait and overflowed landscape.
    """
    if landscape:
        height = int(width * 0.5625)  # 16:9
    else:
        height = int(width * 1.7778)  # 9:16

    canvas = Image.new("RGB", (width, height), SPLASH_BG)

    logo_px = int(min(width, height) * SPLASH_LOGO_OF_SHORT_SIDE)
    logo = badge.resize((logo_px, logo_px), Image.LANCZOS)
    # Composite preserving the emblem's alpha over the green background
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.paste(logo, ((width - logo_px) // 2, (height - logo_px) // 2), logo)
    return Image.alpha_composite(canvas.convert("RGBA"), layer).convert("RGB")


def make_splash_icon(badge: Image.Image, px: int) -> Image.Image:
    """Android 12+ splash icon: emblem inside the unmasked center circle.

    The platform scales this drawable to a 288dp slot and draws only the
    center 192dp (outer third masked). The emblem is 100/288 of the canvas
    (~100dp on screen) so the rim stays inside that circle. Transparent
    padding lets the splash background color show around it.
    """
    canvas = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    logo_px = px * SPLASH_ICON_LOGO_NUMER // SPLASH_ICON_LOGO_DENOM
    logo = badge.resize((logo_px, logo_px), Image.LANCZOS)
    offset = (px - logo_px) // 2
    canvas.paste(logo, (offset, offset), logo)
    return canvas


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
    # Default to this repo's Android res dir so the documented one-arg
    # invocation writes the assets that ship, not a path under $HOME.
    default_res = Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main" / "res"
    res_root = Path(sys.argv[2]).expanduser() if len(sys.argv) > 2 else default_res
    if not src_path.exists():
        sys.exit(f"source image not found: {src_path}")

    src = Image.open(src_path)
    print(f"source: {src_path} ({src.size[0]}×{src.size[1]})")

    box = detect_badge_bounds(src)
    print(
        f"badge bounds: ({box[0]}, {box[1]})–({box[2]}, {box[3]}) "
        f"{box[2] - box[0]}×{box[3] - box[1]}"
    )
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

    # Unqualified fallback. Lint (MissingDefaultResource) requires drawable/splash
    # when the theme references @drawable/splash; keep it the same artwork.
    fallback = make_splash(badge, 720, landscape=False)
    save_web_image(fallback, res_root / "drawable" / "splash.webp", webp=True)
    print(f"  drawable/splash.webp (default fallback) {fallback.size[0]}×{fallback.size[1]}")

    # Android 12+ splash icon. nodpi: one sharp bitmap, scaled by the system
    # into the 288dp icon slot (only the center 192dp circle is visible).
    icon_dir = res_root / "drawable-nodpi"
    icon_dir.mkdir(parents=True, exist_ok=True)
    splash_icon = make_splash_icon(badge, SPLASH_ICON_PX)
    splash_icon.save(icon_dir / "splash_icon.png", "PNG", optimize=True)
    print(
        f"  drawable-nodpi/splash_icon.png @{SPLASH_ICON_PX}px "
        f"(emblem {SPLASH_ICON_PX * SPLASH_ICON_LOGO_NUMER // SPLASH_ICON_LOGO_DENOM}px)"
    )

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
    #    Goes to `store-assets/`, not `dist/` — `dist/` is gitignored and gets
    #    wiped by `vite build`, which kept deleting the listing artwork.
    listing = project_root / "store-assets" / "play-store-icon-512.png"
    listing.parent.mkdir(parents=True, exist_ok=True)
    make_legacy(badge, 512).convert("RGB").save(listing, optimize=True)
    print(f"  play store listing: {listing} (512×512 opaque, full quality)")


if __name__ == "__main__":
    main()
