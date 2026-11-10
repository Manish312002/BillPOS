import { PrismaClient } from '@prisma/client';

/**
 * ============================================================================
 * COMMERCIAL PRICING & QUOTA STATUS NOTICE (Task 2):
 * ----------------------------------------------------------------------------
 * The numeric prices, billing intervals, resource quotas, and feature flags
 * defined below are CONFIGURABLE INITIAL SEED DEFAULTS.
 *
 * They are explicitly separate from the immutable architectural decisions
 * (D-01 through D-09) and require final commercial confirmation by the project owner.
 *
 * Target commercial tier assumptions under owner review:
 * - Starter:    ₹149/mo  | ₹1,490/yr   (Current default: ₹999/mo | ₹9,990/yr)
 * - Growth:     ₹249/mo  | ₹2,490/yr   (Current default: ₹2,499/mo | ₹24,990/yr)
 * - Enterprise: ₹3,999/mo| ₹39,990/yr  (Current default: ₹6,999/mo | ₹69,990/yr)
 * - Quotas:     Trial (1 outlet, 250 prods), Starter (1 outlet, 500 prods),
 *               Growth (3 outlets, 5,000 prods), Enterprise (unlimited / -1)
 *
 * Changing these seed default amounts requires zero schema or migration changes.
 * ============================================================================
 */

export async function seedSubscriptionPlans(client = new PrismaClient()) {
  const plans = [
    {
      code: 'TRIAL_14',
      name: '14-Day Free Trial',
      description: 'Full-featured 14-day evaluation tier for newly activated stores',
      trialDays: 14,
      isActive: true,
      isPublic: false,
      sortOrder: 0,
      prices: [
        {
          billingCycle: 'MONTHLY',
          currency: 'INR',
          amountPaise: 0n,
          isActive: true
        }
      ],
      features: [
        { featureKey: 'max_outlets', valueType: 'NUMERIC', numericValue: 1, booleanValue: null },
        { featureKey: 'max_users', valueType: 'NUMERIC', numericValue: 2, booleanValue: null },
        { featureKey: 'max_devices', valueType: 'NUMERIC', numericValue: 2, booleanValue: null },
        { featureKey: 'max_products', valueType: 'NUMERIC', numericValue: 250, booleanValue: null },
        { featureKey: 'offline_pos', valueType: 'BOOLEAN', numericValue: null, booleanValue: true },
        { featureKey: 'advanced_reports', valueType: 'BOOLEAN', numericValue: null, booleanValue: false },
        { featureKey: 'inventory_alerts', valueType: 'BOOLEAN', numericValue: null, booleanValue: false }
      ]
    },
    {
      code: 'STARTER',
      name: 'Starter Tier',
      description: 'Essential billing and inventory for single-outlet retail shops',
      trialDays: 0,
      isActive: true,
      isPublic: true,
      sortOrder: 1,
      prices: [
        {
          billingCycle: 'MONTHLY',
          currency: 'INR',
          amountPaise: 99900n, // Configurable seed default: ₹999.00
          isActive: true
        },
        {
          billingCycle: 'ANNUAL',
          currency: 'INR',
          amountPaise: 999000n, // Configurable seed default: ₹9,990.00
          isActive: true
        }
      ],
      features: [
        { featureKey: 'max_outlets', valueType: 'NUMERIC', numericValue: 1, booleanValue: null },
        { featureKey: 'max_users', valueType: 'NUMERIC', numericValue: 2, booleanValue: null },
        { featureKey: 'max_devices', valueType: 'NUMERIC', numericValue: 2, booleanValue: null },
        { featureKey: 'max_products', valueType: 'NUMERIC', numericValue: 500, booleanValue: null },
        { featureKey: 'offline_pos', valueType: 'BOOLEAN', numericValue: null, booleanValue: true },
        { featureKey: 'advanced_reports', valueType: 'BOOLEAN', numericValue: null, booleanValue: false },
        { featureKey: 'inventory_alerts', valueType: 'BOOLEAN', numericValue: null, booleanValue: false }
      ]
    },
    {
      code: 'GROWTH',
      name: 'Growth Tier',
      description: 'Multi-register & multi-outlet retail operations with advanced analytics',
      trialDays: 0,
      isActive: true,
      isPublic: true,
      sortOrder: 2,
      prices: [
        {
          billingCycle: 'MONTHLY',
          currency: 'INR',
          amountPaise: 249900n, // Configurable seed default: ₹2,499.00
          isActive: true
        },
        {
          billingCycle: 'ANNUAL',
          currency: 'INR',
          amountPaise: 2499000n, // Configurable seed default: ₹24,990.00
          isActive: true
        }
      ],
      features: [
        { featureKey: 'max_outlets', valueType: 'NUMERIC', numericValue: 3, booleanValue: null },
        { featureKey: 'max_users', valueType: 'NUMERIC', numericValue: 10, booleanValue: null },
        { featureKey: 'max_devices', valueType: 'NUMERIC', numericValue: 6, booleanValue: null },
        { featureKey: 'max_products', valueType: 'NUMERIC', numericValue: 5000, booleanValue: null },
        { featureKey: 'offline_pos', valueType: 'BOOLEAN', numericValue: null, booleanValue: true },
        { featureKey: 'advanced_reports', valueType: 'BOOLEAN', numericValue: null, booleanValue: true },
        { featureKey: 'inventory_alerts', valueType: 'BOOLEAN', numericValue: null, booleanValue: true }
      ]
    },
    {
      code: 'ENTERPRISE',
      name: 'Enterprise Tier',
      description: 'Unlimited capacity for high-volume retail chains and multi-store operations',
      trialDays: 0,
      isActive: true,
      isPublic: true,
      sortOrder: 3,
      prices: [
        {
          billingCycle: 'MONTHLY',
          currency: 'INR',
          amountPaise: 699900n, // Configurable seed default: ₹6,999.00
          isActive: true
        },
        {
          billingCycle: 'ANNUAL',
          currency: 'INR',
          amountPaise: 6999000n, // Configurable seed default: ₹69,990.00
          isActive: true
        }
      ],
      features: [
        { featureKey: 'max_outlets', valueType: 'NUMERIC', numericValue: -1, booleanValue: null }, // -1 = Unlimited
        { featureKey: 'max_users', valueType: 'NUMERIC', numericValue: -1, booleanValue: null },
        { featureKey: 'max_devices', valueType: 'NUMERIC', numericValue: -1, booleanValue: null },
        { featureKey: 'max_products', valueType: 'NUMERIC', numericValue: -1, booleanValue: null },
        { featureKey: 'offline_pos', valueType: 'BOOLEAN', numericValue: null, booleanValue: true },
        { featureKey: 'advanced_reports', valueType: 'BOOLEAN', numericValue: null, booleanValue: true },
        { featureKey: 'inventory_alerts', valueType: 'BOOLEAN', numericValue: null, booleanValue: true }
      ]
    }
  ];

  const seededPlans = [];

  for (const p of plans) {
    const { prices, features, ...planData } = p;

    // 1. Upsert Plan by unique code
    const plan = await client.plan.upsert({
      where: { code: planData.code },
      update: {
        name: planData.name,
        description: planData.description,
        trialDays: planData.trialDays,
        isActive: planData.isActive,
        isPublic: planData.isPublic,
        sortOrder: planData.sortOrder
      },
      create: planData
    });

    // 2. Seed/Update Active Price for Plan & Billing Cycle
    for (const pr of prices) {
      const existingPrice = await client.planPrice.findFirst({
        where: {
          planId: plan.id,
          billingCycle: pr.billingCycle,
          isActive: true
        }
      });

      if (existingPrice) {
        await client.planPrice.update({
          where: { id: existingPrice.id },
          data: {
            amountPaise: pr.amountPaise,
            currency: pr.currency,
            isActive: pr.isActive
          }
        });
      } else {
        await client.planPrice.create({
          data: {
            planId: plan.id,
            billingCycle: pr.billingCycle,
            currency: pr.currency,
            amountPaise: pr.amountPaise,
            isActive: pr.isActive
          }
        });
      }
    }

    // 3. Upsert Features for Plan
    for (const f of features) {
      await client.planFeature.upsert({
        where: {
          planId_featureKey: {
            planId: plan.id,
            featureKey: f.featureKey
          }
        },
        update: {
          valueType: f.valueType,
          booleanValue: f.booleanValue,
          numericValue: f.numericValue
        },
        create: {
          planId: plan.id,
          featureKey: f.featureKey,
          valueType: f.valueType,
          booleanValue: f.booleanValue,
          numericValue: f.numericValue
        }
      });
    }

    seededPlans.push(plan);
  }

  return seededPlans;
}

// Standalone execution support
if (process.argv[1]?.endsWith('subscriptionPlans.seed.js')) {
  const prisma = new PrismaClient();
  seedSubscriptionPlans(prisma)
    .then((plans) => {
      console.log(`[Seed] Successfully seeded ${plans.length} commercial subscription plans.`);
      return prisma.$disconnect();
    })
    .catch((err) => {
      console.error('[Seed] Error seeding subscription plans:', err);
      return prisma.$disconnect().finally(() => process.exit(1));
    });
}
