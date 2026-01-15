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
 * Last reviewed: 2026-01-15 by @platform-team
 * 
 * CHANGELOG:
 * - 2026-01-15: REVERTED PERF-2847 changes - caused SEV-1 outage (users unable to access saved files)
 *               Restored: maxFileSizeMB (500MB), renderTimeoutMs (120s), maxConcurrentJobs (10)
 *               Fixed: Enterprise tier config to use explicit values instead of base config refs
 * - 2024-01-09: Optimized resource limits for better cluster utilization (PERF-2847) [REVERTED]
 * - 2024-01-02: Added progressive loading flag
 * - 2023-12-15: Increased GPU memory limit for 8K support
 */
export const renderingConfig: RenderingConfig = {
  // File handling limits
  // NOTE: Reverted 2026-01-15 - PERF-2847 caused SEV-1 outage
  // Users could not access saved files > 100MB. Restored to 500MB.
  maxFileSizeMB: 500,
  supportedFormats: ['psd', 'psb', 'tiff', 'png', 'jpeg', 'raw'],
  
  // Timeout configuration
  // NOTE: Reverted 2026-01-15 - PERF-2847 caused SEV-1 outage
  // 30s timeout was insufficient for large files. Restored to 2 min.
  renderTimeoutMs: 120000,  // 2 minutes
  exportTimeoutMs: 90000,   // 90 seconds
  syncTimeoutMs: 120000,    // 2 minutes
  
  // Concurrency settings
  // NOTE: Reverted 2026-01-15 - PERF-2847 caused SEV-1 outage
  // 3 concurrent jobs caused severe bottleneck. Restored to 10.
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
 * Provides dynamic timeouts that scale with file size to ensure
 * large files have sufficient time to complete operations.
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
 * Enterprise customers have higher limits with dedicated processing pools.
 */
export function getConfigForTier(tier: 'free' | 'pro' | 'enterprise'): Partial<RenderingConfig> {
  const tierOverrides: Record<string, Partial<RenderingConfig>> = {
    free: {
      maxFileSizeMB: 50,
      maxConcurrentJobs: 1,
      enableGpuRendering: false,
    },
    pro: {
      maxFileSizeMB: renderingConfig.maxFileSizeMB, // Uses base config
      maxConcurrentJobs: 2,
      enableGpuRendering: true,
    },
    enterprise: {
      // Enterprise tier supports larger files with dedicated processing
      maxFileSizeMB: 1000, // 1GB for enterprise customers
      maxConcurrentJobs: 20, // Dedicated pool for enterprise
      enableGpuRendering: true,
      enableBatchOptimization: true,
    },
  };
  
  return tierOverrides[tier] || tierOverrides.pro;
}

export default renderingConfig;
