/**
 * Export Format Definitions
 * 
 * Supported export formats and their configurations.
 * 
 * @owner ps-export-eng
 */

import { SupportedFormat } from '../../shared/types/common';

/**
 * Export format configuration
 */
export interface FormatConfig {
  format: SupportedFormat;
  extension: string;
  mimeType: string;
  supportsTransparency: boolean;
  supportsLayers: boolean;
  maxQuality: number;
  defaultQuality: number;
  compressionTypes: string[];
  colorSpaces: string[];
}

/**
 * Format configurations
 */
export const formatConfigs: Record<string, FormatConfig> = {
  png: {
    format: 'png',
    extension: 'png',
    mimeType: 'image/png',
    supportsTransparency: true,
    supportsLayers: false,
    maxQuality: 100,
    defaultQuality: 90,
    compressionTypes: ['none', 'deflate'],
    colorSpaces: ['rgb', 'grayscale'],
  },
  jpeg: {
    format: 'jpeg',
    extension: 'jpg',
    mimeType: 'image/jpeg',
    supportsTransparency: false,
    supportsLayers: false,
    maxQuality: 100,
    defaultQuality: 85,
    compressionTypes: ['baseline', 'progressive'],
    colorSpaces: ['rgb', 'cmyk', 'grayscale'],
  },
  webp: {
    format: 'webp',
    extension: 'webp',
    mimeType: 'image/webp',
    supportsTransparency: true,
    supportsLayers: false,
    maxQuality: 100,
    defaultQuality: 85,
    compressionTypes: ['lossy', 'lossless'],
    colorSpaces: ['rgb'],
  },
  tiff: {
    format: 'tiff',
    extension: 'tif',
    mimeType: 'image/tiff',
    supportsTransparency: true,
    supportsLayers: true,
    maxQuality: 100,
    defaultQuality: 100,
    compressionTypes: ['none', 'lzw', 'zip', 'jpeg'],
    colorSpaces: ['rgb', 'cmyk', 'lab', 'grayscale'],
  },
  pdf: {
    format: 'pdf',
    extension: 'pdf',
    mimeType: 'application/pdf',
    supportsTransparency: true,
    supportsLayers: true,
    maxQuality: 100,
    defaultQuality: 90,
    compressionTypes: ['none', 'jpeg', 'zip'],
    colorSpaces: ['rgb', 'cmyk', 'grayscale'],
  },
  svg: {
    format: 'svg',
    extension: 'svg',
    mimeType: 'image/svg+xml',
    supportsTransparency: true,
    supportsLayers: false,
    maxQuality: 100,
    defaultQuality: 100,
    compressionTypes: ['none'],
    colorSpaces: ['rgb'],
  },
  psd: {
    format: 'psd',
    extension: 'psd',
    mimeType: 'image/vnd.adobe.photoshop',
    supportsTransparency: true,
    supportsLayers: true,
    maxQuality: 100,
    defaultQuality: 100,
    compressionTypes: ['rle', 'zip'],
    colorSpaces: ['rgb', 'cmyk', 'lab', 'grayscale'],
  },
};

/**
 * Get format config by format name
 */
export function getFormatConfig(format: string): FormatConfig | null {
  return formatConfigs[format.toLowerCase()] || null;
}

/**
 * Check if format supports transparency
 */
export function supportsTransparency(format: string): boolean {
  const config = getFormatConfig(format);
  return config?.supportsTransparency ?? false;
}

/**
 * Get recommended format for a use case
 */
export function getRecommendedFormat(useCase: 'web' | 'print' | 'archive' | 'social'): SupportedFormat {
  const recommendations: Record<string, SupportedFormat> = {
    web: 'webp',
    print: 'tiff',
    archive: 'psd',
    social: 'jpeg',
  };
  
  return recommendations[useCase] || 'png';
}

/**
 * Estimate output file size based on format and quality
 */
export function estimateOutputSize(
  inputSizeMB: number,
  format: SupportedFormat,
  quality: number
): number {
  const compressionRatios: Record<string, number> = {
    png: 0.7,
    jpeg: 0.3,
    webp: 0.25,
    tiff: 0.9,
    pdf: 0.5,
    svg: 0.1,
    psd: 1.0,
  };
  
  const baseRatio = compressionRatios[format] || 0.5;
  const qualityFactor = quality / 100;
  
  return inputSizeMB * baseRatio * qualityFactor;
}
