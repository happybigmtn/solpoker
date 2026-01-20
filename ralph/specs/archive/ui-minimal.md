# UI Spec — Jony Ive Minimalism + Superhuman Keyboard

## UX Principles
- AC-PQ.1: The UI exhibits Jony Ive–style minimalism: restrained palette, generous whitespace, clear typography, and no decorative chrome.
- AC-PQ.2: All critical gameplay flows are usable without a mouse via keyboard-only interaction ("superhuman" style shortcuts).
- AC-PQ.3: UI feels immediate and low-latency for common actions (no visible jank during wallet connect, seat join, or action submit).

## Framework + Wallet Adapters (Latest)
- AC-1.1: UI uses Solana framework‑kit: `@solana/client` + `@solana/react-hooks` with Wallet Standard auto-discovery.
- AC-1.2: Transaction construction uses `@solana/kit` and `@solana-program/*` instruction builders (no direct web3.js usage except via compat adapter if required).
- AC-1.3: Wallet connect/disconnect is implemented via framework‑kit hooks and supports Wallet Standard compatible wallets.
- AC-1.4: Websocket endpoint is configured (explicit or derived) to support subscriptions for table/game updates.
- AC-1.5: UI uses Next.js App Router; server components fetch static/SSR data, and wallet/hooks live only in leaf client components.

## Interaction Model (Keyboard-First)
- AC-2.1: Global shortcut to open a command palette (e.g., Cmd/Ctrl+K) with actions: connect wallet, join/leave table, start hand (if host), fold/check/call/raise/shove.
- AC-2.2: Primary poker actions have single-key shortcuts when it is the player’s turn: F=fold, X=check, C=call, R=raise, S=shove.
- AC-2.3: Raise amount can be adjusted with keyboard only (e.g., +/- or arrow keys) and confirmed with Enter.
- AC-2.4: Focus is always visible; no keyboard trap; Esc closes modals/panels.

## UI Layout + States
- AC-3.1: Seat layout supports up to MAX_SEATS with clear active/inactive state and turn indicator.
- AC-3.2: Board, pot, and action history are visible without scrolling on desktop.
- AC-3.3: Mobile view prioritizes current player actions and table state without losing keyboard access (soft keyboard).
- AC-3.4: Error states and transaction states are shown inline (pending, confirmed, failed) with clear, minimal messaging.

## Data + Performance
- AC-4.1: UI subscribes to on-chain table state and only re-renders on relevant updates (no aggressive polling).
- AC-4.2: UI builds transactions client-side and surfaces simulation errors before signing where feasible.
- AC-4.3: Bundle size is minimized by avoiding unused Solana packages and by code-splitting non-critical views.
- AC-4.4: Suspense boundaries are used to avoid data-fetch waterfalls and to stream non-critical UI.
- AC-4.5: Heavy UI panels (history, stats, settings) are dynamically imported and only loaded on demand.
- AC-4.6: Large lists (50+ items) are virtualized or use `content-visibility: auto`.
- AC-4.7: Avoid barrel imports for Solana packages; import modules directly to minimize bundles.
- AC-4.8: Rendering avoids layout reads (`getBoundingClientRect`, `offset*`, `scrollTop`) during render.
- AC-4.9: Critical fonts use `font-display: swap`; external asset domains use `preconnect` when applicable.
- AC-4.10: Text inputs with rapid keystrokes (command palette) avoid heavy controlled re-renders (uncontrolled or debounced).

## Accessibility + Interaction Hygiene
- AC-5.1: All interactive elements have visible focus via `:focus-visible` and never remove outline without a replacement.
- AC-5.2: Interactive controls use semantic elements (`button`, `a`, `input`) and include `aria-label` where icon-only.
- AC-5.3: Command palette and action toasts announce updates with `aria-live="polite"` and are keyboard navigable.
- AC-5.4: A skip link to main content exists and headings are hierarchical (`h1` -> `h2` -> ...).
- AC-5.5: Motion honors `prefers-reduced-motion`; animations use `transform`/`opacity` only and avoid `transition: all`.
- AC-5.6: Hover/active/focus states increase contrast and are visually distinct.
- AC-5.7: Destructive actions (leave table, concede) require confirmation or undo.
- AC-5.8: Buttons/links provide hover and active feedback with increased contrast.
- AC-5.9: Any form input has a label and `name`/`autocomplete` set, and paste is not blocked.

## Forms & Inputs
- AC-5.10: Inputs use correct `type` and `inputmode` (email, number, tel, url as applicable).
- AC-5.11: Labels are clickable (`htmlFor` or wrapping control) and share a single hit target with checkboxes/radios.
- AC-5.12: Submit buttons stay enabled until request starts; show a spinner during requests.
- AC-5.13: Errors render inline near fields and focus the first error on submit.
- AC-5.14: Placeholders use typographic ellipses (…); spellcheck disabled for codes/emails/usernames.
- AC-5.15: `autocomplete="off"` is used on non-auth fields to avoid password manager prompts.

## Typography + Content
- AC-6.1: Numeric UI uses tabular figures (`font-variant-numeric: tabular-nums`) for stacks and pot sizes.
- AC-6.2: Headings use balanced wrapping (`text-wrap: balance` / `text-pretty`) to prevent widows.
- AC-6.3: Copy uses typographic ellipses (…); loading states end with ellipses.
- AC-6.4: Long names and addresses truncate or wrap gracefully; containers allow truncation (`min-w-0`/`line-clamp`).
- AC-6.5: Headings and primary buttons use Title Case; error messages include a next-step fix in second person.
- AC-6.6: Dates/times and numeric amounts are formatted with `Intl.DateTimeFormat` and `Intl.NumberFormat`.

## Navigation + State
- AC-7.1: URL reflects table/session and panel state for deep linking (no opaque UI state only in memory).
- AC-7.2: Navigation uses links (`<Link>`/`<a>`) and supports middle-click and Cmd/Ctrl+click.

## Touch + Safe Areas
- AC-8.1: Action buttons use `touch-action: manipulation` and intentional tap highlight styling.
- AC-8.2: Drawers/modals use `overscroll-behavior: contain` to prevent background scroll.
- AC-8.3: Full-bleed layouts respect safe areas (`env(safe-area-inset-*)`).

## Images + Assets
- AC-9.1: Any non-decorative image has explicit `width`/`height` and `alt`; decorative images use `alt=\"\"`.
- AC-9.2: Below-the-fold images are lazy-loaded.

## Hydration Safety
- AC-10.1: Inputs use `defaultValue` for uncontrolled fields or supply `onChange` when `value` is used.
- AC-10.2: Date/time rendering avoids hydration mismatches (guard server/client differences).
- AC-10.3: `suppressHydrationWarning` is only used where necessary and documented.

## Theming
- AC-11.1: If dark theme is offered, set `color-scheme` and ensure native inputs match the theme.
