const { ipcRenderer } = require('electron');

class RendererManager {
  constructor() {
    this.currentHistory = [];
    this.historyList = document.getElementById('historyList');
    this.searchInput = document.getElementById('searchInput');
    this.screenshotBtn = document.getElementById('screenshotBtn');
    this.testPasteBtn = document.getElementById('testPasteBtn');
    // preview length for text items (can be adjusted)
    this.previewLength = 120;
    this.useCustomTooltip = false;
    this.useNumberShortcuts = true;
    this.pasteShortcut = 'numbers'; // 'numbers' or 'ctrl-quote'

    // settings UI elements (将在DOM加载完成后初始化)
    this.settingsBtn = document.getElementById('settingsBtn');
    this.settingsOverlay = null;
    this.previewLengthInput = null;
    this.customTooltipToggle = null;
    this.numberShortcutsToggle = null; // 添加数字快捷键开关元素
    this.saveSettingsBtn = null;
    this.closeSettingsBtn = null;

    // tooltip element
    this._tooltip = null;

    this.settingsOpen = false;
    this.currentPasteIndex = 0;

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.setupIpcListeners();

    // 页面加载完成后获取历史记录和设置
    document.addEventListener('DOMContentLoaded', () => {
      console.log('DOM 加载完成，请求历史记录');
      ipcRenderer.send('get-history');

      // 初始化设置界面元素引用
      this.initializeSettingsElements();

      // load settings
      ipcRenderer.invoke('get-settings').then(cfg => {
        console.log('获取设置 ipcRenderer.invoke:', cfg);
        if (cfg && cfg.previewLength) this.previewLength = cfg.previewLength;
        if (cfg && typeof cfg.useCustomTooltip !== 'undefined') this.useCustomTooltip = cfg.useCustomTooltip;
        if (cfg && typeof cfg.useNumberShortcuts !== 'undefined') this.useNumberShortcuts = cfg.useNumberShortcuts;
        if (cfg && cfg.pasteShortcut) this.pasteShortcut = cfg.pasteShortcut;
        if (this.previewLengthInput) this.previewLengthInput.value = this.previewLength;
        if (this.customTooltipToggle) this.customTooltipToggle.checked = this.useCustomTooltip;
        // 确保数字快捷键设置也被正确加载
        if (this.numberShortcutsToggle) this.numberShortcutsToggle.checked = this.useNumberShortcuts;
      }).catch(() => { });
    });
  }

  initializeSettingsElements() {
    // 获取设置界面所有元素
    this.settingsOverlay = document.getElementById('settingsOverlay');
    this.previewLengthInput = document.getElementById('previewLengthInput');
    this.customTooltipToggle = document.getElementById('customTooltipToggle');
    this.numberShortcutsToggle = document.getElementById('numberShortcutsToggle'); // 初始化数字快捷键开关元素
    this.saveSettingsBtn = document.getElementById('saveSettingsBtn');
    this.closeSettingsBtn = document.getElementById('closeSettingsBtn');

    // 重新绑定设置相关的事件监听器
    this.setupSettingsEventListeners();
  }

  setupSettingsEventListeners() {
    // settings UI
    if (this.settingsBtn) this.settingsBtn.addEventListener('click', () => this.showSettings());
    if (this.closeSettingsBtn) this.closeSettingsBtn.addEventListener('click', () => this.hideSettings());

    // cancel
    const cancelBtn = document.getElementById('cancelSettingsBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => this.hideSettings());

    if (this.saveSettingsBtn) this.saveSettingsBtn.addEventListener('click', () => {
      let v = parseInt(this.previewLengthInput.value, 10);
      if (Number.isNaN(v)) v = this.previewLength;
      // enforce min/max
      v = Math.max(20, Math.min(500, v));
      this.previewLengthInput.value = v; // 更新输入框的值
      const useTooltip = !!this.customTooltipToggle.checked;
      const useNumberShortcuts = !!this.numberShortcutsToggle.checked; // 从UI元素获取数字快捷键设置
      ipcRenderer.invoke('set-settings', { 
        previewLength: v, 
        useCustomTooltip: useTooltip,
        useNumberShortcuts: useNumberShortcuts
      }).then((res) => {
        if (res && res.success && res.config) {
          const newCfg = res.config;
          this.previewLength = newCfg.previewLength || this.previewLength;
          this.useCustomTooltip = !!newCfg.useCustomTooltip;
          this.useNumberShortcuts = !!newCfg.useNumberShortcuts;
        }
        this.hideSettings();
        // re-render to apply preview length
        this.renderHistory(this.currentHistory);
      }).catch(err => {
        console.error('保存设置失败:', err);
      });
    });

    // 点击遮罩层关闭设置界面
    if (this.settingsOverlay) {
      this.settingsOverlay.addEventListener('click', (event) => {
        // 只有点击遮罩层本身才关闭，点击设置面板不关闭
        if (event.target === this.settingsOverlay) {
          this.hideSettings();
        }
      });
    }

    // close on ESC
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.settingsOverlay && !this.settingsOverlay.hidden) {
        this.hideSettings();
      }
    });
  }

  setupEventListeners() {
    // 添加测试按钮事件监听器
    if (this.testPasteBtn) {
      this.testPasteBtn.addEventListener('click', () => {
        console.log('测试粘贴按钮被点击');
        const testItem = {
          id: Date.now(),
          type: 'text',
          content: '这是测试粘贴的内容',
          timestamp: new Date()
        };
        ipcRenderer.send('paste-item', testItem);
      });
    }

    // 搜索功能
    this.searchInput.addEventListener('input', () => {
      this.performSearch();
    });

    // 截图按钮功能
    this.screenshotBtn.addEventListener('click', async () => {
      try {
        // 启动截图功能
        const result = await ipcRenderer.invoke('start-screenshot');
        if (!result.success) {
          console.error('截图启动失败:', result.error);
        }
      } catch (error) {
        console.error('截图失败:', error);
      }
    });

    // 键盘事件监听器
    document.addEventListener('keydown', (event) => {
      // 只有在窗口可见且不在输入框中时才处理键盘事件，且设置未打开
      if (!this.settingsOpen && document.activeElement !== this.searchInput &&
        document.activeElement !== this.testPasteBtn &&
        document.activeElement !== this.screenshotBtn) {

        // 根据设置的快捷键处理粘贴
        if (this.pasteShortcut === 'numbers' && this.useNumberShortcuts && event.key >= '1' && event.key <= '9') {
          event.preventDefault();
          const index = parseInt(event.key) - 1;
          this.pasteItemByIndex(index);
        } else if (this.pasteShortcut === 'ctrl-quote' && event.ctrlKey && event.key === "'") {
          event.preventDefault();
          // 循环粘贴项目
          if (this.currentHistory.length > 0) {
            this.pasteItemByIndex(this.currentPasteIndex);
            this.currentPasteIndex = (this.currentPasteIndex + 1) % this.currentHistory.length;
          }
        }
        // 回车键和方向键不再需要处理（可保留用于未来功能）
      }
    });
  }

  setupIpcListeners() {
    // 添加 IPC 错误处理
    ipcRenderer.on('error', (event, error) => {
      console.error('IPC 错误:', error);
    });

    // 监听历史记录更新
    ipcRenderer.on('history-data', (event, history) => {
      console.log('收到历史记录数据:', history);
      this.currentHistory = history;
      this.renderHistory(history);
    });

    // 监听实时更新
    ipcRenderer.on('update-history', (event, history) => {
      console.log('收到实时更新:', history);
      this.currentHistory = history;
      this.renderHistory(history);
    });

    // 监听主进程设置变更
    ipcRenderer.on('settings-updated', (_event, updated) => {
      try {
        if (typeof updated.useNumberShortcuts !== 'undefined') {
          this.useNumberShortcuts = !!updated.useNumberShortcuts;
        }
        if (typeof updated.pasteShortcut !== 'undefined') {
          this.pasteShortcut = updated.pasteShortcut;
        }
        // re-render to show/hide shortcuts hints
        this.renderHistory(this.currentHistory);
      } catch (err) {
        console.error('Failed to apply settings-updated in rendererManager:', err);
      }
    });
  }

  // 渲染历史记录列表
  renderHistory(history) {
    if (!history || history.length === 0) {
      this.historyList.innerHTML = '<div class="empty-state">No clipboard history yet</div>';
      return;
    }

    this.historyList.innerHTML = '';
    history.forEach((item, index) => {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.dataset.id = item.id;

      // 添加数字键提示 (仅当启用了数字快捷并且索引小于9时显示)
      const shortcutHint = (this.useNumberShortcuts && index < 9) ? `<span class="shortcut-hint">${index + 1}</span>` : '';

      let contentHTML = '';
      if (item.type === 'text') {
        const displayText = this.truncateText(item.content, this.previewLength);
        const escapedFull = this.escapeHtml(item.content || '');
        contentHTML = `
          <div class="item-icon">
            <span class="text-icon">T</span>
            ${shortcutHint}
          </div>
          <div class="item-content text-content" title="${escapedFull}">
            <span class="text-preview">${this.escapeHtml(displayText)}</span>
            <button class="expand-btn" aria-label="Toggle full text">⋯</button>
          </div>
        `;
      } else if (item.type === 'image') {
        // show thumbnail if available
        const thumbPath = item.image_thumb || item.image_path || null;
        const imgTag = thumbPath ? `<img class="history-thumb" src="file://${thumbPath}" alt="thumb">` : `<span class="image-icon">I</span>`;
        contentHTML = `
          <div class="item-icon">
            ${imgTag}
            ${shortcutHint}
          </div>
          <div class="item-content image-content">${thumbPath ? '' : '[Image]'}</div>
        `;
      }

      li.innerHTML = contentHTML;

      // 使用闭包确保正确的 item 引用
      (function (itemData, liEl, previewLen, manager) {
        // Clicking the list item triggers paste
        liEl.addEventListener('click', function () {
          console.log('点击项目:', itemData);
          ipcRenderer.send('paste-item', itemData);
        });

        // expand button toggles full preview without triggering paste
        const btn = liEl.querySelector('.expand-btn');
        if (btn) {
          btn.addEventListener('click', function (ev) {
            ev.stopPropagation();
            const contentDiv = liEl.querySelector('.text-content');
            if (!contentDiv) return;
            contentDiv.classList.toggle('expanded');
            const preview = contentDiv.querySelector('.text-preview');
            if (contentDiv.classList.contains('expanded')) {
              // show full text
              preview.textContent = itemData.content || '';
            } else {
              // show truncated preview
              const truncated = (itemData.content || '').length > previewLen ? (itemData.content || '').slice(0, previewLen - 1) + '…' : (itemData.content || '');
              preview.textContent = truncated;
            }
          });
        }
        // custom tooltip on hover for text
        const contentDiv = liEl.querySelector('.text-content');
        if (contentDiv) {
          contentDiv.addEventListener('mouseenter', function (ev) {
            if (!manager.useCustomTooltip) return;
            manager._ensureTooltip();
            manager._showTooltip(itemData.content || '', ev.pageX, ev.pageY);
          });
          contentDiv.addEventListener('mousemove', function (ev) {
            if (!manager.useCustomTooltip) return;
            manager._moveTooltip(ev.pageX, ev.pageY);
          });
          contentDiv.addEventListener('mouseleave', function () {
            if (!manager.useCustomTooltip) return;
            manager._hideTooltip();
          });
        }
      })(item, li, this.previewLength, this);

      this.historyList.appendChild(li);
    });
  }

  // 截断文本为固定长度，超出部分用省略号
  truncateText(text, maxLen = 120) {
    if (!text) return '';
    const s = String(text);
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen - 1) + '…';
  }

  // Tooltip helpers
  _ensureTooltip() {
    if (this._tooltip) return;
    const t = document.createElement('div');
    t.className = 'custom-tooltip';
    t.style.position = 'fixed';
    t.style.zIndex = 2000;
    t.style.maxWidth = '480px';
    t.style.padding = '8px';
    t.style.background = 'rgba(0,0,0,0.85)';
    t.style.color = 'white';
    t.style.borderRadius = '6px';
    t.style.whiteSpace = 'pre-wrap';
    t.style.display = 'none';
    t.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';

    const content = document.createElement('div');
    content.className = 'custom-tooltip-content';
    t.appendChild(content);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'custom-tooltip-copy';
    copyBtn.textContent = 'Copy';
    copyBtn.style.marginTop = '6px';
    copyBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const txt = content.textContent || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt);
      } else {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
    });
    t.appendChild(copyBtn);

    document.body.appendChild(t);
    this._tooltip = t;
  }

  _showTooltip(text, pageX, pageY) {
    if (!this._tooltip) this._ensureTooltip();
    const content = this._tooltip.querySelector('.custom-tooltip-content');
    content.textContent = text;
    this._tooltip.style.display = 'block';
    this._moveTooltip(pageX, pageY);
  }

  _moveTooltip(pageX, pageY) {
    if (!this._tooltip) return;
    const pad = 12;
    const w = this._tooltip.offsetWidth;
    const h = this._tooltip.offsetHeight;
    // place tooltip to the right-bottom of cursor, but keep inside window
    let left = pageX + 12;
    let top = pageY + 12;
    if (left + w + pad > window.innerWidth) left = pageX - w - 12;
    if (top + h + pad > window.innerHeight) top = pageY - h - 12;
    this._tooltip.style.left = `${Math.max(8, left)}px`;
    this._tooltip.style.top = `${Math.max(8, top)}px`;
  }

  _hideTooltip() {
    if (!this._tooltip) return;
    this._tooltip.style.display = 'none';
  }

  // 根据索引直接粘贴项目
  pasteItemByIndex(index) {
    // 检查索引是否有效
    if (index >= 0 && index < this.currentHistory.length && index < 9) {
      const itemData = this.currentHistory[index];
      console.log('通过键盘快捷键粘贴项目:', itemData);
      ipcRenderer.send('paste-item', itemData);
    }
  }

  // 转义 HTML 特殊字符
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };

    return text.replace(/[&<>"']/g, m => map[m]);
  }

  // 执行搜索
  performSearch() {
    const searchTerm = this.searchInput.value.toLowerCase();

    if (!searchTerm) {
      this.renderHistory(this.currentHistory);
      return;
    }

    const filtered = this.currentHistory.filter(item => {
      if (item.type === 'text') {
        return item.content.toLowerCase().includes(searchTerm);
      }
      return false; // 图片暂时不支持搜索
    });

    this.renderHistory(filtered);
  }

  // 转义 HTML 特殊字符
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };

    return text.replace(/[&<>"']/g, m => map[m]);
  }

  // 显示设置界面
  showSettings() {
    this.settingsOpen = true;
    // 如果已经存在，先移除
    this.closeSettings();

    // 创建 overlay
    const overlay = document.createElement('div');
    overlay.id = 'settingsOverlay';
    overlay.className = 'settings-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    overlay.style.zIndex = '1000';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';

    // 创建设置面板
    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.style.backgroundColor = 'white';
    panel.style.padding = '20px';
    panel.style.borderRadius = '8px';
    panel.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';
    panel.style.maxWidth = '400px';
    panel.style.width = '90%';

    panel.innerHTML = `
      <h3>Settings</h3>
      <div style="margin-bottom: 15px;">
        <label for="previewLengthInput">Preview Length:</label>
        <input type="number" id="previewLengthInput" min="20" max="500" value="${this.previewLength}" style="width: 100%; padding: 5px; margin-top: 5px;">
      </div>
      <div style="margin-bottom: 15px;">
        <label>
          <input type="checkbox" id="customTooltipToggle" ${this.useCustomTooltip ? 'checked' : ''}>
          Use Custom Tooltip
        </label>
      </div>
      <div style="margin-bottom: 15px;">
        <label for="pasteShortcutSelect">Paste Shortcut:</label>
        <select id="pasteShortcutSelect" style="width: 100%; padding: 5px; margin-top: 5px;">
          <option value="numbers" ${this.pasteShortcut === 'numbers' ? 'selected' : ''}>Number Keys (1-9)</option>
          <option value="ctrl-quote" ${this.pasteShortcut === 'ctrl-quote' ? 'selected' : ''}>Ctrl + '</option>
        </select>
      </div>
      <div style="display: flex; gap: 10px; justify-content: flex-end;">
        <button id="cancelSettingsBtn">Cancel</button>
        <button id="saveSettingsBtn">Save</button>
      </div>
    `;

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    // 获取元素引用
    const previewLengthInput = overlay.querySelector('#previewLengthInput');
    const customTooltipToggle = overlay.querySelector('#customTooltipToggle');
    const pasteShortcutSelect = overlay.querySelector('#pasteShortcutSelect');
    const saveSettingsBtn = overlay.querySelector('#saveSettingsBtn');
    const closeSettingsBtn = overlay.querySelector('#cancelSettingsBtn');

    // 事件监听器
    saveSettingsBtn.addEventListener('click', () => {
      let v = parseInt(previewLengthInput.value, 10);
      if (Number.isNaN(v)) v = this.previewLength;
      v = Math.max(20, Math.min(500, v));
      previewLengthInput.value = v;
      const useTooltip = !!customTooltipToggle.checked;
      const useNumberShortcuts = !!this.useNumberShortcuts;
      const pasteShortcut = pasteShortcutSelect.value;
      ipcRenderer.invoke('set-settings', { previewLength: v, useCustomTooltip: useTooltip, pasteShortcut: pasteShortcut }).then((res) => {
        if (res && res.success && res.config) {
          const newCfg = res.config;
          this.previewLength = newCfg.previewLength || this.previewLength;
          this.useCustomTooltip = !!newCfg.useCustomTooltip;
          this.pasteShortcut = newCfg.pasteShortcut || this.pasteShortcut;
        }
        this.closeSettings();
        this.renderHistory(this.currentHistory);
      }).catch(err => {
        console.error('保存设置失败:', err);
      });
    });

    closeSettingsBtn.addEventListener('click', () => this.closeSettings());

    // 点击遮罩层关闭
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        this.closeSettings();
      }
    });

    // ESC 关闭
    const escHandler = (ev) => {
      if (ev.key === 'Escape') {
        this.closeSettings();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  // 隐藏设置界面
  hideSettings() {
    console.log('隐藏设置界面');
    if (!this.settingsOverlay) {
      console.error('设置界面元素未找到');
      return;
    }
    this.settingsOverlay.hidden = true;
    this.settingsOpen = false;
  }

  // 根据索引直接粘贴项目
}

// 初始化渲染管理器
new RendererManager();

module.exports = RendererManager;