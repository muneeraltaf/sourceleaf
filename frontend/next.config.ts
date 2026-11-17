import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const config: NextConfig = {
  async rewrites() {
    const apiOrigin = process.env.LOCAL_API_ORIGIN;
    if (!apiOrigin) return [];

    return [{
      source: "/api/:path*",
      destination: new URL("/api/:path*", apiOrigin).href,
    }];
  },
};

export default withWorkflow(config);
