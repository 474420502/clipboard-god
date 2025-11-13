/**
 * 资源管理器 - 统一管理应用所有资源的生命周期
 * 特别针对X11连接和GNOME桌面的优雅关闭处理
 */

const fs = require('fs');
const path = require('path');
const { BrowserWindow, globalShortcut } = require('electron');
const errorHandler = require('./errorHandler');

class ResourceManager {
    constructor() {
        this.resources = new Map();
        this.cleanupQueue = [];
        this.isShuttingDown = false;
        this.cleanupTimeout = null;

        // X11相关资源跟踪
        this.x11Connections = new Set();
        this.x11Displays = new Set();

        // 清理优先级：数值越小优先级越高
        this.cleanupPriorities = {
            x11: 1,           // X11连接优先清理
            windows: 2,       // 窗口
            shortcuts: 3,     // 快捷键
            clipboard: 4,     // 剪贴板监控
            tray: 5,          // 系统托盘
            config: 6         // 配置文件监控
        };
    }

    /**
     * 注册资源
     */
    registerResource(name, resource, cleanupFn, priority = 10) {
        try {
            if (this.resources.has(name)) {
                errorHandler.safeConsole.warn(`资源 "${name}" 已存在，将被覆盖`);
                this.unregisterResource(name);
            }

            this.resources.set(name, {
                resource,
                cleanupFn,
                priority,
                registeredAt: Date.now(),
                cleanupFnName: cleanupFn.name || 'anonymous'
            });

            errorHandler.safeConsole.debug(`已注册资源: ${name} (优先级: ${priority})`);
        } catch (error) {
            errorHandler.handleError(error, 'ResourceManager.registerResource');
        }
    }

    /**
     * 注销资源
     */
    unregisterResource(name) {
        try {
            const resource = this.resources.get(name);
            if (resource) {
                this.resources.delete(name);
                errorHandler.safeConsole.debug(`已注销资源: ${name}`);
                return true;
            }
            return false;
        } catch (error) {
            errorHandler.handleError(error, 'ResourceManager.unregisterResource');
            return false;
        }
    }

    /**
     * 注册X11相关资源
     */
    registerX11Resource(name, resource) {
        try {
            this.x11Connections.add(resource);
            this.registerResource(name, resource, () => this.cleanupX11Connection(resource), this.cleanupPriorities.x11);
            errorHandler.safeConsole.debug(`已注册X11资源: ${name}`);
        } catch (error) {
            errorHandler.handleError(error, 'ResourceManager.registerX11Resource');
        }
    }

    /**
     * 清理X11连接
     */
    cleanupX11Connection(connection) {
        try {
            if (!connection) return;

            errorHandler.safeConsole.debug('正在清理X11连接...');

            // 尝试优雅关闭X11连接
            if (connection.close) {
                try {
                    connection.close();
                } catch (err) {
                    errorHandler.safeConsole.warn('X11连接关闭时出现警告:', err.message);
                }
            }

            // 清理显示连接
            if (connection.display) {
                this.x11Displays.delete(connection.display);
            }

            this.x11Connections.delete(connection);
            errorHandler.safeConsole.debug('X11连接已清理');
        } catch (error) {
            errorHandler.handleError(error, 'ResourceManager.cleanupX11Connection');
        }
    }

    /**
     * 获取所有注册的资源（按优先级排序）
     */
    getResourcesByPriority() {
        const resources = Array.from(this.resources.entries());
        return resources.sort((a, b) => a[1].priority - b[1].priority);
    }

    /**
     * 执行资源清理
     */
    async cleanupResource(name) {
        try {
            const resourceInfo = this.resources.get(name);
            if (!resourceInfo) {
                errorHandler.safeConsole.warn(`尝试清理不存在的资源: ${name}`);
                return;
            }

            errorHandler.safeConsole.debug(`开始清理资源: ${name}`);

            // 执行清理函数
            if (typeof resourceInfo.cleanupFn === 'function') {
                try {
                    const result = resourceInfo.cleanupFn(resourceInfo.resource);

                    // 如果是Promise，等待其完成
                    if (result && typeof result.then === 'function') {
                        await Promise.race([
                            result,
                            new Promise((_, reject) =>
                                setTimeout(() => reject(new Error('清理超时')), 3000)
                            )
                        ]);
                    }
                } catch (error) {
                    errorHandler.handleError(error, `资源清理-${name}`);
                    // 清理失败不中断整体流程
                }
            }

            // 从资源管理器中移除
            this.resources.delete(name);
            errorHandler.safeConsole.debug(`资源清理完成: ${name}`);

        } catch (error) {
            errorHandler.handleError(error, 'ResourceManager.cleanupResource');
        }
    }

    /**
     * 批量清理资源
     */
    async cleanupAllResources(options = {}) {
        if (this.isShuttingDown) {
            errorHandler.safeConsole.warn('资源清理已在进行中');
            return;
        }

        this.isShuttingDown = true;
        const { force = false, timeout = 5000 } = options;

        try {
            errorHandler.safeConsole.log('开始执行资源清理...');

            // 设置清理超时
            this.cleanupTimeout = setTimeout(() => {
                errorHandler.safeConsole.warn('资源清理超时，强制结束');
                if (force) {
                    process.exit(0);
                }
            }, timeout);

            // 按优先级排序清理
            const sortedResources = this.getResourcesByPriority();

            for (const [name, resourceInfo] of sortedResources) {
                try {
                    await this.cleanupResource(name);
                } catch (error) {
                    errorHandler.handleError(error, `批量清理-${name}`);
                    // 继续清理其他资源
                }
            }

            errorHandler.safeConsole.log('资源清理完成');

        } catch (error) {
            errorHandler.handleError(error, 'ResourceManager.cleanupAllResources');
        } finally {
            this.isShuttingDown = false;
            if (this.cleanupTimeout) {
                clearTimeout(this.cleanupTimeout);
                this.cleanupTimeout = null;
            }
        }
    }

    /**
     * 获取资源状态
     */
    getResourceStatus() {
        const status = {
            total: this.resources.size,
            x11Connections: this.x11Connections.size,
            isShuttingDown: this.isShuttingDown,
            resources: []
        };

        for (const [name, resourceInfo] of this.resources) {
            status.resources.push({
                name,
                priority: resourceInfo.priority,
                registeredAt: resourceInfo.registeredAt,
                cleanupFnName: resourceInfo.cleanupFnName
            });
        }

        return status;
    }

    /**
     * 检查是否有X11相关资源未清理
     */
    hasX11Resources() {
        return this.x11Connections.size > 0;
    }

    /**
     * 强制清理X11资源（用于紧急情况）
     */
    forceCleanupX11() {
        try {
            errorHandler.safeConsole.warn('强制清理所有X11资源');

            for (const connection of this.x11Connections) {
                try {
                    this.cleanupX11Connection(connection);
                } catch (error) {
                    errorHandler.handleError(error, 'ResourceManager.forceCleanupX11');
                }
            }

            this.x11Connections.clear();
            errorHandler.safeConsole.log('X11资源强制清理完成');
        } catch (error) {
            errorHandler.handleError(error, 'ResourceManager.forceCleanupX11');
        }
    }

    /**
     * 健康检查
     */
    healthCheck() {
        const status = this.getResourceStatus();
        const issues = [];

        // 检查是否有长时间未清理的资源
        const now = Date.now();
        for (const [name, resourceInfo] of this.resources) {
            const age = now - resourceInfo.registeredAt;
            if (age > 300000) { // 5分钟
                issues.push(`资源 "${name}" 已存在 ${Math.floor(age / 1000)} 秒，可能存在内存泄露`);
            }
        }

        return {
            healthy: issues.length === 0,
            issues,
            status
        };
    }
}

// 创建单例实例
const resourceManager = new ResourceManager();

module.exports = resourceManager;