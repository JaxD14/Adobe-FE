/**
 * Export Service Tests
 * 
 * Tests for file export functionality.
 * 
 * @owner ps-export-eng
 */

import { describe, it, expect } from 'vitest';
import { renderingConfig, getTimeoutForFileSize } from '../shared/config/rendering.config';
import { getFormatConfig, estimateOutputSize, supportsTransparency } from '../services/export/formats';
import { FileMetadata, SupportedFormat } from '../shared/types/common';

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

describe('Export Formats', () => {
  describe('Format Configuration', () => {
    it('should return config for PNG', () => {
      const config = getFormatConfig('png');
      expect(config).not.toBeNull();
      expect(config?.supportsTransparency).toBe(true);
      expect(config?.mimeType).toBe('image/png');
    });

    it('should return config for JPEG', () => {
      const config = getFormatConfig('jpeg');
      expect(config).not.toBeNull();
      expect(config?.supportsTransparency).toBe(false);
    });

    it('should return null for unsupported formats', () => {
      const config = getFormatConfig('bmp');
      expect(config).toBeNull();
    });
  });

  describe('Transparency Support', () => {
    it('should correctly identify formats with transparency', () => {
      expect(supportsTransparency('png')).toBe(true);
      expect(supportsTransparency('webp')).toBe(true);
      expect(supportsTransparency('tiff')).toBe(true);
    });

    it('should correctly identify formats without transparency', () => {
      expect(supportsTransparency('jpeg')).toBe(false);
    });
  });

  describe('Output Size Estimation', () => {
    it('should estimate smaller size for lossy formats', () => {
      const inputSize = 100; // 100MB input
      
      const pngSize = estimateOutputSize(inputSize, 'png', 90);
      const jpegSize = estimateOutputSize(inputSize, 'jpeg', 85);
      
      expect(jpegSize).toBeLessThan(pngSize);
    });

    it('should scale with quality setting', () => {
      const inputSize = 50;
      
      const highQuality = estimateOutputSize(inputSize, 'jpeg', 100);
      const lowQuality = estimateOutputSize(inputSize, 'jpeg', 50);
      
      expect(lowQuality).toBeLessThan(highQuality);
    });
  });
});

describe('Export Timeouts', () => {
  describe('Base Timeout', () => {
    it('should have configured export timeout', () => {
      expect(renderingConfig.exportTimeoutMs).toBeDefined();
      expect(renderingConfig.exportTimeoutMs).toBeGreaterThan(0);
    });

    /**
     * FAILING TEST - PERF-2847 Impact
     * 
     * Export timeout was reduced, affecting large file exports.
     */
    it('should have sufficient base timeout for typical exports', () => {
      // Typical export should complete in under 60 seconds
      // but we need buffer for complex files
      // BUG: exportTimeoutMs is now 45000, should be at least 90000
      expect(renderingConfig.exportTimeoutMs).toBeGreaterThanOrEqual(90000);
    });
  });

  describe('Dynamic Timeout Calculation', () => {
    it('should scale timeout with file size', () => {
      const smallFileTimeout = getTimeoutForFileSize(10, 'export');
      const largeFileTimeout = getTimeoutForFileSize(100, 'export');
      
      expect(largeFileTimeout).toBeGreaterThan(smallFileTimeout);
    });

    /**
     * FAILING TEST - PERF-2847 Impact
     * 
     * Even with scaling, large files hit the 3x cap too quickly
     * because base timeout was reduced.
     */
    it('should provide adequate timeout for enterprise file exports', () => {
      // 200MB file export should have at least 3 minutes
      // Based on benchmark: ~75ms per MB for export
      const timeout = getTimeoutForFileSize(200, 'export');
      
      // Need: 200 * 75 * 2 (safety factor) = 30000ms minimum
      // BUG: Returns ~135000 (capped at 3x of 45000)
      // Should be able to handle this, but base is too low
      expect(timeout).toBeGreaterThanOrEqual(180000); // 3 minutes
    });
  });
});

describe('Batch Export', () => {
  it('should have batch optimization enabled', () => {
    expect(renderingConfig.enableBatchOptimization).toBe(true);
  });

  /**
   * FAILING TEST - PERF-2847 Impact
   * 
   * With reduced concurrent job limit, batch exports
   * take much longer as jobs queue up.
   */
  it('should support reasonable concurrency for batch operations', () => {
    // Batch export of 10 formats shouldn't take 10x longer
    // Need at least 5 concurrent jobs for acceptable UX
    
    // BUG: maxConcurrentJobs is 3
    expect(renderingConfig.maxConcurrentJobs).toBeGreaterThanOrEqual(5);
  });
});

describe('Export Error Handling', () => {
  it('should respect retry configuration', () => {
    expect(renderingConfig.maxRetries).toBeGreaterThan(0);
    expect(renderingConfig.retryBackoffMs).toBeGreaterThan(0);
  });

  it('should have reasonable retry backoff', () => {
    // Too short backoff causes thundering herd
    expect(renderingConfig.retryBackoffMs).toBeGreaterThanOrEqual(500);
    
    // Too long backoff hurts user experience
    expect(renderingConfig.retryBackoffMs).toBeLessThanOrEqual(5000);
  });
});

describe('Format-Specific Export', () => {
  const formats: SupportedFormat[] = ['png', 'jpeg', 'webp', 'tiff', 'pdf'];
  
  formats.forEach(format => {
    it(`should have valid config for ${format}`, () => {
      const config = getFormatConfig(format);
      
      expect(config).not.toBeNull();
      expect(config?.extension).toBeDefined();
      expect(config?.mimeType).toBeDefined();
      expect(config?.defaultQuality).toBeGreaterThan(0);
      expect(config?.defaultQuality).toBeLessThanOrEqual(100);
    });
  });
});
