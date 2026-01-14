/**
 * Rendering Service Type Definitions
 * 
 * @owner ps-rendering-eng
 */

import { FileMetadata, JobStatus, ServiceError, UserTier } from '../../shared/types/common';

/**
 * Render quality presets
 */
export type RenderQuality = 'preview' | 'standard' | 'high' | 'ultra';

/**
 * Render output format
 */
export type RenderOutputFormat = 'raw' | 'compressed' | 'progressive';

/**
 * Layer rendering mode
 */
export type LayerRenderMode = 'all' | 'visible' | 'selected' | 'flattened';

/**
 * Render job configuration
 */
export interface RenderJobConfig {
  quality: RenderQuality;
  outputFormat: RenderOutputFormat;
  layerMode: LayerRenderMode;
  targetWidth?: number;
  targetHeight?: number;
  useGpu: boolean;
  preserveColorProfile: boolean;
}

/**
 * Render job request
 */
export interface RenderRequest {
  jobId: string;
  requestId: string;
  userId: string;
  userTier: UserTier;
  file: FileMetadata;
  config: RenderJobConfig;
  priority: number; // 0-100, higher = more urgent
  callbackUrl?: string;
  createdAt: Date;
}

/**
 * Render job in queue
 */
export interface QueuedRenderJob {
  request: RenderRequest;
  status: JobStatus;
  queuedAt: Date;
  startedAt?: Date;
  attempts: number;
}

/**
 * Render result
 */
export interface RenderResult {
  jobId: string;
  requestId: string;
  status: JobStatus;
  outputUrl?: string;
  outputSizeMB?: number;
  renderTimeMs?: number;
  gpuUsed: boolean;
  error?: ServiceError;
  completedAt?: Date;
  metadata?: {
    width: number;
    height: number;
    format: string;
    colorSpace: string;
  };
}

/**
 * Render progress update
 */
export interface RenderProgress {
  jobId: string;
  phase: 'parsing' | 'compositing' | 'effects' | 'output' | 'complete';
  percentComplete: number;
  currentLayer?: string;
  estimatedRemainingMs?: number;
}

/**
 * GPU worker status
 */
export interface GpuWorkerStatus {
  workerId: string;
  available: boolean;
  gpuModel: string;
  memoryUsedMB: number;
  memoryTotalMB: number;
  currentJobId?: string;
  temperature?: number;
}

/**
 * Render service metrics
 */
export interface RenderMetrics {
  activeJobs: number;
  queuedJobs: number;
  completedLast5Min: number;
  failedLast5Min: number;
  averageRenderTimeMs: number;
  gpuUtilization: number;
}
