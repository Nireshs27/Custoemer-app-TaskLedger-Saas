# Run these commands with an AWS admin profile (not claude-mcp).
# Region: ap-south-1

# 1) IAM role + instance profile for EC2
# See docs/architecture/AWS-INFRASTRUCTURE.md for full policy JSON.

# 2) Attach instance profile to launch template (after creating tl-ec2-role profile):
# aws ec2 modify-launch-template --region ap-south-1 --launch-template-id lt-0de27e5fa79cb5d46 --default-version 3

# 3) Put production env on the instance via SSM Session Manager:
#   /opt/task-ledger/.env  (copy from .env.aws.example)

# 4) On the instance:
#   aws s3 cp s3://task-ledger-artifacts-prod/scripts/bootstrap.sh /tmp/bootstrap.sh --region ap-south-1
#   bash /tmp/bootstrap.sh

# 5) Instance refresh to roll out launch template changes:
# aws autoscaling start-instance-refresh --region ap-south-1 --auto-scaling-group-name task-ledger-asg

Write-Host @"
AWS deployment — admin checklist
=================================
1. Create IAM role tl-ec2-role (S3 read artifacts + SSM core)
2. Attach instance profile to launch template task-ledger-lt
3. ASG instance refresh
4. SSM into EC2, create /opt/task-ledger/.env from .env.aws.example
5. Run bootstrap.sh from S3
6. Verify: curl ALB/api/health

ALB: http://task-ledger-alb-1215947872.ap-south-1.elb.amazonaws.com
RDS: task-ledger-db.cxsi04c0o3ap.ap-south-1.rds.amazonaws.com
"@
