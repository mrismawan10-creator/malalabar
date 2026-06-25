# Design Tokens — QR Restaurant Ordering System

| Field | Detail |
|---|---|
| Version | 1.0 |
| Direction | Playful street-food neo-brutalism (locked from customer artifact) |
| Companion to | CLAUDE.md, Build_Plan.md (every frontend task reads this), Data_Model.md (`SystemSettings.primaryColor`) |
| Authoritative for | `packages/config` Tailwind preset + global CSS variables |

Every value here is either **extracted** directly from the locked customer artifact (exact, from code) or **derived** to fill a gap the artifact did not show. Derived values are tagged `[derived]` so they can be corrected by the designer without touching extracted truth. Build the Tailwind preset and CSS variables in `packages/config`; all three apps consume them.

The visual DNA is one thing applied at **three intensities**: Customer (full character), KDS (readability first), Admin (calm and dense). §7 is the intensity map — do not apply customer styling wholesale to admin or KDS.

---

## 1. Visual DNA (the signature)

- **Navy is the hero.** Deep navy ink and lines on bright sky-blue and white gradient surfaces.
- **One accent, repeated.** A single bright accent (yellow) recurs on promos, the add button, and primary CTAs. Restraint is the point; do not introduce competing accents.
- **Hard offset shadows, zero blur.** `Npx Npx 0 navy`. This is the most recognizable trait. Never soft/blurred shadows in customer or KDS.
- **Thick navy borders.** 2.5–3px solid navy outline the cards, buttons, badges.
- **Press-down interaction.** Active state translates the element by its shadow offset and shrinks the shadow, so it physically "presses".
- **Playful rotation** on stickers/badges (customer only), a few degrees off-axis.

---

## 2. Color tokens

### 2.1 Navy (ink, borders, shadows) — extracted
| Token | Hex | Role |
|---|---|---|
| `ink` | `#16308C` | Primary navy: brand, headings, header bg, strong buttons |
| `ink-line` | `#14296E` | Default border + hard-shadow color (the signature) |
| `ink-strong` | `#0F2570` | Deepest navy: borders/shadows on navy elements |
| `ink-muted` | `#173BA6` | Secondary text, labels |
| `ink-soft` | `#5B7BB0` | Body/description text |

### 2.2 Surfaces & sky — extracted
| Token | Hex | Role |
|---|---|---|
| `surface-page` | `#E7F4FF` | App background |
| `surface-raised` | `#FFFFFF` | Card surface |
| `surface-sunken` | `#EAF6FF` | Image slot / inset surface |
| `surface-line` | `#C7E4FA` | Subtle divider (non-signature) |
| `sky-1` | `#7FC2F1` | Gradient stop (top) |
| `sky-2` | `#B6DFFA` | Gradient stop (mid) |
| `sky-3` | `#E7F4FF` | Gradient stop (bottom) |

Page gradient: `linear-gradient(180deg, #7FC2F1 0%, #B6DFFA 48%, #E7F4FF 100%)`.

### 2.3 Accent — extracted, themeable
| Token | Hex | Role |
|---|---|---|
| `accent` | `#FFD23D` | Yellow accent: promo tags, add button, primary CTA fill. **Themeable** via `SystemSettings.primaryColor` (see §6) |
| `accent-ink` | `#E2A400` | Dark yellow for **yellow text on white** (the bright yellow fails contrast as text — never use `accent` for text on light) |

### 2.4 Secondary decorative — extracted (your pink)
| Token | Hex | Role |
|---|---|---|
| `pop` | `#FF8FB8` | Bubblegum pink: **decorative second accent only** (badge/tag variety, e.g. "NEW", "SPICY"). Not a semantic color |
| `pop-ink` | `#D45C86` | `[derived]` darker pink for pink text on white if ever needed |

### 2.5 Semantic status — `[derived]`, tuned to sit with navy
| Token | Hex | Role | Note |
|---|---|---|---|
| `success` | `#2E9E5B` | Confirmations, paid | `[derived]` |
| `success-ink` | `#1F7A45` | Success text/border | `[derived]` |
| `warning` | `#FFD23D` | Mild caution; KDS 10-min state | = accent yellow (intentional reuse) |
| `warning-ink` | `#E2A400` | Warning text | = accent-ink |
| `danger` | `#E5484D` | Errors; KDS 20-min urgency | `[derived]` — **this is the red. Pink does not take this role** |
| `danger-ink` | `#C13438` | Danger text/border/shadow | `[derived]` |

> Why a separate red exists: danger/urgency is functional, not decorative. KDS overdue cards and admin form errors must read as alarm from distance and at a glance. Pink reads as playful and under-alarms. If you override this, override `danger` knowingly.

### 2.6 Disabled / sold-out — extracted
| Token | Hex | Role |
|---|---|---|
| `muted-bg` | `#DCE5F1` | Disabled control bg |
| `muted-border` | `#A6B8D6` | Disabled border |
| `muted-text` | `#9BABC7` | Disabled glyph/text |
| `muted-shadow` | `#CFDBEC` | Soft shadow on disabled card |
| `soldout-card` | `#EEF3F9` | Sold-out card bg |
| `soldout-name` | `#7C8BA8` | Sold-out item name |
| `soldout-text` | `#9AA9C2` | Sold-out desc/price |

### 2.7 Accessibility — safe text combos (enforce)
- Navy `#16308C` on white/sky → **pass** (use for all body/heading).
- White on navy `#16308C` → **pass** (headers, strong buttons).
- Navy on `accent` yellow → **pass** (the CTA: navy ink on yellow fill).
- `accent` yellow as **text** on white → **fail**: use `accent-ink` `#E2A400` instead.
- `pop` pink and `accent` yellow as text on white → low contrast: decorative fills only, navy ink on top.
- `danger` `#E5484D` on white → pass for text; white on `danger` → pass for badges.

---

## 3. Typography

### 3.1 Families — extracted (all Google Fonts, free)
| Token | Family | Use |
|---|---|---|
| `font-display` | **Anton** (400 only) | Big brand, large numbers, section titles. All-caps feel. Customer + KDS table numbers |
| `font-ui` | **Fredoka** (400/500/600/700) | All UI and body text everywhere |
| `font-script` | **Caveat** (600/700) | Handwritten taglines. **Customer only** — never admin/KDS |

> Correction from artifact: some nodes set Fredoka `font-weight:800`. Fredoka tops out at **700**; 800 silently clamps. Cap weights at 700.

### 3.2 Scale
Base 16px. The artifact's body runs 12.5–14px; **NFR requires ≥16px for customer body and all inputs** (also prevents iOS input zoom). Reconciliation: bump core body to 16px for customer; keep small labels/badges below that only for non-essential micro text.

| Token | Size | Line | Typical use |
|---|---|---|---|
| `text-micro` | 11px | 1.2 | Badge/tag text (`pop`/`accent` fills) |
| `text-xs` | 12px | 1.3 | Captions, meta chips |
| `text-sm` | 13px | 1.35 | Secondary labels |
| `text-base` | 16px | 1.45 | **Body default + all inputs** (raised from artifact 14) |
| `text-lg` | 18px | 1.25 | Item name, list emphasis |
| `text-xl` | 21px | 1.2 | Primary CTA label |
| `text-2xl` | 25px | 1.1 | Section heading (Anton) |
| `text-display` | 48px | 1.0 | Page hero (Anton) |
| `text-hero` | 76px | 0.9 | Landing brand (Anton, customer only) |

KDS overrides up the floor (§7): nothing below `text-base`, card titles at `text-2xl`.

---

## 4. Spacing, radius, borders, shadows

### 4.1 Spacing — 4px base
Artifact uses organic 10/11/12/15; normalize to the nearest step.
`space-1 4 · space-2 8 · space-3 12 · space-4 16 · space-5 20 · space-6 24 · space-8 32`
Card padding → `space-3`; common gaps → `space-2`/`space-3`; section padding → `space-5`/`space-6`.

### 4.2 Radius — extracted
`radius-sm 8 · radius-md 12 · radius-lg 14 · radius-xl 18 · radius-2xl 22 · radius-full 9999`
Cards → `2xl`; CTA & cart bar → `xl`; small buttons/tabs → `md`/`lg`; chips → `sm`; pills → `full`.

### 4.3 Borders
| Profile | Width | Color |
|---|---|---|
| Customer | 2.5–3px | `ink-line` (`#14296E`) |
| KDS | 2.5–3px | `ink-line` (keep — aids legibility) |
| Admin | 1–1.5px | `surface-line` / `muted-border` for structure, `ink-line` only for emphasis |

### 4.4 Shadows — extracted signature (hard, zero blur)
| Token | Value | Use |
|---|---|---|
| `shadow-hard-sm` | `2px 2px 0 #14296E` | Small buttons, tabs |
| `shadow-hard` | `3px 3px 0 #14296E` | Badges, medium controls |
| `shadow-hard-md` | `4px 4px 0 #14296E` | Cards |
| `shadow-hard-lg` | `5px 5px 0 #14296E` | CTA, hero image, cart bar |
| `shadow-soft-disabled` | `4px 4px 0 #CFDBEC` | Sold-out/disabled cards |

On navy-filled elements use `#0F2570` as the shadow color instead of `#14296E`.

### 4.5 Interaction (press-down) — extracted pattern
Active/pressed state: `transform: translate(<offset>, <offset>); box-shadow: <reduced>`. Example for a `shadow-hard-lg` button: active → `translate(3px,3px)` + `2px 2px 0`. Hover (desktop/admin): subtle lift, no rotation. Respect `prefers-reduced-motion`: drop the translate, keep the shadow change.

### 4.6 Rotation — extracted, customer-only
Decorative tilt for stickers/badges: `-4deg … 3deg`. Tokens `rotate-sticker-a (-2deg)`, `rotate-sticker-b (3deg)`, `rotate-sticker-c (-4deg)`. **Admin and KDS: 0deg always.**

---

## 5. Core components (customer baseline)

| Component | Spec |
|---|---|
| **Button / primary (accent)** | `accent` fill, `ink` text, `ink-line` 2.5px border, `radius-xl`, `shadow-hard-lg`, press-down. The "Mulai Pesan" / main CTA |
| **Button / strong (navy)** | `ink` fill, white text, `ink-strong` border + shadow, `radius-xl`. The cart bar / confirm actions |
| **Button / add (+)** | 40×40, `accent` fill, `ink` glyph 24px, `radius-md`, `shadow-hard-sm`, press-down |
| **Button / disabled** | `muted-bg`, `muted-border`, `muted-text`, **no shadow**, `not-allowed` |
| **Tab / pill** | active = `ink` fill + white text; inactive = white + `ink-muted` text; 2.5px border, `radius-lg`, `shadow-hard` |
| **Card / menu** | white, 3px `ink-line` border, `radius-2xl`, `shadow-hard-md` |
| **Card / sold-out** | `soldout-card` bg, `muted-border`, `shadow-soft-disabled`; image greyscale+opacity; price strike-through; navy "HABIS" sticker with white border |
| **Badge / promo-tag** | `accent` (or `pop` for variety) fill, `ink` text 11px/700, `radius-sm`, slight rotation (customer) |
| **Qty chip** | `surface-page` bg, 2px `ink-line` border, `radius-sm`, navy text |
| **Cart bar** | sticky bottom, `ink` fill, `shadow-hard-lg`, `accent` chip inside showing total |
| **Input / field** `[derived]` | white bg, 2px `ink-line` border (customer) or 1.5px (admin), `radius-md`, 16px text, focus ring = 3px `accent` at 40% + `ink-line` border. Error state = `danger` border + `danger-ink` helper text |
| **Select / dropdown** `[derived]` | same frame as input; chevron in `ink-muted` |
| **Modal / drawer** `[derived]` | white, `radius-2xl` top corners (drawer) or all (modal), 3px `ink-line`, `shadow-hard-lg`; backdrop navy at 35% |

Copy voice (from frontend-design guidance): active, plain, sentence case, consistent verbs through a flow ("Bayar" → "Pembayaran berhasil"). Errors state what happened and how to fix, in the interface's voice, never an apology.

---

## 6. Theming: accent ↔ `SystemSettings.primaryColor`

The accent is **not** a dead hex. It is a CSS variable defaulting to `#FFD23D`, overridden at runtime from `SystemSettings.primaryColor` (Superadmin-configurable, Data_Model §3.8). The artifact's own three-accent enum (yellow/pink/lime) is the proof this was always meant to be swappable.

```css
:root{
  --accent: #FFD23D;        /* overridden from SystemSettings.primaryColor */
  --accent-ink: #E2A400;    /* recompute a readable dark variant when accent changes */
  --ink: #16308C;
  --ink-line: #14296E;
  --ink-strong: #0F2570;
  --surface-page: #E7F4FF;
  --surface-raised: #FFFFFF;
  --danger: #E5484D;
  --success: #2E9E5B;
}
```

The app injects `--accent` from settings on load. When a custom accent is set, derive a readable `--accent-ink` (darkened) so text-on-white stays legible — do not assume the custom color passes contrast. If it can't, fall back text to `ink`.

---

## 7. Three intensity profiles (do not skip)

| Axis | Customer | KDS | Admin |
|---|---|---|---|
| Goal | Warm, appetizing, characterful | Readable at 2m in a busy kitchen | Calm, dense, sustained desktop use |
| Borders | 2.5–3px navy | 2.5–3px navy (keep) | 1–1.5px subtle |
| Shadows | Full hard offset | Hard offset (keep, aids scanning) | Subtle 1px or none on dense elements |
| Radius | `lg`–`2xl` | `lg`–`xl` | `sm`–`md` |
| Rotation | Yes (stickers) | None | None |
| Display font | Anton + Caveat | Anton for table #/numbers; no Caveat | None for data; Fredoka only |
| Min text | 16px body | **18px floor**, card titles 25px+ | 14px acceptable (dense tables) |
| Decoration | Clouds, sunburst, tilt | **None** — strip all ambient art | None |
| Color emphasis | Accent + photos | **Urgency colors dominate**: normal/`warning` 10min/`danger` 20min | Status colors only where meaningful |

KDS specifics: card urgency uses border + header tint — normal navy, `warning` `#FFD23D` after 10 min, `danger` `#E5484D` after 20 min. Audio ding on new card. Everything optimized for glance-reading, not beauty.

Admin specifics: tables and forms are the workhorse. Inherit palette + Fredoka + the border/shadow *language* dialed down. No hard shadows on table rows; reserve `accent` for primary actions only, not decoration. Long-session comfort beats character here.

---

## 8. Tailwind preset (`packages/config`)

```js
// packages/config/tailwind-preset.js
module.exports = {
  theme: {
    extend: {
      colors: {
        ink:        { DEFAULT: '#16308C', line: '#14296E', strong: '#0F2570', muted: '#173BA6', soft: '#5B7BB0' },
        surface:    { page: '#E7F4FF', raised: '#FFFFFF', sunken: '#EAF6FF', line: '#C7E4FA' },
        sky:        { 1: '#7FC2F1', 2: '#B6DFFA', 3: '#E7F4FF' },
        accent:     { DEFAULT: 'var(--accent, #FFD23D)', ink: 'var(--accent-ink, #E2A400)' },
        pop:        { DEFAULT: '#FF8FB8', ink: '#D45C86' },          // decorative only
        success:    { DEFAULT: '#2E9E5B', ink: '#1F7A45' },          // [derived]
        warning:    { DEFAULT: '#FFD23D', ink: '#E2A400' },
        danger:     { DEFAULT: '#E5484D', ink: '#C13438' },          // [derived]
        muted:      { bg: '#DCE5F1', border: '#A6B8D6', text: '#9BABC7', shadow: '#CFDBEC' },
        soldout:    { card: '#EEF3F9', name: '#7C8BA8', text: '#9AA9C2' },
      },
      fontFamily: {
        display: ['Anton', 'sans-serif'],
        ui:      ['Fredoka', 'sans-serif'],
        script:  ['Caveat', 'cursive'],
      },
      fontSize: {
        micro: ['11px', '1.2'], xs: ['12px', '1.3'], sm: ['13px', '1.35'],
        base: ['16px', '1.45'], lg: ['18px', '1.25'], xl: ['21px', '1.2'],
        '2xl': ['25px', '1.1'], display: ['48px', '1.0'], hero: ['76px', '0.9'],
      },
      borderRadius: { sm: '8px', md: '12px', lg: '14px', xl: '18px', '2xl': '22px' },
      borderWidth: { 3: '3px' },
      boxShadow: {
        'hard-sm': '2px 2px 0 #14296E',
        'hard':    '3px 3px 0 #14296E',
        'hard-md': '4px 4px 0 #14296E',
        'hard-lg': '5px 5px 0 #14296E',
        'hard-navy-lg': '5px 5px 0 #0F2570',
        'soft-disabled': '4px 4px 0 #CFDBEC',
      },
      spacing: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 8: '32px' },
    },
  },
};
```

Load the three fonts once (preconnect + the Google Fonts link from the artifact). Each app extends this preset; KDS and Admin apply the §7 overrides through their own utility usage, not by forking the tokens.

---

## 9. What is locked vs open

- **Locked (extracted):** navy ink family, sky/surface palette, accent yellow, pink as decoration, hard-shadow signature, thick borders, radius/spacing scale, the three fonts, all core component styles.
- **Open (`[derived]`, your call to keep or adjust):** `danger` red, `success` green, `pop-ink`, input/select/modal styling, and every value the customer artifact never showed. Correct any derived value and the preset updates in one place.
- **Not designed yet:** tracking, bill, and receipt screens. They inherit this DNA at customer intensity; the build will derive them from these tokens unless you explore them separately first.
