import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        mist: "#e2e8f0",
        signal: "#0f766e",
        ember: "#f97316"
      }
    }
  },
  plugins: []
} satisfies Config;

