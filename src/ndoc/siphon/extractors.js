import { logger } from "../../daemon/utils/logger.js";

/**
 * Data Extractors for s!phon Integration
 * 
 * Provides specialized data extraction capabilities for different
 * types of data that s!phon might need to collect.
 */

/**
 * Instance Data Extractor
 */
export class InstanceDataExtractor {
	constructor(services) {
		this.services = services;
	}

	/**
	 * Extract comprehensive instance information
	 */
	async extractInstanceData(options = {}) {
		const {
			includeHealth = true,
			includeMetrics = true,
			includeConfig = true,
			instanceIds = null,
			format = "json"
		} = options;

		try {
			const { instanceManager, dockerOrchestrator } = this.services;
			const instances = instanceIds 
				? instanceIds.map(id => instanceManager.getInstance(id))
				: instanceManager.getAllInstances();

			const extractedData = [];

			for (const instance of instances) {
				const instanceData = {
					...instance,
					extractedAt: new Date().toISOString()
				};

				// Add health information
				if (includeHealth) {
					try {
						instanceData.health = await dockerOrchestrator.getInstanceHealth(instance.id);
					} catch (error) {
						instanceData.health = { status: "error", error: error.message };
					}
				}

				// Add metrics
				if (includeMetrics) {
					try {
						instanceData.metrics = await this.extractInstanceMetrics(instance.id);
					} catch (error) {
						instanceData.metrics = { error: error.message };
					}
				}

				// Add configuration details
				if (includeConfig) {
					instanceData.configuration = await this.extractInstanceConfig(instance.id);
				}

				extractedData.push(instanceData);
			}

			return this.formatExtractedData(extractedData, format);

		} catch (error) {
			logger.error("Failed to extract instance data:", error);
			throw error;
		}
	}

	/**
	 * Extract instance metrics
	 */
	async extractInstanceMetrics(instanceId) {
		try {
			const { dockerOrchestrator } = this.services;
			const config = dockerOrchestrator.getInstanceConfig(instanceId);

			if (!config) {
				throw new Error(`Instance ${instanceId} not found`);
			}

			// Extract Docker container stats
			const containerStats = await this.getContainerStats(config);
			
			// Extract port information
			const portInfo = {
				allocated: config.ports,
				accessible: await this.checkPortAccessibility(config.ports)
			};

			return {
				container: containerStats,
				ports: portInfo,
				uptime: await this.calculateInstanceUptime(instanceId),
				timestamp: new Date().toISOString()
			};

		} catch (error) {
			logger.error(`Failed to extract metrics for instance ${instanceId}:`, error);
			throw error;
		}
	}

	/**
	 * Get Docker container statistics
	 */
	async getContainerStats(config) {
		try {
			const { exec } = await import("node:util");
			const execPromise = exec(`docker stats --no-stream --format "table {{.Container}}\\t{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.NetIO}}\\t{{.BlockIO}}" ${config.frontendContainer} ${config.backendContainer}`);
			const { stdout } = await execPromise;
			
			const lines = stdout.trim().split('\\n').slice(1); // Skip header
			const stats = {};

			for (const line of lines) {
				const [container, cpu, memory, network, block] = line.split('\\t');
				stats[container] = {
					cpu: cpu,
					memory: memory,
					network: network,
					block: block
				};
			}

			return stats;

		} catch (error) {
			logger.warn("Failed to get container stats:", error);
			return {};
		}
	}

	/**
	 * Check port accessibility
	 */
	async checkPortAccessibility(ports) {
		const accessibility = {};

		for (const [service, port] of Object.entries(ports)) {
			try {
				const response = await fetch(`http://localhost:${port}`, {
					method: "HEAD",
					timeout: 3000
				});
				accessibility[service] = {
					port,
					accessible: response.ok,
					status: response.status
				};
			} catch (error) {
				accessibility[service] = {
					port,
					accessible: false,
					error: error.message
				};
			}
		}

		return accessibility;
	}

	/**
	 * Calculate instance uptime
	 */
	async calculateInstanceUptime(instanceId) {
		try {
			const { exec } = await import("node:util");
			const execPromise = exec(`docker inspect --format '{{.State.StartedAt}}' ${instanceId}-frontend`);
			const { stdout } = await execPromise;
			
			const startTime = new Date(stdout.trim());
			const uptime = Date.now() - startTime.getTime();
			
			return {
				startedAt: startTime.toISOString(),
				uptimeMs: uptime,
				uptimeFormatted: this.formatUptime(uptime)
			};

		} catch (error) {
			return {
				error: error.message,
				uptimeMs: 0
			};
		}
	}

	/**
	 * Format uptime duration
	 */
	formatUptime(uptimeMs) {
		const seconds = Math.floor(uptimeMs / 1000);
		const minutes = Math.floor(seconds / 60);
		const hours = Math.floor(minutes / 60);
		const days = Math.floor(hours / 24);

		if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
		if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
		if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
		return `${seconds}s`;
	}

	/**
	 * Extract instance configuration
	 */
	async extractInstanceConfig(instanceId) {
		const { instanceManager, dockerOrchestrator } = this.services;
		
		const instance = instanceManager.getInstance(instanceId);
		const dockerConfig = dockerOrchestrator.getInstanceConfig(instanceId);

		return {
			instance: {
				label: instance.label,
				tag: instance.tag,
				environment: instance.environment,
				telemetry: instance.enableTelemetry,
				isDefault: instance.isDefault
			},
			docker: dockerConfig ? {
				containers: {
					frontend: dockerConfig.frontendContainer,
					backend: dockerConfig.backendContainer,
					redis: dockerConfig.redisContainer,
					postgres: dockerConfig.postgresContainer
				},
				network: dockerConfig.networkName,
				ports: dockerConfig.ports
			} : null
		};
	}

	/**
	 * Format extracted data according to specified format
	 */
	formatExtractedData(data, format) {
		switch (format.toLowerCase()) {
			case "json":
				return JSON.stringify(data, null, 2);
			case "csv":
				return this.convertToCSV(data);
			case "xml":
				return this.convertToXML(data);
			default:
				return data;
		}
	}

	/**
	 * Convert data to CSV format
	 */
	convertToCSV(data) {
		if (!data.length) return "";

		const headers = Object.keys(data[0]);
		const csvRows = [headers.join(",")];

		for (const row of data) {
			const values = headers.map(header => {
				const value = row[header];
				return typeof value === "object" ? JSON.stringify(value) : value;
			});
			csvRows.push(values.join(","));
		}

		return csvRows.join("\\n");
	}

	/**
	 * Convert data to XML format
	 */
	convertToXML(data) {
		let xml = '<?xml version="1.0" encoding="UTF-8"?>\\n<instances>\\n';
		
		for (const instance of data) {
			xml += "  <instance>\\n";
			for (const [key, value] of Object.entries(instance)) {
				const xmlValue = typeof value === "object" 
					? `<![CDATA[${JSON.stringify(value)}]]>`
					: value;
				xml += `    <${key}>${xmlValue}</${key}>\\n`;
			}
			xml += "  </instance>\\n";
		}
		
		xml += "</instances>";
		return xml;
	}
}

/**
 * Configuration Data Extractor
 */
export class ConfigDataExtractor {
	constructor(services) {
		this.services = services;
	}

	/**
	 * Extract daemon configuration
	 */
	async extractDaemonConfig(options = {}) {
		const {
			includeSecrets = false,
			format = "json"
		} = options;

		try {
			const { config } = this.services;
			const configuration = config.getConfig();

			// Remove secrets if not requested
			const sanitizedConfig = includeSecrets 
				? configuration 
				: this.sanitizeConfig(configuration);

			const extractedData = {
				configuration: sanitizedConfig,
				extractedAt: new Date().toISOString(),
				version: "0.18.1"
			};

			return this.formatData(extractedData, format);

		} catch (error) {
			logger.error("Failed to extract daemon configuration:", error);
			throw error;
		}
	}

	/**
	 * Remove sensitive information from configuration
	 */
	sanitizeConfig(config) {
		const sanitized = JSON.parse(JSON.stringify(config));
		
		// Remove sensitive fields (add more as needed)
		const sensitiveFields = ["password", "secret", "key", "token"];
		
		this.removeSensitiveFields(sanitized, sensitiveFields);
		return sanitized;
	}

	/**
	 * Recursively remove sensitive fields
	 */
	removeSensitiveFields(obj, sensitiveFields) {
		for (const key in obj) {
			if (typeof obj[key] === "object" && obj[key] !== null) {
				this.removeSensitiveFields(obj[key], sensitiveFields);
			} else if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
				obj[key] = "[REDACTED]";
			}
		}
	}

	/**
	 * Format data according to specified format
	 */
	formatData(data, format) {
		switch (format.toLowerCase()) {
			case "json":
				return JSON.stringify(data, null, 2);
			case "yaml":
				// Would need a YAML library for proper implementation
				return this.convertToYAML(data);
			default:
				return data;
		}
	}

	/**
	 * Simple YAML conversion (basic implementation)
	 */
	convertToYAML(obj, indent = 0) {
		let yaml = "";
		const spaces = "  ".repeat(indent);

		for (const [key, value] of Object.entries(obj)) {
			if (typeof value === "object" && value !== null && !Array.isArray(value)) {
				yaml += `${spaces}${key}:\\n`;
				yaml += this.convertToYAML(value, indent + 1);
			} else if (Array.isArray(value)) {
				yaml += `${spaces}${key}:\\n`;
				for (const item of value) {
					yaml += `${spaces}  - ${item}\\n`;
				}
			} else {
				yaml += `${spaces}${key}: ${value}\\n`;
			}
		}

		return yaml;
	}
}

/**
 * Logs Data Extractor
 */
export class LogsDataExtractor {
	constructor(services) {
		this.services = services;
	}

	/**
	 * Extract daemon logs
	 */
	async extractDaemonLogs(options = {}) {
		const {
			level = "info",
			since = null,
			until = null,
			maxLines = 1000,
			format = "json"
		} = options;

		try {
			// This is a placeholder - in a real implementation,
			// you would read from log files or log storage
			const logs = await this.readLogFiles(level, since, until, maxLines);

			const extractedData = {
				logs,
				level,
				since,
				until,
				count: logs.length,
				extractedAt: new Date().toISOString()
			};

			return this.formatLogs(extractedData, format);

		} catch (error) {
			logger.error("Failed to extract daemon logs:", error);
			throw error;
		}
	}

	/**
	 * Extract instance logs
	 */
	async extractInstanceLogs(instanceId, options = {}) {
		const {
			container = "all",
			since = null,
			until = null,
			maxLines = 1000,
			format = "json"
		} = options;

		try {
			const { dockerOrchestrator } = this.services;
			const config = dockerOrchestrator.getInstanceConfig(instanceId);

			if (!config) {
				throw new Error(`Instance ${instanceId} not found`);
			}

			const logs = await this.readContainerLogs(config, container, since, until, maxLines);

			const extractedData = {
				instanceId,
				container,
				logs,
				since,
				until,
				count: logs.length,
				extractedAt: new Date().toISOString()
			};

			return this.formatLogs(extractedData, format);

		} catch (error) {
			logger.error(`Failed to extract logs for instance ${instanceId}:`, error);
			throw error;
		}
	}

	/**
	 * Read log files (placeholder implementation)
	 */
	async readLogFiles(level, since, until, maxLines) {
		// This would read from actual log files
		// For now, return a sample structure
		return [
			{
				timestamp: new Date().toISOString(),
				level: "info",
				message: "Sample log entry",
				component: "daemon"
			}
		];
	}

	/**
	 * Read container logs
	 */
	async readContainerLogs(config, container, since, until, maxLines) {
		try {
			const { exec } = await import("node:util");
			
			let containerName;
			if (container === "all") {
				// Get logs from all containers
				const containers = [
					config.frontendContainer,
					config.backendContainer,
					config.redisContainer,
					config.postgresContainer
				];
				
				const allLogs = [];
				for (const cont of containers) {
					const logs = await this.getContainerLogs(cont, since, until, maxLines);
					allLogs.push(...logs.map(log => ({ ...log, container: cont })));
				}
				
				return allLogs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
			} else {
				containerName = config[`${container}Container`];
				if (!containerName) {
					throw new Error(`Unknown container type: ${container}`);
				}
				
				return await this.getContainerLogs(containerName, since, until, maxLines);
			}

		} catch (error) {
			logger.error("Failed to read container logs:", error);
			throw error;
		}
	}

	/**
	 * Get logs from a specific container
	 */
	async getContainerLogs(containerName, since, until, maxLines) {
		try {
			let cmd = `docker logs ${containerName}`;
			
			if (since) cmd += ` --since "${since}"`;
			if (until) cmd += ` --until "${until}"`;
			if (maxLines) cmd += ` --tail ${maxLines}`;
			cmd += " --timestamps";

			const { exec } = await import("node:util");
			const execPromise = exec(cmd);
			const { stdout, stderr } = await execPromise;
			
			const logs = [];
			const lines = (stdout + stderr).split('\\n').filter(line => line.trim());
			
			for (const line of lines) {
				const match = line.match(/^(\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d+Z)\\s+(.*)$/);
				if (match) {
					logs.push({
						timestamp: match[1],
						message: match[2],
						source: "container"
					});
				}
			}
			
			return logs;

		} catch (error) {
			logger.error(`Failed to get logs for container ${containerName}:`, error);
			return [];
		}
	}

	/**
	 * Format logs according to specified format
	 */
	formatLogs(data, format) {
		switch (format.toLowerCase()) {
			case "json":
				return JSON.stringify(data, null, 2);
			case "text":
				return data.logs.map(log => 
					`${log.timestamp} [${log.level || 'INFO'}] ${log.message}`
				).join('\\n');
			case "csv":
				const headers = ["timestamp", "level", "message", "component"];
				const csvRows = [headers.join(",")];
				for (const log of data.logs) {
					const values = headers.map(header => log[header] || "");
					csvRows.push(values.join(","));
				}
				return csvRows.join("\\n");
			default:
				return data;
		}
	}
}