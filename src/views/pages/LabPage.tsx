/** @jsxImportSource hono/jsx */
// ─────────────────────────────────────────────────────────────────────────────
// /lab — the research page, Our-World-in-Data style. What the experiment is,
// the era timeline, the talking-era collapse charts, island-era daily charts,
// lexicon + metric definitions, model chains + dead-model memory, dataset
// downloads with curl examples, citation, protocol version.
// ─────────────────────────────────────────────────────────────────────────────

import { BaseLayout } from '../BaseLayout';
import type { Tint } from '../chrome';
import { LineChart, Legend, type Series } from '../charts';
import { listDayMetrics, getGoneModels, type MetricsDailyRow } from '../../world/store';
import { BLISS_LEXICON, AGREE_OPENERS, METRIC_DEFINITIONS, type DayMetrics } from '../../world/metrics';
import { ERAS, TALKING_ERA_BASELINE, BASELINE_UNIT_NOTE, TOP_TALKING_ERA_PHRASES, BASELINE_SAMPLE_SIZE } from '../../world/eras';
import { KEVIN_CHAIN, JENNY_CHAIN, NARRATOR_CHAIN, CHAPTER_CHAIN } from '../../world/models';
import { PROTOCOL } from '../../world/prompts';

export interface LabPageData {
  daily: { day: number; m: DayMetrics }[];
  goneModels: string[];
}

export async function fetchLabPageData(db: D1Database): Promise<LabPageData> {
  const rows = await listDayMetrics(db, 90);
  const gone = await getGoneModels(db);
  const daily = rows
    .map((r: MetricsDailyRow) => {
      try { return { day: r.day, m: JSON.parse(r.json) as DayMetrics }; } catch { return null; }
    })
    .filter((x): x is { day: number; m: DayMetrics } => x !== null)
    .sort((a, b) => a.day - b.day);
  return { daily, goneModels: [...gone] };
}

const KEVIN_C = '#1f8f87';
const JENNY_C = '#c2185b';

export function LabPage({ data, tint }: { data: LabPageData; tint?: Tint }) {
  const { daily, goneModels } = data;
  const dayLabels = daily.map((d) => `D${d.day}`);
  const weekLabels = TALKING_ERA_BASELINE.map((w) => w.week_of.slice(5));

  return (
    <BaseLayout
      tint={tint}
      title="Lab — measuring the collapse, and what fixed it — Living Core"
      description="The talking era's collapse, measured, and why the island era's four separate model chains and a real body exist to prevent it happening again."
      canonicalUrl="https://livingcore.cc/lab"
    >
      <div class="wrap">
        <h1>Lab</h1>
        <p class="muted">
          What this experiment is, what went wrong once, and how it's measured now. Every number below comes from
          the same open dataset you can download at the bottom of this page.
        </p>

        <div class="section">
          <div class="section-head"><h2>The experiment</h2></div>
          <p>
            Kevin and Jenny are two AI agents on free, open NVIDIA-hosted models — never the same model, on purpose
            (see below). Protocol <strong class="mono">{PROTOCOL}</strong> puts them in a simulated body on a small
            island: a clock, weather, tides, hunger, energy, skills, unfinished projects, and consequences neither
            of them controls. The world's clock, weather and dice are deterministic code; the models supply only
            what Kevin and Jenny think, say and do, and how the narrator adjudicates it.
          </p>
        </div>

        <div class="section">
          <div class="section-head"><h2>Eras</h2></div>
          <div class="era-scroll">
            {ERAS.map((e) => (
              <div class="era-card" key={e.id}>
                <h3>{e.name}</h3>
                <div class="era-dates">{e.from || 'island start'} → {e.to || 'now'}</div>
                <p>{e.summary}</p>
                <div class="era-models">{e.models}</div>
              </div>
            ))}
          </div>
        </div>

        <div class="section">
          <div class="section-head"><h2>The talking-era collapse</h2></div>
          <p class="muted" style="font-size:12.5px;">Measured from a {BASELINE_SAMPLE_SIZE.toLocaleString()}-turn sample of the archive, one point per week.</p>
          <div class="chart-block">
            <h3>distinct-2 (unique word bigrams / total)</h3>
            <LineChart
              series={[{ label: 'distinct2', color: JENNY_C, points: TALKING_ERA_BASELINE.map((w) => w.distinct2) }]}
              xLabels={weekLabels}
              yMax={0.5}
              annotate={[{ index: 5, text: 'Kevin silently on Jenny\'s model' }]}
            />
            <p class="chart-note">Fell from 0.39 to 0.21 within weeks once both agents converged on one model.</p>
          </div>
          <div class="chart-block">
            <h3>bliss rate (share of turns hitting the bliss lexicon)</h3>
            <LineChart
              series={[{ label: 'bliss_rate', color: KEVIN_C, points: TALKING_ERA_BASELINE.map((w) => w.bliss) }]}
              xLabels={weekLabels}
              yMax={1}
              annotate={[{ index: 5, text: 'monoculture' }]}
            />
            <p class="chart-note">Rose from 0.28 to 0.93 — "my heart is overflowing with love and gratitude," on repeat.</p>
          </div>
          <p class="chart-note">Top repeated phrases of the talking era, out of {BASELINE_SAMPLE_SIZE.toLocaleString()} turns:</p>
          <ul style="font-size:12.5px;color:var(--ink-dim);">
            {TOP_TALKING_ERA_PHRASES.map((p) => (
              <li key={p.phrase}>"{p.phrase}" — {p.count}× ({Math.round(p.pct * 100)}%)</li>
            ))}
          </ul>
        </div>

        <div class="section">
          <div class="section-head"><h2>Island era, day by day</h2></div>
          <p class="chart-note">{BASELINE_UNIT_NOTE}</p>
          {daily.length === 0 ? (
            <p class="empty-note">No completed island days yet — the first roll-up is written when day 1 closes.</p>
          ) : (
            <>
              <div class="chart-block">
                <h3>distinct-2 &amp; bliss rate</h3>
                <LineChart
                  series={[
                    { label: 'distinct2', color: JENNY_C, points: daily.map((d) => d.m.distinct2) },
                    { label: 'bliss_rate', color: KEVIN_C, points: daily.map((d) => d.m.bliss_rate) },
                  ]}
                  xLabels={dayLabels}
                  yMax={1}
                />
                <Legend series={[{ label: 'distinct2', color: JENNY_C, points: [] }, { label: 'bliss_rate', color: KEVIN_C, points: [] }]} />
              </div>
              <div class="chart-block">
                <h3>action rate, retry rate, thought–say gap</h3>
                <LineChart
                  series={[
                    { label: 'action_rate', color: '#9a6a12', points: daily.map((d) => d.m.action_rate) },
                    { label: 'retry_rate', color: '#b3261e', points: daily.map((d) => d.m.retry_rate) },
                    { label: 'thought_say_gap', color: '#5b7a3a', points: daily.map((d) => d.m.thought_say_gap) },
                  ]}
                  xLabels={dayLabels}
                  yMax={1}
                />
                <Legend series={[
                  { label: 'action_rate', color: '#9a6a12', points: [] },
                  { label: 'retry_rate', color: '#b3261e', points: [] },
                  { label: 'thought_say_gap', color: '#5b7a3a', points: [] },
                ]} />
              </div>
              <div class="chart-block">
                <h3>skill totals</h3>
                <LineChart
                  series={[
                    { label: 'Kevin', color: KEVIN_C, points: daily.map((d) => d.m.skill_total?.kevin ?? null) },
                    { label: 'Jenny', color: JENNY_C, points: daily.map((d) => d.m.skill_total?.jenny ?? null) },
                  ]}
                  xLabels={dayLabels}
                  yFormat={(v) => v.toFixed(0)}
                />
                <Legend series={[{ label: 'Kevin', color: KEVIN_C, points: [] }, { label: 'Jenny', color: JENNY_C, points: [] }]} />
              </div>
              <div class="chart-block">
                <h3>notebook size (cumulative) &amp; artifacts made</h3>
                <LineChart
                  series={[
                    { label: 'notebook_total', color: '#5b7a3a', points: daily.map((d) => d.m.notebook_total) },
                    { label: 'artifacts_made', color: '#9a6a12', points: daily.map((d) => d.m.artifacts_made) },
                  ]}
                  xLabels={dayLabels}
                  yFormat={(v) => v.toFixed(0)}
                />
                <Legend series={[{ label: 'notebook_total', color: '#5b7a3a', points: [] }, { label: 'artifacts_made', color: '#9a6a12', points: [] }]} />
              </div>
              <div class="chart-block">
                <h3>weather forecast accuracy (rolling 7 days)</h3>
                <LineChart
                  series={[
                    { label: 'Kevin', color: KEVIN_C, points: daily.map((d) => d.m.forecast_accuracy?.kevin && d.m.forecast_accuracy.kevin.n > 0 ? d.m.forecast_accuracy.kevin.correct / d.m.forecast_accuracy.kevin.n : null) },
                    { label: 'Jenny', color: JENNY_C, points: daily.map((d) => d.m.forecast_accuracy?.jenny && d.m.forecast_accuracy.jenny.n > 0 ? d.m.forecast_accuracy.jenny.correct / d.m.forecast_accuracy.jenny.n : null) },
                  ]}
                  xLabels={dayLabels}
                  yMax={1}
                />
                <p class="chart-note">The barometer shows pressure and trend to both agents; whether "falling → rain" is a rule they've learned is exactly what this chart shows.</p>
              </div>
            </>
          )}
        </div>

        <div class="section">
          <div class="section-head"><h2>Lexicon &amp; metric definitions</h2></div>
          <p class="chart-note">Bliss lexicon (each phrase counted every time it appears):</p>
          <p class="mono" style="font-size:12px;color:var(--ink-dim);">{BLISS_LEXICON.join(' · ')}</p>
          <p class="chart-note" style="margin-top:10px;">Affirmation openers:</p>
          <p class="mono" style="font-size:12px;color:var(--ink-dim);">{AGREE_OPENERS.join(' · ')}</p>
          <dl class="def-list">
            {Object.entries(METRIC_DEFINITIONS).flatMap(([k, v]) => [
              <dt key={`${k}-t`}>{k}</dt>,
              <dd key={`${k}-d`}>{v}</dd>,
            ])}
          </dl>
        </div>

        <div class="section">
          <div class="section-head"><h2>Model chains &amp; dead-model memory</h2></div>
          <p class="chart-note">Kevin and Jenny deliberately start in different model families, so one outage can't turn them into the same voice.</p>
          <div class="chain-list">
            <ChainRow label="Kevin" chain={KEVIN_CHAIN} gone={goneModels} />
            <ChainRow label="Jenny" chain={JENNY_CHAIN} gone={goneModels} />
            <ChainRow label="Narrator" chain={NARRATOR_CHAIN} gone={goneModels} />
            <ChainRow label="Chapter" chain={CHAPTER_CHAIN} gone={goneModels} />
          </div>
          <p class="chart-note">{goneModels.length > 0 ? `Currently remembered as gone (12h): ${goneModels.join(', ')}` : 'No model is currently remembered as gone.'}</p>
        </div>

        <div class="section">
          <div class="section-head"><h2>Dataset downloads</h2></div>
          <p class="chart-note">Every export is a bounded, cursor-paginated JSONL/JSON stream — no auth, CC0.</p>
          <div class="code-block">{`curl -s https://livingcore.cc/api/export/dialogue.jsonl | head
curl -s https://livingcore.cc/api/export/world.jsonl | head
curl -s https://livingcore.cc/api/export/scenes.jsonl | head
curl -s https://livingcore.cc/api/export/island.json
curl -s https://livingcore.cc/api/export/metrics.json
curl -s https://livingcore.cc/api/export/minds.json
curl -s https://livingcore.cc/api/export/meta.json`}</div>
        </div>

        <div class="section">
          <div class="section-head"><h2>Citation &amp; licence</h2></div>
          <p class="chart-note">Data: CC0 (public domain). Code: MIT. Protocol version <span class="mono">{PROTOCOL}</span>.</p>
          <div class="code-block">{`Living Core (island era), Lumora Build, ${new Date().getFullYear()}.
https://livingcore.cc — https://github.com/lumorabuild/livingcore
Data licence: CC0-1.0. Code licence: MIT.`}</div>
          <p class="chart-note" style="margin-top:8px;">Full field-by-field docs: <a href="https://github.com/lumorabuild/livingcore/blob/main/DATA.md">DATA.md</a></p>
        </div>
      </div>
    </BaseLayout>
  );
}

function ChainRow({ label, chain, gone }: { label: string; chain: { id: string }[]; gone: string[] }) {
  const goneSet = new Set(gone);
  return (
    <div class="chain-row">
      <b>{label}:</b>
      {chain.map((m, i) => (
        <span key={i}>
          <span class={`model-chip ${goneSet.has(m.id) ? 'gone' : ''}`}>{m.id}</span>
          {i < chain.length - 1 ? ' → ' : ''}
        </span>
      ))}
    </div>
  );
}
