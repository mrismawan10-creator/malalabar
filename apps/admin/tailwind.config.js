const preset = require("@malalabar/config/tailwind/preset");

/** @type {import('tailwindcss').Config} */
module.exports = {
  presets: [preset],
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: "#16308C", hover: "#0F2570" },
        surface: { hover: "#DCE5F1", "hover-active": "#C7D3E6" },
      },
    },
  },
};
