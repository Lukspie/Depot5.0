"""Gate camera: vehicle type and licence plate from one image (phase 6, PROMPT §8.1, ADR-059).

1. YOLOX-Tiny (ONNX, COCO, Apache-2.0) finds cars, buses and trucks.
2. RapidOCR (PaddleOCR models on onnxruntime, Apache-2.0) reads the text in the largest vehicle,
   or in the whole image when no vehicle is found (a close-up of the plate).
3. A Slovak plate (two letters, three digits, two letters, e.g. KE-102LH) is picked from the text;
   typical OCR confusions (O/0, I/1, B/8, S/5, Z/2) are fixed by position.
No torch in the image: both models run on onnxruntime (CPU).
"""

import itertools
import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from io import BytesIO
from typing import Any

import numpy as np
from PIL import Image

from depotrack.ml.delay import artifacts_dir

log = logging.getLogger(__name__)

DETECTOR = "yolox_tiny.onnx"
INPUT = 416
STRIDES = (8, 16, 32)
# COCO class id -> gate vehicle type (the same words the simulator uses: truck, car, bus)
VEHICLES = {2: "car", 3: "car", 5: "bus", 7: "truck"}
MIN_SCORE = 0.35
NMS_IOU = 0.45
PLATE = re.compile(r"([A-Z]{2})([0-9]{3})([A-Z]{2})")
TO_LETTER = {"0": "O", "1": "I", "2": "Z", "5": "S", "8": "B", "6": "G"}
TO_DIGIT = {
    "O": "0",
    "D": "0",
    "Q": "0",
    "I": "1",
    "L": "1",
    "Z": "2",
    "S": "5",
    "B": "8",
    "G": "6",
}


@dataclass(frozen=True)
class Vehicle:
    type: str
    confidence: float
    box: tuple[int, int, int, int]  # x1, y1, x2, y2 in image pixels


@dataclass(frozen=True)
class GateReading:
    vehicles: list[Vehicle]
    plate: str | None  # "KE-102LH"
    plate_confidence: float | None
    text: str  # everything OCR read, for the operator


def normalize_plate(text: str) -> str | None:
    """A Slovak plate from OCR text ("KE 102LH", "KE-1O2LH", "SK KE102LH" …) or None."""
    s = re.sub(r"[^A-Z0-9]", "", text.upper())
    for start in range(len(s) - 6):
        chunk = s[start : start + 7]
        # OCR confusions are occasional: the digits must be mostly real, at most 2 fixes in all
        if sum(c.isdigit() for c in chunk[2:5]) < 2:
            continue
        fixed = (
            "".join(TO_LETTER.get(c, c) for c in chunk[:2])
            + "".join(TO_DIGIT.get(c, c) for c in chunk[2:5])
            + "".join(TO_LETTER.get(c, c) for c in chunk[5:])
        )
        m = PLATE.fullmatch(fixed)
        if m and sum(x != y for x, y in zip(chunk, fixed, strict=True)) <= 2:
            return f"{m.group(1)}-{m.group(2)}{m.group(3)}"
    return None


def decode_image(data: bytes) -> np.ndarray[Any, np.dtype[np.uint8]]:
    """JPEG/PNG bytes -> BGR array (what both models expect); ValueError on garbage."""
    try:
        img = Image.open(BytesIO(data))
        img.load()
    except Exception as exc:
        raise ValueError("not an image") from exc
    rgb = np.asarray(img.convert("RGB"), dtype=np.uint8)
    return np.ascontiguousarray(rgb[:, :, ::-1])


def _nms(boxes: np.ndarray[Any, Any], scores: np.ndarray[Any, Any]) -> list[int]:
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size:
        i = int(order[0])
        keep.append(i)
        xx1 = np.maximum(boxes[i, 0], boxes[order[1:], 0])
        yy1 = np.maximum(boxes[i, 1], boxes[order[1:], 1])
        xx2 = np.minimum(boxes[i, 2], boxes[order[1:], 2])
        yy2 = np.minimum(boxes[i, 3], boxes[order[1:], 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        area = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
        iou = inter / (area[i] + area[order[1:]] - inter + 1e-9)
        order = order[1:][iou <= NMS_IOU]
    return keep


class GateModels:
    def __init__(self, detector: Any, ocr: Any) -> None:
        self.detector = detector
        self.ocr = ocr
        grids, strides = [], []
        for s in STRIDES:
            n = INPUT // s
            xv, yv = np.meshgrid(np.arange(n), np.arange(n))
            grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
            strides.append(np.full((n * n, 1), s))
        self.grid = np.concatenate(grids).astype(np.float32)
        self.stride = np.concatenate(strides).astype(np.float32)

    def detect(self, bgr: np.ndarray[Any, np.dtype[np.uint8]]) -> list[Vehicle]:
        h, w = bgr.shape[:2]
        ratio = min(INPUT / h, INPUT / w)
        nh, nw = int(h * ratio), int(w * ratio)
        resized = np.asarray(Image.fromarray(bgr).resize((nw, nh), Image.Resampling.BILINEAR))
        padded = np.full((INPUT, INPUT, 3), 114, dtype=np.float32)
        padded[:nh, :nw] = resized
        blob = padded.transpose(2, 0, 1)[None]
        out = self.detector.run(None, {self.detector.get_inputs()[0].name: blob})[0][0]
        xy = (out[:, :2] + self.grid) * self.stride
        wh = np.exp(out[:, 2:4]) * self.stride
        cls = out[:, 5:].argmax(1)
        score = out[:, 4] * out[np.arange(len(out)), 5 + cls]
        mask = (score >= MIN_SCORE) & np.isin(cls, list(VEHICLES))
        if not mask.any():
            return []
        boxes = np.concatenate([xy - wh / 2, xy + wh / 2], 1)[mask] / ratio
        boxes = np.clip(boxes, 0, [w, h, w, h])
        kept = _nms(boxes, score[mask])
        return [
            Vehicle(
                VEHICLES[int(cls[mask][i])],
                round(float(score[mask][i]), 3),
                (int(boxes[i, 0]), int(boxes[i, 1]), int(boxes[i, 2]), int(boxes[i, 3])),
            )
            for i in kept
        ]

    def read(self, bgr: np.ndarray[Any, np.dtype[np.uint8]]) -> GateReading:
        vehicles = self.detect(bgr)
        crop = bgr
        if vehicles:
            x1, y1, x2, y2 = max(
                vehicles, key=lambda v: (v.box[2] - v.box[0]) * (v.box[3] - v.box[1])
            ).box
            if x2 - x1 > 20 and y2 - y1 > 20:
                crop = bgr[y1:y2, x1:x2]
        result, _ = self.ocr(crop)
        texts = [(str(t), float(c)) for _box, t, c in (result or [])]
        plate, conf = None, None
        # a plate is usually one OCR line; else try neighbouring lines joined
        candidates = [
            *texts,
            *[(a[0] + b[0], min(a[1], b[1])) for a, b in itertools.pairwise(texts)],
        ]
        for text, c in candidates:
            p = normalize_plate(text)
            if p:
                plate, conf = p, round(c, 3)
                break
        return GateReading(vehicles, plate, conf, " ".join(t for t, _ in texts))


def load_gate_models() -> GateModels | None:
    file = artifacts_dir() / DETECTOR
    if not file.exists():
        log.warning("gate detector %s not found (python ml/download_gate_models.py)", file)
        return None
    try:
        import onnxruntime
        from rapidocr_onnxruntime import RapidOCR

        detector = onnxruntime.InferenceSession(str(file), providers=["CPUExecutionProvider"])
        return GateModels(detector, RapidOCR())
    except Exception:
        log.exception("cannot load the gate models")
        return None


@lru_cache
def gate_models() -> GateModels | None:
    return load_gate_models()
