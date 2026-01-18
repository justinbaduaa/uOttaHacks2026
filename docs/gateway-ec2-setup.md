# Gateway EC2 Deployment (AWS Backend)

This guide is for running the Glass Box gateway + Agent Mesh on EC2 so the
AWS-deployed backend can reach it via `GatewayApiBaseUrl`.

## Why EC2 (or any public host) is required
When the backend runs in AWS, Lambda must call the gateway via a public URL.
`GatewayApiBaseUrl` cannot be `localhost` in that case.

## 1) Launch the EC2 instance
- Region: same as your backend (API Gateway) region.
- AMI: Ubuntu 22.04 LTS (or Amazon Linux 2023).
- Instance type: `t3.small` is enough for initial testing.
- Storage: 20+ GB.
- Security group inbound:
  - `22/tcp` from your IP (SSH).
  - `8001/tcp` from anywhere for quick testing (tighten later), or use a
    reverse proxy on `443` and only expose HTTPS.
- Optional but recommended: attach an Elastic IP for a stable base URL.

## 2) Install dependencies on EC2 (Ubuntu example)
```bash
sudo apt update
sudo apt install -y git python3.11 python3.11-venv
```

## 3) Clone repo and create venv
```bash
sudo mkdir -p /opt/glassbox
sudo chown $USER:$USER /opt/glassbox
cd /opt/glassbox
git clone <your-repo-url> uOttaHacks2026
cd uOttaHacks2026
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install "solace-agent-mesh~=1.13.6"
```

## 4) Configure gateway environment
Edit `/opt/glassbox/uOttaHacks2026/agent-mesh/.env`:
```
GLASSBOX_API_BASE_URL="https://<api-id>.execute-api.<region>.amazonaws.com"
GLASSBOX_BACKEND_AUTH_MODE="service_token"
GLASSBOX_SERVICE_TOKEN="Bearer <cognito-jwt>"
GLASSBOX_GATEWAY_SHARED_SECRET="<same-as-GatewaySharedSecret>"
PLATFORM_API_HOST="0.0.0.0"
PLATFORM_API_PORT="8001"
YELLOWCAKE_API_KEY="<yellowcake-key>"
```

Notes:
- `PLATFORM_API_HOST=0.0.0.0` is required so the gateway listens on all
  interfaces.
- `GLASSBOX_GATEWAY_SHARED_SECRET` must match the backend parameter
  `GatewaySharedSecret` if you set it.

## 5) Run the gateway + agents
From `/opt/glassbox/uOttaHacks2026/agent-mesh`:
```bash
source ../.venv/bin/activate
solace-agent-mesh run
```

If AWS SAM is installed and the `sam` command conflicts, always use
`solace-agent-mesh run` explicitly.

## 6) Update the backend with the gateway URL
If you already deployed the backend, update the parameter:
```bash
cd /opt/glassbox/uOttaHacks2026/backend
sam deploy --parameter-overrides \
  GatewayApiBaseUrl="http://<public-ec2-ip>:8001" \
  GatewaySharedSecret="<same-secret>"
```

## 7) Run as a service (optional but recommended)
Copy the sample systemd unit and edit paths/user:
```bash
sudo cp /opt/glassbox/uOttaHacks2026/ops/systemd/glass-box-gateway.service \
  /etc/systemd/system/glass-box-gateway.service
sudo systemctl daemon-reload
sudo systemctl enable --now glass-box-gateway.service
sudo systemctl status glass-box-gateway.service
```

## 8) Test end-to-end
Execute a node from the backend. If the gateway is reachable, the node
execution should start and the activity log should stream.
