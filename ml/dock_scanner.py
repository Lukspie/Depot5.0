"""IoT scanner at a loading door, prototype (phase 6, PROMPT §8.2, ADR-060); runs on the host.

    pip install -r ml/requirements-host.txt
    SERVICE_TOKEN=<z .env> python ml/dock_scanner.py --device DOCK-SCN-06 --camera 0 --show
    python ml/dock_scanner.py --device DOCK-SCN-06 video.mp4 --dry-run          # only print

A webcam (or a video) looks at the conveyor/door. Each box that crosses the counting line is one item:
- boxes are found by background subtraction (MOG2) and followed by their centroid (no YOLO training:
  ADR-060), so any parcel-like object moving across the line counts,
- QR codes and barcodes are decoded with OpenCV in every frame and given to the box they lie in,
- at the line the box becomes a scan event {barcode, readOk, itemCounted} and goes to telematics
  POST /devices/{code}/scans: the same API and the same processing as the simulator (loading check,
  wrong direction alarm, read rate, ML predictive maintenance). Heartbeat every 10 s keeps it online.
Put the device into SIM_EXTERNAL_DEVICES (.env) so the simulator stops generating its scans.
"""

import argparse
import json
import os
import threading
import time
import urllib.request
from dataclasses import dataclass, field

import cv2
import numpy as np

TELEMATICS = os.environ.get("TELEMATICS_URL", "http://localhost:8080")


@dataclass
class Track:
    id: int
    cx: float
    cy: float
    box: tuple[int, int, int, int]
    codes: list[str] = field(default_factory=list)
    counted: bool = False
    missed: int = 0
    age: int = 0  # frames seen; a box must be seen a few frames before it counts


class Telematics:
    def __init__(self, device: str, token: str | None, dry: bool) -> None:
        self.device, self.token, self.dry = device, token, dry

    def _post(self, path: str, body: dict[str, object] | None) -> None:
        if self.dry:
            return
        req = urllib.request.Request(
            f"{TELEMATICS}{path}",
            data=json.dumps(body or {}).encode(),
            method="POST",
            headers={"Content-Type": "application/json", "X-Service-Token": self.token or ""},
        )
        with urllib.request.urlopen(req, timeout=10):  # noqa: S310 (local telematics)
            pass

    def scan(self, barcode: str | None) -> None:
        event = {"barcode": barcode, "readOk": barcode is not None, "itemCounted": True}
        self._post(f"/devices/{self.device}/scans", {"events": [event]})

    def heartbeat_forever(self) -> None:
        while True:
            try:
                self._post(f"/devices/{self.device}/heartbeat", None)
            except OSError as exc:
                print(f"heartbeat failed: {exc}")
            time.sleep(10)


def decode(frame: np.ndarray, qr: cv2.QRCodeDetector, bar: object | None) -> list[tuple[str, float, float]]:
    """All codes in the frame with their centre (x, y)."""
    out: list[tuple[str, float, float]] = []
    ok, texts, points, _ = qr.detectAndDecodeMulti(frame)
    if ok:
        for t, p in zip(texts, points, strict=False):
            if t:
                out.append((t, float(p[:, 0].mean()), float(p[:, 1].mean())))
    if bar is not None:
        ok, texts, _types, points = bar.detectAndDecodeWithType(frame)  # type: ignore[attr-defined]
        if ok and points is not None:
            for t, p in zip(texts, points, strict=False):
                if t:
                    out.append((t, float(p[:, 0].mean()), float(p[:, 1].mean())))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", nargs="?")
    ap.add_argument("--camera", type=int)
    ap.add_argument("--device", default="DOCK-SCN-06", help="dock scanner code in db-telemetry")
    ap.add_argument("--line", type=float, default=0.6, help="counting line, share of the frame height")
    ap.add_argument("--min-area", type=float, default=0.01, help="smallest box, share of the frame area")
    ap.add_argument("--dry-run", action="store_true", help="print the events, send nothing")
    ap.add_argument("--show", action="store_true", help="preview window with boxes and the line")
    args = ap.parse_args()
    if args.video is None and args.camera is None:
        ap.error("give a video file or --camera N")
    token = os.environ.get("SERVICE_TOKEN")
    if not args.dry_run and not token:
        raise SystemExit("set SERVICE_TOKEN (from .env) or use --dry-run")

    tm = Telematics(args.device, token, args.dry_run)
    if not args.dry_run:
        threading.Thread(target=tm.heartbeat_forever, daemon=True).start()
    cap = cv2.VideoCapture(args.camera if args.camera is not None else args.video)
    if not cap.isOpened():
        raise SystemExit("cannot open the video")
    bg = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=32, detectShadows=False)
    qr = cv2.QRCodeDetector()
    bar = cv2.barcode.BarcodeDetector() if hasattr(cv2, "barcode") else None
    kernel = np.ones((5, 5), np.uint8)
    # a printed label breaks the foreground of a box into pieces: close them into one blob
    close = np.ones((25, 25), np.uint8)
    tracks: list[Track] = []
    next_id = counted = read = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        h, w = frame.shape[:2]
        line_y = int(h * args.line)
        mask = bg.apply(frame)
        mask = cv2.morphologyEx(cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel), cv2.MORPH_CLOSE, close)
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        boxes = [cv2.boundingRect(c) for c in contours if cv2.contourArea(c) >= args.min_area * w * h]
        # a piece inside a bigger box is the same box
        boxes = [
            b
            for b in boxes
            if not any(o != b and o[0] <= b[0] and o[1] <= b[1] and o[0] + o[2] >= b[0] + b[2] and o[1] + o[3] >= b[1] + b[3] for o in boxes)
        ]
        codes = decode(frame, qr, bar)

        # match boxes to tracks by the nearest centroid
        unmatched = list(range(len(tracks)))
        for x, y, bw, bh in boxes:
            cx, cy = x + bw / 2, y + bh / 2
            best = min(unmatched, key=lambda i: (tracks[i].cx - cx) ** 2 + (tracks[i].cy - cy) ** 2, default=None)
            if best is not None and ((tracks[best].cx - cx) ** 2 + (tracks[best].cy - cy) ** 2) ** 0.5 < max(bw, bh):
                t = tracks[best]
                unmatched.remove(best)
                crossed = not t.counted and t.age >= 3 and (t.cy < line_y <= cy or t.cy > line_y >= cy)
                t.cx, t.cy, t.box, t.missed = cx, cy, (x, y, bw, bh), 0
                t.age += 1
            else:
                t = Track(next_id, cx, cy, (x, y, bw, bh))
                next_id += 1
                tracks.append(t)
                crossed = False
            t.codes += [c for c, px, py in codes if x <= px <= x + bw and y <= py <= y + bh]
            if crossed:
                t.counted = True
                barcode = max(set(t.codes), key=t.codes.count) if t.codes else None
                counted += 1
                read += barcode is not None
                tm.scan(barcode)
                print(f"box {counted:3}: {barcode or 'NEČITATEĽNÝ':16}  čítanosť {read / counted:.0%}")
        for i in sorted(unmatched, reverse=True):
            tracks[i].missed += 1
            if tracks[i].missed > 10:
                tracks.pop(i)

        if args.show:
            cv2.line(frame, (0, line_y), (w, line_y), (0, 146, 243), 2)
            for t in tracks:
                x, y, bw, bh = t.box
                cv2.rectangle(frame, (x, y), (x + bw, y + bh), (0, 200, 0) if t.codes else (0, 0, 255), 2)
            cv2.putText(frame, f"{counted} ks, precitane {read}", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)
            cv2.imshow("Depot 5.0 - skener brany", frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    cap.release()
    if args.show:
        cv2.destroyAllWindows()
    print(f"spolu {counted} krabíc, prečítaných {read}")


if __name__ == "__main__":
    main()
