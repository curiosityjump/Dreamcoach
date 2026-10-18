/**
 * Dreamer-only control in the top bar: "Private: hidden / shown".
 * Hide = instant. Show = re-enter the account password (verified server-side).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { Button, Field, Modal, TextInput } from '@/components/ui';
import { IconEye, IconEyeOff, IconLock } from '@/components/icons';
import { useToast } from '@/components/toast';
import { ApiRequestError, errorMessage } from '@/api/client';

export function PrivacyControl({ compact }: { compact?: boolean }) {
  const { auth, unlockPrivate, lockPrivate } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!auth || auth.user.role !== 'dreamer') return null;
  const unlocked = auth.privateUnlocked;

  const onToggle = async () => {
    if (unlocked) {
      setBusy(true);
      try {
        await lockPrivate();
        toast('Private entries hidden.', 'private');
      } catch (e) {
        // They are hidden on screen whatever happened; the lock keeps retrying in the background.
        // (A 401 means the session ended, and the sign-in page says so.)
        if (!(e instanceof ApiRequestError && e.status === 401)) toast('Couldn’t reach the server, so private entries stay hidden on this screen. We’ll keep trying.', 'private');
      } finally {
        setBusy(false);
      }
    } else setOpen(true);
  };

  return (
    <>
      <button type="button" className={`privacy-status${unlocked ? ' unlocked' : ''}`} onClick={onToggle} disabled={busy} data-testid="privacy-toggle" title={unlocked ? 'Private entries are showing. Click to hide them instantly.' : 'Private entries are hidden. Click to show them (password required).'}>
        {unlocked ? <IconEye /> : <IconEyeOff />}
        <span>{compact ? (unlocked ? 'Private shown' : 'Private hidden') : unlocked ? 'Hide private' : 'Show private'}</span>
      </button>
      <UnlockDialog open={open} onClose={() => setOpen(false)} onUnlock={unlockPrivate} />
    </>
  );
}

export function UnlockDialog({ open, onClose, onUnlock }: { open: boolean; onClose: () => void; onUnlock: (password: string) => Promise<unknown> }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { auth } = useAuth();
  // Cancel, Escape and the close button all start the next attempt clean.
  const close = () => { setPassword(''); setError(null); onClose(); };
  // Private entries came into view some other way (another tab): nothing left to ask.
  useEffect(() => { if (open && !busy && auth?.privateUnlocked) close(); }, [open, busy, auth?.privateUnlocked]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onUnlock(password);
      setPassword('');
      onClose();
      toast('Private entries are now showing.', 'private');
    } catch (err) {
      setError(errorMessage(err));
      // Ready for another try (disabling the busy submit button took focus with it).
      input.current?.focus();
      input.current?.select();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={close} title="Show private entries">
      <form onSubmit={submit} className="stack" data-testid="unlock-form">
        <div className="callout callout-private">
          <IconLock />
          <span>Private entries are only ever visible to you. Re-enter your password to show them on this device. They hide again automatically after 30 minutes without activity, or whenever you choose Hide private.</span>
        </div>
        <Field label="Your password" error={error} htmlFor="unlock-password">
          <TextInput ref={input} id="unlock-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" loading={busy} disabled={!password}>Show private entries</Button>
        </div>
      </form>
    </Modal>
  );
}
