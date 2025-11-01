# Clipboard God Wayland 兼容性实现计划

## 概述

本计划详细说明如何为 Clipboard God 添加 Wayland 兼容性，确保应用在 Wayland 显示服务器上能够正常运行并提供完整的剪贴板管理功能。

## 类型定义

### 环境检测类型
```javascript
// 环境类型枚举
const EnvironmentType = {
  X11: 'x11',
  WAYLAND: 'wayland',
  UNKNOWN: 'unknown'
};

// Wayland 工具可用性
const WaylandTools = {
  wlCopy: boolean,      // wl-copy 剪贴板写入工具
  wlPaste: boolean,     // wl-paste 剪贴板读取工具
  grim: boolean,        // grim 截图工具
  slurp: boolean,       // slurp 区域选择工具
  wtype: boolean,       // wtype 按键输入工具
  ydotool: boolean      // ydotool 输入工具
};

// 配置选项
const WaylandConfig = {
  enableWaylandSupport: boolean,
  pollingInterval: number,     // 剪贴板轮询间隔 (ms)
  screenshotTool: string,      // 截图工具选择
  inputTool: string,          // 输入工具选择
  showCompatibilityWarnings: boolean
};
```

## 文件修改

### 新文件创建

1. **src/main/wayland/WaylandDetector.js**
   - 环境检测逻辑
   - 工具可用性检查
   - 配置管理

2. **src/main/wayland/WaylandClipboardManager.js**
   - Wayland 剪贴板管理
   - 轮询机制实现
   - wl-clipboard 集成

3. **src/main/wayland/WaylandPasteHandler.js**
   - Wayland 粘贴处理
   - 按键模拟适配
   - 工具回退机制

4. **src/main/wayland/WaylandScreenshotManager.js**
   - Wayland 截图功能
   - xdg-desktop-portal 集成
   - 权限处理

5. **src/main/wayland/WaylandUtils.js**
   - 通用工具函数
   - 命令执行包装
   - 错误处理

### 现有文件修改

1. **src/main/clipboardManager.js**
   - 添加 Wayland 检测分支
   - 集成 WaylandClipboardManager
   - 环境适配逻辑

2. **src/main/pasteHandler.js**
   - 添加 Wayland 粘贴路径
   - 工具检测和选择
   - 错误处理增强

3. **src/main/screenshotManager.js**
   - Wayland 截图支持
   - 工具回退机制
   - 权限请求处理

4. **src/main/mainProcess.js**
   - 环境初始化
   - Wayland 配置加载
   - 快捷键适配

5. **package.json**
   - 添加 Wayland 相关依赖
   - 安装脚本更新
   - 构建配置调整

## 函数实现

### 环境检测函数

```javascript
// src/main/wayland/WaylandDetector.js
class WaylandDetector {
  // 检测当前显示服务器类型
  static detectEnvironment() {
    const sessionType = process.env.XDG_SESSION_TYPE;
    const waylandDisplay = process.env.WAYLAND_DISPLAY;
    
    if (sessionType === 'wayland' || waylandDisplay) {
      return EnvironmentType.WAYLAND;
    } else if (sessionType === 'x11' || process.env.DISPLAY) {
      return EnvironmentType.X11;
    }
    return EnvironmentType.UNKNOWN;
  }

  // 检查 Wayland 工具可用性
  static async checkWaylandTools() {
    const tools = new WaylandTools();
    const { execSync } = require('child_process');
    
    tools.wlCopy = this.commandExists('wl-copy');
    tools.wlPaste = this.commandExists('wl-paste');
    tools.grim = this.commandExists('grim');
    tools.slurp = this.commandExists('slurp');
    tools.wtype = this.commandExists('wtype');
    tools.ydotool = this.commandExists('ydotool');
    
    return tools;
  }

  // 检查命令是否存在
  static commandExists(command) {
    try {
      require('child_process').execSync(`which ${command}`, { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }
}
```

### Wayland 剪贴板管理

```javascript
// src/main/wayland/WaylandClipboardManager.js
class WaylandClipboardManager {
  constructor(options = {}) {
    this.pollingInterval = options.pollingInterval || 1000;
    this.lastContent = null;
    this.isMonitoring = false;
    this.monitoringTimer = null;
  }

  // 开始监控剪贴板
  startMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    this.monitoringTimer = setInterval(() => {
      this.checkClipboard();
    }, this.pollingInterval);
  }

  // 检查剪贴板变化
  async checkClipboard() {
    try {
      const currentContent = await this.readClipboard();
      if (currentContent !== this.lastContent) {
        this.lastContent = currentContent;
        this.onClipboardChange(currentContent);
      }
    } catch (error) {
      console.error('检查 Wayland 剪贴板失败:', error);
    }
  }

  // 读取剪贴板内容
  async readClipboard() {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    
    try {
      const { stdout } = await execAsync('wl-paste -n');
      return stdout.trim();
    } catch (error) {
      // 尝试读取图片
      try {
        const { stdout: imageStdout } = await execAsync('wl-paste --type=image/png -n');
        return { type: 'image', data: imageStdout };
      } catch (imageError) {
        return null;
      }
    }
  }

  // 写入剪贴板内容
  async writeClipboard(content, type = 'text') {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    
    if (type === 'text') {
      await execAsync(`wl-copy "${content}"`);
    } else if (type === 'image') {
      await execAsync('wl-copy --type=image/png', { input: content });
    }
  }

  // 剪贴板变化回调
  onClipboardChange(content) {
    // 触发主进程的剪贴板更新逻辑
    if (this.changeCallback) {
      this.changeCallback(content);
    }
  }
}
```

### Wayland 粘贴处理

```javascript
// src/main/wayland/WaylandPasteHandler.js
class WaylandPasteHandler {
  constructor() {
    this.preferredTool = this.detectPreferredTool();
  }

  // 检测首选输入工具
  detectPreferredTool() {
    if (this.commandExists('wtype')) return 'wtype';
    if (this.commandExists('ydotool')) return 'ydotool';
    return 'manual';
  }

  // 执行粘贴操作
  async executePaste(item) {
    // 先写入剪贴板
    await this.writeToClipboard(item);
    
    // 根据工具类型执行粘贴
    switch (this.preferredTool) {
      case 'wtype':
        return this.pasteWithWtype();
      case 'ydotool':
        return this.pasteWithYdotool();
      default:
        return this.showManualPastePrompt();
    }
  }

  // 使用 wtype 粘贴
  async pasteWithWtype() {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    
    await execAsync('wtype -M ctrl -P v -m ctrl');
  }

  // 使用 ydotool 粘贴
  async pasteWithYdotool() {
    const { exec } = require('child_process');
    const util = require('util');
    const execAsync = util.promisify(exec);
    
    await execAsync('ydotool key 29:1 47:1 47:0 29:0'); // Ctrl+V
  }

  // 显示手动粘贴提示
  showManualPastePrompt() {
    // 显示 UI 提示用户手动粘贴
    const { Notification } = require('electron');
    const notification = new Notification({
      title: 'Clipboard God',
      body: '内容已复制到剪贴板，请手动按 Ctrl+V 粘贴'
    });
    notification.show();
  }
}
```

## 类结构

### 新增类

1. **WaylandDetector**
   - 静态方法类
   - 环境检测工具
   - 依赖检查

2. **WaylandClipboardManager**
   - 继承基础剪贴板管理接口
   - 轮询机制实现
   - wl-clipboard 集成

3. **WaylandPasteHandler**
   - 继承基础粘贴处理接口
   - 多工具支持
   - 智能回退

4. **WaylandScreenshotManager**
   - 继承基础截图管理接口
   - xdg-desktop-portal 支持
   - 权限管理

5. **WaylandUtils**
   - 工具函数集合
   - 命令执行包装
   - 错误处理

### 修改现有类

1. **ClipboardManager**
   - 添加环境检测
   - 条件性使用 Wayland 实现
   - 统一接口保持

2. **PasteHandler**
   - 工具选择逻辑
   - 环境适配
   - 错误处理增强

3. **ScreenshotManager**
   - Wayland 截图路径
   - 权限请求
   - 工具回退

## 依赖管理

### 新增依赖

```json
{
  "dependencies": {
    "xdg-desktop-portal": "^1.0.0",
    "wayland-tools-checker": "^1.0.0"
  },
  "optionalDependencies": {
    "wl-clipboard": "^2.0.0",
    "grim": "^1.0.0",
    "slurp": "^1.0.0",
    "wtype": "^0.3.0"
  }
}
```

### 安装脚本更新

```bash
# install-desktop.sh
install_wayland_dependencies() {
    if [ "$XDG_SESSION_TYPE" = "wayland" ]; then
        echo "检测到 Wayland 环境，安装 Wayland 依赖..."
        
        # Debian/Ubuntu
        if command -v apt &> /dev/null; then
            sudo apt update
            sudo apt install -y wl-clipboard grim slurp wtype
        # Fedora
        elif command -v dnf &> /dev/null; then
            sudo dnf install -y wl-clipboard grim slurp wtype
        # Arch Linux
        elif command -v pacman &> /dev/null; then
            sudo pacman -S wl-clipboard grim slurp wtype
        fi
    fi
}
```

## 测试策略

### 单元测试

1. **环境检测测试**
   - X11/Wayland 环境模拟
   - 工具检测验证
   - 边界条件测试

2. **剪贴板功能测试**
   - 读写操作测试
   - 轮询机制测试
   - 数据类型支持测试

3. **粘贴功能测试**
   - 不同工具测试
   - 错误处理测试
   - 用户体验测试

### 集成测试

1. **多环境测试**
   - X11 环境测试
   - Wayland 环境测试
   - 混合环境测试

2. **工具兼容性测试**
   - 不同发行版测试
   - 工具版本兼容性
   - 缺失工具回退测试

### 用户体验测试

1. **首次启动体验**
   - 依赖检查提示
   - 配置向导
   - 错误处理

2. **功能完整性**
   - 所有功能正常工作
   - 性能可接受
   - 界面响应正常

## 实施顺序

### 第一阶段：基础设施 (1-2天)
1. 创建 WaylandDetector 类
2. 实现环境检测逻辑
3. 添加工具检查功能
4. 创建 WaylandUtils 工具类

### 第二阶段：核心功能 (3-4天)
1. 实现 WaylandClipboardManager
2. 修改 ClipboardManager 集成
3. 实现基础剪贴板功能
4. 测试剪贴板读写

### 第三阶段：粘贴功能 (2-3天)
1. 实现 WaylandPasteHandler
2. 修改 PasteHandler 集成
3. 实现多工具支持
4. 测试粘贴功能

### 第四阶段：截图功能 (2-3天)
1. 实现 WaylandScreenshotManager
2. 修改 ScreenshotManager 集成
3. 添加权限处理
4. 测试截图功能

### 第五阶段：集成和优化 (2-3天)
1. 修改 MainProcess 集成
2. 更新配置管理
3. 添加错误处理
4. 性能优化

### 第六阶段：测试和文档 (2-3天)
1. 全面测试
2. 文档更新
3. 安装脚本更新
4. 用户指南编写

## 风险评估

### 技术风险
1. **工具依赖**: 用户系统可能缺少必要工具
   - 缓解: 提供详细安装指导
   - 备选: 实现多种工具回退

2. **权限限制**: Wayland 安全模型可能限制功能
   - 缓解: 使用 xdg-desktop-portal
   - 备选: 提供功能降级

3. **性能影响**: 轮询机制可能影响性能
   - 缓解: 智能轮询间隔
   - 备选: 事件驱动优化

### 用户体验风险
1. **配置复杂**: Wayland 配置可能复杂
   - 缓解: 自动检测和配置
   - 备选: 提供配置向导

2. **功能限制**: 某些功能可能在 Wayland 上受限
   - 缓解: 清晰的功能说明
   - 备选: 提供替代方案

## 成功指标

### 功能指标
- [ ] 在主流 Wayland 环境中正常运行
- [ ] 所有核心功能正常工作
- [ ] 错误处理完善
- [ ] 性能可接受

### 用户体验指标
- [ ] 首次启动无障碍
- [ ] 配置简单直观
- [ ] 错误提示友好
- [ ] 文档完整清晰

### 兼容性指标
- [ ] 支持主流 Wayland 合成器
- [ ] 支持主流 Linux 发行版
- [ ] 向后兼容 X11 环境
- [ ] 工具依赖合理

## 结论

通过系统性的实现计划，Clipboard God 可以成功实现 Wayland 兼容性。关键在于：

1. **分层设计**: 保持 X11 功能完整性的同时添加 Wayland 支持
2. **工具集成**: 充分利用现有的 Wayland 工具生态
3. **用户体验**: 提供平滑的过渡和友好的错误处理
4. **测试覆盖**: 确保在各种环境中的稳定性

