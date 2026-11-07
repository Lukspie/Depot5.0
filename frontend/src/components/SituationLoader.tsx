import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { useMe } from "../api/auth";
import { loadSituation } from "../api/telematicsApi";

type State = { kind: "loading"; id: string } | { kind: "loaded"; text: string } | { kind: "error"; text: string } | null;

/**
 * `?situation=evening-peak` on any page (ADR-054): the admin loads the situation (clean reset +
 * replay to its time), the parameter is removed from the URL. Scripts for screenshots and the demo
 * wait for `[data-situation="loaded"]` (they accept the confirm dialog). Other roles only get a notice,
 * the backend would refuse anyway.
 */
export function SituationLoader() {
  const [params, setParams] = useSearchParams();
  const me = useMe();
  const qc = useQueryClient();
  const [state, setState] = useState<State>(null);
  const started = useRef<string | null>(null);
  const id = params.get("situation");

  useEffect(() => {
    if (!id || !me.data || started.current === id) return;
    started.current = id;
    const drop = () =>
      setParams(
        (p) => {
          p.delete("situation");
          return p;
        },
        { replace: true },
      );
    const admin = me.data.role === "admin";
    const run = async (): Promise<void> => {
      await Promise.resolve(); // state changes after the effect, not inside it
      if (!admin) {
        setState({ kind: "error", text: "Situáciu môže načítať len administrátor." });
        return;
      }
      // a link alone must not reset the day: the admin confirms it (as in the admin tab)
      if (!window.confirm(`Načítať situáciu „${id}“? Aktuálny deň sa vráti do čistého stavu a pretočí do jej času.`)) {
        setState({ kind: "error", text: "Načítanie situácie zrušené." });
        return;
      }
      setState({ kind: "loading", id });
      try {
        const c = await loadSituation(id);
        setState({ kind: "loaded", text: `Situácia načítaná: ${c.situation ?? id}, ${c.localTime}` });
        void qc.invalidateQueries();
      } catch {
        setState({ kind: "error", text: `Situáciu „${id}“ sa nepodarilo načítať.` });
      }
    };
    void run().finally(drop);
  }, [id, me.data, qc, setParams]);

  useEffect(() => {
    if (state?.kind !== "loaded" && state?.kind !== "error") return;
    const t = setTimeout(() => setState(null), 5000);
    return () => clearTimeout(t);
  }, [state]);

  if (!state) return null;
  const tone = state.kind === "error" ? "bg-danger-100 text-danger-600" : state.kind === "loaded" ? "bg-ok-100 text-ok-600" : "bg-brand-100 text-brand-700";
  return (
    <div
      role="status"
      data-situation={state.kind}
      className={`shadow-card fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium ${tone}`}
    >
      {state.kind === "loading" ? `Načítavam situáciu „${state.id}“… (pretáčam deň s dátami)` : state.text}
    </div>
  );
}
