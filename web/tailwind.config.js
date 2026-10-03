/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Sora", "system-ui", "sans-serif"],
        body: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        ink: "#0a0f0b",
        pine: "#122019",
        mint: "#34d399",
        gold: "#fbbf24",
        cream: "#f5f1e8",
      },
    },
  },
  plugins: [],
};
