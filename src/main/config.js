const fs = require('fs');
const path = require('path');
const os = require('os');

// 默认配置
const DEFAULT_CONFIG = {
  // 预览文本长度
  previewLength: 120,
  // 是否使用自定义工具提示
  useCustomTooltip: false,
  // 粘贴快捷键
  pasteShortcut: 'numbers',
  // 全局快捷键
  globalShortcut: 'CommandOrControl+Alt+V',
  // 截图快捷键
  screenshotShortcut: 'CommandOrControl+Shift+S',
  // 主题
  theme: 'light'
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
    this.config = this.load();
  }

  // 加载配置
  load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
      }
    } catch (error) {
      console.error('加载配置文件失败:', error);
    }
    return { ...DEFAULT_CONFIG };
  }

  // 保存配置
  save() {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      return true;
    } catch (error) {
      console.error('保存配置文件失败:', error);
      return false;
    }
  }

  // 获取配置项
  get(key) {
    return this.config[key];
  }

  // 设置配置项
  set(key, value) {
    this.config[key] = value;
    return this.save();
  }

  // 批量设置配置项
  setMany(values) {
    Object.assign(this.config, values);
    return this.save();
  }

  // 获取所有配置
  getAll() {
    return { ...this.config };
  }
}

// 导出单例
module.exports = new Config();
