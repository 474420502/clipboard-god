const { exec } = require('child_process');
const { clipboard, nativeImage } = require('electron');
let robot;
try {
  robot = require('robotjs');
  if (robot && typeof robot.setKeyboardDelay === 'function') {
    robot.setKeyboardDelay(20);
  }
} catch (err) {
  robot = null;
}

class PasteHandler {
  static _xdotoolCheckPromise = null;
  static _xdotoolAvailable = null;

  static ensureXdotoolAvailable() {
    if (this._xdotoolAvailable === true) return Promise.resolve(true);
    if (this._xdotoolAvailable === false) return Promise.resolve(false);
    if (this._xdotoolCheckPromise) return this._xdotoolCheckPromise;

    this._xdotoolCheckPromise = new Promise((resolve) => {
      exec('command -v xdotool', (error, stdout) => {
        const ok = !error && !!(stdout && String(stdout).trim());
        this._xdotoolAvailable = ok;
        resolve(ok);
      });
    }).finally(() => {
      // Allow re-check in case environment changes, but keep cached boolean.
      this._xdotoolCheckPromise = null;
    });

    return this._xdotoolCheckPromise;
  }

  // 写入内容到剪贴板
  static writeToClipboard(item) {
    try {
      if (item.type === 'text') {
        console.log('[PasteHandler] 写入剪贴板，类型=text，内容长度:', item.content ? item.content.length : 0);
        console.log('[PasteHandler] 内容预览:', item.content ? item.content.substring(0, 100) : 'null');
        clipboard.writeText(item.content);
        if (process.platform === 'linux') {
          // 同时写入 CLIPBOARD 和 PRIMARY selection
          console.log('[PasteHandler] 同时写入 CLIPBOARD 和 PRIMARY selection');
          clipboard.writeText(item.content, 'clipboard');
          clipboard.writeText(item.content, 'selection');
          // 验证写入结果
          const clipText = clipboard.readText('clipboard');
          const selText = clipboard.readText('selection');
          console.log('[PasteHandler] CLIPBOARD 内容:', clipText ? clipText.substring(0, 50) : 'null');
          console.log('[PasteHandler] PRIMARY 内容:', selText ? selText.substring(0, 50) : 'null');
        }
      } else if (item.type === 'image') {
        let image = null;
        try {
          // If content is a data URL (stored inline), create from data URL
          if (typeof item.content === 'string' && item.content.startsWith('data:')) {
            image = nativeImage.createFromDataURL(item.content);
          } else if (typeof item.content === 'string') {
            // Maybe it's a stored file path (sqliteStorage saves image_path)
            const fs = require('fs');
            try {
              if (fs.existsSync(item.content)) {
                const buf = fs.readFileSync(item.content);
                image = nativeImage.createFromBuffer(buf);
              }
            } catch (e) {
              // ignore file read errors, will fallback
            }
          } else if (item.content && Buffer.isBuffer(item.content)) {
            image = nativeImage.createFromBuffer(item.content);
          }
        } catch (err) {
          console.error('创建 nativeImage 失败:', err);
        }

        if (!image || image.isEmpty()) {
          throw new Error('无法解析图像数据用于写入剪贴板');
        }

        clipboard.writeImage(image);
      }
      return true;
    } catch (error) {
      console.error('写入剪贴板时出错:', error);
      return false;
    }
  }

  // 执行粘贴操作
  static executePaste(item, options = {}) {
    return new Promise((resolve, reject) => {
      // 根据不同平台和内容类型执行不同的粘贴命令
      console.log('执行粘贴操作，类型:', item.type);

      if (process.platform === 'darwin') {
        // macOS
        exec('osascript -e \'tell application "System Events" to keystroke "v" using command down\'', (error, stdout, stderr) => {
          if (error) {
            console.error('执行 AppleScript 失败:', error);
            reject(error);
            return;
          }
          console.log('macOS 粘贴操作完成');
          resolve();
        });
      } else if (process.platform === 'win32') {
        // Windows
        exec('powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^v\')"', (error, stdout, stderr) => {
          if (error) {
            console.error('执行 PowerShell 命令失败:', error);
            reject(error);
            return;
          }
          console.log('Windows 粘贴操作完成');
          resolve();
        });
      } else {
        // Linux (X11)
        // 目标窗口ID由主进程传入（隐藏主窗后焦点应回到之前应用）。不再额外调用 xprop/xdotool
        // 获取窗口信息：这些探测会引入明显延迟，但当前并不会影响按键选择。
        const targetWindowId = options && options.targetWindowId ? String(options.targetWindowId) : '';

        // 文本优先尝试最常见的 Ctrl+V；失败再 fallback 到 Shift+Insert / Ctrl+Shift+V
        const keyCombinations = item.type === 'image'
          ? ['ctrl+v']
          : ['ctrl+v', 'shift+insert', 'ctrl+shift+v'];

        // 对于图片，使用更长的延迟确保剪贴板准备好；文本尽量缩短以提升体感
        const delay = item.type === 'image' ? 150 : 30;

        setTimeout(() => {
          const options2 = { forceHardKey: item.type !== 'image', avoidWindowArg: item.type !== 'image' };
          this.executePasteWithRetry(keyCombinations, targetWindowId, options2)
            .then(() => resolve())
            .catch(reject);
        }, delay);
      }
    });
  }

  // 带重试的粘贴执行
  static executePasteWithRetry(keyCombinations, windowId, options = {}) {
    return new Promise((resolve, reject) => {
      const combos = Array.isArray(keyCombinations) ? keyCombinations : [keyCombinations];

      const tryNext = (index, lastError) => {
        if (index >= combos.length) {
          const suffix = '（已写入剪贴板，请手动按 Ctrl+V）';
          reject(new Error(lastError ? `${lastError}${suffix}` : `自动粘贴失败${suffix}`));
          return;
        }

        const keyCombination = combos[index];

        // Prefer robotjs when available
        if (robot) {
          this.tryRobotKey(keyCombination, windowId, options)
            .then(() => {
              console.log(`Linux 粘贴操作完成 (${keyCombination})`);
              resolve();
            })
            .catch(() => {
              this.executeXdotoolKey(keyCombination, windowId, options)
                .then(() => resolve())
                .catch(() => tryNext(index + 1, '自动粘贴失败'));
            });
          return;
        }

        this.executeXdotoolKey(keyCombination, windowId, options)
          .then(() => resolve())
          .catch(() => tryNext(index + 1, '自动粘贴失败'));
      };

      tryNext(0, null);
    });
  }

  // 尝试替代的粘贴方法
  static tryAlternativePasteMethods(keyCombination = 'ctrl+v', windowId, options = {}) {
    return new Promise((resolve, reject) => {
      console.log('尝试替代的粘贴方法:', keyCombination);

      // 根据快捷键组合选择不同的按键序列
      let keySequence;
      const comboLower = keyCombination.toLowerCase();

      if (comboLower === 'ctrl+shift+v') {
        // Ctrl+Shift+V: Ctrl down, Shift down, V down, V up, Shift up, Ctrl up
        keySequence = 'xdotool keydown ctrl keydown shift key v keyup shift keyup ctrl';
      } else if (comboLower === 'shift+insert') {
        // Shift+Insert: Shift down, Insert down, Insert up, Shift up
        keySequence = 'xdotool keydown shift key Insert keyup shift';
      } else {
        // Ctrl+V: Ctrl down, V down, V up, Ctrl up
        keySequence = 'xdotool keydown ctrl key v keyup ctrl';
      }

      // 方法1: 使用 xdotool 的 keydown/keyup 组合
      const useWindowArg = !options.avoidWindowArg;
      const windowArg = useWindowArg && windowId ? `--window ${windowId} ` : '';
      const activateCmd = windowId ? `xdotool windowactivate --sync ${windowId} && xdotool sleep 0.02 && ` : '';
      exec(`${activateCmd}xdotool ${windowArg}${keySequence}`, (error, stdout, stderr) => {
        if (!error) {
          console.log(`使用 xdotool ${keyCombination} 粘贴成功`);
          resolve();
          return;
        }

        // 所有方法都失败了
        reject(new Error('自动粘贴失败，您可能需要手动按 Ctrl+V 粘贴'));
      });
    });
  }

  static executeXdotoolKey(keyCombination, windowId, options = {}) {
    return new Promise((resolve, reject) => {
      this.ensureXdotoolAvailable().then((ok) => {
        if (!ok) {
          reject(new Error('xdotool 未安装，无法自动粘贴'));
          return;
        }

        if (options.forceHardKey && keyCombination.toLowerCase() === 'shift+insert') {
          this.sendHardKeySequence(keyCombination, windowId)
            .then(() => resolve())
            .catch(reject);
          return;
        }

        const useWindowArg = !options.avoidWindowArg;
        const windowArg = useWindowArg && windowId ? `--window ${windowId} ` : '';
        const activateCmd = windowId ? `xdotool windowactivate --sync ${windowId} && xdotool sleep 0.02 && ` : '';
        exec(`${activateCmd}xdotool key --clearmodifiers ${windowArg}${keyCombination}`, (err2) => {
          if (err2) {
            console.error('使用 xdotool 粘贴失败，尝试替代方法:', err2);
            this.tryAlternativePasteMethods(keyCombination, windowId, options)
              .then(() => resolve())
              .catch(reject);
            return;
          }
          resolve();
        });
      });
    });
  }

  static tryRobotKey(keyCombination, windowId, options = {}) {
    return new Promise((resolve, reject) => {
      if (!robot) {
        reject(new Error('robotjs unavailable'));
        return;
      }

      const comboLower = String(keyCombination || '').toLowerCase();
      const map = {
        'shift+insert': { key: 'insert', mods: ['shift'] },
        'ctrl+v': { key: 'v', mods: ['control'] },
        'ctrl+shift+insert': { key: 'insert', mods: ['control', 'shift'] }
      };
      const cfg = map[comboLower];
      if (!cfg) {
        reject(new Error('robotjs unsupported combo'));
        return;
      }

      const activateCmd = windowId ? `xdotool windowactivate --sync ${windowId} && xdotool sleep 0.02` : '';
      const runKey = () => {
        try {
          if (cfg.mods && cfg.mods.length) robot.keyTap(cfg.key, cfg.mods);
          else robot.keyTap(cfg.key);
          resolve();
        } catch (err) {
          reject(err);
        }
      };

      if (activateCmd) {
        exec(activateCmd, (err) => {
          if (err) {
            reject(err);
            return;
          }
          setTimeout(runKey, 20);
        });
      } else {
        setTimeout(runKey, 20);
      }
    });
  }

  static sendHardKeySequence(keyCombination, windowId) {
    return new Promise((resolve, reject) => {
      const comboLower = String(keyCombination || '').toLowerCase();
      let keySequence;
      if (comboLower === 'shift+insert') {
        keySequence = 'xdotool keyup shift keyup ctrl keyup alt keyup meta && xdotool keydown shift key Insert keyup shift';
      } else if (comboLower === 'ctrl+v') {
        keySequence = 'xdotool keyup shift keyup ctrl keyup alt keyup meta && xdotool keydown ctrl key v keyup ctrl';
      } else {
        reject(new Error('unsupported-hard-key'));
        return;
      }

      const activateCmd = windowId ? `xdotool windowactivate --sync ${windowId} && xdotool sleep 0.02 && ` : '';
      exec(`${activateCmd}${keySequence}`, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  // 写入并粘贴
  static writeAndPaste(item, options = {}) {
    const success = this.writeToClipboard(item);
    if (!success) {
      throw new Error('写入剪贴板失败');
    }

    // 延迟已在 executePaste 中处理
    return this.executePaste(item, options);
  }

  static getTargetWindowInfo(preferredWindowId) {
    return new Promise((resolve) => {
      const resolveEmpty = () => resolve({ windowId: '', windowClass: '', windowName: '' });
      const fetchInfo = (windowId) => {
        if (!windowId) {
          resolveEmpty();
          return;
        }
        const result = { windowId, windowClass: '', windowName: '' };
        exec(`xprop -id ${windowId} WM_CLASS`, (errClass, outClass) => {
          if (!errClass && outClass) {
            const matches = String(outClass).match(/"([^"]+)"/g) || [];
            if (matches.length) {
              result.windowClass = matches[matches.length - 1].replace(/"/g, '');
            }
          }

          exec(`xdotool getwindowname ${windowId}`, (errName, outName) => {
            if (!errName && outName) {
              result.windowName = String(outName).trim();
            }
            resolve(result);
          });
        });
      };

      if (preferredWindowId) {
        fetchInfo(preferredWindowId);
        return;
      }

      exec('xdotool getactivewindow', (error, stdout) => {
        if (error || !stdout) {
          resolveEmpty();
          return;
        }
        fetchInfo(String(stdout).trim());
      });
    });
  }


  static isTerminalWindow(windowClass, windowName) {
    const cls = `${windowClass || ''}`.toLowerCase();
    const name = `${windowName || ''}`.toLowerCase();
    const combined = `${cls} ${name}`.trim();
    if (!combined) return false;

    // Terminal keywords in window title (works for VS Code/IDE embedded terminals)
    const terminalTitleKeywords = ['terminal', '终端', 'shell', 'console'];
    if (terminalTitleKeywords.some((kw) => name.includes(kw))) {
      console.log('[PasteHandler] 识别为终端(标题关键词):', combined);
      return true;
    }

    if (this.isIdeWindow(windowClass, windowName)) {
      console.log('[PasteHandler] 识别为 IDE 窗口:', combined);
      return false;
    }

    // 已知终端列表
    const knownTerminals = [
      'gnome-terminal',
      'konsole',
      'xfce4-terminal',
      'alacritty',
      'kitty',
      'terminator',
      'tilix',
      'wezterm',
      'xterm',
      'rxvt',
      'urxvt',
      'st',
      'foot',
      'eterm',
      'linuxterm',
      'deepin-terminal',
      'cinnamon-terminal',
      'mate-terminal',
      'lxterminal',
      'qterminal',
      'tabby'
    ];

    const result = knownTerminals.some((name) => combined.includes(name));
    console.log('[PasteHandler] 识别为终端:', result, 'combined=', combined);
    return result;
  }

  static isIdeWindow(windowClass, windowName) {
    const combined = `${windowClass || ''} ${windowName || ''}`.toLowerCase();
    if (!combined.trim()) return false;
    const ideNames = [
      'code',
      'vscode',
      'visual studio code',
      'idea',
      'pycharm',
      'webstorm',
      'clion',
      'goland',
      'rider'
    ];
    return ideNames.some((name) => combined.includes(name));
  }
}

module.exports = PasteHandler;
