"""Labels of real parcels of the day for the IoT scanner demo (phase 6, ADR-060); runs on the host.

    DEPOT_PASSWORD=<heslo dispečera> python ml/labels.py --door LD-06 --count 16 --out labels.pdf

Takes the parcels still to be loaded at the door (GET /api/shadow/doors/{door}, the truck loading
there now; load a situation first, e.g. morning-departures) and prints A4 pages with 8 labels each:
a QR code of the barcode, the barcode in text and the direction. Stick them on boxes, show the boxes
to `dock_scanner.py`, and the loading check in the WMS sees real parcels.
"""

import argparse

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from depot_client import login_from_env

A4 = (2480, 3508)  # 300 dpi
COLS, ROWS = 2, 4


def qr_image(text: str, size: int) -> Image.Image:
    matrix = cv2.QRCodeEncoder.create().encode(text)
    big = cv2.resize(matrix, (size, size), interpolation=cv2.INTER_NEAREST)
    return Image.fromarray(np.asarray(big)).convert("RGB")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--door", default="LD-06")
    ap.add_argument("--count", type=int, default=16)
    ap.add_argument("--out", default="labels.pdf")
    args = ap.parse_args()

    client = login_from_env("DEPOT_LABELS_USER", "dispecer")
    detail = client.get(f"/api/shadow/doors/{args.door}")
    trip = detail["dock"].get("trip")
    parcels = detail["missing"][: args.count]
    if not parcels:
        raise SystemExit(f"no parcels to load at {args.door} now (load a situation with a truck at the door)")
    direction = (trip or {}).get("directionCode") or detail["dock"].get("defaultDirection") or "?"

    font = ImageFont.load_default(size=70)
    small = ImageFont.load_default(size=48)
    cell_w, cell_h = A4[0] // COLS, A4[1] // ROWS
    pages: list[Image.Image] = []
    for i, p in enumerate(parcels):
        if i % (COLS * ROWS) == 0:
            pages.append(Image.new("RGB", A4, "white"))
        page = pages[-1]
        draw = ImageDraw.Draw(page)
        col, row = (i % (COLS * ROWS)) % COLS, (i % (COLS * ROWS)) // COLS
        x0, y0 = col * cell_w, row * cell_h
        draw.rectangle([x0 + 20, y0 + 20, x0 + cell_w - 20, y0 + cell_h - 20], outline="black", width=4)
        page.paste(qr_image(p["barcode"], 520), (x0 + (cell_w - 520) // 2, y0 + 60))
        draw.text((x0 + 70, y0 + 610), p["barcode"], fill="black", font=font)
        draw.text((x0 + 70, y0 + 700), f"Depot 5.0 · {args.door} · smer {direction} · {p['weightKg']} kg", fill="black", font=small)
    pages[0].save(args.out, "PDF", resolution=300, save_all=True, append_images=pages[1:])
    print(f"{args.out}: {len(parcels)} štítkov ({len(pages)} strán), brána {args.door}, smer {direction}")


if __name__ == "__main__":
    main()
