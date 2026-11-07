"""Evaluation of the gate models on our pictures (ADR-059, ADR-061): correct / total for the
vehicle type and the plate. Runs in the app image (the models are there):

    docker compose run --rm -v "$(pwd)/ml:/app/ml-src" app python /app/ml-src/eval_gate.py
    (Git Bash na Windows: MSYS_NO_PATHCONV=1 a $(pwd -W))

Pictures:
- the CC0 photos from app/tests/data (a semi-trailer, a Ford Transit), type known, no Slovak plate,
- synthetic plates (Pillow): 12 fleet and external plates in 4 conditions each
  (clean, rotated 4°, blurred, small and noisy). They test the OCR and the plate rules only,
  not a real camera at the gate.
"""

from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from depotrack.ml.gate import decode_image, gate_models

DATA = Path("/app/tests/data")
PHOTOS = [("gate_truck_cc0.jpg", "truck", None), ("gate_van_cc0.jpg", "van", None)]
PLATES = [
    "KE-101LH", "KE-204TR", "KE-301KR", "KE-308KR", "BA-512ZT", "KE-640SV",
    "PO-215CL", "ZA-999XY", "TT-482XA", "NR-130KD", "BB-807MR", "KS-455HK",
]  # fmt: skip


def plate_image(text: str, variant: str, seed: int) -> bytes:
    img = Image.new("RGB", (520, 120), "white")
    draw = ImageDraw.Draw(img)
    draw.rectangle([4, 4, 515, 115], outline="black", width=4)
    draw.text((40, 18), text, fill="black", font=ImageFont.load_default(size=80))
    if variant == "rotated":
        img = img.rotate(4, expand=True, fillcolor="white")
    elif variant == "blurred":
        img = img.filter(ImageFilter.GaussianBlur(2.2))
    elif variant == "small_noisy":
        img = img.resize((200, 46))
        rng = np.random.default_rng(seed)
        arr = np.asarray(img).astype(np.int16) + rng.normal(0, 25, (46, 200, 3)).astype(np.int16)
        img = Image.fromarray(arr.clip(0, 255).astype(np.uint8))
    # on a grey background, like a crop from a bigger picture
    canvas = Image.new("RGB", (img.width + 200, img.height + 160), (128, 128, 128))
    canvas.paste(img, (100, 80))
    buf = BytesIO()
    canvas.save(buf, "PNG")
    return buf.getvalue()


def main() -> None:
    models = gate_models()
    assert models is not None, "gate models not loaded"
    print("photo | expected type | type (detail, confidence) | plate")
    type_ok = plate_ok = 0
    for name, kind, plate in PHOTOS:
        r = models.read(decode_image((DATA / name).read_bytes()))
        big = max(r.vehicles, key=lambda v: (v.box[2] - v.box[0]) * (v.box[3] - v.box[1]))
        type_ok += big.type == kind
        plate_ok += r.plate == plate  # no Slovak plate on these photos: None is right
        print(f"{name} | {kind} | {big.type} ({big.detail}, {big.confidence:.2f}) | {r.plate}")
    print(f"type: {type_ok} / {len(PHOTOS)}, plate: {plate_ok} / {len(PHOTOS)}")

    by_variant: dict[str, list[int]] = {}
    confidence: dict[str, list[float]] = {}
    wrong: list[str] = []
    for i, text in enumerate(PLATES):
        for variant in ("clean", "rotated", "blurred", "small_noisy"):
            r = models.read(decode_image(plate_image(text, variant, i)))
            ok = r.plate == text
            by_variant.setdefault(variant, []).append(ok)
            if r.plate_confidence is not None:
                confidence.setdefault(variant, []).append(r.plate_confidence)
            if not ok:
                wrong.append(f"{variant} {text} -> {r.plate} ({r.text!r})")
    total = sum(sum(v) for v in by_variant.values())
    count = sum(len(v) for v in by_variant.values())
    for variant, oks in by_variant.items():
        conf = confidence.get(variant) or [0.0]
        print(f"plate {variant}: {sum(oks)} / {len(oks)}, OCR confidence min {min(conf):.2f}")
    print(f"plate total: {total} / {count}")
    for w in wrong:
        print("  wrong:", w)


if __name__ == "__main__":
    main()
