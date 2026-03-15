## ADDED Requirements

### Requirement: Users can manage model-specific routes
The system SHALL allow users to create, update, enable, disable, and delete multiple model-specific routes in the configuration UI. Each route MUST persist a source model, target model, base URL, API Key, provider identifier, and enabled state.

#### Scenario: Create a model-specific route
- **WHEN** a user adds a new route with a source model, target model, base URL, API Key, provider identifier, and enabled state
- **THEN** the system stores the route in persistent configuration and shows it in the route list

#### Scenario: Disable a model-specific route
- **WHEN** a user disables an existing route
- **THEN** the system keeps the route definition but excludes it from request routing until it is re-enabled

### Requirement: Proxy routes requests by incoming model
The proxy SHALL inspect the incoming request model field before forwarding the request and SHALL use the enabled route whose source model exactly matches the incoming model. The proxy MUST rewrite the upstream request model to the configured target model for the matched route.

#### Scenario: Exact route match
- **WHEN** a request arrives with model `claude-3-5-sonnet` and an enabled route exists for `claude-3-5-sonnet`
- **THEN** the proxy forwards the request using that route's base URL, API Key, provider identifier, and target model

#### Scenario: No exact route match
- **WHEN** a request arrives with a model that does not match any enabled model-specific route
- **THEN** the proxy uses the configured legacy fallback routing if available, otherwise it returns a client-visible configuration error

### Requirement: Legacy mapping remains available during migration
The system SHALL continue to support the existing global mapping and provider configuration as a fallback path while model-specific routing is being adopted.

#### Scenario: Legacy fallback is used
- **WHEN** model-specific routes are empty or do not match the incoming model and a valid legacy global mapping exists
- **THEN** the proxy forwards the request using the legacy mapping behavior without requiring users to recreate existing provider configuration
