"use client";

import { Component, type ComponentType, type ErrorInfo, type ReactNode } from "react";

/* Editor- and block-level error boundaries (from the Chaos editor). */

interface Props { children: ReactNode; fallback: (error: Error, reset: () => void) => ReactNode; onError?: (error: Error, info: ErrorInfo) => void }
interface State { error: Error | null }

class EditorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }
  reset = () => this.setState({ error: null });
  render() {
    return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}

/** The whole editor: a crash keeps the page (title, save state, recovery) and offers a clean remount. */
export function EditorCrashBoundary({ children, onReopen, onError }: { children: ReactNode; onReopen: () => void; onError?: (error: Error) => void }) {
  return (
    <EditorBoundary
      onError={onError}
      fallback={(error, reset) => (
        <div role="alert" className="my-3 grid gap-2 rounded-lg bg-danger-soft px-4 py-3 text-[13px]">
          <strong>The editor stopped working</strong>
          <p className="text-fg-2">Your last changes are kept on this device. Reopen the editor to continue; nothing has been deleted.</p>
          <div>
            <button type="button" className="h-7 rounded-md bg-overlay px-2.5 text-[13px] font-medium shadow-[0_0_0_1px_var(--line-strong)] hover:bg-surface-2" onClick={() => (reset(), onReopen())}>
              Reopen editor
            </button>
          </div>
          <details className="text-xs text-fg-3">
            <summary>Technical details</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap">{error.message}</pre>
          </details>
        </div>
      )}
    >
      {children}
    </EditorBoundary>
  );
}

/** Wraps a custom block renderer so one failing block shows a notice instead of taking the editor down. */
export function isolatedBlock<P extends object>(Render: ComponentType<P>): ComponentType<P> {
  function IsolatedBlock(props: P) {
    return (
      <EditorBoundary
        fallback={(error, reset) => (
          <div role="alert" contentEditable={false} title={error.message} className="lx-block-crash">
            <span>This block couldn&apos;t be shown. The rest of the page still works, and the block is kept as it was.</span>
            <button type="button" className="rounded px-2 py-0.5 text-[13px] hover:bg-hover" onClick={reset}>
              Try again
            </button>
          </div>
        )}
      >
        <Render {...props} />
      </EditorBoundary>
    );
  }
  IsolatedBlock.displayName = `Isolated(${Render.displayName ?? Render.name ?? "Block"})`;
  return IsolatedBlock;
}
