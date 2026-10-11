/**
 * Unified Token Usage and Quota Management System for Kaktus
 * Supports:
 * - Plans: Free (25k), Starter 39 (50k, 1 week), Booster 69 (75k, 2 weeks), Pro 169 (100k, 1 month)
 * - Automatic reversion to Free tier when plan period expires
 * - Strict token reset each day at start of day (12:00 AM midnight)
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
  starter: 50_000,      // 50k tokens daily quota for starter plan (1 week)
  booster: 75_000,      // 75k tokens daily quota for booster plan (2 weeks)
  pro: 100_000,         // 100k tokens daily quota for pro plan (1 month)
  super_admin: 1_000_000,
  admin: 1_000_000,
};

/**
 * Checks whether a subscription validity date has passed
 */
export function isPlanExpired(planExpiresAt?: Date | string | null): boolean {
  if (!planExpiresAt) return false;
  const exp = typeof planExpiresAt === 'string' ? new Date(planExpiresAt) : planExpiresAt;
  return !isNaN(exp.getTime()) && Date.now() >= exp.getTime();
}

/**
 * Resolves the effective plan tier, automatically returning 'free' if the subscription period has expired.
 */
export function getEffectiveUserPlan(plan?: string | null, planExpiresAt?: Date | string | null): string {
  const rawPlan = (plan || (typeof window !== 'undefined' ? localStorage.getItem('kaktus_user_plan') : null) || 'free').toLowerCase();
  if (rawPlan === 'free') return 'free';

  const expiry = planExpiresAt ?? (typeof window !== 'undefined' ? localStorage.getItem('kaktus_user_plan_expires_at') : null);
  if (isPlanExpired(expiry)) {
    if (typeof window !== 'undefined') {
      localStorage.setItem('kaktus_user_plan', 'free');
      localStorage.removeItem('kaktus_user_plan_expires_at');
    }
    return 'free';
  }

  return rawPlan;
}

export function getTokenLimit(plan?: string | null, planExpiresAt?: Date | string | null): number {
  const effectivePlan = getEffectiveUserPlan(plan, planExpiresAt);
  return PLAN_TOKEN_LIMITS[effectivePlan] ?? PLAN_TOKEN_LIMITS.free;
}

/**
 * Generates local date key formatted YYYY-MM-DD.
 * Transitions to a new date immediately when 12:00 AM midnight begins in local time.
 */
export function getTodayDateKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculates remaining time until the next 12:00 AM midnight.
 */
export function getTimeUntilMidnight(): { ms: number; hours: number; minutes: number; seconds: number; formatted: string } {
  const now = new Date();
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  const ms = Math.max(0, midnight.getTime() - now.getTime());
  const hours = Math.floor(ms / (3600 * 1000));
  const minutes = Math.floor((ms % (3600 * 1000)) / (60 * 1000));
  const seconds = Math.floor((ms % (60 * 1000)) / 1000);
  const formatted = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${seconds}s`;
  return { ms, hours, minutes, seconds, formatted };
}

export function getUserUsageStorageKey(uid?: string | null): string {
  const targetUid = uid || (typeof window !== 'undefined' ? (localStorage.getItem('kaktus_user_uid') || localStorage.getItem('kaktus_user_email')) : null) || 'anonymous';
  return `gemini_key_usage_stats_${targetUid}`;
}

/**
 * Calculates total tokens consumed today for a given user.
 * Tokens consumed on prior days do not count towards today's quota.
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
export function isUserQuotaExceeded(uid?: string | null, plan?: string | null, planExpiresAt?: Date | string | null): boolean {
  if (typeof window === 'undefined') return false;
  const limit = getTokenLimit(plan, planExpiresAt);
  const used = getStoredTokensUsed(uid);
  return used >= limit;
}

/**
 * Checks for 12:00 AM midnight rollover and resets daily token usage tracking.
 */
export function checkAndResetDailyTokens(uid?: string | null): boolean {
  if (typeof window === 'undefined') return false;
  const targetUid = uid || localStorage.getItem('kaktus_user_uid') || 'anonymous';
  const today = getTodayDateKey();
  const lastReset = localStorage.getItem(`kaktus_last_daily_token_reset_${targetUid}`);

  if (lastReset !== today) {
    localStorage.setItem(`kaktus_last_daily_token_reset_${targetUid}`, today);
    window.dispatchEvent(new CustomEvent('geminiUsageUpdated', { detail: { total: getStoredTokensUsed(uid) } }));
    return true;
  }
  return false;
}
