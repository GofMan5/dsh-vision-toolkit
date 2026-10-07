# Полное ревью DSH Vision Toolkit

## Статус после исправлений

**R01–R25 исправлены в релизе 0.5.0; добавлен defensive fix для C1.** Существовавшие до аудита native-media/UI изменения сохранены. Поставляемые JavaScript, declarations и source maps пересобраны. Последующие исправления native timeout/error handling и composer alignment также включены. Публикация исходников не означает установку в рабочие профили; реальные credentials и локальные конфиги в релиз не входят.

Ниже сохранён исходный аудит как историческое доказательство. Его номера строк относятся к дереву до исправлений; актуальные реализации и регрессии перечислены здесь. Зелёные проверки подтверждают описанные сценарии, а не отсутствие всех других ошибок.

| Находки | Исправление | Проверка |
|---|---|---|
| R01 | Все административные маршруты проходят Host `connection.requestRejection`; без API — `503`. Artifact capability остаётся отдельной границей. | [Security regressions](<tests/review-fixes-security.spec.ts>): helper и реально зарегистрированные маршруты; no-cookie GET/POST → 401 до действий, cookie positive, foreign Origin negative, Desktop без Origin. Host auth в тестах — fixture публичного API, не новая установка живого Host. |
| R02 | Catalog/health fetch и Python urllib отвергают redirects, включая same-origin/downgrade; guard действует и без extra headers. | [Security regressions](<tests/review-fixes-security.spec.ts>), [runtime regressions](<tests/runtime-review.spec.ts>), [Python runpy](<tests/upstream-python-guard.spec.ts>): loopback receiver не вызывается; 301/302/303/307/308, три auth protocols, HTTPS context, восстановление monkey patches. |
| R03 | Автоматическая проекция требует серверную HMAC-authority в настоящем user source, привязанную к session id/createdAt/cwd, path, size, SHA-256. | [Media authority](<src/media-references.ts>), [security tests](<tests/review-fixes-security.spec.ts>), [client tests](<tests/review-fixes-client.spec.tsx>): upload → native projection, forged/unsigned/skill/cross-session/modified-file negatives, signed frontend serialization/retry. |
| R04 | Late bind сериализован с consent writes; live opt-out переносится в durable state, detach сохраняет fallback, conflicts повышают revision. | [Security regressions](<tests/review-fixes-security.spec.ts>) и [session media](<tests/session-media.spec.ts>). |
| R05–R06 | Секреты удаляются до truncation; catalog bytes ограничены в reader loop с cancellation. | [Security regressions](<tests/review-fixes-security.spec.ts>): reflected/truncated key и chunked oversized body (читает 5 из 20 chunks). |
| R07 | Newest-first cache retention; process-global refcount pins до завершения операции и gate вокруг cache preparation/pruning. | [Runtime regressions](<tests/runtime-review.spec.ts>): 200 entries, byte budget, multi-image, повторный call, concurrent runtimes и failure cleanup. |
| R08 | Async distinct-output guard использует platform path equality и dev/ino identity; все callers await. | [Runtime regressions](<tests/runtime-review.spec.ts>), [path tests](<tests/paths.spec.ts>): Windows case aliases с/без compression, crop/preview/foreground, hard links, sibling positive. |
| R09 | Python adapter исправляет стандартные PDF filename/file_data и MP3 format; vendor не менялся. | [Python runpy](<tests/upstream-python-guard.spec.ts>): реальные vendored helpers и captured request JSON, image/video/WAV/relay/Anthropic negative controls. |
| R10–R11 | Proxy допускает image admission до preprocessing ceiling, не direct-wire cap; unsigned variant/projection path больше не запускает вторую автоматическую обработку. | [Security regressions](<tests/review-fixes-security.spec.ts>): 5 MiB fixture достигает glance; variant-generated evidence и повторная projection дают только один call. Реальное compression поведение отдельно покрыто [runtime tests](<tests/runtime.spec.ts>). |
| R12 | Restored Skill exposure распознаёт raw Host 0.2 и legacy tool-result, проверяя call/error/content/order. | [Exposure tests](<tests/exposure.spec.ts>) и [tools lifecycle](<tests/tools.spec.ts>). |
| R13–R14 | Watcher ставится до первого startup await, буферизует latest Settings и догоняет initialize; repair сравнивается с accepted config, previous retention валидирует только storage fields. | [Settings regressions](<tests/review-fixes-settings.spec.ts>): gated key/runtime startup и valid repair после invalid projection. |
| R15 | Storage roots объединяются монотонно при late bind; callback запускает reconciliation; восстановленные roots входят в новый runtime. | [Settings regressions](<tests/review-fixes-settings.spec.ts>) и [storage history](<tests/storage-history.spec.ts>), включая overlap write/open. |
| R16–R17 | Node launcher безопасно запускает Windows batch shim; после успешного manual install повторная установка запрещена до restart. | [Updater tests](<tests/plugin-update.spec.ts>): настоящий harmless `.CMD` с пробелами/metacharacters, expansion control, повторные install до fs/spawn, backup/lockfile cases. Реальная установка не выполнялась. |
| R18–R20 | Save инвалидирует старые loads; policy refresh сохраняет known consent; dock и attach handler проверяют session identity. | [Client regressions](<tests/review-fixes-client.spec.tsx>): оба порядка GET/Save, credential-only save, expired/pending opt-out, modern/legacy foreign confirmation. |
| R21 | Shared prune освобождает File/batch/map/listener после serializer settlement, сохраняя parallel/detached ownership; поздние transport retries используют bounded string-only fallback. | [Client regressions](<tests/review-fixes-client.spec.tsx>): optimistic clear, parallel sends, rejection restoration/retry, abort, удалённые siblings, signed restored retry. |
| R22 | Единый weighted drain вызывается из release и cancellation. | [Runtime regressions](<tests/runtime-review.spec.ts>): класс и runtime jobs=3 OCR head/lightweight follower. |
| R23–R24 | Same-scope draft сохраняет headers/sessionHeaders/User-Agent; изменённый scope не наследует их. Read-only GitHub evaluation сохраняет git source. | [Web tests](<tests/web.spec.ts>) с обычным UI payload и [updater tests](<tests/plugin-update.spec.ts>). |
| R25 | Ill-formed Unicode output/capability names отвергаются; header/writeHead/stream setup exception закрывает уже открытый handle. | [Path tests](<tests/paths.spec.ts>), [artifact tests](<tests/artifact-access.spec.ts>): forced setup errors с fd=-1 и valid Unicode HEAD. |
| C1 | Любая authoritative activation инвалидирует ticket, в том числе same fingerprint. | [Settings regressions](<tests/review-fixes-settings.spec.ts>): pending old generation не публикуется. Production interleaving по-прежнему не выдаётся за доказанный finding. |

### Итоговая проверка рабочего дерева

| Проверка | Результат после исправлений |
|---|---|
| Полный основной Vitest, threaded single-worker, bundled Python | **595 passed, 48 skipped**; 37 passed files, 5 skipped files |
| Worker Vitest | **55 passed**, 5 files |
| Vendored Python transport | `VISION CLIENT TEST PASS` |
| Backend/client/public-declarations TypeScript `--noEmit` | PASS |
| Strict отдельные новые backend regression files (ES2024) | PASS |
| Build | PASS; generated outputs пересобраны |
| Portable/manifest/Skill verification | PASS; 28 required files, 41 JavaScript files; Skill 6 files |
| `git diff --check` | PASS; только обычные LF/CRLF warnings |

Полный suite выполнен после сборки. Затем в существующий settings test добавлена дополнительная проверка передачи восстановленных roots в runtime; его focused rerun **5/5 PASS**, strict typecheck PASS. Старый prompt-guard suite пропускается на Windows; шесть новых cross-platform runpy cases реально выполнены предоставленным Python. Проверка отдельных tests с ошибочным target ES2023 первоначально не видела `String.isWellFormed`; повтор с package target ES2024 зелёный. Полная компиляция исходников пакета зелёная.

### Совместимость и остаточные ограничения

- Старые Host без `connection.requestRejection` получают `503` на административных Web routes: peer range не обещает им полной Web функциональности. Authenticated Desktop requests без Origin поддерживаются. Это намеренное fail-closed изменение, описанное в [README](<README.md>) и [changelog](<CHANGELOG.md>).
- Старые unsigned pasted path markers теперь **только текст** для автоматического proxy/direct routing. Нужны re-paste или explicit allowed visual tool; durable transcript не переписывается.
- Compression/cache gate и pins работают внутри одного Node process; cross-process coordination не добавлена. Active pinned files могут временно превышать cache budget; pruning возвращает бюджет после settlement. Gate сознательно сериализует cache preparation.
- Host не публикует send-settlement hook. File-free fallback содержит максимум **256 copied references**; слишком старый evicted transport-restored chip требует re-paste, восстановленный copied reference не имеет progress dock.
- Automatic authority подтверждает происхождение/факты файла при проверке; не заявляется устранение всех filesystem TOCTOU при враждебном concurrent local writer. Proxy runtime отдельно открывает файл после digest; descriptor-based end-to-end snapshot передачи остаётся отдельным hardening scope.
- C2 (changed-content replay signature) и C3 (Worker hanging-body/lease availability) **не исправлены и остаются квалифицированными гипотезами**, не подтверждёнными R01–R25.
- Не выполнялись live deployment/GUI owner acceptance, real-provider paid calls/schema acceptance, реальный production update/restart/rollback, полный multi-version/POSIX CI matrix, browser heap stress или Worker deploy. 48 skips нельзя выдавать за пройденные сценарии. Vendored snapshot/runtime provenance не изменены этой серией исправлений; релизный package bump — 0.5.0. Конфиги рабочего профиля не входят в репозиторий.

## Исходный итог аудита

**Рекомендация до исправлений: не выпускать текущую ревизию без устранения R01–R04 и исправлений потери данных R07–R08.** Подтверждены 25 проблем: **2 P1, 18 P2 и 5 P3**. Ещё 2 гипотезы оставлены отдельно; один дополнительный дефект менеджера поколений воспроизведён на уровне класса, но не включён в число подтверждённых пользовательских сценариев.

- **P1** — высокий приоритет: нарушение границ авторизации или передача локальных данных без подтверждённого прикрепления.
- **P2** — существенная ошибка безопасности, сохранности данных, совместимости или работоспособности.
- **P3** — ограниченная по сценарию/последствиям ошибка, исправлять после основных.

Приоритет не равен CVSS. Для каждого security finding ниже указаны необходимые условия и ограничения. «Полное ревью» означает охват основных подсистем, а не доказательство отсутствия остальных ошибок.

## Что проверено

Ревью всего текущего рабочего дерева, а не только diff: backend и Web-маршруты, frontend/React/composer, native и proxy media, прогрессивная экспозиция tools/Skill, runtime и файловые операции, credentials/HTTP, настройки/хранилище, updater, vendored Python, Worker, тесты, manifest/build/CI и опубликованные реализации.

База: HEAD `43a334479ca071ce4dcc42359ee6a47e70798cb3` плюс существовавшие до ревью незакоммиченные native-media изменения; пакет `0.4.1`. Windows, Node `24.21.0`; установленный GUI Host `DSH 0.2.0-rc.2`; большая часть локальных peer typings относится к более старой ветке.

**Во время исходного аудита исправления, commits, push, установки и обновления не выполнялись.** Производственные настройки/профиль/credentials не изменялись. Проверки использовали фиктивные ключи, in-memory сервисы и удалённые после выполнения временные fixtures. К реальным relay и платным vision API не обращались. Реальный GUI проверялся только анонимными GET; credential-forwarding POST воспроизведён на синтетическом backend.

## Краткая карта находок

| ID | Приоритет | Проблема | Основная точка |
|---|---|---|---|
| R01 | P1 | Web-маршруты обходят Host authentication; credential forwarding доступен без cookie | [web.ts:696–719](<src/web.ts#L696-L719>) |
| R02 | P2 | API keys уходят за scope провайдера при redirect | [vision_client.py:448–461](<vendor/agent-vision-toolkit/vision_client.py#L448-L461>) |
| R03 | P1 | Текст skill-invocation может инициировать чтение и загрузку локального media | [native-media.ts:121–126](<src/native-media.ts#L121-L126>) |
| R04 | P2 | Позднее storageDomain теряет установленный запрет на media | [session-media.ts:35–47](<src/session-media.ts#L35-L47>) |
| R05 | P2 | Отражённый relay key попадает в браузер и logs | [relay-models.ts:114–119](<src/relay-models.ts#L114-L119>) |
| R06 | P2 | 4 MiB catalog limit проверяется после полного buffering | [relay-models.ts:104–112](<src/relay-models.ts#L104-L112>) |
| R07 | P2 | Полный compressed cache удаляет новый файл до использования | [runtime.ts:1062–1078](<src/runtime.ts#L1062-L1078>) |
| R08 | P2 | Case alias на Windows позволяет перезаписать собственный input | [paths.ts:614–618](<src/paths.ts#L614-L618>) |
| R09 | P2 | Proxy Python формирует неверные стандартные PDF/MP3 parts | [vision_client.py:200–238](<vendor/agent-vision-toolkit/vision_client.py#L200-L238>) |
| R10 | P2 | Proxy отвергает принятые paste images больше 4 MiB до автосжатия | [media-routing.ts:52](<src/media-routing.ts#L52>) |
| R11 | P2 | Image-input variant и media routing выполняют два paid glance | [image-input-variants.ts:392–402](<src/image-input-variants.ts#L392-L402>) |
| R12 | P2 | На Host 0.2 не восстанавливается native Skill activation | [exposure.ts:139–144](<src/exposure.ts#L139-L144>) |
| R13 | P2 | Settings update во время initialize теряется до подписки | [index.ts:118–120](<src/index.ts#L118-L120>) |
| R14 | P2 | Первая valid repair после invalid projected Settings не применяется | [settings-compat.ts:50–52](<src/settings-compat.ts#L50-L52>) |
| R15 | P2 | Позднее storageDomain стирает durable storage history | [storage-history.ts:82–83](<src/storage-history.ts#L82-L83>) |
| R16 | P2 | Windows pnpm.cmd с пробелами не запускается | [plugin-update.ts:938–944](<src/plugin-update.ts#L938-L944>) |
| R17 | P2 | Повторный update до restart сверяет rollback с неверной версией | [plugin-update.ts:989–999](<src/plugin-update.ts#L989-L999>) |
| R18 | P2 | Старый GET заменяет результат успешного Save в UI | [index.tsx:1106–1186](<src/client/index.tsx#L1106-L1186>) |
| R19 | P2 | Refresh paste policy выбрасывает закэшированный media opt-out | [paste-images.tsx:694–700](<src/client/paste-images.tsx#L694-L700>) |
| R20 | P2 | Attach confirmation другой сессии показывается у текущей | [paste-images.tsx:1062–1069](<src/client/paste-images.tsx#L1062-L1069>) |
| R21 | P3 | После отправки последняя File batch остаётся в browser memory | [paste-images.tsx:1015–1018](<src/client/paste-images.tsx#L1015-L1018>) |
| R22 | P3 | Отмена тяжёлого queue head не запускает допустимого follower | [runtime.ts:206–210](<src/runtime.ts#L206-L210>) |
| R23 | P3 | Load models теряет сохранённые routing headers/User-Agent | [web.ts:450–456](<src/web.ts#L450-L456>) |
| R24 | P3 | Read-only GitHub install проверяет npm вместо repository | [plugin-update.ts:872–881](<src/plugin-update.ts#L872-L881>) |
| R25 | P3 | Lone surrogate filename ломает Artifact response и cleanup fd | [artifact-access.ts:247–255](<src/artifact-access.ts#L247-L255>) |

## Подробные находки

### R01 · P1 — Прямые Web-маршруты расширения обходят аутентификацию Host

**Код:** [web.ts:678–719](<src/web.ts#L678-L719>), [web-request.ts:73–90](<src/web-request.ts#L73-L90>), [web.ts:450–467](<src/web.ts#L450-L467>).

Settings, paste, policy, display и session-media регистрируются напрямую в `webServer`. Собственная проверка проверяет Host/Origin/Fetch-Metadata, но не подписанную Host cookie: при допустимом Host отсутствие Origin принимается. В реально установленном Host маршрут вызывается напрямую, без общей authentication middleware: `@deepseek-ai/dsh-host-webserver/lib/index.js:229–259` (установленный Host 0.2.0-rc.2). Аутентификация Host Connection — отдельный carrier, а не свойство всех `webServer.register` routes.

**Доказательство:** GET без Cookie/Origin к реальному `/` возвращает **401**, к plugin settings/display-config — **200**, к session-media с вымышленной сессией — **400**, а не 401. Затем синтетический backend с `settings.writable=false` принимает такой же анонимный `list-models` POST, разрешает известный credential reference и отправляет fixture Authorization key на переданный caller-ом другой baseUrl. Cross-site negative control возвращает 403 и ничего не отправляет.

**Последствия:** requester, достигающий listener, получает административную поверхность расширения без browser session authentication. Через draft-provider можно направить доступный credential на свой endpoint; read-only Settings этого не предотвращает. Не утверждается, что все setters обходят их отдельные revision/write checks.

**Границы:** default loopback ограничивает сетевую достижимость; это не доказанный обычный browser CSRF и не произвольная атака из интернета. Угроза — неавторизованный локальный HTTP client либо доступ к listener при внешнем bind/forwarding. Способность произвольного локального процесса читать тот же пользовательский профиль зависит от его прав; HTTP authentication boundary всё равно реально обходится.

**Минимальный fix:** административные routes должны использовать поддерживаемый authenticated Host carrier или явный Host `requestRejection`-эквивалент перед обработкой, без самодельного cookie parser. Desktop forwarding должен сохранять Host auth. Signed Artifact capability route рассматривать отдельно — его отсутствие обычной cookie само по себе не ошибка.

**Regression:** no-cookie settings/list-models/paste/session-media → 401; valid cookie → штатный ответ; foreign Origin → 403; read-only запрещает writes; signed artifact contract не ломается.

### R02 · P2 — Redirects выносят credentials за разрешённый provider scope

**Код:** [vision_client.py:448–461](<vendor/agent-vision-toolkit/vision_client.py#L448-L461>), [upstream.ts:540–563](<src/upstream.ts#L540-L563>), [relay-models.ts:65–99](<src/relay-models.ts#L65-L99>); аналогичный health fetch — [runtime.ts:2283–2293](<src/runtime.ts#L2283-L2293>).

Python urllib автоматически копирует Authorization и x-api-key в redirected Request. Guard удаляет только `extra_headers` и устанавливается только при их наличии. Node fetch автоматически следует redirects: на другой origin сохраняет Anthropic x-api-key и custom headers, хотя Authorization в Node cross-origin negative control удаляется.

**Доказательство:** реальные urllib redirect handler и verbatim generated guard, без сети: cross-origin и HTTPS→HTTP requests сохраняют fixture built-in credentials; scoped extra header удаляется; same-origin сохраняет всё. Два синтетических loopback origins для catalog: destination получает x-api-key/custom header, каталог успешно загружается; Node Authorization control не передаётся.

**Границы:** выбранный relay уже знает свой ключ, поэтому злонамеренному relay не нужен этот баг для собственной эксфильтрации. Новая проблема — случайный/скомпрометированный redirect, непредусмотренный recipient, downgrade и нарушение заявленного origin/base-path scoping. TLS downgrade проверен на формировании Python Request, не реальным TLS endpoint.

**Минимальный fix:** reject redirects либо вручную проверять каждый hop на разрешённые scheme/origin/base path, не допуская downgrade и переноса credentials за scope. Одинаковая политика нужна для catalog, health и Python transport.

### R03 · P1 — Magic marker из недоверенного skill content становится разрешением на загрузку файла

**Код:** [native-media.ts:17–25](<src/native-media.ts#L17-L25>), [native-media.ts:121–126](<src/native-media.ts#L121-L126>), [media-routing.ts:43–58](<src/media-routing.ts#L43-L58>).

Текст вида `[Pasted document available at absolute path: "..."]` распознаётся в любом `role:user`, без доказательства, что plugin действительно прикрепил этот файл. `source.kind='skill-invocation'` также является user message. Недоверенный Skill может подставить путь к существующему PDF/image/audio/video внутри разрешённых input roots.

**Доказательство:** malicious synthetic skill body с точным marker → в direct Responses появляется `input_file` с **116 байтами fixture PDF**. В proxy режиме выполнен glance и description ушло основной модели. Обычный текст пути без marker не загружается; disabled document также не передаётся.

**Границы:** только workspace/explicit allowed directories/storage history; path fences не обходятся. Нужны включённая соответствующая modality и подходящий разрешённый provider/native route. Это не произвольное чтение всего диска. P1 обусловлен превращением недоверенного prompt content в скрытый автоматический upload без реального paste/attach admission.

**Минимальный fix:** marker может быть отображением reference, но не authority. Разрешать автоматическое чтение по проверяемой session-scoped записи прикрепления/host attachment reference, связанной с конкретным файлом. Как минимум не интерпретировать marker из skill/model/tool-derived content; одной проверки role недостаточно.

**Regression:** тот же marker из skill-invocation остаётся текстом и не читает файл; настоящий подтверждённый paste работает; все fences и opt-outs сохраняются.

### R04 · P2 — Позднее подключение storageDomain сбрасывает media opt-out

**Код:** [session-media.ts:32–47](<src/session-media.ts#L32-L47>), [session-media.ts:49–69](<src/session-media.ts#L49-L69>).

Пока optional domain отсутствует, выбор пользователя живёт в `memory`. При подключении код просто переключается на `domain.global`, не мигрируя memory и не согласуя revisions/identity.

**Доказательство:** до подключения `enabled=false, revision=1, persistent=false`; после — `enabled=true, revision=0, persistent=true`. Реальный `assertInputs` начинает разрешать fixture PDF. Создание другой session identity специально не проверялось как баг: там сброс defaults предусмотрен контрактом.

**Последствия:** пользовательский запрет перестаёт действовать в той же живой сессии. В отличие от R19 это backend consent regression, а не только UI.

**Минимальный fix:** сериализованно объединять durable и memory rows при binding, учитывая createdAt и revisions; не терять явные запреты. При отвязке domain сохранять актуальное состояние для memory fallback.

### R05 · P2 — Relay error может раскрыть write-only key браузеру и logger

**Код:** [relay-models.ts:114–119](<src/relay-models.ts#L114-L119>), [web.ts:555–556](<src/web.ts#L555-L556>).

Body excerpt обрезается и уплотняется, но не редактируется. HTTP 400/429/500 relay может отражать полученную Authorization/API key. Ошибка возвращается в browser JSON и записывается в logger.

**Доказательство:** synthetic 500 с fixture key → Web 502 и logger содержат ключ; тот же body при 401 → в обоих отсутствует. Обычный settings snapshot сам ключ не раскрывает.

**Fix:** использовать имеющийся [redactText](<src/errors.ts#L42-L48>) с разрешённым apiKey **до truncation**, редактировать fetch exception messages; тестировать browser и logger. Это отдельная утечка даже после исправления authentication R01.

### R06 · P2 — Catalog body cap не ограничивает расход памяти

**Код:** [relay-models.ts:104–112](<src/relay-models.ts#L104-L112>).

`response.text()` полностью буферизует body, и только затем проверяются 4 MiB. Chunked, неверный Content-Length или compressed expansion проходят раннюю проверку.

**Доказательство:** bounded synthetic 5 MiB chunked body прочитан целиком до отказа; declared Content-Length 5 MiB отклоняется раньше. Реального OOM не провоцировали. 15 секунд timeout ограничивают время, но не allocation; параллельные Web actions ухудшают предел.

**Fix:** читать stream с byte counter, отменять body сразу при превышении лимита; cancel и при header rejection. Тест с chunked/decompressed oversized response.

### R07 · P2 — Compressed cache удерживает старейшие файлы и удаляет новый до чтения

**Код:** [runtime.ts:1062–1078](<src/runtime.ts#L1062-L1078>), [runtime.ts:1152–1155](<src/runtime.ts#L1152-L1155>).

Oldest-first сортировка используется для списка **сохраняемых** entries. После rename нового изображения сразу вызывается prune, затем возвращается путь, который prune только что удалил.

**Доказательство:** реальные runtime glance/cache orchestration с fake image adapter: 0 и 199 валидных v2 entries → success; 200 старых entries → старые 200 сохранены, новый file отсутствует, adapter read получает ENOENT. Повторный вызов заново compresses и снова ENOENT.

**Fix:** вытеснять старейшие, а не новейшие; исключать current/in-flight file из eviction либо pin до конца операции. Regression с 200 entries и повторной обработкой; отдельно проверить byte-limit.

### R08 · P2 — Windows case alias обходят защиту от перезаписи input

**Код:** [paths.ts:614–618](<src/paths.ts#L614-L618>), commit [paths.ts:586–610](<src/paths.ts#L586-L610>), caller [runtime.ts:1572–1601](<src/runtime.ts#L1572-L1601>).

`input === output` не определяет файловую идентичность на case-insensitive NTFS. Предыдущий managed artifact `original.png` и output `ORIGINAL.png` обозначают тот же файл.

**Доказательство:** реальный crop orchestration с synthetic processing adapter заменил исходные bytes через case variant; точное совпадение имени отвергнуто и input сохранён.

**Scope:** crop, PNG annotation previews ground/detect, foreground extraction. Не trace: его SVG output не case-alias accepted image input. Output fences остаются; вне managed artifacts запись не доказана.

**Fix:** общий identity guard с платформенно корректным сравнением (`path.relative(...) === ''` закрывает показанный Windows case), canonical/file identity для существующих destinations по необходимости. Regression exact/case alias fail, distinct sibling output success.

### R09 · P2 — Vendored proxy transport расходится со стандартным OpenAI wire schema

**Код:** [vision_client.py:200–238](<vendor/agent-vision-toolkit/vision_client.py#L200-L238>). Native TS parts в [media-wire.ts:13–18](<src/media-wire.ts#L13-L18>) уже отличаются и не имеют этих же PDF/MP3 ошибок.

Реальный Python request builder формирует:

- Responses PDF: `{type:'input_file', file:{file_data,filename}}` вместо **top-level** `file_data`/`filename`.
- Chat file: `file.file_name` вместо `file.filename`.
- MP3: `input_audio.format='mpeg'` из MIME subtype вместо `'mp3'`.

**Доказательство:** вызван реальный `describe_image` с mocked urlopen; перехвачены итоговые serialized request bodies. Стандартные контракты сверены с [OpenAI file inputs](<https://developers.openai.com/api/docs/guides/file-inputs>) и [audio Chat Completions](<https://developers.openai.com/api/docs/guides/audio-chat-completions>).

**Границы:** конкретные нестандартные relay могут принимать эти формы. Это несовместимость со стандартным заявленным протоколом, а не доказательство отказа каждого relay. M4A/MP4 не засчитан как отдельный standard-OpenAI finding: поддержка format зависит от endpoint; стандартный audio guide описывает mp3/wav. Живые OpenAI requests не выполнялись.

**Fix:** top-level Responses file fields, Chat `filename`, explicit supported MIME→wire format mapping. Изменения vendored snapshot проводить по принятому upstream-sync/manifest контракту, не оставляя непроверяемый локальный fork. Regression должен валидировать schema, а не только наличие похожих полей.

### R10 · P2 — Proxy fingerprint path использует direct upload cap до автосжатия

**Код:** [media-routing.ts:52](<src/media-routing.ts#L52>), [native-media.ts:28–36](<src/native-media.ts#L28-L36>); ожидаемое сжатие [runtime.ts:1170–1185](<src/runtime.ts#L1170-L1185>).

Paste допускает images до 20 MiB и обещает runtime auto-compression. Proxy перед glance читает файл direct helper-ом, который отвергает >4 MiB по defaults; auto-compression не достигается.

**Доказательство:** валидный RGB PNG **4 917 293 bytes** принят фактическим paste backend с HTTP 201; proxy processing падает с `image exceeds the 4194304-byte direct upload limit`; glance вызван 0 раз.

**Fix:** не использовать direct wire read для proxy fingerprint. Применить runtime-authorized preprocessing или streaming digest в допустимых paste/resource bounds и дать runtime выполнить compression. Direct cap сохранить для direct mode. Regression 4–20 MiB compressible paste.

### R11 · P2 — Variant conversion запускает повторное платное описание

**Код:** [image-input-variants.ts:129–130](<src/image-input-variants.ts#L129-L130>), [image-input-variants.ts:392–402](<src/image-input-variants.ts#L392-L402>), [media-routing.ts:43–58](<src/media-routing.ts#L43-L58>).

Image-input variant создаёт path evidence с тем же magic marker. Делегированный upstream request снова проходит media-routing; оно распознаёт marker и делает второй generic glance. ALS защищает только собственный redispatch media-routing, а не делегирование variant. Разные prompts/cache keys не дедуплицируют два вызова.

**Доказательство:** полный mocked chain `vision-toolkit-local-relay` → variant → upstream media routing для одного attachment: **2 glance calls**, разные queries, обе descriptions в final request. Платная сеть не вызывалась; счётчик измеряет реальные вызовы пути.

**Fix:** единая точка projection либо проверяемая отметка уже обработанной evidence/reference. Не добавлять второй магический текстовый маркер как authority. Regression должен проверять один vision call на один cold attachment.

### R12 · P2 — Restored native Skill activation не понимает формат Host 0.2

**Код:** [exposure.ts:139–144](<src/exposure.ts#L139-L144>).

Durable `tool/result` анализируется только как старый вложенный `tool-result` block. Host 0.2 сохраняет `role:'tool'`, `toolCallId`, `isError` на message и raw content blocks.

**Доказательство:** реальный `VisionToolExposure.install` с одинаковыми session call/result fixtures: old shape регистрирует `vision_glance`; Host 0.2 shape — **0 tools**. Raw shape соответствует прочитанной установленной реализации Host, не случайно придуманному payload.

**Последствия:** при восстановлении Agent после перезапуска обычная native Skill activation из истории не восстанавливается. Живой tools/result listener и явный activation bootstrap являются обходным путём; PTC/direct Skill history обрабатываются отдельно, их общий отказ не заявляется.

**Fix:** совместимый accessor успешного tool result для обеих message shapes с проверкой callId/skill content/error. Regression на конкретный 0.2 durable shape наряду со старым.

### R13 · P2 — Startup теряет внешние Settings updates до watcher registration

**Код:** [index.ts:118–120](<src/index.ts#L118-L120>), watcher [index.ts:170–199](<src/index.ts#L170-L199>).

Initial settings читаются до длительного awaited initialization, а watch устанавливается после него. Изменение namespace в этом окне не получает listener и не сверяется повторно.

**Доказательство:** настоящий установленный DSH MemorySettings + binding + gated manager initialization: initial model `old`, update на `new` во время gate, затем initialization/watch → Settings `new`, runtime `old`.

**Границы:** custom plugin settings UI ещё не смонтирован в этом окне; воспроизведение относится к generic/external Settings/file change, особенно при slow first-run setup.

**Fix:** подписаться/буферизовать до initial read либо после подписки повторно сравнить и reconcile latest settings, прежде чем считать startup settled. Regression с deferred factory.

### R14 · P2 — Valid repair после invalid projected Settings использует invalid previous

**Код:** [settings-compat.ts:50–52](<src/settings-compat.ts#L50-L52>), [config.ts:551–552](<src/config.ts#L551-L552>), [index.ts:172–177](<src/index.ts#L172-L177>).

В projection branch `latest` обновляется до принятия runtime generation. History retention валидирует **всю** previous config. Invalid previous поэтому блокирует следующий valid next.

**Доказательство:** projected host fixture, реальные binding/preparation/manager: timeout `30000` → invalid `500` → valid repair `45000`; оба события отвергнуты одной ошибкой range, Settings `45000`, active `30000`.

**Границы:** old register branch валидирует до commit; custom Web save также валидирует candidate. Третий distinct valid update может восстановить работу, поэтому не заявляется permanent lock.

**Fix:** last accepted runtime config как retention baseline либо независимое безопасное чтение previous storage fields без проверки unrelated rejected fields. Invalid next продолжать отвергать.

### R15 · P2 — Late storage-domain binding стирает предыдущие durable roots

**Код:** [storage-history.ts:82–83](<src/storage-history.ts#L82-L83>), [storage-history.ts:119–125](<src/storage-history.ts#L119-L125>), [storage-history.ts:149–154](<src/storage-history.ts#L149-L154>).

Если domain сначала отсутствует, `persist(new)` запоминает desiredRoots, не увидев persisted old roots. После появления domain callback записывает desiredRoots поверх сохранённой history прежде, чем restore может её объединить.

**Доказательство:** persisted roots=`['/storage/old']`; startup current=`/storage/new`, absent domain → persist false; late open → durable roots только `['/storage/new']`, следующая restore не содержит old history.

**Последствия:** теряется разрешение читать ранее сохранённые media/artifact inputs после смены shared storage. Сами файлы не удаляются. POSIX-like config использован в synthetic store proof на Windows; реальный Windows shared root не включался.

**Fix:** при opening объединить существующие roots с desiredRoots (retention monotonic), затем reconcile активный runtime, чтобы late restored roots стали читаемыми без ещё одного Settings edit.

### R16 · P2 — Windows updater не запускает batch pnpm shim с пробелами

**Код:** [plugin-update.ts:938–944](<src/plugin-update.ts#L938-L944>).

`cmd.exe /d /s /c pnpmPath ...args` при default Node Windows quoting неправильно разбирает quoted shim path. Это встречается с `Program Files`/имён пользователей с пробелами.

**Доказательство:** безвредный реальный `fake-pnpm.cmd` в `space folder`: exact argv → `...\space is not recognized`, exit 1; правильно обрамлённая whole command с `windowsVerbatimArguments:true` → `SHIM_OK view`, exit 0. Просто склеенный quoted command при default quoting тоже не является достаточным fix. Существующий тест проверяет mock argv, не исполнение.

**Fix:** предпочтительно Node entry pnpm без shell, если он корректно обнаружен; иначе контролируемый launch shim с корректным cmd quoting/escaping и verbatim argv. Нынешний Host subprocess spec не предоставляет verbatim flag напрямую. Добавить реальный harmless Windows shim regression.

### R17 · P2 — Rollback сверяет disk backup с закэшированной running version

**Код:** [plugin-update.ts:989–999](<src/plugin-update.ts#L989-L999>), running version [plugin-update.ts:748–751](<src/plugin-update.ts#L748-L751>), lock preservation [plugin-update.ts:1281–1291](<src/plugin-update.ts#L1281-L1291>).

**Условие:** стабильный/hoisted install directory; manual-restart path; сначала успешное 0.1→0.2, затем повторный backend/API update до process restart, который падает после изменения install. Disk backup соответствует 0.2, constructor currentVersion ещё 0.1.

**Доказательство:** real updater с canned commands и disposable manifests/lock: первый результат manualRestartRequired; второй add падает; frozen rollback восстанавливает disk 0.2, но verifier ожидает 0.1 → `update-rollback-failed`, recovery lock остаётся. Без lockfile fallback также выбирает running version вместо backup version.

**Границы:** обычный UI хранит restart state и ограничивает повторную операцию; refresh/новый controller/backend call это состояние не делает серверным запретом. При pnpm virtual-store path identity change capability может отклонить второй вызов ещё раньше; finding относится к указанному стабильному install layout. Автоматический restart path сохраняет updating=true и не допускает повтор.

**Fix:** записывать фактическую installed version/source в backup metadata и восстанавливать/проверять именно её; либо серверно запрещать любые следующие installs до необходимого restart. Не подменять displayed running version новым disk version.

### R18 · P2 — Late Settings GET откатывает UI после успешного POST

**Код:** [index.tsx:1106–1125](<src/client/index.tsx#L1106-L1125>), [index.tsx:1134–1186](<src/client/index.tsx#L1134-L1186>), busy gate [index.tsx:1614](<src/client/index.tsx#L1614>).

Load защищён generation только относительно других loads. Save не инвалидирует старый GET. Loading не делает форму busy по текущему условию, если snapshot уже есть.

**Доказательство:** actual built controller в JSDOM: GET rev1 задержан; POST rev2 успешен; GET завершается → controller snapshot падает с revision 2 на 1. Form re-seeding по revision может заменить новый draft старым; серверная запись сама этим GET не откатывается.

**Fix:** invalidation/abort старых loads при mutation, monotonic revision checks и request ownership; regression с обеими порядками ответов. Не ограничиваться отключением кнопки — background refresh может пересекаться с save.

### R19 · P2 — Refresh verdict удаляет cached consent до проверки paste

**Код:** [paste-images.tsx:694–700](<src/client/paste-images.tsx#L694-L700>), [paste-images.tsx:889–899](<src/client/paste-images.tsx#L889-L899>).

Новая pending cache entry переносит takeOver/autoSwitch, но не sessionMedia. HandlePaste сначала обновляет entry и затем проверяет уже очищенный consent.

**Доказательство:** cached enabled=false, delayed policy refresh → PDF paste открывает confirmation, error veto не срабатывает. Negative control с сохранённым sessionMedia даёт veto и не создаёт confirmation.

**Границы:** это UI/composer admission issue; backend [media-routing.ts:37–47](<src/media-routing.ts#L37-L47>) продолжает предотвращать передачу disabled media bytes. Не считать дополнительной доказанной эксфильтрацией. R04 — другой, backend defect.

**Fix:** переносить cached sessionMedia в pending entry и применять known opt-out немедленно; refresh не должен временно повышать разрешения. Regression disabled modality + pending refresh.

### R20 · P2 — Confirmation прикрепления не привязан к видимой сессии

**Код:** [paste-images.tsx:853–869](<src/client/paste-images.tsx#L853-L869>), [paste-images.tsx:1062–1069](<src/client/paste-images.tsx#L1062-L1069>).

Controller хранит глобальный pendingConfirm. Dock текущего composer не фильтрует его по session id. При переключении A→B остаётся диалог из A, а Confirm использует захваченные sessionId/target A.

**Доказательство:** JSDOM/controller: paste в A, focus B, Confirm → chip вставлен в **A**, B пустая. Не заявляется отправка модели или автоматическая отправка сообщения.

**Fix:** pending state per session либо отмена при смене session и обязательная identity check в dock/confirm handler. Визуальная карточка должна явно соответствовать composer, который изменяет.

### R21 · P3 — In-flight upload переживает composer clear и удерживает File после завершения

**Код:** [paste-images.tsx:512–526](<src/client/paste-images.tsx#L512-L526>), [paste-images.tsx:593–607](<src/client/paste-images.tsx#L593-L607>), [paste-images.tsx:1015–1018](<src/client/paste-images.tsx#L1015-L1018>).

Pruning пропускает records во время upload, но finally не пересчитывает живые references. Host штатно начинает serialization до optimistic clear, поэтому это не только неестественный ручной сценарий.

**Доказательство:** upload started → composer cleared → upload finished: occurrences 0, records 1, listeners 1. Следующее composer event очищает records/listeners до 0.

**Границы:** не бесконечная постоянная утечка. Удерживается последняя batch (допустимый batch cap 240 MiB) до другого composer event/закрытия страницы; фактический RAM зависит от browser File representation. Не выполнялся memory stress.

**Fix:** общий prune вызывается и из subscription, и в finally после снятия inflight, с учётом detached send ownership.

### R22 · P3 — Cancel weighted queue head не будит follower при свободных permits

**Код:** [runtime.ts:206–225](<src/runtime.ts#L206-L225>), weighted caller [runtime.ts:1803–1808](<src/runtime.ts#L1803-L1808>).

OnAbort удаляет queued entry, но не выполняет drain. Следующий лёгкий запрос продолжает ждать, пока какой-либо active operation не вызовет release.

**Доказательство:** limit 3, active 1, queued head требует 3, follower требует 1; cancel head → follower pending при 2 свободных permits. Release active разблокирует. Без тяжёлого head follower запускается сразу.

**Fix:** единый drain helper вызывать из release и удаления waiter. Regression с jobs=3 OCR head и lightweight follower; не заявляется вечный deadlock — active completion восстанавливает очередь, но follower может зря дождаться timeout.

### R23 · P3 — UI-shaped provider draft теряет сохранённые metadata

**Код:** [web.ts:450–456](<src/web.ts#L450-L456>), actual payload [index.tsx:1631–1636](<src/client/index.tsx#L1631-L1636>).

Load models всегда передаёт только baseUrl/credential/protocol. Backend resolves draft from defaults, выбрасывая saved headers, sessionHeaders и custom userAgent даже при неизменённой форме.

**Доказательство:** synthetic relay требует saved routing header: normal UI-shaped draft → header отсутствует, Web 502; no-draft action → header сохранён, 200.

**Fix:** передавать полную поддерживаемую draft metadata либо накладывать draft на saved provider только при сохранении destination scope. Не переносить старые headers на новый origin по умолчанию. Regression именно на обычный UI payload.

### R24 · P3 — Read-only GitHub source проверяется через npm registry

**Код:** [plugin-update.ts:872–881](<src/plugin-update.ts#L872-L881>), [plugin-update.ts:1063–1077](<src/plugin-update.ts#L1063-L1077>).

Evaluation при W_OK failure возвращает capability без gitSource. Check затем считает source registry, несмотря на checkSupported=true для выбранного GitHub install.

**Доказательство:** synthetic fs.access EACCES, dependencySpec github:example/fork: fetch calls 0, fake pnpm view возвращает npm version 0.1.1.

**Границы:** install остаётся disabled, source replacement не выполняется. Ошибка касается версии/update availability.

**Fix:** выбирать read/check source независимо от write capability; сохранять gitSource или извлекать его из profile dependencySpec.

### R25 · P3 — Malformed Unicode output ломает доставку Artifact после открытия fd

**Код:** [paths.ts:431–446](<src/paths.ts#L431-L446>), [artifact-access.ts:247–255](<src/artifact-access.ts#L247-L255>), [artifact-access.ts:389–402](<src/artifact-access.ts#L389-L402>).

Output string с lone surrogate `\ud800.png` проходит валидацию. Content-Disposition `encodeURIComponent` бросает URIError уже после `openVerifiedArtifact`, но до close/stream setup.

**Доказательство:** synthetic resolve/write/describe/sign/HEAD: capability verifies, file открывается, URIError до ответа; normal filename → HEAD 200. Это missing deterministic close до GC; process-wide fd exhaustion не проверялся.

**Fix:** отвергать ill-formed Unicode в shared output boundary либо нормализовать header string; отдельно гарантировать close в failure path response setup. Regression malformed Unicode и forced header setup failure.

## Отдельные кандидаты — не входят в 25 confirmed findings

### C1 — Same-fingerprint activation допускает obsolete reconfigure на уровне manager

[Runtime-manager:157–162](<src/runtime-manager.ts#L157-L162>) возвращает до invalidation ticket, если активируется тот же runtime fingerprint (например, меняется hidden flag). На уровне настоящего manager класса доказано: blocked old model preparation, новая same-fingerprint explicit activation, unblock → old model и old hidden публикуются. Changed-fingerprint control old generation отвергает.

Однако реальный Web save также публикует Settings event, который может отдельно инвалидировать старый ticket. Пользовательский end-to-end interleaving с этим watcher не установлен, поэтому **не выставлен как подтверждённый production P2**. Защитный regression всё равно полезен; simplest invariant — любая authoritative activation инвалидирует pending generation.

### C2 — Replay repair восстанавливает подпись старого content/model

[Image-input-variants:568–572](<src/image-input-variants.ts#L568-L572>), shape check [590–592](<src/image-input-variants.ts#L590-L592>). Synthetic same id + тот же порядок block types, но другие reasoning/text и model → OLD_SIGNATURE восстановлена; delegated request также теряет request-identity loop marker. Доказан поведением класса, но реальный Host path с изменёнными payload при сохранённом id/shape и provider consequence не подтверждён. Нужен host-level middleware/replay regression; не считать доказанным provider failure.

### C3 — Worker timeout и преждевременный lease release

[Groq transport:266–296](<workers/moondream-openai-proxy/src/groq.ts#L266-L296>): fetch без явного AbortSignal/timeout; success lease освобождён до body.json. Статически это допускает долгий request и преждевременное освобождение occupancy при stalled body. Не выполнен контролируемый Workers/D1 hanging-body repro; влияние платформенных timeout/lease reaper не измерено. Оставлено для отдельного availability test, не как доказанный vulnerability.

## Что не является подтверждённой проблемой

- Cross-site/DNS-rebind/mismatched-Origin controls реально блокируют соответствующие requests. R01 не отменяет эти negative controls и не превращает каждый endpoint в browser CSRF.
- Arbitrary draft baseUrl/ref — штатная административная возможность model picker. Security issue возникает в сочетании с отсутствующей authentication R01, а не потому, что owner выбрал другой provider.
- Artifact HMAC/signature, bound MIME/layout/size, symlink/realpath/opened-file checks и CSP/nosniff/no-store — серьёзные рабочие ограничения. Не доказаны traversal, signature bypass, SVG-XSS или общий выход из file fence.
- Windows shared-root rejection — documented fail-closed, не ошибка само по себе. Same-size replacement preview — недостаточно для отдельного security finding при reusable output contract.
- Public Worker access key намеренно public, не «утёкший секрет». External image fetch имеет public-HTTPS/redirect/timeout/bytes/pixel fences; общий SSRF bypass не установлен.
- Теоретический short fs.write/TOCTOU без воспроизводимого нарушения не включён.
- Build/manifest consistency checks не нашли независимого version mismatch. Зелёные тесты не доказывают runtime correctness каждого edge case.

## Проверки и ограничения

| Проверка | Результат |
|---|---|
| Основной Vitest suite | **506 passed, 48 skipped**; 31 passed files, 5 skipped files |
| Worker tests | **55 passed**, 5 files; root Vitest с Worker config |
| Backend TypeScript `--noEmit` | PASS |
| Client TypeScript `--noEmit` | PASS |
| Vendored Python transport tests | `VISION CLIENT TEST PASS` |
| Vendored manifest verification, без write | PASS |
| Skill manifest/hash verification | PASS, 6 файлов |
| `git diff --check` | PASS; обычные CRLF warnings о pre-existing рабочем дереве |
| Дополнительные Web/request/catalog tests | 45/45 PASS; частично пересекаются с основным suite |
| Дополнительные settings/updater/layout tests | 86 PASS; подмножество/пересечения, не добавлять к 506 как независимые тесты |
| Assertion-based media/cache/queue/UI/update proofs | PASS с описанными positive и negative controls |

48 skips включают environment/profile acceptance cases. Не выполнены полный multi-version CI matrix, независимая Worker dependency install/typecheck/deploy dry-run, real provider/schema requests, production update/restart/rollback, POSIX filesystem race/permission tests, реальная browser heap нагрузка и полная GUI acceptance с owner authentication. Build/prepack/pack gate намеренно не запускался заново в ревью: они могут менять committed generated outputs/manifests. Read-only manifest checks выполнены отдельно.

Временные review scripts и fixture trees удалены. Зафиксированные на старте SHA-256 для package/lock/entry/native-media совпали в конце; доаудитные dirty/untracked native изменения сохранены. Единственный постоянный результат самого ревью — этот отчёт.

## Рекомендуемая последовательность исправлений

1. **Authentication и authority:** R01, R03; затем R04. Добавить настоящие no-cookie Host integration tests и forged reference/late-domain consent regressions.
2. **Секреты и HTTP bounds:** R02, R05, R06; единая redirect/error/body политика, без расширения trust scope.
3. **Сохранность и работоспособность media:** R07, R08, R09, R10, R11, R12. Проверять на 200 cache entries, Windows file aliases, schema-correct endpoints и один vision call.
4. **Settings/storage/updater:** R13–R17. Deferred initialization/binding tests, rejected generation repair, harmless Windows shim и backup-version rollback.
5. **Frontend/races и bounded cleanup:** R18–R25, затем host-level проверка C1/C2 и Workers availability repro C3.

Исправлять небольшими независимыми commits с regression-first проверкой каждого finding. Не объединять весь аудит в один большой refactor.
