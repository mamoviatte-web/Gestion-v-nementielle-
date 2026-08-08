/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Archivo', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Identité Provence Rugby — monochrome noir + accents olive/or
        pr: {
          black: '#0A0A0A',
          'black-soft': '#1A1A1A',
          white: '#FFFFFF',
          cream: '#F7F5F0',
          olive: '#6B7548',
          'olive-dark': '#4A5230',
          stone: '#E8E4DA',
          gold: '#C9A646',
          // Terre cuite désaturée — réservé aux alertes critiques (pas de rouge vif)
          rust: '#8A3B1F',
        },
        // Remappage de l'ancienne marque vers la nouvelle (rebranding global)
        provence: {
          DEFAULT: '#0A0A0A', // noir signature (header, sidebar, boutons)
          dark: '#1A1A1A',
          light: '#6B7548', // olive (états actifs / hover d'accent)
        },
        accent: {
          DEFAULT: '#6B7548', // olive
          dark: '#4A5230',
        },
      },
      borderRadius: {
        DEFAULT: '8px',
      },
      keyframes: {
        slideDown: {
          '0%': { opacity: '0', transform: 'scaleY(0)' },
          '100%': { opacity: '1', transform: 'scaleY(1)' },
        },
        slideUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        fadeSlideIn: {
          '0%': { opacity: '0', transform: 'translateX(-8px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        slideDown: 'slideDown 0.25s ease forwards',
        slideUp: 'slideUp 0.25s cubic-bezier(0.32,0.72,0,1) forwards',
        fadeSlideIn: 'fadeSlideIn 0.2s ease forwards',
        fadeUp: 'fadeUp 0.4s ease-out both',
      },
    },
  },
  plugins: [],
};
