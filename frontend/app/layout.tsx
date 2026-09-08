import type { Metadata, Viewport } from "next";
import { Poppins } from "next/font/google";
import { AppShell } from "@/components/ui/AppShell";
import { Providers } from "@/components/providers";
import { copy } from "@/content/fr";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: copy.meta.title,
  description: copy.meta.description,
  applicationName: copy.product.name,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${poppins.variable} h-full antialiased`}>
      <body className="h-full font-sans">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
