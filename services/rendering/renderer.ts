/**
 * Core Rendering Engine
 * 
 * Handles PSD compositing and layer rendering for cloud-based Photoshop.
 * 
 * @owner ps-rendering-eng
 * @oncall ps-rendering-eng
 */

import { 
  renderingConfig, 
  isFileSizeAllowed, 
  getTimeoutForFileSize,
  getConfigForTier 
} from '../../shared/config/rendering.config';
import { createLogger } from '../../shared/utils/logger';
import { validateFile, estimateProcessingTime } from '../../shared/utils/file-utils';
import { FileMetadata, ErrorCode, ServiceError, UserTier } from '../../shared/types/common';
import { RenderRequest, RenderResult, RenderProgress, RenderJobConfig } from './types';
import { renderJobQueue } from './job-queue';

const logger = createLogger('renderer');

/**
 * Main rendering class
 * 
 * Orchestrates the rendering pipeline for PSD files.
 */
export class PsdRenderer {
  private activeRenders: Map<string, AbortController> = new Map();

  /**
   * Submit a file for rendering
   * 
   * This is the main entry point for render requests.
   */
  async submitRender(
    file: FileMetadata,
    userId: string,
    userTier: UserTier,
    config: Partial<RenderJobConfig> = {}
  ): Promise<{ jobId: string; error?: ServiceError }> {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const jobId = `render-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info('Render request received', {
      requestId,
      jobId,
      userId,
      userTier,
      fileId: file.id,
      fileSizeMB: file.sizeMB,
      fileName: file.filename,
    });
    
    // Validate file
    const validation = validateFile(file);
    if (!validation.valid) {
      logger.warn('File validation failed', {
        requestId,
        fileId: file.id,
        error: validation.error,
      });
      return { jobId, error: validation.error };
    }
    
    // Check tier-specific limits
    const tierConfig = getConfigForTier(userTier);
    
    // BUG: tierConfig.maxFileSizeMB inherits from base config (100MB)
    // instead of using tier-specific limits (enterprise should be 500MB)
    if (file.sizeMB > (tierConfig.maxFileSizeMB || renderingConfig.maxFileSizeMB)) {
      logger.warn('File exceeds tier limit', {
        requestId,
        fileId: file.id,
        fileSizeMB: file.sizeMB,
        tierLimit: tierConfig.maxFileSizeMB,
        userTier,
      });
      
      return {
        jobId,
        error: {
          code: ErrorCode.FILE_TOO_LARGE,
          message: `File size ${file.sizeMB}MB exceeds your plan limit of ${tierConfig.maxFileSizeMB}MB`,
          details: {
            currentTier: userTier,
            fileSizeMB: file.sizeMB,
            tierLimitMB: tierConfig.maxFileSizeMB,
          },
          timestamp: new Date(),
          requestId,
        },
      };
    }
    
    // Estimate processing time and warn if likely to timeout
    const estimate = estimateProcessingTime(file);
    if (!estimate.withinTimeout) {
      // WARNING: Since PERF-2847, many large files exceed the new timeout
      // This warning is logged but the job is still submitted
      logger.warn('File may exceed render timeout', {
        requestId,
        fileId: file.id,
        estimatedMs: estimate.renderMs,
        timeoutMs: renderingConfig.renderTimeoutMs,
        recommendation: 'Consider optimizing file or increasing timeout',
      });
    }
    
    // Build full config
    const fullConfig: RenderJobConfig = {
      quality: config.quality || 'standard',
      outputFormat: config.outputFormat || 'compressed',
      layerMode: config.layerMode || 'visible',
      targetWidth: config.targetWidth,
      targetHeight: config.targetHeight,
      useGpu: config.useGpu ?? renderingConfig.enableGpuRendering,
      preserveColorProfile: config.preserveColorProfile ?? true,
    };
    
    // Create render request
    const request: RenderRequest = {
      jobId,
      requestId,
      userId,
      userTier,
      file,
      config: fullConfig,
      priority: this.calculatePriority(userTier, file.sizeMB),
      createdAt: new Date(),
    };
    
    // Submit to queue
    const queueResult = await renderJobQueue.enqueue(request);
    
    if (!queueResult.queued) {
      return { jobId, error: queueResult.error };
    }
    
    logger.info('Render job submitted', {
      requestId,
      jobId,
      estimatedRenderMs: estimate.renderMs,
      timeoutMs: renderingConfig.renderTimeoutMs,
    });
    
    return { jobId };
  }

  /**
   * Calculate job priority based on user tier and file size
   * 
   * Higher priority = processed sooner
   */
  private calculatePriority(tier: UserTier, fileSizeMB: number): number {
    const tierPriority: Record<UserTier, number> = {
      enterprise: 80,
      pro: 50,
      free: 20,
    };
    
    const basePriority = tierPriority[tier];
    
    // Smaller files get slight priority boost (faster to complete)
    const sizeBonus = Math.max(0, 20 - (fileSizeMB / 25));
    
    return Math.min(100, basePriority + sizeBonus);
  }

  /**
   * Get render job status
   */
  async getStatus(jobId: string): Promise<RenderResult | null> {
    const status = renderJobQueue.getJobStatus(jobId);
    
    if (!status) {
      return null;
    }
    
    // If it's a completed result, return as-is
    if ('outputUrl' in status) {
      return status;
    }
    
    // Convert queued job to result format
    return {
      jobId: status.request.jobId,
      requestId: status.request.requestId,
      status: status.status,
      gpuUsed: false,
    };
  }

  /**
   * Cancel a render job
   */
  async cancelRender(jobId: string): Promise<boolean> {
    // Try to cancel in queue
    const cancelled = renderJobQueue.cancelJob(jobId);
    
    // Also abort if actively rendering
    const controller = this.activeRenders.get(jobId);
    if (controller) {
      controller.abort();
      this.activeRenders.delete(jobId);
      logger.info('Active render aborted', { jobId });
      return true;
    }
    
    return cancelled;
  }

  /**
   * Process layer compositing
   * 
   * This is the core rendering logic that composites PSD layers.
   * Called by the job queue when processing a render.
   */
  async composeLayers(
    request: RenderRequest,
    onProgress?: (progress: RenderProgress) => void
  ): Promise<{ success: boolean; outputBuffer?: ArrayBuffer; error?: ServiceError }> {
    const { jobId, requestId, file, config } = request;
    
    logger.info('Starting layer composition', {
      requestId,
      jobId,
      layerCount: file.layerCount,
      useGpu: config.useGpu,
    });
    
    // Create abort controller for this render
    const abortController = new AbortController();
    this.activeRenders.set(jobId, abortController);
    
    try {
      // Phase 1: Parse PSD structure
      onProgress?.({
        jobId,
        phase: 'parsing',
        percentComplete: 10,
        estimatedRemainingMs: this.estimateRemainingTime(file, 'parsing'),
      });
      
      await this.simulateProcessing(500, abortController.signal);
      
      // Phase 2: Composite layers
      onProgress?.({
        jobId,
        phase: 'compositing',
        percentComplete: 30,
        estimatedRemainingMs: this.estimateRemainingTime(file, 'compositing'),
      });
      
      const compositeTime = file.layerCount * 50; // 50ms per layer
      await this.simulateProcessing(
        Math.min(compositeTime, 3000),
        abortController.signal
      );
      
      // Phase 3: Apply effects
      onProgress?.({
        jobId,
        phase: 'effects',
        percentComplete: 70,
        estimatedRemainingMs: this.estimateRemainingTime(file, 'effects'),
      });
      
      await this.simulateProcessing(1000, abortController.signal);
      
      // Phase 4: Generate output
      onProgress?.({
        jobId,
        phase: 'output',
        percentComplete: 90,
        estimatedRemainingMs: this.estimateRemainingTime(file, 'output'),
      });
      
      await this.simulateProcessing(500, abortController.signal);
      
      // Complete
      onProgress?.({
        jobId,
        phase: 'complete',
        percentComplete: 100,
        estimatedRemainingMs: 0,
      });
      
      logger.info('Layer composition complete', {
        requestId,
        jobId,
      });
      
      // Return simulated output
      return {
        success: true,
        outputBuffer: new ArrayBuffer(file.sizeMB * 1024 * 1024 * 0.8),
      };
      
    } catch (error: any) {
      if (error.name === 'AbortError') {
        logger.info('Render aborted', { requestId, jobId });
        return {
          success: false,
          error: {
            code: ErrorCode.RENDER_FAILED,
            message: 'Render was cancelled',
            timestamp: new Date(),
            requestId,
          },
        };
      }
      
      logger.error('Layer composition failed', {
        requestId,
        jobId,
        error: error.message,
      });
      
      return {
        success: false,
        error: {
          code: ErrorCode.RENDER_FAILED,
          message: error.message || 'Unknown rendering error',
          timestamp: new Date(),
          requestId,
        },
      };
    } finally {
      this.activeRenders.delete(jobId);
    }
  }

  /**
   * Estimate remaining time for a render phase
   */
  private estimateRemainingTime(file: FileMetadata, phase: string): number {
    const phaseTimes: Record<string, number> = {
      parsing: file.sizeMB * 10,
      compositing: file.layerCount * 50,
      effects: 1000,
      output: file.sizeMB * 5,
    };
    
    return phaseTimes[phase] || 1000;
  }

  /**
   * Simulate processing with abort support
   */
  private simulateProcessing(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  }

  /**
   * Get renderer health status
   */
  getHealth(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    metrics: {
      activeRenders: number;
      queueMetrics: ReturnType<typeof renderJobQueue.getMetrics>;
      configuredTimeout: number;
      configuredMaxSize: number;
    };
  } {
    const queueMetrics = renderJobQueue.getMetrics();
    
    // Check health conditions
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (queueMetrics.utilizationPercent > 90) {
      status = 'degraded';
    }
    
    if (queueMetrics.queueDepth > renderingConfig.jobQueueDepthLimit * 0.8) {
      status = 'degraded';
    }
    
    return {
      status,
      metrics: {
        activeRenders: this.activeRenders.size,
        queueMetrics,
        configuredTimeout: renderingConfig.renderTimeoutMs,
        configuredMaxSize: renderingConfig.maxFileSizeMB,
      },
    };
  }
}

// Export singleton instance
export const psdRenderer = new PsdRenderer();

export default psdRenderer;
