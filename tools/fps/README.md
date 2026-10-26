# Meranie fps digitálneho tieňa

Skript otvorí `/shadow?depot=BUD&fps=1` (alebo `fps=stress`) v Chromiu cez Playwright, 5 s sa zahrieva
a potom 20 s zbiera počet vykreslených snímok za sekundu (`window.__shadowFps`, `FpsProbe`).

```bash
cd tools/fps
npm init -y >/dev/null && npm i --no-save playwright@1.58   # jednorazovo, mimo závislostí projektu
npx playwright install chromium                              # ak ešte nie je
node fps.mjs dispecer <heslo>                                # živé dáta
MODE=stress node fps.mjs dispecer <heslo>                    # plný pás (~300 balíkov)
node fps.mjs dispecer <heslo> --headed                       # s oknom prehliadača
```

Výstup je JSON s GPU, vzorkami, priemerom a minimom. Cieľ: 60 fps pri 1440 × 900 počas večernej vlny.
Bez skriptu: otvor `/shadow?depot=BUD&fps=stress` a pozri štítok vľavo hore v scéne.
