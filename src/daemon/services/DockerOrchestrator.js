import { promisify } from "node:util";
import child_process from "node:child_process";
import { logger } from "../utils/logger.js";

const exec = promisify(child_process.exec);

/**
 * Docker Orchestrator for the Arakyd Daemon
 * 
 * Manages Docker container lifecycle, networking, and monitoring.
 * Enhanced version of functionality from src/process/docker.js
 */
export class DockerOrchestrator {
	constructor(dockerConfig, portManager) {
		this.config = dockerConfig;
		this.portManager = portManager;
		this.containers = new Map(); // containerId -> containerInfo
		this.isDockerAvailable = false;
	}

	/**
	 * Initialize Docker orchestrator
	 */
	async initialize() {
		try {
			await this.checkDockerAvailability();
			await this.ensureNetworkExists();
			logger.info("Docker orchestrator initialized successfully");
		} catch (error) {
			logger.error("Failed to initialize Docker orchestrator:", error);
			throw error;
		}
	}

	/**
	 * Check if Docker is available and running
	 */
	async checkDockerAvailability() {
		try {
			await exec("docker --version");
			await exec("docker info");
			this.isDockerAvailable = true;
			logger.debug("Docker is available and running");
		} catch (error) {
			this.isDockerAvailable = false;
			throw new Error("Docker is not available or not running");
		}
	}

	/**
	 * Ensure the Docker network exists
	 */
	async ensureNetworkExists() {
		try {
			const networkName = this.config.networkName;
			
			// Check if network exists
			const { stdout } = await exec(`docker network ls --filter name=${networkName} --format "{{.Name}}"`);
			
			if (!stdout.trim().includes(networkName)) {
				// Create network
				await exec(`docker network create ${networkName}`);
				logger.info(`Docker network '${networkName}' created`);
			} else {
				logger.debug(`Docker network '${networkName}' already exists`);
			}
		} catch (error) {
			logger.error("Failed to ensure Docker network exists:", error);
			throw error;
		}
	}

	/**
	 * Create and start a new Penpot instance
	 * 
	 * @param {string} instanceId - Unique instance identifier
	 * @param {Object} options - Instance configuration options
	 * @returns {Promise<Object>} - Container information
	 */
	async createInstance(instanceId, options = {}) {
		if (!this.isDockerAvailable) {
			throw new Error("Docker is not available");
		}

		const {
			tag = this.config.defaultTag,
			ports = {},
			environment = {},
			volumes = [],
			enableTelemetry = false
		} = options;

		try {
			// Allocate ports
			const frontendPort = ports.frontend || await this.portManager.findAvailablePort();
			const mailcatchPort = ports.mailcatch || await this.portManager.findAvailablePort();
			
			if (!this.portManager.allocatePorts([frontendPort, mailcatchPort])) {
				throw new Error("Failed to allocate required ports");
			}

			// Generate container names
			const containerPrefix = this.config.containerPrefix;
			const frontendContainer = `${containerPrefix}-frontend-${instanceId}`;
			const backendContainer = `${containerPrefix}-backend-${instanceId}`;
			const redisContainer = `${containerPrefix}-redis-${instanceId}`;
			const postgresContainer = `${containerPrefix}-postgres-${instanceId}`;

			// Create container configuration
			const containerConfig = {
				instanceId,
				frontendContainer,
				backendContainer,
				redisContainer,
				postgresContainer,
				ports: { frontend: frontendPort, mailcatch: mailcatchPort },
				tag,
				networkName: this.config.networkName
			};

			// Start containers using docker-compose
			await this.startContainers(containerConfig, environment, enableTelemetry);

			// Store container information
			this.containers.set(instanceId, containerConfig);

			logger.info(`Instance ${instanceId} created successfully`, {
				ports: containerConfig.ports,
				tag
			});

			return containerConfig;
		} catch (error) {
			// Cleanup on failure
			await this.cleanup(instanceId);
			throw error;
		}
	}

	/**
	 * Start containers for an instance
	 */
	async startContainers(config, environment, enableTelemetry) {
		const composeContent = this.generateDockerCompose(config, environment, enableTelemetry);
		
		// Write docker-compose file
		const composeFile = `/tmp/docker-compose-${config.instanceId}.yml`;
		const { writeFile } = await import("node:fs/promises");
		await writeFile(composeFile, composeContent);

		try {
			// Start services
			await exec(`docker-compose -f ${composeFile} -p ${config.instanceId} up -d`);
			logger.debug(`Containers started for instance ${config.instanceId}`);
		} catch (error) {
			logger.error(`Failed to start containers for instance ${config.instanceId}:`, error);
			throw error;
		}
	}

	/**
	 * Generate docker-compose configuration
	 */
	generateDockerCompose(config, environment, enableTelemetry) {
		const { frontendContainer, backendContainer, redisContainer, postgresContainer } = config;
		const { frontend: frontendPort, mailcatch: mailcatchPort } = config.ports;
		const volumePrefix = this.config.volumePrefix;

		return `
version: '3.8'

services:
  postgres:
    container_name: ${postgresContainer}
    image: postgres:15
    restart: unless-stopped
    environment:
      - POSTGRES_INITDB_ARGS=--data-checksums
      - POSTGRES_DB=penpot
      - POSTGRES_USER=penpot
      - POSTGRES_PASSWORD=penpot
    volumes:
      - ${volumePrefix}-${config.instanceId}-postgres:/var/lib/postgresql/data
    networks:
      - ${config.networkName}

  redis:
    container_name: ${redisContainer}
    image: redis:7
    restart: unless-stopped
    networks:
      - ${config.networkName}

  backend:
    container_name: ${backendContainer}
    image: penpotapp/backend:${config.tag}
    restart: unless-stopped
    environment:
      - PENPOT_FLAGS=enable-registration enable-login-with-password
      - PENPOT_SECRET_KEY=penpot-secret-key
      - PENPOT_DATABASE_URI=postgresql://postgres:penpot@${postgresContainer}/penpot
      - PENPOT_REDIS_URI=redis://redis/0
      - PENPOT_ASSETS_STORAGE_BACKEND=assets-fs
      - PENPOT_STORAGE_ASSETS_FS_DIRECTORY=/opt/data/assets
      - PENPOT_TELEMETRY_ENABLED=${enableTelemetry}
      ${Object.entries(environment).map(([key, value]) => `      - ${key}=${value}`).join('\\n')}
    volumes:
      - ${volumePrefix}-${config.instanceId}-assets:/opt/data/assets
    depends_on:
      - postgres
      - redis
    networks:
      - ${config.networkName}

  frontend:
    container_name: ${frontendContainer}
    image: penpotapp/frontend:${config.tag}
    restart: unless-stopped
    ports:
      - "${frontendPort}:80"
    environment:
      - PENPOT_FLAGS=enable-registration enable-login-with-password
    depends_on:
      - backend
    networks:
      - ${config.networkName}

  mailcatch:
    container_name: ${config.instanceId}-mailcatch
    image: sj26/mailcatcher:latest
    restart: unless-stopped
    ports:
      - "${mailcatchPort}:1080"
    networks:
      - ${config.networkName}

volumes:
  ${volumePrefix}-${config.instanceId}-postgres:
  ${volumePrefix}-${config.instanceId}-assets:

networks:
  ${config.networkName}:
    external: true
`;
	}

	/**
	 * Stop an instance
	 */
	async stopInstance(instanceId) {
		const config = this.containers.get(instanceId);
		if (!config) {
			throw new Error(`Instance ${instanceId} not found`);
		}

		try {
			await exec(`docker-compose -p ${instanceId} stop`);
			logger.info(`Instance ${instanceId} stopped`);
		} catch (error) {
			logger.error(`Failed to stop instance ${instanceId}:`, error);
			throw error;
		}
	}

	/**
	 * Start a stopped instance
	 */
	async startInstance(instanceId) {
		const config = this.containers.get(instanceId);
		if (!config) {
			throw new Error(`Instance ${instanceId} not found`);
		}

		try {
			await exec(`docker-compose -p ${instanceId} start`);
			logger.info(`Instance ${instanceId} started`);
		} catch (error) {
			logger.error(`Failed to start instance ${instanceId}:`, error);
			throw error;
		}
	}

	/**
	 * Remove an instance completely
	 */
	async removeInstance(instanceId) {
		const config = this.containers.get(instanceId);
		if (!config) {
			logger.warn(`Instance ${instanceId} not found for removal`);
			return;
		}

		try {
			// Stop and remove containers
			await exec(`docker-compose -p ${instanceId} down -v`);
			
			// Release ports
			this.portManager.releasePorts([config.ports.frontend, config.ports.mailcatch]);
			
			// Remove from tracking
			this.containers.delete(instanceId);
			
			logger.info(`Instance ${instanceId} removed completely`);
		} catch (error) {
			logger.error(`Failed to remove instance ${instanceId}:`, error);
			throw error;
		}
	}

	/**
	 * Get instance health status
	 */
	async getInstanceHealth(instanceId) {
		const config = this.containers.get(instanceId);
		if (!config) {
			return { status: "not_found" };
		}

		try {
			const { stdout } = await exec(`docker-compose -p ${instanceId} ps --format json`);
			const containers = JSON.parse(`[${stdout.trim().split('\\n').join(',')}]`);
			
			const health = {
				instanceId,
				status: "healthy",
				containers: {},
				ports: config.ports,
				uptime: null
			};

			for (const container of containers) {
				health.containers[container.Service] = {
					state: container.State,
					status: container.Status,
					health: container.Health || "unknown"
				};

				if (container.State !== "running") {
					health.status = "unhealthy";
				}
			}

			return health;
		} catch (error) {
			logger.error(`Failed to get health for instance ${instanceId}:`, error);
			return { status: "error", error: error.message };
		}
	}

	/**
	 * Get all managed instances
	 */
	getAllInstances() {
		return Array.from(this.containers.keys());
	}

	/**
	 * Get instance configuration
	 */
	getInstanceConfig(instanceId) {
		return this.containers.get(instanceId);
	}

	/**
	 * Cleanup resources for an instance
	 */
	async cleanup(instanceId = null) {
		if (instanceId) {
			await this.removeInstance(instanceId);
		} else {
			// Cleanup all instances
			const instances = Array.from(this.containers.keys());
			for (const id of instances) {
				await this.removeInstance(id);
			}
		}
	}
}