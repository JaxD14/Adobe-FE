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
 * - 2024-01-14: Reverted PERF-2847 timeout/concurrency changes causing timeouts
 * - 2024-01-09: Optimized resource limits for better cluster utilization (PERF-2847)
 * - 2024-01-02: Added progressive loading flag
 * - 2023-12-15: Increased GPU memory limit for 8K support
 */
export const renderingConfig: RenderingConfig = {
  // File handling limits
  // NOTE: Reverted 2024-01-14 - PERF-2847 reduction caused enterprise SLA violations
  // Base config supports up to 500MB (enterprise tier), smaller tiers use getConfigForTier()
  maxFileSizeMB: 500,
  supportedFormats: ['psd', 'psb', 'tiff', 'png', 'jpeg', 'raw'],
  
  // Timeout configuration
  // NOTE: Reverted 2024-01-14 - PERF-2847 reduction (30s) caused widespread timeouts
  // Using 90s as compromise between original 120s and PERF-2847's 30s
  renderTimeoutMs: 90000,  // 90 seconds (was 30s in PERF-2847, originally 120s)
  exportTimeoutMs: 60000,  // 60 seconds
  syncTimeoutMs: 60000,    // 60 seconds
  
  // Concurrency settings
  // NOTE: Reverted 2024-01-14 - PERF-2847 reduction (3) caused queue buildup
  // Using 8 as compromise between original 10 and PERF-2847's 3
  maxConcurrentJobs: 8,
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
 * Each tier has explicit limits that don't depend on base config values
 * to prevent accidental regressions when base config is modified.
 */
export function getConfigForTier(tier: 'free' | 'pro' | 'enterprise'): Partial<RenderingConfig> {
  const tierOverrides: Record<string, Partial<RenderingConfig>> = {
    free: {
      maxFileSizeMB: 50,
      maxConcurrentJobs: 1,
      enableGpuRendering: false,
      renderTimeoutMs: 60000,  // 60s for free tier
    },
    pro: {
      maxFileSizeMB: 200,  // Explicit limit, not inherited from base config
      maxConcurrentJobs: 2,
      enableGpuRendering: true,
      renderTimeoutMs: 90000,  // 90s for pro tier
    },
    enterprise: {
      // Enterprise SLA guarantees: 500MB files, GPU rendering, batch optimization
      maxFileSizeMB: 500,  // Fixed: explicit 500MB limit per enterprise SLA
      maxConcurrentJobs: 10,  // Higher concurrency for enterprise
      enableGpuRendering: true,
      enableBatchOptimization: true,
      renderTimeoutMs: 180000,  // 3 minutes for enterprise large files
    },
  };
  
  return tierOverrides[tier] || tierOverrides.pro;
}

export default renderingConfig;
