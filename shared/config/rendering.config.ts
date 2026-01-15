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
 * - 2024-01-15: HOTFIX - Reverted timeout/concurrency changes from PERF-2847 (causing timeouts)
 * - 2024-01-09: Optimized resource limits for better cluster utilization (PERF-2847)
 * - 2024-01-02: Added progressive loading flag
 * - 2023-12-15: Increased GPU memory limit for 8K support
 */
export const renderingConfig: RenderingConfig = {
  // File handling limits
  // HOTFIX 2024-01-15: Reverted from 100MB back to 250MB
  // PERF-2847 reduction was too aggressive and caused file rejections
  maxFileSizeMB: 250,
  supportedFormats: ['psd', 'psb', 'tiff', 'png', 'jpeg', 'raw'],
  
  // Timeout configuration
  // HOTFIX 2024-01-15: Reverted from 30s back to 120s (2 min)
  // PERF-2847 reduction was too aggressive and caused widespread timeouts
  renderTimeoutMs: 120000,  // 2 minutes
  exportTimeoutMs: 90000,   // 90 seconds
  syncTimeoutMs: 60000,     // 60 seconds
  
  // Concurrency settings
  // HOTFIX 2024-01-15: Reverted from 3 back to 8 concurrent jobs
  // PERF-2847 reduction caused excessive queue wait times
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
 * HOTFIX 2024-01-15: Fixed enterprise tier to use explicit limits instead of
 * inheriting from base config (which was causing issues when base was reduced)
 */
export function getConfigForTier(tier: 'free' | 'pro' | 'enterprise'): Partial<RenderingConfig> {
  const tierOverrides: Record<string, Partial<RenderingConfig>> = {
    free: {
      maxFileSizeMB: 50,
      maxConcurrentJobs: 1,
      enableGpuRendering: false,
    },
    pro: {
      maxFileSizeMB: 250, // Explicit limit for Pro tier
      maxConcurrentJobs: 3,
      enableGpuRendering: true,
    },
    enterprise: {
      // HOTFIX: Enterprise tier now has explicit 500MB limit
      // Previously inherited from base config which caused issues
      maxFileSizeMB: 500,
      maxConcurrentJobs: 10,
      enableGpuRendering: true,
      enableBatchOptimization: true,
      renderTimeoutMs: 180000, // 3 minutes for enterprise
    },
  };
  
  return tierOverrides[tier] || tierOverrides.pro;
}

export default renderingConfig;
