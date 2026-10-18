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
        // 移除 Google Fonts 外链后使用系统字体栈：跨境团队常处于弱网/内网环境，
        // Inter 可用则用，否则回退到系统 UI 字体与中文黑体。
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Microsoft YaHei', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
