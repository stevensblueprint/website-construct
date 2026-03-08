# Website CDK Construct

A reusable [AWS CDK](https://docs.aws.amazon.com/cdk/) construct to deploy a website via S3 and CloudFont.

## Features

- CDN caching via CloudFont
- Deployment via S3
- Dual domain support (e.g., deploy to both `www.example.com` and `example.com` simultaneously)
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
        includeRootDomain: true, // Optional: also deploy to example.com
      },
    });

    website.bucket; // Underlying S3 bucket
    website.distribution; // CloudFront distribution serving the site
  }
}
```

## Pull Request Preview Environments

Use `previewConfig` on `Website` to create a pool of preview buckets (default: 2). CI can claim a slot using LRU, deploy artifacts to the assigned bucket, and release the slot when the pull request closes.

```ts
export class WebsiteWithPreviewStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const website = new Website(this, "MyWebsite", {
      bucketName: "my-static-site-bucket",
      indexFile: "index.html",
      errorFile: "error.html",
      previewConfig: {
        bucketPrefix: "my-frontend-preview",
        bucketCount: 2, // default
        maxLeaseHours: 24,
      },
    });

    new cdk.CfnOutput(this, "PreviewClaimEndpoint", {
      value: website.previewEnvironment!.claimEndpoint,
    });
    new cdk.CfnOutput(this, "PreviewReleaseEndpoint", {
      value: website.previewEnvironment!.releaseEndpoint,
    });
  }
}
```

### API contract for CI

- `POST /claim` with body `{"repo":"owner/repo","prNumber":123,"commitSha":"abc"}`
- `POST /heartbeat` with body `{"repo":"owner/repo","prNumber":123,"commitSha":"abc"}`
- `POST /release` with body `{"repo":"owner/repo","prNumber":123}`

`claim` and `heartbeat` return:

```json
{
  "slotId": 0,
  "bucketName": "my-frontend-preview-0",
  "distributionId": "EDFDVBD6EXAMPLE",
  "previewUrl": "https://....cloudfront.net"
}
```

### GitHub Actions shape

```yaml
name: preview
on:
  pull_request:
    types: [opened, reopened, synchronize, closed]

jobs:
  preview:
    runs-on: ubuntu-latest
    concurrency: preview-${{ github.event.pull_request.number }}
    steps:
      - uses: actions/checkout@v4
      - if: github.event.action != 'closed'
        run: npm ci && npm run build
      - name: Claim or release slot
        env:
          REPO: ${{ github.repository }}
          PR: ${{ github.event.pull_request.number }}
          SHA: ${{ github.sha }}
          CLAIM_URL: ${{ secrets.PREVIEW_CLAIM_ENDPOINT }}
          RELEASE_URL: ${{ secrets.PREVIEW_RELEASE_ENDPOINT }}
        run: |
          if [ "${{ github.event.action }}" = "closed" ]; then
            curl -sS -X POST "$RELEASE_URL" -H "content-type: application/json" -d "{\"repo\":\"$REPO\",\"prNumber\":$PR}"
            exit 0
          fi

          RESPONSE=$(curl -sS -X POST "$CLAIM_URL" -H "content-type: application/json" -d "{\"repo\":\"$REPO\",\"prNumber\":$PR,\"commitSha\":\"$SHA\"}")
          echo "$RESPONSE" > preview-slot.json
          BUCKET=$(jq -r '.bucketName' preview-slot.json)
          DIST_ID=$(jq -r '.distributionId // empty' preview-slot.json)
          URL=$(jq -r '.previewUrl' preview-slot.json)
          aws s3 sync ./dist "s3://$BUCKET" --delete
          if [ -n "$DIST_ID" ]; then
            aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths "/*"
          fi
          echo "Preview URL: $URL"
```

## Development

- Build: `npm run build`
- Test: `npm run test`

## License

MIT
