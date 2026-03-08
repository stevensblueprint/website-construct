import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfont from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as certificatemanager from "aws-cdk-lib/aws-certificatemanager";
import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as path from "path";

export interface DomainConfig {
  /** The root domain name (e.g., example.com).
   * There must be an associated hosted zone in Route 53 for this domain.
   */
  domainName: string;
  /** The subdomain name */
  subdomainName: string;
  /** The ARN of the SSL certificate to use for the domain. */
  certificateArn: string;
  /**
   * If true, creates an additional Route 53 record for the root domain pointing to the CloudFront distribution.
   * @default false
   */
  includeRootDomain?: boolean;
}

export interface WebsiteProps {
  /** The name of the S3 bucket that will host the website content. */
  bucketName: string;

  /** The path to the index document that will be served as the default page. */
  indexFile: string;

  /** The path to the error document that will be served when an error occurs. */
  errorFile: string;

  /** Optional configuration for custom domain setup. */
  domainConfig?: DomainConfig;

  /** Optional path to a custom 404 page. If not specified, the error file will be used. */
  notFoundResponsePagePath?: string;

  /** Optional configuration for pull request preview environments. */
  previewConfig?: PreviewConfig;
}

export interface PreviewConfig {
  /** Prefix used to name preview buckets. Buckets are created as `${prefix}-0`, `${prefix}-1`, ... */
  bucketPrefix: string;

  /** Number of preview buckets to create.
   * @default 2
   */
  bucketCount?: number;

  /** If true, creates one CloudFront distribution per preview bucket.
   * @default true
   */
  createDistributions?: boolean;

  /** Maximum lease lifetime in hours before a slot is considered expired.
   * @default 24
   */
  maxLeaseHours?: number;
}

export interface PreviewEnvironmentProps extends PreviewConfig {
  /** Index document for preview buckets. */
  indexFile: string;

  /** Error document for preview buckets. */
  errorFile: string;
}

export class Website extends Construct {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfont.Distribution;
  public readonly previewEnvironment?: PreviewEnvironment;

  constructor(scope: Construct, id: string, props: WebsiteProps) {
    super(scope, id);
    this.bucket = new s3.Bucket(this, props.bucketName, {
      websiteIndexDocument: props.indexFile,
      websiteErrorDocument: props.errorFile,
      publicReadAccess: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS_ONLY,
      accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });
    const oai = new cloudfont.OriginAccessIdentity(
      this,
      `${props.bucketName}-OAI`,
    );
    this.bucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [this.bucket.arnForObjects("*")],
        principals: [
          new iam.CanonicalUserPrincipal(
            oai.cloudFrontOriginAccessIdentityS3CanonicalUserId,
          ),
        ],
      }),
    );
    const domainNames: string[] = [];
    if (props.domainConfig) {
      domainNames.push(this._getFullDomainName(props.domainConfig));
      if (
        props.domainConfig.includeRootDomain &&
        props.domainConfig.subdomainName
      ) {
        domainNames.push(props.domainConfig.domainName);
      }
    }

    this.distribution = new cloudfont.Distribution(
      this,
      `${props.bucketName}-distribution`,
      {
        defaultBehavior: {
          origin: new origins.S3StaticWebsiteOrigin(this.bucket),
          viewerProtocolPolicy:
            cloudfont.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        errorResponses: [
          {
            httpStatus: 404,
            responseHttpStatus: 404,
            responsePagePath: props.notFoundResponsePagePath || `/404.html`,
            ttl: cdk.Duration.minutes(30),
          },
        ],
        priceClass: cloudfont.PriceClass.PRICE_CLASS_100,
        ...(props.domainConfig
          ? {
              domainNames: domainNames,
              certificate: this._getCertificate(
                props.domainConfig.certificateArn,
              ),
            }
          : {}),
      },
    );

    if (props.domainConfig) {
      const hostedZone = route53.HostedZone.fromLookup(this, "HostedZone", {
        domainName: props.domainConfig.domainName,
      });
      const domainARecord = new route53.ARecord(this, "DomainARecord", {
        zone: hostedZone,
        recordName: this._getFullDomainName(props.domainConfig),
        target: cdk.aws_route53.RecordTarget.fromAlias(
          new cdk.aws_route53_targets.CloudFrontTarget(this.distribution),
        ),
      });
      domainARecord.node.addDependency(this.distribution);

      if (
        props.domainConfig.includeRootDomain &&
        props.domainConfig.subdomainName
      ) {
        new route53.ARecord(this, "RootDomainARecord", {
          zone: hostedZone,
          recordName: props.domainConfig.domainName,
          target: cdk.aws_route53.RecordTarget.fromAlias(
            new cdk.aws_route53_targets.CloudFrontTarget(this.distribution),
          ),
        }).node.addDependency(this.distribution);
      }
    }

    new cdk.CfnOutput(this, "cloudfront-website-url", {
      value: this.distribution.distributionDomainName,
      description: "CloudFront Distribution Domain Name",
    });

    new cdk.CfnOutput(this, "s3-website-url", {
      value: this.bucket.bucketWebsiteUrl,
      description: "S3 Bucket Website URL",
    });

    if (props.domainConfig) {
      new cdk.CfnOutput(this, "website-url", {
        value: this.distribution.domainName,
        description: "Website URL",
      });
    }

    if (props.previewConfig) {
      this.previewEnvironment = new PreviewEnvironment(
        this,
        "PreviewEnvironment",
        {
          ...props.previewConfig,
          indexFile: props.indexFile,
          errorFile: props.errorFile,
        },
      );
    }
  }

  private _getFullDomainName(domainConfig: DomainConfig): string {
    return domainConfig.subdomainName
      ? `${domainConfig.subdomainName}.${domainConfig.domainName}`
      : domainConfig.domainName;
  }

  private _getCertificate(arn: string): certificatemanager.ICertificate {
    return certificatemanager.Certificate.fromCertificateArn(
      this,
      `website-cert`,
      arn,
    );
  }
}

export class PreviewEnvironment extends Construct {
  public readonly buckets: s3.Bucket[];
  public readonly distributions: cloudfont.Distribution[];
  public readonly leaseTable: dynamodb.Table;
  public readonly api: apigateway.RestApi;
  public readonly claimEndpoint: string;
  public readonly heartbeatEndpoint: string;
  public readonly releaseEndpoint: string;

  constructor(scope: Construct, id: string, props: PreviewEnvironmentProps) {
    super(scope, id);

    const bucketCount = props.bucketCount ?? 2;
    if (bucketCount < 1) {
      throw new Error("bucketCount must be greater than or equal to 1");
    }

    const indexFile = props.indexFile;
    const errorFile = props.errorFile;
    const createDistributions = props.createDistributions ?? true;
    const maxLeaseHours = props.maxLeaseHours ?? 24;
    const maxLeaseMs = cdk.Duration.hours(maxLeaseHours).toMilliseconds();

    this.buckets = Array.from({ length: bucketCount }, (_, slotId) => {
      const bucketName = `${props.bucketPrefix}-${slotId}`;
      return new s3.Bucket(this, `PreviewBucket${slotId}`, {
        bucketName,
        websiteIndexDocument: indexFile,
        websiteErrorDocument: errorFile,
        publicReadAccess: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ACLS_ONLY,
        accessControl: s3.BucketAccessControl.BUCKET_OWNER_FULL_CONTROL,
        encryption: s3.BucketEncryption.S3_MANAGED,
      });
    });

    this.distributions = createDistributions
      ? this.buckets.map((bucket, slotId) => {
          const oai = new cloudfont.OriginAccessIdentity(
            this,
            `PreviewOAI${slotId}`,
          );
          bucket.addToResourcePolicy(
            new iam.PolicyStatement({
              actions: ["s3:GetObject"],
              resources: [bucket.arnForObjects("*")],
              principals: [
                new iam.CanonicalUserPrincipal(
                  oai.cloudFrontOriginAccessIdentityS3CanonicalUserId,
                ),
              ],
            }),
          );
          return new cloudfont.Distribution(
            this,
            `PreviewDistribution${slotId}`,
            {
              defaultBehavior: {
                origin: new origins.S3StaticWebsiteOrigin(bucket),
                viewerProtocolPolicy:
                  cloudfont.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                cachePolicy: cloudfont.CachePolicy.CACHING_DISABLED,
              },
              priceClass: cloudfont.PriceClass.PRICE_CLASS_100,
            },
          );
        })
      : [];

    this.leaseTable = new dynamodb.Table(this, "PreviewLeases", {
      partitionKey: {
        name: "slotId",
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttlEpochSeconds",
    });
    this.leaseTable.addGlobalSecondaryIndex({
      indexName: "RepoPrKeyIndex",
      partitionKey: {
        name: "repoPrKey",
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const slotDefinitions = this.buckets.map((bucket, slotId) => ({
      slotId,
      bucketName: bucket.bucketName,
      distributionId: this.distributions[slotId]?.distributionId,
      previewUrl: this.distributions[slotId]
        ? `https://${this.distributions[slotId].distributionDomainName}`
        : bucket.bucketWebsiteUrl,
    }));

    const leaseApiHandler = new lambda.Function(
      this,
      "PreviewLeaseApiHandler",
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        timeout: cdk.Duration.seconds(15),
        code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambda")),
        environment: {
          TABLE_NAME: this.leaseTable.tableName,
          SLOT_DEFINITIONS: JSON.stringify(slotDefinitions),
          MAX_LEASE_MS: String(maxLeaseMs),
        },
      },
    );

    this.leaseTable.grantReadWriteData(leaseApiHandler);
    this.buckets.forEach((b) => b.grantReadWrite(leaseApiHandler));

    this.api = new apigateway.RestApi(this, "PreviewLeaseApi", {
      restApiName: `${cdk.Names.uniqueId(this)}-preview-lease-api`,
      description: "API for claiming/releasing preview slots",
    });

    const claimResource = this.api.root.addResource("claim");
    claimResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(leaseApiHandler),
    );
    const heartbeatResource = this.api.root.addResource("heartbeat");
    heartbeatResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(leaseApiHandler),
    );
    const releaseResource = this.api.root.addResource("release");
    releaseResource.addMethod(
      "POST",
      new apigateway.LambdaIntegration(leaseApiHandler),
    );

    this.claimEndpoint = `${this.api.url}claim`;
    this.heartbeatEndpoint = `${this.api.url}heartbeat`;
    this.releaseEndpoint = `${this.api.url}release`;

    new cdk.CfnOutput(this, "preview-claim-endpoint", {
      value: this.claimEndpoint,
      description: "POST endpoint used to claim a preview slot",
    });
    new cdk.CfnOutput(this, "preview-heartbeat-endpoint", {
      value: this.heartbeatEndpoint,
      description: "POST endpoint used to refresh a preview slot lease",
    });
    new cdk.CfnOutput(this, "preview-release-endpoint", {
      value: this.releaseEndpoint,
      description: "POST endpoint used to release a preview slot",
    });
  }

  public grantDeploymentAccess(grantee: iam.IGrantable): void {
    this.buckets.forEach((bucket) => bucket.grantReadWrite(grantee));
    this.distributions.forEach((distribution) => {
      grantee.grantPrincipal.addToPrincipalPolicy(
        new iam.PolicyStatement({
          actions: ["cloudfront:CreateInvalidation"],
          resources: [distribution.distributionArn],
        }),
      );
    });
  }
}
