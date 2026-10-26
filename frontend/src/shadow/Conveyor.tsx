import { useEffect, useMemo } from "react";
import type { DepotLayout } from "./layout";
import { conveyor, disposeTree } from "./parts";

/** Main sorting belt and the branches to the loading doors (static). */
export function Conveyor({ layout }: { layout: DepotLayout }) {
  const object = useMemo(() => conveyor(layout), [layout]);
  useEffect(() => () => disposeTree(object), [object]);
  return <primitive object={object} />;
}
