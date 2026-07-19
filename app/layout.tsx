import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "First & Ten",
  description: "Track drives, downs, scores, player profiles, and game history for First & Ten.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
