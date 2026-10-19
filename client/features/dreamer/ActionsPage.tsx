/**
 * /actions — the dreamer's own action list: Active / Completed / Set aside, with
 * filters by dream and CARE area, an always-available composer on the Active tab,
 * and the shared ActionList for complete / reopen / edit / set aside / privacy / delete.
 */
import { useMemo, useState } from 'react';
import { CARE_CATEGORIES, CATEGORY_META, type CareCategory } from '@shared/care';
import type { ActionItem, ActionStatus } from '@shared/types';
import { useActions, useDreams } from '@/api/hooks';
import { errorMessage } from '@/api/client';
import { Card, CardHead, PageHeader, Segmented, Skeleton } from '@/components/ui';
import { IconInfo, IconX } from '@/components/icons';
import { ActionComposer, ActionList } from '@/features/shared/ActionItems';
import { plural } from '@/lib/format';
import { KeepDrafts, useLastKnown, useLoadedOnce } from './drafts';

type Tab = ActionStatus;

const TAB_LABEL: Record<Tab, string> = { active: 'Active', completed: 'Completed', archived: 'Set aside' };

const EMPTY: Record<Tab, { title: string; body: string }> = {
  active: { title: 'Nothing active right now', body: 'Add a small step above — something you could do this week, or something you and your coach talked about.' },
  completed: { title: 'Nothing completed yet', body: 'When you complete an action it gathers here, so you can look back at how far you’ve come.' },
  archived: { title: 'Nothing set aside', body: 'Setting an action aside keeps it here without pressure. You can bring it back any time.' },
};

export function ActionsPage() {
  const actions = useActions('me', 'all');
  const dreams = useDreams('me');
  const [tab, setTab] = useState<Tab>('active');
  const [dreamFilter, setDreamFilter] = useState<number | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CareCategory | null>(null);

  // Hiding private entries loads the actions again. The composer (and what's typed in it) stays meanwhile, and so
  // do the dream filters, which only need the dreams' titles.
  const loaded = useLoadedOnce(!!actions.data);
  const refreshing = !actions.data;
  const knownDreams = useLastKnown(dreams.data);
  const all: ActionItem[] = actions.data ?? [];
  const dreamList = useMemo(() => [...(knownDreams ?? [])].sort((a, b) => a.slot - b.slot), [knownDreams]);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { active: 0, completed: 0, archived: 0 };
    for (const a of all) c[a.status] += 1;
    return c;
  }, [all]);

  const filtered = useMemo(
    () => all.filter((a) => (dreamFilter == null || a.dreamId === dreamFilter) && (categoryFilter == null || a.category === categoryFilter)),
    [all, dreamFilter, categoryFilter],
  );
  const filtering = dreamFilter != null || categoryFilter != null;
  const inTab = filtered.filter((a) => a.status === tab).length;
  const clearFilters = () => { setDreamFilter(null); setCategoryFilter(null); };

  const empty = filtering
    ? { title: 'Nothing matches these filters', body: 'Try another dream or CARE area, or clear the filters to see everything.' }
    : EMPTY[tab];

  return (
    <div className="page page-narrow da-page" data-testid="actions-page">
      <PageHeader eyebrow="Actions" title="Actions" lead="Small steps you’ve chosen. They’re yours to keep, change, or set aside." />

      {!loaded && actions.isPending ? (
        <div className="stack" aria-busy data-testid="actions-loading">
          <Skeleton h={36} w={300} />
          <Card><div className="stack"><Skeleton h={22} w="70%" /><Skeleton h={22} w="55%" /><Skeleton h={22} w="62%" /></div></Card>
        </div>
      ) : !loaded || (refreshing && actions.isError) ? (
        <div className="callout callout-muted" role="alert" data-testid="actions-error"><IconInfo /><span>{errorMessage(actions.error)}</span></div>
      ) : (
        <>
          <div className="da-toolbar">
            <div className="da-tabs">
              <Segmented<Tab>
                value={tab}
                onChange={setTab}
                ariaLabel="Show actions by status"
                options={(['active', 'completed', 'archived'] as Tab[]).map((t) => ({
                  value: t,
                  label: <span data-testid={`actions-tab-${t}`}>{TAB_LABEL[t]} {!refreshing && <span className="da-count tnum">{counts[t]}</span>}</span>,
                }))}
              />
            </div>
            {!refreshing && (
              <p className="da-stats tnum" data-testid="actions-stats">
                {counts.completed} completed so far · {counts.active} active{counts.archived > 0 ? ` · ${counts.archived} set aside` : ''}
              </p>
            )}
          </div>

          {(dreamList.length > 0 || all.length > 0) && (
            <div className="da-filters" role="group" aria-label="Filter actions" data-testid="actions-filters">
              <span className="da-filter-label">Show</span>
              {dreamList.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  className="da-filter-chip"
                  aria-pressed={dreamFilter === d.id}
                  onClick={() => setDreamFilter(dreamFilter === d.id ? null : d.id)}
                  title={`${d.slotLabel} · ${d.title}`}
                  data-testid={`actions-filter-dream-${d.id}`}
                >
                  <span className="da-filter-text">{d.title}</span>
                </button>
              ))}
              {CARE_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="da-filter-chip da-filter-cat"
                  aria-pressed={categoryFilter === c}
                  onClick={() => setCategoryFilter(categoryFilter === c ? null : c)}
                  style={{ '--da-color': CATEGORY_META[c].color, '--da-tint': CATEGORY_META[c].tint } as React.CSSProperties}
                  data-testid={`actions-filter-cat-${c}`}
                >
                  <span className="chip-dot" />
                  <span className="da-filter-text">{CATEGORY_META[c].label}</span>
                </button>
              ))}
              {filtering && (
                <button type="button" className="da-text-btn" onClick={clearFilters} data-testid="actions-filter-clear">
                  <IconX /> Clear
                </button>
              )}
            </div>
          )}

          {tab === 'active' && (
            <Card className="da-composer-card" data-testid="actions-composer">
              <CardHead title="Add an action" sub={dreamFilter != null || categoryFilter ? 'Linked to what you’re looking at — change it if you like.' : 'Something small you could do this week.'} />
              <ActionComposer
                key={`${dreamFilter ?? 'none'}-${categoryFilter ?? 'none'}`}
                dreamerRef="me"
                dreams={dreamList}
                mode="dreamer"
                defaultDreamId={dreamFilter}
                defaultCategory={categoryFilter}
              />
            </Card>
          )}

          <KeepDrafts>
            <Card data-testid="actions-list-card">
              {filtering && inTab > 0 && (
                <p className="da-filter-summary muted small" data-testid="actions-filter-summary">
                  {plural(inTab, 'action')} {tab === 'archived' ? 'set aside' : tab} {dreamFilter != null ? `for “${dreamList.find((d) => d.id === dreamFilter)?.title ?? 'this dream'}”` : ''}{dreamFilter != null && categoryFilter ? ' and ' : ''}{categoryFilter ? `in ${CATEGORY_META[categoryFilter].label}` : ''}
                </p>
              )}
              {refreshing ? (
                <div className="stack" aria-busy><Skeleton h={22} w="70%" /><Skeleton h={22} w="55%" /><Skeleton h={22} w="62%" /></div>
              ) : (
                <ActionList
                  dreamerRef="me"
                  actions={filtered}
                  dreams={dreamList}
                  mode="dreamer"
                  filter={tab}
                  emptyTitle={empty.title}
                  emptyBody={empty.body}
                />
              )}
            </Card>
          </KeepDrafts>
        </>
      )}
    </div>
  );
}
