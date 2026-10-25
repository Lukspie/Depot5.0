import { Link } from "react-router";

export function ForbiddenPage() {
  return (
    <div className="bg-surface shadow-card rounded-card mx-auto mt-16 max-w-md p-8 text-center">
      <div className="bg-warn-100 text-warn-600 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full text-xl">
        !
      </div>
      <h1 className="text-xl font-semibold">Nemáte oprávnenie</h1>
      <p className="text-ink-muted mt-2 text-sm">
        Táto obrazovka nie je dostupná pre vašu rolu. Ak ju potrebujete, obráťte sa na
        administrátora.
      </p>
      <Link
        to="/"
        className="bg-brand-500 hover:bg-brand-600 mt-6 inline-block rounded-xl px-4 py-2 text-sm text-on-brand"
      >
        Na úvod
      </Link>
    </div>
  );
}
