# Licencie modelov a testovacích dát (Fáza 6)

| Súbor | Pôvod | Licencia |
| --- | --- | --- |
| `delay_model.joblib`, `scanner_model.joblib` | natrénované v tomto repozitári na simulovanej histórii (`ml/train_*.py`) | ako projekt |
| `yolox_tiny.onnx` | YOLOX (Megvii-BaseDetection), release 0.1.1rc0, https://github.com/Megvii-BaseDetection/YOLOX, sha256 `427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7` | Apache-2.0 |
| OCR modely (v balíku `rapidocr-onnxruntime`, nie v repozitári) | RapidOCR, https://github.com/RapidAI/RapidOCR, modely PaddleOCR (PP-OCR) | Apache-2.0 |
| `app/tests/data/gate_truck_cc0.jpg` | „Semi-trailer truck Severgazprom“, Georg Pik, Wikimedia Commons, zmenšené na 960 px | CC0 1.0 |

Ultralytics YOLO (v8 a novšie) je AGPL-3.0, preto ho projekt nepoužíva (ADR-059).
