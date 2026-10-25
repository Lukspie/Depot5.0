import { useEffect, useState, type ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { Spinner } from "./Spinner";

type Breakpoint = "sm" | "md" | "lg";
const BREAKPOINT_PX: Record<Breakpoint, number> = { sm: 640, md: 768, lg: 1024 };

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** fixed width in rem (e.g. "8rem"); columns without width share the remaining space */
  width?: string;
  /** minimum width of a flexible column (default 10rem) */
  minWidth?: string;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
  /** native tooltip, useful when the cell is cut with an ellipsis */
  title?: (row: T) => string;
  /** cell content is a control (button…): no ellipsis clipping */
  control?: boolean;
  /** hide the column on screens narrower than this breakpoint */
  hideBelow?: Breakpoint;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  error?: ReactNode;
  empty?: ReactNode;
  selectedKey?: string | number | null;
  /** smaller rows (dense live lists) */
  compact?: boolean;
}

const ALIGN = { left: "text-left", right: "text-right", center: "text-center" };

function useViewportWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

const rem = (v: string | undefined, fallback: number): number =>
  v?.endsWith("rem") ? Number.parseFloat(v) : fallback;

/**
 * Table with fixed column widths. Cells stay on one line and are cut with an ellipsis (full
 * value in the tooltip), so long names never break the layout. The table never gets narrower
 * than its columns need: on small screens it scrolls inside its card and less important
 * columns (hideBelow) disappear.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  loading = false,
  error,
  empty,
  selectedKey = null,
  compact = false,
}: Props<T>) {
  const viewport = useViewportWidth();
  const visible = columns.filter((c) => !c.hideBelow || viewport >= BREAKPOINT_PX[c.hideBelow]);
  const minWidth = visible.reduce((sum, c) => sum + (c.width ? rem(c.width, 8) : rem(c.minWidth, 10)), 0);

  if (error) return <div className="p-4">{error}</div>;
  if (loading && !rows) return <Spinner label="Načítavam…" className="py-10" />;
  if (!rows || rows.length === 0) {
    return <div className="py-6">{empty ?? <EmptyState title="Žiadne záznamy" />}</div>;
  }
  const pad = compact ? "px-3 py-2" : "px-4 py-3";
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-sm" style={{ minWidth: `${String(minWidth)}rem` }}>
        <colgroup>
          {visible.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-ink-muted text-xs tracking-wide uppercase">
            {visible.map((c) => (
              <th key={c.key} className={`truncate font-medium ${pad} ${ALIGN[c.align ?? "left"]}`}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`border-line border-t transition-colors ${onRowClick ? "hover:bg-canvas/70 cursor-pointer" : ""} ${key === selectedKey ? "bg-brand-50" : ""}`}
              >
                {visible.map((c) => (
                  <td
                    key={c.key}
                    title={c.title?.(row)}
                    className={`align-middle ${pad} ${ALIGN[c.align ?? "left"]} ${c.control ? "whitespace-nowrap" : "truncate"}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
