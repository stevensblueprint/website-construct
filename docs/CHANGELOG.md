# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),  
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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

- Initial release of WebsiteConstruct.
- Static website hosting via S3.
- CloudFront distribution with default caching.
- Basic index and error page support.
