-- 0003_search_text.sql — a folded copy of title and notes, for accent-insensitive search.
--
-- Why this column exists. The acceptance criterion of Fase 3 says search must work "con
-- acentos y mayúsculas", and neither of those comes for free in SQLite:
--
--   * `LIKE` is case-insensitive for ASCII only, and not at all for non-ASCII.
--   * There is no built-in accent folding, and FTS5 ships no tokenizer that does it.
--
-- Folding once on write and matching against the folded copy turns both into an ordinary
-- substring match. The alternative — loading the history into the renderer to run Fuse.js
-- over it — is what §14 of the master plan explicitly rules out ("búsqueda acotada, no
-- toda la base").
--
-- The original text is never modified. `title` and `notes` keep every accent; only this
-- derived column is folded, and it is always rebuilt from them on write.
--
-- Existing rows are back-filled from what is already stored, so the migration is not
-- destructive. SQLite's built-in lower() folds ASCII only, so accented rows are back-filled
-- to their unfolded form and are refreshed the next time they are written; a row written
-- before this migration is still findable by its unaccented words.

ALTER TABLE tasks ADD COLUMN search_text TEXT;

UPDATE tasks
   SET search_text = lower(trim(
         coalesce(title, '') || ' ' || coalesce(notes, '')
       ))
 WHERE search_text IS NULL;

-- Index on the folded column. A leading-wildcard `LIKE '%x%'` cannot use a b-tree index,
-- so this helps the common `ORDER BY task_date` that follows the filter and gives the
-- planner a narrower column to scan than the full `notes` text.
CREATE INDEX idx_tasks_search_text ON tasks (search_text);
