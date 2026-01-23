# Poker UI Redesign Spec

## Perceptual Quality
- AC-PQ1.1: Visual tone reads as luxury brutalism with surreal touches (bold grids, refined type, restrained motion) and avoids neon crypto, cyberpunk, and skeuomorphic felt.
- AC-PQ1.2: Cards, chips, and table feel tactile and premium through depth, texture, and restrained glow.
- AC-PQ1.3: Celebratory moments are subtle and refined, not casino gaudy or noisy.

## Visual System
- AC-UI1.1: Color palette is implemented via CSS custom properties for surfaces, text, accents, and state signals.
- AC-UI1.2: Typography defines display, body, and numeric stacks with tabular numerals for chip and bet values.
- AC-UI1.3: Spacing scale and responsive grid are defined for xs/sm/md/lg with consistent gutters and margins.
- AC-UI1.4: Dark theme contrast meets WCAG AA for text and interactive elements.

## Cards and Suits
- AC-UI2.1: Card component supports face-up, face-down, revealed, folded, and winning states.
- AC-UI2.2: All 52 rank and suit combinations render correctly at sm/md/lg sizes.
- AC-UI2.3: Card back pattern avoids moire artifacts and remains legible at the smallest size.
- AC-UI2.4: Suits are distinguishable without color using shape, pattern, or icon variants.

## Table and Seats
- AC-UI3.1: Ten seat positions render correctly across breakpoints with active, dealer, and hero indicators.
- AC-UI3.2: Pot display updates within 100ms of state change with animated counter.
- AC-UI3.3: Community cards reveal with street-based stagger timing.

## Action Bar and Betting
- AC-UI4.1: Action buttons meet >=44x44pt touch targets with clear disabled states.
- AC-UI4.2: Raise control supports drag with haptic feedback and quick-bet shortcuts.
- AC-UI4.3: Keyboard shortcuts (F/X/C/R/S) work when focused and show visible focus states.

## Motion and Interaction
- AC-UI5.1: Card flips complete within 600ms; game start sequence completes within 2s.
- AC-UI5.2: Win celebration is noticeable but subtle with restrained glow.
- AC-UI5.3: All animations sustain 60fps and are interruptible by user input.
- AC-UI5.4: Reduced-motion preference disables non-essential motion while preserving state changes.

## Responsive and Touch
- AC-UI6.1: Layout adapts across xs/sm/md/lg with hero cards stacked on xs and side-by-side on sm+.
- AC-UI6.2: Action bar is fixed on mobile and respects safe-area insets.
- AC-UI6.3: Touch interactions use touch-action manipulation and avoid gesture conflicts.

## Solana Mobile Wallet UX
- AC-UI7.1: MWA connection works on Saga without QR; non-Saga devices deep-link to wallet.
- AC-UI7.2: Transaction prompts show human-readable descriptions for join, action, and leave.
- AC-UI7.3: Session-based signing reduces wallet popups during gameplay.
- AC-UI7.4: Error states provide actionable retry for failed transactions.

## Accessibility and Semantics
- AC-UI8.1: Screen reader announces key game events with aria-live for async updates.
- AC-UI8.2: Focus indicators are visible for all interactive elements; keyboard navigation covers all actions.
- AC-UI8.3: Icon-only buttons include aria-label; decorative icons are aria-hidden.
- AC-UI8.4: No content relies solely on color; color-blind mode is available in settings.

## Performance and Stability
- AC-UI9.1: Initial load is <3s on 3G with no layout shift after first paint.
- AC-UI9.2: JS bundle for table view is <200KB gz; non-critical panels are lazy-loaded.
- AC-UI9.3: UI updates are scoped to avoid full-table re-renders; memory usage is stable during extended play.
