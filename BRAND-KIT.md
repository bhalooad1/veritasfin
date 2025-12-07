# VERITAS BRAND KIT
**Real-time truth verification for Twitter Spaces**

---

## DESIGN PHILOSOPHY
**Swiss Minimalism** - Extreme clarity, functionality over decoration, high contrast, monospace aesthetic

### Core Principles
- **Minimal**: No unnecessary elements, pure functionality
- **Monochrome**: Black and white primary, accent colors only for data
- **Geometric**: Sharp edges, no rounded corners (border-radius: 0)
- **Uppercase**: All labels and headers in uppercase
- **Monospace**: Technical, trustworthy aesthetic

---

## COLOR PALETTE

### Primary Colors
```css
--black:        #000000  /* Primary background */
--white:        #ffffff  /* Primary text, borders */
```

### Neutral Colors
```css
--grey-dark:    #1a1a1a  /* Subtle borders, dividers */
--grey-medium:  #2f3336  /* Secondary borders (deprecated - use sparingly) */
--grey-light:   #71767b  /* Secondary text, labels */
--grey-lighter: #e7e9ea  /* Hover states on white */
--grey-lightest:#d6d9db  /* Active states on white */
```

### Truth Score Colors (Bright for visibility)
```css
--score-high:      #44ff44  /* Score 7-10 (Bright green) */
--score-medium:    #ffd700  /* Score 5-6 (Gold) */
--score-low:       #ff8c42  /* Score 3-4 (Bright orange) */
--score-very-low:  #ff4444  /* Score 0-2 (Bright red) */
```

### Semantic Colors
```css
--truthful:     #00ba7c  /* Truthful count, success states */
--questionable: #dc2626  /* Questionable count, error states */
--misleading:   #f91880  /* Misleading verdict (pink) */
--unverified:   #71767b  /* Unverified/skipped content */
```

### Special UI Colors
```css
--live-dot:     #00ba7c  /* Pulsing live indicator */
--glow:         rgba(255, 255, 255, 0.3)  /* Completion glow */
```

---

## TYPOGRAPHY

### Font Stack
```css
font-family: "SF Mono", "Monaco", "Inconsolata", "Fira Code", monospace;
```

### Font Sizes
```css
--text-10: 10px  /* Labels, meta text */
--text-11: 11px  /* Secondary info, small labels */
--text-12: 12px  /* Body text, buttons */
--text-13: 13px  /* Content text, claims */
--text-14: 14px  /* Headers, emphasis */
--text-15: 15px  /* Large buttons (deprecated) */
--text-24: 24px  /* Stats numbers */
--text-36: 36px  /* Large score display */
```

### Font Weights
```css
--weight-light:   300  /* Body text, descriptions */
--weight-regular: 400  /* Default, most text */
--weight-medium:  500  /* Score pills */
--weight-semibold:600  /* Score numbers */
--weight-bold:    700  /* Special emphasis (rare) */
```

### Text Transforms
```css
text-transform: uppercase;  /* All headers, labels, buttons */
text-transform: none;       /* Content, user text only */
```

### Letter Spacing
```css
--spacing-tight:  0.02em  /* Body text */
--spacing-normal: 0.05em  /* Small labels */
--spacing-wide:   0.1em   /* Headers */
--spacing-wider:  0.15em  /* Buttons, special labels */
```

---

## UI COMPONENTS

### Borders
```css
/* Primary */
border: 1px solid #ffffff;  /* Main containers, buttons */
border: 1px solid #1a1a1a;  /* Subtle dividers */

/* Special */
border: 1px solid [score-color];  /* Truth score pills */
border-radius: 0;  /* ALWAYS - no rounded corners */
```

### Spacing
```css
/* Padding */
--padding-xs:  4px
--padding-sm:  8px
--padding-md:  12px
--padding-lg:  16px
--padding-xl:  20px
--padding-2xl: 24px
--padding-3xl: 32px

/* Standard component padding */
padding: 20px 24px;  /* Headers */
padding: 16px 0;     /* List items */
padding: 6px 12px;   /* Pills, badges */
```

### Transitions
```css
transition: all 0.2s ease;      /* Default */
transition: all 0.3s ease;      /* Slower animations */
transition: opacity 0.2s;       /* Opacity only */
transition: width 0.6s ease-out;/* Progress bars */
```

### Shadows (Minimal use)
```css
box-shadow: none;  /* Default - no shadows */
box-shadow: 0 2px 8px rgba(255, 255, 255, 0.2);  /* Hover glow */
box-shadow: 0 0 20px 2px rgba(255, 255, 255, 0.3);  /* Completion glow */
```

---

## COMPONENT PATTERNS

### Headers
- Font: 11-14px uppercase with wide letter-spacing
- Border-bottom: 1px solid #1a1a1a
- Padding: 20px 24px

### Buttons
- Background: transparent or #ffffff
- Border: 1px solid #ffffff
- Text: 12px uppercase, letter-spacing: 0.15em
- Hover: background #ffffff, color #000000

### Truth Score Pills
- Border: 1px solid [score-color]
- Background: rgba(score-color, 0.05)
- Text: Score number + "/10"
- Hover: Full color background, lift effect

### Live Indicators
- Green dot: 6px circle, shimmering animation
- Text: "LIVE" or "ANALYZING" uppercase
- Animation: shimmer 1.5s ease-in-out infinite

### Stats Display
- Large numbers: 24px
- Labels: 10px uppercase on hover
- Color coding: Green (truthful), Red (questionable)

---

## ANIMATIONS

### Shimmer (Live dot)
```css
@keyframes shimmer {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}
```

### Complete Glow
```css
@keyframes completeGlow {
  0% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
  50% { box-shadow: 0 0 20px 2px rgba(255, 255, 255, 0.3); }
  100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0); }
}
```

---

## LAYOUT PRINCIPLES

### Container Structure
- Fixed width: 320px (overlay)
- Max height: 520px
- Black background with white border
- Flex column layout

### Visual Hierarchy
1. **Primary**: White text on black (#ffffff)
2. **Secondary**: Grey text (#71767b)
3. **Emphasis**: Truth score colors
4. **Subtle**: Dark grey borders (#1a1a1a)

### Responsive Behavior
- Fixed overlay size (no responsive scaling)
- Scrollable content areas
- Text truncation for long content

---

## USAGE GUIDELINES

### DO
✓ Use uppercase for ALL labels and headers
✓ Keep borders at 1px solid
✓ Use monospace fonts exclusively
✓ Maintain high contrast (pure black/white)
✓ Use accent colors only for data visualization

### DON'T
✗ Add rounded corners (border-radius)
✗ Use gradients (except in deprecated score bars)
✗ Add shadows (except for special hover states)
✗ Use colors outside the defined palette
✗ Mix font families

---

## FILE STRUCTURE
```
/overlay.css       - Main overlay styles
/popup.html        - Extension popup styles (inline)
/content-simple.js - Component generation
/manifest.json     - Extension configuration
```

---

## VERSION
**Current Version**: 1.0
**Design System**: Swiss Minimalism
**Last Updated**: December 2024

---

*This brand kit ensures consistency across all Veritas interfaces. Always refer to this document when implementing new features or making design decisions.*