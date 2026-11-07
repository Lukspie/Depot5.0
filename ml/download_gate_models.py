"""Download the pretrained models of the gate camera (phase 6, PROMPT §8.1, ADR-059).

    python ml/download_gate_models.py

- YOLOX-Tiny (Megvii, Apache-2.0), ONNX export of its authors: finds cars, buses and trucks (COCO).
- MobileNetV2 (ONNX Model Zoo, Apache-2.0) + the ImageNet class names: tells a van from a lorry in
  the crop of a vehicle, because COCO puts vans, pickups and lorries all into one class "truck".
The files go to ml/artifacts/ and into the app image; each one is checked against its sha256
(LICENSES.md). The plate OCR models (PaddleOCR via RapidOCR, Apache-2.0) ship inside the
`rapidocr-onnxruntime` package.
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

ARTIFACTS = Path(__file__).resolve().parent / "artifacts"
FILES = [
    (
        "yolox_tiny.onnx",
        "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx",
        "427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7",
    ),
    (
        "mobilenetv2-12.onnx",
        "https://github.com/onnx/models/raw/main/validated/vision/classification/mobilenet/model/mobilenetv2-12.onnx",
        "c0c3f76d93fa3fd6580652a45618618a220fced18babf65774ed169de0432ad5",
    ),
    (
        "imagenet_classes.txt",
        "https://raw.githubusercontent.com/pytorch/hub/master/imagenet_classes.txt",
        "1f386e0d1cb6e28b9c2dac651c3dea6801e98ad1b41a14ce6bb1a093d72069f5",
    ),
]


def fetch(name: str, url: str, sha256: str) -> None:
    out = ARTIFACTS / name
    if out.exists():
        ok = hashlib.sha256(out.read_bytes()).hexdigest() == sha256
        print(f"{name} already there ({out.stat().st_size // 1024} kB, sha256 {'ok' if ok else 'MISMATCH'})")
        if not ok:
            sys.exit(1)
        return
    print(f"downloading {url}")
    with urllib.request.urlopen(url, timeout=120) as resp:  # noqa: S310 (fixed https URL)
        data = resp.read()
    if hashlib.sha256(data).hexdigest() != sha256:
        sys.exit(f"sha256 of {name} does not match LICENSES.md, not saved")
    out.write_bytes(data)
    print(f"{out} {len(data) // 1024} kB")


def main() -> None:
    ARTIFACTS.mkdir(exist_ok=True)
    for name, url, sha256 in FILES:
        fetch(name, url, sha256)


if __name__ == "__main__":
    main()
