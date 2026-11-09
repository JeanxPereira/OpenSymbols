# OpenSymbols demo

Private demo app (never published). It reads a generated package at runtime.

    OPENSYMBOLS_PACKAGE=/path/to/generated-package pnpm --filter demo dev

The dev server serves that directory under `/pkg/*` (`/pkg/index.json`, `/pkg/chunks/0.json`, ...).
