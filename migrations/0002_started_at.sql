-- 0002_started_at.sql — records when a task entered `in_progress`.
--
-- Why this exists: Phase 2 ships a live stopwatch for the running task, and a stopwatch
-- needs the moment the task started. `updated_at` cannot stand in for it — editing a
-- running task's title would reset the clock. `docs/plan-tasks-app.md` §7.1 predates
-- that requirement and has no such column; the plan has been corrected to match.
--
-- Rule §2.8: 0001 is published, so it is not edited here. A new migration is the only
-- way to change the schema, which is the whole point of the rule.
--
-- Existing rows cannot be back-filled honestly: nobody knows when a task that is
-- `in_progress` right now actually started. They get NULL, and the UI shows the elapsed
-- time as unknown rather than inventing a value.

ALTER TABLE tasks ADD COLUMN started_at TEXT;

-- The partial index the Day view reads to find the running task in O(log n) instead of
-- scanning the day. `idx_tasks_single_focus` already guarantees at most one such row per
-- day, so this index never returns more than one result.
CREATE INDEX idx_tasks_started_at ON tasks (started_at) WHERE started_at IS NOT NULL;