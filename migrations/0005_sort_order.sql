-- 0005_sort_order.sql — manual order of a day, chosen by drag and drop.
--
-- Why this exists: Fase 6 lets the user reorder the Day view by dragging. The day
-- reads as a timeline (ORDER BY start_min), so dragging cannot rewrite start_min
-- without lying about when things happened — the hour is user data, and Fase 6 also
-- needs it true for native notifications. The manual position lives in its own
-- column instead.
--
-- Rule §2.8: 0001–0004 are published, so none is edited here. A new migration is the
-- only way to change the schema, which is the whole point of the rule.
--
-- Existing rows cannot be back-filled honestly: nobody knows in which order the user
-- would have arranged them. They get NULL, and reads fall back to start time — the
-- same order as before, so nothing visibly moves on upgrade.

ALTER TABLE tasks ADD COLUMN sort_order INTEGER;

-- The Day view filters by date and orders manually first; one composite index serves
-- both instead of scanning the day.
CREATE INDEX idx_tasks_day_order ON tasks (task_date, sort_order);
