# Provider and API key setup

Provider for the opt-in text-only pilot: Volcengine LAS; credentials are configured in the Dramasaku dashboard under `volcengine_las`.
There is a distinct Creative AI key pool for text+image and a distinct Video AI pool. Group and provider must match. The simulator's per-key dailyLimit is a LOCAL request policy; do not interpret it as provider credit balance. Do not rotate keys to circumvent provider/account rate caps or terms.

Before LIVE API testing validate: active account and geographic endpoint, model availability and exact model IDs, Authorization scheme, JSON request/response fields, min/max durations and ratios, image/video attachment staging, quota visibility, unit billing rate, async job status values, media signed URL domains, maximum result size, policies for human/real-person content, and failure/retry/reconciliation semantics.

Paid generation remains off unless operator has explicitly set two opt-in flags and accepted the browser confirmation. A real provider verification step may incur fees. This document does not authorize any paid transaction.
