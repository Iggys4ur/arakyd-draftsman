# Arakyd-Draftsman Daemon Integration Plan

## Overview

This document outlines the plan to transform arakyd-draftsman's functionality from an Electron desktop application into a daemon service that can be integrated with ndoc (Null Doctrine) and its components (daemonLoom, s!phon, etc.).

## Current Architecture Analysis

### Existing Components
- **Electron Main Process**: Instance management, Docker orchestration, IPC handling
- **Docker Integration**: Local Penpot instance creation and management
- **Instance Management**: Configuration, registration, lifecycle management
- **Server Utilities**: Port management, availability checking
- **Configuration System**: Settings persistence and management

### Core Functionality to Extract
1. **Docker Instance Management**
   - Container lifecycle (create, start, stop, remove)
   - Port allocation and management
   - Configuration templating
   - Health checking

2. **Instance Registry**
   - Instance registration and discovery
   - Configuration persistence
   - Default instance management

3. **Network Services**
   - Port availability checking
   - Service discovery
   - Health monitoring

## Proposed Daemon Architecture

### 1. Service Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Arakyd Daemon                           │
├─────────────────────────────────────────────────────────────┤
│  API Layer (REST/WebSocket)                                │
│  ├── Instance Management API                               │
│  ├── Health Check API                                      │
│  ├── Configuration API                                     │
│  └── Service Discovery API                                 │
├─────────────────────────────────────────────────────────────┤
│  Core Services                                             │
│  ├── Instance Manager                                      │
│  ├── Docker Orchestrator                                   │
│  ├── Port Manager                                          │
│  ├── Configuration Manager                                 │
│  └── Health Monitor                                        │
├─────────────────────────────────────────────────────────────┤
│  Data Layer                                                │
│  ├── Instance Registry                                     │
│  ├── Configuration Store                                   │
│  └── Metrics Store                                         │
└─────────────────────────────────────────────────────────────┘
```

### 2. Integration Points for Ndoc Components

#### daemonLoom Integration
- **Purpose**: Process and workflow orchestration
- **Integration**: 
  - REST API endpoints for instance lifecycle management
  - Webhook notifications for instance state changes
  - Batch operations for multiple instances

#### s!phon Integration  
- **Purpose**: Data extraction and processing
- **Integration**:
  - WebSocket streams for real-time instance metrics
  - Export API for project data
  - Monitoring endpoints for performance data

## Implementation Plan

### Phase 1: Daemon Core Infrastructure
1. **Service Foundation**
   - Create daemon entry point and lifecycle management
   - Implement configuration system for daemon mode
   - Set up logging and monitoring infrastructure

2. **API Layer**
   - REST API server setup (Express.js or Fastify)
   - WebSocket server for real-time communication
   - Authentication and authorization framework

### Phase 2: Core Service Extraction
1. **Instance Management Service**
   - Extract from `src/process/instance.js`
   - Decouple from Electron IPC
   - Create service interfaces

2. **Docker Orchestration Service**
   - Extract from `src/process/docker.js`
   - Enhance with daemon-specific features
   - Add container monitoring

3. **Configuration Management**
   - Extract from `src/process/config.js` and `src/process/settings.js`
   - Create persistent storage layer
   - Add configuration validation

### Phase 3: API Implementation
1. **REST Endpoints**
   ```
   GET    /api/v1/instances           # List all instances
   POST   /api/v1/instances           # Create new instance
   GET    /api/v1/instances/:id       # Get instance details
   PUT    /api/v1/instances/:id       # Update instance
   DELETE /api/v1/instances/:id       # Remove instance
   POST   /api/v1/instances/:id/start # Start instance
   POST   /api/v1/instances/:id/stop  # Stop instance
   GET    /api/v1/instances/:id/health # Health check
   
   GET    /api/v1/config              # Get daemon configuration
   PUT    /api/v1/config              # Update daemon configuration
   
   GET    /api/v1/health              # Daemon health check
   GET    /api/v1/metrics             # Daemon metrics
   ```

2. **WebSocket Events**
   ```
   instance:created    # New instance created
   instance:started    # Instance started
   instance:stopped    # Instance stopped
   instance:removed    # Instance removed
   instance:health     # Health status update
   metrics:update      # Performance metrics
   ```

### Phase 4: Ndoc Integration Modules
1. **daemonLoom Module**
   - Workflow orchestration client
   - Batch operation handlers
   - Process management integration

2. **s!phon Module**
   - Data extraction client
   - Real-time monitoring setup
   - Export functionality

### Phase 5: Testing and Documentation
1. **Testing Framework**
   - Unit tests for core services
   - Integration tests for API endpoints
   - End-to-end tests for ndoc integration

2. **Documentation**
   - API documentation (OpenAPI/Swagger)
   - Integration guides for ndoc components
   - Deployment and configuration guides

## File Structure Changes

```
src/
├── daemon/                    # New daemon implementation
│   ├── index.js              # Daemon entry point
│   ├── server.js             # HTTP/WebSocket server
│   ├── api/                  # API route handlers
│   │   ├── instances.js
│   │   ├── config.js
│   │   ├── health.js
│   │   └── metrics.js
│   ├── services/             # Core business logic
│   │   ├── InstanceManager.js
│   │   ├── DockerOrchestrator.js
│   │   ├── PortManager.js
│   │   ├── ConfigManager.js
│   │   └── HealthMonitor.js
│   ├── middleware/           # Express middleware
│   │   ├── auth.js
│   │   ├── validation.js
│   │   └── logging.js
│   └── utils/               # Daemon-specific utilities
│       ├── logger.js
│       └── response.js
├── ndoc/                     # Ndoc integration modules
│   ├── daemonLoom/
│   │   ├── client.js         # daemonLoom integration client
│   │   └── workflows.js      # Workflow definitions
│   └── siphon/
│       ├── client.js         # s!phon integration client
│       ├── extractors.js     # Data extraction logic
│       └── monitors.js       # Real-time monitoring
├── shared/                   # Shared utilities (enhanced)
│   ├── instance.js           # Instance schemas and constants
│   ├── config.js             # Configuration schemas
│   └── events.js             # Event definitions
└── process/                  # Original Electron code (preserved)
    └── ... (existing files)
```

## Configuration

### Daemon Configuration
```json
{
  "daemon": {
    "port": 8080,
    "host": "0.0.0.0",
    "logLevel": "info",
    "maxInstances": 10,
    "docker": {
      "defaultTag": "latest",
      "networkName": "arakyd-network",
      "volumePrefix": "arakyd-data"
    }
  },
  "ndoc": {
    "daemonLoom": {
      "enabled": true,
      "endpoint": "http://localhost:3000"
    },
    "siphon": {
      "enabled": true,
      "endpoint": "ws://localhost:3001"
    }
  }
}
```

## Security Considerations

1. **Authentication**: JWT-based authentication for API access
2. **Authorization**: Role-based access control for different operations
3. **Docker Security**: Secure container configuration and isolation
4. **Network Security**: TLS encryption for all communications
5. **Input Validation**: Comprehensive validation for all API inputs

## Monitoring and Observability

1. **Health Checks**: Comprehensive health monitoring for daemon and instances
2. **Metrics**: Prometheus-compatible metrics for monitoring
3. **Logging**: Structured logging with correlation IDs
4. **Tracing**: Distributed tracing for debugging complex operations

## Migration Strategy

1. **Backward Compatibility**: Maintain existing Electron app functionality
2. **Gradual Migration**: Support both desktop and daemon modes
3. **Configuration Migration**: Automatic migration of existing configurations
4. **Testing**: Comprehensive testing during transition period

## Success Criteria

1. **Functional**: All current functionality available via daemon APIs
2. **Performance**: Daemon can handle concurrent requests efficiently
3. **Integration**: Successful integration with daemonLoom and s!phon
4. **Reliability**: 99.9% uptime with proper error handling
5. **Documentation**: Complete API and integration documentation