import { ExternalLink, Search } from "lucide-react";
import { useState } from "react";
import { useNotifications, type Notification } from "../../api/delivery";
import { Card, DataTable, type Column } from "../ui";
import { hhmm } from "../../domain/labels";

/** Simulated SMS to customers (ADR-010): the full message with the tracking link, admin only. */
export function NotificationsTab() {
  const [q, setQ] = useState("");
  const notes = useNotifications(q.trim().length >= 3 ? q.trim() : "");

  const columns: Column<Notification>[] = [
    {
      key: "at",
      header: "Odoslané",
      width: "6rem",
      render: (n) => <span className="tabular-nums">{hhmm(n.createdAt)}</span>,
    },
    {
      key: "barcode",
      header: "Balík",
      width: "11rem",
      render: (n) => <span className="font-mono text-xs">{n.barcode}</span>,
    },
    {
      key: "recipient",
      header: "Príjemca",
      width: "14rem",
      hideBelow: "md",
      title: (n) => n.recipient,
      render: (n) => n.recipient,
    },
    {
      key: "message",
      header: "Text SMS",
      minWidth: "14rem",
      title: (n) => n.message,
      render: (n) => <span className="text-ink-muted">{n.message}</span>,
    },
    {
      key: "link",
      header: "",
      width: "7.5rem",
      align: "right",
      control: true,
      render: (n) => (
        <a
          href={n.link}
          target="_blank"
          rel="noreferrer"
          className="text-brand-700 inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Otvoriť <ExternalLink size={14} />
        </a>
      ),
    },
  ];

  return (
    <Card
      flush
      title="Simulované SMS zákazníkom"
      subtitle="Odkaz /track/… sa pošle, keď kuriér naskenuje balík do dodávky. Nič sa reálne neodosiela."
      actions={
        <label className="border-line bg-surface flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm">
          <Search size={15} className="text-ink-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Balík alebo príjemca"
            className="w-44 bg-transparent outline-none"
            aria-label="Hľadať notifikáciu"
          />
        </label>
      }
    >
      <DataTable
        columns={columns}
        rows={notes.data}
        loading={notes.isPending}
        rowKey={(n) => n.id}
        empty="Zatiaľ žiadne SMS – pošlú sa ráno pri nakládke kuriérov (od 7:00)."
      />
    </Card>
  );
}
