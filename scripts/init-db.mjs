import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function init() {
  console.log("Creating tables in Turso...");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS movies (
      tmdb_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      year INTEGER,
      poster_url TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS streaming_providers (
      tmdb_id INTEGER NOT NULL,
      region TEXT NOT NULL,
      providers_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (tmdb_id, region),
      FOREIGN KEY (tmdb_id) REFERENCES movies(tmdb_id) ON DELETE CASCADE
    );
  `);

  // Index to speed up region & freshness lookups
  await db.execute(`
    CREATE INDEX IF NOT EXISTS idx_streaming_region_updated 
    ON streaming_providers(tmdb_id, region, updated_at);
  `);

  console.log("Database initialized successfully!");
}

init().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});