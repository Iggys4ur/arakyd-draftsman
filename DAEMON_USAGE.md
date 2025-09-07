# Arakyd Draftsman Daemon Usage Guide

## Overview

This guide demonstrates how to use the Arakyd Draftsman daemon for integrating with ndoc (Null Doctrine) components. The daemon provides REST APIs and WebSocket interfaces for managing Penpot instances programmatically.

## Starting the Daemon

### Development Mode
```bash
npm run daemon:dev
```

### Production Mode
```bash
npm run daemon
```

The daemon will start on `http://localhost:8080` by default.

## Configuration

The daemon uses a configuration file `arakyd-daemon.json` which will be created automatically with default values:

```json
{
  "daemon": {
    "port": 8080,
    "host": "0.0.0.0",
    "logLevel": "info",
    "maxInstances": 10,
    "portRange": {
      "start": 9001,
      "end": 9100
    },
    "docker": {
      "defaultTag": "latest",
      "networkName": "arakyd-network",
      "volumePrefix": "arakyd-data",
      "containerPrefix": "arakyd-pd"
    }
  },
  "ndoc": {
    "daemonLoom": {
      "enabled": false,
      "endpoint": "http://localhost:3000"
    },
    "siphon": {
      "enabled": false,
      "endpoint": "ws://localhost:3001"
    }
  },
  "instances": {
    "autoStart": false,
    "healthCheckInterval": 30000,
    "maxRetries": 3
  }
}
```

## API Endpoints

### Instance Management

#### List all instances
```bash
curl http://localhost:8080/api/v1/instances
```

#### Create a new instance
```bash
curl -X POST http://localhost:8080/api/v1/instances \\
  -H "Content-Type: application/json" \\
  -d '{
    "label": "My Penpot Instance",
    "tag": "latest",
    "enableTelemetry": false,
    "makeDefault": true
  }'
```

#### Get instance details
```bash
curl http://localhost:8080/api/v1/instances/{instanceId}
```

#### Start an instance
```bash
curl -X POST http://localhost:8080/api/v1/instances/{instanceId}/start
```

#### Stop an instance
```bash
curl -X POST http://localhost:8080/api/v1/instances/{instanceId}/stop
```

#### Remove an instance
```bash
curl -X DELETE http://localhost:8080/api/v1/instances/{instanceId}
```

#### Check instance health
```bash
curl http://localhost:8080/api/v1/instances/{instanceId}/health
```

### Health Monitoring

#### Get overall system health
```bash
curl http://localhost:8080/api/v1/health
```

#### Get daemon health only
```bash
curl http://localhost:8080/api/v1/health/daemon
```

#### Get Docker health
```bash
curl http://localhost:8080/api/v1/health/docker
```

#### Force a health check
```bash
curl -X POST http://localhost:8080/api/v1/health/check
```

### Metrics

#### Get comprehensive metrics
```bash
curl http://localhost:8080/api/v1/metrics
```

#### Get Prometheus-formatted metrics
```bash
curl http://localhost:8080/api/v1/metrics/prometheus
```

### Configuration Management

#### Get current configuration
```bash
curl http://localhost:8080/api/v1/config
```

#### Update configuration
```bash
curl -X PUT http://localhost:8080/api/v1/config \\
  -H "Content-Type: application/json" \\
  -d '{
    "daemon": {
      "logLevel": "debug",
      "maxInstances": 20
    }
  }'
```

## WebSocket API

Connect to `ws://localhost:8080/ws` for real-time updates.

### Example WebSocket Usage

```javascript
const ws = new WebSocket('ws://localhost:8080/ws');

ws.onopen = () => {
  console.log('Connected to Arakyd Daemon');
  
  // Subscribe to events
  ws.send(JSON.stringify({
    type: 'subscribe',
    data: {
      events: ['instance:created', 'instance:removed', 'health:update']
    }
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log('Received:', message);
  
  switch (message.type) {
    case 'instance:created':
      console.log('New instance created:', message.data);
      break;
    case 'health:update':
      console.log('Health update:', message.data);
      break;
  }
};
```

## ndoc Integration Examples

### daemonLoom Integration

```javascript
import { DaemonLoomClient } from './src/ndoc/daemonLoom/client.js';

const daemonLoom = new DaemonLoomClient({
  endpoint: 'http://localhost:3000',
  enabled: true
});

await daemonLoom.initialize();

// Execute a workflow
const result = await daemonLoom.executeWorkflow('arakyd_bulk_instance_creation', {
  instances: [
    { label: 'Dev Instance', tag: 'latest' },
    { label: 'Test Instance', tag: 'latest' }
  ],
  concurrency: 2
});

console.log('Workflow result:', result);
```

### s!phon Integration

```javascript
import { SiphonClient } from './src/ndoc/siphon/client.js';

const siphon = new SiphonClient({
  endpoint: 'ws://localhost:3001',
  enabled: true
});

await siphon.initialize();

// Subscribe to real-time events
siphon.on('connected', () => {
  console.log('Connected to s!phon');
});

siphon.on('message', (message) => {
  console.log('s!phon message:', message);
});

// The client will automatically forward daemon events to s!phon
```

## Docker Requirements

The daemon requires Docker to be installed and running:

1. **Install Docker**: Follow the [official Docker installation guide](https://docs.docker.com/get-docker/)
2. **Start Docker**: Ensure the Docker daemon is running
3. **Verify Installation**: Run `docker --version` and `docker compose version`

## Environment Variables

- `ARAKYD_CONFIG_DIR`: Directory for configuration file (default: current directory)
- `LOG_LEVEL`: Logging level (error, warn, info, debug)
- `DOCKER_HOST`: Docker daemon host (if not using default)

## Integration Patterns

### Batch Operations

```bash
# Create multiple instances
for i in {1..5}; do
  curl -X POST http://localhost:8080/api/v1/instances \\
    -H "Content-Type: application/json" \\
    -d "{\\"label\\": \\"Instance $i\\", \\"tag\\": \\"latest\\"}"
done
```

### Health Monitoring

```bash
# Monitor instance health continuously
while true; do
  curl -s http://localhost:8080/api/v1/health/summary | jq '.'
  sleep 30
done
```

### Configuration Backup

```bash
# Backup current configuration
curl -s http://localhost:8080/api/v1/config > backup-config.json

# Restore configuration
curl -X PUT http://localhost:8080/api/v1/config \\
  -H "Content-Type: application/json" \\
  -d @backup-config.json
```

## Troubleshooting

### Common Issues

1. **Docker not available**
   - Ensure Docker is installed and running
   - Check Docker permissions for the user

2. **Port conflicts**
   - Adjust the `portRange` in configuration
   - Check for other services using the same ports

3. **Permission errors**
   - Run with appropriate permissions for Docker access
   - Consider using Docker in rootless mode

### Debug Mode

Start the daemon in debug mode for verbose logging:

```bash
LOG_LEVEL=debug npm run daemon:dev
```

### Log Files

The daemon logs to stdout by default. For persistent logging:

```bash
npm run daemon 2>&1 | tee arakyd-daemon.log
```

## API Response Formats

All API responses follow this general structure:

```json
{
  "data": { },
  "message": "Operation completed successfully",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

Error responses:

```json
{
  "error": "Error Type",
  "message": "Detailed error message",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "requestId": "abc123"
}
```

## Performance Considerations

- **Instance Limits**: Default maximum of 10 instances (configurable)
- **Port Range**: Default range 9001-9100 (adjustable)
- **Memory Usage**: Monitor daemon memory consumption in production
- **Docker Resources**: Ensure adequate Docker resources for containers

## Security Notes

- **Network Security**: The daemon binds to all interfaces by default
- **Authentication**: Currently no authentication - add reverse proxy if needed
- **Container Isolation**: Instances run in isolated Docker containers
- **Configuration**: Sensitive data should be managed externally

## Next Steps

1. Configure integration with your ndoc components
2. Set up monitoring and alerting
3. Implement backup and disaster recovery procedures
4. Consider adding authentication/authorization layer
5. Scale horizontally by deploying multiple daemon instances