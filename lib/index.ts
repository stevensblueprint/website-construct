// import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export interface WebsiteConstructProps {
  // Define construct properties here
}

export class WebsiteConstruct extends Construct {

  constructor(scope: Construct, id: string, props: WebsiteConstructProps = {}) {
    super(scope, id);

    // Define construct contents here

    // example resource
    // const queue = new sqs.Queue(this, 'WebsiteConstructQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
  }
}
