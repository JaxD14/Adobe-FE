/**
 * Rendering Service Tests
 * 
 * Tests for the core rendering functionality.
 * 
 * NOTE: Some tests are currently failing after the PERF-2847 config changes.
 * See JIRA ticket PS-9823 for tracking.
 * 
 * @owner ps-rendering-eng
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderingConfig, isFileSizeAllowed, getConfigForTier } from '../shared/config/rendering.config';
import { validateFile, estimateProcessingTime } from '../shared/utils/file-utils';
import { FileMetadata } from '../shared/types/common';

// Mock file helper
function createMockFile(overrides: Partial<FileMetadata> = {}): FileMetadata {
  return {
    id: `file-${Date.now()}`,
    filename: 'test-design.psd',
    format: 'psd',
    sizeMB: 50,
    width: 4096,
    height: 2048,
    layerCount: 25,
    colorSpace: 'rgb',
    bitDepth: 8,
    hasTransparency: true,
    createdAt: new Date(),
    modifiedAt: new Date(),
    ...overrides,
  };
}

describe('Rendering Configuration', () => {
  describe('File Size Limits', () => {
    it('should allow files under the limit', () => {
      expect(isFileSizeAllowed(50)).toBe(true);
      expect(isFileSizeAllowed(100)).toBe(true);
    });

    /**
     * FAILING TEST - PERF-2847 Impact
     * 
     * This test was passing before v2.4.1.
     * After the config change, maxFileSizeMB was reduced from 500 to 100.
     * Enterprise users should support 500MB files but this is now failing.
     */
    it('should allow large files for enterprise users', () => {
      // Enterprise SLA guarantees support for files up to 500MB
      // This test verifies that commitment
      const largeFile = createMockFile({ sizeMB: 250 });
      
      // BUG: This now fails because maxFileSizeMB is 100, not 500
      expect(isFileSizeAllowed(largeFile.sizeMB)).toBe(true);
    });

    it('should reject files over the limit', () => {
      // Files exceeding 500MB limit should be rejected
      expect(isFileSizeAllowed(501)).toBe(false);
      expect(isFileSizeAllowed(1000)).toBe(false);
    });
  });

  describe('Tier Configuration', () => {
    it('should return correct config for free tier', () => {
      const config = getConfigForTier('free');
      expect(config.maxFileSizeMB).toBe(50);
      expect(config.enableGpuRendering).toBe(false);
    });

    it('should return correct config for pro tier', () => {
      const config = getConfigForTier('pro');
      expect(config.enableGpuRendering).toBe(true);
    });

    /**
     * FAILING TEST - PERF-2847 Impact
     * 
     * Enterprise config should have maxFileSizeMB of 500
     * but it inherits from base config which is now 100.
     */
    it('should return correct config for enterprise tier', () => {
      const config = getConfigForTier('enterprise');
      
      // Enterprise users pay for 500MB file support
      // BUG: This returns 100 instead of 500
      expect(config.maxFileSizeMB).toBe(500);
      expect(config.enableGpuRendering).toBe(true);
      expect(config.enableBatchOptimization).toBe(true);
    });
  });

  describe('Timeout Configuration', () => {
    it('should have reasonable render timeout', () => {
      // Minimum acceptable timeout for rendering
      // 30 seconds is too short for complex files
      expect(renderingConfig.renderTimeoutMs).toBeGreaterThanOrEqual(60000);
    });

    /**
     * FAILING TEST - PERF-2847 Impact
     * 
     * After config change, timeout is 30s which is insufficient
     * for files over ~50MB with complex layer structures.
     */
    it('should have sufficient timeout for large file rendering', () => {
      // A 200MB file with 100 layers needs at least 90 seconds
      // Based on our benchmarks: ~150ms per MB + 50ms per layer
      const requiredTimeout = (200 * 150) + (100 * 50); // 35000ms minimum
      
      // Should have 2x buffer for safety
      // BUG: Current timeout is 30000ms, need at least 70000ms
      expect(renderingConfig.renderTimeoutMs).toBeGreaterThanOrEqual(requiredTimeout * 2);
    });
  });
});

describe('File Validation', () => {
  it('should validate supported formats', () => {
    const psdFile = createMockFile({ format: 'psd' });
    const result = validateFile(psdFile);
    expect(result.valid).toBe(true);
  });

  it('should reject unsupported formats', () => {
    const unsupportedFile = createMockFile({ format: 'gif' as any });
    const result = validateFile(unsupportedFile);
    expect(result.valid).toBe(false);
    expect(result.error?.code).toBe(1002); // UNSUPPORTED_FORMAT
  });

  it('should validate file size against config', () => {
    const smallFile = createMockFile({ sizeMB: 50 });
    expect(validateFile(smallFile).valid).toBe(true);
    
    // 200MB files should be valid with the proper config (500MB limit)
    const largeFile = createMockFile({ sizeMB: 200 });
    expect(validateFile(largeFile).valid).toBe(true);
    
    // Files over 500MB should be rejected
    const tooLargeFile = createMockFile({ sizeMB: 600 });
    expect(validateFile(tooLargeFile).valid).toBe(false);
  });
});

describe('Processing Time Estimation', () => {
  it('should estimate time for small files', () => {
    const smallFile = createMockFile({ sizeMB: 10, layerCount: 10 });
    const estimate = estimateProcessingTime(smallFile);
    
    expect(estimate.renderMs).toBeLessThan(5000);
    expect(estimate.withinTimeout).toBe(true);
  });

  it('should handle typical enterprise files within timeout', () => {
    // Typical enterprise file: 150MB, 75 layers, 4K resolution
    const enterpriseFile = createMockFile({
      sizeMB: 150,
      layerCount: 75,
      width: 3840,
      height: 2160,
    });
    
    const estimate = estimateProcessingTime(enterpriseFile);
    
    // Enterprise files should complete within the restored 2-minute timeout
    expect(estimate.withinTimeout).toBe(true);
  });

  it('should warn when estimated time exceeds timeout for very large files', () => {
    // Extremely large file that should exceed even the restored timeout
    const veryLargeFile = createMockFile({ sizeMB: 400, layerCount: 200 });
    const estimate = estimateProcessingTime(veryLargeFile);
    
    // Very large files may still exceed timeout - users should be warned
    expect(estimate.withinTimeout).toBe(false);
  });
});

describe('Concurrent Job Limits', () => {
  /**
   * FAILING TEST - PERF-2847 Impact
   * 
   * maxConcurrentJobs was reduced from 10 to 3
   * This may cause queue buildup during peak hours
   */
  it('should support adequate concurrent jobs for throughput', () => {
    // Based on traffic analysis, we need at least 8 concurrent jobs
    // to maintain < 30s average queue wait time during peak
    
    // BUG: Config now has maxConcurrentJobs: 3
    expect(renderingConfig.maxConcurrentJobs).toBeGreaterThanOrEqual(8);
  });
});
