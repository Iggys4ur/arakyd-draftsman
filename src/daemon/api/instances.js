import { Router } from "express";
import { logger } from "../utils/logger.js";

/**
 * Create instances API router
 */
export function createInstancesRouter(services) {
	const router = Router();
	const { instanceManager } = services;

	/**
	 * GET /api/v1/instances
	 * List all instances
	 */
	router.get("/", async (req, res, next) => {
		try {
			const instances = instanceManager.getAllInstances();
			const stats = instanceManager.getInstanceStats();

			res.json({
				instances,
				stats,
				timestamp: new Date().toISOString()
			});
		} catch (error) {
			next(error);
		}
	});

	/**
	 * POST /api/v1/instances
	 * Create a new instance
	 */
	router.post("/", async (req, res, next) => {
		try {
			const {
				label,
				tag = "latest",
				ports = {},
				environment = {},
				enableTelemetry = false,
				makeDefault = false
			} = req.body;

			// Validate required fields
			if (!label || label.trim().length === 0) {
				return res.status(400).json({
					error: "Validation Error",
					message: "Instance label is required",
					timestamp: new Date().toISOString()
				});
			}

			const instanceId = await instanceManager.createInstance({
				label: label.trim(),
				tag,
				ports,
				environment,
				enableTelemetry,
				makeDefault
			});

			const instance = instanceManager.getInstance(instanceId);

			res.status(201).json({
				instance,
				message: "Instance created successfully",
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			logger.error("Failed to create instance:", error);
			next(error);
		}
	});

	/**
	 * GET /api/v1/instances/:id
	 * Get instance details
	 */
	router.get("/:id", async (req, res, next) => {
		try {
			const instanceId = req.params.id;
			const instance = instanceManager.getInstance(instanceId);

			res.json({
				instance,
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			if (error.message.includes("not found")) {
				res.status(404).json({
					error: "Not Found",
					message: error.message,
					timestamp: new Date().toISOString()
				});
			} else {
				next(error);
			}
		}
	});

	/**
	 * PUT /api/v1/instances/:id
	 * Update instance configuration
	 */
	router.put("/:id", async (req, res, next) => {
		try {
			const instanceId = req.params.id;
			const updates = req.body;

			await instanceManager.updateInstance(instanceId, updates);
			const instance = instanceManager.getInstance(instanceId);

			res.json({
				instance,
				message: "Instance updated successfully",
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			if (error.message.includes("not found")) {
				res.status(404).json({
					error: "Not Found",
					message: error.message,
					timestamp: new Date().toISOString()
				});
			} else {
				next(error);
			}
		}
	});

	/**
	 * DELETE /api/v1/instances/:id
	 * Remove an instance
	 */
	router.delete("/:id", async (req, res, next) => {
		try {
			const instanceId = req.params.id;
			
			await instanceManager.removeInstance(instanceId);

			res.json({
				message: "Instance removed successfully",
				instanceId,
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			if (error.message.includes("not found")) {
				res.status(404).json({
					error: "Not Found",
					message: error.message,
					timestamp: new Date().toISOString()
				});
			} else {
				next(error);
			}
		}
	});

	/**
	 * POST /api/v1/instances/:id/start
	 * Start an instance
	 */
	router.post("/:id/start", async (req, res, next) => {
		try {
			const instanceId = req.params.id;
			
			await instanceManager.startInstance(instanceId);
			const instance = instanceManager.getInstance(instanceId);

			res.json({
				instance,
				message: "Instance start initiated",
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			if (error.message.includes("not found")) {
				res.status(404).json({
					error: "Not Found",
					message: error.message,
					timestamp: new Date().toISOString()
				});
			} else {
				next(error);
			}
		}
	});

	/**
	 * POST /api/v1/instances/:id/stop
	 * Stop an instance
	 */
	router.post("/:id/stop", async (req, res, next) => {
		try {
			const instanceId = req.params.id;
			
			await instanceManager.stopInstance(instanceId);
			const instance = instanceManager.getInstance(instanceId);

			res.json({
				instance,
				message: "Instance stop initiated",
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			if (error.message.includes("not found")) {
				res.status(404).json({
					error: "Not Found",
					message: error.message,
					timestamp: new Date().toISOString()
				});
			} else {
				next(error);
			}
		}
	});

	/**
	 * GET /api/v1/instances/:id/health
	 * Get instance health status
	 */
	router.get("/:id/health", async (req, res, next) => {
		try {
			const instanceId = req.params.id;
			
			// Check if instance exists
			instanceManager.getInstance(instanceId);
			
			// Get health status
			const health = await services.dockerOrchestrator.getInstanceHealth(instanceId);

			res.json({
				health,
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			if (error.message.includes("not found")) {
				res.status(404).json({
					error: "Not Found",
					message: error.message,
					timestamp: new Date().toISOString()
				});
			} else {
				next(error);
			}
		}
	});

	/**
	 * POST /api/v1/instances/:id/default
	 * Set instance as default
	 */
	router.post("/:id/default", async (req, res, next) => {
		try {
			const instanceId = req.params.id;
			
			await instanceManager.setDefaultInstance(instanceId);
			const instance = instanceManager.getInstance(instanceId);

			res.json({
				instance,
				message: "Instance set as default",
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			if (error.message.includes("not found")) {
				res.status(404).json({
					error: "Not Found",
					message: error.message,
					timestamp: new Date().toISOString()
				});
			} else {
				next(error);
			}
		}
	});

	/**
	 * GET /api/v1/instances/default
	 * Get default instance
	 */
	router.get("/default", async (req, res, next) => {
		try {
			const defaultInstance = instanceManager.getDefaultInstance();

			if (!defaultInstance) {
				return res.status(404).json({
					error: "Not Found",
					message: "No default instance set",
					timestamp: new Date().toISOString()
				});
			}

			res.json({
				instance: defaultInstance,
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			next(error);
		}
	});

	return router;
}