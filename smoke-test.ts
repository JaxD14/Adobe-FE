/**
 * Smoke Test for Rendering Configuration Fix
 * 
 * Validates that the PERF-2847 regression has been fixed.
 * Run with: npx ts-node smoke-test.ts (or node if compiled)
 */

// Import the config directly (works without external deps)
import { 
  renderingConfig, 
  isFileSizeAllowed, 
  getConfigForTier,
  getTimeoutForFileSize 
} from './shared/config/rendering.config';

interface TestResult {
  name: string;
  passed: boolean;
  expected: any;
  actual: any;
  message?: string;
}

const results: TestResult[] = [];

function test(name: string, expected: any, actual: any, compareFn?: (e: any, a: any) => boolean) {
  const compare = compareFn || ((e, a) => e === a);
  const passed = compare(expected, actual);
  results.push({ name, passed, expected, actual });
  
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (!passed) {
    console.log(`   Expected: ${expected}, Actual: ${actual}`);
  }
}

function testGreaterOrEqual(name: string, minValue: number, actual: number) {
  const passed = actual >= minValue;
  results.push({ name, passed, expected: `>= ${minValue}`, actual });
  
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (!passed) {
    console.log(`   Expected: >= ${minValue}, Actual: ${actual}`);
  }
}

console.log('\n🔬 SMOKE TEST: Photoshop Rendering Configuration\n');
console.log('=' .repeat(60));

// Test 1: Render timeout is sufficient (was 30s, should be 120s)
console.log('\n📋 Timeout Configuration Tests\n');
testGreaterOrEqual(
  'Render timeout >= 60s (minimum for complex files)',
  60000,
  renderingConfig.renderTimeoutMs
);

testGreaterOrEqual(
  'Render timeout >= 120s (required for large files)',
  120000,
  renderingConfig.renderTimeoutMs
);

// Test 2: Concurrent jobs adequate (was 3, should be 8)
console.log('\n📋 Concurrency Configuration Tests\n');
testGreaterOrEqual(
  'Max concurrent jobs >= 8 (required for peak throughput)',
  8,
  renderingConfig.maxConcurrentJobs
);

// Test 3: Enterprise tier configuration
console.log('\n📋 Enterprise Tier Tests\n');
const enterpriseConfig = getConfigForTier('enterprise');

test(
  'Enterprise maxFileSizeMB = 500MB (SLA requirement)',
  500,
  enterpriseConfig.maxFileSizeMB
);

testGreaterOrEqual(
  'Enterprise maxConcurrentJobs >= 10',
  10,
  enterpriseConfig.maxConcurrentJobs || 0
);

test(
  'Enterprise GPU rendering enabled',
  true,
  enterpriseConfig.enableGpuRendering
);

test(
  'Enterprise batch optimization enabled',
  true,
  enterpriseConfig.enableBatchOptimization
);

// Test 4: File size limits per tier
console.log('\n📋 File Size Limit Tests\n');
const freeConfig = getConfigForTier('free');
const proConfig = getConfigForTier('pro');

test('Free tier maxFileSizeMB = 50MB', 50, freeConfig.maxFileSizeMB);
test('Pro tier maxFileSizeMB = 100MB', 100, proConfig.maxFileSizeMB);
test('Enterprise tier maxFileSizeMB = 500MB', 500, enterpriseConfig.maxFileSizeMB);

// Test 5: File validation for enterprise use case
console.log('\n📋 Enterprise File Validation Tests\n');
test(
  'Base config allows 100MB files',
  true,
  isFileSizeAllowed(100)
);

test(
  'Base config rejects 150MB files (expected for non-enterprise)',
  false,
  isFileSizeAllowed(150)
);

// Test 6: Dynamic timeout calculation
console.log('\n📋 Dynamic Timeout Tests\n');
const timeout50MB = getTimeoutForFileSize(50, 'render');
const timeout200MB = getTimeoutForFileSize(200, 'render');

testGreaterOrEqual(
  '50MB file render timeout >= 90s',
  90000,
  timeout50MB
);

testGreaterOrEqual(
  '200MB file render timeout >= 180s',
  180000,
  timeout200MB
);

// Test 7: Estimated processing time validation
console.log('\n📋 Processing Estimation Tests\n');
// A 200MB file with 100 layers needs at least 35s based on benchmarks
// 200 * 150ms/MB + 100 * 50ms/layer = 35000ms
const requiredTimeout = (200 * 150) + (100 * 50); // 35000ms
testGreaterOrEqual(
  `Render timeout handles 200MB/100 layer file (need ${requiredTimeout * 2}ms)`,
  requiredTimeout * 2,
  renderingConfig.renderTimeoutMs
);

// Summary
console.log('\n' + '='.repeat(60));
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
const total = results.length;

console.log(`\n📊 RESULTS: ${passed}/${total} tests passed`);

if (failed > 0) {
  console.log(`\n❌ FAILED TESTS (${failed}):`);
  results.filter(r => !r.passed).forEach(r => {
    console.log(`   - ${r.name}`);
    console.log(`     Expected: ${r.expected}, Got: ${r.actual}`);
  });
  console.log('\n🚨 SMOKE TEST FAILED - Service may still have issues\n');
  process.exit(1);
} else {
  console.log('\n✅ ALL SMOKE TESTS PASSED - Configuration looks correct!\n');
  console.log('Summary of fixes verified:');
  console.log('  • Render timeout: 120s (was 30s)');
  console.log('  • Max concurrent jobs: 8 (was 3)');
  console.log('  • Enterprise file limit: 500MB (was incorrectly 100MB)');
  console.log('\n🎉 Service configuration is operational!\n');
  process.exit(0);
}
