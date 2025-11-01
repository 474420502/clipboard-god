# Clipboard God Wayland 兼容性分析报告

## 项目概述

Clipboard God 是一个基于 Electron 38.3.0 的剪贴板管理应用，当前主要针对 X11 环境设计。本报告分析在 Wayland 显示服务器上运行所需的兼容性修改。

## 当前环境分析

- **当前系统**: GNOME Shell on X11 ($XDG_SESSION_TYPE=x11)
- **Electron 版本**: 38.3.0 (支持 Wayland)
- **可用工具**: xdotool (X11 工具), 缺少 wl-paste/wl-copy (Wayland 工具)

## Wayland 与 X11 的主要差异

### 1. 剪贴板机制差异
- **X11**: 使用 CLIPBOARD 和 PRIMARY 选择，支持全局剪贴板监控
- **Wayland**: 每个应用管理自己的剪贴板，通过 Wayland 协议进行数据交换

### 2. 全局快捷键差异
- **X11**: 可以通过 X11 服务器注册全局快捷键
- **Wayland**: 需要通过 Wayland 合成器注册，权限更严格

### 3. 窗口管理差异
- **X11**: 可以自由操作窗口位置、层级、焦点
- **Wayland**: 窗口管理由合成器严格控制

### 4. 截图功能差异
- **X11**: 可以直接捕获任意窗口/区域
- **Wayland**: 需要通过特定协议 (如 xdg-desktop-portal) 进行截图

## 核心模块 Wayland 兼容性分析

### 1. ClipboardManager (src/main/clipboardManager.js)

#### 当前实现问题:
- 依赖 `clipboard.watch()` API，在 Wayland 上可能不稳定
- 直接访问系统剪贴板，可能受到 Wayland 安全限制

#### 兼容性要求:
```javascript
// 需要检测 Wayland 环境
const isWayland = process.env.XDG_SESSION_TYPE === 'wayland';

// Wayland 环境下的替代方案
if (isWayland) {
  // 使用 wl-clipboard 工具作为备选
  // 实现基于轮询的剪贴板监控
  // 处理权限和安全限制
}
```

### 2. PasteHandler (src/main/pasteHandler.js)

#### 当前实现问题:
- 依赖 xdotool 进行按键模拟
- 在 Wayland 上 xdotool 无法工作
- 图片粘贴逻辑复杂，在 Wayland 上可能失败

#### 兼容性要求:
```javascript
// Wayland 环境检测
const isWayland = process.env.XDG_SESSION_TYPE === 'wayland';

// 替代方案检测函数
detectWaylandTools() {
  const tools = {
    wlCopy: this.commandExists('wl-copy'),
    wlPaste: this.commandExists('wl-paste'),
    ydotool: this.commandExists('ydotool'),
    wtype: this.commandExists('wtype')
  };
  return tools;
}

// Wayland 粘贴实现
waylandPaste(item) {
  if (item.type === 'text') {
    // 使用 wl-copy 写入文本
    return this.exec('wl-copy', [item.content]);
  } else if (item.type === 'image') {
    // 使用 wl-copy 写入图片
    return this.exec('wl-copy', ['--type=image/png', item.content]);
  }
  // 然后提示用户手动粘贴
}
```

### 3. ScreenshotManager (src/main/screenshotManager.js)

#### 当前实现问题:
- electron-screenshots 在 Wayland 上可能不工作
- desktopCapturer 在 Wayland 上权限受限
- 截图 API 在 Wayland 上行为不同

#### 兼容性要求:
```javascript
// Wayland 截图实现
async waylandScreenshot() {
  try {
    // 使用 xdg-desktop-portal
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    
    // 调用 gnome-screenshot 或 grim
    const { stdout } = await execAsync('grim -g "$(slurp)" -');
    return Buffer.from(stdout, 'binary');
  } catch (error) {
    // 回退到 electron API
    return this.electronScreenshot();
  }
}
```

### 4. TrayManager (src/main/trayManager.js)

#### 当前实现问题:
- 系统托盘在 Wayland 上的支持有限
- 某些 Wayland 合成器不支持系统托盘

#### 兼容性要求:
```javascript
// Wayland 托盘检测
checkTraySupport() {
  const isWayland = process.env.XDG_SESSION_TYPE === 'wayland';
  const hasTraySupport = !isWayland || this.hasWaylandTrayProtocol();
  
  if (!hasTraySupport) {
    // 提供替代的 UI 方案
    this.createStatusBarApplet();
    return false;
  }
  return true;
}
```

### 5. MainProcess (src/main/mainProcess.js)

#### 当前实现问题:
- 全局快捷键注册在 Wayland 上可能失败
- 窗口管理 API 在 Wayland 上受限
- 焦点管理逻辑需要调整

#### 兼容性要求:
```javascript
// Wayland 全局快捷键
registerWaylandShortcuts() {
  const shortcuts = Config.get('globalShortcut');
  
  if (process.env.XDG_SESSION_TYPE === 'wayland') {
    // 使用 Wayland 特定的快捷键注册方法
    // 可能需要用户手动配置
    this.showWaylandShortcutDialog(shortcuts);
  } else {
    // 使用原有的 X11 方法
    globalShortcut.register(shortcuts, callback);
  }
}

// Wayland 窗口管理
waylandWindowManagement() {
  // 禁用某些在 Wayland 上不工作的窗口操作
  // 调整窗口显示逻辑
  // 处理焦点限制
}
```

## 必需的依赖和工具

### Wayland 环境检测
```bash
# 环境变量检测
echo $XDG_SESSION_TYPE

# 工具可用性检测
which wl-paste wl-copy grim slurp wtype ydotool
```

### 推荐的 Wayland 工具
- **wl-clipboard**: `wl-copy`, `wl-paste` - Wayland 剪贴板工具
- **grim**: `grim` - Wayland 截图工具
- **slurp**: `slurp` - 区域选择工具
- **wtype**: `wtype` - Wayland 按键输入工具
- **ydotool**: `ydotool` - 在 /dev/uinput 上工作的输入工具

## 实现策略

### 阶段 1: 环境检测和回退机制
1. 实现 Wayland 环境检测
2. 为每个功能实现 X11/Wayland 分支
3. 添加优雅降级机制

### 阶段 2: 核心功能适配
1. 剪贴板监控适配
2. 粘贴功能重写
3. 截图功能重写
4. 快捷键注册适配

### 阶段 3: UI 和用户体验优化
1. 托盘支持检测和替代方案
2. 窗口管理调整
3. 错误处理和用户提示

### 阶段 4: 测试和文档
1. 多种 Wayland 环境测试
2. 用户文档更新
3. 安装脚本更新

## 配置和部署考虑

### 依赖检查
```javascript
// 启动时检查依赖
checkWaylandDependencies() {
  const required = ['wl-paste', 'wl-copy', 'grim', 'slurp'];
  const missing = required.filter(tool => !this.commandExists(tool));
  
  if (missing.length > 0) {
    this.showDependencyDialog(missing);
    return false;
  }
  return true;
}
```

### 安装脚本更新
```bash
# Debian/Ubuntu
sudo apt install wl-clipboard grim slurp wtype

# Fedora
sudo dnf install wl-clipboard grim slurp wtype

# Arch Linux
sudo pacman -S wl-clipboard grim slurp wtype
```

## 限制和注意事项

### Wayland 固有限制
1. **剪贴板监控**: 无法像 X11 那样实时监控，需要轮询
2. **全局快捷键**: 需要用户手动配置或使用合成器特定 API
3. **截图权限**: 需要用户授权，可能每次都需要确认
4. **窗口操作**: 受限较多，某些 UI 效果无法实现

### 用户体验影响
1. 首次运行时的权限请求
2. 功能降级时的用户提示
3. 配置复杂度增加

## 建议的实现优先级

### 高优先级 (核心功能)
1. **剪贴板读取**: 使用 wl-paste 实现基本功能
2. **剪贴板写入**: 使用 wl-copy 实现基本功能
3. **环境检测**: 准确识别运行环境

### 中优先级 (增强功能)
1. **截图功能**: 使用 grim + slurp
2. **快捷键**: 提供配置指导
3. **错误处理**: 友好的错误提示

### 低优先级 (优化功能)
1. **托盘支持**: 替代方案探索
2. **窗口效果**: Wayland 适配
3. **性能优化**: 减少轮询开销

## 结论

Clipboard God 可以通过以下方式实现 Wayland 兼容性：

1. **检测机制**: 实现准确的环境检测
2. **分支逻辑**: 为 X11 和 Wayland 提供不同的实现路径
3. **工具集成**: 集成标准的 Wayland 工具
4. **降级处理**: 在功能受限时提供合理的替代方案
5. **用户引导**: 清晰的安装和配置指导

实现 Wayland 兼容性需要 significant 的代码重构，但可以保持现有 X11 功能的同时支持 Wayland 环境。
