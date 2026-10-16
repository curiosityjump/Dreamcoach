import { NavLink, Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '@/auth/AuthContext';
import { Avatar, Dropdown, LoadingPage } from '@/components/ui';
import { IconBrand, IconHome, IconList, IconLogout, IconPen, IconStar, IconUsers, IconWheel, IconChart, IconGrid } from '@/components/icons';
import { PrivacyControl } from '@/features/shared/PrivacyControl';
import type { Role } from '@shared/types';
import type { ReactNode } from 'react';

interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean }

const DREAMER_NAV: NavItem[] = [
  { to: '/home', label: 'Home', icon: <IconHome /> },
  { to: '/dreams', label: 'Dreams', icon: <IconStar /> },
  { to: '/actions', label: 'Actions', icon: <IconList /> },
  { to: '/care', label: 'CARE', icon: <IconWheel /> },
  { to: '/journal', label: 'Journal', icon: <IconPen /> },
];

export function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { auth, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <LoadingPage />;
  if (!auth) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  if (roles && !roles.includes(auth.user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function UserMenu() {
  const { auth, logout } = useAuth();
  if (!auth) return null;
  const roleLabel = auth.user.role === 'dreamer' ? 'Dreamer' : auth.user.role === 'coach' ? 'Dream Coach' : 'Director';
  return (
    <Dropdown
      trigger={() => (
        <button type="button" className="user-menu-btn" aria-label="Account menu" data-testid="user-menu">
          <Avatar initials={auth.user.initials} tone={auth.user.role === 'director' ? 'plum' : auth.user.role === 'coach' ? 'gold' : undefined} />
          <span className="hide-mobile" style={{ fontWeight: 500, fontSize: 14 }}>{auth.user.name.split(' ')[0]}</span>
        </button>
      )}
    >
      <div className="menu-head">
        <div style={{ fontWeight: 600 }}>{auth.user.name}</div>
        <div className="muted small">{roleLabel} · {auth.user.email}</div>
      </div>
      <button type="button" className="menu-item" onClick={() => void logout()} data-testid="sign-out">
        <IconLogout /> Sign out
      </button>
    </Dropdown>
  );
}

export function DreamerShell() {
  return (
    <RequireAuth roles={['dreamer']}>
      <div className="shell">
        <header className="topbar">
          <div className="topbar-inner">
            <NavLink to="/home" className="brand"><span className="brand-mark"><IconBrand /></span><span className="hide-mobile">Dream Coach</span></NavLink>
            <nav className="nav" aria-label="Main">
              {DREAMER_NAV.map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}</NavLink>
              ))}
            </nav>
            <div className="topbar-right">
              <PrivacyControl />
              <UserMenu />
            </div>
          </div>
        </header>
        <main className="grow"><Outlet /></main>
        <nav className="mobile-nav" aria-label="Main">
          {DREAMER_NAV.map((n) => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => (isActive ? 'active' : '')}>{n.icon}<span>{n.label}</span></NavLink>
          ))}
        </nav>
      </div>
    </RequireAuth>
  );
}

export function StaffShell() {
  const { auth } = useAuth();
  const isDirector = auth?.user.role === 'director';
  const nav: NavItem[] = isDirector
    ? [
        { to: '/director', label: 'Team', icon: <IconChart />, end: true },
        { to: '/director/dreamers', label: 'All dreamers', icon: <IconUsers /> },
        ...(auth?.coachesDreamers ? [{ to: '/coach', label: 'My coaching', icon: <IconGrid /> }] : []),
      ]
    : [{ to: '/coach', label: 'My dreamers', icon: <IconUsers /> }];
  return (
    <RequireAuth roles={['coach', 'director']}>
      <div className="shell">
        <header className="topbar wide">
          <div className="topbar-inner">
            <NavLink to={isDirector ? '/director' : '/coach'} className="brand"><span className="brand-mark"><IconBrand /></span><span className="hide-mobile">Dream Coach</span></NavLink>
            <nav className="nav" aria-label="Main">
              {nav.map((n) => (
                <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>{n.label}</NavLink>
              ))}
            </nav>
            <div className="topbar-right">
              <span className="chip chip-muted hide-mobile">{isDirector ? 'Director' : 'Dream Coach'}</span>
              <UserMenu />
            </div>
          </div>
        </header>
        <main className="grow"><Outlet /></main>
        <nav className="mobile-nav" aria-label="Main">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>{n.icon}<span>{n.label}</span></NavLink>
          ))}
        </nav>
      </div>
    </RequireAuth>
  );
}

/** Minimal shell for full-screen presentation mode. */
export function BareShell() {
  return (
    <RequireAuth roles={['coach', 'director']}>
      <Outlet />
    </RequireAuth>
  );
}

export function RoleRedirect() {
  const { auth, loading } = useAuth();
  if (loading) return <LoadingPage />;
  if (!auth) return <Navigate to="/login" replace />;
  return <Navigate to={auth.user.role === 'dreamer' ? '/home' : auth.user.role === 'director' ? '/director' : '/coach'} replace />;
}
