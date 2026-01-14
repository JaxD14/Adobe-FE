/**
 * Logging Utility
 * 
 * Structured logging for all Photoshop cloud services.
 * Outputs JSON format for log aggregation (Splunk/Datadog).
 * 
 * @owner platform-team
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogContext {
  service: string;
  requestId?: string;
  userId?: string;
  jobId?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  service: string;
  context: Record<string, unknown>;
}

class Logger {
  private serviceName: string;
  private defaultContext: Record<string, unknown>;

  constructor(serviceName: string, defaultContext: Record<string, unknown> = {}) {
    this.serviceName = serviceName;
    this.defaultContext = defaultContext;
  }

  private formatEntry(level: LogLevel, message: string, context: Record<string, unknown> = {}): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.serviceName,
      context: {
        ...this.defaultContext,
        ...context,
      },
    };
  }

  private output(entry: LogEntry): void {
    const json = JSON.stringify(entry);
    
    switch (entry.level) {
      case 'error':
      case 'fatal':
        console.error(json);
        break;
      case 'warn':
        console.warn(json);
        break;
      default:
        console.log(json);
    }
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.output(this.formatEntry('debug', message, context));
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.output(this.formatEntry('info', message, context));
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.output(this.formatEntry('warn', message, context));
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.output(this.formatEntry('error', message, context));
  }

  fatal(message: string, context?: Record<string, unknown>): void {
    this.output(this.formatEntry('fatal', message, context));
  }

  /**
   * Create a child logger with additional context
   */
  child(additionalContext: Record<string, unknown>): Logger {
    return new Logger(this.serviceName, {
      ...this.defaultContext,
      ...additionalContext,
    });
  }

  /**
   * Log timing information for operations
   */
  timing(operation: string, durationMs: number, context?: Record<string, unknown>): void {
    this.info(`Operation completed: ${operation}`, {
      ...context,
      operation,
      durationMs,
      durationSec: (durationMs / 1000).toFixed(2),
    });
  }

  /**
   * Log job lifecycle events
   */
  jobEvent(
    event: 'started' | 'completed' | 'failed' | 'timeout',
    jobId: string,
    context?: Record<string, unknown>
  ): void {
    const level = event === 'failed' || event === 'timeout' ? 'error' : 'info';
    this[level](`Job ${event}`, {
      ...context,
      jobId,
      jobEvent: event,
    });
  }
}

/**
 * Create a logger instance for a service
 */
export function createLogger(serviceName: string, context?: Record<string, unknown>): Logger {
  return new Logger(serviceName, context);
}

/**
 * Pre-configured loggers for each service
 */
export const renderingLogger = createLogger('rendering-service');
export const exportLogger = createLogger('export-service');
export const assetSyncLogger = createLogger('asset-sync-service');

export default Logger;
