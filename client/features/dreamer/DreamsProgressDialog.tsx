/**
 * "Update progress" dialog for one dream — used by the Dreams list and the dream
 * detail page. Saves a self check-in with a single progress update (optional note,
 * separate privacy for the value and for the note).
 */
import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';
import { useCreateCheckIn } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Button, Delta, Field, Modal, PercentInput, PrivacyToggle, TextArea } from '@/components/ui';
import { IconSparkle } from '@/components/icons';
import { useToast } from '@/components/toast';
import type { Dream } from '@shared/types';

export const DREAM_COLOR = 'var(--gold)';

/** Toast copy after saving something, respecting the privacy rules in the client guide. */
export function privacyToast(toast: (m: string, k?: 'success' | 'error' | 'info' | 'private') => void, savedPrivate: boolean, unlocked: boolean, sharedMessage: string, privateMessage = 'Saved as private.') {
  if (!savedPrivate) return toast(sharedMessage, 'success');
  toast(unlocked ? privateMessage : 'Saved as private — private entries are currently hidden.', 'private');
}

export function DreamsProgressDialog({ dream, open, onClose, onSaved }: { dream: Dream; open: boolean; onClose: () => void; onSaved?: (value: number) => void }) {
  if (!open) return null;
  return <ProgressDialogInner dream={dream} onClose={onClose} onSaved={onSaved} />;
}

function ProgressDialogInner({ dream, onClose, onSaved }: { dream: Dream; onClose: () => void; onSaved?: (value: number) => void }) {
  const { auth } = useAuth();
  const { toast } = useToast();
  const create = useCreateCheckIn('me');
  const [value, setValue] = useState<number>(dream.progress ?? 0);
  const [note, setNote] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [notePrivate, setNotePrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasNote = note.trim().length > 0;
  const delta = dream.progress == null ? null : value - dream.progress;
  const reachesHundred = value >= 100 && (dream.progress ?? 0) < 100;

  const save = async () => {
    setError(null);
    try {
      await create.mutateAsync({ progress: [{ dreamId: dream.id, value, isPrivate, note: hasNote ? note.trim() : undefined, notePrivate: hasNote ? notePrivate || isPrivate : undefined }] });
      const anyPrivate = isPrivate || (hasNote && notePrivate);
      const shared = value >= 100 ? 'Progress saved — this dream is achieved. Take a moment to celebrate.' : 'Progress updated.';
      privacyToast(toast, anyPrivate, !!auth?.privateUnlocked, shared, value >= 100 ? 'Saved as private — and this dream is at 100%. Celebrate it.' : 'Saved as private.');
      onSaved?.(value);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Update progress"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={create.isPending} data-testid="progress-cancel">Cancel</Button>
          <Button variant="primary" onClick={() => void save()} loading={create.isPending} data-testid="progress-save">Save update</Button>
        </>
      }
    >
      <div className="stack dd-dialog" data-testid="progress-dialog">
        <div>
          <div className="eyebrow dd-eyebrow">{dream.slotLabel}</div>
          <h3 className="dd-dialog-title">{dream.title}</h3>
        </div>
        <Field label="How far along are you?" hint={dream.progress == null ? 'This is the first progress you record for this dream.' : `Last recorded at ${dream.progress}%.`}>
          <div className="dd-pct-row">
            <PercentInput value={value} onChange={setValue} color={DREAM_COLOR} label="Progress" />
          </div>
          <div className="row dd-pct-summary">
            <span className="dd-pct-big tnum" data-testid="progress-dialog-value">{value}%</span>
            {delta != null && delta !== 0 && <Delta value={delta} digits={0} suffix="%" />}
            {delta === 0 && <span className="muted small">Same as last time — that’s fine too.</span>}
          </div>
        </Field>
        {reachesHundred && (
          <div className="callout callout-gold" data-testid="progress-dialog-celebrate">
            <IconSparkle />
            <span>100% means this dream is achieved. Saving will mark it so — worth celebrating.</span>
          </div>
        )}
        <Field label="Add a note (optional)" htmlFor="dd-progress-note" hint="What moved, what you learned, what is next.">
          <TextArea id="dd-progress-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What’s behind this number?" rows={3} data-testid="progress-note" />
        </Field>
        <div className="dd-privacy-rows">
          <div className="spread dd-privacy-row">
            <span className="small">This progress update</span>
            <span data-testid="progress-private"><PrivacyToggle value={isPrivate} onChange={setIsPrivate} /></span>
          </div>
          {hasNote && !isPrivate && (
            <div className="spread dd-privacy-row fade-in">
              <span className="small">Your note</span>
              <span data-testid="progress-note-private"><PrivacyToggle value={notePrivate} onChange={setNotePrivate} /></span>
            </div>
          )}
          {isPrivate && <div className="muted tiny">Private updates stay out of your coach’s views entirely.{hasNote ? ' Your note travels with the update, so it is private too.' : ''}</div>}
        </div>
        {error && <div className="callout callout-muted" role="alert">{error}</div>}
      </div>
    </Modal>
  );
}
