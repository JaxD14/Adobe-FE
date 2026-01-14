/**
 * Export Service Core
 * 
 * Handles conversion of rendered output to various export formats.
 * Depends on rendering service for source material.
 * 
 * @owner ps-export-eng
 */

import { 
  renderingConfig, 
  isFileSizeAllowed,
  getTimeoutForFileSize 
} from '../../shared/config/rendering.config';
import { createLogger } from '../../shared/utils/logger';
import { validateFile } from '../../shared/utils/file-utils';
import { 
  FileMetadata, 
  SupportedFormat, 
  ErrorCode, 
  ServiceError,
  UserTier,
  JobStatus 
} from '../../shared/types/common';
import { getFormatConfig, estimateOutputSize, FormatConfig } from './formats';

const logger = createLogger('exporter');

/**
 * Export job request
 */
export interface ExportRequest {
  jobId: string;
  requestId: string;
  userId: string;
  userTier: UserTier;
  sourceFile: FileMetadata;
  outputFormat: SupportedFormat;
  quality: number;
  options: {
    preserveColorProfile: boolean;
    embedMetadata: boolean;
    optimizeForWeb: boolean;
    includeIccProfile?: string;
  };
}

/**
 * Export result
 */
export interface ExportResult {
  jobId: string;
  requestId: string;
  status: JobStatus;
  outputUrl?: string;
  outputSizeMB?: number;
  exportTimeMs?: number;
  format?: SupportedFormat;
  error?: ServiceError;
}

/**
 * Export batch request
 */
export interface BatchExportRequest {
  batchId: string;
  requestId: string;
  userId: string;
  userTier: UserTier;
  sourceFile: FileMetadata;
  exports: Array<{
    format: SupportedFormat;
    quality: number;
    suffix?: string;
  }>;
}

/**
 * Exporter class
 * 
 * Handles format conversion with dependency on rendering config for timeouts.
 */
export class Exporter {
  private activeExports: Map<string, { startTime: number; abortController: AbortController }> = new Map();

  /**
   * Export a file to a specific format
   * 
   * Uses shared rendering config for timeout values.
   */
  async exportFile(request: ExportRequest): Promise<ExportResult> {
    const { jobId, requestId, sourceFile, outputFormat, quality, options } = request;
    const startTime = Date.now();
    
    logger.info('Export request received', {
      requestId,
      jobId,
      sourceFileId: sourceFile.id,
      fileSizeMB: sourceFile.sizeMB,
      outputFormat,
      quality,
    });
    
    // Validate source file
    const validation = validateFile(sourceFile);
    if (!validation.valid) {
      return {
        jobId,
        requestId,
        status: 'failed',
        error: validation.error,
      };
    }
    
    // Validate output format
    const formatConfig = getFormatConfig(outputFormat);
    if (!formatConfig) {
      return {
        jobId,
        requestId,
        status: 'failed',
        error: {
          code: ErrorCode.INVALID_OUTPUT_FORMAT,
          message: `Output format '${outputFormat}' is not supported`,
          timestamp: new Date(),
          requestId,
        },
      };
    }
    
    // Check if file size is within limits
    // NOTE: Uses shared config which was reduced in PERF-2847
    if (!isFileSizeAllowed(sourceFile.sizeMB)) {
      logger.warn('File size exceeds export limit', {
        requestId,
        fileSizeMB: sourceFile.sizeMB,
        limit: renderingConfig.maxFileSizeMB,
      });
      
      return {
        jobId,
        requestId,
        status: 'failed',
        error: {
          code: ErrorCode.FILE_TOO_LARGE,
          message: `File size ${sourceFile.sizeMB}MB exceeds maximum of ${renderingConfig.maxFileSizeMB}MB`,
          timestamp: new Date(),
          requestId,
        },
      };
    }
    
    // Calculate timeout based on file size
    // WARNING: Base timeout was reduced in PERF-2847, large files may timeout
    const timeout = getTimeoutForFileSize(sourceFile.sizeMB, 'export');
    
    logger.debug('Export timeout calculated', {
      requestId,
      fileSizeMB: sourceFile.sizeMB,
      timeoutMs: timeout,
      baseTimeoutMs: renderingConfig.exportTimeoutMs,
    });
    
    // Setup abort controller
    const abortController = new AbortController();
    this.activeExports.set(jobId, { startTime, abortController });
    
    try {
      // Perform export with timeout
      const result = await this.performExportWithTimeout(
        request,
        formatConfig,
        timeout,
        abortController.signal
      );
      
      const exportTimeMs = Date.now() - startTime;
      
      logger.info('Export completed', {
        requestId,
        jobId,
        exportTimeMs,
        outputFormat,
      });
      
      return {
        jobId,
        requestId,
        status: 'completed',
        outputUrl: result.outputUrl,
        outputSizeMB: result.outputSizeMB,
        exportTimeMs,
        format: outputFormat,
      };
      
    } catch (error: any) {
      const exportTimeMs = Date.now() - startTime;
      
      if (error.code === ErrorCode.EXPORT_TIMEOUT) {
        logger.error('Export timed out', {
          requestId,
          jobId,
          exportTimeMs,
          timeoutMs: timeout,
          fileSizeMB: sourceFile.sizeMB,
        });
        
        return {
          jobId,
          requestId,
          status: 'timeout',
          exportTimeMs,
          error: {
            code: ErrorCode.EXPORT_TIMEOUT,
            message: `Export timed out after ${timeout}ms`,
            details: {
              fileSizeMB: sourceFile.sizeMB,
              timeoutMs: timeout,
              suggestion: 'Consider reducing file size or quality settings',
            },
            timestamp: new Date(),
            requestId,
          },
        };
      }
      
      logger.error('Export failed', {
        requestId,
        jobId,
        error: error.message,
      });
      
      return {
        jobId,
        requestId,
        status: 'failed',
        exportTimeMs,
        error: {
          code: ErrorCode.EXPORT_FAILED,
          message: error.message || 'Export failed',
          timestamp: new Date(),
          requestId,
        },
      };
      
    } finally {
      this.activeExports.delete(jobId);
    }
  }

  /**
   * Perform export with timeout
   */
  private async performExportWithTimeout(
    request: ExportRequest,
    formatConfig: FormatConfig,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<{ outputUrl: string; outputSizeMB: number }> {
    return new Promise((resolve, reject) => {
      // Set timeout
      const timeoutId = setTimeout(() => {
        reject({ code: ErrorCode.EXPORT_TIMEOUT });
      }, timeoutMs);
      
      // Simulate export processing
      this.simulateExport(request, formatConfig, signal)
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Simulate export processing
   */
  private async simulateExport(
    request: ExportRequest,
    formatConfig: FormatConfig,
    signal: AbortSignal
  ): Promise<{ outputUrl: string; outputSizeMB: number }> {
    // Simulate processing time based on file size
    // Export is typically faster than rendering
    const processingTime = request.sourceFile.sizeMB * 75;
    
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, Math.min(processingTime, 3000));
      
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Export cancelled'));
      });
    });
    
    const outputSizeMB = estimateOutputSize(
      request.sourceFile.sizeMB,
      request.outputFormat,
      request.quality
    );
    
    return {
      outputUrl: `https://exports.adobe.com/${request.jobId}.${formatConfig.extension}`,
      outputSizeMB,
    };
  }

  /**
   * Batch export to multiple formats
   * 
   * Useful for "Export for Web" and similar workflows.
   */
  async batchExport(request: BatchExportRequest): Promise<ExportResult[]> {
    const { batchId, requestId, userId, userTier, sourceFile, exports } = request;
    
    logger.info('Batch export started', {
      requestId,
      batchId,
      formatCount: exports.length,
      fileSizeMB: sourceFile.sizeMB,
    });
    
    // Check batch optimization flag
    if (!renderingConfig.enableBatchOptimization) {
      logger.warn('Batch optimization disabled, processing sequentially', {
        requestId,
        batchId,
      });
    }
    
    const results: ExportResult[] = [];
    
    // Process exports (sequentially for simplicity, parallel in production)
    for (const exportConfig of exports) {
      const jobId = `${batchId}-${exportConfig.format}`;
      
      const exportRequest: ExportRequest = {
        jobId,
        requestId,
        userId,
        userTier,
        sourceFile,
        outputFormat: exportConfig.format,
        quality: exportConfig.quality,
        options: {
          preserveColorProfile: true,
          embedMetadata: true,
          optimizeForWeb: true,
        },
      };
      
      const result = await this.exportFile(exportRequest);
      results.push(result);
      
      // Stop on first failure if batch optimization is disabled
      if (!renderingConfig.enableBatchOptimization && result.status === 'failed') {
        break;
      }
    }
    
    logger.info('Batch export completed', {
      requestId,
      batchId,
      successCount: results.filter(r => r.status === 'completed').length,
      failedCount: results.filter(r => r.status === 'failed' || r.status === 'timeout').length,
    });
    
    return results;
  }

  /**
   * Cancel an active export
   */
  cancelExport(jobId: string): boolean {
    const activeExport = this.activeExports.get(jobId);
    
    if (activeExport) {
      activeExport.abortController.abort();
      this.activeExports.delete(jobId);
      logger.info('Export cancelled', { jobId });
      return true;
    }
    
    return false;
  }

  /**
   * Get exporter health status
   */
  getHealth(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    activeExports: number;
    configuredTimeout: number;
  } {
    return {
      status: this.activeExports.size < 10 ? 'healthy' : 'degraded',
      activeExports: this.activeExports.size,
      configuredTimeout: renderingConfig.exportTimeoutMs,
    };
  }
}

// Export singleton
export const exporter = new Exporter();

export default exporter;
