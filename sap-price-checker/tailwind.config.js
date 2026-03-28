/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        sap: {
          shell:      '#1B3A5C',   // shell bar background
          blue:       '#0070F2',   // primary / links
          'blue-dk':  '#0040B0',   // pressed state
          'blue-lt':  '#EBF3FF',   // selected row tint
          bg:         '#F5F6F7',   // page background
          border:     '#D9DADB',   // default border
          'text-1':   '#1D2D3E',   // primary text
          'text-2':   '#556B82',   // secondary text
          success:    '#256F3A',
          'success-bg':'#F1FDF6',
          warning:    '#E76500',
          'warning-bg':'#FEF7F1',
          error:      '#AA0808',
          'error-bg': '#FDF4F4',
        },
      },
      fontFamily: {
        sans: ['"72"', '"72full"', 'Arial', 'Helvetica', 'sans-serif'],
      },
      boxShadow: {
        'sap-sm': '0 1px 4px rgba(0,0,0,0.12)',
        'sap-md': '0 4px 16px rgba(0,0,0,0.14)',
      },
    },
  },
  plugins: [],
}
