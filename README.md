# Adobe Photoshop Cloud Rendering Service

## Overview

This repository contains the cloud-based rendering infrastructure for Adobe Photoshop. It handles:

- **Real-time PSD rendering** for cloud-based editing workflows
- **Asset export** to various formats (PNG, JPEG, SVG, PDF)
- **Cross-device asset synchronization** for Creative Cloud subscribers

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                              │
│  (Photoshop Desktop, Photoshop Web, Creative Cloud Mobile)      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      API Gateway                                 │
└─────────────────────────────────────────────────────────────────┘
          │                   │                    │
          ▼                   ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│   Rendering     │  │     Export      │  │   Asset Sync    │
│    Service      │  │    Service      │  │    Service      │
│                 │  │                 │  │                 │
│ - PSD parsing   │  │ - Format conv.  │  │ - Cloud sync    │
│ - Layer comp.   │  │ - Optimization  │  │ - Versioning    │
│ - GPU render    │  │ - Batch export  │  │ - Conflict res. │
└─────────────────┘  └─────────────────┘  └─────────────────┘
          │                   │                    │
          └───────────────────┼────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Shared Infrastructure                         │
│  (Configuration, File Utils, Logging, Job Queue)                │
└─────────────────────────────────────────────────────────────────┘
```

## Services

### Rendering Service (`services/rendering/`)
Core service responsible for compositing PSD layers and generating preview renders.

- Handles files up to 500MB (enterprise tier)
- Supports GPU-accelerated rendering
- Async job queue for batch processing

### Export Service (`services/export/`)
Converts rendered output to various export formats.

- PNG, JPEG, WebP, SVG, PDF support
- Quality optimization for web delivery
- Batch export capabilities

### Asset Sync Service (`services/asset-sync/`)
Manages cross-device synchronization for Creative Cloud.

- Real-time sync for active documents
- Version history management
- Conflict resolution

## Configuration

All services share configuration from `shared/config/rendering.config.ts`.

**Important:** Configuration changes affect multiple services. Always coordinate with:
- Platform Team (for infrastructure limits)
- SRE Team (for monitoring thresholds)
- QA Team (for regression testing)

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Start development server
npm run dev
```

## On-Call Runbook

If you're responding to an incident:

1. Check `/services/rendering/` logs for timeout errors
2. Verify configuration values haven't changed unexpectedly
3. Check job queue depth and processing times
4. Escalate to #photoshop-platform if GPU rendering issues suspected

## Team Contacts

- **Rendering Team:** #ps-rendering-eng
- **Platform Team:** #ps-platform
- **SRE:** #creative-cloud-sre
