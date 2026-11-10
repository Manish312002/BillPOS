import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { prisma } from '../src/db/client.js';
import * as subscriptionService from '../src/services/subscription.service.js';
import * as auditService from '../src/services/audit.service.js';
import {
  SUBSCRIPTION_STATUS,
  BILLING_CYCLE,
  AUDIT_ACTIONS,
  AUDIT_MODULES,
  AUDIT_EVENT_TYPES,
  SUBSCRIPTION_ERROR_CODES,
} from '@billingbuddy/shared';

describe('WP-SUB-02 Slice 3: Core Subscription Service & Lifecycle Scenarios', () => {
  const testId = Date.now();
  let superadminUser;
  let testPlanStarter;
  let testPlanGrowth;

  beforeAll(async () => {
    // 1. Ensure test superadmin exists
    superadminUser = await prisma.user.create({
      data: {
        fullName: 'Subscription Test Superadmin',
        phone: `+91911${Math.floor(100000 + Math.random() * 900000)}`,
        email: `sub_admin_${testId}_${Math.random().toString(36).substring(7)}@billingbuddy.com`,
        passwordHash: 'dummy_hash',
        status: 'ACTIVE',
        platformAuthorization: {
          create: {
            role: 'SUPERADMIN',
            status: 'ACTIVE',
          },
        },
      },
    });

    // 2. Fetch or create seeded commercial plans
    testPlanStarter = await prisma.plan.findUnique({
      where: { code: 'STARTER' },
      include: { prices: true, features: true },
    });

    if (!testPlanStarter) {
      testPlanStarter = await prisma.plan.create({
        data: {
          code: 'STARTER',
          name: 'Starter Tier',
          description: 'Single outlet retail',
          trialDays: 0,
          isActive: true,
          isPublic: true,
          version: 1,
          prices: {
            create: [
              { billingCycle: BILLING_CYCLE.MONTHLY, amountPaise: 14900n, isActive: true },
              { billingCycle: BILLING_CYCLE.ANNUAL, amountPaise: 149000n, isActive: true },
            ],
          },
        },
        include: { prices: true, features: true },
      });
    }

    testPlanGrowth = await prisma.plan.findUnique({
      where: { code: 'GROWTH' },
      include: { prices: true, features: true },
    });

    if (!testPlanGrowth) {
      testPlanGrowth = await prisma.plan.create({
        data: {
          code: 'GROWTH',
          name: 'Growth Tier',
          description: 'Expanding multi-outlet',
          trialDays: 0,
          isActive: true,
          isPublic: true,
          version: 1,
          prices: {
            create: [
              { billingCycle: BILLING_CYCLE.MONTHLY, amountPaise: 24900n, isActive: true },
              { billingCycle: BILLING_CYCLE.ANNUAL, amountPaise: 249000n, isActive: true },
            ],
          },
        },
        include: { prices: true, features: true },
      });
    }
  });

  afterAll(async () => {
    // AuditLog records are append-only and enforce ON DELETE RESTRICT on actorUserId.
    // Clean up test platform authorization.
    if (superadminUser) {
      await prisma.platformAuthorization.deleteMany({
        where: { userId: superadminUser.id },
      });
    }
  });

  // Helper to create a standalone test tenant
  async function createTestTenant(nameSuffix) {
    const slug = `tenant-sub-${testId}-${nameSuffix}-${Math.random().toString(36).substring(7)}`;
    return prisma.tenant.create({
      data: {
        legalName: `Sub Test Legal ${nameSuffix}`,
        tradeName: `Sub Test Store ${nameSuffix}`,
        slug,
        status: 'ACTIVE',
      },
    });
  }

  describe('1. Automatic 14-Day Free Trial Provisioning (Decision D-03)', () => {
    it('automatically provisions a 14-day trial subscription with status TRIAL', async () => {
      const tenant = await createTestTenant('trial-1');

      const subscription = await subscriptionService.provisionTrialSubscription({
        tenantId: tenant.id,
        actorUserId: superadminUser.id,
        actorRole: 'STORE_OWNER',
      });

      expect(subscription).toBeDefined();
      expect(subscription.status).toBe(SUBSCRIPTION_STATUS.TRIAL);
      expect(subscription.tenantId).toBe(tenant.id);
      expect(subscription.leaseVersion).toBe(1);
      expect(subscription.trialEndsAt).toBeDefined();

      // Check duration is approximately 14 days
      const durationDays =
        (new Date(subscription.trialEndsAt).getTime() -
          new Date(subscription.currentPeriodStart).getTime()) /
        (1000 * 60 * 60 * 24);
      expect(Math.round(durationDays)).toBe(14);
      expect(new Date(subscription.currentPeriodEnd).toISOString()).toBe(
        new Date(subscription.trialEndsAt).toISOString()
      );

      // Verify audit log emitted
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          targetTenantId: tenant.id,
          action: AUDIT_ACTIONS.SUBSCRIPTION_TRIAL_STARTED,
        },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog.module).toBe(AUDIT_MODULES.BILLING);
      expect(auditLog.eventType).toBe(AUDIT_EVENT_TYPES.SUBSCRIPTION_LIFECYCLE);
    });

    it('is strictly idempotent and does not create duplicate subscription if already active', async () => {
      const tenant = await createTestTenant('trial-idempotent');

      const sub1 = await subscriptionService.provisionTrialSubscription({
        tenantId: tenant.id,
      });

      const sub2 = await subscriptionService.provisionTrialSubscription({
        tenantId: tenant.id,
      });

      expect(sub1.id).toBe(sub2.id);

      const count = await prisma.tenantSubscription.count({
        where: { tenantId: tenant.id },
      });
      expect(count).toBe(1);
    });
  });

  describe('2. State Machine Invariants & Transition Validation', () => {
    it('permits valid state transitions according to lifecycle specification', () => {
      expect(() =>
        subscriptionService.assertValidTransition(
          SUBSCRIPTION_STATUS.TRIAL,
          SUBSCRIPTION_STATUS.ACTIVE
        )
      ).not.toThrow();

      expect(() =>
        subscriptionService.assertValidTransition(
          SUBSCRIPTION_STATUS.ACTIVE,
          SUBSCRIPTION_STATUS.GRACE_PERIOD
        )
      ).not.toThrow();

      expect(() =>
        subscriptionService.assertValidTransition(
          SUBSCRIPTION_STATUS.GRACE_PERIOD,
          SUBSCRIPTION_STATUS.READ_ONLY
        )
      ).not.toThrow();

      expect(() =>
        subscriptionService.assertValidTransition(
          SUBSCRIPTION_STATUS.READ_ONLY,
          SUBSCRIPTION_STATUS.ACTIVE
        )
      ).not.toThrow();
    });

    it('strictly prohibits direct in-place mutation of terminal states (CANCELED, EXPIRED)', () => {
      expect(() =>
        subscriptionService.assertValidTransition(
          SUBSCRIPTION_STATUS.CANCELED,
          SUBSCRIPTION_STATUS.ACTIVE
        )
      ).toThrowError(/Invalid subscription transition/i);

      expect(() =>
        subscriptionService.assertValidTransition(
          SUBSCRIPTION_STATUS.EXPIRED,
          SUBSCRIPTION_STATUS.ACTIVE
        )
      ).toThrowError(/Invalid subscription transition/i);
    });
  });

  describe('3. Commercial Plan Assignment, Upgrades & Migrations (D-08)', () => {
    it('assigns plan and transitions from TRIAL to ACTIVE with incremented leaseVersion', async () => {
      const tenant = await createTestTenant('plan-assign');

      // 1. Start with Trial
      const trialSub = await subscriptionService.provisionTrialSubscription({
        tenantId: tenant.id,
      });
      expect(trialSub.status).toBe(SUBSCRIPTION_STATUS.TRIAL);
      expect(trialSub.leaseVersion).toBe(1);

      // 2. Superadmin assigns STARTER monthly plan
      const assignedSub = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Store owner upgraded to Starter plan after successful evaluation',
      });

      expect(assignedSub.id).toBe(trialSub.id); // In-place update of current active subscription
      expect(assignedSub.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
      expect(assignedSub.billingCycle).toBe(BILLING_CYCLE.MONTHLY);
      expect(assignedSub.leaseVersion).toBe(2); // Incremented lease version

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          targetTenantId: tenant.id,
          action: AUDIT_ACTIONS.SUBSCRIPTION_PLAN_CHANGED,
        },
      });
      expect(auditLog).toBeDefined();
    });

    it('rejects plan assignment with reason shorter than 10 characters', async () => {
      const tenant = await createTestTenant('short-reason');

      await expect(
        subscriptionService.assignPlan({
          tenantId: tenant.id,
          planCode: 'STARTER',
          billingCycle: BILLING_CYCLE.MONTHLY,
          actorUserId: superadminUser.id,
          reason: 'Too short',
        })
      ).rejects.toThrow(/at least 10 characters/i);
    });
  });

  describe('4. Scenario 7: Manual Period Extension (Superadmin D-08)', () => {
    it('extends period end, restores status from GRACE_PERIOD to ACTIVE, and logs diff', async () => {
      const tenant = await createTestTenant('extend-period');

      // Provision active plan
      const sub = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Initial assignment for extension test',
      });

      // Move artificially into GRACE_PERIOD
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: {
          status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
          gracePeriodEndsAt: new Date(Date.now() + 1000 * 60 * 60),
        },
      });

      const previousPeriodEnd = sub.currentPeriodEnd;

      // Superadmin extends by 15 days
      const extended = await subscriptionService.extendSubscriptionPeriod({
        tenantId: tenant.id,
        extensionDays: 15,
        actorUserId: superadminUser.id,
        reason: 'Courtesy extension granted due to bank verification delay',
      });

      expect(extended.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
      expect(extended.gracePeriodEndsAt).toBeNull();
      expect(new Date(extended.currentPeriodEnd).getTime()).toBeGreaterThan(
        new Date(previousPeriodEnd).getTime()
      );

      // Verify audit log with diff
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          targetTenantId: tenant.id,
          action: AUDIT_ACTIONS.SUBSCRIPTION_PERIOD_EXTENDED,
        },
      });
      expect(auditLog).toBeDefined();
      expect(auditLog.metadata?.diff).toBeDefined();
      expect(auditLog.metadata.diff.before.status).toBe(SUBSCRIPTION_STATUS.GRACE_PERIOD);
      expect(auditLog.metadata.diff.after.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
    });
  });

  describe('5. Scenarios 8 & 9: Tenant Platform Suspension Decoupling (Clarification C)', () => {
    it('preserves subscription status unchanged when Tenant.status is set to SUSPENDED', async () => {
      const tenant = await createTestTenant('tenant-suspend');

      const sub = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Initial assignment for suspension test',
      });

      expect(sub.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);

      // Superadmin suspends tenant account independently (Scenario 8)
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'SUSPENDED' },
      });

      // Verify subscription row is untouched
      const evaluated = await subscriptionService.evaluateTenantSubscriptionStatus(tenant.id);
      expect(evaluated.isTenantSuspended).toBe(true);
      expect(evaluated.tenantStatus).toBe('SUSPENDED');
      expect(evaluated.subscription.status).toBe(SUBSCRIPTION_STATUS.ACTIVE); // Untouched!
    });

    it('evaluates dynamic access upon tenant reinstatement (Scenario 9)', async () => {
      const tenant = await createTestTenant('tenant-reinstate');

      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Initial assignment for reinstatement test',
      });

      // Re-activate tenant
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'ACTIVE' },
      });

      const evaluated = await subscriptionService.evaluateTenantSubscriptionStatus(tenant.id);
      expect(evaluated.isTenantSuspended).toBe(false);
      expect(evaluated.tenantStatus).toBe('ACTIVE');
      expect(evaluated.isActiveOrTrial).toBe(true);
    });
  });

  describe('6. Scenario 10: Cancellation Lifecycle (Scheduled vs Immediate)', () => {
    it('sets cancelAtPeriodEnd=true while maintaining ACTIVE operational access until conclusion', async () => {
      const tenant = await createTestTenant('cancel-scheduled');

      const sub = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Initial assignment for cancellation test',
      });

      // Schedule cancellation
      const scheduled = await subscriptionService.scheduleCancellation({
        tenantId: tenant.id,
        cancellationReason: 'Store closing at the end of the current billing cycle',
        actorUserId: superadminUser.id,
      });

      expect(scheduled.cancelAtPeriodEnd).toBe(true);
      expect(scheduled.status).toBe(SUBSCRIPTION_STATUS.ACTIVE); // Still active!

      // Rescind cancellation
      const rescinded = await subscriptionService.rescindScheduledCancellation({
        tenantId: tenant.id,
        actorUserId: superadminUser.id,
      });

      expect(rescinded.cancelAtPeriodEnd).toBe(false);
    });

    it('cancels immediately upon administrative action and increments leaseVersion', async () => {
      const tenant = await createTestTenant('cancel-immediate');

      const sub = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Initial assignment for immediate cancel test',
      });

      const canceled = await subscriptionService.cancelSubscriptionImmediately({
        tenantId: tenant.id,
        reason: 'Administrative cancellation due to policy non-compliance',
        actorUserId: superadminUser.id,
      });

      expect(canceled.status).toBe(SUBSCRIPTION_STATUS.CANCELED);
      expect(canceled.canceledAt).toBeDefined();
      expect(canceled.leaseVersion).toBe(sub.leaseVersion + 1);

      // Verify audit log
      const auditLog = await prisma.auditLog.findFirst({
        where: {
          targetTenantId: tenant.id,
          action: AUDIT_ACTIONS.SUBSCRIPTION_CANCELED,
        },
      });
      expect(auditLog).toBeDefined();
    });
  });

  describe('7. Scenario 11: Subscription Reactivation after Cancellation (Decision D-02 & Partial Unique Index)', () => {
    it('preserves historical canceled record and creates NEW active subscription row', async () => {
      const tenant = await createTestTenant('reactivate-test');

      // 1. Initial plan and cancellation
      const sub1 = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Initial subscription',
      });

      await subscriptionService.cancelSubscriptionImmediately({
        tenantId: tenant.id,
        reason: 'User canceled subscription',
        actorUserId: superadminUser.id,
      });

      // 2. Tenant reactivates (resubscribes to GROWTH plan)
      const sub2 = await subscriptionService.reactivateSubscription({
        tenantId: tenant.id,
        planCode: 'GROWTH',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Tenant returned and subscribed to Growth Tier',
      });

      expect(sub2.id).not.toBe(sub1.id); // Brand new record!
      expect(sub2.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
      expect(sub2.plan.code).toBe('GROWTH');

      // 3. Verify ledger history contains BOTH records
      const history = await subscriptionService.getSubscriptionHistory(tenant.id);
      expect(history).toHaveLength(2);
      expect(history.map((s) => s.status)).toContain(SUBSCRIPTION_STATUS.CANCELED);
      expect(history.map((s) => s.status)).toContain(SUBSCRIPTION_STATUS.ACTIVE);

      // 4. Verify only 1 active subscription is found by getActiveSubscription
      const active = await subscriptionService.getActiveSubscription(tenant.id);
      expect(active.id).toBe(sub2.id);
    });

    it('rejects reactivation if an active subscription is already in place', async () => {
      const tenant = await createTestTenant('duplicate-active');

      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Initial active plan',
      });

      await expect(
        subscriptionService.reactivateSubscription({
          tenantId: tenant.id,
          planCode: 'GROWTH',
          billingCycle: BILLING_CYCLE.MONTHLY,
          actorUserId: superadminUser.id,
        })
      ).rejects.toThrow(/already has an active subscription/i);
    });
  });

  describe('8. Background Cron Runner: Lifecycle Clock Transitions', () => {
    it('transitions expired trials to GRACE_PERIOD (72h)', async () => {
      const tenant = await createTestTenant('cron-trial-expire');

      const trialSub = await subscriptionService.provisionTrialSubscription({
        tenantId: tenant.id,
      });

      // Simulate trial expiration by setting trialEndsAt in the past
      const pastDate = new Date(Date.now() - 1000 * 60 * 60);
      await prisma.tenantSubscription.update({
        where: { id: trialSub.id },
        data: { trialEndsAt: pastDate },
      });

      // Execute cron runner
      const summary = await subscriptionService.runSubscriptionLifecycleCron();
      expect(summary.trialsExpired).toBeGreaterThanOrEqual(1);

      // Verify status transitioned to GRACE_PERIOD
      const updated = await subscriptionService.getActiveSubscription(tenant.id);
      expect(updated.status).toBe(SUBSCRIPTION_STATUS.GRACE_PERIOD);
      expect(updated.gracePeriodEndsAt).toBeDefined();
    });

    it('transitions expired GRACE_PERIOD to READ_ONLY (Decision D-04)', async () => {
      const tenant = await createTestTenant('cron-grace-expire');

      const sub = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Plan for grace expiration test',
      });

      // Simulate grace period expired in the past
      const pastGraceEnd = new Date(Date.now() - 1000 * 60 * 60);
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: {
          status: SUBSCRIPTION_STATUS.GRACE_PERIOD,
          gracePeriodEndsAt: pastGraceEnd,
        },
      });

      const summary = await subscriptionService.runSubscriptionLifecycleCron();
      expect(summary.graceToReadOnly).toBeGreaterThanOrEqual(1);

      const updated = await subscriptionService.getActiveSubscription(tenant.id);
      expect(updated.status).toBe(SUBSCRIPTION_STATUS.READ_ONLY);
    });

    it('transitions scheduled cancellations to CANCELED when period concludes', async () => {
      const tenant = await createTestTenant('cron-scheduled-cancel');

      const sub = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Plan for scheduled cancellation test',
      });

      await subscriptionService.scheduleCancellation({
        tenantId: tenant.id,
        cancellationReason: 'Scheduled cancellation for cron test',
        actorUserId: superadminUser.id,
      });

      // Simulate currentPeriodEnd passed
      const pastPeriodEnd = new Date(Date.now() - 1000 * 60 * 60);
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { currentPeriodEnd: pastPeriodEnd },
      });

      const summary = await subscriptionService.runSubscriptionLifecycleCron();
      expect(summary.scheduledCanceled).toBeGreaterThanOrEqual(1);

      const canceled = await prisma.tenantSubscription.findUnique({
        where: { id: sub.id },
      });
      expect(canceled.status).toBe(SUBSCRIPTION_STATUS.CANCELED);
      expect(canceled.canceledAt).toBeDefined();
    });
  });

  // =========================================================================
  // 9. Targeted Verification Area A: Concurrent Trial Provisioning
  // =========================================================================
  describe('9. Targeted Verification Area A: Concurrent Trial Provisioning', () => {
    it('concurrent calls to provisionTrialSubscription for the same tenant result in exactly one subscription and zero duplicate errors', async () => {
      const tenant = await createTestTenant('concurrent-trial');

      // Fire 3 simultaneous trial provisioning calls for the same tenant
      const results = await Promise.all([
        subscriptionService.provisionTrialSubscription({ tenantId: tenant.id }),
        subscriptionService.provisionTrialSubscription({ tenantId: tenant.id }),
        subscriptionService.provisionTrialSubscription({ tenantId: tenant.id }),
      ]);

      // All callers receive a valid subscription object
      expect(results[0]).toBeDefined();
      expect(results[1]).toBeDefined();
      expect(results[2]).toBeDefined();

      // All returned instances point to the EXACT same subscription ID
      expect(results[0].id).toBe(results[1].id);
      expect(results[1].id).toBe(results[2].id);
      expect(results[0].status).toBe(SUBSCRIPTION_STATUS.TRIAL);

      // Verify DB contains EXACTLY 1 subscription record for this tenant
      const subsInDb = await prisma.tenantSubscription.findMany({
        where: { tenantId: tenant.id },
      });
      expect(subsInDb).toHaveLength(1);

      // Verify only 1 audit record for trial start was created
      const auditRecords = await prisma.auditLog.findMany({
        where: {
          targetTenantId: tenant.id,
          action: AUDIT_ACTIONS.SUBSCRIPTION_TRIAL_STARTED,
        },
      });
      expect(auditRecords).toHaveLength(1);
    });

    it('repeated serial invocation remains completely idempotent and non-duplicating', async () => {
      const tenant = await createTestTenant('serial-idempotent-trial');

      const first = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });
      const second = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      expect(first.id).toBe(second.id);

      const count = await prisma.tenantSubscription.count({
        where: { tenantId: tenant.id },
      });
      expect(count).toBe(1);
    });
  });

  // =========================================================================
  // 10. Targeted Verification Area B: Concurrent Lifecycle Transitions & Row Locking
  // =========================================================================
  describe('10. Targeted Verification Area B: Concurrent Lifecycle Transitions & Row Locking', () => {
    it('pessimistic row locking serializes concurrent conflicting transitions without race-state corruption', async () => {
      const tenant = await createTestTenant('concurrent-transitions');

      // Assign initial active subscription
      const sub = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Initial plan for concurrency race test',
      });

      // Fire concurrent immediate cancel vs period extension
      const [cancelRes, extendRes] = await Promise.allSettled([
        subscriptionService.cancelSubscriptionImmediately({
          tenantId: tenant.id,
          reason: 'Racing immediate cancel',
          actorUserId: superadminUser.id,
        }),
        subscriptionService.extendSubscriptionPeriod({
          tenantId: tenant.id,
          extensionDays: 15,
          reason: 'Racing extension justification',
          actorUserId: superadminUser.id,
        }),
      ]);

      // Exactly one of two clean outcomes occurs depending on lock order:
      // Case 1: Cancel won lock -> Cancel fulfilled, Extend rejected with 404 (no active sub)
      // Case 2: Extend won lock -> Extend fulfilled, Cancel fulfilled (cancels extended sub)
      if (cancelRes.status === 'fulfilled') {
        const finalSub = await prisma.tenantSubscription.findUnique({ where: { id: sub.id } });
        // The final DB state is definitely consistent
        expect(['CANCELED', 'ACTIVE']).toContain(finalSub.status);
      }

      // In no circumstance is the DB state corrupted
      const activeSubs = await prisma.tenantSubscription.findMany({
        where: {
          tenantId: tenant.id,
          status: { in: ['TRIAL', 'ACTIVE', 'GRACE_PERIOD', 'READ_ONLY'] },
        },
      });
      expect(activeSubs.length).toBeLessThanOrEqual(1);
    });

    it('assertValidTransition strictly rejects invalid state jumps', () => {
      // Terminal states cannot transition in-place
      expect(() =>
        subscriptionService.assertValidTransition(SUBSCRIPTION_STATUS.CANCELED, SUBSCRIPTION_STATUS.ACTIVE)
      ).toThrowError(/Invalid subscription transition/);

      expect(() =>
        subscriptionService.assertValidTransition(SUBSCRIPTION_STATUS.EXPIRED, SUBSCRIPTION_STATUS.ACTIVE)
      ).toThrowError(/Invalid subscription transition/);

      expect(() =>
        subscriptionService.assertValidTransition(SUBSCRIPTION_STATUS.READ_ONLY, SUBSCRIPTION_STATUS.TRIAL)
      ).toThrowError(/Invalid subscription transition/);
    });
  });

  // =========================================================================
  // 11. Targeted Verification Area C: Transaction Rollback & Audit Atomicity
  // =========================================================================
  describe('11. Targeted Verification Area C: Transaction Rollback & Audit Atomicity', () => {
    it('rolls back plan assignment when audit event recording fails', async () => {
      const tenant = await createTestTenant('rollback-assign-plan');
      const initialTrial = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      const spy = vi.spyOn(auditService, 'recordAuditEvent').mockRejectedValueOnce(
        new Error('Simulated audit ledger persistence failure')
      );

      await expect(
        subscriptionService.assignPlan({
          tenantId: tenant.id,
          planCode: 'GROWTH',
          billingCycle: BILLING_CYCLE.MONTHLY,
          actorUserId: superadminUser.id,
          reason: 'Upgrade should rollback on audit failure',
        })
      ).rejects.toThrow('Simulated audit ledger persistence failure');

      spy.mockRestore();

      // Invariant Check: Tenant subscription must remain in TRIAL status with original plan
      const current = await subscriptionService.getActiveSubscription(tenant.id);
      expect(current.status).toBe(SUBSCRIPTION_STATUS.TRIAL);
      expect(current.planId).toBe(initialTrial.planId);
      expect(current.leaseVersion).toBe(initialTrial.leaseVersion);
    });

    it('rolls back period extension when audit recording fails', async () => {
      const tenant = await createTestTenant('rollback-extend');
      const sub = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Initial plan for extension rollback test',
      });

      const originalPeriodEnd = sub.currentPeriodEnd;

      const spy = vi.spyOn(auditService, 'recordAuditEvent').mockRejectedValueOnce(
        new Error('Simulated audit ledger persistence failure')
      );

      await expect(
        subscriptionService.extendSubscriptionPeriod({
          tenantId: tenant.id,
          extensionDays: 30,
          actorUserId: superadminUser.id,
          reason: 'Extension should rollback completely',
        })
      ).rejects.toThrow('Simulated audit ledger persistence failure');

      spy.mockRestore();

      const current = await subscriptionService.getActiveSubscription(tenant.id);
      expect(current.currentPeriodEnd.toISOString()).toBe(originalPeriodEnd.toISOString());
      expect(current.leaseVersion).toBe(sub.leaseVersion);
    });

    it('rolls back immediate cancellation when audit recording fails', async () => {
      const tenant = await createTestTenant('rollback-cancel');
      const sub = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Initial plan for cancel rollback test',
      });

      const spy = vi.spyOn(auditService, 'recordAuditEvent').mockRejectedValueOnce(
        new Error('Simulated audit failure during cancel')
      );

      await expect(
        subscriptionService.cancelSubscriptionImmediately({
          tenantId: tenant.id,
          reason: 'Administrative cancel rollback test',
          actorUserId: superadminUser.id,
        })
      ).rejects.toThrow('Simulated audit failure during cancel');

      spy.mockRestore();

      const current = await subscriptionService.getActiveSubscription(tenant.id);
      expect(current.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
      expect(current.canceledAt).toBeNull();
    });

    it('rolls back subscription reactivation when audit recording fails', async () => {
      const tenant = await createTestTenant('rollback-reactivate');
      await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'STARTER',
        billingCycle: BILLING_CYCLE.MONTHLY,
        actorUserId: superadminUser.id,
        reason: 'Plan to be canceled before reactivation rollback test',
      });

      await subscriptionService.cancelSubscriptionImmediately({
        tenantId: tenant.id,
        reason: 'Canceling for reactivation test',
        actorUserId: superadminUser.id,
      });

      const spy = vi.spyOn(auditService, 'recordAuditEvent').mockRejectedValueOnce(
        new Error('Simulated audit failure during reactivation')
      );

      await expect(
        subscriptionService.reactivateSubscription({
          tenantId: tenant.id,
          planCode: 'STARTER',
          billingCycle: BILLING_CYCLE.MONTHLY,
          actorUserId: superadminUser.id,
          reason: 'Reactivation rollback test',
        })
      ).rejects.toThrow('Simulated audit failure during reactivation');

      spy.mockRestore();

      // Invariant: No active subscription should exist
      const active = await subscriptionService.getActiveSubscription(tenant.id);
      expect(active).toBeNull();

      // Only 1 historical canceled subscription should exist
      const history = await subscriptionService.getSubscriptionHistory(tenant.id);
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe(SUBSCRIPTION_STATUS.CANCELED);
    });
  });

  // =========================================================================
  // 12. Targeted Verification Area D: Tenant Isolation & Cross-Tenant Boundary Defense
  // =========================================================================
  describe('12. Targeted Verification Area D: Tenant Isolation & Cross-Tenant Boundary Defense', () => {
    it('Tenant A cannot retrieve Tenant B active subscription', async () => {
      const tenantA = await createTestTenant('isolation-a-1');
      const tenantB = await createTestTenant('isolation-b-1');

      await subscriptionService.provisionTrialSubscription({ tenantId: tenantB.id });

      // Request for Tenant B with authorized context scoped to Tenant A
      await expect(
        subscriptionService.getActiveSubscription(tenantB.id, {
          authorizedTenantId: tenantA.id,
        })
      ).rejects.toMatchObject({
        code: 'TENANT_ACCESS_DENIED',
        statusCode: 403,
      });
    });

    it('Tenant A cannot retrieve Tenant B subscription history', async () => {
      const tenantA = await createTestTenant('isolation-a-2');
      const tenantB = await createTestTenant('isolation-b-2');

      await subscriptionService.provisionTrialSubscription({ tenantId: tenantB.id });

      await expect(
        subscriptionService.getSubscriptionHistory(tenantB.id, {
          authorizedTenantId: tenantA.id,
        })
      ).rejects.toMatchObject({
        code: 'TENANT_ACCESS_DENIED',
        statusCode: 403,
      });
    });

    it('Tenant A cannot schedule cancellation on Tenant B subscription', async () => {
      const tenantA = await createTestTenant('isolation-a-3');
      const tenantB = await createTestTenant('isolation-b-3');

      await subscriptionService.provisionTrialSubscription({ tenantId: tenantB.id });

      await expect(
        subscriptionService.scheduleCancellation({
          tenantId: tenantB.id,
          authorizedTenantId: tenantA.id,
          actorUserId: 'attacker-user',
        })
      ).rejects.toMatchObject({
        code: 'TENANT_ACCESS_DENIED',
        statusCode: 403,
      });
    });

    it('Tenant A cannot evaluate Tenant B subscription status', async () => {
      const tenantA = await createTestTenant('isolation-a-4');
      const tenantB = await createTestTenant('isolation-b-4');

      await expect(
        subscriptionService.evaluateTenantSubscriptionStatus(tenantB.id, {
          authorizedTenantId: tenantA.id,
        })
      ).rejects.toMatchObject({
        code: 'TENANT_ACCESS_DENIED',
        statusCode: 403,
      });
    });

    it('legitimate same-tenant access succeeds with authorizedTenantId', async () => {
      const tenant = await createTestTenant('legit-same-tenant');
      const trial = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      const fetched = await subscriptionService.getActiveSubscription(tenant.id, {
        authorizedTenantId: tenant.id,
      });
      expect(fetched).toBeDefined();
      expect(fetched.id).toBe(trial.id);
    });
  });

  // =========================================================================
  // 13. Targeted Verification Area E: Background Cron Idempotency & Concurrency Safety
  // =========================================================================
  describe('13. Targeted Verification Area E: Background Cron Idempotency & Concurrency Safety', () => {
    it('repeated serial execution of cron produces zero duplicate transitions and zero duplicate audit records', async () => {
      const tenant = await createTestTenant('cron-serial-idempotency');
      const sub = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      // Expire trial in past
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { trialEndsAt: new Date(Date.now() - 3600000) },
      });

      // Run 1: processes the expiration
      const run1 = await subscriptionService.runSubscriptionLifecycleCron();
      expect(run1.trialsExpired).toBeGreaterThanOrEqual(1);

      // Run 2 immediately: finds 0 to process
      const run2 = await subscriptionService.runSubscriptionLifecycleCron();
      expect(run2.trialsExpired).toBe(0);
      expect(run2.processedCount).toBe(0);

      // Verify exactly ONE SUBSCRIPTION_GRACE_ENTERED audit log for this tenant
      const graceAudits = await prisma.auditLog.findMany({
        where: {
          targetTenantId: tenant.id,
          action: AUDIT_ACTIONS.SUBSCRIPTION_GRACE_ENTERED,
        },
      });
      expect(graceAudits).toHaveLength(1);
    });

    it('concurrent cron executions safely partition transitions with zero duplicate audit events', async () => {
      const tenant1 = await createTestTenant('concurrent-cron-1');
      const tenant2 = await createTestTenant('concurrent-cron-2');

      const sub1 = await subscriptionService.provisionTrialSubscription({ tenantId: tenant1.id });
      const sub2 = await subscriptionService.provisionTrialSubscription({ tenantId: tenant2.id });

      const past = new Date(Date.now() - 3600000);
      await prisma.tenantSubscription.updateMany({
        where: { id: { in: [sub1.id, sub2.id] } },
        data: { trialEndsAt: past },
      });

      // Fire 2 cron runs concurrently
      const [cronResult1, cronResult2] = await Promise.all([
        subscriptionService.runSubscriptionLifecycleCron(),
        subscriptionService.runSubscriptionLifecycleCron(),
      ]);

      // Total trials expired across both workers equals at least 2 (both tenants transitioned)
      const totalTrialsExpired = cronResult1.trialsExpired + cronResult2.trialsExpired;
      expect(totalTrialsExpired).toBeGreaterThanOrEqual(2);

      // Invariant: Both tenants are now in GRACE_PERIOD
      const s1 = await subscriptionService.getActiveSubscription(tenant1.id);
      const s2 = await subscriptionService.getActiveSubscription(tenant2.id);
      expect(s1.status).toBe(SUBSCRIPTION_STATUS.GRACE_PERIOD);
      expect(s2.status).toBe(SUBSCRIPTION_STATUS.GRACE_PERIOD);

      // Invariant: Exactly 1 audit record per tenant
      const audits1 = await prisma.auditLog.findMany({
        where: { targetTenantId: tenant1.id, action: AUDIT_ACTIONS.SUBSCRIPTION_GRACE_ENTERED },
      });
      const audits2 = await prisma.auditLog.findMany({
        where: { targetTenantId: tenant2.id, action: AUDIT_ACTIONS.SUBSCRIPTION_GRACE_ENTERED },
      });
      expect(audits1).toHaveLength(1);
      expect(audits2).toHaveLength(1);
    });
  });

  // =========================================================================
  // 14. Final Review Finding 1: Suspended Subscription Lifecycle Consistency & Index Invariant
  // =========================================================================
  describe('14. Final Review Finding 1: Suspended Subscription Lifecycle Consistency & Index Invariant', () => {
    it('lockActiveSubscription acquires row lock on a SUSPENDED subscription matching partial unique index', async () => {
      const tenant = await createTestTenant('suspended-lock');
      const sub = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      // Administratively transition to SUSPENDED
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { status: SUBSCRIPTION_STATUS.SUSPENDED },
      });

      // Verify lockActiveSubscription finds and locks the row
      await prisma.$transaction(async (tx) => {
        const lockedRows = await subscriptionService.lockActiveSubscription(tenant.id, tx);
        expect(lockedRows).toHaveLength(1);
        expect(lockedRows[0].id).toBe(sub.id);
        expect(lockedRows[0].status).toBe(SUBSCRIPTION_STATUS.SUSPENDED);
      });
    });

    it('getActiveSubscription returns SUSPENDED subscription and treats it as a current subscription (not historical)', async () => {
      const tenant = await createTestTenant('suspended-get-active');
      const sub = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { status: SUBSCRIPTION_STATUS.SUSPENDED },
      });

      const active = await subscriptionService.getActiveSubscription(tenant.id);
      expect(active).toBeDefined();
      expect(active.id).toBe(sub.id);
      expect(active.status).toBe(SUBSCRIPTION_STATUS.SUSPENDED);
    });

    it('reactivateSubscription rejects with 409 when subscription is SUSPENDED, strictly enforcing single active invariant', async () => {
      const tenant = await createTestTenant('suspended-no-reactivate');
      const sub = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { status: SUBSCRIPTION_STATUS.SUSPENDED },
      });

      await expect(
        subscriptionService.reactivateSubscription({
          tenantId: tenant.id,
          planCode: 'STARTER',
          billingCycle: BILLING_CYCLE.MONTHLY,
          actorUserId: superadminUser.id,
          reason: 'Attempted reactivation while suspended',
        })
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining('SUSPENDED'),
      });

      // Invariant Check: Exactly 1 subscription record exists in database
      const count = await prisma.tenantSubscription.count({
        where: { tenantId: tenant.id },
      });
      expect(count).toBe(1);
    });

    it('assignPlan updates a SUSPENDED subscription in-place to ACTIVE without inserting duplicate rows', async () => {
      const tenant = await createTestTenant('suspended-assign-plan');
      const sub = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { status: SUBSCRIPTION_STATUS.SUSPENDED },
      });

      const updated = await subscriptionService.assignPlan({
        tenantId: tenant.id,
        planCode: 'GROWTH',
        billingCycle: BILLING_CYCLE.ANNUAL,
        actorUserId: superadminUser.id,
        reason: 'Superadmin restoring suspended subscription to commercial active',
      });

      expect(updated.id).toBe(sub.id);
      expect(updated.status).toBe(SUBSCRIPTION_STATUS.ACTIVE);
      expect(updated.leaseVersion).toBe(sub.leaseVersion + 1);

      // Verify no second row was inserted
      const count = await prisma.tenantSubscription.count({
        where: { tenantId: tenant.id },
      });
      expect(count).toBe(1);
    });

    it('runSubscriptionLifecycleCron completely ignores SUSPENDED subscriptions', async () => {
      const tenant = await createTestTenant('suspended-cron-ignored');
      const sub = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      // Put into SUSPENDED and set dates in the past
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: {
          status: SUBSCRIPTION_STATUS.SUSPENDED,
          currentPeriodEnd: new Date(Date.now() - 3600000),
          trialEndsAt: new Date(Date.now() - 3600000),
        },
      });

      const summary = await subscriptionService.runSubscriptionLifecycleCron();
      expect(summary.processedCount).toBe(0);

      const unchanged = await subscriptionService.getActiveSubscription(tenant.id);
      expect(unchanged.status).toBe(SUBSCRIPTION_STATUS.SUSPENDED);
    });

    it('evaluates subscription status correctly distinguishing tenant suspension from subscription suspension', async () => {
      const tenant = await createTestTenant('eval-suspension-decoupling');
      const sub = await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      // Case 1: Subscription is SUSPENDED, Tenant is ACTIVE
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { status: SUBSCRIPTION_STATUS.SUSPENDED },
      });

      const eval1 = await subscriptionService.evaluateTenantSubscriptionStatus(tenant.id);
      expect(eval1.tenantStatus).toBe('ACTIVE');
      expect(eval1.isTenantSuspended).toBe(false);
      expect(eval1.isSubscriptionSuspended).toBe(true);

      // Case 2: Tenant is SUSPENDED, Subscription is ACTIVE
      await prisma.tenant.update({
        where: { id: tenant.id },
        data: { status: 'SUSPENDED' },
      });
      await prisma.tenantSubscription.update({
        where: { id: sub.id },
        data: { status: SUBSCRIPTION_STATUS.ACTIVE },
      });

      const eval2 = await subscriptionService.evaluateTenantSubscriptionStatus(tenant.id);
      expect(eval2.tenantStatus).toBe('SUSPENDED');
      expect(eval2.isTenantSuspended).toBe(true);
      expect(eval2.isSubscriptionSuspended).toBe(false);
      expect(eval2.isActiveOrTrial).toBe(true);
    });
  });

  // =========================================================================
  // 15. Final Review Finding 2: Privileged Authorization & Server Context Trust Boundary
  // =========================================================================
  describe('15. Final Review Finding 2: Privileged Authorization & Server Context Trust Boundary', () => {
    it('assignPlan rejects non-SUPERADMIN actorRole with 403 UNAUTHORIZED_ROLE', async () => {
      const tenant = await createTestTenant('auth-boundary-assign');

      await expect(
        subscriptionService.assignPlan({
          tenantId: tenant.id,
          planCode: 'STARTER',
          billingCycle: BILLING_CYCLE.MONTHLY,
          actorUserId: 'some-user-id',
          actorRole: 'STORE_OWNER',
          reason: 'Unauthorized plan assignment attempt',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'UNAUTHORIZED_ROLE',
      });
    });

    it('extendSubscriptionPeriod rejects non-SUPERADMIN actorRole with 403 UNAUTHORIZED_ROLE', async () => {
      const tenant = await createTestTenant('auth-boundary-extend');
      await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      await expect(
        subscriptionService.extendSubscriptionPeriod({
          tenantId: tenant.id,
          extensionDays: 14,
          actorUserId: 'some-user-id',
          actorRole: 'STORE_OWNER',
          reason: 'Unauthorized extension attempt',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'UNAUTHORIZED_ROLE',
      });
    });

    it('cancelSubscriptionImmediately rejects non-SUPERADMIN actorRole with 403 UNAUTHORIZED_ROLE', async () => {
      const tenant = await createTestTenant('auth-boundary-cancel');
      await subscriptionService.provisionTrialSubscription({ tenantId: tenant.id });

      await expect(
        subscriptionService.cancelSubscriptionImmediately({
          tenantId: tenant.id,
          reason: 'Unauthorized immediate cancellation',
          actorUserId: 'some-user-id',
          actorRole: 'STORE_OWNER',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'UNAUTHORIZED_ROLE',
      });
    });

    it('provisionTrialSubscription rejects cross-tenant authorizedTenantId with 403 TENANT_ACCESS_DENIED', async () => {
      const tenantA = await createTestTenant('auth-boundary-trial-a');
      const tenantB = await createTestTenant('auth-boundary-trial-b');

      await expect(
        subscriptionService.provisionTrialSubscription({
          tenantId: tenantB.id,
          authorizedTenantId: tenantA.id,
          actorUserId: 'owner-a',
          actorRole: 'STORE_OWNER',
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'TENANT_ACCESS_DENIED',
      });
    });
  });
});
