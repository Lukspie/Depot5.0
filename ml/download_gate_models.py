"""Download the pretrained vehicle detector for the gate (phase 6, PROMPT §8.1, ADR-059).

    python ml/download_gate_models.py

YOLOX-Tiny (Megvii, Apache-2.0), exported to ONNX by its authors, COCO classes (car, bus, truck,
motorcycle). It goes to ml/artifacts/yolox_tiny.onnx and into the app image. The plate OCR models
(PaddleOCR via RapidOCR, Apache-2.0) ship inside the `rapidocr-onnxruntime` package.
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

URL = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx"
OUT = Path(__file__).resolve().parent / "artifacts" / "yolox_tiny.onnx"


def main() -> None:
    if OUT.exists():
        print(f"{OUT.name} already there ({OUT.stat().st_size // 1024} kB)")
        return
    OUT.parent.mkdir(exist_ok=True)
    print(f"downloading {URL}")
    with urllib.request.urlopen(URL, timeout=120) as resp:  # noqa: S310 (fixed https URL)
        data = resp.read()
    if len(data) < 1_000_000:
        sys.exit("download too small, check the URL")
    OUT.write_bytes(data)
    print(f"{OUT} {len(data) // 1024} kB sha256 {hashlib.sha256(data).hexdigest()}")


if __name__ == "__main__":
    main()
