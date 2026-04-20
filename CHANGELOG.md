# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

## v1.2.0 (2026-04-20)

### Changed

- Paste: Removed the `robotjs` runtime dependency from the Electron build; Linux paste now uses the `xdotool` path only.
- Paste: Prefer `Ctrl+Shift+V` before `Ctrl+V` inside IDE windows on Linux so VS Code integrated terminals don't receive a literal `^V`.
- Tooltip: Restored the external preview window design and tuned it for click-through behavior, larger text previews, and image-first sizing.

### Fixed

- History list: Fixed virtualized list viewport measurement so the bottom area no longer shows stale blank space after data updates.
- Tooltip: Reduced interaction blocking from the external tooltip window and improved image/text layout stability during selection changes.


## v1.1.1 (2026-02-26)

### Fixed

- Paste: Improved Linux terminal paste reliability by prioritizing terminal-friendly key sequences (`Shift+Insert`, `Ctrl+Shift+V`) before `Ctrl+V` when terminal windows are detected.
- Paste: Added missing `robotjs` key mapping for `Ctrl+Shift+V` to improve compatibility in terminal-focused workflows.
- Paste: Reduced default paste wait delays for text and image to improve responsiveness.

## v1.0.7 (2026-02-26)

### Fixed

- Paste: Improved Linux terminal paste reliability by preferring terminal-friendly key sequences (`Shift+Insert`, `Ctrl+Shift+V`) before falling back to `Ctrl+V` when a terminal window is detected.
- Paste: Added missing `robotjs` mapping for `Ctrl+Shift+V` to improve compatibility across terminal environments.

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
