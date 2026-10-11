export interface PlanConfig {
  id: string;
  name: string;
  price: number;
  durationDays: number;
  proRuns: number;
  unlimitedStandard: boolean;
}

export const PLANS: Record<string, PlanConfig> = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    durationDays: 0, // No expiry
    proRuns: 0,
    unlimitedStandard: true,
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 39,
    durationDays: 7, // 1 Week
    proRuns: 10,
    unlimitedStandard: true,
  },
  booster: {
    id: 'booster',
    name: 'Booster',
    price: 69,
    durationDays: 14, // 2 Weeks
    proRuns: 20,
    unlimitedStandard: true,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 199,
    durationDays: 30, // 1 Month
    proRuns: 50,
    unlimitedStandard: true,
  },
};

export function getPlanConfig(planId: string): PlanConfig {
  return PLANS[planId] || PLANS.free;
}
