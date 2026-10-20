import { createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function clearCache() {
  console.log("Connecting to Turso...");
  
  await db.execute("DELETE FROM streaming_providers;");
  console.log("Cleared streaming_providers table.");
  
  await db.execute("DELETE FROM movies;");
  console.log("Cleared movies table.");
  
  console.log("Cache completely wiped!");
}

clearCache().catch((err) => {
  console.error("Failed to clear cache:", err);
  process.exit(1);
});