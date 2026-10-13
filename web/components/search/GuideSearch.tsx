'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  MODEL_BLURBS,
  MODEL_LABELS,
  matchesTerm,
  searchApi,
  type BenchmarkResponse,
  type CompareResponse,
  type MetricKey,
  type SearchHit,
  type SearchModel,
  type SearchResponse,
  type StructuredResponse,
} from '@/lib/search/api';
import styles from './GuideSearch.module.css';

type Tab = 'search' | 'compare' | 'structured' | 'evaluation';

const TABS: { id: Tab; label: string }[] = [
  { id: 'search', label: 'Search' },
  { id: 'compare', label: 'Compare models' },
  { id: 'structured', label: 'Structured' },
  { id: 'evaluation', label: 'Evaluation' },
];

const MODELS: SearchModel[] = ['boolean', 'bim', 'bim_feedback', 'bm25', 'bm25f'];

/** The judged benchmark queries (server/ir/evaluate.py), as one-tap examples. */
const EXAMPLES = [
  { text: 'standing leg bent tree', boolean: 'standing AND leg AND bent AND tree', from: 'coach' },
  { text: 'beginner balance', boolean: 'beginner AND balance NOT floor', from: 'user' },
  { text: 'gentle stretch lower back', boolean: 'gentle AND stretch AND lower AND back', from: 'user' },
  { text: 'hamstring stretch', boolean: 'hamstring AND stretch', from: 'user' },
  { text: 'arms overhead', boolean: 'arms AND overhead', from: 'coach' },
];

const STRUCTURED_EXAMPLES = [
  'cautions CONTAINING knee',
  'fault CONTAINING knee bent',
  'sentence CONTAINING arms WITHIN steps',
  'knee ... ankle',
  'knee ... ankle WITHIN fault',
];

function isTab(value: string | null): value is Tab {
  return TABS.some((t) => t.id === value);
}

function isModel(value: string | null): value is SearchModel {
  return MODELS.includes(value as SearchModel);
}

export function GuideSearch() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'search';
  const fromCoach = params.get('from') === 'coach';

  const setTab = useCallback(
    (next: Tab) => {
      const p = new URLSearchParams(params.toString());
      p.set('tab', next);
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [params, pathname, router]
  );

  return (
    <div className={styles.root}>
      {fromCoach && (
        <p className={styles.coachNote}>
          This search was built from a correction the coach gave you. The guide
          that explains it should be first.
        </p>
      )}

      <div className={styles.tabs} role="tablist" aria-label="Search mode">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={styles.tab}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'search' && <SearchView />}
      {tab === 'compare' && <CompareView />}
      {tab === 'structured' && <StructuredView />}
      {tab === 'evaluation' && <EvaluationView />}
    </div>
  );
}

/* ── shared ─────────────────────────────────────────────────────────────── */

function useRequest<T>() {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async (fn: () => Promise<T>) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fn());
    } catch (e) {
      setData(null);
      setError(
        e instanceof TypeError
          ? 'Could not reach the FitSync API. If it has been idle it may take up to a minute to wake — try again shortly.'
          : (e as Error).message
      );
    } finally {
      setLoading(false);
    }
  }, []);

  return { data, error, loading, run };
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((part, i) =>
        matchesTerm(part, terms) ? (
          <mark key={i} className={styles.mark}>
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function QueryBar({
  value,
  onChange,
  onSubmit,
  placeholder,
  label,
  loading,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  placeholder: string;
  label: string;
  loading: boolean;
}) {
  return (
    <form
      className={styles.queryBar}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label className="sr-only" htmlFor={`q-${label}`}>
        {label}
      </label>
      <input
        id={`q-${label}`}
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
      />
      <button className="btn btn-primary" type="submit" disabled={loading || !value.trim()}>
        {loading ? 'Searching…' : 'Search'}
      </button>
    </form>
  );
}

function Chips({ items, onPick }: { items: { label: string; hint?: string }[]; onPick: (i: number) => void }) {
  return (
    <div className={styles.chips}>
      {items.map((item, i) => (
        <button key={item.label} type="button" className={styles.chip} onClick={() => onPick(i)}>
          {item.hint && <span className={styles.chipHint}>{item.hint}</span>}
          {item.label}
        </button>
      ))}
    </div>
  );
}

function GuideTitle({ doc }: { doc: SearchHit['doc'] }) {
  return (
    <div className={styles.guideTitle}>
      <span className={styles.guideName}>{doc.name}</span>
      <span className={styles.guideSanskrit}>{doc.sanskrit}</span>
      <span className={styles.badges}>
        <span className="tag tag-neutral">{doc.level}</span>
        {doc.trackable && (
          <Link href={`/session?pose=${doc.slug}`} className="tag tag-accent">
            Live coaching
          </Link>
        )}
      </span>
    </div>
  );
}

/* ── Search ─────────────────────────────────────────────────────────────── */

function SearchView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const initialModel = params.get('model');
  const [model, setModel] = useState<SearchModel>(isModel(initialModel) ? initialModel : 'bm25f');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const { data, error, loading, run } = useRequest<SearchResponse>();

  const submit = useCallback(
    (q: string, m: SearchModel) => {
      if (!q.trim()) return;
      const p = new URLSearchParams(params.toString());
      p.set('q', q);
      p.set('model', m);
      p.set('tab', 'search');
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
      run(() => searchApi.search(q, m));
    },
    [params, pathname, router, run]
  );

  // Run a query that arrived in the URL (e.g. from the session summary).
  useEffect(() => {
    const q = params.get('q');
    if (q) run(() => searchApi.search(q, isModel(params.get('model')) ? (params.get('model') as SearchModel) : 'bm25f'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickModel = (m: SearchModel) => {
    setModel(m);
    if (query.trim()) submit(query, m);
  };

  return (
    <section>
      <div className={styles.models} role="radiogroup" aria-label="Retrieval model">
        {MODELS.map((m) => (
          <button
            key={m}
            role="radio"
            aria-checked={model === m}
            className={styles.model}
            onClick={() => pickModel(m)}
          >
            {MODEL_LABELS[m]}
          </button>
        ))}
      </div>
      <p className={styles.blurb}>{MODEL_BLURBS[model]}</p>

      <QueryBar
        label="Search pose guides"
        value={query}
        onChange={setQuery}
        onSubmit={() => submit(query, model)}
        placeholder={model === 'boolean' ? 'balance AND beginner NOT floor' : 'gentle stretch lower back'}
        loading={loading}
      />
      <Chips
        items={EXAMPLES.map((e) => ({
          label: model === 'boolean' ? e.boolean : e.text,
          hint: e.from === 'coach' ? 'coach' : undefined,
        }))}
        onPick={(i) => {
          const q = model === 'boolean' ? EXAMPLES[i].boolean : EXAMPLES[i].text;
          setQuery(q);
          submit(q, model);
        }}
      />

      {error && <p className={styles.error}>{error}</p>}

      {data && (
        <>
          <p className={styles.meta}>
            {data.total} {data.total === 1 ? 'guide' : 'guides'}
            {data.expression ? (
              <>
                {' '}match <code className={styles.code}>{data.expression}</code>, in no particular order
              </>
            ) : (
              <>
                {' '}ranked by {MODEL_LABELS[data.model]} for terms{' '}
                <code className={styles.code}>{data.terms.join(' · ') || '—'}</code>
              </>
            )}
          </p>
          {data.results.length === 0 ? (
            <p className={styles.empty}>
              Nothing matched.{' '}
              {data.model === 'boolean'
                ? 'Every condition must hold at once — try OR, or a ranked model.'
                : 'None of these words appear in any guide.'}
            </p>
          ) : (
            <ol className={styles.results}>
              {data.results.map((hit, i) => (
                <ResultCard key={hit.doc.id} hit={hit} rank={data.ranked ? i + 1 : null} model={data.model} terms={data.terms} />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}

function ResultCard({
  hit,
  rank,
  model,
  terms,
}: {
  hit: SearchHit;
  rank: number | null;
  model: SearchModel;
  terms: string[];
}) {
  const [open, setOpen] = useState(rank === 1);
  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <span className={styles.rank} aria-label={rank ? `Rank ${rank}` : 'Unranked'}>
          {rank ?? '•'}
        </span>
        <GuideTitle doc={hit.doc} />
        {hit.score !== null && <span className={styles.score}>{hit.score.toFixed(3)}</span>}
      </div>
      {hit.snippet && (
        <p className={styles.snippet}>
          <Highlight text={hit.snippet} terms={terms} />
        </p>
      )}
      {hit.terms.length > 0 && (
        <>
          <button type="button" className={`btn btn-ghost ${styles.why}`} onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide' : 'Why this rank?'}
          </button>
          {open && <Evidence model={model} hit={hit} />}
        </>
      )}
    </li>
  );
}

function Evidence({ model, hit }: { model: SearchModel; hit: SearchHit }) {
  const fmt = (n: number | undefined, d = 3) => (n === undefined ? '—' : n.toFixed(d));
  const columns =
    model === 'bim' || model === 'bim_feedback'
      ? ['term', 'df', 'p', 'u', 'weight']
      : model === 'bm25'
        ? ['term', 'tf', 'df', 'idf', 'length norm', 'contribution']
        : ['term', 'found in', 'idf', 'weighted tf', 'contribution'];

  return (
    <div className={styles.evidence}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {hit.terms.map((t) => (
            <tr key={t.term}>
              <td className={styles.termCell}>{t.term}</td>
              {(model === 'bim' || model === 'bim_feedback') && (
                <>
                  <td>{t.df}</td>
                  <td>{fmt(t.p)}</td>
                  <td>{fmt(t.u)}</td>
                  <td className={t.contribution < 0 ? styles.negative : undefined}>{fmt(t.contribution)}</td>
                </>
              )}
              {model === 'bm25' && (
                <>
                  <td>{t.tf}</td>
                  <td>{t.df}</td>
                  <td>{fmt(t.idf)}</td>
                  <td>{fmt(t.length_norm)}</td>
                  <td>{fmt(t.contribution)}</td>
                </>
              )}
              {model === 'bm25f' && (
                <>
                  <td>
                    {Object.entries(t.fields ?? {})
                      .map(([f, n]) => `${f}×${n}`)
                      .join(', ')}
                  </td>
                  <td>{fmt(t.idf)}</td>
                  <td>{fmt(t.weighted_tf)}</td>
                  <td>{fmt(t.contribution)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={columns.length - 1}>score = sum of the last column</td>
            <td>{fmt(hit.score ?? undefined)}</td>
          </tr>
        </tfoot>
      </table>
      <p className={styles.evidenceNote}>
        {model === 'bim' || model === 'bim_feedback'
          ? 'BIM only asks whether each word is present. Words in more than half the guides get a negative weight — they count as evidence against relevance.'
          : model === 'bm25'
            ? 'Length norm above 1 means a longer-than-average guide, which shrinks every match it has.'
            : 'Each field’s count is weighted (name 3, mistakes 1.5, tags 1.5, benefits 1.2, overview 1, steps 0.8, cautions 0.6) and length-normalised, then summed before saturating.'}
      </p>
    </div>
  );
}

/* ── Compare ────────────────────────────────────────────────────────────── */

function CompareView() {
  const [text, setText] = useState(EXAMPLES[0].text);
  const [boolean, setBoolean] = useState(EXAMPLES[0].boolean);
  const { data, error, loading, run } = useRequest<CompareResponse>();

  const submit = useCallback(
    (t: string, b: string) => {
      if (t.trim()) run(() => searchApi.compare(t, b.trim() || undefined));
    },
    [run]
  );

  useEffect(() => {
    submit(EXAMPLES[0].text, EXAMPLES[0].boolean);
  }, [submit]);

  return (
    <section>
      <p className={styles.blurb}>
        One information need, every model. The Boolean column receives the expression; the ranked
        models receive the plain words.
      </p>
      <Chips
        items={EXAMPLES.map((e) => ({ label: e.text, hint: e.from === 'coach' ? 'coach' : undefined }))}
        onPick={(i) => {
          setText(EXAMPLES[i].text);
          setBoolean(EXAMPLES[i].boolean);
          submit(EXAMPLES[i].text, EXAMPLES[i].boolean);
        }}
      />
      <form
        className={styles.compareForm}
        onSubmit={(e) => {
          e.preventDefault();
          submit(text, boolean);
        }}
      >
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Words (ranked models)</span>
          <input className={styles.input} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Boolean expression</span>
          <input className={styles.input} value={boolean} onChange={(e) => setBoolean(e.target.value)} />
        </label>
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? 'Comparing…' : 'Compare'}
        </button>
      </form>

      {error && <p className={styles.error}>{error}</p>}

      {data && (
        <div className={styles.compareGrid}>
          {data.models.map((m) => (
            <div key={m.model} className={styles.column}>
              <h3 className={styles.columnTitle}>{MODEL_LABELS[m.model]}</h3>
              <p className={styles.columnMeta}>{m.ranked ? `${m.total} ranked` : `${m.total} matched, unordered`}</p>
              <ol className={styles.columnList}>
                {m.results.map((hit, i) => (
                  <li key={hit.doc.id} className={styles.columnItem}>
                    <span className={styles.columnRank}>{m.ranked ? i + 1 : '•'}</span>
                    <span className={styles.columnName}>{hit.doc.name}</span>
                    {hit.score !== null && <span className={styles.columnScore}>{hit.score.toFixed(2)}</span>}
                  </li>
                ))}
                {m.results.length === 0 && <li className={styles.columnEmpty}>Nothing</li>}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Structured ─────────────────────────────────────────────────────────── */

function StructuredView() {
  const [query, setQuery] = useState(STRUCTURED_EXAMPLES[0]);
  const { data, error, loading, run } = useRequest<StructuredResponse>();

  const submit = useCallback((q: string) => q.trim() && run(() => searchApi.structured(q)), [run]);

  useEffect(() => {
    submit(STRUCTURED_EXAMPLES[0]);
  }, [submit]);

  return (
    <section>
      <div className={styles.explain}>
        <p>
          <strong>Non-overlapped lists.</strong> Each guide is cut into regions three ways —{' '}
          <code className={styles.code}>section</code> (name, tags, overview, steps, benefits, cautions,
          mistakes), <code className={styles.code}>fault</code> (a mistake with its correction) and{' '}
          <code className={styles.code}>sentence</code>. Regions in one list never overlap; across lists
          they nest. Ask with <code className={styles.code}>region CONTAINING words [WITHIN region]</code>.
        </p>
        <p>
          <strong>Overlapped lists.</strong> <code className={styles.code}>a ... b</code> builds new
          regions from every <em>a</em> to a later <em>b</em>. Those regions can overlap each other, which
          a non-overlapped list cannot express; the shortest ones are marked.
        </p>
      </div>

      <QueryBar
        label="Structured query"
        value={query}
        onChange={setQuery}
        onSubmit={() => submit(query)}
        placeholder="cautions CONTAINING knee"
        loading={loading}
      />
      <Chips
        items={STRUCTURED_EXAMPLES.map((label) => ({ label }))}
        onPick={(i) => {
          setQuery(STRUCTURED_EXAMPLES[i]);
          submit(STRUCTURED_EXAMPLES[i]);
        }}
      />

      {error && <p className={styles.error}>{error}</p>}

      {data && (
        <>
          <div className={styles.statRow}>
            <span>
              <strong>{data.model === 'overlapped' ? 'Overlapped lists' : 'Non-overlapped lists'}</strong>
            </span>
            <span>
              <code className={styles.code}>{data.expression}</code>
            </span>
            <span>{data.total_regions} regions in {data.documents.length} guides</span>
            {data.model === 'overlapped' && (
              <>
                <span>{data.overlapping_pairs} overlapping pairs</span>
                <span>{data.shortest_regions} shortest</span>
              </>
            )}
          </div>
          <ol className={styles.results}>
            {data.documents.map(({ doc, regions }) => (
              <li key={doc.id} className={styles.card}>
                <div className={styles.cardHead}>
                  <GuideTitle doc={doc} />
                  <span className={styles.score}>{regions.length}×</span>
                </div>
                <ul className={styles.regions}>
                  {regions.map((r) => (
                    <li
                      key={`${r.start}-${r.end}`}
                      className={`${styles.region} ${r.label === 'overlapping' ? styles.regionOverlap : ''}`}
                    >
                      <span className={styles.regionTag}>
                        {r.list}:{r.label} [{r.start}–{r.end}]
                      </span>
                      <span>
                        <Highlight text={r.text} terms={data.terms} />
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

/* ── Evaluation ─────────────────────────────────────────────────────────── */

const METRICS: MetricKey[] = ['P@3', 'P@5', 'R@5', 'MAP', 'MRR'];

function EvaluationView() {
  const { data, error, loading, run } = useRequest<BenchmarkResponse>();

  useEffect(() => {
    run(() => searchApi.benchmarks());
  }, [run]);

  if (loading && !data) return <p className={styles.meta}>Scoring every model…</p>;
  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return null;

  const models = Object.keys(data.summary);
  const best = (key: MetricKey) =>
    Math.max(...models.filter((m) => m !== 'Boolean').map((m) => data.summary[m][key]));

  return (
    <section>
      <p className={styles.blurb}>
        Five queries from real FitSync situations, each with a hand-made list of the guides that
        actually answer it. Higher is better on every metric.
      </p>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Model</th>
              {METRICS.map((m) => (
                <th key={m}>{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m}>
                <td className={styles.termCell}>
                  {m}
                  {m === 'Boolean' ? ' *' : ''}
                </td>
                {METRICS.map((k) => (
                  <td key={k} className={m !== 'Boolean' && data.summary[m][k] === best(k) ? styles.best : undefined}>
                    {data.summary[m][k].toFixed(3)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.evidenceNote}>
        * Boolean returns an unordered set, so its ranked scores depend on arbitrary order. Its set
        precision and recall are shown per query below.
      </p>

      <div className={styles.queryList}>
        {data.queries.map((q) => (
          <div key={q.id} className={styles.card}>
            <div className={styles.queryHead}>
              <span className={styles.rank}>{q.id}</span>
              <div>
                <div className={styles.guideName}>“{q.text}”</div>
                <div className={styles.guideSanskrit}>{q.source}</div>
              </div>
            </div>
            <p className={styles.meta}>
              Relevant: {q.relevant.join(', ')} · Boolean <code className={styles.code}>{q.boolean}</code>{' '}
              → P {q.boolean_set.precision.toFixed(2)}, R {q.boolean_set.recall.toFixed(2)}
            </p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Top 3</th>
                    <th>P@3</th>
                    <th>AP</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m) => (
                    <tr key={m}>
                      <td className={styles.termCell}>{m}</td>
                      <td className={styles.topCell}>
                        {q.rankings[m].slice(0, 3).map((slug) => (
                          <span key={slug} className={q.relevant.includes(slug) ? styles.hit : styles.miss}>
                            {slug}
                          </span>
                        ))}
                        {q.rankings[m].length === 0 && <span className={styles.miss}>nothing</span>}
                      </td>
                      <td>{q.metrics[m]['P@3'].toFixed(2)}</td>
                      <td>{q.metrics[m]['AP'].toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
