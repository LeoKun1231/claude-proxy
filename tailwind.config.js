/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Geist Variable', 'sans-serif'],
        mono: ['Geist Mono', 'monospace'],
      },
      colors: {
        border: "color-mix(in srgb, var(--border) calc(<alpha-value> * 100%), transparent)",
        input: "color-mix(in srgb, var(--input) calc(<alpha-value> * 100%), transparent)",
        ring: "color-mix(in srgb, var(--ring) calc(<alpha-value> * 100%), transparent)",
        background: "color-mix(in srgb, var(--background) calc(<alpha-value> * 100%), transparent)",
        foreground: "color-mix(in srgb, var(--foreground) calc(<alpha-value> * 100%), transparent)",
        primary: {
          DEFAULT: "color-mix(in srgb, var(--primary) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--primary-foreground) calc(<alpha-value> * 100%), transparent)",
        },
        secondary: {
          DEFAULT: "color-mix(in srgb, var(--secondary) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--secondary-foreground) calc(<alpha-value> * 100%), transparent)",
        },
        destructive: {
          DEFAULT: "color-mix(in srgb, var(--destructive) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--destructive-foreground) calc(<alpha-value> * 100%), transparent)",
        },
        muted: {
          DEFAULT: "color-mix(in srgb, var(--muted) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--muted-foreground) calc(<alpha-value> * 100%), transparent)",
        },
        accent: {
          DEFAULT: "color-mix(in srgb, var(--accent) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--accent-foreground) calc(<alpha-value> * 100%), transparent)",
        },
        popover: {
          DEFAULT: "color-mix(in srgb, var(--popover) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--popover-foreground) calc(<alpha-value> * 100%), transparent)",
        },
        card: {
          DEFAULT: "color-mix(in srgb, var(--card) calc(<alpha-value> * 100%), transparent)",
          foreground: "color-mix(in srgb, var(--card-foreground) calc(<alpha-value> * 100%), transparent)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
