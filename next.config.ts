import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The preview opens this dev server at 127.0.0.1. Next only trusts
  // localhost by default, so it blocks the dev socket and the page
  // never hydrates: the About button renders, but clicks do nothing.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
