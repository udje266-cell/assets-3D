#!/usr/bin/env python3
"""Décline les visuels de marque URIGO à partir des originaux fournis.

Les deux originaux sont dans `tools/brand/source/` et ne sont **jamais**
redessinés : le logotype et le symbole sont recadrés, mis à l'échelle et posés
sur le noir de la marque, rien de plus. Une icône d'application existe en une
dizaine de tailles et de variantes (iOS, icône adaptative Android, monochrome,
favicon, écran de lancement) ; les tenir cohérentes à la main est une source
d'écarts silencieux. Le script est la recette, les PNG sont des sorties.

    python3 tools/brand/generate.py

Seule addition assumée : le badge « PRO » de l'application chauffeur, qui doit
se distinguer de l'application client sur l'écran d'accueil du téléphone. Il est
posé à côté du visuel, jamais dessus.
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SRC = Path(__file__).resolve().parent / "source"
FONT_PATH = Path(__file__).resolve().parent / "Outfit-Bold.ttf"

WORDMARK_SRC = SRC / "urigo-logotype.png"
MARK_SRC = SRC / "urigo-symbole.png"

# Couleurs relevées sur les originaux ; reprises telles quelles dans
# packages/shared/src/theme.ts.
ORANGE = (253, 126, 2, 255)
WHITE = (255, 255, 255, 255)
BLACK = (0, 0, 0, 255)
CLEAR = (0, 0, 0, 0)

# Le logotype fourni porte la signature « BOUGEZ. PARTAGEZ. ARRIVEZ. » sous le
# mot ; elle n'est pas voulue dans l'application, d'où la découpe en hauteur.
WORDMARK_BOX = (165, 30, 1089, 178)
MARK_BOX = (282, 31, 895, 517)


def _trimmed(path: Path, box: tuple[int, int, int, int]) -> Image.Image:
    return Image.open(path).convert("RGB").crop(box)


def _on_black(content: Image.Image, side: int, *, scale: float) -> Image.Image:
    """Pose le visuel, sans le déformer, au centre d'un carré noir."""
    target = int(side * scale)
    ratio = min(target / content.width, target / content.height)
    inner = content.resize(
        (max(1, round(content.width * ratio)), max(1, round(content.height * ratio))),
        Image.LANCZOS,
    )
    plate = Image.new("RGB", (side, side), BLACK[:3])
    plate.paste(inner, ((side - inner.width) // 2, (side - inner.height) // 2))
    return plate


def _cut_out(content: Image.Image) -> Image.Image:
    """Détoure le visuel de son fond noir, en conservant ses couleurs.

    L'opacité est déduite de la luminance : le fond d'origine est noir uni, et
    les bords adoucis du visuel deviennent des bords adoucis d'opacité.
    """
    rgba = content.convert("RGBA")
    lum = content.convert("L").point(lambda v: min(255, int(v * 3.2)))
    rgba.putalpha(lum)
    return rgba


def _silhouette(content: Image.Image) -> Image.Image:
    """Aplat blanc sur transparent — exigence de l'icône monochrome d'Android."""
    alpha = content.convert("L").point(lambda v: 255 if v > 28 else 0)
    mono = Image.new("RGBA", content.size, WHITE)
    mono.putalpha(alpha)
    return mono


def _pro_badge(height: int) -> Image.Image:
    """Pastille « PRO », en italique appuyée comme le logotype."""
    ss = 4
    h = height * ss
    font = ImageFont.truetype(str(FONT_PATH), int(h * 0.62))
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    text_w = probe.textlength("PRO", font=font)
    w = int(text_w + h * 0.9)

    badge = Image.new("RGBA", (w + int(h * 0.3), h), CLEAR)
    d = ImageDraw.Draw(badge)
    d.rounded_rectangle((0, 0, w, h - 1), radius=h // 2, fill=ORANGE)
    d.text((w / 2 - text_w / 2, h * 0.16), "PRO", font=font, fill=BLACK)

    slant = 0.18
    badge = badge.transform(
        (badge.width, h), Image.AFFINE, (1, slant, -slant * h, 0, 1, 0),
        resample=Image.BICUBIC,
    )
    return badge.resize((badge.width // ss, height), Image.LANCZOS)


def _with_badge(content: Image.Image, *, gap_ratio: float = 0.10) -> Image.Image:
    """Logotype suivi de la pastille « PRO », sur le noir de la marque."""
    badge = _pro_badge(int(content.height * 0.46))
    gap = int(content.height * gap_ratio)
    out = Image.new("RGB", (content.width + gap + badge.width, content.height), BLACK[:3])
    out.paste(content, (0, 0))
    out.paste(badge, (content.width + gap, (content.height - badge.height) // 2), badge)
    return out


def _badged_mark(mark: Image.Image) -> Image.Image:
    """Symbole surmonté de la pastille « PRO », pour l'icône chauffeur.

    Le symbole n'est pas modifié : la pastille est ajoutée au-dessous, dans la
    marge, de sorte que les deux icônes se lisent comme une même famille.
    """
    badge = _pro_badge(int(mark.height * 0.26))
    gap = int(mark.height * 0.08)
    out = Image.new("RGB", (max(mark.width, badge.width), mark.height + gap + badge.height), BLACK[:3])
    out.paste(mark, ((out.width - mark.width) // 2, 0))
    out.paste(badge, ((out.width - badge.width) // 2, mark.height + gap), badge)
    return out


def write(path: Path, img: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)
    print(f"  {path.relative_to(ROOT)}  {img.width}×{img.height}")


def build_app(app: str, *, driver: bool) -> None:
    out = ROOT / "apps" / app / "assets"
    print(f"{app} :")

    mark = _trimmed(MARK_SRC, MARK_BOX)
    icon_source = _badged_mark(mark) if driver else mark

    # iOS et web : icône pleine, la plateforme applique elle-même l'arrondi.
    write(out / "icon.png", _on_black(icon_source, 1024, scale=0.78))
    write(out / "favicon.png", _on_black(icon_source, 48, scale=0.88))

    # Android adaptatif : le système peut rogner jusqu'au tiers du côté. Le
    # visuel doit donc tenir dans la zone sûre centrale, d'où l'échelle réduite.
    write(out / "android-icon-background.png", Image.new("RGB", (1024, 1024), BLACK[:3]))
    fg = Image.new("RGBA", (1024, 1024), CLEAR)
    cut = _cut_out(_on_black(icon_source, 1024, scale=0.55))
    fg.paste(cut, (0, 0), cut)
    write(out / "android-icon-foreground.png", fg)

    mono = Image.new("RGBA", (1024, 1024), CLEAR)
    sil = _silhouette(_on_black(icon_source, 1024, scale=0.55))
    mono.paste(sil, (0, 0), sil)
    write(out / "android-icon-monochrome.png", mono)

    # Écran de lancement : fond noir de la marque, symbole seul.
    write(out / "splash-icon.png", _on_black(icon_source, 512, scale=0.70))

    # Logotype affiché dans l'application, sans la signature.
    wordmark = _trimmed(WORDMARK_SRC, WORDMARK_BOX)
    if driver:
        wordmark = _with_badge(wordmark)
    ratio = 132 / wordmark.height
    write(out / "wordmark.png",
          wordmark.resize((round(wordmark.width * ratio), 132), Image.LANCZOS))


def main() -> None:
    for path in (WORDMARK_SRC, MARK_SRC, FONT_PATH):
        if not path.exists():
            raise SystemExit(f"Fichier source absent : {path}")

    build_app("mobile-client", driver=False)
    build_app("mobile-driver", driver=True)

    print("administration :")
    mark = _trimmed(MARK_SRC, MARK_BOX)
    write(ROOT / "apps" / "admin" / "public" / "favicon.png", _on_black(mark, 64, scale=0.88))
    wordmark = _trimmed(WORDMARK_SRC, WORDMARK_BOX)
    ratio = 96 / wordmark.height
    write(ROOT / "apps" / "admin" / "public" / "urigo.png",
          wordmark.resize((round(wordmark.width * ratio), 96), Image.LANCZOS))


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
