# ShortcutCapture Component

一个用于捕获键盘快捷键的React组件。

## 功能特性

- 🎹 **实时按键捕获**: 监听键盘事件，实时显示按键组合
- ⌨️ **智能按键处理**: 自动排序修饰键（Ctrl → Alt → Shift → Cmd）
- 🎯 **多种确认方式**:
  - 按 `Enter` 键确认
  - 点击确认按钮
  - 按 `Esc` 键取消
- 🎨 **美观界面**: 模态框显示，清晰的视觉反馈
- 🔧 **易于集成**: 简单的props接口

## 使用方法

```jsx
import ShortcutCapture from './ShortcutCapture';

function MyComponent() {
  const [shortcut, setShortcut] = useState('CommandOrControl+Alt+V');

  return (
    <ShortcutCapture
      value={shortcut}
      onChange={setShortcut}
      placeholder="点击设置快捷键"
    />
  );
}
```

## Props

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `value` | `string` | - | 当前快捷键值 |
| `onChange` | `function` | - | 快捷键改变时的回调函数 |
| `placeholder` | `string` | `"点击设置快捷键"` | 输入框占位符文本 |

## 快捷键格式

组件会自动将按键转换为标准格式：

- `Control+A` → `Ctrl+A`
- `Meta+Shift+X` → `Cmd+Shift+X`
- `Control+Alt+Delete` → `Ctrl+Alt+Del`

## 样式定制

组件使用CSS变量，可以通过修改这些变量来自定义外观：

```css
:root {
  --accent-color: #007acc;
  --modal-bg: #ffffff;
  --border-color: #e1e1e1;
  --text-color: #333333;
  --input-bg: #f8f8f8;
}
```

## 依赖

- React 16.8+
- CSS变量支持的现代浏览器

## 示例

查看 `SettingsToolWindow.jsx` 中的实际使用示例。