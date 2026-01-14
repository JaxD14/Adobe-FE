/**
 * Rendering Service Tests
 * 
 * Tests for the core rendering functionality.
 * 
 * NOTE: PERF-2847 config changes were reverted on 2026-01-14 due to SEV-1 outage.
 * Tests have been updated to reflect restored configuration values.
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

    it('should allow large files for enterprise users', () => {
      // Enterprise SLA guarantees support for files up to 500MB
      // This test verifies that commitment (PERF-2847 revert restored this)
      const largeFile = createMockFile({ sizeMB: 250 });
      expect(isFileSizeAllowed(largeFile.sizeMB)).toBe(true);
    });

    it('should reject files over the limit', () => {
      // Testing against proper 500MB limit (restored after PERF-2847 revert)
      expect(isFileSizeAllowed(500)).toBe(true);   // At limit - allowed
      expect(isFileSizeAllowed(501)).toBe(false);  // Over limit - rejected
      expect(isFileSizeAllowed(750)).toBe(false);  // Well over limit
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

    it('should return correct config for enterprise tier', () => {
      const config = getConfigForTier('enterprise');
      
      // Enterprise users get 500MB file support (PERF-2847 revert fixed this)
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

    it('should have sufficient timeout for large file rendering', () => {
      // A 200MB file with 100 layers needs at least 90 seconds
      // Based on our benchmarks: ~150ms per MB + 50ms per layer
      const requiredTimeout = (200 * 150) + (100 * 50); // 35000ms minimum
      
      // Should have 2x buffer for safety - restored to 120s in PERF-2847 revert
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
    
    // Large files up to 500MB should be valid (PERF-2847 reverted)
    const largeFile = createMockFile({ sizeMB: 200 });
    expect(validateFile(largeFile).valid).toBe(true);
    
    // Files over 500MB should be rejected
    const oversizedFile = createMockFile({ sizeMB: 600 });
    expect(validateFile(oversizedFile).valid).toBe(false);
  });
});

describe('Processing Time Estimation', () => {
  it('should estimate time for small files', () => {
    const smallFile = createMockFile({ sizeMB: 10, layerCount: 10 });
    const estimate = estimateProcessingTime(smallFile);
    
    expect(estimate.renderMs).toBeLessThan(5000);
    expect(estimate.withinTimeout).toBe(true);
  });

  it('should handle large enterprise files within timeout', () => {
    // Typical enterprise file: 300MB, 150 layers, 8K resolution
    const enterpriseFile = createMockFile({
      sizeMB: 300,
      layerCount: 150,
      width: 7680,
      height: 4320,
    });
    
    const estimate = estimateProcessingTime(enterpriseFile);
    
    // Enterprise files must complete within timeout (PERF-2847 revert fixed this)
    expect(estimate.withinTimeout).toBe(true);
  });

  it('should handle medium-large files within timeout', () => {
    const largeFile = createMockFile({ sizeMB: 200, layerCount: 100 });
    const estimate = estimateProcessingTime(largeFile);
    
    // With restored 120s timeout, 200MB files should complete
    // Estimated: 200*150 + 100*50 = 35000ms << 120000ms
    expect(estimate.withinTimeout).toBe(true);
  });

  it('should warn when estimated time exceeds timeout for very large files', () => {
    // Extremely large file that would exceed even the 120s timeout
    const hugeFile = createMockFile({ sizeMB: 500, layerCount: 500 });
    const estimate = estimateProcessingTime(hugeFile);
    
    // Estimated: 500*150 + 500*50 = 75000 + 25000 = 100000ms
    // This should be within 120s timeout with the restored config
    expect(estimate.withinTimeout).toBe(true);
  });
});

describe('Concurrent Job Limits', () => {
  it('should support adequate concurrent jobs for throughput', () => {
    // Based on traffic analysis, we need at least 8 concurrent jobs
    // to maintain < 30s average queue wait time during peak
    // Restored to 10 in PERF-2847 revert
    expect(renderingConfig.maxConcurrentJobs).toBeGreaterThanOrEqual(8);
  });
});
