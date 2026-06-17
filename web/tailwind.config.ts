import type { Config } from 'tailwindcss';

// "Control Room Slate" design tokens from visual_spec.md, encoded as the Tailwind theme.
// Builder C builds the views against these tokens (and the CSS variables in index.css) — it does NOT
// introduce new colors, radii, shadows, or a second accent (visual_spec Banned List is build-blocking).
// Two calibrated surface families under one palette: `board-*` (dark instrument) and `doc-*` (lighter sheet).
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // Single radius decision — 2px everywhere (Banned List #2: nothing above 2px).
    borderRadius: {
      none: '0',
      DEFAULT: '2px',
      sm: '2px',
      md: '2px',
      lg: '2px',
      full: '9999px', // reserved for the semantic status glyphs only
    },
    extend: {
      colors: {
        // Board surface (dark instrument).
        board: {
          bg: '#0E1419',
          panel: '#161E26',
          raised: '#1E2932',
          hover: '#26323C',
          line: '#2C3A45',
          'line-light': '#3A4A55',
        },
        // Document surface (lighter reading sheet).
        doc: {
          bg: '#161B20',
          surface: '#E8EBE6',
          raised: '#F1F3EE',
          line: '#CDD3CB',
        },
        ink: {
          DEFAULT: '#0C1116',
          muted: '#46505A',
          onboard: '#E4EAEF',
          'onboard-muted': '#8B9AA6',
        },
        // The ONE accent — calibration cyan (Banned List #10: no second accent).
        accent: {
          DEFAULT: '#3FB6C9',
          press: '#2E94A4',
          deep: '#247E8C',
          ghost: 'rgba(63,182,201,0.14)',
        },
        // RAG status — step HEALTH only (Banned List #6). Always paired with a shape glyph + word in the UI.
        status: {
          green: '#27B85C',
          'green-doc': '#1B8E45',
          amber: '#E8A317',
          'amber-doc': '#B97D00',
          red: '#E5484D',
          'red-doc': '#C32B30',
          grey: '#5A6A75',
          'grey-doc': '#7A8590',
        },
        info: '#3FB6C9',
      },
      fontFamily: {
        // Neo-grotesque; Söhne intended, Inter Tight only as a constrained fallback (visual_spec type note).
        ui: ['Inter Tight Variable', 'Inter Tight', 'IBM Plex Sans', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['IBM Plex Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': '11px',
        xs: '12px',
        sm: '13px',
        base: '14px',
        md: '16px',
        lg: '20px',
        xl: '26px',
        '2xl': '34px',
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '620',
      },
      spacing: {
        // 4-base scale.
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '6': '24px',
        '8': '32px',
        '12': '48px',
      },
      lineHeight: {
        board: '1.3',
        wiki: '1.55',
      },
      letterSpacing: {
        label: '0.04em',
      },
      borderWidth: {
        DEFAULT: '1px',
        '2': '2px',
        '3': '3px',
      },
      boxShadow: {
        // The ONLY allowed elevation — the flat left-edge anchor on the right-hand overlay panel (Banned List #3).
        'panel-anchor': '0 0 0 1px #0E1419, -8px 0 24px rgba(8,12,16,0.45)',
        none: 'none',
      },
      transitionDuration: {
        feedback: '100ms',
        panel: '160ms',
        state: '180ms',
        draft: '140ms',
      },
    },
  },
  plugins: [],
};

export default config;
