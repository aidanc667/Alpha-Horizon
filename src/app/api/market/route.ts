import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { auth } from '@clerk/nextjs/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { getApiKey } from './_lib';
import type { HandlerCtx } from './_lib';
import { handleNearTerm } from './_handlers/near-term';
import { handleLiveUpdate } from './_handlers/live-update';
import { handleOutlook } from './_handlers/outlook';
import { handleAdvisorChat, handlePortfolioAdvice } from './_handlers/chat';
import { handlePolygonTicker, handlePolygonContext } from './_handlers/market-data';
import { handleHistory, handleUserPredict } from './_handlers/misc';
import { handleBestAssets, handleBestStrategy, handleGenerateArenaAllocation } from './_handlers/generation';
import { handleTripleCard, handleRefreshLive } from './_handlers/triple-card';

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret');
  const isCronCall = cronSecret && process.env.CRON_SECRET && cronSecret === process.env.CRON_SECRET;

  let currentUserId: string | null = null;
  if (!isCronCall) {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    currentUserId = userId;
    if (!await checkRateLimit(currentUserId, 'market', 30)) {
      return NextResponse.json({ error: 'Too many requests. Please wait a minute.' }, { status: 429 });
    }
  }

  try {
    const body = await req.json();
    const { action } = body;
    const ai = new GoogleGenAI({ apiKey: getApiKey() });
    const model = 'gemini-2.5-flash';
    const ctx: HandlerCtx = { body, ai, model, currentUserId };

    if (action === 'nearTerm')               return handleNearTerm(ctx);
    if (action === 'liveUpdate')             return handleLiveUpdate(ctx);
    if (action === 'outlook')                return handleOutlook(ctx);
    if (action === 'advisorChat')            return handleAdvisorChat(ctx);
    if (action === 'portfolioAdvice')        return handlePortfolioAdvice(ctx);
    if (action === 'polygonTicker')          return handlePolygonTicker(ctx);
    if (action === 'polygonContext')         return handlePolygonContext(ctx);
    if (action === 'history')               return handleHistory(ctx);
    if (action === 'userPredict')           return handleUserPredict(ctx);
    if (action === 'bestAssets')            return handleBestAssets(ctx);
    if (action === 'bestStrategy')          return handleBestStrategy(ctx);
    if (action === 'generateArenaAllocation') return handleGenerateArenaAllocation(ctx);
    if (action === 'tripleCard')            return handleTripleCard(ctx);
    if (action === 'refreshLive')           return handleRefreshLive(ctx);

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Server error';
    console.error('[/api/market] Error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
