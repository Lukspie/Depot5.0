#!/usr/bin/env sh
# Phase 6: all models with one command (ADR-057..059). Run from the repository root:
#   sh ml/train_all.sh
# 1. history from the simulator (fixed seed and dates: the same data on every run)
# 2. delay and scanner models, trained in the app image (the same scikit-learn as the inference)
# 3. the pretrained gate detector (checked against its sha256)
set -e
ROOT=$(pwd)
case "$(uname -s)" in MINGW*|MSYS*) ROOT=$(pwd -W); export MSYS_NO_PATHCONV=1 ;; esac
(cd telematics && npm run gen:history -- --out ../ml/data)
docker compose run --rm --no-deps -u root -v "$ROOT/ml:/app/ml" app python ml/train_delay.py
docker compose run --rm --no-deps -u root -v "$ROOT/ml:/app/ml" app python ml/train_scanner.py
python ml/download_gate_models.py
echo "done: rebuild the app image to ship the new artifacts (docker compose build app)"
