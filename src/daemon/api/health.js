import { Router } from "express";

/**
 * Create health API router
 */
export function createHealthRouter(services) {
	const router = Router();
	const { healthMonitor } = services;

	/**
	 * GET /api/v1/health
	 * Get current system health status
	 */
	router.get("/", async (req, res, next) => {
		try {
			const health = await healthMonitor.getCurrentHealth();

			// Set appropriate HTTP status based on health
			let status = 200;
			if (health.overall === "unhealthy") {
				status = 503; // Service Unavailable
			} else if (health.overall === "degraded") {
				status = 200; // OK but with warnings
			}

			res.status(status).json(health);

		} catch (error) {
			next(error);
		}
	});

	/**
	 * GET /api/v1/health/summary
	 * Get health summary
	 */
	router.get("/summary", async (req, res, next) => {
		try {
			const summary = healthMonitor.getHealthSummary();

			res.json({
				summary,
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * GET /api/v1/health/daemon
	 * Get daemon-specific health status
	 */
	router.get("/daemon", async (req, res, next) => {
		try {
			const health = await healthMonitor.getCurrentHealth();

			res.json({
				daemon: health.daemon,
				timestamp: health.timestamp
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * GET /api/v1/health/docker
	 * Get Docker health status
	 */
	router.get("/docker", async (req, res, next) => {
		try {
			const health = await healthMonitor.getCurrentHealth();

			res.json({
				docker: health.docker,
				timestamp: health.timestamp
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * GET /api/v1/health/instances
	 * Get all instances health status
	 */
	router.get("/instances", async (req, res, next) => {
		try {
			const health = await healthMonitor.getCurrentHealth();

			res.json({
				instances: health.instances,
				timestamp: health.timestamp
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * GET /api/v1/health/instances/:id
	 * Get specific instance health status
	 */
	router.get("/instances/:id", async (req, res, next) => {
		try {
			const instanceId = req.params.id;
			const health = await healthMonitor.getCurrentHealth();

			if (!health.instances[instanceId]) {
				return res.status(404).json({
					error: "Not Found",
					message: `Instance ${instanceId} not found`,
					timestamp: new Date().toISOString()
				});
			}

			res.json({
				instance: health.instances[instanceId],
				timestamp: health.timestamp
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * GET /api/v1/health/history/:target
	 * Get health history for a specific target (daemon or instance ID)
	 */
	router.get("/history/:target", async (req, res, next) => {
		try {
			const target = req.params.target;
			const limit = parseInt(req.query.limit) || 50;

			const history = healthMonitor.getHealthHistory(target, limit);

			if (history.length === 0) {
				return res.status(404).json({
					error: "Not Found",
					message: `No health history found for target: ${target}`,
					timestamp: new Date().toISOString()
				});
			}

			res.json({
				target,
				history,
				count: history.length,
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * PUT /api/v1/health/interval
	 * Update health check interval
	 */
	router.put("/interval", async (req, res, next) => {
		try {
			const { interval } = req.body;

			if (!interval || typeof interval !== "number" || interval < 1000) {
				return res.status(400).json({
					error: "Validation Error",
					message: "Interval must be a number >= 1000 (milliseconds)",
					timestamp: new Date().toISOString()
				});
			}

			healthMonitor.updateInterval(interval);

			res.json({
				interval,
				message: "Health check interval updated successfully",
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * POST /api/v1/health/check
	 * Force a health check
	 */
	router.post("/check", async (req, res, next) => {
		try {
			const health = await healthMonitor.performHealthCheck();

			res.json({
				...health,
				message: "Health check performed successfully"
			});

		} catch (error) {
			next(error);
		}
	});

	return router;
}