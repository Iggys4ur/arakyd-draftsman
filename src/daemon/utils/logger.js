/**
 * Logger utility for the Arakyd Daemon
 * 
 * Provides structured logging with different levels and formatting.
 */

const LOG_LEVELS = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3
};

class Logger {
	constructor(level = "info") {
		this.level = level;
		this.levelValue = LOG_LEVELS[level] || LOG_LEVELS.info;
	}

	/**
	 * Format log message with timestamp and level
	 */
	formatMessage(level, message, ...args) {
		const timestamp = new Date().toISOString();
		const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
		
		if (args.length > 0) {
			return `${prefix} ${message}`;
		}
		return `${prefix} ${message}`;
	}

	/**
	 * Check if a log level should be output
	 */
	shouldLog(level) {
		return LOG_LEVELS[level] <= this.levelValue;
	}

	/**
	 * Log error messages
	 */
	error(message, ...args) {
		if (this.shouldLog("error")) {
			console.error(this.formatMessage("error", message), ...args);
		}
	}

	/**
	 * Log warning messages
	 */
	warn(message, ...args) {
		if (this.shouldLog("warn")) {
			console.warn(this.formatMessage("warn", message), ...args);
		}
	}

	/**
	 * Log info messages
	 */
	info(message, ...args) {
		if (this.shouldLog("info")) {
			console.log(this.formatMessage("info", message), ...args);
		}
	}

	/**
	 * Log debug messages
	 */
	debug(message, ...args) {
		if (this.shouldLog("debug")) {
			console.log(this.formatMessage("debug", message), ...args);
		}
	}

	/**
	 * Set log level
	 */
	setLevel(level) {
		this.level = level;
		this.levelValue = LOG_LEVELS[level] || LOG_LEVELS.info;
	}
}

// Create default logger instance
export const logger = new Logger(process.env.LOG_LEVEL || "info");

// Export Logger class for custom instances
export { Logger };