export const runtime = 'nodejs';

import { requireRole, handleAuthError } from '@/lib/server/auth';
import { db, auth } from '@/lib/server/firebase-admin';
import { adminSupabase } from '@/lib/server/supabase';
import { getTokenLimit, getTodayDateKey } from '@/lib/tokens';
import { calculateUsageCost } from '@/lib/server/model-pricing';

interface ModelStat {
  requests: number;
  tokens: number;
  percentage: number;
  costUsd: number;
}

interface DailyStat {
  date: string;
  requests: number;
  tokens: number;
  costUsd: number;
  models: Record<string, number>;
}

interface RequestHistoryItem {
  id: string;
  timestamp: string;
  model: string;
  success: boolean;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status: 'SUCCESS' | 'FAILED';
  errorType: string | null;
  costUsd: number;
}

export async function GET(request: Request, props: { params: Promise<{ uid: string }> }) {
  try {
    // Stage 2 requirement: Only ADMIN or SUPER_ADMIN can inspect arbitrary users
    await requireRole(request, ['SUPER_ADMIN', 'ADMIN']);
    const params = await props.params;
    const targetUid = params.uid;

    if (!targetUid || typeof targetUid !== 'string' || !targetUid.trim()) {
      return Response.json({ error: 'Target UID is required' }, { status: 400 });
    }

    const url = new URL(request.url);
    const daysParam = url.searchParams.get('days') || 'all'; // '7', '30', or 'all'
    const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)));
    const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

    let cutoffDate: Date | null = null;
    if (daysParam === '7') {
      cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (daysParam === '30') {
      cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    }

    // 1. Fetch Auth & Firestore Profile Data
    let authRecord;
    try {
      authRecord = await auth.getUser(targetUid);
    } catch {
      return Response.json({ error: 'User not found in Firebase Auth' }, { status: 404 });
    }

    const userRef = db.collection('users').doc(targetUid);
    const userSnap = await userRef.get();
    const userData = userSnap.data() || {};

    // Fetch authoritative subscription from Supabase
    let subscription = null;
    try {
      const { data: subData } = await adminSupabase
        .from('subscriptions')
        .select('*')
        .eq('user_uid', targetUid)
        .maybeSingle();

      if (subData) {
        subscription = {
          planId: subData.plan_id,
          status: subData.status,
          quotaRemaining: subData.quota_remaining,
          expiresAt: subData.expires_at,
          createdAt: subData.created_at,
        };
      }
    } catch (e) {
      console.warn('[Admin User Inspection] Failed to fetch subscription:', e);
    }

    const role = (authRecord.customClaims?.role || userData.role || 'USER') as string;
    const testQuotaMode = (authRecord.customClaims?.testQuotaMode || userData.testQuotaMode || null) as string | null;
    const plan = subscription?.planId || userData.plan || 'free';

    const profile = {
      uid: targetUid,
      email: authRecord.email,
      name: authRecord.displayName || userData.displayName || authRecord.email,
      picture: authRecord.photoURL || userData.photoURL || null,
      createdAt: authRecord.metadata.creationTime ? new Date(authRecord.metadata.creationTime).toISOString() : null,
      lastSignInTime: authRecord.metadata.lastSignInTime ? new Date(authRecord.metadata.lastSignInTime).toISOString() : null,
      role,
      testQuotaMode,
      status: userData.status || 'active',
      plan,
      subscription,
    };

    // 2. Fetch API Usage from Supabase
    let usageErrorMsg: string | null = null;
    let totalRequests = 0;
    let successfulRequests = 0;
    let failedRequests = 0;
    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalEstimatedCostUsd = 0;

    const rawModelStats: Record<string, { requests: number; tokens: number; costUsd: number }> = {};
    const dailyMap = new Map<string, { requests: number; tokens: number; costUsd: number; models: Record<string, number> }>();
    const supabaseDates = new Set<string>();
    const allHistory: RequestHistoryItem[] = [];

    try {
      let sbQuery = adminSupabase
        .from('api_usage')
        .select('*')
        .eq('user_uid', targetUid)
        .order('created_at', { ascending: false });

      if (cutoffDate) {
        sbQuery = sbQuery.gte('created_at', cutoffDate.toISOString());
      }

      const { data: usageData, error: sbUsageError } = await sbQuery.limit(500);

      if (sbUsageError) {
        throw new Error(sbUsageError.message);
      }

      for (const row of usageData || []) {
        totalRequests++;
        if (row.success) successfulRequests++;
        else failedRequests++;

        const inTokens = typeof row.input_tokens === 'number' ? row.input_tokens : 0;
        const outTokens = typeof row.output_tokens === 'number' ? row.output_tokens : 0;
        const rowTokens = typeof row.total_tokens === 'number' && row.total_tokens > 0
          ? row.total_tokens
          : inTokens + outTokens;

        totalTokens += rowTokens;
        totalInputTokens += inTokens;
        totalOutputTokens += outTokens;

        const cleanModel = (row.model || 'gemini-unknown').replace(/^models\//, '').toLowerCase();
        const rowCost = calculateUsageCost(cleanModel, inTokens, outTokens, rowTokens);
        totalEstimatedCostUsd += rowCost;

        // Model stats
        if (!rawModelStats[cleanModel]) {
          rawModelStats[cleanModel] = { requests: 0, tokens: 0, costUsd: 0 };
        }
        rawModelStats[cleanModel].requests++;
        rawModelStats[cleanModel].tokens += rowTokens;
        rawModelStats[cleanModel].costUsd += rowCost;

        // Daily breakdown
        const rowDate = row.created_at ? row.created_at.slice(0, 10) : 'unknown';
        if (rowDate !== 'unknown') {
          supabaseDates.add(rowDate);
          if (!dailyMap.has(rowDate)) {
            dailyMap.set(rowDate, { requests: 0, tokens: 0, costUsd: 0, models: {} });
          }
          const dayEntry = dailyMap.get(rowDate)!;
          dayEntry.requests++;
          dayEntry.tokens += rowTokens;
          dayEntry.costUsd += rowCost;
          dayEntry.models[cleanModel] = (dayEntry.models[cleanModel] || 0) + rowTokens;
        }

        // Sanitized History Item (never expose prompt, private credentials or raw keys)
        let sanitizedError = row.error_type || null;
        if (sanitizedError && (sanitizedError.includes('AIza') || sanitizedError.includes('key'))) {
          sanitizedError = 'AUTHENTICATION_ERROR';
        }

        allHistory.push({
          id: row.id,
          timestamp: row.created_at,
          model: cleanModel,
          success: Boolean(row.success),
          tokens: rowTokens,
          inputTokens: inTokens,
          outputTokens: outTokens,
          durationMs: row.duration_ms || 0,
          status: row.success ? 'SUCCESS' : 'FAILED',
          errorType: sanitizedError,
          costUsd: Number(rowCost.toFixed(6)),
        });
      }
    } catch (e: any) {
      usageErrorMsg = e.message || 'Failed to fetch Supabase usage records';
      console.warn(`[Admin User Inspection] Supabase API Usage error for ${targetUid}:`, e);
    }

    // 3. Merge Historical Client Token Records from Firestore (users/{uid}/data/usage)
    // Avoid double counting by only incorporating dates not already tracked in Supabase
    try {
      const usageDocSnap = await db.collection('users').doc(targetUid).collection('data').doc('usage').get();
      if (usageDocSnap.exists) {
        const payloadStr = usageDocSnap.data()?.payload;
        if (payloadStr && typeof payloadStr === 'string') {
          const tokenMap: Record<string, Record<string, Record<string, number>>> = JSON.parse(payloadStr);

          for (const dateKey of Object.keys(tokenMap)) {
            // Apply date filters if specified
            if (cutoffDate) {
              const parsedDate = new Date(dateKey);
              if (!isNaN(parsedDate.getTime()) && parsedDate < cutoffDate) {
                continue;
              }
            }

            // If Supabase already has per-request records for this date, Supabase is authoritative
            if (supabaseDates.has(dateKey)) {
              continue;
            }

            const dayObj = tokenMap[dateKey];
            if (!dayObj || typeof dayObj !== 'object') continue;

            let dayTokens = 0;
            let dayRequests = 0;
            let dayCost = 0;
            const dayModels: Record<string, number> = {};

            for (const keyOrProvider of Object.keys(dayObj)) {
              const modelDict = dayObj[keyOrProvider];
              if (!modelDict || typeof modelDict !== 'object') continue;

              for (const rawModel of Object.keys(modelDict)) {
                const count = Number(modelDict[rawModel]);
                if (isNaN(count) || count <= 0) continue;

                const cleanModel = rawModel.replace(/^models\//, '').toLowerCase();
                const cost = calculateUsageCost(cleanModel, null, null, count);

                dayTokens += count;
                dayRequests++;
                dayCost += cost;
                dayModels[cleanModel] = (dayModels[cleanModel] || 0) + count;

                if (!rawModelStats[cleanModel]) {
                  rawModelStats[cleanModel] = { requests: 0, tokens: 0, costUsd: 0 };
                }
                rawModelStats[cleanModel].requests++;
                rawModelStats[cleanModel].tokens += count;
                rawModelStats[cleanModel].costUsd += cost;
              }
            }

            if (dayTokens > 0) {
              totalTokens += dayTokens;
              totalRequests += dayRequests;
              successfulRequests += dayRequests;
              totalEstimatedCostUsd += dayCost;

              dailyMap.set(dateKey, {
                requests: dayRequests,
                tokens: dayTokens,
                costUsd: dayCost,
                models: dayModels,
              });
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[Admin User Inspection] Firestore usage merge note for ${targetUid}:`, e?.message);
    }

    // Model breakdown with percentage calculation
    const modelBreakdown: Record<string, ModelStat> = {};
    for (const model of Object.keys(rawModelStats)) {
      const stats = rawModelStats[model];
      modelBreakdown[model] = {
        requests: stats.requests,
        tokens: stats.tokens,
        percentage: totalTokens > 0 ? Math.round((stats.tokens / totalTokens) * 100) : 0,
        costUsd: Number(stats.costUsd.toFixed(6)),
      };
    }

    // Daily breakdown sorted newest first
    const dailyBreakdown: DailyStat[] = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        requests: data.requests,
        tokens: data.tokens,
        costUsd: Number(data.costUsd.toFixed(6)),
        models: data.models,
      }))
      .sort((a, b) => b.date.localeCompare(a.date));

    // Quota calculations
    const todayKey = getTodayDateKey();
    const todayStats = dailyMap.get(todayKey);
    const todayTokensUsed = todayStats ? todayStats.tokens : 0;
    const planLimit = getTokenLimit(plan, subscription?.expiresAt, role, testQuotaMode);
    const isUnlimited = planLimit >= 1_000_000;
    const remainingQuota = Math.max(0, planLimit - todayTokensUsed);
    const percentUsed = planLimit > 0 ? Math.min(100, Math.round((todayTokensUsed / planLimit) * 100)) : 0;

    const quota = {
      dailyLimit: planLimit,
      dailyUsed: todayTokensUsed,
      dailyRemaining: isUnlimited ? 'Unlimited' : remainingQuota,
      dailyPercentUsed: isUnlimited ? 0 : percentUsed,
      subscriptionQuotaRemaining: subscription?.quotaRemaining ?? null,
      planTier: plan,
      isUnlimited,
    };

    // Paginated history
    const paginatedHistory = allHistory.slice(offset, offset + limit);

    const usage = {
      totalRequests,
      successfulRequests,
      failedRequests,
      totalTokens,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      estimatedCostUsd: Number(totalEstimatedCostUsd.toFixed(4)),
      quota,
      modelBreakdown,
      dailyBreakdown,
      history: paginatedHistory,
      pagination: {
        total: allHistory.length,
        limit,
        offset,
        hasMore: offset + limit < allHistory.length,
      },
      filterDays: daysParam,
    };

    // 4. Fetch Projects from Supabase
    let projects: any[] = [];
    let projectsErrorMsg = null;
    try {
      const { data: projectsData, error: projectsError } = await adminSupabase
        .from('projects')
        .select('id, name, updated_at')
        .eq('owner_uid', targetUid)
        .order('updated_at', { ascending: false })
        .limit(50);

      if (projectsError) {
        projectsErrorMsg = 'Failed to connect to Supabase';
        console.warn(`[Admin User Inspection] Projects error for ${targetUid}:`, projectsError);
      } else {
        projects = (projectsData || []).map(p => ({
          id: p.id,
          name: p.name || 'Untitled Project',
          updatedAt: p.updated_at,
        }));
      }
    } catch {
      projectsErrorMsg = 'Supabase unavailable';
    }

    // 5. Fetch Chats from Supabase
    let chats: any[] = [];
    let chatsErrorMsg = null;
    try {
      const { data: chatsData, error: chatsError } = await adminSupabase
        .from('chat_sessions')
        .select('id, title, updated_at')
        .eq('owner_uid', targetUid)
        .order('updated_at', { ascending: false })
        .limit(50);

      if (chatsError) {
        chatsErrorMsg = 'Failed to connect to Supabase';
        console.warn(`[Admin User Inspection] Chats error for ${targetUid}:`, chatsError);
      } else {
        chats = (chatsData || []).map(c => ({
          id: c.id,
          title: c.title || 'Saved Chat',
          updatedAt: c.updated_at,
        }));
      }
    } catch {
      chatsErrorMsg = 'Supabase unavailable';
    }

    return Response.json({
      success: true,
      profile,
      usage,
      usageError: usageErrorMsg,
      projects,
      projectsError: projectsErrorMsg,
      chats,
      chatsError: chatsErrorMsg,
    });
  } catch (error) {
    return handleAuthError(error);
  }
}
