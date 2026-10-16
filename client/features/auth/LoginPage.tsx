import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/auth/AuthContext';
import { get, errorMessage } from '@/api/client';
import { Button, Field, TextInput, Avatar } from '@/components/ui';
import { IconBrand } from '@/components/icons';
import type { User } from '@shared/types';
import { homeFor } from '@/app/routes';

interface DemoAccount extends User { coachName: string | null; caseload: number }

export function LoginPage() {
  const { auth, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<DemoAccount[]>([]);

  useEffect(() => { get<DemoAccount[]>('/auth/demo-accounts').then(setAccounts).catch(() => {}); }, []);

  if (auth) return <Navigate to={(loc.state as { from?: string } | null)?.from ?? homeFor(auth)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const a = await login(email.trim(), password);
      nav((loc.state as { from?: string } | null)?.from ?? homeFor(a), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const groups: { role: User['role']; title: string; blurb: string }[] = [
    { role: 'dreamer', title: 'Dreamers', blurb: 'A personal space for dreams, actions, reflections, and progress.' },
    { role: 'coach', title: 'Dream Coaches', blurb: 'Caseload at a glance and a live one-on-one workspace.' },
    { role: 'director', title: 'Director', blurb: 'The whole Dream Team: coaches, dreamers, and outcomes.' },
  ];

  return (
    <div className="login">
      <div className="login-card">
        <div className="login-brand">
          <span className="brand-mark"><IconBrand /></span>
          <div>
            <h1 style={{ fontSize: 28 }}>Dream Coach</h1>
            <p className="muted">Dreams belong to the dreamer.</p>
          </div>
        </div>
        <form onSubmit={submit} className="stack" style={{ marginTop: 24 }}>
          <Field label="Email" htmlFor="email">
            <TextInput id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@dreamcoach.demo" />
          </Field>
          <Field label="Password" htmlFor="password" error={error}>
            <TextInput id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button variant="primary" size="lg" type="submit" loading={busy} block>Sign in</Button>
        </form>
        <p className="muted small" style={{ marginTop: 18 }}>
          This is a prototype with fictional people. Every demo account uses the password <span className="kbd">dream2026</span>. Pick an account to fill it in.
        </p>
      </div>
      <div className="login-side">
        {groups.map((g) => {
          const list = accounts.filter((a) => a.role === g.role);
          if (!list.length) return null;
          return (
            <section key={g.role} className="login-group">
              <h3>{g.title}</h3>
              <p className="muted small">{g.blurb}</p>
              <div className="login-accounts">
                {list.map((a) => (
                  <button key={a.id} type="button" className="login-account" onClick={() => { setEmail(a.email); setPassword('dream2026'); setError(null); }} data-testid={`demo-${a.email}`}>
                    <Avatar initials={a.initials} size="sm" tone={a.role === 'director' ? 'plum' : a.role === 'coach' ? 'gold' : undefined} />
                    <span className="grow">
                      <span className="login-account-name">{a.name}</span>
                      <span className="login-account-sub">{a.role === 'dreamer' ? `Coached by ${a.coachName ?? '—'}` : a.role === 'coach' ? `${a.caseload} dreamers` : `Director · ${a.caseload} dreamer${a.caseload === 1 ? '' : 's'} coached directly`}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
