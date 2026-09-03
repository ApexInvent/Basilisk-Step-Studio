/**
 * Brand tokens shared with the Apex Invent site so the two read as one family.
 *
 * Design stance carried over unchanged: engineering datasheet. Structure comes from
 * hairline rules and alignment rather than from boxes, and corners are square by
 * default because the Apex chevron is a sharp mark that rounded cards fight.
 *
 * The app leans on this harder than a marketing site does. Almost every number on
 * screen is a measurement, a tolerance or a triangle count, so the mono face is a
 * primary typeface here and not a decorative one.
 */
export default {
  content: ['./index.html', './src/**/*.{vue,js}'],
  theme: {
    // Square by default. `rounded-full` survives for genuinely circular marks.
    borderRadius: {
      none: '0',
      DEFAULT: '0',
      sm: '0',
      md: '0',
      lg: '0',
      full: '9999px'
    },
    extend: {
      colors: {
        ink: '#1F1F21',        // window background
        pit: '#171719',        // one step below ink, for inset panels and the viewport
        surface: '#2B2B2E',    // raised panels, toolbars, table headers
        accent: {
          DEFAULT: '#02AEFC',
          hover: '#37C2FF',
          dim: '#0177A0'
        },
        // Status colours for job rows. Deliberately desaturated so a queue of twenty
        // does not turn into a christmas tree; the accent stays the loudest thing.
        state: {
          ok: '#3BA776',
          warn: '#D8A32B',
          fail: '#D0453B'
        }
      },
      fontFamily: {
        heading: ['Oswald', 'sans-serif'],
        body: ['Figtree', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace']
      }
    }
  },
  plugins: []
}
