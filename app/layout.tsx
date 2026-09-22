import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "جدولة المقابلات اليومية",
  description:
    "أداة يومية لرفع ملفات المرشحين وتوزيع المواعيد تلقائيًا حسب أوقات كل موظف، دون تداخل.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
