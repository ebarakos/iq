import Link from "next/link";

/**
 * Next's default 404 is a bare "This page could not be found." with no link and
 * no app name, so a visitor who mistypes a shared link is stranded with nothing
 * to click. This says where they are and gives them the one way back.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-4 py-8 text-center">
      <h1 className="text-2xl font-bold tracking-tight">
        aiq <span className="font-normal text-gray-400">· visual reasoning test</span>
      </h1>
      <p className="mt-4 max-w-md text-gray-600">
        There is no page at this address. The link may have been mistyped or may have changed.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-lg bg-gray-900 px-5 py-2.5 font-medium text-white hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 focus-visible:ring-offset-2"
      >
        Go to the test
      </Link>
    </main>
  );
}
