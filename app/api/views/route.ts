import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const STATS_KEY = "total_views";

export async function POST() {
  try {
    if (process.env.NODE_ENV === "development") {
      const result = await db.execute({
        sql: `SELECT views FROM stats WHERE id = ? LIMIT 1`,
        args: [STATS_KEY],
      });
      const views = result.rows.length > 0 ? Number(result.rows[0].views) : 0;
      return NextResponse.json({ views });
    }

    const result = await db.execute({
      sql: `
        INSERT INTO stats (id, views)
        VALUES (?, 1)
        ON CONFLICT(id) DO UPDATE SET views = views + 1
        RETURNING views
      `,
      args: [STATS_KEY],
    });

    const views = Number(result.rows[0]?.views ?? 1);
    return NextResponse.json({ views });
  } catch (error: any) {
    console.error("View counter increment error:", error.message || error);
    return NextResponse.json({ error: "Failed to increment view counter" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await db.execute({
      sql: `SELECT views FROM stats WHERE id = ? LIMIT 1`,
      args: [STATS_KEY],
    });

    const views = result.rows.length > 0 ? Number(result.rows[0].views) : 0;
    return NextResponse.json({ views });
  } catch (error: any) {
    console.error("View counter fetch error:", error.message || error);
    return NextResponse.json({ views: 0 }, { status: 500 });
  }
}