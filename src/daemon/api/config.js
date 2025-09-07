import { Router } from "express";

/**
 * Create configuration API router
 */
export function createConfigRouter(services) {
	const router = Router();
	const { config } = services;

	/**
	 * GET /api/v1/config
	 * Get current daemon configuration
	 */
	router.get("/", async (req, res, next) => {
		try {
			const configuration = config.getConfig();

			// Remove sensitive information
			const safeConfig = { ...configuration };
			// Add any sensitive field filtering here if needed

			res.json({
				config: safeConfig,
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * PUT /api/v1/config
	 * Update daemon configuration
	 */
	router.put("/", async (req, res, next) => {
		try {
			const updates = req.body;

			// Validate configuration updates
			try {
				config.validateConfig({ ...config.getConfig(), ...updates });
			} catch (validationError) {
				return res.status(400).json({
					error: "Validation Error",
					message: validationError.message,
					timestamp: new Date().toISOString()
				});
			}

			await config.updateConfig(updates);
			const updatedConfig = config.getConfig();

			res.json({
				config: updatedConfig,
				message: "Configuration updated successfully",
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * GET /api/v1/config/:path
	 * Get specific configuration value
	 */
	router.get("/:path(*)", async (req, res, next) => {
		try {
			const path = req.params.path;
			const value = config.get(path);

			if (value === undefined) {
				return res.status(404).json({
					error: "Not Found",
					message: `Configuration path '${path}' not found`,
					timestamp: new Date().toISOString()
				});
			}

			res.json({
				path,
				value,
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * PUT /api/v1/config/:path
	 * Set specific configuration value
	 */
	router.put("/:path(*)", async (req, res, next) => {
		try {
			const path = req.params.path;
			const { value } = req.body;

			if (value === undefined) {
				return res.status(400).json({
					error: "Validation Error",
					message: "Value is required",
					timestamp: new Date().toISOString()
				});
			}

			await config.set(path, value);
			const updatedValue = config.get(path);

			res.json({
				path,
				value: updatedValue,
				message: "Configuration value updated successfully",
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			next(error);
		}
	});

	/**
	 * POST /api/v1/config/reset
	 * Reset configuration to defaults
	 */
	router.post("/reset", async (req, res, next) => {
		try {
			await config.resetToDefaults();
			const defaultConfig = config.getConfig();

			res.json({
				config: defaultConfig,
				message: "Configuration reset to defaults",
				timestamp: new Date().toISOString()
			});

		} catch (error) {
			next(error);
		}
	});

	return router;
}