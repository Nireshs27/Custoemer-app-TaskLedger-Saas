-- Migration to add org_id to taskledger_users and pending_delete to task_ledger_documents
-- Also adds indexes for performance and security scoping

-- 1) Add org_id to taskledger_users if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='taskledger_users' AND column_name='org_id') THEN
        ALTER TABLE taskledger_users ADD COLUMN org_id UUID;
    END IF;
END $$;

-- 2) Add pending_delete to task_ledger_documents if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_ledger_documents' AND column_name='pending_delete') THEN
        ALTER TABLE task_ledger_documents ADD COLUMN pending_delete BOOLEAN NOT NULL DEFAULT FALSE;
    END IF;
END $$;

-- 3) Add indexes for org_id scoping
CREATE INDEX IF NOT EXISTS idx_taskledger_users_org_id ON taskledger_users(org_id);
CREATE INDEX IF NOT EXISTS idx_task_ledger_docs_org_id ON task_ledger_documents(org_id);
CREATE INDEX IF NOT EXISTS idx_task_ledger_links_org_id ON task_ledger_document_links(org_id);

-- 4) Add index for pending_delete to speed up purge script
CREATE INDEX IF NOT EXISTS idx_task_ledger_docs_pending_delete ON task_ledger_documents(pending_delete);

-- 5) Add index for entity-based listing
CREATE INDEX IF NOT EXISTS idx_task_ledger_links_entity ON task_ledger_document_links(entity_type, entity_id);

-- 6) Backfill plan: Existing rows already have data. 
-- For users, org_id is nullable. In multi-tenant systems, you'd backfill with real org IDs.
-- For documents, org_id is NOT NULL in schema, so if there are existing rows, 
-- they must have been created when org_id was already present or handled.
