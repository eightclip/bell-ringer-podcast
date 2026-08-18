import './globals.css';

export const metadata = {
  title: 'Bell Ringer',
  description: 'A daily twelve-minute show built from what they are actually studying that week.',
  // Still noindex. The feeds carry itunes:block and stay out of Apple's
  // directory; this keeps the front door out of search results too, so the
  // show is findable by anyone holding the link and by nobody else.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
