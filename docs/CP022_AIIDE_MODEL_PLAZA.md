# CP022: AIIDE Model Plaza profiles (local verification)

Checked 2026-11-09. The six model-specific pages below contain actual cURL examples for `POST https://api.aiide.com/v1/video/generations`, with `model`, `prompt`, and `metadata.content`, `generate_audio`, `ratio`, `duration`, `resolution`, `watermark`. They provide stronger evidence than the generic pricing endpoint, which labels these models as chat-compatible.

- https://www.aiide.com/en/pricing/dreamina-seedance-2-0-fast-hc
- https://www.aiide.com/en/pricing/dreamina-seedance-2-0-hc
- https://www.aiide.com/en/pricing/dreamina-seedance-2-0-mini-hc
- https://www.aiide.com/en/pricing/dreamina-seedance-2-5-hc
- https://www.aiide.com/en/pricing/doubao-seedance-2-0-mini-260615
- https://www.aiide.com/en/pricing/doubao-seedance-2-5-260628

Each page provides the same reference-image example with its exact model ID, 5 seconds, 480p, 16:9 and audio enabled. Compiler fixtures compare the entire normalized body. First/last fields follow https://aiide.apifox.cn/english/9241613m0 and task status shape follows https://aiide.apifox.cn/english/464722027e0. Polling uses the creation host for the new profiles; this same-host routing is an implementation choice tested with mocks, not a verified live task.

Limits are intentionally conservative: non-Mini new models expose 5 seconds/480p, matching published examples. Mini descriptions explicitly permit 4–15 seconds and 480p/720p. All new profiles expose text, image/first-last and reference modes. Edit/Extend remain unavailable because their model-specific payload is not shown. Reference count ceilings stay at the existing local 9 images/3 videos/3 audio, even when upstream descriptions advertise more.

After storing a Video/AIIDE key, authenticated catalog GET enables only matching documented profiles. Initial video selection automatically chooses an available profile if the default is unavailable. The key is checked again before any explicitly confirmed paid request. Catalog success is not proof of funds, generation entitlement or output quality. No real generation was performed for this change.

Included in CP022 / v0.8.0. Both branded distributions share this provider integration. No credentials or private runtime files are distributed.
