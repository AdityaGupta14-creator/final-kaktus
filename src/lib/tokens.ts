/**
 * Unified Token Usage and Quota Management System for Kaktus
 */

export interface TokenUsageMap {
  [date: string]: {
    [keyOrProvider: string]: {
      [model: string]: number;
    };
  };
}

export const PLAN_TOKEN_LIMITS: Record<string, number> = {
  free: 25_000,         // 25k tokens daily limit for free tier
  starter: 50_000,      // 50k tokens quota for starter plan
  booster: 75_000,      // 75k tokens quota for booster plan
  pro: 100_000,         // 100k tokens quota for pro plan
  super_admin: 1_000_000,
  admin: 1_000_000,
};

export function getTokenLimit(plan?: string | null): number {
  if (!plan) return PLAN_TOKEN_LIMITS.free;
  return PLAN_TOKEN_LIMITS[plan.toLowerCase()] ?? PLAN_TOKEN_LIMITS.free;
}

export function getTodayDateKey(): string {
  // YYYY-MM-DD ensures daily reset
  return new Date().toISOString().split('T')[0];
}

export function getUserUsageStorageKey(uid?: string | null): string {
  const targetUid = uid || (typeof window !== 'undefined' ? (localStorage.getItem('kaktus_user_uid') || localStorage.getItem('kaktus_user_email')) : null) || 'anonymous';
  return `gemini_key_usage_stats_${targetUid}`;
}

/**
 * Calculates the total tokens consumed today for a given user.
 */
export function getStoredTokensUsed(uid?: string | null): number {
  if (typeof window === 'undefined') return 0;
  try {
    const storageKey = getUserUsageStorageKey(uid);
    const raw = localStorage.getItem(storageKey);
    if (!raw) return 0;
    
    const usageObj: TokenUsageMap = JSON.parse(raw);
    const today = getTodayDateKey();
    const dayStats = usageObj[today];
    if (!dayStats || typeof dayStats !== 'object') return 0;

    let total = 0;
    for (const keyId in dayStats) {
      const models = dayStats[keyId];
      if (models && typeof models === 'object') {
        for (const model in models) {
          const count = Number(models[model]);
          if (!isNaN(count) && count > 0) {
            total += count;
          }
        }
      }
    }
    return total;
  } catch (err) {
    console.error('[Tokens] Failed to parse token usage:', err);
    return 0;
  }
}

/**
 * Records token consumption and notifies all listeners across the IDE.
 */
export function recordTokensUsed(
  uid: string | null | undefined,
  keyId: string,
  modelName: string,
  tokensUsed: number
): number {
  if (typeof window === 'undefined' || tokensUsed <= 0) return getStoredTokensUsed(uid);
  try {
    const storageKey = getUserUsageStorageKey(uid);
    const raw = localStorage.getItem(storageKey) || '{}';
    const usageObj: TokenUsageMap = JSON.parse(raw);
    const today = getTodayDateKey();
    const cleanModel = modelName.replace(/^models\//, '');
    const cleanKey = keyId || 'server_managed';

    if (!usageObj[today]) usageObj[today] = {};
    if (!usageObj[today][cleanKey]) usageObj[today][cleanKey] = {};
    if (!usageObj[today][cleanKey][cleanModel]) usageObj[today][cleanKey][cleanModel] = 0;

    usageObj[today][cleanKey][cleanModel] += tokensUsed;
    localStorage.setItem(storageKey, JSON.stringify(usageObj));

    // Dispatch global event so UI bars, modals, and ChatBox immediately react
    window.dispatchEvent(new CustomEvent('geminiUsageUpdated', { detail: { tokensUsed, total: getStoredTokensUsed(uid) } }));
  } catch (err) {
    console.error('[Tokens] Failed to record token usage:', err);
  }
  return getStoredTokensUsed(uid);
}

/**
 * Checks if the user has reached or exceeded their daily token quota.
 */
export function isUserQuotaExceeded(uid?: string | null, plan?: string | null): boolean {
  if (typeof window === 'undefined') return false;
  const targetPlan = plan || localStorage.getItem('kaktus_user_plan') || 'free';
  const limit = getTokenLimit(targetPlan);
  const used = getStoredTokensUsed(uid);
  return used >= limit;
}
