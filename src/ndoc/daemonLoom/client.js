import { EventEmitter } from "node:events";
import { logger } from "../../daemon/utils/logger.js";

/**
 * daemonLoom Integration Client
 * 
 * Provides integration with daemonLoom for process and workflow orchestration.
 * Handles batch operations, workflow management, and process coordination.
 */
export class DaemonLoomClient extends EventEmitter {
	constructor(config = {}) {
		super();
		this.config = {
			endpoint: config.endpoint || "http://localhost:3000",
			enabled: config.enabled || false,
			retryAttempts: config.retryAttempts || 3,
			retryDelay: config.retryDelay || 1000,
			...config
		};
		this.isConnected = false;
		this.connectionRetries = 0;
	}

	/**
	 * Initialize the daemonLoom client
	 */
	async initialize() {
		if (!this.config.enabled) {
			logger.info("daemonLoom integration is disabled");
			return;
		}

		try {
			await this.connect();
			await this.registerWithDaemonLoom();
			logger.info("daemonLoom client initialized successfully");
		} catch (error) {
			logger.error("Failed to initialize daemonLoom client:", error);
			throw error;
		}
	}

	/**
	 * Connect to daemonLoom
	 */
	async connect() {
		try {
			// Test connection to daemonLoom endpoint
			const response = await fetch(`${this.config.endpoint}/health`, {
				method: "GET",
				timeout: 5000
			});

			if (!response.ok) {
				throw new Error(`daemonLoom health check failed: ${response.status}`);
			}

			this.isConnected = true;
			this.connectionRetries = 0;
			this.emit("connected");
			logger.info(`Connected to daemonLoom at ${this.config.endpoint}`);

		} catch (error) {
			this.isConnected = false;
			this.connectionRetries++;

			if (this.connectionRetries < this.config.retryAttempts) {
				logger.warn(`Failed to connect to daemonLoom, retrying in ${this.config.retryDelay}ms...`);
				setTimeout(() => this.connect(), this.config.retryDelay);
			} else {
				logger.error("Failed to connect to daemonLoom after maximum retries");
				this.emit("connection_failed", error);
				throw error;
			}
		}
	}

	/**
	 * Register this daemon with daemonLoom
	 */
	async registerWithDaemonLoom() {
		const registrationData = {
			service: "arakyd-draftsman",
			version: "0.18.1",
			capabilities: [
				"instance_management",
				"docker_orchestration",
				"penpot_hosting"
			],
			endpoints: {
				health: "/api/v1/health",
				instances: "/api/v1/instances",
				metrics: "/api/v1/metrics"
			},
			timestamp: new Date().toISOString()
		};

		try {
			const response = await fetch(`${this.config.endpoint}/api/services/register`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify(registrationData)
			});

			if (!response.ok) {
				throw new Error(`Registration failed: ${response.status}`);
			}

			const result = await response.json();
			logger.info("Successfully registered with daemonLoom", result);

		} catch (error) {
			logger.error("Failed to register with daemonLoom:", error);
			throw error;
		}
	}

	/**
	 * Execute a workflow defined in daemonLoom
	 */
	async executeWorkflow(workflowId, parameters = {}) {
		if (!this.isConnected) {
			throw new Error("Not connected to daemonLoom");
		}

		try {
			const response = await fetch(`${this.config.endpoint}/api/workflows/${workflowId}/execute`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					parameters,
					source: "arakyd-draftsman",
					timestamp: new Date().toISOString()
				})
			});

			if (!response.ok) {
				throw new Error(`Workflow execution failed: ${response.status}`);
			}

			const result = await response.json();
			logger.info(`Workflow ${workflowId} executed successfully`, result);
			
			this.emit("workflow:executed", { workflowId, result });
			return result;

		} catch (error) {
			logger.error(`Failed to execute workflow ${workflowId}:`, error);
			this.emit("workflow:failed", { workflowId, error: error.message });
			throw error;
		}
	}

	/**
	 * Report batch operation results to daemonLoom
	 */
	async reportBatchOperation(operation) {
		if (!this.isConnected) {
			logger.warn("Cannot report batch operation - not connected to daemonLoom");
			return;
		}

		try {
			const response = await fetch(`${this.config.endpoint}/api/operations/batch`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					...operation,
					source: "arakyd-draftsman",
					timestamp: new Date().toISOString()
				})
			});

			if (!response.ok) {
				throw new Error(`Batch operation report failed: ${response.status}`);
			}

			logger.debug("Batch operation reported to daemonLoom");

		} catch (error) {
			logger.error("Failed to report batch operation:", error);
		}
	}

	/**
	 * Get workflow definitions from daemonLoom
	 */
	async getWorkflows() {
		if (!this.isConnected) {
			throw new Error("Not connected to daemonLoom");
		}

		try {
			const response = await fetch(`${this.config.endpoint}/api/workflows`, {
				method: "GET"
			});

			if (!response.ok) {
				throw new Error(`Failed to get workflows: ${response.status}`);
			}

			const workflows = await response.json();
			return workflows;

		} catch (error) {
			logger.error("Failed to get workflows:", error);
			throw error;
		}
	}

	/**
	 * Subscribe to workflow events from daemonLoom
	 */
	async subscribeToWorkflowEvents() {
		if (!this.isConnected) {
			throw new Error("Not connected to daemonLoom");
		}

		try {
			// This would typically use WebSocket or Server-Sent Events
			// For now, we'll implement polling
			const response = await fetch(`${this.config.endpoint}/api/workflows/events/subscribe`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					service: "arakyd-draftsman",
					events: ["workflow:created", "workflow:updated", "workflow:triggered"]
				})
			});

			if (!response.ok) {
				throw new Error(`Event subscription failed: ${response.status}`);
			}

			logger.info("Subscribed to workflow events");

		} catch (error) {
			logger.error("Failed to subscribe to workflow events:", error);
			throw error;
		}
	}

	/**
	 * Disconnect from daemonLoom
	 */
	async disconnect() {
		if (!this.isConnected) {
			return;
		}

		try {
			// Unregister from daemonLoom
			await fetch(`${this.config.endpoint}/api/services/unregister`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify({
					service: "arakyd-draftsman"
				})
			});

			this.isConnected = false;
			this.emit("disconnected");
			logger.info("Disconnected from daemonLoom");

		} catch (error) {
			logger.error("Error during daemonLoom disconnect:", error);
		}
	}

	/**
	 * Get connection status
	 */
	getStatus() {
		return {
			enabled: this.config.enabled,
			connected: this.isConnected,
			endpoint: this.config.endpoint,
			retries: this.connectionRetries
		};
	}
}