import { createServer } from "node:net";
import { logger } from "../utils/logger.js";

/**
 * Port Manager for the Arakyd Daemon
 * 
 * Manages port allocation and availability checking for Docker instances.
 * Extracted and enhanced from src/process/server.js
 */
export class PortManager {
	constructor(portRange = { start: 9001, end: 9100 }) {
		this.portRange = portRange;
		this.allocatedPorts = new Set();
		this.reservedPorts = new Set();
	}

	/**
	 * Check if a specific port is available
	 * 
	 * @param {number} port - The port to check
	 * @param {string} host - The host to check against
	 * @returns {Promise<boolean>} - True if port is available
	 */
	async isPortAvailable(port, host = "127.0.0.1") {
		// Check if port is already allocated or reserved
		if (this.allocatedPorts.has(port) || this.reservedPorts.has(port)) {
			return false;
		}

		return new Promise((resolve, reject) => {
			const server = createServer()
				.once("error", (/** @type {NodeJS.ErrnoException} */ error) => {
					const { code } = error;
					const isPortInUse = code === "EADDRINUSE";

					if (isPortInUse) {
						resolve(false);
						return;
					}

					reject(error);
				})
				.once("listening", () => {
					server.once("close", () => resolve(true)).close();
				})
				.listen(port, host);
		});
	}

	/**
	 * Find the first available port from the configured range
	 * 
	 * @param {string} host - The host to check against
	 * @returns {Promise<number>} - The first available port
	 * @throws {Error} - If no ports are available
	 */
	async findAvailablePort(host = "127.0.0.1") {
		const { start, end } = this.portRange;

		for (let port = start; port <= end; port++) {
			if (await this.isPortAvailable(port, host)) {
				return port;
			}
		}

		throw new Error(
			`No available ports found in the range ${start}-${end}.`
		);
	}

	/**
	 * Find multiple available ports
	 * 
	 * @param {number} count - Number of ports needed
	 * @param {string} host - The host to check against
	 * @returns {Promise<number[]>} - Array of available ports
	 * @throws {Error} - If not enough ports are available
	 */
	async findAvailablePorts(count, host = "127.0.0.1") {
		const ports = [];
		const { start, end } = this.portRange;

		for (let port = start; port <= end && ports.length < count; port++) {
			if (await this.isPortAvailable(port, host)) {
				ports.push(port);
			}
		}

		if (ports.length < count) {
			throw new Error(
				`Could not find ${count} available ports. Only found ${ports.length}.`
			);
		}

		return ports;
	}

	/**
	 * Allocate a specific port
	 * 
	 * @param {number} port - The port to allocate
	 * @returns {boolean} - True if allocation was successful
	 */
	allocatePort(port) {
		if (this.allocatedPorts.has(port) || this.reservedPorts.has(port)) {
			return false;
		}

		this.allocatedPorts.add(port);
		logger.debug(`Port ${port} allocated`);
		return true;
	}

	/**
	 * Allocate multiple ports
	 * 
	 * @param {number[]} ports - Array of ports to allocate
	 * @returns {boolean} - True if all ports were allocated successfully
	 */
	allocatePorts(ports) {
		// Check if all ports are available first
		for (const port of ports) {
			if (this.allocatedPorts.has(port) || this.reservedPorts.has(port)) {
				return false;
			}
		}

		// Allocate all ports
		for (const port of ports) {
			this.allocatedPorts.add(port);
		}

		logger.debug(`Ports allocated: ${ports.join(", ")}`);
		return true;
	}

	/**
	 * Release a specific port
	 * 
	 * @param {number} port - The port to release
	 */
	releasePort(port) {
		this.allocatedPorts.delete(port);
		logger.debug(`Port ${port} released`);
	}

	/**
	 * Release multiple ports
	 * 
	 * @param {number[]} ports - Array of ports to release
	 */
	releasePorts(ports) {
		for (const port of ports) {
			this.allocatedPorts.delete(port);
		}
		logger.debug(`Ports released: ${ports.join(", ")}`);
	}

	/**
	 * Reserve a port (prevent allocation but don't actively use)
	 * 
	 * @param {number} port - The port to reserve
	 * @returns {boolean} - True if reservation was successful
	 */
	reservePort(port) {
		if (this.allocatedPorts.has(port) || this.reservedPorts.has(port)) {
			return false;
		}

		this.reservedPorts.add(port);
		logger.debug(`Port ${port} reserved`);
		return true;
	}

	/**
	 * Release a reserved port
	 * 
	 * @param {number} port - The port to unreserve
	 */
	unreservePort(port) {
		this.reservedPorts.delete(port);
		logger.debug(`Port ${port} unreserved`);
	}

	/**
	 * Get all allocated ports
	 * 
	 * @returns {number[]} - Array of allocated ports
	 */
	getAllocatedPorts() {
		return Array.from(this.allocatedPorts);
	}

	/**
	 * Get all reserved ports
	 * 
	 * @returns {number[]} - Array of reserved ports
	 */
	getReservedPorts() {
		return Array.from(this.reservedPorts);
	}

	/**
	 * Get port usage statistics
	 * 
	 * @returns {Object} - Port usage statistics
	 */
	getUsageStats() {
		const { start, end } = this.portRange;
		const totalPorts = end - start + 1;
		const allocatedCount = this.allocatedPorts.size;
		const reservedCount = this.reservedPorts.size;
		const availableCount = totalPorts - allocatedCount - reservedCount;

		return {
			totalPorts,
			allocatedCount,
			reservedCount,
			availableCount,
			usagePercentage: ((allocatedCount + reservedCount) / totalPorts * 100).toFixed(2)
		};
	}

	/**
	 * Clear all allocations and reservations
	 */
	clear() {
		this.allocatedPorts.clear();
		this.reservedPorts.clear();
		logger.debug("All port allocations and reservations cleared");
	}

	/**
	 * Update port range configuration
	 * 
	 * @param {Object} newRange - New port range {start, end}
	 */
	updatePortRange(newRange) {
		// Clear any allocations outside the new range
		const portsToRelease = [];
		
		for (const port of this.allocatedPorts) {
			if (port < newRange.start || port > newRange.end) {
				portsToRelease.push(port);
			}
		}

		for (const port of this.reservedPorts) {
			if (port < newRange.start || port > newRange.end) {
				this.reservedPorts.delete(port);
			}
		}

		this.releasePorts(portsToRelease);
		this.portRange = newRange;
		
		logger.info(`Port range updated to ${newRange.start}-${newRange.end}`);
	}
}