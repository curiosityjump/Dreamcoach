/**
 * Editing a dream's title and description. `DreamsEditForm` is the bare form (used
 * inline on the detail page); `DreamsEditDialog` wraps it in a modal for the list.
 */
import { useState, type FormEvent } from 'react';
import { useUpdateDream } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Button, Field, Modal, TextArea, TextInput } from '@/components/ui';
import { useToast } from '@/components/toast';
import type { Dream } from '@shared/types';

export function DreamsEditForm({ dream, guidance, onDone, onCancel, autoFocus = true }: { dream: Dream; guidance?: string; onDone: () => void; onCancel: () => void; autoFocus?: boolean }) {
  const { toast } = useToast();
  const update = useUpdateDream('me');
  const [title, setTitle] = useState(dream.title);
  const [description, setDescription] = useState(dream.description);
  const [error, setError] = useState<string | null>(null);
  const clean = title.trim();
  const dirty = clean !== dream.title || description.trim() !== dream.description;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clean) { setError('A dream needs a title.'); return; }
    if (!dirty) { onDone(); return; }
    setError(null);
    try {
      await update.mutateAsync({ dreamId: dream.id, title: clean, description: description.trim() });
      toast('Dream updated.', 'success');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form className="stack dd-edit-form" onSubmit={(e) => void submit(e)} data-testid="dream-edit-form">
      <Field label="Title" htmlFor={`dd-title-${dream.id}`} error={error} hint={guidance}>
        <TextInput id={`dd-title-${dream.id}`} value={title} onChange={(e) => { setTitle(e.target.value); if (error) setError(null); }} maxLength={200} autoFocus={autoFocus} placeholder="Name your dream" data-testid="dream-title-input" />
      </Field>
      <Field label="Description" htmlFor={`dd-desc-${dream.id}`} hint="A sentence or two about what this looks like when it’s real.">
        <TextArea id={`dd-desc-${dream.id}`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={3} placeholder="What does this dream look like?" data-testid="dream-description-input" />
      </Field>
      <div className="row dd-edit-actions">
        <Button variant="secondary" onClick={onCancel} disabled={update.isPending} data-testid="dream-edit-cancel">Cancel</Button>
        <Button variant="primary" type="submit" loading={update.isPending} disabled={!clean} data-testid="dream-edit-save">Save</Button>
      </div>
    </form>
  );
}

export function DreamsEditDialog({ dream, guidance, open, onClose }: { dream: Dream; guidance?: string; open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Modal open onClose={onClose} title="Edit dream">
      <div className="stack dd-dialog" data-testid="dream-edit-dialog">
        <div className="eyebrow dd-eyebrow">{dream.slotLabel}</div>
        <DreamsEditForm dream={dream} guidance={guidance} onDone={onClose} onCancel={onClose} />
      </div>
    </Modal>
  );
}
