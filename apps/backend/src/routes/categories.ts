import { Router } from "express";
import { storage } from "../storage";
import { taxTrackerCategories, type InsertTaxTrackerCategory } from "@shared/schema";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../auth";

const router = Router();

// Validation schemas
const createCategorySchema = z.object({
  module: z.enum(['vehicle', 'asset', 'task_action', 'tax_legal', 'reminder_tasks']),
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
});

// Helper function to generate slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-'); // Replace multiple hyphens with single hyphen
}

// GET /api/categories?module=<module>
// Get all active categories for a specific module
router.get("/", requireAuth, async (req, res) => {
  try {
    const { module } = req.query;

    if (!module || typeof module !== 'string') {
      return res.status(400).json({ error: "Module parameter is required" });
    }

    // Validate module
    if (!['vehicle', 'asset', 'task_action', 'tax_legal', 'reminder_tasks'].includes(module)) {
      return res.status(400).json({ error: "Invalid module" });
    }

    const db = storage.dbx;
    const categories = await db
      .select()
      .from(taxTrackerCategories)
      .where(
        and(
          eq(taxTrackerCategories.module, module),
          eq(taxTrackerCategories.isActive, true)
        )
      )
      .orderBy(asc(taxTrackerCategories.sortOrder), asc(taxTrackerCategories.name));

    res.json(categories);
  } catch (error: any) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ error: error.message || "Failed to fetch categories" });
  }
});

// POST /api/categories
// Create a new category
router.post("/", requireAuth, async (req, res) => {
  try {
    const validation = createCategorySchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({ 
        error: "Validation failed", 
        details: validation.error.errors 
      });
    }

    const { module, name } = validation.data;
    let slug = generateSlug(name);

    const db = storage.dbx;

    // Check if slug already exists for this module
    const existing = await db
      .select()
      .from(taxTrackerCategories)
      .where(
        and(
          eq(taxTrackerCategories.module, module),
          eq(taxTrackerCategories.slug, slug)
        )
      );

    // If slug exists, append number to make it unique
    if (existing.length > 0) {
      let counter = 2;
      let uniqueSlug = `${slug}-${counter}`;
      
      while (true) {
        const check = await db
          .select()
          .from(taxTrackerCategories)
          .where(
            and(
              eq(taxTrackerCategories.module, module),
              eq(taxTrackerCategories.slug, uniqueSlug)
            )
          );
        
        if (check.length === 0) {
          slug = uniqueSlug;
          break;
        }
        
        counter++;
        uniqueSlug = `${slug}-${counter}`;
      }
    }

    // Get max sort_order for this module and add 10
    const maxSortResult = await db
      .select({ maxSort: sql<number>`COALESCE(MAX(${taxTrackerCategories.sortOrder}), 0)` })
      .from(taxTrackerCategories)
      .where(eq(taxTrackerCategories.module, module));

    const sortOrder = (maxSortResult[0]?.maxSort || 0) + 10;

    // Insert new category
    const newCategory = await db
      .insert(taxTrackerCategories)
      .values({
        module,
        name,
        slug,
        isSystem: false,
        isActive: true,
        sortOrder,
      })
      .returning();

    res.status(201).json(newCategory[0]);
  } catch (error: any) {
    console.error("Error creating category:", error);
    res.status(500).json({ error: error.message || "Failed to create category" });
  }
});

// PATCH /api/categories/:id/deactivate
// Soft delete (deactivate) a category
router.patch("/:id/deactivate", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const db = storage.dbx;

    // Check if category exists and is not a system category
    const category = await db
      .select()
      .from(taxTrackerCategories)
      .where(eq(taxTrackerCategories.id, id));

    if (category.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    if (category[0].isSystem) {
      return res.status(403).json({ error: "Cannot deactivate system categories" });
    }

    // Deactivate the category
    const updated = await db
      .update(taxTrackerCategories)
      .set({ isActive: false })
      .where(eq(taxTrackerCategories.id, id))
      .returning();

    res.json(updated[0]);
  } catch (error: any) {
    console.error("Error deactivating category:", error);
    res.status(500).json({ error: error.message || "Failed to deactivate category" });
  }
});

export default router;

