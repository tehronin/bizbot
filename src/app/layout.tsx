import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import AgentHeartbeatServiceBoot from "@/components/agent/AgentHeartbeatServiceBoot";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "BizBot",
  description: "Local desktop social media agent",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AgentHeartbeatServiceBoot />
        {children}
      </body>
    </html>
  );
}
