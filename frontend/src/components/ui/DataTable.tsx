import { Fragment, useEffect, useState, type ReactNode } from "react";
import { EmptyState } from "./EmptyState";
import { Spinner } from "./Spinner";
import { cn } from "./tone";

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

/** A group of rows with a heading row, e.g. "Večerné diaľkové odchody · 3 odišli". */
export interface RowGroup<T> {
  key: string;
  title: ReactNode;
  /** grey text after the title */
  sub?: ReactNode;
  /** CSS colour of the dot before the title */
  dot?: string;
  rows: T[];
}

interface Props<T> {
  columns: Column<T>[];
  /** flat rows; ignored when `groups` are given */
  rows?: T[] | undefined;
  groups?: RowGroup<T>[] | undefined;
  rowKey: (row: T) => string | number;
  onRowClick?: (row: T) => void;
  /** last narrow column with row actions (e.g. a "⋮" menu) */
  actions?: (row: T) => ReactNode;
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

const rem = (v: string | undefined, fallback: number): number => (v?.endsWith("rem") ? Number.parseFloat(v) : fallback);

/**
 * Table of design system v2: 34 px header in small capitals, 52 px rows (40 px compact), optional
 * row groups and an actions column. Cells stay on one line and are cut with an ellipsis (full
 * value in the tooltip). The table never gets narrower than its columns need: on small screens
 * it scrolls inside its card and less important columns (hideBelow) disappear.
 */
export function DataTable<T>({
  columns,
  rows,
  groups,
  rowKey,
  onRowClick,
  actions,
  loading = false,
  error,
  empty,
  selectedKey = null,
  compact = false,
}: Props<T>) {
  const viewport = useViewportWidth();
  const visible = columns.filter((c) => !c.hideBelow || viewport >= BREAKPOINT_PX[c.hideBelow]);
  const minWidth = visible.reduce((sum, c) => sum + (c.width ? rem(c.width, 8) : rem(c.minWidth, 10)), actions ? 2.5 : 0);
  const all = groups ? groups.flatMap((g) => g.rows) : rows;

  if (error) return <div className="p-4">{error}</div>;
  if (loading && !all) return <Spinner label="Načítavam…" className="py-10" />;
  if (!all || all.length === 0) {
    return <div className="py-6">{empty ?? <EmptyState title="Žiadne záznamy" />}</div>;
  }
  const pad = compact ? "px-3" : "px-3.5";
  const span = visible.length + (actions ? 1 : 0);
  const renderRow = (row: T) => {
    const key = rowKey(row);
    return (
      <tr
        key={key}
        onClick={onRowClick ? () => onRowClick(row) : undefined}
        className={cn(
          "border-t border-[#f1f0ec] text-[13px] transition-colors",
          compact ? "h-10" : "h-[52px]",
          onRowClick && "hover:bg-subtle cursor-pointer",
          key === selectedKey && "bg-brand-50",
        )}
      >
        {visible.map((c) => (
          <td key={c.key} title={c.title?.(row)} className={cn("align-middle", pad, ALIGN[c.align ?? "left"], c.control ? "whitespace-nowrap" : "truncate")}>
            {c.render(row)}
          </td>
        ))}
        {actions && (
          <td className="pr-2 text-right align-middle whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
            {actions(row)}
          </td>
        )}
      </tr>
    );
  };
  return (
    // relative: the sr-only labels (absolute) stay inside the scrolling box, not the page
    <div className="relative overflow-x-auto">
      <table className="w-full table-fixed border-collapse" style={{ minWidth: `${String(minWidth)}rem` }}>
        <colgroup>
          {visible.map((c) => (
            <col key={c.key} style={c.width ? { width: c.width } : undefined} />
          ))}
          {actions && <col style={{ width: "2.5rem" }} />}
        </colgroup>
        <thead>
          <tr className="bg-subtle text-ink-muted h-[34px] text-[11px] tracking-[0.05em] uppercase">
            {visible.map((c) => (
              <th key={c.key} scope="col" className={cn("truncate font-bold", pad, ALIGN[c.align ?? "left"])}>
                {c.header}
              </th>
            ))}
            {actions && (
              <th scope="col">
                <span className="sr-only">Akcie</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {groups
            ? groups.map((g) => (
                <Fragment key={g.key}>
                  <tr className="bg-[#fcfcfb]">
                    <th colSpan={span} scope="colgroup" className="border-line-soft h-8 border-t px-4 text-left text-xs font-bold text-neutral-700">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: g.dot ?? "var(--color-neutral-600)" }} />
                        {g.title}
                        {g.sub !== undefined && <span className="text-ink-faint font-semibold">{g.sub}</span>}
                      </span>
                    </th>
                  </tr>
                  {g.rows.map(renderRow)}
                </Fragment>
              ))
            : all.map(renderRow)}
        </tbody>
      </table>
    </div>
  );
}
