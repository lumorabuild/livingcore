-- Migration 0004: Self-Editing Rule System
-- Stores the versioned JSON rules that Kevin & Jenny use to think,
-- plus their proposals to improve those rules.

-- 1. Active rule versions (the current "mind" of the system)
CREATE TABLE IF NOT EXISTS thinking_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL DEFAULT 1,
  name TEXT NOT NULL UNIQUE,         -- e.g. 'thinking_rules', 'category_definitions'
  content TEXT NOT NULL,              -- the full JSON blob
  description TEXT,                   -- human-readable summary
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  is_active INTEGER NOT NULL DEFAULT 1
);

-- 2. Agent proposals to change the rules
CREATE TABLE IF NOT EXISTS rule_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL CHECK(agent IN ('kevin', 'jenny')),
  rule_name TEXT NOT NULL,            -- which rule set they propose to change
  proposed_content TEXT NOT NULL,     -- the proposed new JSON
  reason TEXT NOT NULL,               -- why they propose this change
  coherence_before REAL,              -- avg coherence before proposal
  coherence_after REAL,               -- estimated coherence after (null until evaluated)
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'evaluating', 'adopted', 'rejected')),
  source_turn_id INTEGER,            -- which dialogue turn triggered this
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  evaluated_at TEXT,
  FOREIGN KEY (source_turn_id) REFERENCES dialogue_turns(id)
);

-- 3. Adoption history
CREATE TABLE IF NOT EXISTS rule_adoptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_name TEXT NOT NULL,
  from_version INTEGER NOT NULL,
  to_version INTEGER NOT NULL,
  proposal_id INTEGER,
  content TEXT NOT NULL,              -- the adopted JSON
  coherence_before REAL,
  coherence_after REAL,
  adopted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (proposal_id) REFERENCES rule_proposals(id)
);

-- Seed the initial ThinkingRules
INSERT OR IGNORE INTO thinking_rules (version, name, content, description) VALUES
(1, 'thinking_rules', '{
  "version": 1,
  "description": "Core rules governing how Kevin and Jenny think, categorize, score, and self-improve.",
  "category_assignment": {
    "rules": [
      "Exact keyword match takes priority: if input contains a category name or its known synonyms, assign to that category.",
      "Fallback to domain overlap: extract domain keywords and compare against category definitions.",
      "If no clear match, assign to the category whose existing packets have the highest keyword overlap.",
      "If all fail, default to ''philosophy'' - the catchall for abstract input.",
      "Every packet must have exactly one primary_category. secondary_categories are optional."
    ],
    "max_secondary_categories": 3
  },
  "coherence_scoring": {
    "connection_density_weight": 0.40,
    "semantic_consistency_weight": 0.35,
    "temporal_stability_weight": 0.25,
    "min_connections_for_density": 0.1,
    "semantic_overlap_threshold": 0.05,
    "temporal_decay_days": 7
  },
  "rewriting_strategy": {
    "enabled": true,
    "min_coherence_gain_to_rewrite": 0.05,
    "max_rewrites_per_packet": 3,
    "merge_threshold": 0.70,
    "split_threshold": 0.15
  },
  "rss_selection": {
    "max_items_per_batch": 20,
    "max_selected_per_batch": 3,
    "kevin_bias_weight": 0.6,
    "jenny_bias_weight": 0.4,
    "cluster_match_weight": 0.5,
    "content_diversity_weight": 0.5,
    "max_new_packets_from_rss": 2
  },
  "dialogue_style": {
    "kevin": {
      "personality": "grounded, analytical, cautious",
      "max_turns_before_reflection": 3,
      "quotes_accuracy_threshold": 0.7,
      "tone": "thoughtful and measured"
    },
    "jenny": {
      "personality": "exploratory, connective, intuitive",
      "max_connections_per_turn": 5,
      "pattern_mining_depth": 3,
      "tone": "curious and energetic"
    }
  },
  "self_improvement": {
    "min_turns_between_proposals": 3,
    "coherence_threshold_for_adoption": 0.55,
    "min_improvement_for_adoption": 0.03,
    "max_proposals_per_session": 2,
    "proposal_cooldown_turns": 5
  }
}', 'Core thinking rules for Kevin & Jenny reasoning'),
(1, 'category_definitions', '{
  "version": 1,
  "categories": [
    {"id": "philosophy", "name": "Philosophy & Understanding", "icon": "🔮", "color": "#9b59b6", "description": "Abstract ideas about meaning, reality, knowledge, and existence", "keywords": ["meaning","truth","reality","consciousness","existence","purpose","metaphysics","epistemology","ontology","ethics","morality","virtue","wisdom","question","wonder","contemplate","philosophy","paradox","infinite","transcendent"]},
    {"id": "ai-tech", "name": "Artificial Intelligence & Tech", "icon": "🤖", "color": "#3498db", "description": "AI, machine learning, algorithms, and technological progress", "keywords": ["ai","artificial","intelligence","machine","learning","neural","network","algorithm","model","data","compute","automation","robot","deep","learning","transformer","gpt","llm","token","attention"]},
    {"id": "cognition", "name": "Human Cognition & Behavior", "icon": "🧠", "color": "#e74c3c", "description": "How humans think, feel, learn, and behave", "keywords": ["mind","brain","cognition","cognitive","psychology","perception","memory","attention","emotion","feeling","thought","consciousness","behavior","learning","habit","bias","heuristic","intuition","reason","decision"]},
    {"id": "science", "name": "Science & Research", "icon": "🔬", "color": "#2ecc71", "description": "Scientific discoveries, research methods, and empirical knowledge", "keywords": ["science","scientific","research","study","experiment","hypothesis","theory","data","evidence","measure","quantum","physics","biology","chemistry","mathematics","discovery","observation","methodology","peer","review"]},
    {"id": "self-improve", "name": "Self-Improvement & Learning", "icon": "📈", "color": "#f39c12", "description": "Personal growth, skill building, productivity, and betterment", "keywords": ["improve","growth","learn","habit","practice","discipline","focus","productivity","goal","achievement","progress","better","skill","mastery","practice","routine","mindfulness","reflection","feedback","adapt"]},
    {"id": "society", "name": "Society & Culture", "icon": "🌍", "color": "#1abc9c", "description": "Social structures, cultural phenomena, and collective human behavior", "keywords": ["society","culture","community","social","group","collective","norm","tradition","institution","policy","government","democracy","power","inequality","justice","rights","freedom","media","public","communication"]},
    {"id": "meta", "name": "System Self-Reflection", "icon": "🪞", "color": "#e67e22", "description": "Thoughts about this system itself - Kevin, Jenny, their relationship, and their process", "keywords": ["kevin","jenny","living","core","agent","memory","packet","coherence","dialogue","thought","system","reflection","meta","self","purpose","we","us","our","process","rules"]},
    {"id": "creative", "name": "Creative Ideas & Expression", "icon": "💡", "color": "#f1c40f", "description": "Novel ideas, artistic expression, creativity, and imagination", "keywords": ["creative","create","idea","imagine","art","inspire","novel","original","express","design","innovation","invent","dream","vision","aesthetic","beauty","poetry","story","metaphor","possibility"]},
    {"id": "news", "name": "News & Current Events", "icon": "📰", "color": "#95a5a6", "description": "Timely information about ongoing events and developments", "keywords": ["news","announce","release","report","update","launch","event","current","today","new","breakthrough","milestone","discover","unveil","statement","declare","publish","recent","happening","develop"]},
    {"id": "ethics", "name": "Ethics & Responsibility", "icon": "⚖️", "color": "#8e44ad", "description": "Moral questions, responsibility, fairness, and values", "keywords": ["ethic","moral","right","wrong","fair","just","responsible","accountable","value","principle","duty","obligation","virtue","conscience","integrity","honesty","trust","respect","dignity","harm"]},
    {"id": "health", "name": "Health & Wellbeing", "icon": "❤️", "color": "#e74c3c", "description": "Physical health, mental health, medicine, and well-being", "keywords": ["health","wellness","wellbeing","medical","medicine","disease","treatment","therapy","mental","physical","exercise","nutrition","sleep","stress","anxiety","depression","recovery","heal","body","fitness"]},
    {"id": "education", "name": "Education & Knowledge", "icon": "📚", "color": "#3498db", "description": "Learning systems, teaching, knowledge transfer, and pedagogy", "keywords": ["education","teach","learn","school","university","student","teacher","curriculum","pedagogy","knowledge","study","training","course","lesson","train","skill","mentor","tutor","classroom","academic"]},
    {"id": "environment", "name": "Environment & Nature", "icon": "🌱", "color": "#27ae60", "description": "Natural world, ecology, climate, and environmental systems", "keywords": ["environment","nature","climate","ecolog","sustain","green","planet","earth","conservation","biodiversity","renewable","energy","pollution","forest","ocean","weather","natural","resource","species","habitat"]},
    {"id": "business", "name": "Business & Economy", "icon": "💼", "color": "#2980b9", "description": "Commerce, markets, entrepreneurship, and economic systems", "keywords": ["business","economy","market","company","startup","entrepreneur","finance","investment","revenue","profit","growth","industry","commerce","trade","fund","capital","venture","strategy","competition","customer"]}
  ]
}', 'All active categories with descriptions, keywords, and visual attributes');
