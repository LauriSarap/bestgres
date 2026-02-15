\c app_db

-- Users (20 random)
INSERT INTO users (id, email, name, role, last_login_at)
SELECT
  gen_random_uuid(),
  'user' || n || '@example.com',
  'User ' || (array['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack', 'Kate', 'Leo', 'Mia', 'Noah', 'Oscar', 'Paula', 'Quinn', 'Ray', 'Sue', 'Tom'])[1 + (n % 20)],
  (array['user', 'user', 'admin', 'user', 'moderator'])[1 + (n % 5)],
  CASE WHEN random() > 0.3 THEN now() - (random() * interval '30 days') ELSE NULL END
FROM generate_series(1, 20) n;

-- Tags
INSERT INTO tags (name, slug) VALUES
  ('technology', 'technology'),
  ('design', 'design'),
  ('tutorial', 'tutorial'),
  ('news', 'news'),
  ('opinion', 'opinion');

-- Posts (50 with random authors and data)
INSERT INTO posts (user_id, title, slug, body, published, published_at)
SELECT
  (SELECT id FROM users ORDER BY random() LIMIT 1),
  'Post number ' || n || ' – ' || (array['Getting started', 'Deep dive', 'Tips and tricks', 'Behind the scenes', 'Best practices'])[1 + (n % 5)],
  'post-' || n || '-' || substr(md5(random()::text), 1, 8),
  'Lorem ipsum dolor sit amet. ' || repeat('Some content here. ', 5 + (n % 20)),
  random() > 0.2,
  CASE WHEN random() > 0.2 THEN now() - (random() * interval '60 days') ELSE NULL END
FROM generate_series(1, 50) n;

-- Post-tag links (each post gets 1–3 random tags)
INSERT INTO post_tags (post_id, tag_id)
SELECT p.id, t.id
FROM posts p
CROSS JOIN tags t
WHERE random() < 0.4
ON CONFLICT DO NOTHING;

-- Comments (100+ random)
INSERT INTO comments (post_id, user_id, body)
SELECT
  (SELECT id FROM posts ORDER BY random() LIMIT 1),
  (SELECT id FROM users ORDER BY random() LIMIT 1),
  (array['Great post!', 'Thanks for sharing.', 'Very helpful.', 'I disagree.', 'Interesting take.'])[1 + (n % 5)] || ' ' || substr(md5(random()::text), 1, 8)
FROM generate_series(1, 120) n;
