#!/usr/bin/env node
import acm = require('@aws-cdk/aws-certificatemanager');
import cloudfront = require('@aws-cdk/aws-cloudfront');
import route53 = require('@aws-cdk/aws-route53');
import s3 = require('@aws-cdk/aws-s3');
import s3deploy = require('@aws-cdk/aws-s3-deployment');
import cdk = require('@aws-cdk/core');
import targets = require('@aws-cdk/aws-route53-targets/lib');

export interface StaticSiteProps {
    domainName: string;
    siteSubDomain: string;
}

export class StaticSite extends cdk.Construct {
    constructor(parent: cdk.Construct, name: string, props: StaticSiteProps) {
        super(parent, name);

        const siteDomain = props.siteSubDomain + '.' + props.domainName;
        new cdk.CfnOutput(this, 'Site', { value: 'https://' + siteDomain });
        const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: props.domainName });

        const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, "OriginAccessIdentity", {
            comment: "Access from CloudFront to reinvent-trivia website bucket"
        });

        // Content bucket
        const siteBucket = new s3.Bucket(this, 'SiteBucket', {
            bucketName: siteDomain
        });
        siteBucket.grantRead(originAccessIdentity);
        new cdk.CfnOutput(this, 'Bucket', { value: siteBucket.bucketName });

        // TLS certificate
        const certificateArn = new acm.Certificate(this, 'SiteCertificate', {
            domainName: siteDomain,
            validation: acm.CertificateValidation.fromDns(zone),
        }).certificateArn;
        new cdk.CfnOutput(this, 'Certificate', { value: certificateArn });

        // CloudFront distribution that provides HTTPS
        const distribution = new cloudfront.CloudFrontWebDistribution(this, 'SiteDistribution', {
            aliasConfiguration: {
                acmCertRef: certificateArn,
                names: [ siteDomain ],
                sslMethod: cloudfront.SSLMethod.SNI,
                securityPolicy: cloudfront.SecurityPolicyProtocol.TLS_V1_1_2016
            },
            originConfigs: [
                {
                    s3OriginSource: {
                        s3BucketSource: siteBucket,
                        originAccessIdentity
                    },
                    behaviors : [ {isDefaultBehavior: true}],
                }
            ],
            errorConfigurations: [
                {
                    errorCode: 404,
                    responseCode: 404,
                    responsePagePath: '/error.html'
                },
                {
                    errorCode: 403,
                    responseCode: 404,
                    responsePagePath: '/error.html'
                }
            ]
        });
        new cdk.CfnOutput(this, 'DistributionId', { value: distribution.distributionId });

        // Route53 alias record for the CloudFront distribution
        new route53.ARecord(this, 'SiteAliasRecord', {
            recordName: siteDomain,
            target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution)),
            zone
        });

        // Deploy site contents to S3 bucket
        new s3deploy.BucketDeployment(this, 'DeployWithInvalidation', {
            sources: [ s3deploy.Source.asset('../app/build') ],
            destinationBucket: siteBucket,
            distribution,
            distributionPaths: ['/*'],
          });
    }
}
