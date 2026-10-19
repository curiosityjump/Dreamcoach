/**
 * What a page that fails to render shows instead: a calm page with a way out, never a stack trace. The router
 * shows it in place of the page (inside the shell, so the nav is still there); AppErrorBoundary catches anything
 * outside the router. Both leave by a full page load, so nothing from the broken page carries over.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { Button, EmptyState } from '@/components/ui';
import { IconCompass, IconRefresh } from '@/components/icons';
import { NotFoundPage } from '@/features/shared/NotFoundPage';

export function ErrorPage() {
  return (
    <div className="page page-narrow" data-testid="error-page">
      <EmptyState
        icon={<IconCompass />}
        title="Something went wrong on this page"
        action={
          <div className="row-wrap error-page-actions">
            <Button variant="primary" onClick={() => window.location.reload()} data-testid="error-reload"><IconRefresh /> Reload</Button>
            <a href="/" className="btn btn-secondary" data-testid="error-home">Go home</a>
          </div>
        }
      >
        Sorry about that. Reloading usually sorts it out; if it doesn’t, start again from home.
      </EmptyState>
    </div>
  );
}

/** The router's errorElement. */
export function RouteErrorPage() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;
  return <ErrorPage />;
}

/** Catches a render error outside the router (its providers), where RouteErrorPage can't. */
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Dream Coach could not render', error, info.componentStack);
  }

  render() {
    return this.state.failed ? <ErrorPage /> : this.props.children;
  }
}
