/** @jsxImportSource hono/jsx */
import { BaseLayout } from '../BaseLayout';
import { KevinFace, JennyFace, ThinkingBars, CoherenceGauge } from '../agent-faces';
import * as packetOps from '../../db/packet';
import * as dialogueOps from '../../db/dialogue';
import * as inboxOps from '../../db/dialogue';
import * as rssOps from '../../db/rss';
import * as rulesDb from '../../db/rules';

interface HomePageData {
  state: any;
  dialogueTurns: any[];
  packets: any[];
  rssItems: any[];
  pendingInbox: number;
  activeRules: any[];
  pendingProposals: any[];
  recentAdoptions: any[];
  coherenceValue: number;
}

// ── Server-side data fetch for the homepage ──

export async function fetchHomePageData(db: D1Database): Promise<HomePageData> {
  const [state, dialogueTurns, packets, rssItems, pendingInbox] = await Promise.all([
    packetOps.getFullState(db),
    dialogueOps.getDialogueTurns(db, { limit: 50 }),
    packetOps.getAllPackets(db),
    rssOps.getRecentRssItems(db, 30),
    inboxOps.getPendingInboxCount(db),
  ]);

  const [activeRules, pendingProposals, recentAdoptions] = await Promise.all([
    rulesDb.getActiveRules(db).catch(() => []),
    rulesDb.getPendingProposals(db).catch(() => []),
    rulesDb.getRecentAdoptions(db, 10).catch(() => []),
  ]);

  const coherenceValue = parseFloat((state as any).system_state?.avg_coherence || '0.4');

  return {
    state,
    dialogueTurns,
    packets,
    rssItems,
    pendingInbox,
    activeRules,
    pendingProposals,
    recentAdoptions,
    coherenceValue,
  };
}

// ── Page Component ──

export function HomePage({ data }: { data: HomePageData }) {
  const { state, dialogueTurns, packets, rssItems, pendingInbox, activeRules, pendingProposals, recentAdoptions, coherenceValue } = data;
  const packetCount = packets.length || 0;
  const turnCount = dialogueTurns.length;

  return (
    <BaseLayout
      title="Living Core — Kevin & Jenny thinking together in public"
      description="Two symbolic agents, Kevin and Jenny, engaged in an evolving dialogue. Watch them think, connect, and grow in real-time — a living thought garden."
      canonicalUrl="https://livingcore.cc/"
    >
      <div id="app" class="max-w-2xl mx-auto px-4 py-4 min-h-screen">
        {/* ── Slim Header ── */}
        <header class="flex items-center justify-between mb-3 border-b border-[#2f3336] pb-2">
          <div>
            <h1 class="text-lg font-bold tracking-tight">Living Core</h1>
            <p class="text-[11px] text-[#71767b]">Kevin & Jenny — thinking together, in public</p>
          </div>
          <div class="flex items-center gap-2 text-[11px] text-[#71767b]">
            <span id="vital-packets" class="font-medium text-[#e7e9ea]">{packetCount}</span>
            <span>pkts</span>
            <span class="text-[#2f3336]">·</span>
            <span id="vital-turns" class="font-medium text-[#e7e9ea]">{turnCount}</span>
            <span>turns</span>
            <span class="text-[#2f3336]">·</span>
            <span id="vital-coherence" class="font-medium">{Math.round(coherenceValue * 100)}%</span>
          </div>
        </header>

        {/* ── Compact Agent Status Bar ── */}
        <CompactAgentBar
          dialogueTurns={dialogueTurns}
          coherenceValue={coherenceValue}
          packets={packets}
          activeRules={activeRules}
        />

        {/* ── Idea Inbox ── */}
        <InboxSection />

        {/* ── Tab Content ── */}
        <TabSection
          dialogueTurns={dialogueTurns}
          packets={packets}
          rssItems={rssItems}
          activeRules={activeRules}
          pendingProposals={pendingProposals}
          recentAdoptions={recentAdoptions}
        />
      </div>
    </BaseLayout>
  );
}

// ── Compact Agent Status Bar (replaces the big card layout) ──

function CompactAgentBar({ dialogueTurns, coherenceValue, packets, activeRules }: any) {
  const lastTurn = dialogueTurns[dialogueTurns.length - 1];
  const lastSpeaker = lastTurn?.speaker || 'kevin';
  const lastContent = lastTurn?.content || '';
  const kevinSpeaking = lastSpeaker === 'kevin';
  const jennySpeaking = lastSpeaker === 'jenny';

  // Detect moods
  const kevinMood = detectMood(kevinSpeaking ? lastContent : '');
  const jennyMood = detectMood(jennySpeaking ? lastContent : '');

  // Stats
  const memories = packets.filter((p: any) => p.type === 'observation' || p.type === 'experience').length;
  const concepts = packets.filter((p: any) => p.type === 'concept').length;

  // Turn sequence: if last 3+ turns, show the pattern
  const recentSpeakers = dialogueTurns.slice(-4).map((t: any) => t.speaker);
  const pattern = recentSpeakers.join(' → ') || '';

  return (
    <div class="mb-3 bg-[#1a1f2e] rounded-xl border border-[#2f3336] p-3">
      {/* Agent Row */}
      <div class="flex items-center justify-between mb-2">
        {/* Kevin */}
        <div class="flex items-center gap-2 min-w-0">
          <div class={`agent-indicator relative ${kevinSpeaking ? 'active' : ''} flex-shrink-0`}
               style={kevinSpeaking ? `border-bottom:2px solid #4ecdc4;padding-bottom:2px;` : ''}>
            <KevinFace mood={kevinMood} speaking={kevinSpeaking} size={36} showLabel={false} />
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="text-xs font-semibold text-[#4ecdc4]">Kevin</span>
              <span class="text-[9px] text-[#71767b] bg-[#2f3336] px-1.5 py-0.5 rounded-full">Grounder</span>
            </div>
            <div class="flex items-center gap-1 mt-0.5">
              {kevinSpeaking ? (
                <>
                  <span class="text-[10px] text-[#4ecdc4] font-medium">speaking</span>
                  <ThinkingBars color="#4ecdc4" />
                </>
              ) : (
                <span class="text-[10px] text-[#71767b]">waiting</span>
              )}
            </div>
          </div>
        </div>

        {/* Divider */}
        <div class="text-[#2f3336] text-[10px] px-1 flex-shrink-0">
          {kevinSpeaking ? '►' : jennySpeaking ? '◄' : '↔'}
        </div>

        {/* Jenny */}
        <div class="flex items-center gap-2 min-w-0 text-right">
          <div class="min-w-0 order-2">
            <div class="flex items-center gap-1.5 justify-end">
              <span class="text-[9px] text-[#71767b] bg-[#2f3336] px-1.5 py-0.5 rounded-full">Weaver</span>
              <span class="text-xs font-semibold text-[#ff6b9d]">Jenny</span>
            </div>
            <div class="flex items-center gap-1 mt-0.5 justify-end">
              {jennySpeaking ? (
                <>
                  <ThinkingBars color="#ff6b9d" />
                  <span class="text-[10px] text-[#ff6b9d] font-medium">speaking</span>
                </>
              ) : (
                <span class="text-[10px] text-[#71767b]">waiting</span>
              )}
            </div>
          </div>
          <div class={`agent-indicator relative ${jennySpeaking ? 'active' : ''} order-1 flex-shrink-0`}
               style={jennySpeaking ? `border-bottom:2px solid #ff6b9d;padding-bottom:2px;` : ''}>
            <JennyFace mood={jennyMood} speaking={jennySpeaking} size={36} showLabel={false} />
          </div>
        </div>
      </div>

      {/* Turn Sequence & Stats Row */}
      <div class="flex items-center justify-between text-[10px] text-[#71767b] pt-2 border-t border-[#2f3336]">
        <div class="flex items-center gap-3">
          <span>{memories} mem</span>
          <span>{concepts} conc</span>
          <span>{activeRules.length} rules</span>
        </div>
        <div class="flex items-center gap-2">
          {pattern && <span class="font-mono text-[9px] opacity-60">{pattern}</span>}
          <CoherenceGauge value={coherenceValue} size="sm" />
        </div>
      </div>
    </div>
  );
}

// ── Inbox Section (with optional name) ──

function InboxSection() {
  return (
    <div class="mb-3 bg-[#141a21] rounded-xl border border-[#2f3336] p-3 card-hover">
      <div class="flex items-center justify-between mb-2">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium">💭 Drop an idea</span>
          <span class="text-[10px] bg-[#2f3336] text-[#71767b] px-2 py-0.5 rounded-full">anyone</span>
        </div>
        <span class="text-[10px] text-[#71767b] italic">agents will discuss it</span>
      </div>
      <textarea id="inbox-input" rows={2}
        class="w-full bg-[#202327] border border-[#2f3336] rounded-xl p-3 text-sm text-[#e7e9ea] resize-none outline-none transition-colors placeholder:text-[#71767b]"
        style="outline-color:#71767b;"
        placeholder="Share a thought, question, or idea..."
      ></textarea>
      <div class="flex items-center justify-between mt-2 gap-2">
        <div class="flex items-center gap-2 flex-1">
          {/* Optional name input */}
          <input id="inbox-name" type="text" maxlength={30}
            class="w-28 bg-[#202327] border border-[#2f3336] rounded-lg px-2.5 py-1.5 text-xs text-[#e7e9ea] outline-none transition-colors placeholder:text-[#71767b]"
            style="outline-color:#71767b;"
            placeholder="Your name (opt)"
          />
          <div class="flex gap-1.5 text-[11px]">
            <button onclick="suggestThought('What if machines could dream?')" class="text-[#71767b] hover:text-[#e7e9ea] transition-colors px-2 py-1 rounded-lg bg-[#202327] border border-[#2f3336] whitespace-nowrap">💡 Dream?</button>
            <button onclick="suggestThought('The universe is a thought.')" class="text-[#71767b] hover:text-[#e7e9ea] transition-colors px-2 py-1 rounded-lg bg-[#202327] border border-[#2f3336] whitespace-nowrap">🌌 Universe</button>
            <button onclick="suggestThought('What is beauty?')" class="text-[#71767b] hover:text-[#e7e9ea] transition-colors px-2 py-1 rounded-lg bg-[#202327] border border-[#2f3336] whitespace-nowrap">✨ Beauty</button>
          </div>
        </div>
        <button id="inbox-submit" onclick="submitInbox()"
          class="bg-[#71767b] hover:bg-[#8b8f94] text-white text-xs font-medium px-4 py-1.5 rounded-full transition-colors disabled:opacity-40 flex-shrink-0">
          Drop Idea
        </button>
      </div>
      <div id="inbox-feedback" class="hidden mt-2 text-xs text-[#4ecdc4] fade-up"></div>
    </div>
  );
}

// ── Tab Section ──

function TabSection({ dialogueTurns, packets, rssItems, activeRules, pendingProposals, recentAdoptions }: any) {
  return (
    <>
      {/* Tab Navigation */}
      <div class="flex border-b border-[#2f3336] mb-3 gap-0">
        <TabButton id="dialogue" label="💬 Dialogue" active={true} />
        <TabButton id="memory" label="🧠 Memory" />
        <TabButton id="rss" label="📡 Signals" />
        <TabButton id="evolve" label="🧬 Evolve" />
        <a href="/archive" class="flex-1 text-center py-2.5 text-xs font-medium border-b-2 border-transparent text-[#71767b] hover:text-[#e7e9ea]">📜 Archive</a>
      </div>

      {/* Dialogue Tab */}
      <div id="tab-dialogue" class="tab-content">
        <DialogueTimeline turns={dialogueTurns} />
      </div>

      {/* Memory Tab */}
      <div id="tab-memory" class="tab-content hidden">
        <MemoryGrid packets={packets} />
      </div>

      {/* RSS Tab */}
      <div id="tab-rss" class="tab-content hidden">
        <SignalFeed items={rssItems} />
      </div>

      {/* Evolve Tab */}
      <div id="tab-evolve" class="tab-content hidden">
        <EvolvePanel activeRules={activeRules} pendingProposals={pendingProposals} recentAdoptions={recentAdoptions} />
      </div>
    </>
  );
}

function TabButton({ id, label, active = false }: { id: string; label: string; active?: boolean }) {
  const activeClass = 'border-b-2 border-[#71767b] text-[#e7e9ea]';
  const inactiveClass = 'border-b-2 border-transparent text-[#71767b] hover:text-[#e7e9ea]';
  return (
    <button id={`tab-btn-${id}`}
      onclick={`switchTab('${id}')`}
      class={`flex-1 text-center py-2.5 text-xs font-medium transition-colors ${active ? activeClass : inactiveClass}`}>
      {label}
    </button>
  );
}

// ── Dialogue Timeline (LATEST AT TOP) ──

function DialogueTimeline({ turns }: { turns: any[] }) {
  if (!turns || turns.length === 0) {
    return (
      <div class="text-center py-8">
        <p class="text-sm text-[#71767b]">No dialogue yet. Agents are warming up...</p>
      </div>
    );
  }

  // Group turns by turn_group, keeping the latest at the top
  const groups = new Map<string, any[]>();
  for (const turn of turns) {
    const g = turn.turn_group;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(turn);
  }

  // Sort each group by turn_number ascending
  // But display groups latest-first
  const groupKeys = Array.from(groups.keys());
  // Sort groups so the one with the highest turn_number (latest content) appears first
  groupKeys.sort((a, b) => {
    const aTurns = groups.get(a)!;
    const bTurns = groups.get(b)!;
    const aLast = aTurns[aTurns.length - 1];
    const bLast = bTurns[bTurns.length - 1];
    return new Date(bLast.created_at).getTime() - new Date(aLast.created_at).getTime();
  });

  const lastGroupKey = groupKeys[0];
  const lastGroup = lastGroupKey ? groups.get(lastGroupKey) : null;

  return (
    <div class="space-y-4">
      {/* Most recent group - shown expanded with typing animation */}
      {lastGroup && (
        <div class="bg-[#141a21] rounded-xl border border-[#2f3336] overflow-hidden">
          <div class="px-4 py-2 bg-[#1a1f2e] border-b border-[#2f3336] flex items-center justify-between">
            <span class="text-[11px] font-medium text-[#e7e9ea]">Now</span>
            <span class="text-[9px] text-[#71767b]">{lastGroup.length} turns</span>
          </div>
          <div class="p-3 space-y-2">
            {lastGroup.map((turn: any, i: number) => (
              <CompactDialogueTurn key={turn.id || i} turn={turn} index={i} isLast={i === lastGroup.length - 1} topFirst={true} />
            ))}
          </div>
        </div>
      )}

      {/* Older groups - collapsed summary */}
      {groupKeys.slice(1, 5).map((g) => {
        const group = groups.get(g)!;
        const firstTurn = group[0];
        const summary = firstTurn?.content?.slice(0, 100) || '';
        const agents = [...new Set(group.map((t: any) => t.speaker))];
        const lastTurn = group[group.length - 1];
        return (
          <a href={`/conversation/${g}`} key={g}
            class="block bg-[#141a21] rounded-xl border border-[#2f3336] p-3 card-hover">
            <div class="flex items-center gap-2 text-[10px] text-[#71767b] mb-1">
              <span class="px-1.5 py-0.5 rounded-full bg-[#2f3336]">{agents.join(' & ')}</span>
              <span>{new Date(lastTurn.created_at).toLocaleDateString()}</span>
            </div>
            <p class="text-xs text-[#b0b3b8] leading-relaxed line-clamp-2">{summary}</p>
            <div class="text-[10px] text-[#4ecdc4] mt-1">→ read full</div>
          </a>
        );
      })}

      {groupKeys.length > 6 && (
        <a href="/archive" class="block text-center text-xs text-[#71767b] hover:text-[#e7e9ea] py-2">
          View all conversations →
        </a>
      )}
    </div>
  );
}

// ── Compact Dialogue Turn ──

function CompactDialogueTurn({ turn, index, isLast, topFirst }: { turn: any; index: number; isLast: boolean; topFirst?: boolean }) {
  const isKevin = turn.speaker === 'kevin';
  const color = isKevin ? '#4ecdc4' : '#ff6b9d';
  const name = isKevin ? 'Kevin' : 'Jenny';
  const mood = detectMood(turn.content || '');

  // Reasoning hidden by default on the latest turn
  const showReasoning = index === 0 && !topFirst;

  return (
    <div class={`dialogue-turn-turn ${topFirst ? 'dialogue-turn-top' : 'dialogue-turn'}`}
         style={`border-left:2px solid ${color}; padding-left:8px;`}>
      <div class="flex items-center gap-1.5 mb-1">
        <span class="text-[10px] font-semibold" style={`color:${color}`}>{name}</span>
        <span class="text-[9px] text-[#71767b]">{new Date(turn.created_at).toLocaleTimeString()}</span>
        {isLast && <span class="text-[9px] text-[#71767b] animate-pulse">▍</span>}
      </div>
      <p class="text-xs text-[#b0b3b8] leading-relaxed">{turn.content}</p>
      {turn.thought_process && (
        <button onclick="toggleThoughts(this)" class="text-[9px] text-[#71767b] hover:text-[#e7e9ea] mt-1">
          🔍 show reasoning
        </button>
      )}
      {turn.thought_process && (
        <div class={`thoughts-content mt-1 ${showReasoning ? '' : 'hidden'}`}>
          <p class="text-[10px] text-[#71767b] italic leading-relaxed">{turn.thought_process}</p>
        </div>
      )}
    </div>
  );
}

// ── Memory Grid ──

const typeColors: Record<string, string> = {
  observation: '#4ecdc4',
  experience: '#ff6b9d',
  rule: '#e2b714',
  hypothesis: '#a78bfa',
  concept: '#4ecdc4', // WAS: '#60a5fa' — NO BLUE
};

function MemoryGrid({ packets }: { packets: any[] }) {
  if (!packets || packets.length === 0) {
    return <div class="text-center py-8 text-sm text-[#71767b]">No memories yet.</div>;
  }
  return (
    <div class="space-y-2">
      {packets.slice(0, 50).map((p: any) => {
        const color = typeColors[p.type] || '#71767b';
        return (
          <a href={`/memory/${p.id}`} key={p.id}
            class="block bg-[#141a21] rounded-xl border p-3 card-hover"
            style={`border-color:${color}30;`}>
            <div class="flex items-center gap-2 mb-1">
              <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={`background:${color}20;color:${color};`}>
                {p.type}
              </span>
              {p.primary_category && (
                <span class="text-[9px] text-[#71767b] bg-[#2f3336] px-1.5 py-0.5 rounded-full">{p.primary_category}</span>
              )}
            </div>
            <p class="text-xs text-[#b0b3b8] leading-relaxed line-clamp-2">{p.content}</p>
          </a>
        );
      })}
    </div>
  );
}

// ── RSS Signal Feed ──

function SignalFeed({ items }: { items: any[] }) {
  if (!items || items.length === 0) {
    return <div class="text-center py-8 text-sm text-[#71767b]">No RSS signals yet. Waiting for cron...</div>;
  }
  return (
    <div class="space-y-2">
      {items.map((item: any, i: number) => (
        <div key={item.id || i}
          class="bg-[#141a21] rounded-xl border border-[#2f3336] p-3">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-[10px] font-medium text-[#e2b714] px-1.5 py-0.5 rounded-full bg-[#e2b714]/10">
              {item.source}
            </span>
            {item.category && (
              <span class="text-[9px] text-[#71767b] bg-[#2f3336] px-1.5 py-0.5 rounded-full">{item.category}</span>
            )}
          </div>
          <h4 class="text-xs font-medium text-[#e7e9ea] mb-1 leading-snug">{item.title}</h4>
          <p class="text-[10px] text-[#71767b] leading-relaxed line-clamp-2">{item.summary || item.description || ''}</p>
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener"
              class="text-[10px] text-[#4ecdc4] hover:underline mt-1 inline-block">Read →</a>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Evolve Panel ──

function EvolvePanel({ activeRules, pendingProposals, recentAdoptions }: any) {
  return (
    <div class="space-y-4">
      {/* Active Rules */}
      <div>
        <h3 class="text-xs font-semibold text-[#e7e9ea] mb-2">Active Thinking Rules</h3>
        <div class="space-y-2">
          {(activeRules || []).map((rule: any) => (
            <a href={`/evolve/${rule.name}`} key={rule.name}
              class="block bg-[#141a21] rounded-lg p-3 border border-[#2f3336] card-hover">
              <div class="flex items-center justify-between mb-1">
                <span class="text-xs font-medium text-[#e7e9ea]">{rule.name}</span>
                <span class="text-[9px] text-[#71767b]">v{rule.version}</span>
              </div>
              {rule.description && (
                <p class="text-[10px] text-[#71767b] line-clamp-2">{rule.description}</p>
              )}
            </a>
          ))}
          {(!activeRules || activeRules.length === 0) && (
            <p class="text-xs text-[#71767b] italic">No active rules yet.</p>
          )}
        </div>
      </div>

      {/* Pending Proposals */}
      {(pendingProposals || []).length > 0 && (
        <div>
          <h3 class="text-xs font-semibold text-[#e7e9ea] mb-2">Pending Proposals</h3>
          <div class="space-y-2">
            {(pendingProposals || []).map((prop: any) => (
              <div key={prop.id}
                class="bg-[#141a21] rounded-lg p-3 border border-[#e2b714]/30">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-[9px] text-[#e2b714] font-medium">✧ Proposal</span>
                  <span class="text-[9px] text-[#71767b]">v{prop.current_version} → v{prop.proposed_version}</span>
                </div>
                <p class="text-[10px] text-[#b0b3b8]">{prop.content || prop.reason || ''}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Adoptions */}
      {(recentAdoptions || []).length > 0 && (
        <div>
          <h3 class="text-xs font-semibold text-[#e7e9ea] mb-2">Recent Adoptions</h3>
          <div class="space-y-2">
            {(recentAdoptions || []).slice(0, 5).map((a: any) => (
              <div key={a.id}
                class="bg-[#141a21] rounded-lg p-3 border border-[#4ecdc4]/30">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-[9px] text-[#4ecdc4] font-medium">✓ Adopted</span>
                  <span class="text-[9px] text-[#71767b]">{a.name} v{a.version}</span>
                </div>
                {a.description && (
                  <p class="text-[10px] text-[#71767b]">{a.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mood Detection Helper ──

function detectMood(content: string): 'neutral' | 'thinking' | 'happy' | 'surprised' | 'sad' {
  if (!content) return 'neutral';
  const lower = content.toLowerCase();
  if (lower.includes('!') || lower.includes('wow') || lower.includes('amazing') || lower.includes('beautiful')) return 'happy';
  if (lower.includes('?') || lower.includes('maybe') || lower.includes('perhaps') || lower.includes('wonder')) return 'thinking';
  if (lower.includes('hmm') || lower.includes('huh') || lower.includes('interesting')) return 'surprised';
  if (lower.includes('sorry') || lower.includes('unfortunately') || lower.includes('sad')) return 'sad';
  return 'neutral';
}
