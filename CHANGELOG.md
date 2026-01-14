# Changelog

All notable changes to the Photoshop Cloud Rendering Service will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.2] - 2024-01-14

### Fixed
- **ADO-5**: Resolved rendering timeout and stuck job issues caused by PERF-2847
  - Restored `renderTimeoutMs` from 30s to 120s to support large file rendering
  - Restored `maxConcurrentJobs` from 3 to 8 to prevent queue buildup
  - Fixed enterprise tier `maxFileSizeMB` to correctly return 500MB (was inheriting 100MB from base config)
  - Updated job queue to use dynamic timeout scaling based on file size

### Changed
- Updated `exportTimeoutMs` from 45s to 90s for consistency with render timeout changes
- Enterprise tier now gets 10 concurrent job slots (up from 3)

---

## [2.4.1] - 2024-01-09

### Changed
- **PERF-2847**: Optimized resource allocation for improved cluster utilization
  - Reduced memory footprint per job for better density
  - Adjusted timeout configurations for faster worker recycling
  - Updated concurrency limits to prevent memory pressure during peak load
- Updated logging format for better observability in Datadog

### Fixed
- Fixed race condition in job queue priority sorting
- Resolved memory leak in GPU worker cleanup routine

### Security
- Updated dependencies to address CVE-2024-0001 in image parsing library

---

## [2.4.0] - 2024-01-02

### Added
- Progressive loading support for large PSD files
- New `enableProgressiveLoading` feature flag in rendering config
- Support for WebP export format with alpha channel

### Changed
- Improved layer compositing performance by 15%
- Updated GPU rendering pipeline for better utilization

### Fixed
- Fixed color profile handling for CMYK files
- Resolved export quality degradation on high-DPI outputs

---

## [2.3.2] - 2023-12-20

### Fixed
- Hotfix for batch export failing on files with special characters in names
- Fixed sync conflict resolution when both versions modified simultaneously

---

## [2.3.1] - 2023-12-15

### Changed
- Increased GPU memory limit to 2GB for 8K resolution support
- Improved error messages for timeout failures

### Fixed
- Fixed intermittent failures in PDF export
- Resolved thumbnail generation for PSB files

---

## [2.3.0] - 2023-12-01

### Added
- Support for PSB (Large Document Format) files up to 500MB
- New batch optimization feature for multi-format exports
- Added detailed progress reporting for long-running jobs

### Changed
- Migrated to new GPU cluster with improved availability
- Updated file validation to support additional RAW formats

### Deprecated
- Legacy sync API endpoints (will be removed in v3.0.0)

---

## [2.2.1] - 2023-11-15

### Fixed
- Fixed memory exhaustion when processing files with 500+ layers
- Resolved timeout calculation for files near size limits

### Security
- Patched XSS vulnerability in filename handling

---

## [2.2.0] - 2023-11-01

### Added
- Real-time sync status updates via WebSocket
- Support for selective layer export
- New "ultra" quality preset for print workflows

### Changed
- Improved job queue fairness for free tier users
- Updated retry logic with exponential backoff

### Fixed
- Fixed export failures for files with embedded ICC profiles
- Resolved sync conflicts when editing across time zones

---

## [2.1.0] - 2023-10-15

### Added
- Enterprise tier support with dedicated processing pools
- Custom timeout configuration per user tier
- Support for 16-bit and 32-bit depth files

### Changed
- Increased default file size limit to 500MB for Pro users
- Optimized layer flattening algorithm

### Fixed
- Fixed GPU memory leak during consecutive renders
- Resolved race condition in sync queue processing

---

## [2.0.0] - 2023-10-01

### Added
- Complete rewrite of rendering pipeline
- GPU-accelerated compositing
- Multi-region deployment support
- Comprehensive metrics and monitoring

### Changed
- New configuration system with shared config across services
- Updated API to v2 with breaking changes
- Migrated to new job queue architecture

### Removed
- Removed deprecated v1 API endpoints
- Removed support for legacy PSD format (pre-CS6)

### Migration Guide
See [MIGRATION.md](./docs/MIGRATION.md) for upgrading from v1.x.

---

## [1.9.x and earlier]

See [LEGACY_CHANGELOG.md](./docs/LEGACY_CHANGELOG.md) for historical changes.
