/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Provence Rugby — palette de marque
        provence: {
          DEFAULT: '#0a1e3c',
          dark: '#06122a',
          light: '#16345f',
        },
        accent: {
          DEFAULT: '#c8102e',
          dark: '#9c0c24',
        },
      },
    },
  },
  plugins: [],
};
