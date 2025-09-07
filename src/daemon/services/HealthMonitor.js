import { EventEmitter } from "node:events";
import { logger } from "../utils/logger.js";

/**
 * Health Monitor for the Arakyd Daemon
 * 
 * Monitors the health of instances and the daemon itself, providing
 * real-time health status updates and alerting.
 */
export class HealthMonitor extends EventEmitter {
	constructor(instanceManager, dockerOrchestrator) {
		super();
		this.instanceManager = instanceManager;
		this.dockerOrchestrator = dockerOrchestrator;
		this.healthCheckInterval = 30000; // 30 seconds default
		this.isRunning = false;
		this.intervalId = null;
		this.healthHistory = new Map(); // instanceId -> health records
		this.daemonStartTime = Date.now();
	}

	/**
	 * Start health monitoring
	 */
	async start(interval = this.healthCheckInterval) {
		if (this.isRunning) {
			logger.warn("Health monitor is already running");
			return;
		}

		this.healthCheckInterval = interval;
		this.isRunning = true;
		this.daemonStartTime = Date.now();

		// Perform initial health check
		await this.performHealthCheck();

		// Schedule regular health checks
		this.intervalId = setInterval(async () => {
			try {
				await this.performHealthCheck();
			} catch (error) {
				logger.error("Health check failed:", error);
			}
		}, this.healthCheckInterval);

		logger.info(`Health monitor started with ${interval}ms interval`);
	}

	/**
	 * Stop health monitoring
	 */
	async stop() {
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;

		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}

		logger.info("Health monitor stopped");
	}

	/**
	 * Perform comprehensive health check
	 */
	async performHealthCheck() {
		const healthReport = {
			timestamp: new Date().toISOString(),
			daemon: await this.checkDaemonHealth(),
			docker: await this.checkDockerHealth(),
			instances: await this.checkInstancesHealth(),
			overall: "healthy"
		};

		// Determine overall health status
		if (healthReport.daemon.status !== "healthy" || healthReport.docker.status !== "healthy") {
			healthReport.overall = "unhealthy";
		} else {
			const unhealthyInstances = Object.values(healthReport.instances)
				.filter(instance => instance.status === "unhealthy").length;
			
			if (unhealthyInstances > 0) {
				healthReport.overall = "degraded";
			}
		}

		// Store health history
		this.updateHealthHistory(healthReport);

		// Emit health update event
		this.emit("health:update", healthReport);

		// Check for status changes and emit specific events
		await this.checkForStatusChanges(healthReport);

		return healthReport;
	}

	/**
	 * Check daemon health
	 */
	async checkDaemonHealth() {
		const memoryUsage = process.memoryUsage();
		const uptime = Date.now() - this.daemonStartTime;
		
		const health = {
			status: "healthy",
			uptime,
			memory: {
				used: memoryUsage.heapUsed,
				total: memoryUsage.heapTotal,
				external: memoryUsage.external,
				usage_percentage: (memoryUsage.heapUsed / memoryUsage.heapTotal * 100).toFixed(2)
			},
			pid: process.pid,
			node_version: process.version,
			platform: process.platform,
			arch: process.arch
		};

		// Check memory usage
		if (health.memory.usage_percentage > 90) {
			health.status = "unhealthy";
			health.issues = ["High memory usage"];
		} else if (health.memory.usage_percentage > 75) {
			health.status = "degraded";
			health.issues = ["Elevated memory usage"];
		}

		return health;
	}

	/**
	 * Check Docker health
	 */
	async checkDockerHealth() {
		try {
			// Check if Docker is available
			await this.dockerOrchestrator.checkDockerAvailability();
			
			return {
				status: "healthy",
				available: true,
				version: await this.getDockerVersion()
			};
		} catch (error) {
			return {
				status: "unhealthy",
				available: false,
				error: error.message
			};
		}
	}

	/**
	 * Get Docker version information
	 */
	async getDockerVersion() {
		try {
			const { exec } = await import("node:util");
			const execPromise = exec("docker --version");
			const { stdout } = await execPromise;
			return stdout.trim();
		} catch (error) {
			return "unknown";
		}
	}

	/**
	 * Check health of all instances
	 */
	async checkInstancesHealth() {
		const instances = this.instanceManager.getAllInstances();
		const healthResults = {};

		for (const instance of instances) {
			try {
				const health = await this.dockerOrchestrator.getInstanceHealth(instance.id);
				
				// Enhanced health check with connectivity test
				if (health.status === "healthy") {
					const connectivityCheck = await this.checkInstanceConnectivity(instance);
					health.connectivity = connectivityCheck;
					
					if (!connectivityCheck.accessible) {
						health.status = "degraded";
					}
				}

				// Update instance status in manager
				const currentInstance = this.instanceManager.getInstance(instance.id);
				if (currentInstance.status !== health.status) {
					currentInstance.status = health.status;
					currentInstance.lastHealthCheck = new Date().toISOString();
				}

				healthResults[instance.id] = {
					...health,
					label: instance.label,
					lastChecked: new Date().toISOString()
				};

			} catch (error) {
				healthResults[instance.id] = {
					instanceId: instance.id,
					label: instance.label,
					status: "error",
					error: error.message,
					lastChecked: new Date().toISOString()
				};
			}
		}

		return healthResults;
	}

	/**
	 * Check instance connectivity
	 */
	async checkInstanceConnectivity(instance) {
		try {
			const response = await fetch(`${instance.origin}/health`, {
				method: "GET",
				timeout: 5000
			});

			return {
				accessible: response.ok,
				status_code: response.status,
				response_time: Date.now() // Would need actual timing
			};
		} catch (error) {
			return {
				accessible: false,
				error: error.message
			};
		}
	}

	/**
	 * Update health history
	 */
	updateHealthHistory(healthReport) {
		const timestamp = healthReport.timestamp;
		
		// Store daemon health history
		if (!this.healthHistory.has("daemon")) {
			this.healthHistory.set("daemon", []);
		}
		
		const daemonHistory = this.healthHistory.get("daemon");
		daemonHistory.push({
			timestamp,
			status: healthReport.daemon.status,
			memory_usage: healthReport.daemon.memory.usage_percentage
		});

		// Keep only last 100 records
		if (daemonHistory.length > 100) {
			daemonHistory.splice(0, daemonHistory.length - 100);
		}

		// Store instance health history
		for (const [instanceId, instanceHealth] of Object.entries(healthReport.instances)) {
			if (!this.healthHistory.has(instanceId)) {
				this.healthHistory.set(instanceId, []);
			}

			const instanceHistory = this.healthHistory.get(instanceId);
			instanceHistory.push({
				timestamp,
				status: instanceHealth.status,
				connectivity: instanceHealth.connectivity?.accessible || false
			});

			// Keep only last 100 records
			if (instanceHistory.length > 100) {
				instanceHistory.splice(0, instanceHistory.length - 100);
			}
		}
	}

	/**
	 * Check for status changes and emit events
	 */
	async checkForStatusChanges(healthReport) {
		// Check for instance status changes
		for (const [instanceId, instanceHealth] of Object.entries(healthReport.instances)) {
			const history = this.healthHistory.get(instanceId);
			if (history && history.length > 1) {
				const previousStatus = history[history.length - 2].status;
				const currentStatus = instanceHealth.status;

				if (previousStatus !== currentStatus) {
					this.emit("instance:status_changed", {
						instanceId,
						previousStatus,
						currentStatus,
						timestamp: healthReport.timestamp
					});

					logger.info(`Instance ${instanceId} status changed: ${previousStatus} -> ${currentStatus}`);
				}
			}
		}

		// Check for daemon status changes
		const daemonHistory = this.healthHistory.get("daemon");
		if (daemonHistory && daemonHistory.length > 1) {
			const previousStatus = daemonHistory[daemonHistory.length - 2].status;
			const currentStatus = healthReport.daemon.status;

			if (previousStatus !== currentStatus) {
				this.emit("daemon:status_changed", {
					previousStatus,
					currentStatus,
					timestamp: healthReport.timestamp
				});

				logger.info(`Daemon status changed: ${previousStatus} -> ${currentStatus}`);
			}
		}
	}

	/**
	 * Get current health status
	 */
	async getCurrentHealth() {
		return await this.performHealthCheck();
	}

	/**
	 * Get health history for a specific target
	 */
	getHealthHistory(target = "daemon", limit = 50) {
		const history = this.healthHistory.get(target);
		if (!history) {
			return [];
		}

		return history.slice(-limit);
	}

	/**
	 * Get health summary
	 */
	getHealthSummary() {
		const instances = this.instanceManager.getAllInstances();
		const summary = {
			daemon: {
				status: "unknown",
				uptime: Date.now() - this.daemonStartTime
			},
			instances: {
				total: instances.length,
				healthy: 0,
				unhealthy: 0,
				degraded: 0,
				error: 0
			},
			last_check: null
		};

		// Get latest health status from history
		const daemonHistory = this.healthHistory.get("daemon");
		if (daemonHistory && daemonHistory.length > 0) {
			const latest = daemonHistory[daemonHistory.length - 1];
			summary.daemon.status = latest.status;
			summary.last_check = latest.timestamp;
		}

		// Count instance statuses
		for (const instance of instances) {
			const history = this.healthHistory.get(instance.id);
			if (history && history.length > 0) {
				const status = history[history.length - 1].status;
				if (status in summary.instances) {
					summary.instances[status]++;
				}
			}
		}

		return summary;
	}

	/**
	 * Update health check interval
	 */
	updateInterval(newInterval) {
		if (this.isRunning) {
			this.stop();
			this.start(newInterval);
		} else {
			this.healthCheckInterval = newInterval;
		}

		logger.info(`Health check interval updated to ${newInterval}ms`);
	}
}