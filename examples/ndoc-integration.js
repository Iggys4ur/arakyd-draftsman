#!/usr/bin/env node

/**
 * Example Integration Script
 * 
 * Demonstrates how to integrate Arakyd Draftsman daemon with ndoc components.
 * This script shows practical usage patterns for daemonLoom and s!phon integration.
 */

import { ArakydDaemon } from '../src/daemon/index.js';
import { DaemonLoomClient } from '../src/ndoc/daemonLoom/client.js';
import { SiphonClient } from '../src/ndoc/siphon/client.js';
import { WorkflowExecutor } from '../src/ndoc/daemonLoom/workflows.js';

class NdocIntegrationExample {
	constructor() {
		this.daemon = null;
		this.daemonLoom = null;
		this.siphon = null;
		this.workflowExecutor = null;
	}

	/**
	 * Initialize and start the complete integration
	 */
	async initialize() {
		console.log('🚀 Starting Arakyd Draftsman ndoc Integration Example');

		try {
			// 1. Start the daemon
			await this.startDaemon();

			// 2. Initialize ndoc integrations
			await this.initializeNdocIntegrations();

			// 3. Run example operations
			await this.runExampleOperations();

			console.log('✅ Integration example completed successfully');

		} catch (error) {
			console.error('❌ Integration example failed:', error);
			process.exit(1);
		}
	}

	/**
	 * Start the Arakyd daemon
	 */
	async startDaemon() {
		console.log('📡 Starting Arakyd Daemon...');
		
		this.daemon = new ArakydDaemon();
		await this.daemon.start();
		
		console.log('✅ Daemon started successfully');
		
		// Give the daemon a moment to fully initialize
		await new Promise(resolve => setTimeout(resolve, 2000));
	}

	/**
	 * Initialize ndoc component integrations
	 */
	async initializeNdocIntegrations() {
		console.log('🔗 Initializing ndoc integrations...');

		// Initialize daemonLoom client
		this.daemonLoom = new DaemonLoomClient({
			endpoint: 'http://localhost:3000',
			enabled: true, // Note: This will fail if daemonLoom is not running
			retryAttempts: 1 // Reduce retries for demo
		});

		// Initialize s!phon client
		this.siphon = new SiphonClient({
			endpoint: 'ws://localhost:3001',
			enabled: true, // Note: This will fail if s!phon is not running
			reconnectAttempts: 1 // Reduce retries for demo
		});

		// Initialize workflow executor
		this.workflowExecutor = new WorkflowExecutor(
			this.daemon.services,
			this.daemonLoom
		);

		try {
			// Try to initialize integrations (will log warnings if services aren't available)
			await this.daemonLoom.initialize();
			console.log('✅ daemonLoom integration initialized');
		} catch (error) {
			console.log('⚠️  daemonLoom not available (this is expected for demo)');
		}

		try {
			await this.siphon.initialize();
			
			// Subscribe siphon to daemon events
			this.siphon.subscribeToEvents(this.daemon.services);
			console.log('✅ s!phon integration initialized');
		} catch (error) {
			console.log('⚠️  s!phon not available (this is expected for demo)');
		}

		await this.workflowExecutor.initialize();
		console.log('✅ Workflow executor initialized');
	}

	/**
	 * Run example operations
	 */
	async runExampleOperations() {
		console.log('🔧 Running example operations...');

		// Example 1: Create instances using daemon API
		await this.createExampleInstances();

		// Example 2: Monitor health and metrics
		await this.monitorSystemHealth();

		// Example 3: Execute workflows (simulated)
		await this.executeExampleWorkflows();

		// Example 4: Extract data (simulated)
		await this.extractExampleData();

		// Example 5: Configuration management
		await this.manageConfiguration();
	}

	/**
	 * Create example instances
	 */
	async createExampleInstances() {
		console.log('📦 Creating example instances...');

		const { instanceManager } = this.daemon.services;

		try {
			// Create development instance
			const devInstanceId = await instanceManager.createInstance({
				label: 'Development Environment',
				tag: 'latest',
				enableTelemetry: false,
				makeDefault: true,
				environment: {
					PENPOT_FLAGS: 'enable-registration enable-login-with-password enable-smtp',
					PENPOT_SECRET_KEY: 'dev-secret-key'
				}
			});

			console.log(`✅ Created development instance: ${devInstanceId}`);

			// Create staging instance
			const stagingInstanceId = await instanceManager.createInstance({
				label: 'Staging Environment',
				tag: 'latest',
				enableTelemetry: true,
				environment: {
					PENPOT_FLAGS: 'enable-registration enable-login-with-password',
					PENPOT_SECRET_KEY: 'staging-secret-key'
				}
			});

			console.log(`✅ Created staging instance: ${stagingInstanceId}`);

			// Show instance statistics
			const stats = instanceManager.getInstanceStats();
			console.log(`📊 Instance Stats:`, stats);

		} catch (error) {
			console.error('❌ Failed to create instances:', error.message);
		}
	}

	/**
	 * Monitor system health
	 */
	async monitorSystemHealth() {
		console.log('🩺 Monitoring system health...');

		const { healthMonitor } = this.daemon.services;

		try {
			// Get current health status
			const health = await healthMonitor.getCurrentHealth();
			console.log(`🏥 Overall Health: ${health.overall}`);
			console.log(`📈 Daemon Status: ${health.daemon.status}`);
			console.log(`🐳 Docker Status: ${health.docker.status}`);

			// Get health summary
			const summary = healthMonitor.getHealthSummary();
			console.log(`📋 Health Summary:`, {
				daemon: summary.daemon.status,
				instances: summary.instances
			});

		} catch (error) {
			console.error('❌ Failed to monitor health:', error.message);
		}
	}

	/**
	 * Execute example workflows
	 */
	async executeExampleWorkflows() {
		console.log('⚙️  Executing example workflows...');

		try {
			// Execute health check workflow
			console.log('🔍 Running health check workflow...');
			const healthResult = await this.workflowExecutor.executeWorkflow(
				'arakyd_instance_health_check',
				{
					include_connectivity: true,
					repair_unhealthy: false
				}
			);

			console.log('✅ Health check workflow completed');

			// Show available workflows
			const workflows = this.workflowExecutor.getRegisteredWorkflows();
			console.log(`📑 Available workflows: ${workflows.map(w => w.name).join(', ')}`);

		} catch (error) {
			console.error('❌ Failed to execute workflows:', error.message);
		}
	}

	/**
	 * Extract example data
	 */
	async extractExampleData() {
		console.log('📤 Extracting example data...');

		// Simulate data extraction for s!phon integration
		const extractionExamples = [
			{
				type: 'Instance Export',
				description: 'Extract instance configurations and health data'
			},
			{
				type: 'Configuration Export',
				description: 'Export daemon configuration for backup'
			},
			{
				type: 'Metrics Export',
				description: 'Extract performance metrics for analysis'
			}
		];

		for (const example of extractionExamples) {
			console.log(`📊 ${example.type}: ${example.description}`);
		}

		console.log('✅ Data extraction examples logged');
	}

	/**
	 * Manage configuration
	 */
	async manageConfiguration() {
		console.log('⚙️  Managing configuration...');

		const { config } = this.daemon.services;

		try {
			// Get current configuration
			const currentConfig = config.getConfig();
			console.log(`📋 Current log level: ${currentConfig.daemon.logLevel}`);
			console.log(`📊 Max instances: ${currentConfig.daemon.maxInstances}`);

			// Show configuration management capabilities
			console.log('✅ Configuration management ready');

		} catch (error) {
			console.error('❌ Failed to manage configuration:', error.message);
		}
	}

	/**
	 * Cleanup and shutdown
	 */
	async cleanup() {
		console.log('🧹 Cleaning up...');

		try {
			// Disconnect ndoc integrations
			if (this.siphon) {
				await this.siphon.disconnect();
			}

			if (this.daemonLoom) {
				await this.daemonLoom.disconnect();
			}

			// Stop the daemon
			if (this.daemon) {
				await this.daemon.stop();
			}

			console.log('✅ Cleanup completed');

		} catch (error) {
			console.error('❌ Cleanup failed:', error.message);
		}
	}
}

// Run the example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	const example = new NdocIntegrationExample();
	
	// Setup graceful shutdown
	process.on('SIGINT', async () => {
		console.log('\\n🛑 Received interrupt signal, shutting down...');
		await example.cleanup();
		process.exit(0);
	});

	process.on('SIGTERM', async () => {
		console.log('\\n🛑 Received termination signal, shutting down...');
		await example.cleanup();
		process.exit(0);
	});

	// Run the example
	example.initialize().catch(async (error) => {
		console.error('💥 Unhandled error:', error);
		await example.cleanup();
		process.exit(1);
	});
}

export { NdocIntegrationExample };