import { Component, Suspense, type ReactNode } from "react";

/** Shows `fallback` (the primitive part) while a model loads and if it cannot be loaded. */
class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** A GLTF-based part with its primitive fallback (loading or a missing file never breaks the scene). */
export function WithModel({ fallback, children }: { fallback: ReactNode; children: ReactNode }) {
  return (
    <ModelBoundary fallback={fallback}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </ModelBoundary>
  );
}
