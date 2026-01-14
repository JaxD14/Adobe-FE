/**
 * Configuration Validator
 * 
 * Validates rendering configuration against SLA requirements and operational
 * minimums. This prevents configuration regressions that could cause outages.
 * 
 * IMPORTANT: These thresholds are based on:
 * - Enterprise SLA commitments (see go/ps-enterprise-sla)
 * - Production traffic analysis and benchmarks
 * - Historical incident data
 * 
 * DO NOT lower these values without approval from:
 * - Platform Team Lead
 * - Enterprise Account Management
 * - SRE Team Lead
 * 
 * @owner platform-team
 * @oncall ps-rendering-eng
 */

import { RenderingConfig } from './rendering.config';

/**
 * Minimum acceptable values for configuration
 * These are based on SLA requirements and operational needs
 */
export const CONFIG_MINIMUMS = {
  // Timeout minimums (milliseconds)
  // Based on benchmark: 150ms/MB + 50ms/layer for rendering
  // A 200MB file with 100 layers needs ~35s, with 2x safety buffer = 70s minimum
  renderTimeoutMs: {
    min: 60000,  // 60 seconds absolute minimum
    recommended: 120000,  // 2 minutes recommended
    reason: 'Files >50MB with complex layers require extended processing time',
  },
  
  exportTimeoutMs: {
    min: 30000,
    recommended: 45000,
    reason: 'Large file exports with format conversion need adequate time',
  },
  
  syncTimeoutMs: {
    min: 30000,
    recommended: 60000,
    reason: 'Network latency and large file transfers require buffer',
  },
  
  // Concurrency minimums
  // Based on traffic analysis: need 8+ concurrent jobs for <30s queue wait at peak
  maxConcurrentJobs: {
    min: 5,
    recommended: 8,
    reason: 'Required to maintain <30s average queue wait during peak hours',
  },
  
  // Enterprise tier requirements (SLA commitments)
  enterpriseMaxFileSizeMB: {
    min: 500,
    recommended: 500,
    reason: 'Enterprise SLA guarantees support for files up to 500MB',
  },
  
  enterpriseMaxConcurrentJobs: {
    min: 8,
    recommended: 10,
    reason: 'Enterprise tier requires priority processing capacity',
  },
} as const;

/**
 * Validation result for a single check
 */
export interface ValidationResult {
  field: string;
  valid: boolean;
  severity: 'error' | 'warning';
  currentValue: number;
  minimumValue: number;
  recommendedValue: number;
  message: string;
}

/**
 * Overall validation report
 */
export interface ValidationReport {
  valid: boolean;
  errors: ValidationResult[];
  warnings: ValidationResult[];
  timestamp: Date;
}

/**
 * Validate the rendering configuration against SLA requirements
 * 
 * @param config - The configuration to validate
 * @param tierConfigs - Optional tier-specific configs to validate
 * @returns Validation report with any errors or warnings
 */
export function validateConfig(
  config: RenderingConfig,
  tierConfigs?: {
    enterprise?: Partial<RenderingConfig>;
    pro?: Partial<RenderingConfig>;
    free?: Partial<RenderingConfig>;
  }
): ValidationReport {
  const results: ValidationResult[] = [];
  
  // Validate render timeout
  results.push(validateField(
    'renderTimeoutMs',
    config.renderTimeoutMs,
    CONFIG_MINIMUMS.renderTimeoutMs
  ));
  
  // Validate export timeout
  results.push(validateField(
    'exportTimeoutMs',
    config.exportTimeoutMs,
    CONFIG_MINIMUMS.exportTimeoutMs
  ));
  
  // Validate sync timeout
  results.push(validateField(
    'syncTimeoutMs',
    config.syncTimeoutMs,
    CONFIG_MINIMUMS.syncTimeoutMs
  ));
  
  // Validate concurrent jobs
  results.push(validateField(
    'maxConcurrentJobs',
    config.maxConcurrentJobs,
    CONFIG_MINIMUMS.maxConcurrentJobs
  ));
  
  // Validate enterprise tier if provided
  if (tierConfigs?.enterprise) {
    if (tierConfigs.enterprise.maxFileSizeMB !== undefined) {
      results.push(validateField(
        'enterprise.maxFileSizeMB',
        tierConfigs.enterprise.maxFileSizeMB,
        CONFIG_MINIMUMS.enterpriseMaxFileSizeMB
      ));
    }
    
    if (tierConfigs.enterprise.maxConcurrentJobs !== undefined) {
      results.push(validateField(
        'enterprise.maxConcurrentJobs',
        tierConfigs.enterprise.maxConcurrentJobs,
        CONFIG_MINIMUMS.enterpriseMaxConcurrentJobs
      ));
    }
  }
  
  const errors = results.filter(r => !r.valid && r.severity === 'error');
  const warnings = results.filter(r => !r.valid && r.severity === 'warning');
  
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    timestamp: new Date(),
  };
}

/**
 * Validate a single configuration field
 */
function validateField(
  field: string,
  value: number,
  constraint: { min: number; recommended: number; reason: string }
): ValidationResult {
  const belowMinimum = value < constraint.min;
  const belowRecommended = value < constraint.recommended;
  
  return {
    field,
    valid: !belowMinimum,
    severity: belowMinimum ? 'error' : (belowRecommended ? 'warning' : 'error'),
    currentValue: value,
    minimumValue: constraint.min,
    recommendedValue: constraint.recommended,
    message: belowMinimum
      ? `${field} (${value}) is below minimum (${constraint.min}). ${constraint.reason}`
      : belowRecommended
        ? `${field} (${value}) is below recommended (${constraint.recommended}). ${constraint.reason}`
        : `${field} is valid`,
  };
}

/**
 * Assert that configuration is valid, throwing if not
 * 
 * Use this at service startup to fail fast on invalid config
 */
export function assertConfigValid(
  config: RenderingConfig,
  tierConfigs?: {
    enterprise?: Partial<RenderingConfig>;
    pro?: Partial<RenderingConfig>;
    free?: Partial<RenderingConfig>;
  }
): void {
  const report = validateConfig(config, tierConfigs);
  
  if (!report.valid) {
    const errorMessages = report.errors
      .map(e => `  - ${e.field}: ${e.currentValue} < ${e.minimumValue} (${e.message})`)
      .join('\n');
    
    throw new Error(
      `Configuration validation failed!\n\n` +
      `The following configuration values are below SLA minimums:\n${errorMessages}\n\n` +
      `This would cause service degradation or SLA violations.\n` +
      `Please review the changes and ensure they meet minimum requirements.\n\n` +
      `See: go/ps-config-changes for the change process\n` +
      `See: go/ps-enterprise-sla for SLA requirements`
    );
  }
  
  // Log warnings but don't fail
  if (report.warnings.length > 0) {
    console.warn(
      '[CONFIG WARNING] The following values are below recommended levels:\n' +
      report.warnings.map(w => `  - ${w.field}: ${w.currentValue} (recommended: ${w.recommendedValue})`).join('\n')
    );
  }
}

/**
 * Validate configuration and return a human-readable report
 * Useful for CI/CD checks
 */
export function generateValidationReport(
  config: RenderingConfig,
  tierConfigs?: {
    enterprise?: Partial<RenderingConfig>;
    pro?: Partial<RenderingConfig>;
    free?: Partial<RenderingConfig>;
  }
): string {
  const report = validateConfig(config, tierConfigs);
  
  const lines: string[] = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║         RENDERING CONFIGURATION VALIDATION REPORT           ║',
    '╠══════════════════════════════════════════════════════════════╣',
    '',
  ];
  
  if (report.valid && report.warnings.length === 0) {
    lines.push('✅ All configuration values meet SLA requirements');
    lines.push('');
  }
  
  if (report.errors.length > 0) {
    lines.push('❌ ERRORS (must fix before deployment):');
    lines.push('');
    report.errors.forEach(e => {
      lines.push(`   ${e.field}`);
      lines.push(`   Current: ${e.currentValue} | Minimum: ${e.minimumValue}`);
      lines.push(`   Reason: ${e.message}`);
      lines.push('');
    });
  }
  
  if (report.warnings.length > 0) {
    lines.push('⚠️  WARNINGS (recommended to fix):');
    lines.push('');
    report.warnings.forEach(w => {
      lines.push(`   ${w.field}`);
      lines.push(`   Current: ${w.currentValue} | Recommended: ${w.recommendedValue}`);
      lines.push(`   Reason: ${w.message}`);
      lines.push('');
    });
  }
  
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  
  return lines.join('\n');
}
