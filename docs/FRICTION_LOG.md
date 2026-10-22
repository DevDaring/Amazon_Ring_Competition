# Friction log

Real snags hit while building DoorVoice on 2026-10-21, against the Ring Developer
Playground sandbox (token scope `ava.v1:read`, one "Playground Device", a line-powered
Doorbell Pro with AVC up to 1080p), the Ring Appstore MCP docs server, AWS and the
supporting providers. Request IDs are quoted where Ring returned one.

Format: **task attempted → steps → expected vs actual → severity → workaround → suggestion.**

Summary by severity: **major** — 1 (30-minute sandbox tokens), 2 (hidden consent boundary), 11 (no sandbox webhooks or simulation API), 13 (AWS access errors only at call time). **Minor** — 3–10, 12, 14.

---

### 1. Playground token expires after ~30 minutes, with no refresh path

- **Task:** develop and test against the sandbox across a working session.
- **Steps:** generated a token in the Developer Playground; decoded the JWT (`iat` 1792562476, `exp` 1792564276).
- **Expected vs actual:** expected a token that lasts a work session or a refresh token for the sandbox. Actual: exactly 30 minutes, then every call returns 401. The Playground issues no refresh token, so `grant_type=refresh_token` cannot be tested against it.
- **Severity:** major.
- **Workaround:** probed every endpoint inside the 30-minute window and saved responses and media as local fixtures; added a Settings field to paste a fresh token at runtime (kept server-side in `data/`), with an expiry countdown read from the JWT's `exp`.
- **Suggestion:** issue sandbox refresh tokens (or 8–24 h sandbox tokens), and document the lifetime next to the "Generate token" button.

### 2. Image download returns 403 for time ranges before consent, and the boundary is not discoverable

- **Task:** fetch the latest snapshot for the pipeline.
- **Steps:** `POST /v1/devices/{id}/media/image/download` with `type: latest_in_range`, `start_timestamp` = now − 23 h.
- **Expected vs actual:** expected the latest image in the 24-hour window. Actual: `403 TIME_RANGE_NOT_AUTHORIZED` "Requested time range is not within authorized boundaries" (request `4b8653d6-c7d2-4a38-8e8c-40fe2ea1fd6e`). The window is legal (< 24 h) but starts before the consent date, and no API exposes that date.
- **Severity:** major.
- **Workaround:** anchor requests to the `start` of an event returned by `GET /v1/history/devices/{id}/events`, which is always after consent. `at_timestamp` at event start + 8 s then returned 303 → 200 (153 KB JPEG, `X-Media-Origin: recording`).
- **Suggestion:** clamp `start_timestamp` to the consent boundary instead of rejecting, or return the boundary in the error `meta` and in `/v1/devices` or `/v1/users/me`.

### 3. Image download signals "no media" only after the redirect

- **Task:** get a snapshot at the moment of a (simulated) event.
- **Steps:** `POST …/media/image/download` with `at_timestamp` = now − 5 s.
- **Expected vs actual:** expected a 4xx on the POST if nothing exists. Actual: step 1 returns `303 See Other` (looks like success); step 2, the GET on the presigned URL, returns `416 MEDIA_NOT_FOUND` "No media found in time range 1792562696000-1792562706000" (request `1126cb29-a8eb-4c51-809c-7f21d02ce97e`). That is a second round trip before you learn there is nothing.
- **Severity:** minor (documented, but costly in a 5-second budget).
- **Workaround:** `twoStepDownload()` in `lib/ring/client.ts` reads errors from both steps; on 416/425 within 20 s of the event it retries once with `latest_in_range`; frames from the browser's live view are tried first.
- **Suggestion:** return 416/425 on the POST when the media index already knows there is nothing, and offer an on-demand capture endpoint (see feature requests).

### 4. Video download ignores `frame_rate` and resolution defaults

- **Task:** download a short clip with a low frame rate for cheap frame selection.
- **Steps:** `POST …/media/video/download` with `duration: 6000`, `video_options: {codec: "avc", frame_rate: 5}`.
- **Expected vs actual:** expected 5 fps at the device default (1080p per capabilities). Actual: 303 → 200, 1.2 MB MP4, `ffprobe`: h264 **1280×720 @ 30 fps**, `X-Media-Duration: 6033`.
- **Severity:** minor.
- **Workaround:** ffmpeg resamples to 1 fps on our side (`clipToFrames()`); clips are only used when a snapshot is unavailable.
- **Suggestion:** honour `frame_rate` or reject it with a validation error; document the sandbox's actual output format.

### 5. History `event_types` filter is not applied in the sandbox

- **Task:** count doorbell presses and human/vehicle motion for the caregiver digest.
- **Steps:** `GET /v1/history/devices/{id}/events?event_types=ding,motion.human,motion.vehicle`.
- **Expected vs actual:** expected only `ding` and filtered `motion` events. Actual: the response contained the `on_demand` (live view) event as well, the same as the unfiltered call.
- **Severity:** minor.
- **Workaround:** fetch unfiltered and filter client-side in `lib/server/digest.ts`.
- **Suggestion:** apply the filter in the sandbox, or state in the docs that it is production-only.

### 6. Undocumented fields in configurations and history

- **Task:** detect end-to-end-encrypted cameras and read Ring's own detections.
- **Steps:** `GET /v1/devices?include=status,capabilities,location,configurations`; `GET /v1/history/devices/{id}/events`.
- **Expected vs actual:** the device-configuration docs list `motion_detection` and `image_enhancements` only. Actual responses also contain `e2e_encryption: {enabled: false}` in configurations, and `relationships.cv_detections` (empty) plus `meta.riid` (null) on history events. None are documented.
- **Severity:** minor.
- **Workaround:** DoorVoice reads `e2e_encryption.enabled` to degrade gracefully ("this camera uses end-to-end encryption, so I can't describe it") and ignores the rest.
- **Suggestion:** document these fields (especially `e2e_encryption`, which partners need) and say what `cv_detections` will contain.

### 7. Motion subtype location differs between docs and examples

- **Task:** route events by subtype in Stage 0.
- **Steps:** read `notifications/motion_detection.md` and the build spec.
- **Expected vs actual:** the motion doc's payload puts the subtype at `data.subType` (camelCase, outside `attributes`); other material, including our own build spec, assumed `data.attributes.sub_type`. The sample repo's Zod schema has neither, and its `type` enum does not include `button_press`.
- **Severity:** minor.
- **Workaround:** `parseWebhook()` accepts `data.subType`, `attributes.sub_type` and `attributes.subType`; unknown subtypes are processed, never dropped.
- **Suggestion:** one canonical field, shown in the generic payload in `notifications.md`, and an updated sample schema.

### 8. Media watermark and overlays are undocumented; MCP docs have gaps

- **Task:** mask the watermark before scoring frame sharpness.
- **Steps:** downloaded a sandbox snapshot; searched the Ring MCP server (`ring___search_docs`) for "watermark media", "Developer Playground simulation events", "end-to-end encryption video unavailable partner" and "computer vision guidelines tiered processing".
- **Expected vs actual:** expected documentation of the overlay layout. Actual: the image carries a Ring logo top-left and a "Device-ID / Partner / Generated-At" block top-right, plus the sandbox footage's own burned-in timestamp bar (2023-03-27 … CDT) and black pillar bars. The MCP searches returned **0 results** for all four queries (E2EE only matched consumer support pages).
- **Severity:** minor.
- **Workaround:** measured the regions by eye and hard-coded masks in `lib/pipeline/frames.ts` (`WATERMARK_MASKS`); told the vision model to ignore them.
- **Suggestion:** document the watermark geometry (or return it as response headers), and index the CV guidelines and Playground guide in the MCP knowledge base.

### 9. Inconsistent error envelope from the WHEP endpoint

- **Task:** handle live-view errors uniformly.
- **Steps:** `POST /v1/devices/{id}/media/streaming/whep/sessions` with an invalid SDP body.
- **Expected vs actual:** expected the same envelope as the media endpoints (`id`, `status`, `code`, `detail`, `meta.timestamp`). Actual: `{"errors":[{"code":"MALFORMED_SDP_OFFER","detail":"Malformed SDP offer","status":"400"}]}` with no `id` or `meta`.
- **Severity:** minor.
- **Workaround:** `errorFrom()` falls back to the `x-request-id` header.
- **Suggestion:** use the same error envelope, with a request ID, on every endpoint.

### 10. CORS preflight is rejected (server-to-server only), but not documented

- **Task:** confirm whether any call can come from the browser.
- **Steps:** `OPTIONS /v1/devices` with `Origin: http://localhost:3000`.
- **Expected vs actual:** expected either CORS headers or a documented "server only" statement. Actual: `401 Unauthorized` with no CORS headers.
- **Severity:** minor (by design, but a newcomer loses time).
- **Workaround:** every Ring call goes through Next.js server routes; the browser never holds the token.
- **Suggestion:** state "server-to-server only, no CORS" on the API reference landing page.

### 11. Playground simulations cannot be listed or triggered by API, and the sandbox cannot deliver webhooks

- **Task:** exercise the real webhook path end to end in a demo.
- **Steps:** looked for an API or MCP doc to list or fire Playground simulations, and for a way to register a developer webhook URL for the sandbox.
- **Expected vs actual:** expected sandbox webhooks to a developer URL (e.g. via ngrok) and a way to fire `button_press` / `motion_detected`. Actual: simulations live only in the Playground web UI; no webhook reached our endpoint from the sandbox.
- **Severity:** major (the core trigger of a Ring app cannot be tested against Ring).
- **Workaround:** the Demo panel builds a byte-exact v1.1 payload, signs it with our HMAC key (`sha256=<hex>`) and POSTs it to our own `/api/ring/webhook`, so verification, idempotency (verified with a replay: second call returns `duplicate`), queueing and the pipeline all run. Everything is labelled "Simulated webhook".
- **Suggestion:** sandbox webhook delivery to a developer URL, plus `POST /v1/sandbox/devices/{id}/simulate` for each event type.

### 12. The hello-world sample sends the access token to the browser

- **Task:** build on `AmazonAppDev/ring-api-helloworld` without breaking "browser never holds the Ring token".
- **Steps:** read `app/api/ring/token/route.ts`.
- **Expected vs actual:** expected tokens to stay server-side. Actual: `GET /api/ring/token` returns `{ accessToken }` to any caller of the local app.
- **Severity:** minor for a local demo, major if copied into production.
- **Workaround:** deleted the route; the status endpoint returns only mode and expiry.
- **Suggestion:** remove the route from the sample (it is not used by its own UI's streaming path, which already proxies through `/api/ring/stream`).

### 13. AWS: model and service access failures only surface at call time

- **Task:** use Rekognition for Stage 1, Polly and Transcribe for speech, and a Claude Sonnet-class model on Bedrock for escalation.
- **Steps:** `ListFoundationModels`, then `Converse`, `DetectLabels`, `SynthesizeSpeech`, `ListTranscriptionJobs` with the project's IAM user.
- **Expected vs actual:**
  - `anthropic.claude-sonnet-5-5` is listed, but `Converse` returns `AccessDeniedException … is not available for this account`.
  - `us.anthropic.claude-sonnet-4-5-20250929-v1:0` answered a test call, then failed at runtime with `AccessDeniedException: Model access is denied due to INVALID_PAYMENT_INSTRUMENT … Your AWS Marketplace subscription for this model cannot be completed at this time`.
  - Rekognition, Polly and Transcribe returned `AccessDeniedException … no identity-based policy allows …`.
- **Severity:** major.
- **Workaround:** provider chains (AWS first) with per-model parking: the strong tier falls back inside Bedrock to Nova Lite, and the strong model was switched to `us.amazon.nova-pro-v1:0`; Stage 1 falls back to a Nova Lite counting prompt; speech falls back to Sarvam (en/hi/bn) and Fish Audio (es). Each failure is logged to `data/provider-errors.jsonl` and shown in Settings. One Stage 3 call was served by OpenRouter before per-model parking existed, which raised the project's fallback alert.
- **Resolution:** later the same day the IAM user was granted Rekognition, Polly and Transcribe, and all three now run live (the demo's vehicle event: Rekognition 389 ms, Polly voice; voice commands transcribed by Transcribe in about 1.1 s). The Claude Marketplace denial remained, so Nova Pro stays the strong tier. Parked providers are held in memory for 10 minutes, so the server had to be restarted after the permission change before AWS was tried again.
- **Suggestion:** make `ListFoundationModels` reflect invocability (or add an "access status" field), and surface Marketplace payment problems at subscription time rather than on a later invoke.

### 14. Provider API drift (Sarvam) and model output shape (Nova Lite)

- **Task:** Bengali and Hindi speech; a cheap fallback object counter.
- **Steps:** Sarvam `text-to-speech` with `model: bulbul:v2, speaker: anushka`; Nova Lite asked for `{"person": 0-1, …}` confidence scores.
- **Expected vs actual:** Sarvam returned `400 Model 'bulbul:v2' has been deprecated. Please use 'bulbul:v3'`, and then `Speaker 'anushka' is not compatible with model bulbul:v3`. Nova Lite answered `"vehicle": 4` (a count) instead of a probability, so the first parser read the frame as empty.
- **Severity:** minor.
- **Workaround:** `bulbul:v3` with speaker `priya` (configurable as `SARVAM_SPEAKER`); the Nova detector now asks for integer counts and converts them to scores.
- **Suggestion (Sarvam):** a deprecation window with a warning header before hard failure.
