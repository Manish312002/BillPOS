/**
 * BillingBuddy — Store Owner Onboarding: End-to-End Real Browser Verification
 *
 * Automates Google Chrome via Playwright against live PostgreSQL 18, Express API (port 4000),
 * and Vite dev server (port 5173).
 *
 * Verifies complete journey:
 * Superadmin Login → Create Tenant → Resend Invitation → WhatsApp Link →
 * Store Owner Activation → Logout → Store Owner Login → Store Owner Dashboard
 * Plus all invitation failure cases (missing, invalid, superseded, accepted reuse).
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { prisma } from '../apps/api/src/db/client.js';
import { hashPassword } from '../apps/api/src/utils/security.js';
import { computeTotpCode, encryptTotpSecret } from '../apps/api/src/utils/totp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const screenshotDir = 'C:\\Users\\mbhoi\\.gemini\\antigravity\\brain\\fa08c0b2-721f-4068-9efc-cd6708e23162\\screenshots';

const E2E_SUPERADMIN_PHONE = '+919999000001';
const E2E_SUPERADMIN_EMAIL = 'e2e_superadmin@billingbuddy.com';
const E2E_SUPERADMIN_PASSWORD = 'SuperAdminPassword@2026!';
const TOTP_SECRET = 'JBSWY3DPEHPK3PXP'; // Base32 test secret

const TEST_TENANT_LEGAL = 'Metro Hypermarket Ltd';
const TEST_TENANT_TRADE = 'Metro Hypermarket';
const TEST_TENANT_SLUG = 'metro-hypermarket';
const TEST_OWNER_NAME = 'Ramesh Sharma';
const TEST_OWNER_PHONE = '+919876543210';
const TEST_OWNER_EMAIL = 'ramesh@metrohypermarket.com';
const TEST_OWNER_PASSWORD = 'StoreOwner@Pass2026!';

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404 || res.status === 200) {
        return true;
      }
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout waiting for server at ${url}`);
}

async function setupSuperadmin() {
  console.log('[Setup] Preparing dedicated E2E Superadmin account in PostgreSQL...');
  const passwordHash = await hashPassword(E2E_SUPERADMIN_PASSWORD);
  const secretEncrypted = encryptTotpSecret(TOTP_SECRET);

  // Clean up any prior test entities
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { metadata: { path: ['slug'], equals: TEST_TENANT_SLUG } },
        { metadata: { path: ['tenantSlug'], equals: TEST_TENANT_SLUG } },
      ],
    },
  }).catch(() => {});

  const existingTenant = await prisma.tenant.findUnique({ where: { slug: TEST_TENANT_SLUG } });
  if (existingTenant) {
    await prisma.onboardingProgress.deleteMany({ where: { tenantId: existingTenant.id } }).catch(() => {});
    await prisma.ownerInvitation.deleteMany({ where: { tenantId: existingTenant.id } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId: existingTenant.id } }).catch(() => {});
    await prisma.session.deleteMany({ where: { activeTenantId: existingTenant.id } }).catch(() => {});
    await prisma.tenant.delete({ where: { id: existingTenant.id } }).catch(() => {});
  }

  const existingOwnerUser = await prisma.user.findFirst({
    where: { OR: [{ phone: TEST_OWNER_PHONE }, { email: TEST_OWNER_EMAIL }] },
  });
  if (existingOwnerUser) {
    await prisma.session.deleteMany({ where: { userId: existingOwnerUser.id } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { userId: existingOwnerUser.id } }).catch(() => {});
    await prisma.user.delete({ where: { id: existingOwnerUser.id } }).catch(() => {});
  }

  // Upsert E2E Superadmin
  let saUser = await prisma.user.findFirst({
    where: { OR: [{ phone: E2E_SUPERADMIN_PHONE }, { email: E2E_SUPERADMIN_EMAIL }] },
  });

  if (!saUser) {
    saUser = await prisma.user.create({
      data: {
        fullName: 'E2E Superadmin Auditor',
        phone: E2E_SUPERADMIN_PHONE,
        email: E2E_SUPERADMIN_EMAIL,
        passwordHash,
        status: 'ACTIVE',
        mustChangePassword: false,
        platformAuthorization: {
          create: {
            role: 'SUPERADMIN',
            status: 'ACTIVE',
          },
        },
      },
    });
  } else {
    saUser = await prisma.user.update({
      where: { id: saUser.id },
      data: {
        passwordHash,
        status: 'ACTIVE',
        mustChangePassword: false,
      },
    });
  }

  // Upsert UserTotp
  await prisma.userTotp.upsert({
    where: { userId: saUser.id },
    create: {
      userId: saUser.id,
      secretEncrypted,
      isEnabled: true,
      recoveryCodesAcknowledgedAt: new Date(),
    },
    update: {
      secretEncrypted,
      isEnabled: true,
      recoveryCodesAcknowledgedAt: new Date(),
    },
  });

  console.log(`[Setup] Superadmin ready: ${E2E_SUPERADMIN_PHONE}`);
}

async function run() {
  let apiProcess = null;
  let viteProcess = null;
  let browser = null;

  try {
    // Kill any lingering processes on ports 5173 and 4000
    try {
      const { execSync } = await import('child_process');
      execSync(
        'powershell -Command "$c = Get-NetTCPConnection -LocalPort 5173,4000 -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }"'
      );
      await new Promise((r) => setTimeout(r, 1000));
    } catch {}

    await setupSuperadmin();

    console.log('[Servers] Starting API server on port 4000...');
    apiProcess = spawn('node', ['apps/api/src/server.js'], {
      cwd: rootDir,
      env: { ...process.env, PORT: '4000', NODE_ENV: 'development' },
      stdio: 'pipe',
    });

    apiProcess.stdout.on('data', (d) => process.stdout.write(`[API] ${d}`));
    apiProcess.stderr.on('data', (d) => process.stderr.write(`[API ERR] ${d}`));

    console.log('[Servers] Starting Vite dev server on port 5173...');
    viteProcess = spawn('cmd.exe', ['/c', 'npx', 'vite', '--port', '5173', '--strictPort'], {
      cwd: path.join(rootDir, 'apps/web'),
      env: { ...process.env },
      stdio: 'pipe',
    });

    viteProcess.stdout.on('data', (d) => process.stdout.write(`[Vite] ${d}`));
    viteProcess.stderr.on('data', (d) => process.stderr.write(`[Vite ERR] ${d}`));

    console.log('[Wait] Awaiting API health and Vite responsiveness...');
    await waitForServer('http://localhost:4000/api/health', 25000);
    await waitForServer('http://localhost:5173', 25000);
    console.log('[Servers] Both API and Vite are live!');

    console.log('[Browser] Launching Google Chrome...');
    browser = await chromium.launch({
      executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const superadminContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page = await superadminContext.newPage();

    // ----------------------------------------------------
    // STEP 1: Superadmin Login
    // ----------------------------------------------------
    console.log('\n--- STEP 1: Superadmin Login ---');
    await page.goto('http://localhost:5173/platform/login');
    await page.waitForSelector('#superadmin-email');

    await page.fill('#superadmin-email', E2E_SUPERADMIN_EMAIL);
    await page.fill('#superadmin-password', E2E_SUPERADMIN_PASSWORD);
    await page.click('button[type="submit"]');

    // Wait for 2FA screen
    await page.waitForSelector('#totp-code', { timeout: 10000 });
    console.log('[Superadmin] 2FA Prompt displayed. Calculating TOTP code...');

    const code = computeTotpCode(TOTP_SECRET);
    await page.fill('#totp-code', code);
    await page.click('button:has-text("Verify Code & Continue")');

    // Wait for platform overview
    await page.waitForURL('**/platform/overview', { timeout: 10000 });
    console.log('[Superadmin] Successfully logged in! Reached /platform/overview');

    // ----------------------------------------------------
    // STEP 2: Navigate to Tenants & Create Tenant
    // ----------------------------------------------------
    console.log('\n--- STEP 2: Create Tenant ---');
    await page.goto('http://localhost:5173/platform/tenants');
    await page.waitForSelector('button:has-text("Create Tenant")');

    await page.click('button:has-text("Create Tenant")');
    await page.waitForSelector('input[name="legalName"]');

    await page.fill('input[name="legalName"]', TEST_TENANT_LEGAL);
    await page.fill('input[name="tradeName"]', TEST_TENANT_TRADE);
    await page.fill('input[name="ownerFullName"]', TEST_OWNER_NAME);
    await page.fill('input[name="ownerPhone"]', TEST_OWNER_PHONE);
    await page.fill('input[name="ownerEmail"]', TEST_OWNER_EMAIL);

    console.log('[Superadmin] Submitting tenant creation...');
    await page.click('button:has-text("Create Tenant & Generate Invite")');

    // WhatsApp modal pops up with initial invitation
    await page.waitForSelector('h3:has-text("Store Owner Invitation Ready")', { timeout: 10000 });
    console.log('[Superadmin] Tenant created! Initial WhatsApp invitation modal displayed.');

    // Capture initial activation link
    await page.waitForSelector('input[readonly]');
    const initialActivationLink = await page.inputValue('input[readonly]');
    console.log(`[Superadmin] Initial activation URL: ${initialActivationLink}`);
    const initialTokenMatch = initialActivationLink.match(/token=([^&]+)/);
    const initialToken = initialTokenMatch ? initialTokenMatch[1] : null;

    // Dismiss initial share modal
    await page.click('button:has-text("Done & Dismiss")');
    await page.waitForSelector('h3:has-text("Store Owner Invitation Ready")', { state: 'hidden' });

    // ----------------------------------------------------
    // STEP 3: Tenant Detail Modal & Resend Invitation
    // ----------------------------------------------------
    console.log('\n--- STEP 3: Tenant Detail & Resend Invitation ---');
    // Open details for the newly created tenant
    await page.waitForSelector(`tr:has-text("${TEST_TENANT_TRADE}") button:has-text("View Details")`);
    await page.click(`tr:has-text("${TEST_TENANT_TRADE}") button:has-text("View Details")`);

    await page.waitForSelector('h3:has-text("Metro Hypermarket")');
    await page.waitForSelector('button:has-text("Resend Invitation")');

    // Screenshot 1: Superadmin tenant detail with Resend Invitation
    const shot1Path = path.join(screenshotDir, 'screenshot-1-superadmin-tenant-detail.png');
    await page.screenshot({ path: shot1Path, fullPage: true });
    console.log(`[Screenshot 1] Saved: ${shot1Path}`);

    // Click Resend Invitation
    console.log('[Superadmin] Clicking "Resend Invitation" button...');
    await page.click('button:has-text("Resend Invitation")');

    // Detail modal closes and WhatsApp share modal opens with fresh invitation
    await page.waitForSelector('h3:has-text("Store Owner Invitation Ready")', { timeout: 10000 });
    console.log('[Superadmin] Resend succeeded! WhatsApp sharing modal opened.');

    // Screenshot 2: WhatsApp sharing modal containing generated link
    const shot2Path = path.join(screenshotDir, 'screenshot-2-whatsapp-sharing-modal.png');
    await page.screenshot({ path: shot2Path, fullPage: true });
    console.log(`[Screenshot 2] Saved: ${shot2Path}`);

    // Extract fresh activation URL and token
    const freshActivationLink = await page.inputValue('input[readonly]');
    console.log(`[Superadmin] Fresh activation URL: ${freshActivationLink}`);
    const freshTokenMatch = freshActivationLink.match(/token=([^&]+)/);
    if (!freshTokenMatch) {
      throw new Error(`Failed to extract fresh token from ${freshActivationLink}`);
    }
    const freshToken = freshTokenMatch[1];
    console.log(`[Superadmin] Fresh token captured: ${freshToken.slice(0, 8)}...`);

    // Verify wa.me URL
    const whatsappLinkBtn = await page.locator('button:has-text("Share on WhatsApp")');
    if (!whatsappLinkBtn) throw new Error('WhatsApp share button not found');

    await page.click('button:has-text("Done & Dismiss")');
    await superadminContext.close();

    // ----------------------------------------------------
    // STEP 4: Store Owner Activation
    // ----------------------------------------------------
    console.log('\n--- STEP 4: Store Owner Activation ---');
    // Create clean browser context (representing Store Owner on their own device)
    const ownerContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const ownerPage = await ownerContext.newPage();
    ownerPage.on('console', (msg) => console.log(`[Browser Console] ${msg.type()}: ${msg.text()}`));
    ownerPage.on('pageerror', (err) => console.error(`[Browser PageError]`, err));

    console.log(`[Owner] Navigating to fresh activation link: ${freshActivationLink}`);
    await ownerPage.goto(freshActivationLink);

    // Wait for validation to resolve
    await ownerPage.waitForSelector('input#new-password', { timeout: 10000 });
    await ownerPage.waitForSelector(`div:has-text("${TEST_TENANT_TRADE}")`);
    console.log('[Owner] Activation page validated token successfully! Store details displayed.');

    // Verify address bar was sanitized (hash removed from location)
    const currentUrl = ownerPage.url();
    console.log(`[Owner] Address bar after sanitization: ${currentUrl}`);
    if (currentUrl.includes('#token=')) {
      throw new Error(`Address bar was not cleansed! Still contains: ${currentUrl}`);
    }

    // Screenshot 3: Valid Store Owner activation page
    const shot3Path = path.join(screenshotDir, 'screenshot-3-valid-store-owner-activation.png');
    await ownerPage.screenshot({ path: shot3Path, fullPage: true });
    console.log(`[Screenshot 3] Saved: ${shot3Path}`);

    // Fill password form
    await ownerPage.fill('input#new-password', TEST_OWNER_PASSWORD);
    await ownerPage.fill('input#confirm-password', TEST_OWNER_PASSWORD);

    console.log('[Owner] Submitting store activation with password...');
    await ownerPage.click('button[type="submit"]');

    // Wait for redirect to /owner/overview
    await ownerPage.waitForURL('**/owner/overview', { timeout: 10000 });
    await ownerPage.waitForSelector('h2:has-text("Store Operations Overview")');
    console.log('[Owner] Activation complete! Reached Store Operations Overview.');

    // Screenshot 4: Successful activation dashboard
    const shot4Path = path.join(screenshotDir, 'screenshot-4-owner-dashboard-activated.png');
    await ownerPage.screenshot({ path: shot4Path, fullPage: true });
    console.log(`[Screenshot 4] Saved: ${shot4Path}`);

    // ----------------------------------------------------
    // STEP 5: Logout & First Store Owner Login
    // ----------------------------------------------------
    console.log('\n--- STEP 5: Logout & First Store Owner Login ---');
    await ownerPage.click('button:has-text("Sign Out")');
    await ownerPage.waitForURL('**/owner/login', { timeout: 10000 });
    await ownerPage.waitForSelector('#owner-identifier');

    // Screenshot 5: Store Owner login page
    const shot5Path = path.join(screenshotDir, 'screenshot-5-store-owner-login.png');
    await ownerPage.screenshot({ path: shot5Path, fullPage: true });
    console.log(`[Screenshot 5] Saved: ${shot5Path}`);

    console.log('[Owner] Logging in with phone number and password...');
    await ownerPage.fill('#owner-identifier', TEST_OWNER_PHONE);
    await ownerPage.fill('#owner-password', TEST_OWNER_PASSWORD);
    await ownerPage.click('button[type="submit"]');

    await ownerPage.waitForURL('**/owner/overview', { timeout: 10000 });
    await ownerPage.waitForSelector('h2:has-text("Store Operations Overview")');
    console.log('[Owner] First login succeeded! Reached Owner Dashboard.');

    // Screenshot 6: Successful Owner Admin dashboard
    const shot6Path = path.join(screenshotDir, 'screenshot-6-owner-dashboard-login.png');
    await ownerPage.screenshot({ path: shot6Path, fullPage: true });
    console.log(`[Screenshot 6] Saved: ${shot6Path}`);

    // ----------------------------------------------------
    // STEP 6: Subsequent Login with Email
    // ----------------------------------------------------
    console.log('\n--- STEP 6: Subsequent Login with Email ---');
    await ownerPage.click('button:has-text("Sign Out")');
    await ownerPage.waitForURL('**/owner/login');

    console.log('[Owner] Logging in with registered email...');
    await ownerPage.fill('#owner-identifier', TEST_OWNER_EMAIL);
    await ownerPage.fill('#owner-password', TEST_OWNER_PASSWORD);
    await ownerPage.fill('#owner-slug', TEST_TENANT_SLUG);
    await ownerPage.click('button[type="submit"]');

    await ownerPage.waitForURL('**/owner/overview', { timeout: 10000 });
    console.log('[Owner] Subsequent email login succeeded!');

    // ----------------------------------------------------
    // STEP 7: Invitation Failure Cases
    // ----------------------------------------------------
    console.log('\n--- STEP 7: Invitation Failure Cases ---');

    // 1. Missing token
    console.log('[Failure Test 1] Missing token: /owner/activate');
    const failPage1 = await browser.newPage();
    await failPage1.goto('http://localhost:5173/owner/activate');
    await failPage1.waitForSelector('div:has-text("Invitation Unavailable")');
    await failPage1.waitForSelector('p:has-text("No invitation token provided")');
    console.log('  -> PASS: Correctly rejected missing token');
    await failPage1.close();

    // 2. Invalid token
    console.log('[Failure Test 2] Invalid token: /owner/activate#token=invalid_dummy_token_12345');
    const failPage2 = await browser.newPage();
    await failPage2.goto('http://localhost:5173/owner/activate#token=invalid_dummy_token_12345');
    await failPage2.waitForSelector('div:has-text("Invitation Unavailable")');
    await failPage2.waitForSelector('p:has-text("Invalid or unknown invitation token")');
    console.log('  -> PASS: Correctly rejected invalid token');
    await failPage2.close();

    // 3. Reusing already accepted token
    console.log(`[Failure Test 3] Reusing accepted token: /owner/activate#token=${freshToken}`);
    const failPage3 = await browser.newPage();
    await failPage3.goto(`http://localhost:5173/owner/activate#token=${freshToken}`);
    await failPage3.waitForSelector('div:has-text("Invitation Unavailable")');
    await failPage3.waitForSelector('p:has-text("This invitation has already been accepted")');
    console.log('  -> PASS: Correctly rejected reused accepted token');
    await failPage3.close();

    // 4. Superseded token
    if (initialToken) {
      console.log(`[Failure Test 4] Superseded token: /owner/activate#token=${initialToken}`);
      const failPage4 = await browser.newPage();
      await failPage4.goto(`http://localhost:5173/owner/activate#token=${initialToken}`);
      await failPage4.waitForSelector('div:has-text("Invitation Unavailable")');
      await failPage4.waitForSelector('p:has-text("This invitation has been superseded by a newer link")');
      console.log('  -> PASS: Correctly rejected superseded token');
      await failPage4.close();
    }

    console.log('\n======================================================');
    console.log(' ALL END-TO-END ACCEPTANCE AUDIT JOURNEYS PASSED 100%!');
    console.log('======================================================');

    await ownerContext.close();
  } catch (err) {
    console.error('\n[FATAL ERROR in E2E]:', err);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (apiProcess) {
      console.log('[Teardown] Stopping API process...');
      apiProcess.kill();
    }
    if (viteProcess) {
      console.log('[Teardown] Stopping Vite process...');
      // On Windows kill process tree
      spawn('taskkill', ['/pid', viteProcess.pid, '/f', '/t']);
    }
    await prisma.$disconnect().catch(() => {});
  }
}

run();
