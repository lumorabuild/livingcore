-- Phase 1: Categories + RSS daily input system
-- Preserves all existing data — adds structured memory organization + external knowledge intake

-- Categories: the memory classification system
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#71767b',
  icon TEXT NOT NULL DEFAULT '📁',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Add category columns to packets
ALTER TABLE packets ADD COLUMN primary_category TEXT REFERENCES categories(id);
ALTER TABLE packets ADD COLUMN secondary_categories TEXT DEFAULT '[]';

-- Index for category queries
CREATE INDEX IF NOT EXISTS idx_packets_category ON packets(primary_category);

-- RSS Items: fetched daily for Kevin & Jenny to discuss
CREATE TABLE IF NOT EXISTS rss_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_url TEXT NOT NULL,
  feed_title TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new', 'considered', 'discussed', 'ignored')),
  discussion_turn_ids TEXT DEFAULT '[]',
  assigned_category TEXT REFERENCES categories(id),
  relevance_score REAL DEFAULT 0.0
);

CREATE INDEX IF NOT EXISTS idx_rss_status ON rss_items(status);
CREATE INDEX IF NOT EXISTS idx_rss_fetched ON rss_items(fetched_at);

-- Seed the 14 categories
INSERT OR IGNORE INTO categories (id, name, description, color, icon) VALUES
  ('philosophy',     'Philosophy & Understanding',    'Questions about meaning, reality, knowledge, and truth',             '#9b59b6', '🔮'),
  ('ai-tech',        'Artificial Intelligence & Tech','AI, machine learning, software, computing, and technical systems',  '#3498db', '🤖'),
  ('cognition',      'Human Cognition & Behavior',    'How minds work: psychology, neuroscience, decision-making',          '#1abc9c', '🧠'),
  ('science',        'Science & Research',            'Empirical findings, studies, papers, and scientific method',          '#2ecc71', '🔬'),
  ('self-improve',   'Self-Improvement & Learning',   'Personal growth, skill development, habits, and education',          '#f39c12', '📈'),
  ('society',        'Society & Culture',             'Social structures, cultural trends, politics, and community',        '#e67e22', '🌍'),
  ('meta',           'System Self-Reflection',        'Living Core reflecting on its own cognition, memory, and growth',    '#95a5a6', '🪞'),
  ('ideas',          'Creative Ideas & Speculation',  'New hypotheses, novel connections, imaginative thinking',            '#e74c3c', '💡'),
  ('news',           'News & Current Events',         'Recent developments, discoveries, and noteworthy happenings',        '#fd79a8', '📰'),
  ('ethics',         'Ethics & Future Implications',  'Moral questions, long-term consequences, and responsible innovation','#6c5ce7', '⚖️'),
  ('art',            'Art & Expression',              'Creativity, aesthetics, storytelling, and artistic works',           '#e84393', '🎨'),
  ('nature',         'Nature & Universe',             'Natural world, physics, astronomy, biology, and environment',        '#00b894', '🌌'),
  ('language',       'Language & Communication',      'How we express, translate, and share meaning across ideas',          '#0984e3', '💬'),
  ('knowledge',      'Memory & Knowledge',            'How knowledge is built, stored, connected, and refined',              '#b2bec3', '📚');
