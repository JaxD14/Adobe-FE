/**
 * Rendering Configuration
 * 
 * IMPORTANT: This configuration is shared across multiple services:
 * - RenderingService (services/rendering/)
 * - ExportService (services/export/)
 * - AssetSyncService (services/asset-sync/)
 * 
 * Changes here have broad impact. Please coordinate with Platform team
 * before modifying any values. See go/ps-config-changes for process.
 * 
 * @owner platform-team
 * @oncall ps-rendering-eng
 */

export interface RenderingConfig {
  // File handling limits
  maxFileSizeMB: number;
  supportedFormats: string[];
  
  // Timeout configuration
  renderTimeoutMs: number;
  exportTimeoutMs: number;
  syncTimeoutMs: number;
  
  // Concurrency settings
  maxConcurrentJobs: number;
  jobQueueDepthLimit: number;
  
  // Memory management
  maxMemoryPerJobMB: number;
  gpuMemoryLimitMB: number;
  
  // Retry configuration
  maxRetries: number;
  retryBackoffMs: number;
  
  // Feature flags
  enableGpuRendering: boolean;
  enableProgressiveLoading: boolean;
  enableBatchOptimization: boolean;
}

/**
 * Production configuration values
 * 
 * Last reviewed: 2024-01-15 by @platform-team
 * 
 * CHANGELOG:
 * - 2024-01-09: Optimized resource limits for better cluster utilization (PERF-2847)
 * - 2024-01-02: Added progressive loading flag
 * - 2023-12-15: Increased GPU memory limit for 8K support
 */
export const renderingConfig: RenderingConfig = {
  // File handling limits
  // NOTE: Updated 2024-01-09 for resource optimization (PERF-2847)
  // Previous: 500MB - reduced to improve cluster utilization
  maxFileSizeMB: 100,
  supportedFormats: ['psd', 'psb', 'tiff', 'png', 'jpeg', 'raw'],
  
  // Timeout configuration
  // NOTE: Updated 2024-01-09 for resource optimization (PERF-2847)
  // Previous: 120000ms (2 min) - reduced to free up worker capacity faster
  renderTimeoutMs: 30000,  // 30 seconds
  exportTimeoutMs: 45000,  // 45 seconds
  syncTimeoutMs: 60000,    // 60 seconds
  
  // Concurrency settings
  // NOTE: Updated 2024-01-09 for resource optimization (PERF-2847)
  // Previous: 10 concurrent jobs - reduced to prevent memory pressure
  maxConcurrentJobs: 3,
  jobQueueDepthLimit: 100,
  
  // Memory management
  maxMemoryPerJobMB: 512,
  gpuMemoryLimitMB: 2048,
  
  // Retry configuration
  maxRetries: 3,
  retryBackoffMs: 1000,
  
  // Feature flags
  enableGpuRendering: true,
  enableProgressiveLoading: true,
  enableBatchOptimization: true,
};

/**
 * Tier-specific file size limits (in MB)
 * These are contractual SLA commitments and should not be reduced without
 * customer notification and approval.
 * 
 * FIXED: 2024-01-14 - Added explicit tier limits (issue ADO-6)
 */
export const TIER_FILE_SIZE_LIMITS: Record<'free' | 'pro' | 'enterprise', number> = {
  free: 50,
  pro: 200,
  enterprise: 500,
};

/**
 * Tier-specific timeout multipliers
 * Higher tiers get longer timeouts to support larger files
 * 
 * FIXED: 2024-01-14 - Added tier timeout multipliers (issue ADO-6)
 */
export const TIER_TIMEOUT_MULTIPLIERS: Record<'free' | 'pro' | 'enterprise', number> = {
  free: 1,
  pro: 2,
  enterprise: 4,
};

/**
 * Get timeout for a specific operation based on file size
 * 
 * NOTE: This function was added to provide dynamic timeouts, but the base
 * config values were reduced in PERF-2847. Large files may still timeout
 * if they exceed the new limits.
 */
export function getTimeoutForFileSize(fileSizeMB: number, operation: 'render' | 'export' | 'sync'): number {
  const baseTimeouts = {
    render: renderingConfig.renderTimeoutMs,
    export: renderingConfig.exportTimeoutMs,
    sync: renderingConfig.syncTimeoutMs,
  };
  
  const baseTimeout = baseTimeouts[operation];
  
  // Scale timeout linearly for larger files
  // 1MB = base timeout, 100MB = 2x base timeout
  const scaleFactor = 1 + (fileSizeMB / 100);
  
  return Math.min(baseTimeout * scaleFactor, baseTimeout * 3);
}

/**
 * Check if a file exceeds the maximum allowed size
 * 
 * @param fileSizeMB - File size in megabytes
 * @param tier - Optional user tier for tier-specific limits (defaults to base config)
 * 
 * FIXED: 2024-01-14 - Added tier parameter for tier-specific limits (issue ADO-6)
 */
export function isFileSizeAllowed(fileSizeMB: number, tier?: 'free' | 'pro' | 'enterprise'): boolean {
  if (tier) {
    return fileSizeMB <= TIER_FILE_SIZE_LIMITS[tier];
  }
  return fileSizeMB <= renderingConfig.maxFileSizeMB;
}

/**
 * Get timeout for a specific operation based on file size AND user tier
 * 
 * FIXED: 2024-01-14 - Added tier-aware timeout calculation (issue ADO-6)
 */
export function getTimeoutForFileSizeAndTier(
  fileSizeMB: number,
  operation: 'render' | 'export' | 'sync',
  tier: 'free' | 'pro' | 'enterprise'
): number {
  const baseTimeout = getTimeoutForFileSize(fileSizeMB, operation);
  const multiplier = TIER_TIMEOUT_MULTIPLIERS[tier];
  return baseTimeout * multiplier;
}

/**
 * Get configuration for a specific tier
 * Enterprise customers have higher limits per SLA agreements
 * 
 * FIXED: 2024-01-14 - Now uses explicit tier limits instead of inheriting
 * from base config which was reduced in PERF-2847 (issue ADO-6)
 */
export function getConfigForTier(tier: 'free' | 'pro' | 'enterprise'): Partial<RenderingConfig> {
  const tierOverrides: Record<string, Partial<RenderingConfig>> = {
    free: {
      maxFileSizeMB: TIER_FILE_SIZE_LIMITS.free,
      maxConcurrentJobs: 1,
      renderTimeoutMs: renderingConfig.renderTimeoutMs * TIER_TIMEOUT_MULTIPLIERS.free,
      syncTimeoutMs: renderingConfig.syncTimeoutMs * TIER_TIMEOUT_MULTIPLIERS.free,
      enableGpuRendering: false,
    },
    pro: {
      maxFileSizeMB: TIER_FILE_SIZE_LIMITS.pro,
      maxConcurrentJobs: 2,
      renderTimeoutMs: renderingConfig.renderTimeoutMs * TIER_TIMEOUT_MULTIPLIERS.pro,
      syncTimeoutMs: renderingConfig.syncTimeoutMs * TIER_TIMEOUT_MULTIPLIERS.pro,
      enableGpuRendering: true,
    },
    enterprise: {
      // Enterprise SLA guarantees: 500MB files, extended timeouts, GPU rendering
      maxFileSizeMB: TIER_FILE_SIZE_LIMITS.enterprise,
      maxConcurrentJobs: 5,
      renderTimeoutMs: renderingConfig.renderTimeoutMs * TIER_TIMEOUT_MULTIPLIERS.enterprise,
      syncTimeoutMs: renderingConfig.syncTimeoutMs * TIER_TIMEOUT_MULTIPLIERS.enterprise,
      enableGpuRendering: true,
      enableBatchOptimization: true,
    },
  };
  
  return tierOverrides[tier] || tierOverrides.pro;
}

export default renderingConfig;
