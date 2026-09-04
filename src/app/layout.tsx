import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "3% Club — Customer Dashboard",
  description:
    "WhatsApp automation and customer management dashboard for the 3% Club.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
