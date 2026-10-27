import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GROOVED",
  description: "Browse music, build your crate, and give every listen a Groove Grade.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
