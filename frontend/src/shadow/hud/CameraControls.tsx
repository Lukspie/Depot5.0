import { House, Layers, Minus, Plus, RotateCcw, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../components/ui";
import type { CameraApi } from "../CameraRig";

function Btn({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Button variant="ghost" size="sm" aria-label={label} title={label} onClick={onClick} className="text-ink h-9 w-9 !p-0">
      {children}
    </Button>
  );
}

/** Vertical camera column on the right (reference): zoom, rotate around the hall, home view. */
export function CameraControls({ api, roofOpen, onRoof }: { api: () => CameraApi | null; roofOpen: boolean; onRoof: () => void }) {
  const run = (fn: (a: CameraApi) => void) => () => {
    const a = api();
    if (a) fn(a);
  };
  return (
    <div className="bg-surface shadow-card flex flex-col gap-0.5 rounded-2xl p-1">
      <Btn label="Priblížiť" onClick={run((a) => a.zoom(1.25))}>
        <Plus size={17} />
      </Btn>
      <Btn label="Oddialiť" onClick={run((a) => a.zoom(0.8))}>
        <Minus size={17} />
      </Btn>
      <Btn label="Otočiť doľava" onClick={run((a) => a.rotate(Math.PI / 8))}>
        <RotateCcw size={16} />
      </Btn>
      <Btn label="Otočiť doprava" onClick={run((a) => a.rotate(-Math.PI / 8))}>
        <RotateCw size={16} />
      </Btn>
      <Btn label="Celý sklad" onClick={run((a) => a.home())}>
        <House size={16} />
      </Btn>
      <Btn label={roofOpen ? "Zakryť strechu" : "Odkryť strechu (pás vnútri)"} onClick={onRoof}>
        <Layers size={16} className={roofOpen ? "text-brand-600" : ""} />
      </Btn>
    </div>
  );
}
