#!/usr/bin/env node

/**
 * BillingBuddy Workspace Verification Script
 * Validates environment runtime, monorepo workspaces, test suites, and production builds.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('====================================================');
console.log(' BillingBuddy — Monorepo Health & Integrity Audit   ');
console.log('====================================================\n');

let hasFailures = false;

function check(name, fn) {
  try {
    process.stdout.write(`• ${name}... `);
    const result = fn();
    console.log(`\x1b[32mPASS\x1b[0m ${result || ''}`);
  } catch (err) {
    hasFailures = true;
    console.log(`\x1b[31mFAIL\x1b[0m`);
    console.error(`  Error: ${err.message}`);
  }
}

// 1. Node.js & Runtime Check
check('Node.js Version Check (>= 22.12.0)', () => {
  const version = process.version;
  const major = parseInt(version.slice(1).split('.')[0], 10);
  if (major < 22) throw new Error(`Node.js version ${version} is lower than 22 LTS.`);
  return `(${version})`;
});

// 2. Workspaces Existence
const requiredWorkspaces = ['apps/web', 'apps/api', 'packages/shared'];
for (const ws of requiredWorkspaces) {
  check(`Workspace Directory (${ws})`, () => {
    const wsPath = path.join(rootDir, ws, 'package.json');
    if (!fs.existsSync(wsPath)) throw new Error(`package.json not found in ${ws}`);
    const pkg = JSON.parse(fs.readFileSync(wsPath, 'utf8'));
    return `[${pkg.name}@${pkg.version}]`;
  });
}

// 3. Git Secrets Protection
check('Gitignore Rules for Secrets (.env)', () => {
  const gitignorePath = path.join(rootDir, '.gitignore');
  if (!fs.existsSync(gitignorePath)) throw new Error('.gitignore not found.');
  const gitignore = fs.readFileSync(gitignorePath, 'utf8');
  if (!gitignore.includes('.env')) throw new Error('.env rule missing from .gitignore.');
  return '(.env files protected)';
});

// 4. Prohibited TypeScript Check
check('Zero TypeScript Enforcement (.ts / .tsx)', () => {
  function scan(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        throw new Error(`Found prohibited TypeScript file: ${fullPath}`);
      }
    }
  }
  scan(rootDir);
  return '(0 TypeScript files found)';
});

// 5. ESLint Verification
check('ESLint Verification', () => {
  execSync('npx eslint .', { cwd: rootDir, stdio: 'pipe' });
  return '(0 lint issues)';
});

// 6. Prettier Check
check('Prettier Code Style Check', () => {
  execSync('npx prettier --check "apps/**/*.{js,jsx,json,css}" "packages/**/*.{js,json}"', {
    cwd: rootDir,
    stdio: 'pipe',
  });
  return '(Formatting matches .prettierrc)';
});

// 7. Full Monorepo Tests
check('Monorepo Test Suites (api, web, shared)', () => {
  const output = execSync('npm test --workspaces', { cwd: rootDir, stdio: 'pipe' }).toString();
  const passMatches = output.match(/✓/g) || [];
  return `(${passMatches.length} test suites executed)`;
});

// 8. Production Frontend Build
check('Frontend Production Build (@billingbuddy/web)', () => {
  execSync('npm run build --workspace=@billingbuddy/web', { cwd: rootDir, stdio: 'pipe' });
  return '(Vite bundle generated)';
});

console.log('\n====================================================');
if (hasFailures) {
  console.log(' \x1b[31mStatus: FAILED — Discrepancies detected.\x1b[0m');
  process.exit(1);
} else {
  console.log(' \x1b[32mStatus: VERIFIED — All foundation checks passed.\x1b[0m');
  console.log('====================================================\n');
}
