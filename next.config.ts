import type { NextConfig } from "next";

const isVercelBuild = process.env.VERCEL === "1";

// Skew protection needs a deployment id that is unique per *deployment*. A
// commit SHA is unique per *commit*, so deriving one from VERCEL_GIT_COMMIT_SHA
// fails the moment the same commit is redeployed or a failed build is retried
// ("deploymentId ... already exists in this project"). Vercel issues its own id
// when Skew Protection is enabled in the project settings, so leave it unset
// there. Self-hosted builds still supply one explicitly via DEPLOYMENT_VERSION,
// which Next.js caps at 32 characters.
const deploymentId = isVercelBuild
  ? undefined
  : process.env.DEPLOYMENT_VERSION?.slice(0, 32);

const nextConfig: NextConfig = {
  // Vercel injects its own Next.js adapter and output pipeline. Standalone
  // output is only needed by the self-hosted Docker image.
  ...(!isVercelBuild ? { output: "standalone" as const } : {}),
  poweredByHeader: false,
  allowedDevOrigins: ["127.0.0.1", "192.168.1.8"],
  ...(deploymentId ? { deploymentId } : {}),
  async headers() {
    const securityHeaders = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=()",
      },
    ];

    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }

    return [{ source: "/:path*", headers: securityHeaders }];
  },
  experimental: {
    serverActions: {
      // Patient documents are capped at 1 MB after client-side compression.
      // Leave room for multipart field headers and boundaries.
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
