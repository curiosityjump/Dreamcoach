/**
 * One coach (/director/coaches/:coachId): who they are, how their caseload is
 * doing, month trends for their dreamers, and the caseload itself with a row
 * per dreamer that opens the dreamer's staff page. Figures are context for a
 * conversation with the coach, never a ranking.
 */
import { Link, useNavigate, useParams } from 'react-router';
import type { CaseloadEntry, CoachSummary } from '@shared/types';
import { useCoachDetail } from '@/api/hooks';
import { ApiRequestError, errorMessage } from '@/api/client';
import { useAuth } from '@/auth/AuthContext';
import { staffDreamerPath } from '@/app/routes';
import { Avatar, Button, Card, Chip, EmptyState, LoadingPage } from '@/components/ui';
import { IconArrowLeft, IconArrowRight, IconCalendar, IconCompass, IconGrid, IconInfo, IconUsers } from '@/components/icons';
import { plural } from '@/lib/format';
import { CareCell, ComparisonCaveat, DreamsCell, HowCalculated, LastSelfCell, LastSessionCell, PersonCell, StatGroup, achievedCount, summaryStatGroups } from './DirectorMetrics';
import { DirectorTrendGrid } from './DirectorCharts';

/* ---------- Header ---------- */

function CoachHeader({ summary, isSelf }: { summary: CoachSummary; isSelf: boolean }) {
  const { coach } = summary;
  const isDirector = coach.role === 'director';
  return (
    <div className="dir-coach-head" data-testid="director-coach-header">
      <div className="dir-coach-head-main">
        <Avatar initials={coach.initials} size="lg" tone={isDirector ? 'plum' : 'gold'} />
        <div className="dir-coach-head-text">
          <div className="eyebrow">{isDirector ? 'Director · coaching directly' : 'Dream Coach'}</div>
          <h1 className="dir-coach-name">
            {coach.name}
            {isSelf && <Chip className="chip-muted">You</Chip>}
          </h1>
          <div className="dir-coach-meta">
            <span><IconUsers /> {plural(summary.dreamers, 'dreamer')}{summary.dreamers !== summary.activeDreamers ? ` · ${summary.activeDreamers} active` : ''}</span>
            <span><IconCalendar /> {plural(summary.sessionsTotal, 'session')} in the program</span>
          </div>
        </div>
      </div>
      <div className="dir-coach-head-actions">
        <Link to={`/director/dreamers?coach=${coach.id}`} className="btn btn-secondary" data-testid="director-coach-dreamers-link"><IconUsers /> Caseload in All dreamers</Link>
        {isSelf && <Link to="/coach" className="btn btn-primary" data-testid="director-coach-my-coaching"><IconGrid /> My coaching</Link>}
      </div>
    </div>
  );
}

/* ---------- Caseload ---------- */

function CaseloadTable({ rows }: { rows: CaseloadEntry[] }) {
  const nav = useNavigate();
  return (
    <div className="table-wrap dir-table-wrap">
      <table className="table dir-table dir-caseload-table" data-testid="director-caseload-table">
        <thead>
          <tr>
            <th scope="col">Dreamer</th>
            <th scope="col">Last session</th>
            <th scope="col">Last self activity</th>
            <th scope="col">CARE</th>
            <th scope="col">Dreams</th>
            <th scope="col" className="num">Active actions</th>
            <th scope="col"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr
              key={e.dreamer.id}
              className="clickable dir-row"
              tabIndex={0}
              onClick={() => nav(staffDreamerPath(e.dreamer.id))}
              onKeyDown={(ev) => { if (ev.key === 'Enter') nav(staffDreamerPath(e.dreamer.id)); }}
              data-testid="director-caseload-row"
              data-dreamer-id={e.dreamer.id}
            >
              <td><PersonCell initials={e.dreamer.initials} name={e.dreamer.name} about={e.dreamer.about} status={e.dreamer.status} /></td>
              <td><LastSessionCell snapshot={e.snapshot} /></td>
              <td><LastSelfCell entry={e} /></td>
              <td><CareCell careAverage={e.careAverage} latest={e.snapshot.latest} /></td>
              <td className="dir-dreams-cell"><DreamsCell dreamAverage={e.dreamAverage} achieved={achievedCount(e.snapshot)} /></td>
              <td className="num tnum dir-num-lg">{e.snapshot.activeActions}</td>
              <td className="dir-row-open"><IconArrowRight /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CaseloadCards({ rows }: { rows: CaseloadEntry[] }) {
  const nav = useNavigate();
  return (
    <div className="dir-cards" data-testid="director-caseload-cards">
      {rows.map((e) => (
        <Card
          key={e.dreamer.id}
          className="dir-card"
          pad="sm"
          tabIndex={0}
          onClick={() => nav(staffDreamerPath(e.dreamer.id))}
          onKeyDown={(ev) => { if (ev.key === 'Enter') nav(staffDreamerPath(e.dreamer.id)); }}
          data-testid="director-caseload-card"
          data-dreamer-id={e.dreamer.id}
        >
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="grow"><PersonCell initials={e.dreamer.initials} name={e.dreamer.name} about={e.dreamer.about} status={e.dreamer.status} /></div>
            <IconArrowRight className="dir-card-arrow" />
          </div>
          <dl className="dir-card-facts">
            <div><dt>Last session</dt><dd><LastSessionCell snapshot={e.snapshot} /></dd></div>
            <div><dt>Last self activity</dt><dd><LastSelfCell entry={e} /></dd></div>
            <div><dt>CARE</dt><dd><CareCell careAverage={e.careAverage} latest={e.snapshot.latest} /></dd></div>
            <div><dt>Dreams</dt><dd><DreamsCell dreamAverage={e.dreamAverage} achieved={achievedCount(e.snapshot)} /></dd></div>
            <div><dt>Active actions</dt><dd className="tnum">{e.snapshot.activeActions}</dd></div>
          </dl>
        </Card>
      ))}
    </div>
  );
}

/* ---------- Page ---------- */

function BackLink() {
  return <Link to="/director" className="dir-back" data-testid="director-coach-back"><IconArrowLeft /> Team overview</Link>;
}

function NotFound() {
  return (
    <div className="page page-narrow dir-page">
      <BackLink />
      <Card className="dir-notfound">
        <EmptyState icon={<IconCompass />} title="We couldn’t find that coach" action={<Link to="/director" className="btn btn-primary">Back to the team</Link>}>
          The link may be out of date, or the coach may no longer be part of the Dream Team.
        </EmptyState>
      </Card>
    </div>
  );
}

export function DirectorCoachPage() {
  const { coachId: raw } = useParams();
  const { auth } = useAuth();
  const coachId = raw && /^\d+$/.test(raw) ? Number(raw) : null;
  const detail = useCoachDetail(coachId);

  if (coachId == null) return <NotFound />;
  if (detail.isPending) return <div className="page page-wide"><LoadingPage label="Opening the caseload…" /></div>;
  if (detail.isError) {
    if (detail.error instanceof ApiRequestError && detail.error.status === 404) return <NotFound />;
    return (
      <div className="page page-wide dir-page">
        <BackLink />
        <div className="callout callout-muted" role="alert">
          <IconInfo />
          <span className="grow">{errorMessage(detail.error)}</span>
          <Button variant="secondary" size="sm" onClick={() => void detail.refetch()} loading={detail.isFetching}>Try again</Button>
        </div>
      </div>
    );
  }

  const { summary, caseload, months } = detail.data;
  const isSelf = auth?.user.id === summary.coach.id;
  const first = summary.coach.name.split(' ')[0] ?? summary.coach.name;

  return (
    <div className="page page-wide dir-page" data-testid="director-coach">
      <BackLink />
      <CoachHeader summary={summary} isSelf={isSelf} />

      <div className="dir-stat-groups">
        {summaryStatGroups(summary).map((g) => <StatGroup key={g.label} label={g.label} items={g.items} testPrefix="director-coach-stat" />)}
      </div>

      <section className="dir-section" aria-labelledby="dir-coach-trends-heading">
        <div className="dir-section-head">
          <h2 id="dir-coach-trends-heading">Trends for {first}’s dreamers</h2>
          <span className="dir-section-sub">Month by month across this caseload. Coaching sessions and self check-ins stay side by side so both kinds of activity are visible.</span>
        </div>
        <DirectorTrendGrid months={months} scope="caseload" testPrefix="director-coach" />
      </section>

      <section className="dir-section" aria-labelledby="dir-coach-caseload-heading">
        <div className="dir-section-head">
          <h2 id="dir-coach-caseload-heading">Caseload</h2>
          <span className="dir-section-sub">{caseload.length ? `${plural(caseload.length, 'dreamer')} · open a dreamer to see their dreams, sessions and history.` : ''}</span>
        </div>
        <Card pad={false} className="dir-table-card">
          {caseload.length === 0 ? (
            <EmptyState icon={<IconUsers />} title={`${first} has no dreamers yet`} action={<Link to="/director/dreamers" className="btn btn-secondary">Open All dreamers</Link>}>
              Assign a dreamer from the All dreamers page using “Reassign coach”.
            </EmptyState>
          ) : (
            <>
              <CaseloadTable rows={caseload} />
              <CaseloadCards rows={caseload} />
            </>
          )}
          <div className="dir-table-foot">
            <ComparisonCaveat />
            <HowCalculated />
          </div>
        </Card>
      </section>
    </div>
  );
}
