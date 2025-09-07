import { EventEmitter } from "node:events";
import { logger } from "../utils/logger.js";
import { generateId } from "../../tools/id.js";

/**
 * Instance Manager for the Arakyd Daemon
 * 
 * Manages the lifecycle of Penpot instances, including creation, configuration,
 * and registry management. Enhanced version of functionality from src/process/instance.js
 */
export class InstanceManager extends EventEmitter {
	constructor(dockerOrchestrator, configManager) {
		super();
		this.dockerOrchestrator = dockerOrchestrator;
		this.configManager = configManager;
		this.instances = new Map(); // instanceId -> instanceInfo
		this.defaultInstanceId = null;
	}

	/**
	 * Initialize the instance manager
	 */
	async initialize() {
		await this.loadExistingInstances();
		logger.info("Instance manager initialized successfully");
	}

	/**
	 * Load existing instances from configuration
	 */
	async loadExistingInstances() {
		const config = this.configManager.getConfig();
		const storedInstances = config.instances || {};

		for (const [instanceId, instanceConfig] of Object.entries(storedInstances)) {
			try {
				// Verify instance still exists in Docker
				const health = await this.dockerOrchestrator.getInstanceHealth(instanceId);
				
				if (health.status !== "not_found") {
					this.instances.set(instanceId, {
						id: instanceId,
						...instanceConfig,
						status: health.status,
						createdAt: new Date().toISOString() // Will be enhanced to store actual creation time
					});

					if (instanceConfig.isDefault) {
						this.defaultInstanceId = instanceId;
					}
				} else {
					logger.warn(`Stored instance ${instanceId} not found in Docker, removing from registry`);
				}
			} catch (error) {
				logger.error(`Failed to verify instance ${instanceId}:`, error);
			}
		}

		logger.info(`Loaded ${this.instances.size} existing instances`);
	}

	/**
	 * Create a new Penpot instance
	 * 
	 * @param {Object} instanceRequest - Instance creation request
	 * @returns {Promise<string>} - Instance ID
	 */
	async createInstance(instanceRequest) {
		const {
			label,
			tag = "latest",
			ports = {},
			environment = {},
			enableTelemetry = false,
			makeDefault = false
		} = instanceRequest;

		// Validate input
		if (!label || label.trim().length === 0) {
			throw new Error("Instance label is required");
		}

		// Check instance limits
		const config = this.configManager.getConfig();
		if (this.instances.size >= config.daemon.maxInstances) {
			throw new Error(`Maximum number of instances (${config.daemon.maxInstances}) reached`);
		}

		const instanceId = generateId();
		
		try {
			logger.info(`Creating instance ${instanceId} with label: ${label}`);

			// Create Docker containers
			const containerConfig = await this.dockerOrchestrator.createInstance(instanceId, {
				tag,
				ports,
				environment,
				enableTelemetry
			});

			// Create instance registry entry
			const instance = {
				id: instanceId,
				label: label.trim(),
				tag,
				origin: `http://localhost:${containerConfig.ports.frontend}`,
				ports: containerConfig.ports,
				status: "starting",
				enableTelemetry,
				isDefault: makeDefault,
				createdAt: new Date().toISOString(),
				lastHealthCheck: null,
				environment
			};

			// Add to registry
			this.instances.set(instanceId, instance);

			// Update default if requested
			if (makeDefault) {
				await this.setDefaultInstance(instanceId);
			}

			// Persist to configuration
			await this.persistInstance(instanceId);

			// Emit creation event
			this.emit("instance:created", instance);

			logger.info(`Instance ${instanceId} created successfully`);
			return instanceId;

		} catch (error) {
			logger.error(`Failed to create instance ${instanceId}:`, error);
			
			// Cleanup on failure
			try {
				await this.dockerOrchestrator.cleanup(instanceId);
				this.instances.delete(instanceId);
			} catch (cleanupError) {
				logger.error(`Failed to cleanup failed instance ${instanceId}:`, cleanupError);
			}

			throw error;
		}
	}

	/**
	 * Remove an instance
	 * 
	 * @param {string} instanceId - Instance ID to remove
	 */
	async removeInstance(instanceId) {
		const instance = this.instances.get(instanceId);
		if (!instance) {
			throw new Error(`Instance ${instanceId} not found`);
		}

		try {
			logger.info(`Removing instance ${instanceId}`);

			// Remove Docker containers
			await this.dockerOrchestrator.removeInstance(instanceId);

			// Remove from registry
			this.instances.delete(instanceId);

			// Update default if this was the default instance
			if (this.defaultInstanceId === instanceId) {
				this.defaultInstanceId = null;
				
				// Set a new default if other instances exist
				const remainingInstances = Array.from(this.instances.keys());
				if (remainingInstances.length > 0) {
					await this.setDefaultInstance(remainingInstances[0]);
				}
			}

			// Remove from persistent storage
			await this.unpersistInstance(instanceId);

			// Emit removal event
			this.emit("instance:removed", { id: instanceId, ...instance });

			logger.info(`Instance ${instanceId} removed successfully`);

		} catch (error) {
			logger.error(`Failed to remove instance ${instanceId}:`, error);
			throw error;
		}
	}

	/**
	 * Start an instance
	 * 
	 * @param {string} instanceId - Instance ID to start
	 */
	async startInstance(instanceId) {
		const instance = this.instances.get(instanceId);
		if (!instance) {
			throw new Error(`Instance ${instanceId} not found`);
		}

		try {
			await this.dockerOrchestrator.startInstance(instanceId);
			
			// Update status
			instance.status = "starting";
			instance.lastStarted = new Date().toISOString();

			this.emit("instance:started", instance);
			logger.info(`Instance ${instanceId} started`);

		} catch (error) {
			instance.status = "error";
			logger.error(`Failed to start instance ${instanceId}:`, error);
			throw error;
		}
	}

	/**
	 * Stop an instance
	 * 
	 * @param {string} instanceId - Instance ID to stop
	 */
	async stopInstance(instanceId) {
		const instance = this.instances.get(instanceId);
		if (!instance) {
			throw new Error(`Instance ${instanceId} not found`);
		}

		try {
			await this.dockerOrchestrator.stopInstance(instanceId);
			
			// Update status
			instance.status = "stopped";
			instance.lastStopped = new Date().toISOString();

			this.emit("instance:stopped", instance);
			logger.info(`Instance ${instanceId} stopped`);

		} catch (error) {
			instance.status = "error";
			logger.error(`Failed to stop instance ${instanceId}:`, error);
			throw error;
		}
	}

	/**
	 * Get instance information
	 * 
	 * @param {string} instanceId - Instance ID
	 * @returns {Object} - Instance information
	 */
	getInstance(instanceId) {
		const instance = this.instances.get(instanceId);
		if (!instance) {
			throw new Error(`Instance ${instanceId} not found`);
		}
		return { ...instance };
	}

	/**
	 * Get all instances
	 * 
	 * @returns {Object[]} - Array of all instances
	 */
	getAllInstances() {
		return Array.from(this.instances.values()).map(instance => ({ ...instance }));
	}

	/**
	 * Set default instance
	 * 
	 * @param {string} instanceId - Instance ID to set as default
	 */
	async setDefaultInstance(instanceId) {
		const instance = this.instances.get(instanceId);
		if (!instance) {
			throw new Error(`Instance ${instanceId} not found`);
		}

		// Clear previous default
		if (this.defaultInstanceId) {
			const previousDefault = this.instances.get(this.defaultInstanceId);
			if (previousDefault) {
				previousDefault.isDefault = false;
			}
		}

		// Set new default
		instance.isDefault = true;
		this.defaultInstanceId = instanceId;

		// Persist changes
		await this.persistAllInstances();

		this.emit("instance:default_changed", { instanceId });
		logger.info(`Instance ${instanceId} set as default`);
	}

	/**
	 * Get default instance
	 * 
	 * @returns {Object|null} - Default instance or null if none set
	 */
	getDefaultInstance() {
		if (!this.defaultInstanceId) {
			return null;
		}
		return this.getInstance(this.defaultInstanceId);
	}

	/**
	 * Update instance configuration
	 * 
	 * @param {string} instanceId - Instance ID
	 * @param {Object} updates - Configuration updates
	 */
	async updateInstance(instanceId, updates) {
		const instance = this.instances.get(instanceId);
		if (!instance) {
			throw new Error(`Instance ${instanceId} not found`);
		}

		// Apply updates (whitelist allowed fields)
		const allowedUpdates = ["label", "environment"];
		for (const field of allowedUpdates) {
			if (field in updates) {
				instance[field] = updates[field];
			}
		}

		instance.updatedAt = new Date().toISOString();

		// Persist changes
		await this.persistInstance(instanceId);

		this.emit("instance:updated", instance);
		logger.info(`Instance ${instanceId} updated`);
	}

	/**
	 * Stop all instances
	 */
	async stopAll() {
		const instances = Array.from(this.instances.keys());
		const results = [];

		for (const instanceId of instances) {
			try {
				await this.stopInstance(instanceId);
				results.push({ instanceId, success: true });
			} catch (error) {
				results.push({ instanceId, success: false, error: error.message });
			}
		}

		logger.info(`Stopped ${results.filter(r => r.success).length}/${instances.length} instances`);
		return results;
	}

	/**
	 * Persist instance to configuration
	 */
	async persistInstance(instanceId) {
		const instance = this.instances.get(instanceId);
		if (!instance) {
			return;
		}

		const config = this.configManager.getConfig();
		if (!config.instances) {
			config.instances = {};
		}

		config.instances[instanceId] = {
			label: instance.label,
			tag: instance.tag,
			ports: instance.ports,
			enableTelemetry: instance.enableTelemetry,
			isDefault: instance.isDefault,
			createdAt: instance.createdAt,
			environment: instance.environment
		};

		await this.configManager.updateConfig({ instances: config.instances });
	}

	/**
	 * Remove instance from persistent storage
	 */
	async unpersistInstance(instanceId) {
		const config = this.configManager.getConfig();
		if (config.instances && config.instances[instanceId]) {
			delete config.instances[instanceId];
			await this.configManager.updateConfig({ instances: config.instances });
		}
	}

	/**
	 * Persist all instances to configuration
	 */
	async persistAllInstances() {
		const config = this.configManager.getConfig();
		config.instances = {};

		for (const [instanceId, instance] of this.instances) {
			config.instances[instanceId] = {
				label: instance.label,
				tag: instance.tag,
				ports: instance.ports,
				enableTelemetry: instance.enableTelemetry,
				isDefault: instance.isDefault,
				createdAt: instance.createdAt,
				environment: instance.environment
			};
		}

		await this.configManager.updateConfig({ instances: config.instances });
	}

	/**
	 * Get instance statistics
	 */
	getInstanceStats() {
		const instances = Array.from(this.instances.values());
		
		return {
			total: instances.length,
			running: instances.filter(i => i.status === "running").length,
			stopped: instances.filter(i => i.status === "stopped").length,
			starting: instances.filter(i => i.status === "starting").length,
			error: instances.filter(i => i.status === "error").length,
			defaultInstance: this.defaultInstanceId
		};
	}
}