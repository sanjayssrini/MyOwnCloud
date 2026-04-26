import "./globals.css";

export const metadata = {
  title: "MyOwnCloud (LAN MVP)",
  description: "A local network cloud storage MVP built with Next.js and SQLite.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
