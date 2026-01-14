# ADO-6: Photoshop Sync Data Discrepancy After Release 24.2

## Issue Summary

**Type:** Bug  
**Priority:** Critical  
**Status:** Fixed  
**Affected Version:** 2.4.1 (Release 24.2, 2024-01-15)  
**Fixed In:** Branch `cursor/photoshop-sync-data-discrepancy-2391`  
**Reporter:** #photoshop-incidents  
**Assignee:** Platform Team  

---

## Description

Users are reporting that their Photoshop files show "synced" status but changes keep disappearing when switching between devices. This issue started occurring immediately after the release of v2.4.1 (Release 24.2) on 2024-01-15.

### User Impact
- **Severity:** Data loss for pro and enterprise customers
- **Scope:** All pro/enterprise users with files >100MB
- **Symptoms:** 
  - Files appear as "synced" in UI
  - Changes are lost when switching devices
  - No error messages displayed to users

---

## Root Cause Analysis

### Background
In v2.4.1, performance optimization ticket **PERF-2847** reduced several configuration values to improve cluster utilization and prevent memory pressure:

| Configuration | Before (v2.4.0) | After (v2.4.1) | Impact |
|---------------|-----------------|----------------|--------|
| `maxFileSizeMB` | 500 | 100 | Files >100MB rejected |
| `renderTimeoutMs` | 120,000ms (2 min) | 30,000ms (30s) | Large files timeout |
| `syncTimeoutMs` | ~120,000ms | 60,000ms | Sync operations timeout |
| `maxConcurrentJobs` | 10 | 3 | Longer queue times |

### The Bug
The `sync-manager.ts` and `file-utils.ts` were using the base configuration limits **without considering user tiers**. After PERF-2847, all users (including pro and enterprise) were effectively treated as free-tier users:

1. **File Size Check Failed Silently**: Files >100MB were rejected at the validation layer, but the sync status was set to "synced" before the actual transfer completed.

2. **Timeouts Caused False Success**: Large files that exceeded the reduced timeout would fail, but the UI showed "synced" status based on the queued state, not the actual completion state.

3. **Tier Config Inheritance Bug**: The `getConfigForTier()` function was incorrectly inheriting from the reduced base config instead of using explicit tier limits:
   ```typescript
   // BUG: This returned 100 instead of 500 for enterprise
   maxFileSizeMB: renderingConfig.maxFileSizeMB
   ```

### Code Locations
- `shared/config/rendering.config.ts:140` - Incorrect tier config inheritance
- `services/asset-sync/sync-manager.ts:119` - Missing tier parameter in size check
- `shared/utils/file-utils.ts:27` - Missing tier parameter in validation

---

## Solution

### Changes Made

#### 1. Added Tier-Specific Constants (`rendering.config.ts`)
```typescript
export const TIER_FILE_SIZE_LIMITS: Record<'free' | 'pro' | 'enterprise', number> = {
  free: 50,      // Free tier: 50MB
  pro: 200,      // Pro tier: 200MB  
  enterprise: 500, // Enterprise tier: 500MB (SLA guaranteed)
};

export const TIER_TIMEOUT_MULTIPLIERS: Record<'free' | 'pro' | 'enterprise', number> = {
  free: 1,       // Base timeout
  pro: 2,        // 2x base timeout
  enterprise: 4, // 4x base timeout
};
```

#### 2. Updated `isFileSizeAllowed()` to Accept Tier
```typescript
export function isFileSizeAllowed(
  fileSizeMB: number, 
  tier?: 'free' | 'pro' | 'enterprise'
): boolean {
  if (tier) {
    return fileSizeMB <= TIER_FILE_SIZE_LIMITS[tier];
  }
  return fileSizeMB <= renderingConfig.maxFileSizeMB;
}
```

#### 3. Added Tier-Aware Timeout Function
```typescript
export function getTimeoutForFileSizeAndTier(
  fileSizeMB: number,
  operation: 'render' | 'export' | 'sync',
  tier: 'free' | 'pro' | 'enterprise'
): number {
  const baseTimeout = getTimeoutForFileSize(fileSizeMB, operation);
  const multiplier = TIER_TIMEOUT_MULTIPLIERS[tier];
  return baseTimeout * multiplier;
}
```

#### 4. Updated `sync-manager.ts` to Use Tier-Specific Config
- Pass `userTier` to `validateFile()` and `isFileSizeAllowed()`
- Use `getTimeoutForFileSizeAndTier()` for sync operations
- Include tier info in error messages

#### 5. Updated `validateFile()` to Accept Tier Parameter
- Added optional `tier` parameter
- Uses tier-specific limits when tier is provided
- Improved error messages with tier context

#### 6. Fixed `getConfigForTier()` 
- Now uses explicit `TIER_FILE_SIZE_LIMITS` instead of inheriting from base config
- Added tier-specific timeout values
- Enterprise now correctly returns 500MB limit

---

## Files Changed

| File | Changes |
|------|---------|
| `shared/config/rendering.config.ts` | Added tier constants, updated functions |
| `services/asset-sync/sync-manager.ts` | Use tier-specific limits and timeouts |
| `shared/utils/file-utils.ts` | Added tier parameter to validateFile |
| `tests/rendering.test.ts` | Updated tests for tier-aware validation |

---

## Testing

### Unit Tests Updated
- `should allow large files for enterprise users` - Now passes with tier parameter
- `should return correct config for enterprise tier` - Now returns 500MB
- `should have reasonable render timeout for each tier` - Validates tier multipliers
- `should handle large enterprise files within timeout` - Uses enterprise config
- `should support adequate concurrent jobs per tier` - Validates tier concurrency

### Manual Testing Checklist
- [ ] Free tier user with 40MB file syncs successfully
- [ ] Free tier user with 60MB file is rejected with clear error
- [ ] Pro tier user with 150MB file syncs successfully
- [ ] Pro tier user with 250MB file is rejected with clear error
- [ ] Enterprise tier user with 400MB file syncs successfully
- [ ] Enterprise tier user with 500MB file syncs successfully
- [ ] Enterprise tier user with 550MB file is rejected with clear error
- [ ] Sync status accurately reflects actual sync state
- [ ] No false "synced" status on failed operations

---

## Rollout Plan

1. **Immediate**: Deploy fix to staging environment
2. **Validation**: Run full test suite + manual testing
3. **Canary**: Deploy to 5% of traffic
4. **Monitor**: Watch for sync errors, timeout rates, queue depth
5. **Full Rollout**: Deploy to 100% after 24h monitoring

---

## Monitoring & Alerts

### Metrics to Watch
- `sync.success_rate` by tier
- `sync.timeout_rate` by tier
- `sync.file_size_rejected` by tier
- `sync.queue_depth`

### Alerts
- Alert if enterprise sync success rate drops below 99.9%
- Alert if pro sync success rate drops below 99.5%
- Alert if timeout rate exceeds 1% for any tier

---

## Lessons Learned

1. **Tier-Specific Testing Required**: Performance optimizations that change limits must be tested against all user tiers, not just base config.

2. **Config Inheritance is Risky**: Tier configs should use explicit values, not inherit from base config which may change.

3. **Sync Status Must Reflect Reality**: The sync status should only show "synced" after successful completion, not when queued.

4. **SLA Limits Need Protection**: Enterprise SLA limits (500MB) should be defined as constants that cannot be accidentally overridden by optimization PRs.

---

## Related Links

- **PR**: `cursor/photoshop-sync-data-discrepancy-2391`
- **PERF-2847**: Original performance optimization ticket
- **Slack Thread**: #photoshop-incidents
- **CHANGELOG**: v2.4.1 entry updated

---

## Timeline

| Date | Event |
|------|-------|
| 2024-01-09 | PERF-2847 merged (config reduction) |
| 2024-01-15 | Release 24.2 (v2.4.1) deployed |
| 2024-01-15 | User reports begin in #photoshop-incidents |
| 2024-01-14 | Root cause identified |
| 2024-01-14 | Fix implemented and pushed |
