// Copyright 2026 Kisaes LLC
// Licensed under the PolyForm Internal Use License 1.0.0.
// You may not distribute this software. See LICENSE for terms.
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary. Catches render-phase exceptions anywhere in
 * the app subtree and renders a recovery screen instead of unmounting
 * the whole React root.
 *
 * Lifecycle hooks are still class-based — there's no functional API for
 * `componentDidCatch` / `getDerivedStateFromError` as of React 18.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to console so the error survives to operator devtools. Pino
    // is server-side only; the frontend has no log shipping pipeline.
    // eslint-disable-next-line no-console
    console.error('[vibept] render crashed:', error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;

    const message = this.state.error.message || 'Something went wrong.';

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-md rounded-lg border border-rose-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600">
            The app hit an unexpected error and stopped rendering. Refreshing usually fixes it. If
            it keeps happening, share the message below with your administrator.
          </p>
          <pre className="mt-4 max-h-48 overflow-auto rounded bg-slate-100 p-3 text-xs text-slate-700">
            {message}
          </pre>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex h-10 items-center rounded-md bg-slate-900 px-4 text-sm font-medium text-white hover:bg-slate-800"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.reset}
              className="inline-flex h-10 items-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
