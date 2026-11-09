# Security and bug audit CP-013

Severity HIGH (corrected): The CP-012 local-live module was constructing a paid-submit permit incompatible with the Seedance adapter's verified-capability and budget guard. Baseline tests failed and could silently return `submission_unknown` without any provider POST. This mismatch is corrected, and the capability confirmation is required before paid dispatch.

Severity MEDIUM (corrected): Authorization header style differed between test assumptions and adapter. The adapter now uses Bearer token format. Actual provider contract remains to be validated in authorized provider tests.

Severity MEDIUM (corrected): The unified UI did not expose any clearly gated route for checking local live status or submitting a manually approved text-only pilot. A separately gated flow and endpoint tests are now present.

Severity HIGH (unresolved): Actual provider balance/pricing/capabilities have not been checked with a real account. A local daily submission limit is NOT a spend cap.
Severity HIGH (unresolved): The dashboard is single-operator development code, not production multi-user access control. Never expose beyond loopback.
Severity HIGH (unresolved): Production persistence requires integration tests against PostgreSQL and concurrency/reconciliation stress tests.
Severity MEDIUM (unresolved): Server-side encrypted vault is local-only and not backed by KMS or organization-scoped secret rotation.
Severity HIGH (operational): The specified shared Drive folder was observed with an anyone-with-link writer permission. Owner should restrict sharing before putting internal-only, confidential, or credential-bearing documentation into it. NO secrets are included in the CP-013 documents.

Verification: `npm test` 111 pass / 0 fail / 2 skipped. All tests are local or mock-based except those pending DB tests. No real API key or paid model request used.
