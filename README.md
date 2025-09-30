# Website CDK Construct

A reusable [AWS CDK](https://docs.aws.amazon.com/cdk/) construct to deploy a website via S3 and CloudFont.

## Features

- CDN caching via CloudFont
- Deployment via S3
- Direct access to the underlying S3 bucket and CloudFront distribution for advanced customization

## Installation

```bash
npm i @sitblueprint/website-construct
```

## Usage

```ts
export class MyWebsiteStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const website = new Website(this, "MyWebsite", {
      bucketName: "my-static-site-bucket",
      indexFile: "index.html",
      errorFile: "error.html",
      notFoundResponsePagePath: "/404.html",
      domainConfig: {
        domainName: "example.com",
        subdomainName: "www",
        certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/abc123",
      },
    });

    website.bucket; // Underlying S3 bucket
    website.distribution; // CloudFront distribution serving the site
  }
}
```

## Development

- Build: `npm run build`
- Test: `npm run test`

## License

MIT
