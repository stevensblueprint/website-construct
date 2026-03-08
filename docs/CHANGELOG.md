# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [v0.1.8] - 2026-03-08

### Changed

- Relaxed `aws-cdk-lib` peer dependency from an exact version pin (`2.237.1`) to a range (`^2.0.0`) for compatibility with older CDK v2 projects.

### Added

- `distributionId` field exposed in claim and heartbeat API responses, and in `SlotDefinition`, so CI workflows can trigger CloudFront invalidations after deployment.
- `cachePolicy: CACHING_DISABLED` on the main `Website` CloudFront distribution behavior (previously only applied to preview distributions).
- README example updated to show CloudFront invalidation step using `distributionId` from the claim response.

## [v0.1.8] - 2026-02-16

### Fix

- Updated aws library in lambda to `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`

## [v0.1.7] - 2026-02-16

### Fix

- Added S3 write permissions to api lambda

## [v0.1.6] - 2026-02-15

### Added

- `PreviewConfig` on `WebsiteProps` to enable pull request preview environments from the `Website` construct.
- Preview slot infrastructure with configurable bucket pool size (`bucketCount`, default `2`), LRU lease behavior, and optional per-slot CloudFront distributions.
- Preview lease API endpoints for CI workflows:
  - `POST /claim`
  - `POST /heartbeat`
  - `POST /release`
- DynamoDB-backed lease state with `RepoPrKeyIndex` for PR-to-slot lookup.
- `previewEnvironment` exposure on `Website` for accessing endpoints and resources from downstream stacks.
- `grantDeploymentAccess(...)` helper to grant CI principals access to preview buckets and CloudFront invalidation.

### Changed

- Refactored preview lease Lambda source from inline code to `lambda/index.ts` for better maintainability.
- Updated tests to validate preview behavior via `Website.previewConfig` instead of constructing preview infrastructure directly.
- Updated README preview usage to configure previews through `Website`.

## [v0.1.5]

### Added

- `includeRootDomain` option to `DomainConfig` to deploy to both subdomain and root domain simultaneously.

## [v0.1.4] - 2025-09-30

### Security

- Hardened the website bucket policy by blocking ACLs, enforcing bucket-owner full control, and retaining S3 managed encryption.

## [v0.1.3] - 2025-09-30

### Added

- Exposed the CloudFront distribution as a public construct member for downstream stacks.

## [v0.1.2] - 2025-09-06

### Changed

- Made S3 website bucket a public member, so that it is accessible from outside the construct

## [v0.1.1] - 2025-09-06

### Added

- `DomainConfig` for custom domains (domain + subdomain + ACM certificate).
- Route 53 `ARecord` creation for CloudFront distribution.
- Support for custom 404 pages (`notFoundResponsePagePath`).
- CloudFormation outputs:
  - CloudFront Distribution URL
  - S3 Website URL
  - Custom domain URL (if configured)

### Changed

- CloudFront distribution defaults:
  - Redirect all traffic to HTTPS.
  - Cache 404 responses for 30 minutes.
  - Price class limited to `PRICE_CLASS_100` for lower cost.

### Security

- Enforced access restrictions with CloudFront Origin Access Identity (OAI).
- Buckets encrypted with **S3 Managed Encryption** by default.

---

## [v0.1.0] - 2025-08-15

### Added

- Initial release of Website.
- Static website hosting via S3.
- CloudFront distribution with default caching.
- Basic index and error page support.
