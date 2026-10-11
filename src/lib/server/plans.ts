export interface PlanConfig {
  id: string;
  name: string;
  price: number;
  durationDays: number;
  durationMinutes: number;
  proRuns: number;
  unlimitedStandard: boolean;
}

export const PLANS: Record<string, PlanConfig> = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    durationDays: 0,
    durationMinutes: 0,
    proRuns: 0,
    unlimitedStandard: true,
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    price: 39,
    durationDays: 7,
    durationMinutes: 7 * 24 * 60,
    proRuns: 10,
    unlimitedStandard: true,
  },
  booster: {
    id: 'booster',
    name: 'Booster',
    price: 69,
    durationDays: 14,
    durationMinutes: 14 * 24 * 60,
    proRuns: 20,
    unlimitedStandard: true,
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 169,
    durationDays: 30,
    durationMinutes: 30 * 24 * 60,
    proRuns: 50,
    unlimitedStandard: true,
  },
};

export function getPlanConfig(planId: string): PlanConfig {
  return PLANS[planId] || PLANS.free;
}
