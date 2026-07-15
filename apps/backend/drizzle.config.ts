import "dotenv/config";
import { defineConfig } from "drizzle-kit";

let databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set.");
}

// Remote Postgres (AWS RDS) needs SSL; local uses sslmode=disable.
const isLocal =
  /sslmode=disable|ssl=false/i.test(databaseUrl) ||
  /@(localhost|127\.0\.0\.1)(:|\/)/i.test(databaseUrl);

if (!isLocal && !databaseUrl.includes("sslmode")) {
  const separator = databaseUrl.includes("?") ? "&" : "?";
  databaseUrl = `${databaseUrl}${separator}sslmode=require&sslaccept=accept_invalid_certs`;
}

export default defineConfig({
  out: "./migrations",
  schema: "../../packages/shared/src/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
