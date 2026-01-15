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
 * - 2024-01-15: HOTFIX - Reverted PERF-2847 changes that broke enterprise tier (INC-20260115)
 * - 2024-01-09: Optimized resource limits for better cluster utilization (PERF-2847) [REVERTED]
 * - 2024-01-02: Added progressive loading flag
 * - 2023-12-15: Increased GPU memory limit for 8K support
 */
export const renderingConfig: RenderingConfig = {
  // File handling limits
  // HOTFIX: Restored to 500MB to support enterprise tier SLA
  // PERF-2847 reduced this to 100MB which broke enterprise users
  maxFileSizeMB: 500,
  supportedFormats: ['psd', 'psb', 'tiff', 'png', 'jpeg', 'raw'],
  
  // Timeout configuration
  // HOTFIX: Restored to 120000ms (2 min) to prevent timeout failures
  // PERF-2847 reduced this to 30s which caused large files to fail
  renderTimeoutMs: 120000,  // 2 minutes
  exportTimeoutMs: 90000,   // 90 seconds
  syncTimeoutMs: 60000,     // 60 seconds
  
  // Concurrency settings
  // HOTFIX: Restored to 10 concurrent jobs to prevent queue buildup
  // PERF-2847 reduced this to 3 which caused excessive wait times
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
 * HOTFIX: Fixed enterprise tier to use explicit values (not base config references)
 * to ensure SLA commitments are met regardless of base config changes.
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
      // HOTFIX: Enterprise tier must explicitly set 500MB per SLA
      // Do NOT reference base config to avoid regression from config changes
      maxFileSizeMB: 500,
      maxConcurrentJobs: 10,
      enableGpuRendering: true,
      enableBatchOptimization: true,
    },
  };
  
  return tierOverrides[tier] || tierOverrides.pro;
}

export default renderingConfig;
