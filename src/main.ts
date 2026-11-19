import './style.css';
import { App } from './ui/App';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('缺少 #app 根节点');

try {
  new App(root);
} catch (error) {
  root.innerHTML = `
    <div class="fatal-error">
      <h1>FloorCube 暂时无法启动</h1>
      <p>${error instanceof Error ? error.message : '未知错误'}</p>
      <p>请尝试使用最新版 Chrome / Edge / Safari，或刷新页面。</p>
    </div>
  `;
}
