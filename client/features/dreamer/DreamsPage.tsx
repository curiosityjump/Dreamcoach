/**
 * /dreams — the dreamer's four dreams, one per horizon of the program.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { useDreams, useOverview, useSessions } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Bar, Button, Card, EmptyState, PageHeader, PrivateChip, Skeleton } from '@/components/ui';
import { IconArrowRight, IconEdit, IconInfo, IconStar, IconTarget } from '@/components/icons';
import { plural, relativeTime } from '@/lib/format';
import type { CoachingSession, Dream, Program } from '@shared/types';
import { DREAM_COLOR, DreamsProgressDialog } from './DreamsProgressDialog';
import { DreamsEditDialog } from './DreamsEditDialog';
import { AchievedChip, SessionDelta, dreamBaseline } from './HomePage';

export function DreamsPage() {
  const dreams = useDreams('me');
  const overview = useOverview('me');
  const sessions = useSessions('me');
  const program = overview.data?.dreamer.program ?? null;

  return (
    <div className="page dd-page">
      <PageHeader
        eyebrow="Dreams"
        title="Your dreams"
        lead="Four dreams, four horizons: one for the coming months, one to live out during the program, one for the next few years, and one for a lifetime. Update your progress whenever something moves — a little or a lot."
      />
      {dreams.isPending && (
        <div className="grid grid-2">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="dd-card dd-card-skeleton">
              <Skeleton h={12} w={120} />
              <Skeleton h={24} w="70%" />
              <Skeleton h={16} w="90%" />
              <Skeleton h={36} w={90} />
              <Skeleton h={12} />
            </Card>
          ))}
        </div>
      )}
      {dreams.isError && (
        <div className="callout callout-muted" role="alert"><IconInfo /><span>{errorMessage(dreams.error)}</span></div>
      )}
      {dreams.data && dreams.data.length === 0 && (
        <Card>
          <EmptyState icon={<IconStar />} title="No dreams yet">Your coach will set up your four dream slots with you in your first session.</EmptyState>
        </Card>
      )}
      {dreams.data && dreams.data.length > 0 && (
        <div className="grid grid-2 dd-grid">
          {dreams.data.map((d) => (
            <DreamCard key={d.id} dream={d} program={program} sessions={sessions.data ?? []} />
          ))}
        </div>
      )}
    </div>
  );
}

function DreamCard({ dream, program, sessions }: { dream: Dream; program: Program | null; sessions: CoachingSession[] }) {
  const [updating, setUpdating] = useState(false);
  const [editing, setEditing] = useState(false);
  const achieved = !!dream.achievedAt;
  const guidance = program?.slotGuidance[dream.slot - 1];

  return (
    <Card className={`dd-card${achieved ? ' dd-card-achieved' : ''}`} pad={false} data-testid="dream-card" data-dream-id={dream.id}>
      <div className="dd-card-body">
        <div className="spread dd-card-top">
          <span className="eyebrow dd-eyebrow">{dream.slotLabel}</span>
          {achieved && <AchievedChip achievedAt={dream.achievedAt!} />}
        </div>
        <h2 className="dd-card-title">
          <Link to={`/dreams/${dream.id}`} className="dd-card-link" data-testid="dream-card-link">{dream.title}</Link>
        </h2>
        {dream.description ? <p className="dd-card-desc">{dream.description}</p> : <p className="dd-card-desc muted">No description yet — add one so future you remembers what this looks like.</p>}
        <div className="dd-progress">
          <div className="row dd-progress-head">
            <span className="dd-progress-value tnum" data-testid="dream-progress-value">{dream.progress == null ? '—' : `${dream.progress}%`}</span>
            {dream.progress != null && <SessionDelta value={dream.progress} base={dreamBaseline(sessions, dream)} suffix=" pts" />}
            {dream.progressIsPrivate && <span data-testid="dream-progress-private"><PrivateChip /></span>}
            {dream.progress == null && <span className="muted small">No progress recorded yet</span>}
          </div>
          <Bar value={dream.progress} color={DREAM_COLOR} large label={`${dream.title} progress`} />
          <div className="dd-meta muted small">
            {dream.progressAt ? <span>Updated {relativeTime(dream.progressAt)}</span> : <span>Record your first update whenever you’re ready</span>}
            <span>{dream.activeActions === 0 ? 'No active actions' : plural(dream.activeActions, 'active action')}</span>
          </div>
          {achieved && <p className="dd-achieved-note">You made this one real. Keep it here as a reminder of what you can do.</p>}
        </div>
      </div>
      <div className="dd-card-actions">
        <Button variant={achieved ? 'secondary' : 'primary'} size="sm" onClick={() => setUpdating(true)} data-testid="dream-update-progress"><IconTarget /> Update progress</Button>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} data-testid="dream-edit"><IconEdit /> Edit</Button>
        <Link to={`/dreams/${dream.id}`} className="btn btn-ghost btn-sm dd-card-open" aria-label={`Open ${dream.title}`} data-testid="dream-card-open">History <IconArrowRight /></Link>
      </div>
      <DreamsProgressDialog dream={dream} open={updating} onClose={() => setUpdating(false)} />
      <DreamsEditDialog dream={dream} guidance={guidance} open={editing} onClose={() => setEditing(false)} />
    </Card>
  );
}
