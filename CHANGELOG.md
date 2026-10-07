# Changelog

All notable user-facing changes to DSH Vision Toolkit are documented in this file. The project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic version tags.

## [Unreleased]

## [0.5.0] - 2026-10-07

### Added

- Per-session persistent media controls (whole session and image/video/audio/document toggles), proxy/direct routing, and an opt-in current-model native image-generation switch.
- Allowlisted native relay dispatch using the selected conversation model, with Responses `image_generation`, durable generated image attachments/artifacts, tool-result image transport, bounded SSE/JSON decoding, and explicit protocol limitations.
- Outbound session-history consent enforcement without changing durable transcripts; session-scoped paste confirmations and cached pasted-media evidence.

### Fixed

- Native relay failures preserve safe categories (context overflow, quota, authentication, rate limits, relay timeout/server errors, rejected request parameters) and HTTP status rather than collapsing to `Relay request failed`. Error bodies are capped at 16 KiB; raw upstream messages/codes are not reflected. Context overflow retains the Host's compaction code; Host caller timeouts are distinct from cancellation and the plugin's idle deadline. Transient native codes do not opt potentially billed generation into normal automatic retries.
- Native conversation/generation streams no longer inherit the visual tool's 30-second whole-request deadline: bounded idle waits reset on streamed bytes/keepalives (at least 120 seconds for native chat, 300 seconds with image generation), with timers cleaned on completion, cancellation, and iterator disposal. Replacement native wires now emit Host terminal error/aborted chunks; empty completions are explicit errors rather than silent stops. SSE event-header-only Responses relays are supported. No automatic fallback/resubmission is introduced for potentially paid generation.
- Session media controls now use a compact collapsed row, short bounded select labels, responsive modality columns, and on-demand protocol/help details. The row carries composer-aligned width/margins directly so a late/missing plugin stylesheet cannot strand it at the viewport edge. Switching sessions closes the panel; save/consent behavior is unchanged.
- Review R01–R06: administrative Web routes now require Host authentication and fail closed (`503`) if its API is unavailable; automatic paste projection requires session/file-bound server signatures; delayed consent persistence preserves live opt-outs. Credentialed catalog, health and Python requests reject redirects. Catalog errors redact credentials before truncation and response bodies are capped while streaming.
- Review R07–R12: compression cache eviction retains newest entries and pins in-flight files across runtime generations; output aliases cannot overwrite inputs on Windows or through hard links. The Python adapter emits standard PDF filename/file-data and MP3 format fields without changing the pinned vendor. Proxy image admission uses its preprocessing ceiling rather than the direct wire ceiling; projected/variant evidence is not converted twice. Restored native Skill exposure recognizes the Host 0.2 raw tool-result shape as well as legacy history.
- Review R13–R17/R24: Settings watching starts before startup awaits and reconciles buffered changes; rejected projected configurations no longer block unrelated valid repairs. Late storage-domain binding merges retained roots and reconciles the active runtime. Windows updater shims handle spaced/metacharacter paths, successful manual installs require restart before a second attempt, and read-only GitHub checks retain the GitHub source.
- Review R18–R23/R25: stale Settings GETs cannot overwrite Save; paste-policy refreshes keep known media opt-outs; attach confirmation is session-bound. Cleared/settled paste batches release File graphs and listeners while preserving detached retries in a bounded string-only cache. Cancelled weighted queue heads wake eligible followers. Same-scope model drafts retain provider metadata without forwarding it to a changed destination. Invalid Unicode output names are rejected and artifact setup failures close open handles.
- Compatibility: unsigned historical paste markers are text-only for automatic routing; re-paste or use explicit visual tools. Older Hosts without the authentication API lose administrative Web routes rather than silently accepting anonymous requests. Cache coordination is process-local; transport retry fallback retains at most 256 copied references without Files/progress docks. No installed profile migration or live deployment is performed by this source change.
- Native streams now stop at Responses terminal events or Chat `[DONE]` instead of waiting for transport EOF, decode all SSE line endings across network boundaries, and reject nonterminal/cancelled Responses, filtered output, and Chat error envelopes. Final text and refusal content are reconciled per content part without loss or duplication. Failed or aborted generated-image writes remove only files owned by the operation and preserve the original error; host attachments are committed only after artifact validation.
- Malformed tool-result history is rejected before media reads or relay dispatch, preventing missing, non-string, or blank call IDs from leaking `role:'tool'` into Responses.
- **The direct wire serializes DSH 0.2 tool results.** DSH 0.2 hosts deliver tool results as `role:'tool'` messages carrying the raw result blocks; 0.1.5 wrapped the same blocks in a `tool-result` block. The direct wire only understood the 0.1.5 shape, so on a 0.2.0-rc host every conversation with tool history echoed `{"role":"tool"}` into the Responses `input` list — Responses-native upstreams reject that item (`Invalid value: 'tool'`, `param: input[N]`), and the turn failed with `Relay Responses request failed` after the relay's sanitized retry ladder. `nativeMessages` now serializes the 0.2 message shape into `function_call_output` items (Chat protocol: `role:'tool'` with `tool_call_id`) through the same emitter the 0.1.5 block shape uses, with tool-returned images still shipped as the labeled untrusted-evidence user message.
- **The entry `inject` declares `llm` and `attachments`.** The session-media routing wire reads `ctx.llm` (model info, redispatch, `fileRequestText`) and `ctx.attachments` (image reads, generated-image saves, file streams) directly on the plugin context, but the entry never declared either service — cordis refuses undeclared reads, so every turn in a Session with media controls enabled failed with `This turn failed: cannot get property "llm"/"attachments" without inject`. Both services ship in the DSH base bundle, so the declaration is a pure ordering/waiting contract, not a new host requirement. A package-layout test now scans the plugin sources for direct `ctx.<service>` reads and fails when one is missing from the entry `inject` (or from the built artifact); the media-routing tests route their fake context through the real declaration and reproduce the literal runtime error on regression.

## [0.4.1] - fork

### Fixed

- **The origin fence now mirrors the host `/api` boundary completely.** Two holes the 0.2.1 fence left are closed: a DNS-rebound page (its domain resolving to this machine) made `Origin == Host` and passed every POST with a foreign Host — the Host is now required to be this machine's (loopback or one of its own interface addresses) before any Origin comparison, exactly like the host's trusted-authority step; and Origin-less requests with a non-loopback Host were trusted on a client-forgeable `Sec-Fetch-Site` value — the fetch-metadata header is no longer trust evidence. The Settings snapshot GET is fenced too (it was the only unfenced route; a rebound reader could read stored config and storage paths). Real clients are unaffected: the Desktop forwarder (loopback Host, no Origin), loopback browsers, and browsers reaching a `0.0.0.0` deployment through one of the machine's own addresses all still pass.
- **Transparent routing hides duplicate model entries on DSH 0.2.0-rc hosts.** The model-variants hider keyed groups on `aria-labelledby` ids carrying the provider id — a 0.1.5 DOM shape. 0.2.0-rc selectors render a bare React `useId()` heading and put no provider id in the DOM at all, so the hider silently hid nothing and the selector showed the upstream text-only entry beside its same-named variant twin. Groups without provider identity now fall back to a structural rule: a same-heading pair with overlapping model names is the transparent-mode twin pair, and the earlier group's twinned entries hide (the variant always registers after the upstream it wraps). The 0.1.5 id path is unchanged.
- **Registry installs update with `--save-exact`.** The forward install omitted it, so registry updates saved `^x.y.z` instead of the exact pin (and a checked-in test asserted it — invisible only because that test skips on Windows). Git installs stay commit-pinned and deliberately do not carry the flag.
- **`.markdown` artifacts deliver.** `vision_long_screenshot_ocr` accepts the `.markdown` output extension, but the artifact route's MIME table had no entry for it, so every preview/download URL for such an artifact 404'd although the tool reported success.
- **Paste-verdict cache key includes the reasoning effort.** Within the 15 s TTL, a query with a changed effort was answered with the cached `autoSwitch` verdict carrying the stale effort.
- **The label-verdict veto has the same 3-character floor as confirmation.** A short image-capable model id matching label prose as a substring vetoed genuinely text-only selections — reproducing exactly the `MODEL_DOES_NOT_SUPPORT_IMAGES` paste failure the variant skip was built to prevent.
- **`modelCapabilities` over-limit failures report the real cause.** With more than 128 valid entries, the dropped-entries check fired first and misreported valid entries as invalid; the count limit is now checked first, and case-collapsing keys (`{DUP, dup}`) fail loud instead of silently last-winning.
- **Compressed-image staging no longer leaks `.partial` files** when the post-compression read/commit fails (abort or Windows EBUSY): the staged file is removed immediately instead of waiting for the hour-scale sweeper.
- **Aborted artifact downloads release their file handle.** A client disconnect mid-transfer left the paused read stream's fd open until process exit; the stream is now destroyed when the response closes.
- SemVer prerelease identifiers compare by ASCII code points, not `localeCompare`'s case-insensitive ordering.
- A successful manual-restart-path update releases its lock before the best-effort backup cleanup, so a cleanup failure (Windows AV lock) can no longer route a verified install into the rollback path.
- The relay model catalog body cap counts bytes, not UTF-16 code units.
- `vision_glance`-family tool cards no longer show the “Structured result unavailable” failure copy while the tool is still running; the copy is reserved for settled results.
- Settings fetches carry deadlines (snapshot 30 s, catalog 45 s, update check 60 s, restart probes 10 s), so a dead server cannot pin the busy UI forever; long-by-design actions (health, save, apply-update) stay server-bounded.
- The Settings panel no longer flashes “Runtime unavailable” for one frame after a successful load, background refreshes no longer discard unsaved Settings edits (a re-seed happens only on a settings revision change or an explicit Reload), and the loaded relay model catalog survives reloads and background refreshes.
- The browser no longer subscribes to ctx events that exist on no supported host generation; the paste reference codec answers with the chip's exact paste-time label.

### Changed

- DSH compatibility metadata: `dsh.compatibility.dsh` now mirrors the exact peer-dependency range (the previous range did not admit several prerelease lines the `dshReleases` table declares compatible).

## [0.4.0] - fork

### Fixed

- **Pasted media works in the real DSH composer.** The clipboard capture only accepted `HTMLTextAreaElement` paste targets, but DSH's composer is a Lexical contenteditable — so the interception never fired on any real host release and every pasted image died on the native flow's «The current model does not support images» toast. The capture now accepts any element inside the composer card and drives the insertion through the composer shell's own verbs: the same-paste text replaces the live caret span and each file lands as a reference chip, in the shell's detect-coordinate spans (a chip is one character) guarded by the draft-revision CAS, with the host's separating-space rule honored between consecutive chips. Focus returns through the shell so Lexical restores its caret instead of resetting it to the start. Mid-batch failures roll the already-inserted chips back chip by chip instead of rewriting the whole draft, so pre-existing reference chips survive untouched.
- **Session resolution on DSH 0.2.0-rc hosts.** 0.2.0-rc.2 moved view selection out of the Session controller (`sessions.list.current` no longer exists), so the paste had no session to act on. The focused Session now also comes from the dock slot's injected session id — the conversation the composer on screen belongs to — with the legacy `current` field kept as the first choice where it still exists.
- **Chip-removal coordinates.** Removing a pasted-file chip from the dock addressed the occurrence's clipboard-projection span, which only matched the composer on drafts without chips; the removal now folds the chip's clipboard offset to its single detect character, matching the shell's own consume-token behavior.

### Compatibility

- The textarea-era insertion flow (0.1.5 test stand-ins) remains the documented fallback for any host that still ships a textarea composer; the two generations are told apart by the shell's `caretSpan` verb, not by version sniffing. The 0.1.5-rc.1 and 0.2.0-rc.2 hosts share the same composer-shell face, so both are covered by the new path.

## [0.3.2] - fork

### Fixed

- **Pasted images now reach the Vision Toolkit flow instead of dying on the host's “The current model does not support images” toast.** The label-based paste verdict walked every provider — including this plugin's own image-input variants, whose routes reuse the wrapped model's exact name and declare image capability — so a variant's twin vote vetoed the very takeover its existence implies, the paste fell back to the native flow, and the host rejected the send. Variant providers no longer vote (and are not even queried) in the label verdict; a genuine image-capable upstream still keeps its native paste. Regression-tested with a same-name variant twin.

## [0.3.1] - fork

### Added

- **In-app updates work for git installations.** GitHub-hosted installs (`github:owner/repo`, `git+https://github.com/owner/repo`) now report as updatable in Settings instead of «In-app updates are unavailable»: **Check for updates** reads the repository's default-branch head through the GitHub API (tip commit) and raw content (that exact commit's `package.json`), and **Install update** runs a pnpm add pinned to the resolved commit — a floating spec alone keeps the stale lockfile resolution, so the pin guarantees fresh bytes. Rollback restores the backup lockfile and reinstalls frozen. Registry (npm) installs keep the existing flow; local, workspace, and non-GitHub URL installations remain unsupported, as before.

### Changed

- The Settings updates panel no longer claims git installations are unsupported, and its hint is source-neutral (registry or repository).

## [0.3.0] - fork

### Added

- **Attach-confirmation dialog for pasted media.** Pasting a screenshot, video, audio, or document file while the current model cannot take it natively no longer silently switches the model or takes over the composer: a confirmation card appears above the input — «Прикрепить … для использования плагином Vision Toolkit» with Прикрепить/Отмена buttons and a «Больше не показывать в этой сессии» checkbox. Confirming attaches the files as workspace-path references without touching the selected model, and with the checkbox set every later paste in the same page session attaches immediately. Cancelling drops the paste. The paste flow no longer auto-switches to image-input variant routes — the variant entries stay available for manual model selection.
- **Video, audio, and documents paste directly into the composer.** The clipboard capture accepts media files (mp4/webm/mkv/mov/avi/3gp, mp3/wav/m4a/aac/ogg/opus/flac, pdf/docx/xlsx/pptx and legacy office types) beside images; the upload route stores them under the per-session paste root with a dedicated 100 MiB per-file ceiling, and the reference text names the kind (`[pasted video: …]`, `[Pasted audio available at absolute path: …]`). The agent then calls `vision_glance` on the path with the model's declared modalities.

### Fixed

- **`vision_glance` media inputs actually reach the model now.** The path fence's image-only extension whitelist rejected `.mp4`/`.wav`/`.pdf` before the modality routing ran, so every video/audio/document glance failed with «unsupported image format ".mp4"». Media files now resolve through the modality's own extension set, covered by regression tests through the full runtime (media entries, kind/mediaType/bytes in results, modality-gated rejection).

## [0.2.1] - fork

### Fixed

- **Settings, paste, and health actions work inside the DSH Desktop window.** The desktop shell loads the app from the `dsh-app://` custom scheme and forwards renderer requests through its authenticated host proxy, which strips `Host`/`Origin`/`Sec-Fetch-Site` and attaches the host cookie — so the plugin's origin fence saw header-less requests and answered every POST with `403 The request must originate from this DSH Web application`. The fence now mirrors the host's own `/api` browser-trust boundary: `Sec-Fetch-Site: cross-site` still rejects, a present `Origin` must still match the `Host`, and Origin-less requests are trusted on loopback hosts (the desktop forwarder shape) while non-loopback hosts still require same-origin Fetch-Metadata evidence. This also fixes pasted-image upload, paste policy, and display-config requests from the desktop window — the same header-less fence applied to all of them (the upstream plugin shares this bug).

## [0.2.0] - fork

This release marks the fork's first feature set on top of upstream 0.1.46: the vision model becomes a relay-backed, capability-aware choice.

### Added

- **Relay model picker.** Settings → Vision service gained a *Load models* action: the plugin queries `GET {baseUrl}/models` with the configured credential (OpenAI- and Anthropic-shaped responses are both parsed, capped and de-duplicated) and offers the catalog as a dropdown next to the model field. The picker uses the in-progress form values, so it works before the first save; each entry is annotated with its detected modalities.
- **Per-model capability matrix.** `provider.modelCapabilities` stores explicit per-model overrides of which inputs the vision model accepts — image, video, audio, and document (PDF/DOCX/XLSX/PPTX). Heuristic name-based defaults prefill the matrix (Qwen-Max 0902+ and omni models default to full multimodal; `*-vl`/vision families to image+video; Claude to image+PDF; Gemini to everything; image-generation models to none). Toggles that match the detected default are dropped again, so the stored map only carries real deviations; a *Reset to detected* control restores the heuristic for one model.
- **Multimodal glance.** `vision_glance` now accepts video (`.mp4/.webm/.mkv/.mov/.avi/.m4v/.3gp`), audio (`.mp3/.wav/.m4a/.aac/.ogg/.opus/.flac`), and document (`.pdf/.docx/.xlsx/.pptx/.doc/.xls/.ppt`) paths beside images, subject to the selected model's capabilities. Inputs are routed to protocol-appropriate content parts — `video_url`, `input_audio`, and the DashScope-style `file` part for Chat Completions, `input_file` for Responses, PDF `document` blocks for Anthropic — and non-image inputs appear in the tool result as a `media` array (kind + media type + bytes).
- **Capability gating with actionable errors.** When the configured model does not accept an input modality, glance fails before any bytes move — in the TypeScript runtime and again in the Python client via the new `VISION_MODALITIES` environment variable — with a message that points at the Settings capability matrix instead of surfacing an opaque provider rejection. A model switch therefore degrades predictably: the same `vision_glance` call works on a fully multimodal Qwen and refuses loudly on a text-only model.
- `maxMediaBytes` (default 32 MiB, max 256 MiB) bounds non-image inputs; it is configurable in Settings → Limits.

### Changed

- **The fork now ships as `@gofman5/dsh-vision-toolkit` (author: GofMan5).** The cordis plugin name, client bundle id, profile bundle entry, and patch-row name all follow the package name, so profiles migrating from upstream must update the dependency key, the `dsh.profile.bundles` entry, and any `name: '@anionex/dsh-vision-toolkit'` patch rows to the new id. Upstream remains the original `@anionex/dsh-vision-toolkit`.
- The health-check *Test vision model* still sends the bundled diagnostic image, and its failure detail now explains modality rejections the same way glance does.
- The copyable manual-update command in Settings points at `github:GofMan5/dsh-vision-toolkit` instead of the upstream npm release, matching how the fork is installed.

### Removed

- All sponsor, donation, and self-promotion surfaces inherited from upstream: the sponsor tables and affiliate links (AIHubMix, E-API), the donation QR codes, the community-group QR, the FUNDING files, trendshift/dshfind/leaderboard/npm badges, the upstream author's contact links, and the AIHubMix signup tutorial linked from Vision Settings.

### Compatibility

- The vendored `agent-vision-toolkit` snapshot carries the fork's multimodal content-part changes; `UPSTREAM_MANIFEST.json` was regenerated accordingly. External runtime mode therefore requires an exact export of this fork's vendor directory (the clean upstream checkout no longer matches the manifest). Managed mode — the default — is unaffected.
- Chat-side image handling (paste takeover, image-input variants, transparent routing) is unchanged; DSH's host modality vocabulary remains text+image, so video/audio/document attachments continue to reach agents as workspace file handles that `vision_glance` can analyze.

## [0.1.46] - 2026-10-01

### Compatibility

- Verified DSH `0.2.0-rc.2` using an isolated, hoisted tarball Profile, actual visual-tool calls, and Web Settings. Add an exact peer/compatibility declaration and a required CI Profile lane for this release. The fixture explicitly selects its OpenAI-compatible protocol after the host's default provider protocol changed.
- 已通过 DSH `0.2.0-rc.2` 隔离压缩包 Profile、真实视觉工具调用及 Web 设置验收；增加确切兼容声明及 CI 验收矩阵。官方默认协议变更后，测试 fixture 显式选择原有 OpenAI 协议。核实时官方尚无正式稳定版。

### Added

- Added an explicit OpenAI Responses protocol for custom vision providers. An optional, constrained `reasoningEffort` is forwarded only for Responses requests, exposed conditionally in bilingual Settings, and included in both live-Session and durable evidence cache identities. Existing OpenAI configurations remain on Chat Completions and omit effort by default.

- Added hardened `provider.headers` for non-secret deployment metadata and `provider.sessionHeaders` for gateways such as OpenCode Zen that require per-session routing. Session values are process-keyed HMAC identifiers that never expose raw Session ids or workspace paths; configured headers are bounded, conflict-checked, error-redacted, cache-isolated, restricted to the provider origin/base path, and shared by both requests in a connection-and-model health operation. The manifest-verified vendored snapshot remains unchanged ([#144](https://github.com/Anionex/dsh-vision-toolkit/issues/144)).

### Fixed

- Restored startup and live Settings on DSH 0.1.7, whose Config projection replaced the old `settings.register/get/watch` API. The plugin now uses the host's matching Schema form, unwraps live configuration values for runtime use, and follows Settings document updates. Earlier DSH versions continue using their registration API.
- Vision API subprocesses now try IPv4 addresses before IPv6 when both are returned by DNS. This avoids exhausting the connection timeout on unusable fake IPv6 addresses in TUN proxies while preserving IPv6-only endpoints.
- Stopped the image-input variant route from crashing on request messages that carry no `source`. The variant read `message.source.kind` while assembling the evidence pass, but the official `createUserMessage()` helper writes no `source` at runtime (its published type still declares one as required), so a plugin that built a programmatic `ctx.llm.stream()` call on a `vision-toolkit-*` route — the usual summarize, title, or classify pattern (`@modusensus/dsh-mneme` ≤ 0.8.1 did exactly this) — failed with `TypeError: Cannot read properties of undefined (reading 'kind')`, which the host surfaced only as a generic `UNKNOWN` failure chunk. A user message without provenance is now treated as a user turn, and assistant history without provenance is skipped instead of throwing; messages that do carry a source behave exactly as before.

### Documentation

- Documented `/responses` endpoint composition, common and provider-specific effort values, possible token/latency/cost effects, and the need to review provider data-retention policy even though requests send `store: false`.

## [0.1.45] - 2026-09-14

### Fixed

- Restored native model reasoning on image-input variant routes. The host hands the provider-native replay metadata — thinking signatures, native effort binding, response ids — only to the adapter instance that owns both the historical and the target provider, so a Session running on a variant route lost it for its entire history: turns produced by the original route were withheld, and turns produced by the variant were stripped again by the delegated call. An upstream that needs that metadata to keep thinking (pi-ai's adaptive-thinking and signed-reasoning paths) then answered with no reasoning block at all while still being asked for the configured `reasoningEffort`, without an error and without a log line. The variant now re-reads the withheld metadata from the durable Session transcript by message id and presents only the delegated copy under the upstream route, so the Session log keeps the route the user selected.

## [0.1.44] - 2026-09-10

### Fixed

- Kept pasted-image drafts working on DSH 0.1.5, which renamed the composer's draft snapshot field from `imageIds` to `attachmentIds`. The plugin now reads the new name and keeps the old one only as a fallback, so the post-replay probe no longer throws on an undefined list.
- Restored Skill re-exposure after resuming a Session on DSH 0.1.5. The PTC sub-dispatch Session event was renamed from `tool/code-dispatch` to `tool/ptc-dispatch`; both names are now accepted, because Sessions written by earlier releases still carry the old one.
- Refreshed the Settings snapshot when a credential changes. The client subscribed to `credentials/updated`, which is not a forwarded Host event and therefore never fired; the real name is `credentials/reference-updated`.

### Changed

- Moved the dependency family to DSH `0.1.5-rc.1` and removed `@deepseek-ai/dsh-client-runtime`, which stopped publishing at `0.1.1-rc.2`. The client's type-only imports now follow the packages that own those contracts in 0.1.5 (`Context` from `@deepseek-ai/cordis`, `ToolCallBlock` from `@deepseek-ai/dsh-client-ui-conversation/client`), so a stale local copy can no longer stand in for the real host API.
- Peer ranges now name each supported DSH release line explicitly. A single range such as `>=0.1.0-rc.8 <0.2.0` does not match `0.1.5-rc.1` under strict semver prerelease rules, so a user on 0.1.5 had an unsatisfied peer and pnpm — which auto-installs peers by default — silently materialized a stale older copy next to the real host.
- `dsh.client.inject` now lists the packages that actually serve this plugin's browser half instead of the retired `dsh-client-runtime` name.
- Declared exact compatibility for the official DSH release window `0.1.5-alpha.1`, `0.1.5-alpha.2`, and `0.1.5-rc.1`, each verified by a clean Profile install, boot, and host-route acceptance.

## [0.1.43] - 2026-09-08

### Changed

- Declared exact compatibility for the official DSH release window `0.1.2-rc.1`, `0.1.3-alpha.1`, and `0.1.3-alpha.2` under `dsh.compatibility.dshReleases`, so the DSH STORE Catalog can read a per-release verdict instead of `unknown`.
- Verified DSH `0.1.3-alpha.2` with a clean disposable Headless Profile install, boot, visual-tool execution, and uninstall acceptance.
- Recorded DSH `0.1.3-alpha.1` as `unknown`: the official GitHub release has no npm artifact, so there is no installable build to accept.

## [0.1.42] - 2026-09-05

### Changed

- Declared exact compatibility with DSH `0.1.2-rc.1` after clean Headless Profile install, startup, visual-tool execution, disable/re-enable, and uninstall acceptance.

### Fixed

- Kept Agent-scoped visual-tool exposure working on DSH `0.1.2` prereleases by reading Session history through the public `snapshotEvents()` API when available.

## [0.1.40] - 2026-08-31

### Fixed

- Stopped importing the `settingsNamespace` export from `@deepseek-ai/dsh-settings`, which dsh 0.1.2-alpha removed; the plugin now inlines the namespace check, so the profile no longer fails to boot on the alpha channel.
- Retained configured shared-storage roots in a plugin-owned `storage-domain` sidecar, so persisted pasted-image and artifact paths remain readable after read-only Settings changes and Profile restarts.

## [0.1.39] - 2026-08-25

### Fixed

- Retried transient Windows `EBUSY`/`EPERM`/`EACCES` failures when deleting or replacing managed and bundled-Python runtime directories, so antivirus real-time scans no longer make first-run environment preparation report "运行环境尚未就绪".
- Kept the primary runtime preparation error visible when best-effort cleanup also fails: staging, quarantine, bundled-Python staging, and lock cleanup now log a warning instead of masking the real failure.

## [0.1.38] - 2026-08-20

### Fixed

- Persisted the final model-visible image evidence across DSH Profile restarts, so historical images no longer consume vision quota again or change the main model's cached conversation prefix.
- Preserved both successful descriptions and `[vision unavailable: ...]` results byte-for-byte; only requests that fail before producing any model-visible result are retried.
- Bound persisted evidence to the Session lifecycle, attachment, focus prompt, credential, and output-affecting runtime settings to prevent replay across incompatible configurations.

## [0.1.37] - 2026-08-20

### Changed

- Superseded the Vision Settings tutorial link with provider-agnostic guidance (fork: the sponsored signup guide was removed).

## [0.1.36] - 2026-08-20

### Added

- The bundled standalone Python now downloads from the domestic mirror (Tencent Cloud COS, `dsh-vision-python-bootstrap-1317715800.cos.ap-guangzhou.myqcloud.com`) first and falls back to the GitHub release when the mirror is unreachable, so users in China no longer need GitHub connectivity for the first-run Python bootstrap. The pinned `assets/python-bootstrap.json` gained an optional `mirrorBaseUrl`, and all eight platform archives are hosted on the mirror. The locked runtime dependencies (Pillow, NumPy, vtracer) are installed from the Tencent Cloud PyPI mirror (`mirrors.cloud.tencent.com/pypi/simple`) first and fall back to the official PyPI index.

## [0.1.35] - 2026-08-19

### Changed

- Made the fast restore mode trigger more sensitive: a floating "快速还原为 HTML" / "快速生成" / "quick restore" control visible in the reference image now counts as a speed signal.

## [0.1.34] - 2026-08-19

### Changed

- **Transparent variant routing is now on by default**: `imageInputVariants.hidden` defaults to `true`, so image-input variant routes keep the original provider and model display names and the model selector shows one entry per model out of the box. Users who prefer the explicit `(Vision Toolkit)` entries can disable the “透明变体路由” setting (advanced settings → image input) to restore the previous behavior.

## [0.1.33] - 2026-08-19

### Added

- **Transparent variant routing** (`imageInputVariants.hidden`, off by default): image-input variant routes keep the original provider/model display names, and the browser hides the upstream text-only twins so the model selector shows one entry per model. Pasted images, image history, and the built-in `read_image` tool keep working on text-only models; opening the selector no longer flashes a duplicate group because hiding is synchronous DOM reconciliation. Disabling the setting restores the explicit `(Vision Toolkit)` entries.
- Settings UI: “透明变体路由” checkbox under advanced settings → image input, with bilingual copy.

### Changed

- Lowered the built-in free vision service daily quota to 100 requests.

### Fixed

- Toggling transparent routing is display-only: it no longer rebuilds or re-verifies the vision runtime.
- The browser display-config cache is invalidated on Settings saves, and an in-flight response can no longer repopulate it with a stale flag.
- Restoring upstream model entries after transparent routing is disabled, and guarding the selector integrator against duplicate installs.

## [0.1.32] - 2026-08-18

### Fixed

- Fixed the compressed-image cache silently missing on Windows when cache file paths exceeded the 260-character `MAX_PATH` limit; cache keys now use shorter 64-bit digests and are versioned as `v2`, so old oversized entries are pruned automatically.
- Made the portable package verification and the test suite Windows-compatible, including `npm.cmd` invocation, path-separator handling, Python bootstrap fixture layout, a profile E2E prompt that avoids newline-carrying argv, and restart-helper test skips where automatic restart is intentionally unavailable.
- Routed Windows `pnpm` batch shims through `cmd.exe` so plugin updates work when the harness resolves `pnpm` to a `pnpm.CMD` path.
- Added a Windows CI job that runs the portable-package build, tests, and verification on `windows-latest`.
- Fixed an intermittent `NO_ADAPTER` failure on image-input variant routes (`vision-toolkit-<provider>`) after adapter re-registration, model switches, or hot reload: wrappers now survive transient registry gaps, are re-registered when the live registry drops them, and self-heal on a periodic sweep.

## [0.1.31] - 2026-08-18

### Changed

- Renamed the bundled Skill from `vision-tools` to `vision-skills`, so the model-facing name describes the capability instead of the underlying tools. Sessions created before the rename still restore activation from legacy `vision-tools` history; new sessions invoke `/vision-skills`.

## [0.1.30] - 2026-08-17

### Changed

- Raised the default vision operation timeout from 15 seconds to 30 seconds for both semaphore queueing and tool execution.
- Removed the practical global ceiling on the built-in free vision service (raised from 5,000 to 1,000,000,000 requests per UTC day) while keeping the per-client daily and burst quotas.

## [0.1.29] - 2026-08-17

### Added

- **Install and use with zero Python setup.** When no system Python 3.11+ is available, the plugin downloads a pinned, sha256-verified standalone Python 3.13 build (about 35 MB) on first use and prepares its isolated runtime with it, so new users no longer need to install Python first. A system Python or an explicit `runtime.python` override still takes precedence, and a committed manifest plus `scripts/python-bootstrap.mjs` keeps the pinned build auditable and updatable.

### Fixed

- Keep the `vision_toolkit_activate` bootstrap callable until the end of the model step when the Skill and the bootstrap are invoked in parallel, preventing a race that surfaced as `unknown tool "vision_toolkit_activate"` while the Skill call was already activating the visual tools.
- Reword the `vision-tools` Skill description so screenshot-to-UI restoration reliably triggers visual-tool activation.

## [0.1.28] - 2026-08-17

### Fixed

- Treat HTTP 403 from `GET /models` as a warning instead of claiming the API key was rejected, because providers such as Groq can restrict the model-list endpoint while real multimodal requests still work. Settings now notes that this warning can be ignored when the real vision-model test reports success.

## [0.1.27] - 2026-08-17

### Added

- Automatically compress input images above `maxImageBytes` (4 MiB default) or `maxImagePixels`, preferring lossless PNG/WebP/GIF re-encodes before lossy quality reduction and, as a last resort, downscaling.
- Accept pasted images up to 20 MiB and compress them on first tool use instead of rejecting anything above `maxImageBytes`.
- Persist compressed copies in a versioned, hash-verified workspace cache so repeated calls reuse the same compressed image.
- Keep original display names on crop/trace/long-OCR/foreground/pixel-diff outputs and preserve EXIF/ICC metadata when re-encoding.

### Fixed

- Reject tampered or symlinked compressed-cache entries and prune stale or oversized cache files.
- Mark JPEG q95 as lossy and try true lossless PNG/WebP re-encodes first for every source format.

## [0.1.26] - 2026-08-17

### Docs

- Documented how and when to configure the Python 3.11+ `runtime.python` override with system interpreters, project-local virtual environments, and the Windows `py` launcher.
- Added reproducible `uv` setup, managed-versus-external dependency guidance, Profile health/model checks, and a `vision_glance` smoke-test workflow.
- Clarified automatic platform temporary-directory authorization, Windows `/tmp/...` mapping, extra `allowedDirs` roots, and ignored project-local `.venv/` directories.

## [0.1.25] - 2026-08-17

### Fixed

- Added the documented `VISION_SSL_VERIFY` escape hatch for trusted self-signed or MITM-proxied vision endpoints, forwarded it through the isolated DSH runtime, and kept TLS certificate verification enabled by default.
- Allowed `vision_toolkit_activate` to mount the visual tool schemas even when the model invokes the bootstrap before loading the `vision-tools` Skill, removing the activation deadlock while preserving Agent-scoped exposure.
- Authorized the platform temporary directory for visual inputs and mapped model-generated `/tmp/...` paths to `%TEMP%` or `%TMP%` on Windows, while retaining realpath fencing and model-visible path guidance.

## [0.1.24] - 2026-08-17

### Fixed

- Kept Vision Toolkit Settings panels, form fields, action buttons, and advanced runtime details within the available Web Settings modal width instead of forcing horizontal overflow and clipping the right column.

## [0.1.23] - 2026-08-17

### Added

- Settings now links to the Groq Qwen3.6-27B tutorial and shows a one-line manual update command with a copy button.

## [0.1.22] - 2026-08-17

### Docs

- Added a step-by-step Groq tutorial (English and 中文) for obtaining a free API key and using Qwen3.6-27B for image understanding, with screenshots and ready-to-run cURL/Python examples.

## [0.1.21] - 2026-08-17

### Changed

- Switched the built-in free vision service to Gemini 3.7 Flash by default; Qwen-compatible requests keep routing through Groq.
- Split grounding prompts by model family so Gemini and Qwen each use their native bounding-box coordinate order.

### Fixed

- Fixed Qwen detection boxes being swapped by prompting Qwen with `x0,y0,x1,y1` and Gemini with `y0,x0,y1,x1`.
- Return the standard non-retryable `rate_limit_exceeded` code when every upstream is cooling down, preventing the 15-second client deadline from hiding an immediate provider-capacity response as a timeout.

## [0.1.20] - 2026-08-17

### Changed

- Allocate Groq accounts through persistent active-request and cooldown state, preferring the least-active available account instead of hashing concurrent requests onto colliding keys.
- Give semaphore queueing and tool execution separate timeout budgets, so waiting for a session slot no longer consumes the 15-second vision inference deadline.

### Fixed

- Cool down rate-limited, unauthorized, and transiently failing Groq accounts before retrying another account, reducing repeated collisions and timeout cascades during concurrent visual grounding.
- Report queue time separately in runtime diagnostics and return an explicit queue-timeout message when the session concurrency gate itself is saturated.

## [0.1.19] - 2026-08-17

### Changed

- Raised the built-in public vision service output ceiling from 512 to 4,096 tokens, leaving enough room under Groq's free-tier token budget for image input while avoiding premature truncation of dense element inventories.

### Fixed

- Parse Qwen-family grounding coordinates as `x0,y0,x1,y1` while retaining Gemini-family `y0,x0,y1,x1` compatibility and an explicit override for custom providers.
- Reject incomplete bounding-box JSON instead of silently returning a misleading partial detection result, and avoid duplicating already-complete detect category instructions.

## [0.1.18] - 2026-08-16

### Changed

- Rebased the model-facing `vision-tools` Skill on the upstream `SKILL.md` and
  all five upstream playbooks, changing only native DSH tool invocation,
  Artifact/resource delivery, progressive exposure, and DSH runtime boundaries.
- Added an exact upstream Skill commit/hash manifest, a reviewable adapter
  patch, and repeatable sync/verification commands so future upstream updates
  fail closed when the adaptation no longer applies cleanly.
- Expanded the built-in free vision service capacity and provider pool to
  reduce peak-time exhaustion without changing the existing client safeguard.
- Replaced the built-in public compatibility key with the project URL while
  continuing to accept the legacy `api_key="free"` value for existing installs.
- Reduced the default vision operation timeout from 60 seconds to 15 seconds.

### Fixed

- Removed the stale single-image restriction from the public Groq vision proxy; one request can now forward up to five images in their original order.
- Returned sanitized Groq validation details and descriptive request-size errors instead of retrying non-retryable failures across every provider account.
- Returned explicit quota `429` responses immediately, including retry guidance, instead of retrying them until the client reported a timeout.

### Removed

- Removed the GitHub Pages workflow: the public project website is
  `agent-vision.anionex.me` and the repository has no Pages site enabled, so the
  job always failed at the Pages configuration step.

## [0.1.17] - 2026-08-16

### Changed

- Clarified in both READMEs that the visual-tool system, its division of responsibilities, and the `vision-tools` Skill are original work, and refreshed the bilingual pairing record.

## [0.1.16] - 2026-08-16

### Changed

- Allowed registry-installed Profiles to install plugin updates even when the running DSH Web process cannot safely restart itself; the Settings page now asks the user to restart DSH Web manually when needed.
- Clarified update status and confirmation text so installation and process restart are reported as separate steps.

## [0.1.15] - 2026-08-16

### Fixed

- Fixed the Settings runtime health check reporting a false artifact-directory failure when DSH Desktop starts from a read-only installation directory. The check now uses the prepared runtime home and validates output readiness independently from session-relative input directories.

## [0.1.14] - 2026-08-16

### Changed

- Switched the built-in free vision service from Cloudflare Workers AI Gemma 4 to Groq Qwen3.6 (`qwen/qwen3.6-27b`), with three server-side API keys rotated across requests and no change to the public OpenAI-compatible endpoint.
- Raised the shared Worker ceiling to 3,000 requests per UTC day and 60 requests per minute to match the combined request capacity of the three Groq free-tier accounts more closely, while keeping the per-client ceiling at 100 requests per day.

## [0.1.13] - 2026-08-16

### Added

- Added `fullPage=true` to `vision_html_screenshot`; the Chrome DevTools Protocol path preserves the requested layout viewport, captures the complete document, and reports `pageHeight` in CSS pixels while leaving fixed-viewport captures unchanged.
- Added a **Plugin updates** Settings card that checks the configured npm registry, installs an explicitly confirmed release into the current registry-backed DSH profile, verifies it, and can restart an explicitly opted-in fixed-port POSIX DSH Web process through an independent readiness/rollback helper. Token-owned cross-process locking, pre-update manifest/lockfile backups, bounded rollback commands, and exact-version recovery protect the Profile across failed installs and restart handoff. Local/workspace/git/URL and otherwise unsafe-to-replace installs remain read-only; Windows, dynamic-port, and manager-owned processes keep restart ownership outside the plugin.

### Fixed

- Fixed managed runtime creation failing with exit status 101 when the Microsoft Store Python is used on Windows: the venv is now created with `--without-pip`, the staged `pyvenv.cfg` `home`/`executable` are rewritten to the app execution alias directory, and pip is bootstrapped explicitly.

## [0.1.12] - 2026-08-16

### Fixed

- Kept persisted v0.1.10 Moondream free-provider settings on the built-in `api_key="free"` path after upgrading, so existing installations do not require a DSH Credential.
- Aligned direct `point` and `detect` task coordinates with the toolkit's 0-1000 grid and rejected malformed structured locations instead of returning false-success responses.

## [0.1.11] - 2026-08-16

### Changed

- Raised the built-in free vision service limits from 30 to 100 requests per client per UTC day, from 120 to 400 requests globally per UTC day, and from 6 to 20 requests per 60 seconds.
- Switched the built-in free vision backend from Moondream 3.1 to Cloudflare Workers AI Gemma 4 (`@cf/google/gemma-4-26b-a4b-it`) while keeping the public OpenAI-compatible endpoint unchanged.

## [0.1.10] - 2026-08-16

### Added

- Added a built-in free Moondream vision provider at `https://vision.anionex.me/v1`, using the OpenAI Chat Completions protocol with `api_key="free"`. Fresh installations can use remote vision tools without configuring a DSH Credential.
- Added an OpenAI-compatible Cloudflare Worker proxy for the bundled service, including bounded image validation, daily and burst quotas, and explicit rate-limit responses.

### Changed

- Changed the default provider to `moondream-3.1` with a 4 MiB per-image limit and a 20,000,000-pixel per-image limit.
- Kept custom OpenAI-compatible and Anthropic providers supported; changing the endpoint, model, or protocol unlocks the API key field and restores normal DSH Credential handling.

### Fixed

- Prevented browser-side or same-origin credential writes from storing a user key under the read-only built-in free provider reference.
- Aligned automatic image-input descriptions with the pinned upstream focus-hint contract: the bridge now derives intent from the current user request or latest assistant paragraph, ignores injected context prefixes, and keys cached evidence by that focus prompt.
- Made shared attachment reads bounded and cancellation-safe so queued descriptions can stop without aborting another consumer that is still using the same image read.

## [0.1.9] - 2026-08-16

### Added

- Added an explicit **Test vision model** Settings action that sends a bundled diagnostic image through the same multimodal runtime path as `vision_glance`, so a successful `/models` response can no longer be mistaken for proof that the configured model and upstream account can process images.

### Changed

- Renamed the lightweight Settings probe to **Test API connection**, made its copy explicit that it only calls `GET /models`, and added a dedicated verified/not-tested/failed Tag to the real vision-model result.

## [0.1.8] - 2026-08-16

### Added

- Pasting an image with a plain text-only model now works like a multimodal model with zero manual steps: the browser integration asks the host with the exact model route, the host answers an auto-switch instruction when the image-input variant exists, and the client switches the session by itself and replays the paste into the composer's native intake (thumbnail, limits, keyboard). A failed switch or an environment that cannot replay clipboard bytes degrades to the paste-to-path takeover with the same files; `imageInputVariants.autoSwitch` (default `true`) turns the auto-switch off.
- Text-only model routes now get `(Vision Toolkit)` image-input variants in the model selector. Selecting a variant keeps the native paste and attachment flow — composer thumbnail and durable session image — and the plugin rewrites image blocks into Vision Toolkit descriptions only on the wire to the model. Variants are registered automatically for every model the host declares text-only and can be disabled or restricted via `imageInputVariants`.
- The browser paste interception now asks the host before taking a paste over: pastes stay native for image-capable models (including the variants) and are converted to workspace paths only for models the host confirms text-only.

## [0.1.7] - 2026-08-15

### Added

- Added a write-only API key field to Web Settings so users can configure online vision without opening the credential file; saved values are never returned to the browser.

### Changed

- Moved the credential reference name into Advanced settings and protected browser credential writes with same-origin, Settings revision, and active-reference checks.

## [0.1.6] - 2026-08-14

### Added

- Added native Anthropic Messages transport with configurable thinking behavior, provider-compatible User-Agent overrides, and matching Web Settings controls.

### Changed

- Restored the user-first Web Settings hierarchy: required provider fields appear first, advanced compatibility and runtime controls are collapsed, and plugin identity, versions, and runtime generation are shown in the footer.
- Replaced internal-facing Settings, health, tool-card, and artifact labels with concise English and Simplified Chinese user copy.

### Fixed

- Keep the DSH Credential, endpoint, protocol, thinking mode, and User-Agent authoritative when the pinned upstream runs beside ignored `.env` files.
- Use Anthropic authentication headers for explicit `/models` connection tests and retry overloaded Anthropic responses with bounded `Retry-After` handling.

## [0.1.5] - 2026-08-14

### Added

- Pasted clipboard images are copied into the active workspace and represented as stable input references, with per-image progress, retry-safe serialization, and removal controls.

### Changed

- Development builds and tests resolve the published DSH `0.1.0-rc.6` package set directly instead of depending on a neighboring Harness checkout.

### Fixed

- Accept low-share `vision_dominant_colors` palette and candidate rows whose histogram bar is empty.
- Use Harness design tokens for every Vision Toolkit surface color, including preview checkerboards, download actions, status indicators, alerts, fields, and pasted-image chips, so light and dark themes remain readable without light-only fallback colors.
- Require the compatible DSH `0.1.0-rc.6` release line so package managers cannot select the broken `dsh-client-runtime@0.0.1-rc.1` release through the `latest` dist-tag.
- Use the published `@deepseek-ai/dsh-client-ui-input-trigger` package while retaining runtime registration compatibility with the earlier `ctx.slash` service alias.
- Publish only rescoped `@deepseek-ai/cordis` imports and declare every directly consumed DSH host/client peer.
- Pin NumPy to the newest release that still supports the documented Python 3.11 minimum, so managed runtime preparation works on Python 3.11.

## [0.1.4] - 2026-08-14

### Changed

- Package metadata (`repository`, `bugs`) points at the public `Anionex/dsh-vision-toolkit` repository; the portable verification gate tracks the current version.

## [0.1.3] - 2026-08-14

### Added

- Web pasted-image degradation (`degradePastedImages`, default off): when the session model cannot accept images, pasted images are saved into the session workspace (`.dsh-vision-toolkit/pastes/`) and handed to the model as file paths, so the agent reads them through the visual tools with a visible tool workflow. Native vision models are preferred and never take this path.

### Fixed

- Upstream `vision_client.py` sends a stable `User-Agent`, avoiding HTTP 403 responses from gateways that reject the urllib default agent; the vendored manifest hash records the patched file.
- Peer dependency ranges were widened for the published prerelease packages. Version 0.1.5 supersedes those ranges because SemVer does not admit the `0.1.0-rc.*` line through a comparator starting at `0.0.1-rc.1`.

## [0.1.2] - 2026-08-11

### Changed

- Repositioned the README, landing page, hero, social preview, package metadata, and About copy around the product's exact role as the native DeepSeek Harness integration for `agent-vision-toolkit`.
- Added direct, prominent links to the upstream repository and first-party project website.
- Added optimized official upstream reference images for infographic restoration, sketch-to-UI restoration, image Q&A, and screenshot-guided debugging, with exact commit provenance and explicit separation from DSH-native proof.
- Set the package homepage to the first-party `agent-vision-toolkit` website and expanded discovery keywords for text-only agents, Agent Skills, and vision-language models.

## [0.1.1] - 2026-08-11

### Changed

- Replaced private-repository GitHub metadata badges with versioned static badges that remain truthful without unauthenticated repository access.
- Gated GitHub-hosted CI and Pages jobs to public repository visibility while keeping the workflows ready for a future visibility change.

### Fixed

- Package homepage and bilingual release guidance now point authenticated users to the private repository instead of an unavailable public Pages site.

## [0.1.0] - 2026-08-10

### Added

- Portable DeepSeek Harness Profile Bundle support for Web and Headless profiles, with committed runtime and client build artifacts.
- Five P0 tools: `vision_glance`, `vision_ground`, `vision_detect`, `vision_trace`, and `vision_crop`.
- Five P1 tools: `vision_pixel_diff`, `vision_long_screenshot_ocr`, `vision_extract_foreground`, `vision_dominant_colors`, and `vision_html_screenshot`.
- Agent-scoped progressive tool exposure through the bundled `vision-tools` Skill and one temporary activation bootstrap.
- Managed and exact external Python runtime modes backed by a pinned, manifest-verified `agent-vision-toolkit` snapshot.
- DSH Credentials integration, hard operation deadlines, cancellation propagation, per-session concurrency, bounded single-task glance reuse, metrics, and stable redacted errors.
- Workspace-fenced Artifact creation for images, SVG, Markdown, and JSON, including signed Web preview/download routes and local open-file fallback.
- Dedicated Web tool cards plus live Settings for configuration, health, connection testing, runtime preparation, and version inspection.
- Reproducible UI restoration acceptance workflow with committed `6.04%` initial and `0%` final pixel-difference evidence.
- Bilingual product, troubleshooting, requirements traceability, and UI restoration documentation.
- Dependency-free portable package CI, structured issue forms, contribution and security policies, support guidance, funding disclosure, project hero, and social-preview asset.

### Fixed

- Headless Chrome rendering now uses a disposable profile, `--use-mock-keychain`, and cleanup that avoids the user's daily Chrome profile and macOS login keychain.
- Failed or obsolete Settings candidates cannot replace the active runtime generation or stored usable configuration.
- SVG output validation fails closed on malformed, unsafe, or semantically invalid vtracer output.
- Runtime teardown cancels in-flight operations before removing Agent-scoped tools, the activation bootstrap, and the Skill.
- The Web client is published through the current nested `dsh.client` manifest and loader-compatible built artifact required by DSH snapshot0810.

[Unreleased]: https://github.com/GofMan5/dsh-vision-toolkit/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/GofMan5/dsh-vision-toolkit/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/GofMan5/dsh-vision-toolkit/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/GofMan5/dsh-vision-toolkit/compare/v0.3.2...v0.4.0
[0.3.2]: https://github.com/GofMan5/dsh-vision-toolkit/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/GofMan5/dsh-vision-toolkit/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/GofMan5/dsh-vision-toolkit/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/GofMan5/dsh-vision-toolkit/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/GofMan5/dsh-vision-toolkit/compare/v0.1.46...v0.2.0
[0.1.46]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.45...v0.1.46
[0.1.45]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.44...v0.1.45
[0.1.44]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.43...v0.1.44
[0.1.43]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.42...v0.1.43
[0.1.42]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.40...v0.1.42
[0.1.40]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.39...v0.1.40
[0.1.39]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.38...v0.1.39
[0.1.38]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.37...v0.1.38
[0.1.37]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.36...v0.1.37
[0.1.36]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.35...v0.1.36
[0.1.35]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.34...v0.1.35
[0.1.34]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.33...v0.1.34
[0.1.33]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.32...v0.1.33
[0.1.32]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.31...v0.1.32
[0.1.31]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.30...v0.1.31
[0.1.30]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.29...v0.1.30
[0.1.29]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.28...v0.1.29
[0.1.28]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.27...v0.1.28
[0.1.27]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.26...v0.1.27
[0.1.26]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.25...v0.1.26
[0.1.25]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.24...v0.1.25
[0.1.24]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.23...v0.1.24
[0.1.23]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.22...v0.1.23
[0.1.22]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.21...v0.1.22
[0.1.21]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.20...v0.1.21
[0.1.20]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.18...v0.1.19
[0.1.18]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Anionex/dsh-vision-toolkit/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Anionex/dsh-vision-toolkit/releases/tag/v0.1.0
