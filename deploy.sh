#!/bin/bash

set -eufo pipefail

tmpTemplate=tmp.yml
aws cloudformation package --template-file template.yml --s3-bucket $PACKAGES_BUCKET --output-template-file $tmpTemplate

aws cloudformation deploy --template-file $tmpTemplate --stack-name $STACK_NAME --tags "App=EBS-SNAPSHOT-Management" --capabilities CAPABILITY_IAM