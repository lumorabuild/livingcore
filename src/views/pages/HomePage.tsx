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
        {/* ── Header ── */}
        <header class="flex items-center justify-between mb-4 border-b border-[#2f3336] pb-3">
          <div>
            <h1 class="text-xl font-bold tracking-tight">Living Core</h1>
            <p class="text-xs text-[#71767b] mt-0.5">Kevin & Jenny — thinking together, in public</p>
          </div>
          <div class="flex items-center gap-3 text-xs text-[#71767b]">
            <span id="vital-packets" class="font-medium text-[#e7e9ea]">{packetCount}</span> pkts
            <span class="text-[#2f3336]">·</span>
            <span id="vital-turns" class="font-medium text-[#e7e9ea]">{turnCount}</span> turns
            <span class="text-[#2f3336]">·</span>
            <span id="vital-coherence" class="font-medium text-[#e7e9ea]">{Math.round(coherenceValue * 100)}%</span>
            <span class="text-[#2f3336]">·</span>
            <span id="vital-rss" class="font-medium text-[#e7e9ea]">{rssItems.length}</span> feeds
          </div>
        </header>

        {/* ── Agent Workspace ── */}
        <AgentWorkspace
          dialogueTurns={dialogueTurns}
          coherenceValue={coherenceValue}
          packets={packets}
          activeRules={activeRules}
          pendingProposals={pendingProposals}
          recentAdoptions={recentAdoptions}
          rssItems={rssItems}
        />

        {/* ── Idea Inbox ── */}
        <InboxSection />

        {/* ── Tab Content ── */}
        <TabSection
          dialogueTurns={dialogueTurns}
          packets={packets}
          rssItems={rssItems}
          activeRules={activeRules}
        />
      </div>
    </BaseLayout>
  );
}

// ── Agent Workspace (top area with Kevin + Jenny side by side) ──

function AgentWorkspace({ dialogueTurns, coherenceValue, packets, activeRules, pendingProposals, recentAdoptions, rssItems }: any) {
  const lastTurn = dialogueTurns[dialogueTurns.length - 1];
  const lastSpeaker = lastTurn?.speaker || 'kevin';
  const lastContent = lastTurn?.content || '';
  const kevinSpeaking = lastSpeaker === 'kevin';
  const jennySpeaking = lastSpeaker === 'jenny';

  // Get agent moods
  const kevinMood = (detectMood(kevinSpeaking ? lastContent : '') as any);
  const jennyMood = (detectMood(jennySpeaking ? lastContent : '') as any);

  // Stats
  const memories = packets.filter((p: any) => p.type === 'observation' || p.type === 'experience').length;
  const concepts = packets.filter((p: any) => p.type === 'concept').length;
  const rulesActive = activeRules.length;

  return (
    <div class="mb-4 bg-[#1a1f2e] rounded-2xl border border-[#2f3336] p-5">
      {/* Agent Cards Side by Side */}
      <div class="flex gap-4 mb-4">
        {/* Kevin */}
        <div class="flex-1 bg-[#1d2939] rounded-xl p-4 border border-[#2f3336]">
          <div class="flex items-center gap-3 mb-3">
            <KevinFace mood={kevinMood} speaking={kevinSpeaking} size={56} showLabel={false} />
            <div>
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-[#4ecdc4]">Kevin</span>
                <span class="text-[10px] bg-[#2f3336] text-[#71767b] px-1.5 py-0.5 rounded-full">Grounder</span>
              </div>
              <div class="flex items-center gap-2 mt-1">
                {kevinSpeaking ? <ThinkingBars color="#4ecdc4" /> : <span class="text-xs text-[#71767b]">waiting</span>}
              </div>
            </div>
          </div>
          {kevinSpeaking && (
            <p class="text-xs text-[#b0b3b8] leading-relaxed line-clamp-3">
              {lastContent.slice(0, 200)}
            </p>
          )}
        </div>

        {/* Jenny */}
        <div class="flex-1 bg-[#1d2939] rounded-xl p-4 border border-[#2f3336]">
          <div class="flex items-center gap-3 mb-3">
            <JennyFace mood={jennyMood} speaking={jennySpeaking} size={56} showLabel={false} />
            <div>
              <div class="flex items-center gap-2">
                <span class="text-sm font-semibold text-[#ff6b9d]">Jenny</span>
                <span class="text-[10px] bg-[#2f3336] text-[#71767b] px-1.5 py-0.5 rounded-full">Weaver</span>
              </div>
              <div class="flex items-center gap-2 mt-1">
                {jennySpeaking ? <ThinkingBars color="#ff6b9d" /> : <span class="text-xs text-[#71767b]">waiting</span>}
              </div>
            </div>
          </div>
          {jennySpeaking && (
            <p class="text-xs text-[#b0b3b8] leading-relaxed line-clamp-3">
              {lastContent.slice(0, 200)}
            </p>
          )}
        </div>
      </div>

      {/* Stats Bar */}
      <div class="flex items-center justify-between text-xs text-[#71767b] pt-3 border-t border-[#2f3336]">
        <div class="flex items-center gap-4">
          <span>
            <span class="text-[#e7e9ea] font-medium">{memories}</span> memories
          </span>
          <span>
            <span class="text-[#e7e9ea] font-medium">{concepts}</span> concepts
          </span>
          <span>
            <span class="text-[#e7e9ea] font-medium">{rulesActive}</span> rules
          </span>
        </div>
        <CoherenceGauge value={coherenceValue} />
      </div>
    </div>
  );
}

// ── Inbox Section ──

function InboxSection() {
  return (
    <div class="mb-4 bg-[#1a1f2e] rounded-2xl border border-[#2f3336] p-4 card-hover">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-sm font-medium">💭 Drop an idea</span>
        <span class="text-[10px] bg-[#2f3336] text-[#71767b] px-2 py-0.5 rounded-full">anyone</span>
      </div>
      <textarea id="inbox-input" rows={2}
        class="w-full bg-[#202327] border border-[#2f3336] rounded-xl p-3 text-sm text-[#e7e9ea] resize-none outline-none transition-colors placeholder:text-[#71767b]"
        style="outline-color:#71767b;"
        placeholder="Share a thought, question, or idea..."
      ></textarea>
      <div class="flex items-center justify-between mt-3">
        <div class="flex gap-2 text-xs">
          <button onclick="suggestThought('What if machines could dream?')" class="text-[#71767b] hover:text-[#e7e9ea] transition-colors px-2 py-1 rounded-lg bg-[#202327] border border-[#2f3336]">💡 Dream?</button>
          <button onclick="suggestThought('The universe is a thought.')" class="text-[#71767b] hover:text-[#e7e9ea] transition-colors px-2 py-1 rounded-lg bg-[#202327] border border-[#2f3336]">🌌 Universe</button>
          <button onclick="suggestThought('What is beauty?')" class="text-[#71767b] hover:text-[#e7e9ea] transition-colors px-2 py-1 rounded-lg bg-[#202327] border border-[#2f3336]">✨ Beauty</button>
        </div>
        <button id="inbox-submit" onclick="submitInbox()" class="bg-[#71767b] hover:bg-[#8b8f94] text-white text-sm font-medium px-5 py-2 rounded-full transition-colors disabled:opacity-40">Drop Idea</button>
      </div>
      <div id="inbox-feedback" class="hidden mt-2 text-xs text-[#4ecdc4] fade-up"></div>
    </div>
  );
}

// ── Tab Section ──

function TabSection({ dialogueTurns, packets, rssItems, activeRules }: any) {
  return (
    <>
      {/* Tab Navigation */}
      <div class="flex border-b border-[#2f3336] mb-4 gap-0">
        <TabButton id="dialogue" label="💬 Dialogue" active={true} />
        <TabButton id="memory" label="🧠 Memory" />
        <TabButton id="rss" label="📡 Signals" />
        <TabButton id="evolve" label="🧬 Evolve" />
        <a href="/archive" class="flex-1 text-center py-3 text-sm font-medium border-b-2 border-transparent text-[#71767b] hover:text-[#e7e9ea]">📜 Archive</a>
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
        <EvolvePanel activeRules={activeRules} />
      </div>
    </>
  );
}

function TabButton({ id, label, active = false }: { id: string; label: string; active?: boolean }) {
  return (
    <button onclick={`switchTab('${id}')`}
      id={`tab-btn-${id}`}
      class={`flex-1 text-center py-3 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-[#71767b] text-[#e7e9ea]'
          : 'border-transparent text-[#71767b] hover:text-[#e7e9ea]'
      }`}
    >{label}</button>
  );
}

// ── Dialogue Timeline ──

function DialogueTimeline({ turns }: { turns: any[] }) {
  if (turns.length === 0) {
    return <p class="text-sm text-[#71767b] text-center py-8">No dialogue yet. Drop an idea to start the conversation.</p>;
  }

  // Group by turn_group
  const groups: Record<string, any[]> = {};
  for (const turn of turns) {
    const g = turn.turn_group || 'ungrouped';
    if (!groups[g]) groups[g] = [];
    groups[g].push(turn);
  }

  return (
    <div class="space-y-4">
      {Object.entries(groups).reverse().map(([group, groupTurns]) => (
        <div key={group} class="bg-[#1a1f2e] rounded-xl border border-[#2f3336] p-4">
          <div class="text-[10px] text-[#71767b] mb-3 font-mono">
            Conversation · {new Date(groupTurns[0].created_at || Date.now()).toLocaleString()}
            {' · '}
            <a href={`/conversation/${group}`} class="hover:text-[#e7e9ea] underline underline-offset-2">
              view full →
            </a>
          </div>
          <div class="space-y-3">
            {(groupTurns as any[]).map((turn) => (
              <DialogueTurn key={turn.id} turn={turn} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DialogueTurn({ turn, expanded = false }: { turn: any; expanded?: boolean }) {
  const isKevin = turn.speaker === 'kevin';
  const accent = isKevin ? '#4ecdc4' : '#ff6b9d';
  const bgAccent = isKevin ? 'rgba(78,205,196,0.06)' : 'rgba(255,107,157,0.06)';
  const mood = (detectMood(turn.content || turn.content) as any);
  const timestamp = turn.created_at ? new Date(turn.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div class="dialogue-turn rounded-xl p-3 border" style={`border-color:${accent}20;background:${bgAccent};animation-delay:0.1s`}>
      <div class="flex items-start gap-3">
        <div class="flex-shrink-0 mt-0.5">
          {isKevin ? <KevinFace mood={mood} speaking={false} size={36} showLabel={false} /> : <JennyFace mood={mood} speaking={false} size={36} showLabel={false} />}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-sm font-semibold" style={`color:${accent};`}>{isKevin ? 'Kevin' : 'Jenny'} <span class="font-normal text-[10px] text-[#71767b]">{isKevin ? 'The Grounder' : 'The Weaver'}</span></span>
            <span class="text-[10px] text-[#71767b]">{timestamp}</span>
          </div>
          <p class="text-sm text-[#b0b3b8] leading-relaxed">{escapeHtml(turn.content || turn.content)}</p>
          {turn.thoughts && (
            <button onclick="toggleThoughts(this)" class="mt-2 text-[10px] text-[#71767b] hover:text-[#e7e9ea] transition-colors">🔍 show reasoning</button>
          )}
          {turn.thoughts && (
            <div class="thoughts-content hidden mt-2 text-[11px] text-[#71767b] bg-[#202327] rounded-lg p-3 whitespace-pre-wrap leading-relaxed font-mono">
              {escapeHtml(turn.thoughts || '')}
            </div>
          )}
          {turn.turn_group && (
            <a href={`/conversation/${turn.turn_group}`} class="mt-2 inline-block text-[10px] text-[#71767b] hover:text-[#e7e9ea] underline underline-offset-2">permalink →</a>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Memory Grid ──

function MemoryGrid({ packets }: { packets: any[] }) {
  const typeColors: Record<string, string> = {
    observation: '#4ecdc4',
    experience: '#ff6b9d',
    rule: '#e2b714',
    hypothesis: '#a78bfa',
    concept: '#60a5fa',
  };

  // Group by type
  const grouped: Record<string, any[]> = {};
  for (const p of packets) {
    const t = p.type || 'observation';
    if (!grouped[t]) grouped[t] = [];
    grouped[t].push(p);
  }

  // Show top packets
  const topPackets = packets.slice(0, 30);

  if (packets.length === 0) {
    return <p class="text-sm text-[#71767b] text-center py-8">No memories yet. They form as the system learns.</p>;
  }

  return (
    <div class="grid grid-cols-2 gap-3">
      {topPackets.map((p: any) => (
        <a href={`/memory/${p.id}`} key={p.id}
          class="bg-[#1a1f2e] rounded-xl border border-[#2f3336] p-3 card-hover block"
        >
          <div class="flex items-center gap-2 mb-2">
            <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full" style={`background:${typeColors[p.type] || '#71767b'}20;color:${typeColors[p.type] || '#71767b'};`}>
              {p.type}
            </span>
            <span class="text-[10px] text-[#71767b]">{p.agent}</span>
            {p.connections && <span class="text-[10px] text-[#71767b]">· {p.connections} links</span>}
          </div>
          <p class="text-xs text-[#b0b3b8] leading-relaxed line-clamp-3">{escapeHtml(p.content || '').slice(0, 150)}</p>
        </a>
      ))}
    </div>
  );
}

// ── Signal Feed ──

function SignalFeed({ items }: { items: any[] }) {
  if (items.length === 0) {
    return <p class="text-sm text-[#71767b] text-center py-8">No signals yet. RSS feeds will populate this section.</p>;
  }

  return (
    <div class="space-y-3">
      {items.slice(0, 20).map((item: any) => (
        <div key={item.id} class="bg-[#1a1f2e] rounded-xl border border-[#2f3336] p-4">
          <div class="flex items-center gap-2 mb-2">
            <span class="text-[10px] text-[#71767b] font-mono">{item.source}</span>
            {item.category && (
              <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-[#2f3336] text-[#71767b]">{item.category}</span>
            )}
            {item.discussed ? (
              <span class="text-[10px] text-[#4ecdc4]">✓ discussed</span>
            ) : (
              <span class="text-[10px] text-[#71767b]">pending</span>
            )}
          </div>
          <h3 class="text-sm font-medium text-[#e7e9ea] mb-1">{escapeHtml(item.title || '')}</h3>
          {item.excerpt && <p class="text-xs text-[#71767b] leading-relaxed line-clamp-2">{escapeHtml(item.excerpt)}</p>}
          {item.url && (
            <a href={item.url} target="_blank" rel="noopener noreferrer" class="mt-2 inline-block text-[10px] text-[#71767b] hover:text-[#e7e9ea] underline underline-offset-2">read original →</a>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Evolve Panel ──

function EvolvePanel({ activeRules }: { activeRules: any[] }) {
  return (
    <div class="space-y-4">
      <div class="bg-[#1a1f2e] rounded-xl border border-[#2f3336] p-4">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-sm font-medium">🧬 Active Rules</span>
          <span class="text-[10px] bg-[#2f3336] text-[#71767b] px-2 py-0.5 rounded-full">{activeRules.length}</span>
        </div>
        {activeRules.length === 0 ? (
          <p class="text-xs text-[#71767b]">No active rules</p>
        ) : (
          <div class="space-y-3">
            {activeRules.map((rule: any) => (
              <a href={`/evolve/${rule.name}`} key={rule.name} class="block bg-[#1d2939] rounded-lg p-3 border border-[#2f3336] card-hover">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-xs font-semibold text-[#e7e9ea]">{rule.name}</span>
                  <span class="text-[10px] text-[#4ecdc4]">v{rule.version}</span>
                </div>
                <p class="text-[11px] text-[#71767b] leading-relaxed">{escapeHtml((rule.description || '').slice(0, 120))}</p>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

function detectMood(content: string): string {
  if (!content) return 'neutral';
  const c = content.toLowerCase();
  if (c.includes('exciting') || c.includes('right about') || c.includes('compelling') || c.includes('oh, i see') || c.includes('agree')) return 'happy';
  if (c.includes('cautious') || c.includes('don\'t have') || c.includes('barely there') || c.includes('ambiguous')) return 'sad';
  if (c.includes('interesting') || c.includes('wonder') || c.includes('see threads') || c.includes('wait') || c.includes('actually')) return 'surprised';
  if (c.includes('hmm') || c.includes('analysis') || c.includes('processing') || c.includes('extract') || c.includes('process')) return 'thinking';
  return 'neutral';
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
