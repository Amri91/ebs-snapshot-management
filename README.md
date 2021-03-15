# Introduction

This project does the following:
- Periodically creates AWS EBS snapshots.
- Deletes older AWS Snapshots.
- Deletes AWS Snapshots that are not managed by AWS DLM.
- Registers newly created AWS EC2 volumes.

It uses an AWS Lambda to:
- Tag AWS EC2 Volumes so that AWS DLM can manage them.
- Mark AWS Snapshots that are not managed by AWS DLM.
- Deletes marked AWS Snapshots after some time.

It also sets up an AWS DLM to maintain a number of EBS snapshots per EBS volume.

# Quick start

```shell
node -v # Check if you have 
docker -v # Check if you have docker
export PACKAGES_BUCKET={Put a bucket name here to store the AWS Lambda code.}
export STACK_NAME={Put a stack name here.}
./package.sh
./deploy.sh
```

# Configuration

To further configure this you can edit the template variables via deploy.sh or directly edit the file template.yml.

# Development Requirements

- docker
- node version >= 8