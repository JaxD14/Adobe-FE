/**
 * Rendering Service
 * 
 * Cloud-based PSD rendering service for Adobe Photoshop.
 * Handles real-time compositing, preview generation, and full renders.
 * 
 * @owner ps-rendering-eng
 * @oncall ps-rendering-eng
 */

import { createLogger } from '../../shared/utils/logger';
import { HealthStatus } from '../../shared/types/common';
import { psdRenderer } from './renderer';
import { renderJobQueue } from './job-queue';

export * from './types';
export * from './renderer';
export * from './job-queue';

const logger = createLogger('rendering-service');

/**
 * Service initialization
 */
export async function initializeRenderingService(): Promise<void> {
  logger.info('Initializing rendering service');
  
  // In production, this would:
  // - Connect to GPU cluster
  // - Initialize job queue workers
  // - Set up monitoring
  
  logger.info('Rendering service initialized');
}

/**
 * Service health check
 */
export function getHealthStatus(): HealthStatus {
  const rendererHealth = psdRenderer.getHealth();
  const queueMetrics = renderJobQueue.getMetrics();
  
  return {
    service: 'rendering-service',
    status: rendererHealth.status,
    version: '2.4.1', // Current version after PERF-2847 changes
    uptime: process.uptime(),
    checks: [
      {
        name: 'renderer',
        status: rendererHealth.status === 'unhealthy' ? 'fail' : 'pass',
        message: `Active renders: ${rendererHealth.metrics.activeRenders}`,
      },
      {
        name: 'job-queue',
        status: queueMetrics.queueDepth < 80 ? 'pass' : 'fail',
        message: `Queue depth: ${queueMetrics.queueDepth}, Active: ${queueMetrics.activeJobs}/${queueMetrics.maxConcurrent}`,
      },
      {
        name: 'config',
        status: 'pass',
        message: `Timeout: ${rendererHealth.metrics.configuredTimeout}ms, Max size: ${rendererHealth.metrics.configuredMaxSize}MB`,
      },
    ],
  };
}

/**
 * Graceful shutdown
 */
export async function shutdownRenderingService(): Promise<void> {
  logger.info('Shutting down rendering service');
  
  // In production, this would:
  // - Stop accepting new jobs
  // - Wait for active renders to complete
  // - Disconnect from GPU cluster
  
  logger.info('Rendering service shutdown complete');
}
