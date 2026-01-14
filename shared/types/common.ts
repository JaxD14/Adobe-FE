/**
 * Common Type Definitions
 * 
 * Shared types used across all Photoshop cloud services.
 * 
 * @owner platform-team
 */

/**
 * User tier levels for Creative Cloud subscriptions
 */
export type UserTier = 'free' | 'pro' | 'enterprise';

/**
 * Supported file formats for processing
 */
export type SupportedFormat = 'psd' | 'psb' | 'tiff' | 'png' | 'jpeg' | 'raw' | 'svg' | 'pdf' | 'webp';

/**
 * Job status for async operations
 */
export type JobStatus = 
  | 'queued' 
  | 'processing' 
  | 'completed' 
  | 'failed' 
  | 'timeout' 
  | 'cancelled';

/**
 * Error codes returned by services
 */
export enum ErrorCode {
  // File errors (1xxx)
  FILE_TOO_LARGE = 1001,
  UNSUPPORTED_FORMAT = 1002,
  FILE_CORRUPTED = 1003,
  FILE_NOT_FOUND = 1004,
  
  // Processing errors (2xxx)
  RENDER_TIMEOUT = 2001,
  RENDER_FAILED = 2002,
  MEMORY_EXCEEDED = 2003,
  GPU_UNAVAILABLE = 2004,
  
  // Export errors (3xxx)
  EXPORT_TIMEOUT = 3001,
  EXPORT_FAILED = 3002,
  INVALID_OUTPUT_FORMAT = 3003,
  
  // Sync errors (4xxx)
  SYNC_TIMEOUT = 4001,
  SYNC_CONFLICT = 4002,
  SYNC_FAILED = 4003,
  
  // System errors (5xxx)
  INTERNAL_ERROR = 5001,
  SERVICE_UNAVAILABLE = 5002,
  QUEUE_FULL = 5003,
}

/**
 * Base error response structure
 */
export interface ServiceError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  timestamp: Date;
  requestId: string;
}

/**
 * File metadata extracted during processing
 */
export interface FileMetadata {
  id: string;
  filename: string;
  format: SupportedFormat;
  sizeMB: number;
  width: number;
  height: number;
  layerCount: number;
  colorSpace: 'rgb' | 'cmyk' | 'grayscale' | 'lab';
  bitDepth: 8 | 16 | 32;
  hasTransparency: boolean;
  createdAt: Date;
  modifiedAt: Date;
}

/**
 * Job request base structure
 */
export interface JobRequest {
  jobId: string;
  requestId: string;
  userId: string;
  userTier: UserTier;
  file: FileMetadata;
  priority: 'low' | 'normal' | 'high' | 'critical';
  createdAt: Date;
}

/**
 * Job result base structure
 */
export interface JobResult {
  jobId: string;
  status: JobStatus;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  error?: ServiceError;
}

/**
 * Render job specific request
 */
export interface RenderJobRequest extends JobRequest {
  type: 'render';
  options: {
    quality: 'preview' | 'standard' | 'high';
    targetWidth?: number;
    targetHeight?: number;
    useGpu: boolean;
  };
}

/**
 * Export job specific request
 */
export interface ExportJobRequest extends JobRequest {
  type: 'export';
  options: {
    outputFormat: SupportedFormat;
    quality: number; // 1-100
    preserveLayers: boolean;
    colorProfile?: string;
  };
}

/**
 * Sync job specific request
 */
export interface SyncJobRequest extends JobRequest {
  type: 'sync';
  options: {
    direction: 'upload' | 'download' | 'bidirectional';
    conflictResolution: 'local' | 'remote' | 'manual';
  };
}

/**
 * Health check response
 */
export interface HealthStatus {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  checks: {
    name: string;
    status: 'pass' | 'fail';
    message?: string;
  }[];
}
