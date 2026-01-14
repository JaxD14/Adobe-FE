/**
 * Rendering Service Tests
 * 
 * Tests for the core rendering functionality.
 * 
 * IMPORTANT: These tests enforce SLA requirements and operational minimums.
 * If these tests fail, it indicates a configuration regression that would
 * cause production incidents. DO NOT skip or modify expected values without
 * approval from Platform Team Lead and Enterprise Account Management.
 * 
 * See: go/ps-enterprise-sla for SLA requirements
 * See: incident-inc-20260114 for why these safeguards exist
 * 
 * @owner ps-rendering-eng
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderingConfig, isFileSizeAllowed, getConfigForTier } from '../shared/config/rendering.config';
import { validateConfig, CONFIG_MINIMUMS } from '../shared/config/config-validator';
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
  /**
   * SLA VALIDATION TESTS
   * 
   * These tests use the config validator to enforce SLA requirements.
   * They will fail CI if configuration is invalid.
   */
  describe('SLA Configuration Validation', () => {
    it('should pass full configuration validation', () => {
      const tierConfigs = {
        enterprise: getConfigForTier('enterprise'),
        pro: getConfigForTier('pro'),
        free: getConfigForTier('free'),
      };
      
      const report = validateConfig(renderingConfig, tierConfigs);
      
      // This is the critical gate - if this fails, deployment should be blocked
      expect(report.valid).toBe(true);
      expect(report.errors).toHaveLength(0);
    });
  });

  describe('File Size Limits', () => {
    it('should allow files under the limit', () => {
      expect(isFileSizeAllowed(50)).toBe(true);
      expect(isFileSizeAllowed(100)).toBe(true);
    });

    it('should reject files over the base limit', () => {
      expect(isFileSizeAllowed(150)).toBe(false);
    });
  });

  describe('Tier Configuration - SLA Requirements', () => {
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
     * CRITICAL SLA TEST - Enterprise Tier
     * 
     * Enterprise customers have contractual guarantees for:
     * - 500MB file support
     * - GPU rendering
     * - Batch optimization
     * 
     * Failing this test would breach enterprise SLA contracts.
     */
    it('should return correct config for enterprise tier (SLA CRITICAL)', () => {
      const config = getConfigForTier('enterprise');
      
      // Enterprise SLA requirement: 500MB file support
      expect(config.maxFileSizeMB).toBe(CONFIG_MINIMUMS.enterpriseMaxFileSizeMB.min);
      expect(config.maxFileSizeMB).toBeGreaterThanOrEqual(500);
      
      // Enterprise SLA requirement: priority processing
      expect(config.maxConcurrentJobs).toBeGreaterThanOrEqual(
        CONFIG_MINIMUMS.enterpriseMaxConcurrentJobs.min
      );
      
      // Enterprise features
      expect(config.enableGpuRendering).toBe(true);
      expect(config.enableBatchOptimization).toBe(true);
    });
  });

  describe('Timeout Configuration - Operational Minimums', () => {
    /**
     * CRITICAL OPERATIONAL TEST
     * 
     * Timeout must be sufficient for complex file processing.
     * A timeout that's too short causes widespread failures.
     * See incident-inc-20260114 for production impact.
     */
    it('should have render timeout >= minimum (SLA CRITICAL)', () => {
      expect(renderingConfig.renderTimeoutMs).toBeGreaterThanOrEqual(
        CONFIG_MINIMUMS.renderTimeoutMs.min
      );
    });

    it('should have render timeout >= recommended for reliability', () => {
      expect(renderingConfig.renderTimeoutMs).toBeGreaterThanOrEqual(
        CONFIG_MINIMUMS.renderTimeoutMs.recommended
      );
    });

    it('should have sufficient timeout for large file rendering', () => {
      // A 200MB file with 100 layers needs at least 35s based on benchmarks
      // ~150ms per MB + 50ms per layer = 35000ms
      // With 2x safety buffer = 70000ms minimum
      const requiredTimeout = (200 * 150) + (100 * 50); // 35000ms
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
    
    // This file would have been valid before PERF-2847
    const largeFile = createMockFile({ sizeMB: 200 });
    expect(validateFile(largeFile).valid).toBe(false);
  });
});

describe('Processing Time Estimation', () => {
  it('should estimate time for small files', () => {
    const smallFile = createMockFile({ sizeMB: 10, layerCount: 10 });
    const estimate = estimateProcessingTime(smallFile);
    
    expect(estimate.renderMs).toBeLessThan(5000);
    expect(estimate.withinTimeout).toBe(true);
  });

  /**
   * FAILING TEST - PERF-2847 Impact
   * 
   * Large files now exceed the reduced timeout.
   */
  it('should handle large enterprise files within timeout', () => {
    // Typical enterprise file: 300MB, 150 layers, 8K resolution
    const enterpriseFile = createMockFile({
      sizeMB: 300,
      layerCount: 150,
      width: 7680,
      height: 4320,
    });
    
    const estimate = estimateProcessingTime(enterpriseFile);
    
    // Enterprise files must complete within timeout
    // BUG: withinTimeout is false because timeout was reduced
    expect(estimate.withinTimeout).toBe(true);
  });

  it('should warn when estimated time exceeds timeout', () => {
    const largeFile = createMockFile({ sizeMB: 200, layerCount: 100 });
    const estimate = estimateProcessingTime(largeFile);
    
    // After PERF-2847, this correctly returns false
    // but the config should be fixed, not the expectation
    expect(estimate.withinTimeout).toBe(false);
  });
});

describe('Concurrent Job Limits - Operational Minimums', () => {
  /**
   * CRITICAL OPERATIONAL TEST
   * 
   * Concurrent job limit must support peak traffic.
   * Too few concurrent jobs causes queue buildup and timeouts.
   * See incident-inc-20260114 for production impact.
   */
  it('should support minimum concurrent jobs (SLA CRITICAL)', () => {
    expect(renderingConfig.maxConcurrentJobs).toBeGreaterThanOrEqual(
      CONFIG_MINIMUMS.maxConcurrentJobs.min
    );
  });

  it('should support recommended concurrent jobs for peak throughput', () => {
    // Based on traffic analysis, we need at least 8 concurrent jobs
    // to maintain <30s average queue wait time during peak hours
    expect(renderingConfig.maxConcurrentJobs).toBeGreaterThanOrEqual(
      CONFIG_MINIMUMS.maxConcurrentJobs.recommended
    );
  });
});
