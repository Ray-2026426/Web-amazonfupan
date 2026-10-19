import React from 'react';
import ReactDOM from 'react-dom/client';
// 样式加载顺序：Tailwind 构建产物 → 基础主题 → 暗色覆盖表
import './styles/tailwind.css';
import './index.css';
import './dark-theme.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { applyAppSettings, loadAppSettings } from './components/appSettings';

applyAppSettings(loadAppSettings());

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    {/* 兜住渲染期异常：组件抛错时给一张可读的错误卡片，而不是整页白屏 */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
