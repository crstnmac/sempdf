import { randomUUID } from "node:crypto";

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Credentials resolve via the default AWS SDK chain (env vars, shared config
// file / profile, or an instance/task role) — nothing hardcoded here. Set
// AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY in .env for local testing only.
const s3 = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });

const PRESIGN_EXPIRY_SECONDS = Number(process.env.S3_PRESIGN_EXPIRY_SECONDS ?? 900);

/**
 * Uploads a generated report to S3 and returns a short-lived presigned GET
 * URL. The bucket should block public access entirely — the presigned URL is
 * the only way to reach the object, and it expires.
 */
export async function uploadReportAndGetDownloadUrl(
  bytes: Uint8Array,
  filenameHint: string,
): Promise<{ key: string; url: string; expiresIn: number }> {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("S3_BUCKET is not configured.");

  const slug = filenameHint.replace(/[^\w.-]+/g, "_").slice(0, 80) || "report";
  const key = `reports/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${slug}.pdf`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: "application/pdf",
      // Belt-and-suspenders even if the bucket policy ever drifts.
      ACL: "private",
    }),
  );

  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: PRESIGN_EXPIRY_SECONDS,
  });

  return { key, url, expiresIn: PRESIGN_EXPIRY_SECONDS };
}
