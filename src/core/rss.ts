// RSS Engine — daily external input for Kevin & Jenny
// Fetches from 6 AI/tech/science feeds, lets agents decide what matters

import * as rssOps from '../db/rss';
import * as packetOps from '../db/packet';
import * as dialogueOps from '../db/dialogue';
import { classifyText } from './categories';
import { generateDialogueTurn } from './dialogue';
import { ThoughtPacket } from '../db/schema';

const RSS_FEEDS = [
  // ── AI & Technology ──
  { url: 'https://www.marktechpost.com/feed/',          name: 'MarkTechPost' },
  { url: 'https://openai.com/news/rss.xml',              name: 'OpenAI News' },
  { url: 'https://huggingface.co/blog/feed.xml',         name: 'Hugging Face Blog' },
  { url: 'https://www.technologyreview.com/topic/artificial-intelligence/feed/', name: 'MIT Tech Review AI' },
  { url: 'https://arxiv.org/rss/cs.AI',                  name: 'arXiv cs.AI' },
  { url: 'https://thegradient.pub/rss/',                 name: 'The Gradient' },
  // ── Science & Nature ──
  { url: 'https://www.nature.com/nature.rss',            name: 'Nature' },
  { url: 'https://www.sciencedaily.com/rss/all.xml',     name: 'ScienceDaily' },
  { url: 'https://www.quantamagazine.org/feed/',         name: 'Quanta Magazine' },
  { url: 'https://www.scientificamerican.com/rss/',      name: 'Scientific American' },
  // ── Philosophy & Ideas ──
  { url: 'https://aeon.co/feed.rss',                     name: 'Aeon' },
  { url: 'https://psyche.co/feed.rss',                   name: 'Psyche' },
  { url: 'https://www.brainpickings.org/feed/',          name: 'Brain Pickings' },
  { url: 'https://www.themarginalian.org/feed/',         name: 'The Marginalian' },
  // ── Culture, Society & Future ──
  { url: 'https://www.wired.com/feed/rss',               name: 'Wired' },
  { url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', name: 'BBC Tech' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/Technology.xml', name: 'NYT Tech' },
  { url: 'https://www.theatlantic.com/feed/all/',        name: 'The Atlantic' },
];

const MAX_ITEMS_PER_FEED = 15;  // Cap to avoid timeouts with huge feeds

const STOP_WORDS = new Set([
  'the','a','an','in','on','at','to','for','of','with','and','or','is','are','was','were',
  'be','been','being','have','has','had','do','does','did','will','would','could','should',
  'may','might','can','shall','this','that','these','those','i','me','my','we','our','you',
  'your','it','its','they','them','their','not','no','but','so','if','as','by','from','about',
  'up','out','over','after','all','each','every','more','some','any','both','very','just',
  'also','now','then','than','too','only','own','same','such','here','there','when','where',
  'why','how','what','which','who','whom'
]);

function extractKeywords(text: string): string[] {
  return [...new Set(
    text.toLowerCase().split(/[^a-zA-Z0-9]+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
  )];
}

function keywordRelevance(text: string, keywords: string[]): number {
  const words = extractKeywords(text);
  if (words.length === 0 || keywords.length === 0) return 0;
  const intersection = words.filter(w => keywords.includes(w)).length;
  return intersection / Math.max(1, keywords.length);
}

// ── Simple RSS XML Parser (no external dependencies) ──

function parseRSSXml(xml: string): { title: string; link: string; summary: string; pubDate: string }[] {
  const items: { title: string; link: string; summary: string; pubDate: string }[] = [];

  // Extract <item> blocks
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = extractTag(block, 'title') || '(no title)';
    const link = extractTag(block, 'link') || '';
    const summary = extractTag(block, 'description') || '';
    const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'dc:date') || '';

    // Clean HTML tags from description
    const cleanSummary = summary.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();

    items.push({
      title: title.replace(/<[^>]*>/g, '').trim(),
      link: link.trim(),
      summary: cleanSummary.slice(0, 500),
      pubDate: pubDate.trim()
    });
  }

  return items;
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = regex.exec(xml);
  if (!match) return null;
  return (match[1] || match[2] || '').trim();
}

// ── Feed Fetcher ──

async function fetchFeed(url: string): Promise<{ title: string; link: string; summary: string; pubDate: string }[] | null> {
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'LivingCore/2.0 (RSS Reader; +https://livingcore.cc)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return null;
    const xml = await response.text();
    const items = parseRSSXml(xml);
    // Cap at MAX_ITEMS_PER_FEED to prevent timeouts
    return items ? items.slice(0, MAX_ITEMS_PER_FEED) : null;
  } catch {
    return null;
  }
}

// ── Kevin evaluates RSS items ──

function kevinEvaluatesRSS(
  items: { title: string; summary: string }[]
): { index: number; score: number; reason: string }[] {
  const existingKeywords = [
    'ai','machine learning','neural','model','research','study','learning',
    'artificial intelligence','language model','deep learning','transformer',
    'algorithm','data','cognition','intelligence','robot','automation'
  ];

  return items.map((item, i) => {
    const text = `${item.title} ${item.summary}`.toLowerCase();
    const relevance = keywordRelevance(text, existingKeywords);
    const titleLen = item.title.length;
    const hasNumbers = /\d/.test(text);
    const score = relevance * 0.6 + (titleLen > 20 ? 0.2 : 0) + (hasNumbers ? 0.1 : 0);

    let reason: string;
    if (relevance > 0.3) reason = 'Directly relevant to our core knowledge areas';
    else if (relevance > 0.15) reason = 'Tangentially related — worth a look';
    else reason = 'Low relevance to our current memory domains';

    return { index: i, score: Math.min(1, score), reason };
  }).sort((a, b) => b.score - a.score);
}

// ── Jenny evaluates RSS items ──

function jennyEvaluatesRSS(
  items: { title: string; summary: string }[]
): { index: number; score: number; reason: string }[] {
  const crossDomainKeywords = [
    'future','imagine','possibility','connection','pattern','emerging','novel',
    'insight','breakthrough','discovery','transform','revolutionary','frontier',
    'new','unexpected','curious','interesting','surprising','unusual'
  ];

  return items.map((item, i) => {
    const text = `${item.title} ${item.summary}`.toLowerCase();
    const noveltyScore = keywordRelevance(text, crossDomainKeywords);
    const titleUnique = [...new Set(extractKeywords(item.title))].length;
    const score = noveltyScore * 0.5 + Math.min(0.4, titleUnique * 0.05);

    let reason: string;
    if (noveltyScore > 0.25) reason = 'Novel angle — could reveal unexpected connections';
    else if (noveltyScore > 0.1) reason = 'Moderate novelty — worth exploring';
    else reason = 'Familiar territory — unlikely to surprise us';

    return { index: i, score: Math.min(1, score), reason };
  }).sort((a, b) => b.score - a.score);
}

// ── Main RSS Processing Loop ──

export interface RssProcessingResult {
  feeds_fetched: number;
  items_fetched: number;
  items_selected: number;
  discussion_turns: number;
  turn_group: string | null;
}

export async function processRSSFeeds(db: D1Database): Promise<RssProcessingResult> {
  const startTime = Date.now();
  let feedsFetched = 0;
  let itemsFetched = 0;

  // Step 1: Fetch all feeds in parallel
  const feedPromises = RSS_FEEDS.map(async (feed) => {
    const items = await fetchFeed(feed.url);
    if (items) feedsFetched++;
    return { feed, items: items || [] };
  });

  const results = await Promise.allSettled(feedPromises);
  const allItems: { feedName: string; feedUrl: string; title: string; link: string; summary: string; pubDate: string }[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const item of result.value.items) {
        allItems.push({
          feedName: result.value.feed.name,
          feedUrl: result.value.feed.url,
          ...item
        });
      }
    }
  }

  itemsFetched = allItems.length;
  if (allItems.length === 0) {
    return { feeds_fetched: feedsFetched, items_fetched: 0, items_selected: 0, discussion_turns: 0, turn_group: null };
  }

  // Step 2: Save only the most recent items (cap at 20 per batch)
  const itemsToSave = allItems
    .sort((a, b) => (b.pubDate || '').localeCompare(a.pubDate || ''))
    .slice(0, 20);

  for (const item of itemsToSave) {
    try {
      await rssOps.createRssItem(db, {
        feed_url: item.feedUrl,
        feed_title: item.feedName,
        title: item.title,
        link: item.link,
        summary: item.summary,
        content: null,
        published_at: item.pubDate,
        status: 'new',
        discussion_turn_ids: '[]',
        assigned_category: null,
        relevance_score: 0
      });
    } catch {} // skip duplicates
  }

  // Step 3: Agents evaluate — only on the saved (fresh) items
  const evalItems = itemsToSave.map(i => ({ title: i.title, summary: i.summary }));
  const kevinPicks = kevinEvaluatesRSS(evalItems);
  const jennyPicks = jennyEvaluatesRSS(evalItems);

  // Step 4: Combine rankings — pick top 1-3 items
  const combined = new Map<number, { index: number; score: number; kevinReason: string; jennyReason: string }>();
  for (const pick of kevinPicks.slice(0, 5)) {
    combined.set(pick.index, { ...pick, kevinReason: pick.reason, jennyReason: '' });
  }
  for (const pick of jennyPicks.slice(0, 5)) {
    const existing = combined.get(pick.index);
    if (existing) {
      existing.score = Math.max(existing.score, pick.score);
      existing.jennyReason = pick.reason;
    } else {
      combined.set(pick.index, { ...pick, kevinReason: '', jennyReason: pick.reason });
    }
  }

  const selected = [...combined.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 3)
    .map(([idx]) => idx);

  // Step 5: Update status of selected items to 'considered'
  for (const idx of selected) {
    const item = allItems[idx];
    const category = classifyText(`${item.title} ${item.summary}`);
    await rssOps.updateRssItemByLink(db, item.link, {
      status: 'considered',
      assigned_category: category.primary,
      relevance_score: combined.get(idx)?.score || 0
    });
  }

  // Step 6: Generate dialogue about selected items — multi-turn chain
  let turnGroup: string | null = null;
  let discussionTurns = 0;

  if (selected.length > 0) {
    const selectedItems = selected.map(idx => itemsToSave[idx]);
    // Log RSS fetch event
    await packetOps.logAction(db, 'system', 'rss_fetch', undefined, {
      feeds: feedsFetched,
      items: itemsFetched,
      selected: selected.length,
      titles: selectedItems.map(i => i.title),
      elapsed_ms: Date.now() - startTime
    });

    // Create memory packets for top selected items so dialogue engine can reference them
    const rssPackets: ThoughtPacket[] = [];
    for (let i = 0; i < Math.min(selectedItems.length, 2); i++) {
      const item = selectedItems[i];
      const category = classifyText(`${item.title} ${item.summary}`);
      const pkt = await packetOps.createPacket(db, {
        id: packetOps.generateId(),
        content: `📡 RSS: ${item.title} — ${item.summary.slice(0, 300)}`,
        type: 'observation',
        tags: ['rss', item.feedName.replace(/\s+/g, '-').toLowerCase()],
        strength: 0.3,
        rewrite_count: 0,
        coherence_score: 0.3,
        primary_category: category.primary,
        secondary_categories: category.secondaries,
      });
      rssPackets.push(pkt);
      // Update RSS item status to discussed
      await rssOps.updateRssItemByLink(db, item.link, {
        status: 'discussed',
        discussion_turn_ids: JSON.stringify([]),
        assigned_category: category.primary
      });
    }

    // Kevin speaks first about RSS — trigger is the packet content itself
    turnGroup = packetOps.generateId();

    const firstTurn = await generateDialogueTurn(
      db,
      `📡 Today's RSS: ${selectedItems.map(i => i.title).join(' | ')}`,
      'kevin',
      turnGroup,
      'rss'
    );
    discussionTurns++;

    // Chain 2 more turns using dialogue engine
    const secondTurn = await generateDialogueTurn(
      db,
      firstTurn.turn.content,
      firstTurn.nextSpeaker,
      turnGroup,
      'rss'
    );
    discussionTurns++;

    const thirdTurn = await generateDialogueTurn(
      db,
      secondTurn.turn.content,
      secondTurn.nextSpeaker,
      turnGroup,
      'rss'
    );
    discussionTurns++;
  }

  await packetOps.logAction(db, 'system', 'rss_complete', undefined, {
    feeds: feedsFetched,
    items: itemsFetched,
    selected: selected.length,
    discussion_turns: discussionTurns,
    elapsed_ms: Date.now() - startTime
  });

  return {
    feeds_fetched: feedsFetched,
    items_fetched: itemsFetched,
    items_selected: selected.length,
    discussion_turns: discussionTurns,
    turn_group: turnGroup
  };
}
