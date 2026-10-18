/**
 * Director overview (/director): the whole Dream Team at a glance — program
 * totals, the CARE picture, month trends, and one row per coach that opens the
 * coach's page. Figures are context for conversations, never a ranking.
 */
import { Link, useNavigate } from 'react-router';
import { CARE_CATEGORIES, CATEGORY_META, RATING_CATEGORIES } from '@shared/care';
import type { CoachSummary, DirectorOverview } from '@shared/types';
import { useDirectorOverview } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Avatar, Button, Card, CardHead, Chip, EmptyState, LoadingPage, PageHeader } from '@/components/ui';
import { WheelOfLife } from '@/components/WheelOfLife';
import { IconArrowRight, IconInfo, IconUsers } from '@/components/icons';
import { num, pct, plural } from '@/lib/format';
import { CareChangeValue, ComparisonCaveat, HowCalculated, RateWithN, StatGroup, TableScroll, Th, fmtDayRange, programMonth, type StatItem } from './DirectorMetrics';
import { ActionsChart, CareLinesChart, DreamProgressChart, SessionsChart, TrendCard, monthRows } from './DirectorCharts';

const coachPath = (id: number) => `/director/coaches/${id}`;

function totalsGroups(t: DirectorOverview['totals'], coaches: CoachSummary[]): { label: string; items: StatItem[] }[] {
  // The Director is listed among the coaches when they coach dreamers or have run sessions.
  const director = coaches.find((c) => c.coach.role === 'director');
  const coachesSub = !director ? 'on the Dream Team' : director.dreamers > 0 ? 'including the Director’s own caseload' : 'including the Director, for the sessions they ran';
  return [
    {
      label: 'Team & participation',
      items: [
        { key: 'coaches', label: 'Coaches', value: t.coaches, sub: coachesSub },
        { key: 'dreamers', label: 'Dreamers', value: t.activeDreamers, sub: t.dreamers === 0 ? 'none in the program yet' : t.activeDreamers === t.dreamers ? 'all active' : `active of ${t.dreamers} in the program` },
        { key: 'sessions', label: 'Sessions this month', value: t.sessionsThisMonth, sub: `${t.sessionsLast30d} in the last 30 days · ${t.sessionsTotal} in the program` },
        { key: 'participation', label: 'Participation (45d)', value: pct(t.participation45d), sub: 'of active dreamers had a session in the last 45 days' },
        { key: 'engaged', label: 'Engaged between sessions (30d)', value: plural(t.engagedBetweenSessions30d, 'dreamer'), sub: `of ${t.activeDreamers} active, with a self check-in or reflection in the last 30 days` },
      ],
    },
    {
      label: 'Outcomes',
      items: [
        { key: 'achieved', label: 'Dreams achieved', value: t.dreamsAchieved, sub: 'across the team' },
        { key: 'dream-progress', label: 'Avg dream progress', value: pct(t.avgDreamProgress), sub: 'latest progress across all dreams' },
        { key: 'commitment', label: 'Avg commitment / satisfaction', value: <>{num(t.avgCommitment)} <span className="dir-slash">/</span> {num(t.avgSatisfaction)}</>, sub: 'latest ratings, 0–10' },
        { key: 'care-change', label: 'CARE change since first session', value: <CareChangeValue change={t.careChange} size="lg" />, sub: t.careChange ? `n = ${plural(t.careChange.n, 'dreamer')} with 2+ sessions` : 'needs dreamers with 2+ sessions' },
        { key: 'follow-through', label: 'Follow-through', value: t.followThrough ? pct(t.followThrough.rate) : '—', sub: t.followThrough ? `of ${plural(t.followThrough.n, 'action')} older than 30 days completed` : 'no actions older than 30 days yet' },
      ],
    },
  ];
}

/* ---------- CARE across the team ---------- */

function CareAcrossTeam({ latest }: { latest: DirectorOverview['totals']['careLatest'] }) {
  const has = RATING_CATEGORIES.some((c) => latest[c] != null);
  const careVals = CARE_CATEGORIES.map((c) => latest[c]).filter((v): v is number => v != null);
  const careAvg = careVals.length ? careVals.reduce((a, b) => a + b, 0) / careVals.length : null;
  return (
    <Card className="dir-wheel-card" data-testid="director-wheel">
      <CardHead title="Where the team is now" sub="Average of each dreamer’s latest ratings" />
      {!has ? (
        <EmptyState icon={<IconInfo />} title="No ratings yet">The team’s CARE picture appears once sessions record ratings.</EmptyState>
      ) : (
        <div className="dir-wheel-wrap">
          <WheelOfLife values={{ contribution: latest.contribution, alignment: latest.alignment, relationships: latest.relationships, energy: latest.energy }} size={280} />
          <ul className="dir-care-list">
            {RATING_CATEGORIES.map((c) => (
              <li key={c} className="dir-care-list-item">
                <span className="row" style={{ gap: 8 }}>
                  <span className="dir-dot" style={{ background: CATEGORY_META[c].color }} />
                  <span>{CATEGORY_META[c].label}</span>
                </span>
                <span className="tnum dir-strong">{latest[c] == null ? '—' : num(latest[c])}</span>
              </li>
            ))}
          </ul>
          {careAvg != null && <div className="muted small">CARE average {num(careAvg)} · Commitment and Satisfaction are rated separately from the wheel.</div>}
        </div>
      )}
    </Card>
  );
}

/* ---------- Coaches ---------- */

function CoachName({ c }: { c: CoachSummary }) {
  return (
    <span className="dir-person">
      <Avatar initials={c.coach.initials} tone={c.coach.role === 'director' ? 'plum' : 'gold'} />
      <span className="dir-person-text">
        <span className="dir-person-name">
          <Link to={coachPath(c.coach.id)} className="dir-person-link" onClick={(e) => e.stopPropagation()}>{c.coach.name}</Link>
          {c.coach.role === 'director' && <Chip className="chip-muted" title="The Director’s own caseload">Director</Chip>}
        </span>
        <span className="dir-person-about">{plural(c.sessionsTotal, 'session')} run</span>
      </span>
    </span>
  );
}

function CoachesTable({ coaches }: { coaches: CoachSummary[] }) {
  const nav = useNavigate();
  return (
    <TableScroll>
      <table className="table dir-table dir-coaches-table" data-testid="director-coaches-table">
        <thead>
          <tr>
            <Th>Coach</Th>
            <Th className="num" sub="active / total">Dreamers</Th>
            <Th className="num" sub="last 30 days">Sessions run</Th>
            <Th className="num" sub="45 days">Participation</Th>
            <Th className="num" sub="between sessions, 30d">Engaged</Th>
            <Th className="num" sub="first → latest session">CARE change</Th>
            <Th className="num" sub="latest, 0–10">Commitment&nbsp;/<br />satisfaction</Th>
            <Th className="num" sub="avg progress">Dreams</Th>
            <Th className="num" sub="actions older than 30d">Follow-through</Th>
            <th scope="col"><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {coaches.map((c) => (
            <tr
              key={c.coach.id}
              className="clickable dir-row"
              tabIndex={0}
              onClick={() => nav(coachPath(c.coach.id))}
              onKeyDown={(e) => { if (e.key === 'Enter') nav(coachPath(c.coach.id)); }}
              data-testid="director-coach-row"
              data-coach-id={c.coach.id}
            >
              <td><CoachName c={c} /></td>
              <td className="num"><span className="tnum">{c.activeDreamers}</span><span className="muted"> / {c.dreamers}</span></td>
              <td className="num tnum">{c.sessionsLast30d}</td>
              <td className="num tnum">{pct(c.participation45d)}</td>
              <td className="num"><span className="tnum">{c.engagedBetweenSessions30d}</span><span className="muted"> of {c.activeDreamers}</span></td>
              <td className="num"><CareChangeValue change={c.careChange} /></td>
              <td className="num tnum">{num(c.avgCommitment)} <span className="dir-slash">/</span> {num(c.avgSatisfaction)}</td>
              <td className="num">
                <span className="dir-cell-stack dir-cell-end">
                  <span className="tnum">{pct(c.avgDreamProgress)}</span>
                  {c.dreamsAchieved > 0 && <span className="dir-achieved tnum">{c.dreamsAchieved} achieved</span>}
                </span>
              </td>
              <td className="num">{c.followThrough ? <RateWithN rate={c.followThrough.rate} n={c.followThrough.n} /> : <span className="muted">—</span>}</td>
              <td className="dir-row-open"><IconArrowRight /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function CoachCards({ coaches }: { coaches: CoachSummary[] }) {
  const nav = useNavigate();
  return (
    <div className="dir-cards" data-testid="director-coach-cards">
      {coaches.map((c) => (
        <Card key={c.coach.id} className="dir-card" pad="sm" onClick={() => nav(coachPath(c.coach.id))} data-testid="director-coach-card" data-coach-id={c.coach.id}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div className="grow"><CoachName c={c} /></div>
            <IconArrowRight className="dir-card-arrow" />
          </div>
          <dl className="dir-card-facts">
            <div><dt>Dreamers</dt><dd className="tnum">{c.activeDreamers} <span className="muted">active of {c.dreamers}</span></dd></div>
            <div><dt>Sessions run (30d)</dt><dd className="tnum">{c.sessionsLast30d}</dd></div>
            <div><dt>Participation (45d)</dt><dd className="tnum">{pct(c.participation45d)}</dd></div>
            <div><dt>Engaged (30d)</dt><dd className="tnum">{c.engagedBetweenSessions30d} <span className="muted">of {c.activeDreamers}</span></dd></div>
            <div><dt>CARE change</dt><dd><CareChangeValue change={c.careChange} /></dd></div>
            <div><dt>Commitment / satisfaction</dt><dd className="tnum">{num(c.avgCommitment)} / {num(c.avgSatisfaction)}</dd></div>
            <div><dt>Dream progress</dt><dd className="tnum">{pct(c.avgDreamProgress)}</dd></div>
            <div><dt>Dreams achieved</dt><dd className="tnum">{c.dreamsAchieved}</dd></div>
            <div><dt>Follow-through</dt><dd>{c.followThrough ? <RateWithN rate={c.followThrough.rate} n={c.followThrough.n} /> : <span className="muted">—</span>}</dd></div>
          </dl>
        </Card>
      ))}
    </div>
  );
}

/* ---------- Page ---------- */

export function DirectorOverviewPage() {
  const { data, isLoading, error, refetch, isFetching } = useDirectorOverview();

  if (isLoading) return <LoadingPage label="Gathering the team picture…" />;
  if (error || !data) {
    return (
      <div className="page page-wide">
        <PageHeader title="Dream Team" />
        <div className="callout callout-muted" role="alert">
          <IconInfo />
          <span className="grow">{errorMessage(error)}</span>
          <Button variant="secondary" size="sm" onClick={() => void refetch()} loading={isFetching}>Try again</Button>
        </div>
      </div>
    );
  }

  const { program, totals, coaches, months } = data;
  const pm = programMonth(program.startsOn, program.endsOn);
  const rows = monthRows(months);

  return (
    <div className="page page-wide dir-page" data-testid="director-overview">
      <PageHeader
        eyebrow={program.name}
        title="Dream Team"
        lead={
          <>
            <span className="dir-dates">{fmtDayRange(program.startsOn, program.endsOn)}</span>
            {pm && <span className="muted"> · month {pm.current} of {pm.total}</span>}
            <br />
            {program.description}
          </>
        }
        actions={<Link to="/director/dreamers" className="btn btn-secondary" data-testid="director-all-dreamers-link"><IconUsers /> All dreamers</Link>}
      />

      <div className="dir-stat-groups">
        {totalsGroups(totals, coaches).map((g) => <StatGroup key={g.label} label={g.label} items={g.items} testPrefix="director-stat" />)}
      </div>

      <section className="dir-section" aria-labelledby="dir-care-heading">
        <div className="dir-section-head">
          <h2 id="dir-care-heading">CARE across the team</h2>
          <span className="dir-section-sub">Where the team is now, and how session ratings have moved month by month.</span>
        </div>
        <div className="dir-care-grid">
          <CareAcrossTeam latest={totals.careLatest} />
          <TrendCard title="CARE ratings by month" definition="Average of the CARE ratings recorded in coaching sessions each month, per area." rows={rows} testId="director-chart-care">
            <CareLinesChart rows={rows} height={300} />
          </TrendCard>
        </div>
      </section>

      <section className="dir-section" aria-labelledby="dir-trends-heading">
        <div className="dir-section-head">
          <h2 id="dir-trends-heading">Activity & progress over the program</h2>
          <span className="dir-section-sub">Coaching sessions and self check-ins are shown side by side so both kinds of activity stay visible.</span>
        </div>
        <div className="grid grid-3 dir-trend-grid">
          <TrendCard title="Sessions & self check-ins" definition="Completed coaching sessions and self check-ins recorded each month across the team." rows={rows} testId="director-chart-sessions">
            <SessionsChart rows={rows} />
          </TrendCard>
          <TrendCard title="Dream progress by month" definition="Average dream progress recorded in coaching sessions each month." rows={rows} testId="director-chart-dreams">
            <DreamProgressChart rows={rows} />
          </TrendCard>
          <TrendCard title="Actions created vs completed" definition="Actions created and completed each month." rows={rows} testId="director-chart-actions">
            <ActionsChart rows={rows} />
          </TrendCard>
        </div>
      </section>

      <section className="dir-section" aria-labelledby="dir-coaches-heading">
        <div className="dir-section-head">
          <h2 id="dir-coaches-heading">Coaches</h2>
          <span className="dir-section-sub">Sessions are counted for the coach who ran them. Every other column describes the coach’s current caseload.</span>
          <Link to="/director/dreamers" className="dir-link" data-testid="director-all-dreamers-link-2">All dreamers <IconArrowRight /></Link>
        </div>
        {totals.unassignedDreamers > 0 && (
          <div className="callout dir-unassigned" data-testid="director-unassigned">
            <IconUsers />
            <span className="grow">
              {totals.unassignedDreamers === 1 ? '1 dreamer has no coach assigned and isn’t' : `${totals.unassignedDreamers} dreamers have no coach assigned and aren’t`} in any coach’s row below.
            </span>
            <Link to="/director/dreamers?coach=none" className="btn btn-secondary btn-sm" data-testid="director-unassigned-link">Assign a coach</Link>
          </div>
        )}
        <Card pad={false} className="dir-table-card">
          {coaches.length === 0 ? (
            <EmptyState icon={<IconUsers />} title="No coaches yet">Coaches appear here once dreamers are assigned to them.</EmptyState>
          ) : (
            <>
              <CoachesTable coaches={coaches} />
              <CoachCards coaches={coaches} />
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
