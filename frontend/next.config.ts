import { loadEnvConfig } from "@next/env";
import path from "path";
import type { NextConfig } from "next";

loadEnvConfig(process.cwd());
loadEnvConfig(path.join(process.cwd(), ".."));

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "mammoth", "exceljs", "jszip", "docx", "pdf-lib", "pptxgenjs"],
  experimental: {
    serverActions: {
      bodySizeLimit: "26mb",
    },
    proxyClientMaxBodySize: "26mb",
  },
};

export default nextConfig;
