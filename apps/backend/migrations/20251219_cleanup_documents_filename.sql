-- Backfill file_name from legacy filename column (if it exists), then drop it
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'documents' AND column_name = 'filename'
  ) THEN
    -- Backfill only where file_name is NULL or empty
    EXECUTE $sql$
      UPDATE documents
      SET file_name = COALESCE(NULLIF(file_name, ''), filename)
      WHERE (file_name IS NULL OR file_name = '')
        AND filename IS NOT NULL
    $sql$;

    -- Drop the legacy column now that the data is copied
    EXECUTE 'ALTER TABLE documents DROP COLUMN IF EXISTS filename';
  END IF;
END$$;

