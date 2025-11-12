/**
 * 应用错误处理模块
 * 提供统一的错误处理和日志记录功能
 */

const { AppError } = require('../types');
const { CONFIG_PATHS } = require('../constants');
const fs = require('fs');
const path = require('path');

class ErrorHandler {
    constructor() {
        this.logFile = path.join(CONFIG_PATHS.logs, 'app.log');
        this.errorLogFile = path.join(CONFIG_PATHS.logs, 'error.log');
        this.debugEnabled = process.env.NODE_ENV === 'development';

        // 确保日志目录存在
        this.ensureLogDirectory();
    }

    /**
     * 确保日志目录存在
     */
    ensureLogDirectory() {
        try {
            const logDir = path.dirname(this.logFile);
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
        } catch (err) {
            // 静默忽略日志目录创建错误
        }
    }

    /**
     * 安全的console包装器，防止EPIPE错误
     */
    safeConsole = {
        log: (...args) => {
            if (!this.debugEnabled) return;
            try {
                if (process.stdout.writable) {
                    console.log(...args);
                    this.logToFile('info', args.join(' '));
                }
            } catch (error) {
                // 静默忽略EPIPE错误
            }
        },
        error: (...args) => {
            try {
                if (process.stderr.writable) {
                    console.error(...args);
                    this.logToFile('error', args.join(' '));
                }
            } catch (error) {
                // 静默忽略EPIPE错误
            }
        },
        warn: (...args) => {
            try {
                if (process.stderr.writable) {
                    console.warn(...args);
                    this.logToFile('warn', args.join(' '));
                }
            } catch (error) {
                // 静默忽略EPIPE错误
            }
        },
        debug: (...args) => {
            if (!this.debugEnabled) return;
            try {
                if (process.stdout.writable) {
                    console.log('[DEBUG]', ...args);
                    this.logToFile('debug', args.join(' '));
                }
            } catch (error) {
                // 静默忽略EPIPE错误
            }
        }
    };

    /**
     * 记录日志到文件
     */
    logToFile(level, message) {
        try {
            const timestamp = new Date().toISOString();
            const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
            const targetFile = level === 'error' ? this.errorLogFile : this.logFile;

            fs.appendFileSync(targetFile, logEntry);
        } catch (err) {
            // 静默忽略文件写入错误
        }
    }

    /**
     * 创建应用错误
     */
    createError(message, code, type = 'general') {
        return new AppError(message, code, type);
    }

    /**
     * 处理错误并记录日志
     */
    handleError(error, context = '') {
        const errorInfo = {
            message: error.message,
            stack: error.stack,
            context,
            timestamp: new Date().toISOString(),
            type: error.name || 'UnknownError'
        };

        // 记录到文件
        this.logToFile('error', `Error in ${context}: ${error.message}`);
        if (error.stack) {
            this.logToFile('error', `Stack: ${error.stack}`);
        }

        // 根据错误类型执行不同的处理
        switch (error.type) {
            case 'clipboard':
                this.safeConsole.warn('剪贴板访问错误:', error.message);
                break;
            case 'storage':
                this.safeConsole.error('存储错误:', error.message);
                break;
            case 'window':
                this.safeConsole.error('窗口操作错误:', error.message);
                break;
            case 'permission':
                this.safeConsole.warn('权限错误:', error.message);
                break;
            default:
                this.safeConsole.error('应用错误:', error.message);
        }

        return errorInfo;
    }

    /**
     * 静默处理错误（不输出到控制台）
     */
    handleErrorSilently(error, context = '') {
        const errorInfo = {
            message: error.message,
            context,
            timestamp: new Date().toISOString(),
            type: error.name || 'UnknownError'
        };

        // 只记录到文件
        this.logToFile('error', `Silent error in ${context}: ${error.message}`);
        if (error.stack) {
            this.logToFile('error', `Stack: ${error.stack}`);
        }

        return errorInfo;
    }

    /**
     * 包装Promise，确保错误被正确处理
     */
    async wrapPromise(promise, context = '') {
        try {
            return await promise;
        } catch (error) {
            this.handleError(error, context);
            throw error;
        }
    }

    /**
     * 包装异步函数
     */
    wrapAsync(fn, context = '') {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                this.handleError(error, context);
                throw error;
            }
        };
    }

    /**
     * 包装同步函数
     */
    wrapSync(fn, context = '') {
        return (...args) => {
            try {
                return fn(...args);
            } catch (error) {
                this.handleError(error, context);
                throw error;
            }
        };
    }

    /**
     * 清理旧日志文件
     */
    cleanupLogs() {
        try {
            const logFiles = [this.logFile, this.errorLogFile];
            const maxSize = 10 * 1024 * 1024; // 10MB

            logFiles.forEach(file => {
                if (fs.existsSync(file)) {
                    const stats = fs.statSync(file);
                    if (stats.size > maxSize) {
                        // 备份并创建新文件
                        const backup = file + '.backup';
                        fs.renameSync(file, backup);
                        this.logToFile('info', `Log file rotated: ${file}`);
                    }
                }
            });
        } catch (err) {
            // 静默忽略清理错误
        }
    }

    /**
     * 获取最近的错误日志
     */
    getRecentErrors(limit = 50) {
        try {
            if (!fs.existsSync(this.errorLogFile)) {
                return [];
            }

            const content = fs.readFileSync(this.errorLogFile, 'utf8');
            const lines = content.split('\n').filter(line => line.trim());

            return lines
                .slice(-limit)
                .reverse()
                .map(line => {
                    // 解析日志行
                    const match = line.match(/\[([^\]]+)\] \[([^\]]+)\] (.+)/);
                    if (match) {
                        return {
                            timestamp: match[1],
                            level: match[2],
                            message: match[3]
                        };
                    }
                    return { timestamp: new Date().toISOString(), level: 'unknown', message: line };
                });
        } catch (err) {
            return [];
        }
    }
}

// 创建单例实例
const errorHandler = new ErrorHandler();

module.exports = errorHandler;
