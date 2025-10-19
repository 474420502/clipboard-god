const { exec, spawn } = require('child_process');
const { clipboard, nativeImage } = require('electron');

class PasteHandler {
  // 写入内容到剪贴板
  static writeToClipboard(item) {
    try {
      if (item.type === 'text') {
        clipboard.writeText(item.content);
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
  static executePaste(item) {
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
        // Linux - 根据内容类型使用不同的粘贴快捷键
        const keyCombination = item.type === 'image' ? 'ctrl+v' : 'ctrl+shift+v';
        console.log('Linux 使用快捷键:', keyCombination);

        // 对于图片，使用更长的延迟确保剪贴板准备好
        const delay = item.type === 'image' ? 500 : 100;

        setTimeout(() => {
          this.executePasteWithRetry(keyCombination)
            .then(() => resolve())
            .catch(reject);
        }, delay);
      }
    });
  }

  // 带重试的粘贴执行
  static executePasteWithRetry(keyCombination) {
    return new Promise((resolve, reject) => {
      // 首先尝试使用 xdotool
      exec('which xdotool', (error, stdout, stderr) => {
        if (error || !stdout.trim()) {
          // xdotool 不存在，尝试其他方法
          this.tryAlternativePasteMethods(keyCombination)
            .then(() => resolve())
            .catch(reject);
          return;
        }

        // xdotool 存在，使用它
        exec(`xdotool key ${keyCombination}`, (err2, stdout2, stderr2) => {
          if (err2) {
            console.error('使用 xdotool 粘贴失败，尝试替代方法:', err2);
            // 尝试替代方法
            this.tryAlternativePasteMethods(keyCombination)
              .then(() => resolve())
              .catch(reject);
            return;
          }

          console.log(`Linux 粘贴操作完成 (${keyCombination})`);
          resolve();
        });
      });
    });
  }

  // 尝试替代的粘贴方法
  static tryAlternativePasteMethods(keyCombination = 'ctrl+v') {
    return new Promise((resolve, reject) => {
      console.log('尝试替代的粘贴方法:', keyCombination);

      // 根据快捷键组合选择不同的按键序列
      let keySequence;
      if (keyCombination === 'ctrl+shift+v') {
        // Ctrl+Shift+V: Ctrl down, Shift down, V down, V up, Shift up, Ctrl up
        keySequence = 'xdotool keydown ctrl keydown shift key v keyup shift keyup ctrl';
      } else {
        // Ctrl+V: Ctrl down, V down, V up, Ctrl up
        keySequence = 'xdotool keydown ctrl key v keyup ctrl';
      }

      // 方法1: 使用 xdotool 的 keydown/keyup 组合
      exec(keySequence, (error, stdout, stderr) => {
        if (!error) {
          console.log(`使用 xdotool ${keyCombination} 粘贴成功`);
          resolve();
          return;
        }

        // 方法2: 使用 ydotool (如果安装了)
        exec('which ydotool', (error, stdout, stderr) => {
          if (!error && stdout.trim()) {
            // ydotool 按键码: 29=Ctrl, 42=Shift, 47=V
            const ydoSequence = keyCombination === 'ctrl+shift+v'
              ? 'ydotool key 29:1 42:1 47:1 47:0 42:0 29:0'  // Ctrl+Shift+V
              : 'ydotool key 29:1 47:1 47:0 29:0';          // Ctrl+V
            exec(ydoSequence, (error, stdout, stderr) => {
              if (!error) {
                console.log(`使用 ydotool ${keyCombination} 粘贴成功`);
                resolve();
                return;
              }

              // 所有方法都失败了
              reject(new Error('所有粘贴方法都失败了'));
            });
            return;
          }

          // 方法3: 使用 wl-clipboard (Wayland)
          exec('which wl-paste', (error, stdout, stderr) => {
            if (!error && stdout.trim()) {
              // 对于 Wayland，我们只能记录需要手动粘贴
              console.log('检测到 Wayland 环境，请使用 Ctrl+V 手动粘贴');
              resolve();
              return;
            }

            // 所有方法都失败了
            reject(new Error('所有粘贴方法都失败了，您可能需要手动按 Ctrl+V 粘贴'));
          });
        });
      });
    });
  }

  // 写入并粘贴
  static writeAndPaste(item) {
    const success = this.writeToClipboard(item);
    if (!success) {
      throw new Error('写入剪贴板失败');
    }

    // 延迟已在 executePaste 中处理
    return this.executePaste(item);
  }
}

module.exports = PasteHandler;
