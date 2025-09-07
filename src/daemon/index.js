import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DaemonServer } from "./server.js";
import { ConfigManager } from "./services/ConfigManager.js";
import { InstanceManager } from "./services/InstanceManager.js";
import { DockerOrchestrator } from "./services/DockerOrchestrator.js";
import { PortManager } from "./services/PortManager.js";
import { HealthMonitor } from "./services/HealthMonitor.js";
import { logger } from "./utils/logger.js";

/**
 * Arakyd Draftsman Daemon
 * 
 * Main daemon process that provides HTTP/WebSocket APIs for instance management,
 * Docker orchestration, and integration with ndoc components.
 */
class ArakydDaemon {
	constructor() {
		this.server = null;
		this.services = {};
		this.isRunning = false;
	}

	/**
	 * Initialize and start the daemon
	 */
	async start() {
		try {
			logger.info("Starting Arakyd Draftsman Daemon...");

			// Load configuration
			await this.loadConfiguration();

			// Initialize core services
			await this.initializeServices();

			// Start HTTP/WebSocket server
			await this.startServer();

			// Setup graceful shutdown handlers
			this.setupShutdownHandlers();

			this.isRunning = true;
			logger.info("Arakyd Draftsman Daemon started successfully");
		} catch (error) {
			logger.error("Failed to start daemon:", error);
			process.exit(1);
		}
	}

	/**
	 * Load daemon configuration
	 */
	async loadConfiguration() {
		try {
			this.services.config = new ConfigManager();
			await this.services.config.initialize();
			logger.info("Configuration loaded successfully");
		} catch (error) {
			logger.error("Failed to load configuration:", error);
			throw error;
		}
	}

	/**
	 * Initialize all core services
	 */
	async initializeServices() {
		const config = this.services.config.getConfig();

		// Initialize port manager
		this.services.portManager = new PortManager(config.daemon.portRange);

		// Initialize Docker orchestrator
		this.services.dockerOrchestrator = new DockerOrchestrator(
			config.daemon.docker,
			this.services.portManager
		);

		// Initialize instance manager
		this.services.instanceManager = new InstanceManager(
			this.services.dockerOrchestrator,
			this.services.config
		);

		// Initialize health monitor
		this.services.healthMonitor = new HealthMonitor(
			this.services.instanceManager,
			this.services.dockerOrchestrator
		);

		// Start services that need initialization
		await this.services.dockerOrchestrator.initialize();
		await this.services.instanceManager.initialize();
		await this.services.healthMonitor.start();

		logger.info("All services initialized successfully");
	}

	/**
	 * Start the HTTP/WebSocket server
	 */
	async startServer() {
		const config = this.services.config.getConfig();
		
		this.server = new DaemonServer(this.services, config.daemon);
		await this.server.start();

		logger.info(`Server started on ${config.daemon.host}:${config.daemon.port}`);
	}

	/**
	 * Setup graceful shutdown handlers
	 */
	setupShutdownHandlers() {
		const shutdown = async (signal) => {
			logger.info(`Received ${signal}, shutting down gracefully...`);
			await this.stop();
			process.exit(0);
		};

		process.on("SIGTERM", shutdown);
		process.on("SIGINT", shutdown);
		process.on("SIGHUP", shutdown);
	}

	/**
	 * Stop the daemon and cleanup resources
	 */
	async stop() {
		if (!this.isRunning) {
			return;
		}

		logger.info("Stopping Arakyd Draftsman Daemon...");

		try {
			// Stop health monitoring
			if (this.services.healthMonitor) {
				await this.services.healthMonitor.stop();
			}

			// Stop server
			if (this.server) {
				await this.server.stop();
			}

			// Stop all instances
			if (this.services.instanceManager) {
				await this.services.instanceManager.stopAll();
			}

			// Cleanup Docker resources
			if (this.services.dockerOrchestrator) {
				await this.services.dockerOrchestrator.cleanup();
			}

			this.isRunning = false;
			logger.info("Daemon stopped successfully");
		} catch (error) {
			logger.error("Error during shutdown:", error);
		}
	}

	/**
	 * Get daemon status information
	 */
	getStatus() {
		return {
			isRunning: this.isRunning,
			version: this.getVersion(),
			uptime: process.uptime(),
			services: Object.keys(this.services),
			memory: process.memoryUsage(),
			pid: process.pid
		};
	}

	/**
	 * Get daemon version from package.json
	 */
	getVersion() {
		try {
			// This will be loaded dynamically in a real implementation
			return "0.18.1";
		} catch {
			return "unknown";
		}
	}
}

// Start daemon if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
	const daemon = new ArakydDaemon();
	await daemon.start();
}

export { ArakydDaemon };