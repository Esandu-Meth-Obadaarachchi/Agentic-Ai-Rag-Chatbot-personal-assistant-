# 15 — Deploying the backend to AWS ECS (Fargate)

The backend is a single stateless container. That is the whole reason for the
rebuild: package the RAG service as a Docker image and run it on ECS Fargate, with
the secrets injected at runtime and the Next.js frontend pointed at its URL.

This guide is the happy path with the AWS CLI. Do it once by hand to understand
the pieces, then move it to Terraform or Copilot later.

## The shape

```
  Docker image ──► Amazon ECR (registry)
                        │
                        ▼
  ECS Fargate service ──► runs N tasks (containers) ──► Application Load Balancer
                        │                                      │
                        │  env/secrets from                    │  health check: /health
                        ▼  Secrets Manager                     ▼
                   Anthropic · Voyage · Pinecone · Firebase   public HTTPS URL
```

The frontend's `RAG_API_URL` points at the load balancer URL. Nothing else changes.

## 0. Build locally first (M1 note)

The container runs on x86 Fargate, so build for `linux/amd64` — an M1 builds arm64
by default and the image will not run on Fargate.

```bash
cd backend
docker build --platform linux/amd64 -t agentic-rag-api .
docker run --env-file .env -p 8000:8000 agentic-rag-api
# check http://localhost:8000/health
```

## 1. Push the image to ECR

```bash
AWS_REGION=ap-south-1                 # match your Firestore region if you like
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REPO="$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com/agentic-rag-api"

aws ecr create-repository --repository-name agentic-rag-api --region $AWS_REGION
aws ecr get-login-password --region $AWS_REGION \
  | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com"

docker tag agentic-rag-api:latest "$REPO:latest"
docker push "$REPO:latest"
```

## 2. Store the secrets (do NOT bake keys into the image)

Put each key in AWS Secrets Manager and reference them from the task definition.

```bash
aws secretsmanager create-secret --name agentic-rag/anthropic --secret-string "sk-ant-..."
aws secretsmanager create-secret --name agentic-rag/voyage    --secret-string "pa-..."
aws secretsmanager create-secret --name agentic-rag/pinecone  --secret-string "pcsk-..."
aws secretsmanager create-secret --name agentic-rag/fb-project --secret-string "second-brain-fbf414"
aws secretsmanager create-secret --name agentic-rag/fb-email   --secret-string "firebase-adminsdk-...@...iam.gserviceaccount.com"
# The private key keeps its \n escapes; the app un-escapes them.
aws secretsmanager create-secret --name agentic-rag/fb-key --secret-string '-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n'
```

## 3. Task definition

`task-def.json` (fill in the account id and secret ARNs). Fargate, 0.5 vCPU / 1 GB
is plenty — the models are all remote APIs, nothing runs locally.

```json
{
  "family": "agentic-rag-api",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::<ACCOUNT>:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "<ACCOUNT>.dkr.ecr.<REGION>.amazonaws.com/agentic-rag-api:latest",
      "portMappings": [{ "containerPort": 8000, "protocol": "tcp" }],
      "environment": [
        { "name": "APP_ENV", "value": "prod" },
        { "name": "CLAUDE_MODEL", "value": "claude-haiku-4-5" },
        { "name": "PINECONE_INDEX_NAME", "value": "second-brain" },
        { "name": "CORS_ORIGINS", "value": "https://luneai.site" }
      ],
      "secrets": [
        { "name": "ANTHROPIC_API_KEY", "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT>:secret:agentic-rag/anthropic" },
        { "name": "VOYAGE_API_KEY", "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT>:secret:agentic-rag/voyage" },
        { "name": "PINECONE_API_KEY", "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT>:secret:agentic-rag/pinecone" },
        { "name": "FIREBASE_ADMIN_PROJECT_ID", "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT>:secret:agentic-rag/fb-project" },
        { "name": "FIREBASE_ADMIN_CLIENT_EMAIL", "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT>:secret:agentic-rag/fb-email" },
        { "name": "FIREBASE_ADMIN_PRIVATE_KEY", "valueFrom": "arn:aws:secretsmanager:<REGION>:<ACCOUNT>:secret:agentic-rag/fb-key" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/agentic-rag-api",
          "awslogs-region": "<REGION>",
          "awslogs-stream-prefix": "api",
          "awslogs-create-group": "true"
        }
      }
    }
  ]
}
```

```bash
aws ecs register-task-definition --cli-input-json file://task-def.json
```

The `ecsTaskExecutionRole` needs `AmazonECSTaskExecutionRolePolicy` plus permission
to read those secrets (`secretsmanager:GetSecretValue`).

## 4. Cluster, ALB, service

```bash
aws ecs create-cluster --cluster-name agentic-rag

# Create an ALB + target group (health check path /health, port 8000) in your VPC,
# then the service that keeps 1 task running behind it:
aws ecs create-service \
  --cluster agentic-rag \
  --service-name agentic-rag-api \
  --task-definition agentic-rag-api \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-...],securityGroups=[sg-...],assignPublicIp=ENABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=api,containerPort=8000"
```

Target group health check: path `/health`, healthy code `200`. The container's own
`HEALTHCHECK` covers the local process; the ALB check controls traffic routing.

## 5. Point the frontend at it

Set `RAG_API_URL` on the Netlify site (or wherever the frontend runs) to the ALB
URL, e.g. `https://agentic-rag-api-1234.<region>.elb.amazonaws.com`. Add that origin
nowhere — CORS is the backend's `CORS_ORIGINS`, which must list the frontend origin
(`https://luneai.site`).

## 6. Redeploy on a new image

```bash
docker build --platform linux/amd64 -t agentic-rag-api . && docker tag ... && docker push ...
aws ecs update-service --cluster agentic-rag --service agentic-rag-api --force-new-deployment
```

## Cost note

Fargate bills per vCPU/GB-second. One 0.5 vCPU / 1 GB task left running is a few
dollars a month; the ALB is the bigger line item. For a demo, run the task only
when you need it, or use `desired-count 0` to park it.
