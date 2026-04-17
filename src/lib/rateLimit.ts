import { db } from './db';

/**
 * DB-backed sliding-window rate limiter.
 * Persists across cold starts and serverless instances — unlike in-memory Maps.
 * Keyed by userId (not IP) so it cannot be bypassed by proxy rotation.
 *
 * Returns true if the request is within the limit, false if exceeded.
 */
export async function checkRateLimit(
  userId: string,
  endpoint: string,
  maxRequests: number,
  windowSeconds = 60
): Promise<boolean> {
  const sql = db();
  const result = await sql`
    INSERT INTO rate_limits (user_id, endpoint, window_start, count)
    VALUES (${userId}, ${endpoint}, NOW(), 1)
    ON CONFLICT (user_id, endpoint)
    DO UPDATE SET
      window_start = CASE
        WHEN NOW() - rate_limits.window_start > make_interval(secs => ${windowSeconds})
          THEN NOW()
        ELSE rate_limits.window_start
      END,
      count = CASE
        WHEN NOW() - rate_limits.window_start > make_interval(secs => ${windowSeconds})
          THEN 1
        ELSE rate_limits.count + 1
      END
    RETURNING count
  `;
  return (result[0]?.count ?? 1) <= maxRequests;
}
