#!/bin/bash

# Configuration Validation Script
#
# Run this before committing changes to rendering configuration.
# This script validates that config values meet SLA requirements.
#
# Usage:
#   ./scripts/validate-config.sh
#
# To install as a pre-commit hook:
#   cp scripts/validate-config.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# See incident-inc-20260114 for why this is critical.

set -e

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║       RENDERING CONFIGURATION VALIDATION                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

CONFIG_FILE="shared/config/rendering.config.ts"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "⚠️  Config file not found: $CONFIG_FILE"
    echo "   Running from wrong directory? Try: cd <project-root>"
    exit 1
fi

# Extract config values (head -1 to get only the first match in base config)
RENDER_TIMEOUT=$(grep -oP 'renderTimeoutMs:\s*\K\d+' "$CONFIG_FILE" | head -1 || echo "0")
EXPORT_TIMEOUT=$(grep -oP 'exportTimeoutMs:\s*\K\d+' "$CONFIG_FILE" | head -1 || echo "0")
MAX_CONCURRENT=$(grep -oP 'maxConcurrentJobs:\s*\K\d+' "$CONFIG_FILE" | head -1 || echo "0")

# Extract enterprise config (more complex - need to find it in the tier overrides)
ENTERPRISE_FILE_SIZE=$(grep -A10 "enterprise:" "$CONFIG_FILE" | grep -oP 'maxFileSizeMB:\s*\K\d+' | head -1 || echo "0")
ENTERPRISE_CONCURRENT=$(grep -A10 "enterprise:" "$CONFIG_FILE" | grep -oP 'maxConcurrentJobs:\s*\K\d+' | head -1 || echo "0")

echo "📋 Current Configuration Values:"
echo ""
echo "   Base Config:"
echo "   ├─ renderTimeoutMs:    ${RENDER_TIMEOUT}ms"
echo "   ├─ exportTimeoutMs:    ${EXPORT_TIMEOUT}ms"
echo "   └─ maxConcurrentJobs:  ${MAX_CONCURRENT}"
echo ""
echo "   Enterprise Tier:"
echo "   ├─ maxFileSizeMB:      ${ENTERPRISE_FILE_SIZE}MB"
echo "   └─ maxConcurrentJobs:  ${ENTERPRISE_CONCURRENT}"
echo ""

# Define minimums (must match config-validator.ts)
MIN_RENDER_TIMEOUT=60000
MIN_EXPORT_TIMEOUT=30000
MIN_CONCURRENT=5
MIN_ENTERPRISE_FILE_SIZE=500
MIN_ENTERPRISE_CONCURRENT=8

FAILED=0
WARNINGS=0

echo "🔍 Validating Against SLA Requirements:"
echo ""

# Check render timeout
if [ "$RENDER_TIMEOUT" -lt "$MIN_RENDER_TIMEOUT" ]; then
    echo "   ❌ FAIL: renderTimeoutMs ($RENDER_TIMEOUT) < minimum ($MIN_RENDER_TIMEOUT)"
    FAILED=1
elif [ "$RENDER_TIMEOUT" -lt 120000 ]; then
    echo "   ⚠️  WARN: renderTimeoutMs ($RENDER_TIMEOUT) < recommended (120000)"
    WARNINGS=$((WARNINGS + 1))
else
    echo "   ✅ PASS: renderTimeoutMs"
fi

# Check export timeout
if [ "$EXPORT_TIMEOUT" -lt "$MIN_EXPORT_TIMEOUT" ]; then
    echo "   ❌ FAIL: exportTimeoutMs ($EXPORT_TIMEOUT) < minimum ($MIN_EXPORT_TIMEOUT)"
    FAILED=1
else
    echo "   ✅ PASS: exportTimeoutMs"
fi

# Check concurrent jobs
if [ "$MAX_CONCURRENT" -lt "$MIN_CONCURRENT" ]; then
    echo "   ❌ FAIL: maxConcurrentJobs ($MAX_CONCURRENT) < minimum ($MIN_CONCURRENT)"
    FAILED=1
elif [ "$MAX_CONCURRENT" -lt 8 ]; then
    echo "   ⚠️  WARN: maxConcurrentJobs ($MAX_CONCURRENT) < recommended (8)"
    WARNINGS=$((WARNINGS + 1))
else
    echo "   ✅ PASS: maxConcurrentJobs"
fi

# Check enterprise file size (SLA requirement)
if [ "$ENTERPRISE_FILE_SIZE" -lt "$MIN_ENTERPRISE_FILE_SIZE" ]; then
    echo "   ❌ FAIL: enterprise.maxFileSizeMB ($ENTERPRISE_FILE_SIZE) < SLA minimum ($MIN_ENTERPRISE_FILE_SIZE)"
    echo "          This would breach Enterprise SLA contracts!"
    FAILED=1
else
    echo "   ✅ PASS: enterprise.maxFileSizeMB (SLA)"
fi

# Check enterprise concurrent jobs
if [ "$ENTERPRISE_CONCURRENT" -lt "$MIN_ENTERPRISE_CONCURRENT" ]; then
    echo "   ❌ FAIL: enterprise.maxConcurrentJobs ($ENTERPRISE_CONCURRENT) < minimum ($MIN_ENTERPRISE_CONCURRENT)"
    FAILED=1
else
    echo "   ✅ PASS: enterprise.maxConcurrentJobs"
fi

echo ""

# Summary
if [ "$FAILED" -eq 1 ]; then
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  🚨 VALIDATION FAILED - DO NOT COMMIT THESE CHANGES         ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "This configuration would cause:"
    echo "  - Service degradation or outages"
    echo "  - SLA violations with enterprise customers"
    echo ""
    echo "Please review:"
    echo "  - go/ps-config-changes for the change approval process"
    echo "  - go/ps-enterprise-sla for SLA requirements"
    echo "  - incident-inc-20260114 for previous incident details"
    echo ""
    exit 1
elif [ "$WARNINGS" -gt 0 ]; then
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  ⚠️  VALIDATION PASSED WITH WARNINGS                         ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Configuration meets minimums but is below recommended values."
    echo "Consider increasing values for better reliability."
    echo ""
    exit 0
else
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  ✅ VALIDATION PASSED                                        ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Configuration meets all SLA requirements and recommendations."
    echo ""
    exit 0
fi
