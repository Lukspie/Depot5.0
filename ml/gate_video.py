"""Gate camera from a video file or a webcam (phase 6, PROMPT §8.1, ADR-059), runs on the host.

    pip install -r ml/requirements-host.txt
    DEPOT_PASSWORD=<heslo ochranky> python ml/gate_video.py video.mp4      # or: --camera 0

Every `--every` seconds a frame goes to POST /api/gate/detect (only read). When a plate (or, without
a plate, a vehicle) appears that was not seen in the last `--quiet` seconds, the frame is sent again
with record=true: a passage in telematics (yard of the digital shadow) and, for an unknown plate,
an alert. The models run in the app (YOLOX + OCR on onnxruntime), the script only cuts frames.
"""

import argparse
import time

import cv2

from depot_client import login_from_env


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", nargs="?", help="video file (mp4, avi …)")
    ap.add_argument("--camera", type=int, help="webcam index instead of a file")
    ap.add_argument("--direction", choices=["in", "out"], default="in")
    ap.add_argument("--every", type=float, default=1.0, help="seconds of video between two checks")
    ap.add_argument("--quiet", type=float, default=60.0, help="the same plate is recorded once per this many seconds")
    args = ap.parse_args()
    if args.video is None and args.camera is None:
        ap.error("give a video file or --camera N")

    client = login_from_env("DEPOT_GATE_USER", "ochranka")
    cap = cv2.VideoCapture(args.camera if args.camera is not None else args.video)
    if not cap.isOpened():
        raise SystemExit("cannot open the video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    step = max(1, int(fps * args.every))
    seen: dict[str, float] = {}
    frame_no = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame_no += 1
        if frame_no % step:
            continue
        ok, jpeg = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        if not ok:
            continue
        r = client.post_image("/api/gate/detect?record=false", jpeg.tobytes())
        key = r["plate"] or (r["vehicleType"] and f"<{r['vehicleType']}>")
        now = time.monotonic()
        if not key or now - seen.get(key, -1e9) < args.quiet:
            continue
        seen[key] = now
        rec = client.post_image(f"/api/gate/detect?record=true&direction={args.direction}", jpeg.tobytes())
        status = "vozidlo flotily" if rec["expected"] else "NEZNÁME"
        print(f"{frame_no / fps:7.1f} s  {rec['vehicleType'] or '?':6}  {rec['plate'] or '—':9}  {status}")
    cap.release()


if __name__ == "__main__":
    main()
