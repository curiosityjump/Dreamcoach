import { createBrowserRouter, RouterProvider, type RouteObject } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiRequestError } from '@/api/client';
import { AuthProvider } from '@/auth/AuthContext';
import { ToastProvider } from '@/components/toast';
import { BareShell, DreamerShell, RoleRedirect, StaffShell } from '@/app/Shell';
import { AppErrorBoundary, RouteErrorPage } from '@/app/ErrorPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { HomePage } from '@/features/dreamer/HomePage';
import { DreamsPage } from '@/features/dreamer/DreamsPage';
import { DreamDetailPage } from '@/features/dreamer/DreamDetailPage';
import { ActionsPage } from '@/features/dreamer/ActionsPage';
import { CarePage } from '@/features/dreamer/CarePage';
import { CategoryHistoryPage } from '@/features/dreamer/CategoryHistoryPage';
import { JournalPage } from '@/features/dreamer/JournalPage';
import { CheckInPage } from '@/features/dreamer/CheckInPage';
import { MySessionsPage } from '@/features/dreamer/MySessionsPage';
import { CoachDashboardPage } from '@/features/coach/CoachDashboardPage';
import { StaffDreamerPage } from '@/features/coach/StaffDreamerPage';
import { SessionWorkspacePage } from '@/features/coach/SessionWorkspacePage';
import { PresentPage } from '@/features/coach/PresentPage';
import { DirectorOverviewPage } from '@/features/director/DirectorOverviewPage';
import { DirectorDreamersPage } from '@/features/director/DirectorDreamersPage';
import { DirectorCoachPage } from '@/features/director/DirectorCoachPage';
import { NotFoundPage } from '@/features/shared/NotFoundPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, refetchOnWindowFocus: true, retry: (count, err) => !(err instanceof ApiRequestError && [400, 401, 403, 404].includes(err.status)) && count < 2 },
  },
});

// A page that fails to render shows RouteErrorPage in its place; inside a shell the nav stays, to go elsewhere.
const pages = (children: RouteObject[]): RouteObject[] => [{ errorElement: <RouteErrorPage />, children }];

const router = createBrowserRouter([
  {
    errorElement: <RouteErrorPage />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/', element: <RoleRedirect /> },
      {
        element: <DreamerShell />,
        children: pages([
          { path: '/home', element: <HomePage /> },
          { path: '/dreams', element: <DreamsPage /> },
          { path: '/dreams/:dreamId', element: <DreamDetailPage /> },
          { path: '/actions', element: <ActionsPage /> },
          { path: '/care', element: <CarePage /> },
          { path: '/care/:category', element: <CategoryHistoryPage /> },
          { path: '/journal', element: <JournalPage /> },
          { path: '/check-in', element: <CheckInPage /> },
          { path: '/sessions', element: <MySessionsPage /> },
          { path: '/sessions/:sessionId', element: <MySessionsPage /> },
        ]),
      },
      {
        element: <StaffShell />,
        children: pages([
          { path: '/coach', element: <CoachDashboardPage /> },
          { path: '/dreamers/:dreamerId', element: <StaffDreamerPage /> },
          { path: '/dreamers/:dreamerId/:tab', element: <StaffDreamerPage /> },
          { path: '/dreamers/:dreamerId/session/:sessionId', element: <SessionWorkspacePage /> },
          { path: '/director', element: <DirectorOverviewPage /> },
          { path: '/director/dreamers', element: <DirectorDreamersPage /> },
          { path: '/director/coaches/:coachId', element: <DirectorCoachPage /> },
        ]),
      },
      {
        element: <BareShell />,
        children: pages([{ path: '/dreamers/:dreamerId/session/:sessionId/present', element: <PresentPage /> }]),
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export default function App() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
