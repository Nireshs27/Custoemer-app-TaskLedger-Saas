-- Normalize existing vehicle task titles and reminder task titles
UPDATE vehicle_items
SET title = trim(title)
WHERE title IS NOT NULL
  AND title <> trim(title);

UPDATE reminder_schedules
SET task_title = trim(task_title)
WHERE task_title IS NOT NULL
  AND task_title <> trim(task_title);


