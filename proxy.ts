import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

// Allows 5 requests per 10 seconds, with a maximum burst capacity of 10
const ratelimit = new Ratelimit({
  redis: redis,
  limiter: Ratelimit.tokenBucket(5, "10 s", 10),
  analytics: true,
});

export async function proxy(request: NextRequest) {
  const ip = 
    request.headers.get("x-forwarded-for")?.split(',')[0] ?? 
    request.headers.get("x-real-ip") ?? 
    "anonymous";

  const { success, limit, reset, remaining } = await ratelimit.limit(ip);

  if (!success) {
    return new NextResponse("Too Many Requests. Please wait a moment before trying again.", {
      status: 429,
      headers: {
        "X-RateLimit-Limit": limit.toString(),
        "X-RateLimit-Remaining": remaining.toString(),
        "X-RateLimit-Reset": reset.toString(),
        "Retry-After": Math.ceil((reset - Date.now()) / 1000).toString(),
      },
    });
  }

  const response = NextResponse.next();
  response.headers.set("X-RateLimit-Remaining", remaining.toString());
  return response;
}

export const config = {
  matcher: ["/api/scrape/:path*", "/api/search/:path*"],
};