<!-- kit:block mobile-common v1 -->
## Rules — Mobile (`M`)

M1. **Feature structure.** Same feature layout as the web front-end. Each feature lives in
    `features/<feature>/` under `{{scopes.mobile.path}}`: ONE root component named after the entity (`Orders.tsx`, not
    `OrdersList.tsx`), `components/` (dumb views, one component per file), `hooks/` (all
    logic and decisions), `mutations/`, `services/` (one function per endpoint, URL taken
    from the endpoint catalog), `types.ts`, `data.ts`. Screen/route files only render a
    feature root. Queries shared by features live in one shared queries folder and export
    their `*_KEY`; a feature never imports another feature (shared code moves to the app's
    shared folders). A condition that decides an amount, availability or whether an action
    is enabled is a named function in `hooks/` or `helpers/` with a test, never inline JSX.
    Why: logic in hooks and helpers runs in node tests; logic in views needs a device.
    Check: Grep `useEffect|useQuery|useMutation|fetch\(|axios|toast|Alert\.alert` in
    `features/*/components/` → 0; Grep `use(State|Effect|Query|Mutation)\(` in route/screen
    files → 0; Grep `features/` in each feature's imports → only its own folder.
M2. **Server state and user feedback.** Server data is read only through TanStack Query
    hooks from the shared queries folder; writes go through `useMutation` in `mutations/`.
    Every mutation has `onSuccess` AND `onError`; the user feedback (toast, snackbar,
    `Alert`) is emitted there and nowhere else (sole exception: the validation gate of a
    hook's `submit()`); it invalidates, with the exported `*_KEY` constants, every query
    whose data changed; and its error branch maps the API error `code` to i18n copy, never
    showing the raw server message. A notice that must be seen when a screen opens is
    rendered IN the screen, not as a toast (the toast host mounts later and drops it). A
    dialog or sheet closes only in `onSuccess`, never in `onSettled`. Why: scattered
    feedback gets lost or duplicated, and a write without invalidation leaves stale screens.
    Check: Grep `useMutation\(` outside `mutations/` → 0; Grep count of `onSuccess` and
    `onError` per file in `mutations/` → ≥ 1 each; Grep `toast|Toast\.show|Alert\.alert` in
    `components/` and `hooks/` → 0 or the submit gate; Grep (multiline)
    `onSettled[\s\S]{0,200}(close|dismiss|setOpen\(false\))` → 0.
M3. **Effects, polling and app lifecycle.** `useEffect` is the last resort and never lives
    in `components/`: derive in render, act in the event handler, read with a query
    (`enabled`, `staleTime`), write with a mutation. No network call inside an effect.
    Every poll (`refetchInterval`, `setInterval`) has a stop condition and never starts a
    tick while the previous one runs. TanStack Query is wired to the app lifecycle ONCE at
    the root: `focusManager` to `AppState` and `onlineManager` to the network state,
    because React Native has no window focus/online events and screens stay mounted for
    hours. Why: an effect with unstable dependencies refetches forever from an idle screen,
    and without focus wiring data stays stale until a cold start. Check: Grep (multiline)
    `useEffect\([\s\S]{0,800}?(fetch\(|\.get\(|\.post\(|mutate\(|mutateAsync\(|refetch\(|invalidateQueries\()`
    → 0; each `refetchInterval|setInterval\(` hit has its stop condition; Grep
    `focusManager\.|onlineManager\.` in the root providers → both present.
M4. **Secrets only in the OS secure store.** Refresh tokens, credentials and any secret
    persist only in the OS secure store (Keychain / Keystore); short-lived access tokens
    live in memory; logout deletes every secure entry and the in-memory session. Never
    AsyncStorage, MMKV, SQLite, plain files or a persisted state store for secrets. A
    secure-store read error (locked device, corrupted keystore) means "no session", never a
    crash. No token ever travels in a URL. Why: plain storage is readable from backups and
    rooted devices, and a token left after logout signs the next person in. Check: Grep -i
    `(AsyncStorage|MMKV|storage)\.(setItem|set)\([^)]*(token|secret|password|credential)` →
    0; persisted stores hold no token fields; a test asserts logout deletes the secure
    entry; Grep `[?&](token|access_token|refresh_token|id_token)=` → 0.
M5. **Only public config in the bundle.** Everything shipped in the app bundle is public:
    only variables the framework marks public get in (Expo: see `ME3`), never a secret even
    with that prefix, and keys of paid or privileged services stay on the API. All
    environment reads live in ONE config module that features import. Why: anyone can
    unpack the bundle and read every string in it. Check: Grep
    `process\.env|Constants\.expoConfig\?\.extra` outside the config module → 0; Grep -i
    `SECRET|PRIVATE|PASSWORD` in the mobile env files and build profiles → 0.
M6. **Loading, empty, error and offline states.** Every screen that shows server data
    renders four states: a skeleton while loading (gated on `isLoading`, not `isPending`,
    so a disabled query never shows an eternal skeleton), an empty state with a call to
    action, an error state with a retry, and an offline banner when the device has no
    connection. Loading or failed data is never rendered as a value (no fake `0`, no
    editable controls without data). A send button is disabled while its mutation is
    pending, and the HTTP client sets a request timeout. Why: slow and offline are normal on
    phones, and a blank or endless spinner reads as broken. Check: Grep `\.isPending` on
    queries that set `enabled:` → 0; the screen's hook spec asserts the four branches; Grep
    `timeout` in the HTTP client config → present.
M7. **Accessibility.** Every interactive element has an accessible name and role
    (`accessibilityLabel` + `accessibilityRole`, or `aria-label` + `role`), icon-only
    buttons included; selected/disabled/checked state is exposed (`accessibilityState`) and
    never conveyed by colour alone. Touch targets are at least 44×44 pt (extend small icons
    with `hitSlop`). Text follows the system font size: no `allowFontScaling={false}`, no
    fixed-height text containers, and screens survive the largest accessibility size
    without clipping (`maxFontSizeMultiplier` only with a comment saying why). Contrast
    meets WCAG AA (4.5:1 text, 3:1 large text and UI parts) in light and dark. Why: these
    are the users who cannot work around a broken control. Check: Grep
    `allowFontScaling=\{false\}` → 0; every `<(Pressable|TouchableOpacity|TouchableHighlight)`
    hit has a role and a label or text child; the builder report records a pass with the
    largest text size and a screen reader (VoiceOver / TalkBack) on the changed screens.
M8. **i18n.** Every user-visible string (alerts, toasts, accessibility labels, notification
    text and error copy included) comes from the i18n catalog through `t('namespace.key')`;
    the source locale is `{{locale.ui}}` and every key exists in every shipped locale.
    Dates, numbers and currency use `Intl` formatters with the active locale; sentences are
    interpolated, never concatenated from fragments. Why: a missing key shows the raw key to
    the user, and concatenation breaks grammar in other languages. Check: Grep (multiline)
    `[^=]>\s*[A-Za-zÀ-ÿ¡¿][^<>{}=;]*</` in `.tsx` → 0; Grep
    `(accessibilityLabel|title|placeholder|message)=["'][A-Za-zÀ-ÿ]` → 0; a test asserts the
    exact same key set in every locale file.
M9. **Design tokens only.** Colours, spacing, radii, typography and shadows come from the
    project's token source (theme file, token package or utility classes); components hold
    no hex/rgb/hsl literals, and light and dark both resolve through tokens. When `kit.json`
    `brand` is set, token values match that brand reference. Why: one-off values drift from
    the brand and break dark mode. Check: Grep `#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(` in
    `{{scopes.mobile.path}}` `.tsx` files → hits only in token/theme files; token values
    compared with the brand reference when `brand` is set.
M10. **Phone sizes, safe areas and keyboard.** Every changed screen is checked in portrait
    on a small phone (360×640 dp Android / 375×667 pt iOS) and a large phone (about
    430×932): no clipped or overlapping text, no horizontal overflow, the primary action
    reachable. Every screen root goes through the project's ONE screen wrapper, which
    applies safe-area insets with explicit edges (no hand-written status-bar padding). On
    every form the keyboard never covers the focused field or the submit action, and each
    field sets its keyboard type, autofill hint (`textContentType` / `autoComplete`) and
    return key. Why: layout bugs show up on the smallest and the largest device, and a
    covered submit button blocks the flow. Check: the builder report holds both screenshots
    (or the exact run steps and result); Grep `SafeAreaView|StatusBar\.currentHeight` outside
    the screen wrapper → 0; email, phone and number fields set `keyboardType`.
M11. **Deep links are validated input.** Every incoming URL (custom scheme, universal/app
    link, push payload) goes through ONE pure parser that accepts only the app's own scheme
    and hosts and the known routes, ignores malformed URLs without crashing, removes the
    params it consumes, and accepts one-time tokens only on the route that redeems them.
    Navigation never targets a URL taken from the link as-is. Why: a link is
    attacker-controlled input; unvalidated, it is an open redirect into the app or a token
    left in navigation history. Check: parser specs cover a foreign host, a malformed URL,
    an unknown route and a token on the wrong route; Grep
    `Linking\.(getInitialURL|addEventListener)|useURL\(` → only in the deep-link hook.
M12. **Logs and error reporting through one adapter.** Shipped code has no `console.*`
    output and never logs a token, password, request/response body or personal data.
    Crashes and handled errors go through ONE reporting module (`captureException`,
    `trackEvent`, `identify`); features never import a vendor SDK. The module scrubs
    tokens, query strings and bodies, sends ids and enums only (no names, emails or free
    text), and is a no-op without its key. A root error boundary reports and shows a screen
    with a retry. With the `observability` addon, the `OB` rules also apply. Why: device logs
    and vendor dashboards have more readers than the database, and swapping a vendor must
    not touch features. Check: Grep `console\.(log|info|debug|warn)` in the source root → 0
    or behind a dev guard; Grep
    `from ['"](@sentry/|posthog|@bugsnag|@datadog|@react-native-firebase/crashlytics)` outside
    the reporting module → 0; a spec asserts the exact set of keys the scrubber keeps.
M13. **Version contract with the API.** The client sends its app version on every request
    and checks a server-provided minimum version at start; below it, a blocking screen
    links to the store. The gate fails OPEN (malformed version or failed request → not
    blocked). Contract changes work in both directions: a field the client starts sending
    is accepted by the deployed API first; a new required field is not imposed while
    published clients that lack it are above the minimum version; a response the old
    client cannot handle uses a code it already knows. Why: published apps live for weeks
    and are not redeployed with the API. Check: the gate's spec covers older, equal, newer
    and malformed versions and a failed request; Grep the HTTP client for the version
    header; any contract change carries a `Deploy order:` line in the commit body.
M14. **Release order and delivery channel.** The API deploys before (or with) the client
    that needs it, and the client ships only after that API is live in the environment the
    client calls (a preview build that calls the production API needs the change in
    production). What changed decides delivery: JS/TS and bundled assets only →
    over-the-air update for the matching runtime; any native change (native dependency
    added, removed or upgraded, permissions, app config, SDK upgrade, runtime version) →
    new native build and a version bump. An update is never applied by reloading the app
    mid-flow: download in the background, apply on the next cold start or after a user tap.
    Why: a client that ships before its endpoint fails in production, and an OTA that needs
    native code crashes at launch. Check: the builder report states `OTA` or `native build`
    with the changed files that decided it; Grep `reloadAsync\(` → only behind a user action.
M15. **Tests assert behaviour.** Tests run with `{{testRunner.mobile}}` (Vitest by default;
    Jest only where the project already uses it). Every new file with logic (hooks,
    helpers, services, mutations, stores, parsers) has a spec written FIRST and seen
    failing; every view with a conditional has a structure or render spec asserting what
    the user gets in each branch. Specs assert outcomes (returned values, calls at the HTTP
    boundary, rendered pieces and their props), never private implementation; native
    modules are mocked once in the setup file with the library's real contract and error
    shapes. The mutation check (`G3`) passes for every new or changed rule and the `FT`
    list is walked. Why: a test that does not fail when the rule breaks proves nothing.
    Check: Glob a sibling spec for each new file in `hooks|helpers|services|mutations|stores`;
    the mobile test command in `kit.json` exits 0; the builder report has the mutation table.
M16. **Numeric input on phones.** Amount and quantity fields parse locale input: the
    decimal keypad types a comma in many locales and users paste `1.234,56`, so both
    separators parse to one canonical value, the comma is never stripped, an empty field
    is "no value" (not `0`), and out-of-range input is marked invalid, never corrected.
    Why: stripping the comma turns `5,50` into `550`. Check: parser specs with `5,50`,
    `5.50`, `1.234,56`, `1,234.56`, `""` and `abc`; Grep `\[\^\\d\.\]|\[\^0-9\.\]` → 0.
<!-- /kit:block mobile-common -->
