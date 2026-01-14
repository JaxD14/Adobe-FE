/**
 * Smoke Tests - Incident Fix Verification
 * 
 * Validates that the PERF-2847 revert is correct and the config
 * values will allow users to access their saved work again.
 */

import { 
  renderingConfig, 
  isFileSizeAllowed, 
  getConfigForTier,
  getTimeoutForFileSize 
} from './shared/config/rendering.config';

let passed = 0;
let failed = 0;

function test(name: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`✅ PASS: ${name}`);
    passed++;
  } else {
    console.log(`❌ FAIL: ${name}`);
    if (details) console.log(`   Details: ${details}`);
    failed++;
  }
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  SMOKE TESTS - Adobe Photoshop Outage Fix Verification');
console.log('═══════════════════════════════════════════════════════════════\n');

// ============================================================================
// Critical Config Values (Root Cause of Outage)
// ============================================================================
console.log('🔧 CRITICAL CONFIG VALUES\n');

test(
  'maxFileSizeMB should be 500 (was reduced to 100)',
  renderingConfig.maxFileSizeMB === 500,
  `Current value: ${renderingConfig.maxFileSizeMB}`
);

test(
  'renderTimeoutMs should be 120000ms (was reduced to 30000)',
  renderingConfig.renderTimeoutMs === 120000,
  `Current value: ${renderingConfig.renderTimeoutMs}ms`
);

test(
  'syncTimeoutMs should be 120000ms (was reduced to 60000)',
  renderingConfig.syncTimeoutMs === 120000,
  `Current value: ${renderingConfig.syncTimeoutMs}ms`
);

test(
  'maxConcurrentJobs should be 10 (was reduced to 3)',
  renderingConfig.maxConcurrentJobs === 10,
  `Current value: ${renderingConfig.maxConcurrentJobs}`
);

// ============================================================================
// File Size Validation (Users couldn't access files >100MB)
// ============================================================================
console.log('\n📁 FILE SIZE VALIDATION\n');

test(
  'Small files (50MB) should be allowed',
  isFileSizeAllowed(50) === true
);

test(
  'Medium files (150MB) should be allowed',
  isFileSizeAllowed(150) === true,
  'These were being rejected before the fix'
);

test(
  'Large files (250MB) should be allowed',
  isFileSizeAllowed(250) === true,
  'Enterprise users have files this size'
);

test(
  'Enterprise-size files (450MB) should be allowed',
  isFileSizeAllowed(450) === true,
  'Enterprise SLA guarantees 500MB support'
);

test(
  'Files at limit (500MB) should be allowed',
  isFileSizeAllowed(500) === true
);

test(
  'Files over limit (501MB) should be rejected',
  isFileSizeAllowed(501) === false
);

// ============================================================================
// Tier Configuration (Enterprise was inheriting broken base config)
// ============================================================================
console.log('\n👥 TIER CONFIGURATION\n');

const freeConfig = getConfigForTier('free');
const proConfig = getConfigForTier('pro');
const enterpriseConfig = getConfigForTier('enterprise');

test(
  'Free tier maxFileSizeMB should be 50',
  freeConfig.maxFileSizeMB === 50,
  `Current value: ${freeConfig.maxFileSizeMB}`
);

test(
  'Pro tier maxFileSizeMB should be 200',
  proConfig.maxFileSizeMB === 200,
  `Current value: ${proConfig.maxFileSizeMB}`
);

test(
  'Enterprise tier maxFileSizeMB should be 500 (was broken - inherited 100)',
  enterpriseConfig.maxFileSizeMB === 500,
  `Current value: ${enterpriseConfig.maxFileSizeMB}`
);

test(
  'Enterprise tier should have GPU rendering enabled',
  enterpriseConfig.enableGpuRendering === true
);

test(
  'Enterprise tier should have batch optimization enabled',
  enterpriseConfig.enableBatchOptimization === true
);

test(
  'Enterprise tier maxConcurrentJobs should be 10',
  enterpriseConfig.maxConcurrentJobs === 10,
  `Current value: ${enterpriseConfig.maxConcurrentJobs}`
);

// ============================================================================
// Timeout Calculations (Large files were timing out)
// ============================================================================
console.log('\n⏱️  TIMEOUT CALCULATIONS\n');

const smallFileTimeout = getTimeoutForFileSize(10, 'render');
const mediumFileTimeout = getTimeoutForFileSize(100, 'render');
const largeFileTimeout = getTimeoutForFileSize(300, 'render');

test(
  'Small file (10MB) render timeout should be reasonable',
  smallFileTimeout >= 120000 && smallFileTimeout <= 150000,
  `Timeout: ${smallFileTimeout}ms`
);

test(
  'Medium file (100MB) render timeout should scale up',
  mediumFileTimeout >= 200000,
  `Timeout: ${mediumFileTimeout}ms`
);

test(
  'Large file (300MB) render timeout should be sufficient',
  largeFileTimeout >= 300000,
  `Timeout: ${largeFileTimeout}ms (needs ~45s processing time)`
);

const syncTimeout = getTimeoutForFileSize(200, 'sync');
test(
  'Sync timeout for 200MB file should be sufficient',
  syncTimeout >= 300000,
  `Timeout: ${syncTimeout}ms`
);

// ============================================================================
// Scenario Tests (Simulating actual user workflows)
// ============================================================================
console.log('\n🎬 USER SCENARIO TESTS\n');

// Scenario 1: Enterprise user with large PSD
const enterpriseFile = { sizeMB: 350, tierLimit: enterpriseConfig.maxFileSizeMB! };
test(
  'Scenario: Enterprise user can access 350MB PSD file',
  enterpriseFile.sizeMB <= enterpriseFile.tierLimit && isFileSizeAllowed(enterpriseFile.sizeMB),
  'This was failing before - users couldn\'t access saved work'
);

// Scenario 2: Pro user with medium file
const proFile = { sizeMB: 150, tierLimit: proConfig.maxFileSizeMB! };
test(
  'Scenario: Pro user can access 150MB PSD file',
  proFile.sizeMB <= proFile.tierLimit && isFileSizeAllowed(proFile.sizeMB)
);

// Scenario 3: Free user respects limits
const freeFile = { sizeMB: 60, tierLimit: freeConfig.maxFileSizeMB! };
test(
  'Scenario: Free user correctly limited to 50MB',
  freeFile.sizeMB > freeFile.tierLimit,
  'Free tier should still have 50MB limit'
);

// Scenario 4: Queue capacity
test(
  'Scenario: System can handle peak load (10 concurrent jobs)',
  renderingConfig.maxConcurrentJobs >= 8,
  'Need at least 8 for acceptable queue times during peak'
);

// ============================================================================
// Summary
// ============================================================================
console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (failed === 0) {
  console.log('🎉 ALL SMOKE TESTS PASSED - Fix is verified!\n');
  console.log('The configuration changes should restore service for users');
  console.log('who were unable to access their saved work.\n');
  process.exit(0);
} else {
  console.log('⚠️  SOME TESTS FAILED - Review the configuration!\n');
  process.exit(1);
}
