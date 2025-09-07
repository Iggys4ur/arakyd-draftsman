import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { z } from "zod";
import { logger } from "../utils/logger.js";

/**
 * Configuration schema for daemon settings
 */
const daemonConfigSchema = z.object({
	daemon: z.object({
		port: z.number().min(1).max(65535).default(8080),
		host: z.string().default("0.0.0.0"),
		logLevel: z.enum(["error", "warn", "info", "debug"]).default("info"),
		maxInstances: z.number().min(1).default(10),
		portRange: z.object({
			start: z.number().min(1000).default(9001),
			end: z.number().max(65535).default(9100)
		}).default({}),
		docker: z.object({
			defaultTag: z.string().default("latest"),
			networkName: z.string().default("arakyd-network"),
			volumePrefix: z.string().default("arakyd-data"),
			containerPrefix: z.string().default("arakyd-pd")
		}).default({})
	}).default({}),
	
	ndoc: z.object({
		daemonLoom: z.object({
			enabled: z.boolean().default(false),
			endpoint: z.string().url().optional()
		}).default({}),
		siphon: z.object({
			enabled: z.boolean().default(false),
			endpoint: z.string().url().optional()
		}).default({})
	}).default({}),

	instances: z.object({
		autoStart: z.boolean().default(false),
		healthCheckInterval: z.number().min(1000).default(30000),
		maxRetries: z.number().min(0).default(3)
	}).default({})
});

/**
 * Configuration Manager for the Arakyd Daemon
 * 
 * Handles loading, validation, and persistence of daemon configuration.
 */
export class ConfigManager {
	constructor(configPath = null) {
		this.configPath = configPath || this.getDefaultConfigPath();
		this.config = null;
	}

	/**
	 * Get default configuration file path
	 */
	getDefaultConfigPath() {
		const configDir = process.env.ARAKYD_CONFIG_DIR || process.cwd();
		return join(configDir, "arakyd-daemon.json");
	}

	/**
	 * Initialize configuration manager
	 */
	async initialize() {
		await this.loadConfig();
		logger.info(`Configuration loaded from: ${this.configPath}`);
	}

	/**
	 * Load configuration from file or create default
	 */
	async loadConfig() {
		let rawConfig = {};

		// Try to load existing configuration
		if (existsSync(this.configPath)) {
			try {
				const configData = await readFile(this.configPath, "utf-8");
				rawConfig = JSON.parse(configData);
				logger.debug("Loaded existing configuration file");
			} catch (error) {
				logger.warn("Failed to load configuration file, using defaults:", error.message);
			}
		} else {
			logger.info("Configuration file not found, creating default configuration");
		}

		// Validate and set defaults
		try {
			this.config = daemonConfigSchema.parse(rawConfig);
			
			// Save the configuration to ensure defaults are persisted
			await this.saveConfig();
		} catch (error) {
			logger.error("Configuration validation failed:", error);
			throw new Error(`Invalid configuration: ${error.message}`);
		}
	}

	/**
	 * Save current configuration to file
	 */
	async saveConfig() {
		try {
			const configData = JSON.stringify(this.config, null, 2);
			await writeFile(this.configPath, configData, "utf-8");
			logger.debug("Configuration saved successfully");
		} catch (error) {
			logger.error("Failed to save configuration:", error);
			throw error;
		}
	}

	/**
	 * Get the current configuration
	 */
	getConfig() {
		if (!this.config) {
			throw new Error("Configuration not initialized. Call initialize() first.");
		}
		return this.config;
	}

	/**
	 * Update configuration with partial updates
	 */
	async updateConfig(updates) {
		if (!this.config) {
			throw new Error("Configuration not initialized");
		}

		// Deep merge the updates
		const mergedConfig = this.deepMerge(this.config, updates);
		
		// Validate the merged configuration
		try {
			this.config = daemonConfigSchema.parse(mergedConfig);
			await this.saveConfig();
			logger.info("Configuration updated successfully");
		} catch (error) {
			logger.error("Configuration update validation failed:", error);
			throw new Error(`Invalid configuration update: ${error.message}`);
		}
	}

	/**
	 * Get a specific configuration value by path
	 */
	get(path) {
		if (!this.config) {
			throw new Error("Configuration not initialized");
		}

		const keys = path.split(".");
		let current = this.config;
		
		for (const key of keys) {
			if (current && typeof current === "object" && key in current) {
				current = current[key];
			} else {
				return undefined;
			}
		}
		
		return current;
	}

	/**
	 * Set a specific configuration value by path
	 */
	async set(path, value) {
		if (!this.config) {
			throw new Error("Configuration not initialized");
		}

		const keys = path.split(".");
		const updates = {};
		let current = updates;

		// Build nested update object
		for (let i = 0; i < keys.length - 1; i++) {
			current[keys[i]] = {};
			current = current[keys[i]];
		}
		current[keys[keys.length - 1]] = value;

		await this.updateConfig(updates);
	}

	/**
	 * Deep merge two objects
	 */
	deepMerge(target, source) {
		const result = { ...target };
		
		for (const key in source) {
			if (source[key] !== null && typeof source[key] === "object" && !Array.isArray(source[key])) {
				result[key] = this.deepMerge(result[key] || {}, source[key]);
			} else {
				result[key] = source[key];
			}
		}
		
		return result;
	}

	/**
	 * Reset configuration to defaults
	 */
	async resetToDefaults() {
		this.config = daemonConfigSchema.parse({});
		await this.saveConfig();
		logger.info("Configuration reset to defaults");
	}

	/**
	 * Validate configuration without saving
	 */
	validateConfig(config) {
		try {
			return daemonConfigSchema.parse(config);
		} catch (error) {
			throw new Error(`Configuration validation failed: ${error.message}`);
		}
	}
}