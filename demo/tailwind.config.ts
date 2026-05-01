import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        base: {
          DEFAULT: "#0d1117",
          card:    "#161b22",
          surface: "#1c2230",
          border:  "#21262d",
          muted:   "#30363d",
        },
        danger: {
          dim:    "#1f0f0f",
          DEFAULT:"#f85149",
          bright: "#ff7b72",
        },
        safe: {
          dim:    "#0f1f14",
          DEFAULT:"#3fb950",
          bright: "#56d364",
        },
        brand: {
          dim:    "#16102a",
          DEFAULT:"#8b5cf6",
          bright: "#a78bfa",
        },
        warn: {
          dim:    "#1f160a",
          DEFAULT:"#d29922",
          bright: "#e3b341",
        },
        data: "#58a6ff",   // blue — numbers / links / neutral accent
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      animation: {
        "fade-in":        "fade-in 0.25s ease-out both",
        "fade-in-up":     "fade-in-up 0.3s ease-out both",
        "slide-in-right": "slide-in-right 0.2s ease-out both",
        "drain-stripes":  "drain-stripes 1s linear infinite",
        "pulse-slow":     "pulse-slow 2.5s ease-in-out infinite",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to:   { opacity: "1" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to:   { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in-right": {
          from: { opacity: "0", transform: "translateX(6px)" },
          to:   { opacity: "1", transform: "translateX(0)" },
        },
        "drain-stripes": {
          from: { backgroundPosition: "0 0" },
          to:   { backgroundPosition: "40px 0" },
        },
        "pulse-slow": {
          "0%, 100%": { opacity: "1" },
          "50%":      { opacity: "0.4" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
