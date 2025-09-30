# Website CDK Construct

A reusable [AWS CDK](https://docs.aws.amazon.com/cdk/) construct to deploy a website via S3 and CloudFont.

## Features

- CDN caching via CloudFont
- Deployment via S3
- Hardened S3 bucket defaults with bucket-owner-only ACLs and automatic SSE
- Direct access to the underlying S3 bucket and CloudFront distribution for advanced customization

### Bucket security hardening

The construct keeps the S3 bucket accessible for static website hosting while enforcing safer defaults:

- Bucket ACLs are blocked and ownership is enforced so only the account owner controls access.
- Objects are encrypted at rest with S3 managed keys.
- CloudFront OAI access is granted explicitly via a bucket policy instead of broad public access.

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
