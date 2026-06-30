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
    },
  },
  plugins: [],
};
