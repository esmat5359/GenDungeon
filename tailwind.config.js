/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        basalt: {
          950: "#080c0e",
          900: "#0d1316",
          800: "#131b1f",
          700: "#1b262b",
          600: "#27353b",
          500: "#3a4b52",
        },
        verdigris: {
          300: "#8fe0cd",
          400: "#5fc7b0",
          500: "#3fae97",
          600: "#2c8a77",
          700: "#1f6658",
        },
        ember: {
          300: "#ffc58a",
          400: "#ffa24d",
          500: "#f08a3c",
          600: "#cf6d22",
          700: "#9c4e14",
        },
        vellum: {
          DEFAULT: "#ece2c8",
          dim: "#cfc3a3",
          shade: "#b9aa86",
        },
        oxblood: {
          400: "#d4695b",
          500: "#b3473b",
          600: "#8c3329",
        },
        ink: "#2a2418",
      },
      fontFamily: {
        display: ['"IM Fell English"', "Georgia", "serif"],
        body: ['"Hanken Grotesk Variable"', "system-ui", "sans-serif"],
      },
      keyframes: {
        rise: { "0%": { opacity: "0", transform: "translateY(14px)" }, "100%": { opacity: "1", transform: "none" } },
        flicker: {
          "0%,100%": { opacity: "0.9" },
          "40%": { opacity: "1" },
          "60%": { opacity: "0.78" },
        },
        sweep: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        rise: "rise 0.6s cubic-bezier(0.2,0.7,0.2,1) both",
        flicker: "flicker 3.2s ease-in-out infinite",
        sweep: "sweep 2.4s linear infinite",
      },
    },
  },
  plugins: [],
};
