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
 * - 2024-01-14: HOTFIX - Reverted PERF-2847 changes that caused incident (see INC-20260114)
 *               Restored maxFileSizeMB, renderTimeoutMs, and maxConcurrentJobs to previous values
 * - 2024-01-09: Optimized resource limits for better cluster utilization (PERF-2847) [REVERTED]
 * - 2024-01-02: Added progressive loading flag
 * - 2023-12-15: Increased GPU memory limit for 8K support
 */
export const renderingConfig: RenderingConfig = {
  // File handling limits
  // NOTE: Restored 2024-01-14 - PERF-2847 reduction broke enterprise SLA (INC-20260114)
  maxFileSizeMB: 500,
  supportedFormats: ['psd', 'psb', 'tiff', 'png', 'jpeg', 'raw'],
  
  // Timeout configuration
  // NOTE: Restored 2024-01-14 - 30s timeout caused widespread failures (INC-20260114)
  renderTimeoutMs: 120000,  // 120 seconds (2 min)
  exportTimeoutMs: 90000,   // 90 seconds
  syncTimeoutMs: 60000,     // 60 seconds
  
  // Concurrency settings
  // NOTE: Restored 2024-01-14 - 3 concurrent jobs caused queue buildup (INC-20260114)
  maxConcurrentJobs: 10,
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
 */
export function isFileSizeAllowed(fileSizeMB: number): boolean {
  return fileSizeMB <= renderingConfig.maxFileSizeMB;
}

/**
 * Get configuration for a specific tier
 * Enterprise customers have higher limits
 * 
 * NOTE: Fixed 2024-01-14 (INC-20260114) - Enterprise tier now uses explicit values
 * instead of inheriting from base config to prevent future regressions.
 */
export function getConfigForTier(tier: 'free' | 'pro' | 'enterprise'): Partial<RenderingConfig> {
  const tierOverrides: Record<string, Partial<RenderingConfig>> = {
    free: {
      maxFileSizeMB: 50,
      maxConcurrentJobs: 1,
      enableGpuRendering: false,
    },
    pro: {
      maxFileSizeMB: 200, // Pro tier supports up to 200MB
      maxConcurrentJobs: 5,
      enableGpuRendering: true,
    },
    enterprise: {
      // Enterprise SLA guarantees: 500MB files, priority processing
      // Using explicit values to prevent regression from base config changes
      maxFileSizeMB: 500,
      maxConcurrentJobs: 10,
      renderTimeoutMs: 180000, // 3 min timeout for enterprise
      enableGpuRendering: true,
      enableBatchOptimization: true,
    },
  };
  
  return tierOverrides[tier] || tierOverrides.pro;
}

export default renderingConfig;
