import type { Metadata, Viewport } from "next";

// Makes the driver area installable ("Add to home screen") without turning the whole site into an app.
export const metadata: Metadata = {
  manifest: "/driver.webmanifest",
  icons: { apple: "/icons/icon-192.png" },
  appleWebApp: { capable: true, title: "Sabeel", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#0b7a8f" };

export default function DriverLayout({ children }: { children: React.ReactNode }) {
  return children;
}
