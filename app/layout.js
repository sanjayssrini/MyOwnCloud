import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const font = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata = {
  title: "MyOwnCloud — Personal Local Cloud Storage",
  description: "High-speed private cloud storage for your local devices and storage drives.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MyOwnCloud",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#2563eb",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={font.className}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="theme-color" content="#2563eb" />
      </head>
      <body>{children}</body>
    </html>
  );
}
