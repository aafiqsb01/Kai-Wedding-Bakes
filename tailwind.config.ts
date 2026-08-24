import type { Config } from 'tailwindcss';

const config: Config = {
  theme: {
    extend: {
      colors: {
        cream: '#F5F1ED',
        'warm-brown': '#8B7355',
        taupe: '#A69080',
        'dark-brown': '#7A6B5D',
      },
      fontFamily: {
        serif: [
          'var(--font-playfair)',
          'ui-serif',
          'Georgia',
          'Cambria',
          '"Times New Roman"',
          'Times',
          'serif',
        ],
      },
    },
  },
};

export default config;
