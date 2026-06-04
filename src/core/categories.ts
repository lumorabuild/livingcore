// Category definitions and classification helpers
// 14 smart categories for organized memory

import { Category } from '../db/schema';

export const BUILTIN_CATEGORIES: Category[] = [
  { id: 'philosophy',  name: 'Philosophy & Understanding',     description: 'Questions about meaning, reality, knowledge, and truth',    color: '#9b59b6', icon: '🔮', created_at: '' },
  { id: 'ai-tech',     name: 'Artificial Intelligence & Tech', description: 'AI, ML, software, computing, and technical systems',       color: '#3498db', icon: '🤖', created_at: '' },
  { id: 'cognition',   name: 'Human Cognition & Behavior',     description: 'How minds work: psychology, neuroscience, decision-making',color: '#1abc9c', icon: '🧠', created_at: '' },
  { id: 'science',     name: 'Science & Research',             description: 'Empirical findings, studies, papers, and method',          color: '#2ecc71', icon: '🔬', created_at: '' },
  { id: 'self-improve',name: 'Self-Improvement & Learning',    description: 'Personal growth, habits, skill development, education',    color: '#f39c12', icon: '📈', created_at: '' },
  { id: 'society',     name: 'Society & Culture',              description: 'Social structures, cultural trends, politics, community',  color: '#e67e22', icon: '🌍', created_at: '' },
  { id: 'meta',        name: 'System Self-Reflection',         description: 'Living Core reflecting on its own cognition and growth',   color: '#95a5a6', icon: '🪞', created_at: '' },
  { id: 'ideas',       name: 'Creative Ideas & Speculation',   description: 'New hypotheses, novel connections, imaginative thinking', color: '#e74c3c', icon: '💡', created_at: '' },
  { id: 'news',        name: 'News & Current Events',          description: 'Recent developments, discoveries, happenings',             color: '#fd79a8', icon: '📰', created_at: '' },
  { id: 'ethics',      name: 'Ethics & Future Implications',   description: 'Moral questions, consequences, responsible innovation',   color: '#6c5ce7', icon: '⚖️', created_at: '' },
  { id: 'art',         name: 'Art & Expression',               description: 'Creativity, aesthetics, storytelling, artistic works',     color: '#e84393', icon: '🎨', created_at: '' },
  { id: 'nature',      name: 'Nature & Universe',              description: 'Natural world, physics, astronomy, biology, environment',  color: '#00b894', icon: '🌌', created_at: '' },
  { id: 'language',    name: 'Language & Communication',       description: 'Expression, translation, and meaning sharing',             color: '#0984e3', icon: '💬', created_at: '' },
  { id: 'knowledge',   name: 'Memory & Knowledge',             description: 'How knowledge is built, stored, connected, refined',       color: '#b2bec3', icon: '📚', created_at: '' },
];

const CATEGORY_MAP = new Map(BUILTIN_CATEGORIES.map(c => [c.id, c]));

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

// Category keyword profiles for automatic classification
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'philosophy':   ['meaning','reality','truth','consciousness','knowledge','existence','purpose','metaphysics','epistemology','why','being','nature of','mind','soul','question','wonder'],
  'ai-tech':      ['ai','artificial intelligence','machine learning','neural','deep learning','algorithm','model','gpt','llm','transformer','compute','data','software','code','program','robot','automation','digital','computer'],
  'cognition':    ['brain','mind','psychology','cognition','neuroscience','memory','attention','perception','decision','bias','behavior','thinking','learning','intelligence','emotion','cognitive'],
  'science':      ['science','research','study','experiment','theory','hypothesis','evidence','data','analysis','paper','discovery','finding','scientific','biology','physics','chemistry'],
  'self-improve': ['improve','learning','skill','habit','growth','practice','education','better','focus','discipline','goal','progress','develop','mastery','self'],
  'society':      ['society','culture','community','social','political','economy','policy','government','democracy','inequality','justice','rights','tradition','public','group'],
  'meta':         ['system','memory','thought','rewrite','cognition','awareness','understand','learning','grow','evolve','reflect','living core','kevin','jenny','agent'],
  'ideas':        ['idea','imagine','speculate','what if','possibility','creative','novel','new','vision','dream','inspire','concept','hypothesis','future','innovation'],
  'news':         ['news','report','announce','today','recent','latest','update','breaking','happening','current','event','release','launch','new'],
  'ethics':       ['ethics','moral','right','wrong','responsible','impact','consequence','fair','value','principle','dilemma','should','risk','safety','bias'],
  'art':          ['art','creative','beauty','aesthetic','music','story','write','poem','painting','design','expression','imagination','culture','film','literature'],
  'nature':       ['nature','universe','earth','space','physics','quantum','energy','light','star','planet','life','evolution','biology','environment','climate','cosmos'],
  'language':     ['language','word','meaning','communicate','translate','speak','write','text','symbol','linguistic','express','dialogue','narrative','semantic'],
  'knowledge':    ['knowledge','memory','information','learn','store','connect','pattern','understand','organize','structure','category','system','data','archive','record']
};

/**
 * Classify text into best-matching categories based on keyword overlap.
 * Returns primary category + up to 2 secondary categories.
 */
export function classifyText(text: string): {
  primary: string;
  secondaries: string[];
  scores: Record<string, number>;
} {
  const keywords = extractKeywords(text);
  if (keywords.length === 0) return { primary: 'ideas', secondaries: ['knowledge'], scores: {} };

  const scores: Record<string, number> = {};

  for (const [catId, catKeywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      for (const ckw of catKeywords) {
        if (kw.includes(ckw) || ckw.includes(kw)) {
          score += 1 / catKeywords.length;
        }
      }
    }
    // Bonus for keywords matching multiple profile words
    const exactMatches = keywords.filter(k => catKeywords.some(c => c.includes(k)));
    score += exactMatches.length * 0.15;
    if (score > 0) scores[catId] = score;
  }

  // Default fallback
  if (Object.keys(scores).length === 0) {
    return { primary: 'ideas', secondaries: ['knowledge'], scores };
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const primary = sorted[0][0];
  const secondaries = sorted.slice(1, 3).filter(([_, s]) => s > sorted[0][1] * 0.3).map(([id]) => id);

  return { primary, secondaries, scores };
}

export function getCategory(id: string): Category | undefined {
  return CATEGORY_MAP.get(id);
}

export function getAllCategories(): Category[] {
  return BUILTIN_CATEGORIES;
}
