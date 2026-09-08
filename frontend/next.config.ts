import { loadEnvConfig } from "@next/env";
import path from "path";
import type { NextConfig } from "next";

loadEnvConfig(path.resolve(process.cwd(), ".."));
loadEnvConfig(process.cwd());

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "mammoth", "exceljs", "jszip", "docx", "pdf-lib", "pptxgenjs"],
  experimental: {
    serverActions: {
      bodySizeLimit: "21mb",
    },
    proxyClientMaxBodySize: "21mb",
  },
};

export default nextConfig;
