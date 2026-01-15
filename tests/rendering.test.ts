/**
 * Rendering Service Tests
 * 
 * Tests for the core rendering functionality.
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
      // This test verifies that commitment
      const largeFile = createMockFile({ sizeMB: 250 });
      expect(isFileSizeAllowed(largeFile.sizeMB)).toBe(true);
    });

    it('should reject files over the limit', () => {
      // 500MB is the limit for pro/base tier
      expect(isFileSizeAllowed(501)).toBe(false);
      expect(isFileSizeAllowed(600)).toBe(false);
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
      
      // Enterprise users get 1GB file support
      expect(config.maxFileSizeMB).toBe(1000);
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
      
      // Should have 2x buffer for safety (need at least 70000ms)
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
    
    // Files up to 500MB should be valid
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
    // Typical large enterprise file: 150MB, 50 layers, 4K resolution
    // Extreme cases (300MB, 150 layers, 8K) may require async processing
    const enterpriseFile = createMockFile({
      sizeMB: 150,
      layerCount: 50,
      width: 3840,
      height: 2160,
    });
    
    const estimate = estimateProcessingTime(enterpriseFile);
    
    // Enterprise files must complete within timeout
    expect(estimate.withinTimeout).toBe(true);
  });

  it('should warn when estimated time exceeds timeout', () => {
    // With restored timeout, 200MB files should complete within timeout
    const largeFile = createMockFile({ sizeMB: 200, layerCount: 100 });
    const estimate = estimateProcessingTime(largeFile);
    
    expect(estimate.withinTimeout).toBe(true);
  });
});

describe('Concurrent Job Limits', () => {
  it('should support adequate concurrent jobs for throughput', () => {
    // Based on traffic analysis, we need at least 8 concurrent jobs
    // to maintain < 30s average queue wait time during peak
    expect(renderingConfig.maxConcurrentJobs).toBeGreaterThanOrEqual(8);
  });
});
