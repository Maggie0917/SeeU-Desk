import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#25313A",
        moss: "#60717B",
        leaf: "#FD6D2E",
        paper: "#FAEDD1",
        line: "#F0D7B5",
        coral: "#FD6D2E",
        sky: "#1387C0",
        aqua: "#E7F4FA",
        sun: "#FAEDD1"
      },
      boxShadow: {
        soft: "0 18px 45px rgba(37, 49, 58, 0.10)"
      }
    }
  },
  plugins: []
};

export default config;
