const fs = require('fs');
const path = require('path');
const os = require('os');

// 默认配置
const DEFAULT_CONFIG = {
  // 预览文本长度
  previewLength: 120,
  // 是否使用自定义工具提示
  customTooltip: false,
  // 是否启用工具提示 (如果为 false, 渲染器的 tooltip 调用会被忽略)
  enableTooltips: true,
  // 粘贴快捷键
  pasteShortcut: 'numbers',
  // 是否使用数字快捷键
  useNumberShortcuts: true,
  // 全局快捷键
  globalShortcut: 'CommandOrControl+;',
  // 截图快捷键
  screenshotShortcut: 'CommandOrControl+Alt+A',
  // 主题
  theme: 'light'
  ,
  // llms
  // llm: {
  //   apitype: 'ollama', // 'ollama' or 'openapi'
  //   model: '',
  //   triggerType: 'text', // 'text' | 'image'
  //   baseurl: '',
  //   apikey: '',
  //   prompt: '',
  //   temperature: 0.7,
  //   top_p: 0.95,
  //   top_k: 0.9,
  //   context_window: 32768,
  //   max_tokens: 32768,
  //   min_p: 0.05,
  //   presence_penalty: 1.1
  // },

  // 多个 LLM 条目，键为用户备注名 -> { model, prompt, baseurl, apikey, params..., llmShortcut }
  llms: {}
};

// 获取配置文件路径
const getConfigPath = () => {
  const userDataPath = process.env.APPDATA ||
    (process.platform === 'darwin' ?
      path.join(os.homedir(), 'Library', 'Application Support') :
      path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')));

  const appConfigPath = path.join(userDataPath, 'clipboard-god');

  // 确保目录存在
  if (!fs.existsSync(appConfigPath)) {
    fs.mkdirSync(appConfigPath, { recursive: true });
  }

  return path.join(appConfigPath, 'config.json');
};

class Config {
  constructor() {
    this.configPath = getConfigPath();
    // Log the resolved config path for debugging why saves may fail
    try {
      console.log('配置文件路径:', this.configPath);
    } catch (err) { }
    // 启动时同步加载一份到内存（主进程启动时做一次）
    this.config = this._loadSync();
    // (migration removed)
    // 用于串行化所有写入操作，避免并发写覆盖
    this._writeLock = Promise.resolve();
  }

  // 同步加载（仅在启动或强制重读时使用）
  _loadSync() {
    try {
      if (fs.existsSync(this.configPath)) {

        const data = fs.readFileSync(this.configPath, 'utf8');
        if (!data) {
          return { ...DEFAULT_CONFIG };
        }
        const jdata = JSON.parse(data);
        if (jdata) {
          return { ...DEFAULT_CONFIG, ...jdata };
        }
      }
    } catch (error) {
      console.error('加载配置文件失败:', error);
    }
    return { ...DEFAULT_CONFIG };
  }

  // 原子写入：写入临时文件然后重命名
  async _saveAtomic() {
    const tmp = `${this.configPath}.tmp`;
    const data = JSON.stringify(this.config, null, 2);
    try {
      // Log where we are about to write the config (tmp then rename)
      try { console.log('写入配置（临时）:', tmp); } catch (e) { }
      await fs.promises.writeFile(tmp, data, 'utf8');
      await fs.promises.rename(tmp, this.configPath);
      try { console.log('配置已持久化到:', this.configPath); } catch (e) { }
      return true;
    } catch (err) {
      console.error('保存配置文件失败:', err);
      // 清理临时文件（忽略错误）
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) { }
      throw err;
    }
  }

  // 将写入操作排队，确保顺序执行
  _enqueueWrite(fn) {
    const next = this._writeLock.then(() => fn());
    // 捕获错误，防止链断裂
    this._writeLock = next.catch(() => { });
    return next;
  }

  // 获取配置项（同步，从内存读取）
  get(key) {
    return this.config[key];
  }

  // 设置单个配置项（异步保存）。保留同步返回的旧API不强制，但推荐使用异步返回值
  async set(key, value) {
    this.config[key] = value;
    await this._enqueueWrite(() => this._saveAtomic());
    return true;
  }

  // 批量设置配置项并持久化，返回 Promise<{ success, config, error? }>
  async setMany(values) {
    Object.assign(this.config, values);
    try {
      await this._enqueueWrite(() => this._saveAtomic());
      return { success: true, config: { ...this.config } };
    } catch (err) {
      return { success: false, error: err.message, config: { ...this.config } };
    }
  }

  // 获取所有配置（内存快照）。如果需要强制从磁盘读取，传 forceReload = true
  getAll(forceReload = false) {
    if (forceReload) {
      this.config = this._loadSync();
    }
    return { ...this.config };
  }
}

// 导出单例
module.exports = new Config();
