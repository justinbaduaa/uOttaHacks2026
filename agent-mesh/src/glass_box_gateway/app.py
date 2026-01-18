"""
Solace Agent Mesh App class for the GlassBoxGateway Gateway.
"""

import logging
from typing import Any, Dict, List, Type

from solace_agent_mesh.gateway.base.app import BaseGatewayApp
from solace_agent_mesh.gateway.base.component import BaseGatewayComponent

from .component import GlassBoxGatewayGatewayComponent

log = logging.getLogger(__name__)

info = {
    "class_name": "GlassBoxGatewayGatewayApp",
    "description": "Custom App class for the A2A GlassBoxGateway Gateway.",
}

class GlassBoxGatewayGatewayApp(BaseGatewayApp):
    """
    App class for the A2A GlassBoxGateway Gateway.
    - Extends BaseGatewayApp for common gateway functionalities.
    - Defines GlassBoxGateway-specific configuration parameters below.
    """

    # Define GlassBoxGateway-specific parameters
    # This list will be automatically merged with BaseGatewayApp's schema.
    # These parameters will be configurable in the yaml config file
    # under the 'app_config' section.
    SPECIFIC_APP_SCHEMA_PARAMS: List[Dict[str, Any]] = [
        {
            "name": "backend_api_base_url",
            "required": True,
            "type": "string",
            "description": "Base URL for the Glass Box backend (API Gateway).",
        },
        {
            "name": "backend_auth_mode",
            "required": False,
            "type": "string",
            "default": "service_token",
            "description": "Backend auth mode: service_token or user_token.",
        },
        {
            "name": "backend_service_token",
            "required": False,
            "type": "string",
            "default": "",
            "description": "Service token for backend auth when using service_token mode.",
        },
        {
            "name": "backend_timeout_seconds",
            "required": False,
            "type": "integer",
            "default": 30,
            "description": "Timeout in seconds for backend requests.",
        },
        {
            "name": "approval_mode_default",
            "required": False,
            "type": "string",
            "default": "approve_nodes",
            "description": "Default approval mode: auto, approve_nodes, or approve_all.",
        },
        {
            "name": "node_budget_max_children",
            "required": False,
            "type": "integer",
            "default": 3,
            "description": "Default max number of child nodes agents may propose.",
        },
        {
            "name": "node_budget_max_depth",
            "required": False,
            "type": "integer",
            "default": 3,
            "description": "Default max depth for agent-proposed subnodes.",
        },
        {
            "name": "artifact_upload_mode",
            "required": False,
            "type": "string",
            "default": "s3",
            "description": "How gateway persists artifacts: s3, reference, or embed.",
        },
    ]

    def __init__(self, app_info: Dict[str, Any], **kwargs):
        log_prefix = app_info.get("name", "GlassBoxGatewayGatewayApp")
        log.debug("[%s] Initializing GlassBoxGatewayGatewayApp...", log_prefix)
        super().__init__(app_info=app_info, **kwargs)
        log.debug("[%s] GlassBoxGatewayGatewayApp initialization complete.", self.name)

    def _get_gateway_component_class(self) -> Type[BaseGatewayComponent]:
        """
        Returns the specific gateway component class for this app.
        """
        return GlassBoxGatewayGatewayComponent
