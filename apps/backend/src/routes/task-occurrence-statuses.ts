import { Router } from "express";
import { requireAuth } from "../auth";
import { storage } from "../storage";
import { normalizeOccurrenceIso } from "../lib/occurrence-key";

export const taskOccurrenceStatusesRouter = Router();

// GET /api/task-occurrence/statuses?entityType&entityId&from&to
taskOccurrenceStatusesRouter.get("/statuses", requireAuth, async (req, res, next) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const entityType = typeof req.query.entityType === "string" ? req.query.entityType : null;
    const entityId = typeof req.query.entityId === "string" ? req.query.entityId : null;
    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;

    if (!entityType || !entityId) {
      return res.status(400).json({ message: "entityType and entityId are required" });
    }

    const normalizedFrom = from ? normalizeOccurrenceIso(from) : null;
    const normalizedTo = to ? normalizeOccurrenceIso(to) : null;

    const rows = await storage.getOccurrenceStatusesForEntity(
      userId,
      entityType,
      entityId,
      normalizedFrom,
      normalizedTo
    );

    const map: Record<string, { status: string; note: string | null; updatedAt: string | null }> = {};
    for (const row of rows) {
      map[row.occurrence_key] = {
        status: row.status,
        note: row.note,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      };
    }

    return res.json(map);
  } catch (error) {
    next(error);
  }
});

