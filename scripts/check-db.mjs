import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function checkDB() {
  console.log("Fetching movies from Turso...\n");
  
  const result = await db.execute(`
    SELECT tmdb_id, title, year 
    FROM movies 
    ORDER BY title ASC
  `);

  // console.table formats SQLite rows into a beautiful terminal grid
  console.table(result.rows);
  
  console.log(`\nTotal movies in cache: ${result.rows.length}`);
}

checkDB().catch(console.error);