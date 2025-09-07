import { logger } from "../../daemon/utils/logger.js";

/**
 * Workflow definitions for daemonLoom integration
 * 
 * Defines common workflows that can be executed by daemonLoom
 * to orchestrate Arakyd Draftsman operations.
 */

/**
 * Bulk Instance Creation Workflow
 */
export const bulkInstanceCreationWorkflow = {
	id: "arakyd_bulk_instance_creation",
	name: "Bulk Instance Creation",
	description: "Create multiple Penpot instances in batch",
	version: "1.0.0",
	parameters: [
		{
			name: "instances",
			type: "array",
			required: true,
			description: "Array of instance configurations"
		},
		{
			name: "concurrency",
			type: "number",
			default: 3,
			description: "Maximum concurrent instance creations"
		}
	],
	steps: [
		{
			id: "validate_input",
			type: "validation",
			action: "validate_instance_configurations"
		},
		{
			id: "create_instances",
			type: "parallel",
			concurrency: "{{parameters.concurrency}}",
			action: "create_instance_batch",
			input: "{{parameters.instances}}"
		},
		{
			id: "verify_instances",
			type: "verification",
			action: "verify_instance_health",
			depends_on: ["create_instances"]
		}
	]
};

/**
 * Instance Health Check Workflow
 */
export const instanceHealthCheckWorkflow = {
	id: "arakyd_instance_health_check",
	name: "Instance Health Check",
	description: "Comprehensive health check for all instances",
	version: "1.0.0",
	parameters: [
		{
			name: "include_connectivity",
			type: "boolean",
			default: true,
			description: "Include connectivity tests"
		},
		{
			name: "repair_unhealthy",
			type: "boolean",
			default: false,
			description: "Attempt to repair unhealthy instances"
		}
	],
	steps: [
		{
			id: "get_instances",
			type: "query",
			action: "get_all_instances"
		},
		{
			id: "health_check",
			type: "parallel",
			action: "check_instance_health",
			input: "{{steps.get_instances.output}}"
		},
		{
			id: "repair_unhealthy",
			type: "conditional",
			condition: "{{parameters.repair_unhealthy}}",
			action: "repair_unhealthy_instances",
			input: "{{steps.health_check.output}}"
		}
	]
};

/**
 * Environment Sync Workflow
 */
export const environmentSyncWorkflow = {
	id: "arakyd_environment_sync",
	name: "Environment Synchronization",
	description: "Synchronize instances across environments",
	version: "1.0.0",
	parameters: [
		{
			name: "source_environment",
			type: "string",
			required: true,
			description: "Source environment identifier"
		},
		{
			name: "target_environment",
			type: "string",
			required: true,
			description: "Target environment identifier"
		},
		{
			name: "sync_mode",
			type: "enum",
			values: ["incremental", "full"],
			default: "incremental",
			description: "Synchronization mode"
		}
	],
	steps: [
		{
			id: "get_source_state",
			type: "query",
			action: "get_environment_state",
			input: "{{parameters.source_environment}}"
		},
		{
			id: "get_target_state",
			type: "query",
			action: "get_environment_state",
			input: "{{parameters.target_environment}}"
		},
		{
			id: "calculate_diff",
			type: "computation",
			action: "calculate_environment_diff",
			input: {
				source: "{{steps.get_source_state.output}}",
				target: "{{steps.get_target_state.output}}",
				mode: "{{parameters.sync_mode}}"
			}
		},
		{
			id: "apply_changes",
			type: "execution",
			action: "apply_environment_changes",
			input: "{{steps.calculate_diff.output}}"
		}
	]
};

/**
 * Disaster Recovery Workflow
 */
export const disasterRecoveryWorkflow = {
	id: "arakyd_disaster_recovery",
	name: "Disaster Recovery",
	description: "Restore instances from backup in case of failure",
	version: "1.0.0",
	parameters: [
		{
			name: "backup_location",
			type: "string",
			required: true,
			description: "Backup location identifier"
		},
		{
			name: "recovery_mode",
			type: "enum",
			values: ["full", "partial", "selective"],
			default: "partial",
			description: "Recovery mode"
		},
		{
			name: "instance_ids",
			type: "array",
			required: false,
			description: "Specific instance IDs to recover (for selective mode)"
		}
	],
	steps: [
		{
			id: "validate_backup",
			type: "validation",
			action: "validate_backup_integrity",
			input: "{{parameters.backup_location}}"
		},
		{
			id: "stop_instances",
			type: "execution",
			action: "stop_affected_instances",
			input: "{{parameters.instance_ids}}"
		},
		{
			id: "restore_data",
			type: "execution",
			action: "restore_instance_data",
			input: {
				backup: "{{parameters.backup_location}}",
				mode: "{{parameters.recovery_mode}}",
				instances: "{{parameters.instance_ids}}"
			}
		},
		{
			id: "restart_instances",
			type: "execution",
			action: "restart_restored_instances",
			depends_on: ["restore_data"]
		},
		{
			id: "verify_recovery",
			type: "verification",
			action: "verify_recovery_success",
			depends_on: ["restart_instances"]
		}
	]
};

/**
 * Workflow executor class
 */
export class WorkflowExecutor {
	constructor(services, daemonLoomClient) {
		this.services = services;
		this.daemonLoomClient = daemonLoomClient;
		this.registeredWorkflows = new Map();
		this.activeExecutions = new Map();
	}

	/**
	 * Initialize workflow executor
	 */
	async initialize() {
		// Register built-in workflows
		await this.registerWorkflow(bulkInstanceCreationWorkflow);
		await this.registerWorkflow(instanceHealthCheckWorkflow);
		await this.registerWorkflow(environmentSyncWorkflow);
		await this.registerWorkflow(disasterRecoveryWorkflow);

		logger.info("Workflow executor initialized with built-in workflows");
	}

	/**
	 * Register a workflow
	 */
	async registerWorkflow(workflow) {
		this.registeredWorkflows.set(workflow.id, workflow);
		
		// Register with daemonLoom if connected
		if (this.daemonLoomClient.isConnected) {
			try {
				await this.daemonLoomClient.registerWorkflow(workflow);
			} catch (error) {
				logger.error(`Failed to register workflow ${workflow.id} with daemonLoom:`, error);
			}
		}

		logger.debug(`Workflow registered: ${workflow.id}`);
	}

	/**
	 * Execute a workflow
	 */
	async executeWorkflow(workflowId, parameters = {}) {
		const workflow = this.registeredWorkflows.get(workflowId);
		if (!workflow) {
			throw new Error(`Workflow ${workflowId} not found`);
		}

		const executionId = Math.random().toString(36).substr(2, 9);
		const execution = {
			id: executionId,
			workflowId,
			parameters,
			status: "running",
			startTime: new Date().toISOString(),
			steps: [],
			result: null,
			error: null
		};

		this.activeExecutions.set(executionId, execution);

		try {
			logger.info(`Starting workflow execution ${executionId} for ${workflowId}`);
			
			// Execute workflow steps
			const result = await this.executeWorkflowSteps(workflow, parameters, execution);
			
			execution.status = "completed";
			execution.result = result;
			execution.endTime = new Date().toISOString();

			logger.info(`Workflow execution ${executionId} completed successfully`);
			return result;

		} catch (error) {
			execution.status = "failed";
			execution.error = error.message;
			execution.endTime = new Date().toISOString();

			logger.error(`Workflow execution ${executionId} failed:`, error);
			throw error;

		} finally {
			// Clean up execution after some time
			setTimeout(() => {
				this.activeExecutions.delete(executionId);
			}, 5 * 60 * 1000); // 5 minutes
		}
	}

	/**
	 * Execute workflow steps
	 */
	async executeWorkflowSteps(workflow, parameters, execution) {
		const stepResults = {};

		for (const step of workflow.steps) {
			try {
				logger.debug(`Executing workflow step: ${step.id}`);
				
				const stepResult = await this.executeWorkflowStep(step, parameters, stepResults);
				stepResults[step.id] = stepResult;
				
				execution.steps.push({
					id: step.id,
					status: "completed",
					result: stepResult,
					timestamp: new Date().toISOString()
				});

			} catch (error) {
				execution.steps.push({
					id: step.id,
					status: "failed",
					error: error.message,
					timestamp: new Date().toISOString()
				});
				throw error;
			}
		}

		return stepResults;
	}

	/**
	 * Execute a single workflow step
	 */
	async executeWorkflowStep(step, parameters, previousResults) {
		const { instanceManager, dockerOrchestrator, healthMonitor } = this.services;

		switch (step.action) {
			case "get_all_instances":
				return instanceManager.getAllInstances();

			case "check_instance_health":
				const instances = step.input || previousResults.get_instances;
				const healthResults = {};
				for (const instance of instances) {
					healthResults[instance.id] = await dockerOrchestrator.getInstanceHealth(instance.id);
				}
				return healthResults;

			case "create_instance_batch":
				const instanceConfigs = step.input || parameters.instances;
				const createdInstances = [];
				for (const config of instanceConfigs) {
					const instanceId = await instanceManager.createInstance(config);
					createdInstances.push(instanceId);
				}
				return createdInstances;

			case "validate_instance_configurations":
				// Implement validation logic
				return { valid: true };

			case "verify_instance_health":
				// Implement health verification
				return await healthMonitor.getCurrentHealth();

			default:
				throw new Error(`Unknown workflow action: ${step.action}`);
		}
	}

	/**
	 * Get workflow execution status
	 */
	getExecutionStatus(executionId) {
		return this.activeExecutions.get(executionId);
	}

	/**
	 * List active executions
	 */
	getActiveExecutions() {
		return Array.from(this.activeExecutions.values());
	}

	/**
	 * Get registered workflows
	 */
	getRegisteredWorkflows() {
		return Array.from(this.registeredWorkflows.values());
	}
}