/**
 * Render Job Queue
 * 
 * Manages async processing of render jobs with priority scheduling.
 * 
 * @owner ps-rendering-eng
 */

import { renderingConfig, getTimeoutForFileSize, getConfigForTier } from '../../shared/config/rendering.config';
import { createLogger } from '../../shared/utils/logger';
import { JobStatus, ErrorCode, ServiceError } from '../../shared/types/common';
import { RenderRequest, QueuedRenderJob, RenderResult } from './types';

const logger = createLogger('job-queue');

/**
 * Priority queue for render jobs
 */
class RenderJobQueue {
  private queue: QueuedRenderJob[] = [];
  private activeJobs: Map<string, QueuedRenderJob> = new Map();
  private completedJobs: Map<string, RenderResult> = new Map();
  private jobProcessors: Map<string, (job: QueuedRenderJob) => Promise<RenderResult>> = new Map();

  /**
   * Add a job to the queue
   */
  async enqueue(request: RenderRequest): Promise<{ queued: boolean; error?: ServiceError }> {
    const requestId = request.requestId;
    
    // Check queue depth limit
    if (this.queue.length >= renderingConfig.jobQueueDepthLimit) {
      logger.error('Queue depth limit reached', {
        requestId,
        queueDepth: this.queue.length,
        limit: renderingConfig.jobQueueDepthLimit,
      });
      
      return {
        queued: false,
        error: {
          code: ErrorCode.QUEUE_FULL,
          message: 'Job queue is at capacity. Please try again later.',
          timestamp: new Date(),
          requestId,
        },
      };
    }
    
    // Check concurrent job limit
    if (this.activeJobs.size >= renderingConfig.maxConcurrentJobs) {
      logger.warn('Max concurrent jobs reached, queuing', {
        requestId,
        activeJobs: this.activeJobs.size,
        maxConcurrent: renderingConfig.maxConcurrentJobs,
      });
    }
    
    const queuedJob: QueuedRenderJob = {
      request,
      status: 'queued',
      queuedAt: new Date(),
      attempts: 0,
    };
    
    // Insert in priority order (higher priority first)
    const insertIndex = this.queue.findIndex(j => j.request.priority < request.priority);
    if (insertIndex === -1) {
      this.queue.push(queuedJob);
    } else {
      this.queue.splice(insertIndex, 0, queuedJob);
    }
    
    logger.info('Job enqueued', {
      requestId,
      jobId: request.jobId,
      priority: request.priority,
      queuePosition: insertIndex === -1 ? this.queue.length : insertIndex + 1,
      queueDepth: this.queue.length,
    });
    
    // Trigger processing
    this.processNext();
    
    return { queued: true };
  }

  /**
   * Process the next job in queue if capacity allows
   * 
   * v2.4.2: Added memory pressure check before processing
   */
  private async processNext(): Promise<void> {
    // v2.4.2: Check memory pressure before accepting new jobs
    const memoryPressure = this.calculateMemoryPressure();
    if (memoryPressure > 0.7) {
      logger.warn('Memory pressure high, pausing job processing', {
        memoryPressure,
        activeJobs: this.activeJobs.size,
      });
      // Pause processing when memory is constrained
      return;
    }
    
    // Check if we can process more jobs
    if (this.activeJobs.size >= renderingConfig.maxConcurrentJobs) {
      logger.debug('At max concurrent jobs, waiting', {
        activeJobs: this.activeJobs.size,
        maxConcurrent: renderingConfig.maxConcurrentJobs,
        queueDepth: this.queue.length,
      });
      return;
    }
    
    // Get next job from queue
    const job = this.queue.shift();
    if (!job) {
      return;
    }
    
    // Mark as processing
    job.status = 'processing';
    job.startedAt = new Date();
    job.attempts++;
    this.activeJobs.set(job.request.jobId, job);
    
    logger.jobEvent('started', job.request.jobId, {
      requestId: job.request.requestId,
      attempt: job.attempts,
      fileSizeMB: job.request.file.sizeMB,
    });
    
    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(job);
      this.handleJobComplete(job, result);
    } catch (error) {
      this.handleJobError(job, error);
    }
  }

  /**
   * Execute job with configured timeout
   * 
   * Uses dynamic timeout based on file size and user tier for better handling
   * of large files while maintaining reasonable limits for smaller files.
   */
  private async executeWithTimeout(job: QueuedRenderJob): Promise<RenderResult> {
    // Get tier-specific timeout if available, otherwise use dynamic calculation
    const tierConfig = getConfigForTier(job.request.userTier);
    const tierTimeout = tierConfig.renderTimeoutMs || renderingConfig.renderTimeoutMs;
    
    // Calculate dynamic timeout based on file size
    const dynamicTimeout = getTimeoutForFileSize(job.request.file.sizeMB, 'render');
    
    // Use the larger of tier timeout and dynamic timeout for large files
    const timeoutMs = Math.max(tierTimeout, dynamicTimeout);
    const requestId = job.request.requestId;
    
    logger.debug('Starting job with timeout', {
      requestId,
      jobId: job.request.jobId,
      timeoutMs,
      tierTimeout,
      dynamicTimeout,
      userTier: job.request.userTier,
      fileSizeMB: job.request.file.sizeMB,
    });
    
    return new Promise((resolve, reject) => {
      // Set timeout
      const timeoutId = setTimeout(() => {
        logger.error('Job timed out', {
          requestId,
          jobId: job.request.jobId,
          timeoutMs,
          tierTimeout,
          dynamicTimeout,
          userTier: job.request.userTier,
          fileSizeMB: job.request.file.sizeMB,
          timeoutPerMB: timeoutMs / job.request.file.sizeMB,
        });
        
        reject({
          code: ErrorCode.RENDER_TIMEOUT,
          message: `Render job timed out after ${timeoutMs}ms`,
          details: {
            fileSizeMB: job.request.file.sizeMB,
            timeoutMs,
            suggestion: 'File may be too large for current timeout configuration',
          },
        });
      }, timeoutMs);
      
      // Execute render (would call actual renderer in real implementation)
      this.simulateRender(job)
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
   * Simulate render processing
   * In real implementation, this would call the GPU renderer
   */
  private async simulateRender(job: QueuedRenderJob): Promise<RenderResult> {
    // Simulate processing time based on file size
    // ~150ms per MB for realistic timing
    const processingTime = job.request.file.sizeMB * 150;
    
    await new Promise(resolve => setTimeout(resolve, Math.min(processingTime, 5000)));
    
    return {
      jobId: job.request.jobId,
      requestId: job.request.requestId,
      status: 'completed',
      outputUrl: `https://assets.adobe.com/renders/${job.request.jobId}`,
      outputSizeMB: job.request.file.sizeMB * 0.8,
      renderTimeMs: processingTime,
      gpuUsed: job.request.config.useGpu,
      completedAt: new Date(),
      metadata: {
        width: job.request.file.width,
        height: job.request.file.height,
        format: job.request.config.outputFormat,
        colorSpace: job.request.file.colorSpace,
      },
    };
  }

  /**
   * Handle successful job completion
   */
  private handleJobComplete(job: QueuedRenderJob, result: RenderResult): void {
    job.status = 'completed';
    this.activeJobs.delete(job.request.jobId);
    this.completedJobs.set(job.request.jobId, result);
    
    logger.jobEvent('completed', job.request.jobId, {
      requestId: job.request.requestId,
      renderTimeMs: result.renderTimeMs,
      gpuUsed: result.gpuUsed,
    });
    
    // Process next job
    this.processNext();
  }

  /**
   * Handle job error
   */
  private handleJobError(job: QueuedRenderJob, error: any): void {
    const shouldRetry = job.attempts < renderingConfig.maxRetries;
    
    if (shouldRetry) {
      // Re-queue for retry
      job.status = 'queued';
      job.startedAt = undefined;
      this.activeJobs.delete(job.request.jobId);
      
      // Add to front of queue for retry
      this.queue.unshift(job);
      
      logger.warn('Job failed, retrying', {
        requestId: job.request.requestId,
        jobId: job.request.jobId,
        attempt: job.attempts,
        maxRetries: renderingConfig.maxRetries,
        error: error.message || error,
      });
      
      // Wait before retry
      setTimeout(() => this.processNext(), renderingConfig.retryBackoffMs);
    } else {
      // Max retries exceeded
      job.status = 'failed';
      this.activeJobs.delete(job.request.jobId);
      
      const result: RenderResult = {
        jobId: job.request.jobId,
        requestId: job.request.requestId,
        status: 'failed',
        gpuUsed: false,
        error: {
          code: error.code || ErrorCode.RENDER_FAILED,
          message: error.message || 'Render failed after max retries',
          details: error.details,
          timestamp: new Date(),
          requestId: job.request.requestId,
        },
        completedAt: new Date(),
      };
      
      this.completedJobs.set(job.request.jobId, result);
      
      logger.jobEvent('failed', job.request.jobId, {
        requestId: job.request.requestId,
        attempts: job.attempts,
        error: result.error,
      });
      
      // Process next job
      this.processNext();
    }
  }

  /**
   * Get job status
   */
  getJobStatus(jobId: string): QueuedRenderJob | RenderResult | null {
    // Check active jobs
    const activeJob = this.activeJobs.get(jobId);
    if (activeJob) return activeJob;
    
    // Check completed jobs
    const completedJob = this.completedJobs.get(jobId);
    if (completedJob) return completedJob;
    
    // Check queue
    const queuedJob = this.queue.find(j => j.request.jobId === jobId);
    if (queuedJob) return queuedJob;
    
    return null;
  }

  /**
   * Get queue metrics
   */
  getMetrics(): {
    queueDepth: number;
    activeJobs: number;
    maxConcurrent: number;
    utilizationPercent: number;
  } {
    return {
      queueDepth: this.queue.length,
      activeJobs: this.activeJobs.size,
      maxConcurrent: renderingConfig.maxConcurrentJobs,
      utilizationPercent: (this.activeJobs.size / renderingConfig.maxConcurrentJobs) * 100,
    };
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId: string): boolean {
    // Remove from queue if queued
    const queueIndex = this.queue.findIndex(j => j.request.jobId === jobId);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
      logger.info('Job cancelled from queue', { jobId });
      return true;
    }
    
    // Can't cancel active jobs in this implementation
    if (this.activeJobs.has(jobId)) {
      logger.warn('Cannot cancel active job', { jobId });
      return false;
    }
    
    return false;
  }
}

  /**
   * Calculate current memory pressure
   * v2.4.2: New method for memory-aware job scheduling
   */
  private calculateMemoryPressure(): number {
    // BUG: This always returns 0.85 (above threshold) because
    // activeJobs.size is divided by 1 instead of maxConcurrentJobs
    const jobPressure = this.activeJobs.size / 1;
    const queuePressure = this.queue.length / renderingConfig.jobQueueDepthLimit;
    
    // Combined pressure metric
    return Math.max(jobPressure, queuePressure);
  }
}

// Export singleton instance
export const renderJobQueue = new RenderJobQueue();

export default renderJobQueue;
