-- 0004_series_id.sql — gives a recurring series an identity of its own.
--
-- Why this exists: Fase 5 materialises recurring occurrences lazily, and it needs a way to
-- say "this row is an occurrence of *that* series". `0001` used `rrule_from` for that, and
-- `idx_tasks_occurrence` was `UNIQUE (rrule_from, task_date)`.
--
-- `rrule_from` is a date. A date identifies the day a series began, not the series, so two
-- recurring tasks created on the same day shared an origin and the second one failed:
--
--   SqliteError: UNIQUE constraint failed: tasks.rrule_from, tasks.task_date
--
-- Creating "Standup" and "Gym" as daily series on the same morning — the most ordinary use
-- there is — was impossible. The origin row is also told apart from its occurrences by
-- `task_date = rrule_from`, which has the same flaw: it is a date comparison standing in for
-- an identity comparison.
--
-- `series_id` is the series' primary key. The origin row carries its own id, and every
-- occurrence carries the origin's, so:
--
--   * two series born the same day are different series, and both fit;
--   * `(series_id, task_date)` is unique per occurrence, which is the invariant the
--     materialiser's existence check and the unique index both exist to hold;
--   * the origin row is still identifiable without a date comparison: it is the row where
--     `series_id = id`.
--
-- Rule §2.8: 0001 is published, so it is not edited here. The old index has to go, though —
-- leaving it in place would keep rejecting the very rows this column exists to allow.
--
-- Existing rows are back-filled from `rrule_from`: for every series that already exists, each
-- row becomes its own series' identity. Rows whose `task_date = rrule_from` are the origin
-- and claim themselves; the rest share the origin's id. No diary has been materialised yet
-- at the time this runs, so in practice every row with a `rrule_from` is an origin — but the
-- general form is what keeps this correct if a database ever upgrades after use.

ALTER TABLE tasks ADD COLUMN series_id TEXT;

UPDATE tasks
   SET series_id = (
     SELECT origin.id
       FROM tasks AS origin
      WHERE origin.rrule_from = tasks.rrule_from
        AND origin.task_date = tasks.rrule_from
   )
 WHERE rrule_from IS NOT NULL
   AND task_date = rrule_from;

UPDATE tasks
   SET series_id = (
     SELECT origin.id
       FROM tasks AS origin
      WHERE origin.rrule_from = tasks.rrule_from
        AND origin.task_date = tasks.rrule_from
   )
 WHERE rrule_from IS NOT NULL
   AND series_id IS NULL;

-- The uniqueness guarantee moves from "one occurrence per origin day" to "one occurrence per
-- series per day". The old index has to be dropped first: keeping it would keep rejecting the
-- rows this migration exists to permit, and it would no longer be describing the invariant.
DROP INDEX idx_tasks_occurrence;

CREATE UNIQUE INDEX idx_tasks_occurrence
  ON tasks (series_id, task_date)
  WHERE series_id IS NOT NULL;
