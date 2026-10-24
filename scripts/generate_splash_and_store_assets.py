#!/usr/bin/env python3
"""
generate_splash_and_store_assets.py — install the 麻雀神器 promo graphic
as the Android launch splash, and derive the Play Store listing assets.

Inputs:
  --promo   portrait promo graphic (e.g. 714×1280) used as the splash
  --icon    circular emblem PNG (used for the Play Store feature graphic
            and the app icon, which must be a square 512×512)

Outputs:
  android/app/src/main/res/drawable-*/splash.webp   (9 densities × 2 orientations)
  dist/play-store-feature-graphic-1024x500.png        (Play Console required)
  dist/play-store-screenshot-phone-*.png               (2 phone screenshots)
  dist/play-store-icon-512.png                        (Play Console required)

Why WebP for splash: the PNG variants of a photographic-style splash are
stored near-raw by aapt2 and blew the release APK up to 6.3 MB. WebP
brings the whole res/ dir from 3.3 MB → ~700 KB.

Usage:
  python3 scripts/generate_splash_and_store_assets.py \
      --promo ~/path/promo.jpg --icon ~/path/emblem.jpg
"""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

BRAND_BG = (6, 78, 59)  # #064e3b emerald-950
PROJECT_ROOT = Path.home() / "mahjong-scoreboard"
RES_ROOT = PROJECT_ROOT / "android/app/src/main/res"

# (folder suffix, splash width in px)
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

CJK_FONTS = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
]


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for path in CJK_FONTS:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def fit_portrait(promo: Image.Image, width: int) -> Image.Image:
    """Scale the promo to fill a portrait splash of the given width."""
    height = int(width * 1.7778)
    # Scale to cover, then centre-crop the overflow (promo aspect ≈ 9:16).
    scale = max(width / promo.width, height / promo.height)
    scaled = promo.resize(
        (max(1, int(promo.width * scale)), max(1, int(promo.height * scale))),
        Image.LANCZOS,
    )
    left = (scaled.width - width) // 2
    top = (scaled.height - height) // 2
    return scaled.crop((left, top, left + width, top + height)).convert("RGB")


def fit_landscape(promo: Image.Image, width: int) -> Image.Image:
    """Landscape splash: promo centred on the brand green, no letterbox bars."""
    height = int(width * 0.5625)
    canvas = Image.new("RGB", (width, height), BRAND_BG)
    # Promo occupies ~62% of the height so the brand shows around it.
    target_h = int(height * 0.94)
    scale = target_h / promo.height
    scaled = promo.resize(
        (max(1, int(promo.width * scale)), target_h), Image.LANCZOS
    )
    canvas.paste(scaled, ((width - scaled.width) // 2, (height - scaled.height) // 2))
    return canvas


def make_feature_graphic(icon_badge: Image.Image) -> Image.Image:
    """Play Console feature graphic: 1024×500, logo left, text right."""
    W, H = 1024, 500
    canvas = Image.new("RGB", (W, H), BRAND_BG)

    # Subtle radial vignette so the flat green doesn't look dead
    from PIL import ImageFilter

    grad = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(grad)
    d.ellipse((-200, -300, 700, 500), fill=70)
    grad = grad.filter(ImageFilter.GaussianBlur(120))
    canvas = Image.composite(Image.new("RGB", (W, H), (12, 96, 72)), canvas, grad)

    # Logo medallion on the left — the emblem may be a flat RGB image, so
    # derive a circular alpha mask for it before compositing.
    logo_px = 320
    badge = icon_badge.resize((logo_px, logo_px), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (logo_px, logo_px), 0)
    ImageDraw.Draw(mask).ellipse((2, 2, logo_px - 2, logo_px - 2), fill=255)
    badge.putalpha(mask)

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    layer.paste(badge, (72, (H - logo_px) // 2), badge)
    canvas = Image.alpha_composite(canvas.convert("RGBA"), layer).convert("RGB")

    # Text block
    draw = ImageDraw.Draw(canvas)
    title_font = load_font(76)
    sub_font = load_font(34)
    slogan_font = load_font(40)
    x = 440
    draw.text((x, 150), "麻雀神器", font=title_font, fill=(255, 255, 255))
    draw.text((x, 246), "AI 拍牌識別 · 自動計分 · 對局統計", font=sub_font, fill=(253, 230, 138))
    draw.text((x, 320), "運籌帷幄，決勝千里", font=slogan_font, fill=(255, 255, 255))
    draw.text((x, 396), "comparetiger.com", font=load_font(28), fill=(148, 163, 184))
    return canvas


def make_screenshot(promo: Image.Image, caption: str, subcaption: str, index: int) -> Image.Image:
    """Play Console phone screenshot: 1080×1920, promo top, caption band below."""
    W, H = 1080, 1920
    canvas = Image.new("RGB", (W, H), BRAND_BG)

    # Promo fills the top 1080×1440 (3:4 crop of the source)
    promo_h = 1440
    scale = max(W / promo.width, promo_h / promo.height)
    scaled = promo.resize(
        (max(1, int(promo.width * scale)), max(1, int(promo.height * scale))),
        Image.LANCZOS,
    )
    left = (scaled.width - W) // 2
    top = (scaled.height - promo_h) // 2
    canvas.paste(scaled.crop((left, top, left + W, top + promo_h)), (0, 0))

    # Caption band
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([(0, promo_h), (W, H)], fill=BRAND_BG)
    draw.text((80, promo_h + 90), caption, font=load_font(72), fill=(255, 255, 255))
    draw.text((80, promo_h + 190), subcaption, font=load_font(38), fill=(253, 230, 138))
    return canvas


def save_webp(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=92, method=6)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--promo", required=True, help="portrait promo graphic")
    ap.add_argument("--icon", required=True, help="circular emblem (for feature graphic)")
    args = ap.parse_args()

    promo = Image.open(Path(args.promo).expanduser()).convert("RGB")
    emblem = Image.open(Path(args.icon).expanduser()).convert("RGB")
    print(f"promo: {promo.size}  emblem: {emblem.size}")

    # 1. Android splash screens
    for suffix, width in SPLASH_PORTRAIT:
        img = fit_portrait(promo, width)
        save_webp(img, RES_ROOT / f"drawable-{suffix}" / "splash.webp")
        print(f"  drawable-{suffix}/splash.webp  {img.size}")
    for suffix, width in SPLASH_LANDSCAPE:
        img = fit_landscape(promo, width)
        save_webp(img, RES_ROOT / f"drawable-{suffix}" / "splash.webp")
        print(f"  drawable-{suffix}/splash.webp  {img.size}")

    # 1b. Base drawable fallback. Without a declaration in the plain
    #     `drawable/` folder, lintVital fails the release build with
    #     MissingDefaultResource and the app can crash when the splash is
    #     queried in a configuration that matches neither -port- nor -land-.
    base_splash = fit_portrait(promo, 720)
    save_webp(base_splash, RES_ROOT / "drawable" / "splash.webp")
    print(f"  drawable/splash.webp (default fallback)  {base_splash.size}")

    # Play Console assets go to `store-assets/`, NOT `dist/`.
    # `dist/` is gitignored AND wiped by `vite build`, so the listing assets
    # kept disappearing after every web build. `store-assets/` is committed
    # so the Play Console upload always has the current artwork on disk.
    dist = PROJECT_ROOT / "store-assets"
    dist.mkdir(parents=True, exist_ok=True)

    # 2. Play Console feature graphic
    feature = make_feature_graphic(emblem)
    feature.save(dist / "play-store-feature-graphic-1024x500.png", optimize=True)
    print(f"  play-store-feature-graphic-1024x500.png  {feature.size}")

    # 3. Phone screenshots
    shots = [
        ("AI 拍牌識別", "一拍照，AI 即刻認晒你啲牌", 1),
        ("自動計分・對局統計", "起承轉合，邊隻上唔好一目了然", 2),
    ]
    for caption, sub, idx in shots:
        img = make_screenshot(promo, caption, sub, idx)
        path = dist / f"play-store-screenshot-phone-{idx}.png"
        img.save(path, optimize=True)
        print(f"  {path.name}  {img.size}")


if __name__ == "__main__":
    main()
