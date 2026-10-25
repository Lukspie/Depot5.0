import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  title: string;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title, description, icon, action }: Props) {
  return (
    <div className="flex flex-col items-center px-4 py-6 text-center">
      <div className="bg-neutral-100 text-ink-muted mb-3 flex h-11 w-11 items-center justify-center rounded-full">
        {icon ?? <Inbox size={20} />}
      </div>
      <div className="font-medium">{title}</div>
      {description !== undefined && <p className="text-ink-muted mt-1 max-w-sm text-sm">{description}</p>}
      {action !== undefined && <div className="mt-4">{action}</div>}
    </div>
  );
}
