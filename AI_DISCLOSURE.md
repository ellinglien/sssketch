---
disclosure-default: ai-assisted
models-used:
  - claude-opus-4-8
  - claude-sonnet-5
providers:
  - Anthropic
scope: |
  Application code is AI-assisted with manual review.
  Tests are typically ai-generated.
last-updated: 2026-08-17
---

# AI Disclosure

This repository follows the [ai-disclosure convention](https://github.com/ggfevans/ai-disclosure).

See per-file `SPDX-AI-Disclosure:` headers for overrides on individual files.

A more personal note: I'm a beginner programmer, and sssketch doesn't exist without Claude's
help. I designed, tested, and reviewed everything that shipped — but the code itself, line by
line, was written by AI, with me directing, deciding, and going back to fix things that didn't
sit right. I think that's worth saying plainly rather than leaving it to be assumed one way or
the other.
