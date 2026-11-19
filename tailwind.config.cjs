/** @type {import('tailwindcss').Config} */
module.exports = {
  // 由 html.dark 控制，而不是跟随系统偏好：index.html 的启动脚本会先写入类名。
  darkMode: 'class',
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './utils/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        // Apple × Kairo 系统字体栈：无需外部字体加载，弱网/内网零白屏
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"PingFang SC"',
          '"Microsoft YaHei"',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        canvas: {
          DEFAULT: '#f5f5f7',
          soft: '#fafafa',
          inset: '#f8f9fb',
          dark: '#111318',
          cardDark: '#191c24',
        },
        ink: {
          DEFAULT: '#1d1d1f',
          secondary: '#424245',
          tertiary: '#86868b',
          muted: '#aeaeb2',
          faint: '#c7c7cc',
        },
        brand: {
          DEFAULT: '#4f46e5',
          strong: '#4338ca',
          soft: '#eef2ff',
          accent: '#8b5cf6',
        },
      },
      borderRadius: {
        card: '24px',
      },
    },
  },
  plugins: [],
};
