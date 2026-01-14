/**
 * File Utilities
 * 
 * Common file handling operations used across services.
 * 
 * @owner platform-team
 */

import { renderingConfig, isFileSizeAllowed } from '../config/rendering.config';
import { FileMetadata, SupportedFormat, ErrorCode, ServiceError } from '../types/common';
import { createLogger } from './logger';

const logger = createLogger('file-utils');

/**
 * Validate file before processing
 * 
 * Checks:
 * - File size against configured limits
 * - Format is supported
 * - Basic file integrity
 */
export function validateFile(file: FileMetadata): { valid: boolean; error?: ServiceError } {
  const requestId = `val-${Date.now()}`;
  
  // Check file size
  if (!isFileSizeAllowed(file.sizeMB)) {
    logger.warn('File size exceeds limit', {
      requestId,
      fileId: file.id,
      fileSizeMB: file.sizeMB,
      maxAllowedMB: renderingConfig.maxFileSizeMB,
    });
    
    return {
      valid: false,
      error: {
        code: ErrorCode.FILE_TOO_LARGE,
        message: `File size ${file.sizeMB}MB exceeds maximum allowed size of ${renderingConfig.maxFileSizeMB}MB`,
        details: {
          actualSize: file.sizeMB,
          maxAllowed: renderingConfig.maxFileSizeMB,
          suggestion: 'Consider reducing file size or upgrading to Enterprise tier',
        },
        timestamp: new Date(),
        requestId,
      },
    };
  }
  
  // Check format
  if (!renderingConfig.supportedFormats.includes(file.format)) {
    logger.warn('Unsupported file format', {
      requestId,
      fileId: file.id,
      format: file.format,
      supportedFormats: renderingConfig.supportedFormats,
    });
    
    return {
      valid: false,
      error: {
        code: ErrorCode.UNSUPPORTED_FORMAT,
        message: `Format '${file.format}' is not supported`,
        details: {
          providedFormat: file.format,
          supportedFormats: renderingConfig.supportedFormats,
        },
        timestamp: new Date(),
        requestId,
      },
    };
  }
  
  logger.debug('File validation passed', {
    requestId,
    fileId: file.id,
    sizeMB: file.sizeMB,
    format: file.format,
  });
  
  return { valid: true };
}

/**
 * Calculate estimated processing time based on file characteristics
 * 
 * NOTE: This estimation was calibrated before the config changes in PERF-2847.
 * Actual timeouts are now shorter than estimated times for large files.
 */
export function estimateProcessingTime(file: FileMetadata): {
  renderMs: number;
  exportMs: number;
  totalMs: number;
  withinTimeout: boolean;
} {
  // Base processing time per MB
  const msPerMB = 150;
  
  // Layer complexity multiplier
  const layerMultiplier = 1 + (file.layerCount / 100);
  
  // Resolution multiplier
  const megapixels = (file.width * file.height) / 1_000_000;
  const resolutionMultiplier = 1 + (megapixels / 50);
  
  // Calculate times
  const baseTime = file.sizeMB * msPerMB;
  const renderMs = Math.round(baseTime * layerMultiplier * resolutionMultiplier);
  const exportMs = Math.round(baseTime * 0.5); // Export is typically faster
  const totalMs = renderMs + exportMs;
  
  // Check against configured timeout
  // WARNING: This check uses the current config values which may have been reduced
  const withinTimeout = renderMs <= renderingConfig.renderTimeoutMs;
  
  if (!withinTimeout) {
    logger.warn('Estimated render time exceeds timeout', {
      fileId: file.id,
      estimatedMs: renderMs,
      timeoutMs: renderingConfig.renderTimeoutMs,
      fileSizeMB: file.sizeMB,
    });
  }
  
  return {
    renderMs,
    exportMs,
    totalMs,
    withinTimeout,
  };
}

/**
 * Get file extension from filename
 */
export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/**
 * Convert file extension to SupportedFormat
 */
export function extensionToFormat(extension: string): SupportedFormat | null {
  const formatMap: Record<string, SupportedFormat> = {
    psd: 'psd',
    psb: 'psb',
    tif: 'tiff',
    tiff: 'tiff',
    png: 'png',
    jpg: 'jpeg',
    jpeg: 'jpeg',
    raw: 'raw',
    svg: 'svg',
    pdf: 'pdf',
    webp: 'webp',
  };
  
  return formatMap[extension.toLowerCase()] || null;
}

/**
 * Generate a unique file ID
 */
export function generateFileId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `file_${timestamp}_${random}`;
}

/**
 * Calculate file hash for deduplication
 */
export async function calculateFileHash(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parse PSD file header to extract metadata
 * 
 * This is a simplified version - real implementation uses psd.js library
 */
export function parsePsdHeader(buffer: ArrayBuffer): Partial<FileMetadata> {
  const view = new DataView(buffer);
  
  // PSD signature check (8BPS)
  const signature = String.fromCharCode(
    view.getUint8(0),
    view.getUint8(1),
    view.getUint8(2),
    view.getUint8(3)
  );
  
  if (signature !== '8BPS') {
    throw new Error('Invalid PSD file signature');
  }
  
  // Version (1 = PSD, 2 = PSB)
  const version = view.getUint16(4);
  const format: SupportedFormat = version === 2 ? 'psb' : 'psd';
  
  // Dimensions (offset depends on header structure)
  const height = view.getUint32(14);
  const width = view.getUint32(18);
  const bitDepth = view.getUint16(22) as 8 | 16 | 32;
  
  return {
    format,
    width,
    height,
    bitDepth,
    sizeMB: buffer.byteLength / (1024 * 1024),
  };
}
