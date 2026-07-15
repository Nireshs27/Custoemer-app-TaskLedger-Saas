-- Add sha256 column if not exists
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'task_ledger_documents' AND column_name = 'sha256') THEN
        ALTER TABLE task_ledger_documents ADD COLUMN sha256 TEXT;
    END IF;
END $$;

-- Add unique index for deduplication scoped by org_id
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_ledger_docs_org_sha256 
ON task_ledger_documents (org_id, sha256) 
WHERE sha256 IS NOT NULL;
