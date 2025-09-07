import { EventEmitter } from "node:events";
import { logger } from "../../daemon/utils/logger.js";

/**
 * Real-time Monitors for s!phon Integration
 * 
 * Provides real-time monitoring capabilities for various aspects
 * of the daemon and instances that can be streamed to s!phon.
 */

/**
 * Performance Monitor
 */
export class PerformanceMonitor extends EventEmitter {
	constructor(services, config = {}) {
		super();
		this.services = services;
		this.config = {
			interval: config.interval || 5000, // 5 seconds
			enableCPUMonitoring: config.enableCPUMonitoring !== false,
			enableMemoryMonitoring: config.enableMemoryMonitoring !== false,
			enableNetworkMonitoring: config.enableNetworkMonitoring !== false,
			enableDiskMonitoring: config.enableDiskMonitoring !== false,
			...config
		};
		this.isRunning = false;
		this.intervalId = null;
		this.lastCPUUsage = null;
		this.baselineMetrics = null;
	}

	/**
	 * Start performance monitoring
	 */
	async start() {
		if (this.isRunning) {
			logger.warn("Performance monitor is already running");
			return;
		}

		this.isRunning = true;
		this.baselineMetrics = await this.collectBaselineMetrics();

		this.intervalId = setInterval(async () => {
			try {
				const metrics = await this.collectPerformanceMetrics();
				this.emit("performance:update", metrics);
			} catch (error) {
				logger.error("Failed to collect performance metrics:", error);
			}
		}, this.config.interval);

		logger.info(`Performance monitor started with ${this.config.interval}ms interval`);
	}

	/**
	 * Stop performance monitoring
	 */
	stop() {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;
		
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		logger.info("Performance monitor stopped");
	}

	/**
	 * Collect baseline metrics for comparison
	 */
	async collectBaselineMetrics() {
		const baseline = {
			timestamp: new Date().toISOString(),
			daemon: {
				startTime: Date.now(),
				initialMemory: process.memoryUsage(),
				initialCPU: process.cpuUsage()
			}
		};

		logger.debug("Collected baseline performance metrics");
		return baseline;
	}

	/**
	 * Collect current performance metrics
	 */
	async collectPerformanceMetrics() {
		const timestamp = new Date().toISOString();
		const metrics = {
			timestamp,
			daemon: await this.collectDaemonMetrics(),
			instances: await this.collectInstanceMetrics(),
			system: await this.collectSystemMetrics()
		};

		// Calculate deltas from baseline
		if (this.baselineMetrics) {
			metrics.deltas = this.calculateMetricDeltas(metrics);
		}

		return metrics;
	}

	/**
	 * Collect daemon-specific metrics
	 */
	async collectDaemonMetrics() {
		const memoryUsage = process.memoryUsage();
		const cpuUsage = process.cpuUsage(this.lastCPUUsage);
		this.lastCPUUsage = process.cpuUsage();

		return {
			memory: {
				rss: memoryUsage.rss,
				heapTotal: memoryUsage.heapTotal,
				heapUsed: memoryUsage.heapUsed,
				external: memoryUsage.external,
				arrayBuffers: memoryUsage.arrayBuffers,
				usage_percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal * 100).toFixed(2)
			},
			cpu: {
				user: cpuUsage.user,
				system: cpuUsage.system,
				usage_percentage: this.calculateCPUPercentage(cpuUsage)
			},
			uptime: process.uptime(),
			pid: process.pid
		};
	}

	/**
	 * Calculate CPU usage percentage
	 */
	calculateCPUPercentage(cpuUsage) {
		const totalTime = cpuUsage.user + cpuUsage.system;
		const intervalMs = this.config.interval * 1000; // Convert to microseconds
		return ((totalTime / intervalMs) * 100).toFixed(2);
	}

	/**
	 * Collect instance-specific metrics
	 */
	async collectInstanceMetrics() {
		const { instanceManager, dockerOrchestrator } = this.services;
		const instances = instanceManager.getAllInstances();
		const instanceMetrics = [];

		for (const instance of instances) {
			try {
				const metrics = await this.collectSingleInstanceMetrics(instance.id);
				instanceMetrics.push({
					instanceId: instance.id,
					label: instance.label,
					...metrics
				});
			} catch (error) {
				instanceMetrics.push({
					instanceId: instance.id,
					label: instance.label,
					error: error.message
				});
			}
		}

		return instanceMetrics;
	}

	/**
	 * Collect metrics for a single instance
	 */
	async collectSingleInstanceMetrics(instanceId) {
		const { dockerOrchestrator } = this.services;
		const config = dockerOrchestrator.getInstanceConfig(instanceId);

		if (!config) {
			throw new Error(`Instance ${instanceId} not found`);
		}

		// Get Docker container stats
		const containerStats = await this.getContainerPerformanceStats(config);
		
		// Get health status
		const health = await dockerOrchestrator.getInstanceHealth(instanceId);

		return {
			containers: containerStats,
			health: health.status,
			ports: config.ports,
			network: await this.getNetworkStats(config.ports)
		};
	}

	/**
	 * Get container performance statistics
	 */
	async getContainerPerformanceStats(config) {
		try {
			const containers = [
				{ name: "frontend", id: config.frontendContainer },
				{ name: "backend", id: config.backendContainer },
				{ name: "redis", id: config.redisContainer },
				{ name: "postgres", id: config.postgresContainer }
			];

			const stats = {};

			for (const container of containers) {
				try {
					const containerStats = await this.getSingleContainerStats(container.id);
					stats[container.name] = containerStats;
				} catch (error) {
					stats[container.name] = { error: error.message };
				}
			}

			return stats;

		} catch (error) {
			logger.error("Failed to get container performance stats:", error);
			throw error;
		}
	}

	/**
	 * Get statistics for a single container
	 */
	async getSingleContainerStats(containerId) {
		try {
			const { exec } = await import("node:util");
			const execPromise = exec(`docker stats --no-stream --format "{{json .}}" ${containerId}`);
			const { stdout } = await execPromise;
			
			const stats = JSON.parse(stdout.trim());
			
			return {
				cpu: stats.CPUPerc,
				memory: {
					usage: stats.MemUsage,
					percentage: stats.MemPerc
				},
				network: {
					input: stats.NetIO?.split(' / ')[0] || "0B",
					output: stats.NetIO?.split(' / ')[1] || "0B"
				},
				block: {
					read: stats.BlockIO?.split(' / ')[0] || "0B",
					write: stats.BlockIO?.split(' / ')[1] || "0B"
				},
				pids: stats.PIDs
			};

		} catch (error) {
			throw new Error(`Failed to get stats for container ${containerId}: ${error.message}`);
		}
	}

	/**
	 * Get network statistics for instance ports
	 */
	async getNetworkStats(ports) {
		const networkStats = {};

		for (const [service, port] of Object.entries(ports)) {
			try {
				const startTime = Date.now();
				const response = await fetch(`http://localhost:${port}`, {
					method: "HEAD",
					timeout: 3000
				});
				const responseTime = Date.now() - startTime;

				networkStats[service] = {
					port,
					accessible: response.ok,
					responseTime,
					status: response.status
				};

			} catch (error) {
				networkStats[service] = {
					port,
					accessible: false,
					error: error.message
				};
			}
		}

		return networkStats;
	}

	/**
	 * Collect system-level metrics
	 */
	async collectSystemMetrics() {
		const systemMetrics = {
			platform: process.platform,
			arch: process.arch,
			nodeVersion: process.version
		};

		// Add OS-specific metrics
		if (process.platform === "linux") {
			systemMetrics.loadAverage = (await import("node:os")).loadavg();
			systemMetrics.freeMemory = (await import("node:os")).freemem();
			systemMetrics.totalMemory = (await import("node:os")).totalmem();
		}

		return systemMetrics;
	}

	/**
	 * Calculate metric deltas from baseline
	 */
	calculateMetricDeltas(currentMetrics) {
		if (!this.baselineMetrics) {
			return null;
		}

		const deltas = {
			timestamp: currentMetrics.timestamp,
			daemon: {
				memory: {
					heapUsed: currentMetrics.daemon.memory.heapUsed - this.baselineMetrics.daemon.initialMemory.heapUsed,
					heapTotal: currentMetrics.daemon.memory.heapTotal - this.baselineMetrics.daemon.initialMemory.heapTotal,
					external: currentMetrics.daemon.memory.external - this.baselineMetrics.daemon.initialMemory.external
				},
				uptime: currentMetrics.daemon.uptime
			}
		};

		return deltas;
	}

	/**
	 * Get current performance summary
	 */
	async getPerformanceSummary() {
		return await this.collectPerformanceMetrics();
	}
}

/**
 * Event Monitor
 */
export class EventMonitor extends EventEmitter {
	constructor(services, config = {}) {
		super();
		this.services = services;
		this.config = {
			bufferSize: config.bufferSize || 1000,
			enableInstanceEvents: config.enableInstanceEvents !== false,
			enableHealthEvents: config.enableHealthEvents !== false,
			enableSystemEvents: config.enableSystemEvents !== false,
			...config
		};
		this.eventBuffer = [];
		this.isRunning = false;
	}

	/**
	 * Start event monitoring
	 */
	start() {
		if (this.isRunning) {
			logger.warn("Event monitor is already running");
			return;
		}

		this.isRunning = true;
		this.subscribeToEvents();
		logger.info("Event monitor started");
	}

	/**
	 * Stop event monitoring
	 */
	stop() {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;
		this.unsubscribeFromEvents();
		logger.info("Event monitor stopped");
	}

	/**
	 * Subscribe to daemon events
	 */
	subscribeToEvents() {
		const { instanceManager, healthMonitor } = this.services;

		if (this.config.enableInstanceEvents) {
			// Instance events
			instanceManager.on("instance:created", (instance) => {
				this.handleEvent("instance:created", instance);
			});

			instanceManager.on("instance:removed", (instance) => {
				this.handleEvent("instance:removed", instance);
			});

			instanceManager.on("instance:started", (instance) => {
				this.handleEvent("instance:started", instance);
			});

			instanceManager.on("instance:stopped", (instance) => {
				this.handleEvent("instance:stopped", instance);
			});

			instanceManager.on("instance:updated", (instance) => {
				this.handleEvent("instance:updated", instance);
			});
		}

		if (this.config.enableHealthEvents) {
			// Health events
			healthMonitor.on("health:update", (health) => {
				this.handleEvent("health:update", health);
			});

			healthMonitor.on("instance:status_changed", (data) => {
				this.handleEvent("instance:status_changed", data);
			});

			healthMonitor.on("daemon:status_changed", (data) => {
				this.handleEvent("daemon:status_changed", data);
			});
		}

		if (this.config.enableSystemEvents) {
			// System events
			process.on("warning", (warning) => {
				this.handleEvent("system:warning", {
					name: warning.name,
					message: warning.message,
					stack: warning.stack
				});
			});

			process.on("uncaughtException", (error) => {
				this.handleEvent("system:uncaught_exception", {
					message: error.message,
					stack: error.stack
				});
			});

			process.on("unhandledRejection", (reason, promise) => {
				this.handleEvent("system:unhandled_rejection", {
					reason: reason?.toString(),
					promise: promise?.toString()
				});
			});
		}
	}

	/**
	 * Handle incoming events
	 */
	handleEvent(eventType, data) {
		if (!this.isRunning) {
			return;
		}

		const event = {
			id: Math.random().toString(36).substr(2, 9),
			type: eventType,
			data,
			timestamp: new Date().toISOString(),
			source: "arakyd-draftsman"
		};

		// Add to buffer
		this.eventBuffer.push(event);

		// Trim buffer if necessary
		if (this.eventBuffer.length > this.config.bufferSize) {
			this.eventBuffer = this.eventBuffer.slice(-this.config.bufferSize);
		}

		// Emit for external consumers
		this.emit("event", event);
		this.emit(eventType, event);

		logger.debug(`Event captured: ${eventType}`);
	}

	/**
	 * Unsubscribe from events
	 */
	unsubscribeFromEvents() {
		const { instanceManager, healthMonitor } = this.services;

		// Remove all listeners that we added
		instanceManager.removeAllListeners();
		healthMonitor.removeAllListeners();
	}

	/**
	 * Get recent events
	 */
	getRecentEvents(limit = 100, eventType = null) {
		let events = this.eventBuffer;

		if (eventType) {
			events = events.filter(event => event.type === eventType);
		}

		return events.slice(-limit);
	}

	/**
	 * Get event statistics
	 */
	getEventStatistics() {
		const stats = {
			totalEvents: this.eventBuffer.length,
			eventTypes: {},
			recentActivity: {
				lastHour: 0,
				lastMinute: 0
			}
		};

		const now = Date.now();
		const oneHourAgo = now - (60 * 60 * 1000);
		const oneMinuteAgo = now - (60 * 1000);

		for (const event of this.eventBuffer) {
			// Count by type
			stats.eventTypes[event.type] = (stats.eventTypes[event.type] || 0) + 1;

			// Count recent activity
			const eventTime = new Date(event.timestamp).getTime();
			if (eventTime > oneHourAgo) {
				stats.recentActivity.lastHour++;
			}
			if (eventTime > oneMinuteAgo) {
				stats.recentActivity.lastMinute++;
			}
		}

		return stats;
	}

	/**
	 * Clear event buffer
	 */
	clearEventBuffer() {
		this.eventBuffer = [];
		logger.info("Event buffer cleared");
	}
}