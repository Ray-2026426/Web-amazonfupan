import React from 'react';
import ReactDOM from 'react-dom/client';
// 样式加载顺序：Tailwind 构建产物 → 基础主题 → 暗色覆盖表
import './styles/tailwind.css';
import './index.css';
import './dark-theme.css';
import App from './App';
import { applyAppSettings, loadAppSettings } from './components/appSettings';

applyAppSettings(loadAppSettings());

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);