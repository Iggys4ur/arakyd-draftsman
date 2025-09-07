import { EventEmitter } from "node:events";
import { WebSocket } from "ws";
import { logger } from "../../daemon/utils/logger.js";

/**
 * s!phon Integration Client
 * 
 * Provides integration with s!phon for data extraction and real-time monitoring.
 * Handles real-time metrics streaming, data extraction, and monitoring setup.
 */
export class SiphonClient extends EventEmitter {
	constructor(config = {}) {
		super();
		this.config = {
			endpoint: config.endpoint || "ws://localhost:3001",
			enabled: config.enabled || false,
			reconnectAttempts: config.reconnectAttempts || 5,
			reconnectDelay: config.reconnectDelay || 2000,
			heartbeatInterval: config.heartbeatInterval || 30000,
			...config
		};
		this.ws = null;
		this.isConnected = false;
		this.reconnectAttempts = 0;
		this.heartbeatTimer = null;
		this.subscriptions = new Set();
	}

	/**
	 * Initialize the s!phon client
	 */
	async initialize() {
		if (!this.config.enabled) {
			logger.info("s!phon integration is disabled");
			return;
		}

		try {
			await this.connect();
			this.setupHeartbeat();
			await this.registerWithSiphon();
			logger.info("s!phon client initialized successfully");
		} catch (error) {
			logger.error("Failed to initialize s!phon client:", error);
			throw error;
		}
	}

	/**
	 * Connect to s!phon WebSocket
	 */
	async connect() {
		return new Promise((resolve, reject) => {
			try {
				this.ws = new WebSocket(this.config.endpoint);

				this.ws.on("open", () => {
					this.isConnected = true;
					this.reconnectAttempts = 0;
					this.emit("connected");
					logger.info(`Connected to s!phon at ${this.config.endpoint}`);
					resolve();
				});

				this.ws.on("message", (data) => {
					try {
						const message = JSON.parse(data.toString());
						this.handleMessage(message);
					} catch (error) {
						logger.error("Failed to parse s!phon message:", error);
					}
				});

				this.ws.on("close", () => {
					this.isConnected = false;
					this.emit("disconnected");
					logger.warn("s!phon connection closed");
					this.handleReconnect();
				});

				this.ws.on("error", (error) => {
					logger.error("s!phon WebSocket error:", error);
					if (!this.isConnected) {
						reject(error);
					}
				});

			} catch (error) {
				reject(error);
			}
		});
	}

	/**
	 * Handle reconnection
	 */
	handleReconnect() {
		if (this.reconnectAttempts < this.config.reconnectAttempts) {
			this.reconnectAttempts++;
			logger.info(`Attempting to reconnect to s!phon (${this.reconnectAttempts}/${this.config.reconnectAttempts})`);
			
			setTimeout(() => {
				this.connect().catch((error) => {
					logger.error("Reconnection failed:", error);
				});
			}, this.config.reconnectDelay);
		} else {
			logger.error("Max reconnection attempts reached for s!phon");
			this.emit("connection_failed");
		}
	}

	/**
	 * Setup heartbeat mechanism
	 */
	setupHeartbeat() {
		this.heartbeatTimer = setInterval(() => {
			if (this.isConnected) {
				this.send({
					type: "ping",
					timestamp: new Date().toISOString()
				});
			}
		}, this.config.heartbeatInterval);
	}

	/**
	 * Register with s!phon
	 */
	async registerWithSiphon() {
		const registrationMessage = {
			type: "register",
			data: {
				service: "arakyd-draftsman",
				version: "0.18.1",
				capabilities: [
					"instance_metrics",
					"health_monitoring",
					"docker_stats",
					"performance_data"
				],
				streams: [
					"instance:health",
					"instance:metrics",
					"daemon:metrics",
					"docker:stats"
				]
			},
			timestamp: new Date().toISOString()
		};

		this.send(registrationMessage);
	}

	/**
	 * Send message to s!phon
	 */
	send(message) {
		if (!this.isConnected || !this.ws) {
			logger.warn("Cannot send message - not connected to s!phon");
			return false;
		}

		try {
			this.ws.send(JSON.stringify(message));
			return true;
		} catch (error) {
			logger.error("Failed to send message to s!phon:", error);
			return false;
		}
	}

	/**
	 * Handle incoming messages
	 */
	handleMessage(message) {
		const { type, data } = message;

		switch (type) {
			case "pong":
				// Heartbeat response
				logger.debug("Received pong from s!phon");
				break;

			case "subscription_confirmed":
				logger.info(`s!phon subscription confirmed: ${data.stream}`);
				this.emit("subscription:confirmed", data);
				break;

			case "data_request":
				this.handleDataRequest(data);
				break;

			case "stream_request":
				this.handleStreamRequest(data);
				break;

			case "extraction_request":
				this.handleExtractionRequest(data);
				break;

			default:
				logger.debug(`Unknown message type from s!phon: ${type}`);
		}

		this.emit("message", message);
	}

	/**
	 * Handle data request from s!phon
	 */
	async handleDataRequest(request) {
		const { requestId, dataType, parameters } = request;

		try {
			let data;

			switch (dataType) {
				case "instances":
					data = await this.getInstanceData(parameters);
					break;
				case "health":
					data = await this.getHealthData(parameters);
					break;
				case "metrics":
					data = await this.getMetricsData(parameters);
					break;
				case "docker_stats":
					data = await this.getDockerStats(parameters);
					break;
				default:
					throw new Error(`Unknown data type: ${dataType}`);
			}

			this.send({
				type: "data_response",
				data: {
					requestId,
					success: true,
					data,
					timestamp: new Date().toISOString()
				}
			});

		} catch (error) {
			logger.error(`Failed to handle data request ${requestId}:`, error);
			
			this.send({
				type: "data_response",
				data: {
					requestId,
					success: false,
					error: error.message,
					timestamp: new Date().toISOString()
				}
			});
		}
	}

	/**
	 * Handle stream request from s!phon
	 */
	handleStreamRequest(request) {
		const { streamId, streamType, parameters } = request;

		try {
			switch (streamType) {
				case "instance_health":
					this.startInstanceHealthStream(streamId, parameters);
					break;
				case "daemon_metrics":
					this.startDaemonMetricsStream(streamId, parameters);
					break;
				case "docker_events":
					this.startDockerEventsStream(streamId, parameters);
					break;
				default:
					throw new Error(`Unknown stream type: ${streamType}`);
			}

		} catch (error) {
			logger.error(`Failed to start stream ${streamId}:`, error);
			
			this.send({
				type: "stream_error",
				data: {
					streamId,
					error: error.message,
					timestamp: new Date().toISOString()
				}
			});
		}
	}

	/**
	 * Handle extraction request from s!phon
	 */
	async handleExtractionRequest(request) {
		const { extractionId, extractionType, parameters } = request;

		try {
			let result;

			switch (extractionType) {
				case "instance_export":
					result = await this.extractInstanceData(parameters);
					break;
				case "config_export":
					result = await this.extractConfigData(parameters);
					break;
				case "logs_export":
					result = await this.extractLogsData(parameters);
					break;
				default:
					throw new Error(`Unknown extraction type: ${extractionType}`);
			}

			this.send({
				type: "extraction_response",
				data: {
					extractionId,
					success: true,
					result,
					timestamp: new Date().toISOString()
				}
			});

		} catch (error) {
			logger.error(`Failed to handle extraction request ${extractionId}:`, error);
			
			this.send({
				type: "extraction_response",
				data: {
					extractionId,
					success: false,
					error: error.message,
					timestamp: new Date().toISOString()
				}
			});
		}
	}

	/**
	 * Stream instance health data
	 */
	startInstanceHealthStream(streamId, parameters) {
		const interval = parameters.interval || 10000; // 10 seconds default
		
		const streamTimer = setInterval(async () => {
			if (!this.isConnected) {
				clearInterval(streamTimer);
				return;
			}

			try {
				const healthData = await this.getHealthData(parameters);
				
				this.send({
					type: "stream_data",
					data: {
						streamId,
						streamType: "instance_health",
						data: healthData,
						timestamp: new Date().toISOString()
					}
				});

			} catch (error) {
				logger.error(`Error in health stream ${streamId}:`, error);
			}
		}, interval);

		// Store stream for cleanup
		this.subscriptions.add({ streamId, timer: streamTimer });
		
		logger.info(`Started instance health stream ${streamId} with ${interval}ms interval`);
	}

	/**
	 * Stream daemon metrics
	 */
	startDaemonMetricsStream(streamId, parameters) {
		const interval = parameters.interval || 5000; // 5 seconds default
		
		const streamTimer = setInterval(async () => {
			if (!this.isConnected) {
				clearInterval(streamTimer);
				return;
			}

			try {
				const metricsData = await this.getMetricsData(parameters);
				
				this.send({
					type: "stream_data",
					data: {
						streamId,
						streamType: "daemon_metrics",
						data: metricsData,
						timestamp: new Date().toISOString()
					}
				});

			} catch (error) {
				logger.error(`Error in metrics stream ${streamId}:`, error);
			}
		}, interval);

		this.subscriptions.add({ streamId, timer: streamTimer });
		logger.info(`Started daemon metrics stream ${streamId} with ${interval}ms interval`);
	}

	/**
	 * Get instance data for s!phon
	 */
	async getInstanceData(parameters) {
		// This would be injected by the daemon
		if (this.services && this.services.instanceManager) {
			return this.services.instanceManager.getAllInstances();
		}
		return [];
	}

	/**
	 * Get health data for s!phon
	 */
	async getHealthData(parameters) {
		if (this.services && this.services.healthMonitor) {
			return await this.services.healthMonitor.getCurrentHealth();
		}
		return { status: "unknown" };
	}

	/**
	 * Get metrics data for s!phon
	 */
	async getMetricsData(parameters) {
		// Implementation would depend on services injection
		return {
			daemon: process.memoryUsage(),
			timestamp: new Date().toISOString()
		};
	}

	/**
	 * Extract instance data
	 */
	async extractInstanceData(parameters) {
		const { instanceIds, format = "json" } = parameters;
		
		// Implementation for data extraction
		return {
			format,
			extractedAt: new Date().toISOString(),
			instanceCount: instanceIds ? instanceIds.length : 0
		};
	}

	/**
	 * Subscribe to daemon events and forward to s!phon
	 */
	subscribeToEvents(services) {
		this.services = services;

		// Subscribe to instance manager events
		services.instanceManager.on("instance:created", (instance) => {
			this.send({
				type: "event",
				data: {
					eventType: "instance:created",
					data: instance,
					timestamp: new Date().toISOString()
				}
			});
		});

		services.instanceManager.on("instance:removed", (instance) => {
			this.send({
				type: "event",
				data: {
					eventType: "instance:removed",
					data: instance,
					timestamp: new Date().toISOString()
				}
			});
		});

		// Subscribe to health monitor events
		services.healthMonitor.on("health:update", (health) => {
			this.send({
				type: "event",
				data: {
					eventType: "health:update",
					data: health,
					timestamp: new Date().toISOString()
				}
			});
		});
	}

	/**
	 * Disconnect from s!phon
	 */
	async disconnect() {
		// Clear heartbeat
		if (this.heartbeatTimer) {
			clearInterval(this.heartbeatTimer);
			this.heartbeatTimer = null;
		}

		// Clear all subscriptions
		for (const subscription of this.subscriptions) {
			if (subscription.timer) {
				clearInterval(subscription.timer);
			}
		}
		this.subscriptions.clear();

		// Close WebSocket
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}

		this.isConnected = false;
		this.emit("disconnected");
		logger.info("Disconnected from s!phon");
	}

	/**
	 * Get connection status
	 */
	getStatus() {
		return {
			enabled: this.config.enabled,
			connected: this.isConnected,
			endpoint: this.config.endpoint,
			subscriptions: this.subscriptions.size,
			reconnectAttempts: this.reconnectAttempts
		};
	}
}