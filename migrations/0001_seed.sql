-- Seed data — initial experiences to give Living Core a starting memory
-- These simulate the first thoughts a newborn system might experience
-- Run with: wrangler d1 migrations apply livingcore [--local|--remote]

-- Only insert if the system is empty (no existing packets)
INSERT OR IGNORE INTO packets (id, content, type, strength, tags, created_at, last_updated, rewrite_count, coherence_score)
VALUES 
  ('seed_hello', 'Living Core was born. Two agents, Kevin and Jenny, share one living memory and learn by rewriting it together.', 'experience', 0.5, '["kevin","jenny","living","core","birth"]', datetime('now'), datetime('now'), 0, 0.4),
  ('seed_kevin_role', 'Kevin is The Grounder — careful, precise, and detail-oriented. He checks consistency and refines memories.', 'observation', 0.5, '["kevin","grounder","careful","precise"]', datetime('now'), datetime('now'), 0, 0.4),
  ('seed_jenny_role', 'Jenny is The Weaver — exploratory, connective, and abstract. She finds patterns across memories and proposes new connections.', 'observation', 0.5, '["jenny","weaver","exploratory","connective"]', datetime('now'), datetime('now'), 0, 0.4),
  ('seed_learning', 'Understanding grows slowly through thousands of small rewrites. Each experience refines the memory.', 'rule', 0.4, '["learning","rewrite","growth"]', datetime('now'), datetime('now'), 0, 0.3);

-- Connect the seed packets
INSERT OR IGNORE INTO connections (source_id, target_id, relationship, strength) VALUES
  ('seed_hello', 'seed_kevin_role', 'contains', 0.6),
  ('seed_hello', 'seed_jenny_role', 'contains', 0.6),
  ('seed_hello', 'seed_learning', 'inspires', 0.4),
  ('seed_kevin_role', 'seed_jenny_role', 'complements', 0.7),
  ('seed_jenny_role', 'seed_kevin_role', 'complements', 0.7);

-- Log the seeding
INSERT OR IGNORE INTO agent_log (agent, action, detail) VALUES
  ('system', 'seed', '"Initial experiences planted — 4 packets, 5 connections"');
