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
 * - 2024-01-15: Reverted PERF-2847 changes - caused outage where users couldn't access saved work
 * - 2024-01-09: Optimized resource limits for better cluster utilization (PERF-2847) [REVERTED]
 * - 2024-01-02: Added progressive loading flag
 * - 2023-12-15: Increased GPU memory limit for 8K support
 */
export const renderingConfig: RenderingConfig = {
  // File handling limits
  // REVERTED 2024-01-15: PERF-2847 reduction to 100MB caused outage
  // Users could not sync existing files larger than 100MB
  maxFileSizeMB: 500,
  supportedFormats: ['psd', 'psb', 'tiff', 'png', 'jpeg', 'raw'],
  
  // Timeout configuration
  // REVERTED 2024-01-15: PERF-2847 reduction caused sync timeouts
  // 30s was too aggressive for large file operations
  renderTimeoutMs: 120000,  // 2 minutes
  exportTimeoutMs: 120000,  // 2 minutes
  syncTimeoutMs: 120000,    // 2 minutes
  
  // Concurrency settings
  // REVERTED 2024-01-15: PERF-2847 reduction to 3 caused queue backlogs
  // 3 concurrent jobs created massive delays during peak usage
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
 */
export function getConfigForTier(tier: 'free' | 'pro' | 'enterprise'): Partial<RenderingConfig> {
  const tierOverrides: Record<string, Partial<RenderingConfig>> = {
    free: {
      maxFileSizeMB: 50,
      maxConcurrentJobs: 1,
      enableGpuRendering: false,
    },
    pro: {
      maxFileSizeMB: 500,
      maxConcurrentJobs: 5,
      enableGpuRendering: true,
    },
    enterprise: {
      // Enterprise tier has highest limits
      maxFileSizeMB: 1000, // 1GB for enterprise customers
      maxConcurrentJobs: 15,
      enableGpuRendering: true,
      enableBatchOptimization: true,
    },
  };
  
  return tierOverrides[tier] || tierOverrides.pro;
}

export default renderingConfig;
