# Changelog

All notable changes to this project will be documented in this file.

## v1.1.0 (2026-02-14)

### Added

- OCR: Dedicated OCR window for image items.
- OCR: A single grouped **OCR Menu** for languages, text layout, and model/preprocess settings.
- OCR: Confidence display and improved text extraction UX (per-block copy, select-to-OCR, zoom helpers).
- OCR: Keyboard shortcuts for copy/retry/zoom/fit/cancel.

### Fixed

- OCR: Resolved renderer white-screen crashes caused by initialization order (TDZ) issues.

## v1.0.4

- Fix: Autostart on system boot launches the packaged application (Linux prefers `/usr/bin/clipboard-god`).
- Fix: “Launch on startup” setting is persisted and reflected in Settings UI.
