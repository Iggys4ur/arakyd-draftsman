import { Router } from "express";

/**
 * Create metrics API router
 */
export function createMetricsRouter(services) {
	const router = Router();
	const { instanceManager, portManager, healthMonitor } = services;

	/**
	 * GET /api/v1/metrics
	 * Get comprehensive daemon metrics
	 */
	router.get("/", async (req, res, next) => {
		try {
			const metrics = {
				daemon: getDaemonMetrics(),
				instances: getInstanceMetrics(instanceManager),
				ports: getPortMetrics(portManager),
				health: getHealthMetrics(healthMonitor),
				timestamp: new Date().toISOString()
			};

			res.json(metrics);

		} catch (error) {
			next(error);
		}
	});

	/**
	 * GET /api/v1/metrics/daemon
	 * Get daemon-specific metrics
	 */
	router.get("/daemon", async (req, res, next) => {
		try {
			const metrics = getDaemonMetrics();

			res.json({
				daemon: metrics,
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * GET /api/v1/metrics/instances
	 * Get instance-related metrics
	 */
	router.get("/instances", async (req, res, next) => {
		try {
			const metrics = getInstanceMetrics(instanceManager);

			res.json({
				instances: metrics,
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * GET /api/v1/metrics/ports
	 * Get port usage metrics
	 */
	router.get("/ports", async (req, res, next) => {
		try {
			const metrics = getPortMetrics(portManager);

			res.json({
				ports: metrics,
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * GET /api/v1/metrics/health
	 * Get health-related metrics
	 */
	router.get("/health", async (req, res, next) => {
		try {
			const metrics = getHealthMetrics(healthMonitor);

			res.json({
				health: metrics,
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * GET /api/v1/metrics/prometheus
	 * Get metrics in Prometheus format
	 */
	router.get("/prometheus", async (req, res, next) => {
		try {
			const prometheusMetrics = generatePrometheusMetrics(services);

			res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
			res.send(prometheusMetrics);

		} catch (error) {
			next(error);
		}
	});

	return router;
}

/**
 * Get daemon-specific metrics
 */
function getDaemonMetrics() {
	const memoryUsage = process.memoryUsage();
	const cpuUsage = process.cpuUsage();

	return {
		uptime: process.uptime(),
		pid: process.pid,
		version: process.version,
		platform: process.platform,
		arch: process.arch,
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
			system: cpuUsage.system
		}
	};
}

/**
 * Get instance-related metrics
 */
function getInstanceMetrics(instanceManager) {
	const stats = instanceManager.getInstanceStats();
	const instances = instanceManager.getAllInstances();

	// Calculate additional metrics
	const tagDistribution = {};
	const ageDistribution = { "< 1h": 0, "1h-24h": 0, "> 24h": 0 };
	const now = Date.now();

	for (const instance of instances) {
		// Tag distribution
		tagDistribution[instance.tag] = (tagDistribution[instance.tag] || 0) + 1;

		// Age distribution
		const age = now - new Date(instance.createdAt).getTime();
		const ageHours = age / (1000 * 60 * 60);

		if (ageHours < 1) {
			ageDistribution["< 1h"]++;
		} else if (ageHours < 24) {
			ageDistribution["1h-24h"]++;
		} else {
			ageDistribution["> 24h"]++;
		}
	}

	return {
		...stats,
		tagDistribution,
		ageDistribution,
		averageAge: instances.length > 0 
			? instances.reduce((sum, instance) => {
				return sum + (now - new Date(instance.createdAt).getTime());
			}, 0) / instances.length / (1000 * 60 * 60) // in hours
			: 0
	};
}

/**
 * Get port usage metrics
 */
function getPortMetrics(portManager) {
	const stats = portManager.getUsageStats();
	const allocatedPorts = portManager.getAllocatedPorts();
	const reservedPorts = portManager.getReservedPorts();

	return {
		...stats,
		allocatedPorts,
		reservedPorts,
		portRange: portManager.portRange
	};
}

/**
 * Get health-related metrics
 */
function getHealthMetrics(healthMonitor) {
	const summary = healthMonitor.getHealthSummary();
	
	return {
		...summary,
		monitoring: {
			isRunning: healthMonitor.isRunning,
			interval: healthMonitor.healthCheckInterval
		}
	};
}

/**
 * Generate metrics in Prometheus format
 */
function generatePrometheusMetrics(services) {
	const { instanceManager, portManager, healthMonitor } = services;
	const timestamp = Date.now();

	let metrics = [];

	// Daemon metrics
	const daemonMetrics = getDaemonMetrics();
	metrics.push(`# HELP arakyd_daemon_uptime_seconds Daemon uptime in seconds`);
	metrics.push(`# TYPE arakyd_daemon_uptime_seconds counter`);
	metrics.push(`arakyd_daemon_uptime_seconds ${daemonMetrics.uptime} ${timestamp}`);

	metrics.push(`# HELP arakyd_daemon_memory_usage_bytes Memory usage in bytes`);
	metrics.push(`# TYPE arakyd_daemon_memory_usage_bytes gauge`);
	metrics.push(`arakyd_daemon_memory_usage_bytes{type="heap_used"} ${daemonMetrics.memory.heapUsed} ${timestamp}`);
	metrics.push(`arakyd_daemon_memory_usage_bytes{type="heap_total"} ${daemonMetrics.memory.heapTotal} ${timestamp}`);
	metrics.push(`arakyd_daemon_memory_usage_bytes{type="external"} ${daemonMetrics.memory.external} ${timestamp}`);

	// Instance metrics
	const instanceStats = instanceManager.getInstanceStats();
	metrics.push(`# HELP arakyd_instances_total Total number of instances`);
	metrics.push(`# TYPE arakyd_instances_total gauge`);
	metrics.push(`arakyd_instances_total ${instanceStats.total} ${timestamp}`);

	metrics.push(`# HELP arakyd_instances_by_status Number of instances by status`);
	metrics.push(`# TYPE arakyd_instances_by_status gauge`);
	metrics.push(`arakyd_instances_by_status{status="running"} ${instanceStats.running} ${timestamp}`);
	metrics.push(`arakyd_instances_by_status{status="stopped"} ${instanceStats.stopped} ${timestamp}`);
	metrics.push(`arakyd_instances_by_status{status="starting"} ${instanceStats.starting} ${timestamp}`);
	metrics.push(`arakyd_instances_by_status{status="error"} ${instanceStats.error} ${timestamp}`);

	// Port metrics
	const portStats = portManager.getUsageStats();
	metrics.push(`# HELP arakyd_ports_total Total number of ports in range`);
	metrics.push(`# TYPE arakyd_ports_total gauge`);
	metrics.push(`arakyd_ports_total ${portStats.totalPorts} ${timestamp}`);

	metrics.push(`# HELP arakyd_ports_allocated Number of allocated ports`);
	metrics.push(`# TYPE arakyd_ports_allocated gauge`);
	metrics.push(`arakyd_ports_allocated ${portStats.allocatedCount} ${timestamp}`);

	metrics.push(`# HELP arakyd_ports_reserved Number of reserved ports`);
	metrics.push(`# TYPE arakyd_ports_reserved gauge`);
	metrics.push(`arakyd_ports_reserved ${portStats.reservedCount} ${timestamp}`);

	// Health metrics
	const healthSummary = healthMonitor.getHealthSummary();
	metrics.push(`# HELP arakyd_health_status Health status (1=healthy, 0=unhealthy)`);
	metrics.push(`# TYPE arakyd_health_status gauge`);
	metrics.push(`arakyd_health_status{component="daemon"} ${healthSummary.daemon.status === "healthy" ? 1 : 0} ${timestamp}`);

	return metrics.join("\\n") + "\\n";
}