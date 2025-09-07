import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { logger } from "./utils/logger.js";

// Import API route handlers
import { createInstancesRouter } from "./api/instances.js";
import { createConfigRouter } from "./api/config.js";
import { createHealthRouter } from "./api/health.js";
import { createMetricsRouter } from "./api/metrics.js";

/**
 * Daemon Server for the Arakyd Daemon
 * 
 * Provides HTTP REST API and WebSocket endpoints for daemon functionality.
 */
export class DaemonServer {
	constructor(services, config) {
		this.services = services;
		this.config = config;
		this.app = express();
		this.server = null;
		this.wss = null;
		this.clients = new Set();
	}

	/**
	 * Start the HTTP and WebSocket server
	 */
	async start() {
		try {
			// Setup Express middleware
			this.setupMiddleware();

			// Setup API routes
			this.setupRoutes();

			// Setup error handling
			this.setupErrorHandling();

			// Create HTTP server
			this.server = createServer(this.app);

			// Setup WebSocket server
			this.setupWebSocket();

			// Start listening
			await this.listen();

			logger.info(`Server started on ${this.config.host}:${this.config.port}`);
		} catch (error) {
			logger.error("Failed to start server:", error);
			throw error;
		}
	}

	/**
	 * Setup Express middleware
	 */
	setupMiddleware() {
		// Security middleware
		this.app.use(helmet());
		
		// CORS
		this.app.use(cors({
			origin: true, // Allow all origins for now - should be configurable
			credentials: true
		}));

		// Request logging
		this.app.use(morgan("combined", {
			stream: {
				write: (message) => logger.info(message.trim())
			}
		}));

		// JSON parsing
		this.app.use(express.json({ limit: "10mb" }));
		this.app.use(express.urlencoded({ extended: true }));

		// Request ID middleware
		this.app.use((req, res, next) => {
			req.id = Math.random().toString(36).substr(2, 9);
			res.setHeader("X-Request-ID", req.id);
			next();
		});

		// Add services to request context
		this.app.use((req, _res, next) => {
			req.services = this.services;
			next();
		});
	}

	/**
	 * Setup API routes
	 */
	setupRoutes() {
		// Health check endpoint
		this.app.get("/", (req, res) => {
			res.json({
				name: "Arakyd Draftsman Daemon",
				version: "0.18.1",
				status: "running",
				timestamp: new Date().toISOString()
			});
		});

		// API routes
		this.app.use("/api/v1/instances", createInstancesRouter(this.services));
		this.app.use("/api/v1/config", createConfigRouter(this.services));
		this.app.use("/api/v1/health", createHealthRouter(this.services));
		this.app.use("/api/v1/metrics", createMetricsRouter(this.services));

		// 404 handler
		this.app.use("*", (req, res) => {
			res.status(404).json({
				error: "Not Found",
				message: `Route ${req.method} ${req.originalUrl} not found`,
				timestamp: new Date().toISOString()
			});
		});
	}

	/**
	 * Setup error handling
	 */
	setupErrorHandling() {
		this.app.use((error, req, res, _next) => {
			logger.error(`Request ${req.id} error:`, error);

			// Default error response
			const response = {
				error: "Internal Server Error",
				message: error.message || "An unexpected error occurred",
				timestamp: new Date().toISOString(),
				requestId: req.id
			};

			// Handle specific error types
			if (error.name === "ValidationError") {
				response.error = "Validation Error";
				res.status(400);
			} else if (error.name === "UnauthorizedError") {
				response.error = "Unauthorized";
				res.status(401);
			} else if (error.name === "ForbiddenError") {
				response.error = "Forbidden";
				res.status(403);
			} else if (error.name === "NotFoundError") {
				response.error = "Not Found";
				res.status(404);
			} else {
				res.status(500);
			}

			res.json(response);
		});
	}

	/**
	 * Setup WebSocket server
	 */
	setupWebSocket() {
		this.wss = new WebSocketServer({ server: this.server, path: "/ws" });

		this.wss.on("connection", (ws, _request) => {
			const clientId = Math.random().toString(36).substr(2, 9);
			ws.clientId = clientId;
			this.clients.add(ws);

			logger.info(`WebSocket client ${clientId} connected`);

			// Send welcome message
			ws.send(JSON.stringify({
				type: "welcome",
				message: "Connected to Arakyd Draftsman Daemon",
				clientId,
				timestamp: new Date().toISOString()
			}));

			// Handle messages
			ws.on("message", (data) => {
				try {
					const message = JSON.parse(data.toString());
					this.handleWebSocketMessage(ws, message);
				} catch (error) {
					logger.error(`Invalid WebSocket message from ${clientId}:`, error);
					ws.send(JSON.stringify({
						type: "error",
						message: "Invalid JSON message",
						timestamp: new Date().toISOString()
					}));
				}
			});

			// Handle disconnect
			ws.on("close", () => {
				this.clients.delete(ws);
				logger.info(`WebSocket client ${clientId} disconnected`);
			});

			// Handle errors
			ws.on("error", (error) => {
				logger.error(`WebSocket client ${clientId} error:`, error);
				this.clients.delete(ws);
			});
		});

		// Subscribe to health monitor events
		this.services.healthMonitor.on("health:update", (healthReport) => {
			this.broadcast({
				type: "health:update",
				data: healthReport,
				timestamp: new Date().toISOString()
			});
		});

		// Subscribe to instance manager events
		this.services.instanceManager.on("instance:created", (instance) => {
			this.broadcast({
				type: "instance:created",
				data: instance,
				timestamp: new Date().toISOString()
			});
		});

		this.services.instanceManager.on("instance:removed", (instance) => {
			this.broadcast({
				type: "instance:removed",
				data: instance,
				timestamp: new Date().toISOString()
			});
		});

		this.services.instanceManager.on("instance:started", (instance) => {
			this.broadcast({
				type: "instance:started",
				data: instance,
				timestamp: new Date().toISOString()
			});
		});

		this.services.instanceManager.on("instance:stopped", (instance) => {
			this.broadcast({
				type: "instance:stopped",
				data: instance,
				timestamp: new Date().toISOString()
			});
		});
	}

	/**
	 * Handle WebSocket messages
	 */
	handleWebSocketMessage(ws, message) {
		const { type, data } = message;

		switch (type) {
			case "ping":
				ws.send(JSON.stringify({
					type: "pong",
					timestamp: new Date().toISOString()
				}));
				break;

			case "subscribe":
				// Handle subscription requests
				ws.subscriptions = ws.subscriptions || new Set();
				if (data && data.events) {
					for (const event of data.events) {
						ws.subscriptions.add(event);
					}
				}
				ws.send(JSON.stringify({
					type: "subscribed",
					events: Array.from(ws.subscriptions),
					timestamp: new Date().toISOString()
				}));
				break;

			case "unsubscribe":
				// Handle unsubscription requests
				if (ws.subscriptions && data && data.events) {
					for (const event of data.events) {
						ws.subscriptions.delete(event);
					}
				}
				ws.send(JSON.stringify({
					type: "unsubscribed",
					events: data.events,
					timestamp: new Date().toISOString()
				}));
				break;

			default:
				ws.send(JSON.stringify({
					type: "error",
					message: `Unknown message type: ${type}`,
					timestamp: new Date().toISOString()
				}));
		}
	}

	/**
	 * Broadcast message to all connected WebSocket clients
	 */
	broadcast(message) {
		const messageString = JSON.stringify(message);
		
		for (const client of this.clients) {
			if (client.readyState === client.OPEN) {
				// Check if client is subscribed to this event type
				if (!client.subscriptions || client.subscriptions.has(message.type)) {
					try {
						client.send(messageString);
					} catch (error) {
						logger.error(`Failed to send message to client ${client.clientId}:`, error);
						this.clients.delete(client);
					}
				}
			} else {
				this.clients.delete(client);
			}
		}
	}

	/**
	 * Start listening on the configured port
	 */
	async listen() {
		return new Promise((resolve, reject) => {
			this.server.listen(this.config.port, this.config.host, (error) => {
				if (error) {
					reject(error);
				} else {
					resolve();
				}
			});
		});
	}

	/**
	 * Stop the server
	 */
	async stop() {
		return new Promise((resolve, reject) => {
			// Close WebSocket connections
			for (const client of this.clients) {
				client.close();
			}
			this.clients.clear();

			// Close WebSocket server
			if (this.wss) {
				this.wss.close();
			}

			// Close HTTP server
			if (this.server) {
				this.server.close((error) => {
					if (error) {
						reject(error);
					} else {
						resolve();
					}
				});
			} else {
				resolve();
			}
		});
	}

	/**
	 * Get server status
	 */
	getStatus() {
		return {
			listening: this.server?.listening || false,
			port: this.config.port,
			host: this.config.host,
			connectedClients: this.clients.size,
			uptime: process.uptime()
		};
	}
}