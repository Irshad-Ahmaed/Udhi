import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Science Diagram Maker — Udhi Technologies",
  description:
    "AI-generated animated GCSE science & maths SVG diagrams with automated validation and human review.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
