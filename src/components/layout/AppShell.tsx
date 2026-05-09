import { Outlet, useLocation } from 'react-router-dom';
import { Header } from './Header';
import { StageIndicator } from './StageIndicator';
import { ErrorBoundary } from '../shared/ErrorBoundary';

export function AppShell() {
  const location = useLocation();
  const isLanding = location.pathname === '/';

  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      <Header />
      <main className="pt-16 flex-1">
        {!isLanding && (
          <div className="max-w-7xl mx-auto px-6 pt-4">
            <StageIndicator />
          </div>
        )}
        <div className="max-w-7xl mx-auto px-6 pb-12">
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
      <footer className="border-t border-violet-500/10 px-6 py-4 text-center text-xs text-text-muted space-y-1">
        <p>
          Built on{' '}
          <a
            href="https://github.com/jtangen/classbuild"
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-400 hover:underline"
          >
            ClassBuild
          </a>{' '}
          by Jason Tangen — open-source under MIT.
        </p>
        <p>
          Compatible with Canvas LMS — not affiliated with Instructure, Inc. Canvas® is a registered trademark of Instructure, Inc.
        </p>
      </footer>
    </div>
  );
}
