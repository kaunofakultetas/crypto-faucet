/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)',
        'primary-hover': 'var(--color-primary-hover)',
        surface: 'var(--color-surface)',
        'text-body': 'var(--color-text-body)',
      },
      borderRadius: {
        md: 'var(--radius-md)'
      },
      boxShadow: {
        card: '0 2px 10px rgba(0,0,0,0.06)'
      }
    }
  },
  plugins: [],
}


