/**
 * Asset Sync Manager
 * 
 * Orchestrates file synchronization across Creative Cloud devices.
 * Handles upload, download, and conflict resolution.
 * 
 * @owner ps-sync-eng
 * @oncall creative-cloud-sre
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
  ErrorCode, 
  ServiceError, 
  UserTier,
  JobStatus,
  SyncJobRequest 
} from '../../shared/types/common';

const logger = createLogger('sync-manager');

/**
 * Sync direction
 */
export type SyncDirection = 'upload' | 'download' | 'bidirectional';

/**
 * Conflict resolution strategy
 */
export type ConflictStrategy = 'local' | 'remote' | 'manual' | 'merge';

/**
 * Sync status for a file
 */
export interface SyncStatus {
  fileId: string;
  status: 'synced' | 'pending' | 'syncing' | 'conflict' | 'error';
  localVersion: number;
  remoteVersion: number;
  lastSyncedAt?: Date;
  error?: ServiceError;
}

/**
 * Sync operation result
 */
export interface SyncResult {
  fileId: string;
  requestId: string;
  status: JobStatus;
  direction: SyncDirection;
  bytesTransferred?: number;
  durationMs?: number;
  error?: ServiceError;
}

/**
 * Sync queue item
 */
interface SyncQueueItem {
  file: FileMetadata;
  userId: string;
  userTier: UserTier;
  direction: SyncDirection;
  conflictStrategy: ConflictStrategy;
  requestId: string;
  queuedAt: Date;
  priority: number;
}

/**
 * Asset Sync Manager
 * 
 * Manages synchronization of Photoshop files across Creative Cloud.
 */
export class SyncManager {
  private syncQueue: SyncQueueItem[] = [];
  private activeSyncs: Map<string, { startTime: number; abortController: AbortController }> = new Map();
  private fileVersions: Map<string, SyncStatus> = new Map();

  /**
   * Queue a file for synchronization
   * 
   * Uses shared config for timeout and size limits.
   */
  async queueSync(
    file: FileMetadata,
    userId: string,
    userTier: UserTier,
    direction: SyncDirection,
    conflictStrategy: ConflictStrategy = 'remote'
  ): Promise<{ queued: boolean; error?: ServiceError }> {
    const requestId = `sync-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info('Sync request received', {
      requestId,
      fileId: file.id,
      fileSizeMB: file.sizeMB,
      direction,
      userId,
      userTier,
    });
    
    // Validate file
    const validation = validateFile(file);
    if (!validation.valid) {
      return { queued: false, error: validation.error };
    }
    
    // Check file size against config
    // NOTE: Config was reduced in PERF-2847, large files may be rejected
    if (!isFileSizeAllowed(file.sizeMB)) {
      logger.warn('File too large for sync', {
        requestId,
        fileId: file.id,
        fileSizeMB: file.sizeMB,
        limit: renderingConfig.maxFileSizeMB,
      });
      
      return {
        queued: false,
        error: {
          code: ErrorCode.FILE_TOO_LARGE,
          message: `File size ${file.sizeMB}MB exceeds sync limit of ${renderingConfig.maxFileSizeMB}MB`,
          details: {
            fileSizeMB: file.sizeMB,
            limit: renderingConfig.maxFileSizeMB,
            suggestion: 'Large files should be synced during off-peak hours',
          },
          timestamp: new Date(),
          requestId,
        },
      };
    }
    
    // Calculate priority (enterprise users get higher priority)
    const priority = this.calculatePriority(userTier, direction);
    
    // Add to queue
    const item: SyncQueueItem = {
      file,
      userId,
      userTier,
      direction,
      conflictStrategy,
      requestId,
      queuedAt: new Date(),
      priority,
    };
    
    this.syncQueue.push(item);
    this.syncQueue.sort((a, b) => b.priority - a.priority);
    
    logger.info('File queued for sync', {
      requestId,
      fileId: file.id,
      queuePosition: this.syncQueue.findIndex(i => i.requestId === requestId) + 1,
      queueDepth: this.syncQueue.length,
    });
    
    // Trigger processing
    this.processNextSync();
    
    return { queued: true };
  }

  /**
   * Calculate sync priority
   */
  private calculatePriority(userTier: UserTier, direction: SyncDirection): number {
    const tierPriority: Record<UserTier, number> = {
      enterprise: 70,
      pro: 50,
      free: 30,
    };
    
    // Downloads get slight priority (user is waiting)
    const directionBonus = direction === 'download' ? 10 : 0;
    
    return tierPriority[userTier] + directionBonus;
  }

  /**
   * Process next sync in queue
   */
  private async processNextSync(): Promise<void> {
    // Check concurrent sync limit (uses same config as render jobs)
    // NOTE: maxConcurrentJobs was reduced in PERF-2847
    if (this.activeSyncs.size >= renderingConfig.maxConcurrentJobs) {
      logger.debug('At max concurrent syncs', {
        activeSyncs: this.activeSyncs.size,
        limit: renderingConfig.maxConcurrentJobs,
      });
      return;
    }
    
    const item = this.syncQueue.shift();
    if (!item) return;
    
    const { file, direction, conflictStrategy, requestId } = item;
    
    // Setup abort controller and tracking
    const abortController = new AbortController();
    this.activeSyncs.set(file.id, {
      startTime: Date.now(),
      abortController,
    });
    
    // Update status
    this.fileVersions.set(file.id, {
      fileId: file.id,
      status: 'syncing',
      localVersion: 1,
      remoteVersion: 1,
    });
    
    logger.info('Starting sync', {
      requestId,
      fileId: file.id,
      direction,
    });
    
    try {
      const result = await this.performSync(item, abortController.signal);
      this.handleSyncComplete(item, result);
    } catch (error: any) {
      this.handleSyncError(item, error);
    }
  }

  /**
   * Perform the actual sync operation
   * 
   * WARNING: Timeout was reduced in PERF-2847 from 120s to 60s for sync
   * Large files on slow connections may timeout
   */
  private async performSync(
    item: SyncQueueItem,
    signal: AbortSignal
  ): Promise<SyncResult> {
    const { file, direction, requestId } = item;
    const startTime = Date.now();
    
    // Get timeout based on file size
    const timeout = getTimeoutForFileSize(file.sizeMB, 'sync');
    
    logger.debug('Sync timeout configured', {
      requestId,
      fileId: file.id,
      fileSizeMB: file.sizeMB,
      timeoutMs: timeout,
    });
    
    return new Promise((resolve, reject) => {
      // Set timeout
      const timeoutId = setTimeout(() => {
        reject({
          code: ErrorCode.SYNC_TIMEOUT,
          message: `Sync timed out after ${timeout}ms`,
          details: {
            fileSizeMB: file.sizeMB,
            timeoutMs: timeout,
            direction,
          },
        });
      }, timeout);
      
      // Simulate sync
      this.simulateSync(file, direction, signal)
        .then(bytesTransferred => {
          clearTimeout(timeoutId);
          resolve({
            fileId: file.id,
            requestId,
            status: 'completed',
            direction,
            bytesTransferred,
            durationMs: Date.now() - startTime,
          });
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Simulate sync transfer
   */
  private async simulateSync(
    file: FileMetadata,
    direction: SyncDirection,
    signal: AbortSignal
  ): Promise<number> {
    // Simulate transfer time based on file size
    // ~100ms per MB for sync operations
    const transferTime = file.sizeMB * 100;
    
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, Math.min(transferTime, 5000));
      
      signal.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new Error('Sync cancelled'));
      });
    });
    
    return file.sizeMB * 1024 * 1024; // Return bytes transferred
  }

  /**
   * Handle successful sync completion
   */
  private handleSyncComplete(item: SyncQueueItem, result: SyncResult): void {
    const { file, requestId } = item;
    
    this.activeSyncs.delete(file.id);
    
    // Update version tracking
    const currentStatus = this.fileVersions.get(file.id);
    this.fileVersions.set(file.id, {
      fileId: file.id,
      status: 'synced',
      localVersion: (currentStatus?.localVersion || 0) + 1,
      remoteVersion: (currentStatus?.remoteVersion || 0) + 1,
      lastSyncedAt: new Date(),
    });
    
    logger.info('Sync completed', {
      requestId,
      fileId: file.id,
      durationMs: result.durationMs,
      bytesTransferred: result.bytesTransferred,
    });
    
    // Process next
    this.processNextSync();
  }

  /**
   * Handle sync error
   */
  private handleSyncError(item: SyncQueueItem, error: any): void {
    const { file, requestId } = item;
    
    this.activeSyncs.delete(file.id);
    
    // Update status
    this.fileVersions.set(file.id, {
      fileId: file.id,
      status: 'error',
      localVersion: this.fileVersions.get(file.id)?.localVersion || 1,
      remoteVersion: this.fileVersions.get(file.id)?.remoteVersion || 1,
      error: {
        code: error.code || ErrorCode.SYNC_FAILED,
        message: error.message || 'Sync failed',
        details: error.details,
        timestamp: new Date(),
        requestId,
      },
    });
    
    logger.error('Sync failed', {
      requestId,
      fileId: file.id,
      error: error.message || error,
    });
    
    // Process next
    this.processNextSync();
  }

  /**
   * Get sync status for a file
   */
  getFileStatus(fileId: string): SyncStatus | null {
    return this.fileVersions.get(fileId) || null;
  }

  /**
   * Cancel a pending or active sync
   */
  cancelSync(fileId: string): boolean {
    // Remove from queue
    const queueIndex = this.syncQueue.findIndex(i => i.file.id === fileId);
    if (queueIndex !== -1) {
      this.syncQueue.splice(queueIndex, 1);
      logger.info('Sync cancelled from queue', { fileId });
      return true;
    }
    
    // Abort active sync
    const activeSync = this.activeSyncs.get(fileId);
    if (activeSync) {
      activeSync.abortController.abort();
      this.activeSyncs.delete(fileId);
      logger.info('Active sync cancelled', { fileId });
      return true;
    }
    
    return false;
  }

  /**
   * Force sync a file (bypass queue)
   */
  async forceSyncNow(
    file: FileMetadata,
    userId: string,
    userTier: UserTier,
    direction: SyncDirection
  ): Promise<SyncResult> {
    const requestId = `force-sync-${Date.now()}`;
    
    logger.info('Force sync initiated', {
      requestId,
      fileId: file.id,
      direction,
    });
    
    // Validate
    if (!isFileSizeAllowed(file.sizeMB)) {
      return {
        fileId: file.id,
        requestId,
        status: 'failed',
        direction,
        error: {
          code: ErrorCode.FILE_TOO_LARGE,
          message: `File size ${file.sizeMB}MB exceeds limit`,
          timestamp: new Date(),
          requestId,
        },
      };
    }
    
    const item: SyncQueueItem = {
      file,
      userId,
      userTier,
      direction,
      conflictStrategy: 'remote',
      requestId,
      queuedAt: new Date(),
      priority: 100, // Max priority
    };
    
    const abortController = new AbortController();
    
    try {
      return await this.performSync(item, abortController.signal);
    } catch (error: any) {
      return {
        fileId: file.id,
        requestId,
        status: 'failed',
        direction,
        error: {
          code: error.code || ErrorCode.SYNC_FAILED,
          message: error.message || 'Force sync failed',
          timestamp: new Date(),
          requestId,
        },
      };
    }
  }

  /**
   * Get sync manager health
   */
  getHealth(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    queueDepth: number;
    activeSyncs: number;
    maxConcurrent: number;
  } {
    const queueDepth = this.syncQueue.length;
    const activeSyncs = this.activeSyncs.size;
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (queueDepth > 50 || activeSyncs >= renderingConfig.maxConcurrentJobs) {
      status = 'degraded';
    }
    
    return {
      status,
      queueDepth,
      activeSyncs,
      maxConcurrent: renderingConfig.maxConcurrentJobs,
    };
  }
}

// Export singleton
export const syncManager = new SyncManager();

export default syncManager;
