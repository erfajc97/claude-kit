<!-- kit:block mobile-expo v1 -->
## Rules — Expo React Native (`ME`)

ME1. **Expo Router routes are thin.** Routes live under the router root (`app/` or
    `src/app/`, as set by the `expo-router` plugin `root` option). Each route file
    default-exports a screen that renders one feature root (`M1`) and nothing else;
    `_layout.tsx` files only declare navigators, providers and screen options; groups
    `(name)` organise without changing URLs; dynamic segments `[param]` are read with
    `useLocalSearchParams` inside the feature hook and validated before use. No components,
    hooks or helpers live under the router root (every file there becomes a route). The root
    layout exports an `ErrorBoundary` that reports through the reporting module (`M12`),
    `+not-found.tsx` exists, and `experiments.typedRoutes` is on. Why: route files cannot be
    unit-tested, and a stray file under the root ships as a screen. Check: Glob the router
    root → only route files, `_layout.tsx` and `+*.tsx`; Grep
    `use(State|Effect|Query|Mutation)\(|fetch\(` in route files other than layouts → 0; Grep
    `export function ErrorBoundary` in the root `_layout.tsx` → 1.
ME2. **`expo-secure-store` for secrets.** `M4` is implemented with `expo-secure-store`
    (`setItemAsync`, `getItemAsync`, `deleteItemAsync`) inside ONE session module, with key
    names as constants and small values (tokens, not blobs); `getItemAsync` is wrapped so a
    keystore error resolves to `null`. `@react-native-async-storage/async-storage` holds only
    non-secret preferences (theme, locale, drafts). `expo-secure-store` is listed in the app
    config `plugins`. Why: AsyncStorage is unencrypted. Check: Grep `SecureStore\.` → only in
    the session module; Grep -i `AsyncStorage\.setItem\([^)]*(token|secret|password|session)`
    → 0; a spec with `expo-secure-store` mocked asserts logout calls `deleteItemAsync` for
    every key.
ME3. **`EXPO_PUBLIC_*` only, read statically.** App code reads only
    `process.env.EXPO_PUBLIC_<NAME>` with literal dot access, inside the config module
    (`M5`): Metro inlines only that form, so `process.env[name]` or destructuring
    `process.env` is `undefined` on the device. Values come from the EAS environment
    (development / preview / production) or the build profile `env` in `eas.json`;
    `app.config.*` may read non-public variables at build time but never copies a secret
    into `extra`, which ships in the manifest. In development, without an explicit API URL,
    the base URL derives from Metro's host (`Constants.expoConfig?.hostUri`), because
    `localhost` on a phone is the phone. Why: the bundle is public, and dynamic env access
    fails silently on device. Check: Grep `process\.env\[|=\s*process\.env\s*;` → 0; every
    Grep `process\.env\.\w+` hit in app source is `EXPO_PUBLIC_*` or `NODE_ENV`; the `extra`
    object of the app config holds no secret.
ME4. **Randomness from `expo-crypto`.** Every identifier, nonce, idempotency key, payment or
    order reference generated on the device comes from `Crypto.randomUUID()` or
    `Crypto.getRandomValues()` of `expo-crypto`; never `Math.random()`, a timestamp, or a
    global `crypto` the JS engine may not provide. Tests mock `expo-crypto` with
    `node:crypto` (same contract) in the setup file. Why: `Math.random` and time values are
    predictable and collide. Check: Grep `Math\.random\(` in non-spec source → 0 outside
    visual effects (each such hit commented); Grep `Date\.now\(\)` in builders of ids, keys
    or references → 0.
ME5. **EAS profiles and runtime version.** `eas.json` declares `cli.appVersionSource` and
    the build profiles `development` (`developmentClient: true`, internal), `preview`
    (internal, `channel: "preview"`) and `production` (store, `channel: "production"`,
    `autoIncrement: true`); each profile's `channel` is the one its updates publish to. The
    app config declares `runtimeVersion` explicitly (`{ "policy": "appVersion" }`, which
    means bumping `version` on every native change, or `{ "policy": "fingerprint" }`) and
    `updates.url`. Why: a build and an update with different runtime versions never meet,
    and an update on the wrong channel never reaches its build. Check: read `eas.json`;
    `npx expo config --type public` shows `runtimeVersion` and `updates.url`;
    `npx expo-doctor` exits 0.
ME6. **OTA with `eas update`, native change with `eas build`.** `M14` with Expo. OTA when
    only JS/TS, assets or JS-only dependencies changed:
    `eas update --channel <channel> --environment <environment> --message "<why>"`; the
    `EXPO_PUBLIC_*` values of an update come from the EAS environment named by
    `--environment` (required from SDK 55), not from `eas.json`. Native build plus a
    `version` bump when the change touches a dependency with native code or a config plugin
    (the package has `ios/`, `android/`, `app.plugin.js` or `expo-module.config.json`), the
    app config (plugins, permissions, scheme, icons, splash, intent filters, entitlements),
    `ios/` or `android/`, the Expo SDK, or `runtimeVersion`:
    `eas build --profile <profile> --platform all`. Updates download in the background
    (`Updates.fetchUpdateAsync()`) and apply on the next launch; `Updates.reloadAsync()` runs
    only after a user tap. Bad update: `eas update:rollback`. Why: an OTA that needs native
    code crashes at launch on every installed build. Check: `git diff --name-only` of the
    change against the list above, and the `ls` of each new dependency's folders, recorded in
    the builder report.
ME7. **Dependencies through the Expo installer.** Expo and React Native packages are added
    with `npx expo install <package>` (SDK-compatible version), never a hand-picked version;
    `npx expo install --check` and `npx expo-doctor` exit 0 after any dependency change. Why:
    a version outside the SDK's set builds and then crashes in native code. Check: run both
    commands; their exit codes go in the builder report.
ME8. **Lists, images and the JS thread.** Long or paginated lists render with FlashList
    (`@shopify/flash-list`) or FlatList, never `ScrollView` plus `.map()` over server data;
    rows are `React.memo` components with a stable `renderItem`, `keyExtractor` returns a
    stable id (never the index), and pagination calls the query's `fetchNextPage` from
    `onEndReached`. Images use `expo-image` with a `cachePolicy`, a `recyclingKey` inside
    lists, and a source sized close to the rendered size (thumbnails, not originals). No
    heavy synchronous work in render or during gestures (transform in the query `select` or
    on the server); animations run on the UI thread (Reanimated, or `useNativeDriver: true`).
    Why: JS-thread work drops frames and unvirtualized lists exhaust memory. Check: Grep
    `import \{[^}]*\bImage\b[^}]*\} from 'react-native'` → 0; Grep
    `key=\{(index|i|idx)\}|=>\s*String\(index\)|index\.toString\(\)` → 0 on data rows
    (fixed placeholder arrays such as skeleton rows may use the index); Grep
    `useNativeDriver:\s*false` → each hit justified; `.map(` inside a scroll container over
    query data → 0 on review.
ME9. **One scroll primitive.** Every vertical scroll container uses the project's scroll
    wrapper: ONE file in the shared UI folder that wraps `ScrollView`, and the only file with
    a raw vertical `<ScrollView>`. The wrapper sets `contentInsetAdjustmentBehavior="never"`
    (insets come from the screen wrapper, `M10`), `alwaysBounceVertical` only when a
    `refreshControl` is passed, and `keyboardShouldPersistTaps="handled"`; props the caller
    passes win. Horizontal carousels and virtualized lists are out of its scope. Why: iOS adds
    its own safe-area insets on top of the screen wrapper's (the whole safe area inside a
    modal), so screens scroll past their content and feel stuck; the bug keeps coming back
    until the fix lives in one place. Check: Grep `(^|[^\w])<ScrollView\b` in
    `{{scopes.mobile.path}}` `.tsx` files → each hit is the wrapper file, a comment, or a tag
    whose props include `horizontal` (read the whole tag); a spec covers the wrapper's
    defaults and caller overrides.
ME10. **Tests: Vitest in node, structure tests, optional Maestro.** Vitest runs with
    `environment: 'node'` (jsdom's fake `window` hides code that crashes on the device);
    native modules are mocked once in `vitest.setup.ts` with their real contract
    (`expo-constants`, `expo-secure-store`, `expo-crypto` through `node:crypto`, and any
    package published as Flow that Vite cannot parse); workspace packages are aliased to
    their source so tests run the code Metro bundles. Views get structure tests: mock the
    primitives as strings (`vi.mock('react-native', () => ({ View: 'View', Text: 'Text',
    Pressable: 'Pressable' }))`) and the hooks the view calls, call the dumb component as a
    function, walk the returned tree, and assert which pieces render with which props in each
    branch. A project already on Jest keeps `jest-expo` with `@testing-library/react-native`
    and asserts by role and text. End-to-end golden flows are optional with Maestro
    (`maestro test .maestro/`) on a development build. Why: logic tests in node are fast and
    deterministic, and a renderer-free structure test still pins what the view shows. Check:
    the Vitest config sets `environment: 'node'`; the mobile test command in `kit.json`
    exits 0; each changed view with a conditional has a structure or render spec.
ME11. **iOS and Android differences are explicit.** Platform-specific behaviour goes through
    `Platform.select` / `Platform.OS` inside hooks or helpers (each branch unit-tested with
    `Platform.OS` mocked) or through `.ios.tsx` / `.android.tsx` files with the same props.
    Known differences are handled on purpose: Android hardware back (`BackHandler` in modals
    and multi-step flows), Android edge-to-edge insets, iOS sheet presentations
    (`formSheet` / `modal`), keyboard avoidance (`padding` on iOS, `height` on Android) and
    permission prompts. Every changed screen runs on both platforms before "done", or the
    builder report names the platform not verified. Why: the platform you did not run is the
    one that breaks. Check: Grep `Platform\.OS\s*===|Platform\.select\(` in changed files →
    each branch has a spec; the builder report lists the platforms verified.
ME12. **App identity declared once.** App name, slug, scheme, bundle identifier/package,
    owner, EAS project id, update URL, web domain and store URLs are declared once (app
    config or the config module) and read from there (`Constants.expoConfig`, config module
    exports); the scheme used in code equals `expo.scheme`; feature code never repeats these
    literals. Why: a duplicated scheme or domain drifts on the next rename and links open the
    browser instead of the app. Check: Grep the scheme and domain values from the app config
    in the source root → only the config module.
ME13. **Permissions.** The app declares only the permissions it uses: iOS usage strings in
    the plugin options or `ios.infoPlist`, localized through `expo.locales`; Android
    permissions added by libraries but unused go in `android.blockedPermissions`. A
    permission is requested at the moment the feature needs it, after an in-app explanation,
    and `denied` / `blocked` leads somewhere (`Linking.openSettings()`), never to a dead end.
    Why: stores reject vague or unused permissions, and a denied prompt must not strand the
    user. Check: compare the app config permissions with Grep
    `request\w*PermissionsAsync|requestPermission` call sites; each call site's hook has a
    spec for the denied branch.
ME14. **Expo runs in its own terminal.** The dev server (`npx expo start` or the project's
    mobile dev script) runs in a separate interactive terminal opened by a person: never
    inside a task-runner pipeline (Metro needs a TTY for the QR code and key presses and dies
    when its output is piped) and never in an agent's foreground shell (it never exits). In a
    monorepo, the workspace `dev` script excludes the mobile app and a separate script starts
    it. Agents check Metro with `curl -s http://localhost:8081/status`
    (`packager-status:running`) and ask the person to start it when needed. Why: a piped or
    captured Metro hangs the session and serves nothing. Check: in a monorepo, the root
    `package.json` `dev` script excludes the mobile package and a dedicated mobile dev script
    exists.

ME15. **Styling: uniwind + Tailwind v4, tokens only.** Styles are Tailwind v4 classes through
    `uniwind` (`className` on React Native components); NativeWind only when the project
    already uses it (record it in the decisions/ADRs). One root `global.css`:
    `@import 'tailwindcss'; @import 'uniwind';`, then the UI library's theme if any, then
    the brand tokens LAST in `@theme` (in Tailwind v4 the last definition wins, so a library
    theme imported after the brand silently overrides `--color-surface` and friends). Brand
    tokens come from `{{brand}}` or the monorepo's shared design-tokens package, never
    retyped. Declare `@source` for every folder that holds classes (`app/` routes AND `src/`
    features): Tailwind only generates classes it finds, and a folder it misses renders
    screens at zero height — a blank app with no error. `metro.config.js` wraps every other
    Metro wrapper with `withUniwindConfig(...)` (outermost) and sets `dtsFile` so class
    names are typed. Components use semantic token classes (`bg-surface`, `text-text`,
    `bg-brand-500`, `rounded-card`), never hex/rgb literals or raw `StyleSheet` colors.
    Why: one token file drives web and mobile alike, and the two silent failures above
    (theme order, missing `@source`) each cost a debugging day. Check: `package.json` has
    `uniwind` and `tailwindcss@4` (and no `nativewind` unless recorded); `global.css`
    imports in that order with `@source` lines covering `app/` and `src/`; Grep
    `withUniwindConfig` in `metro.config.*` is the outermost call; Grep
    `#[0-9a-fA-F]{3,8}\b|rgba?\(` in every mobile scope's `*.tsx` → only token files.
<!-- /kit:block mobile-expo -->
