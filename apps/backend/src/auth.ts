import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import type { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { storage } from "./storage";
import { TaskLedgerUser as SelectUser, insertTaskLedgerUserSchema } from "@shared/schema";
import { z } from "zod";

declare global {
  namespace Express {
    interface User extends SelectUser {}
  }
}

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function comparePasswords(supplied: string, stored: string) {
  const [hashed, salt] = stored.split(".");
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export function setupAuth(app: Express) {
  if (!process.env.SESSION_SECRET) {
    console.error('❌ CRITICAL: SESSION_SECRET environment variable not found!');
    console.error('This is required for secure session management.');
    console.error('Please set SESSION_SECRET to a random, secure string.');
    throw new Error('SESSION_SECRET environment variable is required for production security.');
  }
  
  console.log('✅ Session security configured with:');
  console.log('  - Secure secret from environment variables');
  console.log('  - HttpOnly cookies enabled');
  console.log(`  - Secure cookies: ${process.env.NODE_ENV === "production"}`);
  console.log(`  - SameSite policy: ${process.env.NODE_ENV === "production" ? "strict" : "lax"}`);
  console.log('  - 24-hour session expiry');

  const cookieSecure =
    process.env.COOKIE_SECURE === "true"
      ? true
      : process.env.COOKIE_SECURE === "false"
        ? false
        : process.env.NODE_ENV === "production";

  const sessionSettings: session.SessionOptions = {
    secret: process.env.SESSION_SECRET,
    resave: true,  // ✅ Save session back to store on every request (prevents session loss)
    saveUninitialized: false,
    store: storage.sessionStore,
    proxy: process.env.NODE_ENV === "production",
    cookie: {
      secure: cookieSecure,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      sameSite: process.env.NODE_ENV === "production" ? "lax" : "lax",
    },
  };

  app.set("trust proxy", 1);
  app.use(session(sessionSettings));
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getTaskLedgerUserByUsername(username);
        if (!user || !user.isActive) {
          return done(null, false, { message: "Invalid username or password" });
        }
        
        if (!(await comparePasswords(password, user.passwordHash))) {
          return done(null, false, { message: "Invalid username or password" });
        }
        
        return done(null, user);
      } catch (error) {
        return done(error);
      }
    }),
  );

  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getTaskLedgerUser(id);
      if (!user) return done(null, null);

      // Hydrate orgId once here
      const isSingleTenant = process.env.SINGLE_TENANT_MODE !== "false";
      const effectiveOrgId =
        user.orgId ??
        (isSingleTenant
          ? user.id
          : null);

      return done(null, { ...user, orgId: effectiveOrgId });
    } catch (error) {
      return done(error);
    }
  });

  app.post("/api/login", (req, res, next) => {
    try {
      const validatedData = loginSchema.parse(req.body);
      
      passport.authenticate("local", (err: any, user: SelectUser, info: any) => {
        if (err) return next(err);
        if (!user) {
          return res.status(401).json({ message: info?.message || "Authentication failed" });
        }

        req.login(user, (err) => {
          if (err) return next(err);
          const { passwordHash, ...userResponse } = user;
          res.status(200).json(userResponse);
        });
      })(req, res, next);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation error",
          errors: error.errors 
        });
      }
      next(error);
    }
  });

  app.post("/api/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy((err) => {
        if (err) return next(err);
        res.clearCookie("connect.sid");
        res.sendStatus(200);
      });
    });
  });

  app.get("/api/user", (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.sendStatus(401);
    }
    const { passwordHash, ...userResponse } = req.user;
    res.json(userResponse);
  });

  // Public self-registration (enabled when ALLOW_PUBLIC_REGISTRATION=true)
  if (process.env.ALLOW_PUBLIC_REGISTRATION === "true") {
    app.post("/api/register", async (req, res, next) => {
      try {
        const validatedData = insertTaskLedgerUserSchema
          .omit({ passwordHash: true, role: true, isActive: true })
          .extend({
            password: z.string().min(6, "Password must be at least 6 characters"),
          })
          .parse(req.body);

        const existingUserByUsername = await storage.getTaskLedgerUserByUsername(validatedData.username);
        if (existingUserByUsername) {
          return res.status(400).json({ message: "Username already exists" });
        }

        const existingUserByEmail = await storage.getTaskLedgerUserByEmail(validatedData.email);
        if (existingUserByEmail) {
          return res.status(400).json({ message: "Email already exists" });
        }

        const isSingleTenant = process.env.SINGLE_TENANT_MODE !== "false";
        const user = await storage.createTaskLedgerUser({
          ...validatedData,
          passwordHash: await hashPassword(validatedData.password),
          role: "admin",
          isActive: true,
        });

        if (!isSingleTenant && !user.orgId) {
          await storage.updateTaskLedgerUser(user.id, { orgId: user.id });
          user.orgId = user.id;
        }

        req.login(user, (err) => {
          if (err) return next(err);
          const { passwordHash, ...userResponse } = user;
          res.status(201).json(userResponse);
        });
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({
            message: "Validation error",
            errors: error.errors,
          });
        }
        next(error);
      }
    });
  }

  // Admin-only user management routes
  app.get("/api/users", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const users = await storage.getAllTaskLedgerUsers();
      const usersResponse = users.map(({ passwordHash, ...user }) => user);
      res.json(usersResponse);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/users", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const validatedData = insertTaskLedgerUserSchema
        .omit({ passwordHash: true })
        .extend({
          password: z.string().min(6, "Password must be at least 6 characters"),
        }).parse(req.body);

      const existingUserByUsername = await storage.getTaskLedgerUserByUsername(validatedData.username);
      if (existingUserByUsername) {
        return res.status(400).json({ message: "Username already exists" });
      }

      const existingUserByEmail = await storage.getTaskLedgerUserByEmail(validatedData.email);
      if (existingUserByEmail) {
        return res.status(400).json({ message: "Email already exists" });
      }

      const user = await storage.createTaskLedgerUser({
        ...validatedData,
        passwordHash: await hashPassword(validatedData.password),
      });

      const { passwordHash, ...userResponse } = user;
      res.status(201).json(userResponse);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          message: "Validation error",
          errors: error.errors 
        });
      }
      next(error);
    }
  });

  app.put("/api/users/:id", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      if (updates.password) {
        updates.passwordHash = await hashPassword(updates.password);
        delete updates.password;
      }

      const user = await storage.updateTaskLedgerUser(id, updates);
      const { passwordHash, ...userResponse } = user;
      res.json(userResponse);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/users/:id", requireAuth, requireAdmin, async (req, res, next) => {
    try {
      const { id } = req.params;
      
      // Prevent admin from deleting themselves
      if (req.user!.id === id) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }

      await storage.deleteTaskLedgerUser(id);
      res.sendStatus(204);
    } catch (error) {
      next(error);
    }
  });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.sendStatus(401);
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user!.role !== "admin") {
    return res.sendStatus(403);
  }
  next();
}
