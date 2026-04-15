import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const beatrizRestrictedRoutes = [
  "/criar-qr-code",
  "/kit-organizer",
  "/processador-anuncios",
];

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session && path !== "/login") {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (session && path === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (
    session &&
    session.user.email === "beatriz@nwc.com" &&
    beatrizRestrictedRoutes.includes(path)
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|logo|sounds|manga).*)",
  ],
};
