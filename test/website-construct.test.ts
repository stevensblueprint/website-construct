import { Template, Match } from "aws-cdk-lib/assertions";
import * as cdk from "aws-cdk-lib";
import { Website, WebsiteProps, DomainConfig } from "../lib";

describe("Website", () => {
  let app: cdk.App;
  let stack: cdk.Stack;

  beforeEach(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, "TestStack", {
      env: { account: "123456789012", region: "us-east-1" },
    });
    stack.node.setContext(
      "hosted-zone:account=123456789012:domainName=example.com:region=us-east-1",
      {
        Id: "/hostedzone/Z123456789012",
        Name: "example.com.",
      },
    );
  });

  describe("Basic functionality", () => {
    test("creates S3 bucket with basic configuration", () => {
      const props: WebsiteProps = {
        bucketName: "test-website-bucket",
        indexFile: "index.html",
        errorFile: "error.html",
      };

      new Website(stack, "TestWebsite", props);

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::S3::Bucket", {
        WebsiteConfiguration: {
          IndexDocument: "index.html",
          ErrorDocument: "error.html",
        },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "AES256",
              },
            },
          ],
        },
      });
    });

    test("creates CloudFront Origin Access Identity", () => {
      const props: WebsiteProps = {
        bucketName: "test-website-bucket",
        indexFile: "index.html",
        errorFile: "error.html",
      };

      new Website(stack, "TestWebsite", props);

      const template = Template.fromStack(stack);

      template.hasResourceProperties(
        "AWS::CloudFront::CloudFrontOriginAccessIdentity",
        {
          CloudFrontOriginAccessIdentityConfig: {
            Comment: Match.anyValue(),
          },
        },
      );
    });

    test("creates CloudFront distribution with correct configuration", () => {
      const props: WebsiteProps = {
        bucketName: "test-website-bucket",
        indexFile: "index.html",
        errorFile: "error.html",
      };

      new Website(stack, "TestWebsite", props);

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          DefaultCacheBehavior: {
            ViewerProtocolPolicy: "redirect-to-https",
          },
          CustomErrorResponses: [
            {
              ErrorCode: 404,
              ResponseCode: 404,
              ResponsePagePath: "/404.html",
              ErrorCachingMinTTL: 1800,
            },
          ],
          PriceClass: "PriceClass_100",
          Enabled: true,
        },
      });
    });

    test("exposes CloudFront distribution", () => {
      const props: WebsiteProps = {
        bucketName: "test-website-bucket",
        indexFile: "index.html",
        errorFile: "error.html",
      };

      const website = new Website(stack, "TestWebsite", props);

      expect(website.distribution).toBeDefined();
    });
  });

  describe("Custom error page configuration", () => {
    test("uses custom not found response page path", () => {
      const props: WebsiteProps = {
        bucketName: "test-website-bucket",
        indexFile: "index.html",
        errorFile: "error.html",
        notFoundResponsePagePath: "/custom-404.html",
      };

      new Website(stack, "TestWebsite", props);

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          CustomErrorResponses: [
            {
              ErrorCode: 404,
              ResponseCode: 404,
              ResponsePagePath: "/custom-404.html",
              ErrorCachingMinTTL: 1800,
            },
          ],
        },
      });
    });

    test("uses default 404.html when notFoundResponsePagePath is not provided", () => {
      const props: WebsiteProps = {
        bucketName: "test-website-bucket",
        indexFile: "index.html",
        errorFile: "error.html",
      };

      new Website(stack, "TestWebsite", props);

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          CustomErrorResponses: [
            {
              ErrorCode: 404,
              ResponseCode: 404,
              ResponsePagePath: "/404.html",
              ErrorCachingMinTTL: 1800,
            },
          ],
        },
      });
    });
  });

  describe("Domain configuration", () => {
    const domainConfig: DomainConfig = {
      domainName: "example.com",
      subdomainName: "www",
      certificateArn:
        "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
    };

    test("configures CloudFront distribution with custom domain", () => {
      const props: WebsiteProps = {
        bucketName: "test-website-bucket",
        indexFile: "index.html",
        errorFile: "error.html",
        domainConfig,
      };

      new Website(stack, "TestWebsite", props);

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          Aliases: ["www.example.com"],
          ViewerCertificate: {
            AcmCertificateArn: domainConfig.certificateArn,
            SslSupportMethod: "sni-only",
          },
        },
      });
    });

    test("creates Route53 A record when domain config is provided", () => {
      const props: WebsiteProps = {
        bucketName: "test-website-bucket",
        indexFile: "index.html",
        errorFile: "error.html",
        domainConfig,
      };

      new Website(stack, "TestWebsite", props);

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Type: "A",
        Name: "www.example.com.",
        AliasTarget: {
          DNSName: Match.anyValue(),
          HostedZoneId: Match.anyValue(),
        },
      });
    });

    test("handles domain without subdomain", () => {
      const domainConfigWithoutSub: DomainConfig = {
        domainName: "example.com",
        subdomainName: "",
        certificateArn:
          "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
      };

      const props: WebsiteProps = {
        bucketName: "test-website-bucket",
        indexFile: "index.html",
        errorFile: "error.html",
        domainConfig: domainConfigWithoutSub,
      };

      new Website(stack, "TestWebsite", props);

      const template = Template.fromStack(stack);

      template.hasResourceProperties("AWS::CloudFront::Distribution", {
        DistributionConfig: {
          Aliases: ["example.com"],
        },
      });

      template.hasResourceProperties("AWS::Route53::RecordSet", {
        Type: "A",
        Name: "example.com.",
      });
    });
  });

  describe("Private methods", () => {
    test("_getFullDomainName returns correct domain with subdomain", () => {
      const props: WebsiteProps = {
        bucketName: "test-bucket",
        indexFile: "index.html",
        errorFile: "error.html",
      };

      const construct = new Website(stack, "TestWebsite", props);

      // Access private method through bracket notation for testing
      const getFullDomainName = (construct as any)._getFullDomainName;

      const domainConfig: DomainConfig = {
        domainName: "example.com",
        subdomainName: "blog",
        certificateArn: "arn:test",
      };

      const result = getFullDomainName(domainConfig);
      expect(result).toBe("blog.example.com");
    });

    test("_getFullDomainName returns root domain when subdomain is empty", () => {
      const props: WebsiteProps = {
        bucketName: "test-bucket",
        indexFile: "index.html",
        errorFile: "error.html",
      };

      const construct = new Website(stack, "TestWebsite", props);

      const getFullDomainName = (construct as any)._getFullDomainName;

      const domainConfig: DomainConfig = {
        domainName: "example.com",
        subdomainName: "",
        certificateArn: "arn:test",
      };

      const result = getFullDomainName(domainConfig);
      expect(result).toBe("example.com");
    });
  });

  describe("Edge cases", () => {
    test("handles minimal configuration", () => {
      const props: WebsiteProps = {
        bucketName: "minimal-bucket",
        indexFile: "index.html",
        errorFile: "error.html",
      };

      expect(() => {
        new Website(stack, "TestWebsite", props);
      }).not.toThrow();

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::S3::Bucket", 1);
      template.resourceCountIs("AWS::CloudFront::Distribution", 1);
      template.resourceCountIs(
        "AWS::CloudFront::CloudFrontOriginAccessIdentity",
        1,
      );
    });

    test("does not create Route53 resources when domain config is not provided", () => {
      const props: WebsiteProps = {
        bucketName: "test-bucket",
        indexFile: "index.html",
        errorFile: "error.html",
      };

      new Website(stack, "TestWebsite", props);

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::Route53::RecordSet", 0);
    });
  });
});
