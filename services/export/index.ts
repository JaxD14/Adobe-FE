/**
 * Export Service
 * 
 * Handles file format conversion for Adobe Photoshop cloud.
 * Supports PNG, JPEG, WebP, TIFF, PDF, SVG export.
 * 
 * @owner ps-export-eng
 */

import { createLogger } from '../../shared/utils/logger';
import { HealthStatus } from '../../shared/types/common';
import { exporter } from './exporter';

export * from './formats';
export * from './exporter';

const logger = createLogger('export-service');

/**
 * Initialize export service
 */
export async function initializeExportService(): Promise<void> {
  logger.info('Initializing export service');
  
  // In production:
  // - Initialize format encoders
  // - Connect to storage service
  // - Setup monitoring
  
  logger.info('Export service initialized');
}

/**
 * Get service health
 */
export function getHealthStatus(): HealthStatus {
  const health = exporter.getHealth();
  
  return {
    service: 'export-service',
    status: health.status,
    version: '2.4.1',
    uptime: process.uptime(),
    checks: [
      {
        name: 'exporter',
        status: health.status === 'unhealthy' ? 'fail' : 'pass',
        message: `Active exports: ${health.activeExports}`,
      },
      {
        name: 'config',
        status: 'pass',
        message: `Timeout: ${health.configuredTimeout}ms`,
      },
    ],
  };
}

/**
 * Graceful shutdown
 */
export async function shutdownExportService(): Promise<void> {
  logger.info('Shutting down export service');
  logger.info('Export service shutdown complete');
}
