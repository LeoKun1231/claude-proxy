## ADDED Requirements

### Requirement: Runtime configuration persists under the configured data directory
The system SHALL persist runtime configuration, including model-specific routes and legacy provider settings, in the configured `DATA_DIR` so that process restarts load the same effective configuration.

#### Scenario: Restart restores saved configuration
- **WHEN** a user saves model-specific routes and the service process restarts
- **THEN** the service reloads the saved routes and exposes the same effective configuration through its configuration APIs

### Requirement: Configuration format supports backward-compatible migration
The system SHALL read legacy configuration files that do not yet contain model-specific routing fields and MUST preserve existing provider and mapping behavior after upgrade.

#### Scenario: Legacy config is upgraded
- **WHEN** the service starts with an existing configuration file that only contains legacy provider and mapping fields
- **THEN** the service loads the file successfully, preserves the legacy behavior, and makes the configuration writable in the new format without losing existing settings

### Requirement: Docker deployments can retain configuration across container recreation
The system SHALL store all runtime-managed configuration in `DATA_DIR` and SHALL document that cross-container persistence depends on mounting that directory to a host path or named Docker volume.

#### Scenario: Container is recreated with persistent data directory
- **WHEN** a Docker container is deleted and recreated while the same host or named volume is still mounted to `DATA_DIR`
- **THEN** the recreated service loads the previously saved configuration without requiring the user to re-enter routes or API keys
