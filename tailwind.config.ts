import type { Config } from 'tailwindcss';

// The colour and type tokens are the team site's (singularity-frc.com), copied
// by hand so this app matches it. No gradients, no blur, no glow.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-manrope)', 'sans-serif'],
        display: ['var(--font-bricolage)', 'sans-serif'],
      },
      colors: {
        space: '#050507',
        deep: '#111118',
        paper: '#FFF8EE',
        ink: '#151515',
        arcade: {
          purple: '#6B2FD6',
          fuel: '#FFD23F',
          bumper: '#E0332B',
          sky: '#BFE3FF',
          mint: '#BFF0D2',
        },
      },
    },
  },
  plugins: [],
};

export default config;
